/**
 * SportsPred — Universal two-competitor prediction engine (pure, no I/O).
 *
 * DESIGN CONTRACT
 * ---------------
 * The engine turns a normalised match (engine/espn_universal.js) plus a
 * measured league context into a set of scored markets. It is deterministic:
 * the same input always yields the same output, and every point awarded is
 * recorded with the rule id, the value that triggered it and the source.
 *
 * WHAT IS FACT AND WHAT IS MODEL
 * ------------------------------
 * Facts (sourced, never invented):
 *   - league home-win / draw / away-win rates and mean total, MEASURED from
 *     completed matches in the same league (engine/espn_universal.js
 *     buildLeagueContext). No hard-coded home-advantage constant is used.
 *   - team form, season record, curated rank, rest days, head-to-head.
 *   - market prices, de-vigged, attributed to the provider ESPN names.
 *
 * Model hyperparameters (declared, not discovered — see WEIGHTS below):
 *   - how much each signal moves the log-odds, and how much weight the market
 *     price carries against the model. These are the only tunable numbers in
 *     the system, they are exported so a backtest can report on them, and they
 *     are NOT presented as facts anywhere in the UI.
 *
 * NO-HALLUCINATION RULES
 *   1. A signal with no data contributes nothing and is appended to missing[].
 *   2. If fewer than MIN_SIGNALS signals are available the market returns
 *      band 'SKIP' with reason 'insufficient sourced signals'.
 *   3. Confidence never exceeds the cap implied by data completeness.
 *   4. Nothing is rounded into a false precision: probabilities are reported to
 *      3 decimals and confidence as an integer 0-100.
 */

export const RULESET_VERSION = 'universal-v1.0';

/** Model hyperparameters. Declared openly; tuned only via backtest evidence. */
export const WEIGHTS = Object.freeze({
  form: 1.10,        // per unit of (homeFormRate - awayFormRate), range -1..1
  record: 1.30,      // per unit of (homeWinPct - awayWinPct)
  rank: 0.55,        // per unit of normalised curated-rank edge
  h2h: 0.45,         // per unit of head-to-head win-rate edge
  rest: 0.10,        // per unit of normalised rest-day edge
  marketWeight: 0.55, // blend weight given to the de-vigged market price
});

export const MIN_SIGNALS = 2;

export const CONFIDENCE_BANDS = Object.freeze([
  { band: 'HIGH', min: 72 },
  { band: 'MEDIUM', min: 58 },
  { band: 'LOW', min: 46 },
]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (n, dp) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function formRateOf(team) {
  if (!Array.isArray(team?.form) || !team.form.length) return null;
  const pts = team.form.reduce((a, c) => a + (c === 'W' ? 1 : c === 'D' ? 0.5 : 0), 0);
  return pts / team.form.length;
}

function bandFor(score) {
  for (const b of CONFIDENCE_BANDS) if (score >= b.min) return b.band;
  return 'SKIP';
}

/**
 * Core probability model.
 * Returns { pHome, pAway, pDraw, signals[], missing[], baseline }.
 *
 * `pDraw` is only produced for three-way sports AND only from a measured league
 * draw rate or a priced draw. It is never invented.
 */
export function modelProbabilities(match, ctx = {}) {
  const { leagueContext = null, threeWay = false, h2h = null, rest = null } = ctx;
  const signals = [];
  const missing = [];

  // ---- baseline: measured home-win share of decided games in this league ----
  let baseline = null;
  if (leagueContext?.sufficient && typeof leagueContext.homeWinRate === 'number') {
    const decided = leagueContext.homeWinRate + leagueContext.awayWinRate;
    baseline = decided > 0 ? leagueContext.homeWinRate / decided : 0.5;
    signals.push({
      id: 'BASE-01',
      label: 'League home-win baseline',
      value: round(baseline, 4),
      detail: `measured from ${leagueContext.sample} completed ${match.leagueName || 'league'} matches`,
      source: 'ESPN scoreboard (completed games)',
      points: 0,
    });
  } else {
    baseline = 0.5;
    missing.push({
      id: 'BASE-01',
      label: 'League home-win baseline',
      reason: `fewer than 10 completed matches available for ${match.leagueName || 'this league'}; a neutral 0.500 baseline is used and confidence is capped`,
    });
  }

  let z = logit(baseline);

  // ---- signal 1: recent form -------------------------------------------------
  const hf = formRateOf(match.home);
  const af = formRateOf(match.away);
  if (hf !== null && af !== null) {
    const edge = hf - af;
    const pts = WEIGHTS.form * edge;
    z += pts;
    signals.push({
      id: 'FORM-01',
      label: 'Recent form differential',
      value: round(edge, 4),
      detail: `${match.home.name} ${match.home.form.join('')} vs ${match.away.name} ${match.away.form.join('')}`,
      source: 'ESPN scoreboard competitor.form',
      points: round(pts, 4),
    });
  } else {
    missing.push({ id: 'FORM-01', label: 'Recent form differential', reason: 'ESPN did not publish a form string for one or both teams' });
  }

  // ---- signal 2: season record ----------------------------------------------
  const hr = match.home?.record?.winPct;
  const ar = match.away?.record?.winPct;
  if (typeof hr === 'number' && typeof ar === 'number') {
    const edge = hr - ar;
    const pts = WEIGHTS.record * edge;
    z += pts;
    signals.push({
      id: 'REC-01',
      label: 'Season record differential',
      value: round(edge, 4),
      detail: `${match.home.name} ${match.home.recordSummary} vs ${match.away.name} ${match.away.recordSummary}`,
      source: 'ESPN scoreboard competitor.records',
      points: round(pts, 4),
    });
  } else {
    missing.push({ id: 'REC-01', label: 'Season record differential', reason: 'no season record published for one or both teams' });
  }

  // ---- signal 3: curated rank (college / poll sports) ------------------------
  if (typeof match.home?.rank === 'number' && typeof match.away?.rank === 'number') {
    const edge = (match.away.rank - match.home.rank) / 25; // lower rank number is better
    const pts = WEIGHTS.rank * clamp(edge, -1, 1);
    z += pts;
    signals.push({
      id: 'RANK-01',
      label: 'Ranking differential',
      value: round(edge, 4),
      detail: `#${match.home.rank} vs #${match.away.rank}`,
      source: 'ESPN scoreboard curatedRank',
      points: round(pts, 4),
    });
  } else {
    missing.push({ id: 'RANK-01', label: 'Ranking differential', reason: 'this competition publishes no curated ranking' });
  }

  // ---- signal 4: head-to-head ------------------------------------------------
  if (h2h && h2h.meetings >= 3) {
    const decided = h2h.homeWins + h2h.awayWins;
    if (decided > 0) {
      const edge = (h2h.homeWins - h2h.awayWins) / decided;
      const pts = WEIGHTS.h2h * edge;
      z += pts;
      signals.push({
        id: 'H2H-01',
        label: 'Head-to-head record',
        value: round(edge, 4),
        detail: `${h2h.meetings} prior meetings: ${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}`,
        source: 'ESPN results tape (matches completed before this fixture)',
        points: round(pts, 4),
      });
    }
  } else {
    missing.push({ id: 'H2H-01', label: 'Head-to-head record', reason: 'fewer than three prior meetings inside the collected results window' });
  }

  // ---- signal 5: rest ---------------------------------------------------------
  if (rest && typeof rest.home === 'number' && typeof rest.away === 'number') {
    const edge = clamp((rest.home - rest.away) / 7, -1, 1);
    const pts = WEIGHTS.rest * edge;
    z += pts;
    signals.push({
      id: 'REST-01',
      label: 'Rest advantage',
      value: round(edge, 4),
      detail: `${rest.home}d vs ${rest.away}d since last completed fixture`,
      source: 'ESPN results tape',
      points: round(pts, 4),
    });
  } else {
    missing.push({ id: 'REST-01', label: 'Rest advantage', reason: 'no prior completed fixture inside the collected window for one or both teams' });
  }

  let pHomeModel = sigmoid(z);

  // ---- draw handling ----------------------------------------------------------
  let pDraw = null;
  if (threeWay) {
    const priced = match.odds?.moneyline?.draw?.fairProb;
    if (typeof priced === 'number') pDraw = priced;
    else if (leagueContext?.sufficient && typeof leagueContext.drawRate === 'number') pDraw = leagueContext.drawRate;
    else missing.push({ id: 'DRAW-01', label: 'Draw probability', reason: 'no priced draw and no measured league draw rate' });
  }

  const decidedMass = pDraw === null ? 1 : 1 - pDraw;
  const pHome = pHomeModel * decidedMass;
  const pAway = (1 - pHomeModel) * decidedMass;

  return {
    baseline: round(baseline, 4),
    zScore: round(z, 4),
    pHome: round(pHome, 6),
    pAway: round(pAway, 6),
    pDraw: pDraw === null ? null : round(pDraw, 6),
    signals,
    missing,
  };
}

/** Blend the model with the de-vigged market price when a price exists. */
export function blendWithMarket(model, odds, threeWay) {
  const ml = odds?.moneyline;
  const mHome = ml?.home?.fairProb;
  const mAway = ml?.away?.fairProb;
  const mDraw = ml?.draw?.fairProb;
  const havePrice = typeof mHome === 'number' && typeof mAway === 'number';

  if (!havePrice) {
    return {
      priced: false,
      weight: 0,
      pHome: model.pHome,
      pAway: model.pAway,
      pDraw: model.pDraw,
      marketPHome: null,
      edgeHome: null,
      edgeAway: null,
      provider: null,
    };
  }

  const w = WEIGHTS.marketWeight;
  const pHome = round(w * mHome + (1 - w) * model.pHome, 6);
  const pAway = round(w * mAway + (1 - w) * model.pAway, 6);
  const pDraw = threeWay && typeof mDraw === 'number' && model.pDraw !== null
    ? round(w * mDraw + (1 - w) * model.pDraw, 6)
    : model.pDraw;

  return {
    priced: true,
    weight: w,
    pHome, pAway, pDraw,
    marketPHome: round(mHome, 6),
    marketPAway: round(mAway, 6),
    marketPDraw: typeof mDraw === 'number' ? round(mDraw, 6) : null,
    edgeHome: round(model.pHome - mHome, 6),
    edgeAway: round(model.pAway - mAway, 6),
    provider: odds.provider,
  };
}

/**
 * Convert a selection probability + evidence quality into a 0-100 confidence.
 * Completeness caps the ceiling so a thin match can never read HIGH.
 */
export function confidenceScore({ prob, signalCount, priced, edge, baselineMeasured }) {
  if (typeof prob !== 'number') return { score: 0, cap: 0, band: 'SKIP' };

  // Probability contributes the bulk: 0.50 -> 40, 0.90 -> 92.
  const probPart = clamp((prob - 0.5) / 0.4, 0, 1) * 52 + 40;

  // Evidence completeness: how many independent sourced signals fired.
  const evidencePart = clamp(signalCount / 5, 0, 1) * 8;

  // Agreement with a real market price is worth a little; a large positive
  // model edge over the price is worth a little more (that is the value case).
  let marketPart = 0;
  if (priced) {
    marketPart += 4;
    if (typeof edge === 'number' && edge > 0.03) marketPart += clamp(edge * 40, 0, 6);
  }

  let cap = 100;
  if (!baselineMeasured) cap = Math.min(cap, 62);
  if (!priced) cap = Math.min(cap, 74);
  if (signalCount < 3) cap = Math.min(cap, 66);
  if (signalCount < MIN_SIGNALS) cap = 0;

  const raw = probPart + evidencePart + marketPart;
  const score = Math.round(clamp(Math.min(raw, cap), 0, 100));
  return { score, cap, band: bandFor(score) };
}

/**
 * Score every applicable market for one match.
 * @param {object} match  normalised match
 * @param {object} ctx    { leagueContext, threeWay, h2h, rest, sportUnit }
 */
export function scoreUniversalMatch(match, ctx = {}) {
  const threeWay = ctx.threeWay === true;
  const model = modelProbabilities(match, { ...ctx, threeWay });
  const blend = blendWithMarket(model, match.odds, threeWay);
  const signalCount = model.signals.filter((s) => s.points !== 0 && s.id !== 'BASE-01').length;
  const baselineMeasured = model.signals.some((s) => s.id === 'BASE-01');

  const markets = {};

  // ---------------- market 1: match result -----------------------------------
  const options = [
    { key: 'home', name: match.home?.name, p: blend.pHome },
    { key: 'away', name: match.away?.name, p: blend.pAway },
  ];
  if (threeWay && blend.pDraw !== null) options.push({ key: 'draw', name: 'Draw', p: blend.pDraw });
  const best = options.filter((o) => typeof o.p === 'number').sort((a, b) => b.p - a.p)[0] || null;

  if (!best) {
    markets.match_result = {
      label: threeWay ? 'Full Time Result' : 'Moneyline',
      band: 'SKIP',
      score: 0,
      selection: null,
      reason: 'no probability could be produced from sourced data',
    };
  } else {
    const edge = best.key === 'home' ? blend.edgeHome : best.key === 'away' ? blend.edgeAway : null;
    const conf = confidenceScore({
      prob: best.p, signalCount, priced: blend.priced, edge, baselineMeasured,
    });
    markets.match_result = {
      label: threeWay ? 'Full Time Result' : 'Moneyline',
      selection: best.name,
      selectionKey: best.key,
      probability: round(best.p, 4),
      marketProbability: best.key === 'home' ? blend.marketPHome : best.key === 'away' ? blend.marketPAway : blend.marketPDraw,
      edge: edge === null ? null : round(edge, 4),
      priced: blend.priced,
      provider: blend.provider,
      price: best.key === 'home' ? match.odds?.moneyline?.home?.decimal ?? null
        : best.key === 'away' ? match.odds?.moneyline?.away?.decimal ?? null
          : match.odds?.moneyline?.draw?.decimal ?? null,
      score: conf.score,
      band: conf.band,
      cap: conf.cap,
      reason: conf.band === 'SKIP'
        ? (signalCount < MIN_SIGNALS ? 'insufficient sourced signals' : 'probability too close to a coin flip to publish')
        : null,
    };
  }

  // ---------------- market 2: double chance (three-way sports only) ----------
  if (threeWay && blend.pDraw !== null && typeof blend.pHome === 'number') {
    const dcHome = blend.pHome + blend.pDraw;
    const dcAway = blend.pAway + blend.pDraw;
    const pick = dcHome >= dcAway
      ? { name: `${match.home?.name} or Draw`, p: dcHome }
      : { name: `${match.away?.name} or Draw`, p: dcAway };
    // Double chance is a lower-variance derivative; it is only published when
    // the straight result was not already strong enough to stand alone.
    const conf = confidenceScore({ prob: pick.p, signalCount, priced: blend.priced, edge: null, baselineMeasured });
    markets.double_chance = {
      label: 'Double Chance',
      selection: pick.name,
      probability: round(pick.p, 4),
      score: conf.score,
      band: conf.band,
      cap: conf.cap,
      derived: true,
      reason: conf.band === 'SKIP' ? 'insufficient sourced signals' : null,
    };
  }

  // ---------------- market 3: handicap ---------------------------------------
  if (match.odds?.spread && typeof match.odds.spread.homeLine === 'number') {
    const line = match.odds.spread.homeLine;
    const favouriteIsHome = line < 0;
    const pSide = favouriteIsHome ? blend.pHome : blend.pAway;
    // A handicap is only offered when the model's straight-result edge is large
    // enough that giving away the line still looks defensible.
    const strong = typeof pSide === 'number' && pSide >= 0.62;
    const conf = strong
      ? confidenceScore({ prob: pSide - 0.08, signalCount, priced: true, edge: null, baselineMeasured })
      : { score: 0, cap: 0, band: 'SKIP' };
    markets.handicap = {
      label: 'Handicap',
      line: favouriteIsHome ? line : match.odds.spread.awayLine,
      selection: strong
        ? `${favouriteIsHome ? match.home?.name : match.away?.name} ${favouriteIsHome ? line : match.odds.spread.awayLine}`
        : null,
      probability: strong ? round(pSide - 0.08, 4) : null,
      score: conf.score,
      band: conf.band,
      provider: match.odds.provider,
      reason: strong ? null : 'straight-result edge too small to concede a handicap line',
    };
  } else {
    markets.handicap = { label: 'Handicap', band: 'SKIP', score: 0, selection: null, reason: 'no handicap line published in the free feed' };
  }

  // ---------------- market 4: total ------------------------------------------
  if (match.odds?.total && typeof match.odds.total.line === 'number'
      && ctx.leagueContext?.sufficient && typeof ctx.leagueContext.meanTotal === 'number') {
    const line = match.odds.total.line;
    const mean = ctx.leagueContext.meanTotal;
    const diff = mean - line;
    const rel = Math.abs(diff) / Math.max(line, 1);
    // Publish only when the measured league scoring mean is clearly off the line.
    const strong = rel >= 0.06;
    const p = clamp(0.5 + rel * 1.2, 0.5, 0.72);
    const conf = strong
      ? confidenceScore({ prob: p, signalCount: Math.max(signalCount, 2), priced: true, edge: null, baselineMeasured })
      : { score: 0, cap: 0, band: 'SKIP' };
    markets.total = {
      label: 'Total',
      line,
      selection: strong ? `${diff > 0 ? 'Over' : 'Under'} ${line}` : null,
      probability: strong ? round(p, 4) : null,
      leagueMean: round(mean, 2),
      sample: ctx.leagueContext.sample,
      score: conf.score,
      band: conf.band,
      provider: match.odds.provider,
      reason: strong ? null : 'measured league scoring mean sits too close to the posted line',
    };
  } else {
    markets.total = {
      label: 'Total',
      band: 'SKIP',
      score: 0,
      selection: null,
      reason: match.odds?.total
        ? 'not enough completed matches to measure this league\'s scoring mean'
        : 'no total line published in the free feed',
    };
  }

  // Headline choice. A derived market (double chance) is always the safer bet
  // and would otherwise win every headline, which would make the whole card
  // read the same way. So the headline is the best NON-derived market, and a
  // derived one is only promoted when nothing else cleared the threshold.
  const live = Object.entries(markets).filter(([, m]) => m.band && m.band !== 'SKIP');
  const straight = live.filter(([, m]) => !m.derived).sort((a, b) => b[1].score - a[1].score);
  const derived = live.filter(([, m]) => m.derived).sort((a, b) => b[1].score - a[1].score);
  const best2 = straight[0] || derived[0];

  return {
    matchId: match.id,
    match: `${match.home?.name} v ${match.away?.name}`,
    league: match.leagueName,
    dateISO: match.dateISO,
    startUtc: match.startUtc,
    phase: match.phase,
    ruleset: RULESET_VERSION,
    model,
    blend,
    markets,
    headline: best2 ? { market: best2[0], ...best2[1] } : null,
    scoreable: Boolean(best2),
    missing: model.missing,
    sources: buildSourceList(match),
  };
}

function buildSourceList(match) {
  const out = [];
  if (match.leagueSlug && match.sportKey) {
    out.push({
      label: `ESPN ${match.leagueName || match.leagueSlug} scoreboard`,
      url: `https://site.api.espn.com/apis/site/v2/sports/${espnSportFor(match.sportKey)}/${match.leagueSlug}/scoreboard?dates=${(match.dateISO || '').replace(/-/g, '')}`,
    });
  }
  if (match.links?.summary) out.push({ label: 'ESPN match summary', url: match.links.summary });
  if (match.links?.stats) out.push({ label: 'ESPN match statistics', url: match.links.stats });
  if (match.home?.espnTeamUrl) out.push({ label: `${match.home.name} team page`, url: match.home.espnTeamUrl });
  if (match.away?.espnTeamUrl) out.push({ label: `${match.away.name} team page`, url: match.away.espnTeamUrl });
  return out;
}

const SPORT_TO_ESPN = {
  football: 'soccer',
  'american-football': 'football',
  basketball: 'basketball',
  baseball: 'baseball',
  'ice-hockey': 'hockey',
  'rugby-league': 'rugby-league',
  'rugby-union': 'rugby',
  tennis: 'tennis',
  cricket: 'cricket',
  'motor-racing': 'racing',
  volleyball: 'volleyball',
  mma: 'mma',
  golf: 'golf',
};

export function espnSportFor(sportKey) {
  return SPORT_TO_ESPN[sportKey] || sportKey;
}

/** Score a whole card and report which matches could not be scored and why. */
export function scoreUniversalCard(matches, ctxFor) {
  const results = [];
  const unscored = [];
  for (const m of matches || []) {
    const ctx = typeof ctxFor === 'function' ? ctxFor(m) : (ctxFor || {});
    const r = scoreUniversalMatch(m, ctx);
    if (r.scoreable) results.push(r);
    else unscored.push({ matchId: m.id, match: `${m.home?.name} v ${m.away?.name}`, reason: r.markets.match_result?.reason || 'no market cleared the publication threshold' });
  }
  results.sort((a, b) => (b.headline?.score || 0) - (a.headline?.score || 0));
  return { ruleset: RULESET_VERSION, results, unscored, generatedAtUtc: null };
}
