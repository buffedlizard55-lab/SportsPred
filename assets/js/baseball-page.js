/**
 * SportsPred — baseball page controller (baseball.html).
 *
 * Committed, provenance-tagged documents (built by scripts/collect_baseball_*):
 *   data/baseball_fixtures.json   upcoming + settled fixtures (MLB StatsAPI + ESPN)
 *   data/baseball_tape.json       settled games: form, run diff, H2H, margins
 *   data/baseball_standings.json  official MLB standings snapshot
 *   data/baseball_team_stats.json hitting + pitching season team stats
 *   data/baseball_pitchers.json   probable-starter profiles (season + last 4 starts)
 *   data/baseball_slate.json      OLBG market rows (display + join, never a price)
 *   data/baseball_provenance.json source register + irregularities
 *   data/baseball_predictions.json forward ledger
 *   data/baseball_backtest.json   walk-forward report
 *
 * THE BUTTON. Predictions are generated on load AND on every click of Generate.
 * Scoring is pure and runs against the committed documents, so the button works
 * with no network at all; Refresh feeds additionally tries the live MLB and ESPN
 * endpoints and re-scores if they answer, falling back to the committed data and
 * saying so on screen when they do not.
 */

import { getSport } from '../../engine/registry.js';
import { enrichBaseballFixture } from '../../engine/baseball_data.js';
import { scoreBaseballCard, CONFIDENCE } from '../../engine/baseball_engine.js';
import { writeBaseballCard } from '../../engine/baseball_writer.js';
import {
  MLB_SCHEDULE_URL, MLB_STANDINGS_URL, MLB_TEAM_STATS_URL, ESPN_MLB_SCOREBOARD,
  parseMlbSchedule, parseMlbStandings, parseMlbTeamStats, parseEspnMlbScoreboard,
} from '../../engine/baseball_espn.js';
import { loadStatic, clearCache, addDays, getJSON, TTL } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, fmtTime, relTime, renderShell, renderFooter,
  toast, copyText, qs, setQS,
} from './ui.js';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  filter: 'all',
  search: '',
  docs: null,
  live: null,
  cards: new Map(),
  calMonth: null,
  loadedAt: null,
  feedNote: null,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('baseball');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'baseball', activePage: 'baseball.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  buildAllCards();
  if (!qs('date') && state.cards.size && !state.cards.has(state.date)) {
    const near = nearestDateWithFixtures(state.date);
    if (near && near !== state.date) {
      state.feedNote = state.feedNote || [];
      state.date = near;
      $('#date-input').value = near;
      setQS({ date: near });
      state.movedFromDate = todayISO();
    }
  }
  renderDay(state.date);
  setProgress(100, '');
  if (state.movedFromDate) {
    toast(`No baseball fixtures on ${state.movedFromDate} — showing ${state.date}`);
  }
}

function renderStatic() {
  $('#page-title').textContent = state.sport.name;
  $('#sport-links').innerHTML = (state.sport?.officialLinks || [])
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`)
    .join(' · ');
  if (state.sport?.notes?.length) {
    $('#sport-notes').innerHTML = state.sport.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('');
  }
  const tabs = $('#league-tabs');
  if (tabs) {
    tabs.innerHTML = (state.sport?.subPages || []).map((p) => `<a href="${esc(p.href)}" class="${p.href === 'baseball.html' ? 'on' : ''}" title="${esc(p.name)}">${esc(p.label)}</a>`).join('');
  }
  $('#status-filter').value = state.filter;
  $('#date-input').value = state.date;
}

async function loadDocs() {
  setProgress(20, 'Loading committed baseball data…');
  const [fixtures, tape, standings, teamStats, pitchers, slate, provenance, predictions, backtest] = await Promise.all([
    loadStatic('data/baseball_fixtures.json'),
    loadStatic('data/baseball_tape.json'),
    loadStatic('data/baseball_standings.json'),
    loadStatic('data/baseball_team_stats.json'),
    loadStatic('data/baseball_pitchers.json'),
    loadStatic('data/baseball_slate.json'),
    loadStatic('data/baseball_provenance.json'),
    loadStatic('data/baseball_predictions.json'),
    loadStatic('data/baseball_backtest.json'),
  ]);
  state.docs = {
    fixtures: fixtures?.data || null,
    tape: tape?.data || null,
    standings: standings?.data || null,
    teamStats: teamStats?.data || null,
    pitchers: pitchers?.data || null,
    slate: slate?.data || null,
    provenance: provenance?.data || null,
    predictions: predictions?.data || null,
    backtest: backtest?.data || null,
  };
  state.loadedAt = Date.now();
  renderOlbgBox();
  renderCoverage();
  renderBacktest();
  renderSources();
}

function nearestDateWithFixtures(dateISO) {
  const dates = [...(state.docs?.fixtures?.fixtures || [])]
    .map((f) => f.dateISO)
    .filter(Boolean)
    .sort();
  if (!dates.length) return null;
  if (dates.includes(dateISO)) return dateISO;
  const next = dates.find((d) => d > dateISO);
  if (next) return next;
  return dates[dates.length - 1];
}

function allFixtures() {
  return state.docs?.fixtures?.fixtures || [];
}

function buildAllCards() {
  state.cards.clear();
  const docs = {
    standings: state.docs?.standings,
    teamStats: state.docs?.teamStats,
    pitchers: state.docs?.pitchers,
    tape: state.docs?.tape,
    slate: state.docs?.slate,
  };
  const fixtures = [...allFixtures()];
  if (state.live?.fixtures?.length) fixtures.push(...state.live.fixtures);

  const byDate = new Map();
  for (const f of fixtures) {
    const d = f.dateISO || String(f.startUtc || '').slice(0, 10);
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    if (!byDate.get(d).some((x) => String(x.id) === String(f.id))) byDate.get(d).push(f);
  }

  for (const [dateISO, list] of byDate) {
    try {
      const enriched = list.map((f) => enrichBaseballFixture(f, docs));
      const scored = scoreBaseballCard(enriched);
      const written = writeBaseballCard(scored.results, { dateISO });
      state.cards.set(dateISO, { date: dateISO, matches: enriched, scored, written });
    } catch (e) {
      console.error('baseball card build failed for', dateISO, e);
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
  $('#search').oninput = (e) => { state.search = e.target.value.trim().toLowerCase(); renderDay(state.date); };
  $('#cal-prev').onclick = () => { state.calMonth = new Date(state.calMonth.getTime() - 32 * 86400000); renderCalendar(); };
  $('#cal-next').onclick = () => { state.calMonth = new Date(state.calMonth.getTime() + 32 * 86400000); renderCalendar(); };

  $('#generate').onclick = async () => {
    setProgress(40, 'Re-scoring every match on the slate…');
    buildAllCards();
    renderDay(state.date);
    setProgress(100, '');
    const card = state.cards.get(state.date);
    const active = card?.written?.summary?.active?.length || 0;
    toast(active
      ? `Generated: ${active} active pick${active === 1 ? '' : 's'} on ${state.date}`
      : `Generated: every match on ${state.date} resolved to SKIP — see the analysis panels for why`);
  };

  $('#copy-all').onclick = async () => {
    const card = state.cards.get(state.date);
    const text = (card?.written?.tips || []).map((t) => `${t.fixture} — ${t.label}\n${t.text}`).join('\n\n');
    if (!text) { toast('Nothing to copy for this date yet'); return; }
    await copyText(text);
    toast('Tips copied');
  };

  $('#copy-card').onclick = async () => {
    const card = state.cards.get(state.date);
    if (!card?.written?.formattedText) { toast('Generate predictions first'); return; }
    await copyText(card.written.formattedText);
    toast('Full card copied');
  };

  $('#refresh').onclick = async () => {
    await refreshLiveFeeds();
    buildAllCards();
    renderDay(state.date);
    renderCoverage();
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

/* ------------------------------------------------------------------ live feeds */

async function refreshLiveFeeds() {
  setProgress(30, 'Trying the live MLB and ESPN feeds…');
  const results = [];
  try {
    const sb = await getJSON(MLB_SCHEDULE_URL(state.date), { ttl: TTL.LIVE, timeoutMs: 9000, allowStale: false });
    if (sb?.ok !== false && sb?.data) {
      const parsed = parseMlbSchedule(sb.data);
      results.push({ feed: 'MLB schedule', status: sb.status, games: parsed.games.length });
      state.live = { ...(state.live || {}), fixtures: parsed.games, warnings: parsed.warnings };
    } else {
      results.push({ feed: 'MLB schedule', status: sb?.status ?? 0, error: sb?.error || 'unreachable from this browser' });
    }
  } catch (e) {
    results.push({ feed: 'MLB schedule', status: 0, error: String(e.message || e) });
  }
  try {
    const season = state.docs?.fixtures?.season ?? new Date().getUTCFullYear();
    const st = await getJSON(MLB_STANDINGS_URL(season), { ttl: TTL.TODAY, timeoutMs: 9000, allowStale: false });
    if (st?.data) {
      const parsed = parseMlbStandings(st.data);
      results.push({ feed: 'MLB standings', status: st.status, teams: parsed.count });
      state.live = { ...(state.live || {}), standings: parsed };
    }
  } catch (e) {
    results.push({ feed: 'MLB standings', status: 0, error: String(e.message || e) });
  }
  try {
    const season = state.docs?.fixtures?.season ?? new Date().getUTCFullYear();
    const [hit, pitch] = await Promise.all([
      getJSON(MLB_TEAM_STATS_URL('hitting', season), { ttl: TTL.TODAY, timeoutMs: 9000, allowStale: false }),
      getJSON(MLB_TEAM_STATS_URL('pitching', season), { ttl: TTL.TODAY, timeoutMs: 9000, allowStale: false }),
    ]);
    const teams = {};
    if (hit?.data) Object.assign(teams, parseMlbTeamStats(hit.data, 'hitting').teams);
    if (pitch?.data) Object.assign(teams, parseMlbTeamStats(pitch.data, 'pitching').teams);
    results.push({ feed: 'MLB team stats', status: hit?.status === 200 || pitch?.status === 200 ? 200 : 0, teams: Object.keys(teams).length });
    state.live = { ...(state.live || {}), teamStats: { teams } };
  } catch (e) {
    results.push({ feed: 'MLB team stats', status: 0, error: String(e.message || e) });
  }
  state.feedNote = results;
  const ok = results.filter((r) => r.status === 200);
  toast(ok.length ? `Live feeds: ${ok.map((r) => r.feed).join(', ')}` : 'Live feeds unreachable — scoring the committed data instead');
}

/* ------------------------------------------------------------------ rendering */

function matchesFor(dateISO) {
  return state.cards.get(dateISO)?.matches || [];
}

function renderDay(dateISO) {
  $('#day-title').textContent = fmtDateLong(dateISO);
  const card = state.cards.get(dateISO);
  const all = matchesFor(dateISO);
  const q = state.search;
  const visible = all.filter((m) => {
    if (state.filter === 'upcoming' && m.phase !== 'upcoming' && m.phase !== 'live') return false;
    if (state.filter === 'results' && m.phase !== 'results') return false;
    if (state.filter === 'selected') {
      const r = card?.scored?.results?.find((x) => x.id === m.id);
      const hasPick = r && [r.winMatch.decision, r.runLine.decision, r.total.decision]
        .some((d) => d.confidence !== CONFIDENCE.SKIP);
      if (!hasPick) return false;
    }
    if (!q) return true;
    const hay = `${m.home?.name} ${m.away?.name} ${m.leagueName} ${m.venue}`.toLowerCase();
    return hay.includes(q);
  });

  const active = card?.written?.summary?.active || [];
  $('#counts').textContent = all.length
    ? `${visible.length} of ${all.length} matches · ${active.length} active pick${active.length === 1 ? '' : 's'}`
    : 'no matches on this date in the committed data';

  renderDateStrip();
  renderCalendar();

  const board = $('#board');
  if (!visible.length) {
    board.innerHTML = `<div class="card-body empty">
      <p>No matches recorded for <strong>${esc(fmtDateLong(dateISO))}</strong>.</p>
      <p class="meta-line">The MLB calendar has off-days and an off-season; before the season starts the league publishes no fixtures and this site invents none. Use the calendar to jump to a date that has games, or press <strong>Refresh feeds</strong> to pull the live schedule.</p>
    </div>`;
    renderRail(card);
    $('#card-text').textContent = 'No matches on this date.';
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
  $$('#board .copy-tip').forEach((btn) => {
    btn.onclick = async () => { await copyText(btn.dataset.text); toast('Tip copied'); };
  });

  renderRail(card);
  $('#card-text').textContent = card?.written?.formattedText || 'No card generated yet.';
}

function renderMatch(m, card) {
  const result = card?.scored?.results?.find((r) => r.id === m.id) || null;
  const tips = (card?.written?.tips || []).filter((t) => t.matchId === m.id);
  const phase = m.phase === 'results' ? 'Final' : m.phase === 'live' ? 'Live' : fmtTime(m.startUtc);
  const score = m.score?.home != null && m.score?.away != null ? `${m.score.away} – ${m.score.home}` : '';
  const bands = tips.map((t) => `<span class="badge ${t.confidence}">${t.label.split(' ')[0]} ${t.confidence}</span>`).join(' ');

  return `<div class="match" data-id="${esc(m.id)}">
    <div class="match-main">
      <div class="teams">
        <div><span class="meta-line">${esc(m.away?.abbrev || '')}</span> ${esc(m.away?.name || 'Away')}</div>
        <div><span class="meta-line">${esc(m.home?.abbrev || '')}</span> ${esc(m.home?.name || 'Home')}</div>
      </div>
      <div class="match-when">
        <div>${esc(phase)} ${score ? `<strong>${esc(score)}</strong>` : ''}</div>
        <div class="meta-line">${esc(m.leagueName || m.league || '')}${m.venue ? ` · ${esc(m.venue)}` : ''}</div>
        <div>${bands}</div>
      </div>
      <div class="match-right">
        <button class="btn sm match-toggle" data-target="an-${esc(m.id)}">Analysis ▸</button>
      </div>
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
    <div class="tip-actions"><button class="btn sm copy-tip" data-text="${esc(t.text)}">📋 Copy tip</button></div>
  </div>`;
}

function renderAnalysis(m, r) {
  if (!r) return '<div class="card-body meta-line">No scored result for this match.</div>';
  const blocks = [
    ['Win match outright — favourite', r.winMatch.favourite],
    ['Win match outright — underdog', r.winMatch.underdog],
    ['Run line — favourite', r.runLine.favourite],
  ];
  const rows = blocks.map(([label, side]) => `
    <div class="detail">
      <div class="detail-grid"><strong>${esc(label)}</strong> <span class="mono">${side.score}/100</span></div>
      <table class="trow"><tbody>
        ${side.components.map((c) => `<tr><td>${esc(c.label)}</td><td class="mono">${c.points > 0 ? '+' : ''}${c.points}${c.max ? `/${c.max}` : ''}</td><td class="meta-line">${esc(c.detail)}${c.missing ? ' <span class="miss">(not sourced)</span>' : ''}</td></tr>`).join('')}
      </tbody></table>
    </div>`).join('');

  const totalRows = [...r.total.over, ...r.total.under, ...r.total.neutral]
    .map((c) => `<tr><td>${esc(c.label)}</td><td class="mono">${c.points > 0 ? '+' : ''}${c.points}</td><td class="meta-line">${esc(c.detail)}${c.missing ? ' <span class="miss">(not sourced)</span>' : ''}</td></tr>`).join('');

  const links = [
    { label: 'MLB StatsAPI schedule', url: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${esc(m.dateISO || '')}` },
    { label: 'MLB standings', url: 'https://www.mlb.com/standings' },
    { label: 'MLB StatsAPI standings', url: 'https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026' },
    { label: 'ESPN MLB scoreboard', url: 'https://www.espn.com/mlb/scoreboard' },
    { label: 'OLBG baseball markets', url: 'https://www.olbg.com/betting-tips/Baseball/12' },
  ].filter(Boolean);

  return `<div class="card-body">
    <div class="detail-grid">
      <span>Win match</span><span>${esc(r.winMatch.decision.confidence)} · ${esc(r.winMatch.decision.reason)}</span>
      <span>Run line</span><span>${esc(r.runLine.decision.confidence)} · ${esc(r.runLine.decision.reason)}</span>
      <span>Game total</span><span>${esc(r.total.decision.confidence)} · ${esc(r.total.decision.reason)}</span>
      <span>Starter</span><span>${esc(r.home.starter?.name || 'not confirmed')} / ${esc(r.away.starter?.name || 'not confirmed')}</span>
      <span>Price</span><span>${r.odds.provider ? esc(r.odds.provider) : 'not sourced'} · sources: ${r.odds.sourceCount ?? 0}</span>
      <span>Underdog value</span><span>${r.underdogValue ? `${esc(r.dog)} meets the value criteria` : 'no value underdog on this card'}</span>
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

function renderTipRail(card) {
  const tips = (card?.written?.tips || []).filter((t) => !t.skip);
  if (!tips.length) return '<div class="card-body meta-line">No active picks on this date. Every match resolved to SKIP; open an analysis panel to see which inputs were missing.</div>';
  return tips.map((t) => `<div class="rail-item">
    <div class="meta-line">${esc(t.fixture)}</div>
    <div class="rail-pick"><strong>${esc(t.text.match(/\*\*([^*]+)\*\*/)?.[1] || t.label)}</strong> · ${esc(t.label)} <span class="badge ${t.confidence}">${t.confidence}</span></div>
  </div>`).join('');
}

function renderRail(card) {
  $('#rail-preds').innerHTML = renderTipRail(card);
  const active = card?.written?.summary?.active || [];
  const valueNote = card?.written?.valueNote || '';
  $('#rail-count').innerHTML = active.length
    ? `${active.length} active pick${active.length === 1 ? '' : 's'}<br>${esc(valueNote)}`
    : esc(valueNote) || 'No active picks on this date.';
}

function renderDateStrip() {
  const strip = $('#datestrip');
  const days = [];
  for (let i = -3; i <= 10; i += 1) days.push(addDays(state.date, i));
  strip.innerHTML = days.map((d) => {
    const n = matchesFor(d).length;
    const on = d === state.date;
    return `<button class="seg ${on ? 'on' : ''}" data-date="${d}">
      <span class="meta-line">${esc(d.slice(5))}</span><strong>${n || '·'}</strong></button>`;
  }).join('');
  $$('#datestrip .seg').forEach((b) => { b.onclick = () => go(b.dataset.date); });
}

function renderCalendar() {
  const month = state.calMonth;
  const y = month.getUTCFullYear();
  const mo = month.getUTCMonth();
  $('#cal-title').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const first = new Date(Date.UTC(y, mo, 1));
  const startPad = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push('<span></span>');
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = matchesFor(iso).length;
    cells.push(`<button class="seg ${iso === state.date ? 'on' : ''}" data-date="${iso}">
      <span>${d}</span>${n ? `<strong>${n}</strong>` : ''}</button>`);
  }
  $('#calgrid').innerHTML = cells.join('');
  $$('#calgrid .seg[data-date]').forEach((b) => { b.onclick = () => go(b.dataset.date); });
}

function renderOlbgBox() {
  const slate = state.docs?.slate;
  const box = $('#olbg-box');
  if (!slate?.events?.length) {
    box.querySelector('.card-body').innerHTML = 'No OLBG rows committed. The collector writes them from <a href="https://www.olbg.com/betting-tips/Baseball/12" target="_blank" rel="noopener noreferrer">the live index</a>.';
    return;
  }
  box.querySelector('.card-body').innerHTML = `<div class="srclist">
    ${slate.events.map((e) => `<div class="olbg-row">
      <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.home)} @ ${esc(e.away)} ↗</a>
      <div class="meta-line">${esc(e.league)} · ${esc(e.display_date || e.resolved_date || '')} · ${esc(e.market || 'Money Line')}${e.tips_total ? ` · ${e.tips_for}/${e.tips_total} tips` : ''}</div>
    </div>`).join('')}
    <div class="meta-line">OLBG publishes tipster consensus, not prices. Fetched ${esc(slate.fetched_at_utc || '')}.</div>
  </div>`;
}

function renderCoverage() {
  const d = state.docs || {};
  const counts = {
    fixtures: d.fixtures?.fixtures?.length || 0,
    settled: d.tape?.games?.length || 0,
    standings: Object.keys(d.standings?.teams || {}).length,
    teamStats: Object.keys(d.teamStats?.teams || {}).length,
    pitchers: Object.keys(d.pitchers?.pitchers || {}).length,
    olbg: d.slate?.events?.length || 0,
  };
  const lines = Object.entries(counts).map(([k, v]) => `<div>${esc(k)}: <strong>${v}</strong>${v ? '' : ' <span class="miss">empty</span>'}</div>`).join('');
  const feed = state.feedNote?.length
    ? `<div class="meta-line" style="margin-top:6px">Live feeds: ${state.feedNote.map((f) => `${esc(f.feed)} ${f.status === 200 ? 'ok' : `failed (${esc(f.error || f.status)})`}`).join(' · ')}</div>`
    : '';
  $('#coverage').innerHTML = `${lines}
    <div class="meta-line" style="margin-top:6px">Committed data loaded ${esc(relTime(state.loadedAt))}. Empty documents mean the engine records those factors as missing and reduces the score — it never fills them in.</div>${feed}`;
}

function renderBacktest() {
  const b = state.docs?.backtest;
  if (!b) { $('#backtest').textContent = 'No backtest document committed.'; return; }
  const r = b.results || {};
  $('#backtest').innerHTML = `
    <div>graded: <strong>${r.graded ?? 0}</strong> settled games</div>
    <div>overall hit rate: <strong>${r.overall_hit_rate_pct == null ? 'not yet measurable' : `${r.overall_hit_rate_pct}%`}</strong></div>
    <div class="meta-line">Run line: ${esc(r.run_line?.reason || 'ungraded')}</div>
    <div class="meta-line">Game total: ${esc(r.game_total?.reason || 'ungraded')}</div>
    <div class="meta-line">ROI: ${esc(r.roi_reason || 'not computed')}</div>`;
}

function renderSources() {
  const p = state.docs?.provenance;
  if (!p?.sources?.length) { $('#sources').textContent = 'No provenance document committed.'; return; }
  // A source may legitimately carry no HTTP status (the OLBG slate collector
  // records none), so the status and request count are shown only when the
  // register actually holds them rather than printing "HTTP null".
  $('#sources').innerHTML = `<div class="srclist">${p.sources.map((s) => {
    const bits = [esc((s.provides || []).join(', '))];
    if (s.verified_utc) bits.push(`verified ${esc(s.verified_utc)}`);
    if (s.status != null) bits.push(`HTTP ${esc(String(s.status))}`);
    if (s.requests != null) bits.push(`${esc(String(s.requests_ok))}/${esc(String(s.requests))} requests ok`);
    return `
    <div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>
    <div class="meta-line">${bits.filter(Boolean).join(' · ')}</div></div>`;
  }).join('')}
    <div class="meta-line" style="margin-top:6px">${(p.irregularities || []).map((i) => `<div><strong>${esc(i.id)}</strong> ${esc(i.title)} — ${esc(i.effect)}</div>`).join('')}</div>
  </div>`;
}

boot();
