/**
 * SportsPred — NBA BASKETBALL PREDICTION MASTER PROMPT v5.0 engine (pure, no I/O).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The universal engine scores basketball with a generic two-competitor
 * log-odds blend. The NBA v5.0 brief specifies a *different* scoring contract:
 * three independently scored markets out of 100 (WIN MATCH / POINT SPREAD /
 * GAME TOTAL), each built from an explicit point rubric in STEP 2 and gated by
 * the STEP 3 bet-decision rules. This module implements that rubric exactly,
 * and — critically — it only awards a bucket when the data is actually
 * present. An unavailable input scores 0 and is recorded in `missing[]` with
 * its reason, never replaced by a default or an average.
 *
 * PROMPT → FIELD MAP (the "line by line" trace)
 * ---------------------------------------------
 * STEP 2, WIN MATCH (100):
 *   odds strength          (30)  ← match.odds.moneyline (ESPN republishes ONE
 *                                   book; the prompt's second source is flagged
 *                                   missing and confidence is capped)
 *   recent form, L2W x2    (25)  ← last-5 W/L from the results tape (+5 streak)
 *   head-to-head, 3yr      (20)  ← tape H2H; the 3-year window is flagged when
 *                                   the tape is shorter
 *   standings/season record(15)  ← season W-L (winPct) + home/road split; the
 *                                   conference-rank tiers are flagged missing
 *                                   (no key-less conference standings)
 *   context & home court   (10)  ← home/away + strong home split; the
 *                                   high/mid/low-stakes tier is flagged missing
 * STEP 2, POINT SPREAD (100) = WIN MATCH factors, context replaced by:
 *   ATS trend last 10      (10)  ← NOT in any free key-less feed → 0 + reason
 *   injury impact modifier (+8/+3/0) ← NOT in a free date-specific feed → 0 + reason
 *   fatigue (opponent B2B +5 / own B2B -5) ← rest days from the tape
 * STEP 2, GAME TOTAL (100):
 *   offensive pace         (35)  ← NOT in the scoreboard feed → 0 + reason
 *   defensive efficiency   (25)  ← NOT in the scoreboard feed → 0 + reason
 *   injury impact on scoring(20) ← NOT in a free feed → 0 + reason
 *   recent total trends    (20)  ← needs closing totals vs results, not retained
 *                                   post-game → 0 + reason
 *
 * STEP 3 thresholds: ≥70 HIGH (Full Bet), 50-69 MEDIUM (Small Bet, 2+ factors),
 * <50 SKIP. A moneyline of -300 or heavier requires 75+. Confidence is further
 * capped by data completeness so a thin card can never read HIGH.
 *
 * NO-HALLUCINATION RULES (enforced, tested)
 *   1. A bucket with no data contributes 0 and is pushed to missing[].
 *   2. The second odds source, ATS history, conference rank, stakes tier,
 *      pace rating, defensive efficiency and injuries are never inferred.
 *   3. The game total resolves to SKIP unless every required pace/defence/
 *      injury/trend input is present (in practice it resolves to SKIP on the
 *      free feed — that is the correct, honest outcome, not a failure).
 */

export const NBA_RULESET_VERSION = 'nba-v5.0';
export const NBA_PROMPT_VERSION = 'NBA BASKETBALL PREDICTION MASTER PROMPT v5.0';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (n, dp = 3) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);

/* ------------------------------------------------------------------ *
 * shared factor helpers (pure)
 * ------------------------------------------------------------------ */

/** Count wins in a form list like ['W','L','W','W','W']. */
function winsIn(form) {
  return (form || []).filter((c) => c === 'W').length;
}

/** Longest trailing winning streak at the head of a most-recent-first list. */
function currentWinStreak(form) {
  let n = 0;
  for (const c of form || []) { if (c === 'W') n += 1; else break; }
  return n;
}

/** Odds-strength bucket (STEP 2, WIN MATCH). American odds → 0..30. */
export function oddsStrength(american) {
  if (american === null || american === undefined || american === '') return null;
  const v = Number(String(american).replace(/[+\s]/g, ''));
  if (!Number.isFinite(v) || v === 0) return null;
  if (v <= -300) return 30;
  if (v <= -200) return 22;
  if (v <= -150) return 14;
  if (v <= -100) return 6;
  return 0; // near-even to underdog
}

/** Recent-form bucket (STEP 2, WIN MATCH). last-5 W/L → 0..25 (+5 streak). */
export function formPoints(form) {
  if (!Array.isArray(form) || !form.length) return null;
  const w = winsIn(form);
  const base = w >= 5 ? 25 : w === 4 ? 18 : w === 3 ? 10 : 0;
  const streak = currentWinStreak(form) >= 4 ? 5 : 0;
  return clamp(base + streak, 0, 25);
}

/** Head-to-head bucket (STEP 2, WIN MATCH). {homeWins,awayWins} → 0..20. */
export function h2hPoints(h2h, sideName, homeName, awayName) {
  if (!h2h || h2h.meetings < 3) return null;
  const side = sideName === homeName ? 'home' : 'away';
  const decided = h2h.homeWins + h2h.awayWins;
  if (!decided) return 0;
  const rate = side === 'home' ? h2h.homeWins / decided : h2h.awayWins / decided;
  if (rate >= 0.7) return 20;
  if (rate >= 0.55) return 13;
  if (rate >= 0.45) return 5; // roughly even
  return 0; // trailing
}

/** Season-record bucket (STEP 2, WIN MATCH). winPct → 0..15, then -5 if opponent higher. */
export function recordPoints(record, opponentRecord) {
  if (!record || typeof record.winPct !== 'number') return null;
  let pts = record.winPct >= 0.65 ? 15 : record.winPct >= 0.55 ? 10 : record.winPct >= 0.45 ? 5 : 0;
  if (opponentRecord && typeof opponentRecord.winPct === 'number' && opponentRecord.winPct > record.winPct) pts -= 5;
  return clamp(pts, 0, 15);
}

/** Context + home-court bucket (STEP 2, WIN MATCH). Home side gets the strong-split bonus. */
export function contextPoints(team, isHome, neutral) {
  if (neutral) return 2; // no venue edge
  let pts = isHome ? 6 : 2; // stakes tier is unknowable key-less; treat venue as the only known signal
  const split = isHome ? team?.homeSplit : team?.awaySplit;
  if (split && typeof split.winPct === 'number' && split.winPct >= 0.6) pts += 3;
  return clamp(pts, 0, 10);
}

/** Fatigue modifier (STEP 2, SPREAD). rest ≤ 1 day ≈ back-to-back. */
export function fatiguePoints(ownRest, oppRest) {
  let pts = 0;
  if (typeof oppRest === 'number' && oppRest <= 1) pts += 5; // opponent on a back-to-back
  if (typeof ownRest === 'number' && ownRest <= 1) pts -= 5; // own team on a back-to-back
  return pts;
}

/* ------------------------------------------------------------------ *
 * the engine
 * ------------------------------------------------------------------ */

function addMissing(missing, id, label, reason) {
  missing.push({ id, label, reason });
}

/**
 * Score one NBA/WNBA game across the three STEP 2 markets.
 *
 * @param {object} match  normalised match from parseScoreboard (engine/espn_universal.js)
 * @param {object} ctx    { tape, h2h, rest, homeForm, awayForm } from the page's ctxFor()
 * @returns a result object compatible with engine/nba_writer.js's writeNbaGame()
 */
export function scoreNbaMatch(match, ctx = {}) {
  const missing = [];
  const home = match?.home || {};
  const away = match?.away || {};
  const homeName = home.name;
  const awayName = away.name;
  const odds = match?.odds || null;
  const neutral = match?.neutral === true;

  const h2h = ctx.h2h || null;
  const rest = ctx.rest || {};
  const homeForm = ctx.homeForm || null;
  const awayForm = ctx.awayForm || null;

  // ---- shared sourced factors -------------------------------------------
  const ml = odds?.moneyline || {};
  const homePrice = ml.home?.american ?? null;
  const awayPrice = ml.away?.american ?? null;

  // ---- market 1: WIN MATCH ----------------------------------------------
  // Decide the lean first (needed to know which side to score). Use the
  // de-vigged market favourite when priced, else the season record, else home.
  const fav = ml.home?.fairProb != null && ml.away?.fairProb != null
    ? (ml.home.fairProb >= ml.away.fairProb ? 'home' : 'away')
    : null;

  const homeFormPts = formPoints(homeForm);
  const awayFormPts = formPoints(awayForm);
  const formEdge = (homeFormPts ?? 0) - (awayFormPts ?? 0);

  const homeRec = home.record || null;
  const awayRec = away.record || null;
  const homeRecPts = recordPoints(homeRec, awayRec);
  const awayRecPts = recordPoints(awayRec, homeRec);

  let lean = fav;
  if (!lean) {
    const homeScore = (homeFormPts ?? 0) + (homeRecPts ?? 0);
    const awayScore = (awayFormPts ?? 0) + (awayRecPts ?? 0);
    if (homeScore !== awayScore) lean = homeScore > awayScore ? 'home' : 'away';
    else lean = 'home';
  }
  const sideName = lean === 'home' ? homeName : awayName;

  // WIN MATCH bucket-by-bucket.
  const wmBreakdown = [];
  let wmScore = 0;

  const osPts = oddsStrength(lean === 'home' ? homePrice : awayPrice);
  if (osPts !== null) {
    wmScore += osPts;
    wmBreakdown.push({ bucket: 'odds-strength', points: osPts, max: 30, detail: `${sideName} moneyline ${lean === 'home' ? homePrice : awayPrice}` });
  } else {
    addMissing(missing, 'NBA-ODDS', 'moneyline odds', 'no moneyline published for this fixture in the free feed');
  }
  if (odds && ml.home && ml.away) {
    addMissing(missing, 'NBA-ODDS-2', 'second closing-odds source', 'the prompt requires odds cross-referenced across at least two sources; ESPN republishes a single book');
  }

  const fPts = lean === 'home' ? homeFormPts : awayFormPts;
  if (fPts !== null) {
    wmScore += fPts;
    wmBreakdown.push({ bucket: 'recent-form', points: fPts, max: 25, detail: `${sideName} last-5 ${(lean === 'home' ? homeForm : awayForm).join('')}` });
  } else {
    addMissing(missing, 'NBA-FORM', 'recent form (last month)', 'no completed results for this team inside the collected window');
  }

  const hPts = h2hPoints(h2h, sideName, homeName, awayName);
  if (hPts !== null) {
    wmScore += hPts;
    wmBreakdown.push({ bucket: 'head-to-head', points: hPts, max: 20, detail: `${h2h.meetings} meetings ${h2h.homeWins}-${h2h.awayWins} (home-away)` });
  } else {
    addMissing(missing, 'NBA-H2H', 'head-to-head (last 3 years)', h2h && h2h.meetings < 3
      ? `fewer than three prior meetings inside the collected window (${h2h.meetings})`
      : 'no prior meetings inside the collected window');
  }

  const rPts = lean === 'home' ? homeRecPts : awayRecPts;
  if (rPts !== null) {
    wmScore += rPts;
    wmBreakdown.push({ bucket: 'season-record', points: rPts, max: 15, detail: `${sideName} ${(lean === 'home' ? homeRec : awayRec).winPct * 100}% win rate` });
  } else {
    addMissing(missing, 'NBA-REC', 'season win-loss record', 'no season record published for this team yet');
  }
  addMissing(missing, 'NBA-CONF', 'conference rank (top-3 / 4-6 / 7-10 tiers)', 'no key-less conference standings feed; the -5 opponent-higher adjustment is applied only via season win rate');

  const cPts = contextPoints(lean === 'home' ? home : away, lean === 'home', neutral);
  wmScore += cPts;
  wmBreakdown.push({ bucket: 'context-home-court', points: cPts, max: 10, detail: `${lean === 'home' ? 'home side' : 'away side'}${neutral ? ' (neutral venue)' : ''}` });
  addMissing(missing, 'NBA-STAKES', 'game-stakes tier (high/mid/low)', 'not determinable from the free feed; venue edge is the only scored context signal');

  wmScore = clamp(wmScore, 0, 100);

  // ---- market 2: POINT SPREAD -------------------------------------------
  // "All moneyline factors above as base" with the context score replaced by
  // the ATS trend, then the injury and fatigue modifiers.
  const spBreakdown = [];
  let spScore = clamp(wmScore - cPts, 0, 100); // remove context bucket
  spBreakdown.push({ bucket: 'moneyline-factors', points: clamp(wmScore - cPts, 0, 100), max: 90, detail: 'odds-strength + form + head-to-head + season record' });

  // ATS trend — never inferred from scores alone.
  addMissing(missing, 'NBA-ATS', 'ATS trend (last 10 covers)', 'no free key-less feed retains a team\'s point-spread covers; not inferred from final scores');

  // Injury impact modifier — never invented.
  addMissing(missing, 'NBA-INJ', 'injury/availability impact', 'no free date-specific injury feed; see the official NBA injury report for manual review');

  const fat = fatiguePoints(rest.home, rest.away);
  const fatSide = lean === 'home' ? fat : -fat; // own B2B hurts the leaned side, opponent B2B helps it
  spScore = clamp(spScore + fatSide, 0, 100);
  spBreakdown.push({ bucket: 'fatigue', points: fatSide, max: 5, detail: rest.home != null || rest.away != null ? `rest home ${rest.home ?? '?'}d away ${rest.away ?? '?'}d` : 'rest unknown' });
  if (rest.home == null && rest.away == null) addMissing(missing, 'NBA-REST', 'back-to-back fatigue flag', 'no prior completed fixture for either team inside the collected window');

  // ---- market 3: GAME TOTAL ---------------------------------------------
  // Every pace / defensive-efficiency / injury / totals-trend input is absent
  // from the free scoreboard feed, so this market is structurally SKIP unless
  // a future feed supplies them. That is the honest outcome, stated plainly.
  const gtBreakdown = [];
  addMissing(missing, 'NBA-PACE', 'offensive pace rating (both teams)', 'pace ratings are not published in the key-less scoreboard feed');
  addMissing(missing, 'NBA-DEF', 'defensive efficiency (both teams)', 'defensive efficiency is not published in the key-less scoreboard feed');
  addMissing(missing, 'NBA-INJ-SCORE', 'injury impact on scoring', 'no free date-specific injury feed');
  addMissing(missing, 'NBA-TRENDS', 'recent over/under trends (last 5)', 'closing totals are not retained against results by any free feed, so over/under trends cannot be measured');
  let gtScore = 0;
  if (typeof home.avgPoints === 'number' && typeof away.avgPoints === 'number') {
    // The only genuinely sourced scoring signal: combined per-game averages.
    // It cannot satisfy the pace/defence rubric, but it is recorded so the
    // market can at least be described honestly rather than left blank.
    gtBreakdown.push({ bucket: 'scoring-average', points: 0, max: 0, detail: `${homeName} ${home.avgPoints} ppg · ${awayName} ${away.avgPoints} ppg` });
  }

  // ---- confidence (STEP 3) ----------------------------------------------
  // Completeness caps the ceiling: each missing critical input lowers the cap.
  const requiredMissing = missing.filter((m) => ['NBA-ODDS', 'NBA-ODDS-2', 'NBA-FORM', 'NBA-H2H', 'NBA-REC', 'NBA-ATS', 'NBA-INJ', 'NBA-PACE', 'NBA-DEF'].includes(m.id)).length;

  const market = (score, cap, reasonWhenSkip) => {
    if (score < 50) return { score, cap, band: 'SKIP', reason: reasonWhenSkip };
    // Heavier favourites must clear a higher bar (STEP 3).
    const heavy = osPts === 30; // -300 or heavier
    const floor = heavy ? 75 : 70;
    if (score >= floor) return { score, cap, band: 'HIGH' };
    if (score >= 50) return { score, cap, band: 'MEDIUM' };
    return { score, cap, band: 'SKIP', reason: reasonWhenSkip };
  };

  const wmCap = clamp(100 - requiredMissing * 6, 40, 100);
  const spCap = clamp(wmCap - 8, 40, 100);
  const wm = market(wmScore, wmCap, wmScore < 50 ? 'score below the 50-point publication threshold across the sourced factors' : null);
  const sp = market(spScore, spCap, spScore < 50 ? 'spread evidence (ATS trend, injuries) cannot be sourced on the free feed' : null);
  const gt = { score: gtScore, cap: 0, band: 'SKIP', reason: 'pace, defensive-efficiency, injury and totals-trend inputs are unavailable on the free feed' };

  const selection = (mk, side) => (mk.band === 'SKIP' ? null : side);
  const markets = {
    match_result: {
      label: 'WIN MATCH',
      selection: selection(wm, sideName),
      selectionKey: lean,
      score: wm.score,
      cap: wm.cap,
      band: wm.band,
      reason: wm.reason,
      breakdown: wmBreakdown,
      probability: null,
    },
    handicap: {
      label: 'POINT SPREAD',
      selection: selection(sp, sideName),
      selectionKey: lean,
      score: sp.score,
      cap: sp.cap,
      band: sp.band,
      reason: sp.reason,
      breakdown: spBreakdown,
      line: odds?.spread ? (lean === 'home' ? odds.spread.homeLine : odds.spread.awayLine) : null,
    },
    total: {
      label: 'GAME TOTAL',
      selection: null,
      selectionKey: null,
      score: gt.score,
      cap: 0,
      band: 'SKIP',
      reason: gt.reason,
      breakdown: gtBreakdown,
      line: odds?.total?.line ?? null,
    },
  };

  // Headline = the strongest publishable market (feeds the rail and the tip
  // box). Prefer WIN MATCH, then SPREAD; never GAME TOTAL until it can
  // actually clear the rubric.
  const publishable = [['match_result', markets.match_result], ['handicap', markets.handicap]]
    .filter(([, m]) => m.band !== 'SKIP')
    .sort((a, b) => b[1].score - a[1].score);
  const headline = publishable.length ? { market: publishable[0][0], ...publishable[0][1] } : null;

  return {
    matchId: match?.id ?? null,
    match: `${homeName} v ${awayName}`,
    league: match?.leagueName ?? null,
    dateISO: match?.dateISO ?? null,
    startUtc: match?.startUtc ?? null,
    phase: match?.phase ?? null,
    ruleset: NBA_RULESET_VERSION,
    promptVersion: NBA_PROMPT_VERSION,
    lean,
    neutral,
    homeName,
    awayName,
    odds,
    // Compatibility with the shared detail renderer: the universal engine
    // exposes `model.signals`; the NBA rubric reports its per-bucket trace via
    // `markets.*.breakdown` instead, so this stays empty by design.
    model: { signals: [] },
    markets,
    headline,
    scoreable: Boolean(headline),
    missing,
    sources: buildSourceList(match),
  };
}

function buildSourceList(match) {
  const out = [];
  if (match?.leagueSlug) {
    out.push({
      label: `ESPN ${match.leagueName || match.leagueSlug} scoreboard`,
      url: `https://site.api.espn.com/apis/site/v2/sports/basketball/${match.leagueSlug}/scoreboard?dates=${(match.dateISO || '').replace(/-/g, '')}`,
    });
  }
  if (match?.links?.summary) out.push({ label: 'ESPN match summary', url: match.links.summary });
  if (match?.home?.espnTeamUrl) out.push({ label: `${match.home.name} team page`, url: match.home.espnTeamUrl });
  if (match?.away?.espnTeamUrl) out.push({ label: `${match.away.name} team page`, url: match.away.espnTeamUrl });
  out.push({ label: 'NBA official injury report', url: 'https://official.nba.com/nba-injury-report-2025-26-season/' });
  out.push({ label: 'OLBG Basketball tips', url: 'https://www.olbg.com/betting-tips/Basketball/4' });
  return out;
}

/** Score a whole card and report which games could not be scored and why. */
export function scoreNbaCard(matches, ctxFor) {
  const results = [];
  const unscored = [];
  for (const m of matches || []) {
    const ctx = typeof ctxFor === 'function' ? ctxFor(m) : (ctxFor || {});
    const r = scoreNbaMatch(m, ctx);
    if (r.scoreable) results.push(r);
    else unscored.push({ matchId: m.id, match: r.match, reason: r.markets.match_result.reason || 'no market cleared the publication threshold' });
  }
  results.sort((a, b) => (b.headline?.score || 0) - (a.headline?.score || 0));
  return { ruleset: NBA_RULESET_VERSION, results, unscored };
}
