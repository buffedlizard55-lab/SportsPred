/**
 * SportsPred — Volleyball Scoring Engine (Canonical Implementation).
 *
 * Implements "VOLLEYBALL PREDICTION MASTER PROMPT v1.0", Step 2 (WIN MATCH
 * and SET SCORE scoring) and Step 3 (decision rules) exactly as specified.
 *
 * RULES OF THIS MODULE:
 *  - Pure functions only. No I/O, no network, no clock, no randomness.
 *  - A missing field is never guessed: it is recorded in `missing[]` and the
 *    score is reduced. This is what makes "no hallucinations" enforceable.
 *  - Every point awarded is traceable: each component records its rule id,
 *    the value that triggered it and the points given.
 */

export const RULESET_VERSION = 'v1.0';
export const PROMPT_VERSION = 'v1.0';

export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' };

const MISSING_FIELD_PENALTY = 5;
const MIN_FACTORS_FOR_MEDIUM = 2;

export function decimalToAmerican(decimal) {
  if (decimal == null || !Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function americanToImpliedProb(american) {
  if (american == null) return null;
  if (american > 0) return 100 / (american + 100);
  if (american < 0) return -american / (-american + 100);
  return null;
}

export function normaliseOdds(raw) {
  if (raw == null) return null;
  let decimal = null;
  if (typeof raw === 'object') {
    decimal = raw.decimal ?? null;
    if (decimal == null && raw.american != null) {
      decimal = raw.american > 0 ? raw.american / 100 + 1 : 100 / -raw.american + 1;
    }
  } else if (typeof raw === 'number') {
    decimal = raw >= 1.01 ? raw : null;
  }
  if (decimal == null || !Number.isFinite(decimal) || decimal <= 1.0) return null;
  return { decimal: Number(decimal.toFixed(3)), american: decimalToAmerican(decimal) };
}

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

function lastN(list, n) {
  return Array.isArray(list) ? list.slice(0, n) : [];
}

function winStreakFrom(last5) {
  if (!Array.isArray(last5) || !last5.length) return 0;
  let n = 0;
  for (const r of last5) {
    if (r === 'W') n += 1;
    else break;
  }
  return n;
}

function lossStreakFrom(last5) {
  if (!Array.isArray(last5) || !last5.length) return 0;
  let n = 0;
  for (const r of last5) {
    if (r === 'L') n += 1;
    else break;
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * WIN MATCH MARKET (100pts)
 * ------------------------------------------------------------------ */

export function scoreRecentForm(fav, opp, missing) {
  const last5 = lastN(fav?.form?.last5, 5);
  const out = [];
  if (last5.length < 5) {
    missing.push('form.last5 (last 5 match results, last month)');
    out.push(comp('form', 'Recent Form (last month double weighted)', 0, 'no sourced last 5 match results', { max: 30, missing: true }));
    return { components: out, formBase: 0, wins: null };
  }

  const wins = last5.filter((r) => r === 'W').length;
  let base = 0;
  if (wins === 5) base = 30;
  else if (wins === 4) base = 22;
  else if (wins === 3) base = 12;
  else base = 0;

  out.push(comp('form', `Recent Form: ${wins}/5 wins`, base, `${wins} wins in last 5 matches`, { max: 30 }));

  const winStreak = fav?.form?.winStreak ?? winStreakFrom(last5);
  if (winStreak >= 5) {
    out.push(comp('form_win_streak', 'Bonus: winning streak of 5 or more', 5, `Streak of ${winStreak}`, { max: 5 }));
  }

  const streakSetScores = lastN(fav?.form?.last5SetScores, winStreak);
  const allStraight = winStreak > 0 && streakSetScores.length === winStreak
    && streakSetScores.every((s) => s === '3-0');
  if (allStraight) {
    out.push(comp('form_straight_streak', 'Bonus: current streak won without dropping a set', 5, 'every win in the streak was 3-0', { max: 5 }));
  } else if (winStreak > 0 && streakSetScores.length < winStreak) {
    missing.push('form.last5SetScores (straight-set streak bonus unscored — set scores not fully sourced)');
  }

  const oppLast5 = lastN(opp?.form?.last5, 5);
  const oppLossStreak = opp?.form?.lossStreak ?? lossStreakFrom(oppLast5);
  if (oppLossStreak >= 2) {
    out.push(comp('form_opp_loss', 'Bonus: opponent has lost their last 2 or more matches', 3, `Opponent loss streak ${oppLossStreak}`, { max: 3 }));
  }

  return { components: out, formBase: base, wins };
}

function invertSetScore(s) {
  const m = String(s || '').match(/^(\d)-(\d)$/);
  if (!m) return s;
  return `${m[2]}-${m[1]}`;
}

/** Orient a raw meeting list onto the favourite. Accepts either
 *  `{ result: 'W'|'L', setScore }` (already oriented) or
 *  `{ winner, setScore, home, away }` (raw tape). */
export function orientMeetings(meetings, favName) {
  return (meetings || []).map((m) => {
    if (m.result === 'W' || m.result === 'L') {
      return { result: m.result, setScore: m.setScore || null, venue: m.venue || null };
    }
    const won = m.winner === favName;
    return {
      result: won ? 'W' : 'L',
      setScore: m.setScore ? (won ? m.setScore : invertSetScore(m.setScore)) : null,
      venue: m.venue || null,
    };
  });
}

export function scoreH2H(fav, match, missing) {
  const h2h = match?.h2h;
  const out = [];
  const raw = h2h?.recentMeetings || h2h?.meetings || [];
  const meetings = orientMeetings(raw, fav?.name);
  if (!Array.isArray(meetings) || meetings.length === 0) {
    missing.push('h2h (head-to-head record over last 3 years with set scores)');
    out.push(comp('h2h', 'Head-to-Head Record', 0, 'no sourced H2H meetings', { max: 25, missing: true }));
    return out;
  }

  const last5 = meetings.slice(0, 5);
  const last3 = meetings.slice(0, 3);
  // Weight most recent 3 meetings double over the full last-5 record.
  const weightedWins = last5.filter((m) => m.result === 'W').length + last3.filter((m) => m.result === 'W').length;
  const weightedTotal = last5.length + last3.length;
  const winRate = weightedTotal > 0 ? weightedWins / weightedTotal : 0;
  const last5Wins = last5.filter((m) => m.result === 'W').length;

  let pts = 0;
  if (last5.length >= 5 && last5Wins >= 4) pts = 25;
  else if (last5.length >= 5 && last5Wins === 3) pts = 16;
  else if (last5.length < 5) {
    // Fewer than 5 meetings: use the weighted rate, never invent the missing meetings.
    if (winRate >= 0.70) pts = 16;
    else if (winRate >= 0.45) pts = 7;
    else pts = 0;
    missing.push('h2h.last5 (fewer than 5 sourced H2H meetings; scored from available meetings only)');
  } else if (winRate >= 0.45 && winRate < 0.60) pts = 7;
  else pts = 0;

  out.push(comp('h2h', `Head-to-Head: ${last5Wins}/${last5.length} of last meetings (recent 3 double-weighted)`, pts,
    `${last5.length} sourced meetings, weighted win rate ${(winRate * 100).toFixed(0)}%`, { max: 25 }));

  const venueWins = lastN(h2h?.venueLastMeetings, 2);
  if (venueWins.length >= 2 && venueWins.every((m) => m.result === 'W')) {
    out.push(comp('h2h_venue', 'Bonus: won the last 2 meetings at this specific venue', 5, 'last two at this venue won', { max: 5 }));
  }

  return out;
}

export function scoreOddsAndValue(fav, h2hWinRate, formBase, missing) {
  const am = fav?.odds?.american ?? null;
  const out = [];
  if (am == null) {
    missing.push('odds (moneyline from at least two bookmakers)');
    out.push(comp('odds_value', 'Odds and Value Assessment', 0, 'no sourced moneyline odds', { max: 20, missing: true }));
    return out;
  }

  let pts = 0;
  let detail = `American ${am}`;
  if (am <= -300) pts = 20;
  else if (am <= -200) pts = 14;
  else if (am <= -150) pts = 9;
  else if (am <= -100) pts = 5;
  else if (am > 0 && formBase >= 22 && h2hWinRate >= 0.55) {
    pts = 7;
    detail += ' — positive odds with strong form and H2H support';
  }

  out.push(comp('odds_value', 'Odds and Value Assessment', pts, detail, { max: 20 }));

  if (am <= -300 && (h2hWinRate == null || h2hWinRate < 0.60)) {
    out.push(comp('odds_trap', 'Deduction: odds shorter than -300 with H2H below 60%', -8, 'favourite trap penalty', { max: 0 }));
  }
  return out;
}

export function scoreAttackingQuality(fav, opp, missing) {
  const out = [];
  const kps = fav?.stats?.killsPerSet ?? null;
  const bps = fav?.stats?.blocksPerSet ?? null;
  const kRank = fav?.stats?.killsPerSetRank ?? null;
  const bRank = fav?.stats?.blocksPerSetRank ?? null;

  if (kps == null && kRank == null) {
    missing.push('attacking (kills per set / league attacking rank)');
    out.push(comp('attack', 'Attacking and Defensive Quality', 0, 'no sourced kills/blocks per set', { max: 15, missing: true }));
  } else {
    let pts = 0;
    if (kRank != null && kRank <= 3 && bRank != null && bRank <= 5) pts = 15;
    else if (kRank != null && kRank <= 5) pts = 10;
    else if (kRank != null && kRank <= 10) pts = 5;
    else pts = 0;
    out.push(comp('attack', 'Attacking and Defensive Quality', pts,
      `kills/set rank ${kRank ?? 'n/a'}, blocks/set rank ${bRank ?? 'n/a'}`, { max: 15 }));
  }

  if (opp?.stats?.weakServeReceive === true) {
    out.push(comp('attack_serve_receive', 'Bonus: opponent weak serve receive recently exploited', 3, 'opponent serve-receive weakness sourced', { max: 3 }));
  }
  return out;
}

export function scoreHomeAdvantage(fav, opp, match, missing) {
  const out = [];
  const isHome = fav?.isHome === true;
  const homeWinRate = fav?.homeRecord?.winRate ?? null;
  const awayLossRate = opp?.awayRecord?.lossRate ?? null;
  const backToBack = fav?.rest?.playedWithin48h === true;

  if (!isHome) {
    out.push(comp('home', 'Home Advantage and Context', 2, match?.neutral ? 'neutral venue' : 'not the confirmed home side', { max: 10 }));
  } else if (homeWinRate == null) {
    missing.push('homeRecord (home win rate this season)');
    out.push(comp('home', 'Home Advantage and Context', 2, 'home side confirmed but home record unsourced', { max: 10, missing: true }));
  } else if (homeWinRate >= 0.65) {
    out.push(comp('home', 'Home Advantage: winning 65% or more at home', 10, `home win rate ${(homeWinRate * 100).toFixed(0)}%`, { max: 10 }));
  } else if (homeWinRate >= 0.50) {
    out.push(comp('home', 'Home Advantage: average home record 50 to 64%', 6, `home win rate ${(homeWinRate * 100).toFixed(0)}%`, { max: 10 }));
  } else {
    out.push(comp('home', 'Home Advantage: poor home record', 2, `home win rate ${(homeWinRate * 100).toFixed(0)}%`, { max: 10 }));
  }

  if (awayLossRate != null && awayLossRate >= 0.60) {
    out.push(comp('home_opp_away', 'Bonus: opponent loses 60% or more of away matches', 3, `away loss rate ${(awayLossRate * 100).toFixed(0)}%`, { max: 3 }));
  }
  if (isHome && backToBack) {
    out.push(comp('home_b2b', 'Deduction: home team on a back-to-back schedule', -5, 'played within 48 hours', { max: 0 }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * SET SCORE MARKET
 * ------------------------------------------------------------------ */

function countStraightWins(setScores) {
  return (setScores || []).filter((s) => s === '3-0').length;
}

function count31Wins(setScores) {
  return (setScores || []).filter((s) => s === '3-1').length;
}

function setsPlayed(score) {
  if (!score || typeof score !== 'string') return null;
  const m = score.match(/^(\d)-(\d)$/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]);
}

export function scoreSetScoreOutcomes(fav, opp, match, wmScore, wmBand, missing) {
  const last5ss = lastN(fav?.form?.last5SetScores, 5);
  const oppLast5ss = lastN(opp?.form?.last5SetScores, 5);
  const h2h = orientMeetings(match?.h2h?.recentMeetings || [], fav?.name);
  const h2hScores = h2h.map((m) => m.setScore).filter(Boolean);

  const threeNil = [];
  const threeOne = [];
  const threeTwo = [];

  if (last5ss.length < 5) {
    missing.push('form.last5SetScores (set scores of last 5 matches)');
  }

  // ---- 3-0 ----
  const straightOwn = countStraightWins(last5ss);
  if (last5ss.length >= 5 && straightOwn >= 3) {
    threeNil.push(comp('ss30_form', 'Won 3 or more of last 5 in straight sets', 30, `${straightOwn}/5 were 3-0`, { max: 30 }));
  }
  const h2hStraight = h2hScores.filter((s) => s === '3-0').length;
  if (h2hScores.length >= 5 && h2hStraight >= 3) {
    threeNil.push(comp('ss30_h2h', 'Won at least 3 of last 5 H2H in straight sets', 25, `${h2hStraight}/5 H2H were 3-0`, { max: 25 }));
  } else if (h2hScores.length === 0) {
    missing.push('h2h.setScores (for straight-set H2H indicator)');
  }
  const favRank = fav?.standings?.rank ?? fav?.rank ?? null;
  const oppRank = opp?.standings?.rank ?? opp?.rank ?? null;
  const totalTeams = fav?.standings?.totalTeams ?? null;
  if (favRank != null && oppRank != null && totalTeams != null && favRank <= 3 && oppRank > totalTeams / 2) {
    threeNil.push(comp('ss30_gap', 'Significant ranking gap: top 3 vs bottom half', 20, `#${favRank} vs #${oppRank} of ${totalTeams}`, { max: 20 }));
  }
  const oppStraightLosses = oppLast5ss.filter((s) => s === '0-3').length;
  if (oppLast5ss.length >= 3 && oppStraightLosses >= 2) {
    threeNil.push(comp('ss30_opp', 'Opponent has lost multiple recent matches in straight sets', 15, `${oppStraightLosses} recent 0-3 losses`, { max: 15 }));
  }
  if (wmScore >= 75) {
    threeNil.push(comp('ss30_wm', 'Win match score for the favourite is 75 or higher', 10, `win match ${wmScore}`, { max: 10 }));
  }

  // ---- 3-1 ----
  const own31 = count31Wins(last5ss);
  if (last5ss.length >= 5 && own31 >= 3) {
    threeOne.push(comp('ss31_form', 'Won 3 or more of last 5 matches by 3-1', 25, `${own31}/5 were 3-1`, { max: 25 }));
  }
  const oppDropsThenLoses = opp?.form?.competitiveThenCollapses === true
    || (oppLast5ss.length >= 3 && oppLast5ss.filter((s) => s === '1-3' || s === '0-3').length >= 3);
  if (oppDropsThenLoses) {
    threeOne.push(comp('ss31_opp', 'Opponent competitive but consistently loses one set before collapsing', 20, 'recent 1-3 / 0-3 pattern', { max: 20 }));
  }
  const last3h2h = h2hScores.slice(0, 3);
  const avgSets = last3h2h.length === 3
    ? last3h2h.map(setsPlayed).filter((n) => n != null).reduce((a, b) => a + b, 0) / 3
    : null;
  if (avgSets != null && avgSets >= 3.5 && avgSets < 4.5) {
    threeOne.push(comp('ss31_h2h_avg', 'Head-to-head last 3 meetings have averaged 4 sets per match', 20, `average ${avgSets.toFixed(1)} sets`, { max: 20 }));
  }
  const droppedButWins = last5ss.length >= 5
    && last5ss.filter((s) => s === '3-1' || s === '3-2').length >= 2
    && lastN(fav?.form?.last5, 5).filter((r) => r === 'W').length >= 3;
  if (droppedButWins) {
    threeOne.push(comp('ss31_form_drop', 'Form shows occasional dropped sets but consistent match wins', 20, 'wins with 3-1 / 3-2 mixed in', { max: 20 }));
  }
  if (wmScore >= 60 && wmScore <= 74) {
    threeOne.push(comp('ss31_wm', 'Win match score for the favourite is 60 to 74', 15, `win match ${wmScore}`, { max: 15 }));
  }

  // ---- 3-2 ----
  const last3AllFive = last3h2h.length === 3 && last3h2h.every((s) => s === '3-2' || s === '2-3');
  if (last3AllFive) {
    threeTwo.push(comp('ss32_h2h', 'Last 3 head-to-head meetings have gone to 5 sets', 30, 'all three most recent H2H were 5 sets', { max: 30 }));
  }
  const favWins = lastN(fav?.form?.last5, 5).filter((r) => r === 'W').length;
  const oppWins = lastN(opp?.form?.last5, 5).filter((r) => r === 'W').length;
  if (lastN(fav?.form?.last5, 5).length === 5 && lastN(opp?.form?.last5, 5).length === 5 && Math.abs(favWins - oppWins) <= 1) {
    threeTwo.push(comp('ss32_form', 'Both teams have nearly identical recent form and win-loss records', 25, `${favWins}/5 vs ${oppWins}/5`, { max: 25 }));
  }
  if (wmBand === CONFIDENCE.MEDIUM) {
    threeTwo.push(comp('ss32_wm', 'Win match confidence for the selected winner is MEDIUM rather than HIGH', 20, 'MEDIUM win-match band', { max: 20 }));
  }
  const bothTookSets = h2hScores.length >= 2 && h2hScores.every((s) => setsPlayed(s) >= 4);
  if (bothTookSets) {
    threeTwo.push(comp('ss32_sets', 'Both teams have shown ability to win sets against each other in recent meetings', 15, 'recent H2H not 3-0', { max: 15 }));
  }
  const am = fav?.odds?.american ?? null;
  if (am != null && am <= -100 && am >= -180) {
    threeTwo.push(comp('ss32_odds', 'Odds for the match winner are between -100 and -180', 10, `American ${am}`, { max: 10 }));
  } else if (am == null) {
    missing.push('odds (near-even contest indicator for 3-2)');
  }

  const sum = (arr) => arr.reduce((a, c) => a + Math.max(0, c.points), 0);
  return {
    '3-0': { score: Math.min(100, sum(threeNil)), components: threeNil },
    '3-1': { score: Math.min(100, sum(threeOne)), components: threeOne },
    '3-2': { score: Math.min(100, sum(threeTwo)), components: threeTwo },
    last3AllFive,
    lastH2HSetScore: h2hScores[0] || null,
  };
}

/* ------------------------------------------------------------------ *
 * Assembly & decision rules
 * ------------------------------------------------------------------ */

function totalPoints(components) {
  return Math.min(100, components.reduce((sum, c) => sum + c.points, 0));
}

function applyMissingFieldPenalty(score, missing) {
  return Math.max(0, score - new Set(missing).size * MISSING_FIELD_PENALTY);
}

function sourcedFactorCount(components) {
  return components.filter((c) => !c.missing && c.points > 0).length;
}

export function pickVolleyballFavourite(match) {
  const home = match?.homeTeamObj || { name: match?.home, isHome: true };
  const away = match?.awayTeamObj || { name: match?.away, isHome: false };
  const hoa = home?.odds?.american ?? null;
  const aoa = away?.odds?.american ?? null;
  if (hoa != null && aoa != null) return hoa < aoa ? [home, away] : [away, home];

  const hr = home?.standings?.rank ?? home?.rank ?? null;
  const ar = away?.standings?.rank ?? away?.rank ?? null;
  const usable = (r) => r != null && r < 90;
  if (usable(hr) && usable(ar)) return hr <= ar ? [home, away] : [away, home];

  const hw = home?.record?.winPct ?? null;
  const aw = away?.record?.winPct ?? null;
  if (typeof hw === 'number' && typeof aw === 'number') return hw >= aw ? [home, away] : [away, home];

  const hf = lastN(home?.form?.last5, 5).filter((r) => r === 'W').length;
  const af = lastN(away?.form?.last5, 5).filter((r) => r === 'W').length;
  if (lastN(home?.form?.last5, 5).length && lastN(away?.form?.last5, 5).length) {
    return hf >= af ? [home, away] : [away, home];
  }
  return [home, away];
}

function h2hWinRate(match, favName) {
  const meetings = orientMeetings(match?.h2h?.recentMeetings || [], favName);
  if (!meetings.length) return null;
  const last5 = meetings.slice(0, 5);
  const last3 = meetings.slice(0, 3);
  const wins = last5.filter((m) => m.result === 'W').length + last3.filter((m) => m.result === 'W').length;
  return wins / (last5.length + last3.length);
}

export function scoreVolleyballMatch(match) {
  const missing = [];
  const flags = [];
  const [fav, opp] = pickVolleyballFavourite(match);

  if (!fav || !fav.name) {
    return {
      event_id: match?.event_id ?? match?.id ?? null,
      ruleset: RULESET_VERSION,
      favourite: null,
      markets: {},
      missing: ['favourite could not be determined'],
      flags: ['UNSCORED: no team data available'],
      summary: { any: false },
    };
  }

  const formResult = scoreRecentForm(fav, opp, missing);
  const h2hComp = scoreH2H(fav, match, missing);
  const oddsComp = scoreOddsAndValue(fav, h2hWinRate(match, fav.name), formResult.formBase, missing);
  const attackComp = scoreAttackingQuality(fav, opp, missing);
  const homeComp = scoreHomeAdvantage(fav, opp, match, missing);

  const wmComp = [...formResult.components, ...h2hComp, ...oddsComp, ...attackComp, ...homeComp];
  const wmRaw = totalPoints(wmComp);
  let wmScore = applyMissingFieldPenalty(wmRaw, missing);
  const factors = sourcedFactorCount(wmComp);

  let wmBand;
  if (wmScore >= 70) wmBand = CONFIDENCE.HIGH;
  else if (wmScore >= 50 && factors >= MIN_FACTORS_FOR_MEDIUM) wmBand = CONFIDENCE.MEDIUM;
  else wmBand = CONFIDENCE.SKIP;

  const amOdds = fav?.odds?.american ?? null;
  if (amOdds != null && amOdds <= -400 && wmScore < 80) {
    flags.push('RULE: odds shorter than -400 require a win-match score of 80 or higher.');
    if (wmBand === CONFIDENCE.HIGH) wmBand = CONFIDENCE.MEDIUM;
  }
  if (amOdds == null) {
    flags.push('LIVE_CAP: no sourced moneyline from two bookmakers; confidence cannot read HIGH.');
    if (wmBand === CONFIDENCE.HIGH) wmBand = CONFIDENCE.MEDIUM;
  }
  if (wmBand === CONFIDENCE.SKIP) {
    flags.push('WIN_SKIP: score below 50 or fewer than two sourced factors aligned.');
  }

  const ss = scoreSetScoreOutcomes(fav, opp, match, wmScore, wmBand, missing);
  const outcomes = ['3-0', '3-1', '3-2'].map((k) => ({
    outcome: k,
    score: applyMissingFieldPenalty(ss[k].score, missing),
    rawScore: ss[k].score,
    components: ss[k].components,
  }));
  outcomes.sort((a, b) => b.score - a.score);

  // Tiebreaker: if two set-score outcomes produce equal scores, select the one
  // supported by the most recent head-to-head meeting's actual set score.
  if (outcomes.length >= 2 && outcomes[0].score === outcomes[1].score && ss.lastH2HSetScore) {
    const pref = ss.lastH2HSetScore.startsWith('3-') ? ss.lastH2HSetScore : invertSetScore(ss.lastH2HSetScore);
    outcomes.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.outcome === pref) return -1;
      if (b.outcome === pref) return 1;
      return 0;
    });
  }

  const best = outcomes[0];
  const second = outcomes[1];
  const close = second && Math.abs(best.score - second.score) <= 5;

  let ssBand;
  if (best.score >= 70 && !close) ssBand = CONFIDENCE.HIGH;
  else if (best.score >= 55 && !close) ssBand = CONFIDENCE.MEDIUM;
  else ssBand = CONFIDENCE.LOW;

  if (close) {
    flags.push('SET_UNCERTAIN: two outcomes within 5 points of each other.');
    ssBand = CONFIDENCE.LOW;
  }
  if (best.outcome === '3-2' && ssBand === CONFIDENCE.HIGH && !ss.last3AllFive) {
    flags.push('RULE: never recommend 3-2 at HIGH unless last 3 H2H meetings have all gone to 5 sets.');
    ssBand = CONFIDENCE.MEDIUM;
  }
  if (ssBand === CONFIDENCE.HIGH && wmScore < 65) {
    flags.push('RULE: set score HIGH requires a win-match score of 65 or higher.');
    ssBand = CONFIDENCE.MEDIUM;
  }
  if (amOdds == null && ssBand === CONFIDENCE.HIGH) {
    ssBand = CONFIDENCE.MEDIUM;
  }
  if (best.score < 55) {
    flags.push('SET_LOW: highest outcome score below 55.');
  }

  // Recommend thresholds from the prompt (used as a publication gate, not invented).
  const recommend = (best.outcome === '3-0' && best.rawScore >= 70)
    || (best.outcome === '3-1' && best.rawScore >= 65)
    || (best.outcome === '3-2' && best.rawScore >= 60);

  const missingSorted = [...new Set(missing)].sort();

  return {
    event_id: match?.event_id ?? match?.id ?? null,
    ruleset: RULESET_VERSION,
    favourite: fav.name,
    opponent: opp.name,
    markets: {
      win_match: {
        score: wmScore,
        rawScore: wmRaw,
        band: wmBand,
        selection: wmBand === CONFIDENCE.SKIP ? null : fav.name,
        components: wmComp,
        reason: wmBand === CONFIDENCE.SKIP ? 'evidence fails to reach the required selection threshold' : null,
      },
      set_score: {
        score: best.score,
        rawScore: best.rawScore,
        band: ssBand,
        selection: recommend || ssBand !== CONFIDENCE.LOW ? best.outcome : null,
        outcome: best.outcome,
        outcomes,
        components: best.components,
        uncertain: close,
        reason: ssBand === CONFIDENCE.LOW ? 'highest outcome below threshold or two outcomes within five points' : null,
      },
    },
    missing: missingSorted,
    flags,
    summary: {
      any: wmBand !== CONFIDENCE.SKIP,
      allSkips: wmBand === CONFIDENCE.SKIP && ssBand === CONFIDENCE.LOW,
    },
  };
}

export function scoreVolleyballCard(matches) {
  const results = (matches || []).map((m) => ({ match: m, result: scoreVolleyballMatch(m) }));
  const below = results.filter((r) => (r.result.markets.win_match?.score ?? 0) < 50).length;
  if (below >= 3) {
    const ranked = [...results].sort((a, b) => (b.result.markets.win_match?.score ?? 0) - (a.result.markets.win_match?.score ?? 0));
    const keep = new Set(ranked.slice(0, Math.max(1, ranked.length - below + 2)).map((r) => r.result.event_id));
    for (const row of results) {
      if (!keep.has(row.result.event_id) && row.result.markets.win_match?.band !== CONFIDENCE.SKIP) {
        row.result.flags.push('CARD_RULE: 3 or more matches scored below 50; this selection was reduced off the day\'s card.');
        row.result.markets.win_match.band = CONFIDENCE.SKIP;
        row.result.markets.win_match.selection = null;
        row.result.markets.win_match.reason = 'reduced off a thin card';
      }
    }
  }
  return { ruleset: RULESET_VERSION, results, count: results.length };
}
