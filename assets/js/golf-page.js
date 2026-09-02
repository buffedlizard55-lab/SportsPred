/**
 * SportsPred — golf page controller (golf.html).
 *
 * Golf is an outright sport: one event, a field of up to 156 players, six
 * markets. The generic two-competitor sport page does not apply, so this
 * controller:
 *   1. loads the committed golf documents (results tape, rankings, statistics,
 *      weather, OLBG slate) — built in CI and the source of every score,
 *   2. refreshes the calendar and the leaderboards for the chosen date live
 *      from ESPN (key-less, CORS-enabled), falling back to the committed
 *      events when the browser cannot reach ESPN,
 *   3. scores and writes the six-market card for EVERY predictable event on
 *      the board automatically, and again on the Generate button,
 *   4. renders leaderboards, the calendar, copy-ready cards and the analysis
 *      panel (rules fired, points, missing factors, source links).
 */

import { getSport } from '../../engine/registry.js';
import { buildResultsIndex, selectGolfEvents } from '../../engine/golf_data.js';
import { buildGolfEventCard, owgrLookup, statsLookup, sgLookup } from '../../engine/golf_card.js';
import { GOLF_TOURS } from '../../engine/golf_espn.js';
import { MARKETS, MARKET_ORDER } from '../../engine/golf_engine.js';
import { loadStatic, addDays, cacheStats, clearCache, TTL } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtTime, fmtDateLong, relTime, renderShell, renderFooter, toast, copyText, confBar, qs, setQS,
} from './ui.js';
import { collectGolfDay, PREDICTABLE_TOURS, SHOW_TOURS } from './golf-collector.js';

const state = {
  sport: null,
  date: todayISO(),
  tour: 'all',
  search: '',
  docs: null,          // committed documents
  shared: null,        // prebuilt indexes
  calendars: {},       // tour -> {season, events[], url}
  events: [],          // events on the board (live-refreshed or committed)
  cards: new Map(),    // eventId -> card
  backtest: null,      // data/golf_backtest.json (walk-forward ledger summary)
  calMonth: null,
  loadedAt: null,
  errors: [],
  liveOk: false,
};

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */

async function boot() {
  state.sport = getSport('golf');
  state.date = qs('date', todayISO());
  state.tour = qs('tour', 'all');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'golf', activePage: 'golf.html' });
  renderFooter();
  renderStatic();
  wireControls();

  await loadDocs();
  renderOlbg();
  await loadDate(state.date);
}

function renderStatic() {
  const s = state.sport;
  $('#sport-links').innerHTML = (s?.officialLinks || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join(' · ');
  $('#tour-filter').value = state.tour;
}

async function loadDocs() {
  setProgress(5, 'Loading committed golf data…');
  const [events, results, rankings, stats, weather, slate, backtest] = await Promise.all([
    loadStatic('data/golf_events.json'),
    loadStatic('data/golf_results.json'),
    loadStatic('data/golf_rankings.json'),
    loadStatic('data/golf_stats.json'),
    loadStatic('data/golf_weather.json', TTL.REGISTRY),
    loadStatic('data/golf_slate.json'),
    loadStatic('data/golf_backtest.json'),
  ]);
  state.docs = {
    eventsDoc: events.data || { events: [], calendars: {} },
    resultsDoc: results.data || { players: {}, events: {} },
    rankingsDoc: rankings.data || null,
    statsDoc: stats.data || null,
    weatherDoc: weather.data || null,
    slateDoc: slate.data || null,
  };
  state.backtest = backtest.data || null;
  state.shared = {
    index: buildResultsIndex(state.docs.resultsDoc),
    owgr: owgrLookup(state.docs.rankingsDoc),
    stats: statsLookup(state.docs.statsDoc),
    sg: sgLookup(state.docs.statsDoc),
  };
  state.calendars = { ...(state.docs.eventsDoc.calendars || {}) };
  const notes = [];
  if (!results.data) notes.push('The committed results tape (<code>data/golf_results.json</code>) is not present yet, so every history-based factor is recorded as missing until the golf collector runs in CI.');
  if (!rankings.data) notes.push('The Official World Golf Ranking snapshot is not present yet; ranking factors are recorded as missing.');
  $('#sport-notes').innerHTML = notes.map((n) => `<div class="note">${n}</div>`).join('');
}

/* ------------------------------------------------------------------ *
 * loading a date
 * ------------------------------------------------------------------ */

function toursSelected() {
  return state.tour === 'all' ? SHOW_TOURS : [state.tour];
}

async function loadDate(dateISO) {
  state.date = dateISO;
  state.errors = [];
  state.cards.clear();
  setQS({ date: dateISO, tour: state.tour === 'all' ? null : state.tour });
  $('#date-input').value = dateISO;
  $('#day-title').textContent = `Week of ${fmtDateLong(dateISO)}`;
  renderDateStrip();
  renderCalendar();

  setProgress(15, 'Refreshing leaderboards from ESPN…');
  const live = await collectGolfDay(dateISO, { tours: toursSelected() });
  state.errors = live.errors || [];
  state.liveOk = Object.keys(live.calendars || {}).length > 0;
  for (const [tour, cal] of Object.entries(live.calendars || {})) state.calendars[tour] = cal;

  // Merge: live events win; committed events fill the gaps.
  const committed = selectGolfEvents(state.docs.eventsDoc.events || [], dateISO, { tours: toursSelected() });
  const byId = new Map();
  for (const ev of committed) byId.set(String(ev.id), ev);
  for (const ev of live.events || []) byId.set(String(ev.id), { ...ev, live: true });
  state.events = [...byId.values()].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  state.loadedAt = Date.now();

  setProgress(70, 'Generating predictions…');
  generateAll();
  setProgress(100, '');
  renderBoard();
  renderRail();
  renderCoverage();
  renderMeta();
  renderCalendar();
  renderSeasonList();
}

/* ------------------------------------------------------------------ *
 * prediction generation — automatic, and on the button
 * ------------------------------------------------------------------ */

export function generateAll({ force = false } = {}) {
  let made = 0;
  const docs = { ...state.docs, ...state.shared, eventsDoc: { events: state.events } };
  for (const ev of state.events) {
    if (ev.showOnly || !PREDICTABLE_TOURS.includes(ev.tour)) continue;
    if (!force && state.cards.has(ev.id)) continue;
    try {
      const card = buildGolfEventCard(docs, ev.id);
      if (card) { state.cards.set(ev.id, card); made += 1; }
    } catch (err) {
      console.error(`golf card ${ev.id} failed`, err);
      state.errors.push({ event: ev.id, error: err.message });
    }
  }
  return made;
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function visibleEvents() {
  const q = state.search.trim().toLowerCase();
  return state.events.filter((ev) => {
    if (state.tour !== 'all' && ev.tour !== state.tour) return false;
    if (q) {
      const hay = `${ev.name} ${ev.course?.name || ''} ${(ev.field || []).map((p) => `${p.name} ${p.country || ''}`).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function stateLabel(ev) {
  if (ev.state === 'in') return `<span class="s live">LIVE · R${ev.currentRound || ''}</span>`;
  if (ev.state === 'post') return '<span class="s ft">FINAL</span>';
  return `<span class="s">${esc(ev.statusDetail || 'Scheduled')}</span>`;
}

function fmtRange(ev) {
  const s = String(ev.startDate || '').slice(0, 10);
  const e = String(ev.endDate || '').slice(0, 10);
  return s && e && s !== e ? `${s} → ${e}` : s;
}

function renderBoard() {
  const list = visibleEvents();
  const board = $('#board');
  const live = state.events.filter((e) => e.state === 'in').length;
  const done = state.events.filter((e) => e.state === 'post').length;
  $('#counts').textContent = `${state.events.length} tournaments · ${live} in play · ${done} final · ${state.cards.size} scored`;
  if (!list.length) {
    board.innerHTML = `<div class="empty">No tournaments on the selected tours for the week of ${esc(state.date)}.
      ${state.errors.length ? `The live feed reported ${state.errors.length} error(s); the committed snapshot had nothing for this week either.` : 'Try another week on the calendar.'}</div>`;
    return;
  }
  board.innerHTML = list.map(eventBlock).join('');
  $$('#board [data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const d = $(`#detail-${CSS.escape(b.dataset.toggle)}`);
    if (!d) return;
    const open = d.classList.toggle('open');
    b.textContent = open ? 'Hide analysis' : 'Analysis';
    if (open && !d.dataset.filled) { d.innerHTML = detailHtml(b.dataset.toggle); d.dataset.filled = '1'; wireDetail(d); }
  }));
  $$('#board [data-expand]').forEach((b) => b.addEventListener('click', () => {
    const t = $(`#lb-${CSS.escape(b.dataset.expand)}`);
    if (!t) return;
    const full = t.classList.toggle('full');
    $$('tr.more', t).forEach((r) => { r.style.display = full ? '' : 'none'; });
    b.textContent = full ? 'Show fewer' : 'Show full field';
  }));
  $$('#board [data-copycard]').forEach((b) => b.addEventListener('click', async () => {
    const card = state.cards.get(b.dataset.copycard);
    if (!card?.written) { toast('No card written for this event'); return; }
    const ok = await copyText(card.written.cardText.replace(/\*\*/g, ''));
    toast(ok ? 'Card copied to clipboard' : 'Copy failed — select the text manually');
  }));
}

function eventBlock(ev) {
  const card = state.cards.get(ev.id);
  const tourName = GOLF_TOURS[ev.tour]?.name || ev.tourName || ev.tour;
  const heads = card ? MARKET_ORDER.map((k) => {
    const m = card.scored.markets[k];
    const s = m?.selections?.[0];
    return s ? { label: MARKETS[k], name: s.name, band: s.band, score: s.score, value: s.valuePick } : { label: MARKETS[k], name: null };
  }) : [];
  const pills = heads.filter((h) => h.name).slice(0, 3).map((h) => `
    <span class="pred-pill ${esc(h.band)}" title="${esc(h.label)}">
      <span class="badge ${esc(h.band)}">${esc(h.band)}</span>
      <span class="sel">${esc(h.name)}</span>${confBar(Math.min(100, h.score), h.band)}
    </span>`).join('');
  const status = card?.scored?.unscored
    ? `<span class="pred-pill SKIP"><span class="badge SKIP">UNSCORED</span><span class="sel">${esc(card.scored.flags?.[0] || 'field not published')}</span></span>`
    : ev.showOnly ? '<span class="pred-pill SKIP"><span class="badge ghost">leaderboard only</span></span>' : (pills || '<span class="pred-pill SKIP"><span class="badge SKIP">NO SELECTION</span></span>');

  return `
  <div class="lg-head">
    <span>${esc(tourName)}</span>
    <span class="count">${ev.fieldSize || (ev.field || []).length} players</span>
    ${ev.major ? '<span class="badge ghost">MAJOR</span>' : ''}${ev.isSignature ? '<span class="badge ghost">SIGNATURE</span>' : ''}
    ${ev.nextForTour ? '<span class="badge ghost">next on tour</span>' : ''}
    <a href="${esc(ev.sources?.espnLeaderboard || `https://www.espn.com/golf/leaderboard?tournamentId=${ev.id}`)}" target="_blank" rel="noopener noreferrer">ESPN leaderboard ↗</a>
  </div>
  <div class="match" data-id="${esc(ev.id)}">
    <div class="match-main" style="grid-template-columns:110px 1fr auto">
      <div class="match-when"><div class="t">${esc(fmtRange(ev))}</div>${stateLabel(ev)}</div>
      <div class="teams">
        <div class="trow"><span class="nm" style="font-size:15px">${esc(ev.name)}</span></div>
        <div class="meta-line">${esc(ev.course?.name || 'Course not published')}${ev.course?.city ? ` · ${esc(ev.course.city)}${ev.course.country ? `, ${esc(ev.course.country)}` : ''}` : ''}
          ${ev.course?.yards ? ` · ${ev.course.yards} yds, par ${ev.course.par}` : ''}${ev.purse ? ` · purse $${Number(ev.purse).toLocaleString()}` : ''}
          ${ev.defendingChampion?.name ? ` · defending: ${esc(ev.defendingChampion.name)}` : ''}${ev.live ? ' · <span title="Refreshed live from ESPN">live</span>' : ev.stale ? ' · <span title="Committed snapshot; live refresh failed">snapshot</span>' : ''}</div>
      </div>
      <div class="match-right" style="flex-wrap:wrap;justify-content:flex-end">
        ${status}
        ${card?.written ? `<button class="btn sm" data-copycard="${esc(ev.id)}">Copy card</button>` : ''}
        <button class="btn sm" data-toggle="${esc(ev.id)}">Analysis</button>
      </div>
    </div>
    ${leaderboardHtml(ev)}
    <div class="detail" id="detail-${esc(ev.id)}"></div>
  </div>`;
}

function leaderboardHtml(ev) {
  const field = [...(ev.field || [])];
  if (!field.length) return '<div class="card-body meta-line">Field not published yet.</div>';
  const pre = ev.state === 'pre' || ev.state === null;
  if (pre) {
    field.sort((a, b) => String(a.teeTime || 'z').localeCompare(String(b.teeTime || 'z')) || String(a.name).localeCompare(String(b.name)));
  } else {
    const key = (p) => (p.position ?? (p.result === 'active' ? 500 : 900));
    field.sort((a, b) => key(a) - key(b) || (a.toPar ?? 99) - (b.toPar ?? 99));
  }
  const SHOW = 12;
  const card = state.cards.get(ev.id);
  const picked = new Set();
  if (card) for (const k of MARKET_ORDER) for (const s of card.scored.markets[k]?.selections || []) picked.add(s.athleteId);
  const rows = field.map((p, i) => {
    const r = (n) => p.rounds?.find((x) => x.period === n)?.strokes ?? '';
    const pos = pre ? '' : (p.positionText || (p.result === 'CUT' ? 'MC' : p.result === 'WD' ? 'WD' : p.result === 'DQ' ? 'DQ' : '—'));
    return `<tr class="${i >= SHOW ? 'more' : ''}" style="${i >= SHOW ? 'display:none' : ''}">
      <td class="num">${esc(pos)}</td>
      <td>${p.flag ? `<img src="${esc(p.flag)}" alt="" width="16" height="16" style="vertical-align:-3px;margin-right:6px" loading="lazy">` : ''}
        <a href="${esc(p.playerUrl || `https://www.espn.com/golf/player/_/id/${p.athleteId}`)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>${p.amateur ? ' <span class="badge ghost">AM</span>' : ''}
        ${picked.has(p.athleteId) ? ' <span class="badge HIGH" title="Selected in at least one market">PICK</span>' : ''}</td>
      <td class="meta-line">${esc(p.country || '')}</td>
      <td class="num">${pre ? esc(p.teeTime ? fmtTime(p.teeTime) : '') : (p.toPar === null || p.toPar === undefined ? '' : p.toPar === 0 ? 'E' : p.toPar > 0 ? `+${p.toPar}` : p.toPar)}</td>
      <td class="num">${pre ? '' : (p.thru ? (p.thru >= 18 ? 'F' : p.thru) : '')}</td>
      <td class="num">${r(1)}</td><td class="num">${r(2)}</td><td class="num">${r(3)}</td><td class="num">${r(4)}</td>
    </tr>`;
  }).join('');
  return `
  <div class="card-body tight">
    <table class="data" id="lb-${esc(ev.id)}">
      <thead><tr><th class="num">${pre ? '' : 'Pos'}</th><th>Player</th><th>Country</th><th class="num">${pre ? 'Tee (R1)' : 'To par'}</th><th class="num">${pre ? '' : 'Thru'}</th><th class="num">R1</th><th class="num">R2</th><th class="num">R3</th><th class="num">R4</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${field.length > SHOW ? `<div class="card-body" style="padding:8px 14px"><button class="btn sm" data-expand="${esc(ev.id)}">Show full field</button> <span class="meta-line" style="display:inline">${field.length} players${ev.cut?.count ? ` · cut ${ev.cut.count} at ${ev.cut.score > 0 ? `+${ev.cut.score}` : ev.cut.score === 0 ? 'E' : ev.cut.score}` : ''}</span></div>` : ''}
  </div>`;
}

function componentRows(cand) {
  return (cand.components || []).map((c) => `
    <tr><th>${esc(c.label)}<div class="meta-line"><code>${esc(c.id)}</code>${c.missing ? ' <span class="badge SKIP">missing</span>' : ''}</div><div class="meta-line">${esc(c.detail || '')}</div></th>
      <td class="num">${c.points === 0 ? '—' : (c.points > 0 ? '+' : '') + c.points}${c.max ? `<span class="meta-line" style="display:inline"> / ${c.max}</span>` : ''}</td></tr>`).join('');
}

function detailHtml(eventId) {
  const ev = state.events.find((x) => x.id === eventId);
  const card = state.cards.get(eventId);
  if (!ev) return '<div class="meta-line">Unknown event.</div>';
  if (ev.showOnly) return `<div class="meta-line" style="padding:12px 0">This tour is shown for its leaderboard and calendar only. The master prompt's ranking and regional rules apply to the men's world-ranked tours, so no tip is written here (IR-GOLF-08).</div>`;
  if (!card) return '<div class="meta-line" style="padding:12px 0">No card was built for this event.</div>';
  if (card.scored.unscored) return `<div class="meta-line" style="padding:12px 0">${esc(card.scored.flags.join('; '))}. Missing: ${esc(card.scored.missing.join('; '))}</div>`;

  const marketTables = MARKET_ORDER.map((k) => {
    const m = card.scored.markets[k];
    const sel = m?.selections || [];
    const others = (m?.candidates || []).filter((c) => !sel.some((s) => s.athleteId === c.athleteId)).slice(0, 6);
    return `
      <details ${k === 'outright' ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:700;font-size:13px;padding:6px 0">${esc(m?.label || k)} — ${sel.length ? sel.map((s) => `${esc(s.name)} <span class="badge ${esc(s.band)}">${esc(s.band)}</span> ${s.score}${s.valuePick ? ' <span class="badge ghost">VALUE</span>' : ''}${s.coSelection ? ' <span class="badge ghost">CO-SELECTION</span>' : ''}`).join(', ') : '<span class="badge SKIP">NO SELECTION</span>'}
          ${m?.threshold != null ? `<span class="meta-line" style="display:inline"> threshold ${m.threshold}</span>` : ''}</summary>
        ${m?.note ? `<p class="meta-line">${esc(m.note)}</p>` : ''}
        ${sel.map((s) => `
          <p class="meta-line" style="margin:8px 0 4px"><strong>${esc(s.name)}</strong> · field rank by OWGR ${s.fieldRank ?? 'n/a'} · <a href="${esc(s.profile?.sources?.espnPlayer || '#')}" target="_blank" rel="noopener noreferrer">ESPN player ↗</a>${s.profile?.sources?.owgr ? ` · <a href="${esc(s.profile.sources.owgr)}" target="_blank" rel="noopener noreferrer">OWGR ↗</a>` : ''}</p>
          <table class="kv"><tbody>${componentRows(s)}</tbody></table>
          ${s.missing?.length ? `<ul class="miss">${s.missing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`).join('')}
        ${others.length ? `<p class="meta-line" style="margin-top:8px">Next in the rankings: ${others.map((c) => `${esc(c.name)} ${c.score}${c.band && c.band !== 'SKIP' ? ` (${esc(c.band)})` : ''}`).join(' · ')}</p>` : ''}
      </details>`;
  }).join('');

  const v = card.validation;
  const g = card.grades;
  const gradeHtml = g ? `
        <div class="tip-meta" style="margin-top:8px">
          <span class="badge ghost">RETROSPECTIVE</span>
          <span class="meta-line">Scored from history that ended before round one, then graded against the final leaderboard: ${MARKET_ORDER.map((k) => `${esc(card.scored.markets[k]?.label || k)} <span class="badge ${g[k]?.status === 'HIT' ? 'HIGH' : g[k]?.status === 'MISS' ? 'SKIP' : 'ghost'}">${esc(g[k]?.status || 'n/a')}</span>`).join(' · ')}${g._top6List ? ` · top-six list ${g._top6List.hits}/${g._top6List.selections} placed` : ''}</span>
        </div>` : '';
  return `
  <div class="detail-grid">
    <div>
      <div class="tipbox">
        <div class="tip-meta">
          <span class="badge ${v?.ok ? 'HIGH' : 'SKIP'}">${v?.ok ? 'CARD VALIDATED' : 'CARD HAS ISSUES'}</span>
          <span class="meta-line">${card.written.tips.filter((t) => !t.skip).length} selections · ${card.written.tips.filter((t) => t.skip).length} markets skipped</span>
          <button class="btn sm" data-copycard="${esc(eventId)}">Copy card</button>
        </div>
        ${card.written.blocks.map((b) => `<p><strong>${esc(b.title)}</strong></p>${b.tips.map((t) => `<p>${t.valuePick ? '<span class="badge MEDIUM">VALUE PICK</span> ' : ''}${esc(t.text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`).join('')}`).join('')}
        <table class="kv" style="margin-top:10px"><thead><tr><th>Market</th><th>Selection</th><th class="num">Confidence</th></tr></thead>
          <tbody>${card.written.summary.map((r) => `<tr><th>${esc(r.market)}</th><td>${esc(r.selection)}${r.valuePick ? ' <span class="badge ghost">VALUE</span>' : ''}</td><td class="num"><span class="badge ${esc(r.band)}">${esc(r.band)}</span></td></tr>`).join('')}</tbody></table>
        <p class="meta-line" style="margin-top:8px">${esc(card.written.weatherNote)}</p>
        ${v && !v.ok ? `<p class="meta-line"><strong>Validator issues:</strong> ${esc(v.issues.map((i) => `${i.market || ''} ${i.player || ''}: ${i.violations.join('; ')}`).join(' | '))}</p>` : ''}
        ${gradeHtml}
      </div>
      ${card.scored.flags.length ? `<p class="meta-line" style="margin-top:10px"><strong>Flags for review</strong></p><ul class="miss">${card.scored.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <p class="meta-line" style="margin-top:10px"><strong>Not available for this event</strong></p>
      <ul class="miss">${card.scored.missing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="meta-line"><strong>Coverage:</strong> ${card.coverage.scored} scored · ${card.coverage.withHistory} with history · ${card.coverage.owgrMatched} ranked · ${card.coverage.sgMatched} with strokes gained · ${card.coverage.teeTimes} tee times · ${card.coverage.priorEditionsInTape} prior edition(s) in tape · weather ${card.coverage.weather ? `yes (round-one trend ${esc(card.coverage.r1Trend || 'n/a')})` : 'no'}</p>
      <ul class="srclist">${card.sources.map((s) => `<li>→ <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}</ul>
      ${card.olbg.length ? `<p class="meta-line"><strong>OLBG rows matched (display only):</strong> ${card.olbg.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.event_name)} · ${esc(r.consensus?.market || '')} · ${esc(r.consensus?.selection || '')}</a>`).join(' · ')}</p>` : ''}
    </div>
    <div>${marketTables}</div>
  </div>`;
}

function wireDetail(root) {
  $$('[data-copycard]', root).forEach((b) => b.addEventListener('click', async () => {
    const card = state.cards.get(b.dataset.copycard);
    if (!card?.written) return;
    const ok = await copyText(card.written.cardText.replace(/\*\*/g, ''));
    toast(ok ? 'Card copied to clipboard' : 'Copy failed — select the text manually');
  }));
}

function allSelections() {
  const out = [];
  for (const ev of visibleEvents()) {
    const card = state.cards.get(ev.id);
    if (!card?.written) continue;
    for (const t of card.written.tips) if (!t.skip) out.push({ ...t, event: ev.name, eventId: ev.id, tour: GOLF_TOURS[ev.tour]?.name || ev.tour });
  }
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  out.sort((a, b) => (order[a.band] ?? 3) - (order[b.band] ?? 3) || (b.score ?? 0) - (a.score ?? 0));
  return out;
}

function renderRail() {
  const sel = allSelections();
  $('#rail-preds').innerHTML = sel.length
    ? sel.slice(0, 10).map((t, i) => `
      <div class="rail-item">
        <span class="r-num">${i + 1}</span>
        <span class="r-body">
          <span class="r-sel">${esc(t.name)}</span>
          <span class="badge ${esc(t.band)}" style="margin-left:6px">${esc(t.band)}</span>${t.valuePick ? ' <span class="badge ghost">VALUE</span>' : ''}
          <div class="r-match">${esc(t.event)} · ${esc(t.market)}</div>
        </span>
      </div>`).join('')
    : '<div class="card-body meta-line">No selection cleared a threshold on this week\'s board.</div>';
  const skipped = [...state.cards.values()].reduce((n, c) => n + (c.written?.tips.filter((t) => t.skip).length || 0), 0);
  $('#rail-count').textContent = `${sel.length} selections across ${state.cards.size} tournament card(s) · ${skipped} markets written as NO SELECTION`;
}

function renderOlbg() {
  const box = $('#olbg-box');
  const slate = state.docs?.slateDoc;
  if (!slate) {
    box.innerHTML = `<div class="card-body">
      <p class="meta-line">No committed OLBG golf snapshot yet (built by <code>scripts/collect_golf_olbg.py</code> in CI).</p>
      <p><a href="https://www.olbg.com/betting-tips/Golf/5" target="_blank" rel="noopener noreferrer">Open the OLBG golf tips index ↗</a></p></div>`;
    return;
  }
  const rows = [...(slate.events || []), ...(slate.team_events || [])].slice(0, 16);
  box.innerHTML = `<div class="card-body tight">
    <table class="data"><thead><tr><th>Event</th><th>Market</th><th>Consensus</th></tr></thead>
    <tbody>${rows.map((e) => `<tr>
      <td><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.event_name || e.slug || e.event_id)}</a><div class="meta-line">${esc(e.resolved_date || e.display_date || '')}</div></td>
      <td>${esc(e.consensus?.market || '—')}</td>
      <td>${esc(e.consensus?.selection || '—')}${e.consensus?.tips_total ? `<div class="meta-line">${e.consensus.tips_for}/${e.consensus.tips_total} tips</div>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="3" class="empty">No rows in the snapshot.</td></tr>'}</tbody></table>
    <div class="card-body meta-line">Snapshot fetched ${esc(slate.source?.fetched_at_utc || 'unknown')} · consensus counts are display-only and never scored ·
    <a href="${esc(slate.source?.url || 'https://www.olbg.com/betting-tips/Golf/5')}" target="_blank" rel="noopener noreferrer">official index ↗</a></div>
  </div>`;
}

function renderCoverage() {
  const d = state.docs || {};
  const r = d.resultsDoc || {};
  const cards = [...state.cards.values()];
  const sum = (k) => cards.reduce((n, c) => n + (c.coverage?.[k] || 0), 0);
  $('#coverage').innerHTML = `
    <span>results tape: <code>${Object.keys(r.events || {}).length} events · ${Object.keys(r.players || {}).length} players</code>${r.fetched_at_utc ? ` (${esc(String(r.fetched_at_utc).slice(0, 10))})` : ''}</span>
    <span>OWGR rows: <code>${d.rankingsDoc?.rows?.length ?? 0}</code>${d.rankingsDoc?.fetched_at_utc ? ` (${esc(String(d.rankingsDoc.fetched_at_utc).slice(0, 10))})` : ''}</span>
    <span>season stats: <code>${d.statsDoc?.espn?.rows?.length ?? 0}</code> · strokes gained: <code>${d.statsDoc?.sg?.available ? 'PGA TOUR season' : 'not available'}</code></span>
    <span>this board: <code>${sum('scored')} players scored · ${sum('owgrMatched')} ranked · ${sum('sgMatched')} with SG (${sum('sgScored')} scored after the coverage floor) · ${sum('teeTimes')} tee times</code></span>
    <span>weather: <code>${cards.filter((c) => c.coverage?.weather).length}/${cards.length} events</code></span>
    ${backtestLine()}`;
}

/** One-line walk-forward backtest summary from data/golf_backtest.json (real numbers only). */
function backtestLine() {
  const bt = state.backtest;
  if (!bt?.summary?.length) return '<span>backtest: <code>not run yet</code> — <code>npm run backtest:golf</code> after a collection</span>';
  const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
  const m = Object.fromEntries(bt.summary.map((r) => [r.market, r]));
  const t6 = bt.top6List;
  return `<span>walk-forward backtest (${bt.events} events, ${esc(String(bt.generated_at_utc || '').slice(0, 10))}): <code>outright ${m.outright?.hits ?? 0}/${m.outright?.graded ?? 0} (${pct(m.outright?.hitRate)}) · top-six headline ${m.top6?.hits ?? 0}/${m.top6?.graded ?? 0} (${pct(m.top6?.hitRate)}) · top-six list ${t6?.hits ?? 0}/${t6?.selections ?? 0} placed (${pct(t6?.rate)}) · first-round leader ${m.frl?.hits ?? 0}/${m.frl?.graded ?? 0} (${pct(m.frl?.hitRate)}) · European ${pct(m.top_european?.hitRate)} · American ${pct(m.top_american?.hitRate)} · British &amp; Irish ${pct(m.top_british_irish?.hitRate)}</code> — <a href="data/golf_backtest.json" target="_blank" rel="noopener noreferrer">ledger ↗</a></span>`;
}

function renderMeta() {
  const cs = cacheStats();
  $('#meta').innerHTML = `
    <span>${state.events.length} tournaments</span>
    <span>${state.cards.size} scored</span>
    <span>${state.liveOk ? 'live ESPN feed' : 'committed snapshot (ESPN unreachable)'}</span>
    <span>loaded ${relTime(state.loadedAt)}</span>
    <span>cache <code>${cs.entries} entries / ${cs.kb} KB</code></span>
    ${state.errors.length ? `<span style="color:var(--accent)" title="${esc(state.errors.map((e) => `${e.tour || ''} ${e.event || ''}: ${e.error}`).join('\n'))}">${state.errors.length} feed errors</span>` : ''}`;
}

function renderDateStrip() {
  const el = $('#datestrip');
  const days = [];
  for (let i = -3; i <= 7; i += 1) days.push(addDays(state.date, i));
  el.innerHTML = days.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    const on = d === state.date;
    return `<button class="day ${on ? 'on' : ''}" data-date="${d}">
      <span class="dow">${dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${dt.getUTCDate()}</span>
      ${d === todayISO() ? '<span class="dot"></span>' : ''}
    </button>`;
  }).join('');
  $$('#datestrip .day').forEach((b) => b.addEventListener('click', () => loadDate(b.dataset.date)));
}

function calendarCounts() {
  const counts = new Map();
  const names = new Map();
  for (const tour of toursSelected()) {
    const cal = state.calendars[tour];
    for (const c of cal?.events || []) {
      const s = String(c.startDate || '').slice(0, 10);
      const e = String(c.endDate || c.startDate || '').slice(0, 10);
      if (!s) continue;
      let d = s;
      for (let i = 0; i < 8 && d <= e; i += 1) {
        counts.set(d, (counts.get(d) || 0) + 1);
        names.set(d, [...(names.get(d) || []), c.label]);
        d = addDays(d, 1);
      }
    }
  }
  return { counts, names };
}

function renderCalendar() {
  const grid = $('#calgrid');
  const { counts, names } = calendarCounts();
  const first = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth(), 1));
  $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const startDow = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startDow; i += 1) { const d = new Date(first); d.setUTCDate(d.getUTCDate() - (startDow - i)); cells.push({ d, other: true }); }
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  for (let i = 1; i <= dim; i += 1) cells.push({ d: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i)), other: false });
  while (cells.length % 7) { const last = cells[cells.length - 1].d; const d = new Date(last); d.setUTCDate(d.getUTCDate() + 1); cells.push({ d, other: true }); }
  grid.innerHTML = cells.map(({ d, other }) => {
    const iso = d.toISOString().slice(0, 10);
    const n = counts.get(iso) || 0;
    return `<button class="cell ${other ? 'other' : ''} ${iso === todayISO() ? 'today' : ''} ${iso === state.date ? 'on' : ''}" data-date="${iso}" title="${esc((names.get(iso) || []).join(', '))}">
      <span class="n">${d.getUTCDate()}</span>${n ? `<span class="c">${n}</span>` : ''}
    </button>`;
  }).join('');
  $$('#calgrid .cell').forEach((b) => b.addEventListener('click', () => {
    state.calMonth = new Date(`${b.dataset.date}T12:00:00Z`);
    loadDate(b.dataset.date);
  }));
}

function renderSeasonList() {
  const el = $('#season-list');
  const tours = toursSelected();
  const t = todayISO();
  const html = tours.map((tour) => {
    const cal = state.calendars[tour];
    if (!cal?.events?.length) return '';
    const rows = cal.events.map((c) => {
      const s = String(c.startDate || '').slice(0, 10);
      const e = String(c.endDate || '').slice(0, 10);
      const phase = e && e < t ? 'ft' : s && s <= t && (!e || t <= e) ? 'live' : '';
      return `<tr><td class="num"><button class="btn sm" data-date="${esc(s)}">${esc(s)}</button></td><td>${esc(c.label)}</td><td class="meta-line">${phase === 'ft' ? 'completed' : phase === 'live' ? 'this week' : 'upcoming'}</td></tr>`;
    }).join('');
    return `<details><summary style="cursor:pointer;padding:8px 14px;font-weight:700;font-size:13px">${esc(GOLF_TOURS[tour]?.name || tour)} — ${esc(cal.season?.displayName || cal.season?.year || '')} season (${cal.events.length} events) · <a href="${esc(cal.url)}" target="_blank" rel="noopener noreferrer">source ↗</a></summary>
      <div class="card-body tight"><table class="data"><tbody>${rows}</tbody></table></div></details>`;
  }).join('');
  el.innerHTML = html;
  $$('#season-list [data-date]').forEach((b) => b.addEventListener('click', () => { state.calMonth = new Date(`${b.dataset.date}T12:00:00Z`); loadDate(b.dataset.date); }));
}

function setProgress(pctv, label) {
  const bar = $('#progress i');
  const lab = $('#progress-label');
  if (bar) bar.style.width = `${pctv}%`;
  if (lab) lab.innerHTML = pctv >= 100 ? '' : `<span class="spin"></span> ${esc(label || '')}`;
  if (pctv >= 100) setTimeout(() => { if (bar) bar.style.width = '0%'; }, 400);
}

/* ------------------------------------------------------------------ *
 * controls
 * ------------------------------------------------------------------ */

function wireControls() {
  $('#prev-day').addEventListener('click', () => loadDate(addDays(state.date, -1)));
  $('#next-day').addEventListener('click', () => loadDate(addDays(state.date, 1)));
  $('#prev-week').addEventListener('click', () => loadDate(addDays(state.date, -7)));
  $('#next-week').addEventListener('click', () => loadDate(addDays(state.date, 7)));
  $('#today-btn').addEventListener('click', () => loadDate(todayISO()));
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) loadDate(e.target.value); });
  $('#cal-prev').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1)); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1)); renderCalendar(); });
  $('#tour-filter').addEventListener('change', (e) => { state.tour = e.target.value; loadDate(state.date); });

  let t = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.search = e.target.value; renderBoard(); renderRail(); }, 150);
  });

  // THE button. It rebuilds every card on the board and reports what it did.
  $('#generate').addEventListener('click', () => {
    const btn = $('#generate');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Generating…';
    requestAnimationFrame(() => {
      try {
        const n = generateAll({ force: true });
        renderBoard();
        renderRail();
        renderCoverage();
        renderMeta();
        const sel = allSelections();
        toast(n ? `${sel.length} selections generated across ${n} tournament card(s)` : 'No predictable tournament on this board — pick a week with a PGA TOUR or DP World Tour event');
      } catch (err) {
        toast(`Generation failed: ${err.message}`);
        console.error(err);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '⚡ Generate predictions';
      }
    });
  });

  $('#copy-all').addEventListener('click', async () => {
    const cards = visibleEvents().map((ev) => state.cards.get(ev.id)).filter((c) => c?.written);
    if (!cards.length) { toast('Nothing to copy — no card on this board'); return; }
    const text = cards.map((c) => c.written.cardText.replace(/\*\*/g, '')).join('\n\n———\n\n');
    const ok = await copyText(text);
    toast(ok ? `Copied ${cards.length} card(s)` : 'Copy failed — the clipboard is blocked here');
  });

  $('#refresh').addEventListener('click', () => { clearCache(); toast('Cache cleared — refetching'); loadDate(state.date); });
}

boot().catch((e) => {
  console.error(e);
  const b = $('#board');
  if (b) b.innerHTML = `<div class="note bad">The page failed to start: ${esc(e.message)}. Open the browser console for the stack trace.</div>`;
});
