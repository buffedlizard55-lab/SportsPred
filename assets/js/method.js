/** SportsPred — method & backtest page. */
import { WEIGHTS, CONFIDENCE_BANDS, MIN_SIGNALS, RULESET_VERSION } from '../../engine/universal_engine.js';
import { WRITER_VERSION, BANNED_PHRASES } from '../../engine/universal_writer.js';
import { loadStatic } from './data-client.js';
import { $, esc, renderShell, renderFooter } from './ui.js';

async function boot() {
  renderShell({ activeSport: null, activePage: 'method.html' });
  renderFooter();

  $('#versions').innerHTML = `engine <code>${esc(RULESET_VERSION)}</code> · writer <code>${esc(WRITER_VERSION)}</code> · minimum sourced signals <code>${MIN_SIGNALS}</code>`;

  $('#weights').innerHTML = `<table class="data"><thead><tr><th>Hyperparameter</th><th class="num">Value</th><th>What it multiplies</th></tr></thead><tbody>
    <tr><td><code>form</code></td><td class="num">${WEIGHTS.form}</td><td>home form rate minus away form rate, each in 0–1</td></tr>
    <tr><td><code>record</code></td><td class="num">${WEIGHTS.record}</td><td>home win percentage minus away win percentage</td></tr>
    <tr><td><code>rank</code></td><td class="num">${WEIGHTS.rank}</td><td>curated ranking gap, normalised over 25 places and clamped</td></tr>
    <tr><td><code>h2h</code></td><td class="num">${WEIGHTS.h2h}</td><td>head-to-head win share among decided prior meetings</td></tr>
    <tr><td><code>rest</code></td><td class="num">${WEIGHTS.rest}</td><td>rest-day gap, normalised over a week and clamped</td></tr>
    <tr><td><code>marketWeight</code></td><td class="num">${WEIGHTS.marketWeight}</td><td>weight given to the de-vigged price when blending with the model</td></tr>
  </tbody></table>`;

  $('#bands').innerHTML = CONFIDENCE_BANDS.map((b) => `<span class="badge ${esc(b.band)}">${esc(b.band)}</span> ${b.min}+`).join(' &nbsp; ')
    + ' &nbsp; <span class="badge SKIP">SKIP</span> below that, or fewer than ' + MIN_SIGNALS + ' sourced signals';

  $('#banned').innerHTML = BANNED_PHRASES.map((p) => `<code>${esc(p)}</code>`).join(' ');

  const bt = await loadStatic('data/universal_backtest.json');
  const box = $('#backtest');
  if (!bt.data) {
    box.innerHTML = `<div class="note">No backtest artifact committed yet. It is produced by
      <code>node scripts/backtest_universal.mjs</code>, which needs outbound network and therefore runs in CI.
      Until it exists this page shows no performance numbers rather than placeholder ones.</div>`;
    return;
  }
  const d = bt.data;
  const p = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);

  // If no graded fixture carried a price, there is no ROI to show. Rather than
  // print a column of "n/a", the column is dropped and the reason is stated.
  // See U-06 in the irregularity register.
  const rows = [['All', d.overall], ...Object.entries(d.byBand || {})];
  const anyRoi = rows.some(([, v]) => typeof v?.roi === 'number');
  const roiHead = anyRoi ? '<th class="num">Flat ROI</th>' : '';
  const roiCell = (v) => (anyRoi ? `<td class="num">${p(v.roi)}</td>` : '');

  const cells = ([band, v]) => `<tr>
      <td>${band === 'All' ? '<strong>All</strong>' : `<span class="badge ${esc(band)}">${esc(band)}</span>`}</td>
      <td class="num">${v.n}</td><td class="num">${p(v.hitRate)}</td>
      <td class="num">${v.brier === null || v.brier === undefined ? 'n/a' : v.brier.toFixed(4)}</td>
      ${roiCell(v)}</tr>`;

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const banded = rows.slice(1).sort((a, b) => (order[a[0]] ?? 9) - (order[b[0]] ?? 9));

  // State whether the bands actually separate, computed from the artifact
  // rather than asserted in prose.
  const hi = d.byBand?.HIGH?.hitRate; const me = d.byBand?.MEDIUM?.hitRate; const lo = d.byBand?.LOW?.hitRate;
  const monotonic = [hi, me, lo].every((x) => typeof x === 'number') && hi > me && me > lo;
  const verdict = [hi, me, lo].every((x) => typeof x === 'number')
    ? (monotonic
      ? `<div class="note good"><strong>The bands separate.</strong> HIGH ${p(hi)} &gt; MEDIUM ${p(me)} &gt; LOW ${p(lo)}
         over ${d.overall.n} graded selections. That ordering is the one thing a confidence scale has to get right.
         It is a single ${d.window.days}-day window and it is not evidence of profitability.</div>`
      : `<div class="note bad"><strong>The bands do not separate</strong> — HIGH ${p(hi)}, MEDIUM ${p(me)}, LOW ${p(lo)}.
         The confidence scale is miscalibrated and the weights above need revisiting. This is published rather than hidden.</div>`)
    : '';

  box.innerHTML = `
    <div class="note info">Window ${esc(d.window.from)} → ${esc(d.window.to)} (${d.window.days} days), built <code>${esc(d.generated_at_utc)}</code>.</div>
    ${verdict}
    <div class="note"><strong>Leak control.</strong> ${esc(d.leak_control)}</div>
    <div class="note"><strong>Known limitation.</strong> ${esc(d.known_limitation)}</div>
    <table class="data"><thead><tr><th>Band</th><th class="num">Selections</th><th class="num">Hit rate</th><th class="num">Brier</th>${roiHead}</tr></thead>
      <tbody>${[rows[0], ...banded].map(cells).join('')}</tbody></table>
    ${anyRoi ? '' : `<p class="meta-line">There is no ROI column because no ROI is computable: ESPN strips the odds block
      from completed events, so none of the ${d.overall.n} graded fixtures carried a price. This table therefore grades the
      model probability only — the market-blend leg of the engine is untested by it. Tracked as
      <a href="sources.html#irregularities">U-06</a>.</p>`}
    <p class="meta-line">Full method and the leak-control detail:
      <a href="https://github.com/buffedlizard55-lab/SportsPred/blob/main/docs/UNIVERSAL_ENGINE.md" target="_blank" rel="noopener noreferrer">docs/UNIVERSAL_ENGINE.md</a>.</p>`;
}

boot().catch((e) => { console.error(e); $('#backtest').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; });
