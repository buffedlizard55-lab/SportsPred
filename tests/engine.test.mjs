/**
 * Engine tests. Run with: npm test  (node --test)
 *
 * These execute the real engine module that the browser ships, not a copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreMatch, scoreCard, pickFavourite, normaliseOdds, decimalToAmerican,
  americanToImpliedProb, PATCHES, RULESET_VERSION,
} from '../engine/engine.js';

/* ---------------- odds helpers ---------------- */

test('decimalToAmerican: 1.20 -> -500, 1.50 -> -200, 2.50 -> +150', () => {
  assert.equal(decimalToAmerican(1.20), -500);
  assert.equal(decimalToAmerican(1.50), -200);
  assert.equal(decimalToAmerican(2.50), 150);
  assert.equal(decimalToAmerican(1), null, 'evens has no American form');
});

test('americanToImpliedProb: -500 -> 5/6, +100 -> 0.5', () => {
  assert.ok(Math.abs(americanToImpliedProb(-500) - 5 / 6) < 1e-9);
  assert.equal(americanToImpliedProb(100), 0.5);
});

test('normaliseOdds accepts decimal or American and never invents a price', () => {
  assert.deepEqual(normaliseOdds(1.2), { decimal: 1.2, american: -500 });
  assert.equal(normaliseOdds({ american: -200 }).decimal, 1.5);
  assert.equal(normaliseOdds(null), null);
  assert.equal(normaliseOdds(0), null);
  assert.equal(normaliseOdds(NaN), null);
});

/* ---------------- favourite selection ---------------- */

test('pickFavourite prefers a sourced price over ranking', () => {
  const m = { players: [
    { name: 'A', rank: 3, odds: { decimal: 2.4, american: 140 } },
    { name: 'B', rank: 40, odds: { decimal: 1.5, american: -200 } },
  ] };
  assert.equal(pickFavourite(m)[0].name, 'B');
});

test('pickFavourite returns null when nothing is sourced', () => {
  assert.deepEqual(pickFavourite({ players: [{ name: 'A' }, { name: 'B' }] }), [null, null]);
  assert.deepEqual(pickFavourite({ players: [{ name: 'A' }] }), [null, null]);
});

/* ---------------- unsourced data must not score ---------------- */

test('a match with no sourced data returns the UNSCORED sentinel', () => {
  const r = scoreMatch({ event_id: 1, players: [{ name: 'A' }, { name: 'B' }] });
  assert.equal(r.favourite, null);
  assert.deepEqual(r.markets, {});
  assert.ok(r.missing.includes('favourite could not be determined (no sourced price or ranking)'));
  assert.ok(r.flags.some((f) => f.startsWith('UNSCORED')));
});

test('missing factors are recorded, never guessed', () => {
  const r = scoreMatch({
    event_id: 2,
    players: [
      { name: 'A', rank: 5, odds: { decimal: 1.25, american: -400 } },
      { name: 'B', rank: 120 },
    ],
  });
  assert.ok(r.missing.includes('form.last5 (last 5 match results, last month)'));
  assert.ok(r.missing.some((x) => x.startsWith('surface record')));
  assert.ok(r.markets.win_match.components.some((c) => c.missing));
});

/* ---------------- a fully sourced dominant case ---------------- */

function dominantMatch(overrides = {}) {
  return {
    event_id: 99,
    surface: 'hard',
    tournament: { level: 'GS', round: 'QF' },
    h2h: { sameSurfaceLowerRankedWonOfLast3: 0 },
    opponentRank: 140,
    players: [
      {
        name: 'Favourite Player', rank: 4,
        odds: { decimal: 1.30, american: -333 },
        firstSetOdds: { decimal: 1.45, american: -222 },
        handicapOdds: { decimal: 1.91, american: -110 },
        form: {
          last5: ['W', 'W', 'W', 'W', 'W'],
          tournamentWinStreak: 3,
          straightSetsLast3: [true, true, true],
          beatHigherRankedThisEvent: true,
          documentedSlowStarter: false,
        },
        serve: { firstServePct: 0.68, acesPerMatch: 9 },
        rest: { played3SetsLast24h: false, physicalConcernCited: false },
      },
      {
        name: 'Opponent Player', rank: 140,
        odds: { decimal: 3.6, american: 260 },
        serve: { firstServePct: 0.58, acesPerMatch: 4 },
        form: { lastMatchStraightSetLoss: true },
        rest: { played3SetsLast24h: true, physicalConcernCited: false },
      },
    ],
    ...overrides,
  };
}

test('surface record must live on the player as `surface` (schema guard)', () => {
  // Guards against a silent typo: the engine reads player.surface, so a fixture
  // that spells it differently must be caught here rather than scoring 0 quietly.
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.75, dominantMarginGames: { bigWins: 4, of: 6 }, poorRecordOnSurface: false };
  m.players[1].surface = { wins: 3, losses: 9, poorRecordOnSurface: true };
  const r = scoreMatch(m);
  const surf = r.markets.win_match.components.find((c) => c.id === 'surface');
  assert.equal(surf.missing, false);
  assert.equal(surf.points, 20);
  assert.ok(r.markets.win_match.components.some((c) => c.id === 'surface_bonus' && c.points === 5));
});

test('fully sourced dominant match reaches HIGH on win match', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.75, dominantMarginGames: { bigWins: 4, of: 6 } };
  m.players[1].surface = { wins: 3, losses: 9, poorRecordOnSurface: true };
  const r = scoreMatch(m);
  assert.equal(r.markets.win_match.band, 'HIGH');
  assert.ok(r.markets.win_match.score >= 70, `score was ${r.markets.win_match.score}`);
});

test('scores are capped at 100 despite bonuses', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 20, losses: 0, titles: 2, firstSetWinRateLast10: 0.9, dominantMarginGames: { bigWins: 5, of: 5 } };
  m.players[1].surface = { wins: 1, losses: 10, poorRecordOnSurface: true };
  const r = scoreMatch(m);
  assert.ok(r.markets.win_match.rawScore > 100 || r.markets.win_match.score <= 100);
  assert.ok(r.markets.win_match.score <= 100, `capped score was ${r.markets.win_match.score}`);
  assert.equal(PATCHES.capScoresAt100, true);
});

/* ---------------- handicap gating ---------------- */

test('handicap is SKIPPED when the win-match gate fails', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.75, dominantMarginGames: { bigWins: 4, of: 6 } };
  m.players[0].form.last5 = ['L', 'L', 'L', 'L', 'L'];
  m.players[0].form.straightSetsLast3 = [false, false, false];
  const r = scoreMatch(m);
  assert.equal(r.markets.games_handicap.band, 'SKIP');
  assert.ok(r.flags.some((f) => f.startsWith('HANDICAP SKIPPED')));
});

test('handicap is SKIPPED when the price is outside -120/+110', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.75, dominantMarginGames: { bigWins: 4, of: 6 } };
  m.players[0].handicapOdds = { decimal: 1.5, american: -200 };
  const r = scoreMatch(m);
  assert.equal(r.markets.games_handicap.band, 'SKIP');
  assert.equal(r.markets.games_handicap.gate.priceGate, false);
});

test('handicap activates only when all three gates pass', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.75, dominantMarginGames: { bigWins: 4, of: 6 } };
  m.players[1].surface = { wins: 3, losses: 9, poorRecordOnSurface: true };
  const r = scoreMatch(m);
  assert.deepEqual(r.markets.games_handicap.gate, { winMatchGate: true, straightSetGate: true, priceGate: true });
  assert.notEqual(r.markets.games_handicap.band, 'SKIP');
});

test('physical concern voids the handicap market', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.75, dominantMarginGames: { bigWins: 4, of: 6 } };
  m.players[1].surface = { wins: 3, losses: 9, poorRecordOnSurface: true };
  m.players[0].rest.physicalConcernCited = true;
  const r = scoreMatch(m);
  assert.equal(r.markets.games_handicap.band, 'SKIP');
  assert.ok(r.flags.some((f) => f.startsWith('RISK')));
});

/* ---------------- step 3 profitability rules ---------------- */

test('a sub -500 favourite with weak surface form is blocked outright', () => {
  const m = dominantMatch();
  m.players[0].odds = { decimal: 1.15, american: -667 };
  m.players[0].surface = { wins: 2, losses: 6, titles: 0, firstSetWinRateLast10: 0.5, dominantMarginGames: { bigWins: 0, of: 5 } };
  const r = scoreMatch(m);
  assert.equal(r.markets.win_match.band, 'SKIP');
  assert.ok(r.flags.some((f) => f.startsWith('BLOCKED')));
});

test('a sub -500 first-set price is blocked at the market ceiling', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.8, dominantMarginGames: { bigWins: 4, of: 6 } };
  m.players[1].surface = { wins: 3, losses: 9, poorRecordOnSurface: true };
  m.players[0].firstSetOdds = { decimal: 1.14, american: -714 };
  const r = scoreMatch(m);
  assert.equal(r.markets.first_set.band, 'SKIP');
});

/* ---------------- first-set independence (patched defect) ---------------- */

test('first-set score can fall below the HIGH threshold (v1.0 could not)', () => {
  const m = dominantMatch();
  m.players[0].surface = { wins: 18, losses: 2, titles: 1, firstSetWinRateLast10: 0.40, dominantMarginGames: { bigWins: 4, of: 6 } };
  m.players[1].surface = { wins: 3, losses: 9, poorRecordOnSurface: true };
  m.players[0].form.documentedSlowStarter = true;
  m.players[0].rest.played3SetsLast24h = true;
  m.players[1].rest.played3SetsLast24h = false;
  m.players[0].firstSetOdds = { decimal: 3.0, american: 200 };
  const r = scoreMatch(m);
  assert.ok(r.markets.first_set.score < 70,
    `first-set score ${r.markets.first_set.score} — the v1.0 inherited-base defect would keep this at 70+`);
});

/* ---------------- card-level rule ---------------- */

test('three or more weak matches trims the card to the three highest', () => {
  const weak = [1, 2, 3, 4].map((i) => ({
    event_id: i,
    players: [
      { name: `W${i}A`, rank: 300 + i, odds: { decimal: 2.1, american: 110 } },
      { name: `W${i}B`, rank: 320 + i, odds: { decimal: 1.75, american: -133 } },
    ],
  }));
  const card = scoreCard(weak);
  assert.equal(card.trimmed, true);
  assert.equal(card.results.length, 3);
  assert.ok(card.trimmedReason.includes('below 55'));
});

test('a small card is never trimmed', () => {
  const few = [1, 2].map((i) => ({
    event_id: i,
    players: [
      { name: `A${i}`, rank: 10, odds: { decimal: 1.5, american: -200 } },
      { name: `B${i}`, rank: 90, odds: { decimal: 2.6, american: 160 } },
    ],
  }));
  const card = scoreCard(few);
  assert.equal(card.trimmed, false);
  assert.equal(card.results.length, 2);
});

test('ruleset version is stamped on every result', () => {
  const r = scoreMatch({ event_id: 7, players: [{ name: 'A', rank: 1 }, { name: 'B', rank: 2 }] });
  assert.equal(r.ruleset, RULESET_VERSION);
});
