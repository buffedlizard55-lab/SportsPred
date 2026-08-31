/**
 * Tests for tournament level/round coding and the head-to-head shaping.
 *
 * The central property under test is restraint: when a level cannot be
 * established from evidence the coder must return null rather than promote
 * an unknown event to a scoring tier.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { codeLevel, codeRound, codeStage, h2hForEngine, GRAND_SLAMS } from '../engine/tournament.js';

const here = dirname(fileURLToPath(import.meta.url));
const surfaces = JSON.parse(readFileSync(join(here, '../data/surfaces.json'), 'utf8'));

test('the four majors are coded as Grand Slams', () => {
  for (const n of ['Australian Open', 'Roland Garros', 'Wimbledon', 'US Open']) {
    assert.equal(codeLevel(n, 'Round 1', null).level, 'GS', n);
  }
  assert.equal(GRAND_SLAMS.length, 5); // includes the "French Open" alias
});

test('qualifying is detected from the round and outranks the event name', () => {
  const r = codeLevel('US Open', 'Qualifying 1st Round', null);
  assert.equal(r.level, 'Q');
  assert.match(r.basis, /qualifying/);
});

test('challenger and ITF tiers are read from the name', () => {
  assert.equal(codeLevel('Aix-en-Provence Challenger', 'Round 1', null).level, 'CH');
  assert.equal(codeLevel('W50 Pazardzhik', 'Round 1', null).level, 'ITF');
});

test('an unknown event with no recorded level stays null', () => {
  const r = codeLevel('Fictional Invitational', 'Round 1', null);
  assert.equal(r.level, null);
  assert.match(r.basis, /no evidence/);
});

test('level falls back to tourney_level codes recorded in real match data', () => {
  const entry = surfaces.tournaments['atp|us open'];
  assert.deepEqual(entry.levels, ['G']);
  // Even under a name the closed slam list would not match, the recorded
  // level code still supplies the evidence.
  assert.equal(codeLevel('Flushing Meadows', 'Round 1', entry).level, 'GS');

  const masters = Object.values(surfaces.tournaments).find((t) => t.levels.includes('M'));
  assert.ok(masters, 'source data should contain Masters events');
  assert.equal(codeLevel(masters.name, 'Round 3', masters).level, 'M1000');
});

test('rounds map to draw positions', () => {
  assert.equal(codeRound('Final').round, 'F');
  assert.equal(codeRound('Semifinals').round, 'SF');
  assert.equal(codeRound('Quarterfinals').round, 'QF');
  assert.equal(codeRound('Round of 16').round, 'R16');
  assert.equal(codeRound('Round 1').round, 'R128');
  assert.equal(codeRound('Qualifying 1st Round').round, 'Q');
});

test('an unparseable round is reported, not invented', () => {
  const r = codeRound('Group Stage Playoff');
  assert.equal(r.round, null);
  assert.match(r.basis, /unrecognised/);
});

test('codeStage reports the basis for every coding decision', () => {
  const s = codeStage('US Open', 'Quarterfinals', surfaces.tournaments['atp|us open']);
  assert.equal(s.level, 'GS');
  assert.equal(s.round, 'QF');
  assert.ok(s.basis.level.length > 0);
  assert.ok(s.basis.round.length > 0);
});

/* ------------------------------------------------------------------ */

test('h2hForEngine counts wins by the LOWER-ranked player', () => {
  const h2h = { matches: 4, aWins: 3, bWins: 1, surfaceMatches: 3, surfaceAWins: 2 };
  // A is rank 50, B is rank 5 => A is the lower-ranked player.
  assert.equal(h2hForEngine(h2h, 50, 5).sameSurfaceLowerRankedWonOfLast3, 2);
  // Reverse the ranks: the lower-ranked player is now B, with 1 surface win.
  assert.equal(h2hForEngine(h2h, 5, 50).sameSurfaceLowerRankedWonOfLast3, 1);
});

test('h2hForEngine refuses to decide without both ranks', () => {
  const h2h = { matches: 2, aWins: 1, bWins: 1, surfaceMatches: 2, surfaceAWins: 1 };
  assert.equal(h2hForEngine(h2h, null, 5).sameSurfaceLowerRankedWonOfLast3, null);
  assert.equal(h2hForEngine(null, 1, 2), null);
});

test('h2hForEngine leaves the field unsourced when no same-surface meeting exists', () => {
  const h2h = { matches: 2, aWins: 2, bWins: 0, surfaceMatches: 0, surfaceAWins: 0 };
  assert.equal(h2hForEngine(h2h, 10, 20).sameSurfaceLowerRankedWonOfLast3, null);
});
