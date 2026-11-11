import logging
import time
from typing import Any, Dict, List, Optional

import backoff
import requests
from requests.exceptions import RequestException

from zwift_inspect import event_dump, flag_tag, number_or_none, physics_from_tags, steering_from_tags, tag_value, world_label

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('ZwiftAPI')

RELAY = "https://us-or-rly101.zwift.com"
GAME_DICTIONARY_URL = "https://www.zwift.com/zwift-web-pages/gamedictionaryextended"

# Game-dictionary world name -> Zwift mapId. Used when a route change has to
# keep the event on the route's world and a valid start paddock.
WORLD_NAME_TO_ID = {
    "WATOPIA": 1,
    "RICHMOND": 2,
    "LONDON": 3,
    "NEWYORK": 4,
    "INNSBRUCK": 5,
    "BOLOGNA": 6,
    "YORKSHIRE": 7,
    "CRIT_CITY": 8,
    "MAKURI_ISLANDS": 9,
    "FRANCE": 10,
    "PARIS": 11,
    "SCOTLAND": 13,
}
ID_TO_WORLD_NAME = {world_id: name for name, world_id in WORLD_NAME_TO_ID.items()}

# Tags that grant an in-game unlock. Exact name, or one of these prefixes.
UNLOCK_TAGS = {"jerseyunlock"}
UNLOCK_PREFIXES = (
    "completionprize",
    "head_gear=",
    "socks=",
    "running_shirts=",
)

# completionprize1=<id> grants the kit on finish. jerseyHash is separate and
# is not set by these presets.
DZR_KITS = (
    {"id": "2025", "label": "DZR 2025 kit", "tag": "completionprize1=1381648520"},
    {"id": "old", "label": "Older DZR kit", "tag": "completionprize1=3709517096"},
)


class ZwiftError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


def is_unlock_tag(tag: str) -> bool:
    if tag in UNLOCK_TAGS:
        return True
    return tag.startswith(UNLOCK_PREFIXES)


def split_tags(tags: Optional[list]) -> tuple:
    """Unlock tags first, then every other tag, each in its original order."""
    unlocks: List[str] = []
    rest: List[str] = []
    for tag in tags or []:
        text = str(tag)
        if is_unlock_tag(text):
            if text not in unlocks:
                unlocks.append(text)
        else:
            rest.append(text)
    return unlocks, rest


def merge_tags(existing: Optional[list], extra: List[str]) -> List[str]:
    """Append tags that are not already present, keeping the current order."""
    merged = [str(tag) for tag in (existing or [])]
    for tag in extra:
        if tag not in merged:
            merged.append(tag)
    return merged


class ZwiftAPI:
    def __init__(self, username, password, client_id='Zwift Game Client'):
        self.username = username
        self.password = password
        self.client_id = client_id
        self.host = 'https://secure.zwift.com'
        self.token_url = f'{self.host}/auth/realms/zwift/protocol/openid-connect/token'
        self.auth_token = None
        self.refresh_token = None
        self.token_expiry_time = 0
    
    def authenticate(self):
        data = {
            'client_id': self.client_id,
            'grant_type': 'password',
            'username': self.username,
            'password': self.password
        }
        response = requests.post(self.token_url, data=data)
        if response.status_code == 200:
            self.auth_token = response.json()
            logger.info("Authenticated successfully.")
            logger.debug(f"Access token payload: {self.auth_token}")
        else:
            raise Exception(f"Authentication failed: {response.text}")

        expires_in = self.auth_token['expires_in']
        self.refresh_token = self.auth_token['refresh_token']
        logger.info(f"Token will expire in {expires_in} seconds.")
        # Calculate token expiry time (with 60-second buffer)
        self.token_expiry_time = time.time() + expires_in - 60
        
    def refresh_auth_token(self):
        logger.info("Refreshing auth token...")
        data = {
            'client_id': self.client_id,
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token
        }
        response = requests.post(self.token_url, data=data)
        if response.status_code == 200:
            self.auth_token = response.json()
            logger.info("Token refreshed successfully.")
            # Update refresh token and expiry time when present
            self.refresh_token = self.auth_token.get('refresh_token', self.refresh_token)
            self.token_expiry_time = time.time() + self.auth_token.get('expires_in', 60) - 60
        else:
            logger.error(f"Token refresh failed: {response.text}")
            # If refresh fails, try to authenticate again
            logger.info("Attempting to re-authenticate...")
            self.authenticate()
    
    def ensure_valid_token(self):
        """Ensure the token is valid, refresh if needed."""
        if not self.is_authenticated():
            logger.info("Not authenticated. Authenticating now.")
            self.authenticate()
        elif time.time() >= self.token_expiry_time:
            logger.info("Token expired or about to expire. Refreshing...")
            self.refresh_auth_token()
    
    def is_authenticated(self):
        return self.auth_token is not None and 'access_token' in self.auth_token
    
    def fetch_json_with_retry(self, url, headers, params):
        """Fetch JSON data with retries and tolerant parsing.
        - Ensures Accept/User-Agent headers are present
        - Handles 204/empty body
        - Validates content-type before parsing JSON
        """
        req_headers = dict(headers or {})
        req_headers.setdefault('Accept', 'application/json, text/plain, */*')
        req_headers.setdefault('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')

        @backoff.on_exception(backoff.expo, (RequestException, ValueError), max_tries=5)
        def _fetch():
            response = requests.get(url, headers=req_headers, params=params, timeout=20)
            response.raise_for_status()

            # Handle no content / empty body
            if response.status_code == 204 or not response.content or not response.text.strip():
                return None

            content_type = (response.headers.get('Content-Type') or '').lower()
            text = response.text.strip()

            # Prefer JSON when content-type indicates JSON or payload looks like JSON
            if 'application/json' in content_type or text.startswith('{') or text.startswith('['):
                return response.json()

            # If not JSON, raise a descriptive error so caller can adjust
            snippet = text[:200]
            raise ValueError(f"Expected JSON but got Content-Type='{content_type}'. Body starts with: {snippet}")

        return _fetch()
            
    def get_profile(self, id):
        if not self.is_authenticated():
            raise Exception("Not authenticated. Please authenticate first.")
        
        headers = {
            'Authorization': f"Bearer {self.auth_token['access_token']}"
        }
  
        # Avoid double slash and use tolerant fetcher
        url = f'https://us-or-rly101.zwift.com/api/profiles/{id}'
        try:
            data = self.fetch_json_with_retry(url, headers=headers, params=None)
            return data or {}
        except requests.HTTPError as e:
            if getattr(e, 'response', None) is not None and e.response.status_code == 404:
                return None
            raise

    def get_club_roster(
        self,
        club_id: str,
        limit: int = 100,
        start: int = 0,
        paginate: bool = True,
        max_pages: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Fetch club roster (members) for a given club.

        Endpoint pattern:
          /api/clubs/club/{club_id}/roster?limit=100

        Some Zwift deployments paginate with `start`; some ignore it. We handle both.
        """
        if not self.is_authenticated():
            raise Exception("Not authenticated. Please authenticate first.")

        headers = {
            "Authorization": f"Bearer {self.auth_token['access_token']}",
            "Accept": "application/json",
        }

        url = f"https://us-or-rly101.zwift.com/api/clubs/club/{club_id}/roster"

        all_rows: List[Dict[str, Any]] = []
        cur_start = int(start)
        pages = 0

        while True:
            params: Dict[str, Any] = {"limit": int(limit)}
            if cur_start:
                params["start"] = cur_start

            data = self.fetch_json_with_retry(url, headers=headers, params=params)

            # Response shape can be a list or a wrapper dict depending on backend version.
            if isinstance(data, list):
                rows = data
            elif isinstance(data, dict):
                rows = (
                    data.get("roster")
                    or data.get("members")
                    or data.get("items")
                    or data.get("results")
                    or []
                )
            else:
                rows = []

            if rows:
                all_rows.extend(rows)

            pages += 1

            if not paginate:
                break

            # Stop when we get fewer than `limit` back (or no rows).
            if not rows or len(rows) < int(limit):
                break

            if pages >= int(max_pages):
                break

            cur_start += len(rows)

            # Be nice to the API.
            time.sleep(0.5)

        return all_rows

    @staticmethod
    def simplify_club_roster(roster: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Convert raw club roster entries into a minimal structure.

        Output fields:
          - firstName
          - lastName
          - gender
          - countryCode
          - profileId              (from membership.profileId, falls back to id)
          - createdOn              (top-level createdOn)
          - membershipCreatedOn    (membership.createdOn)
        """
        out: List[Dict[str, Any]] = []
        for m in roster or []:
            membership = (m or {}).get("membership") or {}
            out.append(
                {
                    "firstName": (m or {}).get("firstName"),
                    "lastName": (m or {}).get("lastName"),
                    "gender": (m or {}).get("gender"),
                    "countryCode": (m or {}).get("countryCode"),
                    "profileId": membership.get("profileId") or (m or {}).get("id"),
                    "createdOn": (m or {}).get("createdOn"),
                    "membershipCreatedOn": membership.get("createdOn"),
                }
            )
        return out

    def _event_headers(self) -> Dict[str, str]:
        self.ensure_valid_token()
        return {
            "Authorization": f"Bearer {self.auth_token['access_token']}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://www.zwift.com/",
            "Origin": "https://www.zwift.com",
        }

    def get_event(self, event_id: int):
        """Return (eventTemplateId, eventData) from the organizer events-core document."""
        self.ensure_valid_token()
        url = f"{RELAY}/api/events-core/events/{int(event_id)}"
        headers = {
            "Authorization": f"Bearer {self.auth_token['access_token']}",
            "Accept": "application/json",
        }
        try:
            payload = self.fetch_json_with_retry(
                url, headers=headers, params={"skipDefaults": "true"}
            )
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            body = exc.response.text if exc.response is not None else ""
            raise ZwiftError(
                f"Failed to fetch event {event_id}: {status}. Body: {body}",
                status_code=status,
            ) from exc
        if not isinstance(payload, dict):
            raise ZwiftError(f"Unexpected event payload for {event_id}")
        template_id = payload.get("eventTemplateId")
        event = payload["eventData"] if "eventData" in payload else payload
        if not isinstance(event, dict):
            raise ZwiftError(f"Unexpected event payload for {event_id}")
        if template_id is None:
            template_id = event.get("eventTemplateId")
        return template_id, event

    def save_event(self, event_id: int, event: dict, event_template_id=None) -> None:
        """PUT the events-core document. Success is an empty 200 body."""
        if event_template_id is None:
            event_template_id = event.get("eventTemplateId")
        payload = {
            "eventTemplateId": event_template_id,
            "eventData": event,
        }
        url = f"{RELAY}/api/events-core/events/{int(event_id)}"
        response = requests.put(
            url,
            headers=self._event_headers(),
            params={"skipDefaults": "true"},
            json=payload,
            timeout=30,
        )
        if not response.ok:
            raise ZwiftError(
                f"Failed to update event {event_id}: "
                f"{response.status_code} {response.reason}. Body: {response.text}",
                status_code=response.status_code,
            )

    def _load_game_dictionary(self) -> dict:
        """Public game dictionary, refreshed once a day. A failed refresh keeps the last copy."""
        cached = getattr(ZwiftAPI, "_game_dict_cache", None)
        cached_at = getattr(ZwiftAPI, "_game_dict_cached_at", 0)
        if cached is not None and time.time() - cached_at < 24 * 60 * 60:
            return cached
        try:
            response = requests.get(
                GAME_DICTIONARY_URL,
                headers={"Accept": "application/json", "Source": "zwift-web"},
                timeout=20,
            )
            response.raise_for_status()
            data = response.json()
        except (requests.RequestException, ValueError):
            if cached is not None:
                return cached
            raise
        if not isinstance(data, dict) or "ROUTES" not in data:
            if cached is not None:
                return cached
            raise ZwiftError("Game dictionary unavailable")
        ZwiftAPI._game_dict_cache = data
        ZwiftAPI._game_dict_cached_at = time.time()
        return data

    def get_route_metadata(self, route_id: int) -> Optional[dict]:
        """Route dict from the public game dictionary, or None."""
        try:
            routes = self._load_game_dictionary().get("ROUTES", {}).get("ROUTE", [])
        except (requests.RequestException, ValueError) as exc:
            logger.warning("Game dictionary unavailable: %s", exc)
            return None
        wanted = int(route_id)
        for route in routes:
            signature = route.get("signature") or route.get("routeSignature")
            if signature is None:
                continue
            try:
                if int(signature) == wanted:
                    return route
            except (TypeError, ValueError):
                continue
        return None

    @staticmethod
    def _route_name(route_meta: Optional[dict]) -> Optional[str]:
        if not route_meta:
            return None
        for key in ("name", "routeName", "displayName"):
            value = route_meta.get(key)
            if value:
                return str(value)
        return None

    @staticmethod
    def _world_name(map_id) -> Optional[str]:
        try:
            return ID_TO_WORLD_NAME.get(int(map_id))
        except (TypeError, ValueError):
            return None

    def _describe_course(self, source: dict, fallback_world_id=None) -> Dict[str, Any]:
        route_id = source.get("routeId")
        route_meta = None
        if route_id is not None:
            try:
                route_meta = self.get_route_metadata(int(route_id))
            except (TypeError, ValueError):
                route_meta = None
        map_id = source.get("mapId")
        # worldId is the world. mapId is often the same number after a route
        # edit, but an untouched event can have them differ.
        world_id = source.get("worldId")
        if world_id is None:
            world_id = fallback_world_id
        route = route_meta or {}
        return {
            "routeId": route_id,
            "routeName": self._route_name(route_meta),
            "routeMap": route.get("map"),
            "routeWorld": world_label(route.get("map")),
            "routeDistanceInMeters": number_or_none(route.get("distanceInMeters")),
            "routeAscentInMeters": number_or_none(route.get("ascentInMeters")),
            "leadInDistanceInMeters": number_or_none(route.get("leadinDistanceInMeters")),
            "leadInAscentInMeters": number_or_none(route.get("leadinAscentInMeters")),
            "mapId": map_id,
            "worldId": source.get("worldId"),
            "world": self._world_name(world_id) or self._world_name(map_id),
            "laps": source.get("laps"),
            "distanceInMeters": source.get("distanceInMeters"),
            "durationInSeconds": source.get("durationInSeconds"),
        }

    def _item_name(self, section: str, item_key: str, signature) -> Optional[str]:
        """Name of one game-dictionary item, matched on its signature."""
        try:
            wanted = int(signature)
        except (TypeError, ValueError):
            return None
        try:
            items = self._load_game_dictionary().get(section, {}).get(item_key, [])
        except (requests.RequestException, ValueError, ZwiftError) as exc:
            logger.warning("Game dictionary unavailable: %s", exc)
            return None
        for item in items or []:
            try:
                if int(item.get("signature")) == wanted:
                    name = item.get("name")
                    return str(name) if name else None
            except (TypeError, ValueError, AttributeError):
                continue
        return None

    def _named_unlocks(self, tags: List[str]) -> List[dict]:
        named = []
        for tag in tags:
            name = None
            if "=" in tag:
                name = self._item_name("JERSEYS", "JERSEY", tag.split("=", 1)[1])
            named.append({"tag": tag, "name": name})
        return named

    def _equipment(self, tags, bike_hash) -> Dict[str, Any]:
        """Bike, wheels, and the steering flag Zwift stores on the event tags."""
        front = tag_value(tags, "fwheel_override")
        rear = tag_value(tags, "rwheel_override")
        return {
            "bikeName": self._item_name("BIKEFRAMES", "BIKEFRAME", bike_hash),
            "frontWheelHash": front,
            "frontWheelName": self._item_name("BIKEFRONTWHEELS", "BIKEFRONTWHEEL", front),
            "rearWheelHash": rear,
            "rearWheelName": self._item_name("BIKEREARWHEELS", "BIKEREARWHEEL", rear),
            "upgradePhysicsDisabled": flag_tag(tags, "disable_bike_upgrade_physics"),
            "physics": physics_from_tags(tags),
            "steering": steering_from_tags(tags),
            "brakingDisabled": flag_tag(tags, "nobraking"),
        }

    def _inspect_subgroup(self, subgroup: dict, fallback_world_id) -> Dict[str, Any]:
        tags = [str(tag) for tag in (subgroup.get("tags") or [])]
        unlocks, other_tags = split_tags(tags)
        return {
            "id": subgroup.get("id"),
            "name": subgroup.get("name"),
            "label": subgroup.get("subgroupLabel"),
            "eventStart": subgroup.get("eventSubgroupStart"),
            "registrationStart": subgroup.get("registrationStart"),
            "registrationEnd": subgroup.get("registrationEnd"),
            "lineUpStart": subgroup.get("lineUpStart"),
            "lineUpEnd": subgroup.get("lineUpEnd"),
            "startLocation": subgroup.get("startLocation"),
            "lateJoinInMinutes": subgroup.get("lateJoinInMinutes"),
            "rangeAccessLabel": subgroup.get("rangeAccessLabel"),
            "rulesId": subgroup.get("rulesId"),
            "rules": list(subgroup.get("rulesSet") or []),
            "signedUpCount": subgroup.get("totalSignedUpCount"),
            "joinedCount": subgroup.get("totalJoinedCount"),
            "entrantCount": subgroup.get("totalEntrantCount"),
            "jerseyHash": subgroup.get("jerseyHash"),
            "bikeHash": subgroup.get("bikeHash"),
            "unlockTags": unlocks,
            "unlocks": self._named_unlocks(unlocks),
            "tags": other_tags,
            **self._equipment(tags, subgroup.get("bikeHash")),
            **self._describe_course(subgroup, fallback_world_id),
        }

    def inspect_event(self, event_id: int) -> Dict[str, Any]:
        """Settings Zwift stores for one event, plus the event document. Reads only."""
        _template_id, event = self.get_event(event_id)
        tags = [str(tag) for tag in (event.get("tags") or [])]
        unlocks, other_tags = split_tags(tags)
        subgroups = [
            self._inspect_subgroup(subgroup, event.get("worldId"))
            for subgroup in event.get("eventSubgroups") or []
        ]
        return {
            "id": event.get("id") or int(event_id),
            "name": event.get("name"),
            "description": event.get("description") or "",
            "type": event.get("type") or event.get("eventType"),
            "sport": event.get("sport"),
            "eventStart": event.get("eventStart"),
            "imageUrl": event.get("imageUrl"),
            "rulesId": event.get("rulesId"),
            "rules": list(event.get("rulesSet") or []),
            "cullingType": event.get("cullingType"),
            "lateJoinInMinutes": event.get("lateJoinInMinutes"),
            "visible": event.get("visible"),
            "privateEvent": event.get("privateEvent"),
            "unlisted": event.get("unlisted"),
            "restricted": event.get("restricted"),
            "invisibleToNonParticipants": event.get("invisibleToNonParticipants"),
            "categoryEnforcement": event.get("categoryEnforcement"),
            "accessExpression": event.get("accessExpression"),
            "rangeAccessLabel": event.get("rangeAccessLabel"),
            "partnerClientId": event.get("partnerClientId"),
            "signedUpCount": event.get("totalSignedUpCount"),
            "joinedCount": event.get("totalJoinedCount"),
            "entrantCount": event.get("totalEntrantCount"),
            "jerseyHash": event.get("jerseyHash"),
            "bikeHash": event.get("bikeHash"),
            "unlockTags": unlocks,
            "unlocks": self._named_unlocks(unlocks),
            "tags": other_tags,
            "kitPresets": [dict(kit) for kit in DZR_KITS],
            "url": f"https://www.zwift.com/events/view/{int(event_id)}",
            "subgroups": subgroups,
            "raw": event_dump(event),
            **self._equipment(tags, event.get("bikeHash")),
            **self._describe_course(event),
        }

    def _update_event(self, event_id: int, mutate) -> Dict[str, Any]:
        template_id, event = self.get_event(event_id)
        mutate(event)
        self.save_event(event_id, event, template_id)
        # The first response after PUT can still show the previous tags.
        return self.inspect_event(event_id)

    def add_event_tags(self, event_id: int, tags: List[str]) -> Dict[str, Any]:
        """Add tags to the event and every subgroup. Existing tags stay."""
        clean: List[str] = []
        for tag in tags or []:
            text = str(tag).strip()
            if text and text not in clean:
                clean.append(text)
        if not clean:
            raise ValueError("At least one tag is required")

        def mutate(event: dict) -> None:
            event["tags"] = merge_tags(event.get("tags"), clean)
            for subgroup in event.get("eventSubgroups") or []:
                subgroup["tags"] = merge_tags(subgroup.get("tags"), clean)

        return self._update_event(event_id, mutate)

    def _assign_route(self, target: dict, route_id: int, paddock_index: int, set_start: bool) -> None:
        target["routeId"] = int(route_id)
        route_meta = self.get_route_metadata(int(route_id))
        if not route_meta:
            return
        world_id = WORLD_NAME_TO_ID.get(str(route_meta.get("map") or "").upper())
        if world_id is not None:
            target["mapId"] = world_id
        if not set_start:
            return
        paddocks_raw = str(route_meta.get("eventPaddocks") or "")
        paddocks = [int(part) for part in paddocks_raw.split(",") if part.strip()]
        if paddocks:
            target["startLocation"] = paddocks[int(paddock_index) % len(paddocks)]

    def update_event_course(
        self,
        event_id: int,
        new_route_id: Optional[int] = None,
        new_distance_meters: Optional[float] = None,
        new_laps: Optional[int] = None,
        subgroup_routes: Optional[List[dict]] = None,
    ) -> Dict[str, Any]:
        """Set the route and/or laps or distance on the event and its subgroups.

        One route updates every category. subgroup_routes sets a different route
        on each listed category. Laps and distance cannot both be set. Duration
        is not an input; choosing laps or distance clears the other length mode,
        including duration, which is how Zwift stores a single length mode.
        """
        if new_distance_meters is not None and new_laps is not None:
            raise ValueError("Specify only one of laps or distance")
        if subgroup_routes is not None and new_route_id is not None:
            raise ValueError("Specify one route for the event, or a route per category")
        category_routes: List[tuple] = []
        if subgroup_routes is not None:
            if not subgroup_routes:
                raise ValueError("Specify a route for at least one category")
            for item in subgroup_routes:
                try:
                    category_id = int(item.get("id"))
                    category_route_id = int(item.get("routeId"))
                except (TypeError, ValueError, AttributeError):
                    raise ValueError("Each category needs an id and a routeId")
                if category_id <= 0 or category_route_id <= 0:
                    raise ValueError("Category id and routeId must be greater than 0")
                category_routes.append((category_id, category_route_id))
        elif new_route_id is None and new_distance_meters is None and new_laps is None:
            raise ValueError("Specify a route, laps, or distance")
        if new_route_id is not None and int(new_route_id) <= 0:
            raise ValueError("routeId must be greater than 0")
        if new_laps is not None and int(new_laps) <= 0:
            raise ValueError("laps must be greater than 0")
        if new_distance_meters is not None and float(new_distance_meters) <= 0:
            raise ValueError("distance must be greater than 0")

        def apply_length(target: dict) -> None:
            if new_laps is not None:
                target["laps"] = int(new_laps)
                target["distanceInMeters"] = 0
                target["durationInSeconds"] = 0
            elif new_distance_meters is not None:
                target["laps"] = 0
                target["distanceInMeters"] = float(new_distance_meters)
                target["durationInSeconds"] = 0

        def mutate(event: dict) -> None:
            subgroups = event.get("eventSubgroups") or []
            if category_routes:
                known = {}
                for index, subgroup in enumerate(subgroups):
                    subgroup_id = subgroup.get("id")
                    if subgroup_id is not None:
                        known[int(subgroup_id)] = index
                for category_id, _route_id in category_routes:
                    if category_id not in known:
                        raise ValueError(f"Unknown category {category_id}")
                first_route = None
                for category_id, category_route_id in category_routes:
                    index = known[category_id]
                    self._assign_route(subgroups[index], category_route_id, index, True)
                    if first_route is None:
                        first_route = category_route_id
                if first_route is not None:
                    self._assign_route(event, first_route, 0, False)
            elif new_route_id is not None:
                self._assign_route(event, int(new_route_id), 0, False)
                for index, subgroup in enumerate(subgroups):
                    self._assign_route(subgroup, int(new_route_id), index, True)
            apply_length(event)
            for subgroup in subgroups:
                apply_length(subgroup)

        return self._update_event(event_id, mutate)

    def search_routes(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Match game-dictionary routes by name, or by an exact route id."""
        text = str(query or "").strip().lower()
        folded = text
        for mark in ("'", "’", "‘", "`"):
            folded = folded.replace(mark, "")
        if len(text) < 2 and not text.isdigit():
            return []
        try:
            routes = self._load_game_dictionary().get("ROUTES", {}).get("ROUTE", [])
        except (requests.RequestException, ValueError) as exc:
            raise ZwiftError(f"Game dictionary unavailable: {exc}") from exc
        matches: List[Dict[str, Any]] = []
        for route in routes:
            signature = route.get("signature") or route.get("routeSignature")
            name = self._route_name(route) or ""
            id_match = text.isdigit() and signature is not None and str(signature) == text
            folded_name = name.lower()
            for mark in ("'", "’", "‘", "`"):
                folded_name = folded_name.replace(mark, "")
            if not id_match and folded not in folded_name:
                continue
            map_name = route.get("map")
            try:
                route_id = int(signature)
            except (TypeError, ValueError):
                continue
            matches.append(
                {
                    "routeId": route_id,
                    "name": name,
                    "world": str(map_name) if map_name else None,
                }
            )
            if len(matches) >= int(limit):
                break
        return matches