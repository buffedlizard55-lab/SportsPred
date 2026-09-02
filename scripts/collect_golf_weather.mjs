#!/usr/bin/env node
/**
 * SportsPred — Golf weather collector (Open-Meteo, free & key-less).
 *
 * For every upcoming predictable event in data/golf_events.json it geocodes
 * the course city, pulls the daily forecast for the four tournament days and
 * the hourly wind/rain for round one, then writes data/golf_weather.json.
 *
 * The round-one trend (improving / stable / deteriorating) compares the
 * afternoon tee window with the morning window. It feeds ONLY the first-round
 * leader tee-time rule and the weather note; it never invents form.
 *
 *   node scripts/collect_golf_weather.mjs --dry-run
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SPORTSPRED_DATA_DIR || join(ROOT, 'data');
const EVENTS = join(DATA, 'golf_events.json');
const OUT = join(DATA, 'golf_weather.json');

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const HORIZON_DAYS = 7;

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function geocode(city, country) {
  const url = `${GEO}?name=${encodeURIComponent(city)}&count=5&language=en&format=json`;
  try {
    const j = await getJSON(url);
    const hits = j?.results || [];
    const hit = hits.find((h) => country && String(h.country || '').toLowerCase().includes(String(country).toLowerCase().slice(0, 5))) || hits[0];
    if (!hit) return null;
    return { lat: hit.latitude, lon: hit.longitude, name: hit.name, country: hit.country, timezone: hit.timezone, url };
  } catch { return null; }
}

/** Trend from hourly wind + rain across the local tee window (07:00-17:00). */
export function r1Trend(hourly, dateISO) {
  if (!hourly?.time) return null;
  const idx = hourly.time.map((t, i) => [t, i]).filter(([t]) => String(t).startsWith(dateISO));
  if (idx.length < 12) return null;
  const pick = (h) => idx.find(([t]) => Number(String(t).slice(11, 13)) === h)?.[1];
  const am = [7, 8, 9, 10].map(pick).filter((i) => i !== undefined);
  const pm = [13, 14, 15, 16].map(pick).filter((i) => i !== undefined);
  if (am.length < 3 || pm.length < 3) return null;
  const mean = (arr, key) => arr.reduce((a, i) => a + (Number(hourly[key]?.[i]) || 0), 0) / arr.length;
  const windAm = mean(am, 'wind_speed_10m'); const windPm = mean(pm, 'wind_speed_10m');
  const rainAm = mean(am, 'precipitation_probability'); const rainPm = mean(pm, 'precipitation_probability');
  const windDelta = windPm - windAm; const rainDelta = rainPm - rainAm;
  let trend = 'stable';
  if (windDelta >= 8 || rainDelta >= 25) trend = 'deteriorating';
  else if (windDelta <= -8 || rainDelta <= -25) trend = 'improving';
  return { trend, windAmKmh: round1(windAm), windPmKmh: round1(windPm), rainAmPct: round1(rainAm), rainPmPct: round1(rainPm) };
}

const round1 = (n) => Math.round(n * 10) / 10;

async function forecast(lat, lon, startISO, endISO) {
  const url = `${FORECAST}?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max` +
    `&hourly=wind_speed_10m,precipitation_probability&timezone=auto&start_date=${startISO}&end_date=${endISO}`;
  try {
    const j = await getJSON(url);
    const d = j?.daily;
    if (!d?.time) return null;
    const days = d.time.map((t, i) => ({
      date: t,
      tempMaxC: d.temperature_2m_max?.[i] ?? null,
      precipProbPct: d.precipitation_probability_max?.[i] ?? null,
      windMaxKmh: d.wind_speed_10m_max?.[i] ?? null,
      gustMaxKmh: d.wind_gusts_10m_max?.[i] ?? null,
    }));
    return { days, r1: r1Trend(j.hourly, startISO), timezone: j.timezone ?? null, sourceUrl: url };
  } catch { return null; }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!existsSync(EVENTS)) { console.log('[PENDING] data/golf_events.json not collected yet.'); return; }
  const doc = JSON.parse(readFileSync(EVENTS, 'utf8'));
  const t = todayISO();
  const upcoming = (doc.events || [])
    .filter((e) => !e.showOnly && e.state !== 'post' && String(e.endDate || e.startDate).slice(0, 10) >= t && String(e.startDate).slice(0, 10) <= addDays(t, HORIZON_DAYS));

  const out = {
    schema_version: 1,
    sport: 'Golf',
    fetched_at_utc: new Date().toISOString(),
    method: 'Open-Meteo geocoding + daily/hourly forecast APIs (free, key-less)',
    note: 'Weather feeds only the first-round-leader tee-time rule (round-one trend) and the written weather note. Forecasts are collected inside seven days of the first round.',
    events: {},
  };

  for (const ev of upcoming) {
    const city = ev.course?.city || null;
    const country = ev.course?.country || ev.course?.state || null;
    const start = String(ev.startDate).slice(0, 10);
    const end = String(ev.endDate || ev.startDate).slice(0, 10);
    if (!city) { out.events[ev.id] = { available: false, reason: 'course city not published' }; continue; }
    const geo = await geocode(city, country);
    if (!geo) { out.events[ev.id] = { available: false, reason: `geocoding failed for ${city}` }; continue; }
    const wx = await forecast(geo.lat, geo.lon, start, end);
    out.events[ev.id] = {
      available: Boolean(wx),
      eventId: ev.id, name: ev.name, tour: ev.tour, city: geo.name, country: geo.country, lat: geo.lat, lon: geo.lon,
      ...(wx || {}),
      geocodeUrl: geo.url,
      note: wx ? null : `forecast failed for ${city} ${start}`,
    };
    console.log(`  ${ev.name}: ${wx ? `${wx.days.length} days, R1 trend ${wx.r1?.trend ?? 'n/a'}` : 'unavailable'}`);
  }

  if (dryRun) return;
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('Golf weather collection failed:', e); process.exit(1); });
}
