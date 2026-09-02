"""Tests for the pure cricket OLBG parser, using a reconstructed fixture
built from a live fetch of https://www.olbg.com/betting-tips/Cricket/7 on
2026-09-01."""

import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.lib.cricket_olbg_parse import parse_index, resolve_date  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures",
                       "olbg_cricket_index.RECONSTRUCTED.html")
FETCH_TIME = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)


class CricketOlbgParseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE, encoding="utf-8") as f:
            cls.html = f.read()
        cls.matches, cls.outrights = parse_index(cls.html)

    def test_match_count(self):
        self.assertEqual(len(self.matches), 5)

    def test_outright_count(self):
        self.assertEqual(len(self.outrights), 2)

    def test_man_of_the_match_event(self):
        ev = next(m for m in self.matches if m["event_id"] == "188601")
        self.assertEqual(ev["home"], "Trinbago Knight Riders")
        self.assertEqual(ev["away"], "Antigua and Barbuda Falcons")
        self.assertEqual(ev["consensus"]["market"], "Man Of The Match")
        self.assertEqual(ev["consensus"]["selection"], "E Lewis")

    def test_odi_suffix_stripped_from_away(self):
        ev = next(m for m in self.matches if m["event_id"] == "188611")
        self.assertEqual(ev["home"], "England W")
        self.assertEqual(ev["away"], "Ireland W")
        self.assertEqual(ev["consensus"]["market"], "Win Match")

    def test_t20_big_bash_outright_parsed(self):
        ob = next(o for o in self.outrights if o["event_id"] == "187503")
        self.assertEqual(ob["name"], "T20 Big Bash 2026-27")

    def test_draw_no_bet_consensus(self):
        ev = next(m for m in self.matches if m["event_id"] == "188605")
        self.assertEqual(ev["consensus"]["market"], "Draw No Bet")
        self.assertEqual(ev["consensus"]["tips_for"], 1)
        self.assertEqual(ev["consensus"]["tips_total"], 2)
        self.assertEqual(ev["consensus"]["pct"], 50)

    def test_resolve_relative_dates(self):
        self.assertEqual(resolve_date("Today", FETCH_TIME)[0], "2026-09-01")
        self.assertEqual(resolve_date("Tomorrow", FETCH_TIME)[0], "2026-09-02")

    def test_resolve_dates_with_year(self):
        self.assertEqual(resolve_date("26 Nov 2027", FETCH_TIME)[0], "2027-11-26")
        self.assertEqual(resolve_date("05 Sept", FETCH_TIME)[0], "2026-09-05")
        # December without a year rolls to next year when it has passed.
        self.assertEqual(resolve_date("12 Dec", FETCH_TIME)[0], "2026-12-12")


if __name__ == "__main__":
    unittest.main()
