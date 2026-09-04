/**
 * Regressions for the derived baseball source register.
 *
 * The register exists because assets/js/baseball-page.js has always fetched
 * data/baseball_provenance.json while nothing wrote it (IRR-004). These tests
 * pin the two properties that make it trustworthy: every figure in it is
 * traceable to a committed document, and nothing is asserted that the data
 * does not support.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseEndpoints } from '../scripts/build_baseball_provenance.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const prov = read('baseball_provenance.json');

test('summariseEndpoints collapses repeats into request shapes with counts', () => {
  const rows = summariseEndpoints([
    { url: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-09-04', status: 200, ok: true },
    { url: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-09-05', status: 200, ok: true },
    { url: 'https://statsapi.mlb.com/api/v1/people/12345/stats?season=2026', status: 200, ok: true },
  ]);
  assert.equal(rows.length, 2);
  const sched = rows.find((r) => r.base.endsWith('/schedule'));
  assert.equal(sched.requests, 2);
  assert.equal(sched.ok, 2);
  // Volatile identifiers are templated so the register lists a shape, not 300 URLs.
  assert.match(sched.template, /date=\{date\}/);
  const people = rows.find((r) => r.base.includes('people'));
  assert.match(people.base, /\{personId\}/);
});

test('a failed request is reported rather than silently counted as ok', () => {
  const [row] = summariseEndpoints([
    { url: 'https://statsapi.mlb.com/api/v1/standings?season=2026', status: 200, ok: true },
    { url: 'https://statsapi.mlb.com/api/v1/standings?season=2026', status: 429, ok: false },
  ]);
  assert.equal(row.requests, 2);
  assert.equal(row.ok, 1);
  assert.deepEqual(row.statuses, { 200: 1, 429: 1 });
});

test('every registered source is https and states what it provides', () => {
  assert.ok(prov.sources.length >= 2);
  for (const s of prov.sources) {
    assert.match(s.url, /^https:\/\//, `${s.id} is not https`);
    assert.ok(s.provides?.length, `${s.id} states no fields`);
    assert.ok(s.verified_utc, `${s.id} has no verification timestamp`);
  }
});

test('request counts in the register match the committed documents', () => {
  const counted = new Map();
  for (const doc of ['baseball_fixtures', 'baseball_tape', 'baseball_standings',
    'baseball_team_stats', 'baseball_pitchers']) {
    for (const e of read(`${doc}.json`).endpoints || []) {
      const host = new URL(e.url).host;
      counted.set(host, (counted.get(host) || 0) + 1);
    }
  }
  for (const [host, n] of counted) {
    const src = prov.sources.find((s) => s.url === `https://${host}`);
    assert.ok(src, `no register entry for ${host}`);
    assert.equal(src.requests, n, `${host} request count drifted`);
  }
});

test('coverage figures reconcile with the committed fixture count', () => {
  const fixtures = read('baseball_fixtures.json');
  assert.equal(prov.coverage.fixtures_scored, fixtures.counts.fixtures);
  assert.equal(
    prov.coverage.tips_skipped,
    prov.coverage.tips_generated - prov.coverage.tips_published,
  );
  assert.ok(prov.coverage.tips_published > 0);
});

test('the no-price irregularity is only claimed because withOdds is zero', () => {
  const fixtures = read('baseball_fixtures.json');
  const ir = prov.irregularities.find((i) => i.id === 'IR-BASEBALL-01');
  if (fixtures.counts.withOdds === 0) {
    assert.ok(ir, 'withOdds is zero but no price irregularity is registered');
    assert.match(ir.effect, /withOdds = 0/);
  } else {
    assert.equal(ir, undefined, 'price irregularity registered despite prices existing');
  }
});

test('the probable-starter irregularity quotes the real named-slot count', () => {
  const fixtures = read('baseball_fixtures.json');
  const named = fixtures.fixtures.reduce((n, f) => n
    + (f.home?.probablePitcher?.id ? 1 : 0) + (f.away?.probablePitcher?.id ? 1 : 0), 0);
  const slots = fixtures.fixtures.length * 2;
  const ir = prov.irregularities.find((i) => i.id === 'IR-BASEBALL-06');
  if (named < slots) {
    assert.ok(ir);
    assert.match(ir.effect, new RegExp(`${named} of ${slots}`));
  }
});

test('every missing factor recorded is one the engine actually reports', async () => {
  const { buildBaseballCard } = await import('../engine/baseball_data.js');
  const docs = {
    fixtures: read('baseball_fixtures.json'),
    standings: read('baseball_standings.json'),
    teamStats: read('baseball_team_stats.json'),
    pitchers: read('baseball_pitchers.json'),
    tape: read('baseball_tape.json'),
    slate: read('baseball_slate.json'),
  };
  const seen = new Set();
  for (const dateISO of [...new Set(docs.fixtures.fixtures.map((f) => f.dateISO))].slice(0, 5)) {
    for (const r of buildBaseballCard(docs, { dateISO }).scored.results || []) {
      for (const m of r.missing || []) seen.add(m);
    }
  }
  for (const { factor } of prov.coverage.missing_factors) {
    assert.ok(seen.has(factor), `register invents a missing factor the engine never reports: ${factor}`);
  }
});

test('generated irregularity ids do not collide with the prose register', () => {
  // docs/BASEBALL_IRREGULARITIES.md documents IR-BASEBALL-01..06 in prose. An id
  // reused here for a different finding would make the two registers disagree.
  const meanings = {
    'IR-BASEBALL-01': /price|odds|moneyline/i,
    'IR-BASEBALL-02': /bullpen/i,
    'IR-BASEBALL-06': /starter|probable/i,
  };
  for (const ir of prov.irregularities) {
    const expected = meanings[ir.id];
    if (expected) {
      assert.match(`${ir.title} ${ir.effect}`, expected,
        `${ir.id} means something different here than in docs/BASEBALL_IRREGULARITIES.md`);
    }
  }
  const ids = prov.irregularities.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate irregularity id');
});

test('no source claims a status the underlying document did not record', () => {
  // The OLBG slate collector records no HTTP status, so the register must not
  // manufacture one for it.
  const olbg = prov.sources.find((s) => s.id === 'olbg-baseball');
  if (olbg) {
    assert.equal(olbg.status, null);
    assert.equal(olbg.requests, null);
  }
});
