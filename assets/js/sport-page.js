/**
 * SportsPred — sport page controller.
 *
 * One controller drives every sport page (sport.html?sport=football). It:
 *   1. resolves the sport and its verified leagues,
 *   2. loads that day's card for each selected league (cached, in parallel),
 *   3. measures the league baseline from the committed precompute, falling back
 *      to a live results-window scan only if the precompute is missing,
 *   4. scores and writes a prediction for EVERY match automatically,
 *   5. renders a scoreboard, a calendar, and copy-ready tips.
 *
 * PERFORMANCE NOTES
 *   - Predictions are computed once per loaded card and memoised by match id.
 *     Rendering never re-scores.
 *   - The committed league_context.json removes the 60-day history scan that
 *     used to run on every page load.
 *   - Cards render as soon as the first league resolves; the rest stream in.
 */

import {
  getSport, SPORTS,
} from '../../engine/registry.js';
import {
  parseScoreboard, buildLeagueContext, headToHead, restDays,
} from '../../engine/espn_universal.js';
import {
  scoreUniversalMatch, espnSportFor,
} from '../../engine/universal_engine.js';
import {
  writeUniversalTip, buildCopyText,
} from '../../engine/universal_writer.js';
import { writeNbaGame } from '../../engine/nba_writer.js';
import {
  loadLeagueDay, loadLeagueRange, loadStatic, pool, addDays, ttlForDate,
  cacheStats, clearCache, TTL,
} from './data-client.js';
import {
  $, $$, esc, todayISO, fmtTime, fmtDateLong, relTime, renderShell, renderFooter,
  toast, copyText, confBar, formPips, qs, setQS,
} from './ui.js';

const state = {
  sport: null,
  date: todayISO(),
  leagues: [],          // [{slug,name,verified}]
  leagueFilter: 'all',
  phase: 'all',
  search: '',
  matches: [],
  contexts: new Map(),  // leagueSlug -> league context
  predictions: new Map(), // matchId -> { scored, tip }
  calMonth: null,
  calCounts: new Map(),
  registry: null,
  olbg: null,
  loadedAt: null,
  errors: [],
  autoHopped: false,    // only auto-advance the landing date once
};

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */

async function boot() {
  const key = qs('sport', 'football');
  const sport = getSport(key) || getSport('football');
  // Sports with a dedicated controller (golf) live on their own page.
  if (sport.page && !/\/?sport\.html$/.test(sport.page)) {
    const u = new URL(sport.page, location.href);
    const d = qs('date');
    if (d) u.searchParams.set('date', d);
    const board = $('#board');
    if (board) board.innerHTML = `<div class="note info">${esc(sport.name)} has its own page. <a id="handover" href="${esc(u.toString())}">Continue to ${esc(sport.page)} →</a></div>`;
    location.replace(u.toString());
    return;
  }
  state.sport = sport;
  state.date = qs('date', todayISO());
  state.calMonth = new Date(`${state.date}T12:00:00Z`);

  document.title = `${sport.name} scoreboard & predictions — SportsPred`;
  renderShell({ activeSport: sport.key, activePage: 'sport.html' });
  renderStaticParts();
  renderFooter();
  wireControls();

  // Verified league registry (built in CI). Falls back to candidates, flagged.
  const reg = await loadStatic('data/leagues.json', TTL.REGISTRY);
  state.registry = reg.data;
  state.leagues = resolveLeagues(sport, reg.data);
  renderLeagueSelect();

  // OLBG slate for this sport (committed snapshot).
  loadOlbg();

  await loadDate(state.date);
}

function resolveLeagues(sport, registryDoc) {
  const fromRegistry = registryDoc?.sports?.[sport.key]?.leagues;
  if (Array.isArray(fromRegistry) && fromRegistry.length) {
    return fromRegistry
      .filter((l) => l.ok)
      .map((l) => ({ slug: l.slug, name: l.name, verified: true, lastChecked: registryDoc.generated_at_utc }));
  }
  return (sport.candidateLeagues || []).map((l) => ({ ...l, verified: false }));
}

async function loadOlbg() {
  const map = {
    football: null, cricket: 'data/cricket_slate.json', handball: 'data/handball_slate.json',
    tennis: 'data/slate.json', 'motor-racing': 'data/f1_slate.json', golf: 'data/golf_slate.json',
    volleyball: 'data/volleyball_slate.json', basketball: 'data/basketball_slate.json',
  };
  const path = map[state.sport.key];
  const box = $('#olbg-box');
  if (!box) return;
  if (!path) {
    box.innerHTML = `<div class="card-body">
      <p class="meta-line">No committed OLBG snapshot for ${esc(state.sport.name)} yet. The live market index is:</p>
      <p><a href="${esc(state.sport.officialLinks.find((l) => l.url.includes('olbg.com'))?.url || 'https://www.olbg.com/betting-tips')}" target="_blank" rel="noopener noreferrer">Open the OLBG ${esc(state.sport.name)} tips index ↗</a></p>
      <p class="meta-line">Every OLBG sport index is listed on the <a href="markets.html">markets page</a>.</p>
    </div>`;
    return;
  }
  const res = await loadStatic(path);
  const slate = res.data;
  if (!slate) { box.innerHTML = '<div class="card-body meta-line">Snapshot unavailable.</div>'; return; }
  const events = (slate.events || []).slice(0, 14);
  box.innerHTML = `<div class="card-body tight">
    <table class="data"><thead><tr><th>Event</th><th>Market</th><th class="num">Consensus</th></tr></thead>
    <tbody>${events.map((e) => `<tr>
      <td>${esc(e.event_name || `${e.home || ''} v ${e.away || ''}`)}</td>
      <td>${esc(e.consensus?.market || e.market || '—')}</td>
      <td class="num">${esc(e.consensus?.selection || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="3" class="empty">No rows in the snapshot.</td></tr>'}</tbody></table>
    <div class="card-body meta-line">Snapshot fetched ${esc(slate.source?.fetched_at_utc || 'unknown')} ·
    <a href="${esc(slate.source?.url || 'https://www.olbg.com/betting-tips')}" target="_blank" rel="noopener noreferrer">official index ↗</a></div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * loading a date
 * ------------------------------------------------------------------ */

async function loadDate(dateISO) {
  state.date = dateISO;
  state.matches = [];
  state.predictions.clear();
  state.errors = [];
  setQS({ date: dateISO, sport: state.sport.key });
  $('#date-input').value = dateISO;
  $('#day-title').textContent = fmtDateLong(dateISO);
  renderDateStrip();
  renderCalendar();

  if (!state.sport.predictable || !state.sport.espnSport) {
    renderNoFeed();
    return;
  }

  setProgress(8, `Loading ${state.sport.name} fixtures…`);

  const targets = state.leagueFilter === 'all'
    ? state.leagues
    : state.leagues.filter((l) => l.slug === state.leagueFilter);

  if (!targets.length) {
    $('#board').innerHTML = '<div class="empty">No leagues resolved for this sport yet. Run the registry build in CI.</div>';
    setProgress(100, '');
    return;
  }

  const espnSport = espnSportFor(state.sport.key);
  let done = 0;

  await pool(targets, 6, async (lg) => {
    const res = await loadLeagueDay(espnSport, lg.slug, dateISO, { ttl: ttlForDate(dateISO, false) });
    done += 1;
    setProgress(8 + Math.round((done / targets.length) * 62), `Loaded ${done}/${targets.length} competitions…`);
    if (!res.data) {
      if (res.error) state.errors.push({ league: lg.slug, error: res.error });
      return;
    }
    const parsed = parseScoreboard(res.data, {
      sportKey: state.sport.key, leagueSlug: lg.slug, leagueName: lg.name,
    });
    if (parsed.matches.length) {
      state.matches.push(...parsed.matches);
      state.matches.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
      renderBoard();          // stream results in as they land
    }
    if (parsed.league?.calendar?.length) {
      for (const d of parsed.league.calendar) {
        state.calCounts.set(d, (state.calCounts.get(d) || 0) + 1);
      }
    }
  });

  state.loadedAt = Date.now();
  setProgress(78, 'Measuring league baselines…');
  await ensureContexts();

  setProgress(90, 'Generating predictions…');
  generateAll();

  setProgress(100, '');
  renderBoard();
  renderRail();
  renderMeta();
  renderCalendar();
  maybeAutoAdvance();
}

/** Smallest ESPN-calendar date with a registered fixture strictly after the current date. */
function nextGameDay() {
  let best = null;
  for (const d of state.calCounts.keys()) {
    if (d > state.date && (best === null || d < best)) best = d;
  }
  return best;
}

/**
 * Landing UX: when the page opens on a date with no fixtures for this sport
 * (the NBA is in offseason in early September, for example), the board is
 * empty and the Generate button appears to do nothing. Jump once, forward, to
 * the next date the ESPN calendar actually registers a game, so the page lands
 * on a real, predictable slate instead of a blank one. Manual navigation is
 * never hijacked: the hop happens at most once, and only forward.
 */
function maybeAutoAdvance() {
  if (!state.sport?.predictable || !state.sport?.espnSport) return;
  if (state.matches.length) return;      // the date has games — nothing to fix
  if (state.autoHopped) return;          // already advanced once this session
  const next = nextGameDay();
  if (!next) return;                     // no future fixture registered at all
  state.autoHopped = true;
  loadDate(next);
}

/**
 * League baselines. Preference order:
 *   1. data/league_context.json — measured in CI, committed, instant.
 *   2. a live 45-day results scan for the leagues actually on today's card.
 * Option 2 is only used for leagues the precompute does not cover, and it runs
 * after the board has already painted.
 */
async function ensureContexts() {
  const needed = [...new Set(state.matches.map((m) => m.leagueSlug))];
  if (!needed.length) return;

  const pre = await loadStatic('data/league_context.json');
  const table = pre.data?.leagues || {};
  const missing = [];
  for (const slug of needed) {
    const row = table[`${state.sport.key}:${slug}`];
    if (row && row.sufficient) state.contexts.set(slug, row);
    else missing.push(slug);
  }
  if (!missing.length) return;

  const espnSport = espnSportFor(state.sport.key);
  const from = addDays(state.date, -45);
  const to = addDays(state.date, -1);
  await pool(missing, 4, async (slug) => {
    const res = await loadLeagueRange(espnSport, slug, from, to);
    if (!res.data) return;
    const parsed = parseScoreboard(res.data, { sportKey: state.sport.key, leagueSlug: slug });
    const ctx = buildLeagueContext(parsed.matches, { threeWay: state.sport.threeWay });
    ctx.source = `live 45-day scan ${from}..${to}`;
    state.contexts.set(slug, ctx);
    state.tapes = state.tapes || new Map();
    state.tapes.set(slug, parsed.matches);
  });
}

/* ------------------------------------------------------------------ *
 * prediction generation — runs automatically, and on the button
 * ------------------------------------------------------------------ */

function ctxFor(match) {
  const lc = state.contexts.get(match.leagueSlug) || { sufficient: false };
  const tape = state.tapes?.get(match.leagueSlug) || null;
  return {
    threeWay: state.sport.threeWay === true,
    leagueContext: lc,
    h2h: tape ? headToHead(tape, match.home?.name, match.away?.name, match.startUtc) : null,
    rest: tape ? {
      home: restDays(tape, match.home?.name, match.startUtc),
      away: restDays(tape, match.away?.name, match.startUtc),
    } : null,
  };
}

/** Score + write every match on the board. Idempotent and memoised. */
export function generateAll({ force = false } = {}) {
  let made = 0;
  for (const m of state.matches) {
    if (!force && state.predictions.has(m.id)) continue;
    const scored = scoreUniversalMatch(m, ctxFor(m));
    scored.neutral = m.neutral;
    const tip = writeUniversalTip(scored);
    // NBA v5 has a stricter display contract: publish three independent,
    // ordered markets and keep price/line/player detail out of the prose.
    const nbaTips = state.sport.key === 'basketball' ? writeNbaGame(scored) : null;
    state.predictions.set(m.id, { scored, tip, nbaTips });
    made += 1;
  }
  return made;
}

function writtenCard() {
  const tips = [];
  const withheld = [];
  for (const m of visibleMatches()) {
    const p = state.predictions.get(m.id);
    if (!p) continue;
    if (state.sport.key === 'basketball' && p.nbaTips) {
      p.nbaTips.forEach((nbaTip, index) => {
        const labels = ['WIN MATCH', 'POINT SPREAD', 'GAME TOTAL'];
        if (nbaTip.ok) tips.push({
          matchId: `${m.id}:${index}`,
          match: p.scored.match,
          league: p.scored.league,
          dateISO: p.scored.dateISO,
          startUtc: p.scored.startUtc,
          market: nbaTip.market,
          marketLabel: labels[index],
          selection: p.scored.markets[nbaTip.market]?.selection,
          band: nbaTip.band,
          score: nbaTip.score,
          words: nbaTip.words,
          text: nbaTip.text,
          sources: p.scored.sources,
        });
        else withheld.push({ match: `${p.scored.match} — ${labels[index]}`, violations: [nbaTip.reason || 'market withheld'], reason: nbaTip.reason });
      });
    } else if (p.tip.ok) {
      tips.push({
        matchId: m.id,
        match: p.scored.match,
        league: p.scored.league,
        dateISO: p.scored.dateISO,
        startUtc: p.scored.startUtc,
        market: p.tip.market,
        marketLabel: p.scored.headline.label,
        selection: p.scored.headline.selection,
        band: p.tip.band,
        score: p.tip.score,
        probability: p.scored.headline.probability,
        price: p.scored.headline.price ?? null,
        provider: p.scored.headline.provider ?? null,
        words: p.tip.words,
        text: p.tip.text,
        sources: p.scored.sources,
      });
    } else {
      withheld.push({ match: p.scored.match, violations: p.tip.violations, reason: p.tip.reason });
    }
  }
  tips.sort((a, b) => b.score - a.score);
  return { tips, withheld, unscored: [] };
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function visibleMatches() {
  const q = state.search.trim().toLowerCase();
  return state.matches.filter((m) => {
    if (state.phase !== 'all' && m.phase !== state.phase) return false;
    if (state.leagueFilter !== 'all' && m.leagueSlug !== state.leagueFilter) return false;
    if (q) {
      const hay = `${m.home?.name} ${m.away?.name} ${m.leagueName} ${m.venue}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderStaticParts() {
  const s = state.sport;
  $('#page-title').textContent = `${s.name}`;
  $('#page-sub').innerHTML = s.predictable
    ? `Live scoreboard, calendar and automatically generated predictions. Every figure below is traceable to a linked source.`
    : `OLBG publishes markets for ${esc(s.name)}, but no key-less statistics feed exists for it, so this page lists markets for manual review and generates no predictions.`;
  const links = s.officialLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join(' · ');
  $('#sport-links').innerHTML = links;
  if (s.notes?.length) {
    $('#sport-notes').innerHTML = s.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('');
    if (s.key === 'basketball') {
      $('#sport-notes').innerHTML += '<div class="note info"><strong>NBA v5 audit:</strong> unsupported inputs are withheld, never guessed. Read the <a href="docs/NBA_PROMPT_REVIEW.md">requirement matrix and source limitations</a>.</div>';
    }
  }
}

function renderNoFeed() {
  $('#board').innerHTML = `<div class="empty">
    <p><strong>No key-less statistics feed exists for ${esc(state.sport.name)}.</strong></p>
    <p>Rather than invent form or prices, this page lists the OLBG market index for manual review and generates nothing.</p>
    <p>${state.sport.officialLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join(' · ')}</p>
  </div>`;
  setProgress(100, '');
  $('#rail-preds').innerHTML = '<div class="card-body meta-line">No predictions are generated for this sport.</div>';
}

function setProgress(pctv, label) {
  const bar = $('#progress i');
  const lab = $('#progress-label');
  if (bar) bar.style.width = `${pctv}%`;
  if (lab) lab.innerHTML = pctv >= 100 ? '' : `<span class="spin"></span> ${esc(label || '')}`;
  if (pctv >= 100) setTimeout(() => { if (bar) bar.style.width = '0%'; }, 400);
}

function renderMeta() {
  const cs = cacheStats();
  const priced = state.matches.filter((m) => m.odds?.moneyline?.home).length;
  const ctxLive = [...state.contexts.values()].filter((c) => c.source).length;
  $('#meta').innerHTML = `
    <span>${state.matches.length} matches</span>
    <span>${priced} priced</span>
    <span>${state.predictions.size} scored</span>
    <span>loaded ${relTime(state.loadedAt)}</span>
    <span>cache <code>${cs.entries} entries / ${cs.kb} KB</code></span>
    ${ctxLive ? `<span title="Leagues whose baseline had to be measured live because the committed precompute did not cover them">${ctxLive} live baseline scans</span>` : ''}
    ${state.errors.length ? `<span style="color:var(--accent)">${state.errors.length} feed errors</span>` : ''}`;
}

function renderLeagueSelect() {
  const sel = $('#league-filter');
  const verifiedNote = state.leagues.some((l) => !l.verified);
  sel.innerHTML = `<option value="all">All competitions (${state.leagues.length})</option>`
    + state.leagues.map((l) => `<option value="${esc(l.slug)}">${esc(l.name)}${l.verified ? '' : ' (unverified)'}</option>`).join('');
  sel.value = state.leagueFilter;
  if (verifiedNote) {
    $('#registry-note').innerHTML = `<div class="note">The machine-verified league registry (<code>data/leagues.json</code>) is not present, so this page is using the candidate list from <code>engine/registry.js</code>. Competitions are marked <em>unverified</em> until the registry build runs in CI.</div>`;
  } else if (state.registry) {
    $('#registry-note').innerHTML = `<div class="note info">League list machine-verified ${esc(state.registry.generated_at_utc || '')} — every competition below returned HTTP 200 from ESPN at build time. <a href="sources.html#registry">See the verification report</a>.</div>`;
  }
}

function renderDateStrip() {
  const el = $('#datestrip');
  const days = [];
  for (let i = -3; i <= 7; i += 1) days.push(addDays(state.date, i));
  el.innerHTML = days.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    const on = d === state.date;
    return `<button class="day ${on ? 'on' : ''}" data-date="${d}">
      <span class="dow">${dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${dt.getUTCDate()}</span>
      ${d === todayISO() ? '<span class="dot"></span>' : ''}
    </button>`;
  }).join('');
  $$('#datestrip .day').forEach((b) => b.addEventListener('click', () => loadDate(b.dataset.date)));
}

function renderCalendar() {
  const grid = $('#calgrid');
  const first = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth(), 1));
  $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const startDow = (first.getUTCDay() + 6) % 7; // Monday-first
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
    loadDate(b.dataset.date);
  }));
}

function renderBoard() {
  const list = visibleMatches();
  const board = $('#board');
  const counts = {
    all: state.matches.length,
    upcoming: state.matches.filter((m) => m.phase === 'upcoming').length,
    live: state.matches.filter((m) => m.phase === 'live').length,
    results: state.matches.filter((m) => m.phase === 'results').length,
  };
  $('#counts').textContent = `${counts.all} matches · ${counts.upcoming} upcoming · ${counts.live} in play · ${counts.results} final`;

  if (!list.length) {
    if (state.matches.length === 0) {
      // The date genuinely has no fixtures for this sport (offseason, break).
      const next = nextGameDay();
      board.innerHTML = `<div class="empty">
        <p><strong>No ${esc(state.sport.name)} games are scheduled for ${esc(state.date)}.</strong></p>
        ${next
    ? `<p class="meta-line">The next game day registered on the ESPN calendar is <strong>${esc(fmtDateLong(next))}</strong>.</p>
           <p><button class="btn primary" id="jump-next">Jump to ${esc(next)}</button></p>`
    : '<p class="meta-line">No future fixture is registered on the ESPN calendar yet — check back as the schedule fills in.</p>'}
        <p class="meta-line">You can also pick any date on the calendar below.</p>
      </div>`;
      const j = $('#jump-next');
      if (j) j.addEventListener('click', () => loadDate(next));
      return;
    }
    board.innerHTML = `<div class="empty">No ${esc(state.sport.name)} matches match these filters on ${esc(state.date)}.
      Try an adjacent date on the calendar, or clear the filters.</div>`;
    return;
  }

  const groups = new Map();
  for (const m of list) {
    const k = m.leagueName || m.leagueSlug;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }

  board.innerHTML = [...groups.entries()].map(([league, ms]) => `
    <div class="lg-head">
      ${ms[0].leagueLogo ? `<img src="${esc(ms[0].leagueLogo)}" alt="" loading="lazy">` : ''}
      <span>${esc(league)}</span><span class="count">${ms.length}</span>
      <a href="https://www.espn.com/soccer/scoreboard" target="_blank" rel="noopener noreferrer" hidden></a>
    </div>
    ${ms.map(matchRow).join('')}
  `).join('');

  $$('#board [data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const d = $(`#detail-${CSS.escape(b.dataset.toggle)}`);
    if (!d) return;
    const open = d.classList.toggle('open');
    b.textContent = open ? 'Hide analysis' : 'Analysis';
    if (open && !d.dataset.filled) { d.innerHTML = detailHtml(b.dataset.toggle); d.dataset.filled = '1'; wireDetail(d); }
  }));
}

function matchRow(m) {
  const p = state.predictions.get(m.id);
  const head = p?.scored?.headline;
  const when = m.phase === 'live'
    ? `<div class="t">${esc(m.statusClock || '')}</div><div class="s live">LIVE</div>`
    : m.phase === 'results'
      ? `<div class="t">${m.home.score ?? ''}-${m.away.score ?? ''}</div><div class="s ft">FINAL</div>`
      : `<div class="t">${esc(fmtTime(m.startUtc))}</div><div class="s">${esc((m.statusDetail || '').slice(0, 12))}</div>`;

  const teamRow = (t, other) => `
    <div class="trow">
      ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '<span style="width:20px"></span>'}
      ${t.rank ? `<span class="rank">${t.rank}</span>` : ''}
      <span class="nm ${m.phase === 'results' && t.score !== null && other.score !== null && t.score < other.score ? 'loser' : ''}">${esc(t.name)}</span>
      ${t.recordSummary ? `<span class="rec">${esc(t.recordSummary)}</span>` : ''}
      ${formPips(t.form)}
      ${t.score !== null ? `<span class="sc">${t.score}</span>` : ''}
    </div>`;

  const pill = head
    ? `<span class="pred-pill ${esc(head.band)}">
         <span class="badge ${esc(head.band)}">${esc(head.band)}</span>
         <span class="sel">${esc(head.selection)}</span>
         ${confBar(head.score, head.band)}
       </span>`
    : p
      ? `<span class="pred-pill SKIP"><span class="badge SKIP">SKIP</span><span class="sel">${esc(p.scored.markets.match_result?.reason || 'unscored')}</span></span>`
      : '<span class="pred-pill SKIP"><span class="spin"></span></span>';

  return `
  <div class="match" data-id="${esc(m.id)}">
    <div class="match-main">
      <div class="match-when">${when}</div>
      <div class="teams">${teamRow(m.home, m.away)}${teamRow(m.away, m.home)}</div>
      <div class="match-right">
        ${pill}
        <button class="btn sm" data-toggle="${esc(m.id)}">Analysis</button>
      </div>
    </div>
    <div class="detail" id="detail-${esc(m.id)}"></div>
  </div>`;
}

function detailHtml(matchId) {
  const m = state.matches.find((x) => x.id === matchId);
  const p = state.predictions.get(matchId);
  if (!m || !p) return '<div class="meta-line">No analysis available.</div>';
  const { scored, tip } = p;

  const signals = (scored.model.signals || []).map((s) => `
    <tr><th>${esc(s.label)}<div class="meta-line"><code>${esc(s.id)}</code> ${esc(s.source)}</div>
      <div class="meta-line">${esc(s.detail || '')}</div></th>
      <td class="num">${s.points === 0 ? '—' : (s.points > 0 ? '+' : '') + s.points}</td></tr>`).join('');

  const missing = (scored.missing || []).map((x) => `<li><strong>${esc(x.label)}</strong> — ${esc(x.reason)}</li>`).join('');

  const marketRows = Object.entries(scored.markets).map(([, mk]) => `
    <tr><th>${esc(mk.label)}${mk.line !== undefined && mk.line !== null ? ` <code>${esc(mk.line)}</code>` : ''}
      ${mk.reason ? `<div class="meta-line">${esc(mk.reason)}</div>` : ''}</th>
      <td>${mk.selection ? esc(mk.selection) : '<span class="badge SKIP">SKIP</span>'}</td>
      <td class="num">${mk.band && mk.band !== 'SKIP' ? `<span class="badge ${esc(mk.band)}">${esc(mk.band)}</span> ${mk.score}` : '—'}</td></tr>`).join('');

  // NBA v5 keeps odds, scores, factor breakdowns and source names out of the
  // copy-ready prediction surface. They remain available in the repository's
  // provenance records and official review links, but are never leaked into
  // the written tip UI.
  const priceLine = state.sport.key === 'basketball'
    ? 'NBA v5 display policy: internal factors and price figures are withheld from the written tip. Review the linked official sources and the data-quality notice for unavailable inputs.'
    : m.odds?.moneyline?.home
      ? `Prices via ESPN from <strong>${esc(m.odds.provider || 'the listed sportsbook')}</strong>:
         ${esc(m.home.name)} ${m.odds.moneyline.home.decimal}
         ${m.odds.moneyline.draw ? `· Draw ${m.odds.moneyline.draw.decimal}` : ''}
         · ${esc(m.away.name)} ${m.odds.moneyline.away?.decimal ?? '—'}`
      : 'No price is published for this fixture in the free feed, so every price rule was skipped rather than guessed.';

  return `
  <div class="detail-grid">
    <div>
      <div class="tipbox">
        <div class="tip-meta">
          ${tip.ok ? `<span class="badge ${esc(tip.band)}">${esc(tip.band)}</span>${confBar(tip.score, tip.band)}<span class="meta-line">${tip.words} words</span>` : '<span class="badge SKIP">WITHHELD</span>'}
          ${tip.ok ? `<button class="btn sm" data-copy="${esc(matchId)}">Copy tip</button>` : ''}
        </div>
        ${tip.ok
    ? `<div>${tip.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>`
    : `<div class="meta-line">No tip was written. ${esc((tip.violations || []).join('; ') || tip.reason || '')}</div>`}
      </div>
      ${state.sport.key === 'basketball' && p.nbaTips ? `<div class="nba-market-tips">
        ${p.nbaTips.map((t, i) => `<section class="nba-tip"><div class="tip-meta"><strong>${esc(['WIN MATCH', 'POINT SPREAD', 'GAME TOTAL'][i])}</strong><span class="sp"></span><span class="badge ${esc(t.band)}">${esc(t.band)}</span>${t.ok ? confBar(t.score, t.band) : ''}<button class="btn sm" data-nba-copy="${esc(matchId)}:${i}">Copy</button></div><div>${t.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div></section>`).join('')}
      </div>` : ''}
      <p class="meta-line" style="margin-top:10px">${priceLine}</p>
      <ul class="srclist">
        ${(scored.sources || []).map((s) => `<li>→ <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('')}
      </ul>
    </div>
    <div>
      <table class="kv"><thead><tr><th>Market</th><th>Selection</th><th class="num">Confidence</th></tr></thead>
        <tbody>${marketRows}</tbody></table>
      ${state.sport.key === 'basketball' ? '' : `<table class="kv" style="margin-top:12px">
        <thead><tr><th>Signal (rule · source)</th><th class="num">Log-odds</th></tr></thead>
        <tbody>${signals || '<tr><td colspan="2" class="meta-line">No signal fired.</td></tr>'}</tbody>
      </table>`}
      ${missing ? `<p class="meta-line" style="margin-top:10px"><strong>Not available for this fixture</strong></p><ul class="miss">${missing}</ul>` : ''}
    </div>
  </div>`;
}

function wireDetail(root) {
  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
    const p = state.predictions.get(b.dataset.copy);
    if (!p?.tip?.ok) return;
    const ok = await copyText(p.tip.text.replace(/\*\*/g, ''));
    toast(ok ? 'Tip copied to clipboard' : 'Copy failed — select the text manually');
  }));
  $$('[data-nba-copy]', root).forEach((b) => b.addEventListener('click', async () => {
    const [id, index] = b.dataset.nbaCopy.split(':');
    const tip = state.predictions.get(id)?.nbaTips?.[Number(index)];
    if (!tip) return;
    const ok = await copyText(tip.text.replace(/\*\*/g, ''));
    toast(ok ? 'NBA market tip copied' : 'Copy failed — select the text manually');
  }));
}

function renderRail() {
  const written = writtenCard();
  const top = written.tips.slice(0, 8);
  $('#rail-preds').innerHTML = top.length
    ? top.map((t, i) => `
      <div class="rail-item">
        <span class="r-num">${i + 1}</span>
        <span class="r-body">
          <span class="r-sel">${esc(t.selection)}</span>
          <span class="badge ${esc(t.band)}" style="margin-left:6px">${esc(t.band)} ${t.score}</span>
          <div class="r-match">${esc(t.match)} · ${esc(t.marketLabel)}</div>
        </span>
      </div>`).join('')
    : '<div class="card-body meta-line">No selection cleared the publication threshold on this card.</div>';

  $('#rail-count').textContent = `${written.tips.length} published · ${written.withheld.length} withheld`;
}

/* ------------------------------------------------------------------ *
 * controls
 * ------------------------------------------------------------------ */

function wireControls() {
  $('#prev-day').addEventListener('click', () => loadDate(addDays(state.date, -1)));
  $('#next-day').addEventListener('click', () => loadDate(addDays(state.date, 1)));
  $('#today-btn').addEventListener('click', () => loadDate(todayISO()));
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) loadDate(e.target.value); });

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
    loadDate(state.date);
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

  // THE button. It re-scores every match on the card and reports what it did.
  $('#generate').addEventListener('click', () => {
    const btn = $('#generate');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Generating…';
    // Yield a frame so the spinner paints before the synchronous scoring pass.
    requestAnimationFrame(() => {
      try {
        const n = generateAll({ force: true });
        renderBoard();
        renderRail();
        renderMeta();
        const w = writtenCard();
        toast(`${w.tips.length} predictions generated from ${n} matches (${w.withheld.length} withheld)`);
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
    const written = writtenCard();
    if (!written.tips.length) { toast('Nothing to copy — no tip cleared the threshold'); return; }
    const text = buildCopyText(written, {
      title: `${state.sport.name} predictions`,
      dateISO: state.date,
      sourceNote: 'Generated mechanically by SportsPred from ESPN public data. Not betting advice. 18+.',
    });
    const ok = await copyText(text);
    toast(ok ? `Copied ${written.tips.length} predictions` : 'Copy failed — the clipboard is blocked here');
  });

  $('#refresh').addEventListener('click', () => {
    clearCache();
    toast('Cache cleared — refetching');
    loadDate(state.date);
  });
}

boot().catch((e) => {
  console.error(e);
  const b = $('#board');
  if (b) b.innerHTML = `<div class="note bad">The page failed to start: ${esc(e.message)}. Open the browser console for the stack trace.</div>`;
});
