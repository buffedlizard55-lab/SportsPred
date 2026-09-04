/**
 * SportsPred — OLBG market directory.
 * Lists every OLBG betting-tips index with the live row counts from the last
 * collector run, and renders the committed slate snapshots underneath.
 */

import { SPORTS, OLBG_TIPSTER_ONLY, OLBG_SITEMAP_URL, OLBG_SITEMAP_READ_UTC } from '../../engine/registry.js';
import { loadStatic } from './data-client.js';
import { $, esc, renderShell, renderFooter } from './ui.js';

const SNAPSHOTS = [
  { key: 'cricket', label: 'Cricket', path: 'data/cricket_slate.json' },
  { key: 'handball', label: 'Handball', path: 'data/handball_slate.json' },
  { key: 'tennis', label: 'Tennis', path: 'data/slate.json' },
  { key: 'motor-racing', label: 'Motor Racing', path: 'data/f1_slate.json' },
  { key: 'golf', label: 'Golf', path: 'data/golf_slate.json' },
  { key: 'volleyball', label: 'Volleyball', path: 'data/volleyball_slate.json' },
];

async function boot() {
  renderShell({ activeSport: null, activePage: 'markets.html' });
  renderFooter();

  $('#sitemap-note').innerHTML = `Sport list transcribed from
    <a href="${esc(OLBG_SITEMAP_URL)}" target="_blank" rel="noopener noreferrer">${esc(OLBG_SITEMAP_URL)}</a>
    on ${esc(OLBG_SITEMAP_READ_UTC)}. Every id below is the number OLBG itself uses in the URL.`;

  const counts = await loadStatic('data/olbg_sports.json');
  const byName = new Map();
  for (const row of counts.data?.sports || []) byName.set(String(row.olbg_id), row);

  $('#dir').innerHTML = `
    <table class="data">
      <thead><tr><th>Sport</th><th class="num">OLBG id</th><th class="num">Events</th><th class="num">Tip rows</th>
        <th>Markets seen</th><th>Engine</th><th>Official index</th></tr></thead>
      <tbody>${SPORTS.map((s) => {
    const c = byName.get(String(s.olbgId));
    return `<tr>
          <td>${s.icon} <strong>${esc(s.name)}</strong></td>
          <td class="num"><code>${s.olbgId}</code></td>
          <td class="num">${c ? c.events : '—'}</td>
          <td class="num">${c ? c.tip_rows : '—'}</td>
          <td>${c && c.markets_seen?.length ? esc(c.markets_seen.join(', ')) : '<span class="meta-line">none open</span>'}</td>
          <td>${s.predictable
      ? `<span class="badge HIGH">${esc(s.specialistEngine ? `${s.specialistEngine} engine` : 'universal')}</span>`
      : '<span class="badge SKIP">review only</span>'}</td>
          <td><a href="https://www.olbg.com/betting-tips/${esc(s.olbgSlug)}/${s.olbgId}" target="_blank" rel="noopener noreferrer">open ↗</a>
              · <a href="${esc(s.page || `sport.html?sport=${s.key}`)}">scoreboard</a>${(s.subPages || []).filter((p) => p.href !== s.page).map((p) => ` · <a href="${esc(p.href)}">${esc(p.label)}</a>`).join('')}</td>
        </tr>`;
  }).join('')}
      <tr><td colspan="7" style="background:#fbfcfe"><strong>Tipster-only sports</strong> — these appear in the OLBG sitemap under
        <code>/best-tipsters/</code> with no betting-tips index of their own.</td></tr>
      ${OLBG_TIPSTER_ONLY.map((t) => `<tr>
        <td>${esc(t.name)}</td><td class="num"><code>${t.olbgId}</code></td>
        <td class="num">—</td><td class="num">—</td><td class="meta-line">no tips index</td>
        <td><span class="badge SKIP">not covered</span></td>
        <td><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">tipster page ↗</a></td></tr>`).join('')}
      </tbody>
    </table>`;

  if (counts.data?.fetched_at_utc) {
    $('#dir-meta').innerHTML = `Row counts collected ${esc(counts.data.fetched_at_utc)} by <code>scripts/collect_olbg_sports.py</code>.
      Counts move constantly; the link column always goes to the live page.`;
  } else {
    $('#dir-meta').textContent = 'Row counts unavailable — data/olbg_sports.json has not been collected yet.';
  }

  for (const snap of SNAPSHOTS) {
    const res = await loadStatic(snap.path);
    const slate = res.data;
    const el = document.createElement('div');
    el.className = 'card';
    if (!slate) {
      el.innerHTML = `<div class="card-head"><h2>${esc(snap.label)}</h2></div>
        <div class="card-body meta-line">Snapshot not available.</div>`;
    } else {
      const rows = slate.events || [];
      el.innerHTML = `
        <div class="card-head"><h2>${esc(snap.label)} — committed OLBG snapshot</h2><span class="sp"></span>
          <span class="meta-line">${rows.length} rows · fetched ${esc(slate.source?.fetched_at_utc || '?')}</span></div>
        <div class="card-body tight">
          <table class="data"><thead><tr><th>Date</th><th>Event</th><th>Market</th><th>Consensus selection</th><th class="num">Tips</th><th>Review</th></tr></thead>
          <tbody>${rows.slice(0, 60).map((e) => `<tr>
            <td>${esc(e.resolved_date || e.date || '—')}</td>
            <td>${esc(e.event_name || `${e.home || ''} v ${e.away || ''}`)}</td>
            <td>${esc(e.consensus?.market || e.market || '—')}</td>
            <td>${esc(e.consensus?.selection || '—')}</td>
            <td class="num">${e.consensus?.tips_for ?? '—'}${e.consensus?.tips_total ? `/${e.consensus.tips_total}` : ''}</td>
            <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">OLBG ↗</a>` : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="empty">No rows in this snapshot.</td></tr>'}</tbody></table>
        </div>
        <div class="card-body meta-line">Source: <a href="${esc(slate.source?.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(slate.source?.url || '')}</a>
          · method: ${esc(slate.source?.method || 'n/a')}</div>`;
    }
    $('#snapshots').appendChild(el);
  }
}

boot().catch((e) => {
  console.error(e);
  $('#dir').innerHTML = `<div class="note bad">Failed to load: ${esc(e.message)}</div>`;
});
