/**
 * Tests for engine/ice_hockey_engine.js — ICE HOCKEY PREDICTION MASTER PROMPT
 * v1.0 Step 2 (three markets) and Step 3 (decision rules), plus the subagent
 * modelling / risk / no-bet layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreRecentForm, scoreOddsAndValue, scoreGoaltending, scoreStructure, scoreHomeContext,
  scorePuckLineModifiers, scoreTotalMarket, totalLineGate, decideOutright, decidePuckLine,
  decideTotal, scoreIceHockeyMatch, scoreIceHockeyCard, scoreIceHockeyCardMixed,
  modelProbabilityFromOdds, buildConsensus, riskFilter,
  americanToImpliedProb, decimalToAmerican, CONFIDENCE, MAX_ACTIVE_PICKS_PER_DAY,
} from '../engine/ice_hockey_engine.js';

const sum = (comps) => comps.reduce((a, c) => a + c.points, 0);

const fullTeam = (over = {}) => ({
  name: 'Ottawa Senators', abbrev: 'OTT',
  form: { last5: ['W', 'W', 'W', 'W', 'L'], winStreak: 4 },
  odds: { american: -260, decimal: 1.385 },
  goaltender: { savePctg: 0.924, isBackup: false, confirmed: true, last5SavePctg: 0.921 },
  shotsForRank: 4, shotsAgainstRank: 9, leagueSize: 32,
  powerPlayPctg: 28.4, penaltyKillPctg: 81.2, powerPlayOpportunitiesPerGame: 3.6,
  homeWinPctg: 63.4, backToBack: false,
  goalsForPerGame: 3.62, avgWinMarginLast5Wins: 2.2,
  puckLineCovers: { of: 10, covered: 7 },
  injuries: { keyForwardLineMissing: false },
  ...over,
});

const weakTeam = (over = {}) => fullTeam({
  name: 'Philadelphia Flyers', abbrev: 'PHI',
  form: { last5: ['L', 'L', 'W', 'L', 'L'], winStreak: 0 },
  odds: { american: 220, decimal: 3.2 },
  goaltender: { savePctg: 0.896, isBackup: false, confirmed: true, last5SavePctg: 0.891 },
  shotsForRank: 24, shotsAgainstRank: 27,
  powerPlayPctg: 17.1, penaltyKillPctg: 71.0, powerPlayOpportunitiesPerGame: 3.4,
  homeWinPctg: 41.0, backToBack: true,
  goalsForPerGame: 3.55, avgWinMarginLast5Wins: 1.1,
  puckLineCovers: { of: 10, covered: 3 },
  injuries: { keyForwardLineMissing: true },
  ...over,
});

/* ---------------- Step 2: recent form (25pts) ---------------- */

test('form: five wins in five scores the full 25 points', () => {
  const missing = [];
  const r = scoreRecentForm({ form: { last5: ['W', 'W', 'W', 'W', 'W'] } }, { form: { last5: ['L', 'L', 'W', 'L', 'W'] } }, missing);
  assert.equal(r.components[0].points, 25);
  assert.equal(missing.length, 0);
});

test('form: the 4/5, 3/5 and 2-or-fewer bands score 18, 11 and 0', () => {
  const missing = [];
  assert.equal(scoreRecentForm({ form: { last5: ['W', 'W', 'W', 'W', 'L'] } }, {}, missing).components[0].points, 18);
  assert.equal(scoreRecentForm({ form: { last5: ['W', 'W', 'W', 'L', 'L'] } }, {}, missing).components[0].points, 11);
  assert.equal(scoreRecentForm({ form: { last5: ['W', 'L', 'L', 'L', 'L'] } }, {}, missing).components[0].points, 0);
});

test('form: streak bonus and opponent-collapse bonus are awarded separately', () => {
  const missing = [];
  const r = scoreRecentForm(
    { form: { last5: ['W', 'W', 'W', 'W', 'W'] } },
    { form: { last5: ['L', 'L', 'L', 'L', 'W'] } },
    missing
  );
  assert.equal(sum(r.components), 35); // 25 + 5 + 5
});

test('form: a missing last-five record is recorded, never guessed', () => {
  const missing = [];
  const r = scoreRecentForm({ name: 'X' }, { name: 'Y' }, missing);
  assert.equal(r.components[0].points, 0);
  assert.equal(r.components[0].missing, true);
  assert.match(missing[0], /form\.last5/);
});

/* ---------------- Step 2: odds and value (25pts) ---------------- */

test('odds bands: -300/-200/-150/-100 score 25/18/12/6', () => {
  const missing = [];
  assert.equal(scoreOddsAndValue({ odds: { american: -320 } }, 25, missing).components[0].points, 25);
  assert.equal(scoreOddsAndValue({ odds: { american: -240 } }, 25, missing).components[0].points, 18);
  assert.equal(scoreOddsAndValue({ odds: { american: -160 } }, 25, missing).components[0].points, 12);
  assert.equal(scoreOddsAndValue({ odds: { american: -120 } }, 25, missing).components[0].points, 6);
});

test('odds: plus price with strong form scores 8, without strong form scores 0', () => {
  const missing = [];
  assert.equal(scoreOddsAndValue({ odds: { american: 180 } }, 18, missing).components[0].points, 8);
  assert.equal(scoreOddsAndValue({ odds: { american: 180 } }, 0, missing).components[0].points, 0);
});

test('odds: short price with an unconfirmed goaltender is docked 8 points', () => {
  const missing = [];
  const r = scoreOddsAndValue({ odds: { american: -350 }, goaltender: { confirmed: false } }, 25, missing);
  assert.equal(sum(r.components), 17);
});

test('odds: no sourced price means no points and a recorded gap', () => {
  const missing = [];
  const r = scoreOddsAndValue({ name: 'X' }, 25, missing);
  assert.equal(r.components[0].points, 0);
  assert.equal(r.components[0].missing, true);
  assert.match(missing[0], /odds\.moneyline/);
});

/* ---------------- Step 2: goaltending (20pts) ---------------- */

test('goaltending bands above .920 / .910 / .900 and below', () => {
  const missing = [];
  assert.equal(scoreGoaltending({ goaltender: { savePctg: 0.925 } }, {}, missing)[0].points, 20);
  assert.equal(scoreGoaltending({ goaltender: { savePctg: 0.914 } }, {}, missing)[0].points, 13);
  assert.equal(scoreGoaltending({ goaltender: { savePctg: 0.902 } }, {}, missing)[0].points, 6);
  assert.equal(scoreGoaltending({ goaltender: { savePctg: 0.895 } }, {}, missing)[0].points, 0);
});

test('goaltending: a confirmed backup scores zero however good the season number is', () => {
  const missing = [];
  assert.equal(scoreGoaltending({ goaltender: { savePctg: 0.931, isBackup: true } }, {}, missing)[0].points, 0);
});

test('goaltending: weak opposing starter adds the 5 point bonus', () => {
  const missing = [];
  const r = scoreGoaltending({ goaltender: { savePctg: 0.925 } }, { goaltender: { last5SavePctg: 0.894 } }, missing);
  assert.equal(sum(r), 25);
});

/* ---------------- Step 2: structure (20pts) ---------------- */

test('structure: top 5 offence with top 10 defence scores 20, plus special teams swings', () => {
  const missing = [];
  const r = scoreStructure({ shotsForRank: 4, shotsAgainstRank: 9, leagueSize: 32, powerPlayPctg: 26, penaltyKillPctg: 78 }, missing);
  assert.equal(sum(r), 25);
});

test('structure: bottom half in both metrics scores 0 and a weak kill is docked', () => {
  const missing = [];
  const r = scoreStructure({ shotsForRank: 28, shotsAgainstRank: 30, leagueSize: 32, powerPlayPctg: 15, penaltyKillPctg: 70 }, missing);
  assert.equal(sum(r), -5);
});

test('structure: unsourced shot ranks are recorded as missing, not assumed mid-table', () => {
  const missing = [];
  const r = scoreStructure({ powerPlayPctg: 30, penaltyKillPctg: 88 }, missing);
  assert.equal(r[0].missing, true);
  assert.match(missing.join(' '), /shotsForRank/);
});

/* ---------------- Step 2: home context (10pts) ---------------- */

test('home context: 60%+ home wins scores 10 and back-to-backs swing 5 points', () => {
  const missing = [];
  const r = scoreHomeContext({ homeWinPctg: 64, backToBack: true }, { backToBack: true }, { neutral: false }, missing);
  assert.equal(sum(r), 10); // 10 + 5 - 5
});

test('home context: neutral venue scores 2', () => {
  const missing = [];
  assert.equal(sum(scoreHomeContext({ homeWinPctg: 70 }, {}, { neutral: true }, missing)), 2);
});

/* ---------------- Step 2: puck line modifiers ---------------- */

test('puck line: cover trend, margin, injury, power play and fatigue all fire', () => {
  const missing = [];
  const r = scorePuckLineModifiers(fullTeam(), weakTeam(), {}, missing);
  assert.equal(sum(r), 10 + 8 + 0 + 6 + 7);
});

test('puck line: a missing forward line costs 10 points regardless of anything else', () => {
  const missing = [];
  const r = scorePuckLineModifiers(fullTeam({ injuries: { keyForwardLineMissing: true } }), fullTeam(), {}, missing);
  assert.ok(r.some((c) => c.id === 'puck_injury' && c.points === -10));
});

/* ---------------- Step 2: game total ---------------- */

test('total: two 3.5-goal offences with weak goaltending builds a large Over score', () => {
  const missing = [];
  const t = scoreTotalMarket({
    home: fullTeam({ goaltender: { savePctg: 0.895 }, recentTotals: { games: 5, overs: 4, unders: 1 }, penaltyKillPctg: 72 }),
    away: weakTeam({ goaltender: { savePctg: 0.894 }, recentTotals: { games: 5, overs: 4, unders: 1 } }),
  }, missing);
  assert.equal(t.overScore, t.offensiveScore);
  assert.ok(t.offensiveScore >= 70, `expected 70+, got ${t.offensiveScore}`);
});

test('total: two sub-.900 starters score the full 25 Over goaltending points', () => {
  const missing = [];
  const t = scoreTotalMarket({
    home: { goaltender: { savePctg: 0.891 }, goalsForPerGame: 2.2 },
    away: { goaltender: { savePctg: 0.888 }, goalsForPerGame: 2.3 },
  }, missing);
  assert.ok(t.over.some((c) => c.id === 'total_goaltending' && c.points === 25));
});

test('total: two elite starters above .915 route 20 points to the Under', () => {
  const missing = [];
  const t = scoreTotalMarket({
    home: { goaltender: { savePctg: 0.926 }, goalsForPerGame: 2.4, penaltyKillPctg: 88 },
    away: { goaltender: { savePctg: 0.919 }, goalsForPerGame: 2.4, penaltyKillPctg: 87 },
  }, missing);
  assert.ok(t.under.some((c) => c.id === 'total_goaltending' && c.points === 20));
});

test('total: a confirmed backup adds 10 points to the Over', () => {
  const missing = [];
  const t = scoreTotalMarket({
    home: { goaltender: { savePctg: 0.915, isBackup: true }, goalsForPerGame: 3.0 },
    away: { goaltender: { savePctg: 0.915 }, goalsForPerGame: 3.0 },
  }, missing);
  assert.ok(t.over.some((c) => c.id === 'total_backup' && c.points === 10));
});

test('total: unsourced goals per game falls into the neutral band and records the gap', () => {
  const missing = [];
  const t = scoreTotalMarket({ home: {}, away: {} }, missing);
  assert.ok(missing.some((m) => /goalsForPerGame/.test(m)));
  assert.ok(t.neutral.some((c) => c.id === 'total_offence' && c.missing));
});

/* ---------------- Step 2: total line gates ---------------- */

test('gate: a 4.5 line needs a combined offensive score of 55', () => {
  const t = { offensiveScore: 54, goalsForPerGame: { home: 3.0, away: 3.0 } };
  assert.equal(totalLineGate(4.5, t).allowed, false);
  assert.equal(totalLineGate(4.5, { ...t, offensiveScore: 55 }).allowed, true);
});

test('gate: a 5.5 line needs 70 plus both sides above 3.2 goals per game', () => {
  const t = { offensiveScore: 80, goalsForPerGame: { home: 3.4, away: 3.0 } };
  assert.equal(totalLineGate(5.5, t).allowed, false);
  assert.equal(totalLineGate(5.5, { ...t, goalsForPerGame: { home: 3.4, away: 3.3 } }).allowed, true);
});

test('gate: European leagues shift the effective line down by half a goal', () => {
  const t = { offensiveScore: 60, goalsForPerGame: { home: 3.0, away: 3.0 } };
  assert.equal(totalLineGate(5.0, t, { european: false }).allowed, false);
  assert.equal(totalLineGate(5.0, t, { european: true }).allowed, true);
});

test('gate: no sourced line means no Over can be recommended', () => {
  assert.equal(totalLineGate(null, { offensiveScore: 99, goalsForPerGame: { home: 4, away: 4 } }).allowed, false);
});

/* ---------------- Step 3: decision rules ---------------- */

test('Step 3 outright: 70+ HIGH, 50-69 MEDIUM, below 50 SKIP', () => {
  assert.equal(decideOutright(70).confidence, CONFIDENCE.HIGH);
  assert.equal(decideOutright(69).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideOutright(50).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideOutright(49).confidence, CONFIDENCE.SKIP);
});

test('Step 3 puck line: needs an outright score of 65 and margins that support covering', () => {
  assert.equal(decidePuckLine(80, 64, true).confidence, CONFIDENCE.SKIP);
  assert.equal(decidePuckLine(80, 70, false).confidence, CONFIDENCE.SKIP);
  assert.equal(decidePuckLine(80, 70, true).confidence, CONFIDENCE.HIGH);
  assert.equal(decidePuckLine(60, 70, true).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decidePuckLine(54, 70, true).confidence, CONFIDENCE.SKIP);
});

test('Step 3 total: an Over at 5.5 can never be HIGH', () => {
  const total = { offensiveScore: 90, overScore: 90, underScore: 20, goalsForPerGame: { home: 3.6, away: 3.5 } };
  const d = decideTotal({ line: 5.5, total, goaltendersAbove915: false });
  assert.equal(d.side, 'OVER');
  assert.equal(d.confidence, CONFIDENCE.MEDIUM);
});

test('Step 3 total: 55+ at a 4.5 line is HIGH, 45-54 is MEDIUM', () => {
  const mk = (n) => ({ offensiveScore: n, overScore: n, underScore: 10, goalsForPerGame: { home: 3.6, away: 3.6 } });
  assert.equal(decideTotal({ line: 4.5, total: mk(60), goaltendersAbove915: false }).confidence, CONFIDENCE.HIGH);
  assert.equal(decideTotal({ line: 4.5, total: mk(50), goaltendersAbove915: false }).confidence, CONFIDENCE.MEDIUM);
});

test('Step 3 total: two starters above .915 with a 65+ under score is the only Under route', () => {
  const total = { offensiveScore: 30, overScore: 30, underScore: 70, goalsForPerGame: { home: 2.6, away: 2.6 } };
  assert.equal(decideTotal({ line: 5.5, total, goaltendersAbove915: true }).side, 'UNDER');
  assert.equal(decideTotal({ line: 5.5, total, goaltendersAbove915: true }).confidence, CONFIDENCE.MEDIUM);
  assert.equal(decideTotal({ line: 5.5, total, goaltendersAbove915: false }).confidence, CONFIDENCE.SKIP);
});

/* ---------------- subagent pipeline ---------------- */

test('pipeline: the two reasoning paths are blended and their disagreement measured', () => {
  assert.equal(modelProbabilityFromOdds({ odds: { american: -200 } }, { odds: { american: 170 } }) > 0.6, true);
  const c = buildConsensus(0.70, 0.60);
  assert.equal(c.consensus, 0.65);
  assert.equal(c.agreement, 0.1);
  assert.equal(c.paths, 2);
});

test('pipeline: without a price there is only one path and no edge can be claimed', () => {
  const c = buildConsensus(0.7, null);
  assert.equal(c.paths, 1);
  const r = riskFilter({ consensus: c.consensus, marketProb: null, score: 80 });
  assert.equal(r.edgePp, null);
});

test('pipeline: an edge under 3 points vetoes the play', () => {
  const r = riskFilter({ consensus: 0.62, marketProb: 0.60, score: 80 });
  assert.equal(r.veto.includes('below'), true);
});

test('pipeline: an unconfirmed starting goaltender vetoes the play', () => {
  const r = riskFilter({ consensus: 0.8, marketProb: 0.6, score: 90, goaltenderConfirmed: false });
  assert.match(r.veto, /goaltender/);
});

test('pipeline: violent disagreement between the two paths vetoes the play', () => {
  const r = riskFilter({ consensus: 0.7, marketProb: 0.3, score: 90, agreement: 0.4 });
  assert.match(r.veto, /disagreement/);
});

/* ---------------- whole-match and card scoring ---------------- */

test('match: a fully sourced mismatch produces HIGH outright and a covering puck line', () => {
  const r = scoreIceHockeyMatch({
    id: 'g1', league: 'nhl', leagueName: 'National Hockey League', dateISO: '2026-10-08',
    total: { line: 5.5 }, home: fullTeam(), away: weakTeam(),
  });
  assert.equal(r.outright.decision.confidence, CONFIDENCE.HIGH);
  assert.equal(r.puckLine.decision.confidence, CONFIDENCE.HIGH);
  assert.equal(r.pipeline.noBet, false);
  assert.ok(r.outright.favourite.components.length >= 8);
});

test('match: a data-poor fixture is not scored into a guess, it is vetoed', () => {
  const r = scoreIceHockeyMatch({
    id: 'g2', league: 'Finland SM Liiga', dateISO: '2026-09-04',
    home: { name: 'Pelicans' }, away: { name: 'Sport' },
  });
  assert.equal(r.pipeline.noBet, true);
  assert.equal(r.outright.decision.confidence, CONFIDENCE.SKIP);
  assert.ok(r.missing.length >= 6);
});

test('match: a fixture with no competitor names returns the UNSCORED sentinel', () => {
  const r = scoreIceHockeyMatch({ id: 'g3', home: {}, away: {} });
  assert.equal(r.unscored, true);
});

test('match: European league flags apply the half-goal line adjustment', () => {
  const base = {
    id: 'g4', dateISO: '2026-09-04', total: { line: 5.0 },
    home: fullTeam({ goalsForPerGame: 3.1, goaltender: { savePctg: 0.905, confirmed: true, isBackup: false } }),
    away: weakTeam({ goalsForPerGame: 3.0, goaltender: { savePctg: 0.904, confirmed: true, isBackup: false } }),
  };
  const nhl = scoreIceHockeyMatch({ ...base, leagueName: 'National Hockey League' });
  const euro = scoreIceHockeyMatch({ ...base, leagueName: 'Finland SM Liiga', european: true });
  assert.equal(nhl.european, false);
  assert.equal(euro.european, true);
});

test('card: the six-active-pick daily cap is enforced and reported', () => {
  const many = [];
  for (let i = 0; i < 6; i += 1) {
    many.push({
      id: `m${i}`, dateISO: '2026-10-08', total: { line: 4.5 },
      home: fullTeam({ name: `Home ${i}`, abbrev: `H${i}`, goalsForPerGame: 3.6, recentTotals: { games: 5, overs: 4, unders: 1 } }),
      away: weakTeam({ name: `Away ${i}`, abbrev: `A${i}`, goalsForPerGame: 3.6, recentTotals: { games: 5, overs: 4, unders: 1 } }),
    });
  }
  const card = scoreIceHockeyCard(many);
  assert.equal(card.cap.limit, MAX_ACTIVE_PICKS_PER_DAY);
  assert.ok(card.cap.active <= MAX_ACTIVE_PICKS_PER_DAY);
  assert.ok(card.cap.suppressed.length > 0);
});

test('card: mixed scoring applies each match\'s own European flag', () => {
  const card = scoreIceHockeyCardMixed([
    { id: 'a', leagueName: 'National Hockey League', home: fullTeam(), away: weakTeam() },
    { id: 'b', leagueName: 'Sweden SHL', european: true, home: fullTeam(), away: weakTeam() },
  ]);
  assert.deepEqual(card.results.map((r) => r.european), [false, true]);
});

test('odds maths: implied probability and decimal conversion round-trip', () => {
  assert.equal(Math.round(americanToImpliedProb(-200) * 1000), 667);
  assert.equal(decimalToAmerican(2.0), 100);
  assert.equal(decimalToAmerican(1.5), -200);
});
