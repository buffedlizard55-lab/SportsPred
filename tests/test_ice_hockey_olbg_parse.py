"""Tests for scripts/lib/ice_hockey_olbg_parse.py."""

import os
import sys
import unittest
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from lib.ice_hockey_olbg_parse import (  # noqa: E402
    INDEX_URL,
    parse_event_page_markets,
    parse_index,
    resolve_date,
    split_fixture,
)

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "olbg_ice_hockey_index.RECONSTRUCTED.html")
NOW = datetime(2026, 9, 2, 22, 30)


def html():
    with open(FIXTURE, encoding="utf-8") as fh:
        return fh.read()


class TestFixtureSplit(unittest.TestCase):
    def test_splits_on_vs(self):
        self.assertEqual(split_fixture("Davos vs SCL Tigers"), ("Davos", "SCL Tigers"))

    def test_rejects_a_label_with_no_separator(self):
        self.assertIsNone(split_fixture("Davos SCL Tigers"))

    def test_rejects_empty_sides(self):
        self.assertIsNone(split_fixture(" vs Sport"))


class TestDateResolution(unittest.TestCase):
    def test_today_and_tomorrow(self):
        self.assertEqual(resolve_date("", "Today 19:00", NOW)["resolved_date"], "2026-09-02")
        self.assertEqual(resolve_date("", "Tomorrow 19:00", NOW)["resolved_date"], "2026-09-03")

    def test_day_month_label_resolves_against_the_current_year(self):
        info = resolve_date("", "04 Sept 09:30", NOW)
        self.assertEqual(info["resolved_date"], "2026-09-04")
        self.assertEqual(info["time"], "09:30")
        self.assertFalse(info["date_inferred_year"])

    def test_a_month_already_passed_rolls_to_next_year_and_is_flagged(self):
        info = resolve_date("", "15 Jan 19:00", NOW)
        self.assertEqual(info["resolved_date"], "2027-01-15")
        self.assertTrue(info["date_inferred_year"])

    def test_an_unrecognised_label_is_reported_not_guessed(self):
        info = resolve_date("", "whenever", NOW)
        self.assertIsNone(info["resolved_date"])
        self.assertIsNotNone(info["parse_error"])


class TestIndexParse(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_index(html(), now=NOW)

    def test_all_three_verified_events_are_parsed(self):
        ids = [e["event_id"] for e in self.parsed["events"]]
        self.assertEqual(ids, ["198599", "198658", "198655"])

    def test_fixture_names_and_leagues_are_read_from_the_page(self):
        first = self.parsed["events"][0]
        self.assertEqual(first["home"], "Davos")
        self.assertEqual(first["away"], "SCL Tigers")
        self.assertEqual(first["league"], "Switzerland NLA")
        self.assertEqual(first["resolved_date"], "2026-09-15")

    def test_each_row_keeps_the_url_it_was_read_from(self):
        for ev in self.parsed["events"]:
            self.assertIn("event_id=", ev["url"])
            self.assertTrue(ev["url"].startswith("https://www.olbg.com/betting-tips/Ice_Hockey/"))

    def test_tip_counts_are_parsed_as_printed(self):
        self.assertEqual(self.parsed["events"][0]["tips_for"], 3)
        self.assertEqual(self.parsed["events"][0]["tips_total"], 3)
        self.assertEqual(self.parsed["events"][0]["tip_pct"], 100)
        self.assertEqual(self.parsed["events"][1]["tips_total"], 1)

    def test_the_index_publishes_no_price_so_no_price_is_produced(self):
        for ev in self.parsed["events"]:
            self.assertIsNone(ev["odds"])

    def test_the_consensus_market_label_is_recorded(self):
        self.assertEqual(self.parsed["markets_seen"], ["Money Line"])
        self.assertEqual(self.parsed["events"][0]["market"], "Money Line")

    def test_index_url_points_at_the_real_ice_hockey_sport_id(self):
        self.assertEqual(INDEX_URL, "https://www.olbg.com/betting-tips/Ice_Hockey/13")


class TestEventPageParse(unittest.TestCase):
    def test_only_printed_markets_are_reported(self):
        page = "<html><body><h2>Money Line</h2><p>Davos 3/3</p></body></html>"
        out = parse_event_page_markets(page)
        self.assertEqual(out["markets_printed"], ["Money Line"])
        self.assertIsNone(out["prices"])

    def test_no_markets_printed_means_no_markets_invented(self):
        self.assertEqual(parse_event_page_markets("<html><body>nothing</body></html>")["markets_printed"], [])


if __name__ == "__main__":
    unittest.main()
