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
 * VERIFIED ENDPOINTS (see docs/CRICKET_SOURCES.md):
 *   - Scorepanel (per-date fixtures, scores, winners, venue, format):
 *     https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel?dates=YYYYMMDD
 *   - Match summary (confirmed rosters, batting positions, runs, SR, wickets,
 *     economy, venue, toss, format):
 *     https://site.web.api.espn.com/apis/site/v2/sports/cricket/{leagueId}/summary?event={eventId}
 *   - Active series discovery (nav state):
 *     https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket
 *
 * WHAT IS NEVER COLLECTED, AND WHY
 *   - Odds / prices. ESPN ships odds:[] for cricket and no key-less,
 *     cross-origin odds source was verified. Every odds-dependent factor
 *     stays unsourced (recorded in missing[]).
 *   - Pitch reports and weather. No free structured source; never guessed.
 *   - Injuries / social sentiment. No free structured source.
 *
 * Results are cached in localStorage so a reload does not re-hammer ESPN.
 */

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

export function classifyFormat(eventType, description) {
  const t = (eventType || '').toUpperCase();
  const d = (description || '').toLowerCase();
  if (t === 'T20' || d.includes('twenty20') || d.includes('t20')) return 'T20';
  if (t === 'ODI' || d.includes('odi') || d.includes('one-day') || d.includes('list a')) return 'ODI';
  if (t === 'TEST' || d.includes('test') || d.includes('first-class') || d.includes('4-day') || d.includes('4 day')) return 'TEST';
  return 'OTHER';
}

function phaseFromState(state, dateISO) {
  if (state === 'in') return 'live';
  if (state === 'post') return 'results';
  // Scheduled/pre.
  const today = new Date().toISOString().slice(0, 10);
  return dateISO < today ? 'results' : 'upcoming';
}

/** Parse one scorepanel event into a normalised match row. */
export function parsePanelEvent(ev, leagueId) {
  const comp = ev?.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1];

  const dateISO = (ev.date || comp.date || '').slice(0, 10);
  const state = comp?.status?.type?.state || ev?.status?.type?.state || 'pre';

  const team = (c) => c?.team ? {
    id: c.team.id,
    name: c.team.displayName || c.team.name,
    abbreviation: c.team.abbreviation,
    logo: c.team.logos?.[0]?.href || c.team.logo || null,
    score: c.score || '',
    winner: c.winner === true,
    homeAway: c.homeAway,
  } : null;

  const leagueName = ev?.leagues?.[0]?.name || comp?.leagues?.[0]?.name || '';
  const cls = comp?.class || ev?.class || {};

  return {
    competition_id: `cr-${ev.id}`,
    espn_event_id: String(ev.id),
    espn_league_id: String(leagueId ?? ev?.leagues?.[0]?.id ?? ''),
    sport: 'Cricket',
    league: leagueName,
    series: leagueName,
    phase: phaseFromState(state, dateISO),
    date: dateISO,
    start_utc: ev.date || comp.date || null,
    description: ev.description || comp.description || '',
    round: comp.description || '',
    format: classifyFormat(cls.eventType, ev.description || comp.description),
    eventType: cls.eventType || cls.generalClassCard || '',
    venue: comp?.venue?.fullName || ev?.venue?.fullName || null,
    venue_city: comp?.venue?.address?.city || null,
    venue_country: comp?.venue?.address?.country || null,
    neutral: comp.neutralSite === true,
    home: team(home)?.name || home?.team?.name || 'Home',
    away: team(away)?.name || away?.team?.name || 'Away',
    homeTeamObj: team(home) ? { ...team(home) } : null,
    awayTeamObj: team(away) ? { ...team(away) } : null,
    status_text: comp?.status?.summary || '',
    source_url: ev?.links?.find((l) => (l.rel || []).includes('summary'))?.href
      || `https://www.espncricinfo.com/series/${leagueId}/match/${ev.id}`,
    cricinfo_url: ev?.links?.find((l) => (l.rel || []).includes('summary'))?.href || null,
  };
}

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
 * Parse a match summary into confirmed rosters with batting position, role,
 * and (for finished/live matches) runs, strike rate, wickets, economy.
 * Returns { playersByTeam: {teamId: [player...] } } or null.
 */
export function parseSummary(payload) {
  if (!payload?.rosters) return null;
  const playersByTeam = {};
  for (const roster of payload.rosters) {
    const teamId = roster?.team?.id != null ? String(roster.team.id) : roster.homeAway;
    const list = [];
    for (const entry of roster.roster || []) {
      const a = entry.athlete || {};
      // Batting stats live in linescores -> batting statistics categories.
      let battingPosition = null, runs = null, strikeRate = null, ballsFaced = null, fours = null, sixes = null, fiftyPlus = null;
      let wickets = null, economy = null, ballsBowled = null;
      for (const ls of entry.linescores || []) {
        for (const sub of ls.linescores || []) {
          const stats = sub?.statistics?.categories || [];
          for (const cat of stats) {
            for (const s of cat.stats || []) {
              const v = Number(s.value);
              if (!isFinite(v)) continue;
              if (s.name === 'battingPosition') battingPosition = v;
              if (s.name === 'runs' && cat.name === 'general' && ls.period != null) runs = Math.max(runs || 0, v);
              if (s.name === 'strikeRate') strikeRate = v;
              if (s.name === 'ballsFaced') ballsFaced = Math.max(ballsFaced || 0, v);
              if (s.name === 'fours') fours = Math.max(fours || 0, v);
              if (s.name === 'sixes') sixes = Math.max(sixes || 0, v);
              if (s.name === 'fiftyPlus') fiftyPlus = Math.max(fiftyPlus || 0, v);
              if (s.name === 'dismissals' || s.name === 'wickets') wickets = Math.max(wickets || 0, v);
              if (s.name === 'economyRate' && v > 0) economy = v;
              if (s.name === 'balls') ballsBowled = Math.max(ballsBowled || 0, v);
            }
          }
        }
      }
      const styles = (a.style || []);
      const battingStyle = styles.find((x) => x.type === 'batting')?.shortDescription || null;
      const bowlingStyle = styles.find((x) => x.type === 'bowling')?.shortDescription || null;
      const role = entry?.position?.name || a?.position?.name || '';
      list.push({
        id: String(a.id || a.guid || Math.random().toString(36).slice(2)),
        name: a.displayName || a.battingName || a.fullName || 'Unknown',
        battingName: a.battingName || null,
        battingPosition,
        battingStyle: battingStyle ? (battingStyle.includes('Lhb') ? 'left' : 'right') : null,
        bowlingStyle, // e.g. 'Lb' (legbreak), 'Rfm' etc — mapped to spin/pace upstream
        role: role.toLowerCase().includes('all') ? 'allrounder'
          : role.toLowerCase().includes('bowl') || (bowlingStyle && !battingPosition) ? 'bowler'
          : role.toLowerCase().includes('bat') || battingPosition ? 'batsman' : 'unknown',
        starter: entry.starter !== false,
        // this-match numbers (single match, not last-5):
        matchStats: { runs, strikeRate, ballsFaced, fours, sixes, fiftyPlus, wickets, economy, ballsBowled },
        cricinfo_url: a?.links?.find((l) => (l.rel || []).includes('playercard'))?.href || null,
      });
    }
    playersByTeam[teamId] = list;
  }
  const venue = payload?.gameInfo?.venue?.fullName || null;
  return { playersByTeam, venue };
}

function bowlingSpinPace(short) {
  if (!short) return null;
  const s = short.toLowerCase();
  // Spin: legbreak (lb), offbreak (ob), slow left-arm (sla), orthodox, wrist-spin.
  if (s.includes('lb') || s.includes('ob') || s.includes('sla') || s.includes('slow') || s.includes('spin') || s.includes('orth')) return 'spin';
  // Pace: anything with fm/f (fast/medium) or seam.
  if (s.includes('fm') || s.includes('f') || s.includes('m') || s.includes('seam') || s.includes('fast')) return 'pace';
  return null;
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

    // Confirmed starters only (roster entry starter !== false), batting positions known.
    const confirmed = players.filter((p) => p.starter && (p.battingPosition != null || p.bowlingStyle));

    return {
      ...teamObj,
      players: confirmed,
      confirmedXi: confirmed.length >= 11,
      battingOrder: batsmen.map((p) => ({ name: p.name, position: p.battingPosition })),
      bowling: {
        style: primaryStyle,
        spinBowlers,
        paceBowlers,
      },
      momCandidates: confirmed.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        battingPosition: p.battingPosition,
        bowlingStyle: bowlingSpinPace(p.bowlingStyle),
        opensBowling: p.role === 'bowler' || p.role === 'allrounder',
        battingStyle: p.matchStats?.strikeRate != null && p.matchStats.strikeRate >= 140 ? 'aggressive' : null,
        odds: null, // never sourced
        recent: null, // last-5 form not available from single summary
        strikeRateVsTeamAvg: null,
        // carry this-match numbers for the scoreboard display
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
        powerplayRecord: p.battingPosition <= 2 ? null : null, // not sourced
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

/**
 * Build a results tape over the last N days — used for team form and H2H.
 * Only uses confirmed winners from the scorepanel (finished matches).
 */
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

/** Derive head-to-head between two teams from the tape (and any longer window). */
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

/**
 * Full collection for one card date.
 * @returns {object} { date, matches, tape, quality }
 */
export async function collectCard(dateISO, onProgress) {
  const report = (msg, pct) => onProgress && onProgress(msg, pct);

  report('Loading the day’s matches…', 15);
  const day = await collectDate(dateISO);

  report('Building recent-form history…', 30);
  const tape = await collectTape(dateISO, TAPE_DAYS, (d, t) =>
    report(`Building recent-form history… day ${d} of ${t}`, 30 + Math.round((d / t) * 40)));

  report('Confirming playing XIs and match stats…', 75);
  // Enrich the day's matches with confirmed rosters (summary endpoint).
  const enriched = await pool(day.rows, 4, async (m) => {
    if (!m.espn_event_id || !m.espn_league_id) return m;
    const payload = await getJSON(`${SUMMARY}/${m.espn_league_id}/summary?event=${m.espn_event_id}&lang=en&region=in`);
    const parsed = parseSummary(payload);
    let withRoster = enrichWithSummary(m, parsed);
    // Attach derived form / H2H from tape.
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
