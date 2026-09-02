/**
 * SportsPred — live Formula 1 collector (browser).
 *
 * ESPN's F1 endpoints are key-less and CORS-enabled, so the visitor's browser
 * can refresh the card directly:
 *   - current season calendar + session data (scoreboard, date-range form)
 *   - driver & constructor standings (v2 standings)
 *   - race-day weather for the next races (Open-Meteo)
 *
 * Committed snapshots in data/ remain the offline/GitHub-Pages fallback;
 * this module only upgrades them when the endpoints respond. Nothing is ever
 * synthesized: if a fetch fails, the snapshot stays.
 *
 * Cached in localStorage (15 min TTL) so reloads are cheap.
 */

import {
  parseF1Scoreboard,
  parseStandings,
} from '../../engine/f1_espn.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1';
const V2 = 'https://site.api.espn.com/apis/v2/sports/racing/f1';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

const CACHE_PREFIX = 'sportspred:f1:v1:';
const CACHE_TTL_MS = 15 * 60 * 1000;

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
  } catch { /* caching is an optimisation only */ }
}

async function getJSON(url, { timeoutMs = 20000 } = {}) {
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

async function collectWeather(circuit, raceDate) {
  if (!circuit?.city || !circuit?.country || !raceDate) return null;
  const geo = await getJSON(`${GEO}?name=${encodeURIComponent(circuit.city)}&count=1&language=en&format=json`);
  const hit = geo?.results?.[0];
  if (!hit) return null;
  const url = `${FORECAST}?latitude=${hit.latitude}&longitude=${hit.longitude}` +
    `&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max` +
    `&timezone=UTC&start_date=${raceDate}&end_date=${raceDate}`;
  const fx = await getJSON(url);
  const d = fx?.daily;
  if (!d) return null;
  return {
    raceDate,
    tempMaxC: d.temperature_2m_max?.[0] ?? null,
    precipProbPct: d.precipitation_probability_max?.[0] ?? null,
    windMaxKmh: d.wind_speed_10m_max?.[0] ?? null,
    sourceUrl: url,
  };
}

/**
 * Collect the F1 card for a date.
 * @returns {{ events, standings, weather, live } | null}
 */
export async function collectF1Card() {
  const year = new Date().getUTCFullYear();
  const [scoreboardPayload, standingsPayload] = await Promise.all([
    getJSON(`${SITE}/scoreboard?dates=${year}0101-${year}1231`),
    getJSON(`${V2}/standings`),
  ]);
  if (!scoreboardPayload || !standingsPayload) return null;
  const scoreboard = parseF1Scoreboard(scoreboardPayload);
  const standings = parseStandings(standingsPayload);
  return {
    scoreboard,
    standings,
    weather: null,
    live: true,
  };
}

export { parseF1Scoreboard, parseStandings };
