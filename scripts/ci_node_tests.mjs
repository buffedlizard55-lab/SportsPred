#!/usr/bin/env node
/**
 * Run the Node test suite the way CI does, and make a failure legible.
 *
 * Every test file is handed to ONE `node --test` process. That matters: the
 * top-level-await tests (olbg/integration) load correctly in a single
 * invocation across Node 20/22/24, while running each file in its own
 * subprocess breaks them on the newer runners.
 *
 * Raw job logs are served from blob storage that is not reachable from every
 * environment which has to read a build result, while check-run annotations are
 * reachable through the plain REST API. So on failure this re-emits the failing
 * test names, the TAP diagnostic block, the tail of the output and a snapshot of
 * the runtime as `::error::` annotations.
 *
 * Two details are load-bearing:
 *   - annotations are written BEFORE the captured output is dumped, because a
 *     step that prints a very long log can have its trailing workflow commands
 *     dropped;
 *   - the child's output goes to a temporary file rather than a pipe buffer, so
 *     a huge or killed run cannot take this wrapper down with it. If the child
 *     is killed by a signal (an OOM kill, a runner cancel) there are no
 *     `not ok` lines to report, so the signal and the memory snapshot are what
 *     get annotated instead.
 *
 * The exit code is always the suite's own, so a red suite stays red.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { availableParallelism, cpus, freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

const MAX_MESSAGE = 300;
const TAIL_LINES = 40;

/** Test files the glob `tests/*.test.mjs` would have expanded to, in a stable order. */
function testFiles(dir = 'tests') {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => join(dir, f));
}

/** One annotation per line. `%` and CR must be escaped or GitHub drops the command. */
function annotate(title, lines) {
  for (const raw of lines) {
    const message = String(raw).replace(/%/g, '%25').replace(/\r/g, '').trim().slice(0, MAX_MESSAGE);
    if (message) process.stdout.write(`::error title=${title}::${message}\n`);
  }
}

/** Runtime facts worth having whenever a build is red and its logs are not. */
function environment(files) {
  return [
    `node ${process.version} on ${process.platform} ${process.arch}`,
    `cwd ${process.cwd()}`,
    `test files ${files.length}, availableParallelism ${availableParallelism()}, cpus ${cpus().length}`,
    `mem total ${(totalmem() / 1048576).toFixed(0)}MiB free ${(freemem() / 1048576).toFixed(0)}MiB`,
  ];
}

function main() {
  const files = testFiles();
  if (files.length === 0) {
    annotate('node --test found nothing', ['no tests/*.test.mjs files in the working tree']);
    return 1;
  }

  const logPath = join(tmpdir(), `node-tests-${process.pid}.log`);
  let run;
  let fd = null;
  try {
    fd = openSync(logPath, 'w');
    run = spawnSync(process.execPath, ['--test', ...files], { stdio: ['ignore', fd, fd] });
  } catch (err) {
    annotate('node --test could not start', [err?.message ?? String(err)]);
    annotate('runtime', environment(files));
    return 1;
  } finally {
    if (fd !== null) closeSync(fd);
  }

  let out = '';
  try {
    out = readFileSync(logPath, 'utf8');
  } catch {
    out = '';
  }

  const status = run.status ?? 1;
  if (status !== 0) {
    const lines = out.split('\n');
    // Only the TAP diagnostic block and stack frames — never a passing test's
    // name, which often contains words like "throws" or "Error" by design.
    const isReporterLine = (l) => /^(# Subtest:|ok |not ok |# )/.test(l);
    const isDiagnostic = (l) =>
      /^\s*(error|code|name|expected|actual|operator|failureType|stack|generatedMessage|at\s)/.test(l) ||
      /(SyntaxError|ReferenceError|TypeError|RangeError|AssertionError|ERR_MODULE_NOT_FOUND|Cannot find)/.test(l) ||
      /\.mjs:\d+:\d+/.test(l);

    annotate('failing test', lines.filter((l) => l.startsWith('not ok')).slice(0, 40));
    annotate('failure detail', lines.filter((l) => !isReporterLine(l) && isDiagnostic(l)).slice(0, 30));
    annotate('suite summary', lines.filter((l) => /^# (tests|pass|fail|cancelled|skipped|todo)/.test(l)));
    if (run.signal) {
      annotate(
        'child process killed',
        [`node --test was terminated by signal ${run.signal} (exit status ${run.status ?? 'none'})`],
      );
    }
    if (run.error) annotate('spawn error', [run.error.message ?? String(run.error)]);
    // Whatever the shape of the failure, the last lines say something.
    annotate('output tail', lines.filter((l) => l.trim()).slice(-TAIL_LINES));
    annotate('runtime', environment(files));
  }

  // Full reporter output still goes to the job log for a human reading it there.
  process.stdout.write(out);

  try {
    unlinkSync(logPath);
  } catch {
    /* best effort */
  }
  return status;
}

let exitCode = 1;
try {
  exitCode = main();
} catch (err) {
  annotate('ci_node_tests.mjs itself failed', [err?.stack ?? err?.message ?? String(err)]);
  exitCode = 1;
}
process.exit(exitCode);
