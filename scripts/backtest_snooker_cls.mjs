#!/usr/bin/env node
/**
 * Walk-forward backtest of the Championship League Snooker overlay.
 * Every card is scored using only matches that finished strictly earlier,
 * then settled against the published result. No return on investment is
 * published: no price feed exists, so any ROI figure would be invented.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backtest } from '../engine/snooker_cls_card.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/snooker_cls_backtest.json');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/snooker_cls.json'), 'utf8'));

const result = { ...backtest(doc, { edition: 'ranking' }), source: doc.event.sources[0], generated_from: 'data/snooker_cls.json' };

if (process.argv.includes('--check')) {
  const existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const same = JSON.stringify(existing) === JSON.stringify(result);
  console.log(same ? 'snooker_cls_backtest.json is up to date' : 'snooker_cls_backtest.json is STALE');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${OUT}: ${result.graded} graded, ${result.skipped} skipped`);
for (const [m, v] of Object.entries(result.byMarket)) console.log(`  ${m}: ${v.correct}/${v.graded}`);
