#!/usr/bin/env node
/**
 * SportsPred — basketball collector (runs in CI; needs outbound network).
 *
 *   node scripts/collect_basketball_espn.mjs                 # refresh all documents
 *   node scripts/collect_basketball_espn.mjs --days 120      # results-tape window
 *   node scripts/collect_basketball_espn.mjs --only standings # one document
 *   node scripts/collect_basketball_espn.mjs --dry-run        # fetch, print, write nothing
 *
 * WHAT IT WRITES
 *   data/basketball_standings.json  NBA + WNBA conference standings (rank,
 *                                   win%, PPG, opponent PPG) — the source of
 *                                   the STEP 2 "top-3 conference" bucket.
 *   data/basketball_tape.json       completed NBA + WNBA games over the window
 *                                   — the source of form / H2H / rest for both
 *                                   the live card and the walk-forward backtest.
 *
 * HONESTY RULES
 *  - Every document records the URL it came from, the HTTP status and the fetch
 *    time. A failed endpoint is recorded as failed; nothing is written from
 *    memory and no value is defaulted.
 *  - Closing odds are NOT retained by the free scoreboard feed once a game is
 *    final, so the tape carries no historical price. The backtest grades the
 *    no-odds signal and says so rather than inventing a price.
 *  - The standings `playoffSeed` (ESPN BPI projection) is intentionally
 *    ignored; conference rank is the 1-based position in the ordered table.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScoreboard } from '../engine/espn_universal.js';
import {
  ESPN_BASKETBALL_STANDINGS,
  ESPN_BASKETBALL_SCOREBOARD,
  parseEspnBasketballStandings,
} from '../engine/basketball_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const isDirect = process.argv[1] === fileURLToPath(import.meta.url);
const TIMEOUT = 25000;
const CONCURRENCY = 3;

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const DRY = process.argv.includes('--dry-run');
const ONLY = arg('--only');
const DAYS = Number(arg('--days', '120'));

const nowUtc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const dashless = (iso) => iso.replace(/-/g, '');
const isoDaysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
};

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { url, status: res.status, data: null, error: `HTTP ${res.status}` };
    return { url, status: res.status, data: await res.json(), error: null };
  } catch (e) {
    return { url, status: 0, data: null, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function pool(items, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(new Array(Math.min(CONCURRENCY, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i; i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }));
  return out;
}

const LEAGUES = [
  { key: 'nba', name: 'NBA', slug: 'nba' },
  { key: 'wnba', name: 'WNBA', slug: 'wnba' },
];

/* ------------------------------------------------------------------ *
 * standings
 * ------------------------------------------------------------------ */
async function collectStandings() {
  const endpoints = [];
  const conferences = {};
  for (const lg of LEAGUES) {
    const url = ESPN_BASKETBALL_STANDINGS[lg.key];
    const res = await getJSON(url);
    endpoints.push({ url, status: res.status, error: res.error });
    if (res.data) {
      const parsed = parseEspnBasketballStandings(res.data);
      for (const [conf, doc] of Object.entries(parsed)) {
        // namespaced so NBA and WNBA conference tables never collide
        const key = `${lg.key}:${conf}`;
        conferences[key] = { league: lg.key, leagueName: lg.name, ...doc };
      }
    }
  }
  const ok = endpoints.filter((e) => !e.error).length;
  return {
    schema_version: 1,
    sport: 'Basketball',
    fetched_at_utc: nowUtc(),
    method: 'ESPN standings API — conference order, win%, PPG and opponent PPG (rank = table position, not the BPI playoffSeed)',
    source: { name: 'ESPN standings API', url: ESPN_BASKETBALL_STANDINGS.nba },
    endpoints,
    conferences,
    counts: { conferences: Object.keys(conferences).length, teams: Object.values(conferences).reduce((a, c) => a + (c.teams?.length || 0), 0), endpoints_ok: ok },
  };
}

/* ------------------------------------------------------------------ *
 * results tape
 * ------------------------------------------------------------------ */
async function collectTape() {
  const endpoints = [];
  const games = [];
  const window = { from: isoDaysAgo(DAYS), to: isoDaysAgo(0) };
  for (const lg of LEAGUES) {
    const url = `${ESPN_BASKETBALL_SCOREBOARD(lg.slug)}?dates=${dashless(window.from)}-${dashless(window.to)}`;
    const res = await getJSON(url);
    endpoints.push({ url, status: res.status, error: res.error });
    if (!res.data) continue;
    const parsed = parseScoreboard(res.data, { sportKey: 'basketball', leagueSlug: lg.slug, leagueName: lg.name });
    for (const m of parsed.matches) {
      if (m.phase === 'results') {
        games.push({ league: lg.key, ...m, odds: null, oddsNote: 'closing odds are not retained by the free feed once a game is final' });
      }
    }
  }
  games.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
  const ok = endpoints.filter((e) => !e.error).length;
  return {
    schema_version: 1,
    sport: 'Basketball',
    fetched_at_utc: nowUtc(),
    method: 'ESPN scoreboard range queries; only completed (results) games are retained, with scores and winner flags',
    source: { name: 'ESPN scoreboard API', url: ESPN_BASKETBALL_SCOREBOARD('nba') },
    endpoints,
    window,
    games,
    counts: { games: games.length, endpoints_ok: ok },
  };
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */
async function main() {
  const want = (d) => !ONLY || ONLY === d;

  if (want('standings')) {
    const doc = await collectStandings();
    console.log(`standings: ${doc.counts.teams} teams across ${doc.counts.conferences} conferences (${doc.counts.endpoints_ok}/${LEAGUES.length} endpoints ok)`);
    if (!DRY) writeFileSync(join(DATA, 'basketball_standings.json'), `${JSON.stringify(doc, null, 2)}\n`);
  }

  if (want('tape')) {
    const doc = await collectTape();
    console.log(`tape: ${doc.counts.games} completed games over ${doc.window.from}..${doc.window.to} (${doc.counts.endpoints_ok}/${LEAGUES.length} endpoints ok)`);
    if (!DRY) writeFileSync(join(DATA, 'basketball_tape.json'), `${JSON.stringify(doc, null, 2)}\n`);
  }
}

if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
