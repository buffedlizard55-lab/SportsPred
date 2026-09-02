/**
 * SportsPred — live golf collector (browser).
 *
 * ESPN's golf endpoints are key-less and CORS-enabled, so the visitor's browser
 * can refresh the board directly:
 *   - the season calendar + the event covering a date (site scoreboard)
 *   - the full leaderboard for an event (site.web leaderboard endpoint)
 *
 * The committed snapshots in data/ remain the fallback; this module only
 * upgrades them when the endpoints respond. Nothing is synthesised: when a
 * fetch fails the snapshot (or nothing) is used and the failure is reported.
 *
 * Responses are cached by data-client.js (localStorage, TTL by date).
 */

import {
  parseGolfScoreboard, parseLeaderboard, leaderboardToEvent, scoreboardUrl, leaderboardUrl,
} from '../../engine/golf_espn.js';
import { getJSON, ttlForDate, TTL, pool } from './data-client.js';

export const PREDICTABLE_TOURS = ['pga', 'eur'];
export const SHOW_TOURS = ['pga', 'eur', 'lpga', 'champions-tour'];

const ymd = (iso) => String(iso).replace(/-/g, '');

/** Season calendar + events covering `dateISO` for one tour. */
export async function collectTourDay(tour, dateISO) {
  const url = scoreboardUrl(tour, ymd(dateISO));
  const res = await getJSON(url, { ttl: ttlForDate(dateISO, false) });
  if (!res.data) return { tour, error: res.error || 'no data', url, calendar: [], events: [], season: null };
  const parsed = parseGolfScoreboard(res.data, { tour });
  return { tour, url, calendar: parsed.calendar, events: parsed.events, season: parsed.season, fetchedAt: res.fetchedAt };
}

/** Full leaderboard for one event, in the committed event-document shape. */
export async function collectEvent(tour, eventId, { ttl } = {}) {
  const url = leaderboardUrl(tour, eventId);
  const res = await getJSON(url, { ttl: ttl ?? TTL.TODAY });
  if (!res.data) return { error: res.error || 'no data', url };
  const lb = parseLeaderboard(res.data, { tour });
  if (!lb) return { error: 'empty leaderboard payload', url };
  return { event: leaderboardToEvent(lb, null, { fetchedAt: new Date(res.fetchedAt || Date.now()).toISOString() }), url, fetchedAt: res.fetchedAt, stale: res.stale };
}

/**
 * Everything the golf page needs for a date: calendars for every tour and the
 * events (with full fields) that cover the date, plus each tour's next event.
 */
export async function collectGolfDay(dateISO, { tours = SHOW_TOURS } = {}) {
  const days = await pool(tours, 4, (tour) => collectTourDay(tour, dateISO));
  const errors = [];
  const calendars = {};
  const wanted = [];
  for (const d of days) {
    if (!d || d.error) { if (d) errors.push({ tour: d.tour, error: d.error, url: d.url }); continue; }
    calendars[d.tour] = { season: d.season, events: d.calendar, url: d.url };
    for (const ev of d.events) wanted.push({ tour: d.tour, id: ev.id, link: ev.link });
    // Next event on this tour when nothing covers the date.
    if (!d.events.length) {
      const next = d.calendar.filter((c) => String(c.startDate).slice(0, 10) > dateISO)
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0];
      if (next) wanted.push({ tour: d.tour, id: next.id, nextForTour: true });
    }
  }
  const got = await pool(wanted, 4, async (w) => {
    const r = await collectEvent(w.tour, w.id, { ttl: ttlForDate(dateISO, false) });
    if (r.error) { errors.push({ tour: w.tour, event: w.id, error: r.error, url: r.url }); return null; }
    const ev = { ...r.event, showOnly: !PREDICTABLE_TOURS.includes(w.tour), nextForTour: w.nextForTour === true };
    // Live TTL when the event is in play.
    if (ev.state === 'in') getJSON(r.url, { ttl: TTL.LIVE }).catch(() => {});
    return ev;
  });
  const events = got.filter((e) => e && e.id);
  return { dateISO, calendars, events, errors };
}
