/**
 * SportsPred — Golf Tournament Prediction Engine.
 *
 * Implements Step 2 (scoring) and Step 3 (bet decision rules) of
 * "GOLF TOURNAMENT PREDICTION MASTER PROMPT v1.0" for five markets:
 *   OUTRIGHT WINNER, TOP 6 FINISH, FIRST ROUND LEADER,
 *   TOP EUROPEAN, TOP AMERICAN, TOP BRITISH & IRISH.
 *
 * Pure: no I/O, no clock, no randomness. Every input is a profile built by
 * golf_data.js from committed, source-linked documents.
 *
 * HONESTY RULES (identical to the other specialist engines)
 *   1. A factor the sources do not publish scores 0, is marked missing:true on
 *      its component and is listed in `missing[]` with the reason.
 *   2. A selection whose core components include a missing factor can never
 *      be graded HIGH — partial evidence caps at MEDIUM.
 *   3. Where the prompt names a factor no free source publishes (strokes
 *      gained over the last eight events, grass type, links classification),
 *      the closest MEASURED substitute is used only when it exists and the
 *      substitution is named in the component detail. See
 *      docs/GOLF_IRREGULARITIES.md for the full register.
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';

export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' });

export const MARKETS = Object.freeze({
  outright: 'OUTRIGHT WINNER',
  top6: 'TOP 6 FINISH',
  frl: 'FIRST ROUND LEADER',
  top_european: 'TOP EUROPEAN',
  top_american: 'TOP AMERICAN',
  top_british_irish: 'TOP BRITISH & IRISH',
});

export const MARKET_ORDER = Object.freeze(['outright', 'top6', 'frl', 'top_european', 'top_american', 'top_british_irish']);

/** Step 3 thresholds, verbatim from the prompt. */
export const RULES = Object.freeze({
  outright: { high: 75, medium: 60 },                 // < 60 = LOW (value play), never SKIP
  top6: { high: 65, medium: 55, skip: 55, max: 6 },   // < 55 = SKIP
  frl: { high: 75, medium: 65, low: 55, list: 50, max: 5 }, // ≥ 75 with a tee-time/weather edge = HIGH
  regional: { high: 70, medium: 55, coSelectGap: 5 },
  value: { fieldRankMin: 15, fieldRankMax: 40, fitMin: 18, formMin: 14, favouriteCut: 5 },
  top6Guard: { favouriteCut: 6, minFieldRank: 15 },
  minStarts: 3,
  /** A selection needs some sourced evidence: a positive score and at least one measured core category. */
  minEvidence: { score: 1, coreMeasured: 1 },
});

const CORE_IDS = ['form', 'sg_app', 'course_hist', 'course_fit', 'owgr'];

/** True when the candidate has enough sourced evidence to be written at all. */
export function hasEvidence(cand) {
  if (!cand || !(cand.score >= RULES.minEvidence.score)) return false;
  const measured = (cand.components || []).filter((c) => CORE_IDS.includes(c.id) && !c.missing).length;
  return measured >= RULES.minEvidence.coreMeasured;
}

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

function sum(components) {
  return components.reduce((a, c) => a + (Number(c.points) || 0), 0);
}

/* ------------------------------------------------------------------ *
 * OUTRIGHT base categories (100)
 * ------------------------------------------------------------------ */

function scoreForm(p, missing) {
  const f = p.form || {};
  const out = [];
  if (!f.starts) {
    missing.push(`${p.name}: form (no completed starts in the sourced results tape before this event)`);
    out.push(comp('form', 'Recent form (last five starts, six-week window double weight)', 0, 'no starts in tape', { max: 25, missing: true }));
    return out;
  }
  let pts = 0; let detail;
  if (f.winIn6w) { pts = 25; detail = 'win inside the last six weeks'; }
  else if (f.top3In6w) { pts = 19; detail = 'top-three finish inside the last six weeks'; }
  else if (f.top10Last5 >= 2) { pts = 14; detail = `${f.top10Last5} top-ten finishes in the last five starts`; }
  else if (f.top10Last5 === 1) { pts = 8; detail = 'one top-ten finish in the last five starts'; }
  else if (f.top20Last5 >= 1) { pts = 0; detail = 'top-twenty but no top-ten in the last five starts (prompt assigns no tier; scored as the floor)'; }
  else { pts = 0; detail = 'no top-twenty finish in the last five starts'; }
  const thin = f.starts < RULES.minStarts;
  if (thin) {
    missing.push(`${p.name}: form sample thin (${f.starts} start${f.starts === 1 ? '' : 's'} in tape)`);
  }
  out.push(comp('form', 'Recent form (last five starts, six-week window double weight)', pts, detail, { max: 25, missing: thin }));
  if (f.backToBackTop10) out.push(comp('form_b2b', 'Back-to-back top-ten finishes', 5, 'most recent two starts both top ten', { max: 5 }));
  if (f.comparableFieldTop10 === true) out.push(comp('form_field', 'Top ten in a comparable or stronger field', 5, 'measured by purse or elevated status of the event', { max: 5 }));
  return out;
}

function scoreStrokesGained(p, ctx, missing) {
  const out = [];
  const sg = p.sg || null;
  if (!sg || !sg.app) {
    missing.push(`${p.name}: strokes gained approach (no free per-player strokes-gained source for this tour/event)`);
    out.push(comp('sg_app', 'Strokes gained: approach (field rank)', 0, 'not sourced', { max: 25, missing: true }));
    return out;
  }
  const rank = ctx.sgAppInField?.get(p.athleteId) ?? null;
  let pts = 0;
  if (rank !== null && rank <= 5) pts = 25;
  else if (rank !== null && rank <= 15) pts = 17;
  else if (rank !== null && rank <= 30) pts = 10;
  out.push(comp('sg_app', 'Strokes gained: approach (field rank)', pts,
    `season-to-date average ranks ${rank ?? 'n/a'} of ${ctx.sgCoverage} sourced players in this field (season average stands in for the last-eight-events window)`, { max: 25 }));
  if (sg.t2g) {
    const t2g = ctx.sgT2gInField?.get(p.athleteId) ?? null;
    if (t2g !== null && t2g <= 20) out.push(comp('sg_t2g', 'Top twenty tee-to-green in field', 5, `ranks ${t2g} in field`, { max: 5 }));
  } else {
    missing.push(`${p.name}: strokes gained tee-to-green (not sourced)`);
  }
  if (sg.putt) {
    if (Number(sg.putt.avg) > 0) out.push(comp('sg_putt_pos', 'Positive putting trend', 3, 'season strokes gained putting is positive (season stands in for the last-three-events window)', { max: 3 }));
  } else {
    missing.push(`${p.name}: strokes gained putting (not sourced)`);
  }
  return out;
}

function scoreCourseHistory(p, ctx, missing) {
  const e = p.event || {};
  const out = [];
  if (ctx.priorEditionsInTape === 0) {
    missing.push(`${p.name}: course history (no prior edition of this tournament in the sourced tape)`);
    out.push(comp('course_hist', 'Course history (last three appearances)', 0, 'no prior edition in tape', { max: 20, missing: true }));
    return out;
  }
  let pts = 0; let detail;
  if (!e.appearances) { pts = 0; detail = 'no prior appearance at this tournament in the tape'; }
  else if (e.top5Last3) { pts = 20; detail = 'top-five finish in the last three appearances'; }
  else if (e.top10Last3) { pts = 13; detail = 'top-ten finish in the last three appearances'; }
  else if (e.madeCutNoTop20Last3) { pts = 6; detail = 'made the cut without a top-twenty in the last three appearances'; }
  else if (e.mcLast3) { pts = 0; detail = 'missed cut in the last three appearances'; }
  else { pts = 6; detail = 'made the cut in prior appearances (top-twenty but no top-ten: prompt assigns no tier; scored as made-cut)'; }
  out.push(comp('course_hist', 'Course history (last three appearances)', pts, detail, { max: 20 }));
  const c = p.course || {};
  if (c.bestClass && c.class) {
    if (c.bestClass === c.class) out.push(comp('course_type', 'Course type matches best record', 5, `best results come on ${c.class}-yardage courses (yardage class stands in for unsourced grass/links type)`, { max: 5 }));
  } else {
    missing.push(`${p.name}: best course type (fewer than three starts in any yardage class; grass type not sourced)`);
  }
  return out;
}

function scoreCourseFit(p, missing) {
  const c = p.course || {};
  const rec = c.record || {};
  const out = [];
  if (!c.class) {
    missing.push(`${p.name}: course fit (course yardage not published for this event)`);
    out.push(comp('course_fit', 'Course fit', 0, 'course yardage unknown', { max: 20, missing: true }));
    return out;
  }
  if (!rec.starts || rec.starts < 3) {
    missing.push(`${p.name}: course fit (${rec.starts || 0} starts on ${c.class}-yardage courses in the last two years; three needed)`);
    out.push(comp('course_fit', 'Course fit', 0, `thin sample on ${c.class} courses`, { max: 20, missing: true }));
    return out;
  }
  let pts; let detail;
  if (rec.top10Rate >= 0.30 || rec.avgFinishPct <= 0.25) { pts = 20; detail = `strong: top-ten rate ${pct(rec.top10Rate)} on ${c.class} courses`; }
  else if (rec.top10Rate >= 0.15 || rec.avgFinishPct <= 0.45) { pts = 12; detail = `moderate: top-ten rate ${pct(rec.top10Rate)} on ${c.class} courses`; }
  else { pts = 3; detail = `weak: top-ten rate ${pct(rec.top10Rate)} on ${c.class} courses`; }
  out.push(comp('course_fit', 'Course fit (record on same-yardage-class courses, two years)', pts, detail, { max: 20 }));
  if (c.longCourse) {
    if (c.shortHitter === true) out.push(comp('course_fit_pen', 'Course punishes primary weakness', -8, 'long course and driving distance in the bottom quartile of the tour', { max: 0 }));
    else if (c.shortHitter === null) missing.push(`${p.name}: driving distance (not sourced for this tour; weakness penalty unassessed)`);
  }
  return out;
}

function scoreRanking(p, missing) {
  const out = [];
  const r = p.owgr || null;
  if (!r || !r.rank) {
    missing.push(`${p.name}: OWGR rank (no ranking row matched)`);
    out.push(comp('owgr', 'World ranking', 0, 'no OWGR match', { max: 10, missing: true }));
  } else {
    const pts = r.rank <= 10 ? 10 : r.rank <= 20 ? 7 : r.rank <= 50 ? 4 : 1;
    out.push(comp('owgr', 'World ranking', pts, `OWGR ${r.rank}${r.trajectory ? ` (${r.trajectory > 0 ? 'up' : 'down'} ${Math.abs(r.trajectory)} this week)` : ''}`, { max: 10 }));
  }
  const f = p.form || {};
  if (f.elevatedWin12m) out.push(comp('owgr_elev', 'Major or elevated win in twelve months', 5, 'win at a major or signature event inside twelve months', { max: 5 }));
  if (f.careerWinsInWindow >= 2) out.push(comp('owgr_wins', 'Multiple wins', 3, `${f.careerWinsInWindow} wins in the sourced tape (tape window, not full career)`, { max: 3 }));
  return out;
}

function pct(v) {
  return v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`;
}

/** Outright base: five categories + bonuses. */
export function scoreOutrightBase(p, ctx) {
  const missing = [];
  const components = [
    ...scoreForm(p, missing),
    ...scoreStrokesGained(p, ctx, missing),
    ...scoreCourseHistory(p, ctx, missing),
    ...scoreCourseFit(p, missing),
    ...scoreRanking(p, missing),
  ];
  const cat = (id) => components.find((c) => c.id === id)?.points ?? 0;
  return {
    components,
    score: sum(components),
    missing,
    categories: { form: cat('form'), sg: cat('sg_app'), courseHistory: cat('course_hist'), courseFit: cat('course_fit'), ranking: cat('owgr') },
    coreMissing: components.some((c) => c.missing && ['form', 'sg_app', 'course_hist', 'course_fit', 'owgr'].includes(c.id)),
  };
}

/* ------------------------------------------------------------------ *
 * TOP 6 modifiers
 * ------------------------------------------------------------------ */

export function scoreTop6Mods(p, missing) {
  const out = [];
  const f = p.form || {};
  const e = p.event || {};
  if (f.top10Rate12m === null || f.top10Rate12m === undefined) {
    missing.push(`${p.name}: twelve-month top-ten rate (fewer than five starts in twelve months)`);
    out.push(comp('t6_rate', 'Twelve-month top-ten rate', 0, 'insufficient starts', { max: 15, missing: true }));
  } else if (f.top10Rate12m > 0.35) out.push(comp('t6_rate', 'Twelve-month top-ten rate', 15, `${pct(f.top10Rate12m)} of ${f.starts12m} starts`, { max: 15 }));
  else if (f.top10Rate12m >= 0.25) out.push(comp('t6_rate', 'Twelve-month top-ten rate', 8, `${pct(f.top10Rate12m)} of ${f.starts12m} starts`, { max: 15 }));
  else if (f.top10Rate12m < 0.20) out.push(comp('t6_rate', 'Twelve-month top-ten rate', -5, `${pct(f.top10Rate12m)} of ${f.starts12m} starts`, { max: 15 }));
  else out.push(comp('t6_rate', 'Twelve-month top-ten rate', 0, `${pct(f.top10Rate12m)} of ${f.starts12m} starts (between tiers)`, { max: 15 }));

  if (e.top15In2of3) out.push(comp('t6_event', 'Top fifteen in two of last three at this event', 10, 'measured from the tape', { max: 10 }));
  if (e.mcMostRecent === true) out.push(comp('t6_mc', 'Missed cut in most recent appearance here', -12, 'measured from the tape', { max: 0 }));

  if (p.sg?.t2g) {
    if (Number(p.sg.t2g.avg) > 0) out.push(comp('t6_t2g', 'Positive tee-to-green', 10, 'season strokes gained tee-to-green is positive (season stands in for four-of-last-five window)', { max: 10 }));
  } else {
    missing.push(`${p.name}: strokes gained tee-to-green trend (not sourced)`);
  }
  if (f.noMcLast2) out.push(comp('t6_b2b', 'Back-to-back events without a missed cut', 5, 'last two starts both made the cut', { max: 5 }));
  const r = p.owgr?.rank ?? null;
  if (r !== null) {
    if (r <= 15) out.push(comp('t6_owgr', 'OWGR top fifteen', 8, `OWGR ${r}`, { max: 8 }));
    else if (r <= 30) out.push(comp('t6_owgr', 'OWGR top thirty', 4, `OWGR ${r}`, { max: 8 }));
    else if (r > 50) out.push(comp('t6_owgr', 'OWGR outside fifty', -3, `OWGR ${r}`, { max: 8 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * FIRST ROUND LEADER (100)
 * ------------------------------------------------------------------ */

export function scoreFrl(p, ctx) {
  const missing = [];
  const out = [];
  const r1 = p.r1 || {};
  if (r1.avgR1ToPar === null || r1.avgR1ToPar === undefined) {
    missing.push(`${p.name}: opening-round scoring (fewer than four sourced opening rounds)`);
    out.push(comp('frl_r1', 'Opening-round scoring rank in field', 0, 'thin opening-round sample', { max: 35, missing: true }));
  } else {
    const rank = ctx.r1InField?.get(p.athleteId) ?? null;
    const pts = rank !== null && rank <= 10 ? 35 : rank !== null && rank <= 20 ? 24 : rank !== null && rank <= 40 ? 14 : 0;
    out.push(comp('frl_r1', 'Opening-round scoring rank in field', pts, `average opening round ${fmtToPar(r1.avgR1ToPar)} ranks ${rank ?? 'n/a'} of ${ctx.r1Sample} in field (last eight starts)`, { max: 35 }));
  }

  const tee = p.teeTime ? Date.parse(p.teeTime) : NaN;
  const early = Number.isFinite(tee) && ctx.medianTee ? tee < ctx.medianTee : null;
  const trend = ctx.weather?.r1?.trend ?? null;
  let teeWeatherEdge = false;
  if (early === null) {
    missing.push(`${p.name}: round-one tee time (not yet published)`);
    out.push(comp('frl_tee', 'Tee time and weather window', 0, 'tee time unknown', { max: 25, missing: true }));
  } else if (!trend) {
    missing.push(`${p.name}: round-one weather trend (forecast not collected for this event)`);
    out.push(comp('frl_tee', 'Tee time and weather window', 0, `${early ? 'early' : 'late'} tee; weather trend unknown`, { max: 25, missing: true }));
  } else {
    let pts = 0; let detail;
    if (early && trend === 'deteriorating') { pts = 25; teeWeatherEdge = true; detail = 'early tee with deteriorating conditions'; }
    else if (early) { pts = 12; detail = `early tee, ${trend} conditions`; }
    else if (trend === 'improving') { pts = 8; detail = 'late tee with improving conditions'; }
    else { pts = 0; detail = `late tee, ${trend} conditions`; }
    out.push(comp('frl_tee', 'Tee time and weather window', pts, detail, { max: 25 }));
  }

  if (p.sg?.putt) {
    const rank = ctx.sgPuttInField?.get(p.athleteId) ?? null;
    const neg = Number(p.sg.putt.avg) < 0;
    const pts = neg ? 0 : rank !== null && rank <= 10 ? 20 : rank !== null && rank <= 25 ? 13 : rank !== null && rank <= 50 ? 6 : 0;
    out.push(comp('frl_putt', 'Putting form (field rank)', pts, neg ? 'negative season putting' : `season putting ranks ${rank ?? 'n/a'} in field (season stands in for last-four window)`, { max: 20 }));
  } else {
    missing.push(`${p.name}: strokes gained putting (not sourced)`);
    out.push(comp('frl_putt', 'Putting form (field rank)', 0, 'not sourced', { max: 20, missing: true }));
  }

  if (r1.fastStartSample >= 3 && r1.fastStarts >= 2) {
    out.push(comp('frl_fast', 'Fast-start profile', 20, `${r1.fastStarts} of last ${r1.fastStartSample} opening rounds at sixty-seven or better`, { max: 20 }));
  } else if (ctx.layoutEarlyScoring === true) {
    out.push(comp('frl_fast', 'Fast-start profile', 15, 'layout produced low opening-round scoring at the last edition', { max: 20 }));
  } else if (ctx.layoutEarlyScoring === null && r1.fastStartSample < 3) {
    missing.push(`${p.name}: fast-start evidence (thin opening-round sample and no prior edition scoring)`);
    out.push(comp('frl_fast', 'Fast-start profile', 0, 'insufficient evidence', { max: 20, missing: true }));
  } else {
    out.push(comp('frl_fast', 'Fast-start profile', 0, 'slow starter on the sourced rounds', { max: 20 }));
  }

  return { components: out, score: sum(out), missing, teeWeatherEdge, coreMissing: out.some((c) => c.missing) };
}

function fmtToPar(v) {
  if (v === null || v === undefined) return 'n/a';
  const r = Math.round(v * 10) / 10;
  return r > 0 ? `+${r}` : r === 0 ? 'E' : `${r}`;
}

/* ------------------------------------------------------------------ *
 * Regional modifiers
 * ------------------------------------------------------------------ */

export function scoreEuropeanMods(p, ctx, missing) {
  const out = [];
  const rank = ctx.europeanRank?.get(p.athleteId) ?? null;
  if (rank !== null && rank <= 3) out.push(comp('eu_top3', 'Top three European in field by OWGR', 10, `ranks ${rank} of ${ctx.regionCounts?.european} Europeans`, { max: 10 }));
  else if (rank === null) missing.push(`${p.name}: OWGR rank among Europeans (no ranking match)`);
  const f = p.form || {};
  if (f.tourWinIn?.('eur', 42) || f.tourTop3In?.('eur', 42)) out.push(comp('eu_dpwt', 'DP World Tour win or top three in six weeks', 8, 'measured from the tape', { max: 8 }));
  missing.push(`${p.name}: links record (no free source classifies links courses; bonus unassessed)`);
  if (f.mcLast2Consecutive) out.push(comp('eu_mc', 'Missed cut in last two consecutive starts', -10, 'measured from the tape', { max: 0 }));
  return out;
}

export function scoreAmericanMods(p, ctx, missing) {
  const out = [];
  const rank = ctx.americanRank?.get(p.athleteId) ?? null;
  if (rank !== null && rank <= 3) out.push(comp('us_top3', 'Top three American in field by OWGR', 10, `ranks ${rank} of ${ctx.regionCounts?.american} Americans`, { max: 10 }));
  else if (rank === null) missing.push(`${p.name}: OWGR rank among Americans (no ranking match)`);
  const f = p.form || {};
  if (f.tourWinIn?.('pga', 90)) out.push(comp('us_pga', 'PGA TOUR win in three months', 8, 'measured from the tape', { max: 8 }));
  const c = p.course || {};
  if (c.longCourse) {
    if (c.longHitter === true) out.push(comp('us_power', 'Power course suits a long hitter', 6, 'long course and driving distance in the top quartile', { max: 6 }));
    else if (c.longHitter === null) missing.push(`${p.name}: driving distance (not sourced; power-course bonus unassessed)`);
  }
  if (f.majorsWonLast2y >= 2) out.push(comp('us_majors', 'Multiple majors in two years', 5, `${f.majorsWonLast2y} major wins`, { max: 5 }));
  if (p.sg?.app) {
    if (Number(p.sg.app.avg) < 0) out.push(comp('us_app_neg', 'Negative approach play', -10, 'season strokes gained approach is negative (season stands in for three-of-last-five window)', { max: 0 }));
  } else {
    missing.push(`${p.name}: strokes gained approach trend (not sourced)`);
  }
  return out;
}

export function scoreBritishIrishMods(p, ctx, missing) {
  const out = [];
  missing.push(`${p.name}: links or coastal classification of this event (not sourced; bonus unassessed)`);
  const rank = ctx.britishIrishRank?.get(p.athleteId) ?? null;
  if (rank !== null && rank <= 2) out.push(comp('bi_top2', 'Top two British or Irish player in field', 10, `ranks ${rank} of ${ctx.regionCounts?.britishIrish}`, { max: 10 }));
  else if (rank === null) missing.push(`${p.name}: OWGR rank among British and Irish players (no ranking match)`);
  const f = p.form || {};
  if (f.tourWinIn?.('eur', 120)) out.push(comp('bi_dpwt', 'DP World Tour win in four months', 8, 'measured from the tape', { max: 8 }));
  if (p.event?.madeCutEachLast3) out.push(comp('bi_cuts', 'Made the cut in each of the last three here', 6, 'measured from the tape', { max: 6 }));
  if (f.competedLast3Weeks === false && f.starts) out.push(comp('bi_rust', 'Has not competed in the last three weeks', -8, `last start ${f.lastStartDaysAgo} days ago`, { max: 0 }));
  if (f.mcLast2Consecutive) out.push(comp('bi_mc', 'Missed cut in last two starts', -10, 'measured from the tape', { max: 0 }));
  return out;
}

/* ------------------------------------------------------------------ *
 * bands
 * ------------------------------------------------------------------ */

export function bandOutright(score, coreMissing) {
  if (score >= RULES.outright.high) return coreMissing ? CONFIDENCE.MEDIUM : CONFIDENCE.HIGH;
  if (score >= RULES.outright.medium) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

export function bandTop6(score, coreMissing) {
  if (score >= RULES.top6.high) return coreMissing ? CONFIDENCE.MEDIUM : CONFIDENCE.HIGH;
  if (score >= RULES.top6.medium) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.SKIP;
}

export function bandFrl(score, teeWeatherEdge, coreMissing) {
  if (score >= RULES.frl.high && teeWeatherEdge && !coreMissing) return CONFIDENCE.HIGH;
  if (score >= RULES.frl.medium) return CONFIDENCE.MEDIUM;
  if (score >= RULES.frl.low) return CONFIDENCE.LOW;
  return CONFIDENCE.SKIP;
}

export function bandRegional(score, coreMissing, { coSelected = false } = {}) {
  if (coSelected) return score >= RULES.regional.medium ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW;
  if (score >= RULES.regional.high) return coreMissing ? CONFIDENCE.MEDIUM : CONFIDENCE.HIGH;
  if (score >= RULES.regional.medium) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

/* ------------------------------------------------------------------ *
 * event scoring
 * ------------------------------------------------------------------ */

function publicProfile(p) {
  return {
    athleteId: p.athleteId,
    name: p.name,
    country: p.country,
    amateur: p.amateur,
    owgr: p.owgr?.rank ?? null,
    last5: p.form?.last5 || [],
    starts: p.form?.starts ?? 0,
    top10Rate12m: p.form?.top10Rate12m ?? null,
    eventLast4: p.event?.last4 || [],
    avgR1ToPar: p.r1?.avgR1ToPar ?? null,
    courseClass: p.course?.class ?? null,
    courseRecord: p.course?.record ?? null,
    sg: p.sg ? Object.fromEntries(Object.entries(p.sg).map(([k, v]) => [k, v ? { rank: v.rank, avg: v.avg } : null])) : null,
    teeTime: p.teeTime ?? null,
    region: p.region,
    sources: p.sources,
  };
}

function candidate(p, ctx, score, components, missing, band, extra = {}) {
  return {
    athleteId: p.athleteId,
    name: p.name,
    country: p.country,
    score: Math.round(score * 10) / 10,
    band,
    components,
    missing,
    fieldRank: ctx.owgrInField?.get(p.athleteId) ?? null,
    profile: publicProfile(p),
    ...extra,
  };
}

function isValuePick(base, fieldRank) {
  const v = RULES.value;
  return fieldRank !== null && fieldRank >= v.fieldRankMin && fieldRank <= v.fieldRankMax
    && base.categories.courseFit >= v.fitMin && base.categories.form >= v.formMin;
}

/**
 * Score one tournament.
 * @param {object} event     {id, name, tour, startDate, course, tournamentId}
 * @param {object[]} profiles buildGolfProfile() output for the field
 * @param {object} ctx       buildFieldContext() output
 */
export function scoreGolfEvent(event, profiles, ctx) {
  const list = (profiles || []).filter((p) => p && p.athleteId && !p.amateur);
  const flags = [];
  if (!list.length) {
    return { unscored: true, flags: ['UNSCORED: no field published yet'], missing: ['field (entry list not yet published by the source)'], markets: {} };
  }
  if ((profiles || []).some((p) => p?.amateur)) flags.push('amateurs excluded from all markets');

  const eventMissing = [];
  if (ctx.sgSuppressed) {
    eventMissing.push(`strokes gained (only ${ctx.sgSuppressed.matched} of ${ctx.sgSuppressed.scored} players in this field have a strokes-gained row, below the ${Math.round(ctx.sgSuppressed.floor * 100)}% coverage floor, so it is scored as missing for every player to keep the field on a level footing)`);
    flags.push(`strokes gained suppressed: ${ctx.sgSuppressed.matched} of ${ctx.sgSuppressed.scored} players covered (floor ${Math.round(ctx.sgSuppressed.floor * 100)}%); no player can read HIGH`);
  } else if (!ctx.sgCoverage) {
    eventMissing.push('strokes gained (no free per-player strokes-gained source for this event; approach, tee-to-green and putting categories score zero and are marked missing)');
  }
  if (!ctx.weather?.r1?.trend) eventMissing.push('round-one weather trend (forecast not collected or event more than a week away)');
  if (ctx.priorEditionsInTape === 0) eventMissing.push('course history (no prior edition of this tournament in the sourced tape)');
  eventMissing.push('odds (no free key-less bookmaker odds source; OWGR rank within the field stands in for market favouritism in the value rules)');

  const scored = list.map((p) => {
    const base = scoreOutrightBase(p, ctx);
    const fieldRank = ctx.owgrInField?.get(p.athleteId) ?? null;
    return { p, base, fieldRank, value: isValuePick(base, fieldRank) };
  });

  /* ---- OUTRIGHT ---- */
  const outrightCands = scored.map((s) => candidate(s.p, ctx, s.base.score, s.base.components, s.base.missing,
    bandOutright(s.base.score, s.base.coreMissing), { valuePick: s.value, coreMissing: s.base.coreMissing, categories: s.base.categories }))
    .sort((a, b) => b.score - a.score || (a.fieldRank ?? 999) - (b.fieldRank ?? 999));
  const top = outrightCands.find(hasEvidence) || null;
  const outrightSel = top ? [top] : [];
  if (!top && outrightCands.length) flags.push('outright: no player has any sourced evidence (no results tape, ranking or statistics matched), so the market is written as NO SELECTION rather than naming an arbitrary player');
  const valueCands = outrightCands.filter((c) => c.valuePick && hasEvidence(c) && c.athleteId !== top?.athleteId);
  const outsideTop5 = outrightCands.filter((c) => hasEvidence(c) && c.fieldRank !== null && c.fieldRank > RULES.value.favouriteCut && c.athleteId !== top?.athleteId);
  let valuePickApplied = null;
  if (top && (top.fieldRank === null || top.fieldRank <= RULES.value.favouriteCut || !top.valuePick)) {
    const v = valueCands[0] || null;
    if (v) { outrightSel.push({ ...v, valuePick: true }); valuePickApplied = v.name; }
    else if (outsideTop5[0]) {
      // Prompt: always at least one value outright outside the top-five favourites.
      // The strict VALUE PICK label is withheld; the player keeps the band the score earns.
      outrightSel.push({ ...outsideTop5[0], valuePick: false, valueFallback: true });
      valuePickApplied = outsideTop5[0].name;
      flags.push('no player met the strict VALUE PICK test (field rank 15-40, fit >= 18, form >= 14); the best-scoring player outside the top-five favourites is listed as the outside-the-top-five outright instead, without the VALUE PICK label');
    }
  }
  const outrightMarket = {
    key: 'outright', label: MARKETS.outright, threshold: null,
    candidates: outrightCands.slice(0, 25), selections: outrightSel, valuePickApplied,
    missing: eventMissing, note: 'Outright is never SKIP: a score under sixty is written as a LOW value play.',
  };

  /* ---- TOP 6 ---- */
  const top6Cands = scored.map((s) => {
    const fm = [...s.base.missing];
    const mods = scoreTop6Mods(s.p, fm);
    const comps = [...s.base.components, ...mods];
    const score = sum(comps);
    const coreMissing = s.base.coreMissing || mods.some((c) => c.missing);
    return candidate(s.p, ctx, score, comps, fm, bandTop6(score, coreMissing), { coreMissing, baseScore: s.base.score });
  }).sort((a, b) => b.score - a.score || (a.fieldRank ?? 999) - (b.fieldRank ?? 999));
  let top6Sel = top6Cands.filter((c) => c.band !== CONFIDENCE.SKIP && hasEvidence(c)).slice(0, RULES.top6.max);
  const g = RULES.top6Guard;
  // Prompt: never let all six selections be favourites — at least one must be
  // ranked fifteenth or worse in the field (field rank by OWGR, IR-GOLF-10).
  if (top6Sel.length === RULES.top6.max && !top6Sel.some((c) => c.fieldRank !== null && c.fieldRank >= g.minFieldRank)) {
    const alt = top6Cands.find((c) => c.band !== CONFIDENCE.SKIP && hasEvidence(c) && c.fieldRank !== null && c.fieldRank >= g.minFieldRank && !top6Sel.includes(c));
    const allFav = top6Sel.every((c) => c.fieldRank !== null && c.fieldRank <= g.favouriteCut);
    if (alt) { top6Sel = [...top6Sel.slice(0, RULES.top6.max - 1), { ...alt, guardSwap: true }]; flags.push(`top-six guard: ${alt.name} (ranked ${alt.fieldRank} in the field) replaces the sixth name so the list carries a player ranked fifteenth or worse`); }
    else if (allFav) { top6Sel = top6Sel.slice(0, RULES.top6.max - 1); flags.push('top-six guard: every qualifying player is a top-six favourite and no player ranked fifteenth or worse clears the threshold; the sixth slot is left empty'); }
    else flags.push('top-six guard: no player ranked fifteenth or worse clears the threshold; the six selections stand because they are not all top-six favourites');
  }
  const top6Market = {
    key: 'top6', label: MARKETS.top6, threshold: RULES.top6.skip,
    candidates: top6Cands.slice(0, 25), selections: top6Sel, missing: eventMissing,
  };

  /* ---- FRL ---- */
  const frlCands = scored.map((s) => {
    const r = scoreFrl(s.p, ctx);
    return candidate(s.p, ctx, r.score, r.components, r.missing, bandFrl(r.score, r.teeWeatherEdge, r.coreMissing), { teeWeatherEdge: r.teeWeatherEdge, coreMissing: r.coreMissing });
  }).sort((a, b) => b.score - a.score || (a.fieldRank ?? 999) - (b.fieldRank ?? 999));
  const frlMarket = {
    key: 'frl', label: MARKETS.frl, threshold: RULES.frl.low, listThreshold: RULES.frl.list,
    candidates: frlCands.filter((c) => c.score >= RULES.frl.list).slice(0, 25),
    selections: frlCands.filter((c) => c.band !== CONFIDENCE.SKIP && c.score >= RULES.frl.low && (c.components || []).some((x) => !x.missing && x.points > 0)).slice(0, RULES.frl.max),
    missing: eventMissing,
    note: 'Listed from fifty points; written from fifty-five (Step 3); HIGH requires seventy-five plus an early-tee deteriorating-weather edge.',
  };

  /* ---- Regional ---- */
  const regional = (key, flag, modFn, rankMap) => {
    const eligible = scored.filter((s) => s.p.region?.[flag]);
    const cands = eligible.map((s) => {
      const fm = [...s.base.missing];
      const mods = modFn(s.p, ctx, fm);
      const comps = [...s.base.components, ...mods];
      const score = sum(comps);
      return candidate(s.p, ctx, score, comps, fm, null, { coreMissing: s.base.coreMissing, regionRank: rankMap?.get(s.p.athleteId) ?? null, baseScore: s.base.score });
    }).sort((a, b) => b.score - a.score || (a.regionRank ?? 999) - (b.regionRank ?? 999));
    const selections = [];
    let coSelected = false;
    const withEvidence = cands.filter(hasEvidence);
    if (cands.length && !withEvidence.length) flags.push(`${MARKETS[key]}: eligible players exist but none has sourced evidence, so the market is written as NO SELECTION`);
    if (withEvidence.length) {
      const a = withEvidence[0]; const b = withEvidence[1] || null;
      coSelected = Boolean(b) && (a.score - b.score) <= RULES.regional.coSelectGap;
      a.band = bandRegional(a.score, a.coreMissing, { coSelected });
      selections.push(a);
      if (coSelected) { b.band = bandRegional(b.score, b.coreMissing, { coSelected: true }); selections.push({ ...b, coSelection: true }); }
      for (const c of cands) if (c.band === null) c.band = bandRegional(c.score, c.coreMissing);
    }
    for (const c of cands) if (c.band === null) c.band = bandRegional(c.score, c.coreMissing);
    return {
      key, label: MARKETS[key], threshold: RULES.regional.medium,
      eligible: eligible.length, candidates: cands.slice(0, 15), selections, coSelected,
      missing: eligible.length ? eventMissing : [`${MARKETS[key]}: no eligible player in the field`],
      note: eligible.length ? null : 'No eligible player in the published field, so this market is written as NO SELECTION.',
    };
  };
  const euMarket = regional('top_european', 'european', scoreEuropeanMods, ctx.europeanRank);
  const usMarket = regional('top_american', 'american', scoreAmericanMods, ctx.americanRank);
  const biMarket = regional('top_british_irish', 'britishIrish', scoreBritishIrishMods, ctx.britishIrishRank);

  // Same player heading several markets is allowed but flagged (prompt Step 3).
  const heads = new Map();
  for (const m of [outrightMarket, top6Market, frlMarket, euMarket, usMarket, biMarket]) {
    const h = m.selections?.[0];
    if (h) heads.set(h.athleteId, [...(heads.get(h.athleteId) || []), m.label]);
  }
  for (const [, labels] of heads) if (labels.length > 1) flags.push(`same player heads ${labels.join(' and ')} — each market is written separately as the prompt requires`);

  return {
    unscored: false,
    flags,
    missing: eventMissing,
    fieldSize: list.length,
    markets: {
      outright: outrightMarket,
      top6: top6Market,
      frl: frlMarket,
      top_european: euMarket,
      top_american: usMarket,
      top_british_irish: biMarket,
    },
  };
}
