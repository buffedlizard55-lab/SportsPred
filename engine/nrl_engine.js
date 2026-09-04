/**
 * SportsPred — NRL Scoring Engine.
 *
 * Implements "NRL (NATIONAL RUGBY LEAGUE) PREDICTION MASTER PROMPT v1.0",
 * Step 2 (market scoring) and Step 3 (bet decision rules).
 *
 * Three markets per match, scored independently out of 100:
 *   WIN MATCH   form 25 · ladder & finals stakes 20 · head-to-head 15 ·
 *               key absences (incl. Origin) 20 · odds & value 15 · travel 5
 *   HANDICAP    win-match base + margin-of-victory trend + Origin fatigue,
 *               only live when the WIN MATCH score is 60 or higher
 *   GAME TOTAL  offence 30 · defence 25 · recent totals 20 ·
 *               golden point / game state 15 · weather 10
 *
 * RULES OF THIS MODULE
 *  - Pure functions. No I/O, no clock, no randomness.
 *  - A field that is not in a committed document is never guessed. It scores
 *    zero and is named in `missing[]`; the shortfall is carried through as an
 *    *evidence coverage* figure that caps how confident the card may be.
 *  - Every point is traceable: each component records its rule id, the value
 *    that triggered it and the points awarded.
 *  - Thresholds are the prompt's. They are never tuned to make a card look
 *    better; where evidence is thin the card says so instead.
 */

export const PROMPT_VERSION = 'v1.0';
export const RULESET_VERSION = 'v1.0';
export const CONFIDENCE = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' };
export const MARKETS = ['win_match', 'handicap', 'game_total'];

/** Component weights — the prompt's 100 points, per market. */
export const WIN_WEIGHTS = {
  recent_form: 25,
  ladder_stakes: 20,
  head_to_head: 15,
  key_absences: 20,
  odds_value: 15,
  travel_venue: 5,
};

export const TOTAL_WEIGHTS = {
  combined_offence: 30,
  combined_defence: 25,
  recent_totals: 20,
  golden_point_state: 15,
  weather: 10,
};

/** Coverage gates. Below these, confidence is capped however high the score. */
export const COVERAGE = {
  MIN_PUBLISH: 0.5,   // below this the market is not published at all
  LOW_BELOW: 0.6,     // below this a published market drops to LOW
  HIGH_ABOVE: 0.75,   // below this a published market cannot be HIGH
};

const MAX_ACTIVE_MARKETS_PER_MATCH = 2;

function comp(id, label, points, max, detail, opts = {}) {
  return {
    id, label, points, max, detail,
    missing: !!opts.missing,
    partial: !!opts.partial,
    ...(opts.side ? { side: opts.side } : {}),
  };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * WIN MATCH
 * ------------------------------------------------------------------ */

/**
 * Recent form — 25 points. Prompt: won 4+ of last 6 = 25, 3 = 17, 2 = 8,
 * 1 or fewer = 0. Results are recency weighted (1.0 → 0.5), so the tier is
 * read off the weighted share with thresholds equivalent to 4/6, 3/6, 2/6.
 */
export function scoreRecentForm(form) {
  if (!form || !form.sample || form.sample < 3) {
    return comp('recent_form', 'Recent form (last 6, recency weighted)', 0, WIN_WEIGHTS.recent_form,
      form && form.sample ? `only ${form.sample} completed match(es) before this fixture — a two-match sample cannot carry a form tier` : 'no completed matches on the tape for this club before this fixture',
      { missing: true });
  }
  const share = form.weightedShare ?? 0;
  let points = 0;
  let tier = 'one win or fewer';
  if (share >= 0.72) { points = 25; tier = 'four or more wins'; }
  else if (share >= 0.52) { points = 17; tier = 'three wins'; }
  else if (share >= 0.33) { points = 8; tier = 'two wins'; }
  return comp('recent_form', 'Recent form (last 6, recency weighted)', points, WIN_WEIGHTS.recent_form,
    `${form.wins}W ${form.draws ?? 0}D ${form.losses}L from the last ${form.sample} (${tier} on a recency-weighted share of ${share})`);
}

/**
 * Ladder position and finals stakes — 20 points. Prompt: a wide points or
 * position gap in this team's favour, with extra weight if it sits inside the
 * top four while the opponent does not = 20; moderate = 12; closely matched =
 * 5; a gap favouring the opponent = 0.
 */
export function scoreLadderStakes(sideRow, oppRow) {
  if (!sideRow || !oppRow) {
    return comp('ladder_stakes', 'Ladder position & finals stakes', 0, WIN_WEIGHTS.ladder_stakes,
      'ladder rows unavailable for this fixture', { missing: true });
  }
  const ptsGap = sideRow.Pts - oppRow.Pts;
  const posGap = oppRow.pos - sideRow.pos;
  const band = (r) => (r.pos <= 4 ? 'top four (double chance)' : r.pos <= 8 ? 'five to eight (sudden death)' : 'outside the eight');
  const context = `${band(sideRow)} v ${band(oppRow)}`;
  let points = 0;
  let why = `gap favours the opponent (${oppRow.pos} on ${oppRow.Pts} v ${sideRow.pos} on ${sideRow.Pts})`;
  if (ptsGap >= 8 || posGap >= 6) {
    points = 20;
    why = `wide gap: ${ptsGap >= 0 ? '+' : ''}${ptsGap} competition points and ${posGap >= 0 ? '+' : ''}${posGap} places`;
  } else if (ptsGap >= 3 || posGap >= 3) {
    points = 12;
    why = `moderate gap: ${ptsGap >= 0 ? '+' : ''}${ptsGap} points, ${posGap >= 0 ? '+' : ''}${posGap} places`;
  } else if (Math.abs(ptsGap) <= 2 && Math.abs(posGap) <= 2) {
    points = 5;
    why = `closely matched: ${ptsGap >= 0 ? '+' : ''}${ptsGap} points, ${posGap >= 0 ? '+' : ''}${posGap} places`;
  }
  if (points === 20 && sideRow.pos <= 4 && oppRow.pos > 4) {
    why += '; the side sits inside the top four and the opponent does not, which the prompt weights extra';
  }
  return comp('ladder_stakes', 'Ladder position & finals stakes', points, WIN_WEIGHTS.ladder_stakes, `${why} — ${context}`);
}

/**
 * Head-to-head — 15 points. Prompt: won 2 of the last 3 = 15, split evenly =
 * 7, trailing = 0, weighted toward recent meetings (3 : 2 : 1).
 */
export function scoreHeadToHead(h2h) {
  if (!h2h || !h2h.n) {
    return comp('head_to_head', 'Head-to-head (last 3, recency weighted)', 0, WIN_WEIGHTS.head_to_head,
      'no previous meeting between these clubs on the committed tape', { missing: true });
  }
  const share = h2h.weightedShare ?? 0;
  let points = 0;
  let why = `trailing the recent series (${h2h.wins}W ${h2h.draws}D ${h2h.losses}L of the last ${h2h.n})`;
  if (share >= 0.6) { points = 15; why = `won ${h2h.wins} of the last ${h2h.n} meetings (weighted share ${share})`; }
  else if (share >= 0.4) { points = 7; why = `the last ${h2h.n} meetings are split (${h2h.wins}W ${h2h.draws}D ${h2h.losses}L)`; }
  return comp('head_to_head', 'Head-to-head (last 3, recency weighted)', points, WIN_WEIGHTS.head_to_head, why);
}

/**
 * Key absences including Origin — 20 points. Prompt: opponent missing multiple
 * players to Origin duty or carrying a judiciary suspension at a key position
 * = 20; both sides near full strength = 10 baseline; own team missing multiple
 * Origin players or a suspended starter = 0.
 *
 * No free, key-less feed publishes NRL team lists, Origin squads or judiciary
 * outcomes. What *is* verifiable is the Origin calendar: outside the series
 * window no club player can be on Origin duty, so the Origin half of this
 * factor is scored on evidence while the injury/suspension half is left
 * unscored rather than estimated.
 */
export function scoreKeyAbsences(origin, absences = null) {
  if (absences && absences.sourced) {
    const ownOut = Number(absences.ownOut || 0);
    const oppOut = Number(absences.oppOut || 0);
    if (ownOut >= 2 || absences.ownSuspension) {
      return comp('key_absences', 'Key absences (Origin, judiciary, injury)', 0, WIN_WEIGHTS.key_absences,
        'this side is itself missing multiple first-choice players or a suspended starter');
    }
    if (oppOut >= 2 || absences.oppSuspension) {
      return comp('key_absences', 'Key absences (Origin, judiciary, injury)', 20, WIN_WEIGHTS.key_absences,
        'the opponent is missing multiple first-choice players to Origin duty or is carrying a judiciary suspension at a key position');
    }
    return comp('key_absences', 'Key absences (Origin, judiciary, injury)', 10, WIN_WEIGHTS.key_absences,
      'both sides reported near full strength');
  }
  if (origin?.sourced && origin.originDutyPossible === false) {
    return comp('key_absences', 'Key absences (Origin, judiciary, injury)', 10, WIN_WEIGHTS.key_absences,
      `Origin baseline: the ${origin.series || 'State of Origin'} window closed on ${origin.windowEnd} and no club player can be on Origin duty for this fixture. Ordinary injury and judiciary lists have no free key-less feed, so that half of the factor is scored zero rather than guessed.`,
      { partial: true });
  }
  return comp('key_absences', 'Key absences (Origin, judiciary, injury)', 0, WIN_WEIGHTS.key_absences,
    origin?.sourced
      ? 'this fixture falls inside, or days after, a State of Origin window and per-club Origin squads are not published on any free key-less feed — the factor is left unscored'
      : 'no Origin calendar and no absence feed committed — the factor is left unscored',
    { missing: true });
}

/**
 * Odds and value — 15 points. Prompt: -300 or lower = 15, -200 to -299 = 11,
 * -150 to -199 = 7, -100 to -149 = 4, an underdog with a live form or
 * head-to-head case = 8 (flagged as a value candidate).
 *
 * There is no key-less price feed for the NRL, so unless a price is supplied
 * this component scores zero and is named as missing. It is never back-filled
 * from a modelled price.
 */
export function scoreOddsAndValue(american, form, h2h) {
  if (american == null || !Number.isFinite(american)) {
    return comp('odds_value', 'Odds and value', 0, WIN_WEIGHTS.odds_value,
      'no key-less bookmaker price feed exists for the NRL — the value factor is scored zero, not estimated',
      { missing: true });
  }
  let points = 0;
  let why = '';
  if (american <= -300) { points = 15; why = 'price of -300 or shorter'; }
  else if (american <= -200) { points = 11; why = 'price between -200 and -299'; }
  else if (american <= -150) { points = 7; why = 'price between -150 and -199'; }
  else if (american <= -100) { points = 4; why = 'price between -100 and -149'; }
  else {
    const liveForm = (form?.weightedShare ?? 0) >= 0.5;
    const liveH2H = (h2h?.weightedShare ?? 0) >= 0.6;
    if (liveForm || liveH2H) {
      points = 8;
      why = `underdog with a live case (${liveForm ? 'recent form' : ''}${liveForm && liveH2H ? ' and ' : ''}${liveH2H ? 'head-to-head' : ''}) — flagged as a value candidate`;
    } else {
      why = 'underdog without a live form or head-to-head case';
    }
  }
  return comp('odds_value', 'Odds and value', points, WIN_WEIGHTS.odds_value, why);
}

/**
 * Travel and venue — 5 points. Prompt: no unusual travel burden, including no
 * trans-Tasman trip = 5; a side carrying a taxing long-haul trip or playing
 * its first match back from Origin duty = 0.
 */
export function scoreTravelAndVenue(sideKey, travel, origin) {
  const burden = sideKey === 'home' ? travel?.homeTravelBurden : travel?.awayTravelBurden;
  const originReturn = origin?.sourced && origin.originDutyPossible
    && Number.isFinite(origin.daysSinceLastOriginGame) && origin.daysSinceLastOriginGame <= 4;
  if (originReturn) {
    return comp('travel_venue', 'Travel and venue', 0, WIN_WEIGHTS.travel_venue,
      'first fixture back from a State of Origin window');
  }
  if (burden === 'trans-tasman') {
    return comp('travel_venue', 'Travel and venue', 0, WIN_WEIGHTS.travel_venue,
      `trans-Tasman trip (${travel.note || 'New Zealand Warriors fixture'})`);
  }
  if (burden === 'long-haul') {
    return comp('travel_venue', 'Travel and venue', 0, WIN_WEIGHTS.travel_venue,
      `long-haul trip of about ${travel.km} km between the two home venues`);
  }
  return comp('travel_venue', 'Travel and venue', 5, WIN_WEIGHTS.travel_venue,
    travel?.km != null ? `no unusual travel burden (about ${travel.km} km between home venues)` : 'no unusual travel burden');
}

/** Evidence coverage: the share of the model's weight that was actually sourced. */
export function coverageOf(components, weights) {
  let sourced = 0;
  let total = 0;
  for (const c of components) {
    const w = weights[c.id] ?? 0;
    total += w;
    if (c.missing) continue;
    sourced += c.partial ? w * 0.5 : w;
  }
  return total ? round2(sourced / total) : 0;
}

/** Apply the prompt's WIN MATCH decision rule, then the evidence caps. */
export function winBand(score, alignedFactors, coverage) {
  if (coverage < COVERAGE.MIN_PUBLISH) return CONFIDENCE.SKIP;
  let band;
  if (score >= 70) band = CONFIDENCE.HIGH;
  else if (score >= 50 && alignedFactors >= 2) band = CONFIDENCE.MEDIUM;
  else band = CONFIDENCE.SKIP;
  if (band === CONFIDENCE.HIGH && coverage < COVERAGE.HIGH_ABOVE) band = CONFIDENCE.MEDIUM;
  if (band === CONFIDENCE.MEDIUM && coverage < COVERAGE.LOW_BELOW) band = CONFIDENCE.LOW;
  return band;
}

/** Score WIN MATCH for one side. */
export function scoreNrlWinMatchForSide(ctx, sideKey, absences = null) {
  const side = sideKey === 'home' ? ctx.home : ctx.away;
  const oppKey = sideKey === 'home' ? 'away' : 'home';
  const opp = sideKey === 'home' ? ctx.away : ctx.home;
  const form = ctx.form?.[sideKey] || null;
  const oppForm = ctx.form?.[oppKey] || null;
  const h2h = scoreSideH2H(ctx, side);

  const components = [
    scoreRecentForm(form),
    scoreLadderStakes(ctx[`${sideKey}Row`], ctx[`${oppKey}Row`]),
    scoreHeadToHead(h2h),
    scoreKeyAbsences(ctx.origin, absences ? absences[sideKey] : null),
    scoreOddsAndValue(ctx.odds?.[sideKey]?.american ?? null, form, h2h),
    scoreTravelAndVenue(sideKey, ctx.travel, ctx.origin),
  ];

  const raw = components.reduce((a, c) => a + c.points, 0);
  const coverage = coverageOf(components, WIN_WEIGHTS);
  const normalised = coverage > 0 ? Math.round((raw / (coverage * 100)) * 100) : 0;
  const aligned = components.filter((c) => !c.missing && c.max > 0 && c.points >= c.max * 0.6).length;
  const missing = components.filter((c) => c.missing).map((c) => c.label);
  const partial = components.filter((c) => c.partial).map((c) => c.label);

  return {
    side,
    sideKey,
    opponent: opp,
    components,
    raw,
    coverage,
    score: clamp(normalised, 0, 100),
    alignedFactors: aligned,
    missing,
    partial,
    form,
    oppForm,
    h2h,
  };
}

function scoreSideH2H(ctx, side) {
  if (!ctx.h2h) return null;
  if (side === ctx.home) return ctx.h2h;
  // Mirror the record for the away side.
  return {
    n: ctx.h2h.n,
    meetings: ctx.h2h.meetings.map((m) => ({ ...m, aFor: m.aAgainst, aAgainst: m.aFor })),
    wins: ctx.h2h.losses,
    draws: ctx.h2h.draws,
    losses: ctx.h2h.wins,
    weightedShare: ctx.h2h.weightedShare == null ? null : round1(1 - ctx.h2h.weightedShare),
  };
}

/* ------------------------------------------------------------------ *
 * HANDICAP
 * ------------------------------------------------------------------ */

/**
 * HANDICAP — the WIN MATCH base score for the selected side, adjusted by:
 *   margin-of-victory trend: average winning margin of 12+ = +15, under 6 = -10
 *   Origin fatigue: a side missing several first-choice players to Origin, or
 *                   fielding several players fresh off an Origin game = -8
 * Only live when the WIN MATCH score is 60 or higher. Thresholds: 70+ HIGH,
 * 55-69 MEDIUM, below 55 (or WIN MATCH below 60) SKIP.
 */
export function scoreNrlHandicap(ctx, winResult) {
  const base = winResult.score;
  const components = [];
  const margin = winResult.form?.avgWinMargin ?? null;

  if (margin == null || !winResult.form?.wins) {
    components.push(comp('hcap_margin_trend', 'Margin-of-victory trend', 0, 15,
      'no wins in the recent sample, so no average winning margin can be measured', { missing: true }));
  } else if (margin >= 12) {
    components.push(comp('hcap_margin_trend', 'Margin-of-victory trend', 15, 15,
      `average winning margin of ${margin} points across its recent wins (12 or more)`));
  } else if (margin < 6) {
    components.push(comp('hcap_margin_trend', 'Margin-of-victory trend', -10, 15,
      `average winning margin of ${margin} points — its wins are narrow, so covering is harder`));
  } else {
    components.push(comp('hcap_margin_trend', 'Margin-of-victory trend', 0, 15,
      `average winning margin of ${margin} points — inside the neutral band`));
  }

  const originAdj = comp('hcap_origin_fatigue', 'Origin fatigue modifier', 0, 8,
    ctx.origin?.sourced && ctx.origin.originDutyPossible
      ? 'fixture sits inside the Origin window; per-club Origin representation is not published on any free key-less feed, so no adjustment is applied rather than a guess being made'
      : `no Origin duty in play (series window ${ctx.origin?.windowStart || 'n/a'} to ${ctx.origin?.windowEnd || 'n/a'}), so no fatigue deduction`,
    { missing: !!(ctx.origin?.sourced && ctx.origin.originDutyPossible) });

  components.push(originAdj);
  components.push(comp('hcap_base', 'WIN MATCH base score', base, 100,
    `the handicap starts from the WIN MATCH score of ${base} for ${winResult.side}`));

  const marginAdj = components.find((c) => c.id === 'hcap_margin_trend').points;
  const raw = clamp(base + marginAdj + originAdj.points, 0, 100);
  const coverage = winResult.coverage;
  let band = CONFIDENCE.SKIP;
  let skipReason = null;
  if (winResult.score < 60) {
    skipReason = `the WIN MATCH score of ${winResult.score} is below the 60 the prompt requires before a handicap can be considered`;
  } else if (raw < 55) {
    skipReason = `the handicap score of ${raw} is below the 55 threshold`;
  } else if (coverage < COVERAGE.MIN_PUBLISH) {
    skipReason = `only ${Math.round(coverage * 100)}% of the model's evidence was available for this fixture`;
  } else {
    band = raw >= 70 ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM;
    if (band === CONFIDENCE.HIGH && coverage < COVERAGE.HIGH_ABOVE) band = CONFIDENCE.MEDIUM;
    if (band === CONFIDENCE.MEDIUM && coverage < COVERAGE.LOW_BELOW) band = CONFIDENCE.LOW;
  }

  return {
    market: 'handicap',
    selection: `${winResult.side} to cover`,
    side: winResult.side,
    score: raw,
    capScore: raw,
    base,
    coverage,
    components,
    band: skipReason ? CONFIDENCE.SKIP : band,
    skip: !!skipReason,
    skipReason,
    line: ctx.lines?.handicapLine ?? null,
    lineSource: ctx.lines?.handicapLineSource ?? null,
    missing: components.filter((c) => c.missing).map((c) => c.label),
  };
}

/* ------------------------------------------------------------------ *
 * GAME TOTAL
 * ------------------------------------------------------------------ */

export function scoreNrlGameTotal(ctx, opts = {}) {
  // opts.excludeWeather drops the weather factor entirely (rather than scoring
  // it zero) and removes its weight from the coverage denominator. The
  // walk-forward backtest uses this because no free historical forecast is
  // committed; the live card does not.
  const excludeWeather = !!opts.excludeWeather;
  const h = ctx.totals?.home;
  const a = ctx.totals?.away;
  const components = [];
  let over = 0;
  let under = 0;

  // Combined offensive output — 30 points.
  if (!h || !a) {
    components.push(comp('combined_offence', 'Combined offensive output', 0, TOTAL_WEIGHTS.combined_offence,
      'scoring profiles unavailable for one or both clubs', { missing: true }));
  } else {
    const bothHigh = h.ppgFor >= 24 && a.ppgFor >= 24;
    const oneLow = h.ppgFor < 16 || a.ppgFor < 16;
    if (bothHigh) {
      over += 30;
      components.push(comp('combined_offence', 'Combined offensive output', 30, TOTAL_WEIGHTS.combined_offence,
        `both clubs average 24 points or more over their last ${h.n}/${a.n} matches (${h.ppgFor} and ${a.ppgFor})`, { side: 'over' }));
    } else if (oneLow) {
      under += 25;
      components.push(comp('combined_offence', 'Combined offensive output', 25, TOTAL_WEIGHTS.combined_offence,
        `one or both clubs average under 16 points a game (${h.ppgFor} and ${a.ppgFor}) — 25 points to the Under`, { side: 'under' }));
    } else {
      components.push(comp('combined_offence', 'Combined offensive output', 0, TOTAL_WEIGHTS.combined_offence,
        `mixed scoring profiles (${h.ppgFor} and ${a.ppgFor}) — neither the Over nor the Under trigger is met`));
    }
  }

  // Combined defensive output — 25 points.
  if (!h || !a) {
    components.push(comp('combined_defence', 'Combined defensive output', 0, TOTAL_WEIGHTS.combined_defence,
      'conceding profiles unavailable', { missing: true }));
  } else if (h.ppgAgainst >= 24 && a.ppgAgainst >= 24) {
    over += 25;
    components.push(comp('combined_defence', 'Combined defensive output', 25, TOTAL_WEIGHTS.combined_defence,
      `both clubs concede 24 points or more a game (${h.ppgAgainst} and ${a.ppgAgainst})`, { side: 'over' }));
  } else if (h.ppgAgainst < 16 && a.ppgAgainst < 16) {
    under += 20;
    components.push(comp('combined_defence', 'Combined defensive output', 20, TOTAL_WEIGHTS.combined_defence,
      `both clubs concede fewer than 16 points a game (${h.ppgAgainst} and ${a.ppgAgainst}) — 20 points to the Under`, { side: 'under' }));
  } else {
    components.push(comp('combined_defence', 'Combined defensive output', 0, TOTAL_WEIGHTS.combined_defence,
      `mixed defensive profiles (${h.ppgAgainst} and ${a.ppgAgainst}) — no trigger met`));
  }

  // Recent total trends — 20 points, measured against the reference total.
  const ref = ctx.referenceTotal;
  if (!h || !a || ref == null || h.overs == null || a.overs == null) {
    components.push(comp('recent_totals', 'Recent total trends', 0, TOTAL_WEIGHTS.recent_totals,
      ref == null ? 'no total line is published for this fixture, so an Over/Under record cannot be measured against the market'
        : 'recent totals unavailable for one or both clubs', { missing: true }));
  } else {
    const bothOver = h.overs >= 4 && a.overs >= 4;
    const bothUnder = h.unders >= 3 && a.unders >= 3;
    if (bothOver) {
      over += 20;
      components.push(comp('recent_totals', 'Recent total trends', 20, TOTAL_WEIGHTS.recent_totals,
        `both clubs have gone Over in four of their last five against the reference total (${h.overs} and ${a.overs})`, { side: 'over' }));
    } else if (bothUnder) {
      under += 18;
      components.push(comp('recent_totals', 'Recent total trends', 18, TOTAL_WEIGHTS.recent_totals,
        `both clubs have gone Under in three or more of their last five (${h.unders} and ${a.unders}) — 18 points to the Under`, { side: 'under' }));
    } else {
      components.push(comp('recent_totals', 'Recent total trends', 0, TOTAL_WEIGHTS.recent_totals,
        `mixed recent totals (Over counts of ${h.overs} and ${a.overs} from five) — no trigger met`));
    }
  }

  // Golden point and game-state tendency — 15 points.
  const ch = ctx.close?.home;
  const ca = ctx.close?.away;
  if (!ch || !ca) {
    components.push(comp('golden_point_state', 'Golden point / game-state tendency', 0, TOTAL_WEIGHTS.golden_point_state,
      'recent finishing margins unavailable', { missing: true }));
  } else {
    const tight = ch.tightAndLow + ca.tightAndLow;
    const low = ch.lowScoringCount + ca.lowScoringCount;
    if (tight + low >= 3) {
      under += 15;
      components.push(comp('golden_point_state', 'Golden point / game-state tendency', 15, TOTAL_WEIGHTS.golden_point_state,
        `${tight} tight (one- or two-point) finishes and ${low} low-scoring games in the two clubs' last six each — 15 points to the Under. A one- or two-point margin in rugby league is usually golden point, though the tape does not label the period, so this is recorded as a close finish rather than asserted as golden point.`, { side: 'under' }));
    } else {
      components.push(comp('golden_point_state', 'Golden point / game-state tendency', 0, TOTAL_WEIGHTS.golden_point_state,
        `${tight} tight finishes and ${low} low-scoring games across both recent samples — no lean on the game-state side. The prompt's second half of this factor (a side missing several forwards to Origin or suspension, which loosens defensive structure) cannot be checked: no free key-less feed publishes NRL forward-pack absences.`,
        { partial: true }));
    }
  }

  // Weather — 10 points.
  if (excludeWeather) {
    // no component, no weight: see the note above
  } else if (!ctx.weather) {
    components.push(comp('total_weather', 'Weather', 0, TOTAL_WEIGHTS.weather,
      ctx.venue ? 'no forecast committed for this venue' : 'no venue is recorded for this fixture, so no forecast can be requested',
      { missing: true }));
  } else {
    const w = ctx.weather;
    if (w.heavyRain) {
      under += 10;
      components.push(comp('total_weather', 'Weather', 10, TOTAL_WEIGHTS.weather,
        `heavy rain confirmed in the forecast (${w.precip_mm} mm, ${w.precip_prob_max}% chance) — 10 points to the Under`, { side: 'under' }));
    } else if (w.dry) {
      over += 10;
      components.push(comp('total_weather', 'Weather', 10, TOTAL_WEIGHTS.weather,
        `dry, clear conditions confirmed (${w.precip_mm} mm, ${w.precip_prob_max}% chance${w.wind_max_kmh != null ? `, wind up to ${w.wind_max_kmh} km/h` : ''})`, { side: 'over' }));
    } else {
      components.push(comp('total_weather', 'Weather', 0, TOTAL_WEIGHTS.weather,
        `intermediate conditions (${w.precip_mm} mm, ${w.precip_prob_max}% chance) — neither the dry nor the heavy-rain trigger is met${w.strongWind ? `; note the wind is forecast up to ${w.wind_max_kmh} km/h, which the prompt does not score` : ''}`));
    }
  }

  const weights = excludeWeather ? { ...TOTAL_WEIGHTS, weather: 0 } : TOTAL_WEIGHTS;
  const coverage = coverageOf(components, weights);
  const advantage = Math.abs(over - under);
  const direction = over === under ? null : (over > under ? 'Over' : 'Under');
  let band = CONFIDENCE.SKIP;
  let skipReason = null;
  if (coverage < COVERAGE.MIN_PUBLISH) {
    skipReason = `only ${Math.round(coverage * 100)}% of the totals evidence was available for this fixture`;
  } else if (advantage < 15 || !direction) {
    skipReason = `the directional advantage is ${advantage} points, under the 15 the prompt requires`;
  } else {
    band = advantage >= 20 ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM;
    if (band === CONFIDENCE.HIGH && coverage < COVERAGE.HIGH_ABOVE) band = CONFIDENCE.MEDIUM;
    if (band === CONFIDENCE.MEDIUM && coverage < COVERAGE.LOW_BELOW) band = CONFIDENCE.LOW;
  }

  return {
    market: 'game_total',
    direction,
    selection: direction || 'no selection',
    over,
    under,
    advantage,
    // Ordering key for the per-match cap only. WIN MATCH and HANDICAP are
    // scored out of 100 with publication thresholds near the middle of the
    // range, so the totals market is placed on the same scale as
    // 50 + directional advantage (threshold 15-19 -> 65-69, 20+ -> 70+).
    capScore: 50 + advantage,
    coverage,
    components,
    band: skipReason ? CONFIDENCE.SKIP : band,
    skip: !!skipReason,
    skipReason,
    referenceTotal: ref ?? null,
    referenceSource: ctx.lines?.totalLineSource || (ref != null && ref === ctx.seasonMeanTotal ? 'season mean (no market line published)' : null),
    missing: components.filter((c) => c.missing).map((c) => c.label),
  };
}

/* ------------------------------------------------------------------ *
 * MATCH + CARD
 * ------------------------------------------------------------------ */

/** Decide which side the card is backing in WIN MATCH. */
export function pickWinSide(homeResult, awayResult) {
  if (homeResult.raw !== awayResult.raw) return homeResult.raw > awayResult.raw ? homeResult : awayResult;
  const hp = homeResult.components.find((c) => c.id === 'ladder_stakes')?.points ?? 0;
  const ap = awayResult.components.find((c) => c.id === 'ladder_stakes')?.points ?? 0;
  if (hp !== ap) return hp > ap ? homeResult : awayResult;
  return homeResult;
}

/**
 * A value candidate, on this match's own merits: the card is backing the side
 * that is *behind* on the ladder (or behind on head-to-head) while still
 * clearing the publication threshold. Without a price feed nothing stronger
 * than this can be claimed.
 */
export function valueFlag(ctx, winResult) {
  const sideRow = ctx[`${winResult.sideKey}Row`];
  const oppRow = ctx[`${winResult.sideKey === 'home' ? 'away' : 'home'}Row`];
  if (!sideRow || !oppRow) return null;
  if (sideRow.pos <= oppRow.pos) return null;
  const reasons = [];
  if ((winResult.form?.weightedShare ?? 0) >= 0.5) reasons.push('recent form');
  if ((winResult.h2h?.weightedShare ?? 0) >= 0.6) reasons.push('a recent head-to-head edge');
  if (!reasons.length) return null;
  return `Value candidate on this match's own merits: ${winResult.side} sits ${sideRow.pos} on the ladder, behind ${winResult.opponent} in ${oppRow.pos}, but carries ${reasons.join(' and ')}. No price feed means this is a form-and-ladder observation, not a price comparison.`;
}

export function scoreNrlMatch(ctx, opts = {}) {
  const homeResult = scoreNrlWinMatchForSide(ctx, 'home');
  const awayResult = scoreNrlWinMatchForSide(ctx, 'away');
  const win = pickWinSide(homeResult, awayResult);
  const winBandName = winBand(win.score, win.alignedFactors, win.coverage);

  const winMarket = {
    market: 'win_match',
    selection: win.side,
    side: win.side,
    sideKey: win.sideKey,
    opponent: win.opponent,
    score: win.score,
    capScore: win.score,
    raw: win.raw,
    coverage: win.coverage,
    alignedFactors: win.alignedFactors,
    components: win.components,
    band: winBandName,
    skip: winBandName === CONFIDENCE.SKIP,
    skipReason: winBandName === CONFIDENCE.SKIP
      ? (win.coverage < COVERAGE.MIN_PUBLISH
        ? `only ${Math.round(win.coverage * 100)}% of the model's evidence was available for this fixture`
        : `the score of ${win.score} is below 50, or between 50 and 69 with fewer than two factors aligned (${win.alignedFactors} aligned)`)
      : null,
    homeResult,
    awayResult,
    missing: win.missing,
    partial: win.partial,
  };

  const handicap = scoreNrlHandicap(ctx, win);
  const total = scoreNrlGameTotal(ctx, opts);

  const markets = { win_match: winMarket, handicap, game_total: total };

  // Per-match cap. The prompt asks for active recommendations to be capped
  // sensibly rather than forcing all three markets to a live pick. Two rules,
  // both disclosed on the card and in docs/NRL_PROMPT_REVIEW.md:
  //   1. the handicap is only worth a separate stake when the prompt's own
  //      margin-of-victory test actually adds points - a side that wins
  //      narrowly has no business carrying a second, correlated selection;
  //   2. at most two live markets per fixture, and where the win pick and the
  //      handicap on the same side are both live the total is preferred,
  //      because the handicap stands or falls with the win pick.
  const marginAdj = handicap.components.find((c) => c.id === 'hcap_margin_trend')?.points ?? 0;
  if (!handicap.skip && marginAdj <= 0) {
    handicap.skip = true;
    handicap.band = CONFIDENCE.SKIP;
    handicap.skipReason = 'its recent winning margins do not support a separate cover: the prompt\u2019s margin-of-victory test adds nothing here, so the card will not double up on the same side';
    handicap.cappedByCard = true;
  }

  const preference = ['win_match', 'game_total', 'handicap'];
  const live = preference.filter((k) => !markets[k].skip);
  for (const k of live.slice(MAX_ACTIVE_MARKETS_PER_MATCH)) {
    markets[k].skip = true;
    markets[k].band = CONFIDENCE.SKIP;
    markets[k].skipReason = 'withheld by the per-match cap: two markets are already published for this fixture';
    markets[k].cappedByCard = true;
  }

  return {
    match: ctx.match,
    ctx,
    favourite: win.side,
    markets,
    valueFlag: markets.win_match.skip ? null : valueFlag(ctx, win),
    flags: buildFlags(ctx, win),
    missing: [...new Set([...(win.missing || []), ...(handicap.missing || []), ...(total.missing || [])])],
  };
}

function buildFlags(ctx, win) {
  const flags = [];
  if (ctx.travel?.transTasman) {
    flags.push('New Zealand Warriors fixture: one side crosses the Tasman this round.');
  }
  if (ctx.origin?.sourced && ctx.origin.originDutyPossible) {
    flags.push('Fixture sits inside or days after a State of Origin window: club strength is genuinely hard to assess this week.');
  }
  if (ctx.rest?.home?.offBye || ctx.rest?.away?.offBye) {
    const who = [ctx.rest.home.offBye ? ctx.home : null, ctx.rest.away.offBye ? ctx.away : null].filter(Boolean);
    if (who.length) flags.push(`${who.join(' and ')} come off a bye.`);
  }
  if (ctx.rest?.home?.byeThisRound || ctx.rest?.away?.byeThisRound) {
    const who = [ctx.rest.home.byeThisRound ? ctx.home : null, ctx.rest.away.byeThisRound ? ctx.away : null].filter(Boolean);
    if (who.length) flags.push(`${who.join(' and ')} have the bye this round.`);
  }
  if (ctx.lines && !ctx.lines.marketsVerified) {
    flags.push('OLBG market lines for this fixture were read from the index best tip and have not been confirmed on the event page.');
  }
  if (!ctx.lines?.totalLine) flags.push('No total line is published for this fixture; totals are measured against the season mean instead.');
  if (ctx.weather?.strongWind) flags.push(`Forecast wind up to ${ctx.weather.wind_max_kmh} km/h at this venue — noted but not scored (the prompt scores rain only).`);
  return flags;
}

export function scoreNrlCard(enrichedMatches) {
  const results = enrichedMatches.map((m) => scoreNrlMatch(m));
  let published = 0;
  for (const r of results) for (const k of MARKETS) if (!r.markets[k].skip) published += 1;
  return {
    sport: 'NRL',
    promptVersion: PROMPT_VERSION,
    rulesetVersion: RULESET_VERSION,
    matches: enrichedMatches.length,
    published,
    results,
  };
}
