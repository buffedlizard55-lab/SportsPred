"""
Parser tests for the OLBG collector. Stdlib unittest so no packages are needed.

    python3 -m unittest discover -s tests -p 'test_*.py' -v

Caveat repeated here on purpose: the fixture is RECONSTRUCTED, not captured.
These tests validate the parser against that shape only. See IR-03.
"""

import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts'))

from lib.olbg_parse import (  # noqa: E402
    parse_index, parse_block, split_blocks, resolve_date,
    parse_event_page_markets, parse_games_won_selections, strip_tags,
)

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       'fixtures', 'olbg_tennis_index.RECONSTRUCTED.html')

# 2026-08-31 00:12 UTC, matching the live fetch this fixture was derived from.
FETCH = datetime(2026, 8, 31, 0, 12, tzinfo=timezone.utc)


def html():
    with open(FIXTURE, encoding='utf-8') as fh:
        return fh.read()


class TestStripTags(unittest.TestCase):
    def test_removes_tags_and_collapses_whitespace(self):
        self.assertEqual(strip_tags('<a  href="x">A   B</a>\n  <b>C</b>'), 'A B C')

    def test_decodes_the_entities_olbg_uses(self):
        self.assertEqual(strip_tags('A &amp; B &#39;c&#39;'), "A & B 'c'")


class TestIndexParsing(unittest.TestCase):
    def setUp(self):
        self.matches, self.outrights = parse_index(html())

    def test_splits_matches_from_outrights(self):
        self.assertEqual(len(self.matches), 4)
        self.assertEqual(len(self.outrights), 1)
        self.assertEqual(self.outrights[0]['name'], 'US Open Women')
        self.assertEqual(self.outrights[0]['event_id'], '899362')

    def test_extracts_players_and_event_id(self):
        first = self.matches[0]
        self.assertEqual(first['event_id'], '899311')
        self.assertEqual(first['home'], 'Venus Williams')
        self.assertEqual(first['away'], 'Sofia Kenin')
        self.assertEqual(first['type'], 'match')

    def test_extracts_display_time(self):
        self.assertEqual(self.matches[0]['display_date'], 'Today')
        self.assertEqual(self.matches[0]['display_time'], '21:00')
        self.assertEqual(self.matches[2]['display_date'], '01 Sept')

    def test_extracts_consensus(self):
        c = self.matches[0]['consensus']
        self.assertEqual(c['market'], 'Win Match')
        self.assertEqual(c['selection'], 'Sofia Kenin')
        self.assertEqual(c['tips_for'], 10)
        self.assertEqual(c['tips_total'], 10)
        self.assertEqual(c['pct'], 100)
        self.assertEqual(c['comments'], 2)
        self.assertEqual(c['experts'], 1)

    def test_consensus_on_an_excluded_market_is_still_recorded(self):
        grabher = next(m for m in self.matches if m['event_id'] == '899314')
        self.assertEqual(grabher['consensus']['market'], 'Total Games')
        self.assertEqual(grabher['consensus']['selection'], 'Over 18.50')

    def test_expert_flag_is_zero_when_absent(self):
        safiullin = next(m for m in self.matches if m['event_id'] == '899350')
        self.assertEqual(safiullin['consensus']['experts'], 0)
        self.assertEqual(safiullin['consensus']['comments'], 0)

    def test_url_is_absolute_and_carries_the_event_id(self):
        u = self.matches[0]['url']
        self.assertTrue(u.startswith('https://www.olbg.com/betting-tips/Tennis/'))
        self.assertIn('event_id=899311', u)

    def test_slug_is_extracted(self):
        self.assertEqual(self.matches[0]['slug'], 'Venus_Williams_vs_Sofia_Kenin')

    def test_partial_percentages_parse(self):
        bublik = next(m for m in self.matches if m['event_id'] == '899335')
        self.assertEqual(bublik['consensus']['tips_for'], 5)
        self.assertEqual(bublik['consensus']['tips_total'], 8)
        self.assertEqual(bublik['consensus']['pct'], 63)


class TestBlockGuards(unittest.TestCase):
    def test_a_block_without_an_event_anchor_yields_nothing(self):
        self.assertEqual(parse_block('<li><a href="/other">x vs y</a></li>'), None)

    def test_split_blocks_ignores_non_event_list_items(self):
        blocks = split_blocks('<ul><li>noise</li><li><a href="/betting-tips/Tennis/A/3?event_id=1">x</a></li></ul>')
        self.assertEqual(len(blocks), 1)

    def test_duplicate_events_are_collapsed(self):
        dup = html() + html()
        matches, outrights = parse_index(dup)
        self.assertEqual(len(matches), 4)
        self.assertEqual(len(outrights), 1)


class TestDateResolution(unittest.TestCase):
    def test_today_resolves_to_the_fetch_date_and_is_marked_derived(self):
        self.assertEqual(resolve_date('Today', FETCH), ('2026-08-31', 'derived'))

    def test_tomorrow_resolves_to_the_next_day_and_is_marked_derived(self):
        self.assertEqual(resolve_date('Tomorrow', FETCH), ('2026-09-01', 'derived'))

    def test_explicit_day_month_is_observed(self):
        self.assertEqual(resolve_date('01 Sept', FETCH), ('2026-09-01', 'observed'))
        self.assertEqual(resolve_date('12 Sept', FETCH), ('2026-09-12', 'observed'))

    def test_a_past_dated_label_rolls_to_next_year(self):
        # OLBG only lists upcoming events, so "05 Jan" seen in August means January.
        iso, basis = resolve_date('05 Jan', FETCH)
        self.assertEqual(iso, '2027-01-05')
        self.assertEqual(basis, 'observed')

    def test_unknown_labels_never_guess(self):
        self.assertEqual(resolve_date(None, FETCH), (None, 'unknown'))
        self.assertEqual(resolve_date('', FETCH), (None, 'unknown'))
        self.assertEqual(resolve_date('Next Week', FETCH), (None, 'unknown'))
        self.assertEqual(resolve_date('32 Sept', FETCH), (None, 'unknown'))


class TestEventPage(unittest.TestCase):
    def test_market_list_is_found_in_canonical_order(self):
        # The five markets verified on OLBG event 899350 on 2026-08-31.
        page = '''<div>Win Match</div><div>Set Betting</div><div>1st Set Winner</div>
                  <div>Games Won</div><div>Total Games</div>'''
        self.assertEqual(
            parse_event_page_markets(page),
            ['1st Set Winner', 'Win Match', 'Games Won', 'Total Games', 'Set Betting'],
        )

    def test_a_page_missing_a_market_does_not_report_it(self):
        self.assertEqual(parse_event_page_markets('<div>Win Match</div>'), ['Win Match'])
        self.assertEqual(parse_event_page_markets('<div>nothing here</div>'), [])

    def test_games_won_lines_are_extracted(self):
        page = '<span>Carlos Alcaraz -5.50</span><span>Roman Safiullin +5.50</span>'
        got = parse_games_won_selections(page)
        self.assertEqual(len(got), 2)
        self.assertEqual(got[0]['player'], 'Carlos Alcaraz')
        self.assertEqual(got[0]['line'], -5.5)
        self.assertEqual(got[1]['player'], 'Roman Safiullin')
        self.assertEqual(got[1]['line'], 5.5)

    def test_short_or_single_word_names_are_not_treated_as_selections(self):
        self.assertEqual(parse_games_won_selections('<span>Over 21.50</span>'), [])


if __name__ == '__main__':
    unittest.main()
