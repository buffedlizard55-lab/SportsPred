import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  olbgDates,
  olbgEventsForDate,
  olbgOutrightsForDate,
  olbgDateCounts,
  consensusMarketCounts,
  verifiedMarketCounts,
  olbgSummaryForDate,
  adjacentOlbgDates,
} from '../engine/olbg.js';

const slate = JSON.parse(await readFile(new URL('../data/slate.json', import.meta.url)));

test('olbgDates returns the unique snapshot dates in ascending order', () => {
  const dates = olbgDates(slate);
  assert.deepEqual(dates, ['2026-09-01', '2026-09-12', '2026-09-14']);
});

test('events and outrights filter cleanly by resolved date', () => {
  assert.equal(olbgEventsForDate(slate, '2026-09-01').length, 20);
  assert.equal(olbgOutrightsForDate(slate, '2026-09-01').length, 0);
  assert.equal(olbgOutrightsForDate(slate, '2026-09-12').length, 1);
  assert.equal(olbgOutrightsForDate(slate, '2026-09-14').length, 1);
});

test('olbgDateCounts reports match and outright volume per day', () => {
  const counts = olbgDateCounts(slate);
  assert.deepEqual(counts.get('2026-09-01'), { matches: 20, outrights: 0 });
  assert.deepEqual(counts.get('2026-09-12'), { matches: 0, outrights: 1 });
  assert.deepEqual(counts.get('2026-09-14'), { matches: 0, outrights: 1 });
});

test('consensus and verified market counts are derived from the rows actually present', () => {
  const rows = olbgEventsForDate(slate, '2026-09-01');
  const consensus = consensusMarketCounts(rows);
  assert.equal(consensus[0].market, 'Win Match');
  assert.equal(consensus[0].count, 18);
  assert.ok(consensus.some((m) => m.market === 'Total Games' && m.count === 2));

  const verified = verifiedMarketCounts(rows);
  assert.deepEqual(verified, [
    { market: '1st Set Winner', count: 1 },
    { market: 'Games Won', count: 1 },
    { market: 'Set Betting', count: 1 },
    { market: 'Total Games', count: 1 },
    { market: 'Win Match', count: 1 },
  ]);
});

test('olbgSummaryForDate states plainly how much of the slate is actually verified', () => {
  const s = olbgSummaryForDate(slate, '2026-09-01');
  assert.equal(s.matches, 20);
  assert.equal(s.outrights, 0);
  assert.equal(s.verifiedEventPages, 1);
  assert.equal(s.unverifiedEventPages, 19);
  assert.equal(s.withGamesWonSelections, 1);
  assert.ok(s.consensusMarkets.some((m) => m.market === 'Win Match' && m.count === 18));
});

test('adjacentOlbgDates finds previous/next snapshot dates around a selection', () => {
  assert.deepEqual(adjacentOlbgDates(slate, '2026-09-01'), {
    prev: null,
    next: '2026-09-12',
    dates: ['2026-09-01', '2026-09-12', '2026-09-14'],
  });
  assert.deepEqual(adjacentOlbgDates(slate, '2026-09-12'), {
    prev: '2026-09-01',
    next: '2026-09-14',
    dates: ['2026-09-01', '2026-09-12', '2026-09-14'],
  });
});
