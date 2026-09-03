#!/usr/bin/env node
/**
 * Run the Node test suite the way CI does, and make a failure legible.
 *
 * Every test file is handed to ONE `node --test` process. That matters: the
 * top-level-await tests (olbg/integration) load correctly in a single
 * invocation across Node 20/22/24, while running each file in its own
 * subprocess breaks them on the newer runners.
 *
 * Raw job logs are only served from blob storage, which is not reachable from
 * every environment that needs to read a build result. Check-run annotations
 * ARE reachable through the plain REST API, so on failure this re-emits the
 * failing test names and the first diagnostic lines as `::error::` annotations
 * before exiting with the suite's own status. Nothing is swallowed: the full
 * reporter output still goes to the job log, and the exit code is unchanged,
 * so a red suite stays red.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_MESSAGE = 300;

/** Test files the glob `tests/*.test.mjs` would have expanded to, in a stable order. */
function testFiles(dir = 'tests') {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => join(dir, f));
}

/** One annotation per line. `%` and CR must be escaped or GitHub drops the annotation. */
function annotate(title, lines) {
  for (const raw of lines) {
    const message = raw.replace(/%/g, '%25').replace(/\r/g, '').trim().slice(0, MAX_MESSAGE);
    if (message) process.stdout.write(`::error title=${title}::${message}\n`);
  }
}

function main() {
  const files = testFiles();
  if (files.length === 0) {
    process.stdout.write('::error title=node --test::no tests/*.test.mjs files found\n');
    return 1;
  }

  const run = spawnSync(process.execPath, ['--test', ...files], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(out);

  if (run.error) {
    annotate('node --test could not start', [String(run.error.message ?? run.error)]);
    return 1;
  }

  const status = run.status ?? 1;
  if (status === 0) return 0;

  const lines = out.split('\n');
  annotate(
    'failing test',
    lines.filter((l) => l.startsWith('not ok')).slice(0, 40),
  );
  // Only the TAP diagnostic block and stack frames — never a passing test's
  // name, which often contains words like "throws" or "Error" by design.
  const isReporterLine = (l) => /^(# Subtest:|ok |not ok |# )/.test(l);
  const isDiagnostic = (l) =>
    /^\s*(error|code|name|expected|actual|operator|failureType|stack|generatedMessage|at\s)/.test(l) ||
    /(SyntaxError|ReferenceError|TypeError|RangeError|AssertionError|ERR_MODULE_NOT_FOUND|Cannot find)/.test(l) ||
    /\.mjs:\d+:\d+/.test(l);
  annotate(
    'failure detail',
    lines.filter((l) => !isReporterLine(l) && isDiagnostic(l)).slice(0, 30),
  );
  // The TAP summary is the fastest read on how big the failure is.
  annotate('suite summary', lines.filter((l) => /^# (tests|pass|fail|cancelled|skipped|todo)/.test(l)));
  return status;
}

process.exit(main());
