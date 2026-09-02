/**
 * SportsPred — live browser collection for greyhounds (no key).
 *
 * The GBGB results API is key-less and CORS-enabled, so the page can refresh
 * the day's meetings straight from the official source when the browser allows
 * it. Every call resolves to { ok, data, error } and never throws; the page
 * falls back to the committed JSON on failure and labels the data source.
 */

import { getJSON, pool } from './data-client.js';
import { parseMeetingPayload, parseDogHistory, GBGB_API_BASE } from '../../engine/greyhound_gbgb.js';

async function getJsonData(url, ttl) {
  const res = await getJSON(url, { ttl, allowStale: false, timeoutMs: 15000 });
  if (res?.error) return { ok: false, error: res.error };
  return { ok: true, data: res?.data ?? null, fromCache: !!res.fromCache };
}

/** Day index -> distinct meeting ids (empty list on failure). */
export async function liveMeetingIds(dateISO) {
  const ids = new Set();
  for (let page = 1; page <= 10; page += 1) {
    const r = await getJsonData(`${GBGB_API_BASE}/results?page=${page}&itemsPerPage=200&date=${dateISO}&race_type=race`, 60 * 1000);
    const doc = r.data;
    if (!doc?.items) break;
    for (const row of doc.items) if (row?.meetingId != null) ids.add(Number(row.meetingId));
    const meta = doc.meta || {};
    if (!meta.pageCount || page >= meta.pageCount || doc.items.length === 0) break;
  }
  return [...ids];
}

/** Fetch and parse full meeting payloads for a date, live from the GBGB API. */
export async function collectGreyhoundDay(dateISO) {
  const ids = await liveMeetingIds(dateISO);
  const results = await pool(ids, 4, async (id) => {
    const r = await getJsonData(`${GBGB_API_BASE}/results/meeting/${id}`, 60 * 1000);
    return r.ok ? r.data : null;
  });
  const payloads = results.filter(Boolean);
  const races = payloads.flatMap((p) => parseMeetingPayload(p));
  return { meetingIds: ids, races, source: 'live-gbgb', meetings: payloads.length };
}

/** Fetch one dog's parsed history live (used to top up a missing runner). */
export async function collectDogHistory(dogId) {
  const r = await getJsonData(`${GBGB_API_BASE}/results/dog/${dogId}?page=1&itemsPerPage=60`, 30 * 60 * 1000);
  if (!r.ok || !r.data) return [];
  return parseDogHistory(r.data);
}
