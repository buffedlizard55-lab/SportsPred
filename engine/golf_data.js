/**
 * SportsPred — Golf data layer (pure, no I/O, no clock).
 *
 * Turns the committed golf documents (results tape, rankings, statistics,
 * weather, upcoming fields) into the per-player profile the golf engine scores.
 *
 * Every number produced here is MEASURED from rows that carry a source URL.
 * When a factor cannot be measured from the data supplied, the profile field is
 * null and the engine records it in `missing[]` — nothing is estimated.
 *
 * Leak control: every history helper takes `asOfISO` (the tournament's first
 * day) and only reads events that ENDED strictly before it. The walk-forward
 * backtest and the live site therefore see exactly the same evidence.
 */

import { fromResultRow } from './golf_espn.js';

export const DAY_MS = 86400000;

/* ------------------------------------------------------------------ *
 * names, regions, course classes
 * ------------------------------------------------------------------ */

/** Diacritic-free, punctuation-free, lower-case key for name matching. */
export function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/gi, 'o').replace(/æ/gi, 'ae').replace(/ß/g, 'ss').replace(/đ/gi, 'd').replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/\(a\)|\(am\)/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Variants tried in order when matching an OWGR / PGA TOUR name to ESPN. */
export function nameKeys(name) {
  const n = normName(name);
  if (!n) return [];
  const parts = n.split(' ');
  const out = [n];
  if (parts.length > 2) out.push(`${parts[0]} ${parts[parts.length - 1]}`);
  return [...new Set(out)];
}

const BRITISH_IRISH = new Set(['england', 'scotland', 'wales', 'northern ireland', 'ireland', 'republic of ireland', 'great britain', 'united kingdom']);
const BRITISH_IRISH_CODES = new Set(['ENG', 'SCO', 'SCT', 'WAL', 'NIR', 'IRL', 'GBR']);
const EUROPE = new Set([
  ...BRITISH_IRISH,
  'austria', 'belgium', 'bulgaria', 'croatia', 'czech republic', 'czechia', 'denmark', 'estonia', 'finland', 'france',
  'germany', 'greece', 'hungary', 'iceland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'netherlands', 'norway',
  'poland', 'portugal', 'romania', 'serbia', 'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland', 'ukraine',
  'turkey', 'turkiye', 'cyprus', 'malta', 'monaco', 'liechtenstein', 'belarus', 'russia', 'bosnia and herzegovina',
  'north macedonia', 'albania', 'montenegro', 'moldova', 'andorra', 'san marino', 'kosovo', 'georgia', 'armenia', 'azerbaijan',
]);
const EUROPE_CODES = new Set([
  ...BRITISH_IRISH_CODES, 'AUT', 'BEL', 'BUL', 'BGR', 'CRO', 'HRV', 'CZE', 'DEN', 'DNK', 'EST', 'FIN', 'FRA', 'GER', 'DEU',
  'GRE', 'GRC', 'HUN', 'ISL', 'ITA', 'LAT', 'LVA', 'LTU', 'LUX', 'NED', 'NLD', 'NOR', 'POL', 'POR', 'PRT', 'ROU', 'ROM',
  'SRB', 'SVK', 'SLO', 'SVN', 'ESP', 'SWE', 'SUI', 'CHE', 'UKR', 'TUR', 'CYP', 'MLT', 'MON', 'MCO', 'LIE', 'BLR', 'RUS',
  'BIH', 'MKD', 'ALB', 'MNE', 'MDA', 'AND', 'SMR', 'KOS', 'GEO', 'ARM', 'AZE',
]);
const AMERICAN = new Set(['usa', 'united states', 'united states of america']);
const AMERICAN_CODES = new Set(['USA']);

/**
 * Regional eligibility. OWGR's own region label wins when it is known; the
 * country lists above are the fallback for players OWGR does not list.
 */
export function classifyRegion({ country = null, countryCode = null, owgrRegion = null } = {}) {
  const c = String(country || '').toLowerCase().trim();
  const code = String(countryCode || '').toUpperCase().trim();
  const britishIrish = BRITISH_IRISH.has(c) || BRITISH_IRISH_CODES.has(code);
  const american = AMERICAN.has(c) || AMERICAN_CODES.has(code);
  let european = EUROPE.has(c) || EUROPE_CODES.has(code) || britishIrish;
  if (owgrRegion) european = String(owgrRegion).toLowerCase() === 'europe' || european;
  return { european, american, britishIrish, known: Boolean(c || code || owgrRegion) };
}

/** Coarse, measurable course class from ESPN's published yardage. */
export function courseClass(yards) {
  const y = Number(yards);
  if (!Number.isFinite(y) || y <= 0) return null;
  if (y >= 7400) return 'long';
  if (y >= 7000) return 'mid';
  return 'short';
}

/* ------------------------------------------------------------------ *
 * results tape
 * ------------------------------------------------------------------ */

export function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${String(fromISO).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toISO).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

export function madeCut(row) {
  return row?.result === 'F' || row?.result === 'MDF';
}

/**
 * A completed stroke-play round. ESPN publishes partial rounds for withdrawn
 * players (e.g. 23 strokes through nine holes) and Stableford points for the
 * modified-Stableford event, and both would otherwise read as record-low
 * opening rounds. Only whole rounds between 55 and 100 strokes count.
 */
export const R1_MIN_STROKES = 55;
export const R1_MAX_STROKES = 100;
export function isStrokePlayRound(v) {
  return Number.isFinite(v) && v >= R1_MIN_STROKES && v <= R1_MAX_STROKES;
}

export function missedCut(row) {
  return row?.result === 'CUT';
}

/**
 * Index the committed results document.
 * @returns {{ events: Map, rowsByPlayer: Map, players: object }}
 */
export function buildResultsIndex(resultsDoc) {
  const events = new Map();
  const rowsByPlayer = new Map();
  const players = resultsDoc?.players || {};
  for (const [eventId, ev] of Object.entries(resultsDoc?.events || {})) {
    const meta = {
      eventId: String(eventId),
      tour: ev.tour ?? null,
      name: ev.name ?? null,
      tournamentId: ev.tournamentId != null ? String(ev.tournamentId) : null,
      startDate: ev.startDate ? String(ev.startDate).slice(0, 10) : null,
      endDate: ev.endDate ? String(ev.endDate).slice(0, 10) : null,
      seasonYear: ev.seasonYear ?? null,
      major: ev.major === true,
      isSignature: ev.isSignature === true,
      purse: ev.purse ?? null,
      courseId: ev.courseId ?? null,
      courseName: ev.courseName ?? null,
      yards: ev.yards ?? null,
      par: ev.par ?? null,
      fieldSize: ev.fieldSize ?? (Array.isArray(ev.rows) ? ev.rows.length : null),
      cutCount: ev.cutCount ?? null,
      sourceUrl: ev.sourceUrl ?? null,
    };
    events.set(meta.eventId, meta);
    for (const raw of ev.rows || []) {
      const r = fromResultRow(raw);
      if (!r) continue;
      const row = { ...r, ...meta };
      if (!rowsByPlayer.has(r.athleteId)) rowsByPlayer.set(r.athleteId, []);
      rowsByPlayer.get(r.athleteId).push(row);
    }
  }
  for (const rows of rowsByPlayer.values()) {
    rows.sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
  }
  return { events, rowsByPlayer, players };
}

/** Player rows that ENDED strictly before asOfISO, most recent first. */
export function historyBefore(index, athleteId, asOfISO) {
  const rows = index?.rowsByPlayer?.get(String(athleteId)) || [];
  const cutoff = String(asOfISO).slice(0, 10);
  return rows.filter((r) => r.endDate && r.endDate < cutoff);
}

function within(row, asOfISO, days) {
  const d = daysBetween(row.endDate, asOfISO);
  return d !== null && d >= 0 && d <= days;
}

function isTop(row, n) {
  return row.position !== null && row.position !== undefined && row.position <= n && madeCut(row);
}

/* ------------------------------------------------------------------ *
 * per-player measurements
 * ------------------------------------------------------------------ */

export function summariseForm(rows, asOfISO, event) {
  const last5 = rows.slice(0, 5);
  const in6w = rows.filter((r) => within(r, asOfISO, 42));
  const in6m = rows.filter((r) => within(r, asOfISO, 183));
  const in12m = rows.filter((r) => within(r, asOfISO, 365));
  const in24m = rows.filter((r) => within(r, asOfISO, 730));
  const top10s12m = in12m.filter((r) => isTop(r, 10)).length;
  const purse = Number(event?.purse) || null;
  const elevated = (r) => r.major || r.isSignature;
  return {
    starts: rows.length,
    last5: last5.map((r) => ({
      eventId: r.eventId, name: r.name, tour: r.tour, endDate: r.endDate, position: r.position, result: r.result,
      toPar: r.toPar, major: r.major, weeksAgo: Math.floor((daysBetween(r.endDate, asOfISO) ?? 0) / 7),
    })),
    winIn6w: in6w.some((r) => isTop(r, 1)),
    top3In6w: in6w.some((r) => isTop(r, 3)),
    top10Last5: last5.filter((r) => isTop(r, 10)).length,
    top20Last5: last5.filter((r) => isTop(r, 20)).length,
    backToBackTop10: last5.length >= 2 && isTop(last5[0], 10) && isTop(last5[1], 10),
    comparableFieldTop10: purse
      ? last5.some((r) => isTop(r, 10) && (Number(r.purse) >= purse * 0.8 || elevated(r)))
      : null,
    winIn6m: in6m.some((r) => isTop(r, 1)),
    elevatedWin12m: in12m.some((r) => isTop(r, 1) && elevated(r)),
    careerWinsInWindow: rows.filter((r) => isTop(r, 1)).length,
    majorsWonLast2y: in24m.filter((r) => isTop(r, 1) && r.major).length,
    starts12m: in12m.length,
    top10s12m,
    top10Rate12m: in12m.length >= 5 ? round(top10s12m / in12m.length, 4) : null,
    mcLast2Consecutive: rows.length >= 2 && missedCut(rows[0]) && missedCut(rows[1]),
    noMcLast2: rows.length >= 2 && madeCut(rows[0]) && madeCut(rows[1]),
    lastStartDaysAgo: rows.length ? daysBetween(rows[0].endDate, asOfISO) : null,
    competedLast3Weeks: rows.some((r) => within(r, asOfISO, 21)),
    tourWinIn: (tour, days) => rows.some((r) => r.tour === tour && isTop(r, 1) && within(r, asOfISO, days)),
    tourTop3In: (tour, days) => rows.some((r) => r.tour === tour && isTop(r, 3) && within(r, asOfISO, days)),
  };
}

/** Appearances at this exact tournament (same ESPN tournament id), most recent first. */
export function eventHistory(rows, tournamentId) {
  const tid = tournamentId != null ? String(tournamentId) : null;
  const at = tid ? rows.filter((r) => r.tournamentId === tid) : [];
  const last3 = at.slice(0, 3);
  const last4 = at.slice(0, 4);
  return {
    appearances: at.length,
    last4: last4.map((r) => ({ eventId: r.eventId, endDate: r.endDate, position: r.position, result: r.result, toPar: r.toPar })),
    top5Last3: last3.some((r) => isTop(r, 5)),
    top10Last3: last3.some((r) => isTop(r, 10)),
    madeCutNoTop20Last3: last3.some((r) => madeCut(r)) && !last3.some((r) => isTop(r, 20)),
    mcLast3: last3.some((r) => missedCut(r)),
    mcMostRecent: at.length ? missedCut(at[0]) : null,
    top15In2of3: last3.filter((r) => isTop(r, 15)).length >= 2,
    madeCutEachLast3: last3.length >= 3 && last3.every((r) => madeCut(r)),
  };
}

/** Opening-round scoring from the last eight starts. */
export function r1Profile(rows) {
  const opened = rows.filter((r) => isStrokePlayRound(r.rounds?.[0]) && Number.isFinite(r.par));
  const last8 = opened.slice(0, 8);
  const toPar = last8.map((r) => r.rounds[0] - r.par);
  const last5 = opened.slice(0, 5);
  return {
    rounds: last8.length,
    avgR1ToPar: last8.length >= 4 ? round(toPar.reduce((a, b) => a + b, 0) / toPar.length, 3) : null,
    fastStarts: last5.filter((r) => r.rounds[0] <= 67).length,
    fastStartSample: last5.length,
  };
}

/** Finishing record at courses of the same length class (last two years). */
export function courseClassRecord(rows, cls, asOfISO) {
  if (!cls) return { starts: 0, avgFinishPct: null, top10Rate: null };
  const at = rows.filter((r) => courseClass(r.yards) === cls && within(r, asOfISO, 730));
  if (!at.length) return { starts: 0, avgFinishPct: null, top10Rate: null };
  const pct = at.map((r) => (madeCut(r) && r.position && r.fieldSize ? r.position / r.fieldSize : 1));
  return {
    starts: at.length,
    avgFinishPct: round(pct.reduce((a, b) => a + b, 0) / pct.length, 4),
    top10Rate: round(at.filter((r) => isTop(r, 10)).length / at.length, 4),
  };
}

/** The class in which the player's top-ten rate is best (three or more starts). */
export function bestCourseClass(rows, asOfISO) {
  let best = null;
  for (const cls of ['long', 'mid', 'short']) {
    const rec = courseClassRecord(rows, cls, asOfISO);
    if (rec.starts < 3) continue;
    if (!best || rec.top10Rate > best.top10Rate) best = { cls, ...rec };
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * profile
 * ------------------------------------------------------------------ */

/**
 * Build the profile for one field member.
 * @param {object} a
 * @param {object} a.index        buildResultsIndex()
 * @param {object} a.player       field entry {athleteId, name, country, countryCode, teeTime, amateur}
 * @param {object} a.event        {id, tournamentId, startDate, purse, course:{yards,par}, tour}
 * @param {string} a.asOfISO      first day of the tournament
 * @param {object} [a.ranking]    matched OWGR row or null
 * @param {object} [a.stats]      ESPN season stat row or null
 * @param {object} [a.sg]         {app,ott,arg,putt,t2g,total} each {rank,avg,rounds} or null
 * @param {object} [a.statsDist]  {distanceQ1, distanceQ3} quartile cut-offs of yardsPerDrive across the stats table
 */
export function buildGolfProfile({ index, player, event, asOfISO, ranking = null, stats = null, sg = null, statsDist = null }) {
  const rows = historyBefore(index, player.athleteId, asOfISO);
  const form = summariseForm(rows, asOfISO, event);
  const cls = courseClass(event?.course?.yards);
  const classRec = courseClassRecord(rows, cls, asOfISO);
  const best = bestCourseClass(rows, asOfISO);
  const region = classifyRegion({ country: player.country, countryCode: player.countryCode, owgrRegion: ranking?.region ?? null });
  const dist = stats?.stats?.yardsPerDrive ?? null;
  return {
    athleteId: String(player.athleteId),
    name: player.name,
    country: player.country ?? ranking?.country ?? null,
    countryCode: player.countryCode ?? ranking?.countryCode ?? null,
    amateur: player.amateur === true,
    teeTime: player.teeTime ?? null,
    region,
    form,
    event: eventHistory(rows, event?.tournamentId),
    r1: r1Profile(rows),
    course: {
      class: cls,
      record: classRec,
      bestClass: best ? best.cls : null,
      bestClassStarts: best ? best.starts : 0,
      longCourse: cls === 'long',
      drivingDistance: dist,
      shortHitter: dist !== null && statsDist?.distanceQ1 != null ? dist <= statsDist.distanceQ1 : null,
      longHitter: dist !== null && statsDist?.distanceQ3 != null ? dist >= statsDist.distanceQ3 : null,
    },
    owgr: ranking ? {
      rank: ranking.rank, lastWeekRank: ranking.lastWeekRank ?? null, endLastYearRank: ranking.endLastYearRank ?? null,
      trajectory: ranking.lastWeekRank != null && ranking.rank != null ? ranking.lastWeekRank - ranking.rank : null,
      region: ranking.region ?? null, profileUrl: ranking.profileUrl ?? null,
    } : null,
    stats: stats ? { ...stats.stats, season: stats.season ?? null } : null,
    sg: sg || null,
    historyStarts: rows.length,
    sources: {
      espnPlayer: `https://www.espn.com/golf/player/_/id/${player.athleteId}`,
      owgr: ranking?.profileUrl ?? null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * strokes-gained coverage floor
 * ------------------------------------------------------------------ */

/**
 * The prompt ranks strokes gained WITHIN THE FIELD. When only a small share of
 * the field has a strokes-gained row (a DP World Tour field where a handful of
 * PGA TOUR members carry season averages), ranking those few against each
 * other would hand them up to thirty-three points nobody else could earn. So
 * strokes gained is scored only when at least SG_COVERAGE_FLOOR of the
 * non-amateur field is covered; below that it is missing for everyone and the
 * event-level missing[] says so (IR-GOLF-14).
 */
export const SG_COVERAGE_FLOOR = 0.5;

export function applySgCoverageFloor(profiles, { floor = SG_COVERAGE_FLOOR } = {}) {
  const scored = (profiles || []).filter((p) => p && !p.amateur);
  const matched = scored.filter((p) => p.sg && p.sg.app).length;
  if (!scored.length || matched === 0) return { profiles, suppressed: null, matched, scored: scored.length };
  if (matched / scored.length >= floor) return { profiles, suppressed: null, matched, scored: scored.length };
  return {
    profiles: profiles.map((p) => (p && p.sg ? { ...p, sg: null, sgSuppressed: true } : p)),
    suppressed: { matched, scored: scored.length, floor },
    matched,
    scored: scored.length,
  };
}

/* ------------------------------------------------------------------ *
 * field context (ranks within the field, layout facts, weather)
 * ------------------------------------------------------------------ */

function rankWithin(items, key, { asc = true } = {}) {
  const scored = items.filter((p) => Number.isFinite(key(p)));
  scored.sort((a, b) => (asc ? key(a) - key(b) : key(b) - key(a)));
  const out = new Map();
  scored.forEach((p, i) => out.set(p.athleteId, i + 1));
  return out;
}

/** Mean opening-round score to par across the most recent prior edition. */
export function priorEditionR1Mean(index, tournamentId, asOfISO) {
  const tid = tournamentId != null ? String(tournamentId) : null;
  if (!tid) return null;
  const editions = [...index.events.values()]
    .filter((e) => e.tournamentId === tid && e.endDate && e.endDate < String(asOfISO).slice(0, 10))
    .sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
  const last = editions[0];
  if (!last || !Number.isFinite(last.par)) return null;
  const vals = [];
  for (const rows of index.rowsByPlayer.values()) {
    for (const r of rows) {
      if (r.eventId === last.eventId && isStrokePlayRound(r.rounds?.[0])) vals.push(r.rounds[0] - last.par);
    }
  }
  if (vals.length < 20) return null;
  return { eventId: last.eventId, endDate: last.endDate, sample: vals.length, meanR1ToPar: round(vals.reduce((a, b) => a + b, 0) / vals.length, 3) };
}

/**
 * Field-level context. `profiles` are the built profiles of the field.
 */
export function buildFieldContext({ event, profiles, index, weather = null, asOfISO }) {
  const owgrRank = rankWithin(profiles, (p) => p.owgr?.rank ?? NaN);
  const r1Rank = rankWithin(profiles, (p) => p.r1?.avgR1ToPar ?? NaN);
  const sgAppRank = rankWithin(profiles, (p) => (p.sg?.app?.avg ?? NaN), { asc: false });
  const sgPuttRank = rankWithin(profiles, (p) => (p.sg?.putt?.avg ?? NaN), { asc: false });
  const sgT2gRank = rankWithin(profiles, (p) => (p.sg?.t2g?.avg ?? NaN), { asc: false });

  const tees = profiles.map((p) => Date.parse(p.teeTime || '')).filter(Number.isFinite).sort((a, b) => a - b);
  const medianTee = tees.length >= 6 ? tees[Math.floor(tees.length / 2)] : null;

  const regionRank = (flag) => rankWithin(profiles.filter((p) => p.region?.[flag]), (p) => p.owgr?.rank ?? NaN);
  const prior = priorEditionR1Mean(index, event?.tournamentId, asOfISO);

  return {
    asOfISO,
    tour: event?.tour ?? null,
    eventId: event?.id ?? null,
    fieldSize: profiles.length,
    courseClass: courseClass(event?.course?.yards),
    courseYards: event?.course?.yards ?? null,
    par: event?.course?.par ?? null,
    owgrInField: owgrRank,
    r1InField: r1Rank,
    r1Sample: r1Rank.size,
    sgAppInField: sgAppRank,
    sgPuttInField: sgPuttRank,
    sgT2gInField: sgT2gRank,
    sgCoverage: sgAppRank.size,
    medianTee,
    europeanRank: regionRank('european'),
    americanRank: regionRank('american'),
    britishIrishRank: regionRank('britishIrish'),
    regionCounts: {
      european: profiles.filter((p) => p.region?.european).length,
      american: profiles.filter((p) => p.region?.american).length,
      britishIrish: profiles.filter((p) => p.region?.britishIrish).length,
    },
    priorEditionR1: prior,
    layoutEarlyScoring: prior ? prior.meanR1ToPar <= -1.0 : null,
    weather: weather || null,
  };
}

/* ------------------------------------------------------------------ *
 * events, slate matching
 * ------------------------------------------------------------------ */

export function eventCoversDate(ev, dateISO) {
  const s = String(ev?.startDate || '').slice(0, 10);
  const e = String(ev?.endDate || ev?.startDate || '').slice(0, 10);
  return Boolean(s) && s <= dateISO && dateISO <= e;
}

/**
 * Events to show for a date: everything covering the date, plus (when a tour
 * has nothing that week) its next upcoming event.
 */
export function selectGolfEvents(events, dateISO, { tours = null } = {}) {
  const list = (events || []).filter((e) => !tours || tours.includes(e.tour));
  const covering = list.filter((e) => eventCoversDate(e, dateISO));
  const out = [...covering];
  const seenTours = new Set(covering.map((e) => e.tour));
  for (const tour of new Set(list.map((e) => e.tour))) {
    if (seenTours.has(tour)) continue;
    const next = list
      .filter((e) => e.tour === tour && String(e.startDate).slice(0, 10) > dateISO)
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0];
    if (next) out.push({ ...next, nextForTour: true });
  }
  return out.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

const SPONSOR_WORDS = new Set(['the', 'presented', 'by', 'pres', 'championship', 'open', 'classic', 'invitational', 'tournament', 'masters', 'cup', 'of', 'at', 'and', 'in']);

export function eventNameKey(name) {
  return normName(name).split(' ').filter((w) => w && !SPONSOR_WORDS.has(w)).join(' ');
}

/** Match an ESPN event to OLBG slate rows by name tokens. Conservative. */
export function matchGolfOlbg(event, slateDoc) {
  const rows = slateDoc?.events || [];
  const key = eventNameKey(event?.name || '');
  if (!key) return [];
  const toks = new Set(key.split(' '));
  const hits = [];
  for (const r of rows) {
    const rk = eventNameKey(r.event_name || '');
    if (!rk) continue;
    const rt = rk.split(' ');
    const shared = rt.filter((t) => toks.has(t)).length;
    if (shared >= 1 && (shared >= Math.min(2, rt.length) || rk === key)) hits.push({ ...r, matchBasis: `shared tokens: ${shared}` });
  }
  return hits;
}

export function round(n, dp = 3) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
