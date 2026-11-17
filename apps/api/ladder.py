"""Read-only access to ladder.cycleracing.club for the Discord bot.

The ladder has no API, so the club account signs in with the normal sign-in form and the bot asks this
service for individual pages. The password therefore stays here and never reaches the bot.
"""
import logging
import os
import re
import threading
from urllib.parse import urljoin, urlsplit

import requests

LADDER_BASE = "https://ladder.cycleracing.club"

# Only these pages can be fetched, so /ladder_page cannot be used as an open proxy.
ALLOWED_PATH = re.compile(
    r"/(summary|team/n/[1-9][0-9]*|profile/[1-9][0-9]*|matchlist/fixtures/[^/?#]+|fixture/\d+|rSignups/\d+)"
)
_FIXTURE_PATH = re.compile(r"^/fixture/(\d+)$")

_SIGN_IN_FORM = re.compile(r'<form[^>]+id="signin"', re.I)


_ERROR_MESSAGES = {
    "ladder_credentials_missing": "Ladder credentials are not configured",
    "ladder_login_failed": "Ladder login failed",
    "ladder_session_rejected": "Ladder session rejected after login",
    "ladder_upstream_timeout": "Ladder request timed out",
    "ladder_upstream_unavailable": "Ladder request failed",
    "ladder_error": "Ladder page could not be fetched",
}


def diagnostic_path(url: str, *, base=None):
    """Keep known page paths, never arbitrary redirect paths, queries or URL credentials."""
    try:
        path = urlsplit(urljoin(base, url or "") if base else url or "").path
    except ValueError:
        return None
    if path in ("/signin", "/summary", "/detect", "/dashboard", "/discord/skip", "/set-viewport"):
        return path
    if re.fullmatch(r"/(?:team/n|profile|fixture|rSignups)/[1-9][0-9]*(?:/doRefresh)?", path):
        return path
    if path.startswith("/matchlist/fixtures/"):
        return "/matchlist/fixtures/{team}"
    return None


class LadderError(Exception):
    def __init__(self, code: str, *, phase: str, response=None):
        self.code = code if code in _ERROR_MESSAGES else "ladder_error"
        super().__init__(_ERROR_MESSAGES[self.code])
        self.context = {"code": self.code, "phase": phase}
        if response is not None:
            # Keep the start of the redirect flow and always include the final response.
            # Requests normally caps redirects too; this separately bounds telemetry size.
            chain = [*response.history[:7], response]
            self.context.update({
                "upstream_status": response.status_code,
                "final_path": diagnostic_path(response.url),
                "signin_detected": _is_sign_in_page(response.text),
                "redirect_chain": [{
                    "status": hop.status_code,
                    "path": diagnostic_path(hop.url),
                    "location_path": diagnostic_path(hop.headers["Location"], base=hop.url) if hop.headers.get("Location") else None,
                } for hop in chain],
                "redirect_chain_truncated": len(response.history) > 7,
            })

    def payload(self):
        return {"error": str(self), "code": self.code}


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
        # A failed refresh must never leave the previous authenticated flag behind.
        self.logged_in = False
        if not self.email or not self.password:
            raise LadderError("ladder_credentials_missing", phase="credentials")
        self.session.cookies.clear()
        # The form only works with the session cookie issued when the form itself is fetched.
        self._request("get", "/signin", phase="login_form", timeout=20)
        res = self._request(
            "post", "/signin", phase="login_submit",
            data={"email": self.email, "password": self.password, "returnTo": "/summary", "service": "clubladder"},
            timeout=20,
        )
        if _is_sign_in_page(res.text):
            raise LadderError("ladder_login_failed", phase="login_submit", response=res)
        self.logged_in = True

    def _request(self, method, path, *, phase, timeout, check_status=True, **kwargs):
        try:
            res = getattr(self.session, method)(f"{LADDER_BASE}{path}", timeout=timeout, **kwargs)
        except requests.Timeout:
            raise LadderError("ladder_upstream_timeout", phase=phase) from None
        except requests.RequestException:
            raise LadderError("ladder_upstream_unavailable", phase=phase) from None
        if check_status:
            self._check_status(res, phase)
        return res

    @staticmethod
    def _check_status(res, phase):
        if res.status_code >= 400:
            code = "ladder_login_failed" if phase == "login_submit" and res.status_code in (400, 401, 403) else "ladder_upstream_unavailable"
            raise LadderError(code, phase=phase, response=res)

    def _get(self, path: str) -> requests.Response:
        # Sign-in HTML can accompany an error status; handle session expiry before the final status check.
        return self._request("get", path, phase="page", timeout=30, check_status=False)

    def _finish_signup_refresh(self, path: str) -> None:
        match = _FIXTURE_PATH.fullmatch(path)
        if not match:
            return
        logging.info(f"Ladder fixture {path} was waiting on a signup refresh")
        self._request("post", f"/fixture/{match.group(1)}/doRefresh", phase="signup_refresh", timeout=60, check_status=False)

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
                    self.logged_in = False
                    raise LadderError("ladder_session_rejected", phase="page_after_login", response=res)
            # The site interposes an optional "link Discord" page; /discord/skip is its own bypass.
            if "Discord Verification Required" in res.text:
                self._request("get", "/discord/skip", phase="discord_skip", timeout=20, check_status=False)
                res = self._get(path)
            if _is_refreshing_page(res.text):
                self._finish_signup_refresh(path)
                res = self._get(path)
            if _is_sign_in_page(res.text):
                self.logged_in = False
                raise LadderError("ladder_session_rejected", phase="page_after_refresh", response=res)
            self._check_status(res, "page")
            return res.text, res.headers.get("Content-Type", "text/html")


_client = None


def get_client() -> LadderClient:
    global _client
    if _client is None:
        # The club's Zwift account is the one registered on the ladder; LADDER_* overrides it when needed.
        email, password = os.getenv("LADDER_EMAIL"), os.getenv("LADDER_PASSWORD")
        # Selecting an override selects the whole pair, so two different accounts cannot be mixed.
        if not email and not password:
            email, password = os.getenv("ZWIFT_USERNAME"), os.getenv("ZWIFT_PASSWORD")
        if not email or not password:
            raise LadderError("ladder_credentials_missing", phase="credentials")
        _client = LadderClient(email, password)
    return _client
