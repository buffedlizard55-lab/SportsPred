/**
 * SportsPred — shared UI shell and small render helpers.
 * Every page imports this so the masthead, sport rail and footer cannot drift.
 */

import { SPORTS, OLBG_TIPSTER_ONLY } from '../../engine/registry.js';
import { siteUrl } from './data-client.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtTime(startUtc) {
  if (!startUtc) return '--:--';
  const d = new Date(startUtc);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateLong(dateISO) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateISO;
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function relTime(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const PAGES = [
  { href: 'index.html', label: 'Home' },
  { href: 'predictions.html', label: 'Predictions' },
  { href: 'markets.html', label: 'OLBG Markets' },
  { href: 'method.html', label: 'Method & Backtest' },
  { href: 'sources.html', label: 'Sources' },
];

/** Render the masthead + sport rail into <body>, before the main element. */
export function renderShell({ activeSport = null, activePage = 'index.html' } = {}) {
  const railLinks = SPORTS.map((s) => `
    <a href="${siteUrl(s.page || `sport.html?sport=${s.key}`)}" class="${activeSport === s.key ? 'on' : ''}" data-sport="${esc(s.key)}">
      <span class="ico" aria-hidden="true">${s.icon}</span>${esc(s.short || s.name)}
      ${s.predictable ? '' : '<span class="nofeed" title="No key-less statistics feed: markets are listed for review but never predicted">markets only</span>'}
    </a>`).join('');

  const html = `
  <header class="masthead">
    <div class="wrap mast-top">
      <a class="brand" href="${siteUrl('index.html')}">
        <span class="brand-mark">SP</span>
        <span>
          <span class="brand-name">SportsPred</span><br>
          <span class="brand-sub">Scoreboard &amp; prediction engine</span>
        </span>
      </a>
      <span class="mast-spacer"></span>
      <nav class="mast-links" aria-label="Site sections">
        ${PAGES.map((p) => `<a href="${siteUrl(p.href)}" class="${activePage === p.href ? 'on' : ''}">${esc(p.label)}</a>`).join('')}
      </nav>
    </div>
    <nav class="sportrail" aria-label="Sports">
      <div class="wrap sportrail-inner">${railLinks}</div>
    </nav>
  </header>`;

  document.body.insertAdjacentHTML('afterbegin', html);
}

export function renderFooter() {
  const html = `
  <footer class="site">
    <div class="wrap">
      <p><strong>Responsible gambling.</strong> Nothing on this site is betting advice or a guarantee of any outcome.
      Every prediction is generated mechanically from public data and is fallible. 18+.
      Support: <a href="https://www.begambleaware.org/" target="_blank" rel="noopener noreferrer">BeGambleAware.org</a>.</p>
      <p><strong>Sources.</strong> Fixtures, scores, records, form and prices come from ESPN's public key-less JSON API;
      the market slate comes from <a href="https://www.olbg.com/betting-tips" target="_blank" rel="noopener noreferrer">OLBG</a>.
      Prices shown are those ESPN republishes from the named sportsbook, not a SportsPred quote.
      Full list on the <a href="${siteUrl('sources.html')}">sources page</a>;
      known gaps on the <a href="${siteUrl('sources.html')}#irregularities">irregularities register</a>.</p>
      <p>OLBG sports covered: ${SPORTS.length} betting-tips indexes plus ${OLBG_TIPSTER_ONLY.length} tipster-only sports.
      Open source — <a href="https://github.com/buffedlizard55-lab/SportsPred" target="_blank" rel="noopener noreferrer">view the repository</a>.</p>
    </div>
  </footer>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

let toastTimer = null;
export function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is blocked in some embedded contexts; fall back.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

export function confBar(score, band) {
  const pctv = Math.max(0, Math.min(100, Number(score) || 0));
  const colour = band === 'HIGH' ? 'var(--high)' : band === 'MEDIUM' ? 'var(--medium)' : 'var(--low)';
  return `<span class="conf" title="Confidence ${pctv}/100">
    <span class="conf-bar"><i style="width:${pctv}%;background:${colour}"></i></span>
    <span class="conf-num">${pctv}</span></span>`;
}

export function formPips(form) {
  if (!Array.isArray(form) || !form.length) return '';
  return `<span class="form-pips" title="Last ${form.length}, most recent first">${
    form.slice(0, 5).map((f) => `<i class="${esc(f)}">${esc(f)}</i>`).join('')
  }</span>`;
}

export function qs(name, fallback = null) {
  return new URLSearchParams(location.search).get(name) ?? fallback;
}

export function setQS(params) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  history.replaceState(null, '', u);
}
