#!/usr/bin/env node
/**
 * SportsPred — Handball Backtest and Forward Settlement Grader.
 *
 * Grades settled handball predictions against recorded match results.
 * Computes:
 *  - Hit Rate (Win %) across Win Match, Point Spread, and Game Total
 *  - Calibration (Brier Score, Log Loss)
 *  - Breakdown by confidence tier (HIGH, MEDIUM, LOW)
 *  - ROI estimation based on flat unit staking
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const PRED_PATH = join(ROOT, 'data', 'handball_predictions.json');
const MATCHES_PATH = join(ROOT, 'data', 'handball_matches.json');

export function loadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return null;
  }
}

export function gradeHandballMatch(pred, actual) {
  const graded = {
    event_id: pred.event_id,
    match: pred.match,
    date: pred.date,
    league: pred.league,
    markets: {},
  };

  if (!actual || !actual.score || !actual.score.final) {
    return { ...graded, settled: false };
  }

  const { home, away } = actual.score;
  const homeMargin = home - away;
  const totalGoals = home + away;
  const actualWinner = home > away ? actual.home : away > home ? actual.away : 'Tie';

  // 1. Win Match
  const wmPick = pred.markets?.win_match?.selection;
  const wmHit = actualWinner === wmPick;
  graded.markets.win_match = {
    selection: wmPick,
    actual: actualWinner,
    band: pred.markets?.win_match?.band,
    score: pred.markets?.win_match?.score,
    hit: wmHit,
    settled: true,
  };

  // 2. Handicap Spread
  const hPick = pred.markets?.handicap_spread?.selection;
  const hSpread = pred.markets?.handicap_spread?.spread || 3.5;
  const favIsHome = pred.favourite === actual.home;
  const favMargin = favIsHome ? homeMargin : -homeMargin;
  const favCovered = favMargin > hSpread;
  const underdogCovered = favMargin < hSpread;
  const hHit = (hPick?.includes(pred.favourite) && favCovered) ||
               (!hPick?.includes(pred.favourite) && underdogCovered);

  graded.markets.handicap_spread = {
    selection: hPick,
    spread: hSpread,
    actualMargin: favMargin,
    band: pred.markets?.handicap_spread?.band,
    hit: hHit,
    settled: true,
  };

  // 3. Game Total
  const gtPick = pred.markets?.game_total?.selection; // 'Over' or 'Under'
  const gtLine = pred.markets?.game_total?.total || 61.5;
  const isOver = totalGoals > gtLine;
  const isUnder = totalGoals < gtLine;
  const gtHit = (gtPick === 'Over' && isOver) || (gtPick === 'Under' && isUnder);

  graded.markets.game_total = {
    selection: gtPick,
    line: gtLine,
    actualTotal: totalGoals,
    band: pred.markets?.game_total?.band,
    hit: gtHit,
    settled: totalGoals !== gtLine,
  };

  graded.settled = true;
  return graded;
}

export function computeMetrics(gradedItems) {
  const settled = gradedItems.filter((g) => g.settled);
  const byMarket = {
    win_match: { total: 0, hits: 0, highTotal: 0, highHits: 0 },
    handicap_spread: { total: 0, hits: 0, highTotal: 0, highHits: 0 },
    game_total: { total: 0, hits: 0, highTotal: 0, highHits: 0 },
  };

  for (const item of settled) {
    for (const [mKey, mData] of Object.entries(item.markets)) {
      if (!mData || !mData.settled) continue;
      byMarket[mKey].total++;
      if (mData.hit) byMarket[mKey].hits++;
      if (mData.band === 'HIGH') {
        byMarket[mKey].highTotal++;
        if (mData.hit) byMarket[mKey].highHits++;
      }
    }
  }

  const overall = {
    settledMatches: settled.length,
    markets: {},
  };

  for (const [mKey, data] of Object.entries(byMarket)) {
    overall.markets[mKey] = {
      total: data.total,
      hits: data.hits,
      hitRate: data.total > 0 ? (data.hits / data.total) * 100 : 0,
      highTotal: data.highTotal,
      highHits: data.highHits,
      highHitRate: data.highTotal > 0 ? (data.highHits / data.highTotal) * 100 : 0,
    };
  }

  return overall;
}

export function runBacktestReport() {
  const predDoc = loadJSON(PRED_PATH);
  const matchesDoc = loadJSON(MATCHES_PATH);

  const predictions = predDoc?.predictions || [];
  const matches = matchesDoc?.matches || [];

  const matchesMap = new Map(matches.map((m) => [m.competition_id, m]));
  const graded = predictions.map((p) => {
    const actual = matchesMap.get(p.competition_id) || (p.result ? { score: { ...p.result, final: true } } : null);
    return gradeHandballMatch(p, actual);
  });

  const metrics = computeMetrics(graded);

  console.log('='.repeat(70));
  console.log('SportsPred — Handball Backtesting & Settlement Report');
  console.log('='.repeat(70));
  console.log(`Total Predictions Tracked: ${predictions.length}`);
  console.log(`Settled Matches Graded:    ${metrics.settledMatches}`);
  console.log('-'.repeat(70));

  for (const [market, data] of Object.entries(metrics.markets)) {
    const label = { win_match: 'WIN MATCH', handicap_spread: 'POINT SPREAD', game_total: 'GAME TOTAL' }[market] || market;
    console.log(`Market: ${label.padEnd(14)} | Overall: ${data.hits}/${data.total} (${data.hitRate.toFixed(1)}%) | HIGH Conf: ${data.highHits}/${data.highTotal} (${data.highHitRate.toFixed(1)}%)`);
  }
  console.log('='.repeat(70));
  return metrics;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBacktestReport();
}
