#!/usr/bin/env node
/**
 * Settle the NRL forward ledger against the tape.
 *
 *   node scripts/settle_nrl.mjs
 *
 * For every prediction in data/nrl_predictions.json whose fixture now has a
 * final score, record the outcome. Totals are settled against the reference
 * total stored with the prediction (the market line where one was published,
 * otherwise the season mean) — never against a line invented after the fact.
 * The handicap is left unsettled, because no free source publishes the
 * historical line it was struck at.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildNrlDocs } from '../engine/nrl_card.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const j = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));

const docs = buildNrlDocs({
  matches: j('nrl_matches.json'),
  teams: j('nrl_teams.json'),
  slate: j('nrl_slate.json'),
  weather: j('nrl_weather.json'),
  origin: j('nrl_origin.json'),
});

const ledger = j('nrl_predictions.json');
const results = new Map();
for (const m of docs.season.completed) results.set(`${m.date}|${m.home} v ${m.away}`, m);

let settled = 0;
let pending = 0;
for (const p of ledger.predictions || []) {
  const match = results.get(`${p.date}|${p.match}`);
  if (!match || p.settled) { if (!p.settled) pending += 1; continue; }
  const homeWin = match.homeScore > match.awayScore;
  const winner = homeWin ? match.home : (match.awayScore > match.homeScore ? match.away : null);
  const total = match.homeScore + match.awayScore;
  const outcome = {
    score: `${match.homeScore}-${match.awayScore}`,
    settled_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };
  if (p.market === 'win_match') {
    outcome.correct = winner != null && winner === p.selection;
    outcome.winner = winner || 'draw';
  } else if (p.market === 'game_total') {
    const line = p.reference ?? null;
    if (line == null) outcome.correct = null;
    else outcome.correct = p.selection === 'Over' ? total > line : total < line;
    outcome.total = total;
    outcome.reference = line;
  } else {
    outcome.correct = null;
    outcome.note = 'Not settled: no free source publishes the historical handicap line.';
  }
  p.settled = outcome;
  settled += 1;
}

ledger.last_settled_utc = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
ledger.counts = {
  ...(ledger.counts || {}),
  settled: (ledger.predictions || []).filter((p) => p.settled && p.settled.correct !== null).length,
  pending,
};
writeFileSync(join(ROOT, 'data', 'nrl_predictions.json'), `${JSON.stringify(ledger, null, 1)}\n`);
console.log(`Settled ${settled} predictions, ${pending} still pending.`);
