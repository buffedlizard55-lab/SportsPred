import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.gaa_olbg_parse import parse_index, parse_team_names, event_re  # noqa: E402

INDEX_FIXTURE = """
<ul>
  <li>
    <a href="/betting-tips/Gaelic_Football/All_Gaelic_Football/All_Events/Shelmaliers_v_Gusserane/25?event_id=3439"><strong>Shelmaliers v Gusserane</strong></a>
    05 Sept 10:15
    <a href="/betting-tips/Gaelic_Football/All_Gaelic_Football/All_Events/Shelmaliers_v_Gusserane/25?event_id=3439"><strong>Draw</strong></a>
    Win Match
    <strong>5/7 Win Tips</strong>
    71%
  </li>
  <li>
    <a href="/betting-tips/Gaelic_Football/All_Gaelic_Football/All_Events/All_Ireland_Football_Championship_2027/25?event_id=3327"><strong>All Ireland Football Championship 2027</strong></a>
    25 Jul 2027 10:30
    <a href="/betting-tips/Gaelic_Football/All_Gaelic_Football/All_Events/All_Ireland_Football_Championship_2027/25?event_id=3327"><strong>Kerry</strong></a>
    Win Tournament
    <strong>4/6 Win Tips</strong>
    67%
  </li>
</ul>
"""

HURLING_FIXTURE = """
<ul>
  <li>
    <a href="/betting-tips/Hurling/All_Hurling/All_Events/Tullaroan_v_OLoughlin_Gaels/26?event_id=701"><strong>Tullaroan v OLoughlin Gaels</strong></a>
    05 Sept 12:00
    <a href="/betting-tips/Hurling/All_Hurling/All_Events/Tullaroan_v_OLoughlin_Gaels/26?event_id=701"><strong>Draw</strong></a>
    FT Result
    <strong>3/4 Win Tips</strong>
    75%
  </li>
</ul>
"""


class GaaOlbgParseTests(unittest.TestCase):
    def test_event_regex(self):
        m = event_re('25', 'Gaelic_Football').search(INDEX_FIXTURE)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(2), '3439')

    def test_parse_index_match_and_outright(self):
        events = parse_index(INDEX_FIXTURE)
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]['type'], 'match')
        self.assertEqual(events[0]['matchup'], 'Shelmaliers v Gusserane')
        self.assertEqual(events[0]['consensus']['selection'], 'Draw')
        self.assertEqual(events[1]['type'], 'outright')

    def test_hurling_index(self):
        events = parse_index(HURLING_FIXTURE, sport_id='26', slug_folder='Hurling')
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['event_id'], '701')
        self.assertEqual(events[0]['type'], 'match')

    def test_no_price_fields(self):
        for e in parse_index(INDEX_FIXTURE):
            blob = repr(e).lower()
            self.assertNotIn('american odds', blob)
            self.assertNotIn("'price'", blob)

    def test_team_names(self):
        self.assertEqual(parse_team_names('<h1>Shelmaliers v Gusserane</h1>'), ['Shelmaliers', 'Gusserane'])


if __name__ == '__main__':
    unittest.main()
