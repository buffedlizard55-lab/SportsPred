/**
 * SportsPred — pure helpers for the OLBG slate snapshot.
 *
 * The live scoreboard comes from ESPN. OLBG is a secondary source used for the
 * upcoming market slate, consensus labels and per-event market verification
 * where event pages have been fetched. These helpers keep that logic out of the
 * DOM so it can be tested.
 */

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
