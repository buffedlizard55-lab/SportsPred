/**
 * SportsPred — historical walk-forward backtest on the Sackmann dataset mirror.
 *
 * Downloads the ATP match CSVs from the verified mirror (see docs/SOURCES.md),
 * builds pre-match features strictly from prior matches, scores each match with
 * the real engine, and grades the picks against the actual winner.
 *
 * Honesty constraints, stated up front:
 *  - The mirror has no historical odds, so every odds-dependent factor is
 *    missing. This backtest therefore measures how well the sourced
 *    rank/form/surface/serve factors pick winners — it does NOT measure value
 *    or profitability, and it must not be read as doing so.
 *  - The engine's anti-hallucination guard caps confidence at LOW when more
 *    than two factors are missing, which is always true here. The report
 *    therefore also buckets by raw score so the score-to-outcome calibration
 *    is visible rather than hidden behind the guard.
 *
 *     node scripts/backtest_historical.mjs            # download + backtest
 *     node scripts/backtest_historical.mjs --years 2025
 *     node scripts/backtest_historical.mjs --from-dir path/to/csvs
 *     node scripts/backtest_historical.mjs --json
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { scoreMatch } from '../engine/engine.js';
import { buildFeatures, gradeResult, aggregate, parseCSV, SACKMANN } from './lib/historical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CACHE = path.join(ROOT, 'data', '.cache', 'sackmann');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function downloadCSV(repo, file) {
  // Prefer raw.githubusercontent.com (plain text, works in CI runners), then
  // fall back to the GitHub contents API (base64). The contents API also works
  // where raw.githubusercontent.com is blocked, and returns the same bytes.
  const rawUrl = `https://raw.githubusercontent.com/${repo}/master/${file}`;
  try {
    const res = await fetch(rawUrl, { headers: { 'User-Agent': 'SportsPredCollector/1.0' } });
    if (res.ok) return await res.text();
  } catch {
    // fall through to the contents API
  }
  const url = `https://api.github.com/repos/${repo}/contents/${file}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SportsPredCollector/1.0', Accept: 'application/vnd.github.v3+json' },
  });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.content == null) throw new Error(`${file}: no content (encoding=${body.encoding})`);
  return Buffer.from(body.content, 'base64').toString('utf8');
}

async function ensureCSVs(files, fromDir) {
  if (fromDir) {
    const out = [];
    for (const f of files) {
      const p = path.join(fromDir, f);
      out.push([f, await readFile(p, 'utf8')]);
    }
    return out;
  }
  await mkdir(CACHE, { recursive: true });
  const out = [];
  for (const f of files) {
    const p = path.join(CACHE, f);
    if (existsSync(p)) {
      out.push([f, await readFile(p, 'utf8')]);
    } else {
      process.stderr.write(`  downloading ${SACKMANN.mirrorRepo}/${f} …\n`);
      const text = await downloadCSV(SACKMANN.mirrorRepo, f);
      await writeFile(p, text);
      out.push([f, text]);
    }
  }
  return out;
}

function renderReport({ files, built, byMarket }) {
  const lines = ['SportsPred historical backtest', '='.repeat(56)];
  lines.push(`mirror            : ${SACKMANN.mirrorRepo} (Sackmann dataset, CC BY-NC-SA 4.0)`);
  lines.push(`files             : ${files.join(', ')}`);
  lines.push(`rows read         : ${built.order}`);
  lines.push(`rows scored       : ${built.matches.length}`);
  lines.push(`rows excluded     : ${built.excluded.length}`);
  lines.push('');
  lines.push('Markets scored with the live engine (odds/h2h/injury factors missing).');
  lines.push('NOTE: the raw score is a points total, not a calibrated probability. The');
  lines.push('      raw-score bucket table below is the calibration evidence; Brier/log loss');
  lines.push('      are computed on rawScore/100 purely as a descriptive figure.');
  for (const [market, m] of Object.entries(byMarket)) {
    lines.push('');
    lines.push(`— ${market.toUpperCase()} —`);
    lines.push(`  picks graded     : ${m.total}`);
    lines.push(`  settled          : ${m.settled}   void: ${m.void}`);
    if (m.hitRate == null) {
      lines.push('  nothing settled — no metric computed');
      continue;
    }
    lines.push(`  hit rate         : ${(m.hitRate * 100).toFixed(1)}%`);
    lines.push(`  Brier            : ${m.brier.toFixed(4)}  (lower better; coin flip 0.25)`);
    lines.push(`  log loss         : ${m.logLoss.toFixed(4)}  (lower better; coin flip 0.6931)`);
    lines.push('  by raw-score bucket:');
    for (const b of m.byBucket) {
      lines.push(`    ${b.bucket.padEnd(8)} n=${String(b.n).padStart(5)}  hit ${(b.hitRate * 100).toFixed(1)}%`);
    }
    if (Object.keys(m.byBand).length) {
      lines.push('  by engine band (guard caps at LOW when >2 factors missing):');
      for (const [band, v] of Object.entries(m.byBand)) {
        lines.push(`    ${band.padEnd(7)} n=${String(v.n).padStart(5)}  hit ${(v.hitRate * 100).toFixed(1)}%`);
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const years = (arg('--years', '2024,2025') || '').split(',').filter(Boolean);
  const files = SACKMANN.matchFiles.filter((f) => years.some((y) => f.includes(y)));
  const fromDir = arg('--from-dir', null);

  const loaded = await ensureCSVs(files, fromDir);
  const rows = [];
  for (const [f, text] of loaded) {
    const parsed = parseCSV(text);
    rows.push(...parsed);
    process.stderr.write(`  ${f}: ${parsed.length} rows\n`);
  }

  const built = buildFeatures(rows);
  const graded = { win_match: [], first_set: [] };
  for (const { match } of built.matches) {
    const result = scoreMatch(match);
    if (result.favourite == null) continue;
    for (const g of gradeResult(match, result)) {
      graded[g.market].push(g);
    }
  }

  const byMarket = {
    win_match: aggregate(graded.win_match),
    first_set: aggregate(graded.first_set),
  };

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ mirror: SACKMANN.mirrorRepo, files, built: { read: built.order, scored: built.matches.length, excluded: built.excluded.length }, byMarket }, null, 2) + '\n');
  } else {
    process.stdout.write(renderReport({ files, built, byMarket }) + '\n');
  }
  return 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
