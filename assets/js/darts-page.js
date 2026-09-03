/**
 * SportsPred — darts page controller (darts.html).
 *
 * Darts has no ESPN feed and no free key-less price feed: the data layer is
 * the committed source-linked documents built in CI —
 *
 *   data/darts_slate.json       OLBG markets (display only, no prices)
 *   data/darts_results.json     verified results tape (Wikipedia ET draw)
 *   data/darts_rankings.json    PDC Order of Merit snapshot
 *   data/darts_provenance.json  irregularity register
 *   data/darts_predictions.json forward ledger
 *   data/darts_backtest.json    walk-forward lean report
 *
 * Historical leans are scored leak-free from the tape so a results day still
 * carries a written, source-grounded prediction.
 */

import { getSport } from '../../engine/registry.js';
import { prepareFixture, fixturesFromSlate } from '../../engine/darts_data.js';
import { scoreMatch } from '../../engine/darts_engine.js';
import { writeDartsCard, writePrediction, buildCopyText } from '../../engine/darts_writer.js';
import { settleFixture, scoreTapeLeans } from '../../engine/darts_card.js';
import { loadStatic, clearCache, addDays } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, renderShell, renderFooter, toast, copyText, qs, setQS,
} from './ui.js';

const PDC = 'https://www.pdc.tv/';
const PDC_PLAYERS = 'https://www.pdc.tv/players';
const RANKINGS = 'https://www.dartsrankings.com/';
const WIKI_HDT = 'https://en.wikipedia.org/wiki/2026_Hungarian_Darts_Trophy';
const OLBG_DARTS = 'https://www.olbg.com/betting-tips/Darts/15';

const state = {
  sport: null,
  date: qs('date', todayISO()),
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
  state.sport = getSport('darts');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'darts', activePage: 'darts.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  await loadDay();
}

function renderStatic() {
  $('#page-title').textContent = state.sport.name;
  const links = [...(state.sport?.officialLinks || []), { label: 'dartsrankings.com Order of Merit', url: RANKINGS }]
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`)
    .join(' · ');
  $('#sport-links').innerHTML = links;
  if (state.sport?.notes?.length) {
    $('#sport-notes').innerHTML = state.sport.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('');
  }
  renderOlbgBox();
}

async function loadDocs() {
  const [slate, tape, rankings, provenance, predictions, backtest] = await Promise.all([
    loadStatic('data/darts_slate.json'),
    loadStatic('data/darts_results.json'),
    loadStatic('data/darts_rankings.json'),
    loadStatic('data/darts_provenance.json'),
    loadStatic('data/darts_predictions.json'),
    loadStatic('data/darts_backtest.json'),
  ]);
  state.docs = {
    slate: slate?.data || null,
    tape: tape?.data || null,
    rankings: rankings?.data || null,
    provenance: provenance?.data || null,
    predictions: predictions?.data || null,
    backtest: backtest?.data || null,
  };
  state.tape = state.docs.tape?.matches || [];
  const asOfISO = state.docs.slate?.as_of_utc?.slice(0, 10) || null;
  const fx = fixturesFromSlate(state.docs.slate || { events: [] });
  state.scored = fx.map((f) => {
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
      rankA: prep.match.playerA.rank,
      rankB: prep.match.playerB.rank,
    });
  });
  const tapeCard = scoreTapeLeans({
    tape: state.docs.tape || { matches: [] },
    rankings: state.docs.rankings || { entries: [] },
  }, { asOfISO });
  state.tapeScored = tapeCard.scored || [];

  const combined = [...state.scored, ...state.tapeScored];
  state.written = writeDartsCard(state.scored, { date: asOfISO });
  // Historical leans are written individually so a long tape cannot trip the
  // per-card unique-opener rule (14 openers vs 30+ matches).
  state.tipByMatch = new Map();
  (state.written?.predictions || []).forEach((p) => state.tipByMatch.set(p.matchId, p));
  state.tapeScored.forEach((s, i) => {
    if (!state.tipByMatch.has(s.matchId)) {
      state.tipByMatch.set(s.matchId, writePrediction(s, { openerIdx: i, angleIdx: i }));
    }
  });
  for (const m of combined) {
    state.settlements.set(m.matchId, settleFixture(m, state.docs.tape || { matches: [] }));
  }
  state.generated = true;
  renderCoverage();
  renderSources();
}

function matchesFor(iso) {
  const out = [];
  const seen = new Set();
  for (const s of state.tapeScored) {
    if (s.dateISO === iso) {
      out.push({ kind: 'result', row: s });
      seen.add(s.matchId);
    }
  }
  for (const m of state.tape) {
    const d = m.date || m.event_end || null;
    if (d === iso && !seen.has(m.id)) out.push({ kind: 'tape', row: m });
  }
  for (const s of state.scored) {
    if (s.dateISO === iso) out.push({ kind: 'fixture', row: s });
  }
  return out;
}

async function loadDay() {
  setQS({ date: state.date });
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
        ? `${m.row.player_a?.name} ${m.row.player_b?.name} ${m.row.event} ${m.row.venue || ''}`
        : `${m.row.matchTitle || ''} ${m.row.event} ${m.row.venue || ''} ${m.row.round || ''}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const list = filtered();
  const board = $('#board');
  const nFx = state.scored.filter((s) => s.dateISO === state.date).length;
  const nRes = state.tape.filter((m) => (m.date || m.event_end) === state.date).length;
  $('#counts').textContent = `${list.length} shown · ${nRes} result${nRes === 1 ? '' : 's'} · ${nFx} upcoming · source: committed verified data`;

  if (!list.length) {
    board.innerHTML = '<div class="empty">No darts matches on this date. The committed window covers the Hungarian Darts Trophy (28–30 Aug 2026); the Czech Darts Open (4–6 Sep) has no published pairings yet. Pick a highlighted day on the calendar.</div>';
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
  $$('.copy-analysis', board).forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(analysisText(btn.dataset.match));
    toast(ok ? 'Analysis copied' : 'Copy failed');
  }));
}

function confBadge(band) {
  return `<span class="badge ${esc(band)}">${esc(band)}</span>`;
}

function matchCard(m) {
  if (m.kind === 'tape') {
    const r = m.row;
    const a = r.player_a?.name || '?';
    const b = r.player_b?.name || '?';
    const winner = r.winner;
    const star = (n) => (n === winner ? ' ⭐' : '');
    const score = `${r.score_a}-${r.score_b}`;
    const round = r.round || '';
    return `
    <div class="race">
      <div class="race-head">
        <div class="race-id">
          <div class="race-title"><strong>${score}</strong> ${esc(a)}${star(a)} v ${esc(b)}${star(b)} <span class="badge SKIP">RESULT</span></div>
          <div class="meta-line">${esc(r.event || '')} · ${esc(round)} · ${esc((r.venue) || '')}</div>
        </div>
        <div class="race-pick"><strong>Winner:</strong> ${esc(winner || '—')}</div>
        <div class="race-toggle">▾</div>
      </div>
      <div class="race-body">
        <div class="analysis">
          <details>
            <summary>Result details &amp; sources</summary>
            <div class="meta-line"><strong>Score:</strong> ${esc(score)} · <strong>Round:</strong> ${esc(round)}</div>
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
    : `<strong>Model lean:</strong> <strong class="sel">${esc(s.leanName)}</strong> · ${s.score}/100 · ${confBadge(s.confidence.band)}`;

  return `
  <div class="race" data-match="${esc(s.matchId)}">
    <div class="race-head">
      <div class="race-id">
        <div class="race-title"><strong>${esc(s.matchTitle)}</strong> ${status}</div>
        <div class="meta-line">${esc(s.event || '')} · ${esc(s.round || '')} · ${esc(s.venue || '')} · best of ${esc(s.bestOf || '11')}</div>
      </div>
      <div class="race-pick">${pickLine}</div>
      <div class="race-toggle">▾</div>
    </div>
    <div class="race-body">
      ${tip ? `
        <div class="tip-box">
          <div class="tip-text">${formatTip(tip.paragraph)}</div>
          <div class="tip-actions">
            <button class="btn sm copy-tip" data-match="${esc(s.matchId)}">📋 Copy prediction</button>
            <button class="btn sm copy-analysis" data-match="${esc(s.matchId)}">Copy analysis</button>
          </div>
        </div>` : ''}
      ${analysisPanel(s, tip)}
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
      <td colspan="3"><strong>${esc(p.name)}</strong> ${p.rank ? `<span class="meta-line">OoM ${esc(p.rank)}</span>` : '<span class="meta-line">unranked</span>'} · ${p.score} pts</td>
    </tr>
    ${(p.components || []).map((c) => `
      <tr class="${c.missing ? 'missing' : ''}">
        <td>${esc(c.label)}${c.max && c.max > 0 ? ` <span class="meta-line">/ ${c.max}</span>` : ''}</td>
        <td class="mono">${c.missing ? 'n/a' : (c.points > 0 ? '+' : '') + c.points}</td>
        <td class="meta-line">${esc(c.detail || '')}${c.missing ? ' — not available from a free source' : ''}</td>
      </tr>`).join('')}`).join('');
  const missing = (s.missing || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const review = (s.sourceUrls || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname)} ↗</a>`)
    .concat([RANKINGS, WIKI_HDT, OLBG_DARTS].map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname)} ↗</a>`))
    .join(' · ');
  return `
  <div class="analysis">
    <details>
      <summary>Analysis — ${esc(s.leanName)} · ${s.score}/100 · rules fired and sources</summary>
      <table class="components"><thead><tr><th>Factor</th><th>Pts</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="meta-line"><strong>Aligned factors:</strong> ${esc(s.aligned.join(', ') || 'none')} · <strong>Gap:</strong> ${s.gap} pts · <strong>Decision:</strong> ${esc(s.decision.bet)}</div>
      ${missing ? `<div class="meta-line"><strong>Not sourced:</strong><ul>${missing}</ul></div>` : ''}
      <div class="meta-line"><strong>Review links:</strong> ${review}</div>
    </details>
  </div>`;
}

function formatTip(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function tipText(tip) {
  return [tip.verdict, tip.paragraph, `Bet type: ${tip.betType}`].join('\n');
}

function analysisText(matchId) {
  const s = [...state.scored, ...state.tapeScored].find((x) => x.matchId === matchId);
  if (!s) return '';
  const tip = state.tipByMatch.get(matchId);
  const lines = [
    `${s.matchTitle} — ${s.event} · ${s.round} · ${s.dateISO}`,
    tip && tip.verdict ? tip.verdict.replace(/\*\*/g, '') : 'NO PREDICTION',
    tip ? tip.paragraph.replace(/\*\*/g, '') : '',
    '',
    'Player scores:',
    ...s.players.map((p) => `  ${p.name}${p.rank ? ` (rank ${p.rank})` : ' (unranked)'}: ${p.score} pts`),
    '',
    `Aligned: ${s.aligned.join(', ') || 'none'}`,
    `Missing: ${s.missing.join('; ') || 'none'}`,
    `Decision: ${s.decision.bet}`,
    '',
    'Review links:',
    ...(s.sourceUrls || []),
  ];
  return lines.join('\n');
}

function renderRail() {
  const el = $('#rail-preds');
  const todays = [...state.scored, ...state.tapeScored].filter((s) => s.dateISO === state.date);
  if (!todays.length) {
    el.innerHTML = '<div class="card-body meta-line">No fixtures on this date — pick a highlighted day on the calendar.</div>';
  } else {
    el.innerHTML = todays.map((s) => `
      <div class="rail-pick">
        <div><strong>${esc(s.matchTitle)}</strong></div>
        <div>${confBadge(s.confidence.band)} <strong>${esc(s.leanName)}</strong> <span class="meta-line">${s.score}/100 · ${esc(s.decision.bet)}</span></div>
      </div>`).join('');
  }
  $('#rail-count').textContent = `${todays.length} fixture${todays.length === 1 ? '' : 's'} on this date · every prediction is 25–40 words, uniquely written, source-grounded.`;
}

function renderOlbgBox() {
  const box = $('#olbg-box');
  if (!box) return;
  const body = $('.card-body', box);
  loadStatic('data/darts_slate.json').then((res) => {
    const events = res?.data?.events || [];
    if (!events.length) { body.innerHTML = '<span class="meta-line">No OLBG slate committed yet.</span>'; return; }
    body.innerHTML = events.map((e) => {
      const c = e.consensus || {};
      return `
        <div class="olbg-row">
          <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(e.matchup || e.event_id)}</strong></a>
          <div class="meta-line">${esc(e.tournament || '')} · ${esc(e.display_date_label || '')} ${esc(e.display_time || '')} · ${esc(e.type || 'match')}</div>
          ${c.selection ? `<div class="meta-line"><strong>${esc(c.market || 'Consensus')}:</strong> ${esc(c.selection)} ${c.tips_for != null ? `${c.tips_for}/${c.tips_total}` : ''}${c.pct != null ? ` (${c.pct}%)` : ''}</div>` : ''}
        </div>`;
    }).join('') +
    `<div class="meta-line" style="margin-top:8px"><a href="${OLBG_DARTS}" target="_blank" rel="noopener noreferrer">All OLBG darts markets ↗</a>. Tipster votes are display-only, never fed into scoring.</div>`;
  });
}

function renderCoverage() {
  const tape = state.docs?.tape?.matches || [];
  const ranks = state.docs?.rankings?.entries || [];
  const window = state.docs?.slate?.as_of_utc || '—';
  const bt = state.docs?.backtest;
  $('#coverage').innerHTML = `
    <ul style="margin:0;padding-left:16px">
      <li>Verified tape rows: ${tape.length} (${tape.filter((m) => m.winner).length} decided)</li>
      <li>Official ranking snapshot: ${ranks.length} players</li>
      <li>Slate refreshed: ${esc(window)}</li>
      <li>Ledger records: ${state.docs?.predictions?.predictions?.length || 0}</li>
      <li>Backtest rows: ${bt?.events || 0}${bt?.summary?.[0]?.hitRate != null ? ` · lean hit rate ${(bt.summary[0].hitRate * 100).toFixed(1)}%` : ''}</li>
    </ul>
    <p style="margin-bottom:0">No free key-less price feed exists for darts, so the odds component is scored as missing and live bets resolve to SKIP. <a href="sources.html#darts-irr">Irregularity register →</a></p>`;
}

function renderSources() {
  const irr = state.docs?.provenance?.register || [];
  $('#sources').innerHTML = `
    <p style="margin-top:0"><a href="${PDC}" target="_blank" rel="noopener noreferrer">PDC official site ↗</a><br>
    <a href="${PDC_PLAYERS}" target="_blank" rel="noopener noreferrer">PDC players / Order of Merit ↗</a><br>
    <a href="${RANKINGS}" target="_blank" rel="noopener noreferrer">dartsrankings.com live OoM ↗</a><br>
    <a href="${WIKI_HDT}" target="_blank" rel="noopener noreferrer">2026 Hungarian Darts Trophy ↗</a><br>
    <a href="${OLBG_DARTS}" target="_blank" rel="noopener noreferrer">OLBG darts tips ↗</a></p>
    <p style="margin-bottom:0">${irr.length} logged irregularities (${irr.filter((i) => i.status === 'open').length} open). <a href="sources.html#darts-irr">View register →</a></p>`;
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
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  for (const s of state.scored) {
    if (s.dateISO) counts.set(s.dateISO, (counts.get(s.dateISO) || 0) + 1);
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
    toast('Cache cleared — reloading committed darts data…');
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
        headers: ['Match', 'Event / round', 'Selection', 'Confidence', 'Model score', 'Bet type'],
        rows: preds.map((p) => [p.matchTitle, `${p.event} · ${p.round}`, p.leanName, p.confidence.band, p.confidence.score, p.betType]),
      },
      responsibleGambling: state.written?.responsibleGambling,
    });
    const ok = await copyText(text);
    toast(ok ? `Copied ${preds.length} predictions + summary table` : 'Copy failed');
  });
}

boot().catch((err) => {
  console.error(err);
  $('#board').innerHTML = `<div class="empty">Failed to load the darts layer: ${esc(err.message)}. The committed data may be missing; CI repopulates it.</div>`;
});
