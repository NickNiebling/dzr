"""Run from apps/api: python -m unittest discover -s tests -p test_ladder.py -v."""
import unittest
from unittest.mock import Mock

import requests

import ladder


def response(body="", status=200):
    result = requests.Response()
    result.status_code = status
    result._content = body.encode()
    return result


class LadderTest(unittest.TestCase):
    def client(self, email="test-user", password="test-secret"):
        client = ladder.LadderClient(email, password)
        client.session = Mock()
        return client

    def test_missing_credentials_stop_before_network(self):
        for email, password in ((None, "secret"), ("user", None)):
            with self.subTest(email_present=bool(email)):
                client = self.client(email, password)
                with self.assertRaisesRegex(ladder.LadderError, "credentials are not configured"):
                    client.login()
                client.session.get.assert_not_called()
                client.session.post.assert_not_called()

    def test_rejected_login_including_http_200_login_form(self):
        rejected = [response("Denied", 403)] + [response(body) for body in (
            '<form id="signin">', "<form id='signin'>", "<FORM ID=SIGNIN>",
            "<form action='/signin'>", "<input type='password'>",
        )]
        for result in rejected:
            with self.subTest(body=result.text, status=result.status_code):
                client = self.client()
                client.session.post.return_value = result
                with self.assertRaisesRegex(ladder.LadderError, "Ladder login failed"):
                    client.login()
                self.assertFalse(client.logged_in)

    def test_login_form_after_discord_skip_is_rejected(self):
        client = self.client()
        client.logged_in = True
        client.session.get.side_effect = [
            response("Discord Verification Required"), response("skipped"),
            response("<form id='signin'><input type=password></form>"),
        ]
        with self.assertRaisesRegex(ladder.LadderError, "session rejected after login"):
            client.get_page("/team/n/82")
        self.assertFalse(client.logged_in)

    def test_only_verified_read_paths_are_allowed(self):
        for path in (
            "/summary", "/team/n/82", "/teamView/Example%20Team", "/profile/123",
            "/matchlist/fixtures/Example%20Team", "/fixture/123", "/rSignups/123",
        ):
            with self.subTest(path=path):
                self.assertTrue(ladder.is_allowed_path(path))
        for path in (
            "/signin", "/team/n/0", "/team/n/abc", "/summary?all=1", "/fixture/1/doRefresh",
            "https://evil.test/summary", "/teamView/%2e%2e", "/teamView/A%2FB",
            "/teamView/A%252FB", "/teamView/A%5CB", "/teamView/A%0AB", "/teamView/A%ZZB",
        ):
            with self.subTest(path=path):
                self.assertFalse(ladder.is_allowed_path(path))


if __name__ == "__main__":
    unittest.main()
