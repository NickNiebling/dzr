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
                mock.patch.object(client, "_get", side_effect=[_page(SIGN_IN), _page("fixtures")]), \
                self.assertLogs(level="WARNING") as logs:
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
        login.assert_called_once()
        self.assertEqual([record.levelname for record in logs.records], ["WARNING"])
        self.assertFalse(client.using_session_cookie)

    def test_cookie_prefix_from_the_browser_is_accepted(self):
        with mock.patch.dict("os.environ", {
            "LADDER_SESSION": " connect.sid=s%3Aabc ",
            "LADDER_SESSION_EXPIRES_AT": "2026-12-01T00:00:00Z",
        }), \
                mock.patch.object(ladder, "_client", None):
            client = ladder.get_client()
        self.assertEqual(client.session.cookies.get("connect.sid"), "s%3Aabc")
        self.assertEqual(client._session_expires_at, 1796083200)

    def test_expiry_and_definitive_rejection_each_alert_once(self):
        send = mock.Mock(return_value=True)
        expires_at = 2_000_000_000
        client = ladder.LadderClient("club@example.com", "secret", "private-cookie", send_alert=send)
        client.session.cookies.set("connect.sid", "private-cookie", domain=ladder.LADDER_HOST, path="/", expires=expires_at)
        with mock.patch.object(ladder.time, "time", return_value=expires_at - ladder.RENEWAL_WINDOW) as wall_clock, \
                mock.patch.object(ladder.time, "monotonic", return_value=1000) as clock, \
                mock.patch.object(client, "_get", return_value=_page("fixtures")) as fetch, \
                mock.patch.object(client.session, "get", return_value=_page(SIGN_IN)), \
                mock.patch.object(client.session, "post", return_value=_page("Denied", status=403)), \
                self.assertLogs(level="WARNING"):
            client.get_page("/summary")
            send.assert_not_called()
            wall_clock.return_value += 1
            client.get_page("/summary")
            client.get_page("/summary")
            send.assert_called_once()
            self.assertIn(f"<t:{expires_at}:R>", send.call_args.args[0])

            fetch.return_value = _page(SIGN_IN)
            for advance in (0, 1, ladder.AUTH_RETRY_INITIAL):
                clock.return_value += advance
                with self.assertRaises(ladder.LadderAuthError):
                    client.get_page("/summary")
        self.assertEqual(send.call_count, 2)
        self.assertIn("password", send.call_args.args[0])
        self.assertNotIn("private-cookie", str(send.call_args_list))

    def test_rejected_password_sign_in_logs_each_attempt_and_backs_off_until_recovery(self):
        client = ladder.LadderClient("club@example.com", "secret")
        rejected = _page("Signed out", path="/signin")
        delays = [300, 600, 1200, 2400, 3600, 3600]
        with mock.patch.object(ladder.time, "monotonic", return_value=1000) as clock, \
                mock.patch.object(client.session, "get") as get, \
                mock.patch.object(client.session, "post", return_value=_page("Welcome")) as post, \
                self.assertLogs(level="ERROR") as logs:
            for attempt, delay in enumerate(delays, start=1):
                get.side_effect = [_page(SIGN_IN), rejected]
                with self.assertRaises(ladder.LadderAuthError) as failure:
                    client.get_page("/summary")
                self.assertEqual(failure.exception.retry_after, delay)
                clock.return_value += 1
                with self.assertRaises(ladder.LadderAuthError) as paused:
                    client.get_page("/team/n/82")
                self.assertEqual(paused.exception.retry_after, delay - 1)
                self.assertEqual(post.call_count, attempt)
                self.assertEqual(len(logs.records), attempt)
                clock.return_value += delay - 1

            get.side_effect = [_page(SIGN_IN), _page("fixtures"), rejected, _page(SIGN_IN), rejected]
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
            with self.assertRaises(ladder.LadderAuthError) as failure:
                client.get_page("/summary")
            self.assertEqual(failure.exception.retry_after, delays[0])
        self.assertEqual(len(logs.records), len(delays) + 1)

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

    def test_upstream_sign_in_failure_starts_backoff(self):
        send = mock.Mock()
        client = ladder.LadderClient("club@example.com", "secret", send_alert=send)
        with mock.patch.object(client.session, "get", return_value=_page(SIGN_IN)), \
                mock.patch.object(client.session, "post", return_value=_page("Unavailable", status=503)), \
                self.assertLogs(level="ERROR") as logs:
            with self.assertRaises(ladder.LadderAuthError) as failure:
                client.get_page("/summary")
            self.assertEqual(failure.exception.retry_after, 300)
        self.assertIn("HTTP 503", logs.output[0])
        send.assert_not_called()

    def test_upstream_page_failure_does_not_start_auth_backoff(self):
        client = ladder.LadderClient("club@example.com", "secret", "s%3Aabc")
        with mock.patch.object(client, "_get", side_effect=[
            _page("Unavailable", status=503), _page("fixtures"),
        ]), mock.patch.object(client, "login") as login:
            with self.assertRaises(requests.HTTPError):
                client.get_page("/summary")
            self.assertEqual(client.get_page("/summary")[0], "fixtures")
        login.assert_not_called()
