#!/usr/bin/env node
/**
 * SportsPred — T20 Blast walk-forward backtest.
 *
 * Replays the verified 2026 tape in date order. For every fixture the engine is
 * given ONLY the results that were known before that fixture was played:
 * engine/t20_blast_data.js filters on a strict `date < fixtureDate`, so a
 * county's form, points rate, head-to-head, rest and the league's home-win rate
 * are all reconstructed as they stood on the morning of the match. The fixture's
 * own result never enters its own context. That is asserted here, not assumed.
 *
 * Nothing in the engine's weights was fitted against this tape — they are
 * declared a priori in engine/t20_blast_engine.js — so what follows measures
 * the model rather than repeating it.
 *
 * Two scoring paths are reported side by side:
 *   strict_prompt — the master prompt's rubric exactly as written, delegated to
 *                   engine/cricket_engine.js. Three of its five WIN factors have
 *                   no free key-less source, so it resolves to SKIP almost
 *                   everywhere. Its SKIP rate is a finding, not a failure.
 *   evidence      — the declared walk-forward model built only from figures the
 *                   tape verifies.
 *
 * Usage:
 *   node scripts/backtest_t20_blast.mjs            # console report + JSON
 *   node scripts/backtest_t20_blast.mjs --check    # integrity assertions only
 *   node scripts/backtest_t20_blast.mjs --md       # markdown section for docs
 *   node scripts/backtest_t20_blast.mjs --no-write # do not write the JSON
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  scoreBlastMatch, BAND, BLAST_RULESET,
  EVIDENCE_MODEL_VERSION, EVIDENCE_WEIGHTS, PROB_SLOPE,
} from '../engine/t20_blast_engine.js';
import { contextFor, deductionMap, groupMap, resultsBefore } from '../engine/t20_blast_data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATCHES = join(ROOT, 'data', 't20_blast_matches.json');
const STANDINGS = join(ROOT, 'data', 't20_blast_standings.json');
const OUT = join(ROOT, 'data', 't20_blast_backtest.json');

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const AS_MD = args.has('--md');
const NO_WRITE = args.has('--no-write');

const pct = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : null);
const r4 = (v) => (v == null || Number.isNaN(v) ? null : Number(v.toFixed(4)));

function load() {
  const matchesDoc = JSON.parse(readFileSync(MATCHES, 'utf8'));
  const standingsDoc = JSON.parse(readFileSync(STANDINGS, 'utf8'));
  return {
    matchesDoc,
    standingsDoc,
    opts: { deductions: deductionMap(standingsDoc), groupOf: groupMap(standingsDoc) },
  };
}

/* ------------------------------------------------------------------ *
 * Integrity: prove the replay cannot see the future
 * ------------------------------------------------------------------ */

/**
 * Identity for a tape row. Event id where present, otherwise a composite key.
 * Never compare on event id alone: a null id matches every other null id, so a
 * batch of id-less rows would look like look-ahead when nothing leaked at all.
 * That false positive is what surfaced six knockout rows missing their ids.
 */
function rowIdentity(m) {
  return m.event_id ? `id:${m.event_id}` : `fk:${m.date}|${m.home}|${m.away}`;
}

function lookAheadAudit(matchesDoc, rows) {
  const failures = [];
  const matches = matchesDoc.matches;
  const identities = new Map();
  for (const m of matches) {
    const k = rowIdentity(m);
    identities.set(k, (identities.get(k) || 0) + 1);
  }
  for (const [k, n] of identities) {
    if (n > 1) failures.push(`identity ${k} is shared by ${n} tape rows — the audit cannot tell them apart`);
  }
  for (const row of rows) {
    const prior = resultsBefore(matches, row.date);
    if (prior.some((m) => rowIdentity(m) === rowIdentity(row))) {
      failures.push(`${row.home} v ${row.away} (${row.date}): the fixture appears in its own prior-results set`);
    }
    if (prior.some((m) => m.date > row.date)) {
      failures.push(`${row.home} v ${row.away} (${row.date}): a later-dated fixture entered the context`);
    }
  }
  return { checked: rows.length, ok: failures.length === 0, failures };
}

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

function summarise(records) {
  const n = records.length;
  if (!n) return { n: 0, hits: 0, misses: 0, hitRate: null, brier: null, logLoss: null, avgProbabilityHome: null, avgProbabilityPick: null, overconfidence: null };
  const hits = records.filter((r) => r.hit).length;
  let brier = 0;
  let logLoss = 0;
  let probHomeSum = 0;
  let probPickSum = 0;
  for (const r of records) {
    // Two different probabilities, and mixing them up hides overconfidence.
    // P(home) is what Brier and log-loss are scored against; P(pick) is what the
    // model actually claimed about the side it named, and is the only figure
    // comparable to the hit rate.
    const pHome = Math.min(0.999, Math.max(0.001, r.probabilityHome));
    const pPick = Math.min(0.999, Math.max(0.001, r.pickedHome ? r.probabilityHome : 1 - r.probabilityHome));
    probHomeSum += pHome;
    probPickSum += pPick;
    brier += (pHome - r.actualHomeWin) ** 2;
    logLoss += -Math.log(r.hit ? pPick : 1 - pPick);
  }
  return {
    n,
    hits,
    misses: n - hits,
    hitRate: pct(hits, n),
    brier: r4(brier / n),
    logLoss: r4(logLoss / n),
    avgProbabilityHome: r4(probHomeSum / n),
    avgProbabilityPick: r4(probPickSum / n),
    /** Mean claimed probability for the named side minus the rate it delivered. */
    overconfidence: r4(probPickSum / n - hits / n),
  };
}

function byKey(records, keyFn) {
  const out = new Map();
  for (const r of records) {
    const k = keyFn(r) ?? 'unknown';
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return Object.fromEntries([...out.entries()].sort().map(([k, v]) => [k, summarise(v)]));
}

function calibration(records, buckets = 5) {
  const rows = [];
  for (let i = 0; i < buckets; i += 1) {
    const lo = i / buckets;
    const hi = (i + 1) / buckets;
    const inBucket = records.filter((r) => {
      const p = r.pickedHome ? r.probabilityHome : 1 - r.probabilityHome;
      return i === buckets - 1 ? p >= lo && p <= hi : p >= lo && p < hi;
    });
    if (!inBucket.length) continue;
    const predicted = inBucket.reduce((s, r) => s + (r.pickedHome ? r.probabilityHome : 1 - r.probabilityHome), 0) / inBucket.length;
    rows.push({
      band: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      n: inBucket.length,
      predicted: r4(predicted),
      actual: r4(inBucket.filter((r) => r.hit).length / inBucket.length),
      gap: r4(Math.abs(predicted - inBucket.filter((r) => r.hit).length / inBucket.length)),
    });
  }
  return rows;
}

/**
 * Wilson score interval. With samples this small a raw hit rate is close to
 * meaningless on its own: 40% over 20 fixtures spans roughly 19% to 64%, so the
 * interval is published beside every rate to stop anyone over-reading it.
 */
export function wilson(hits, n, z = 1.96) {
  if (!n) return { low: null, high: null };
  const ph = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = ph + (z * z) / (2 * n);
  const margin = z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  return {
    low: r4(Math.max(0, (centre - margin) / denom)),
    high: r4(Math.min(1, (centre + margin) / denom)),
  };
}

/**
 * The publication gate. These rules are declared here, in the script that
 * validates the model, and are applied mechanically to whatever the replay
 * produces. They exist because a tier that walk-forward validation does not
 * support must not be shown to a reader as though it did.
 *
 * The gate never changes a weight and never refits anything. It only decides
 * how much confidence the site is allowed to claim.
 */
export const GATE_RULES = [
  { id: 'tier_inversion', rule: 'If the HIGH tier hit rate is below the MEDIUM tier hit rate, HIGH is not supported by the evidence and published confidence is capped at MEDIUM.' },
  { id: 'insufficient_sample', rule: 'A tier validated on fewer than 30 fixtures cannot support a HIGH claim; the tier is marked insufficient_sample and capped at MEDIUM.' },
  { id: 'no_edge_over_baseline', rule: 'If the overall hit rate does not exceed the always-pick-home baseline, the model has no demonstrated edge; the card must say so and confidence is capped at MEDIUM.' },
  { id: 'overconfident_probability', rule: 'If the mean probability assigned to picks exceeds the observed hit rate by more than 0.10, the model probability is reported as uncalibrated and the observed tier rate is published instead of it.' },
];

export function buildPublicationGate(evidence) {
  const o = evidence.overall;
  const high = evidence.byBand[BAND.HIGH] || { n: 0, hitRate: null };
  const medium = evidence.byBand[BAND.MEDIUM] || { n: 0, hitRate: null };
  const home = evidence.baselines.always_home;
  const triggers = [];

  if (high.n && medium.n && high.hitRate != null && medium.hitRate != null && high.hitRate < medium.hitRate) {
    triggers.push({ id: 'tier_inversion', detail: `HIGH hit ${high.hitRate}% over ${high.n} fixtures while MEDIUM hit ${medium.hitRate}% over ${medium.n}; the tiers are inverted.` });
  }
  if (high.n < 30) {
    triggers.push({ id: 'insufficient_sample', detail: `HIGH was validated on ${high.n} fixtures, below the 30 needed to support the claim.` });
  }
  if (o.hitRate != null && home.hitRate != null && o.hitRate <= home.hitRate) {
    triggers.push({ id: 'no_edge_over_baseline', detail: `the model hit ${o.hitRate}% against an always-pick-home baseline of ${home.hitRate}% on the same fixtures.` });
  }
  if (o.avgProbabilityPick != null && o.hitRate != null && o.avgProbabilityPick - o.hitRate / 100 > 0.10) {
    triggers.push({
      id: 'overconfident_probability',
      detail: `the model assigned its picks a mean probability of ${o.avgProbabilityPick} and they won ${o.hitRate}% of the time — overconfident by ${((o.avgProbabilityPick - o.hitRate / 100) * 100).toFixed(1)} points.`,
    });
  }

  const capped = triggers.length > 0;
  return {
    rules: GATE_RULES,
    triggered: triggers,
    cap: capped ? BAND.MEDIUM : null,
    capReason: capped
      ? 'Walk-forward validation on the 2026 tape does not support a HIGH claim, so no tip is published above MEDIUM until a larger validated sample says otherwise.'
      : null,
    publishObservedRates: true,
    modelProbabilityCalibrated: !triggers.some((t) => t.id === 'overconfident_probability'),
    note: 'The gate changes what the site is allowed to claim. It does not change the model weights, which remain declared a priori and unfitted.',
  };
}

/* ------------------------------------------------------------------ *
 * Baselines the model has to beat to be worth publishing
 * ------------------------------------------------------------------ */

function baselines(records) {
  const home = records.filter((r) => r.actualHomeWin === 1).length;
  const seasonLeader = records.filter((r) => r.priorPointsLeader === r.actualWinner).length;
  const priorPointsLeaderKnown = records.filter((r) => r.priorPointsLeader).length;
  return {
    always_home: { n: records.length, hits: home, hitRate: pct(home, records.length) },
    prior_points_leader: {
      n: priorPointsLeaderKnown,
      hits: seasonLeader,
      hitRate: pct(seasonLeader, priorPointsLeaderKnown),
      note: 'picks the county with more points per fixture to date; the simplest honest alternative to the full model',
    },
  };
}

/* ------------------------------------------------------------------ *
 * Replay
 * ------------------------------------------------------------------ */

function replay() {
  const { matchesDoc, standingsDoc, opts } = load();
  const rows = [...matchesDoc.matches].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const audit = lookAheadAudit(matchesDoc, rows);

  const records = [];
  const strictPath = { scored: 0, skipped: 0, hits: 0, decided: 0 };
  const ties = [];

  for (const row of rows) {
    const ctx = contextFor(row, matchesDoc, opts);
    const result = scoreBlastMatch(row, ctx);
    const wm = result.markets.win_match;
    const decided = !!row.winner_slug;

    // Strict-prompt path, reported for the comparison the docs promise.
    if (wm.strict_prompt?.band && wm.strict_prompt.band !== BAND.SKIP) {
      strictPath.scored += 1;
      if (decided) {
        strictPath.decided += 1;
        if (wm.strict_prompt.selection === row.winner) strictPath.hits += 1;
      }
    } else {
      strictPath.skipped += 1;
    }

    if (!decided) {
      ties.push({ event_id: row.event_id, date: row.date, match: `${row.home} v ${row.away}`, stage: row.stage, band: wm.band });
      continue;
    }
    if (wm.band === BAND.SKIP || !wm.probability) continue;

    const pickedHome = wm.selection === row.home;
    const probabilityHome = pickedHome ? wm.probability : Number((1 - wm.probability).toFixed(3));

    // Prior points leader, from the same walk-forward table the engine used.
    const rateOf = (side) => (side?.table?.played ? side.table.points / side.table.played : null);
    const hr = rateOf(ctx.home);
    const ar = rateOf(ctx.away);
    let priorPointsLeader = null;
    if (hr != null && ar != null && hr !== ar) priorPointsLeader = hr > ar ? row.home : row.away;

    records.push({
      event_id: row.event_id,
      date: row.date,
      stage: row.stage,
      group: row.group,
      match: `${row.home} v ${row.away}`,
      home: row.home,
      away: row.away,
      pickedHome,
      selection: wm.selection,
      actualWinner: row.winner,
      hit: wm.selection === row.winner,
      band: wm.band,
      evidenceScore: wm.score,
      oppositionScore: wm.opposition_score,
      probabilityPick: wm.probability,
      probabilityHome,
      actualHomeWin: row.winner_slug === row.home_slug ? 1 : 0,
      priorPointsLeader,
      caps: result.caps,
      missingCount: result.missing.length,
      margin: row.margin ?? null,
      resultType: row.result_type,
      dlMethod: !!row.dl_method,
      reviewUrls: row.review_urls || [],
    });
  }

  return { matchesDoc, standingsDoc, rows, audit, records, strictPath, ties };
}

function buildReport() {
  const { matchesDoc, rows, audit, records, strictPath, ties } = replay();

  const overall = summarise(records);
  const byBand = byKey(records, (r) => r.band);
  const byPickSide = {
    home: summarise(records.filter((r) => r.pickedHome)),
    away: summarise(records.filter((r) => !r.pickedHome)),
  };
  const evidence = {
    overall,
    byBand,
    byStage: byKey(records, (r) => r.stage),
    byGroup: byKey(records, (r) => r.group),
    byResultType: byKey(records, (r) => r.resultType),
    byPickSide,
    rainAffected: summarise(records.filter((r) => r.dlMethod)),
    calibration: calibration(records),
    baselines: baselines(records),
    // Hit rate alone invites over-reading at this sample size, so every rate
    // carries its Wilson 95% interval.
    intervals: {
      overall: { hitRate: overall.hitRate, n: overall.n, ci95: wilson(overall.hits, overall.n) },
      byBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) => [k, { hitRate: v.hitRate, n: v.n, ci95: wilson(v.hits, v.n) }])),
      homePicks: { hitRate: byPickSide.home.hitRate, n: byPickSide.home.n, ci95: wilson(byPickSide.home.hits, byPickSide.home.n) },
      awayPicks: { hitRate: byPickSide.away.hitRate, n: byPickSide.away.n, ci95: wilson(byPickSide.away.hits, byPickSide.away.n) },
    },
  };
  evidence.publicationGate = buildPublicationGate(evidence);

  const homeWins = rows.filter((r) => r.winner_slug && r.winner_slug === r.home_slug).length;
  const decided = rows.filter((r) => r.winner_slug).length;

  const report = {
    schema_version: 't20-blast-backtest-1.0.0',
    generated_at_utc: new Date().toISOString(),
    sport: 'cricket',
    competition: matchesDoc.competition,
    season: matchesDoc.season,
    ruleset: BLAST_RULESET,
    evidence_model: EVIDENCE_MODEL_VERSION,
    declared_weights: EVIDENCE_WEIGHTS,
    declared_probability_slope: PROB_SLOPE,
    weights_fitted_to_this_tape: false,
    method: {
      order: 'chronological by fixture date',
      context: 'walk-forward; engine/t20_blast_data.js keeps only fixtures strictly earlier than the one being scored',
      lookAheadAudit: audit,
      excluded: 'tied fixtures (no winner to score against) and fixtures the engine withheld as SKIP',
      probability: 'the engine reports P(selected side wins); P(home) is derived from it for Brier and log-loss',
    },
    coverage: {
      fixtures_in_tape: rows.length,
      decided: decided,
      ties: ties.length,
      scored_by_model: records.length,
      withheld_by_model: rows.length - ties.length - records.length,
      withhold_rate_pct: pct(rows.length - ties.length - records.length, rows.length - ties.length),
      home_wins_in_tape: homeWins,
      home_win_rate_pct: pct(homeWins, decided),
      tape_gaps: matchesDoc.gaps?.length ?? 0,
      tape_gap_note: 'Form and head-to-head are reconstructed from captured fixtures only; the two absent Derbyshire home fixtures and the absent cross-pool fixtures thin the context for their dates, which the model reflects by withholding rather than guessing.',
    },
    strict_prompt_path: {
      ...strictPath,
      skip_rate_pct: pct(strictPath.skipped, strictPath.skipped + strictPath.scored),
      hit_rate_pct: pct(strictPath.hits, strictPath.decided),
      note: 'The master prompt rubric as literally written. Three of its five WIN factors (bowling matchup scouting, batting depth from individual form, bookmaker odds) have no free key-less source, so the rubric penalises them to a SKIP. This is the honest output of the prompt against the data that exists, and it is why the declared evidence model is what the site publishes.',
    },
    evidence_path: evidence,
    ties,
    records,
  };
  return report;
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

function table(title, obj) {
  const lines = [`\n${title}`];
  const keys = Object.keys(obj);
  if (!keys.length) return `${title}\n  (no records)`;
  lines.push('  ' + ['segment', 'n', 'hits', 'hit%', 'brier', 'logloss'].join('\t'));
  for (const k of keys) {
    const v = obj[k];
    lines.push('  ' + [k, v.n, v.hits ?? 0, v.hitRate ?? '-', v.brier ?? '-', v.logLoss ?? '-'].join('\t'));
  }
  return lines.join('\n');
}

function printReport(r) {
  const e = r.evidence_path;
  console.log(`T20 BLAST BACKTEST — ${r.competition} ${r.season}`);
  console.log(`model ${r.evidence_model} · weights declared a priori, never fitted to this tape`);
  console.log(`look-ahead audit: ${r.method.lookAheadAudit.ok ? 'PASS' : 'FAIL'} (${r.method.lookAheadAudit.checked} fixtures checked)`);
  for (const f of r.method.lookAheadAudit.failures) console.log(`  ! ${f}`);

  const c = r.coverage;
  console.log(`\nCOVERAGE  tape ${c.fixtures_in_tape} · decided ${c.decided} · ties ${c.ties} · scored ${c.scored_by_model} · withheld ${c.withheld_by_model} (${c.withhold_rate_pct}%)`);
  console.log(`          home wins in tape ${c.home_wins_in_tape} of ${c.decided} (${c.home_win_rate_pct}%) · tape gaps ${c.tape_gaps}`);

  const sp = r.strict_prompt_path;
  console.log(`\nSTRICT PROMPT PATH  scored ${sp.scored} · skipped ${sp.skipped} (${sp.skip_rate_pct}%) · decided ${sp.decided} · hits ${sp.hits} (${sp.hit_rate_pct}%)`);
  console.log('  ' + sp.note);

  console.log(`\nEVIDENCE PATH  n=${e.overall.n} hits=${e.overall.hits} hitRate=${e.overall.hitRate}% brier=${e.overall.brier} logLoss=${e.overall.logLoss} avgP(pick)=${e.overall.avgProbabilityPick} avgP(home)=${e.overall.avgProbabilityHome} overconfidence=+${e.overall.overconfidence}`);
  console.log(table('by confidence band', e.byBand));
  console.log(table('by stage', e.byStage));
  console.log(table('by group', e.byGroup));
  console.log(table('by result type', e.byResultType));
  console.log(table('by pick side', e.byPickSide));
  console.log(`\nRAIN / DLS-AFFECTED  n=${e.rainAffected.n} hitRate=${e.rainAffected.hitRate ?? '-'}%`);
  console.log('\nWILSON 95% INTERVALS (a hit rate on a small sample is not a fact on its own)');
  console.log(`  overall      ${e.intervals.overall.hitRate}%  n=${e.intervals.overall.n}  [${e.intervals.overall.ci95.low} - ${e.intervals.overall.ci95.high}]`);
  for (const [k, v] of Object.entries(e.intervals.byBand)) console.log(`  ${k.padEnd(12)} ${v.hitRate}%  n=${v.n}  [${v.ci95.low} - ${v.ci95.high}]`);
  console.log(`  home picks   ${e.intervals.homePicks.hitRate}%  n=${e.intervals.homePicks.n}  [${e.intervals.homePicks.ci95.low} - ${e.intervals.homePicks.ci95.high}]`);
  console.log(`  away picks   ${e.intervals.awayPicks.hitRate}%  n=${e.intervals.awayPicks.n}  [${e.intervals.awayPicks.ci95.low} - ${e.intervals.awayPicks.ci95.high}]`);

  const gate = e.publicationGate;
  console.log(`\nPUBLICATION GATE  cap=${gate.cap ?? 'none'}  triggered=${gate.triggered.length}`);
  for (const t of gate.triggered) console.log(`  ! ${t.id}: ${t.detail}`);
  if (gate.capReason) console.log(`  => ${gate.capReason}`);
  console.log('\nCALIBRATION (predicted vs actual, by probability of the pick)');
  console.log('  ' + ['bucket', 'n', 'predicted', 'actual', 'gap'].join('\t'));
  for (const b of e.calibration) console.log('  ' + [b.band, b.n, b.predicted, b.actual, b.gap].join('\t'));

  console.log('\nBASELINES');
  console.log(`  always pick home        n=${e.baselines.always_home.n} hits=${e.baselines.always_home.hits} hitRate=${e.baselines.always_home.hitRate}%`);
  console.log(`  prior points leader     n=${e.baselines.prior_points_leader.n} hits=${e.baselines.prior_points_leader.hits} hitRate=${e.baselines.prior_points_leader.hitRate}%`);

  if (r.ties.length) {
    console.log('\nTIED FIXTURES (no winner; excluded from hit rate)');
    for (const t of r.ties) console.log(`  ${t.date}  ${t.match}  [${t.stage}] band=${t.band}`);
  }
}

function toMarkdown(r) {
  const e = r.evidence_path;
  const c = r.coverage;
  const sp = r.strict_prompt_path;
  const md = [];
  md.push(`## Backtest — ${r.competition} ${r.season}`);
  md.push('');
  md.push(`Model \`${r.evidence_model}\`, ruleset \`${r.ruleset}\`. Weights are declared a priori in \`engine/t20_blast_engine.js\` (${Object.entries(r.declared_weights).map(([k, v]) => `${k} ${v}`).join(', ')}) and were **not** fitted against this tape, so the numbers below measure the model rather than repeat it. The replay is walk-forward: each fixture is scored using only results strictly earlier than its own date, and that is asserted by a look-ahead audit rather than assumed.`);
  md.push('');
  md.push(`| Measure | Value |`);
  md.push(`| --- | --- |`);
  md.push(`| Fixtures in tape | ${c.fixtures_in_tape} |`);
  md.push(`| Decided / tied | ${c.decided} / ${c.ties} |`);
  md.push(`| Scored by the evidence model | ${c.scored_by_model} |`);
  md.push(`| Withheld (SKIP) | ${c.withheld_by_model} (${c.withhold_rate_pct}%) |`);
  md.push(`| Home wins in tape | ${c.home_wins_in_tape} of ${c.decided} (${c.home_win_rate_pct}%) |`);
  md.push(`| Hit rate, all scored fixtures | **${e.overall.hitRate}%** (${e.overall.hits}/${e.overall.n}) |`);
  md.push(`| Brier score | ${e.overall.brier} |`);
  md.push(`| Log loss | ${e.overall.logLoss} |`);
  md.push(`| Mean probability assigned to the pick | ${e.overall.avgProbabilityPick} |`);
  md.push(`| Overconfidence (claimed minus delivered) | +${e.overall.overconfidence} |`);
  md.push(`| Baseline: always pick home | ${e.baselines.always_home.hitRate}% |`);
  md.push(`| Baseline: prior points leader | ${e.baselines.prior_points_leader.hitRate}% (n=${e.baselines.prior_points_leader.n}) |`);
  md.push(`| Look-ahead audit | ${r.method.lookAheadAudit.ok ? 'PASS' : 'FAIL'} |`);
  md.push('');
  const gate = e.publicationGate;
  md.push(`| Wilson 95% interval, overall | ${e.intervals.overall.ci95.low} – ${e.intervals.overall.ci95.high} |`);
  md.push(`| Home picks | ${e.byPickSide.home.hits}/${e.byPickSide.home.n} (${e.byPickSide.home.hitRate}%) |`);
  md.push(`| Away picks | ${e.byPickSide.away.hits}/${e.byPickSide.away.n} (${e.byPickSide.away.hitRate}%) |`);
  md.push(`| Publication gate | ${gate.cap ? `capped at **${gate.cap}**` : 'no cap'} |`);
  md.push('');
  md.push('### By confidence band');
  md.push('');
  md.push('| Band | n | Hits | Hit rate | Brier | Log loss |');
  md.push('| --- | --- | --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(e.byBand)) md.push(`| ${k} | ${v.n} | ${v.hits} | ${v.hitRate}% | ${v.brier ?? '—'} | ${v.logLoss ?? '—'} |`);
  md.push('');
  md.push('### By stage');
  md.push('');
  md.push('| Stage | n | Hits | Hit rate |');
  md.push('| --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(e.byStage)) md.push(`| ${k} | ${v.n} | ${v.hits} | ${v.hitRate}% |`);
  md.push('');
  md.push('### Calibration');
  md.push('');
  md.push('| Predicted band | n | Mean predicted | Actual | Gap |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const b of e.calibration) md.push(`| ${b.band} | ${b.n} | ${b.predicted} | ${b.actual} | ${b.gap} |`);
  md.push('');
  md.push('### The two scoring paths');
  md.push('');
  md.push(`Applied literally, the master prompt's own rubric skipped **${sp.skip_rate_pct}%** of fixtures (${sp.skipped} of ${sp.skipped + sp.scored}), because three of its five WIN factors — bowling matchup scouting, batting depth from individual form, and bookmaker odds — have no free key-less source for county cricket. Where it did produce a selection it was right ${sp.hit_rate_pct ?? '—'}% of the time (${sp.hits}/${sp.decided}). The declared evidence model, built only from figures the tape verifies, scored ${c.scored_by_model} fixtures at ${e.overall.hitRate}%.`);
  md.push('');
  md.push('Both numbers are published. The first is what the prompt as written can honestly do with public data; the second is what a model restricted to sourced evidence can do. Neither invents a value, and every withheld market says why.');
  md.push('');
  md.push('### What the backtest found, plainly');
  md.push('');
  md.push(`The evidence model hit **${e.overall.hitRate}%** across ${e.overall.n} scored fixtures. On the same fixtures, simply backing the home county every time would have hit **${e.baselines.always_home.hitRate}%**. The model therefore shows **no demonstrated edge over home advantage** on this tape.`);
  md.push('');
  md.push(`Confidence is inverted: the HIGH tier hit ${e.byBand[BAND.HIGH]?.hitRate ?? '—'}% (${e.byBand[BAND.HIGH]?.hits ?? 0}/${e.byBand[BAND.HIGH]?.n ?? 0}) while MEDIUM hit ${e.byBand[BAND.MEDIUM]?.hitRate ?? '—'}% (${e.byBand[BAND.MEDIUM]?.hits ?? 0}/${e.byBand[BAND.MEDIUM]?.n ?? 0}). The Wilson interval on the HIGH tier is ${e.intervals.byBand[BAND.HIGH]?.ci95.low ?? '—'}–${e.intervals.byBand[BAND.HIGH]?.ci95.high ?? '—'}, so at n=${e.byBand[BAND.HIGH]?.n ?? 0} that tier is too thin to prove it is worse than MEDIUM — and far too thin to justify publishing it as HIGH. Either way the claim is unsupported, which is what the gate acts on.`);
  md.push('');
  md.push(`The model assigns its picks a mean probability of ${e.overall.avgProbabilityPick} and they win ${e.overall.hitRate}% of the time — overconfident by ${((e.overall.avgProbabilityPick - e.overall.hitRate / 100) * 100).toFixed(1)} points. The calibration table shows the gap widening as the claimed probability rises: picks placed in the 80–100% bucket landed ${(e.calibration.find((b) => b.band === '80-100%')?.actual * 100).toFixed(0)}% of the time. The site therefore publishes the **observed** rate for a tier rather than the model's own probability.`);
  md.push('');
  md.push(`Picks are not skewed toward home sides — the model chose home ${e.byPickSide.home.n} times and away ${e.byPickSide.away.n} times — but away picks hit ${e.byPickSide.away.hitRate}% against an away base rate of ${(100 - e.baselines.always_home.hitRate).toFixed(1)}%, so most of the shortfall sits there.`);
  md.push('');
  md.push('### The publication gate');
  md.push('');
  md.push('These rules live in `scripts/backtest_t20_blast.mjs` and are applied mechanically to whatever the replay produces. The gate never alters a model weight and never refits anything; it only limits what the site may claim.');
  md.push('');
  md.push('| Rule | Statement |');
  md.push('| --- | --- |');
  for (const r of gate.rules) md.push(`| \`${r.id}\` | ${r.rule} |`);
  md.push('');
  // Details already end in a full stop; stripping it before the join avoids
  // "..", and the sentence supplies one closing stop of its own.
  const detail = (t) => `\`${t.id}\` — ${String(t.detail).replace(/\.$/, '')}`;
  md.push(`**Triggered on the 2026 tape:** ${gate.triggered.length ? gate.triggered.map(detail).join('; ') + '.' : 'none'}`);
  md.push('');
  md.push(gate.cap ? `**Result: published confidence is capped at ${gate.cap}.** ${gate.capReason}` : '**Result: no cap applied.**');
  md.push('');
  md.push('Reweighting the model until it beat the baseline on these 96 fixtures was the obvious way to make these numbers look better, and it was deliberately not done: that would fit the weights to the only tape available and leave nothing to validate against. The gate is applied instead, and it will be re-evaluated whenever `scripts/collect_t20_blast.mjs` adds a season.');
  md.push('');
  md.push('### Known limits');
  md.push('');
  md.push(`The tape captures ${c.fixtures_in_tape} of 115 season fixtures: 88 of 90 in-group matches, 1 of 18 cross-pool fixtures, and all 7 knockouts. Form and head-to-head are therefore reconstructed from in-group fixtures for most dates, which thins the context around the two absent Derbyshire home fixtures and around every cross-pool date. The model responds by withholding rather than guessing — that is what the ${c.withhold_rate_pct}% SKIP rate mostly consists of. \`scripts/collect_t20_blast.mjs\` exists to close those gaps from the ESPN league calendar for the next season.`);
  md.push('');
  return md.join('\n');
}

/* ------------------------------------------------------------------ */

const report = buildReport();

if (CHECK_ONLY) {
  const problems = [];
  if (!report.method.lookAheadAudit.ok) problems.push('look-ahead audit failed');
  const o = report.evidence_path.overall;
  if (o.n && o.hits + o.misses !== o.n) problems.push('hits + misses does not equal n');
  if (report.coverage.scored_by_model !== o.n) problems.push('coverage count disagrees with metric count');
  if (o.brier != null && (o.brier < 0 || o.brier > 1)) problems.push('Brier outside 0..1');
  if (o.avgProbabilityPick != null && o.hitRate != null) {
    const claimed = Number(((o.avgProbabilityPick - o.hitRate / 100) * 100).toFixed(1));
    if (Math.abs(claimed - Number((o.overconfidence * 100).toFixed(1))) > 0.2) problems.push('overconfidence does not equal claimed minus delivered');
  }
  const g = report.evidence_path.publicationGate;
  if (g.cap && !g.triggered.length) problems.push('a gate cap is set but no rule triggered');
  if (!g.cap && g.triggered.length) problems.push('gate rules triggered but no cap was set');
  if (report.strict_prompt_path.scored + report.strict_prompt_path.skipped !== report.coverage.fixtures_in_tape) problems.push('strict-path counts do not cover the tape');
  if (problems.length) {
    console.error('BACKTEST CHECK FAILED:');
    for (const p of problems) console.error(`  ! ${p}`);
    process.exit(1);
  }
  console.log(`backtest checks PASS — ${o.n} scored fixtures, hit rate ${o.hitRate}%, look-ahead audit clean over ${report.method.lookAheadAudit.checked} fixtures`);
  process.exit(0);
}

if (AS_MD) {
  console.log(toMarkdown(report));
} else {
  printReport(report);
}

if (!NO_WRITE) {
  report.markdown = toMarkdown(report);
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!AS_MD) console.log(`\nwrote ${OUT.replace(`${ROOT}/`, '')}`);
}
