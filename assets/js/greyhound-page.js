/**
 * SportsPred — greyhounds page controller (greyhounds.html).
 *
 * Greyhound racing is a field, race-by-race sport with no ESPN feed: the data
 * layer is the official GBGB results API (meetings, draws, results and per-dog
 * histories), collected in CI to data/greyhound_*.json, with a live browser
 * refresh straight from api.gbgb.org.uk when reachable. The OLBG greyhound
 * slate is display-only market context.
 *
 * This controller:
 *   1. loads the committed meetings/history/slate/provenance documents,
 *   2. attempts a same-day live refresh from the GBGB API (fallback: committed),
 *   3. scores every race with the greyhound master-prompt engine, applying the
 *      daily card management rules, and renders each race row + analysis panel,
 *   4. auto-generates the written WIN tips on load AND on the Generate button
 *      (the button always works — it re-runs scoring and rewrites every tip),
 *   5. renders the month calendar, rail selections, OLBG markets and sources,
 *   6. copies tips with one click.
 */

import { getSport } from '../../engine/registry.js';
import { enrichRace, formString } from '../../engine/greyhound_data.js';
import { scoreRace, buildDailyCard, CONFIDENCE } from '../../engine/greyhound_engine.js';
import { writeGreyhoundCard } from '../../engine/greyhound_writer.js';
import { loadStatic, clearCache, addDays } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, renderShell, renderFooter, toast, copyText, qs, setQS,
} from './ui.js';
import { collectGreyhoundDay, collectDogHistory } from './greyhound-collector.js';

const GBGB_RESULTS = 'https://www.gbgb.org.uk/racing/results/';
const SPORTING_LIFE = 'https://www.sportinglife.com/greyhounds/racecards';
const OLBG_GREYHOUNDS = 'https://www.olbg.com/betting-tips/Greyhounds/28';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  track: 'all',
  statusFilter: 'all',
  search: '',
  docs: null,
  races: [],          // normalised races for the selected date (committed + live)
  history: new Map(), // dogId -> runs
  scored: [],         // scored races
  card: null,         // daily card { races, picks }
  written: null,
  tipByRace: new Map(),
  calMonth: null,
  liveOk: false,
  generated: false,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('greyhounds');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'greyhounds', activePage: 'greyhounds.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  await loadDay(true);
}

function renderStatic() {
  const links = $('#sport-links');
  if (links) {
    links.innerHTML =
      `<a href="${GBGB_RESULTS}" target="_blank" rel="noopener noreferrer">GBGB official results ↗</a> · ` +
      `<a href="${SPORTING_LIFE}" target="_blank" rel="noopener noreferrer">Sporting Life racecards ↗</a> · ` +
      `<a href="${OLBG_GREYHOUNDS}" target="_blank" rel="noopener noreferrer">OLBG greyhound markets ↗</a>`;
  }
  renderOlbgBox();
}

async function loadDocs() {
  const [meetings, history, slate, provenance, predictions, backtest] = await Promise.all([
    loadStatic('data/greyhound_meetings.json'),
    loadStatic('data/greyhound_history.json'),
    loadStatic('data/greyhound_slate.json'),
    loadStatic('data/greyhound_provenance.json'),
    loadStatic('data/greyhound_predictions.json'),
    loadStatic('data/greyhound_backtest.json'),
  ]);
  state.docs = {
    meetings: meetings?.data || null,
    history: history?.data || null,
    slate: slate?.data || null,
    provenance: provenance?.data || null,
    predictions: predictions?.data || null,
    backtest: backtest?.data || null,
  };
  state.history = new Map(
    Object.entries(state.docs.history?.dogs || {}).map(([id, d]) => [String(id), d.runs || []]),
  );
  renderCoverage();
  renderSources();
}

/* ------------------------------------------------------------------ day */

async function loadDay(attemptLive = false) {
  setQS({ date: state.date });
  $('#day-title').textContent = fmtDateLong(state.date);
  $('#date-input').value = state.date;
  $('#counts').textContent = 'loading…';
  $('#board').innerHTML = '<div class="empty"><span class="spin"></span> Loading the card…</div>';

  let races = (state.docs.meetings?.races || []).filter((r) => r.date === state.date);
  state.liveOk = false;

  if (attemptLive) {
    $('#progress').style.display = '';
    $('#progress-label').textContent = 'Refreshing straight from the GBGB official API…';
    try {
      const live = await collectGreyhoundDay(state.date);
      if (live.races.length) {
        // Top up histories for any dog the committed file does not know.
        const need = new Set();
        for (const r of live.races) for (const rn of r.runners || []) {
          if (rn.dogId && !state.history.has(String(rn.dogId))) need.add(String(rn.dogId));
        }
        for (const id of [...need].slice(0, 60)) {
          const runs = await collectDogHistory(id);
          if (runs.length) state.history.set(id, runs);
        }
        races = mergeRaces(races, live.races);
        state.liveOk = true;
      }
    } catch (err) {
      console.warn('live GBGB refresh failed; using committed data', err);
    }
    $('#progress').style.display = 'none';
  }

  state.races = races
    .filter((r) => (r.runners || []).length >= 2)
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));

  scoreAll();
  renderBoard();
  renderCalendar();
  renderRail();
  renderTrackFilter();
}

function mergeRaces(committed, live) {
  const byId = new Map(committed.map((r) => [String(r.raceId), r]));
  for (const r of live) byId.set(String(r.raceId), r);
  return [...byId.values()];
}

function scoreAll() {
  const enriched = state.races.map((r) => enrichRace(r, state.history));
  state.scored = enriched.map((r) => scoreRace(r, { live: r.status !== 'result' }));
  state.card = buildDailyCard(state.scored);
  state.written = writeGreyhoundCard(state.card, { date: state.date });
  state.tipByRace = new Map((state.written?.tips || []).map((t) => [String(t.raceId), t]));
  state.generated = true;

  const nSel = state.card.picks.length;
  const nRaces = state.scored.length;
  const nResults = state.scored.filter((r) => r.status === 'result').length;
  $('#counts').textContent =
    `${nRaces} race${nRaces === 1 ? '' : 's'} · ${nSel} selection${nSel === 1 ? '' : 's'} · ` +
    `${nResults} resulted · source: ${state.liveOk ? 'live GBGB API' : 'committed GBGB data'}`;
}

/* ------------------------------------------------------------------ board */

function filteredRaces() {
  const q = state.search.trim().toLowerCase();
  return state.card.races.filter((r) => {
    if (state.track !== 'all' && String(r.track).toLowerCase() !== state.track) return false;
    if (state.statusFilter === 'scheduled' && r.status !== 'scheduled') return false;
    if (state.statusFilter === 'result' && r.status !== 'result') return false;
    if (state.statusFilter === 'selected' && !r.cardSelected) return false;
    if (q) {
      const hay = [r.track, r.grade, r.raceTitle, ...(r.runners || []).flatMap((x) => [x.name, x.trainer])]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const races = filteredRaces();
  const board = $('#board');
  if (!races.length) {
    board.innerHTML = '<div class="empty">No races on this date match the filters. The committed collection window covers the most recent racedays; pick a highlighted day on the calendar.</div>';
    return;
  }
  board.innerHTML = races.map(raceCard).join('');
  $$('.race-head', board).forEach((el) => el.addEventListener('click', () => {
    el.closest('.race').classList.toggle('open');
  }));
  $$('.copy-tip', board).forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tip = state.tipByRace.get(btn.dataset.race);
    if (!tip) return;
    const ok = await copyText(tipText(tip));
    toast(ok ? 'Tip copied to clipboard' : 'Copy failed — select the text manually');
  }));
  $$('.copy-analysis', board).forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(analysisText(btn.dataset.race));
    toast(ok ? 'Analysis copied' : 'Copy failed');
  }));
}

function confBadge(band) {
  return `<span class="badge ${esc(band)}">${esc(band)}</span>`;
}

function raceCard(r) {
  const tip = state.tipByRace.get(String(r.raceId));
  const selected = r.cardSelected && r.winner;
  const status = r.status === 'result'
    ? `<span class="badge SKIP">RESULT</span>`
    : `<span class="badge MEDIUM">UPCOMING</span>`;
  const grade = r.grade ? `<span class="pill">${esc(r.grade)}</span>` : '';
  const dist = r.distance ? `<span class="pill">${esc(Math.round(r.distance))}m</span>` : '';
  const title = r.raceTitle ? `<div class="meta-line">${esc(r.raceTitle)}</div>` : '';

  let pickLine;
  if (r.status === 'result') {
    const w = r.runners.find((x) => x.position === 1);
    pickLine = w
      ? `<strong>Winner:</strong> ${esc(w.name)} (trap ${esc(w.trap)})${w.sp ? ` · SP ${esc(w.sp)}` : ''} · ${w.runTime ? `${esc(w.runTime)}s` : ''}`
      : '<strong>Result</strong> recorded';
  } else if (r.status === 'scheduled' && (!selected || tip?.skip)) {
    pickLine = '<strong>NO SELECTION</strong> — no runner clears the method’s thresholds for this heat.';
  } else {
    pickLine = `<strong>Selection:</strong> <strong class="sel">${esc(r.winner.name)}</strong> (trap ${esc(r.winner.trap)}) · score ${r.winner.score} · ${confBadge(r.decision.confidence)}`;
  }

  currentRace = r;
  const runners = [...(r.runners || [])].sort((a, b) => (a.trap ?? 9) - (b.trap ?? 9)).map(runnerRow).join('');

  return `
  <div class="race ${r.cardSelected ? 'is-pick' : ''}" data-race="${r.raceId}">
    <div class="race-head">
      <div class="race-id">
        <div class="race-title"><strong>${esc(r.time || '')}</strong> ${esc(r.track || '')} ${status}</div>
        <div class="meta-line">${grade} ${dist} ${selected ? `${confBadge(r.decision.confidence)} <span class="pill">trap ${esc(r.winner.trap)}</span>` : ''}</div>
        ${title}
      </div>
      <div class="race-pick">${pickLine}</div>
      <div class="race-toggle">▾</div>
    </div>
    <div class="race-body">
      ${tip && !tip.skip && r.status === 'scheduled' ? `
        <div class="tip-box">
          <div class="tip-text">${formatTip(tip.text)}</div>
          <div class="tip-actions">
            <button class="btn sm copy-tip" data-race="${r.raceId}">📋 Copy tip</button>
            <button class="btn sm copy-analysis" data-race="${r.raceId}">Copy analysis</button>
          </div>
        </div>` : ''}
      <table class="runners">
        <thead><tr><th>Trap</th><th>Dog</th><th>Trainer</th><th>Form</th><th>Best</th><th>Last</th><th>Score</th><th></th></tr></thead>
        <tbody>${runners}</tbody>
      </table>
      ${analysisPanel(r, tip)}
    </div>
  </div>`;
}

let currentRace = null;

function runnerRow(rn) {
  const form = formString({ last5: (rn.last5 || []).map((x) => ({ position: x.position })) });
  const pipCls = (f) => (f === '1' ? 'p1' : f === '2' ? 'p2' : f === '3' ? 'p3' : 'px');
  const pips = form.split('').map((f) => `<i class="${pipCls(f)}">${esc(f)}</i>`).join('');
  const isPick = currentRace?.winner && rn.dogId === currentRace.winner.dogId;
  const pos = rn.position ? `<span class="pos pos-${rn.position}">${rn.position}</span>` : '';
  const winnerStar = rn.position === 1 ? ' ⭐' : '';
  return `<tr class="${isPick ? 'pick-row' : ''}">
    <td class="trap">${esc(rn.trap ?? '')}${pos}</td>
    <td class="dog"><strong>${esc(rn.name || '')}</strong>${winnerStar}${rn.sp ? ` <span class="meta-line">SP ${esc(rn.sp)}</span>` : ''}</td>
    <td class="meta-line">${esc(rn.trainer || '')}</td>
    <td><span class="form-pips gh-pips">${pips}</span></td>
    <td class="mono">${rn.stats?.cdBest ? esc(rn.stats.cdBest.toFixed(2)) + 's' : '—'}</td>
    <td class="mono">${rn.lastTime ? esc(Number(rn.lastTime).toFixed(2)) + 's' : '—'}</td>
    <td>${rn.score != null ? `<strong>${rn.score}</strong>` : '—'}</td>
    <td>${isPick ? confBadge(currentRace.decision.confidence) : ''}</td>
  </tr>`;
}

function analysisPanel(r, tip) {
  const winner = r.winner;
  if (!winner && r.status !== 'result') {
    return `<div class="analysis"><div class="meta-line">No runner met the selection threshold. ${esc((r.decision?.reasons || []).join('; '))}</div></div>`;
  }
  const dog = winner || (r.status === 'result' ? r.runners.find((x) => x.position === 1) : null);
  if (!dog) return '';
  const rows = (dog.components || []).map((c) => `
    <tr class="${c.missing ? 'missing' : ''}">
      <td>${esc(c.label)}${c.max && c.max > 0 ? ` <span class="meta-line">/ ${c.max}</span>` : ''}</td>
      <td class="mono">${c.missing ? 'n/a' : (c.points > 0 ? '+' : '') + c.points}</td>
      <td class="meta-line">${esc(c.detail || '')}${c.missing ? ' — not available from a free source' : ''}</td>
    </tr>`).join('');
  const missing = [...new Set((dog.missing || []))].map((m) => `<li>${esc(m)}</li>`).join('');
  const review = [
    `<a href="${esc(r.sourceUrl || `${'https://api.gbgb.org.uk/api/results/meeting/'}${r.meetingId}`)}" target="_blank" rel="noopener noreferrer">GBGB official meeting record ↗</a>`,
    `<a href="https://www.gbgb.org.uk/racing/results/" target="_blank" rel="noopener noreferrer">GBGB results site ↗</a>`,
    `<a href="${SPORTING_LIFE}" target="_blank" rel="noopener noreferrer">Sporting Life racecard ↗</a>`,
    `<a href="${OLBG_GREYHOUNDS}" target="_blank" rel="noopener noreferrer">OLBG market ↗</a>`,
  ].join(' · ');
  return `
  <div class="analysis">
    <details>
      <summary>Analysis — ${esc(dog.name)}${r.gap != null && r.status === 'scheduled' ? ` · gap to 2nd: ${r.gap} pts` : ''} · rules fired and sources</summary>
      <table class="components"><thead><tr><th>Factor</th><th>Pts</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>
      ${missing ? `<div class="meta-line"><strong>Not sourced:</strong><ul>${missing}</ul></div>` : ''}
      <div class="meta-line"><strong>Review links:</strong> ${review}</div>
    </details>
  </div>`;
}

/* ------------------------------------------------------------------ tips */

function formatTip(text) {
  // Bold **Dog Name**, ensure no stray markup; confidence last.
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function tipText(tip) {
  return tip.text.replace(/\*\*/g, '');
}

function analysisText(raceId) {
  const r = state.scored.find((x) => String(x.raceId) === String(raceId));
  if (!r) return '';
  const tip = state.tipByRace.get(String(raceId));
  const lines = [
    `${r.time} ${r.track} — ${r.grade || ''} ${r.distance ? Math.round(r.distance) + 'm' : ''}`,
    tip && !tip.skip ? tip.text.replace(/\*\*/g, '') : 'NO SELECTION',
    '',
    'Runner scores:',
    ...[...r.runners].sort((a, b) => b.score - a.score)
      .map((x) => `  Trap ${x.trap} ${x.name}: ${x.score} (${x.formString || formString({ last5: (x.last5 || []).map((q) => ({ position: q.position })) })})`),
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------------ rail */

function renderRail() {
  const picks = state.card?.picks || [];
  const el = $('#rail-preds');
  if (!picks.length) {
    el.innerHTML = '<div class="card-body meta-line">No selections on this card — every race fell below the method’s thresholds or data is still being collected.</div>';
  } else {
    el.innerHTML = picks.map((p) => `
      <div class="rail-pick">
        <div><strong>${esc(p.time)}</strong> ${esc(p.track)}</div>
        <div>${confBadge(p.confidence)} <strong>${esc(p.selection)}</strong> <span class="meta-line">trap ${esc(p.trap)} · ${p.score} pts</span></div>
      </div>`).join('');
  }
  $('#rail-count').textContent = `${picks.length} pick${picks.length === 1 ? '' : 's'} across ${state.card?.trackCount ?? 0} track${(state.card?.trackCount ?? 0) === 1 ? '' : 's'} · daily cap 5–7 races, at least two tracks.`;
}

function renderOlbgBox() {
  const box = $('#olbg-box');
  if (!box) return;
  const body = $('.card-body', box);
  body.innerHTML = '<div class="empty"><span class="spin"></span> Loading OLBG markets…</div>';
  loadStatic('data/greyhound_slate.json').then((res) => {
    const events = res?.data?.events || [];
    if (!events.length) { body.innerHTML = '<span class="meta-line">No OLBG slate committed yet.</span>'; return; }
    body.innerHTML = events.map((e) => `
      <div class="olbg-row">
        <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(e.event_name)}</strong></a>
        <div class="meta-line">Tipster pick: ${esc(e.consensus?.selection || '—')} · ${e.consensus?.tips_for ?? 0}/${e.consensus?.tips_total ?? 0} tips (display only)</div>
      </div>`).join('') +
      `<div class="meta-line" style="margin-top:8px"><a href="${OLBG_GREYHOUNDS}" target="_blank" rel="noopener noreferrer">All OLBG greyhound markets ↗</a>. Tipster consensus is never fed into scoring.</div>`;
  });
}

function renderCoverage() {
  const races = state.docs.meetings?.races || [];
  const dogs = Object.keys(state.docs.history?.dogs || {}).length;
  const window = state.docs.meetings?.source?.window;
  $('#coverage').innerHTML = `
    <ul style="margin:0;padding-left:16px">
      <li>Meetings window: ${esc(window?.days_back ?? '—')} days (${esc((window?.dates || []).join(', '))})</li>
      <li>Committed races: ${races.length} (${races.filter((r) => r.status === 'result').length} results, ${races.filter((r) => r.status === 'scheduled').length} upcoming)</li>
      <li>Dogs with form history: ${dogs}</li>
      <li>Data refreshed: ${esc(state.docs.meetings?.source?.fetched_at_utc || '—')}</li>
    </ul>
    <p style="margin-bottom:0">Live odds are not available from any free key-less feed, so the odds category is scored as missing and live confidence is capped at MEDIUM. <a href="sources.html#greyhounds">Irregularity register →</a></p>`;
}

function renderSources() {
  const irr = state.docs.provenance?.irregularities || [];
  $('#sources').innerHTML = `
    <p style="margin-top:0"><a href="${GBGB_RESULTS}" target="_blank" rel="noopener noreferrer">GBGB results &amp; database ↗</a><br>
    <a href="https://api.gbgb.org.uk/api/results?page=1&itemsPerPage=1&date=${state.date}&race_type=race" target="_blank" rel="noopener noreferrer">GBGB API (this date) ↗</a><br>
    <a href="${SPORTING_LIFE}" target="_blank" rel="noopener noreferrer">Sporting Life racecards ↗</a><br>
    <a href="${OLBG_GREYHOUNDS}" target="_blank" rel="noopener noreferrer">OLBG greyhound tips ↗</a></p>
    <p style="margin-bottom:0">${irr.length} logged irregularities (${irr.filter((i) => i.status === 'open').length} open). <a href="sources.html#greyhounds">View register →</a></p>`;
}

/* ------------------------------------------------------------------ calendar */

function renderCalendar() {
  const month = state.calMonth;
  const y = month.getUTCFullYear(); const m = month.getUTCMonth();
  $('#cal-title').textContent = month.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const first = new Date(Date.UTC(y, m, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday-first
  const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const counts = new Map();
  for (const r of state.docs.meetings?.races || []) {
    counts.set(r.date, (counts.get(r.date) || 0) + 1);
  }
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<span class="cell other"></span>');
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = counts.get(iso) || 0;
    const isToday = iso === todayISO();
    const isSel = iso === state.date;
    cells.push(`<button class="cell ${isToday ? 'today' : ''} ${isSel ? 'on' : ''} ${n ? '' : 'other'}" data-date="${iso}" title="${iso}: ${n} races">
      <span class="n">${d}</span>${n ? `<span class="c">${n} race${n === 1 ? '' : 's'}</span>` : ''}</button>`);
  }
  $('#calgrid').innerHTML = cells.join('');
  $$('#calgrid .cell').forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.date;
    loadDay(false);
  }));
  renderDatestrip();
}

function renderDatestrip() {
  const strip = $('#datestrip');
  const dates = [-3, -2, -1, 0, 1, 2, 3].map((n) => addDays(state.date, n));
  strip.innerHTML = dates.map((iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    const n = (state.docs.meetings?.races || []).filter((r) => r.date === iso).length;
    return `<button class="day ${iso === state.date ? 'on' : ''}" data-date="${iso}">
      <span class="dow">${d.toLocaleString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${d.getUTCDate()}</span>
      ${n ? `<span class="meta-line" style="font-size:10px">${n}</span>` : '<span class="dot" style="visibility:hidden"></span>'}</button>`;
  }).join('');
  $$('.day', strip).forEach((b) => b.addEventListener('click', () => { state.date = b.dataset.date; loadDay(false); }));
}

function renderTrackFilter() {
  const tracks = [...new Set(state.scored.map((r) => String(r.track || '')))].sort();
  const sel = $('#track-filter');
  sel.innerHTML = '<option value="all">All tracks</option>' +
    tracks.map((t) => `<option value="${esc(t.toLowerCase())}">${esc(t)}</option>`).join('');
  sel.value = state.track;
}

/* ------------------------------------------------------------------ controls */

function wireControls() {
  $('#prev-day').addEventListener('click', () => { state.date = addDays(state.date, -1); loadDay(false); });
  $('#next-day').addEventListener('click', () => { state.date = addDays(state.date, 1); loadDay(false); });
  $('#today-btn').addEventListener('click', () => { state.date = todayISO(); loadDay(true); });
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; loadDay(false); } });
  $('#cal-prev').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1)); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1)); renderCalendar(); });
  $('#track-filter').addEventListener('change', (e) => { state.track = e.target.value; renderBoard(); });
  $('#status-filter').addEventListener('change', (e) => { state.statusFilter = e.target.value; renderBoard(); });
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); });
  $('#refresh').addEventListener('click', async () => {
    clearCache();
    toast('Cache cleared — refreshing from GBGB…');
    await loadDay(true);
  });

  // The Generate button always works: it re-scores every race from the data
  // and rewrites every tip from scratch, then renders.
  $('#generate').addEventListener('click', async () => {
    const btn = $('#generate');
    btn.disabled = true;
    $('#progress').style.display = '';
    $('#progress-label').textContent = 'Scoring every race and writing the WIN tips…';
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (state.date === todayISO() && !state.liveOk) await loadDay(true);
      else scoreAll();
      renderBoard();
      renderRail();
      toast(`Generated ${state.card.picks.length} written tips for ${fmtDateLong(state.date)}`);
    } finally {
      btn.disabled = false;
      $('#progress').style.display = 'none';
    }
  });

  $('#copy-all').addEventListener('click', async () => {
    const tips = (state.written?.tips || []).filter((t) => !t.skip);
    if (!tips.length) { toast('No generated tips to copy'); return; }
    const text = [
      `Greyhound WIN tips — ${fmtDateLong(state.date)}`,
      '',
      ...tips.flatMap((t) => [`${t.time} ${t.track}`, tipText(t), '']),
      'Summary:',
      ...state.written.summaryTable.rows.map((r) => `${r.track} ${r.time} — ${r.selection} (trap ${r.trap}) [${r.confidence}]`),
      '',
      state.written.responsibleGambling,
    ].join('\n');
    const ok = await copyText(text);
    toast(ok ? `Copied ${tips.length} tips + summary table` : 'Copy failed');
  });
}

boot().catch((err) => {
  console.error(err);
  $('#board').innerHTML = `<div class="empty">Failed to load the greyhound layer: ${esc(err.message)}. The committed data may be missing; CI repopulates it.</div>`;
});
