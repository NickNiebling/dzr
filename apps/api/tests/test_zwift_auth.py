import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from unittest.mock import Mock, patch

from requests import ConnectionError

from zwift import AUTH_RETRY_INITIAL, AUTH_RETRY_MAX, ZwiftAPI, ZwiftAuthError, ZwiftError


def token_response(access_token, refresh_token=None, *, expires_in=300):
    response = Mock(status_code=200)
    payload = {"access_token": access_token, "expires_in": expires_in}
    if refresh_token is not None:
        payload["refresh_token"] = refresh_token
    response.json.return_value = payload
    return response


class ObservedLock:
    """Tell the test when a second caller must wait on the real lock."""

    def __init__(self):
        self.lock = Lock()
        self.waiting = Event()

    def __enter__(self):
        if not self.lock.acquire(blocking=False):
            self.waiting.set()
            self.lock.acquire()

    def __exit__(self, *args):
        self.lock.release()


class ZwiftAuthTest(unittest.TestCase):
    def setUp(self):
        self.clock = self.enterContext(patch("zwift.time.monotonic", return_value=1000))
        self.post = self.enterContext(patch("zwift.requests.post"))
        self.client = ZwiftAPI("roster-user", "test-password", account="roster")

    def _overlapping_requests(self, response):
        requested = Event()
        finish = Event()
        lock = ObservedLock()

        def request_token(*args, **kwargs):
            requested.set()
            self.assertTrue(finish.wait(timeout=5), "token request was not released")
            return response

        self.post.side_effect = request_token
        with patch.object(self.client, "_auth_lock", lock), ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.client.ensure_valid_token)
            try:
                self.assertTrue(requested.wait(timeout=5), "first token request did not start")
                second = pool.submit(self.client.ensure_valid_token)
                self.assertTrue(lock.waiting.wait(timeout=5), "second caller did not wait for authentication")
                self.post.assert_called_once()
            finally:
                finish.set()
        self.post.side_effect = None
        return first, second

    def test_concurrent_requests_share_cold_login_and_expired_token_refresh(self):
        first, second = self._overlapping_requests(token_response("first-access", "first-refresh"))
        self.assertEqual([first.result(), second.result()], ["first-access"] * 2)
        self.post.assert_called_once()
        self.assertEqual(self.post.call_args.kwargs["data"]["grant_type"], "password")

        self.clock.return_value += 239
        self.assertEqual(self.client.ensure_valid_token(), "first-access")
        self.post.assert_called_once()

        self.clock.return_value += 1
        self.post.reset_mock()
        first, second = self._overlapping_requests(token_response("second-access", "second-refresh", expires_in=60))
        self.assertEqual([first.result(), second.result()], ["second-access"] * 2)
        self.post.assert_called_once()
        self.assertEqual(self.post.call_args.kwargs["data"]["grant_type"], "refresh_token")
        self.assertEqual(self.post.call_args.kwargs["data"]["refresh_token"], "first-refresh")

    def test_refresh_rejection_falls_back_and_refresh_retains_token_when_omitted(self):
        self.post.side_effect = [
            token_response("first-access", "first-refresh"),
            Mock(status_code=400, json=Mock(return_value={"error": "invalid_grant"})),
            token_response("second-access", "second-refresh"),
            token_response("third-access"),
            token_response("fourth-access", "fourth-refresh"),
        ]

        self.assertEqual(self.client.ensure_valid_token(), "first-access")
        self.clock.return_value += 240
        with self.assertLogs("ZwiftAPI", "WARNING") as logs:
            self.assertEqual(self.client.ensure_valid_token(), "second-access")
        self.assertEqual([record.levelname for record in logs.records], ["WARNING"])
        self.clock.return_value += 240
        self.assertEqual(self.client.ensure_valid_token(), "third-access")
        self.clock.return_value += 240
        self.assertEqual(self.client.ensure_valid_token(), "fourth-access")

        grants = [call.kwargs["data"] for call in self.post.call_args_list]
        self.assertEqual(
            [grant["grant_type"] for grant in grants],
            ["password", "refresh_token", "password", "refresh_token", "refresh_token"],
        )
        self.assertEqual(
            [grant["refresh_token"] for grant in grants if grant["grant_type"] == "refresh_token"],
            ["first-refresh", "second-refresh", "second-refresh"],
        )

    def test_refresh_failure_without_token_rejection_uses_cooldown(self):
        for status, error in (
            (429, "too_many_requests"),
            (503, "invalid_grant"),
            (401, "invalid_client"),
            (400, "invalid_request"),
        ):
            with self.subTest(status=status, error=error):
                client = ZwiftAPI("test-user", "test-password")
                self.post.reset_mock()
                self.post.side_effect = [
                    token_response("cached-access", "cached-refresh"),
                    Mock(status_code=status, json=Mock(return_value={"error": error})),
                ]
                self.assertEqual(client.ensure_valid_token(), "cached-access")
                self.clock.return_value += 240
                with self.assertLogs("ZwiftAPI", "ERROR") as logs, self.assertRaises(ZwiftAuthError) as failure:
                    client.ensure_valid_token()
                self.assertEqual(failure.exception.retry_after, AUTH_RETRY_INITIAL)
                self.assertIn(f"HTTP {status}", logs.output[0])
                self.assertEqual(
                    [call.kwargs["data"]["grant_type"] for call in self.post.call_args_list],
                    ["password", "refresh_token"],
                )

    def test_event_put_replays_once_with_refreshed_token(self):
        self.post.side_effect = [
            token_response("old-access", "old-refresh"),
            token_response("new-access", "new-refresh"),
        ]
        with patch("zwift.requests.put", side_effect=[
            Mock(status_code=401, ok=False),
            Mock(status_code=401, ok=False, reason="Unauthorized", text="rejected again"),
        ]) as put:
            with self.assertRaises(ZwiftAuthError) as failure:
                self.client.save_event(42, {"title": "Fixture"}, event_template_id=100)

        self.assertEqual(failure.exception.retry_after, AUTH_RETRY_INITIAL)
        self.assertEqual(self.post.call_count, 2)
        self.assertEqual(
            [call.kwargs["headers"]["Authorization"] for call in put.call_args_list],
            ["Bearer old-access", "Bearer new-access"],
        )
        self.assertEqual(put.call_args_list[0].kwargs["json"], put.call_args_list[1].kwargs["json"])

    def test_event_put_does_not_replay_a_server_error(self):
        self.post.return_value = token_response("access", "refresh")
        with patch("zwift.requests.put", return_value=Mock(status_code=503, ok=False)) as put:
            with self.assertRaises(ZwiftError) as failure:
                self.client.save_event(42, {"title": "Fixture"})

        self.assertEqual(failure.exception.status_code, 503)
        self.post.assert_called_once()
        put.assert_called_once()

    def test_failed_attempt_is_shared_and_other_account_can_still_authenticate(self):
        with self.assertLogs("ZwiftAPI", "ERROR") as logs:
            attempts = self._overlapping_requests(Mock(status_code=503))
            for attempt in attempts:
                with self.assertRaises(ZwiftAuthError) as failure:
                    attempt.result()
                self.assertEqual(failure.exception.retry_after, AUTH_RETRY_INITIAL)

            self.clock.return_value += 1
            with self.assertRaises(ZwiftAuthError) as paused:
                self.client.ensure_valid_token()
            self.assertEqual(paused.exception.retry_after, AUTH_RETRY_INITIAL - 1)
        self.assertEqual(len(logs.records), 1)
        self.assertIn("HTTP 503", logs.output[0])
        self.post.assert_called_once()

        organizer = ZwiftAPI("organizer-user", "test-password", account="organizer")
        self.post.return_value = token_response("organizer-access", "organizer-refresh")
        self.assertEqual(organizer.ensure_valid_token(), "organizer-access")
        self.assertEqual(self.post.call_args.kwargs["data"]["username"], "organizer-user")

        self.clock.return_value += AUTH_RETRY_INITIAL - 1
        self.post.return_value = token_response("roster-access", "roster-refresh")
        self.assertEqual(self.client.ensure_valid_token(), "roster-access")
        self.assertEqual(self.post.call_args.kwargs["data"]["username"], "roster-user")

    def test_cooldown_is_capped_and_resets_after_recovery(self):
        rejected = Mock(status_code=403)
        self.post.return_value = rejected
        delays = [AUTH_RETRY_INITIAL, 600, 1200, 2400, AUTH_RETRY_MAX, AUTH_RETRY_MAX]
        with self.assertLogs("ZwiftAPI", "ERROR") as logs:
            for attempt, delay in enumerate(delays, start=1):
                with self.assertRaises(ZwiftAuthError) as failure:
                    self.client.ensure_valid_token()
                self.assertEqual(failure.exception.retry_after, delay)
                self.assertEqual(self.post.call_count, attempt)
                self.clock.return_value += delay

            self.post.return_value = token_response("recovered", "recovered-refresh")
            self.assertEqual(self.client.ensure_valid_token(), "recovered")
            self.clock.return_value += 240
            self.post.return_value = rejected
            with self.assertRaises(ZwiftAuthError) as failure:
                self.client.ensure_valid_token()
            self.assertEqual(failure.exception.retry_after, AUTH_RETRY_INITIAL)
        self.assertEqual(len(logs.records), len(delays) + 1)

    def test_refresh_transport_failure_does_not_retry_or_expose_secrets(self):
        self.post.side_effect = [
            token_response("cached-access", "cached-refresh"),
            ConnectionError("fake sensitive request details"),
            token_response("recovered"),
        ]
        self.client.ensure_valid_token()
        self.clock.return_value += 240
        with self.assertLogs("ZwiftAPI", "ERROR") as logs:
            with self.assertRaises(ZwiftAuthError) as failure:
                self.client.ensure_valid_token()
        self.assertNotIn("fake sensitive", str(failure.exception))
        self.assertNotIn("fake sensitive", logs.output[0])
        self.assertEqual(self.post.call_count, 2)

        self.clock.return_value += AUTH_RETRY_INITIAL
        self.assertEqual(self.client.ensure_valid_token(), "recovered")
        self.assertEqual(self.post.call_args.kwargs["data"]["grant_type"], "refresh_token")
