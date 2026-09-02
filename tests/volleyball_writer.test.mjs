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
    const openers = card.tips.filter((t) => !t.skip).map((t) => t.text.split(/\s+/)[0].toLowerCase());
    assert.equal(openers.length, new Set(openers).size);
    const formatted = buildVolleyballFormattedCardText([{ match, result: scored }], '2026-09-03');
    assert.match(formatted, /Volleyball Predictions — 2026-09-03/);
    assert.match(formatted, /SUMMARY TABLE/);
    assert.match(formatted, /Responsible Gambling/);
  });
});
