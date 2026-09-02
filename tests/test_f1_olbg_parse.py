"""Tests for the OLBG Formula 1 page parser (pure, no network)."""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from lib.f1_olbg_parse import (  # noqa: E402
    parse_index, parse_event_page_markets, parse_track_history, parse_block,
)

INDEX_HTML = """<!DOCTYPE html>
<html><body><ul class="tips">
  <li class="tip-row">
    <a class="event" href="https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/Formula_1_Drivers_Championship_2026/14?event_id=828"><strong>Formula 1 Drivers Championship 2026</strong></a>
    <span class="datetime">06 Dec  08:00</span>
    <a class="selection" href="https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/Formula_1_Drivers_Championship_2026/14?event_id=828"><strong>Max Verstappen</strong></a>
    <span class="market">Win Tournament</span>
    <span class="tips"><strong>9/27 Win Tips</strong></span>
    <span class="pct">33%</span>
    <span class="comments">4 comments</span>
  </li>
  <li class="tip-row">
    <a class="event" href="https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/Italian_Grand_Prix/14?event_id=899"><strong>Italian Grand Prix</strong></a>
    <span class="datetime">05 Sept  10:00</span>
    <a class="selection" href="https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/Italian_Grand_Prix/14?event_id=899"><strong>Lando Norris</strong></a>
    <span class="market">Fastest Qualifier</span>
    <span class="tips"><strong>7/14 Win Tips</strong></span>
    <span class="pct">50%</span>
    <span class="comments">4 comments</span>
  </li>
  <li class="tip-row">
    <a class="event" href="https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/Italian_Grand_Prix/14?event_id=900"><strong>Italian Grand Prix</strong></a>
    <span class="datetime">06 Sept  09:02</span>
    <a class="selection" href="https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/Italian_Grand_Prix/14?event_id=900"><strong>Lando Norris</strong></a>
    <span class="market">Win Race</span>
    <span class="tips"><strong>6/19 Win Tips</strong></span>
    <span class="pct">32%</span>
    <span class="comments">2 comments</span>
  </li>
</ul></body></html>"""

EVENT_HTML = """<!DOCTYPE html><html><body>
<h1>Italian Grand Prix Betting Tips and Predictions</h1>
<h3>Fastest Qualifier</h3>
<ul>
  <li><strong>Lando Norris</strong> 7/14 Win Tips</li>
</ul>
<h2>Previous Italian Grand Prix Winners</h2>
<ul>
  <li>2025: Max Verstappen (Red Bull Racing)</li>
  <li>2024: Charles Leclerc (Ferrari)</li>
  <li>2023: Max Verstappen (Red Bull Racing)</li>
</ul>
<h3>Monza Circuit Fastest Laps</h3>
<ul>
  <li>2025: Lando Norris (McLaren)</li>
  <li>2024: Lando Norris (McLaren)</li>
  <li>2023: Oscar Piastri (McLaren)</li>
</ul>
</body></html>"""


class F1OlbgParseTest(unittest.TestCase):
    def test_index_parses_matches_and_outrights(self):
        matches, outrights = parse_index(INDEX_HTML)
        self.assertEqual(len(matches), 2)
        self.assertEqual(len(outrights), 1)
        self.assertEqual(matches[0]['event_id'], '899')
        self.assertEqual(matches[0]['event_name'], 'Italian Grand Prix')
        self.assertEqual(matches[0]['consensus']['market'], 'Fastest Qualifier')
        self.assertEqual(matches[0]['consensus']['selection'], 'Lando Norris')
        self.assertEqual(matches[0]['consensus']['tips_for'], 7)
        self.assertEqual(outrights[0]['event_name'], 'Formula 1 Drivers Championship 2026')
        self.assertEqual(outrights[0]['consensus']['market'], 'Win Tournament')

    def test_dates_resolve_against_fetch_time(self):
        now = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
        block = '<li>' + INDEX_HTML.split('<li class="tip-row">')[2]  # event 899
        row = parse_block(block, fetch_now=now)
        self.assertEqual(row['resolved_date'], '2026-09-05')
        self.assertEqual(row['date_basis'], 'observed')

    def test_event_page_markets_only_from_headings(self):
        markets = parse_event_page_markets(EVENT_HTML)
        self.assertEqual(markets, ['Fastest Qualifier'])
        # Prose mention of "podium and points finishes" is not a market.
        self.assertNotIn('Podium Finish', markets)

    def test_track_history_parses_year_lists(self):
        history = parse_track_history(EVENT_HTML)
        names = {(h['year'], h['name']) for h in history}
        self.assertIn((2025, 'Max Verstappen'), names)
        self.assertIn((2025, 'Lando Norris'), names)
        self.assertIn((2023, 'Oscar Piastri'), names)

    def test_no_fabricated_odds_fields(self):
        _, outrights = parse_index(INDEX_HTML)
        for row in outrights:
            for key in ('odds', 'price', 'american', 'decimal'):
                self.assertNotIn(key, row)


if __name__ == '__main__':
    unittest.main()
