/**
 * F1 backtest script test — runs walk-forward on a tiny fixture dir via
 * SPORTSPRED_DATA_DIR (exercise of the script itself, no git data writes).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

function raceResult(rows) {
  return {
    completed: true, winner: { athleteId: rows[0].athleteId, name: rows[0].name, team: rows[0].team },
    podium: rows.slice(0, 3).map((r) => r.athleteId), top6: rows.slice(0, 6).map((r) => r.athleteId),
    top10: rows.slice(0, 10).map((r) => r.athleteId),
    grid: rows.map((r) => ({ athleteId: r.athleteId, name: r.name, grid: r.grid })), result: rows,
  };
}

function ev(over) {
  return {
    id: over.id, name: over.name, abbreviation: over.abbreviation, seasonYear: 2026,
    startDate: over.startDate, endDate: over.endDate, raceDate: over.raceDate,
    state: over.state, race: over.race, sources: { espnEvent: `https://x/${over.id}` },
    ...over,
  };
}

function makeFixture(dir) {
  const A = { athleteId: 'a', name: 'Driver A', team: 'Team A', position: 1, grid: 1, dnf: false, pointsEarned: 25 };
  const B = { athleteId: 'b', name: 'Driver B', team: 'Team B', position: 2, grid: 2, dnf: false, pointsEarned: 18 };
  const C = { athleteId: 'c', name: 'Driver C', team: 'Team A', position: 3, grid: 3, dnf: false, pointsEarned: 15 };
  const D = { athleteId: 'd', name: 'Driver D', team: 'Team B', position: 4, grid: 4, dnf: false, pointsEarned: 12 };

  const events = [
    ev({ id: 'r1', name: 'Qatar Airways Australian Grand Prix', abbreviation: 'AUS',
      startDate: '2026-03-06T00:00Z', endDate: '2026-03-08T00:00Z', raceDate: '2026-03-08T00:00Z',
      state: 'post', race: raceResult([A, B, C, D]) }),
    ev({ id: 'r2', name: 'Heineken Chinese Grand Prix', abbreviation: 'CHN',
      startDate: '2026-03-13T00:00Z', endDate: '2026-03-15T00:00Z', raceDate: '2026-03-15T00:00Z',
      state: 'post', race: raceResult([A, B, C, D]) }),
    ev({ id: 'r3', name: 'Pirelli Italian Grand Prix', abbreviation: 'ITA',
      startDate: '2026-09-04T00:00Z', endDate: '2026-09-06T00:00Z', raceDate: '2026-09-06T00:00Z',
      state: 'pre', race: { completed: false, result: [], grid: [] } }),
  ];
  const standings = {
    schema_version: 1, sport: 'Formula 1', drivers: [
      { id: 'a', name: 'Driver A', rank: 1, points: 50, perRace: {} },
      { id: 'b', name: 'Driver B', rank: 2, points: 36, perRace: {} },
      { id: 'c', name: 'Driver C', rank: 3, points: 30, perRace: {} },
      { id: 'd', name: 'Driver D', rank: 4, points: 24, perRace: {} },
    ], constructors: [], source: {},
  };

  writeFileSync(join(dir, 'f1_events.json'), JSON.stringify({ schema_version: 1, events }));
  writeFileSync(join(dir, 'f1_standings.json'), JSON.stringify(standings));
  writeFileSync(join(dir, 'f1_slate.json'), JSON.stringify({ source: {}, events: [], outrights: [] }));
  writeFileSync(join(dir, 'f1_weather.json'), JSON.stringify({ events: {} }));
}

test('backtest_f1.mjs writes an aggregated backtest + ledger from fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f1bt-'));
  try {
    makeFixture(dir);
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'backtest_f1.mjs')], {
      cwd: ROOT, env: { ...process.env, SPORTSPRED_DATA_DIR: dir }, stdio: 'pipe',
    });
    const bt = JSON.parse(readFileSync(join(dir, 'f1_backtest.json'), 'utf8'));
    const ledger = JSON.parse(readFileSync(join(dir, 'f1_predictions.json'), 'utf8'));
    assert.equal(bt.races.length, 2);
    assert.deepEqual(
      bt.races.map((r) => r.name).sort(),
      ['Heineken Chinese Grand Prix', 'Qatar Airways Australian Grand Prix'],
    );
    assert.equal(bt.summary.length, 5, 'four scored markets + fastest lap row');
    assert.ok(ledger.predictions.length === 2);
    // Driver A is the verified winner of both completed races.
    const rw = bt.summary.find((s) => s.market === 'RACE WINNER');
    assert.equal(rw.hit, 2);
    const fl = bt.races[0].markets.fastest_lap;
    assert.equal(fl.status, 'NO SELECTION');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backtest_f1.mjs prints [PENDING] when F1 data is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f1bt-'));
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'backtest_f1.mjs')], {
      cwd: ROOT, env: { ...process.env, SPORTSPRED_DATA_DIR: dir }, stdio: 'pipe',
    }).toString();
    assert.match(out, /\[PENDING\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
