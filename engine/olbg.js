/**
 * SportsPred — OLBG slate helpers and view-model (pure, no I/O).
 *
 * The live scoreboard comes from ESPN. OLBG is a secondary source used for the
 * upcoming market slate, consensus labels and per-event market verification
 * where event pages have been fetched.
 *
 * HONESTY RULES
 *  - The snapshot carries NO structured odds (IR-01). This module never emits
 *    price fields on any code path.
 *  - Correlation with live matches is by exact normalised player pair only.
 *  - Snapshot dates are reported verbatim; nothing is extrapolated.
 *  - Tipster consensus is display-only and is never fed into model scoring.
 */

import { normaliseName } from './espn.js';

function toMinutes(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return Number.POSITIVE_INFINITY;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function byDateTime(a, b) {
  const da = `${a?.resolved_date ?? ''} ${a?.display_time ?? ''}`;
  const db = `${b?.resolved_date ?? ''} ${b?.display_time ?? ''}`;
  if (da < db) return -1;
  if (da > db) return 1;
  return 0;
}

/** Order-independent identity for a two-player fixture. null if a name is empty. */
export function pairKey(aName, bName) {
  const a = normaliseName(aName);
  const b = normaliseName(bName);
  if (!a || !b) return null;
  return [a, b].sort().join(' v ');
}

/** The snapshot's match events, excluding outrights. Defensive copy. */
export function matchEvents(slate) {
  return (slate?.events ?? []).filter((e) => e && e.home && e.away).map((e) => ({ ...e }));
}

/** Outright/tournament markets, which the three-market model never scores. */
export function outrightEvents(slate) {
  return (slate?.outrights ?? []).map((e) => ({ ...e }));
}

/** Group match events by resolved date; unknown dates stay under 'unknown'. */
export function groupByDate(events) {
  const groups = new Map();
  for (const ev of events ?? []) {
    const key = ev?.resolved_date || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  return groups;
}

/** Correlate OLBG match rows with live scoreboard rows by exact player pair. */
export function correlateToLive(events, matches) {
  const byPair = new Map();
  const unmatchedMatches = [];
  for (const m of matches ?? []) {
    const pk = m?.players?.length === 2 ? pairKey(m.players[0].name, m.players[1].name) : null;
    if (!pk) { unmatchedMatches.push(m); continue; }
    if (!byPair.has(pk)) byPair.set(pk, m);
  }
  const correlated = [];
  const unmatchedEvents = [];
  for (const ev of events ?? []) {
    const pk = pairKey(ev.home, ev.away);
    const live = pk ? byPair.get(pk) : null;
    if (live) {
      correlated.push({ event: { ...ev }, live, competition_id: live.competition_id ?? null });
      byPair.delete(pk);
    } else {
      unmatchedEvents.push({ ...ev });
    }
  }
  return {
    correlated,
    unmatchedEvents,
    unmatchedMatches: [...byPair.values(), ...unmatchedMatches],
  };
}

/** Full snapshot-vs-live view-model, kept for backward compatibility/tests. */
export function buildOlbgView(slate, matches, dateISO) {
  if (!slate || !Array.isArray(slate.events)) {
    return { present: false, reason: 'no slate snapshot committed in data/' };
  }
  const events = matchEvents(slate);
  const outrights = outrightEvents(slate);
  const { correlated } = correlateToLive(events, matches);
  const liveIds = new Set(correlated.map((c) => c.event.event_id));

  const annotated = events.map((ev) => ({
    ...ev,
    on_live_card: liveIds.has(ev.event_id),
    model_market: slate.market_taxonomy?.mapping_to_model?.[ev.consensus?.market] ?? null,
    model_excluded: (slate.market_taxonomy?.excluded_by_model ?? []).includes(ev.consensus?.market),
  }));

  const eventsByDate = {};
  for (const [iso, list] of groupByDate(annotated)) eventsByDate[iso] = list;

  return {
    present: true,
    date: dateISO,
    fetched_at_utc: slate.source?.fetched_at_utc ?? null,
    source_url: slate.source?.url ?? null,
    source_name: slate.source?.name ?? 'OLBG',
    totals: {
      events: events.length,
      outrights: outrights.length,
      on_current_card: annotated.filter((e) => e.on_live_card).length,
      dates: Object.keys(eventsByDate).filter((d) => d !== 'unknown').length,
    },
    events_today: eventsByDate[dateISO] ?? [],
    events_by_date: eventsByDate,
    outrights,
    caveats: [
      'Snapshot listing: OLBG is not re-fetched from the browser; this is the committed slate.json, refreshed by scheduled collection.',
      'OLBG publishes no structured odds anywhere in server-rendered pages — no prices are shown or inferred (IR-01).',
      'The tips index lists only matches with tipster coverage; untipped matches appear on the All Events index (IR-05).',
      'Kickoff times are UK local time as rendered by OLBG (IR-10).',
      'Consensus figures are live vote counts and drift between fetches (IR-09).',
    ],
  };
}

/** Unique OLBG dates present in the snapshot, sorted ascending. */
export function olbgDates(slate) {
  const dates = new Set();
  for (const row of [...(slate?.events ?? []), ...(slate?.outrights ?? [])]) {
    if (row?.resolved_date) dates.add(row.resolved_date);
  }
  return [...dates].sort();
}

/** Snapshot match rows for one ISO date. */
export function olbgEventsForDate(slate, dateISO) {
  return (slate?.events ?? [])
    .filter((row) => row?.resolved_date === dateISO)
    .slice()
    .sort(byDateTime);
}

/** Snapshot outright rows for one ISO date. */
export function olbgOutrightsForDate(slate, dateISO) {
  return (slate?.outrights ?? [])
    .filter((row) => row?.resolved_date === dateISO)
    .slice()
    .sort(byDateTime);
}

/** Match + outright counts keyed by resolved date. */
export function olbgDateCounts(slate) {
  const map = new Map();
  for (const row of slate?.events ?? []) {
    if (!row?.resolved_date) continue;
    const rec = map.get(row.resolved_date) ?? { matches: 0, outrights: 0 };
    rec.matches += 1;
    map.set(row.resolved_date, rec);
  }
  for (const row of slate?.outrights ?? []) {
    if (!row?.resolved_date) continue;
    const rec = map.get(row.resolved_date) ?? { matches: 0, outrights: 0 };
    rec.outrights += 1;
    map.set(row.resolved_date, rec);
  }
  return map;
}

/** Counts of consensus-market labels on the filtered rows. */
export function consensusMarketCounts(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const market = row?.consensus?.market;
    if (!market) continue;
    counts.set(market, (counts.get(market) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([market, count]) => ({ market, count }));
}

/** Counts of verified event-page market names on the filtered match rows. */
export function verifiedMarketCounts(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    for (const market of row?.markets_on_event_page ?? []) {
      counts.set(market, (counts.get(market) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([market, count]) => ({ market, count }));
}

/** Summary of what the OLBG snapshot actually exposes on one date. */
export function olbgSummaryForDate(slate, dateISO) {
  const events = olbgEventsForDate(slate, dateISO);
  const outrights = olbgOutrightsForDate(slate, dateISO);
  const verifiedEventPages = events.filter((row) => row?.markets_verified === true).length;
  const withGamesWonSelections = events.filter((row) => {
    const list = row?.games_won_selections ?? row?.event_page_extras?.games_won_selections ?? [];
    return Array.isArray(list) && list.length;
  }).length;
  return {
    date: dateISO,
    matches: events.length,
    outrights: outrights.length,
    verifiedEventPages,
    unverifiedEventPages: events.length - verifiedEventPages,
    withGamesWonSelections,
    withoutGamesWonSelections: events.length - withGamesWonSelections,
    consensusMarkets: consensusMarketCounts(events),
    verifiedMarkets: verifiedMarketCounts(events),
  };
}

/** Nearest previous/next OLBG date relative to a selected date. */
export function adjacentOlbgDates(slate, selectedDate) {
  const dates = olbgDates(slate);
  let prev = null;
  let next = null;
  for (const d of dates) {
    if (d < selectedDate) prev = d;
    if (d > selectedDate) { next = d; break; }
  }
  return { prev, next, dates };
}

/** Sort helper exported for tests/UI parity. */
export function olbgSortKey(row) {
  return {
    date: row?.resolved_date ?? '',
    minutes: toMinutes(row?.display_time ?? null),
  };
}
