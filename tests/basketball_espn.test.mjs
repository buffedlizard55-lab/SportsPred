import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEspnBasketballStandings } from '../engine/basketball_espn.js';

// A faithful excerpt of the LIVE NBA standings payload read 2026-09-03 from
// https://site.api.espn.com/apis/v2/sports/basketball/nba/standings
// (Eastern Conference only, top two teams, verified values — not synthesised).
const NBA_STANDINGS_EXCERPT = {
  children: [
    {
      name: 'Eastern Conference',
      isConference: true,
      standings: {
        entries: [
          {
            team: { displayName: 'Detroit Pistons', abbreviation: 'DET' },
            stats: [
              { name: 'winPercent', type: 'winpercent', value: 0.73170733 },
              { name: 'avgPointsFor', type: 'avgpointsfor', value: 117.768295 },
              { name: 'avgPointsAgainst', type: 'avgpointsagainst', value: 109.60976 },
              { name: 'playoffSeed', type: 'playoffseed', value: 1.0 },
            ],
          },
          {
            team: { displayName: 'Atlanta Hawks', abbreviation: 'ATL' },
            stats: [
              { name: 'winPercent', type: 'winpercent', value: 0.5192308 },
              { name: 'avgPointsFor', type: 'avgpointsfor', value: 118.46342 },
              { name: 'avgPointsAgainst', type: 'avgpointsagainst', value: 116.04878 },
              { name: 'playoffSeed', type: 'playoffseed', value: 2.0 },
            ],
          },
        ],
      },
    },
    { name: 'Western Conference', isConference: true, standings: { entries: [] } },
  ],
};

test('parseEspnBasketballStandings assigns 1-based conference rank and stats', () => {
  const conferences = parseEspnBasketballStandings(NBA_STANDINGS_EXCERPT);
  assert.ok(conferences['Eastern Conference'], 'Eastern conference parsed');
  const teams = conferences['Eastern Conference'].teams;
  assert.equal(teams.length, 2);
  assert.equal(teams[0].name, 'Detroit Pistons');
  assert.equal(teams[0].rank, 1);
  assert.equal(teams[0].winPct, 0.73170733);
  assert.equal(teams[0].ppg, 117.768295);
  assert.equal(teams[0].oppPpg, 109.60976);
  assert.equal(teams[1].name, 'Atlanta Hawks');
  assert.equal(teams[1].rank, 2);
  // An empty conference is simply omitted (nothing invented).
  assert.equal(conferences['Western Conference'], undefined);
});

test('parseEspnBasketballStandings drops teams with no name and tolerates missing stats', () => {
  const conferences = parseEspnBasketballStandings({
    children: [{
      name: 'Eastern Conference',
      isConference: true,
      standings: { entries: [
        { team: { displayName: null }, stats: [] },
        { team: { displayName: 'Chicago Bulls' }, stats: [] },
      ] },
    }],
  });
  const teams = conferences['Eastern Conference'].teams;
  assert.equal(teams.length, 1);
  assert.equal(teams[0].name, 'Chicago Bulls');
  assert.equal(teams[0].rank, 2); // index in the raw array, after the dropped row
  assert.equal(teams[0].winPct, null);
  assert.equal(teams[0].ppg, null);
});

test('parseEspnBasketballStandings returns {} for an empty payload', () => {
  assert.deepEqual(parseEspnBasketballStandings({ children: [] }), {});
  assert.deepEqual(parseEspnBasketballStandings(null), {});
});
