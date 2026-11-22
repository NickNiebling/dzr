"""Run from apps/api: python -m unittest tests.test_zwift_prizes -v."""

import unittest

from zwift_inspect import place_completion_prizes


class CompletionPrizeSlotsTest(unittest.TestCase):
    def test_a_second_kit_gets_the_next_slot(self):
        tags = place_completion_prizes(
            [
                "timestamp=1",
                "completionprize1=1381648520",
                "completionprize=3709517096",
            ]
        )
        self.assertEqual(
            tags,
            [
                "timestamp=1",
                "completionprize1=1381648520",
                "completionprize2=3709517096",
            ],
        )

    def test_two_tags_in_slot_one_are_split(self):
        tags = place_completion_prizes(
            [
                "timestamp=1795009161290",
                "completionprize1=1381648520",
                "completionprize1=3709517096",
            ]
        )
        self.assertEqual(
            tags,
            [
                "timestamp=1795009161290",
                "completionprize1=1381648520",
                "completionprize2=3709517096",
            ],
        )

    def test_the_same_kit_is_not_added_twice(self):
        tags = place_completion_prizes(
            [
                "completionprize1=1381648520",
                "completionprize=1381648520",
                "completionprize2=1381648520",
            ]
        )
        self.assertEqual(tags, ["completionprize1=1381648520"])

    def test_other_tags_stay_in_place(self):
        tags = place_completion_prizes(["showplacements", "steering_disabled"])
        self.assertEqual(tags, ["showplacements", "steering_disabled"])
