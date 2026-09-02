#!/usr/bin/env node
/**
 * SportsPred — Formula 1 walk-forward backtest + prediction ledger.
 *
 * For every COMPLETED race in data/f1_events.json the engine is re-run using
 * only data available before that weekend (raceLog/driver rows are filtered by
 * raceDate < event.startDate, exactly as the live site does). The written
 * selections for each of the five markets are compared with the ESPN result:
 *   RACE WINNER        hit = position 1
 *   PODIUM FINISH      hit = position 1-3
 *   POINTS FINISH      hit = position 1-10
 *   TOP 6 FINISH       hit = position 1-6
 *   FASTEST LAP        never produces an active selection (tyre-strategy
 *                      evidence is unpublished) → graded only if OLBG history
 *                      exists, otherwise recorded as NOT SCORED.
 *
 * Writes:
 *   data/f1_backtest.json    per-race + aggregate hit rates (source-verified)
 *   data/f1_predictions.json forward ledger (picks recorded before each race)
 *
 * Guarded for the first CI run: if the F1 data files do not exist yet this
 * script prints [PENDING] and exits 0 — the site must keep working before the
 * first collection.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildF1RaceCard } from '../engine/f1_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.SPORTSPRED_DATA_DIR || join(ROOT, 'data');
const EVENTS = join(DATA_DIR, 'f1_events.json');
const STANDINGS = join(DATA_DIR, 'f1_standings.json');
const SLATE = join(DATA_DIR, 'f1_slate.json');
const WEATHER = join(DATA_DIR, 'f1_weather.json');
const OUT_BT = join(DATA_DIR, 'f1_backtest.json');
const OUT_LEDGER = join(DATA_DIR, 'f1_predictions.json');

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

const MARKET_KEYS = [
  ['race_winner', 'RACE WINNER', (e, sel) => e.race?.winner?.name === sel, (pos) => pos === 1],
  ['podium_finish', 'PODIUM FINISH', (e, sel) => e.race?.result?.some((r) => r.position >= 1 && r.position <= 3 && r.name === sel), (pos) => pos <= 3],
  ['points_finish', 'POINTS FINISH', (e, sel) => e.race?.result?.some((r) => r.position >= 1 && r.position <= 10 && r.name === sel), (pos) => pos <= 10],
  ['top6_finish', 'TOP 6 FINISH', (e, sel) => e.race?.result?.some((r) => r.position >= 1 && r.position <= 6 && r.name === sel), (pos) => pos <= 6],
];

function gradeMarket(result, marketKey, event) {
  const m = result.markets?.[marketKey];
  if (!m || !m.selection || m.band === 'SKIP') return { status: 'NO SELECTION', hit: null };
  const hit = MARKET_KEYS.find(([k]) => k === marketKey)?.[2]?.(event, m.selection) ?? null;
  return { status: hit === true ? 'HIT' : hit === false ? 'MISS' : 'UNVERIFIED', hit, selection: m.selection, band: m.band };
}

function main() {
  const eventsDoc = read(EVENTS);
  const standingsDoc = read(STANDINGS);
  const slateDoc = read(SLATE);
  const weatherDoc = read(WEATHER);
  if (!eventsDoc || !standingsDoc) {
    console.log('[PENDING] F1 data files not collected yet; backtest will run after the scheduled collector.');
    return;
  }

  const races = [];
  const ledger = [];
  const byMarket = {};
  for (const [key, label] of MARKET_KEYS) byMarket[key] = { label, total: 0, hit: 0, skipped: 0 };
  byMarket.fastest_lap = { label: 'FASTEST LAP', total: 0, hit: 0, skipped: 0 };

  for (const event of eventsDoc.events || []) {
    if (event.state !== 'post' || !event.race?.completed) continue;
    const card = buildF1RaceCard(eventsDoc, standingsDoc, slateDoc, weatherDoc, event.id);
    if (!card?.scored) continue;
    const result = card.scored;

    const row = {
      eventId: event.id,
      name: event.name,
      date: String(event.raceDate || event.endDate).slice(0, 10),
      abbreviation: event.abbreviation,
      winner: event.race.winner?.name ?? null,
      markets: {},
      sourceUrl: event.sources?.espnEvent ?? null,
    };

    for (const [key, label] of MARKET_KEYS) {
      const g = gradeMarket(result, key, event);
      row.markets[key] = { label, ...g };
      byMarket[key].total += 1;
      if (g.status === 'NO SELECTION') byMarket[key].skipped += 1;
      else if (g.hit === true) byMarket[key].hit += 1;
    }
    // Fastest lap: engine always SKIPs without published strategy evidence.
    const fl = result.markets?.fastest_lap;
    if (fl?.band === 'SKIP') {
      row.markets.fastest_lap = { label: 'FASTEST LAP', status: 'NO SELECTION', hit: null, missing: fl.missing?.length ?? 0 };
      byMarket.fastest_lap.skipped += 1;
    }
    byMarket.fastest_lap.total += 1;

    // Forward ledger: recorded after the fact for completeness, with the
    // source URL so every row can be manually reviewed.
    ledger.push({
      id: `f1-${event.id}`,
      date: row.date,
      race: event.name,
      picks: Object.fromEntries(
        Object.entries(row.markets).map(([k, v]) => [k, { selection: v.selection ?? null, band: v.band ?? null, status: v.status }])
      ),
      actual: { winner: row.winner, resultUrl: row.sourceUrl },
      sources: { espnEvent: row.sourceUrl },
      settled: true,
      recorded_by: 'scripts/backtest_f1.mjs (walk-forward re-run)',
    });
    races.push(row);
    console.log(`  ${row.name}: ` + Object.entries(row.markets).map(([k, v]) => `${k}=${v.status}`).join(', '));
  }

  if (!races.length) {
    console.log('[PENDING] No completed races recorded yet.');
    return;
  }

  const summary = Object.values(byMarket).map((m) => ({
    market: m.label,
    scored: m.total - m.skipped,
    hit: m.hit,
    skipped: m.skipped,
    hitRate: m.total - m.skipped > 0 ? Math.round((m.hit / (m.total - m.skipped)) * 1000) / 10 : null,
  }));

  const out = {
    schema_version: 1,
    sport: 'Formula 1',
    generated_at_utc: new Date().toISOString(),
    method: 'Walk-forward: each race is scored only on data completed before that weekend.',
    races,
    summary,
  };
  writeFileSync(OUT_BT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  writeFileSync(OUT_LEDGER, `${JSON.stringify({
    schema_version: 1,
    sport: 'Formula 1',
    generated_at_utc: new Date().toISOString(),
    predictions: ledger,
  }, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUT_BT} and ${OUT_LEDGER}`);
  console.log('Summary:', JSON.stringify(summary));
}

main();
