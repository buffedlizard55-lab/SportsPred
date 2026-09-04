/**
 * SportsPred — Baseball Scoring Engine (canonical implementation).
 *
 * Implements "BASEBALL PREDICTION MASTER PROMPT v1.0" Step 2 (three markets,
 * 100 points each) and Step 3 (decision rules):
 *
 *   WIN MATCH OUTRIGHT (100), RUN LINE +1.5/-1.5 (100), GAME TOTAL (100).
 *
 * RULES OF THIS MODULE (identical to every other engine in this repo):
 *  - Pure functions. No I/O, no network, no clock, no randomness.
 *  - Every input may be null. A factor that was not sourced is NEVER guessed:
 *    it is pushed to `missing[]`, its component is marked `missing: true`, and
 *    the confidence caps in Step 3 apply. This is how "no hallucinations" is
 *    enforced rather than promised.
 *  - Every point is traceable: { id, label, points, max, detail }.
 *  - Imported directly by the browser page AND by the Node test suite, so the
 *    site cannot drift from what is tested.
 *
 * HONESTLY RECORDED GAPS (see docs/BASEBALL_IRREGULARITIES.md):
 *  - No key-less multi-book moneyline / run line / total feed exists. ESPN
 *    publishes no baseball odds block (verified 2026-09-03: the core odds
 *    endpoint returns zero items and the scoreboard competitions carry no
 *    `odds` array). OLBG publishes tipster consensus, not prices. So the Odds
 *    and Value block (20 pts) and the recent Over/Under trend block (15 pts,
 *    which needs a posted line) score as missing on live cards.
 *  - Bullpen ERA rank and bullpen usage over the last three days have no
 *    key-less feed (team pitching stats do not isolate relievers), so the
 *    bullpen blocks score as missing.
 *  - Wind direction/speed are not published by any verified feed; only the
 *    indoor (dome) flag is sourced.
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';
export const PROMPT_NAME = 'BASEBALL PREDICTION MASTER PROMPT v1.0';

export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' };
export const MARKETS = {
  WIN: 'win_match',
  RUN_LINE: 'run_line',
  TOTAL: 'game_total',
};

const round = (n, dp = 4) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

/* ------------------------------------------------------------------ *
 * Odds helpers (re-declared locally so this module stays dependency-light
 * and independently testable).
 * ------------------------------------------------------------------ */

export function decimalToAmerican(decimal) {
  if (decimal == null || !isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function americanToDecimal(american) {
  if (american == null || !isFinite(american) || Number(american) === 0) return null;
  const v = Number(american);
  return v > 0 ? v / 100 + 1 : 100 / -v + 1;
}

export function americanToImpliedProb(american) {
  if (american == null || !isFinite(american)) return null;
  const v = Number(american);
  if (v === 0) return null;
  return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
}

export function devig(probs) {
  const vals = probs.filter((p) => typeof p === 'number' && p > 0);
  if (vals.length !== probs.length || !vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  return probs.map((p) => p / sum);
}

/* ------------------------------------------------------------------ *
 * Step 2a — WIN MATCH OUTRIGHT (100pts)
 * ------------------------------------------------------------------ */

/**
 * Recent Form — last month double weighted (25pts).
 *   Won 4+ of last 5 = 25 | Won 3/5 = 16 | Won 2/5 = 7 | Won <=1/5 = 0
 *   +5 winning streak of 4+ | +4 opponent lost 4+ of last 5
 *
 * NOTE (documented, not silently changed): the prompt asks for the last two
 * weeks to be weighted double, but the points table it gives is a plain count
 * of wins in the last five. The table is implemented as written; the weighting
 * instruction has no numerical effect on it. See docs/BASEBALL_PROMPT_REVIEW.md.
 */
export function scoreRecentForm(team, opponent, missing) {
  const out = [];
  const last5 = team?.form?.last5;
  if (!Array.isArray(last5) || last5.length < 5) {
    missing.push('form.last5 (last 5 results from the last month, last two weeks weighted double)');
    out.push(comp('form', 'Recent Form — last month double weighted', 0, 'no sourced last 5 results', { max: 25, missing: true }));
    return { components: out, base: 0, wins: null };
  }

  const wins = last5.slice(0, 5).filter((r) => r === 'W').length;
  const base = wins >= 4 ? 25 : wins === 3 ? 16 : wins === 2 ? 7 : 0;
  out.push(comp('form', 'Recent Form — last month double weighted', base, `${wins}/5 wins in the last month`, { max: 25 }));

  let streak = team?.form?.winStreak;
  if (typeof streak !== 'number') {
    streak = 0;
    for (const r of last5) { if (r === 'W') streak += 1; else break; }
  }
  if (streak >= 4) {
    out.push(comp('form_streak', 'Bonus: winning streak of 4 or more consecutive games', 5, `current streak ${streak}`, { max: 5 }));
  }

  const oppLast5 = opponent?.form?.last5;
  if (!Array.isArray(oppLast5) || oppLast5.length < 5) {
    missing.push('opponent.form.last5 (opponent last 5 results, needed for the 4-loss bonus)');
    return { components: out, base, wins };
  }
  const oppLosses = oppLast5.slice(0, 5).filter((r) => r === 'L').length;
  if (oppLosses >= 4) {
    out.push(comp('form_opp_collapse', 'Bonus: opponent has lost 4 or more of their last 5 games', 4, `opponent lost ${oppLosses}/5`, { max: 4 }));
  }
  return { components: out, base, wins };
}

/**
 * Starting Pitcher Quality (25pts).
 *   Confirmed starter, ERA < 3.00 and 2+ quality starts in last 4 = 25
 *   ERA 3.00–3.99 with at least 1 quality start in last 3 = 17
 *   ERA 4.00–4.99 or inconsistent recent starts = 9
 *   ERA above 5.00 or unconfirmed starter = 0
 *   +5 opposing lineup below .235 vs this handedness in the last 30 days
 *   −8 on short rest, or 100+ pitches in each of the last two starts
 *
 * A "quality start" is 6+ innings pitched with 3 or fewer earned runs. It is
 * derived from the sourced game log, never assumed.
 */
export function scoreStartingPitcher(team, opponent, missing) {
  const out = [];
  const sp = team?.starter ?? null;
  if (!sp || sp.era == null) {
    missing.push('starter (confirmed starter ERA, WHIP, strikeouts per 9, last 4 starts)');
    out.push(comp('starter', 'Starting Pitcher Quality', 0, 'no sourced starter ERA', { max: 25, missing: true }));
    return { components: out, score: 0 };
  }

  const era = Number(sp.era);
  const qs4 = typeof sp.qualityStartsLast4 === 'number' ? sp.qualityStartsLast4 : null;
  const qs3 = typeof sp.qualityStartsLast3 === 'number' ? sp.qualityStartsLast3 : null;
  const confirmed = sp.confirmed !== false;

  let pts = 0;
  let detail = `ERA ${round(era, 2)}${confirmed ? '' : ' — starter not confirmed'}`;
  if (!confirmed || era >= 5.0) {
    pts = 0;
    detail = !confirmed ? 'starter not confirmed — 0 points by rule' : `ERA ${round(era, 2)} is 5.00 or higher — 0 points by rule`;
  } else if (era < 3.0) {
    pts = qs4 != null && qs4 >= 2 ? 25 : 17;
    detail = `ERA ${round(era, 2)} below 3.00 with ${qs4 ?? 'unknown'} quality starts in last 4`;
    if (qs4 == null) missing.push('starter.qualityStartsLast4 (quality starts in the last 4 outings)');
  } else if (era < 4.0) {
    pts = qs3 != null && qs3 >= 1 ? 17 : 9;
    detail = `ERA ${round(era, 2)} in the 3.00–3.99 band with ${qs3 ?? 'unknown'} quality starts in last 3`;
    if (qs3 == null) missing.push('starter.qualityStartsLast3 (quality starts in the last 3 outings)');
  } else {
    pts = 9;
    detail = `ERA ${round(era, 2)} in the 4.00–4.99 band or inconsistent recent starts`;
  }
  out.push(comp('starter', 'Starting Pitcher Quality', pts, detail, { max: 25 }));

  const oppVs = opponent?.vsStarterHandednessAvg ?? null;
  if (oppVs == null) {
    missing.push('opponent.vsStarterHandednessAvg (opposing lineup batting average vs this handedness, last 30 days)');
  } else if (oppVs < 0.235) {
    out.push(comp('starter_split', 'Bonus: opposing lineup below .235 vs this handedness', 5, `opponent ${round(oppVs, 3)} vs handedness`, { max: 5 }));
  }

  const shortRest = sp.shortRest === true;
  const pitches = sp.pitchesLast2 === true;
  if (shortRest || pitches) {
    out.push(comp('starter_fatigue', 'Deduction: short rest or 100+ pitches in each of the last two starts', -8,
      shortRest ? 'pitching on short rest' : '100+ pitches in each of the last two starts', { max: 0 }));
  } else if (sp.shortRest == null) {
    missing.push('starter.shortRest (whether the starter is pitching on short rest)');
  }

  return { components: out, score: pts };
}

/**
 * Run Differential Value (20pts) — over the last month.
 *   Above +2.5 per game = 20 | +1.5 to +2.4 = 13 | 0 to +1.4 = 7 | negative = 0
 *   +4 if opponent carries a negative run differential over the same period
 */
export function scoreRunDifferential(team, opponent, missing) {
  const out = [];
  const diff = team?.runDiffPerGame ?? null;
  if (diff == null) {
    missing.push('runDiffPerGame (average runs scored minus runs allowed per game over the last month)');
    out.push(comp('rundiff', 'Run Differential Value', 0, 'no sourced last-month run differential', { max: 20, missing: true }));
    return { components: out };
  }

  let pts = 0;
  if (diff > 2.5) pts = 20;
  else if (diff >= 1.5) pts = 13;
  else if (diff >= 0) pts = 7;
  else pts = 0;
  out.push(comp('rundiff', 'Run Differential Value', pts, `${round(diff, 2)} runs per game over the last month`, { max: 20 }));

  const oppDiff = opponent?.runDiffPerGame ?? null;
  if (oppDiff == null) {
    missing.push('opponent.runDiffPerGame (opponent last-month run differential)');
  } else if (oppDiff < 0) {
    out.push(comp('rundiff_opp', 'Bonus: opponent carries a negative run differential', 4, `opponent ${round(oppDiff, 2)} per game`, { max: 4 }));
  }
  return { components: out };
}

/**
 * Odds and Value Assessment (20pts).
 *   Moneyline -200 or lower = 20 | -150 to -199 = 14 | -100 to -149 = 9
 *   Underdog with positive odds AND a run differential advantage AND superior
 *   recent form = 14 (primary value play flag)
 *   −8 if shorter than -250 but the starter is unconfirmed or the bullpen is
 *   heavily fatigued
 *
 * NOTE (documented reading): "superior recent form" is not defined. It is
 * taken to mean strictly more wins in the last five than the opponent, and the
 * "run differential advantage" strictly better than the opponent. Stated in the
 * component detail. There is no key-less odds feed, so this block scores as
 * missing on live cards.
 */
export function scoreOddsAndValue(team, opponent, formWins, missing) {
  const out = [];
  const american = team?.odds?.american ?? null;
  if (american == null) {
    missing.push('odds.moneyline (current moneyline cross-referenced from at least two books)');
    out.push(comp('odds', 'Odds and Value Assessment', 0, 'no sourced moneyline price', { max: 20, missing: true }));
    return { components: out, american: null, underdogValue: false };
  }

  let pts = 0;
  let detail = `American ${american} (decimal ${round(team?.odds?.decimal ?? americanToDecimal(american), 3)})`;
  let underdogValue = false;
  if (american <= -200) pts = 20;
  else if (american <= -150) pts = 14;
  else if (american <= -100) pts = 9;
  else if (american > 0) {
    const runDiffEdge = (team?.runDiffPerGame ?? null) != null && (opponent?.runDiffPerGame ?? null) != null
      && team.runDiffPerGame > opponent.runDiffPerGame;
    const formEdge = typeof formWins === 'number' && typeof opponent?.form?.last5 === 'object'
      && Array.isArray(opponent.form.last5)
      && formWins > opponent.form.last5.slice(0, 5).filter((r) => r === 'W').length;
    if (runDiffEdge && formEdge) {
      pts = 14;
      underdogValue = true;
      detail += ' — underdog with a run differential advantage and superior recent form (primary value play)';
    } else {
      detail += ' — plus price without both a run differential advantage and superior form, no points';
    }
  } else {
    detail += ' — price between the defined bands, no points';
  }
  out.push(comp('odds', 'Odds and Value Assessment', pts, detail, { max: 20 }));

  const bullpenFatigued = team?.bullpenFatigue === true;
  const starterUnconfirmed = team?.starter?.confirmed === false;
  if (american <= -250 && (starterUnconfirmed || bullpenFatigued)) {
    out.push(comp('odds_deduction', 'Deduction: price shorter than -250 with the starter unconfirmed or the bullpen heavily fatigued', -8,
      starterUnconfirmed ? 'starter not confirmed' : 'bullpen heavily fatigued', { max: 0 }));
  }
  return { components: out, american, underdogValue };
}

/**
 * Head-to-Head Record (10pts) — last 3 years, most recent 3 weighted most.
 *   Won 6+ of last 10 meetings = 10 | Won 5/10 = 6 | Trailing = 2
 *   +3 if the last 3 consecutive meetings were won
 *
 * NOTE (documented): the prompt's "most recent 3 meetings weighted most" has no
 * numerical table behind it; the published table is a plain count of the last
 * ten. The table is implemented as written. See docs/BASEBALL_PROMPT_REVIEW.md.
 */
export function scoreHeadToHead(team, h2h, missing) {
  const out = [];
  if (!h2h || h2h.meetings == null || h2h.winsA == null) {
    missing.push('head-to-head record over the last 3 years');
    out.push(comp('h2h', 'Head-to-Head Record', 0, 'no sourced head-to-head record', { max: 10, missing: true }));
    return { components: out };
  }

  const last10 = Math.min(h2h.meetings, 10);
  const winsInWindow = h2h.last10WinsA != null ? h2h.last10WinsA : Math.min(h2h.winsA, last10);
  const oppWins = last10 - winsInWindow;
  let pts = 0;
  if (winsInWindow >= 6) pts = 10;
  else if (winsInWindow === 5) pts = 6;
  else pts = 2;
  out.push(comp('h2h', 'Head-to-Head Record', pts, `${winsInWindow} of the last ${last10} head-to-head meetings`, { max: 10 }));

  if (h2h.last3StreakA === true) {
    out.push(comp('h2h_streak', 'Bonus: won the last 3 consecutive head-to-head meetings', 3, 'won the last 3 meetings', { max: 3 }));
  } else if (h2h.last3StreakA == null && h2h.meetings >= 3) {
    missing.push('h2h.last3StreakA (whether the last 3 consecutive meetings were won)');
  }
  return { components: out };
}

function sideTotal(components) {
  return components.reduce((a, c) => a + c.points, 0);
}

/** Score one side of the WIN MATCH OUTRIGHT market. */
export function scoreWinMatchSide(team, opponent, h2h, missing) {
  const form = scoreRecentForm(team, opponent, missing);
  const starter = scoreStartingPitcher(team, opponent, missing);
  const rundiff = scoreRunDifferential(team, opponent, missing);
  const odds = scoreOddsAndValue(team, opponent, form.wins, missing);
  const h2hRes = scoreHeadToHead(team, h2h, missing);

  const components = [...form.components, ...starter.components, ...rundiff.components, ...odds.components, ...h2hRes.components];
  const score = clamp(sideTotal(components), 0, 100);

  // "Two or more factors strongly aligned": at least two components at or above
  // 80% of their maximum and not missing.
  const strong = components.filter((c) => !c.missing && c.max != null && c.max > 0 && c.points >= Math.ceil(c.max * 0.8)).length;

  return {
    score,
    components,
    strongFactors: strong,
    wins: form.wins,
    starterScore: starter.score,
    starterMax: starter.score === 25,
    underdogValue: odds.underdogValue,
    american: odds.american,
    runDiffPerGame: team?.runDiffPerGame ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Step 2b — RUN LINE +1.5 / -1.5 (100pts)
 * ------------------------------------------------------------------ */

/**
 * Run line for one side. Base = the win-match blocks with the head-to-head
 * block REPLACED by run-margin analysis, then the modifiers:
 *   Run margin: avg margin >=3 = 20 | 2–2.9 = 12 | <2 = 0
 *   +10 starter ERA < 3.00 with 6+ innings per start
 *   +8  top-10 bullpen ERA (favourite -1.5) / bottom-10 bullpen (underdog +1.5)
 *   +8  run differential above +2.0 per game
 *   +7  opponent bullpen heavily used in the last 2 days
 */
export function scoreRunLineSide(team, opponent, winSide, h2h, missing) {
  const form = scoreRecentForm(team, opponent, missing);
  const starter = scoreStartingPitcher(team, opponent, missing);
  const rundiff = scoreRunDifferential(team, opponent, missing);
  const odds = scoreOddsAndValue(team, opponent, form.wins, missing);

  // Run margin replaces the head-to-head block.
  const margin = team?.avgWinMarginLast5Wins ?? null;
  const marginPts = margin == null ? null : margin >= 3 ? 20 : margin >= 2 ? 12 : 0;
  const marginMissing = margin == null;
  if (marginMissing) missing.push('avgWinMarginLast5Wins (average winning margin in the last 5 wins)');
  const marginComp = comp('run_margin', 'Run margin analysis (replaces head-to-head)', marginPts ?? 0,
    margin == null ? 'no sourced winning margins' : `average winning margin ${round(margin, 2)} runs`, { max: 20, missing: marginMissing });

  const components = [...form.components, ...starter.components, ...rundiff.components, ...odds.components, marginComp];

  // Modifiers.
  const era = team?.starter?.era;
  const innings = team?.starter?.avgInningsPerStart;
  if (era != null && innings != null && era < 3.0 && innings >= 6) {
    components.push(comp('runline_sp', 'Modifier: starter ERA below 3.00 with 6+ innings per start', 10, `ERA ${round(era, 2)}, ${round(innings, 2)} innings per start`, { max: 10 }));
  }

  const bullpenRank = team?.bullpenRank ?? null;
  if (bullpenRank == null) {
    missing.push('bullpenRank (bullpen ERA rank — top 10 vs bottom 10)');
  } else if (bullpenRank <= 10) {
    components.push(comp('runline_bp', 'Modifier: top-10 bullpen ERA closes games efficiently', 8, `bullpen ranked ${bullpenRank}`, { max: 8 }));
  } else if (bullpenRank >= (team?.bullpenLeagueSize ?? 30) - 9) {
    components.push(comp('runline_bp_dog', 'Modifier: bottom-10 bullpen bleeds late runs', 8, `bullpen ranked ${bullpenRank}`, { max: 8 }));
  }

  if ((team?.runDiffPerGame ?? null) != null && team.runDiffPerGame > 2.0) {
    components.push(comp('runline_rundiff', 'Modifier: run differential above +2.0 per game covers run lines at a higher rate', 8, `${round(team.runDiffPerGame, 2)} per game`, { max: 8 }));
  }

  if (opponent?.bullpenFatigue === true) {
    components.push(comp('runline_fatigue', 'Modifier: opponent bullpen used heavily in the last 2 days', 7, 'opponent bullpen fatigued', { max: 7 }));
  }

  const score = clamp(sideTotal(components), 0, 100);
  return { score, components, supportsCovering: margin != null && margin > 1.5, avgWinMargin: margin };
}

/* ------------------------------------------------------------------ *
 * Step 2c — GAME TOTAL OVER / UNDER (100pts)
 * ------------------------------------------------------------------ */

/**
 * Total market: a running ledger for the Over and Under sides.
 *   Combined offence (35): both 5+ = 35 Over | one 5+ other 4–4.9 = 22 Over |
 *     both 4–4.9 = 12 neutral | one or both below 3.5 = 20 Under
 *   Starter run suppression (25): both < 3.50 = 25 Under | one < 3.50 one
 *     > 4.50 = 10 neutral Over-lean | both > 4.50 = 25 Over | unconfirmed or
 *     bullpen game = +12 Over
 *   Bullpen & late innings (20): both bottom-10 = 20 Over | one elite one poor
 *     = 10 neutral | both top-10 = 18 Under
 *   Recent totals trends (15): needs a posted line — missing without one
 *   Weather & park (5): wind out = 5 Over | wind in = 5 Under | dome/neutral = 0
 */
export function scoreTotalMarket(match, missing) {
  const home = match?.home ?? {};
  const away = match?.away ?? {};
  const over = [];
  const under = [];
  const neutral = [];
  const add = (list, c) => list.push(c);

  // --- Combined offensive output (35) ---
  const hRuns = home?.runsPerGameRecent ?? null;
  const aRuns = away?.runsPerGameRecent ?? null;
  if (hRuns == null || aRuns == null) {
    missing.push('runsPerGameRecent (both teams\' runs per game over the last month)');
    add(neutral, comp('offense', 'Combined offensive output', 0, 'last-month scoring averages not sourced', { max: 35, missing: true }));
  } else if (hRuns >= 5 && aRuns >= 5) {
    add(over, comp('offense', 'Combined offensive output', 35, `both average 5 or more runs per game (${round(hRuns, 2)} and ${round(aRuns, 2)})`, { max: 35 }));
  } else if ((hRuns >= 5 && aRuns >= 4) || (aRuns >= 5 && hRuns >= 4)) {
    add(over, comp('offense', 'Combined offensive output', 22, `one averages 5+ and the other 4–4.9 (${round(hRuns, 2)} and ${round(aRuns, 2)})`, { max: 35 }));
  } else if (hRuns >= 4 && aRuns >= 4) {
    add(neutral, comp('offense', 'Combined offensive output', 12, `both average 4 to 4.9 (${round(hRuns, 2)} and ${round(aRuns, 2)})`, { max: 35 }));
  } else if (hRuns < 3.5 || aRuns < 3.5) {
    add(under, comp('offense', 'Combined offensive output', 20, `one or both average below 3.5 runs per game (${round(hRuns, 2)} and ${round(aRuns, 2)})`, { max: 35 }));
  } else {
    add(neutral, comp('offense', 'Combined offensive output', 0, `no band applies (${round(hRuns, 2)} and ${round(aRuns, 2)})`, { max: 35 }));
  }

  // --- Starting pitcher run suppression (25) ---
  const hEra = home?.starter?.era ?? null;
  const aEra = away?.starter?.era ?? null;
  const hConfirmed = home?.starter?.confirmed !== false && hEra != null;
  const aConfirmed = away?.starter?.confirmed !== false && aEra != null;
  if (hEra == null || aEra == null) {
    missing.push('starter.era for both starters (starting pitcher run suppression)');
    add(neutral, comp('suppression', 'Starting pitcher run suppression', 0, 'both starter ERAs not sourced', { max: 25, missing: true }));
  } else if (hEra < 3.5 && aEra < 3.5) {
    add(under, comp('suppression', 'Starting pitcher run suppression', 25, `both starters below 3.50 (${round(hEra, 2)} and ${round(aEra, 2)})`, { max: 25 }));
  } else if ((hEra < 3.5 && aEra > 4.5) || (aEra < 3.5 && hEra > 4.5)) {
    add(over, comp('suppression', 'Starting pitcher run suppression', 10, `one below 3.50 and one above 4.50 (${round(hEra, 2)} and ${round(aEra, 2)})`, { max: 25 }));
  } else if (hEra > 4.5 && aEra > 4.5) {
    add(over, comp('suppression', 'Starting pitcher run suppression', 25, `both starters above 4.50 (${round(hEra, 2)} and ${round(aEra, 2)})`, { max: 25 }));
  } else {
    add(neutral, comp('suppression', 'Starting pitcher run suppression', 0, `no band applies (${round(hEra, 2)} and ${round(aEra, 2)})`, { max: 25 }));
  }
  if (!hConfirmed || !aConfirmed) {
    if (!hConfirmed) missing.push('home starter not confirmed (bullpen game possible)');
    if (!aConfirmed) missing.push('away starter not confirmed (bullpen game possible)');
    add(over, comp('suppression_unconfirmed', 'Unconfirmed starter or bullpen game inflates totals', 12, 'one or both starters unconfirmed — no reliable stopper', { max: 12 }));
  }

  // --- Bullpen and late-inning run environment (20) ---
  const hBp = home?.bullpenRank ?? null;
  const aBp = away?.bullpenRank ?? null;
  const size = home?.bullpenLeagueSize ?? 30;
  if (hBp == null || aBp == null) {
    missing.push('bullpenRank for both bullpens (bullpen and late-inning run environment)');
    add(neutral, comp('bullpen', 'Bullpen and late-inning run environment', 0, 'bullpen ERA ranks not sourced', { max: 20, missing: true }));
  } else {
    const elite = (r) => r <= 10;
    const poor = (r) => r >= size - 9;
    if (poor(hBp) && poor(aBp)) add(over, comp('bullpen', 'Bullpen and late-inning run environment', 20, 'both bullpens rank bottom 10 in ERA', { max: 20 }));
    else if (elite(hBp) && elite(aBp)) add(under, comp('bullpen', 'Bullpen and late-inning run environment', 18, 'both bullpens rank top 10 in ERA', { max: 20 }));
    else if ((elite(hBp) && poor(aBp)) || (elite(aBp) && poor(hBp))) add(neutral, comp('bullpen', 'Bullpen and late-inning run environment', 10, 'one elite and one poor bullpen', { max: 20 }));
    else add(neutral, comp('bullpen', 'Bullpen and late-inning run environment', 0, 'no band applies', { max: 20 }));
  }

  // --- Recent totals trends (15) — needs a posted line, so missing without one ---
  const hTot = home?.recentTotals ?? null;
  const aTot = away?.recentTotals ?? null;
  if (!hTot || !aTot) {
    missing.push('recentTotals (Over/Under trends over the last 5 games — requires a posted total line, which no key-less feed provides)');
    add(neutral, comp('trends', 'Recent total trends', 0, 'no posted line, so Over/Under trends cannot be measured', { max: 15, missing: true }));
  } else if (hTot.overs >= 4 && aTot.overs >= 4) {
    add(over, comp('trends', 'Recent total trends', 15, 'both teams have gone Over in 4 of their last 5', { max: 15 }));
  } else if (hTot.overs >= 3 && aTot.overs >= 3) {
    add(over, comp('trends', 'Recent total trends', 9, 'both teams have gone Over in 3 of their last 5', { max: 15 }));
  } else if (hTot.unders >= 3 && aTot.unders >= 3) {
    add(under, comp('trends', 'Recent total trends', 14, 'both teams have gone Under in 3 or more of their last 5', { max: 15 }));
  } else {
    add(neutral, comp('trends', 'Recent total trends', 4, 'mixed trends', { max: 15 }));
  }

  // --- Weather and park environment (5) ---
  const indoor = match?.venueIndoor ?? null;
  const wind = match?.wind ?? null; // 'out' | 'in' | null
  if (wind === 'out') {
    add(over, comp('weather', 'Weather and park environment', 5, 'wind blowing out confirmed at game time', { max: 5 }));
  } else if (wind === 'in') {
    add(under, comp('weather', 'Weather and park environment', 5, 'wind blowing in confirmed at game time', { max: 5 }));
  } else if (indoor === true) {
    add(neutral, comp('weather', 'Weather and park environment', 0, 'dome or neutral conditions', { max: 5 }));
  } else {
    missing.push('wind direction at game time (outdoor venue — no key-less feed publishes wind direction or speed)');
    add(neutral, comp('weather', 'Weather and park environment', 0, 'outdoor venue, wind direction not sourced', { max: 5, missing: true }));
  }

  const overScore = over.reduce((a, c) => a + c.points, 0);
  const underScore = under.reduce((a, c) => a + c.points, 0);
  return { over, under, neutral, overScore, underScore, combined: overScore + underScore };
}

/* ------------------------------------------------------------------ *
 * Step 3 — decision rules
 * ------------------------------------------------------------------ */

export function decideWinMatch(winSide, opponent) {
  const score = winSide?.score ?? 0;
  const heavyFav = (winSide?.american ?? null) != null && winSide.american <= -300;
  const spMax = winSide?.starterMax === true;
  const runDiffHigh = (winSide?.runDiffPerGame ?? 0) > 2.5;

  if (heavyFav && !(spMax && runDiffHigh)) {
    return { confidence: CONFIDENCE.SKIP, reason: 'a heavy favourite at -300 or shorter without both a maximum starter score and a run differential above +2.5 does not justify the risk' };
  }
  if (score >= 70) return { confidence: CONFIDENCE.HIGH, reason: `win match score ${score} is 70 or higher` };
  if (score >= 55 && winSide?.strongFactors >= 2) {
    return { confidence: CONFIDENCE.MEDIUM, reason: `win match score ${score} with ${winSide.strongFactors} factors strongly aligned` };
  }
  if (score >= 55) {
    return { confidence: CONFIDENCE.SKIP, reason: `win match score ${score} is between 55 and 69 but fewer than 2 factors are strongly aligned` };
  }
  return { confidence: CONFIDENCE.SKIP, reason: `win match score ${score} is below 55` };
}

export function decideRunLine(score, winScore, supportsCovering, { underdogStarter = null, underdogBullpenSupports = null } = {}) {
  if (winScore < 60) return { confidence: CONFIDENCE.SKIP, reason: `win match score ${winScore} is below the 60 activation floor` };
  if (!supportsCovering) return { confidence: CONFIDENCE.SKIP, reason: 'the average winning margin in the last 5 wins is below 2 runs, so the favourite cannot cover -1.5 reliably' };
  if (score >= 70) return { confidence: CONFIDENCE.HIGH, reason: `run line score ${score} is 70 or higher` };
  if (score >= 55) return { confidence: CONFIDENCE.MEDIUM, reason: `run line score ${score} is between 55 and 69` };
  // Independent +1.5 underdog route.
  if (underdogStarter != null && underdogStarter >= 17 && underdogBullpenSupports === true) {
    return { confidence: CONFIDENCE.MEDIUM, reason: 'the +1.5 underdog has a starter at 17 or higher and a bullpen that supports it' };
  }
  return { confidence: CONFIDENCE.SKIP, reason: `run line score ${score} is below 55 and the underdog route is not supported` };
}

export function decideTotal(total) {
  const advantage = Math.abs(total.overScore - total.underScore);
  const side = total.overScore > total.underScore ? 'OVER' : total.underScore > total.overScore ? 'UNDER' : null;
  if (!side) return { side: null, confidence: CONFIDENCE.SKIP, reason: 'the Over and Under ledgers are tied, so no direction is clear' };
  if (advantage >= 20) return { side, confidence: CONFIDENCE.HIGH, reason: `directional advantage of ${advantage} points favours ${side}` };
  if (advantage >= 15) return { side, confidence: CONFIDENCE.MEDIUM, reason: `directional advantage of ${advantage} points favours ${side}` };
  return { side: null, confidence: CONFIDENCE.SKIP, reason: `directional advantage of ${advantage} points is below 15 — no clear direction` };
}

/* ------------------------------------------------------------------ *
 * Match + card scoring
 * ------------------------------------------------------------------ */

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

export function scoreBaseballMatch(match) {
  const home = match?.home ?? {};
  const away = match?.away ?? {};
  const missing = [];

  if (!home?.name || !away?.name) {
    return {
      id: match?.id ?? null,
      league: match?.league ?? null,
      dateISO: match?.dateISO ?? match?.date ?? null,
      unscored: true,
      reason: 'match is missing one or both competitor names',
      missing: ['competitor names'],
    };
  }

  const h2h = match?.h2h ?? null;
  const homeWin = scoreWinMatchSide(home, away, h2h, missing);
  const awayWin = scoreWinMatchSide(away, home, h2h ? { ...h2h, winsA: h2h.winsB, winsB: h2h.winsA, last10WinsA: h2h.last10WinsB, last10WinsB: h2h.last10WinsA, last3StreakA: h2h.last3StreakB, last3StreakB: h2h.last3StreakA } : null, missing);

  const pickSide = homeWin.score >= awayWin.score ? 'home' : 'away';
  const fav = pickSide === 'home' ? home : away;
  const dog = pickSide === 'home' ? away : home;
  const favWin = pickSide === 'home' ? homeWin : awayWin;
  const dogWin = pickSide === 'home' ? awayWin : homeWin;

  const favRunLine = scoreRunLineSide(fav, dog, favWin, h2h, missing);
  const dogRunLine = scoreRunLineSide(dog, fav, dogWin, h2h, missing);

  const total = scoreTotalMarket(match, missing);

  const winDecision = decideWinMatch(favWin, dogWin);
  const supportsCovering = favRunLine.supportsCovering;
  const runLineDecision = decideRunLine(favRunLine.score, favWin.score, supportsCovering, {
    underdogStarter: dogWin.starterScore,
    underdogBullpenSupports: dog?.bullpenRank != null && dog.bullpenRank <= (dog?.bullpenLeagueSize ?? 30) - 10,
  });
  const totalDecision = decideTotal(total);

  const underdogValue = dogWin.underdogValue
    || ((dog?.odds?.american ?? null) != null && dog.odds.american > 0
      && (dog?.runDiffPerGame ?? null) != null && dog.runDiffPerGame > 0);

  const allMissing = uniq(missing);

  return {
    id: match?.id ?? null,
    league: match?.league ?? null,
    leagueName: match?.leagueName ?? null,
    dateISO: match?.dateISO ?? match?.date ?? null,
    startUtc: match?.startUtc ?? null,
    phase: match?.phase ?? 'upcoming',
    home: sideProfile(home),
    away: sideProfile(away),
    selection: pickSide,
    favoured: fav?.name ?? null,
    dog: dog?.name ?? null,
    // Sourced head-to-head from the results tape, carried through so the writer
    // can cite it. Null when the two clubs have no prior meeting in the window.
    h2h: h2h ?? null,
    odds: {
      provider: fav?.odds?.provider ?? null,
      favouriteAmerican: fav?.odds?.american ?? null,
      dogAmerican: dog?.odds?.american ?? null,
      sourceCount: match?.oddsSourceCount ?? null,
    },
    winMatch: {
      favourite: favWin,
      underdog: dogWin,
      decision: winDecision,
    },
    runLine: {
      favourite: favRunLine,
      underdog: dogRunLine,
      decision: runLineDecision,
      supportsCovering,
    },
    total: {
      over: total.over,
      under: total.under,
      neutral: total.neutral,
      overScore: total.overScore,
      underScore: total.underScore,
      decision: totalDecision,
    },
    underdogValue,
    missing: allMissing,
  };
}

/**
 * The public, writer-facing view of a side.
 *
 * The writer builds its prose only from what appears here, so every field
 * carried through must be a sourced value (MLB StatsAPI standings / team stats /
 * pitcher game logs / results tape — see engine/baseball_data.js
 * enrichBaseballFixture). Fields absent from the feed stay null and the
 * corresponding clause is simply never written.
 */
function sideProfile(side) {
  return {
    name: side?.name ?? null,
    abbrev: side?.abbrev ?? null,
    record: side?.record ?? null,
    recordSummary: side?.recordSummary ?? null,
    runDiffPerGame: side?.runDiffPerGame ?? null,
    starterScore: null,
    bullpenRank: side?.bullpenRank ?? null,
    // Carried through for the tip writer. All sourced, none derived.
    form: side?.form ?? null,
    seasonRunDiffPerGame: side?.seasonRunDiffPerGame ?? null,
    runsPerGameRecent: side?.runsPerGameRecent ?? null,
    runsAgainstPerGameRecent: side?.runsAgainstPerGameRecent ?? null,
    seasonRunsPerGame: side?.seasonRunsPerGame ?? null,
    seasonRunsAgainstPerGame: side?.seasonRunsAgainstPerGame ?? null,
    teamEra: side?.teamEra ?? null,
    teamWhip: side?.teamWhip ?? null,
    avgWinMarginLast5Wins: side?.avgWinMarginLast5Wins ?? null,
    starter: side?.starter ?? null,
  };
}

export function scoreBaseballCard(matches) {
  const results = (matches || []).map((m) => scoreBaseballMatch(m));
  return {
    prompt: PROMPT_NAME,
    ruleset: RULESET_VERSION,
    results,
  };
}
