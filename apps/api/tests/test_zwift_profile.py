"""Run from apps/api: python -m unittest tests.test_zwift_profile -v."""

import unittest
from unittest.mock import patch

from requests import HTTPError, Response

from zwift import ZwiftAPI


def response(status_code, body=b""):
    result = Response()
    result.status_code = status_code
    result.headers["Content-Type"] = "application/json"
    result._content = body
    return result


class ZwiftProfileTest(unittest.TestCase):
    def setUp(self):
        self.zwift = ZwiftAPI("test-user", "test-password")
        self.zwift.auth_token = {"access_token": "test-token"}
        self.get = self.enterContext(patch("zwift.requests.get"))
        self.enterContext(patch("backoff._sync.time.sleep"))

    def test_missing_profile_returns_none_without_retrying(self):
        self.get.return_value = response(404)

        self.assertIsNone(self.zwift.get_profile("123"))
        self.get.assert_called_once()

    def test_empty_successful_profile_returns_empty_dict(self):
        for status, body in [(204, b""), (200, b""), (200, b" \n"), (200, b"null")]:
            with self.subTest(status=status, body=body):
                self.get.return_value = response(status, body)
                self.assertEqual(self.zwift.get_profile("123"), {})

    def test_profile_retries_other_http_errors(self):
        self.get.side_effect = [response(503), response(200, b'{"id": 123}')]

        self.assertEqual(self.zwift.get_profile("123"), {"id": 123})
        self.assertEqual(self.get.call_count, 2)

    def test_other_endpoint_still_retries_and_raises_not_found(self):
        self.get.return_value = response(404)

        with self.assertRaises(HTTPError) as error:
            self.zwift.get_club_roster("123")

        self.assertEqual(error.exception.response.status_code, 404)
        self.assertEqual(self.get.call_count, 5)
