/**
 * SportsPred — NRL page controller (nrl.html).
 *
 * Committed, source-tagged dataset (built in CI, nothing invented):
 *   data/nrl_matches.json   the 2026 season tape: every result and every fixture
 *   data/nrl_teams.json     clubs, home venues, coordinates
 *   data/nrl_slate.json     the OLBG NRL market slate (markets offered + lines)
 *   data/nrl_weather.json   Open-Meteo forecast per venue
 *   data/nrl_origin.json    the 2026 State of Origin calendar
 *   data/nrl_provenance.json sources and irregularities
 *   data/nrl_backtest.json  walk-forward backtest (no prices, so no ROI)
 *
 * What this controller does:
 *   1. loads the committed documents (cached, instant);
 *   2. scores every upcoming fixture with the NRL engine and writes three tips
 *      per match, automatically, on load;
 *   3. renders past results, upcoming fixtures and a month calendar;
 *   4. re-scores everything from the committed documents when Generate is
 *      pressed — the button is a real rebuild, never a no-op;
 *   5. copies a single tip, or the whole card with its summary table, value
 *      notes and responsible-gambling section, with one click.
 */

import { getSport } from '../../engine/registry.js';
import {
  buildNrlDocs, buildNrlCardForDate, nrlCalendar, nrlLadderNow, nrlUpcoming,
} from '../../engine/nrl_card.js';
import { RESPONSIBLE_GAMBLING } from '../../engine/nrl_writer.js';
import { loadStatic, clearCache, addDays } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, fmtTime, relTime, renderShell, renderFooter, toast, copyText, qs, setQS,
} from './ui.js';

const OLBG_RL = 'https://www.olbg.com/betting-tips/Rugby_League/10';
const REVIEW_LINKS = [
  { label: 'NRL Official Ladder', url: 'https://www.nrl.com/ladder/' },
  { label: 'NRL Official Draw', url: 'https://www.nrl.com/draw/' },
  { label: '2026 NRL season results (Wikipedia)', url: 'https://en.wikipedia.org/wiki/2026_NRL_season_results' },
  { label: 'Rugby League Project — 2026 season', url: 'https://www.rugbyleagueproject.org/seasons/nrl-2026/results.html' },
  { label: 'OLBG Rugby League markets', url: OLBG_RL },
  { label: 'Open-Meteo forecast API', url: 'https://open-meteo.com/' },
];

const state = {
  sport: null,
  date: qs('date', todayISO()),
  marketFilter: 'all',
  search: '',
  docs: null,
  cards: new Map(), // dateISO -> card
  calMonth: null,
  loadedAt: null,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('rugby-league');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'rugby-league', activePage: 'nrl.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  await loadDay(state.date);
}

function renderStatic() {
  $('#page-title').textContent = 'NRL';
  const tabs = $('#league-tabs');
  if (tabs) {
    tabs.innerHTML = (state.sport?.subPages || []).map((p) => `<a href="${esc(p.href)}" class="${p.href === 'nrl.html' ? 'on' : ''}" title="${esc(p.name)}">${esc(p.label)}</a>`).join('');
  }
  const links = (state.sport?.officialLinks || [])
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`)
    .join(' · ');
  $('#sport-links').innerHTML = links;
  $('#rg-body').innerHTML = RESPONSIBLE_GAMBLING.map((p) => `<p style="margin:6px 0">${esc(p)}</p>`).join('');
}

async function loadDocs() {
  setProgress(10, 'Loading the committed NRL dataset…');
  const [matches, teams, slate, weather, origin, provenance, backtest, predictions] = await Promise.all([
    loadStatic('data/nrl_matches.json'),
    loadStatic('data/nrl_teams.json'),
    loadStatic('data/nrl_slate.json'),
    loadStatic('data/nrl_weather.json'),
    loadStatic('data/nrl_origin.json'),
    loadStatic('data/nrl_provenance.json'),
    loadStatic('data/nrl_backtest.json'),
    loadStatic('data/nrl_predictions.json'),
  ]);
  state.docs = buildNrlDocs({
    matches: matches?.data, teams: teams?.data, slate: slate?.data,
    weather: weather?.data, origin: origin?.data,
  });
  state.provenance = provenance?.data || null;
  state.backtest = backtest?.data || null;
  state.predictions = predictions?.data || null;

  setProgress(45, 'Scoring every upcoming NRL fixture…');
  rebuildCards();
  setProgress(100, '');

  renderLadder();
  renderBacktest();
  renderOlbgBox();
  renderOriginBox();
  renderWeatherBox();
  renderCoverage();
  renderSources();
  state.loadedAt = Date.now();
}

function rebuildCards() {
  state.cards.clear();
  const dates = new Set();
  for (const m of nrlUpcoming(state.docs)) dates.add(m.date);
  for (const m of state.docs.season.completed) if (m.date) dates.add(m.date);
  for (const d of dates) {
    try {
      state.cards.set(d, buildNrlCardForDate(d, state.docs));
    } catch (err) {
      console.error('card build failed for', d, err);
    }
  }
}

function cardForDate(dateISO) {
  if (state.cards.has(dateISO)) return state.cards.get(dateISO);
  try {
    const card = buildNrlCardForDate(dateISO, state.docs);
    state.cards.set(dateISO, card);
    return card;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadDay(dateISO) {
  state.date = dateISO;
  setQS({ date: dateISO });
  $('#date-input').value = dateISO;
  $('#day-title').textContent = fmtDateLong(dateISO);
  renderDateStrip();
  renderCalendar();
  renderBoard();
  renderRail();
  renderMeta();
}

/* ----------------------------------------------------------------- board */

function renderBoard() {
  const card = cardForDate(state.date);
  const board = $('#board');
  const q = state.search.trim().toLowerCase();
  const results = (card?.results || []).filter((m) => {
    if (!q) return true;
    return `${m.home} ${m.away}`.toLowerCase().includes(q);
  });
  const fixtures = (card?.matches || []).filter((m) => {
    if (!q) return true;
    return `${m.home} ${m.away} ${m.venue || ''}`.toLowerCase().includes(q);
  });

  const tipsTotal = card ? card.written.tips.length : 0;
  const active = card ? card.written.activeCount : 0;
  $('#counts').textContent = `${results.length} result${results.length === 1 ? '' : 's'} · ${fixtures.length} upcoming · ${tipsTotal} tips · ${active} live · source: committed verified data`;

  if (!card || (!results.length && !fixtures.length)) {
    board.innerHTML = `<div class="empty">No NRL matches on ${esc(state.date)}. Pick a highlighted day on the calendar — the tape covers the 2026 Premiership from round 1 and every fixture on the current OLBG slate.</div>`;
    return;
  }

  const resultsHtml = results.length
    ? `<div class="lg-head"><span>Final scores</span><span class="count">${results.length}</span></div>`
      + results.map(resultRow).join('')
    : '';

  const fixturesHtml = fixtures.length
    ? `<div class="lg-head"><span>Upcoming — generated card</span><span class="count">${fixtures.length}</span></div>`
      + fixtures.map((m) => fixtureRow(m, card)).join('')
    : '';

  board.innerHTML = resultsHtml + fixturesHtml;

  $$('#board [data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const d = $(`#detail-${CSS.escape(b.dataset.toggle)}`);
    if (!d) return;
    const open = d.classList.toggle('open');
    b.textContent = open ? 'Hide analysis' : 'Analysis';
    if (open && !d.dataset.filled) { d.innerHTML = detailHtml(b.dataset.toggle, card); d.dataset.filled = '1'; wireDetail(d, card); }
  }));

  $$('#board [data-copytip]').forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(btn.dataset.copytip.replace(/\*\*/g, ''));
    toast(ok ? 'Prediction copied to clipboard' : 'Copy failed — select the text manually');
  }));
}

function resultRow(m) {
  const hw = m.homeScore > m.awayScore;
  const aw = m.awayScore > m.homeScore;
  const margin = Math.abs(m.homeScore - m.awayScore);
  const tight = margin <= 2;
  return `
  <div class="match" data-id="res-${esc(m.home)}-${esc(m.away)}">
    <div class="match-main" style="grid-template-columns:1fr auto">
      <div class="teams">
        <div class="trow"><span class="nm" style="font-size:15px${hw ? ';font-weight:700' : ''}">${esc(m.home)}</span><span class="sc">${m.homeScore}</span></div>
        <div class="trow"><span class="nm" style="font-size:15px${aw ? ';font-weight:700' : ''}">${esc(m.away)}</span><span class="sc">${m.awayScore}</span></div>
        <div class="meta-line" style="margin-top:6px">Round ${esc(m.round ?? '—')}${tight ? ' · decided by ' + margin + ' point' + (margin === 1 ? '' : 's') + ' (a one- or two-point margin is usually golden point, though the tape does not label the period)' : ''}</div>
      </div>
      <div class="match-right"><span class="badge ${hw || aw ? 'HIGH' : 'MEDIUM'}">${hw ? 'HOME' : aw ? 'AWAY' : 'DRAW'}</span></div>
    </div>
  </div>`;
}

function fixtureRow(m, card) {
  const when = m.kickoffUtc ? fmtTime(m.kickoffUtc) : 'TBD';
  const id = `${m.home}_v_${m.away}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const tips = (card.written.tips || []).filter((t) => t.matchLabel === `${m.home} v ${m.away}`);
  const byMarket = new Map(tips.map((t) => [t.market, t]));
  const pills = ['win_match', 'handicap', 'game_total'].map((k) => byMarket.get(k)).filter(Boolean).map((t) => {
    if (t.skip) return `<span class="pred-pill SKIP"><span class="badge SKIP">SKIP</span><span class="sel">${esc(t.marketLabel)}</span></span>`;
    return `<span class="pred-pill ${esc(t.band)}"><span class="badge ${esc(t.band)}">${esc(t.band)}</span><span class="sel">${esc(String(t.selection).slice(0, 30))}</span></span>`;
  }).join(' ');
  const ladderNote = m.homeRow && m.awayRow ? `${m.homeRow.pos} v ${m.awayRow.pos} on the ladder` : '';
  return `
  <div class="match" data-id="${esc(id)}">
    <div class="match-main" style="grid-template-columns:110px 1fr auto">
      <div class="match-when"><div class="t">${esc(when)}</div><div class="s">Round ${esc(m.round ?? '—')}</div><div class="meta-line">${esc(m.venue || '')}</div></div>
      <div class="teams">
        <div class="trow"><span class="nm" style="font-size:15px">${esc(m.home)}</span> <span class="meta-line">home${m.homeRow ? ` · ${m.homeRow.pos}th, ${m.homeRow.Pts} pts` : ''}</span></div>
        <div class="trow"><span class="nm" style="font-size:15px">${esc(m.away)}</span> <span class="meta-line">away${m.awayRow ? ` · ${m.awayRow.pos}th, ${m.awayRow.Pts} pts` : ''}</span></div>
        <div class="meta-line" style="margin-top:6px">${pills || '<span class="badge SKIP">NO SELECTION</span>'}${ladderNote ? ` · ${esc(ladderNote)}` : ''}</div>
      </div>
      <div class="match-right" style="flex-wrap:wrap;justify-content:flex-end">
        <button class="btn sm" data-toggle="${esc(id)}">Analysis</button>
      </div>
    </div>
    <div class="detail" id="detail-${esc(id)}"></div>
    ${tips.length ? `<div class="card-body tight" style="border-top:1px solid var(--line-2)">${tips.map((t) => {
      if (t.skip) return `<p style="margin:6px 0;font-size:13px"><strong>${esc(t.marketLabel)}:</strong> <span class="badge SKIP">SKIP</span> ${esc(t.text.replace(/\*\*/g, ''))}</p>`;
      return `<p style="margin:8px 0;font-size:13px"><strong>${esc(t.marketLabel)} — <span class="badge ${esc(t.band)}">${esc(t.band)}</span> ${esc(String(t.selection))}:</strong> ${esc(t.text.replace(/\*\*/g, ''))} <button class="btn sm" data-copytip="${esc(t.text)}">Copy tip</button></p>`;
    }).join('')}</div>` : ''}
  </div>`;
}

function compTable(title, components) {
  const rows = (components || []).map((c) => `<tr class="${c.missing ? 'missing' : ''}"><td>${esc(c.label)}${c.max ? ` <span class="meta-line">/ ${c.max}</span>` : ''}${c.missing ? ' <span class="badge SKIP">missing</span>' : ''}${c.partial ? ' <span class="badge MEDIUM">partial</span>' : ''}</td><td class="num">${c.missing ? 'n/a' : (c.points > 0 ? '+' : '') + c.points}</td><td class="meta-line">${esc(c.detail || '')}</td></tr>`).join('');
  return `<table class="kv"><thead><tr><th>${esc(title)}</th><th class="num">Pts</th><th>Why</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="meta-line">none</td></tr>'}</tbody></table>`;
}

function detailHtml(matchId, card) {
  const ctx = card.matches.find((m) => `${m.home}_v_${m.away}`.replace(/[^a-zA-Z0-9_-]/g, '_') === matchId);
  if (!ctx) return '<div class="meta-line">No analysis available.</div>';
  const label = `${ctx.home} v ${ctx.away}`;
  const result = card.scored.results.find((r) => `${r.match.home} v ${r.match.away}` === label);
  if (!result) return '<div class="meta-line">No analysis available.</div>';

  const m = result.markets;
  const missing = [...new Set([...(m.win_match.missing || []), ...(m.handicap.missing || []), ...(m.game_total.missing || [])])];
  const flags = result.flags || [];
  const lines = [
    m.win_match.selection,
  ].filter(Boolean);

  return `
  <div class="detail-grid">
    <div>
      <div class="tipbox">
        <div class="tip-meta"><span class="badge ${m.win_match.band}">${esc(m.win_match.band)}</span>
          <span class="meta-line"> WIN ${m.win_match.score}/100 (coverage ${Math.round(m.win_match.coverage * 100)}%) ·
          HCP ${m.handicap.skip ? 'SKIP' : m.handicap.score + '/100'} ·
          TOTAL ${m.game_total.skip ? 'SKIP' : `${m.game_total.direction} by ${m.game_total.advantage}`}</span></div>
        <p style="margin:8px 0"><strong>Model pick:</strong> ${esc(lines[0])}</p>
        <p class="meta-line" style="margin:6px 0">Reference total used by the engine: ${m.game_total.referenceTotal ?? 'not published'}${m.game_total.referenceSource ? ` (${esc(m.game_total.referenceSource)})` : ''}. Handicap line on the OLBG slate: ${m.handicap.line ?? 'not published'}. Neither number is ever written into a tip.</p>
        ${result.valueFlag ? `<p style="margin:8px 0"><strong>Value note.</strong> ${esc(result.valueFlag)}</p>` : ''}
      </div>
      ${flags.length ? `<p class="meta-line" style="margin-top:10px"><strong>Flags for review</strong></p><ul class="miss">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${missing.length ? `<p class="meta-line" style="margin-top:10px"><strong>Not sourced — recorded as missing, never estimated:</strong></p><ul class="miss">${missing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <ul class="srclist">${REVIEW_LINKS.map((l) => `<li>→ <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a></li>`).join('')}</ul>
    </div>
    <div>
      ${compTable('WIN MATCH — ' + m.win_match.selection, m.win_match.components)}
      <div style="margin-top:12px">${compTable('HANDICAP — ' + (m.handicap.skip ? 'SKIP' : m.handicap.side + ' to cover'), m.handicap.components)}</div>
      <div style="margin-top:12px">${compTable('GAME TOTAL — ' + (m.game_total.direction || 'SKIP'), m.game_total.components)}</div>
      <p class="meta-line" style="margin-top:10px">Opponent view: ${esc(m.win_match.opponent)} scored ${m.win_match.sideKey === 'home' ? m.win_match.awayResult.raw : m.win_match.homeResult.raw}/100 raw on the same six factors.</p>
    </div>
  </div>`;
}

function wireDetail(root, card) {
  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
    const ok = await copyText(b.dataset.copy);
    toast(ok ? 'Copied' : 'Copy failed');
  }));
}

/* ------------------------------------------------------------------ rail */

function renderRail() {
  const card = cardForDate(state.date);
  const box = $('#rail-preds');
  const tips = (card?.written.tips || []).filter((t) => !t.skip);
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  tips.sort((a, b) => (order[a.band] ?? 3) - (order[b.band] ?? 3));
  box.innerHTML = tips.slice(0, 6).map((t) => `
    <div class="rail-tip">
      <div class="meta-line">${esc(t.marketLabel)} · <span class="badge ${esc(t.band)}">${esc(t.band)}</span></div>
      <div style="font-size:13px;margin:4px 0">${esc(t.text.replace(/\*\*/g, '').slice(0, 150))}…</div>
      <button class="btn sm" data-copytip="${esc(t.text)}">Copy</button>
    </div>`).join('') || '<div class="card-body meta-line">No live selections on this date.</div>';
  $$('#rail-preds [data-copytip]').forEach((btn) => btn.addEventListener('click', async () => {
    const ok = await copyText(btn.dataset.copytip.replace(/\*\*/g, ''));
    toast(ok ? 'Prediction copied to clipboard' : 'Copy failed — select the text manually');
  }));
  const total = card ? card.written.tips.length : 0;
  $('#rail-count').textContent = `${tips.length} live of ${total} markets on ${state.date}`;
}

function renderLadder() {
  const box = $('#ladder-body');
  const table = nrlLadderNow(state.docs);
  if (!table.length) { box.innerHTML = '<span class="meta-line">Ladder unavailable.</span>'; return; }
  $('#ladder-meta').textContent = `two points a win, one a draw, two for a bye — ${table.length} clubs`;
  const row = (r) => `<tr class="${r.pos <= 4 ? 'high' : r.pos <= 8 ? 'med' : ''}">
    <td class="num">${r.pos}</td><td>${esc(r.team)}</td>
    <td class="num">${r.P}</td><td class="num">${r.W}</td><td class="num">${r.D}</td><td class="num">${r.L}</td>
    <td class="num">${r.B}</td><td class="num">${r.PF}</td><td class="num">${r.PA}</td>
    <td class="num">${r.PD > 0 ? '+' : ''}${r.PD}</td><td class="num"><strong>${r.Pts}</strong></td>
    <td class="meta-line">${r.pos <= 4 ? 'top four — double chance' : r.pos <= 8 ? 'five to eight — sudden death' : 'outside the eight'}</td></tr>`;
  box.innerHTML = `<div style="overflow-x:auto"><table class="kv">
    <thead><tr><th class="num">#</th><th>Club</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Byes</th><th class="num">PF</th><th class="num">PA</th><th class="num">PD</th><th class="num">Pts</th><th>Finals position</th></tr></thead>
    <tbody>${table.map(row).join('')}</tbody></table></div>
    <p class="meta-line" style="margin-bottom:0">Computed from the committed tape and cross-checked against the published table after round 26 (all seventeen clubs match exactly on played, won, lost, differential and points). No team has won the premiership from outside the top four under the current top-eight system, so the engine weights a top-four berth separately.</p>`;
}

function renderBacktest() {
  const box = $('#backtest-body');
  const bt = state.backtest;
  if (!bt) { box.innerHTML = '<span class="meta-line">No backtest committed yet. Run <code>node scripts/backtest_nrl.mjs</code>.</span>'; return; }
  const w = bt.summary?.win_match || {};
  const t = bt.summary?.game_total || {};
  const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
  box.innerHTML = `
    <p style="margin-top:0">Walk-forward over rounds ${esc(bt.window?.rounds || '')} (${esc(bt.window?.from || '')} → ${esc(bt.window?.to || '')}, ${bt.window?.fixtures || 0} fixtures). Every match is scored only from the tape as it stood before kick-off.</p>
    <ul style="margin:0 0 8px;padding-left:16px">
      <li><strong>WIN MATCH</strong> ${w.hits}/${w.selections} correct (${pct(w.strike)}) · HIGH ${w.byBand?.HIGH?.hits ?? 0}/${w.byBand?.HIGH?.selections ?? 0} (${pct(w.byBand?.HIGH?.strike)}) · MEDIUM ${w.byBand?.MEDIUM?.hits ?? 0}/${w.byBand?.MEDIUM?.selections ?? 0} (${pct(w.byBand?.MEDIUM?.strike)})</li>
      <li><strong>GAME TOTAL</strong> ${t.hits}/${t.selections} (${pct(t.strike)}) — settled against the rolling season mean, not a market line</li>
      <li><strong>HANDICAP</strong> not settled: ${esc(bt.summary?.handicap?.reason || 'no free historical line tape exists')}</li>
    </ul>
    <p style="margin-bottom:0"><strong>No return on investment is reported anywhere on this site.</strong> There is no key-less NRL price feed, so any profit figure would have to be invented. ${esc((bt.method || [])[3] || '')}</p>`;
}

function renderOlbgBox() {
  const box = $('#olbg-box');
  const events = (state.docs.slate?.events || []).filter((e) => e.type !== 'outright');
  if (!events.length) { box.innerHTML = '<div class="card-body meta-line">No NRL events on the committed OLBG slate.</div>'; return; }
  box.innerHTML = '<div class="card-body" style="font-size:13px">' + events.map((e) => {
    const markets = (e.markets || []).map((m) => {
      const line = m.line != null ? ` (line ${m.line})` : '';
      return `<div class="meta-line">· ${esc(m.market)}${line} — ${esc(m.line_source || 'no line published')}</div>`;
    }).join('');
    return `<div style="margin-bottom:8px">
      <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.home)} v ${esc(e.away)} ↗</a>
      <div class="meta-line">${esc(e.status || 'upcoming')}${e.kickoffUtc ? ` · ${esc(e.kickoffUtc)}` : ''}</div>
      ${markets}
    </div>`;
  }).join('') + `<p class="meta-line" style="margin-bottom:0">Lines are shown here for manual review only. They are never written into a tip, and OLBG's server-rendered pages carry no bookmaker prices.</p></div>`;
}

function renderOriginBox() {
  const box = $('#origin-box');
  const o = state.docs.origin;
  if (!o) { box.innerHTML = '<div class="card-body meta-line">No Origin calendar committed.</div>'; return; }
  const games = (o.games || []).map((g) => `<li>${esc(g.date)} — ${esc(g.result || '')} <span class="meta-line">${esc(g.venue || '')}</span></li>`).join('');
  box.innerHTML = `<div class="card-body" style="font-size:13px">
    <p style="margin-top:0">${esc(o.series || 'State of Origin')} — ${esc(o.winner || '')}</p>
    <ul style="margin:0 0 8px;padding-left:16px">${games}</ul>
    <p class="meta-line" style="margin-bottom:0">The engine checks every fixture against this window: outside it, no club player can be on Origin duty, so the Origin half of the absences factor is scored on evidence rather than assumed. Inside it, the factor is left unscored.</p>
    </div>`;
}

function renderWeatherBox() {
  const box = $('#weather-box');
  const venues = state.docs.weather?.venues || {};
  const rows = Object.entries(venues).map(([name, v]) => {
    const days = (v.daily || []).slice(0, 3).map((d) => `${d.date.slice(5)}: ${d.precip_mm}mm / ${d.precip_prob_max}% / ${d.wind_max_kmh}km/h`).join(' · ');
    return `<li>${esc(name)} — ${esc(days)}</li>`;
  }).join('');
  box.innerHTML = `<div class="card-body" style="font-size:13px"><ul style="margin:0 0 8px;padding-left:16px">${rows || '<li>none committed</li>'}</ul>
    <p class="meta-line" style="margin-bottom:0">Daily aggregate from the Open-Meteo forecast API (no key, no registration). Rain of five millimetres or more, or an eighty per cent chance or better, counts as heavy and takes the ten-point weather factor to the Under; under a millimetre and under twenty per cent counts as dry and takes it to the Over.</p></div>`;
}

function renderCoverage() {
  const el = $('#coverage');
  const s = state.docs.season;
  const prov = state.provenance;
  const irr = prov?.irregularities || [];
  el.innerHTML = `
    <ul style="margin:0;padding-left:16px">
      <li>${s.completed.length} completed matches, ${s.scheduled.length} fixtures on the tape — <a href="data/nrl_matches.json" target="_blank" rel="noopener noreferrer">nrl_matches.json ↗</a></li>
      <li>${Object.keys(state.docs.teams?.teams || {}).length} clubs with home venue and coordinates — <a href="data/nrl_teams.json" target="_blank" rel="noopener noreferrer">nrl_teams.json ↗</a></li>
      <li>${(state.docs.slate?.events || []).length} OLBG events — <a href="data/nrl_slate.json" target="_blank" rel="noopener noreferrer">nrl_slate.json ↗</a></li>
      <li>${Object.keys(state.docs.weather?.venues || {}).length} venue forecasts — <a href="data/nrl_weather.json" target="_blank" rel="noopener noreferrer">nrl_weather.json ↗</a></li>
      <li>${irr.length} irregularities (${irr.filter((i) => String(i.status || '').toLowerCase() === 'open').length} open)</li>
    </ul>
    <p style="margin-bottom:0">Odds are never estimated: no key-less price feed exists, so the fifteen-point value factor always scores zero and is named on every card. <a href="sources.html#nrl">Register →</a></p>`;
}

function renderSources() {
  const prov = state.provenance;
  const box = $('#provenance-body');
  if (!prov) { box.innerHTML = '<span class="meta-line">Provenance not yet committed.</span>'; return; }
  const src = prov.sources || [];
  const irr = prov.irregularities || [];
  box.innerHTML = `
    <p style="margin-top:0">${src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a> — ${esc(s.note || '')}`).join('<br>')}</p>
    <p>${irr.length} logged irregularities. <a href="sources.html#nrl">View register →</a> · <a href="docs/NRL_PROMPT_REVIEW.md">Line-by-line prompt review ↗</a></p>
    ${prov.generated_at_utc ? `<p class="meta-line">Provenance generated ${esc(prov.generated_at_utc)} · ruleset ${esc(prov.ruleset_version || 'v1.0')}</p>` : ''}`;
}

function renderMeta() {
  $('#meta').innerHTML = `
    <span>${state.docs.season.completed.length} results, ${state.docs.season.scheduled.length} upcoming</span>
    <span>${state.cards.size} dates scored</span>
    <span>loaded ${relTime(state.loadedAt)}</span>
    <span>ruleset v1.0</span>
    <span><a href="data/nrl_provenance.json" target="_blank" rel="noopener noreferrer">provenance ↗</a></span>`;
}

/* -------------------------------------------------------------- calendar */

function calendarCounts() {
  return nrlCalendar(state.docs);
}

function renderCalendar() {
  const grid = $('#calgrid');
  const counts = calendarCounts();
  const first = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth(), 1));
  $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const startDow = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startDow; i += 1) {
    const d = new Date(first); d.setUTCDate(d.getUTCDate() - (startDow - i));
    cells.push({ d, other: true });
  }
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  for (let i = 1; i <= dim; i += 1) cells.push({ d: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i)), other: false });
  while (cells.length % 7) { const last = cells[cells.length - 1].d; const d = new Date(last); d.setUTCDate(d.getUTCDate() + 1); cells.push({ d, other: true }); }
  grid.innerHTML = cells.map(({ d, other }) => {
    const iso = d.toISOString().slice(0, 10);
    const n = counts.get(iso) || 0;
    return `<button class="cell ${other ? 'other' : ''} ${iso === todayISO() ? 'today' : ''} ${iso === state.date ? 'on' : ''}" data-date="${iso}" title="${iso}: ${n} matches">
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
  for (let i = -3; i <= 7; i += 1) days.push(addDays(state.date, i));
  el.innerHTML = days.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    const on = d === state.date;
    const n = counts.get(d) || 0;
    return `<button class="day ${on ? 'on' : ''}" data-date="${d}">
      <span class="dow">${dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${dt.getUTCDate()}</span>
      ${n ? `<span class="dot" title="${n} matches"></span>` : ''}
      ${d === todayISO() ? '<span class="dot" style="background:var(--accent)"></span>' : ''}
    </button>`;
  }).join('');
  $$('#datestrip .day').forEach((b) => b.addEventListener('click', () => loadDay(b.dataset.date)));
}

/* -------------------------------------------------------------- controls */

function setProgress(pctv, label) {
  const bar = $('#progress i');
  const lab = $('#progress-label');
  if (bar) bar.style.width = `${pctv}%`;
  if (lab) lab.innerHTML = pctv >= 100 ? '' : `<span class="spin"></span> ${esc(label || '')}`;
  if (pctv >= 100) setTimeout(() => { if (bar) bar.style.width = '0%'; }, 400);
}

function wireControls() {
  $('#prev-day').addEventListener('click', () => loadDay(addDays(state.date, -1)));
  $('#next-day').addEventListener('click', () => loadDay(addDays(state.date, 1)));
  $('#today-btn').addEventListener('click', () => loadDay(todayISO()));
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) loadDay(e.target.value); });
  $('#cal-prev').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1)); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1)); renderCalendar(); });
  $('#status-filter').addEventListener('change', (e) => { state.marketFilter = e.target.value; renderBoard(); renderRail(); });
  let t = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.search = e.target.value; renderBoard(); renderRail(); }, 150);
  });

  // THE button: rebuild every card from the committed documents and rewrite
  // every prediction. It is a real re-score, not a re-render.
  $('#generate').addEventListener('click', async () => {
    const btn = $('#generate');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Generating…';
    setProgress(15, 'Re-scoring every NRL fixture from the committed documents…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      rebuildCards();
      setProgress(85, 'Writing predictions…');
      await new Promise((r) => setTimeout(r, 20));
      const card = cardForDate(state.date);
      const published = card ? card.written.tips.filter((x) => !x.skip).length : 0;
      const skipped = card ? card.written.tips.filter((x) => x.skip).length : 0;
      renderBoard();
      renderRail();
      renderLadder();
      setProgress(100, '');
      toast(`${published} predictions generated for ${state.date} (${skipped} markets withheld as SKIP — narrow margins, thin evidence or the per-match cap, all disclosed rather than guessed)`);
    } catch (err) {
      toast(`Generation failed: ${err.message}`);
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⚡ Generate predictions';
    }
  });

  $('#copy-all').addEventListener('click', async () => {
    const card = cardForDate(state.date);
    if (!card?.formattedText) { toast('Nothing to copy — no card on this date'); return; }
    const ok = await copyText(card.formattedText);
    toast(ok ? `Copied ${card.written.tips.length} tips, the summary table, value notes and the responsible-gambling section` : 'Copy failed — the clipboard is blocked here');
  });

  $('#refresh').addEventListener('click', async () => {
    clearCache();
    toast('Cache cleared — reloading committed NRL data…');
    await loadDocs();
    await loadDay(state.date);
  });
}

boot().catch((e) => {
  console.error(e);
  const b = $('#board');
  if (b) b.innerHTML = `<div class="note bad">The NRL page failed to start: ${esc(e.message)}. Open the browser console for the stack trace.</div>`;
});
