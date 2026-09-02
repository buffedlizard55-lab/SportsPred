/**
 * Golf source parsers — verified against trimmed excerpts of live ESPN
 * responses (tests/fixtures/espn_golf_leaderboard*.EXCERPT.json) and the OWGR
 * / ESPN statistics payload shapes observed on 2026-09-02.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseLeaderboard, parseGolfScoreboard, parseCoreEvent, parseByAthleteStats, parseOwgr,
  parseToPar, resultCode, toResultRow, fromResultRow, leaderboardToEvent, parsePgaTourStatPage,
  leaderboardUrl, scoreboardUrl, GOLF_TOURS,
} from '../engine/golf_espn.js';

const here = dirname(fileURLToPath(import.meta.url));
const post = JSON.parse(readFileSync(join(here, 'fixtures/espn_golf_leaderboard.EXCERPT.json'), 'utf8'));
const pre = JSON.parse(readFileSync(join(here, 'fixtures/espn_golf_leaderboard_pre.EXCERPT.json'), 'utf8'));

test('parseToPar handles every display form ESPN uses', () => {
  assert.equal(parseToPar('-9'), -9);
  assert.equal(parseToPar('+4'), 4);
  assert.equal(parseToPar('E'), 0);
  assert.equal(parseToPar('-'), null);
  assert.equal(parseToPar(null), null);
});

test('completed leaderboard: event facts, positions, result codes and rounds', () => {
  const lb = parseLeaderboard(post);
  assert.equal(lb.id, '401811964');
  assert.equal(lb.tour, 'pga');
  assert.equal(lb.state, 'post');
  assert.equal(lb.completed, true);
  assert.equal(lb.tournamentId, '46');
  assert.equal(lb.major, false);
  assert.equal(lb.purse, 40000000);
  assert.equal(lb.course.name, 'East Lake Golf Club');
  assert.equal(lb.course.yards, 7440);
  assert.equal(lb.course.par, 70);
  assert.equal(lb.course.city, 'Atlanta');
  assert.equal(lb.winner.athleteId, '9478');
  assert.equal(lb.sources.espnLeaderboard, 'https://www.espn.com/golf/leaderboard?tournamentId=401811964');

  const x = lb.field.find((p) => p.athleteId === '10140');
  assert.equal(x.name, 'Xander Schauffele');
  assert.equal(x.result, 'F');
  assert.equal(x.position, 14);
  assert.equal(x.positionText, 'T14');
  assert.equal(x.tie, true);
  assert.equal(x.toPar, -9);
  assert.equal(x.strokes, 271);
  assert.equal(x.country, 'USA');
  assert.equal(x.countryCode, 'USA');
  assert.deepEqual(x.rounds.map((r) => r.strokes), [67, 71, 67, 66]);
  assert.equal(x.rounds[0].teeTime, '2026-08-27T16:54Z');
  assert.equal(x.earnings, 536250);

  const wd = lb.field.find((p) => p.athleteId === '10166');
  assert.equal(wd.result, 'WD');
  assert.equal(wd.position, null, 'a withdrawal has no finishing position');
  // 23 strokes over nine holes must not be read as a completed round
  assert.equal(wd.rounds[0].strokes, 23);
  assert.equal(wd.rounds[1].strokes, null);

  assert.equal(lb.leaders.find((l) => l.stat === 'driveDistAvg').leader, 'Rory McIlroy');
});

test('upcoming leaderboard: scheduled field with tee times and no positions', () => {
  const lb = parseLeaderboard(pre);
  assert.equal(lb.tour, 'eur');
  assert.equal(lb.state, 'pre');
  assert.equal(lb.tournamentId, '3383');
  assert.equal(lb.cut.round, 2);
  assert.equal(lb.course.yards, 6830);
  assert.equal(lb.field.length, 4);
  for (const p of lb.field) {
    assert.equal(p.result, 'scheduled');
    assert.equal(p.position, null);
    assert.equal(p.toPar, null);
    assert.ok(p.teeTime, 'tee time carried');
  }
  const hill = lb.field.find((p) => p.name === 'Calum Hill');
  assert.equal(hill.country, 'Scotland');
  assert.equal(hill.countryCode, 'SCT');
  assert.equal(hill.teeTime, '2026-09-03T11:55Z');
  assert.equal(lb.defendingChampion.name, 'Thriston Lawrence');
});

test('resultCode never invents a finish', () => {
  assert.equal(resultCode({ status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } } }), 'scheduled');
  assert.equal(resultCode({ status: { type: { state: 'in' } } }), 'active');
  assert.equal(resultCode({ status: { type: { state: 'post', shortDetail: 'CUT' } } }), 'CUT');
  assert.equal(resultCode({ status: { type: { state: 'post', shortDetail: 'DQ' } } }), 'DQ');
  assert.equal(resultCode({ status: { type: { state: 'post', name: 'STATUS_FINISH', completed: true } } }), 'F');
  assert.equal(resultCode({}), 'scheduled');
});

test('leaderboard -> event document -> compact result rows round-trip', () => {
  const lb = parseLeaderboard(post);
  const ev = leaderboardToEvent(lb, { isSignature: true, purse: 40000000 }, { fetchedAt: '2026-09-02T00:00:00Z' });
  assert.equal(ev.isSignature, true);
  assert.equal(ev.field.length, 3);
  assert.equal(ev.sources.core, 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401811964');
  const row = toResultRow(lb.field[0]);
  assert.deepEqual(row, ['10140', 14, 'F', -9, 67, 71, 67, 66]);
  const back = fromResultRow(row);
  assert.equal(back.athleteId, '10140');
  assert.equal(back.position, 14);
  assert.deepEqual(back.rounds, [67, 71, 67, 66]);
  assert.deepEqual(toResultRow(lb.field[1]), ['10166', null, 'WD', 4, 23, null, null, null]);
});

test('scoreboard payload: season, calendar and day events', () => {
  const payload = {
    leagues: [{ id: '1106', slug: 'pga', name: 'PGA TOUR', season: { year: 2026, startDate: '2026-01-08T05:00Z', endDate: '2026-12-13T05:00Z', displayName: '2026' },
      calendar: [{ id: '401811964', label: 'TOUR Championship', startDate: '2026-08-27T07:00Z', endDate: '2026-08-30T07:00Z' }, { id: '401850914', label: 'Biltmore Championship', startDate: '2026-09-17T07:00Z', endDate: '2026-09-20T07:00Z' }] }],
    day: { date: '2026-09-01' },
    events: [{ id: '401850914', name: 'Biltmore Championship', date: '2026-09-17T04:00Z', endDate: '2026-09-20T04:00Z', status: { type: { state: 'pre', completed: false } }, competitions: [{ competitors: [] }], links: [{ rel: ['summary'], href: 'https://www.espn.com/golf/leaderboard?tournamentId=401850914' }] }],
  };
  const sb = parseGolfScoreboard(payload, { tour: 'pga' });
  assert.equal(sb.tour, 'pga');
  assert.equal(sb.season.year, 2026);
  assert.equal(sb.calendar.length, 2);
  assert.equal(sb.calendar[1].id, '401850914');
  assert.equal(sb.events[0].state, 'pre');
  assert.equal(sb.events[0].fieldSize, 0);
});

test('core event exposes only the flags the site payload lacks', () => {
  const core = parseCoreEvent({ id: '401822700', isSignature: false, isCupPlayoff: false, purse: 3250000.0, hasPlayerStats: false, competitions: [{ scoringSystem: { name: 'Medal' } }] });
  assert.deepEqual(core, { id: '401822700', isSignature: false, isCupPlayoff: false, purse: 3250000, scoringSystem: 'Medal', hasPlayerStats: false });
  assert.equal(parseCoreEvent(null), null);
});

test('ESPN byathlete statistics align values to column names', () => {
  const payload = {
    pagination: { count: 573, limit: 50, page: 1, pages: 12 },
    athletes: [{ athlete: { id: '9037', displayName: 'Matt Fitzpatrick', flag: { alt: 'England' } }, categories: [{ name: 'general', values: [1.4679817E7, 3463.0, 21.0, 78.0, 19.0, 8.0, 3.0, 69.03846, 306.3, 66.42066, 69.72935, 1.7568948, null, 51.53846, 4.1666665] }], lastTournament: { name: 'TOUR Championship' } }],
    requestedSeason: { year: 2026 },
    categories: [{ name: 'general', names: ['amount', 'cupPoints', 'tournamentsPlayed', 'roundsPlayed', 'cutsMade', 'topTenFinishes', 'wins', 'scoringAverage', 'yardsPerDrive', 'driveAccuracyPct', 'greensInRegPct', 'strokesPerHole', 'sandSaves', 'savePct', 'birdiesPerRound'] }],
    lastUpdated: '2026/08/31',
  };
  const st = parseByAthleteStats(payload);
  assert.equal(st.season, 2026);
  assert.equal(st.pages, 12);
  assert.equal(st.rows[0].athleteId, '9037');
  assert.equal(st.rows[0].stats.yardsPerDrive, 306.3);
  assert.equal(st.rows[0].stats.wins, 3);
  assert.equal(st.rows[0].stats.sandSaves, null, 'null stays null');
});

test('OWGR payload parses rank, country, region and trajectory fields', () => {
  const payload = { rankingsList: [{ rank: 2, player: { id: 10091, firstName: 'Rory', lastName: 'McIlroy', fullName: 'Rory McIlroy', isAmateur: false, country: { name: 'Northern Ireland', code3: 'NIR', region: { name: 'Europe' } } }, pointsAverage: 9.0956, pointsTotal: 391.1, lastWeekRank: 2, endLastYearRank: 2 }], totalNumberOfRankings: 9510, totalNumberOfPages: 10 };
  const r = parseOwgr(payload);
  assert.equal(r.total, 9510);
  assert.equal(r.rows[0].rank, 2);
  assert.equal(r.rows[0].countryCode, 'NIR');
  assert.equal(r.rows[0].region, 'Europe');
  assert.equal(r.rows[0].profileUrl, 'https://www.owgr.com/playerprofile/rory-mcilroy-10091');
});

test('PGA TOUR stat page parser is conservative: returns [] below the row floor', () => {
  assert.deepEqual(parsePgaTourStatPage('<html><body>no table</body></html>'), []);
  const rows = Array.from({ length: 60 }, (_, i) => `<tr><td>${i + 1}</td><td>-</td><td>Player ${i}</td><td>${(1 - i * 0.02).toFixed(3)}</td><td>${(40 - i).toFixed(3)}</td><td>${50 + i}</td></tr>`).join('');
  const parsed = parsePgaTourStatPage(`<html><table>${rows}</table></html>`);
  assert.equal(parsed.length, 60);
  assert.equal(parsed[0].name, 'Player 0');
  assert.equal(parsed[0].avg, 1);
  assert.equal(parsed[0].rounds, 50);
});

test('endpoint builders and tour table', () => {
  assert.equal(leaderboardUrl('eur', '401822700'), 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=eur&event=401822700');
  assert.equal(scoreboardUrl('pga', '20260827'), 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20260827');
  assert.equal(GOLF_TOURS.pga.espnLeagueId, '1106');
  assert.equal(GOLF_TOURS.eur.espnLeagueId, '7002');
  assert.equal(GOLF_TOURS.lpga.predictable, false);
});
