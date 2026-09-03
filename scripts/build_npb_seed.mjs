#!/usr/bin/env node
/**
 * SportsPred — NPB seed builder (no network).
 *
 *   node scripts/build_npb_seed.mjs [--today 2026-09-04]
 *
 * Builds the same documents as scripts/collect_npb.mjs, but from the verbatim
 * page captures committed under tests/fixtures/npb_*.CAPTURE.md. Each capture
 * file names its URL and fetch date in its header, and every document written
 * here carries mode: "seed" so the site and the docs can say plainly that the
 * numbers came from those dated captures rather than from a live run.
 *
 * The CI collector overwrites these files on its first green run; the seed
 * exists so the NPB page works (and its tests run) before that happens.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNpbDocuments } from './npb_build_docs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'tests', 'fixtures');
const DATA = join(ROOT, 'data');
const arg = (flag, fallback = null) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : fallback; };
const TODAY = arg('--today', '2026-09-04');
const SEASON = 2026;

function capture(file) {
  const raw = readFileSync(join(FIX, file), 'utf8');
  const [header, ...rest] = raw.split('\n---\n');
  const url = header.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.]+$/, '') ?? null;
  const fetched = header.match(/fetched\s+(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const asOf = header.match(/dated\s+"([^"]+)"/)?.[1] ?? null;
  return { url, body: rest.join('\n---\n'), status: 200, ok: true, kind: 'capture-markdown', capturedAt: fetched, asOf, file };
}

const files = readdirSync(FIX).filter((f) => f.startsWith('npb_') && f.endsWith('.CAPTURE.md'));
const calendars = files.filter((f) => /^npb_calendar_\d{4}_\d{2}/.test(f)).map((f) => ({ month: Number(f.match(/_(\d{2})\.CAPTURE/)[1]), ...capture(f) }));
const schedules = files.filter((f) => /^npb_schedule_\d{4}_\d{2}_detail/.test(f)).map((f) => ({ month: Number(f.match(/_(\d{2})_detail/)[1]), ...capture(f) }));
const boxes = files.filter((f) => /^npb_jabox_/.test(f)).map(capture);
const std = { central: files.includes('npb_std_c.CAPTURE.md') ? capture('npb_std_c.CAPTURE.md') : null, pacific: files.includes('npb_std_p.CAPTURE.md') ? capture('npb_std_p.CAPTURE.md') : null };
for (const s of Object.values(std)) if (s?.asOf) { const d = new Date(s.asOf); if (!Number.isNaN(d.getTime())) s.asOfISO = d.toISOString().slice(0, 10); }

const docs = buildNpbDocuments(
  { calendars, standings: std, schedules, boxes },
  {
    season: SEASON, todayISO: TODAY, collector: 'scripts/build_npb_seed.mjs', mode: 'seed',
    irregularities: [{ id: 'NPB-SEED', severity: 'info', detail: `Documents built from ${files.length} dated page captures under tests/fixtures (see each file header for URL and fetch date); the CI collector replaces them on its first green run.` }],
  },
);
for (const [name, doc] of Object.entries(docs)) {
  writeFileSync(join(DATA, `npb_${name}.json`), `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`wrote data/npb_${name}.json`);
}
console.log(`tape ${docs.tape.count} (${docs.tape.draws} draws, ${docs.tape.postponed} postponed) · fixtures ${docs.fixtures.count} · upcoming ${docs.fixtures.upcoming} (${docs.fixtures.upcomingWithStarters} with starters) · lines ${docs.pitchers.count} · backtest ${docs.backtest.games} games · irregularities ${docs.provenance.irregularities.length}`);
