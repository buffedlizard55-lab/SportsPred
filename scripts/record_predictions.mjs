/**
 * SportsPred — forward collection.
 *
 * Scores the current slate, writes the tips, and appends a durable record of
 * every selection so it can be graded later by scripts/backtest.mjs.
 *
 * This is what makes the project accumulate evidence instead of producing
 * one-off prose: each run is timestamped, keyed by OLBG event_id, and stored
 * with the confidence band the engine assigned at the time.
 *
 *     node scripts/record_predictions.mjs            # append new records
 *     node scripts/record_predictions.mjs --dry-run  # print, do not write
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { scoreCard } from '../engine/engine.js';
import { writeCard } from '../engine/writer.js';
import { slateToMatches } from '../engine/join.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const slate = await readJSON(path.join(DATA, 'slate.json'), null);
  if (!slate) {
    console.error('No data/slate.json. Run scripts/collect_olbg.py first.');
    return 1;
  }
  const players = await readJSON(path.join(DATA, 'players.json'), { players: {}, h2h: {} });

  const matches = slateToMatches(slate, players);
  const card = scoreCard(matches);
  const written = writeCard(card.results);

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const store = await readJSON(path.join(DATA, 'predictions.json'), { schema_version: 1, predictions: [] });
  const existing = new Set(store.predictions.map((p) => `${p.event_id}|${p.market}`));

  const added = [];
  for (const { match, result } of card.results) {
    if (result.favourite === null) continue; // unscored: record nothing rather than something
    for (const [market, m] of Object.entries(result.markets)) {
      const key = `${match.event_id}|${market}`;
      if (existing.has(key)) continue;
      added.push({
        event_id: match.event_id,
        match: `${match.home} v ${match.away}`,
        market,
        selection: result.favourite,
        band: m.band,
        score: m.score,
        price: null,          // never estimated; populated only when a price is sourced
        line: null,           // ditto for the handicap line
        ruleset: result.ruleset,
        missingFactors: result.missing.length,
        recorded_at_utc: now,
      });
    }
  }

  const summary = [
    `slate              : ${slate.events.length} matches (fetched ${slate.source.fetched_at_utc})`,
    `scored             : ${card.results.filter((r) => r.result.favourite).length}`,
    `unscored           : ${written.unscored.length}`,
    `tips generated     : ${written.tips.filter((t) => t.ok).length}`,
    `tips withheld      : ${written.tips.filter((t) => !t.ok).length}`,
    `output violations  : ${written.violations.length}`,
    `new records        : ${added.length}`,
  ].join('\n');

  if (process.argv.includes('--dry-run')) {
    console.log(summary);
    for (const a of added) console.log(`  ${a.event_id} ${a.market} ${a.selection} ${a.band} (${a.score})`);
    return 0;
  }

  store.predictions.push(...added);
  store.last_run_utc = now;
  await writeFile(path.join(DATA, 'predictions.json'), JSON.stringify(store, null, 2) + '\n');
  console.log(summary);
  console.log(`Wrote ${added.length} new record(s) to data/predictions.json`);

  // Persist the generated card too, so the site can show what was published.
  await writeFile(
    path.join(DATA, 'card.json'),
    JSON.stringify({
      generated_at_utc: now,
      ruleset: card.results[0]?.result.ruleset ?? null,
      trimmed: card.trimmed,
      trimmedReason: card.trimmedReason,
      tips: written.tips,
      unscored: written.unscored,
      violations: written.violations,
    }, null, 2) + '\n',
  );
  return 0;
}

main().then((c) => process.exit(c));
