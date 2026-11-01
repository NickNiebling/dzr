"""Run from apps/api: python -m unittest tests.test_zp_primes -v."""

import unittest

from zwiftpower import _match_primes

LIBRARY = [
    "London Fox Hill", "London Box Hill", "London Keith Hill", "London Leith Hill",
    "Fuego Flats Long", "Fuego Flats Short", "Titans Grove Forward", "Titans Grove Reverse",
    "Watopia KOM Forward", "Watopia KOM Reverse", "Watopia Epic KOM Forward", "Watopia Epic KOM Reverse",
    "Volcano Climb", "Volcano Circuit Forward", "Volcano Circuit Reverse",
    "Aqueduc KOM", "Aqueduc KOM Rev", "Ballon Sprint", "Ballon Sprint Rev",
    "Pave Sprint", "Pave Sprint Rev", "Marina Sprint", "Marina Sprint Rev",
    "NY Climb Forward", "NY Climb Reverse", "NY Sprint", "Richmond Sprint", "Richmond Sprint 2",
    "Itza KOM", "Jarvis KOM", "Jarvis KOM Reverse", "Jarvis Sprint",
    "Mayan Mountainside KOM", "Woodland Sprint Reverse", "Shisa Sprint Reverse",
    "Sgurr Summit North", "Country Sprint", "Petit KOM", "Montmartre KOM",
    "Watopia Sprint Forward", "Acropolis Sprint Reverse",
]


def options(names):
    return {name.casefold(): {"name": name, "id": str(index)} for index, name in enumerate(names)}


def matched(names, query):
    row = _match_primes(options(names), [{"name": query, "laps": "1"}], "-1000")["sprints"][0]
    return row["segment"] if row["matched"] else ""


class PrimeNameMatchTest(unittest.TestCase):
    def test_official_names_find_the_zwiftpower_segment(self):
        expected = {
            "Fox Hill": "London Fox Hill",
            "Box Hill": "London Box Hill",
            "Fuego Flats": "Fuego Flats Short",
            "Fuego Flats Rev.": "Fuego Flats Long",
            "Fuego Flats Long": "Fuego Flats Long",
            "Titans Grove KOM": "Titans Grove Forward",
            "Titans Grove KOM Rev.": "Titans Grove Reverse",
            "Titans Groove KOM": "Titans Grove Forward",
            "Titans Groove KOM Reverse": "Titans Grove Reverse",
            "Zwift KOM": "Watopia KOM Forward",
            "Zwift KOM Reverse": "Watopia KOM Reverse",
            "Epic KOM": "Watopia Epic KOM Forward",
            "Volcano KOM": "Volcano Climb",
            "Volcano Circuit Reverse": "Volcano Circuit Reverse",
            "Aqueduc KOM Reverse": "Aqueduc KOM Rev",
            "Ballon Sprint Reverse": "Ballon Sprint Rev",
            "Pavé Sprint": "Pave Sprint",
            "Marina Sprint Reverse": "Marina Sprint Rev",
            "New York KOM Reverse": "NY Climb Reverse",
            "NY KOM": "NY Climb Forward",
            "Broad St": "Richmond Sprint",
            "Itza KOM": "Itza KOM",
            "Jarvis KOM Reverse": "Jarvis KOM Reverse",
            "Jarvis KOM": "Jarvis KOM",
            "Woodland Sprint Reverse": "Woodland Sprint Reverse",
            "Watopia Sprint Forward": "Watopia Sprint Forward",
        }
        for query, segment in expected.items():
            self.assertEqual(matched(LIBRARY, query), segment, query)

    def test_a_name_zwiftpower_does_not_have_stays_unmatched(self):
        self.assertEqual(matched(LIBRARY, "JWB Sprint"), "")
        self.assertEqual(matched(LIBRARY, "Sunset Sprint Reverse"), "")

    def test_reverse_does_not_take_the_forward_segment(self):
        self.assertEqual(matched(LIBRARY, "Zwift KOM"), "Watopia KOM Forward")
        self.assertEqual(matched(LIBRARY, "Jarvis KOM"), "Jarvis KOM")


if __name__ == "__main__":
    unittest.main()
