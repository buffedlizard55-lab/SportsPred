/**
 * OLBG slate view-model tests. Run with: npm test (node --test)
 *
 * These pin the honesty contract of the OLBG panel: pair matching is exact
 * and order-independent, the snapshot is never extrapolated, and no code path
 * can produce an odds figure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pairKey, matchEvents, groupByDate, correlateToLive, buildOlbgView,
} from '../engine/olbg.js';
import { readFileSync } from 'node:fs';

const SLATE = JSON.parse(readFileSync(new URL('../data/slate.json', import.meta.url), 'utf8'));

test('pairKey is order-independent and normalised', () => {
  assert.equal(pairKey('Carlos Alcaraz', 'Roman Safiullin'), pairKey('Roman Safiullin', 'Carlos Alcaraz'));
  assert.equal(pairKey('Carlos Alcaraz', 'Roman Safiullin'), 'carlos alcaraz v roman safiullin');
  assert.equal(pairKey('Rafael Nadal', ''), null);
  assert.equal(pairKey(null, null), null);
});

test('the committed snapshot parses and carries no odds anywhere', () => {
  const events = matchEvents(SLATE);
  assert.ok(events.length > 0, 'snapshot should contain match events');
  const text = JSON.stringify(SLATE);
  // No structured price field may exist under any name we would ever emit.
  assert.equal(/"(odds|decimal|american|price)"/i.test(text), false,
    'slate.json must never contain a structured price (IR-01)');
});

test('groupByDate buckets every event under its resolved date', () => {
  const events = matchEvents(SLATE);
  const groups = groupByDate(events);
  const total = [...groups.values()].reduce((a, g) => a + g.length, 0);
  assert.equal(total, events.length);
  for (const ev of events) {
    assert.ok((groups.get(ev.resolved_date || 'unknown') ?? []).some((e) => e.event_id === ev.event_id));
  }
});

test('correlateToLive matches only exact normalised pairs, in either orientation', () => {
  const events = [
    { event_id: 'x1', home: 'Ashlyn Krueger', away: 'Amanda Anisimova' },
    { event_id: 'x2', home: 'Nobody Present', away: 'Absent Either' },
  ];
  const matches = [
    { competition_id: 'L1', players: [{ name: 'Amanda Anisimova' }, { name: 'Ashlyn Krueger' }] },
    { competition_id: 'L2', players: [{ name: 'Ashlyn Krueger-Jones' }, { name: 'Amanda Anisimova' }] }, // near-miss must not match
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
    { event_id: 'b', home: 'P Two', away: 'P One' }, // duplicate listing of the same match
  ];
  const matches = [{ competition_id: 'L1', players: [{ name: 'P One' }, { name: 'P Two' }] }];
  const { correlated, unmatchedEvents } = correlateToLive(events, matches);
  assert.equal(correlated.length, 1);
  assert.equal(unmatchedEvents.length, 1);
});

test('buildOlbgView: missing slate degrades to a stated reason, not an error', () => {
  const v = buildOlbgView(null, [], '2026-09-01');
  assert.equal(v.present, false);
  assert.ok(v.reason);
});

test('buildOlbgView marks excluded consensus markets and never emits odds', () => {
  const v = buildOlbgView(SLATE, [], '2026-09-01');
  assert.equal(v.present, true);
  assert.equal(v.date, '2026-09-01');
  assert.ok(v.totals.events > 0);
  // The two Total-Games consensus rows documented in IR-06 must be flagged excluded.
  const excluded = v.events_today.filter((e) => e.model_excluded);
  assert.ok(excluded.length >= 2, 'expected the documented Total Games consensus exclusions');
  for (const e of v.events_today) {
    assert.equal('odds' in e, false);
    assert.equal('price' in e, false);
    assert.ok(['Win Match', 'Total Games', 'Set Betting', '1st Set Winner', 'Games Won', 'Win Tournament', null].includes(e.consensus?.market ?? null));
  }
});

test('buildOlbgView does not extrapolate the snapshot to other dates', () => {
  const v = buildOlbgView(SLATE, [], '2099-01-01');
  assert.equal(v.present, true);
  assert.equal(v.events_today.length, 0, 'a date outside the snapshot has no slate — never synthesised');
});
