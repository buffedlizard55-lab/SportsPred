/**
 * SportsPred — Greyhound card builder.
 *
 * Joins committed GBGB documents into scored, written cards. Pure: the caller
 * supplies every document; nothing is fetched here.
 *
 *   data/greyhound_meetings.json  meeting documents (/results/meeting/{id}),
 *                                 normalised or raw, per raceday
 *   data/greyhound_history.json   dogId -> parsed run history (newest first)
 *   data/greyhound_slate.json     OLBG greyhound slate (display only, never scored)
 *
 * The same builder scores scheduled cards (live=true, odds component missing)
 * and settled races (live=false uses official SP in the odds tier).
 */

import { parseMeetingPayload, parseDogHistory } from './greyhound_gbgb.js';
import { enrichRace, formString } from './greyhound_data.js';
import { scoreRace, buildDailyCard } from './greyhound_engine.js';
import { writeGreyhoundCard, validateGreyhoundCard } from './greyhound_writer.js';

/** Extract normalised races from a meetings document (raw or normalised). */
export function racesFromDoc(meetingsDoc) {
  if (!meetingsDoc) return [];
  if (Array.isArray(meetingsDoc.races)) return meetingsDoc.races;
  if (Array.isArray(meetingsDoc.meetings)) {
    const raw = [];
    for (const m of meetingsDoc.meetings) {
      if (Array.isArray(m?.races)) raw.push(m);
      else if (Array.isArray(m?.payload)) raw.push(...(Array.isArray(m.payload) ? m.payload : [m.payload]));
    }
    return parseMeetingPayload(raw.length ? raw : meetingsDoc.meetings);
  }
  if (Array.isArray(meetingsDoc.payload)) return parseMeetingPayload(meetingsDoc.payload);
  return [];
}

/** Build a dogId -> parsed-history map from a history document.
 *  Accepts the committed { dogs: { id: { runs } } } shape, a flat array of
 *  { dogId, runs } rows, or raw API payloads with .items. */
export function historyIndex(historyDoc) {
  const map = new Map();
  const rows = historyDoc?.dogs || historyDoc || {};
  const entries = Array.isArray(rows)
    ? rows.map((d) => [String(d.dogId), d.runs || d.history || d])
    : Object.entries(rows);
  for (const [id, payload] of entries) {
    let runs = [];
    if (Array.isArray(payload)) runs = payload;
    else if (Array.isArray(payload?.runs)) runs = payload.runs;
    else if (payload?.items) runs = parseDogHistory(payload);
    map.set(String(id), runs);
  }
  return map;
}

/**
 * Build the scored + written card for one raceday (or the supplied races).
 * @param {object} docs { meetingsDoc, historyDoc, slateDoc }
 * @param {object} opts { date, asOfISO, live }
 */
export function buildGreyhoundDayCard(docs, opts = {}) {
  const allRaces = racesFromDoc(docs.meetingsDoc);
  const history = docs.historyIndex || historyIndex(docs.historyDoc);
  const date = opts.date || opts.asOfISO || null;
  const races = (date ? allRaces.filter((r) => r.date === date) : allRaces)
    .filter((r) => Array.isArray(r.runners) && r.runners.length >= 2)
    .map((r) => enrichRace(r, history))
    .map((r) => scoreRace(r, { live: opts.live === undefined ? r.status !== 'result' : opts.live }))
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));

  const card = buildDailyCard(races);
  const written = writeGreyhoundCard(card, { date });
  const validation = validateGreyhoundCard(written);
  return { date, races: card.races, picks: card.picks, written, validation, trackCount: card.trackCount };
}

/** Settle a scored race: returns the outcome for the written selection. */
export function settleRace(scored) {
  if (scored.status !== 'result' || !scored.winner) {
    return { raceId: scored.raceId, status: scored.status, settled: false };
  }
  const selectedDogId = scored.winner.dogId;
  const position = findPosition(scored, selectedDogId);
  return {
    raceId: scored.raceId,
    track: scored.track,
    time: scored.time,
    selection: scored.winner?.name ?? null,
    confidence: scored.decision?.confidence ?? null,
    selectedPosition: position,
    won: position === 1,
    sp: findSP(scored, selectedDogId),
    settled: true,
  };
}

function findPosition(scored, dogId) {
  const raceRunner = (scored.runners || []).find((r) => String(r.dogId) === String(dogId));
  return raceRunner ? (raceRunner.position ?? null) : null;
}
function findSP(scored, dogId) {
  const raceRunner = (scored.runners || []).find((r) => String(r.dogId) === String(dogId));
  return raceRunner?.sp ?? null;
}

export { formString };
