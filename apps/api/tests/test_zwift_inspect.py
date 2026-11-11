"""Run from apps/api: python -m unittest tests.test_zwift_inspect -v."""

import unittest

from zwift_inspect import event_dump, physics_from_tags, steering_from_tags, world_label


class SteeringTagsTest(unittest.TestCase):
    def test_a_missing_tag_means_steering_is_enabled(self):
        self.assertEqual(steering_from_tags([]), "enabled")
        self.assertEqual(steering_from_tags(["showplacements", "no_flagging"]), "enabled")

    def test_steering_disabled_is_the_only_off_switch(self):
        self.assertEqual(steering_from_tags(["steering_disabled"]), "disabled")
        self.assertEqual(steering_from_tags(["  Steering_Disabled  "]), "disabled")


class InspectHelpersTest(unittest.TestCase):
    def test_physics_tags_keep_their_numbers(self):
        tags = ["bike_grams=1970", "front_wheel_crr=0.006", "showplacements"]
        self.assertEqual(physics_from_tags(tags)["frameGrams"], "1970")
        self.assertEqual(physics_from_tags(tags)["frontWheelCrr"], "0.006")
        self.assertIsNone(physics_from_tags(tags)["rearWheelGrams"])

    def test_the_join_secret_is_left_out_of_the_dump(self):
        dumped = event_dump({"id": 1, "eventSecret": "abc", "name": "Race", "eventSubgroups": [{"id": 2}]})
        self.assertNotIn("eventSecret", dumped)
        self.assertEqual(dumped["name"], "Race")
        self.assertEqual(dumped["eventSubgroups"], [{"id": 2}])
        self.assertNotIn("eventSecret", event_dump({"eventSecret": "abc"}))

    def test_route_map_names_become_world_labels(self):
        self.assertEqual(world_label("MAKURIISLANDS"), "Makuri Islands")
        self.assertEqual(world_label("WATOPIA"), "Watopia")
        self.assertIsNone(world_label(None))
