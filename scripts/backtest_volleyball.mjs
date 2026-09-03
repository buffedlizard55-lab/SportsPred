#!/usr/bin/env node
/** Walk-forward backtest for source-verified FIVB VNL Women rows only. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { enrichVolleyballMatch } from '../engine/volleyball_data.js';
import { scoreVolleyballMatch } from '../engine/volleyball_engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VNL = join(ROOT, 'data', 'volleyball_vnl.json');
const OUT = join(ROOT, 'data', 'volleyball_backtest.json');

function load(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function invert(score) { return /^\d-\d$/.test(String(score)) ? `${score[2]}-${score[0]}` : null; }

function main() {
  const source = load(VNL);
  const all = (source.results || []).filter((row) => row.family === 'vnl-women' && row.winner && row.setScore && row.startUtc)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const rows = all.map((match, index) => {
    const input = enrichVolleyballMatch({ ...match, phase: 'upcoming' }, all.slice(0, index), source);
    const result = scoreVolleyballMatch(input);
    const winner = result.markets.win_match;
    const set = result.markets.set_score;
    const actualSet = match.winner === match.home ? match.setScore : invert(match.setScore);
    return {
      id: match.id,
      date: match.dateISO || match.date,
      match: `${match.home} v ${match.away}`,
      actualWinner: match.winner,
      actualSetScore: actualSet,
      winPick: winner.selection,
      winBand: winner.band,
      winHit: winner.selection ? winner.selection === match.winner : null,
      setPick: set.selection,
      setBand: set.band,
      setHit: set.selection && actualSet ? set.selection.endsWith(actualSet) : null,
    };
  });
  const summarize = (field) => {
    const graded = rows.filter((row) => row[field] !== null);
    const hits = graded.filter((row) => row[field]).length;
    return { graded: graded.length, hits, hitRate: graded.length ? Number((hits / graded.length).toFixed(4)) : null };
  };
  const win = summarize('winHit');
  const set = summarize('setHit');
  const out = {
    schema_version: 2,
    sport: 'Volleyball',
    scope: 'FIVB Volleyball Nations League — Women only',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'Chronological walk-forward: every row uses only earlier source-verified VNL Women results. No NCAA, EuroVolley or club row is eligible.',
    events: rows.length,
    summary: [
      { market: 'match_winner', ...win, reason: win.graded ? undefined : 'No historical selection cleared the source/score gates.' },
      { market: 'set_score', ...set, reason: set.graded ? undefined : 'No historical selection cleared the source/score gates.' },
    ],
    rows,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`VNL Women backtest: ${rows.length} rows, winner ${win.hits}/${win.graded}, set ${set.hits}/${set.graded}`);
}
main();
