#!/usr/bin/env node
/**
 * SportsPred — build data/surfaces.json from the verified Sackmann mirrors.
 *
 * WHY THIS EXISTS
 * ---------------
 * ESPN's public tennis API (the live source for the scoreboard) publishes
 * tournament name, round, venue and an `indoor` flag, but it does NOT publish
 * the court surface. The master prompt makes surface a 20-point factor and
 * calls clay form "the single most predictive surface factor", so the site
 * cannot simply guess it.
 *
 * Rather than hardcode a hand-written list (which would be exactly the kind of
 * unsourced assertion this project forbids), the surface for each tournament is
 * DERIVED FROM RECORDED MATCH DATA: the Sackmann dataset records a `surface`
 * column on every match row. A tournament's surface is the surface its own
 * matches were actually played on.
 *
 * PROVENANCE
 *   Kadantte/tennis_atp                  (fork of Jeff Sackmann's tennis_atp)
 *   Aneeshers/tennis-sackmann-archive    (ATP + WTA archival mirror)
 *   Both CC BY-NC-SA 4.0, attributed to Jeff Sackmann. See docs/SOURCES.md.
 *
 * HONESTY RULES ENFORCED HERE
 *   - A tournament whose rows disagree on surface below `MIN_AGREEMENT` is
 *     written with surface `null` and listed under `conflicts`, never coerced.
 *   - Every entry records how many match rows supported it and which years,
 *     so any single line of the output can be traced back to source rows.
 *   - Nothing is inferred from the tournament NAME. "Indian Wells" is hard
 *     because its rows say Hard, not because of anything we believe about it.
 *
 * Usage: node scripts/build_surface_map.mjs [--out data/surfaces.json]
 * Requires network access to api.github.com (works in this sandbox and in CI).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const YEARS = [2024, 2025, 2026];
const MIN_AGREEMENT = 0.9; // ≥90% of a tournament's rows must name one surface

const SOURCES = [
  { tour: 'atp', repo: 'Kadantte/tennis_atp', path: (y) => `atp_matches_${y}.csv` },
  { tour: 'wta', repo: 'Aneeshers/tennis-sackmann-archive', path: (y) => `wta/wta_matches_${y}.csv` },
];

function ghHeaders() {
  const h = { Accept: 'application/vnd.github.raw', 'User-Agent': 'SportsPred' };
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function fetchCsv(repo, path) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`${repo}/${path} -> HTTP ${r.status}`);
  return r.text();
}

/** Minimal RFC4180-ish parser; the Sackmann files are plain comma CSV. */
function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.trim().length);
  if (!lines.length) return [];
  const head = lines[0].split(',');
  const iName = head.indexOf('tourney_name');
  const iSurf = head.indexOf('surface');
  const iLevel = head.indexOf('tourney_level');
  const iDate = head.indexOf('tourney_date');
  if (iName < 0 || iSurf < 0) throw new Error('unexpected CSV header');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const name = (c[iName] || '').trim();
    // Canonical case: the mirrors contain both "Clay" and "clay" for the same
    // event (e.g. W50 Pazardzhik), which would otherwise register as a false
    // surface conflict. Casing is normalised; the surface value is not changed.
    const rawSurface = (c[iSurf] || '').trim();
    const surface = rawSurface
      ? rawSurface[0].toUpperCase() + rawSurface.slice(1).toLowerCase()
      : '';
    if (!name || !surface) continue;
    out.push({ name, surface, level: (c[iLevel] || '').trim(), date: (c[iDate] || '').trim() });
  }
  return out;
}

/** Normalised join key: case/punctuation-insensitive tournament name. */
export function normaliseTournament(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\b(atp|wta)\b/g, ' ')
    .replace(/\b(masters|open|championships?|cup|classic|international|tournament)\b/g, ' $1 ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function main() {
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx > -1 ? process.argv[outIdx + 1] : 'data/surfaces.json';

  /** key -> { tour, display, counts:{surface:n}, years:Set, levels:Set } */
  const agg = new Map();
  const fetched = [];

  for (const src of SOURCES) {
    for (const y of YEARS) {
      let rows;
      try {
        rows = parseCsv(await fetchCsv(src.repo, src.path(y)));
      } catch (e) {
        console.error(`  ! skipped ${src.tour} ${y}: ${e.message}`);
        continue;
      }
      fetched.push({ tour: src.tour, year: y, repo: src.repo, path: src.path(y), rows: rows.length });
      console.error(`  · ${src.tour} ${y}: ${rows.length} rows`);
      for (const r of rows) {
        const key = `${src.tour}|${normaliseTournament(r.name)}`;
        if (!agg.has(key)) {
          agg.set(key, {
            tour: src.tour, display: r.name, counts: {}, years: new Set(), levels: new Set(),
          });
        }
        const e = agg.get(key);
        e.counts[r.surface] = (e.counts[r.surface] || 0) + 1;
        e.years.add(y);
        if (r.level) e.levels.add(r.level);
      }
    }
  }

  if (!fetched.length) {
    console.error('No source files could be fetched — refusing to write a partial map.');
    process.exit(1);
  }

  const tournaments = {};
  const conflicts = [];
  for (const [key, e] of [...agg.entries()].sort()) {
    const total = Object.values(e.counts).reduce((a, b) => a + b, 0);
    const [top, n] = Object.entries(e.counts).sort((a, b) => b[1] - a[1])[0];
    const agreement = n / total;
    const entry = {
      tour: e.tour,
      name: e.display,
      surface: agreement >= MIN_AGREEMENT ? top : null,
      agreement: Number(agreement.toFixed(3)),
      matches: total,
      years: [...e.years].sort(),
      levels: [...e.levels].sort(),
      counts: e.counts,
    };
    tournaments[key] = entry;
    if (entry.surface === null) conflicts.push({ key, counts: e.counts });
  }

  const doc = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method:
      'Surface per tournament derived from the surface column of recorded match rows in the '
      + 'Sackmann dataset mirrors. A tournament needs >=90% agreement across its own rows or its '
      + 'surface is left null. Nothing is inferred from tournament names.',
    min_agreement: MIN_AGREEMENT,
    attribution: 'Jeff Sackmann tennis datasets, CC BY-NC-SA 4.0, via verified mirrors.',
    sources: SOURCES.map((s) => ({
      tour: s.tour, repo: s.repo, url: `https://github.com/${s.repo}`,
    })),
    files_used: fetched,
    counts: {
      tournaments: Object.keys(tournaments).length,
      resolved: Object.values(tournaments).filter((t) => t.surface).length,
      conflicts: conflicts.length,
    },
    conflicts,
    tournaments,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.error(
    `\nWrote ${outPath}: ${doc.counts.tournaments} tournaments, `
    + `${doc.counts.resolved} resolved, ${doc.counts.conflicts} unresolved.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
