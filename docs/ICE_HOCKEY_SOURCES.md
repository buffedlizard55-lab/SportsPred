# Ice Hockey — Sources

Every input the ice hockey layer uses, with the URL it was read from, the HTTP
status returned, when it was checked, and what it actually provides. Anything
that could not be sourced is listed in
[ICE_HOCKEY_IRREGULARITIES.md](ICE_HOCKEY_IRREGULARITIES.md) and recorded as
`missing` on the match rather than estimated.

All checks below were performed on **2026-09-02** against the live endpoints.
This development sandbox has no outbound network, so the checks were made
directly against each URL and the collectors themselves were not executed here —
they run in CI (`.github/workflows/ice-hockey-collect.yml`).

## Primary feeds

| # | Source | URL | Status | Provides |
|---|---|---|---|---|
| 1 | NHL official scoreboard API | <https://api-web.nhle.com/v1/scoreboard/2026-10-08> | 200 | Game ids, season, game type, venue, `startTimeUTC`, `gameState`, home/away ids, abbreviations, full names, records as printed, game centre links |
| 2 | NHL official standings | <https://api-web.nhle.com/v1/standings/now> (resolves to `/standings/2026-04-17`) | 200 | `goalFor`, `goalAgainst`, `goalsForPctg`, `points`, `winPctg`, full home and road splits including goals, last 10 (`l10*`), `streakCode`/`streakCount`, `leagueSequence`, `divisionSequence`, `conferenceSequence` |
| 3 | NHL official club stats | <https://api-web.nhle.com/v1/club-stats/OTT/20252026/2> | 200 | Per-skater `shots`, `avgTimeOnIcePerGame`, `avgShiftsPerGame`, `powerPlayGoals`, `faceoffWinPctg`; goaltender `savePctg`, `goalsAgainstAverage`, wins |
| 4 | ESPN NHL scoreboard | <https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261008> | 200 | Moneyline, puck line (`pointSpread`), total (`total`), price attribution (`provider.name` = Draft Kings), records, venue, league calendar |
| 5 | ESPN NHL injuries | <https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries> | 200 | Per-team injury entries: athlete, `status`, `date`, `position.abbreviation`, comment text |
| 6 | OLBG ice hockey tips index | <https://www.olbg.com/betting-tips/Ice_Hockey/13> | 200 | Market rows on the slate: fixture, league, kickoff, consensus market, tipster vote counts. **No prices.** |
| 7 | ESPN core hockey league index | <https://sports.core.api.espn.com/v2/sports/hockey/leagues?limit=1000> | 200 | The complete list of hockey leagues ESPN publishes: `nhl`, `mens-college-hockey`, `womens-college-hockey`, `hockey-world-cup`, `olympics-mens-ice-hockey`, `olympics-womens-ice-hockey` |

## What was measured, not assumed

- **On 2026-09-02 the NHL feed returned zero events for today.** The 2025-26
  season ended `2026-07-01`; the 2026-27 league calendar begins `2026-09-19`.
  The nearest fixtures the league publishes are the October games now committed
  in `data/ice_hockey_fixtures.json`.
- **ESPN's NCAA men's hockey calendar starts 2026-10-02**, and its 2026-09-04
  scoreboard returned an empty `events` array.
- **The OLBG ice hockey index rendered three event rows** above its "Load More
  Tips" control on 2026-09-02: Davos v SCL Tigers (Switzerland NLA, 15 Sept
  13:45, `event_id=198599`), Pelicans v Sport (Finland SM Liiga, 04 Sept 09:30,
  `198658`) and Kalpa v Jukurit (Finland SM Liiga, 04 Sept 11:30, `198655`).
  Those three rows are what `data/ice_hockey_slate.json` holds.
- **The same OLBG page publishes league-level historical base rates** in its
  editorial copy — favourite win rates and Over 5.5 / Over 6.5 strike rates for
  twelve leagues (for example NHL 60.63% favourites, 57.20% Over 5.5, 6.23 goals
  per game; Sweden SHL 58.51%, 41.90%, 5.41; Finland SM Liiga 60.40%, 41.83%,
  5.38). These are OLBG's own published figures, not measurements this
  repository made, and they are cited as context for the European-league
  adjustment rather than fed into the score as facts.

## Manual review links

- NHL scoreboard (human page): <https://www.nhl.com/scores>
- NHL standings (human page): <https://www.nhl.com/standings>
- NHL API entry point: <https://api-web.nhle.com/v1/scoreboard/now>
- ESPN NHL scoreboard: <https://www.espn.com/nhl/scoreboard>
- ESPN NHL injuries: <https://www.espn.com/nhl/injuries>
- OLBG ice hockey tips: <https://www.olbg.com/betting-tips/Ice_Hockey/13>
- OLBG NHL sub-index: <https://www.olbg.com/betting-tips/Ice_Hockey/NHL/13>

## Collector mapping

| Document | Built by | Feed |
|---|---|---|
| `data/ice_hockey_fixtures.json` | `scripts/collect_ice_hockey_nhl.mjs` | 1 + 4 |
| `data/ice_hockey_tape.json` | `scripts/collect_ice_hockey_nhl.mjs` | 1 |
| `data/ice_hockey_standings.json` | `scripts/collect_ice_hockey_nhl.mjs` | 2 |
| `data/ice_hockey_goalies.json` | `scripts/collect_ice_hockey_nhl.mjs` | 3 |
| `data/ice_hockey_injuries.json` | `scripts/collect_ice_hockey_nhl.mjs` | 5 |
| `data/ice_hockey_slate.json` | `scripts/collect_ice_hockey_olbg.py` | 6 |
| `data/ice_hockey_backtest.json` | `scripts/backtest_ice_hockey.mjs` | the tape |
