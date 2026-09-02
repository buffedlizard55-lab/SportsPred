#!/usr/bin/env node
/**
 * Collect NCAA volleyball scoreboards into the committed tape.
 * EuroVolley rows are never written from this collector.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseVolleyballScoreboard } from '../engine/volleyball_espn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAPE = join(ROOT, 'data', 'volleyball_tape.json');
const MATCHES = join(ROOT, 'data', 'volleyball_matches.json');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/volleyball';
const LEAGUES = [
  { slug: 'womens-college-volleyball', name: "NCAA Women's Volleyball" },
  { slug: 'mens-college-volleyball', name: "NCAA Men's Volleyball" },
];

function argOf(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
}
const DATE = argOf('--date', new Date().toISOString().slice(0, 10));
const DRY = process.argv.includes('--dry-run');
const ymd = (iso) => iso.replace(/-/g, '');

async function getJSON(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function load(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

async function main() {
  const probe = await getJSON(`${SITE}/womens-college-volleyball/scoreboard?dates=${ymd(DATE)}`);
  if (!probe) {
    console.error('FAIL: ESPN volleyball scoreboard unreachable. Nothing written.');
    return 2;
  }

  const tape = load(TAPE, { schema_version: 1, sport: 'Volleyball', matches: [] });
  const matchesDoc = load(MATCHES, { schema_version: 1, sport: 'Volleyball', matches: [] });
  const seen = new Set((tape.matches || []).map((m) => String(m.id)));
  let added = 0;
  const upcoming = [];

  for (const lg of LEAGUES) {
    const payload = lg.slug === 'womens-college-volleyball' ? probe
      : await getJSON(`${SITE}/${lg.slug}/scoreboard?dates=${ymd(DATE)}`);
    if (!payload) continue;
    const parsed = parseVolleyballScoreboard(payload, {
      sportKey: 'volleyball', leagueSlug: lg.slug, leagueName: lg.name,
    });
    for (const m of parsed.matches) {
      m.family = 'ncaa';
      if (m.phase === 'results' && m.winner && !seen.has(String(m.id))) {
        tape.matches.push({
          id: m.id,
          family: 'ncaa',
          phase: 'results',
          date: m.dateISO,
          startUtc: m.startUtc,
          home: m.home,
          away: m.away,
          winner: m.winner === 'home' ? m.home : m.away,
          setScore: m.setScore,
          sets: m.sets,
          venue: m.venue,
          leagueSlug: lg.slug,
          source_url: m.source_url || m.links?.summary,
        });
        seen.add(String(m.id));
        added += 1;
      }
      if (m.phase === 'upcoming' || m.phase === 'live') {
        upcoming.push({
          id: m.id,
          event_id: m.id,
          family: 'ncaa',
          phase: m.phase,
          date: m.dateISO,
          dateISO: m.dateISO,
          startUtc: m.startUtc,
          home: m.home,
          away: m.away,
          league: lg.name,
          leagueName: lg.name,
          leagueSlug: lg.slug,
          venue: m.venue,
          source_url: m.source_url || m.links?.summary,
        });
      }
    }
  }

  // Keep committed EuroVolley upcoming rows; replace NCAA upcoming for this date.
  const kept = (matchesDoc.matches || []).filter((m) => m.family !== 'ncaa' || (m.dateISO || m.date) !== DATE);
  matchesDoc.matches = [...kept, ...upcoming];
  matchesDoc.source = {
    name: 'ESPN NCAA volleyball scoreboard + committed EuroVolley tape',
    url: `${SITE}/womens-college-volleyball/scoreboard?dates=${ymd(DATE)}`,
    fetched_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };

  if (DRY) {
    console.log(`ncaa completed +${added}; upcoming ${upcoming.length}`);
    return 0;
  }
  writeFileSync(TAPE, `${JSON.stringify(tape, null, 2)}\n`);
  writeFileSync(MATCHES, `${JSON.stringify(matchesDoc, null, 2)}\n`);
  console.log(`Wrote ${added} NCAA results to the tape; ${upcoming.length} upcoming NCAA rows for ${DATE}.`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
