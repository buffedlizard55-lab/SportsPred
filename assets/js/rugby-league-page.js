/**
 * SportsPred — rugby league page controller (rugby-league.html).
 *
 * Committed, source-tagged dataset (built in CI, no hallucinations):
 *   data/rugby_league_slate.json       OLBG Rugby League markets (all upcoming, with handicap/total lines where listed)
 *   data/rugby_league_matches.json     14 fixtures (NRL + Super League) normalised with H2H / venue / start_utc
 *   data/rugby_league_teams.json       32 team profiles (NRL ladder via nrl.com, Super League via superleague.co.uk/Wikipedia 2026-08-28)
 *   data/rugby_league_provenance.json  source register + irregularities
 *   data/rugby_league_predictions.json forward ledger (append-only)
 *   data/rugby_league_backtest.json    walk-forward report placeholder
 *   data/rugby_league_weather.json     weather placeholder
 *
 * This controller:
 *   1. loads the committed documents (cached, instant),
 *   2. scores every fixture on the slate with the RUGBY LEAGUE PREDICTION MASTER PROMPT v1.0 engine
 *      and writes the three tips per match (WIN MATCH / HANDICAP / GAME TOTAL) automatically,
 *   3. renders past results + upcoming fixtures with a calendar (like snooker/volleyball/golf),
 *   4. auto-generates on load AND on the Generate button — the button always re-scores from the committed docs,
 *   5. copies tips with one click (copy per-tip + copy all).
 */

import { getSport } from '../../engine/registry.js';
import { enrichRugbyLeagueMatch, buildRugbyLeagueCardForDate } from '../../engine/rugby_league_data.js';
import { loadStatic, clearCache, addDays } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, fmtTime, relTime, renderShell, renderFooter, toast, copyText, qs, setQS,
} from './ui.js';

const OLBG_RL = 'https://www.olbg.com/betting-tips/Rugby_League/10';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  leagueFilter: qs('league', 'all'),
  marketFilter: 'all',
  search: '',
  docs: null, // { matches, teams, slate, provenance, predictions, backtest, weather }
  cards: new Map(), // dateISO -> card { matches, scored, written, formattedText }
  calMonth: null,
  loadedAt: null,
  generated: false,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('rugby-league');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'rugby-league', activePage: 'rugby-league.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  await loadDay(state.date);
}

function renderStatic() {
  $('#page-title').textContent = state.sport.name;
  const tabs = $('#league-tabs');
  if (tabs) {
    tabs.innerHTML = (state.sport?.subPages || []).map((p) => `<a href="${esc(p.href)}" class="${p.href === 'rugby-league.html' ? 'on' : ''}" title="${esc(p.name)}">${esc(p.label)}</a>`).join('');
  }
  const links = (state.sport?.officialLinks || [])
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`)
    .join(' · ');
  $('#sport-links').innerHTML = links;
  if (state.sport?.notes?.length) {
    $('#sport-notes').innerHTML = state.sport.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('');
  }
  $('#league-filter').value = state.leagueFilter;
  $('#status-filter').value = state.marketFilter;
}

async function loadDocs() {
  setProgress(5, 'Loading committed rugby league data…');
  const [matches, teams, slate, provenance, predictions, backtest, weather] = await Promise.all([
    loadStatic('data/rugby_league_matches.json'),
    loadStatic('data/rugby_league_teams.json'),
    loadStatic('data/rugby_league_slate.json'),
    loadStatic('data/rugby_league_provenance.json'),
    loadStatic('data/rugby_league_predictions.json'),
    loadStatic('data/rugby_league_backtest.json'),
    loadStatic('data/rugby_league_weather.json'),
  ]);
  state.docs = {
    matches: matches?.data || null,
    teams: teams?.data || null,
    slate: slate?.data || null,
    provenance: provenance?.data || null,
    predictions: predictions?.data || null,
    backtest: backtest?.data || null,
    weather: weather?.data || null,
  };

  // Pre-compute every date card from committed docs (so calendar counts are instant)
  const dates = new Set();
  for (const m of state.docs.matches?.matches || []) {
    const d = m.date || m.dateISO || (m.start_utc ? m.start_utc.slice(0, 10) : null);
    if (d) dates.add(d);
  }
  // Also include dates from slate
  for (const e of state.docs.slate?.events || []) {
    const d = e.resolved_date || e.display_date || null;
    // display_date is like "3 Sept 19:05", need to map? ignore
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
  }
  for (const d of dates) {
    try {
      const card = buildRugbyLeagueCardForDate(d, state.docs.matches, state.docs.teams, state.docs.slate);
      state.cards.set(d, card);
    } catch (e) {
      console.error('card build failed for', d, e);
    }
  }

  state.loadedAt = Date.now();
  state.generated = true;
  renderOlbgBox();
  renderCoverage();
  renderSources();
  setProgress(100, '');
}

function cardForDate(dateISO) {
  if (state.cards.has(dateISO)) return state.cards.get(dateISO);
  // Build on demand if date not precomputed (e.g., today outside slate window)
  try {
    const card = buildRugbyLeagueCardForDate(dateISO, state.docs.matches, state.docs.teams, state.docs.slate);
    state.cards.set(dateISO, card);
    return card;
  } catch {
    return null;
  }
}

async function loadDay(dateISO) {
  state.date = dateISO;
  setQS({ date: dateISO, league: state.leagueFilter === 'all' ? null : state.leagueFilter });
  $('#date-input').value = dateISO;
  $('#day-title').textContent = fmtDateLong(dateISO);
  renderDateStrip();
  renderCalendar();
  renderBoard();
  renderRail();
  renderMeta();
}

/* ------------------------------------------------------------------ board */

function visibleCards(card) {
  if (!card) return [];
  const q = state.search.trim().toLowerCase();
  const out = [];
  for (const enriched of card.matches) {
    const league = enriched.league || enriched.competition?.name || '';
    if (state.leagueFilter !== 'all' && league !== state.leagueFilter) continue;
    if (q) {
      const hay = `${enriched.home} ${enriched.away} ${league} ${enriched.venue || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(enriched);
  }
  return out;
}

function renderBoard() {
  const card = cardForDate(state.date);
  const board = $('#board');
  const list = card ? visibleCards(card) : [];
  const nTotal = card ? card.matches.length : 0;
  const active = card ? card.written.activeCount : 0;
  const tipsTotal = card ? card.written.tips.length : 0;
  $('#counts').textContent = `${nTotal} fixtures · ${tipsTotal} tips · ${active} active · source: committed verified data`;

  if (!card || !card.matches.length) {
    board.innerHTML = `<div class="empty">No Rugby League fixtures on ${esc(state.date)}. The committed OLBG slate covers the current window (usually all upcoming NRL and Super League matches). Pick a highlighted day on the calendar.</div>`;
    return;
  }

  if (!list.length) {
    board.innerHTML = `<div class="empty">No Rugby League fixtures match these filters on ${esc(state.date)}.</div>`;
    return;
  }

  // Group by league for display
  const groups = new Map();
  for (const m of list) {
    const k = m.league || m.competition?.name || 'Rugby League';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }

  const tipByMatch = new Map();
  if (card) {
    for (const t of card.written.tips) {
      const key = `${t.matchLabel}`;
      if (!tipByMatch.has(key)) tipByMatch.set(key, []);
      tipByMatch.get(key).push(t);
    }
  }

  board.innerHTML = [...groups.entries()].map(([league, ms]) => `
    <div class="lg-head"><span>${esc(league)}</span><span class="count">${ms.length}</span></div>
    ${ms.map((m) => matchBlock(m, tipByMatch.get(`${m.home} v ${m.away}`) || [])).join('')}
  `).join('');

  $$('#board [data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const d = $(`#detail-${CSS.escape(b.dataset.toggle)}`);
    if (!d) return;
    const open = d.classList.toggle('open');
    b.textContent = open ? 'Hide analysis' : 'Analysis';
    if (open && !d.dataset.filled) { d.innerHTML = detailHtml(b.dataset.toggle, card); d.dataset.filled = '1'; wireDetail(d, card); }
  }));

  $$('#board [data-copytip]').forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = btn.dataset.copytip;
    const ok = await copyText(text.replace(/\*\*/g, ''));
    toast(ok ? 'Prediction copied to clipboard' : 'Copy failed — select the text manually');
  }));
  $$('#board [data-copycard]').forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const cardTxt = state.cards.get(state.date)?.formattedText || '';
    const ok = await copyText(cardTxt);
    toast(ok ? 'Card copied to clipboard' : 'Copy failed — select the text manually');
  }));
}

function matchBlock(m, tips) {
  const when = m.start_utc ? fmtTime(m.start_utc) : 'TBD';
  const venueLine = m.venue ? esc(m.venue) : '';
  // Find the 3 markets for this match (ordered WIN/HANDICAP/TOTAL by writer)
  const ordered = ['win_match', 'handicap', 'game_total'];
  const byMarket = new Map(tips.map((t) => [t.market, t]));
  const pills = ordered.map((k) => byMarket.get(k)).filter(Boolean).map((t) => {
    if (t.skip) return `<span class="pred-pill SKIP"><span class="badge SKIP">SKIP</span><span class="sel">${esc(t.marketLabel)}</span></span>`;
    return `<span class="pred-pill ${esc(t.band)}"><span class="badge ${esc(t.band)}">${esc(t.band)}</span><span class="sel">${esc(String(t.selection).slice(0, 28))}</span></span>`;
  }).join(' ');

  const id = `${m.home}_v_${m.away}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  return `
  <div class="match" data-id="${esc(id)}">
    <div class="match-main" style="grid-template-columns:105px 1fr auto">
      <div class="match-when"><div class="t">${esc(when)}</div><div class="s">${esc(m.league || '')}</div><div class="meta-line">${venueLine}</div></div>
      <div class="teams">
        <div class="trow"><span class="nm" style="font-size:15px">${esc(m.home)}</span> <span class="meta-line">home</span></div>
        <div class="trow"><span class="nm" style="font-size:15px">${esc(m.away)}</span> <span class="meta-line">away</span></div>
        <div class="meta-line" style="margin-top:6px">${pills || '<span class="badge SKIP">NO SELECTION</span>'}</div>
      </div>
      <div class="match-right" style="flex-wrap:wrap;justify-content:flex-end">
        <button class="btn sm" data-toggle="${esc(id)}">Analysis</button>
      </div>
    </div>
    <div class="detail" id="detail-${esc(id)}"></div>
    ${tips.length ? `<div class="card-body tight" style="border-top:1px solid var(--line-2)">${tips.map((t) => {
      const label = t.marketLabel;
      if (t.skip) return `<p style="margin:6px 0;font-size:13px"><strong>${esc(label)}:</strong> <span class="badge SKIP">SKIP</span> ${esc(t.text.replace(/\*\*/g, ''))}</p>`;
      return `<p style="margin:8px 0;font-size:13px"><strong>${esc(label)} — <span class="badge ${esc(t.band)}">${esc(t.band)}</span> ${esc(String(t.selection))}:</strong> ${esc(t.text.replace(/\*\*/g, ''))} <button class="btn sm" data-copytip="${esc(t.text)}">Copy tip</button></p>`;
    }).join('')}</div>` : ''}
  </div>`;
}

function detailHtml(matchId, card) {
  // matchId is sanitized home_v_away
  const parts = matchId.split('_v_');
  // Reconstruct original
  const enriched = card.matches.find((m) => `${m.home}_v_${m.away}`.replace(/[^a-zA-Z0-9_-]/g, '_') === matchId);
  if (!enriched) return '<div class="meta-line">No analysis available.</div>';
  const label = `${enriched.home} v ${enriched.away}`;
  const entry = card.scored.results.find((r) => `${r.match.home} v ${r.match.away}` === label);
  if (!entry) return '<div class="meta-line">No analysis available.</div>';
  const result = entry.result;
  const tipsForThis = card.written.tips.filter((t) => t.matchLabel === label);

  const compTable = (title, comps) => `
    <table class="kv"><thead><tr><th>${esc(title)}</th><th class="num">Pts</th><th>Why</th></tr></thead>
    <tbody>${(comps || []).map((c) => `<tr class="${c.missing ? 'missing' : ''}"><td>${esc(c.label)}${c.max ? ` <span class="meta-line">/ ${c.max}</span>` : ''}${c.missing ? ' <span class="badge SKIP">missing</span>' : ''}</td><td class="num">${c.missing ? 'n/a' : (c.points > 0 ? '+' : '') + c.points}</td><td class="meta-line">${esc(c.detail || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="meta-line">none</td></tr>'}</tbody></table>`;

  const missing = (result.missing || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const flags = (result.flags || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const sources = [
    enriched.source_url || enriched.olbg?.url || OLBG_RL,
    'https://www.nrl.com/ladder/',
    'https://www.superleague.co.uk/standings',
    'https://www.espn.com/rugby-league/',
  ];

  const cardTip = tipsForThis.find((t) => !t.skip);
  return `
  <div class="detail-grid">
    <div>
      <div class="tipbox">
        <div class="tip-meta"><span class="badge ${cardTip ? cardTip.band : 'SKIP'}">${cardTip ? cardTip.band : 'ALL SKIP'}</span><span class="meta-line"> ${result.favourite} leads · ${result.markets.win_match.score}/100 WIN · ${result.markets.handicap.score}/100 HCP · ${result.markets.game_total.score}/100 TOTAL</span></div>
        ${tipsForThis.map((t) => `<p style="margin:8px 0">${t.skip ? `<span class="badge SKIP">SKIP</span> ${esc(t.text.replace(/\*\*/g, ''))}` : `${esc(t.text).replace(/\*\*/g, '<strong>').replace(/\*\*/g, '</strong>')}`}</p>`).join('')}
        <div style="margin-top:10px"><button class="btn sm" data-copycard="${esc(label)}">Copy card for this match</button></div>
      </div>
      ${flags ? `<p class="meta-line" style="margin-top:10px"><strong>Flags for review</strong></p><ul class="miss">${flags}</ul>` : ''}
      ${missing ? `<p class="meta-line" style="margin-top:10px"><strong>Not sourced — honestly recorded as missing:</strong></p><ul class="miss">${missing}</ul>` : ''}
      <ul class="srclist">${sources.map((u) => `<li>→ <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)} ↗</a></li>`).join('')}</ul>
    </div>
    <div>
      ${compTable('WIN MATCH — ' + result.favourite, result.markets.win_match.components)}
      <div style="margin-top:12px">${compTable('HANDICAP — ' + (result.markets.handicap.selection || 'SKIP'), result.markets.handicap.components)}</div>
      <div style="margin-top:12px">${compTable('GAME TOTAL — ' + result.markets.game_total.direction + ' (' + (result.markets.game_total.marketTotal || 'no line') + ')', result.markets.game_total.components)}</div>
    </div>
  </div>`;
}

function wireDetail(root, card) {
  $$('[data-copycard]', root).forEach((b) => b.addEventListener('click', async () => {
    const label = b.dataset.copycard;
    const entry = card.written.tips.filter((t) => t.matchLabel === label);
    const text = entry.map((t) => `${t.marketLabel}: ${t.text.replace(/\*\*/g, '')}`).join('\n');
    const ok = await copyText(text);
    toast(ok ? 'Match card copied' : 'Copy failed');
  }));
}

/* ------------------------------------------------------------------ rail */

function renderRail() {
  const card = cardForDate(state.date);
  const el = $('#rail-preds');
  if (!card || !card.written.tips.length) {
    el.innerHTML = '<div class="card-body meta-line">No tips on this date — pick a highlighted day.</div>';
    $('#rail-count').textContent = '0 tips';
    return;
  }
  const active = card.written.tips.filter((t) => !t.skip);
  const byScore = [...active].sort((a, b) => b.score - a.score).slice(0, 8);
  if (!byScore.length) {
    el.innerHTML = '<div class="card-body meta-line">No selection cleared the method’s thresholds on this date — all three markets resolved to SKIP and the single-sentence explanations are shown on the board. This is deliberate (narrow margins, conflicting totals) and the confidence ceiling stays honest.</div>';
  } else {
    el.innerHTML = byScore.map((t) => `
      <div class="rail-item">
        <span class="r-body">
          <span class="r-sel">${esc(String(t.selection).slice(0,32))}</span>
          <span class="badge ${esc(t.band)}" style="margin-left:6px">${esc(t.band)} ${t.score}</span>
          <div class="r-match">${esc(t.matchLabel)} · ${esc(t.marketLabel)}</div>
        </span>
      </div>`).join('');
  }
  const withheld = card.written.tips.filter((t) => t.skip).length;
  $('#rail-count').textContent = `${active.length} published · ${withheld} skipped · capped at six active per day`;
}

/* ------------------------------------------------------------------ OLBG / coverage / sources */

function renderOlbgBox() {
  const box = $('#olbg-box');
  if (!box) return;
  const body = box.querySelector('.card-body') || box;
  const slate = state.docs.slate;
  const events = slate?.events || [];
  if (!events.length) {
    body.innerHTML = `<span class="meta-line">No OLBG slate committed yet. <a href="${OLBG_RL}" target="_blank" rel="noopener noreferrer">Open the index ↗</a></span>`;
    return;
  }
  body.innerHTML = events.map((e) => `
    <div class="olbg-row">
      <a href="${esc(e.url || `https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/${encodeURIComponent(e.home || '')}_v_${encodeURIComponent(e.away || '')}`)}" target="_blank" rel="noopener noreferrer"><strong>${esc(e.event_name || `${e.home || ''} v ${e.away || ''}`)}</strong></a>
      <div class="meta-line">${esc(e.consensus?.market || e.market || '—')}: ${esc(e.consensus?.selection || '—')} · ${e.consensus?.tips_for ?? 0}/${e.consensus?.tips_total ?? 0} tips${e.consensus?.pct != null ? ` (${e.consensus.pct}%)` : ''} · ${esc(e.resolved_date || e.display_date || '')}${e.handicap_lines ? ` · handicap ${esc(String(e.handicap_lines[0]?.line || e.handicap_selections?.[0] || ''))}` : ''}${e.total_lines ? ` · total ${esc(String(e.total_lines[0]?.line || ''))}` : ''}</div>
    </div>`).join('') +
    `<div class="meta-line" style="margin-top:8px"><a href="${OLBG_RL}" target="_blank" rel="noopener noreferrer">All OLBG rugby league markets ↗</a>. Tipster consensus is display-only, never fed into scoring. Every upcoming fixture on the slate is shown on the calendar.</div>`;
}

function renderCoverage() {
  const el = $('#coverage');
  if (!el) return;
  const m = state.docs.matches?.matches?.length || 0;
  const t = Object.keys(state.docs.teams?.teams || {}).length;
  const s = state.docs.slate?.events?.length || 0;
  const prov = state.docs.provenance;
  const irr = prov?.irregularities || [];
  const bt = state.docs.backtest;
  el.innerHTML = `
    <ul style="margin:0;padding-left:16px">
      <li>Committed fixtures: ${m} (NRL + Super League) — <a href="data/rugby_league_matches.json" target="_blank" rel="noopener noreferrer">matches.json ↗</a></li>
      <li>Team profiles: ${t} — <a href="data/rugby_league_teams.json" target="_blank" rel="noopener noreferrer">teams.json ↗</a></li>
      <li>OLBG snapshot: ${s} events — <a href="data/rugby_league_slate.json" target="_blank" rel="noopener noreferrer">slate.json ↗</a></li>
      <li>Backtest: ${bt?.events ?? 0} events · <a href="data/rugby_league_backtest.json" target="_blank" rel="noopener noreferrer">ledger ↗</a></li>
      <li>${irr.length} irregularities (${irr.filter((i) => i.status === 'open' || i.status === 'OPEN').length} open)</li>
    </ul>
    <p style="margin-bottom:0">No free key-less price feed is used; odds are derived from the ladder and are honestly recorded as missing where not sourced. <a href="sources.html#rugby-league">Register →</a></p>`;
}

function renderSources() {
  const prov = state.docs.provenance;
  const box = $('#provenance-body');
  if (!box) return;
  if (!prov) { box.innerHTML = '<span class="meta-line">Provenance not yet committed.</span>'; return; }
  const src = prov.sources || [];
  const irr = prov.irregularities || [];
  box.innerHTML = `
    <p style="margin-top:0">${src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a> — ${esc(s.note || '')} <span class="meta-line">${esc(s.fetched_at_utc || '')}</span>`).join('<br>')}</p>
    <p>${irr.length} logged irregularities (${irr.filter((i) => (i.status || '').toLowerCase() === 'open').length} open). <a href="sources.html#rugby-league">View register →</a></p>
    ${prov.generated_at_utc ? `<p class="meta-line">Provenance generated ${esc(prov.generated_at_utc)} · ruleset ${esc(prov.ruleset_version || '')}</p>` : ''}`;
}

/* ------------------------------------------------------------------ calendar */

function calendarCounts() {
  const counts = new Map();
  for (const m of state.docs.matches?.matches || []) {
    const d = m.date || m.dateISO || (m.start_utc ? m.start_utc.slice(0,10) : null);
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  // Include slate dates that may not be in matches (usually same)
  for (const e of state.docs.slate?.events || []) {
    const d = e.resolved_date;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !counts.has(d)) counts.set(d, (counts.get(d) || 0) + 1);
  }
  return counts;
}

function renderCalendar() {
  const grid = $('#calgrid');
  const counts = calendarCounts();
  const first = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth(), 1));
  $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const startDow = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(first); d.setUTCDate(d.getUTCDate() - (startDow - i));
    cells.push({ d, other: true });
  }
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  for (let i = 1; i <= dim; i++) cells.push({ d: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i)), other: false });
  while (cells.length % 7) { const last = cells[cells.length-1].d; const d = new Date(last); d.setUTCDate(d.getUTCDate()+1); cells.push({ d, other: true }); }
  grid.innerHTML = cells.map(({ d, other }) => {
    const iso = d.toISOString().slice(0,10);
    const n = counts.get(iso) || 0;
    return `<button class="cell ${other ? 'other' : ''} ${iso === todayISO() ? 'today' : ''} ${iso === state.date ? 'on' : ''}" data-date="${iso}" title="${iso}: ${n} fixtures">
      <span class="n">${d.getUTCDate()}</span>${n ? `<span class="c">${n}</span>` : ''}
    </button>`;
  }).join('');
  $$('#calgrid .cell').forEach((b) => b.addEventListener('click', () => {
    state.calMonth = new Date(`${b.dataset.date}T12:00:00Z`);
    loadDay(b.dataset.date);
  }));
  renderDateStrip();
}

function renderDateStrip() {
  const el = $('#datestrip');
  const counts = calendarCounts();
  const days = [];
  for (let i = -3; i <= 7; i++) days.push(addDays(state.date, i));
  el.innerHTML = days.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    const on = d === state.date;
    const n = counts.get(d) || 0;
    return `<button class="day ${on ? 'on' : ''}" data-date="${d}">
      <span class="dow">${dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${dt.getUTCDate()}</span>
      ${n ? `<span class="dot" title="${n} fixtures"></span>` : ''}
      ${d === todayISO() ? '<span class="dot" style="background:var(--accent)"></span>' : ''}
    </button>`;
  }).join('');
  $$('#datestrip .day').forEach((b) => b.addEventListener('click', () => loadDay(b.dataset.date)));
}

function setProgress(pctv, label) {
  const bar = $('#progress i');
  const lab = $('#progress-label');
  if (bar) bar.style.width = `${pctv}%`;
  if (lab) lab.innerHTML = pctv >= 100 ? '' : `<span class="spin"></span> ${esc(label || '')}`;
  if (pctv >= 100) setTimeout(() => { if (bar) bar.style.width = '0%'; }, 400);
}

function renderMeta() {
  $('#meta').innerHTML = `
    <span>${state.docs.matches?.matches?.length || 0} fixtures in committed window</span>
    <span>${state.cards.size} dates scored</span>
    <span>loaded ${relTime(state.loadedAt)}</span>
    <span>ruleset ${esc(state.docs.provenance?.ruleset_version || 'v1.0')}</span>
    <span><a href="data/rugby_league_provenance.json" target="_blank" rel="noopener noreferrer">provenance ↗</a></span>`;
}

/* ------------------------------------------------------------------ controls */

function wireControls() {
  $('#prev-day').addEventListener('click', () => loadDay(addDays(state.date, -1)));
  $('#next-day').addEventListener('click', () => loadDay(addDays(state.date, 1)));
  $('#today-btn').addEventListener('click', () => loadDay(todayISO()));
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) loadDay(e.target.value); });
  $('#cal-prev').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth()-1, 1)); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth()+1, 1)); renderCalendar(); });
  $('#league-filter').addEventListener('change', (e) => { state.leagueFilter = e.target.value; renderBoard(); renderRail(); });
  $('#status-filter').addEventListener('change', (e) => { state.marketFilter = e.target.value; renderBoard(); });
  let t = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.search = e.target.value; renderBoard(); renderRail(); }, 150);
  });

  // THE button — re-scores every fixture from the committed documents and rewrites every prediction
  $('#generate').addEventListener('click', async () => {
    const btn = $('#generate');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Generating…';
    $('#progress').style.display = '';
    setProgress(10, 'Re-scoring every Rugby League fixture from the committed documents…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      // Rebuild all cards from the committed docs (never from the ledger)
      state.cards.clear();
      const dates = new Set();
      for (const m of state.docs.matches?.matches || []) {
        const d = m.date || m.dateISO || (m.start_utc ? m.start_utc.slice(0,10) : null);
        if (d) dates.add(d);
      }
      for (const d of dates) {
        try { state.cards.set(d, buildRugbyLeagueCardForDate(d, state.docs.matches, state.docs.teams, state.docs.slate)); } catch {}
      }
      setProgress(80, 'Writing predictions…');
      await new Promise((r) => setTimeout(r, 20));
      const card = cardForDate(state.date);
      const published = card ? card.written.tips.filter((x) => !x.skip).length : 0;
      const skipped = card ? card.written.tips.filter((x) => x.skip).length : 0;
      renderBoard();
      renderRail();
      setProgress(100, '');
      toast(`${published} predictions generated for ${state.date} (${skipped} markets withheld as SKIP — narrow margins or conflicting totals are disclosed, not guessed)`);
    } catch (err) {
      toast(`Generation failed: ${err.message}`);
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⚡ Generate predictions';
      $('#progress').style.display = 'none';
    }
  });

  $('#copy-all').addEventListener('click', async () => {
    const card = cardForDate(state.date);
    if (!card?.formattedText) { toast('Nothing to copy — no card on this date'); return; }
    const ok = await copyText(card.formattedText);
    toast(ok ? `Copied ${card.written.tips.length} tips + summary table for ${state.date}` : 'Copy failed — the clipboard is blocked here');
  });

  $('#refresh').addEventListener('click', async () => {
    clearCache();
    toast('Cache cleared — reloading committed Rugby League data…');
    state.cards.clear();
    await loadDocs();
    await loadDay(state.date);
  });
}

boot().catch((e) => {
  console.error(e);
  const b = $('#board');
  if (b) b.innerHTML = `<div class="note bad">The Rugby League page failed to start: ${esc(e.message)}. Open the browser console for the stack trace.</div>`;
});
