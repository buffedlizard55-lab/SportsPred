/**
 * SportsPred — basketball ESPN helpers (pure, no I/O).
 *
 * These are the parse functions the basketball collector uses to turn raw ESPN
 * JSON into the committed documents the NBA v5.0 engine consumes. They are
 * pure so they can be unit-tested against committed excerpt fixtures (the
 * sandbox has no direct egress to ESPN; collection runs in CI).
 *
 * VERIFIED FIELD MAP (read live 2026-09-03 from the NBA standings endpoint):
 *   children[].name                      -> conference name
 *   children[].isConference              -> true for East / West
 *   children[].standings.entries[]       -> teams, already ordered by rank
 *   entries[].team.displayName           -> team name (joins to the scoreboard)
 *   entries[].stats[].type               -> 'winpercent' | 'avgpointsfor' |
 *                                           'avgpointsagainst' | 'playoffseed'
 *   entries[].stats[].value              -> numeric value
 *
 * NOTE ON RANK: `playoffSeed` is ESPN's BPI *projected playoff seed*, not the
 * conference standing position. The conference rank used here is the 1-based
 * position of the team inside the ordered `entries` array (verified: the first
 * entry is the conference leader).
 */

export const ESPN_BASKETBALL_STANDINGS = {
  nba: 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings',
  wnba: 'https://site.api.espn.com/apis/v2/sports/basketball/wnba/standings',
};

export const ESPN_BASKETBALL_SCOREBOARD = (league) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/scoreboard`;

function statValue(entry, ...keys) {
  for (const s of entry?.stats || []) {
    if (keys.includes(s?.type) || keys.includes(s?.name)) {
      const v = Number(s.value);
      return Number.isFinite(v) ? v : null;
    }
  }
  return null;
}

/**
 * Normalise an ESPN standings payload into
 *   { conferences: { [name]: { teams: [{ name, rank, winPct, ppg, oppPpg }] } } }
 * Ranks are 1-based conference positions. Teams without a display name are
 * dropped rather than guessed.
 */
export function parseEspnBasketballStandings(payload) {
  const conferences = {};
  for (const child of payload?.children || []) {
    if (!child?.isConference) continue;
    const entries = child.standings?.entries || [];
    const teams = entries
      .map((entry, idx) => ({
        name: entry?.team?.displayName ?? entry?.team?.name ?? null,
        rank: idx + 1,
        winPct: statValue(entry, 'winpercent', 'winPercent', 'leaguewinpercent', 'leagueWinPercent'),
        ppg: statValue(entry, 'avgpointsfor', 'avgPointsFor'),
        oppPpg: statValue(entry, 'avgpointsagainst', 'avgPointsAgainst'),
      }))
      .filter((t) => t.name);
    if (teams.length) conferences[child.name] = { teams };
  }
  return conferences;
}
