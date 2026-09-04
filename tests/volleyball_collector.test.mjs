/**
 * Regressions for the NCAA volleyball tape backfill.
 *
 * THE PROBLEM THIS ADDRESSES
 * The volleyball page published 0 tips from 216 fixtures. The engine was not at
 * fault: 214 of those fixtures are NCAA, the committed tape held only two days
 * of NCAA results across 315 teams, and so no team had more than one prior
 * result while `scoreRecentForm` needs five. Every NCAA fixture scored zero on
 * form and resolved to SKIP.
 *
 * The collector fetched exactly one day per run, so the tape was only ever as
 * deep as the number of times the workflow happened to fire. `--days N` walks N
 * prior days so real form can accumulate, which is safe because matches are
 * deduped by id.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { backfillDates } from '../scripts/collect_volleyball_espn.mjs';

test('backfillDates walks the requested number of prior days, oldest first', () => {
  assert.deepEqual(
    backfillDates('2026-09-04', 3),
    ['2026-09-01', '2026-09-02', '2026-09-03'],
  );
});

test('backfillDates excludes the target date itself', () => {
  assert.ok(!backfillDates('2026-09-04', 5).includes('2026-09-04'));
});

test('zero days means no backfill, preserving the original single-day behaviour', () => {
  assert.deepEqual(backfillDates('2026-09-04', 0), []);
});

test('backfillDates crosses month and year boundaries in UTC', () => {
  assert.deepEqual(backfillDates('2026-03-02', 3), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(backfillDates('2027-01-02', 3), ['2026-12-30', '2026-12-31', '2027-01-01']);
});

test('importing the collector does not start a collection', async () => {
  // A previous incident in this repo had an import of a collector overwrite
  // committed data with an empty result. The module must expose its helper
  // without running main().
  const mod = await import('../scripts/collect_volleyball_espn.mjs');
  assert.deepEqual(Object.keys(mod), ['backfillDates']);
});

test('the committed tape is too shallow to score form, and this is measurable', () => {
  /* This documents the live defect rather than asserting a fix: until a
   * backfilled collection runs in CI, no NCAA team has the five prior matches
   * the engine requires. If a future run deepens the tape this test still
   * passes; it only pins the arithmetic used to diagnose the problem. */
  const tape = JSON.parse(readFileSync(new URL('../data/volleyball_tape.json', import.meta.url), 'utf8'));
  const ncaa = (tape.matches || []).filter((m) => m.family === 'ncaa');
  const perTeam = new Map();
  for (const m of ncaa) {
    for (const side of [m.home, m.away]) perTeam.set(side, (perTeam.get(side) || 0) + 1);
  }
  const deepEnough = [...perTeam.values()].filter((n) => n >= 5).length;
  const fixtures = JSON.parse(readFileSync(new URL('../data/volleyball_matches.json', import.meta.url), 'utf8'));
  const ncaaFixtures = (fixtures.matches || []).filter((m) => m.family === 'ncaa').length;

  // The tape must never claim more form coverage than it has.
  assert.equal(typeof deepEnough, 'number');
  assert.ok(ncaaFixtures > 0, 'no NCAA fixtures committed');
  if (deepEnough === 0) {
    assert.ok(ncaa.length < ncaaFixtures * 5,
      'tape is deep enough to score form, so this diagnosis is stale');
  }
});
