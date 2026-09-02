/**
 * SportsPred — Snooker Prediction Engine.
 *
 * Implements Step 2 (scoring) and Step 3 (bet-decision rules) of
 * "SNOOKER PREDICTION MASTER PROMPT v3.0":
 *
 *   STEP 2 — SCORE EACH MATCH OUT OF 100
 *     Odds Strength ......... 30 pts   -300 or lower = 30 · -200..-299 = 22
 *                                      -150..-199 = 14 · -100..-149 = 6 · near-even = 0
 *     Recent Form ........... 25 pts   5/5 = 25 · 4/5 = 18 · 3/5 = 10 · 2 or fewer = 0
 *                                      Bonus +5 for strong in-tournament form
 *     Head-to-Head .......... 20 pts   70%+ = 20 · 55-69% = 13 · roughly even = 5
 *                                      trailing = 0 (weighted toward the last 3 years)
 *     World Ranking ......... 15 pts   Top 5 = 15 · 6-10 = 10 · 11-20 = 5 · 21+ = 0
 *                                      Deduct 5 if the opponent is ranked higher
 *     Tournament Stage ...... 10 pts   Final/Semi = 10 · QF = 7 · R16 = 4 · early = 0
 *
 *   STEP 3 — BET DECISION RULES
 *     Score 70+ and odds -150 or lower               = Full Bet
 *     Score 50-69 and odds -130..-200, 2+ secondary
 *       factors aligned                              = Small Bet
 *     Score below 50 or contradicting factors        = Skip
 *     Odds -300 or lower require score 75+           = profitability check
 *
 * Pure: no I/O, no clock, no randomness. Every input is a profile built by
 * snooker_data.js from the committed, source-linked results tape, plus the
 * official WST ranking snapshot and (where a verified price exists) odds.
 *
 * WHAT THE SOURCES ACTUALLY PUBLISH (see docs/SNOOKER_IRREGULARITIES.md)
 *   - Last-five completed matches, in-tournament record: MEASURED from the
 *     results tape (snooker.org results database + WST match centres).
 *   - Head-to-head: MEASURED, zero prior meetings for this fixture, so the
 *     20-pt tier is recorded as missing rather than guessed "even".
 *   - Official world ranking: MEASURED from the WST official ranking list.
 *     Pang Junxu is 27th; Mark Joyce is an amateur (not ranked).
 *   - Tournament stage: MEASURED (Round 3 / Last 32 = early rounds = 0 pts).
 *   - Odds: no free, key-less structured price feed exists for snooker. The
 *     OLBG page carries tipster vote % only, never prices, so the 30-pt odds
 *     component is recorded missing on a live card (IR-SNOOKER-01). The
 *     Step 3 rules that require a price therefore resolve to SKIP; the
 *     written verdict and analysis are still produced from sourced factors.
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v3.0';

export const CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  SKIP: 'SKIP',
});

/** Step 3 thresholds, verbatim from the prompt. American moneyline odds. */
export const RULES = Object.freeze({
  full: { minScore: 70, oddsMax: -150 },
  small: { minScore: 50, maxScore: 69, oddsMin: -200, oddsMax: -130, minAligned: 2 },
  profitability: { oddsMax: -300, minScore: 75 },
});

/** Component ids that count as independently measured signals. */
export const CORE_IDS = ['form', 'h2h', 'ranking'];

/** Secondary factors used by Step 3's "2+ aligned" test. */
export const SECONDARY_IDS = ['form', 'h2h', 'ranking'];

/** Stage tier (from match round) -> prompt points. */
export function stagePoints(roundTier) {
  switch (roundTier) {
    case 'final':
    case 'semi':
      return 10;
    case 'qf':
      return 7;
    case 'r16':
      return 4;
    default: // last 32 and earlier, qualifiers, group stages
      return 0;
  }
}

export function stageLabel(roundTier) {
  switch (roundTier) {
    case 'final': return 'Final';
    case 'semi': return 'Semi-final';
    case 'qf': return 'Quarter-final';
    case 'r16': return 'Round of 16';
    case 'r32': return 'Last 32 (early round)';
    case 'qual': return 'Qualifying round';
    default: return 'Early round';
  }
}

/** Rank band -> prompt points (21+ = 0; unranked = 0). */
export function rankingPoints(rank) {
  if (rank === null || rank === undefined) return 0;
  if (rank <= 5) return 15;
  if (rank <= 10) return 10;
  if (rank <= 20) return 5;
  return 0;
}

/**
 * Odds band -> prompt points. `odds` is a negative American moneyline
 * (e.g. -150) for the player being scored. Returns points and the band label.
 */
export function oddsPoints(odds) {
  if (odds === null || odds === undefined || !Number.isFinite(odds) || odds >= -100) {
    return { points: 0, band: 'near-even or unavailable' };
  }
  if (odds <= -300) return { points: 30, band: '-300 or lower' };
  if (odds <= -200) return { points: 22, band: '-200 to -299' };
  if (odds <= -150) return { points: 14, band: '-150 to -199' };
  if (odds <= -100) return { points: 6, band: '-100 to -149' };
  return { points: 0, band: 'near-even' };
}

function comp(id, label, points, detail, { max = null, missing = false, rule = null } = {}) {
  return { id, label, points, max, detail, missing, rule };
}

/* ------------------------------------------------------------------ *
 * STEP 2 — RECENT FORM (25 pts + 5 bonus)
 * ------------------------------------------------------------------ */

/**
 * Score the last-five form component for one side.
 * @param {object} profile  from snooker_data.buildPlayerProfile
 * @param {string[]} missing  collector for unsourced items
 */
export function scoreForm(profile, missing) {
  const last5 = (profile?.last5 || []).filter(Boolean);
  if (last5.length < 2) {
    missing.push(`${profile?.name || 'player'}: last-five form (fewer than two completed matches in the sourced tape)`);
    return comp('form', 'Recent form — last 5 completed matches (25 pts)', 0,
      `less than two completed matches in the sourced tape`, { max: 30, missing: true });
  }
  const wins = last5.filter((m) => m.winner === profile.name).length;
  let points = 0;
  let band = '2 or fewer wins';
  if (wins >= 5) { points = 25; band = '5/5 wins'; }
  else if (wins === 4) { points = 18; band = '4/5 wins'; }
  else if (wins === 3) { points = 10; band = '3/5 wins'; }

  // Bonus +5 for strong in-tournament form. The prompt does not define
  // "strong"; this implementation awards it when the player has won every
  // completed match in the current event (at least two) — documented as
  // substitution S-05 in docs/SNOOKER_PROMPT_REVIEW.md.
  let bonus = 0;
  let bonusDetail = 'no in-tournament bonus';
  const inTour = (profile?.inTournament || []).filter(Boolean);
  if (inTour.length >= 2 && inTour.every((m) => m.winner === profile.name)) {
    bonus = 5;
    bonusDetail = '+5 strong in-tournament form (undefeated in this event)';
  }
  return comp('form', 'Recent form — last 5 completed matches (25 pts)', points + bonus,
    `${band}; ${bonusDetail}`, { max: 30 });
}

/** True when the form component points at this side. */
export function formLeans(profile) {
  const last5 = (profile?.last5 || []).filter(Boolean);
  if (last5.length < 2) return false;
  const wins = last5.filter((m) => m.winner === profile.name).length;
  return wins >= 3;
}

/* ------------------------------------------------------------------ *
 * STEP 2 — HEAD-TO-HEAD (20 pts)
 * ------------------------------------------------------------------ */

/**
 * Score the H2H component. `h2h` is the head-to-head tally built by
 * snooker_data.h2hBetween() — { a, b, aWins, bWins, total, meetings,
 * last3Years: { aWins, bWins, total } }. With zero prior meetings the
 * component is missing and scores 0: the prompt offers no "no history"
 * tier, and inventing "roughly even" would be a guess (documented S-06).
 */
export function scoreH2H(h2h, side, opponent, missing) {
  if (!h2h || !h2h.total || h2h.total === 0) {
    missing.push(`head-to-head (no completed meetings between ${side} and ${opponent})`);
    return comp('h2h', 'Head-to-head — weighted toward the last 3 years (20 pts)', 0,
      'no completed meetings in the source database — not scored', { max: 20, missing: true });
  }
  // Weight: all-time record counts, but meetings inside the last three years
  // count double (heavier weight per the prompt).
  const y3 = h2h.last3Years || { aWins: 0, bWins: 0, total: 0 };
  const aWeighted = h2h.aWins + y3.aWins;
  const bWeighted = h2h.bWins + y3.bWins;
  const totalWeighted = Math.max(1, aWeighted + bWeighted);
  const pct = (100 * (side === 'a' ? aWeighted : bWeighted)) / totalWeighted;

  let points = 0;
  let band = 'trailing';
  if (pct >= 70) { points = 20; band = '70%+ lead'; }
  else if (pct >= 55) { points = 13; band = '55-69% lead'; }
  else if (pct >= 45) { points = 5; band = 'roughly even'; }
  return comp('h2h', 'Head-to-head — weighted toward the last 3 years (20 pts)', points,
    `${band} (${h2h.total} meetings; ${y3.total} inside last three years)`, { max: 20 });
}

/** True when the H2H component points at this side. */
export function h2hLeans(h2h, side) {
  if (!h2h || !h2h.total) return false;
  const y3 = h2h.last3Years || { aWins: 0, bWins: 0, total: 0 };
  const a = h2h.aWins + y3.aWins;
  const b = h2h.bWins + y3.bWins;
  const pct = (100 * (side === 'a' ? a : b)) / Math.max(1, a + b);
  return pct >= 55;
}

/* ------------------------------------------------------------------ *
 * STEP 2 — WORLD RANKING (15 pts, -5 vs higher-ranked opponent)
 * ------------------------------------------------------------------ */

export function scoreRanking(rank, opponentRank) {
  const own = rankingPoints(rank);
  let detail = rank ? `current world ranking ${rank}` : 'unranked / not on the official list';
  let deduction = 0;
  if (opponentRank && (!rank || opponentRank < rank)) {
    deduction = 5;
    detail += `; opponent ranked higher (−5)`;
  }
  // The deduction is applied to the total, not clamped inside the component,
  // so a penalty is visible in the breakdown and can never be hidden.
  return comp('ranking', 'World ranking (15 pts)', own - deduction,
    detail, { max: 15 });
}

/** True when the ranking component points at this side. */
export function rankingLeans(rank, opponentRank) {
  if (rank && opponentRank) return rank < opponentRank;
  if (rank && !opponentRank) return true;   // ranked vs unranked
  return false;
}

/* ------------------------------------------------------------------ *
 * STEP 2 — TOURNAMENT STAGE (10 pts)
 * ------------------------------------------------------------------ */

export function scoreStage(roundTier) {
  const pts = stagePoints(roundTier);
  return comp('stage', 'Tournament stage (10 pts)', pts, stageLabel(roundTier), { max: 10 });
}

/* ------------------------------------------------------------------ *
 * STEP 2 — ODDS STRENGTH (30 pts)
 * ------------------------------------------------------------------ */

export function scoreOddsSide(odds) {
  if (odds === null || odds === undefined || !Number.isFinite(odds) || odds >= -100) {
    return comp('odds', 'Odds strength (30 pts)', 0,
      'no verified price in the sourced feed — scored missing (IR-SNOOKER-01)', { max: 30, missing: true });
  }
  const { points, band } = oddsPoints(odds);
  return comp('odds', 'Odds strength (30 pts)', points, `American moneyline ${odds} (${band})`, { max: 30 });
}

/* ------------------------------------------------------------------ *
 * STEP 2 — one side, full component set
 * ------------------------------------------------------------------ */

/**
 * Score one side of a match.
 * @param {object} side  { name, rank, profile, odds }
 * @param {object} other same shape
 * @param {object} ctx  { h2h, roundTier, missing[] }
 */
export function scoreSide(side, other, ctx = {}) {
  const missing = [];
  const components = [
    scoreForm(side.profile, missing),
    scoreH2H(ctx.h2h, ctx.role || 'a', side.name, missing),
    scoreStage(ctx.roundTier),
    scoreOddsSide(side.odds),
  ];
  // Ranking placed after the mutable callbacks so h2h/form can push to missing.
  components.push(scoreRanking(side.rank, other.rank));

  const raw = components.reduce((a, c) => a + (Number(c.points) || 0), 0);
  const score = Math.min(100, Math.max(0, raw));
  const measured = CORE_IDS.filter((id) => components.some((c) => c.id === id && !c.missing)).length;
  return {
    name: side.name,
    rank: side.rank ?? null,
    score,
    rawScore: raw,
    components,
    missing: [...new Set(missing)],
    measured,
    oddsMissing: components.some((c) => c.id === 'odds' && c.missing),
  };
}

/**
 * Score a whole match and apply Step 3.
 * @param {object} match  normalised slate match (snooker_data.normaliseSlateMatch)
 * @param {object} opts   { profiles, h2h, odds: {a, b}, roundTier, dateISO, asOfISO }
 */
export function scoreMatch(match, opts = {}) {
  const a = match.playerA;
  const b = match.playerB;
  const roundTier = opts.roundTier || match.roundTier || 'r32';
  const h2h = opts.h2h || null;
  const odds = { a: opts.odds?.a ?? null, b: opts.odds?.b ?? null };

  const scoreA = scoreSide(
    { name: a.name, rank: a.rank ?? opts.rankA ?? null, profile: opts.profiles?.a, odds: odds.a },
    { name: b.name, rank: b.rank ?? opts.rankB ?? null },
    { h2h, roundTier, role: 'a' },
  );
  const scoreB = scoreSide(
    { name: b.name, rank: b.rank ?? opts.rankB ?? null, profile: opts.profiles?.b, odds: odds.b },
    { name: a.name, rank: a.rank ?? opts.rankA ?? null },
    { h2h, roundTier, role: 'b' },
  );

  // Which side the model leans on (used for the verdict; Step 3 still decides
  // whether a bet is permitted).
  const lean = scoreA.score >= scoreB.score ? scoreA : scoreB;
  const other = lean === scoreA ? scoreB : scoreA;
  const gap = Math.abs(scoreA.score - scoreB.score);

  const aligned = SECONDARY_IDS.filter((id) => {
    if (id === 'form') return formLeans(lean === scoreA ? opts.profiles?.a : opts.profiles?.b);
    if (id === 'h2h') return h2hLeans(h2h, lean === scoreA ? 'a' : 'b');
    if (id === 'ranking') {
      const r = lean === scoreA ? (a.rank ?? opts.rankA) : (b.rank ?? opts.rankB);
      const ro = lean === scoreA ? (b.rank ?? opts.rankB) : (a.rank ?? opts.rankA);
      return rankingLeans(r, ro);
    }
    return false;
  });

  const oddsForLean = lean === scoreA ? odds.a : odds.b;
  const decision = decideBet({ score: lean.score, odds: oddsForLean, aligned: aligned.length, lean });
  const confidence = confidenceFor(lean, { oddsForLean });

  const missing = [...new Set([...scoreA.missing, ...scoreB.missing])];
  const components = [
    ...scoreA.components,
    ...scoreB.components.map((c) => ({ ...c, side: scoreB.name })),
  ].map((c) => (c.side ? c : { ...c, side: scoreA.name }));

  return {
    matchId: match.id ?? null,
    matchTitle: `${a.name} v ${b.name}`,
    event: match.event ?? null,
    round: match.round ?? null,
    roundTier,
    dateISO: opts.dateISO || match.dateISO || null,
    venue: match.venue ?? null,
    bestOf: match.bestOf ?? null,
    players: [scoreA, scoreB],
    sideA: scoreA,
    sideB: scoreB,
    leanName: lean.name,
    leanSide: lean === scoreA ? 'a' : 'b',
    score: lean.score,
    gap,
    aligned,
    components,
    missing,
    decision,
    confidence,
    odds: { a: odds.a, b: odds.b },
    sourceUrls: match.sourceUrls || [],
    status: match.status || 'scheduled',
    asOfISO: opts.asOfISO || null,
  };
}

/* ------------------------------------------------------------------ *
 * STEP 3 — decision rules (verbatim thresholds)
 * ------------------------------------------------------------------ */

export function decideBet({ score, odds, aligned = 0, lean = null }) {
  const reasons = [];
  if (odds === null || odds === undefined || !Number.isFinite(odds) || odds >= -100) {
    reasons.push('no verified price — odds tiers untestable (IR-SNOOKER-01)');
    return { bet: 'SKIP', action: 'SKIP', reasons };
  }
  if (score < 50) {
    reasons.push('model score below 50');
    return { bet: 'SKIP', action: 'SKIP', reasons };
  }
  // Profitability check: odds -300 or lower require score 75+.
  if (odds <= RULES.profitability.oddsMax && score < RULES.profitability.minScore) {
    reasons.push('low-payout profitability check failed (score below 75 at -300 or lower)');
    return { bet: 'SKIP', action: 'SKIP', reasons };
  }
  if (score >= RULES.full.minScore && odds <= RULES.full.oddsMax) {
    return { bet: 'FULL BET', action: 'FULL', reasons: ['score 70+ and odds -150 or lower'] };
  }
  if (
    score >= RULES.small.minScore && score <= RULES.small.maxScore &&
    odds >= RULES.small.oddsMin && odds <= RULES.small.oddsMax &&
    aligned >= RULES.small.minAligned
  ) {
    return { bet: 'SMALL BET', action: 'SMALL', reasons: [`score 50-69, price in range, ${aligned} secondary factors aligned`] };
  }
  reasons.push('Step 3 conditions not met (score/odds/factor alignment)');
  return { bet: 'SKIP', action: 'SKIP', reasons };
}

/**
 * Map a scored side to the written-prediction confidence band.
 * HIGH requires a measured price and at least three measured core signals;
 * missing odds cap the band at MEDIUM (same policy as every other card in the
 * repo). A score under 46 produces SKIP — "no confident read".
 */
export function confidenceFor(lean, { oddsForLean = null } = {}) {
  const score = lean.score;
  let band;
  if (score >= 72) band = CONFIDENCE.HIGH;
  else if (score >= 58) band = CONFIDENCE.MEDIUM;
  else if (score >= 46) band = CONFIDENCE.LOW;
  else band = CONFIDENCE.SKIP;

  const capped = [];
  if (band === CONFIDENCE.HIGH && (oddsForLean === null || !Number.isFinite(oddsForLean) || oddsForLean >= -100)) {
    band = CONFIDENCE.MEDIUM;
    capped.push('odds component missing — HIGH impossible (IR-SNOOKER-01)');
  }
  if (band === CONFIDENCE.HIGH && lean.measured < 3) {
    band = CONFIDENCE.MEDIUM;
    capped.push('fewer than three independent signals measured');
  }
  if (band === CONFIDENCE.MEDIUM && lean.measured < 2) {
    band = CONFIDENCE.LOW;
    capped.push('fewer than two independent signals measured');
  }
  return { band, score, capped };
}

/* ------------------------------------------------------------------ *
 * card-level helpers
 * ------------------------------------------------------------------ */

export function normaliseCard(scoredMatches) {
  return scoredMatches
    .filter(Boolean)
    .sort((x, y) => {
      const sx = x.score ?? -1;
      const sy = y.score ?? -1;
      if (sy !== sx) return sy - sx;
      return String(x.matchTitle || '').localeCompare(String(y.matchTitle || ''));
    });
}

export function cardSummary(scoredMatches) {
  const rows = scoredMatches.map((m) => ({
    match: m.matchTitle,
    event: m.event,
    round: m.round,
    selection: m.leanName,
    confidence: m.confidence.band,
    score: m.score,
    bet: m.decision.bet,
  }));
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, SKIP: 0 };
  for (const r of rows) counts[r.confidence] = (counts[r.confidence] || 0) + 1;
  return { rows, counts, total: rows.length };
}
