import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreHandballMatch,
  scoreHandballCard,
  decimalToAmerican,
  americanToImpliedProb,
  normaliseOdds,
  CONFIDENCE,
  RULESET_VERSION,
} from '../engine/handball_engine.js';

describe('Handball Engine — Odds & Conversions', () => {
  it('decimalToAmerican correctly converts odds', () => {
    assert.equal(decimalToAmerican(2.00), 100);
    assert.equal(decimalToAmerican(1.50), -200);
    assert.equal(decimalToAmerican(1.30), -333);
    assert.equal(decimalToAmerican(3.50), 250);
    assert.equal(decimalToAmerican(1.00), null);
    assert.equal(decimalToAmerican(null), null);
  });

  it('americanToImpliedProb calculates implied probabilities', () => {
    assert.ok(Math.abs(americanToImpliedProb(-300) - 0.75) < 0.01);
    assert.ok(Math.abs(americanToImpliedProb(+100) - 0.50) < 0.01);
    assert.equal(americanToImpliedProb(null), null);
  });

  it('normaliseOdds normalises decimal and american odds without inventing prices', () => {
    assert.deepEqual(normaliseOdds(1.40), { decimal: 1.4, american: -250 });
    assert.deepEqual(normaliseOdds({ american: -200 }), { decimal: 1.5, american: -200 });
    assert.equal(normaliseOdds(null), null);
  });
});

describe('Handball Engine — Win Match Scoring', () => {
  const strongFav = {
    name: 'Aalborg Handbold',
    isHome: true,
    form: {
      last5: ['W', 'W', 'W', 'W', 'W'],
      winsLast5: 5,
      winStreak: 5,
    },
    odds: { decimal: 1.25, american: -400 },
    standings: { rank: 1, totalTeams: 14, goalDifference: 45, played: 10 },
    homeRecord: { wins: 9, matches: 10, winRate: 0.90 },
    ats: { coveredLast10: 8 },
    injuries: { fullyFit: true, keyAbsence: false },
    stats: { goalsPerGame: 33.5, goalsConcededPerGame: 26.0 },
    trends: { overLast5: 4 },
  };

  const underdog = {
    name: 'Fredericia HK',
    isHome: false,
    form: {
      last5: ['L', 'L', 'L', 'L', 'W'],
      winsLast5: 1,
      lossStreak: 4,
    },
    odds: { decimal: 4.50, american: 350 },
    standings: { rank: 8, totalTeams: 14, goalDifference: -10, played: 10 },
    injuries: { keyAttackingAbsence: true },
    stats: { goalsPerGame: 27.0, goalsConcededPerGame: 31.0 },
    trends: { overLast5: 3 },
  };

  const match = {
    event_id: '11396',
    home: 'Aalborg Handbold',
    away: 'Fredericia HK',
    homeTeamObj: strongFav,
    awayTeamObj: underdog,
    competition: { stage: 'high_stakes_league', highStakes: true },
    h2h: {
      totalMeetings: 6,
      favWins: 5,
      recentMeetings: ['W', 'W', 'W', 'W', 'L'],
    },
    handicapSpread: 6.5,
    gameTotal: 61.5,
  };

  it('scores dominant match with HIGH confidence on Win Match', () => {
    const res = scoreHandballMatch(match);
    assert.equal(res.favourite, 'Aalborg Handbold');
    assert.equal(res.markets.win_match.band, CONFIDENCE.HIGH);
    assert.ok(res.markets.win_match.score >= 70);
  });

  it('scores point spread and game total markets independently', () => {
    const res = scoreHandballMatch(match);
    assert.ok(res.markets.handicap_spread);
    assert.ok(res.markets.game_total);
    assert.equal(res.markets.game_total.direction, 'OVER');
  });

  it('respects the ruleset version stamping', () => {
    const res = scoreHandballMatch(match);
    assert.equal(res.ruleset, RULESET_VERSION);
  });
});
