/**
 * OLBG slate helpers and view-model tests. Run with: npm test (node --test)
 *
 * These pin the honesty contract of the OLBG tooling: pair matching is exact
 * and order-independent, the snapshot is never extrapolated, and no code path
 * can produce an odds figure.
 *
 * Count/date assertions are derived from the committed snapshot itself so the
 * suite stays green when the scheduled collector refreshes data/slate.json
 * (dates and market volumes change every run) — only *behavioural* invariants
 * are hard-asserted.
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
const allDates = olbgDates(slate);
const allMatchEvents = matchEvents(slate);
const firstDate = allDates[0];
// every outright in the snapshot, gathered across all snapshot dates
const allOutrights = allDates.flatMap((d) => olbgOutrightsForDate(slate, d));

test('pairKey is order-independent and normalised', () => {
  assert.equal(pairKey('Carlos Alcaraz', 'Roman Safiullin'), pairKey('Roman Safiullin', 'Carlos Alcaraz'));
  assert.equal(pairKey('Carlos Alcaraz', 'Roman Safiullin'), 'carlos alcaraz v roman safiullin');
  assert.equal(pairKey('Rafael Nadal', ''), null);
  assert.equal(pairKey(null, null), null);
});

test('olbgDates returns the unique snapshot dates in ascending order', () => {
  const dates = olbgDates(slate);
  assert.ok(dates.length > 0, 'snapshot must expose at least one date');
  // ascending and unique
  for (let i = 1; i < dates.length; i++) {
    assert.ok(dates[i] > dates[i - 1], 'dates must be sorted ascending');
  }
  assert.equal(new Set(dates).size, dates.length, 'dates must be unique');
  // consistent with the raw rows
  const rawDates = new Set([...allMatchEvents, ...allOutrights].map((e) => e.resolved_date).filter(Boolean));
  assert.deepEqual(dates, [...rawDates].sort());
});

test('the committed snapshot parses and carries no odds anywhere', () => {
  assert.ok(allMatchEvents.length > 0, 'snapshot should contain match events');
  const text = JSON.stringify(slate);
  assert.equal(/"(odds|decimal|american|price)"/i.test(text), false,
    'slate.json must never contain a structured price (IR-01)');
});

test('events and outrights filter cleanly by resolved date', () => {
  // every date's events + outrights, summed, account for the whole snapshot
  let eventTotal = 0;
  let outrightTotal = 0;
  for (const d of allDates) {
    const ev = olbgEventsForDate(slate, d);
    const out = olbgOutrightsForDate(slate, d);
    eventTotal += ev.length;
    outrightTotal += out.length;
    // a row is never counted as both an event and an outright
    for (const e of ev) {
      assert.equal(olbgOutrightsForDate(slate, d).some((o) => o.event_id === e.event_id), false);
    }
  }
  assert.equal(eventTotal, allMatchEvents.length);
  assert.equal(outrightTotal, allOutrights.length);
  // a date outside the snapshot yields nothing
  assert.equal(olbgEventsForDate(slate, '2099-01-01').length, 0);
  assert.equal(olbgOutrightsForDate(slate, '2099-01-01').length, 0);
});

test('olbgDateCounts reports match and outright volume per day', () => {
  const counts = olbgDateCounts(slate);
  let matchSum = 0;
  let outrightSum = 0;
  for (const d of allDates) {
    const c = counts.get(d);
    assert.ok(c, `count present for ${d}`);
    assert.equal(c.matches, olbgEventsForDate(slate, d).length);
    assert.equal(c.outrights, olbgOutrightsForDate(slate, d).length);
    matchSum += c.matches;
    outrightSum += c.outrights;
  }
  assert.equal(matchSum, allMatchEvents.length);
  assert.equal(outrightSum, allOutrights.length);
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
  const rows = olbgEventsForDate(slate, firstDate);
  const consensus = consensusMarketCounts(rows);
  assert.ok(consensus.length > 0, 'a populated date has consensus markets');
  // the top consensus market is always the win market on OLBG tennis
  assert.equal(consensus[0].market, 'Win Match');
  assert.ok(consensus[0].count > 0);
  // counts never exceed the number of rows
  for (const m of consensus) {
    assert.ok(m.count <= rows.length);
  }
  // the helper output is the same shape regardless of volume
  const verified = verifiedMarketCounts(rows);
  assert.ok(Array.isArray(verified));
  for (const v of verified) {
    assert.ok(typeof v.market === 'string' && v.count > 0);
  }
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
  const s = olbgSummaryForDate(slate, firstDate);
  const expectedMatches = olbgEventsForDate(slate, firstDate).length;
  const expectedOutrights = olbgOutrightsForDate(slate, firstDate).length;
  assert.equal(s.matches, expectedMatches);
  assert.equal(s.outrights, expectedOutrights);
  // verified + unverified pages account for all matches
  assert.equal(s.verifiedEventPages + s.unverifiedEventPages, expectedMatches);
  assert.ok(s.verifiedEventPages >= 0 && s.verifiedEventPages <= expectedMatches);
  // consensus markets surfaced and internally consistent
  assert.ok(Array.isArray(s.consensusMarkets));
  const win = s.consensusMarkets.find((m) => m.market === 'Win Match');
  if (win) assert.ok(win.count <= expectedMatches);
});

test('adjacentOlbgDates finds previous/next snapshot dates around a selection', () => {
  // first date: no previous
  assert.deepEqual(adjacentOlbgDates(slate, allDates[0]).prev, null);
  assert.deepEqual(adjacentOlbgDates(slate, allDates[0]).dates, allDates);
  if (allDates.length > 1) {
    assert.deepEqual(adjacentOlbgDates(slate, allDates[0]).next, allDates[1]);
    // middle date: both neighbours
    const mid = allDates[Math.floor(allDates.length / 2)];
    const midIdx = allDates.indexOf(mid);
    const adj = adjacentOlbgDates(slate, mid);
    assert.deepEqual(adj.dates, allDates);
    if (midIdx > 0) assert.deepEqual(adj.prev, allDates[midIdx - 1]);
    if (midIdx < allDates.length - 1) assert.deepEqual(adj.next, allDates[midIdx + 1]);
  }
  // last date: no next
  assert.deepEqual(adjacentOlbgDates(slate, allDates[allDates.length - 1]).next, null);
});

test('buildOlbgView: missing slate degrades to a stated reason, not an error', () => {
  const v = buildOlbgView(null, [], firstDate);
  assert.equal(v.present, false);
  assert.ok(v.reason);
});

test('buildOlbgView marks excluded consensus markets and never emits odds', () => {
  const v = buildOlbgView(slate, [], firstDate);
  assert.equal(v.present, true);
  assert.equal(v.date, firstDate);
  assert.ok(v.totals.events > 0);
  // no row ever carries a price
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
