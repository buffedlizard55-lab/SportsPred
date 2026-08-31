#!/usr/bin/env node
/**
 * SportsPred — end-to-end live verification.
 *
 * Runs the EXACT pipeline the browser runs (same parser, same surface map,
 * same engine, same writer) against live ESPN data, and prints what it found
 * plus what it could not source. Use it to confirm the site would produce real
 * output today, and to catch silent breakage if ESPN changes its payloads.
 *
 *   node scripts/verify_live.mjs                # today, UTC
 *   node scripts/verify_live.mjs --date 2026-08-30
 *   node scripts/verify_live.mjs --tape 30      # shorter history (faster)
 *   node scripts/verify_live.mjs --json
 *
 * NETWORK NOTE: needs egress to site.api.espn.com. The development sandbox for
 * this project is restricted to GitHub, so this is expected to be run from a
 * normal network or CI. It fails loudly rather than pretending to succeed.
 */

import { readFileSync } from 'node:fs';
import { parseScoreboard, parseRankings, buildPlayerStats, buildH2H, normaliseName } from '../engine/espn.js';
import { resolveSurface } from '../engine/surface.js';
import { codeStage, h2hForEngine } from '../engine/tournament.js';
import { scoreMatch, scoreCard, RULESET_VERSION } from '../engine/engine.js';
import { writeCard } from '../engine/writer.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const LEAGUES = ['atp', 'wta'];

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : dflt;
};
const asJson = argv.includes('--json');
const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const TAPE_DAYS = Number(arg('--tape', '60'));

const surfaces = JSON.parse(readFileSync(new URL('../data/surfaces.json', import.meta.url), 'utf8'));

const log = (...a) => { if (!asJson) console.error(...a); };

async function getJSON(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function yyyymmdd(iso) { return iso.replace(/-/g, ''); }
function shift(iso, n) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function attach(row) {
  const res = resolveSurface(surfaces, row.tournament, row.tour);
  const entry = res.key ? surfaces.tournaments[res.key] : null;
  const stage = codeStage(row.tournament, row.round, entry);
  return { ...row, surface: res.surface, surface_reason: res.reason, level_code: stage.level, round_code: stage.round };
}

async function collectDate(iso) {
  const rows = [];
  const seen = new Set();
  const failures = [];
  for (const lg of LEAGUES) {
    const p = await getJSON(`${SITE}/${lg}/scoreboard?dates=${yyyymmdd(iso)}`);
    if (!p) { failures.push(lg); continue; }
    for (const r of parseScoreboard(p, lg)) {
      if (seen.has(r.competition_id)) continue;
      seen.add(r.competition_id);
      rows.push(attach(r));
    }
  }
  return { rows, failures };
}

async function main() {
  log(`\nSportsPred live verification — ${DATE} (ruleset ${RULESET_VERSION})`);
  log('='.repeat(64));

  // 1. Reachability
  const probe = await getJSON(`${SITE}/atp/scoreboard`);
  if (!probe) {
    console.error('\nFAIL: could not reach site.api.espn.com.');
    console.error('This host has no egress to ESPN, or ESPN is down. No output is produced.');
    process.exit(2);
  }
  log('  [OK] ESPN scoreboard reachable, no API key used');

  // 2. Rankings
  const rankings = { byId: {}, byName: {}, failures: [] };
  for (const lg of LEAGUES) {
    const p = await getJSON(`${SITE}/${lg}/rankings`);
    if (!p) { rankings.failures.push(lg); continue; }
    const parsed = parseRankings(p);
    Object.assign(rankings.byId, parsed.byId);
    for (const [k, v] of Object.entries(parsed.byName)) if (!rankings.byName[k]) rankings.byName[k] = v;
    log(`  [OK] ${lg.toUpperCase()} rankings: ${parsed.count} players`);
  }

  // 3. The day's card
  const day = await collectDate(DATE);
  log(`  [OK] ${DATE}: ${day.rows.length} singles matches`
    + `${day.failures.length ? ` (feed failures: ${day.failures.join(', ')})` : ''}`);
  if (!day.rows.length) {
    log('\n  No singles matches on this date — nothing to score. This is a fact about the calendar, not an error.');
  }

  // 4. History tape
  log(`  ..  building ${TAPE_DAYS}-day history tape`);
  const tape = [];
  for (let i = 1; i <= TAPE_DAYS; i++) {
    const { rows } = await collectDate(shift(DATE, -i));
    for (const r of rows) if (r.completed) tape.push(r);
  }
  log(`  [OK] history tape: ${tape.length} completed matches`);

  // 5. Score + write, exactly as the browser does
  const engineMatches = day.rows.map((m) => {
    const mk = (p) => {
      const r = rankings.byId[p.espn_id] || rankings.byName[normaliseName(p.name)] || null;
      const s = buildPlayerStats(p.espn_id, tape, m.surface, DATE);
      return {
        name: p.name,
        rank: r?.rank ?? null,
        rankTrajectory: r?.trajectory ?? null,
        odds: null,
        firstSetOdds: null,
        handicapOdds: null,
        form: s.form,
        surface: s.surface,
        serve: s.serve,
        rest: s.rest,
      };
    };
    const [a, b] = m.players.map(mk);
    const rawH2H = buildH2H(m.players[0].espn_id, m.players[1].espn_id, tape, m.surface);
    let opponentRank = null;
    if (a.rank != null && b.rank != null) opponentRank = a.rank <= b.rank ? b.rank : a.rank;
    else opponentRank = b.rank ?? a.rank ?? null;
    return {
      event_id: m.competition_id,
      players: [a, b],
      surface: m.surface,
      tournament: (m.level_code || m.round_code) ? { level: m.level_code, round: m.round_code } : null,
      h2h: h2hForEngine(rawH2H, a.rank, b.rank),
      opponentRank,
      home: a.name,
      away: b.name,
      resolved_date: m.date,
      _raw: m,
    };
  });

  const scored = engineMatches.map((m) => ({ m, r: scoreMatch(m) }));
  const card = scoreCard(engineMatches);
  const written = writeCard(card.results);

  // 6. Report
  const unscoreable = scored.filter((x) => x.r.favourite === null).length;
  const noSurface = day.rows.filter((r) => !r.surface).length;
  const missingCounts = new Map();
  for (const { r } of scored) for (const f of r.missing) missingCounts.set(f, (missingCounts.get(f) || 0) + 1);

  const summary = {
    date: DATE,
    ruleset: RULESET_VERSION,
    matches: day.rows.length,
    scoreable: day.rows.length - unscoreable,
    unscoreable,
    without_surface: noSurface,
    tape_matches: tape.length,
    ranked_players: Object.keys(rankings.byId).length,
    tips_emitted: written.tips.filter((t) => t.ok && !t.skip).length,
    tips_skipped: written.tips.filter((t) => t.skip).length,
    tips_withheld: written.tips.filter((t) => !t.ok).length,
    violations: written.violations,
    missing_factors: [...missingCounts.entries()].sort((a, b) => b[1] - a[1]),
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, tips: written.tips }, null, 2));
    return;
  }

  log('\nRESULT');
  log('-'.repeat(64));
  for (const [k, v] of Object.entries(summary)) {
    if (k === 'missing_factors' || k === 'violations') continue;
    log(`  ${k.padEnd(20)} ${v}`);
  }

  log('\nMissing factors across the card:');
  if (!summary.missing_factors.length) log('  (none)');
  for (const [f, n] of summary.missing_factors) log(`  ${String(n).padStart(3)}x  ${f}`);

  if (written.violations.length) {
    log('\nOUTPUT-RULE VIOLATIONS (these tips were withheld):');
    for (const v of written.violations) log(`  ${JSON.stringify(v)}`);
  }

  const sample = written.tips.filter((t) => t.ok).slice(0, 6);
  if (sample.length) {
    log('\nSAMPLE OUTPUT');
    log('-'.repeat(64));
    for (const t of sample) {
      log(`\n[${t.band}] ${t.match} — ${t.marketLabel}`);
      log(t.text.replace(/\*\*/g, ''));
    }
  } else {
    log('\nNo tips were emitted for this card.');
  }
  log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
