/**
 * Tests for the baseball join layer (engine/baseball_data.js) and the feed
 * parsers (engine/baseball_espn.js), using shapes transcribed from live,
 * verified responses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichBaseballFixture, buildBaseballCard, matchSlateEvent, normalizeTeamName,
} from '../engine/baseball_data.js';
import {
  parseMlbSchedule, parseMlbStandings, parseMlbTeamStats, parseMlbPitcherGameLog,
  parseMlbPitcherSeason, parseEspnMlbScoreboard, scheduleFactors, headToHeadFromTape,
} from '../engine/baseball_espn.js';

/* ---------------- MLB schedule parser ---------------- */

const schedulePayload = {
  dates: [{
    date: '2026-09-02',
    games: [{
      gamePk: 824470, gameDate: '2026-09-02T16:40:00Z', season: '2026',
      status: { abstractGameState: 'Final' },
      venue: { id: 2602, name: 'Great American Ball Park' },
      teams: {
        away: { team: { id: 135, name: 'San Diego Padres', abbreviation: 'SD' }, leagueRecord: { wins: 73, losses: 67, pct: '.521' }, score: 3, isWinner: false, probablePitcher: { id: 663554, fullName: 'Casey Mize' } },
        home: { team: { id: 113, name: 'Cincinnati Reds', abbreviation: 'CIN' }, leagueRecord: { wins: 67, losses: 73, pct: '.479' }, score: 7, isWinner: true, probablePitcher: { id: 682227, fullName: 'Brandon Williamson' } },
      },
    }],
  }],
};

test('parseMlbSchedule: a final game becomes a results fixture with scores and probables', () => {
  const { games, warnings } = parseMlbSchedule(schedulePayload);
  assert.equal(games.length, 1);
  assert.equal(games[0].phase, 'results');
  assert.equal(games[0].home.name, 'Cincinnati Reds');
  assert.equal(games[0].away.probablePitcher.name, 'Casey Mize');
  assert.equal(warnings.length, 0);
});

/* ---------------- standings parser ---------------- */

const standingsPayload = {
  records: [{
    teamRecords: [{
      team: { id: 139, name: 'Rays' },
      wins: 83, losses: 56, gamesPlayed: 139, runDifferential: 51, runsScored: 628, runsAllowed: 577,
      streak: { streakCode: 'L1', streakNumber: 1 },
      records: { splitRecords: [{ wins: 47, losses: 25, type: 'home', pct: '.653' }, { wins: 7, losses: 3, type: 'lastTen', pct: '.700' }] },
    }],
  }],
};

test('parseMlbStandings: run differential and split records are read', () => {
  const { teams, count } = parseMlbStandings(standingsPayload);
  assert.equal(count, 1);
  assert.equal(teams['139'].runDifferential, 51);
  assert.equal(teams['139'].home.wins, 47);
  assert.equal(teams['139'].lastTen.wins, 7);
});

/* ---------------- team stats parser ---------------- */

const hittingPayload = {
  stats: [{ splits: [{ stat: { gamesPlayed: 139, runs: 628, avg: '.261', obp: '.329', slg: '.404', ops: '.733' }, team: { id: 139, name: 'Tampa Bay Rays' } }] }],
};
const pitchingPayload = {
  stats: [{ splits: [{ stat: { gamesPlayed: 140, era: '3.24', whip: '1.17', strikeoutsPer9Inn: '9.03', runs: 521 }, team: { id: 147, name: 'New York Yankees' } }] }],
};

test('parseMlbTeamStats: hitting and pitching groups are keyed by team id', () => {
  const h = parseMlbTeamStats(hittingPayload, 'hitting');
  assert.equal(h.teams['139'].hitting.avg, 0.261);
  const p = parseMlbTeamStats(pitchingPayload, 'pitching');
  assert.equal(p.teams['147'].pitching.era, 3.24);
  assert.equal(p.teams['147'].pitching.whip, 1.17);
});

/* ---------------- pitcher game log parser ---------------- */

const gameLogPayload = {
  stats: [{
    splits: [
      { date: '2026-09-01', stat: { inningsPitched: '6.0', earnedRuns: 1, strikeOuts: 9, baseOnBalls: 2, hits: 4, numberOfPitches: 93, isWin: true, gamesStarted: 1 }, opponent: { name: 'Arizona Diamondbacks' } },
      { date: '2026-08-26', stat: { inningsPitched: '6.2', earnedRuns: 0, strikeOuts: 7, baseOnBalls: 1, hits: 3, numberOfPitches: 94, isWin: false, gamesStarted: 1 }, opponent: { name: 'Boston Red Sox' } },
      { date: '2026-08-20', stat: { inningsPitched: '7.0', earnedRuns: 2, strikeOuts: 8, baseOnBalls: 1, hits: 5, numberOfPitches: 100, isWin: true, gamesStarted: 1 }, opponent: { name: 'Miami Marlins' } },
      { date: '2026-08-14', stat: { inningsPitched: '4.1', earnedRuns: 5, strikeOuts: 4, baseOnBalls: 3, hits: 7, numberOfPitches: 90, isWin: false, gamesStarted: 1 }, opponent: { name: 'Minnesota Twins' } },
    ],
  }],
};

test('parseMlbPitcherGameLog: quality starts and the last-4 window are derived', () => {
  const gl = parseMlbPitcherGameLog(gameLogPayload);
  assert.equal(gl.last4.length, 4);
  assert.equal(gl.qualityStartsLast4, 3); // 6.0/1, 6.2/0, 7.0/2 are QS; 4.1/5 is not
});

const seasonPayload = { stats: [{ splits: [{ stat: { era: '3.24', whip: '1.17', strikeoutsPer9Inn: '9.03', wins: 15, losses: 4, inningsPitched: '156.1' } }] }] };
test('parseMlbPitcherSeason: season era/whip/k9 are read', () => {
  const s = parseMlbPitcherSeason(seasonPayload);
  assert.equal(s.era, 3.24);
  assert.equal(s.strikeoutsPer9Inn, 9.03);
});

/* ---------------- ESPN scoreboard parser ---------------- */

const espnPayload = {
  events: [{
    id: '401877193', date: '2026-09-04T18:10Z',
    competitions: [{
      date: '2026-09-04T18:10Z',
      venue: { fullName: 'Progressive Field', indoor: false },
      weather: { displayValue: 'Intermittent clouds', temperature: 78 },
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'CLE', displayName: 'Cleveland Guardians' }, records: [{ name: 'overall', summary: '70-69' }, { name: 'Home', summary: '33-37' }], probables: [{ name: 'probableStartingPitcher', athlete: { fullName: 'Foster Griffin' }, statistics: [{ name: 'wins', displayValue: '15' }, { name: 'ERA', displayValue: '3.21' }], record: '(15-4, 3.21)' }], statistics: [{ name: 'runs', displayValue: '563' }, { name: 'avg', displayValue: '.237' }, { name: 'ERA', displayValue: '3.70' }] },
        { homeAway: 'away', team: { abbreviation: 'DET', displayName: 'Detroit Tigers' }, records: [{ name: 'overall', summary: '64-75' }], probables: [{ name: 'probableStartingPitcher', athlete: { fullName: 'Keider Montero' }, statistics: [{ name: 'ERA', displayValue: '3.24' }], record: '(9-8, 3.24)' }], statistics: [{ name: 'runs', displayValue: '599' }] },
      ],
    }],
  }],
};

test('parseEspnMlbScoreboard: venue, weather and probable-starter ERA are read', () => {
  const rows = parseEspnMlbScoreboard(espnPayload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].venueIndoor, false);
  assert.equal(rows[0].home.starter.era, 3.21);
  assert.equal(rows[0].home.records.overall, '70-69');
});

/* ---------------- tape-derived factors ---------------- */

function tape() {
  const games = [];
  const mk = (i, abbrevA, abbrevB, scoreA, scoreB, iso) => ({
    id: String(i), phase: 'results', dateISO: iso, startUtc: `${iso}T18:00Z`,
    home: { abbrev: abbrevA, name: abbrevA }, away: { abbrev: abbrevB, name: abbrevB },
    score: { home: scoreA, away: scoreB },
  });
  for (let i = 0; i < 6; i += 1) games.push(mk(i, 'TB', 'NYY', 6, 2, `2026-08-${String(24 - i).padStart(2, '0')}`));
  games.push(mk(9, 'TB', 'BOS', 3, 4, '2026-09-01')); // a recent loss
  return games;
}

test('scheduleFactors: last-5 form, win streak and last-month run differential are leak-free', () => {
  const f = scheduleFactors(tape(), 'TB', '2026-09-04T18:00Z');
  assert.equal(f.form.last5[0], 'L'); // most recent game was the loss
  assert.equal(f.form.last5.slice(1).every((r) => r === 'W'), true);
  assert.ok(f.runDiffPerGame > 0);
  assert.ok(f.avgWinMarginLast5Wins > 2);
});

test('headToHeadFromTape: counts meetings and the last-3 streak before the fixture', () => {
  const t = tape();
  const h = headToHeadFromTape(t, 'TB', 'NYY', '2026-09-04T18:00Z');
  assert.equal(h.meetings, 6);
  assert.equal(h.last10WinsA, 6);
  assert.equal(h.last3StreakA, true);
});

/* ---------------- data layer ---------------- */

const fixture = {
  id: '824470', source: 'mlb-statsapi-schedule', league: 'mlb', leagueName: 'Major League Baseball',
  dateISO: '2026-09-04', startUtc: '2026-09-04T18:10Z', phase: 'upcoming', venue: 'Progressive Field',
  home: { id: 113, name: 'Cincinnati Reds', abbrev: 'CIN', record: { wins: 67, losses: 73 }, probablePitcher: { id: 682227, name: 'Brandon Williamson' } },
  away: { id: 116, name: 'Detroit Tigers', abbrev: 'DET', record: { wins: 64, losses: 75 }, probablePitcher: { id: 663554, name: 'Casey Mize' } },
  score: { home: null, away: null },
  odds: null, oddsSourceCount: 0,
};

test('enrichBaseballFixture: joins standings, team stats, pitchers and the tape without inventing', () => {
  const docs = {
    standings: { teams: { 113: { id: 113, name: 'Reds', wins: 67, losses: 73, gamesPlayed: 140, runDifferential: -40, runsScored: 574, runsAllowed: 614 } } },
    teamStats: { teams: { 113: { id: 113, name: 'Reds', hitting: { avg: 0.228, obp: 0.30, slg: 0.39 } } } },
    pitchers: { 682227: { id: 682227, name: 'Brandon Williamson', era: 5.14, whip: 1.4, qualityStartsLast4: 0, qualityStartsLast3: 0, avgInningsPerStart: 4.6, last4: [] } },
    tape: { games: tape() },
    slate: null,
  };
  const m = enrichBaseballFixture(fixture, docs);
  assert.equal(m.home.starter.name, 'Brandon Williamson');
  assert.equal(m.home.starter.confirmed, true);
  assert.equal(m.home.avg, 0.228);
  assert.equal(m.home.bullpenRank, null); // never invented
  assert.equal(m.oddsSourceCount, 0);
});

test('matchSlateEvent: joins an OLBG row to a fixture by team names', () => {
  const slate = { events: [{ home: 'Detroit Tigers', away: 'Cincinnati Reds', url: 'https://www.olbg.com/x' }] };
  assert.equal(matchSlateEvent({ home: { name: 'Cincinnati Reds' }, away: { name: 'Detroit Tigers' } }, slate).url, 'https://www.olbg.com/x');
});

test('buildBaseballCard: produces a scored and written card with three tips per match', () => {
  const docs = {
    standings: { teams: {} },
    teamStats: { teams: {} },
    pitchers: {},
    tape: { games: [] },
    slate: null,
    fixtures: { fixtures: [{ ...fixture, home: { ...fixture.home, record: null }, away: { ...fixture.away, record: null }, dateISO: '2026-09-04' }] },
  };
  const card = buildBaseballCard(docs, { dateISO: '2026-09-04' });
  assert.equal(card.matches.length, 1);
  assert.equal(card.written.tips.length, 3);
  assert.match(card.written.tips[0].label, /WIN MATCH OUTRIGHT/);
});
