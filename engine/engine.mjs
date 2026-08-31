/**
 * SportsPred — Tennis scoring engine (canonical implementation).
 *
 * Implements "TENNIS PREDICTION MASTER PROMPT v1.0", Step 2 (market scoring)
 * and Step 3 (decision rules) exactly as specified, plus a small set of
 * explicitly-flagged patches for defects found during review.
 *
 * RULES OF THIS FILE
 *  - Pure functions only. No I/O, no network, no clock, no randomness.
 *  - Every input field may be null/undefined. A missing field is never
 *    guessed: it is recorded in `missing[]` and the score is capped by the
 *    confidence penalty. This is what makes "no hallucinations" enforceable.
 *  - Every point awarded is traceable: each component records its rule id,
 *    the value that triggered it and the points given.
 *  - The same module is imported by the browser (docs/assets/js) and by the
 *    Node test suite, so the site can never drift from the tested logic.
 *
 * See docs/PROMPT_REVIEW.md for the line-by-line review that motivates PATCHES.
 */

export const RULESET_VERSION = 'v1.1';
export const PROMPT_VERSION = 'v1.0';

/**
 * Patches applied on top of the literal v1.0 wording. Each is individually
 * toggleable so the review can be audited, and the site displays which are on.
 */
export const PATCHES = {
  /** v1.0 lets bonuses push a 100-point scale past 100. Cap it. */
  capScoresAt100: true,
  /**
   * v1.0 bug: the first-set market inherits the full win-match base score and
   * only swaps one 10-point factor, so its floor is ~74 and the 70/55
   * thresholds can never fire below HIGH. Rescale so the three markets are
   * genuinely independent.
   */
  firstSetIndependentScale: true,
  /**
   * v1.0 bug: surface form is scored on raw win COUNT (2 wins = 13pts) with no
   * denominator, so a 2-0 record outscores an 8-3 record. Score win RATE with
   * a minimum-match volume gate.
   */
  surfaceWinRateNotCount: true,
  /**
   * v1.0 labels the odds band a "value" score but awards MORE points for
   * shorter prices, which measures implied probability, not edge. Keep the
   * probability behaviour (it is what the bands describe) but report it under
   * its true name and never call it value.
   */
  labelProbabilityNotValue: true,
};

export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' };

/** Cost, in points, of each input factor that could not be sourced. */
const MISSING_FIELD_PENALTY = 6;
/** Below this many sourced factors a pick is never better than LOW. */
const MIN_FACTORS_FOR_MEDIUM = 4;

/* ------------------------------------------------------------------ *
 * Odds helpers
 * ------------------------------------------------------------------ */

/** Decimal odds -> American. 2.00 -> +100, 1.50 -> -200, 3.50 -> +250. */
export function decimalToAmerican(decimal) {
  if (decimal == null || !isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** American -> implied probability with the vig still in (raw, not devigged). */
export function americanToImpliedProb(american) {
  if (american == null) return null;
  if (american > 0) return 100 / (american + 100);
  if (american < 0) return -american / (-american + 100);
  return null;
}

/**
 * Normalise any odds input to { decimal, american }.
 * Accepts decimal (1.20) or American (-500 / +250). Never invents a price.
 */
export function normaliseOdds(raw) {
  if (raw == null) return null;
  let decimal = null;
  if (typeof raw === 'object') {
    decimal = raw.decimal ?? null;
    if (decimal == null && raw.american != null) {
      decimal = raw.american > 0 ? raw.american / 100 + 1 : 100 / -raw.american + 1;
    }
  } else if (typeof raw === 'number') {
    // Heuristic only when a bare number is handed in: >=1.01 is decimal.
    decimal = raw >= 1.01 ? raw : raw / 100 + 1;
  }
  if (decimal == null || !isFinite(decimal) || decimal <= 1.0) return null;
  return { decimal: Number(decimal.toFixed(3)), american: decimalToAmerican(decimal) };
}

/** Is a price "shorter than" a reference American figure (e.g. -500)? */
function shorterThan(am, ref) {
  if (am == null) return false;
  if (ref < 0) return am < 0 && am < ref;
  return am < 0 || am < ref;
}

/* ------------------------------------------------------------------ *
 * Component bookkeeping
 * ------------------------------------------------------------------ */

function comp(id, label, points, detail, { max = null, missing = null } = {}) {
  return { id, label, points, max, detail, missing: missing ?? false };
}

/* ------------------------------------------------------------------ *
 * WIN MATCH market  (25 + 25 + 20 + 20 + 10 = 100)
 * ------------------------------------------------------------------ */

function scoreRecentForm(p, o, missing) {
  const last5 = p?.form?.last5; // e.g. ['W','W','L','W','W'] most recent first
  const out = [];
  if (!Array.isArray(last5) || last5.length < 5) {
    missing.push('form.last5 (last 5 match results, last month)');
    out.push(comp('form', 'Recent form (last month, double weighted)', 0, 'no sourced last-5 record', { max: 25, missing: true }));
    return out;
  }
  const wins = last5.slice(0, 5).filter((r) => r === 'W').length;
  const base = wins === 5 ? 25 : wins === 4 ? 18 : wins === 3 ? 10 : 0;
  out.push(comp('form', `Recent form: ${wins}/5 won in last month`, base, `${wins} of last 5 won`, { max: 25 }));

  // Bonus +5 — current tournament winning streak of 3+
  const streak = p?.form?.tournamentWinStreak ?? null;
  if (streak == null) {
    missing.push('form.tournamentWinStreak');
  } else if (streak >= 3) {
    out.push(comp('form_streak', 'Bonus: tournament winning streak 3+', 5, `streak ${streak}`, { max: 5 }));
  }

  // Bonus +5 — opponent lost their last match in straight sets
  const oppSS = o?.form?.lastMatchStraightSetLoss ?? null;
  if (oppSS == null) {
    missing.push('opponent.form.lastMatchStraightSetLoss');
  } else if (oppSS) {
    out.push(comp('form_opp_ss', 'Bonus: opponent lost last match in straight sets', 5, 'confirmed', { max: 5 }));
  }
  return out;
}

function scorePriceBand(fav, missing) {
  const am = fav?.odds?.american ?? null;
  const max = 25;
  if (am == null) {
    missing.push('odds (moneyline from >=2 sources)');
    return [comp('price', 'Implied-probability band', 0, 'no sourced price', { max, missing: true })];
  }
  const label = PATCHES.labelProbabilityNotValue
    ? 'Implied-probability band (NOT value)'
    : 'Odds and value assessment';
  let pts;
  if (shorterThan(am, -300) || am === -300) pts = 25;
  else if (am <= -200) pts = 18;
  else if (am <= -150) pts = 12;
  else if (am <= -100) pts = 6;
  else pts = 8; // plus price with form support
  const c = [comp('price', label, pts, `American ${am} (decimal ${fav.odds.decimal})`, { max })];

  // Deduct 10 — shorter than -500 but weak surface form.
  const surf = fav?.surface;
  const weakSurface = surf != null && surf.losses != null && surf.wins != null &&
    surf.wins + surf.losses > 0 && surf.wins / (surf.wins + surf.losses) < 0.5;
  if (shorterThan(am, -500) && weakSurface) {
    c.push(comp('price_trap', 'Deduction: sub -500 favourite with weak surface form', -10, 'overbet favourite trap', { max: 0 }));
  }
  return c;
}

function rankBandPoints(r1, r2) {
  // r1 is the favourite's rank, r2 the opponent's.
  const [hi, lo] = r1 <= r2 ? [r1, r2] : [r2, r1];
  if (hi <= 20 && lo > 100) return 20;
  if (hi <= 20 && lo >= 50 && lo <= 99) return 14;
  if (hi <= 20 && lo >= 21 && lo <= 49) return 8;
  // v1.0 has no band for top-20 vs top-20, or both outside top 20 but inside
  // top 50. Those fall through to the explicit "both outside top 50" rule.
  if (hi > 50 && lo > 50) return 4;
  return null; // unspecified band -> not scored, flagged below
}

function scoreRanking(fav, opp, match, missing) {
  const r1 = fav?.rank ?? null;
  const r2 = opp?.rank ?? null;
  if (r1 == null || r2 == null) {
    missing.push('rank (ATP/WTA singles ranking, both players)');
    return [comp('rank', 'Ranking advantage', 0, 'unsourced ranking', { max: 20, missing: true })];
  }
  let pts = rankBandPoints(r1, r2);
  const out = [];
  if (pts == null) {
    missing.push('rank band undefined in v1.0 for this pairing');
    out.push(comp('rank', 'Ranking advantage', 0, `#${r1} vs #${r2} — band unspecified in v1.0`, { max: 20, missing: true }));
  } else {
    out.push(comp('rank', 'Ranking advantage', pts, `#${r1} vs #${r2}`, { max: 20 }));
  }
  // Deduct 5 — lower-ranked player has won 2+ of last 3 same-surface meetings.
  const h2h = match?.h2h;
  if (h2h?.sameSurfaceLowerRankedWonOfLast3 == null) {
    missing.push('h2h.sameSurfaceLast3 (head-to-head, same surface, last 3 years)');
  } else if (h2h.sameSurfaceLowerRankedWonOfLast3 >= 2) {
    out.push(comp('rank_ded', 'Deduction: underdog leads same-surface H2H', -5,
      `${h2h.sameSurfaceLowerRankedWonOfLast3}/3 last same-surface meetings`, { max: 0 }));
  }
  return out;
}

function scoreSurface(p, opp, match, missing) {
  const s = p?.surface;
  const surface = match?.surface ?? null;
  if (!s || s.wins == null || s.losses == null || !surface) {
    missing.push('surface record (last 12 months, current surface)');
    return [comp('surface', 'Surface-specific form', 0, 'unsourced surface record', { max: 20, missing: true })];
  }
  const played = s.wins + s.losses;
  const rate = played > 0 ? s.wins / played : 0;
  const out = [];
  if (PATCHES.surfaceWinRateNotCount) {
    if (played < 3) {
      out.push(comp('surface', 'Surface-specific form (win rate)', 6,
        `${s.wins}-${s.losses} on ${surface}: sample below 3 matches`, { max: 20 }));
    } else if (rate >= 0.75) {
      out.push(comp('surface', 'Surface-specific form (win rate)', 20,
        `${s.wins}-${s.losses} on ${surface} = ${(rate * 100).toFixed(0)}%`, { max: 20 }));
    } else if (rate >= 0.55) {
      out.push(comp('surface', 'Surface-specific form (win rate)', 13,
        `${s.wins}-${s.losses} on ${surface} = ${(rate * 100).toFixed(0)}%`, { max: 20 }));
    } else if (rate > 0) {
      out.push(comp('surface', 'Surface-specific form (win rate)', 6,
        `${s.wins}-${s.losses} on ${surface} = ${(rate * 100).toFixed(0)}%`, { max: 20 }));
    } else {
      out.push(comp('surface', 'Surface-specific form (win rate)', 0,
        `0-${s.losses} on ${surface}`, { max: 20 }));
    }
  } else {
    // Literal v1.0: raw win count, with the title requirement.
    let pts = 0;
    if (s.wins >= 3 && s.titles >= 1) pts = 20;
    else if (s.wins === 2) pts = 13;
    else if (s.wins === 1 || played <= 2) pts = 6;
    out.push(comp('surface', 'Surface-specific form (raw win count)', pts,
      `${s.wins}-${s.losses}, ${s.titles ?? 0} titles on ${surface}`, { max: 20 }));
  }
  // Bonus +5 — opponent has a documented poor record on this surface.
  if (opp?.surface?.poorRecordOnSurface == null) {
    missing.push('opponent.surface record (for poor-surface bonus)');
  } else if (opp.surface.poorRecordOnSurface) {
    out.push(comp('surface_bonus', 'Bonus: opponent poor on this surface', 5, 'documented', { max: 5 }));
  }
  return out;
}

function scoreStage(match, fav, missing) {
  const level = match?.tournament?.level ?? null;
  const round = match?.tournament?.round ?? null;
  if (!level || !round) {
    missing.push('tournament.level / tournament.round');
    return [comp('stage', 'Tournament stage and context', 0, 'unsourced draw context', { max: 10, missing: true })];
  }
  const gsLate = level === 'GS' && ['QF', 'SF', 'F'].includes(round);
  const mastersKO = ['M1000', 'W1000'].includes(level) && round !== 'R128' && round !== 'R64' && round !== 'R1';
  let pts;
  if (gsLate) pts = 10;
  else if (mastersKO) pts = 8;
  else if (level === 'Q' || level === 'CH' || level === 'ITF') pts = 2;
  else pts = 5; // early rounds of any tournament
  const out = [comp('stage', `Tournament stage: ${level} ${round}`, pts, `${level} / ${round}`, { max: 10 })];

  const beatHigher = fav?.form?.beatHigherRankedThisEvent ?? null;
  if (beatHigher == null) {
    missing.push('form.beatHigherRankedThisEvent');
  } else if (beatHigher) {
    out.push(comp('stage_bonus', 'Bonus: beat a higher-ranked player this event', 3, 'confirmed', { max: 3 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * FIRST SET WINNER market
 * ------------------------------------------------------------------ */

function scoreFirstSet(match, fav, opp, missing) {
  const out = [];

  // 10pt factor: first-set win rate replaces the tournament-stage factor.
  const fsr = fav?.surface?.firstSetWinRateLast10 ?? fav?.form?.firstSetWinRateLast10 ?? null;
  if (fsr == null) {
    missing.push('first-set win rate (last 10 matches, this surface)');
    out.push(comp('fs_rate', 'First-set win rate', 0, 'unsourced', { max: 10, missing: true }));
  } else {
    const pts = fsr >= 0.70 ? 10 : fsr >= 0.60 ? 6 : 0;
    out.push(comp('fs_rate', `First-set win rate ${(fsr * 100).toFixed(0)}%`, pts,
      'last 10 matches on this surface', { max: 10 }));
  }

  // +8 serving advantage
  const sv = fav?.serve;
  const os = opp?.serve;
  if (!sv || !os || sv.firstServePct == null || os.firstServePct == null) {
    missing.push('serve.firstServePct / serve.acesPerMatch (both players, this surface)');
  } else if (sv.firstServePct - os.firstServePct >= 0.03 ||
             (sv.acesPerMatch != null && os.acesPerMatch != null && sv.acesPerMatch - os.acesPerMatch >= 2)) {
    out.push(comp('fs_serve', 'Serving advantage on this surface', 8,
      `1st serve ${(sv.firstServePct * 100).toFixed(1)}% vs ${(os.firstServePct * 100).toFixed(1)}%`, { max: 8 }));
  }

  // -5 documented slow starter
  if (fav?.form?.documentedSlowStarter == null) {
    missing.push('form.documentedSlowStarter');
  } else if (fav.form.documentedSlowStarter) {
    out.push(comp('fs_slow', 'Deduction: documented slow starter', -5, 'confirmed', { max: 0 }));
  }

  // Fatigue: -6 favourite played a 3-setter in the last 24h; +5 opponent did.
  const favLong = fav?.rest?.played3SetsLast24h ?? null;
  const oppLong = opp?.rest?.played3SetsLast24h ?? null;
  if (favLong == null) missing.push('rest.played3SetsLast24h (favourite)');
  else if (favLong) out.push(comp('fs_fatigue', 'Fatigue: 3-set match in last 24h', -6, 'confirmed', { max: 0 }));
  if (oppLong == null) missing.push('rest.played3SetsLast24h (opponent)');
  else if (oppLong) out.push(comp('fs_fatigue_opp', 'Bonus: opponent played a long match', 5, 'confirmed', { max: 5 }));

  // -5 outside the -150..-500 band
  const am = fav?.firstSetOdds?.american ?? null;
  if (am == null) {
    missing.push('firstSetOdds');
  } else if (!(am < 0 && am >= -500 && am <= -150)) {
    out.push(comp('fs_price', 'Deduction: price outside -150 to -500', -5, `American ${am}`, { max: 0 }));
  }

  if (PATCHES.firstSetIndependentScale) {
    // Independent market: the 10pt first-set factor is only 1/5 of the score,
    // so the raw modifiers above (max +23 / min -16) cannot dominate. Weight
    // them onto the remaining 90 points pro-rata.
    const rate = out.find((c) => c.id === 'fs_rate')?.points ?? 0;
    const mods = out.filter((c) => c.id !== 'fs_rate').reduce((a, c) => a + c.points, 0);
    const scaled = Math.round((mods * 90) / 23);
    out.push(comp('fs_scale', 'Rescale modifiers onto 90-point remainder', scaled,
      'patch: firstSetIndependentScale', { max: 90 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * GAMES HANDICAP market  (30 + 25 + 25 + 20 = 100)
 * ------------------------------------------------------------------ */

function scoreHandicap(match, fav, missing) {
  const out = [];

  const r1 = fav?.rank ?? null;
  const r2 = (match?.opponentRank) ?? null;
  if (r1 == null || r2 == null) {
    missing.push('rank (both players) — handicap ranking-gap factor');
    out.push(comp('h_rank', 'Ranking gap', 0, 'unsourced', { max: 30, missing: true }));
  } else {
    const [hi, lo] = r1 <= r2 ? [r1, r2] : [r2, r1];
    let pts = 0;
    let detail = 'closely ranked';
    if (hi <= 20 && lo > 100) { pts = 30; detail = 'top 20 vs outside top 100'; }
    else if (hi <= 20 && lo >= 50 && lo <= 99) { pts = 20; detail = 'top 20 vs 50-99'; }
    else if (hi <= 20 && lo >= 21 && lo <= 49) { pts = 10; detail = 'top 20 vs 21-49'; }
    out.push(comp('h_rank', `Ranking gap: ${detail}`, pts, `#${r1} vs #${r2}`, { max: 30 }));
  }

  // Straight-set win rate (25)
  const ss = fav?.form?.straightSetsLast3; // array of booleans, most recent first
  if (!Array.isArray(ss) || ss.length < 3) {
    missing.push('form.straightSetsLast3');
    out.push(comp('h_ss', 'Straight-set win rate', 0, 'unsourced', { max: 25, missing: true }));
  } else {
    const n = ss.slice(0, 3).filter(Boolean).length;
    const pts = n === 3 ? 25 : n === 2 ? 16 : n === 1 ? 6 : 0;
    out.push(comp('h_ss', `Straight sets: ${n}/3`, pts, 'last 3 matches', { max: 25 }));
  }

  // Handicap line value (25)
  const am = fav?.handicapOdds?.american ?? null;
  if (am == null) {
    missing.push('handicapOdds (games handicap price)');
    out.push(comp('h_price', 'Handicap line value', 0, 'unsourced', { max: 25, missing: true }));
  } else if (am >= -120 && am <= 110) {
    out.push(comp('h_price', 'Handicap near-even', 25, `American ${am}`, { max: 25 }));
  } else if (am > -180 && am < -120) {
    out.push(comp('h_price', 'Handicap moderate', 15, `American ${am}`, { max: 25 }));
  } else {
    out.push(comp('h_price', 'Handicap too short — return insufficient', 5, `American ${am}`, { max: 25 }));
  }

  // Surface dominance (20)
  const dom = fav?.surface?.dominantMarginGames ?? null; // e.g. {bigWins: 3, of: 5}
  if (!dom || dom.bigWins == null || dom.of == null) {
    missing.push('surface.dominantMarginGames (wins by 6+ games)');
    out.push(comp('h_dom', 'Surface dominance', 0, 'unsourced', { max: 20, missing: true }));
  } else if (dom.bigWins >= 2 && dom.bigWins / Math.max(dom.of, 1) >= 0.4) {
    out.push(comp('h_dom', 'Multiple 6+ game wins on this surface', 20,
      `${dom.bigWins} of last ${dom.of}`, { max: 20 }));
  } else if (dom.bigWins >= 1) {
    out.push(comp('h_dom', 'Inconsistent margins', 8, `${dom.bigWins} of last ${dom.of}`, { max: 20 }));
  } else {
    out.push(comp('h_dom', 'Tight matches even in wins', 0, `0 of last ${dom.of}`, { max: 20 }));
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Assembly + Step 3 decision rules
 * ------------------------------------------------------------------ */

function total(components) {
  let t = components.reduce((a, c) => a + c.points, 0);
  if (PATCHES.capScoresAt100) t = Math.min(t, 100);
  return t;
}

function applyMissingPenalty(score, missing) {
  const n = new Set(missing).size;
  return Math.max(0, score - n * MISSING_FIELD_PENALTY);
}

function bandFor(score, highAt, medAt) {
  if (score >= highAt) return CONFIDENCE.HIGH;
  if (score >= medAt) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

/**
 * Score all three markets for one match.
 * @param {object} match  see docs/SCHEMA.md
 * @returns {object} result with per-market score, band, components, missing
 */
export function scoreMatch(match) {
  const missing = [];
  const flags = [];

  const [fav, opp] = pickFavourite(match);
  if (!fav) {
    return {
      event_id: match?.event_id ?? null,
      ruleset: RULESET_VERSION,
      favourite: null,
      markets: {},
      missing: ['favourite could not be determined (no sourced price or ranking)'],
      flags: ['UNSCORED: no favourite determinable from sourced data'],
      summary: { any: false },
    };
  }

  /* ---- Win match ---- */
  const wmComp = [
    ...scoreRecentForm(fav, opp, missing),
    ...scorePriceBand(fav, missing),
    ...scoreRanking(fav, opp, match, missing),
    ...scoreSurface(fav, opp, match, missing),
    ...scoreStage(match, fav, missing),
  ];
  const wmRaw = total(wmComp);
  const wmScore = applyMissingPenalty(wmRaw, missing);
  let wmBand = bandFor(wmScore, 70, 50);
  if (new Set(missing).size > 2) wmBand = CONFIDENCE.LOW;

  /* ---- First set ---- */
  const fsComp = scoreFirstSet(match, fav, opp, missing);
  const fsRaw = total(fsComp);
  const fsScore = applyMissingPenalty(fsRaw, missing);
  let fsBand = bandFor(fsScore, 70, 55);

  /* ---- Games handicap ---- */
  const ss3 = Array.isArray(fav?.form?.straightSetsLast3)
    ? fav.form.straightSetsLast3.slice(0, 3).filter(Boolean).length : null;
  const hAm = fav?.handicapOdds?.american ?? null;
  const hPriceOk = hAm != null && hAm >= -120 && hAm <= 110;
  const gate = {
    winMatchGate: wmScore >= 65,
    straightSetGate: ss3 != null && ss3 >= 2,
    priceGate: hPriceOk,
  };
  const gatePass = gate.winMatchGate && gate.straightSetGate && gate.priceGate;
  const hComp = scoreHandicap(match, fav, missing);
  const hRaw = total(hComp);
  const hScore = applyMissingPenalty(hRaw, missing);
  let hBand = gatePass ? bandFor(hScore, 70, 55) : CONFIDENCE.SKIP;
  if (gatePass === false) {
    const why = [];
    if (!gate.winMatchGate) why.push(`win-match score ${wmScore} below 65`);
    if (!gate.straightSetGate) why.push(ss3 == null ? 'straight-set record unsourced' : `only ${ss3}/3 straight-set wins`);
    if (!gate.priceGate) why.push(hAm == null ? 'handicap price unsourced' : `handicap price ${hAm} outside -120/+110`);
    flags.push(`HANDICAP SKIPPED: ${why.join('; ')}`);
  }

  /* ---- Step 3 profitability rules ---- */
  // Rule 1: never a win-match bet shorter than -500 unless surface form scores 18+.
  if (fav?.odds?.american != null && shorterThan(fav.odds.american, -500)) {
    const surfComp = wmComp.find((c) => c.id === 'surface');
    if (surfComp == null || surfComp.points < 18) {
      flags.push('BLOCKED: price shorter than -500 without a surface-form score of 18+');
      wmBand = CONFIDENCE.SKIP;
    }
  }
  // Rule 2: never a first-set bet shorter than -500. This is unconditional in
  // Step 3 and does not depend on the moneyline price.
  if (fav?.firstSetOdds?.american != null && shorterThan(fav.firstSetOdds.american, -500)) {
    flags.push('BLOCKED: first-set price shorter than -500 (market ceiling)');
    fsBand = CONFIDENCE.SKIP;
  }

  /* ---- Retirement / walkover risk ---- */
  if (fav?.rest?.physicalConcernCited === true || opp?.rest?.physicalConcernCited === true) {
    flags.push('RISK: a player has cited physical concerns — handicap market carries void-bet risk');
    hBand = CONFIDENCE.SKIP;
  }

  const sourcedFactors = wmComp.filter((c) => !c.missing).length;
  if (sourcedFactors < MIN_FACTORS_FOR_MEDIUM && wmBand === CONFIDENCE.HIGH) wmBand = CONFIDENCE.MEDIUM;
  if (sourcedFactors < MIN_FACTORS_FOR_MEDIUM && fsBand === CONFIDENCE.HIGH) fsBand = CONFIDENCE.MEDIUM;

  const missingSorted = [...new Set(missing)].sort();

  return {
    event_id: match?.event_id ?? null,
    ruleset: RULESET_VERSION,
    favourite: fav.name,
    opponent: opp?.name ?? null,
    markets: {
      win_match: { score: wmScore, rawScore: wmRaw, band: wmBand, components: wmComp },
      first_set: { score: fsScore, rawScore: fsRaw, band: fsBand, components: fsComp },
      games_handicap: { score: hScore, rawScore: hRaw, band: hBand, components: hComp, gate },
    },
    missing: missingSorted,
    flags,
    summary: {
      any: wmBand !== CONFIDENCE.LOW || fsBand !== CONFIDENCE.LOW || hBand !== CONFIDENCE.SKIP,
      sourcedFactors,
    },
  };
}

/**
 * Decide who the "favourite" is for scoring. Uses a sourced price when
 * available, otherwise the better ranking. Returns null if neither exists.
 */
export function pickFavourite(match) {
  const players = Array.isArray(match?.players) ? match.players : [];
  if (players.length !== 2) return [null, null];
  const [a, b] = players;
  const oa = a?.odds?.american ?? null;
  const ob = b?.odds?.american ?? null;
  if (oa != null && ob != null) return oa < ob ? [a, b] : [b, a];
  if (a?.rank != null && b?.rank != null) return a.rank < b.rank ? [a, b] : [b, a];
  if (a?.rank != null) return [a, b];
  if (b?.rank != null) return [b, a];
  return [null, null];
}

/**
 * Score a whole card. Also applies the card-level rule: if 3+ matches score
 * below 55 across all markets, keep only the 3 highest-scoring matches.
 */
export function scoreCard(matches) {
  const results = matches.map((m) => ({ match: m, result: scoreMatch(m) }));
  const weak = results.filter(({ result }) =>
    result.markets.win_match &&
    result.markets.win_match.score < 55 &&
    result.markets.first_set.score < 55);
  const trimmed = weak.length >= 3;
  let kept = results;
  if (trimmed) {
    kept = [...results].sort((x, y) => y.result.markets.win_match.score - x.result.markets.win_match.score)
      .slice(0, 3)
      .map((r) => r.match.event_id)
      .reduce((acc, id) => {
        const found = results.find((r) => r.match.event_id === id);
        if (found) acc.push(found);
        return acc;
      }, []);
  }
  return {
    ruleset: RULESET_VERSION,
    trimmed,
    trimmedReason: trimmed
      ? `${weak.length} matches scored below 55 on both win-match and first-set; card reduced to the 3 highest`
      : null,
    results: kept,
    dropped: trimmed ? results.filter((r) => !kept.includes(r)).map((r) => r.match.event_id) : [],
  };
}
