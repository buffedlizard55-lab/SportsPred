/**
 * SportsPred — NRL data layer (pure functions, no I/O).
 *
 * Turns the committed NRL documents (tape, teams, OLBG slate, weather, Origin
 * calendar) into the per-match feature block that engine/nrl_engine.js scores.
 *
 * RULES OF THIS MODULE
 *  - Pure. No network, no clock, no randomness, no DOM.
 *  - Every value it returns is either read from a committed document or derived
 *    arithmetically from one. It cannot invent a value: if a document does not
 *    carry something, the field is null and the engine records it as missing.
 *  - The same module runs in the browser and under `node --test`.
 */

export const NRL_SEASON = 2026;
export const NRL_LEAGUE = 'NRL';

/* ------------------------------------------------------------------ helpers */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function byDate(a, b) {
  return (a.date || '').localeCompare(b.date || '') || (a.kickoffUtc || '').localeCompare(b.kickoffUtc || '');
}

/** Great-circle distance in km between two lat/lon pairs. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => !Number.isFinite(v))) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return round2(2 * R * Math.asin(Math.sqrt(s)));
}

export function slugTeam(name) {
  return String(name || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------- team aliases */

/** Build { aliasSlug -> canonicalName } from data/nrl_teams.json. */
export function nrlAliasMap(teamsDoc) {
  const map = new Map();
  for (const [canonical, t] of Object.entries(teamsDoc?.teams || {})) {
    map.set(slugTeam(canonical), canonical);
    map.set(slugTeam(t.short || ''), canonical);
    for (const a of t.aliases || []) if (a) map.set(slugTeam(a), canonical);
  }
  return map;
}

export function canonicalNrlTeam(name, teamsDoc, aliasMap = null) {
  const map = aliasMap || nrlAliasMap(teamsDoc);
  return map.get(slugTeam(name)) || name;
}

/* -------------------------------------------------------------- season tape */

/**
 * Normalise the tape: canonical team names, sorted, completed/scheduled split,
 * and a round -> team -> standing history used for "quality of opposition".
 */
export function buildNrlSeason(matchesDoc, teamsDoc) {
  const alias = nrlAliasMap(teamsDoc);
  const raw = (matchesDoc?.matches || []).map((m) => ({
    ...m,
    home: canonicalNrlTeam(m.home, teamsDoc, alias),
    away: canonicalNrlTeam(m.away, teamsDoc, alias),
  }));
  const completed = raw.filter((m) => m.status === 'completed' && Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore))
    .slice().sort(byDate);
  const scheduled = raw.filter((m) => m.status !== 'completed').slice().sort(byDate);
  return { raw, completed, scheduled, alias };
}

/**
 * Ladder as at `beforeDate` (matches strictly before that date), optionally
 * capped at `throughRound`.
 *
 * Competition points: 2 win, 1 draw, 0 loss, 2 bye. A bye is only counted for
 * rounds that have finished before the date in question — the same convention
 * the published ladder uses mid-round.
 */
export function nrlLadderAt(season, { beforeDate = null, throughRound = null } = {}) {
  const teamNames = new Set();
  for (const m of season.completed) { teamNames.add(m.home); teamNames.add(m.away); }
  for (const m of season.scheduled) { teamNames.add(m.home); teamNames.add(m.away); }

  const rows = new Map();
  for (const t of teamNames) rows.set(t, { team: t, P: 0, W: 0, D: 0, L: 0, B: 0, PF: 0, PA: 0 });

  const inScope = season.completed.filter((m) => {
    if (beforeDate && (m.date || '') >= beforeDate) return false;
    if (throughRound != null && m.round > throughRound) return false;
    return true;
  });

  const roundsSeen = new Set();
  for (const m of inScope) {
    roundsSeen.add(m.round);
    const h = rows.get(m.home);
    const a = rows.get(m.away);
    const hs = m.homeScore;
    const as = m.awayScore;
    h.P += 1; a.P += 1;
    h.PF += hs; h.PA += as;
    a.PF += as; a.PA += hs;
    if (hs > as) { h.W += 1; a.L += 1; } else if (hs < as) { a.W += 1; h.L += 1; } else { h.D += 1; a.D += 1; }
  }

  // Byes: rounds that finished before the cut-off in which the team played nothing.
  const lastRound = throughRound != null ? throughRound : (inScope.length ? Math.max(...inScope.map((m) => m.round)) : 0);
  for (const t of teamNames) {
    let byes = 0;
    for (let r = 1; r <= lastRound; r += 1) {
      if (!roundsSeen.has(r)) continue;
      const played = inScope.some((m) => m.round === r && (m.home === t || m.away === t));
      if (!played) byes += 1;
    }
    rows.get(t).B = byes;
  }

  const table = [...rows.values()].map((r) => ({
    ...r,
    PD: r.PF - r.PA,
    Pts: 2 * r.W + r.D + 2 * r.B,
  })).sort((a, b) => (b.Pts - a.Pts) || (b.PD - a.PD) || (b.PF - a.PF) || a.team.localeCompare(b.team));

  table.forEach((r, i) => { r.pos = i + 1; });
  return table;
}

/** round -> Map(team -> { pos, Pts, PD }) snapshot taken after that round. */
export function nrlLadderHistory(season) {
  const history = new Map();
  const maxRound = Math.max(0, ...season.completed.map((m) => m.round || 0));
  for (let r = 0; r <= maxRound; r += 1) {
    const table = nrlLadderAt(season, { throughRound: r });
    history.set(r, new Map(table.map((row) => [row.team, { pos: row.pos, Pts: row.Pts, PD: row.PD }])));
  }
  return history;
}

export function nrlTeamFor(season, team, beforeDate = null, n = 6) {
  const out = [];
  for (const m of season.completed) {
    if (beforeDate && (m.date || '') >= beforeDate) continue;
    if (m.home !== team && m.away !== team) continue;
    const isHome = m.home === team;
    const pf = isHome ? m.homeScore : m.awayScore;
    const pa = isHome ? m.awayScore : m.homeScore;
    out.push({
      match: m,
      date: m.date,
      round: m.round,
      opponent: isHome ? m.away : m.home,
      isHome,
      pf, pa,
      margin: pf - pa,
      result: pf > pa ? 'W' : pf < pa ? 'L' : 'D',
      total: pf + pa,
    });
  }
  return out.slice(-n).reverse(); // most recent first
}

/* --------------------------------------------------------------- form / h2h */

/** Recency weights, most recent first: 1.0, 0.9, 0.8, 0.7, 0.6, 0.5. */
const FORM_WEIGHTS = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

export function nrlForm(season, team, beforeDate = null, n = 6, history = null) {
  const matches = nrlTeamFor(season, team, beforeDate, n);
  if (!matches.length) return null;
  const hist = history || nrlLadderHistory(season);
  const enriched = matches.map((m) => {
    const snap = (hist.get((m.round || 1) - 1) || new Map()).get(m.opponent);
    return { ...m, oppPos: snap ? snap.pos : null, oppPts: snap ? snap.Pts : null };
  });
  let weightedWins = 0;
  let weightSum = 0;
  enriched.forEach((m, i) => {
    const w = FORM_WEIGHTS[i] ?? 0.5;
    weightSum += w;
    if (m.result === 'W') weightedWins += w;
    else if (m.result === 'D') weightedWins += w * 0.5;
  });
  const wins = enriched.filter((m) => m.result === 'W').length;
  const draws = enriched.filter((m) => m.result === 'D').length;
  const winMargins = enriched.filter((m) => m.result === 'W').map((m) => m.margin);
  const avgWinMargin = winMargins.length ? round2(winMargins.reduce((a, b) => a + b, 0) / winMargins.length) : null;
  return {
    team,
    sample: enriched.length,
    matches: enriched,
    wins,
    draws,
    losses: enriched.length - wins - draws,
    weightedWins: round2(weightedWins),
    weightedShare: weightSum ? round2(weightedWins / weightSum) : null,
    avgWinMargin,
    ppgFor: round2(enriched.reduce((a, m) => a + m.pf, 0) / enriched.length),
    ppgAgainst: round2(enriched.reduce((a, m) => a + m.pa, 0) / enriched.length),
    avgTotal: round2(enriched.reduce((a, m) => a + m.total, 0) / enriched.length),
    oppAvgPos: enriched.some((m) => m.oppPos) ? round2(enriched.filter((m) => m.oppPos).reduce((a, m) => a + m.oppPos, 0) / enriched.filter((m) => m.oppPos).length) : null,
  };
}

const H2H_WEIGHTS = [3, 2, 1];

export function nrlH2H(season, a, b, beforeDate = null, n = 3) {
  const meetings = [];
  for (const m of season.completed) {
    if (beforeDate && (m.date || '') >= beforeDate) continue;
    const pair = (m.home === a && m.away === b) || (m.home === b && m.away === a);
    if (!pair) continue;
    const aIsHome = m.home === a;
    meetings.push({
      date: m.date,
      round: m.round,
      aFor: aIsHome ? m.homeScore : m.awayScore,
      aAgainst: aIsHome ? m.awayScore : m.homeScore,
    });
  }
  const recent = meetings.slice(-n).reverse();
  if (!recent.length) return null;
  let weighted = 0;
  let weightSum = 0;
  recent.forEach((m, i) => {
    const w = H2H_WEIGHTS[i] ?? 1;
    weightSum += w;
    if (m.aFor > m.aAgainst) weighted += w;
    else if (m.aFor === m.aAgainst) weighted += w * 0.5;
  });
  return {
    n: recent.length,
    meetings: recent,
    wins: recent.filter((m) => m.aFor > m.aAgainst).length,
    draws: recent.filter((m) => m.aFor === m.aAgainst).length,
    losses: recent.filter((m) => m.aFor < m.aAgainst).length,
    weightedShare: weightSum ? round2(weighted / weightSum) : null,
  };
}

/* --------------------------------------------------------- totals / game state */

/**
 * Over/Under record for a team over its last `n` matches against a reference
 * total (the market line when one is published, otherwise the season mean).
 */
export function nrlTotalsProfile(season, team, beforeDate = null, n = 5, line = null) {
  const matches = nrlTeamFor(season, team, beforeDate, n);
  if (!matches.length) return null;
  const ref = Number.isFinite(line) ? line : null;
  const totals = matches.map((m) => m.total);
  return {
    team,
    n: matches.length,
    ppgFor: round2(matches.reduce((a, m) => a + m.pf, 0) / matches.length),
    ppgAgainst: round2(matches.reduce((a, m) => a + m.pa, 0) / matches.length),
    avgTotal: round2(totals.reduce((a, b) => a + b, 0) / totals.length),
    referenceLine: ref,
    overs: ref == null ? null : totals.filter((t) => t > ref).length,
    unders: ref == null ? null : totals.filter((t) => t < ref).length,
  };
}

/** Mean combined points across every completed match in the tape. */
export function nrlSeasonMeanTotal(season) {
  if (!season.completed.length) return null;
  const sum = season.completed.reduce((a, m) => a + m.homeScore + m.awayScore, 0);
  return round2(sum / season.completed.length);
}

/**
 * Close finishes: matches in the last `n` decided by 1-2 points. A one- or
 * two-point margin in rugby league is almost always golden point (or a late
 * field goal); the tape does not label the period, so this is recorded as a
 * *close finish*, never asserted as golden point.
 */
export function nrlCloseFinishes(season, team, beforeDate = null, n = 6) {
  const matches = nrlTeamFor(season, team, beforeDate, n);
  const close = matches.filter((m) => Math.abs(m.margin) <= 2);
  const lowScoring = matches.filter((m) => m.total <= 40);
  return {
    n: matches.length,
    closeCount: close.length,
    lowScoringCount: lowScoring.length,
    tightAndLow: close.filter((m) => m.total <= 40).length,
    matches: matches.map((m) => ({ date: m.date, total: m.total, margin: m.margin })),
  };
}

/* ------------------------------------------------------------ rest and byes */

/**
 * Days since the team's previous completed match, and whether the team is
 * coming off a bye (no completed match in the round immediately before this
 * one) or heading into one.
 */
export function nrlRestAndBye(season, team, matchRound, beforeDate) {
  const previous = season.completed
    .filter((m) => (m.home === team || m.away === team) && (m.date || '') < beforeDate)
    .slice(-1)[0] || null;
  let daysSince = null;
  if (previous?.date && beforeDate) {
    const a = new Date(`${previous.date}T00:00:00Z`);
    const b = new Date(`${beforeDate}T00:00:00Z`);
    daysSince = Math.round((b - a) / 86400000);
  }
  const playedPreviousRound = season.completed.some((m) => m.round === matchRound - 1 && (m.home === team || m.away === team));
  const playedThisRound = season.raw.some((m) => m.round === matchRound && (m.home === team || m.away === team));
  return {
    team,
    previousMatchDate: previous?.date || null,
    daysSince,
    offBye: matchRound > 1 ? !playedPreviousRound : false,
    byeThisRound: !playedThisRound,
  };
}

/* ------------------------------------------------------------------- travel */

const TRANS_TASMAN_KM = 2000;

export function nrlTravelContext(home, away, teamsDoc) {
  const teams = teamsDoc?.teams || {};
  const h = teams[home] || {};
  const a = teams[away] || {};
  const homeIsNZ = h.country === 'New Zealand';
  const awayIsNZ = a.country === 'New Zealand';
  const transTasman = homeIsNZ !== awayIsNZ;
  const km = haversineKm(h.lat, h.lon, a.lat, a.lon);
  // The home club plays at its own ground, so it carries no trip this round;
  // the visitor carries whatever the journey is. (A club's travel history over
  // the preceding rounds is not modelled - see NRL-11.)
  const awayBurden = transTasman ? 'trans-tasman' : (km != null && km > TRANS_TASMAN_KM ? 'long-haul' : 'normal');
  return {
    home, away,
    homeIsNZ, awayIsNZ,
    transTasman,
    km,
    homeTravelBurden: 'normal',
    awayTravelBurden: awayBurden,
    note: homeIsNZ || awayIsNZ
      ? 'New Zealand Warriors fixture: the visiting side crosses the Tasman.'
      : (km != null && km > TRANS_TASMAN_KM ? `Long-haul trip of about ${km} km between the two home venues.` : null),
  };
}

/* ------------------------------------------------------------------ weather */

export function nrlWeatherFor(weatherDoc, venue, dateISO) {
  const v = weatherDoc?.venues?.[venue];
  if (!v) return null;
  const day = (v.daily || []).find((d) => d.date === dateISO) || null;
  if (!day) return null;
  const precip = num(day.precip_mm);
  const prob = num(day.precip_prob_max);
  const wind = num(day.wind_max_kmh);
  const heavyRain = (precip != null && precip >= 5) || (prob != null && prob >= 80);
  const dry = (precip == null || precip < 1) && (prob == null || prob < 20);
  return {
    venue,
    date: dateISO,
    precip_mm: precip,
    precip_prob_max: prob,
    wind_max_kmh: wind,
    heavyRain,
    lightRain: !heavyRain && !dry,
    dry,
    strongWind: wind != null && wind >= 30,
    source: 'Open-Meteo daily forecast (key-less)',
  };
}

/* ------------------------------------------------------------ market lines */

export function nrlSlateEvent(slateDoc, home, away) {
  const alias = slugTeam;
  const events = slateDoc?.events || [];
  const target = events.find((e) => {
    if (e.type && e.type !== 'match') return false;
    const eh = alias(e.home || '');
    const ea = alias(e.away || '');
    const th = alias(home);
    const ta = alias(away);
    if (!eh || !ea) return false;
    return (eh === th && ea === ta) || (eh === ta && ea === th)
      || (th.includes(eh) && ta.includes(ea)) || (eh.includes(th) && ea.includes(ta));
  });
  return target || null;
}

export function nrlMarketLines(slateDoc, home, away) {
  const ev = nrlSlateEvent(slateDoc, home, away);
  if (!ev) return null;
  const find = (name) => (ev.markets || []).find((m) => m.market === name) || null;
  const hcap = find('Handicap (2-way)');
  const total = find('Total Points');
  const win = find('To Win');
  return {
    eventId: ev.event_id,
    url: ev.url,
    kickoffUtc: ev.kickoff_utc || null,
    handicapLine: hcap?.line ?? null,
    handicapLineSource: hcap?.line_source || null,
    handicapOtherLines: hcap?.other_lines_quoted || null,
    totalLine: total?.line ?? null,
    totalLineSource: total?.line_source || null,
    marketsOffered: (ev.markets || []).map((m) => m.market),
    marketsVerified: !!ev.markets_verified,
    toWinTips: win?.selections?.length ? win.selections : null,
  };
}

/* ------------------------------------------------------------------- Origin */

/**
 * Is the fixture inside, or immediately after, a State of Origin window?
 * A club match played within `guardDays` after an Origin game is the one the
 * prompt singles out: returning players are short of match sharpness.
 */
export function nrlOriginContext(originDoc, dateISO, guardDays = 4) {
  if (!originDoc?.games?.length) return { sourced: false, reason: 'no Origin calendar committed' };
  const d = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { sourced: false, reason: 'unparseable match date' };
  const games = originDoc.games.filter((g) => g.date);
  const windowStart = new Date(`${originDoc.series_window?.start || games[0].date}T00:00:00Z`);
  const windowEnd = new Date(`${originDoc.series_window?.end || games[games.length - 1].date}T00:00:00Z`);
  const guardEnd = new Date(windowEnd.getTime() + guardDays * 86400000);
  const inside = d >= windowStart && d <= guardEnd;
  const latestBefore = games.filter((g) => new Date(`${g.date}T00:00:00Z`) <= d).slice(-1)[0] || null;
  const daysSinceGame = latestBefore
    ? Math.round((d - new Date(`${latestBefore.date}T00:00:00Z`)) / 86400000)
    : null;
  return {
    sourced: true,
    series: originDoc.series || null,
    windowStart: originDoc.series_window?.start || null,
    windowEnd: originDoc.series_window?.end || null,
    insideWindow: inside,
    daysSinceLastOriginGame: daysSinceGame,
    latestGameBefore: latestBefore,
    // Outside the window no club player can be on Origin duty, so the Origin
    // half of the absences factor is verified rather than assumed.
    originDutyPossible: inside,
  };
}

/* -------------------------------------------------------------- enrichment */

/**
 * Assemble every feature the engine scores for one fixture. Anything the
 * documents do not carry stays null so the engine can record it as missing.
 */
export function enrichNrlMatch(match, docs) {
  const teamsDoc = docs.teams;
  const alias = docs.season?.alias || nrlAliasMap(teamsDoc);
  const home = canonicalNrlTeam(match.home, teamsDoc, alias);
  const away = canonicalNrlTeam(match.away, teamsDoc, alias);
  const date = match.date || (match.kickoffUtc || '').slice(0, 10) || null;
  const season = docs.season;
  const history = docs.history || nrlLadderHistory(season);
  const ladder = nrlLadderAt(season, { beforeDate: date });
  const homeRow = ladder.find((r) => r.team === home) || null;
  const awayRow = ladder.find((r) => r.team === away) || null;

  const lines = nrlMarketLines(docs.slate, home, away);
  const refTotal = lines?.totalLine ?? docs.seasonMeanTotal ?? null;
  const venue = match.venue || null;
  const weather = venue ? nrlWeatherFor(docs.weather, venue, date) : null;

  return {
    match: { ...match, home, away, date },
    league: 'NRL',
    round: match.round ?? null,
    date,
    venue,
    kickoffUtc: match.kickoffUtc || null,
    home,
    away,
    homeRow,
    awayRow,
    ladder,
    form: {
      home: nrlForm(season, home, date, 6, history),
      away: nrlForm(season, away, date, 6, history),
    },
    totals: {
      home: nrlTotalsProfile(season, home, date, 5, refTotal),
      away: nrlTotalsProfile(season, away, date, 5, refTotal),
    },
    close: {
      home: nrlCloseFinishes(season, home, date, 6),
      away: nrlCloseFinishes(season, away, date, 6),
    },
    h2h: nrlH2H(season, home, away, date, 3),
    rest: {
      home: nrlRestAndBye(season, home, match.round ?? 1, date),
      away: nrlRestAndBye(season, away, match.round ?? 1, date),
    },
    travel: nrlTravelContext(home, away, teamsDoc),
    weather,
    lines,
    referenceTotal: refTotal,
    seasonMeanTotal: docs.seasonMeanTotal ?? null,
    origin: nrlOriginContext(docs.origin, date),
    teams: teamsDoc?.teams || {},
  };
}

/** Every scheduled fixture, enriched, sorted by kick-off. */
export function nrlUpcoming(docs, limit = null) {
  const list = docs.season.scheduled.map((m) => enrichNrlMatch(m, docs));
  list.sort((a, b) => (a.kickoffUtc || a.date || '').localeCompare(b.kickoffUtc || b.date || ''));
  return limit ? list.slice(0, limit) : list;
}

/** Completed fixtures on one ISO date (for the results half of the scoreboard). */
export function nrlResultsOnDate(docs, dateISO) {
  return docs.season.completed.filter((m) => m.date === dateISO);
}

/** Dates that carry at least one NRL match, completed or scheduled. */
export function nrlCalendar(docs) {
  const counts = new Map();
  for (const m of docs.season.raw) {
    const d = m.date || (m.kickoffUtc || '').slice(0, 10);
    if (!d) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return counts;
}
