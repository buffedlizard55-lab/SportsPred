/**
 * scripts/data_changed.mjs — the collector commit guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { equalIgnoringTimestamps, changedFiles } from '../scripts/data_changed.mjs';

test('equalIgnoringTimestamps ignores ISO timestamps under timestamp keys and nothing else', () => {
  const a = { fetched_at_utc: '2026-09-02T17:17:19.193Z', source: { verified: '2026-09-02T17:17:20Z' }, rows: [{ lastUpdated: '2026-09-01', v: 1 }] };
  const b = { fetched_at_utc: '2026-09-02T17:50:58.296Z', source: { verified: null }, rows: [{ lastUpdated: '2026-09-02', v: 1 }] };
  assert.equal(equalIgnoringTimestamps(a, b), true);
  assert.equal(equalIgnoringTimestamps(a, { ...b, rows: [{ lastUpdated: '2026-09-02', v: 2 }] }), false, 'a real value change is detected');
  assert.equal(equalIgnoringTimestamps({ verified: true }, { verified: false }), false, 'a boolean under a timestamp-looking key is compared');
  assert.equal(equalIgnoringTimestamps({ generated_at_utc: 'x' }, { generated_at_utc: 'y' }), false, 'non-ISO strings are compared');
  assert.equal(equalIgnoringTimestamps({ a: 1 }, { a: 1, b: 2 }), false, 'added keys count');
  assert.equal(equalIgnoringTimestamps([1, 2], [1, 2, 3]), false);
});

test('changedFiles treats byte-identical, timestamp-only and substantive edits differently', () => {
  // ice-hockey.html is a committed file this test never edits, so compared
  // with itself (HEAD) it is unchanged. (package.json changes in every feature
  // branch that adds a collector script, so it cannot serve as the baseline.)
  const { changed, unchanged } = changedFiles(['ice-hockey.html', 'data/does_not_exist.json']);
  assert.deepEqual(changed, ['data/does_not_exist.json'], 'a new (uncommitted) file always counts as changed');
  assert.deepEqual(unchanged, ['ice-hockey.html']);
});
