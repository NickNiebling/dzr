"""Run from the repository root: python -m unittest discover -s apps/api/tests -p test_ladder.py."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ladder


SIGNIN = '<form id="signin">Sign in</form>'


def response(body="page", status=200, path="/summary"):
    res = requests.Response()
    res.status_code = status
    res.url = f"{ladder.LADDER_BASE}{path}"
    res._content = body.encode()
    res.headers["Content-Type"] = "text/html; charset=utf-8"
    return res


class LadderPathsTest(unittest.TestCase):
    def test_scout_adds_only_summary_team_and_profile_reads(self):
        for path in ("/summary", "/team/n/82", "/profile/123", "/fixture/123",
                     "/matchlist/fixtures/Example%20Team", "/rSignups/123"):
            with self.subTest(path=path):
                self.assertTrue(ladder.is_allowed_path(path))
        for path in ("/signin", "/team/n/0", "/team/n/abc", "/summary?all=1",
                     "/fixture/1/doRefresh", "/teamView/Example", "/profile/../signin",
                     "https://example.com/summary"):
            with self.subTest(path=path):
                self.assertFalse(ladder.is_allowed_path(path))

    def test_diagnostic_paths_strip_secrets_and_unknown_redirects(self):
        self.assertEqual(ladder.diagnostic_path("https://user:password@example.com/signin?email=private#token"), "/signin")
        self.assertEqual(ladder.diagnostic_path("/matchlist/fixtures/Private%20Team?key=secret"), "/matchlist/fixtures/{team}")
        self.assertIsNone(ladder.diagnostic_path("https://example.com/reset/private-token"))


class LadderCredentialsTest(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.singleton = patch.object(ladder, "_client", None)
        self.singleton.start()
        self.addCleanup(self.singleton.stop)

    def test_complete_dedicated_pair_overrides_complete_zwift_pair(self):
        os.environ.update(LADDER_EMAIL="ladder@example.invalid", LADDER_PASSWORD="ladder-password",
                          ZWIFT_USERNAME="zwift@example.invalid", ZWIFT_PASSWORD="zwift-password")
        client = ladder.get_client()
        self.assertEqual((client.email, client.password), ("ladder@example.invalid", "ladder-password"))
        self.assertIs(ladder.get_client(), client)

    def test_complete_zwift_pair_is_used_when_no_ladder_override_exists(self):
        os.environ.update(ZWIFT_USERNAME="zwift@example.invalid", ZWIFT_PASSWORD="zwift-password")
        client = ladder.get_client()
        self.assertEqual((client.email, client.password), ("zwift@example.invalid", "zwift-password"))

    def test_partial_overrides_never_mix_credentials_with_zwift(self):
        for override in ({"LADDER_EMAIL": "ladder@example.invalid"}, {"LADDER_PASSWORD": "ladder-password"}, {}):
            with self.subTest(override=override), patch.dict(os.environ, override, clear=True):
                if override:
                    os.environ.update(ZWIFT_USERNAME="zwift@example.invalid", ZWIFT_PASSWORD="zwift-password")
                with self.assertRaises(ladder.LadderError) as caught:
                    ladder.get_client()
                self.assertEqual(caught.exception.code, "ladder_credentials_missing")
                self.assertIsNone(ladder._client)


class LadderClientTest(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        with patch("ladder.requests.Session", return_value=self.session):
            self.client = ladder.LadderClient("club@example.invalid", "private-password")

    def test_successful_login_uses_the_form_cookie_and_existing_fields(self):
        self.session.get.return_value = response(SIGNIN, path="/signin")
        self.session.post.return_value = response()
        self.client.login()
        self.assertTrue(self.client.logged_in)
        self.session.cookies.clear.assert_called_once_with()
        self.session.get.assert_called_once_with(f"{ladder.LADDER_BASE}/signin", timeout=20)
        self.session.post.assert_called_once_with(f"{ladder.LADDER_BASE}/signin", timeout=20, data={
            "email": "club@example.invalid", "password": "private-password",
            "returnTo": "/summary", "service": "clubladder",
        })

    def test_login_rejection_reports_safe_phase_status_and_final_path(self):
        for rejected in (response(SIGNIN, path="/signin?email=secret"), response("private upstream body", 403, "/signin?token=secret")):
            with self.subTest(status=rejected.status_code):
                self.client.logged_in = True
                self.session.get.return_value = response(SIGNIN, path="/signin")
                self.session.post.return_value = rejected
                with self.assertRaises(ladder.LadderError) as caught:
                    self.client.login()
                error = caught.exception
                self.assertEqual(error.payload(), {"error": "Ladder login failed", "code": "ladder_login_failed"})
                self.assertEqual(error.context["phase"], "login_submit")
                self.assertEqual(error.context["upstream_status"], rejected.status_code)
                self.assertEqual(error.context["final_path"], "/signin")
                self.assertNotIn("secret", str(error.context))
                self.assertNotIn("private", str(error.context))
                self.assertFalse(self.client.logged_in)

    def test_missing_credentials_fail_without_a_network_request(self):
        self.client.email = None
        with self.assertRaises(ladder.LadderError) as caught:
            self.client.login()
        self.assertEqual(caught.exception.code, "ladder_credentials_missing")
        self.session.get.assert_not_called()
        self.session.post.assert_not_called()

    def test_login_form_http_failure_is_distinguished_from_rejected_credentials(self):
        self.session.get.return_value = response("private gateway failure", 503, "/signin")
        with self.assertRaises(ladder.LadderError) as caught:
            self.client.login()
        self.assertEqual(caught.exception.code, "ladder_upstream_unavailable")
        self.assertEqual(caught.exception.context["phase"], "login_form")
        self.session.post.assert_not_called()
        self.assertFalse(self.client.logged_in)

    def test_login_submit_outage_and_rate_limit_are_not_authentication_rejections(self):
        for status in (429, 500, 502, 503):
            with self.subTest(status=status):
                self.session.get.return_value = response(SIGNIN, path="/signin")
                self.session.post.return_value = response("private upstream failure", status, "/signin")
                with self.assertRaises(ladder.LadderError) as caught:
                    self.client.login()
                self.assertEqual(caught.exception.code, "ladder_upstream_unavailable")
                self.assertEqual(caught.exception.context["phase"], "login_submit")
                self.assertEqual(caught.exception.context["upstream_status"], status)
                self.assertFalse(self.client.logged_in)

    def test_timeout_and_network_errors_never_expose_the_original_exception(self):
        for exc, code in ((requests.Timeout("private token"), "ladder_upstream_timeout"),
                          (requests.ConnectionError("private password"), "ladder_upstream_unavailable")):
            with self.subTest(code=code):
                self.session.get.side_effect = exc
                with self.assertRaises(ladder.LadderError) as caught:
                    self.client.login()
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(caught.exception.context, {"code": code, "phase": "login_form"})
                self.assertNotIn("private", str(caught.exception))
                self.assertFalse(self.client.logged_in)

    def test_expired_session_reauthenticates_once_and_returns_the_page(self):
        self.client.logged_in = True
        self.session.get.side_effect = [response(SIGNIN, path="/signin"), response(SIGNIN, path="/signin"), response("roster", path="/team/n/91")]
        self.session.post.return_value = response()
        self.assertEqual(self.client.get_page("/team/n/91"), ("roster", "text/html; charset=utf-8"))
        self.session.post.assert_called_once()
        self.assertTrue(self.client.logged_in)

    def test_repeated_session_rejection_is_bounded_and_clears_logged_in(self):
        self.client.logged_in = True
        self.session.get.side_effect = [response(SIGNIN, path="/signin")] * 3
        self.session.post.return_value = response()
        with self.assertRaises(ladder.LadderError) as caught:
            self.client.get_page("/team/n/91")
        self.assertEqual(caught.exception.code, "ladder_session_rejected")
        self.assertEqual(caught.exception.context["phase"], "page_after_login")
        self.session.post.assert_called_once()
        self.assertFalse(self.client.logged_in)

    def test_failed_reauthentication_does_not_retain_old_logged_in_state(self):
        self.client.logged_in = True
        self.session.get.side_effect = [response(SIGNIN, path="/signin")] * 2
        self.session.post.return_value = response(SIGNIN, path="/signin")
        with self.assertRaises(ladder.LadderError) as caught:
            self.client.get_page("/team/n/91")
        self.assertEqual(caught.exception.code, "ladder_login_failed")
        self.session.post.assert_called_once()
        self.assertFalse(self.client.logged_in)

    def test_upstream_http_error_is_not_misreported_as_a_login_rejection(self):
        self.client.logged_in = True
        self.session.get.return_value = response("private gateway body", 502, "/team/n/91?token=private")
        with self.assertRaises(ladder.LadderError) as caught:
            self.client.get_page("/team/n/91")
        self.assertEqual(caught.exception.code, "ladder_upstream_unavailable")
        self.assertEqual(caught.exception.context["upstream_status"], 502)
        self.assertEqual(caught.exception.context["final_path"], "/team/n/91")
        self.session.post.assert_not_called()

    def test_fixture_signup_refresh_keeps_the_existing_post_and_refetch(self):
        self.client.logged_in = True
        self.session.get.side_effect = [response("Refreshing Signups", path="/fixture/123"), response("fixture", path="/fixture/123")]
        self.session.post.return_value = response()
        self.assertEqual(self.client.get_page("/fixture/123")[0], "fixture")
        self.session.post.assert_called_once_with(f"{ladder.LADDER_BASE}/fixture/123/doRefresh", timeout=60)

    def test_discord_interstitial_keeps_the_existing_skip_and_refetch(self):
        self.client.logged_in = True
        self.session.get.side_effect = [response("Discord Verification Required"), response(), response("roster", path="/team/n/91")]
        self.assertEqual(self.client.get_page("/team/n/91")[0], "roster")
        self.assertEqual(self.session.get.call_args_list[1].args[0], f"{ladder.LADDER_BASE}/discord/skip")
        self.session.post.assert_not_called()

    def test_disallowed_path_fails_before_authentication(self):
        with self.assertRaises(ValueError):
            self.client.get_page("/signin")
        self.session.get.assert_not_called()


class LadderEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Import the actual route without initializing Firebase or sending startup telemetry.
        with patch("firebase_admin.initialize_app"), patch("firebase_admin.firestore.client"), patch("dotenv.load_dotenv"), patch("observability.init_sentry"):
            import main
        cls.main = main

    def setUp(self):
        import sentry_sdk
        from sentry_sdk.transport import Transport
        from observability import init_sentry

        class MemoryTransport(Transport):
            def __init__(self, options):
                super().__init__(options)
                self.events = []

            def capture_envelope(self, envelope):
                for item in envelope.items:
                    if item.type == "event":
                        self.events.append(item.payload.json)

        original_init = sentry_sdk.init
        with patch.dict(os.environ, {"SENTRY_DSN": "https://public@example.invalid/1"}), patch(
            "observability.sentry_sdk.init", side_effect=lambda **options: original_init(**options, transport=MemoryTransport)
        ):
            init_sentry()
        self.events = sentry_sdk.get_client().transport.events
        self.addCleanup(lambda: sentry_sdk.get_client().close())
        self.auth = patch.object(self.main, "require_api_or_401", return_value=None)
        self.auth.start()
        self.addCleanup(self.auth.stop)
        client_patch = patch.object(ladder, "get_client")
        self.upstream = client_patch.start().return_value
        self.addCleanup(client_patch.stop)
        self.client = self.main.app.test_client()

    def test_authentication_failure_keeps_502_and_adds_safe_error_code_and_sentry_context(self):
        rejected = response(SIGNIN + "private response body", path="/signin?password=private-password")
        self.upstream.get_page.side_effect = ladder.LadderError("ladder_login_failed", phase="login_submit", response=rejected)
        with self.assertLogs(level="ERROR") as logs:
            result = self.client.get("/ladder_page?path=/team/n/91", headers={"Authorization": "Bearer private-token"})
        self.assertEqual(result.status_code, 502)
        self.assertEqual(result.json, {"error": "Ladder login failed", "code": "ladder_login_failed"})
        self.assertEqual(logs.records[0].ladder["phase"], "login_submit")
        self.assertEqual(logs.records[0].ladder["upstream_status"], 200)
        self.assertEqual(len(self.events), 1)
        context = self.events[0]["contexts"]["ladder"]
        self.assertEqual(context["requested_path"], "/team/n/91")
        self.assertEqual(context["final_path"], "/signin")
        self.assertTrue(context["signin_detected"])
        self.assertNotIn("private", str(self.events))
        self.assertNotIn("private", str(logs.records[0].__dict__))

    def test_unexpected_errors_are_sanitized_in_the_response_and_telemetry(self):
        self.upstream.get_page.side_effect = RuntimeError("private password and HTML")
        with self.assertLogs(level="ERROR"):
            result = self.client.get("/ladder_page?path=/summary")
        self.assertEqual(result.status_code, 502)
        self.assertEqual(result.json["code"], "ladder_error")
        self.assertNotIn("private", str(result.json))
        self.assertNotIn("private", str(self.events))
        self.assertEqual(self.events[0]["contexts"]["ladder"]["exception_type"], "RuntimeError")

    def test_success_returns_original_page_and_content_type_without_error_reporting(self):
        self.upstream.get_page.return_value = ("<html>roster</html>", "text/html; charset=utf-8")
        result = self.client.get("/ladder_page?path=/team/n/91")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.text, "<html>roster</html>")
        self.assertEqual(result.mimetype, "text/html")
        self.assertEqual(self.events, [])

    def test_disallowed_paths_keep_400_and_do_not_reach_ladder(self):
        result = self.client.get("/ladder_page?path=/signin")
        self.assertEqual(result.status_code, 400)
        self.upstream.get_page.assert_not_called()
