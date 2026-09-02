#!/usr/bin/env node
/**
 * SportsPred — Formula 1 collector (ESPN public key-less endpoints).
 *
 * Fetches the ESPN F1 scoreboard (current season), standings, per-event core
 * data (competitions, circuit), per-driver race statuses and race statistics,
 * then writes:
 *   data/f1_events.json      schedule + session classifications + circuit facts
 *   data/f1_standings.json   driver/constructor standings + per-race points
 *   data/f1_provenance.json  source/irregularity record
 *
 * HONESTY: every field written comes from a response that was actually
 * received. Fields ESPN does not publish (odds, fastest-lap per race, tyre
 * strategy, overtake counts, upgrade data) are never synthesised here; the
 * engine records them as missing.
 *
 * Usage:
 *   node scripts/collect_f1_espn.mjs                 # current season + 2025/2024 history
 *   node scripts/collect_f1_espn.mjs --history       # full 2024/2025 history rebuild
 *   node scripts/collect_f1_espn.mjs --no-status     # skip per-driver status/stats fetches
 *   node scripts/collect_f1_espn.mjs --dry-run       # print without writing
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseF1Scoreboard, parseStandings, parseCoreEvent, parseCircuit,
  parseCompetitions, parseSession, parseStatus, parseStatistics,
  resultFromRace, gridFromRace,
} from '../engine/f1_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_EVENTS = join(ROOT, 'data', 'f1_events.json');
const OUT_STANDINGS = join(ROOT, 'data', 'f1_standings.json');
const OUT_PROV = join(ROOT, 'data', 'f1_provenance.json');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1';
const CORE = 'https://sports.core.api.espn.com/v2/sports/racing/leagues/f1';
const V2 = 'https://site.api.espn.com/apis/v2/sports/racing/f1';

const TIMEOUT_MS = 25000;
const YEAR = new Date().getUTCFullYear();

async function getJSON(url, { retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Small cache of fetched core resources for the duration of a run. */
class MemCache {
  constructor() { this.m = new Map(); }
  async get(key, fn) {
    if (this.m.has(key)) return this.m.get(key);
    const v = await fn();
    this.m.set(key, v);
    return v;
  }
}

const cache = new MemCache();

const seasonKey = (ev) => `${ev.seasonYear ?? ''}`;

function loadExisting(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

async function fetchSeason(year) {
  const start = `${year}0101`;
  const end = `${year}1231`;
  return parseF1Scoreboard(await getJSON(`${SITE}/scoreboard?dates=${start}-${end}`));
}

async function fetchCoreEvent(eventId) {
  return cache.get(`event:${eventId}`, () => getJSON(`${CORE}/events/${eventId}`));
}

async function fetchCompetitions(eventId) {
  return cache.get(`competitions:${eventId}`, () => getJSON(`${CORE}/events/${eventId}/competitions`));
}

async function fetchCircuit(circuitId) {
  if (!circuitId) return null;
  return cache.get(`circuit:${circuitId}`, () => getJSON(`${CORE}/circuits/${circuitId}`));
}

async function fetchStatus(eventId, compId, athleteId) {
  return cache.get(`status:${eventId}:${compId}:${athleteId}`,
    () => getJSON(`${CORE}/events/${eventId}/competitions/${compId}/competitors/${athleteId}/status`));
}

async function fetchStats(eventId, compId, athleteId) {
  return cache.get(`stats:${eventId}:${compId}:${athleteId}`,
    () => getJSON(`${CORE}/events/${eventId}/competitions/${compId}/competitors/${athleteId}/statistics`));
}

async function buildEvents(scoreboards, { withStatus = true } = {}) {
  const events = [];
  const circuits = {};
  let completedCount = 0;

  const all = [];
  for (const sb of scoreboards) all.push(...(sb.events || []));

  // Process in calendar order; only completed 2026 races get deep status/stats
  // unless --full is passed.
  const currentSeason = YEAR;
  const sorted = all.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  for (const ev of sorted) {
    const coreEvent = await fetchCoreEvent(ev.id);
    const circuitId = coreEvent?.circuitId ?? null;
    const circuitPayload = circuitId ? await fetchCircuit(circuitId) : null;
    const circuit = circuitPayload ? parseCircuit(circuitPayload) : null;
    if (circuitId && circuit && !circuits[circuitId]) circuits[circuitId] = circuit;

    let comps = [];
    try {
      comps = parseCompetitions(await fetchCompetitions(ev.id));
    } catch (e) {
      console.warn(`  competitions unavailable for ${ev.id}: ${e.message}`);
    }
    const raceComp = comps.find((c) => c.type === 'Race');

    const sessions = comps.length ? comps : (ev.sessions || []);
    const raceSession = raceComp || sessions.find((s) => s.type === 'Race') || null;
    const completed = raceSession?.completed === true;

    let result = [];
    let grid = [];
    if (completed && raceSession) {
      result = resultFromRace(raceSession);
      grid = gridFromRace(raceSession);
      completedCount += 1;
      const deep = withStatus && String(ev.seasonYear) === String(currentSeason);
      if (deep && raceComp) {
        for (const row of result) {
          try {
            const st = parseStatus(await fetchStatus(ev.id, raceComp.id, row.athleteId));
            const stats = parseStatistics(await fetchStats(ev.id, raceComp.id, row.athleteId));
            Object.assign(row, {
              dnf: st.retired,
              status: st.displayValue,
              pointsEarned: stats.pointsEarned,
              lapsCompleted: stats.lapsCompleted,
              lapsLed: stats.lapsLed,
              pitsTaken: stats.pitsTaken,
              pole: stats.pole,
              top5: stats.top5,
              top10: stats.top10,
              wins: stats.wins,
              finishTime: stats.finishTime,
              finishTimeMs: stats.finishTimeMs,
            });
          } catch (e) {
            console.warn(`  status/stats unavailable for ${row.name}: ${e.message}`);
          }
        }
      } else if (raceComp) {
        // History seasons: keep grid/order/team only — no status/stats fetches.
      }
    }
    const winner = result.find((r) => r.position === 1) || null;
    const podium = result.filter((r) => r.position >= 1 && r.position <= 3).map((r) => r.athleteId);
    const top10 = result.filter((r) => r.position >= 1 && r.position <= 10).map((r) => r.athleteId);
    const top6 = result.filter((r) => r.position >= 1 && r.position <= 6).map((r) => r.athleteId);

    events.push({
      id: ev.id,
      name: ev.name,
      shortName: ev.shortName,
      abbreviation: coreEvent?.abbreviation ?? null,
      seasonYear: ev.seasonYear,
      startDate: ev.startDate,
      endDate: ev.endDate,
      raceDate: raceSession?.date || ev.raceDate || ev.endDate,
      state: completed ? 'post' : 'pre',
      circuitId,
      circuit: circuit ? {
        fullName: circuit.fullName,
        city: circuit.city,
        country: circuit.country,
        lengthKm: circuit.lengthKm,
        distanceKm: circuit.distanceKm,
        laps: circuit.laps,
        turns: circuit.turns,
        direction: circuit.direction,
        established: circuit.established,
        fastestLapDriverId: circuit.fastestLapDriverId,
        fastestLapTime: circuit.fastestLapTime,
        fastestLapYear: circuit.fastestLapYear,
        diagramHrefs: circuit.diagramHrefs,
      } : null,
      defendingChampionDriverId: coreEvent?.defendingChampionDriverId ?? null,
      defendingChampionTeamId: coreEvent?.defendingChampionTeam ?? null,
      sessions: sessions.map((s) => ({
        type: s.type, label: s.label, date: s.date, completed: s.completed,
        competitors: s.competitors.map((c) => ({
          athleteId: c.athleteId, name: c.name, team: c.team, carNumber: c.carNumber,
          order: c.order, startOrder: c.startOrder, winner: c.winner,
        })),
      })),
      race: {
        date: raceSession?.date || null,
        completed,
        winner: winner ? { athleteId: winner.athleteId, name: winner.name, team: winner.team } : null,
        podium,
        top6,
        top10,
        grid,
        result,
      },
      sources: {
        espnScoreboard: `${SITE}/scoreboard?dates=${String(ev.startDate).slice(0, 10).replace(/-/g, '')}`,
        espnEvent: `https://www.espn.com/f1/race/_/id/${ev.id}`,
        espnCircuit: circuitId ? `https://www.espn.com/f1/circuit/_/id/${ev.id}` : null,
      },
    });
    console.log(`  ${ev.name} (${ev.seasonYear}): ${completed ? 'completed' : 'upcoming'} — ${result.length} classified`);
  }

  return {
    schema_version: 1,
    sport: 'Formula 1',
    season: YEAR,
    fetched_at_utc: new Date().toISOString(),
    source: {
      name: 'ESPN Formula 1 public API (key-less)',
      endpoints: [
        `${SITE}/scoreboard?dates=YYYYMMDD-YYYYMMDD`,
        `${V2}/standings`,
        `${CORE}/events/{eventId}`,
        `${CORE}/events/{eventId}/competitions`,
        `${CORE}/events/{eventId}/competitions/{compId}/competitors/{athleteId}/status`,
        `${CORE}/events/{eventId}/competitions/{compId}/competitors/{athleteId}/statistics`,
        `${CORE}/circuits/{circuitId}`,
      ],
      fetched_events: events.length,
      completed_events: completedCount,
    },
    circuits,
    events,
  };
}

async function buildStandings() {
  const payload = await getJSON(`${V2}/standings`);
  return {
    schema_version: 1,
    sport: 'Formula 1',
    fetched_at_utc: new Date().toISOString(),
    source: { url: `${V2}/standings` },
    ...parseStandings(payload),
  };
}

function writeOut(path, doc) {
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path}`);
}

async function main() {
  const opts = {
    history: process.argv.includes('--history'),
    noStatus: process.argv.includes('--no-status'),
    dryRun: process.argv.includes('--dry-run'),
  };

  console.log('Collecting ESPN F1…');
  const scoreboards = [];
  const current = await fetchSeason(YEAR);
  scoreboards.push(current);
  const seasonYear = current.seasonYear || YEAR;
  console.log(`  ${seasonYear} calendar: ${current.seasonCalendar.length} events`);

  const historyYears = opts.history ? [seasonYear - 1, seasonYear - 2] : [seasonYear - 1];
  for (const y of historyYears) {
    try {
      const sb = await fetchSeason(y);
      scoreboards.push(sb);
      console.log(`  ${y} calendar: ${sb.seasonCalendar.length} events`);
    } catch (e) {
      console.warn(`  ${y} season unavailable: ${e.message}`);
    }
  }

  const eventsDoc = await buildEvents(scoreboards, { withStatus: !opts.noStatus });
  const standingsDoc = await buildStandings();

  if (opts.dryRun) {
    console.log(`Dry run: ${eventsDoc.events.length} events, ${standingsDoc.drivers.length} drivers, ${standingsDoc.constructors.length} constructors`);
    const next = eventsDoc.events.find((e) => e.state === 'pre');
    console.log(`Next event: ${next?.name} on ${next?.startDate}`);
    return;
  }

  writeOut(OUT_EVENTS, eventsDoc);
  writeOut(OUT_STANDINGS, standingsDoc);
  writeOut(OUT_PROV, {
    schema_version: 1,
    sport: 'Formula 1',
    fetched_at_utc: new Date().toISOString(),
    environment: {
      collector: 'scripts/collect_f1_espn.mjs',
      node: process.version,
    },
    official_sources: [
      {
        id: 'ESPN-F1',
        name: 'ESPN Formula 1 public JSON endpoints',
        urls: [
          `${SITE}/scoreboard?dates=YYYYMMDD-YYYYMMDD`,
          `${V2}/standings`,
          `${CORE}/events/{eventId}`,
          `${CORE}/circuits/{circuitId}`,
        ],
        verified: '2026-09-02 via live hosted fetch',
        note: 'Key-less, CORS-enabled, undocumented and unversioned (same status as the tennis endpoints).',
        fields_provided: ['calendar', 'session classifications', 'finishing order', 'grid order', 'team/car', 'circuit facts', 'driver/constructor standings', 'per-race points', 'race stats (pits, laps, pole, place)'],
      },
      {
        id: 'OLBG-MOTOR',
        name: 'OLBG Motor Racing tips pages',
        url: 'https://www.olbg.com/betting-tips/Motor_Racing/14',
        verified: '2026-09-02 via hosted page fetch',
        note: 'Tipster consensus + factual track history; no structured odds in server HTML.',
        fields_provided: ['race markets (Win Race, Fastest Qualifier, Win Tournament)', 'consensus counts', 'past winners', 'fastest lap lists'],
      },
      {
        id: 'OPEN-METEO',
        name: 'Open-Meteo forecast API (key-less)',
        url: 'https://api.open-meteo.com/v1/forecast',
        verified: '2026-09-02',
        note: 'Free, no key, documented; used for the permitted weather reference only.',
        fields_provided: ['daily precipitation probability', 'temperature', 'wind'],
      },
    ],
    irregularities: [
      {
        id: 'IR-F1-01',
        title: 'No structured bookmaker odds on any free key-less feed',
        detail: 'ESPN F1 publishes no odds; OLBG server HTML contains consensus tip counts but no prices (prices are injected client-side). The Odds and Market Value component is therefore always unscored.',
        mitigation: 'Component recorded missing; market band capped and never promoted to HIGH on partial data.',
      },
      {
        id: 'IR-F1-02',
        title: 'No per-race fastest-lap data from ESPN',
        detail: 'ESPN competitor statistics expose place/pole/laps/pits but not the fastest lap of a race. ESPN circuit endpoint publishes the current lap record only.',
        mitigation: 'Fastest-lap evidence comes from OLBG event-page year lists (secondary source) and, where identical, cross-checked against the ESPN circuit record (2025 Monza 1:20.901 = Lando Norris — verified on both).',
      },
      {
        id: 'IR-F1-03',
        title: 'DNF classification requires per-driver status fetches',
        detail: 'The scoreboard payload has competitor statuses as $refs; DNF is only known when the status endpoint is fetched (STATUS_RETIRED verified). History seasons are stored without status data to bound request volume.',
        mitigation: 'last-5 DNF counts are only as complete as the statuses fetched; partial samples are flagged in missing[] and scored conservatively.',
      },
      {
        id: 'IR-F1-04',
        title: 'Tyre strategy and pit-lap timing not published',
        detail: 'Only pitsTaken counts exist; whether a driver pitted in the final five laps is unknown on any free feed.',
        mitigation: 'Fastest-lap tyre strategy component always missing → market SKIPped per Step 3.',
      },
      {
        id: 'IR-F1-05',
        title: 'No overtake counts or rankings',
        detail: 'No free structured overtake statistic verified.',
        mitigation: 'Overtaking ability and traffic-skill components scored as missing.',
      },
      {
        id: 'IR-F1-06',
        title: 'Safety-car frequency and overtaking difficulty are not published',
        detail: 'The prompt names circuit classes; data for frequency/difficulty is not available on free feeds.',
        mitigation: 'Circuit classifications from the prompt are applied only as structural context; multipliers that need numeric frequency are missing.',
      },
      {
        id: 'IR-F1-07',
        title: 'Upgrade packages / lap-time deltas not published',
        detail: 'No source for floor/wing/PU upgrades or consistent lap-time improvement.',
        mitigation: 'Car upgrade trajectory component scored as missing.',
      },
      {
        id: 'IR-F1-08',
        title: 'Weather is forward-looking and volatile',
        detail: 'Open-Meteo forecasts are used with source URL; forecasts change. >30% rain flags predictions as weather-dependent.',
        mitigation: 'Weather influence surfaces only as a permitted external data point and a weather-dependence flag.',
      },
    ],
  });
}

main().catch((e) => {
  console.error('F1 collection failed:', e);
  process.exit(1);
});
