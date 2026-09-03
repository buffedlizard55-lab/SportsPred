#!/usr/bin/env node
/**
 * Build data/leagues.json — the machine-verified league registry.
 *
 * For every sport in engine/registry.js this script:
 *   1. takes the candidate league slugs (or discovers numeric league ids from
 *      ESPN's core API when the sport uses them),
 *   2. calls the real scoreboard endpoint for each one,
 *   3. records the HTTP status, the league name ESPN itself returns, whether
 *      the payload contained events, and whether it contained odds.
 *
 * Nothing is asserted that was not observed. A league that does not answer 200
 * is written out with ok:false and a reason, and the site will not offer it.
 *
 * Run: node scripts/build_league_registry.mjs [--out data/leagues.json]
 * Requires outbound network (runs in CI; this repo's sandbox is firewalled).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SPORTS, ESPN_SITE_BASE, ESPN_CORE_BASE } from '../engine/registry.js';
import { espnSportFor } from '../engine/universal_engine.js';

const OUT = argValue('--out') || 'data/leagues.json';
const TIMEOUT = 20000;
const CONCURRENCY = 6;

/**
 * The scoreboard URL to prove a candidate league against.
 *
 * Most sports are addressed by a text slug (`football/eng.1`). Cricket is not:
 * ESPN addresses it by numeric series or league id, and its own slug for the
 * Vitality Blast is `8053`, so `cricket/t20-blast/scoreboard` does not exist and
 * probing it recorded a live league as dead. A candidate may therefore declare
 * the segment to probe with `espnSeriesId` or `espnLeagueId`; `slug` stays the
 * identity the site uses for the league either way.
 */
export function scoreboardUrl(candidate, espnSport, dateStamp) {
  const segment = String(candidate.espnSeriesId ?? candidate.espnLeagueId ?? candidate.slug);
  return `${ESPN_SITE_BASE}/${espnSport}/${segment}/scoreboard?dates=${dateStamp}`;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const status = res.status;
    if (!res.ok) return { status, data: null, error: `HTTP ${status}` };
    return { status, data: await res.json(), error: null };
  } catch (e) {
    return { status: 0, data: null, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i; i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }));
  return out;
}

/** Discover numeric league ids for sports that use them (rugby, volleyball). */
async function discover(coreSport) {
  const list = await getJSON(`${ESPN_CORE_BASE}/${coreSport}/leagues?limit=100`);
  if (!list.data?.items) return [];
  const refs = list.data.items.map((i) => String(i.$ref).replace('http://', 'https://'));
  const resolved = await pool(refs, CONCURRENCY, async (ref) => {
    const r = await getJSON(ref);
    if (!r.data) return null;
    return { slug: String(r.data.slug || r.data.id), name: r.data.displayName || r.data.name || String(r.data.id), id: String(r.data.id) };
  });
  return resolved.filter(Boolean);
}

function todayStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  const out = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    generator: 'scripts/build_league_registry.mjs',
    method: 'Each league below was proven by calling its ESPN scoreboard endpoint and recording the HTTP status and the league name ESPN returned. Leagues that did not answer 200 are retained with ok:false so the failure is visible rather than silently dropped.',
    sports: {},
    summary: { checked: 0, ok: 0, failed: 0 },
  };

  const stamp = todayStamp();

  for (const sport of SPORTS) {
    if (!sport.espnSport) {
      out.sports[sport.key] = { espnSport: null, leagues: [], note: (sport.notes || []).join(' ') || 'No ESPN feed for this sport.' };
      continue;
    }
    const espnSport = espnSportFor(sport.key);
    let candidates = sport.candidateLeagues || [];
    if (sport.discover?.core) {
      process.stderr.write(`discovering ${sport.key} leagues from the core API…\n`);
      const found = await discover(sport.discover.core);
      candidates = found.map((f) => ({ slug: f.slug, name: f.name }));
    }

    const rows = await pool(candidates, CONCURRENCY, async (c) => {
      const url = scoreboardUrl(c, espnSport, stamp);
      const r = await getJSON(url);
      const leagueNode = Array.isArray(r.data?.leagues) ? r.data.leagues[0] : null;
      const events = Array.isArray(r.data?.events) ? r.data.events.length : 0;
      const hasOdds = (r.data?.events || []).some((e) => (e.competitions?.[0]?.odds || []).length > 0);
      return {
        slug: c.slug,
        name: leagueNode?.name || c.name,
        candidateName: c.name,
        espnLeagueId: leagueNode?.id ?? null,
        ok: r.status === 200 && Boolean(r.data),
        status: r.status,
        error: r.error,
        eventsOnCheckDate: events,
        oddsSeen: hasOdds,
        checkedUrl: url,
      };
    });

    for (const row of rows) {
      out.summary.checked += 1;
      if (row.ok) out.summary.ok += 1; else out.summary.failed += 1;
    }

    out.sports[sport.key] = {
      espnSport,
      threeWay: sport.threeWay === true,
      leagues: rows.sort((a, b) => a.name.localeCompare(b.name)),
    };
    process.stderr.write(`${sport.key}: ${rows.filter((r) => r.ok).length}/${rows.length} ok\n`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  process.stderr.write(`\nwrote ${OUT}: ${out.summary.ok}/${out.summary.checked} leagues verified\n`);
}

// Importable for its pure helpers without triggering a network run.
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });
