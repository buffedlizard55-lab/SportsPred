/**
 * SportsPred — live collector (browser).
 *
 * WHY THE BROWSER
 * ---------------
 * The project has no server and no API keys. ESPN's public tennis endpoints
 * are key-less and CORS-enabled, so the visitor's own browser can collect the
 * live slate directly. That keeps the site a static GitHub Page while still
 * showing today's real matches.
 *
 * WHAT IS COLLECTED
 *   - the day's matches (scoreboard, per date, both tours)
 *   - current ATP and WTA rankings, with trajectory
 *   - a recent-results tape used to derive form, surface splits, first-set
 *     rate, straight-set rate, rest days and head-to-head
 *
 * WHAT IS NEVER COLLECTED, AND WHY
 *   - Odds. ESPN's tennis odds collection returns zero items, and no free,
 *     key-less, cross-origin odds source was verified. Every odds-dependent
 *     factor therefore stays unsourced. See docs/IRREGULARITIES.md IR-01.
 *   - Serve percentages / ace rates. ESPN ships `statistics: []` on tennis
 *     competitors. IR-16.
 *   - Injuries and social sentiment. No free structured source. IR-13.
 *
 * Results are cached in localStorage so a reload does not re-hammer ESPN.
 */

import { parseScoreboard, parseRankings, buildPlayerStats, buildH2H, normaliseName } from '../../engine/espn.js';
import { resolveSurface, normaliseTournament } from '../../engine/surface.js';
import { codeStage, h2hForEngine } from '../../engine/tournament.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const LEAGUES = ['atp', 'wta'];

/** How far back the form tape reaches. The prompt asks for last-month form and
 *  a 12-month surface record; 120 days balances that against request count. */
export const TAPE_DAYS = 120;
const CACHE_PREFIX = 'sportspred:v3:';
const CACHE_TTL_MS = 15 * 60 * 1000; // live scores go stale quickly

/* ------------------------------------------------------------------ *
 * Fetch plumbing
 * ------------------------------------------------------------------ */

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL_MS) return null;
    return v;
  } catch { return null; }
}

function cacheSet(key, v) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v }));
  } catch { /* quota or private mode — caching is an optimisation only */ }
}

/** Fetch JSON with a timeout. Returns null on any failure; never throws. */
async function getJSON(url, { timeoutMs = 15000 } = {}) {
  const cached = cacheGet(url);
  if (cached) return cached;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    if (!r.ok) return null;
    const j = await r.json();
    cacheSet(url, j);
    return j;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run promise-returning tasks with bounded concurrency. */
async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export function yyyymmdd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function isoDate(d) { return d.toISOString().slice(0, 10); }

function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }

/* ------------------------------------------------------------------ *
 * Collection steps
 * ------------------------------------------------------------------ */

/** Matches for one calendar date (both tours). */
export async function collectDate(dateISO, surfaceMap) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  const stamp = yyyymmdd(d);
  const results = await pool(LEAGUES, 2, async (lg) => {
    const payload = await getJSON(`${SITE}/${lg}/scoreboard?dates=${stamp}`);
    if (!payload) return { league: lg, rows: [], ok: false };
    return { league: lg, rows: parseScoreboard(payload, lg), ok: true };
  });

  const seen = new Set();
  const rows = [];
  const failures = [];
  for (const r of results) {
    if (!r.ok) { failures.push(r.league); continue; }
    for (const row of r.rows) {
      // The same competition can surface under both league feeds.
      if (seen.has(row.competition_id)) continue;
      seen.add(row.competition_id);
      rows.push(attachSurface(row, surfaceMap));
    }
  }
  return { date: dateISO, rows, failures };
}

/**
 * Attach a sourced surface and coded tournament stage, or leave them null with
 * a recorded reason. Never substitutes a default for either.
 */
export function attachSurface(row, surfaceMap) {
  const res = resolveSurface(surfaceMap, row.tournament, row.tour);
  const entry = res.key ? (surfaceMap?.tournaments ?? {})[res.key] : null;
  const stage = codeStage(row.tournament, row.round, entry);
  return {
    ...row,
    surface: res.surface,
    surface_provenance: {
      reason: res.reason,
      key: res.key,
      source_matches: res.matches,
      agreement: res.agreement,
    },
    level_code: stage.level,
    round_code: stage.round,
    stage_provenance: stage.basis,
  };
}

/** Current rankings for both tours, keyed by id and by normalised name. */
export async function collectRankings() {
  const out = { byId: {}, byName: {}, tours: {}, failures: [] };
  await pool(LEAGUES, 2, async (lg) => {
    const payload = await getJSON(`${SITE}/${lg}/rankings`);
    if (!payload) { out.failures.push(lg); return; }
    const parsed = parseRankings(payload);
    out.tours[lg] = parsed.count;
    Object.assign(out.byId, parsed.byId);
    for (const [k, v] of Object.entries(parsed.byName)) {
      if (!out.byName[k]) out.byName[k] = v;
    }
  });
  return out;
}

/**
 * Build the recent-results tape. ESPN's per-date scoreboard is the cheapest
 * complete source, so the tape is assembled day by day.
 */
export async function collectTape(endISO, days = TAPE_DAYS, surfaceMap, onProgress) {
  const end = new Date(`${endISO}T12:00:00Z`);
  const dates = [];
  for (let i = 1; i <= days; i++) dates.push(isoDate(addDays(end, -i)));

  let done = 0;
  const chunks = await pool(dates, 6, async (dISO) => {
    const { rows } = await collectDate(dISO, surfaceMap);
    done++;
    if (onProgress) onProgress(done, dates.length);
    return rows.filter((r) => r.completed);
  });
  return chunks.flat();
}

/**
 * Full collection for one card date.
 * @returns {object} { date, matches, rankings, tape, stats, quality }
 */
export async function collectCard(dateISO, surfaceMap, onProgress) {
  const report = (msg, pct) => onProgress && onProgress(msg, pct);

  report('Loading rankings…', 5);
  const rankings = await collectRankings();

  report('Loading the day’s matches…', 15);
  const day = await collectDate(dateISO, surfaceMap);

  report('Building recent-form history…', 25);
  const tape = await collectTape(dateISO, TAPE_DAYS, surfaceMap, (d, t) => {
    report(`Building recent-form history… day ${d} of ${t}`, 25 + Math.round((d / t) * 65));
  });

  report('Deriving player statistics…', 92);
  const stats = {};
  for (const m of day.rows) {
    for (const p of m.players) {
      if (!p.espn_id || stats[p.espn_id]) continue;
      stats[p.espn_id] = buildPlayerStats(p.espn_id, tape, m.surface, dateISO);
    }
  }

  const quality = {
    collected_at_utc: new Date().toISOString(),
    tape_days: TAPE_DAYS,
    tape_matches: tape.length,
    ranked_players: Object.keys(rankings.byId).length,
    scoreboard_failures: day.failures,
    ranking_failures: rankings.failures,
    matches_without_surface: day.rows.filter((r) => !r.surface).length,
    // Stated explicitly so the UI can show it rather than implying completeness.
    unavailable_factors: [
      { factor: 'odds / prices', reason: 'ESPN publishes no tennis odds; no key-less cross-origin odds source verified', ref: 'IR-01' },
      { factor: 'serve %, ace rate', reason: 'ESPN returns empty competitor statistics for tennis', ref: 'IR-16' },
      { factor: 'injury reports, social sentiment', reason: 'no free structured source', ref: 'IR-13' },
    ],
  };

  report('Done', 100);
  return { date: dateISO, matches: day.rows, rankings, tape, stats, quality };
}

/**
 * Convert collected data into the engine's match input.
 * Anything unsourced is passed through as null so the engine can record it as
 * missing — this function must never substitute a default.
 */
export function toEngineMatch(m, card) {
  const { rankings, stats, tape } = card;
  const mk = (p) => {
    const r = rankings.byId[p.espn_id]
      || rankings.byName[normaliseName(p.name)]
      || null;
    const s = stats[p.espn_id] || {};
    return {
      name: p.name,
      espn_id: p.espn_id,
      rank: r?.rank ?? null,
      rankTrajectory: r?.trajectory ?? null,
      odds: null,          // never sourced — see IR-01
      firstSetOdds: null,
      handicapOdds: null,
      form: s.form ?? null,
      surface: s.surface ?? null,
      serve: s.serve ?? null, // always null — see IR-16
      rest: s.rest ?? null,
      sampleSizes: s.sampleSizes ?? null,
    };
  };

  const [a, b] = m.players.map(mk);
  let opponentRank = null;
  if (a.rank != null && b.rank != null) opponentRank = a.rank <= b.rank ? b.rank : a.rank;
  else opponentRank = b.rank ?? a.rank ?? null;

  const rawH2H = a.espn_id && b.espn_id ? buildH2H(a.espn_id, b.espn_id, tape, m.surface) : null;

  return {
    event_id: m.competition_id,
    players: [a, b],
    surface: m.surface,
    // Coded level/round; null when the stage could not be established.
    tournament: (m.level_code || m.round_code)
      ? { level: m.level_code, round: m.round_code, name: m.tournament, roundLabel: m.round }
      : null,
    h2h: h2hForEngine(rawH2H, a.rank, b.rank),
    opponentRank,
    url: m.source_url,
    display: `${m.date} ${(m.start_utc || '').slice(11, 16)} UTC`,
    resolved_date: m.date,
    home: a.name,
    away: b.name,
    // carried through for the scoreboard UI
    _raw: m,
  };
}
