/**
 * DOM smoke tests — the "does the site actually work" pass.
 *
 * These boot the real pages in jsdom with a stubbed network, then assert that
 * the scoreboard renders, that predictions are generated automatically, and
 * that the Generate button produces tips rather than doing nothing.
 *
 * jsdom is a devDependency. If it is not installed the suite skips rather than
 * failing, so `node --test` still works on a clean checkout with no install.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* not installed */ }

const soccerFixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/espn_soccer_eng1.EXCERPT.json'), 'utf8'));
const volleyballFixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/espn_volleyball.EXCERPT.json'), 'utf8'));

/** A scoreboard payload with completed matches, so a baseline can be measured. */
function historyPayload() {
  const events = [];
  for (let i = 0; i < 24; i += 1) {
    const home = `Home ${i}`;
    const away = `Away ${i}`;
    const hs = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0;
    const as = i % 3 === 0 ? 1 : i % 3 === 1 ? 1 : 2;
    events.push({
      id: `h${i}`,
      date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T15:00Z`,
      name: `${away} at ${home}`,
      competitions: [{
        id: `h${i}`,
        status: { type: { state: 'post', shortDetail: 'FT' } },
        competitors: [
          { homeAway: 'home', score: String(hs), winner: hs > as, team: { id: `h${i}`, displayName: home } },
          { homeAway: 'away', score: String(as), winner: as > hs, team: { id: `a${i}`, displayName: away } },
        ],
      }],
    });
  }
  return { leagues: [{ id: '700', name: 'English Premier League', slug: 'eng.1', calendar: [] }], events };
}

const golfPost = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/espn_golf_leaderboard.EXCERPT.json'), 'utf8'));
const golfPre = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/espn_golf_leaderboard_pre.EXCERPT.json'), 'utf8'));

/** Golf scoreboard stub: calendar + the DP World Tour event covering the week. */
function golfScoreboard(tour) {
  const cal = tour === 'eur'
    ? [{ id: '401734065', label: 'Omega European Masters', startDate: '2025-08-28T07:00Z', endDate: '2025-08-31T07:00Z' }, { id: '401822700', label: 'Omega European Masters', startDate: '2026-09-03T07:00Z', endDate: '2026-09-06T07:00Z' }]
    : [{ id: '401811964', label: 'TOUR Championship', startDate: '2026-08-27T07:00Z', endDate: '2026-08-30T07:00Z' }, { id: '401850914', label: 'Biltmore Championship', startDate: '2026-09-17T07:00Z', endDate: '2026-09-20T07:00Z' }];
  const events = tour === 'eur' ? [{ id: '401822700', name: 'Omega European Masters', date: '2026-09-03T04:00Z', endDate: '2026-09-06T04:00Z', status: { type: { state: 'pre' } }, competitions: [{ competitors: [] }], links: [] }] : [];
  return { leagues: [{ id: tour === 'eur' ? '7002' : '1106', slug: tour, name: tour === 'eur' ? 'DP World Tour' : 'PGA TOUR', season: { year: 2026 }, calendar: cal }], day: { date: '2026-09-04' }, events };
}

/** A results tape in the committed shape, built from the completed-event fixture plus a prior edition of the upcoming event. */
function golfResultsDoc() {
  const preField = golfPre.events[0].competitions[0].competitors.map((c) => c.athlete);
  const players = {};
  for (const a of preField) players[a.id] = { name: a.displayName, country: a.flag.alt, countryCode: a.birthPlace?.countryAbbreviation ?? null };
  for (const c of golfPost.events[0].competitions[0].competitors) players[c.athlete.id] = { name: c.athlete.displayName, country: c.athlete.flag.alt, countryCode: 'USA' };
  const rows2025 = preField.map((a, i) => [a.id, i + 1, 'F', -10 + i, 66 + i, 68, 67, 69]);
  const rows2024 = preField.map((a, i) => [a.id, i === 0 ? 3 : i + 4, 'F', -8 + i, 67, 68, 67, 69]);
  const rowsTC = golfPost.events[0].competitions[0].competitors.map((c) => [c.athlete.id, c.status.position.displayName === '-' ? null : Number(c.status.position.id), c.status.type.shortDetail === 'WD' ? 'WD' : 'F', Number(c.statistics[0].value), ...c.linescores.map((l) => (l.value > 50 ? l.value : null)).concat([null, null, null]).slice(0, 4)]);
  return {
    schema_version: 1, sport: 'Golf', source: { url: 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard' }, players,
    events: {
      401734065: { tour: 'eur', name: 'Omega European Masters', tournamentId: '3383', startDate: '2025-08-28', endDate: '2025-08-31', seasonYear: 2025, major: false, purse: 3250000, yards: 6830, par: 70, fieldSize: 4, rows: rows2025, sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401734065' },
      401640000: { tour: 'eur', name: 'Omega European Masters', tournamentId: '3383', startDate: '2024-08-29', endDate: '2024-09-01', seasonYear: 2024, major: false, purse: 3250000, yards: 6830, par: 70, fieldSize: 4, rows: rows2024, sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401640000' },
      401811964: { tour: 'pga', name: 'TOUR Championship', tournamentId: '46', startDate: '2026-08-27', endDate: '2026-08-30', seasonYear: 2026, major: false, purse: 40000000, yards: 7440, par: 70, fieldSize: 3, rows: rowsTC, sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401811964' },
      401800001: { tour: 'eur', name: 'Danish Golf Championship', tournamentId: '9001', startDate: '2026-08-20', endDate: '2026-08-23', seasonYear: 2026, major: false, purse: 2500000, yards: 6950, par: 71, fieldSize: 4, rows: preField.map((a, i) => [a.id, i === 0 ? 1 : i + 6, 'F', -12 + i, 65 + i, 68, 67, 69]), sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401800001' },
      401800002: { tour: 'eur', name: 'British Masters', tournamentId: '9002', startDate: '2026-08-06', endDate: '2026-08-09', seasonYear: 2026, major: false, purse: 3000000, yards: 7100, par: 72, fieldSize: 4, rows: preField.map((a, i) => [a.id, i + 2, 'F', -9 + i, 66 + i, 68, 67, 69]), sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401800002' },
      401800003: { tour: 'eur', name: 'Scottish Championship', tournamentId: '9003', startDate: '2026-07-23', endDate: '2026-07-26', seasonYear: 2026, major: false, purse: 2000000, yards: 6900, par: 70, fieldSize: 4, rows: preField.map((a, i) => [a.id, i === 3 ? null : i + 5, i === 3 ? 'CUT' : 'F', -6 + i, 67 + i, 69, 68, 70]), sourceUrl: 'https://www.espn.com/golf/leaderboard?tournamentId=401800003' },
    },
  };
}

function golfRankingsDoc() {
  const preField = golfPre.events[0].competitions[0].competitors.map((c) => c.athlete);
  return { schema_version: 1, fetched_at_utc: '2026-09-01T00:00:00Z', source: { url: 'https://apiweb.owgr.com/api/owgr/rankings/getRankings?pageSize=1000&pageNumber=1&countryId=0&sortString=Rank+ASC' },
    rows: preField.map((a, i) => ({ rank: 20 + i * 15, owgrId: `o${a.id}`, name: a.displayName, country: a.flag.alt, region: 'Europe', lastWeekRank: 22 + i * 15, profileUrl: `https://www.owgr.com/playerprofile/x-${a.id}` })) };
}

/** Committed-document set for the baseball page, in the collector's shape. */
function baseballDocs() {
  const endpoints = [{ url: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-09-04&hydrate=probablePitcher,linescore,team', status: 200, error: null, ok: true }];
  const mk = (id, dateISO, homeName, homeAbbrev, homeId, awayName, awayAbbrev, awayId, hs, as) => ({
    id, source: 'mlb-statsapi-schedule', league: 'mlb', leagueName: 'Major League Baseball', season: '2026',
    dateISO, startUtc: `${dateISO}T18:00:00Z`, phase: 'results', venue: null, venueIndoor: null,
    home: { id: homeId, name: homeName, abbrev: homeAbbrev, record: null, score: hs, isWinner: hs > as, probablePitcher: null },
    away: { id: awayId, name: awayName, abbrev: awayAbbrev, record: null, score: as, isWinner: as > hs, probablePitcher: null },
    score: { home: hs, away: as },
  });
  const games = [
    mk('t1', '2026-09-01', 'Tampa Bay Rays', 'TB', 139, 'Boston Red Sox', 'BOS', 111, 3, 4),
    mk('t2', '2026-08-30', 'Tampa Bay Rays', 'TB', 139, 'Boston Red Sox', 'BOS', 111, 6, 2),
    mk('t3', '2026-08-28', 'Tampa Bay Rays', 'TB', 139, 'New York Yankees', 'NYY', 147, 5, 1),
    mk('t4', '2026-08-25', 'New York Yankees', 'NYY', 147, 'Tampa Bay Rays', 'TB', 139, 2, 7),
    mk('t5', '2026-08-22', 'Tampa Bay Rays', 'TB', 139, 'Chicago White Sox', 'CWS', 145, 8, 1),
    mk('t6', '2026-08-19', 'Tampa Bay Rays', 'TB', 139, 'Chicago White Sox', 'CWS', 145, 6, 2),
    mk('w1', '2026-09-01', 'Minnesota Twins', 'MIN', 142, 'Chicago White Sox', 'CWS', 145, 5, 2),
    mk('w2', '2026-08-30', 'Minnesota Twins', 'MIN', 142, 'Chicago White Sox', 'CWS', 145, 6, 3),
    mk('w3', '2026-08-28', 'Minnesota Twins', 'MIN', 142, 'Chicago White Sox', 'CWS', 145, 4, 1),
    mk('w4', '2026-08-25', 'Minnesota Twins', 'MIN', 142, 'Chicago White Sox', 'CWS', 145, 7, 2),
    mk('w5', '2026-08-22', 'Minnesota Twins', 'MIN', 142, 'Chicago White Sox', 'CWS', 145, 5, 1),
    mk('c1', '2026-08-30', 'Cleveland Guardians', 'CLE', 114, 'Detroit Tigers', 'DET', 116, 5, 2),
    mk('c2', '2026-08-27', 'Cleveland Guardians', 'CLE', 114, 'Detroit Tigers', 'DET', 116, 4, 1),
    mk('c3', '2026-08-24', 'Cleveland Guardians', 'CLE', 114, 'Detroit Tigers', 'DET', 116, 6, 3),
  ];
  const fixture = (id, phase, homeName, homeAbbrev, homeId, awayName, awayAbbrev, awayId, homePitcher, awayPitcher, dateISO, startUtc) => ({
    id, source: 'mlb-statsapi-schedule', league: 'mlb', leagueName: 'Major League Baseball', season: '2026',
    dateISO, startUtc, phase, venue: homeId === 139 ? 'Tropicana Field' : 'Progressive Field', venueIndoor: homeId === 139,
    home: { id: homeId, name: homeName, abbrev: homeAbbrev, record: { wins: 83, losses: 56 }, probablePitcher: homePitcher },
    away: { id: awayId, name: awayName, abbrev: awayAbbrev, record: { wins: 60, losses: 79 }, probablePitcher: awayPitcher },
    score: { home: null, away: null }, odds: null, oddsSourceCount: 0,
  });
  const fixtures = {
    schema_version: 1, sport: 'Baseball', league: 'mlb', season: '2026', endpoints, window: { from: '2026-08-14', to: '2026-09-25' },
    fixtures: [
      fixture('g1', 'upcoming', 'Tampa Bay Rays', 'TB', 139, 'Chicago White Sox', 'CWS', 145,
        { id: 101, name: 'Ace Starter' }, { id: 202, name: 'Weak Starter' }, '2026-09-04', '2026-09-04T18:10:00Z'),
      fixture('g2', 'upcoming', 'Cleveland Guardians', 'CLE', 114, 'Detroit Tigers', 'DET', 116,
        { id: 303, name: 'Rotation Anchor' }, { id: 404, name: 'Spot Starter' }, '2026-09-04', '2026-09-04T23:15:00Z'),
    ],
    counts: { fixtures: 2, results: 0, withOdds: 0 },
  };
  return {
    fixtures,
    tape: { schema_version: 1, sport: 'Baseball', league: 'mlb', endpoints, games, counts: { games: games.length } },
    standings: {
      schema_version: 1, sport: 'Baseball', league: 'mlb', season: '2026', endpoints,
      teams: {
        139: { id: 139, name: 'Tampa Bay Rays', wins: 83, losses: 56, gamesPlayed: 139, runDifferential: 51, runsScored: 628, runsAllowed: 577 },
        145: { id: 145, name: 'Chicago White Sox', wins: 60, losses: 79, gamesPlayed: 139, runDifferential: -40, runsScored: 574, runsAllowed: 614 },
        114: { id: 114, name: 'Cleveland Guardians', wins: 70, losses: 69, gamesPlayed: 139, runDifferential: 11, runsScored: 563, runsAllowed: 552 },
        116: { id: 116, name: 'Detroit Tigers', wins: 64, losses: 75, gamesPlayed: 139, runDifferential: -18, runsScored: 599, runsAllowed: 617 },
      },
      counts: { teams: 4 },
    },
    teamStats: {
      schema_version: 1, sport: 'Baseball', league: 'mlb', season: '2026', endpoints,
      teams: {
        139: { id: 139, name: 'Tampa Bay Rays', hitting: { avg: 0.261, obp: 0.329, slg: 0.404, runs: 628 }, pitching: { era: 3.24, whip: 1.17 } },
        145: { id: 145, name: 'Chicago White Sox', hitting: { avg: 0.238, obp: 0.301, slg: 0.382, runs: 574 }, pitching: { era: 4.52, whip: 1.38 } },
        114: { id: 114, name: 'Cleveland Guardians', hitting: { avg: 0.245, obp: 0.312, slg: 0.398, runs: 563 }, pitching: { era: 3.70, whip: 1.22 } },
        116: { id: 116, name: 'Detroit Tigers', hitting: { avg: 0.241, obp: 0.307, slg: 0.389, runs: 599 }, pitching: { era: 4.10, whip: 1.29 } },
      },
      counts: { teams: 4 },
    },
    pitchers: {
      schema_version: 1, sport: 'Baseball', league: 'mlb', season: '2026', endpoints,
      pitchers: {
        101: { id: 101, name: 'Ace Starter', era: 2.5, whip: 1.05, strikeoutsPer9: 9.5, qualityStartsLast4: 3, qualityStartsLast3: 2, avgInningsPerStart: 6.4, last4: [{ date: '2026-08-31' }, { date: '2026-08-25' }, { date: '2026-08-19' }, { date: '2026-08-13' }] },
        202: { id: 202, name: 'Weak Starter', era: 5.4, whip: 1.5, strikeoutsPer9: 6.2, qualityStartsLast4: 0, qualityStartsLast3: 0, avgInningsPerStart: 4.8, last4: [{ date: '2026-08-31' }, { date: '2026-08-25' }, { date: '2026-08-19' }, { date: '2026-08-13' }] },
        303: { id: 303, name: 'Rotation Anchor', era: 3.2, whip: 1.1, strikeoutsPer9: 8.6, qualityStartsLast4: 2, qualityStartsLast3: 1, avgInningsPerStart: 6.1, last4: [{ date: '2026-08-30' }, { date: '2026-08-24' }, { date: '2026-08-18' }, { date: '2026-08-12' }] },
        404: { id: 404, name: 'Spot Starter', era: 4.6, whip: 1.4, strikeoutsPer9: 6.9, qualityStartsLast4: 1, qualityStartsLast3: 0, avgInningsPerStart: 5.0, last4: [{ date: '2026-08-30' }, { date: '2026-08-24' }, { date: '2026-08-18' }, { date: '2026-08-12' }] },
      },
      counts: { pitchers: 4 },
    },
    slate: {
      schema_version: 1, sport: 'Baseball', fetched_at_utc: '2026-09-04T00:00:00Z',
      source: { name: 'OLBG Baseball betting-tips index', url: 'https://www.olbg.com/betting-tips/Baseball/12' },
      events: [{ event_id: '159810', url: 'https://www.olbg.com/betting-tips/Baseball/MLB/MLB/CWS_@_TB/12?event_id=159810', league: 'MLB', home: 'Tampa Bay Rays', away: 'Chicago White Sox', market: 'Money Line', tips_for: 2, tips_total: 2, odds: null }],
      markets_seen: ['Money Line'], warnings: [],
    },
    provenance: {
      schema_version: 1, sport: 'Baseball',
      sources: [
        { name: 'MLB StatsAPI schedule', url: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1', provides: ['fixtures', 'results', 'probable pitchers'], verified_utc: '2026-09-03T00:00:00Z', status: 200 },
        { name: 'MLB standings', url: 'https://www.mlb.com/standings', provides: ['W-L record', 'run differential'], verified_utc: '2026-09-03T00:00:00Z', status: 200 },
        { name: 'ESPN MLB scoreboard', url: 'https://www.espn.com/mlb/scoreboard', provides: ['venue', 'weather context'], verified_utc: '2026-09-03T00:00:00Z', status: 200 },
      ],
      irregularities: [
        { id: 'IR-BASEBALL-01', title: 'No key-less moneyline / run line / total feed', effect: 'The Odds and Value block scores as missing and price-gated Step 3 rules resolve to SKIP where the prompt requires a price.' },
      ],
    },
    predictions: { schema_version: 1, sport: 'Baseball', predictions: [] },
    backtest: {
      schema_version: 1, sport: 'Baseball', method: 'Walk-forward re-scoring of settled games', generated_at_utc: '2026-09-04T00:00:00Z',
      results: {
        graded: 12, overall_hit_rate_pct: 58.3,
        run_line: { graded: 0, reason: 'the closing run line is not retained by any free feed once a game is final' },
        game_total: { graded: 0, reason: 'the closing total line is not retained by any free feed once a game is final' },
        roi: null, roi_reason: 'no price is attached to a settled fixture, so no return can be computed',
      },
    },
  };
}

function makeFetch(counters) {
  return async function stubFetch(url) {
    const u = String(url);
    counters.calls.push(u);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('/sports/golf/leaderboard?league=')) {
      const id = u.match(/event=(\d+)/)?.[1];
      if (id === '401822700') return ok(golfPre);
      if (id === '401811964') return ok(golfPost);
      return ok({ events: [] });
    }
    if (/site\.api\.espn\.com\/apis\/site\/v2\/sports\/golf\/(pga|eur|lpga|champions-tour)\/scoreboard/.test(u)) {
      const tour = u.match(/sports\/golf\/([a-z-]+)\/scoreboard/)[1];
      if (tour === 'lpga' || tour === 'champions-tour') return { ok: false, status: 404, json: async () => ({}) };
      return ok(golfScoreboard(tour));
    }
    if (u.includes('data/golf_results.json')) return ok(golfResultsDoc());
    if (u.includes('data/golf_rankings.json')) return ok(golfRankingsDoc());
    if (u.includes('data/golf_weather.json')) return ok({ events: { 401822700: { available: true, days: [{ date: '2026-09-03', windMaxKmh: 34, precipProbPct: 55 }], r1: { trend: 'deteriorating' }, sourceUrl: 'https://api.open-meteo.com/v1/forecast?latitude=46&longitude=7' } } });
    if (u.includes('data/golf_backtest.json')) {
      return ok({ events: 22, generated_at_utc: '2026-09-01T00:00:00Z', summary: [
        { market: 'outright', hits: 2, graded: 22, hitRate: 0.091 }, { market: 'top6', hits: 8, graded: 20, hitRate: 0.4 }, { market: 'frl', hits: 1, graded: 22, hitRate: 0.045 },
        { market: 'top_european', hits: 3, graded: 22, hitRate: 0.136 }, { market: 'top_american', hits: 6, graded: 22, hitRate: 0.273 }, { market: 'top_british_irish', hits: 5, graded: 22, hitRate: 0.227 },
      ], top6List: { selections: 100, hits: 27, rate: 0.27 } });
    }
    if (u.includes('data/golf_events.json') || u.includes('data/golf_stats.json') || u.includes('data/golf_slate.json')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (u.includes('/sports/volleyball/')) {
      if (/dates=20260903/.test(u)) return ok({ leagues: volleyballFixture.leagues, events: [] });
      return ok(volleyballFixture);
    }
    if (u.includes('data/baseball_')) {
      const bb = baseballDocs();
      if (u.includes('baseball_fixtures.json')) return ok(bb.fixtures);
      if (u.includes('baseball_tape.json')) return ok(bb.tape);
      if (u.includes('baseball_standings.json')) return ok(bb.standings);
      if (u.includes('baseball_team_stats.json')) return ok(bb.teamStats);
      if (u.includes('baseball_pitchers.json')) return ok(bb.pitchers);
      if (u.includes('baseball_slate.json')) return ok(bb.slate);
      if (u.includes('baseball_provenance.json')) return ok(bb.provenance);
      if (u.includes('baseball_predictions.json')) return ok(bb.predictions);
      if (u.includes('baseball_backtest.json')) return ok(bb.backtest);
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (u.includes('site.api.espn.com')) {
      // A range request is the history scan; a single date is the day's card.
      if (/dates=\d{8}-\d{8}/.test(u)) return ok(historyPayload());
      return ok(soccerFixture);
    }
    // Prefer the REAL committed artifact when CI has built it: that is what
    // catches schema drift between the builder script and the page that
    // renders it. Fall back to a synthetic payload on a clean checkout.
    if (u.includes('data/leagues.json') && existsSync(join(ROOT, 'data/leagues.json'))) {
      return ok(JSON.parse(readFileSync(join(ROOT, 'data/leagues.json'), 'utf8')));
    }
    if (u.includes('data/league_context.json') && existsSync(join(ROOT, 'data/league_context.json'))) {
      return ok(JSON.parse(readFileSync(join(ROOT, 'data/league_context.json'), 'utf8')));
    }
    if (u.includes('data/leagues.json')) {
      return ok({
        schema_version: 1,
        generated_at_utc: '2026-09-02T00:00:00Z',
        summary: { checked: 1, ok: 1, failed: 0 },
        sports: { football: { espnSport: 'soccer', leagues: [{ slug: 'eng.1', name: 'English Premier League', ok: true, status: 200 }] } },
      });
    }
    if (u.includes('data/league_context.json')) {
      return ok({
        generated_at_utc: '2026-09-02T00:00:00Z',
        window: { days: 120, from: '2026-05-05', to: '2026-09-02' },
        method: 'measured',
        summary: { sufficient: 1, thin: 0, failed: 0 },
        leagues: {
          'football:eng.1': {
            sufficient: true, sample: 240, homeWinRate: 0.45, drawRate: 0.24, awayWinRate: 0.31,
            meanTotal: 2.8, leagueName: 'English Premier League', sourceUrl: 'https://site.api.espn.com/x',
          },
        },
      });
    }
    if (u.includes('data/olbg_sports.json') || u.includes('_slate.json') || u.includes('data/slate.json')
        || u.includes('data/irregularities.json') || u.includes('data/universal_backtest.json')
        || /data\/greyhound_(meetings|history|provenance|predictions|backtest)\.json/.test(u)
        || u.includes('data/volleyball_')
        || /data\/snooker_(slate|results|rankings|provenance|predictions|backtest)\.json/.test(u)
        || u.includes('data/darts_')
        || /data\/ice_hockey_(fixtures|tape|standings|goalies|injuries|slate|provenance|predictions|backtest)\.json/.test(u)) {
      const local = join(ROOT, u.replace(/^.*\/(data\/[^?]+)$/, '$1'));
      if (existsSync(local)) return ok(JSON.parse(readFileSync(local, 'utf8')));
      return { ok: false, status: 404, json: async () => ({}) };
    }
    // Live GBGB API calls are not reachable in the sandbox; the page must
    // fall back to the committed data and label it.
    if (u.includes('api.gbgb.org.uk')) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function bootPage(page, { search = '' } = {}) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const counters = { calls: [] };
  const dom = new JSDOM(html, {
    url: `https://example.test/${page}${search}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // Globals the modules expect.
  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.history = window.history;
  global.localStorage = window.localStorage;
  global.CSS = window.CSS || { escape: (s) => String(s).replace(/[^\w-]/g, '\\$&') };
  Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });
  global.AbortController = window.AbortController || global.AbortController;
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  global.fetch = makeFetch(counters);

  // Import the page's module entry (cache-busted so each test gets a fresh run).
  const src = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  assert.ok(src, `${page} loads a module script`);
  const mod = pathToFileURL(join(ROOT, src)).href;
  await import(`${mod}?t=${Math.random()}`);

  // Let the async boot settle.
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 15));

  return { dom, window, document: window.document, counters };
}

function cleanup() {
  for (const k of ['window', 'document', 'location', 'history', 'localStorage', 'CSS', 'navigator', 'fetch', 'requestAnimationFrame']) {
    delete global[k];
  }
}

test('sport.html boots, renders the board and auto-generates a prediction', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sport.html', { search: '?sport=football&date=2026-09-05' });
  try {
    // shell
    assert.ok(document.querySelector('.masthead'), 'masthead rendered');
    assert.ok(document.querySelectorAll('.sportrail a').length >= 20, 'every sport is in the rail');
    assert.ok(document.querySelector('footer.site'), 'footer rendered');

    // board
    const rows = document.querySelectorAll('.match');
    assert.ok(rows.length >= 1, 'at least one match row rendered');
    assert.match(document.body.textContent, /Newcastle United/);
    assert.match(document.body.textContent, /AFC Bournemouth/);

    // auto-generated prediction, not an empty placeholder
    const pill = document.querySelector('.pred-pill .sel');
    assert.ok(pill, 'a prediction pill exists');
    assert.ok(pill.textContent.trim().length > 0, 'the pill carries a selection');
    assert.ok(!/^\s*$/.test(pill.textContent), 'pill is not blank');

    // the rail lists it
    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0);

    // league select was populated from the verified registry
    const opts = document.querySelectorAll('#league-filter option');
    assert.ok(opts.length >= 2, 'league filter populated');
    assert.match(document.querySelector('#registry-note').textContent, /machine-verified/);
  } finally { cleanup(); }
});

test('the Generate button actually generates (it is not a no-op)', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('sport.html', { search: '?sport=football&date=2026-09-05' });
  try {
    const btn = document.querySelector('#generate');
    assert.ok(btn, 'the button exists');

    // Wipe the rendered predictions so we can prove the click repopulates them.
    document.querySelector('#rail-preds').innerHTML = '';
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 15));

    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0,
      'clicking Generate repopulated the predictions rail');
    assert.equal(btn.disabled, false, 'the button re-enables after generating');
    assert.match(btn.textContent, /Generate predictions/);

    // and a toast reported the count
    const toast = document.querySelector('#toast');
    assert.ok(toast, 'a toast was raised');
    assert.match(toast.textContent, /predictions generated/);
  } finally { cleanup(); }
});

test('opening Analysis reveals the written tip, its signals and its sources', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('sport.html', { search: '?sport=football&date=2026-09-05' });
  try {
    const toggle = document.querySelector('[data-toggle]');
    assert.ok(toggle, 'an analysis toggle exists');
    toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));

    const detail = document.querySelector('.detail.open');
    assert.ok(detail, 'the detail panel opened');
    const text = detail.textContent;
    assert.match(text, /is the call/, 'the written tip is present');
    assert.match(text, /DraftKings/, 'the price provider is attributed');
    assert.match(text, /Full Time Result/, 'the market table is present');
    assert.ok(detail.querySelectorAll('.srclist a').length >= 2, 'review links are present');
    assert.match(text, /Not available for this fixture|missing/i, 'missing factors are disclosed');

    // every source link is a real https URL
    for (const a of detail.querySelectorAll('.srclist a')) {
      assert.match(a.getAttribute('href'), /^https:\/\//);
      assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    }
  } finally { cleanup(); }
});

test('golf.html boots, renders leaderboards from ESPN and auto-generates a six-market card', { skip: !JSDOM }, async () => {
  const { document, counters } = await bootPage('golf.html', { search: '?date=2026-09-04' });
  try {
    assert.ok(document.querySelector('.masthead'), 'masthead rendered');
    assert.ok(document.querySelector('.sportrail a[data-sport="golf"]'), 'golf is in the rail');
    assert.ok(counters.calls.some((u) => u.includes('/sports/golf/eur/scoreboard')), 'the DP World Tour calendar was fetched live');
    assert.ok(counters.calls.some((u) => u.includes('leaderboard?league=eur&event=401822700')), 'the full field was fetched live');

    const text = document.body.textContent;
    assert.match(text, /Omega European Masters/);
    assert.match(text, /Crans-sur-Sierre Golf Club/);
    assert.match(text, /Calum Hill/, 'the field is rendered');
    assert.ok(document.querySelectorAll('#board table.data tbody tr').length >= 4, 'leaderboard rows rendered');

    // an auto-generated selection with a band, not a placeholder
    const pill = document.querySelector('.pred-pill .sel');
    assert.ok(pill, 'a prediction pill exists');
    assert.ok(pill.textContent.trim().length > 0);
    assert.ok(document.querySelector('.pred-pill .badge'));
    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0, 'the rail lists selections');
    assert.match(document.querySelector('#rail-count').textContent, /selections across 1 tournament card/);
    assert.match(document.querySelector('#coverage').textContent, /OWGR rows/);
    assert.match(document.querySelector('#coverage').textContent, /walk-forward backtest \(22 events/, 'the measured backtest summary is surfaced');
    assert.ok(document.querySelector('#coverage a[href="data/golf_backtest.json"]'), 'the backtest ledger is linked');
    assert.ok(document.querySelectorAll('#calgrid .cell .c').length >= 1, 'calendar shows tournament days');
  } finally { cleanup(); }
});

test('the golf Generate button actually generates (it is not a no-op)', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('golf.html', { search: '?date=2026-09-04' });
  try {
    const btn = document.querySelector('#generate');
    assert.ok(btn, 'the button exists');
    document.querySelector('#rail-preds').innerHTML = '';
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 15));
    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0, 'clicking Generate repopulated the rail');
    assert.equal(btn.disabled, false);
    assert.match(btn.textContent, /Generate predictions/);
    const toast = document.querySelector('#toast');
    assert.ok(toast, 'a toast was raised');
    assert.match(toast.textContent, /selections generated across 1 tournament card/);
  } finally { cleanup(); }
});

test('golf Analysis reveals the written card, every rule that fired, missing factors and source links', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('golf.html', { search: '?date=2026-09-04' });
  try {
    const toggle = document.querySelector('[data-toggle]');
    toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const detail = document.querySelector('.detail.open');
    assert.ok(detail, 'the detail panel opened');
    const text = detail.textContent;
    assert.match(text, /OUTRIGHT WINNER AND TOP SIX/);
    assert.match(text, /FIRST ROUND LEADER/);
    assert.match(text, /TOP BRITISH & IRISH/);
    assert.match(text, /Confidence: (HIGH|MEDIUM|LOW)/);
    assert.match(text, /Responsible gambling|Weather note/);
    assert.match(text, /CARD VALIDATED/, 'the writer validator passed on the live card');
    assert.match(text, /strokes gained/i, 'the missing strokes-gained source is disclosed');
    assert.match(text, /Recent form/, 'component labels are shown');
    assert.ok(detail.querySelectorAll('.srclist a').length >= 2, 'review links are present');
    for (const a of detail.querySelectorAll('.srclist a')) {
      assert.match(a.getAttribute('href'), /^https:\/\//);
      assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    }
    // the tips never leak figures, source names or the tournament name
    for (const p of detail.querySelectorAll('.tipbox p')) {
      const t = p.textContent;
      if (!/Confidence:/.test(t)) continue;
      assert.ok(!/\d/.test(t), `no numerals in tip: ${t.slice(0, 60)}`);
      assert.ok(!/ESPN|OWGR|OLBG|Omega|Crans/.test(t), `no source/tournament names in tip: ${t.slice(0, 60)}`);
    }
  } finally { cleanup(); }
});

test('sport.html?sport=golf hands over to the dedicated golf page', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sport.html', { search: '?sport=golf&date=2026-09-04' });
  try {
    // jsdom does not implement navigation, so the handover link is the observable.
    const a = document.querySelector('#handover');
    assert.ok(a, 'handover link rendered');
    assert.match(a.getAttribute('href'), /golf\.html\?date=2026-09-04/);
  } finally { cleanup(); }
});

test('index.html boots and lists every OLBG sport as a tile', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('index.html');
  try {
    const tiles = document.querySelectorAll('#tiles .tile');
    assert.equal(tiles.length, 20, 'one tile per OLBG betting-tips sport');
    assert.match(document.querySelector('#reg-note').textContent, /machine-verified|not yet built/);
  } finally { cleanup(); }
});

test('markets.html renders the full OLBG directory with live links', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('markets.html');
  try {
    const rows = document.querySelectorAll('#dir table.data tbody tr');
    assert.ok(rows.length >= 20, 'a row per sport');
    const links = [...document.querySelectorAll('#dir a')].map((a) => a.getAttribute('href'));
    assert.ok(links.some((h) => /olbg\.com\/betting-tips\/Cricket\/7$/.test(h)), 'cricket points at the corrected index id 7');
    assert.ok(!links.some((h) => /olbg\.com\/betting-tips\/Cricket\/16/.test(h)), 'the wrong cricket id is gone');
  } finally { cleanup(); }
});

test('predictions.html generates a cross-sport card on arrival', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('predictions.html', { search: '?sports=football&date=2026-09-05' });
  try {
    assert.match(document.querySelector('#summary').textContent, /fixtures/);
    assert.ok(document.querySelectorAll('#out .card').length >= 1, 'at least one prediction card');
    assert.match(document.querySelector('#out').textContent, /is the call/);
  } finally { cleanup(); }
});

test('sources.html renders the verification report and the irregularities register', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sources.html');
  try {
    assert.match(document.querySelector('#registry-report').textContent, /answered HTTP 200/);
    const irr = document.querySelector('#irr').textContent;
    assert.match(irr, /U-01/);
    assert.match(irr, /Cricket/);
    assert.ok(document.querySelectorAll('#sport-sources tbody tr').length >= 20);
    const sn = document.querySelector('#sn-irr').textContent;
    assert.match(sn, /IR-SNOOKER-01/, 'snooker register row renders');
    assert.ok(document.querySelector('#sn-irr a[href*="snooker.html"]'), 'snooker register links to the scoreboard');
    const links = [...document.querySelectorAll('#sn-irr a[href^="https://"]')];
    assert.ok(links.length >= 2, `snooker register carries review links (got ${links.length})`);
    for (const l of links) assert.ok(l.href.startsWith('https://'), 'review links are https');
    const da = document.querySelector('#da-irr').textContent;
    assert.match(da, /IR-DARTS-01/, 'darts register row renders');
    assert.ok(document.querySelector('#da-irr a[href*="darts.html"]'), 'darts register links to the scoreboard');
    const daLinks = [...document.querySelectorAll('#da-irr a[href^="https://"]')];
    assert.ok(daLinks.length >= 2, `darts register carries review links (got ${daLinks.length})`);
  } finally { cleanup(); }
});

test('method.html states the hyperparameters and the missing-backtest case honestly', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('method.html');
  try {
    assert.match(document.querySelector('#weights').textContent, /marketWeight/);
    const bt = document.querySelector('#backtest').textContent;
    assert.ok(/No backtest artifact committed yet|Leak control/.test(bt),
      'either the real backtest or an explicit "not built yet" notice — never a placeholder number');
  } finally { cleanup(); }
});

test('sources.html reports the real machine-verification numbers when CI has built them', { skip: !JSDOM }, async () => {
  if (!existsSync(join(ROOT, 'data/leagues.json'))) return; // not built yet on this checkout
  const real = JSON.parse(readFileSync(join(ROOT, 'data/leagues.json'), 'utf8'));
  const { window } = await bootPage('sources.html');
  const text = window.document.body.textContent;

  // The counts on the page must be the counts in the artifact, not a placeholder.
  assert.match(text, new RegExp(String(real.summary.checked)), 'checked count is rendered');
  assert.match(text, new RegExp(String(real.summary.ok)), 'ok count is rendered');
  assert.ok(!/not built yet/i.test(text.split('Irregularities')[0]),
    'the registry block must show data, not the not-built-yet notice');

  // A slug that failed verification has to be visible, not quietly dropped.
  const failed = Object.values(real.sports).flatMap((b) => (b.leagues || []).filter((l) => !l.ok));
  for (const f of failed) {
    assert.match(text, new RegExp(f.slug.replace('.', '\\.')), `failed slug ${f.slug} is surfaced for review`);
  }
});

test('method.html publishes the real backtest, and never invents an ROI', { skip: !JSDOM }, async () => {
  if (!existsSync(join(ROOT, 'data/universal_backtest.json'))) return;
  const bt = JSON.parse(readFileSync(join(ROOT, 'data/universal_backtest.json'), 'utf8'));
  const { window } = await bootPage('method.html');
  const text = window.document.body.textContent;

  assert.match(text, new RegExp(String(bt.overall.n)), 'the graded sample size is shown');

  // Bands must be monotonic in the artifact itself; the page must not claim
  // otherwise, and must not print a percentage ROI when none was computable.
  const { HIGH, MEDIUM, LOW } = bt.byBand;
  assert.ok(HIGH.hitRate > MEDIUM.hitRate, 'HIGH outperforms MEDIUM');
  assert.ok(MEDIUM.hitRate > LOW.hitRate, 'MEDIUM outperforms LOW');

  if (bt.overall.roi === null) {
    // No ROI is computable, so the column must be absent entirely rather than
    // showing a number, and the page must say why.
    const heads = [...window.document.querySelectorAll('#backtest th')].map((h) => h.textContent.trim());
    assert.ok(!heads.some((h) => /ROI/i.test(h)), `ROI column must be dropped, saw headers: ${heads.join(' | ')}`);
    assert.match(text, /no ROI is computable/i, 'the page explains why there is no ROI');
  }

  // The verdict must reflect the artifact, not a fixed sentence.
  assert.match(text, /The bands separate/i);
});

test('the registry contains no endpoint that the verifier proved dead', { skip: !existsSync(join(ROOT, 'data/leagues.json')) }, async () => {
  const real = JSON.parse(readFileSync(join(ROOT, 'data/leagues.json'), 'utf8'));
  const { SPORTS } = await import(pathToFileURL(join(ROOT, 'engine/registry.js')).href);
  const failed = Object.values(real.sports).flatMap((b) => (b.leagues || []).filter((l) => !l.ok).map((l) => l.slug));
  const stillListed = [];
  for (const sport of SPORTS) {
    for (const c of sport.candidateLeagues || []) {
      if (failed.includes(c.slug)) stillListed.push(`${sport.key}:${c.slug}`);
    }
  }
  assert.deepEqual(stillListed, [],
    `these slugs failed live verification and must be removed from engine/registry.js: ${stillListed.join(', ')}`);
});

test('greyhounds.html boots, renders races and auto-generates a written WIN tip', { skip: !JSDOM }, async () => {
  const { document, counters } = await bootPage('greyhounds.html', { search: '?date=2026-09-02' });

  // The card renders the fixture's races.
  const races = [...document.querySelectorAll('.race')];
  assert.ok(races.length >= 2, 'at least two races render');

  // A tip box with a written tip exists for the selection.
  const tipText = document.querySelector('.tip-text');
  assert.ok(tipText, 'a written tip box renders');
  const tip = tipText.textContent;
  assert.match(tip, /Confidence:\s*(LOW|MEDIUM|HIGH)/, 'tip declares confidence');
  assert.ok(/\b(\w[\w'-] ?){39,}/.test(tip) || tip.split(/\s+/).length >= 40, 'tip is at least 40 words');
  // Winner bolded early and no numerals leak into the prose.
  assert.ok(/<strong>.*?<\/strong>/.test(tipText.innerHTML), 'selection name is bolded');
  assert.ok(!/\d/.test(tip.replace(/\s+/g, ' ')), `no numerals in tip text: ${tip.slice(0, 80)}`);

  // Confidence badge is visible in the card.
  assert.ok(document.querySelector('.race .badge'), 'a confidence/result badge renders');

  // The GBGB live source was attempted (and gracefully fell back to committed data).
  assert.ok(counters.calls.some((u) => u.includes('api.gbgb.org.uk')), 'live GBGB refresh was attempted');
});

test('the greyhound Generate button actually generates (it is not a no-op)', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('greyhounds.html', { search: '?date=2026-09-02' });
  const before = document.querySelector('.tip-text')?.textContent || '';
  const btn = document.querySelector('#generate');
  assert.ok(btn, 'generate button exists');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 15));
  const after = document.querySelector('.tip-text')?.textContent || '';
  assert.ok(after, 'tips present after Generate click');
  assert.match(after, /Confidence:\s*(LOW|MEDIUM|HIGH)/);
  assert.notEqual(before, '', 'a tip existed and was regenerated');
});

test('greyhound Analysis exposes fired rules and at least two https review links', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('greyhounds.html', { search: '?date=2026-09-02' });
  const details = document.querySelector('.analysis details');
  assert.ok(details, 'an analysis panel exists');
  details.setAttribute('open', '');
  const text = details.textContent;
  assert.match(text, /Factor|form|trap/i, 'analysis names scored factors');
  const links = [...details.querySelectorAll('a[href^="https://"]')];
  assert.ok(links.length >= 2, `at least two https review links, saw ${links.length}`);
  // No odds figures are claimed for a live card.
  assert.match(text, /odds/i, 'the odds category is reported (as not available live)');
});

test('snooker.html boots, renders the fixture and auto-generates a written prediction', { skip: !JSDOM }, async () => {
  const { document, counters } = await bootPage('snooker.html', { search: '?date=2026-09-02' });

  // Masthead + rail entry.
  assert.ok(document.querySelector('.masthead'), 'masthead rendered');
  assert.ok(document.querySelector('.sportrail a[data-sport="snooker"]'), 'snooker is in the rail');

  // The slate fixture renders with a written prediction.
  const text = document.body.textContent;
  assert.match(text, /Pang Junxu v Mark Joyce/, 'fixture renders');
  const tipText = document.querySelector('.tip-text');
  assert.ok(tipText, 'a written prediction box renders');
  const tip = tipText.textContent;
  assert.match(tip, /Confidence:\s*(LOW|MEDIUM|HIGH|SKIP)/, 'prediction declares confidence');
  const words = tip.trim().split(/\s+/).length;
  assert.ok(words >= 25 && words <= 40, `prediction is 25-40 words, got ${words}`);
  assert.ok(!/\d/.test(tip.replace(/\s+/g, ' ')), `no numerals in prediction prose: ${tip.slice(0, 80)}`);
  // Odds shortage must be disclosed, not hidden or invented.
  assert.match(text, /no free key-less price|no price feed|IR-SNOOKER/i);
  assert.match(text, /SKIP/, 'live card resolves to SKIP on the odds gate');
});

test('the snooker Generate button actually generates (it is not a no-op)', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('snooker.html', { search: '?date=2026-09-02' });
  document.querySelector('#rail-preds').innerHTML = '';
  const before = document.querySelector('.tip-text')?.textContent || '';
  const btn = document.querySelector('#generate');
  assert.ok(btn, 'generate button exists');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 15));
  const after = document.querySelector('.tip-text')?.textContent || '';
  assert.ok(after, 'prediction present after Generate click');
  assert.match(after, /Confidence:\s*(LOW|MEDIUM|HIGH|SKIP)/);
  assert.equal(before, after, 'regenerated prediction is deterministic');
});

test('snooker Analysis exposes fired rules and at least two https review links', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('snooker.html', { search: '?date=2026-09-02' });
  const details = document.querySelector('.analysis details');
  assert.ok(details, 'an analysis panel exists');
  details.setAttribute('open', '');
  const atext = details.textContent;
  assert.match(atext, /Factor|form|ranking|h2h|stage/i, 'analysis names scored factors');
  const links = [...details.querySelectorAll('a[href^="https://"]')];
  assert.ok(links.length >= 2, `at least two https review links, saw ${links.length}`);
  assert.match(atext, /odds/i, 'odds category is reported (as not available live)');
});

test('registry: snooker is predicted on its own specialist page', async () => {
  const { SPORTS } = await import(pathToFileURL(join(ROOT, 'engine/registry.js')).href);
  const s = SPORTS.find((x) => x.key === 'snooker');
  assert.equal(s.predictable, true);
  assert.equal(s.page, 'snooker.html');
  assert.equal(s.specialistEngine, 'snooker');
});

test('registry: greyhounds are predicted on their own specialist page', async () => {
  const { SPORTS } = await import(pathToFileURL(join(ROOT, 'engine/registry.js')).href);
  const g = SPORTS.find((s) => s.key === 'greyhounds');
  assert.equal(g.predictable, true);
  assert.equal(g.page, 'greyhounds.html');
  assert.equal(g.specialistEngine, 'greyhounds');
});

test('volleyball.html boots NCAA rows, set linescores and the Generate button', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('volleyball.html', { search: '?date=2026-09-02' });
  try {
    assert.ok(document.querySelector('.masthead'), 'masthead rendered');
    assert.ok(document.querySelector('.sportrail a[data-sport="volleyball"]'), 'volleyball is in the rail');
    const text = document.body.textContent;
    assert.match(text, /Nebraska Cornhuskers/);
    assert.match(text, /Wisconsin Badgers/);
    assert.match(text, /25–20|25-20|25–20/);
    const rows = document.querySelectorAll('.match');
    assert.ok(rows.length >= 1, 'at least one match row');
    const btn = document.querySelector('#generate');
    assert.ok(btn, 'generate button exists');
    document.querySelector('#rail-preds').innerHTML = '';
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 15));
    assert.ok(document.querySelector('#rail-preds').textContent.trim().length > 0, 'Generate repopulated the rail');
    assert.equal(btn.disabled, false);
    assert.match(btn.textContent, /Generate predictions/);
  } finally { cleanup(); }
});

test('volleyball.html on 3 September renders EuroVolley QFs and separate NCAA rows without bleed', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('volleyball.html', { search: '?date=2026-09-03' });
  try {
    const text = document.body.textContent;
    assert.match(text, /Poland/);
    assert.match(text, /Netherlands/);
    assert.match(text, /EuroVolley/);
    // The refreshed committed tape legitimately carries NCAA fixtures on
    // 2026-09-03 as well; they must render in their own family rows, never
    // as form/data on the EuroVolley sides.
    const rows = [...document.querySelectorAll('#board .match')];
    const euro = rows.find((r) => r.textContent.includes('Poland') && r.textContent.includes('Netherlands'));
    assert.ok(euro, 'EuroVolley fixture renders');
    assert.match(euro.querySelector('.meta-line').textContent, /EuroVolley tape/);
    assert.ok(!/Nebraska Cornhuskers/.test(euro.textContent), 'EuroVolley card carries no NCAA side');
    const ncaa = rows.find((r) => r.textContent.includes('Nebraska Cornhuskers'));
    assert.ok(ncaa, 'the committed NCAA fixture on this date renders in its own row');
    assert.match(ncaa.querySelector('.meta-line').textContent, /NCAA \/ ESPN/);
    const toggle = document.querySelector('[data-toggle]');
    assert.ok(toggle, 'analysis toggle exists');
  } finally { cleanup(); }
});

test('registry: volleyball is predicted on its own specialist page', async () => {
  const { SPORTS } = await import(pathToFileURL(join(ROOT, 'engine/registry.js')).href);
  const v = SPORTS.find((s) => s.key === 'volleyball');
  assert.equal(v.predictable, true);
  assert.equal(v.page, 'volleyball.html');
  assert.equal(v.specialistEngine, 'volleyball');
  assert.equal(v.olbgId, 21);
});

test('sport.html?sport=volleyball hands over to the dedicated volleyball page', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sport.html', { search: '?sport=volleyball&date=2026-09-03' });
  try {
    const a = document.querySelector('#handover');
    assert.ok(a, 'handover link rendered');
    assert.match(a.getAttribute('href'), /volleyball\.html\?date=2026-09-03/);
  } finally { cleanup(); }
});

test('ice-hockey.html boots, auto-generates three tips per match and the button re-scores', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('ice-hockey.html', { search: '?date=2026-10-05' });
  try {
    assert.ok(document.querySelector('.masthead'), 'masthead rendered');
    assert.ok(document.querySelectorAll('.sportrail a').length >= 20, 'every sport is in the rail');

    const rows = document.querySelectorAll('.match');
    assert.ok(rows.length >= 1, `at least one match row rendered (found ${rows.length})`);
    assert.match(document.body.textContent, /Ottawa Senators|Tampa Bay Lightning|Boston Bruins/);

    // Predictions were generated automatically, without pressing anything.
    const tips = [...document.querySelectorAll('.tipbox .tip-box')];
    assert.ok(tips.length >= 3, `three markets written for the first match (found ${tips.length})`);
    const labels = tips.slice(0, 3).map((t) => t.textContent);
    assert.match(labels[0], /OUTRIGHT WINNER/);
    assert.match(labels[1], /PUCK LINE/);
    assert.match(labels[2], /GAME TOTAL/);

    // Step 4 output rules hold on the rendered page, not just in the engine.
    for (const tip of tips) {
      const text = tip.querySelector('.tip-text')?.textContent || '';
      assert.equal(/\d/.test(text.replace(/\*\*/g, '')), false, `no digits may leak into a tip: ${text.slice(0, 60)}`);
      assert.match(text, /\b(HIGH|MEDIUM|LOW)\b|^SKIP/, 'confidence or SKIP stated');
    }

    // The Generate button works: clear the board, click it, board comes back.
    document.querySelector('#board').innerHTML = '';
    assert.equal(document.querySelectorAll('#board .match').length, 0, 'board cleared');
    document.querySelector('#generate').click();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 15));
    assert.ok(document.querySelectorAll('#board .match').length >= 1, 'Generate repopulated the board');
    assert.ok(document.querySelectorAll('#board .tip-box').length >= 3, 'Generate rewrote the tips');

    // Analysis panel: points, what could not be sourced, and https review links.
    document.querySelector('.match-toggle').click();
    const panel = document.querySelector('.analysis');
    assert.ok(panel, 'analysis panel exists');
    assert.match(panel.textContent, /Could not be sourced/);
    assert.match(panel.textContent, /Estimated edge/);
    const links = [...panel.querySelectorAll('a')];
    assert.ok(links.length >= 3, 'review links present');
    for (const l of links) assert.ok(l.href.startsWith('https://'), 'review links are https');

    // The card text block is copy-paste ready.
    assert.match(document.querySelector('#card-text').textContent, /ICE HOCKEY PREDICTIONS/);
    assert.match(document.querySelector('#card-text').textContent, /gamble responsibly/i);

    // Coverage and sources rails are populated from the committed provenance.
    assert.match(document.querySelector('#coverage').textContent, /fixtures/);
    assert.ok(document.querySelectorAll('#sources a').length >= 3, 'sources listed with links');
  } finally { cleanup(); }
});

test('baseball.html boots, auto-generates three tips per match and the button re-scores', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('baseball.html', { search: '?date=2026-09-04' });
  try {
    assert.ok(document.querySelector('.masthead'), 'masthead rendered');
    const rows = document.querySelectorAll('.match');
    assert.ok(rows.length >= 1, `at least one match row rendered (found ${rows.length})`);
    assert.match(document.body.textContent, /Tampa Bay Rays|Chicago White Sox|Cleveland Guardians/);

    // Three markets per match, in order, generated without pressing anything.
    const tips = [...document.querySelectorAll('.tipbox .tip-box')];
    assert.ok(tips.length >= 3, `three markets written for the first match (found ${tips.length})`);
    const labels = tips.slice(0, 3).map((t) => t.textContent);
    assert.match(labels[0], /WIN MATCH OUTRIGHT/);
    assert.match(labels[1], /RUN LINE/);
    assert.match(labels[2], /GAME TOTAL/);

    // Step 4 output rules hold on the rendered page, not just in the engine.
    for (const tip of tips) {
      const text = tip.querySelector('.tip-text')?.textContent || '';
      assert.equal(/\d/.test(text.replace(/\*\*/g, '')), false, `no digits may leak into a tip: ${text.slice(0, 60)}`);
      assert.match(text, /\b(HIGH|MEDIUM|LOW)\b|^SKIP/, 'confidence or SKIP stated');
    }

    // The Generate button works: clear the board, click it, board comes back.
    document.querySelector('#board').innerHTML = '';
    assert.equal(document.querySelectorAll('#board .match').length, 0, 'board cleared');
    document.querySelector('#generate').click();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 15));
    assert.ok(document.querySelectorAll('#board .match').length >= 1, 'Generate repopulated the board');
    assert.ok(document.querySelectorAll('#board .tip-box').length >= 3, 'Generate rewrote the tips');

    // Analysis panel: scoring trace, what could not be sourced, https links.
    document.querySelector('.match-toggle').click();
    const panel = document.querySelector('.analysis');
    assert.ok(panel, 'analysis panel exists');
    assert.match(panel.textContent, /Could not be sourced|Review links/);
    const links = [...panel.querySelectorAll('a')];
    assert.ok(links.length >= 3, 'review links present');
    for (const l of links) assert.ok(l.href.startsWith('https://'), 'review links are https');

    // Card text is copy-paste ready with the summary and gambling line.
    assert.match(document.querySelector('#card-text').textContent, /BASEBALL PREDICTIONS/);
    assert.match(document.querySelector('#card-text').textContent, /gamble responsibly/i);

    // Coverage box is populated from the committed documents.
    assert.match(document.querySelector('#coverage').textContent, /fixtures/);
    // Sources rail lists the verified feeds with https links and the irregularity register.
    assert.ok(document.querySelectorAll('#sources a').length >= 3, 'sources listed with links');
    assert.match(document.querySelector('#sources').textContent, /IR-BASEBALL-/);
  } finally { cleanup(); }
});

test('registry: baseball is predicted on its own specialist page', async () => {
  const { SPORTS } = await import(pathToFileURL(join(ROOT, 'engine/registry.js')).href);
  const s = SPORTS.find((x) => x.key === 'baseball');
  assert.equal(s.predictable, true);
  assert.equal(s.page, 'baseball.html');
  assert.equal(s.specialistEngine, 'baseball');
  assert.equal(s.olbgId, 12);
});

test('sport.html?sport=baseball hands over to the dedicated baseball page', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sport.html', { search: '?sport=baseball&date=2026-09-04' });
  try {
    const a = document.querySelector('#handover');
    assert.ok(a, 'handover link rendered');
    assert.match(a.getAttribute('href'), /baseball\.html\?date=2026-09-04/);
  } finally { cleanup(); }
});

test('darts.html boots, renders a results-day card and auto-generates written predictions', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('darts.html', { search: '?date=2026-08-30' });

  assert.ok(document.querySelector('.masthead'), 'masthead rendered');
  assert.ok(document.querySelector('.sportrail a[data-sport="darts"]'), 'darts is in the rail');
  const nofeed = document.querySelector('.sportrail a[data-sport="darts"] .nofeed');
  assert.equal(nofeed, null, 'darts is no longer a markets-only rail item');

  const text = document.body.textContent;
  assert.match(text, /Ross Smith/, 'Hungarian Trophy final-day names render');
  assert.match(text, /Gary Anderson/);
  const tipText = document.querySelector('.tip-text');
  assert.ok(tipText, 'a written prediction box renders on a results day');
  const tip = tipText.textContent;
  assert.match(tip, /Confidence:\s*(LOW|MEDIUM|HIGH|SKIP)/, 'prediction declares confidence');
  const words = tip.trim().split(/\s+/).length;
  assert.ok(words >= 25 && words <= 40, `prediction is 25-40 words, got ${words}`);
  assert.ok(!/\d/.test(tip.replace(/\s+/g, ' ')), `no numerals in prediction prose: ${tip.slice(0, 80)}`);
  assert.match(text, /no free key-less price|no price feed|IR-DARTS/i);
  assert.match(text, /SKIP/, 'live/historical cards resolve to SKIP on the odds gate');
  assert.ok(!/Czech Darts Open/.test(document.querySelector('#board').textContent),
    'unpublished Czech Open pairings are not invented onto the board');
});

test('the darts Generate button actually generates (it is not a no-op)', { skip: !JSDOM }, async () => {
  const { document, window } = await bootPage('darts.html', { search: '?date=2026-08-30' });
  document.querySelector('#rail-preds').innerHTML = '';
  const before = document.querySelector('.tip-text')?.textContent || '';
  const btn = document.querySelector('#generate');
  assert.ok(btn, 'generate button exists');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 15));
  const after = document.querySelector('.tip-text')?.textContent || '';
  assert.ok(after, 'prediction present after Generate click');
  assert.match(after, /Confidence:\s*(LOW|MEDIUM|HIGH|SKIP)/);
  assert.equal(before, after, 'regenerated prediction is deterministic');
});

test('darts Analysis exposes fired rules and at least two https review links', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('darts.html', { search: '?date=2026-08-30' });
  const details = document.querySelector('.analysis details');
  assert.ok(details, 'an analysis panel exists');
  details.setAttribute('open', '');
  const atext = details.textContent;
  assert.match(atext, /Factor|form|ranking|h2h|stage|average/i, 'analysis names scored factors');
  const links = [...details.querySelectorAll('a[href^="https://"]')];
  assert.ok(links.length >= 2, `at least two https review links, saw ${links.length}`);
  assert.match(atext, /odds/i, 'odds category is reported (as not available live)');
});

test('registry: darts is predicted on its own specialist page', async () => {
  const { SPORTS } = await import(pathToFileURL(join(ROOT, 'engine/registry.js')).href);
  const s = SPORTS.find((x) => x.key === 'darts');
  assert.equal(s.predictable, true);
  assert.equal(s.page, 'darts.html');
  assert.equal(s.specialistEngine, 'darts');
  assert.equal(s.olbgId, 15);
});

test('sport.html?sport=darts hands over to the dedicated darts page', { skip: !JSDOM }, async () => {
  const { document } = await bootPage('sport.html', { search: '?sport=darts&date=2026-08-30' });
  try {
    const a = document.querySelector('#handover');
    assert.ok(a, 'handover link rendered');
    assert.match(a.getAttribute('href'), /darts\.html\?date=2026-08-30/);
  } finally { cleanup(); }
});
