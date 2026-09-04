/**
 * SportsPred — CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT v1.0.
 *
 * An event overlay on the snooker layer. It does not replace the generic
 * snooker prompt (engine/snooker_engine.js): it supersedes it for exactly one
 * competition — Championship League Snooker — because that event's format has
 * no equivalent elsewhere in the sport (a best-of-four group match can end
 * 2-2, and group placings can turn on highest break).
 *
 * Three markets, each scored independently out of 100:
 *   MATCH RESULT   form 30 · ranking/seeding 20 · H2H 20 · break-building 15 · odds 15
 *   GROUP WINNER   group strength 35 · H2H within group 25 · points path 25 · break ceiling 15
 *   CORRECT SCORE  match-result alignment 40 · scoreline tendency 30 · decisiveness 20 · ceiling 10
 *
 * EDITION IS A HARD GATE. The ranking edition plays best-of-four group matches
 * (draw possible, 3 points a win, 1 a draw, fourth frame skipped at 3-0); the
 * invitational plays best-of-five (no draw). Scoring refuses to run until the
 * edition is stated, and the Correct Score outcome set switches with it.
 *
 * Pure: no I/O, no clock, no randomness. Every input is derived by the caller
 * from the committed, source-verified tape (data/snooker_cls.json), and every
 * factor that the free sources do not publish is recorded as MISSING and
 * scored zero rather than estimated.
 *
 * WHAT THE FREE SOURCES DO NOT PUBLISH (see docs/CLS_SNOOKER_IRREGULARITIES.md)
 *   - Prices. No free, key-less snooker odds feed exists and OLBG publishes
 *     tipster vote percentages, never prices. The 15-point Odds and Value
 *     factor is therefore recorded missing on every card (IR-CLS-01) and the
 *     "value candidate" flag is only ever raised on form/H2H grounds.
 *   - Per-frame break detail. Only the highest break per player per group is
 *     published, so break-building form is measured from those published
 *     highest breaks, never from a per-match century count (IR-CLS-02).
 */

export const PROMPT_VERSION = 'v1.0';
export const RULESET_VERSION = 'v1.0';
export const PROMPT_NAME = 'CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT v1.0';

export const EDITIONS = Object.freeze({
  ranking: Object.freeze({
    id: 'ranking',
    label: 'ranking edition',
    bestOf: 4,
    drawPossible: true,
    scorelines: ['3-0', '3-1', '2-2'],
    closeScoreline: '2-2',
    points: { win: 3, draw: 1, loss: 0 },
  }),
  invitational: Object.freeze({
    id: 'invitational',
    label: 'invitational edition',
    bestOf: 5,
    drawPossible: false,
    scorelines: ['3-0', '3-1', '3-2'],
    closeScoreline: '3-2',
    points: { win: 1, draw: null, loss: 0 },
  }),
});

export const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', SKIP: 'SKIP' });

/** Step 3 thresholds, verbatim. */
export const RULES = Object.freeze({
  matchResult: { high: 70, mediumMin: 50, mediumFactors: 2 },
  groupWinner: { high: 70, mediumMin: 55, clearBy: 15 },
  correctScore: { high: 70, mediumMin: 55 },
  drawModifier: { within: 8 },
});

export function editionFor(id) {
  const e = EDITIONS[String(id || '').toLowerCase()];
  if (!e) {
    throw new Error(
      `Championship League edition must be stated as "ranking" or "invitational" before scoring; got ${JSON.stringify(id)}`,
    );
  }
  return e;
}

function comp(id, label, points, max, detail, { missing = false } = {}) {
  return { id, label, points, max, detail, missing };
}

/* ------------------------------------------------------------------ *
 * MATCH RESULT — 100 pts
 * ------------------------------------------------------------------ */

/** Recent short-format form (30). Counts wins in the last five short-format matches. */
export function scoreShortFormatForm(profile, missing) {
  const last5 = (profile?.last5 || []).slice(0, 5);
  if (last5.length === 0) {
    missing.push(`${profile?.name || 'player'}: recent short-format form (no earlier Championship League matches in the tape)`);
    return comp('form', 'Recent short-format form (30 pts)', 0, 30, 'no earlier short-format matches on record', { missing: true });
  }
  const wins = last5.filter((m) => m.result === 'win').length;
  let points = 0;
  if (wins >= 4) points = 30;
  else if (wins === 3) points = 20;
  else if (wins === 2) points = 10;
  return comp('form', 'Recent short-format form (30 pts)', points, 30,
    `${wins} win${wins === 1 ? '' : 's'} in the last ${last5.length} short-format match${last5.length === 1 ? '' : 'es'}`);
}

/**
 * Ranking and seeding gap (20). Seeds in this event are allocated by ranking
 * number, so the seed is the published, checkable expression of the ranking
 * gap and is what the scorer reads.
 */
export function scoreRankingGap(seedFor, seedAgainst, missing, { playerName = 'player' } = {}) {
  if (!Number.isFinite(seedFor) || !Number.isFinite(seedAgainst)) {
    missing.push(`${playerName}: ranking/seeding gap (an amateur entrant carries no seed number)`);
    return comp('ranking', 'Ranking and seeding gap (20 pts)', 0, 20, 'no seed number published for one player', { missing: true });
  }
  const gap = seedAgainst - seedFor; // positive = this player is the higher seed
  let points = 0;
  let band = 'gap favours the opponent';
  if (gap >= 30) { points = 20; band = 'wide gap in this player\'s favour'; }
  else if (gap >= 10) { points = 12; band = 'moderate gap in this player\'s favour'; }
  else if (gap > -10) { points = 5; band = 'closely seeded'; }
  return comp('ranking', 'Ranking and seeding gap (20 pts)', points, 20, band);
}

/** Head-to-head (20). No meaningful history scores the prompt's neutral 8. */
export function scoreHeadToHead(h2h) {
  const total = h2h?.total || 0;
  if (total === 0) {
    return comp('h2h', 'Head-to-head (20 pts)', 8, 20, 'no meaningful history — neutral default');
  }
  const recent = (h2h.meetings || []).slice(0, 3);
  const wins = recent.filter((m) => m.result === 'win').length;
  const losses = recent.filter((m) => m.result === 'loss').length;
  let points = 0;
  let band = 'trailing the head-to-head';
  if (wins >= 2) { points = 20; band = `won ${wins} of the last ${recent.length} meetings`; }
  else if (wins === losses) { points = 10; band = 'head-to-head split evenly'; }
  return comp('h2h', 'Head-to-head (20 pts)', points, 20, band);
}

/**
 * Break-building form (15). Measured from published highest breaks in the
 * player's earlier groups: a maximum or multiple tons = 15, occasional
 * century = 8, none = 0.
 */
export function scoreBreakBuilding(breaks, missing, { playerName = 'player' } = {}) {
  const list = (breaks || []).filter((b) => Number.isFinite(b));
  if (list.length === 0) {
    missing.push(`${playerName}: break-building form (no published highest break for an earlier group)`);
    return comp('breaks', 'Break-building form (15 pts)', 0, 15, 'no published highest break on record', { missing: true });
  }
  const maximums = list.filter((b) => b === 147).length;
  const centuries = list.filter((b) => b >= 100).length;
  let points = 0;
  let band = 'no century-level break on record';
  if (maximums > 0 || centuries >= 2) { points = 15; band = maximums > 0 ? 'a maximum on record' : 'centuries in more than one group'; }
  else if (centuries === 1) { points = 8; band = 'an occasional century'; }
  return comp('breaks', 'Break-building form (15 pts)', points, 15, band);
}

/**
 * Odds and value (15). Requires a measured price. No free key-less snooker
 * price feed exists, so on a live card this is always recorded missing.
 */
export function scoreOddsValue(americanOdds, missing) {
  if (!Number.isFinite(americanOdds)) {
    missing.push('odds and value (no free, key-less snooker price feed exists; OLBG publishes tipster percentages, never prices)');
    return comp('odds', 'Odds and value (15 pts)', 0, 15, 'no verified price available', { missing: true });
  }
  let points = 0;
  let band = 'no priced edge';
  if (americanOdds <= -300) { points = 15; band = '-300 or lower'; }
  else if (americanOdds <= -200) { points = 11; band = '-200 to -299'; }
  else if (americanOdds <= -150) { points = 7; band = '-150 to -199'; }
  else if (americanOdds <= -100) { points = 4; band = '-100 to -149'; }
  return comp('odds', 'Odds and value (15 pts)', points, 15, band);
}

/** Score one side of a match result. */
export function scoreSide(side, missing) {
  const components = [
    scoreShortFormatForm(side.profile, missing),
    scoreRankingGap(side.seed, side.opponentSeed, missing, { playerName: side.name }),
    scoreHeadToHead(side.h2h),
    scoreBreakBuilding(side.breaks, missing, { playerName: side.name }),
    scoreOddsValue(side.odds, missing),
  ];
  const total = components.reduce((s, c) => s + c.points, 0);
  return { name: side.name, components, total };
}

/**
 * MATCH RESULT for one fixture. Assesses both players and, in the ranking
 * edition, the draw as an outcome in its own right.
 */
export function scoreMatchResult(fixture) {
  const edition = editionFor(fixture.edition);
  const missing = [];
  const a = scoreSide({ ...fixture.a, opponentSeed: fixture.b.seed }, missing);
  const b = scoreSide({ ...fixture.b, opponentSeed: fixture.a.seed }, missing);

  const spread = Math.abs(a.total - b.total);
  const h2hNeutral = (fixture.a.h2h?.total || 0) === 0
    || Math.abs((fixture.a.h2h?.meetings || []).filter((m) => m.result === 'win').length
      - (fixture.a.h2h?.meetings || []).filter((m) => m.result === 'loss').length) === 0;

  const drawTriggered = edition.drawPossible && spread <= RULES.drawModifier.within && h2hNeutral;

  const leader = a.total >= b.total ? a : b;
  const trailer = leader === a ? b : a;

  let selection;
  let score;
  if (drawTriggered) {
    selection = { type: 'draw', label: 'Draw (2-2)' };
    // The draw's own strength: how evenly the two sides scored, lifted by the
    // closeness itself. It cannot exceed the leader's score.
    score = Math.round(Math.min(leader.total, (a.total + b.total) / 2 + (RULES.drawModifier.within - spread)));
  } else {
    selection = { type: 'player', label: leader.name, name: leader.name };
    score = leader.total;
  }

  const aligned = leader.components.filter((c) => !c.missing && c.points > 0).length;
  let band;
  if (score >= RULES.matchResult.high) band = CONFIDENCE.HIGH;
  else if (score >= RULES.matchResult.mediumMin && aligned >= RULES.matchResult.mediumFactors) band = CONFIDENCE.MEDIUM;
  else band = CONFIDENCE.SKIP;

  return {
    market: 'MATCH RESULT',
    edition: edition.id,
    selection,
    score,
    confidence: band,
    skip: band === CONFIDENCE.SKIP,
    drawTriggered,
    spread,
    sides: { a, b },
    leader: leader.name,
    trailer: trailer.name,
    alignedFactors: aligned,
    missing: [...new Set(missing)],
  };
}

/* ------------------------------------------------------------------ *
 * CORRECT SCORE — 100 pts
 * ------------------------------------------------------------------ */

export function scoreCorrectScore(fixture, matchResult) {
  const edition = editionFor(fixture.edition);
  const missing = [];
  const components = [];

  // 1. Match Result Alignment (40).
  const strong = matchResult.score >= RULES.matchResult.high;
  const close = matchResult.drawTriggered || matchResult.spread <= 12;
  let lean;
  let alignPts;
  if (close) { lean = edition.closeScoreline; alignPts = 30; }
  else if (strong) { lean = '3-0'; alignPts = 40; }
  else { lean = '3-1'; alignPts = 30; }
  components.push(comp('align', 'Match result alignment (40 pts)', alignPts, 40,
    close ? 'the pairing scores close enough to point at the tight scoreline' : `the match-result read points at ${lean}`));

  // 2. Historical scoreline tendency (30) — from this player's earlier
  //    short-format results in the tape.
  const hist = fixture.scorelineHistory || [];
  if (hist.length === 0) {
    missing.push('historical scoreline tendency (no earlier short-format matches for either player in the tape)');
    components.push(comp('history', 'Historical scoreline tendency (30 pts)', 0, 30, 'no earlier short-format scorelines on record', { missing: true }));
  } else {
    const counts = new Map();
    for (const s of hist) counts.set(s, (counts.get(s) || 0) + 1);
    const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
    const share = best[1] / hist.length;
    let pts = 10;
    if (best[0] === lean && share >= 0.5) pts = 30;
    else if (best[0] === lean) pts = 20;
    else if (share < 0.4) pts = 15;
    components.push(comp('history', 'Historical scoreline tendency (30 pts)', pts, 30,
      `${best[0]} is the most frequent earlier margin for this pairing's players`));
  }

  // 3. Decisiveness of recent matches (20).
  const recent = fixture.recentMargins || [];
  if (recent.length === 0) {
    missing.push('decisiveness of recent matches (no earlier completed matches in the tape)');
    components.push(comp('decisive', 'Decisiveness of recent matches (20 pts)', 0, 20, 'no earlier completed matches on record', { missing: true }));
  } else {
    const maxMargin = recent.filter((m) => m === 3).length / recent.length;
    const wentDistance = recent.filter((m) => m <= 1).length / recent.length;
    let pts = 8;
    let detail = 'recent margins are mixed';
    if (lean === '3-0' && maxMargin >= 0.4) { pts = 20; detail = 'recent matches have often finished by the maximum margin'; }
    else if (lean !== '3-0' && wentDistance >= 0.4) { pts = 20; detail = 'recent matches have regularly gone the distance'; }
    components.push(comp('decisive', 'Decisiveness of recent matches (20 pts)', pts, 20, detail));
  }

  // 4. Confidence ceiling (10). The outcome set here is small and tractable,
  //    but the ceiling is only awarded on a clearly supported read.
  const supported = components.filter((c) => !c.missing).length >= 3 && alignedStrong(components);
  components.push(comp('ceiling', 'Confidence ceiling (10 pts)', supported ? 10 : 4, 10,
    supported ? 'a small, tractable outcome set with a clearly supported read' : 'the read is not clear enough for the full ceiling'));

  const score = components.reduce((s, c) => s + c.points, 0);
  let band;
  if (score >= RULES.correctScore.high) band = CONFIDENCE.HIGH;
  else if (score >= RULES.correctScore.mediumMin) band = CONFIDENCE.MEDIUM;
  else band = CONFIDENCE.SKIP;

  return {
    market: 'CORRECT SCORE',
    edition: edition.id,
    selection: { type: 'scoreline', label: lean, scoreline: lean, favouring: matchResult.selection.type === 'player' ? matchResult.selection.name : null },
    outcomeSet: edition.scorelines,
    score,
    confidence: band,
    skip: band === CONFIDENCE.SKIP,
    components,
    missing: [...new Set(missing)],
  };
}

function alignedStrong(components) {
  const align = components.find((c) => c.id === 'align');
  return Boolean(align && align.points >= 30);
}

/* ------------------------------------------------------------------ *
 * GROUP WINNER — 100 pts
 * ------------------------------------------------------------------ */

export function scoreGroupWinner(group) {
  const edition = editionFor(group.edition);
  const missing = [];
  const players = group.players || [];
  if (players.length < 3) {
    return {
      market: 'GROUP WINNER',
      edition: edition.id,
      selection: null,
      tooOpen: true,
      reason: 'the group has too few sourced players to assess',
      score: 0,
      confidence: CONFIDENCE.SKIP,
      skip: true,
      candidates: [],
      missing: ['group composition'],
    };
  }

  // Rank the field on combined seeding and short-format form.
  const strengthOf = (p) => {
    const seedScore = Number.isFinite(p.seed) ? Math.max(0, 130 - p.seed) : 0;
    const last5 = (p.profile?.last5 || []).slice(0, 5);
    const formScore = last5.length ? (last5.filter((m) => m.result === 'win').length / last5.length) * 100 : 0;
    return seedScore + formScore;
  };
  const order = [...players].sort((x, y) => strengthOf(y) - strengthOf(x));
  // Players level on the sourced strength measure share a rank, so sort order
  // alone can never manufacture a gap between indistinguishable candidates.
  const rankOf = new Map();
  order.forEach((p, i) => {
    const tied = order.findIndex((o) => strengthOf(o) === strengthOf(p));
    rankOf.set(p.name, tied === -1 ? i : tied);
  });

  const candidates = players.map((p) => {
    const components = [];
    const idx = rankOf.get(p.name);
    let strengthPts = 0;
    if (idx === 0) strengthPts = 35;
    else if (idx === 1) strengthPts = 20;
    else if (idx < players.length - 1) strengthPts = 10;
    components.push(comp('strength', 'Overall group strength (35 pts)', strengthPts, 35,
      idx === 0 ? 'strongest in the group on combined seeding and short-format form'
        : idx === 1 ? 'second strongest by the same measure'
          : idx < players.length - 1 ? 'mid-pack in the group' : 'weakest in the group on the sourced measures'));

    // H2H advantage within this specific group.
    const wins = (p.groupH2H || []).filter((r) => r.result === 'win').length;
    const losses = (p.groupH2H || []).filter((r) => r.result === 'loss').length;
    if (!p.groupH2H || p.groupH2H.length === 0) {
      missing.push(`${p.name}: head-to-head inside this group (no earlier meetings with these opponents in the tape)`);
      components.push(comp('groupH2H', 'Head-to-head advantage within the group (25 pts)', 0, 25,
        'no earlier meetings with these opponents on record', { missing: true }));
    } else {
      let pts = 12;
      let detail = 'a mixed record against this group';
      if (wins >= 2) { pts = 25; detail = 'a winning record against at least two of these opponents'; }
      else if (losses >= 2) { pts = 0; detail = 'a losing record against at least two of these opponents'; }
      components.push(comp('groupH2H', 'Head-to-head advantage within the group (25 pts)', pts, 25, detail));
    }

    // Projected points path — outright wins are worth three times a draw.
    const last5 = (p.profile?.last5 || []).slice(0, 5);
    if (last5.length === 0) {
      missing.push(`${p.name}: projected points path (no earlier short-format matches in the tape)`);
      components.push(comp('path', 'Projected points path (25 pts)', 0, 25, 'no earlier short-format record on which to project a points path', { missing: true }));
    } else {
      const winRate = last5.filter((m) => m.result === 'win').length / last5.length;
      const drawRate = last5.filter((m) => m.result === 'draw').length / last5.length;
      let pts = 10;
      let detail = 'the projected path leans on draws, which build points slowly';
      if (winRate >= 0.5 && winRate > drawRate) { pts = 25; detail = 'projects to win matches outright rather than draw them'; }
      components.push(comp('path', 'Projected points path (25 pts)', pts, 25, detail));
    }

    // Break-building ceiling.
    const breaks = (p.breaks || []).filter((b) => Number.isFinite(b));
    if (breaks.length === 0) {
      missing.push(`${p.name}: break-building ceiling (no published highest break on record)`);
      components.push(comp('ceiling', 'Break-building ceiling (15 pts)', 0, 15, 'no published highest break on record', { missing: true }));
    } else {
      const top = Math.max(...breaks);
      const pts = top >= 100 ? 15 : 5;
      components.push(comp('ceiling', 'Break-building ceiling (15 pts)', pts, 15,
        top >= 100 ? 'carries a decisive break that can turn a close group quickly' : 'a grinder without that weapon in this field'));
    }

    const total = components.reduce((s, c) => s + c.points, 0);
    return { name: p.name, seed: p.seed ?? null, components, total };
  }).sort((x, y) => y.total - x.total);

  const [top, next] = candidates;
  const clearBy = next ? top.total - next.total : top.total;
  if (clearBy < RULES.groupWinner.clearBy) {
    return {
      market: 'GROUP WINNER',
      edition: edition.id,
      group: group.label,
      selection: null,
      tooOpen: true,
      reason: `the leading candidate is only ${clearBy} points clear of the next, inside the fifteen-point rule`,
      score: top.total,
      clearBy,
      confidence: CONFIDENCE.SKIP,
      skip: true,
      candidates,
      missing: [...new Set(missing)],
    };
  }
  let band;
  if (top.total >= RULES.groupWinner.high) band = CONFIDENCE.HIGH;
  else if (top.total >= RULES.groupWinner.mediumMin) band = CONFIDENCE.MEDIUM;
  else band = CONFIDENCE.SKIP;

  return {
    market: 'GROUP WINNER',
    edition: edition.id,
    group: group.label,
    selection: { type: 'player', label: top.name, name: top.name },
    tooOpen: false,
    score: top.total,
    clearBy,
    confidence: band,
    skip: band === CONFIDENCE.SKIP,
    candidates,
    missing: [...new Set(missing)],
  };
}

/** Value candidate: an underdog with a live form or head-to-head case. */
export function flagValueCandidate(matchResult) {
  if (matchResult.selection.type !== 'player') return null;
  const { a, b } = matchResult.sides;
  const pickIsA = matchResult.selection.name === a.name;
  const pick = pickIsA ? a : b;
  const other = pickIsA ? b : a;
  const pickSeed = pick.components.find((c) => c.id === 'ranking');
  const otherSeed = other.components.find((c) => c.id === 'ranking');
  const underdog = pickSeed && otherSeed && pickSeed.points < otherSeed.points;
  if (!underdog) return null;
  const form = pick.components.find((c) => c.id === 'form');
  const h2h = pick.components.find((c) => c.id === 'h2h');
  const live = (form && form.points >= 20) || (h2h && h2h.points >= 20);
  if (!live) return null;
  return {
    name: pick.name,
    basis: form && form.points >= 20 ? 'recent short-format form' : 'the head-to-head record',
  };
}
