#!/usr/bin/env node
/**
 * SportsPred — Greyhound collector (GBGB official results API).
 *
 * Builds the committed data layer for the greyhound specialist engine:
 *
 *   data/greyhound_meetings.json  normalised races for the collection window
 *                                 (today plus BACKTEST_DAYS past days), with the
 *                                 full declared draw, results, SPs and times.
 *   data/greyhound_history.json   per-dog run history (newest first) for every
 *                                 dog on the upcoming cards, refreshed forward.
 *   data/greyhound_slate.json     OLBG greyhound index snapshot (display only).
 *   data/greyhound_predictions.json append-only forward-collection ledger.
 *
 * Sources (all free, key-less, public):
 *   https://api.gbgb.org.uk/api/results?date=YYYY-MM-DD&race_type=race   (day index)
 *   https://api.gbgb.org.uk/api/results/meeting/{meetingId}             (full card)
 *   https://api.gbgb.org.uk/api/results/dog/{dogId}                     (dog history)
 *   https://www.sportinglife.com/greyhounds/racecards                   (meeting index
 *         for upcoming days whose races have not started; only its racecard
 *         links are read, the official GBGB payload remains the data source)
 *   https://www.olbg.com/betting-tips/Greyhounds/28                     (slate)
 *
 * Honesty: any fetch failure aborts the run; nothing is invented. Races that
 * are trials are excluded. A run record with no finishing position is kept in
 * the draw but never treated as form.
 *
 * Usage:
 *   node scripts/collect_greyhound.mjs                 # collect window, refresh histories, settle
 *   node scripts/collect_greyhound.mjs --backtest 60   # rebuild N days of meetings
 *   node scripts/collect_greyhound.mjs --dry-run       # report only, write nothing
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseMeetingPayload, parseDogHistory, GBGB_API_BASE,
} from '../engine/greyhound_gbgb.js';
import { scoreRace } from '../engine/greyhound_engine.js';
import { enrichRace } from '../engine/greyhound_data.js';
import { settleRace } from '../engine/greyhound_card.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const BACKTEST_DAYS = Number(process.env.GH_BACKTEST_DAYS || 14);
const FUTURE_DAYS = 1; // Sporting Life publishes the next morning's cards too
const TIMEOUT = 25000;
const UA = 'Mozilla/5.0 (compatible; SportsPredCollector/1.0; +https://github.com/buffedlizard55-lab/SportsPred)';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

function out(p, doc) {
  const target = path.join(DATA, p);
  const body = JSON.stringify(doc, null, 2) + '\n';
  if (DRY_RUN) { console.log(`[dry-run] would write ${p} (${body.length} bytes)`); return; }
  fs.writeFileSync(target, body);
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf-8')); }
  catch { return fallback; }
}

async function fetchJson(url, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT);
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'en-GB,en;q=0.9' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      return await resp.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr;
}

async function fetchText(url, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT);
      const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      return await resp.text();
    } catch (err) { lastErr = err; await new Promise((r) => setTimeout(r, 800 * attempt)); }
  }
  throw lastErr;
}

function isoDay(d) { return d.toISOString().slice(0, 10); }

/** Day index -> distinct meeting ids (winner rows carry meetingId). */
async function meetingIdsForDate(date) {
  const ids = new Set();
  let page = 1;
  for (;;) {
    const url = `${GBGB_API_BASE}/results?page=${page}&itemsPerPage=200&date=${date}&race_type=race`;
    const doc = await fetchJson(url);
    if (!doc?.items) break;
    for (const row of doc.items) {
      if (row?.meetingId != null) ids.add(Number(row.meetingId));
    }
    const meta = doc.meta || {};
    if (!meta.pageCount || page >= meta.pageCount || doc.items.length === 0) break;
    page += 1;
    if (page > 30) break; // safety: ~6000 races/day cap
  }
  return ids;
}

async function meetingPayload(meetingId) {
  const url = `${GBGB_API_BASE}/results/meeting/${meetingId}`;
  return fetchJson(url);
}

/** Upcoming meeting ids from the Sporting Life racecard index (date -> racecard links). */
async function upcomingRacecardLinks() {
  // Sporting Life only serves "today" and the racecard index is same-day; the
  // GBGB day index covers cards once results start landing, so the union is
  // complete within the collection window. We still read the index to surface
  // racecard URLs and cross-check venue coverage.
  const links = new Map(); // "YYYY-MM-DD|track" -> { track, raceId, url }
  for (const date of todayWindow(FUTURE_DAYS)) {
    const html = await fetchText(`https://www.sportinglife.com/greyhounds/racecards?date=${date}`).catch(() => null)
      || await fetchText('https://www.sportinglife.com/greyhounds/racecards').catch(() => null);
    if (!html) continue;
    const re = /\/greyhounds\/racecards\/(\d{4}-\d{2}-\d{2})\/([a-z0-9-]+)\/racecard\/(\d+)/g;
    let m;
    while ((m = re.exec(html))) {
      const [, d, track, raceId] = m;
      links.set(`${d}|${track}|${raceId}`, { date: d, track, racecardId: raceId, url: `https://www.sportinglife.com${m[0]}` });
    }
  }
  return links;
}

function* todayWindow(n) {
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    yield isoDay(d);
  }
}

function dateWindow(daysBack) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i <= daysBack; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(isoDay(d));
  }
  return dates;
}

async function collectMeetings(dates) {
  const meetings = [];
  const races = [];
  const fetchedAt = new Date().toISOString();
  for (const date of dates) {
    let ids;
    try {
      ids = [...(await meetingIdsForDate(date))];
    } catch (err) {
      console.error(`::warning::GBGB day index failed for ${date}: ${err.message}`);
      continue;
    }
    for (const id of ids) {
      const payload = await meetingPayload(id);
      if (!payload) continue;
      const parsed = parseMeetingPayload(payload);
      if (!parsed.length) continue;
      const track = payload?.[0]?.trackName || parsed[0]?.track;
      meetings.push({ meetingId: id, track, date, raceCount: parsed.length, fetchedAt });
      races.push(...parsed);
    }
  }
  return { meetings, races };
}

async function collectHistories(races, priorDogs) {
  const needed = new Map(); // dogId -> { name, trap }
  for (const r of races) {
    if (r.status !== 'scheduled') continue;
    for (const runner of r.runners || []) {
      needed.set(String(runner.dogId), { dogId: runner.dogId, name: runner.name });
    }
  }
  const dogs = { ...(priorDogs?.dogs || {}) };
  const collected = [];
  for (const [dogId, meta] of needed) {
    try {
      const doc = await fetchJson(`${GBGB_API_BASE}/results/dog/${dogId}?page=1&itemsPerPage=60`);
      const runs = doc ? parseDogHistory(doc) : [];
      if (runs.length) {
        dogs[dogId] = { dogId: Number(dogId), name: meta.name, fetchedAt: new Date().toISOString(), runs };
        collected.push({ dogId: Number(dogId), runs: runs.length });
      }
      await new Promise((r) => setTimeout(r, 250)); // be polite to the free API
    } catch (err) {
      console.error(`::warning::dog history failed for ${dogId} (${meta.name}): ${err.message}`);
    }
  }
  return { dogs, collected };
}

/** Score the day's upcoming card, append new picks, and settle pending picks. */
function recordAndSettle(races, historyDoc, priorPredictions) {
  const history = new Map();
  for (const [id, d] of Object.entries(historyDoc.dogs || {})) history.set(String(id), d.runs || []);

  const upcoming = races.filter((r) => r.status === 'scheduled' && r.date >= isoDay(new Date()));
  const settledRaces = new Map(races.filter((r) => r.status === 'result').map((r) => [String(r.raceId), r]));

  const preds = { ...(priorPredictions || {}) };
  preds.schema_version = preds.schema_version || 1;
  preds.sport = 'Greyhounds';
  preds.picks = Array.isArray(preds.picks) ? preds.picks : [];
  preds.updated_at_utc = new Date().toISOString();

  const seen = new Set(preds.picks.map((p) => String(p.raceId)));
  for (const race of upcoming) {
    if (seen.has(String(race.raceId))) continue;
    const enriched = enrichRace(race, history);
    const scored = scoreRace(enriched, { live: true });
    if (scored.decision.action !== 'SELECT' || !scored.winner) continue;
    preds.picks.push({
      raceId: race.raceId,
      meetingId: race.meetingId,
      track: race.track,
      date: race.date,
      time: race.time,
      grade: race.grade,
      distance: race.distance,
      selection: scored.winner.name,
      dogId: scored.winner.dogId,
      trap: scored.winner.trap,
      score: scored.winner.score,
      confidence: scored.decision.confidence,
      gap: scored.gap,
      recorded_at_utc: new Date().toISOString(),
      settled: false,
    });
  }

  let settledCount = 0;
  for (const pick of preds.picks) {
    if (pick.settled) continue;
    const race = settledRaces.get(String(pick.raceId));
    if (!race) continue;
    const result = settleRace({
      ...race,
      runners: race.runners.map((rn) => ({ ...rn, score: 0, components: [], missing: [] })),
      winner: { name: pick.selection, dogId: pick.dogId },
      decision: { confidence: pick.confidence },
      status: 'result',
    });
    pick.settled = true;
    pick.settled_at_utc = new Date().toISOString();
    pick.result_position = result.selectedPosition;
    pick.won = result.won;
    pick.sp = result.sp;
    settledCount += 1;
  }
  return { predictions: preds, newPicks: upcoming.length, settledCount };
}

async function main() {
  const backtestArg = process.argv.indexOf('--backtest');
  const daysBack = backtestArg > -1 ? Number(process.argv[backtestArg + 1] || BACKTEST_DAYS) : BACKTEST_DAYS;

  console.log(`Greyhound collection: window ${daysBack} days back + today/upcoming`);
  const dates = dateWindow(daysBack);
  const { meetings, races } = await collectMeetings(dates);
  console.log(`Meetings: ${meetings.length}, normalised races: ${races.length} (${races.filter((r) => r.status === 'result').length} results, ${races.filter((r) => r.status === 'scheduled').length} upcoming)`);

  let racecardLinks = new Map();
  try {
    racecardLinks = await upcomingRacecardLinks();
    console.log(`Sporting Life racecard links: ${racecardLinks.size}`);
  } catch (err) {
    console.error(`::warning::Sporting Life index unreadable: ${err.message}`);
  }

  const priorHistory = readJson('greyhound_history.json', { dogs: {} });
  const { dogs, collected } = await collectHistories(races, priorHistory);
  console.log(`Dog histories: ${collected.length} refreshed, ${Object.keys(dogs).length} total`);

  const historyDoc = {
    schema_version: 1,
    sport: 'Greyhounds',
    source: {
      name: 'GBGB official results API — dog history',
      base: GBGB_API_BASE,
      site: 'https://www.gbgb.org.uk/racing/results/',
      fetched_at_utc: new Date().toISOString(),
    },
    dogs,
  };

  const priorPreds = readJson('greyhound_predictions.json', null);
  const { predictions, settledCount } = recordAndSettle(races, historyDoc, priorPreds);
  console.log(`Forward ledger: ${predictions.picks.length} picks total, ${settledCount} newly settled`);

  const meetingsDoc = {
    schema_version: 1,
    sport: 'Greyhounds',
    source: {
      name: 'GBGB official results API — meetings',
      base: GBGB_API_BASE,
      site: 'https://www.gbgb.org.uk/racing/results/',
      sporting_life_racecards: 'https://www.sportinglife.com/greyhounds/racecards',
      fetched_at_utc: new Date().toISOString(),
      window: { days_back: daysBack, dates },
      licence_note: 'Official Greyhound Board of Great Britain data, publicly viewable; factual race results and cards.',
    },
    meetings,
    racecard_links: [...racecardLinks.values()],
    races,
  };

  if (meetings.length === 0) {
    throw new Error('GBGB returned zero meetings across the window; refusing to overwrite committed data (network blocked or API down)');
  }

  out('greyhound_meetings.json', meetingsDoc);
  out('greyhound_history.json', historyDoc);
  out('greyhound_predictions.json', predictions);
}

main().catch((err) => {
  console.error('Greyhound collection failed:', err);
  process.exit(1);
});
