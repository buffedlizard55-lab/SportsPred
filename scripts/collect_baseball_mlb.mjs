#!/usr/bin/env node
/**
 * SportsPred — baseball collector (runs in CI; needs outbound network).
 *
 *   node scripts/collect_baseball_mlb.mjs                 # refresh every document
 *   node scripts/collect_baseball_mlb.mjs --days 21       # fixture/tape window
 *   node scripts/collect_baseball_mlb.mjs --only fixtures # one document
 *   node scripts/collect_baseball_mlb.mjs --dry-run       # fetch, print, write nothing
 *
 * WHAT IT WRITES
 *   data/baseball_fixtures.json   upcoming + settled fixtures (MLB StatsAPI + ESPN)
 *   data/baseball_tape.json       results tape used for form, run diff, H2H, margins
 *   data/baseball_standings.json  official MLB standings snapshot
 *   data/baseball_team_stats.json hitting + pitching season team stats
 *   data/baseball_pitchers.json   probable-starter profiles (season + last 4 starts)
 *
 * HONESTY RULES
 *  - Every document records the URL it came from, the HTTP status and the fetch
 *    time. An endpoint that fails is recorded as failed; nothing is written from
 *    memory and no value is defaulted.
 *  - No odds are collected: no key-less multi-book baseball price feed exists.
 *    The `odds` field on every fixture is null, and `oddsSourceCount` is 0.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MLB_SCHEDULE_URL, MLB_STANDINGS_URL, MLB_TEAM_STATS_URL,
  MLB_PERSON_SEASON_URL, MLB_PERSON_GAMELOG_URL, ESPN_MLB_SCOREBOARD,
  parseMlbSchedule, parseMlbStandings, parseMlbTeamStats,
  parseMlbPitcherSeason, parseMlbPitcherGameLog, parseEspnMlbScoreboard,
} from '../engine/baseball_espn.js';

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
const SEASON = arg('--season', String(new Date().getUTCFullYear()));

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
    collector: 'scripts/collect_baseball_mlb.mjs',
    endpoints: checks.map((c) => ({
      url: c.url, status: c.status, error: c.error,
      ok: c.status === 200 && !c.error,
    })),
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * Fixtures + results tape (MLB StatsAPI schedule across a window of days)
 * ------------------------------------------------------------------ */

async function collectFixtures() {
  const dates = [];
  for (let d = -DAYS; d <= DAYS; d += 1) dates.push(stamp(d));
  const checks = await pool(dates, async (iso) => getJSON(MLB_SCHEDULE_URL(iso)));
  const games = new Map();
  for (const c of checks) {
    if (!c.data) continue;
    const parsed = parseMlbSchedule(c.data);
    for (const g of parsed.games) games.set(g.id, g);
  }

  // ESPN scoreboard for the same window supplies venue/weather context and a
  // probable-starter cross-check. It is enrichment only: a failed ESPN fetch
  // leaves those fields null and the engine records them as missing.
  const espnChecks = await pool(dates, async (iso) => getJSON(ESPN_MLB_SCOREBOARD(dashless(iso))));
  const espnByKey = new Map();
  for (const c of espnChecks) {
    for (const row of parseEspnMlbScoreboard(c.data || {})) {
      const key = `${row.dateISO}:${row.homeAbbrev}:${row.awayAbbrev}`;
      if (!espnByKey.has(key)) espnByKey.set(key, row);
    }
  }

  const list = [...games.values()]
    .map((g) => {
      const key = `${g.dateISO}:${g.home?.abbrev}:${g.away?.abbrev}`;
      const espn = espnByKey.get(key) ?? null;
      return {
        ...g,
        venueIndoor: espn?.venueIndoor ?? null,
        espn: espn ? {
          venueIndoor: espn.venueIndoor,
          weather: espn.weather ?? null,
          temperature: espn.temperature ?? null,
          home: { starter: espn.home?.starter ?? null, records: espn.home?.records ?? null },
          away: { starter: espn.away?.starter ?? null, records: espn.away?.records ?? null },
        } : null,
        odds: null,
        oddsSourceCount: 0,
      };
    })
    .sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));

  const fixtures = list.filter((g) => g.phase === 'upcoming' || g.phase === 'live');
  const results = list.filter((g) => g.phase === 'results');

  write('baseball_fixtures.json', {
    ...provenance([...checks, ...espnChecks], {
      sport: 'Baseball',
      league: 'mlb',
      season: SEASON,
      window: { from: dates[0], to: dates[dates.length - 1] },
      odds_attribution: 'No key-less multi-book baseball price feed exists. The odds field is null and the engine records the odds factor as missing.',
    }),
    fixtures,
    counts: { fixtures: fixtures.length, results: results.length, withOdds: 0 },
  });

  write('baseball_tape.json', {
    ...provenance(checks, { sport: 'Baseball', league: 'mlb', note: 'Settled games only, used for form, run differential, head-to-head and winning margins.' }),
    games: results,
    counts: { games: results.length },
  });

  return { fixtures: fixtures.length, results: results.length, fixtures_list: fixtures, checks };
}

/* ------------------------------------------------------------------ *
 * Standings
 * ------------------------------------------------------------------ */

async function collectStandings() {
  const c = await getJSON(MLB_STANDINGS_URL(SEASON));
  if (!c.data) {
    console.error(`  standings FAILED: ${c.error}`);
    return { ok: false, checks: [c] };
  }
  const parsed = parseMlbStandings(c.data);
  write('baseball_standings.json', {
    ...provenance([c], { sport: 'Baseball', league: 'mlb', season: SEASON }),
    teams: parsed.teams,
    counts: { teams: parsed.count },
    note: 'Official MLB standings: W-L, run differential, home/away splits, last-ten, left/right splits. Bullpen ERA is not published here; it stays null and the engine records it as missing.',
  });
  return { ok: true, checks: [c], teams: parsed.teams };
}

/* ------------------------------------------------------------------ *
 * Team stats (hitting + pitching)
 * ------------------------------------------------------------------ */

async function collectTeamStats() {
  const hit = await getJSON(MLB_TEAM_STATS_URL('hitting', SEASON));
  const pitch = await getJSON(MLB_TEAM_STATS_URL('pitching', SEASON));
  const teams = {};
  if (hit.data) Object.assign(teams, parseMlbTeamStats(hit.data, 'hitting').teams);
  if (pitch.data) Object.assign(teams, parseMlbTeamStats(pitch.data, 'pitching').teams);
  write('baseball_team_stats.json', {
    ...provenance([hit, pitch], { sport: 'Baseball', league: 'mlb', season: SEASON }),
    teams,
    counts: { teams: Object.keys(teams).length },
    note: 'Season batting (avg/obp/slg, runs) and pitching (era/whip, strikeouts per 9, runs allowed) per team. Bullpen-only splits are not published by this endpoint.',
  });
  return { ok: teams.length > 0, checks: [hit, pitch], teams };
}

/* ------------------------------------------------------------------ *
 * Pitchers (probable starters -> season + last 4 starts)
 * ------------------------------------------------------------------ */

async function collectPitchers(fixtures) {
  const ids = new Map();
  for (const f of fixtures) {
    for (const side of [f.home, f.away]) {
      const pp = side?.probablePitcher ?? null;
      if (pp?.id != null && !ids.has(pp.id)) ids.set(pp.id, pp.name);
    }
  }
  const pitcherIds = [...ids.keys()];
  const profiles = {};
  if (pitcherIds.length) {
    const checks = await pool(pitcherIds, async (id) => {
      const [season, gameLog] = await Promise.all([
        getJSON(MLB_PERSON_SEASON_URL(id, SEASON)),
        getJSON(MLB_PERSON_GAMELOG_URL(id, SEASON)),
      ]);
      const s = season.data ? parseMlbPitcherSeason(season.data) : null;
      const gl = gameLog.data ? parseMlbPitcherGameLog(gameLog.data) : null;
      return {
        id,
        name: ids.get(id),
        season: s,
        ...gl,
        season_status: season.status,
        gamelog_status: gameLog.status,
        endpoints: [season, gameLog],
      };
    });
    for (const p of checks) {
      profiles[p.id] = {
        id: p.id,
        name: p.name,
        era: p.season?.era ?? null,
        whip: p.season?.whip ?? null,
        strikeoutsPer9: p.season?.strikeoutsPer9Inn ?? null,
        wins: p.season?.wins ?? null,
        losses: p.season?.losses ?? null,
        qualityStartsLast4: p.qualityStartsLast4 ?? null,
        qualityStartsLast3: p.qualityStartsLast3 ?? null,
        avgInningsPerStart: p.last4AvgIp ?? null,
        last4: p.last4 ?? [],
        startsCount: p.startsCount ?? null,
        source: 'mlb-person-gameLog',
      };
    }
    write('baseball_pitchers.json', {
      ...provenance(checks.flatMap((p) => p.endpoints), { sport: 'Baseball', league: 'mlb', season: SEASON }),
      pitchers: profiles,
      counts: { pitchers: Object.keys(profiles).length },
      note: 'Probable-starter profiles from the official MLB StatsAPI person game log and season stats. A starter is recorded as "confirmed" only when the MLB schedule names a probable pitcher.',
    });
    return { ok: true, checks: checks.flatMap((p) => p.endpoints), pitchers: Object.keys(profiles).length };
  }
  write('baseball_pitchers.json', {
    ...provenance([], { sport: 'Baseball', league: 'mlb', season: SEASON }),
    pitchers: profiles,
    counts: { pitchers: 0 },
    note: 'No probable pitchers were named for the upcoming window.',
  });
  return { ok: true, checks: [], pitchers: 0 };
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log('baseball collector');
  const standings = ONLY && ONLY !== 'standings' ? { ok: true, teams: {} } : await collectStandings();
  if (!ONLY || ONLY === 'teamstats') await collectTeamStats();
  let fixturesList = [];
  if (!ONLY || ONLY === 'fixtures') {
    const r = await collectFixtures();
    fixturesList = r.fixtures_list || [];
  }
  if (!ONLY || ONLY === 'pitchers') await collectPitchers(fixturesList);
  console.log('done');
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
