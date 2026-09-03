/**
 * SportsPred — T20 Blast (Vitality Blast) context builders.
 *
 * Everything here is derived from the committed, verified tape in
 * data/t20_blast_matches.json. The module is pure: no I/O, no clock, no
 * randomness. Every function that looks backwards takes an explicit `dateISO`
 * and reads only fixtures strictly before it, so the backtest in
 * scripts/backtest_t20_blast.mjs cannot see a result it should not know.
 *
 * HONESTY RULES ENCODED HERE
 *  - A county's form and head-to-head are built from the fixtures the tape
 *    actually captured. The tape holds the 88 in-group fixtures it verified;
 *    the 18 cross-pool fixtures are not itemised (see the tape's `gaps`).
 *    Every derived value therefore carries `sample_basis` saying so.
 *  - Ties are recorded as 'T' and never counted as a win or a loss.
 *  - Net run rate is a season-end published figure. It is never used as a
 *    walk-forward signal, because on the day it would be look-ahead bias.
 *    It is returned only for display, tagged `look_ahead: true`.
 *  - A points deduction is applied exactly as the official table applies it,
 *    and `performancePoints` restores the pre-deduction figure so the prompt's
 *    "read group standing as adjusted performance" rule is mechanical.
 */

export const BLAST_POINTS = { win: 4, tie: 2, no_result: 2, loss: 0 };

/** Results strictly before `dateISO`, oldest first. */
export function resultsBefore(matches, dateISO) {
  return (matches || [])
    .filter((m) => m.date && dateISO && m.date < dateISO)
    .filter((m) => m.winner_slug || m.result_type === 'tie' || m.result_type === 'noresult')
    .sort((a, b) => a.date.localeCompare(b.date));
}

function outcomeFor(slug, m) {
  if (m.result_type === 'tie') return 'T';
  if (m.result_type === 'noresult') return 'N';
  if (m.winner_slug === slug) return 'W';
  return 'L';
}

/**
 * Last-5 form for one county, most recent first.
 * `streak` counts consecutive wins ending at the most recent fixture.
 */
export function formFor(slug, matches, dateISO, n = 5) {
  const prior = resultsBefore(matches, dateISO).filter((m) => m.home_slug === slug || m.away_slug === slug);
  const last = prior.slice(-n).reverse().map((m) => outcomeFor(slug, m));
  const wins = last.filter((r) => r === 'W').length;
  const losses = last.filter((r) => r === 'L').length;
  let streak = 0;
  for (const r of last) { if (r === 'W') streak += 1; else break; }
  let losingStreak = 0;
  for (const r of last) { if (r === 'L') losingStreak += 1; else break; }
  return {
    slug,
    last5: last,
    wins,
    losses,
    played: prior.length,
    sample: Math.min(n, prior.length),
    winStreak: streak,
    losingStreak,
    winRate: prior.length ? prior.filter((m) => outcomeFor(slug, m) === 'W').length / prior.length : null,
    sample_basis: 'in-group and captured cross-pool fixtures only; the tape does not itemise every cross-pool fixture',
  };
}

/** Head-to-head between two counties from captured fixtures before `dateISO`. */
export function h2h(slugA, slugB, matches, dateISO) {
  const prior = resultsBefore(matches, dateISO)
    .filter((m) => (m.home_slug === slugA && m.away_slug === slugB) || (m.home_slug === slugB && m.away_slug === slugA))
    .sort((a, b) => b.date.localeCompare(a.date));
  const outcomes = prior.map((m) => outcomeFor(slugA, m));
  const decided = outcomes.filter((o) => o === 'W' || o === 'L');
  const wins = decided.filter((o) => o === 'W').length;
  // The prompt: weight the most recent three meetings double.
  const recent = outcomes.slice(0, 3);
  const weightedWins = wins + recent.filter((o) => o === 'W').length;
  const weightedTotal = decided.length + recent.filter((o) => o === 'W' || o === 'L').length;
  return {
    totalMeetings: decided.length,
    teamWins: wins,
    oppositionWins: decided.length - wins,
    ties: outcomes.filter((o) => o === 'T').length,
    recentMeetings: outcomes.slice(0, 3),
    weightedWinRate: weightedTotal ? weightedWins / weightedTotal : null,
    sweptLastThree: recent.length >= 3 && recent.slice(0, 3).every((o) => o === 'W'),
    sample_basis: 'captured fixtures in this competition only; a three-year span needs a longer tape (TB-IR-05)',
  };
}

/**
 * Walk-forward group table built from captured results.
 * Returns official-style points plus `performancePoints` (deduction restored).
 */
/** Stages that count toward a league table. Knockouts are excluded. */
export const LEAGUE_STAGES = ['group', 'cross'];

/**
 * The competition table as it stood before `dateISO`.
 *
 * Only league-stage fixtures are counted. A quarter-final win is not four
 * league points and does not belong in a group table; including it inflates a
 * county's season-strength component precisely when that component is being
 * used to score the knockout it came from. Qualification, and the table the
 * competition itself publishes, are both league-stage artefacts.
 */
export function tableAt(matches, dateISO, { deductions = {}, groups = {}, stages = LEAGUE_STAGES } = {}) {
  const acc = new Map();
  const ensure = (slug) => {
    if (!acc.has(slug)) acc.set(slug, { slug, played: 0, won: 0, lost: 0, tied: 0, no_result: 0, points: 0 });
    return acc.get(slug);
  };
  for (const m of resultsBefore(matches, dateISO).filter((r) => !r.stage || stages.includes(r.stage))) {
    const h = ensure(m.home_slug);
    const a = ensure(m.away_slug);
    h.played += 1; a.played += 1;
    if (m.result_type === 'tie') { h.tied += 1; a.tied += 1; h.points += BLAST_POINTS.tie; a.points += BLAST_POINTS.tie; }
    else if (m.result_type === 'noresult') { h.no_result += 1; a.no_result += 1; h.points += BLAST_POINTS.no_result; a.points += BLAST_POINTS.no_result; }
    else {
      const w = ensure(m.winner_slug);
      const l = m.winner_slug === m.home_slug ? a : h;
      w.won += 1; l.lost += 1; w.points += BLAST_POINTS.win;
    }
  }
  const rows = [...acc.values()].map((r) => {
    const ded = deductions[r.slug] || 0;
    return {
      ...r,
      group: groups[r.slug] || null,
      points_deduction: ded,
      points: r.points - ded,
      performancePoints: r.points,
      pointsRate: r.played ? r.points / (r.played * BLAST_POINTS.win) : null,
      performanceRate: r.played ? r.points / (r.played * BLAST_POINTS.win) : null,
    };
  });
  const out = new Map();
  for (const r of rows) {
    const g = r.group || 'Ungrouped';
    if (!out.has(g)) out.set(g, []);
    out.get(g).push(r);
  }
  for (const list of out.values()) {
    list.sort((x, y) => (y.performancePoints - x.performancePoints) || (y.won - x.won) || x.slug.localeCompare(y.slug));
    list.forEach((r, i) => { r.position = i + 1; });
  }
  return out;
}

/**
 * League-measured home advantage: the home-win rate across captured fixtures
 * before `dateISO`. No constant is assumed anywhere — this is measured.
 */
export function homeWinRate(matches, dateISO) {
  const prior = resultsBefore(matches, dateISO).filter((m) => !m.neutral);
  const decided = prior.filter((m) => m.winner_slug);
  const homeWins = decided.filter((m) => m.winner_slug === m.home_slug).length;
  return {
    total: decided.length,
    homeWins,
    awayWins: decided.length - homeWins,
    ties: prior.filter((m) => m.result_type === 'tie').length,
    rate: decided.length ? homeWins / decided.length : null,
    sufficient: decided.length >= 10,
  };
}

/** Days since the county's previous captured fixture, and a congestion label. */
export function restFor(slug, matches, dateISO) {
  const prior = resultsBefore(matches, dateISO).filter((m) => m.home_slug === slug || m.away_slug === slug);
  const last = prior[prior.length - 1];
  if (!last) return { days: null, previous_date: null, congestion: 'unknown', note: 'no earlier captured fixture' };
  const days = Math.round((Date.parse(`${dateISO}T12:00:00Z`) - Date.parse(`${last.date}T12:00:00Z`)) / 86400000);
  const congestion = days <= 1 ? 'back-to-back' : days <= 3 ? 'three-day turnaround' : days <= 5 ? 'short turnaround' : 'normal';
  return { days, previous_date: last.date, congestion, note: null };
}

/**
 * Margin profile from result strings the source printed.
 * Runs-margins and wickets-margins are kept apart: they are not comparable.
 */
export function marginProfile(slug, matches, dateISO) {
  const prior = resultsBefore(matches, dateISO).filter((m) => m.home_slug === slug || m.away_slug === slug);
  const winRuns = []; const winWkts = []; const lossRuns = []; const lossWkts = [];
  for (const m of prior) {
    const won = m.winner_slug === slug;
    if (m.result_type === 'runs') (won ? winRuns : lossRuns).push(m.margin);
    else if (m.result_type === 'wickets') (won ? winWkts : lossWkts).push(m.margin);
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return {
    played: prior.length,
    avg_win_margin_runs: mean(winRuns),
    avg_win_margin_wickets: mean(winWkts),
    avg_loss_margin_runs: mean(lossRuns),
    avg_loss_margin_wickets: mean(lossWkts),
    decisive_wins: winRuns.filter((r) => r >= 40).length + winWkts.filter((w) => w >= 6).length,
    narrow_losses: lossRuns.filter((r) => r <= 15).length + lossWkts.filter((w) => w <= 2).length,
    sample_basis: 'margins as printed by the source; runs and wickets are never averaged together',
  };
}

/** Everything the engine needs for one fixture, built from prior fixtures only. */
export function contextFor(row, matchesDoc, { deductions = {}, groupOf = {} } = {}) {
  const matches = matchesDoc?.matches || matchesDoc || [];
  const date = row.date;
  const build = (slug) => ({
    slug,
    form: formFor(slug, matches, date),
    margin: marginProfile(slug, matches, date),
    rest: restFor(slug, matches, date),
  });
  const home = build(row.home_slug);
  const away = build(row.away_slug);
  home.h2h = h2h(row.home_slug, row.away_slug, matches, date);
  away.h2h = h2h(row.away_slug, row.home_slug, matches, date);
  const table = tableAt(matches, date, { deductions, groups: groupOf });
  const findRow = (slug) => {
    for (const list of table.values()) {
      const hit = list.find((r) => r.slug === slug);
      if (hit) return hit;
    }
    return null;
  };
  home.table = findRow(row.home_slug);
  away.table = findRow(row.away_slug);
  return {
    date,
    home,
    away,
    league: {
      home_advantage: homeWinRate(matches, date),
      fixtures_before: resultsBefore(matches, date).length,
    },
    fixture: {
      stage: row.stage,
      group: row.group,
      cross_pool: row.stage === 'cross',
      neutral: !!row.neutral,
      dl_method: !!row.dl_method,
    },
  };
}

/** Deduction map and group map from the committed competition/standings docs. */
export function deductionMap(standingsDoc) {
  const out = {};
  for (const list of Object.values(standingsDoc?.groups || {})) {
    for (const r of list) if (r.points_deduction) out[r.slug] = r.points_deduction;
  }
  return out;
}

export function groupMap(standingsDoc) {
  const out = {};
  for (const [group, list] of Object.entries(standingsDoc?.groups || {})) {
    for (const r of list) out[r.slug] = group;
  }
  return out;
}
