/**
 * SportsPred — sources, verification report and irregularities register.
 * Everything on this page is rendered from committed machine-readable files,
 * so the page cannot say something the data does not.
 */

import { SPORTS, OLBG_SITEMAP_URL, OLBG_SITEMAP_READ_UTC, REGISTRY_VERSION } from '../../engine/registry.js';
import { loadStatic } from './data-client.js';
import { $, esc, renderShell, renderFooter } from './ui.js';

async function boot() {
  renderShell({ activeSport: null, activePage: 'sources.html' });
  renderFooter();

  $('#reg-version').textContent = REGISTRY_VERSION;
  $('#sitemap').innerHTML = `<a href="${esc(OLBG_SITEMAP_URL)}" target="_blank" rel="noopener noreferrer">${esc(OLBG_SITEMAP_URL)}</a> — read ${esc(OLBG_SITEMAP_READ_UTC)}`;

  // ---- league verification report ----
  const reg = await loadStatic('data/leagues.json');
  const box = $('#registry-report');
  if (!reg.data) {
    box.innerHTML = `<div class="note">The registry has not been built yet. Run <code>node scripts/build_league_registry.mjs</code>
      (it needs outbound network, so it runs in CI). Until then the sport pages use the candidate list and label it unverified.</div>`;
  } else {
    const d = reg.data;
    const rows = [];
    for (const [sportKey, block] of Object.entries(d.sports || {})) {
      for (const l of block.leagues || []) {
        rows.push({ sportKey, ...l });
      }
    }
    box.innerHTML = `
      <div class="note info">Built <code>${esc(d.generated_at_utc)}</code> — ${d.summary.ok} of ${d.summary.checked} competitions answered HTTP 200.
        ${esc(d.method)}</div>
      <table class="data">
        <thead><tr><th>Sport</th><th>Competition</th><th>Slug</th><th class="num">HTTP</th><th class="num">Events</th><th>Odds</th><th>Endpoint checked</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.sportKey)}</td>
          <td>${esc(r.name)}</td>
          <td><code>${esc(r.slug)}</code></td>
          <td class="num">${r.ok ? `<span class="badge HIGH">${r.status}</span>` : `<span class="badge SKIP">${r.status || 'ERR'}</span>`}</td>
          <td class="num">${r.eventsOnCheckDate ?? '—'}</td>
          <td>${r.oddsSeen ? 'yes' : 'no'}</td>
          <td><a href="${esc(r.checkedUrl)}" target="_blank" rel="noopener noreferrer">open ↗</a></td>
        </tr>`).join('')}</tbody></table>`;
  }

  // ---- league baselines ----
  const ctx = await loadStatic('data/league_context.json');
  const cbox = $('#context-report');
  if (!ctx.data) {
    cbox.innerHTML = '<div class="note">Baselines not built yet — run <code>node scripts/build_league_context.mjs</code> in CI.</div>';
  } else {
    const d = ctx.data;
    const rows = Object.entries(d.leagues || {}).filter(([, v]) => v.sufficient);
    cbox.innerHTML = `
      <div class="note info">Measured over ${esc(String(d.window.days))} days (${esc(d.window.from)} → ${esc(d.window.to)}),
        built <code>${esc(d.generated_at_utc)}</code>. ${esc(d.method)}</div>
      <table class="data">
        <thead><tr><th>League</th><th class="num">Completed</th><th class="num">Home win</th><th class="num">Draw</th>
          <th class="num">Away win</th><th class="num">Mean total</th><th class="num">Priced</th><th>Source</th></tr></thead>
        <tbody>${rows.map(([k, v]) => `<tr>
          <td>${esc(v.leagueName || k)} <code>${esc(k)}</code></td>
          <td class="num">${v.sample}</td>
          <td class="num">${(v.homeWinRate * 100).toFixed(1)}%</td>
          <td class="num">${(v.drawRate * 100).toFixed(1)}%</td>
          <td class="num">${(v.awayWinRate * 100).toFixed(1)}%</td>
          <td class="num">${v.meanTotal}</td>
          <td class="num">${v.pricedMatches ?? '—'}</td>
          <td><a href="${esc(v.sourceUrl)}" target="_blank" rel="noopener noreferrer">endpoint ↗</a></td>
        </tr>`).join('')}</tbody></table>
      <p class="meta-line">${d.summary.thin} leagues had too few completed matches to measure and receive no baseline;
        ${d.summary.failed} endpoints failed at build time.</p>`;
  }

  // ---- irregularities ----
  const irr = await loadStatic('data/irregularities.json');
  const ibox = $('#irr');
  if (!irr.data) {
    ibox.innerHTML = '<div class="note">Register unavailable.</div>';
  } else {
    ibox.innerHTML = `<table class="data">
      <thead><tr><th>Id</th><th>Finding</th><th>Status</th><th>Effect on output</th><th>Verify it yourself</th></tr></thead>
      <tbody>${(irr.data.irregularities || []).map((r) => `<tr>
        <td><code>${esc(r.id)}</code></td>
        <td><strong>${esc(r.title)}</strong><div class="meta-line">${esc(r.detail)}</div></td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.effect)}</td>
        <td>${(r.links || []).map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">link ↗</a>`).join(' ')}</td>
      </tr>`).join('')}</tbody></table>
      <p class="meta-line">Register last updated ${esc(irr.data.generated_at_utc || '')}.</p>`;
  }

  // ---- greyhound irregularities (GBGB specialist layer) ----
  const gh = await loadStatic('data/greyhound_provenance.json');
  const ghbox = $('#gh-irr');
  if (ghbox) {
    if (!gh.data) {
      ghbox.innerHTML = '<div class="note">Greyhound register unavailable (data/greyhound_provenance.json).</div>';
    } else {
      ghbox.innerHTML = `<table class="data">
        <thead><tr><th>Id</th><th>Finding</th><th>Status</th><th>Effect on output</th><th>Verify it yourself</th></tr></thead>
        <tbody>${(gh.data.irregularities || []).map((r) => `<tr>
          <td><code>${esc(r.id)}</code></td>
          <td><strong>${esc(r.title)}</strong><div class="meta-line">${esc(r.detail)}</div></td>
          <td>${esc(r.status)}</td>
          <td>${esc(r.effect_on_output)}</td>
          <td>${(r.sources || []).map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">link ↗</a>`).join(' ')}</td>
        </tr>`).join('')}</tbody></table>
        <p class="meta-line">Register generated ${esc(gh.data.generated_at_utc || '')}. See <a href="greyhounds.html">the greyhound scoreboard</a>.</p>`;
    }
  }

  // ---- sport source list ----
  $('#sport-sources').innerHTML = `<table class="data">
    <thead><tr><th>Sport</th><th>OLBG index</th><th>Statistics feed</th><th>Status</th><th>Official references</th></tr></thead>
    <tbody>${SPORTS.map((s) => `<tr>
      <td>${s.icon} ${esc(s.name)}</td>
      <td><a href="https://www.olbg.com/betting-tips/${esc(s.olbgSlug)}/${s.olbgId}" target="_blank" rel="noopener noreferrer">/${esc(s.olbgSlug)}/${s.olbgId} ↗</a></td>
      <td>${s.espnSport ? `<code>ESPN ${esc(s.espnSport)}</code>` : '<span class="badge SKIP">none</span>'}</td>
      <td>${s.predictable ? '<span class="badge HIGH">predicted</span>' : '<span class="badge SKIP">review only</span>'}</td>
      <td>${s.officialLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('<br>')}</td>
    </tr>`).join('')}</tbody></table>`;
}

boot().catch((e) => {
  console.error(e);
  $('#irr').innerHTML = `<div class="note bad">Failed to load: ${esc(e.message)}</div>`;
});
