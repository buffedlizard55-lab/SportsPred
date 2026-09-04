#!/usr/bin/env node
/**
 * Append the current NRL card to the forward ledger (data/nrl_predictions.json).
 *
 *   node scripts/record_nrl_predictions.mjs            # re-record the live card
 *   node scripts/record_nrl_predictions.mjs --check    # verify the file parses
 *
 * The ledger is append-only in spirit: entries are keyed by match and market,
 * so re-running refreshes the model's current read of a fixture that has not
 * kicked off yet and never rewrites one that has. Once a match has a final
 * score on the tape, `scripts/settle_nrl.mjs` fills in the outcome.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildNrlDocs, buildNrlUpcomingCard } from '../engine/nrl_card.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const OUT = join(ROOT, 'data', 'nrl_predictions.json');
const j = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));

function main() {
  if (process.argv.includes('--check')) {
    if (!existsSync(OUT)) { console.error('data/nrl_predictions.json is missing.'); return 1; }
    const doc = j('nrl_predictions.json');
    console.log(`Ledger parses: ${(doc.predictions || []).length} entries, last run ${doc.last_run_utc}.`);
    return 0;
  }

  const docs = buildNrlDocs({
    matches: j('nrl_matches.json'),
    teams: j('nrl_teams.json'),
    slate: j('nrl_slate.json'),
    weather: j('nrl_weather.json'),
    origin: j('nrl_origin.json'),
  });
  const card = buildNrlUpcomingCard(docs);

  const previous = existsSync(OUT) ? j('nrl_predictions.json') : { predictions: [] };
  const byKey = new Map((previous.predictions || []).map((p) => [p.key, p]));
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  for (const tip of card.written.tips) {
    const result = card.scored.results[tip.matchIndex];
    const market = result.markets[tip.market];
    const key = `${tip.matchLabel}|${tip.market}`;
    byKey.set(key, {
      key,
      match: tip.matchLabel,
      date: result.match.date,
      kickoff_utc: result.ctx.kickoffUtc || null,
      round: result.match.round ?? null,
      market: tip.market,
      market_label: tip.marketLabel,
      selection: tip.skip ? 'SKIP' : tip.selection,
      band: tip.band,
      skip: tip.skip,
      score: market.score ?? null,
      coverage: market.coverage ?? null,
      skip_reason: market.skipReason || null,
      reference: market.referenceTotal ?? null,
      reference_source: market.referenceSource || null,
      tip: tip.text,
      recorded_at_utc: nowIso,
      // settlement is filled in by scripts/settle_nrl.mjs once the tape has a score
      settled: null,
    });
  }

  const payload = {
    schema_version: 1,
    sport: 'NRL',
    description: 'Forward ledger of every NRL prediction this engine has published. Appended by scripts/record_nrl_predictions.mjs in CI; settled against the tape afterwards. No prices are recorded because no key-less price feed exists.',
    last_run_utc: nowIso,
    ruleset_version: 'v1.0',
    counts: {
      entries: byKey.size,
      live: [...byKey.values()].filter((p) => !p.skip).length,
      skip: [...byKey.values()].filter((p) => p.skip).length,
    },
    predictions: [...byKey.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.match.localeCompare(b.match)),
  };
  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);
  console.log(`Wrote ${OUT}: ${payload.counts.live} live, ${payload.counts.skip} SKIP across ${new Set(payload.predictions.map((p) => p.match)).size} fixtures.`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('record_nrl_predictions.mjs')) process.exit(main());
