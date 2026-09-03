#!/usr/bin/env node
/**
 * Walk-forward backtest over the committed darts results tape.
 *
 * Every completed match in the tape is scored from matches that finished
 * strictly before it (same leak-free rule as the live card). Because no free
 * key-less price feed exists (IR-DARTS-01), a backtested "win" assessment
 * is reported as a model lean only — the odds-gated Step 3 bet tiers can
 * never be tested, exactly as the live card records.
 *
 * Pure offline run. Writes data/darts_backtest.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { scoreTapeLeans } from '../engine/darts_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAPE = join(ROOT, 'data', 'darts_results.json');
const RANKINGS = join(ROOT, 'data', 'darts_rankings.json');
const OUT = join(ROOT, 'data', 'darts_backtest.json');

function main() {
  const tape = JSON.parse(readFileSync(TAPE, 'utf8'));
  const rankings = JSON.parse(readFileSync(RANKINGS, 'utf8'));
  const card = scoreTapeLeans({ tape, rankings }, { asOfISO: (tape.as_of_utc || '').slice(0, 10) || null });

  const completed = (tape.matches || []).filter((m) => m.winner && m.player_a?.name && m.player_b?.name);
  const byId = new Map(completed.map((m) => [m.id, m]));

  const rows = (card.scored || []).map((scored) => {
    const m = byId.get(scored.matchId);
    return {
      id: scored.matchId,
      date: scored.dateISO,
      event: scored.event,
      round: scored.round,
      matchId: scored.matchId,
      match: scored.matchTitle,
      actualWinner: m?.winner ?? null,
      score: m ? `${m.score_a}-${m.score_b}` : null,
      lean: scored.leanName,
      modelScore: scored.score,
      band: scored.confidence.band,
      hit: m?.winner ? scored.leanName === m.winner : null,
      decision: scored.decision.bet,
      missing: scored.missing,
    };
  });

  const gradedRows = rows.filter((r) => r.modelScore > 0 && r.hit !== null);
  const graded = gradedRows.length;
  const hits = gradedRows.filter((r) => r.hit).length;

  const out = {
    schema_version: 1,
    sport: 'Darts',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'Walk-forward over committed source-linked tape rows. Every match is scored only from matches recorded strictly before it. No odds tier is ever tested: there is no free price feed (IR-DARTS-01), so the output measures model lean accuracy only and is NOT a betting record.',
    events: rows.length,
    summary: [
      { market: 'match_lean', graded, hits, hitRate: graded ? Number((hits / graded).toFixed(4)) : null },
      { market: 'bet_tiers', graded: 0, hits: 0, hitRate: null, note: 'untestable without a price feed (IR-DARTS-01)' },
    ],
    rows,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const rate = graded ? Number((hits / graded).toFixed(3)) : null;
  console.log(`Darts backtest: ${rows.length} events, lean hits ${hits}/${graded} (${rate ?? 'n/a'})`);
}

main();
