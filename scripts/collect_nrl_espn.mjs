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

export async function collect({ dryRun = false } = {}) {
  const teamsDoc = JSON.parse(readFileSync(TEAMS, 'utf8'));
  const alias = nrlAliasMap(teamsDoc);
  const canon = (name) => alias.get(slugTeam(name)) || name;
  const committed = JSON.parse(readFileSync(MATCHES, 'utf8'));
  const byKey = new Map();
  for (const m of committed.matches || []) {
    byKey.set(`${m.date}|${m.home}|${m.away}`, m);
  }

  let fetched = 0;
  let updated = 0;
  let added = 0;
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
      if (!m || !m.date) continue;
      fetched += 1;
      const key = `${m.date}|${m.home}|${m.away}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, m);
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
  }

  if (!fetched) {
    throw new Error(`ESPN returned no events at all; refusing to touch the committed tape. Failures: ${failures.join('; ') || 'none'}`);
  }

  const matches = [...byKey.values()]
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kickoffUtc || '').localeCompare(b.kickoffUtc || ''));

  if (!dryRun) {
    writeFileSync(MATCHES, `${JSON.stringify({
      ...committed,
      generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      source: {
        ...(committed.source || {}),
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
  return { fetched, added, updated, failures, total: matches.length };
}

function check() {
  const doc = JSON.parse(readFileSync(MATCHES, 'utf8'));
  const problems = [];
  if (!Array.isArray(doc.matches) || !doc.matches.length) problems.push('no matches');
  const rounds = new Set(doc.matches.map((m) => m.round));
  if (rounds.size !== 27) problems.push(`expected 27 rounds, found ${rounds.size}`);
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
      console.log(`ESPN: ${r.fetched} events · ${r.added} new · ${r.updated} updated · ${r.total} on the tape`);
      if (r.failures.length) console.error(`warnings: ${r.failures.join('; ')}`);
    })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
