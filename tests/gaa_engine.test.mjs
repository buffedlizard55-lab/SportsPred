import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  oddsPoints, rankingPoints, stagePoints, gaaTotal,
  scoreForm, scoreH2H, scoreRanking, scoreStage, scoreOddsSide,
  scoreMatch, decideBet, confidenceFor,
  formLeans, CONFIDENCE, RULES,
} from '../engine/gaa_engine.js';

const profile = (wins, { bonus = false, last5 = null, name = 'P', margins = null } = {}) => {
  const names = ['A', 'B', 'C', 'D', 'E'];
  const seq = [];
  for (let i = 0; i < 5; i += 1) {
    seq.push({ winner: i < wins ? name : names[i % names.length], margin: margins ? margins[i] : 8 });
  }
  return {
    name,
    last5: last5 || seq,
    inCompetition: bonus ? [{ winner: name }, { winner: name }] : [{ winner: name }, { winner: 'X' }],
  };
};

const match = (over = {}) => ({
  id: 'm1',
  teamA: { name: 'Mayo' },
  teamB: { name: 'Kerry' },
  event: 'Test',
  round: 'Final',
  ...over,
});

test('gaaTotal is 3×goals + points', () => {
  assert.equal(gaaTotal(1, 20), 23);
  assert.equal(gaaTotal(2, 28), 34);
  assert.equal(gaaTotal(null, 10), null);
});

test('oddsPoints follows the GAA prompt table', () => {
  assert.equal(oddsPoints(-300).points, 30);
  assert.equal(oddsPoints(-250).points, 22);
  assert.equal(oddsPoints(-175).points, 14);
  assert.equal(oddsPoints(-120).points, 6);
  assert.equal(oddsPoints(null).points, 0);
});

test('scoreOddsSide missing price is 10 pts and flagged (IR-GAA-01)', () => {
  const c = scoreOddsSide(null);
  assert.equal(c.points, 10);
  assert.equal(c.missing, true);
  assert.match(c.detail, /IR-GAA-01/);
});

test('form tiers and in-competition bonus', () => {
  assert.equal(scoreForm(profile(5), []).points, 25);
  assert.equal(scoreForm(profile(4), []).points, 18);
  assert.equal(scoreForm(profile(3), []).points, 10);
  assert.equal(scoreForm(profile(2), []).points, 0);
  assert.equal(scoreForm(profile(4, { bonus: true }), []).points, 23);
});

test('form with fewer than three results is missing and capped at 10', () => {
  const missing = [];
  const c = scoreForm({ name: 'P', last5: [{ winner: 'P' }, { winner: 'P' }], inCompetition: [] }, missing);
  assert.equal(c.missing, true);
  assert.ok(c.points <= 10);
  assert.ok(missing.some((m) => m.includes('last-five form')));
});

test('formLeans needs three wins from last five', () => {
  assert.equal(formLeans(profile(3)), true);
  assert.equal(formLeans(profile(2)), false);
});

const h2h = (aWins, bWins, { a3 = aWins, b3 = bWins } = {}) => ({
  a: 'Mayo', b: 'Kerry', aWins, bWins, total: aWins + bWins,
  last3Years: { aWins: a3, bWins: b3, total: a3 + b3 },
});

test('h2h tiers and missing = 5 pts', () => {
  assert.equal(scoreH2H(h2h(7, 3, { a3: 3, b3: 0 }), 'a', 'Kerry', []).points, 20);
  assert.equal(scoreH2H(h2h(5, 5), 'a', 'K', []).points, 5);
  const missing = [];
  const c = scoreH2H(null, 'a', 'K', missing);
  assert.equal(c.missing, true);
  assert.equal(c.points, 5);
});

test('ranking table and hurling pedigree', () => {
  assert.equal(rankingPoints(1), 15);
  assert.equal(rankingPoints(2), 12);
  assert.equal(rankingPoints(4), 8);
  const ped = scoreRanking(null, 8, { hurlingPedigree: true, name: 'Limerick' });
  assert.ok(ped.points >= 12);
});

test('stage + home + provincial extras', () => {
  assert.equal(stagePoints('final'), 10);
  assert.equal(stagePoints('qf'), 7);
  assert.equal(scoreStage('final', { home: true, provincialHome: true }).points, 15);
});

test('scoreMatch without odds is SKIP', () => {
  const scored = scoreMatch(match(), {
    profiles: { a: profile(4, { bonus: true, name: 'Mayo' }), b: profile(3, { name: 'Kerry' }) },
    h2h: h2h(0, 0),
    roundTier: 'final',
    odds: { a: null, b: null },
  });
  assert.equal(scored.decision.bet, 'SKIP');
  assert.ok(scored.sideA.components.find((c) => c.id === 'odds').missing);
});

test('decideBet follows Step 3 and caps FULL when two gaps', () => {
  assert.equal(decideBet({ score: 75, odds: -150, aligned: 3 }).bet, 'FULL BET');
  assert.equal(decideBet({ score: 60, odds: -145, aligned: 2 }).bet, 'SMALL BET');
  assert.equal(decideBet({ score: 80, odds: null, aligned: 3 }).bet, 'SKIP');
  assert.equal(decideBet({ score: 74, odds: -300, aligned: 3 }).bet, 'SKIP');
  assert.equal(decideBet({ score: 80, odds: -160, aligned: 3, gaps: 2 }).bet, 'SMALL BET');
  assert.equal(RULES.full.minScore, 70);
});

test('confidence HIGH is impossible without a price', () => {
  const lean = { score: 80, measured: 3 };
  assert.equal(confidenceFor(lean, { oddsForLean: -200 }).band, CONFIDENCE.HIGH);
  assert.equal(confidenceFor(lean, { oddsForLean: null }).band, CONFIDENCE.MEDIUM);
});
