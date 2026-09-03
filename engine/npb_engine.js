/**
 * SportsPred — NPB Scoring Engine (canonical implementation).
 *
 * Implements "NPB BASEBALL PREDICTION MASTER PROMPT v1.0" Step 2 (three
 * markets plus a draw likelihood assessment, 100 points each) and Step 3
 * (decision rules):
 *
 *   WIN MATCH — HOME OR AWAY (100)      DRAW LIKELIHOOD (100, independent)
 *   RUN LINE +1.5 / -1.5 (100)          GAME TOTAL OVER/UNDER (100)
 *
 * RULES OF THIS MODULE (identical to every other engine in this repo):
 *  - Pure functions. No I/O, no network, no clock, no randomness.
 *  - Every input may be null. A factor that was not sourced is NEVER guessed:
 *    it is pushed to `missing[]`, its component is marked `missing: true`, and
 *    the confidence gates in Step 3 apply to whatever WAS sourced. This is how
 *    "no hallucinations" is enforced rather than promised.
 *  - Every point is traceable: { id, label, points, max, detail }.
 *  - Imported directly by the browser page AND by the Node test suite.
 *
 * NPB-SPECIFIC STRUCTURE (from the prompt's NPB-SPECIFIC ADJUSTMENTS):
 *  - A draw is a real outcome (regular-season games are capped at 12 innings
 *    and end level if unresolved), so `scoreDrawLikelihood` runs on every
 *    match and can become the primary selection in the WIN slot.
 *  - Head-to-head separates same-league meetings (primary) from interleague /
 *    Japan Series meetings (supplementary, lower confidence, never primary).
 *  - The designated hitter status and the foreign-player registration are
 *    carried on the match as sourced context; neither adds points (the prompt
 *    assigns none) but both are shown in the analysis so lineup-depth reading
 *    is done against the right rule set.
 *  - Weather only applies at open-air venues; enclosed and retractable-roof
 *    venues zero the weather block before any total threshold is computed.
 *
 * HONESTLY RECORDED GAPS (see docs/NPB_IRREGULARITIES.md):
 *  - No key-less three-way moneyline / run line / total feed exists for NPB,
 *    so the Odds and Value block, the underdog value flag, the heavy-favourite
 *    gate and the Over/Under trend block are recorded as missing.
 *  - Opposing-lineup splits against a starter's handedness are not published
 *    by npb.jp; the +5 bonus is recorded as missing.
 *  - Wind direction/speed is not published; only the schedule page's forecast
 *    icon (rain / cloudy / sunny) is sourced, which is exactly the input the
 *    NPB prompt asks to weight ("rain probability ... more so than
 *    wind-driven totals").
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';
export const PROMPT_NAME = 'NPB BASEBALL PREDICTION MASTER PROMPT v1.0';

export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' };
export const MARKETS = { WIN: 'win_match', RUN_LINE: 'run_line', TOTAL: 'game_total' };

/**
 * Seasonal weather windows (hyperparameters, stated in docs/NPB_PROMPT_REVIEW.md).
 * The prompt names "the early-summer rainy season and the later typhoon
 * season" without dates. These approximate the Japan Meteorological Agency's
 * climatology for the main-island NPB cities: tsuyu roughly early June to
 * mid/late July; typhoon landfall risk concentrated August–early October.
 */
export const RAINY_SEASON = { from: '06-01', to: '07-20' };
export const TYPHOON_SEASON = { from: '08-01', to: '10-15' };

const round = (n, dp = 4) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

/** Which seasonal window (if any) a date falls in. */
export function seasonWindow(dateISO) {
  const md = String(dateISO || '').slice(5, 10);
  if (!/^\d{2}-\d{2}$/.test(md)) return null;
  if (md >= RAINY_SEASON.from && md <= RAINY_SEASON.to) return 'rainy';
  if (md >= TYPHOON_SEASON.from && md <= TYPHOON_SEASON.to) return 'typhoon';
  return null;
}

/** The forecast strings the collector records that count as elevated rain risk. */
/**
 * Evidence floors (hyperparameters, docs/NPB_PROMPT_REVIEW.md C-4/C-5).
 * A market verdict is only issued when enough of its 100 points were actually
 * sourced; otherwise the market is SKIPPED with the coverage stated. This is
 * the mechanical form of "never guess": an Under built on one 20-point block
 * with 80 points unsourced is not a HIGH-confidence read.
 */
export const MIN_SOURCED_POINTS_TOTAL = 60;
export const MIN_SOURCED_POINTS_WIN = 60;
export const MIN_STARTS_FOR_RATING = 2;

export const RAIN_FORECASTS = ['rain', 'rain with breaks', 'rain then cloudy', 'rain then sunny', 'cloudy with rain', 'sunny then rain'];

/* ------------------------------------------------------------------ *
 * Starter rating — shared by the WIN, DRAW, RUN LINE and TOTAL blocks.
 *
 * "strong"       confirmed, 2+ quality starts in the last 4 outings     (25)
 * "solid"        confirmed, at least 1 quality start in the last 3      (17)
 * "inconsistent" confirmed, sourced log, neither of the above           (9)
 * "poor"         confirmed, last 4 average 5+ runs allowed or <4 IP     (0)
 * null           unconfirmed, or confirmed with no sourced log (missing)
 *
 * A quality start is 6+ innings with 3 or fewer earned runs, derived from
 * the sourced box-score lines, never assumed.
 * ------------------------------------------------------------------ */
export function rateStarter(sp) {
  if (!sp) return { rating: null, reason: 'no starter named' };
  if (sp.confirmed === false) return { rating: 'unconfirmed', reason: 'starter not announced' };
  const log = Array.isArray(sp.last4) ? sp.last4 : [];
  const qs4 = typeof sp.qualityStartsLast4 === 'number' ? sp.qualityStartsLast4 : null;
  const qs3 = typeof sp.qualityStartsLast3 === 'number' ? sp.qualityStartsLast3 : null;
  if (!log.length && qs4 == null && qs3 == null) return { rating: null, reason: 'announced starter has no sourced recent starts' };
  if (log.length && log.length < MIN_STARTS_FOR_RATING) return { rating: null, reason: `only ${log.length} sourced start on record (minimum ${MIN_STARTS_FOR_RATING})` };
  const avgRuns = log.length ? log.reduce((a, s) => a + (s.runs ?? s.er ?? 0), 0) / log.length : null;
  const avgIp = log.length ? log.reduce((a, s) => a + (s.ip ?? 0), 0) / log.length : null;
  if (qs4 != null && qs4 >= 2) return { rating: 'strong', reason: `${qs4} quality starts in the last ${Math.min(4, log.length || 4)}` };
  if (qs3 != null && qs3 >= 1) return { rating: 'solid', reason: `${qs3} quality start${qs3 === 1 ? '' : 's'} in the last ${Math.min(3, log.length || 3)}` };
  if (avgRuns != null && (avgRuns >= 5 || (avgIp != null && avgIp < 4))) {
    return { rating: 'poor', reason: `averaging ${round(avgRuns, 1)} runs allowed and ${round(avgIp, 1)} innings over the last ${log.length}` };
  }
  return { rating: 'inconsistent', reason: `no quality start in the last ${log.length || 3}` };
}

/* ------------------------------------------------------------------ *
 * Step 2a — WIN MATCH — HOME OR AWAY (100pts)
 * ------------------------------------------------------------------ */

/**
 * Recent Form — last month double weighted (25pts).
 *   Won 4+ of last 5 = 25 | 3 = 16 | 2 = 7 | 1 or fewer = 0
 *   +5 winning streak of 4+ consecutive games | +4 opponent lost 4+ of last 5
 * A draw ('D') is neither a win nor a loss and breaks a winning streak.
 * NOTE (C-1, documented): the "last two weeks weighted double" instruction has
 * no numerical table; the win-count table is implemented as written.
 */
export function scoreRecentForm(team, opponent, missing) {
  const out = [];
  const last5 = team?.form?.last5;
  if (!Array.isArray(last5) || last5.length < 5) {
    missing.push('form.last5 (last 5 results including draws)');
    out.push(comp('form', 'Recent Form — last month double weighted', 0, 'fewer than 5 sourced results', { max: 25, missing: true }));
    return { components: out, base: 0, wins: null };
  }
  const five = last5.slice(0, 5);
  const wins = five.filter((r) => r === 'W').length;
  const draws = five.filter((r) => r === 'D').length;
  const base = wins >= 4 ? 25 : wins === 3 ? 16 : wins === 2 ? 7 : 0;
  out.push(comp('form', 'Recent Form — last month double weighted', base, `${wins}/5 wins${draws ? `, ${draws} drawn` : ''}`, { max: 25 }));

  let streak = typeof team?.form?.winStreak === 'number' ? team.form.winStreak : null;
  if (streak == null) { streak = 0; for (const r of last5) { if (r === 'W') streak += 1; else break; } }
  if (streak >= 4) out.push(comp('form_streak', 'Bonus: winning streak of 4 or more', 5, `current streak ${streak}`, { max: 5 }));

  const opp5 = opponent?.form?.last5;
  if (!Array.isArray(opp5) || opp5.length < 5) {
    missing.push('opponent.form.last5 (needed for the opponent-collapse bonus)');
  } else {
    const oppLosses = opp5.slice(0, 5).filter((r) => r === 'L').length;
    if (oppLosses >= 4) out.push(comp('form_opp_collapse', 'Bonus: opponent lost 4 or more of their last 5', 4, `opponent lost ${oppLosses}/5`, { max: 4 }));
  }
  return { components: out, base, wins };
}

/**
 * Starting Pitcher Quality (25pts).
 *   strong = 25 | solid = 17 | inconsistent = 9 | poor or unconfirmed = 0
 *   +5 opposing lineup has struggled vs this handedness in the last 30 days
 *   −8 pitching on unusually short rest for THIS staff's normal pattern
 */
export function scoreStartingPitcher(team, opponent, missing) {
  const out = [];
  const sp = team?.starter ?? null;
  const rated = rateStarter(sp);
  if (rated.rating === null) {
    missing.push(sp ? `starter.last4 (${rated.reason})` : 'starter (confirmed starting pitcher with last 4 starts)');
    out.push(comp('starter', 'Starting Pitcher Quality', 0, rated.reason, { max: 25, missing: true }));
    return { components: out, score: 0, rating: null };
  }
  const pts = { strong: 25, solid: 17, inconsistent: 9, poor: 0, unconfirmed: 0 }[rated.rating] ?? 0;
  out.push(comp('starter', 'Starting Pitcher Quality', pts, `${rated.rating} — ${rated.reason}`, { max: 25 }));

  const oppVs = opponent?.vsStarterHandednessAvg ?? null;
  if (rated.rating !== 'unconfirmed') {
    if (oppVs == null) missing.push('opponent.vsStarterHandednessAvg (opposing lineup vs this handedness, last 30 days — not published by npb.jp)');
    else if (oppVs < 0.235) out.push(comp('starter_split', 'Bonus: opposing lineup has struggled against this handedness', 5, `opponent ${round(oppVs, 3)} vs handedness`, { max: 5 }));
  }

  if (rated.rating !== 'unconfirmed') {
    if (sp.shortRest === true) {
      out.push(comp('starter_rest', 'Deduction: unusually short rest for this staff', -8, sp.restDetail || 'short rest versus the staff pattern', { max: 0 }));
    } else if (sp.shortRest == null) {
      missing.push('starter.shortRest (days since last start vs this staff\'s normal pattern)');
    }
  }
  return { components: out, score: pts, rating: rated.rating };
}

/**
 * Run Differential Value (20pts) — last month.
 *   > +2.5 = 20 | +1.5 to +2.4 = 13 | 0 to +1.4 = 7 | negative = 0
 *   +4 opponent negative over the same period
 */
export function scoreRunDifferential(team, opponent, missing) {
  const out = [];
  const diff = team?.runDiffPerGame ?? null;
  if (diff == null) {
    missing.push('runDiffPerGame (runs scored minus allowed per game, last month)');
    out.push(comp('rundiff', 'Run Differential Value', 0, 'no sourced last-month run differential', { max: 20, missing: true }));
    return { components: out };
  }
  const pts = diff > 2.5 ? 20 : diff >= 1.5 ? 13 : diff >= 0 ? 7 : 0;
  out.push(comp('rundiff', 'Run Differential Value', pts, `${diff >= 0 ? '+' : ''}${round(diff, 2)} per game over the last month`, { max: 20 }));
  const opp = opponent?.runDiffPerGame ?? null;
  if (opp == null) missing.push('opponent.runDiffPerGame');
  else if (opp < 0) out.push(comp('rundiff_opp', 'Bonus: opponent carries a negative run differential', 4, `opponent ${round(opp, 2)} per game`, { max: 4 }));
  return { components: out };
}

/**
 * Odds and Value Assessment (20pts) — three-way moneyline.
 *   −200 or lower = 20 | −150 to −199 = 14 | −100 to −149 = 9
 *   underdog with positive odds AND run differential advantage AND superior
 *   recent form = 14 (primary value play flag)
 *   −8 if shorter than −250 but the starter is unconfirmed or the bullpen is
 *   heavily fatigued
 * There is no key-less NPB price feed, so on a live card this block is missing.
 */
export function scoreOddsAndValue(team, opponent, formWins, missing) {
  const out = [];
  const american = team?.odds?.american ?? null;
  if (american == null) {
    missing.push('odds.moneyline (three-way price cross-referenced from at least two books — no key-less NPB feed)');
    out.push(comp('odds', 'Odds and Value Assessment', 0, 'no sourced price', { max: 20, missing: true }));
    return { components: out, american: null, underdogValue: false };
  }
  let pts = 0; let underdogValue = false; let detail = `American ${american}`;
  if (american <= -200) pts = 20;
  else if (american <= -150) pts = 14;
  else if (american <= -100) pts = 9;
  else if (american > 0) {
    const rdEdge = team?.runDiffPerGame != null && opponent?.runDiffPerGame != null && team.runDiffPerGame > opponent.runDiffPerGame;
    const oppWins = Array.isArray(opponent?.form?.last5) ? opponent.form.last5.slice(0, 5).filter((r) => r === 'W').length : null;
    const formEdge = typeof formWins === 'number' && oppWins != null && formWins > oppWins;
    if (rdEdge && formEdge) { pts = 14; underdogValue = true; detail += ' — underdog with a run differential advantage and superior form (primary value play)'; }
    else detail += ' — plus price without both a run differential advantage and superior form';
  }
  out.push(comp('odds', 'Odds and Value Assessment', pts, detail, { max: 20 }));
  if (american <= -250 && (team?.starter?.confirmed === false || team?.bullpen?.fatigued === true)) {
    out.push(comp('odds_deduction', 'Deduction: shorter than −250 with an unconfirmed starter or a fatigued bullpen', -8, '', { max: 0 }));
  }
  return { components: out, american, underdogValue };
}

/**
 * Head-to-Head Record (10pts) — same-league meetings only.
 *   Won 6+ of last 10 = 10 | 5 = 6 | trailing = 2
 * Interleague / Japan Series meetings are reported as a supplementary note
 * and never score. Draws in the window are shown but count for neither side.
 */
export function scoreHeadToHead(team, h2h, missing) {
  const out = [];
  const same = h2h?.sameLeague ?? null;
  if (!same || same.meetings == null || same.meetings === 0 || same.winsA == null) {
    const inter = h2h?.interleague;
    const note = inter?.meetings ? ` (only ${inter.meetings} interleague meeting${inter.meetings === 1 ? '' : 's'} sourced — supplementary, not scored)` : '';
    missing.push(`h2h.sameLeague (same-league head-to-head over the last 3 years)${note}`);
    out.push(comp('h2h', 'Head-to-Head Record (same league)', 0, `no same-league meetings sourced${note}`, { max: 10, missing: true }));
    return { components: out };
  }
  const n = Math.min(same.meetings, 10);
  const wins = same.last10WinsA ?? same.winsA;
  const losses = same.last10WinsB ?? same.winsB ?? (n - wins - (same.draws ?? 0));
  const pts = wins >= 6 ? 10 : wins === 5 ? 6 : 2;
  out.push(comp('h2h', 'Head-to-Head Record (same league)', pts, `${wins}-${losses}${same.draws ? `-${same.draws}` : ''} in the last ${n} same-league meetings${same.window ? ` (${same.window})` : ''}`, { max: 10 }));
  if (h2h?.interleague?.meetings) {
    out.push(comp('h2h_inter', 'Supplementary: interleague / Japan Series meetings', 0, `${h2h.interleague.winsA}-${h2h.interleague.winsB}${h2h.interleague.draws ? `-${h2h.interleague.draws}` : ''} in ${h2h.interleague.meetings} cross-league meetings — lower-confidence, not scored`, { max: 0 }));
  }
  return { components: out };
}

const sum = (cs) => cs.reduce((a, c) => a + c.points, 0);
/* Share of the 100 base points whose input was actually sourced. Only the five
 * base blocks count; bonuses and deductions never inflate the figure. */
const WIN_BASE_IDS = new Set(['form', 'starter', 'rundiff', 'odds', 'h2h']);
const TOTAL_BASE_IDS = new Set(['offense', 'starters', 'bullpen', 'trends', 'weather']);
const sourcedMax = (cs, ids) => cs.filter((c) => ids.has(c.id) && !c.missing && c.max > 0).reduce((a, c) => a + c.max, 0);

export function scoreWinMatchSide(team, opponent, h2h, missing) {
  const form = scoreRecentForm(team, opponent, missing);
  const starter = scoreStartingPitcher(team, opponent, missing);
  const rd = scoreRunDifferential(team, opponent, missing);
  const odds = scoreOddsAndValue(team, opponent, form.wins, missing);
  const hh = scoreHeadToHead(team, h2h, missing);
  const components = [...form.components, ...starter.components, ...rd.components, ...odds.components, ...hh.components];
  const score = clamp(sum(components), 0, 100);
  const strong = components.filter((c) => !c.missing && c.max > 0 && c.points >= Math.ceil(c.max * 0.8)).length;
  return {
    score, components, strongFactors: strong, wins: form.wins, sourcedPoints: sourcedMax(components, WIN_BASE_IDS),
    starterScore: starter.score, starterRating: starter.rating, starterMax: starter.score === 25,
    underdogValue: odds.underdogValue, american: odds.american,
    runDiffPerGame: team?.runDiffPerGame ?? null,
    nonH2H: components.filter((c) => !c.id.startsWith('h2h')),
  };
}

/* ------------------------------------------------------------------ *
 * Step 2b — DRAW LIKELIHOOD ASSESSMENT (100pts, independent)
 *   Both confirmed starters strong                     = 30
 *   Both bullpens effective and unfatigued (3 days)    = 25
 *   Run differential gap under 1.0 per game            = 20
 *   Either team's draw rate above the league norm      = 15
 *   Same-league, recent close low-scoring meetings     = 10
 * ------------------------------------------------------------------ */
export function scoreDrawLikelihood(match, homeRating, awayRating, missing) {
  const out = [];
  const home = match?.home ?? {}; const away = match?.away ?? {};

  if (homeRating == null || awayRating == null) {
    out.push(comp('draw_starters', 'Both confirmed starters in strong recent form', 0, 'one or both starters not sourced', { max: 30, missing: true }));
  } else if (homeRating === 'strong' && awayRating === 'strong') {
    out.push(comp('draw_starters', 'Both confirmed starters in strong recent form', 30, 'both rated strong', { max: 30 }));
  } else {
    out.push(comp('draw_starters', 'Both confirmed starters in strong recent form', 0, `${homeRating} vs ${awayRating}`, { max: 30 }));
  }

  const hb = home.bullpen ?? null; const ab = away.bullpen ?? null;
  if (!hb || !ab || hb.effective == null || ab.effective == null || hb.fatigued == null || ab.fatigued == null) {
    missing.push('bullpen (effectiveness and usage over the last 3 days, both teams)');
    out.push(comp('draw_bullpens', 'Both bullpens effective and unfatigued', 0, 'bullpen usage not sourced', { max: 25, missing: true }));
  } else if (hb.effective && ab.effective && !hb.fatigued && !ab.fatigued) {
    out.push(comp('draw_bullpens', 'Both bullpens effective and unfatigued', 25, 'both effective and rested', { max: 25 }));
  } else {
    out.push(comp('draw_bullpens', 'Both bullpens effective and unfatigued', 0, `${hb.effective && !hb.fatigued ? 'one' : 'neither'} side qualifies`, { max: 25 }));
  }

  if (home.runDiffPerGame == null || away.runDiffPerGame == null) {
    out.push(comp('draw_gap', 'Run differential gap under 1.0 per game', 0, 'run differential not sourced for both sides', { max: 20, missing: true }));
  } else {
    const gap = Math.abs(home.runDiffPerGame - away.runDiffPerGame);
    out.push(comp('draw_gap', 'Run differential gap under 1.0 per game', gap < 1.0 ? 20 : 0, `gap ${round(gap, 2)} per game`, { max: 20 }));
  }

  const norm = match?.leagueDrawRate ?? null;
  if (home.drawRate == null || away.drawRate == null || norm == null) {
    missing.push('drawRate (season draw rate per team and league norm)');
    out.push(comp('draw_rate', 'Either team\'s draw rate above the league norm', 0, 'draw rates not sourced', { max: 15, missing: true }));
  } else if (home.drawRate > norm || away.drawRate > norm) {
    out.push(comp('draw_rate', 'Either team\'s draw rate above the league norm', 15, `${round(home.drawRate * 100, 1)}% / ${round(away.drawRate * 100, 1)}% vs norm ${round(norm * 100, 1)}%`, { max: 15 }));
  } else {
    out.push(comp('draw_rate', 'Either team\'s draw rate above the league norm', 0, `${round(home.drawRate * 100, 1)}% / ${round(away.drawRate * 100, 1)}% vs norm ${round(norm * 100, 1)}%`, { max: 15 }));
  }

  const close = match?.h2h?.sameLeague?.recentClose ?? null;
  if (match?.league === 'interleague') {
    out.push(comp('draw_h2h', 'Same-league matchup with recent close, low-scoring meetings', 0, 'interleague fixture — block does not apply', { max: 10 }));
  } else if (close == null) {
    out.push(comp('draw_h2h', 'Same-league matchup with recent close, low-scoring meetings', 0, 'recent same-league meetings not sourced', { max: 10, missing: true }));
  } else {
    out.push(comp('draw_h2h', 'Same-league matchup with recent close, low-scoring meetings', close.qualifies ? 10 : 0, close.detail, { max: 10 }));
  }

  return { score: clamp(sum(out), 0, 100), components: out };
}

/* ------------------------------------------------------------------ *
 * Step 2c — RUN LINE +1.5 / -1.5 (100pts)
 *   Base = win-match blocks with head-to-head REPLACED by run-margin analysis
 *   (avg margin in recent wins ≥3 = 20 | 2–2.9 = 12 | <2 = 0), then:
 *   +10 starter strong AND 6+ innings per start (−1.5 side)
 *   +8  effective bullpen (−1.5) / fatigued or shallow bullpen → +8 for the +1.5 side
 *   +8  run differential above +2.0 per game
 *   Never −1.5 when the average winning margin in the last 5 wins is below 2.
 * ------------------------------------------------------------------ */
export function scoreRunLineSide(team, opponent, winSide, missing) {
  const components = [...(winSide?.nonH2H || [])];
  const margin = team?.avgWinMarginLast5Wins ?? null;
  let supportsCovering = null;
  if (margin == null) {
    missing.push('avgWinMarginLast5Wins (average margin in the last 5 wins)');
    components.push(comp('margin', 'Run margin analysis', 0, 'no sourced win margins', { max: 20, missing: true }));
  } else {
    const pts = margin >= 3 ? 20 : margin >= 2 ? 12 : 0;
    supportsCovering = margin >= 2;
    components.push(comp('margin', 'Run margin analysis', pts, `average margin ${round(margin, 2)} in recent wins`, { max: 20 }));
  }
  const sp = team?.starter;
  if (winSide?.starterRating === 'strong' && sp?.avgInningsPerStart != null) {
    if (sp.avgInningsPerStart >= 6) components.push(comp('rl_starter', 'Starter dominance: strong form with 6+ innings per start', 10, `${round(sp.avgInningsPerStart, 1)} innings per start`, { max: 10 }));
  }
  const bp = team?.bullpen ?? null;
  if (bp?.effective === true && bp?.fatigued === false) components.push(comp('rl_bullpen', 'Bullpen quality: effective bullpen closes games efficiently', 8, bp.detail || 'effective and rested', { max: 8 }));
  const oppBp = opponent?.bullpen ?? null;
  if (oppBp?.fatigued === true || oppBp?.shallow === true) components.push(comp('rl_opp_bullpen', 'Opponent bullpen fatigued or shallow bleeds late runs', 8, oppBp.detail || 'opponent bullpen fatigued', { max: 8 }));
  if ((team?.runDiffPerGame ?? null) != null && team.runDiffPerGame > 2.0) components.push(comp('rl_rundiff', 'Run differential above +2.0 covers at a higher rate', 8, `${round(team.runDiffPerGame, 2)} per game`, { max: 8 }));
  const raw = sum(components);
  return { score: clamp(raw, 0, 100), rawScore: raw, components, supportsCovering, avgWinMargin: margin };
}

/* ------------------------------------------------------------------ *
 * Step 2d — GAME TOTAL OVER/UNDER (100pts) — Over ledger vs Under ledger
 * ------------------------------------------------------------------ */
export function scoreTotalMarket(match, homeRating, awayRating, missing) {
  const over = []; const under = []; const neutral = [];
  const home = match?.home ?? {}; const away = match?.away ?? {};
  const add = (ledger, c) => ledger.push(c);

  // Combined offensive output (35)
  const hR = home.runsPerGameRecent ?? null; const aR = away.runsPerGameRecent ?? null;
  if (hR == null || aR == null) {
    missing.push('runsPerGameRecent (runs scored per game over the last month, both teams)');
    add(neutral, comp('offense', 'Combined offensive output', 0, 'runs per game not sourced for both teams', { max: 35, missing: true }));
  } else if (hR >= 5 && aR >= 5) add(over, comp('offense', 'Combined offensive output', 35, `both average 5+ (${round(hR, 2)} / ${round(aR, 2)})`, { max: 35 }));
  else if ((hR >= 5 && aR >= 4) || (aR >= 5 && hR >= 4)) add(over, comp('offense', 'Combined offensive output', 22, `one averages 5+, the other 4–4.9 (${round(hR, 2)} / ${round(aR, 2)})`, { max: 35 }));
  else if (hR < 3.5 || aR < 3.5) add(under, comp('offense', 'Combined offensive output', 20, `one or both below 3.5 (${round(hR, 2)} / ${round(aR, 2)})`, { max: 35 }));
  else if (hR >= 4 && aR >= 4) add(neutral, comp('offense', 'Combined offensive output', 12, `both 4–4.9 (${round(hR, 2)} / ${round(aR, 2)}) — neutral`, { max: 35 }));
  else add(neutral, comp('offense', 'Combined offensive output', 0, `${round(hR, 2)} / ${round(aR, 2)} — between the defined bands`, { max: 35 }));

  // Starting pitcher run suppression (25)
  const strongOrBetter = (r) => r === 'strong';
  const struggling = (r) => r === 'poor' || r === 'inconsistent';
  if (homeRating === 'unconfirmed' || awayRating === 'unconfirmed') {
    add(over, comp('starters', 'Starting pitcher run suppression', 12, 'one or both starters unconfirmed — no reliable stopper', { max: 25 }));
  } else if (homeRating == null || awayRating == null) {
    add(neutral, comp('starters', 'Starting pitcher run suppression', 0, 'one or both starters have no sourced recent starts', { max: 25, missing: true }));
  } else if (strongOrBetter(homeRating) && strongOrBetter(awayRating)) add(under, comp('starters', 'Starting pitcher run suppression', 25, 'both starters in strong recent form', { max: 25 }));
  else if (struggling(homeRating) && struggling(awayRating)) add(over, comp('starters', 'Starting pitcher run suppression', 25, 'both starters struggling recently', { max: 25 }));
  else if ((strongOrBetter(homeRating) && struggling(awayRating)) || (strongOrBetter(awayRating) && struggling(homeRating))) add(neutral, comp('starters', 'Starting pitcher run suppression', 10, 'one strong, one struggling — neutral lean Over', { max: 25 }));
  else add(neutral, comp('starters', 'Starting pitcher run suppression', 0, `${homeRating} vs ${awayRating} — no band applies`, { max: 25 }));

  // Bullpen and late-inning run environment (20)
  const hb = home.bullpen ?? null; const ab = away.bullpen ?? null;
  if (!hb || !ab || hb.effective == null || ab.effective == null) {
    add(neutral, comp('bullpen', 'Bullpen and late-inning run environment', 0, 'bullpen usage not sourced', { max: 20, missing: true }));
  } else {
    const weak = (b) => b.fatigued === true || b.effective === false;
    const strong = (b) => b.effective === true && b.fatigued === false;
    if (weak(hb) && weak(ab)) add(over, comp('bullpen', 'Bullpen and late-inning run environment', 20, 'both bullpens fatigued or underperforming', { max: 20 }));
    else if (strong(hb) && strong(ab)) add(under, comp('bullpen', 'Bullpen and late-inning run environment', 18, 'both bullpens effective and rested', { max: 20 }));
    else if ((strong(hb) && weak(ab)) || (strong(ab) && weak(hb))) add(neutral, comp('bullpen', 'Bullpen and late-inning run environment', 10, 'one strong, one weak — neutral', { max: 20 }));
    else add(neutral, comp('bullpen', 'Bullpen and late-inning run environment', 0, 'no band applies', { max: 20 }));
  }

  // Recent total trends (15) — needs a posted line
  const hT = home.recentTotals ?? null; const aT = away.recentTotals ?? null;
  if (!hT || !aT) {
    missing.push('recentTotals (Over/Under record over the last 5 — requires a posted total line, none is key-less for NPB)');
    add(neutral, comp('trends', 'Recent total trends', 0, 'no posted total line, so trends cannot be measured', { max: 15, missing: true }));
  } else if (hT.overs >= 4 && aT.overs >= 4) add(over, comp('trends', 'Recent total trends', 15, 'both Over in 4 of last 5', { max: 15 }));
  else if (hT.overs >= 3 && aT.overs >= 3) add(over, comp('trends', 'Recent total trends', 9, 'both Over in 3 of last 5', { max: 15 }));
  else if (hT.unders >= 3 && aT.unders >= 3) add(under, comp('trends', 'Recent total trends', 14, 'both Under in 3+ of last 5', { max: 15 }));
  else add(neutral, comp('trends', 'Recent total trends', 4, 'mixed', { max: 15 }));

  // Venue and weather modifier (5)
  const roof = match?.roof ?? null;
  const window = seasonWindow(match?.dateISO);
  if (roof === 'dome' || roof === 'retractable') {
    add(neutral, comp('weather', 'Venue and weather modifier', 0, `${roof === 'dome' ? 'enclosed' : 'retractable-roof'} venue — weather scoring does not apply`, { max: 5 }));
  } else if (roof === 'open') {
    if (match?.wind === 'out') add(over, comp('weather', 'Venue and weather modifier', 5, 'wind blowing out confirmed', { max: 5 }));
    else if (match?.forecast && RAIN_FORECASTS.includes(match.forecast) && window) {
      add(under, comp('weather', 'Venue and weather modifier', 5, `open-air venue, forecast "${match.forecast}" inside the ${window} season window — elevated game-calling risk`, { max: 5 }));
    } else if (match?.forecast) {
      add(neutral, comp('weather', 'Venue and weather modifier', 0, `open-air venue, forecast "${match.forecast}"${window ? ` (${window} season window)` : ''} — no rain modifier`, { max: 5 }));
    } else {
      missing.push('forecast (game-time weather at an open-air venue)');
      add(neutral, comp('weather', 'Venue and weather modifier', 0, 'open-air venue, forecast not sourced', { max: 5, missing: true }));
    }
  } else {
    missing.push('roof (venue enclosure status)');
    add(neutral, comp('weather', 'Venue and weather modifier', 0, 'venue enclosure status not sourced', { max: 5, missing: true }));
  }

  const overScore = sum(over); const underScore = sum(under);
  return { over, under, neutral, overScore, underScore, sourcedPoints: sourcedMax([...over, ...under, ...neutral], TOTAL_BASE_IDS) };
}

/* ------------------------------------------------------------------ *
 * Step 3 — decision rules
 * ------------------------------------------------------------------ */
export function decideWinMatch(fav, dog, draw) {
  const gap = Math.abs((fav?.score ?? 0) - (dog?.score ?? 0));
  const drawScore = draw?.score ?? 0;
  // Draw override
  if (drawScore >= 65 && gap <= 10) {
    const conf = drawScore >= 70 ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM;
    return { outcome: 'draw', confidence: conf, reason: `draw likelihood ${drawScore} is 65 or higher and the sides sit ${gap} points apart (within 10)` };
  }
  const score = fav?.score ?? 0;
  if ((fav?.sourcedPoints ?? 100) < MIN_SOURCED_POINTS_WIN) {
    return { outcome: null, confidence: CONFIDENCE.SKIP, reason: `only ${fav.sourcedPoints} of 100 win-match points were sourced (minimum ${MIN_SOURCED_POINTS_WIN})` };
  }
  const heavy = (fav?.american ?? null) != null && fav.american <= -300;
  if (heavy && !(fav.starterMax && (fav.runDiffPerGame ?? 0) > 2.5)) {
    return { outcome: null, confidence: CONFIDENCE.SKIP, reason: 'heavy favourite at −300 or shorter without a maximum starter score and a run differential above +2.5' };
  }
  if (score >= 70) return { outcome: 'side', confidence: CONFIDENCE.HIGH, reason: `win match score ${score} is 70 or higher` };
  if (score >= 55 && (fav?.strongFactors ?? 0) >= 2) return { outcome: 'side', confidence: CONFIDENCE.MEDIUM, reason: `win match score ${score} with ${fav.strongFactors} factors strongly aligned` };
  if (score >= 55) return { outcome: null, confidence: CONFIDENCE.SKIP, reason: `win match score ${score} is 55–69 but fewer than 2 factors are strongly aligned` };
  return { outcome: null, confidence: CONFIDENCE.SKIP, reason: `win match score ${score} is below 55` };
}

export function decideRunLine(favRL, favWinScore, drawScore, dogSide, dogRL) {
  if (drawScore >= 55) return { side: null, confidence: CONFIDENCE.SKIP, reason: `draw likelihood ${drawScore} is 55 or higher — a live draw undermines any run line` };
  if (favWinScore < 60) return { side: null, confidence: CONFIDENCE.SKIP, reason: `win match score ${favWinScore} is below the 60 activation floor` };
  if (favRL.supportsCovering === false) {
    // −1.5 is barred; the +1.5 underdog route may still apply.
    if ((dogSide?.starterScore ?? 0) >= 17 && dogSide?.bullpenSupports === true) return { side: 'underdog', confidence: CONFIDENCE.MEDIUM, reason: 'favourite wins too narrowly to cover; the underdog has a starter at 17+ and a supporting bullpen' };
    return { side: null, confidence: CONFIDENCE.SKIP, reason: 'average winning margin in the last 5 wins is below 2 runs — teams winning close games cannot cover −1.5 reliably, and those are the games most likely to be drawn' };
  }
  if (favRL.supportsCovering == null) return { side: null, confidence: CONFIDENCE.SKIP, reason: 'win margins not sourced, so the −1.5 covering rule cannot be checked' };
  if (favRL.score >= 70) return { side: 'favourite', confidence: CONFIDENCE.HIGH, reason: `run line score ${favRL.score} is 70 or higher` };
  if (favRL.score >= 55) return { side: 'favourite', confidence: CONFIDENCE.MEDIUM, reason: `run line score ${favRL.score} is 55–69` };
  if ((dogSide?.starterScore ?? 0) >= 17 && dogSide?.bullpenSupports === true) return { side: 'underdog', confidence: CONFIDENCE.MEDIUM, reason: 'the +1.5 underdog has a starter at 17+ and a bullpen that supports it' };
  return { side: null, confidence: CONFIDENCE.SKIP, reason: `run line score ${favRL.score} is below 55 and the underdog route is not supported` };
}

export function decideTotal(total) {
  if ((total.sourcedPoints ?? 100) < MIN_SOURCED_POINTS_TOTAL) {
    return { side: null, confidence: CONFIDENCE.SKIP, reason: `only ${total.sourcedPoints} of 100 game-total points were sourced (minimum ${MIN_SOURCED_POINTS_TOTAL})` };
  }
  const adv = Math.abs(total.overScore - total.underScore);
  const side = total.overScore > total.underScore ? 'OVER' : total.underScore > total.overScore ? 'UNDER' : null;
  if (!side) return { side: null, confidence: CONFIDENCE.SKIP, reason: 'Over and Under ledgers are level' };
  if (adv >= 20) return { side, confidence: CONFIDENCE.HIGH, reason: `directional advantage of ${adv} favours ${side}` };
  if (adv >= 15) return { side, confidence: CONFIDENCE.MEDIUM, reason: `directional advantage of ${adv} favours ${side}` };
  return { side: null, confidence: CONFIDENCE.SKIP, reason: `directional advantage of ${adv} is below 15` };
}

/* ------------------------------------------------------------------ *
 * Match + card
 * ------------------------------------------------------------------ */
const uniq = (a) => [...new Set(a.filter(Boolean))];

export function scoreNpbMatch(match) {
  const home = match?.home ?? {}; const away = match?.away ?? {};
  const missing = [];
  if (!home?.name || !away?.name) {
    return { id: match?.id ?? null, unscored: true, reason: 'missing competitor names', missing: ['competitor names'] };
  }
  const h2h = match?.h2h ?? null;
  const flip = (x) => (x ? { ...x, winsA: x.winsB, winsB: x.winsA, last10WinsA: x.last10WinsB, last10WinsB: x.last10WinsA } : null);
  const h2hAway = h2h ? { sameLeague: flip(h2h.sameLeague), interleague: flip(h2h.interleague) } : null;

  const homeWin = scoreWinMatchSide(home, away, h2h, missing);
  const awayWin = scoreWinMatchSide(away, home, h2hAway, missing);
  const draw = scoreDrawLikelihood(match, homeWin.starterRating, awayWin.starterRating, missing);

  let pick = homeWin.score > awayWin.score ? 'home' : awayWin.score > homeWin.score ? 'away' : null;
  if (!pick) pick = (home.runDiffPerGame ?? -Infinity) >= (away.runDiffPerGame ?? -Infinity) ? 'home' : 'away';
  const fav = pick === 'home' ? home : away; const dog = pick === 'home' ? away : home;
  const favWin = pick === 'home' ? homeWin : awayWin; const dogWin = pick === 'home' ? awayWin : homeWin;

  const favRL = scoreRunLineSide(fav, dog, favWin, missing);
  const dogRL = scoreRunLineSide(dog, fav, dogWin, missing);
  const total = scoreTotalMarket(match, homeWin.starterRating, awayWin.starterRating, missing);

  const winDecision = decideWinMatch(favWin, dogWin, draw);
  const dogSupport = { starterScore: dogWin.starterScore, bullpenSupports: dog?.bullpen?.effective === true && dog?.bullpen?.fatigued === false };
  const rlDecision = decideRunLine(favRL, favWin.score, draw.score, dogSupport, dogRL);
  const totalDecision = decideTotal(total);

  const drawFlag = winDecision.outcome === 'draw' ? 'primary' : draw.score >= 55 ? 'secondary' : null;

  return {
    id: match?.id ?? null, league: match?.league ?? null, season: match?.season ?? null,
    dateISO: match?.dateISO ?? null, startUtc: match?.startUtc ?? null, phase: match?.phase ?? 'upcoming',
    venue: match?.venue ?? null, roof: match?.roof ?? null, forecast: match?.forecast ?? null, seasonWindow: seasonWindow(match?.dateISO),
    dh: match?.dh ?? null, foreignPlayers: match?.foreignPlayers ?? null,
    home: profile(home), away: profile(away),
    selection: pick, favoured: fav.name, favouredDisplay: fav.displayName || fav.name, dog: dog.name, dogDisplay: dog.displayName || dog.name,
    winMatch: { home: homeWin, away: awayWin, favourite: favWin, underdog: dogWin, decision: winDecision, gap: Math.abs(homeWin.score - awayWin.score) },
    draw: { ...draw, flag: drawFlag },
    runLine: { favourite: favRL, underdog: dogRL, decision: rlDecision, supportsCovering: favRL.supportsCovering },
    total: { ...total, decision: totalDecision },
    underdogValue: dogWin.underdogValue,
    missing: uniq(missing),
  };
}

function profile(s) {
  return {
    name: s?.name ?? null, displayName: s?.displayName ?? s?.name ?? null, code: s?.code ?? null, league: s?.league ?? null,
    record: s?.record ?? null, recordSummary: s?.recordSummary ?? null,
    runDiffPerGame: s?.runDiffPerGame ?? null, runsPerGameRecent: s?.runsPerGameRecent ?? null,
    drawRate: s?.drawRate ?? null, drawCount: s?.drawCount ?? null,
    starter: s?.starter ? { name: s.starter.name, confirmed: s.starter.confirmed, source: s.starter.source ?? null } : null,
    bullpen: s?.bullpen ?? null,
  };
}

export function scoreNpbCard(matches) {
  return { prompt: PROMPT_NAME, ruleset: RULESET_VERSION, results: (matches || []).map(scoreNpbMatch) };
}
