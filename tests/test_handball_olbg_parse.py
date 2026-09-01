"""
Tests for OLBG Handball Parser.
"""

import unittest
from datetime import datetime, timezone
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts'))
from lib.handball_olbg_parse import (
    resolve_handball_date,
    parse_handball_index,
    parse_handball_event_page,
)


class TestHandballOLBGParse(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)

    def test_resolve_date_today_tomorrow(self):
        d1, b1 = resolve_handball_date('Today', self.now)
        self.assertEqual(d1, '2026-09-01')
        self.assertEqual(b1, 'relative:today')

        d2, b2 = resolve_handball_date('Tomorrow', self.now)
        self.assertEqual(d2, '2026-09-02')
        self.assertEqual(b2, 'relative:tomorrow')

    def test_resolve_date_calendar(self):
        d, b = resolve_handball_date('03 Sept', self.now)
        self.assertEqual(d, '2026-09-03')
        self.assertEqual(b, 'calendar:explicit')

    def test_parse_handball_index(self):
        sample_md = """
- [**Aalborg Handbold vs Fredericia HK**](https://www.olbg.com/betting-tips/Handball/All_Handball/All_Events/Aalborg_Handbold_vs_Fredericia_HK/20?event_id=11396 "")
Tomorrow  13:00
[**Aalborg Handbold**](https://www.olbg.com/betting-tips/Handball/All_Handball/All_Events/Aalborg_Handbold_vs_Fredericia_HK/20?event_id=11396 "")
Money Line
**13/16 Win Tips**
81%
"""
        parsed = parse_handball_index(sample_md)
        self.assertEqual(len(parsed), 1)
        ev = parsed[0]
        self.assertEqual(ev['event_id'], '11396')
        self.assertEqual(ev['home'], 'Aalborg Handbold')
        self.assertEqual(ev['away'], 'Fredericia HK')
        self.assertEqual(ev['consensus']['market'], 'Money Line')
        self.assertEqual(ev['consensus']['selection'], 'Aalborg Handbold')
        self.assertEqual(ev['consensus']['tips_for'], 13)
        self.assertEqual(ev['consensus']['tips_total'], 16)
        self.assertEqual(ev['consensus']['percentage'], 81)

    def test_parse_handball_event_page(self):
        sample_html = """
Money Line
Aalborg Handbold - 13/16
Match Handicap
Aalborg Handbold -6.50
Fredericia HK +6.50
Points Total
Over 61.50
Under 61.50
"""
        res = parse_handball_event_page(sample_html)
        self.assertIn('Money Line', res['markets_on_event_page'])
        self.assertIn('Match Handicap', res['markets_on_event_page'])
        self.assertIn('Points Total', res['markets_on_event_page'])


if __name__ == '__main__':
    unittest.main()
