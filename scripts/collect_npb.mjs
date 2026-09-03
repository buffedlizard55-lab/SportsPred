#!/usr/bin/env node
/**
 * SportsPred — NPB collector (runs in CI; needs outbound network to npb.jp).
 *
 *   node scripts/collect_npb.mjs                  # refresh every document
 *   node scripts/collect_npb.mjs --season 2026
 *   node scripts/collect_npb.mjs --box-days 45    # how far back to fetch Japanese box scores
 *   node scripts/collect_npb.mjs --dry-run        # fetch, print, write nothing
 *
 * WHAT IT WRITES (all provenance-tagged, all built by scripts/npb_build_docs.mjs)
 *   data/npb_fixtures.json     schedule rows: venue, roof, forecast icon, announced starters, links
 *   data/npb_tape.json         every regular-season result (draws + postponements included)
 *   data/npb_standings.json    both league tables with ties and per-opponent records
 *   data/npb_pitchers.json     per-game pitching lines from the Japanese box scores
 *   data/npb_backtest.json     walk-forward report over the tape
 *   data/npb_predictions.json  forward ledger, graded against the tape on later runs
 *   data/npb_provenance.json   endpoint register + irregularities
 *
 * SOURCES (official, no key): npb.jp English BIS calendar + standings pages;
 * npb.jp Japanese schedule detail (予告先発 announced starters, JMA weather
 * icon) and Japanese live box scores. See docs/NPB_SOURCES.md.
 *
 * HONESTY RULES
 *  - Every page records URL, HTTP status and fetch time. A failed page is
 *    recorded as failed; nothing is written from memory, no value is defaulted.
 *  - No odds are collected: there is no key-less three-way NPB price feed.
 *  - If npb.jp returns nothing usable, the previously committed documents are
 *    left untouched and the run exits non-zero so the failure is visible.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPB_BASE, parseScheduleDetail } from '../engine/npb_source.js';
import { buildNpbDocuments } from './npb_build_docs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const TIMEOUT = 25000;
const CONCURRENCY = 4;

const arg = (flag, fallback = null) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : fallback; };
const DRY = process.argv.includes('--dry-run');
const SEASON = Number(arg('--season', String(new Date().getUTCFullYear())));
const BOX_DAYS = Number(arg('--box-days', '45'));
const nowUtc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
// NPB publishes in JST; "today" for scheduling purposes is the JST date.
const todayJST = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

async function getText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'SportsPred-collector (+https://github.com/buffedlizard55-lab/SportsPred)', accept: 'text/html' } });
    const body = res.ok ? await res.text() : null;
    return { url, status: res.status, ok: res.ok, body, error: res.ok ? null : `HTTP ${res.status}`, capturedAt: nowUtc(), kind: 'html' };
  } catch (e) {
    return { url, status: 0, ok: false, body: null, error: String(e.message || e), capturedAt: nowUtc(), kind: 'html' };
  } finally { clearTimeout(t); }
}

async function pool(items, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(new Array(Math.min(CONCURRENCY, Math.max(items.length, 1))).fill(0).map(async () => {
    while (i < items.length) { const idx = i; i += 1; out[idx] = await worker(items[idx], idx); }
  }));
  return out;
}

function write(name, doc) {
  const path = join(DATA, name);
  if (DRY) { console.log(`  [dry-run] would write ${name}`); return; }
  writeFileSync(path, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`  wrote ${name}`);
}

function readJSON(name) {
  const p = join(DATA, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

async function main() {
  console.log(`npb collector — season ${SEASON}, JST today ${todayJST()}`);
  const today = todayJST();
  const month = Number(today.slice(5, 7));

  // 1. Calendars: index_04 (Mar–Apr) .. index_10.
  const calMonths = [4, 5, 6, 7, 8, 9, 10].filter((m) => m <= Math.max(month + 1, 4));
  const calendars = await pool(calMonths, async (m) => ({ month: m, ...(await getText(`${NPB_BASE}/bis/eng/${SEASON}/calendar/index_${String(m).padStart(2, '0')}.html`)) }));
  console.log(`  calendars: ${calendars.filter((c) => c.ok).length}/${calendars.length} ok`);

  // 2. Standings.
  const [central, pacific] = await Promise.all([getText(`${NPB_BASE}/bis/eng/${SEASON}/stats/std_c.html`), getText(`${NPB_BASE}/bis/eng/${SEASON}/stats/std_p.html`)]);
  console.log(`  standings: C ${central.status} / P ${pacific.status}`);

  // 3. Japanese schedule detail for this month and the next (announced starters + weather).
  const schedMonths = [...new Set([month, Math.min(month + 1, 11)])];
  const schedules = await pool(schedMonths, async (m) => ({ month: m, ...(await getText(`${NPB_BASE}/games/${SEASON}/schedule_${String(m).padStart(2, '0')}_detail.html`)) }));
  // Also the previous month so box-score links for the trailing window exist.
  if (BOX_DAYS > 0 && month > 3) schedules.push({ month: month - 1, ...(await getText(`${NPB_BASE}/games/${SEASON}/schedule_${String(month - 1).padStart(2, '0')}_detail.html`)) });
  console.log(`  schedules: ${schedules.filter((s) => s.ok).length}/${schedules.length} ok`);

  // 4. Japanese box scores for played games inside the trailing window.
  const cutoff = new Date(Date.now() - BOX_DAYS * 86400000).toISOString().slice(0, 10);
  const boxUrls = [];
  for (const s of schedules) {
    if (!s.body) continue;
    for (const r of parseScheduleDetail(s.body, { season: SEASON }).rows) {
      if (r.played && r.scoreUrl && r.dateISO >= cutoff) boxUrls.push(`${r.scoreUrl}box.html`);
    }
  }
  const boxes = await pool([...new Set(boxUrls)], async (u) => getText(u));
  console.log(`  box scores: ${boxes.filter((b) => b.ok).length}/${boxes.length} ok`);

  const okCals = calendars.filter((c) => c.ok).length;
  if (!okCals) { console.error('npb.jp calendars unreachable — leaving committed documents untouched'); return 2; }

  const docs = buildNpbDocuments(
    { calendars, standings: { central, pacific }, schedules, boxes },
    { season: SEASON, todayISO: today, collector: 'scripts/collect_npb.mjs', mode: 'live', priorPredictions: readJSON('npb_predictions.json') },
  );
  console.log(`  tape ${docs.tape.count} games (${docs.tape.draws} draws), fixtures ${docs.fixtures.count} (${docs.fixtures.upcoming} upcoming, ${docs.fixtures.upcomingWithStarters} with starters), pitching lines ${docs.pitchers.count}, irregularities ${docs.provenance.irregularities.length}`);

  // Parse-drift gate. The parsers were verified against dated page captures
  // (tests/fixtures/npb_*.CAPTURE.md) rendered as markdown, plus hand-built
  // HTML mirrors; the live HTML has never been parsed from inside the sandbox.
  // If the live parse yields fewer games than the committed tape, fewer than
  // 12 standings rows, or no fixtures, the page structure has drifted: leave
  // the committed documents untouched and fail loudly instead of publishing a
  // shrunken or empty layer.
  const prior = readJSON('npb_tape.json');
  const problems = [];
  if (prior?.count && docs.tape.count < prior.count) problems.push(`tape shrank from ${prior.count} to ${docs.tape.count} games`);
  const stdRows = (docs.standings.central?.teams?.length || 0) + (docs.standings.pacific?.teams?.length || 0);
  if (stdRows !== 12) problems.push(`standings parsed ${stdRows} rows, expected 12`);
  if (!docs.fixtures.count) problems.push('no fixtures parsed');
  if (docs.provenance.irregularities.some((i) => i.id === 'NPB-XCHECK')) problems.push('calendar/box-score score mismatch (NPB-XCHECK)');
  if (problems.length) {
    console.error(`NPB-PARSE-DRIFT: ${problems.join('; ')} — committed documents left untouched`);
    if (!DRY) return 3;
  }
  for (const [name, doc] of Object.entries(docs)) write(`npb_${name}.json`, doc);
  console.log('done');
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
