#!/usr/bin/env node
/**
 * SportsPred — Forward Prediction Recorder for Handball.
 *
 * Automatically captures current slate predictions and appends them
 * to data/handball_predictions.json for forward-testing and historical tracking.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { scoreHandballMatch } from '../engine/handball_engine.js';
import { enrichHandballMatch } from '../engine/handball_data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const MATCHES_PATH = join(ROOT, 'data', 'handball_matches.json');
const TEAMS_PATH = join(ROOT, 'data', 'handball_teams.json');
const SLATE_PATH = join(ROOT, 'data', 'handball_slate.json');
const PRED_PATH = join(ROOT, 'data', 'handball_predictions.json');

function loadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return null;
  }
}

export function recordPredictions() {
  const matchesDoc = loadJSON(MATCHES_PATH) || { matches: [] };
  const teamsDoc = loadJSON(TEAMS_PATH) || { teams: {} };
  const slateDoc = loadJSON(SLATE_PATH) || { events: [] };
  const predDoc = loadJSON(PRED_PATH) || { schema_version: 1, sport: 'Handball', predictions: [] };

  const existingMap = new Map((predDoc.predictions || []).map((p) => [p.competition_id, p]));
  let added = 0;

  for (const m of matchesDoc.matches) {
    const enriched = enrichHandballMatch(m, teamsDoc, slateDoc);
    const scored = scoreHandballMatch(enriched);

    const record = {
      event_id: m.olbg_event_id || m.competition_id,
      competition_id: m.competition_id,
      date: m.date,
      match: `${m.home} v ${m.away}`,
      league: m.league,
      favourite: scored.favourite,
      markets: {
        win_match: {
          selection: scored.markets?.win_match?.selection,
          band: scored.markets?.win_match?.band,
          score: scored.markets?.win_match?.score,
          settled: m.phase === 'results',
        },
        handicap_spread: {
          selection: scored.markets?.handicap_spread?.selection,
          band: scored.markets?.handicap_spread?.band,
          score: scored.markets?.handicap_spread?.score,
          spread: m.handicapSpread || 3.5,
          settled: m.phase === 'results',
        },
        game_total: {
          selection: scored.markets?.game_total?.selection,
          band: scored.markets?.game_total?.band,
          score: scored.markets?.game_total?.score,
          total: m.gameTotal || 61.5,
          settled: m.phase === 'results',
        },
      },
    };

    if (m.score) {
      record.result = {
        home: m.score.home,
        away: m.score.away,
        winner: m.winner_name || (m.score.home > m.score.away ? m.home : m.away),
        total: m.score.home + m.score.away,
        margin: Math.abs(m.score.home - m.score.away),
      };
    }

    if (!existingMap.has(m.competition_id)) {
      predDoc.predictions.push(record);
      existingMap.set(m.competition_id, record);
      added++;
    }
  }

  writeFileSync(PRED_PATH, JSON.stringify(predDoc, null, 2) + '\n', 'utf-8');
  console.log(`Forward collection complete: ${added} new predictions recorded. Total: ${predDoc.predictions.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  recordPredictions();
}
