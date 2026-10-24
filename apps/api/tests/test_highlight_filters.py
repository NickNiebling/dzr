"""Run from apps/api: python -m unittest discover -s tests -v."""

import os
import unittest
from datetime import datetime
from unittest.mock import Mock, patch

# Import the production code without initializing Firebase credentials or clients.
with patch("firebase_admin.initialize_app"), patch("firebase_admin.firestore.client"), patch("dotenv.load_dotenv"):
    import firebase
    import main

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
        self.cache = patch.object(main, "_verified_zwift_ids_cache", {}).start()
        self.clock = patch.object(main.time, "time", return_value=1000).start()
        patch.object(main, "VERIFIED_MEMBER_ROLE_ID", "verified").start()
        patch.dict(os.environ, {"DISCORD_GUILD_ID": "guild", "DISCORD_BOT_TOKEN": "unused"}).start()
        self.settings = patch.object(firebase, "get_document", return_value={
            "membership": {"clubMemberRoleId": "club"}
        }).start()
        self.users = patch.object(firebase, "get_collection", return_value=[
            {"discordId": "both", "zwiftId": "42"},
            {"discordId": "verified", "zwiftId": 43},
            {"discordId": "club", "zwiftId": "44"},
            {"discordId": "neither", "zwiftId": "45"},
            {"discordId": "unlinked"},
        ]).start()
        self.members = patch.object(main.DiscordAPI, "get_all_members", return_value=[
            {"discordID": "both", "role_ids": ["verified", "club"]},
            {"discordID": "verified", "role_ids": ["verified"]},
            {"discordID": "club", "role_ids": ["club"]},
            {"discordID": "neither", "role_ids": []},
            {"discordID": "unlinked", "role_ids": ["verified", "club"]},
        ]).start()
        self.commentator = patch.object(main, "ZwiftCommentator").start()
        self.commentator.return_value.generate_upgrade_comment.return_value = "Upgrade highlights"
        self.commentator.return_value.generate_commentary.return_value = "Weekly results"
        self.commentator.return_value.send_to_discord_api.return_value = {"success": True}

    def post(self, path):
        with patch.object(main, "require_api_or_401", return_value=None), patch.object(main, "datetime") as clock:
            clock.now.return_value = datetime(2026, 10, 24, 12)
            return main.app.test_client().post(path)

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

    def test_highlights_require_both_roles_and_a_linked_zwift_id(self):
        self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), {"42"})
        self.settings.assert_called_once_with("system_settings", "global")

    def test_cache_keeps_weekly_and_club_member_audiences_separate_in_both_orders(self):
        for order in [(False, True), (True, False)]:
            with self.subTest(order=order):
                self.cache.clear()
                self.members.reset_mock()
                for require_club in order * 2:
                    expected = {"42"} if require_club else {"42", "43"}
                    self.assertEqual(
                        main._get_verified_member_zwift_ids(require_club_membership=require_club), expected
                    )
                self.assertEqual(self.members.call_count, 2)

    def test_configured_club_role_change_takes_effect_before_the_cache_expires(self):
        self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), {"42"})
        self.settings.return_value = {"membership": {"clubMemberRoleId": "new-club"}}
        self.members.return_value[1]["role_ids"].append("new-club")
        self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), {"43"})
        self.assertEqual(self.members.call_count, 2)

    def test_missing_or_unavailable_club_settings_do_not_reuse_a_cached_audience(self):
        self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), {"42"})
        for settings in [None, {}, {"membership": {"clubMemberRoleId": " "}}]:
            with self.subTest(settings=settings), self.assertLogs(level="WARNING"):
                self.settings.return_value = settings
                self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), set())
        self.settings.side_effect = RuntimeError("Settings unavailable")
        with self.assertLogs(level="WARNING"):
            self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), set())

    def test_member_lookup_errors_select_no_riders(self):
        for lookup in [self.users, self.members]:
            with self.subTest(lookup=lookup):
                self.cache.clear()
                lookup.side_effect = RuntimeError("Lookup unavailable")
                self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), set())
                lookup.side_effect = None

    def test_role_changes_are_seen_on_forced_refresh_and_cache_expiry(self):
        self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), {"42"})
        roles = self.members.return_value[0]["role_ids"]
        roles.remove("club")
        self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), {"42"})
        self.assertEqual(main._get_verified_member_zwift_ids(True, require_club_membership=True), set())
        roles.append("club")
        self.clock.return_value += main.VERIFIED_ZWIFT_IDS_CACHE_TTL_SECONDS
        self.assertEqual(main._get_verified_member_zwift_ids(require_club_membership=True), {"42"})
        self.assertEqual(self.members.call_count, 3)

    def test_upgrade_endpoint_only_passes_eligible_riders_to_the_commentator(self):
        response = self.post("/generate_and_post_upgrades")
        self.assertEqual(response.status_code, 200)
        generate = self.commentator.return_value.generate_upgrade_comment
        generate.assert_called_once()
        for field in UPGRADE_FIELDS:
            self.assertEqual([row["riderId"] for row in generate.call_args.args[0][field]], [42])
        self.commentator.return_value.send_to_discord_api.assert_called_once()

    def test_upgrade_endpoint_skips_generation_and_posting_when_no_one_is_eligible(self):
        self.members.return_value = [{"discordID": "verified", "role_ids": ["verified"]}]
        response = self.post("/generate_and_post_upgrades")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["message"], "No upgrades today.")
        self.commentator.assert_not_called()

    def test_weekly_commentary_still_includes_verified_non_club_members(self):
        session = Mock()
        session.get.return_value.json.return_value = {"data": [{"zwid": i} for i in [42, 43, 44, 45]]}
        with patch.object(main, "get_authenticated_session", return_value=session), patch.object(
            ZwiftPower, "analyze_team_results", return_value={}
        ) as analyze:
            response = self.post("/generate_and_post_commentary/11939")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["zwid"] for row in analyze.call_args.args[0]["data"]], [42, 43])
        self.settings.assert_not_called()


if __name__ == "__main__":
    unittest.main()
