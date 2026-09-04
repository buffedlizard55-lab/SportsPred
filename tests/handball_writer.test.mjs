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
  spellNumber,
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

  it('writeHandballCard produces a card where no two tips share an analytical angle', () => {
    const card = writeHandballCard([{ match, result: scoredResult }]);
    assert.equal(card.tips.length, 3);
    const openers = card.tips.filter((t) => !t.skip).map((t) => String(t.angleWord).toLowerCase());
    const uniqueOpeners = new Set(openers);
    assert.equal(openers.length, uniqueOpeners.size, 'Every tip must use a distinct analytical angle');
  });

  it('buildHandballFormattedCardText outputs summary table and responsible gambling reminder', () => {
    const formatted = buildHandballFormattedCardText([{ match, result: scoredResult }], '2026-09-02');
    assert.match(formatted, /Handball Predictions — 2026-09-02/);
    assert.match(formatted, /SUMMARY TABLE/);
    assert.match(formatted, /Responsible Gambling/);
  });
});

describe('Handball Writer — OLBG house style and evidence grounding', () => {
  const teams = {
    'Aalborg Handbold': {
      name: 'Aalborg Handbold',
      isHome: true,
      form: { last5: ['W', 'W', 'W', 'W', 'W'], winsLast5: 5, winStreak: 6, lossStreak: 0 },
      odds: { decimal: 1.15, american: -667 },
      standings: { rank: 1, totalTeams: 14, played: 26, goalDifference: 128 },
      homeRecord: { played: 13, wins: 12, winRate: 0.923 },
      ats: { coveredLast10: 8 },
      stats: { goalsPerGame: 33.4, goalsConcededPerGame: 27.2 },
      trends: { overLast5: 3 },
      injuries: { fullyFit: true, keyAbsence: false },
    },
    'Fredericia HK': {
      name: 'Fredericia HK',
      isHome: false,
      form: { last5: ['W', 'L', 'W', 'L', 'W'], winsLast5: 3 },
      odds: { decimal: 5.0, american: 400 },
      standings: { rank: 4, totalTeams: 14, played: 26 },
      stats: { goalsPerGame: 29.0, goalsConcededPerGame: 28.4 },
      trends: { overLast5: 3 },
      injuries: {},
    },
  };

  const fixture = {
    event_id: '11396',
    home: 'Aalborg Handbold',
    away: 'Fredericia HK',
    homeTeamObj: teams['Aalborg Handbold'],
    awayTeamObj: teams['Fredericia HK'],
    competition: { stage: 'high_stakes_league', highStakes: true, type: 'league' },
    h2h: { totalMeetings: 6, favWins: 5, recentMeetings: ['W', 'W', 'W', 'W', 'L'] },
    handicapSpread: 6.5,
    gameTotal: 61.5,
  };

  const scored = scoreHandballMatch(fixture);
  const card = writeHandballCard([{ match: fixture, result: scored }]);
  const byMarket = Object.fromEntries(card.tips.map((t) => [t.market, t]));

  it('states the selection in the opening sentence, OLBG style', () => {
    assert.match(byMarket.win_match.text, /^\*\*Aalborg Handbold\*\* are the preferred winner\./);
    assert.match(byMarket.handicap_spread.text, /^\*\*Aalborg Handbold to cover\*\* is the preferred margin outcome\./);
    assert.match(byMarket.game_total.text, /^\*\*(Over|Under)\*\* is the preferred total outcome\./);
  });

  it('every factual clause traces to a sourced value in the fixture data', () => {
    const t = byMarket.win_match.text;
    // form.last5 = five wins from five
    assert.match(t, /won five of their last five/);
    // form.winStreak = 6
    assert.match(t, /won six in succession/);
    // standings.rank 1 vs 4
    assert.match(t, /sit first in the table with the opposition down in fourth/);
    // h2h 5 of 6
    assert.match(t, /five wins from six meetings/);
    // homeRecord 12 of 13
    assert.match(t, /twelve wins from thirteen on their own floor/);
  });

  it('the handicap tip quotes the sourced ATS record and nothing else numeric', () => {
    assert.match(byMarket.handicap_spread.text, /covered the handicap in eight of their last ten/);
    assert.ok(!/\d/.test(byMarket.handicap_spread.text.replace(/\*\*/g, '')));
  });

  it('the total tip quotes sourced scoring and conceding rates', () => {
    const t = byMarket.game_total.text;
    // 33.4 and 29.0 gpg -> one side thirty-plus
    assert.match(t, /averaging thirty or more goals a game/);
    // both concede 27.2 / 28.4 -> split defensive read
    assert.match(t, /defensive numbers are split|shipping twenty-eight or more/);
  });

  it('omits a clause entirely when the underlying value was never sourced', () => {
    const thin = {
      ...fixture,
      homeTeamObj: { name: 'Aalborg Handbold', isHome: true, standings: { rank: 1 }, odds: { decimal: 1.15, american: -667 } },
      awayTeamObj: { name: 'Fredericia HK', isHome: false, standings: { rank: 4 } },
      h2h: null,
    };
    const r = scoreHandballMatch(thin);
    const written = writeHandballCard([{ match: thin, result: r }]);
    for (const tip of written.tips.filter((x) => x.ok && !x.skip)) {
      assert.ok(!/of their last five/.test(tip.text), 'form clause must vanish when form is unsourced');
      assert.ok(!/on their own floor/.test(tip.text), 'home clause must vanish when the record is unsourced');
      assert.match(tip.text, /could not be sourced for this fixture/, 'unsourced factors must be disclosed');
    }
  });

  it('never repeats a team name three times in a row: later mentions become pronouns', () => {
    for (const tip of card.tips.filter((t) => t.ok && !t.skip)) {
      const hits = (tip.text.match(/Aalborg Handbold/g) || []).length;
      assert.ok(hits <= 2, `team name repeated ${hits} times: ${tip.text}`);
    }
  });

  it('spellNumber never emits a digit', () => {
    for (let i = 0; i <= 99; i += 1) {
      const w = spellNumber(i);
      if (w !== null) assert.ok(!/\d/.test(w), `spellNumber(${i}) leaked a digit`);
    }
    assert.equal(spellNumber(100), null);
    assert.equal(spellNumber(-1), null);
    assert.equal(spellNumber(3.5), null);
  });
});

describe('Handball writer — pronoun case', () => {
  it('never produces an object-case or possessive pronoun error', () => {
    const fav = {
      name: 'Aalborg Handbold', isHome: true,
      form: { last5: ['W', 'W', 'W', 'W', 'W'], winStreak: 6 },
      odds: { decimal: 1.15, american: -667 },
      standings: { rank: 1, totalTeams: 14, played: 26, goalDifference: 128 },
      homeRecord: { played: 13, wins: 12, winRate: 0.923 },
      ats: { coveredLast10: 8 },
      stats: { goalsPerGame: 33.4, goalsConcededPerGame: 27.2 },
      trends: { overLast5: 3 }, injuries: { fullyFit: true },
    };
    const dog = {
      name: 'Fredericia HK', isHome: false,
      form: { last5: ['W', 'L', 'W', 'L', 'W'] },
      odds: { decimal: 5.0, american: 400 },
      standings: { rank: 4, totalTeams: 14, played: 26 },
      stats: { goalsPerGame: 29.0, goalsConcededPerGame: 28.4 },
      trends: { overLast5: 3 }, injuries: {},
    };
    const m = {
      event_id: 'hb-pron', home: fav.name, away: dog.name,
      homeTeamObj: fav, awayTeamObj: dog,
      competition: { stage: 'high_stakes_league', highStakes: true, type: 'league' },
      h2h: { totalMeetings: 6, favWins: 5, recentMeetings: ['W', 'W', 'W', 'W', 'L'] },
      handicapSpread: 6.5, gameTotal: 61.5,
    };
    const r = scoreHandballMatch(m);
    for (const tip of writeHandballCard([{ match: m, result: r }]).tips.filter((t) => t.ok && !t.skip)) {
      assert.ok(!/\b(for|to|against|over|with|of|from|than)\s+they\b/i.test(tip.text),
        `object-case pronoun error: ${tip.text}`);
      assert.ok(!/\bthey's\b/i.test(tip.text), `possessive pronoun error: ${tip.text}`);
    }
  });
});

describe('Handball writer — OLBG phrasing allowed', () => {
  it('does not ban the phrase both teams', () => {
    assert.ok(!BANNED_PHRASES.includes('both teams'));
  });
});
