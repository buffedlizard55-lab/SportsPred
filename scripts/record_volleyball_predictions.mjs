#!/usr/bin/env node
/** Append-only, source-gated forward ledger for FIVB VNL Women only. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { enrichVolleyballMatch } from '../engine/volleyball_data.js';
import { scoreVolleyballMatch } from '../engine/volleyball_engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VNL = join(ROOT, 'data', 'volleyball_vnl.json');
const OUT = join(ROOT, 'data', 'volleyball_predictions.json');
const load = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };

export function recordVolleyballPredictions() {
  const vnl = load(VNL, { events: [], results: [] });
  const previous = load(OUT, { schema_version: 2, sport: 'Volleyball', scope: 'FIVB Volleyball Nations League — Women only', predictions: [] });
  const known = new Set((previous.predictions || []).map((row) => `${row.event_id}|${row.market}`));
  let added = 0;
  for (const event of vnl.events || []) {
    if (event.family !== 'vnl-women' || event.phase === 'results') continue;
    const input = enrichVolleyballMatch(event, vnl.results || [], vnl);
    const result = scoreVolleyballMatch(input);
    for (const market of ['win_match', 'set_score']) {
      const scored = result.markets[market];
      const key = `${event.event_id || event.id}|${market}`;
      if (known.has(key)) continue;
      previous.predictions.push({
        event_id: event.event_id || event.id,
        match: `${event.home} v ${event.away}`,
        date: event.dateISO || event.date,
        family: 'vnl-women',
        market,
        selection: scored.selection,
        outcome: scored.outcome || null,
        band: scored.band,
        score: scored.score,
        missing: result.missing,
        flags: result.flags,
        source_urls: input.source_urls || [event.source_url].filter(Boolean),
        ruleset: result.ruleset,
        recorded_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      });
      known.add(key);
      added += 1;
    }
  }
  writeFileSync(OUT, `${JSON.stringify(previous, null, 2)}\n`);
  console.log(`VNL Women forward ledger: ${added} new market rows.`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) recordVolleyballPredictions();
