/**
 * SportsPred — NPB page controller (npb.html), a sub-page of Baseball.
 *
 * Committed, provenance-tagged documents (built by scripts/collect_npb.mjs in
 * CI, or scripts/build_npb_seed.mjs from dated page captures):
 *   data/npb_fixtures.json     schedule rows: venue, roof, forecast, announced starters
 *   data/npb_tape.json         every regular-season result (draws + postponements)
 *   data/npb_standings.json    both league tables with ties and per-opponent records
 *   data/npb_pitchers.json     per-game pitching lines from the Japanese box scores
 *   data/npb_provenance.json   source register + irregularities
 *   data/npb_predictions.json  forward ledger
 *   data/npb_backtest.json     walk-forward report
 *
 * THE BUTTON. Predictions are generated on load AND on every click of
 * Generate. Scoring is pure and runs in the browser against the committed
 * documents, so the button works with no network at all. There is no live
 * refresh here: npb.jp does not send CORS headers, so the browser cannot read
 * it directly — the collector runs in CI instead and every card says when its
 * data was fetched.
 */

import { getSport } from '../../engine/registry.js';
import { enrichNpbFixture, standingsFor } from '../../engine/npb_data.js';
import { scoreNpbCard, CONFIDENCE } from '../../engine/npb_engine.js';
import { writeNpbCard } from '../../engine/npb_writer.js';
import { NPB_TEAMS } from '../../engine/npb_source.js';
import { loadStatic, addDays } from './data-client.js';
import { $, $$, esc, todayISO, fmtDateLong, fmtTime, relTime, renderShell, renderFooter, toast, copyText, qs, setQS } from './ui.js';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  filter: 'all',
  league: 'all',
  search: '',
  docs: null,
  cards: new Map(),
  calMonth: null,
  loadedAt: null,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('baseball');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'baseball', activePage: 'npb.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  buildAllCards();
  if (!qs('date') && state.cards.size && !state.cards.has(state.date)) {
    const near = nearestDateWithFixtures(state.date);
    if (near && near !== state.date) {
      state.movedFromDate = state.date;
      state.date = near;
      $('#date-input').value = near;
      setQS({ date: near });
    }
  }
  renderDay(state.date);
  setProgress(100, '');
  if (state.movedFromDate) toast(`No NPB games on ${state.movedFromDate} — showing ${state.date}`);
}

function renderStatic() {
  $('#sport-links').innerHTML = [
    { label: 'npb.jp English calendar', url: 'https://npb.jp/bis/eng/2026/calendar/index_09.html' },
    { label: 'Central standings', url: 'https://npb.jp/bis/eng/2026/stats/std_c.html' },
    { label: 'Pacific standings', url: 'https://npb.jp/bis/eng/2026/stats/std_p.html' },
    { label: 'Schedule + announced starters (JA)', url: 'https://npb.jp/games/2026/schedule_09_detail.html' },
    { label: 'OLBG Baseball Tips', url: 'https://www.olbg.com/betting-tips/Baseball/12' },
  ].map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join(' · ');
  $('#league-tabs').innerHTML = (state.sport?.subPages || []).map((p) => `<a href="${esc(p.href)}" class="${p.href === 'npb.html' ? 'on' : ''}" title="${esc(p.name)}">${esc(p.label)}</a>`).join('');
  $('#status-filter').value = state.filter;
  $('#date-input').value = state.date;
}

async function loadDocs() {
  setProgress(20, 'Loading committed NPB data…');
  const names = ['fixtures', 'tape', 'standings', 'pitchers', 'provenance', 'predictions', 'backtest'];
  const loaded = await Promise.all(names.map((n) => loadStatic(`data/npb_${n}.json`)));
  state.docs = Object.fromEntries(names.map((n, i) => [n, loaded[i]?.data || null]));
  state.loadedAt = Date.now();
  renderNotes();
  renderCoverage();
  renderBacktest();
  renderSources();
  renderStandings();
}

function renderNotes() {
  const p = state.docs?.provenance;
  const notes = [];
  if (p?.mode === 'seed') {
    notes.push(`<span class="pill seed">seed data</span> These documents were built from dated npb.jp page captures (see Sources) rather than a live collector run. Standings as of ${esc(p.coverage?.standingsAsOf || 'unknown')}. The CI collector replaces them on its first green run.`);
  }
  notes.push('Regular-season NPB games end level after twelve innings, so every match here is assessed for a draw independently of the two win scores. The Central League plays without a designated hitter through 2026 (universal DH from 2027); Pacific League and interleague games at Pacific parks use the DH.');
  $('#sport-notes').innerHTML = notes.map((n) => `<div class="note">${n}</div>`).join('');
}

function nearestDateWithFixtures(dateISO) {
  const dates = [...new Set((state.docs?.fixtures?.fixtures || []).map((f) => f.dateISO).filter(Boolean))].sort();
  if (!dates.length) return null;
  if (dates.includes(dateISO)) return dateISO;
  return dates.find((d) => d > dateISO) || dates[dates.length - 1];
}

function allFixtures() { return state.docs?.fixtures?.fixtures || []; }

function buildAllCards() {
  state.cards.clear();
  const docs = { tape: state.docs?.tape, standings: state.docs?.standings, pitchers: state.docs?.pitchers };
  const byDate = new Map();
  for (const f of allFixtures()) {
    if (!f.dateISO) continue;
    if (!byDate.has(f.dateISO)) byDate.set(f.dateISO, []);
    byDate.get(f.dateISO).push(f);
  }
  for (const [dateISO, list] of byDate) {
    try {
      const enriched = list.map((f) => enrichNpbFixture(f, docs));
      const scored = scoreNpbCard(enriched);
      const written = writeNpbCard(scored.results, { dateISO });
      state.cards.set(dateISO, { date: dateISO, matches: enriched, scored, written });
    } catch (e) {
      console.error('npb card build failed for', dateISO, e);
    }
  }
  return byDate;
}

/* ------------------------------------------------------------------ controls */

function wireControls() {
  $('#prev-day').onclick = () => go(addDays(state.date, -1));
  $('#next-day').onclick = () => go(addDays(state.date, 1));
  $('#today-btn').onclick = () => go(todayISO());
  $('#date-input').onchange = (e) => { if (e.target.value) go(e.target.value); };
  $('#status-filter').onchange = (e) => { state.filter = e.target.value; renderDay(state.date); };
  $('#league-filter').onchange = (e) => { state.league = e.target.value; renderDay(state.date); };
  $('#search').oninput = (e) => { state.search = e.target.value.trim().toLowerCase(); renderDay(state.date); };
  $('#cal-prev').onclick = () => { state.calMonth = new Date(state.calMonth.getTime() - 32 * 86400000); renderCalendar(); };
  $('#cal-next').onclick = () => { state.calMonth = new Date(state.calMonth.getTime() + 32 * 86400000); renderCalendar(); };

  $('#generate').onclick = () => {
    setProgress(40, 'Re-scoring every match on the slate…');
    buildAllCards();
    renderDay(state.date);
    setProgress(100, '');
    const card = state.cards.get(state.date);
    const active = card?.written?.summary?.active?.length || 0;
    toast(active ? `Generated: ${active} active pick${active === 1 ? '' : 's'} on ${state.date}` : `Generated: every match on ${state.date} resolved to SKIP — open Analysis to see why`);
  };
  $('#copy-all').onclick = async () => {
    const card = state.cards.get(state.date);
    const text = (card?.written?.tips || []).map((t) => `${t.fixture} — ${t.label}\n${t.text}`).join('\n\n');
    if (!text) { toast('Nothing to copy for this date yet'); return; }
    await copyText(text); toast('Tips copied');
  };
  $('#copy-card').onclick = async () => {
    const card = state.cards.get(state.date);
    if (!card?.written?.formattedText) { toast('Generate predictions first'); return; }
    await copyText(card.written.formattedText); toast('Full card copied');
  };
}

function go(dateISO) {
  state.date = dateISO;
  $('#date-input').value = dateISO;
  setQS({ date: dateISO });
  renderDay(dateISO);
}

function setProgress(pct, label) {
  const bar = $('#progress');
  bar.style.display = pct >= 100 ? 'none' : 'block';
  bar.querySelector('i').style.width = `${Math.max(2, pct)}%`;
  $('#progress-label').textContent = label || '';
}

/* ------------------------------------------------------------------ rendering */

function matchesFor(dateISO) { return state.cards.get(dateISO)?.matches || []; }

function renderDay(dateISO) {
  $('#day-title').textContent = fmtDateLong(dateISO);
  const card = state.cards.get(dateISO);
  const all = matchesFor(dateISO);
  const q = state.search;
  const visible = all.filter((m) => {
    if (state.league !== 'all' && m.league !== state.league) return false;
    if (state.filter === 'upcoming' && m.status !== 'scheduled') return false;
    if (state.filter === 'results' && m.status !== 'final') return false;
    if (state.filter === 'selected') {
      const r = card?.scored?.results?.find((x) => x.id === m.id);
      if (!r || ![r.winMatch.decision, r.runLine.decision, r.total.decision].some((d) => d.confidence !== CONFIDENCE.SKIP)) return false;
    }
    if (!q) return true;
    return `${m.home?.name} ${m.away?.name} ${m.home?.short} ${m.away?.short} ${m.leagueName} ${m.venue}`.toLowerCase().includes(q);
  });
  const active = card?.written?.summary?.active || [];
  $('#counts').textContent = all.length ? `${visible.length} of ${all.length} games · ${active.length} active pick${active.length === 1 ? '' : 's'}` : 'no games on this date in the committed data';

  renderDateStrip();
  renderCalendar();
  renderDrawWatch(card);

  const board = $('#board');
  if (!visible.length) {
    board.innerHTML = `<div class="card-body empty">
      <p>No games recorded for <strong>${esc(fmtDateLong(dateISO))}</strong>.</p>
      <p class="meta-line">NPB plays Tuesday to Sunday with Monday off-days, and the committed schedule covers the months the collector has fetched. Use the calendar to jump to a date with games.</p>
    </div>`;
    renderRail(card);
    $('#card-text').textContent = 'No games on this date.';
    return;
  }
  board.innerHTML = visible.map((m) => renderMatch(m, card)).join('');
  $$('#board .match-toggle').forEach((btn) => {
    btn.onclick = () => {
      const panel = document.getElementById(btn.dataset.target);
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      btn.textContent = open ? 'Analysis ▸' : 'Analysis ▾';
    };
  });
  $$('#board .copy-tip').forEach((btn) => { btn.onclick = async () => { await copyText(btn.dataset.text); toast('Tip copied'); }; });
  renderRail(card);
  $('#card-text').textContent = card?.written?.formattedText || 'No card generated yet.';
}

function jstTime(m) {
  const t = String(m.startLocal || '').match(/(\d{2}:\d{2})/)?.[1];
  if (t) return t;
  return fmtTime(m.startUtc);
}

function pills(m) {
  const out = [];
  if (m.roof === 'dome') out.push('<span class="pill roof">enclosed</span>');
  if (m.roof === 'retractable') out.push('<span class="pill roof">retractable roof</span>');
  if (m.forecast && /rain/.test(m.forecast)) out.push(`<span class="pill rain">${esc(m.forecast)}</span>`);
  if (m.dh?.dh === false) out.push('<span class="pill">no DH</span>');
  if (m.dh?.dh === true) out.push('<span class="pill">DH</span>');
  return out.join('');
}

function renderMatch(m, card) {
  const result = card?.scored?.results?.find((r) => r.id === m.id) || null;
  const tips = (card?.written?.tips || []).filter((t) => t.matchId === m.id);
  const when = m.status === 'final' ? (m.draw ? 'Final — draw' : 'Final') : m.status === 'postponed' ? 'Postponed' : `${jstTime(m)} JST`;
  const score = m.homeScore != null && m.awayScore != null ? `${m.awayScore} – ${m.homeScore}${m.innings && m.innings !== 9 ? ` (${m.innings})` : ''}` : '';
  const bands = tips.map((t) => `<span class="badge ${t.confidence}">${esc(t.label.split(' ')[0])} ${t.confidence}</span>`).join(' ');
  const drawPill = result?.draw?.flag ? `<span class="pill draw">draw ${result.draw.score}/100${result.draw.flag === 'primary' ? ' · pick' : ''}</span>` : '';
  const sp = m.announcedStarters ? `<div class="meta-line">Announced: ${esc(m.announcedStarters.away)} (${esc(m.away.short)}) v ${esc(m.announcedStarters.home)} (${esc(m.home.short)})</div>` : '';
  return `<div class="match" data-id="${esc(m.id)}">
    <div class="match-main">
      <div class="teams">
        <div><span class="meta-line">${esc(m.away?.code || '')}</span> ${esc(m.away?.name || 'Away')} <span class="meta-line">${esc(m.away?.recordSummary || '')}</span></div>
        <div><span class="meta-line">${esc(m.home?.code || '')}</span> ${esc(m.home?.name || 'Home')} <span class="meta-line">${esc(m.home?.recordSummary || '')}</span></div>
        ${sp}
      </div>
      <div class="match-when">
        <div>${esc(when)} ${score ? `<strong>${esc(score)}</strong>` : ''}</div>
        <div class="meta-line">${esc(m.leagueName || '')}${m.venue ? ` · ${esc(m.venue)}` : ''} ${pills(m)}</div>
        <div>${bands} ${drawPill}</div>
      </div>
      <div class="match-right"><button class="btn sm match-toggle" data-target="an-${esc(m.id)}">Analysis ▸</button></div>
    </div>
    <div class="tipbox">${tips.map(renderTip).join('')}</div>
    <div class="analysis" id="an-${esc(m.id)}" style="display:none">${renderAnalysis(m, result)}</div>
  </div>`;
}

function renderTip(t) {
  return `<div class="tip-box">
    <div class="meta-line">${esc(t.fixture)} — <strong>${esc(t.label)}</strong> · ${esc(t.confidence)}</div>
    <div class="tip-text">${esc(t.text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</div>
    ${t.validation?.ok ? '' : `<div class="miss">withheld by the output validator: ${esc((t.validation.violations || []).join('; '))}</div>`}
    ${t.skip && t.reason ? `<div class="meta-line">engine reason: ${esc(t.reason)}</div>` : ''}
    <div class="tip-actions"><button class="btn sm copy-tip" data-text="${esc(t.text)}">📋 Copy tip</button></div>
  </div>`;
}

function compRows(list) {
  return list.map((c) => `<tr><td>${esc(c.label)}</td><td class="mono">${c.points > 0 ? '+' : ''}${c.points}${c.max ? `/${c.max}` : ''}</td><td class="meta-line">${esc(c.detail)}${c.missing ? ' <span class="miss">(not sourced)</span>' : ''}</td></tr>`).join('');
}

function renderAnalysis(m, r) {
  if (!r) return '<div class="card-body meta-line">No scored result for this match.</div>';
  const blocks = [
    [`Win match — ${r.home.displayName}`, r.winMatch.home],
    [`Win match — ${r.away.displayName}`, r.winMatch.away],
    ['Draw likelihood (independent)', r.draw],
    [`Run line — ${r.favouredDisplay} (−1.5 candidate)`, r.runLine.favourite],
  ];
  const rows = blocks.map(([label, side]) => `<div class="detail">
      <div class="detail-grid"><strong>${esc(label)}</strong> <span class="mono">${side.score}/100</span></div>
      <table class="trow"><tbody>${compRows(side.components)}</tbody></table>
    </div>`).join('');
  const totalRows = compRows([...r.total.over, ...r.total.under, ...r.total.neutral]);
  const links = [
    m.links?.npbBox ? { label: 'npb.jp box score (EN)', url: m.links.npbBox } : null,
    m.links?.npbJaScore ? { label: 'npb.jp 試合速報 (JA)', url: m.links.npbJaScore } : null,
    m.links?.schedule ? { label: 'npb.jp schedule + starters (JA)', url: m.links.schedule } : null,
    { label: 'npb.jp calendar', url: `https://npb.jp/bis/eng/${m.season || 2026}/calendar/index_${String(m.dateISO || '').slice(5, 7) || '09'}.html` },
    { label: `${r.home.league === 'central' ? 'Central' : 'Pacific'} standings`, url: `https://npb.jp/bis/eng/${m.season || 2026}/stats/std_${r.home.league === 'central' ? 'c' : 'p'}.html` },
  ].filter(Boolean);
  const recent = (side) => (side.recent || []).slice(0, 5).map((g) => `<a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer" title="${esc(g.dateISO)} v ${esc(g.opponent)}">${esc(g.result)} ${esc(g.score)}</a>`).join(' · ') || 'none on tape';
  const spLine = (side) => side.starter ? `${esc(side.starter.name)}${side.starter.last4?.length ? ` — last ${side.starter.last4.length}: ${side.starter.last4.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${s.ip} IP / ${s.er} ER</a>`).join(', ')}` : ' — announced, no sourced starts on tape'}` : 'not announced';
  return `<div class="card-body">
    <div class="detail-grid">
      <span>Win match</span><span>${esc(r.winMatch.decision.confidence)} · ${esc(r.winMatch.decision.reason)}</span>
      <span>Draw</span><span>${r.draw.score}/100 · ${r.draw.flag === 'primary' ? 'primary selection' : r.draw.flag === 'secondary' ? 'elevated — run line withheld' : 'below threshold'}</span>
      <span>Run line</span><span>${esc(r.runLine.decision.confidence)} · ${esc(r.runLine.decision.reason)}</span>
      <span>Game total</span><span>${esc(r.total.decision.confidence)} · ${esc(r.total.decision.reason)}</span>
      <span>Starters</span><span>${spLine(m.away)} / ${spLine(m.home)}</span>
      <span>Recent (${esc(m.away.short)})</span><span>${recent(m.away)}</span>
      <span>Recent (${esc(m.home.short)})</span><span>${recent(m.home)}</span>
      <span>Venue</span><span>${esc(m.venue || 'unknown')} · ${esc(m.roof || 'roof unknown')} · forecast ${esc(m.forecast || 'not sourced')}${r.seasonWindow ? ` · ${esc(r.seasonWindow)} season window` : ''}</span>
      <span>Rules</span><span>${esc(m.dh?.basis || '')} · ${esc(m.foreignPlayers?.rule || '')}</span>
      <span>Price</span><span>not sourced — no key-less three-way NPB price feed</span>
    </div>
    ${rows}
    <div class="detail">
      <div class="detail-grid"><strong>Game total ledger</strong> <span class="mono">Over ${r.total.overScore} · Under ${r.total.underScore}</span></div>
      <table class="trow"><tbody>${totalRows || '<tr><td class="meta-line">no total factors could be sourced</td></tr>'}</tbody></table>
    </div>
    <div class="detail">
      <div class="detail-grid"><strong>Could not be sourced</strong></div>
      <ul class="miss">${(r.missing || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>nothing — every factor was sourced</li>'}</ul>
    </div>
    <div class="detail">
      <div class="detail-grid"><strong>Review links</strong></div>
      <div class="meta-line">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join(' · ')}</div>
    </div>
  </div>`;
}

function renderRail(card) {
  const tips = (card?.written?.tips || []).filter((t) => !t.skip);
  $('#rail-preds').innerHTML = tips.length
    ? tips.map((t) => `<div class="rail-item"><div class="meta-line">${esc(t.fixture)}</div>
        <div class="rail-pick"><strong>${esc(t.text.match(/\*\*([^*]+)\*\*/)?.[1] || t.label)}</strong> · ${esc(t.label)} <span class="badge ${t.confidence}">${t.confidence}</span></div></div>`).join('')
    : '<div class="card-body meta-line">No active picks on this date. Every market resolved to SKIP; open an analysis panel to see which inputs were missing or which gate failed.</div>';
  const active = card?.written?.summary?.active || [];
  $('#rail-count').innerHTML = `${active.length ? `${active.length} active pick${active.length === 1 ? '' : 's'}<br>` : ''}${esc(card?.written?.valueNote || '')}<br>${esc(card?.written?.drawNote || '')}`;
}

function renderDrawWatch(card) {
  const results = (card?.scored?.results || []).filter((r) => !r.unscored).sort((a, b) => b.draw.score - a.draw.score);
  if (!results.length) { $('#draw-watch').textContent = 'No games on this date.'; return; }
  $('#draw-watch').innerHTML = results.map((r) => `<div>${esc(r.away.displayName || r.away.code)} v ${esc(r.home.displayName || r.home.code)}: <strong>${r.draw.score}</strong>/100${r.draw.flag ? ` <span class="pill draw">${r.draw.flag}</span>` : ''} <span class="meta-line">${r.draw.components.filter((c) => c.points > 0).map((c) => c.id.replace('draw_', '')).join(', ') || 'no draw factor fired'}</span></div>`).join('')
    + '<div class="meta-line" style="margin-top:6px">Draw likelihood is scored independently on every game; it becomes the primary pick at 65+ when the two win scores sit within 10 points, and blocks the run line at 55+.</div>';
}

function renderDateStrip() {
  const strip = $('#datestrip');
  const days = [];
  for (let i = -3; i <= 10; i += 1) days.push(addDays(state.date, i));
  strip.innerHTML = days.map((d) => {
    const n = matchesFor(d).length;
    return `<button class="seg ${d === state.date ? 'on' : ''}" data-date="${d}"><span class="meta-line">${esc(d.slice(5))}</span><strong>${n || '·'}</strong></button>`;
  }).join('');
  $$('#datestrip .seg').forEach((b) => { b.onclick = () => go(b.dataset.date); });
}

function renderCalendar() {
  const month = state.calMonth;
  const y = month.getUTCFullYear(); const mo = month.getUTCMonth();
  $('#cal-title').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const first = new Date(Date.UTC(y, mo, 1));
  const startPad = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push('<span></span>');
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = matchesFor(iso).length;
    cells.push(`<button class="seg ${iso === state.date ? 'on' : ''}" data-date="${iso}"><span>${d}</span>${n ? `<strong>${n}</strong>` : ''}</button>`);
  }
  $('#calgrid').innerHTML = cells.join('');
  $$('#calgrid .seg[data-date]').forEach((b) => { b.onclick = () => go(b.dataset.date); });
}

function renderStandings() {
  const s = state.docs?.standings;
  if (!s?.central && !s?.pacific) { $('#standings').innerHTML = '<span class="meta-line">No standings document committed.</span>'; return; }
  $('#standings-asof').textContent = s.asOf ? `as of ${s.asOf}` : '';
  const table = (league, label) => {
    const teams = s[league]?.teams || [];
    if (!teams.length) return `<div class="meta-line">${esc(label)}: not sourced</div>`;
    return `<h4 style="margin:6px 0 4px">${esc(label)} <a class="meta-line" href="${esc(s[league].source)}" target="_blank" rel="noopener noreferrer">npb.jp ↗</a></h4>
      <table class="trow"><thead><tr><th></th><th>Team</th><th class="mono">W</th><th class="mono">L</th><th class="mono">T</th><th class="mono">PCT</th><th class="mono">GB</th><th class="mono">Home</th><th class="mono">Road</th><th class="mono">Int</th><th class="mono">Draw %</th></tr></thead><tbody>
      ${teams.map((t) => `<tr><td class="mono">${t.rank}</td><td>${esc(t.name)}</td><td class="mono">${t.wins}</td><td class="mono">${t.losses}</td><td class="mono">${t.ties}</td><td class="mono">${t.pct?.toFixed(3).replace(/^0/, '')}</td><td class="mono">${t.gamesBehind === 0 ? '—' : t.gamesBehind}</td><td class="mono">${t.home ? `${t.home.w}-${t.home.l}${t.home.t ? `-${t.home.t}` : ''}` : ''}</td><td class="mono">${t.road ? `${t.road.w}-${t.road.l}${t.road.t ? `-${t.road.t}` : ''}` : ''}</td><td class="mono">${t.interleague ? `${t.interleague.w}-${t.interleague.l}${t.interleague.t ? `-${t.interleague.t}` : ''}` : ''}</td><td class="mono">${t.drawRate != null ? (t.drawRate * 100).toFixed(1) : ''}</td></tr>`).join('')}
      </tbody></table>`;
  };
  $('#standings').innerHTML = table('central', 'Central League') + table('pacific', 'Pacific League');
}

function renderCoverage() {
  const d = state.docs || {};
  const p = d.provenance?.coverage || {};
  const counts = {
    'tape games': d.tape?.count ?? 0,
    'draws on tape': d.tape?.draws ?? 0,
    fixtures: d.fixtures?.count ?? 0,
    'upcoming with announced starters': `${d.fixtures?.upcomingWithStarters ?? 0} / ${d.fixtures?.upcoming ?? 0}`,
    'box scores parsed': d.pitchers?.boxes?.length ?? 0,
    'pitching lines': d.pitchers?.count ?? 0,
    'standings teams': (d.standings?.central?.teams?.length || 0) + (d.standings?.pacific?.teams?.length || 0),
  };
  const lines = Object.entries(counts).map(([k, v]) => `<div>${esc(k)}: <strong>${esc(String(v))}</strong>${v === 0 ? ' <span class="miss">empty</span>' : ''}</div>`).join('');
  $('#coverage').innerHTML = `${lines}
    <div class="meta-line" style="margin-top:6px">Mode: <strong>${esc(d.provenance?.mode || 'unknown')}</strong> · fetched ${esc(d.provenance?.fetched_at_utc || '')} · loaded ${esc(relTime(state.loadedAt))}.${p.standingsAsOf ? ` Standings as of ${esc(p.standingsAsOf)}.` : ''} Empty documents mean the engine records those factors as missing and the affected markets SKIP — nothing is filled in.</div>`;
}

function renderBacktest() {
  const b = state.docs?.backtest;
  if (!b) { $('#backtest').textContent = 'No backtest document committed.'; return; }
  const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  $('#backtest').innerHTML = `
    <div>walk-forward over <strong>${b.games}</strong> settled games${b.range ? ` (${esc(b.range.from)} → ${esc(b.range.to)})` : ''}</div>
    <div>draws on tape: <strong>${b.drawsOnTape}</strong> (${pct(b.drawRateOnTape)})</div>
    <div>win market: <strong>${b.markets?.win?.n ?? 0}</strong> plays · hit ${pct(b.markets?.win?.hitRate)} · draw picks ${b.markets?.win?.draws?.n ?? 0}</div>
    <div>run line: <strong>${b.markets?.runLine?.n ?? 0}</strong> plays · hit ${pct(b.markets?.runLine?.hitRate)}</div>
    <div>game total: ${b.markets?.total?.n ?? 0} verdicts · <span class="miss">ungradeable</span> (no posted line archived)</div>
    <div class="meta-line">bands — HIGH ${b.bands?.HIGH?.n ?? 0} (${pct(b.bands?.HIGH?.hitRate)}) · MEDIUM ${b.bands?.MEDIUM?.n ?? 0} (${pct(b.bands?.MEDIUM?.hitRate)}) · skipped win ${b.skipped?.win ?? 0}, run line ${b.skipped?.runLine ?? 0}</div>
    <div class="meta-line" style="margin-top:6px">${esc(b.method || '')}</div>`;
}

function renderSources() {
  const p = state.docs?.provenance;
  if (!p) { $('#sources').textContent = 'No provenance document committed.'; return; }
  const eps = (p.endpoints || []);
  $('#sources').innerHTML = `<div class="srclist">
    ${(p.sources || []).map((s) => `<div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a></div>`).join('')}
    <div class="meta-line" style="margin-top:6px">${eps.length} page${eps.length === 1 ? '' : 's'} recorded (${eps.filter((e) => e.ok).length} ok)${p.mode === 'seed' ? ' — dated captures, see tests/fixtures/npb_*.CAPTURE.md' : ''}.</div>
    <div class="meta-line" style="margin-top:6px"><strong>Not sourced:</strong> ${(p.notSourced || []).map(esc).join('; ')}</div>
    <div class="meta-line" style="margin-top:6px">${(p.irregularities || []).map((i) => `<div><strong>${esc(i.id)}</strong> <em>${esc(i.severity)}</em> — ${esc(i.detail)}</div>`).join('')}</div>
    <div class="meta-line" style="margin-top:6px">Full register: <a href="docs/NPB_IRREGULARITIES.md">docs/NPB_IRREGULARITIES.md</a> · sources: <a href="docs/NPB_SOURCES.md">docs/NPB_SOURCES.md</a></div>
  </div>`;
}

boot();
