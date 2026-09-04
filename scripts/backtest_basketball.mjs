#!/usr/bin/env node
/**
 * SportsPred — NBA/WNBA backtest (walk-forward, leak-free).
 *
 *   node scripts/backtest_basketball.mjs
 *   node scripts/backtest_basketball.mjs --tape data/basketball_tape.json --out data/basketball_backtest.json
 *
 * METHOD
 *  - Every settled game in the tape is re-scored as it looked BEFORE it was
 *    played. Form, win-rate, head-to-head and rest are computed only from games
 *    that finished earlier in the tape; nothing from the fixture's own result
 *    or from any later game can reach the features.
 *  - Grading is per confidence band, so the scale can be checked for
 *    monotonicity (HIGH should beat MEDIUM should beat LOW).
 *
 * WHAT CANNOT BE GRADED, AND WHY IT IS SAID OUT LOUD
 *  - WIN MATCH is the only graded market. POINT SPREAD and GAME TOTAL need the
 *    closing line / total, and no key-less feed retains a basketball line once
 *    a game is final (the engine records this as NBA-ATS / NBA-TRENDS). Those
 *    markets are reported as `ungraded` with the reason rather than dropped.
 *  - Closing moneyline odds are likewise not retained, so every backtested
 *    game runs without the odds-strength bucket (NBA-ODDS missing). That
 *    depresses scores uniformly; it does not bias one band against another.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const isDirect = process.argv[1] === fileURLToPath(import.meta.url);
import { scoreNbaMatch } from '../engine/nba_engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const TAPE_PATH = join(ROOT, arg('--tape', 'data/basketball_tape.json'));
const STANDINGS_PATH = join(ROOT, arg('--standings', 'data/basketball_standings.json'));
const OUT_PATH = join(ROOT, arg('--out', 'data/basketball_backtest.json'));

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

/** Prior games only — nothing at or after `beforeUtc` is visible. */
function priorGames(tape, beforeUtc) {
  return tape.filter((g) => String(g.startUtc) < String(beforeUtc));
}

/** Last-5 W/L string for a team, oldest first. */
function recentForm(prior, name, beforeUtc) {
  const own = prior
    .filter((g) => g.home?.name === name || g.away?.name === name)
    .slice(-5);
  if (!own.length) return null;
  return own.map((g) => {
    const isHome = g.home?.name === name;
    const won = g.winner === (isHome ? 'home' : 'away');
    return won ? 'W' : 'L';
  }).join('');
}

/** Season win rate from prior games (the declared proxy when standings are absent). */
function winPct(prior, name) {
  const own = prior.filter((g) => g.home?.name === name || g.away?.name === name);
  if (!own.length) return null;
  const wins = own.filter((g) => g.winner === (g.home?.name === name ? 'home' : 'away')).length;
  return wins / own.length;
}

/** Head-to-head meetings inside the window (home/away wins), like the live path. */
function h2h(prior, homeName, awayName) {
  const meetings = prior.filter(
    (g) => (g.home?.name === homeName && g.away?.name === awayName)
      || (g.home?.name === awayName && g.away?.name === homeName)
  );
  if (!meetings.length) return null;
  let homeWins = 0, awayWins = 0;
  for (const g of meetings) {
    if (g.winner === 'home') g.home?.name === homeName ? homeWins += 1 : awayWins += 1;
    else if (g.winner === 'away') g.away?.name === homeName ? homeWins += 1 : awayWins += 1;
  }
  return { meetings: meetings.length, homeWins, awayWins };
}

/** Days since each team's most recent prior game. */
function restDays(prior, homeName, awayName, startUtc) {
  const last = (name) => {
    const games = prior
      .filter((g) => (g.home?.name === name || g.away?.name === name) && g.startUtc)
      .sort((a, b) => String(b.startUtc).localeCompare(String(a.startUtc)));
    const g = games[0];
    if (!g) return null;
    return Math.max(0, Math.round((Date.parse(startUtc) - Date.parse(g.startUtc)) / 86400000));
  };
  return { home: last(homeName), away: last(awayName) };
}

export function buildPreMatch(game, tape) {
  const prior = priorGames(tape, game.startUtc);
  const homeName = game.home?.name;
  const awayName = game.away?.name;
  const winPctHome = winPct(prior, homeName);
  const winPctAway = winPct(prior, awayName);
  return {
    id: game.id,
    league: game.league,
    leagueName: game.leagueName,
    dateISO: game.dateISO,
    startUtc: game.startUtc,
    phase: game.phase,
    home: { name: homeName, avgPoints: game.home?.avgPoints ?? null, record: winPctHome != null ? { winPct: winPctHome } : null },
    away: { name: awayName, avgPoints: game.away?.avgPoints ?? null, record: winPctAway != null ? { winPct: winPctAway } : null },
    odds: null, // closing prices are not retained by the free feed once final
    h2h: h2h(prior, homeName, awayName),
    rest: restDays(prior, homeName, awayName, game.startUtc),
    homeForm: recentForm(prior, homeName),
    awayForm: recentForm(prior, awayName),
  };
}

export function grade(result, game) {
  const homeScored = game.home?.score;
  const awayScored = game.away?.score;
  if (homeScored == null || awayScored == null) return null;
  const actualWinner = homeScored > awayScored ? game.home.name : awayScored > homeScored ? game.away.name : 'draw';

  const wm = result.markets.match_result;
  const selection = wm.selection;
  const hit = selection != null && actualWinner === selection;

  return {
    id: game.id,
    dateISO: game.dateISO,
    fixture: `${game.away?.name} at ${game.home?.name}`,
    band: wm.band,
    score: wm.score,
    selection,
    actual: actualWinner,
    hit,
    graded: wm.band !== 'SKIP',
    spreadGraded: false,
    spreadReason: result.markets.handicap.reason ?? 'no closing line retained by the free feed',
    totalGraded: false,
    totalReason: result.markets.total.reason ?? 'no closing total retained by the free feed',
  };
}

function band(rows) {
  const out = {};
  for (const b of ['HIGH', 'MEDIUM', 'SKIP']) {
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
  const settled = tape.filter((g) => g.phase === 'results' && g.home?.score != null && g.away?.score != null);

  const standingsDoc = loadJSON(STANDINGS_PATH);
  // Standings change through the season and the tape spans many weeks; the
  // committed snapshot reflects "now", not each game's past. It is therefore
  // NOT used for the walk-forward grade — the engine's win-rate proxy stands
  // in, and this is said out loud rather than silently feeding future ranks
  // into past fixtures.
  const standings = null;

  const rows = [];
  for (const game of settled) {
    const fixture = buildPreMatch(game, tape);
    const result = scoreNbaMatch(fixture, { standings });
    const graded = grade(result, game);
    if (graded) rows.push(graded);
  }

  const bands = band(rows);
  const gradedRows = rows.filter((r) => r.graded);
  const hitRate = gradedRows.length
    ? Math.round((gradedRows.filter((r) => r.hit).length / gradedRows.length) * 1000) / 10
    : null;

  const doc = {
    schema_version: 1,
    sport: 'Basketball',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    tape: TAPE_PATH.replace(/\\/g, '/').split('/').pop(),
    method: 'walk-forward, leak-free: features computed only from games finishing before each fixture',
    standings_note: 'the committed standings snapshot reflects the present and is not applied to past fixtures; win-rate proxy is used and flagged NBA-STANDINGS per game',
    sample: settled.length,
    graded: gradedRows.length,
    ungraded_markets: {
      point_spread: 'closing spread line not retained by the free feed once a game is final (NBA-ATS)',
      game_total: 'pace/defence/totals-trend inputs and closing totals not retained (NBA-PACE, NBA-DEF, NBA-TRENDS)',
    },
    hit_rate_pct: hitRate,
    bands,
    rows,
  };

  writeFileSync(OUT_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `backtest: ${gradedRows.length}/${settled.length} games graded (WIN MATCH only) · ` +
    `hit rate ${hitRate ?? 'n/a'}% · HIGH ${bands.high?.graded ?? 0} graded ${bands.high?.hitRate ?? 'n/a'}% · ` +
    `MEDIUM ${bands.medium?.graded ?? 0} graded ${bands.medium?.hitRate ?? 'n/a'}% · ` +
    `SKIP ${bands.skip?.picks ?? 0}`
  );
  console.log(`wrote ${OUT_PATH}`);
}

if (isDirect) main();
