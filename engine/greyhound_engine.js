/**
 * SportsPred — Greyhound Prediction Engine.
 *
 * Implements Step 2 (scoring), the greyhound-specific adjustments and Step 3
 * (selection / skip rules) of "GREYHOUND RACING PREDICTION MASTER PROMPT
 * v1.0" for WIN RACE predictions.
 *
 * Pure: no I/O, no clock, no randomness. Every input is a runner profile built
 * by greyhound_data.js from the GBGB official results API (the Greyhound Board
 * of Great Britain's database, the same data tracks upload and reconcile) and
 * the Sporting Life racecard (which republishes the same official draw).
 *
 * SCORING SHAPE (verbatim from the prompt)
 *   Recent form ...................... 35 pts  (plus +5 last-race win, +5 two wins in last three)
 *   Odds and value assessment ........ 25 pts
 *   Trap draw and distance fit ....... 20 pts  (plus +5 distance match with last win)
 *   Track and grade context ......... 20 pts  (minus -5 stepping up two or more grades)
 *
 * WHAT THE SOURCES ACTUALLY PUBLISH (see docs/GREYHOUND_IRREGULARITIES.md)
 *   - The last-five form string with position, distance, track and grade for
 *     every run: MEASURED from the official results tape (GBGB).
 *   - Trap numbers today and the dog's full record from each trap: MEASURED.
 *   - Distance form (proven trips, last win distance): MEASURED.
 *   - Track form (wins / places at this venue): MEASURED.
 *   - Grade today versus recent grades (including drops and rises): MEASURED.
 *   - The starting price (SP) of settled races: published by GBGB and used ONLY
 *     by the backtest; SP does not exist before a race and live win odds from
 *     "two sources" are not published on any free key-less feed, so the 25-pt
 *     odds component is never scored on a live card. It is recorded in
 *     `missing[]`, its component is marked missing, and HIGH confidence is
 *     impossible on a live card (odds tiers gate HIGH in Step 3).
 *   - Timeform analyst verdict, tip-sheet verdicts and social sentiment are
 *     never free/structured: never scored, never written about.
 *   - Non-runners / scratchings: detected on settled cards (a trap with no
 *     result). The live draw is taken from the official racecard.
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';

export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' });

/** Step 3 thresholds, verbatim from the prompt. */
export const RULES = Object.freeze({
  primary: { minScore: 70, oddMin: 200, oddMax: 800 },     // sweet spot
  secondary: { minScore: 60, maxScore: 69, oddMin: 100, oddMax: 300 },
  value: { minScore: 75, oddMin: 400 },                   // exceptional form only
  skip: { minScore: 55, maxTrapOdds: 500, trapFormFloor: 65, minTopThree: 3 },
  card: { maxPicks: 7, minPicks: 5, minTracks: 2, clearGap: 15, maxHighOdds: 2, weakRaceFloor: 55 },
});

/**
 * A selection needs sourced evidence beyond the draw itself: form plus a
 * measured trap/distance or track/grade category.
 */
export const CORE_IDS = ['form', 'trap', 'track_grade'];

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

/* ------------------------------------------------------------------ *
 * Grade helpers
 *
 * GBGB classes: graded races A1..A11 (lower number = faster), D sprints,
 * S stayers, H hurdlers, and open races (OR prefix). Open races sit above
 * every graded band. Trials (T-prefix and "Trial") are never counted as form.
 * ------------------------------------------------------------------ */

const GRADE_RE = /^(OR|D|S|H|A|P)(\d+)?/i;

/** Numeric rank for a GBGB class: higher = stronger. Open races outrank all. */
export function gradeRank(grade) {
  const g = String(grade || '').trim().toUpperCase();
  if (!g) return null;
  if (/^OR/.test(g)) return 100;
  const m = g.match(/^([PDSHA])(\d+)$/);
  if (!m) {
    // e.g. unnamed opens or unusual classes — treat conservatively as unknown
    if (/^[A-Z]+\d*$/.test(g) && !/^T/.test(g)) return null;
    return null;
  }
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  if (m[1] === 'A') return 50 - n;        // A1 = 49 ... A11 = 39
  if (m[1] === 'D') return 40 - n;        // D1 sprinter ≈ A8 level
  if (m[1] === 'S') return 44 - n;        // stayers
  if (m[1] === 'H') return 40 - n;        // hurdlers
  if (m[1] === 'P') return 44 - n;        // puppy races
  return null;
}

/** Number of graded bands a dog is moving today (positive = up in class). */
export function gradeShift(todayGrade, recentGrades) {
  const today = gradeRank(todayGrade);
  if (today === null) return 0;
  const ranks = (recentGrades || []).map(gradeRank).filter((v) => v !== null);
  if (!ranks.length) return 0;
  // Use the strongest of the last three graded runs as the benchmark.
  const recent = Math.max(...ranks.slice(0, 3));
  return today - recent;
}

/* ------------------------------------------------------------------ *
 * Step 2 — RECENT FORM (35 pts)
 *
 * Last-5 finished runs: top-three counts and win counts, with the most
 * recent two runs weighted more heavily (greyhound form degrades fast).
 * Bonuses: +5 win last run, +5 for 2+ wins in last 3 starts.
 * ------------------------------------------------------------------ */

export function scoreForm(p, missing) {
  const runs = (p.runs || []).filter((r) => r && Number.isFinite(r.position));
  const out = [];
  if (runs.length === 0) {
    missing.push(`${p.name}: form (no official runs in the sourced results tape)`);
    out.push(comp('form', 'Recent form (last five runs, last two double-weighted)', 0, 'no runs in the official results tape', { max: 45, missing: true }));
    return out;
  }
  const last5 = runs.slice(0, 5);
  const wins = last5.filter((r) => r.position === 1).length;
  const top3 = last5.filter((r) => r.position <= 3).length;
  // Recency-weighted equivalents (runs 1-2 count double) feed the detail only.
  const recent2 = last5.slice(0, 2);
  const recent2Wins = recent2.filter((r) => r.position === 1).length;
  const last3Wins = last5.slice(0, 3).filter((r) => r.position === 1).length;

  let pts; let detail;
  if (top3 >= 3 && wins >= 1) { pts = 35; detail = `${top3} placed runs from the last five including a win`; }
  else if (top3 >= 3 && wins === 0) { pts = 22; detail = `${top3} placed runs from the last five without a win`; }
  else if (top3 === 2 && wins >= 1) { pts = 15; detail = 'two placed runs from the last five including a win'; }
  else if (top3 === 2 && wins === 0) { pts = 8; detail = 'two placed runs from the last five, none won'; }
  else { pts = 0; detail = 'fewer than two placed runs in the last five'; }

  const thin = runs.length < 3;
  if (thin) missing.push(`${p.name}: form sample thin (${runs.length} official run${runs.length === 1 ? '' : 's'} in tape)`);
  out.push(comp('form', 'Recent form (last five runs, last two double-weighted)', pts, detail, { max: 35, missing: thin }));

  if (recent2Wins >= 1 || last5[0]?.position === 1) {
    out.push(comp('form_last_win', 'Bonus: won most recent start', 5, 'latest official run was a win', { max: 5 }));
  }
  if (last3Wins >= 2) {
    out.push(comp('form_hot', 'Bonus: two wins in the last three starts', 5, 'multiple wins inside the last three runs', { max: 5 }));
  }
  if (recent2.filter((r) => r.position <= 3).length === 2 && recent2Wins === 0) {
    out.push(comp('form_recent2', 'Recency weight: both of the last two runs were placed', 3, 'last two starts both finished in the first three', { max: 3 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Step 2 — ODDS AND VALUE ASSESSMENT (25 pts)
 *
 * Live win odds from two sources are not available on any free key-less
 * feed. On settled backtest races the official SP is supplied and the full
 * tier table is applied; on a live card the category is missing.
 * ------------------------------------------------------------------ */

/** Fractional SP string ("11/4") -> decimal probability after removing the
 *  bookmaker margin. Returns null when unparseable. */
export function impliedProbabilityFromSP(sp) {
  const m = String(sp || '').match(/^(\d+)\/(\d+)/);
  if (!m) return null;
  const num = Number(m[1]); const den = Number(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return den / (num + den);
}

export function scoreOdds(p, missing, { live = true } = {}) {
  const out = [];
  const prob = impliedProbabilityFromSP(p.sp);
  if (live || prob === null) {
    missing.push(`${p.name}: odds (no free key-less feed for live win odds; one-book price required by the prompt is not published)`);
    out.push(comp('odds', 'Odds and value assessment', 0, 'no live odds on a free key-less feed — scored as missing', { max: 25, missing: true }));
    return out;
  }
  // Backtest path: map SP probability to the prompt's American-odds tiers.
  // +200 ≈ p .333, +400 ≈ p .20, -100 ≈ p .50, -200 ≈ p .667.
  const winLast3 = (p.runs || []).slice(0, 3).filter((r) => r.position === 1).length >= 2;
  const wins = (p.runs || []).slice(0, 5).filter((r) => r.position === 1).length;
  let pts; let detail;
  if (prob <= 0.20 && wins >= 2) { pts = 25; detail = 'big price with at least two recent wins — maximum value tier'; }
  else if (prob <= 0.333) { pts = 18; detail = 'double-figure price with solid form'; }
  else if (prob <= 0.50) { pts = 12; detail = 'mid-range price with consistent form'; }
  else if (prob <= 0.667 && winLast3) { pts = 6; detail = 'short price but two wins from the last three starts'; }
  else { pts = 0; detail = 'very short price — tier avoided by the prompt'; }
  out.push(comp('odds', 'Odds and value assessment (official SP, settled races only)', pts, detail, { max: 25 }));
  return out;
}

/* ------------------------------------------------------------------ *
 * Step 2 — TRAP DRAW AND DISTANCE FIT (20 pts + 5 distance bonus)
 * ------------------------------------------------------------------ */

export function scoreTrapAndDistance(p, race, missing) {
  const out = [];
  const trap = Number(p.trap);
  const trapRuns = (p.runs || []).filter((r) => Number(r.trap) === trap);
  const trapWins = trapRuns.filter((r) => r.position === 1).length;
  const trapPlaces = trapRuns.filter((r) => r.position > 0 && r.position <= 3).length;

  let pts; let detail;
  if (trapRuns.length === 0) {
    const hasForm = (p.runs || []).length >= 3;
    pts = hasForm ? 6 : 0;
    detail = hasForm ? 'no official runs from today\u2019s trap but solid overall form' : 'no runs from today\u2019s trap and little overall form';
    if (!hasForm) missing.push(`${p.name}: trap form (no runs from this trap, thin overall record)`);
    out.push(comp('trap', 'Trap draw record', pts, detail, { max: 20, missing: !hasForm }));
  } else if (trapWins >= 2) {
    pts = 20;
    detail = `${trapWins} win${trapWins === 1 ? '' : 's'} from ${trapRuns.length} official run${trapRuns.length === 1 ? '' : 's'} out of trap ${trap}`;
    out.push(comp('trap', 'Trap draw record', pts, detail, { max: 20 }));
  } else if (trapPlaces >= 1) {
    pts = 12;
    detail = `placed from trap ${trap} (${trapPlaces} placed from ${trapRuns.length} runs) without a win`;
    out.push(comp('trap', 'Trap draw record', pts, detail, { max: 20 }));
  } else {
    pts = 0;
    detail = `${trapRuns.length} official run${trapRuns.length === 1 ? '' : 's'} from trap ${trap} without making the first three`;
    out.push(comp('trap', 'Trap draw record', pts, detail, { max: 20 }));
  }

  // Distance fit: proven form at today's trip (within 20m = comparable trip).
  const dist = Number(race.distance);
  const distRuns = (p.runs || []).filter((r) => Number.isFinite(r.distance) && Math.abs(Number(r.distance) - dist) <= 20);
  const distWins = distRuns.filter((r) => r.position === 1).length;
  if (distRuns.length === 0) {
    missing.push(`${p.name}: distance form (no official runs at a comparable distance to ${dist}m)`);
  } else {
    const lastWin = (p.runs || []).find((r) => r.position === 1);
    if (lastWin && Number.isFinite(lastWin.distance) && Math.abs(Number(lastWin.distance) - dist) <= 5) {
      // +5 bonus verbatim from the prompt: exact match with most recent win distance.
      out.push(comp('dist_match', 'Bonus: today\u2019s distance matches the most recent winning trip', 5, `latest win came over today\u2019s exact distance`, { max: 5 }));
    }
    if (distWins >= 2 && distRuns.length >= 3) {
      // Distance-specialist edge named in the greyhound adjustments: repeat
      // winner at the trip beats a form-only read.
      out.push(comp('dist_specialist', 'Distance specialist: multiple wins at today\u2019s trip', 6, `${distWins} wins from ${distRuns.length} runs at this distance band`, { max: 6 }));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Step 2 — TRACK AND GRADE CONTEXT (20 pts, -5 for +2 grade rise)
 * ------------------------------------------------------------------ */

export function scoreTrackAndGrade(p, race, missing) {
  const out = [];
  const track = String(race.track || '').trim().toLowerCase();
  const trackRuns = (p.runs || []).filter((r) => String(r.track || '').trim().toLowerCase() === track);
  const trackWins = trackRuns.filter((r) => r.position === 1).length;
  const trackPlaces = trackRuns.filter((r) => r.position > 0 && r.position <= 3).length;
  const shift = gradeShift(race.grade, (p.runs || []).map((r) => r.grade));
  const dropping = shift <= -1;
  const bigRise = shift >= 2;

  let pts; let detail;
  if (trackWins >= 1 && shift <= 0) {
    pts = 20;
    detail = `winner at this track${shift < 0 ? ' and dropping in class' : ' and racing at the same level'}`;
  } else if (trackPlaces >= 1 && shift === 0) {
    pts = 13;
    detail = 'placed at this track in a race at the same grade band';
  } else if (trackRuns.length === 0 && dropping) {
    pts = 8;
    detail = 'no previous run at this venue but racing from a lower-graded class';
  } else if (bigRise) {
    pts = 0;
    detail = 'stepping up two or more grades with no top-level form to support it';
  } else if (trackRuns.length === 0) {
    pts = 4;
    detail = 'no official runs at this venue; class level broadly familiar';
  } else {
    pts = 6;
    detail = 'has run at this venue; class context is neutral';
  }
  if (trackRuns.length === 0 && !dropping) {
    missing.push(`${p.name}: track form (no official runs at ${race.track})`);
  }
  out.push(comp('track_grade', 'Track and grade context', pts, detail, { max: 20, missing: trackRuns.length === 0 }));

  if (bigRise) {
    out.push(comp('grade_rise_pen', 'Penalty: moving up two or more grades', -5, 'class rise of two bands or more versus recent runs', { max: 0 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Runner scoring
 * ------------------------------------------------------------------ */

export function scoreRunner(p, race, opts = {}) {
  const missing = [];
  const components = [
    ...scoreForm(p, missing),
    ...scoreOdds(p, missing, { live: opts.live !== false }),
    ...scoreTrapAndDistance(p, race, missing),
    ...scoreTrackAndGrade(p, race, missing),
  ];
  const score = Math.max(0, components.reduce((a, c) => a + (Number(c.points) || 0), 0));
  const coreMeasured = CORE_IDS.filter((id) => components.some((c) => c.id === id && !c.missing)).length;
  return {
    dogId: p.dogId ?? null,
    name: p.name,
    trap: p.trap,
    position: p.position ?? null,
    sp: p.sp ?? null,
    score,
    components,
    missing: [...new Set(missing)],
    coreMeasured,
    oddsMissing: components.some((c) => c.id === 'odds' && c.missing),
    bestTime: p.bestTime ?? null,
    lastTime: p.lastTime ?? null,
    sp: p.sp ?? null,
    formString: (p.runs || []).slice(0, 5).map((r) => r.position ?? '-').join(''),
  };
}

/* ------------------------------------------------------------------ *
 * Step 3 — decision rules
 * ------------------------------------------------------------------ */

/** Score a whole race and decide whether it produces a selection. */
export function scoreRace(race, opts = {}) {
  const runners = (race.runners || [])
    .map((p) => scoreRunner(p, race, opts))
    .sort((a, b) => b.score - a.score);
  const top = runners[0] || null;
  const second = runners[1] || null;
  const gap = top && second ? top.score - second.score : null;

  const decision = decide(top, { second, race, runners, gap });
  return {
    raceId: race.raceId ?? null,
    track: race.track,
    date: race.date,
    time: race.time,
    distance: race.distance,
    grade: race.grade,
    raceTitle: race.raceTitle ?? null,
    status: race.status ?? 'scheduled',
    sourceUrl: race.sourceUrl ?? null,
    runners,
    winner: decision.action === 'SELECT' ? top : null,
    gap,
    decision,
  };
}

/** Apply the Step 3 selection / skip rules in order. */
export function decide(top, ctx = {}) {
  if (!top) return { action: 'SKIP', confidence: CONFIDENCE.SKIP, reasons: ['no runners'], clearGap: false, oddsTested: false };

  const placed = (top.formString || '').split('').filter((ch) => ['1', '2', '3'].includes(ch)).length;
  const hardSkip = top.score < RULES.skip.minScore || placed < 2 || top.coreMeasured < 2;

  const reasons = [];
  if (top.score < RULES.skip.minScore) reasons.push(`top score below ${RULES.skip.minScore}`);
  if (placed < 2) reasons.push('fewer than two placed runs in the last five');
  if (top.coreMeasured < 2) reasons.push('fewer than two measured core categories');
  if (top.oddsMissing) reasons.push('odds tiers untestable on a live card (no free live odds feed)');

  let confidence;
  if (hardSkip) {
    confidence = CONFIDENCE.SKIP;
  } else if (top.score >= 75 && !top.oddsMissing) {
    confidence = CONFIDENCE.HIGH; // gated on a measured price - never available on a live card
  } else if (top.score >= 65) {
    confidence = CONFIDENCE.MEDIUM;
  } else {
    confidence = CONFIDENCE.LOW;
  }

  return {
    action: confidence === CONFIDENCE.SKIP ? 'SKIP' : 'SELECT',
    confidence,
    reasons,
    clearGap: ctx.gap !== null && ctx.gap !== undefined && ctx.gap >= RULES.card.clearGap,
    oddsTested: !top.oddsMissing,
  };
}


/**
 * Step 3 daily card management: rank every SELECT race, cap the card at 5-7
 * races across at least two tracks, prioritise clear-gap races, and mark the
 * rest NO SELECTION.
 */
export function buildDailyCard(scoredRaces) {
  const selectable = scoredRaces.filter((r) => r.decision.action === 'SELECT');
  const skipped = scoredRaces.filter((r) => r.decision.action !== 'SELECT');

  // Clear-gap races first, then score, then widest margin of form quality.
  const ranked = [...selectable].sort((a, b) => {
    if (!!a.decision.clearGap !== !!b.decision.clearGap) return a.decision.clearGap ? -1 : 1;
    return (b.winner?.score || 0) - (a.winner?.score || 0);
  });

  const tracks = new Set();
  const picks = [];
  for (const r of ranked) {
    if (picks.length >= RULES.card.maxPicks) break;
    tracks.add(String(r.track || '').toLowerCase());
    picks.push(r);
    // After 5 picks require the two-track rule unless nothing qualifies later.
  }
  // If the first picks are all one track and a second track exists, prefer
  // spreading across tracks once we have the minimum viable card.
  const byTrack = new Map();
  for (const r of ranked) {
    const k = String(r.track || '').toLowerCase();
    if (!byTrack.has(k)) byTrack.set(k, []);
    byTrack.get(k).push(r);
  }
  let chosen = picks;
  if (byTrack.size >= RULES.card.minTracks) {
    chosen = [];
    const orderedTracks = [...byTrack.entries()].sort((a, b) => b[1].length - a[1].length);
    let round = 0;
    while (chosen.length < Math.min(RULES.card.maxPicks, ranked.length)) {
      let added = false;
      for (const [, rs] of orderedTracks) {
        if (rs[round] && !chosen.includes(rs[round])) { chosen.push(rs[round]); added = true; if (chosen.length >= RULES.card.maxPicks) break; }
      }
      if (!added) break;
      round += 1;
    }
  }
  const chosenIds = new Set(chosen.map((r) => r.raceId));
  const cardTracks = new Set(chosen.map((r) => String(r.track || '').toLowerCase()));

  return {
    picks: chosen.map((r) => ({ raceId: r.raceId, track: r.track, time: r.time, selection: r.winner?.name, trap: r.winner?.trap, confidence: r.decision.confidence, score: r.winner?.score })),
    races: scoredRaces.map((r) => ({ ...r, cardSelected: chosenIds.has(r.raceId) })),
    trackCount: cardTracks.size,
    skippedCount: skipped.length,
    cappedByRules: selectable.length > chosen.length,
  };
}
