"""Tests for the OLBG snooker index/event parser.

The fixture mirrors the server-rendered structure of
https://www.olbg.com/betting-tips/Snooker/8 observed 2026-09-02: list-item
event blocks with the event anchor, a Today HH:MM kick-off label, the current
tip consensus ("Mark Joyce to win 4-2"), the market that selection belongs to
("Frame Betting") and the "0/5 Win Tips" count.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.lib.snooker_olbg_parse import (  # noqa: E402
    parse_index,
    parse_event_page_markets,
    parse_player_names,
    EVENT_RE,
)

INDEX_FIXTURE = """
<ul>
  <li>
    <a href="/betting-tips/Snooker/All_Snooker/All_Events/Pang_Junxu_v_Mark_Joyce/8?event_id=9573"><strong>Pang Junxu v Mark Joyce</strong></a>
    Today 17:15
    <a href="/betting-tips/Snooker/All_Snooker/All_Events/Pang_Junxu_v_Mark_Joyce/8?event_id=9573"><strong>Mark Joyce to win 4-2</strong></a>
    Frame Betting
    <strong>0/5 Win Tips</strong>
    0%
  </li>
  <li>
    <a href="/other/page">Not an event</a>
  </li>
</ul>
"""

EVENT_FIXTURE = """
<h1>Pang Junxu v Mark Joyce Tips</h1>
<h4>Win Match</h4>
<strong>Pang Junxu</strong> <strong>5/10 Win Tips</strong> 50%
<strong>Mark Joyce</strong> <strong>5/10 Win Tips</strong> 50%
<h4>Handicap Betting</h4>
<strong>Mark Joyce +1.50</strong> <strong>2/2 Win Tips</strong> 100%
<h4>Frame Betting</h4>
<strong>Pang Junxu to win 4-2</strong> <strong>1/4 Win Tips</strong> 25%
<strong>Mark Joyce to win 4-2</strong> <strong>0/4 Win Tips</strong> 0%
"""


class SnookerOlbgParseTests(unittest.TestCase):
    def test_event_regex(self):
        m = EVENT_RE.search(INDEX_FIXTURE)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(2), "9573")

    def test_parse_index_finds_event(self):
        events = parse_index(INDEX_FIXTURE)
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual(e["event_id"], "9573")
        self.assertIn("event_id=9573", e["url"])
        self.assertEqual(e["matchup"], "Pang Junxu v Mark Joyce")
        self.assertEqual(e["display_time"], "17:15")
        self.assertEqual(e["display_date_label"], "Today")
        self.assertEqual(e["consensus"]["selection"], "Mark Joyce")
        self.assertEqual(e["consensus"]["market"], "Frame Betting")
        self.assertEqual(e["consensus"]["market"], "Frame Betting")
        self.assertEqual(e["consensus"]["tips_for"], 0)
        self.assertEqual(e["consensus"]["tips_total"], 5)
        self.assertEqual(e["consensus"]["pct"], 0)

    def test_no_price_fields(self):
        for e in parse_index(INDEX_FIXTURE):
            blob = repr(e).lower()
            for banned in ("price", "decimal", "american odds"):
                self.assertNotIn(banned, blob)

    def test_event_page_markets(self):
        markets = parse_event_page_markets(EVENT_FIXTURE)
        names = [m["name"] for m in markets]
        self.assertEqual(names, ["Win Match", "Handicap Betting", "Frame Betting"])
        win = markets[0]["selections"]
        self.assertEqual({s["name"] for s in win}, {"Pang Junxu", "Mark Joyce"})
        self.assertEqual(win[0]["tips_for"], 5)
        frame = markets[2]["selections"]
        self.assertTrue(any(s["name"].startswith("Pang Junxu") for s in frame))
        self.assertTrue(any(s["name"].startswith("Mark Joyce") for s in frame))

    def test_player_names(self):
        self.assertEqual(parse_player_names(EVENT_FIXTURE), ["Pang Junxu", "Mark Joyce"])
        self.assertEqual(parse_player_names("<h1>No matchup</h1>"), [])


if __name__ == "__main__":
    unittest.main()
