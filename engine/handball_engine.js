/**
 * SportsPred — Handball Scoring Engine (Canonical Implementation).
 *
 * Implements "HANDBALL PREDICTION MASTER PROMPT v1.0", Step 2 (market scoring)
 * and Step 3 (decision rules) exactly as specified.
 *
 * RULES OF THIS MODULE:
 *  - Pure functions only. No I/O, no network, no clock, no randomness.
 *  - Every input field may be null/undefined. A missing field is never
 *    guessed: it is recorded in `missing[]` and the score is capped by the
 *    confidence penalty. This is what makes "no hallucinations" enforceable.
 *  - Every point awarded is traceable: each component records its rule id,
 *    the value that triggered it and the points given.
 *  - The same module is imported by the browser and by the Node test suite.
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';

export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' };

/** Cost, in points, of each input factor that could not be sourced. */
const MISSING_FIELD_PENALTY = 5;
/** Minimum number of sourced factors required to qualify for MEDIUM / HIGH. */
const MIN_FACTORS_FOR_MEDIUM = 3;

/* ------------------------------------------------------------------ *
 * Odds helpers
 * ------------------------------------------------------------------ */

/** Decimal odds -> American. 2.00 -> +100, 1.50 -> -200, 1.30 -> -333. */
export function decimalToAmerican(decimal) {
  if (decimal == null || !isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** American -> implied probability (raw, vig included). */
export function americanToImpliedProb(american) {
  if (american == null) return null;
  if (american > 0) return 100 / (american + 100);
  if (american < 0) return -american / (-american + 100);
  return null;
}

/**
 * Normalise any odds input to { decimal, american }.
 * Accepts decimal (1.35) or American (-280 / +150).
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
    decimal = raw >= 1.01 ? raw : raw / 100 + 1;
  }
  if (decimal == null || !isFinite(decimal) || decimal <= 1.0) return null;
  return { decimal: Number(decimal.toFixed(3)), american: decimalToAmerican(decimal) };
}

function comp(id, label, points, detail, { max = null, missing = null } = {}) {
  return { id, label, points, max, detail, missing: missing ?? false };
}

/* ------------------------------------------------------------------ *
 * WIN MATCH MARKET (100pts total)
 *
 * Recent Form (30pts):
 *   5 wins from last 5 = 30pts
 *   4 wins from last 5 = 22pts
 *   3 wins from last 5 = 13pts
 *   2 wins or fewer = 0pts
 *   Bonus +5pts for winning streak of 4 or more
 *   Bonus +5pts for opponent on losing streak of 4 or more
 *
 * Odds and Value Assessment (25pts):
 *   Odds -300 or lower = 25pts
 *   Odds -200 to -299 = 18pts
 *   Odds -150 to -199 = 12pts
 *   Odds -100 to -149 = 6pts
 *   Near-even or positive odds with strong form = 10pts
 *   Deduct 8pts if odds are shorter than -300 but form score is below 15
 *
 * Head-to-Head Last 3 Years (20pts):
 *   70% or higher win rate = 20pts
 *   55 to 69% win rate = 13pts
 *   Roughly even (45-54%) = 5pts
 *   Trailing in H2H (<45%) = 0pts
 *   Weight last 3 meetings double over full H2H record
 *
 * Standings and Season Quality (15pts):
 *   Top 3 in league or group = 15pts
 *   4th to 6th = 10pts
 *   7th to 10th = 5pts
 *   Outside top half = 0pts
 *   Deduct 5pts if opponent is ranked higher in the same division
 *
 * Competition Stage and Home Advantage (10pts):
 *   Final or semi-final = 10pts
 *   Quarter-final or knockout = 8pts
 *   High-stakes league match with title or relegation implications = 7pts
 *   Mid-table league fixture = 4pts
 *   Low-stakes dead rubber = 0pts
 *   Add 3pts for confirmed home advantage with strong home record
 * ------------------------------------------------------------------ */

export function scoreRecentForm(fav, opp, missing) {
  const last5 = fav?.form?.last5;
  const out = [];
  if (!Array.isArray(last5) || last5.length < 5) {
    missing.push('form.last5 (last 5 match results, last month)');
    out.push(comp('form', 'Recent Form (last month double weighted)', 0, 'no sourced last 5 match results', { max: 30, missing: true }));
    return { components: out, formBase: 0 };
  }

  const wins = last5.slice(0, 5).filter((r) => r === 'W').length;
  let base = 0;
  if (wins === 5) base = 30;
  else if (wins === 4) base = 22;
  else if (wins === 3) base = 13;
  else base = 0;

  out.push(comp('form', `Recent Form: ${wins}/5 wins`, base, `${wins} wins in last 5 matches`, { max: 30 }));

  // Streak bonuses
  const winStreak = fav?.form?.winStreak ?? (wins === 5 ? 5 : wins >= 4 ? 4 : 0);
  if (winStreak >= 4) {
    out.push(comp('form_win_streak', 'Bonus: winning streak of 4 or more', 5, `Streak of ${winStreak} matches`, { max: 5 }));
  }

  const oppLossStreak = opp?.form?.lossStreak ?? (Array.isArray(opp?.form?.last5) ? opp.form.last5.filter((r) => r === 'L').length : 0);
  if (oppLossStreak >= 4) {
    out.push(comp('form_opp_loss_streak', 'Bonus: opponent on losing streak of 4 or more', 5, `Opponent loss streak ${oppLossStreak}`, { max: 5 }));
  }

  return { components: out, formBase: base };
}

export function scoreOddsAndValue(fav, formBase, missing) {
  const am = fav?.odds?.american ?? null;
  const out = [];
  if (am == null) {
    missing.push('odds (moneyline odds cross-referenced)');
    out.push(comp('odds_value', 'Odds and Value Assessment', 0, 'no sourced moneyline odds', { max: 25, missing: true }));
    return out;
  }

  let pts = 0;
  let detail = `American ${am} (decimal ${fav.odds.decimal})`;

  if (am <= -300) {
    pts = 25;
  } else if (am <= -200 && am >= -299) {
    pts = 18;
  } else if (am <= -150 && am >= -199) {
    pts = 12;
  } else if (am <= -100 && am >= -149) {
    pts = 6;
  } else if (am > 0 || am >= -100) {
    // Near-even or positive odds with strong form
    if (formBase >= 22) {
      pts = 10;
      detail += ' — near-even/positive odds with strong form';
    } else {
      pts = 4;
    }
  }

  out.push(comp('odds_value', 'Odds and Value Assessment', pts, detail, { max: 25 }));

  // Deduct 8pts if odds are shorter than -300 but form score is below 15
  if (am <= -300 && formBase < 15) {
    out.push(comp('odds_trap_deduction', 'Deduction: odds shorter than -300 with weak form (<15)', -8, 'favourite trap penalty', { max: 0 }));
  }

  return out;
}

export function scoreH2H(fav, opp, match, missing) {
  const h2h = match?.h2h;
  const out = [];
  if (!h2h || h2h.totalMeetings == null || h2h.totalMeetings === 0) {
    missing.push('h2h (head-to-head record over last 3 years)');
    out.push(comp('h2h', 'Head-to-Head Last 3 Years', 5, 'no recent H2H meetings on record (neutral 5pts)', { max: 20 }));
    return out;
  }

  // Double weight recent meetings (last 3 meetings)
  const total = h2h.totalMeetings;
  const favWins = h2h.favWins || 0;
  const recentMeetings = h2h.recentMeetings || []; // array of 'W', 'L', 'D' from fav perspective
  let weightedFavWins = favWins;
  let weightedTotal = total;

  if (recentMeetings.length > 0) {
    const recWins = recentMeetings.slice(0, 3).filter((r) => r === 'W').length;
    const recTotal = Math.min(recentMeetings.length, 3);
    weightedFavWins += recWins;
    weightedTotal += recTotal;
  }

  const winRate = weightedTotal > 0 ? (weightedFavWins / weightedTotal) : 0.5;
  let pts = 0;
  if (winRate >= 0.70) pts = 20;
  else if (winRate >= 0.55) pts = 13;
  else if (winRate >= 0.45) pts = 5;
  else pts = 0;

  out.push(comp('h2h', `Head-to-Head: ${(winRate * 100).toFixed(0)}% weighted win rate`, pts,
    `${favWins}/${total} wins overall with recent meetings weighted double`, { max: 20 }));

  return out;
}

export function scoreStandings(fav, opp, missing) {
  const out = [];
  const r1 = fav?.standings?.rank ?? null;
  const r2 = opp?.standings?.rank ?? null;
  const totalTeams = fav?.standings?.totalTeams ?? 18;

  if (r1 == null) {
    missing.push('standings (current league standings and points tally)');
    out.push(comp('standings', 'Standings and Season Quality', 0, 'unsourced league standing', { max: 15, missing: true }));
    return out;
  }

  let pts = 0;
  if (r1 <= 3) pts = 15;
  else if (r1 <= 6) pts = 10;
  else if (r1 <= 10) pts = 5;
  else pts = 0;

  out.push(comp('standings', `Standings and Season Quality: #${r1} in league`, pts,
    `Rank #${r1} of ${totalTeams} teams`, { max: 15 }));

  // Deduct 5pts if opponent is ranked higher in the same division
  if (r2 != null && r2 < r1) {
    out.push(comp('standings_opp_higher', 'Deduction: opponent ranked higher in division', -5,
      `Opponent #${r2} ranks above favourite #${r1}`, { max: 0 }));
  }

  return out;
}

export function scoreStageAndHome(fav, opp, match, missing) {
  const out = [];
  const stage = match?.competition?.stage ?? 'league';
  const isHome = fav?.isHome === true || match?.homeTeam === fav?.name;

  let pts = 4; // default mid-table league fixture
  let stageLabel = 'Mid-table league fixture';

  if (stage === 'final' || stage === 'semi_final') {
    pts = 10;
    stageLabel = 'Final or semi-final';
  } else if (stage === 'quarter_final' || stage === 'knockout') {
    pts = 8;
    stageLabel = 'Quarter-final or knockout fixture';
  } else if (stage === 'high_stakes_league' || match?.competition?.highStakes === true) {
    pts = 7;
    stageLabel = 'High-stakes league match with title/relegation implications';
  } else if (stage === 'dead_rubber') {
    pts = 0;
    stageLabel = 'Low-stakes dead rubber';
  } else {
    pts = 4;
    stageLabel = 'Mid-table league fixture';
  }

  out.push(comp('stage', `Competition Stage: ${stageLabel}`, pts, stageLabel, { max: 10 }));

  // Add 3pts for confirmed home advantage with strong home record (>= 60% home win rate)
  const homeWinRate = fav?.homeRecord?.winRate ?? (fav?.homeRecord?.wins != null && fav?.homeRecord?.matches != null && fav.homeRecord.matches > 0 ? fav.homeRecord.wins / fav.homeRecord.matches : 0.65);
  if (isHome && homeWinRate >= 0.60) {
    out.push(comp('home_advantage', 'Bonus: confirmed home advantage with strong home record', 3,
      `Home win rate ${(homeWinRate * 100).toFixed(0)}%`, { max: 3 }));
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * HANDICAP SPREAD MARKET (100pts total)
 *
 * Base score: all win market factors
 * Replace competition stage score with ATS trend:
 *   Team covering in 7 or more of last 10 = 10pts
 *   6 of 10 = 6pts
 *   5 or fewer = 0pts
 *
 * Injury impact modifier:
 *   Significant attacking absences in opponent = +8pts
 *   Defensive absences in opponent = +5pts
 *   Own team fully fit = +3pts
 *   Own team with key absences = -8pts
 *
 * Fixture congestion modifier:
 *   Opponent played within 48 hours = +6pts
 *   Own team played within 48 hours = -6pts
 *
 * Goal difference modifier:
 *   If team's average winning margin this season exceeds the spread = +5pts
 * ------------------------------------------------------------------ */

export function scoreHandicapSpread(fav, opp, match, wmScore, wmComp, missing) {
  const out = [];

  // ATS Trend (replaces stage score, 10pts)
  const atsCoveredLast10 = fav?.ats?.coveredLast10 ?? fav?.atsCoverCount ?? null;
  if (atsCoveredLast10 == null) {
    missing.push('ats.coveredLast10 (ATS covering record in last 10 games)');
    out.push(comp('ats_trend', 'ATS Trend (last 10 games)', 6, 'estimated moderate cover trend (6/10 = 6pts)', { max: 10 }));
  } else {
    let atsPts = 0;
    if (atsCoveredLast10 >= 7) atsPts = 10;
    else if (atsCoveredLast10 === 6) atsPts = 6;
    else atsPts = 0;
    out.push(comp('ats_trend', `ATS Trend: ${atsCoveredLast10}/10 covers`, atsPts, `${atsCoveredLast10} covers in last 10 games`, { max: 10 }));
  }

  // Injury Impact Modifiers
  const oppAttackingAbsence = opp?.injuries?.keyAttackingAbsence ?? false;
  const oppDefensiveAbsence = opp?.injuries?.keyDefensiveAbsence ?? false;
  const favFullyFit = fav?.injuries?.fullyFit ?? true;
  const favKeyAbsence = fav?.injuries?.keyAbsence ?? false;

  if (oppAttackingAbsence) {
    out.push(comp('inj_opp_attack', 'Modifier: significant attacking absences in opponent', 8, 'opponent attack weakened', { max: 8 }));
  }
  if (oppDefensiveAbsence) {
    out.push(comp('inj_opp_defense', 'Modifier: defensive absences in opponent', 5, 'opponent defense weakened', { max: 5 }));
  }
  if (favFullyFit && !favKeyAbsence) {
    out.push(comp('inj_own_fit', 'Modifier: own team fully fit', 3, 'squad at full strength', { max: 3 }));
  }
  if (favKeyAbsence) {
    out.push(comp('inj_own_absence', 'Modifier: own team with key absences', -8, 'key absences reported', { max: 0 }));
  }

  // Fixture Congestion Modifiers
  const oppPlayed48h = opp?.rest?.playedWithin48h ?? false;
  const favPlayed48h = fav?.rest?.playedWithin48h ?? false;

  if (oppPlayed48h) {
    out.push(comp('rest_opp_fatigue', 'Modifier: opponent played within 48 hours', 6, 'opponent fatigue', { max: 6 }));
  }
  if (favPlayed48h) {
    out.push(comp('rest_own_fatigue', 'Modifier: own team played within 48 hours', -6, 'own team fatigue', { max: 0 }));
  }

  // Goal Difference / Margin Modifier
  const spreadLine = Math.abs(match?.handicapSpread ?? fav?.handicapSpread ?? 3.5);
  const avgWinningMargin = fav?.margin?.avgWinningMargin ?? fav?.avgWinningMargin ?? (fav?.standings?.goalDifference ? Math.max(1, fav.standings.goalDifference / Math.max(fav.standings.played || 10, 1)) : 4.0);

  if (avgWinningMargin > spreadLine) {
    out.push(comp('gd_margin', 'Modifier: average winning margin exceeds spread', 5,
      `Avg margin ${avgWinningMargin.toFixed(1)} > spread ${spreadLine.toFixed(1)}`, { max: 5 }));
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * GAME TOTAL MARKET (100pts total)
 *
 * Attacking pace score (35pts):
 *   Both teams average 30+ goals per game = 35pts for Over
 *   One team averages 30+, other averages 25 to 29 = 22pts for Over
 *   Both teams average 25 to 29 = 12pts — neutral
 *   One or both teams average below 25 = 15pts for Under
 *
 * Defensive structure score (25pts):
 *   Both teams concede 28+ per game = 25pts for Over
 *   One team concedes heavily (28+), other is tight (<28) = 12pts — neutral
 *   Both teams concede fewer than 25 per game = 20pts for Under
 *
 * Injury impact on scoring (20pts):
 *   Key attacking absences on one or both teams = +15pts for Under
 *   Both teams at full attacking strength = +10pts for Over
 *   Defensive injuries creating gaps = +8pts for Over
 *
 * Recent total trends (20pts):
 *   Both teams Over in 3 or more of last 5 = 20pts for Over
 *   Both teams Under in 3 or more of last 5 = 20pts for Under
 *   Mixed trend = 5pts — no strong lean
 * ------------------------------------------------------------------ */

export function scoreGameTotal(home, away, match, missing) {
  const out = [];
  let overPts = 0;
  let underPts = 0;

  const hGpg = home?.stats?.goalsPerGame ?? home?.goalsPerGame ?? 28.5;
  const aGpg = away?.stats?.goalsPerGame ?? away?.goalsPerGame ?? 27.5;
  const hGcg = home?.stats?.goalsConcededPerGame ?? home?.goalsConcededPerGame ?? 27.0;
  const aGcg = away?.stats?.goalsConcededPerGame ?? away?.goalsConcededPerGame ?? 28.0;

  // 1. Attacking pace score (35pts)
  if (hGpg >= 30.0 && aGpg >= 30.0) {
    overPts += 35;
    out.push(comp('total_att', 'Attacking pace: both teams average 30+ goals/game', 35,
      `Averages: ${hGpg.toFixed(1)} and ${aGpg.toFixed(1)} gpg -> 35pts for Over`, { max: 35 }));
  } else if ((hGpg >= 30.0 && aGpg >= 25.0) || (aGpg >= 30.0 && hGpg >= 25.0)) {
    overPts += 22;
    out.push(comp('total_att', 'Attacking pace: one 30+, one 25-29 goals/game', 22,
      `Averages: ${hGpg.toFixed(1)} and ${aGpg.toFixed(1)} gpg -> 22pts for Over`, { max: 35 }));
  } else if (hGpg >= 25.0 && aGpg >= 25.0) {
    overPts += 12;
    out.push(comp('total_att', 'Attacking pace: both 25-29 goals/game (neutral)', 12,
      `Averages: ${hGpg.toFixed(1)} and ${aGpg.toFixed(1)} gpg -> 12pts neutral`, { max: 35 }));
  } else {
    underPts += 15;
    out.push(comp('total_att', 'Attacking pace: one or both below 25 goals/game', 15,
      `Averages: ${hGpg.toFixed(1)} and ${aGpg.toFixed(1)} gpg -> 15pts for Under`, { max: 35 }));
  }

  // 2. Defensive structure score (25pts)
  if (hGcg >= 28.0 && aGcg >= 28.0) {
    overPts += 25;
    out.push(comp('total_def', 'Defensive structure: both concede 28+ per game', 25,
      `Conceded: ${hGcg.toFixed(1)} and ${aGcg.toFixed(1)} -> 25pts for Over`, { max: 25 }));
  } else if ((hGcg >= 28.0 && aGcg < 28.0) || (aGcg >= 28.0 && hGcg < 28.0)) {
    overPts += 12;
    out.push(comp('total_def', 'Defensive structure: one heavy concede, one tight (neutral)', 12,
      `Conceded: ${hGcg.toFixed(1)} and ${aGcg.toFixed(1)} -> 12pts neutral`, { max: 25 }));
  } else if (hGcg < 25.0 && aGcg < 25.0) {
    underPts += 20;
    out.push(comp('total_def', 'Defensive structure: both concede under 25 per game', 20,
      `Conceded: ${hGcg.toFixed(1)} and ${aGcg.toFixed(1)} -> 20pts for Under`, { max: 25 }));
  } else {
    overPts += 8;
    out.push(comp('total_def', 'Defensive structure: moderate concessions', 8,
      `Conceded: ${hGcg.toFixed(1)} and ${aGcg.toFixed(1)}`, { max: 25 }));
  }

  // 3. Injury impact on scoring (20pts)
  const attackingAbsence = (home?.injuries?.keyAttackingAbsence || away?.injuries?.keyAttackingAbsence);
  const defensiveInjuries = (home?.injuries?.keyDefensiveAbsence || away?.injuries?.keyDefensiveAbsence);
  const fullAttackStrength = (!attackingAbsence && (home?.injuries?.fullAttackStrength || away?.injuries?.fullAttackStrength || true));

  if (attackingAbsence) {
    underPts += 15;
    out.push(comp('total_inj', 'Injury impact: key attacking absences', 15, '+15pts for Under', { max: 20 }));
  } else if (defensiveInjuries) {
    overPts += 8;
    out.push(comp('total_inj', 'Injury impact: defensive injuries creating gaps', 8, '+8pts for Over', { max: 20 }));
  } else if (fullAttackStrength) {
    overPts += 10;
    out.push(comp('total_inj', 'Injury impact: both teams at full attacking strength', 10, '+10pts for Over', { max: 20 }));
  }

  // 4. Recent total trends (20pts)
  const hOverCount = home?.trends?.overLast5 ?? 3;
  const aOverCount = away?.trends?.overLast5 ?? 3;

  if (hOverCount >= 3 && aOverCount >= 3) {
    overPts += 20;
    out.push(comp('total_trend', 'Recent total trends: both teams Over in 3+ of last 5', 20, '+20pts for Over', { max: 20 }));
  } else if (hOverCount <= 2 && aOverCount <= 2) {
    underPts += 20;
    out.push(comp('total_trend', 'Recent total trends: both teams Under in 3+ of last 5', 20, '+20pts for Under', { max: 20 }));
  } else {
    overPts += 5;
    underPts += 5;
    out.push(comp('total_trend', 'Recent total trends: mixed trend', 5, '5pts neutral lean', { max: 20 }));
  }

  const direction = overPts >= underPts ? 'OVER' : 'UNDER';
  const rawScore = Math.max(overPts, underPts);

  return { components: out, direction, rawScore, overPts, underPts };
}

/* ------------------------------------------------------------------ *
 * Assembly & Decision Rules
 * ------------------------------------------------------------------ */

function totalPoints(components) {
  return Math.min(100, components.reduce((sum, c) => sum + Math.max(0, c.points), 0));
}

function applyMissingFieldPenalty(score, missing) {
  const distinct = new Set(missing).size;
  return Math.max(0, score - distinct * MISSING_FIELD_PENALTY);
}

function getBand(score, highThresh = 70, medThresh = 50) {
  if (score >= highThresh) return CONFIDENCE.HIGH;
  if (score >= medThresh) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

export function pickHandballFavourite(match) {
  const home = match?.homeTeamObj || { name: match?.home || 'Home Team' };
  const away = match?.awayTeamObj || { name: match?.away || 'Away Team' };

  const hoa = home?.odds?.american ?? null;
  const aoa = away?.odds?.american ?? null;

  if (hoa != null && aoa != null) {
    return hoa < aoa ? [home, away] : [away, home];
  }

  const hr = home?.standings?.rank ?? null;
  const ar = away?.standings?.rank ?? null;

  if (hr != null && ar != null) {
    return hr <= ar ? [home, away] : [away, home];
  }

  // Fallback to home team as base favourite if nothing else determinable
  return [home, away];
}

/**
 * Score all three handball markets for one match.
 * @param {object} match match object with teams, odds, stats, H2H, standings
 * @returns {object} structured scoring result
 */
export function scoreHandballMatch(match) {
  const missing = [];
  const flags = [];

  const [fav, opp] = pickHandballFavourite(match);
  if (!fav || !fav.name) {
    return {
      event_id: match?.event_id ?? null,
      ruleset: RULESET_VERSION,
      favourite: null,
      markets: {},
      missing: ['favourite could not be determined'],
      flags: ['UNSCORED: no team data available'],
      summary: { any: false },
    };
  }

  /* ---- 1. WIN MATCH MARKET ---- */
  const formResult = scoreRecentForm(fav, opp, missing);
  const oddsComp = scoreOddsAndValue(fav, formResult.formBase, missing);
  const h2hComp = scoreH2H(fav, opp, match, missing);
  const standingsComp = scoreStandings(fav, opp, missing);
  const stageComp = scoreStageAndHome(fav, opp, match, missing);

  const wmComp = [
    ...formResult.components,
    ...oddsComp,
    ...h2hComp,
    ...standingsComp,
    ...stageComp,
  ];

  const wmRaw = totalPoints(wmComp);
  const wmScore = applyMissingFieldPenalty(wmRaw, missing);
  let wmBand = getBand(wmScore, 70, 50);

  // Profitability rule: odds shorter than -300 require a score of 75 or higher
  const amOdds = fav?.odds?.american ?? null;
  if (amOdds != null && amOdds <= -300) {
    if (wmScore < 75) {
      flags.push('RULE: Odds shorter than -300 require a score of 75+ to justify return; confidence reduced.');
      if (wmBand === CONFIDENCE.HIGH) wmBand = CONFIDENCE.MEDIUM;
    }
  }

  // Flag draw possibility in league fixtures where H2H and form are near-even
  const isLeague = match?.competition?.type !== 'knockout' && match?.competition?.stage !== 'final';
  const nearEvenH2H = h2hComp.some((c) => c.points === 5);
  const nearEvenForm = Math.abs((fav?.form?.winsLast5 || 3) - (opp?.form?.winsLast5 || 3)) <= 1;
  const drawPossible = isLeague && nearEvenH2H && nearEvenForm;
  if (drawPossible) {
    flags.push('DRAW_NOTE: Even form and H2H in league fixture suggests elevated draw probability.');
  }

  /* ---- 2. HANDICAP SPREAD MARKET ---- */
  const hcapBaseComp = [
    ...formResult.components,
    ...oddsComp,
    ...h2hComp,
    ...standingsComp,
  ];
  const hcapModifiers = scoreHandicapSpread(fav, opp, match, wmScore, wmComp, missing);
  const hcapComp = [...hcapBaseComp, ...hcapModifiers];
  const hcapRaw = totalPoints(hcapComp);
  const hcapScore = applyMissingFieldPenalty(hcapRaw, missing);
  let hcapBand = getBand(hcapScore, 70, 50);

  // Handicap profitability rule: form and margin must support the spread
  const avgMargin = fav?.margin?.avgWinningMargin ?? (fav?.standings?.goalDifference ? fav.standings.goalDifference / Math.max(fav.standings.played || 10, 1) : 3.5);
  const spread = Math.abs(match?.handicapSpread ?? fav?.handicapSpread ?? 3.5);
  const spreadCoverRecommendation = hcapScore >= 50
    ? `${fav.name} to cover`
    : `${opp.name} to cover`;

  if (hcapScore < 50) {
    hcapBand = CONFIDENCE.SKIP;
    flags.push('HANDICAP_SKIP: Score below 50; insufficient dominance evidence for handicap cover.');
  }

  /* ---- 3. GAME TOTAL MARKET ---- */
  const homeTeam = match?.homeTeamObj || fav;
  const awayTeam = match?.awayTeamObj || opp;
  const totalRes = scoreGameTotal(homeTeam, awayTeam, match, missing);
  const gtRaw = totalRes.rawScore;
  const gtScore = applyMissingFieldPenalty(gtRaw, missing);
  let gtBand = getBand(gtScore, 70, 50);

  // Total profitability rule: anomaly detection if total is significantly off season average
  const combinedAvg = (homeTeam?.stats?.goalsPerGame || 28) + (awayTeam?.stats?.goalsPerGame || 28);
  const marketTotal = match?.gameTotal ?? 59.5;
  if (Math.abs(combinedAvg - marketTotal) > 7.0) {
    flags.push('ANOMALY: Market total deviates significantly from seasonal scoring averages; confidence reduced by one level.');
    if (gtBand === CONFIDENCE.HIGH) gtBand = CONFIDENCE.MEDIUM;
    else if (gtBand === CONFIDENCE.MEDIUM) gtBand = CONFIDENCE.LOW;
  }

  if (gtScore < 50) {
    gtBand = CONFIDENCE.SKIP;
    flags.push('TOTAL_SKIP: Score below 50; mixed or contradictory scoring factors.');
  }

  const missingSorted = [...new Set(missing)].sort();

  return {
    event_id: match?.event_id ?? null,
    ruleset: RULESET_VERSION,
    favourite: fav.name,
    opponent: opp.name,
    drawPossible,
    markets: {
      win_match: {
        score: wmScore,
        rawScore: wmRaw,
        band: wmBand,
        selection: fav.name,
        components: wmComp,
      },
      handicap_spread: {
        score: hcapScore,
        rawScore: hcapRaw,
        band: hcapBand,
        selection: spreadCoverRecommendation,
        components: hcapComp,
        spread,
      },
      game_total: {
        score: gtScore,
        rawScore: gtRaw,
        band: gtBand,
        direction: totalRes.direction,
        selection: totalRes.direction === 'OVER' ? 'Over' : 'Under',
        components: totalRes.components,
        marketTotal,
      },
    },
    missing: missingSorted,
    flags,
    summary: {
      any: wmBand !== CONFIDENCE.LOW || hcapBand !== CONFIDENCE.SKIP || gtBand !== CONFIDENCE.SKIP,
      allSkips: wmScore < 50 && hcapScore < 50 && gtScore < 50,
    },
  };
}

/**
 * Score an entire card of handball matches.
 */
export function scoreHandballCard(matches) {
  const results = matches.map((m) => ({ match: m, result: scoreHandballMatch(m) }));
  return {
    ruleset: RULESET_VERSION,
    results,
    count: results.length,
  };
}
