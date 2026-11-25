import logging
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from flask import Flask, g
import sentry_sdk
from sentry_sdk.transport import Transport

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observability import DEFAULT_DSN, init_sentry, monitor_responses


class MemoryTransport(Transport):
    def __init__(self, options):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.type == "event":
                self.events.append(item.payload.json)


class ObservabilityTest(unittest.TestCase):
    def setUp(self):
        original_init = sentry_sdk.init
        with patch.dict(os.environ, {"SENTRY_DSN": "https://public@example.invalid/1"}), patch(
            "observability.sentry_sdk.init",
            side_effect=lambda **options: original_init(**options, transport=MemoryTransport),
        ):
            init_sentry()
        self.events = sentry_sdk.get_client().transport.events
        app = Flask(__name__)
        monitor_responses(app)

        @app.get("/handled/<identifier>")
        def handled(identifier):
            return {"error": "private response body"}, 503

        @app.get("/expected-unavailable")
        def expected_unavailable():
            g.skip_handled_failure_report = True
            return "temporarily unavailable", 503

        @app.get("/exception")
        def exception():
            raise ValueError("test exception")

        @app.get("/client-error")
        def client_error():
            return "bad request", 400

        self.client = app.test_client()

    def tearDown(self):
        sentry_sdk.get_client().close()

    def test_handled_failure_uses_route_template_without_response_body(self):
        self.assertEqual(self.client.get("/handled/123?secret=private-query", headers={"Authorization": "Bearer private-token"}).status_code, 503)
        self.assertEqual(len(self.events), 1)
        event = self.events[0]
        self.assertEqual(event["fingerprint"], ["handled-http-5xx", "GET", "/handled/<identifier>"])
        self.assertEqual(event["tags"]["service"], "api")
        self.assertNotIn("private response body", str(event))
        self.assertNotIn("private-query", str(event))
        self.assertNotIn("private-token", str(event))

    def test_unhandled_exception_is_not_reported_as_generic_5xx_too(self):
        self.assertEqual(self.client.get("/exception").status_code, 500)
        self.assertEqual(len(self.events), 1)
        self.assertEqual(self.events[0]["exception"]["values"][-1]["type"], "ValueError")

    def test_client_errors_are_not_reported(self):
        self.client.get("/client-error")
        self.assertEqual(self.events, [])

    def test_expected_unavailability_is_skipped_for_that_request_only(self):
        self.assertEqual(self.client.get("/expected-unavailable").status_code, 503)
        self.assertEqual(self.events, [])
        self.client.get("/handled/123")
        self.assertEqual(len(self.events), 1)

    def test_existing_python_error_logging_is_captured(self):
        logging.getLogger("dzr-test").error("test logged error")
        self.assertEqual(len(self.events), 1)
        self.assertEqual(self.events[0]["level"], "error")

    def test_zwift_auth_cooldown_reports_once_per_account_across_routes(self):
        with (
            patch("firebase_admin.initialize_app"),
            patch("firebase_admin.firestore.client"),
            patch("dotenv.load_dotenv"),
            patch("observability.init_sentry"),
        ):
            import main
        from zwift import AUTH_RETRY_INITIAL, ZwiftAPI

        default_client = ZwiftAPI("default-test", "test-password")
        organizer = ZwiftAPI("organizer-test", "test-password", account="organizer")
        db = Mock()
        queue = db.collection.return_value.document.return_value
        queue.get.return_value = Mock(exists=True, to_dict=lambda: {"pendingRiders": [{"riderId": 42}]})
        rejection = Mock(status_code=401, text="private upstream response")
        initial_token = Mock(status_code=200, json=lambda: {
            "access_token": "initial", "refresh_token": "refresh", "expires_in": 300,
        })
        renewed_token = Mock(status_code=200, json=lambda: {"access_token": "renewed", "expires_in": 300})
        with (
            patch.object(main, "zwift_api", default_client),
            patch.object(main, "organizer_zwift_api", organizer),
            patch.object(main, "CONTENT_API_KEY", "test-content-key"),
            patch.object(main, "ZWIFT_CLUB_ID", "123"),
            patch.object(main.firebase, "db", db),
            patch.object(main, "_fix_due_fifty_results", organizer.ensure_valid_token),
            patch("zwift.time.monotonic", return_value=1000),
            patch("zwift.requests.post", side_effect=[initial_token, renewed_token, rejection]),
            patch("zwift.requests.get", side_effect=[rejection, rejection]),
        ):
            client = main.app.test_client()
            headers = {"Authorization": "Bearer test-content-key"}
            for method, path in [
                ("GET", "/zwift_profile/42"),
                ("POST", "/api/zwift/club/roster/refresh"),
                ("POST", "/api/process_rider_queue"),
                ("GET", "/api/zwift/events/42"),
                ("POST", "/api/zwiftpower/results/fix-due"),
            ]:
                with self.subTest(path=path):
                    response = client.open(path, method=method, headers=headers, json={})
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json["code"], "zwift_auth_unavailable")
                    self.assertEqual(response.headers["Retry-After"], str(AUTH_RETRY_INITIAL))
                    self.assertNotIn("private upstream response", response.get_data(as_text=True))

        queue.update.assert_not_called()
        self.assertEqual([event["logger"] for event in self.events], ["ZwiftAPI", "ZwiftAPI"])
        self.assertNotIn("private upstream response", str(self.events))

    def test_missing_dsn_disables_delivery(self):
        sentry_sdk.get_client().close()
        with patch.dict(os.environ, {"SENTRY_DSN": ""}):
            init_sentry()
        self.assertIsNone(sentry_sdk.get_client().transport)

    def test_default_dsn_is_only_used_in_production_and_can_be_disabled(self):
        for env, expected_dsn, expected_environment in [
            ({}, "", "development"),
            ({"K_SERVICE": "dzr-api"}, DEFAULT_DSN, "production"),
            ({"SENTRY_ENVIRONMENT": "production"}, DEFAULT_DSN, "production"),
            ({"K_SERVICE": "dzr-api", "SENTRY_DSN": ""}, "", "production"),
            ({"SENTRY_DSN": "https://override@example.invalid/1"}, "https://override@example.invalid/1", "development"),
        ]:
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True), patch("observability.sentry_sdk.init") as init:
                init_sentry()
                self.assertEqual(init.call_args.kwargs["dsn"], expected_dsn)
                self.assertEqual(init.call_args.kwargs["environment"], expected_environment)
