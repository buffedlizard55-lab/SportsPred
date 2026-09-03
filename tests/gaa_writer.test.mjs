import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writePrediction, writeGaaCard, validatePrediction,
  MIN_WORDS, MAX_WORDS, BANNED_PHRASES, FORBIDDEN_TOKENS, OPENERS, ANGLES,
} from '../engine/gaa_writer.js';
import { scoreMatch } from '../engine/gaa_engine.js';

const base = () => scoreMatch({
  id: 'm1',
  teamA: { name: 'Mayo', rank: 1 },
  teamB: { name: 'Kerry', rank: 2 },
  event: 'All-Ireland',
  round: 'Final',
}, {
  profiles: {
    a: {
      name: 'Mayo',
      last5: [{ winner: 'Mayo' }, { winner: 'Mayo' }, { winner: 'Mayo' }, { winner: 'X' }, { winner: 'Mayo' }],
      inCompetition: [{ winner: 'Mayo' }, { winner: 'Mayo' }],
    },
    b: {
      name: 'Kerry',
      last5: [{ winner: 'Kerry' }, { winner: 'Kerry' }, { winner: 'Y' }, { winner: 'Kerry' }, { winner: 'Kerry' }],
      inCompetition: [{ winner: 'Kerry' }],
    },
  },
  h2h: { a: 'Mayo', b: 'Kerry', aWins: 0, bWins: 0, total: 0, last3Years: { aWins: 0, bWins: 0, total: 0 } },
  roundTier: 'final',
  odds: { a: null, b: null },
});

test('every emitted paragraph is inside the 40-70 word window', () => {
  for (let i = 0; i < 40; i += 1) {
    const p = writePrediction(base(), { openerIdx: i, angleIdx: i });
    const words = p.paragraph.trim().split(/\s+/).length;
    assert.ok(words >= MIN_WORDS, `${words} < ${MIN_WORDS}: ${p.paragraph}`);
    assert.ok(words <= MAX_WORDS, `${words} > ${MAX_WORDS}: ${p.paragraph}`);
    assert.equal(p.ok, true, JSON.stringify(p.violations));
  }
});

test('paragraph contains no digits, links or source names', () => {
  const p = writePrediction(base());
  assert.doesNotMatch(p.paragraph, /\d/);
  for (const token of FORBIDDEN_TOKENS) {
    assert.ok(!p.paragraph.toLowerCase().includes(token), `paragraph contains "${token}"`);
  }
});

test('banned filler phrases are rejected', () => {
  const p = writePrediction(base());
  const bad = { ...p, paragraph: 'This is a tough match and anything can happen, so the winner is hard to call and it could go either way. Confidence: SKIP.' };
  const v = validatePrediction(bad);
  assert.equal(v.ok, false);
});

test('openings across a full card are unique', () => {
  const matches = Array.from({ length: 12 }, () => base());
  const card = writeGaaCard(matches, { date: '2026-07-26' });
  assert.equal(card.validation.ok, true, JSON.stringify(card.validation.issues));
  const openers = new Set(card.predictions.map((p) => p.paragraph.split(/\s+/).slice(0, 3).join(' ').toLowerCase()));
  assert.equal(openers.size, 12);
});

test('card carries summary table and responsible gambling', () => {
  const card = writeGaaCard([base()]);
  assert.equal(card.summaryTable.rows.length, 1);
  assert.match(card.responsibleGambling, /18\+/);
});

test('openers and angles rotate', () => {
  assert.ok(OPENERS.length >= 12);
  assert.ok(ANGLES.length >= 8);
  assert.equal(new Set(OPENERS).size, OPENERS.length);
});
