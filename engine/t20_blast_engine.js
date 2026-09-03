/**
 * SportsPred — T20 Blast (Vitality Blast) scoring engine.
 *
 * Implements the "T20 BLAST (ENGLAND & WALES) CRICKET PREDICTION MASTER PROMPT
 * v1.0" for the four markets it names — WIN MATCH, MAN OF THE MATCH,
 * TOP TEAM 1 BATSMAN, TOP TEAM 2 BATSMAN — over the verified 2026 tape.
 *
 * TWO SCORES, DELIBERATELY
 * ------------------------
 * `prompt`  — the rubric exactly as the master prompt writes it, delegated to
 *             engine/cricket_engine.js. Three of its five WIN factors (bowling
 *             matchup scouting, batting depth from player form, bookmaker odds)
 *             have no free key-less source, so they are recorded missing and
 *             penalised. Under the prompt's own thresholds this drives almost
 *             every market to SKIP. That is the honest output of the rubric as
 *             written against the data that actually exists, and it is shown.
 * `evidence`— a declared, walk-forward model built only from figures the tape
 *             verifies: form, season points rate, head-to-head, the league's
 *             own measured home-win rate, winning-margin profile and rest. Its
 *             weights are hyperparameters declared below and never fitted to
 *             the backtest, so the backtest in scripts/backtest_t20_blast.mjs
 *             measures the model rather than repeating it.
 *
 * Neither path ever invents a value. Anything unsourced appears in `missing[]`.
 */

import { scoreCricketMatch, CONFIDENCE, FORMATS } from './cricket_engine.js';

export const BLAST_RULESET = 'T20 BLAST PREDICTION MASTER PROMPT v1.0';
export const EVIDENCE_MODEL_VERSION = 'blast-evidence-1.0.0';

/** Declared a priori. Not fitted. Changing these invalidates the backtest. */
export const EVIDENCE_WEIGHTS = {
  form: 30,      // last five captured fixtures, most recent first
  season: 20,    // points rate to date (deduction restored: adjusted performance)
  h2h: 15,       // captured meetings, most recent three weighted double
  venue: 15,     // the league's own measured home-win rate to date
  margin: 10,    // decisive wins against narrow losses
  rest: 10,      // days since the previous captured fixture
};

/** Missing-factor penalty, matching engine/cricket_engine.js. */
export const MISSING_PENALTY = 5;

/** Logistic slope turning an evidence score into a probability. Declared, not fitted. */
export const PROB_SLOPE = 12;

export const BAND = CONFIDENCE;

function comp(id, label, points, max, detail, extra = {}) {
  return { id, label, points, max, detail, missing: !!extra.missing, source: extra.source || null, proxy: !!extra.proxy };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Evidence score -> probability of the higher-scored side winning. */
export function evidenceProbability(score) {
  const p = 1 / (1 + Math.exp(-(score - 50) / PROB_SLOPE));
  return Number(clamp(p, 0.05, 0.95).toFixed(3));
}

/* ------------------------------------------------------------------ *
 * Evidence components
 * ------------------------------------------------------------------ */

function formComponent(side, opp) {
  const f = side.form || {};
  const max = EVIDENCE_WEIGHTS.form;
  if (!f.played) return comp('form', 'Recent form (last 5 captured fixtures)', 0, max, 'no earlier captured fixture', { missing: true, source: 'tape' });
  if (f.played < 3) {
    return comp('form', 'Recent form (last 5 captured fixtures)', 0, max,
      `only ${f.played} captured fixture(s) before this date — too thin to score`, { missing: true, source: 'tape' });
  }
  const wins = f.wins;
  let pts = 0;
  if (wins >= 4) pts = 30; else if (wins === 3) pts = 21; else if (wins === 2) pts = 12; else if (wins === 1) pts = 5; else pts = 0;
  let detail = `${wins} win(s) in the last ${f.sample} captured fixtures`;
  if (f.winStreak >= 3) { pts += 3; detail += `; ${f.winStreak} in a row`; }
  if (opp?.form?.losses >= 3) { pts += 2; detail += `; opponent has lost ${opp.form.losses} of their last ${opp.form.sample}`; }
  return comp('form', 'Recent form (last 5 captured fixtures)', clamp(pts, 0, max + 4), max + 4, detail, { source: 'tape' });
}

function seasonComponent(side) {
  const t = side.table;
  const max = EVIDENCE_WEIGHTS.season;
  if (!t || !t.played) return comp('season', 'Season points rate (adjusted performance)', 0, max, 'no captured fixtures yet', { missing: true, source: 'tape' });
  if (t.played < 3) return comp('season', 'Season points rate (adjusted performance)', 0, max, `only ${t.played} captured fixture(s) — too thin`, { missing: true, source: 'tape' });
  const rate = t.performanceRate ?? 0;
  let pts;
  if (rate >= 0.75) pts = 20; else if (rate >= 0.6) pts = 16; else if (rate >= 0.45) pts = 11; else if (rate >= 0.3) pts = 6; else pts = 2;
  const detail = `${t.performancePoints} performance point(s) from ${t.played} captured fixture(s)` +
    (t.points_deduction ? `; a confirmed ${t.points_deduction}-point deduction is applied to the official total and restored here, so standing is read as adjusted performance` : '');
  return comp('season', 'Season points rate (adjusted performance)', pts, max, detail, { source: 'tape + official table' });
}

function h2hComponent(side) {
  const h = side.h2h || {};
  const max = EVIDENCE_WEIGHTS.h2h;
  if (!h.totalMeetings) return comp('h2h', 'Head-to-head (recent three weighted double)', 0, max, 'no captured meeting between these counties before this date', { missing: true, source: 'tape' });
  const rate = h.weightedWinRate ?? 0;
  let pts;
  if (rate >= 0.66) pts = 15; else if (rate >= 0.5) pts = 11; else if (rate >= 0.34) pts = 6; else pts = 2;
  if (h.totalMeetings === 1) pts = Math.min(pts, 11);
  const detail = `${h.teamWins} win(s) from ${h.totalMeetings} captured meeting(s)` +
    (h.totalMeetings === 1 ? '; a single meeting is thin evidence, so the component is capped' : '') +
    (h.sweptLastThree ? '; won the last three in a row' : '');
  return comp('h2h', 'Head-to-head (recent three weighted double)', pts, max, detail, { source: 'tape' });
}

function venueComponent(side, isHome, league) {
  const max = EVIDENCE_WEIGHTS.venue;
  const ha = league?.home_advantage || {};
  if (side.fixtureNeutral) return comp('venue', 'Venue (league-measured home advantage)', 0, max, 'neutral venue: no venue signal applies', { source: 'tape' });
  if (!ha.sufficient || ha.rate == null) {
    return comp('venue', 'Venue (league-measured home advantage)', 0, max,
      `only ${ha.total || 0} captured fixtures decided so far — the home-win rate is not yet measurable`, { missing: true, source: 'tape' });
  }
  const r = ha.rate;
  const pts = isHome
    ? clamp(Math.round(((r - 0.40) / 0.25) * max), 0, max)
    : clamp(Math.round(((0.60 - r) / 0.25) * max), 0, max);
  const detail = `home side won ${(r * 100).toFixed(0)}% of the ${ha.total} captured fixtures decided before this date` +
    ` — this fixture is at ${isHome ? 'a home ground' : 'the opposition ground'}`;
  return comp('venue', 'Venue (league-measured home advantage)', pts, max, detail, { source: 'tape (measured, no assumed constant)' });
}

function marginComponent(side) {
  const m = side.margin || {};
  const max = EVIDENCE_WEIGHTS.margin;
  if (!m.played || m.played < 3) return comp('margin', 'Winning-margin profile', 0, max, 'too few captured results to profile margins', { missing: true, source: 'tape' });
  const d = ((m.decisive_wins || 0) - (m.narrow_losses || 0)) / m.played;
  const pts = clamp(Math.round(5 + d * 20), 0, max);
  return comp('margin', 'Winning-margin profile', pts, max,
    `${m.decisive_wins || 0} decisive win(s) against ${m.narrow_losses || 0} narrow loss(es) across ${m.played} captured fixture(s)`, { source: 'tape' });
}

function restComponent(side) {
  const r = side.rest || {};
  const max = EVIDENCE_WEIGHTS.rest;
  if (r.days == null) return comp('rest', 'Turnaround and congestion', 0, max, 'no earlier captured fixture to measure turnaround from', { missing: true, source: 'tape' });
  let pts;
  if (r.days >= 5) pts = 10; else if (r.days === 4) pts = 8; else if (r.days === 3) pts = 6; else if (r.days === 2) pts = 3; else pts = 0;
  return comp('rest', 'Turnaround and congestion', pts, max,
    `${r.days} day(s) since the previous captured fixture (${r.congestion})`, { source: 'tape' });
}

/** Score one side on the evidence model. */
export function scoreEvidenceSide(side, opp, ctx, isHome) {
  const enriched = { ...side, fixtureNeutral: !!ctx.fixture?.neutral };
  const components = [
    formComponent(enriched, opp),
    seasonComponent(enriched),
    h2hComponent(enriched),
    venueComponent(enriched, isHome, ctx.league),
    marginComponent(enriched),
    restComponent(enriched),
  ];
  const missing = components.filter((c) => c.missing).map((c) => c.id);
  const raw = components.reduce((s, c) => s + Math.max(0, c.points), 0);
  const score = clamp(raw - missing.length * MISSING_PENALTY, 0, 100);
  return { components, missing, raw, score, sourced: components.filter((c) => !c.missing).length };
}

function bandFromScore(score, probability, gates) {
  if (gates.unscoreable) return BAND.SKIP;
  if (score >= 70 && probability >= 0.60 && gates.sampleOk) return BAND.HIGH;
  if (score >= 55 && gates.sampleOk) return BAND.MEDIUM;
  return BAND.SKIP;
}

function dropTier(band) {
  if (band === BAND.HIGH) return BAND.MEDIUM;
  if (band === BAND.MEDIUM) return BAND.LOW;
  if (band === BAND.LOW) return BAND.SKIP;
  return BAND.SKIP;
}

/* ------------------------------------------------------------------ *
 * Strict prompt path (delegates to the shared cricket engine)
 * ------------------------------------------------------------------ */

function toCricketMatch(row, ctx) {
  const side = (name, c) => ({
    name,
    form: { last5: c.form?.last5 || [], winStreak: c.form?.winStreak || 0 },
    odds: null,
    batting: { inFormBatsmen: [], weakness: null },
    bowling: { style: null },
    momCandidates: Array.isArray(row.players?.[name]?.mom) ? row.players[name].mom : [],
    batsmanCandidates: Array.isArray(row.players?.[name]?.batters) ? row.players[name].batters : [],
  });
  const home = side(row.home, ctx.home);
  const away = side(row.away, ctx.away);
  const h = ctx.home.h2h || {};
  return {
    event_id: row.event_id,
    competition_id: row.event_id,
    format: FORMATS.T20,
    home, away,
    homeTeamObj: home,
    awayTeamObj: away,
    // `team` names the side this block was written for; cricket_engine orients
    // it for the other side instead of awarding both the same points.
    h2h: { team: row.home, totalMeetings: h.totalMeetings ?? null, teamWins: h.teamWins ?? null, recentMeetings: h.recentMeetings || [] },
    pitch: null,
    weather: row.weather || null,
  };
}

/**
 * Score one fixture across all four markets.
 *
 * @param {object} row     a tape row (data/t20_blast_matches.json) or a live-collected fixture
 * @param {object} ctx     the walk-forward context from engine/t20_blast_data.js
 */
export function scoreBlastMatch(row, ctx) {
  const missing = [];
  const flags = [];
  const caps = [];

  const strict = scoreCricketMatch(toCricketMatch(row, ctx));

  /* ---- WIN MATCH, evidence model ---- */
  const homeSide = scoreEvidenceSide(ctx.home, ctx.away, ctx, true);
  const awaySide = scoreEvidenceSide(ctx.away, ctx.home, ctx, false);

  const unscoreable = homeSide.score === 0 && awaySide.score === 0 &&
    (ctx.home.form?.played || 0) < 3 && (ctx.away.form?.played || 0) < 3;
  const sampleOk = (ctx.home.form?.played || 0) >= 3 && (ctx.away.form?.played || 0) >= 3;

  const pickHome = homeSide.score >= awaySide.score;
  const fav = pickHome ? homeSide : awaySide;
  const dog = pickHome ? awaySide : homeSide;
  const probability = unscoreable ? null : evidenceProbability(clamp(50 + (fav.score - dog.score) / 2, 0, 100));

  let band = bandFromScore(fav.score, probability ?? 0, { unscoreable, sampleOk });

  // Prompt Step 3: crossover fixtures carry thinner data — never read HIGH.
  if (ctx.fixture?.cross_pool) {
    caps.push('cross_pool_fixture');
    if (band === BAND.HIGH) band = BAND.MEDIUM;
    flags.push('CROSSOVER: fixture is against a county from another group, so head-to-head and recent-matchup evidence is thinner.');
  }
  // Prompt Step 3: rain / DLS shortens a match — drop one tier everywhere.
  if (row.dl_method || row.weather?.rain_likely) {
    caps.push('rain_or_dls');
    band = dropTier(band);
    flags.push('WEATHER: a rain-affected or revised chase is confirmed or highly likely; every market drops one confidence tier.');
  }
  // No free key-less price feed for county cricket: always declared.
  caps.push('no_market_price');
  missing.push('bookmaker odds (match winner, man of the match, top batsman) — no free key-less feed (TB-IR-02)');
  if (!row.weather) missing.push('weather forecast for match time — no free structured feed tied to a fixture (TB-IR-03)');
  if (!row.pitch) missing.push('pitch report and ground scoring character — no free structured feed (TB-IR-03)');
  for (const id of [...homeSide.missing, ...awaySide.missing]) {
    missing.push(`evidence factor "${id}" could not be sourced for at least one side`);
  }

  // Prompt: a side missing a confirmed overseas/England player drops confidence.
  if (row.availability?.missing_key_player) {
    caps.push('key_player_unavailable');
    band = dropTier(band);
    flags.push('AVAILABILITY: a confirmed overseas or England-contracted player is unavailable; confidence reduced across every market.');
  }
  if (ctx.fixture?.dl_method) flags.push('NOTE: this fixture was decided under a revised target.');
  const deducted = [ctx.home, ctx.away].filter((s) => s.table?.points_deduction);
  if (deducted.length) {
    flags.push('STANDING: at least one county carries a confirmed points deduction, so its table position is read as adjusted performance. Internal context only — never referenced in a tip.');
  }

  /* ---- Player markets ---- */
  const playerMarkets = (key, label) => {
    const strictMarket = strict.markets[key] || {};
    if (strictMarket.selection && strictMarket.band !== BAND.SKIP) {
      return {
        score: strictMarket.score, band: strictMarket.band, selection: strictMarket.selection,
        components: strictMarket.components || [], source: 'live confirmed XI + this-match figures',
      };
    }
    // Two different reasons for a SKIP, and they must never be conflated:
    //   (a) no candidate could be sourced at all, or
    //   (b) a candidate was sourced but scored below this market's threshold.
    const belowThreshold = !!strictMarket.selection;
    if (!belowThreshold) {
      missing.push(`${label}: confirmed starting XI, batting positions and rolling player form are only available from a live match summary (TB-IR-04)`);
      return {
        score: 0, band: BAND.SKIP, selection: null, components: [],
        skip_reason: 'No confirmed starting XI or rolling player figures exist for this fixture in the committed tape, so no player can be named without speculation.',
        skip_kind: 'unsourced',
      };
    }
    return {
      score: strictMarket.score ?? 0, band: BAND.SKIP, selection: null,
      components: strictMarket.components || [],
      // The candidate's name is withheld: naming a player in a SKIP would read
      // as a tip. The score is kept for internal review only.
      skip_reason: 'A candidate was sourced from the confirmed line-up but scored below the threshold this market requires, so no player is named.',
      skip_kind: 'below_threshold',
      below_threshold_candidate_score: strictMarket.score ?? 0,
    };
  };

  const markets = {
    win_match: {
      selection: pickHome ? row.home : row.away,
      opponent: pickHome ? row.away : row.home,
      score: fav.score,
      opposition_score: dog.score,
      band,
      probability,
      components: pickHome ? homeSide.components : awaySide.components,
      opposition_components: pickHome ? awaySide.components : homeSide.components,
      strict_prompt: {
        selection: strict.favourite,
        score: strict.markets.win_match?.score ?? null,
        band: strict.markets.win_match?.band ?? BAND.SKIP,
        components: strict.markets.win_match?.components ?? [],
        note: 'The rubric exactly as the master prompt writes it. Three of its five factors have no free key-less source, so they are penalised and the market resolves to SKIP.',
      },
    },
    man_of_the_match: playerMarkets('man_of_the_match', 'MAN OF THE MATCH'),
    top_team1_batsman: { ...playerMarkets('top_team1_batsman', 'TOP TEAM 1 BATSMAN'), team: row.home },
    top_team2_batsman: { ...playerMarkets('top_team2_batsman', 'TOP TEAM 2 BATSMAN'), team: row.away },
  };

  // Prompt Step 3: never more than three individual player markets per match.
  const active = Object.keys(markets).filter((k) => k !== 'win_match' && markets[k].band !== BAND.SKIP);
  if (active.length > 3) {
    active.sort((a, b) => (markets[b].score || 0) - (markets[a].score || 0));
    for (const k of active.slice(3)) { markets[k].band = BAND.SKIP; markets[k].selection = null; }
    flags.push('CORRELATION: limited to three individual player markets; the weakest was withheld.');
  }

  return {
    event_id: row.event_id,
    date: row.date,
    stage: row.stage,
    group: row.group,
    home: row.home,
    away: row.away,
    ruleset: BLAST_RULESET,
    evidence_model: EVIDENCE_MODEL_VERSION,
    markets,
    missing: [...new Set(missing)].sort(),
    flags,
    caps: [...new Set(caps)],
    sample_ok: sampleOk,
    unscoreable,
    review_urls: row.review_urls || (row.source_url ? [row.source_url] : []),
  };
}

/** Score a whole card of fixtures. `contextFor` is injected so the caller
 *  decides whether context is walk-forward (backtest) or whole-tape (display). */
export function scoreBlastCard(rows, buildContext) {
  const results = [];
  for (const row of rows || []) {
    const ctx = buildContext(row);
    results.push({ match: row, ctx, result: scoreBlastMatch(row, ctx) });
  }
  return { ruleset: BLAST_RULESET, evidence_model: EVIDENCE_MODEL_VERSION, results, count: results.length };
}

/* ------------------------------------------------------------------ *
 * Publication gate
 * ------------------------------------------------------------------ */

/** HIGH > MEDIUM > LOW > SKIP. Local copy: cricket_engine keeps its own private. */
export function bandRank(band) {
  return { HIGH: 3, MEDIUM: 2, LOW: 1, SKIP: 0 }[band] ?? 0;
}

/**
 * Apply the walk-forward publication gate to a scored fixture.
 *
 * The gate is computed by scripts/backtest_t20_blast.mjs from a replay of a
 * completed season and committed as data/t20_blast_backtest.json. This function
 * is pure: it takes the gate as an argument and never reads a file, so the same
 * code path runs in Node, in CI and in the browser.
 *
 * What it does, and what it deliberately does not do:
 *   · caps any tier the validation does not support (HIGH -> MEDIUM on the 2026
 *     tape, where HIGH hit 40% over 20 fixtures against MEDIUM's 65%)
 *   · keeps `modelBand`, the tier the model actually assigned, alongside the
 *     published `band`. The observed rate quoted to a reader must belong to the
 *     tier the model chose, not to the label the gate substituted — otherwise
 *     capping would silently launder a weak claim into a stronger-looking one.
 *   · attaches the observed hit rate, sample size and Wilson interval for that
 *     tier so the page can show evidence instead of an adjective
 *   · never alters a score, a weight or a probability
 */
export function applyPublicationGate(result, gate) {
  if (!result) return result;
  if (!gate || !gate.cap) {
    return { ...result, publicationGate: { cap: null, triggered: [], applied: false } };
  }
  const rates = gate.observedRates || {};
  const capRank = bandRank(gate.cap);
  const markets = {};
  let capped = false;

  for (const [key, m] of Object.entries(result.markets)) {
    if (!m || typeof m !== 'object') { markets[key] = m; continue; }
    const modelBand = m.modelBand || m.band;
    const published = bandRank(modelBand) > capRank ? gate.cap : modelBand;
    if (published !== modelBand) capped = true;
    const obs = rates[modelBand] || null;
    markets[key] = {
      ...m,
      modelBand,
      band: published,
      validated: obs ? {
        modelBand,
        publishedBand: published,
        observedHitRatePct: obs.hitRate,
        observedN: obs.n,
        wilson95: obs.ci95 || null,
        source: 'data/t20_blast_backtest.json',
        note: 'Observed rate from the walk-forward replay of the last completed season, for the tier this model actually assigned.',
      } : null,
    };
  }

  return {
    ...result,
    markets,
    publicationGate: {
      cap: gate.cap,
      applied: capped,
      triggered: (gate.triggered || []).map((t) => (typeof t === 'string' ? t : t.id)),
      capReason: gate.capReason || null,
      overall: gate.overall || null,
      baseline: gate.baseline || null,
      noEdgeOverBaseline: !!(gate.triggered || []).some((t) => (t.id || t) === 'no_edge_over_baseline'),
    },
  };
}

/**
 * Shape the committed backtest artifact into the gate object the engine takes.
 * Keeps the page and the scripts reading one definition of the gate.
 */
export function gateFromBacktest(backtestDoc) {
  const gate = backtestDoc?.evidence_path?.publicationGate;
  if (!gate) return null;
  return {
    cap: gate.cap || null,
    capReason: gate.capReason || null,
    triggered: gate.triggered || [],
    modelProbabilityCalibrated: !!gate.modelProbabilityCalibrated,
    overall: backtestDoc?.evidence_path?.overall || null,
    baseline: backtestDoc?.evidence_path?.baselines?.always_home || null,
    observedRates: backtestDoc?.evidence_path?.intervals?.byBand || {},
    season: backtestDoc?.season || null,
    model: backtestDoc?.evidence_model || null,
  };
}
