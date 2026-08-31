/**
 * SportsPred — backtest / grading harness.
 *
 * Grades recorded predictions against settled results and reports metrics that
 * actually speak to predictive quality, not just a hit rate.
 *
 *     node scripts/backtest.mjs                  # grade everything recorded
 *     node scripts/backtest.mjs --json           # machine-readable output
 *
 * Metric definitions used here:
 *   hit rate  — fraction of settled picks that were correct
 *   Brier     — mean squared error of the implied probability; lower is better
 *   log loss  — mean negative log likelihood; lower is better
 *   ROI       — mean profit per unit staked at the recorded price, if a price
 *               was recorded. Without a price, ROI is reported as unavailable
 *               rather than estimated.
 *
 * If nothing is recorded or nothing is settled, this says so. It does not
 * synthesise a result set to produce a nicer-looking report.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

/** Map a confidence band to the probability the model is implicitly claiming. */
export const BAND_PROBABILITY = { HIGH: 0.78, MEDIUM: 0.62, LOW: 0.5 };

export function gradeOne(pred, result) {
  if (!result) return { status: 'unsettled' };

  if (pred.market === 'win_match') {
    if (result.winner == null) return { status: 'void', reason: 'no result recorded' };
    const correct = normalise(result.winner) === normalise(pred.selection);
    return { status: 'settled', correct };
  }

  if (pred.market === 'first_set') {
    if (result.firstSetWinner == null) return { status: 'void', reason: 'first-set result not recorded' };
    const correct = normalise(result.firstSetWinner) === normalise(pred.selection);
    return { status: 'settled', correct };
  }

  if (pred.market === 'games_handicap') {
    if (result.gamesMargin == null || pred.line == null) {
      return { status: 'void', reason: 'games margin or line not recorded' };
    }
    // Convention, stated explicitly because the sign convention is where
    // handicap grading goes wrong:
    //   result.gamesMargin is signed from the FAVOURITE's perspective
    //     (positive = favourite won more games).
    //   pred.line is the handicap of the SELECTED side, so it is negative for
    //     the favourite side and positive for the underdog side.
    // A side covers when its own margin plus its handicap is strictly positive.
    const covered = pred.line < 0
      ? result.gamesMargin + pred.line > 0   // favourite: margin must exceed |line|
      : pred.line - result.gamesMargin > 0;  // underdog: margin must stay under the line
    return { status: 'settled', correct: covered };
  }

  return { status: 'void', reason: `unknown market ${pred.market}` };
}

function normalise(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function metrics(records) {
  const settled = records.filter((r) => r.status === 'settled');
  const out = {
    total: records.length,
    settled: settled.length,
    unsettled: records.filter((r) => r.status === 'unsettled').length,
    void: records.filter((r) => r.status === 'void').length,
  };
  if (!settled.length) return out;

  const wins = settled.filter((r) => r.correct).length;
  out.hitRate = wins / settled.length;

  const probs = settled.map((r) => BAND_PROBABILITY[r.band] ?? 0.5);
  out.brier = settled.reduce((a, r, i) => a + (probs[i] - (r.correct ? 1 : 0)) ** 2, 0) / settled.length;
  out.logLoss = settled.reduce((a, r, i) => {
    const p = Math.min(Math.max(probs[i], 1e-6), 1 - 1e-6);
    return a - Math.log(r.correct ? p : 1 - p);
  }, 0) / settled.length;

  const priced = settled.filter((r) => r.price != null);
  if (priced.length) {
    out.pricedCount = priced.length;
    out.roi = priced.reduce((a, r) => a + (r.correct ? r.price - 1 : -1), 0) / priced.length;
  } else {
    out.roi = null;
    out.roiNote = 'no prices recorded, so ROI cannot be computed';
  }

  out.byBand = {};
  for (const band of ['HIGH', 'MEDIUM', 'LOW']) {
    const rows = settled.filter((r) => r.band === band);
    if (rows.length) {
      out.byBand[band] = {
        n: rows.length,
        hitRate: rows.filter((r) => r.correct).length / rows.length,
      };
    }
  }

  out.byMarket = {};
  for (const m of ['win_match', 'first_set', 'games_handicap']) {
    const rows = settled.filter((r) => r.market === m);
    if (rows.length) {
      out.byMarket[m] = {
        n: rows.length,
        hitRate: rows.filter((r) => r.correct).length / rows.length,
      };
    }
  }

  return out;
}

export function renderReport(m) {
  const lines = ['SportsPred backtest report', '='.repeat(40)];
  lines.push(`predictions recorded : ${m.total}`);
  lines.push(`settled              : ${m.settled}`);
  lines.push(`awaiting result      : ${m.unsettled}`);
  lines.push(`void / ungradeable   : ${m.void}`);

  if (!m.settled) {
    lines.push('');
    lines.push('Nothing is settled yet, so no metric can be computed.');
    lines.push('');
    lines.push('Two things are missing, and neither is guessed:');
    lines.push('  1. Recorded predictions — produced by scripts/record_predictions.mjs on each');
    lines.push('     collection run, so forward collection accumulates automatically.');
    lines.push('  2. Settled results — data/results.json. The canonical free ATP/WTA match');
    lines.push('     dataset is no longer publicly reachable (IR-02), so results must come');
    lines.push('     from a source that is verified reachable before grading can start.');
    lines.push('');
    lines.push('Reporting a hit rate here would mean inventing results. It does not.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`hit rate : ${(m.hitRate * 100).toFixed(1)}%`);
  lines.push(`Brier    : ${m.brier.toFixed(4)}   (lower is better; a coin flip is 0.25)`);
  lines.push(`log loss : ${m.logLoss.toFixed(4)}   (lower is better; a coin flip is 0.6931)`);
  lines.push(`ROI      : ${m.roi == null ? `unavailable — ${m.roiNote}` : `${(m.roi * 100).toFixed(2)}% over ${m.pricedCount} priced picks`}`);

  if (m.byBand && Object.keys(m.byBand).length) {
    lines.push('');
    lines.push('by confidence band:');
    for (const [band, v] of Object.entries(m.byBand)) {
      lines.push(`  ${band.padEnd(7)} n=${String(v.n).padStart(4)}  hit ${(v.hitRate * 100).toFixed(1)}%`);
    }
  }
  if (m.byMarket && Object.keys(m.byMarket).length) {
    lines.push('');
    lines.push('by market:');
    for (const [mk, v] of Object.entries(m.byMarket)) {
      lines.push(`  ${mk.padEnd(15)} n=${String(v.n).padStart(4)}  hit ${(v.hitRate * 100).toFixed(1)}%`);
    }
  }
  return lines.join('\n');
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const predictions = await readJSON(path.join(DATA, 'predictions.json'), { predictions: [] });
  const results = await readJSON(path.join(DATA, 'results.json'), { results: {} });

  const byEvent = {};
  for (const r of results.results || []) byEvent[r.event_id] = r;

  const records = (predictions.predictions || []).map((p) => ({
    ...p,
    ...gradeOne(p, byEvent[p.event_id]),
  }));

  const m = metrics(records);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(m, null, 2) + '\n');
  } else {
    process.stdout.write(renderReport(m) + '\n');
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
