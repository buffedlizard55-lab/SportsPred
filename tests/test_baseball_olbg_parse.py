"""Tests for scripts/lib/baseball_olbg_parse.py."""

import os
import sys
import unittest
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from lib.baseball_olbg_parse import (  # noqa: E402
    INDEX_URL,
    parse_event_page_markets,
    parse_index,
    resolve_date,
    split_fixture,
)

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "olbg_baseball_index.RECONSTRUCTED.html")
NOW = datetime(2026, 9, 3, 18, 30)


def html():
    with open(FIXTURE, encoding="utf-8") as fh:
        return fh.read()


class TestFixtureSplit(unittest.TestCase):
    def test_splits_on_at_with_away_first(self):
        self.assertEqual(split_fixture("SF Giants @ PIT Pirates"), ("SF Giants", "PIT Pirates"))

    def test_rejects_a_label_with_no_separator(self):
        self.assertIsNone(split_fixture("SF Giants PIT Pirates"))

    def test_rejects_empty_sides(self):
        self.assertIsNone(split_fixture(" @ PIT Pirates"))


class TestDateResolution(unittest.TestCase):
    def test_today_and_tomorrow(self):
        self.assertEqual(resolve_date("", "Today 12:35", NOW)["resolved_date"], "2026-09-03")
        self.assertEqual(resolve_date("", "Tomorrow 13:10", NOW)["resolved_date"], "2026-09-04")

    def test_day_month_label_resolves_and_flags_a_passed_month(self):
        info = resolve_date("", "15 Sept 19:15", NOW)
        self.assertEqual(info["resolved_date"], "2026-09-15")
        self.assertFalse(info["date_inferred_year"])

    def test_an_unrecognised_label_is_reported_not_guessed(self):
        info = resolve_date("", "whenever", NOW)
        self.assertIsNone(info["resolved_date"])
        self.assertIsNotNone(info["parse_error"])


class TestParseIndex(unittest.TestCase):
    def test_parses_four_rows_with_away_home_and_tips(self):
        parsed = parse_index(html(), now=NOW)
        self.assertEqual(len(parsed["events"]), 4)
        ev = parsed["events"][0]
        self.assertEqual(ev["home"], "PIT Pirates")
        self.assertEqual(ev["away"], "SF Giants")
        self.assertEqual(ev["league"], "MLB")
        self.assertEqual(ev["market"], "Money Line")
        self.assertEqual(ev["tips_for"], 2)
        self.assertEqual(ev["tips_total"], 2)
        self.assertEqual(ev["tip_pct"], 100)
        self.assertEqual(ev["resolved_date"], "2026-09-03")

    def test_odds_are_never_produced(self):
        parsed = parse_index(html(), now=NOW)
        for ev in parsed["events"]:
            self.assertIsNone(ev["odds"])

    def test_every_event_carries_its_review_url(self):
        parsed = parse_index(html(), now=NOW)
        for ev in parsed["events"]:
            self.assertTrue(ev["url"].startswith("https://www.olbg.com/betting-tips/Baseball/"))
            self.assertIn(ev["event_id"], ev["url"])


class TestEventPageMarkets(unittest.TestCase):
    def test_records_only_printed_markets(self):
        page = "<div>Money Line</div><div>Run Line</div>"
        self.assertEqual(parse_event_page_markets(page)["markets_printed"], ["Money Line", "Run Line"])
        self.assertIsNone(parse_event_page_markets(page)["prices"])


if __name__ == "__main__":
    unittest.main()
