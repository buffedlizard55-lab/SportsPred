#!/usr/bin/env node
/**
 * Refresh the NRL venue forecasts from the Open-Meteo forecast API.
 *
 *   node scripts/collect_nrl_weather.mjs
 *   node scripts/collect_nrl_weather.mjs --check
 *
 * Open-Meteo needs no key and no registration. One request covers every venue
 * (comma-separated coordinates). The forecast is a model output, not an
 * observation: it is stored with its source and used only for the ten-point
 * weather factor of the GAME TOTAL market.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const OUT = join(ROOT, 'data', 'nrl_weather.json');
const TEAMS = join(ROOT, 'data', 'nrl_teams.json');
const URL = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude={lat}&longitude={lon}&daily=precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
  + '&forecast_days=4&timezone=UTC';

export async function collect({ dryRun = false, days = 4 } = {}) {
  const teams = JSON.parse(readFileSync(TEAMS, 'utf8')).teams || {};
  const venues = new Map();
  for (const t of Object.values(teams)) {
    if (!t.venue || !Number.isFinite(t.lat)) continue;
    venues.set(t.venue, { lat: t.lat, lon: t.lon });
  }
  if (!venues.size) throw new Error('no venues with coordinates in data/nrl_teams.json');

  const list = [...venues.entries()];
  const url = URL
    .replace('{lat}', list.map(([, v]) => v.lat).join(','))
    .replace('{lon}', list.map(([, v]) => v.lon).join(','))
    .replace('forecast_days=4', `forecast_days=${days}`);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open-Meteo -> HTTP ${res.status}`);
  const payload = await res.json();
  const arr = Array.isArray(payload) ? payload : [payload];
  if (arr.length !== list.length) throw new Error(`Open-Meteo returned ${arr.length} forecasts for ${list.length} venues`);

  const out = {};
  arr.forEach((f, i) => {
    const [name] = list[i];
    const daily = (f.daily?.time || []).map((d, k) => ({
      date: d,
      precip_mm: f.daily.precipitation_sum?.[k] ?? null,
      precip_prob_max: f.daily.precipitation_probability_max?.[k] ?? null,
      wind_max_kmh: f.daily.wind_speed_10m_max?.[k] ?? null,
    }));
    out[name] = { lat: list[i][1].lat, lon: list[i][1].lon, daily };
  });

  const doc = {
    schema_version: 1,
    sport: 'NRL',
    fetched_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: {
      name: 'Open-Meteo forecast API (key-less, no registration)',
      url,
      note: 'Daily aggregate forecast per match venue. Wind is the daily maximum at ten metres. A model forecast, not an observation; used only for the weather factor of the GAME TOTAL market.',
    },
    venues: out,
  };
  if (!dryRun) writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);
  return doc;
}

function check() {
  const doc = JSON.parse(readFileSync(OUT, 'utf8'));
  const venues = Object.keys(doc.venues || {});
  if (!venues.length) { console.error('no venues in nrl_weather.json'); return 1; }
  for (const [name, v] of Object.entries(doc.venues)) {
    if (!Array.isArray(v.daily) || !v.daily.length) { console.error(`${name}: no daily forecast`); return 1; }
  }
  console.log(`nrl_weather.json OK: ${venues.length} venues, fetched ${doc.fetched_at_utc}.`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('collect_nrl_weather.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) process.exit(check());
  collect({ dryRun: args.includes('--dry-run') })
    .then((d) => console.log(`Wrote ${Object.keys(d.venues).length} venue forecasts (${d.fetched_at_utc}).`))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
