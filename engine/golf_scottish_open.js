/**
 * SportsPred — SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0.
 *
 * An EVENT OVERLAY on the golf layer. It does not replace the generic
 * GOLF TOURNAMENT PREDICTION MASTER PROMPT v1.0 (`engine/golf_engine.js`); it
 * supersedes it for one event only — the men's Scottish Open at The Renaissance
 * Club, North Berwick — where the prompt's own calibration applies. Every other
 * tournament keeps scoring against the generic prompt.
 *
 * Why an overlay is needed (all five differences are structural, not cosmetic):
 *   1. Five markets, not six — the overlay has no TOP 6 FINISH market.
 *   2. Different weights — ball-striking breadth replaces the single
 *      approach-play category; a wind/links proxy replaces venue history as the
 *      third pillar; the ranking category is worth fifteen points, not ten.
 *   3. A wave-based first-round-leader category (thirty points) instead of the
 *      generic tee-time-and-weather matrix (twenty-five).
 *   4. Different Step 3 thresholds for the first-round-leader market.
 *   5. A different block order, style list and a mandatory wave/weather note.
 *
 * HONESTY RULES — identical to the rest of the golf layer:
 *   A factor the free sources do not publish scores zero, is marked
 *   `missing: true` on its component, is listed in `missing[]` with the reason,
 *   and caps the market at MEDIUM. Nothing is estimated, and no category is
 *   quietly dropped to make a total look complete. Every named substitution is
 *   written into the component's `detail`. Register:
 *   docs/GOLF_IRREGULARITIES.md (IR-GOLF-17 … IR-GOLF-23).
 */

import { CONFIDENCE } from './golf_engine.js';
import { normName } from './golf_data.js';
import { validateGolfTip, MIN_WORDS, NAME_WITHIN_WORDS, FORBIDDEN_TOKENS } from './golf_writer.js';

export const PROMPT_TITLE = 'SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0';
export const PROMPT_DOC = 'docs/SCOTTISH_OPEN_MASTER_PROMPT.md';
export const RULESET_VERSION = 'SCOTTISH-OPEN-v1.0';
export const PROFILE_ID = 'scottish-open';

/* ------------------------------------------------------------------ *
 * event matching
 * ------------------------------------------------------------------ */

/**
 * ESPN course id and course name for The Renaissance Club, North Berwick.
 * Both are read from the committed ESPN leaderboard payload
 * (`data/golf_events.json` → `course.id` / `course.name`) and from the results
 * tape (`data/golf_results.json` → `courseId` / `courseName`), which record
 * id 10906 and "The Renaissance Club" for the 2024, 2025 and 2026 editions.
 */
export const HOST_COURSE_ID = '10906';
export const HOST_COURSE_NAME = 'the renaissance club';
export const HOST_TOURNAMENT_ID = '4161'; // ESPN tournament id, all three editions in the tape
/** Co-sanctioned by the DP World Tour and the PGA TOUR since 2022. */
export const ELIGIBLE_TOURS = new Set(['pga', 'eur']);

/**
 * True when an event row is the men's Scottish Open.
 *
 * Deliberately name-plus-tour based, not venue based: the prompt's national-open
 * status, Race to Dubai and top-GB-and-Ireland rules describe the men's event,
 * so the Women's Scottish Open (an LPGA Tour event on a different ruleset) must
 * never match. A venue is recorded but never used to reject the match, because
 * historical rows built from the results tape carry only yardage and par.
 */
export function matchScottishOpen(event) {
  const name = normName(event?.name);
  if (!name || !name.includes('scottish open')) return null;
  if (name.includes('women')) return null;
  if (name.includes('senior') || name.includes('legends') || name.includes('amateur')) return null;
  const tour = event?.tour ?? null;
  if (tour && !ELIGIBLE_TOURS.has(tour)) return null;
  const courseId = event?.course?.id != null ? String(event.course.id) : (event?.courseId != null ? String(event.courseId) : null);
  const courseName = normName(event?.course?.name ?? event?.courseName);
  const atHost = courseId === HOST_COURSE_ID || courseName === HOST_COURSE_NAME
    ? true
    : (courseId || courseName) ? false : null; // venue not published
  return {
    id: PROFILE_ID,
    prompt: PROMPT_TITLE,
    doc: PROMPT_DOC,
    ruleset: RULESET_VERSION,
    atHost,
    host: 'The Renaissance Club, North Berwick, Scotland',
    reason: atHost === true
      ? 'name matches the Scottish Open and the published venue is the current host course'
      : atHost === false
        ? 'name matches the Scottish Open but the published venue is not the current host course'
        : 'name matches the Scottish Open; no venue published on this row',
  };
}

/* ------------------------------------------------------------------ *
 * rules — verbatim from the prompt
 * ------------------------------------------------------------------ */

export const MARKETS = Object.freeze({
  outright: 'WIN TOURNAMENT',
  frl: 'FIRST ROUND LEADER',
  top_american: 'TOP AMERICAN PLAYER',
  top_european: 'TOP EUROPEAN PLAYER',
  top_british_irish: 'TOP GB AND IRELAND PLAYER',
});

export const MARKET_ORDER = Object.freeze(['outright', 'frl', 'top_american', 'top_european', 'top_british_irish']);

export const BLOCKS = Object.freeze([
  { key: 'block1', title: 'BLOCK 1: WIN TOURNAMENT', markets: ['outright'] },
  { key: 'block2', title: 'BLOCK 2: FIRST ROUND LEADER', markets: ['frl'] },
  { key: 'block3', title: 'BLOCK 3: TOP AMERICAN PLAYER', markets: ['top_american'] },
  { key: 'block4', title: 'BLOCK 4: TOP EUROPEAN PLAYER', markets: ['top_european'] },
  { key: 'block5', title: 'BLOCK 5: TOP GB AND IRELAND PLAYER', markets: ['top_british_irish'] },
]);

export const RULES = Object.freeze({
  win: { ballStrike: 25, form: 20, links: 20, fit: 20, pedigree: 15, high: 75, medium: 60 },
  frl: { r1: 30, wave: 30, putting: 20, fastStart: 20, high: 75, medium: 65, skip: 50, extraSelections: 2 },
  regional: { high: 70, medium: 55, coSelectGap: 5 },
  value: { fieldRankOutside: 15, linksMin: 15, fitMin: 15, favouriteCut: 5 },
  /** "Never award a maximum course history score based on fewer than two prior
   *  appearances at this specific host venue." */
  minVenueAppearancesForVenueBonus: 2,
  /** Wave split thresholds, in the units the Open-Meteo collector publishes.
   *  They are the same cut-offs `scripts/collect_golf_weather.mjs` already uses
   *  to label the round-one trend, so one forecast cannot produce two stories. */
  wave: { clearWindKmh: 8, mildWindKmh: 4, clearRainPp: 25 },
});

/** Style list, verbatim from the prompt. These are banned in addition to the
 *  generic golf list, which also applies. */
export const BANNED_PHRASES = Object.freeze([
  'hard to look past',
  'will relish the test',
  'made for links golf',
  'on current form',
  'ticks every box',
  'one to watch',
  'a natural fit for this test',
  'loves this time of year',
]);

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function comp(id, label, points, detail, { max = null, missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}
const sum = (cs) => cs.reduce((a, c) => a + (Number(c.points) || 0), 0);
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);

/** The four "major strokes gained categories" the prompt names, in order. */
const SG_FOUR = [['ott', 'off the tee'], ['app', 'approach'], ['arg', 'around the green'], ['putt', 'putting']];

/* ------------------------------------------------------------------ *
 * WIN TOURNAMENT (100)
 * ------------------------------------------------------------------ */

/** All-Around Ball-Striking Form (25). */
export function scoreBallStriking(p, missing) {
  const out = [];
  const sg = p.sg || {};
  const rows = SG_FOUR.map(([k, label]) => ({ key: k, label, avg: Number.isFinite(sg[k]?.avg) ? sg[k].avg : null }));
  const known = rows.filter((r) => r.avg !== null);
  if (known.length < 4) {
    missing.push(`${p.name}: strokes gained across all four categories (only ${known.length} of 4 published for this player; no free per-event or last-eight-events strokes-gained source exists)`);
    out.push(comp('so_ball', 'All-around ball-striking form (strokes gained across four categories)', 0,
      `only ${known.length} of the four categories are published`, { max: RULES.win.ballStrike, missing: true }));
    return out;
  }
  const positive = known.filter((r) => r.avg > 0);
  const negative = known.filter((r) => r.avg < 0);
  let pts; let detail;
  if (positive.length >= 3) { pts = 25; detail = `gaining strokes in ${positive.length} of the 4 categories (${positive.map((r) => r.label).join(', ')})`; }
  else if (positive.length === 2) { pts = 16; detail = `gaining strokes in 2 of the 4 categories (${positive.map((r) => r.label).join(', ')})`; }
  else if (positive.length === 1) { pts = 9; detail = `gaining strokes in only 1 category (${positive[0].label}), however strong`; }
  else if (negative.length >= 3) { pts = 0; detail = `losing strokes in ${negative.length} of the 4 categories`; }
  else { pts = 0; detail = 'no positive category and fewer than three losing categories (the prompt assigns no tier here; scored at the floor)'; }
  out.push(comp('so_ball', 'All-around ball-striking form (strokes gained across four categories)', pts,
    `${detail} — season-to-date averages stand in for the last-eight-events window`, { max: RULES.win.ballStrike }));
  // "Deduct 6pts if the player's game is heavily reliant on one elite category
  // with a clear weakness elsewhere." Measured as: exactly one positive
  // category, it leads the next best by 0.30 strokes or more, and at least two
  // of the other three are losing strokes.
  if (positive.length === 1) {
    const sorted = [...known].sort((a, b) => b.avg - a.avg);
    const lead = sorted[0].avg - sorted[1].avg;
    if (lead >= 0.3 && negative.length >= 2) {
      out.push(comp('so_ball_pen', 'One-dimensional profile penalty', -6,
        `${sorted[0].label} leads the next best category by ${lead.toFixed(2)} strokes with ${negative.length} categories losing strokes`, { max: 0 }));
    }
  }
  return out;
}

/** Recent Form — last six weeks double weighted (20). */
export function scoreFormSo(p, missing) {
  const out = [];
  const f = p.form || {};
  if (!f.starts) {
    missing.push(`${p.name}: recent form (no completed starts in the sourced results tape before this event)`);
    out.push(comp('so_form', 'Recent form (last six weeks double weighted)', 0, 'no starts in tape', { max: RULES.win.form, missing: true }));
    return out;
  }
  let pts; let detail;
  if (f.winIn6w) { pts = 20; detail = 'won a tournament in the last six weeks'; }
  else if (f.top3In6w) { pts = 15; detail = 'top-three finish without a win in the last six weeks'; }
  else if (f.top10Last5 >= 2) { pts = 11; detail = `two or more top tens in the last five starts (${f.top10Last5})`; }
  else if (f.top10Last5 === 1) { pts = 6; detail = 'one top ten in the last five starts'; }
  else if (f.top20Last5 >= 1) { pts = 0; detail = 'top twenty but no top ten in the last five starts (the prompt assigns no tier here; scored at the floor)'; }
  else { pts = 0; detail = 'no top twenty in the last five starts'; }
  const thin = f.starts < 3;
  if (thin) missing.push(`${p.name}: form sample thin (${f.starts} start${f.starts === 1 ? '' : 's'} in tape)`);
  out.push(comp('so_form', 'Recent form (last six weeks double weighted)', pts, detail, { max: RULES.win.form, missing: thin }));
  if (f.backToBackTop10) out.push(comp('so_form_b2b', 'Back-to-back top ten finishes', 4, 'the two most recent starts were both top ten', { max: 4 }));
  return out;
}

/** Wind and Links Proxy Form (20). */
export function scoreLinksProxy(p, ctx, missing) {
  const out = [];
  const l = p.links || {};
  if (!l.starts) {
    missing.push(`${p.name}: wind and links proxy form (no competitive start at The Open Championship or at a cited links venue inside the last two years)`);
    out.push(comp('so_links', 'Wind and links proxy form', 0, 'no competitive links or wind-exposed start on record', { max: RULES.win.links, missing: true }));
  } else {
    let pts; let detail;
    if (l.best !== null && l.best <= 10) { pts = 20; detail = `finished ${l.best} at ${l.bestEvent} on ${l.bestEndDate} (The Open Championship${l.linksStarts ? ` plus ${l.linksStarts} cited links start${l.linksStarts === 1 ? '' : 's'}` : ''})`; }
    else if (l.best !== null && l.best <= 20) { pts = 13; detail = `finished ${l.best} at ${l.bestEvent} on ${l.bestEndDate}`; }
    else if (l.madeCutOnly) { pts = 7; detail = `made the cut in a links or wind-exposed event with no standout finish (${l.starts} start${l.starts === 1 ? '' : 's'})`; }
    else { pts = 0; detail = `started ${l.starts} links or wind-exposed event${l.starts === 1 ? '' : 's'} and did not finish`; }
    out.push(comp('so_links', 'Wind and links proxy form', pts, detail, { max: RULES.win.links }));
  }
  // "+5pts for a top 5 finish at this specific tournament in a prior windy
  // edition, where that data exists". The tape records the finish; it does not
  // record whether that edition was windy, and the profitability rule forbids a
  // maximum venue-history score on fewer than two prior appearances — so the
  // bonus needs two or more appearances and the wind condition is disclosed as
  // unverifiable rather than assumed.
  const e = p.event || {};
  if (e.top5Last3) {
    if ((e.appearances || 0) >= RULES.minVenueAppearancesForVenueBonus) {
      out.push(comp('so_venue', 'Top five here in a prior edition', 5,
        `${e.appearances} prior appearances at this tournament in the tape; whether that edition was windy cannot be verified from any free source, so the finish is credited and the condition is not`, { max: 5 }));
    } else {
      missing.push(`${p.name}: prior top five here (only ${e.appearances || 0} prior appearance in the tape — the prompt refuses a maximum venue-history score on fewer than two, so the wind and links proxy stands in)`);
    }
  }
  return out;
}

/** Course Fit — Shot-Shaping and Short Game (20). */
export function scoreCourseFitSo(p, ctx, missing) {
  const out = [];
  const save = Number(p.stats?.savePct);
  const median = ctx?.scrambleMedian ?? null;
  const hasScramble = Number.isFinite(save) && save > 0 && median !== null;
  missing.push(`${p.name}: low ball flight under pressure (no free source publishes ball flight, spin or trajectory, so this half of the course-fit category is unscored and never assumed)`);
  if (!hasScramble) {
    missing.push(`${p.name}: scrambling from thick rough or pot bunkers (no published up-and-down figure for this player in this field; ${ctx?.scrambleSample ?? 0} players in the field carry one)`);
    out.push(comp('so_fit', 'Course fit: shot-shaping and short game', 0, 'neither half of this category could be measured', { max: RULES.win.fit, missing: true }));
    return out;
  }
  const strong = save >= median;
  const pts = strong ? 12 : 3;
  const detail = strong
    ? `above-average scrambling from off the green (${save.toFixed(1)}% up and down against this field's median of ${median.toFixed(1)}%); the low-flight half is not published by any free source, so twelve is the most this category can reach`
    : `below this field's median for up-and-downs (${save.toFixed(1)}% against ${median.toFixed(1)}%); the low-flight half is not published by any free source`;
  out.push(comp('so_fit', 'Course fit: shot-shaping and short game', pts, detail, { max: RULES.win.fit }));
  missing.push(`${p.name}: high, spin-heavy ball-flight penalty (no free source publishes ball flight, so the eight-point penalty is unassessed and never applied)`);
  return out;
}

/** World Ranking and Field-Adjusted Pedigree (15). */
export function scorePedigreeSo(p, missing) {
  const out = [];
  const r = p.owgr || null;
  if (!r || !r.rank) {
    missing.push(`${p.name}: Official World Golf Ranking (no ranking row matched to this name)`);
    out.push(comp('so_rank', 'World ranking and field-adjusted pedigree', 0, 'no OWGR match', { max: RULES.win.pedigree, missing: true }));
  } else {
    const pts = r.rank <= 10 ? 15 : r.rank <= 20 ? 11 : r.rank <= 50 ? 6 : 2;
    out.push(comp('so_rank', 'World ranking and field-adjusted pedigree', pts,
      `OWGR ${r.rank}${r.trajectory ? ` (${r.trajectory > 0 ? 'up' : 'down'} ${Math.abs(r.trajectory)} this week)` : ''}`, { max: RULES.win.pedigree }));
  }
  const f = p.form || {};
  if (f.majorWinOrRunnerUp2y >= 1) {
    out.push(comp('so_major', 'Major championship win or runner-up in the last two years', 5,
      `${f.majorWinOrRunnerUp2y} major win or runner-up finish${f.majorWinOrRunnerUp2y === 1 ? '' : 'es'} inside two years`, { max: 5 }));
  }
  return out;
}

/** Outright base score under the overlay. */
export function scoreWinBase(p, ctx) {
  const missing = [];
  const components = [
    ...scoreBallStriking(p, missing),
    ...scoreFormSo(p, missing),
    ...scoreLinksProxy(p, ctx, missing),
    ...scoreCourseFitSo(p, ctx, missing),
    ...scorePedigreeSo(p, missing),
  ];
  const cat = (id) => components.find((c) => c.id === id)?.points ?? 0;
  return {
    components,
    score: sum(components),
    missing,
    categories: { ballStriking: cat('so_ball'), form: cat('so_form'), links: cat('so_links'), fit: cat('so_fit'), pedigree: cat('so_rank') },
    coreMissing: components.some((c) => c.missing && ['so_ball', 'so_form', 'so_links', 'so_fit', 'so_rank'].includes(c.id)),
  };
}

/* ------------------------------------------------------------------ *
 * FIRST ROUND LEADER (100)
 * ------------------------------------------------------------------ */

/** Morning/afternoon wave split for one tee time against the field median. */
export function waveAssignment(teeTimeISO, ctx) {
  const tee = Date.parse(teeTimeISO || '');
  const median = ctx?.medianTee ?? null;
  if (!Number.isFinite(tee) || median === null) return { wave: null, early: null, reason: 'tee time not published for the opening round' };
  return { wave: tee < median ? 'morning' : 'afternoon', early: tee < median, reason: null };
}

/** Forecast divergence between the two waves, from the committed Open-Meteo row. */
export function waveForecast(ctx) {
  const w = ctx?.weather?.r1 || null;
  const am = Number(w?.windAmKmh); const pm = Number(w?.windPmKmh);
  if (!w || !Number.isFinite(am) || !Number.isFinite(pm)) return { split: null, divergenceKmh: null, favourableWave: null, reason: 'round-one forecast not collected for this event' };
  const rainAm = Number(w.rainAmPct) || 0; const rainPm = Number(w.rainPmPct) || 0;
  const dWind = pm - am; const dRain = rainPm - rainAm;
  const T = RULES.wave;
  let split = 'none';
  if (Math.abs(dWind) >= T.clearWindKmh || Math.abs(dRain) >= T.clearRainPp) split = 'clear';
  else if (Math.abs(dWind) >= T.mildWindKmh) split = 'mild';
  // The favourable wave is the calmer, drier one.
  let favourableWave = 'morning';
  if (Math.abs(dWind) >= T.mildWindKmh) favourableWave = dWind > 0 ? 'morning' : 'afternoon';
  else if (Math.abs(dRain) >= T.mildWindKmh) favourableWave = dRain > 0 ? 'morning' : 'afternoon';
  return { split, divergenceKmh: Math.round(dWind * 10) / 10, rainDivergencePp: Math.round(dRain * 10) / 10, favourableWave, am, pm, reason: null };
}

export function scoreFrlSo(p, ctx) {
  const missing = [];
  const out = [];
  const r1 = p.r1 || {};

  /* 1. First round scoring average (30). The prompt ranks "on tour"; the free
        source only ranks within the published field, and that substitution is
        named on the component (IR-GOLF-18). */
  if (r1.avgR1ToPar === null || r1.avgR1ToPar === undefined) {
    missing.push(`${p.name}: opening-round scoring average (fewer than four sourced opening rounds in the tape)`);
    out.push(comp('so_frl_r1', 'First round scoring average', 0, 'thin opening-round sample', { max: RULES.frl.r1, missing: true }));
  } else {
    const rank = ctx.r1InField?.get(p.athleteId) ?? null;
    const pts = rank !== null && rank <= 10 ? 30 : rank !== null && rank <= 20 ? 20 : rank !== null && rank <= 40 ? 11 : 0;
    out.push(comp('so_frl_r1', 'First round scoring average', pts,
      `average opening round ${r1.avgR1ToPar > 0 ? '+' : ''}${r1.avgR1ToPar} to par ranks ${rank ?? 'n/a'} of ${ctx.r1Sample} in this field (rank within the field stands in for the tour-wide ranking)`, { max: RULES.frl.r1 }));
  }

  /* 2. Tee time and weather wave advantage (30). */
  const wa = waveAssignment(p.teeTime, ctx);
  const wf = waveForecast(ctx);
  let waveEdge = false;
  if (wa.wave === null) {
    missing.push(`${p.name}: confirmed round-one tee time (${wa.reason})`);
    out.push(comp('so_frl_wave', 'Tee time and weather wave advantage', 0, wa.reason, { max: RULES.frl.wave, missing: true }));
  } else if (wf.split === null) {
    missing.push(`${p.name}: wave forecast divergence (${wf.reason})`);
    out.push(comp('so_frl_wave', 'Tee time and weather wave advantage', 0, `${wa.wave} wave; ${wf.reason}`, { max: RULES.frl.wave, missing: true }));
  } else if (wf.split === 'none') {
    out.push(comp('so_frl_wave', 'Tee time and weather wave advantage', 10,
      `no meaningful forecast divergence between the waves (wind ${wf.am} vs ${wf.pm} km/h), so every player scores the same ten regardless of tee time — ${wa.wave} wave`, { max: RULES.frl.wave }));
  } else if (wf.split === 'mild') {
    out.push(comp('so_frl_wave', 'Tee time and weather wave advantage', 15,
      `${wa.wave} wave with only mild forecast divergence (wind ${wf.am} vs ${wf.pm} km/h)`, { max: RULES.frl.wave }));
  } else if (wa.wave === wf.favourableWave) {
    waveEdge = true;
    out.push(comp('so_frl_wave', 'Tee time and weather wave advantage', 30,
      `confirmed ${wa.wave} wave on the favourable side of a clearly forecast split (wind ${wf.am} vs ${wf.pm} km/h)`, { max: RULES.frl.wave }));
  } else {
    out.push(comp('so_frl_wave', 'Tee time and weather wave advantage', 0,
      `${wa.wave} wave on the less favourable side of a clearly forecast split (wind ${wf.am} vs ${wf.pm} km/h)`, { max: RULES.frl.wave }));
  }

  /* 3. Putting form on true, contoured greens (20). */
  if (p.sg?.putt) {
    const rank = ctx.sgPuttInField?.get(p.athleteId) ?? null;
    const neg = Number(p.sg.putt.avg) < 0;
    const pts = neg ? 0 : rank !== null && rank <= 10 ? 20 : rank !== null && rank <= 25 ? 13 : rank !== null && rank <= 50 ? 6 : 0;
    out.push(comp('so_frl_putt', 'Putting form on true, contoured greens', pts,
      neg ? 'negative putting trend' : `putting ranks ${rank ?? 'n/a'} in this field (season average stands in for the last-four-events window)`, { max: RULES.frl.putting }));
  } else {
    missing.push(`${p.name}: strokes gained putting (not sourced for this player)`);
    out.push(comp('so_frl_putt', 'Putting form on true, contoured greens', 0, 'not sourced', { max: RULES.frl.putting, missing: true }));
  }

  /* 4. Fast start profile under links pressure (20). */
  missing.push(`${p.name}: opening rounds "played in notable wind" (no free source publishes per-round wind for completed events, so the twenty-point tier is unreachable and the twelve-point tier is used)`);
  if (r1.slowStarts >= 3 && r1.lateCharges >= 2) {
    out.push(comp('so_frl_fast', 'Fast start profile under links pressure', 0,
      `documented slow-start pattern: ${r1.slowStarts} of the last ${r1.fastStartSample} opening rounds at 73 or worse with ${r1.lateCharges} closing rounds two strokes or more better than the opening round — the wrong profile for this market`, { max: RULES.frl.fastStart }));
  } else if (r1.in60sLast5 >= 2) {
    out.push(comp('so_frl_fast', 'Fast start profile under links pressure', 12,
      `scored in the sixties in ${r1.in60sLast5} of the last ${r1.fastStartSample} opening rounds (conditions on those days are not published)`, { max: RULES.frl.fastStart }));
  } else {
    out.push(comp('so_frl_fast', 'Fast start profile under links pressure', 0,
      `${r1.in60sLast5 || 0} of the last ${r1.fastStartSample || 0} opening rounds in the sixties`, { max: RULES.frl.fastStart }));
  }

  return { components: out, score: sum(out), missing, waveEdge, coreMissing: out.some((c) => c.missing) };
}

/* ------------------------------------------------------------------ *
 * Regional modifiers
 * ------------------------------------------------------------------ */

export function scoreAmericanModsSo(p, ctx, missing) {
  const out = [];
  const rank = ctx.americanRank?.get(p.athleteId) ?? null;
  if (rank !== null && rank <= 1) out.push(comp('so_us_top', 'Top ranked American in the field', 10, `highest OWGR rank of the ${ctx.regionCounts?.american ?? 0} Americans in this field`, { max: 10 }));
  else if (rank === null) missing.push(`${p.name}: OWGR rank among Americans (no ranking row matched)`);
  const f = p.form || {};
  if (f.tourWinIn?.('pga', 90)) out.push(comp('so_us_win', 'PGA TOUR win in the last three months', 8, 'measured from the results tape', { max: 8 }));
  missing.push(`${p.name}: whether the player travelled specifically as competitive links preparation (intent is not published by any free source, so the six-point bonus is unassessed and never assumed)`);
  if (!(p.links?.anyLinksStart)) {
    out.push(comp('so_us_nolinks', 'No prior competitive start on a genuine links or severe-wind coastal course', -10,
      'no start at The Open Championship or at a cited links venue in the sourced tape', { max: 0 }));
  }
  return out;
}

export function scoreEuropeanModsSo(p, ctx, missing) {
  const out = [];
  const rank = ctx.europeanRank?.get(p.athleteId) ?? null;
  if (rank !== null && rank <= 1) out.push(comp('so_eu_top', 'Top ranked European in the field', 10, `highest OWGR rank of the ${ctx.regionCounts?.european ?? 0} Europeans in this field`, { max: 10 }));
  else if (rank === null) missing.push(`${p.name}: OWGR rank among Europeans (no ranking row matched)`);
  const f = p.form || {};
  if (f.tourWinIn?.('eur', 42) || f.tourTop3In?.('eur', 42)) out.push(comp('so_eu_dpwt', 'DP World Tour win or top three in the last six weeks', 8, 'measured from the results tape', { max: 8 }));
  missing.push(`${p.name}: Race to Dubai contention (no free key-less Race to Dubai standings feed is published, so the six-point incentive bonus is unassessed and never assumed)`);
  if (f.mcLast2Consecutive) out.push(comp('so_eu_mc', 'Missed the cut in the last two consecutive starts', -10, 'measured from the results tape', { max: 0 }));
  return out;
}

export function scoreBritishIrishModsSo(p, ctx, missing) {
  const out = [];
  out.push(comp('so_bi_home', 'Home national open status', 14, 'this is the confirmed national open of the host nation for these players', { max: 14 }));
  const rank = ctx.britishIrishRank?.get(p.athleteId) ?? null;
  if (rank !== null && rank <= 1) out.push(comp('so_bi_top', 'Top ranked GB and Ireland player in the field', 10, `highest OWGR rank of the ${ctx.regionCounts?.britishIrish ?? 0} British and Irish players in this field`, { max: 10 }));
  else if (rank === null) missing.push(`${p.name}: OWGR rank among British and Irish players (no ranking row matched)`);
  const f = p.form || {};
  if (f.tourWinIn?.('eur', 120) || f.tourTop5In?.('eur', 120)) out.push(comp('so_bi_dpwt', 'DP World Tour win or top five in the last four months', 8, 'measured from the results tape', { max: 8 }));
  const e = p.event || {};
  const priorCut = (e.appearances || 0) > 0 && !e.mcLast3;
  if (priorCut) out.push(comp('so_bi_cut', 'Made the cut in a prior appearance at this event', 6, `${e.appearances} prior appearance${e.appearances === 1 ? '' : 's'} in the tape with no missed cut among the last three`, { max: 6 }));
  else if (p.links?.openStarts && p.links.best !== null && p.links.best <= 10) out.push(comp('so_bi_cut', 'Strong recent finish at a links major', 6, `finished ${p.links.best} at ${p.links.bestEvent}`, { max: 6 }));
  if (f.competedLast3Weeks === false && f.starts) out.push(comp('so_bi_rust', 'No competitive start in the last three weeks', -8, `last start ${f.lastStartDaysAgo} days ago`, { max: 0 }));
  if (f.mcLast2Consecutive) out.push(comp('so_bi_mc', 'Missed cuts in the last two consecutive starts', -10, 'measured from the results tape', { max: 0 }));
  return out;
}

/* ------------------------------------------------------------------ *
 * Step 3 — bet decision rules
 * ------------------------------------------------------------------ */

export function bandWin(score, coreMissing) {
  if (score >= RULES.win.high) return coreMissing ? CONFIDENCE.MEDIUM : CONFIDENCE.HIGH;
  if (score >= RULES.win.medium) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW; // never SKIP: below sixty is written and flagged as value
}

export function bandFrlSo(score, waveEdge, coreMissing) {
  if (score < RULES.frl.skip) return CONFIDENCE.SKIP;
  if (score >= RULES.frl.high && waveEdge && !coreMissing) return CONFIDENCE.HIGH;
  if (score >= RULES.frl.medium) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

export function bandRegionalSo(score, coreMissing, { coSelected = false } = {}) {
  if (coSelected) return score >= RULES.regional.medium ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW;
  if (score >= RULES.regional.high) return coreMissing ? CONFIDENCE.MEDIUM : CONFIDENCE.HIGH;
  if (score >= RULES.regional.medium) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

/** The prompt's mandatory value test: outside the top fifteen in the field, with
 *  the wind/links proxy score AND the course-fit score both at fifteen or more. */
export function isValuePickSo(base, fieldRank) {
  const v = RULES.value;
  return fieldRank !== null && fieldRank !== undefined && fieldRank > v.fieldRankOutside
    && base.categories.links >= v.linksMin && base.categories.fit >= v.fitMin;
}

/** True when the value test can never be satisfied on sourced evidence, because
 *  the course-fit ceiling is twelve while the rule asks for fifteen. */
export const VALUE_TEST_UNREACHABLE = 'the mandatory value test asks for a course-fit score of fifteen or more, but the low-flight half of that category is not published by any free source, so twelve is the most a player can score there; the outside-the-top-five-favourites fallback is used instead and is written without the VALUE PICK label';

/* ------------------------------------------------------------------ *
 * event scoring
 * ------------------------------------------------------------------ */

const CORE_IDS = ['so_ball', 'so_form', 'so_links', 'so_fit', 'so_rank'];

export function hasEvidenceSo(cand) {
  if (!cand || !(cand.score >= 1)) return false;
  return (cand.components || []).filter((c) => CORE_IDS.includes(c.id) && !c.missing).length >= 1;
}

function publicProfileSo(p) {
  return {
    athleteId: p.athleteId,
    name: p.name,
    country: p.country,
    amateur: p.amateur,
    owgr: p.owgr?.rank ?? null,
    last5: p.form?.last5 || [],
    starts: p.form?.starts ?? 0,
    eventLast4: p.event?.last4 || [],
    avgR1ToPar: p.r1?.avgR1ToPar ?? null,
    in60sLast5: p.r1?.in60sLast5 ?? null,
    links: p.links ? { starts: p.links.starts, openStarts: p.links.openStarts, best: p.links.best, bestEvent: p.links.bestEvent, bestEndDate: p.links.bestEndDate } : null,
    scramblingPct: Number(p.stats?.savePct) > 0 ? p.stats.savePct : null,
    sg: p.sg ? Object.fromEntries(Object.entries(p.sg).map(([k, v]) => [k, v ? { avg: v.avg } : null])) : null,
    teeTime: p.teeTime ?? null,
    region: p.region,
    sources: p.sources,
  };
}

function candidate(p, ctx, score, components, missing, band, extra = {}) {
  return {
    athleteId: p.athleteId,
    name: p.name,
    country: p.country,
    score: Math.round(score * 10) / 10,
    band,
    components,
    missing,
    fieldRank: ctx.owgrInField?.get(p.athleteId) ?? null,
    profile: publicProfileSo(p),
    ...extra,
  };
}

/**
 * Score the men's Scottish Open under the overlay.
 * @param {object} event    {id, name, tour, startDate, course, tournamentId}
 * @param {object[]} profiles buildGolfProfile() output for the field
 * @param {object} ctx      buildFieldContext() output
 */
export function scoreScottishOpen(event, profiles, ctx) {
  const list = (profiles || []).filter((p) => p && p.athleteId && !p.amateur);
  const flags = [];
  if (!list.length) {
    return { unscored: true, ruleset: RULESET_VERSION, prompt: PROMPT_TITLE, flags: ['UNSCORED: no field published yet'], missing: ['field (entry list not yet published by the source)'], markets: {} };
  }
  if ((profiles || []).some((p) => p?.amateur)) flags.push('amateurs excluded from all markets');

  const eventMissing = [];
  if (ctx.sgSuppressed) {
    eventMissing.push(`strokes gained (only ${ctx.sgSuppressed.matched} of ${ctx.sgSuppressed.scored} players in this field carry a strokes-gained row, below the ${Math.round(ctx.sgSuppressed.floor * 100)}% coverage floor, so it is missing for everyone and the field stays level)`);
    flags.push(`strokes gained suppressed: ${ctx.sgSuppressed.matched} of ${ctx.sgSuppressed.scored} players covered (floor ${Math.round(ctx.sgSuppressed.floor * 100)}%); no market can read HIGH`);
  } else if (!ctx.sgCoverage) {
    eventMissing.push('strokes gained (no free per-player strokes-gained source for this field, so the ball-striking and putting categories score zero and are marked missing)');
  }
  const wf = waveForecast(ctx);
  if (wf.split === null) eventMissing.push(`round-one wave forecast (${wf.reason}; the wave category scores zero for every player and no first-round-leader tip can read HIGH)`);
  if (!ctx.scrambleMedian) eventMissing.push(`scrambling (only ${ctx.scrambleSample ?? 0} players in this field carry a published up-and-down figure, so the course-fit category cannot be measured)`);
  if ((ctx.priorEditionsInTape ?? 0) < RULES.minVenueAppearancesForVenueBonus) {
    eventMissing.push('venue history (fewer than two prior editions of this tournament in the sourced tape, so the wind and links proxy is the primary substitute for course knowledge)');
  }
  eventMissing.push('odds (no free key-less bookmaker odds source exists, so OWGR rank within the field stands in for market favouritism in the value rule and the cross-reference of two bookmakers cannot be performed)');
  eventMissing.push('Race to Dubai standings (no free key-less standings feed, so the European incentive bonus is unassessed)');

  const scored = list.map((p) => {
    const base = scoreWinBase(p, ctx);
    const fieldRank = ctx.owgrInField?.get(p.athleteId) ?? null;
    return { p, base, fieldRank, value: isValuePickSo(base, fieldRank) };
  });

  /* ---- BLOCK 1: WIN TOURNAMENT ---- */
  const winCands = scored.map((s) => candidate(s.p, ctx, s.base.score, s.base.components, s.base.missing,
    bandWin(s.base.score, s.base.coreMissing), { valuePick: s.value, coreMissing: s.base.coreMissing, categories: s.base.categories }))
    .sort((a, b) => b.score - a.score || (a.fieldRank ?? 999) - (b.fieldRank ?? 999));
  const top = winCands.find(hasEvidenceSo) || null;
  if (!top) flags.push('win tournament: no player has any sourced evidence, so the market is written as NO SELECTION rather than naming an arbitrary player');
  const selections = top ? [top] : [];
  const valueCands = winCands.filter((c) => c.valuePick && hasEvidenceSo(c) && c.athleteId !== top?.athleteId);
  // The prompt's own boundary for "outside the top 15 in the field"; the wider
  // outside-the-top-five list is only a second-line fallback and is flagged.
  const outsideTop15 = winCands.filter((c) => hasEvidenceSo(c) && c.fieldRank !== null && c.fieldRank > RULES.value.fieldRankOutside && c.athleteId !== top?.athleteId);
  const outsideTop5 = winCands.filter((c) => hasEvidenceSo(c) && c.fieldRank !== null && c.fieldRank > RULES.value.favouriteCut && c.athleteId !== top?.athleteId);
  let valuePickApplied = null;
  if (top && (top.fieldRank === null || top.fieldRank <= RULES.value.favouriteCut || !top.valuePick)) {
    const v = valueCands[0] || null;
    if (v) { selections.push({ ...v, valuePick: true }); valuePickApplied = v.name; }
    else if (outsideTop15[0] || outsideTop5[0]) {
      const pick = outsideTop15[0] || outsideTop5[0];
      selections.push({ ...pick, valuePick: false, valueFallback: true });
      valuePickApplied = pick.name;
      flags.push(`no player met the strict value test; ${VALUE_TEST_UNREACHABLE}. ${pick.name} is listed instead as the best-scoring player ${outsideTop15[0] ? 'outside the top fifteen' : 'outside the top five favourites'} in the field, without the VALUE PICK label.`);
    }
  }
  const winMarket = {
    key: 'outright', label: MARKETS.outright, threshold: null,
    candidates: winCands.slice(0, 25), selections, valuePickApplied,
    missing: eventMissing,
    note: 'Never skipped: a score under sixty is written and flagged as value rather than a banker.',
  };

  /* ---- BLOCK 2: FIRST ROUND LEADER ---- */
  const frlCands = scored.map((s) => {
    const r = scoreFrlSo(s.p, ctx);
    return candidate(s.p, ctx, r.score, r.components, r.missing, bandFrlSo(r.score, r.waveEdge, r.coreMissing),
      { waveEdge: r.waveEdge, coreMissing: r.coreMissing });
  }).sort((a, b) => b.score - a.score || (a.fieldRank ?? 999) - (b.fieldRank ?? 999));
  const frlListed = frlCands.filter((c) => c.score >= RULES.frl.skip);
  // The first-round-leader candidate carries only its own four components, so
  // the win-market evidence test does not apply here: a selection needs at
  // least one MEASURED category that actually scored.
  const frlSel = frlListed
    .filter((c) => c.band !== CONFIDENCE.SKIP && (c.components || []).some((x) => !x.missing && Number(x.points) > 0))
    .slice(0, 1 + RULES.frl.extraSelections);
  if (frlListed.length && !frlSel.length) flags.push('first round leader: no player reaches fifty points on sourced evidence, so the market is written as NO SELECTION');
  const frlMarket = {
    key: 'frl', label: MARKETS.frl, threshold: RULES.frl.skip,
    candidates: frlListed.slice(0, 25), selections: frlSel, missing: eventMissing,
    note: 'Top selection plus up to two further contenders, listed from fifty points. Sixty-five caps at MEDIUM; HIGH needs seventy-five and a confirmed wave advantage.',
  };

  /* ---- BLOCKS 3-5: regional markets, scored independently ---- */
  const regional = (key, flag, modFn, rankMap) => {
    const eligible = scored.filter((s) => s.p.region?.[flag]);
    const cands = eligible.map((s) => {
      const fm = [...s.base.missing];
      const mods = modFn(s.p, ctx, fm);
      const comps = [...s.base.components, ...mods];
      return candidate(s.p, ctx, sum(comps), comps, fm, null, { coreMissing: s.base.coreMissing, regionRank: rankMap?.get(s.p.athleteId) ?? null, baseScore: s.base.score });
    }).sort((a, b) => b.score - a.score || (a.regionRank ?? 999) - (b.regionRank ?? 999));
    const withEvidence = cands.filter(hasEvidenceSo);
    const selections = [];
    let coSelected = false;
    if (cands.length && !withEvidence.length) flags.push(`${MARKETS[key]}: eligible players exist but none has sourced evidence, so the market is written as NO SELECTION`);
    if (withEvidence.length) {
      const a = withEvidence[0]; const b = withEvidence[1] || null;
      coSelected = Boolean(b) && (a.score - b.score) <= RULES.regional.coSelectGap;
      a.band = bandRegionalSo(a.score, a.coreMissing, { coSelected });
      selections.push(a);
      if (coSelected) { b.band = bandRegionalSo(b.score, b.coreMissing, { coSelected: true }); selections.push({ ...b, coSelection: true }); }
    }
    for (const c of cands) if (c.band === null) c.band = bandRegionalSo(c.score, c.coreMissing);
    return {
      key, label: MARKETS[key], threshold: RULES.regional.medium,
      eligible: eligible.length, candidates: cands.slice(0, 15), selections, coSelected,
      missing: eligible.length ? eventMissing : [`${MARKETS[key]}: no eligible player in the published field`],
      note: eligible.length ? (coSelected ? 'Two players finished within five points, so both are flagged as co-selections at MEDIUM rather than one forced HIGH pick.' : null)
        : 'No eligible player in the published field, so this market is written as NO SELECTION.',
    };
  };
  const usMarket = regional('top_american', 'american', scoreAmericanModsSo, ctx.americanRank);
  const euMarket = regional('top_european', 'european', scoreEuropeanModsSo, ctx.europeanRank);
  const biMarket = regional('top_british_irish', 'britishIrish', scoreBritishIrishModsSo, ctx.britishIrishRank);

  // The same player heading more than one regional market must be justified on
  // each market's own merits, not copied across — flagged for the writer.
  const heads = new Map();
  for (const m of [winMarket, frlMarket, usMarket, euMarket, biMarket]) {
    const h = m.selections?.[0];
    if (h) heads.set(h.athleteId, [...(heads.get(h.athleteId) || []), m.label]);
  }
  for (const [id, labels] of heads) if (labels.length > 1) flags.push(`same player heads ${labels.join(' and ')} — each market is written separately and justified on its own merits as the prompt requires`);

  return {
    unscored: false,
    ruleset: RULESET_VERSION,
    prompt: PROMPT_TITLE,
    doc: PROMPT_DOC,
    flags,
    missing: eventMissing,
    fieldSize: list.length,
    valueTestUnreachable: VALUE_TEST_UNREACHABLE,
    waveForecast: wf,
    markets: {
      outright: winMarket,
      frl: frlMarket,
      top_american: usMarket,
      top_european: euMarket,
      top_british_irish: biMarket,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Step 4 — written output
 * ------------------------------------------------------------------ */

export const OPENERS = Object.freeze([
  'Wind decides this week more than anything else, and **{name}** has already been measured in it, showing',
  'Completeness across the bag is what separates contenders here, which puts **{name}** forward on the strength of',
  'Home soil changes the complexion of a national open, and **{name}** arrives carrying',
  'A calm morning draw can hand a player the tournament, and **{name}** has',
  'Recent weeks tell the story for **{name}**, who brings',
  'The closing stretch of the season race sharpens intent, and **{name}** shows',
  'Nothing about the leading group is safe in a cross-breeze, which is why **{name}** matters with',
  'Travel for links rehearsal rather than a warm-up lap pays, and **{name}** offers',
  'Short-game touch around firm turf is the quiet separator, and **{name}** has',
  'Ranking is only part of it: **{name}** pairs standing with',
  'Big-field outrights reward a player who never needs one shot to go right, and **{name}** brings',
  'Opening rounds in a stiff breeze flatter the prepared, and **{name}** is prepared with',
  'Hole by hole on contoured surfaces the putter decides, and **{name}** is holding its line with',
  'Form over the last six weeks counts double here, and **{name}** has',
  'Between the American travellers, **{name}** leads on',
  'Among the European entries, **{name}** stands ahead on',
  'British and Irish hopes are best placed with **{name}**, who carries',
  'Quietly consistent rather than spectacular, **{name}** arrives with',
  'Ball flight matters when the flag is tucked, and **{name}** has shown',
  'Everything in the sourced record points one way for **{name}**, who arrives with',
  'Course knowledge here is thin for everyone, so **{name}** is judged on',
  'Few arrive with a better record in exposed conditions than **{name}**, who brings',
  'Pressure golf is played off the ground as much as through the air, and **{name}** handles that with',
  'Momentum through the summer months favours **{name}**, whose record shows',
]);

const REGION_WORD = { top_european: 'European', top_american: 'American', top_british_irish: 'British and Irish' };

const ANGLES = {
  outright: [
    (n) => `That combination makes ${n} the most complete claim on the trophy in this field, with the pieces that survive a breezy afternoon all pointing the same way.`,
    (n) => `Taken together, those strengths give ${n} a genuine chance of holding the lead when the wind is at its worst on the closing holes.`,
    (n) => `The evidence says ${n} is built for a week where one good department is never enough to carry a player home.`,
  ],
  value: [
    (n) => `Priced well outside the leading group yet close to it on the evidence that survives bad weather, ${n} is the value angle of the week.`,
    (n) => `${n} sits beyond the obvious names, but the wind-and-links record and the short-game numbers both point the same way, which is where the profit in a field this large is usually found.`,
  ],
  frl: [
    (n) => `One round is all this market asks for, and ${n} has the scoring habit and the tee-slot draw to make the most of the calmest hours of the day.`,
    (n) => `Opening-day leaderboards in a breeze belong to players who hole putts early, which is exactly the pattern ${n} keeps producing.`,
    (n) => `For eighteen holes only, ${n} holds the ingredients that turn a fast start into the outright lead.`,
  ],
  regional: [
    (n, r) => `Set against the rest of the ${r} contingent, ${n} offers the most complete case, so this market goes that way.`,
    (n, r) => `Measured one by one against the other ${r} players here, ${n} holds the clearest edge on the sourced record.`,
    (n, r) => `${n} heads the ${r} market on evidence rather than reputation, and the gap to the next name is wide enough to hold.`,
  ],
};

const LOW_ANGLES = {
  outright: (n) => `The evidence is thinner than the market deserves, so ${n} is offered as a value-style outright rather than a banker, with enough sourced support to justify a place on the card.`,
  frl: (n) => `For the opening round ${n} clears the threshold on sourced evidence, but the gaps in what is published keep the grade modest.`,
  regional: (n, r) => `Within the ${r} group the sourced evidence is thin, yet ${n} still reads best on what is published, so the market goes that way at a modest grade.`,
};

function joinList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

const pts = (c, id) => (c.components || []).find((x) => x.id === id)?.points ?? 0;
const has = (c, id) => (c.components || []).some((x) => x.id === id && Number(x.points) > 0);

/** Qualitative clauses only. No figure, rank or score leaves this function. */
export function factClausesSo(c, marketKey) {
  if (marketKey === 'frl') {
    const out = [];
    const r1 = pts(c, 'so_frl_r1');
    if (r1 >= 30) out.push('some of the best opening-round scoring in this field');
    else if (r1 >= 20) out.push('strong opening-round scoring against this field');
    else if (r1 >= 11) out.push('above-average opening-round scoring here');
    const wave = pts(c, 'so_frl_wave');
    if (wave >= 30) out.push('a tee slot on the right side of a clearly forecast weather split');
    else if (wave >= 15) out.push('a tee slot in the gentler part of the day');
    else if (wave >= 10) out.push('no meaningful draw between the two groups this week');
    const putt = pts(c, 'so_frl_putt');
    if (putt >= 20) out.push('one of the hottest putters in the field');
    else if (putt >= 13) out.push('a putter in good order');
    else if (putt >= 6) out.push('a putter holding its own');
    if (pts(c, 'so_frl_fast') >= 12) out.push('a habit of opening in the sixties');
    if (!out.length) out.push('an opening-round record that clears the threshold for this market');
    return out;
  }
  const out = [];
  const ball = pts(c, 'so_ball');
  if (ball >= 25) out.push('strokes being gained across most of the bag rather than one department');
  else if (ball >= 16) out.push('strokes being gained in two clear areas of the game');
  else if (ball >= 9) out.push('one genuinely elite department carrying the rest');
  const form = pts(c, 'so_form');
  if (form >= 20) out.push('a victory inside the last six weeks');
  else if (form >= 15) out.push('a top-three finish inside the last six weeks');
  else if (form >= 11) out.push('multiple top tens across the last five starts');
  else if (form >= 6) out.push('a top ten among the last five starts');
  const links = pts(c, 'so_links');
  if (links >= 20) out.push('a top-ten finish in serious wind-exposed championship conditions');
  else if (links >= 13) out.push('a solid finish in exposed conditions');
  else if (links >= 7) out.push('a weekend played in tough conditions');
  if (has(c, 'so_venue')) out.push('a top-five finish in a previous edition here');
  const fit = pts(c, 'so_fit');
  if (fit >= 12) out.push('above-average recovery work from off the green');
  if (has(c, 'so_major')) out.push('a major-championship result inside the last two years');
  const rank = pts(c, 'so_rank');
  if (rank >= 15) out.push('a place among the world elite');
  else if (rank >= 11) out.push('a top-twenty world ranking');
  else if (rank >= 6) out.push('a top-fifty world ranking');
  if (has(c, 'so_form_b2b')) out.push('back-to-back top tens');
  if (marketKey === 'top_american') {
    if (has(c, 'so_us_top')) out.unshift('the strongest ranking among the American travellers');
    if (has(c, 'so_us_win')) out.push('a win on the American circuit inside three months');
  }
  if (marketKey === 'top_european') {
    if (has(c, 'so_eu_top')) out.unshift('the strongest ranking among the European entries');
    if (has(c, 'so_eu_dpwt')) out.push('a recent win or top three on the European circuit');
  }
  if (marketKey === 'top_british_irish') {
    if (has(c, 'so_bi_home')) out.unshift('the standing that comes with playing a home national open');
    if (has(c, 'so_bi_top')) out.push('the strongest ranking among the home players');
    if (has(c, 'so_bi_dpwt')) out.push('a recent win or top five on the European circuit');
    if (has(c, 'so_bi_cut')) out.push('a cut made in a previous edition here');
  }
  if (!out.length) out.push('a partial but sourced record that still reads better than the rest of this field');
  return [...new Set(out)];
}

export function cautionClausesSo(c) {
  const out = [];
  if (pts(c, 'so_ball_pen') < 0) out.push('a game that leans hard on one department');
  if (pts(c, 'so_us_nolinks') < 0) out.push('no competitive start on genuine links in the sourced record');
  if (pts(c, 'so_eu_mc') < 0 || pts(c, 'so_bi_mc') < 0) out.push('two straight missed cuts tempering the case');
  if (pts(c, 'so_bi_rust') < 0) out.push('a spell without competitive rounds');
  if (c.coreMissing) out.push('part of the usual evidence is not published for this week, so the grade is held back');
  return out;
}

const confidenceSentence = (band) => (band === CONFIDENCE.HIGH ? 'Confidence: HIGH.' : band === CONFIDENCE.MEDIUM ? 'Confidence: MEDIUM.' : 'Confidence: LOW.');

function composeTipSo({ marketKey, label, cand, band, openerIdx, angleIdx, valuePick = false, outsider = false, coSelection = false }) {
  const name = cand.name;
  const facts = factClausesSo(cand, marketKey);
  const cautions = cautionClausesSo(cand);
  const opener = OPENERS[openerIdx % OPENERS.length].replace('{name}', name);
  const group = marketKey.startsWith('top_') ? 'regional' : marketKey;
  const angleFn = band === CONFIDENCE.LOW
    ? LOW_ANGLES[group === 'outright' ? 'outright' : group]
    : (valuePick ? ANGLES.value : ANGLES[group])[angleIdx % (valuePick ? ANGLES.value : ANGLES[group]).length];
  const angle = angleFn(name, REGION_WORD[marketKey]);
  const caution = cautions.length ? ` Against that, ${cautions[0]}.` : '';
  const co = coSelection ? ' The head of this market is close enough that a second selection is justified alongside the first.' : '';
  const value = valuePick
    ? ' Flagged as the value selection of the week: outside the leading group, close to it on the evidence that survives wind.'
    : outsider ? ' Listed as the outright from outside the leading group, this is an outsider case built on the sourced record rather than a headline claim.' : '';
  let text = `${opener} ${joinList(facts.slice(0, 3))}. ${angle}${caution}${value}${co} ${confidenceSentence(band)}`.replace(/\s+/g, ' ').trim();
  if (text.split(/\s+/).length < MIN_WORDS) {
    text = text.replace(/\s*Confidence:.*$/, '') + ' Every part of that case comes from completed rounds rather than reputation, and it holds together across the factors this market rewards. ' + confidenceSentence(band);
  }
  return { text, ok: true, violations: [], band, market: label, marketKey, name, athleteId: cand.athleteId, skip: false, valuePick, outsider, coSelection, score: cand.score };
}

function skipTipSo(label, marketKey, reason) {
  return {
    text: `NO SELECTION — ${reason} Confidence: LOW.`,
    ok: true, violations: [], band: CONFIDENCE.SKIP, market: label, marketKey, name: null, athleteId: null, skip: true, valuePick: false, coSelection: false, score: null,
  };
}

function skipReasonSo(market) {
  if (!market) return 'This market could not be assessed from the sourced data, so no selection is made.';
  if (market.eligible === 0) return 'No eligible player appears in the published field for this market, so no selection is made.';
  if (!market.candidates?.length) return 'No player in the field produced enough sourced evidence to clear the threshold for this market, so no selection is made.';
  return 'No player reaches the scoring threshold for this market on the sourced evidence available, so no selection is made.';
}

/** Wave and weather impact note — always included, words only. */
export function waveWeatherNoteSo(scored) {
  const wf = scored?.waveForecast || null;
  if (!wf || wf.split === null) {
    return 'Wave and weather impact: no round-one forecast was available when this card was written, so the tee-time wave — the single most decisive input for the opening-round market at this event — could not be assessed and every weather-dependent grade carries extra uncertainty.';
  }
  if (wf.split === 'none') {
    return 'Wave and weather impact: the forecast shows no meaningful divergence between the morning and afternoon groups, so the tee-slot advantage is neutralised this week and the opening-round market rests on scoring habit and putting rather than on the draw.';
  }
  const worse = wf.favourableWave === 'morning' ? 'afternoon' : 'morning';
  const strength = wf.split === 'clear' ? 'a clear split' : 'only a mild split';
  return `Wave and weather impact: the forecast separates the two groups, with ${worse} starters facing the harder conditions — ${strength} between the waves. Wind is the deciding variable at this venue, where calm weeks have produced winning scores in the low twenties under par and exposed weeks have been won at or near single figures under, so every grade on this card should be read as weather-dependent and the opening-round market should be revisited once the wave split and forecast are confirmed.`;
}

/** Whole-card validation under the overlay's own style rules. */
export function validateScottishOpenCard(written) {
  const issues = [];
  const firstWords = new Set();
  const firstThree = new Set();
  const forbiddenNames = written?.forbiddenNames || [];
  const banned = [...BANNED_PHRASES];
  for (const t of written?.tips || []) {
    const v = validateGolfTip(t.text, { expectSkip: t.skip, forbiddenNames, bannedPhrases: banned });
    if (!v.ok) issues.push({ market: t.market, player: t.name, violations: v.violations });
    if (t.skip) continue;
    const ws = t.text.trim().split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));
    if (firstWords.has(ws[0])) issues.push({ market: t.market, player: t.name, violations: [`duplicate opening word: "${ws[0]}"`] });
    const w3 = ws.slice(0, 3).join(' ');
    if (firstThree.has(w3)) issues.push({ market: t.market, player: t.name, violations: [`duplicate opening phrase: "${w3}"`] });
    firstWords.add(ws[0]); firstThree.add(w3);
  }
  const count = (key) => (written?.tips || []).filter((t) => t.marketKey === key && !t.skip).length;
  if (count('outright') > 2) issues.push({ violations: ['more than two win-tournament selections (top pick plus value pick)'] });
  if (count('frl') > 1 + RULES.frl.extraSelections) issues.push({ violations: [`more than ${1 + RULES.frl.extraSelections} first-round-leader selections`] });
  for (const key of ['top_american', 'top_european', 'top_british_irish']) {
    if (count(key) > 2) issues.push({ violations: [`more than two ${MARKETS[key]} selections`] });
  }
  if (!written?.waveNote) issues.push({ violations: ['the wave and weather impact note is missing — the prompt requires it on every card'] });
  if (written?.tips?.some((t) => !t.skip && !/Confidence:\s*(HIGH|MEDIUM|LOW)/.test(t.text))) issues.push({ violations: ['a tip is missing its confidence level'] });
  return { ok: issues.length === 0, issues };
}

/**
 * Write the five-block card.
 * @param {object} scored  scoreScottishOpen() output
 * @param {object} event   {id, name, tour, startDate, course:{name, city}}
 */
export function writeScottishOpenCard(scored, event) {
  const tips = [];
  const blocks = [];
  let openerIdx = 0;
  const angleCount = {};
  const next = (marketKey, label, cand, band, extra = {}) => {
    const k = marketKey.startsWith('top_') ? 'regional' : marketKey;
    angleCount[k] = angleCount[k] || 0;
    const tip = composeTipSo({ marketKey, label, cand, band, openerIdx, angleIdx: angleCount[k], ...extra });
    openerIdx += 1; angleCount[k] += 1;
    tips.push(tip);
    return tip;
  };
  const markets = scored?.markets || {};

  /* Block 1 — win tournament: top selection, then the mandatory value selection. */
  const b1 = { key: 'block1', title: BLOCKS[0].title, tips: [] };
  const win = markets.outright;
  const winTop = win?.selections?.[0] || null;
  if (winTop) {
    b1.tips.push(next('outright', MARKETS.outright, winTop, winTop.band, { valuePick: winTop.valuePick === true }));
    const val = (win.selections || []).find((s) => s.athleteId !== winTop.athleteId) || null;
    if (val) b1.tips.push(next('outright', MARKETS.outright, val, val.band, { valuePick: val.valuePick === true, outsider: val.valueFallback === true }));
  } else {
    const t = skipTipSo(MARKETS.outright, 'outright', skipReasonSo(win)); tips.push(t); b1.tips.push(t);
  }
  blocks.push(b1);

  /* Block 2 — first round leader: top selection plus up to two further. */
  const b2 = { key: 'block2', title: BLOCKS[1].title, tips: [] };
  const frl = markets.frl;
  const frlSel = (frl?.selections || []).slice(0, 1 + RULES.frl.extraSelections);
  if (frlSel.length) for (const c of frlSel) b2.tips.push(next('frl', MARKETS.frl, c, c.band));
  else { const t = skipTipSo(MARKETS.frl, 'frl', skipReasonSo(frl)); tips.push(t); b2.tips.push(t); }
  blocks.push(b2);

  /* Blocks 3-5 — regional, in the prompt's order. */
  for (const [i, key] of ['top_american', 'top_european', 'top_british_irish'].entries()) {
    const m = markets[key];
    const b = { key, title: BLOCKS[i + 2].title, tips: [] };
    const sel = (m?.selections || []).slice(0, 2);
    if (sel.length) for (const c of sel) b.tips.push(next(key, MARKETS[key], c, c.band, { coSelection: c.coSelection === true }));
    else { const t = skipTipSo(MARKETS[key], key, skipReasonSo(m)); tips.push(t); b.tips.push(t); }
    blocks.push(b);
  }

  const summary = [];
  for (const key of MARKET_ORDER) {
    for (const t of tips.filter((x) => x.marketKey === key)) {
      summary.push({ market: MARKETS[key], selection: t.skip ? 'NO SELECTION' : t.name, band: t.band, valuePick: t.valuePick });
    }
  }
  const valuePicks = tips.filter((t) => t.valuePick && !t.skip).map((t) => ({ name: t.name, market: t.market }));
  const forbiddenNames = [event?.name, event?.shortName, event?.tournamentName, event?.course?.name, event?.course?.city, event?.tourName,
    'Genesis Scottish Open', 'Scottish Open', 'The Renaissance Club', 'Renaissance Club', 'North Berwick', 'Race to Dubai',
    'PGA TOUR', 'DP World Tour', 'The Open Championship', 'FedExCup'].filter(Boolean);
  const written = {
    tips, blocks, summary, valuePicks,
    waveNote: waveWeatherNoteSo(scored),
    weatherNote: waveWeatherNoteSo(scored), // alias so shared renderers find it
    event: { id: event?.id ?? null, startDate: event?.startDate ?? null },
    forbiddenNames,
    flags: scored?.flags || [],
    ruleset: RULESET_VERSION,
    prompt: PROMPT_TITLE,
  };
  written.cardText = buildScottishOpenCardText(written);
  return written;
}

export function buildScottishOpenCardText(written) {
  const rows = (written?.summary || []).map((r) => `| ${r.market} | ${r.selection}${r.valuePick ? ' — VALUE PICK' : ''} | ${r.band} |`).join('\n');
  const value = written?.valuePicks?.length
    ? `Value pick summary: ${written.valuePicks.map((v) => `${v.name} (${v.market})`).join('; ')}.`
    : 'Value pick summary: no selection met the value test this week.';
  const body = (written?.blocks || []).map((b) => [b.title, ...b.tips.map((t) => `${t.valuePick ? 'VALUE PICK — ' : ''}${t.text}`)].join('\n\n')).join('\n\n');
  return [
    `Scottish Open Prediction Card${written?.event?.startDate ? ` — ${String(written.event.startDate).slice(0, 10)}` : ''} (${RULESET_VERSION})`,
    '',
    body,
    '',
    '| Market | Selection | Confidence |',
    '|---|---|---|',
    rows,
    '',
    value,
    '',
    written?.waveNote || '',
    '',
    'Responsible gambling. Nothing here is betting advice. Predictions are generated mechanically from sourced data and are fallible. 18+.',
  ].join('\n');
}

export { MIN_WORDS, NAME_WITHIN_WORDS, FORBIDDEN_TOKENS };
