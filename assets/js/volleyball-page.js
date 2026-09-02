/**
 * SportsPred — volleyball page controller (volleyball.html).
 *
 * Two competition families, never mixed:
 *   ncaa          live ESPN college scoreboard (linescores = set points)
 *   eurovolley-w  committed CEV Women's Euro 2026 tape
 *
 * Generate always re-scores WIN MATCH + SET SCORE from the specialist engine.
 */

import { getSport } from '../../engine/registry.js';
import { parseVolleyballScoreboard } from '../../engine/volleyball_espn.js';
import {
  enrichVolleyballMatch, matchVolleyballSlate,
} from '../../engine/volleyball_data.js';
import { scoreVolleyballCard } from '../../engine/volleyball_engine.js';
import { writeVolleyballCard, buildVolleyballFormattedCardText } from '../../engine/volleyball_writer.js';
import {
  loadLeagueDay, loadStatic, pool, addDays, ttlForDate, cacheStats, clearCache,
} from './data-client.js';
import {
  $, $$, esc, todayISO, fmtTime, fmtDateLong, relTime, renderShell, renderFooter,
  toast, copyText, confBar, formPips, qs, setQS,
} from './ui.js';

const NCAA_LEAGUES = [
  { slug: 'womens-college-volleyball', name: "NCAA Women's Volleyball" },
  { slug: 'mens-college-volleyball', name: "NCAA Men's Volleyball" },
];

const ESPN_VB = 'https://www.espn.com/college-sports/volleyball/scoreboard';
const OLBG_VB = 'https://www.olbg.com/betting-tips/Volleyball/21';
const CEV = 'https://www.cev.eu/';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  leagueFilter: 'all',
  phase: 'all',
  search: '',
  matches: [],
  tape: [],
  docs: { matches: null, tape: null, slate: null, provenance: null },
  card: null,
  written: null,
  calMonth: null,
  calCounts: new Map(),
  loadedAt: null,
  errors: [],
  generated: false,
};

async function boot() {
  state.sport = getSport('volleyball');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'volleyball', activePage: 'volleyball.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  await loadDate(state.date, true);
}

function renderStatic() {
  const links = $('#sport-links');
  if (links) {
    links.innerHTML =
      `<a href="${ESPN_VB}" target="_blank" rel="noopener noreferrer">ESPN college volleyball ↗</a> · ` +
      `<a href="${OLBG_VB}" target="_blank" rel="noopener noreferrer">OLBG volleyball markets ↗</a> · ` +
      `<a href="${CEV}" target="_blank" rel="noopener noreferrer">CEV ↗</a>`;
  }
  const notes = state.sport?.notes || [];
  if (notes.length) {
    $('#sport-notes').innerHTML = notes.map((n) => `<div class="note">${esc(n)}</div>`).join('');
  }
}

async function loadDocs() {
  const [matches, tape, slate, provenance, predictions, backtest] = await Promise.all([
    loadStatic('data/volleyball_matches.json'),
    loadStatic('data/volleyball_tape.json'),
    loadStatic('data/volleyball_slate.json'),
    loadStatic('data/volleyball_provenance.json'),
    loadStatic('data/volleyball_predictions.json'),
    loadStatic('data/volleyball_backtest.json'),
  ]);
  state.docs = {
    matches: matches?.data || null,
    tape: tape?.data || null,
    slate: slate?.data || null,
    provenance: provenance?.data || null,
    predictions: predictions?.data || null,
    backtest: backtest?.data || null,
  };
  state.tape = state.docs.tape?.matches || [];
  renderOlbgBox();
  renderCoverage();
}

async function loadDate(dateISO, attemptLive = false) {
  state.date = dateISO;
  state.errors = [];
  setQS({ date: dateISO });
  $('#date-input').value = dateISO;
  $('#day-title').textContent = fmtDateLong(dateISO);
  renderDateStrip();
  renderCalendar();
  $('#board').innerHTML = '<div class="empty"><span class="spin"></span> Loading the card…</div>';
  setProgress(10, 'Loading volleyball fixtures…');

  const committed = (state.docs.matches?.matches || [])
    .filter((m) => (m.dateISO || m.date) === dateISO)
    .map((m) => ({ ...m, family: m.family || 'eurovolley-w' }));

  const ncaa = [];
  if (attemptLive || true) {
    const targets = NCAA_LEAGUES;
    let done = 0;
    await pool(targets, 2, async (lg) => {
      const res = await loadLeagueDay('volleyball', lg.slug, dateISO, { ttl: ttlForDate(dateISO, false) });
      done += 1;
      setProgress(10 + Math.round((done / targets.length) * 50), `NCAA ${done}/${targets.length}…`);
      if (!res.data) {
        if (res.error) state.errors.push({ league: lg.slug, error: res.error });
        return;
      }
      const parsed = parseVolleyballScoreboard(res.data, {
        sportKey: 'volleyball', leagueSlug: lg.slug, leagueName: lg.name,
      });
      for (const m of parsed.matches) {
        m.family = 'ncaa';
        ncaa.push(m);
      }
      if (parsed.league?.calendar?.length) {
        for (const d of parsed.league.calendar) {
          state.calCounts.set(d, (state.calCounts.get(d) || 0) + 1);
        }
      }
    });
  }

  const byId = new Map();
  for (const m of [...committed, ...ncaa]) byId.set(String(m.id || m.event_id), m);
  state.matches = [...byId.values()].sort((a, b) => String(a.startUtc || a.date).localeCompare(String(b.startUtc || b.date)));

  for (const m of state.tape) {
    if (m.date) state.calCounts.set(m.date, (state.calCounts.get(m.date) || 0) + 1);
  }
  for (const m of state.docs.matches?.matches || []) {
    const d = m.dateISO || m.date;
    if (d) state.calCounts.set(d, (state.calCounts.get(d) || 0) + 1);
  }

  state.loadedAt = Date.now();
  setProgress(80, 'Scoring WIN MATCH and SET SCORE…');
  scoreAll();
  setProgress(100, '');
  renderLeagueSelect();
  renderBoard();
  renderRail();
  renderMeta();
  renderCalendar();
}

export function scoreAll() {
  const tape = state.tape;
  const enriched = state.matches.map((m) => {
    const row = enrichVolleyballMatch(m, tape);
    row.olbg = matchVolleyballSlate(row, state.docs.slate);
    return row;
  });
  const scored = scoreVolleyballCard(enriched);
  const written = writeVolleyballCard(scored.results);
  state.card = { ...scored, matches: enriched };
  state.written = written;
  state.generated = true;
  return scored.results.length;
}

function visibleMatches() {
  const q = state.search.trim().toLowerCase();
  return (state.card?.matches || []).filter((m) => {
    if (state.phase !== 'all' && m.phase !== state.phase) return false;
    if (state.leagueFilter === 'ncaa' && m.family !== 'ncaa') return false;
    if (state.leagueFilter === 'eurovolley-w' && m.family !== 'eurovolley-w') return false;
    if (state.leagueFilter !== 'all' && state.leagueFilter !== 'ncaa' && state.leagueFilter !== 'eurovolley-w'
      && m.leagueSlug !== state.leagueFilter) return false;
    if (q) {
      const hay = `${m.home} ${m.away} ${m.leagueName || ''} ${m.venue || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function setProgress(pctv, label) {
  const bar = $('#progress i');
  const lab = $('#progress-label');
  if (bar) bar.style.width = `${pctv}%`;
  if (lab) lab.innerHTML = pctv >= 100 ? '' : `<span class="spin"></span> ${esc(label || '')}`;
  if (pctv >= 100) setTimeout(() => { if (bar) bar.style.width = '0%'; }, 400);
}

function renderLeagueSelect() {
  const sel = $('#league-filter');
  if (!sel) return;
  sel.innerHTML = `
    <option value="all">All competitions</option>
    <option value="ncaa">NCAA (ESPN)</option>
    <option value="eurovolley-w">EuroVolley Women 2026 (committed tape)</option>`;
  sel.value = state.leagueFilter;
  $('#registry-note').innerHTML = `<div class="note info">NCAA endpoints were machine-verified in <code>data/leagues.json</code>. EuroVolley is scored only from the committed CEV tape — never from college form. <a href="sources.html#volleyball">Register →</a></div>`;
}

function renderDateStrip() {
  const el = $('#datestrip');
  const days = [];
  for (let i = -3; i <= 7; i += 1) days.push(addDays(state.date, i));
  el.innerHTML = days.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    const on = d === state.date;
    const n = state.calCounts.get(d) || 0;
    return `<button class="day ${on ? 'on' : ''}" data-date="${d}">
      <span class="dow">${dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${dt.getUTCDate()}</span>
      ${n ? `<span class="dot"></span>` : ''}
    </button>`;
  }).join('');
  $$('#datestrip .day').forEach((b) => b.addEventListener('click', () => loadDate(b.dataset.date, true)));
}

function renderCalendar() {
  const grid = $('#calgrid');
  const first = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth(), 1));
  $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const startDow = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startDow; i += 1) {
    const d = new Date(first); d.setUTCDate(d.getUTCDate() - (startDow - i));
    cells.push({ d, other: true });
  }
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  for (let i = 1; i <= dim; i += 1) {
    cells.push({ d: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i)), other: false });
  }
  while (cells.length % 7) {
    const last = cells[cells.length - 1].d;
    const d = new Date(last); d.setUTCDate(d.getUTCDate() + 1);
    cells.push({ d, other: true });
  }
  grid.innerHTML = cells.map(({ d, other }) => {
    const iso = d.toISOString().slice(0, 10);
    const n = state.calCounts.get(iso) || 0;
    return `<button class="cell ${other ? 'other' : ''} ${iso === todayISO() ? 'today' : ''} ${iso === state.date ? 'on' : ''}" data-date="${iso}">
      <span class="n">${d.getUTCDate()}</span>
      ${n ? `<span class="c">${n}</span>` : ''}
    </button>`;
  }).join('');
  $$('#calgrid .cell').forEach((b) => b.addEventListener('click', () => {
    state.calMonth = new Date(`${b.dataset.date}T12:00:00Z`);
    loadDate(b.dataset.date, true);
  }));
}

function teamBlob(m, side) {
  const obj = side === 'home' ? m.homeTeamObj : m.awayTeamObj;
  const name = obj?.name || m[side];
  return { name, logo: obj?.logo, rank: obj?.rank, recordSummary: obj?.recordSummary, form: obj?.form?.last5 || obj?.form, score: obj?.score ?? (side === 'home' ? m.homeSets : m.awaySets) };
}

function matchRow(m, result) {
  const wm = result?.markets?.win_match;
  const ss = result?.markets?.set_score;
  const home = teamBlob(m, 'home');
  const away = teamBlob(m, 'away');
  const when = m.phase === 'live'
    ? `<div class="t">${esc(m.statusDetail || '')}</div><div class="s live">LIVE</div>`
    : m.phase === 'results'
      ? `<div class="t">${m.homeSets ?? home.score ?? ''}–${m.awaySets ?? away.score ?? ''}</div><div class="s ft">FINAL</div>`
      : `<div class="t">${m.startUtc ? esc(fmtTime(m.startUtc)) : 'TBD'}</div><div class="s">${esc((m.round || m.statusDetail || '').slice(0, 16))}</div>`;

  const teamRow = (t, other) => `
    <div class="trow">
      ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '<span style="width:20px"></span>'}
      ${t.rank ? `<span class="rank">${t.rank}</span>` : ''}
      <span class="nm">${esc(t.name)}</span>
      ${t.recordSummary ? `<span class="rec">${esc(t.recordSummary)}</span>` : ''}
      ${formPips(Array.isArray(t.form) ? t.form : [])}
      ${t.score != null ? `<span class="sc">${t.score}</span>` : ''}
    </div>`;

  const pill = wm?.selection
    ? `<span class="pred-pill ${esc(wm.band)}">
         <span class="badge ${esc(wm.band)}">${esc(wm.band)}</span>
         <span class="sel">${esc(wm.selection)}${ss?.selection ? ` · ${esc(ss.selection)}` : ''}</span>
         ${confBar(wm.score, wm.band)}
       </span>`
    : `<span class="pred-pill SKIP"><span class="badge SKIP">SKIP</span><span class="sel">${esc(wm?.reason || 'unscored')}</span></span>`;

  const setsLine = (m.sets || []).length
    ? `<div class="meta-line">Sets: ${(m.sets || []).map((s) => `${s.home ?? '–'}–${s.away ?? '–'}`).join(', ')}</div>`
    : '';

  return `
  <div class="match" data-id="${esc(String(m.id || m.event_id))}">
    <div class="match-main">
      <div class="match-when">${when}</div>
      <div class="teams">${teamRow(home, away)}${teamRow(away, home)}${setsLine}
        <div class="meta-line">${esc(m.leagueName || m.league || m.family)} · ${esc(m.family === 'ncaa' ? 'NCAA / ESPN' : 'EuroVolley tape')}</div>
      </div>
      <div class="match-right">
        ${pill}
        <button class="btn sm" data-toggle="${esc(String(m.id || m.event_id))}">Analysis</button>
      </div>
    </div>
    <div class="detail" id="detail-${esc(String(m.id || m.event_id))}"></div>
  </div>`;
}

function renderBoard() {
  const list = visibleMatches();
  const board = $('#board');
  const all = state.card?.matches || [];
  $('#counts').textContent =
    `${all.length} matches · ${all.filter((m) => m.phase === 'upcoming').length} upcoming · ` +
    `${all.filter((m) => m.phase === 'live').length} in play · ${all.filter((m) => m.phase === 'results').length} final`;

  if (!list.length) {
    board.innerHTML = `<div class="empty">No volleyball matches match these filters on ${esc(state.date)}. NCAA is live from ESPN; EuroVolley quarter-finals are on 3 September 2026 from the committed tape.</div>`;
    return;
  }

  const resultById = new Map((state.card?.results || []).map((r) => [String(r.result.event_id || r.match.id), r.result]));
  const groups = new Map();
  for (const m of list) {
    const k = m.family === 'ncaa' ? (m.leagueName || 'NCAA') : 'EuroVolley Women 2026';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  board.innerHTML = [...groups.entries()].map(([league, ms]) => `
    <div class="lg-head"><span>${esc(league)}</span><span class="count">${ms.length}</span></div>
    ${ms.map((m) => matchRow(m, resultById.get(String(m.id || m.event_id)))).join('')}
  `).join('');

  $$('#board [data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const d = $(`#detail-${CSS.escape(b.dataset.toggle)}`);
    if (!d) return;
    const open = d.classList.toggle('open');
    b.textContent = open ? 'Hide analysis' : 'Analysis';
    if (open && !d.dataset.filled) { d.innerHTML = detailHtml(b.dataset.toggle); d.dataset.filled = '1'; wireDetail(d); }
  }));
}

function tipsForMatch(id) {
  return (state.written?.tips || []).filter((t) => String(t.event_id) === String(id));
}

function detailHtml(matchId) {
  const m = (state.card?.matches || []).find((x) => String(x.id || x.event_id) === String(matchId));
  const row = (state.card?.results || []).find((r) => String(r.result.event_id || r.match.id) === String(matchId));
  if (!m || !row) return '<div class="meta-line">No analysis available.</div>';
  const result = row.result;
  const tips = tipsForMatch(matchId);
  const comps = (mk) => (mk?.components || []).map((c) => `
    <tr class="${c.missing ? 'missing' : ''}">
      <td>${esc(c.label)}</td>
      <td class="mono">${c.missing ? 'n/a' : (c.points > 0 ? '+' : '') + c.points}</td>
      <td class="meta-line">${esc(c.detail || '')}</td>
    </tr>`).join('');

  const tipHtml = tips.map((t) => `
    <div class="tipbox">
      <div class="tip-meta">
        <span class="badge ${esc(t.band)}">${esc(t.marketLabel)} · ${esc(t.band)}</span>
        ${t.ok && !t.skip ? `<button class="btn sm" data-copy="${esc(String(matchId))}" data-market="${esc(t.market)}">Copy tip</button>` : ''}
      </div>
      <div class="tip-text">${t.ok ? esc(t.text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') : esc((t.violations || []).join('; '))}</div>
    </div>`).join('');

  const missing = (result.missing || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const review = [
    m.source_url || m.links?.summary,
    m.family === 'ncaa' ? `${ESPN_VB}/_/date/${(m.dateISO || '').replace(/-/g, '')}` : 'https://en.wikipedia.org/wiki/2026_Women\'s_European_Volleyball_Championship',
    m.olbg?.url || OLBG_VB,
    'https://www.the-sports.org/volleyball-european-championship-women-2026-epr139365.html',
  ].filter(Boolean);

  return `
  <div class="detail-grid">
    <div>
      ${tipHtml || '<div class="meta-line">No tip written.</div>'}
      <p class="meta-line" style="margin-top:10px">${m.family === 'ncaa'
    ? 'NCAA form and records come from ESPN. Odds were not present on the 2026-09-02 check (IR-VB-02).'
    : 'EuroVolley form comes from the committed CEV tape. NCAA college records are not used.'}</p>
      <ul class="srclist">${review.map((u) => `<li>→ <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)} ↗</a></li>`).join('')}</ul>
    </div>
    <div>
      <table class="kv"><thead><tr><th>WIN MATCH factors</th><th>Pts</th><th>Why</th></tr></thead>
        <tbody>${comps(result.markets.win_match) || '<tr><td colspan="3">none</td></tr>'}</tbody></table>
      <table class="kv" style="margin-top:12px"><thead><tr><th>SET SCORE factors (${esc(result.markets.set_score?.outcome || '')})</th><th>Pts</th><th>Why</th></tr></thead>
        <tbody>${comps(result.markets.set_score) || '<tr><td colspan="3">none</td></tr>'}</tbody></table>
      ${missing ? `<p class="meta-line" style="margin-top:10px"><strong>Not sourced</strong></p><ul class="miss">${missing}</ul>` : ''}
      ${(result.flags || []).length ? `<p class="meta-line">${result.flags.map((f) => esc(f)).join(' · ')}</p>` : ''}
    </div>
  </div>`;
}

function wireDetail(root) {
  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
    const tip = tipsForMatch(b.dataset.copy).find((t) => t.market === b.dataset.market) || tipsForMatch(b.dataset.copy)[0];
    if (!tip?.ok) return;
    const ok = await copyText(tip.text.replace(/\*\*/g, ''));
    toast(ok ? 'Tip copied to clipboard' : 'Copy failed — select the text manually');
  }));
}

function renderRail() {
  const published = (state.written?.tips || []).filter((t) => t.ok && !t.skip);
  const el = $('#rail-preds');
  if (!published.length) {
    el.innerHTML = '<div class="card-body meta-line">No selection cleared the method’s thresholds on this card — missing odds, H2H or attacking rates are disclosed rather than guessed.</div>';
  } else {
    el.innerHTML = published.slice(0, 10).map((t) => `
      <div class="rail-item">
        <span class="r-body">
          <span class="r-sel">${esc(t.selection || '')}</span>
          <span class="badge ${esc(t.band)}" style="margin-left:6px">${esc(t.band)}</span>
          <div class="r-match">${esc(t.match)} · ${esc(t.marketLabel)}</div>
        </span>
      </div>`).join('');
  }
  const withheld = (state.written?.tips || []).filter((t) => t.skip).length;
  $('#rail-count').textContent = `${published.length} published · ${withheld} skipped`;
}

function renderOlbgBox() {
  const box = $('#olbg-box');
  if (!box) return;
  const events = state.docs.slate?.events || [];
  const body = box.querySelector('.card-body') || box;
  if (!events.length) {
    body.innerHTML = `<span class="meta-line">No OLBG slate committed yet. <a href="${OLBG_VB}" target="_blank" rel="noopener noreferrer">Open the index ↗</a></span>`;
    return;
  }
  body.innerHTML = events.map((e) => `
    <div class="olbg-row">
      <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(e.event_name || `${e.home} v ${e.away}`)}</strong></a>
      <div class="meta-line">${esc(e.consensus?.market || 'Win Match')}: ${esc(e.consensus?.selection || '—')} · ${e.consensus?.tips_for ?? 0}/${e.consensus?.tips_total ?? 0} tips (display only)</div>
    </div>`).join('') +
    `<div class="meta-line" style="margin-top:8px"><a href="${OLBG_VB}" target="_blank" rel="noopener noreferrer">All OLBG volleyball markets ↗</a>. Tipster consensus is never fed into scoring.</div>`;
}

function renderCoverage() {
  const el = $('#coverage');
  if (!el) return;
  const tapeN = state.tape.length;
  const irr = state.docs.provenance?.irregularities || [];
  el.innerHTML = `
    <ul style="margin:0;padding-left:16px">
      <li>EuroVolley tape: ${tapeN} sourced matches</li>
      <li>Committed upcoming: ${(state.docs.matches?.matches || []).length}</li>
      <li>OLBG snapshot: ${(state.docs.slate?.events || []).length} events</li>
      <li>${irr.length} irregularities (${irr.filter((i) => i.status === 'open').length} open)</li>
    </ul>
    <p style="margin-bottom:0"><a href="sources.html#volleyball">Volleyball register →</a></p>`;
}

function renderMeta() {
  const cs = cacheStats();
  $('#meta').innerHTML = `
    <span>${(state.card?.matches || []).length} matches</span>
    <span>${state.card?.results?.length || 0} scored</span>
    <span>loaded ${relTime(state.loadedAt)}</span>
    <span>cache <code>${cs.entries} entries / ${cs.kb} KB</code></span>
    ${state.errors.length ? `<span style="color:var(--accent)">${state.errors.length} feed errors</span>` : ''}`;
}

function wireControls() {
  $('#prev-day').addEventListener('click', () => loadDate(addDays(state.date, -1), true));
  $('#next-day').addEventListener('click', () => loadDate(addDays(state.date, 1), true));
  $('#today-btn').addEventListener('click', () => loadDate(todayISO(), true));
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) loadDate(e.target.value, true); });
  $('#cal-prev').addEventListener('click', () => {
    state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1));
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1));
    renderCalendar();
  });
  $('#league-filter').addEventListener('change', (e) => {
    state.leagueFilter = e.target.value;
    renderBoard();
    renderRail();
  });
  $$('#phase-filter button').forEach((b) => b.addEventListener('click', () => {
    $$('#phase-filter button').forEach((x) => x.classList.toggle('on', x === b));
    state.phase = b.dataset.phase;
    renderBoard();
    renderRail();
  }));
  let t = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.search = e.target.value; renderBoard(); renderRail(); }, 150);
  });

  $('#generate').addEventListener('click', () => {
    const btn = $('#generate');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Generating…';
    requestAnimationFrame(() => {
      try {
        const n = scoreAll();
        renderBoard();
        renderRail();
        renderMeta();
        const published = (state.written?.tips || []).filter((x) => x.ok && !x.skip).length;
        const skipped = (state.written?.tips || []).filter((x) => x.skip).length;
        toast(`${published} predictions generated from ${n} matches (${skipped} skipped)`);
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
    const text = buildVolleyballFormattedCardText(state.card?.results || [], state.date);
    if (!text.includes('WIN MATCH') && !text.includes('SKIP')) { toast('Nothing to copy'); return; }
    const ok = await copyText(text);
    toast(ok ? 'Copied volleyball card' : 'Copy failed');
  });

  $('#refresh').addEventListener('click', () => {
    clearCache();
    toast('Cache cleared — refetching');
    loadDate(state.date, true);
  });
}

boot().catch((e) => {
  console.error(e);
  const b = $('#board');
  if (b) b.innerHTML = `<div class="note bad">The volleyball page failed to start: ${esc(e.message)}.</div>`;
});
