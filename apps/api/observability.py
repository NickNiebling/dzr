"""Central error reporting for Flask, logging, and handled HTTP 5xx responses."""
import os
import json
from pathlib import Path

import sentry_sdk
from flask import g, got_request_exception, request
from sentry_sdk.integrations.flask import FlaskIntegration


DEFAULT_DSN = json.loads(Path(__file__).with_name("constants.json").read_text(encoding="utf-8"))["sentry"]["dsn"]


def init_sentry():
    environment = os.getenv("SENTRY_ENVIRONMENT") or ("production" if os.getenv("K_SERVICE") else "development")
    dsn = os.getenv("SENTRY_DSN", DEFAULT_DSN if environment == "production" else "")
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        integrations=[FlaskIntegration()],
        data_collection={
            "user_info": False, "cookies": {"mode": "off"},
            "http_headers": {"request": {"mode": "off"}},
            "http_bodies": [], "url_query_params": {"mode": "off"}, "stack_frame_variables": False,
            "gen_ai": {"inputs": False, "outputs": False},
            "database_query_data": False, "queues": False,
        },
        max_breadcrumbs=0,
    )
    sentry_sdk.set_tag("service", "api")


def monitor_responses(app):
    # FlaskIntegration already captures exceptions; avoid a second generic event.
    @got_request_exception.connect_via(app)
    def mark_exception(sender, exception, **kwargs):
        g.sentry_exception_captured = True

    @app.after_request
    def capture_handled_failure(response):
        if response.status_code >= 500 and not getattr(g, "sentry_exception_captured", False):
            with sentry_sdk.new_scope() as scope:
                route = str(request.url_rule) if request.url_rule else "unmatched"
                scope.fingerprint = ["handled-http-5xx", request.method, route]
                scope.set_tag("http.status_code", response.status_code)
                sentry_sdk.capture_message(f"{request.method} {route} returned HTTP {response.status_code}", level="error")
        return response
