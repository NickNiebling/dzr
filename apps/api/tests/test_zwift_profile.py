"""Run from apps/api: python -m unittest tests.test_zwift_profile -v."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest.mock import patch

from requests import HTTPError, Response

from zwift import AUTH_RETRY_INITIAL, ZwiftAPI, ZwiftAuthError


def response(status_code, body=b""):
    result = Response()
    result.status_code = status_code
    result.headers["Content-Type"] = "application/json"
    result._content = body
    return result


class ZwiftProfileTest(unittest.TestCase):
    def setUp(self):
        self.zwift = ZwiftAPI("test-user", "test-password")
        self.post = self.enterContext(patch("zwift.requests.post", return_value=response(
            200, b'{"access_token":"test-token","refresh_token":"test-refresh","expires_in":300}'
        )))
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

    def test_late_profile_401_reuses_token_refreshed_by_another_request(self):
        self.zwift.ensure_valid_token()
        self.post.return_value = response(200, b'{"access_token":"new-token","expires_in":300}')
        both_using_old_token = Barrier(2)
        first_replay = Event()

        def get(url, *, headers, **kwargs):
            if headers["Authorization"] == "Bearer test-token":
                both_using_old_token.wait(timeout=5)
                if url.endswith("/456"):
                    self.assertTrue(first_replay.wait(timeout=5), "first request did not replay with the new token")
                return response(401)
            self.assertEqual(headers["Authorization"], "Bearer new-token")
            first_replay.set()
            return response(200, b'{"id": 123}')

        self.get.side_effect = get
        with self.assertLogs("ZwiftAPI", "WARNING") as logs, ThreadPoolExecutor(max_workers=2) as pool:
            calls = [pool.submit(self.zwift.get_profile, rider_id) for rider_id in ("123", "456")]
            self.assertEqual([call.result(timeout=6) for call in calls], [{"id": 123}] * 2)

        self.assertEqual([record.levelname for record in logs.records], ["WARNING"])
        self.assertEqual(self.get.call_count, 4)
        self.assertEqual(
            [call.kwargs["data"]["grant_type"] for call in self.post.call_args_list],
            ["password", "refresh_token"],
        )

    def test_profile_does_not_retry_a_503_after_401_replay(self):
        self.zwift.ensure_valid_token()
        self.post.return_value = response(200, b'{"access_token":"new-token","expires_in":300}')
        self.get.side_effect = [response(401), response(503)]

        with self.assertRaises(HTTPError) as failure:
            self.zwift.get_profile("123")

        self.assertEqual(failure.exception.response.status_code, 503)
        self.assertEqual(self.get.call_count, 2)
        self.assertEqual(self.post.call_count, 2)

    def test_profile_stops_when_401_recovery_enters_cooldown(self):
        self.zwift.ensure_valid_token()
        self.post.side_effect = [response(429)]
        self.get.return_value = response(401)

        with self.assertLogs("ZwiftAPI", "ERROR"), self.assertRaises(ZwiftAuthError) as failure:
            self.zwift.get_profile("123")

        self.assertEqual(failure.exception.retry_after, AUTH_RETRY_INITIAL)
        self.get.assert_called_once()
        self.assertEqual(self.post.call_count, 2)

    def test_roster_pagination_uses_refreshed_token_for_later_pages(self):
        self.zwift.ensure_valid_token()
        self.post.side_effect = [response(200, b'{"access_token":"new-token","expires_in":300}')]
        self.get.side_effect = [response(401), response(200, b'[{"id": 123}]'), response(200, b'[]')]

        self.assertEqual(self.zwift.get_club_roster("42", limit=1), [{"id": 123}])
        self.assertEqual(
            [call.kwargs["headers"]["Authorization"] for call in self.get.call_args_list],
            ["Bearer test-token", "Bearer new-token", "Bearer new-token"],
        )

    def test_other_endpoint_still_retries_and_raises_not_found(self):
        self.get.return_value = response(404)

        with self.assertRaises(HTTPError) as error:
            self.zwift.get_club_roster("123")

        self.assertEqual(error.exception.response.status_code, 404)
        self.assertEqual(self.get.call_count, 5)
