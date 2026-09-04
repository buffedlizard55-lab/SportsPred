# Scottish Open overlay — sources

Every input to the SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0
implementation, with the official link for manual review. Nothing on this page
is a guess: a factor with no source is recorded as missing in the engine and
listed in [`GOLF_IRREGULARITIES.md`](GOLF_IRREGULARITIES.md).

See also [`GOLF_SOURCES.md`](GOLF_SOURCES.md) for the shared golf feeds and
[`SCOTTISH_OPEN_PROMPT_REVIEW.md`](SCOTTISH_OPEN_PROMPT_REVIEW.md) for the
line-by-line mapping.

## Scoring inputs

| Input | Source | Key? | Committed as |
|---|---|---|---|
| Field, tee times, results, cut, yardage, par | [ESPN golf leaderboard JSON](https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event={eventId}) · [leaderboard page](https://www.espn.com/golf/leaderboard) | no | `data/golf_events.json`, `data/golf_results.json` |
| Results tape (2023-11 → 2026-08, 230 events) | same, one leaderboard per event, each row carrying its own URL | no | `data/golf_results.json` |
| Official World Golf Ranking + last-week rank | [OWGR rankings JSON](https://apiweb.owgr.com/api/owgr/rankings/getRankings?pageSize=1000&pageNumber=1&countryId=0&sortString=Rank+ASC) · [current ranking page](https://www.owgr.com/current-world-ranking) | no | `data/golf_rankings.json` |
| Strokes gained (OTT, APP, ARG, PUTT, T2G, total) | [PGA TOUR statistics](https://www.pgatour.com/stats) republished by ESPN | no | `data/golf_stats.json` → `sg` (151 players) |
| Season stats incl. driving distance, accuracy, GIR, up-and-down % | [ESPN golf statistics by athlete](https://site.web.api.espn.com/apis/common/v3/sports/golf/pga/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=50&season=2026&page=1) | no | `data/golf_stats.json` → `espn` |
| Four-round forecast and AM/PM wind and rain divergence | [Open-Meteo forecast](https://open-meteo.com/) · [geocoding](https://geocoding-api.open-meteo.com/) | no | `data/golf_weather.json` → `r1.windAmKmh` / `windPmKmh` |
| Links / wind-exposed venue classification | see the table below | no | `data/golf_links_courses.json` |
| Market slate (display only, never scored) | [OLBG Golf betting tips](https://www.olbg.com/betting-tips/Golf/5) · [All Golf — All Events](https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/5) | no | `data/golf_slate.json` |

## Links venue classification

No feed classifies a golf course. `scripts/build_golf_links.mjs` holds the
table; every row carries the source that classifies it, and the venues that were
**rejected** are listed with the reason so the negatives are auditable too.

| Venue | Class | Source |
|---|---|---|
| The Renaissance Club | links | [Wikipedia — List of links golf courses](https://en.wikipedia.org/wiki/List_of_links_golf_courses) (Scotland → Lothian) |
| Royal Troon Golf Course | links | same (Scotland → Strathclyde) |
| St Andrews Links (Old Course) | links | same (Scotland → Fife) |
| Royal Birkdale GC | links | same (England → North West) |
| Royal Portrush Golf Club | links | [Wikipedia — Royal Portrush Golf Club](https://en.wikipedia.org/wiki/Royal_Portrush_Golf_Club) — "two links courses… on the rota of the Open Championship… hosted the 2025 tournament" |
| Royal County Down GC | links | [the club's own Championship Links page](https://www.royalcountydown.org/championship_links) — "The finest of all links courses" |
| Trump International Golf Links | links | [GolfPass course profile](https://www.golfpass.com/travel-advisor/courses/19459-trump-international-golf-links-ireland) — "Style: Links" (secondary source, recorded as such) |
| Pebble Beach Golf Links | **coastal, not links** | [Wikipedia — Links (golf)](https://en.wikipedia.org/wiki/Links_(golf)) names it as a course "regarded as links" without all the characteristics |

Rejected, with reasons, in `data/golf_links_courses.json` → `excluded[]`:
Muirfield **Village** (Ohio, not Muirfield), Royal Melbourne (sandbelt), Royal
Queensland, Royal Johannesburg, an ambiguous "Royal GC", Harbour Town Golf
Links, St. Francis Links, Yas Links GC, Dunes Golf & Beach Club. A course with
"Royal" or "Links" in its title is never classified on the name alone.

The Open Championship needs no entry: it is **always** played on a links course
([Wikipedia — Links (golf)](https://en.wikipedia.org/wiki/Links_(golf))), so the
engine matches it on the ESPN name plus the `major` flag. The tape holds the
2024 (Royal Troon), 2025 (Royal Portrush) and 2026 (Royal Birkdale) editions.

## Event facts

Verified on 2026-09-04 and committed in `data/golf_scottish_open.json`;
`node scripts/build_scottish_open.mjs --check` fails CI if the file drifts from
the script.

| Fact | Source |
|---|---|
| Host since 2019, confirmed through 2030 | [Golf Scotland](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) · [Irish Golfer](https://irishgolfer.ie/latest-golf-news/2026-04-22/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) · [Scotland's Golf Coast](https://www.scotlandsgolfcoast.com/members/the-renaissance-club/) |
| Title sponsor: Genesis (since 2022) | [DP World Tour — Genesis Scottish Open 2026](https://www.europeantour.com/dpworld-tour/genesis-scottish-open-2026/tickets-packages/) · [2022 announcement](https://www.europeantour.com/dpworld-tour/rolex/news/articles/detail/the-renaissance-club-to-host-genesis-scottish-open-through-to-2026/) · [Golf Business News](https://golfbusinessnews.com/news/sponsorship-and-events/genesis-extends-sponsorship-of-scottish-open-at-the-renaissance-club-until-2026/) |
| The week immediately before The Open | [Golfweek/USA Today](https://golfweek.usatoday.com/story/sports/golf/majors/british-open/2026-06-22/when-is-the-2026-open-championship-at-royal-birkdale/90641242007/) · [2026 Open Championship](https://en.wikipedia.org/wiki/2026_Open_Championship) |
| Co-sanctioned; counts on the Race to Dubai and the FedExCup | [Golf Scotland](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) · [The Renaissance Club](https://trcaa.com/scottish-open/) |
| Opens the Closing Swing, the fifth and final Global Swing (5,000 Race to Dubai points) | [DP World Tour — The Closing Swing: All you need to know](https://www.europeantour.com/dpworld-tour/news/articles/detail/the-closing-swing-2026-all-you-need-to-know/) · [event TV schedule page](https://www.europeantour.com/dpworld-tour/genesis-scottish-open-2026/tv-schedule) |
| Winner earns a Masters invite; the top three not already exempt earn Open places | [DP World Tour — The Closing Swing](https://www.europeantour.com/dpworld-tour/news/articles/detail/the-closing-swing-2026-all-you-need-to-know/) · [2026 Open Qualifying Series table](https://en.wikipedia.org/wiki/2026_Open_Championship) |
| 2026 layout rerouted (the par-three sixth became the fifteenth) | [Golf Scotland](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) |
| Winning scores 2019-2023 | [GolfNewsNet history table](https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/) · [BettingSites history](https://www.bettingsites.co/sports/golf/tournaments/scottish-open/) · [Marca](https://www.marca.com/en/golf/2026-07-12/genesis-scottish-open-winners-complete-list-of-winners-at-the-renaissance-club-1.html) |
| Winning scores 2024-2026 | **measured** from `data/golf_results.json` — [2024](https://www.espn.com/golf/leaderboard?tournamentId=401580359) · [2025](https://www.espn.com/golf/leaderboard?tournamentId=401703519) · [2026](https://www.espn.com/golf/leaderboard?tournamentId=401811955) |
| 2027 dates | **UNCONFIRMED** — only a hospitality reseller publishes them: [Eventmasters](https://www.eventmasters.co.uk/golf-hospitality/scottish-open-hospitality.html) |

## Not available from any free source

| Input | Consequence |
|---|---|
| Bookmaker prices for the five markets | `odds` in every market's `missing[]`; OWGR rank within the field stands in for favouritism (IR-GOLF-17) |
| Ball flight, spin, trajectory | Course fit caps at twelve of twenty; the −8 penalty is never applied; the prompt's value test is unreachable as written (IR-GOLF-20) |
| Per-round wind for completed events | The twenty-point fast-start tier is unreachable (IR-GOLF-21) |
| Race to Dubai standings, travel intent, sentiment | Those bonuses are unassessed and never assumed (IR-GOLF-22) |
| Strokes gained for DP World Tour members | The ball-striking and putting categories are missing for those players (IR-GOLF-18) |

## Reproduce it

```bash
node scripts/build_golf_links.mjs            # data/golf_links_courses.json
node scripts/build_scottish_open.mjs         # data/golf_scottish_open.json
node scripts/backtest_scottish_open.mjs      # walk-forward ledger
npm run check:scottish-open                  # all three with --check
npm test                                     # includes tests/golf_scottish_open.test.mjs
node scripts/verify_site.mjs                 # page + module graph
```
