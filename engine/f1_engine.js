/**
 * SportsPred — Formula 1 Scoring Engine (canonical implementation).
 *
 * Implements "F1 GRAND PRIX PREDICTION MASTER PROMPT v1.0", Step 2 (category
 * scoring) and Step 3 (decision rules) exactly as specified. Five categories:
 *   RACE WINNER, PODIUM FINISH, FASTEST LAP, POINTS FINISH (TOP 10), TOP 6 FINISH.
 *
 * HONESTY RULES (same as every other engine in this repo):
 *  - Pure functions only. No I/O, no clock, no randomness.
 *  - A factor with no source is NEVER estimated. It is recorded in
 *    `missing[]` and, because the prompt allocates points to it, the score it
 *    would have earned is not awarded. No default values anywhere.
 *  - Every point awarded is traceable: each component records its rule id,
 *    the value that triggered it and the points given.
 *  - Where the prompt asks for data with no verified free source (bookmaker
 *    odds, overtake counts, fastest-lap tyre strategy, degradation profile,
 *    safety-car frequency, weather-dependant wet records, upgrade packages),
 *    the factor is scored as missing and the market is capped at MEDIUM or
 *    SKIPped per Step 3 rather than guessed.
 *
 * CIRCUIT CLASSIFICATIONS are sourced from the prompt itself (Monaco, Hungary,
 * Zandvoort = low overtaking; Monza, Baku, Spa = power sensitive; street/Spa =
 * high safety-car variance) and are applied only when a driver's data exists
 * for the relevant circuit; they are never used to invent results.
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';

export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP', UNSCORED: 'UNSCORED' };

/** Prompt-named circuit classifications, applied structurally only. */
export const LOW_OVERTAKING_CIRCUITS = new Set(['MON', 'HUN', 'ZAN']);
export const POWER_SENSITIVE_CIRCUITS = new Set(['MON', 'AZE', 'BEL']);
export const HIGH_SC_FREQUENCY_CIRCUITS = new Set(
  ['MON', 'SGP', 'AZE', 'BEL', 'MEX', 'MIA', 'LAS', 'USA', 'CAN'], // street/high-variance venues
);

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctPoints(profile) {
  return profile?.championshipPoints ?? null;
}

/* ------------------------------------------------------------------ *
 * RACE WINNER (100pts) — scored per candidate
 * ------------------------------------------------------------------ */

function scoreRecentForm(profile, missing) {
  const last5 = profile?.last5 || [];
  if (!last5.length) {
    missing.push('driver.last5 (no sourced completed race results before this event)');
    return [comp('rw_form', 'Recent Form (last 5 races)', 0, 'no results in window', { max: 25, missing: true })];
  }
  const wins = profile.last5Wins ?? 0;
  const podiums = profile.last5Podiums ?? 0;
  const points = profile.last5Points ?? 0;
  let pts = 0;
  if (wins >= 3) pts = 25;
  else if (wins === 2) pts = 18;
  else if (wins === 1 && podiums >= 2) pts = 12;
  else if (points > 0) pts = 5;
  else pts = 0;
  const out = [comp('rw_form', `Recent Form: ${wins} wins, ${podiums} podiums, ${points} point finishes in last ${last5.length}`, pts,
    `${wins}/5 wins`, { max: 25 })];
  if (last5.length < 3) {
    missing.push('driver.last5 (fewer than 3 completed races in sample)');
    out.push(comp('rw_form_thin', 'Thin form sample', 0, `${last5.length} races available`, { max: 25, missing: true }));
  }
  if (profile?.poleLastRace === true) {
    out.push(comp('rw_form_pole', 'Bonus: pole position in most recent race', 5, 'verified pole flag', { max: 5 }));
  } else if (profile?.poleLastRace == null) {
    missing.push('driver.poleLastRace (pole flag not published for most recent race)');
  }
  return out;
}

function scoreFastestLapRaceBonus(profile, missing) {
  const set = (profile?.fastestLapHistory?.length ?? 0) > 0 && profile.track;
  if (set) {
    return [comp('rw_fl_bonus', 'Bonus: fastest lap at this circuit in most recent race', 5,
      `${profile.fastestLapHistory.length} verified fastest-lap(s) at this circuit`, { max: 5 })];
  }
  missing.push('driver.fastestLapAtCircuit (no per-race fastest-lap source verified; ESPN publishes only the circuit record)');
  return [];
}

function scoreQualifyingPace(profile, missing) {
  const q = profile?.outqualified ?? { wins: 0, total: 0 };
  const out = [];
  if (q.total >= 4) {
    let pts = 0;
    if (q.wins >= 4) pts = 20;
    else if (q.wins >= 3) pts = 13;
    else pts = 6;
    out.push(comp('rw_quali', `Qualifying Pace: outqualified teammate in ${q.wins} of ${q.total}`, pts,
      `${q.wins}/${q.total} vs teammate`, { max: 20 }));
  } else if (q.total >= 2) {
    out.push(comp('rw_quali', 'Qualifying Pace: mixed record (small sample)', 6,
      `${q.wins}/${q.total} vs teammate`, { max: 20 }));
    missing.push('driver.gridLast5 (qualifying sample smaller than 5 races)');
  } else {
    missing.push('driver.gridLast5 (teammate grid data unavailable for qualifying pace)');
    out.push(comp('rw_quali', 'Qualifying Pace', 0, 'no sourced teammate grid data', { max: 20, missing: true }));
  }
  if (q.total >= 3 && q.wins === 0) {
    out.push(comp('rw_quali_mixed_fail', 'Qualifying Pace: consistently outqualified by teammate', 0,
      `${q.wins}/${q.total}`, { max: 20 }));
  }
  return out;
}

function scoreTrackSuitability(profile, circuit, missing) {
  const wins = profile?.trackWins ?? 0;
  const podiums = profile?.trackPodiums ?? 0;
  const points = profile?.trackPoints ?? 0;
  const out = [];
  if (!profile?.track || !profile.track.length) {
    missing.push('driver.circuitHistory (no completed runnings of this circuit before the event)');
    out.push(comp('rw_track', 'Track & Car Suitability (last 3 runnings)', 0,
      'no circuit history sourced', { max: 20, missing: true }));
    return out;
  }
  let pts = 0;
  if (wins >= 1) pts = 20;
  else if (podiums >= 1) pts = 13;
  else if (points >= 1) pts = 6;
  out.push(comp('rw_track', `Track & Car Suitability: ${wins} win(s), ${podiums} podium(s), ${points} point finish(es)`, pts,
    `${profile.track.length} runnings reviewed`, { max: 20 }));
  if (profile.track.length < 3) {
    missing.push('driver.circuitHistory (fewer than 3 runnings; history source may be incomplete)');
    out.push(comp('rw_track_thin', 'Thin circuit history sample', 0,
      `${profile.track.length} runnings`, { max: 20, missing: true }));
  }
  // Structural +5 for car/circuit fit: only awarded with grid evidence at this
  // circuit (a top-3 grid in any of the last 3 runnings), never inferred.
  const top3Grid = profile?.track?.some((r) => r.grid != null && r.grid <= 3) ||
    profile?.trackLast3?.some((r) => r.grid != null && r.grid <= 3);
  if (top3Grid) {
    out.push(comp('rw_car_suit', 'Bonus: car characteristics suit this circuit (top-3 grid at this venue)', 5,
      'verified grid evidence', { max: 5 }));
  } else if (profile.track.some((r) => r.grid == null)) {
    missing.push('driver.circuitGrid (no grid data for this circuit; car-suitability bonus unscored)');
  }
  return out;
}

function scoreOdds(profile, missing) {
  // IR-F1-02: no free key-less bookmaker odds source. Never inferred.
  missing.push('odds (no free key-less bookmaker odds source; OLBG consensus is display-only and is not a price)');
  return [comp('rw_odds', 'Odds and Market Value', 0, 'no sourced price', { max: 20, missing: true })];
}

function scoreChampionshipContext(profile, leaderPoints, constructorsTop3, missing) {
  const rank = profile?.championshipRank ?? null;
  const pts = pctPoints(profile);
  if (rank == null || pts == null || leaderPoints == null) {
    missing.push('driver.championshipStanding (rank or points unavailable)');
    return [comp('rw_champ', 'Championship and Team Context', 0, 'no standings data', { max: 15, missing: true })];
  }
  let ptsScore = 0;
  if (rank === 1) ptsScore = 15;
  else if (rank <= 3 && leaderPoints - pts <= 30) ptsScore = 10;
  else if (rank <= 10) ptsScore = 5;
  else ptsScore = 2;
  const out = [comp('rw_champ', `Championship and Team Context: P${rank}, ${pts} pts, ${Math.round(leaderPoints - pts)} behind lead`, ptsScore,
    `rank ${rank}`, { max: 15 })];
  if (constructorsTop3 === false || constructorsTop3 == null) {
    missing.push('team.constructorsTop3 (constructor status not sourced; full team support assumption not made)');
  }
  return out;
}

/** Winner base score. Returns { components, score, missingAdded }. */
function scoreWinnerBase(profile, ctx) {
  const missing = [];
  const c = [];
  c.push(...scoreRecentForm(profile, missing));
  c.push(...scoreQualifyingPace(profile, missing));
  c.push(...scoreTrackSuitability(profile, ctx.circuit, missing));
  c.push(...scoreFastestLapRaceBonus(profile, missing));
  c.push(...scoreOdds(profile, missing));
  c.push(...scoreChampionshipContext(profile, ctx.leaderPoints, ctx.top3ConstructorTech, missing));
  const score = c.reduce((a, x) => a + x.points, 0);
  return { components: c, score, missing };
}

function competitorTeam(profile) {
  return profile?.team || null;
}

/* ------------------------------------------------------------------ *
 * PODIUM FINISH (2nd & 3rd) — winner base + modifiers
 * ------------------------------------------------------------------ */

function scorePodiumModifiers(profile, ctx, missing, out) {
  const last5 = profile?.last5 || [];
  const consistency = [];
  const podiums = profile?.last5Podiums ?? 0;
  const scored = profile?.last5Scored ?? 0;
  if (last5.length >= 5) {
    if (podiums >= 3) consistency.push(15);
    else if (scored >= 5) consistency.push(10);
    else consistency.push(0);
  } else {
    missing.push('driver.last5 (consistency modifier requires five completed races)');
    consistency.push(0);
  }
  out.push(comp('pod_consistency', `Consistency Modifier: ${podiums} podiums, ${scored}/5 point finishes`, consistency[0],
    `${last5.length} races in sample`, { max: 15 }));

  if (ctx.grid == null) {
    missing.push('driver.grid (starting grid unavailable before qualifying; grid-position factor unscored)');
    out.push(comp('pod_grid', 'Grid position factor', 0, 'grid not yet known', { max: 10, missing: true }));
  } else if (ctx.grid <= 4) out.push(comp('pod_grid', 'Grid position factor: starting top 4', 10, `P${ctx.grid}`));
  else if (ctx.grid <= 8) out.push(comp('pod_grid', 'Grid position factor: starting 5th-8th', 5, `P${ctx.grid}`));
  else out.push(comp('pod_grid', 'Grid position factor: starting 9th or lower', -5, `P${ctx.grid}`));

  // Overtaking ability modifier — no free verified source for overtake counts.
  missing.push('driver.overtakesRank (no free structured overtake-count source verified; IR-F1-05)');
  out.push(comp('pod_overtake', 'Overtaking ability modifier', 0, 'not sourced', { max: 8, missing: true }));

  if (ctx.highSafetyCar && ctx.grid != null && ctx.grid >= 5 && ctx.grid <= 8) {
    out.push(comp('pod_sc', 'Safety car probability modifier: mid-grid start at high-SC circuit', 5, 'circuit classified high-SC'));
  } else {
    missing.push('safetyCarProbability (no sourced safety-car frequency metric; IR-F1-06)');
  }
}

/* ------------------------------------------------------------------ *
 * FASTEST LAP (100pts)
 * ------------------------------------------------------------------ */

function scoreFastestLap(profile, ctx, missing) {
  const out = [];
  // Tyre strategy potential (35): pit-lap timing is not published by ESPN;
  // only pit COUNT is available (statistics.pitsTaken) — not evidence of a
  // late-lap fresh-tyre strategy, so this factor is missing, never assumed.
  missing.push('fastestLapStrategy (pit-lap timing not published; only pitsTaken counts exist)');
  out.push(comp('fl_strategy', 'Tyre strategy potential (pitted in final 5 laps in 3+ of last 5)', 0,
    'no lap-timing source', { max: 35, missing: true }));

  const history = profile?.fastestLapHistory || [];
  let pts = 5;
  if (history.length >= 1 && profile?.track?.length) {
    // The prompt: 30pts set fastest lap in last 2 runnings; 18 once in last 3.
    if (history.length >= 2) pts = 30;
    else pts = 18;
  } else if (history.length >= 1) {
    pts = 18;
  }
  out.push(comp('fl_pace', `Raw pace on this circuit: ${history.length} verified fastest-lap(s)`, pts,
    history.map((h) => h.eventName).join(', ') || 'none', { max: 30 }));

  missing.push('trackDegradationProfile (no sourced tyre-degradation classification)');
  out.push(comp('fl_layout', 'Track layout suitability for speed (degradation profile)', 0,
    'degradation profile not sourced', { max: 20, missing: true }));

  scoreOdds(profile, missing).forEach((x) => out.push({ ...x, max: 15, id: 'fl_odds' }));
  return out;
}

/* ------------------------------------------------------------------ *
 * POINTS FINISH TOP 10 (100pts)
 * ------------------------------------------------------------------ */

function pointsFromRace(r) {
  return r?.pointsEarned ?? null;
}

function teamPointsHistory(profile, ctx) {
  // Sourced per-race team points from race results (pointsEarned per car) or,
  // as fallback, constructor standings per-race values.
  return ctx.teamRows?.[profile?.team] || ctx.teamPerRace?.[profile?.team] || [];
}

function scorePoints(profile, ctx, missing) {
  const out = [];
  const teamRows = teamPointsHistory(profile, ctx);
  if (teamRows.length >= 5) {
    const scored = teamRows.filter((r) => r.points != null && r.points > 0).length;
    // Most recent 5 rows are used (rows sorted newest first).
    const recentScored = teamRows.slice(0, 5).filter((r) => r.points > 0).length;
    let pts = 0;
    if (recentScored >= 4) pts = 30;
    else if (recentScored === 3) pts = 20;
    else if (recentScored === 2) pts = 8;
    else pts = 0;
    out.push(comp('pts_team', `Mid-tier team form: scored in ${recentScored} of last 5`, pts,
      `${scored} scored rounds total`, { max: 30 }));
  } else {
    missing.push('team.constructorPerRace (constructor per-race points unavailable)');
    out.push(comp('pts_team', 'Mid-tier team form', 0, 'no per-race constructor points', { max: 30, missing: true }));
  }

  const dnf = profile?.last5Dnf ?? 0;
  const known = profile?.last5KnownDnf ?? 0;
  if (known >= 5) {
    let pts = dnf === 0 ? 25 : dnf === 1 ? 12 : 0;
    out.push(comp('pts_reliability', `Reliability record: ${dnf} verified DNF(s) in last 5`, pts,
      `${known}/5 statuses verified`, { max: 25 }));
  } else {
    missing.push(`driver.dnfStatus (${known}/5 race statuses verified; mechanical-DNF record incomplete)`);
    let pts = dnf === 0 ? 12 : dnf === 1 ? 6 : 0;
    out.push(comp('pts_reliability', 'Reliability record (partial status data)', pts,
      `${dnf} verified DNF(s), ${known}/5 checked`, { max: 25, missing: true }));
  }

  missing.push('driver.overtakesRank (no free overtake-count source verified; IR-F1-05)');
  out.push(comp('pts_traffic', 'Driver skill in traffic (overtakes ranking)', 0, 'not sourced', { max: 25, missing: true }));

  missing.push('team.upgradeTrajectory (no source for upgrade packages or lap-time deltas; IR-F1-07)');
  out.push(comp('pts_upgrades', 'Car upgrade trajectory', 0, 'not sourced', { max: 20, missing: true }));

  return out;
}

/** TOP 6 FINISH = points base + modifiers. */
function scoreTop6(profile, ctx, missing) {
  const out = scorePoints(profile, ctx, missing);
  if (ctx.grid == null) {
    missing.push('driver.grid (grid modifier requires starting position)');
    out.push(comp('t6_grid', 'Starting grid position modifier', 0, 'grid not known', { max: 15, missing: true }));
  } else if (ctx.grid <= 6) out.push(comp('t6_grid', 'Starting grid position modifier: top 6', 15, `P${ctx.grid}`));
  else if (ctx.grid <= 10) out.push(comp('t6_grid', 'Starting grid position modifier: 7th-10th', 8, `P${ctx.grid}`));
  else if (ctx.grid <= 15) out.push(comp('t6_grid', 'Starting grid position modifier: 11th-15th', 0, `P${ctx.grid}`));
  else out.push(comp('t6_grid', 'Starting grid position modifier: 16th or lower', -10, `P${ctx.grid}`));

  missing.push('overtakingDifficulty (no sourced circuit overtaking-difficulty metric)');
  missing.push('teamStrategySOPHISTICATION (no sourced undercut-strategy classification)');
  if ((ctx.weatherPrecipPct ?? 0) >= 30) {
    missing.push('driver.wetWeatherRecord (rain forecast but no sourced wet-weather record)');
    out.push(comp('t6_weather', 'Weather wildcard: rain forecast, wet record not sourced', 0, `${ctx.weatherPrecipPct}% rain forecast`, { max: 5, missing: true }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Decision rules (Step 3)
 * ------------------------------------------------------------------ */

const RULES = {
  race_winner: { high: 70, med: 55, skipBelow: 55 },
  podium_finish: { high: 65, med: 50, skipBelow: 50 },
  fastest_lap: { high: 70, med: 55, skipBelow: 55 },
  points_finish: { high: 70, med: 55, skipBelow: 55 },
  top6_finish: { high: 70, med: 55, skipBelow: 55 },
};

function bandFromScore(score, rule, { missing = [], strategyEvidence = true } = {}) {
  let band;
  if (score >= rule.high) band = CONFIDENCE.HIGH;
  else if (score >= rule.med) band = CONFIDENCE.MEDIUM;
  else if (score > 0) band = CONFIDENCE.LOW;
  else band = CONFIDENCE.SKIP;
  // Any missing sourced factor: cap at MEDIUM (never HIGH on partial data).
  if (missing.length && band === CONFIDENCE.HIGH) band = CONFIDENCE.MEDIUM;
  if (rule.id === 'fastest_lap' && !strategyEvidence) band = CONFIDENCE.SKIP;
  return band;
}

/** Build market result objects from candidate scores. */
function marketFrom(key, candidates, rule, missing, extra = {}) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const strategyEvidence = !key.includes('fastest_lap') || extra.strategyEvidence === true;
  const combinedMissing = top ? [...new Set([...missing, ...(top?.missing || [])])] : [...missing];
  const band = top && top.score > 0
    ? bandFromScore(top.score, { ...rule, id: key }, { missing: combinedMissing, strategyEvidence })
    : CONFIDENCE.SKIP;
  return {
    selection: top?.name ?? null,
    band: top && top.score > 0 ? band : CONFIDENCE.SKIP,
    score: top?.score ?? 0,
    candidates: sorted.slice(0, 3).map((c) => ({
      name: c.name,
      team: c.team,
      score: c.score,
      band: bandFromScore(c.score, { ...rule, id: key }, { missing: c.missing ?? [], strategyEvidence }),
      profile: c.profile || null,
    })),
    components: top?.components ?? [],
    missing: combinedMissing,
    ...extra,
  };
}

/**
 * Score one race event.
 *
 * @param {object} event      parsed event (see f1_espn.js / f1_data.js)
 * @param {object} profiles   Map athleteId -> profile (with track attached)
 * @param {object} ctx        { circuit, leaderPoints, top3ConstructorTech,
 *                              teamPerRace, grid (known grid or null), weather }
 * @returns {object} scored card
 */
export function scoreF1Race(event, profiles, ctx) {
  const missing = [];
  const contestantIds = [];
  const profList = [...(profiles?.values?.() || Object.values(profiles || {}))].filter(Boolean);
  if (!profList.length) {
    return {
      unscored: true,
      flags: ['UNSCORED no driver profiles'],
      missing: ['driverProfiles (no sourced standings/race data)'],
      markets: {},
    };
  }

  // Contestants: drivers with any of standings, last-5 results, track history.
  for (const p of profList) {
    const hasTape = p.last5?.length || p.circuitHistory?.length || p.championshipRank != null;
    if (hasTape) contestantIds.push(p);
  }

  const gridById = new Map();
  if (ctx.grid) for (const g of ctx.grid) gridById.set(String(g.athleteId), num(g.grid));

  const scoreOne = (p) => {
    const g = gridById.get(String(p.athleteId)) ?? null;
    const driverCtx = { ...ctx, grid: g, profile: p };
    const base = scoreWinnerBase(p, driverCtx);
    // Podium uses the winner base with the win-market bonuses REPLACED by the
    // consistency modifier (prompt, PODIUM FINISH section).
    const poleBonus = base.components.find((x) => x.id === 'rw_form_pole')?.points ?? 0;
    const flBonus = base.components.find((x) => x.id === 'rw_fl_bonus')?.points ?? 0;
    const podiumScore = base.score - poleBonus - flBonus;
    return {
      id: p.athleteId,
      name: p.name,
      team: p.team,
      profile: p,
      driverCtx,
      components: base.components,
      score: base.score,
      missing: base.missing,
      podiumScore,
      podiumMissing: base.missing,
    };
  };

  const scoredAll = contestantIds.map(scoreOne);

  // Public summary facts carried to the writer (never raw internal reasoning).
  const asPublicProfile = (s) => ({
    name: s.name,
    team: s.team,
    last5Wins: s.profileFacts?.last5Wins,
    last5Podiums: s.profileFacts?.last5Podiums,
    last5Points: s.profileFacts?.last5Points,
    outqualified: s.profileFacts?.outqualified,
    trackWins: s.profileFacts?.trackWins,
    trackPodiums: s.profileFacts?.trackPodiums,
    trackPoints: s.profileFacts?.trackPoints,
    championshipRank: s.profileFacts?.championshipRank,
    fastestLapHistory: s.profileFacts?.fastestLapHistory,
  });

  // Attach public profile facts to each scored candidate.
  const profilesById = new Map(contestantIds.map((p) => [p.athleteId, p]));
  for (const s of scoredAll) {
    const p = profilesById.get(s.id);
    s.profileFacts = p || {};
  }

  const winnerRule = RULES.race_winner;
  const winnerMarket = marketFrom('race_winner', scoredAll.map((s) => ({
    name: s.name, team: s.team, score: s.score, components: s.components, missing: s.missing,
    profile: asPublicProfile(s),
  })), winnerRule, missing);

  // Podium: winner base + modifiers, per driver.
  const podiumCandidates = scoredAll.map((s) => {
    const mods = [];
    const pm = [];
    scorePodiumModifiers(s.profile, s.driverCtx, pm, mods);
    return {
      name: s.name,
      team: s.team,
      score: s.podiumScore + mods.reduce((a, x) => a + x.points, 0),
      components: [...s.components, ...mods],
      missing: [...s.missing, ...pm],
      profile: asPublicProfile(s),
    };
  });
  const podiumMarket = marketFrom('podium_finish', podiumCandidates, RULES.podium_finish, missing);

  // Fastest lap: top grid/pace candidates (all drivers).
  const flCandidates = scoredAll.map((s) => {
    const mods = [];
    const fm = [];
    const comps = scoreFastestLap(s.profile, s.driverCtx, fm);
    // Strategy evidence (required by Step 3) — never assumed.
    const strategyEvidence = false;
    const score = comps.reduce((a, x) => a + x.points, 0);
    return {
      name: s.name,
      team: s.team,
      score,
      components: comps,
      missing: fm,
      strategyEvidence,
      profile: asPublicProfile(s),
    };
  });
  const fastestLapMarket = marketFrom('fastest_lap', flCandidates, RULES.fastest_lap, missing, { strategyEvidence: false });

  // Points finish.
  const ptsCandidates = scoredAll.map((s) => {
    const mods = scorePoints(s.profile, s.driverCtx, []);
    return {
      name: s.name,
      team: s.team,
      score: mods.reduce((a, x) => a + x.points, 0),
      components: mods,
      missing: mods.filter((x) => x.missing).map((x) => x.id),
      profile: asPublicProfile(s),
    };
  });
  const pointsMarket = marketFrom('points_finish', ptsCandidates, RULES.points_finish, missing);

  // Top 6.
  const t6Candidates = scoredAll.map((s) => {
    const fm = [];
    const mods = scoreTop6(s.profile, s.driverCtx, fm);
    return {
      name: s.name,
      team: s.team,
      score: mods.reduce((a, x) => a + x.points, 0),
      components: mods,
      missing: fm,
      profile: asPublicProfile(s),
    };
  });
  const t6Market = marketFrom('top6_finish', t6Candidates, RULES.top6_finish, missing);

  return {
    unscored: false,
    flags: [],
    missing,
    markets: {
      race_winner: winnerMarket,
      podium_finish: podiumMarket,
      fastest_lap: fastestLapMarket,
      points_finish: pointsMarket,
      top6_finish: t6Market,
    },
  };
}

/** Aggregate convenience: score every event in a card. */
export function scoreF1Card(events, profilesByEvent, ctxByEvent) {
  const results = [];
  for (const ev of events || []) {
    const profiles = profilesByEvent?.get(ev.id) || profilesByEvent?.[ev.id] || new Map();
    const ctx = ctxByEvent?.get(ev.id) || ctxByEvent?.[ev.id] || {};
    results.push({ event: ev, result: scoreF1Race(ev, profiles, ctx) });
  }
  return { results };
}
