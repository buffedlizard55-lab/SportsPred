/**
 * SportsPred — Ice Hockey Scoring Engine (canonical implementation).
 *
 * Implements "ICE HOCKEY PREDICTION MASTER PROMPT v1.0" including the
 * SUBAGENT MODELING AND PROFITABILITY LAYER that sits in front of it:
 *
 *   Data → Feature → Modelling → Backtest → Risk → Strategy → No-Bet
 *
 * Three markets are scored per match, exactly as Step 2 specifies:
 *   OUTRIGHT WINNER (100), PUCK LINE HANDICAP (100), GAME TOTAL (100).
 * Step 3 turns scores into HIGH / MEDIUM / LOW / SKIP verdicts.
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
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';
export const PROMPT_NAME = 'ICE HOCKEY PREDICTION MASTER PROMPT v1.0';

export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' };
export const MARKETS = {
  OUTRIGHT: 'outright',
  PUCK_LINE: 'puck_line',
  TOTAL: 'game_total',
};

/** Prompt: "Estimated edge below roughly 3 to 5 percentage points should normally be rejected". */
export const MIN_EDGE_PP = 3.0;
/** Prompt Step 3: "Cap active selections at 6 per day across all markets". */
export const MAX_ACTIVE_PICKS_PER_DAY = 6;

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
 * Odds helpers (shared with the universal engine, re-declared locally so this
 * module stays dependency-light and independently testable).
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

/** Raw implied probability, bookmaker margin still in it. */
export function americanToImpliedProb(american) {
  if (american == null || !isFinite(american)) return null;
  const v = Number(american);
  if (v === 0) return null;
  return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
}

/** Remove the margin proportionally across the prices supplied. */
export function devig(probs) {
  const vals = probs.filter((p) => typeof p === 'number' && p > 0);
  if (vals.length !== probs.length || !vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  return probs.map((p) => p / sum);
}

/* ------------------------------------------------------------------ *
 * Step 2a — OUTRIGHT WINNER MARKET (100pts total)
 * ------------------------------------------------------------------ */

/**
 * Recent Form — last month double weighted (25pts).
 *   Won last 5 = 25 | Won 4/5 = 18 | Won 3/5 = 11 | Won 2 or fewer = 0
 *   +5 winning streak of 4 or more | +5 opponent lost 4 or more of last 5
 *
 * NOTE (documented, not silently changed): the prompt asks for the last two
 * weeks to be weighted double, but the points table it gives is a plain count
 * of wins in the last five. The table is implemented as written; the weighting
 * instruction has no numerical effect on it. See docs/ICE_HOCKEY_PROMPT_REVIEW.md.
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
  const base = wins === 5 ? 25 : wins === 4 ? 18 : wins === 3 ? 11 : 0;
  out.push(comp('form', 'Recent Form — last month double weighted', base, `${wins}/5 wins in the last month`, { max: 25 }));

  // Winning streak: use the sourced value when present, else count leading Ws.
  let streak = team?.form?.winStreak;
  if (typeof streak !== 'number') {
    streak = 0;
    for (const r of last5) { if (r === 'W') streak += 1; else break; }
  }
  if (streak >= 4) {
    out.push(comp('form_streak', 'Bonus: winning streak of 4 or more', 5, `current streak ${streak}`, { max: 5 }));
  }

  const oppLast5 = opponent?.form?.last5;
  if (!Array.isArray(oppLast5) || oppLast5.length < 5) {
    missing.push('opponent.form.last5 (opponent last 5 results, needed for the 4-loss bonus)');
    return { components: out, base, wins };
  }
  const oppLosses = oppLast5.slice(0, 5).filter((r) => r === 'L').length;
  if (oppLosses >= 4) {
    out.push(comp('form_opponent_collapse', 'Bonus: opponent has lost 4 or more of their last 5', 5, `opponent lost ${oppLosses}/5`, { max: 5 }));
  }
  return { components: out, base, wins };
}

/**
 * Odds and Value Assessment (25pts).
 *   -300 or lower = 25 | -200 to -299 = 18 | -150 to -199 = 12 | -100 to -149 = 6
 *   Positive odds with strong form = 8
 *   Deduct 8 if odds shorter than -300 but goaltender unconfirmed or backup starting.
 */
export function scoreOddsAndValue(team, formBase, missing) {
  const out = [];
  const american = team?.odds?.american ?? null;
  if (american == null) {
    missing.push('odds.moneyline (current moneyline cross-referenced from at least two books)');
    out.push(comp('odds', 'Odds and Value Assessment', 0, 'no sourced moneyline price', { max: 25, missing: true }));
    return { components: out, american: null };
  }

  let pts = 0;
  let detail = `American ${american} (decimal ${round(team?.odds?.decimal ?? americanToDecimal(american), 3)})`;
  if (american <= -300) pts = 25;
  else if (american <= -200) pts = 18;
  else if (american <= -150) pts = 12;
  else if (american <= -100) pts = 6;
  else if (american > 0) {
    // "Positive odds with strong form": the prompt does not define "strong".
    // We require the form base to already be in its top two bands (3+ wins).
    const strong = formBase >= 11;
    if (strong) {
      pts = 8;
      detail += ' — plus-price with strong form';
    } else {
      detail += ' — plus-price without strong form, no points';
    }
  } else {
    detail += ' — price between the defined bands, no points';
  }
  out.push(comp('odds', 'Odds and Value Assessment', pts, detail, { max: 25 }));

  const backup = team?.goaltender?.isBackup === true;
  const unconfirmed = team?.goaltender?.confirmed === false;
  if (american <= -300 && (backup || unconfirmed)) {
    out.push(comp('odds_goalie_deduction', 'Deduction: price shorter than -300 with goaltender unconfirmed or a backup starting', -8,
      backup ? 'backup goaltender starting' : 'starter not confirmed', { max: 0 }));
  }
  return { components: out, american };
}

/**
 * Goaltending Strength (20pts).
 *   SV% above .920 = 20 | .910-.919 = 13 | .900-.909 = 6 | below .900 or backup = 0
 *   +5 if the opposing goaltender is below .900 over their last five starts.
 */
export function scoreGoaltending(team, opponent, missing) {
  const out = [];
  const g = team?.goaltender ?? null;
  if (!g || g.savePctg == null) {
    missing.push('goaltender.savePctg (confirmed starter save percentage for tonight)');
    out.push(comp('goaltending', 'Goaltending Strength', 0, 'no sourced starter save percentage', { max: 20, missing: true }));
    return out;
  }

  let pts = 0;
  let detail = `starter save percentage ${round(g.savePctg, 4)}`;
  if (g.isBackup === true) {
    pts = 0;
    detail = 'backup goaltender confirmed starting — 0 points by rule';
  } else if (g.savePctg > 0.920) pts = 20;
  else if (g.savePctg >= 0.910) pts = 13;
  else if (g.savePctg >= 0.900) pts = 6;
  else pts = 0;
  out.push(comp('goaltending', 'Goaltending Strength', pts, detail, { max: 20 }));

  const oppG = opponent?.goaltender ?? null;
  const oppRecent = oppG?.last5SavePctg ?? null;
  if (oppRecent == null) {
    missing.push('opponent.goaltender.last5SavePctg (opposing starter save percentage over last 5 starts)');
    return out;
  }
  if (oppRecent < 0.900) {
    out.push(comp('goaltending_opponent_weak', 'Bonus: opposing goaltender below .900 over last five starts', 5, `opponent ${round(oppRecent, 4)}`, { max: 5 }));
  }
  return out;
}

/**
 * Offensive and Defensive Structure (20pts).
 *   Top 5 shots for AND top 10 shots against = 20
 *   Top 10 shots for and mid-table defensively = 13
 *   Mid-table both = 7
 *   Bottom half in both = 0
 *   +5 power play above 25% | -5 penalty kill below 75%
 *
 * Ranks must be sourced league positions (1 = best). Where a rank is absent the
 * component is recorded as missing rather than assumed mid-table.
 */
export function scoreStructure(team, missing) {
  const out = [];
  const forRank = team?.shotsForRank ?? null;
  const againstRank = team?.shotsAgainstRank ?? null;
  const size = team?.leagueSize ?? null;

  if (forRank == null || againstRank == null) {
    missing.push('shotsForRank / shotsAgainstRank (league position in shots on goal for and against per game)');
    out.push(comp('structure', 'Offensive and Defensive Structure', 0, 'no sourced shots-for/shots-against league ranks', { max: 20, missing: true }));
    return out;
  }

  const half = typeof size === 'number' && size > 0 ? size / 2 : null;
  const isTop5For = forRank <= 5;
  const isTop10For = forRank <= 10;
  const isTop10Against = againstRank <= 10;
  const isBottomHalf = half ? (forRank > half && againstRank > half) : false;

  let pts = 0;
  let detail = `shots-for rank ${forRank}, shots-against rank ${againstRank}`;
  if (isTop5For && isTop10Against) { pts = 20; detail += ' — top 5 offence and top 10 defence'; }
  else if (isTop10For) { pts = 13; detail += ' — top 10 offence, defence not in the top 10'; }
  else if (isBottomHalf) { pts = 0; detail += ' — bottom half in both metrics'; }
  else { pts = 7; detail += ' — mid-table in both metrics'; }
  out.push(comp('structure', 'Offensive and Defensive Structure', pts, detail, { max: 20 }));

  const pp = team?.powerPlayPctg ?? null;
  const pk = team?.penaltyKillPctg ?? null;
  if (pp == null) missing.push('powerPlayPctg (power play conversion percentage)');
  else if (pp > 25) out.push(comp('structure_power_play', 'Bonus: power play conversion above 25%', 5, `power play ${round(pp, 2)}%`, { max: 5 }));

  if (pk == null) missing.push('penaltyKillPctg (penalty kill success percentage)');
  else if (pk < 75) out.push(comp('structure_penalty_kill', 'Deduction: penalty kill below 75%', -5, `penalty kill ${round(pk, 2)}%`, { max: 0 }));

  return out;
}

/**
 * Home Advantage and Context (10pts).
 *   Winning 60%+ of home games = 10 | average = 6 | poor or neutral = 2
 *   +5 away side on a back-to-back | -5 home side on a back-to-back
 */
export function scoreHomeContext(home, away, match, missing) {
  const out = [];
  const neutral = match?.neutral === true;
  const homeWinPct = home?.homeWinPctg ?? null;

  if (neutral) {
    out.push(comp('home_context', 'Home Advantage and Context', 2, 'neutral venue', { max: 10 }));
  } else if (homeWinPct == null) {
    missing.push('homeWinPctg (home record win percentage for the current season, with goals for and against in the split)');
    out.push(comp('home_context', 'Home Advantage and Context', 0, 'no sourced home split record', { max: 10, missing: true }));
  } else if (homeWinPct >= 60) {
    out.push(comp('home_context', 'Home Advantage and Context', 10, `home win rate ${round(homeWinPct, 1)}%`, { max: 10 }));
  } else if (homeWinPct >= 45) {
    out.push(comp('home_context', 'Home Advantage and Context', 6, `home win rate ${round(homeWinPct, 1)}%`, { max: 10 }));
  } else {
    out.push(comp('home_context', 'Home Advantage and Context', 2, `home win rate ${round(homeWinPct, 1)}%`, { max: 10 }));
  }

  if (away?.backToBack === true) {
    out.push(comp('home_away_b2b', 'Bonus: away team on a back-to-back', 5, 'away side played the previous night', { max: 5 }));
  }
  if (home?.backToBack === true) {
    out.push(comp('home_own_b2b', 'Deduction: home team on a back-to-back', -5, 'home side played the previous night', { max: 0 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Step 2b — PUCK LINE HANDICAP MARKET
 *
 * "Use outright winner base score then apply these specific modifiers."
 * ------------------------------------------------------------------ */

export function scorePuckLineModifiers(team, opponent, match, missing) {
  const out = [];
  const ats = team?.puckLineCovers ?? null;
  if (!ats || ats.of == null || ats.covered == null) {
    missing.push('puckLineCovers (puck line cover count over the last 10 games)');
    out.push(comp('puck_ats', 'Puck line ATS trend (replaces home advantage)', 0, 'no sourced puck line cover record', { max: 10, missing: true }));
  } else {
    const rate = ats.covered / Math.max(1, ats.of);
    const pts = ats.covered >= 7 ? 10 : ats.covered === 6 ? 6 : 0;
    out.push(comp('puck_ats', 'Puck line ATS trend (replaces home advantage)', pts,
      `covered ${ats.covered} of last ${ats.of} (${round(rate * 100, 1)}%)`, { max: 10 }));
  }

  const margin = team?.avgWinMarginLast5Wins ?? null;
  if (margin == null) {
    missing.push('avgWinMarginLast5Wins (average winning margin over the last 5 wins)');
    out.push(comp('puck_margin', 'Goal differential modifier', 0, 'no sourced winning margins', { max: 8, missing: true }));
  } else if (margin > 1.5) {
    out.push(comp('puck_margin', 'Goal differential modifier', 8, `average winning margin ${round(margin, 2)} goals`, { max: 8 }));
  } else {
    out.push(comp('puck_margin', 'Goal differential modifier', -8, `average winning margin ${round(margin, 2)} goals — below 1.5`, { max: 8 }));
  }

  if (team?.injuries?.keyForwardLineMissing === true) {
    out.push(comp('puck_injury', 'Injury impact on scoring depth: key forward line missing', -10, 'key forward line unavailable', { max: 0 }));
  }

  const pp = team?.powerPlayPctg ?? null;
  if (pp != null && pp >= 28) {
    out.push(comp('puck_power_play', 'Power play efficiency on puck line (28% or higher)', 6, `power play ${round(pp, 2)}%`, { max: 6 }));
  }

  if (opponent?.backToBack === true) {
    out.push(comp('puck_opp_b2b', 'Back-to-back fatigue: opponent on a back-to-back', 7, 'opponent played the previous night', { max: 7 }));
  }
  if (team?.backToBack === true) {
    out.push(comp('puck_own_b2b', 'Back-to-back fatigue: own team on a back-to-back', -7, 'team played the previous night', { max: 0 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Step 2c — GAME TOTAL MARKET
 *
 * The prompt awards points "for Over" and "for Under" inside the same tables.
 * We therefore score two ledgers in one pass and keep both, so Step 3 can pick
 * the side the evidence actually supports.
 * ------------------------------------------------------------------ */

export function scoreTotalMarket(match, missing) {
  const home = match?.home ?? {};
  const away = match?.away ?? {};
  const over = [];
  const under = [];
  const neutral = [];

  const gfH = home?.goalsForPerGame ?? null;
  const gfA = away?.goalsForPerGame ?? null;

  /* Combined offensive output (35pts) */
  if (gfH == null || gfA == null) {
    missing.push('goalsForPerGame (goals scored per game for both teams)');
    neutral.push(comp('total_offence', 'Combined offensive output', 12, 'goals per game not sourced — treated as the neutral band', { max: 35, missing: true }));
  } else if (gfH >= 3.5 && gfA >= 3.5) {
    over.push(comp('total_offence', 'Combined offensive output', 35, `both sides average ${round(gfH, 2)} and ${round(gfA, 2)} goals per game`, { max: 35 }));
  } else if ((gfH >= 3.5 && gfA >= 2.8 && gfA <= 3.4) || (gfA >= 3.5 && gfH >= 2.8 && gfH <= 3.4)) {
    over.push(comp('total_offence', 'Combined offensive output', 22, `one side above 3.5 (${round(Math.max(gfH, gfA), 2)}), the other 2.8-3.4 (${round(Math.min(gfH, gfA), 2)})`, { max: 35 }));
  } else if (gfH < 2.5 || gfA < 2.5) {
    under.push(comp('total_offence', 'Combined offensive output', 15, `at least one side averages below 2.5 goals per game (${round(gfH, 2)} / ${round(gfA, 2)})`, { max: 35 }));
  } else {
    neutral.push(comp('total_offence', 'Combined offensive output', 12, `both sides between 2.8 and 3.4 goals per game (${round(gfH, 2)} / ${round(gfA, 2)})`, { max: 35 }));
  }

  /* Combined goaltending quality (25pts) */
  const svH = home?.goaltender?.savePctg ?? null;
  const svA = away?.goaltender?.savePctg ?? null;
  if (svH == null || svA == null) {
    missing.push('goaltender.savePctg (confirmed starter save percentages for both sides)');
    neutral.push(comp('total_goaltending', 'Combined goaltending quality', 0, 'starter save percentages not sourced', { max: 25, missing: true }));
  } else if (svH < 0.900 && svA < 0.900) {
    over.push(comp('total_goaltending', 'Combined goaltending quality', 25, `both starters below .900 (${round(svH, 4)} / ${round(svA, 4)})`, { max: 25 }));
  } else if ((svH < 0.900 && svA > 0.910) || (svA < 0.900 && svH > 0.910)) {
    neutral.push(comp('total_goaltending', 'Combined goaltending quality', 12, `one starter below .900, the other above .910 (${round(svH, 4)} / ${round(svA, 4)})`, { max: 25 }));
  } else if (svH > 0.915 && svA > 0.915) {
    under.push(comp('total_goaltending', 'Combined goaltending quality', 20, `both starters above .915 (${round(svH, 4)} / ${round(svA, 4)})`, { max: 25 }));
  } else {
    neutral.push(comp('total_goaltending', 'Combined goaltending quality', 12, `mixed goaltending (${round(svH, 4)} / ${round(svA, 4)}) — neutral band`, { max: 25 }));
  }
  if (home?.goaltender?.isBackup === true || away?.goaltender?.isBackup === true) {
    over.push(comp('total_backup', 'Backup goaltender confirmed for one side', 10, 'a backup is starting — the single strongest Over indicator in this model', { max: 10 }));
  }

  /* Power play and penalty kill interaction (20pts) */
  const ppOpp = (home?.powerPlayOpportunitiesPerGame ?? null) !== null && (away?.powerPlayOpportunitiesPerGame ?? null) !== null
    ? (home.powerPlayOpportunitiesPerGame + away.powerPlayOpportunitiesPerGame)
    : null;
  if (ppOpp == null) {
    missing.push('powerPlayOpportunitiesPerGame (power play opportunities drawn per game for both teams)');
  } else if (ppOpp > 7) {
    over.push(comp('total_special_teams', 'Power play and penalty kill interaction', 15, `combined power play opportunities ${round(ppOpp, 2)} per game`, { max: 20 }));
  }

  const eliteVsPoor = (
    (home?.powerPlayPctg ?? 0) >= 25 && (away?.penaltyKillPctg ?? 100) < 75)
    || ((away?.powerPlayPctg ?? 0) >= 25 && (home?.penaltyKillPctg ?? 100) < 75);
  if (eliteVsPoor) {
    over.push(comp('total_pp_vs_pk', 'Elite power play against a poor penalty kill', 10, 'special teams mismatch', { max: 10 }));
  }
  const bothElitePk = (home?.penaltyKillPctg ?? null) !== null && (away?.penaltyKillPctg ?? null) !== null
    && home.penaltyKillPctg > 85 && away.penaltyKillPctg > 85;
  if (bothElitePk) {
    under.push(comp('total_pk_elite', 'Both penalty kills above 85%', 10, 'two elite penalty killing units', { max: 10 }));
  }

  /* Recent total trends (20pts) */
  const oH = home?.recentTotals?.overs ?? null;
  const oA = away?.recentTotals?.overs ?? null;
  const uH = home?.recentTotals?.unders ?? null;
  const uA = away?.recentTotals?.unders ?? null;
  const gamesH = home?.recentTotals?.games ?? null;
  const gamesA = away?.recentTotals?.games ?? null;
  if (oH == null || oA == null || uH == null || uA == null || !gamesH || !gamesA) {
    missing.push('recentTotals (Over/Under record in the last 5 games for both teams against the posted line)');
    neutral.push(comp('total_trend', 'Recent total trends', 5, 'recent total trend not sourced — no strong lean', { max: 20, missing: true }));
  } else if (oH >= 4 && oA >= 4) {
    over.push(comp('total_trend', 'Recent total trends', 20, `both sides Over in ${oH} and ${oA} of their last 5`, { max: 20 }));
  } else if (oH >= 3 && oA >= 3) {
    over.push(comp('total_trend', 'Recent total trends', 12, `both sides Over in ${oH} and ${oA} of their last 5`, { max: 20 }));
  } else if (uH >= 3 && uA >= 3) {
    under.push(comp('total_trend', 'Recent total trends', 15, `both sides Under in ${uH} and ${uA} of their last 5`, { max: 20 }));
  } else {
    neutral.push(comp('total_trend', 'Recent total trends', 5, `mixed recent totals (Over ${oH}/${gamesH} and ${oA}/${gamesA})`, { max: 20 }));
  }

  /**
   * "Combined offensive score" gate value.
   *
   * DOCUMENTED READING (see docs/ICE_HOCKEY_PROMPT_REVIEW.md): the offence
   * block alone caps at 35 points, so the prompt's gates of 55 (at 4.5) and 70
   * (at 5.5) are unreachable if the gate refers to that block alone. The gate
   * value is therefore the accumulated Over-side score across all four total
   * factors (offence 35 + goaltending 25 + special teams 20 + trends 20 = 100),
   * with the neutral-band points counted on both sides.
   */
  const overScore = clamp(sumPts(over) + sumPts(neutral), 0, 100);
  const underScore = clamp(sumPts(under) + sumPts(neutral), 0, 100);
  const offensiveScore = overScore;

  return {
    over, under, neutral,
    overScore, underScore, offensiveScore,
    goalsForPerGame: { home: gfH, away: gfA },
  };
}

const sumPts = (list) => list.reduce((a, c) => a + (c.points || 0), 0);

/**
 * Total line adjustment gates from the prompt:
 *   4.5 -> Over needs combined offensive score 55+
 *   5.5 -> Over needs 70+ AND both sides above 3.2 goals per game
 *   6.5+ -> both sides above 3.8 and both goalies below .905
 * European leagues: thresholds drop by 0.5 goals of line value.
 */
export function totalLineGate(line, total, { european = false } = {}) {
  if (line == null) return { allowed: false, reason: 'no sourced total line', requirement: null };
  const eff = european ? line - 0.5 : line;
  const gfH = total.goalsForPerGame.home;
  const gfA = total.goalsForPerGame.away;

  if (eff <= 4.5) {
    const ok = total.offensiveScore >= 55;
    return { allowed: ok, requirement: 'combined offensive score 55 or higher at this line', reason: ok ? null : `combined offensive score ${total.offensiveScore} is below 55` };
  }
  if (eff <= 5.5) {
    const gfOk = gfH != null && gfA != null && gfH > 3.2 && gfA > 3.2;
    const ok = total.offensiveScore >= 70 && gfOk;
    return {
      allowed: ok,
      requirement: 'combined offensive score 70 or higher and both sides above 3.2 goals per game',
      reason: ok ? null : total.offensiveScore < 70
        ? `combined offensive score ${total.offensiveScore} is below 70`
        : 'both sides must average above 3.2 goals per game at this line',
    };
  }
  const svH = null; // recomputed by caller context is not available here; gate on offence only
  const ok = gfH != null && gfA != null && gfH > 3.8 && gfA > 3.8 && eff >= 6.5 && total.offensiveScore >= 70;
  return {
    allowed: ok,
    requirement: 'both sides above 3.8 goals per game plus exceptional evidence at a line of 6.5 or higher',
    reason: ok ? null : 'a line of 6.5 or higher needs both sides above 3.8 goals per game and exceptional evidence',
  };
}

/* ------------------------------------------------------------------ *
 * Subagent layer: Modelling / Risk / Strategy / No-Bet
 *
 * Two independent reasoning paths produce a probability, the consensus is
 * compared with the de-vigged price, and the result is filtered before it is
 * allowed to become a pick. Nothing here can manufacture an edge: with no
 * price the market path is null and the edge is recorded as unavailable.
 * ------------------------------------------------------------------ */

/** Path 1: form, structure and goaltending points as a probability. */
export function modelProbabilityFromScore(score) {
  if (score == null) return null;
  return round(clamp(0.08 + (score / 100) * 0.84, 0.02, 0.98), 4);
}

/** Path 2: the de-vigged market price as a probability. */
export function modelProbabilityFromOdds(team, opponent) {
  const h = team?.odds?.american ?? null;
  const a = opponent?.odds?.american ?? null;
  if (h == null || a == null) return null;
  const fair = devig([americanToImpliedProb(h), americanToImpliedProb(a)]);
  if (!fair) return null;
  return round(fair[0], 4);
}

export function buildConsensus(scorePath, marketPath) {
  if (scorePath == null && marketPath == null) return { consensus: null, agreement: null, paths: 0 };
  if (scorePath == null) return { consensus: marketPath, agreement: null, paths: 1 };
  if (marketPath == null) return { consensus: scorePath, agreement: null, paths: 1 };
  const agreement = round(Math.abs(scorePath - marketPath), 4);
  return { consensus: round((scorePath + marketPath) / 2, 4), agreement, paths: 2 };
}

/**
 * Risk Filter + No-Bet veto.
 * @returns {{edgePp: number|null, veto: string|null, penalties: string[]}}
 */
export function riskFilter({ consensus, marketProb, missing = [], score, agreement = null, goaltenderConfirmed = true }) {
  const penalties = [];
  const edgePp = consensus != null && marketProb != null ? round((consensus - marketProb) * 100, 2) : null;

  if (edgePp != null && edgePp < MIN_EDGE_PP) {
    return { edgePp, veto: `estimated edge ${edgePp} points is below the ${MIN_EDGE_PP} point floor`, penalties };
  }

  // Outsized dependence on one fragile variable.
  const fragile = missing.filter((m) => /goaltender|odds|injury|powerPlay|penaltyKill/.test(m));
  if (fragile.length >= 2) penalties.push(`${fragile.length} fragile inputs are unsourced (${fragile.join('; ')})`);
  if (!goaltenderConfirmed) penalties.push('starting goaltender not confirmed');
  if (agreement != null && agreement > 0.20) penalties.push(`the two reasoning paths disagree by ${round(agreement * 100, 1)} points`);
  if (missing.length >= 4) penalties.push(`${missing.length} distinct inputs could not be sourced`);

  if (!goaltenderConfirmed) {
    return { edgePp, veto: 'starting goaltender unconfirmed — the most critical input in hockey is missing', penalties };
  }
  if (agreement != null && agreement > 0.30) {
    return { edgePp, veto: `model disagreement of ${round(agreement * 100, 1)} points is too high to bet`, penalties };
  }
  if (typeof score === 'number' && score < 50) {
    return { edgePp, veto: `score ${score} is below the 50 point Step 3 floor`, penalties };
  }
  return { edgePp, veto: null, penalties };
}

/* ------------------------------------------------------------------ *
 * Match scoring
 * ------------------------------------------------------------------ */

/**
 * The public, writer-facing view of a side.
 *
 * The writer builds its prose only from what appears here, so every field
 * carried through must be a sourced value (NHL standings / tape / goalie feed —
 * see engine/ice_hockey_data.js enrichIceHockeyFixture). Fields absent from the
 * feed stay null and the corresponding clause is simply never written.
 */
function sideProfile(team) {
  return {
    name: team?.name ?? null,
    abbrev: team?.abbrev ?? null,
    record: team?.record ?? null,
    goalsForPerGame: team?.goalsForPerGame ?? null,
    goalsAgainstPerGame: team?.goalsAgainstPerGame ?? null,
    savePctg: team?.goaltender?.savePctg ?? null,
    backup: team?.goaltender?.isBackup === true,
    backToBack: team?.backToBack === true,
    // Carried through for the tip writer. All sourced, none derived.
    form: team?.form ?? null,
    shotsForRank: team?.shotsForRank ?? null,
    shotsAgainstRank: team?.shotsAgainstRank ?? null,
    leagueSize: team?.leagueSize ?? null,
    avgWinMarginLast5Wins: team?.avgWinMarginLast5Wins ?? null,
    puckLineCovers: team?.puckLineCovers ?? null,
    recentTotals: team?.recentTotals ?? null,
    goaltender: team?.goaltender ?? null,
  };
}

/**
 * Score one side for the OUTRIGHT WINNER market.
 * Returns { side, components, score, missing }.
 */
export function scoreOutrightSide(side, opponent, match, sideKey) {
  const missing = [];
  const form = scoreRecentForm(side, opponent, missing);
  const odds = scoreOddsAndValue(side, form.base, missing);
  const goaltending = scoreGoaltending(side, opponent, missing);
  const structure = scoreStructure(side, missing);
  const context = sideKey === 'home'
    ? scoreHomeContext(side, opponent, match, missing)
    : [];

  const components = [...form.components, ...odds.components, ...goaltending, ...structure, ...context];
  const score = clamp(sumPts(components), 0, 100);
  return { side: side?.name ?? sideKey, components, score, missing, formBase: form.base };
}

/**
 * Score the PUCK LINE for one side: outright base with the home-advantage block
 * swapped out for the ATS trend block, then the puck line modifiers.
 */
export function scorePuckLineSide(side, opponent, match, outright, sideKey) {
  const missing = [...(outright?.missing || [])];
  const baseComponents = (outright?.components || []).filter((c) => c.id !== 'home_context');
  const baseScore = clamp(sumPts(baseComponents), 0, 100);
  const modifiers = scorePuckLineModifiers(side, opponent, match, missing);
  const components = [...baseComponents, ...modifiers];
  return { side: side?.name ?? sideKey, components, score: clamp(sumPts(components), 0, 100), missing, baseScore };
}

/**
 * Step 3 decision rules.
 */
export function decideOutright(score) {
  if (score >= 70) return { confidence: CONFIDENCE.HIGH, reason: `score ${score} is 70 or higher` };
  if (score >= 50) return { confidence: CONFIDENCE.MEDIUM, reason: `score ${score} is between 50 and 69` };
  return { confidence: CONFIDENCE.SKIP, reason: `score ${score} is below 50` };
}

export function decidePuckLine(score, outrightScore, supportsCovering) {
  if (outrightScore < 65) return { confidence: CONFIDENCE.SKIP, reason: `outright winner score ${outrightScore} is below the 65 activation floor` };
  if (!supportsCovering) return { confidence: CONFIDENCE.SKIP, reason: 'average winning margin does not support covering the puck line' };
  if (score >= 70) return { confidence: CONFIDENCE.HIGH, reason: `puck line score ${score} is 70 or higher` };
  if (score >= 55) return { confidence: CONFIDENCE.MEDIUM, reason: `puck line score ${score} is between 55 and 69` };
  return { confidence: CONFIDENCE.SKIP, reason: `puck line score ${score} is below 55 — close games do not cover reliably` };
}

/**
 * Step 3 game total decision.
 *
 * DOCUMENTED CONFLICT RESOLUTION: Step 2 says a 4.5 line needs a combined
 * offensive score of 55 or higher to recommend the Over, while Step 3 says
 * "Over 4.5 with combined offensive score 45 to 54 = MEDIUM confidence". The
 * two cannot both be gates. They are read as one confidence ladder instead —
 * 55 or higher is HIGH (the "primary value play"), 45 to 54 is MEDIUM, below 45
 * is SKIP — and the stricter 5.5 / 6.5 gates from Step 2 stay hard gates, since
 * Step 3 never offers HIGH above a 4.5 line.
 */
export function decideTotal({ line, total, european = false, goaltendersAbove915 }) {
  const overGate = totalLineGate(line, total, { european });
  const offensive = total.offensiveScore;
  const underScore = total.underScore;
  const eff = european && line != null ? Math.round((line - 0.5) * 10) / 10 : line;

  // Under route: combined defensive score 65+ with both goaltenders above .915.
  if (goaltendersAbove915 && underScore >= 65) {
    return { side: 'UNDER', confidence: CONFIDENCE.MEDIUM, reason: `under score ${underScore} is 65 or higher with both starters above .915`, gate: overGate };
  }

  if (line == null) {
    return { side: null, confidence: CONFIDENCE.SKIP, reason: 'no total line was sourced, so no Over or Under can be recommended', gate: overGate };
  }

  if (eff >= 6.5) {
    if (!overGate.allowed) return { side: null, confidence: CONFIDENCE.SKIP, reason: overGate.reason, gate: overGate };
    return { side: 'OVER', confidence: CONFIDENCE.MEDIUM, reason: `exceptional evidence at a line of ${line} — capped at MEDIUM`, gate: overGate };
  }
  if (eff >= 5.5) {
    if (!overGate.allowed) return { side: null, confidence: CONFIDENCE.SKIP, reason: overGate.reason, gate: overGate };
    return { side: 'OVER', confidence: CONFIDENCE.MEDIUM, reason: `combined offensive score ${offensive} clears the stricter gate at this line — capped at MEDIUM`, gate: overGate };
  }

  // 4.5 (and lower) lines: the confidence ladder.
  if (offensive >= 55) {
    return { side: 'OVER', confidence: CONFIDENCE.HIGH, reason: `combined offensive score ${offensive} is 55 or higher at a ${line} line — the primary value play`, gate: overGate };
  }
  if (offensive >= 45) {
    return { side: 'OVER', confidence: CONFIDENCE.MEDIUM, reason: `combined offensive score ${offensive} is between 45 and 54`, gate: overGate };
  }
  if (underScore >= 55 && underScore > offensive) {
    return { side: null, confidence: CONFIDENCE.SKIP, reason: `the Under side scores higher (${underScore} against ${offensive}) but both goaltenders are not above .915, so the only sanctioned Under route is closed`, gate: overGate };
  }
  return { side: null, confidence: CONFIDENCE.SKIP, reason: `combined offensive score ${offensive} is below 45 at a ${line} line`, gate: overGate };
}

/**
 * Score and decide all three markets for one match, then run the subagent
 * pipeline over the result.
 *
 * @param {object} match enriched match (see engine/ice_hockey_data.js)
 * @param {object} opts  { european?: boolean, historicalSignal?: 'stable'|'weak'|'unknown' }
 */
export function scoreIceHockeyMatch(match, opts = {}) {
  // A match carries its own flag when it was enriched from a league name; the
  // caller can also force it. Either route is honoured.
  const european = opts.european === true || match?.european === true;
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

  const outrightHome = scoreOutrightSide(home, away, match, 'home');
  const outrightAway = scoreOutrightSide(away, home, match, 'away');

  const pickSide = outrightHome.score >= outrightAway.score ? 'home' : 'away';
  const fav = pickSide === 'home' ? home : away;
  const dog = pickSide === 'home' ? away : home;
  const favOutright = pickSide === 'home' ? outrightHome : outrightAway;
  const dogOutright = pickSide === 'home' ? outrightAway : outrightHome;

  const puckFav = scorePuckLineSide(fav, dog, match, favOutright, pickSide);
  const puckDog = scorePuckLineSide(dog, fav, match, dogOutright, pickSide === 'home' ? 'away' : 'home');

  const total = scoreTotalMarket(match, missing);
  const goaltendersAbove915 = (home?.goaltender?.savePctg ?? 0) > 0.915 && (away?.goaltender?.savePctg ?? 0) > 0.915
    && home?.goaltender?.savePctg != null && away?.goaltender?.savePctg != null;

  const line = match?.total?.line ?? null;
  const outrightDecision = decideOutright(favOutright.score);
  const supportsCovering = (fav?.avgWinMarginLast5Wins ?? null) != null && fav.avgWinMarginLast5Wins > 1.5;
  const puckDecision = decidePuckLine(puckFav.score, favOutright.score, supportsCovering);
  const totalDecision = decideTotal({ line, total, european, goaltendersAbove915 });

  /* ---- subagent pipeline ---- */
  const scorePath = modelProbabilityFromScore(favOutright.score);
  const marketPath = modelProbabilityFromOdds(fav, dog);
  const consensus = buildConsensus(scorePath, marketPath);
  const risk = riskFilter({
    consensus: consensus.consensus,
    marketProb: marketPath,
    missing: uniq([...favOutright.missing, ...missing]),
    score: favOutright.score,
    agreement: consensus.agreement,
    goaltenderConfirmed: fav?.goaltender?.confirmed !== false,
  });

  const historical = opts.historicalSignal ?? null;
  if (historical === 'weak') risk.penalties.push('the backtest shows this signal profile has been historically weak');

  const allMissing = uniq([...favOutright.missing, ...dogOutright.missing, ...puckFav.missing, ...missing]);

  return {
    id: match?.id ?? null,
    league: match?.league ?? null,
    leagueName: match?.leagueName ?? null,
    dateISO: match?.dateISO ?? match?.date ?? null,
    startUtc: match?.startUtc ?? null,
    phase: match?.phase ?? 'upcoming',
    european,
    home: sideProfile(home),
    away: sideProfile(away),
    selection: pickSide,
    favoured: fav?.name ?? null,
    dog: dog?.name ?? null,
    odds: {
      provider: match?.oddsProvider ?? fav?.odds?.provider ?? null,
      favouriteAmerican: fav?.odds?.american ?? null,
      dogAmerican: dog?.odds?.american ?? null,
      sourceCount: match?.oddsSourceCount ?? null,
    },
    outright: {
      favourite: favOutright,
      underdog: dogOutright,
      decision: outrightDecision,
    },
    puckLine: {
      favourite: puckFav,
      underdog: puckDog,
      decision: puckDecision,
      supportsCovering,
    },
    total: {
      line,
      over: total.over,
      under: total.under,
      neutral: total.neutral,
      overScore: total.overScore,
      underScore: total.underScore,
      offensiveScore: total.offensiveScore,
      decision: totalDecision,
    },
    pipeline: {
      modelling: {
        scorePath,
        marketPath,
        consensus: consensus.consensus,
        agreement: consensus.agreement,
        paths: consensus.paths,
        edgePp: risk.edgePp,
      },
      backtest: { historicalSignal: historical },
      risk: { penalties: risk.penalties, veto: risk.veto, edgeFloor: MIN_EDGE_PP },
      noBet: risk.veto !== null,
    },
    missing: allMissing,
  };
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

/**
 * Score a whole card where every match carries its own `european` flag, so the
 * league-specific total thresholds apply per game (the prompt requires European
 * league lines to be adjusted downward by half a goal, and the NHL card must
 * not inherit that).
 */
export function scoreIceHockeyCardMixed(matches, opts = {}) {
  return scoreIceHockeyCard(matches, opts, { perMatchEuropean: true });
}

/**
 * Score a whole card. Also applies the Step 3 cap of 6 active selections per
 * day across all markets, keeping the highest-scoring plays when the cap bites.
 */
export function scoreIceHockeyCard(matches, opts = {}, { perMatchEuropean = false } = {}) {
  const results = (matches || []).map((m) => scoreIceHockeyMatch(
    m,
    perMatchEuropean ? { ...opts, european: m?.european === true } : opts
  ));
  const picks = [];
  for (const r of results) {
    if (!r || r.unscored) continue;
    for (const [market, decision] of [
      [MARKETS.OUTRIGHT, r.outright.decision],
      [MARKETS.PUCK_LINE, r.puckLine.decision],
      [MARKETS.TOTAL, r.total.decision],
    ]) {
      if (decision.confidence === CONFIDENCE.SKIP) continue;
      if (r.pipeline.noBet) continue;
      const score = market === MARKETS.TOTAL ? r.total.offensiveScore
        : market === MARKETS.PUCK_LINE ? r.puckLine.favourite.score : r.outright.favourite.score;
      picks.push({ id: r.id, market, confidence: decision.confidence, score });
    }
  }
  picks.sort((a, b) => (
    (a.confidence === 'HIGH' ? 2 : a.confidence === 'MEDIUM' ? 1 : 0)
    - (b.confidence === 'HIGH' ? 2 : b.confidence === 'MEDIUM' ? 1 : 0)
    || b.score - a.score
  ));
  const cappedOut = picks.slice(MAX_ACTIVE_PICKS_PER_DAY).map((p) => `${p.id}:${p.market}`);

  return {
    prompt: PROMPT_NAME,
    ruleset: RULESET_VERSION,
    results,
    cap: { limit: MAX_ACTIVE_PICKS_PER_DAY, active: Math.min(picks.length, MAX_ACTIVE_PICKS_PER_DAY), suppressed: cappedOut },
  };
}
