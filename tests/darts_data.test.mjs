/**
 * Tests for the darts data layer: leak-free ordering, player-only profiles,
 * in-tournament classification, H2H orientation with last-three-years
 * weighting, stage and ranking lookups, and slate fixture handling.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sortKey, completedMatches, matchesBefore, roundTierFor,
  buildPlayerProfile, h2hBetween, rankFor, prepareFixture, fixturesFromSlate,
} from '../engine/darts_data.js';

const row = (over) => ({
  id: 'r1', date: '2026-08-28', event_start: '2026-08-28', event_end: '2026-08-30',
  event: '2026 Hungarian Darts Trophy', round: 'First round', round_index: 0, round_tier: 'r64',
  player_a: { name: 'Rob Cross', country: 'ENG' },
  player_b: { name: 'Beau Greaves', country: 'ENG' },
  score_a: 6, score_b: 5, winner: 'Rob Cross',
  ...over,
});

test('roundTierFor maps European Tour round labels', () => {
  assert.equal(roundTierFor('Final'), 'final');
  assert.equal(roundTierFor('Semi-final'), 'semi');
  assert.equal(roundTierFor('Quarter-final'), 'qf');
  assert.equal(roundTierFor('Third round'), 'r16');
  assert.equal(roundTierFor('Second round'), 'r32');
  assert.equal(roundTierFor('First round'), 'r64');
});

test('sortKey orders by observed date, then round index', () => {
  const a = row({ id: 'a', date: '2026-08-30', round_index: 5 });
  const b = row({ id: 'b', date: '2026-08-30', round_index: 2 });
  assert.ok(sortKey(b) < sortKey(a));
});

test('matchesBefore excludes the target match and only includes completed rows', () => {
  const tape = { matches: [
    row({ id: 'a', date: '2026-08-28' }),
    row({ id: 'b', date: '2026-08-29', winner: 'Rob Cross' }),
    row({ id: 'c', date: '2026-08-30', player_a: { name: 'X' }, player_b: { name: 'Y' }, winner: null, score_a: 0, score_b: 0 }),
  ] };
  assert.equal(completedMatches(tape).length, 2);
  const prior = matchesBefore(tape, { id: 'z', date: '2026-08-30', round_index: 2 });
  assert.equal(prior.length, 2);
  assert.deepEqual(prior.map((m) => m.id), ['b', 'a']);
});

test('buildPlayerProfile uses only the player\'s own matches, newest first', () => {
  const tape = { matches: [
    row({ id: 'p1', date: '2026-08-30', round_index: 3, player_a: { name: 'Ross Smith' }, player_b: { name: 'Dave Chisnall' }, winner: 'Ross Smith' }),
    row({ id: 'j1', date: '2026-08-30', round_index: 3, player_a: { name: 'Gary Anderson' }, player_b: { name: 'Gian van Veen' }, winner: 'Gary Anderson' }),
    row({ id: 'p2', date: '2026-08-30', round_index: 2, player_a: { name: 'Ross Smith' }, player_b: { name: 'Jonny Clayton' }, winner: 'Ross Smith', score_a: 6, score_b: 4 }),
  ] };
  const prof = buildPlayerProfile(matchesBefore(tape, { id: 'z', date: '2026-08-30', round_index: 5 }), { playerName: 'Ross Smith', eventName: '2026 Hungarian Darts Trophy' });
  assert.equal(prof.matchCount, 2);
  assert.deepEqual(prof.last5.map((m) => m.opponent), ['Dave Chisnall', 'Jonny Clayton']);
  assert.equal(prof.wins, 2);
});

test('h2hBetween counts only the pair and weights the last three years', () => {
  const tape = { matches: [
    row({ id: 'h1', player_a: { name: 'Ross Smith' }, player_b: { name: 'Gary Anderson' }, date: '2026-01-05', winner: 'Ross Smith' }),
    row({ id: 'h2', player_a: { name: 'Gary Anderson' }, player_b: { name: 'Ross Smith' }, date: '2022-01-05', winner: 'Gary Anderson' }),
    row({ id: 'h3', player_a: { name: 'Ross Smith' }, player_b: { name: 'Other' }, date: '2026-02-01', winner: 'Ross Smith' }),
  ] };
  const h = h2hBetween(completedMatches(tape), 'Ross Smith', 'Gary Anderson', { asOfISO: '2026-08-30' });
  assert.equal(h.total, 2);
  assert.equal(h.aWins, 1);
  assert.equal(h.bWins, 1);
  assert.equal(h.last3Years.total, 1);
  assert.equal(h.last3Years.aWins, 1);
});

test('rankFor matches names robustly and returns null when absent', () => {
  const doc = { entries: [{ rank: 15, name: 'Ross Smith' }] };
  assert.equal(rankFor(doc, 'Ross Smith'), 15);
  assert.equal(rankFor(doc, 'Beau Greaves'), null);
});

test('prepareFixture attaches ranks and zero-meeting H2H and excludes the target from prior form', () => {
  const tape = { matches: [
    row({ id: 'p1', date: '2026-08-28', player_a: { name: 'Rob Cross' }, player_b: { name: 'Beau Greaves' }, winner: 'Rob Cross' }),
    row({ id: 't', date: '2026-08-30', player_a: { name: 'Rob Cross' }, player_b: { name: 'Luke Humphries' }, winner: null, score_a: 0, score_b: 0 }),
  ] };
  const fx = { id: 'f1', dateISO: '2026-08-30', date: '2026-08-30', round: 'Second round', playerA: { name: 'Rob Cross' }, playerB: { name: 'Luke Humphries' } };
  const prep = prepareFixture(fx, { tape, rankings: { entries: [{ rank: 22, name: 'Rob Cross' }, { rank: 2, name: 'Luke Humphries' }] }, asOfISO: '2026-08-30' });
  assert.equal(prep.match.playerA.rank, 22);
  assert.equal(prep.match.playerB.rank, 2);
  assert.equal(prep.profiles.a.matchCount, 1);
  assert.equal(prep.h2h.total, 0);
  assert.equal(prep.roundTier, 'r32');
});

test('fixturesFromSlate ignores outrights and player-less events', () => {
  const slate = { source: { fetched_at_utc: '2026-09-03T02:00:00Z' }, events: [
    { event_id: '1', type: 'match', url: 'https://x', playerA: { name: 'A' }, playerB: { name: 'B' }, dateISO: '2026-09-04' },
    { event_id: '31293', type: 'outright', url: 'https://x', matchup: 'World Series of Darts Finals' },
    { event_id: '2', url: 'https://x' },
  ] };
  const out = fixturesFromSlate(slate);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'olbg-1');
  assert.equal(out[0].dateISO, '2026-09-04');
});
