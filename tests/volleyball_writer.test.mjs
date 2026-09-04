import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scoreVolleyballMatch, CONFIDENCE } from '../engine/volleyball_engine.js';
import {
  writeVolleyballTip,
  writeVolleyballCard,
  validateVolleyballTip,
  buildVolleyballFormattedCardText,
  MIN_WORDS,
  BANNED_PHRASES,
  VOLLEYBALL_OPENERS,
  spellCount,
} from '../engine/volleyball_writer.js';

const match = {
  event_id: 'vb-writer',
  home: 'Poland',
  away: 'Visitor',
  homeTeamObj: {
    name: 'Poland',
    isHome: true,
    form: {
      last5: ['W', 'W', 'W', 'W', 'W'],
      last5SetScores: ['3-0', '3-0', '3-0', '3-1', '3-0'],
      winStreak: 5,
    },
    odds: { decimal: 1.33, american: -300 },
    stats: { killsPerSetRank: 2, blocksPerSetRank: 3 },
    homeRecord: { winRate: 0.75 },
    standings: { rank: 1, totalTeams: 24 },
    rank: 1,
  },
  awayTeamObj: {
    name: 'Visitor',
    isHome: false,
    form: { last5: ['L', 'L', 'W', 'L', 'L'], last5SetScores: ['0-3', '1-3', '3-1', '0-3', '1-3'], lossStreak: 2 },
    odds: { decimal: 3.4, american: 240 },
    awayRecord: { lossRate: 0.65 },
    standings: { rank: 16, totalTeams: 24 },
    rank: 16,
  },
  h2h: {
    recentMeetings: [
      { result: 'W', setScore: '3-0' },
      { result: 'W', setScore: '3-1' },
      { result: 'W', setScore: '3-0' },
      { result: 'W', setScore: '3-1' },
      { result: 'L', setScore: '2-3' },
    ],
  },
};

const scored = scoreVolleyballMatch(match);

describe('Volleyball writer', () => {
  it('writes WIN MATCH and SET SCORE tips that pass the output rules', () => {
    for (const market of ['win_match', 'set_score']) {
      const tip = writeVolleyballTip({ match, result: scored, market, angle: VOLLEYBALL_OPENERS[0] });
      assert.equal(tip.ok, true, `${market}: ${JSON.stringify(tip.violations)} :: ${tip.text}`);
      assert.ok(tip.text.split(/\s+/).filter(Boolean).length >= MIN_WORDS);
      assert.match(tip.text, /\*\*[^*]+\*\*/);
      if (market === 'set_score') assert.match(tip.text, /\*\*3-[012]\*\*/);
    }
  });

  it('rejects banned phrases and leaked digits', () => {
    for (const phrase of BANNED_PHRASES) {
      const bad = `Attacking control is established here. **Poland** is the pick on WIN MATCH because ${phrase} in this fixture and the sourced record is enough to fill the rest of this sentence completely. Confidence: HIGH.`;
      const val = validateVolleyballTip(bad, { market: 'win_match' });
      assert.equal(val.ok, false);
      assert.ok(val.violations.some((v) => v.includes('banned phrase')));
    }
    const digits = 'Attacking control is established here. **Poland** is the pick on WIN MATCH at odds of 1.25 with a 3-1 set line. Nothing beyond the sourced record has been assumed in reaching that view. Confidence: HIGH.';
    const val = validateVolleyballTip(digits, { market: 'win_match' });
    assert.equal(val.ok, false);
    assert.ok(val.violations.some((v) => v.includes('forbidden numerals')));
  });

  it('emits a single-sentence SKIP when the engine withholds', () => {
    const bare = scoreVolleyballMatch({
      event_id: 'thin',
      home: 'A',
      away: 'B',
      homeTeamObj: { name: 'A', isHome: true },
      awayTeamObj: { name: 'B', isHome: false },
    });
    assert.equal(bare.markets.win_match.band, CONFIDENCE.SKIP);
    const card = writeVolleyballCard([{ match: { event_id: 'thin', home: 'A', away: 'B' }, result: bare }]);
    const wm = card.tips.find((t) => t.market === 'win_match');
    assert.equal(wm.skip, true);
    assert.match(wm.text, /^SKIP —/);
    assert.equal(wm.text.split(/(?<=[.!?])\s+/).filter(Boolean).length, 1);
  });

  it('gives every styled tip a unique opening word and prints the summary table', () => {
    const card = writeVolleyballCard([{ match, result: scored }]);
    const openers = card.tips.filter((t) => !t.skip).map((t) => String(t.angleWord).toLowerCase());
    assert.equal(openers.length, new Set(openers).size);
    const formatted = buildVolleyballFormattedCardText([{ match, result: scored }], '2026-09-03');
    assert.match(formatted, /Volleyball Predictions — 2026-09-03/);
    assert.match(formatted, /SUMMARY TABLE/);
    assert.match(formatted, /Responsible Gambling/);
  });
});

/* ------------------------------------------------------------------ *
 * OLBG house style + evidence grounding.
 * ------------------------------------------------------------------ */
describe('Volleyball writer — OLBG house style', () => {
  const styleMatch = {
    event_id: 'vb-style',
    home: 'Poland',
    away: 'Netherlands',
    neutral: true,
    homeTeamObj: {
      name: 'Poland', isHome: true,
      form: { last5: ['W', 'W', 'W', 'W', 'W'], last5SetScores: ['3-0', '3-0', '3-0', '3-1', '3-0'], winStreak: 5 },
      odds: { decimal: 1.33, american: -300 },
      stats: { killsPerSetRank: 2, blocksPerSetRank: 3 },
      homeRecord: { winRate: 0.75 },
      standings: { rank: 1, totalTeams: 24 }, rank: 1,
    },
    awayTeamObj: {
      name: 'Netherlands', isHome: false,
      form: { last5: ['L', 'L', 'W', 'L', 'L'], last5SetScores: ['0-3', '1-3', '3-1', '0-3', '1-3'], lossStreak: 2 },
      odds: { decimal: 3.4, american: 240 },
      standings: { rank: 16, totalTeams: 24 }, rank: 16,
      rest: { playedWithin48h: true },
    },
    h2h: {
      recentMeetings: [
        { winner: 'Poland', setScore: '3-0' },
        { winner: 'Poland', setScore: '3-1' },
        { winner: 'Netherlands', setScore: '2-3' },
      ],
    },
  };

  const styleScored = scoreVolleyballMatch(styleMatch);
  const styleCard = writeVolleyballCard([{ match: styleMatch, result: styleScored }]);
  const byMarket = Object.fromEntries(styleCard.tips.map((t) => [t.market, t]));

  it('states the selection in the opening words', () => {
    assert.match(byMarket.win_match.text, /^\*\*Poland\*\* are the preferred winner\./);
    assert.match(byMarket.set_score.text, /^\*\*3-[012]\*\* is my preferred correct score\./);
    assert.match(byMarket.win_match.text, /cannot be treated as an ordinary underdog/);
    assert.match(byMarket.set_score.text, /match-winner market is safer than relying heavily on the exact score/);
  });

  it('every factual clause traces to a sourced value', () => {
    // form.last5 = five wins from five
    assert.match(byMarket.win_match.text, /won five of their last five in this competition/);
    // winStreak 5
    assert.match(byMarket.win_match.text, /run of five straight wins/);
    // h2h: Poland won 2 of the 3 sourced meetings, latest 3-0
    assert.match(byMarket.win_match.text, /two wins from three meetings/);
    assert.match(byMarket.win_match.text, /most recent meeting finishing \*\*3-0\*\*/);
    // away rest.playedWithin48h
    assert.match(byMarket.win_match.text, /on court inside the previous two days/);
    // neutral === true must suppress any home-advantage claim
    assert.match(byMarket.win_match.text, /neutral venue, so no home advantage is assumed/);
    // last5SetScores: four of the five wins were 3-0
    assert.match(byMarket.set_score.text, /four of their last five wins arrived without dropping a set/i);
  });

  it('pronoun substitution uses the correct case, never "for they"', () => {
    for (const tip of styleCard.tips.filter((t) => t.ok && !t.skip)) {
      assert.ok(!/\b(for|to|against|over|with|of|from|than)\s+they\b/i.test(tip.text),
        `object-case pronoun error: ${tip.text}`);
      assert.ok(!/\bthey's\b/i.test(tip.text), `possessive pronoun error: ${tip.text}`);
    }
  });

  it('a clause vanishes when its input is not sourced', () => {
    const thin = {
      ...styleMatch,
      homeTeamObj: { name: 'Poland', isHome: true, odds: { decimal: 1.33, american: -300 }, standings: { rank: 1 }, rank: 1 },
      awayTeamObj: { name: 'Netherlands', isHome: false, odds: { decimal: 3.4, american: 240 }, standings: { rank: 16 }, rank: 16 },
      h2h: { recentMeetings: [] },
    };
    const r = scoreVolleyballMatch(thin);
    for (const tip of writeVolleyballCard([{ match: thin, result: r }]).tips.filter((t) => t.ok && !t.skip)) {
      assert.ok(!/of their last five in this competition/.test(tip.text), 'form clause must vanish when unsourced');
      assert.ok(!/head-to-head record reads/.test(tip.text), 'h2h clause must vanish when unsourced');
      assert.match(tip.text, /could not be sourced for this fixture/);
    }
  });

  it('only set scores may carry digits; no other figure leaks', () => {
    for (const tip of styleCard.tips.filter((t) => t.ok && !t.skip)) {
      const stripped = tip.text.replace(/\*\*3-[012]\*\*/g, '').replace(/\*\*/g, '');
      assert.ok(!/\d/.test(stripped), `digit leaked outside a set score: ${tip.text}`);
    }
  });

  it('spellCount never emits a digit', () => {
    for (let i = 0; i <= 10; i += 1) assert.ok(!/\d/.test(spellCount(i)));
    assert.equal(spellCount(11), null);
    assert.equal(spellCount(-1), null);
  });
});

describe('Volleyball writer — set-score digit exemption', () => {
  it('allows a head-to-head defeat scoreline, not just a win', () => {
    /* A volleyball match ends 3-0/3-1/3-2 from the winner's side and 0-3/1-3/2-3
     * from the loser's. The digit exemption originally covered only the winning
     * orientation, so a tip citing a defeat in the head-to-head ("the most recent
     * meeting finishing **1-3**") failed validation and was emitted with
     * text: null — a blank tip on the page. */
    for (const score of ['3-0', '3-1', '3-2', '0-3', '1-3', '2-3']) {
      const text = '**Team Alpha** are the preferred winner. Form is the anchor here. '
        + 'Team Alpha have won four of their last five in this competition. The sourced '
        + 'head-to-head record reads three wins from five meetings for them, with the most '
        + `recent meeting finishing **${score}**. Confidence: MEDIUM.`;
      const v = validateVolleyballTip(text, { market: 'win_match' });
      assert.deepEqual(v.violations, [], `scoreline ${score} was rejected`);
    }
  });

  it('still rejects a figure that is not a volleyball set score', () => {
    // The exemption must stay narrow: only real set scores may appear as digits.
    const text = '**Team Alpha** are the preferred winner. Form is the anchor here. '
      + 'Team Alpha have won four of their last five, scoring **7-4** on aggregate. '
      + 'Confidence: MEDIUM.';
    const v = validateVolleyballTip(text, { market: 'win_match' });
    assert.ok(v.violations.some((x) => /forbidden numerals/.test(x)));
  });
});
