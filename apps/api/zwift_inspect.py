"""Readable fields for one Zwift event. No network calls."""

import copy
import re
from typing import Dict, Optional

WORLD_LABELS = {
    "WATOPIA": "Watopia",
    "RICHMOND": "Richmond",
    "LONDON": "London",
    "NEWYORK": "New York",
    "INNSBRUCK": "Innsbruck",
    "BOLOGNA": "Bologna",
    "YORKSHIRE": "Yorkshire",
    "CRIT_CITY": "Crit City",
    "MAKURI_ISLANDS": "Makuri Islands",
    "FRANCE": "France",
    "PARIS": "Paris",
    "SCOTLAND": "Scotland",
}


def _folded_world(value) -> str:
    return re.sub(r"[^A-Z]", "", str(value or "").upper())


def world_label(code) -> Optional[str]:
    """Readable world name for a Zwift world id label or a route map name."""
    folded = _folded_world(code)
    if not folded:
        return None
    for key, label in WORLD_LABELS.items():
        if _folded_world(key) == folded:
            return label
    return str(code)


def steering_from_tags(tags) -> str:
    """Zwift writes steering_disabled only when steering is off. No tag means steering is on."""
    for tag in tags or []:
        if str(tag).strip().lower() == "steering_disabled":
            return "disabled"
    return "enabled"


def tag_value(tags, key: str):
    prefix = f"{key}="
    for tag in tags or []:
        text = str(tag).strip()
        if text.startswith(prefix):
            return text[len(prefix):]
    return None


def flag_tag(tags, key: str) -> bool:
    wanted = key.lower()
    return any(str(tag).strip().lower() == wanted for tag in tags or [])


def physics_from_tags(tags) -> Dict[str, Optional[str]]:
    return {
        "frameGrams": tag_value(tags, "bike_grams"),
        "frameCdaBias": tag_value(tags, "bike_cda_bias"),
        "frontWheelGrams": tag_value(tags, "front_wheel_grams"),
        "frontWheelCdaBias": tag_value(tags, "front_wheel_cda_bias"),
        "frontWheelCrr": tag_value(tags, "front_wheel_crr"),
        "rearWheelGrams": tag_value(tags, "rear_wheel_grams"),
        "rearWheelCdaBias": tag_value(tags, "rear_wheel_cda_bias"),
        "rearWheelCrr": tag_value(tags, "rear_wheel_crr"),
    }


_COMPLETION_PRIZE = re.compile(r"^completionprize(\d*)=(\d+)$", re.IGNORECASE)


def place_completion_prizes(tags) -> list:
    """Give each completion prize its own slot number.

    The event page shows completionprize1, then completionprize2, and so on.
    A second tag that reuses a number is kept by the API and left off the event.
    completionprize=<id>, with no number, takes the lowest free slot.
    """
    other = []
    slotted = {}
    pending = []
    seen = set()

    for tag in tags or []:
        text = str(tag).strip()
        if not text:
            continue
        match = _COMPLETION_PRIZE.match(text)
        if not match:
            other.append(text)
            continue
        number, item_id = match.group(1), match.group(2)
        if item_id in seen:
            continue
        seen.add(item_id)
        slot = int(number) if number else None
        if slot is not None and slot >= 1 and slot not in slotted:
            slotted[slot] = item_id
        else:
            pending.append(item_id)

    used = set(slotted)
    nxt = 1
    for item_id in pending:
        while nxt in used:
            nxt += 1
        slotted[nxt] = item_id
        used.add(nxt)
        nxt += 1

    prizes = [f"completionprize{slot}={slotted[slot]}" for slot in sorted(slotted)]
    return other + prizes


def number_or_none(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def event_dump(event: dict) -> dict:
    """A copy of Zwift's event document safe to show. The join secret stays out."""
    dumped = copy.deepcopy(event) if isinstance(event, dict) else {}
    dumped.pop("eventSecret", None)
    return dumped
