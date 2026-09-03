"""Tests for the OLBG darts index/event parser.

The fixture mirrors the server-rendered structure of
https://www.olbg.com/betting-tips/Darts/15 observed 2026-09-03: list-item
event blocks with the event anchor, a date/time label, the current tip
consensus (outright "Luke Littler" Win Tournament) and the "2/2 Win Tips"
count. No prices appear.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.lib.darts_olbg_parse import (  # noqa: E402
    parse_index,
    parse_event_page_markets,
    parse_player_names,
    EVENT_RE,
)

INDEX_FIXTURE = """
<ul>
  <li>
    <a href="/betting-tips/Darts/All_Darts/All_Events/World_Series_of_Darts_Finals/15?event_id=31293"><strong>World Series of Darts Finals</strong></a>
    17 Sept 13:15
    <a href="/betting-tips/Darts/All_Darts/All_Events/World_Series_of_Darts_Finals/15?event_id=31293"><strong>Luke Littler</strong></a>
    Win Tournament
    <strong>2/2 Win Tips</strong>
    100%
  </li>
  <li>
    <a href="/betting-tips/Darts/All_Darts/All_Events/PDC_World_Darts_Championship/15?event_id=26023"><strong>PDC World Darts Championship</strong></a>
    <a href="/betting-tips/Darts/All_Darts/All_Events/PDC_World_Darts_Championship/15?event_id=26023"><strong>Michael van Gerwen</strong></a>
    Win Tournament
    <strong>2/34 Win Tips</strong>
    6%
  </li>
  <li>
    <a href="/other/page">Not an event</a>
  </li>
</ul>
"""

MATCH_FIXTURE = """
<ul>
  <li>
    <a href="/betting-tips/Darts/All_Darts/All_Events/Ross_Smith_v_Gary_Anderson/15?event_id=9999"><strong>Ross Smith v Gary Anderson</strong></a>
    Today 19:00
    <a href="/betting-tips/Darts/All_Darts/All_Events/Ross_Smith_v_Gary_Anderson/15?event_id=9999"><strong>Ross Smith to win 8-2</strong></a>
    Win Match
    <strong>3/4 Win Tips</strong>
    75%
  </li>
</ul>
"""

EVENT_FIXTURE = """
<h1>Ross Smith v Gary Anderson Tips</h1>
<h4>Win Match</h4>
<strong>Ross Smith</strong> <strong>3/4 Win Tips</strong> 75%
<strong>Gary Anderson</strong> <strong>1/4 Win Tips</strong> 25%
<h4>Most 180s</h4>
<strong>Ross Smith</strong> <strong>2/2 Win Tips</strong> 100%
"""


class DartsOlbgParseTests(unittest.TestCase):
    def test_event_regex(self):
        m = EVENT_RE.search(INDEX_FIXTURE)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(2), "31293")

    def test_parse_index_finds_outrights(self):
        events = parse_index(INDEX_FIXTURE)
        self.assertEqual(len(events), 2)
        e = events[0]
        self.assertEqual(e["event_id"], "31293")
        self.assertIn("event_id=31293", e["url"])
        self.assertEqual(e["matchup"], "World Series of Darts Finals")
        self.assertEqual(e["type"], "outright")
        self.assertEqual(e["display_time"], "13:15")
        self.assertEqual(e["consensus"]["selection"], "Luke Littler")
        self.assertEqual(e["consensus"]["market"], "Win Tournament")
        self.assertEqual(e["consensus"]["tips_for"], 2)
        self.assertEqual(e["consensus"]["tips_total"], 2)
        self.assertEqual(e["consensus"]["pct"], 100)

    def test_parse_index_match_event(self):
        events = parse_index(MATCH_FIXTURE)
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual(e["type"], "match")
        self.assertEqual(e["matchup"], "Ross Smith v Gary Anderson")
        self.assertEqual(e["consensus"]["selection"], "Ross Smith")

    def test_no_price_fields(self):
        for e in parse_index(INDEX_FIXTURE) + parse_index(MATCH_FIXTURE):
            blob = repr(e).lower()
            for banned in ("price", "decimal", "american odds"):
                self.assertNotIn(banned, blob)

    def test_event_page_markets(self):
        markets = parse_event_page_markets(EVENT_FIXTURE)
        names = [m["name"] for m in markets]
        self.assertIn("Win Match", names)
        win = next(m for m in markets if m["name"] == "Win Match")["selections"]
        self.assertTrue(any(s["name"].startswith("Ross Smith") for s in win))

    def test_player_names(self):
        self.assertEqual(parse_player_names(EVENT_FIXTURE), ["Ross Smith", "Gary Anderson"])
        self.assertEqual(parse_player_names("<h1>No matchup</h1>"), [])


if __name__ == "__main__":
    unittest.main()
