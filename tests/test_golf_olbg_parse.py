"""Tests for the OLBG Golf page parser (pure, no network).

The index HTML below is a RECONSTRUCTION of the rows observed on
https://www.olbg.com/betting-tips/Golf/5 on 2026-09-02 (Walker Cup, Omega
European Masters, NI Legends) using the same structural assumptions as the
tennis/cricket/F1 fixtures. The form-table and OWGR rows are copied from the
editorial article on that page.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from lib.golf_olbg_parse import (  # noqa: E402
    parse_index, parse_event_page_markets, parse_form_table, parse_owgr_links, parse_block, classify_event,
)

INDEX_HTML = """<!DOCTYPE html>
<html><body><ul class="tips">
  <li class="tip-row">
    <a class="event" href="https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/Walker_Cup/5?event_id=101768"><strong>Walker Cup</strong></a>
    <span class="datetime">06 Sept  14:00</span>
    <a class="selection" href="https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/Walker_Cup/5?event_id=101768"><strong>USA</strong></a>
    <span class="market">Win Tournament</span>
    <span class="tips"><strong>3/4 Win Tips</strong></span>
    <span class="pct">75%</span>
    <span class="comments">1 comments</span>
  </li>
  <li class="tip-row">
    <a class="event" href="https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/Omega_European_Masters/5?event_id=101769"><strong>Omega European Masters</strong></a>
    <span class="datetime">06 Sept  12:00</span>
    <a class="selection" href="https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/Omega_European_Masters/5?event_id=101769"><strong>Ryan Gerard</strong></a>
    <span class="market">Win Tournament</span>
    <span class="tips"><strong>2/4 Win Tips</strong></span>
    <span class="pct">50%</span>
    <span class="comments">2 comments</span>
  </li>
  <li class="tip-row">
    <a class="event" href="https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/NI_Legends/5?event_id=101770"><strong>NI Legends</strong></a>
    <span class="datetime">Tomorrow  08:00</span>
    <a class="selection" href="https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/NI_Legends/5?event_id=101770"><strong>Steven Alker</strong></a>
    <span class="market">Win Tournament</span>
    <span class="tips"><strong>1/1 Win Tips</strong></span>
    <span class="pct">100%</span>
  </li>
</ul>
<h2>Golfers in form</h2>
<table>
<tr><th>Player (OWGR) (Tour)</th><th>Wins</th><th>Top 6's</th></tr>
<tr><td>Scottie Scheffler (1) (PGA)</td><td>2 (30/8/26)</td><td>0</td></tr>
<tr><td>Stewart Cink (n/a) (Champ)</td><td>1 (16/8/26)</td><td>2 (30/8/26)</td></tr>
<tr><td>Wyndham Clark (5) (PGA)</td><td>1 (23/8/26)</td><td>1 (16/8/26)</td></tr>
</table>
<table>
<tr><td>1</td><td><a href="https://www.owgr.com/playerprofile/scottie-scheffler-18417">Scottie Scheffler</a></td></tr>
<tr><td>2</td><td><a href="https://www.owgr.com/playerprofile/rory-mcilroy-10091">Rory McIlroy</a></td></tr>
</table>
</body></html>"""

EVENT_HTML = """<!DOCTYPE html><html><body>
<h1>Omega European Masters Betting Tips and Predictions</h1>
<h3>Win Tournament</h3>
<ul><li><strong>Ryan Gerard</strong> 2/4 Win Tips</li></ul>
<h3>Top 10 Finish</h3>
<h3>First Round Leader</h3>
<h2>Previous Omega European Masters Winners</h2>
<ul><li>2025: Thriston Lawrence</li></ul>
<h2>Course History</h2>
<p>The Top European market and the Top 5 Finish market are mentioned in prose only.</p>
</body></html>"""


class TestGolfIndex(unittest.TestCase):
    def test_rows_split_into_tournaments_and_team_events(self):
        tournaments, teams = parse_index(INDEX_HTML)
        self.assertEqual([r['event_id'] for r in tournaments], ['101769', '101770'])
        self.assertEqual([r['event_id'] for r in teams], ['101768'])

    def test_row_fields(self):
        tournaments, _ = parse_index(INDEX_HTML)
        row = tournaments[0]
        self.assertEqual(row['event_name'], 'Omega European Masters')
        self.assertEqual(row['slug'], 'Omega_European_Masters')
        self.assertEqual(row['url'], 'https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/Omega_European_Masters/5?event_id=101769')
        self.assertEqual(row['display_date'], '06 Sept')
        self.assertEqual(row['display_time'], '12:00')
        self.assertEqual(row['consensus'], {
            'market': 'Win Tournament', 'selection': 'Ryan Gerard', 'tips_for': 2, 'tips_total': 4,
            'pct': 50, 'comments': 2, 'experts': 0,
        })
        self.assertNotIn('odds', row)
        self.assertNotIn('price', row)

    def test_team_event_classification(self):
        self.assertEqual(classify_event('Walker Cup'), 'team')
        self.assertEqual(classify_event('Ryder Cup'), 'team')
        self.assertEqual(classify_event('Omega European Masters'), 'tournament')
        self.assertEqual(classify_event('Amgen Irish Open'), 'tournament')

    def test_relative_date_is_marked_derived(self):
        now = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)
        block = INDEX_HTML.split('<li')[3]
        row = parse_block(block, fetch_now=now)
        self.assertEqual(row['event_id'], '101770')
        self.assertEqual(row['display_date'], 'Tomorrow')
        self.assertEqual(row['date_basis'], 'derived')
        self.assertEqual(row['resolved_date'], '2026-09-03')

    def test_form_table_and_owgr_links(self):
        form = parse_form_table(INDEX_HTML)
        self.assertEqual(form[0], {'name': 'Scottie Scheffler', 'owgr': 1, 'tour': 'PGA'})
        self.assertEqual(form[1]['owgr'], None)
        self.assertEqual(form[1]['tour'], 'Champ')
        links = parse_owgr_links(INDEX_HTML)
        self.assertEqual(links[0]['owgr_id'], '18417')
        self.assertEqual(links[1]['slug'], 'rory-mcilroy')

    def test_event_page_markets_only_from_headings(self):
        markets = parse_event_page_markets(EVENT_HTML)
        self.assertEqual(markets, ['First Round Leader', 'Top 10 Finish', 'Win Tournament'])
        self.assertNotIn('Top European', markets)
        self.assertNotIn('Top 5 Finish', markets)

    def test_empty_page_yields_nothing(self):
        self.assertEqual(parse_index('<html></html>'), ([], []))
        self.assertEqual(parse_event_page_markets('<html></html>'), [])


if __name__ == '__main__':
    unittest.main()
