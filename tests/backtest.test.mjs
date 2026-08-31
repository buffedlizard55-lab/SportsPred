/**
 * Backtest harness tests. Metrics are checked against hand-computed values.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { gradeOne, metrics, renderReport, BAND_PROBABILITY } from '../scripts/backtest.mjs';

test('win_match grades against the recorded winner, case- and space-insensitively', () => {
  const pred = { market: 'win_match', selection: 'Carlos Alcaraz' };
  assert.equal(gradeOne(pred, { winner: 'carlos  alcaraz' }).correct, true);
  assert.equal(gradeOne(pred, { winner: 'Roman Safiullin' }).correct, false);
});

test('a match with no recorded result is unsettled, never a loss', () => {
  assert.equal(gradeOne({ market: 'win_match', selection: 'A' }, null).status, 'unsettled');
  assert.equal(gradeOne({ market: 'win_match', selection: 'A' }, {}).status, 'void');
});

test('first_set grades against the recorded first-set winner', () => {
  const pred = { market: 'first_set', selection: 'Roman Safiullin' };
  assert.equal(gradeOne(pred, { firstSetWinner: 'Roman Safiullin' }).correct, true);
  assert.equal(gradeOne(pred, { firstSetWinner: 'Carlos Alcaraz' }).correct, false);
  assert.equal(gradeOne(pred, {}).status, 'void');
});

test('games handicap covers only when the margin clears the line', () => {
  // Favourite at -5.5 covers on a 6+ game margin.
  const fav = { market: 'games_handicap', selection: 'A', line: -5.5 };
  assert.equal(gradeOne(fav, { gamesMargin: 6 }).correct, true);
  assert.equal(gradeOne(fav, { gamesMargin: 5 }).correct, false);
  assert.equal(gradeOne(fav, { gamesMargin: -3 }).correct, false);

  // The underdog side of the same line covers when the margin is smaller.
  const dog = { market: 'games_handicap', selection: 'B', line: 5.5 };
  assert.equal(gradeOne(dog, { gamesMargin: 3 }).correct, true);
  assert.equal(gradeOne(dog, { gamesMargin: -6 }).correct, true);
  assert.equal(gradeOne(dog, { gamesMargin: 7 }).correct, false);
});

test('a handicap pick with no recorded line is void, not silently graded', () => {
  assert.equal(gradeOne({ market: 'games_handicap', selection: 'A', line: null }, { gamesMargin: 6 }).status, 'void');
});

test('metrics on an empty record set report zeros and compute nothing', () => {
  const m = metrics([]);
  assert.equal(m.total, 0);
  assert.equal(m.settled, 0);
  assert.equal(m.hitRate, undefined);
  assert.equal(m.brier, undefined);
});

test('hit rate, Brier and log loss match hand-computed values', () => {
  // Two HIGH picks: one right, one wrong.
  const recs = [
    { status: 'settled', correct: true, band: 'HIGH', market: 'win_match' },
    { status: 'settled', correct: false, band: 'HIGH', market: 'win_match' },
  ];
  const m = metrics(recs);
  assert.equal(m.hitRate, 0.5);

  const p = BAND_PROBABILITY.HIGH; // 0.78
  const expectedBrier = ((p - 1) ** 2 + (p - 0) ** 2) / 2;
  assert.ok(Math.abs(m.brier - expectedBrier) < 1e-12, `brier ${m.brier} != ${expectedBrier}`);

  const expectedLogLoss = (-Math.log(p) - Math.log(1 - p)) / 2;
  assert.ok(Math.abs(m.logLoss - expectedLogLoss) < 1e-12, `logloss ${m.logLoss} != ${expectedLogLoss}`);
});

test('ROI is unavailable when no price was recorded, not defaulted to zero', () => {
  const m = metrics([{ status: 'settled', correct: true, band: 'HIGH', market: 'win_match' }]);
  assert.equal(m.roi, null);
  assert.ok(m.roiNote.includes('no prices recorded'));
});

test('ROI is computed from recorded decimal prices', () => {
  const recs = [
    { status: 'settled', correct: true, band: 'HIGH', market: 'win_match', price: 1.5 },
    { status: 'settled', correct: false, band: 'HIGH', market: 'win_match', price: 2.0 },
  ];
  const m = metrics(recs);
  // +0.5 and -1.0 -> mean -0.25
  assert.ok(Math.abs(m.roi - -0.25) < 1e-12, `roi ${m.roi}`);
  assert.equal(m.pricedCount, 2);
});

test('breakdowns are produced per band and per market', () => {
  const recs = [
    { status: 'settled', correct: true, band: 'HIGH', market: 'win_match' },
    { status: 'settled', correct: false, band: 'HIGH', market: 'first_set' },
    { status: 'settled', correct: true, band: 'MEDIUM', market: 'win_match' },
  ];
  const m = metrics(recs);
  assert.equal(m.byBand.HIGH.n, 2);
  assert.equal(m.byBand.HIGH.hitRate, 0.5);
  assert.equal(m.byBand.MEDIUM.n, 1);
  assert.equal(m.byMarket.win_match.n, 2);
  assert.equal(m.byMarket.win_match.hitRate, 1);
  assert.equal(m.byMarket.first_set.hitRate, 0);
});

test('the report states plainly when nothing is settled instead of inventing numbers', () => {
  const out = renderReport(metrics([]));
  assert.match(out, /Nothing is settled yet/);
  assert.match(out, /inventing results/);
  assert.doesNotMatch(out, /hit rate\s*:\s*\d/);
});

test('the report includes calibration metrics when there is data', () => {
  const out = renderReport(metrics([
    { status: 'settled', correct: true, band: 'HIGH', market: 'win_match' },
    { status: 'settled', correct: false, band: 'MEDIUM', market: 'win_match' },
  ]));
  assert.match(out, /hit rate : 50\.0%/);
  assert.match(out, /Brier    : \d\.\d{4}/);
  assert.match(out, /log loss : \d\.\d{4}/);
});
