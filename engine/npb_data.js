/**
 * SportsPred — NPB data layer: joins the sourced documents into the shape
 * `npb_engine.js` consumes, and runs the leak-free walk-forward backtest.
 *
 * THE ONE RULE: this file never fills a gap. If a document does not carry a
 * value the field stays null, the engine records it in `missing[]`, and the
 * confidence gates in Step 3 apply. There is no default anywhere in here.
 *
 * Documents (built by scripts/collect_npb.mjs in CI, or by
 * scripts/build_npb_seed.mjs from the captured pages under tests/fixtures):
 *   data/npb_fixtures.json   schedule rows: venue, roof, forecast, announced starters
 *   data/npb_tape.json       every regular-season result (incl. draws, postponements)
 *   data/npb_standings.json  both league tables with ties and per-opponent records
 *   data/npb_pitchers.json   per-game pitching lines from the Japanese box scores
 *   data/npb_provenance.json source register + irregularities
 *   data/npb_predictions.json forward ledger
 *   data/npb_backtest.json   walk-forward report
 */

import { scoreNpbCard, scoreNpbMatch } from './npb_engine.js';
import { writeNpbCard } from './npb_writer.js';
import { NPB_TEAMS, teamByCode, leagueOf, dhStatus, roofFor } from './npb_source.js';

const DAY = 86400000;
const round = (n, dp = 3) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const ms = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getTime();

/** Hyperparameters (all documented in docs/NPB_PROMPT_REVIEW.md). */
export const WINDOW_DAYS = 30;           // "last month" for run differential / runs per game
export const H2H_CLOSE_MAX_TOTAL = 7;    // "low-scoring" = 7 or fewer combined runs
export const H2H_CLOSE_MAX_MARGIN = 1;   // "close" = decided by 1 run or drawn
export const H2H_CLOSE_MIN = 3;          // ≥3 of the last 5 same-league meetings
export const SHORT_REST_DAYS = 5;        // NPB staffs run six-man rotations; <5 days is short
export const BULLPEN_EFFECTIVE_RA9 = 3.5; // relief runs per 9 over the window
export const BULLPEN_FATIGUE_DAYS = 3;   // prompt: "over the last three days"
export const BULLPEN_FATIGUE_APPEARANCES = 3; // a reliever used on all 3 days, or ≥8 relief appearances in 3 days

/* ------------------------------------------------------------------ *
 * Tape helpers (all filtered to games strictly BEFORE the reference date)
 * ------------------------------------------------------------------ */
export function gamesBefore(tape, dateISO) {
  const cut = ms(dateISO);
  return (tape || []).filter((g) => !g.postponed && g.homeScore != null && ms(g.dateISO) < cut)
    .sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0));
}

function teamGames(games, code) {
  return games.filter((g) => g.home === code || g.away === code);
}

function perspective(g, code) {
  const isHome = g.home === code;
  const gf = isHome ? g.homeScore : g.awayScore;
  const ga = isHome ? g.awayScore : g.homeScore;
  return { gf, ga, result: gf > ga ? 'W' : gf < ga ? 'L' : 'D', margin: gf - ga, opponent: isHome ? g.away : g.home, isHome };
}

export function teamFactors(tape, code, dateISO) {
  const games = teamGames(gamesBefore(tape, dateISO), code);
  if (!games.length) return null;
  const persp = games.map((g) => ({ ...perspective(g, code), dateISO: g.dateISO, url: g.url }));
  const last5 = persp.slice(0, 5).map((p) => p.result);
  let winStreak = 0; for (const p of persp) { if (p.result === 'W') winStreak += 1; else break; }
  const cut = ms(dateISO) - WINDOW_DAYS * DAY;
  const month = persp.filter((p) => ms(p.dateISO) >= cut);
  const runDiffPerGame = month.length ? round(month.reduce((a, p) => a + p.margin, 0) / month.length) : null;
  const runsPerGameRecent = month.length ? round(month.reduce((a, p) => a + p.gf, 0) / month.length) : null;
  const runsAgainstPerGameRecent = month.length ? round(month.reduce((a, p) => a + p.ga, 0) / month.length) : null;
  const wins = persp.filter((p) => p.result === 'W');
  const last5Wins = wins.slice(0, 5);
  const avgWinMarginLast5Wins = last5Wins.length ? round(last5Wins.reduce((a, p) => a + p.margin, 0) / last5Wins.length, 2) : null;
  const seasonW = wins.length; const seasonL = persp.filter((p) => p.result === 'L').length; const seasonD = persp.filter((p) => p.result === 'D').length;
  return {
    form: { last5: last5.length === 5 ? last5 : last5, winStreak, sample: persp.length, monthGames: month.length },
    runDiffPerGame, runsPerGameRecent, runsAgainstPerGameRecent, avgWinMarginLast5Wins,
    tapeRecord: { wins: seasonW, losses: seasonL, ties: seasonD, games: persp.length },
    tapeDrawRate: persp.length ? round(seasonD / persp.length, 4) : null,
    lastGameDate: persp[0]?.dateISO ?? null,
    recent: persp.slice(0, 10).map((p) => ({ dateISO: p.dateISO, opponent: p.opponent, result: p.result, score: `${p.gf}-${p.ga}`, url: p.url })),
  };
}

export function headToHead(tape, home, away, dateISO) {
  const games = gamesBefore(tape, dateISO).filter((g) => (g.home === home && g.away === away) || (g.home === away && g.away === home));
  if (!games.length) return null;
  const league = leagueOf(home, away);
  const rec = (list) => {
    let winsA = 0; let winsB = 0; let draws = 0;
    for (const g of list) { const p = perspective(g, home); if (p.result === 'W') winsA += 1; else if (p.result === 'L') winsB += 1; else draws += 1; }
    return { meetings: list.length, winsA, winsB, draws };
  };
  const last10 = games.slice(0, 10);
  const r10 = rec(last10);
  const last5 = games.slice(0, 5);
  const close = last5.filter((g) => Math.abs(g.homeScore - g.awayScore) <= H2H_CLOSE_MAX_MARGIN && (g.homeScore + g.awayScore) <= H2H_CLOSE_MAX_TOTAL).length;
  const block = {
    ...rec(games), last10WinsA: r10.winsA, last10WinsB: r10.winsB, last10Draws: r10.draws,
    window: `${games[games.length - 1].dateISO} → ${games[0].dateISO} (current season tape only)`,
    recentClose: { qualifies: close >= H2H_CLOSE_MIN, count: close, of: last5.length, detail: `${close} of the last ${last5.length} meetings decided by ${H2H_CLOSE_MAX_MARGIN} run or drawn with ${H2H_CLOSE_MAX_TOTAL} or fewer combined runs` },
    games: games.slice(0, 10).map((g) => ({ dateISO: g.dateISO, home: g.home, away: g.away, score: `${g.homeScore}-${g.awayScore}`, url: g.url })),
  };
  return league === 'interleague' ? { sameLeague: null, interleague: block } : { sameLeague: block, interleague: null };
}

/* ------------------------------------------------------------------ *
 * Pitching lines → starter profile and bullpen state
 * pitchersDoc.lines: [{ dateISO, team, opponent, name, role, ip, r, er, pitches, bf, so, url }]
 * ------------------------------------------------------------------ */
export function starterProfile(pitchersDoc, teamCode, nameJa, dateISO, { confirmed = true } = {}) {
  const lines = (pitchersDoc?.lines || []).filter((l) => l.team === teamCode && l.name === nameJa && l.role === 'starter' && ms(l.dateISO) < ms(dateISO))
    .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  const last4 = lines.slice(0, 4).map((l) => ({ date: l.dateISO, ip: l.ip, er: l.er, runs: l.r, pitches: l.pitches, so: l.so, opponent: l.opponent, url: l.url }));
  const qs = (n) => last4.slice(0, n).filter((s) => s.ip >= 6 && s.er <= 3).length;
  const staffStarts = (pitchersDoc?.lines || []).filter((l) => l.team === teamCode && l.role === 'starter' && ms(l.dateISO) < ms(dateISO));
  const daysSince = last4[0] ? Math.round((ms(dateISO) - ms(last4[0].date)) / DAY) : null;
  return {
    name: nameJa, confirmed,
    last4,
    qualityStartsLast4: last4.length ? qs(4) : null,
    qualityStartsLast3: last4.length ? qs(3) : null,
    avgInningsPerStart: last4.length ? round(last4.reduce((a, s) => a + s.ip, 0) / last4.length, 2) : null,
    daysSinceLastStart: daysSince,
    shortRest: daysSince == null ? null : daysSince < SHORT_REST_DAYS,
    restDetail: daysSince == null ? null : `${daysSince} days since the last start (staff norm is a six-man rotation)`,
    pitchesLast2: last4.length >= 2 && last4[0].pitches >= 100 && last4[1].pitches >= 100,
    sourcedStarts: lines.length, staffStartsOnTape: staffStarts.length,
    source: last4.length ? 'npb-ja-box' : null,
  };
}

export function bullpenState(pitchersDoc, teamCode, dateISO) {
  const all = (pitchersDoc?.lines || []).filter((l) => l.team === teamCode && l.role === 'relief' && ms(l.dateISO) < ms(dateISO));
  if (!all.length) return null;
  const cut = ms(dateISO);
  const month = all.filter((l) => ms(l.dateISO) >= cut - WINDOW_DAYS * DAY);
  const ip = month.reduce((a, l) => a + (l.ip || 0), 0);
  const r = month.reduce((a, l) => a + (l.r || 0), 0);
  const ra9 = ip ? round((r / ip) * 9, 2) : null;
  const last3 = all.filter((l) => ms(l.dateISO) >= cut - BULLPEN_FATIGUE_DAYS * DAY);
  const byName = new Map();
  for (const l of last3) byName.set(l.name, (byName.get(l.name) || 0) + 1);
  const threeStraight = [...byName.values()].some((n) => n >= BULLPEN_FATIGUE_DAYS);
  const fatigued = threeStraight || last3.length >= BULLPEN_FATIGUE_APPEARANCES * 3 - 1;
  return {
    effective: ra9 == null ? null : ra9 <= BULLPEN_EFFECTIVE_RA9,
    fatigued,
    ra9, reliefInningsWindow: round(ip, 1), reliefAppearancesLast3Days: last3.length, reliefUsedThreeStraight: threeStraight,
    detail: `relief runs per nine ${ra9 ?? 'n/a'} over ${WINDOW_DAYS} days; ${last3.length} relief appearances in the last ${BULLPEN_FATIGUE_DAYS} days${threeStraight ? ' (a reliever used on three straight days)' : ''}`,
    sample: month.length,
  };
}

/* ------------------------------------------------------------------ *
 * Standings helpers
 * ------------------------------------------------------------------ */
export function standingsFor(standingsDoc, code) {
  const t = teamByCode(code);
  if (!t) return null;
  const table = standingsDoc?.[t.league]?.teams || [];
  return table.find((x) => x.code === code) || null;
}

export function leagueDrawRate(standingsDoc, league) {
  const table = standingsDoc?.[league]?.teams || [];
  const g = table.reduce((a, t) => a + (t.games || 0), 0);
  const ties = table.reduce((a, t) => a + (t.ties || 0), 0);
  return g ? round(ties / g, 4) : null;
}

/** Draw rate from the tape (used in backtests where no dated standings exist). */
export function tapeLeagueDrawRate(tape, league, dateISO) {
  const games = gamesBefore(tape, dateISO).filter((g) => g.league === league);
  return games.length ? round(games.filter((g) => g.draw).length / games.length, 4) : null;
}

/* ------------------------------------------------------------------ *
 * Enrichment
 * ------------------------------------------------------------------ */
export function enrichNpbFixture(fixture, docs = {}, { asOf = null } = {}) {
  const tape = docs.tape?.games || [];
  const standings = docs.standings || null;
  const pitchers = docs.pitchers || null;
  const dateISO = asOf || fixture.dateISO;
  const league = fixture.league || leagueOf(fixture.home?.code, fixture.away?.code);
  const useStandings = standings && (!asOf || asOf === fixture.dateISO) && standings.asOfISO && ms(standings.asOfISO) <= ms(dateISO) ? standings : null;

  const buildSide = (raw, sideKey) => {
    const code = raw?.code;
    const t = teamByCode(code);
    const tf = teamFactors(tape, code, dateISO);
    const st = useStandings ? standingsFor(useStandings, code) : null;
    const spName = fixture.announcedStarters?.[sideKey] ?? null;
    const starter = spName ? starterProfile(pitchers, code, spName, dateISO, { confirmed: true }) : null;
    const bullpen = bullpenState(pitchers, code, dateISO);
    const record = st ? { wins: st.wins, losses: st.losses, ties: st.ties, pct: st.pct } : tf ? { ...tf.tapeRecord, pct: null } : null;
    return {
      code, name: t?.name ?? raw?.name ?? null, displayName: t?.name ?? raw?.name ?? null, short: t?.short ?? null, league: t?.league ?? null, logo: raw?.logo ?? null,
      record, recordSummary: record ? `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}` : null,
      form: tf?.form ?? null,
      runDiffPerGame: tf?.runDiffPerGame ?? null,
      runsPerGameRecent: tf?.runsPerGameRecent ?? null,
      runsAgainstPerGameRecent: tf?.runsAgainstPerGameRecent ?? null,
      avgWinMarginLast5Wins: tf?.avgWinMarginLast5Wins ?? null,
      drawRate: st?.drawRate ?? tf?.tapeDrawRate ?? null,
      drawCount: st?.ties ?? tf?.tapeRecord?.ties ?? null,
      homeRecord: st?.home ?? null, roadRecord: st?.road ?? null, interleagueRecord: st?.interleague ?? null, gamesBehind: st?.gamesBehind ?? null, rank: st?.rank ?? null,
      starter, bullpen,
      vsStarterHandednessAvg: null, // not published by npb.jp
      recentTotals: null,           // needs a posted total line; none is key-less
      odds: null,                   // no key-less three-way NPB price feed
      recent: tf?.recent ?? [],
      provenance: { tape: tf ? 'npb-calendar' : null, standings: st ? 'npb-standings' : null, starter: starter?.source ?? (spName ? 'npb-schedule-detail (announced, no sourced starts)' : null), bullpen: bullpen ? 'npb-ja-box' : null },
    };
  };

  const home = buildSide(fixture.home, 'home');
  const away = buildSide(fixture.away, 'away');
  const dh = dhStatus(fixture.season ?? Number(String(fixture.dateISO).slice(0, 4)), home.league, league);
  const roof = fixture.roof ?? roofFor(fixture.venue || '');

  return {
    ...fixture,
    league, leagueName: league === 'central' ? 'Central League' : league === 'pacific' ? 'Pacific League' : 'Interleague',
    dateISO: fixture.dateISO,
    roof, forecast: fixture.forecast ?? null, wind: null,
    dh,
    foreignPlayers: { limit: 4, rule: 'up to four registered on the active roster, no more than three pitchers or three position players', perTeam: null, note: 'per-game registrations are not published by npb.jp in a parseable feed' },
    leagueDrawRate: useStandings ? leagueDrawRate(useStandings, league === 'interleague' ? home.league : league) : tapeLeagueDrawRate(tape, league === 'interleague' ? home.league : league, dateISO),
    h2h: headToHead(tape, home.code, away.code, dateISO),
    home, away,
  };
}

export function buildNpbCard(docs, { dateISO = null, fixtures = null } = {}) {
  const list = fixtures || docs.fixtures?.fixtures || [];
  const selected = dateISO ? list.filter((f) => f.dateISO === dateISO) : list;
  const enriched = selected.map((f) => enrichNpbFixture(f, docs));
  return scoreAndWriteNpb(enriched, { dateISO });
}

export function scoreAndWriteNpb(enriched, { dateISO = null } = {}) {
  const scored = scoreNpbCard(enriched);
  const written = writeNpbCard(scored.results, { dateISO });
  return { date: dateISO, sport: 'Baseball', league: 'NPB', matches: enriched, scored, written };
}

/* ------------------------------------------------------------------ *
 * Walk-forward backtest
 *
 * For every settled tape game on or after `fromISO`, the fixture is rebuilt
 * from information dated strictly before the game (tape, box-score lines,
 * tape-derived draw rates). Announced starters are not archived by npb.jp,
 * so the actual starter from the box score stands in — NPB's 予告先発 is a
 * binding pre-game announcement and deviations are rare, but this is still
 * recorded as an approximation. Weather and standings snapshots are not
 * available historically and stay null (missing[]), exactly as they would
 * have on the day if unsourced.
 *
 * Grading: WIN — side won / draw occurred; RUN LINE — favourite won by ≥2
 * (−1.5) or underdog lost by ≤1 or better (+1.5); TOTAL — no posted line is
 * archived, so totals are reported as ungradeable rather than graded against
 * an invented number.
 * ------------------------------------------------------------------ */
export function runNpbBacktest(docs, { fromISO = null, toISO = null, limit = null } = {}) {
  const tape = (docs.tape?.games || []).filter((g) => !g.postponed && g.homeScore != null);
  const pitchers = docs.pitchers || null;
  let games = tape.filter((g) => (!fromISO || g.dateISO >= fromISO) && (!toISO || g.dateISO <= toISO)).sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
  if (limit) games = games.slice(-limit);
  const lineFor = (g, code) => (pitchers?.lines || []).find((l) => l.team === code && l.role === 'starter' && l.dateISO === g.dateISO && (l.opponent === (g.home === code ? g.away : g.home)));
  const rows = [];
  const bands = { HIGH: { n: 0, hits: 0 }, MEDIUM: { n: 0, hits: 0 }, LOW: { n: 0, hits: 0 } };
  const markets = { win: { n: 0, hits: 0, draws: { n: 0, hits: 0 } }, runLine: { n: 0, hits: 0 }, total: { n: 0, ungradeable: 0 } };
  const skipped = { win: 0, runLine: 0, total: 0 };
  for (const g of games) {
    const hs = lineFor(g, g.home); const as = lineFor(g, g.away);
    const fixture = {
      id: g.id, dateISO: g.dateISO, season: g.season, league: g.league,
      home: { code: g.home }, away: { code: g.away }, venue: null, roof: null, forecast: null,
      announcedStarters: hs && as ? { home: hs.name, away: as.name } : null,
    };
    const enriched = enrichNpbFixture(fixture, { tape: { games: tape }, pitchers, standings: null }, { asOf: g.dateISO });
    const r = scoreNpbMatch(enriched);
    if (r.unscored) continue;
    const margin = g.homeScore - g.awayScore;
    const actual = margin > 0 ? 'home' : margin < 0 ? 'away' : 'draw';
    const row = { id: g.id, dateISO: g.dateISO, home: g.home, away: g.away, score: `${g.homeScore}-${g.awayScore}`, actual, url: g.url, favourite: r.selection, drawScore: r.draw.score, winScore: r.winMatch.favourite.score, missing: r.missing.length };
    const wd = r.winMatch.decision;
    if (wd.confidence !== 'SKIP') {
      const pick = wd.outcome === 'draw' ? 'draw' : r.selection;
      const hit = pick === actual;
      row.win = { pick, confidence: wd.confidence, hit };
      markets.win.n += 1; if (hit) markets.win.hits += 1;
      if (pick === 'draw') { markets.win.draws.n += 1; if (hit) markets.win.draws.hits += 1; }
      bands[wd.confidence].n += 1; if (hit) bands[wd.confidence].hits += 1;
    } else skipped.win += 1;
    const rd = r.runLine.decision;
    if (rd.confidence !== 'SKIP') {
      const favMargin = r.selection === 'home' ? margin : -margin;
      const hit = rd.side === 'favourite' ? favMargin >= 2 : favMargin <= 1;
      row.runLine = { side: rd.side === 'favourite' ? r.selection : (r.selection === 'home' ? 'away' : 'home'), line: rd.side === 'favourite' ? '-1.5' : '+1.5', confidence: rd.confidence, hit };
      markets.runLine.n += 1; if (hit) markets.runLine.hits += 1;
      bands[rd.confidence].n += 1; if (hit) bands[rd.confidence].hits += 1;
    } else skipped.runLine += 1;
    const td = r.total.decision;
    if (td.confidence !== 'SKIP') { row.total = { side: td.side, confidence: td.confidence, graded: false, reason: 'no posted total line archived' }; markets.total.n += 1; markets.total.ungradeable += 1; } else skipped.total += 1;
    rows.push(row);
  }
  const rate = (o) => (o.n ? round(o.hits / o.n, 4) : null);
  const drawsOnTape = games.filter((g) => g.draw).length;
  return {
    method: 'walk-forward; every input dated strictly before the game; actual starter stands in for the pre-game announcement; weather and standings snapshots unavailable historically',
    range: games.length ? { from: games[0].dateISO, to: games[games.length - 1].dateISO } : null,
    games: games.length, drawsOnTape, drawRateOnTape: games.length ? round(drawsOnTape / games.length, 4) : null,
    markets: { win: { ...markets.win, hitRate: rate(markets.win), draws: { ...markets.win.draws, hitRate: rate(markets.win.draws) } }, runLine: { ...markets.runLine, hitRate: rate(markets.runLine) }, total: markets.total },
    bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, { ...v, hitRate: rate(v) }])),
    skipped,
    rows,
  };
}

export { NPB_TEAMS };
