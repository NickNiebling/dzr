"""Read-only access to ladder.cycleracing.club for the Discord bot.

The ladder has no API, so the club account signs in with the normal sign-in form and the bot asks this
service for individual pages. The password therefore stays here and never reaches the bot.
"""
import logging
import os
import re
import threading

import requests

LADDER_BASE = "https://ladder.cycleracing.club"

# Only these pages can be fetched, so /ladder_page cannot be used as an open proxy.
ALLOWED_PATH = re.compile(
    r"/(summary|team/n/[1-9][0-9]*|profile/[1-9][0-9]*|matchlist/fixtures/[^/?#]+|fixture/\d+|rSignups/\d+)"
)
_FIXTURE_PATH = re.compile(r"^/fixture/(\d+)$")

_SIGN_IN_FORM = re.compile(r'<form[^>]+id="signin"', re.I)


class LadderError(Exception):
    pass


def is_allowed_path(path: str) -> bool:
    return bool(ALLOWED_PATH.fullmatch(path or "")) and ".." not in path


def _is_sign_in_page(body: str) -> bool:
    return bool(_SIGN_IN_FORM.search(body))


def _is_refreshing_page(body: str) -> bool:
    # A fixture that has not been refreshed for a day is this spinner. It has no start time until
    # something POSTs /fixture/{id}/doRefresh, which the page itself does from the browser.
    return "Refreshing Signups" in (body or "")


class LadderClient:
    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; DZRBot/1.0)"})
        self.logged_in = False
        self._lock = threading.Lock()

    def login(self):
        if not self.email or not self.password:
            raise LadderError("Ladder credentials are not configured")
        self.session.cookies.clear()
        # The form only works with the session cookie issued when the form itself is fetched.
        self.session.get(f"{LADDER_BASE}/signin", timeout=20)
        res = self.session.post(
            f"{LADDER_BASE}/signin",
            data={"email": self.email, "password": self.password, "returnTo": "/summary", "service": "clubladder"},
            timeout=20,
        )
        if res.status_code >= 400 or _is_sign_in_page(res.text):
            raise LadderError("Ladder login failed")
        self.logged_in = True

    def _get(self, path: str) -> requests.Response:
        return self.session.get(f"{LADDER_BASE}{path}", timeout=30)

    def _finish_signup_refresh(self, path: str) -> None:
        match = _FIXTURE_PATH.fullmatch(path)
        if not match:
            return
        logging.info(f"Ladder fixture {path} was waiting on a signup refresh")
        self.session.post(f"{LADDER_BASE}/fixture/{match.group(1)}/doRefresh", timeout=60)

    def get_page(self, path: str):
        """Returns (body, content_type) for an allow-listed ladder page, signing in again when the session has expired."""
        if not is_allowed_path(path):
            raise ValueError("Path not allowed")
        with self._lock:
            if not self.logged_in:
                self.login()
            res = self._get(path)
            if _is_sign_in_page(res.text):
                self.login()
                res = self._get(path)
                if _is_sign_in_page(res.text):
                    raise LadderError("Ladder session rejected after login")
            # The site interposes an optional "link Discord" page; /discord/skip is its own bypass.
            if "Discord Verification Required" in res.text:
                self.session.get(f"{LADDER_BASE}/discord/skip", timeout=20)
                res = self._get(path)
            if _is_refreshing_page(res.text):
                self._finish_signup_refresh(path)
                res = self._get(path)
            res.raise_for_status()
            return res.text, res.headers.get("Content-Type", "text/html")


_client = None


def get_client() -> LadderClient:
    global _client
    if _client is None:
        # The club's Zwift account is the one registered on the ladder; LADDER_* overrides it when needed.
        email = os.getenv("LADDER_EMAIL") or os.getenv("ZWIFT_USERNAME")
        password = os.getenv("LADDER_PASSWORD") or os.getenv("ZWIFT_PASSWORD")
        _client = LadderClient(email, password)
    return _client
