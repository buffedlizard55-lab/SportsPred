/**
 * SportsPred — GAA page (gaa.html).
 *
 *   data/gaa_slate.json           OLBG football markets
 *   data/gaa_hurling_slate.json   OLBG hurling markets
 *   data/gaa_results.json         printed All-Ireland scorelines
 *   data/gaa_rankings.json        2026 championship pedigree
 *   data/gaa_provenance.json      irregularity register
 */

import { getSport } from '../../engine/registry.js';
import { prepareFixture, fixturesFromSlate } from '../../engine/gaa_data.js';
import { scoreMatch } from '../../engine/gaa_engine.js';
import { writeGaaCard, writePrediction, buildCopyText } from '../../engine/gaa_writer.js';
import { settleFixture, scoreTapeLeans } from '../../engine/gaa_card.js';
import { loadStatic, clearCache, addDays } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, renderShell, renderFooter, toast, copyText, qs, setQS,
} from './ui.js';

const OLBG_FB = 'https://www.olbg.com/betting-tips/Gaelic_Football/25';
const OLBG_H = 'https://www.olbg.com/betting-tips/Hurling/26';
const GAA_IE = 'https://www.gaa.ie/fixtures-results';
const WIKI = 'https://en.wikipedia.org/wiki/2026_All-Ireland_Senior_Football_Championship';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  code: qs('code', 'all'),
  statusFilter: 'all',
  search: '',
  docs: null,
  fixtures: [],
  tape: [],
  scored: [],
  tapeScored: [],
  written: null,
  tipByMatch: new Map(),
  settlements: new Map(),
  calMonth: null,
  generated: false,
};

async function boot() {
  state.sport = getSport('gaelic-football');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'gaelic-football', activePage: 'gaa.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  await loadDay();
}

function renderStatic() {
  $('#page-title').textContent = state.sport.name;
  const links = [...(state.sport?.officialLinks || [])]
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`)
    .join(' · ');
  $('#sport-links').innerHTML = links;
  if (state.sport?.notes?.length) {
    $('#sport-notes').innerHTML = state.sport.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('');
  }
  const tabs = $('#league-tabs');
  tabs.innerHTML = [
    { id: 'all', label: 'All codes' },
    { id: 'football', label: 'Football' },
    { id: 'hurling', label: 'Hurling' },
  ].map((t) => `<button class="day ${state.code === t.id ? 'on' : ''}" data-code="${t.id}">
      <span class="dow">${esc(t.label)}</span></button>`).join('');
  $$('#league-tabs .day').forEach((b) => b.addEventListener('click', () => {
    state.code = b.dataset.code;
    setQS({ date: state.date, code: state.code === 'all' ? null : state.code });
    renderStatic();
    renderBoard();
    renderRail();
    renderCalendar();
  }));
  renderOlbgBox();
}

function scoreSlate(slate, code, asOfISO) {
  const fx = fixturesFromSlate(slate || { events: [] }, { code });
  return fx.map((f) => {
    const prep = prepareFixture(f, {
      tape: state.docs.tape || { matches: [] },
      rankings: state.docs.rankings || { entries: [] },
      asOfISO,
    });
    return scoreMatch(prep.match, {
      profiles: prep.profiles,
      h2h: prep.h2h,
      roundTier: prep.roundTier,
      dateISO: f.dateISO,
      asOfISO,
      rankA: prep.match.teamA.rank,
      rankB: prep.match.teamB.rank,
      code,
    });
  });
}

async function loadDocs() {
  const [slate, hurling, tape, rankings, provenance, predictions, backtest] = await Promise.all([
    loadStatic('data/gaa_slate.json'),
    loadStatic('data/gaa_hurling_slate.json'),
    loadStatic('data/gaa_results.json'),
    loadStatic('data/gaa_rankings.json'),
    loadStatic('data/gaa_provenance.json'),
    loadStatic('data/gaa_predictions.json'),
    loadStatic('data/gaa_backtest.json'),
  ]);
  state.docs = {
    slate: slate?.data || null,
    hurlingSlate: hurling?.data || null,
    tape: tape?.data || null,
    rankings: rankings?.data || null,
    provenance: provenance?.data || null,
    predictions: predictions?.data || null,
    backtest: backtest?.data || null,
  };
  state.tape = state.docs.tape?.matches || [];
  const asOfISO = state.docs.slate?.as_of_utc?.slice(0, 10) || null;
  state.scored = [
    ...scoreSlate(state.docs.slate, 'football', asOfISO),
    ...scoreSlate(state.docs.hurlingSlate, 'hurling', asOfISO),
  ];
  const tapeCard = scoreTapeLeans({
    tape: state.docs.tape || { matches: [] },
    rankings: state.docs.rankings || { entries: [] },
  }, { asOfISO });
  state.tapeScored = tapeCard.scored || [];

  state.written = writeGaaCard(state.scored, { date: asOfISO });
  state.tipByMatch = new Map();
  (state.written?.predictions || []).forEach((p) => state.tipByMatch.set(p.matchId, p));
  state.tapeScored.forEach((s, i) => {
    if (!state.tipByMatch.has(s.matchId)) {
      state.tipByMatch.set(s.matchId, writePrediction(s, { openerIdx: i, angleIdx: i }));
    }
  });
  for (const m of [...state.scored, ...state.tapeScored]) {
    state.settlements.set(m.matchId, settleFixture(m, state.docs.tape || { matches: [] }));
  }
  state.generated = true;
  renderCoverage();
  renderSources();
}

function codeOk(s) {
  if (state.code === 'all') return true;
  return (s.code || 'football') === state.code;
}

function matchesFor(iso) {
  const out = [];
  const seen = new Set();
  for (const s of state.tapeScored) {
    if (s.dateISO === iso && codeOk(s)) {
      out.push({ kind: 'result', row: s });
      seen.add(s.matchId);
    }
  }
  for (const m of state.tape) {
    const d = m.date || m.event_end || null;
    if (d === iso && !seen.has(m.id) && (state.code === 'all' || (m.code || 'football') === state.code)) {
      out.push({ kind: 'tape', row: m });
    }
  }
  for (const s of state.scored) {
    if (s.dateISO === iso && codeOk(s)) out.push({ kind: 'fixture', row: s });
  }
  return out;
}

async function loadDay() {
  setQS({ date: state.date, code: state.code === 'all' ? null : state.code });
  $('#day-title').textContent = fmtDateLong(state.date);
  $('#date-input').value = state.date;
  renderBoard();
  renderCalendar();
  renderRail();
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  return matchesFor(state.date).filter((m) => {
    if (state.statusFilter === 'scheduled' && m.kind !== 'fixture') return false;
    if (state.statusFilter === 'result' && m.kind === 'fixture') return false;
    if (state.statusFilter === 'selected' && m.kind === 'tape') return false;
    if (q) {
      const hay = m.kind === 'tape'
        ? `${m.row.team_a?.name} ${m.row.team_b?.name} ${m.row.event}`
        : `${m.row.matchTitle || ''} ${m.row.event} ${m.row.round || ''}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const list = filtered();
  const board = $('#board');
  const nFx = state.scored.filter((s) => s.dateISO === state.date && codeOk(s)).length;
  const nRes = state.tape.filter((m) => (m.date || m.event_end) === state.date).length;
  $('#counts').textContent = `${list.length} shown · ${nRes} result${nRes === 1 ? '' : 's'} · ${nFx} upcoming · source: committed verified data`;

  if (!list.length) {
    board.innerHTML = '<div class="empty">No GAA matches on this date in the committed window. Club championships on the OLBG slate sit on 5–6 September 2026; All-Ireland football finals on the tape sit in May–July. Pick a highlighted day on the calendar.</div>';
    return;
  }
  board.innerHTML = list.map(matchCard).join('');
  $$('.copy-tip', board).forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tip = state.tipByMatch.get(btn.dataset.match);
    if (!tip) return;
    const ok = await copyText(tipText(tip));
    toast(ok ? 'Prediction copied to clipboard' : 'Copy failed — select the text manually');
  }));
}

function confBadge(band) {
  return `<span class="badge ${esc(band)}">${esc(band)}</span>`;
}

function matchCard(m) {
  if (m.kind === 'tape') {
    const r = m.row;
    const a = r.team_a?.name || '?';
    const b = r.team_b?.name || '?';
    const winner = r.winner;
    const star = (n) => (n === winner ? ' ⭐' : '');
    const score = r.scoreline || `${r.total_a}-${r.total_b}`;
    return `
    <div class="race">
      <div class="race-head">
        <div class="race-id">
          <div class="race-title"><strong>${esc(score)}</strong> ${esc(a)}${star(a)} v ${esc(b)}${star(b)} <span class="badge SKIP">RESULT</span></div>
          <div class="meta-line">${esc(r.event || '')} · ${esc(r.round || '')} · ${esc(r.code || 'football')}</div>
        </div>
        <div class="race-pick"><strong>Winner:</strong> ${esc(winner || '—')}</div>
        <div class="race-toggle">▾</div>
      </div>
      <div class="race-body">
        <div class="analysis">
          <details>
            <summary>Result details &amp; sources</summary>
            ${resultReviewLinks(r)}
          </details>
        </div>
      </div>
    </div>`;
  }

  const s = m.row;
  const tip = state.tipByMatch.get(s.matchId);
  const settlement = state.settlements.get(s.matchId);
  const isResult = m.kind === 'result' || settlement?.settled;
  const status = isResult
    ? `<span class="badge SKIP">RESULT</span>`
    : `<span class="badge MEDIUM">UPCOMING</span>`;
  const pickLine = settlement?.settled
    ? `<strong>Result:</strong> ${esc(settlement.actualWinner)} ${esc(settlement.score)} · lean ${esc(s.leanName)} ${settlement.predicted ? '✓' : '✗'}`
    : `<strong>Model lean:</strong> <strong class="sel">${esc(s.leanName)}</strong> · ${confBadge(s.confidence.band)}`;

  return `
  <div class="race" data-match="${esc(s.matchId)}">
    <div class="race-head">
      <div class="race-id">
        <div class="race-title"><strong>${esc(s.matchTitle)}</strong> ${status} <span class="meta-line">${esc(s.code || '')}</span></div>
        <div class="meta-line">${esc(s.event || '')} · ${esc(s.round || '')}</div>
      </div>
      <div class="race-pick">${pickLine}</div>
      <div class="race-toggle">▾</div>
    </div>
    <div class="race-body">
      ${tip ? `
        <div class="tip-box">
          <div class="tip-text">${formatTip(tip.paragraph)}</div>
          ${tip.dataGapNote ? `<p class="meta-line"><em>${esc(tip.dataGapNote)}</em></p>` : ''}
          <div class="tip-actions">
            <button class="btn sm copy-tip" data-match="${esc(s.matchId)}">📋 Copy prediction</button>
          </div>
        </div>` : ''}
      ${analysisPanel(s)}
    </div>
  </div>`;
}

function resultReviewLinks(r) {
  const urls = r.source_urls || [];
  const links = urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname)} ↗</a>`);
  return `<div class="meta-line"><strong>Review links:</strong> ${links.join(' · ') || '—'}</div>`;
}

function analysisPanel(s) {
  const rows = s.players.map((p) => `
    <tr class="side">
      <td colspan="3"><strong>${esc(p.name)}</strong> · ${p.score} pts</td>
    </tr>
    ${(p.components || []).map((c) => `
      <tr class="${c.missing ? 'missing' : ''}">
        <td>${esc(c.label)}</td>
        <td class="mono">${c.missing && c.points === 0 ? 'n/a' : (c.points > 0 ? '+' : '') + c.points}</td>
        <td class="meta-line">${esc(c.detail || '')}${c.missing ? ' — not available from a free source' : ''}</td>
      </tr>`).join('')}`).join('');
  const missing = (s.missing || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const review = (s.sourceUrls || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname)} ↗</a>`)
    .concat([GAA_IE, WIKI, OLBG_FB, OLBG_H].map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname)} ↗</a>`))
    .join(' · ');
  return `
  <div class="analysis">
    <details>
      <summary>Analysis — ${esc(s.leanName)} · rules fired and sources</summary>
      <table class="components"><thead><tr><th>Factor</th><th>Pts</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="meta-line"><strong>Aligned factors:</strong> ${esc(s.aligned.join(', ') || 'none')} · <strong>Decision:</strong> ${esc(s.decision.bet)}${s.drawPossible ? ' · draw flagged' : ''}</div>
      ${missing ? `<div class="meta-line"><strong>Not sourced:</strong><ul>${missing}</ul></div>` : ''}
      <div class="meta-line"><strong>Review links:</strong> ${review}</div>
    </details>
  </div>`;
}

function formatTip(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function tipText(tip) {
  return [tip.verdict, tip.paragraph, `Bet type: ${tip.betType}`, tip.dataGapNote || ''].filter(Boolean).join('\n');
}

function renderRail() {
  const el = $('#rail-preds');
  const todays = [...state.scored, ...state.tapeScored].filter((s) => s.dateISO === state.date && codeOk(s));
  if (!todays.length) {
    el.innerHTML = '<div class="card-body meta-line">No fixtures on this date — pick a highlighted day on the calendar.</div>';
  } else {
    el.innerHTML = todays.map((s) => `
      <div class="rail-pick">
        <div><strong>${esc(s.matchTitle)}</strong></div>
        <div>${confBadge(s.confidence.band)} <strong>${esc(s.leanName)}</strong> <span class="meta-line">${esc(s.decision.bet)}</span></div>
      </div>`).join('');
  }
  $('#rail-count').textContent = `${todays.length} fixture${todays.length === 1 ? '' : 's'} on this date · every prediction is 40+ words, uniquely written, source-grounded.`;
}

function renderOlbgBox() {
  const box = $('#olbg-box');
  if (!box) return;
  const body = $('.card-body', box);
  Promise.all([loadStatic('data/gaa_slate.json'), loadStatic('data/gaa_hurling_slate.json')]).then(([fb, h]) => {
    const events = [...(fb?.data?.events || []), ...(h?.data?.events || [])];
    if (!events.length) { body.innerHTML = '<span class="meta-line">No OLBG slate committed yet.</span>'; return; }
    body.innerHTML = events.map((e) => {
      const c = e.consensus || {};
      return `
        <div class="olbg-row">
          <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(e.matchup || e.event_id)}</strong></a>
          <div class="meta-line">${esc(e.code || '')} · ${esc(e.display_date_label || '')} ${esc(e.display_time || '')} · ${esc(e.type || 'match')}</div>
          ${c.selection ? `<div class="meta-line"><strong>${esc(c.market || 'Consensus')}:</strong> ${esc(c.selection)} ${c.tips_for != null ? `${c.tips_for}/${c.tips_total}` : ''}${c.pct != null ? ` (${c.pct}%)` : ''}</div>` : ''}
        </div>`;
    }).join('')
    + `<div class="meta-line" style="margin-top:8px"><a href="${OLBG_FB}" target="_blank" rel="noopener noreferrer">OLBG football ↗</a> · <a href="${OLBG_H}" target="_blank" rel="noopener noreferrer">OLBG hurling ↗</a>. Votes are display-only.</div>`;
  });
}

function renderCoverage() {
  const tape = state.docs?.tape?.matches || [];
  const ranks = state.docs?.rankings?.entries || [];
  const window = state.docs?.slate?.as_of_utc || '—';
  const bt = state.docs?.backtest;
  $('#coverage').innerHTML = `
    <ul style="margin:0;padding-left:16px">
      <li>Verified tape rows: ${tape.length} (printed All-Ireland scorelines only)</li>
      <li>Pedigree ranks: ${ranks.length} counties</li>
      <li>OLBG football events: ${(state.docs?.slate?.events || []).length}</li>
      <li>OLBG hurling events: ${(state.docs?.hurlingSlate?.events || []).length}</li>
      <li>Slate refreshed: ${esc(window)}</li>
      <li>Backtest rows: ${bt?.events || 0}${bt?.summary?.[0]?.hitRate != null ? ` · lean hit rate ${(bt.summary[0].hitRate * 100).toFixed(1)}%` : ''}</li>
    </ul>
    <p style="margin-bottom:0">No free key-less price feed exists, so live bets resolve to SKIP. <a href="sources.html#gaa-irr">Irregularity register →</a></p>`;
}

function renderSources() {
  const irr = state.docs?.provenance?.register || [];
  $('#sources').innerHTML = `
    <p style="margin-top:0"><a href="${GAA_IE}" target="_blank" rel="noopener noreferrer">GAA fixtures ↗</a><br>
    <a href="${WIKI}" target="_blank" rel="noopener noreferrer">2026 All-Ireland SFC ↗</a><br>
    <a href="${OLBG_FB}" target="_blank" rel="noopener noreferrer">OLBG football ↗</a><br>
    <a href="${OLBG_H}" target="_blank" rel="noopener noreferrer">OLBG hurling ↗</a></p>
    <p style="margin-bottom:0">${irr.length} logged irregularities (${irr.filter((i) => i.status === 'open').length} open). <a href="sources.html#gaa-irr">View register →</a></p>`;
}

function renderCalendar() {
  const month = state.calMonth;
  const y = month.getUTCFullYear(); const m = month.getUTCMonth();
  $('#cal-title').textContent = month.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const first = new Date(Date.UTC(y, m, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const counts = new Map();
  for (const r of state.tape) {
    const d = r.date || r.event_end;
    if (d && (state.code === 'all' || (r.code || 'football') === state.code)) counts.set(d, (counts.get(d) || 0) + 1);
  }
  for (const s of state.scored) {
    if (s.dateISO && codeOk(s)) counts.set(s.dateISO, (counts.get(s.dateISO) || 0) + 1);
  }
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<span class="cell other"></span>');
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = counts.get(iso) || 0;
    cells.push(`<button class="cell ${iso === todayISO() ? 'today' : ''} ${iso === state.date ? 'on' : ''} ${n ? '' : 'other'}" data-date="${iso}" title="${iso}: ${n} matches">
      <span class="n">${d}</span>${n ? `<span class="c">${n} match${n === 1 ? '' : 'es'}</span>` : ''}</button>`);
  }
  $('#calgrid').innerHTML = cells.join('');
  $$('#calgrid .cell').forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.date;
    loadDay();
  }));
  renderDatestrip();
}

function renderDatestrip() {
  const strip = $('#datestrip');
  const dates = [-3, -2, -1, 0, 1, 2, 3].map((n) => addDays(state.date, n));
  strip.innerHTML = dates.map((iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    const n = matchesFor(iso).length;
    return `<button class="day ${iso === state.date ? 'on' : ''}" data-date="${iso}">
      <span class="dow">${d.toLocaleString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${d.getUTCDate()}</span>
      ${n ? `<span class="meta-line" style="font-size:10px">${n}</span>` : '<span class="dot" style="visibility:hidden"></span>'}</button>`;
  }).join('');
  $$('.day', strip).forEach((b) => b.addEventListener('click', () => { state.date = b.dataset.date; loadDay(); }));
}

function wireControls() {
  $('#prev-day').addEventListener('click', () => { state.date = addDays(state.date, -1); loadDay(); });
  $('#next-day').addEventListener('click', () => { state.date = addDays(state.date, 1); loadDay(); });
  $('#today-btn').addEventListener('click', () => { state.date = todayISO(); loadDay(); });
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; loadDay(); } });
  $('#cal-prev').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1)); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1)); renderCalendar(); });
  $('#status-filter').addEventListener('change', (e) => { state.statusFilter = e.target.value; renderBoard(); });
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); });
  $('#refresh').addEventListener('click', async () => {
    clearCache();
    toast('Cache cleared — reloading committed GAA data…');
    await loadDocs();
    await loadDay();
  });

  $('#generate').addEventListener('click', async () => {
    const btn = $('#generate');
    btn.disabled = true;
    $('#progress').style.display = '';
    $('#progress-label').textContent = 'Scoring every fixture and writing the predictions…';
    await new Promise((r) => setTimeout(r, 30));
    try {
      await loadDocs();
      await loadDay();
      renderOlbgBox();
      const n = matchesFor(state.date).length;
      toast(`Generated ${n} written prediction${n === 1 ? '' : 's'} for ${fmtDateLong(state.date)}`);
    } finally {
      btn.disabled = false;
      $('#progress').style.display = 'none';
    }
  });

  $('#copy-all').addEventListener('click', async () => {
    const preds = [...state.tipByMatch.values()].filter((p) => p.dateISO === state.date);
    if (!preds.length) { toast('No generated predictions to copy'); return; }
    const text = buildCopyText({
      predictions: preds,
      summaryTable: {
        headers: ['Match', 'Code / round', 'Selection', 'Confidence', 'Bet type'],
        rows: preds.map((p) => [p.matchTitle, `${p.code || ''} · ${p.round || ''}`, p.leanName, p.confidence.band, p.betType]),
      },
      responsibleGambling: state.written?.responsibleGambling,
    });
    const ok = await copyText(text);
    toast(ok ? `Copied ${preds.length} predictions + summary table` : 'Copy failed');
  });
}

boot().catch((err) => {
  console.error(err);
  $('#board').innerHTML = `<div class="empty">Failed to load the GAA layer: ${esc(err.message)}. The committed data may be missing; CI repopulates it.</div>`;
});
