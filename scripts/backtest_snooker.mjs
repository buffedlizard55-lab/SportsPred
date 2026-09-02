#!/usr/bin/env node
/**
 * Walk-forward backtest over the committed snooker results tape.
 *
 * Every completed match in the tape is scored from matches that finished
 * strictly before it (same leak-free rule as the live card). Because no free
 * key-less price feed exists (IR-SNOOKER-01), a backtested "win" assessment
 * is reported as a model lean only — the odds-gated Step 3 bet tiers can
 * never be tested, exactly as the live card records.
 *
 * Pure offline run. Writes data/snooker_backtest.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { prepareFixture } from '../engine/snooker_data.js';
import { scoreMatch } from '../engine/snooker_engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAPE = join(ROOT, 'data', 'snooker_results.json');
const RANKINGS = join(ROOT, 'data', 'snooker_rankings.json');
const OUT = join(ROOT, 'data', 'snooker_backtest.json');

function main() {
  const tape = JSON.parse(readFileSync(TAPE, 'utf8'));
  const rankings = JSON.parse(readFileSync(RANKINGS, 'utf8'));
  const asOfISO = (tape.as_of_utc || '').slice(0, 10) || null;

  // Only rows that truly have a winner can be graded; Championship League
  // draws are recorded with winner=null and are never scored as a pick.
  const completed = (tape.matches || [])
    .filter((m) => m.winner && m.player_a?.name && m.player_b?.name)
    .sort((a, b) => (String(a.date || a.event_end || '') < String(b.date || b.event_end || '') ? -1 : 1));

  const rows = [];
  for (const m of completed) {
    const fx = {
      id: m.id,
      dateISO: m.date || m.event_end,
      event: m.event,
      round: m.round,
      playerA: { name: m.player_a.name, country: m.player_a.country },
      playerB: { name: m.player_b.name, country: m.player_b.country },
      status: 'result',
    };
    const prep = prepareFixture(fx, {
      tape: { matches: completed.filter((x) => x.id !== m.id) },
      rankings,
      asOfISO: fx.dateISO,
    });
    const scored = scoreMatch(prep.match, {
      profiles: prep.profiles,
      h2h: prep.h2h,
      roundTier: prep.roundTier,
      dateISO: fx.dateISO,
      asOfISO: fx.dateISO,
      rankA: prep.match.playerA.rank,
      rankB: prep.match.playerB.rank,
    });
    rows.push({
      id: m.id,
      date: m.date || m.event_end,
      event: m.event,
      round: m.round,
      matchId: scored.matchId,
      match: scored.matchTitle,
      actualWinner: m.winner,
      score: `${m.score_a}-${m.score_b}`,
      lean: scored.leanName,
      modelScore: scored.score,
      band: scored.confidence.band,
      hit: scored.leanName === m.winner,
      decision: scored.decision.bet,
      missing: scored.missing,
    });
  }

  // A lean is only graded when the engine actually measured something:
  // a non-zero score and a non-tie between the sides. An all-missing card
  // scores 0-0 and must never be counted as a "hit" just because the tape
  // has a result. The bet band is still SKIP (no price feed, IR-SNOOKER-01)
  // and the summary says clearly this is lean accuracy, not a betting record.
  const gradedRows = rows.filter((r) => r.modelScore > 0);
  const graded = gradedRows.length;
  const hits = gradedRows.filter((r) => r.hit).length;

  const out = {
    schema_version: 1,
    sport: 'Snooker',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'Walk-forward over committed source-linked tape rows. Every match is scored only from matches recorded strictly before it. No odds tier is ever tested: there is no free price feed (IR-SNOOKER-01), so the output measures model lean accuracy only and is NOT a betting record.',
    events: rows.length,
    summary: [
      { market: 'match_lean', graded, hits, hitRate: graded ? Number((hits / graded).toFixed(4)) : null },
      { market: 'bet_tiers', graded: 0, hits: 0, hitRate: null, note: 'untestable without a price feed (IR-SNOOKER-01)' },
    ],
    rows,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const rate = graded ? Number((hits / graded).toFixed(3)) : null;
  console.log(`Snooker backtest: ${rows.length} events, lean hits ${hits}/${graded} (${rate ?? 'n/a'})`);
}

main();
