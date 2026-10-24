"""Run from apps/api: python -m unittest discover -s tests -v."""

import unittest
from unittest.mock import Mock, patch

# Import the production code without initializing Firebase credentials or clients.
with patch("firebase_admin.initialize_app"), patch("firebase_admin.firestore.client"):
    import firebase

from zwiftpower import ZwiftPower


UPGRADE_FIELDS = ("upgradedZPCategory", "upgradedZwiftRacingCategory", "upgradedZRSCategory")


def rider(rider_id, upgraded=False):
    return {
        "riderId": rider_id,
        "name": f"Rider {rider_id}",
        "zpCategory": "B" if upgraded else "C",
        "race": {"current": {"mixed": {"number": 7 if upgraded else 8}}},
        "racingScore": 600 if upgraded else 400,
    }


class HighlightFilterTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected HTTP request")).start()
        snapshots = {
            "2026-10-23": {"data": {"riders": [rider(42), rider("43")]}},
            "2026-10-24": {"data": {"riders": [rider("42", True), rider(43, True)]}},
        }
        db = patch.object(firebase, "db").start()
        db.collection.return_value.document.side_effect = lambda date: Mock(
            get=lambda: Mock(exists=True, to_dict=lambda: snapshots[date])
        )

    def test_upgrade_filter_distinguishes_unrestricted_empty_and_selected_riders(self):
        for allowed, expected in [(None, [42, 43]), (set(), []), ({"42"}, [42]), ({"99"}, [])]:
            with self.subTest(allowed=allowed):
                result = firebase.compare_rider_categories("261024", "261023", allowed_rider_ids=allowed)
                for field in UPGRADE_FIELDS:
                    self.assertEqual([row["riderId"] for row in result[field]], expected)

    def test_weekly_results_use_the_same_empty_allowlist_rule(self):
        zp = ZwiftPower("unused", "unused")
        zp.session = Mock()
        for allowed, expected in [(None, [42, "43"]), (set(), []), ({"42"}, [42]), ({"99"}, [])]:
            with self.subTest(allowed=allowed):
                zp.session.get.return_value.json.return_value = {"data": [{"zwid": 42}, {"zwid": "43"}]}
                result = zp.get_team_results(11939, allowed_zwids=allowed)
                self.assertEqual([row["zwid"] for row in result["data"]], expected)


if __name__ == "__main__":
    unittest.main()
