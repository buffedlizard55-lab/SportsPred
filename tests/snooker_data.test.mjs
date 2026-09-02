/**
 * Tests for the snooker data layer: leak-free ordering, player-only profiles,
 * in-tournament classification, H2H orientation with last-three-years
 * weighting, stage and ranking lookups, and slate fixture handling.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sortKey, completedMatches, matchesBefore, roundTierFor,
  buildPlayerProfile, h2hBetween, rankFor, prepareFixture, fixturesFromSlate,
} from '../engine/snooker_data.js';

const row = (over) => ({
  id: 'r1', date: '2026-09-01', event_start: '2026-08-31', event_end: '2026-09-06',
  event: 'Unibet British Open 2026', round: 'Round 2', round_index: 1, round_tier: 'r64',
  player_a: { name: 'Pang Junxu', country: 'CHN' },
  player_b: { name: 'Liam Graham', country: 'SCO' },
  score_a: 4, score_b: 2, winner: 'Pang Junxu',
  ...over,
});

test('roundTierFor maps the round labels used on the tour', () => {
  assert.equal(roundTierFor('Final'), 'final');
  assert.equal(roundTierFor('Semi-final'), 'semi');
  assert.equal(roundTierFor('Quarter-final'), 'qf');
  assert.equal(roundTierFor('Round 3 (Last 32)'), 'r32'); // explicit stage label in the tape
  assert.equal(roundTierFor('Round 3'), 'early'); // bare round numbers are never inferred as a stage
  assert.equal(roundTierFor('Qualifying Round 1'), 'qual');
});

test('sortKey orders by observed date, then event window + round index', () => {
  const a = row({ id: 'a', date: '2026-09-01' });
  const b = row({ id: 'b', date: null, event_end: '2026-08-30', round_index: 6 });
  assert.ok(sortKey(b) < sortKey(a));
  const c = row({ id: 'c', date: null, event_end: '2026-08-30', round_index: 4 });
  assert.ok(sortKey(c) < sortKey(b));
});

test('matchesBefore excludes the target match and only includes completed rows', () => {
  const tape = { matches: [
    row({ id: 'a', date: '2026-08-31' }),
    row({ id: 'b', date: null, event_end: '2026-08-30', winner: null, score_a: 1, score_b: 1 }), // draw counts as completed, ordered by event end
    row({ id: 'c', date: null, player_a: { name: 'X' }, player_b: { name: 'Y' }, winner: null, score_a: 0, score_b: 0 }),
  ] };
  assert.equal(completedMatches(tape).length, 2);
  const prior = matchesBefore(tape, { id: 'z', date: '2026-09-02' });
  assert.equal(prior.length, 2);
  assert.deepEqual(prior.map((m) => m.id), ['a', 'b']); // newest first
});

test('buildPlayerProfile uses only the player\'s own matches, newest first', () => {
  const tape = { matches: [
    row({ id: 'p1', date: '2026-09-01', player_a: { name: 'Pang Junxu' }, player_b: { name: 'Liam Graham' }, winner: 'Pang Junxu' }),
    row({ id: 'j1', date: '2026-09-01', player_a: { name: 'Mark Joyce' }, player_b: { name: 'Jordan Brown' }, winner: 'Mark Joyce' }),
    row({ id: 'p2', date: '2026-08-31', player_a: { name: 'Neil Robertson' }, player_b: { name: 'Pang Junxu' }, winner: 'Pang Junxu', score_a: 1, score_b: 4 }),
    row({ id: 'p3', date: '2026-08-29', player_a: { name: 'Mark Selby' }, player_b: { name: 'Pang Junxu' }, winner: 'Mark Selby', score_a: 5, score_b: 4 }),
    row({ id: 'p4', date: '2026-08-28', player_a: { name: 'Pang Junxu' }, player_b: { name: 'Shaun Murphy' }, winner: 'Pang Junxu' }),
  ] };
  const prof = buildPlayerProfile(matchesBefore(tape, { id: 'z', date: '2026-09-02' }), { playerName: 'Pang Junxu', eventName: 'Unibet British Open 2026' });
  assert.equal(prof.matchCount, 4);
  assert.deepEqual(prof.last5.map((m) => m.opponent), ['Liam Graham', 'Neil Robertson', 'Mark Selby', 'Shaun Murphy']);
  assert.equal(prof.wins, 3);
  assert.ok(prof.inTournament.every((m) => m.winner === 'Pang Junxu' || m.winner === 'Mark Selby' || m.winner === 'Shaun Murphy'));
});

test('h2hBetween counts only the pair and weights the last three years', () => {
  const tape = { matches: [
    row({ id: 'h1', player_a: { name: 'Pang Junxu' }, player_b: { name: 'Mark Joyce' }, date: '2026-01-05', winner: 'Pang Junxu' }),
    row({ id: 'h2', player_a: { name: 'Mark Joyce' }, player_b: { name: 'Pang Junxu' }, date: '2022-01-05', winner: 'Mark Joyce' }),
    row({ id: 'h3', player_a: { name: 'Pang Junxu' }, player_b: { name: 'Other' }, date: '2026-02-01', winner: 'Pang Junxu' }),
  ] };
  const h = h2hBetween(completedMatches(tape), 'Pang Junxu', 'Mark Joyce', { asOfISO: '2026-09-02' });
  assert.equal(h.total, 2);
  assert.equal(h.aWins, 1);
  assert.equal(h.bWins, 1);
  assert.equal(h.last3Years.total, 1);
  assert.equal(h.last3Years.aWins, 1);
});

test('rankFor matches names robustly and returns null when absent', () => {
  const doc = { entries: [{ rank: 27, name: 'Pang Junxu' }] };
  assert.equal(rankFor(doc, 'Pang Junxu'), 27);
  assert.equal(rankFor(doc, 'Mark Joyce'), null);
});

test('prepareFixture attaches ranks and zero-meeting H2H and excludes the target from prior form', () => {
  const tape = { matches: [
    row({ id: 'p1', date: '2026-09-01', player_a: { name: 'Pang Junxu' }, player_b: { name: 'Liam Graham' }, winner: 'Pang Junxu' }),
    row({ id: 't', date: '2026-09-02', player_a: { name: 'Pang Junxu' }, player_b: { name: 'Mark Joyce' }, winner: null, score_a: 0, score_b: 0 }),
  ] };
  const fx = { id: 'f1', dateISO: '2026-09-02', round: 'Round 3 (Last 32)', playerA: { name: 'Pang Junxu' }, playerB: { name: 'Mark Joyce' } };
  const prep = prepareFixture(fx, { tape, rankings: { entries: [{ rank: 27, name: 'Pang Junxu' }] }, asOfISO: '2026-09-02' });
  assert.equal(prep.match.playerA.rank, 27);
  assert.equal(prep.match.playerB.rank, null);
  assert.equal(prep.profiles.a.matchCount, 1);
  assert.equal(prep.h2h.total, 0);
  assert.equal(prep.roundTier, 'r32');
});

test('fixturesFromSlate ignores player-less events and normalises core fields', () => {
  const slate = { source: { fetched_at_utc: '2026-09-02T20:00:00Z' }, events: [
    { event_id: '1', url: 'https://x', playerA: { name: 'A' }, playerB: { name: 'B' }, dateISO: '2026-09-02' },
    { event_id: '2', url: 'https://x' },
  ] };
  const out = fixturesFromSlate(slate);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'olbg-1');
  assert.equal(out[0].dateISO, '2026-09-02');
});
