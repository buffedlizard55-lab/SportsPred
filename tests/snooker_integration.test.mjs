/**
 * Integration test for the snooker card: the committed source-linked
 * documents (OLBG slate, results tape, WST ranking snapshot) must produce a
 * valid scored + written card, and settlement must refuse to invent an
 * outcome when the tape has no result.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSnookerCard, settleFixture } from '../engine/snooker_card.js';
import { scoreMatch } from '../engine/snooker_engine.js';
import { prepareFixture, fixturesFromSlate } from '../engine/snooker_data.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const load = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

test('committed documents produce exactly one scored, valid prediction', () => {
  const docs = {
    slate: load('snooker_slate.json'),
    tape: load('snooker_results.json'),
    rankings: load('snooker_rankings.json'),
  };
  const card = buildSnookerCard(docs, {});
  assert.equal(card.scored.length, 1);
  assert.equal(card.written.predictions.length, 1);
  assert.equal(card.written.validation.ok, true, JSON.stringify(card.written.validation.issues));
  const p = card.written.predictions[0];
  const words = p.paragraph.trim().split(/\s+/).length;
  assert.ok(words >= 25 && words <= 40, `word count ${words}`);
  assert.doesNotMatch(p.paragraph, /\d/);
  assert.ok(p.betType.startsWith('SKIP'));
  assert.ok(card.summary.rows.length === 1);
  assert.match(card.written.responsibleGambling, /18\+/);
});

test('scoring of the live fixture uses sourced data only: verified facts asserted', () => {
  const docs = {
    slate: load('snooker_slate.json'),
    tape: load('snooker_results.json'),
    rankings: load('snooker_rankings.json'),
  };
  const card = buildSnookerCard(docs, {});
  const m = card.scored[0];
  // Pang: 3/5 + in-tournament bonus = 10 + 5 = 15; rank 27 = 0; stage Last 32 = 0.
  const aForm = m.sideA.components.find((c) => c.id === 'form');
  assert.equal(aForm.points, 15);
  assert.match(aForm.detail, /3\/5 wins/);
  // Joyce: 4/5 + bonus = 18 + 5 = 23; unranked vs ranked opponent = -5; total 18.
  const bForm = m.sideB.components.find((c) => c.id === 'form');
  assert.equal(bForm.points, 23);
  assert.match(bForm.detail, /4\/5 wins/);
  const bRank = m.sideB.components.find((c) => c.id === 'ranking');
  assert.equal(bRank.points, -5);
  assert.equal(m.sideB.score, 18);
  // Zero verified meetings -> H2H missing on both sides.
  assert.ok(m.sideA.components.find((c) => c.id === 'h2h').missing);
  assert.ok(m.sideB.components.find((c) => c.id === 'h2h').missing);
  // No verified price -> odds missing, decision SKIP, HIGH impossible.
  assert.ok(m.sideA.components.find((c) => c.id === 'odds').missing);
  assert.equal(m.decision.bet, 'SKIP');
  assert.notEqual(m.confidence.band, 'HIGH');
});

test('settleFixture stays pending without a tape result and never guesses', () => {
  const docs = {
    slate: load('snooker_slate.json'),
    tape: { matches: load('snooker_results.json').matches.filter((m) => m.winner) },
    rankings: load('snooker_rankings.json'),
  };
  const card = buildSnookerCard(docs, {});
  const settled = settleFixture(card.scored[0], { matches: [] });
  assert.equal(settled.settled, false);
  assert.equal(settled.status, 'pending');
  assert.equal(settled.actualWinner, undefined);
});

test('engine + writer round-trip through the committed fixture is stable', () => {
  const docs = {
    slate: load('snooker_slate.json'),
    tape: load('snooker_results.json'),
    rankings: load('snooker_rankings.json'),
  };
  const card = buildSnookerCard(docs, {});
  const m = card.scored[0];
  // Rebuilding the same fixture from the same committed documents must be
  // deterministic: same profile, same H2H, same lean, score and decision.
  const fx = fixturesFromSlate(docs.slate).find((f) => f.id === m.matchId);
  const prep = prepareFixture(fx, { tape: docs.tape, rankings: docs.rankings, asOfISO: card.asOfISO });
  const again = scoreMatch(prep.match, {
    profiles: prep.profiles,
    h2h: prep.h2h,
    roundTier: prep.roundTier,
    dateISO: fx.dateISO,
    asOfISO: card.asOfISO,
  });
  assert.ok(again.score >= 0 && again.score <= 100);
  assert.equal(again.leanName, m.leanName);
  assert.equal(again.score, m.score);
  assert.equal(again.decision.bet, m.decision.bet);
  assert.equal(again.players.length, 2);
});
