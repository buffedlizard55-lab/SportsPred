"""Tests for the OLBG greyhound index parser.

The fixture below is a hand-reconstructed, reduced snippet that mirrors the
server-rendered structure of https://www.olbg.com/betting-tips/Greyhounds/28
(observed 2026-09-02): list-item event blocks with an event anchor, the
most-tipped runner anchor and the "x/y Win Tips" consensus text.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.lib.greyhound_olbg_parse import parse_index, parse_event_block, EVENT_RE

FIXTURE = """
<ul>
  <li>
    <a href="/betting-tips/Greyhounds/All_Greyhounds/All_Events/8:47_Yarmouth/28?event_id=682293"><strong>8:47 Yarmouth</strong></a>
    Today 15:47
    <a href="/betting-tips/Greyhounds/All_Greyhounds/All_Events/8:47_Yarmouth/28?event_id=682293"><strong>Strathrannoch</strong></a>
    Daily Races
    <strong>2/2 Win Tips</strong>
    100%
  </li>
  <li>
    <a href="/betting-tips/Greyhounds/All_Greyhounds/All_Events/7:44_Romford/28?event_id=682274"><b>7:44 Romford</b></a>
    Today 14:44
    <a href="/betting-tips/Greyhounds/All_Greyhounds/All_Events/7:44_Romford/28?event_id=682274"><b>My Lil Bella</b></a>
    Daily Races
    <b>1/1 Win Tips</b>
  </li>
  <li>
    <a href="/other/page">Not an event</a>
  </li>
</ul>
"""


class GreyhoundOlbgParseTests(unittest.TestCase):
    def test_parse_index_finds_events(self):
        events = parse_index(FIXTURE)
        self.assertEqual(len(events), 2)
        ids = {e["event_id"] for e in events}
        self.assertEqual(ids, {"682293", "682274"})

    def test_fields(self):
        events = {e["event_id"]: e for e in parse_index(FIXTURE)}
        yar = events["682293"]
        self.assertEqual(yar["track"], "Yarmouth")
        self.assertEqual(yar["display_time"], "8:47")
        self.assertEqual(yar["selection"], "Strathrannoch")
        self.assertEqual(yar["tips_for"], 2)
        self.assertEqual(yar["tips_total"], 2)
        self.assertEqual(yar["pct"], 100)
        self.assertIn("event_id=682293", yar["url"])
        rom = events["682274"]
        self.assertEqual(rom["selection"], "My Lil Bella")
        self.assertEqual(rom["tips_for"], 1)
        self.assertIsNone(rom["pct"])

    def test_no_price_fields(self):
        for e in parse_index(FIXTURE):
            blob = repr(e).lower()
            for banned in ("odds", "price", "sp "):
                self.assertNotIn(banned, blob)

    def test_non_event_block_ignored(self):
        self.assertIsNone(parse_event_block('<li><a href="/other/page">x</a></li>'))


if __name__ == "__main__":
    unittest.main()
