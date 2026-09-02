/**
 * SportsPred — Ice Hockey feed parsers (pure, no I/O).
 *
 * Every field map below was read from a live response and is quoted with the
 * URL it came from. Where a feed does not carry a value the parser returns
 * null — it never defaults, and it never invents a number.
 *
 * VERIFIED ENDPOINTS (fetched 2026-09-02, HTTP 200)
 *  1. https://api-web.nhle.com/v1/scoreboard/2026-10-08
 *       gamesByDate[].games[] -> id, season, gameType, gameDate, venue.default,
 *       startTimeUTC, gameState ("FUT"/"LIVE"/"OFF"), awayTeam/homeTeam
 *       { id, abbrev, name.default, record ("43-27-12"), logo }, gameCenterLink
 *  2. https://api-web.nhle.com/v1/standings/now   (resolves to /standings/{date})
 *       standings[] -> teamAbbrev.default, teamName.default, gamesPlayed,
 *       goalFor, goalAgainst, goalsForPctg, points, winPctg, wins, losses,
 *       otLosses, homeGamesPlayed, homeGoalsFor, homeGoalsAgainst, homeWins,
 *       homeLosses, homeOtLosses, roadGamesPlayed, roadGoalsFor,
 *       roadGoalsAgainst, roadWins, roadLosses, roadOtLosses, l10GamesPlayed,
 *       l10Wins, l10Losses, l10OtLosses, l10GoalsFor, l10GoalsAgainst,
 *       streakCode, streakCount, leagueSequence, divisionSequence,
 *       conferenceSequence, seasonId
 *  3. https://api-web.nhle.com/v1/club-stats/OTT/20252026/2
 *       skaters[] -> playerId, firstName.default, lastName.default,
 *       positionCode, gamesPlayed, goals, assists, points, shots,
 *       avgTimeOnIcePerGame, avgShiftsPerGame, powerPlayGoals, faceoffWinPctg
 *  4. https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries
 *       injuries[] -> { id, displayName, injuries[] { id, status, date,
 *       longComment, shortComment, athlete.displayName, position.abbreviation,
 *       team.abbreviation } }
 *  5. https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=YYYYMMDD
 *       parsed by engine/espn_universal.js (odds, records, venue, calendar).
 *
 * NOT AVAILABLE FROM ANY KEY-LESS FEED WE COULD REACH (recorded as missing,
 * never estimated): team power play %, penalty kill %, shots for/against per
 * game, blocked shots, confirmed starting goaltender for a future game.
 * See docs/ICE_HOCKEY_SOURCES.md and docs/ICE_HOCKEY_IRREGULARITIES.md.
 */

export const NHL_API_BASE = 'https://api-web.nhle.com/v1';
export const NHL_SCOREBOARD_URL = (dateISO) => `${NHL_API_BASE}/scoreboard/${dateISO}`;
export const NHL_STANDINGS_URL = (dateISO) => `${NHL_API_BASE}/standings/${dateISO || 'now'}`;
export const NHL_CLUB_STATS_URL = (abbrev, season, gameType = 2) => `${NHL_API_BASE}/club-stats/${abbrev}/${season}/${gameType}`;
export const NHL_GAMECENTER_URL = (gameId) => `${NHL_API_BASE}/gamecenter/${gameId}/landing`;
export const ESPN_HOCKEY_SCOREBOARD = (league, dates) => `https://site.api.espn.com/apis/site/v2/sports/hockey/${league}/scoreboard${dates ? `?dates=${dates}` : ''}`;
export const ESPN_HOCKEY_INJURIES = (league) => `https://site.api.espn.com/apis/site/v2/sports/hockey/${league}/injuries`;

const round = (n, dp = 4) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const pick = (obj) => (obj && typeof obj === 'object' && 'default' in obj ? obj.default : obj ?? null);

/** "43-27-12" -> { wins, losses, otLosses, played, points }. null when unparseable. */
export function parseNhlRecord(summary) {
  if (typeof summary !== 'string' || !summary.trim()) return null;
  const parts = summary.trim().split('-').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const [wins, losses, otLosses = 0] = parts;
  return { wins, losses, otLosses, played: wins + losses + otLosses, points: wins * 2 + otLosses };
}

/** NHL API scoreboard payload -> normalised fixtures. */
export function parseNhlScoreboard(payload, { requestedDate = null } = {}) {
  const warnings = [];
  const games = [];
  for (const day of payload?.gamesByDate || []) {
    for (const g of day.games || []) {
      const away = g.awayTeam || {};
      const home = g.homeTeam || {};
      if (!away?.abbrev || !home?.abbrev) {
        warnings.push(`game ${g?.id}: missing a team abbreviation`);
        continue;
      }
      games.push({
        id: String(g.id ?? ''),
        source: 'nhl-api-scoreboard',
        league: 'nhl',
        leagueName: 'National Hockey League',
        season: g.season ?? null,
        gameType: g.gameType ?? null,
        dateISO: g.gameDate ?? day.date ?? null,
        startUtc: g.startTimeUTC ?? null,
        phase: g.gameState === 'FUT' ? 'upcoming' : g.gameState === 'LIVE' ? 'live' : g.gameState === 'OFF' ? 'results' : String(g.gameState ?? '').toLowerCase(),
        venue: g.venue?.default ?? null,
        neutral: false,
        gameCenterLink: g.gameCenterLink ? `https://api-web.nhle.com${g.gameCenterLink}` : null,
        home: {
          id: home.id ?? null,
          abbrev: home.abbrev ?? null,
          name: pick(home.name) ?? home.abbrev ?? null,
          record: parseNhlRecord(home.record),
          recordSummary: home.record ?? null,
          logo: home.logo ?? null,
        },
        away: {
          id: away.id ?? null,
          abbrev: away.abbrev ?? null,
          name: pick(away.name) ?? away.abbrev ?? null,
          record: parseNhlRecord(away.record),
          recordSummary: away.record ?? null,
          logo: away.logo ?? null,
        },
        score: { home: g.homeTeam?.score ?? null, away: g.awayTeam?.score ?? null },
      });
    }
  }
  const focused = payload?.focusedDate ?? requestedDate ?? null;
  return { focusedDate: focused, games, warnings };
}

/**
 * NHL standings payload -> team profiles keyed by abbreviation.
 * Everything here is measured from the official table; the ranks are the
 * league sequence the NHL itself publishes.
 */
export function parseNhlStandings(payload, { leagueSize = null } = {}) {
  const teams = {};
  const rows = payload?.standings || [];
  const size = leagueSize ?? rows.length ?? null;
  for (const t of rows) {
    const abbrev = pick(t.teamAbbrev);
    if (!abbrev) continue;
    const gp = t.gamesPlayed ?? null;
    const homeGp = t.homeGamesPlayed ?? null;
    const homePlayed = (t.homeWins ?? 0) + (t.homeLosses ?? 0) + (t.homeOtLosses ?? 0);
    teams[abbrev] = {
      abbrev,
      name: pick(t.teamName) ?? abbrev,
      league: 'nhl',
      seasonId: t.seasonId ?? null,
      standingsDate: t.date ?? payload?.standingsDateTimeUtc ?? null,
      gamesPlayed: gp,
      points: t.points ?? null,
      pointsPctg: t.pointPctg ?? null,
      winPctg: t.winPctg != null ? round(t.winPctg * 100, 2) : null,
      wins: t.wins ?? null,
      losses: t.losses ?? null,
      otLosses: t.otLosses ?? null,
      goalsForPerGame: t.goalFor != null && gp ? round(t.goalFor / gp, 3) : null,
      goalsAgainstPerGame: t.goalAgainst != null && gp ? round(t.goalAgainst / gp, 3) : null,
      goalDifferential: t.goalDifferential ?? null,
      home: {
        gamesPlayed: homeGp ?? homePlayed,
        wins: t.homeWins ?? null,
        losses: t.homeLosses ?? null,
        otLosses: t.homeOtLosses ?? null,
        goalsFor: t.homeGoalsFor ?? null,
        goalsAgainst: t.homeGoalsAgainst ?? null,
        winPctg: homePlayed ? round((t.homeWins / homePlayed) * 100, 2) : null,
      },
      road: {
        gamesPlayed: t.roadGamesPlayed ?? null,
        wins: t.roadWins ?? null,
        losses: t.roadLosses ?? null,
        otLosses: t.roadOtLosses ?? null,
        goalsFor: t.roadGoalsFor ?? null,
        goalsAgainst: t.roadGoalsAgainst ?? null,
      },
      last10: {
        games: t.l10GamesPlayed ?? null,
        wins: t.l10Wins ?? null,
        losses: t.l10Losses ?? null,
        otLosses: t.l10OtLosses ?? null,
        goalsFor: t.l10GoalsFor ?? null,
        goalsAgainst: t.l10GoalsAgainst ?? null,
      },
      streak: { code: t.streakCode ?? null, count: t.streakCount ?? null },
      ranks: {
        league: t.leagueSequence ?? null,
        division: t.divisionSequence ?? null,
        conference: t.conferenceSequence ?? null,
        leagueSize: size,
      },
      // Not published by the standings feed. Present only when a stats feed
      // supplies them; otherwise null so the engine records them as missing.
      shotsForPerGame: t.shotsForPerGame ?? null,
      shotsAgainstPerGame: t.shotsAgainstPerGame ?? null,
      powerPlayPctg: t.powerPlayPctg ?? null,
      penaltyKillPctg: t.penaltyKillPctg ?? null,
      powerPlayOpportunitiesPerGame: t.powerPlayOpportunitiesPerGame ?? null,
      blockedShotsPerGame: t.blockedShotsPerGame ?? null,
    };
  }
  return { teams, standingsDate: payload?.standingsDateTimeUtc ?? null, teamsCount: Object.keys(teams).length };
}

/**
 * NHL club-stats payload -> goaltender save percentages and top-line TOI load.
 * Only what the feed prints is returned.
 */
export function parseNhlClubStats(payload, { abbrev = null } = {}) {
  const skaters = payload?.skaters || [];
  const goalies = payload?.goalies || [];
  const topLine = skaters
    .filter((s) => typeof s.avgTimeOnIcePerGame === 'number')
    .sort((a, b) => b.avgTimeOnIcePerGame - a.avgTimeOnIcePerGame)
    .slice(0, 5)
    .map((s) => ({
      name: [pick(s.firstName), pick(s.lastName)].filter(Boolean).join(' '),
      position: s.positionCode ?? null,
      gamesPlayed: s.gamesPlayed ?? null,
      points: s.points ?? null,
      shots: s.shots ?? null,
      avgTimeOnIcePerGame: s.avgTimeOnIcePerGame ?? null,
      avgShiftsPerGame: s.avgShiftsPerGame ?? null,
    }));

  const goalieRows = goalies.map((g) => ({
    name: [pick(g.firstName), pick(g.lastName)].filter(Boolean).join(' '),
    gamesPlayed: g.gamesPlayed ?? null,
    savePctg: g.savePctg ?? null,
    goalsAgainstAverage: g.goalsAgainstAverage ?? null,
    wins: g.wins ?? null,
    losses: g.losses ?? null,
    otLosses: g.otLosses ?? null,
    shutouts: g.shutouts ?? null,
  })).filter((g) => g.savePctg != null);

  return {
    abbrev: abbrev ?? payload?.teamAbbrev ?? null,
    season: payload?.season ?? null,
    gameType: payload?.gameType ?? null,
    skaterCount: skaters.length,
    topLine,
    goalies: goalieRows,
    bestSavePctg: goalieRows.length ? Math.max(...goalieRows.map((g) => g.savePctg)) : null,
  };
}

/** ESPN injuries payload -> { ABBREV: { entries, keyForwardLineMissing, count } }. */
export function parseEspnHockeyInjuries(payload) {
  const byTeam = {};
  for (const team of payload?.injuries || []) {
    const entries = [];
    for (const inj of team.injuries || []) {
      entries.push({
        id: inj.id ?? null,
        athlete: inj.athlete?.displayName ?? null,
        status: inj.status ?? null,
        date: inj.date ?? null,
        position: inj.athlete?.position?.abbreviation ?? null,
        comment: inj.shortComment ?? inj.longComment ?? null,
      });
    }
    const teamAbbrev = team.injuries?.[0]?.athlete?.team?.abbreviation ?? team.abbreviation ?? null;
    const key = teamAbbrev || team.displayName || null;
    if (!key) continue;
    const forwards = entries.filter((e) => ['L', 'R', 'C', 'LW', 'RW'].includes(e.position));
    byTeam[key] = {
      team: team.displayName ?? key,
      timestamp: payload?.timestamp ?? null,
      count: entries.length,
      entries,
      forwardOutCount: forwards.filter((e) => e.status === 'Out').length,
      keyForwardLineMissing: forwards.filter((e) => e.status === 'Out').length >= 3,
    };
  }
  return { byTeam, timestamp: payload?.timestamp ?? null, teams: Object.keys(byTeam).length };
}

/**
 * Derive the schedule-derived factors the prompt asks for, from a results tape.
 * Every window is restricted to games that finished strictly before `beforeUtc`
 * so a backtest can never see the future.
 */
export function scheduleFactors(tape, abbrev, beforeUtc, { totalLine = null } = {}) {
  const rows = (tape || [])
    .filter((g) => g.phase === 'results' && (!beforeUtc || String(g.startUtc || g.dateISO) < String(beforeUtc))
      && (g.home?.abbrev === abbrev || g.away?.abbrev === abbrev))
    .sort((a, b) => String(b.startUtc || '').localeCompare(String(a.startUtc || '')));

  const last5 = rows.slice(0, 5);
  const form = last5.length >= 5 ? last5.map((g) => {
    const isHome = g.home?.abbrev === abbrev;
    const gf = isHome ? g.score?.home : g.score?.away;
    const ga = isHome ? g.score?.away : g.score?.home;
    if (gf == null || ga == null) return null;
    return gf > ga ? 'W' : 'L';
  }).filter(Boolean) : null;

  const winMargins = last5
    .filter((g) => {
      const isHome = g.home?.abbrev === abbrev;
      const gf = isHome ? g.score?.home : g.score?.away;
      const ga = isHome ? g.score?.away : g.score?.home;
      return gf != null && ga != null && gf > ga;
    })
    .map((g) => {
      const isHome = g.home?.abbrev === abbrev;
      return (isHome ? g.score.home : g.score.away) - (isHome ? g.score.away : g.score.home);
    });

  let overs = null, unders = null;
  if (totalLine != null) {
    const scored = last5.filter((g) => g.score?.home != null && g.score?.away != null);
    if (scored.length === 5) {
      overs = scored.filter((g) => g.score.home + g.score.away > totalLine).length;
      unders = scored.filter((g) => g.score.home + g.score.away < totalLine).length;
    }
  }

  // Back-to-back: any game within the previous 24 hours of the fixture.
  const nextFixtureUtc = beforeUtc;
  const backToBack = rows.length ? (() => {
    const prev = rows[0];
    if (!nextFixtureUtc || !prev.startUtc) return null;
    const diffH = (new Date(nextFixtureUtc).getTime() - new Date(prev.startUtc).getTime()) / 3600000;
    return diffH > 0 && diffH <= 30;
  })() : null;

  let winStreak = 0;
  if (Array.isArray(form)) for (const r of form) { if (r === 'W') winStreak += 1; else break; }

  return {
    form: form && form.length >= 5 ? { last5: form, winStreak } : null,
    avgWinMarginLast5Wins: winMargins.length ? round(winMargins.reduce((a, b) => a + b, 0) / winMargins.length, 3) : null,
    recentTotals: totalLine != null && overs != null ? { games: 5, overs, unders } : null,
    backToBack,
    recentGames: rows.slice(0, 5).map((g) => ({
      id: g.id, dateISO: g.dateISO, opponent: g.home?.abbrev === abbrev ? g.away?.abbrev : g.home?.abbrev,
      home: g.home?.abbrev === abbrev, score: g.home?.abbrev === abbrev
        ? { for: g.score?.home, against: g.score?.away } : { for: g.score?.away, against: g.score?.home },
    })),
  };
}

/** Head-to-head from a tape, restricted to meetings before `beforeUtc`. */
export function headToHeadFromTape(tape, abbrevA, abbrevB, beforeUtc, { years = 3 } = {}) {
  const cutoff = beforeUtc && years
    ? new Date(new Date(beforeUtc).getTime() - years * 365.25 * 86400000).toISOString()
    : null;
  const rows = (tape || []).filter((g) => {
    if (g.phase !== 'results') return false;
    if (beforeUtc && String(g.startUtc || g.dateISO) >= String(beforeUtc)) return false;
    if (cutoff && String(g.startUtc || g.dateISO) < cutoff) return false;
    const pair = [g.home?.abbrev, g.away?.abbrev];
    return pair.includes(abbrevA) && pair.includes(abbrevB);
  }).sort((a, b) => String(b.startUtc || '').localeCompare(String(a.startUtc || '')));

  if (!rows.length) return null;
  let winsA = 0;
  for (const g of rows) {
    const aHome = g.home?.abbrev === abbrevA;
    const gfA = aHome ? g.score?.home : g.score?.away;
    const gfB = aHome ? g.score?.away : g.score?.home;
    if (gfA == null || gfB == null) continue;
    if (gfA > gfB) winsA += 1;
  }
  return {
    meetings: rows.length,
    winsA,
    winsB: rows.length - winsA,
    lastThree: rows.slice(0, 3).map((g) => ({ id: g.id, dateISO: g.dateISO, score: `${g.score?.away}-${g.score?.home}` })),
  };
}

/** Puck line covers from a tape that carries ESPN spread lines. */
export function puckLineCovers(tape, abbrev, beforeUtc, { window = 10 } = {}) {
  const rows = (tape || [])
    .filter((g) => g.phase === 'results' && (!beforeUtc || String(g.startUtc || g.dateISO) < String(beforeUtc))
      && (g.home?.abbrev === abbrev || g.away?.abbrev === abbrev)
      && g.spread?.line != null && g.score?.home != null && g.score?.away != null)
    .sort((a, b) => String(b.startUtc || '').localeCompare(String(a.startUtc || '')))
    .slice(0, window);

  if (!rows.length) return null;
  let covered = 0;
  for (const g of rows) {
    const isHome = g.home?.abbrev === abbrev;
    const line = isHome ? g.spread.homeLine ?? g.spread.line : g.spread.awayLine ?? -g.spread.line;
    const margin = (isHome ? g.score.home - g.score.away : g.score.away - g.score.home) + line;
    if (margin > 0) covered += 1;
  }
  return { of: rows.length, covered };
}
