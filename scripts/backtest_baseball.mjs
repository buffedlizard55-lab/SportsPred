#!/usr/bin/env node
/**
 * SportsPred — Baseball backtest (walk-forward, leak-free).
 *
 *   node scripts/backtest_baseball.mjs
 *   node scripts/backtest_baseball.mjs --tape data/baseball_tape.json --out data/baseball_backtest.json
 *
 * METHOD
 *  - Every settled game in the tape is re-scored as it looked BEFORE it was
 *    played. Form, run differential, winning margins and head-to-head are
 *    computed only from games that finished earlier in the tape; nothing from
 *    the fixture's own result or from any later game can reach the features.
 *  - Grading is per confidence band, so the scale can be checked for
 *    monotonicity (HIGH should beat MEDIUM should beat LOW).
 *
 * WHAT CANNOT BE GRADED, AND WHY IT IS SAID OUT LOUD
 *  - Run line and game total both need the closing line, and no key-less feed
 *    retains a baseball line once a game is final (this repository records the
 *    same finding as U-06 for the universal engine). Those markets are
 *    reported as `ungraded` with the reason rather than silently dropped.
 *  - Odds, bullpen ERA rank and wind are not published by any key-less feed,
 *    so they are recorded as missing in every backtested game. That depresses
 *    scores uniformly; it does not bias one band against another.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreBaseballMatch } from '../engine/baseball_engine.js';
import { scheduleFactors, headToHeadFromTape } from '../engine/baseball_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const TAPE_PATH = join(ROOT, arg('--tape', 'data/baseball_tape.json'));
const OUT_PATH = join(ROOT, arg('--out', 'data/baseball_backtest.json'));

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function buildPreMatchFixture(game, tape) {
  const beforeUtc = game.startUtc;
  const sides = {};
  for (const key of ['home', 'away']) {
    const abbrev = game[key]?.abbrev;
    const sched = scheduleFactors(tape, abbrev, beforeUtc);
    sides[key] = {
      name: game[key]?.name ?? null,
      abbrev,
      id: game[key]?.id ?? null,
      record: game[key]?.record ?? null,
      recordSummary: null,
      runDiffPerGame: sched?.runDiffPerGame ?? null,
      runsPerGameRecent: sched?.runsPerGameRecent ?? null,
      runsAgainstPerGameRecent: sched?.runsAgainstPerGameRecent ?? null,
      avgWinMarginLast5Wins: sched?.avgWinMarginLast5Wins ?? null,
      form: sched?.form ?? null,
      recentTotals: null,
      bullpenRank: null,
      bullpenLeagueSize: null,
      bullpenFatigue: null,
      vsStarterHandednessAvg: null,
      starter: null, // no historical probable-pitcher stats are retained key-less
      odds: null,
    };
  }
  return {
    id: game.id,
    league: game.league ?? 'mlb',
    leagueName: game.leagueName ?? 'Major League Baseball',
    dateISO: game.dateISO,
    startUtc: beforeUtc,
    venueIndoor: game.venueIndoor ?? null,
    wind: null,
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
    band: result.winMatch.decision.confidence,
    score: result.winMatch.favourite.score,
    selection: favourite,
    actual: actualWinner,
    hit: hit ?? null,
    graded: result.winMatch.decision.confidence !== 'SKIP',
    runLineGraded: false,
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
    const result = scoreBaseballMatch(fixture);
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
    sport: 'Baseball',
    prompt: 'BASEBALL PREDICTION MASTER PROMPT v1.0',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'Walk-forward: every settled game is re-scored using only games that finished before it. No feature is taken from the fixture being graded.',
    source_tape: {
      path: arg('--tape', 'data/baseball_tape.json'),
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
      run_line: { graded: 0, reason: 'the closing run line is not retained by any free feed once a game is final, so covers cannot be checked historically' },
      game_total: { graded: 0, reason: 'the closing total line is not retained by any free feed once a game is final, so Over/Under cannot be checked historically' },
      roi: null,
      roi_reason: 'no price is attached to a settled fixture, so no return can be computed. Forward collection records the price at pick time; ROI appears only from that ledger.',
    },
    ungraded_inputs: [
      'odds (moneyline / run line / total) — no key-less baseball price feed exists',
      'starter ERA/WHIP/K9 for historical games — probable-pitcher stats are not retained key-less',
      'bullpenRank / bullpenFatigue — no key-less feed isolates relievers',
      'recentTotals — requires a posted line',
      'wind direction/speed — not published by any verified feed',
    ],
    irregularities: [
      'IR-BASEBALL-01 no key-less moneyline/run line/total feed, so the Odds and Value block scores as missing and price-gated Step 3 rules resolve to SKIP.',
      'IR-BASEBALL-02 bullpen ERA rank and 3-day usage are unavailable; the bullpen blocks score as missing.',
      'IR-BASEBALL-03 wind direction/speed are unavailable; only the indoor (dome) flag is sourced.',
      'IR-BASEBALL-04 no retained closing lines, so run line and total are ungraded and ROI cannot be computed.',
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
