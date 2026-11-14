"""Run from apps/api: python -m unittest tests.test_ladder -v."""
import unittest

from ladder import is_allowed_path


class LadderPagePathsTest(unittest.TestCase):
    def test_team_pages_are_allowed_alongside_existing_read_paths(self):
        for path in (
            "/teamView/Chonky%20Chaser",
            "/teamView/A%20whole%20lot%20of%20Danes",
            "/matchlist/fixtures/Chonky%20Chaser",
            "/fixture/123",
            "/rSignups/456",
        ):
            with self.subTest(path=path):
                self.assertTrue(is_allowed_path(path))

    def test_other_routes_and_non_team_paths_are_rejected(self):
        for path in (
            "https://example.com/teamView/Test",
            "//example.com/teamView/Test",
            "/teamView/",
            "/teamView/Test/edit",
            "/teamView/../signin",
            "/teamView/Test?edit=true",
            "/teamView/Test#top",
            "/signin",
            "/fixture/123/doRefresh",
        ):
            with self.subTest(path=path):
                self.assertFalse(is_allowed_path(path))
