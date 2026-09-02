#!/usr/bin/env node
/**
 * Build data/league_context.json — the precomputed league baselines.
 *
 * THIS IS THE FIX FOR THE SLOW PAGE LOAD.
 *
 * The site needs, for every league, the measured home-win rate, draw rate and
 * mean combined score. Computing that in the browser meant scanning ~45 days of
 * fixtures per league on every visit. This script does the scan once, in CI,
 * over a much longer window, and commits the result as a single small file the
 * browser reads in one request.
 *
 * Everything written here is MEASURED from completed matches. If a league has
 * fewer than 10 completed matches in the window it is written with
 * sufficient:false and the site falls back to a neutral baseline with a capped
 * confidence, rather than inventing a number.
 *
 * Run: node scripts/build_league_context.mjs [--days 120] [--out data/league_context.json]
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPORTS, ESPN_SITE_BASE } from '../engine/registry.js';
import { espnSportFor } from '../engine/universal_engine.js';
import { parseScoreboard, buildLeagueContext } from '../engine/espn_universal.js';

const OUT = arg('--out') || 'data/league_context.json';
const DAYS = Number(arg('--days') || 120);
const REGISTRY = arg('--registry') || 'data/leagues.json';
const CONCURRENCY = 5;
const TIMEOUT = 30000;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

function stamp(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
    return { data: await res.json(), error: null };
  } catch (e) {
    return { data: null, error: String(e.message || e) };
  } finally { clearTimeout(t); }
}

async function pool(items, limit, worker) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) { const idx = i; i += 1; out[idx] = await worker(items[idx]); }
  }));
  return out;
}

function leaguesFor(sport, registry) {
  const reg = registry?.sports?.[sport.key]?.leagues;
  if (Array.isArray(reg) && reg.length) return reg.filter((l) => l.ok).map((l) => ({ slug: l.slug, name: l.name }));
  return sport.candidateLeagues || [];
}

async function main() {
  const registry = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : null;
  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 86400000);

  const jobs = [];
  for (const sport of SPORTS) {
    if (!sport.espnSport || !sport.predictable || sport.page) continue; // sports with a dedicated page (golf) are not two-competitor cards
    for (const lg of leaguesFor(sport, registry)) jobs.push({ sport, lg });
  }

  const out = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    generator: 'scripts/build_league_context.mjs',
    window: { days: DAYS, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    method: 'Home-win rate, draw rate and mean combined score MEASURED from completed matches returned by the ESPN scoreboard over the window above. A league with fewer than 10 completed matches is written with sufficient:false and receives no baseline.',
    leagues: {},
    summary: { checked: 0, sufficient: 0, thin: 0, failed: 0 },
  };

  let n = 0;
  await pool(jobs, CONCURRENCY, async ({ sport, lg }) => {
    const url = `${ESPN_SITE_BASE}/${espnSportFor(sport.key)}/${lg.slug}/scoreboard?dates=${stamp(from)}-${stamp(to)}`;
    const r = await getJSON(url);
    n += 1;
    out.summary.checked += 1;
    const key = `${sport.key}:${lg.slug}`;
    if (!r.data) {
      out.leagues[key] = { sufficient: false, error: r.error, sourceUrl: url };
      out.summary.failed += 1;
      return;
    }
    const parsed = parseScoreboard(r.data, { sportKey: sport.key, leagueSlug: lg.slug, leagueName: lg.name });
    const ctx = buildLeagueContext(parsed.matches, { threeWay: sport.threeWay });
    ctx.leagueName = parsed.league.name || lg.name;
    ctx.sourceUrl = url;
    ctx.measuredFrom = out.window.from;
    ctx.measuredTo = out.window.to;
    ctx.completedMatches = parsed.matches.filter((m) => m.phase === 'results').length;
    ctx.pricedMatches = parsed.matches.filter((m) => m.odds?.moneyline?.home).length;
    out.leagues[key] = ctx;
    if (ctx.sufficient) out.summary.sufficient += 1; else out.summary.thin += 1;
    process.stderr.write(`${n}/${jobs.length} ${key}: ${ctx.sample} completed, home ${ctx.homeWinRate ?? '—'}, mean ${ctx.meanTotal ?? '—'}\n`);
  });

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  process.stderr.write(`\nwrote ${OUT}: ${out.summary.sufficient} leagues with a measured baseline, ${out.summary.thin} too thin, ${out.summary.failed} failed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
