/**
 * Tests for the historical feature builder and grader.
 *
 * These run with no network. They verify that every feature is computed from
 * strictly prior matches (walk-forward), that the Sackmann score format is
 * parsed correctly, and that grading/aggregation maths are correct.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCSV, parseSets, winnerTookFirstSet, winnerStraightSets,
  buildFeatures, gradeResult, aggregate,
} from '../scripts/lib/historical.mjs';
import { scoreMatch } from '../engine/engine.js';

test('parseCSV is quote-aware', () => {
  const rows = parseCSV('a,b,c\n1,"x,y",3\n2,"p""q",4\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { a: '1', b: 'x,y', c: '3' });
  assert.deepEqual(rows[1], { a: '2', b: 'p"q', c: '4' });
});

test('parseSets handles straight, tiebreak, retirement and walkover', () => {
  assert.deepEqual(parseSets('6-4 6-3'), { winner: [6, 6], loser: [4, 3], retired: false, walkover: false });
  const tb = parseSets('6-4 6-7(5) 6-3');
  assert.deepEqual(tb.winner, [6, 6, 6]);
  assert.deepEqual(tb.loser, [4, 7, 3]);
  assert.equal(parseSets('6-4 3-0 RET').retired, true);
  assert.equal(parseSets('W/O').walkover, true);
});

test('winnerTookFirstSet and winnerStraightSets', () => {
  const straight = parseSets('6-4 6-3');
  assert.equal(winnerTookFirstSet(straight), true);
  assert.equal(winnerStraightSets(straight, 3), true);

  const lostFirst = parseSets('4-6 6-3 6-2');
  assert.equal(winnerTookFirstSet(lostFirst), false);
  assert.equal(winnerStraightSets(lostFirst, 3), false);

  const fiveSet = parseSets('6-4 6-3 6-2');
  assert.equal(winnerStraightSets(fiveSet, 5), true);
  assert.equal(winnerStraightSets(parseSets('6-4 4-6 6-3 7-5'), 5), false);
});

function row(over) {
  return {
    tourney_id: 'T', tourney_name: 'Test', surface: 'Hard', draw_size: 32,
    tourney_level: 'A', tourney_date: over.date, match_num: over.n,
    winner_name: over.winner, loser_name: over.loser,
    winner_rank: over.wRank, loser_rank: over.lRank,
    winner_seed: '', loser_seed: '', score: over.score, best_of: 3, round: 'F',
    minutes: '', w_ace: '5', w_df: '0', w_svpt: '60', w_1stIn: '40',
    w_1stWon: '', w_2ndWon: '', w_SvGms: '', w_bpSaved: '', w_bpFaced: '',
    l_ace: '3', l_df: '0', l_svpt: '58', l_1stIn: '35',
    l_1stWon: '', l_2ndWon: '', l_SvGms: '', l_bpSaved: '', l_bpFaced: '',
  };
}

test('buildFeatures computes last-5 form and surface record from prior matches only', () => {
  const rows = [];
  // Alice (rank 5) beats five different opponents on hard over the prior weeks.
  const opps = ['B', 'C', 'D', 'E', 'F'];
  opps.forEach((opp, i) => {
    rows.push(row({
      date: `202501${String(10 + i).padStart(2, '0')}`, n: i + 1,
      winner: 'Alice', loser: opp, wRank: 5, lRank: 200 + i, score: '6-4 6-3',
    }));
  });
  // The scored match: Alice vs Bob.
  rows.push(row({
    date: '20250201', n: 1, winner: 'Alice', loser: 'Bob',
    wRank: 5, lRank: 50, score: '6-4 6-3',
  }));

  const { matches, excluded } = buildFeatures(rows);
  assert.equal(excluded.length, 0);
  assert.equal(matches.length, 6);
  const last = matches[matches.length - 1].match;
  const alice = last.players.find((p) => p.name === 'Alice');
  assert.deepEqual(alice.form.last5, ['W', 'W', 'W', 'W', 'W']);
  assert.deepEqual(alice.form.straightSetsLast3, [true, true, true]);
  assert.equal(alice.surface.wins, 5);
  assert.equal(alice.surface.losses, 0);
  assert.equal(alice.form.firstSetWinRateLast10, 1);
  // Bob has no prior matches: his form must be null, not invented.
  const bob = last.players.find((p) => p.name === 'Bob');
  assert.equal(bob.form.last5, null);
  assert.equal(bob.surface.wins, 0);
});

test('buildFeatures does not look ahead', () => {
  const rows = [
    row({ date: '20250201', n: 1, winner: 'Alice', loser: 'Bob', wRank: 5, lRank: 50, score: '6-4 6-3' }),
    row({ date: '20250120', n: 1, winner: 'Alice', loser: 'Cara', wRank: 5, lRank: 120, score: '6-4 6-3' }),
  ];
  const { matches } = buildFeatures(rows);
  // After sorting, the scored match (Feb 1) is second; the Jan 20 win must be
  // visible as surface form for it.
  const scored = matches.find((m) => m.match.players.some((p) => p.name === 'Bob'));
  const alice = scored.match.players.find((p) => p.name === 'Alice');
  // last5 is only supplied when a full 5-match prior window exists — with one
  // prior win it must be null, never padded.
  assert.equal(alice.form.last5, null);
  assert.equal(alice.surface.wins, 1);
  assert.equal(alice.surface.losses, 0);
});

test('gradeResult marks the favourite correct only against the actual winner', () => {
  const rows = [
    row({ date: '20250120', n: 1, winner: 'Alice', loser: 'Cara', wRank: 5, lRank: 120, score: '6-4 6-3' }),
    row({ date: '20250201', n: 1, winner: 'Alice', loser: 'Bob', wRank: 5, lRank: 50, score: '6-4 6-3' }),
    row({ date: '20250210', n: 1, winner: 'Bob', loser: 'Alice', wRank: 50, lRank: 5, score: '7-6(4) 6-4' }),
  ];
  const { matches } = buildFeatures(rows);
  const results = matches.map(({ match }) => ({ match, result: scoreMatch(match) }));

  // Match 2: Alice (rank 5) is favourite and wins -> correct.
  const g2 = gradeResult(results[1].match, results[1].result);
  const wm2 = g2.find((g) => g.market === 'win_match');
  assert.equal(wm2.predicted, 'Alice');
  assert.equal(wm2.correct, true);

  // Match 3: Alice is still favourite but Bob wins -> incorrect.
  const g3 = gradeResult(results[2].match, results[2].result);
  const wm3 = g3.find((g) => g.market === 'win_match');
  assert.equal(wm3.predicted, 'Alice');
  assert.equal(wm3.correct, false);
});

test('aggregate computes hit rate and Brier', () => {
  const graded = [
    { market: 'win_match', band: 'HIGH', correct: true, rawScore: 80 },
    { market: 'win_match', band: 'HIGH', correct: false, rawScore: 75 },
    { market: 'win_match', band: 'LOW', correct: true, rawScore: 40 },
  ];
  const m = aggregate(graded);
  assert.equal(m.settled, 3);
  assert.ok(Math.abs(m.hitRate - 2 / 3) < 1e-9);
  assert.ok(m.brier > 0);
  assert.equal(m.byBucket.length, 2); // 40 falls in 30-49, 75/80 in 70-100
});
