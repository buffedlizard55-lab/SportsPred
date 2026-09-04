#!/usr/bin/env node
/**
 * Walk-forward backtest for the NRL engine.
 *
 *   node scripts/backtest_nrl.mjs            # write data/nrl_backtest.json
 *   node scripts/backtest_nrl.mjs --check    # verify the committed file is current
 *
 * Method — and the three things it deliberately does not do:
 *
 *  1. No look-ahead. Every match is scored only from the tape as it stood
 *     before that match kicked off: form, ladder, byes, head-to-head and the
 *     reference total are all recomputed from matches with an earlier date.
 *  2. No prices. There is no key-less NRL price feed, so no ROI, no profit
 *     figure and no "units" column is produced. Only strike rates.
 *  3. No invented lines. Historical handicap and total lines are not published
 *     anywhere free, so the HANDICAP market is reported as unbacktested and the
 *     GAME TOTAL is settled against the rolling season mean total that the
 *     engine itself would have used on the day - clearly labelled, because it
 *     is not a market line.
 *
 * The weather factor is switched off for the backtest (option
 * `excludeWeather`), because no free historical forecast is committed. That
 * removes its ten points from the model rather than scoring it zero, so the
 * backtest measures the same engine with one fewer factor than the live card.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildNrlDocs, enrichNrlMatch } from '../engine/nrl_card.js';
import { scoreNrlMatch, CONFIDENCE } from '../engine/nrl_engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const OUT = join(ROOT, 'data', 'nrl_backtest.json');

/** First round scored: every club needs a form sample behind it. */
const START_ROUND = 7;

const j = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));

function rollingMeanTotal(completedBefore) {
  if (!completedBefore.length) return null;
  const sum = completedBefore.reduce((a, m) => a + m.homeScore + m.awayScore, 0);
  return Math.round((sum / completedBefore.length) * 100) / 100;
}

function bandStats(rows, key) {
  const stats = {};
  for (const band of [CONFIDENCE.HIGH, CONFIDENCE.MEDIUM, CONFIDENCE.LOW]) {
    const bandRows = rows.filter((r) => r.band === band);
    const hits = bandRows.filter((r) => r.correct === true).length;
    stats[band] = bandRows.length
      ? { selections: bandRows.length, hits, strike: Math.round((hits / bandRows.length) * 1000) / 1000 }
      : { selections: 0, hits: 0, strike: null };
  }
  const decided = rows.filter((r) => r.correct === true || r.correct === false);
  const hits = decided.filter((r) => r.correct === true).length;
  return {
    selections: decided.length,
    hits,
    strike: decided.length ? Math.round((hits / decided.length) * 1000) / 1000 : null,
    byBand: stats,
    ...(key ? {} : {}),
  };
}

function run() {
  const docs = buildNrlDocs({
    matches: j('nrl_matches.json'),
    teams: j('nrl_teams.json'),
    slate: j('nrl_slate.json'),
    weather: j('nrl_weather.json'),
    origin: j('nrl_origin.json'),
  });

  const rows = [];
  const winRows = [];
  const totalRows = [];
  let handicapLive = 0;

  const targets = docs.season.completed
    .filter((m) => (m.round ?? 0) >= START_ROUND)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  for (const m of targets) {
    const before = docs.season.completed.filter((x) => (x.date || '') < m.date);
    const asOf = {
      ...docs,
      season: { ...docs.season, completed: before },
      history: null, // rebuilt lazily per match below
      seasonMeanTotal: rollingMeanTotal(before),
      slate: null,   // no historical market lines exist
      weather: null, // no historical forecast is committed
    };
    // Recompute the ladder history from the as-of tape so "quality of
    // opposition" cannot see the future either.
    const { nrlLadderHistory } = asOfHistory;
    asOf.history = nrlLadderHistory(asOf.season);

    const ctx = enrichNrlMatch(m, asOf);
    const result = scoreNrlMatch(ctx, { excludeWeather: true });

    const homeWin = m.homeScore > m.awayScore;
    const winner = homeWin ? m.home : (m.awayScore > m.homeScore ? m.away : null);
    const actualTotal = m.homeScore + m.awayScore;

    const win = result.markets.win_match;
    const total = result.markets.game_total;
    const hcap = result.markets.handicap;

    const winRow = {
      date: m.date, round: m.round, match: `${m.home} v ${m.away}`,
      market: 'win_match',
      pick: win.skip ? 'SKIP' : win.selection,
      band: win.skip ? CONFIDENCE.SKIP : win.band,
      score: win.score,
      coverage: win.coverage,
      actual: winner || 'draw',
      result: `${m.homeScore}-${m.awayScore}`,
      correct: win.skip ? null : (winner != null && winner === win.selection),
    };
    rows.push(winRow);
    if (!win.skip) winRows.push(winRow);

    const refLine = total.referenceTotal;
    const totalRow = {
      date: m.date, round: m.round, match: `${m.home} v ${m.away}`,
      market: 'game_total',
      pick: total.skip ? 'SKIP' : total.direction,
      band: total.skip ? CONFIDENCE.SKIP : total.band,
      advantage: total.advantage,
      coverage: total.coverage,
      reference: refLine,
      actualTotal,
      correct: total.skip || refLine == null ? null : (total.direction === 'Over' ? actualTotal > refLine : actualTotal < refLine),
    };
    rows.push(totalRow);
    if (!total.skip) totalRows.push(totalRow);

    if (!hcap.skip) handicapLive += 1;
  }

  const payload = {
    schema_version: 1,
    sport: 'NRL',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ruleset_version: 'v1.0',
    method: [
      'Walk-forward: every fixture is scored only from matches with an earlier date, with the ladder, form, byes, head-to-head and reference total all recomputed at that point.',
      `First round scored: ${START_ROUND}, so that every club has a form sample behind it. Rounds 1-${START_ROUND - 1} are warm-up and are not counted.`,
      'No prices are used anywhere, so no return on investment is reported. Only strike rates against the actual result.',
      'The weather factor is excluded from the model for the backtest (no free historical forecast is committed), so the backtested engine carries ten fewer points than the live card.',
    ],
    settlement: {
      win_match: 'Correct if the picked club won the match. A drawn match counts as a miss, because the engine does not publish draws.',
      handicap: 'Not settled. No free source publishes historical NRL handicap lines, so publishing a strike rate would require inventing the line.',
      game_total: 'Settled against the rolling season mean total the engine would have used on the day, not against a market line. Reported separately and clearly labelled.',
    },
    window: {
      from: targets[0]?.date ?? null,
      to: targets[targets.length - 1]?.date ?? null,
      rounds: `${START_ROUND}-27`,
      fixtures: targets.length,
    },
    summary: {
      win_match: bandStats(winRows),
      game_total: bandStats(totalRows),
      handicap: {
        settled: false,
        liveSelections: handicapLive,
        reason: 'No free historical handicap line tape exists, so the HANDICAP market is reported as unbacktested rather than settled against an invented line.',
      },
    },
    rows,
  };

  return payload;
}

// Imported lazily so the module list at the top stays readable.
import * as asOfHistory from '../engine/nrl_data.js';

function main() {
  const check = process.argv.includes('--check');
  const payload = run();
  if (check) {
    if (!existsSync(OUT)) {
      console.error('data/nrl_backtest.json is missing — run `node scripts/backtest_nrl.mjs`.');
      return 1;
    }
    const committed = JSON.parse(readFileSync(OUT, 'utf8'));
    const same = committed.summary?.win_match?.selections === payload.summary.win_match.selections
      && committed.summary?.win_match?.hits === payload.summary.win_match.hits;
    if (!same) {
      console.error(`Backtest is stale: committed ${committed.summary?.win_match?.hits}/${committed.summary?.win_match?.selections}, recomputed ${payload.summary.win_match.hits}/${payload.summary.win_match.selections}.`);
      return 1;
    }
    console.log(`Backtest current: ${payload.summary.win_match.hits}/${payload.summary.win_match.selections} WIN MATCH.`);
    return 0;
  }
  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);
  const w = payload.summary.win_match;
  const t = payload.summary.game_total;
  console.log(`Wrote ${OUT}`);
  console.log(`  WIN MATCH   ${w.hits}/${w.selections} (${(w.strike * 100).toFixed(1)}%)  HIGH ${w.byBand.HIGH.hits}/${w.byBand.HIGH.selections} · MEDIUM ${w.byBand.MEDIUM.hits}/${w.byBand.MEDIUM.selections}`);
  console.log(`  GAME TOTAL  ${t.hits}/${t.selections} (${(t.strike * 100).toFixed(1)}%) against the rolling season mean, not a market line`);
  console.log(`  HANDICAP    not settled (no historical line tape)`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('backtest_nrl.mjs')) process.exit(main());
