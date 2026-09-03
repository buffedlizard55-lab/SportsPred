import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreVolleyballMatch } from '../engine/volleyball_engine.js';
import { writeVolleyballTip, writeVolleyballCard, validateVolleyballTip, buildVolleyballFormattedCardText, MIN_WORDS, VOLLEYBALL_OPENERS } from '../engine/volleyball_writer.js';

const match = {
  id: 'writer-vnl', family: 'vnl-women', home: 'Italy', away: 'Brazil',
  odds: { books: [{ book: 'A', home: -300, away: 220 }, { book: 'B', home: -320, away: 240 }] },
  homeTeam: { name: 'Italy', form: { vnlLast5: ['W', 'W', 'W', 'W', 'L'], vnlLast5SetScores: ['3-0', '3-0', '3-0', '3-1', '1-3'] }, roster: { status: 'confirmed_full' }, stakes: { status: 'finals_fight' }, stats: { killsPerSet: 14, blocksPerSet: 3, aceToErrorRatio: 1.1 } },
  awayTeam: { name: 'Brazil', form: { vnlLast5: ['L', 'W', 'L'], vnlLast5SetScores: ['1-3', '3-1', '0-3'] }, roster: { status: 'key_absence' }, stakes: { status: 'eliminated' }, stats: { killsPerSet: 12, blocksPerSet: 2, aceToErrorRatio: 0.8 } },
  h2h: { recentMeetings: [{ winner: 'Italy', setScore: '3-0' }, { winner: 'Italy', setScore: '3-0' }, { winner: 'Brazil', setScore: '1-3' }] },
};
const result = scoreVolleyballMatch(match);

describe('FIVB VNL Women writer', () => {
  it('writes source-gated forty-word tips with an early bold pick and no raw figures', () => {
    for (const market of ['win_match', 'set_score']) {
      const tip = writeVolleyballTip({ result, market, angle: VOLLEYBALL_OPENERS[0] });
      assert.equal(tip.ok, true, tip.violations?.join('; '));
      assert.ok(tip.text.split(/\s+/).length >= MIN_WORDS);
      assert.match(tip.text, /\*\*[^*]+\*\*/);
      if (market === 'set_score') assert.match(tip.text, /\*\*3-[012]\*\*/);
    }
  });

  it('writes a single explanatory SKIP when a market cannot be sourced', () => {
    const withheld = scoreVolleyballMatch({ family: 'vnl-women', home: 'A', away: 'B' });
    const tip = writeVolleyballTip({ result: withheld, market: 'win_match' });
    assert.equal(tip.ok, true);
    assert.equal(tip.skip, true);
    assert.match(tip.text, /^SKIP — MATCH WINNER:/);
    assert.equal(tip.text.split(/(?<=[.!?])\s+/).filter(Boolean).length, 1);
  });

  it('rejects banned phrase, source name and leaked numerical content', () => {
    const banned = 'Serve-receive frames this view. **Italy** is the MATCH WINNER selection because hard to look past the evidence in a thoroughly explained safe sentence with enough words. Confidence: HIGH.';
    assert.equal(validateVolleyballTip(banned, { market: 'win_match' }).ok, false);
    const sourceLeak = 'Serve-receive frames this view. **Italy** is the MATCH WINNER selection according to FIVB with enough extra plain language to make this into a fully formed written prediction for readers. Confidence: HIGH.';
    assert.equal(validateVolleyballTip(sourceLeak, { market: 'win_match' }).ok, false);
  });

  it('builds a copy-ready card with table, value section and current support wording', () => {
    const card = writeVolleyballCard([{ match, result }]);
    assert.equal(card.violations.length, 0);
    const formatted = buildVolleyballFormattedCardText([{ match, result }], '2026-06-20');
    assert.match(formatted, /SUMMARY TABLE/);
    assert.match(formatted, /VALUE CANDIDATES/);
    assert.match(formatted, /RESPONSIBLE GAMBLING/);
    assert.match(formatted, /1-800-MY-RESET/);
    assert.match(formatted, /0808 8020 133/);
  });
});
