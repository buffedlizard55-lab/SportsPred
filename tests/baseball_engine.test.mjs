/**
 * Tests for engine/baseball_engine.js — BASEBALL PREDICTION MASTER PROMPT
 * v1.0 Step 2 (three markets) and Step 3 (decision rules).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreRecentForm, scoreStartingPitcher, scoreRunDifferential, scoreOddsAndValue,
  scoreHeadToHead, scoreWinMatchSide, scoreRunLineSide, scoreTotalMarket,
  decideWinMatch, decideRunLine, decideTotal, scoreBaseballMatch, scoreBaseballCard,
  decimalToAmerican, americanToImpliedProb, CONFIDENCE, MARKETS,
} from '../engine/baseball_engine.js';

const sum = (comps) => comps.reduce((a, c) => a + c.points, 0);

const fullTeam = (over = {}) => ({
  name: 'Tampa Bay Rays', abbrev: 'TB',
  form: { last5: ['W', 'W', 'W', 'W', 'L'], winStreak: 4 },
  runDiffPerGame: 2.7,
  runsPerGameRecent: 5.4,
  runsAgainstPerGameRecent: 2.7,
  avgWinMarginLast5Wins: 3.1,
  starter: {
    name: 'Starter One', era: 2.62, confirmed: true,
    qualityStartsLast4: 3, qualityStartsLast3: 2,
    avgInningsPerStart: 6.4, shortRest: false, pitchesLast2: false,
  },
  bullpenRank: 4, bullpenLeagueSize: 30,
  odds: { american: -200, decimal: 1.5 },
  ...over,
});

const weakTeam = (over = {}) => fullTeam({
  name: 'Chicago White Sox', abbrev: 'CWS',
  form: { last5: ['L', 'L', 'W', 'L', 'L'], winStreak: 0 },
  runDiffPerGame: -1.1,
  runsPerGameRecent: 3.2,
  runsAgainstPerGameRecent: 4.3,
  avgWinMarginLast5Wins: 1.1,
  starter: { name: 'Starter Two', era: 5.41, confirmed: true, qualityStartsLast4: 0, qualityStartsLast3: 0, avgInningsPerStart: 4.8, shortRest: true },
  bullpenRank: 27, bullpenLeagueSize: 30,
  odds: { american: 170, decimal: 2.7 },
  ...over,
});

const h2h = { meetings: 10, winsA: 7, winsB: 3, last10WinsA: 7, last10WinsB: 3, last3StreakA: true, last3StreakB: false };

/* ---------------- Step 2a: recent form (25) ---------------- */

test('form: four or more wins in five scores 25, with streak and collapse bonuses', () => {
  const missing = [];
  const r = scoreRecentForm({ form: { last5: ['W', 'W', 'W', 'W', 'W'], winStreak: 5 } }, { form: { last5: ['L', 'L', 'L', 'L', 'W'] } }, missing);
  assert.equal(r.components[0].points, 25);
  assert.equal(sum(r.components), 25 + 5 + 4);
});

test('form: the 3/5, 2/5 and 1-or-fewer bands score 16, 7 and 0', () => {
  const missing = [];
  assert.equal(scoreRecentForm({ form: { last5: ['W', 'W', 'W', 'L', 'L'] } }, {}, missing).components[0].points, 16);
  assert.equal(scoreRecentForm({ form: { last5: ['W', 'W', 'L', 'L', 'L'] } }, {}, missing).components[0].points, 7);
  assert.equal(scoreRecentForm({ form: { last5: ['W', 'L', 'L', 'L', 'L'] } }, {}, missing).components[0].points, 0);
});

test('form: a missing last-five record is recorded, never guessed', () => {
  const missing = [];
  const r = scoreRecentForm({}, {}, missing);
  assert.equal(r.components[0].points, 0);
  assert.equal(r.components[0].missing, true);
  assert.ok(missing.length >= 1);
});

/* ---------------- Step 2a: starting pitcher (25) ---------------- */

test('starter: sub-3.00 ERA with two quality starts in the last four scores 25', () => {
  const missing = [];
  const r = scoreStartingPitcher({ starter: { era: 2.62, confirmed: true, qualityStartsLast4: 2 } }, {}, missing);
  assert.equal(r.components[0].points, 25);
});

test('starter: 3.00-3.99 band with one quality start in the last three scores 17', () => {
  const missing = [];
  const r = scoreStartingPitcher({ starter: { era: 3.5, confirmed: true, qualityStartsLast3: 1 } }, {}, missing);
  assert.equal(r.components[0].points, 17);
});

test('starter: 4.00-4.99 band or inconsistent scores 9, 5.00+ scores 0, unconfirmed scores 0', () => {
  const missing = [];
  assert.equal(scoreStartingPitcher({ starter: { era: 4.4, confirmed: true } }, {}, missing).components[0].points, 9);
  assert.equal(scoreStartingPitcher({ starter: { era: 5.5, confirmed: true } }, {}, missing).components[0].points, 0);
  assert.equal(scoreStartingPitcher({ starter: { era: 2.1, confirmed: false } }, {}, missing).components[0].points, 0);
});

test('starter: short rest deducts 8', () => {
  const missing = [];
  const r = scoreStartingPitcher({ starter: { era: 2.5, confirmed: true, qualityStartsLast4: 3, shortRest: true } }, {}, missing);
  assert.equal(sum(r.components), 25 - 8);
});

test('starter: opposing lineup below .235 vs handedness adds 5', () => {
  const missing = [];
  const r = scoreStartingPitcher(
    { starter: { era: 2.5, confirmed: true, qualityStartsLast4: 3 } },
    { vsStarterHandednessAvg: 0.21 }, missing);
  assert.equal(sum(r.components), 25 + 5);
});

/* ---------------- Step 2a: run differential (20) ---------------- */

test('run differential: bands 20/13/7/0 and the negative-opponent bonus', () => {
  const missing = [];
  assert.equal(scoreRunDifferential({ runDiffPerGame: 2.6 }, { runDiffPerGame: 0.4 }, missing).components[0].points, 20);
  assert.equal(scoreRunDifferential({ runDiffPerGame: 1.7 }, {}, missing).components[0].points, 13);
  assert.equal(scoreRunDifferential({ runDiffPerGame: 0.9 }, {}, missing).components[0].points, 7);
  const neg = scoreRunDifferential({ runDiffPerGame: 1.0 }, { runDiffPerGame: -0.5 }, missing);
  assert.equal(sum(neg.components), 7 + 4);
});

/* ---------------- Step 2a: odds and value (20) ---------------- */

test('odds: -200 or lower scores 20, -150..-199 scores 14, -100..-149 scores 9', () => {
  const missing = [];
  assert.equal(scoreOddsAndValue({ odds: { american: -200 } }, {}, null, missing).components[0].points, 20);
  assert.equal(scoreOddsAndValue({ odds: { american: -160 } }, {}, null, missing).components[0].points, 14);
  assert.equal(scoreOddsAndValue({ odds: { american: -120 } }, {}, null, missing).components[0].points, 9);
});

test('odds: underdog with run differential advantage and superior form scores 14 and flags value', () => {
  const missing = [];
  const r = scoreOddsAndValue(
    { odds: { american: 150 }, runDiffPerGame: 1.2 },
    { runDiffPerGame: -0.8, form: { last5: ['L', 'L', 'L', 'L', 'L'] } }, 4, missing);
  assert.equal(r.components[0].points, 14);
  assert.equal(r.underdogValue, true);
});

test('odds: a missing price is recorded as missing, never guessed', () => {
  const missing = [];
  const r = scoreOddsAndValue({}, {}, null, missing);
  assert.equal(r.components[0].points, 0);
  assert.equal(r.components[0].missing, true);
});

/* ---------------- Step 2a: head-to-head (10) ---------------- */

test('head-to-head: 6+ of last 10 scores 10 with the last-3 streak bonus', () => {
  const missing = [];
  const r = scoreHeadToHead({}, { meetings: 10, winsA: 7, last10WinsA: 7, last3StreakA: true }, missing);
  assert.equal(r.components[0].points, 10);
  assert.equal(sum(r.components), 10 + 3);
});

test('head-to-head: 5 of 10 scores 6, trailing scores 2', () => {
  const missing = [];
  assert.equal(scoreHeadToHead({}, { meetings: 10, winsA: 5, last10WinsA: 5, last3StreakA: false }, missing).components[0].points, 6);
  assert.equal(scoreHeadToHead({}, { meetings: 10, winsA: 3, last10WinsA: 3, last3StreakA: false }, missing).components[0].points, 2);
});

/* ---------------- Step 2b: run line ---------------- */

test('run line: replaces head-to-head with run-margin analysis and caps at 100', () => {
  const missing = [];
  const winSide = scoreWinMatchSide(fullTeam(), weakTeam(), h2h, missing);
  const r = scoreRunLineSide(fullTeam(), weakTeam(), winSide, h2h, missing);
  assert.ok(r.components.some((c) => c.id === 'run_margin'));
  assert.equal(r.components.find((c) => c.id === 'run_margin').points, 20);
  assert.ok(r.score <= 100);
  assert.equal(r.supportsCovering, true);
});

test('run line: a sub-2-run winning margin cannot cover -1.5', () => {
  const r = scoreRunLineSide(weakTeam(), fullTeam(), null, h2h, []);
  assert.equal(r.supportsCovering, false);
});

/* ---------------- Step 2c: game total ---------------- */

test('total: two 5-run offences and two high-ERA starters lean Over', () => {
  const match = {
    home: fullTeam({ starter: { name: 'S', era: 5.0, confirmed: true } }),
    away: fullTeam({ name: 'B', abbrev: 'B', starter: { name: 'S2', era: 5.2, confirmed: true } }),
    venueIndoor: false, wind: null,
  };
  const missing = [];
  const t = scoreTotalMarket(match, missing);
  assert.ok(t.overScore > t.underScore);
});

test('total: two sub-3.50 starters push the Under ledger', () => {
  const match = {
    home: fullTeam({ runsPerGameRecent: 3.1, runsAgainstPerGameRecent: 3.0 }),
    away: fullTeam({ name: 'B', abbrev: 'B', runsPerGameRecent: 3.0, runsAgainstPerGameRecent: 3.2 }),
    venueIndoor: true, wind: null,
  };
  const missing = [];
  const t = scoreTotalMarket(match, missing);
  assert.ok(t.underScore >= 25);
});

/* ---------------- Step 3: decisions ---------------- */

test('win decision: 70+ is HIGH, 55-69 with two strong factors is MEDIUM, below 55 is SKIP', () => {
  assert.equal(decideWinMatch({ score: 72, american: null, strongFactors: 3 }, {}).confidence, CONFIDENCE.HIGH);
  assert.equal(decideWinMatch({ score: 60, american: null, strongFactors: 2 }, {}).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideWinMatch({ score: 60, american: null, strongFactors: 1 }, {}).confidence, CONFIDENCE.SKIP);
  assert.equal(decideWinMatch({ score: 40, american: null, strongFactors: 0 }, {}).confidence, CONFIDENCE.SKIP);
});

test('win decision: a -300+ favourite without max starter and high run diff is SKIP', () => {
  assert.equal(decideWinMatch({ score: 85, american: -320, starterMax: false, runDiffPerGame: 1.0 }, {}).confidence, CONFIDENCE.SKIP);
  assert.equal(decideWinMatch({ score: 85, american: -320, starterMax: true, runDiffPerGame: 3.0 }, {}).confidence, CONFIDENCE.HIGH);
});

test('run line decision: needs win score 60 and covering margins', () => {
  assert.equal(decideRunLine(75, 61, true).confidence, CONFIDENCE.HIGH);
  assert.equal(decideRunLine(60, 61, true).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideRunLine(75, 40, true).confidence, CONFIDENCE.SKIP);
  assert.equal(decideRunLine(75, 61, false).confidence, CONFIDENCE.SKIP);
});

test('total decision: 20+ advantage HIGH, 15-19 MEDIUM, below 15 SKIP', () => {
  assert.equal(decideTotal({ overScore: 55, underScore: 30 }).confidence, CONFIDENCE.HIGH);
  assert.equal(decideTotal({ overScore: 45, underScore: 28 }).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideTotal({ overScore: 40, underScore: 30 }).confidence, CONFIDENCE.SKIP);
  assert.equal(decideTotal({ overScore: 10, underScore: 10 }).side, null);
});

/* ---------------- match + card ---------------- */

test('a match with no competitor names returns the UNSCORED sentinel', () => {
  const r = scoreBaseballMatch({ id: 'x', home: {}, away: {} });
  assert.equal(r.unscored, true);
});

test('a fully-sourced match scores all three markets and favours the stronger side', () => {
  const r = scoreBaseballMatch({ id: 'g1', dateISO: '2026-09-04', startUtc: '2026-09-04T18:10Z', home: fullTeam(), away: weakTeam(), h2h });
  assert.equal(r.favoured, 'Tampa Bay Rays');
  assert.ok(r.winMatch.favourite.score > r.winMatch.underdog.score);
  assert.ok(Array.isArray(r.total.over));
});

test('scoreBaseballCard returns the prompt and one result per match', () => {
  const card = scoreBaseballCard([
    { id: 'a', home: fullTeam(), away: weakTeam(), h2h },
    { id: 'b', home: fullTeam({ name: 'X' }), away: weakTeam({ name: 'Y' }), h2h },
  ]);
  assert.equal(card.prompt, 'BASEBALL PREDICTION MASTER PROMPT v1.0');
  assert.equal(card.results.length, 2);
});

test('odds helpers convert and de-vig', () => {
  assert.equal(decimalToAmerican(2.0), 100);
  assert.equal(decimalToAmerican(1.5), -200);
  assert.equal(Math.round(americanToImpliedProb(-200) * 1000), 667);
});
