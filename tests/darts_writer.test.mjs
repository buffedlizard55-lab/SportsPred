/**
 * Tests for the darts Step 4 writer and output validator: word window,
 * no-digit rule, banned fillers, source-name ban, unique openings per card,
 * summary table and responsible-gambling reminder.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  writePrediction, writeDartsCard, validatePrediction,
  MIN_WORDS, MAX_WORDS, BANNED_PHRASES, FORBIDDEN_TOKENS, OPENERS, ANGLES,
} from '../engine/darts_writer.js';
import { scoreMatch } from '../engine/darts_engine.js';

const base = () => scoreMatch({
  id: 'm1',
  playerA: { name: 'Ross Smith', country: 'ENG', rank: 15 },
  playerB: { name: 'Gary Anderson', country: 'SCO', rank: 10 },
  event: '2026 Hungarian Darts Trophy',
  round: 'Final',
}, {
  profiles: {
    a: {
      name: 'Ross Smith',
      last5: [{ winner: 'Ross Smith' }, { winner: 'Ross Smith' }, { winner: 'Ross Smith' }, { winner: 'X' }, { winner: 'Ross Smith' }],
      inTournament: [{ winner: 'Ross Smith' }, { winner: 'Ross Smith' }],
      lastAverage: 101.01,
    },
    b: {
      name: 'Gary Anderson',
      last5: [{ winner: 'Gary Anderson' }, { winner: 'Gary Anderson' }, { winner: 'Y' }, { winner: 'Gary Anderson' }, { winner: 'Gary Anderson' }],
      inTournament: [{ winner: 'Gary Anderson' }, { winner: 'Gary Anderson' }],
      lastAverage: null,
    },
  },
  h2h: { a: 'Ross Smith', b: 'Gary Anderson', aWins: 0, bWins: 0, total: 0, last3Years: { aWins: 0, bWins: 0, total: 0 } },
  roundTier: 'final',
  odds: { a: null, b: null },
});

test('every emitted paragraph is inside the 25-40 word window', () => {
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
  const matches = Array.from({ length: 12 }, () => base());
  const card = writeDartsCard(matches, { date: '2026-08-30' });
  assert.equal(card.predictions.length, 12);
  assert.equal(card.validation.ok, true, JSON.stringify(card.validation.issues));
  const openers = new Set(card.predictions.map((p) => p.paragraph.split(/\s+/).slice(0, 3).join(' ').toLowerCase()));
  assert.equal(openers.size, 12);
});

test('card output carries the summary table and responsible-gambling reminder', () => {
  const card = writeDartsCard([base()]);
  assert.deepEqual(card.summaryTable.headers, ['Match', 'Event / round', 'Selection', 'Confidence', 'Model score', 'Bet type']);
  assert.equal(card.summaryTable.rows.length, 1);
  assert.match(card.responsibleGambling, /18\+/);
  assert.match(card.responsibleGambling, /no betting advice|is betting advice/i);
});

test('verdict line carries the winner and the model score', () => {
  const p = writePrediction(base());
  assert.match(p.verdict, /Ross Smith|Gary Anderson/);
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

test('a player whose name contains a banned word is not rejected for it', () => {
  /* Gerwyn Price tripped the "price" token in FORBIDDEN_TOKENS. That was
   * unwinnable: the next rule requires the winner's name in the paragraph, so
   * the writer could neither name him nor omit him and every tip for that
   * match published as a violation. Real defect, seen on the committed slate. */
  const p = { ...writePrediction(base()),
    matchTitle: 'Gerwyn Price vs Callan Rydz',
    leanName: 'Gerwyn Price',
    paragraph: 'Gerwyn Price carries the sharper scoring profile in this one, backed '
      + 'by a deeper run of recent results, and that profile should hold up well '
      + 'against the kind of opposition Callan Rydz has offered lately.' };
  const v = validatePrediction(p);
  assert.ok(!v.violations.some((x) => /price/.test(x)),
    `name rejected as a banned token: ${v.violations.join(', ')}`);
});

test('masking a player name does not open a loophole for betting language', () => {
  // The ban must still fire when the token appears outside the player's name.
  const p = { ...writePrediction(base()),
    matchTitle: 'Gerwyn Price vs Callan Rydz',
    leanName: 'Gerwyn Price',
    paragraph: 'Gerwyn Price carries the sharper scoring profile in this one and the '
      + 'price on offer looks generous, so that profile should hold up well '
      + 'against the kind of opposition Callan Rydz has offered lately.' };
  const v = validatePrediction(p);
  assert.ok(v.violations.some((x) => /forbidden token: "price"/.test(x)),
    'betting language slipped through the name mask');
});
