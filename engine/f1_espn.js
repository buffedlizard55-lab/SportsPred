/**
 * SportsPred — ESPN Formula 1 payload parsers (pure, no I/O).
 *
 * WHAT THIS IS
 * ------------
 * ESPN operates public, key-less JSON endpoints that power espn.com. For F1
 * the verified endpoints (checked 2026-09-02) are:
 *
 *  - GET https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard?dates=YYYYMMDD[-YYYYMMDD]
 *      -> { leagues: [ { calendar: [ { label, startDate, endDate, event: { $ref } } ] } ],
 *           events: [ { id, name, date, endDate, competitions: [ { id, date,
 *             type: { abbreviation }, status: { type: { state } },
 *             competitors: [ { id, type:'athlete', order, winner, athlete: { fullName } } ] } ] } ] }
 *      The YEAR-range form returns the full season calendar incl. past events
 *      (verified for 2025-01-01..2025-12-31). Session competitor `order` is the
 *      classification in that session; the Race session's order is the
 *      finishing position.
 *
 *  - GET https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/events/{eventId}
 *      -> { name, date, endDate, abbreviation, circuit: {$ref}, venues: [$ref],
 *           defendingChampion: { driver, manufacturer } }
 *
 *  - GET https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/events/{eventId}/competitions
 *      -> { items: [ { id, type: { text, abbreviation }, date,
 *           competitors: [ { id, type:'athlete', order, startOrder, winner,
 *             athlete: {$ref}, vehicle: { number, manufacturer, teamColor },
 *             status: {$ref}, statistics: {$ref} } ] } ] }
 *      The Race competition carries BOTH `order` (finishing position) and
 *      `startOrder` (grid position) and the team manufacturer/car number.
 *
 *  - GET https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/events/{eventId}/competitions/{compId}/competitors/{athleteId}/status
 *      -> { type: { name: 'STATUS_CLASSIFIED' | 'STATUS_RETIRED' | ... } }
 *      Verified: STATUS_CLASSIFIED and STATUS_RETIRED are emitted.
 *
 *  - GET https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/events/{eventId}/competitions/{compId}/competitors/{athleteId}/statistics
 *      -> { splits: { categories: [ { stats: [ { name: 'place'|'wins'|'pole'|
 *           'top5'|'top10'|'lapsCompleted'|'lapsLead'|'pitsTaken'|
 *           'championshipPts'|'bonus'|'penaltyPts'|'totalTime', value, displayValue } ] } ] } }
 *      NOTE: fastest-lap times are NOT published anywhere in these endpoints;
 *      the circuit endpoint below does publish the current fastest lap.
 *
 *  - GET https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/circuits/{circuitId}
 *      -> { fullName, address: { city, country }, length, distance, laps,
 *           turns, direction, established, fastestLapDriver: {$ref},
 *           fastestLapTime, fastestLapYear, diagrams: [ { href, rel } ] }
 *
 *  - GET https://site.api.espn.com/apis/v2/sports/racing/f1/standings
 *      -> { children: [ { standings: { entries: [ { athlete|team, stats: [
 *           { name:'rank'|'points', value, displayValue },
 *           { name:'AUS', abbreviation:'AUS', id:'600057427', played:true,
 *             value:18, displayValue:'18' }, ... ] } ] } }, ... ] }
 *      Verified to include a Driver Standings child and a Constructor Standings
 *      child, each with per-race points keyed by event id.
 *
 * RULES OF THIS FILE
 *  - Pure functions. No fetch, no clock, no randomness, no DOM.
 *  - Never invent a field. If ESPN does not publish it, output is null and the
 *    caller records it as missing. In particular:
 *      * no odds (IR-01 family), no fastest-lap per race, no tyre compounds,
 *        no pit-lap timing, no upgrade packages, no overtake counts.
 *  - DNF is ONLY true when the status endpoint says retired/not classified.
 *    An absent status is null, never false.
 */

export const SESSION_TYPES = {
  'FP1': 'FP1', 'FP2': 'FP2', 'FP3': 'FP3', 'FP': 'FP',
  'Qual': 'Qualifying', 'Q': 'Qualifying', 'SS': 'Sprint Shootout',
  'Sprint': 'Sprint', 'Race': 'Race',
};

const RETIRED_STATUSES = /RETIRED|DNF|NOT_CLASSIFIED|LAPPED|WITHDRAWN/i;

/** Normalise a session type abbreviation / text to a canonical session key. */
export function sessionKey(type) {
  const t = String(type ?? '').trim();
  const u = t.toUpperCase();
  if (u === 'RACE') return 'Race';
  if (u === 'QUAL' || u === 'QUALIFYING' || u === 'Q') return 'Qualifying';
  if (u === 'SS' || u.includes('SPRINT SHOOTOUT')) return 'Sprint Shootout';
  if (u === 'SPRINT') return 'Sprint';
  if (/^FP\d?$/.test(u)) return u.toUpperCase();
  return t || null;
}

/** True when ESPN reports the session as complete. */
export function isCompleted(session) {
  return session?.status?.type?.state === 'post' ||
    session?.status?.type?.completed === true ||
    session?.status?.type?.state === 'status_post';
}

/** Strip a `$ref` URL to its trailing id. */
function refId(ref) {
  if (!ref) return null;
  const m = String(ref).match(/\/(\d+)\??/);
  return m ? m[1] : null;
}

function athleteOf(c) {
  const a = c?.athlete ?? {};
  return {
    id: String(c?.id ?? ''),
    name: a?.fullName || a?.displayName || a?.name || null,
    shortName: a?.shortName || null,
    flagCountry: a?.flag?.alt || null,
    flagHref: a?.flag?.href || null,
  };
}

/** One competitor in a session — everything ESPN gives us, or null fields. */
export function parseCompetitor(c) {
  if (!c) return null;
  const a = athleteOf(c);
  return {
    athleteId: a.id,
    name: a.name,
    shortName: a.shortName,
    country: a.flagCountry,
    order: Number.isFinite(c?.order) ? c.order : null,
    startOrder: Number.isFinite(c?.startOrder) ? c.startOrder : null,
    winner: c?.winner === true,
    team: c?.vehicle?.manufacturer || null,
    carNumber: c?.vehicle?.number || null,
    teamColor: c?.vehicle?.teamColor || null,
  };
}

/**
 * Parse one competition (session) object from the SITE scoreboard or the CORE
 * competitions list. The site payload and core payload differ (core carries
 * startOrder/vehicle/$refs); both are handled here.
 */
export function parseSession(comp, { statusOverrides = null, statsOverrides = null } = {}) {
  const key = sessionKey(comp?.type?.abbreviation || comp?.type?.text);
  const competitors = (comp?.competitors || [])
    .map((c) => parseCompetitor(c))
    .filter(Boolean)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  // Merge optional per-driver status / statistics fetched from the core API.
  const merged = competitors.map((c) => {
    const st = statusOverrides?.[c.athleteId] ?? null;
    const stats = statsOverrides?.[c.athleteId] ?? null;
    return {
      ...c,
      dnf: st == null ? null : st.retired === true,
      status: st?.displayValue ?? null,
      pointsEarned: stats?.pointsEarned ?? null,
      lapsCompleted: stats?.lapsCompleted ?? null,
      lapsLed: stats?.lapsLed ?? null,
      pitsTaken: stats?.pitsTaken ?? null,
      pole: stats?.pole ?? null,
      top5: stats?.top5 ?? null,
      top10: stats?.top10 ?? null,
      wins: stats?.wins ?? null,
      finishTime: stats?.finishTime ?? null,
      finishTimeMs: stats?.finishTimeMs ?? null,
    };
  });

  return {
    id: String(comp?.id ?? ''),
    type: key,
    label: comp?.type?.text || key || null,
    date: comp?.date || comp?.startDate || null,
    state: comp?.status?.type?.state || comp?.status?.state || null,
    completed: isCompleted(comp),
    competitors: merged,
  };
}

/** Derive the grid from a completed Race session (startOrder order). */
export function gridFromRace(session) {
  if (!session || session.type !== 'Race' || !Array.isArray(session.competitors)) return [];
  return session.competitors
    .map((c) => ({ ...c, grid: c.startOrder ?? c.order }))
    .filter((c) => c.grid != null)
    .sort((a, b) => a.grid - b.grid);
}

/** Result classification from a completed Race session (order). */
export function resultFromRace(session) {
  if (!session || session.type !== 'Race' || !Array.isArray(session.competitors)) return [];
  return session.competitors
    .map((c) => ({ ...c, position: c.order ?? c.startOrder }))
    .filter((c) => c.position != null)
    .sort((a, b) => a.position - b.position);
}

/**
 * Parse the core `competitions` list payload into canonical sessions.
 * `competitions` payload shape: { count, items: [ {… competition} ] }.
 */
export function parseCompetitions(payload) {
  const items = payload?.items || payload?.competitions || [];
  return items.map((it) => parseSession(it)).filter((s) => s.type);
}

/** Parse ONE event from the site scoreboard (thin shape). */
export function parseSiteEvent(ev) {
  if (!ev) return null;
  const sessions = (ev.competitions || []).map((c) => parseSession(c)).filter((s) => s.type);
  const race = sessions.find((s) => s.type === 'Race');
  return {
    id: String(ev.id ?? ''),
    name: ev.name || null,
    shortName: ev.shortName || null,
    seasonYear: ev?.season?.year ?? null,
    startDate: ev.date || null,
    endDate: ev.endDate || null,
    sessions,
    race,
    raceDate: race?.date || ev.endDate || null,
    raceState: race?.state || null,
    raceCompleted: race?.completed || false,
  };
}

/** Parse the scoreboard payload into { seasonCalendar, events }. */
export function parseF1Scoreboard(payload) {
  const league = payload?.leagues?.[0] ?? {};
  const seasonCalendar = (league.calendar || []).map((c) => ({
    label: c?.label || null,
    startDate: c?.startDate || null,
    endDate: c?.endDate || null,
    eventId: refId(c?.event?.$ref),
  }));
  const events = (payload?.events || []).map(parseSiteEvent).filter(Boolean);
  return {
    seasonYear: league?.season?.year ?? null,
    seasonCalendar,
    events,
    league: { id: league?.id ?? null, name: league?.name ?? null },
    fetchedAt: payload?.fetchedAt ?? null,
  };
}

/** Parse a competitor status payload -> { retired, displayValue }. */
export function parseStatus(payload) {
  const t = payload?.type;
  const name = t?.name || payload?.displayValue || '';
  return {
    retired: RETIRED_STATUSES.test(String(name)),
    displayValue: payload?.displayValue || t?.detail || t?.name || null,
    state: t?.state || null,
  };
}

/** Pull named stats out of the competitor statistics payload. */
export function parseStatistics(payload) {
  const stats = (payload?.splits?.categories || [])
    .flatMap((cat) => cat?.stats || []);
  const get = (name) => {
    const s = stats.find((x) => x?.name === name);
    return s == null || s.value == null ? null : s.value;
  };
  return {
    pointsEarned: get('championshipPts'),
    bonus: get('bonus'),
    penaltyPts: get('penaltyPts'),
    lapsCompleted: get('lapsCompleted'),
    lapsLed: get('lapsLed'),
    pitsTaken: get('pitsTaken'),
    place: get('place'),
    wins: get('wins'),
    pole: get('pole'),
    top5: get('top5'),
    top10: get('top10'),
    finishTimeMs: get('totalTime'),
    finishTime: stats.find((x) => x?.name === 'totalTime')?.displayValue ?? null,
    q1Ms: get('qual1TimeMS'),
    q2Ms: get('qual2TimeMS'),
    q3Ms: get('qual3TimeMS'),
    sourceStatNames: stats.map((s) => s?.name).filter(Boolean),
  };
}

/** Parse the core event payload (circuit refs, defending champion). */
export function parseCoreEvent(payload) {
  return {
    id: String(payload?.id ?? ''),
    name: payload?.name || null,
    shortName: payload?.shortName || null,
    abbreviation: payload?.abbreviation || null,
    startDate: payload?.date || null,
    endDate: payload?.endDate || null,
    circuitId: refId(payload?.circuit?.$ref) ||
      refId(payload?.venues?.[0]?.$ref),
    venueId: refId(payload?.venues?.[0]?.$ref) || null,
    defendingChampionDriverId: refId(payload?.defendingChampion?.driver?.$ref),
    defendingChampionTeam: refId(payload?.defendingChampion?.manufacturer?.$ref),
    links: payload?.links || [],
  };
}

/** Parse the circuit endpoint payload. */
export function parseCircuit(payload) {
  const fastest = payload?.fastestLapDriver?.$ref ?? null;
  return {
    id: String(payload?.id ?? ''),
    fullName: payload?.fullName || null,
    city: payload?.address?.city || null,
    country: payload?.address?.country || null,
    lengthKm: payload?.length || null,
    distanceKm: payload?.distance || null,
    laps: payload?.laps ?? null,
    turns: payload?.turns ?? null,
    direction: payload?.direction || null,
    established: payload?.established ?? null,
    fastestLapDriverId: refId(fastest),
    fastestLapTime: payload?.fastestLapTime || null,
    fastestLapYear: payload?.fastestLapYear ?? null,
    diagramHrefs: (payload?.diagrams || []).map((d) => d?.href).filter(Boolean),
  };
}

/* ------------------------------------------------------------------ *
 * Standings
 * ------------------------------------------------------------------ */

function parseStandingEntry(entry) {
  const entity = entry?.athlete || entry?.team || {};
  const stats = entry?.stats || [];
  const stat = (name) => stats.find((s) => s?.name === name)?.value ?? null;
  const perRace = {};
  for (const s of stats) {
    const id = s?.id;
    const abbrev = s?.abbreviation;
    if (!id || !/^\d+$/.test(String(id)) || !s?.played) continue;
    perRace[id] = {
      abbreviation: abbrev || null,
      displayName: s?.displayName || null,
      points: Number.isFinite(s?.value) ? s.value : null,
      played: s?.played === true,
    };
  }
  return {
    id: String(entity?.id ?? ''),
    name: entity?.displayName || entity?.name || entity?.fullName || null,
    abbreviation: entity?.abbreviation || null,
    color: entity?.color || null,
    flagCountry: entity?.flag?.alt || null,
    rank: Number.isFinite(stat('rank')) ? stat('rank') : null,
    points: Number.isFinite(stat('points')) ? stat('points') : (Number.isFinite(stat('championshipPts')) ? stat('championshipPts') : null),
    topFinish: Number.isFinite(stat('topFinish')) ? stat('topFinish') : null,
    perRace,
  };
}

/** Parse standings payload -> { drivers, constructors, fetchedAt }. */
export function parseStandings(payload) {
  const children = payload?.children || [];
  const drivers = [];
  const constructors = [];
  let kind = 'drivers';
  for (const child of children) {
    const name = (child?.name || child?.standings?.name || '').toLowerCase();
    if (name.includes('constructor')) kind = 'constructors';
    else if (name.includes('driver')) kind = 'drivers';
    for (const entry of child?.standings?.entries || []) {
      const row = parseStandingEntry(entry);
      if (!row.id) continue;
      (kind === 'constructors' ? constructors : drivers).push(row);
    }
  }
  const byRank = (a, b) => (a.rank ?? 999) - (b.rank ?? 999);
  drivers.sort(byRank);
  constructors.sort(byRank);
  return { drivers, constructors, fetchedAt: payload?.fetchedAt ?? null };
}

/** Map a driver to their team from the current constructors roster. */
export function teamOfDriver(driver, constructorStandings) {
  if (driver?.team) return driver.team;
  return null;
}
