/**
 * Tests for the NHL collector's fetch layer.
 *
 * Regression context: a committed run of this collector lost 19 of 32
 * club-stats requests to HTTP 429 and wrote an EMPTY data/ice_hockey_goalies.json.
 * Because the goaltender factor is required, every ice hockey tip then became
 * unpublishable while the run still looked successful. These tests pin the
 * retry/backoff behaviour that prevents a silent repeat.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { getJSON } from '../scripts/collect_ice_hockey_nhl.mjs';

const withStubbedFetch = async (impl, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
};

const jsonResponse = (body) => ({
  ok: true, status: 200, json: async () => body, headers: { get: () => null },
});
const errorResponse = (status, retryAfter = null) => ({
  ok: false, status, json: async () => ({}),
  headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? retryAfter : null) },
});

test('a 429 is retried and the eventual success is returned', async () => {
  let calls = 0;
  const res = await withStubbedFetch(async () => {
    calls += 1;
    return calls < 3 ? errorResponse(429) : jsonResponse({ goalies: [{ savePctg: 0.92 }] });
  }, () => getJSON('https://example.test/club-stats'));

  assert.equal(calls, 3, 'should have retried twice before succeeding');
  assert.equal(res.status, 200);
  assert.equal(res.error, null);
  assert.deepEqual(res.data, { goalies: [{ savePctg: 0.92 }] });
  assert.equal(res.attempts, 3, 'attempt count must be recorded for provenance');
});

test('a persistent 429 gives up after the attempt budget and reports the failure', async () => {
  let calls = 0;
  const res = await withStubbedFetch(async () => { calls += 1; return errorResponse(429); },
    () => getJSON('https://example.test/club-stats', { attempts: 3 }));

  assert.equal(calls, 3, 'must stop at the attempt budget rather than looping');
  assert.equal(res.status, 429);
  assert.equal(res.error, 'HTTP 429');
  assert.equal(res.data, null, 'a throttled request must never yield data');
});

test('a 5xx is retried because it is transient', async () => {
  let calls = 0;
  const res = await withStubbedFetch(async () => {
    calls += 1;
    return calls === 1 ? errorResponse(503) : jsonResponse({ ok: true });
  }, () => getJSON('https://example.test/standings'));

  assert.equal(calls, 2);
  assert.equal(res.status, 200);
});

test('a 404 is NOT retried, because retrying cannot change the answer', async () => {
  let calls = 0;
  const res = await withStubbedFetch(async () => { calls += 1; return errorResponse(404); },
    () => getJSON('https://example.test/missing'));

  assert.equal(calls, 1, 'a client error must fail fast');
  assert.equal(res.status, 404);
});

test('a Retry-After header is honoured rather than ignored', async () => {
  let calls = 0;
  const started = Date.now();
  const res = await withStubbedFetch(async () => {
    calls += 1;
    return calls === 1 ? errorResponse(429, '0') : jsonResponse({ ok: true });
  }, () => getJSON('https://example.test/club-stats'));

  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 5000, 'Retry-After: 0 should not fall back to a long backoff');
});

test('a network throw is retried and surfaced with status zero when it never recovers', async () => {
  let calls = 0;
  const res = await withStubbedFetch(async () => { calls += 1; throw new Error('ECONNRESET'); },
    () => getJSON('https://example.test/down', { attempts: 2 }));

  assert.equal(calls, 2);
  assert.equal(res.status, 0);
  assert.match(res.error, /ECONNRESET/);
});
