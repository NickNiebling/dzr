"""Run from apps/api: python -m unittest discover -s tests -p test_ladder.py -v."""

import os
import unittest
from unittest.mock import Mock, patch

import requests

import ladder


TEAM_HTML = '<a href="/logout">Logout</a><div id="pane-roster"><table></table></div><script>const TEAMID = 82;</script>'
SIGN_IN_HTML = "<form action='/signin' id='signin'><input type='password'></form>"


def response(body="", status=200, path="/summary"):
    result = requests.Response()
    result.status_code = status
    result.url = f"{ladder.LADDER_BASE}{path}"
    result._content = body.encode("utf-8")
    result.headers["Content-Type"] = "text/html; charset=utf-8"
    return result


def team_response():
    return response(TEAM_HTML, path="/teamView/Example%20Team")


class AllowedPathsTest(unittest.TestCase):
    def test_verified_read_paths_and_existing_fixture_paths(self):
        for path in (
            "/summary", "/team/n/82", "/team/n/999999", "/teamView/Example%20Team",
            "/teamView/%C3%98rn", "/profile/123", "/matchlist/fixtures/Example%20Team",
            "/fixture/123", "/rSignups/123",
        ):
            with self.subTest(path=path):
                self.assertTrue(ladder.is_allowed_path(path))

    def test_unknown_routes_writes_queries_and_unsafe_segments_are_rejected(self):
        for path in (
            "", None, "/signin", "/logout", "/discord/skip", "/team/n/0", "/team/n/-2",
            "/team/n/01", "/team/n/abc", "/profile/0", "/profile/abc", "/teamView/",
            "/teamView/A/B", "/summary?all=1", "/summary#x", "/fixture/12/doRefresh",
            "https://evil.test/summary", "//evil.test/summary", "/teamView/../signin",
            "/teamView/%2e%2e", "/teamView/A%2FB", "/teamView/A%5CB", "/teamView/A\\B",
            "/teamView/A%3FB", "/teamView/A%23B", "/teamView/A%0AB", "/teamView/A\x00B",
            "/teamView/A%252FB", "/teamView/A%ZZB", "/teamView/A%FFB",
        ):
            with self.subTest(path=path):
                self.assertFalse(ladder.is_allowed_path(path))


class AuthDetectionTest(unittest.TestCase):
    def test_login_forms_are_detected_regardless_of_status_or_attribute_quoting(self):
        for body in (
            '<form id="signin">', "<form id='signin'>", "<FORM ID=SIGNIN>",
            "<form action='/signin'>", '<form action="/login">',
            "<input type='password'>", '<INPUT TYPE="PASSWORD">',
        ):
            with self.subTest(body=body):
                self.assertTrue(ladder._is_sign_in_page(body))

    def test_signed_in_team_and_plain_text_are_not_login_forms(self):
        self.assertFalse(ladder._is_sign_in_page(TEAM_HTML))
        self.assertFalse(ladder._is_sign_in_page("Please change your password on the settings page"))


class CredentialsTest(unittest.TestCase):
    def setUp(self):
        previous = ladder._client
        self.addCleanup(setattr, ladder, "_client", previous)
        ladder._client = None

    def test_ladder_environment_takes_precedence(self):
        with patch.dict(os.environ, {
            "LADDER_EMAIL": "ladder-user", "LADDER_PASSWORD": "ladder-secret",
            "ZWIFT_USERNAME": "fallback-user", "ZWIFT_PASSWORD": "fallback-secret",
        }, clear=True):
            client = ladder.get_client()
        self.assertEqual((client.email, client.password), ("ladder-user", "ladder-secret"))

    def test_existing_zwift_environment_fallback(self):
        with patch.dict(os.environ, {"ZWIFT_USERNAME": "fallback-user", "ZWIFT_PASSWORD": "fallback-secret"}, clear=True):
            client = ladder.get_client()
        self.assertEqual((client.email, client.password), ("fallback-user", "fallback-secret"))

    def test_missing_environment_stops_before_network(self):
        with patch.dict(os.environ, {}, clear=True):
            client = ladder.get_client()
        client.session = Mock()
        with self.assertRaisesRegex(ladder.LadderError, "missing email/username"):
            client.login()
        client.session.get.assert_not_called()
        client.session.post.assert_not_called()

    def test_missing_password_stops_before_network(self):
        client = ladder.LadderClient("user", None)
        client.session = Mock()
        with self.assertRaisesRegex(ladder.LadderError, "missing password"):
            client.login()
        client.session.get.assert_not_called()


class LoginTest(unittest.TestCase):
    def setUp(self):
        self.client = ladder.LadderClient("test-user", "test-secret")
        self.client.session = Mock()
        self.client.session.post.return_value = response("public summary")

    def login_with_proof(self, proof):
        self.client.session.get.side_effect = [response(SIGN_IN_HTML, path="/signin"), proof]
        self.client.login()

    def test_login_uses_existing_form_and_session_then_verifies_protected_team(self):
        self.login_with_proof(team_response())
        self.assertTrue(self.client.logged_in)
        self.client.session.cookies.clear.assert_called_once()
        self.assertEqual(self.client.session.get.call_args_list[-1].args[0], f"{ladder.LADDER_BASE}/team/n/82")
        self.assertEqual(self.client.session.post.call_args.kwargs["data"], {
            "email": "test-user", "password": "test-secret", "returnTo": "/summary", "service": "clubladder",
        })

    def test_rejected_signin_http_status_stops_before_post(self):
        self.client.session.get.return_value = response("Denied", status=403, path="/signin")
        with self.assertRaisesRegex(ladder.LadderError, "sign-in form failed.*403"):
            self.client.login()
        self.client.session.post.assert_not_called()
        self.assertFalse(self.client.logged_in)

    def test_rejected_login_and_http_200_login_forms_do_not_pass(self):
        for rejected in (response("Denied", status=403), response(SIGN_IN_HTML), response("", path="/signin")):
            with self.subTest(status=rejected.status_code, path=rejected.url):
                self.client.session.get.return_value = response(SIGN_IN_HTML, path="/signin")
                self.client.session.post.return_value = rejected
                with self.assertRaisesRegex(ladder.LadderError, "Ladder login failed"):
                    self.client.login()
                self.assertFalse(self.client.logged_in)

    def test_protected_http_200_login_form_is_rejected(self):
        with self.assertRaisesRegex(ladder.LadderError, "protected team still requires login"):
            self.login_with_proof(response(SIGN_IN_HTML, path="/team/n/82"))
        self.assertFalse(self.client.logged_in)

    def test_public_summary_is_not_access_proof(self):
        with self.assertRaisesRegex(ladder.LadderError, "could not be verified"):
            self.login_with_proof(response("public summary"))
        self.assertFalse(self.client.logged_in)

    def test_protected_access_requires_team_82_roster_and_signed_in_controls(self):
        for body in (TEAM_HTML.replace("pane-roster", "unknown"), TEAM_HTML.replace("/logout", "/signin"), TEAM_HTML.replace("= 82", "= 99")):
            with self.subTest(body=body):
                with self.assertRaisesRegex(ladder.LadderError, "could not be verified"):
                    self.login_with_proof(response(body, path="/teamView/Example"))
                self.assertFalse(self.client.logged_in)

    def test_external_redirect_is_not_access_proof(self):
        proof = team_response()
        proof.url = "https://other.test/teamView/Example"
        with self.assertRaisesRegex(ladder.LadderError, "could not be verified"):
            self.login_with_proof(proof)

    def test_protected_http_failure_is_concrete(self):
        with self.assertRaisesRegex(ladder.LadderError, "protected team access failed.*403"):
            self.login_with_proof(response("Denied", status=403, path="/team/n/82"))

    def test_discord_skip_retains_existing_session_and_checks_team_afterwards(self):
        self.client.session.get.side_effect = [
            response(SIGN_IN_HTML, path="/signin"), response("Discord Verification Required"),
            response("skipped"), team_response(),
        ]
        self.client.login()
        self.assertTrue(self.client.logged_in)
        self.assertEqual(self.client.session.get.call_args_list[-2].args[0], f"{ladder.LADDER_BASE}/discord/skip")

    def test_login_form_after_discord_skip_is_rejected(self):
        self.client.session.get.side_effect = [
            response(SIGN_IN_HTML, path="/signin"), response("Discord Verification Required"),
            response("skipped"), response(SIGN_IN_HTML, path="/team/n/82"),
        ]
        with self.assertRaisesRegex(ladder.LadderError, "protected team still requires login"):
            self.client.login()
        self.assertFalse(self.client.logged_in)

    def test_unresolved_discord_gate_is_rejected(self):
        self.client.session.get.side_effect = [
            response(SIGN_IN_HTML, path="/signin"), response("Discord Verification Required"),
            response("skipped"), response("Discord Verification Required"),
        ]
        with self.assertRaisesRegex(ladder.LadderError, "Discord verification still required"):
            self.client.login()
        self.assertFalse(self.client.logged_in)


class SessionPagesTest(unittest.TestCase):
    def setUp(self):
        self.client = ladder.LadderClient("test-user", "test-secret")
        self.client.session = Mock()
        self.client.logged_in = True

    def test_allowlist_stops_unknown_path_before_network(self):
        with self.assertRaisesRegex(ValueError, "Path not allowed"):
            self.client.get_page("/signin")
        self.client.session.get.assert_not_called()

    def test_verified_read_page_preserves_body_and_content_type(self):
        self.client.session.get.return_value = response("roster", path="/team/n/82")
        self.assertEqual(self.client.get_page("/team/n/82"), ("roster", "text/html; charset=utf-8"))

    def test_expired_session_relogs_and_checks_protected_access(self):
        self.client.session.get.side_effect = [
            response(SIGN_IN_HTML), response(SIGN_IN_HTML, path="/signin"), team_response(), response("fixture"),
        ]
        self.client.session.post.return_value = response("public summary")
        self.assertEqual(self.client.get_page("/fixture/123")[0], "fixture")
        self.assertTrue(self.client.logged_in)

    def test_login_form_persisting_after_relogin_is_rejected(self):
        self.client.session.get.side_effect = [
            response(SIGN_IN_HTML), response(SIGN_IN_HTML, path="/signin"), team_response(), response(SIGN_IN_HTML),
        ]
        self.client.session.post.return_value = response("public summary")
        with self.assertRaisesRegex(ladder.LadderError, "session rejected after login"):
            self.client.get_page("/fixture/123")
        self.assertFalse(self.client.logged_in)

    def test_http_200_login_form_after_discord_skip_is_rejected(self):
        self.client.session.get.side_effect = [response("Discord Verification Required"), response("skipped"), response(SIGN_IN_HTML)]
        with self.assertRaisesRegex(ladder.LadderError, "session rejected after login"):
            self.client.get_page("/fixture/123")
        self.assertFalse(self.client.logged_in)

    def test_existing_signup_refresh_flow_is_preserved(self):
        self.client.session.get.side_effect = [response("Refreshing Signups"), response("fixture ready")]
        self.assertEqual(self.client.get_page("/fixture/123")[0], "fixture ready")
        self.client.session.post.assert_called_once_with(f"{ladder.LADDER_BASE}/fixture/123/doRefresh", timeout=60)

    def test_login_form_after_signup_refresh_is_rejected(self):
        self.client.session.get.side_effect = [response("Refreshing Signups"), response(SIGN_IN_HTML)]
        with self.assertRaisesRegex(ladder.LadderError, "session rejected after login"):
            self.client.get_page("/fixture/123")


if __name__ == "__main__":
    unittest.main()
