/**
 * Tests for the ESPN parsers and surface resolution.
 *
 * The scoreboard fixture is a trimmed EXCERPT of genuine ESPN responses
 * (see its _fixture_provenance block), so these assertions describe ESPN's
 * real payload shape rather than an invented one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseScoreboard, parseCompetition, parseRankings, tourOf, isSingles,
  setScores, isStraightSets, gamesMargin, buildPlayerStats, buildH2H, normaliseName,
} from '../engine/espn.js';
import { resolveSurface, normaliseTournament } from '../engine/surface.js';

const here = dirname(fileURLToPath(import.meta.url));
const board = JSON.parse(readFileSync(join(here, 'fixtures/espn_scoreboard.EXCERPT.json'), 'utf8'));
const surfaces = JSON.parse(readFileSync(join(here, '../data/surfaces.json'), 'utf8'));

/* ---------------------------------------------------------------- *
 * Scoreboard parsing
 * ---------------------------------------------------------------- */

test('parseScoreboard keeps only real singles match-ups', () => {
  const rows = parseScoreboard(board, 'atp');
  // Fixture holds: 1 completed singles, 1 TBD singles, 1 TBD doubles, 1 WTA singles.
  const ids = rows.map((r) => r.competition_id).sort();
  assert.deepEqual(ids, ['178684', '184607']);
});

test('doubles draws are excluded entirely', () => {
  const rows = parseScoreboard(board, 'atp');
  assert.equal(rows.some((r) => r.competition_id === '184900'), false);
});

test('TBD placeholder competitors are excluded', () => {
  const rows = parseScoreboard(board, 'atp');
  assert.equal(rows.some((r) => r.competition_id === '182549'), false);
  assert.equal(rows.some((r) => r.players.some((p) => p.name === 'TBD')), false);
});

test('tour comes from the grouping, not the requested league slug', () => {
  // Genuine ESPN behaviour: a Women's Singles draw appears under the ATP league.
  const rows = parseScoreboard(board, 'atp');
  const nordea = rows.find((r) => r.competition_id === '178684');
  assert.equal(nordea.league, 'atp');
  assert.equal(nordea.tour, 'WTA');
});

test('completed match carries winner, sets, straight-sets and margin', () => {
  const rows = parseScoreboard(board, 'atp');
  const m = rows.find((r) => r.competition_id === '184607');
  assert.equal(m.completed, true);
  assert.equal(m.phase, 'results');
  assert.equal(m.winner_name, 'Jacob Fearnley');
  assert.equal(m.winner_id, '11685');
  assert.equal(m.straight_sets, true);
  // 7-6, 6-3 => winner 13 games, loser 9.
  assert.equal(m.games_margin, 4);
  assert.equal(m.first_set_winner_id, '11685');
  assert.equal(m.round, 'Qualifying 1st Round');
  assert.equal(m.best_of, 5);
});

test('ESPN never yields odds or a surface', () => {
  const rows = parseScoreboard(board, 'atp');
  for (const r of rows) {
    assert.equal(r.surface, null, 'surface must come from the surface map, not ESPN');
    assert.equal('odds' in r, false, 'no odds field may exist — ESPN publishes none');
  }
  // And no price-like key anywhere in the serialised rows.
  assert.equal(/"(odds|moneyline|price|handicap)"/.test(JSON.stringify(rows)), false);
});

test('parseCompetition returns null for non-singles and malformed input', () => {
  assert.equal(parseCompetition(null, {}), null);
  assert.equal(parseCompetition({ competitors: [] }, { groupingSlug: 'mens-singles' }), null);
});

/* ---------------------------------------------------------------- *
 * Small pure helpers
 * ---------------------------------------------------------------- */

test('tourOf and isSingles read the draw description', () => {
  assert.equal(tourOf('womens-singles', "Women's Singles"), 'WTA');
  assert.equal(tourOf('mens-singles', "Men's Singles"), 'ATP');
  assert.equal(tourOf('', ''), null);
  assert.equal(isSingles('mens-singles', "Men's Singles"), true);
  assert.equal(isSingles('mens-doubles', "Men's Doubles"), false);
  assert.equal(isSingles('mixed-doubles', 'Mixed Doubles'), false);
});

test('setScores / isStraightSets / gamesMargin handle absent data as null', () => {
  assert.equal(setScores(null, null), null);
  assert.equal(isStraightSets(null, true), null);
  assert.equal(gamesMargin(null, true), null);
  const sets = setScores(
    [{ value: 6 }, { value: 4 }, { value: 6 }],
    [{ value: 4 }, { value: 6 }, { value: 3 }],
  );
  assert.equal(sets.length, 3);
  assert.equal(isStraightSets(sets, true), false); // lost a set
  assert.equal(gamesMargin(sets, true), 3);        // 16 - 13
});

test('normaliseName folds case and accents so sources can join', () => {
  assert.equal(normaliseName('Carlos Alcaraz'), 'carlos alcaraz');
  assert.equal(normaliseName('Roberto Carballés Baena'), normaliseName('Roberto Carballes Baena'));
});

/* ---------------------------------------------------------------- *
 * Rankings
 * ---------------------------------------------------------------- */

test('parseRankings derives trajectory from current vs previous', () => {
  const payload = {
    rankings: [{
      ranks: [
        { current: 1, previous: 1, points: 12800, athlete: { id: '3623', displayName: 'Jannik Sinner' } },
        { current: 5, previous: 9, points: 4000, athlete: { id: '999', displayName: 'Riser Player' } },
        { current: 40, previous: 22, points: 1200, athlete: { id: '888', displayName: 'Faller Player' } },
      ],
    }],
  };
  const r = parseRankings(payload);
  assert.equal(r.byId['3623'].trajectory, 'stable');
  assert.equal(r.byId['999'].trajectory, 'rising');
  assert.equal(r.byId['888'].trajectory, 'falling');
  assert.equal(r.byName['jannik sinner'].rank, 1);
  assert.equal(r.count, 3);
});

/* ---------------------------------------------------------------- *
 * Surface resolution
 * ---------------------------------------------------------------- */

test('surface map resolves the majors from recorded match rows', () => {
  assert.equal(resolveSurface(surfaces, 'US Open', 'ATP').surface, 'Hard');
  assert.equal(resolveSurface(surfaces, 'Wimbledon', 'ATP').surface, 'Grass');
  assert.equal(resolveSurface(surfaces, 'Roland Garros', 'ATP').surface, 'Clay');
  assert.equal(resolveSurface(surfaces, 'Australian Open', 'WTA').surface, 'Hard');
});

test('an unknown tournament resolves to null with a reason, never a guess', () => {
  const r = resolveSurface(surfaces, 'Totally Fictional Invitational', 'ATP');
  assert.equal(r.surface, null);
  assert.equal(r.reason, 'tournament-not-in-map');
});

test('a tournament whose source rows disagree stays null', () => {
  // Genuine conflicts in the source data: these events changed surface.
  const conflictKeys = surfaces.conflicts.map((c) => c.key);
  assert.ok(conflictKeys.length > 0, 'fixture should retain real conflicts');
  for (const key of conflictKeys) {
    const entry = surfaces.tournaments[key];
    assert.equal(entry.surface, null);
  }
});

test('every resolved surface is backed by real match rows', () => {
  for (const [key, t] of Object.entries(surfaces.tournaments)) {
    if (!t.surface) continue;
    assert.ok(t.matches > 0, `${key} must cite source rows`);
    assert.ok(t.agreement >= surfaces.min_agreement, `${key} below agreement floor`);
    assert.ok(['Hard', 'Clay', 'Grass', 'Carpet'].includes(t.surface), `${key} odd surface ${t.surface}`);
  }
});

test('tournament normalisation matches the builder', () => {
  assert.equal(normaliseTournament("Queen's Club Championships"), normaliseTournament('Queens Club Championships'));
  assert.equal(normaliseTournament('US Open'), 'us open');
});

/* ---------------------------------------------------------------- *
 * Player statistics built from a match tape
 * ---------------------------------------------------------------- */

/** Build a completed-match row the way parseCompetition would. */
function row(id, date, aId, bId, winnerId, sets, opts = {}) {
  const aWon = winnerId === aId;
  const s = sets.map(([a, b]) => ({ a, b, aTiebreak: null, bTiebreak: null }));
  return {
    competition_id: id,
    tournament_id: opts.tid ?? 't1',
    tournament: opts.tname ?? 'Test Open',
    date,
    completed: true,
    phase: 'results',
    surface: opts.surface ?? 'Hard',
    players: [{ espn_id: aId }, { espn_id: bId }],
    winner_id: winnerId,
    sets: s,
    straight_sets: isStraightSets(s, aWon),
    games_margin: gamesMargin(s, aWon),
    first_set_winner_id: s[0].a === s[0].b ? null : (s[0].a > s[0].b ? aId : bId),
  };
}

test('buildPlayerStats computes form only from matches before the as-of date', () => {
  const tape = [
    row('1', '2026-08-01', 'P', 'X', 'P', [[6, 4], [6, 3]]),
    row('2', '2026-08-05', 'P', 'Y', 'P', [[6, 2], [6, 2]]),
    row('3', '2026-08-10', 'P', 'Z', 'Z', [[3, 6], [4, 6]]),
    row('4', '2026-08-15', 'P', 'W', 'P', [[7, 5], [6, 4]]),
    row('5', '2026-08-20', 'P', 'V', 'P', [[6, 1], [6, 0]]),
    // After the as-of date — must be ignored (no lookahead).
    row('6', '2026-09-01', 'P', 'U', 'U', [[0, 6], [1, 6]]),
  ];
  const s = buildPlayerStats('P', tape, 'Hard', '2026-08-25');
  assert.deepEqual(s.form.last5, ['W', 'W', 'L', 'W', 'W']); // most recent first
  assert.equal(s.sampleSizes.total, 5, 'the future match must not be counted');
  assert.equal(s.surface.matches, 5);
  assert.equal(s.surface.wins, 4);
});

test('buildPlayerStats returns nulls, not zeros, when there is no tape', () => {
  const s = buildPlayerStats('P', [], 'Hard', '2026-08-25');
  assert.equal(s.form, null);
  assert.equal(s.surface, null);
  assert.equal(s.serve, null, 'ESPN ships empty competitor statistics — serve stays unsourced');
  assert.equal(s.sampleSizes.total, 0);
});

test('serve statistics are never fabricated', () => {
  const tape = [row('1', '2026-08-01', 'P', 'X', 'P', [[6, 4], [6, 3]])];
  assert.equal(buildPlayerStats('P', tape, 'Hard', '2026-08-25').serve, null);
});

test('surface split only counts the requested surface within 12 months', () => {
  const tape = [
    row('1', '2026-08-01', 'P', 'X', 'P', [[6, 4], [6, 3]], { surface: 'Clay' }),
    row('2', '2026-08-02', 'P', 'Y', 'P', [[6, 4], [6, 3]], { surface: 'Hard' }),
    row('3', '2024-01-02', 'P', 'Z', 'P', [[6, 4], [6, 3]], { surface: 'Hard' }), // >12 months
  ];
  const s = buildPlayerStats('P', tape, 'Hard', '2026-08-25');
  assert.equal(s.surface.matches, 1, 'stale and off-surface rows excluded');
});

test('straight-set and dominance counts come from real set scores', () => {
  const tape = [
    row('1', '2026-08-20', 'P', 'A', 'P', [[6, 1], [6, 0]]), // straight, +11
    row('2', '2026-08-18', 'P', 'B', 'P', [[3, 6], [6, 4], [6, 4]]), // not straight
    row('3', '2026-08-16', 'P', 'C', 'P', [[6, 2], [6, 2]]), // straight, +8
  ];
  const s = buildPlayerStats('P', tape, 'Hard', '2026-08-25');
  // The engine reads this as an array of booleans over the last three matches,
  // most recent first: straight-set win, three-setter, straight-set win.
  assert.deepEqual(s.form.straightSetsLast3, [true, false, true]);
  assert.equal(s.surface.bigWins, 2);
  assert.deepEqual(s.surface.dominantMarginGames, { bigWins: 2, of: 3 });
});

test('first-set win rate is a rate over a visible denominator', () => {
  const tape = [
    row('1', '2026-08-20', 'P', 'A', 'P', [[6, 1], [6, 0]]),
    row('2', '2026-08-18', 'P', 'B', 'B', [[2, 6], [4, 6]]),
  ];
  const s = buildPlayerStats('P', tape, 'Hard', '2026-08-25');
  assert.equal(s.form.firstSetWinRateLast10, 0.5);
  assert.equal(s.sampleSizes.firstSetPool, 2);
});

test('buildH2H counts only genuine meetings and returns null otherwise', () => {
  const tape = [
    row('1', '2026-08-20', 'P', 'Q', 'P', [[6, 1], [6, 0]], { surface: 'Hard' }),
    row('2', '2026-07-20', 'P', 'Q', 'Q', [[2, 6], [4, 6]], { surface: 'Clay' }),
    row('3', '2026-06-20', 'P', 'Z', 'P', [[6, 1], [6, 0]], { surface: 'Hard' }),
  ];
  const h = buildH2H('P', 'Q', tape, 'Hard');
  assert.equal(h.matches, 2);
  assert.equal(h.aWins, 1);
  assert.equal(h.surfaceMatches, 1);
  assert.equal(buildH2H('P', 'NOBODY', tape, 'Hard'), null);
});
