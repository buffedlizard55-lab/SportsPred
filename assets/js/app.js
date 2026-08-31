/**
 * SportsPred — site controller.
 *
 * Scoring and writing are imported from /engine so the browser runs exactly the
 * code the test suite covers. This file only does I/O, joining and rendering.
 *
 * Data policy: nothing is invented here. If a field is absent from the JSON
 * snapshots it stays absent in the match object, the engine records it as
 * missing, and the UI shows it under "Data quality".
 */

import { scoreMatch, scoreCard, RULESET_VERSION, PATCHES, PROMPT_VERSION } from '../../engine/engine.mjs';
import { writeTip, writeCard, OPENERS, MIN_WORDS } from '../../engine/writer.mjs';
import { toMatch, phaseOf as phaseOfEvent } from '../../engine/join.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  slate: null,
  players: null,
  provenance: null,
  phase: 'upcoming',
  search: '',
  selectedDate: null,
  calMonth: null,
  tips: [],
  lastCard: null,
};

/* ------------------------------------------------------------------ *
 * Load
 * ------------------------------------------------------------------ */

async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

async function boot() {
  try {
    state.slate = await loadJSON('data/slate.json');
  } catch (e) {
    $('#match-list').innerHTML = `<div class="empty">Could not load the match snapshot: ${e.message}</div>`;
    return;
  }
  // Optional files — their absence is a fact about collection status, not an error.
  state.players = await loadJSON('data/players.json').catch(() => ({ players: {} }));
  state.provenance = await loadJSON('data/provenance.json').catch(() => null);

  state.calMonth = new Date(state.slate.events[0]?.resolved_date || new Date().toISOString());
  state.calMonth.setDate(1);

  $('#ruleset-pill').textContent = `ruleset ${RULESET_VERSION} / prompt ${PROMPT_VERSION}`;
  $('#snapshot-pill').textContent = `snapshot ${state.slate.source.fetched_at_utc.replace('T', ' ').replace(':00Z', 'Z')}`;
  const src = $('#source-link');
  src.href = state.slate.source.url;
  src.textContent = 'OLBG source ↗';
  $('#footer-meta').textContent =
    `Snapshot fetched ${state.slate.source.fetched_at_utc} · ${state.slate.events.length} matches · ` +
    `${state.slate.outrights.length} outrights · ruleset ${RULESET_VERSION}`;

  renderScoreboard();
  renderCalendar();
  renderQuality();
  renderAbout();
}

/* ------------------------------------------------------------------ *
 * Scoreboard
 * ------------------------------------------------------------------ */

function phaseOf(ev) {
  return phaseOfEvent(ev, new Date().toISOString().slice(0, 10));
}

function renderScoreboard() {
  const list = $('#match-list');
  const q = state.search.toLowerCase();
  const rows = state.slate.events.filter((ev) => {
    if (state.phase !== 'all' && phaseOf(ev) !== state.phase) return false;
    if (state.selectedDate && ev.resolved_date !== state.selectedDate) return false;
    if (q && !`${ev.home} ${ev.away}`.toLowerCase().includes(q)) return false;
    return true;
  });

  if (!rows.length) {
    list.innerHTML = `<div class="empty">
      ${state.phase === 'results'
        ? 'No settled results in this snapshot. Results are added by the collector once matches complete.'
        : state.phase === 'live'
          ? 'No live scores in this snapshot. OLBG’s tips pages do not expose live scores, so this project does not claim them.'
          : 'No matches match the current filters.'}
    </div>`;
    return;
  }

  list.innerHTML = rows.map((ev) => {
    const match = toMatch(ev, state.players);
    const res = scoreMatch(match);
    const unscored = res.favourite === null;
    const badges = unscored
      ? '<span class="badge warn">unscored — no sourced price or ranking</span>'
      : ['win_match', 'first_set', 'games_handicap']
        .map((m) => `<span class="badge ${res.markets[m].band}" title="${label(m)} score ${res.markets[m].score}">${label(m)} ${res.markets[m].band}</span>`)
        .join(' ');
    const cons = ev.consensus
      ? `OLBG consensus: ${ev.consensus.selection} · ${ev.consensus.market} · ${ev.consensus.tips_for}/${ev.consensus.tips_total}`
      : 'no OLBG consensus listed';
    return `<div class="match" data-id="${ev.event_id}">
      <div class="when"><span class="d">${ev.display_date}</span>${ev.display_time} UK</div>
      <div>
        <div class="who">${esc(ev.home)}<span class="vs">v</span>${esc(ev.away)}</div>
        <div class="sub">${esc(cons)} · <a href="${ev.url}" target="_blank" rel="noopener noreferrer">OLBG ↗</a></div>
        <div class="sub">${badges}</div>
      </div>
      <div class="acts"><button class="btn" data-gen="${ev.event_id}">Predict</button></div>
    </div>`;
  }).join('');

  $$('#match-list [data-gen]').forEach((b) => b.addEventListener('click', () => generateFor(b.dataset.gen)));
}

function label(m) {
  return { win_match: 'Win', first_set: 'Set1', games_handicap: 'Hcap' }[m] || m;
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

function renderCalendar() {
  const grid = $('#cal-grid');
  const d = state.calMonth;
  $('#cal-title').textContent = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const first = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).getUTCDate();

  const counts = {};
  for (const ev of state.slate.events) {
    counts[ev.resolved_date] = (counts[ev.resolved_date] || 0) + 1;
  }

  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map((x) => `<div class="cal-dow">${x}</div>`).join('');

  for (let i = 0; i < startDow; i++) html += '<div class="cal-day out"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const n = counts[iso] || 0;
    const sel = state.selectedDate === iso ? ' sel' : '';
    html += `<div class="cal-day${sel}" data-date="${iso}">
      <div class="n">${day}</div>${n ? `<div class="c">${n} match${n > 1 ? 'es' : ''}</div>` : ''}</div>`;
  }
  grid.innerHTML = html;

  $$('#cal-grid [data-date]').forEach((el) => el.addEventListener('click', () => {
    state.selectedDate = state.selectedDate === el.dataset.date ? null : el.dataset.date;
    renderCalendar();
    renderScoreboard();
    renderCalDetail();
    if (state.selectedDate) switchTab('scoreboard');
  }));
  renderCalDetail();
}

function renderCalDetail() {
  const el = $('#cal-detail');
  if (!state.selectedDate) { el.innerHTML = ''; return; }
  const rows = state.slate.events.filter((e) => e.resolved_date === state.selectedDate);
  el.innerHTML = `<h2>${state.selectedDate} — ${rows.length} match${rows.length === 1 ? '' : 'es'}</h2>` +
    (rows.length ? `<table><thead><tr><th>Time (UK)</th><th>Match</th><th>OLBG consensus</th><th></th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td>${r.display_time}</td><td>${esc(r.home)} v ${esc(r.away)}</td>
        <td>${esc(r.consensus ? `${r.consensus.selection} (${r.consensus.market})` : '—')}</td>
        <td><a href="${r.url}" target="_blank" rel="noopener noreferrer">source ↗</a></td></tr>`).join('') +
      `</tbody></table>` : '<div class="empty">No matches sourced for this date.</div>');
}

/* ------------------------------------------------------------------ *
 * Predictions
 * ------------------------------------------------------------------ */

function generateFor(eventId) {
  const ev = state.slate.events.find((e) => e.event_id === eventId);
  if (!ev) return;
  const card = scoreCard([toMatch(ev, state.players)]);
  state.lastCard = card;
  const written = writeCard(card.results);
  state.tips = written.tips;
  renderPredictions(written, card);
  switchTab('predictions');
}

function generateAll() {
  const matches = state.slate.events.map((ev) => toMatch(ev, state.players));
  const card = scoreCard(matches);
  state.lastCard = card;
  const written = writeCard(card.results);
  state.tips = written.tips;
  renderPredictions(written, card);
}

function renderPredictions(written, card) {
  const out = $('#pred-out');
  const warns = $('#pred-warnings');
  const hint = $('#pred-hint');

  const notes = [];
  if (card.trimmed) notes.push(card.trimmedReason);
  if (written.openerPoolExhausted) {
    notes.push(`This card needs more tips than there are distinct openings (${written.openerPoolSize}). ` +
      `The Step 4 uniqueness rule cannot be honoured past that point; affected tips are marked.`);
  }
  const unscored = written.unscored || [];
  if (unscored.length) {
    notes.push(`${unscored.length} match${unscored.length === 1 ? '' : 'es'} could not be scored at all: no sourced price ` +
      `or ranking is available yet. Nothing has been estimated for them.`);
  }
  if (written.violations.length) {
    notes.push(`${written.violations.length} output-rule violation(s) recorded — those tips were withheld, not published.`);
  }
  warns.innerHTML = notes.length
    ? notes.map((n) => `<div class="info-box">${esc(n)}</div>`).join('')
    : '<div class="info-box">All emitted tips passed every Step 4 output rule.</div>';

  const scored = written.tips.filter((t) => t.ok);
  hint.textContent = `${scored.length} tips · ${written.tips.filter((t) => t.skip).length} skips · ` +
    `${unscored.length} unscored · min ${MIN_WORDS} words each · ruleset ${RULESET_VERSION}`;

  out.innerHTML = written.tips.map((t, i) => {
    if (!t.ok) {
      return `<div class="tip"><div class="tip-head"><span class="tip-title">withheld — failed output rules</span></div>
        <p class="words">${esc(JSON.stringify(t.violations))}</p></div>`;
    }
    const wc = t.text.split(/\s+/).filter(Boolean).length;
    return `<div class="tip${t.skip ? ' skip' : ''}">
      <div class="tip-head">
        <span class="tip-title">${esc(t.match || '')} · ${esc(t.marketLabel || '')}</span>
        <span class="tip-acts">
          <span class="badge ${t.band}">${t.band}</span>
          <span class="words">${wc} words</span>
          <button class="btn" data-copy="${i}">Copy</button>
        </span>
      </div>
      <p>${renderTipText(t.text)}</p>
    </div>`;
  }).join('');

  $$('#pred-out [data-copy]').forEach((b) => b.addEventListener('click', () => {
    const t = written.tips[Number(b.dataset.copy)];
    copy(t.text.replace(/\*\*/g, ''));
  }));

  renderSummaryTable(card, written);
}

function renderTipText(text) {
  // Only **bold** is trusted; everything else is escaped.
  return text.split(/(\*\*[^*]+\*\*)/g)
    .map((part) => part.startsWith('**') && part.endsWith('**')
      ? `<strong>${esc(part.slice(2, -2))}</strong>`
      : esc(part))
    .join('');
}

function renderSummaryTable(card, written) {
  const el = $('#pred-table');
  const rows = card.results.map(({ match, result }) => {
    const band = (m) => result.markets[m]?.band ?? '—';
    return `<tr>
      <td><a href="${match.url}" target="_blank" rel="noopener noreferrer">${esc(match.home)} v ${esc(match.away)}</a></td>
      <td>${esc(result.favourite ?? '—')}</td>
      <td><span class="badge ${band('win_match')}">${band('win_match')}</span></td>
      <td><span class="badge ${band('first_set')}">${band('first_set')}</span></td>
      <td><span class="badge ${band('games_handicap')}">${band('games_handicap')}</span></td>
      <td class="words">${result.markets.games_handicap?.band === 'SKIP' ? 'skipped — insufficient dominance evidence' : ''}</td>
    </tr>`;
  });
  el.innerHTML = `<h2>Summary</h2>
    <table><thead><tr><th>Match</th><th>Selection</th><th>Win match</th><th>First set</th><th>Games handicap</th><th>Notes</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>
    <p class="hint">Ruleset ${RULESET_VERSION}. Patches applied: ${Object.entries(PATCHES).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}.</p>`;
}

/* ------------------------------------------------------------------ *
 * Data quality
 * ------------------------------------------------------------------ */

function renderQuality() {
  const el = $('#quality-out');
  const allMissing = new Map();
  let unscored = 0;

  for (const ev of state.slate.events) {
    const res = scoreMatch(toMatch(ev, state.players));
    if (res.favourite === null) { unscored++; continue; }
    for (const m of res.missing) allMissing.set(m, (allMissing.get(m) || 0) + 1);
  }

  const irregularities = state.provenance?.irregularities || [];
  const collected = Object.keys(state.players?.players || {}).length;

  el.innerHTML = `
    <h2>Collection status</h2>
    <table><tbody>
      <tr><td>Matches in snapshot</td><td>${state.slate.events.length}</td></tr>
      <tr><td>Matches with sourced player statistics</td><td>${collected} players</td></tr>
      <tr><td>Matches the engine can score</td><td>${state.slate.events.length - unscored}</td></tr>
      <tr><td>Matches unscoreable without more data</td><td>${unscored}</td></tr>
      <tr><td>Snapshot fetched</td><td>${state.slate.source.fetched_at_utc}</td></tr>
    </tbody></table>

    <h2>Factors the engine is missing</h2>
    ${allMissing.size ? `<table><thead><tr><th>Missing factor</th><th>Matches affected</th></tr></thead><tbody>${
      [...allMissing.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${v}</td></tr>`).join('')
    }</tbody></table>` : '<div class="info-box">No missing factors.</div>'}

    <h2>Flagged irregularities</h2>
    ${irregularities.length
      ? `<ul class="tight">${irregularities.map((i) => `<li><strong>${esc(i.id)}</strong> — ${esc(i.detail)}</li>`).join('')}</ul>`
      : '<div class="info-box">No irregularities file present yet.</div>'}
  `;
}

/* ------------------------------------------------------------------ *
 * About
 * ------------------------------------------------------------------ */

function renderAbout() {
  const src = state.slate.source;
  $('#about-out').innerHTML = `
    <h2>What this is</h2>
    <p class="lede">A static scoreboard and prediction generator for tennis. Matches and markets are collected from
    public OLBG pages, joined to player statistics where those can be sourced, and scored by the three-market model
    in <code>engine/engine.mjs</code>. Predictions are written by <code>engine/writer.mjs</code> and every tip is
    checked against the output rules before it is shown.</p>

    <h2>Sources</h2>
    <table><thead><tr><th>Source</th><th>What it provides</th><th>Link</th></tr></thead><tbody>
      <tr><td>OLBG tennis tips index</td><td>fixtures, kickoff times, market names, tipster consensus</td>
        <td><a href="${src.url}" target="_blank" rel="noopener noreferrer">${src.url} ↗</a></td></tr>
      <tr><td>OLBG event pages</td><td>full per-match market list including Games Won handicap selections</td>
        <td><a href="https://www.olbg.com/betting-tips/Tennis/All_Tennis/All_Events/3" target="_blank" rel="noopener noreferrer">all events ↗</a></td></tr>
      <tr><td>ATP Tour (official)</td><td>schedule and rankings, men's</td>
        <td><a href="https://www.atptour.com/" target="_blank" rel="noopener noreferrer">atptour.com ↗</a></td></tr>
      <tr><td>WTA Tennis (official)</td><td>schedule and rankings, women's</td>
        <td><a href="https://www.wtatennis.com/" target="_blank" rel="noopener noreferrer">wtatennis.com ↗</a></td></tr>
    </tbody></table>

    <h2>Anti-hallucination rules this site follows</h2>
    <ul class="tight">
      <li>A factor with no source is never estimated. It is recorded as missing and the score is reduced.</li>
      <li>Scores are capped and every point is traceable to a named rule and the value that triggered it.</li>
      <li>Tips containing numerals are withheld, so odds, lines and set scores cannot leak into output.</li>
      <li>Unscoreable matches are shown as unscored rather than given a plausible-looking guess.</li>
      <li>Anything that cannot be verified from this environment is marked unverified in <code>docs/SOURCES.md</code>.</li>
    </ul>

    <h2>Model ruleset</h2>
    <p class="lede">Implements the master prompt ${PROMPT_VERSION}, plus patches recorded in <code>engine/engine.mjs</code>:
    ${Object.keys(PATCHES).map((k) => `<code>${k}</code>${PATCHES[k] ? ' ✓' : ' ✗'}`).join(', ')}.</p>

    <h2>Reproduce</h2>
    <pre>npm test                 # engine + writer tests (the same modules the browser runs)
python3 scripts/collect_olbg.py   # refresh data/slate.json
python3 scripts/collect_players.py # refresh data/players.json
node scripts/backtest.mjs          # grade stored predictions</pre>
  `;
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function copy(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied to clipboard'),
    () => toast('Copy blocked by the browser'),
  );
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function switchTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

/* ------------------------------------------------------------------ *
 * Wire up
 * ------------------------------------------------------------------ */

$$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$$('#phase-filter button').forEach((b) => b.addEventListener('click', () => {
  $$('#phase-filter button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  state.phase = b.dataset.phase;
  renderScoreboard();
}));
$('#search').addEventListener('input', (e) => { state.search = e.target.value; renderScoreboard(); });
$('#cal-prev').addEventListener('click', () => { state.calMonth.setMonth(state.calMonth.getMonth() - 1); renderCalendar(); });
$('#cal-next').addEventListener('click', () => { state.calMonth.setMonth(state.calMonth.getMonth() + 1); renderCalendar(); });
$('#generate-all').addEventListener('click', generateAll);
$('#generate-card').addEventListener('click', generateAll);
$('#copy-all').addEventListener('click', () => {
  copy(state.tips.filter((t) => t.ok).map((t) => t.text.replace(/\*\*/g, '')).join('\n\n'));
});
$('#copy-card').addEventListener('click', () => {
  const parts = state.tips.filter((t) => t.ok).map((t) => `${t.marketLabel}: ${t.text.replace(/\*\*/g, '')}`);
  const skipped = state.lastCard?.results
    .filter((r) => r.result.markets.games_handicap?.band === 'SKIP')
    .map((r) => `${r.match.home} v ${r.match.away} — games handicap skipped, insufficient dominance evidence`);
  const footer = '\n\nResponsible gambling: this is not betting advice. 18+.';
  copy([...parts, ...(skipped.length ? ['', 'Handicap skips:', ...skipped] : []), footer].join('\n'));
});

boot();
