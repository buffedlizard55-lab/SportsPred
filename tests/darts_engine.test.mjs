/**
 * Tests for the darts specialist engine: every Step 2 tier from
 * "DARTS PREDICTION MASTER PROMPT v1.0" and every Step 3 rule. Each figure
 * is asserted against a constructed profile so no value can drift from the
 * prompt table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  oddsPoints, rankingPoints, stagePoints, averagePoints,
  scoreForm, scoreH2H, scoreRanking, scoreStage, scoreOddsSide, scoreAverage,
  scoreMatch, decideBet, confidenceFor,
  formLeans, h2hLeans, rankingLeans, averageLeans, CONFIDENCE, RULES,
} from '../engine/darts_engine.js';

const profile = (wins, { bonus = false, last5 = null, lastAverage = null, name = 'P' } = {}) => {
  const names = ['A', 'B', 'C', 'D', 'E'];
  const seq = [];
  for (let i = 0; i < 5; i += 1) seq.push({ winner: i < wins ? name : names[i % names.length] });
  return {
    name,
    last5: last5 || seq,
    inTournament: bonus ? [{ winner: name }, { winner: name }] : [{ winner: name }, { winner: 'X' }],
    lastAverage,
  };
};

const match = (over = {}) => ({
  id: 'm1',
  playerA: { name: 'Player A', country: 'ENG' },
  playerB: { name: 'Player B', country: 'NED' },
  event: 'Test Trophy',
  round: 'First round',
  ...over,
});

/* ------------------------------------------------------------ odds tiers */

test('oddsPoints follows the darts prompt table exactly', () => {
  assert.deepEqual(oddsPoints(-400), { points: 25, band: '-300 or lower' });
  assert.deepEqual(oddsPoints(-300), { points: 25, band: '-300 or lower' });
  assert.deepEqual(oddsPoints(-250), { points: 18, band: '-200 to -299' });
  assert.deepEqual(oddsPoints(-175), { points: 12, band: '-150 to -199' });
  assert.deepEqual(oddsPoints(-120), { points: 5, band: '-100 to -149' });
  assert.deepEqual(oddsPoints(-110), { points: 5, band: '-100 to -149' });
  assert.deepEqual(oddsPoints(null), { points: 0, band: 'near-even or unavailable' });
});

test('scoreOddsSide marks an absent price as missing, never as near-even', () => {
  const c = scoreOddsSide(null);
  assert.equal(c.points, 0);
  assert.equal(c.missing, true);
  assert.match(c.detail, /IR-DARTS-01/);
});

/* ------------------------------------------------------------ form tiers */

test('form tiers follow the prompt table and award the +5 in-tournament bonus', () => {
  assert.equal(scoreForm(profile(5), []).points, 20);
  assert.equal(scoreForm(profile(4), []).points, 14);
  assert.equal(scoreForm(profile(3), []).points, 8);
  assert.equal(scoreForm(profile(2), []).points, 0);
  assert.equal(scoreForm(profile(1), []).points, 0);
  assert.equal(scoreForm(profile(4, { bonus: true }), []).points, 19);
  assert.equal(scoreForm(profile(5, { bonus: true }), []).points, 25);
});

test('form with fewer than two completed matches is missing, not zero-tiered', () => {
  const missing = [];
  const c = scoreForm({ name: 'P', last5: [{ winner: 'P' }], inTournament: [] }, missing);
  assert.equal(c.missing, true);
  assert.equal(c.points, 0);
  assert.ok(missing.some((m) => m.includes('last-five form')));
});

test('formLeans needs at least three wins from the last five', () => {
  assert.equal(formLeans(profile(3)), true);
  assert.equal(formLeans(profile(2)), false);
  assert.equal(formLeans(profile(0)), false);
});

/* ------------------------------------------------------------ average */

test('averagePoints follows the prompt table', () => {
  assert.equal(averagePoints(101.9).points, 20);
  assert.equal(averagePoints(100).points, 20);
  assert.equal(averagePoints(96).points, 14);
  assert.equal(averagePoints(92).points, 8);
  assert.equal(averagePoints(88).points, 4);
  assert.equal(averagePoints(87.9).points, 0);
  assert.equal(averagePoints(null).points, 0);
});

test('scoreAverage is missing when no sourced figure exists (IR-DARTS-02)', () => {
  const missing = [];
  const c = scoreAverage({ name: 'P', lastAverage: null }, missing);
  assert.equal(c.missing, true);
  assert.equal(c.points, 0);
  assert.match(c.detail, /IR-DARTS-02/);
});

test('averageLeans requires a 2.00+ gap on both sourced averages', () => {
  assert.equal(averageLeans({ lastAverage: 101 }, { lastAverage: 98 }), true);
  assert.equal(averageLeans({ lastAverage: 99 }, { lastAverage: 98 }), false);
  assert.equal(averageLeans({ lastAverage: 101 }, { lastAverage: null }), false);
});

/* ------------------------------------------------------------ h2h tiers */

const h2h = (aWins, bWins, { a3 = aWins, b3 = bWins } = {}) => ({
  a: 'Player A', b: 'Player B', aWins, bWins, total: aWins + bWins,
  last3Years: { aWins: a3, bWins: b3, total: a3 + b3 },
});

test('h2h weighted toward the last three years follows the prompt tiers', () => {
  const missing = [];
  const c = scoreH2H(h2h(7, 3, { a3: 3, b3: 0 }), 'a', 'Player B', missing);
  assert.equal(c.points, 15);
  assert.match(c.detail, /70%\+ lead/);
});

test('h2h roughly-even tier awards 4 and trailing awards 0', () => {
  assert.equal(scoreH2H(h2h(5, 5), 'a', 'B', []).points, 4);
  assert.equal(scoreH2H(h2h(3, 7), 'a', 'B', []).points, 0);
});

test('zero meetings are missing — never guessed as even', () => {
  const missing = [];
  const c = scoreH2H(null, 'a', 'B', missing);
  assert.equal(c.missing, true);
  assert.equal(c.points, 0);
  assert.ok(missing.some((m) => m.includes('head-to-head')));
});

test('h2hLeans uses the last-three-years weighting', () => {
  assert.equal(h2hLeans(h2h(4, 4, { a3: 2, b3: 0 }), 'a'), true);
  assert.equal(h2hLeans(h2h(4, 4, { a3: 0, b3: 2 }), 'a'), false);
});

/* ---------------------------------------------------------- ranking tiers */

test('rankingPoints follows the Order of Merit table', () => {
  assert.equal(rankingPoints(1), 10);
  assert.equal(rankingPoints(4), 10);
  assert.equal(rankingPoints(5), 7);
  assert.equal(rankingPoints(8), 7);
  assert.equal(rankingPoints(9), 4);
  assert.equal(rankingPoints(16), 4);
  assert.equal(rankingPoints(17), 0);
  assert.equal(rankingPoints(null), 0);
});

test('ranking deducts 5 when the opponent is ranked higher, including vs unranked', () => {
  const lower = scoreRanking(30, 2);
  assert.equal(lower.points, -5);
  assert.match(lower.detail, /opponent ranked higher/);
  const higher = scoreRanking(2, 30);
  assert.equal(higher.points, 10);
  const unranked = scoreRanking(null, 15);
  assert.equal(unranked.points, -5);
});

test('rankingLeans is false when neither is ranked', () => {
  assert.equal(rankingLeans(15, null), true);
  assert.equal(rankingLeans(null, 15), false);
  assert.equal(rankingLeans(null, null), false);
});

/* --------------------------------------------------------------- stage */

test('stagePoints follows the prompt table: final/semi 10, QF 7, R16 4, early 0', () => {
  assert.equal(stagePoints('final'), 10);
  assert.equal(stagePoints('semi'), 10);
  assert.equal(stagePoints('qf'), 7);
  assert.equal(stagePoints('r16'), 4);
  assert.equal(stagePoints('r32'), 0);
  assert.equal(stagePoints('r64'), 0);
  assert.equal(scoreStage('final').points, 10);
  assert.equal(scoreStage('r32').points, 0);
});

/* ------------------------------------------------------------ scoreMatch */

test('scoreMatch scores both sides with the full component set and picks the lean', () => {
  const scored = scoreMatch(match({
    id: 'x',
    playerA: { name: 'P', country: 'ENG', rank: 15 },
    playerB: { name: 'J', country: 'NED' },
  }), {
    profiles: {
      a: profile(4, { bonus: true, name: 'P' }),
      b: profile(3, { name: 'J' }),
    },
    h2h: h2h(0, 0),
    roundTier: 'r32',
    odds: { a: null, b: null },
  });
  assert.equal(scored.sideA.components.find((c) => c.id === 'form').points, 19);
  assert.equal(scored.leanName, 'P');
  assert.equal(scored.decision.bet, 'SKIP');
  assert.ok(scored.sideA.components.find((c) => c.id === 'odds').missing);
  assert.ok(scored.sideA.components.find((c) => c.id === 'average').missing);
});

test('scoreMatch honours -300 profitability rule: 0-5 rank, full-bet shape', () => {
  const scored = scoreMatch(match({
    playerA: { name: 'P', rank: 1 },
    playerB: { name: 'J', rank: 30 },
  }), {
    profiles: {
      a: profile(5, { bonus: true, lastAverage: 102, name: 'P' }),
      b: profile(0, { name: 'J' }),
    },
    h2h: h2h(8, 2),
    roundTier: 'semi',
    odds: { a: -320, b: null },
  });
  assert.ok(scored.sideA.score >= 75);
  assert.equal(scored.decision.bet, 'FULL BET');
  assert.equal(scored.confidence.band, CONFIDENCE.HIGH);
});

/* ------------------------------------------------------------- decision */

test('decideBet follows Step 3 exactly', () => {
  assert.equal(decideBet({ score: 75, odds: -150, aligned: 3 }).bet, 'FULL BET');
  assert.equal(decideBet({ score: 70, odds: -150, aligned: 3 }).bet, 'FULL BET');
  assert.equal(decideBet({ score: 69, odds: -149, aligned: 3 }).bet, 'SMALL BET');
  assert.equal(decideBet({ score: 60, odds: -145, aligned: 2 }).bet, 'SMALL BET');
  assert.equal(decideBet({ score: 60, odds: -145, aligned: 1 }).bet, 'SKIP');
  assert.equal(decideBet({ score: 60, odds: -120, aligned: 2 }).bet, 'SKIP');
  assert.equal(decideBet({ score: 49, odds: -180, aligned: 3 }).bet, 'SKIP');
  assert.equal(decideBet({ score: 80, odds: null, aligned: 3 }).bet, 'SKIP');
  assert.equal(decideBet({ score: 74, odds: -300, aligned: 3 }).bet, 'SKIP');
  assert.equal(decideBet({ score: 75, odds: -300, aligned: 3 }).bet, 'FULL BET');
  assert.equal(RULES.full.minScore, 70);
  assert.equal(RULES.profitability.minScore, 75);
});

test('confidence bands: HIGH gated on measured price, missing odds cap at MEDIUM', () => {
  const lean = { score: 80, measured: 3 };
  assert.equal(confidenceFor(lean, { oddsForLean: -200 }).band, CONFIDENCE.HIGH);
  assert.equal(confidenceFor(lean, { oddsForLean: null }).band, CONFIDENCE.MEDIUM);
  const shallow = { score: 80, measured: 1 };
  assert.equal(confidenceFor(shallow, { oddsForLean: -200 }).band, CONFIDENCE.LOW);
  assert.equal(confidenceFor({ score: 60, measured: 2 }, { oddsForLean: null }).band, CONFIDENCE.MEDIUM);
  assert.equal(confidenceFor({ score: 50, measured: 2 }, { oddsForLean: null }).band, CONFIDENCE.LOW);
  assert.equal(confidenceFor({ score: 20, measured: 2 }, { oddsForLean: null }).band, CONFIDENCE.SKIP);
});
