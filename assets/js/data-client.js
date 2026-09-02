/**
 * SportsPred — browser data client.
 *
 * WHY THIS EXISTS (performance)
 * -----------------------------
 * The first version of this site rebuilt its historical dataset on every page
 * load, which is what made it slow. This client fixes that three ways:
 *
 *  1. STATIC PRECOMPUTE. The per-league baseline (home-win rate, draw rate,
 *     mean total) is measured once in CI and committed to
 *     data/league_context.json. The browser reads one small file instead of
 *     scanning two months of fixtures on every visit.
 *  2. PERSISTENT CACHE. Every network response is cached in localStorage with
 *     a TTL chosen by how volatile the data is. A revisit inside the TTL costs
 *     zero requests, and the cache survives a reload.
 *  3. SINGLE-FLIGHT + STALE-WHILE-REVALIDATE. Concurrent callers for the same
 *     URL share one request; an expired entry is served immediately and
 *     refreshed in the background so the UI never blocks on the network.
 *
 * HONESTY
 * -------
 * Every returned payload carries `fetchedAt`, `stale` and `sourceUrl`, and the
 * UI displays them. A cached value is never presented as live.
 */

const MEM = new Map();          // url -> { data, fetchedAt }
const INFLIGHT = new Map();     // url -> Promise
const LS_PREFIX = 'sp2:';
const LS_INDEX = 'sp2:index';
const MAX_LS_ENTRIES = 220;

export const TTL = Object.freeze({
  LIVE: 45 * 1000,          // a day that contains in-play matches
  TODAY: 3 * 60 * 1000,     // today, nothing live
  FUTURE: 30 * 60 * 1000,   // scheduled fixtures
  PAST: 24 * 60 * 60 * 1000, // finished matches never change
  STATIC: 12 * 60 * 60 * 1000, // repo JSON
  REGISTRY: 60 * 60 * 1000,
});

function now() { return Date.now(); }

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    const idx = JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
    const next = idx.filter((k) => k !== key);
    next.push(key);
    while (next.length > MAX_LS_ENTRIES) {
      const drop = next.shift();
      localStorage.removeItem(LS_PREFIX + drop);
    }
    localStorage.setItem(LS_INDEX, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage disabled: the memory cache still works.
    try { clearCache(); } catch { /* ignore */ }
  }
}

export function clearCache() {
  MEM.clear();
  try {
    const idx = JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
    for (const k of idx) localStorage.removeItem(LS_PREFIX + k);
    localStorage.removeItem(LS_INDEX);
  } catch { /* ignore */ }
}

export function cacheStats() {
  let entries = 0; let bytes = 0;
  try {
    const idx = JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
    entries = idx.length;
    for (const k of idx) bytes += (localStorage.getItem(LS_PREFIX + k) || '').length;
  } catch { /* ignore */ }
  return { memory: MEM.size, entries, kb: Math.round(bytes / 1024) };
}

/**
 * Fetch JSON with cache + single-flight + stale-while-revalidate.
 * Resolves to { data, fetchedAt, stale, fromCache, sourceUrl, error }.
 */
export async function getJSON(url, { ttl = TTL.FUTURE, timeoutMs = 12000, allowStale = true } = {}) {
  const key = url;
  const mem = MEM.get(key) || lsGet(key);
  const fresh = mem && (now() - mem.fetchedAt) < ttl;

  if (mem && !MEM.has(key)) MEM.set(key, mem);
  if (fresh) return { data: mem.data, fetchedAt: mem.fetchedAt, stale: false, fromCache: true, sourceUrl: url };

  if (INFLIGHT.has(key)) {
    if (mem && allowStale) {
      INFLIGHT.get(key).catch(() => {});
      return { data: mem.data, fetchedAt: mem.fetchedAt, stale: true, fromCache: true, sourceUrl: url };
    }
    return INFLIGHT.get(key);
  }

  const p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entry = { data, fetchedAt: now() };
      MEM.set(key, entry);
      lsSet(key, entry);
      return { data, fetchedAt: entry.fetchedAt, stale: false, fromCache: false, sourceUrl: url };
    } catch (err) {
      if (mem && allowStale) {
        return { data: mem.data, fetchedAt: mem.fetchedAt, stale: true, fromCache: true, sourceUrl: url, error: String(err.message || err) };
      }
      return { data: null, fetchedAt: null, stale: false, fromCache: false, sourceUrl: url, error: String(err.message || err) };
    } finally {
      clearTimeout(timer);
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, p);

  if (mem && allowStale) {
    p.catch(() => {});
    return { data: mem.data, fetchedAt: mem.fetchedAt, stale: true, fromCache: true, sourceUrl: url, revalidating: p };
  }
  return p;
}

/** Run promise-returning tasks with a concurrency ceiling (ESPN is polite-rate). */
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      try { out[idx] = await worker(items[idx], idx); }
      catch (e) { out[idx] = { error: String(e && e.message ? e.message : e) }; }
    }
  });
  await Promise.all(runners);
  return out;
}

/* ------------------------------------------------------------------ *
 * repo-relative static data
 * ------------------------------------------------------------------ */

/** Resolve a path relative to the site root, so subpages work on Pages. */
export function siteUrl(path) {
  const clean = String(path).replace(/^\/+/, '');
  const base = document.querySelector('base')?.getAttribute('href');
  if (base) return new URL(clean, new URL(base, location.href)).href;
  // Pages projects are served from /<repo>/; derive the root from this module.
  const here = new URL(import.meta.url);
  const root = here.href.replace(/assets\/js\/[^/]+$/, '');
  return new URL(clean, root).href;
}

export async function loadStatic(path, ttl = TTL.STATIC) {
  return getJSON(siteUrl(path), { ttl });
}

/* ------------------------------------------------------------------ *
 * ESPN endpoints
 * ------------------------------------------------------------------ */

export const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports';

export function ymd(dateISO) {
  return String(dateISO).replace(/-/g, '');
}

export function scoreboardUrl(espnSport, league, dates) {
  return `${ESPN_SITE}/${espnSport}/${league}/scoreboard${dates ? `?dates=${dates}` : ''}`;
}

export function standingsUrl(espnSport, league) {
  return `https://site.api.espn.com/apis/v2/sports/${espnSport}/${league}/standings`;
}

/** Pick a TTL from what the date means relative to now. */
export function ttlForDate(dateISO, hasLive) {
  const today = new Date().toISOString().slice(0, 10);
  if (hasLive) return TTL.LIVE;
  if (dateISO < today) return TTL.PAST;
  if (dateISO === today) return TTL.TODAY;
  return TTL.FUTURE;
}

/** One league, one day. */
export async function loadLeagueDay(espnSport, league, dateISO, { ttl } = {}) {
  const url = scoreboardUrl(espnSport, league, ymd(dateISO));
  return getJSON(url, { ttl: ttl ?? ttlForDate(dateISO, false) });
}

/** One league, a date range (ESPN supports YYYYMMDD-YYYYMMDD; verified 2026-09-02). */
export async function loadLeagueRange(espnSport, league, fromISO, toISO, { ttl = TTL.PAST } = {}) {
  const url = scoreboardUrl(espnSport, league, `${ymd(fromISO)}-${ymd(toISO)}`);
  return getJSON(url, { ttl });
}

export function isoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(dateISO, n) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
