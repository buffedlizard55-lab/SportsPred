#!/usr/bin/env node
/** Append-only forward ledger for volleyball (WIN MATCH + SET SCORE). */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { enrichVolleyballMatch } from '../engine/volleyball_data.js';
import { scoreVolleyballMatch } from '../engine/volleyball_engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATCHES = join(ROOT, 'data', 'volleyball_matches.json');
const TAPE = join(ROOT, 'data', 'volleyball_tape.json');
const SLATE = join(ROOT, 'data', 'volleyball_slate.json');
const PRED = join(ROOT, 'data', 'volleyball_predictions.json');

function loadJSON(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function recordVolleyballPredictions() {
  const matchesDoc = loadJSON(MATCHES, { matches: [] });
  const tapeDoc = loadJSON(TAPE, { matches: [] });
  const slateDoc = loadJSON(SLATE, { events: [] });
  const predDoc = loadJSON(PRED, { schema_version: 1, sport: 'Volleyball', predictions: [] });
  const existing = new Set((predDoc.predictions || []).map((p) => `${p.event_id}|${p.market}`));
  let added = 0;

  for (const m of matchesDoc.matches || []) {
    if (m.phase === 'results') continue;
    const enriched = enrichVolleyballMatch(m, tapeDoc.matches || []);
    const ev = (slateDoc.events || []).find((e) => String(e.event_id) === String(m.event_id));
    if (ev) enriched.olbg = ev;
    const scored = scoreVolleyballMatch(enriched);
    for (const market of ['win_match', 'set_score']) {
      const mk = scored.markets[market];
      if (!mk) continue;
      const key = `${m.id || m.event_id}|${market}`;
      if (existing.has(key)) continue;
      predDoc.predictions.push({
        event_id: m.id || m.event_id,
        match: `${m.home} v ${m.away}`,
        date: m.dateISO || m.date,
        family: m.family,
        market,
        selection: mk.selection,
        outcome: mk.outcome || null,
        band: mk.band,
        score: mk.score,
        missing: scored.missing,
        ruleset: scored.ruleset,
        recorded_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      });
      existing.add(key);
      added += 1;
    }
  }

  writeFileSync(PRED, `${JSON.stringify(predDoc, null, 2)}\n`);
  console.log(`Volleyball forward collection: ${added} new rows. Total: ${predDoc.predictions.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  recordVolleyballPredictions();
}
