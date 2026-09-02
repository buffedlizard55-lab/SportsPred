#!/usr/bin/env node
/**
 * SportsPred — "did the data really change?" guard for collector commits.
 *
 * Collectors stamp every document with fetched_at_utc / generated_at_utc /
 * verified timestamps, so a run that found nothing new still rewrites a
 * 1.3 MB results tape. Committing that every half hour buries the real
 * refreshes and bloats the repository. This script compares each given file
 * against the committed version (HEAD) ignoring timestamp keys only, prints
 * the files with substantive changes, and exits 0 when at least one exists
 * (1 when none do, 2 on usage error). New or deleted files always count.
 *
 *   node scripts/data_changed.mjs data/golf_*.json && git commit ...
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const TIMESTAMP_KEY = /^(.*_at_utc|fetched_at|generated_at|collected_at|verified|last_run|lastUpdated)$/;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A key is a timestamp only when its name matches AND both values are ISO-like strings (or null). */
function isTimestampPair(key, a, b, ignore) {
  if (!ignore.test(key)) return false;
  const ok = (v) => v === null || v === undefined || (typeof v === 'string' && ISO_LIKE.test(v));
  return ok(a) && ok(b);
}

/** Deep equality that ignores timestamp-valued keys at any depth. */
export function equalIgnoringTimestamps(a, b, ignore = TIMESTAMP_KEY) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => equalIgnoringTimestamps(x, b[i], ignore));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k)
      && (isTimestampPair(k, a[k], b[k], ignore) || equalIgnoringTimestamps(a[k], b[k], ignore)));
  }
  return false;
}

function committed(path, rev) {
  try { return execFileSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }); } catch { return null; }
}

/** @returns {{changed: string[], unchanged: string[]}} */
export function changedFiles(paths, { rev = 'HEAD' } = {}) {
  const changed = [];
  const unchanged = [];
  for (const p of paths) {
    const now = existsSync(p) ? readFileSync(p, 'utf8') : null;
    const was = committed(p, rev);
    if (now === null || was === null) { changed.push(p); continue; } // added or deleted
    if (now === was) { unchanged.push(p); continue; }
    let a; let b;
    try { a = JSON.parse(was); b = JSON.parse(now); } catch { changed.push(p); continue; } // not JSON: byte change counts
    (equalIgnoringTimestamps(a, b) ? unchanged : changed).push(p);
  }
  return { changed, unchanged };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const paths = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (!paths.length) { console.error('usage: node scripts/data_changed.mjs <files...>'); process.exit(2); }
  const { changed, unchanged } = changedFiles(paths);
  for (const p of changed) console.log(`changed   ${p}`);
  for (const p of unchanged) console.log(`unchanged ${p} (timestamps only)`);
  process.exit(changed.length ? 0 : 1);
}
