/**
 * SportsPred — snooker page controller (snooker.html).
 *
 * Snooker has no ESPN feed and no free key-less price feed: the data layer is
 * the committed source-linked documents built in CI —
 *
 *   data/snooker_slate.json       OLBG markets (display only, no prices)
 *   data/snooker_results.json     verified results tape (snooker.org + WST)
 *   data/snooker_rankings.json    official WST ranking snapshot
 *   data/snooker_provenance.json  irregularity register
 *   data/snooker_predictions.json forward ledger
 *   data/snooker_backtest.json    walk-forward lean report
 *
 * This controller:
 *   1. loads the committed documents (browser refresh falls back to them),
 *   2. scores every fixture on the slate with the SNOOKER PREDICTION MASTER
 *      PROMPT v3.0 engine and writes the 25-40 word prediction,
 *   3. renders past results + upcoming fixtures with a calendar,
 *   4. auto-generates on load AND on the Generate button (the button always
 *      re-runs scoring and rewrites every prediction),
 *   5. copies tips with one click.
 */

import { getSport } from '../../engine/registry.js';
import { prepareFixture, fixturesFromSlate } from '../../engine/snooker_data.js';
import { scoreMatch } from '../../engine/snooker_engine.js';
import { writeSnookerCard, buildCopyText } from '../../engine/snooker_writer.js';
import { settleFixture } from '../../engine/snooker_card.js';
import { loadStatic, clearCache, addDays } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, renderShell, renderFooter, toast, copyText, qs, setQS,
} from './ui.js';

const WST = 'https://www.wst.tv/';
const WST_RANKINGS = 'https://www.wst.tv/rankings';
const SNOOKER_ORG = 'https://www.snooker.org/res/index.asp';
const OLBG_SNOOKER = 'https://www.olbg.com/betting-tips/Snooker/8';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  statusFilter: 'all',
  search: '',
  docs: null,
  fixtures: [],       // normalised OLBG slate fixtures (all dates)
  tape: [],           // completed matches from the tape
  scored: [],         // scored fixtures
  written: null,      // card writer output
  tipByMatch: new Map(),
  settlements: new Map(),
  calMonth: null,
  generated: false,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('snooker');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'snooker', activePage: 'snooker.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  await loadDay();
}

function renderStatic() {
  $('#page-title').textContent = state.sport.name;
  const links = [...(state.sport?.officialLinks || []), { label: 'snooker.org results', url: SNOOKER_ORG }]
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
    loadStatic('data/snooker_slate.json'),
    loadStatic('data/snooker_results.json'),
    loadStatic('data/snooker_rankings.json'),
    loadStatic('data/snooker_provenance.json'),
    loadStatic('data/snooker_predictions.json'),
    loadStatic('data/snooker_backtest.json'),
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
  // Re-score from committed docs (never from the ledger: the ledger is
  // append-only forward collection and the page must mirror the engine).
  const fx = fixturesFromSlate(state.docs.slate || { events: [] });
  const asOfISO = state.docs.slate?.as_of_utc?.slice(0, 10) || null;
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
  state.written = writeSnookerCard(state.scored, { date: asOfISO });
  state.tipByMatch = new Map((state.written?.predictions || []).map((p) => [p.matchId, p]));
  // Settlements from the tape (matched by the same player-name rule as the ledger).
  for (const m of state.scored) {
    state.settlements.set(m.matchId, settleFixture(m, state.docs.tape || { matches: [] }));
  }
  state.generated = true;
  renderCoverage();
  renderSources();
}

/* ------------------------------------------------------------------ day */

function matchesFor(iso) {
  const out = [];
  for (const m of state.tape) {
    const d = m.date || m.event_end || null;
    if (d === iso) out.push({ kind: 'result', row: m });
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

/* ------------------------------------------------------------------ board */

function filtered() {
  const q = state.search.trim().toLowerCase();
  return matchesFor(state.date).filter((m) => {
    if (state.statusFilter === 'scheduled' && m.kind !== 'fixture') return false;
    if (state.statusFilter === 'result' && m.kind !== 'result') return false;
    if (state.statusFilter === 'selected' && m.kind === 'result') return false;
    if (q) {
      const hay = m.kind === 'result'
        ? `${m.row.player_a?.name} ${m.row.player_b?.name} ${m.row.event} ${m.row.venue || ''}`
        : `${m.row.playerA?.name} ${m.row.playerB?.name} ${m.row.event} ${m.row.venue || ''} ${m.row.round || ''}`;
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
    board.innerHTML = '<div class="empty">No snooker matches on this date. The committed window covers the current season slate; pick a highlighted day on the calendar.</div>';
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
  if (m.kind === 'result') {
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
  const status = settlement?.settled
    ? `<span class="badge SKIP">SETTLED</span>`
    : `<span class="badge MEDIUM">UPCOMING</span>`;
  const pickLine = settlement?.settled
    ? `<strong>Result:</strong> ${esc(settlement.actualWinner)} ${esc(settlement.score)} · lean ${esc(s.leanName)} ${settlement.predicted ? '✓' : '✗'}`
    : `<strong>Model lean:</strong> <strong class="sel">${esc(s.leanName)}</strong> · ${s.score}/100 · ${confBadge(s.confidence.band)}`;

  return `
  <div class="race" data-match="${esc(s.matchId)}">
    <div class="race-head">
      <div class="race-id">
        <div class="race-title"><strong>${esc(s.matchTitle)}</strong> ${status}</div>
        <div class="meta-line">${esc(s.event || '')} · ${esc(s.round || '')} · ${esc(s.venue || '')} · best of ${esc(s.bestOf || '7')}</div>
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

function analysisPanel(s, tip) {
  const rows = s.players.map((p) => `
    <tr class="side">
      <td colspan="3"><strong>${esc(p.name)}</strong> ${p.rank ? `<span class="meta-line">world rank ${esc(p.rank)}</span>` : '<span class="meta-line">unranked</span>'} · ${p.score} pts</td>
    </tr>
    ${(p.components || []).map((c) => `
      <tr class="${c.missing ? 'missing' : ''}">
        <td>${esc(c.label)}${c.max && c.max > 0 ? ` <span class="meta-line">/ ${c.max}</span>` : ''}</td>
        <td class="mono">${c.missing ? 'n/a' : (c.points > 0 ? '+' : '') + c.points}</td>
        <td class="meta-line">${esc(c.detail || '')}${c.missing ? ' — not available from a free source' : ''}</td>
      </tr>`).join('')}`).join('');
  const missing = (s.missing || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const review = (s.sourceUrls || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname)} ↗</a>`)
    .concat([WST_RANKINGS, SNOOKER_ORG, OLBG_SNOOKER].map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname)} ↗</a>`))
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

/* ------------------------------------------------------------------ tips */

function formatTip(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function tipText(tip) {
  return [tip.verdict, tip.paragraph, `Bet type: ${tip.betType}`].join('\n');
}

function analysisText(matchId) {
  const s = state.scored.find((x) => x.matchId === matchId);
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

/* ------------------------------------------------------------------ rail */

function renderRail() {
  const el = $('#rail-preds');
  const todays = state.scored.filter((s) => s.dateISO === state.date);
  if (!todays.length) {
    el.innerHTML = '<div class="card-body meta-line">No upcoming fixtures on this date — pick a highlighted day on the calendar.</div>';
  } else {
    el.innerHTML = todays.map((s) => `
      <div class="rail-pick">
        <div><strong>${esc(s.matchTitle)}</strong></div>
        <div>${confBadge(s.confidence.band)} <strong>${esc(s.leanName)}</strong> <span class="meta-line">${s.score}/100 · ${esc(s.decision.bet)}</span></div>
      </div>`).join('');
  }
  $('#rail-count').textContent = `${todays.length} upcoming fixture${todays.length === 1 ? '' : 's'} on this date · every prediction is 25–40 words, uniquely written, source-grounded.`;
}

/* ------------------------------------------------------------------ OLBG */

function renderOlbgBox() {
  const box = $('#olbg-box');
  if (!box) return;
  const body = $('.card-body', box);
  loadStatic('data/snooker_slate.json').then((res) => {
    const events = res?.data?.events || [];
    if (!events.length) { body.innerHTML = '<span class="meta-line">No OLBG slate committed yet.</span>'; return; }
    body.innerHTML = events.map((e) => {
      const markets = e.olbg?.markets || [];
      const mk = markets.map((m) => {
        const sels = (m.selections || []).map((s) =>
          `${esc(s.name)} ${s.tips}/${s.total}${s.pct != null ? ` (${s.pct}%)` : ''}`).join(' · ');
        return `<div class="meta-line"><strong>${esc(m.name)}:</strong> ${sels}</div>`;
      }).join('');
      const tipsterNote = markets.length ? '' : 'Tipster consensus available from the index.';
      return `
        <div class="olbg-row">
          <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(e.matchup || e.event_id)}</strong></a>
          <div class="meta-line">${esc(e.tournament || '')} · ${esc(e.round || '')} · ${esc(e.venue || '')}</div>
          ${mk || `<div class="meta-line">${esc(tipsterNote)}</div>`}
        </div>`;
    }).join('') +
    `<div class="meta-line" style="margin-top:8px"><a href="${OLBG_SNOOKER}" target="_blank" rel="noopener noreferrer">All OLBG snooker markets ↗</a>. Tipster votes are display-only, never fed into scoring.</div>`;
  });
}

/* ------------------------------------------------------------------ coverage / sources */

function renderCoverage() {
  const tape = state.docs?.tape?.matches || [];
  const ranks = state.docs?.rankings?.entries || [];
  const window = state.docs?.slate?.as_of_utc || '—';
  $('#coverage').innerHTML = `
    <ul style="margin:0;padding-left:16px">
      <li>Verified tape rows: ${tape.length} (${tape.filter((m) => m.winner).length} decided, ${tape.filter((m) => !m.winner).length} draws)</li>
      <li>Official ranking snapshot: ${ranks.length} players</li>
      <li>Slate refreshed: ${esc(window)}</li>
      <li>Ledger records: ${state.docs?.predictions?.predictions?.length || 0}</li>
      <li>Backtest rows: ${state.docs?.backtest?.events || 0}</li>
    </ul>
    <p style="margin-bottom:0">No free key-less price feed exists for snooker, so the odds component is scored as missing and live bets resolve to SKIP. <a href="sources.html#snooker-irr">Irregularity register →</a></p>`;
}

function renderSources() {
  const irr = state.docs?.provenance?.register || [];
  $('#sources').innerHTML = `
    <p style="margin-top:0"><a href="${WST}" target="_blank" rel="noopener noreferrer">World Snooker Tour ↗</a><br>
    <a href="${WST_RANKINGS}" target="_blank" rel="noopener noreferrer">official WST rankings ↗</a><br>
    <a href="${SNOOKER_ORG}" target="_blank" rel="noopener noreferrer">snooker.org results database ↗</a><br>
    <a href="${OLBG_SNOOKER}" target="_blank" rel="noopener noreferrer">OLBG snooker tips ↗</a></p>
    <p style="margin-bottom:0">${irr.length} logged irregularities (${irr.filter((i) => i.status === 'open').length} open). <a href="sources.html#snooker-irr">View register →</a></p>`;
}

/* ------------------------------------------------------------------ calendar */

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

/* ------------------------------------------------------------------ controls */

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
    toast('Cache cleared — reloading committed snooker data…');
    await loadDocs();
    await loadDay();
  });

  // The Generate button always works: it re-scores every fixture from the
  // committed documents and rewrites every prediction, then re-renders.
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
      toast(`Generated ${state.scored.length} written prediction${state.scored.length === 1 ? '' : 's'} for ${fmtDateLong(state.date)}`);
    } finally {
      btn.disabled = false;
      $('#progress').style.display = 'none';
    }
  });

  $('#copy-all').addEventListener('click', async () => {
    const preds = (state.written?.predictions || []).filter((p) => p.matchId && state.tipByMatch.get(p.matchId));
    if (!preds.length) { toast('No generated predictions to copy'); return; }
    const text = buildCopyText({
      predictions: preds,
      summaryTable: state.written.summaryTable,
      responsibleGambling: state.written.responsibleGambling,
    });
    const ok = await copyText(text);
    toast(ok ? `Copied ${preds.length} predictions + summary table` : 'Copy failed');
  });
}

boot().catch((err) => {
  console.error(err);
  $('#board').innerHTML = `<div class="empty">Failed to load the snooker layer: ${esc(err.message)}. The committed data may be missing; CI repopulates it.</div>`;
});
