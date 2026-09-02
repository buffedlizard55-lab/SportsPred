/**
 * SportsPred — Formula 1 data plumbing (pure).
 *
 * Joins events/standings/OLBG slate/circuit metadata into the shapes the F1
 * engine scores. No I/O, no guessing: anything not sourced stays null and the
 * engine records it in `missing[]`.
 */

import { parseF1Scoreboard } from './f1_espn.js';

/**
 * Title sponsors in the ESPN 2026 calendar labels (verified 2026-09-02).
 * Removed before deriving a circuit key from a name; the canonical key is the
 * ESPN event abbreviation when present (ITA, NLD, ...), which the collector
 * fills from the standings per-race mapping.
 */
export const SPONSOR_PREFIXES = [
  'Qatar Airways', 'Heineken', 'Aramco', 'Gulf Air', 'STC', 'Crypto.com',
  'Lenovo', 'MSC Cruises', 'Moët & Chandon', 'Pirelli', 'Tag Heuer',
  'Singapore Airlines', 'Etihad Airways', 'Formula 1',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Canonical circuit key: ESPN abbreviation (ITA, NLD, MON...) with name fallback. */
export function circuitKey(event) {
  if (event?.abbreviation) return event.abbreviation;
  const name = String(event?.name || '').trim();
  const m = name.match(/([A-Za-zÀ-ÿ0-9\-']+?)\s+Grand Prix$/i);
  if (m) {
    let stem = m[1].trim().replace(/^(The|of)\s+/i, '');
    for (const sp of SPONSOR_PREFIXES) {
      stem = stem.replace(new RegExp(`^${escapeRe(sp)}\\s+`, 'i'), '');
    }
    return stem.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }
  return null;
}

function isoOf(s) {
  return String(s || '').slice(0, 10);
}

/** Completed results across events, most recent first. */
export function raceLog(events) {
  const rows = [];
  for (const ev of events || []) {
    const r = ev?.race;
    if (!r || !r.completed || !Array.isArray(r.result)) continue;
    for (const row of r.result) {
      rows.push({
        eventId: ev.id,
        eventName: ev.name,
        circuit: ev.abbreviation || circuitKey(ev),
        raceDate: ev.raceDate || ev.endDate,
        ...row,
      });
    }
  }
  rows.sort((a, b) => String(b.raceDate).localeCompare(String(a.raceDate)));
  return rows;
}

/** Rows for one athlete, most recent first, filtered before `asOfISODate`. */
export function driverRows(rows, athleteId, asOfISODate) {
  return rows.filter((r) => String(r.athleteId) === String(athleteId) &&
    (!asOfISODate || String(r.raceDate).slice(0, 10) < String(asOfISODate).slice(0, 10)));
}

/** Average of a numeric list, or null when empty. */
export function avg(nums) {
  const n = (nums || []).filter((x) => Number.isFinite(x));
  if (!n.length) return null;
  return n.reduce((a, b) => a + b, 0) / n.length;
}

function outqualifiedCount(rows) {
  // rows are per-race entries with grid & team (already teammate-resolved)
  let n = 0;
  let total = 0;
  for (const r of rows) {
    if (r.grid == null || r.teammateGrid == null) continue;
    total += 1;
    if (r.grid < r.teammateGrid) n += 1;
  }
  return { n, total };
}

/**
 * Build a driver profile (form/qualifying/track tape) used by the engine.
 *
 * `asOfISODate` excludes any completed race that happens on/after it, so a
 * prediction for the Italian GP never uses the Italian GP itself.
 */
export function buildDriverProfile(rows, standing, asOfISODate) {
  const mine = driverRows(rows, standing?.id, asOfISODate);
  const last5 = mine.slice(0, 5);
  const grid3 = last5.filter((r) => r.grid != null).slice(0, 3);
  const teammateGrids = rows.filter((r) => r.grid != null && r.team && r.team === standing?.team);
  // Resolve teammate grid per race for outqualified statistics.
  const byRace = new Map();
  for (const r of teammateGrids) {
    if (r.grid == null) continue;
    const k = r.eventId;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k).push(r);
  }
  const outq = [];
  for (const r of mine) {
    if (r.grid == null || !byRace.has(r.eventId)) continue;
    const others = byRace.get(r.eventId).filter((x) => String(x.athleteId) !== String(r.athleteId));
    const mate = others[0];
    if (mate) outq.push({ ...r, teammateGrid: mate.grid, teammateName: mate.name });
  }
  const q = outqualifiedCount(outq);

  return {
    athleteId: String(standing?.id ?? standing?.athleteId ?? ''),
    name: standing?.name || standing?.name || null,
    team: standing?.team || null,
    championshipRank: standing?.rank ?? null,
    championshipPoints: standing?.points ?? null,
    topFinish: standing?.topFinish ?? null,
    last5: last5.map((r) => ({
      eventId: r.eventId,
      eventName: r.eventName,
      circuit: r.circuit,
      raceDate: r.raceDate,
      position: r.position,
      grid: r.grid,
      dnf: r.dnf,
      pointsEarned: r.pointsEarned,
      team: r.team,
    })),
    last5Wins: last5.filter((r) => r.position === 1).length,
    last5Podiums: last5.filter((r) => r.position >= 1 && r.position <= 3).length,
    last5Points: last5.filter((r) => r.position >= 1 && r.position <= 10).length,
    last5Scored: last5.filter((r) =>
      (r.pointsEarned != null && r.pointsEarned > 0) ||
      (r.position != null && r.position <= 10)).length,
    last5Dnf: last5.filter((r) => r.dnf === true).length,
    last5KnownDnf: last5.filter((r) => r.dnf != null).length,
    gridLast5: grid3.map((r) => ({
      grid: r.grid, mateGrid: r.teammateGrid, raceDate: r.raceDate, eventName: r.eventName,
      outqualified: r.teammateGrid == null ? null : r.grid < r.teammateGrid,
    })),
    outqualified: { wins: q.n, total: q.total },
    avgGrid: avg(grid3.map((r) => r.grid)),
    // ESPN's `pole` stat is a qualifying POSITION, not a flag, so the boolean
    // `polePosition` is what the engine consumes. Comparing the raw number
    // against `true` silently scored zero and never registered as missing.
    poleLastRace: last5[0] == null
      ? null
      : (last5[0].polePosition ?? (last5[0].pole == null ? null : last5[0].pole === 1)),
    gridLastRace: last5[0]?.pole ?? null,
    fastestLapAtCircuit: null, // filled by engine from circuit history
    // track under analysis is filled by buildTrackTape
    track: null,
    circuitHistory: [],
  };
}

/**
 * Track-specific tape for one circuit: rows from the last 3 runnings before
 * `asOfISODate`. Rows are per-driver, so we group by race date, take the last
 * three dates, then return every row in those races (so per-driver lookups
 * never lose a driver inside a running).
 */
export function trackTape(rows, circuit, asOfISODate) {
  const byDate = new Map();
  for (const r of rows) {
    if (r.circuit !== circuit) continue;
    const d = String(r.raceDate || '').slice(0, 10);
    if (!d || (asOfISODate && d >= String(asOfISODate).slice(0, 10))) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  const dates = [...byDate.keys()].sort().reverse().slice(0, 3);
  const out = [];
  for (const d of dates) out.push(...byDate.get(d));
  return out;
}

/** Attach a driver's track tape + derived track score inputs. */
export function withTrack(profile, rows, circuit, asOfISODate) {
  const tape = trackTape(rows, circuit, asOfISODate);
  const mine = tape.filter((r) => String(r.athleteId) === String(profile.athleteId));
  const p = { ...profile, track: tape, circuitHistory: mine };
  p.trackWins = mine.filter((r) => r.position === 1).length;
  p.trackPodiums = mine.filter((r) => r.position >= 1 && r.position <= 3).length;
  p.trackPoints = mine.filter((r) => r.position >= 1 && r.position <= 10).length;
  p.trackLast3 = mine.map((r) => ({ raceDate: r.raceDate, eventName: r.eventName, position: r.position }));
  p.fastestLapHistory = tape.filter((r) =>
    r.fastestLap === true || r.setFastestLap === true).map((r) => ({ raceDate: r.raceDate, eventName: r.eventName }));
  return p;
}

/** Match OLBG F1 market rows to a race by normalised race name. */
export function matchF1Olbg(event, slateDoc) {
  const base = String(event?.name || '').toLowerCase();
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const evName = slug(base.replace(/^.*?grand prix/i, '')).slice(0, 40);
  const evCircuit = slug(`${event?.abbreviation || ''}`).trim();
  const rows = slateDoc?.events || [];
  const matches = rows.filter((r) => {
    const rn = slug(r?.event_name || r?.name || '');
    return rn && evName && (rn.includes(evName) || evName.includes(rn));
  });
  return matches.length ? matches : rows.filter((r) => {
    const rn = slug(r?.event_name || r?.name || '');
    return rn && evCircuit && rn.includes(evCircuit);
  });
}

/** Exported for tests: parse a committed f1_events.json document. */
export function parseEventsDoc(doc) {
  return {
    schemaVersion: doc?.schema_version ?? null,
    season: doc?.season ?? null,
    fetchedAtUtc: doc?.fetched_at_utc ?? null,
    circuits: doc?.circuits || {},
    events: doc?.events || [],
    source: doc?.source || null,
  };
}

/** Stats counters for a built card (for tests/UI). */
export function cardCounts(card) {
  const events = card?.events || [];
  return {
    total: events.length,
    upcoming: events.filter((e) => e.state === 'pre').length,
    live: events.filter((e) => e.state === 'live').length,
    completed: events.filter((e) => e.state === 'post').length,
  };
}
