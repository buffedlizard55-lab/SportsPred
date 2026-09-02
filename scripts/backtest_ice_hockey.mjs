#!/usr/bin/env node
/**
 * SportsPred — Ice Hockey backtest (walk-forward, leak-free).
 *
 *   node scripts/backtest_ice_hockey.mjs
 *   node scripts/backtest_ice_hockey.mjs --tape data/ice_hockey_tape.json --out data/ice_hockey_backtest.json
 *
 * METHOD
 *  - Every settled game in the tape is re-scored as it looked BEFORE it was
 *    played. Form, winning margins and home splits are computed only from games
 *    that finished earlier in the tape; nothing from the fixture's own result
 *    or from any later game can reach the features.
 *  - Grading is per market and per confidence band, so the scale can be checked
 *    for monotonicity (HIGH should beat MEDIUM should beat LOW).
 *
 * WHAT CANNOT BE GRADED, AND WHY IT IS SAID OUT LOUD
 *  - Puck line and game total both need the closing line. The free feeds retain
 *    no price once a game is final (this repository records the same finding as
 *    U-06 for the universal engine), so those markets are reported as
 *    `ungraded` with the reason rather than being silently dropped.
 *  - Power play %, penalty kill %, shots for/against and the confirmed starter
 *    are not published by any key-less feed we can reach, so they are recorded
 *    as missing in every backtested game. That depresses scores uniformly; it
 *    does not bias one band against another.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreIceHockeyMatch } from '../engine/ice_hockey_engine.js';
import { scheduleFactors, headToHeadFromTape } from '../engine/ice_hockey_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const TAPE_PATH = join(ROOT, arg('--tape', 'data/ice_hockey_tape.json'));
const OUT_PATH = join(ROOT, arg('--out', 'data/ice_hockey_backtest.json'));

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

/** Per-game rates computed strictly from games that finished before `beforeUtc`. */
function tapeProfile(tape, abbrev, beforeUtc) {
  const rows = tape
    .filter((g) => g.phase === 'results' && String(g.startUtc || '') < String(beforeUtc)
      && (g.home?.abbrev === abbrev || g.away?.abbrev === abbrev)
      && g.score?.home != null && g.score?.away != null);
  if (!rows.length) return null;

  let gf = 0, ga = 0;
  let homePlayed = 0, homeWins = 0;
  for (const g of rows) {
    const isHome = g.home?.abbrev === abbrev;
    gf += isHome ? g.score.home : g.score.away;
    ga += isHome ? g.score.away : g.score.home;
    if (isHome) {
      homePlayed += 1;
      if (g.score.home > g.score.away) homeWins += 1;
    }
  }
  return {
    gamesPlayed: rows.length,
    goalsForPerGame: Math.round((gf / rows.length) * 1000) / 1000,
    goalsAgainstPerGame: Math.round((ga / rows.length) * 1000) / 1000,
    homeWinPctg: homePlayed ? Math.round((homeWins / homePlayed) * 10000) / 100 : null,
  };
}

function buildPreMatchFixture(game, tape) {
  const beforeUtc = game.startUtc;
  const sides = {};
  for (const key of ['home', 'away']) {
    const abbrev = game[key]?.abbrev;
    const profile = tapeProfile(tape, abbrev, beforeUtc);
    const sched = scheduleFactors(tape, abbrev, beforeUtc);
    sides[key] = {
      name: game[key]?.name ?? null,
      abbrev,
      goalsForPerGame: profile?.goalsForPerGame ?? null,
      goalsAgainstPerGame: profile?.goalsAgainstPerGame ?? null,
      homeWinPctg: key === 'home' ? profile?.homeWinPctg ?? null : null,
      form: sched?.form ?? null,
      avgWinMarginLast5Wins: sched?.avgWinMarginLast5Wins ?? null,
      recentTotals: null,
      backToBack: sched?.backToBack ?? null,
      puckLineCovers: null,
      goaltender: null,
      injuries: null,
      odds: null,
    };
  }
  return {
    id: game.id,
    league: game.league ?? 'nhl',
    leagueName: game.leagueName ?? 'National Hockey League',
    dateISO: game.dateISO,
    startUtc,
    total: game.total ?? null,
    h2h: headToHeadFromTape(tape, game.home?.abbrev, game.away?.abbrev, beforeUtc),
    home: sides.home,
    away: sides.away,
  };
}

function grade(result, game) {
  const homeScored = game.score?.home;
  const awayScored = game.score?.away;
  if (homeScored == null || awayScored == null) return null;

  const actualWinner = homeScored > awayScored ? game.home.name : awayScored > homeScored ? game.away.name : 'draw';
  const favourite = result.favoured;
  const hit = actualWinner === favourite;

  return {
    id: game.id,
    dateISO: game.dateISO,
    fixture: `${game.away?.name} at ${game.home?.name}`,
    band: result.outright.decision.confidence,
    score: result.outright.favourite.score,
    selection: favourite,
    actual: actualWinner,
    hit: hit ?? null,
    graded: result.outright.decision.confidence !== 'SKIP',
    puckLineGraded: false,
    totalGraded: false,
  };
}

function band(rows) {
  const out = {};
  for (const b of ['HIGH', 'MEDIUM', 'LOW', 'SKIP']) {
    const inBand = rows.filter((r) => r.band === b);
    const graded = inBand.filter((r) => r.graded);
    out[b.toLowerCase()] = {
      picks: inBand.length,
      graded: graded.length,
      hits: graded.filter((r) => r.hit).length,
      hitRate: graded.length ? Math.round((graded.filter((r) => r.hit).length / graded.length) * 1000) / 10 : null,
    };
  }
  return out;
}

function main() {
  const tapeDoc = loadJSON(TAPE_PATH);
  const tape = tapeDoc?.games || [];
  const settled = tape.filter((g) => g.phase === 'results' && g.score?.home != null && g.score?.away != null);

  const rows = [];
  for (const game of settled) {
    const fixture = buildPreMatchFixture(game, tape);
    const result = scoreIceHockeyMatch(fixture, { european: fixture.european === true });
    const graded = grade(result, game);
    if (graded) rows.push(graded);
  }

  const bands = band(rows);
  const gradedRows = rows.filter((r) => r.graded);
  const hitRate = gradedRows.length
    ? Math.round((gradedRows.filter((r) => r.hit).length / gradedRows.length) * 1000) / 10
    : null;

  const rates = ['HIGH', 'MEDIUM', 'LOW']
    .map((b) => bands[b.toLowerCase()].hitRate)
    .filter((r) => r !== null);
  const monotonic = rates.length < 2 ? null : rates.every((r, i) => i === 0 || rates[i - 1] >= r);

  const doc = {
    schema_version: 1,
    sport: 'Ice Hockey',
    prompt: 'ICE HOCKEY PREDICTION MASTER PROMPT v1.0',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'Walk-forward: every settled game is re-scored using only games that finished before it. No feature is taken from the fixture being graded.',
    source_tape: {
      path: arg('--tape', 'data/ice_hockey_tape.json'),
      url: tapeDoc?.endpoints?.[0]?.url ?? null,
      fetched_at_utc: tapeDoc?.fetched_at_utc ?? null,
      games: tape.length,
      settled: settled.length,
    },
    results: {
      graded: gradedRows.length,
      overall_hit_rate_pct: hitRate,
      by_confidence_band: bands,
      confidence_scale_monotonic: monotonic,
      puck_line: { graded: 0, reason: 'the closing puck line is not retained by any free feed once a game is final, so covers cannot be checked historically' },
      game_total: { graded: 0, reason: 'the closing total line is not retained by any free feed once a game is final, so Over/Under cannot be checked historically' },
      roi: null,
      roi_reason: 'no price is attached to a settled fixture, so no return can be computed. Forward collection records the price at pick time; ROI appears only from that ledger.',
    },
    ungraded_inputs: [
      'powerPlayPctg / penaltyKillPctg — not published by any key-less feed we can reach',
      'shotsForRank / shotsAgainstRank — not published by any key-less feed we can reach',
      'goaltender.savePctg for the confirmed starter — no free feed names a future starter',
      'closing prices for puck line and total — stripped once a game is final',
    ],
    irregularities: [
      'IR-HOCKEY-01 single price source (ESPN republishes one book), so the prompt\'s two-book cross-reference cannot be met.',
      'IR-HOCKEY-02 confirmed starting goaltender unavailable from any free feed; the engine treats every starter as unconfirmed, which vetoes HIGH confidence by rule.',
      'IR-HOCKEY-03 power play, penalty kill, shots and blocked shots unavailable; those blocks score zero and are recorded as missing.',
      'IR-HOCKEY-05 no retained closing lines, so puck line and total are ungraded and ROI cannot be computed.',
    ],
    rows: rows.slice(-400),
  };

  writeFileSync(OUT_PATH, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`graded ${gradedRows.length} of ${settled.length} settled games; overall hit rate ${hitRate}%`);
  console.log(`bands: ${JSON.stringify(Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, `${v.graded}/${v.picks} ${v.hitRate}%`])))}`);
  console.log(`wrote ${OUT_PATH}`);
  return 0;
}

process.exit(main());
