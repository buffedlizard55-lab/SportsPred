/**
 * SportsPred — Cricket live collector (browser).
 *
 * WHY THE BROWSER
 * ---------------
 * The project has no server and no API keys. ESPN's public cricket endpoints
 * are key-less and CORS-enabled, so the visitor's own browser collects the
 * live slate directly. That keeps the site a static GitHub Page while still
 * showing the real card for any date.
 *
 * Pure parsing lives in engine/cricket_espn.js (imported here AND by the Node
 * test suite); this module only does fetching, caching and collection.
 *
 * VERIFIED ENDPOINTS (see docs/CRICKET_SOURCES.md):
 *   - Scorepanel (per-date fixtures, scores, winners, venue, format):
 *     https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel?dates=YYYYMMDD
 *   - Match summary (confirmed rosters, batting positions, runs, SR, wickets,
 *     economy, venue, toss, format):
 *     https://site.web.api.espn.com/apis/site/v2/sports/cricket/{leagueId}/summary?event={eventId}
 *
 * WHAT IS NEVER COLLECTED, AND WHY
 *   - Odds / prices. ESPN ships odds:[] for cricket and no key-less cross-origin
 *     odds source was verified; every odds-dependent factor stays unsourced.
 *   - Pitch reports and weather. No free structured source; never guessed.
 *   - Injuries / social sentiment. No free structured source.
 *
 * Results are cached in localStorage so a reload does not re-hammer ESPN.
 */

import {
  parsePanelEvent as _parsePanelEvent,
  parseSummary,
  bowlingSpinPace,
} from '../../engine/cricket_espn.js';

// Re-export the pure parsers so existing importers (and tests) keep working.
export { classifyFormat, bowlingSpinPace, parseSummary } from '../../engine/cricket_espn.js';
export function parsePanelEvent(ev, leagueId) {
  return _parsePanelEvent(ev, leagueId);
}

const PANEL = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel';
const SUMMARY = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
const CACHE_PREFIX = 'sportspred:cricket:v1:';
const CACHE_TTL_MS = 15 * 60 * 1000;

/** How many days back the form tape reaches (prompt: last month, recent double). */
export const TAPE_DAYS = 30;

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL_MS) return null;
    return v;
  } catch { return null; }
}
function cacheSet(key, v) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v })); } catch { /* ignore */ }
}

async function getJSON(url, { timeoutMs = 15000 } = {}) {
  const cached = cacheGet(url);
  if (cached) return cached;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    if (!r.ok) return null;
    const j = await r.json();
    cacheSet(url, j);
    return j;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

export function yyyymmdd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }

/** Fetch and parse the scorepanel for one date. */
export async function collectDate(dateISO) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  const stamp = yyyymmdd(d);
  const payload = await getJSON(`${PANEL}?dates=${stamp}&lang=en&region=in`);
  const rows = [];
  const seen = new Set();
  for (const score of payload?.scores || []) {
    const leagueId = score.leagueId || score?.leagues?.[0]?.id || '';
    for (const ev of score.events || []) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      rows.push(parsePanelEvent(ev, leagueId));
    }
  }
  return { date: dateISO, rows, ok: !!payload };
}

/**
 * Attach confirmed rosters + this-match stats to a match row from its summary.
 * Derives team-level signals only from confirmed data; never fills gaps.
 */
export function enrichWithSummary(match, summary) {
  if (!summary) return match;
  const homeId = match.homeTeamObj?.id != null ? String(match.homeTeamObj.id) : null;
  const awayId = match.awayTeamObj?.id != null ? String(match.awayTeamObj.id) : null;

  const buildTeam = (teamObj, players) => {
    if (!teamObj || !players) return teamObj;
    const batsmen = players.filter((p) => p.battingPosition != null).sort((a, b) => a.battingPosition - b.battingPosition);
    const bowlers = players.filter((p) => p.bowlingStyle);
    const spinBowlers = bowlers.filter((p) => bowlingSpinPace(p.bowlingStyle) === 'spin').length;
    const paceBowlers = bowlers.filter((p) => bowlingSpinPace(p.bowlingStyle) === 'pace').length;
    const primaryStyle = spinBowlers > paceBowlers ? 'spin' : paceBowlers > spinBowlers ? 'pace' : (bowlers.length ? 'mixed' : null);

    // Confirmed starters only (roster entry starter !== false), with a role.
    const confirmed = players.filter((p) => p.starter && (p.battingPosition != null || p.bowlingStyle));

    return {
      ...teamObj,
      players: confirmed,
      confirmedXi: confirmed.length >= 11,
      battingOrder: batsmen.map((p) => ({ name: p.name, position: p.battingPosition })),
      bowling: { style: primaryStyle, spinBowlers, paceBowlers },
      momCandidates: confirmed.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        battingPosition: p.battingPosition,
        bowlingStyle: bowlingSpinPace(p.bowlingStyle),
        opensBowling: p.role === 'bowler' || p.role === 'allrounder',
        battingStyle: p.matchStats?.strikeRate != null && p.matchStats.strikeRate >= 140 ? 'aggressive' : null,
        odds: null,       // never sourced — see CR-IR-01
        recent: null,     // last-5 form not available from a single summary
        strikeRateVsTeamAvg: null,
        thisMatch: p.matchStats,
      })),
      batsmanCandidates: batsmen.filter((p) => p.battingPosition <= 6).map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        battingPosition: p.battingPosition,
        odds: null,
        recent: null,
        strikeRateVsTeamAvg: p.matchStats?.strikeRate != null
          ? (p.matchStats.strikeRate >= 140 ? 'above' : p.matchStats.strikeRate >= 115 ? 'slightly_above' : 'average')
          : null,
        thisMatch: p.matchStats,
      })),
    };
  };

  return {
    ...match,
    venue: match.venue || summary.venue,
    homeTeamObj: buildTeam(match.homeTeamObj, homeId ? summary.playersByTeam[homeId] : null),
    awayTeamObj: buildTeam(match.awayTeamObj, awayId ? summary.playersByTeam[awayId] : null),
    rosterConfirmed: true,
  };
}

/** Build a results tape over the last N days — used for team form and H2H. */
export async function collectTape(endISO, days = TAPE_DAYS, onProgress) {
  const dates = [];
  const end = new Date(`${endISO}T12:00:00Z`);
  for (let i = 0; i < days; i++) dates.push(isoDate(addDays(end, -i)));
  let done = 0;
  const chunks = await pool(dates, 6, async (dISO) => {
    const { rows } = await collectDate(dISO);
    done++;
    if (onProgress) onProgress(done, dates.length);
    return rows.filter((r) => r.phase === 'results');
  });
  return chunks.flat();
}

/** Derive last-5 W/L for a team from the tape. */
export function teamForm(teamName, tape) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = norm(teamName);
  const played = [];
  for (const m of tape) {
    const h = norm(m.home), a = norm(m.away);
    if (h !== t && a !== t) continue;
    const isHome = h === t;
    const teamObj = isHome ? m.homeTeamObj : m.awayTeamObj;
    const won = teamObj?.winner === true;
    played.push({ date: m.date, result: won ? 'W' : 'L', opponent: isHome ? m.away : m.home });
  }
  played.sort((x, y) => (x.date < y.date ? 1 : -1));
  return {
    last5: played.slice(0, 5).map((p) => p.result),
    winsLast5: played.slice(0, 5).filter((p) => p.result === 'W').length,
    recent: played.slice(0, 5),
  };
}

/** Derive head-to-head between two teams from the tape. */
export function h2h(teamA, teamB, tape) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = norm(teamA), b = norm(teamB);
  const meetings = [];
  for (const m of tape) {
    const h = norm(m.home), aw = norm(m.away);
    if ((h === a && aw === b) || (h === b && aw === a)) {
      const aIsHome = h === a;
      const aWon = (aIsHome ? m.homeTeamObj : m.awayTeamObj)?.winner === true;
      meetings.push({ date: m.date, fromA: aWon ? 'W' : 'L' });
    }
  }
  meetings.sort((x, y) => (x.date < y.date ? 1 : -1));
  const wins = meetings.filter((x) => x.fromA === 'W').length;
  return {
    totalMeetings: meetings.length,
    teamWins: wins,
    recentMeetings: meetings.slice(0, 3).map((x) => x.fromA),
  };
}

/** Full collection for one card date. */
export async function collectCard(dateISO, onProgress) {
  const report = (msg, pct) => onProgress && onProgress(msg, pct);

  report('Loading the day’s matches…', 15);
  const day = await collectDate(dateISO);

  report('Building recent-form history…', 30);
  const tape = await collectTape(dateISO, TAPE_DAYS, (d, t) =>
    report(`Building recent-form history… day ${d} of ${t}`, 30 + Math.round((d / t) * 40)));

  report('Confirming playing XIs and match stats…', 75);
  const enriched = await pool(day.rows, 4, async (m) => {
    if (!m.espn_event_id || !m.espn_league_id) return m;
    const payload = await getJSON(`${SUMMARY}/${m.espn_league_id}/summary?event=${m.espn_event_id}&lang=en&region=in`);
    const parsed = parseSummary(payload);
    let withRoster = enrichWithSummary(m, parsed);
    const hf = teamForm(m.home, tape);
    const af = teamForm(m.away, tape);
    const h2hRec = h2h(m.home, m.away, tape);
    withRoster = {
      ...withRoster,
      homeTeamObj: { ...withRoster.homeTeamObj, form: hf, odds: null },
      awayTeamObj: { ...withRoster.awayTeamObj, form: af, odds: null },
      h2h: h2hRec,
      pitch: null, // pitch report never sourced — see CRICKET_IRREGULARITIES
    };
    return withRoster;
  });

  report('Done', 100);

  const quality = {
    collected_at_utc: new Date().toISOString(),
    tape_days: TAPE_DAYS,
    tape_matches: tape.length,
    day_matches: enriched.length,
    roster_confirmed: enriched.filter((m) => m.rosterConfirmed).length,
    unavailable_factors: [
      { factor: 'odds / prices (match, MoTM, top batsman)', reason: 'ESPN ships odds:[] for cricket; no key-less cross-origin odds source verified', ref: 'CR-IR-01' },
      { factor: 'pitch report & weather forecast', reason: 'no free structured source; never guessed', ref: 'CR-IR-02' },
      { factor: 'last-5 player batting/bowling aggregates', reason: 'per-match summaries give single-match figures; a player season tape is not exposed key-less', ref: 'CR-IR-03' },
      { factor: 'injuries, social/analyst sentiment', reason: 'no free structured source', ref: 'CR-IR-04' },
    ],
  };

  return { date: dateISO, matches: enriched, tape, quality };
}
