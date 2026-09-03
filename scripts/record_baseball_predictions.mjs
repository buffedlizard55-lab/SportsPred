#!/usr/bin/env node
/**
 * SportsPred — Baseball forward-collection ledger.
 *
 *   node scripts/record_baseball_predictions.mjs
 *
 * Builds the scored + written card from the committed source-linked documents
 * (no network) and appends every new upcoming-match prediction to
 * data/baseball_predictions.json. Append-only: an existing record for a match
 * is never overwritten with different values; it is only updated with
 * settlement status once the official results tape shows a final score.
 *
 * Settlement runs from data/baseball_tape.json, which the collector built
 * from the official MLB StatsAPI schedule. A prediction is settled only when
 * the tape carries a numeric score for both sides; otherwise it stays pending.
 * Run line and game total are recorded but marked ungraded for the same reason
 * the backtest records them ungraded: no key-less feed retains the closing
 * line after a game is final.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBaseballCard } from '../engine/baseball_data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

function loadJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function read(path) {
  return existsSync(path) ? loadJSON(path) : null;
}

function sourceUrls(docs, enriched) {
  const urls = new Set();
  for (const m of enriched || []) {
    for (const side of [m?.home, m?.away]) {
      if (side?.provenance?.standings === 'mlb-standings') {
        urls.add('https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=' + (docs.standings?.season ?? new Date().getUTCFullYear()));
      }
      if (side?.provenance?.teamStats === 'mlb-team-stats') {
        urls.add('https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=hitting&season=' + (docs.teamStats?.season ?? new Date().getUTCFullYear()) + '&sportId=1');
      }
    }
  }
  if (docs.fixtures?.endpoints?.length) {
    for (const e of docs.fixtures.endpoints) if (e?.url) urls.add(e.url);
  }
  return [...urls];
}

function main() {
  const docs = {
    fixtures: read(join(DATA, 'baseball_fixtures.json')),
    tape: read(join(DATA, 'baseball_tape.json')),
    standings: read(join(DATA, 'baseball_standings.json')),
    teamStats: read(join(DATA, 'baseball_team_stats.json')),
    pitchers: read(join(DATA, 'baseball_pitchers.json')),
    slate: read(join(DATA, 'baseball_slate.json')),
  };
  if (!docs.fixtures) {
    console.error('data/baseball_fixtures.json not found — run scripts/collect_baseball_mlb.mjs first (CI does).');
    process.exit(1);
  }

  // Forward collection: record predictions for upcoming matches only. Settled
  // games belong to the walk-forward backtest, not to the forward ledger.
  const upcoming = (docs.fixtures?.fixtures || []).filter((f) => f.phase === 'upcoming' || f.phase === 'live');
  const card = buildBaseballCard(docs, { fixtures: upcoming });
  const tips = card.written?.tips || [];

  const ledgerPath = join(DATA, 'baseball_predictions.json');
  const ledger = read(ledgerPath) || {
    schema_version: 1,
    sport: 'Baseball',
    prompt: 'BASEBALL PREDICTION MASTER PROMPT v1.0',
    predictions: [],
  };
  // One record per (match, market) so all three tips per match are kept.
  const existing = new Map((ledger.predictions || []).map((p) => [p.matchId, p]));

  const scoredById = new Map((card.scored?.results || []).map((r) => [String(r.id), r]));
  const enrichedById = new Map((card.matches || []).map((m) => [String(m.id), m]));

  let added = 0;
  for (const tip of tips) {
    const matchKey = tip.matchId;
    const key = `${matchKey}|${tip.market}`;
    if (existing.has(key)) continue;
    const result = scoredById.get(String(matchKey)) || {};
    const match = enrichedById.get(String(matchKey)) || {};
    const record = {
      matchId: matchKey,
      market: tip.market,
      fixture: tip.fixture,
      league: match.league || 'mlb',
      leagueName: match.leagueName || 'Major League Baseball',
      dateISO: match.dateISO ?? null,
      startUtc: match.startUtc ?? null,
      marketLabel: tip.label,
      selection: tip.text.match(/\*\*([^*]+)\*\*/)?.[1] ?? null,
      confidence: tip.confidence,
      favoured: result.favoured ?? null,
      dog: result.dog ?? null,
      underdogValue: result.underdogValue ?? null,
      missing: result.missing ?? [],
      text: tip.text,
      generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      sourceUrls: sourceUrls(docs, [match]),
      status: 'pending',
      settlement: null,
    };
    ledger.predictions.push(record);
    existing.set(key, record);
    added += 1;
  }

  // Settle from the official results tape (score present on both sides).
  const tapeGames = docs.tape?.games || [];
  const tapeById = new Map(tapeGames.map((g) => [String(g.id), g]));
  let settled = 0;
  for (const p of ledger.predictions) {
    if (p.status === 'settled') continue;
    const g = tapeById.get(String(p.matchId));
    if (!g) continue;
    const h = g.score?.home;
    const a = g.score?.away;
    if (h == null || a == null) continue;
    const actualWinner = h > a ? g.home?.name : a > h ? g.away?.name : 'draw';
    const graded = p.market === 'win_match';
    p.status = 'settled';
    p.settlement = {
      actualWinner,
      score: `${h}-${a}`,
      matched: graded ? actualWinner === p.favoured : null,
      marketGraded: graded,
      ungradedReason: graded ? null : 'no key-less feed retains the closing line, so the run line and game total cannot be checked after the fact',
      settledAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    settled += 1;
  }

  ledger.updatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  ledger.notes = [
    'Writers/engine output recorded by scripts/record_baseball_predictions.mjs from the committed source-linked documents.',
    'Only the WIN MATCH OUTRIGHT market is graded at settlement: no key-less feed retains the closing run line or total line after a game is final.',
    'Nothing in this ledger is hand-written; every selection comes from the tested engine and writer.',
  ];

  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`baseball ledger: ${ledger.predictions.length} records (${added} added, ${settled} settled)`);
  return 0;
}

main();
