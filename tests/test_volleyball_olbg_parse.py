"""Tests for the OLBG Volleyball parser."""

import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts'))
from lib.volleyball_olbg_parse import (
    resolve_volleyball_date,
    parse_volleyball_index,
    parse_volleyball_event_page,
)


class TestVolleyballOLBGParse(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_resolve_date_today_tomorrow(self):
        d1, b1 = resolve_volleyball_date('Today', self.now)
        self.assertEqual(d1, '2026-09-02')
        self.assertEqual(b1, 'olbg-relative-today')
        d2, b2 = resolve_volleyball_date('Tomorrow', self.now)
        self.assertEqual(d2, '2026-09-03')
        self.assertEqual(b2, 'olbg-relative-tomorrow')

    def test_parse_volleyball_index(self):
        sample = """
- [**Poland W vs Netherlands W**](https://www.olbg.com/betting-tips/Volleyball/All_Volleyball/All_Events/Poland_W_vs_Netherlands_W/21?event_id=36503 "")
Tomorrow  09:00
[**Poland W**](https://www.olbg.com/betting-tips/Volleyball/All_Volleyball/All_Events/Poland_W_vs_Netherlands_W/21?event_id=36503 "")
Win Match
**10/13 Win Tips**
"""
        parsed = parse_volleyball_index(sample)
        self.assertEqual(len(parsed), 1)
        ev = parsed[0]
        self.assertEqual(ev['event_id'], '36503')
        self.assertEqual(ev['home'], 'Poland W')
        self.assertEqual(ev['away'], 'Netherlands W')
        self.assertEqual(ev['consensus']['market'], 'Win Match')
        self.assertEqual(ev['consensus']['selection'], 'Poland W')
        self.assertEqual(ev['consensus']['tips_for'], 10)
        self.assertEqual(ev['consensus']['tips_total'], 13)

    def test_parse_event_page_marks_only_seen_headings_and_keeps_other_markets_review_only(self):
        html = """
- #### Win Match
#### Poland W
#### Netherlands W
- #### Set Score
#### Poland W to win 3-1
- #### Total Points
#### Over 175.5
- #### Points Handicap
#### Poland W -3.5
"""
        res = parse_volleyball_event_page(html)
        self.assertEqual(res['markets_on_event_page'], ['Win Match', 'Set Score', 'Total Points', 'Points Handicap'])
        self.assertIn('Poland W', res['markets'][0]['selections'])
        self.assertIn('Win Match', res['scored_markets'])
        self.assertIn('Set Score', res['scored_markets'])
        self.assertIn('Total Points', res['review_only_markets'])
        self.assertIn('Points Handicap', res['review_only_markets'])

    def test_index_does_not_claim_a_standard_market_list_before_event_page_verification(self):
        sample = """- [**A W vs B W**](https://www.olbg.com/betting-tips/Volleyball/x?event_id=22 "")
Today 09:00
[**A W**](https://www.olbg.com/betting-tips/Volleyball/x?event_id=22 "")
Win Match
"""
        event = parse_volleyball_index(sample)[0]
        self.assertEqual(event['markets_available'], [])
        self.assertFalse(event['markets_verified'])


if __name__ == '__main__':
    unittest.main()
