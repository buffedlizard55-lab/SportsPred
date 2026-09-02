/**
 * Tests for the snooker specialist engine: every Step 2 tier from
 * "SNOOKER PREDICTION MASTER PROMPT v3.0" and every Step 3 rule. Each figure
 * is asserted against a constructed profile so no value can drift from the
 * prompt table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  oddsPoints, rankingPoints, stagePoints, scoreForm, scoreH2H, scoreRanking,
  scoreStage, scoreOddsSide, scoreSide, scoreMatch, decideBet, confidenceFor,
  formLeans, h2hLeans, rankingLeans, CONFIDENCE, RULES,
} from '../engine/snooker_engine.js';

const profile = (wins, { bonus = false, last5 = null } = {}) => {
  const names = ['A', 'B', 'C', 'D', 'E'];
  const seq = [];
  for (let i = 0; i < 5; i += 1) seq.push({ winner: i < wins ? 'P' : names[i % names.length] });
  return {
    name: 'P',
    last5: last5 || seq,
    inTournament: bonus ? [{ winner: 'P' }, { winner: 'P' }] : [{ winner: 'P' }, { winner: 'X' }],
  };
};

const match = (over = {}) => ({
  id: 'm1',
  playerA: { name: 'Player A', country: 'ENG' },
  playerB: { name: 'Player B', country: 'CHN' },
  event: 'Test Trophy',
  round: 'Round 1',
  ...over,
});

/* ------------------------------------------------------------ odds tiers */

test('oddsPoints follows the prompt table exactly', () => {
  assert.deepEqual(oddsPoints(-400), { points: 30, band: '-300 or lower' });
  assert.deepEqual(oddsPoints(-300), { points: 30, band: '-300 or lower' });
  assert.deepEqual(oddsPoints(-250), { points: 22, band: '-200 to -299' });
  assert.deepEqual(oddsPoints(-175), { points: 14, band: '-150 to -199' });
  assert.deepEqual(oddsPoints(-120), { points: 6, band: '-100 to -149' });
  assert.deepEqual(oddsPoints(-110), { points: 6, band: '-100 to -149' });
  assert.deepEqual(oddsPoints(null), { points: 0, band: 'near-even or unavailable' });
});

test('scoreOddsSide marks an absent price as missing, never as near-even', () => {
  const c = scoreOddsSide(null);
  assert.equal(c.points, 0);
  assert.equal(c.missing, true);
});

/* ------------------------------------------------------------ form tiers */

test('form tiers follow the prompt table and award the +5 in-tournament bonus', () => {
  assert.equal(scoreForm(profile(5), []).points, 25);
  assert.equal(scoreForm(profile(4), []).points, 18);
  assert.equal(scoreForm(profile(3), []).points, 10);
  assert.equal(scoreForm(profile(2), []).points, 0);
  assert.equal(scoreForm(profile(1), []).points, 0);
  // 4/5 plus undefeated in-tournament = 18 + 5.
  assert.equal(scoreForm(profile(4, { bonus: true }), []).points, 23);
  // 5/5 plus bonus capped at the 30 max.
  assert.equal(scoreForm(profile(5, { bonus: true }), []).points, 30);
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

/* ------------------------------------------------------------ h2h tiers */

const h2h = (aWins, bWins, { a3 = aWins, b3 = bWins } = {}) => ({
  a: 'Player A', b: 'Player B', aWins, bWins, total: aWins + bWins,
  last3Years: { aWins: a3, bWins: b3, total: a3 + b3 },
});

test('h2h weighted toward the last three years follows the prompt tiers', () => {
  const missing = [];
  const c = scoreH2H(h2h(7, 3, { a3: 3, b3: 0 }), 'a', 'Player B', missing); // 10/10 weighted
  assert.equal(c.points, 20);
  assert.match(c.detail, /70%\+ lead/);
});

test('h2h roughly-even tier awards 5 and trailing awards 0', () => {
  assert.equal(scoreH2H(h2h(5, 5), 'a', 'B', []).points, 5);
  assert.equal(scoreH2H(h2h(3, 7), 'a', 'B', []).points, 0);
});

test('zero meetings are missing — the prompt has no tier for "no history" and it is never guessed', () => {
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

test('rankingPoints follows the prompt table', () => {
  assert.equal(rankingPoints(1), 15);
  assert.equal(rankingPoints(5), 15);
  assert.equal(rankingPoints(6), 10);
  assert.equal(rankingPoints(10), 10);
  assert.equal(rankingPoints(11), 5);
  assert.equal(rankingPoints(20), 5);
  assert.equal(rankingPoints(21), 0);
  assert.equal(rankingPoints(27), 0);
  assert.equal(rankingPoints(null), 0);
});

test('ranking deducts 5 when the opponent is ranked higher, including vs unranked', () => {
  // Rank 30 vs opponent ranked 2 -> opponent higher -> 0 - 5.
  const lower = scoreRanking(30, 2);
  assert.equal(lower.points, -5);
  assert.match(lower.detail, /opponent ranked higher/);
  // Rank 2 vs opponent ranked 30 -> own ranking higher -> no deduction.
  const higher = scoreRanking(2, 30);
  assert.equal(higher.points, 15);
  // Unranked vs ranked opponent -> opponent is higher -> deduct 5.
  const unranked = scoreRanking(null, 27);
  assert.equal(unranked.points, -5);
  assert.match(unranked.detail, /opponent ranked higher/);
});

test('rankingLeans is false when neither is ranked', () => {
  assert.equal(rankingLeans(27, null), true);
  assert.equal(rankingLeans(null, 27), false);
  assert.equal(rankingLeans(null, null), false);
});

/* --------------------------------------------------------------- stage */

test('stagePoints follows the prompt table: final/semi 10, QF 7, R16 4, early 0', () => {
  assert.equal(stagePoints('final'), 10);
  assert.equal(stagePoints('semi'), 10);
  assert.equal(stagePoints('qf'), 7);
  assert.equal(stagePoints('r16'), 4);
  assert.equal(stagePoints('r32'), 0);
  assert.equal(stagePoints('qual'), 0);
  assert.equal(scoreStage('final').points, 10);
  assert.equal(scoreStage('r32').points, 0);
});

/* ------------------------------------------------------------ scoreMatch */

test('scoreMatch scores both sides with the full component set and picks the lean', () => {
  const scored = scoreMatch(match({
    id: 'x',
    playerA: { name: 'P', country: 'CHN', rank: 27 },
    playerB: { name: 'J', country: 'ENG' },
  }), {
    profiles: {
      a: profile(4, { bonus: true }), // 18 + 5 = 23
      b: profile(3),                  // 10
    },
    h2h: h2h(0, 0),
    roundTier: 'r32',
    odds: { a: null, b: null },
  });
  assert.equal(scored.sideA.score, 23);
  assert.equal(scored.sideB.score, 5); // 10 - 5 opponent ranked higher
  assert.equal(scored.leanName, 'P');
  assert.equal(scored.score, 23);
  assert.equal(scored.aligned.includes('form'), true);
  assert.equal(scored.decision.bet, 'SKIP');
});

test('scoreMatch honours -300 profitability rule: 0-5 rank, full-bet shape', () => {
  const scored = scoreMatch(match({
    playerA: { name: 'P', rank: 3 },
    playerB: { name: 'J', rank: 30 },
  }), {
    profiles: { a: profile(5, { bonus: true }), b: profile(0) },
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
  assert.equal(decideBet({ score: 69, odds: -149, aligned: 3 }).bet, 'SMALL BET'); // -149 sits inside -130..-200
  assert.equal(decideBet({ score: 60, odds: -145, aligned: 2 }).bet, 'SMALL BET');
  assert.equal(decideBet({ score: 60, odds: -145, aligned: 1 }).bet, 'SKIP'); // needs 2+ aligned
  assert.equal(decideBet({ score: 60, odds: -120, aligned: 2 }).bet, 'SKIP'); // outside -130..-200
  assert.equal(decideBet({ score: 49, odds: -180, aligned: 3 }).bet, 'SKIP'); // below 50
  assert.equal(decideBet({ score: 80, odds: null, aligned: 3 }).bet, 'SKIP'); // no price
  assert.equal(decideBet({ score: 74, odds: -300, aligned: 3 }).bet, 'SKIP'); // profitability
  assert.equal(decideBet({ score: 75, odds: -300, aligned: 3 }).bet, 'FULL BET');
  assert.equal(RULES.full.minScore, 70);
  assert.equal(RULES.profitability.minScore, 75);
});

test('confidence bands: HIGH gated on measured price, missing odds cap at MEDIUM', () => {
  const lean = { score: 80, measured: 3 };
  assert.equal(confidenceFor(lean, { oddsForLean: -200 }).band, CONFIDENCE.HIGH);
  assert.equal(confidenceFor(lean, { oddsForLean: null }).band, CONFIDENCE.MEDIUM);
  const shallow = { score: 80, measured: 1 };
  assert.equal(confidenceFor(shallow, { oddsForLean: -200 }).band, CONFIDENCE.LOW); // <2 measured -> LOW
  assert.equal(confidenceFor({ score: 60, measured: 2 }, { oddsForLean: null }).band, CONFIDENCE.MEDIUM);
  assert.equal(confidenceFor({ score: 50, measured: 2 }, { oddsForLean: null }).band, CONFIDENCE.LOW);
  assert.equal(confidenceFor({ score: 20, measured: 2 }, { oddsForLean: null }).band, CONFIDENCE.SKIP);
});
