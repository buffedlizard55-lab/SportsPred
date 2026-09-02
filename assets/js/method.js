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
  box.innerHTML = `
    <div class="note info">Window ${esc(d.window.from)} → ${esc(d.window.to)} (${d.window.days} days), built <code>${esc(d.generated_at_utc)}</code>.</div>
    <div class="note"><strong>Leak control.</strong> ${esc(d.leak_control)}</div>
    <div class="note"><strong>Known limitation.</strong> ${esc(d.known_limitation)}</div>
    <table class="data"><thead><tr><th>Band</th><th class="num">Selections</th><th class="num">Hit rate</th><th class="num">Brier</th><th class="num">Flat ROI</th></tr></thead>
      <tbody>
        <tr><td><strong>All</strong></td><td class="num">${d.overall.n}</td><td class="num">${p(d.overall.hitRate)}</td>
          <td class="num">${d.overall.brier === null ? 'n/a' : d.overall.brier.toFixed(4)}</td><td class="num">${p(d.overall.roi)}</td></tr>
        ${Object.entries(d.byBand || {}).map(([band, v]) => `<tr>
          <td><span class="badge ${esc(band)}">${esc(band)}</span></td>
          <td class="num">${v.n}</td><td class="num">${p(v.hitRate)}</td>
          <td class="num">${v.brier === null ? 'n/a' : v.brier.toFixed(4)}</td><td class="num">${p(v.roi)}</td></tr>`).join('')}
      </tbody></table>
    <p class="meta-line">A well-calibrated model should show hit rate rising monotonically from LOW to HIGH. If it does not, the
      bands are miscalibrated and the weights above need revisiting — that is exactly what this table is for.</p>`;
}

boot().catch((e) => { console.error(e); $('#backtest').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; });
