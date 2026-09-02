/**
 * SportsPred — Formula 1 card builder (pure).
 *
 * Turns the committed data layer (events + standings + OLBG slate + weather)
 * into a scored and written race card exactly like the other sports' data
 * modules. Used by the site controller and by the Node test suite.
 */

import { raceLog, buildDriverProfile, withTrack, circuitKey, matchF1Olbg } from './f1_data.js';
import {
  scoreF1Race, scoreF1Card,
  HIGH_SC_FREQUENCY_CIRCUITS, LOW_OVERTAKING_CIRCUITS, POWER_SENSITIVE_CIRCUITS,
} from './f1_engine.js';
import { writeF1RaceCard, buildF1CardText, validateF1Card } from './f1_writer.js';

function isoOf(s) {
  return String(s || '').slice(0, 10);
}

/** True when the event weekend covers the date (Fri → Sun, incl. Thu). */
export function eventCoversDate(ev, dateISO) {
  const d = isoOf(dateISO);
  return d >= isoOf(ev?.startDate) && d <= isoOf(ev?.endDate);
}

/** Nearest event for a date: event covering it, else next/prev. */
export function selectF1Event(events, dateISO) {
  const list = [...(events || [])].filter((e) => e?.startDate);
  list.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const covering = list.find((e) => eventCoversDate(e, dateISO));
  if (covering) return { event: covering, note: 'weekend' };
  let prev = null;
  let next = null;
  for (const e of list) {
    if (isoOf(e.endDate) < dateISO) prev = e;
    if (isoOf(e.startDate) > dateISO) { next = e; break; }
  }
  return { event: next || prev || null, prev, next };
}

/** Per-race constructor points history, keyed by team name, newest last. */
export function teamPerRaceMap(standingsDoc, eventsDoc) {
  const out = {};
  const dateByEvent = new Map();
  for (const ev of eventsDoc?.events || []) dateByEvent.set(String(ev.id), ev?.startDate || ev?.raceDate || '');
  for (const team of standingsDoc?.constructors || []) {
    const rows = Object.entries(team?.perRace || {})
      .map(([eventId, r]) => ({
        eventId,
        date: dateByEvent.get(String(eventId)) || '',
        points: r?.points ?? null,
        played: r?.played === true,
      }))
      .filter((r) => r.played)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    out[team.name] = rows;
  }
  return out;
}

function leaderPoints(standingsDoc) {
  const pts = (standingsDoc?.drivers || []).map((d) => d.points).filter((x) => Number.isFinite(x));
  return pts.length ? Math.max(...pts) : null;
}

/** Per-team race-by-race points from completed results (most recent last). */
export function teamRowsMap(rows, asOfISODate) {
  const out = {};
  for (const r of rows) {
    if (!r.team || r.pointsEarned == null) continue;
    const iso = String(r.raceDate || '').slice(0, 10);
    if (asOfISODate && iso >= String(asOfISODate).slice(0, 10)) continue;
    if (!out[r.team]) out[r.team] = [];
    out[r.team].push({ date: iso, points: r.pointsEarned, eventId: r.eventId });
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  return out;
}

function constructorsTop3(standingsDoc, team) {
  const rank = (standingsDoc?.constructors || []).find((c) => c.name === team)?.rank ?? null;
  return rank != null && rank <= 3;
}

/** Build the engine context (ctx) for one event. */
export function buildF1Ctx(event, standingsDoc, eventsDoc, weatherDoc) {
  const teamPer = teamPerRaceMap(standingsDoc, eventsDoc);
  const weather = weatherDoc?.events?.[event?.id] || weatherDoc?.events?.[String(event?.id)] || null;
  // Grid: qualifying order if held, else race start order (past), else null.
  let grid = null;
  const qual = (event?.sessions || []).find((s) => s.type === 'Qualifying' && s.completed);
  const race = event?.race;
  if (qual && qual.competitors?.length) {
    grid = qual.competitors
      .map((c) => ({ athleteId: c.athleteId, name: c.name, grid: c.order }))
      .filter((c) => c.grid != null)
      .sort((a, b) => a.grid - b.grid);
  } else if (race?.completed && race?.grid?.length) {
    grid = race.grid.map((c) => ({ athleteId: c.athleteId, name: c.name, grid: c.grid }));
  }
  const circuit = event?.abbreviation || circuitKey(event);
  const sessions = event?.sessions || [];
  return {
    circuit,
    // Prompt-named circuit classifications (IR-F1-06: classifications, not
    // measured metrics). Null when the circuit code is unknown, so the engine
    // records the gap instead of assuming "not a street circuit".
    highSafetyCar: circuit ? HIGH_SC_FREQUENCY_CIRCUITS.has(circuit) : null,
    lowOvertaking: circuit ? LOW_OVERTAKING_CIRCUITS.has(circuit) : null,
    powerSensitive: circuit ? POWER_SENSITIVE_CIRCUITS.has(circuit) : null,
    // Sprint weekends run a separate Sprint Shootout; the prompt asks that the
    // format be noted because the two qualifying sessions differ in what they
    // predict for race day.
    isSprintWeekend: sessions.some((s) => s.type === 'Sprint' || s.type === 'Sprint Shootout'),
    leaderPoints: leaderPoints(standingsDoc),
    teamPerRace: teamPer,
    grid,
    weatherPrecipPct: weather?.precipProbPct ?? null,
    weather,
  };
}

/** Build a fully scored and written card for one race event. */
export function buildF1RaceCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, eventId) {
  const events = eventsDoc?.events || [];
  const event = events.find((e) => String(e.id) === String(eventId));
  if (!event) {
    return { event: null, scored: null, written: null, error: `event ${eventId} not in events layer` };
  }

  const asOf = isoOf(event.startDate);
  const rows = raceLog(events);
  // Driver team comes from the most recent sourced race result; standings do
  // not publish team names, so this is the only sourced way to get it.
  const teamByDriver = new Map();
  for (const r of rows) {
    if (r.team && !teamByDriver.has(String(r.athleteId))) teamByDriver.set(String(r.athleteId), r.team);
  }
  const profiles = new Map();
  for (const standing of standingsDoc?.drivers || []) {
    const team = standing?.team || teamByDriver.get(String(standing.id)) || null;
    const base = buildDriverProfile(rows, { ...standing, team }, asOf);
    const profile = withTrack(base, rows, event?.abbreviation || circuitKey(event), asOf);
    profile.team = team;
    if (profile.last5?.length || profile.circuitHistory?.length || profile.championshipRank != null) {
      profiles.set(String(standing.id), profile);
    }
  }

  const ctx = { ...buildF1Ctx(event, standingsDoc, eventsDoc, weatherDoc), teamRows: teamRowsMap(rows, asOf) };
  const scored = scoreF1Race(event, profiles, ctx);
  const written = writeF1RaceCard(scored, {
    ...event,
    weather: ctx.weather,
  });
  const validation = validateF1Card(written);
  const olbg = matchF1Olbg(event, slateDoc);

  return {
    event: { ...event, olbg, weather: ctx.weather },
    profiles,
    ctx,
    scored,
    written,
    validation,
    formattedText: buildF1CardText(written, { ...event, weather: ctx.weather }),
  };
}

/** Build a card for a date: pick the covering/nearest event. */
export function buildF1DateCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, dateISO) {
  const sel = selectF1Event(eventsDoc?.events || [], dateISO);
  const card = sel.event ? buildF1RaceCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, sel.event.id) : null;

  const all = (eventsDoc?.events || []).filter((e) => e?.startDate)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  // "Upcoming" must be genuinely ahead of the date being viewed. Selecting the
  // first event still flagged 'pre' picked up races that have already been run
  // but which ESPN never classified (IR-F1-03) — so an April race showed as
  // next up in September.
  const upcoming = all.find((e) => e.state === 'pre' && isoOf(e.endDate) >= isoOf(dateISO));
  const lastCompleted = [...all].reverse().find((e) => e.state === 'post');
  // Finished races carrying no published classification, so a reviewer can see
  // why they are absent from both the results list and the upcoming slot.
  const unresolved = all.filter((e) => e.resultUnavailable === true && isoOf(e.endDate) < isoOf(dateISO));

  return {
    date: dateISO,
    sport: 'Formula 1',
    ...sel,
    card,
    upcoming,
    lastCompleted,
    unresolved,
    neighbors: { prev: sel.prev, next: sel.next },
  };
}

/** Score every event (used by backtests). */
export function buildF1Season(eventsDoc, standingsDoc, slateDoc, weatherDoc) {
  const results = [];
  for (const event of eventsDoc?.events || []) {
    const card = buildF1RaceCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, event.id);
    if (card?.scored) results.push({ event: card.event, scored: card.scored, written: card.written });
  }
  return { results };
}
