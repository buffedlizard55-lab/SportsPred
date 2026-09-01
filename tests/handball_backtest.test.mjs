import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gradeHandballMatch, computeMetrics } from '../scripts/backtest_handball.mjs';

describe('Handball Backtest Grader', () => {
  it('correctly grades settled win match, spread, and total', () => {
    const pred = {
      event_id: '1',
      match: 'Aalborg Handbold v Fredericia HK',
      favourite: 'Aalborg Handbold',
      markets: {
        win_match: { selection: 'Aalborg Handbold', band: 'HIGH' },
        handicap_spread: { selection: 'Aalborg Handbold to cover', spread: 5.5, band: 'HIGH' },
        game_total: { selection: 'Over', total: 60.5, band: 'HIGH' },
      },
    };

    const actual = {
      home: 'Aalborg Handbold',
      away: 'Fredericia HK',
      score: { home: 35, away: 28, final: true },
    };

    const graded = gradeHandballMatch(pred, actual);
    assert.equal(graded.settled, true);
    assert.equal(graded.markets.win_match.hit, true);
    assert.equal(graded.markets.handicap_spread.hit, true); // margin 7 > 5.5
    assert.equal(graded.markets.game_total.hit, true); // 63 > 60.5
  });

  it('correctly reports unsettled match as unsettled', () => {
    const pred = {
      event_id: '2',
      match: 'Skjern Handbold v Mors Thy Handbold',
      favourite: 'Skjern Handbold',
      markets: {
        win_match: { selection: 'Skjern Handbold', band: 'HIGH' },
      },
    };

    const actual = {
      home: 'Skjern Handbold',
      away: 'Mors Thy Handbold',
      phase: 'upcoming',
      score: null,
    };

    const graded = gradeHandballMatch(pred, actual);
    assert.equal(graded.settled, false);
  });

  it('computes metrics accurately across markets', () => {
    const gradedList = [
      {
        settled: true,
        markets: {
          win_match: { hit: true, band: 'HIGH', settled: true },
          handicap_spread: { hit: true, band: 'HIGH', settled: true },
          game_total: { hit: false, band: 'MEDIUM', settled: true },
        },
      },
      {
        settled: true,
        markets: {
          win_match: { hit: true, band: 'HIGH', settled: true },
          handicap_spread: { hit: false, band: 'HIGH', settled: true },
          game_total: { hit: true, band: 'HIGH', settled: true },
        },
      },
    ];

    const metrics = computeMetrics(gradedList);
    assert.equal(metrics.settledMatches, 2);
    assert.equal(metrics.markets.win_match.hits, 2);
    assert.equal(metrics.markets.win_match.total, 2);
    assert.equal(metrics.markets.win_match.hitRate, 100);
    assert.equal(metrics.markets.handicap_spread.hits, 1);
    assert.equal(metrics.markets.handicap_spread.total, 2);
    assert.equal(metrics.markets.handicap_spread.hitRate, 50);
  });
});
