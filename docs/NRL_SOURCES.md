# NRL sources — every feed, verified, with review links

The NRL layer implements **NRL (NATIONAL RUGBY LEAGUE) PREDICTION MASTER PROMPT
v1.0** ([full text](NRL_MASTER_PROMPT.md), [line-by-line review](NRL_PROMPT_REVIEW.md)).
Every endpoint below is public and key-less. All were read on **2026-09-04**.

## The register

| Id | Source | Used for | How it was read |
|---|---|---|---|
| NRL-SRC-01 | [OLBG — Rugby League betting tips index (the market slate)](https://www.olbg.com/betting-tips/Rugby_League/10) | Every NRL event currently on the OLBG board, the markets offered on each (To Win, Handicap 2-way, Total Points) and the best-tip line. | full-page fetch, 2026-09-04 |
| NRL-SRC-02 | [OLBG — event page (Gold Coast Titans v Dolphins)](https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/Gold_Coast_Titans_v_Dolphins/10?event_id=2751059) | Confirms the three markets OLBG offers per NRL fixture and that no bookmaker prices appear in the server-rendered HTML. | full-page fetch, 2026-09-04 |
| NRL-SRC-03 | [Rugby League Project — 2026 Telstra NRL Premiership, data completed](https://www.rugbyleagueproject.org/seasons/nrl-2026/data.html) | Match-by-match results tape for rounds 1-25 (date, home, away, score). | full-page fetch, 2026-09-04 |
| NRL-SRC-04 | [Rugby League Project — Round 27 fixtures](https://www.rugbyleagueproject.org/seasons/nrl-2026/round-27/summary.html) | Round 27 venues and local kick-off times, converted to UTC. | full-page fetch, 2026-09-04 |
| NRL-SRC-05 | [Wikipedia — 2026 NRL season results](https://en.wikipedia.org/wiki/2026_NRL_season_results) | Round 26 results with venue, referee and attendance; cross-check for the ladder. | verified extract, 2026-09-04 |
| NRL-SRC-06 | [Rugby League Zone — NRL results 2026](https://rugbyleaguezone.com/nrl/results/) | Second source for the round 26 scorelines. | verified extract, 2026-09-04 |
| NRL-SRC-07 | [Zero Tackle — 2026 NRL draw and results](https://www.zerotackle.com/nrl/fixtures-results/) | Kick-off times in UTC and result confirmation (round 26 and the round 27 opener). | verified extract, 2026-09-04 |
| NRL-SRC-08 | [ABC News — Broncos beat Bulldogs 34-20](https://www.abc.net.au/news/2026-09-03/nrl-live-brisbane-broncos-vs-canterbury-bulldogs-payne-haas/107111222) | Independent confirmation of the round 27 opener (Canterbury-Bankstown 20 - 34 Brisbane). | verified extract, 2026-09-04 |
| NRL-SRC-09 | [NRL — official ladder](https://www.nrl.com/ladder/) | Governing-body reference for the competition table and the top-four / top-eight cut-offs. | cited for manual review |
| NRL-SRC-10 | [NRL — official draw](https://www.nrl.com/draw/) | Governing-body reference for fixtures, venues and byes. | cited for manual review |
| NRL-SRC-11 | [ESPN — NRL scoreboard (key-less site API)](https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=20260903-20260908) | Venue names, UTC kick-off times, recent form strings and the season calendar; used by the CI collector to refresh the tape. | full response fetched, 2026-09-04 |
| NRL-SRC-12 | [Open-Meteo forecast API](https://api.open-meteo.com/v1/forecast?latitude=-28.0667&longitude=153.4333&daily=precipitation_sum,precipitation_probability_max,wind_speed_10m_max&forecast_days=4&timezone=UTC) | Daily precipitation, precipitation probability and maximum wind speed per match venue. | full response fetched, 2026-09-04 (seven venues) |
| NRL-SRC-13 | [2026 State of Origin series — schedule and result](https://www.nrl.com/state-of-origin/) | Origin window (27 May, 17 June, 8 July 2026; New South Wales won 2-1) used to decide whether Origin duty is possible for a fixture. | dates corroborated across two published sources, 2026-09-04 |
| NRL-SRC-14 | [Published NRL ladder after round 26 (cross-check)](https://sportstralia.com.au/rugby/nrl-2026-ladder/) | Independent published table used to validate the tape-derived ladder. | verified extract, 2026-09-04 |

## Manual review links

- OLBG Rugby League index (every market currently on the board): <https://www.olbg.com/betting-tips/Rugby_League/10>
- OLBG event page, worked example: <https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/Gold_Coast_Titans_v_Dolphins/10?event_id=2751059>
- NRL official ladder: <https://www.nrl.com/ladder/>
- NRL official draw: <https://www.nrl.com/draw/>
- 2026 NRL season results (Wikipedia): <https://en.wikipedia.org/wiki/2026_NRL_season_results>
- Rugby League Project 2026 season: <https://www.rugbyleagueproject.org/seasons/nrl-2026/results.html>
- Rugby League Project round 27 fixtures: <https://www.rugbyleagueproject.org/seasons/nrl-2026/round-27/summary.html>
- ESPN NRL scoreboard (key-less site API): <https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=20260903-20260908>
- Open-Meteo forecast, Cbus Super Stadium: <https://api.open-meteo.com/v1/forecast?latitude=-28.0667&longitude=153.4333&daily=precipitation_sum,precipitation_probability_max,wind_speed_10m_max&forecast_days=4&timezone=UTC>
- Published ladder after round 26 (cross-check): <https://sportstralia.com.au/rugby/nrl-2026-ladder/>

## How the tape was validated

The 2026 tape in data/nrl_matches.json was recomputed into a ladder after round 26 and compared with the published table: all seventeen clubs match exactly on played, won, lost, drawn, points differential and competition points. A single mistyped or missing score would break that check for at least one club.

- Round 1 was a split round (two matches in Las Vegas on 28 February, the remaining six from 5 March). The tape keeps it as one round of eight.
- Seventeen clubs means some rounds carry three or seven byes rather than one. Rounds 12, 15 and 18 have five matches and rounds 13, 16 and 19 have seven; every club finishes with three byes except the Knights, who have two.

## Two traps in the ESPN feed

The CI collector merges ESPN's scoreboard into `data/nrl_matches.json` on every
run. Two things in that feed do not belong on an NRL club tape, and both are
handled explicitly (see NRL-12 and NRL-13 in
[the irregularity register](NRL_IRREGULARITIES.md)):

- **State of Origin is filed under the same league.** ESPN serves New South
  Wales v Queensland with an ordinary week number, indistinguishable from a club
  fixture. Anything outside the 17 clubs in `data/nrl_teams.json` is skipped and
  reported on the command line; `collect_nrl_espn.mjs --check` fails if a
  non-club side ever reaches the tape. Origin lives in `data/nrl_origin.json`.
- **ESPN dates events in UTC; the tape dates them by local kick-off.** Those
  agree for every match played in Australia, but not for the two round 1 games
  at Allegiant Stadium: 2026-02-28 in Las Vegas is 2026-03-01 in UTC. A fetched
  fixture is therefore matched against the tape by exact date, then by the same
  pairing within a day, then by the same pairing and round within a week, so a
  match the tape already holds is merged rather than duplicated.

`tests/nrl_espn.test.mjs` replays the exact four events the 2026-09-04 collector
run tripped over and asserts the tape is unchanged by them.

## What is deliberately not collected

| Prompt asks for | Why it is not collected | What the engine does instead |
|---|---|---|
| Prices from two sportsbooks | No key-less NRL price feed exists; OLBG's server HTML carries no prices either | the 15-point value factor scores zero, is named on every card, and no ROI is ever published |
| Team lists, Origin squads, judiciary outcomes | No free feed publishes them | the Origin half is scored from the verified Origin calendar; the injury/suspension half is left unscored |
| Historical handicap and total lines | Nothing free publishes them | HANDICAP is reported unbacktested; GAME TOTAL is backtested against the rolling season mean and labelled |
| Golden point periods | Scores are published without the period | one- and two-point margins are recorded as close finishes |

## Reproducing the data layer

```bash
python3 scripts/collect_rugby_league_olbg.py          # the OLBG market slate (all rugby league)
node scripts/collect_nrl_espn.mjs                     # refresh the NRL tape from ESPN
node scripts/collect_nrl_weather.mjs                  # refresh venue forecasts from Open-Meteo
node scripts/backtest_nrl.mjs                         # walk-forward backtest
node scripts/record_nrl_predictions.mjs               # append the forward ledger
node --test tests/nrl_data.test.mjs tests/nrl_engine.test.mjs tests/nrl_writer.test.mjs tests/nrl_espn.test.mjs
```
