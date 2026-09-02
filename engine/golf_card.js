/**
 * SportsPred — Golf card builder.
 *
 * Joins the committed golf documents into scored, written cards. Pure: the
 * caller supplies every document; nothing is fetched here.
 *
 *   data/golf_events.json    upcoming + recent events with full fields (ESPN)
 *   data/golf_results.json   compact results tape, two seasons per tour (ESPN)
 *   data/golf_rankings.json  Official World Golf Ranking (OWGR public JSON)
 *   data/golf_stats.json     ESPN season statistics + PGA TOUR strokes gained
 *   data/golf_weather.json   Open-Meteo forecasts per upcoming event
 *   data/golf_slate.json     OLBG golf slate (display only, never scored)
 */

import {
  buildResultsIndex, buildGolfProfile, buildFieldContext, nameKeys, normName,
  selectGolfEvents, eventCoversDate, matchGolfOlbg,
} from './golf_data.js';
import { scoreGolfEvent } from './golf_engine.js';
import { writeGolfCard, validateGolfCard } from './golf_writer.js';

/* ------------------------------------------------------------------ *
 * lookups
 * ------------------------------------------------------------------ */

/** name key -> OWGR row (ambiguous keys are dropped and reported). */
export function owgrLookup(rankingsDoc) {
  const byKey = new Map();
  const ambiguous = new Set();
  for (const r of rankingsDoc?.rows || []) {
    for (const k of nameKeys(r.name)) {
      if (byKey.has(k) && byKey.get(k).owgrId !== r.owgrId) { ambiguous.add(k); continue; }
      byKey.set(k, r);
    }
  }
  for (const k of ambiguous) byKey.delete(k);
  return { byKey, ambiguous };
}

export function matchOwgr(lookup, name) {
  for (const k of nameKeys(name)) {
    const hit = lookup?.byKey?.get(k);
    if (hit) return hit;
  }
  return null;
}

/** athleteId -> ESPN season stat row. */
export function statsLookup(statsDoc) {
  const byId = new Map();
  for (const r of statsDoc?.espn?.rows || []) if (r.athleteId) byId.set(String(r.athleteId), r);
  const dists = [...byId.values()].map((r) => r.stats?.yardsPerDrive).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const q = (p) => (dists.length >= 20 ? dists[Math.floor((dists.length - 1) * p)] : null);
  return { byId, distanceQ1: q(0.25), distanceQ3: q(0.75), season: statsDoc?.espn?.season ?? null };
}

/** name key -> {app, ott, arg, putt, t2g, total} from the PGA TOUR strokes-gained tables. */
export function sgLookup(statsDoc) {
  const byKey = new Map();
  const cats = statsDoc?.sg?.categories || {};
  const map = { sg_app: 'app', sg_ott: 'ott', sg_arg: 'arg', sg_putt: 'putt', sg_t2g: 't2g', sg_total: 'total' };
  for (const [id, short] of Object.entries(map)) {
    for (const row of cats[id]?.rows || []) {
      for (const k of nameKeys(row.name)) {
        if (!byKey.has(k)) byKey.set(k, {});
        byKey.get(k)[short] = { rank: row.rank, avg: row.avg, rounds: row.rounds ?? null };
      }
    }
  }
  return { byKey, available: byKey.size > 0, source: statsDoc?.sg?.source ?? null, fetchedAt: statsDoc?.sg?.fetched_at_utc ?? null };
}

export function matchSg(lookup, name) {
  if (!lookup?.available) return null;
  for (const k of nameKeys(name)) {
    const hit = lookup.byKey.get(k);
    if (hit && hit.app) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * card
 * ------------------------------------------------------------------ */

export function eventFromDoc(eventsDoc, eventId) {
  return (eventsDoc?.events || []).find((e) => String(e.id) === String(eventId)) || null;
}

/**
 * Build the scored + written card for one event.
 * @returns {object|null} null when the event is unknown
 */
export function buildGolfEventCard(docs, eventId, { asOfISO = null } = {}) {
  const { eventsDoc, resultsDoc, rankingsDoc = null, statsDoc = null, weatherDoc = null, slateDoc = null } = docs || {};
  const event = eventFromDoc(eventsDoc, eventId);
  if (!event) return null;
  const asOf = asOfISO || String(event.startDate || '').slice(0, 10);

  const index = docs.index || buildResultsIndex(resultsDoc);
  const owgr = docs.owgr || owgrLookup(rankingsDoc);
  const stats = docs.stats || statsLookup(statsDoc);
  const sg = docs.sg || sgLookup(statsDoc);

  const field = (event.field || []).filter((p) => p && p.athleteId);
  const profiles = field.map((player) => {
    const ranking = matchOwgr(owgr, player.name);
    const statRow = stats.byId.get(String(player.athleteId)) || null;
    const sgRow = event.tour === 'pga' || (sg.available && matchSg(sg, player.name)) ? matchSg(sg, player.name) : null;
    return buildGolfProfile({
      index, player, event, asOfISO: asOf, ranking,
      stats: statRow, sg: sgRow, statsDist: { distanceQ1: stats.distanceQ1, distanceQ3: stats.distanceQ3 },
    });
  });

  const weather = weatherDoc?.events?.[String(event.id)] || null;
  const ctx = buildFieldContext({ event, profiles, index, weather, asOfISO: asOf });
  ctx.priorEditionsInTape = [...index.events.values()].filter((e) => event.tournamentId && e.tournamentId === String(event.tournamentId) && e.endDate && e.endDate < asOf).length;
  ctx.owgrMatched = profiles.filter((p) => p.owgr).length;
  ctx.statsMatched = profiles.filter((p) => p.stats).length;

  const scored = scoreGolfEvent(event, profiles, ctx);
  const written = scored.unscored ? null : writeGolfCard(scored, event, weather);
  const validation = written ? validateGolfCard(written) : null;
  const olbg = slateDoc ? matchGolfOlbg(event, slateDoc) : [];

  const coverage = {
    field: field.length,
    scored: profiles.filter((p) => !p.amateur).length,
    amateurs: profiles.filter((p) => p.amateur).length,
    withHistory: profiles.filter((p) => p.historyStarts > 0).length,
    owgrMatched: ctx.owgrMatched,
    statsMatched: ctx.statsMatched,
    sgMatched: ctx.sgCoverage,
    teeTimes: profiles.filter((p) => p.teeTime).length,
    priorEditionsInTape: ctx.priorEditionsInTape,
    weather: Boolean(weather?.available),
    r1Trend: weather?.r1?.trend ?? null,
  };

  return {
    event, asOf, profiles, ctx, scored, written, validation, olbg, coverage,
    sources: buildSources(event, docs, coverage),
  };
}

function buildSources(event, docs, coverage) {
  const out = [];
  if (event?.sources?.espnLeaderboard) out.push({ label: 'ESPN leaderboard (field, tee times, results)', url: event.sources.espnLeaderboard });
  if (event?.sources?.api) out.push({ label: 'ESPN leaderboard JSON', url: event.sources.api });
  if (docs?.resultsDoc?.source?.url) out.push({ label: 'Results tape source', url: docs.resultsDoc.source.url });
  if (docs?.rankingsDoc?.source?.url) out.push({ label: `Official World Golf Ranking (${docs.rankingsDoc.weekLabel || docs.rankingsDoc.fetched_at_utc || ''})`, url: docs.rankingsDoc.source.url });
  if (docs?.statsDoc?.espn?.source?.url) out.push({ label: 'ESPN season statistics', url: docs.statsDoc.espn.source.url });
  if (docs?.statsDoc?.sg?.available && docs.statsDoc.sg.source) out.push({ label: 'PGA TOUR strokes gained (ShotLink)', url: docs.statsDoc.sg.source });
  const wx = docs?.weatherDoc?.events?.[String(event?.id)];
  if (wx?.sourceUrl) out.push({ label: 'Open-Meteo forecast', url: wx.sourceUrl });
  if (docs?.slateDoc?.source?.url) out.push({ label: 'OLBG golf tips index', url: docs.slateDoc.source.url });
  return out;
}

/** Cards for every event covering a date (plus each tour's next event). */
export function buildGolfDateCard(docs, dateISO, { tours = null } = {}) {
  const events = selectGolfEvents(docs?.eventsDoc?.events || [], dateISO, { tours });
  const shared = {
    ...docs,
    index: docs.index || buildResultsIndex(docs.resultsDoc),
    owgr: docs.owgr || owgrLookup(docs.rankingsDoc),
    stats: docs.stats || statsLookup(docs.statsDoc),
    sg: docs.sg || sgLookup(docs.statsDoc),
  };
  const cards = events.map((e) => buildGolfEventCard(shared, e.id)).filter(Boolean);
  return { dateISO, events, cards };
}

/** Events for the calendar: id, tour, name, dates, state per day. */
export function golfCalendarCounts(eventsDoc) {
  const counts = new Map();
  for (const e of eventsDoc?.events || []) {
    const s = String(e.startDate || '').slice(0, 10);
    const end = String(e.endDate || e.startDate || '').slice(0, 10);
    if (!s) continue;
    let d = new Date(`${s}T12:00:00Z`);
    for (let i = 0; i < 10; i += 1) {
      const iso = d.toISOString().slice(0, 10);
      if (iso > end) break;
      counts.set(iso, (counts.get(iso) || 0) + 1);
      d = new Date(d.getTime() + 86400000);
    }
  }
  return counts;
}

export { eventCoversDate, normName };
