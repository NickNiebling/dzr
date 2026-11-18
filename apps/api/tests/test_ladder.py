"""Run from apps/api: python -m unittest discover -s tests -p test_ladder.py."""
import unittest
from types import SimpleNamespace
from unittest import mock

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


def _page(text):
    return SimpleNamespace(text=text, headers={"Content-Type": "text/html"}, raise_for_status=lambda: None)


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
