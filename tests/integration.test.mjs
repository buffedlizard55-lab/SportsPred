/**
 * Integration tests: the real data snapshots, through the real join and engine.
 * These cover the exact code path the browser runs on page load.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { toMatch, slateToMatches, playerKey, phaseOf } from '../engine/join.js';
import { scoreMatch, scoreCard } from '../engine/engine.js';
import { writeCard } from '../engine/writer.js';

const slate = JSON.parse(await readFile(new URL('../data/slate.json', import.meta.url)));
const players = JSON.parse(await readFile(new URL('../data/players.json', import.meta.url)));
const provenance = JSON.parse(await readFile(new URL('../data/provenance.json', import.meta.url)));

test('the snapshot parses and has the documented shape', () => {
  assert.equal(slate.schema_version, 1);
  assert.ok(Array.isArray(slate.events) && slate.events.length > 0);
  assert.ok(slate.source.url.includes('olbg.com'));
  assert.match(slate.source.fetched_at_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('every event row carries the fields the UI renders', () => {
  for (const ev of slate.events) {
    assert.ok(ev.event_id, 'event_id');
    assert.ok(ev.home && ev.away, `players on ${ev.event_id}`);
    assert.ok(ev.display_date && ev.display_time, `time on ${ev.event_id}`);
    assert.match(ev.resolved_date, /^\d{4}-\d{2}-\d{2}$/, `resolved_date on ${ev.event_id}`);
    assert.ok(['observed', 'derived'].includes(ev.date_basis), `date_basis on ${ev.event_id}`);
    assert.ok(ev.url.startsWith('https://www.olbg.com/'), `source url on ${ev.event_id}`);
  }
});

test('event ids are unique', () => {
  const ids = slate.events.map((e) => e.event_id);
  assert.equal(new Set(ids).size, ids.length);
});

test('no odds values are present anywhere in the snapshot (OLBG exposes none)', () => {
  // Guards against a future edit silently introducing an invented price.
  const blob = JSON.stringify(slate);
  assert.equal(/"(decimal|american)"\s*:/.test(blob), false, 'found an odds field in slate.json');
});

test('join produces one engine match per event, with nulls where nothing is sourced', () => {
  const matches = slateToMatches(slate, players);
  assert.equal(matches.length, slate.events.length);
  const m = matches[0];
  assert.equal(m.players.length, 2);
  assert.equal(m.players[0].name, slate.events[0].home);
  assert.equal(m.players[0].rank, null);
  assert.equal(m.players[0].odds, null);
  assert.equal(m.surface, null);
  assert.equal(m.tournament, null);
});

test('join never fabricates a statistic that is not in the players store', () => {
  const store = { players: { 'ada lovelace': { rank: 7 } }, h2h: {} };
  const m = toMatch({ event_id: 'x', home: 'Ada Lovelace', away: 'Grace Hopper', display_date: 'Today', display_time: '10:00' }, store);
  assert.equal(m.players[0].rank, 7);
  assert.equal(m.players[1].rank, null);
  assert.equal(m.players[0].odds, null);
  assert.equal(m.opponentRank, 7, 'opponent rank falls back to the only sourced rank');
});

test('phaseOf only distinguishes upcoming from past-due', () => {
  assert.equal(phaseOf({ resolved_date: '2020-01-01' }, '2026-08-31'), 'results');
  assert.equal(phaseOf({ resolved_date: '2026-09-01' }, '2026-08-31'), 'upcoming');
  assert.equal(phaseOf({}, '2026-08-31'), 'unknown');
});

test('with no player statistics the whole slate is honestly unscored, not guessed', () => {
  const matches = slateToMatches(slate, players);
  for (const m of matches) {
    const r = scoreMatch(m);
    assert.equal(r.favourite, null, `${m.home} v ${m.away} should be unscored without a price or ranking`);
    assert.deepEqual(r.markets, {});
  }
});

test('writeCard on the current snapshot produces no invented tips', () => {
  const card = scoreCard(slateToMatches(slate, players));
  const { tips, unscored } = writeCard(card.results);
  // Every match is unscored, so there are no markets to write about at all.
  assert.equal(tips.length, 0, 'an unscored card must not generate tips');
  assert.equal(unscored.length, slate.events.length, 'every match should be reported as unscored exactly once');
  for (const u of unscored) assert.ok(u.reason.includes('no sourced price or ranking'));
});

test('the moment a ranking exists, the engine scores rather than refusing', () => {
  const store = {
    players: {
      'carlos alcaraz': { rank: 2, odds: { decimal: 1.25, american: -400 } },
      'roman safiullin': { rank: 60, odds: { decimal: 4.0, american: 300 } },
    },
    h2h: {},
  };
  const ev = slate.events.find((e) => e.event_id === '899350');
  assert.ok(ev, 'event 899350 (Safiullin v Alcaraz) must be in the snapshot');
  const m = toMatch(ev, store);
  const r = scoreMatch(m);
  assert.equal(r.favourite, 'Carlos Alcaraz');
  assert.ok(r.markets.win_match.score > 0);
  // Still missing almost everything, so confidence must stay LOW.
  assert.equal(r.markets.win_match.band, 'LOW');
  assert.ok(r.missing.length >= 4);
});

test('provenance file lists irregularities with ids and detail', () => {
  assert.ok(Array.isArray(provenance.irregularities) && provenance.irregularities.length >= 10);
  const ids = new Set();
  for (const ir of provenance.irregularities) {
    assert.match(ir.id, /^IR-\d+$/);
    assert.ok(!ids.has(ir.id), `duplicate irregularity id ${ir.id}`);
    ids.add(ir.id);
    assert.ok(ir.detail.length > 40, `${ir.id} detail too short`);
    assert.ok(['OPEN', 'NOTED', 'MITIGATED', 'RESOLVED IN CODE', 'OPEN — documented limitation', 'OPEN — assumption']
      .includes(ir.status), `${ir.id} has an undocumented status: ${ir.status}`);
  }
});

test('players.json declares the collection status of every factor group', () => {
  const groups = ['rank', 'odds', 'form', 'surface', 'serve', 'rest', 'h2h'];
  for (const g of groups) {
    assert.ok(players.collection_status[g], `no collection status for ${g}`);
    assert.match(players.collection_status[g], /NOT SOURCED|SOURCED/);
  }
  assert.deepEqual(players.players, {}, 'players store must start empty, not populated with guesses');
});
