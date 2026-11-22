import sys
import unittest
from pathlib import Path
from unittest import mock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ladder

SIGN_IN = '<form id="signin" method="post">'


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


def _page(text, path="/summary", status=200):
    response = requests.Response()
    response.url = f"{ladder.LADDER_BASE}{path}"
    response.status_code = status
    response.headers["Content-Type"] = "text/html"
    response.encoding = "utf-8"
    response._content = text.encode()
    return response


class LadderSessionCookieTest(unittest.TestCase):
    def test_session_cookie_is_used_without_signing_in(self):
        client = ladder.LadderClient("club@example.com", "secret", "s%3Aabc")
        self.assertEqual(client.session.cookies.get("connect.sid"), "s%3Aabc")
        with mock.patch.object(client, "login") as login, \
                mock.patch.object(client, "_get", return_value=_page("fixtures")):
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
        login.assert_not_called()

    def test_rejected_session_cookie_falls_back_to_password_sign_in(self):
        client = ladder.LadderClient("club@example.com", "secret", "s%3Aexpired")
        with mock.patch.object(client, "login") as login, \
                mock.patch.object(client, "_get", side_effect=[_page(SIGN_IN), _page("fixtures")]):
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
        login.assert_called_once()
        self.assertFalse(client.using_session_cookie)

    def test_cookie_prefix_from_the_browser_is_accepted(self):
        with mock.patch.dict("os.environ", {"LADDER_SESSION": " connect.sid=s%3Aabc "}), \
                mock.patch.object(ladder, "_client", None):
            self.assertEqual(ladder.get_client().session.cookies.get("connect.sid"), "s%3Aabc")

    def test_rejected_password_session_is_retried_only_after_cooldown(self):
        client = ladder.LadderClient("club@example.com", "secret")
        with mock.patch.object(ladder.time, "monotonic", return_value=1000) as clock, \
                mock.patch.object(client.session, "get", side_effect=[
                    _page(SIGN_IN), _page("Signed out", path="/signin"),
                    _page(SIGN_IN), _page("fixtures"),
                ]) as get, \
                mock.patch.object(client.session, "post", return_value=_page("Welcome")) as post, \
                self.assertLogs(level="WARNING") as logs:
            with self.assertRaises(ladder.LadderAuthError) as first:
                client.get_page("/summary")
            self.assertEqual(first.exception.retry_after, ladder.AUTH_RETRY_SECONDS)
            self.assertFalse(client.logged_in)
            clock.return_value += 1
            with self.assertRaises(ladder.LadderAuthError) as second:
                client.get_page("/team/n/82")
            self.assertEqual(second.exception.retry_after, ladder.AUTH_RETRY_SECONDS - 1)
            self.assertEqual(get.call_count, 2)
            post.assert_called_once()
            clock.return_value = 1000 + ladder.AUTH_RETRY_SECONDS
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
            self.assertEqual(post.call_count, 2)
        self.assertEqual(len(logs.records), 1)

    def test_session_expiring_during_discord_skip_can_fall_back(self):
        client = ladder.LadderClient("club@example.com", "secret", "s%3Aexpired")
        with mock.patch.object(client.session, "get", side_effect=[
            _page("Discord Verification Required"),
            _page("Signed out", path="/signin"),
            _page(SIGN_IN),
            _page("fixtures"),
        ]), mock.patch.object(client.session, "post", return_value=_page("Welcome")) as post:
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
        post.assert_called_once()
        self.assertFalse(client.using_session_cookie)

    def test_upstream_service_failure_is_not_an_auth_cooldown(self):
        client = ladder.LadderClient("club@example.com", "secret")
        with mock.patch.object(client.session, "get", side_effect=[
            _page(SIGN_IN), _page(SIGN_IN), _page("fixtures"),
        ]), mock.patch.object(client.session, "post", side_effect=[
            _page(SIGN_IN, status=503), _page("Welcome"),
        ]):
            with self.assertRaises(requests.HTTPError):
                client.get_page("/summary")
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
