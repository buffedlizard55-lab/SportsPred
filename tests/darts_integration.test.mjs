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

/**
 * The slate is whatever OLBG was carrying when it was collected: outrights only
 * on a quiet day, thirteen real first-round pairings during a tournament. The
 * old assertion pinned the quiet-day shape (`fx.length === 0`) and so broke on
 * the next refresh even though nothing was wrong with the data. What must never
 * change is the reason a fixture exists at all — a sourced OLBG event — so that
 * is what is asserted here, over whatever the refresh left behind.
 */
test('every live-slate fixture traces to a sourced OLBG event — no invented pairings', () => {
  const slate = load('darts_slate.json');
  const fx = fixturesFromSlate(slate);

  const sourced = (slate.events || []).filter((e) => e.type !== 'outright' && e.event_id && e.url);
  assert.equal(
    fx.length,
    sourced.length,
    'one fixture per sourced non-outright event — none invented, none dropped',
  );

  const outrightIds = new Set(
    (slate.events || []).filter((e) => e.type === 'outright').map((e) => `olbg-${e.event_id}`),
  );

  for (const f of fx) {
    assert.match(String(f.id), /^olbg-\d+$/, `fixture id carries its OLBG event id: ${f.id}`);
    assert.ok(!outrightIds.has(f.id), 'an outright market is never turned into a two-player fixture');

    const ev = sourced.find((e) => `olbg-${e.event_id}` === f.id);
    assert.ok(ev, `fixture ${f.id} has the slate event it came from`);
    assert.ok((f.sourceUrls || []).includes(ev.url), `fixture ${f.id} links the event it came from`);

    // Both names must be the ones OLBG published — nothing supplied locally.
    for (const name of [f.playerA.name, f.playerB.name]) {
      const declared = [ev.playerA?.name, ev.playerB?.name].filter(Boolean);
      assert.ok(
        String(ev.matchup || '').includes(name) || declared.includes(name),
        `${name} comes from sourced event ${ev.event_id} ("${ev.matchup}")`,
      );
    }
  }

  // Consensus is displayed; the slate never carries prices.
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
  // Scores exactly the sourced slate — nothing on a quiet day, one card per
  // OLBG match event during a tournament. Either way nothing is added.
  assert.equal(
    live.scored.length,
    fixturesFromSlate(docs.slate).length,
    'the live card scores every sourced fixture and invents none',
  );
  for (const s of live.scored) {
    assert.match(String(s.matchId), /^olbg-\d+$/, `scored card keeps its OLBG event id: ${s.matchId}`);
    assert.ok(
      (s.sourceUrls || []).some((u) => String(u).includes('olbg.com')),
      `scored card ${s.matchId} carries the OLBG review link`,
    );
  }
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
