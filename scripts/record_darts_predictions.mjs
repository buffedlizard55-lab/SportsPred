#!/usr/bin/env node
/**
 * Forward collection ledger for darts: builds the scored + written card
 * from the committed source-linked documents and appends any new prediction
 * to data/darts_predictions.json. Append-only: an existing record for a
 * match is never overwritten with different values, only updated with
 * settlement status.
 *
 * Pure offline run — no network. Writes data/darts_predictions.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDartsCard, scoreTapeLeans } from '../engine/darts_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

function loadJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function read(path) {
  return existsSync(path) ? loadJSON(path) : null;
}

function main() {
  const docs = {
    slate: read(join(DATA, 'darts_slate.json')),
    tape: read(join(DATA, 'darts_results.json')),
    rankings: read(join(DATA, 'darts_rankings.json')),
  };
  if (!docs.slate) {
    console.error('data/darts_slate.json not found');
    process.exit(1);
  }
  const live = buildDartsCard(docs, {});
  const hist = scoreTapeLeans(docs, {});
  const allPreds = [
    ...(live.written?.predictions || []),
    ...(hist.written?.predictions || []),
  ];
  const ledgerPath = join(DATA, 'darts_predictions.json');
  const ledger = read(ledgerPath) || {
    schema_version: 1,
    sport: 'Darts',
    predictions: [],
  };
  const existing = new Map((ledger.predictions || []).map((p) => [p.matchId, p]));

  let added = 0;
  for (const p of allPreds) {
    const key = p.matchId || `${p.matchTitle}|${p.dateISO}`;
    if (existing.has(key)) continue;
    const record = {
      matchId: key,
      matchTitle: p.matchTitle,
      event: p.event,
      round: p.round,
      dateISO: p.dateISO,
      venue: p.venue,
      predictedWinner: p.leanName,
      confidence: p.confidence.band,
      modelScore: p.confidence.score,
      bet: p.bet,
      betType: p.betType,
      verdict: p.verdict,
      paragraph: p.paragraph,
      generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      sourceUrls: p.sourceUrls,
      status: 'pending',
      settlement: null,
    };
    ledger.predictions.push(record);
    existing.set(key, record);
    added += 1;
  }

  const tapeMatches = (docs.tape?.matches || []).map((m) => ({
    id: m.id,
    playerA: m.player_a?.name,
    playerB: m.player_b?.name,
    winner: m.winner,
    score: [m.score_a, m.score_b],
    sourceUrls: m.source_urls || [],
    date: m.date,
  }));
  let settled = 0;
  for (const p of ledger.predictions) {
    if (p.status === 'settled') continue;
    const byId = tapeMatches.find((m) => m.id === p.matchId);
    const byNames = byId || tapeMatches.find((m) => {
      const names = [m.playerA, m.playerB].filter(Boolean).sort();
      const pred = String(p.matchTitle || '').split(/\s+v(?:s)?\.?\s+/i).map((s) => s.trim()).sort();
      return names.length === 2 && pred.length === 2 && names[0] === pred[0] && names[1] === pred[1];
    });
    if (!byNames || !byNames.winner) continue;
    p.status = 'settled';
    p.settlement = {
      actualWinner: byNames.winner,
      score: `${byNames.score[0]}-${byNames.score[1]}`,
      matched: byNames.winner === p.predictedWinner,
      settledAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    p.settlementUrls = byNames.sourceUrls;
    settled += 1;
  }

  ledger.updatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  ledger.notes = [
    'Writers/engine output recorded by scripts/record_darts_predictions.mjs from the committed source-linked documents.',
    'Settlement runs in CI from the official results tape; values are matched by player names.',
    'Nothing in this ledger is hand-written; every verdict object comes from the tested engine and writer.',
  ];
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  const cardOk = (live.written?.validation?.ok !== false) && (hist.written?.validation?.ok !== false);
  console.log(`darts ledger: ${ledger.predictions.length} records (${added} added, ${settled} settled), card valid=${cardOk}`);
  if (!cardOk) {
    console.error(JSON.stringify({ live: live.written?.validation, hist: hist.written?.validation }, null, 2));
    process.exit(1);
  }
}

main();
