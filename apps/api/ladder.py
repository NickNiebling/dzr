"""Read-only access to ladder.cycleracing.club for the Discord bot.

The ladder has no API, so the club account signs in with the normal sign-in form and the bot asks this
service for individual pages. The password therefore stays here and never reaches the bot.
"""
import logging
import os
import re
import threading
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

import requests

LADDER_BASE = "https://ladder.cycleracing.club"

# Only these pages can be fetched, so /ladder_page cannot be used as an open proxy.
ALLOWED_PATH = re.compile(
    r"/(summary|team/n/[1-9][0-9]*|teamView/[^/?#\\]+|profile/[1-9][0-9]*|"
    r"matchlist/fixtures/[^/?#]+|fixture/\d+|rSignups/\d+)"
)
_FIXTURE_PATH = re.compile(r"^/fixture/(\d+)$")
_ACCESS_CHECK_PATH = "/team/n/82"


class LadderError(Exception):
    pass


def is_allowed_path(path: str) -> bool:
    if not isinstance(path, str) or not ALLOWED_PATH.fullmatch(path):
        return False
    # Decode once, as the upstream router does. Reject encoded separators, traversal, malformed
    # escapes and nested encoding rather than expanding the read proxy to other routes.
    if re.search(r"%(?![0-9a-fA-F]{2})", path):
        return False
    try:
        decoded = unquote(path, errors="strict")
    except UnicodeError:
        return False
    return (
        ".." not in decoded
        and decoded.count("/") == path.count("/")
        and not any(c in decoded for c in "\\?#")
        and not any(ord(c) < 32 or ord(c) == 127 for c in decoded)
        and not re.search(r"%[0-9a-fA-F]{2}", decoded)
    )


class _PageSignals(HTMLParser):
    """Inspect auth and protected-team markers without depending on HTML attribute quoting."""

    def __init__(self, body: str):
        super().__init__(convert_charrefs=True)
        self.sign_in = False
        self.roster = False
        self.logout = False
        self.feed(body or "")

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            action = urlsplit(attrs.get("action") or "").path.rstrip("/").lower()
            if (attrs.get("id") or "").lower() == "signin" or action in ("/signin", "/login", "signin", "login"):
                self.sign_in = True
        if tag == "input" and (attrs.get("type") or "").lower() == "password":
            self.sign_in = True
        if attrs.get("id") == "pane-roster":
            self.roster = True
        if tag == "a" and urlsplit(attrs.get("href") or "").path.rstrip("/") == "/logout":
            self.logout = True


def _is_sign_in_page(body: str) -> bool:
    return _PageSignals(body).sign_in


def _requires_login(res: requests.Response) -> bool:
    return _is_sign_in_page(res.text) or urlsplit(res.url or "").path.rstrip("/").lower() in ("/signin", "/login")


def _is_discord_gate(body: str) -> bool:
    return "discord verification required" in (body or "").lower()


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
        self.logged_in = False
        if not self.email or not self.password:
            missing = "email/username" if not self.email else "password"
            raise LadderError(f"Ladder credentials are not configured: missing {missing}")
        self.session.cookies.clear()
        # The form only works with the session cookie issued when the form itself is fetched.
        form = self.session.get(f"{LADDER_BASE}/signin", timeout=20)
        if form.status_code >= 400:
            raise LadderError(f"Ladder sign-in form failed (HTTP {form.status_code})")
        res = self.session.post(
            f"{LADDER_BASE}/signin",
            data={"email": self.email, "password": self.password, "returnTo": "/summary", "service": "clubladder"},
            timeout=20,
        )
        if res.status_code >= 400 or _requires_login(res):
            raise LadderError("Ladder login failed")
        # /summary is public and a successful POST alone does not prove the session is accepted.
        self.verify_access()
        self.logged_in = True

    def _skip_discord_gate(self, path: str, res: requests.Response) -> requests.Response:
        if _is_discord_gate(res.text):
            skipped = self.session.get(f"{LADDER_BASE}/discord/skip", timeout=20)
            skipped.raise_for_status()
            res = self._get(path)
        return res

    def verify_access(self) -> None:
        """Prove this session can read an authenticated team, not a public summary or login form."""
        res = self._skip_discord_gate(_ACCESS_CHECK_PATH, self._get(_ACCESS_CHECK_PATH))
        if _requires_login(res):
            raise LadderError("Ladder protected team still requires login after sign-in")
        if _is_discord_gate(res.text):
            raise LadderError("Ladder Discord verification still required after skip")
        if res.status_code != 200:
            raise LadderError(f"Ladder protected team access failed (HTTP {res.status_code})")
        target = urlsplit(res.url or "")
        signals = _PageSignals(res.text)
        is_team = bool(re.fullmatch(r"/team/n/[1-9][0-9]*|/teamView/[^/]+", target.path))
        if (
            target.scheme != "https"
            or target.netloc != urlsplit(LADDER_BASE).netloc
            or not is_team
            or not signals.roster
            or not signals.logout
            or not re.search(r"\b(?:const|let|var)\s+TEAMID\s*=\s*82\s*;", res.text)
        ):
            raise LadderError("Ladder protected team access could not be verified: expected team 82 roster and signed-in controls")

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
            if _requires_login(res):
                self.login()
                res = self._get(path)
            # The site interposes an optional "link Discord" page; /discord/skip is its own bypass.
            res = self._skip_discord_gate(path, res)
            if _is_refreshing_page(res.text):
                self._finish_signup_refresh(path)
                res = self._get(path)
            if _requires_login(res):
                self.logged_in = False
                raise LadderError("Ladder session rejected after login")
            if _is_discord_gate(res.text):
                self.logged_in = False
                raise LadderError("Ladder Discord verification still required after skip")
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


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Check Ladder access using the active session's environment variables.")
    parser.add_argument("--check-access", action="store_true", required=True)
    parser.parse_args()
    try:
        get_client().login()
    except (LadderError, requests.RequestException) as error:
        # No environment values, request payloads or cookies are written to output.
        message = str(error) if isinstance(error, LadderError) else f"Ladder network request failed ({type(error).__name__})"
        print(message, file=sys.stderr)
        sys.exit(1)
    print("Ladder access verified: protected team 82 roster is accessible with the active session credentials.")
