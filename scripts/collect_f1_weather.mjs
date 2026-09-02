#!/usr/bin/env node
/**
 * SportsPred — Formula 1 weather collector (Open-Meteo, free & key-less).
 *
 * Geocodes each upcoming circuit (city + country from ESPN's circuit data)
 * through the Open-Meteo geocoding API, then pulls the daily forecast for the
 * race date. Writes data/f1_weather.json.
 *
 * Weather is the ONLY external data point the master prompt permits in output;
 * it is used to flag weather-dependent predictions, never to invent form.
 *
 *   node scripts/collect_f1_weather.mjs --dry-run
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS = join(ROOT, 'data', 'f1_events.json');
const OUT = join(ROOT, 'data', 'f1_weather.json');

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function geocode(city, country) {
  try {
    const j = await getJSON(`${GEO}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const hit = (j?.results || [])[0];
    if (!hit) return null;
    return { lat: hit.latitude, lon: hit.longitude, name: hit.name, country: hit.country, url: `${GEO}?name=${encodeURIComponent(city)}&count=1&language=en&format=json` };
  } catch {
    return null;
  }
}

async function forecast(lat, lon, raceDate) {
  const url = `${FORECAST}?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max` +
    `&timezone=UTC&start_date=${raceDate}&end_date=${raceDate}`;
  try {
    const j = await getJSON(url);
    const d = j?.daily;
    if (!d) return null;
    return {
      raceDate,
      tempMaxC: d.temperature_2m_max?.[0] ?? null,
      precipProbPct: d.precipitation_probability_max?.[0] ?? null,
      windMaxKmh: d.wind_speed_10m_max?.[0] ?? null,
      sourceUrl: url,
    };
  } catch {
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const events = JSON.parse(readFileSync(EVENTS, 'utf8')).events || [];
  const upcoming = events
    .filter((e) => e.state === 'pre' && String(e.startDate).slice(0, 10) >= todayISO())
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
    .slice(0, 4);

  const out = {
    schema_version: 1,
    sport: 'Formula 1',
    fetched_at_utc: new Date().toISOString(),
    method: 'Open-Meteo geocoding + daily forecast APIs (free, key-less)',
    note: 'Weather is a permitted external reference only; it never feeds internal scoring beyond a weather-dependence flag.',
    events: {},
  };

  for (const ev of upcoming) {
    const raceDate = String(ev.raceDate || ev.endDate).slice(0, 10);
    const city = ev.circuit?.city || null;
    const country = ev.circuit?.country || null;
    if (!city || !country) {
      out.events[ev.id] = { available: false, reason: 'circuit city/country not sourced' };
      continue;
    }
    const geo = await geocode(city, country);
    if (!geo) {
      out.events[ev.id] = { available: false, reason: `geocoding failed for ${city}` };
      continue;
    }
    const wx = await forecast(geo.lat, geo.lon, raceDate);
    out.events[ev.id] = {
      available: Boolean(wx),
      circuitEvent: ev.id,
      name: ev.name,
      city: geo.name,
      country: geo.country,
      ...(wx || {}),
      geocodeUrl: geo.url,
      note: wx ? null : `forecast failed for ${city} ${raceDate}`,
    };
    console.log(`  ${ev.name}: ${wx ? `${wx.tempMaxC}°C / ${wx.precipProbPct}% rain / ${wx.windMaxKmh} km/h` : 'unavailable'}`);
  }

  if (dryRun) return;
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error('Weather collection failed:', e);
  process.exit(1);
});
