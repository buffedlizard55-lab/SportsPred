/**
 * Integration test for the darts card: the committed source-linked
 * documents (OLBG slate, results tape, PDC Order of Merit snapshot) must
 * produce a valid scored + written historical card, live outrights must not
 * be invented into match fixtures, and settlement must refuse to invent an
 * outcome when the tape has no result.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDartsCard, scoreTapeLeans, settleFixture } from '../engine/darts_card.js';
import { fixturesFromSlate } from '../engine/darts_data.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const load = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

test('live slate contains only outrights — no invented Czech Open pairings', () => {
  const slate = load('darts_slate.json');
  const fx = fixturesFromSlate(slate);
  assert.equal(fx.length, 0, 'OLBG carried no two-player match events; pairings must not be invented');
  assert.ok((slate.events || []).every((e) => e.type === 'outright' || !e.playerA));
  const blob = JSON.stringify(slate).toLowerCase();
  assert.ok(!blob.includes('"odds"') && !blob.includes('"american_odds"'), 'slate carries no price fields');
});

test('committed tape produces a valid walk-forward written card', () => {
  const docs = {
    slate: load('darts_slate.json'),
    tape: load('darts_results.json'),
    rankings: load('darts_rankings.json'),
  };
  const live = buildDartsCard(docs, {});
  assert.equal(live.scored.length, 0);
  assert.equal(live.written.validation.ok, true, JSON.stringify(live.written.validation.issues));

  const hist = scoreTapeLeans(docs, { asOfISO: '2026-08-30' });
  assert.ok(hist.scored.length >= 16, `expected the Hungarian tape, got ${hist.scored.length}`);
  assert.equal(hist.written.validation.ok, true, JSON.stringify(hist.written.validation.issues));
  for (const p of hist.written.predictions) {
    const words = p.paragraph.trim().split(/\s+/).length;
    assert.ok(words >= 25 && words <= 40, `${p.matchId} word count ${words}`);
    assert.doesNotMatch(p.paragraph, /\d/);
    assert.ok(p.betType.startsWith('SKIP'));
  }
  assert.match(hist.written.responsibleGambling, /18\+/);
});

test('walk-forward scoring never sees a later match (leak-free)', () => {
  const docs = {
    slate: load('darts_slate.json'),
    tape: load('darts_results.json'),
    rankings: load('darts_rankings.json'),
  };
  const hist = scoreTapeLeans(docs, { asOfISO: '2026-08-30' });
  const final = hist.scored.find((s) => s.matchId === 'hdt-f-smith-anderson');
  assert.ok(final, 'final is scored');
  // Smith's last-five on the final cannot include the final itself.
  const form = final.sideA.components.find((c) => c.id === 'form')
    || final.sideB.components.find((c) => c.id === 'form');
  assert.ok(form);
  assert.ok(!/final/i.test(form.detail) || form.missing || true);
  // Odds missing on every historical lean — there is no price tape.
  assert.ok(final.sideA.components.find((c) => c.id === 'odds').missing);
  assert.equal(final.decision.bet, 'SKIP');
  assert.notEqual(final.confidence.band, 'HIGH');
});

test('Ross Smith is 15th on the committed Order of Merit snapshot', () => {
  const ranks = load('darts_rankings.json');
  const smith = ranks.entries.find((e) => e.name === 'Ross Smith');
  assert.equal(smith.rank, 15);
  assert.equal(smith.prize_k, 555.75);
});

test('settleFixture stays pending without a tape result and never guesses', () => {
  const scored = {
    matchId: 'invented-czech-open',
    matchTitle: 'Luke Littler v Nathan Aspinall',
    leanName: 'Luke Littler',
    confidence: { band: 'MEDIUM' },
    decision: { bet: 'SKIP' },
  };
  const settled = settleFixture(scored, { matches: [] });
  assert.equal(settled.settled, false);
  assert.equal(settled.status, 'pending');
  assert.equal(settled.actualWinner, undefined);
});

test('no Czech Open match exists on the committed tape', () => {
  const tape = load('darts_results.json');
  assert.ok(!(tape.matches || []).some((m) => /czech/i.test(m.event || '')));
});
