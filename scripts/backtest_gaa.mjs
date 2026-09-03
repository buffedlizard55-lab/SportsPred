#!/usr/bin/env node
/**
 * Walk-forward backtest over the committed GAA results tape.
 * Odds-gated Step 3 is never tested (IR-GAA-01).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreTapeLeans } from '../engine/gaa_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAPE = join(ROOT, 'data', 'gaa_results.json');
const RANKINGS = join(ROOT, 'data', 'gaa_rankings.json');
const OUT = join(ROOT, 'data', 'gaa_backtest.json');

function main() {
  const tape = JSON.parse(readFileSync(TAPE, 'utf8'));
  const rankings = JSON.parse(readFileSync(RANKINGS, 'utf8'));
  const card = scoreTapeLeans({ tape, rankings }, { asOfISO: (tape.as_of_utc || '').slice(0, 10) || null });
  const completed = (tape.matches || []).filter((m) => m.winner && (m.team_a?.name || m.player_a?.name));
  const byId = new Map(completed.map((m) => [m.id, m]));

  const rows = (card.scored || []).map((scored) => {
    const m = byId.get(scored.matchId);
    const score = m?.scoreline || (m ? `${m.total_a}-${m.total_b}` : null);
    return {
      id: scored.matchId,
      date: scored.dateISO,
      event: scored.event,
      round: scored.round,
      matchId: scored.matchId,
      match: scored.matchTitle,
      actualWinner: m?.winner ?? null,
      score,
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
    sport: 'GAA',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'Walk-forward over committed source-linked tape rows. Every match is scored only from matches recorded strictly before it. No odds tier is ever tested: there is no free price feed (IR-GAA-01), so the output measures model lean accuracy only and is NOT a betting record.',
    events: rows.length,
    summary: [
      { market: 'match_lean', graded, hits, hitRate: graded ? Number((hits / graded).toFixed(4)) : null },
      { market: 'bet_tiers', graded: 0, hits: 0, hitRate: null, note: 'untestable without a price feed (IR-GAA-01)' },
    ],
    rows,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const rate = graded ? Number((hits / graded).toFixed(3)) : null;
  console.log(`GAA backtest: ${rows.length} events, lean hits ${hits}/${graded} (${rate ?? 'n/a'})`);
}

main();
