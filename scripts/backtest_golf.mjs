#!/usr/bin/env node
/**
 * SportsPred — Golf walk-forward backtest + prediction ledger.
 *
 * For every COMPLETED event in data/golf_results.json (PGA TOUR and DP World
 * Tour) the engine is re-run using only results that ENDED before that event's
 * first round — exactly the evidence the live site would have had. The field is
 * reconstructed from the event's own result rows (everyone who teed it up).
 * Tee times and weather are unknown historically, so the first-round-leader
 * tee/weather category is missing for every past event (capped at MEDIUM), and
 * the strokes-gained categories use the CURRENT season table only when the
 * event belongs to the current season (no historical SG snapshots exist).
 *
 * Grading (source: the ESPN leaderboard for that event):
 *   OUTRIGHT            hit = finished first (playoff winner as ESPN lists it)
 *   TOP 6 FINISH        hit = final position 1-6 (ties included)
 *   FIRST ROUND LEADER  hit = lowest round-one score in the field (ties count)
 *   TOP EUROPEAN / AMERICAN / BRITISH & IRISH
 *                       hit = best final position among eligible players
 *
 * Writes:
 *   data/golf_backtest.json     per-event + aggregate hit rates
 *   data/golf_predictions.json  ledger (one row per market per event)
 *
 * Guarded for the first CI run: if the golf data files do not exist yet this
 * script prints [PENDING] and exits 0.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildResultsIndex, buildGolfProfile, buildFieldContext, classifyRegion } from '../engine/golf_data.js';
import { scoreGolfEvent, RULESET_VERSION, CONFIDENCE } from '../engine/golf_engine.js';
import { owgrLookup, matchOwgr, statsLookup, sgLookup, matchSg } from '../engine/golf_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SPORTSPRED_DATA_DIR || join(ROOT, 'data');
const RESULTS = join(DATA, 'golf_results.json');
const RANKINGS = join(DATA, 'golf_rankings.json');
const STATS = join(DATA, 'golf_stats.json');
const OUT_BT = join(DATA, 'golf_backtest.json');
const OUT_LEDGER = join(DATA, 'golf_predictions.json');

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const MIN_HISTORY_EVENTS = 8;

function fieldFromEntry(entry, players) {
  const out = [];
  for (const row of entry.rows || []) {
    const [athleteId, position, result, toPar, r1] = row;
    const p = players[athleteId] || {};
    out.push({ athleteId: String(athleteId), name: p.name || `Player ${athleteId}`, country: p.country ?? null, countryCode: p.countryCode ?? null, teeTime: null, amateur: false, _position: position, _result: result, _toPar: toPar, _r1: r1 });
  }
  return out;
}

function gradeMarket(key, market, field) {
  const sel = market?.selections?.[0] || null;
  if (!sel || sel.band === CONFIDENCE.SKIP) return { status: 'NO SELECTION', hit: null, selection: null, band: null };
  const me = field.find((p) => p.athleteId === sel.athleteId);
  if (!me) return { status: 'UNVERIFIED', hit: null, selection: sel.name, band: sel.band };
  const finished = (p) => p._position !== null && p._position !== undefined && (p._result === 'F' || p._result === 'MDF');
  let hit = null;
  if (key === 'outright') hit = finished(me) && me._position === 1;
  else if (key === 'top6') hit = finished(me) && me._position <= 6;
  else if (key === 'frl') {
    const r1s = field.map((p) => p._r1).filter((v) => Number.isFinite(v) && v > 0);
    if (!r1s.length || !Number.isFinite(me._r1)) return { status: 'UNVERIFIED', hit: null, selection: sel.name, band: sel.band };
    hit = me._r1 === Math.min(...r1s);
  } else {
    const flag = key === 'top_european' ? 'european' : key === 'top_american' ? 'american' : 'britishIrish';
    const eligible = field.filter((p) => classifyRegion({ country: p.country, countryCode: p.countryCode })[flag] && finished(p));
    if (!eligible.length) return { status: 'UNVERIFIED', hit: null, selection: sel.name, band: sel.band };
    const best = Math.min(...eligible.map((p) => p._position));
    hit = finished(me) && me._position === best;
  }
  return { status: hit ? 'HIT' : 'MISS', hit, selection: sel.name, band: sel.band, valuePick: sel.valuePick === true };
}

function main() {
  const resultsDoc = read(RESULTS);
  if (!resultsDoc) { console.log('[PENDING] golf data files not collected yet; backtest will run after the scheduled collector.'); return; }
  const rankingsDoc = read(RANKINGS);
  const statsDoc = read(STATS);
  const index = buildResultsIndex(resultsDoc);
  const owgr = owgrLookup(rankingsDoc);
  const stats = statsLookup(statsDoc);
  const sg = sgLookup(statsDoc);
  const currentSeason = stats.season ?? null;

  const events = [...index.events.values()].filter((e) => e.endDate).sort((a, b) => a.endDate.localeCompare(b.endDate));
  const keys = ['outright', 'top6', 'frl', 'top_european', 'top_american', 'top_british_irish'];
  const byMarket = Object.fromEntries(keys.map((k) => [k, { total: 0, hit: 0, skipped: 0, unverified: 0, byBand: {} }]));
  const rows = [];
  const ledger = [];
  let seen = 0;

  for (const meta of events) {
    seen += 1;
    if (seen <= MIN_HISTORY_EVENTS) continue; // no meaningful history yet
    const entry = resultsDoc.events[meta.eventId];
    const field = fieldFromEntry(entry, resultsDoc.players || {});
    if (field.length < 20) continue;
    const event = { id: meta.eventId, name: meta.name, tour: meta.tour, tournamentId: meta.tournamentId, startDate: meta.startDate, endDate: meta.endDate, purse: meta.purse, course: { yards: meta.yards, par: meta.par } };
    const asOf = meta.startDate;
    const useSg = sg.available && currentSeason && meta.seasonYear === currentSeason;
    const profiles = field.map((player) => buildGolfProfile({
      index, player, event, asOfISO: asOf,
      ranking: matchOwgr(owgr, player.name),
      stats: stats.byId.get(player.athleteId) || null,
      sg: useSg ? matchSg(sg, player.name) : null,
      statsDist: { distanceQ1: stats.distanceQ1, distanceQ3: stats.distanceQ3 },
    }));
    const ctx = buildFieldContext({ event, profiles, index, weather: null, asOfISO: asOf });
    ctx.priorEditionsInTape = events.filter((e) => e.tournamentId && e.tournamentId === meta.tournamentId && e.endDate < asOf).length;
    const scored = scoreGolfEvent(event, profiles, ctx);
    if (scored.unscored) continue;

    const row = { eventId: meta.eventId, tour: meta.tour, name: meta.name, date: meta.endDate, winner: entry.winner?.name ?? null, markets: {}, sourceUrl: meta.sourceUrl };
    for (const k of keys) {
      const g = gradeMarket(k, scored.markets[k], field);
      row.markets[k] = g;
      const agg = byMarket[k];
      agg.total += 1;
      if (g.status === 'NO SELECTION') agg.skipped += 1;
      else if (g.status === 'UNVERIFIED') agg.unverified += 1;
      else {
        agg.byBand[g.band] = agg.byBand[g.band] || { total: 0, hit: 0 };
        agg.byBand[g.band].total += 1;
        if (g.hit) { agg.hit += 1; agg.byBand[g.band].hit += 1; }
      }
    }
    // Top-six list as a whole: how many of the (up to six) selections finished top six.
    const t6 = scored.markets.top6?.selections || [];
    const t6hits = t6.filter((s) => { const p = field.find((x) => x.athleteId === s.athleteId); return p && p._position !== null && p._position <= 6 && (p._result === 'F' || p._result === 'MDF'); }).length;
    row.top6List = { selections: t6.length, hits: t6hits };
    rows.push(row);
    ledger.push({
      id: `golf-${meta.eventId}`, date: meta.endDate, tour: meta.tour, event: meta.name,
      picks: Object.fromEntries(keys.map((k) => [k, { selection: row.markets[k].selection, band: row.markets[k].band, status: row.markets[k].status }])),
      actual: { winner: row.winner, resultUrl: meta.sourceUrl },
      settled: true, recorded_by: 'scripts/backtest_golf.mjs (walk-forward re-run)',
    });
    console.log(`  ${meta.tour} ${meta.endDate} ${meta.name}: ` + keys.map((k) => `${k}=${row.markets[k].status}`).join(', '));
  }

  const summary = keys.map((k) => {
    const a = byMarket[k];
    const graded = a.total - a.skipped - a.unverified;
    return { market: k, events: a.total, graded, hits: a.hit, hitRate: graded ? Math.round((a.hit / graded) * 1000) / 1000 : null, noSelection: a.skipped, unverified: a.unverified, byBand: a.byBand };
  });
  const t6 = rows.reduce((acc, r) => { acc.selections += r.top6List.selections; acc.hits += r.top6List.hits; return acc; }, { selections: 0, hits: 0 });

  const out = {
    schema_version: 1,
    sport: 'Golf',
    ruleset: RULESET_VERSION,
    generated_at_utc: new Date().toISOString(),
    method: 'Walk-forward: each completed event is scored with results that ended before its first round only. Fields are reconstructed from the event result rows. Tee times and weather are not available historically, so the first-round-leader tee/weather category is missing for every past event. Strokes gained (season averages) is applied only to current-season events. Grading uses the ESPN leaderboard linked on every row.',
    leak_control: 'historyBefore(asOfISO) filters strictly on endDate < first-round date.',
    known_limitation: `The first ${MIN_HISTORY_EVENTS} events of the tape are skipped because no history exists for them; early-tape events still carry thin history and are graded as such.`,
    events: rows.length,
    summary,
    top6List: { ...t6, rate: t6.selections ? Math.round((t6.hits / t6.selections) * 1000) / 1000 : null },
    rows,
  };
  writeFileSync(OUT_BT, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
  writeFileSync(OUT_LEDGER, `${JSON.stringify({ schema_version: 1, sport: 'Golf', generated_at_utc: out.generated_at_utc, predictions: ledger }, null, 1)}\n`, 'utf8');
  console.log(`\n${rows.length} events graded`);
  for (const s of summary) console.log(`  ${s.market}: ${s.hits}/${s.graded} (${s.hitRate ?? 'n/a'}) no-selection ${s.noSelection}`);
  console.log(`Wrote ${OUT_BT}\nWrote ${OUT_LEDGER}`);
}

main();
