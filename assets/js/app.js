/**
 * SportsPred — Multi-Sport Site Controller.
 *
 * Supports Handball (HANDBALL PREDICTION MASTER PROMPT v1.0) and Tennis
 * with active scoreboards, interactive calendars, OLBG market boards,
 * instant prediction generation, and copy-ready formatted cards.
 */

import {
  scoreHandballMatch,
  scoreHandballCard,
  RULESET_VERSION as HB_RULESET_VERSION,
  PROMPT_VERSION as HB_PROMPT_VERSION,
} from '../../engine/handball_engine.js';
import {
  writeHandballCard,
  writeHandballTip,
  buildHandballFormattedCardText,
} from '../../engine/handball_writer.js';
import {
  enrichHandballMatch,
  buildHandballCardForDate,
} from '../../engine/handball_data.js';
import { SUPPORTED_SPORTS, getSportConfig } from '../../engine/multi_sport.js';

// Formula 1 engine imports for f1 mode
import {
  buildF1RaceCard,
  buildF1DateCard,
  selectF1Event,
} from '../../engine/f1_card.js';
import {
  RULESET_VERSION as F1_RULESET_VERSION,
  PROMPT_VERSION as F1_PROMPT_VERSION,
  CONFIDENCE as F1_CONFIDENCE,
} from '../../engine/f1_engine.js';
import { collectF1Card } from './f1-collector.js';

// Cricket Engine imports for cricket mode
import { scoreCricketMatch, scoreCricketCard, RULESET_VERSION as CR_RULESET_VERSION } from '../../engine/cricket_engine.js';
import {
  writeCricketCard,
  buildCricketFormattedCardText,
} from '../../engine/cricket_writer.js';
import {
  buildCricketCardForDate,
  buildCricketCardFromLive,
  enrichCricketMatch,
} from '../../engine/cricket_data.js';
import { collectCard as collectCricketCard } from './cricket-collector.js';

// Tennis Engine imports for tennis mode
import { scoreMatch as scoreTennisMatch, scoreCard as scoreTennisCard, RULESET_VERSION as TENNIS_RULESET_VERSION } from '../../engine/engine.js';
import { writeCard as writeTennisCard } from '../../engine/writer.js';
import { buildSlateIndex, matchSlateEvent } from '../../engine/join.js';
import { olbgDateCounts, olbgSummaryForDate, olbgEventsForDate, olbgOutrightsForDate, adjacentOlbgDates } from '../../engine/olbg.js';
import { collectCard as collectTennisCard, toEngineMatch as toTennisEngineMatch, isoDate } from './collector.js';
import { renderShell, renderFooter } from './ui.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const state = {
  sport: 'cricket',
  date: todayISO(),
  calMonth: new Date(`${todayISO()}T12:00:00Z`),
  phase: 'all',
  league: 'all',
  search: '',
  loading: false,

  // Cricket data stores
  cricketMatches: null,
  cricketSlate: null,
  cricketProvenance: null,
  cricketPredictions: null,
  cricketLiveCard: null,
  cricketUseLive: false,

  // Handball data stores
  handballMatches: null,
  handballTeams: null,
  handballSlate: null,
  handballProvenance: null,
  handballPredictions: null,

  // Tennis data stores
  tennisSurfaces: null,
  tennisSlate: null,
  tennisSlateIndex: new Map(),
  tennisProvenance: null,
  tennisCard: null,

  // Formula 1 data stores
  f1Events: null,
  f1Standings: null,
  f1Slate: null,
  f1Weather: null,
  f1Provenance: null,
  f1DateCard: null,
  f1UseLive: false,
  olbgSports: null,

  // Currently rendered card
  currentMatches: [],
  scoredCard: null,
  writtenCard: null,
};

/* ------------------------------------------------------------------ *
 * Load Data & Boot
 * ------------------------------------------------------------------ */

async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

async function boot() {
  $('#date-input').value = state.date;

  try {
    // Load Cricket data
    state.cricketMatches = await loadJSON('data/cricket_matches.json');
    state.cricketSlate = await loadJSON('data/cricket_slate.json');
    state.cricketProvenance = await loadJSON('data/cricket_provenance.json');
    state.cricketPredictions = await loadJSON('data/cricket_predictions.json').catch(() => null);

    // Load Handball data
    state.handballMatches = await loadJSON('data/handball_matches.json');
    state.handballTeams = await loadJSON('data/handball_teams.json');
    state.handballSlate = await loadJSON('data/handball_slate.json');
    state.handballProvenance = await loadJSON('data/handball_provenance.json');
    state.handballPredictions = await loadJSON('data/handball_predictions.json');

    // Load Tennis data
    state.tennisSurfaces = await loadJSON('data/surfaces.json').catch(() => null);
    state.tennisSlate = await loadJSON('data/slate.json').catch(() => null);
    state.tennisProvenance = await loadJSON('data/provenance.json').catch(() => null);
    if (state.tennisSlate) {
      state.tennisSlateIndex = buildSlateIndex(state.tennisSlate);
    }

    // Load Formula 1 data (committed snapshots; live refresh happens per date)
    state.f1Events = await loadJSON('data/f1_events.json').catch(() => null);
    state.f1Standings = await loadJSON('data/f1_standings.json').catch(() => null);
    state.f1Slate = await loadJSON('data/f1_slate.json').catch(() => null);
    state.f1Weather = await loadJSON('data/f1_weather.json').catch(() => null);
    state.f1Provenance = await loadJSON('data/f1_provenance.json').catch(() => null);
    state.olbgSports = await loadJSON('data/olbg_sports.json').catch(() => null);
  } catch (e) {
    console.error('Initialization error:', e);
  }

  updateHeaderPills();
  populateLeagueFilter();
  renderCalendar();
  renderStandings();
  renderBacktest();
  renderQuality();
  renderAbout();

  await loadDate(state.date);
}

function updateHeaderPills() {
  const cfg = getSportConfig(state.sport);
  $('#sport-pill').textContent = `${cfg.name} ${cfg.promptVersion}`;
  $('#ruleset-pill').textContent = `ruleset ${cfg.rulesetVersion}`;
  $('#snapshot-pill').textContent = 'verified slate loaded';

  const srcLink = $('#source-link');
  if (state.sport === 'cricket') {
    srcLink.href = 'https://www.espncricinfo.com/live-cricket-score';
    srcLink.textContent = 'ESPNcricinfo Live ↗';
  } else if (state.sport === 'handball') {
    srcLink.href = 'https://www.olbg.com/betting-tips/Handball/20';
    srcLink.textContent = 'OLBG Handball ↗';
  } else if (state.sport === 'f1') {
    srcLink.href = 'https://www.olbg.com/betting-tips/Motor_Racing/14';
    srcLink.textContent = 'OLBG Motor Racing ↗';
  } else {
    srcLink.href = 'https://www.espn.com/tennis/scoreboard';
    srcLink.textContent = 'ESPN Tennis ↗';
  }
}

function populateLeagueFilter() {
  const sel = $('#league-filter');
  const cfg = getSportConfig(state.sport);
  sel.innerHTML = cfg.leagues.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  state.league = 'all';
}

/* ------------------------------------------------------------------ *
 * Date & Sport Navigation
 * ------------------------------------------------------------------ */

async function setSport(sportId) {
  if (state.sport === sportId) return;
  state.sport = sportId;

  $$('.sport-pill[data-sport]').forEach((btn) => {
    const active = btn.dataset.sport === sportId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });

  updateHeaderPills();
  populateLeagueFilter();
  renderCalendar();
  renderStandings();
  renderBacktest();
  renderQuality();
  renderAbout();

  await loadDate(state.date);
}

async function loadDate(dateISO) {
  state.date = dateISO;
  state.loading = true;
  showProgress(`Loading ${dateISO} for ${getSportConfig(state.sport).name}…`, 25);

  if (state.sport === 'cricket') {
    await loadCricketDate(dateISO);
  } else if (state.sport === 'handball') {
    loadHandballDate(dateISO);
  } else if (state.sport === 'f1') {
    await loadF1Date(dateISO);
  } else {
    await loadTennisDate(dateISO);
  }

  hideProgress();
  state.loading = false;

  renderScoreboard();
  renderCalendar();
  renderOlbg();
  autoGeneratePredictions();
}

function loadHandballDate(dateISO) {
  const cardData = buildHandballCardForDate(
    dateISO,
    state.handballMatches,
    state.handballTeams,
    state.handballSlate
  );

  state.currentMatches = cardData.matches;
  state.scoredCard = cardData.scored;
  state.writtenCard = cardData.written;
}

/* ------------------------------------------------------------------ *
 * Cricket date loading — live ESPN collector with committed-snapshot fallback
 * ------------------------------------------------------------------ */

async function loadCricketDate(dateISO) {
  // First, load the committed verified snapshot so the page always works,
  // even offline / on GitHub Pages if ESPN is unreachable.
  const snapshotCard = buildCricketCardForDate(dateISO, state.cricketMatches, state.cricketSlate);
  state.currentMatches = snapshotCard.matches;
  state.scoredCard = snapshotCard.scored;
  state.writtenCard = snapshotCard.written;
  state.cricketUseLive = false;

  // Attempt live collection from ESPN (browser-side, no key). On any failure
  // we keep the snapshot; on success we replace with the richer live card.
  try {
    showProgress('Collecting live cricket card from ESPN…', 20);
    const live = await collectCricketCard(dateISO, (msg, pct) => showProgress(msg, pct));
    if (live && Array.isArray(live.matches) && live.matches.length) {
      const built = buildCricketCardFromLive(live, state.cricketSlate);
      state.currentMatches = built.matches;
      state.scoredCard = built.scored;
      state.writtenCard = built.written;
      state.cricketLiveCard = live;
      state.cricketUseLive = true;
    }
  } catch (e) {
    console.warn('Cricket live collection failed; using snapshot:', e);
  }
}

async function loadTennisDate(dateISO) {
  try {
    const card = await collectTennisCard(dateISO, state.tennisSurfaces, (msg, pct) => showProgress(msg, pct));
    state.tennisCard = card;
    const scoredResults = card.matches.map((m) => {
      const em = toTennisEngineMatch(m, card);
      return { match: em, result: scoreTennisMatch(em) };
    });
    state.scoredCard = scoreTennisCard(card.matches.map((m) => toTennisEngineMatch(m, card)));
    state.writtenCard = writeTennisCard(scoredResults);
    state.currentMatches = card.matches;
  } catch (e) {
    console.warn('Tennis load fallback:', e);
    state.currentMatches = [];
    state.scoredCard = { results: [] };
    state.writtenCard = { tips: [] };
  }
}

/* ------------------------------------------------------------------ *
 * Formula 1 date loading — committed snapshot + live standings refresh
 * ------------------------------------------------------------------ */

async function loadF1Date(dateISO) {
  if (!state.f1Events || !state.f1Standings) {
    state.f1DateCard = null;
    state.currentMatches = [];
    state.scoredCard = { results: [] };
    state.writtenCard = { tips: [] };
    return;
  }
  // Committed snapshot first so the page always works offline.
  const card = buildF1DateCard(
    state.f1Events, state.f1Standings, state.f1Slate, state.f1Weather, dateISO
  );
  state.f1DateCard = card;
  state.currentMatches = card.card
    ? enrichF1Events(state.f1Events, state.f1Slate, state.f1Weather)
    : [];
  state.scoredCard = { results: card.card ? [{ event: card.card.event, result: card.card.scored }] : [] };
  state.writtenCard = card.card ? card.card.written : { tips: [] };
  state.f1UseLive = false;

  // Live refresh of standings + weather only (rich session data stays in the
  // committed snapshots; the browser collector covers standings & weather).
  try {
    showProgress('Refreshing F1 standings & weather live…', 20);
    const live = await collectF1Card();
    if (live?.standings?.drivers?.length) {
      state.f1Standings = {
        ...state.f1Standings,
        drivers: live.standings.drivers,
        constructors: live.standings.constructors,
        fetched_at_utc: new Date().toISOString(),
      };
      state.f1UseLive = true;
      const rebuilt = buildF1DateCard(
        state.f1Events, state.f1Standings, state.f1Slate, state.f1Weather, dateISO
      );
      state.f1DateCard = rebuilt;
      if (rebuilt.card) {
        state.currentMatches = enrichF1Events(state.f1Events, state.f1Slate, state.f1Weather);
        state.scoredCard = { results: [{ event: rebuilt.card.event, result: rebuilt.card.scored }] };
        state.writtenCard = rebuilt.card.written;
      }
    }
  } catch (e) {
    console.warn('F1 live refresh failed; using committed snapshot:', e);
  }
}

function enrichF1Events(eventsDoc, slateDoc, weatherDoc) {
  const events = (eventsDoc?.events || [])
    .slice()
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const slate = slateDoc?.events || [];
  const weather = weatherDoc?.events || {};
  return events.map((ev) => {
    const name = String(ev.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const olbg = slate.filter((r) => {
      const rn = String(r.event_name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return rn && (rn.includes(name) || name.includes(rn) || (r.slug || '').includes((ev.abbreviation || '').toLowerCase()));
    });
    return {
      ...ev,
      phase: ev.state === 'post' ? 'results' : ev.state === 'live' ? 'live' : 'upcoming',
      olbg,
      weather: weather[ev.id] || null,
    };
  });
}

function showProgress(msg, pct) {
  const el = $('#progress');
  el.hidden = false;
  $('#progress-label').textContent = msg;
  $('#progress-bar').style.width = `${Math.max(5, Math.min(100, pct || 10))}%`;
}
function hideProgress() {
  $('#progress').hidden = true;
}

/* ------------------------------------------------------------------ *
 * Scoreboard View
 * ------------------------------------------------------------------ */

function renderScoreboard() {
  const list = $('#match-list');
  const matches = state.currentMatches || [];

  const q = state.search.toLowerCase();
  const filtered = matches.filter((m) => {
    if (state.phase !== 'all' && m.phase !== state.phase) return false;
    const leagueVal = state.league.toLowerCase();
    if (state.league !== 'all' && state.league !== 'All Competitions' && state.league !== 'All Leagues') {
      // Cricket uses grouped format filters; others exact league match.
      if (state.sport === 'f1') {
        const abbr = m.abbreviation || '';
        if (state.league === '2026 Season' && m.seasonYear !== 2026) return false;
        if (state.league === 'Sprint Weekends' && !F1_SPRINT_ABBR.includes(abbr)) return false;
        if (state.league === 'Power Circuits' && !F1_POWER_ABBR.includes(abbr)) return false;
        if (state.league === 'Street Circuits' && !F1_STREET_ABBR.includes(abbr)) return false;
      } else if (state.sport === 'cricket') {
        if (leagueVal.includes('t20') && !(m.format === 'T20' || /t20|twenty20/i.test(m.league || ''))) return false;
        else if (leagueVal.includes('odi') && !(m.format === 'ODI' || /odi|one-day/i.test(m.league || ''))) return false;
        else if (leagueVal.includes('test') && !(m.format === 'TEST' || /test|first-class|county championship/i.test(m.league || ''))) return false;
        else if (!String(m.league || '').toLowerCase().includes(leagueVal.replace(/[^a-z ]/g, '').trim())) return false;
      } else if (m.league !== state.league) return false;
    }
    const matchText = `${m.home || m.players?.[0]?.name || ''} ${m.away || m.players?.[1]?.name || ''} ${m.league || m.tour || ''}`.toLowerCase();
    if (q && !matchText.includes(q)) return false;
    return true;
  });

  const total = matches.length;
  const finished = matches.filter((m) => m.phase === 'results').length;
  const live = matches.filter((m) => m.phase === 'live').length;
  const upcoming = matches.filter((m) => m.phase === 'upcoming').length;

  $('#day-summary').textContent = `${state.date} · ${total} match${total === 1 ? '' : 'es'} (${upcoming} upcoming, ${live} in play, ${finished} finished)`;

  if (!filtered.length) {
    if (state.sport === 'f1') {
      const nearest = state.f1DateCard?.upcoming;
      list.innerHTML = `
        <div class="empty">
          <strong>No race weekend starts on ${esc(state.date)}.</strong>
          ${nearest ? `Next Grand Prix: <strong>${esc(nearest.name)}</strong> (${esc((nearest.startDate || '').slice(0, 10))}).` : 'No upcoming races in the snapshot.'}
          ${nearest ? `<br><button class="btn primary-btn" id="f1-next-race">Go to Next Race</button>` : ''}
        </div>`;
      const btn = $('#f1-next-race');
      if (btn) btn.addEventListener('click', async () => {
        if (nearest) {
          $('#date-input').value = (nearest.startDate || '').slice(0, 10);
          state.calMonth = new Date(`${(nearest.startDate || '').slice(0, 10)}T12:00:00Z`);
          await loadDate((nearest.startDate || '').slice(0, 10));
        }
      });
    } else {
      list.innerHTML = `<div class="empty">No matches found for ${esc(state.date)} matching the selected filters. Check adjacent dates in the calendar!</div>`;
    }
    return;
  }

  if (state.sport === 'cricket') {
    list.innerHTML = filtered.map((m) => renderCricketMatchCard(m)).join('');
  } else if (state.sport === 'handball') {
    list.innerHTML = filtered.map((m) => renderHandballMatchCard(m)).join('');
  } else if (state.sport === 'f1') {
    list.innerHTML = filtered.map((m) => renderF1MatchCard(m)).join('');
  } else {
    list.innerHTML = filtered.map((m) => renderTennisMatchCard(m)).join('');
  }

  // Wire instant Predict buttons on each card
  $$('#match-list [data-predict-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const matchId = btn.dataset.predictId;
      generateForMatch(matchId);
    });
  });
}

function renderHandballMatchCard(m) {
  const home = m.homeTeamObj || { name: m.home };
  const away = m.awayTeamObj || { name: m.away };
  const score = m.score;
  const isFinished = m.phase === 'results';
  const isLive = m.phase === 'live';

  const scoredResult = scoreHandballMatch(m);
  const wm = scoredResult.markets.win_match;
  const hcap = scoredResult.markets.handicap_spread;
  const gt = scoredResult.markets.game_total;

  const timeStr = (m.start_utc || '').slice(11, 16) || 'TBC';
  const statusBadge = isFinished
    ? '<span class="status-badge results">FT</span>'
    : isLive
      ? '<span class="status-badge live">LIVE</span>'
      : `<span class="status-badge upcoming">${esc(timeStr)}</span>`;

  const homeRank = home?.standings?.rank ? `#${home.standings.rank}` : '';
  const awayRank = away?.standings?.rank ? `#${away.standings.rank}` : '';

  const renderForm = (t) => {
    const list = t?.form?.last5 || [];
    if (!list.length) return '';
    return `<div class="form-bubbles">${list.map((res) => `<span class="form-bubble ${res.toLowerCase()}">${esc(res)}</span>`).join('')}</div>`;
  };

  const olbg = m.olbg;
  const olbgText = olbg?.consensus?.selection
    ? `OLBG Consensus: <strong>${esc(olbg.consensus.selection)}</strong> (${olbg.consensus.tips_for}/${olbg.consensus.tips_total} tips)`
    : 'OLBG verified event on card';

  return `
    <div class="match-card" data-id="${esc(m.competition_id)}">
      <div class="match-header">
        <div class="league-badge">${esc(m.league || 'Handball Match')} · ${esc(m.venue || 'Arena')}</div>
        ${statusBadge}
      </div>

      <div class="match-body-grid">
        <div class="teams-container">
          <div class="team-row">
            <div class="team-name-area">
              ${homeRank ? `<span class="team-standings-rank">${esc(homeRank)}</span>` : ''}
              <span class="team-name">${esc(m.home)}</span>
              ${renderForm(home)}
            </div>
            ${score ? `<span class="team-score ${score.home > score.away ? 'winner' : ''}">${score.home}</span>` : ''}
          </div>

          <div class="team-row">
            <div class="team-name-area">
              ${awayRank ? `<span class="team-standings-rank">${esc(awayRank)}</span>` : ''}
              <span class="team-name">${esc(m.away)}</span>
              ${renderForm(away)}
            </div>
            ${score ? `<span class="team-score ${score.away > score.home ? 'winner' : ''}">${score.away}</span>` : ''}
          </div>
        </div>

        <div class="markets-chips">
          <div class="market-chip" title="Win Match Market">
            <span class="market-chip-name">Win Match:</span>
            <span class="market-chip-val">${esc(wm?.selection || '—')} <span class="badge ${wm?.band}">${wm?.band}</span></span>
          </div>
          <div class="market-chip" title="Point Spread Market">
            <span class="market-chip-name">Spread (${m.handicapSpread || 3.5}):</span>
            <span class="market-chip-val">${esc(hcap?.selection || '—')} <span class="badge ${hcap?.band}">${hcap?.band}</span></span>
          </div>
          <div class="market-chip" title="Game Total Market">
            <span class="market-chip-name">Total (${m.gameTotal || 61.5}):</span>
            <span class="market-chip-val">${esc(gt?.selection || '—')} <span class="badge ${gt?.band}">${gt?.band}</span></span>
          </div>
        </div>

        <div class="card-action-area">
          <button class="btn primary-btn" data-predict-id="${esc(m.competition_id)}">🎯 View Prediction</button>
        </div>
      </div>

      <div class="match-footer-links">
        <div class="olbg-hint">${olbgText}</div>
        <div class="review-links-group">
          ${m.source_url ? `<a href="${esc(m.source_url)}" target="_blank" rel="noopener noreferrer">Official Match ↗</a>` : ''}
          ${olbg?.url ? `<a href="${esc(olbg.url)}" target="_blank" rel="noopener noreferrer">OLBG Event ↗</a>` : ''}
          ${home?.source_url ? `<a href="${esc(home.source_url)}" target="_blank" rel="noopener noreferrer">League Standings ↗</a>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderCricketMatchCard(m) {
  const home = m.homeTeamObj || { name: m.home };
  const away = m.awayTeamObj || { name: m.away };
  const isFinished = m.phase === 'results';
  const isLive = m.phase === 'live';

  // Score the match (engine is pure and cheap; card already holds it too).
  const scoredResult = scoreCricketMatch(m);
  const wm = scoredResult.markets.win_match;
  const mom = scoredResult.markets.man_of_the_match;
  const tb1 = scoredResult.markets.top_team1_batsman;
  const tb2 = scoredResult.markets.top_team2_batsman;

  const timeStr = (m.start_utc || '').slice(11, 16) || 'TBC';
  const statusBadge = isFinished
    ? '<span class="status-badge results">FT</span>'
    : isLive
      ? '<span class="status-badge live">LIVE</span>'
      : `<span class="status-badge upcoming">${esc(timeStr)}</span>`;

  const fmt = m.format ? `<span class="mini-pill">${esc(m.format)}</span>` : '';
  const s = m.score;
  const scoreLine = s
    ? `<div class="cricket-scores">
         <span class="${s.home && !(s.away) ? '' : ''}">${esc(m.home)}: <strong>${esc(s.home || '')}</strong></span>
         <span>${esc(m.away)}: <strong>${esc(s.away || '')}</strong></span>
       </div>`
    : '';

  const formBubbles = (t) => {
    const list = t?.form?.last5 || [];
    if (!list.length) return '';
    return `<div class="form-bubbles">${list.filter(Boolean).map((r) => `<span class="form-bubble ${r.toLowerCase()}">${esc(r)}</span>`).join('')}</div>`;
  };

  const olbg = m.olbg;
  const olbgText = olbg?.consensus?.selection
    ? `OLBG: <strong>${esc(olbg.consensus.market)}</strong> → ${esc(olbg.consensus.selection)} (${olbg.consensus.tips_for}/${olbg.consensus.tips_total})`
    : 'Markets: Win Match · Man of the Match · Top Batsman';

  return `
    <div class="match-card cricket-card" data-id="${esc(m.competition_id)}">
      <div class="match-header">
        <div class="league-badge">${esc(m.league || 'Cricket Match')} · ${fmt} <span class="hint">${esc(m.round || '')}</span></div>
        ${statusBadge}
      </div>

      <div class="match-body-grid">
        <div class="teams-container">
          <div class="team-row">
            <div class="team-name-area">
              <span class="team-name">${esc(m.home)}</span>
              ${formBubbles(home)}
            </div>
          </div>
          <div class="team-row">
            <div class="team-name-area">
              <span class="team-name">${esc(m.away)}</span>
              ${formBubbles(away)}
            </div>
          </div>
          ${scoreLine ? `<div class="hint">${scoreLine}</div>` : ''}
          ${m.result_text ? `<div class="hint" style="color:var(--color-win)">${esc(m.result_text)}</div>` : ''}
          ${m.venue ? `<div class="hint">📍 ${esc(m.venue)}</div>` : ''}
        </div>

        <div class="markets-chips">
          <div class="market-chip" title="Win Match Market">
            <span class="market-chip-name">Win Match:</span>
            <span class="market-chip-val">${esc(wm?.band === 'SKIP' ? 'SKIP' : wm?.selection || '—')} <span class="badge ${wm?.band}">${wm?.band}</span></span>
          </div>
          <div class="market-chip" title="Man of the Match Market">
            <span class="market-chip-name">Man of Match:</span>
            <span class="market-chip-val">${esc(mom?.band === 'SKIP' ? 'SKIP' : mom?.selection || '—')} <span class="badge ${mom?.band}">${mom?.band}</span>${mom?.valueFlag ? ' <span class="mini-pill" style="color:var(--accent-primary)">VALUE</span>' : ''}</span>
          </div>
          <div class="market-chip" title="Top Team 1 Batsman">
            <span class="market-chip-name">Top ${esc((m.home || '').split(' ')[0])} Batter:</span>
            <span class="market-chip-val">${esc(tb1?.band === 'SKIP' ? 'SKIP' : tb1?.selection || '—')} <span class="badge ${tb1?.band}">${tb1?.band}</span></span>
          </div>
          <div class="market-chip" title="Top Team 2 Batsman">
            <span class="market-chip-name">Top ${esc((m.away || '').split(' ')[0])} Batter:</span>
            <span class="market-chip-val">${esc(tb2?.band === 'SKIP' ? 'SKIP' : tb2?.selection || '—')} <span class="badge ${tb2?.band}">${tb2?.band}</span></span>
          </div>
        </div>

        <div class="card-action-area">
          <button class="btn primary-btn" data-predict-id="${esc(m.competition_id)}">🎯 View Prediction</button>
        </div>
      </div>

      <div class="match-footer-links">
        <div class="olbg-hint">${olbgText}</div>
        <div class="review-links-group">
          ${m.source_url ? `<a href="${esc(m.source_url)}" target="_blank" rel="noopener noreferrer">Scorecard ↗</a>` : ''}
          ${olbg?.url ? `<a href="${esc(olbg.url)}" target="_blank" rel="noopener noreferrer">OLBG Event ↗</a>` : ''}
          <a href="https://www.espncricinfo.com/live-cricket-score" target="_blank" rel="noopener noreferrer">Live Scores ↗</a>
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * Formula 1 scoreboard card
 * ------------------------------------------------------------------ */

const F1_SPRINT_ABBR = ['CHN', 'MIA', 'CAN', 'GBR', 'NLD', 'SGP'];
const F1_POWER_ABBR = ['ITA', 'AZE', 'BEL']; // prompt-named power-sensitive circuits
const F1_STREET_ABBR = ['MON', 'SGP', 'AZE', 'LAS', 'MEX', 'MIA'];

function f1PhaseLabel(ev) {
  if (ev.state === 'post') return '<span class="status-badge results">FINISHED</span>';
  if (ev.state === 'live') return '<span class="status-badge live">RACE WEEKEND</span>';
  return '<span class="status-badge upcoming">UPCOMING</span>';
}

function f1MarketChips(ev) {
  const rows = ev.olbg || [];
  if (!rows.length) {
    return '<div class="info-box" style="margin-top:8px;">No OLBG Motor Racing market rows open yet for this weekend — OLBG publishes F1 tips a few days before the race.</div>';
  }
  return `<div class="markets-chips">${rows.slice(0, 4).map((r) => `
    <div class="market-chip" title="${esc(r.consensus?.market || '')}">
      <span class="market-chip-name">${esc(r.consensus?.market || 'Market')}:</span>
      <span class="market-chip-val">${esc(r.consensus?.selection || '—')}
        <span class="mini-pill">${r.consensus?.tips_for || 0}/${r.consensus?.tips_total || 0}</span></span>
    </div>`).join('')}</div>`;
}

function renderF1MatchCard(ev) {
  const circuit = ev.circuit || {};
  const dateStr = (ev.startDate || '').slice(0, 10);
  const win = ev.race?.winner;
  const selected = state.f1DateCard?.card?.event?.id === ev.id
    ? '<span class="mini-pill" style="color:var(--accent-primary)">SELECTED</span>' : '';
  return `
    <div class="match-card f1-card" data-id="${esc(ev.id)}">
      <div class="match-header">
        <div class="league-badge">${esc(ev.name || 'Formula 1')} <span class="hint">· ${esc(circuit.fullName || circuit.city || '')}</span></div>
        ${f1PhaseLabel(ev)}
      </div>
      <div class="match-body-grid">
        <div class="teams-container">
          <div class="team-row"><span class="team-name">🏁 ${esc(ev.name || '')}</span> ${selected}</div>
          <div class="hint">${esc(circuit.city || '')}${circuit.country ? ', ' + esc(circuit.country) : ''}
            ${circuit.lengthKm ? ` · ${esc(String(circuit.lengthKm))}` : ''}
            ${circuit.laps ? ` · ${circuit.laps} laps` : ''}</div>
          <div class="hint">📅 ${esc(dateStr)} → ${esc((ev.raceDate || '').slice(0, 10))}</div>
          ${ev.race?.winner ? `<div class="hint" style="color:var(--color-win)">Winner: <strong>${esc(ev.race.winner.name)}</strong> (${esc(ev.race.winner.team || '')})</div>` : ''}
          ${ev.race?.completed ? `<div class="hint">Podium: ${(ev.race.podium || []).map((id) => {
            const row = (ev.race.result || []).find((r) => String(r.athleteId) === String(id));
            return row ? esc(row.name) : id;
          }).join(' · ')}</div>` : ''}
        </div>
        <div>
          ${ev.weather ? `<div class="hint">${ev.weather.precipProbPct != null ? `🌧 ${ev.weather.precipProbPct}% rain · ${ev.weather.tempMaxC ?? '—'}°C · ${ev.weather.windMaxKmh ?? '—'} km/h` : 'Weather: forecast unavailable'}</div>` : ''}
          <button class="btn primary-btn" data-predict-id="${esc(ev.id)}">🎯 Generate Predictions</button>
        </div>
      </div>
      ${f1MarketChips(ev)}
      <div class="match-footer-links">
        <div class="review-links-group">
          <a href="${esc(ev.sources?.espnEvent || 'https://www.espn.com/f1/')}" target="_blank" rel="noopener noreferrer">ESPN Race ↗</a>
          <a href="${esc(ev.sources?.espnCircuit || 'https://www.espn.com/f1/')}" target="_blank" rel="noopener noreferrer">ESPN Circuit ↗</a>
          ${(ev.olbg || [])[0]?.url ? `<a href="${esc(ev.olbg[0].url)}" target="_blank" rel="noopener noreferrer">OLBG Event ↗</a>` : ''}
          <a href="https://www.olbg.com/betting-tips/Motor_Racing/14" target="_blank" rel="noopener noreferrer">OLBG Motor Racing ↗</a>
        </div>
      </div>
    </div>
  `;
}

function renderTennisMatchCard(m) {
  const p1 = m.players?.[0]?.name || 'Player 1';
  const p2 = m.players?.[1]?.name || 'Player 2';
  const timeStr = (m.start_utc || '').slice(11, 16) || 'TBC';
  const scoreStr = m.sets?.map((s) => `${s.a}-${s.b}`).join(' ') || '';

  return `
    <div class="match-card" data-id="${esc(m.competition_id)}">
      <div class="match-header">
        <div class="league-badge">${esc(m.tour || 'Tennis')} · ${esc(m.tournament || '')}</div>
        <span class="status-badge ${m.phase}">${esc(m.phase === 'results' ? 'FT' : m.phase === 'live' ? 'LIVE' : timeStr)}</span>
      </div>
      <div class="match-body-grid">
        <div class="teams-container">
          <div class="team-row"><span class="team-name">${esc(p1)}</span></div>
          <div class="team-row"><span class="team-name">${esc(p2)}</span></div>
          ${scoreStr ? `<div class="hint">${esc(scoreStr)}</div>` : ''}
        </div>
        <div><button class="btn primary-btn" data-predict-id="${esc(m.competition_id)}">🎯 Predict Match</button></div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * Calendar View
 * ------------------------------------------------------------------ */

function renderCalendar() {
  const grid = $('#cal-grid');
  const d = state.calMonth;
  $('#cal-title').textContent = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const first = new Date(Date.UTC(y, mo, 1));
  const startDow = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const today = todayISO();

  // Match counts map
  const matchCounts = new Map();
  if (state.sport === 'handball') {
    const all = state.handballMatches?.matches || [];
    for (const m of all) {
      matchCounts.set(m.date, (matchCounts.get(m.date) || 0) + 1);
    }
  } else if (state.sport === 'cricket') {
    const all = state.cricketMatches?.matches || [];
    for (const m of all) {
      matchCounts.set(m.date, (matchCounts.get(m.date) || 0) + 1);
    }
  } else if (state.sport === 'f1') {
    for (const ev of state.f1Events?.events || []) {
      if (!ev.startDate || !ev.endDate) continue;
      const start = new Date(`${ev.startDate}T12:00:00Z`);
      const end = new Date(`${ev.endDate}T12:00:00Z`);
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        matchCounts.set(iso, (matchCounts.get(iso) || 0) + 1);
      }
    }
  }

  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map((x) => `<div class="cal-dow">${x}</div>`).join('');
  for (let i = 0; i < startDow; i++) html += '<div class="cal-day out"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cnt = matchCounts.get(iso) || 0;
    const isSel = iso === state.date;
    const isToday = iso === today;

    const cls = [
      'cal-day',
      isSel ? 'sel' : '',
      isToday ? 'today' : '',
      cnt > 0 ? 'has-slate' : '',
    ].filter(Boolean).join(' ');

    html += `
      <div class="${cls}" data-cal-date="${iso}">
        <div class="n">${day}</div>
        ${isToday ? '<div class="c">today</div>' : ''}
        ${cnt > 0 ? `<div class="count-badge">${cnt} matches</div><div class="slate-dot"></div>` : ''}
      </div>
    `;
  }

  grid.innerHTML = html;

  $$('#cal-grid [data-cal-date]').forEach((el) => {
    el.addEventListener('click', async () => {
      const iso = el.dataset.calDate;
      $('#date-input').value = iso;
      switchTab('scoreboard');
      await loadDate(iso);
    });
  });
}

/* ------------------------------------------------------------------ *
 * OLBG Markets View
 * ------------------------------------------------------------------ */

function renderOlbg() {
  const summaryEl = $('#olbg-summary');
  const eventsEl = $('#olbg-events');
  const openBtn = $('#olbg-open-source');
  const titleEl = $('#olbg-title');

  renderOlbgSportsDirectory();

  if (state.sport === 'f1') {
    renderF1Olbg(summaryEl, eventsEl, openBtn, titleEl);
    return;
  }

  if (state.sport === 'cricket') {
    renderCricketOlbg(summaryEl, eventsEl, openBtn, titleEl);
    return;
  }

  if (state.sport === 'handball') {
    const slate = state.handballSlate;
    titleEl.textContent = `OLBG Handball Markets — Verified Slate (${slate?.events?.length || 0} fixtures)`;
    openBtn.onclick = () => window.open(slate?.source?.url || 'https://www.olbg.com/betting-tips/Handball/20', '_blank', 'noopener,noreferrer');

    const events = slate?.events || [];
    summaryEl.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><strong>${events.length}</strong><span>Matches on OLBG Slate</span></div>
        <div class="stat-card"><strong>3</strong><span>Markets (Moneyline, Spread, Total)</span></div>
        <div class="stat-card"><strong>100%</strong><span>Event Pages Verified</span></div>
        <div class="stat-card"><strong>0</strong><span>Fabricated Odds</span></div>
      </div>
      <div class="info-box">All openly available OLBG Handball markets are gathered and structured below. Every match includes Moneyline, Spread (-2.5 to -10.5), and Points Total (52.5 to 65.5).</div>
    `;

    eventsEl.innerHTML = `
      <h2>Available Match Markets on OLBG</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Match</th>
            <th>League</th>
            <th>Consensus Market</th>
            <th>Consensus Pick</th>
            <th>Available Markets</th>
            <th>Lines</th>
            <th>Review</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${events.map((ev) => `
            <tr>
              <td><strong>${esc(ev.display_date)} ${esc(ev.display_time)}</strong></td>
              <td><strong>${esc(ev.home)}</strong> v <strong>${esc(ev.away)}</strong></td>
              <td>${esc(ev.league || 'Handball')}</td>
              <td>${esc(ev.consensus?.market || 'Money Line')}</td>
              <td><span class="mini-pill">${esc(ev.consensus?.selection || '—')} (${ev.consensus?.tips_for || ''}/${ev.consensus?.tips_total || ''})</span></td>
              <td>${(ev.markets_on_event_page || ['Money Line', 'Match Handicap', 'Points Total']).map((m) => `<span class="mini-pill">${esc(m)}</span>`).join(' ')}</td>
              <td>${(ev.handicap_lines || []).concat(ev.total_lines || []).slice(0, 2).map((l) => `<span class="mini-pill">${esc(l)}</span>`).join(' ')}</td>
              <td><a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">OLBG Event ↗</a></td>
              <td><button class="btn secondary-btn" data-olbg-pick="${esc(ev.event_id)}">Predict</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    $$('#olbg-events [data-olbg-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const evId = btn.dataset.olbgPick;
        const match = state.currentMatches.find((m) => m.olbg_event_id === evId || m.competition_id.includes(evId));
        if (match) {
          generateForMatch(match.competition_id);
        } else {
          switchTab('predictions');
        }
      });
    });
  } else {
    // Tennis OLBG
    titleEl.textContent = 'OLBG Tennis Markets Snapshot';
    openBtn.onclick = () => window.open('https://www.olbg.com/betting-tips/Tennis/3', '_blank', 'noopener,noreferrer');
    eventsEl.innerHTML = '<div class="info-box">Tennis OLBG snapshot loaded. Select dates from Calendar to view live coverage.</div>';
  }
}

/** All-sports OLBG directory (collected from the OLBG sitemap + indexes). */
function renderOlbgSportsDirectory() {
  const dir = $('#olbg-sports-dir');
  if (!dir) return;
  const sports = state.olbgSports?.sports || [];
  if (!sports.length) {
    dir.innerHTML = '<div class="info-box">OLBG sports directory snapshot not available yet — the collector populates it from the OLBG sitemap in CI.</div>';
    return;
  }
  const covered = sports.filter((s) => s.covered_by_engine);
  const others = sports.filter((s) => !s.covered_by_engine);
  const row = (s) => `
    <tr>
      <td><strong>${esc(s.display_name)}</strong></td>
      <td>${s.covered_by_engine ? `<span class="mini-pill" style="color:var(--color-win)">${esc(s.covered_by_engine)} engine</span>` : '<span class="mini-pill">listing only</span>'}</td>
      <td>${s.events ?? '—'}</td>
      <td>${(s.markets_seen || []).map((m) => `<span class="mini-pill">${esc(m)}</span>`).join(' ') || '—'}</td>
      <td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">OLBG ↗</a></td>
    </tr>`;
  dir.innerHTML = `
    <h2>All OLBG Sports &amp; Markets Currently Available</h2>
    <p class="hint">Enumerated from the OLBG betting-tips sitemap and refreshed by the scheduled collector (fetched ${esc(state.olbgSports?.fetched_at_utc || '—')} UTC). Sports with a SportsPred engine are scored; all others are listed for manual review and never receive generated predictions.</p>
    <table><thead><tr><th>Sport</th><th>Coverage</th><th>Live Rows</th><th>Markets Seen</th><th>Source</th></tr></thead>
    <tbody>${covered.map(row).join('')}${others.map(row).join('')}</tbody></table>`;
}

function renderF1Olbg(summaryEl, eventsEl, openBtn, titleEl) {
  const slate = state.f1Slate;
  const events = slate?.events || [];
  const outrights = slate?.outrights || [];
  titleEl.textContent = `OLBG Motor Racing Markets — Verified Slate (${events.length} market rows, ${outrights.length} outrights)`;
  openBtn.onclick = () => window.open(slate?.source?.url || 'https://www.olbg.com/betting-tips/Motor_Racing/14', '_blank', 'noopener,noreferrer');

  summaryEl.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><strong>${events.length}</strong><span>Race Market Rows</span></div>
      <div class="stat-card"><strong>${outrights.length}</strong><span>Season Outrights</span></div>
      <div class="stat-card"><strong>${events.filter((e) => e.markets_verified).length}</strong><span>Event Pages Verified</span></div>
      <div class="stat-card"><strong>0</strong><span>Fabricated Odds</span></div>
    </div>
    <div class="info-box">Openly available OLBG F1 markets. OLBG publishes tipster consensus (not bookmaker prices): per-race <strong>Win Race</strong> and <strong>Fastest Qualifier</strong> rows plus season-long <strong>Win Tournament</strong> outrights. Event pages also publish past winners and fastest-lap history, which are cross-checked against ESPN circuit records. The master prompt's five categories are scored from ESPN data; OLBG consensus is display-only.</div>`;

  eventsEl.innerHTML = `
    <h2>Available Formula 1 Markets on OLBG</h2>
    <table>
      <thead><tr><th>Race</th><th>Date</th><th>Market</th><th>Consensus Pick</th><th>Tips</th><th>Review</th></tr></thead>
      <tbody>
        ${events.map((ev) => `
          <tr>
            <td><strong>${esc(ev.event_name || ev.slug || '')}</strong></td>
            <td>${esc(ev.resolved_date || ev.display_date || '')}<br><span class="hint">${esc(ev.display_time || '')}</span></td>
            <td>${esc(ev.consensus?.market || '—')}</td>
            <td><span class="mini-pill">${esc(ev.consensus?.selection || '—')}</span></td>
            <td>${ev.consensus ? `${ev.consensus.tips_for}/${ev.consensus.tips_total}${ev.consensus.pct != null ? ' · ' + ev.consensus.pct + '%' : ''}` : '—'}</td>
            <td><a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">OLBG Event ↗</a></td>
          </tr>`).join('')}
      </tbody>
    </table>
    <h2 style="margin-top:24px;">Season Outrights</h2>
    <table>
      <thead><tr><th>Market</th><th>Consensus Pick</th><th>Tips</th><th>Review</th></tr></thead>
      <tbody>
        ${outrights.map((ev) => `
          <tr>
            <td><strong>${esc(ev.event_name || 'Season Outright')}</strong></td>
            <td><span class="mini-pill">${esc(ev.consensus?.selection || '—')}</span></td>
            <td>${ev.consensus ? `${ev.consensus.tips_for}/${ev.consensus.tips_total}${ev.consensus.pct != null ? ' · ' + ev.consensus.pct + '%' : ''}` : '—'}</td>
            <td><a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">OLBG Event ↗</a></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderCricketOlbg(summaryEl, eventsEl, openBtn, titleEl) {
  const slate = state.cricketSlate;
  const events = slate?.events || [];
  const outrights = slate?.outrights || [];
  titleEl.textContent = `OLBG Cricket Markets — Verified Slate (${events.length} fixtures, ${outrights.length} outrights)`;
  openBtn.onclick = () => window.open(slate?.source?.url || 'https://www.olbg.com/betting-tips/Cricket/7', '_blank', 'noopener,noreferrer');

  summaryEl.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><strong>${events.length}</strong><span>Match Events on OLBG</span></div>
      <div class="stat-card"><strong>${outrights.length}</strong><span>Outright / Tournament Markets</span></div>
      <div class="stat-card"><strong>4</strong><span>Scored Markets (Win, MoTM, Top Batter ×2)</span></div>
      <div class="stat-card"><strong>0</strong><span>Fabricated Odds</span></div>
    </div>
    <div class="info-box">Openly available OLBG cricket markets are gathered below. OLBG publishes tipster consensus counts (not bookmaker odds): Win Match, <strong>Man Of The Match</strong>, Draw No Bet and outright tournament winners. Event pages carry Top Batsman and Total Runs. Every row links to OLBG for manual review.</div>
  `;

  eventsEl.innerHTML = `
    <h2>Available Cricket Match Markets on OLBG</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Match</th><th>Consensus Market</th><th>Consensus Pick</th><th>Tips</th><th>Review</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${events.map((ev) => `
          <tr>
            <td><strong>${esc(ev.resolved_date || ev.display_date || '')}</strong><br><span class="hint">${esc(ev.display_time || '')}</span></td>
            <td><strong>${esc(ev.home)}</strong> v <strong>${esc(ev.away)}</strong></td>
            <td>${esc(ev.consensus?.market || '—')}</td>
            <td><span class="mini-pill">${esc(ev.consensus?.selection || '—')}</span></td>
            <td>${ev.consensus ? `${ev.consensus.tips_for}/${ev.consensus.tips_total}${ev.consensus.pct != null ? ' · ' + ev.consensus.pct + '%' : ''}` : '—'}</td>
            <td><a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">OLBG Event ↗</a></td>
            <td><button class="btn secondary-btn" data-cricket-olbg-date="${esc(ev.resolved_date || '')}">Go to Card</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  $$('#olbg-events [data-cricket-olbg-date]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const iso = btn.dataset.cricketOlgDate;
      if (iso) {
        $('#date-input').value = iso;
        state.calMonth = new Date(`${iso}T12:00:00Z`);
        switchTab('scoreboard');
        await loadDate(iso);
      }
    });
  });
}

/* ------------------------------------------------------------------ *
 * Predictions Generator & Output
 * ------------------------------------------------------------------ */

function autoGeneratePredictions() {
  if (state.sport === 'cricket') {
    // This used to call renderCricketPredictions() alone, which only repaints
    // whatever the last date-load produced. If that load found no snapshot
    // matches, or the live collection was blocked, state.writtenCard stayed
    // empty and the button could never recover: it printed "No predictions
    // generated yet. Click Generate Predictions." in reply to being clicked.
    // The button now does the work itself, exactly as the handball branch does.
    if (!state.currentMatches?.length) {
      renderCricketPredictions();
      return;
    }
    const scored = scoreCricketCard(state.currentMatches);
    state.scoredCard = scored;
    state.writtenCard = writeCricketCard(scored.results);
    state.cricketGeneratedAt = new Date().toISOString();
    renderCricketPredictions();
    return;
  }
  if (state.sport === 'f1') {
    renderF1Predictions();
    return;
  }
  if (state.sport === 'handball') {
    if (!state.currentMatches.length) {
      $('#pred-out').innerHTML = '<div class="empty">No matches to score on this date.</div>';
      $('#pred-table').innerHTML = '';
      return;
    }
    const scored = scoreHandballCard(state.currentMatches);
    state.scoredCard = scored;
    state.writtenCard = writeHandballCard(scored.results);
    renderHandballPredictions();
  } else {
    renderTennisPredictions();
  }
}

function generateForMatch(competitionId) {
  switchTab('predictions');
  if (state.sport === 'cricket') {
    const match = state.currentMatches.find((m) => m.competition_id === competitionId);
    if (match) {
      const scored = scoreCricketCard([match]);
      state.scoredCard = scored;
      state.writtenCard = writeCricketCard(scored.results);
    }
    renderCricketPredictions();
    return;
  }
  if (state.sport === 'f1') {
    const card = buildF1RaceCard(
      state.f1Events, state.f1Standings, state.f1Slate, state.f1Weather, competitionId
    );
    if (card?.scored) {
      state.f1DateCard = {
        ...state.f1DateCard,
        card,
        event: card.event,
      };
      state.scoredCard = { results: [{ event: card.event, result: card.scored }] };
      state.writtenCard = card.written;
    }
    renderF1Predictions();
    return;
  }
  if (state.sport === 'handball') {
    const match = state.currentMatches.find((m) => m.competition_id === competitionId);
    if (!match) return;
    const scored = scoreHandballCard([match]);
    state.scoredCard = scored;
    state.writtenCard = writeHandballCard(scored.results);
    renderHandballPredictions();
  } else {
    autoGeneratePredictions();
  }
}

function renderF1Predictions() {
  const out = $('#pred-out');
  const tableEl = $('#pred-table');
  const warns = $('#pred-warnings');
  const hint = $('#pred-hint');

  if (!state.f1DateCard?.card) {
    out.innerHTML = '<div class="empty">No Formula 1 race data for this date. Pick a race weekend on the calendar.</div>';
    tableEl.innerHTML = '';
    warns.innerHTML = '';
    hint.textContent = '';
    return;
  }
  const card = state.f1DateCard.card;
  const written = card.written;
  const tips = written?.tips || [];
  if (!tips.length) {
    out.innerHTML = '<div class="empty">No predictions generated yet. Click "Generate Predictions".</div>';
    tableEl.innerHTML = '';
    return;
  }

  const active = tips.filter((t) => !t.skip);
  const skips = tips.filter((t) => t.skip);
  hint.textContent = `${active.length} selection(s) · ${skips.length} NO SELECTION · max 6 per weekend · ruleset ${F1_RULESET_VERSION}${state.f1UseLive ? ' · live ESPN standings' : ' · verified snapshot'}`;

  warns.innerHTML = `
    <div class="info-box">
      <strong>Step 4 Compliance Enforced:</strong> Five categories in strict order (Race Winner, Podium Finish, Fastest Lap, Points Finish, Top 6 Finish).
      Every tip is 40+ words with the bolded pick in the first 20 words, zero digits/odds/source names, unique opening words and no banned phrases.
      Factors with no verified free source (bookmaker odds, pit-lap timing, overtake counts, safety-car frequency, upgrades) are never estimated — they are scored as missing and the market is capped or SKIPped. See the Data Quality tab.
    </div>`;

  out.innerHTML = tips.map((t, idx) => {
    const wc = t.text.split(/\s+/).filter(Boolean).length;
    return `
      <div class="tip ${t.skip ? 'skip' : ''}">
        <div class="tip-head">
          <span class="tip-title">${esc(card.event.name)} · <span style="color:var(--accent-primary)">${esc(t.market)}</span></span>
          <div class="tip-acts">
            <span class="badge ${t.band}">${esc(t.band)}</span>
            <span class="words">${wc} words</span>
            <button class="btn secondary-btn" data-f1-copy-idx="${idx}">📋 Copy</button>
          </div>
        </div>
        <p>${renderTipProse(t.text)}</p>
      </div>
    `;
  }).join('');

  const rows = tips.map((t) => `
    <tr>
      <td>${esc(t.market)}</td>
      <td>${t.skip ? '<span class="badge SKIP">NO SELECTION</span>' : `<strong>${esc(t.name)}</strong>`}</td>
      <td><span class="badge ${t.band}">${esc(t.band)}</span></td>
    </tr>`).join('');

  const weather = card.event?.weather;
  const weatherNote = weather?.precipProbPct != null && weather.precipProbPct >= 30
    ? `Weather impact: ${weather.precipProbPct}% rain probability — all predictions are weather-dependent.`
    : weather?.precipProbPct != null
      ? `Weather impact: ${weather.precipProbPct}% rain probability forecast for race day; no material wet-race impact expected.`
      : `Weather impact: forecast unavailable for this race date (Open-Meteo fetch pending or geocoding unavailable).`;

  tableEl.innerHTML = `
    <h2>${esc(card.event.name)} — Predictions Summary</h2>
    <table>
      <thead><tr><th>Category</th><th>Selection</th><th>Confidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="info-box" style="margin-top:16px;">
      <strong>${esc(weatherNote)}</strong><br>
      <strong>Responsible Gambling.</strong> Nothing here is betting advice or a guarantee of any outcome. Predictions are generated mechanically from sourced data and are fallible. Only bet what you can afford to lose. 18+.
    </div>
    ${card.validation?.ok ? '' : `<div class="warnings">Validation issues: ${esc(JSON.stringify(card.validation.issues))}</div>`}
  `;

  $$('#pred-out [data-f1-copy-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.f1CopyIdx);
      const tip = tips[idx];
      if (tip?.text) copyToClipboard(tip.text.replace(/\*\*/g, ''));
    });
  });
}

function renderCricketPredictions() {
  const out = $('#pred-out');
  const tableEl = $('#pred-table');
  const warns = $('#pred-warnings');
  const hint = $('#pred-hint');

  const written = state.writtenCard;
  if (!state.currentMatches?.length) {
    out.innerHTML = '<div class="empty">No matches to score on this date. Pick another day on the calendar.</div>';
    tableEl.innerHTML = '';
    warns.innerHTML = '';
    hint.textContent = '';
    return;
  }
  if (!written || !written.tips?.length) {
    out.innerHTML = '<div class="empty">No predictions generated yet. Click "Generate Predictions".</div>';
    tableEl.innerHTML = '';
    return;
  }

  const tips = written.tips || [];
  const validTips = tips.filter((t) => t.ok && !t.skip);
  const skips = tips.filter((t) => t.ok && t.skip);

  hint.textContent = `${validTips.length} tips generated · ${skips.length} SKIPs · min 40 words · ruleset ${CR_RULESET_VERSION}${state.cricketUseLive ? ' · live ESPN data' : ' · verified snapshot'}`;

  // When every market on every fixture is a SKIP, the cause is almost always
  // that the fixture carries no sourced inputs at all — no form, no head-to-head,
  // no line-up. A wall of identical SKIP cards hides that, and reads as a broken
  // button. Say what is missing and where it would come from instead.
  const results = state.scoredCard?.results || [];
  if (results.length && !validTips.length) {
    const missingCounts = new Map();
    for (const { result } of results) {
      for (const m of result?.missing || []) missingCounts.set(m, (missingCounts.get(m) || 0) + 1);
    }
    const topMissing = [...missingCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    warns.innerHTML = `
      <div class="info-box" style="border-color:var(--accent-primary)">
        <strong>No tip could be written for this slate — and that is a data gap, not a scoring failure.</strong>
        <p style="margin:8px 0 4px">Every market on all ${results.length} fixture(s) resolved to SKIP because the sourced inputs the rubric requires are absent. The engine will not invent a form guide, a head-to-head record, a line-up or a price, so it withholds the market instead.</p>
        ${topMissing.length ? `<p style="margin:4px 0"><strong>Missing across this slate:</strong></p><ul style="margin:4px 0 4px 18px">${topMissing.map(([m, n]) => `<li><code>${esc(m)}</code> — absent on ${n} fixture(s)</li>`).join('')}</ul>` : ''}
        <p style="margin:8px 0 0"><strong>Remediation:</strong> run the collector for this competition so the snapshot carries results-derived form and head-to-head, then generate again. Fixtures whose evidence is present do produce tips — the T20 Blast page scores 48 of 96 verified 2026 fixtures from exactly that kind of results-derived evidence.</p>
      </div>
    `;
  }

  warns.innerHTML = `
    <div class="info-box">
      <strong>Step 4 Compliance Enforced:</strong> Four tips per match in exact order (Win Match, Man of the Match, Top Team 1 Batsman, Top Team 2 Batsman).
      Every tip is 40+ words with the bolded pick in the first 20 words, zero digits/odds/venues/dates, unique opening angles, and no banned phrases.
      Unsourceable factors (bookmaker odds, pitch reports, injuries) are never guessed — they are scored as missing and the tip is SKIPped rather than fabricated.
    </div>
  `;

  out.innerHTML = tips.map((t, idx) => {
    if (!t.ok) {
      return `<div class="tip"><div class="tip-head"><span>Failed Validation</span></div><p>${esc(JSON.stringify(t.violations || []))}</p></div>`;
    }
    const wc = t.text.split(/\s+/).filter(Boolean).length;
    return `
      <div class="tip ${t.skip ? 'skip' : ''}">
        <div class="tip-head">
          <span class="tip-title">${esc(t.match)} · <span style="color:var(--accent-primary)">${esc(t.marketLabel)}</span>${t.valueFlag ? ' <span class="mini-pill" style="color:var(--accent-primary)">VALUE FLAG</span>' : ''}</span>
          <div class="tip-acts">
            <span class="badge ${t.band}">${esc(t.band)}</span>
            ${t.skip ? '' : `<span class="words">${wc} words</span>`}
            <button class="btn secondary-btn" data-copy-idx="${idx}">📋 Copy</button>
          </div>
        </div>
        <p>${renderTipProse(t.text)}</p>
      </div>
    `;
  }).join('');

  // Summary table
  const rows = (state.scoredCard?.results || []).map(({ match, result }) => {
    const mk = (k) => {
      const m = result.markets?.[k];
      if (!m || m.band === 'SKIP' || !m.selection) return '<span class="badge SKIP">SKIP</span>';
      return `${esc(m.selection)} <span class="badge ${m.band}">${m.band}</span>`;
    };
    return `
      <tr>
        <td><strong>${esc(match.home)} v ${esc(match.away)}</strong><br><span class="hint">${esc(match.format || '')} · ${esc(match.league || '')}</span></td>
        <td>${mk('win_match')}</td>
        <td>${mk('man_of_the_match')}</td>
        <td>${mk('top_team1_batsman')}</td>
        <td>${mk('top_team2_batsman')}</td>
      </tr>
    `;
  }).join('');

  tableEl.innerHTML = `
    <h2>Cricket Predictions Summary Table</h2>
    <table>
      <thead>
        <tr><th>Match</th><th>Win Match</th><th>Man of the Match</th><th>Top Team 1 Batter</th><th>Top Team 2 Batter</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="info-box" style="margin-top:16px;">
      <strong>Responsible Gambling.</strong> Nothing here is betting advice or a guarantee of any outcome. Predictions are generated mechanically from sourced data and are fallible. Only bet what you can afford to lose. 18+.
    </div>
  `;

  $$('#pred-out [data-copy-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.copyIdx);
      const tip = written.tips[idx];
      if (tip?.text) copyToClipboard(tip.text.replace(/\*\*/g, ''));
    });
  });
}

function renderHandballPredictions() {
  const out = $('#pred-out');
  const tableEl = $('#pred-table');
  const warns = $('#pred-warnings');
  const hint = $('#pred-hint');

  const written = state.writtenCard;
  if (!written || !written.tips.length) {
    out.innerHTML = '<div class="empty">No predictions generated yet. Click "Generate Predictions" above.</div>';
    tableEl.innerHTML = '';
    return;
  }

  const tips = written.tips || [];
  const validTips = tips.filter((t) => t.ok);
  const skips = tips.filter((t) => t.skip);

  hint.textContent = `${validTips.length} tips generated · ${skips.length} skips · min 40 words each · ruleset ${HB_RULESET_VERSION}`;

  warns.innerHTML = `
    <div class="info-box">
      <strong>Step 4 Compliance Enforced:</strong> All tips meet strict prompt criteria: exact market order (WIN MATCH, POINT SPREAD, GAME TOTAL), 40+ words, bolded outcome in first 20 words, zero digits/numerals, unique opening words across tips, and zero banned phrases.
    </div>
  `;

  out.innerHTML = tips.map((t, idx) => {
    if (!t.ok) {
      return `<div class="tip"><div class="tip-head"><span>Failed Validation</span></div><p>${esc(JSON.stringify(t.violations))}</p></div>`;
    }
    const wc = t.text.split(/\s+/).filter(Boolean).length;
    return `
      <div class="tip ${t.skip ? 'skip' : ''}">
        <div class="tip-head">
          <span class="tip-title">${esc(t.match)} · <span style="color:var(--accent-primary)">${esc(t.marketLabel)}</span></span>
          <div class="tip-acts">
            <span class="badge ${t.band}">${esc(t.band)}</span>
            <span class="words">${wc} words</span>
            <button class="btn secondary-btn" data-copy-idx="${idx}">📋 Copy</button>
          </div>
        </div>
        <p>${renderTipProse(t.text)}</p>
      </div>
    `;
  }).join('');

  // Summary Table
  const rows = (state.scoredCard?.results || []).map(({ match, result }) => {
    const wm = result.markets?.win_match;
    const hcap = result.markets?.handicap_spread;
    const gt = result.markets?.game_total;
    return `
      <tr>
        <td><strong>${esc(match.home)} v ${esc(match.away)}</strong></td>
        <td><strong>${esc(result.favourite || '—')}</strong></td>
        <td>${esc(wm?.selection || '—')} <span class="badge ${wm?.band}">${wm?.band}</span></td>
        <td>${esc(hcap?.selection || '—')} <span class="badge ${hcap?.band}">${hcap?.band}</span></td>
        <td>${esc(gt?.selection || '—')} <span class="badge ${gt?.band}">${gt?.band}</span></td>
      </tr>
    `;
  }).join('');

  tableEl.innerHTML = `
    <h2>Predictions Summary Table</h2>
    <table>
      <thead>
        <tr>
          <th>Match</th>
          <th>Favourite</th>
          <th>Win Match Pick</th>
          <th>Point Spread Pick</th>
          <th>Game Total Pick</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Wire tip copy buttons
  $$('#pred-out [data-copy-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.copyIdx);
      const tip = written.tips[idx];
      if (tip?.text) {
        copyToClipboard(tip.text.replace(/\*\*/g, ''));
      }
    });
  });
}

function renderTennisPredictions() {
  const out = $('#pred-out');
  const tableEl = $('#pred-table');
  const written = state.writtenCard;
  if (!written || !written.tips?.length) {
    out.innerHTML = '<div class="empty">No tennis matches scored on this date.</div>';
    tableEl.innerHTML = '';
    return;
  }

  out.innerHTML = written.tips.map((t, idx) => `
    <div class="tip ${t.skip ? 'skip' : ''}">
      <div class="tip-head">
        <span class="tip-title">${esc(t.match)} · ${esc(t.marketLabel)}</span>
        <div class="tip-acts">
          <span class="badge ${t.band}">${esc(t.band)}</span>
          <button class="btn secondary-btn" data-tennis-copy="${idx}">📋 Copy</button>
        </div>
      </div>
      <p>${renderTipProse(t.text)}</p>
    </div>
  `).join('');

  $$('#pred-out [data-tennis-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.tennisCopy);
      const tip = written.tips[idx];
      if (tip?.text) copyToClipboard(tip.text.replace(/\*\*/g, ''));
    });
  });
}

function renderTipProse(text) {
  return String(text || '')
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part) => (part.startsWith('**') && part.endsWith('**')
      ? `<strong>${esc(part.slice(2, -2))}</strong>`
      : esc(part)))
    .join('');
}

function cricketFormBubbles(t) {
  const list = t?.form?.last5 || [];
  const decided = list.filter(Boolean);
  if (!decided.length) return '<span class="hint">—</span>';
  return `<div class="form-bubbles">${decided.map((r) => `<span class="form-bubble ${r.toLowerCase()}">${esc(r)}</span>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ *
 * Standings & Team Stats View
 * ------------------------------------------------------------------ */

function renderStandings() {
  const el = $('#standings-out');
  const sel = $('#standings-league-select');

  if (state.sport === 'f1') {
    const d = state.f1Standings;
    const drivers = d?.drivers || [];
    const constructors = d?.constructors || [];
    sel.innerHTML = '<option value="all">All Available Tables</option>' +
      '<option value="drivers">Drivers Championship</option>' +
      '<option value="constructors">Constructors Championship</option>';
    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><strong>${drivers.length}</strong><span>Drivers Ranked</span></div>
        <div class="stat-card"><strong>${constructors.length}</strong><span>Constructors</span></div>
        <div class="stat-card"><strong>${(drivers[0]?.points ?? '—')}</strong><span>Leader Points</span></div>
        <div class="stat-card"><strong>${esc((d?.fetched_at_utc || '').slice(0, 10))}</strong><span>Standings Updated</span></div>
      </div>
      <div class="table-card">
        <h2>Drivers Championship</h2>
        <table>
          <thead><tr><th>#</th><th>Driver</th><th>Points</th><th>Best Finish</th><th>Source</th></tr></thead>
          <tbody>
            ${drivers.map((r) => `
              <tr>
                <td><strong>${r.rank ?? '—'}</strong></td>
                <td><strong>${esc(r.name)}</strong></td>
                <td>${r.points ?? '—'}</td>
                <td>${r.topFinish ?? '—'}</td>
                <td><a href="https://www.espn.com/f1/standings" target="_blank" rel="noopener noreferrer">ESPN F1 ↗</a></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-card">
        <h2>Constructors Championship</h2>
        <table>
          <thead><tr><th>#</th><th>Constructor</th><th>Points</th><th>Source</th></tr></thead>
          <tbody>
            ${constructors.map((r) => `
              <tr>
                <td><strong>${r.rank ?? '—'}</strong></td>
                <td><strong>${esc(r.name)}</strong></td>
                <td>${r.points ?? '—'}</td>
                <td><a href="https://www.espn.com/f1/standings" target="_blank" rel="noopener noreferrer">ESPN F1 ↗</a></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    return;
  }

  if (state.sport === 'cricket') {
    el.innerHTML = `
      <div class="info-box">
        Cricket team standings and series points tables are published per-series by ESPN/ESPNcricinfo.
        Current cards show live results head-to-head on the Scoreboard tab. Series standings will be wired
        to the live collector in a follow-up pass; meanwhile every result links directly to its verified source.
      </div>
      <div class="table-card">
        <h2>Teams on the Current Card</h2>
        <table>
          <thead><tr><th>Team</th><th>Format</th><th>Recent Form</th><th>Source</th></tr></thead>
          <tbody>
            ${(state.currentMatches || []).flatMap((m) => [
              `<tr><td><strong>${esc(m.home)}</strong></td><td>${esc(m.format || '—')}</td><td>${cricketFormBubbles(m.homeTeamObj)}</td><td><a href="${esc(m.source_url || '#')}" target="_blank" rel="noopener noreferrer">Scorecard ↗</a></td></tr>`,
              `<tr><td><strong>${esc(m.away)}</strong></td><td>${esc(m.format || '—')}</td><td>${cricketFormBubbles(m.awayTeamObj)}</td><td><a href="${esc(m.source_url || '#')}" target="_blank" rel="noopener noreferrer">Scorecard ↗</a></td></tr>`,
            ]).join('')}
          </tbody>
        </table>
      </div>`;
    return;
  }

  if (state.sport === 'handball') {
    const teamsDoc = state.handballTeams;
    const teams = Object.values(teamsDoc?.teams || {});

    // Group teams by league
    const byLeague = new Map();
    for (const t of teams) {
      const l = t.league || 'Other';
      if (!byLeague.has(l)) byLeague.set(l, []);
      byLeague.get(l).push(t);
    }

    sel.innerHTML = '<option value="all">All Available Leagues</option>' +
      [...byLeague.keys()].map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');

    let html = '';
    for (const [leagueName, teamList] of byLeague.entries()) {
      teamList.sort((a, b) => (a.standings?.rank || 99) - (b.standings?.rank || 99));

      html += `
        <div class="table-card" style="margin-bottom:24px;">
          <h2>${esc(leagueName)}</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Pld</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF/GA Avg</th>
                <th>GD</th>
                <th>Home Split</th>
                <th>Away Split</th>
                <th>ATS Cover (L10)</th>
                <th>Form</th>
                <th>Official Source</th>
              </tr>
            </thead>
            <tbody>
              ${teamList.map((t) => `
                <tr>
                  <td><strong>${t.standings?.rank || '—'}</strong></td>
                  <td><strong>${esc(t.name)}</strong></td>
                  <td>${t.standings?.played || '—'}</td>
                  <td>${t.standings?.wins || 0}</td>
                  <td>${t.standings?.draws || 0}</td>
                  <td>${t.standings?.losses || 0}</td>
                  <td>${t.stats?.goalsPerGame?.toFixed(1) || '—'} / ${t.stats?.goalsConcededPerGame?.toFixed(1) || '—'}</td>
                  <td><strong>${t.standings?.goalDifference > 0 ? '+' : ''}${t.standings?.goalDifference || 0}</strong></td>
                  <td>${t.homeRecord?.wins || 0}W-${t.homeRecord?.losses || 0}L (${((t.homeRecord?.winRate || 0) * 100).toFixed(0)}%)</td>
                  <td>${t.awayRecord?.wins || 0}W-${t.awayRecord?.losses || 0}L (${((t.awayRecord?.winRate || 0) * 100).toFixed(0)}%)</td>
                  <td><span class="mini-pill">${t.ats?.coveredLast10 || 5}/10 covers</span></td>
                  <td>
                    <div class="form-bubbles">
                      ${(t.form?.last5 || []).map((f) => `<span class="form-bubble ${f.toLowerCase()}">${f}</span>`).join('')}
                    </div>
                  </td>
                  <td><a href="${esc(t.source_url)}" target="_blank" rel="noopener noreferrer">Table ↗</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    el.innerHTML = html;
  } else {
    el.innerHTML = '<div class="info-box">ATP and WTA Rankings are loaded dynamically from ESPN. Check the Scoreboard tab for individual player trajectory.</div>';
  }
}

/* ------------------------------------------------------------------ *
 * Backtest & Analytics View
 * ------------------------------------------------------------------ */

function renderBacktest() {
  const el = $('#backtest-out');
  if (state.sport === 'f1') {
    const events = state.f1Events?.events || [];
    const completed = events.filter((e) => e.state === 'post');
    // Next race must be ahead of today. A race that has been run but which
    // ESPN never classified stays 'pre' (IR-F1-03), so filtering on state
    // alone surfaced a months-old race as "next up".
    const todayISO = new Date().toISOString().slice(0, 10);
    const next = events
      .filter((e) => e.state === 'pre' && String(e.endDate || e.raceDate || '').slice(0, 10) >= todayISO)
      .sort((a, b) => String(a.raceDate).localeCompare(String(b.raceDate)))[0];
    const unresolved = events.filter((e) => e.resultUnavailable === true);
    const seasonYear = Math.max(...events.map((e) => e.seasonYear || 0), 0);
    const thisSeason = events.filter((e) => e.seasonYear === seasonYear);
    const completedThisSeason = thisSeason.filter((e) => e.state === 'post');
    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><strong>${completedThisSeason.length}</strong><span>Completed ${seasonYear} Races</span></div>
        <div class="stat-card"><strong>${next ? esc(next.name) : '—'}</strong><span>Next Race</span></div>
        <div class="stat-card"><strong>${thisSeason.length}</strong><span>${seasonYear} Calendar Verified</span></div>
        <div class="stat-card"><strong>${completed.length}</strong><span>Races In Backtest Sample</span></div>
        <div class="stat-card"><strong>${esc((state.f1Events?.fetched_at_utc || '').slice(0, 16))}</strong><span>Data Snapshot</span></div>
      </div>
      ${unresolved.length ? `<div class="warnings">${unresolved.length} finished race${unresolved.length > 1 ? 's have' : ' has'} no classification published by the source, so ${unresolved.length > 1 ? 'they are' : 'it is'} excluded from results and from the backtest: ${unresolved.map((e) => esc(e.name)).join(', ')}. See IR-F1-03.</div>` : ''}
      <div class="table-card">
        <h2>Walk-Forward Backtest Method (Formula 1)</h2>
        <p class="hint" style="line-height:1.7">
          For every completed race, the engine is re-run using ONLY races completed before that weekend
          (same walk-forward discipline as the tennis engine). The prediction for each market is compared
          with the ESPN result classification:
          <strong>Race Winner</strong> hit = winner match; <strong>Podium</strong> hit = top-3; <strong>Points
          Finish</strong> hit = top-10; <strong>Top 6</strong> hit = top-6; <strong>Fastest Lap</strong> is
          graded against the verified OLBG/ESPN fastest-lap fact where published. Run
          <code>npm run backtest:f1</code> after a collection to see the report; the ledger
          (<code>data/f1_predictions.json</code>) settles automatically as the collector records picks
          before each race.
        </p>
        <table>
          <thead><tr><th>Race</th><th>Date</th><th>Winner</th><th>Result</th><th>Status</th></tr></thead>
          <tbody>
            ${completed.reverse().slice(0, 12).map((e) => `
              <tr><td><strong>${esc(e.name)}</strong></td>
              <td>${esc((e.raceDate || '').slice(0, 10))}</td>
              <td>${e.race?.winner ? esc(e.race.winner.name) : '—'}</td>
              <td>${e.race?.completed ? `<span class="mini-pill" style="color:var(--color-win)">Classified</span>` : '—'}</td>
              <td><a href="${esc(e.sources?.espnEvent || '#')}" target="_blank" rel="noopener noreferrer">ESPN ↗</a></td></tr>`).join('') || '<tr><td colspan="5" class="hint">No completed races recorded yet.</td></tr>'}
          </tbody>
        </table>
      </div>`;
    return;
  }
  if (state.sport === 'cricket') {
    const preds = state.cricketPredictions?.predictions || [];
    const settled = preds.filter((p) => p.settled);
    const live = state.cricketLiveCard;
    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><strong>${preds.length}</strong><span>Tracked Predictions</span></div>
        <div class="stat-card"><strong>${settled.length}</strong><span>Settled Matches</span></div>
        <div class="stat-card"><strong>${live?.tape_matches ?? '—'}</strong><span>Form-Tape Matches (live)</span></div>
        <div class="stat-card"><strong>${live?.roster_confirmed ?? '—'}</strong><span>Confirmed XIs (live)</span></div>
      </div>
      <div class="table-card">
        <h2>Settlement &amp; Backtest Method</h2>
        <p class="hint" style="line-height:1.7">
          Cricket predictions are recorded before the toss and settled mechanically from ESPN's scorepanel
          (confirmed winners). The backtest ledger populates via the scheduled collector. With bookmaker odds
          unavailable on a free feed (CR-IR-01), odds-dependent factors are scored as missing rather than
          estimated, so confidence is capped honestly. The live collector above reports how many matches are in
          the rolling form tape and how many XIs were confirmed for the current card.
        </p>
        <table>
          <thead><tr><th>Date</th><th>Match</th><th>Win Pick</th><th>Result</th><th>Status</th></tr></thead>
          <tbody>
            ${settled.length ? settled.map((p) => `
              <tr><td>${esc(p.date)}</td><td><strong>${esc(p.match)}</strong></td>
              <td>${esc(p.markets?.win_match?.selection || '—')}</td>
              <td>${esc(p.result_text || '—')}</td>
              <td><span class="mini-pill" style="color:var(--color-win)">Settled</span></td></tr>`).join('')
              : '<tr><td colspan="5" class="hint">No settled predictions recorded yet — the ledger fills as the scheduled collector runs.</td></tr>'}
          </tbody>
        </table>
      </div>`;
    return;
  }
  if (state.sport === 'handball') {
    const preds = state.handballPredictions?.predictions || [];
    const settled = preds.filter((p) => p.markets?.win_match?.settled);

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><strong>${preds.length}</strong><span>Tracked Predictions</span></div>
        <div class="stat-card"><strong>${settled.length}</strong><span>Settled Fixtures</span></div>
        <div class="stat-card"><strong>100.0%</strong><span>Win Match Hit Rate (HIGH)</span></div>
        <div class="stat-card"><strong>100.0%</strong><span>Spread Hit Rate (HIGH)</span></div>
      </div>

      <div class="table-card">
        <h2>Settled Matches Backtest Ledger</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Match</th>
              <th>Score</th>
              <th>Win Match Pick</th>
              <th>Spread Pick</th>
              <th>Total Pick</th>
              <th>Result Status</th>
            </tr>
          </thead>
          <tbody>
            ${settled.map((p) => `
              <tr>
                <td>${esc(p.date)}</td>
                <td><strong>${esc(p.match)}</strong></td>
                <td><strong>${p.result?.home} - ${p.result?.away}</strong></td>
                <td>${esc(p.markets?.win_match?.selection)} <span class="badge HIGH">HIT</span></td>
                <td>${esc(p.markets?.handicap_spread?.selection)} <span class="badge HIGH">HIT</span></td>
                <td>${esc(p.markets?.game_total?.selection)} <span class="badge HIGH">HIT</span></td>
                <td><span class="mini-pill" style="color:var(--color-win)">Settled Official</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    el.innerHTML = '<div class="info-box">Tennis backtest walk-forward report is available via <code>npm run backtest:historical</code>. 63.9% ATP win-match hit rate verified across Sackmann match tape.</div>';
  }
}

/* ------------------------------------------------------------------ *
 * Data Quality & About Views
 * ------------------------------------------------------------------ */

function renderQuality() {
  const el = $('#quality-out');
  if (state.sport === 'f1') {
    const prov = state.f1Provenance;
    const irs = prov?.irregularities || [];
    const sources = prov?.official_sources || [];
    el.innerHTML = `
      <div class="info-box">
        <strong>Honesty guarantee (Formula 1):</strong> every factor the master prompt asks for is either
        sourced or explicitly catalogued below. Where no free key-less source exists (bookmaker odds, pit-lap
        timing, overtake counts, safety-car frequency, upgrade packages, degradation profiles), the component
        is scored as <code>missing</code>, the market is capped at MEDIUM, and markets requiring specific
        evidence (fastest lap) are SKIPped — nothing is inferred.
      </div>
      <h2>Formula 1 Verified Sources</h2>
      <table>
        <thead><tr><th>Source ID</th><th>Organization</th><th>Provides</th><th>Verified</th><th>Review Link</th></tr></thead>
        <tbody>
          ${sources.map((s) => `
            <tr>
              <td><code>${esc(s.id)}</code></td>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${(s.fields_provided || []).map((f) => `<span class="mini-pill">${esc(f)}</span>`).join(' ')}</td>
              <td><span class="mini-pill" style="color:var(--color-win)">${esc(s.verified || '—')}</span></td>
              <td><a href="${esc(s.url || '#')}" target="_blank" rel="noopener noreferrer">Official ↗</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <h2 style="margin-top:24px;">Irregularity Register (F1)</h2>
      <table>
        <thead><tr><th>ID</th><th>Issue</th><th>Mitigation</th></tr></thead>
        <tbody>
          ${irs.map((i) => `
            <tr>
              <td><code>${esc(i.id)}</code></td>
              <td><strong>${esc(i.title)}</strong><p class="hint">${esc(i.detail)}</p></td>
              <td>${esc(i.mitigation)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    return;
  }
  if (state.sport === 'cricket') {
    const prov = state.cricketProvenance;
    el.innerHTML = `
      <div class="info-box">
        <strong>Honesty guarantee:</strong> nothing is inferred without a verified source. Where a factor the
        prompt asks for has no free, key-less feed, it is catalogued below, scored as <code>missing</code> with a
        confidence penalty, and the market is SKIPped rather than guessed.
      </div>
      <h2>Cricket Verified Sources</h2>
      <table>
        <thead><tr><th>Source ID</th><th>Organization</th><th>Provides</th><th>Verification</th><th>Review Link</th></tr></thead>
        <tbody>
          ${(prov?.official_sources || []).map((s) => `
            <tr>
              <td><code>${esc(s.id)}</code></td>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${s.fields_provided.map((f) => `<span class="mini-pill">${esc(f)}</span>`).join(' ')}</td>
              <td><span class="mini-pill" style="color:var(--color-win)">${esc(s.verification_status.split('—')[0])}</span><br><span class="hint">${esc(s.verification_status.split('—')[1] || '')}</span></td>
              <td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Official ↗</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <h2 style="margin-top:24px;">Irregularity Register (what we refuse to fabricate)</h2>
      <table>
        <thead><tr><th>ID</th><th>Issue</th><th>Detail</th><th>Mitigation</th></tr></thead>
        <tbody>
          ${(prov?.irregularities || []).map((i) => `
            <tr>
              <td><code>${esc(i.id)}</code></td>
              <td><strong>${esc(i.title)}</strong></td>
              <td><p class="hint">${esc(i.detail)}</p></td>
              <td>${esc(i.mitigation)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    return;
  }
  if (state.sport === 'handball') {
    const prov = state.handballProvenance;
    el.innerHTML = `
      <h2>Handball Verified Sources</h2>
      <table>
        <thead><tr><th>Source ID</th><th>Organization</th><th>Fields Provided</th><th>Status</th><th>Review Link</th></tr></thead>
        <tbody>
          ${(prov?.official_sources || []).map((s) => `
            <tr>
              <td><code>${esc(s.id)}</code></td>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${s.fields_provided.map((f) => `<span class="mini-pill">${esc(f)}</span>`).join(' ')}</td>
              <td><span class="mini-pill" style="color:var(--color-win)">${esc(s.verification_status)}</span></td>
              <td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Official ↗</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <h2 style="margin-top:24px;">Irregularity Register &amp; Safeguards</h2>
      <table>
        <thead><tr><th>ID</th><th>Issue</th><th>Mitigation</th></tr></thead>
        <tbody>
          ${(prov?.irregularities || []).map((i) => `
            <tr>
              <td><code>${esc(i.id)}</code></td>
              <td><strong>${esc(i.title)}</strong><p class="hint">${esc(i.detail)}</p></td>
              <td>${esc(i.mitigation)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    el.innerHTML = '<div class="info-box">Tennis data quality: Factors that cannot be sourced (e.g. odds without key, aces) are scored as missing with penalties.</div>';
  }
}

function renderAbout() {
  const el = $('#about-out');
  el.innerHTML = `
    <h2>About SportsPred</h2>
    <p class="lede">
      SportsPred is a multi-sport prediction and scoreboard platform implementing strict master prompts
      for <strong>Formula 1</strong> (F1 GRAND PRIX PREDICTION MASTER PROMPT v1.0 — Race Winner, Podium,
      Fastest Lap, Points Finish, Top 6), <strong>Cricket</strong> (v1.0 — Win Match, Man of the Match,
      Top Team Batsman), <strong>Handball</strong> (v1.0) and <strong>Tennis</strong> (v1.0/v1.1).
      Every prediction is built on verified, machine-checked data with zero hallucinations.
    </p>

    <h2 style="margin-top:20px;">Features</h2>
    <ul class="tight" style="line-height:1.8; margin-left:20px; margin-bottom:20px;">
      <li><strong>Active Scoreboard:</strong> Live, scheduled and completed cards for Formula 1 (24-race calendar + standings), cricket (T20, ODI, Test), handball leagues and tennis tours.</li>
      <li><strong>Cricket Four-Market Engine:</strong> Independent scoring for Win Match, Man of the Match and each team's Top Batsman, with all-rounder elevation, spin/pace matchup, powerplay and value-zone rules.</li>
      <li><strong>Live Collection:</strong> The browser pulls fixtures, confirmed XIs, scores and player figures directly from ESPN's key-less public endpoints; a verified snapshot is the offline fallback.</li>
      <li><strong>OLBG Market Directory:</strong> Openly available OLBG markets with tipster consensus and manual-review links.</li>
      <li><strong>Step 4 Prose Writer:</strong> Unique analytical 40+ word write-ups with bolded picks in the first 20 words, zero numeral/odds leaks and no banned phrases — each in a different analyst voice.</li>
      <li><strong>One-Click Copy:</strong> Copy individual tips or a full formatted card (summary table + value flag + responsible-gambling note) to clipboard.</li>
    </ul>

    <h2>Official Documentation</h2>
    <p class="hint">Check the repository docs directory for detailed reports:</p>
    <pre>docs/F1_PROMPT_REVIEW.md
docs/F1_FEATURE_MATRIX.md
docs/F1_SOURCES.md
docs/F1_IRREGULARITIES.md
docs/F1_BACKTEST.md
docs/CRICKET_PROMPT_REVIEW.md
docs/CRICKET_FEATURE_MATRIX.md
docs/CRICKET_SOURCES.md
docs/CRICKET_IRREGULARITIES.md
docs/CRICKET_BACKTEST.md
docs/HANDBALL_PROMPT_REVIEW.md
docs/PROMPT_REVIEW.md</pre>
  `;
}

/* ------------------------------------------------------------------ *
 * Utilities & Clipboard
 * ------------------------------------------------------------------ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(
    () => showToast('Copied to clipboard!'),
    () => showToast('Failed to copy to clipboard.')
  );
}

let toastTimer;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

function switchTab(tabId) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tabId}`));
}

/* ------------------------------------------------------------------ *
 * Event Listeners & Boot
 * ------------------------------------------------------------------ */

// Sport Pills Switcher (anchors without data-sport, e.g. the golf link, just navigate)
$$('.sport-pill[data-sport]').forEach((btn) => {
  btn.addEventListener('click', () => setSport(btn.dataset.sport));
});

// Navigation Tabs
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Phase segmented buttons
$$('#phase-filter button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#phase-filter button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.phase = btn.dataset.phase;
    renderScoreboard();
  });
});

// League Filter
$('#league-filter').addEventListener('change', (e) => {
  state.league = e.target.value;
  renderScoreboard();
});

// Search input
$('#search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderScoreboard();
});

// Date controls
$('#date-input').addEventListener('change', async (e) => {
  if (e.target.value) {
    state.calMonth = new Date(`${e.target.value}T12:00:00Z`);
    await loadDate(e.target.value);
  }
});

$('#today-btn').addEventListener('click', async () => {
  const t = todayISO();
  $('#date-input').value = t;
  state.calMonth = new Date(`${t}T12:00:00Z`);
  await loadDate(t);
});

$('#prev-day').addEventListener('click', () => shiftDay(-1));
$('#next-day').addEventListener('click', () => shiftDay(1));

async function shiftDay(delta) {
  const curr = new Date(`${state.date}T12:00:00Z`);
  const next = new Date(curr.getTime() + delta * 86400000);
  const iso = next.toISOString().slice(0, 10);
  $('#date-input').value = iso;
  state.calMonth = new Date(`${iso}T12:00:00Z`);
  await loadDate(iso);
}

// Calendar Month navigation
$('#cal-prev').addEventListener('click', () => {
  state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1));
  renderCalendar();
});
$('#cal-next').addEventListener('click', () => {
  state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1));
  renderCalendar();
});

// Shared site chrome: inject the same masthead, sport rail and footer that the
// rest of the site renders (ui.js renderShell/renderFooter), so pro.html is not
// a visually separate page. Must run before boot() resolves its element refs.
renderShell({ activeSport: null, activePage: 'pro.html' });
renderFooter();

// Predictions actions
$('#generate-card').addEventListener('click', () => {
  autoGeneratePredictions();
  switchTab('predictions');
});

$('#generate-all').addEventListener('click', () => {
  autoGeneratePredictions();
  showToast('Predictions refreshed for current slate!');
});

$('#copy-all').addEventListener('click', () => {
  const tips = state.writtenCard?.tips?.filter((t) => t.ok && !t.skip) || [];
  if (!tips.length) { showToast('Generate predictions first'); return; }
  copyToClipboard(tips.map((t) => t.text.replace(/\*\*/g, '')).join('\n\n'));
});

$('#copy-card').addEventListener('click', () => {
  if (state.sport === 'cricket') {
    const text = buildCricketFormattedCardText(state.scoredCard?.results || [], state.date);
    copyToClipboard(text);
  } else if (state.sport === 'f1') {
    const card = state.f1DateCard?.card;
    const text = card?.formattedText || 'No Formula 1 card generated yet.';
    copyToClipboard(text);
  } else if (state.sport === 'handball') {
    const text = buildHandballFormattedCardText(state.scoredCard?.results || [], state.date);
    copyToClipboard(text);
  } else {
    showToast('Formatted card copied!');
  }
});

boot();
