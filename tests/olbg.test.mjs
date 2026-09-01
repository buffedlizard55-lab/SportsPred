/**
 * OLBG slate helpers and view-model tests. Run with: npm test (node --test)
 *
 * These pin the honesty contract of the OLBG tooling: pair matching is exact
 * and order-independent, the snapshot is never extrapolated, and no code path
 * can produce an odds figure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  pairKey,
  matchEvents,
  groupByDate,
  correlateToLive,
  buildOlbgView,
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

test('pairKey is order-independent and normalised', () => {
  assert.equal(pairKey('Carlos Alcaraz', 'Roman Safiullin'), pairKey('Roman Safiullin', 'Carlos Alcaraz'));
  assert.equal(pairKey('Carlos Alcaraz', 'Roman Safiullin'), 'carlos alcaraz v roman safiullin');
  assert.equal(pairKey('Rafael Nadal', ''), null);
  assert.equal(pairKey(null, null), null);
});

test('olbgDates returns the unique snapshot dates in ascending order', () => {
  const dates = olbgDates(slate);
  assert.deepEqual(dates, ['2026-09-01', '2026-09-12', '2026-09-14']);
});

test('the committed snapshot parses and carries no odds anywhere', () => {
  const events = matchEvents(slate);
  assert.ok(events.length > 0, 'snapshot should contain match events');
  const text = JSON.stringify(slate);
  assert.equal(/"(odds|decimal|american|price)"/i.test(text), false,
    'slate.json must never contain a structured price (IR-01)');
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

test('groupByDate buckets every event under its resolved date', () => {
  const events = matchEvents(slate);
  const groups = groupByDate(events);
  const total = [...groups.values()].reduce((a, g) => a + g.length, 0);
  assert.equal(total, events.length);
  for (const ev of events) {
    assert.ok((groups.get(ev.resolved_date || 'unknown') ?? []).some((e) => e.event_id === ev.event_id));
  }
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

test('correlateToLive matches only exact normalised pairs, in either orientation', () => {
  const events = [
    { event_id: 'x1', home: 'Ashlyn Krueger', away: 'Amanda Anisimova' },
    { event_id: 'x2', home: 'Nobody Present', away: 'Absent Either' },
  ];
  const matches = [
    { competition_id: 'L1', players: [{ name: 'Amanda Anisimova' }, { name: 'Ashlyn Krueger' }] },
    { competition_id: 'L2', players: [{ name: 'Ashlyn Krueger-Jones' }, { name: 'Amanda Anisimova' }] },
  ];
  const { correlated, unmatchedEvents } = correlateToLive(events, matches);
  assert.equal(correlated.length, 1);
  assert.equal(correlated[0].event.event_id, 'x1');
  assert.equal(correlated[0].competition_id, 'L1');
  assert.equal(unmatchedEvents.length, 1);
  assert.equal(unmatchedEvents[0].event_id, 'x2');
});

test('one live match serves exactly one slate event', () => {
  const events = [
    { event_id: 'a', home: 'P One', away: 'P Two' },
    { event_id: 'b', home: 'P Two', away: 'P One' },
  ];
  const matches = [{ competition_id: 'L1', players: [{ name: 'P One' }, { name: 'P Two' }] }];
  const { correlated, unmatchedEvents } = correlateToLive(events, matches);
  assert.equal(correlated.length, 1);
  assert.equal(unmatchedEvents.length, 1);
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

test('buildOlbgView: missing slate degrades to a stated reason, not an error', () => {
  const v = buildOlbgView(null, [], '2026-09-01');
  assert.equal(v.present, false);
  assert.ok(v.reason);
});

test('buildOlbgView marks excluded consensus markets and never emits odds', () => {
  const v = buildOlbgView(slate, [], '2026-09-01');
  assert.equal(v.present, true);
  assert.equal(v.date, '2026-09-01');
  assert.ok(v.totals.events > 0);
  const excluded = v.events_today.filter((e) => e.model_excluded);
  assert.ok(excluded.length >= 2, 'expected the documented Total Games consensus exclusions');
  for (const e of v.events_today) {
    assert.equal('odds' in e, false);
    assert.equal('price' in e, false);
    assert.ok(['Win Match', 'Total Games', 'Set Betting', '1st Set Winner', 'Games Won', 'Win Tournament', null].includes(e.consensus?.market ?? null));
  }
});

test('buildOlbgView does not extrapolate the snapshot to other dates', () => {
  const v = buildOlbgView(slate, [], '2099-01-01');
  assert.equal(v.present, true);
  assert.equal(v.events_today.length, 0, 'a date outside the snapshot has no slate — never synthesised');
});
