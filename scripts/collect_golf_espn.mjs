#!/usr/bin/env node
/**
 * SportsPred — Golf collector (ESPN public key-less endpoints, OWGR public
 * JSON, PGA TOUR strokes-gained pages).
 *
 * Writes:
 *   data/golf_events.json      upcoming + recent events with full fields, tee
 *                              times and course facts (PGA TOUR, DP World Tour)
 *   data/golf_results.json     compact results tape for the last two seasons of
 *                              each tour (position, result code, to-par, R1-R4)
 *   data/golf_rankings.json    Official World Golf Ranking (top 1000)
 *   data/golf_stats.json       ESPN season statistics by athlete (PGA TOUR) and
 *                              PGA TOUR strokes-gained tables when parseable
 *   data/golf_provenance.json  sources + irregularities register
 *
 * HONESTY: every field written was read from a response that was actually
 * received. A failed fetch leaves the previously committed document untouched
 * for that section; nothing is back-filled or estimated. Fields no free source
 * publishes (odds, course grass type, links classification, DP World Tour
 * strokes gained) are never synthesised; the engine records them as missing.
 *
 * Usage:
 *   node scripts/collect_golf_espn.mjs                # incremental (recommended)
 *   node scripts/collect_golf_espn.mjs --history      # rebuild the two-season tape
 *   node scripts/collect_golf_espn.mjs --tours pga    # limit to one tour
 *   node scripts/collect_golf_espn.mjs --dry-run      # print, do not write
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GOLF_TOURS, leaderboardUrl, scoreboardUrl, coreEventUrl,
  parseLeaderboard, parseGolfScoreboard, parseCoreEvent, parseByAthleteStats, parseOwgr,
  parsePgaTourStatPage, PGATOUR_STAT_IDS, toResultRow, RESULT_ROW, leaderboardToEvent,
} from '../engine/golf_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SPORTSPRED_DATA_DIR || join(ROOT, 'data');
const OUT_EVENTS = join(DATA, 'golf_events.json');
const OUT_RESULTS = join(DATA, 'golf_results.json');
const OUT_RANKINGS = join(DATA, 'golf_rankings.json');
const OUT_STATS = join(DATA, 'golf_stats.json');
const OUT_PROV = join(DATA, 'golf_provenance.json');

const OWGR_URL = 'https://apiweb.owgr.com/api/owgr/rankings/getRankings?pageSize=1000&pageNumber=1&countryId=0&sortString=Rank+ASC';
const OWGR_PAGE = 'https://www.owgr.com/current-world-ranking';
const ESPN_STATS = (season, page) => `https://site.web.api.espn.com/apis/common/v3/sports/golf/pga/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=50&season=${season}&page=${page}`;
const PGATOUR_STAT = (id) => `https://www.pgatour.com/stats/detail/${id}`;

const TIMEOUT_MS = 25000;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const HISTORY = args.includes('--history');
const toursArg = args.includes('--tours') ? args[args.indexOf('--tours') + 1] : null;
const TOURS = (toursArg ? toursArg.split(',') : ['pga', 'eur']).filter((t) => GOLF_TOURS[t]);
const UPCOMING_DAYS = 21;
const RECENT_DAYS = 10;

const nowISO = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const warnings = [];

async function getText(url, { retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SportsPredCollector/1.0; +https://github.com/buffedlizard55-lab/SportsPred)', ...headers } });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

async function getJSON(url, opts) {
  return JSON.parse(await getText(url, opts));
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function loadExisting(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function write(path, doc) {
  if (DRY) { console.log(`[dry-run] would write ${path}`); return; }
  writeFileSync(path, `${JSON.stringify(doc)}\n`, 'utf8');
  console.log(`Wrote ${path}`);
}

function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * seasons + calendars
 * ------------------------------------------------------------------ */

async function fetchCalendar(tour, yyyymmdd) {
  const payload = await getJSON(scoreboardUrl(tour, yyyymmdd));
  return parseGolfScoreboard(payload, { tour });
}

/** Calendar entries for the current season and the previous one(s). */
async function fetchCalendars(tour) {
  const cur = await fetchCalendar(tour, today().replace(/-/g, ''));
  const out = [{ season: cur.season, calendar: cur.calendar, url: scoreboardUrl(tour, today().replace(/-/g, '')) }];
  // Previous season: ask for a date a year before the current season start.
  const seasonStart = String(cur.season?.startDate || `${new Date().getUTCFullYear()}-01-01`).slice(0, 10);
  const prevDate = addDays(seasonStart, -200).replace(/-/g, '');
  try {
    const prev = await fetchCalendar(tour, prevDate);
    if (prev.season?.year && prev.season.year !== cur.season?.year) out.push({ season: prev.season, calendar: prev.calendar, url: scoreboardUrl(tour, prevDate) });
  } catch (e) { warnings.push(`${tour}: previous season calendar failed: ${e.message}`); }
  if (HISTORY) {
    const prev2 = addDays(seasonStart, -565).replace(/-/g, '');
    try {
      const p2 = await fetchCalendar(tour, prev2);
      if (p2.season?.year && !out.some((o) => o.season?.year === p2.season.year)) out.push({ season: p2.season, calendar: p2.calendar, url: scoreboardUrl(tour, prev2) });
    } catch (e) { warnings.push(`${tour}: season -2 calendar failed: ${e.message}`); }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * events + results
 * ------------------------------------------------------------------ */

const compactEvent = (lb, core) => leaderboardToEvent(lb, core, { fetchedAt: nowISO() });

function resultsEntry(lb, core) {
  return {
    tour: lb.tour,
    name: lb.name,
    tournamentId: lb.tournamentId,
    startDate: String(lb.startDate || '').slice(0, 10),
    endDate: String(lb.endDate || '').slice(0, 10),
    seasonYear: lb.seasonYear,
    major: lb.major,
    isSignature: core?.isSignature === true,
    purse: lb.purse ?? core?.purse ?? null,
    courseId: lb.course?.id ?? null,
    courseName: lb.course?.name ?? null,
    yards: lb.course?.yards ?? null,
    par: lb.course?.par ?? null,
    fieldSize: lb.fieldSize,
    cutCount: lb.cut?.count ?? null,
    winner: lb.winner,
    rows: lb.field.filter((p) => !p.amateur || p.position).map(toResultRow),
    sourceUrl: lb.sources.espnLeaderboard,
  };
}

async function fetchEvent(tour, id) {
  const payload = await getJSON(leaderboardUrl(tour, id));
  const lb = parseLeaderboard(payload, { tour });
  if (!lb) return null;
  let core = null;
  try { core = parseCoreEvent(await getJSON(coreEventUrl(tour, id))); } catch { core = null; }
  return { lb, core };
}

async function collectTour(tour, existingEvents, existingResults) {
  const calendars = await fetchCalendars(tour);
  const t = today();
  const upcomingTo = addDays(t, UPCOMING_DAYS);
  const recentFrom = addDays(t, -RECENT_DAYS);
  const players = existingResults?.players || {};
  const resultsEvents = existingResults?.events || {};
  const events = [];
  const stats = { calendar: 0, live: 0, results: 0, skipped: 0, failed: 0 };

  const wanted = [];
  for (const cal of calendars) {
    for (const c of cal.calendar) {
      stats.calendar += 1;
      const s = String(c.startDate || '').slice(0, 10);
      const e = String(c.endDate || c.startDate || '').slice(0, 10);
      const isLive = e >= recentFrom && s <= upcomingTo;
      const isPast = e < t;
      const have = resultsEvents[c.id];
      if (isLive) wanted.push({ id: c.id, why: 'live' });
      else if (isPast && (!have || HISTORY)) wanted.push({ id: c.id, why: 'results' });
      else stats.skipped += 1;
    }
  }

  await mapLimit(wanted, 4, async ({ id, why }) => {
    try {
      const got = await fetchEvent(tour, id);
      if (!got) { stats.failed += 1; warnings.push(`${tour}/${id}: empty leaderboard payload`); return; }
      const { lb, core } = got;
      if (lb.state === 'post' && lb.completed && lb.field.length) {
        resultsEvents[id] = resultsEntry(lb, core);
        for (const p of lb.field) {
          if (!players[p.athleteId]) players[p.athleteId] = { name: p.name, country: p.country, countryCode: p.countryCode };
        }
        stats.results += 1;
      }
      if (why === 'live') { events.push(compactEvent(lb, core)); stats.live += 1; }
      console.log(`  ${tour} ${id} ${lb.name} [${lb.state}] field ${lb.field.length} (${why})`);
    } catch (e) {
      stats.failed += 1;
      warnings.push(`${tour}/${id}: ${e.message}`);
    }
  });

  // Keep any previously committed live events that still fall in the window
  // but failed this run, so a transient error does not blank the board.
  for (const ev of existingEvents || []) {
    if (ev.tour !== tour) continue;
    if (events.some((e) => e.id === ev.id)) continue;
    const e = String(ev.endDate || '').slice(0, 10);
    const s = String(ev.startDate || '').slice(0, 10);
    if (e >= recentFrom && s <= upcomingTo && wanted.some((w) => w.id === ev.id)) { events.push({ ...ev, stale: true }); }
  }

  return { events, calendars, players, resultsEvents, stats };
}

/* ------------------------------------------------------------------ *
 * rankings + stats
 * ------------------------------------------------------------------ */

async function collectRankings() {
  const payload = await getJSON(OWGR_URL, { headers: { Accept: 'application/json', Referer: OWGR_PAGE } });
  const parsed = parseOwgr(payload);
  if (parsed.rows.length < 100) throw new Error(`OWGR returned only ${parsed.rows.length} rows`);
  return {
    schema_version: 1,
    sport: 'Golf',
    fetched_at_utc: nowISO(),
    source: { name: 'Official World Golf Ranking', url: OWGR_URL, page: OWGR_PAGE, method: 'HTTP GET of the public JSON the OWGR site itself loads; no key' },
    note: 'Rank, average points and last-week rank as published. Names are matched to ESPN athletes by normalised name; ambiguous names are dropped (see golf_provenance.json).',
    total: parsed.total,
    rows: parsed.rows,
  };
}

async function collectEspnStats(season) {
  const first = parseByAthleteStats(await getJSON(ESPN_STATS(season, 1)));
  const pages = Math.min(first.pages || 1, 14);
  const pageNums = [];
  for (let p = 2; p <= pages; p += 1) pageNums.push(p);
  // Pages are fetched concurrently but assembled in page order, so the file is
  // byte-identical between runs when the source has not changed (the commit
  // guard in golf-collect.yml compares content, and a shuffled array is churn).
  const byPage = new Map([[1, first.rows]]);
  await mapLimit(pageNums, 4, async (p) => {
    try { byPage.set(p, parseByAthleteStats(await getJSON(ESPN_STATS(season, p))).rows); } catch (e) { warnings.push(`espn stats page ${p}: ${e.message}`); }
  });
  const rows = [...byPage.keys()].sort((a, b) => a - b).flatMap((p) => byPage.get(p));
  return {
    season: first.season ?? season,
    source: { name: 'ESPN PGA TOUR season statistics by athlete', url: ESPN_STATS(season, 1), method: 'public JSON, no key' },
    columns: first.columns,
    lastUpdated: first.lastUpdated,
    rows: rows.filter((r) => r.athleteId),
    fetched_at_utc: nowISO(),
  };
}

async function collectStrokesGained() {
  const categories = {};
  let any = false;
  for (const [key, id] of Object.entries(PGATOUR_STAT_IDS)) {
    try {
      const html = await getText(PGATOUR_STAT(id), { headers: { Accept: 'text/html' } });
      const rows = parsePgaTourStatPage(html);
      categories[key] = { statId: id, url: PGATOUR_STAT(id), rows, parsed: rows.length > 0 };
      if (rows.length) any = true;
      else warnings.push(`pgatour stat ${id}: page fetched but no table parsed (site is JavaScript-rendered; see IR-GOLF-02)`);
    } catch (e) {
      categories[key] = { statId: id, url: PGATOUR_STAT(id), rows: [], parsed: false, error: e.message };
      warnings.push(`pgatour stat ${id}: ${e.message}`);
    }
  }
  return {
    available: any,
    source: PGATOUR_STAT(PGATOUR_STAT_IDS.sg_app),
    method: 'HTTP GET of the public stat page; parsed from the embedded page data or table when present',
    note: 'PGA TOUR only (ShotLink). No equivalent free source exists for the DP World Tour. When a category is not parseable it is absent and the engine scores it as missing.',
    fetched_at_utc: nowISO(),
    categories,
  };
}

/* ------------------------------------------------------------------ *
 * provenance
 * ------------------------------------------------------------------ */

function provenance({ eventsDoc, resultsDoc, rankingsDoc, statsDoc }) {
  const t = nowISO();
  return {
    schema_version: 1,
    sport: 'Golf',
    generated_at_utc: t,
    official_sources: [
      { id: 'espn-golf-leaderboard', name: 'ESPN golf leaderboard JSON', urls: ['https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event={eventId}', 'https://www.espn.com/golf/leaderboard?tournamentId={eventId}'], verified: t, fields_provided: ['field', 'tee times', 'positions', 'result codes (F/CUT/WD/DQ)', 'round scores', 'course yardage and par', 'cut line', 'winner', 'purse', 'major flag'] },
      { id: 'espn-golf-scoreboard', name: 'ESPN golf scoreboard JSON (season calendar)', urls: ['https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=YYYYMMDD', 'https://site.api.espn.com/apis/site/v2/sports/golf/eur/scoreboard?dates=YYYYMMDD'], verified: t, fields_provided: ['season calendar with event ids and dates'] },
      { id: 'espn-golf-core', name: 'ESPN core event JSON', urls: ['https://sports.core.api.espn.com/v2/sports/golf/leagues/{league}/events/{eventId}'], verified: t, fields_provided: ['signature-event flag', 'purse'] },
      { id: 'owgr', name: 'Official World Golf Ranking', urls: [OWGR_URL, OWGR_PAGE], verified: rankingsDoc?.fetched_at_utc ?? null, fields_provided: ['rank', 'average points', 'last-week rank', 'country', 'region'] },
      { id: 'espn-golf-stats', name: 'ESPN PGA TOUR season statistics', urls: [ESPN_STATS(statsDoc?.espn?.season ?? new Date().getUTCFullYear(), 1)], verified: statsDoc?.espn?.fetched_at_utc ?? null, fields_provided: ['driving distance', 'driving accuracy', 'GIR', 'scoring average', 'top-tens', 'wins', 'cuts made', 'birdies per round'] },
      { id: 'pgatour-sg', name: 'PGA TOUR strokes gained (ShotLink)', urls: Object.values(PGATOUR_STAT_IDS).map(PGATOUR_STAT), verified: statsDoc?.sg?.available ? statsDoc.sg.fetched_at_utc : null, fields_provided: statsDoc?.sg?.available ? ['SG approach, off the tee, around the green, putting, tee-to-green, total (season averages)'] : [], note: statsDoc?.sg?.available ? null : 'Not parseable on the last run; strokes-gained categories score as missing.' },
      { id: 'open-meteo', name: 'Open-Meteo forecast', urls: ['https://api.open-meteo.com/v1/forecast'], verified: null, fields_provided: ['daily wind, rain probability, temperature; hourly wind for round-one trend'], note: 'Collected by scripts/collect_golf_weather.mjs' },
      { id: 'olbg-golf', name: 'OLBG golf tips index', urls: ['https://www.olbg.com/betting-tips/Golf/5'], verified: null, fields_provided: ['event names, market names, tipster consensus counts (display only)'], note: 'Collected by scripts/collect_golf_olbg.py' },
    ],
    irregularities: [
      { id: 'IR-GOLF-01', title: 'No free odds source', detail: 'Neither ESPN (odds object absent on every golf event inspected) nor OLBG server HTML publishes golf prices. The prompt\'s value rules that reference market favourites are applied using OWGR rank within the field instead, and that substitution is named in every value flag.', mitigation: 'Odds never synthesised; recorded in missing[] on every market.' },
      { id: 'IR-GOLF-02', title: 'Strokes gained is only free for the PGA TOUR and only as season averages', detail: 'The PGA TOUR stat pages publish season-to-date strokes gained (ShotLink). No free source publishes per-event or last-eight-events strokes gained, and none exists for the DP World Tour. The pages are JavaScript-rendered, so the parser is best-effort.', mitigation: 'Season averages stand in for the eight-event window and the substitution is stated in the component detail; when unparseable the three SG categories score zero and are marked missing, which caps confidence at MEDIUM.' },
      { id: 'IR-GOLF-03', title: 'Course type and grass are not published', detail: 'ESPN publishes yardage and par only; no free source classifies links/parkland/coastal/desert or bentgrass/bermuda.', mitigation: 'A measurable yardage class (short/mid/long) replaces course type; links bonuses in the regional markets are left unassessed and listed as missing.' },
      { id: 'IR-GOLF-04', title: 'Course history is limited to the seasons in the tape', detail: 'The results tape covers the current and previous season(s) collected by this script. "Last four appearances" may therefore be one or two appearances for most players.', mitigation: 'History is scored only from the editions present; when no prior edition exists the whole category is marked missing.' },
      { id: 'IR-GOLF-05', title: 'Name matching between ESPN, OWGR and PGA TOUR is by normalised name', detail: 'The three sources use different player ids. Names are normalised (diacritics, punctuation, suffixes) and ambiguous keys are discarded.', mitigation: 'Unmatched players simply lack a ranking or SG row and score those categories as missing; the coverage panel shows how many matched.' },
      { id: 'IR-GOLF-06', title: 'Round-one weather trend is a forecast', detail: 'The first-round-leader tee-time rule depends on whether conditions deteriorate during day one. The trend is computed from Open-Meteo hourly wind and rain across the tee-time window and is only collected inside seven days of the event.', mitigation: 'Absent forecasts leave the category missing (0 points) rather than assumed.' },
      { id: 'IR-GOLF-07', title: 'Amateurs are excluded', detail: 'Amateurs cannot win prize money and are usually not priced; ESPN flags them.', mitigation: 'Excluded from every market and listed in the card flags.' },
      { id: 'IR-GOLF-08', title: 'LPGA and Champions Tour are shown but not scored', detail: 'The prompt\'s regional markets and OWGR ranking rules apply to the men\'s tours; the LPGA uses a different ranking and the Champions Tour is not ranked by OWGR.', mitigation: 'Their leaderboards and calendars appear on the golf page; no tips are written.' },
    ],
    counts: {
      events: eventsDoc?.events?.length ?? 0,
      resultsEvents: Object.keys(resultsDoc?.events || {}).length,
      players: Object.keys(resultsDoc?.players || {}).length,
      rankings: rankingsDoc?.rows?.length ?? 0,
      espnStatRows: statsDoc?.espn?.rows?.length ?? 0,
      sgAvailable: statsDoc?.sg?.available === true,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  console.log(`Collecting golf (${TOURS.join(', ')})${HISTORY ? ' with history rebuild' : ''}…`);
  const existingEvents = loadExisting(OUT_EVENTS);
  const existingResults = HISTORY ? null : loadExisting(OUT_RESULTS);

  const allEvents = [];
  const calendars = {};
  let players = { ...(existingResults?.players || {}) };
  let resultsEvents = { ...(existingResults?.events || {}) };
  const tourStats = {};
  let tourOk = 0;

  for (const tour of TOURS) {
    try {
      const r = await collectTour(tour, existingEvents?.events || [], { players, events: resultsEvents });
      allEvents.push(...r.events);
      calendars[tour] = r.calendars.map((c) => ({ season: c.season, url: c.url, events: c.calendar }));
      players = r.players; resultsEvents = r.resultsEvents; tourStats[tour] = r.stats;
      tourOk += 1;
    } catch (e) {
      warnings.push(`${tour}: tour collection failed: ${e.message}`);
      // keep previously committed events for this tour
      for (const ev of existingEvents?.events || []) if (ev.tour === tour) allEvents.push({ ...ev, stale: true });
      if (existingEvents?.calendars?.[tour]) calendars[tour] = existingEvents.calendars[tour];
    }
  }
  if (!tourOk && !existingEvents) {
    console.error('Aborting: no tour could be collected and nothing is committed yet.');
    process.exit(1);
  }

  // Show-only tours (LPGA, Champions): calendar + the event covering today, no scoring.
  for (const tour of ['lpga', 'champions-tour']) {
    try {
      const cal = await fetchCalendar(tour, today().replace(/-/g, ''));
      calendars[tour] = [{ season: cal.season, url: scoreboardUrl(tour, today().replace(/-/g, '')), events: cal.calendar }];
      for (const ev of cal.events) {
        try {
          const got = await fetchEvent(tour, ev.id);
          if (got) allEvents.push({ ...compactEvent(got.lb, got.core), showOnly: true });
        } catch (e) { warnings.push(`${tour}/${ev.id}: ${e.message}`); }
      }
    } catch (e) { warnings.push(`${tour}: calendar failed: ${e.message}`); }
  }

  allEvents.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const eventsDoc = {
    schema_version: 1,
    sport: 'Golf',
    fetched_at_utc: nowISO(),
    source: { name: 'ESPN golf leaderboard + scoreboard JSON', url: 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event={eventId}', method: 'public key-less JSON; no JavaScript execution' },
    window: { recentDays: RECENT_DAYS, upcomingDays: UPCOMING_DAYS },
    tours: Object.fromEntries(Object.entries(GOLF_TOURS).map(([k, v]) => [k, { name: v.name, espnLeagueId: v.espnLeagueId, predictable: v.predictable }])),
    calendars,
    events: allEvents,
    stats: tourStats,
    warnings,
  };
  const resultsDoc = {
    schema_version: 1,
    sport: 'Golf',
    fetched_at_utc: nowISO(),
    source: { name: 'ESPN golf leaderboard JSON (completed events)', url: 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league={league}&event={eventId}', method: 'public key-less JSON' },
    row_format: RESULT_ROW,
    note: 'One entry per completed event. rows[] are compact arrays in row_format order; position is null when the player did not finish (CUT/WD/DQ). Every entry carries the ESPN leaderboard URL for manual review.',
    players,
    events: resultsEvents,
  };

  let rankingsDoc = loadExisting(OUT_RANKINGS);
  try { rankingsDoc = await collectRankings(); console.log(`  OWGR: ${rankingsDoc.rows.length} rows`); }
  catch (e) { warnings.push(`OWGR: ${e.message}`); console.warn(`  OWGR failed: ${e.message}`); }

  const existingStats = loadExisting(OUT_STATS);
  let espn = existingStats?.espn || null;
  const season = new Date().getUTCFullYear();
  try { espn = await collectEspnStats(season); console.log(`  ESPN stats: ${espn.rows.length} rows`); }
  catch (e) { warnings.push(`ESPN stats: ${e.message}`); console.warn(`  ESPN stats failed: ${e.message}`); }
  let sg = existingStats?.sg || null;
  try { sg = await collectStrokesGained(); console.log(`  PGA TOUR SG: ${sg.available ? 'parsed' : 'not parsed'}`); }
  catch (e) { warnings.push(`PGA TOUR SG: ${e.message}`); }
  const statsDoc = { schema_version: 1, sport: 'Golf', fetched_at_utc: nowISO(), espn, sg };

  const summary = {
    events: allEvents.length, resultsEvents: Object.keys(resultsEvents).length, players: Object.keys(players).length,
    rankings: rankingsDoc?.rows?.length ?? 0, espnStats: espn?.rows?.length ?? 0, sg: sg?.available === true, warnings: warnings.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (warnings.length) for (const w of warnings) console.warn(`  warning: ${w}`);

  write(OUT_EVENTS, eventsDoc);
  write(OUT_RESULTS, resultsDoc);
  if (rankingsDoc) write(OUT_RANKINGS, rankingsDoc);
  write(OUT_STATS, statsDoc);
  write(OUT_PROV, provenance({ eventsDoc, resultsDoc, rankingsDoc, statsDoc }));
}

main().catch((e) => {
  console.error('Golf collection failed:', e);
  process.exit(1);
});
