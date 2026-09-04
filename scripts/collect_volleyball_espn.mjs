#!/usr/bin/env node
/**
 * Collect NCAA volleyball scoreboards into the committed tape.
 * EuroVolley rows are never written from this collector.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/**
 * How many days of *already-played* scoreboards to walk back through.
 *
 * WHY THIS EXISTS
 * The collector originally fetched exactly one day. It appends to the tape and
 * dedupes by match id, so the tape grows one day per run — but that means a
 * fresh checkout, or any gap in the schedule, leaves the tape only as deep as
 * the number of times the workflow happened to fire. The committed tape held
 * two days of NCAA results across 315 teams, so no team had more than one prior
 * result while the engine needs five to score recent form. Every NCAA fixture
 * therefore scored zero and published a SKIP.
 *
 * Backfilling is safe precisely because of the dedupe: re-walking a day that is
 * already in the tape adds nothing. Nothing here invents a result — each day is
 * a separate ESPN scoreboard request, and a day that cannot be fetched is
 * skipped and reported rather than filled in.
 */
const BACKFILL_DAYS = Number(argOf('--days', '0')) || 0;

/** Inclusive list of ISO dates ending at `endISO`, walking `days` backwards. */
export function backfillDates(endISO, days) {
  const out = [];
  const end = new Date(`${endISO}T00:00:00Z`);
  for (let i = days; i >= 1; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

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

  // Historical days first (results only), then the target date, which is also
  // the only day whose upcoming rows are refreshed.
  const days = [...backfillDates(DATE, BACKFILL_DAYS), DATE];
  const dayReport = [];

  for (const day of days) {
   const isTarget = day === DATE;
   let dayResults = 0;
   let dayFailed = 0;
   for (const lg of LEAGUES) {
    const payload = (isTarget && lg.slug === 'womens-college-volleyball') ? probe
      : await getJSON(`${SITE}/${lg.slug}/scoreboard?dates=${ymd(day)}`);
    // A day that cannot be fetched is recorded and skipped. It is never
    // treated as a day on which no matches were played.
    if (!payload) { dayFailed += 1; continue; }
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
        dayResults += 1;
      }
      // Only the target date contributes upcoming rows; a historical day's
      // "upcoming" entries are stale and must not re-enter the fixture list.
      if (isTarget && (m.phase === 'upcoming' || m.phase === 'live')) {
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
   dayReport.push({ date: day, results: dayResults, leagues_unreachable: dayFailed });
  }

  // Keep committed EuroVolley upcoming rows; replace NCAA upcoming for this date.
  const kept = (matchesDoc.matches || []).filter((m) => m.family !== 'ncaa' || (m.dateISO || m.date) !== DATE);
  matchesDoc.matches = [...kept, ...upcoming];
  matchesDoc.source = {
    name: 'ESPN NCAA volleyball scoreboard + committed EuroVolley tape',
    url: `${SITE}/womens-college-volleyball/scoreboard?dates=${ymd(DATE)}`,
    fetched_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };

  // Record which days were actually walked and which could not be fetched, so
  // a thin tape can be told apart from a quiet schedule on review.
  tape.collection = {
    last_run_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    target_date: DATE,
    backfill_days: BACKFILL_DAYS,
    days_walked: dayReport,
    note: BACKFILL_DAYS
      ? 'Historical days are re-walked on every run; matches are deduped by id, so re-walking adds nothing.'
      : 'Single-day run. Pass --days N to backfill N prior days of results (the engine needs five prior matches per team to score form).',
  };

  const unreachable = dayReport.filter((d) => d.leagues_unreachable);
  if (unreachable.length) {
    console.warn(`WARNING: ${unreachable.length} day(s) had an unreachable league scoreboard: `
      + unreachable.map((d) => d.date).join(', '));
  }

  if (DRY) {
    console.log(`ncaa completed +${added}; upcoming ${upcoming.length}`);
    for (const d of dayReport) {
      console.log(`  ${d.date}: ${d.results} new results`
        + (d.leagues_unreachable ? `  (${d.leagues_unreachable} league(s) unreachable)` : ''));
    }
    return 0;
  }
  writeFileSync(TAPE, `${JSON.stringify(tape, null, 2)}\n`);
  writeFileSync(MATCHES, `${JSON.stringify(matchesDoc, null, 2)}\n`);
  console.log(`Wrote ${added} NCAA results to the tape; ${upcoming.length} upcoming NCAA rows for ${DATE}.`);
  return 0;
}

// Only collect when run as a script. Importing this module (for tests, or to
// reuse backfillDates) must never start a live collection: a previous incident
// in this repo had an import overwrite committed data with an empty result.
const isEntrypoint = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
}
