import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scoreHandballMatch, CONFIDENCE } from '../engine/handball_engine.js';
import {
  writeHandballTip,
  writeHandballCard,
  validateHandballTip,
  buildHandballFormattedCardText,
  MIN_WORDS,
  BANNED_PHRASES,
  HANDBALL_OPENERS,
} from '../engine/handball_writer.js';

describe('Handball Writer & Validator', () => {
  const strongFav = {
    name: 'Aalborg Handbold',
    isHome: true,
    form: { last5: ['W', 'W', 'W', 'W', 'W'], winsLast5: 5, winStreak: 5 },
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
    form: { last5: ['L', 'L', 'L', 'L', 'W'], winsLast5: 1, lossStreak: 4 },
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
    h2h: { totalMeetings: 6, favWins: 5, recentMeetings: ['W', 'W', 'W', 'W', 'L'] },
    handicapSpread: 6.5,
    gameTotal: 61.5,
  };

  const scoredResult = scoreHandballMatch(match);

  it('generates tips for WIN MATCH, POINT SPREAD, and GAME TOTAL meeting all Step 4 rules', () => {
    for (const market of ['win_match', 'handicap_spread', 'game_total']) {
      const angle = HANDBALL_OPENERS[0];
      const tip = writeHandballTip({ match, result: scoredResult, market, angle });
      assert.equal(tip.ok, true, `Tip validation failed: ${JSON.stringify(tip.violations)}`);
      assert.ok(tip.text.split(/\s+/).filter(Boolean).length >= MIN_WORDS, 'Tip must meet minimum word count');
      assert.match(tip.text, /\*\*[^*]+\*\*/, 'Tip must contain bolded outcome');
      assert.ok(!/\d/.test(tip.text.replace(/\*\*/g, '')), 'Tip must contain zero numerals/digits');
    }
  });

  it('validator catches banned phrases', () => {
    for (const phrase of BANNED_PHRASES) {
      const badText = `Defensive prowess is key here. **Aalborg Handbold** is our selection on WIN MATCH because ${phrase} in this fixture. We expect great things from our analysis. Nothing beyond the sourced record has been assumed in reaching that view. Confidence: HIGH.`;
      const val = validateHandballTip(badText, { market: 'win_match' });
      assert.equal(val.ok, false);
      assert.ok(val.violations.some((v) => v.includes('banned phrase')));
    }
  });

  it('validator catches leaked digits (odds, spreads, totals, scores)', () => {
    const badText = 'Defensive solidity provides the platform for success. **Aalborg Handbold** is selected at odds of 1.25 with a spread of -6.5 goals on WIN MATCH. We expect strong execution throughout sixty minutes without lapse. Confidence: HIGH.';
    const val = validateHandballTip(badText, { market: 'win_match' });
    assert.equal(val.ok, false);
    assert.ok(val.violations.some((v) => v.includes('contains forbidden numerals')));
  });

  it('writeHandballCard produces a card where no two tips share an opening word', () => {
    const card = writeHandballCard([{ match, result: scoredResult }]);
    assert.equal(card.tips.length, 3);
    const openers = card.tips.filter((t) => !t.skip).map((t) => t.text.split(/\s+/)[0].toLowerCase());
    const uniqueOpeners = new Set(openers);
    assert.equal(openers.length, uniqueOpeners.size, 'Every tip must have a distinct opening word');
  });

  it('buildHandballFormattedCardText outputs summary table and responsible gambling reminder', () => {
    const formatted = buildHandballFormattedCardText([{ match, result: scoredResult }], '2026-09-02');
    assert.match(formatted, /Handball Predictions — 2026-09-02/);
    assert.match(formatted, /SUMMARY TABLE/);
    assert.match(formatted, /Responsible Gambling/);
  });
});
