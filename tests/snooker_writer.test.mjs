/**
 * Tests for the snooker Step 4 writer and output validator: word window,
 * no-digit rule, banned fillers, source-name ban, unique openings per card,
 * summary table and responsible-gambling reminder.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  writePrediction, writeSnookerCard, validatePrediction,
  MIN_WORDS, MAX_WORDS, BANNED_PHRASES, FORBIDDEN_TOKENS, OPENERS, ANGLES,
} from '../engine/snooker_writer.js';
import { scoreMatch, CONFIDENCE } from '../engine/snooker_engine.js';

const base = () => scoreMatch({
  id: 'm1',
  playerA: { name: 'Pang Junxu', country: 'CHN', rank: 27 },
  playerB: { name: 'Mark Joyce', country: 'ENG' },
  event: 'Unibet British Open 2026',
  round: 'Round 3 (Last 32)',
}, {
  profiles: {
    a: { name: 'Pang Junxu', last5: [{ winner: 'Pang Junxu' }, { winner: 'Pang Junxu' }, { winner: 'X' }, { winner: 'Pang Junxu' }], inTournament: [{ winner: 'Pang Junxu' }, { winner: 'Pang Junxu' }] },
    b: { name: 'Mark Joyce', last5: [{ winner: 'Mark Joyce' }, { winner: 'Mark Joyce' }, { winner: 'Y' }, { winner: 'Mark Joyce' }, { winner: 'Mark Joyce' }], inTournament: [{ winner: 'Mark Joyce' }, { winner: 'Mark Joyce' }] },
  },
  h2h: { a: 'Pang Junxu', b: 'Mark Joyce', aWins: 0, bWins: 0, total: 0, last3Years: { aWins: 0, bWins: 0, total: 0 } },
  roundTier: 'r32',
  odds: { a: null, b: null },
});

test('every emitted paragraph is inside the 25-40 word window', () => {
  for (let i = 0; i < 40; i += 1) {
    const p = writePrediction(base(), { openerIdx: i, angleIdx: i });
    const words = p.paragraph.trim().split(/\s+/).length;
    assert.ok(words >= MIN_WORDS, `${words} < ${MIN_WORDS}`);
    assert.ok(words <= MAX_WORDS, `${words} > ${MAX_WORDS}`);
    assert.equal(p.ok, true, JSON.stringify(p.violations));
  }
});

test('paragraph contains no digits, links or source names', () => {
  const p = writePrediction(base());
  assert.doesNotMatch(p.paragraph, /\d/); // verdict carries the confidence score; the paragraph carries none
  for (const token of FORBIDDEN_TOKENS) {
    assert.ok(!p.paragraph.toLowerCase().includes(token), `paragraph contains "${token}"`);
  }
});

test('banned filler phrases are rejected by the validator', () => {
  const p = writePrediction(base());
  assert.equal(p.ok, true);
  const bad = { ...p, paragraph: 'This is a tough match and anything can happen, so the winner is hard to call and it could go either way. Confidence: SKIP.' };
  const v = validatePrediction(bad);
  assert.equal(v.ok, false);
  assert.ok(v.violations.some((x) => x.includes('banned phrase')));
});

test('BANNED_PHRASES covers the phrases the prompt names', () => {
  for (const phrase of ['this is a tough match', 'anything can happen', 'could go either way']) {
    assert.ok(BANNED_PHRASES.includes(phrase), `missing ban: ${phrase}`);
  }
});

test('openings across a full card are unique (no repeated templates)', () => {
  const matches = Array.from({ length: 12 }, (_, i) => base());
  const card = writeSnookerCard(matches, { date: '2026-09-02' });
  assert.equal(card.predictions.length, 12);
  assert.equal(card.validation.ok, true, JSON.stringify(card.validation.issues));
  const openers = new Set(card.predictions.map((p) => p.paragraph.split(/\s+/).slice(0, 3).join(' ').toLowerCase()));
  assert.equal(openers.size, 12);
});

test('card output carries the summary table and responsible-gambling reminder', () => {
  const card = writeSnookerCard([base()]);
  assert.deepEqual(card.summaryTable.headers, ['Match', 'Event / round', 'Selection', 'Confidence', 'Model score', 'Bet type']);
  assert.equal(card.summaryTable.rows.length, 1);
  assert.match(card.responsibleGambling, /18\+/);
  assert.match(card.responsibleGambling, /no betting advice|is betting advice/i);
});

test('verdict line carries the winner and the model score', () => {
  const p = writePrediction(base());
  assert.match(p.verdict, /Pang Junxu|Mark Joyce/);
  assert.match(p.verdict, /\/100/);
  assert.ok(p.betType.startsWith('SKIP'));
});

test('openers and angles rotate (the generator has 10+8 distinct shapes)', () => {
  assert.ok(OPENERS.length >= 10);
  assert.ok(ANGLES.length >= 8);
  assert.ok(OPENERS.length >= 12);
  assert.equal(new Set(OPENERS).size, OPENERS.length);
  assert.equal(new Set(ANGLES).size, ANGLES.length);
});
