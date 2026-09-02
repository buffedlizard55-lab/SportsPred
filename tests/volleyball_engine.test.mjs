import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  scoreVolleyballMatch,
  decimalToAmerican,
  americanToImpliedProb,
  normaliseOdds,
  CONFIDENCE,
  RULESET_VERSION,
} from '../engine/volleyball_engine.js';
import { parseVolleyballScoreboard } from '../engine/volleyball_espn.js';
import { enrichVolleyballMatch, formFromVolleyballTape } from '../engine/volleyball_data.js';

const here = dirname(fileURLToPath(import.meta.url));
const espnFix = JSON.parse(readFileSync(join(here, 'fixtures/espn_volleyball.EXCERPT.json'), 'utf8'));
const tapeDoc = JSON.parse(readFileSync(join(here, '..', 'data', 'volleyball_tape.json'), 'utf8'));

describe('Volleyball engine — odds helpers', () => {
  it('converts decimal and American without inventing prices', () => {
    assert.equal(decimalToAmerican(1.5), -200);
    assert.equal(decimalToAmerican(2), 100);
    assert.equal(decimalToAmerican(null), null);
    assert.ok(Math.abs(americanToImpliedProb(-300) - 0.75) < 0.01);
    assert.deepEqual(normaliseOdds(1.4), { decimal: 1.4, american: -250 });
    assert.equal(normaliseOdds(null), null);
  });
});

function strongMatch() {
  return {
    event_id: 'vb-strong',
    home: 'Poland',
    away: 'Visitor',
    homeTeamObj: {
      name: 'Poland',
      isHome: true,
      form: {
        last5: ['W', 'W', 'W', 'W', 'W'],
        last5SetScores: ['3-0', '3-0', '3-0', '3-0', '3-0'],
        winStreak: 5,
      },
      odds: { decimal: 1.25, american: -400 },
      stats: { killsPerSetRank: 1, blocksPerSetRank: 2 },
      homeRecord: { winRate: 0.8 },
      standings: { rank: 1, totalTeams: 24 },
      rank: 1,
    },
    awayTeamObj: {
      name: 'Visitor',
      isHome: false,
      form: { last5: ['L', 'L', 'L', 'W', 'L'], last5SetScores: ['0-3', '0-3', '1-3', '3-1', '0-3'], lossStreak: 2 },
      odds: { decimal: 4.5, american: 350 },
      awayRecord: { lossRate: 0.7 },
      standings: { rank: 18, totalTeams: 24 },
      rank: 18,
    },
    h2h: {
      recentMeetings: [
        { result: 'W', setScore: '3-0' },
        { result: 'W', setScore: '3-0' },
        { result: 'W', setScore: '3-1' },
        { result: 'W', setScore: '3-0' },
        { result: 'L', setScore: '2-3' },
      ],
    },
  };
}

describe('Volleyball engine — WIN MATCH / SET SCORE', () => {
  it('stamps the ruleset and scores a fully sourced favourite HIGH on win match', () => {
    const res = scoreVolleyballMatch(strongMatch());
    assert.equal(res.ruleset, RULESET_VERSION);
    assert.equal(res.favourite, 'Poland');
    assert.equal(res.markets.win_match.band, CONFIDENCE.HIGH);
    assert.ok(res.markets.win_match.score >= 70);
    assert.equal(res.markets.win_match.selection, 'Poland');
  });

  it('caps confidence at MEDIUM when no moneyline is sourced', () => {
    const m = strongMatch();
    m.homeTeamObj.odds = null;
    m.awayTeamObj.odds = null;
    const res = scoreVolleyballMatch(m);
    assert.ok(res.flags.some((f) => /LIVE_CAP/.test(f)));
    assert.notEqual(res.markets.win_match.band, CONFIDENCE.HIGH);
  });

  it('records missing attacking quality instead of inventing kills per set', () => {
    const m = strongMatch();
    delete m.homeTeamObj.stats;
    const res = scoreVolleyballMatch(m);
    assert.ok(res.missing.some((x) => /attacking/i.test(x)));
    const attack = res.markets.win_match.components.find((c) => c.id === 'attack');
    assert.equal(attack.points, 0);
    assert.equal(attack.missing, true);
  });

  it('never recommends 3-2 at HIGH unless the last 3 H2H meetings went to five sets', () => {
    const m = strongMatch();
    // Force a 3-2-shaped card that does NOT have three five-set H2H meetings.
    m.h2h.recentMeetings = [
      { result: 'W', setScore: '3-1' },
      { result: 'W', setScore: '3-2' },
      { result: 'L', setScore: '2-3' },
    ];
    const res = scoreVolleyballMatch(m);
    if (res.markets.set_score.outcome === '3-2') {
      assert.notEqual(res.markets.set_score.band, CONFIDENCE.HIGH);
    }
  });
});

describe('Volleyball ESPN parser — linescores are set points', () => {
  it('reads the NCAA excerpt: 3-1 final and an upcoming match', () => {
    const { matches, warnings } = parseVolleyballScoreboard(espnFix, {
      sportKey: 'volleyball', leagueSlug: 'womens-college-volleyball', leagueName: "NCAA Women's Volleyball",
    });
    assert.equal(warnings.length, 0);
    assert.equal(matches.length, 2);
    const done = matches.find((m) => m.phase === 'results');
    assert.equal(done.home, 'Nebraska Cornhuskers');
    assert.equal(done.away, 'Wisconsin Badgers');
    assert.equal(done.homeSets, 3);
    assert.equal(done.awaySets, 1);
    assert.equal(done.setScore, '3-1');
    assert.equal(done.sets.length, 4);
    assert.equal(done.sets[0].home, 25);
    assert.equal(done.winner, 'home');
    const up = matches.find((m) => m.phase === 'upcoming');
    assert.equal(up.homeTeamObj.rank, 2);
    assert.deepEqual(up.homeTeamObj.form, ['W', 'W', 'W', 'W', 'W']);
    assert.equal(up.odds, null);
  });
});

describe('Volleyball family isolation', () => {
  it('does not build EuroVolley form from NCAA tape rows', () => {
    const mixed = [
      ...tapeDoc.matches,
      {
        family: 'ncaa', phase: 'results', date: '2026-09-01', startUtc: '2026-09-01T00:00:00Z',
        home: 'Poland', away: 'Nebraska Cornhuskers', winner: 'Nebraska Cornhuskers', setScore: '3-0',
      },
    ];
    const form = formFromVolleyballTape(mixed, 'Poland', '2026-09-03T00:00:00Z', { family: 'eurovolley-w' });
    assert.ok(form.last5.length >= 1);
    assert.ok(form.last5.every((r) => r === 'W' || r === 'L'));
    // The invented NCAA row must not appear in EuroVolley form.
    const ncaaOnly = formFromVolleyballTape(mixed, 'Nebraska Cornhuskers', '2026-09-03', { family: 'eurovolley-w' });
    assert.equal(ncaaOnly, null);
  });

  it('scores the Poland–Netherlands quarter-final from the EuroVolley tape only', () => {
    const raw = {
      id: 'evw-2026-qf-pol-ned',
      family: 'eurovolley-w',
      phase: 'upcoming',
      date: '2026-09-03',
      startUtc: '2026-09-03T16:00:00Z',
      home: 'Poland',
      away: 'Netherlands',
      neutral: true,
    };
    const enriched = enrichVolleyballMatch(raw, tapeDoc.matches);
    assert.equal(enriched.family, 'eurovolley-w');
    assert.ok(enriched.homeTeamObj.form.last5.filter((r) => r === 'W').length >= 4);
    const res = scoreVolleyballMatch(enriched);
    assert.equal(res.favourite, 'Poland');
    // No moneyline, no kills/blocks, thin H2H — either SKIP or at most MEDIUM.
    assert.notEqual(res.markets.win_match.band, CONFIDENCE.HIGH);
    assert.ok(res.missing.some((x) => /odds/i.test(x)));
  });

  it('does not invent a league size when ESPN only supplies a rank', () => {
    const raw = {
      id: 'ncaa-rank-only',
      family: 'ncaa',
      phase: 'upcoming',
      date: '2026-09-02',
      home: 'Nebraska Cornhuskers',
      away: 'Wisconsin Badgers',
      homeTeamObj: { name: 'Nebraska Cornhuskers', rank: 1 },
      awayTeamObj: { name: 'Wisconsin Badgers', rank: 40 },
    };
    const enriched = enrichVolleyballMatch(raw, []);
    assert.equal(enriched.homeTeamObj.standings.rank, 1);
    assert.equal(enriched.homeTeamObj.standings.totalTeams, undefined);
    const res = scoreVolleyballMatch(enriched);
    assert.ok(!res.markets.set_score.components.some((c) => c.id === 'ss30_gap'),
      'ranking-gap bonus must not fire without a sourced league size');
  });
});
