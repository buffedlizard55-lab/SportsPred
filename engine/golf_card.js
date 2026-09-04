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
  selectGolfEvents, eventCoversDate, matchGolfOlbg, applySgCoverageFloor, classifyRegion, isStrokePlayRound,
} from './golf_data.js';
import { scoreGolfEvent, CONFIDENCE, MARKET_ORDER } from './golf_engine.js';
import { writeGolfCard, validateGolfCard } from './golf_writer.js';
import { scoreEvent, writeEventCard, validateEventCard } from './golf_event_profiles.js';

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
/** Lower-cased cited links venues (data/golf_links_courses.json). */
export function linksCourseSet(linksDoc) {
  return new Set((linksDoc?.courses || []).map((c) => String(c.espnCourseNameLower || c.espnCourseName || '').toLowerCase()).filter(Boolean));
}

export function buildGolfEventCard(docs, eventId, { asOfISO = null } = {}) {
  const { eventsDoc, resultsDoc, rankingsDoc = null, statsDoc = null, weatherDoc = null, slateDoc = null, linksDoc = null } = docs || {};
  const event = eventFromDoc(eventsDoc, eventId);
  if (!event) return null;
  const asOf = asOfISO || String(event.startDate || '').slice(0, 10);

  const index = docs.index || buildResultsIndex(resultsDoc);
  const owgr = docs.owgr || owgrLookup(rankingsDoc);
  const stats = docs.stats || statsLookup(statsDoc);
  const sg = docs.sg || sgLookup(statsDoc);
  const links = docs.links || linksCourseSet(linksDoc);

  const field = (event.field || []).filter((p) => p && p.athleteId);
  const useSg = sg.available && !docs.noStrokesGained;
  const rawProfiles = field.map((player) => {
    const ranking = matchOwgr(owgr, player.name);
    const statRow = stats.byId.get(String(player.athleteId)) || null;
    const sgRow = useSg ? matchSg(sg, player.name) : null;
    return buildGolfProfile({
      index, player, event, asOfISO: asOf, ranking,
      stats: statRow, sg: sgRow, statsDist: { distanceQ1: stats.distanceQ1, distanceQ3: stats.distanceQ3 },
      linksCourses: links,
    });
  });
  const floor = applySgCoverageFloor(rawProfiles);
  const profiles = floor.profiles;

  const weather = weatherDoc?.events?.[String(event.id)] || null;
  const ctx = buildFieldContext({ event, profiles, index, weather, asOfISO: asOf });
  ctx.priorEditionsInTape = [...index.events.values()].filter((e) => event.tournamentId && e.tournamentId === String(event.tournamentId) && e.endDate && e.endDate < asOf).length;
  ctx.owgrMatched = profiles.filter((p) => p.owgr).length;
  ctx.statsMatched = profiles.filter((p) => p.stats).length;
  ctx.sgSuppressed = floor.suppressed;
  ctx.sgSourceAvailable = useSg;

  // Event overlays (e.g. the Scottish Open prompt) are selected here, so the
  // site, the backtest and the ledger can never disagree about the ruleset.
  const scored = scoreEvent(event, profiles, ctx);
  const written = writeEventCard(scored, event, weather);
  const validation = written ? validateEventCard(scored, written) : null;
  const olbg = slateDoc ? matchGolfOlbg(event, slateDoc) : [];
  const grades = !scored.unscored && event.state === 'post' ? gradeGolfSelections(scored, field) : null;

  const coverage = {
    field: field.length,
    scored: profiles.filter((p) => !p.amateur).length,
    amateurs: profiles.filter((p) => p.amateur).length,
    withHistory: profiles.filter((p) => p.historyStarts > 0).length,
    owgrMatched: ctx.owgrMatched,
    statsMatched: ctx.statsMatched,
    sgMatched: floor.matched,
    sgScored: ctx.sgCoverage,
    sgSuppressed: floor.suppressed,
    teeTimes: profiles.filter((p) => p.teeTime).length,
    priorEditionsInTape: ctx.priorEditionsInTape,
    weather: Boolean(weather?.available),
    r1Trend: weather?.r1?.trend ?? null,
  };

  return {
    event, asOf, profiles, ctx, scored, written, validation, olbg, coverage, grades,
    profile: scored.profile || null,
    ruleset: scored.ruleset || null,
    marketOrder: scored.profile ? [...Object.keys(scored.markets)] : MARKET_ORDER,
    sources: buildSources(event, docs, coverage),
  };
}

/* ------------------------------------------------------------------ *
 * grading (shared by the backtest and the retrospective view)
 * ------------------------------------------------------------------ */

const finished = (p) => p && p.position !== null && p.position !== undefined && (p.result === 'F' || p.result === 'MDF');
const r1Of = (p) => (Number.isFinite(p?.r1) ? p.r1 : (p?.rounds?.find?.((r) => r.period === 1)?.strokes ?? null));

/**
 * Grade the headline selection of every market against a final field.
 * `field` rows need {athleteId, position, result, country, countryCode} and
 * either r1 or rounds[] for the first-round-leader market.
 */
export function gradeGolfSelections(scored, field) {
  const byId = new Map((field || []).map((p) => [String(p.athleteId), p]));
  const out = {};
  // Grade the markets the ruleset actually scored: an event overlay may not have
  // a top-six market at all, and inventing one here would be a false result.
  const order = scored?.markets ? Object.keys(scored.markets) : MARKET_ORDER;
  for (const key of order) {
    const market = scored?.markets?.[key];
    const sel = market?.selections?.[0] || null;
    if (!sel || sel.band === CONFIDENCE.SKIP) { out[key] = { status: 'NO SELECTION', hit: null, selection: null, band: null }; continue; }
    const me = byId.get(String(sel.athleteId));
    if (!me) { out[key] = { status: 'UNVERIFIED', hit: null, selection: sel.name, band: sel.band }; continue; }
    let hit = null;
    if (key === 'outright') hit = finished(me) && me.position === 1;
    else if (key === 'top6') hit = finished(me) && me.position <= 6;
    else if (key === 'frl') {
      const r1s = (field || []).map(r1Of).filter(isStrokePlayRound);
      const mine = r1Of(me);
      // Fewer than twenty real opening rounds means a Stableford or abandoned
      // round; the market cannot be graded from this tape.
      if (r1s.length < 20 || !isStrokePlayRound(mine)) { out[key] = { status: 'UNVERIFIED', hit: null, selection: sel.name, band: sel.band }; continue; }
      hit = mine === Math.min(...r1s);
    } else {
      const flag = key === 'top_european' ? 'european' : key === 'top_american' ? 'american' : 'britishIrish';
      const eligible = (field || []).filter((p) => classifyRegion({ country: p.country, countryCode: p.countryCode })[flag] && finished(p));
      if (!eligible.length) { out[key] = { status: 'UNVERIFIED', hit: null, selection: sel.name, band: sel.band }; continue; }
      hit = finished(me) && me.position === Math.min(...eligible.map((p) => p.position));
    }
    out[key] = { status: hit ? 'HIT' : 'MISS', hit, selection: sel.name, band: sel.band, valuePick: sel.valuePick === true };
  }
  const t6 = scored?.markets?.top6?.selections || [];
  out._top6List = { selections: t6.length, hits: t6.filter((s) => { const p = byId.get(String(s.athleteId)); return finished(p) && p.position <= 6; }).length };
  return out;
}

function buildSources(event, docs, coverage) {
  const out = [];
  if (event?.sources?.espnLeaderboard) out.push({ label: 'ESPN leaderboard (field, tee times, results)', url: event.sources.espnLeaderboard });
  if (event?.sources?.api) out.push({ label: 'ESPN leaderboard JSON', url: event.sources.api });
  if (docs?.resultsDoc?.source?.url) {
    // The tape's source is a URL template; the review link must be a real page,
    // so it resolves to this event (or, failing that, the tour's schedule page).
    const tpl = String(docs.resultsDoc.source.url);
    const resolved = tpl.includes('{') && event?.tour && event?.id ? tpl.replace('{league}', event.tour).replace('{eventId}', event.id) : tpl;
    const url = resolved.includes('{') ? `https://www.espn.com/golf/schedule/_/tour/${event?.tour || 'pga'}` : resolved;
    if (!out.some((x) => x.url === url)) out.push({ label: 'Results tape source (every history row links its own ESPN leaderboard)', url });
  }
  if (event?.tour) out.push({ label: 'ESPN schedule and results for this tour', url: `https://www.espn.com/golf/schedule/_/tour/${event.tour}` });
  if (docs?.rankingsDoc?.source?.url) out.push({ label: `Official World Golf Ranking (${docs.rankingsDoc.weekLabel || docs.rankingsDoc.fetched_at_utc || ''})`, url: docs.rankingsDoc.source.url });
  if (docs?.statsDoc?.espn?.source?.url) out.push({ label: 'ESPN season statistics', url: docs.statsDoc.espn.source.url });
  if (docs?.statsDoc?.sg?.available && docs.statsDoc.sg.source) out.push({ label: 'PGA TOUR strokes gained (ShotLink)', url: docs.statsDoc.sg.source });
  const wx = docs?.weatherDoc?.events?.[String(event?.id)];
  if (wx?.sourceUrl) out.push({ label: 'Open-Meteo forecast', url: wx.sourceUrl });
  if (docs?.slateDoc?.source?.url) out.push({ label: 'OLBG golf tips index', url: docs.slateDoc.source.url });
  if (docs?.linksDoc?.sources) {
    for (const src of docs.linksDoc.sources) out.push({ label: `Links venue classification — ${src.name}`, url: src.url });
  }
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
    links: docs.links || linksCourseSet(docs.linksDoc),
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
