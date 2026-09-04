/**
 * SportsPred — Scottish Open sub-page (scottish-open.html).
 *
 * Golf is an outright sport on its own page (golf.html). This page is the one
 * tournament that carries its own master prompt: the SCOTTISH OPEN GOLF
 * PREDICTION MASTER PROMPT v1.0. It shows:
 *
 *   1. the venue dossier and the line-by-line verification of every claim the
 *      prompt makes about the event, each with its source link;
 *   2. the forward card for the next edition as soon as one is published, on
 *      load and again on the Generate button;
 *   3. a retrospective card for every edition in the committed results tape,
 *      scored walk-forward (only history that ended before round one) and then
 *      graded against the published leaderboard;
 *   4. the OLBG golf market slate, matched to this event when it appears.
 *
 * Nothing here is invented: a factor no free source publishes is displayed as
 * missing with the reason, and every number links to the row it came from.
 */

import { getSport } from '../../engine/registry.js';
import { buildResultsIndex, normName } from '../../engine/golf_data.js';
import { buildGolfEventCard, owgrLookup, statsLookup, sgLookup, linksCourseSet } from '../../engine/golf_card.js';
import { MARKETS, MARKET_ORDER, PROMPT_TITLE, RULESET_VERSION } from '../../engine/golf_scottish_open.js';
import { loadStatic, TTL } from './data-client.js';
import { $, $$, esc, fmtDateLong, renderShell, renderFooter, toast, copyText, confBar } from './ui.js';

const state = {
  sport: null,
  docs: null,
  dossier: null,
  backtest: null,
  cards: new Map(),     // eventId -> card
  upcoming: [],         // events on the board that match the overlay
  editions: [],         // reconstructed historical events
  loadedAt: null,
};

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */

async function boot() {
  state.sport = getSport('golf');
  renderShell({ activeSport: 'golf', activePage: 'scottish-open.html' });
  renderFooter();
  renderTabs();
  renderStatic();
  await loadDocs();
  collectEditions();
  collectUpcoming();
  generateAll();
  renderDossier();
  renderFacts();
  renderUpcoming();
  renderRetro();
  renderRail();
  renderBacktest();
  renderOlbg();
  wireControls();
  state.loadedAt = Date.now();
}

function renderTabs() {
  const tabs = [
    { label: 'Golf', href: 'golf.html', name: 'All golf tournaments — generic GOLF TOURNAMENT PREDICTION MASTER PROMPT v1.0' },
    { label: 'Scottish Open', href: 'scottish-open.html', name: 'The Renaissance Club — SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0' },
  ];
  $('#tabs').innerHTML = tabs.map((t) => `<a href="${esc(t.href)}" class="${t.href === 'scottish-open.html' ? 'on' : ''}" title="${esc(t.name)}">${esc(t.label)}</a>`).join('');
}

function renderStatic() {
  const s = state.sport;
  $('#sport-links').innerHTML = [
    ...(s?.officialLinks || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`),
    '<a href="https://www.europeantour.com/dpworld-tour/genesis-scottish-open-2026/" target="_blank" rel="noopener noreferrer">DP World Tour event page ↗</a>',
    '<a href="https://www.therenaissanceclub.com/" target="_blank" rel="noopener noreferrer">The Renaissance Club ↗</a>',
  ].join(' · ');
}

async function loadDocs() {
  const [events, results, rankings, stats, weather, slate, links, dossier, backtest] = await Promise.all([
    loadStatic('data/golf_events.json'),
    loadStatic('data/golf_results.json'),
    loadStatic('data/golf_rankings.json'),
    loadStatic('data/golf_stats.json'),
    loadStatic('data/golf_weather.json', TTL.REGISTRY),
    loadStatic('data/golf_slate.json'),
    loadStatic('data/golf_links_courses.json'),
    loadStatic('data/golf_scottish_open.json'),
    loadStatic('data/golf_scottish_open_backtest.json'),
  ]);
  state.docs = {
    eventsDoc: events.data || { events: [], calendars: {} },
    resultsDoc: results.data || { players: {}, events: {} },
    rankingsDoc: rankings.data || null,
    statsDoc: stats.data || null,
    weatherDoc: weather.data || null,
    slateDoc: slate.data || null,
    linksDoc: links.data || null,
  };
  state.dossier = dossier.data || null;
  state.backtest = backtest.data || null;
  state.shared = {
    index: buildResultsIndex(state.docs.resultsDoc),
    owgr: owgrLookup(state.docs.rankingsDoc),
    stats: statsLookup(state.docs.statsDoc),
    sg: sgLookup(state.docs.statsDoc),
    links: linksCourseSet(state.docs.linksDoc),
  };
  const notes = [];
  if (!dossier.data) notes.push('The venue dossier (<code>data/golf_scottish_open.json</code>) is not committed yet — run <code>node scripts/build_scottish_open.mjs</code>. Until then the verified-facts panel is empty and nothing is asserted.');
  if (!results.data) notes.push('The committed results tape is not present yet, so no edition can be reconstructed and every history factor would be missing.');
  if (!links.data) notes.push('The cited links venue list is not committed yet, so the wind and links proxy can only use The Open Championship.');
  $('#notes').innerHTML = notes.map((n) => `<div class="note">${n}</div>`).join('');
}

/* ------------------------------------------------------------------ *
 * events: upcoming on the board, and historical editions from the tape
 * ------------------------------------------------------------------ */

const SCOTTISH = /scottish open/i;

/** Rebuild a scoreable event row from a results-tape entry. */
function eventFromTape(entry, eventId, players) {
  return {
    id: String(eventId),
    name: entry.name,
    shortName: entry.name,
    tour: entry.tour,
    tourName: entry.tour === 'pga' ? 'PGA TOUR' : 'DP World Tour',
    tournamentId: entry.tournamentId != null ? String(entry.tournamentId) : null,
    startDate: entry.startDate,
    endDate: entry.endDate,
    seasonYear: entry.seasonYear,
    state: 'post',
    completed: true,
    purse: entry.purse,
    major: entry.major === true,
    course: { id: entry.courseId, name: entry.courseName, yards: entry.yards, par: entry.par },
    courseName: entry.courseName,
    courseId: entry.courseId,
    sources: { espnLeaderboard: entry.sourceUrl || `https://www.espn.com/golf/leaderboard?tournamentId=${eventId}` },
    field: (entry.rows || []).map((row) => {
      const p = players[row[0]] || {};
      return {
        athleteId: String(row[0]), name: p.name || `Player ${row[0]}`,
        country: p.country ?? null, countryCode: p.countryCode ?? null,
        teeTime: null, amateur: false,
        position: row[1] ?? null, result: row[2] ?? null, toPar: row[3] ?? null,
      };
    }),
  };
}

function collectEditions() {
  const players = state.docs.resultsDoc.players || {};
  state.editions = Object.entries(state.docs.resultsDoc.events || {})
    .filter(([, e]) => SCOTTISH.test(e.name || '') && !/women/i.test(e.name || ''))
    .map(([id, e]) => eventFromTape(e, id, players))
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

function collectUpcoming() {
  const today = new Date().toISOString().slice(0, 10);
  state.upcoming = (state.docs.eventsDoc.events || [])
    .filter((e) => SCOTTISH.test(e.name || '') && !/women/i.test(e.name || '') && String(e.endDate || e.startDate || '').slice(0, 10) >= today)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

/* ------------------------------------------------------------------ *
 * prediction generation — automatic, and on the button
 * ------------------------------------------------------------------ */

export function generateAll({ force = false } = {}) {
  let made = 0;
  const events = [...state.upcoming, ...state.editions];
  const docs = { ...state.docs, ...state.shared, eventsDoc: { events } };
  for (const ev of events) {
    if (!force && state.cards.has(ev.id)) continue;
    try {
      const card = buildGolfEventCard(docs, ev.id);
      if (card) { state.cards.set(ev.id, card); made += 1; }
    } catch (err) {
      console.error(`scottish open card ${ev.id} failed`, err);
      $('#notes').insertAdjacentHTML('beforeend', `<div class="note">Card build failed for ${esc(ev.name)}: ${esc(err.message)}</div>`);
    }
  }
  return made;
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function componentRows(cand) {
  return (cand.components || []).map((c) => `
    <tr><th>${esc(c.label)}<div class="meta-line"><code>${esc(c.id)}</code>${c.missing ? ' <span class="badge SKIP">missing</span>' : ''}</div><div class="meta-line">${esc(c.detail || '')}</div></th>
      <td class="num">${c.points === 0 ? '—' : (c.points > 0 ? '+' : '') + c.points}${c.max ? `<span class="meta-line" style="display:inline"> / ${c.max}</span>` : ''}</td></tr>`).join('');
}

function cardHtml(card, { retro = false } = {}) {
  if (!card) return '<div class="card-body meta-line">No card built.</div>';
  if (card.scored.unscored) return `<div class="card-body meta-line">${esc((card.scored.flags || []).join('; '))} — missing: ${esc((card.scored.missing || []).join('; '))}</div>`;
  const v = card.validation;
  const g = card.grades;
  const gradeHtml = g ? `<div class="tip-meta" style="margin-top:8px"><span class="badge ghost">RETROSPECTIVE</span>
    <span class="meta-line">Scored from history that ended before round one, then graded against the published leaderboard:
    ${MARKET_ORDER.map((k) => `${esc(MARKETS[k])} <span class="badge ${g[k]?.status === 'HIT' ? 'HIGH' : g[k]?.status === 'MISS' ? 'SKIP' : 'ghost'}">${esc(g[k]?.status || 'n/a')}</span>`).join(' · ')}</span></div>` : '';
  return `
  <div class="detail-grid">
    <div>
      <div class="tipbox">
        <div class="tip-meta">
          <span class="badge ${v?.ok ? 'HIGH' : 'SKIP'}">${v?.ok ? 'CARD VALIDATED' : 'CARD HAS ISSUES'}</span>
          <span class="badge ghost">${esc(card.ruleset || RULESET_VERSION)}</span>
          <span class="meta-line">${card.written.tips.filter((t) => !t.skip).length} selections · ${card.written.tips.filter((t) => t.skip).length} markets written as NO SELECTION</span>
          <button class="btn sm" data-copycard="${esc(card.event.id)}">Copy card</button>
        </div>
        ${card.written.blocks.map((b) => `<p><strong>${esc(b.title)}</strong></p>${b.tips.map((t) => `<p>${t.valuePick ? '<span class="badge MEDIUM">VALUE PICK</span> ' : ''}${esc(t.text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`).join('')}`).join('')}
        <table class="kv" style="margin-top:10px"><thead><tr><th>Market</th><th>Selection</th><th class="num">Confidence</th>${retro ? '<th class="num">Result</th>' : ''}</tr></thead>
          <tbody>${card.written.summary.map((r) => `<tr><th>${esc(r.market)}</th><td>${esc(r.selection)}${r.valuePick ? ' <span class="badge ghost">VALUE</span>' : ''}</td><td class="num"><span class="badge ${esc(r.band)}">${esc(r.band)}</span></td>${retro ? `<td class="num"><span class="badge ${g?.[Object.keys(MARKETS).find((k) => MARKETS[k] === r.market)]?.status === 'HIT' ? 'HIGH' : 'ghost'}">${esc(g?.[Object.keys(MARKETS).find((k) => MARKETS[k] === r.market)]?.status || '')}</span></td>` : ''}</tr>`).join('')}</tbody></table>
        <p class="meta-line" style="margin-top:8px">${esc(card.written.waveNote || card.written.weatherNote || '')}</p>
        ${v && !v.ok ? `<p class="meta-line"><strong>Validator issues:</strong> ${esc(v.issues.map((i) => `${i.market || ''} ${i.player || ''}: ${i.violations.join('; ')}`).join(' | '))}</p>` : ''}
        ${gradeHtml}
      </div>
      ${card.scored.flags.length ? `<p class="meta-line" style="margin-top:10px"><strong>Flags for review</strong></p><ul class="miss">${card.scored.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <p class="meta-line" style="margin-top:10px"><strong>Not available for this event</strong></p>
      <ul class="miss">${card.scored.missing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="meta-line"><strong>Coverage:</strong> ${card.coverage.scored} scored · ${card.coverage.withHistory} with history · ${card.coverage.owgrMatched} ranked · ${card.coverage.sgMatched} with strokes gained · ${card.coverage.teeTimes} tee times · ${card.coverage.priorEditionsInTape} prior edition(s) in tape</p>
      <ul class="srclist">${card.sources.map((s) => `<li>→ <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}</ul>
    </div>
    <div>${MARKET_ORDER.map((k) => {
      const m = card.scored.markets[k];
      const sel = m?.selections || [];
      return `
      <details ${k === 'outright' ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:700;font-size:13px;padding:6px 0">${esc(m?.label || k)} — ${sel.length ? sel.map((s) => `${esc(s.name)} <span class="badge ${esc(s.band)}">${esc(s.band)}</span> ${s.score}${s.valuePick ? ' <span class="badge ghost">VALUE</span>' : ''}${s.coSelection ? ' <span class="badge ghost">CO-SELECTION</span>' : ''}`).join(', ') : '<span class="badge SKIP">NO SELECTION</span>'}</summary>
        ${m?.note ? `<p class="meta-line">${esc(m.note)}</p>` : ''}
        ${sel.map((s) => `
          <p class="meta-line" style="margin:8px 0 4px"><strong>${esc(s.name)}</strong> · field rank by OWGR ${s.fieldRank ?? 'n/a'} · <a href="${esc(s.profile?.sources?.espnPlayer || '#')}" target="_blank" rel="noopener noreferrer">ESPN player ↗</a>${s.profile?.sources?.owgr ? ` · <a href="${esc(s.profile.sources.owgr)}" target="_blank" rel="noopener noreferrer">OWGR ↗</a>` : ''}</p>
          <table class="kv"><tbody>${componentRows(s)}</tbody></table>
          ${s.missing?.length ? `<ul class="miss">${s.missing.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`).join('')}
      </details>`;
    }).join('')}</div>
  </div>`;
}

function renderUpcoming() {
  const box = $('#upcoming');
  if (!state.upcoming.length) {
    const unconfirmed = (state.dossier?.facts || []).find((f) => f.id === 'next-edition-dates');
    $('#next-title').textContent = 'Next edition — not yet published';
    box.innerHTML = `<div class="card-body">
      <p>No upcoming edition of this tournament is on the board. The committed season calendars and the live ESPN feeds are both checked on load, and neither publishes a field yet — so nothing is predicted, because there is nothing sourced to predict from.</p>
      ${unconfirmed ? `<p class="meta-line"><strong>Dates:</strong> ${esc(unconfirmed.evidence)} <a href="${esc(unconfirmed.source)}" target="_blank" rel="noopener noreferrer">source ↗</a></p>` : ''}
      <p class="meta-line">The moment an edition appears in <code>data/golf_events.json</code> or on the live feed, this page scores all five markets for it automatically and the Generate button re-scores it. The retrospective cards below show exactly what that output looks like, graded against results.</p>
    </div>`;
    return;
  }
  $('#next-title').textContent = `Next edition — ${state.upcoming.length} on the board`;
  box.innerHTML = state.upcoming.map((ev) => `
    <div class="lg-head"><span>${esc(ev.tourName || ev.tour)}</span><span class="count">${(ev.field || []).length || ev.fieldSize || 0} players</span>
      <a href="${esc(ev.sources?.espnLeaderboard || `https://www.espn.com/golf/leaderboard?tournamentId=${ev.id}`)}" target="_blank" rel="noopener noreferrer">ESPN leaderboard ↗</a></div>
    <div class="match"><div class="match-main" style="grid-template-columns:110px 1fr auto">
      <div class="match-when"><div class="t">${esc(String(ev.startDate).slice(0, 10))}</div><span class="s">${esc(ev.statusDetail || 'Scheduled')}</span></div>
      <div class="teams"><div class="trow"><span class="nm" style="font-size:15px">${esc(ev.name)}</span></div>
        <div class="meta-line">${esc(ev.course?.name || 'Venue not published')}${ev.course?.city ? ` · ${esc(ev.course.city)}` : ''}${ev.course?.yards ? ` · ${ev.course.yards} yds, par ${ev.course.par}` : ''}</div></div>
      <div class="match-right"><button class="btn sm" data-copycard="${esc(ev.id)}">Copy card</button></div>
    </div>
    ${cardHtml(state.cards.get(ev.id))}
    </div>`).join('');
  wireCopy(box);
}

function renderRetro() {
  const box = $('#retro');
  $('#retro-meta').textContent = `${state.editions.length} edition(s) in the committed tape`;
  if (!state.editions.length) { box.innerHTML = '<div class="card-body meta-line">No edition of this tournament is in the committed results tape yet.</div>'; return; }
  box.innerHTML = state.editions.map((ev) => {
    const card = state.cards.get(ev.id);
    const winner = (ev.field || []).find((p) => p.position === 1);
    return `
    <div class="lg-head"><span>${esc(ev.tourName)}</span><span class="count">${(ev.field || []).length} players</span>
      <a href="${esc(ev.sources?.espnLeaderboard)}" target="_blank" rel="noopener noreferrer">ESPN leaderboard ↗</a></div>
    <div class="match"><div class="match-main" style="grid-template-columns:110px 1fr auto">
      <div class="match-when"><div class="t">${esc(String(ev.startDate).slice(0, 10))}</div><span class="s ft">FINAL</span></div>
      <div class="teams"><div class="trow"><span class="nm" style="font-size:15px">${esc(ev.name)} ${esc(String(ev.startDate).slice(0, 4))}</span></div>
        <div class="meta-line">${esc(ev.course?.name || '')} · ${ev.course?.yards || ''} yds, par ${ev.course?.par || ''}${winner ? ` · won by ${esc(winner.name)} at ${winner.toPar}` : ''}</div></div>
      <div class="match-right"><button class="btn sm" data-copycard="${esc(ev.id)}">Copy card</button></div>
    </div>
    ${cardHtml(card, { retro: true })}
    </div>`;
  }).join('');
  wireCopy(box);
}

function renderDossier() {
  const d = state.dossier;
  if (!d) { $('#dossier').innerHTML = '<p class="meta-line">Dossier not committed.</p>'; return; }
  const ev = d.event || {};
  $('#dossier-meta').textContent = `verified ${d.verified_at_utc || ''}`;
  $('#dossier').innerHTML = `
    <p><strong>${esc(ev.name || 'Scottish Open')}</strong> · ${esc(ev.host || '')} · ruleset <code>${esc(ev.ruleset || RULESET_VERSION)}</code></p>
    <ul class="srclist">
      ${(ev.olbg || []).map((o) => `<li>→ <a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.label)}</a></li>`).join('')}
    </ul>`;
  const rows = d.venue_history?.rows || [];
  $('#history-table tbody').innerHTML = rows.map((r) => `
    <tr><td class="num">${esc(r.year)}</td><td>${esc(r.winner || 'unknown')}</td>
      <td class="num">${r.toPar === null || r.toPar === undefined ? '' : r.toPar}</td>
      <td><span class="badge ${r.provenance === 'measured' ? 'HIGH' : 'ghost'}">${esc(r.provenance)}</span></td>
      <td class="meta-line"><a href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${r.provenance === 'measured' ? 'ESPN leaderboard' : 'published history table'} ↗</a></td></tr>`).join('');
  const range = d.venue_history?.winningScoreRange;
  $('#history-note').innerHTML = `${esc(d.venue_history?.note || '')}${range ? ` Measured range across ${range.sample} editions: <strong>${range.best}</strong> to <strong>${range.worst}</strong> — the spread the prompt describes.` : ''}`;
}

function renderFacts() {
  const facts = state.dossier?.facts || [];
  $('#facts-meta').textContent = `${facts.filter((f) => f.status === 'CONFIRMED').length} confirmed · ${facts.filter((f) => f.status !== 'CONFIRMED').length} unconfirmed`;
  $('#facts').innerHTML = facts.length ? `<div class="card-body tight"><table class="data"><thead><tr><th>Claim in the prompt</th><th>Status</th><th>Evidence and source</th></tr></thead><tbody>
    ${facts.map((f) => `<tr>
      <td><code>${esc(f.id)}</code><div class="meta-line">${esc(f.claim)}</div></td>
      <td><span class="badge ${f.status === 'CONFIRMED' ? 'HIGH' : 'SKIP'}">${esc(f.status)}</span></td>
      <td class="meta-line">${esc(f.evidence)}<br><a href="${esc(f.source)}" target="_blank" rel="noopener noreferrer">primary source ↗</a>${(f.secondary || []).map((s) => { const url = s.split(' ')[0]; const label = s.slice(url.length).trim(); return ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">secondary ↗</a>${label ? ` <span class="meta-line">${esc(label)}</span>` : ''}`; }).join('')}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="card-body meta-line">No verified facts committed.</div>';
}

function renderRail() {
  const out = [];
  for (const ev of [...state.upcoming, ...state.editions]) {
    const card = state.cards.get(ev.id);
    if (!card?.written) continue;
    for (const t of card.written.tips) if (!t.skip) out.push({ ...t, event: `${ev.name} ${String(ev.startDate).slice(0, 4)}`, eventId: ev.id });
  }
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  out.sort((a, b) => (order[a.band] ?? 3) - (order[b.band] ?? 3) || (b.score ?? 0) - (a.score ?? 0));
  $('#rail-preds').innerHTML = out.length ? out.slice(0, 12).map((t, i) => `
    <div class="rail-item"><span class="r-num">${i + 1}</span><span class="r-body">
      <span class="r-sel">${esc(t.name)}</span>
      <span class="badge ${esc(t.band)}" style="margin-left:6px">${esc(t.band)}</span>${t.valuePick ? ' <span class="badge ghost">VALUE</span>' : ''}
      <div class="r-match">${esc(t.event)} · ${esc(t.market)}</div></span></div>`).join('')
    : '<div class="card-body meta-line">No selection cleared a threshold.</div>';
  $('#rail-count').textContent = `${out.length} selections across ${state.cards.size} card(s)`;
}

function renderBacktest() {
  const b = state.backtest;
  const box = $('#backtest');
  if (!b || !b.aggregate) { box.innerHTML = '<p class="meta-line">Ledger not committed yet — run <code>node scripts/backtest_scottish_open.mjs</code>.</p>'; return; }
  const rows = Object.entries(b.aggregate).map(([k, v]) => `
    <tr><th>${esc(MARKETS[k] || k)}</th><td class="num">${v.hit}/${v.total}</td><td class="num">${v.hitRate === null ? '—' : `${v.hitRate}%`}</td><td class="num">${v.skipped}</td></tr>`).join('');
  box.innerHTML = `<table class="kv"><thead><tr><th>Market</th><th class="num">Hit</th><th class="num">Rate</th><th class="num">No sel.</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="meta-line" style="margin-top:8px">${esc((b.notes || []).join(' '))}</p>
    <p class="meta-line">Generated ${esc(String(b.generated_at_utc || '').slice(0, 10))} · <a href="data/golf_scottish_open_backtest.json" target="_blank" rel="noopener noreferrer">full ledger ↗</a></p>`;
}

function renderOlbg() {
  const box = $('#olbg-box');
  const slate = state.docs?.slateDoc;
  if (!slate) { box.innerHTML = '<div class="card-body meta-line">The OLBG golf slate is not committed yet.</div>'; return; }
  const rows = slate.events || [];
  const hits = rows.filter((r) => SCOTTISH.test(r.event_name || ''));
  box.innerHTML = `
    <div class="card-body meta-line">
      <p><a href="${esc(slate.source?.url || 'https://www.olbg.com/betting-tips/Golf/5')}" target="_blank" rel="noopener noreferrer">${esc(slate.source?.name || 'OLBG Golf')} ↗</a> · collected ${esc(String(slate.source?.fetched_at_utc || '').slice(0, 10))}</p>
      <p>${hits.length
        ? `<strong>${hits.length}</strong> row(s) on the board match this tournament:`
        : 'No row on the current board matches this tournament, which is what is expected between editions. Every golf market OLBG lists stays on the <a href="golf.html">golf page</a>.'}</p>
      <ul class="srclist">${(hits.length ? hits : rows).map((r) => `<li>→ <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.event_name)}</a>${r.consensus?.market ? ` · ${esc(r.consensus.market)}${r.consensus.selection ? ` · ${esc(r.consensus.selection)}` : ''}` : ''}</li>`).join('')}</ul>
      <p>Display only. OLBG publishes tipster votes, never prices, so nothing here is scored.</p>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * controls
 * ------------------------------------------------------------------ */

function wireCopy(root) {
  $$('[data-copycard]', root).forEach((b) => b.addEventListener('click', async () => {
    const card = state.cards.get(b.dataset.copycard);
    if (!card?.written) { toast('No card written for this edition'); return; }
    const ok = await copyText(card.written.cardText.replace(/\*\*/g, ''));
    toast(ok ? 'Card copied to clipboard' : 'Copy failed — select the text manually');
  }));
}

/** Why a Generate click produced no card, stated as the real reason. */
function noCardReasonSo() {
  const d = state.docs || {};
  if (!d.resultsDoc?.events || !Object.keys(d.resultsDoc.events).length) {
    return 'Nothing to score — the committed results tape (data/golf_results.json) did not load. '
      + 'A page opened from a file:// URL cannot fetch data/*.json; serve the folder (npm run serve) or use the published site.';
  }
  if (!state.upcoming.length && !state.editions.length) {
    return 'Nothing to score — no edition of this tournament is on the board and none is in the committed results tape.';
  }
  return 'Nothing to score — the documents loaded but no edition matched this tournament.';
}

function wireControls() {
  $('#generate').addEventListener('click', () => {
    const made = generateAll({ force: true });
    renderUpcoming();
    renderRetro();
    renderRail();
    toast(made ? `${made} card(s) re-scored under ${PROMPT_TITLE}` : noCardReasonSo());
  });
  $('#copy-all').addEventListener('click', async () => {
    const cards = [...state.cards.values()].filter((c) => c.written);
    if (!cards.length) { toast('No cards to copy'); return; }
    const text = cards.map((c) => c.written.cardText.replace(/\*\*/g, '')).join('\n\n---\n\n');
    const ok = await copyText(text);
    toast(ok ? `${cards.length} card(s) copied` : 'Copy failed — select the text manually');
  });
  wireCopy(document);
}

boot().catch((err) => {
  console.error(err);
  const n = $('#notes');
  if (n) n.insertAdjacentHTML('beforeend', `<div class="note">This page failed to start: ${esc(err.message)}</div>`);
});
