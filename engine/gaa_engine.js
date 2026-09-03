/**
 * SportsPred — GAA (Gaelic football + hurling) prediction engine.
 *
 * Implements Step 2 and Step 3 of "GAA PREDICTION MASTER PROMPT v1.1".
 * Pure: no I/O, no clock, no randomness.
 *
 * Odds Strength (30): -300=30 · -200..-299=22 · -150..-199=14 · -100..-149=6
 *   near-even=0. Missing live odds: 10 pts and flagged (IR-GAA-01).
 * Recent Form (25): 5/5=25 · 4/5=18 · 3/5=10 · ≤2=0
 *   +5 in-competition bonus; ±3 margin quality; <3 results cap at 10.
 * Head-to-Head (20): 70%+=20 · 55-69=13 · even=5 · trailing=0
 *   last-3-years double-weighted. Unavailable = 5 pts flagged.
 * League / pedigree (15): 1st=15 · 2nd=12 · 3-4=8 · 5-6=4 · 7-8=0
 *   −5 if opponent ranked higher. Championship pedigree substitutes.
 * Stage + venue (10): knockout/final=10 · QF=7 · mid-season=5 · early=0
 *   +3 confirmed home; +2 Ulster/Connacht provincial home.
 *
 * Hurling: Limerick and Kilkenny receive a pedigree lean regardless of
 * current league position (prompt). Recorded as a ranking substitution,
 * never as an invented league table.
 */

export const RULESET_VERSION = 'v1.1';
export const PROMPT_VERSION = 'v1.1';

export const CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  SKIP: 'SKIP',
});

export const RULES = Object.freeze({
  full: { minScore: 70, oddsMax: -150 },
  small: { minScore: 50, maxScore: 69, oddsMin: -200, oddsMax: -130, minAligned: 2 },
  profitability: { oddsMax: -300, minScore: 75 },
});

export const CORE_IDS = ['form', 'h2h', 'ranking'];
export const SECONDARY_IDS = ['form', 'h2h', 'ranking', 'stage'];
export const HURLING_PEDIGREE = Object.freeze(['Limerick', 'Kilkenny']);

export function gaaTotal(goals, points) {
  if (!Number.isFinite(goals) || !Number.isFinite(points)) return null;
  return goals * 3 + points;
}

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

export function rankingPoints(rank) {
  if (rank === null || rank === undefined) return 0;
  if (rank === 1) return 15;
  if (rank === 2) return 12;
  if (rank <= 4) return 8;
  if (rank <= 6) return 4;
  if (rank <= 8) return 0;
  return 0;
}

export function stagePoints(roundTier) {
  switch (roundTier) {
    case 'final':
    case 'knockout':
    case 'league-final':
      return 10;
    case 'qf':
    case 'semi':
      return 7;
    case 'mid':
      return 5;
    default:
      return 0;
  }
}

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

export function scoreForm(profile, missing) {
  const last5 = (profile?.last5 || []).filter(Boolean);
  if (last5.length < 3) {
    missing.push(`${profile?.name || 'team'}: last-five form (fewer than three completed matches in the sourced tape)`);
    const wins = last5.filter((m) => m.winner === profile?.name).length;
    let points = 0;
    if (wins >= 5) points = 25;
    else if (wins === 4) points = 18;
    else if (wins === 3) points = 10;
    points = Math.min(10, points);
    return comp('form', 'Recent form — last 5 (25 pts)', points,
      last5.length === 0
        ? 'no completed matches in the sourced tape — capped (IR-GAA-02)'
        : `fewer than three sourced results — form capped at 10`,
      { max: 30, missing: true });
  }
  const wins = last5.filter((m) => m.winner === profile.name).length;
  let points = 0;
  let band = '2 or fewer wins';
  if (wins >= 5) { points = 25; band = '5/5 wins'; }
  else if (wins === 4) { points = 18; band = '4/5 wins'; }
  else if (wins === 3) { points = 10; band = '3/5 wins'; }

  let bonus = 0;
  const inComp = (profile?.inCompetition || []).filter(Boolean);
  if (inComp.length >= 2 && inComp.filter((m) => m.winner === profile.name).length >= 2) {
    bonus += 5;
  }
  const margins = last5
    .filter((m) => m.winner === profile.name && Number.isFinite(m.margin))
    .map((m) => m.margin);
  let marginAdj = 0;
  if (margins.length) {
    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
    if (avg >= 15) marginAdj = 3;
    else if (avg <= 2) marginAdj = -3;
  }
  return comp('form', 'Recent form — last 5 (25 pts)', points + bonus + marginAdj,
    `${band}; in-competition ${bonus ? '+5' : 'no bonus'}; margin ${marginAdj >= 0 ? '+' : ''}${marginAdj}`,
    { max: 30 });
}

export function formLeans(profile) {
  const last5 = (profile?.last5 || []).filter(Boolean);
  if (last5.length < 3) return false;
  return last5.filter((m) => m.winner === profile.name).length >= 3;
}

export function formEven(profileA, profileB) {
  const a = (profileA?.last5 || []).filter(Boolean);
  const b = (profileB?.last5 || []).filter(Boolean);
  if (a.length < 3 || b.length < 3) return false;
  const aw = a.filter((m) => m.winner === profileA.name).length;
  const bw = b.filter((m) => m.winner === profileB.name).length;
  return Math.abs(aw - bw) <= 1 && aw <= 3 && bw <= 3;
}

export function scoreH2H(h2h, side, opponent, missing) {
  if (!h2h || !h2h.total) {
    missing.push(`head-to-head (no completed meetings between the sides)`);
    return comp('h2h', 'Head-to-head — last 3 years weighted (20 pts)', 5,
      'no completed meetings in the sourced tape — conservative 5 pts (prompt)',
      { max: 20, missing: true });
  }
  const y3 = h2h.last3Years || { aWins: 0, bWins: 0, total: 0 };
  const aWeighted = h2h.aWins + y3.aWins;
  const bWeighted = h2h.bWins + y3.bWins;
  const pct = (100 * (side === 'a' ? aWeighted : bWeighted)) / Math.max(1, aWeighted + bWeighted);
  let points = 0;
  let band = 'trailing';
  if (pct >= 70) { points = 20; band = '70%+ lead'; }
  else if (pct >= 55) { points = 13; band = '55-69% lead'; }
  else if (pct >= 45) { points = 5; band = 'roughly even'; }
  return comp('h2h', 'Head-to-head — last 3 years weighted (20 pts)', points,
    `${band} (${h2h.total} meetings; ${y3.total} inside last three years)`, { max: 20 });
}

export function h2hLeans(h2h, side) {
  if (!h2h || !h2h.total) return false;
  const y3 = h2h.last3Years || { aWins: 0, bWins: 0, total: 0 };
  const a = h2h.aWins + y3.aWins;
  const b = h2h.bWins + y3.bWins;
  const pct = (100 * (side === 'a' ? a : b)) / Math.max(1, a + b);
  return pct >= 55;
}

export function h2hEven(h2h) {
  if (!h2h || !h2h.total) return false;
  const y3 = h2h.last3Years || { aWins: 0, bWins: 0, total: 0 };
  const a = h2h.aWins + y3.aWins;
  const b = h2h.bWins + y3.bWins;
  const tot = a + b;
  if (!tot) return false;
  const pct = (100 * a) / tot;
  return pct >= 45 && pct < 55;
}

export function scoreRanking(rank, opponentRank, { hurlingPedigree = false, name = '' } = {}) {
  let own = rankingPoints(rank);
  let detail = rank ? `championship pedigree rank ${rank}` : 'no sourced league/pedigree rank';
  if (hurlingPedigree) {
    own = Math.max(own, 12);
    detail = `${name} hurling pedigree applied (Limerick/Kilkenny structural weighting)`;
  }
  let deduction = 0;
  if (opponentRank && (!rank || opponentRank < rank) && !hurlingPedigree) {
    deduction = 5;
    detail += '; opponent ranked higher (−5)';
  }
  const missing = rank == null && !hurlingPedigree;
  return comp('ranking', 'League standing / championship pedigree (15 pts)', own - deduction,
    detail, { max: 15, missing });
}

export function rankingLeans(rank, opponentRank) {
  if (rank && opponentRank) return rank < opponentRank;
  if (rank && !opponentRank) return true;
  return false;
}

export function scoreStage(roundTier, { home = false, provincialHome = false } = {}) {
  let pts = stagePoints(roundTier);
  const extras = [];
  if (home) { pts += 3; extras.push('+3 home'); }
  if (provincialHome) { pts += 2; extras.push('+2 provincial home'); }
  return comp('stage', 'Competition stage and venue (10 pts)', pts,
    `${roundTier || 'early'}${extras.length ? `; ${extras.join(', ')}` : ''}`, { max: 15 });
}

export function scoreOddsSide(odds) {
  if (odds === null || odds === undefined || !Number.isFinite(odds) || odds >= -100) {
    return comp('odds', 'Odds strength (30 pts)', 10,
      'no verified price — scored 10 pts per prompt missing-odds rule (IR-GAA-01)',
      { max: 30, missing: true });
  }
  const { points, band } = oddsPoints(odds);
  return comp('odds', 'Odds strength (30 pts)', points, `American moneyline ${odds} (${band})`, { max: 30 });
}

export function scoreSide(side, other, ctx = {}) {
  const missing = [];
  const hurlingPedigree = ctx.code === 'hurling'
    && HURLING_PEDIGREE.some((n) => n.toLowerCase() === String(side.name || '').toLowerCase());
  const components = [
    scoreForm(side.profile, missing),
    scoreH2H(ctx.h2h, ctx.role || 'a', side.name, missing),
    scoreRanking(side.rank, other.rank, { hurlingPedigree, name: side.name }),
    scoreStage(ctx.roundTier, { home: side.home === true, provincialHome: side.provincialHome === true }),
    scoreOddsSide(side.odds),
  ];
  const raw = components.reduce((a, c) => a + (Number(c.points) || 0), 0);
  const score = Math.min(100, Math.max(0, raw));
  const measured = CORE_IDS.filter((id) => components.some((c) => c.id === id && !c.missing)).length;
  const gaps = components.filter((c) => c.missing).length;
  return {
    name: side.name,
    rank: side.rank ?? null,
    score,
    rawScore: raw,
    components,
    missing: [...new Set(missing)],
    measured,
    gaps,
    oddsMissing: components.some((c) => c.id === 'odds' && c.missing),
  };
}

export function scoreMatch(match, opts = {}) {
  const a = match.teamA || match.playerA;
  const b = match.teamB || match.playerB;
  const roundTier = opts.roundTier || match.roundTier || 'early';
  const h2h = opts.h2h || null;
  const odds = { a: opts.odds?.a ?? null, b: opts.odds?.b ?? null };
  const code = opts.code || match.code || 'football';

  const scoreA = scoreSide(
    {
      name: a.name, rank: a.rank ?? opts.rankA ?? null, profile: opts.profiles?.a, odds: odds.a,
      home: match.homeSide === 'a' || a.home === true,
      provincialHome: a.provincialHome === true,
    },
    { name: b.name, rank: b.rank ?? opts.rankB ?? null },
    { h2h, roundTier, role: 'a', code },
  );
  const scoreB = scoreSide(
    {
      name: b.name, rank: b.rank ?? opts.rankB ?? null, profile: opts.profiles?.b, odds: odds.b,
      home: match.homeSide === 'b' || b.home === true,
      provincialHome: b.provincialHome === true,
    },
    { name: a.name, rank: a.rank ?? opts.rankA ?? null },
    { h2h, roundTier, role: 'b', code },
  );

  const lean = scoreA.score >= scoreB.score ? scoreA : scoreB;
  const gap = Math.abs(scoreA.score - scoreB.score);
  const aligned = SECONDARY_IDS.filter((id) => {
    if (id === 'form') return formLeans(lean === scoreA ? opts.profiles?.a : opts.profiles?.b);
    if (id === 'h2h') return h2hLeans(h2h, lean === scoreA ? 'a' : 'b');
    if (id === 'ranking') {
      const r = lean === scoreA ? (a.rank ?? opts.rankA) : (b.rank ?? opts.rankB);
      const ro = lean === scoreA ? (b.rank ?? opts.rankB) : (a.rank ?? opts.rankA);
      return rankingLeans(r, ro);
    }
    if (id === 'stage') return stagePoints(roundTier) >= 7;
    return false;
  });

  const contradict = formLeans(opts.profiles?.a) && h2hLeans(h2h, 'b')
    || formLeans(opts.profiles?.b) && h2hLeans(h2h, 'a');
  const drawPossible = formEven(opts.profiles?.a, opts.profiles?.b) && h2hEven(h2h);
  const gaps = Math.max(scoreA.gaps, scoreB.gaps);
  const oddsForLean = lean === scoreA ? odds.a : odds.b;
  const decision = decideBet({
    score: lean.score, odds: oddsForLean, aligned: aligned.length, contradict, gaps,
  });
  const confidence = confidenceFor(lean, { oddsForLean, gaps });

  const missing = [...new Set([...scoreA.missing, ...scoreB.missing])];
  const components = [
    ...scoreA.components.map((c) => ({ ...c, side: scoreA.name })),
    ...scoreB.components.map((c) => ({ ...c, side: scoreB.name })),
  ];

  return {
    matchId: match.id ?? null,
    matchTitle: `${a.name} v ${b.name}`,
    event: match.event ?? null,
    round: match.round ?? null,
    roundTier,
    code,
    dateISO: opts.dateISO || match.dateISO || null,
    venue: match.venue ?? null,
    teamA: scoreA,
    teamB: scoreB,
    sideA: scoreA,
    sideB: scoreB,
    players: [scoreA, scoreB],
    leanName: lean.name,
    leanSide: lean === scoreA ? 'a' : 'b',
    score: lean.score,
    gap,
    aligned,
    components,
    missing,
    decision,
    confidence,
    drawPossible,
    dataGap: gaps >= 2,
    odds: { a: odds.a, b: odds.b },
    sourceUrls: match.sourceUrls || [],
    status: match.status || 'scheduled',
    asOfISO: opts.asOfISO || null,
  };
}

export function decideBet({ score, odds, aligned = 0, contradict = false, gaps = 0 }) {
  const reasons = [];
  if (odds === null || odds === undefined || !Number.isFinite(odds) || odds >= -100) {
    reasons.push('no verified price — odds tiers untestable (IR-GAA-01)');
    return { bet: 'SKIP', action: 'SKIP', reasons };
  }
  if (contradict) {
    reasons.push('form and head-to-head contradict');
    return { bet: 'SKIP', action: 'SKIP', reasons };
  }
  if (score < 50) {
    reasons.push('model score below 50');
    return { bet: 'SKIP', action: 'SKIP', reasons };
  }
  if (odds <= RULES.profitability.oddsMax && score < RULES.profitability.minScore) {
    reasons.push('low-payout profitability check failed');
    return { bet: 'SKIP', action: 'SKIP', reasons };
  }
  let bet = null;
  if (score >= RULES.full.minScore && odds <= RULES.full.oddsMax) {
    bet = { bet: 'FULL BET', action: 'FULL', reasons: ['score 70+ and odds -150 or lower'] };
  } else if (
    score >= RULES.small.minScore && score <= RULES.small.maxScore
    && odds >= RULES.small.oddsMin && odds <= RULES.small.oddsMax
    && aligned >= RULES.small.minAligned
  ) {
    bet = { bet: 'SMALL BET', action: 'SMALL', reasons: [`score 50-69, ${aligned} secondary factors aligned`] };
  } else {
    return { bet: 'SKIP', action: 'SKIP', reasons: ['Step 3 conditions not met'] };
  }
  if (gaps >= 2 && bet.action === 'FULL') {
    bet = { bet: 'SMALL BET', action: 'SMALL', reasons: [...bet.reasons, 'capped at Small Bet: two or more data gaps'] };
  }
  return bet;
}

export function confidenceFor(lean, { oddsForLean = null, gaps = 0 } = {}) {
  const score = lean.score;
  let band;
  if (score >= 72) band = CONFIDENCE.HIGH;
  else if (score >= 58) band = CONFIDENCE.MEDIUM;
  else if (score >= 46) band = CONFIDENCE.LOW;
  else band = CONFIDENCE.SKIP;
  const capped = [];
  if (band === CONFIDENCE.HIGH && (oddsForLean === null || !Number.isFinite(oddsForLean) || oddsForLean >= -100)) {
    band = CONFIDENCE.MEDIUM;
    capped.push('odds component missing — HIGH impossible (IR-GAA-01)');
  }
  if (gaps >= 2 && (band === CONFIDENCE.HIGH || band === CONFIDENCE.MEDIUM)) {
    band = CONFIDENCE.MEDIUM;
    capped.push('two or more scoring categories missing — confidence capped');
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

export function normaliseCard(scoredMatches) {
  return scoredMatches.filter(Boolean).sort((x, y) => {
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
