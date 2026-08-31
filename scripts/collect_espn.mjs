#!/usr/bin/env node
/**
 * SportsPred — forward collection and result settlement from ESPN.
 *
 * WHAT IT DOES
 *   1. Collects a date's card from ESPN's public endpoints (no API key).
 *   2. Scores it with the live engine and appends every selection to
 *      data/predictions.json — append-only, one record per event+market.
 *   3. Settles any previously-recorded prediction whose match has since
 *      finished, by re-reading that match from ESPN and writing the real
 *      outcome into data/results.json.
 *
 * This is what turns the project from a one-off prose generator into
 * something that accumulates a graded track record. scripts/backtest.mjs
 * then reports hit rate, Brier, log loss and calibration over the record.
 *
 * HONESTY RULES
 *   - A match with no sourced ranking is not scored and nothing is recorded.
 *   - `price` and `line` are always null: no odds source exists (IR-01), and
 *     an estimated price would corrupt any future profitability claim.
 *   - A result is written only when ESPN reports the match completed with a
 *     winner. Retirements/walkovers are recorded as such, never as clean wins.
 *   - Existing records are never rewritten, so history cannot be revised.
 *
 * Usage:
 *   node scripts/collect_espn.mjs                 # today: record + settle
 *   node scripts/collect_espn.mjs --date 2026-08-30
 *   node scripts/collect_espn.mjs --settle-only   # only grade open records
 *   node scripts/collect_espn.mjs --dry-run
 *
 * Requires egress to site.api.espn.com. Exits 2 if unreachable, rather than
 * writing a partial or invented snapshot.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseScoreboard, buildPlayerStats, buildH2H, normaliseName, parseRankings } from '../engine/espn.js';
import { resolveSurface } from '../engine/surface.js';
import { codeStage, h2hForEngine } from '../engine/tournament.js';
import { scoreCard } from '../engine/engine.js';
import { writeCard } from '../engine/writer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const LEAGUES = ['atp', 'wta'];
const TAPE_DAYS = Number(argOf('--tape', '60'));

function argOf(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
}
const DRY = process.argv.includes('--dry-run');
const SETTLE_ONLY = process.argv.includes('--settle-only');
const DATE = argOf('--date', new Date().toISOString().slice(0, 10));

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function getJSON(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const ymd = (iso) => iso.replace(/-/g, '');
const shift = (iso, n) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

let surfaces;

function attach(row) {
  const res = resolveSurface(surfaces, row.tournament, row.tour);
  const entry = res.key ? surfaces.tournaments[res.key] : null;
  const stage = codeStage(row.tournament, row.round, entry);
  return { ...row, surface: res.surface, level_code: stage.level, round_code: stage.round };
}

async function collectDate(iso) {
  const rows = [];
  const seen = new Set();
  let ok = false;
  for (const lg of LEAGUES) {
    const p = await getJSON(`${SITE}/${lg}/scoreboard?dates=${ymd(iso)}`);
    if (!p) continue;
    ok = true;
    for (const r of parseScoreboard(p, lg)) {
      if (seen.has(r.competition_id)) continue;
      seen.add(r.competition_id);
      rows.push(attach(r));
    }
  }
  return { rows, ok };
}

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

/**
 * Grade open predictions by re-reading their matches from ESPN.
 * Only completed matches with a winner produce a result row.
 */
async function settle(store, resultsDoc) {
  const settledIds = new Set(resultsDoc.results.map((r) => r.event_id));
  const open = [...new Set(
    store.predictions.filter((p) => !settledIds.has(p.event_id)).map((p) => p.event_id),
  )];
  if (!open.length) return { checked: 0, settled: 0 };

  // Predictions carry the match date, so only those dates need re-reading.
  const dates = [...new Set(
    store.predictions.filter((p) => open.includes(p.event_id)).map((p) => p.match_date).filter(Boolean),
  )];

  const byId = new Map();
  for (const d of dates) {
    const { rows } = await collectDate(d);
    for (const r of rows) byId.set(r.competition_id, r);
  }

  let settled = 0;
  for (const id of open) {
    const m = byId.get(id);
    if (!m || !m.completed || !m.winner_id) continue;
    // A retirement leaves an incomplete set line; record it rather than
    // treating it as a clean straight-sets win.
    const suspicious = !m.sets || m.sets.length < 2;
    // Field names here must match what scripts/backtest.mjs `gradeOne` reads:
    // winner, firstSetWinner (a NAME, not an id) and gamesMargin.
    const fsPlayer = m.first_set_winner_id
      ? (m.players.find((p) => p.espn_id === m.first_set_winner_id) || null)
      : null;
    resultsDoc.results.push({
      event_id: id,
      match: m.players.map((p) => p.name).join(' v '),
      date: m.date,
      winner: m.winner_name,
      winner_id: m.winner_id,
      firstSetWinner: fsPlayer?.name ?? null,
      first_set_winner_id: m.first_set_winner_id,
      straight_sets: m.straight_sets,
      // Signed from the MATCH WINNER's perspective, which is the convention
      // gradeOne documents for the favourite side.
      gamesMargin: m.games_margin,
      sets: m.sets,
      irregular: suspicious ? 'incomplete set record — possible retirement or walkover' : null,
      source: 'espn',
      settled_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
    settled++;
  }
  return { checked: open.length, settled };
}

/* ------------------------------------------------------------------ */

async function main() {
  surfaces = await readJSON(path.join(DATA, 'surfaces.json'), null);
  if (!surfaces) {
    console.error('Missing data/surfaces.json — run scripts/build_surface_map.mjs first.');
    return 1;
  }

  if (!(await getJSON(`${SITE}/atp/scoreboard`))) {
    console.error('FAIL: site.api.espn.com is unreachable. Nothing written.');
    return 2;
  }

  const store = await readJSON(path.join(DATA, 'predictions.json'),
    { schema_version: 1, predictions: [] });
  const resultsDoc = await readJSON(path.join(DATA, 'results.json'),
    { schema_version: 1, results: [] });

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const added = [];
  let cardInfo = { matches: 0, scored: 0, tips: 0, violations: 0 };

  if (!SETTLE_ONLY) {
    // --- rankings + today's card + history tape ---
    const rankings = { byId: {}, byName: {} };
    for (const lg of LEAGUES) {
      const p = await getJSON(`${SITE}/${lg}/rankings`);
      if (!p) continue;
      const parsed = parseRankings(p);
      Object.assign(rankings.byId, parsed.byId);
      for (const [k, v] of Object.entries(parsed.byName)) if (!rankings.byName[k]) rankings.byName[k] = v;
    }

    const day = await collectDate(DATE);
    const tape = [];
    for (let i = 1; i <= TAPE_DAYS; i++) {
      const { rows } = await collectDate(shift(DATE, -i));
      for (const r of rows) if (r.completed) tape.push(r);
    }

    const matches = day.rows.map((m) => {
      const mk = (p) => {
        const r = rankings.byId[p.espn_id] || rankings.byName[normaliseName(p.name)] || null;
        const s = buildPlayerStats(p.espn_id, tape, m.surface, DATE);
        return {
          name: p.name,
          rank: r?.rank ?? null,
          rankTrajectory: r?.trajectory ?? null,
          odds: null,
          firstSetOdds: null,
          handicapOdds: null,
          form: s.form,
          surface: s.surface,
          serve: s.serve,
          rest: s.rest,
        };
      };
      const [a, b] = m.players.map(mk);
      const raw = buildH2H(m.players[0].espn_id, m.players[1].espn_id, tape, m.surface);
      let opponentRank = null;
      if (a.rank != null && b.rank != null) opponentRank = a.rank <= b.rank ? b.rank : a.rank;
      else opponentRank = b.rank ?? a.rank ?? null;
      return {
        event_id: m.competition_id,
        players: [a, b],
        surface: m.surface,
        tournament: (m.level_code || m.round_code) ? { level: m.level_code, round: m.round_code } : null,
        h2h: h2hForEngine(raw, a.rank, b.rank),
        opponentRank,
        home: a.name,
        away: b.name,
        resolved_date: m.date,
        _date: m.date,
        _tournament: m.tournament,
      };
    });

    const card = scoreCard(matches);
    const written = writeCard(card.results);
    cardInfo = {
      matches: matches.length,
      scored: card.results.filter((r) => r.result.favourite).length,
      tips: written.tips.filter((t) => t.ok).length,
      violations: written.violations.length,
    };

    const existing = new Set(store.predictions.map((p) => `${p.event_id}|${p.market}`));
    for (const { match, result } of card.results) {
      if (result.favourite === null) continue; // unscored: record nothing
      for (const [market, m] of Object.entries(result.markets)) {
        const key = `${match.event_id}|${market}`;
        if (existing.has(key)) continue;
        added.push({
          event_id: match.event_id,
          match: `${match.home} v ${match.away}`,
          match_date: match._date,
          tournament: match._tournament,
          market,
          selection: result.favourite,
          band: m.band,
          score: m.score,
          price: null,   // never estimated — IR-01
          line: null,
          ruleset: result.ruleset,
          missingFactors: result.missing.length,
          recorded_at_utc: now,
        });
      }
    }
  }

  const settlement = await settle(store, resultsDoc);

  const summary = [
    `date               : ${DATE}`,
    `matches on card    : ${cardInfo.matches}`,
    `scoreable          : ${cardInfo.scored}`,
    `tips generated     : ${cardInfo.tips}`,
    `output violations  : ${cardInfo.violations}`,
    `new records        : ${added.length}`,
    `open predictions   : ${settlement.checked}`,
    `newly settled      : ${settlement.settled}`,
  ].join('\n');

  if (DRY) {
    console.log(summary);
    for (const a of added) console.log(`  + ${a.event_id} ${a.market} ${a.selection} ${a.band} (${a.score})`);
    return 0;
  }

  store.predictions.push(...added);
  store.last_run_utc = now;
  await writeFile(path.join(DATA, 'predictions.json'), `${JSON.stringify(store, null, 2)}\n`);

  resultsDoc.source = 'ESPN public tennis scoreboard';
  resultsDoc.last_settled_utc = now;
  await writeFile(path.join(DATA, 'results.json'), `${JSON.stringify(resultsDoc, null, 2)}\n`);

  console.log(summary);
  console.log(`\nWrote ${added.length} prediction(s) and settled ${settlement.settled} match(es).`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
