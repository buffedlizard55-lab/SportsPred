#!/usr/bin/env node
/**
 * Refresh the NRL tape from ESPN's key-less site API.
 *
 *   node scripts/collect_nrl_espn.mjs            # fetch the 2026 season and merge
 *   node scripts/collect_nrl_espn.mjs --dry-run   # fetch and report, write nothing
 *   node scripts/collect_nrl_espn.mjs --check     # validate the committed tape
 *
 * Endpoint:
 *   https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=YYYYMMDD-YYYYMMDD
 *
 * Rules this script obeys:
 *  - It merges, never replaces. A fetch failure aborts the run rather than
 *    overwriting a good committed tape with an empty one.
 *  - It never infers a score. Only events ESPN marks completed are written with
 *    scores; everything else keeps null.
 *  - It keeps representative fixtures off the tape. ESPN files State of Origin
 *    under the same league, so New South Wales and Queensland arrive as if they
 *    were clubs; anything outside the 17 canonical clubs is skipped (NRL-12).
 *  - Venue and kick-off come from ESPN in UTC. OLBG's index renders times in the
 *    viewer's timezone, so OLBG is never used for kick-off (NRL-01).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { nrlAliasMap, slugTeam } from '../engine/nrl_data.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const MATCHES = join(ROOT, 'data', 'nrl_matches.json');
const TEAMS = join(ROOT, 'data', 'nrl_teams.json');

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard';
const SEASON_START = '2026-02-28';
const SEASON_END = '2026-10-08';
const UA = 'SportsPredCollector/1.0 (+https://github.com/buffedlizard55-lab/SportsPred)';

/** Chunk a date range into windows ESPN will answer in one go. */
function windows(from, to, days = 21) {
  const out = [];
  let start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (start < end) {
    const next = new Date(Math.min(start.getTime() + days * 86400000, end.getTime()));
    out.push([start.toISOString().slice(0, 10), next.toISOString().slice(0, 10)]);
    start = new Date(next.getTime() + 86400000);
  }
  return out;
}

const ymd = (iso) => iso.slice(0, 10).replace(/-/g, '');

async function fetchWindow(from, to) {
  const url = `${BASE}?dates=${ymd(from)}-${ymd(to)}&limit=200`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function toMatch(ev, canon) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  const completed = comp.status?.type?.state === 'post' || comp.status?.type?.completed === true;
  const hs = Number(home.score);
  const as = Number(away.score);
  const hasScores = completed && Number.isFinite(hs) && Number.isFinite(as);
  return {
    round: ev.week?.number ?? null,
    date: (ev.date || '').slice(0, 10),
    home: canon(home.team?.displayName || home.team?.name),
    away: canon(away.team?.displayName || away.team?.name),
    homeScore: hasScores ? hs : null,
    awayScore: hasScores ? as : null,
    venue: comp.venue?.fullName || null,
    kickoffUtc: ev.date || null,
    status: hasScores ? 'completed' : (completed ? 'completed' : 'scheduled'),
    espnId: ev.id ? String(ev.id) : undefined,
  };
}

/** The 17 canonical club names, used to keep representative fixtures off the tape. */
export function canonicalClubs(teamsDoc) {
  return new Set(Object.keys(teamsDoc?.teams || {}));
}

const DAY_MS = 86400000;
const midnightUtc = (d) => (d ? Date.parse(`${d}T00:00:00Z`) : NaN);
const withinDays = (a, b, days) => {
  const [x, y] = [midnightUtc(a), midnightUtc(b)];
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= days * DAY_MS;
};

/**
 * Merge freshly fetched matches into a committed tape without duplicating it.
 *
 * ESPN's NRL scoreboard carries two things the tape must not absorb:
 *
 *  - **State of Origin and other representative fixtures.** ESPN files them
 *    under the same league, so New South Wales and Queensland arrive as if they
 *    were clubs. Anything outside the 17 canonical clubs is skipped and
 *    reported (NRL-12).
 *
 *  - **Fixtures the tape already holds under a different date.** The tape dates
 *    a match by its local kick-off; ESPN dates it in UTC. For every match
 *    played in Australia those agree, but the two Las Vegas games of round 1
 *    do not: 2026-02-28 in Las Vegas is 2026-03-01 in UTC. Matching on the date
 *    alone therefore duplicated them (NRL-13), which double-counted four clubs
 *    in the ladder.
 *
 * So a fetched match is matched to a committed one by, in order of preference:
 * the exact date; the same pairing within one day; or the same pairing and the
 * same round within a week. Only a genuinely new fixture is added.
 */
export function mergeMatches(committed = [], fetched = [], { clubs = null } = {}) {
  const out = committed.map((m) => ({ ...m }));
  const byExact = new Map();
  const byPair = new Map();
  const index = (m) => {
    byExact.set(`${m.date}|${m.home}|${m.away}`, m);
    const pair = `${m.home}|${m.away}`;
    if (!byPair.has(pair)) byPair.set(pair, []);
    byPair.get(pair).push(m);
  };
  out.forEach(index);

  const findExisting = (m) => {
    const exact = byExact.get(`${m.date}|${m.home}|${m.away}`);
    if (exact) return exact;
    const candidates = byPair.get(`${m.home}|${m.away}`) || [];
    return candidates.find((c) => withinDays(c.date, m.date, 1))
      || candidates.find((c) => c.round != null && c.round === m.round && withinDays(c.date, m.date, 7))
      || null;
  };

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const skippedEvents = [];
  for (const m of fetched) {
    if (clubs && (!clubs.has(m.home) || !clubs.has(m.away))) {
      skipped += 1;
      if (skippedEvents.length < 20) skippedEvents.push(`${m.date} ${m.home} v ${m.away}`);
      continue;
    }
    const existing = findExisting(m);
    if (!existing) {
      out.push(m);
      index(m);
      added += 1;
      continue;
    }
    // Merge field by field; a null from ESPN never clears a committed value.
    if (m.homeScore != null && existing.homeScore !== m.homeScore) { existing.homeScore = m.homeScore; updated += 1; }
    if (m.awayScore != null && existing.awayScore !== m.awayScore) { existing.awayScore = m.awayScore; updated += 1; }
    if (m.homeScore != null) existing.status = 'completed';
    if (m.venue && !existing.venue) existing.venue = m.venue;
    if (m.kickoffUtc && !existing.kickoffUtc) existing.kickoffUtc = m.kickoffUtc;
    if (m.round != null && existing.round == null) existing.round = m.round;
    if (m.espnId && !existing.espnId) existing.espnId = m.espnId;
  }
  return { matches: out, added, updated, skipped, skippedEvents };
}

export async function collect({ dryRun = false } = {}) {
  const teamsDoc = JSON.parse(readFileSync(TEAMS, 'utf8'));
  const alias = nrlAliasMap(teamsDoc);
  const clubs = canonicalClubs(teamsDoc);
  const canon = (name) => alias.get(slugTeam(name)) || name;
  const committedDoc = JSON.parse(readFileSync(MATCHES, 'utf8'));

  const raw = [];
  const failures = [];
  for (const [from, to] of windows(SEASON_START, SEASON_END)) {
    let payload;
    try {
      payload = await fetchWindow(from, to);
    } catch (err) {
      failures.push(`${from}..${to}: ${err.message}`);
      continue;
    }
    for (const ev of payload.events || []) {
      const m = toMatch(ev, canon);
      if (m && m.date) raw.push(m);
    }
  }

  if (!raw.length) {
    throw new Error(`ESPN returned no events at all; refusing to touch the committed tape. Failures: ${failures.join('; ') || 'none'}`);
  }

  const { matches: merged, added, updated, skipped, skippedEvents } =
    mergeMatches(committedDoc.matches || [], raw, { clubs });

  const fetched = raw.length;
  const matches = merged
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kickoffUtc || '').localeCompare(b.kickoffUtc || ''));

  if (!dryRun) {
    writeFileSync(MATCHES, `${JSON.stringify({
      ...committedDoc,
      generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      source: {
        ...(committedDoc.source || {}),
        espn: {
          name: 'ESPN NRL scoreboard (key-less site API)',
          url: `${BASE}?dates=${ymd(SEASON_START)}-${ymd(SEASON_END)}`,
          fetched_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          note: 'Scores, venues and UTC kick-offs. OLBG supplies the market slate; it is never used for kick-off times because it renders them in the viewer’s timezone (NRL-01).',
        },
      },
      collection_warnings: failures,
      matches,
    }, null, 1)}\n`);
  }
  return { fetched, added, updated, skipped, skippedEvents, failures, total: matches.length };
}

function check() {
  const doc = JSON.parse(readFileSync(MATCHES, 'utf8'));
  const problems = [];
  if (!Array.isArray(doc.matches) || !doc.matches.length) problems.push('no matches');
  const rounds = new Set(doc.matches.map((m) => m.round));
  if (rounds.size !== 27) problems.push(`expected 27 rounds, found ${rounds.size}`);
  // Representative fixtures (State of Origin) travel in the same ESPN feed.
  // They are not NRL clubs and must never reach the tape (NRL-12).
  const teamsDoc = JSON.parse(readFileSync(TEAMS, 'utf8'));
  const clubs = canonicalClubs(teamsDoc);
  const seen = new Set();
  for (const m of doc.matches) {
    for (const side of [m.home, m.away]) {
      if (!clubs.has(side) && !seen.has(side)) { seen.add(side); problems.push(`${side} is not one of the 17 NRL clubs`); }
    }
  }
  for (const m of doc.matches) {
    if (m.status === 'completed' && (!Number.isFinite(m.homeScore) || !Number.isFinite(m.awayScore))) {
      problems.push(`${m.date} ${m.home} v ${m.away}: completed without both scores`);
    }
    if (m.status !== 'completed' && (m.homeScore != null || m.awayScore != null)) {
      problems.push(`${m.date} ${m.home} v ${m.away}: scheduled with a score`);
    }
  }
  if (problems.length) {
    console.error(`nrl_matches.json: ${problems.length} problem(s)\n  ${problems.slice(0, 10).join('\n  ')}`);
    return 1;
  }
  console.log(`nrl_matches.json OK: ${doc.matches.length} matches across 27 rounds.`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('collect_nrl_espn.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) process.exit(check());
  collect({ dryRun: args.includes('--dry-run') })
    .then((r) => {
      console.log(`ESPN: ${r.fetched} events · ${r.added} new · ${r.updated} updated · ${r.skipped} not NRL clubs · ${r.total} on the tape`);
      if (r.skippedEvents.length) console.log(`  skipped (representative fixtures, NRL-12): ${r.skippedEvents.join('; ')}`);
      if (r.failures.length) console.error(`warnings: ${r.failures.join('; ')}`);
    })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
