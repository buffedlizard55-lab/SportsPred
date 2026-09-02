/**
 * F1 engine tests — scoring rules, missing-factor honesty, Step 3 bands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreF1Race, scoreF1Card, RULESET_VERSION, CONFIDENCE,
  LOW_OVERTAKING_CIRCUITS, POWER_SENSITIVE_CIRCUITS, HIGH_SC_FREQUENCY_CIRCUITS,
} from '../engine/f1_engine.js';

function profile(over = {}) {
  return {
    athleteId: 'p1', name: 'Driver One', team: 'Team A',
    championshipRank: 2, championshipPoints: 200, topFinish: 1,
    last5: [
      { eventName: 'A', position: 1, grid: 1, dnf: false, pointsEarned: 25, team: 'Team A' },
      { eventName: 'B', position: 2, grid: 2, dnf: false, pointsEarned: 18, team: 'Team A' },
      { eventName: 'C', position: 1, grid: 1, dnf: false, pointsEarned: 25, team: 'Team A' },
      { eventName: 'D', position: 3, grid: 3, dnf: false, pointsEarned: 15, team: 'Team A' },
      { eventName: 'E', position: 1, grid: 1, dnf: false, pointsEarned: 25, team: 'Team A' },
    ],
    last5Wins: 3, last5Podiums: 5, last5Points: 5, last5Scored: 5, last5Dnf: 0, last5KnownDnf: 5,
    poleLastRace: true,
    outqualified: { wins: 4, total: 4 },
    avgGrid: 1.5,
    trackWins: 1, trackPodiums: 2, trackPoints: 3,
    track: [{ raceDate: '2024-09-01', eventName: 'IT', position: 1, grid: 1 }],
    trackLast3: [{ raceDate: '2024-09-01', eventName: 'IT', position: 1 }],
    fastestLapHistory: [{ raceDate: '2026-09-06', eventName: 'IT' }],
    circuitHistory: [],
    ...over,
  };
}

function badProfile(over = {}) {
  return profile({
    championshipRank: 11, championshipPoints: 10,
    last5Wins: 0, last5Podiums: 0, last5Points: 0, last5Scored: 0,
    last5: [{
      eventName: 'Z', position: 14, grid: 18, dnf: true, pointsEarned: 0, team: 'Team C',
    }],
    outqualified: { wins: 0, total: 3 },
    trackWins: 0, trackPodiums: 0, trackPoints: 0,
    track: [{ raceDate: '2024-09-01', eventName: 'IT', position: 14, grid: 18 }],
    fastestLapHistory: [],
    ...over,
  });
}

const ctx = {
  circuit: 'ITA',
  leaderPoints: 220,
  grid: null,
  teamRows: { 'Team A': [{ date: '2026-08-23', points: 43 }, { date: '2026-08-02', points: 40 }, { date: '2026-07-19', points: 44 }, { date: '2026-07-05', points: 38 }, { date: '2026-06-28', points: 42 }] },
  weatherPrecipPct: 10,
};

test('RULESET_VERSION is v1.0 (prompt fidelity)', () => {
  assert.equal(RULESET_VERSION, 'v1.0');
});

test('race winner scores a strong driver highest and records missing odds', () => {
  const ev = { id: 'e1', name: 'Italian GP', abbreviation: 'ITA' };
  const result = scoreF1Race(ev, new Map([
    ['p1', profile()],
    ['p2', badProfile()],
  ]), ctx);
  assert.equal(result.unscored, false);
  const m = result.markets.race_winner;
  assert.equal(m.selection, 'Driver One');
  assert.ok(m.missing.some((x) => x.includes('odds')));
  assert.ok(m.components.some((c) => c.id === 'rw_form' && c.points === 25));
  assert.ok(m.components.some((c) => c.id === 'rw_quali' && c.points === 20));
  assert.ok(m.components.some((c) => c.id === 'rw_track' && c.points === 20));
  assert.ok(m.components.some((c) => c.id === 'rw_champ' && c.points === 10));
});

test('missing factors cap an otherwise-high score at MEDIUM (never HIGH)', () => {
  const result = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), ctx);
  const m = result.markets.race_winner;
  assert.ok(m.score >= 70, `score should be high, got ${m.score}`);
  assert.equal(m.band, CONFIDENCE.MEDIUM);
});

test('fastest lap is SKIPped without tyre-strategy evidence (Step 3)', () => {
  const result = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), ctx);
  assert.equal(result.markets.fastest_lap.band, CONFIDENCE.SKIP);
  assert.ok(result.markets.fastest_lap.missing.some((x) => x.toLowerCase().includes('strategy')));
});

test('grid factor applies when a grid is known', () => {
  const r = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, grid: [{ athleteId: 'p1', grid: 4 }],
  });
  const pdm = r.markets.podium_finish;
  assert.ok(pdm.components.some((c) => c.id === 'pod_grid' && c.points === 10));
});

test('points finish uses verified team form and reliability', () => {
  const r = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), ctx);
  const m = r.markets.points_finish;
  assert.ok(m.components.some((c) => c.id === 'pts_team' && c.points === 30));
  assert.ok(m.components.some((c) => c.id === 'pts_reliability' && c.points === 25));
  // Traffic skill & upgrades are unsourced → missing.
  assert.ok(m.missing.length >= 2);
});

test('top 6 applies grid modifier and weather wildcard only when sourced', () => {
  const r = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, grid: [{ athleteId: 'p1', grid: 3 }], weatherPrecipPct: 40,
  });
  const m = r.markets.top6_finish;
  assert.ok(m.components.some((c) => c.id === 't6_grid' && c.points === 15));
  assert.ok(m.components.some((c) => c.id === 't6_weather' && c.missing === true));
});

test('no profiles → UNSCORED sentinel, nothing guessed', () => {
  const r = scoreF1Race({ id: 'e1' }, new Map(), ctx);
  assert.equal(r.unscored, true);
  assert.deepEqual(r.markets, {});
});

test('scoreF1Card scores one event per entry', () => {
  const card = scoreF1Card([{ id: 'e1', name: 'Italian GP' }],
    new Map([['e1', new Map([['p1', profile()]])]]),
    new Map([['e1', ctx]]));
  assert.equal(card.results.length, 1);
  assert.equal(card.results[0].result.markets.race_winner.selection, 'Driver One');
});

test('a driver with no recent wins is scored at the zero-form tier, not guessed', () => {
  const r = scoreF1Race({ id: 'e1' }, new Map([['p1', badProfile()]]), ctx);
  const c = r.markets.race_winner.components.find((x) => x.id === 'rw_form');
  assert.equal(c.points, 0);
});

test('circuit classifications use ESPN abbreviations verified from the standings payload', () => {
  // REGRESSION: these sets previously used invented codes (MON/ZAN) that never
  // match ESPN, so every F1-specific adjustment was dead code. The verified
  // code list is published in the standings per-race stats.
  assert.ok(LOW_OVERTAKING_CIRCUITS.has('MCO'), 'Monaco is MCO');
  assert.ok(LOW_OVERTAKING_CIRCUITS.has('NLD'), 'Zandvoort is the Dutch GP, NLD');
  assert.ok(LOW_OVERTAKING_CIRCUITS.has('HUN'));
  assert.ok(!LOW_OVERTAKING_CIRCUITS.has('MON'), 'MON is not an ESPN F1 code');
  assert.ok(!LOW_OVERTAKING_CIRCUITS.has('ZAN'), 'ZAN is not an ESPN F1 code');

  assert.ok(POWER_SENSITIVE_CIRCUITS.has('ITA'), 'Monza is the Italian GP, ITA');
  assert.ok(POWER_SENSITIVE_CIRCUITS.has('AZE'), 'Baku');
  assert.ok(POWER_SENSITIVE_CIRCUITS.has('BEL'), 'Spa');

  assert.ok(HIGH_SC_FREQUENCY_CIRCUITS.has('MCO'));
  assert.ok(HIGH_SC_FREQUENCY_CIRCUITS.has('SGP'));
  assert.ok(HIGH_SC_FREQUENCY_CIRCUITS.has('BEL'), 'the prompt names Spa explicitly');
});

test('safety-car modifier applies to a mid-grid start at a high-SC circuit', () => {
  const r = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, circuit: 'MCO', highSafetyCar: true, grid: [{ athleteId: 'p1', grid: 6 }],
  });
  const pod = r.markets.podium_finish;
  assert.ok(pod.components.some((c) => c.id === 'pod_sc' && c.points === 5));
});

test('safety-car modifier does NOT apply at a normal circuit or a front-row start', () => {
  const front = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, circuit: 'MCO', highSafetyCar: true, grid: [{ athleteId: 'p1', grid: 2 }],
  });
  assert.ok(!front.markets.podium_finish.components.some((c) => c.id === 'pod_sc'));

  const normal = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, circuit: 'ITA', highSafetyCar: false, grid: [{ athleteId: 'p1', grid: 6 }],
  });
  assert.ok(!normal.markets.podium_finish.components.some((c) => c.id === 'pod_sc'));
});

test('top-6 dark horse modifier applies at high-overtaking-difficulty circuits only', () => {
  const dark = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, circuit: 'MCO', lowOvertaking: true, grid: [{ athleteId: 'p1', grid: 8 }],
  });
  assert.ok(dark.markets.top6_finish.components.some((c) => c.id === 't6_darkhorse' && c.points === 10));

  const easy = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, circuit: 'ITA', lowOvertaking: false, grid: [{ athleteId: 'p1', grid: 8 }],
  });
  assert.ok(!easy.markets.top6_finish.components.some((c) => c.id === 't6_darkhorse'));

  // Unknown classification is recorded as missing, never assumed false.
  const unknown = scoreF1Race({ id: 'e1' }, new Map([['p1', profile()]]), {
    ...ctx, circuit: null, lowOvertaking: null, grid: [{ athleteId: 'p1', grid: 8 }],
  });
  assert.ok(unknown.markets.top6_finish.missing.some((m) => m.includes('overtakingDifficulty')));
});
