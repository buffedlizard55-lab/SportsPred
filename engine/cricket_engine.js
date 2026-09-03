/**
 * SportsPred — Cricket Scoring Engine (Canonical Implementation).
 *
 * Implements "CRICKET PREDICTION MASTER PROMPT v1.0", Step 2 (market scoring)
 * and Step 3 (decision rules) exactly as specified. Four markets per match:
 *   WIN MATCH, MAN OF THE MATCH, TOP TEAM 1 BATSMAN, TOP TEAM 2 BATSMAN.
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

export const FORMATS = { T20: 'T20', ODI: 'ODI', TEST: 'TEST', OTHER: 'OTHER' };

/** Cost, in points, of each distinct input factor that could not be sourced. */
const MISSING_FIELD_PENALTY = 5;

/* ------------------------------------------------------------------ *
 * Odds helpers
 * ------------------------------------------------------------------ */

/** Decimal odds -> American. 2.00 -> +100, 1.50 -> -200, 1.30 -> -333. */
export function decimalToAmerican(decimal) {
  if (decimal == null || !isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/**
 * Normalise any odds input to { decimal, american }.
 * Accepts decimal (1.35 / 2.10), American (-280 / +150), or an object
 * { decimal } or { american }. Ambiguous positive integers (>= 100) that arrive
 * as a bare number are treated as American odds, since decimal prices are never
 * whole hundreds; callers should pass an explicit { american } to be certain.
 */
export function normaliseOdds(raw) {
  if (raw == null) return null;

  const americanToDecimal = (am) => (am > 0 ? am / 100 + 1 : 100 / -am + 1);

  let decimal = null;
  let american = null;
  if (typeof raw === 'object') {
    if (raw.american != null) {
      american = Number(raw.american);
      decimal = americanToDecimal(american);
    } else if (raw.decimal != null) {
      decimal = Number(raw.decimal);
      american = decimalToAmerican(decimal);
    }
  } else {
    const n = typeof raw === 'string' ? Number(raw.replace('+', '')) : raw;
    if (!isFinite(n)) return null;
    if (n < 0 || Number.isInteger(n) && Math.abs(n) >= 100) {
      // American odds (negative favourite or large positive underdog line).
      american = n;
      decimal = americanToDecimal(n);
    } else {
      decimal = n;
      american = decimalToAmerican(decimal);
    }
  }
  if (decimal == null || !isFinite(decimal) || decimal <= 1.0) return null;
  return { decimal: Number(decimal.toFixed(3)), american };
}

function comp(id, label, points, detail, { max = null, missing = null } = {}) {
  return { id, label, points, max, detail, missing: missing ?? false };
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * WIN MATCH MARKET (100pts)
 *
 * Recent Form (25pts) + bonuses
 * Head-to-Head Record (20pts) + bonus
 * Bowling Attack vs Opponent Batting Matchup (20pts) + bonus
 * Batting Depth and Scoring Power (20pts) + bonus
 * Odds and Value Assessment (15pts) + deduction
 * ------------------------------------------------------------------ */

function scoreWinRecentForm(team, opp, missing) {
  const out = [];
  const rawLast5 = Array.isArray(team?.form?.last5) ? team.form.last5 : [];
  const decided = rawLast5.filter((r) => r === 'W' || r === 'L' || r === 'T' || r === 'D');
  // We need at least one sourced decided result to score; a near-empty tape
  // (n < 3) is scored on what exists but flagged as a thin sample.
  if (!decided.length) {
    missing.push('team.form.last5 (last 5 match results, last month)');
    out.push(comp('wm_form', 'Recent Form (last month, recent double weighted)', 0,
      'no sourced recent results in the window', { max: 25, missing: true }));
    return out;
  }
  const last5 = decided.slice(0, 5);
  if (last5.length < 3) {
    missing.push('team.form.last5 (full 5-match sample; only partial results in window)');
  }
  const wins = last5.slice(0, 5).filter((r) => r === 'W').length;
  let pts = 0;
  if (wins >= 4) pts = 25;
  else if (wins === 3) pts = 17;
  else if (wins === 2) pts = 9;
  else pts = 0;
  out.push(comp('wm_form', `Recent Form: ${wins} wins in last 5`, pts,
    `${wins}/5 recent matches won`, { max: 25 }));

  if (num(team?.form?.winStreak) >= 3 || wins >= 3 && last5.slice(0, 3).every((r) => r === 'W')) {
    out.push(comp('wm_form_streak', 'Bonus: winning streak of 3+ in current tournament', 5,
      'three or more consecutive wins', { max: 5 }));
  }
  const oppLast5 = Array.isArray(opp?.form?.last5) ? opp.form.last5 : [];
  const oppLosses = oppLast5.slice(0, 5).filter((r) => r === 'L').length;
  if (oppLosses >= 3) {
    out.push(comp('wm_form_opp_loss', 'Bonus: opponent has lost 3+ of last 5', 4,
      `opponent ${oppLosses} losses in last 5`, { max: 4 }));
  }
  return out;
}

/**
 * A head-to-head block may be written from one side's perspective. When the
 * block names that side in `h2h.team`, flip it for the other side so the two
 * sides are not awarded identical points. Blocks without a `team` field are
 * returned untouched, so every existing caller behaves exactly as before.
 * (Found while wiring the T20 Blast engine: logged as TB-IR-09.)
 */
export function orientH2H(h2h, teamName) {
  if (!h2h || typeof h2h !== 'object') return h2h;
  if (!h2h.team || !teamName || h2h.team === teamName) return h2h;
  const total = Number(h2h.totalMeetings) || 0;
  const wins = Number(h2h.teamWins) || 0;
  const flip = (r) => (r === 'W' ? 'L' : r === 'L' ? 'W' : r);
  return {
    ...h2h,
    team: teamName,
    teamWins: Math.max(0, total - wins),
    recentMeetings: Array.isArray(h2h.recentMeetings) ? h2h.recentMeetings.map(flip) : h2h.recentMeetings,
    oriented_from: h2h.team,
  };
}

function scoreWinH2H(team, opp, match, missing) {
  const out = [];
  const h2h = orientH2H(match?.h2h, team?.name);
  const total = num(h2h?.totalMeetings);
  const teamWins = num(h2h?.teamWins);
  if (!total || total === 0 || teamWins == null) {
    missing.push('match.h2h (head-to-head over last 3 years)');
    out.push(comp('wm_h2h', 'Head-to-Head Record (last 3 years)', 0,
      'no sourced H2H meetings', { max: 20, missing: true }));
    return out;
  }
  // Weight the most recent 3 meetings double.
  const recent = Array.isArray(h2h.recentMeetings) ? h2h.recentMeetings.slice(0, 3) : [];
  let weightedWins = teamWins;
  let weightedTotal = total;
  if (recent.length) {
    weightedWins += recent.filter((r) => r === 'W').length;
    weightedTotal += recent.length;
  }
  const rate = weightedWins / weightedTotal;
  let pts = 0;
  const rawRate = teamWins / total;
  if (rawRate >= 0.6 || teamWins >= 6 && total >= 10) pts = 20;
  else if (rawRate >= 0.5 || (total >= 10 && teamWins === 5)) pts = 13;
  else if (rawRate >= 0.4) pts = 7;
  else pts = 0;
  out.push(comp('wm_h2h', `Head-to-Head: ${teamWins}/${total} wins`, pts,
    `weighted recent win rate ${(rate * 100).toFixed(0)}% (last 3 meetings weighted double)`, { max: 20 }));

  if (recent.length >= 3 && recent.every((r) => r === 'W') && h2h?.sameVenueType !== false) {
    out.push(comp('wm_h2h_sweep', 'Bonus: won last 3 consecutive H2H at this venue type', 5,
      'three straight head-to-head wins', { max: 5 }));
  }
  return out;
}

/**
 * Bowling attack vs opponent batting matchup (20pts).
 * team.bowling.style: 'spin' | 'pace' | 'mixed'
 * opp.batting.weakness: 'spin' | 'pace' | 'mixed' | null
 * match.pitch.favours: 'spin' | 'pace' | 'batting' | null
 */
function scoreBowlingMatchup(team, opp, match, missing) {
  const out = [];
  const style = team?.bowling?.style || null;
  const weakness = opp?.batting?.weakness || null;
  const pitch = match?.pitch?.favours || null;

  if (!style || !weakness) {
    missing.push('bowling.style / opp.batting.weakness (spin vs pace matchup)');
    out.push(comp('wm_bowl', 'Bowling Attack vs Opponent Batting Matchup', 0,
      'no sourced bowling-style or opponent-weakness data', { max: 20, missing: true }));
    return out;
  }

  let pts;
  let detail;
  if ((style === 'spin' && weakness === 'spin') || (style === 'pace' && weakness === 'pace')) {
    pts = 20; detail = `primary ${style} threat directly exploits confirmed opponent weakness`;
  } else if (style !== 'mixed' && weakness === 'mixed') {
    pts = 13; detail = `strong ${style} attack against a mixed opponent lineup`;
  } else if (style === 'mixed') {
    pts = 6; detail = 'no clear bowling advantage — balanced attack';
  } else {
    pts = 0; detail = 'opponent strong against this bowling type';
  }
  out.push(comp('wm_bowl', 'Bowling Attack vs Opponent Batting Matchup', pts, detail, { max: 20 }));

  if (pitch && ((pitch === 'spin' && style === 'spin') || (pitch === 'pace' && style === 'pace'))) {
    out.push(comp('wm_bowl_pitch', 'Bonus: pitch report strongly favours team bowling style', 4,
      `conditions favour ${style}`, { max: 4 }));
  }
  return out;
}

/** Batting depth and scoring power (20pts). */
function scoreBattingDepth(team, opp, missing) {
  const out = [];
  const inForm = Array.isArray(team?.batting?.inFormBatsmen) ? team.batting.inFormBatsmen : null;
  if (!inForm) {
    missing.push('team.batting.inFormBatsmen (batsmen in strong recent form)');
    out.push(comp('wm_bat', 'Batting Depth and Scoring Power', 0,
      'no sourced recent batting-form data', { max: 20, missing: true }));
    return out;
  }
  const n = inForm.length;
  let pts = n >= 3 ? 20 : n === 2 ? 13 : n === 1 ? 7 : 0;
  out.push(comp('wm_bat', `Batting Depth: ${n} batsmen in strong recent form`, pts,
    `${n} top-order/middle-order batsmen above tournament average`, { max: 20 }));

  const oppWeakBowl = opp?.bowling?.belowAverage === true || num(opp?.bowling?.economy) != null && num(opp.bowling.economy) > 8.5;
  if (oppWeakBowl) {
    out.push(comp('wm_bat_oppbowl', 'Bonus: opponent bowling attack weakened / below-average economy', 4,
      'opposition leakiness supports scoring', { max: 4 }));
  }
  return out;
}

/** Odds and value assessment (15pts). American odds. */
function scoreWinOdds(team, formComponents, missing) {
  const out = [];
  const norm = normaliseOdds(team?.odds?.win ?? team?.odds);
  const am = norm?.american ?? null;
  if (am == null) {
    missing.push('team.odds.win (match winner odds, cross-referenced)');
    out.push(comp('wm_odds', 'Odds and Value Assessment', 0,
      'no sourced match-winner odds', { max: 15, missing: true }));
    return out;
  }
  let pts;
  if (am <= -250) pts = 15;
  else if (am <= -180) pts = 11;
  else if (am <= -130) pts = 7;
  else if (am <= -100) pts = 4;
  else pts = 4; // positive / underdog prices handled below
  let detail = `priced at American ${am}`;

  const formComp = Array.isArray(formComponents) ? formComponents.find((c) => c.id === 'wm_form') : null;
  const formPts = formComp?.points ?? 0;

  // Underdog value flag: positive odds but with H2H + bowling advantage.
  if (am > 0) {
    pts = 4;
    out.push(comp('wm_odds_value', 'Value flag: underdog price — needs H2H + bowling edge', 0,
      'underdog; value only if matchup supports it', { max: 0 }));
  }
  out.push(comp('wm_odds', 'Odds and Value Assessment', pts, detail, { max: 15 }));

  // Deduct 7pts if odds shorter than -250 but team lost 3+ of last 5.
  const last5 = Array.isArray(team?.form?.last5) ? team.form.last5 : [];
  const losses = last5.slice(0, 5).filter((r) => r === 'L').length;
  if (am <= -250 && losses >= 3) {
    out.push(comp('wm_odds_trap', 'Deduction: heavy favourite but 3+ losses in last 5', -7,
      'favourite-trap penalty', { max: 0 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * MAN OF THE MATCH MARKET (100pts)
 *
 * Recent individual form (35pts) + all-rounder bonus (+5)
 * Matchup advantage for this player (25pts)
 * Batting position and opportunity (20pts) - deduction
 * Odds value assessment (20pts)
 * All-rounders auto-elevated +5 (Step 3).
 * ------------------------------------------------------------------ */

function playerRecentForm(p, missing) {
  const out = [];
  const perf = p?.recent || null;
  const matches = num(perf?.matches) ?? 0;
  const bigKnocks = num(perf?.fiftyOrWicket3) ?? null; // 50+ runs OR 3+ wickets count
  if (bigKnocks == null) {
    missing.push(`player.${p?.id || '?'}.recent (last-5 runs/wickets form)`);
    out.push(comp('mom_form', 'Recent Individual Form (last 5)', 0,
      'no sourced last-5 player performance data', { max: 35, missing: true }));
    return out;
  }
  let pts = bigKnocks >= 3 ? 35 : bigKnocks === 2 ? 23 : bigKnocks === 1 ? 12 : 0;
  out.push(comp('mom_form', `Recent Form: ${bigKnocks} standout performances in last ${Math.max(matches, 5)}`,
    pts, `${bigKnocks} matches with fifty or three-wicket haul`, { max: 35 }));

  // All-rounder bonus: contributed with both bat and ball in last 3.
  if (p?.role === 'allrounder' || (p?.battingStyle && p?.bowlingStyle)) {
    const both = perf?.allRoundContributions ?? null;
    if (both == null) {
      missing.push('player.allRoundContributions (bat+ball in last 3)');
    } else if (both >= 1) {
      out.push(comp('mom_form_allround', 'Bonus: all-rounder contributing bat and ball in last 3', 5,
        'dual pathway to impact', { max: 5 }));
    }
  }
  return out;
}

function playerMatchup(p, match, missing) {
  const out = [];
  const pitch = match?.pitch?.favours || null;
  const role = p?.role || null;
  const bowlsSpin = p?.bowlingStyle === 'spin';
  const bowlsPace = p?.bowlingStyle === 'pace';
  const topOrder = (num(p?.battingPosition) ?? 99) <= 3;
  const aggressive = p?.battingStyle === 'aggressive';
  const countersThreat = p?.countersOppositionThreat === true;

  if (!pitch && !countersThreat) {
    missing.push('match.pitch.favours (confirmed pitch report for player matchup)');
    out.push(comp('mom_matchup', 'Matchup Advantage for Player', 5,
      'no specific matchup advantage sourced', { max: 25 }));
    return out;
  }

  let pts = 5;
  let detail = 'no specific matchup advantage';
  if (bowlsSpin && pitch === 'spin') {
    pts = 25; detail = 'spinner on a confirmed spin-friendly pitch';
  } else if (bowlsPace && pitch === 'pace' && match?.opp?.topOrderVulnerable === true) {
    pts = 25; detail = 'pace bowler on a seaming pitch against a vulnerable top order';
  } else if (topOrder && aggressive && pitch === 'batting') {
    pts = 20; detail = 'aggressive top-order batsman on a flat batting pitch';
  } else if (countersThreat) {
    pts = 15; detail = "player's style directly counters the primary opposition threat";
  }
  out.push(comp('mom_matchup', 'Matchup Advantage for Player', pts, detail, { max: 25 }));
  return out;
}

function playerBattingPosition(p, match, missing) {
  const out = [];
  const pos = num(p?.battingPosition);
  const format = match?.format || FORMATS.OTHER;
  if (pos == null) {
    missing.push('player.battingPosition (confirmed batting order / starter status)');
    out.push(comp('mom_pos', 'Batting Position and Opportunity', 0,
      'no confirmed batting position — only confirmed starters eligible', { max: 20, missing: true }));
    return out;
  }
  let pts;
  if (pos <= 3) pts = 20;
  else if (pos <= 5) pts = 14;
  else if (pos === 6) pts = 9;
  else pts = 0;
  let detail = `bats at position ${pos}`;
  out.push(comp('mom_pos', 'Batting Position and Opportunity', pts, detail, { max: 20 }));

  const isFrontlineBowler = !!p?.bowlingStyle && (p?.opensBowling === true || p?.role === 'bowler' || p?.role === 'allrounder');
  if (pos >= 7 && !isFrontlineBowler) {
    out.push(comp('mom_pos_tail', 'Deduction: bats at 7 or lower without frontline bowling credentials', -10,
      'tail-end position, limited impact', { max: 0 }));
  }
  return out;
}

function playerOdds(p, missing) {
  const out = [];
  const norm = normaliseOdds(p?.odds?.mom ?? p?.odds);
  const am = norm?.american ?? null;
  if (am == null) {
    missing.push('player.odds.mom (man-of-the-match odds)');
    out.push(comp('mom_odds', 'Odds Value Assessment', 0,
      'no sourced man-of-the-match odds', { max: 20, missing: true }));
    return out;
  }
  let pts;
  let detail = `priced at American ${am}`;
  if (am >= 400 && am <= 900) pts = 20;
  else if (am >= 200 && am <= 399) pts = 13;
  else if (am < 200) pts = 7;
  else if (am > 1000) pts = 8;
  else pts = 7;
  out.push(comp('mom_odds', 'Odds Value Assessment', pts, detail, { max: 20 }));
  return out;
}

/**
 * Score a single Man of the Match candidate.
 * @returns object with score, band, components, missing, valueFlag
 */
export function scoreMomCandidate(p, match, allMissing) {
  const missing = [];
  const components = [
    ...playerRecentForm(p, missing),
    ...playerMatchup(p, match, missing),
    ...playerBattingPosition(p, match, missing),
    ...playerOdds(p, missing),
  ];

  // Step 3: all-rounders with both batting and bowling credentials auto-elevated +5.
  const isAllRounder = p?.role === 'allrounder' || (!!p?.battingStyle && !!p?.bowlingStyle && p?.role !== 'bowler');
  if (isAllRounder) {
    components.push(comp('mom_allround_elev', 'All-rounder elevation: dual bat+ball pathway', 5,
      'all-rounders win MoTM at disproportionately high rates', { max: 5 }));
  }

  // Eligibility: never recommend bottom-4 bats unless a frontline bowler who opens the bowling.
  const pos = num(p?.battingPosition) ?? 99;
  const frontline = !!p?.bowlingStyle && (p?.opensBowling === true || p?.role === 'bowler' || p?.role === 'allrounder');
  const eligible = pos <= 7 || frontline;

  let raw = components.reduce((s, c) => s + Math.max(0, c.points), 0);
  raw = Math.min(100, raw);
  const distinctMissing = new Set(missing).size;
  let score = Math.max(0, raw - distinctMissing * MISSING_FIELD_PENALTY);

  // High-odds value flag (+700 to +1600): only with near-certain bowling dominance or all-rounder form.
  const norm = normaliseOdds(p?.odds?.mom ?? p?.odds);
  const am = norm?.american ?? null;
  const highOddsValue = am != null && am >= 700 && am <= 1600;
  const pitchDominance = (match?.pitch?.favours === 'spin' && p?.bowlingStyle === 'spin') ||
                         (match?.pitch?.favours === 'pace' && p?.bowlingStyle === 'pace');
  const allRoundForm = isAllRounder && (num(p?.recent?.allRoundContributions) ?? 0) >= 1;
  const valueFlag = highOddsValue && (pitchDominance || allRoundForm);

  return {
    player: p,
    name: p?.name || 'Unknown',
    eligible,
    score,
    rawScore: raw,
    components,
    missing,
    isAllRounder,
    highOddsValue,
    valueFlag,
    oddsAmerican: am,
  };
}

/* ------------------------------------------------------------------ *
 * TOP BATSMAN MARKET (100pts) — identical methodology for both teams.
 *
 * Recent batting form in this format (35pts) + bonuses
 * Batting position and innings opportunity (25pts) - deduction
 * Strike rate and scoring style suitability (20pts)
 * Odds value (20pts)
 * ------------------------------------------------------------------ */

export function scoreBatsmanCandidate(p, team, match, sideLabel) {
  const missing = [];
  const components = [];

  // 1. Recent batting form (35pts)
  const scores40 = num(p?.recent?.scoresOver40) ?? null;
  if (scores40 == null) {
    missing.push('player.recent.scoresOver40 (40+ runs counts in last 5)');
    components.push(comp('tb_form', 'Recent Batting Form in this Format', 0,
      'no sourced last-5 batting scores', { max: 35, missing: true }));
  } else {
    const pts = scores40 >= 3 ? 35 : scores40 === 2 ? 23 : scores40 === 1 ? 12 : 0;
    components.push(comp('tb_form', `Recent Batting Form: ${scores40} scores of 40+ in last 5`, pts,
      `${scores40} starts past forty`, { max: 35 }));
    if (p?.recent?.fiftyLastMatch === true) {
      components.push(comp('tb_form_last50', 'Bonus: half-century in the most recent match', 6,
        'carried form into the latest fixture', { max: 6 }));
    }
    if (p?.recent?.strongVsOpposition === true) {
      components.push(comp('tb_form_vsopp', 'Bonus: strong record against this specific opposition', 5,
        'proven against this bowling attack', { max: 5 }));
    }
  }

  // 2. Batting position and innings opportunity (25pts)
  const pos = num(p?.battingPosition);
  if (pos == null) {
    missing.push('player.battingPosition (confirmed batting order)');
    components.push(comp('tb_pos', 'Batting Position and Innings Opportunity', 0,
      'no confirmed batting position', { max: 25, missing: true }));
  } else {
    const powerplayRecord = p?.powerplayRecord === 'strong';
    let pts;
    if (pos === 1 || pos === 2) pts = powerplayRecord ? 25 : 20;
    else if (pos === 3) pts = 20;
    else if (pos === 4 || pos === 5) pts = 14;
    else pts = 0;
    components.push(comp('tb_pos', `Batting Position: opens / bats at ${pos}`, pts,
      pos <= 3 ? 'top-order opportunity with maximum innings length' : 'middle-order role', { max: 25 }));
    if (pos >= 6) {
      components.push(comp('tb_pos_low', 'Ineligible: bats at 6 or lower — insufficient innings length', 0,
        'never recommended for top batsman markets', { max: 0 }));
    }
    if (p?.earlyWicketRisk === true && pos >= 3) {
      components.push(comp('tb_pos_risk', 'Deduction: early wickets projected before this player bats', -8,
        'reduced scoring opportunity', { max: 0 }));
    }
  }

  // 3. Strike rate suitability (20pts)
  const srVsAvg = p?.strikeRateVsTeamAvg || null; // 'above' | 'slightly_above' | 'average' | 'below'
  if (!srVsAvg) {
    missing.push('player.strikeRateVsTeamAvg (strike rate vs team average this format)');
    components.push(comp('tb_sr', 'Strike Rate and Scoring Style Suitability', 0,
      'no sourced strike-rate comparison', { max: 20, missing: true }));
  } else {
    const pts = srVsAvg === 'above' ? 20 : srVsAvg === 'slightly_above' ? 13 : srVsAvg === 'average' ? 6 : 0;
    components.push(comp('tb_sr', 'Strike Rate Suitability to Conditions', pts,
      `strike rate ${srVsAvg.replace('_', ' ')} team average`, { max: 20 }));
  }

  // 4. Odds value (20pts)
  const norm = normaliseOdds(p?.odds?.topBatsman ?? p?.odds);
  const am = norm?.american ?? null;
  if (am == null) {
    missing.push('player.odds.topBatsman (top team batsman odds)');
    components.push(comp('tb_odds', 'Odds Value', 0,
      'no sourced top-batsman odds', { max: 20, missing: true }));
  } else {
    let pts;
    if (am >= 200 && am <= 600) pts = 20;
    else if (am < 200) pts = 10;
    else if (am > 700) pts = 8;
    else pts = 10;
    components.push(comp('tb_odds', 'Odds Value', pts, `American ${am}`, { max: 20 }));
  }

  // Eligibility: never a number-6-or-lower batter.
  const eligible = (pos ?? 99) <= 5;

  let raw = Math.min(100, components.reduce((s, c) => s + Math.max(0, c.points), 0));
  const distinctMissing = new Set(missing).size;
  let score = Math.max(0, raw - distinctMissing * MISSING_FIELD_PENALTY);

  return {
    player: p,
    name: p?.name || 'Unknown',
    side: sideLabel,
    eligible,
    score,
    rawScore: raw,
    components,
    missing,
    oddsAmerican: am,
  };
}

/* ------------------------------------------------------------------ *
 * Assembly & Decision Rules (Step 3)
 * ------------------------------------------------------------------ */

function bandFor(score, highThresh, medThresh) {
  if (score >= highThresh) return CONFIDENCE.HIGH;
  if (score >= medThresh) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

/** Determine which side is "Team 1" and "Team 2" (home = team 1 by convention). */
export function orientTeams(match) {
  const home = match?.homeTeamObj || match?.home || null;
  const away = match?.awayTeamObj || match?.away || null;
  return { team1: home, team2: away };
}

/**
 * Score all four cricket markets for one match.
 */
export function scoreCricketMatch(match) {
  const missing = [];
  const flags = [];

  const home = match?.homeTeamObj || (match?.home ? { name: match.home } : null);
  const away = match?.awayTeamObj || (match?.away ? { name: match.away } : null);
  if (!home?.name || !away?.name) {
    return {
      event_id: match?.event_id ?? match?.competition_id ?? null,
      ruleset: RULESET_VERSION,
      favourite: null,
      markets: {},
      missing: ['two confirmed teams could not be resolved'],
      flags: ['UNSCORED: insufficient team data'],
      summary: { any: false, allSkips: true },
    };
  }

  /* ---- Favourite orientation for WIN MATCH (score both sides, take higher) ---- */
  const scoreSide = (team, opp) => {
    const localMissing = [];
    const components = [
      ...scoreWinRecentForm(team, opp, localMissing),
      ...scoreWinH2H(team, opp, match, localMissing),
      ...scoreBowlingMatchup(team, opp, match, localMissing),
      ...scoreBattingDepth(team, opp, localMissing),
      ...scoreWinOdds(team, null, localMissing),
    ];
    const raw = Math.min(100, components.reduce((s, c) => s + Math.max(0, c.points), 0));
    const score = Math.max(0, raw - new Set(localMissing).size * MISSING_FIELD_PENALTY);
    return { team, components, raw, score, missing: localMissing };
  };

  const homeSide = scoreSide(home, away);
  const awaySide = scoreSide(away, home);
  missing.push(...homeSide.missing, ...awaySide.missing);

  let favSide = homeSide.score >= awaySide.score ? homeSide : awaySide;
  let oppSide = favSide === homeSide ? awaySide : homeSide;
  // Odds-aware tie-break: if scores tie, prefer the shorter-priced side.
  if (homeSide.score === awaySide.score) {
    const ho = normaliseOdds(home?.odds?.win ?? home?.odds)?.american;
    const ao = normaliseOdds(away?.odds?.win ?? away?.odds)?.american;
    if (ho != null && ao != null && ho < ao) { favSide = homeSide; oppSide = awaySide; }
    else if (ho != null && ao != null && ao < ho) { favSide = awaySide; oppSide = homeSide; }
  }

  let wmBand = bandFor(favSide.score, 70, 55);
  if (wmBand === CONFIDENCE.LOW) wmBand = CONFIDENCE.SKIP;

  // Underdog value flag from prompt: positive odds but H2H + bowling advantage.
  const favOdds = normaliseOdds(favSide.team?.odds?.win ?? favSide.team?.odds);
  if (favOdds?.american != null && favOdds.american > 0) {
    const hasH2H = favSide.components.some((c) => c.id === 'wm_h2h' && c.points >= 13);
    const hasBowl = favSide.components.some((c) => c.id === 'wm_bowl' && c.points >= 13);
    if (hasH2H && hasBowl) flags.push('VALUE: underdog with H2H and bowling matchup advantage.');
  }

  /* ---- MAN OF THE MATCH ---- */
  const candidates = [];
  for (const t of [home, away]) {
    const pool = Array.isArray(t?.momCandidates) ? t.momCandidates
      : Array.isArray(t?.players) ? t.players : [];
    for (const p of pool) candidates.push(scoreMomCandidate(p, match, missing));
  }
  const eligibleCands = candidates.filter((c) => c.eligible);
  eligibleCands.sort((a, b) => b.score - a.score);
  const topMom = eligibleCands[0] || null;
  if (topMom) missing.push(...topMom.missing);

  let momBand = CONFIDENCE.SKIP;
  let momSelection = null;
  let momValueFlag = false;
  if (topMom) {
    // Step 3: HIGH requires 75+ AND odds in +400..+900 value zone.
    const am = topMom.oddsAmerican;
    const inValueZone = am != null && am >= 400 && am <= 900;
    if (topMom.score >= 75 && inValueZone) momBand = CONFIDENCE.HIGH;
    else if (topMom.score >= 65) momBand = CONFIDENCE.MEDIUM;
    else momBand = CONFIDENCE.SKIP;
    momSelection = topMom.name;
    momValueFlag = topMom.valueFlag;
    if (momValueFlag) flags.push('VALUE FLAG: Man of the Match in high-odds value zone (+700 to +1600).');
    // T20 pitching/bowling note
    if (match?.format === FORMATS.T20 && match?.pitch?.favours && match.pitch.favours !== 'batting') {
      flags.push('T20 NOTE: pitch assists bowling in powerplay; top-batsman confidence tempered.');
    }
  } else {
    missing.push('confirmed starting Man of the Match candidates');
  }

  /* ---- TOP TEAM BATSMAN (both sides independently) ---- */
  const scoreTopBatsman = (team, sideLabel) => {
    const pool = Array.isArray(team?.batsmanCandidates) ? team.batsmanCandidates
      : Array.isArray(team?.players) ? team.players : [];
    const scored = pool.map((p) => scoreBatsmanCandidate(p, team, match, sideLabel));
    const eligible = scored.filter((c) => c.eligible);
    eligible.sort((a, b) => b.score - a.score);
    const pick = eligible[0] || null;
    let band = CONFIDENCE.SKIP;
    if (pick) {
      band = bandFor(pick.score, 70, 55);
      if (band === CONFIDENCE.LOW) band = CONFIDENCE.SKIP;
      // T20 powerplay-bowling pitch: reduce top-batsman confidence one tier.
      if (match?.format === FORMATS.T20 && match?.pitch?.assistsBowlingPowerplay === true) {
        if (band === CONFIDENCE.HIGH) band = CONFIDENCE.MEDIUM;
        else if (band === CONFIDENCE.MEDIUM) band = CONFIDENCE.LOW;
      }
      missing.push(...pick.missing);
    } else {
      missing.push(`confirmed top-order batsmen for ${sideLabel}`);
    }
    return { pick, candidates: scored, band };
  };

  const tb1 = scoreTopBatsman(home, 'Team 1');
  const tb2 = scoreTopBatsman(away, 'Team 2');

  /* ---- Correlation rule: max 3 individual player markets per match ---- */
  const playerMarkets = [];
  if (momBand !== CONFIDENCE.SKIP) playerMarkets.push({ market: 'man_of_the_match', name: momSelection, band: momBand });
  if (tb1.band !== CONFIDENCE.SKIP) playerMarkets.push({ market: 'top_team1_batsman', name: tb1.pick?.name, band: tb1.band });
  if (tb2.band !== CONFIDENCE.SKIP) playerMarkets.push({ market: 'top_team2_batsman', name: tb2.pick?.name, band: tb2.band });
  if (playerMarkets.length > 3) {
    // Drop the lowest-confidence market.
    playerMarkets.sort((a, b) => confidenceRank(b.band) - confidenceRank(a.band));
    const drop = playerMarkets.pop();
    if (drop.market === 'man_of_the_match') momBand = CONFIDENCE.SKIP;
    if (drop.market === 'top_team1_batsman') tb1.band = CONFIDENCE.SKIP;
    if (drop.market === 'top_team2_batsman') tb2.band = CONFIDENCE.SKIP;
    flags.push(`CORRELATION: limited to 3 player markets; ${drop.market} withheld.`);
  }

  const missingSorted = [...new Set(missing)].sort();

  return {
    event_id: match?.event_id ?? match?.competition_id ?? null,
    ruleset: RULESET_VERSION,
    format: match?.format || FORMATS.OTHER,
    favourite: favSide.team?.name,
    opponent: oppSide.team?.name,
    markets: {
      win_match: {
        score: favSide.score,
        rawScore: favSide.raw,
        band: wmBand,
        selection: favSide.team?.name,
        components: favSide.components,
      },
      man_of_the_match: {
        score: topMom?.score ?? 0,
        rawScore: topMom?.rawScore ?? 0,
        band: momBand,
        selection: momSelection,
        valueFlag: momValueFlag,
        components: topMom?.components ?? [],
        candidates: eligibleCands.slice(0, 3).map((c) => ({ name: c.name, score: c.score, allRounder: c.isAllRounder })),
      },
      top_team1_batsman: {
        score: tb1.pick?.score ?? 0,
        rawScore: tb1.pick?.rawScore ?? 0,
        band: tb1.band,
        selection: tb1.pick?.name ?? null,
        team: home?.name,
        components: tb1.pick?.components ?? [],
      },
      top_team2_batsman: {
        score: tb2.pick?.score ?? 0,
        rawScore: tb2.pick?.rawScore ?? 0,
        band: tb2.band,
        selection: tb2.pick?.name ?? null,
        team: away?.name,
        components: tb2.pick?.components ?? [],
      },
    },
    missing: missingSorted,
    flags,
    summary: {
      any: wmBand !== CONFIDENCE.SKIP || momBand !== CONFIDENCE.SKIP || tb1.band !== CONFIDENCE.SKIP || tb2.band !== CONFIDENCE.SKIP,
      allSkips: wmBand === CONFIDENCE.SKIP && momBand === CONFIDENCE.SKIP && tb1.band === CONFIDENCE.SKIP && tb2.band === CONFIDENCE.SKIP,
    },
  };
}

function confidenceRank(band) {
  return { HIGH: 3, MEDIUM: 2, LOW: 1, SKIP: 0 }[band] ?? 0;
}

/** Score an entire card of cricket matches. */
export function scoreCricketCard(matches) {
  const results = (matches || []).map((m) => ({ match: m, result: scoreCricketMatch(m) }));
  return { ruleset: RULESET_VERSION, results, count: results.length };
}
