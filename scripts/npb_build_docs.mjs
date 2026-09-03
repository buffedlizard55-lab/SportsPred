/**
 * SportsPred — NPB document builder (shared by the CI collector and the seed).
 *
 * Takes already-fetched page bodies (HTML from CI, or captured markdown
 * renderings from tests/fixtures/npb_*.CAPTURE.md) and produces the committed
 * documents. It never fetches and never fills a gap: a page that was not
 * supplied simply leaves its fields null, and the provenance block says so.
 */

import {
  parseCalendarMonth, parseStandings, parseScheduleDetail, parseJaBoxScore,
  NPB_TEAMS, NPB_BASE, teamByCode, leagueOf, roofFor, dhStatus,
} from '../engine/npb_source.js';
import { runNpbBacktest, buildNpbCard } from '../engine/npb_data.js';

const nowUtc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * @param {object} pages
 *   pages.calendars: [{ month, url, body, status, capturedAt, kind }]
 *   pages.standings: { central: {...page}, pacific: {...page} }
 *   pages.schedules: [{ month, url, body, ... }]
 *   pages.boxes:     [{ url, body, ... }]  Japanese box scores (scores/.../box.html)
 * @param {object} opts { season, todayISO, collector, mode: 'live'|'seed', notes: [] }
 */
export function buildNpbDocuments(pages, opts = {}) {
  const season = opts.season || 2026;
  const todayISO = opts.todayISO || new Date().toISOString().slice(0, 10);
  const collector = opts.collector || 'scripts/collect_npb.mjs';
  const mode = opts.mode || 'live';
  const irregularities = [...(opts.irregularities || [])];
  const endpoints = [];
  const rec = (p, extra = {}) => endpoints.push({ url: p.url, status: p.status ?? null, ok: p.ok ?? (p.status === 200), error: p.error ?? null, kind: p.kind || 'html', capturedAt: p.capturedAt || null, ...extra });

  /* ---- tape from calendars ---- */
  const games = new Map();
  const upcomingCal = new Map();
  for (const p of pages.calendars || []) {
    rec(p, { doc: 'tape' });
    if (!p.body) continue;
    const r = parseCalendarMonth(p.body, { season });
    for (const g of r.results) games.set(g.id, { ...g, sourceUrl: p.url });
    for (const u of r.upcoming) upcomingCal.set(u.id, u);
    for (const w of r.warnings) if (!/CL\/PL|PL\/CL/.test(w)) irregularities.push({ id: 'NPB-PARSE', severity: 'low', detail: `${p.url}: ${w}` });
  }
  const tapeGames = [...games.values()].sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : a.id < b.id ? -1 : 1));

  /* ---- standings ---- */
  const standings = { schema_version: 1, fetched_at_utc: nowUtc(), collector, mode, season, sport: 'Baseball', league: 'npb', asOf: null, asOfISO: null, central: null, pacific: null };
  for (const league of ['central', 'pacific']) {
    const p = pages.standings?.[league];
    if (!p) continue;
    rec(p, { doc: 'standings' });
    if (!p.body) continue;
    const r = parseStandings(p.body, league);
    standings[league] = { teams: r.teams, warnings: r.warnings, source: p.url, asOf: r.asOf || p.asOf || null };
    if (r.asOf || p.asOf) { standings.asOf = r.asOf || p.asOf; }
    if (p.asOfISO) standings.asOfISO = p.asOfISO;
    for (const w of r.warnings) irregularities.push({ id: 'NPB-STANDINGS', severity: 'medium', detail: `${p.url}: ${w}` });
  }
  if (!standings.asOfISO && standings.asOf) {
    const d = new Date(standings.asOf);
    if (!Number.isNaN(d.getTime())) standings.asOfISO = d.toISOString().slice(0, 10);
  }

  /* ---- schedule detail (starters, weather, venue, JA score links) ---- */
  const schedRows = [];
  for (const p of pages.schedules || []) {
    rec(p, { doc: 'fixtures' });
    if (!p.body) continue;
    const r = parseScheduleDetail(p.body, { season });
    schedRows.push(...r.rows.map((x) => ({ ...x, sourceUrl: p.url })));
    for (const w of r.warnings) if (!w.startsWith('reserve day')) irregularities.push({ id: 'NPB-PARSE', severity: 'low', detail: `${p.url}: ${w}` });
  }
  const schedKey = (d, h, a) => `${d}|${h}|${a}`;
  const schedIndex = new Map(schedRows.map((r) => [schedKey(r.dateISO, r.home, r.away), r]));

  /* ---- Japanese box scores → pitching lines ---- */
  const lines = [];
  const boxes = [];
  for (const p of pages.boxes || []) {
    rec(p, { doc: 'pitchers' });
    if (!p.body) continue;
    const b = parseJaBoxScore(p.body, { url: p.url });
    if (b.warnings.length) for (const w of b.warnings) irregularities.push({ id: 'NPB-BOX', severity: 'low', detail: `${p.url}: ${w}` });
    if (!b.home || !b.away || !b.dateISO) continue;
    boxes.push({ url: p.url, dateISO: b.dateISO, home: b.home, away: b.away, homeScore: b.homeScore, awayScore: b.awayScore, innings: b.innings, status: b.status, attendance: b.attendance, duration: b.duration, venue: b.venue, roof: b.roof });
    for (const [team, opp, list] of [[b.home, b.away, b.homePitchers], [b.away, b.home, b.awayPitchers]]) {
      for (const pl of list) lines.push({ dateISO: b.dateISO, team, opponent: opp, name: pl.name, role: pl.role, decoration: pl.decoration, pitches: pl.pitches, bf: pl.bf, ip: pl.ip, h: pl.h, hr: pl.hr, bb: pl.bb, hb: pl.hb, so: pl.so, r: pl.r, er: pl.er, url: p.url });
    }
    // Cross-check the calendar tape against the box score.
    const tapeGame = tapeGames.find((g) => g.dateISO === b.dateISO && g.home === b.home && g.away === b.away);
    if (tapeGame && (tapeGame.homeScore !== b.homeScore || tapeGame.awayScore !== b.awayScore)) {
      irregularities.push({ id: 'NPB-XCHECK', severity: 'high', detail: `score mismatch ${b.dateISO} ${b.home}-${b.away}: calendar ${tapeGame.homeScore}-${tapeGame.awayScore} vs box ${b.homeScore}-${b.awayScore} (${p.url})` });
    }
    if (tapeGame && b.innings) tapeGame.innings = b.innings;
    if (tapeGame) tapeGame.jaBoxUrl = p.url;
  }

  /* ---- fixtures: every schedule row (settled + upcoming) ---- */
  const fixtures = [];
  const seen = new Set();
  const mk = (dateISO, home, away, extra = {}) => {
    const key = schedKey(dateISO, home, away);
    if (seen.has(key)) return;
    seen.add(key);
    const s = schedIndex.get(key) || null;
    const tapeGame = tapeGames.find((g) => g.dateISO === dateISO && g.home === home && g.away === away) || null;
    const league = leagueOf(home, away);
    const h = teamByCode(home); const a = teamByCode(away);
    const venue = s?.venue ?? null;
    const status = tapeGame ? (tapeGame.postponed ? 'postponed' : 'final') : (s?.played ? 'final' : 'scheduled');
    fixtures.push({
      id: tapeGame?.id || `npb-${dateISO.replace(/-/g, '')}-${home}-${away}`,
      season, dateISO, startLocal: s?.startLocal ?? extra.startLocal ?? null, startUtc: s?.startUtc ?? extra.startUtc ?? null, tz: 'Asia/Tokyo',
      league, leagueName: league === 'central' ? 'Central League' : league === 'pacific' ? 'Pacific League' : 'Interleague',
      home: { code: home, name: h?.name ?? home, short: h?.short ?? home, ja: h?.ja ?? null, league: h?.league ?? null },
      away: { code: away, name: a?.name ?? away, short: a?.short ?? away, ja: a?.ja ?? null, league: a?.league ?? null },
      venue, venueJa: s?.venueJa ?? null, roof: s?.roof ?? roofFor(venue || ''),
      forecast: s?.weather ?? null, forecastIcon: s?.weatherIcon ?? null, forecastSource: s?.weather ? 'npb-schedule-detail (気象庁 icon)' : null,
      announcedStarters: s?.announcedStarters ?? null,
      dh: dhStatus(season, h?.league, league),
      status,
      homeScore: tapeGame?.homeScore ?? s?.homeScore ?? null, awayScore: tapeGame?.awayScore ?? s?.awayScore ?? null,
      draw: tapeGame ? tapeGame.draw : (s?.played ? s.homeScore === s.awayScore : null),
      innings: tapeGame?.innings ?? null,
      decision: s?.decision ?? null,
      links: { npbBox: tapeGame?.url ?? null, npbJaScore: s?.scoreUrl ?? null, schedule: s?.sourceUrl ?? null },
      odds: null, oddsSourceCount: 0,
    });
  };
  for (const r of schedRows) mk(r.dateISO, r.home, r.away);
  for (const u of upcomingCal.values()) mk(u.dateISO, u.home, u.away, { startLocal: u.startLocal, startUtc: u.startUtc });
  for (const g of tapeGames) mk(g.dateISO, g.home, g.away);
  fixtures.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : String(a.startUtc).localeCompare(String(b.startUtc))));

  const upcoming = fixtures.filter((f) => f.status === 'scheduled' && f.dateISO >= todayISO);
  const withStarters = upcoming.filter((f) => f.announcedStarters);
  const nextDates = [...new Set(upcoming.map((f) => f.dateISO))].slice(0, 3);
  for (const d of nextDates) {
    const dayFx = upcoming.filter((f) => f.dateISO === d);
    const missingSp = dayFx.filter((f) => !f.announcedStarters).length;
    if (missingSp) irregularities.push({ id: 'NPB-STARTERS', severity: 'low', detail: `${missingSp} of ${dayFx.length} fixtures on ${d} have no announced starters yet (npb.jp publishes 予告先発 the evening before)` });
  }

  // Box-score coverage is measured over the engine's 30-day form window ending
  // today (plus today's games), not merely "since the first box we happen to
  // have" — otherwise a single box would report itself as full coverage.
  const windowFrom = new Date(Date.parse(`${todayISO}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const boxDates = new Set(boxes.map((b) => `${b.dateISO}:${b.home}:${b.away}`));
  const playedInWindow = tapeGames.filter((g) => !g.postponed && g.dateISO >= windowFrom && g.dateISO <= todayISO);
  const boxCoverage = { windowFrom, windowTo: todayISO, boxes: boxes.length, tapeGamesInWindow: playedInWindow.length, matchedInWindow: playedInWindow.filter((g) => boxDates.has(`${g.dateISO}:${g.home}:${g.away}`)).length, pct: null };
  boxCoverage.pct = playedInWindow.length ? Math.round((boxCoverage.matchedInWindow / playedInWindow.length) * 1000) / 10 : null;
  if (!boxes.length) {
    irregularities.push({ id: 'NPB-BOX-COVERAGE', severity: 'high', detail: 'no Japanese box scores parsed — starter form and bullpen blocks are recorded as missing on every fixture' });
  } else if (boxCoverage.matchedInWindow < playedInWindow.length) {
    irregularities.push({ id: 'NPB-BOX-COVERAGE', severity: boxCoverage.pct != null && boxCoverage.pct < 50 ? 'high' : 'medium', detail: `${boxCoverage.matchedInWindow} of ${playedInWindow.length} games played ${windowFrom}..${todayISO} have a parsed Japanese box score (${boxes.length} boxes on file); starter form and bullpen state are missing for the rest, so those blocks score as unsourced and the affected markets SKIP` });
  }

  const base = { schema_version: 1, fetched_at_utc: nowUtc(), collector, mode, season, sport: 'Baseball', league: 'npb' };
  const docs = {
    fixtures: { ...base, todayISO, count: fixtures.length, upcoming: upcoming.length, upcomingWithStarters: withStarters.length, fixtures },
    tape: { ...base, count: tapeGames.length, draws: tapeGames.filter((g) => g.draw).length, postponed: tapeGames.filter((g) => g.postponed).length, games: tapeGames, note: 'Regular-season results from the npb.jp English calendar pages; every row links its official box score. Draws are 12-inning ties.' },
    standings,
    pitchers: { ...base, count: lines.length, boxes, coverage: boxCoverage, lines, note: 'Per-game pitching lines parsed from the Japanese live box scores (npb.jp/scores/.../box.html). Starter form (quality starts, innings, rest) and bullpen state derive from these lines only.' },
  };

  /* ---- backtest + forward ledger ---- */
  const backtest = runNpbBacktest({ tape: docs.tape, pitchers: docs.pitchers }, { fromISO: opts.backtestFrom || null });
  docs.backtest = { ...base, ...backtest };

  const upcomingDates = [...new Set(upcoming.map((f) => f.dateISO))].slice(0, 2);
  const predictions = [];
  for (const d of upcomingDates) {
    const card = buildNpbCard({ fixtures: docs.fixtures, tape: docs.tape, standings: docs.standings, pitchers: docs.pitchers }, { dateISO: d });
    for (const r of card.scored.results) {
      if (r.unscored) continue;
      predictions.push({
        id: r.id, dateISO: r.dateISO, home: r.home.code, away: r.away.code, generatedAt: nowUtc(),
        win: { pick: r.winMatch.decision.outcome === 'draw' ? 'draw' : r.winMatch.decision.outcome ? r.selection : null, confidence: r.winMatch.decision.confidence, score: r.winMatch.favourite.score, drawScore: r.draw.score },
        runLine: { side: r.runLine.decision.side, confidence: r.runLine.decision.confidence, score: r.runLine.favourite.score },
        total: { side: r.total.decision.side, confidence: r.total.decision.confidence, over: r.total.overScore, under: r.total.underScore },
        missing: r.missing, result: null,
      });
    }
  }
  const prior = (opts.priorPredictions?.predictions || []).filter((p) => !predictions.some((q) => q.id === p.id));
  // Grade earlier ledger rows against the tape.
  for (const p of prior) {
    if (p.result) continue;
    const g = tapeGames.find((x) => x.dateISO === p.dateISO && x.home === p.home && x.away === p.away && !x.postponed && x.homeScore != null);
    if (!g) continue;
    const actual = g.homeScore > g.awayScore ? 'home' : g.homeScore < g.awayScore ? 'away' : 'draw';
    const margin = g.homeScore - g.awayScore;
    p.result = { score: `${g.homeScore}-${g.awayScore}`, actual, url: g.url,
      winHit: p.win?.pick ? p.win.pick === actual : null,
      runLineHit: p.runLine?.side ? (p.runLine.side === 'favourite' ? (p.win?.pick === 'home' ? margin : -margin) >= 2 : (p.win?.pick === 'home' ? margin : -margin) <= 1) : null,
      totalGraded: false };
  }
  docs.predictions = { ...base, count: predictions.length + prior.length, predictions: [...prior, ...predictions] };

  docs.provenance = {
    ...base,
    endpoints,
    sources: [
      { id: 'npb-calendar', label: 'NPB English calendar (results tape)', url: `${NPB_BASE}/bis/eng/${season}/calendar/index_09.html` },
      { id: 'npb-standings', label: 'NPB English standings (W-L-T, per-opponent, interleague)', url: `${NPB_BASE}/bis/eng/${season}/stats/std_c.html` },
      { id: 'npb-schedule-detail', label: 'NPB Japanese schedule (announced starters, venue, JMA forecast icon)', url: `${NPB_BASE}/games/${season}/schedule_09_detail.html` },
      { id: 'npb-ja-box', label: 'NPB Japanese live box scores (pitching lines)', url: `${NPB_BASE}/scores/` },
    ],
    notSourced: [
      'three-way moneyline / run line / total prices (no key-less NPB feed; OLBG lists no NPB rows)',
      'per-game foreign-player registrations',
      'opposing-lineup splits versus starter handedness',
      'wind direction and speed (only the JMA forecast icon is published)',
    ],
    coverage: { tapeGames: tapeGames.length, fixtures: fixtures.length, upcoming: upcoming.length, upcomingWithStarters: withStarters.length, boxScores: boxes.length, pitchingLines: lines.length, standingsAsOf: standings.asOf },
    irregularities,
  };
  return docs;
}
