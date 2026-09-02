#!/usr/bin/env node
/**
 * SportsPred — Greyhound walk-forward backtest.
 *
 * For every settled race in the committed meetings window, rebuild each
 * runner's profile from runs strictly BEFORE the race date, score the race
 * with the exact production engine (live=false, so the official SP feeds the
 * odds tier), apply the Step 3 card rules, and grade the written selection
 * against the official result. Walk-forward: at each race the form tape only
 * contains runs that would already have been raced — nothing future leaks in.
 *
 * Outputs data/greyhound_backtest.json with hit rate by confidence band and
 * SP-based level-stake returns (Settlement uses official starting prices,
 * which ARE published for finished races — this is the only odds evidence
 * available, and it is reported as such).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { racesFromDoc, historyIndex } from '../engine/greyhound_card.js';
import { scoreRace } from '../engine/greyhound_engine.js';
import { enrichRace } from '../engine/greyhound_data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const read = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf-8'));

/** Fractional SP ("11/4", "8/13F") -> decimal odds incl. stake. */
function decimalOdds(sp) {
  const m = String(sp || '').match(/^(\d+)\/(\d+)/);
  if (!m) return null;
  return (Number(m[1]) + Number(m[2])) / Number(m[2]);
}

function main() {
  const meetingsDoc = read('greyhound_meetings.json');
  const historyDoc = read('greyhound_history.json');
  const fullHistory = historyIndex(historyDoc);

  const races = racesFromDoc(meetingsDoc)
    .filter((r) => r.status === 'result')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));

  const picks = [];
  for (const race of races) {
    // Walk-forward tape: only runs dated before this race.
    const tape = new Map();
    for (const runner of race.runners || []) {
      const past = (fullHistory.get(String(runner.dogId)) || []).filter((r) => r.date && r.date < race.date);
      tape.set(String(runner.dogId), past);
    }
    const enriched = enrichRace(race, tape);
    // Attach official SP/position from the result to each runner so the odds
    // tier can use the starting price of the SETTLED race.
    for (const rn of enriched.runners) {
      const resultRow = race.runners.find((x) => String(x.dogId) === String(rn.dogId));
      if (resultRow) { rn.sp = resultRow.sp ?? rn.sp; rn.position = resultRow.position ?? rn.position; }
    }
    const scored = scoreRace(enriched, { live: false });
    if (scored.decision.action !== 'SELECT' || !scored.winner) continue;
    const winner = race.runners.find((r) => r.position === 1);
    const pickedRow = race.runners.find((r) => String(r.dogId) === String(scored.winner.dogId));
    const won = pickedRow?.position === 1;
    const sp = pickedRow?.sp || null;
    const dec = decimalOdds(sp);
    picks.push({
      raceId: race.raceId, track: race.track, date: race.date, time: race.time,
      grade: race.grade, distance: race.distance,
      selection: scored.winner.name, dogId: scored.winner.dogId,
      score: scored.winner.score, confidence: scored.decision.confidence,
      won, position: pickedRow?.position ?? null, sp,
      oddsChecked: !!scored.decision.oddsTested,
      winnerName: winner?.name ?? null, winnerSp: winner?.sp ?? null,
      pnl: won && dec ? dec - 1 : (dec ? -1 : 0),
    });
  }

  // Apply the daily card rules (cap and track spread) per raceday.
  const byDay = new Map();
  for (const p of picks) {
    if (!byDay.has(p.date)) byDay.set(p.date, []);
    byDay.get(p.date).push(p);
  }
  const kept = [];
  for (const [, dayPicks] of byDay) {
    const sorted = [...dayPicks].sort((a, b) => b.score - a.score);
    kept.push(...sorted.slice(0, 7));
  }

  const bands = { HIGH: { n: 0, wins: 0, pnl: 0 }, MEDIUM: { n: 0, wins: 0, pnl: 0 }, LOW: { n: 0, wins: 0, pnl: 0 } };
  for (const p of kept) {
    const b = bands[p.confidence] || bands.LOW;
    b.n += 1; if (p.won) b.wins += 1; b.pnl += p.pnl;
  }
  const summary = {};
  for (const [k, v] of Object.entries(bands)) {
    summary[k] = { n: v.n, wins: v.wins, hitRate: v.n ? +(v.wins / v.n).toFixed(3) : null, levelStakePnl: +v.pnl.toFixed(2) };
  }
  const graded = kept.length;
  const wins = kept.filter((p) => p.won).length;

  const doc = {
    schema_version: 1,
    sport: 'Greyhounds',
    generated_at_utc: new Date().toISOString(),
    method: 'Walk-forward over the committed GBGB window; form restricted to runs before each race; production engine with official SP feeding the odds tier for settled races.',
    window_races: races.length,
    graded,
    wins,
    hit_rate: graded ? +(wins / graded).toFixed(3) : null,
    level_stake_pnl: +kept.reduce((a, p) => a + p.pnl, 0).toFixed(2),
    odds_note: 'Settled-race starting prices are the only odds evidence GBGB publishes; live pre-race odds have no free key-less feed (IR-GH-01). PnL is level-stake SP and is illustrative.',
    by_confidence: summary,
    picks: kept,
  };

  fs.writeFileSync(path.join(DATA, 'greyhound_backtest.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log(`Greyhound backtest: ${graded} graded selections across ${races.length} settled races, hit rate ${doc.hit_rate ?? 'n/a'}, level-stake PnL ${doc.level_stake_pnl}`);
  for (const [k, v] of Object.entries(summary)) if (v.n) console.log(`  ${k}: ${v.wins}/${v.n} = ${v.hitRate} (PnL ${v.levelStakePnl})`);
}

main();
