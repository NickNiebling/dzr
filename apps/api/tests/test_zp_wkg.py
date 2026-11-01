"""Run from apps/api: python -m unittest tests.test_zp_wkg -v."""

import unittest

from zwiftpower import merge_result_edits

ALREADY = "A,1,1:00:00,0,Ada,111,DZR"
NEW = "B,2,1:01:00,0,Bo,222,DZR"


class MergeResultEditsTest(unittest.TestCase):
    def test_new_riders_are_appended_after_riders_already_moved(self):
        pasted = merge_result_edits(ALREADY, [{"zwid": "222", "line": NEW}])
        self.assertEqual(pasted.splitlines(), [ALREADY, NEW])

    def test_a_rider_moved_earlier_is_not_replaced(self):
        again = "C,1,1:00:00,0,Ada,111,DZR"
        pasted = merge_result_edits(ALREADY, [{"zwid": "111", "line": again}, {"zwid": "222", "line": NEW}])
        self.assertEqual(pasted.splitlines(), [ALREADY, NEW])

    def test_a_rider_still_listed_as_wkg_can_be_corrected(self):
        still = "WKG,1,1:00:00,0,Ada,111,DZR"
        pasted = merge_result_edits(still, [{"zwid": "111", "line": ALREADY}])
        self.assertEqual(pasted, ALREADY)

    def test_the_first_run_is_only_the_new_lines(self):
        pasted = merge_result_edits("", [{"zwid": "222", "line": NEW}])
        self.assertEqual(pasted, NEW)


if __name__ == "__main__":
    unittest.main()
