/**
 * SportsPred — Golf source parsers (pure, no I/O).
 *
 * Every function takes a JSON payload exactly as the public endpoint returns it
 * and yields plain data. Nothing is inferred: a field the source does not send
 * stays null and becomes a `missing[]` entry downstream.
 *
 * VERIFIED FIELD MAP (read live through a hosted fetch on 2026-09-02)
 *
 * 1. Leaderboard (one event, full field, all rounds)
 *    https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league={pga|eur|lpga|champions-tour}&event={eventId}
 *      events[0].id / name / date / endDate / season.year
 *      events[0].league.slug ("pga" | "eur")           -> tour
 *      events[0].tournament.id                         -> stable id across seasons (3383 = European Masters)
 *      events[0].tournament.major / numberOfRounds / cutRound / cutScore / cutCount
 *      events[0].status.type.state ("pre"|"in"|"post"), completed
 *      events[0].winner {id, displayName}              -> only on completed events
 *      events[0].courses[0] {id, name, totalYards, shotsToPar, address{city,state,country}}
 *      competitions[0].status.period                   -> current round
 *      competitions[0].competitors[] :
 *        athlete {id, displayName, flag{alt}, birthPlace{countryAbbreviation}, amateur}
 *        status.type.shortDetail  "F" | "CUT" | "WD" | "DQ" | "Scheduled"
 *        status.position {id, displayName "T14", isTie}
 *        status.teeTime / startHole / thru               -> upcoming + live
 *        score {value (strokes), displayValue ("-9" | "E" | "-")}
 *        linescores[] {period, value (strokes), displayValue, teeTime, startPosition, currentPosition}
 *        earnings, movement
 *      competitions[0].leaders[] {name, displayName, leaders[{value, athlete}]}   (stat leaders only)
 *
 * 2. Scoreboard (season calendar + the event covering a date)
 *    https://site.api.espn.com/apis/site/v2/sports/golf/{league}/scoreboard?dates=YYYYMMDD
 *      leagues[0].season {year, startDate, endDate, displayName}
 *      leagues[0].calendar[] {id, label, startDate, endDate}
 *      events[] (same competitor shape as above but position is `order`)
 *
 * 3. Core event (signature-event flag only)
 *    https://sports.core.api.espn.com/v2/sports/golf/leagues/{league}/events/{eventId}
 *      isSignature, purse, competitions[0].scoringSystem
 *
 * 4. Season statistics by athlete (PGA TOUR only; the DP World Tour call returns no rows)
 *    https://site.web.api.espn.com/apis/common/v3/sports/golf/pga/statistics/byathlete?season=YYYY&limit=50&page=N
 *      categories[0].names[]  -> column order
 *      athletes[].categories[0].values[] -> aligned values
 *
 * 5. Official World Golf Ranking (public JSON)
 *    https://apiweb.owgr.com/api/owgr/rankings/getRankings?pageSize=1000&pageNumber=1&countryId=0&sortString=Rank+ASC
 *      rankingsList[] {rank, player{id, fullName, country{name, code3, region{name}}}, pointsAverage, lastWeekRank, endLastYearRank}
 */

export const GOLF_TOURS = Object.freeze({
  pga: { slug: 'pga', name: 'PGA TOUR', espnLeagueId: '1106', predictable: true },
  eur: { slug: 'eur', name: 'DP World Tour', espnLeagueId: '7002', predictable: true },
  lpga: { slug: 'lpga', name: 'LPGA Tour', espnLeagueId: '1107', predictable: false },
  'champions-tour': { slug: 'champions-tour', name: 'PGA TOUR Champions', espnLeagueId: '1105', predictable: false },
});

export function leaderboardUrl(tour, eventId) {
  return `https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=${encodeURIComponent(tour)}&event=${encodeURIComponent(eventId)}`;
}

export function scoreboardUrl(tour, yyyymmdd) {
  return `https://site.api.espn.com/apis/site/v2/sports/golf/${encodeURIComponent(tour)}/scoreboard?dates=${yyyymmdd}`;
}

export function coreEventUrl(tour, eventId) {
  return `https://sports.core.api.espn.com/v2/sports/golf/leagues/${encodeURIComponent(tour)}/events/${encodeURIComponent(eventId)}`;
}

export function espnLeaderboardPage(eventId) {
  return `https://www.espn.com/golf/leaderboard?tournamentId=${eventId}`;
}

export function espnPlayerPage(athleteId) {
  return `https://www.espn.com/golf/player/_/id/${athleteId}`;
}

/** "-9" -> -9, "E" -> 0, "+4" -> 4, "-" -> null */
export function parseToPar(display) {
  if (display === null || display === undefined) return null;
  const s = String(display).trim();
  if (!s || s === '-' || s === '--') return null;
  if (s.toUpperCase() === 'E') return 0;
  const n = Number(s.replace('+', ''));
  return Number.isFinite(n) ? n : null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const RESULT_CODES = new Set(['F', 'CUT', 'WD', 'DQ', 'MDF']);

/**
 * Normalise a competitor's status into one code:
 *   'F'  finished all rounds     'CUT' missed cut     'WD' withdrew
 *   'DQ' disqualified            'MDF' made cut, did not finish
 *   'active' in play             'scheduled' not started
 */
export function resultCode(competitor) {
  const st = competitor?.status || {};
  const state = st.type?.state ?? null;
  const short = String(st.type?.shortDetail ?? st.displayValue ?? '').trim().toUpperCase();
  if (state === 'pre' || st.type?.name === 'STATUS_SCHEDULED') return 'scheduled';
  if (state === 'in') return 'active';
  if (RESULT_CODES.has(short)) return short;
  if (st.type?.name === 'STATUS_FINISH' || st.type?.completed === true) return 'F';
  if (st.type?.name === 'STATUS_CUT') return 'CUT';
  if (state === 'post') return 'F';
  return 'scheduled';
}

export function parseLinescore(l) {
  if (!l || typeof l !== 'object') return null;
  const strokes = num(l.value);
  return {
    period: num(l.period),
    strokes: strokes && strokes > 0 ? strokes : null,
    toPar: parseToPar(l.displayValue),
    teeTime: l.teeTime ?? null,
    startPosition: num(l.startPosition),
    currentPosition: num(l.currentPosition),
  };
}

/** One row of the leaderboard endpoint. */
export function parseLeaderboardCompetitor(c) {
  if (!c) return null;
  const a = c.athlete || {};
  const code = resultCode(c);
  const posId = num(c.status?.position?.id);
  const posText = c.status?.position?.displayName ?? null;
  const finished = code === 'F' || code === 'MDF' || code === 'active';
  const rounds = (Array.isArray(c.linescores) ? c.linescores : []).map(parseLinescore).filter(Boolean);
  // score.displayValue reads "E" for a withdrawal; the statistics block carries the true to-par.
  const statToPar = (Array.isArray(c.statistics) ? c.statistics : []).find((s) => s?.name === 'scoreToPar');
  const toPar = statToPar && Number.isFinite(Number(statToPar.value)) && statToPar.displayValue !== '-'
    ? Number(statToPar.value) : parseToPar(c.score?.displayValue);
  return {
    athleteId: String(a.id ?? c.id ?? ''),
    name: a.displayName ?? a.fullName ?? null,
    shortName: a.shortName ?? null,
    country: a.flag?.alt ?? null,
    countryCode: a.birthPlace?.countryAbbreviation ?? null,
    flag: a.flag?.href ?? null,
    headshot: a.headshot?.href ?? null,
    amateur: a.amateur === true || c.amateur === true,
    result: code,
    position: finished && posText && posText !== '-' && posId ? posId : null,
    positionText: posText && posText !== '-' ? posText : null,
    tie: c.status?.position?.isTie === true,
    toPar,
    strokes: num(c.score?.value) || null,
    thru: num(c.status?.thru),
    teeTime: c.status?.teeTime ?? rounds.find((r) => r.teeTime)?.teeTime ?? null,
    startHole: num(c.status?.startHole),
    rounds,
    earnings: num(c.earnings),
    movement: num(c.movement),
    playerUrl: (a.links || []).find((l) => (l.rel || []).includes('playercard'))?.href
      ?? (a.id ? espnPlayerPage(a.id) : null),
  };
}

export function parseCourse(course) {
  if (!course) return null;
  return {
    id: course.id != null ? String(course.id) : null,
    name: course.name ?? null,
    city: course.address?.city ?? null,
    state: course.address?.state ?? null,
    country: course.address?.country ?? null,
    yards: num(course.totalYards),
    par: num(course.shotsToPar),
    holes: Array.isArray(course.holes) ? course.holes.length : null,
    host: course.host === true,
  };
}

/**
 * Parse the leaderboard endpoint payload. Returns null when the payload has
 * no event (ESPN answers {events: []} for unknown ids).
 */
export function parseLeaderboard(payload, { tour = null } = {}) {
  const ev = Array.isArray(payload?.events) ? payload.events[0] : null;
  if (!ev) return null;
  const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
  const courses = (Array.isArray(ev.courses) ? ev.courses : []).map(parseCourse).filter(Boolean);
  const course = courses.find((c) => c.host) || courses[0] || null;
  const field = (comp?.competitors || []).map(parseLeaderboardCompetitor).filter((p) => p && p.athleteId);
  const leaders = (comp?.leaders || []).map((l) => ({
    stat: l.name ?? null,
    label: l.displayName ?? null,
    leader: l.leaders?.[0]?.athlete?.displayName ?? null,
    athleteId: l.leaders?.[0]?.athlete?.id != null ? String(l.leaders[0].athlete.id) : null,
    value: num(l.leaders?.[0]?.value),
  }));
  const state = ev.status?.type?.state ?? comp?.status?.type?.state ?? null;
  return {
    id: String(ev.id),
    tour: ev.league?.slug ?? tour,
    tourName: ev.league?.name ?? null,
    name: ev.name ?? null,
    shortName: ev.shortName ?? null,
    seasonYear: num(ev.season?.year),
    startDate: ev.date ?? null,
    endDate: ev.endDate ?? null,
    state,
    completed: ev.status?.type?.completed === true,
    statusDetail: comp?.status?.type?.detail ?? ev.status?.type?.description ?? null,
    currentRound: num(comp?.status?.period),
    tournamentId: ev.tournament?.id != null ? String(ev.tournament.id) : null,
    tournamentName: ev.tournament?.displayName ?? null,
    major: ev.tournament?.major === true,
    numberOfRounds: num(ev.tournament?.numberOfRounds),
    cut: {
      round: num(ev.tournament?.cutRound),
      score: num(ev.tournament?.cutScore),
      count: num(ev.tournament?.cutCount),
    },
    purse: num(ev.purse),
    hasPlayerStats: ev.hasPlayerStats === true,
    winner: ev.winner?.id != null ? { athleteId: String(ev.winner.id), name: ev.winner.displayName ?? null } : null,
    defendingChampion: ev.defendingChampion?.athlete?.id != null
      ? { athleteId: String(ev.defendingChampion.athlete.id), name: ev.defendingChampion.athlete.displayName ?? null }
      : null,
    course,
    field,
    fieldSize: field.length,
    leaders,
    sources: {
      espnLeaderboard: (ev.links || []).find((l) => (l.rel || []).includes('summary'))?.href ?? espnLeaderboardPage(ev.id),
      api: leaderboardUrl(ev.league?.slug ?? tour ?? 'pga', ev.id),
    },
  };
}

/** Parse the site scoreboard: season + calendar + the events covering that date. */
export function parseGolfScoreboard(payload, { tour = null } = {}) {
  const lg = Array.isArray(payload?.leagues) ? payload.leagues[0] : null;
  const calendar = (lg?.calendar || [])
    .filter((c) => c && typeof c === 'object' && c.id)
    .map((c) => ({
      id: String(c.id),
      label: c.label ?? null,
      startDate: c.startDate ?? null,
      endDate: c.endDate ?? null,
    }));
  const events = (payload?.events || []).map((ev) => {
    const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    return {
      id: String(ev.id),
      name: ev.name ?? null,
      shortName: ev.shortName ?? null,
      startDate: ev.date ?? null,
      endDate: ev.endDate ?? null,
      state: ev.status?.type?.state ?? comp?.status?.type?.state ?? null,
      completed: ev.status?.type?.completed === true,
      fieldSize: Array.isArray(comp?.competitors) ? comp.competitors.length : 0,
      link: (ev.links || []).find((l) => (l.rel || []).includes('summary'))?.href ?? espnLeaderboardPage(ev.id),
    };
  });
  return {
    tour: lg?.slug ?? tour,
    tourName: lg?.name ?? null,
    leagueId: lg?.id != null ? String(lg.id) : null,
    season: {
      year: num(lg?.season?.year),
      displayName: lg?.season?.displayName ?? null,
      startDate: lg?.season?.startDate ?? null,
      endDate: lg?.season?.endDate ?? null,
    },
    day: payload?.day?.date ?? null,
    calendar,
    events,
  };
}

/** Core event: only the flags the site scoreboard does not carry. */
export function parseCoreEvent(payload) {
  if (!payload || !payload.id) return null;
  return {
    id: String(payload.id),
    isSignature: payload.isSignature === true,
    isCupPlayoff: payload.isCupPlayoff === true,
    purse: num(payload.purse),
    scoringSystem: payload.competitions?.[0]?.scoringSystem?.name ?? null,
    hasPlayerStats: payload.hasPlayerStats === true,
  };
}

/** ESPN season statistics by athlete (one page). */
export function parseByAthleteStats(payload) {
  const names = payload?.categories?.[0]?.names || [];
  const rows = [];
  for (const row of payload?.athletes || []) {
    const a = row.athlete || {};
    const cat = (row.categories || [])[0] || {};
    const values = cat.values || [];
    const stats = {};
    names.forEach((n, i) => { stats[n] = num(values[i]); });
    rows.push({
      athleteId: String(a.id ?? ''),
      name: a.displayName ?? null,
      country: a.flag?.alt ?? null,
      stats,
      lastTournament: row.lastTournament?.name ?? null,
    });
  }
  return {
    rows,
    columns: names,
    season: num(payload?.requestedSeason?.year ?? payload?.currentSeason?.year),
    pages: num(payload?.pagination?.pages),
    page: num(payload?.pagination?.page),
    count: num(payload?.pagination?.count),
    lastUpdated: payload?.lastUpdated ?? null,
  };
}

/** OWGR getRankings payload. */
export function parseOwgr(payload) {
  const rows = [];
  for (const r of payload?.rankingsList || []) {
    const p = r.player || {};
    rows.push({
      rank: num(r.rank),
      owgrId: p.id != null ? String(p.id) : null,
      name: p.fullName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
      country: p.country?.name ?? null,
      countryCode: p.country?.code3 ?? null,
      region: p.country?.region?.name ?? null,
      pointsAverage: num(r.pointsAverage),
      pointsTotal: num(r.pointsTotal),
      lastWeekRank: num(r.lastWeekRank),
      endLastYearRank: num(r.endLastYearRank),
      amateur: p.isAmateur === true,
      profileUrl: p.id != null && p.fullName
        ? `https://www.owgr.com/playerprofile/${String(p.fullName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${p.id}`
        : null,
    });
  }
  return { rows, total: num(payload?.totalNumberOfRankings), pages: num(payload?.totalNumberOfPages) };
}

/**
 * PGA TOUR strokes-gained stat page (HTML). Best effort, conservative:
 * returns [] unless at least MIN_ROWS plausible rows are found. Two strategies:
 *   1. the Next.js __NEXT_DATA__ blob (objects carrying playerName + rank + stats)
 *   2. the rendered <table> rows (rank, movement, player, avg, total, rounds)
 */
export const PGATOUR_STAT_IDS = Object.freeze({
  sg_ott: '02567', sg_app: '02568', sg_arg: '02569', sg_putt: '02564', sg_t2g: '02674', sg_total: '02675',
});
const MIN_SG_ROWS = 50;

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function walk(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return;
  visit(node);
  if (Array.isArray(node)) { for (const x of node) walk(x, visit, depth + 1); return; }
  for (const k of Object.keys(node)) walk(node[k], visit, depth + 1);
}

export function parsePgaTourStatPage(html) {
  const text = String(html || '');
  const rows = [];

  const m = text.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const blob = JSON.parse(m[1]);
      walk(blob, (node) => {
        if (Array.isArray(node)) return;
        const name = node.playerName ?? node.displayName ?? null;
        const rank = num(node.rank ?? node.currentRank);
        if (!name || rank === null) return;
        let avg = null; let total = null; let rounds = null;
        if (Array.isArray(node.stats)) {
          for (const s of node.stats) {
            const label = String(s?.statName ?? s?.name ?? '').toLowerCase();
            const val = num(String(s?.statValue ?? s?.value ?? '').replace(/,/g, ''));
            if (val === null) continue;
            if (label.includes('avg') || label.includes('average')) avg = val;
            else if (label.includes('total')) total = val;
            else if (label.includes('round')) rounds = val;
          }
        }
        if (avg === null) return;
        rows.push({ rank, name: String(name).trim(), avg, total, rounds });
      });
    } catch { /* fall through to table parsing */ }
  }

  if (rows.length < MIN_SG_ROWS) {
    rows.length = 0;
    const trs = text.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(stripTags);
      if (cells.length < 4) continue;
      const rank = num(cells[0].replace(/^T/i, ''));
      if (rank === null) continue;
      // Find the first cell that reads like a name, then the next three numerics.
      let nameIdx = -1;
      for (let i = 1; i < cells.length; i += 1) {
        if (/[A-Za-z]{2,}/.test(cells[i]) && num(cells[i]) === null && !/^[-+]?\d/.test(cells[i])) { nameIdx = i; break; }
      }
      if (nameIdx < 0) continue;
      const nums = cells.slice(nameIdx + 1).map((c) => num(c.replace(/,/g, ''))).filter((v) => v !== null);
      if (nums.length < 1) continue;
      rows.push({ rank, name: cells[nameIdx], avg: nums[0], total: nums[1] ?? null, rounds: nums[2] ?? null });
    }
  }

  const plausible = rows.filter((r) => r.rank > 0 && Math.abs(r.avg) < 6 && r.name.length >= 3);
  if (plausible.length < MIN_SG_ROWS) return [];
  // De-duplicate on name, keeping the first (best) rank.
  const seen = new Set();
  return plausible.filter((r) => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Event document shape shared by the collector (data/golf_events.json) and the
 * browser (live leaderboard fetch). `core` is the optional parsed core event.
 */
export function leaderboardToEvent(lb, core = null, { fetchedAt = null } = {}) {
  return {
    id: lb.id,
    tour: lb.tour,
    tourName: lb.tourName,
    name: lb.name,
    shortName: lb.shortName,
    seasonYear: lb.seasonYear,
    startDate: lb.startDate,
    endDate: lb.endDate,
    state: lb.state,
    completed: lb.completed,
    statusDetail: lb.statusDetail,
    currentRound: lb.currentRound,
    tournamentId: lb.tournamentId,
    tournamentName: lb.tournamentName,
    major: lb.major,
    isSignature: core?.isSignature === true,
    numberOfRounds: lb.numberOfRounds,
    cut: lb.cut,
    purse: lb.purse ?? core?.purse ?? null,
    course: lb.course,
    winner: lb.winner,
    defendingChampion: lb.defendingChampion,
    fieldSize: lb.fieldSize,
    field: lb.field.map((p) => ({
      athleteId: p.athleteId, name: p.name, country: p.country, countryCode: p.countryCode, flag: p.flag, headshot: p.headshot,
      amateur: p.amateur, result: p.result, position: p.position, positionText: p.positionText, toPar: p.toPar, strokes: p.strokes,
      thru: p.thru, teeTime: p.teeTime, startHole: p.startHole, earnings: p.earnings, movement: p.movement,
      rounds: p.rounds.map((r) => ({ period: r.period, strokes: r.strokes, toPar: r.toPar, teeTime: r.teeTime })),
      playerUrl: p.playerUrl,
    })),
    leaders: lb.leaders,
    sources: { ...lb.sources, core: core ? coreEventUrl(lb.tour, lb.id) : null },
    fetched_at_utc: fetchedAt,
  };
}

/** Compact result row used by data/golf_results.json. */
export const RESULT_ROW = Object.freeze(['athleteId', 'position', 'result', 'toPar', 'r1', 'r2', 'r3', 'r4']);

export function toResultRow(p) {
  const r = (n) => p.rounds?.find((x) => x.period === n)?.strokes ?? null;
  return [p.athleteId, p.position ?? null, p.result, p.toPar ?? null, r(1), r(2), r(3), r(4)];
}

export function fromResultRow(row) {
  if (!Array.isArray(row)) return null;
  const [athleteId, position, result, toPar, r1, r2, r3, r4] = row;
  return { athleteId: String(athleteId), position: position ?? null, result: result ?? null, toPar: toPar ?? null, rounds: [r1 ?? null, r2 ?? null, r3 ?? null, r4 ?? null] };
}
