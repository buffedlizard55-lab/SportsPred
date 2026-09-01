/**
 * SportsPred — site controller.
 *
 * Scoring and writing are imported from /engine so the browser runs exactly the
 * code the test suite covers. This file only does I/O, joining and rendering.
 *
 * DATA POLICY
 * Nothing is invented here. Live data is collected from ESPN's public, key-less
 * endpoints in the visitor's browser; any field ESPN does not publish stays
 * null, the engine records it as missing, and the UI shows it under
 * "Data quality". Odds are never sourced (IR-01), so odds-dependent factors are
 * permanently unscored and the site says so instead of implying a price.
 */

import { scoreMatch, scoreCard, RULESET_VERSION, PATCHES, PROMPT_VERSION, CONFIDENCE } from '../../engine/engine.js';
import { writeCard, MIN_WORDS } from '../../engine/writer.js';
import { buildSlateIndex, matchSlateEvent } from '../../engine/join.js';
import { olbgDateCounts, olbgSummaryForDate, olbgEventsForDate, olbgOutrightsForDate, adjacentOlbgDates } from '../../engine/olbg.js';
import { collectCard, toEngineMatch, isoDate, TAPE_DAYS } from './collector.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const todayISO = () => new Date().toISOString().slice(0, 10);

const state = {
  surfaces: null,
  provenance: null,
  slate: null,          // OLBG snapshot (secondary, verified separately)
  slateIndex: new Map(),
  date: todayISO(),
  card: null,           // last collected card
  scored: null,
  phase: 'all',
  search: '',
  calMonth: null,
  tips: [],
  lastCard: null,
  loading: false,
};

/* ------------------------------------------------------------------ *
 * Load
 * ------------------------------------------------------------------ */

async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

async function boot() {
  state.calMonth = new Date(`${state.date}T12:00:00Z`);

  try {
    state.surfaces = await loadJSON('data/surfaces.json');
  } catch (e) {
    fatal(`Could not load the surface map: ${e.message}`);
    return;
  }
  state.provenance = await loadJSON('data/provenance.json').catch(() => null);
  state.slate = await loadJSON('data/slate.json').catch(() => null);
  state.slateIndex = buildSlateIndex(state.slate);

  $('#ruleset-pill').textContent = `ruleset ${RULESET_VERSION} · prompt ${PROMPT_VERSION}`;
  $('#date-input').value = state.date;

  renderAbout();
  renderCalendar();
  renderOlbg();
  await loadDate(state.date);
}

function fatal(msg) {
  $('#match-list').innerHTML = `<div class="empty">${esc(msg)}</div>`;
}

/** Collect and score one date. */
async function loadDate(dateISO) {
  if (state.loading) return;
  state.loading = true;
  state.date = dateISO;
  state.card = null;
  state.scored = null;
  state.tips = [];
  $('#pred-out').innerHTML = '';
  $('#pred-table').innerHTML = '';
  $('#pred-warnings').innerHTML = '';
  $('#pred-hint').textContent = '';

  showProgress(`Collecting ${dateISO}…`, 2);
  try {
    const card = await collectCard(dateISO, state.surfaces, (msg, pct) => showProgress(msg, pct));
    state.card = card;
    state.scored = card.matches.map((m) => {
      const em = toEngineMatch(m, card);
      return { raw: m, match: em, result: scoreMatch(em) };
    });
    hideProgress();
  } catch (e) {
    hideProgress();
    fatal(`Live collection failed: ${e.message}. ESPN's public API may be unreachable from this network.`);
    state.loading = false;
    return;
  }
  state.loading = false;
  renderScoreboard();
  renderQuality();
  renderOlbg();
  renderStatusPills();
}

function showProgress(msg, pct) {
  const el = $('#progress');
  el.hidden = false;
  $('#progress-label').textContent = msg;
  $('#progress-bar').style.width = `${Math.max(2, Math.min(100, pct || 0))}%`;
}
function hideProgress() { $('#progress').hidden = true; }

function renderStatusPills() {
  const q = state.card?.quality;
  if (!q) return;
  $('#snapshot-pill').textContent = `collected ${q.collected_at_utc.slice(11, 19)}Z · ${q.tape_matches} history matches`;
  const src = $('#source-link');
  src.href = 'https://www.espn.com/tennis/scoreboard';
  src.textContent = 'ESPN source ↗';
}

/* ------------------------------------------------------------------ *
 * Scoreboard
 * ------------------------------------------------------------------ */

function renderScoreboard() {
  const list = $('#match-list');
  if (!state.scored) { list.innerHTML = '<div class="empty">Loading…</div>'; return; }

  const q = state.search.toLowerCase();
  const rows = state.scored.filter(({ raw }) => {
    if (state.phase !== 'all' && raw.phase !== state.phase) return false;
    if (q && !raw.players.map((p) => p.name).join(' ').toLowerCase().includes(q)) return false;
    return true;
  });

  // Distinguish "the feed failed" from "the calendar is genuinely empty".
  const feedFailed = (state.card?.quality?.scoreboard_failures?.length || 0) > 0;
  const slateMatches = state.scored.filter(({ raw }) => findSlateOverlay(raw)).length;
  $('#day-summary').textContent = state.scored.length
    ? `${state.date} — ${state.scored.length} singles match${state.scored.length === 1 ? '' : 'es'} `
      + `(${state.scored.filter((r) => r.raw.phase === 'results').length} finished, `
      + `${state.scored.filter((r) => r.raw.phase === 'live').length} in play, `
      + `${state.scored.filter((r) => r.raw.phase === 'upcoming').length} upcoming)`
      + (slateMatches ? ` · ${slateMatches} matched to the OLBG snapshot` : '')
    : feedFailed
      ? `${state.date} — the ESPN feed could not be reached, so nothing is known about this date. `
        + 'This is a collection failure, not an empty schedule.'
      : `${state.date} — no singles matches scheduled on ESPN for this date.`;

  if (!rows.length) {
    list.innerHTML = `<div class="empty">${
      feedFailed
        ? 'The ESPN feed could not be reached from this browser, so no matches could be collected. '
          + 'Nothing is shown rather than showing stale or invented data. Check your connection and reload.'
        : `No matches match the current filter for ${esc(state.date)}.`
    }</div>`;
    return;
  }

  list.innerHTML = rows.map(({ raw, match, result }) => {
    const unscored = result.favourite === null;
    const badges = unscored
      ? '<span class="badge warn">unscored — no sourced ranking</span>'
      : ['win_match', 'first_set', 'games_handicap']
        .map((m) => {
          const r = result.markets[m];
          if (!r) return '';
          return `<span class="badge ${r.band}" title="${label(m)} score ${r.score}">${label(m)} ${r.band}</span>`;
        }).join(' ');

    const score = raw.sets && raw.sets.length
      ? raw.sets.map((s) => `${s.a}-${s.b}`).join(' ')
      : '';
    const time = (raw.start_utc || '').slice(11, 16);
    const statusCls = raw.phase === 'live' ? 'live' : raw.phase;
    const olbg = findSlateOverlay(raw);
    const playersHtml = (match.players || []).map((p) => `
      <div class="player-audit">
        <strong>${esc(p.name)}</strong>
        <span>${esc(playerAuditLine(p, raw.surface))}</span>
      </div>`).join('');

    return `<div class="match" data-id="${esc(raw.competition_id)}">
      <div class="when">
        <span class="d ${statusCls}">${esc(raw.phase === 'results' ? 'FT' : raw.phase === 'live' ? 'LIVE' : time || 'TBC')}</span>
        <span class="tour">${esc(raw.tour || '')}</span>
      </div>
      <div>
        <div class="who">${esc(raw.players[0].name)}<span class="vs">v</span>${esc(raw.players[1].name)}</div>
        ${score ? `<div class="score">${esc(score)}${raw.winner_name ? ` · ${esc(raw.winner_name)} won` : ''}</div>` : ''}
        <div class="sub">${esc(raw.tournament || '')}${raw.round ? ` · ${esc(raw.round)}` : ''}
          · ${raw.surface ? esc(raw.surface) : '<em>surface unsourced</em>'}</div>
        <div class="sub">${badges}</div>
        <div class="player-audits">${playersHtml}</div>
        ${renderOlbgLine(olbg)}
        ${renderReviewLinks(raw, olbg)}
      </div>
      <div class="acts">
        <button class="btn" data-gen="${esc(raw.competition_id)}" ${unscored ? 'disabled title="Cannot score: no sourced ranking"' : ''}>Predict</button>
      </div>
    </div>`;
  }).join('');

  $$('#match-list [data-gen]').forEach((b) =>
    b.addEventListener('click', () => generateFor(b.dataset.gen)));
}

function label(m) {
  return { win_match: 'Win', first_set: 'Set1', games_handicap: 'Hcap' }[m] || m;
}

function findSlateOverlay(raw) {
  return matchSlateEvent({
    resolved_date: raw?.date ?? null,
    home: raw?.players?.[0]?.name ?? null,
    away: raw?.players?.[1]?.name ?? null,
  }, state.slateIndex);
}

function rankingSourceUrl(raw) {
  const slug = String(raw?.tour ?? '').toLowerCase();
  if (slug === 'atp' || slug === 'wta') {
    return `https://site.api.espn.com/apis/site/v2/sports/tennis/${slug}/rankings`;
  }
  return 'https://www.espn.com/tennis/rankings';
}

function fmtTrajectory(v) {
  if (v === 'rising') return '↑ rising';
  if (v === 'falling') return '↓ falling';
  if (v === 'stable') return '→ stable';
  return 'trajectory unsourced';
}

function fmtRank(player) {
  return player?.rank == null ? 'rank unsourced' : `#${player.rank} ${fmtTrajectory(player.rankTrajectory)}`;
}

function fmtForm(player) {
  const last5 = player?.form?.last5;
  if (!Array.isArray(last5) || !last5.length) return 'form unsourced';
  return `form ${last5.join('')}`;
}

function fmtSurface(player, surface) {
  if (!surface || !player?.surface || player.surface.wins == null || player.surface.losses == null) return 'surface record unsourced';
  return `${surface} ${player.surface.wins}-${player.surface.losses}`;
}

function playerAuditLine(player, surface) {
  return [fmtRank(player), fmtForm(player), fmtSurface(player, surface)].join(' · ');
}

function renderReviewLinks(raw, olbg) {
  const links = [];
  if (raw?.source_url) links.push(`<a href="${esc(raw.source_url)}" target="_blank" rel="noopener noreferrer">ESPN match ↗</a>`);
  links.push(`<a href="${esc(rankingSourceUrl(raw))}" target="_blank" rel="noopener noreferrer">ESPN rankings ↗</a>`);
  if (olbg?.url) links.push(`<a href="${esc(olbg.url)}" target="_blank" rel="noopener noreferrer">OLBG event ↗</a>`);
  if (raw?.surface_provenance?.key) links.push('<a href="data/surfaces.json" target="_blank" rel="noopener noreferrer">surface map ↗</a>');
  return links.length ? `<div class="sub review-links">Manual review: ${links.join(' · ')}</div>` : '';
}

function renderOlbgLine(olbg) {
  if (!olbg) return '';
  const c = olbg.consensus || {};
  const consensus = c.market && c.selection
    ? `OLBG consensus: ${esc(c.selection)} on ${esc(c.market)}${c.tips_for != null && c.tips_total != null ? ` (${esc(c.tips_for)}/${esc(c.tips_total)})` : ''}`
    : 'OLBG event linked for manual review';
  const markets = Array.isArray(olbg.markets_on_event_page) && olbg.markets_on_event_page.length
    ? `Markets verified: ${olbg.markets_on_event_page.map(esc).join(' · ')}`
    : olbg.markets_verified
      ? 'Markets verified on the OLBG event page'
      : 'Market list not yet verified in this snapshot';
  const note = olbg.model_note ? ` · ${esc(olbg.model_note)}` : '';
  return `<div class="sub olbg-line">${consensus} · ${markets}${note}</div>`;
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

function renderCalendar() {
  const grid = $('#cal-grid');
  const d = state.calMonth;
  $('#cal-title').textContent = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const first = new Date(Date.UTC(y, mo, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const today = todayISO();
  const olbgCounts = olbgDateCounts(state.slate);

  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map((x) => `<div class="cal-dow">${x}</div>`).join('');
  for (let i = 0; i < startDow; i++) html += '<div class="cal-day out"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const slate = olbgCounts.get(iso) || { matches: 0, outrights: 0 };
    const hasSlate = slate.matches + slate.outrights > 0;
    const cls = [
      'cal-day',
      iso === state.date ? 'sel' : '',
      iso === today ? 'today' : '',
      hasSlate ? 'has-slate' : '',
    ].filter(Boolean).join(' ');
    html += `<div class="${cls}" data-date="${iso}"><div class="n">${day}</div>
      ${iso === today ? '<div class="c">today</div>' : ''}
      ${hasSlate ? '<div class="slate-dot" title="OLBG snapshot covers this date"></div>' : ''}</div>`;
  }
  grid.innerHTML = html;

  $$('#cal-grid [data-date]').forEach((el) => el.addEventListener('click', async () => {
    $('#date-input').value = el.dataset.date;
    renderCalendarSelection(el.dataset.date);
    switchTab('scoreboard');
    await loadDate(el.dataset.date);
    renderCalendar();
  }));
}

function renderCalendarSelection(iso) {
  state.date = iso;
  $$('#cal-grid .cal-day').forEach((el) =>
    el.classList.toggle('sel', el.dataset.date === iso));
}

/* ------------------------------------------------------------------ *
 * OLBG markets view
 * ------------------------------------------------------------------ */

function findLiveRowForSlate(ev) {
  return state.scored?.find(({ raw }) => findSlateOverlay(raw)?.event_id === ev?.event_id) ?? null;
}

function fmtPhase(phase) {
  return phase === 'live' ? 'in play' : phase === 'results' ? 'final' : phase === 'upcoming' ? 'upcoming' : 'not matched';
}

function renderMarketList(items, empty) {
  if (!items?.length) return `<span class="muted">${esc(empty)}</span>`;
  return items.map((item) => `<span class="mini-pill">${esc(item)}</span>`).join(' ');
}

function renderOlbgSummary(summary) {
  const consensus = summary.consensusMarkets.length
    ? summary.consensusMarkets.map((m) => `${m.market}: ${m.count}`).join(' · ')
    : 'no consensus market labels';
  const verified = summary.verifiedMarkets.length
    ? summary.verifiedMarkets.map((m) => `${m.market}: ${m.count}`).join(' · ')
    : 'no event-page market lists verified for this date';
  return `
    <div class="stat-grid">
      <div class="stat-card"><strong>${summary.matches}</strong><span>match rows on ${esc(summary.date)}</span></div>
      <div class="stat-card"><strong>${summary.verifiedEventPages}</strong><span>event pages verified</span></div>
      <div class="stat-card"><strong>${summary.withGamesWonSelections}</strong><span>rows with Games Won labels observed</span></div>
      <div class="stat-card"><strong>${summary.outrights}</strong><span>outright rows on this date</span></div>
    </div>
    <div class="info-box">Consensus markets on this date: ${esc(consensus)}.</div>
    <div class="info-box">Verified event-page markets on this date: ${esc(verified)}.</div>
    <div class="info-box">OLBG prices are still absent from structured HTML, so this view shows market names, labels, consensus and review links — not odds. See IR-01.</div>
  `;
}

function renderOlbg() {
  const grid = $('#olbg-cal-grid');
  const summaryEl = $('#olbg-summary');
  const eventsEl = $('#olbg-events');
  const outrightsEl = $('#olbg-outrights');
  const openBtn = $('#olbg-open-source');
  if (!grid || !summaryEl || !eventsEl || !outrightsEl) return;

  if (!state.slate) {
    $('#olbg-title').textContent = 'OLBG snapshot unavailable';
    grid.innerHTML = '';
    summaryEl.innerHTML = '<div class="empty">No OLBG snapshot is present in data/slate.json.</div>';
    eventsEl.innerHTML = '';
    outrightsEl.innerHTML = '';
    return;
  }

  const counts = olbgDateCounts(state.slate);
  const summary = olbgSummaryForDate(state.slate, state.date);
  const events = olbgEventsForDate(state.slate, state.date);
  const outrights = olbgOutrightsForDate(state.slate, state.date);
  const { prev, next } = adjacentOlbgDates(state.slate, state.date);
  const d = state.calMonth;
  $('#olbg-title').textContent = `OLBG snapshot — ${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · selected ${state.date}`;
  openBtn.onclick = () => window.open(state.slate?.source?.url || 'https://www.olbg.com/betting-tips/Tennis/3', '_blank', 'noopener,noreferrer');
  $('#olbg-prev-date').disabled = !prev;
  $('#olbg-next-date').disabled = !next;
  $('#olbg-prev-date').dataset.date = prev || '';
  $('#olbg-next-date').dataset.date = next || '';

  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const first = new Date(Date.UTC(y, mo, 1));
  const startDow = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map((x) => `<div class="cal-dow">${x}</div>`).join('');
  for (let i = 0; i < startDow; i++) html += '<div class="cal-day out"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const c = counts.get(iso) || { matches: 0, outrights: 0 };
    const total = c.matches + c.outrights;
    const cls = [
      'cal-day',
      iso === state.date ? 'sel' : '',
      total ? 'has-events' : '',
      iso === todayISO() ? 'today' : '',
    ].filter(Boolean).join(' ');
    html += `<div class="${cls}" data-olbg-date="${iso}"><div class="n">${day}</div>
      ${total ? `<div class="count-badge">${total}</div>` : ''}
      ${c.matches ? `<div class="c">${c.matches} matches${c.outrights ? ` · ${c.outrights} outright` : ''}</div>` : c.outrights ? `<div class="c">${c.outrights} outright</div>` : ''}</div>`;
  }
  grid.innerHTML = html;
  $$('#olbg-cal-grid [data-olbg-date]').forEach((el) => el.addEventListener('click', async () => {
    const iso = el.dataset.olbgDate;
    $('#date-input').value = iso;
    state.calMonth = new Date(`${iso}T12:00:00Z`);
    renderCalendar();
    renderOlbg();
    await loadDate(iso);
    switchTab('olbg');
    renderCalendar();
    renderOlbg();
  }));

  summaryEl.innerHTML = renderOlbgSummary(summary);

  if (!events.length) {
    eventsEl.innerHTML = `<h2>Match markets</h2><div class="empty">No OLBG match rows are present for ${esc(state.date)} in the committed snapshot.</div>`;
  } else {
    const rows = events.map((ev) => {
      const live = findLiveRowForSlate(ev);
      const predictable = live && live.result?.favourite !== null;
      const action = live
        ? `<button class="btn" data-olbg-predict="${esc(live.raw.competition_id)}" ${predictable ? '' : 'disabled title="Matched live row is unscored"'}>Predict</button>`
        : '<span class="muted">not matched to the loaded live card</span>';
      const reviewLinks = [
        `<a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">OLBG event ↗</a>`,
        live?.raw?.source_url ? `<a href="${esc(live.raw.source_url)}" target="_blank" rel="noopener noreferrer">ESPN match ↗</a>` : null,
      ].filter(Boolean).join(' · ');
      const gamesWon = ev.games_won_selections ?? ev.event_page_extras?.games_won_selections ?? [];
      return `<tr>
        <td>${esc(ev.display_time || '—')}</td>
        <td>${esc(ev.home)} v ${esc(ev.away)}</td>
        <td>${esc(fmtPhase(live?.raw?.phase))}</td>
        <td>${esc(ev.consensus?.market || '—')}</td>
        <td>${esc(ev.consensus?.selection || '—')}</td>
        <td>${renderMarketList(ev.markets_on_event_page, 'event page not verified in this snapshot')}</td>
        <td>${renderMarketList(gamesWon, 'no Games Won labels observed')}</td>
        <td>${reviewLinks}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
    eventsEl.innerHTML = `
      <h2>Match markets</h2>
      <table><thead><tr><th>Time</th><th>Match</th><th>Live card</th><th>Consensus market</th><th>Consensus pick</th><th>Verified markets</th><th>Games Won labels</th><th>Review</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="hint">Only markets actually observed on OLBG event pages are shown in “Verified markets”. Rows without that list are left explicitly unverified.</p>
    `;
  }

  if (!outrights.length) {
    outrightsEl.innerHTML = '';
  } else {
    const rows = outrights.map((ev) => `<tr>
      <td>${esc(ev.display_time || '—')}</td>
      <td>${esc(ev.name || ev.slug || '—')}</td>
      <td>${esc(ev.consensus?.market || '—')}</td>
      <td>${esc(ev.consensus?.selection || '—')}</td>
      <td><a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">OLBG event ↗</a></td>
    </tr>`).join('');
    outrightsEl.innerHTML = `
      <h2>Outrights</h2>
      <table><thead><tr><th>Time</th><th>Market</th><th>Consensus market</th><th>Consensus pick</th><th>Review</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="hint">Outrights are displayed for completeness but are outside the three-match-market model.</p>
    `;
  }

  $$('#olbg-events [data-olbg-predict]').forEach((b) => b.addEventListener('click', () => generateFor(b.dataset.olbgPredict)));
}

/* ------------------------------------------------------------------ *
 * Predictions
 * ------------------------------------------------------------------ */

function generateFor(competitionId) {
  const row = state.scored?.find((r) => r.raw.competition_id === competitionId);
  if (!row) return;
  emit(scoreCard([row.match]));
}

function generateAll() {
  if (!state.scored?.length) { toast('Nothing collected for this date'); return; }
  // Only matches that are actually scoreable go to the writer; the rest are
  // reported as unscored rather than being given invented content.
  emit(scoreCard(state.scored.map((r) => r.match)));
}

function emit(card) {
  state.lastCard = card;
  const written = writeCard(card.results);
  state.tips = written.tips;
  renderPredictions(written, card);
  switchTab('predictions');
}

function renderPredictions(written, card) {
  const out = $('#pred-out');
  const warns = $('#pred-warnings');
  const hint = $('#pred-hint');

  const notes = [];
  if (card.trimmed) notes.push(card.trimmedReason);
  if (written.openerPoolExhausted) {
    notes.push(`This card needs more tips than there are distinct openings (${written.openerPoolSize}). `
      + 'The Step 4 uniqueness rule cannot be honoured past that point; affected tips are withheld rather than repeated.');
  }
  const unscored = written.unscored || [];
  if (unscored.length) {
    notes.push(`${unscored.length} match${unscored.length === 1 ? '' : 'es'} could not be scored: no sourced ranking. `
      + 'Nothing has been estimated for them.');
  }
  if (written.violations.length) {
    notes.push(`${written.violations.length} output-rule violation(s) recorded — those tips were withheld, not published.`);
  }
  notes.push('Odds are not available from any free key-less source, so every price-dependent factor is unscored. '
    + 'Confidence bands are capped accordingly — see Data quality.');

  warns.innerHTML = notes.map((n) => `<div class="info-box">${esc(n)}</div>`).join('');

  const scored = written.tips.filter((t) => t.ok);
  hint.textContent = `${scored.length} tips · ${written.tips.filter((t) => t.skip).length} skips · `
    + `${unscored.length} unscored · min ${MIN_WORDS} words each · ruleset ${RULESET_VERSION}`;

  out.innerHTML = written.tips.map((t, i) => {
    if (!t.ok) {
      return `<div class="tip"><div class="tip-head"><span class="tip-title">withheld — failed output rules</span></div>
        <p class="words">${esc(JSON.stringify(t.violations))}</p></div>`;
    }
    const wc = t.text.split(/\s+/).filter(Boolean).length;
    return `<div class="tip${t.skip ? ' skip' : ''}">
      <div class="tip-head">
        <span class="tip-title">${esc(t.match || '')} · ${esc(t.marketLabel || '')}</span>
        <span class="tip-acts">
          <span class="badge ${t.band}">${t.band}</span>
          <span class="words">${wc} words</span>
          <button class="btn" data-copy="${i}">Copy</button>
        </span>
      </div>
      <p>${renderTipText(t.text)}</p>
    </div>`;
  }).join('');

  $$('#pred-out [data-copy]').forEach((b) => b.addEventListener('click', () => {
    const t = written.tips[Number(b.dataset.copy)];
    copy(t.text.replace(/\*\*/g, ''));
  }));

  renderSummaryTable(card);
}

function renderTipText(text) {
  return text.split(/(\*\*[^*]+\*\*)/g)
    .map((part) => (part.startsWith('**') && part.endsWith('**')
      ? `<strong>${esc(part.slice(2, -2))}</strong>`
      : esc(part)))
    .join('');
}

function renderSummaryTable(card) {
  const el = $('#pred-table');
  const rows = card.results.map(({ match, result }) => {
    const band = (m) => result.markets[m]?.band ?? '—';
    const hcapSkipped = !result.markets.games_handicap
      || result.markets.games_handicap.band === CONFIDENCE.SKIP;
    return `<tr>
      <td>${esc(match.home)} v ${esc(match.away)}</td>
      <td>${esc(result.favourite ?? '—')}</td>
      <td><span class="badge ${band('win_match')}">${band('win_match')}</span></td>
      <td><span class="badge ${band('first_set')}">${band('first_set')}</span></td>
      <td><span class="badge ${band('games_handicap')}">${band('games_handicap')}</span></td>
      <td class="words">${hcapSkipped ? 'skipped — insufficient dominance evidence' : ''}</td>
    </tr>`;
  });
  el.innerHTML = `<h2>Summary</h2>
    <table><thead><tr><th>Match</th><th>Selection</th><th>Win match</th><th>First set</th><th>Games handicap</th><th>Notes</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>
    <p class="hint">Ruleset ${RULESET_VERSION}. Patches applied: ${Object.entries(PATCHES).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}.</p>`;
}

/* ------------------------------------------------------------------ *
 * Data quality
 * ------------------------------------------------------------------ */

function renderQuality() {
  const el = $('#quality-out');
  const q = state.card?.quality;
  if (!q) { el.innerHTML = '<div class="empty">Nothing collected yet.</div>'; return; }

  const allMissing = new Map();
  let unscored = 0;
  for (const { result } of state.scored) {
    if (result.favourite === null) { unscored++; continue; }
    for (const m of result.missing) allMissing.set(m, (allMissing.get(m) || 0) + 1);
  }

  const irregularities = state.provenance?.irregularities || [];
  const slateMatches = state.scored.filter(({ raw }) => findSlateOverlay(raw)).length;

  el.innerHTML = `
    <h2>This collection</h2>
    <table><tbody>
      <tr><td>Date</td><td>${esc(state.date)}</td></tr>
      <tr><td>Collected at</td><td>${esc(q.collected_at_utc)}</td></tr>
      <tr><td>Singles matches found</td><td>${state.scored.length}</td></tr>
      <tr><td>Matches the engine can score</td><td>${state.scored.length - unscored}</td></tr>
      <tr><td>Matches unscoreable (no sourced ranking)</td><td>${unscored}</td></tr>
      <tr><td>Matches with no sourced surface</td><td>${q.matches_without_surface}</td></tr>
      <tr><td>History tape</td><td>${q.tape_matches} completed matches over ${q.tape_days} days</td></tr>
      <tr><td>Ranked players loaded</td><td>${q.ranked_players}</td></tr>
      <tr><td>OLBG snapshot rows loaded</td><td>${state.slate?.events?.length ?? 0}</td></tr>
      <tr><td>Live matches matched back to OLBG</td><td>${slateMatches}</td></tr>
      <tr><td>Feed failures</td><td>${(q.scoreboard_failures.length + q.ranking_failures.length) || 'none'}</td></tr>
    </tbody></table>

    <h2>Factors that can never be sourced here</h2>
    <table><thead><tr><th>Factor</th><th>Why</th><th>Ref</th></tr></thead><tbody>
      ${q.unavailable_factors.map((f) => `<tr><td>${esc(f.factor)}</td><td>${esc(f.reason)}</td><td><code>${esc(f.ref)}</code></td></tr>`).join('')}
    </tbody></table>

    <h2>Factors missing on this card</h2>
    ${allMissing.size ? `<table><thead><tr><th>Missing factor</th><th>Matches affected</th></tr></thead><tbody>${
  [...allMissing.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${v}</td></tr>`).join('')
}</tbody></table>` : '<div class="info-box">No missing factors.</div>'}

    <h2>Flagged irregularities</h2>
    ${irregularities.length
    ? `<ul class="tight">${irregularities.map((i) => `<li><strong>${esc(i.id)}</strong> — ${esc(i.detail)}</li>`).join('')}</ul>`
    : '<div class="info-box">No irregularities file present.</div>'}
  `;
}

/* ------------------------------------------------------------------ *
 * About
 * ------------------------------------------------------------------ */

function renderAbout() {
  const s = state.surfaces;
  $('#about-out').innerHTML = `
    <h2>What this is</h2>
    <p class="lede">A static tennis scoreboard and three-market prediction generator. The live slate, results and
    rankings are collected in your browser from ESPN's public endpoints; the court surface is resolved from a map
    built out of recorded match data; OLBG snapshot rows are overlaid where a same-day player pairing matches; and
    every match is scored by the model in <code>engine/engine.js</code>. Tips are written by
    <code>engine/writer.js</code> and validated against the Step 4 output rules before display.</p>

    <h2>Sources — all publicly verifiable</h2>
    <table><thead><tr><th>Source</th><th>Provides</th><th>Link</th></tr></thead><tbody>
      <tr><td>ESPN tennis scoreboard (public JSON, no key)</td><td>fixtures, live and final scores, rounds, set scores</td>
        <td><a href="https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard" target="_blank" rel="noopener noreferrer">atp ↗</a>
        · <a href="https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard" target="_blank" rel="noopener noreferrer">wta ↗</a></td></tr>
      <tr><td>ESPN rankings</td><td>current ATP/WTA rank, previous rank, points</td>
        <td><a href="https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings" target="_blank" rel="noopener noreferrer">atp ↗</a>
        · <a href="https://site.api.espn.com/apis/site/v2/sports/tennis/wta/rankings" target="_blank" rel="noopener noreferrer">wta ↗</a></td></tr>
      <tr><td>Sackmann dataset mirrors (CC BY-NC-SA 4.0)</td>
        <td>court surface and tour level per tournament — ${s ? s.counts.resolved : '—'} tournaments from ${s ? s.files_used.reduce((a, f) => a + f.rows, 0).toLocaleString() : '—'} match rows</td>
        <td><a href="https://github.com/Kadantte/tennis_atp" target="_blank" rel="noopener noreferrer">atp mirror ↗</a>
        · <a href="https://github.com/Aneeshers/tennis-sackmann-archive" target="_blank" rel="noopener noreferrer">archive ↗</a></td></tr>
      <tr><td>OLBG tennis tips</td><td>market listing and tipster consensus (snapshot; see Data quality)</td>
        <td><a href="https://www.olbg.com/betting-tips/Tennis/3" target="_blank" rel="noopener noreferrer">olbg.com ↗</a></td></tr>
    </tbody></table>

    <h2>What this site will not do</h2>
    <ul class="tight">
      <li><strong>It will not show odds.</strong> No free, key-less, cross-origin odds source was verified, so no price
      is displayed and every odds-dependent factor is scored as missing rather than assumed.</li>
      <li><strong>It will not invent a statistic.</strong> Serve percentages and ace rates are absent from ESPN's tennis
      feed, so they stay unsourced instead of being estimated.</li>
      <li><strong>It will not guess a surface.</strong> A tournament missing from the surface map, or whose source rows
      disagreed, is shown as "surface unsourced".</li>
      <li><strong>It will not publish a tip that breaks the output rules.</strong> Tips containing digits, banned
      phrases, repeated names, or fewer than ${MIN_WORDS} words are withheld and the violation is reported.</li>
    </ul>

    <h2>Model ruleset</h2>
    <p class="lede">Implements master prompt ${PROMPT_VERSION} with documented patches:
    ${Object.keys(PATCHES).map((k) => `<code>${k}</code>${PATCHES[k] ? ' ✓' : ' ✗'}`).join(', ')}.
    The reasoning for each is in <code>docs/PROMPT_REVIEW.md</code>.</p>

    <h2>Reproduce</h2>
    <pre>npm test                              # engine, writer, ESPN parsers, backtest
node scripts/build_surface_map.mjs    # rebuild the surface map from source data
node scripts/backtest_historical.mjs  # walk-forward backtest on real matches</pre>
  `;
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function copy(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied to clipboard'),
    () => toast('Copy blocked by the browser'),
  );
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function switchTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

/** Full copy-ready card: tips, summary table, skip flags, RG reminder. */
function buildCardText() {
  const tips = state.tips.filter((t) => t.ok);
  if (!tips.length) return '';
  const lines = [`Tennis predictions — ${state.date}`, ''];
  for (const t of tips) {
    lines.push(`${t.match} — ${t.marketLabel} [${t.band}]`);
    lines.push(t.text.replace(/\*\*/g, ''));
    lines.push('');
  }
  const card = state.lastCard;
  if (card) {
    lines.push('SUMMARY');
    lines.push('Match | Selection | Win match | First set | Games handicap');
    for (const { match, result } of card.results) {
      const b = (m) => result.markets[m]?.band ?? '—';
      lines.push(`${match.home} v ${match.away} | ${result.favourite ?? '—'} | ${b('win_match')} | ${b('first_set')} | ${b('games_handicap')}`);
    }
    const skipped = card.results.filter(({ result }) =>
      !result.markets.games_handicap || result.markets.games_handicap.band === CONFIDENCE.SKIP);
    if (skipped.length) {
      lines.push('');
      lines.push('HANDICAP SKIPS — insufficient dominance evidence:');
      for (const { match } of skipped) lines.push(`- ${match.home} v ${match.away}`);
    }
  }
  lines.push('');
  lines.push('Responsible gambling: nothing here is betting advice or a guarantee. Predictions are generated '
    + 'mechanically from sourced data and are fallible. 18+.');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Wire up
 * ------------------------------------------------------------------ */

$$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$$('#phase-filter button').forEach((b) => b.addEventListener('click', () => {
  $$('#phase-filter button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  state.phase = b.dataset.phase;
  renderScoreboard();
}));
$('#search').addEventListener('input', (e) => { state.search = e.target.value; renderScoreboard(); });

$('#date-input').addEventListener('change', async (e) => {
  const v = e.target.value;
  if (!v) return;
  state.calMonth = new Date(`${v}T12:00:00Z`);
  renderCalendar();
  await loadDate(v);
});
$('#today-btn').addEventListener('click', async () => {
  const t = todayISO();
  $('#date-input').value = t;
  state.calMonth = new Date(`${t}T12:00:00Z`);
  renderCalendar();
  await loadDate(t);
});
$('#prev-day').addEventListener('click', () => shiftDay(-1));
$('#next-day').addEventListener('click', () => shiftDay(1));
async function shiftDay(n) {
  const d = new Date(`${state.date}T12:00:00Z`);
  const iso = isoDate(new Date(d.getTime() + n * 86400000));
  $('#date-input').value = iso;
  state.calMonth = new Date(`${iso}T12:00:00Z`);
  renderCalendar();
  await loadDate(iso);
}

$('#cal-prev').addEventListener('click', () => {
  state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1));
  renderCalendar();
  renderOlbg();
});
$('#cal-next').addEventListener('click', () => {
  state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1));
  renderCalendar();
  renderOlbg();
});
$('#olbg-prev-date').addEventListener('click', async (e) => {
  const iso = e.currentTarget.dataset.date;
  if (!iso) return;
  $('#date-input').value = iso;
  state.calMonth = new Date(`${iso}T12:00:00Z`);
  renderCalendar();
  renderOlbg();
  await loadDate(iso);
  switchTab('olbg');
});
$('#olbg-next-date').addEventListener('click', async (e) => {
  const iso = e.currentTarget.dataset.date;
  if (!iso) return;
  $('#date-input').value = iso;
  state.calMonth = new Date(`${iso}T12:00:00Z`);
  renderCalendar();
  renderOlbg();
  await loadDate(iso);
  switchTab('olbg');
});

$('#generate-all').addEventListener('click', generateAll);
$('#generate-card').addEventListener('click', generateAll);
$('#copy-all').addEventListener('click', () => {
  const text = state.tips.filter((t) => t.ok).map((t) => t.text.replace(/\*\*/g, '')).join('\n\n');
  if (!text) { toast('Generate predictions first'); return; }
  copy(text);
});
$('#copy-card').addEventListener('click', () => {
  const text = buildCardText();
  if (!text) { toast('Generate predictions first'); return; }
  copy(text);
});

boot();
