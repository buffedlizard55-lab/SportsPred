#!/usr/bin/env node
/**
 * Walk-forward backtest for the universal engine.
 *
 * LEAK CONTROL — read this before trusting any number below.
 *
 * ESPN's `competitor.form` and `records` fields describe the team AS OF THE
 * REQUEST, not as of the match date. Using them to grade a past match would
 * leak the result into its own prediction. This script therefore ignores both
 * of those fields and rebuilds every feature from the match tape, using only
 * games that finished strictly BEFORE the fixture being graded:
 *
 *   - form            -> formFromTape(..., beforeUtc = kickoff)
 *   - season record   -> wins/draws/losses accumulated before kickoff
 *   - league baseline -> measured on matches completed before kickoff
 *   - head to head    -> meetings completed before kickoff
 *   - price           -> the odds attached to that event (a closing price, the
 *                        only price the free feed retains). This is stated as a
 *                        limitation, not hidden: a closing price is sharper
 *                        than the price that was available earlier, so the
 *                        market-blend leg of the model is flattered.
 *
 * Output: data/universal_backtest.json + a printed summary.
 * Run: node scripts/backtest_universal.mjs [--days 120] [--sport football]
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPORTS, getSport, ESPN_SITE_BASE } from '../engine/registry.js';
import { espnSportFor, scoreUniversalMatch } from '../engine/universal_engine.js';
import { parseScoreboard, buildLeagueContext, headToHead, formFromTape, restDays } from '../engine/espn_universal.js';

const DAYS = Number(arg('--days') || 120);
const ONLY = arg('--sport');
const OUT = arg('--out') || 'data/universal_backtest.json';
const REGISTRY = arg('--registry') || 'data/leagues.json';
const CONCURRENCY = 5;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}
function stamp(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}
async function pool(items, limit, worker) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) { const idx = i; i += 1; out[idx] = await worker(items[idx]); }
  }));
  return out;
}

/** Season record from the tape, strictly before the cut-off. */
function recordBefore(tape, team, beforeUtc) {
  let wins = 0, losses = 0, draws = 0;
  for (const m of tape) {
    if (m.phase !== 'results' || !m.winner) continue;
    if (String(m.startUtc) >= String(beforeUtc)) continue;
    const isHome = m.home?.name === team;
    const isAway = m.away?.name === team;
    if (!isHome && !isAway) continue;
    if (m.winner === 'draw') draws += 1;
    else if ((m.winner === 'home' && isHome) || (m.winner === 'away' && isAway)) wins += 1;
    else losses += 1;
  }
  const played = wins + losses + draws;
  if (!played) return null;
  return { wins, losses, draws, played, winPct: (wins + draws * 0.5) / played };
}

function brier(p, hit) { return (p - (hit ? 1 : 0)) ** 2; }

async function main() {
  const registry = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : null;
  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 86400000);

  const jobs = [];
  for (const sport of SPORTS) {
    if (!sport.espnSport || !sport.predictable) continue;
    if (ONLY && sport.key !== ONLY) continue;
    const reg = registry?.sports?.[sport.key]?.leagues;
    const leagues = Array.isArray(reg) && reg.length
      ? reg.filter((l) => l.ok).map((l) => ({ slug: l.slug, name: l.name }))
      : (sport.candidateLeagues || []);
    for (const lg of leagues) jobs.push({ sport, lg });
  }

  const graded = [];
  const byBand = {};
  const byMarket = {};

  await pool(jobs, CONCURRENCY, async ({ sport, lg }) => {
    const url = `${ESPN_SITE_BASE}/${espnSportFor(sport.key)}/${lg.slug}/scoreboard?dates=${stamp(from)}-${stamp(to)}`;
    const raw = await getJSON(url);
    if (!raw) return;
    const tape = parseScoreboard(raw, { sportKey: sport.key, leagueSlug: lg.slug, leagueName: lg.name }).matches;
    const finished = tape.filter((m) => m.phase === 'results' && m.winner);
    if (finished.length < 20) return;

    for (const m of finished) {
      const cut = m.startUtc;
      const before = tape.filter((x) => x.phase === 'results' && String(x.startUtc) < String(cut));
      if (before.length < 15) continue; // not enough history yet to make a call

      // Rebuild the match with leak-free features only.
      const rebuilt = {
        ...m,
        home: {
          ...m.home,
          form: formFromTape(before, m.home.name, cut),
          record: recordBefore(before, m.home.name, cut),
          recordSummary: null,
          score: null,
        },
        away: {
          ...m.away,
          form: formFromTape(before, m.away.name, cut),
          record: recordBefore(before, m.away.name, cut),
          recordSummary: null,
          score: null,
        },
        phase: 'upcoming',
        winner: null,
      };

      const ctx = {
        threeWay: sport.threeWay === true,
        leagueContext: buildLeagueContext(before, { threeWay: sport.threeWay }),
        h2h: headToHead(before, m.home.name, m.away.name, cut),
        rest: { home: restDays(before, m.home.name, cut), away: restDays(before, m.away.name, cut) },
      };

      const scored = scoreUniversalMatch(rebuilt, ctx);
      const head = scored.headline;
      if (!head || head.market !== 'match_result' || !head.selection) continue;

      const actual = m.winner; // 'home' | 'away' | 'draw'
      const pickKey = scored.markets.match_result.selectionKey;
      const hit = pickKey === actual;

      graded.push({
        sport: sport.key,
        league: lg.slug,
        date: m.dateISO,
        match: `${m.home.name} v ${m.away.name}`,
        selection: head.selection,
        band: head.band,
        score: head.score,
        probability: head.probability,
        priced: Boolean(scored.markets.match_result.priced),
        price: scored.markets.match_result.price,
        actual,
        hit,
      });

      const b = byBand[head.band] || (byBand[head.band] = { n: 0, hits: 0, brier: 0, staked: 0, returned: 0 });
      b.n += 1; b.hits += hit ? 1 : 0; b.brier += brier(head.probability, hit);
      if (scored.markets.match_result.price) { b.staked += 1; b.returned += hit ? scored.markets.match_result.price : 0; }

      const k = byMarket[head.market] || (byMarket[head.market] = { n: 0, hits: 0 });
      k.n += 1; k.hits += hit ? 1 : 0;
    }
  });

  const overall = {
    n: graded.length,
    hits: graded.filter((g) => g.hit).length,
    hitRate: graded.length ? graded.filter((g) => g.hit).length / graded.length : null,
    brier: graded.length ? graded.reduce((a, g) => a + brier(g.probability, g.hit), 0) / graded.length : null,
  };
  const priced = graded.filter((g) => g.price);
  overall.roi = priced.length
    ? (priced.reduce((a, g) => a + (g.hit ? g.price : 0), 0) - priced.length) / priced.length
    : null;

  for (const [band, v] of Object.entries(byBand)) {
    v.hitRate = v.n ? v.hits / v.n : null;
    v.brier = v.n ? v.brier / v.n : null;
    v.roi = v.staked ? (v.returned - v.staked) / v.staked : null;
    byBand[band] = v;
  }

  const doc = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    generator: 'scripts/backtest_universal.mjs',
    window: { days: DAYS, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    leak_control: 'Form, season record, league baseline and head-to-head are rebuilt from matches completed strictly before each fixture. ESPN\'s live form/record fields are discarded.',
    known_limitation: 'The only price the free feed retains for a finished match is a closing price, which is sharper than the price that was available before the match. The market-blend leg of the model is therefore flattered and the ROI figure should be read as an upper bound.',
    overall,
    byBand,
    byMarket,
    sample: graded.slice(0, 200),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);

  console.log(`\nUniversal engine walk-forward backtest — ${doc.window.from} to ${doc.window.to}`);
  console.log(`graded selections : ${overall.n}`);
  console.log(`hit rate          : ${overall.hitRate === null ? 'n/a' : `${(overall.hitRate * 100).toFixed(1)}%`}`);
  console.log(`Brier score       : ${overall.brier === null ? 'n/a' : overall.brier.toFixed(4)}`);
  console.log(`flat-stake ROI    : ${overall.roi === null ? 'n/a' : `${(overall.roi * 100).toFixed(1)}%`} (closing prices — upper bound)`);
  for (const [band, v] of Object.entries(byBand)) {
    console.log(`  ${band.padEnd(7)} n=${String(v.n).padStart(4)}  hit=${v.hitRate === null ? 'n/a' : `${(v.hitRate * 100).toFixed(1)}%`}  brier=${v.brier.toFixed(4)}  roi=${v.roi === null ? 'n/a' : `${(v.roi * 100).toFixed(1)}%`}`);
  }
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
