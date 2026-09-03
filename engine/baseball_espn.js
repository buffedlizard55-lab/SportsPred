/**
 * SportsPred — Baseball feed parsers (pure, no I/O).
 *
 * Every field map below was read from a live response and is quoted with the
 * URL it came from. Where a feed does not carry a value the parser returns
 * null — it never defaults, and it never invents a number.
 *
 * VERIFIED ENDPOINTS (fetched 2026-09-03, HTTP 200)
 *  1. https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,linescore,team
 *       dates[].games[] -> gamePk, gameDate (ISO), status.abstractGameState
 *       (Final / Preview / Live), teams.away.team{ id, name, abbreviation,
 *       teamCode, venue }, teams.away.leagueRecord{ wins, losses, pct },
 *       teams.away.score, teams.away.isWinner, teams.away.probablePitcher
 *       { id, fullName }, teams.home.*, venue{ id, name }, linescore.
 *  2. https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026
 *       records[].teamRecords[] -> team{ id, name }, wins, losses, gamesPlayed,
 *       winningPercentage, runDifferential, runsScored, runsAllowed,
 *       streak{ streakCode, streakNumber },
 *       records.splitRecords[] { wins, losses, type: home|away|lastTen|left|right }.
 *  3. https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=hitting&season=2026&sportId=1
 *       stats[0].splits[] -> stat{ gamesPlayed, runs, avg, obp, slg, ops }, team{ id, name }.
 *     https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=pitching&season=2026&sportId=1
 *       stats[0].splits[] -> stat{ gamesPlayed, runs, era, whip, strikeoutsPer9Inn }, team{ id, name }.
 *  4. https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=gameLog&season=2026&group=pitching
 *       stats[0].splits[] -> stat{ inningsPitched, era, whip, strikeoutsPer9Inn,
 *       strikeOuts, baseOnBalls, hits, earnedRuns, isWin, numberOfPitches },
 *       date, opponent{ name }, isHome.
 *     https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=season&group=pitching&season=2026
 *       stats[0].splits[0].stat{ era, whip, strikeoutsPer9Inn, wins, losses }.
 *  5. https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=YYYYMMDD
 *       events[].competitions[0] -> venue{ fullName, indoor },
 *       competitors[] { homeAway, team{ abbreviation, displayName },
 *       records[] { name: overall|Home|Road, summary }, probables[] { athlete{ fullName },
 *       statistics[] { name: wins|losses|ERA, displayValue }, record },
 *       statistics[] { name: runs|avg|ERA|wins|losses|saves, displayValue } },
 *       weather{ displayValue, temperature }, notes[].
 *
 * NOT AVAILABLE FROM ANY KEY-LESS FEED WE COULD REACH (recorded as missing,
 * never estimated): moneyline / run line / total odds; bullpen ERA rank and
 * bullpen usage over the last three days; wind direction and speed; a posted
 * total line for Over/Under trend measurement.
 * See docs/BASEBALL_SOURCES.md and docs/BASEBALL_IRREGULARITIES.md.
 */

export const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
export const MLB_SCHEDULE_URL = (dateISO) => `${MLB_API_BASE}/schedule?sportId=1&date=${dateISO}&hydrate=probablePitcher,linescore,team`;
export const MLB_STANDINGS_URL = (season, leagueIds = '103,104') => `${MLB_API_BASE}/standings?leagueId=${leagueIds}&season=${season}`;
export const MLB_TEAM_STATS_URL = (group, season) => `${MLB_API_BASE}/teams/stats?stats=season&group=${group}&season=${season}&sportId=1`;
export const MLB_PERSON_SEASON_URL = (id, season) => `${MLB_API_BASE}/people/${id}/stats?stats=season&group=pitching&season=${season}`;
export const MLB_PERSON_GAMELOG_URL = (id, season) => `${MLB_API_BASE}/people/${id}/stats?stats=gameLog&season=${season}&group=pitching`;
export const ESPN_MLB_SCOREBOARD = (dates) => `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard${dates ? `?dates=${dates}` : ''}`;

const round = (n, dp = 4) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function normalizeAbbrev(a) {
  return a ? String(a).trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * MLB schedule -> fixtures + results tape
 * ------------------------------------------------------------------ */

function parseMlbSide(raw) {
  const team = raw?.team ?? {};
  const record = raw?.leagueRecord ?? {};
  return {
    id: team.id ?? null,
    name: team.name ?? null,
    locationName: team.locationName ?? null,
    abbrev: team.abbreviation ?? null,
    teamCode: team.teamCode ?? null,
    record: record.wins != null && record.losses != null ? { wins: record.wins, losses: record.losses, pct: record.pct ?? null } : null,
    score: raw?.score ?? null,
    isWinner: raw?.isWinner ?? null,
    probablePitcher: raw?.probablePitcher
      ? { id: raw.probablePitcher.id ?? null, name: raw.probablePitcher.fullName ?? null }
      : null,
  };
}

export function parseMlbSchedule(payload) {
  const warnings = [];
  const games = [];
  for (const day of payload?.dates || []) {
    for (const g of day.games || []) {
      const away = parseMlbSide(g?.teams?.away);
      const home = parseMlbSide(g?.teams?.home);
      if (!away?.name || !home?.name) {
        warnings.push(`game ${g?.gamePk}: missing a team name`);
        continue;
      }
      const state = g?.status?.abstractGameState ?? g?.status?.codedGameState ?? null;
      const phase = state === 'Final' ? 'results' : state === 'Live' || state === 'In Progress' ? 'live' : 'upcoming';
      games.push({
        id: String(g.gamePk ?? ''),
        source: 'mlb-statsapi-schedule',
        league: 'mlb',
        leagueName: 'Major League Baseball',
        season: g.season ?? null,
        dateISO: (g.gameDate ?? '').slice(0, 10) || null,
        startUtc: g.gameDate ?? null,
        phase,
        venue: g?.venue?.name ?? null,
        venueIndoor: null,
        home,
        away,
        score: { home: home.score, away: away.score },
      });
    }
  }
  return { games, warnings };
}

/** ESPN scoreboard -> per-(date,homeAbbrev,awayAbbrev) enrichment rows. */
export function parseEspnMlbScoreboard(payload) {
  const rows = [];
  const events = payload?.events || [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const homeComp = comp.competitors?.find((c) => c.homeAway === 'home');
    const awayComp = comp.competitors?.find((c) => c.homeAway === 'away');
    const homeAbbrev = normalizeAbbrev(homeComp?.team?.abbreviation);
    const awayAbbrev = normalizeAbbrev(awayComp?.team?.abbreviation);
    const dateISO = (ev.date ?? comp.date ?? '').slice(0, 10) || null;

    const teamStats = (c) => {
      const out = {};
      for (const s of c?.statistics || []) {
        if (s.name === 'runs') out.runs = num(s.displayValue);
        if (s.name === 'avg') out.avg = num(s.displayValue);
        if (s.name === 'ERA') out.era = num(s.displayValue);
        if (s.name === 'wins') out.wins = num(s.displayValue);
        if (s.name === 'losses') out.losses = num(s.displayValue);
      }
      return out;
    };

    const records = (c) => {
      const out = {};
      for (const r of c?.records || []) {
        if (r.name === 'overall') out.overall = r.summary ?? null;
        if (r.name === 'Home') out.home = r.summary ?? null;
        if (r.name === 'Road') out.road = r.summary ?? null;
      }
      return out;
    };

    const starter = (c) => {
      const p = c?.probables?.find((x) => x.name === 'probableStartingPitcher');
      if (!p) return null;
      const out = { name: p.athlete?.fullName ?? null };
      for (const s of p.statistics || []) {
        if (s.name === 'wins') out.wins = num(s.displayValue);
        if (s.name === 'losses') out.losses = num(s.displayValue);
        if (s.name === 'ERA') out.era = num(s.displayValue);
      }
      out.record = p.record ?? null;
      return out;
    };

    rows.push({
      dateISO,
      homeAbbrev,
      awayAbbrev,
      venue: comp.venue?.fullName ?? null,
      venueIndoor: comp.venue?.indoor === true,
      weather: comp.weather?.displayValue ?? null,
      temperature: comp.weather?.temperature ?? null,
      home: { stats: teamStats(homeComp), records: records(homeComp), starter: starter(homeComp) },
      away: { stats: teamStats(awayComp), records: records(awayComp), starter: starter(awayComp) },
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * MLB standings -> team profiles keyed by team id
 * ------------------------------------------------------------------ */

function splitRecord(record, type) {
  const r = (record?.records?.splitRecords || []).find((s) => s.type === type);
  return r ? { wins: r.wins ?? null, losses: r.losses ?? null, pct: r.pct ?? null } : null;
}

export function parseMlbStandings(payload) {
  const teams = {};
  for (const rec of payload?.records || []) {
    for (const tr of rec.teamRecords || []) {
      const team = tr.team ?? {};
      const id = team.id ?? null;
      if (id == null) continue;
      teams[id] = {
        id,
        name: team.name ?? null,
        wins: tr.wins ?? null,
        losses: tr.losses ?? null,
        gamesPlayed: tr.gamesPlayed ?? null,
        winningPercentage: tr.winningPercentage ?? null,
        runDifferential: tr.runDifferential ?? null,
        runsScored: tr.runsScored ?? null,
        runsAllowed: tr.runsAllowed ?? null,
        streak: tr.streak?.streakCode ?? null,
        streakNumber: tr.streak?.streakNumber ?? null,
        home: splitRecord(tr, 'home'),
        away: splitRecord(tr, 'away'),
        lastTen: splitRecord(tr, 'lastTen'),
        vsLeft: splitRecord(tr, 'left'),
        vsRight: splitRecord(tr, 'right'),
      };
    }
  }
  return { teams, count: Object.keys(teams).length };
}

/* ------------------------------------------------------------------ *
 * MLB team stats (hitting + pitching) -> profiles keyed by team id
 * ------------------------------------------------------------------ */

export function parseMlbTeamStats(payload, group) {
  const teams = {};
  for (const stat of payload?.stats || []) {
    for (const split of stat.splits || []) {
      const id = split.team?.id ?? null;
      const s = split.stat ?? {};
      if (id == null) continue;
      if (!teams[id]) teams[id] = { id, name: split.team?.name ?? null };
      if (group === 'hitting') {
        teams[id].hitting = {
          gamesPlayed: s.gamesPlayed ?? null,
          runs: s.runs ?? null,
          avg: s.avg != null ? num(s.avg) : null,
          obp: s.obp != null ? num(s.obp) : null,
          slg: s.slg != null ? num(s.slg) : null,
          ops: s.ops != null ? num(s.ops) : null,
        };
      } else if (group === 'pitching') {
        teams[id].pitching = {
          gamesPlayed: s.gamesPlayed ?? null,
          runs: s.runs ?? null,
          era: s.era != null ? num(s.era) : null,
          whip: s.whip != null ? num(s.whip) : null,
          strikeoutsPer9Inn: s.strikeoutsPer9Inn != null ? num(s.strikeoutsPer9Inn) : null,
          saves: s.saves ?? null,
          blownSaves: s.blownSaves ?? null,
        };
      }
    }
  }
  return { teams, count: Object.keys(teams).length };
}

/* ------------------------------------------------------------------ *
 * MLB person stats -> starting pitcher profile
 * ------------------------------------------------------------------ */

function isQualityStart(ip, er) {
  if (ip == null || er == null) return null;
  return ip >= 6 && er <= 3;
}

export function parseMlbPitcherGameLog(payload) {
  const splits = payload?.stats?.[0]?.splits || [];
  const starts = splits
    .filter((s) => (s.stat?.gamesStarted ?? 0) >= 1)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const last4 = starts.slice(0, 4).map((s) => {
    const st = s.stat ?? {};
    const ip = num(st.inningsPitched);
    const er = st.earnedRuns ?? null;
    return {
      date: s.date ?? null,
      opponent: s.opponent?.name ?? null,
      isHome: s.isHome ?? null,
      inningsPitched: ip,
      earnedRuns: er,
      hits: st.hits ?? null,
      strikeOuts: st.strikeOuts ?? null,
      baseOnBalls: st.baseOnBalls ?? null,
      pitches: st.numberOfPitches ?? null,
      isWin: s.isWin ?? null,
      qualityStart: isQualityStart(ip, er),
    };
  });
  return {
    last4,
    qualityStartsLast4: last4.filter((s) => s.qualityStart === true).length,
    qualityStartsLast3: last4.slice(0, 3).filter((s) => s.qualityStart === true).length,
    last4AvgIp: last4.length ? round(last4.reduce((a, s) => a + (s.inningsPitched ?? 0), 0) / last4.length, 2) : null,
    startsCount: starts.length,
  };
}

export function parseMlbPitcherSeason(payload) {
  const s = payload?.stats?.[0]?.splits?.[0]?.stat ?? null;
  if (!s) return null;
  return {
    era: s.era != null ? num(s.era) : null,
    whip: s.whip != null ? num(s.whip) : null,
    strikeoutsPer9Inn: s.strikeoutsPer9Inn != null ? num(s.strikeoutsPer9Inn) : null,
    wins: s.wins ?? null,
    losses: s.losses ?? null,
    inningsPitched: s.inningsPitched != null ? num(s.inningsPitched) : null,
    gamesStarted: s.gamesStarted ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Tape-derived factors (leak-free: nothing after `beforeUtc` is seen)
 * ------------------------------------------------------------------ */

function teamGames(tape, abbrev, beforeUtc) {
  return (tape || [])
    .filter((g) => g.phase === 'results'
      && (!beforeUtc || String(g.startUtc || g.dateISO) < String(beforeUtc))
      && (normalizeAbbrev(g.home?.abbrev) === normalizeAbbrev(abbrev)
        || normalizeAbbrev(g.away?.abbrev) === normalizeAbbrev(abbrev)))
    .sort((a, b) => String(b.startUtc || '').localeCompare(String(a.startUtc || '')));
}

function sideScore(g, abbrev) {
  const isHome = normalizeAbbrev(g.home?.abbrev) === normalizeAbbrev(abbrev);
  const gf = isHome ? g.score?.home : g.score?.away;
  const ga = isHome ? g.score?.away : g.score?.home;
  return { isHome, gf, ga };
}

/** Last-5 form, last-30-day run differential and scoring averages, win margins. */
export function scheduleFactors(tape, abbrev, beforeUtc) {
  const rows = teamGames(tape, abbrev, beforeUtc);
  if (!rows.length) {
    return { form: null, runDiffPerGame: null, runsPerGameRecent: null, runsAgainstPerGameRecent: null, avgWinMarginLast5Wins: null, winStreak: 0 };
  }

  const last5 = rows.slice(0, 5);
  const form = last5.length >= 5
    ? last5.map((g) => {
      const { gf, ga } = sideScore(g, abbrev);
      if (gf == null || ga == null) return null;
      return gf > ga ? 'W' : 'L';
    }).filter(Boolean)
    : null;
  if (form && form.length < 5) {
    // partial history: the engine needs a full 5; mark as insufficient
  }

  let winStreak = 0;
  if (Array.isArray(form)) for (const r of form) { if (r === 'W') winStreak += 1; else break; }

  // Last 30 days run differential + scoring averages.
  const cutoffMs = beforeUtc ? new Date(beforeUtc).getTime() - 30 * 86400000 : null;
  const month = rows.filter((g) => {
    if (!cutoffMs) return true;
    const t = new Date(g.startUtc || g.dateISO).getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  });
  let runDiffPerGame = null;
  let runsPerGameRecent = null;
  let runsAgainstPerGameRecent = null;
  if (month.length >= 5) {
    let scored = 0, allowed = 0;
    for (const g of month) {
      const { gf, ga } = sideScore(g, abbrev);
      if (gf == null || ga == null) continue;
      scored += gf; allowed += ga;
    }
    runDiffPerGame = round((scored - allowed) / month.length, 3);
    runsPerGameRecent = round(scored / month.length, 3);
    runsAgainstPerGameRecent = round(allowed / month.length, 3);
  }

  const winMargins = last5
    .map((g) => {
      const { gf, ga } = sideScore(g, abbrev);
      return gf != null && ga != null && gf > ga ? gf - ga : null;
    })
    .filter((m) => m != null);
  const avgWinMarginLast5Wins = winMargins.length ? round(winMargins.reduce((a, b) => a + b, 0) / winMargins.length, 3) : null;

  return {
    form: form && form.length >= 5 ? { last5: form, winStreak } : null,
    runDiffPerGame,
    runsPerGameRecent,
    runsAgainstPerGameRecent,
    avgWinMarginLast5Wins,
    winStreak,
  };
}

/** Head-to-head over the last `years` years, restricted to before `beforeUtc`. */
export function headToHeadFromTape(tape, abbrevA, abbrevB, beforeUtc, { years = 3 } = {}) {
  const a = normalizeAbbrev(abbrevA);
  const b = normalizeAbbrev(abbrevB);
  const cutoff = beforeUtc && years
    ? new Date(new Date(beforeUtc).getTime() - years * 365.25 * 86400000).toISOString()
    : null;
  const rows = (tape || []).filter((g) => {
    if (g.phase !== 'results') return false;
    if (beforeUtc && String(g.startUtc || g.dateISO) >= String(beforeUtc)) return false;
    if (cutoff && String(g.startUtc || g.dateISO) < cutoff) return false;
    const pair = [normalizeAbbrev(g.home?.abbrev), normalizeAbbrev(g.away?.abbrev)];
    return pair.includes(a) && pair.includes(b);
  }).sort((x, y) => String(y.startUtc || '').localeCompare(String(x.startUtc || '')));

  if (!rows.length) return null;
  let winsA = 0;
  const last10 = rows.slice(0, 10);
  for (const g of last10) {
    const { gf } = sideScore(g, a);
    const { gf: gfB } = sideScore(g, b);
    if (gf == null || gfB == null) continue;
    if (gf > gfB) winsA += 1;
  }
  const last3 = rows.slice(0, 3);
  const streak3 = last3.length >= 3 ? last3.every((g) => {
    const { gf } = sideScore(g, a);
    const { gf: gfB } = sideScore(g, b);
    return gf != null && gfB != null && gf > gfB;
  }) : null;

  return {
    meetings: rows.length,
    winsA,
    winsB: rows.length - winsA,
    last10WinsA: winsA,
    last10WinsB: last10.length - winsA,
    last3StreakA: streak3,
    last3StreakB: streak3 == null ? null : !streak3,
    lastThree: rows.slice(0, 3).map((g) => ({ id: g.id, dateISO: g.dateISO, score: `${g.score?.away}-${g.score?.home}` })),
  };
}
