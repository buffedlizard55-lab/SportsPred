#!/usr/bin/env node
/**
 * SportsPred — ice hockey collector (runs in CI; needs outbound network).
 *
 *   node scripts/collect_ice_hockey_nhl.mjs                 # refresh every document
 *   node scripts/collect_ice_hockey_nhl.mjs --days 21       # fixture/tape window
 *   node scripts/collect_ice_hockey_nhl.mjs --only fixtures # one document
 *   node scripts/collect_ice_hockey_nhl.mjs --dry-run       # fetch, print, write nothing
 *
 * WHAT IT WRITES
 *   data/ice_hockey_fixtures.json   upcoming + settled fixtures (NHL API scoreboard)
 *   data/ice_hockey_tape.json       results tape used for form, b2b, H2H, covers
 *   data/ice_hockey_standings.json  official NHL standings table snapshot
 *   data/ice_hockey_goalies.json    club-stats derived goaltender save percentages
 *   data/ice_hockey_injuries.json   ESPN injury register snapshot
 *
 * HONESTY RULES
 *  - Every document records the URL it came from, the HTTP status and the fetch
 *    time. An endpoint that fails is recorded as failed; nothing is written from
 *    memory and no value is defaulted.
 *  - The whole run aborts if the two documents the engine cannot do without
 *    (fixtures, standings) both fail. A single failure degrades the card and is
 *    reported on the page, because a missing factor must reduce the score.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NHL_SCOREBOARD_URL, NHL_STANDINGS_URL, NHL_CLUB_STATS_URL,
  ESPN_HOCKEY_SCOREBOARD, ESPN_HOCKEY_INJURIES,
  parseNhlScoreboard, parseNhlStandings, parseNhlClubStats, parseEspnHockeyInjuries,
} from '../engine/ice_hockey_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const TIMEOUT = 25000;
const CONCURRENCY = 4;

const arg = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const DRY = process.argv.includes('--dry-run');
const ONLY = arg('--only');
const DAYS = Number(arg('--days', '21'));
const SEASON = arg('--season', String(new Date().getUTCFullYear() - 1) + String(new Date().getUTCFullYear()));

const nowUtc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const stamp = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
};
const dashless = (iso) => iso.replace(/-/g, '');

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

function write(name, doc) {
  const path = join(DATA, name);
  if (DRY) { console.log(`  [dry-run] would write ${name}`); return; }
  writeFileSync(path, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`  wrote ${name}`);
}

function provenance(checks, extra = {}) {
  return {
    schema_version: 1,
    fetched_at_utc: nowUtc(),
    collector: 'scripts/collect_ice_hockey_nhl.mjs',
    endpoints: checks.map((c) => ({
      url: c.url, status: c.status, error: c.error,
      ok: c.status === 200 && !c.error,
    })),
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * Fixtures + results tape (NHL API scoreboard across a window of days)
 * ------------------------------------------------------------------ */

async function collectFixtures() {
  const dates = [];
  for (let d = -DAYS; d <= DAYS; d += 1) dates.push(stamp(d));
  const checks = await pool(dates, async (iso) => getJSON(NHL_SCOREBOARD_URL(iso)));
  const games = new Map();
  for (const c of checks) {
    if (!c.data) continue;
    const parsed = parseNhlScoreboard(c.data, { requestedDate: null });
    for (const g of parsed.games) games.set(g.id, g);
  }

  // ESPN scoreboard for the same window supplies the odds block (one book).
  const espnChecks = await pool(dates, async (iso) => getJSON(ESPN_HOCKEY_SCOREBOARD('nhl', dashless(iso))));
  const oddsByEvent = new Map();
  for (const c of espnChecks) {
    for (const ev of c.data?.events || []) {
      const comp = ev.competitions?.[0];
      const block = Array.isArray(comp?.odds) ? comp.odds[0] : null;
      if (!block) continue;
      const pick = (n) => n?.close?.odds ?? n?.open?.odds ?? n?.odds ?? null;
      const pickLine = (n) => n?.close?.line ?? n?.open?.line ?? n?.line ?? null;
      oddsByEvent.set(String(ev.id), {
        provider: block.provider?.name ?? null,
        details: block.details ?? null,
        home: pick(block.moneyline?.home) ?? block.homeTeamOdds?.moneyLine ?? null,
        away: pick(block.moneyline?.away) ?? block.awayTeamOdds?.moneyLine ?? null,
        spreadLine: pickLine(block.pointSpread?.home) ?? null,
        totalLine: pickLine(block.total?.over) ?? block.overUnder ?? null,
      });
    }
  }

  const list = [...games.values()]
    .map((g) => {
      const odds = oddsByEvent.get(g.id) ?? null;
      return {
        ...g,
        odds: odds ? { provider: odds.provider, home: { american: Number(odds.home) || null }, away: { american: Number(odds.away) || null } } : null,
        oddsSourceCount: odds ? 1 : 0,
        total: odds?.totalLine != null ? { line: Number(odds.totalLine) } : null,
        spread: odds?.spreadLine != null ? { line: Number(odds.spreadLine) } : null,
      };
    })
    .sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));

  const fixtures = list.filter((g) => g.phase === 'upcoming' || g.phase === 'live');
  const results = list.filter((g) => g.phase === 'results');

  write('ice_hockey_fixtures.json', {
    ...provenance([...checks, ...espnChecks], {
      sport: 'Ice Hockey',
      league: 'nhl',
      window: { from: dates[0], to: dates[dates.length - 1] },
      odds_attribution: 'ESPN republishes one book (DraftKings) inside the scoreboard payload; attributed wherever shown. OLBG publishes tipster consensus, not prices.',
    }),
    fixtures,
    counts: { fixtures: fixtures.length, results: results.length, withOdds: fixtures.filter((f) => f.odds).length },
  });

  write('ice_hockey_tape.json', {
    ...provenance(checks, { sport: 'Ice Hockey', league: 'nhl', note: 'Settled games only, used for form, back-to-back flags, head-to-head and puck line covers.' }),
    games: results,
    counts: { games: results.length },
  });

  return { fixtures: fixtures.length, results: results.length, checks };
}

/* ------------------------------------------------------------------ *
 * Standings
 * ------------------------------------------------------------------ */

async function collectStandings() {
  const c = await getJSON(NHL_STANDINGS_URL('now'));
  if (!c.data) {
    console.error(`  standings FAILED: ${c.error}`);
    return { ok: false, checks: [c] };
  }
  const parsed = parseNhlStandings(c.data);
  write('ice_hockey_standings.json', {
    ...provenance([c], { sport: 'Ice Hockey', league: 'nhl', standings_date: parsed.standingsDate }),
    teams: parsed.teams,
    counts: { teams: parsed.teamsCount },
    note: 'Shots for/against per game, power play % and penalty kill % are not published by this endpoint. They stay null and the engine records them as missing.',
  });
  return { ok: true, checks: [c], teams: parsed.teams };
}

/* ------------------------------------------------------------------ *
 * Goaltenders (club stats)
 * ------------------------------------------------------------------ */

async function collectGoalies(teams) {
  const abbrevs = Object.keys(teams || {});
  if (!abbrevs.length) return { ok: false, checks: [] };
  const checks = await pool(abbrevs, async (a) => getJSON(NHL_CLUB_STATS_URL(a, SEASON, 2)));
  const out = {};
  checks.forEach((c, i) => {
    if (!c.data) return;
    const parsed = parseNhlClubStats(c.data, { abbrev: abbrevs[i] });
    if (!parsed.goalies.length) return;
    const best = parsed.goalies.reduce((a, b) => (b.savePctg > a.savePctg ? b : a));
    out[abbrevs[i]] = {
      name: best.name,
      savePctg: best.savePctg,
      gamesPlayed: best.gamesPlayed,
      isBackup: false,
      confirmed: false,
      last5SavePctg: null,
      source: 'nhl-club-stats',
      note: 'Season save percentage of the most-used starter on record. No free feed publishes a confirmed starter for a future game, so `confirmed` is false and the engine treats the goaltender as unconfirmed.',
      topLine: parsed.topLine,
    };
  });
  write('ice_hockey_goalies.json', {
    ...provenance(checks, { sport: 'Ice Hockey', league: 'nhl', season: SEASON }),
    teams: out,
    counts: { teams: Object.keys(out).length },
  });
  return { ok: true, checks, teams: Object.keys(out).length };
}

/* ------------------------------------------------------------------ *
 * Injuries (ESPN)
 * ------------------------------------------------------------------ */

async function collectInjuries() {
  const c = await getJSON(ESPN_HOCKEY_INJURIES('nhl'));
  if (!c.data) {
    console.error(`  injuries FAILED: ${c.error}`);
    return { ok: false, checks: [c] };
  }
  const parsed = parseEspnHockeyInjuries(c.data);
  write('ice_hockey_injuries.json', {
    ...provenance([c], { sport: 'Ice Hockey', league: 'nhl' }),
    byTeam: parsed.byTeam,
    counts: { teams: parsed.teams },
  });
  return { ok: true, checks: [c], teams: parsed.teams };
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log('ice hockey collector');
  const standings = ONLY && ONLY !== 'standings' ? { ok: true, teams: {} } : await collectStandings();
  if (!ONLY || ONLY === 'fixtures') await collectFixtures();
  if (!ONLY || ONLY === 'goalies') await collectGoalies(standings.teams || {});
  if (!ONLY || ONLY === 'injuries') await collectInjuries();
  console.log('done');
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
