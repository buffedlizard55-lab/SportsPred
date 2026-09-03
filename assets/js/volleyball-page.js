/** FIVB Volleyball Nations League — Women page controller.
 *
 * The scoreboard separates official VNL rows from OLBG's open volleyball
 * market listing. This prevents a club / continental event from inheriting
 * VNL form, standings, roster or prediction text.
 */

import { getSport } from '../../engine/registry.js';
import { buildVolleyballCardForDate, enrichVolleyballMatch } from '../../engine/volleyball_data.js';
import { scoreVolleyballCard } from '../../engine/volleyball_engine.js';
import { writeVolleyballCard, buildVolleyballFormattedCardText } from '../../engine/volleyball_writer.js';
import { loadStatic, addDays, clearCache, cacheStats } from './data-client.js';
import { $, $$, esc, todayISO, fmtDateLong, renderShell, renderFooter, toast, copyText, qs, setQS } from './ui.js';

const OFFICIAL_SCHEDULE = 'https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/schedule/';
const OFFICIAL_STANDINGS = 'https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/standings/women/';
const FIVB_SCHEDULE_ANNOUNCEMENT = 'https://www.fivb.com/volleyball-world-reveals-2026-vnl-match-schedule/';
const OLBG = 'https://www.olbg.com/betting-tips/Volleyball/21';

const state = {
  date: qs('date', todayISO()),
  scope: 'all',
  search: '',
  month: null,
  vnl: { events: [], results: [], standings: [], sources: [] },
  slate: { events: [] },
  provenance: { irregularities: [] },
  scored: [],
  written: null,
  loadedAt: null,
};

function isoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function eventDate(event) { return event.dateISO || event.date || (event.startUtc ? isoDate(event.startUtc) : null); }
function isVnl(event) { return event?.family === 'vnl-women' || event?.competition?.family === 'vnl-women'; }
function isUpcoming(event) { return event?.phase === 'upcoming' || event?.status === 'upcoming' || event?.status === 'scheduled'; }
function phaseLabel(event) { return event?.phase === 'results' ? 'FINAL' : event?.phase === 'live' ? 'LIVE' : 'UPCOMING'; }

async function boot() {
  state.month = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'volleyball', activePage: 'volleyball.html' });
  renderFooter();
  wire();
  await reload();
}

async function reload() {
  $('#board').innerHTML = '<div class="empty"><span class="spin"></span> Loading verified volleyball data…</div>';
  const [vnl, slate, provenance] = await Promise.all([
    loadStatic('data/volleyball_vnl.json'),
    loadStatic('data/volleyball_slate.json'),
    loadStatic('data/volleyball_provenance.json'),
  ]);
  state.vnl = vnl.data || { events: [], results: [], standings: [], sources: [] };
  state.slate = slate.data || { events: [] };
  state.provenance = provenance.data || { irregularities: [] };
  state.loadedAt = Date.now();
  setDate(state.date, { generate: false });
  renderLinks();
  renderSeasonStatus();
  renderOlbg();
  renderCoverage();
}

function renderLinks() {
  $('#sport-links').innerHTML = [
    `<a href="${OFFICIAL_SCHEDULE}" target="_blank" rel="noopener noreferrer">Official VNL schedule & results ↗</a>`,
    `<a href="${OFFICIAL_STANDINGS}" target="_blank" rel="noopener noreferrer">Official women’s standings ↗</a>`,
    `<a href="${OLBG}" target="_blank" rel="noopener noreferrer">OLBG volleyball index ↗</a>`,
  ].join(' · ');
  $('#scope-note').innerHTML = '<div class="note info"><strong>Scope guard:</strong> the prediction model is limited to FIVB Volleyball Nations League — Women. An OLBG event is not assumed to be VNL merely because it is volleyball; it is rendered as a separate market-monitor row until an official VNL identifier confirms it.</div>';
}

function allVnlRows() {
  return [...(state.vnl.results || []), ...(state.vnl.events || [])].filter(isVnl);
}

function rowsForDate() {
  const query = state.search.trim().toLowerCase();
  const vnl = allVnlRows().filter((event) => eventDate(event) === state.date);
  const olbg = (state.slate.events || []).filter((event) => event.resolved_date === state.date);
  const filter = (row) => !query || `${row.home || ''} ${row.away || ''} ${row.venue || ''} ${row.round || ''}`.toLowerCase().includes(query);
  return { vnl: vnl.filter(filter), olbg: olbg.filter(filter) };
}

function calendarCounts() {
  const counts = new Map();
  for (const event of allVnlRows()) {
    const date = eventDate(event);
    if (!date) continue;
    const value = counts.get(date) || { vnl: 0, olbg: 0 };
    value.vnl += 1;
    counts.set(date, value);
  }
  for (const event of state.slate.events || []) {
    if (!event.resolved_date) continue;
    const value = counts.get(event.resolved_date) || { vnl: 0, olbg: 0 };
    value.olbg += 1;
    counts.set(event.resolved_date, value);
  }
  return counts;
}

function setDate(date, { generate = false } = {}) {
  state.date = date;
  setQS({ date });
  $('#date-input').value = date;
  $('#day-title').textContent = fmtDateLong(date);
  renderDateStrip();
  renderBoard();
  renderCalendar();
  if (generate) generateCard();
}

function renderDateStrip() {
  const counts = calendarCounts();
  const dates = Array.from({ length: 11 }, (_, index) => addDays(state.date, index - 3));
  $('#datestrip').innerHTML = dates.map((date) => {
    const d = new Date(`${date}T12:00:00Z`);
    const count = counts.get(date);
    const dot = count?.vnl ? ' <span class="dot" title="Official VNL row"></span>' : count?.olbg ? ' <span class="dot olbg-dot" title="OLBG market row"></span>' : '';
    return `<button class="day ${date === state.date ? 'on' : ''}" data-date="${date}"><span class="dow">${d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span><span class="dnum">${d.getUTCDate()}</span>${dot}</button>`;
  }).join('');
  $$('#datestrip [data-date]').forEach((button) => button.addEventListener('click', () => setDate(button.dataset.date)));
}

function matchRow(event, result) {
  const source = event.source_url || OFFICIAL_SCHEDULE;
  const selection = result?.markets?.win_match?.selection || 'SKIP';
  const confidence = result?.markets?.win_match?.band || '—';
  const setScore = result?.markets?.set_score?.selection || 'SKIP';
  return `<article class="match">
    <div class="match-main">
      <div class="match-when"><div class="t">${esc(event.startUtc ? new Date(event.startUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—')}</div><div class="s ${event.phase === 'live' ? 'live' : event.phase === 'results' ? 'ft' : ''}">${esc(phaseLabel(event))}</div></div>
      <div class="match-teams"><div><strong>${esc(event.home || 'Home')}</strong></div><div><strong>${esc(event.away || 'Away')}</strong></div><div class="meta-line">${esc(event.round || 'VNL Women')} · ${esc(event.venue || 'Venue not supplied')}</div></div>
      <div class="match-right"><span class="badge ${esc(confidence)}">${esc(selection)}</span><span class="meta-line">${esc(setScore)}</span></div>
      <a class="btn sm" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Source ↗</a>
    </div>
    ${result ? `<div class="detail open"><div class="detail-grid"><div><strong>Prediction audit</strong><p class="meta-line">${esc(result.flags?.length ? result.flags.join(' · ') : 'Source-gated VNL evaluation.')}</p><ul class="miss">${(result.missing || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div><div>${tipHtml(event, result)}</div></div></div>` : ''}
  </article>`;
}

function tipHtml(event, result) {
  const tips = (state.written?.tips || []).filter((tip) => String(tip.event_id) === String(result.event_id || event.id));
  if (!tips.length) return '<p class="meta-line">Choose Generate VNL card to produce source-gated output.</p>';
  return tips.map((tip) => `<div class="tipbox"><div class="tip-meta"><span class="badge ${esc(tip.band)}">${esc(tip.marketLabel)} · ${esc(tip.band)}</span>${!tip.skip ? `<button class="btn sm" data-copy-tip="${esc(String(tip.event_id))}" data-market="${esc(tip.market)}">Copy tip</button>` : ''}</div><div class="tip-text">${esc(tip.text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</div></div>`).join('');
}

function olbgRow(event) {
  const markets = event.markets_verified ? (event.markets_available || []).join(' · ') || 'No recognized market heading' : 'Market page not verified';
  return `<article class="match olbg-monitor"><div class="match-main">
    <div class="match-when"><div class="t">${esc(event.display_time || '—')}</div><div class="s">OLBG</div></div>
    <div class="match-teams"><div><strong>${esc(event.home)}</strong></div><div><strong>${esc(event.away)}</strong></div><div class="meta-line">${esc(markets)} · ${event.markets_verified ? 'event page checked' : 'check required'}</div></div>
    <div class="match-right"><span class="badge SKIP">OUT OF VNL SCOPE</span></div>
    <a class="btn sm" href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">Review ↗</a>
  </div></article>`;
}

function renderBoard() {
  const { vnl, olbg } = rowsForDate();
  const scored = new Map((state.scored || []).map((row) => [String(row.result.event_id || row.match.id), row.result]));
  const showVnl = state.scope !== 'olbg';
  const showOlbg = state.scope !== 'vnl';
  const chunks = [];
  if (showVnl) {
    chunks.push(`<section class="league-group"><div class="league-head"><span>FIVB Volleyball Nations League — Women</span><span class="count">${vnl.length}</span></div>${vnl.length ? vnl.map((event) => matchRow(event, scored.get(String(event.event_id || event.id)))).join('') : '<div class="empty">No official VNL Women fixture is recorded for this date. The monitor does not invent a fixture from unrelated volleyball listings.</div>'}</section>`);
  }
  if (showOlbg) {
    chunks.push(`<section class="league-group"><div class="league-head"><span>OLBG Volleyball market monitor</span><span class="count">${olbg.length}</span></div>${olbg.length ? olbg.map(olbgRow).join('') : '<div class="empty">No OLBG snapshot event is assigned to this display date.</div>'}</section>`);
  }
  $('#board').innerHTML = chunks.join('');
  $('#counts').textContent = `${vnl.length} official VNL · ${olbg.length} OLBG monitor`;
  $$('[data-copy-tip]').forEach((button) => button.addEventListener('click', async () => {
    const tip = (state.written?.tips || []).find((item) => String(item.event_id) === button.dataset.copyTip && item.market === button.dataset.market);
    const ok = tip && await copyText(tip.text.replace(/\*\*/g, ''));
    toast(ok ? 'Tip copied' : 'Copy failed');
  }));
}

function renderCalendar() {
  const month = new Date(Date.UTC(state.month.getUTCFullYear(), state.month.getUTCMonth(), 1));
  $('#cal-title').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const start = (month.getUTCDay() + 6) % 7;
  const counts = calendarCounts();
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(month);
    date.setUTCDate(1 - start + i);
    const iso = date.toISOString().slice(0, 10);
    const count = counts.get(iso) || { vnl: 0, olbg: 0 };
    const label = [count.vnl ? `${count.vnl} VNL` : '', count.olbg ? `${count.olbg} OLBG` : ''].filter(Boolean).join(' · ');
    cells.push(`<button class="cell ${date.getUTCMonth() !== month.getUTCMonth() ? 'other' : ''} ${iso === state.date ? 'on' : ''}" data-calendar-date="${iso}" title="${esc(label || 'No rows')}"><span class="n">${date.getUTCDate()}</span><span class="c">${esc(label)}</span></button>`);
  }
  $('#calgrid').innerHTML = cells.join('');
  $$('[data-calendar-date]').forEach((button) => button.addEventListener('click', () => setDate(button.dataset.calendarDate)));
}

function renderSeasonStatus() {
  const status = state.vnl.season_status || {};
  const source = status.source_url || FIVB_SCHEDULE_ANNOUNCEMENT;
  const text = status.message || 'No official season-status message has been committed.';
  $('#vnl-status').innerHTML = `<p style="margin-top:0">${esc(text)}</p><p><a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Review official season information ↗</a></p>`;
}

function renderOlbg() {
  const events = state.slate.events || [];
  if (!events.length) {
    $('#olbg-box').innerHTML = `<p>No OLBG event is in the committed snapshot.</p><p><a href="${OLBG}" target="_blank" rel="noopener noreferrer">Open OLBG directly ↗</a></p>`;
    return;
  }
  $('#olbg-box').innerHTML = events.map((event) => {
    const markets = event.markets_verified ? (event.markets_available || []).join(', ') || 'No recognized market heading' : 'not verified';
    return `<div class="olbg-row"><a href="${esc(event.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(event.home)} v ${esc(event.away)}</strong></a><div>${esc(event.resolved_date || 'date unknown')} ${esc(event.display_time || '')}</div><div>${esc(markets)}</div><div>Tip vote: ${esc(event.consensus?.selection || '—')} (display only)</div></div>`;
  }).join('') + `<p style="margin-bottom:0"><a href="${OLBG}" target="_blank" rel="noopener noreferrer">All open OLBG volleyball events ↗</a></p>`;
}

function renderCoverage() {
  const issueCount = (state.provenance.irregularities || []).filter((issue) => issue.status !== 'resolved').length;
  const stat = cacheStats();
  $('#coverage').innerHTML = `<ul style="margin:0;padding-left:16px"><li>${allVnlRows().length} official VNL row(s)</li><li>${(state.slate.events || []).length} OLBG monitor event(s)</li><li>${issueCount} open verification issue(s)</li><li>cache: ${stat.entries} entries / ${stat.kb} KB</li></ul><p style="margin-bottom:0"><a href="sources.html#volleyball">Sources and irregularities →</a></p>`;
}

function generateCard() {
  const candidates = allVnlRows().filter((event) => eventDate(event) === state.date && isUpcoming(event));
  const tape = state.vnl.results || [];
  const matches = candidates.map((event) => enrichVolleyballMatch(event, tape, state.vnl));
  const scored = scoreVolleyballCard(matches);
  state.scored = scored.results;
  state.written = writeVolleyballCard(scored.results);
  const formatted = buildVolleyballFormattedCardText(scored.results, state.date);
  $('#card-text').innerHTML = `<pre class="copy-card">${esc(formatted)}</pre>`;
  const published = state.written.tips.filter((tip) => tip.ok && !tip.skip).length;
  const withheld = state.written.tips.filter((tip) => tip.skip).length;
  $('#card-status').textContent = `${candidates.length} fixture(s) · ${published} selections · ${withheld} skips`;
  renderBoard();
  toast(`${published} selection(s) from ${candidates.length} official VNL fixture(s)`);
}

function wire() {
  $('#prev-day').addEventListener('click', () => setDate(addDays(state.date, -1)));
  $('#next-day').addEventListener('click', () => setDate(addDays(state.date, 1)));
  $('#today-btn').addEventListener('click', () => setDate(todayISO()));
  $('#date-input').addEventListener('change', (event) => event.target.value && setDate(event.target.value));
  $('#cal-prev').addEventListener('click', () => { state.month = new Date(Date.UTC(state.month.getUTCFullYear(), state.month.getUTCMonth() - 1, 1)); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { state.month = new Date(Date.UTC(state.month.getUTCFullYear(), state.month.getUTCMonth() + 1, 1)); renderCalendar(); });
  $$('#scope-filter button').forEach((button) => button.addEventListener('click', () => {
    state.scope = button.dataset.scope;
    $$('#scope-filter button').forEach((item) => item.classList.toggle('on', item === button));
    renderBoard();
  }));
  let timer;
  $('#search').addEventListener('input', (event) => { clearTimeout(timer); timer = setTimeout(() => { state.search = event.target.value; renderBoard(); }, 100); });
  $('#generate').addEventListener('click', () => { const button = $('#generate'); button.disabled = true; button.textContent = 'Generating…'; requestAnimationFrame(() => { try { generateCard(); } finally { button.disabled = false; button.textContent = '⚡ Generate VNL card'; } }); });
  $('#copy-all').addEventListener('click', async () => {
    const text = buildVolleyballFormattedCardText(state.scored || [], state.date);
    const ok = await copyText(text);
    toast(ok ? 'VNL card copied' : 'Copy failed');
  });
  $('#refresh').addEventListener('click', async () => { clearCache(); await reload(); toast('Reloaded committed data'); });
}

boot().catch((error) => {
  console.error(error);
  $('#board').innerHTML = `<div class="note bad">The VNL Women page could not start: ${esc(error.message)}.</div>`;
});
