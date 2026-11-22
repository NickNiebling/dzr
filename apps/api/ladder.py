"""Read-only access to ladder.cycleracing.club for the Discord bot.

The ladder has no API, so the club account's browser session (LADDER_SESSION) is used, with the normal sign-in
form as fallback, and the bot asks this service for individual pages. The credentials therefore stay here and never
reach the bot.
"""
import logging
import os
import re
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone
from math import ceil
from urllib.parse import urlsplit

import requests

LADDER_BASE = "https://ladder.cycleracing.club"
LADDER_HOST = "ladder.cycleracing.club"
SESSION_COOKIE = "connect.sid"
AUTH_RETRY_INITIAL = 300
AUTH_RETRY_MAX = 3600
RENEWAL_WINDOW = 7 * 24 * 60 * 60
RENEWAL_INSTRUCTIONS = (
    "Forny klubbens Ladder-session manuelt, og opdater `LADDER_SESSION` "
    "og `LADDER_SESSION_EXPIRES_AT` på Cloud Run."
)

# Only these pages can be fetched, so /ladder_page cannot be used as an open proxy.
ALLOWED_PATH = re.compile(
    r"/(summary|team/n/[1-9][0-9]*|profile/[1-9][0-9]*|matchlist/fixtures/[^/?#]+|fixture/\d+|rSignups/\d+)"
)
_FIXTURE_PATH = re.compile(r"^/fixture/(\d+)$")

_SIGN_IN_FORM = re.compile(r'<form[^>]+id="signin"', re.I)


class LadderAuthError(Exception):
    def __init__(self, message: str, retry_after: int = 0, *, definitive: bool = True):
        super().__init__(message)
        self.retry_after = retry_after
        self.definitive = definitive


def is_allowed_path(path: str) -> bool:
    return bool(ALLOWED_PATH.fullmatch(path or "")) and ".." not in path


def _require_authenticated_page(response: requests.Response) -> None:
    if response.status_code == 401:
        raise LadderAuthError("Ladder rejected the session")
    response.raise_for_status()
    if urlsplit(response.url).path.rstrip("/") == "/signin" or _SIGN_IN_FORM.search(response.text):
        raise LadderAuthError("Ladder returned the sign-in page")


def _is_refreshing_page(body: str) -> bool:
    # A fixture that has not been refreshed for a day is this spinner. It has no start time until
    # something POSTs /fixture/{id}/doRefresh, which the page itself does from the browser.
    return "Refreshing Signups" in (body or "")


class LadderClient:
    def __init__(
        self, email: str | None, password: str | None, session_cookie: str | None = None, *,
        session_expires_at: float | None = None, send_alert: Callable[[str], bool] | None = None,
    ):
        self.email = email
        self.password = password
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; DZRBot/1.0)"})
        self.logged_in = False
        self.using_session_cookie = False
        self._retry_at = 0.0
        self._retry_delay = AUTH_RETRY_INITIAL
        self._session_expires_at = session_expires_at
        self._send_alert = send_alert
        self._alert_after: dict[str, float] = {}
        self._lock = threading.Lock()
        if session_cookie:
            # A browser session works even when the site refuses the password sign-in for scripts.
            self.session.cookies.set(SESSION_COOKIE, session_cookie, domain=LADDER_HOST, path="/")
            self.logged_in = True
            self.using_session_cookie = True

    def login(self):
        if not self.email or not self.password:
            raise LadderAuthError("Ladder password credentials are not configured")
        self.session.cookies.clear()
        # The form only works with the session cookie issued when the form itself is fetched.
        try:
            self.session.get(f"{LADDER_BASE}/signin", timeout=20).raise_for_status()
            res = self.session.post(
                f"{LADDER_BASE}/signin",
                data={"email": self.email, "password": self.password, "returnTo": "/summary", "service": "clubladder"},
                timeout=20,
            )
            res.raise_for_status()
        except requests.RequestException as error:
            status = error.response.status_code if error.response is not None else None
            reason = f"HTTP {status}" if status is not None else type(error).__name__
            raise LadderAuthError(
                f"Ladder password sign-in request failed ({reason})", definitive=status in (401, 403),
            ) from error
        if _SIGN_IN_FORM.search(res.text):
            raise LadderAuthError("Ladder returned the sign-in form after password sign-in")
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
            retry_after = ceil(self._retry_at - time.monotonic())
            if retry_after > 0:
                raise LadderAuthError("Ladder sign-in is in cooldown", retry_after)
            if self.logged_in:
                try:
                    return self._read_page(path)
                except LadderAuthError:
                    self.logged_in = False
                    if self.using_session_cookie:
                        logging.warning("LADDER_SESSION was rejected and must be renewed")
                        self.using_session_cookie = False
                    else:
                        logging.warning("Ladder session expired; trying password sign-in")
            try:
                self.login()
                return self._read_page(path)
            except LadderAuthError as error:
                self.logged_in = False
                error.retry_after = self._retry_delay
                self._retry_at = time.monotonic() + self._retry_delay
                self._retry_delay = min(self._retry_delay * 2, AUTH_RETRY_MAX)
                logging.error("Ladder password sign-in failed: %s. Retrying in %d seconds", error, error.retry_after)
                if error.definitive:
                    self._notify_renewal("rejected", f"Ladder-adgang kan ikke gendannes med password. {RENEWAL_INSTRUCTIONS}")
                raise

    def _read_page(self, path: str):
        res = self._get(path)
        _require_authenticated_page(res)
        # The site interposes an optional "link Discord" page. It offers /discord/skip to continue.
        if "Discord Verification Required" in res.text:
            _require_authenticated_page(self.session.get(f"{LADDER_BASE}/discord/skip", timeout=20))
            res = self._get(path)
            _require_authenticated_page(res)
            if "Discord Verification Required" in res.text:
                raise LadderAuthError("Ladder still requires Discord verification after skipping")
        if _is_refreshing_page(res.text):
            self._finish_signup_refresh(path)
            res = self._get(path)
            _require_authenticated_page(res)
        self._retry_delay = AUTH_RETRY_INITIAL
        if self.using_session_cookie:
            self._check_session_expiry()
        return res.text, res.headers.get("Content-Type", "text/html")

    def _check_session_expiry(self):
        expires_at = next((
            cookie.expires for cookie in self.session.cookies
            if cookie.name == SESSION_COOKIE and cookie.domain.lstrip(".") == LADDER_HOST
            and cookie.path == "/" and cookie.expires is not None
        ), self._session_expires_at)
        if expires_at is not None and 0 < expires_at - time.time() < RENEWAL_WINDOW:
            self._notify_renewal("expiring", f"Ladder-sessionen udløber <t:{int(expires_at)}:R>. {RENEWAL_INSTRUCTIONS}")

    def _notify_renewal(self, reason: str, message: str):
        now = time.monotonic()
        if self._send_alert is None or now < self._alert_after.get(reason, 0):
            return
        # The configured cookie stays fixed for this process. Retry only failed deliveries.
        self._alert_after[reason] = now + AUTH_RETRY_INITIAL
        if self._send_alert(message):
            self._alert_after[reason] = float("inf")


def _session_expiry() -> float | None:
    value = os.getenv("LADDER_SESSION_EXPIRES_AT", "").strip()
    if value:
        try:
            expires_at = datetime.fromisoformat(value)
            return (expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)).timestamp()
        except ValueError:
            logging.warning("LADDER_SESSION_EXPIRES_AT must be an ISO 8601 date or timestamp")
    return None


_client = None
_client_lock = threading.Lock()


def get_client(send_alert: Callable[[str], bool] | None = None) -> LadderClient:
    global _client
    with _client_lock:
        if _client is None:
            # The club's Zwift account is the one registered on the ladder; LADDER_* overrides it when needed.
            email = os.getenv("LADDER_EMAIL") or os.getenv("ZWIFT_USERNAME")
            password = os.getenv("LADDER_PASSWORD") or os.getenv("ZWIFT_PASSWORD")
            session_cookie = (os.getenv("LADDER_SESSION") or "").strip().removeprefix(f"{SESSION_COOKIE}=")
            _client = LadderClient(
                email, password, session_cookie or None, session_expires_at=_session_expiry(), send_alert=send_alert,
            )
        return _client
