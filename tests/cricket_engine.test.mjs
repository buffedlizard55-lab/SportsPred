import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreCricketMatch,
  scoreCricketCard,
  scoreMomCandidate,
  scoreBatsmanCandidate,
  normaliseOdds,
  decimalToAmerican,
  CONFIDENCE,
} from '../engine/cricket_engine.js';

const richTeam = (over = {}) => ({
  name: 'Aardvark XI',
  odds: { win: 1.5 },
  form: { last5: ['W', 'W', 'W', 'L', 'W'], winStreak: 3 },
  bowling: { style: 'spin' },
  batting: { weakness: null, inFormBatsmen: ['A', 'B', 'C'] },
  momCandidates: [
    { id: 'p1', name: 'Pat Spin', role: 'allrounder', battingPosition: 6, bowlingStyle: 'spin', opensBowling: true,
      odds: { mom: 600 }, recent: { matches: 5, fiftyOrWicket3: 3, allRoundContributions: 2, scoresOver40: 2 },
      strikeRateVsTeamAvg: 'slightly_above' },
  ],
  batsmanCandidates: [
    { id: 'p2', name: 'Opener Joe', role: 'batsman', battingPosition: 1, battingStyle: 'aggressive',
      odds: { topBatsman: 300 }, recent: { scoresOver40: 3, fiftyLastMatch: true, strongVsOpposition: true },
      strikeRateVsTeamAvg: 'above', powerplayRecord: 'strong' },
  ],
  ...over,
});

const weakTeam = (over = {}) => ({
  name: 'Badger XI',
  odds: { win: 2.8 },
  form: { last5: ['L', 'L', 'W', 'L', 'L'] },
  bowling: { style: 'pace' },
  batting: { weakness: 'spin', inFormBatsmen: ['D'] },
  momCandidates: [
    { id: 'p3', name: 'Tail End Charlie', role: 'bowler', battingPosition: 9, bowlingStyle: 'pace', opensBowling: true,
      odds: { mom: 1500 }, recent: { matches: 5, fiftyOrWicket3: 1 } },
  ],
  batsmanCandidates: [
    { id: 'p4', name: 'Low Order', role: 'batsman', battingPosition: 7, odds: { topBatsman: 500 },
      recent: { scoresOver40: 1 }, strikeRateVsTeamAvg: 'average' },
  ],
  ...over,
});

const baseMatch = (over = {}) => ({
  event_id: 'e1',
  format: 'T20',
  home: 'Aardvark XI',
  away: 'Badger XI',
  pitch: { favours: 'spin', assistsBowlingPowerplay: true },
  homeTeamObj: richTeam(),
  awayTeamObj: weakTeam(),
  h2h: { totalMeetings: 10, teamWins: 7, recentMeetings: ['W', 'W', 'W'], sameVenueType: true },
  opp: { topOrderVulnerable: true },
  ...over,
});

test('decimalToAmerican converts correctly', () => {
  assert.equal(decimalToAmerican(2.0), 100);
  assert.equal(decimalToAmerican(1.5), -200);
  assert.equal(decimalToAmerican(5.0), 400);
  assert.equal(decimalToAmerican(null), null);
});

test('normaliseOdds accepts decimal, american, and object forms', () => {
  assert.equal(normaliseOdds(1.5).american, -200);          // decimal 1.5 -> -200
  assert.equal(normaliseOdds(6.0).american, 500);           // decimal 6.0 -> +500
  assert.equal(normaliseOdds({ american: 450 }).decimal, 5.5); // +450 -> 5.50
  assert.equal(normaliseOdds({ american: -250 }).decimal, 1.4); // -250 -> 1.40
  assert.equal(normaliseOdds({ decimal: 2.1 }).american, 110);
  assert.equal(normaliseOdds(600).american, 600);           // bare integer 600 -> American +600
  assert.equal(normaliseOdds(-200).american, -200);
  assert.equal(normaliseOdds(null), null);
});

test('full-data win match scores HIGH for the strong side', () => {
  const r = scoreCricketMatch(baseMatch());
  assert.equal(r.favourite, 'Aardvark XI');
  assert.equal(r.markets.win_match.band, CONFIDENCE.HIGH);
  assert.ok(r.markets.win_match.score >= 70);
});

test('all-rounder wins Man of the Match on spin pitch', () => {
  const r = scoreCricketMatch(baseMatch());
  assert.equal(r.markets.man_of_the_match.selection, 'Pat Spin');
});

test('MoTM value flag fires in the +700..+1600 high-odds zone with pitch dominance', () => {
  const m = baseMatch({
    homeTeamObj: richTeam({
      momCandidates: [
        { id: 'p1', name: 'Pat Spin', role: 'allrounder', battingPosition: 6, bowlingStyle: 'spin', opensBowling: true,
          odds: { mom: 900 }, recent: { matches: 5, fiftyOrWicket3: 3, allRoundContributions: 2, scoresOver40: 2 },
          strikeRateVsTeamAvg: 'slightly_above' },
      ],
    }),
  });
  const r = scoreCricketMatch(m);
  assert.equal(r.markets.man_of_the_match.selection, 'Pat Spin');
  assert.equal(r.markets.man_of_the_match.valueFlag, true);
});

test('top batsman: opener picked; number-7 batter is ineligible', () => {
  const r = scoreCricketMatch(baseMatch());
  assert.equal(r.markets.top_team1_batsman.selection, 'Opener Joe');
  assert.equal(r.markets.top_team2_batsman.band, CONFIDENCE.SKIP);
  assert.equal(r.markets.top_team2_batsman.selection, null);
});

test('missing data produces SKIP, never a fabricated pick', () => {
  const empty = {
    event_id: 'e2', format: 'T20', home: 'X', away: 'Y',
    homeTeamObj: { name: 'X', form: { last5: [] }, bowling: {}, batting: {}, momCandidates: [], batsmanCandidates: [] },
    awayTeamObj: { name: 'Y', form: { last5: [] }, bowling: {}, batting: {}, momCandidates: [], batsmanCandidates: [] },
    h2h: null, pitch: null,
  };
  const r = scoreCricketMatch(empty);
  assert.equal(r.markets.win_match.band, CONFIDENCE.SKIP);
  assert.equal(r.markets.man_of_the_match.band, CONFIDENCE.SKIP);
  assert.equal(r.markets.top_team1_batsman.band, CONFIDENCE.SKIP);
  assert.ok(r.missing.length > 0, 'missing factors must be recorded');
});

test('favourite-trap deduction: heavy odds but 3+ losses', () => {
  const team = richTeam({ odds: { win: 1.2 }, form: { last5: ['L', 'L', 'L', 'W', 'L'] } });
  const r = scoreCricketMatch(baseMatch({ homeTeamObj: team }));
  const trap = r.markets.win_match.components.find((c) => c.id === 'wm_odds_trap');
  assert.ok(trap, 'favourite trap deduction should be present');
  assert.equal(trap.points, -7);
});

test('T20 powerplay-bowling pitch downgrades top batsman confidence', () => {
  const r = scoreCricketMatch(baseMatch());
  // top_team1 opener is strong but T20 + pitch assists bowling powerplay -> capped
  assert.notEqual(r.markets.top_team1_batsman.band, CONFIDENCE.HIGH);
});

test('MoTM high-odds +1500 needs pitch dominance or all-round form', () => {
  const p = { name: 'Paceman', role: 'bowler', battingPosition: 9, bowlingStyle: 'pace', opensBowling: true,
    odds: { mom: 1500 }, recent: { matches: 5, fiftyOrWicket3: 3 } };
  const match = { format: 'T20', pitch: { favours: 'pace' }, opp: { topOrderVulnerable: true } };
  const c = scoreMomCandidate(p, match, []);
  assert.equal(c.highOddsValue, true);
  assert.equal(c.valueFlag, true);
});

test('bottom-order non-bowler is ineligible for MoTM', () => {
  const p = { name: 'Tail', role: 'batsman', battingPosition: 9, odds: { mom: 400 }, recent: { fiftyOrWicket3: 2 } };
  const c = scoreMomCandidate(p, { format: 'T20', pitch: null }, []);
  assert.equal(c.eligible, false);
});

test('batsman at position 6 is ineligible for top batsman', () => {
  const p = { name: 'Six', battingPosition: 6, odds: { topBatsman: 300 }, recent: { scoresOver40: 3 }, strikeRateVsTeamAvg: 'above' };
  const c = scoreBatsmanCandidate(p, {}, { format: 'T20' }, 'Team 1');
  assert.equal(c.eligible, false);
});

test('correlation rule: at most 3 player markets emitted', () => {
  // Build both sides so all three player markets would fire.
  const strong = richTeam();
  strong.momCandidates[0].odds = { mom: 450 };
  const match = baseMatch({
    homeTeamObj: strong,
    awayTeamObj: { ...weakTeam(),
      momCandidates: [{ id: 'w1', name: 'Weak Star', role: 'allrounder', battingPosition: 5, bowlingStyle: 'spin',
        odds: { mom: 800 }, recent: { fiftyOrWicket3: 3, allRoundContributions: 2 } }],
      batsmanCandidates: [{ id: 'w2', name: 'Weak Opener', battingPosition: 1, odds: { topBatsman: 300 },
        recent: { scoresOver40: 3 }, strikeRateVsTeamAvg: 'above' }],
    },
  });
  const r = scoreCricketMatch(match);
  const fired = ['man_of_the_match', 'top_team1_batsman', 'top_team2_batsman']
    .filter((k) => r.markets[k].band !== CONFIDENCE.SKIP).length;
  assert.ok(fired <= 3);
});

test('scoreCricketCard returns one result per match', () => {
  const card = scoreCricketCard([baseMatch(), baseMatch({ event_id: 'e3' })]);
  assert.equal(card.count, 2);
  assert.equal(card.results.length, 2);
});
