/**
 * SportsPred — OLBG slate view-model (pure, no I/O).
 *
 * Turns the committed data/slate.json snapshot into the structure the
 * scoreboard renders, and correlates snapshot events with the live ESPN card.
 *
 * HONESTY RULES
 *  - The snapshot carries NO odds (IR-01): OLBG publishes structured prices
 *    nowhere in server-rendered HTML. This module therefore never produces an
 *    odds field, for any event, on any code path.
 *  - Correlation with live matches is by exact normalised player-pair only.
 *    If either player name differs (spelling, doubles partner listed, TBD),
 *    the event is left unmatched — never fuzzy-matched on a hunch.
 *  - The snapshot is dated. This module reports its fetch time and resolved
 *    dates verbatim; it does not extrapolate the slate to other days.
 *  - Tipster consensus is NOT a bookmaker price and has no Step 2 factor, so
 *    it is built for display only and is never fed to the engine.
 */

import { normaliseName } from './espn.js';

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

/** Group match events by their resolved ISO date. `null`-dated events are
 *  kept under the key 'unknown' rather than guessed at. */
export function groupByDate(events) {
  const groups = new Map();
  for (const ev of events) {
    const key = ev.resolved_date || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  return groups;
}

/**
 * Correlate slate events with live scoreboard rows.
 * @param {object[]} events   rows from matchEvents()
 * @param {object[]} matches  live rows in parseCompetition shape (players[].name)
 * @returns {{ correlated: Array, unmatchedEvents: Array, unmatchedMatches: Array }}
 *   `correlated` entries are { event, live } — the original objects, annotated
 *   copies are returned so callers can render without mutating source data.
 */
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
      byPair.delete(pk); // one live match serves one slate event; a repeat is unmatched
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

/**
 * The full view-model for the scoreboard's OLBG panel.
 * @param {object} slate     parsed data/slate.json (may be null)
 * @param {object[]} matches live scoreboard rows for the selected date
 * @param {string} dateISO   the scoreboard's selected date
 */
export function buildOlbgView(slate, matches, dateISO) {
  if (!slate || !Array.isArray(slate.events)) {
    return { present: false, reason: 'no slate snapshot committed in data/' };
  }
  const events = matchEvents(slate);
  const outrights = outrightEvents(slate);
  const { correlated, unmatchedEvents } = correlateToLive(events, matches);
  const liveIds = new Set(correlated.map((c) => c.event.event_id));

  const annotated = events.map((ev) => ({
    ...ev,
    on_live_card: liveIds.has(ev.event_id),
    // Consensus for a model-excluded market (Total Games / Set Betting) is a
    // fact about the snapshot; the exclusion is stated, the market kept visible.
    model_market: slate.market_taxonomy?.mapping_to_model?.[ev.consensus?.market] ?? null,
    model_excluded: (slate.market_taxonomy?.excluded_by_model ?? []).includes(ev.consensus?.market),
  }));

  const forDate = {};
  for (const [iso, list] of groupByDate(annotated)) forDate[iso] = list;

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
      dates: Object.keys(forDate).filter((d) => d !== 'unknown').length,
    },
    events_today: forDate[dateISO] ?? [],
    events_by_date: forDate,
    outrights,
    // Stated limits of the snapshot, shown in the UI rather than implied.
    caveats: [
      'Snapshot listing: OLBG is not re-fetched from the browser; this is the committed slate.json, refreshed by scheduled collection.',
      'OLBG publishes no structured odds anywhere in server-rendered pages — no prices are shown or inferred (IR-01).',
      'The tips index lists only matches with tipster coverage; untipped matches appear on the All Events index (IR-05).',
      'Kickoff times are UK local time as rendered by OLBG (IR-10).',
      'Consensus figures are live vote counts and drift between fetches (IR-09).',
    ],
  };
}
