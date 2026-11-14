"""Run from apps/api: python -m unittest discover -s tests -p test_ladder.py."""
import unittest
import ladder


class LadderPathsTest(unittest.TestCase):
    def test_scout_adds_only_summary_team_and_profile_reads(self):
        for path in ("/summary", "/team/n/82", "/profile/123", "/fixture/123",
                     "/matchlist/fixtures/Example%20Team", "/rSignups/123"):
            with self.subTest(path=path):
                self.assertTrue(ladder.is_allowed_path(path))
        for path in ("/signin", "/team/n/0", "/team/n/abc", "/summary?all=1",
                     "/fixture/1/doRefresh", "/teamView/Example", "/profile/../signin",
                     "https://example.com/summary"):
            with self.subTest(path=path):
                self.assertFalse(ladder.is_allowed_path(path))
