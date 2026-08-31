/**
 * Tests that ESPN-derived result records actually grade.
 *
 * A settlement record is only useful if `gradeOne` in scripts/backtest.mjs can
 * read it. The two have to agree on field NAMES and on the meaning of each
 * value, and that agreement is easy to break silently — the graded total simply
 * drops to zero and every pick reports "unsettled". These tests pin the contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gradeOne } from '../scripts/backtest.mjs';
import { parseScoreboard } from '../engine/espn.js';

/** One completed ESPN competition: Fearnley beats Carballes Baena 7-6 6-3. */
function completedPayload() {
  return {
    events: [{
      id: '189-2026',
      name: 'US Open',
      groupings: [{
        grouping: { slug: 'mens-singles', displayName: "Men's Singles" },
        competitions: [{
          id: '184607',
          date: '2026-08-24T15:05Z',
          status: { type: { state: 'post', completed: true, description: 'Final' } },
          venue: { fullName: 'New York, USA' },
          competitors: [
            {
              id: '11685',
              order: 1,
              winner: true,
              linescores: [{ value: 7, tiebreak: 7 }, { value: 6 }],
              athlete: { displayName: 'Jacob Fearnley' },
            },
            {
              id: '2012',
              order: 2,
              winner: false,
              linescores: [{ value: 6, tiebreak: 3 }, { value: 3 }],
              athlete: { displayName: 'Roberto Carballes Baena' },
            },
          ],
          tournamentId: 189,
          type: { text: "Men's Singles", slug: 'mens-singles' },
          round: { displayName: 'Qualifying 1st Round' },
        }],
      }],
    }],
  };
}

/**
 * Mirror of the settlement record built by scripts/collect_espn.mjs.
 * Kept in step deliberately: if the script changes shape, this test should
 * be updated in the same commit and will fail loudly if it is not.
 */
function toResultRecord(m) {
  const fsPlayer = m.first_set_winner_id
    ? (m.players.find((p) => p.espn_id === m.first_set_winner_id) || null)
    : null;
  return {
    event_id: m.competition_id,
    match: m.players.map((p) => p.name).join(' v '),
    date: m.date,
    winner: m.winner_name,
    winner_id: m.winner_id,
    firstSetWinner: fsPlayer?.name ?? null,
    straight_sets: m.straight_sets,
    gamesMargin: m.games_margin,
    sets: m.sets,
  };
}

const match = parseScoreboard(completedPayload(), 'atp')[0];
const record = toResultRecord(match);

test('an ESPN completed match yields a fully-populated result record', () => {
  assert.equal(record.winner, 'Jacob Fearnley');
  assert.equal(record.firstSetWinner, 'Jacob Fearnley');
  assert.equal(record.gamesMargin, 4);   // 13 games to 9
  assert.equal(record.straight_sets, true);
});

test('a correct win-match pick grades as settled and correct', () => {
  const g = gradeOne({ market: 'win_match', selection: 'Jacob Fearnley' }, record);
  assert.equal(g.status, 'settled');
  assert.equal(g.correct, true);
});

test('a wrong win-match pick grades as settled and incorrect', () => {
  const g = gradeOne({ market: 'win_match', selection: 'Roberto Carballes Baena' }, record);
  assert.equal(g.status, 'settled');
  assert.equal(g.correct, false);
});

test('first-set picks grade off the recorded first-set winner', () => {
  assert.equal(gradeOne({ market: 'first_set', selection: 'Jacob Fearnley' }, record).correct, true);
  assert.equal(gradeOne({ market: 'first_set', selection: 'Roberto Carballes Baena' }, record).correct, false);
});

test('an unsettled prediction is never guessed at', () => {
  assert.equal(gradeOne({ market: 'win_match', selection: 'Anyone' }, undefined).status, 'unsettled');
});

test('handicap picks stay void while no price or line can be sourced', () => {
  // IR-01: no odds source exists, so `line` is always null and the handicap
  // market must report void rather than being graded on an assumed line.
  const g = gradeOne({ market: 'games_handicap', selection: 'Jacob Fearnley', line: null }, record);
  assert.equal(g.status, 'void');
});

test('grading is insensitive to name spacing and case', () => {
  const g = gradeOne({ market: 'win_match', selection: '  jacob   fearnley ' }, record);
  assert.equal(g.correct, true);
});
