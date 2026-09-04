import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPreMatch, grade } from '../scripts/backtest_basketball.mjs';

const game = (id, startUtc, home, away, hScore, aScore, winner) => ({
  id,
  startUtc,
  phase: 'results',
  league: 'nba',
  leagueName: 'NBA',
  dateISO: String(startUtc).slice(0, 10),
  home: { name: home, score: hScore, avgPoints: 115 },
  away: { name: away, score: aScore, avgPoints: 112 },
  winner,
});

describe('Basketball backtest — leak-free feature construction', () => {
  // Three prior games, then the fixture we score. Form/record/H2H/rest must be
  // computed only from the prior three; the fixture's own result (and anything
  // later) must not leak in.
  const tape = [
    game('g1', '2026-01-01T00:00Z', 'Lakers', 'Celtics', 100, 90, 'home'),
    game('g2', '2026-01-03T00:00Z', 'Celtics', 'Lakers', 95, 88, 'home'),
    game('g3', '2026-01-05T00:00Z', 'Lakers', 'Celtics', 99, 97, 'home'),
    // the fixture being scored — result must be invisible to features:
    game('g4', '2026-01-10T00:00Z', 'Lakers', 'Celtics', 80, 120, 'away'),
  ];

  it('computes form, record, h2h and rest from prior games only', () => {
    const fixture = buildPreMatch(tape[3], tape);
    // Lakers: g1 W, g2 L, g3 W -> "WLW"
    assert.equal(fixture.homeForm, 'WLW');
    // Celtics: g1 L, g2 W, g3 L -> "LWL"
    assert.equal(fixture.awayForm, 'LWL');
    // Lakers won 2 of 3
    assert.equal(fixture.home.record.winPct, 2 / 3);
    // H2H: three meetings, home(Lakers) won 2, away(Celtics) won 1
    assert.equal(fixture.h2h.meetings, 3);
    assert.equal(fixture.h2h.homeWins, 2);
    assert.equal(fixture.h2h.awayWins, 1);
    // Rest: both last played g3 (5 days before g4)
    assert.equal(fixture.rest.home, 5);
    assert.equal(fixture.rest.away, 5);
    // The fixture's own outcome must not appear in any feature:
    assert.equal(fixture.homeForm.includes('L'), true); // g2 loss is the only L
    assert.equal(fixture.home.record.winPct, 2 / 3, 'g4 loss must not depress winPct');
  });

  it('leaves form/record null for a team with no prior games', () => {
    const fixture = buildPreMatch(tape[0], tape);
    assert.equal(fixture.homeForm, null);
    assert.equal(fixture.awayForm, null);
    assert.equal(fixture.home.record, null);
    assert.equal(fixture.h2h, null);
    assert.equal(fixture.rest.home, null);
  });
});

describe('Basketball backtest — grading', () => {
  it('grades a WIN MATCH hit correctly', () => {
    const result = {
      markets: {
        match_result: { band: 'HIGH', score: 78, selection: 'Lakers' },
        handicap: { band: 'SKIP', reason: 'no closing line' },
        total: { band: 'SKIP', reason: 'no totals' },
      },
    };
    const g = grade(result, game('g1', '2026-01-01T00:00Z', 'Lakers', 'Celtics', 110, 99, 'home'));
    assert.equal(g.graded, true);
    assert.equal(g.hit, true);
    assert.equal(g.band, 'HIGH');
    assert.equal(g.selection, 'Lakers');
    assert.equal(g.actual, 'Lakers');
    assert.equal(g.spreadGraded, false);
    assert.equal(g.totalGraded, false);
  });

  it('does not grade a SKIP and does not count it as a hit', () => {
    const result = {
      markets: {
        match_result: { band: 'SKIP', score: 30, selection: null },
        handicap: { band: 'SKIP', reason: 'no closing line' },
        total: { band: 'SKIP', reason: 'no totals' },
      },
    };
    const g = grade(result, game('g2', '2026-01-03T00:00Z', 'Lakers', 'Celtics', 110, 99, 'home'));
    assert.equal(g.graded, false);
    assert.equal(g.hit, false);
    assert.equal(g.band, 'SKIP');
  });
});
