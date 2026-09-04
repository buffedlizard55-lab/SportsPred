#!/usr/bin/env node
/**
 * SportsPred — Scottish Open overlay: walk-forward backtest + ledger.
 *
 * For every Scottish Open edition in the committed results tape the overlay is
 * re-run using only results that ENDED before that edition's first round —
 * exactly the evidence the live site would have had on the Thursday morning.
 * The field is reconstructed from the event's own result rows.
 *
 * What history cannot supply, and is therefore recorded as missing rather than
 * guessed:
 *   - round-one tee times  → the wave category scores zero for every player, so
 *     no first-round-leader tip can read HIGH (the prompt forbids it anyway);
 *   - the round-one forecast → the same;
 *   - per-round wind for completed events → the twenty-point fast-start tier is
 *     unreachable and the twelve-point tier is used.
 * Strokes gained uses the CURRENT season table only for current-season editions,
 * because no historical strokes-gained snapshot exists.
 *
 * Grading (source: the ESPN leaderboard row for that edition):
 *   WIN TOURNAMENT            hit = finished first
 *   FIRST ROUND LEADER        hit = lowest round-one score in the field
 *   TOP AMERICAN / EUROPEAN / GB AND IRELAND
 *                             hit = best final position among eligible players
 *
 * Writes:
 *   data/golf_scottish_open_backtest.json
 *   data/golf_scottish_open_predictions.json
 *
 * Usage:  node scripts/backtest_scottish_open.mjs [--check]
 *   --check  rebuild in memory and fail if the committed ledger differs.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildResultsIndex, buildGolfProfile, buildFieldContext, applySgCoverageFloor, classifyRegion } from '../engine/golf_data.js';
import { scoreScottishOpen, writeScottishOpenCard, validateScottishOpenCard, MARKET_ORDER, RULESET_VERSION, PROMPT_TITLE } from '../engine/golf_scottish_open.js';
import { owgrLookup, matchOwgr, statsLookup, sgLookup, matchSg, linksCourseSet, gradeGolfSelections } from '../engine/golf_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SPORTSPRED_DATA_DIR || join(ROOT, 'data');
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const RESULTS = join(DATA, 'golf_results.json');
const OUT_BT = join(DATA, 'golf_scottish_open_backtest.json');
const OUT_LEDGER = join(DATA, 'golf_scottish_open_predictions.json');

const EVENT_NAME = /scottish open/i;

function fieldFromEntry(entry, players) {
  return (entry.rows || []).map((row) => {
    const [athleteId, position, result, toPar, r1] = row;
    const p = players[athleteId] || {};
    return {
      athleteId: String(athleteId),
      name: p.name || `Player ${athleteId}`,
      country: p.country ?? null,
      countryCode: p.countryCode ?? null,
      teeTime: null, // not published for completed events
      amateur: false,
      position: position ?? null,
      result: result ?? null,
      toPar: toPar ?? null,
      r1: r1 ?? null,
    };
  });
}

function build() {
  const resultsDoc = read(RESULTS);
  if (!resultsDoc) return { pending: true };
  const rankingsDoc = read(join(DATA, 'golf_rankings.json'));
  const statsDoc = read(join(DATA, 'golf_stats.json'));
  const linksDoc = read(join(DATA, 'golf_links_courses.json'));
  const index = buildResultsIndex(resultsDoc);
  const owgr = owgrLookup(rankingsDoc);
  const stats = statsLookup(statsDoc);
  const sg = sgLookup(statsDoc);
  const links = linksCourseSet(linksDoc);
  const currentSeason = stats.season ?? null;

  const editions = [...index.events.values()]
    .filter((e) => EVENT_NAME.test(e.name || '') && e.endDate)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

  const perMarket = Object.fromEntries(MARKET_ORDER.map((k) => [k, { total: 0, hit: 0, skipped: 0, unverified: 0, byBand: {} }]));
  const rows = [];
  const ledger = [];

  for (const meta of editions) {
    const entry = resultsDoc.events[meta.eventId];
    const field = fieldFromEntry(entry, resultsDoc.players || {});
    if (field.length < 20) continue;
    const event = {
      id: meta.eventId, name: meta.name, tour: meta.tour, tournamentId: meta.tournamentId,
      startDate: meta.startDate, endDate: meta.endDate, purse: meta.purse,
      course: { id: meta.courseId, name: meta.courseName, yards: meta.yards, par: meta.par },
    };
    const asOf = meta.startDate;
    const useSg = sg.available && currentSeason && meta.seasonYear === currentSeason;
    const raw = field.map((player) => buildGolfProfile({
      index, player, event, asOfISO: asOf,
      ranking: matchOwgr(owgr, player.name),
      stats: stats.byId.get(player.athleteId) || null,
      sg: useSg ? matchSg(sg, player.name) : null,
      statsDist: { distanceQ1: stats.distanceQ1, distanceQ3: stats.distanceQ3 },
      linksCourses: links,
    }));
    const floor = applySgCoverageFloor(raw);
    const ctx = buildFieldContext({ event, profiles: floor.profiles, index, weather: null, asOfISO: asOf });
    ctx.priorEditionsInTape = [...index.events.values()].filter((e) => event.tournamentId && e.tournamentId === String(event.tournamentId) && e.endDate && e.endDate < asOf).length;
    ctx.sgSuppressed = floor.suppressed;
    ctx.sgCoverageNote = useSg ? 'current season table' : 'not applicable to a prior season';

    const scored = scoreScottishOpen(event, floor.profiles, ctx);
    scored.profile = { id: 'scottish-open', label: 'Scottish Open overlay', prompt: PROMPT_TITLE, doc: 'docs/SCOTTISH_OPEN_MASTER_PROMPT.md', ruleset: RULESET_VERSION };
    const written = scored.unscored ? null : writeScottishOpenCard(scored, event);
    const validation = written ? validateScottishOpenCard(written) : null;
    const grades = scored.unscored ? null : gradeGolfSelections(scored, field);

    const marketRows = {};
    for (const key of MARKET_ORDER) {
      const m = scored.markets[key];
      const sel = m?.selections?.[0] || null;
      const g = grades?.[key] || null;
      const bucket = perMarket[key];
      if (!sel) { bucket.skipped += 1; }
      else if (!g || g.status === 'UNVERIFIED') { bucket.unverified += 1; }
      else {
        bucket.total += 1;
        if (g.hit) bucket.hit += 1;
        bucket.byBand[sel.band] = bucket.byBand[sel.band] || { total: 0, hit: 0 };
        bucket.byBand[sel.band].total += 1;
        if (g.hit) bucket.byBand[sel.band].hit += 1;
      }
      marketRows[key] = {
        label: m?.label, selection: sel?.name || null, score: sel?.score ?? null, band: sel?.band ?? null,
        valuePick: sel?.valuePick === true, status: g?.status || 'NO SELECTION',
        coSelections: (m?.selections || []).slice(1).map((c) => c.name),
      };
      ledger.push({
        id: `scottish-open-${meta.eventId}-${key}`,
        eventId: meta.eventId, year: Number(String(meta.startDate).slice(0, 4)), date: meta.startDate,
        market: m?.label || key, marketKey: key,
        selection: sel?.name || null, athleteId: sel?.athleteId ?? null,
        score: sel?.score ?? null, band: sel?.band ?? null, valuePick: sel?.valuePick === true,
        status: g?.status || 'NO SELECTION', ruleset: RULESET_VERSION,
        sourceUrl: entry.sourceUrl || `https://www.espn.com/golf/leaderboard?tournamentId=${meta.eventId}`,
      });
    }

    rows.push({
      eventId: meta.eventId, year: Number(String(meta.startDate).slice(0, 4)), name: meta.name,
      startDate: meta.startDate, endDate: meta.endDate, courseName: meta.courseName, yards: meta.yards, par: meta.par,
      fieldSize: field.length, priorEditionsInTape: ctx.priorEditionsInTape,
      strokesGained: useSg ? 'current season table applied' : 'not applied (no historical snapshot for this season)',
      winner: (() => { const w = field.filter((f) => f.position === 1)[0]; return w ? { name: w.name, toPar: w.toPar } : null; })(),
      markets: marketRows,
      missing: scored.missing,
      flags: scored.flags,
      validation: validation ? { ok: validation.ok, issues: validation.issues } : null,
      sourceUrl: entry.sourceUrl || `https://www.espn.com/golf/leaderboard?tournamentId=${meta.eventId}`,
    });
  }

  return {
    pending: false,
    schema_version: 1,
    sport: 'Golf',
    ruleset: RULESET_VERSION,
    prompt: PROMPT_TITLE,
    promptDoc: 'docs/SCOTTISH_OPEN_MASTER_PROMPT.md',
    generated_at_utc: new Date().toISOString(),
    method: 'Walk-forward: each Scottish Open edition is scored with results that ended before its first round only. Fields are reconstructed from the event result rows. Tee times and the round-one forecast are not available historically, so the thirty-point wave category is missing for every past edition and no first-round-leader tip can read HIGH. Strokes gained is applied only to the current season and only when the field clears the coverage floor.',
    editions: rows,
    aggregate: Object.fromEntries(Object.entries(perMarket).map(([k, v]) => [k, {
      ...v,
      hitRate: v.total ? Math.round((v.hit / v.total) * 1000) / 10 : null,
    }])),
    notes: [
      'Three editions are in the committed tape (2024, 2025, 2026). That is a small sample: it is reported as a sample, never as a strike rate to trust.',
      'The 2026 championship layout was rerouted (the par-three sixth became the fifteenth), so venue history across that change is not a like-for-like comparison.',
      'Every market row names the ESPN leaderboard it was graded against.',
    ],
  };
}

function main() {
  const doc = build();
  if (doc.pending) { console.log('[PENDING] golf results tape not collected yet; the Scottish Open backtest will run after the scheduled collector.'); return; }
  const ledger = {
    schema_version: 1, sport: 'Golf', ruleset: RULESET_VERSION, generated_at_utc: doc.generated_at_utc,
    predictions: doc.editions.flatMap((e) => Object.entries(e.markets).map(([k, m]) => ({
      id: `scottish-open-${e.eventId}-${k}`, eventId: e.eventId, year: e.year, date: e.startDate,
      market: m.label, marketKey: k, selection: m.selection, band: m.band, score: m.score,
      valuePick: m.valuePick, status: m.status, sourceUrl: e.sourceUrl,
    }))),
  };
  const check = process.argv.includes('--check');
  const btBody = JSON.stringify({ ...doc, generated_at_utc: null });
  const lgBody = JSON.stringify({ ...ledger, generated_at_utc: null });
  if (!check) {
    writeFileSync(OUT_BT, `${JSON.stringify(doc, null, 1)}\n`);
    writeFileSync(OUT_LEDGER, `${JSON.stringify(ledger, null, 1)}\n`);
    console.log(`[scottish-open-backtest] ${doc.editions.length} edition(s) scored; ledger ${ledger.predictions.length} row(s)`);
    for (const [k, v] of Object.entries(doc.aggregate)) console.log(`  ${k}: ${v.hit}/${v.total} hit (${v.hitRate}%), ${v.skipped} no selection, ${v.unverified} unverified`);
    return;
  }
  if (!existsSync(OUT_BT) || !existsSync(OUT_LEDGER)) { console.error('[scottish-open-backtest] --check: committed output missing'); process.exit(1); }
  const strip = (o) => JSON.stringify({ ...o, generated_at_utc: null });
  if (strip(JSON.parse(readFileSync(OUT_BT, 'utf8'))) !== btBody || strip(JSON.parse(readFileSync(OUT_LEDGER, 'utf8'))) !== lgBody) {
    console.error('[scottish-open-backtest] --check: committed output is out of date; re-run without --check');
    process.exit(1);
  }
  console.log(`[scottish-open-backtest] --check ok — ${doc.editions.length} edition(s), ${ledger.predictions.length} ledger row(s)`);
}

main();
