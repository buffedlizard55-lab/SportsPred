# Golf Sources — verified, key-less, manually reviewable

Every golf field on this site comes from one of the endpoints below. Each was
fetched live through a hosted fetch on **2026-09-02** and inspected before
being used. Nothing on the golf page is estimated, interpolated or inferred: a
factor that no source publishes is recorded in `missing[]` and scores zero
(see `GOLF_IRREGULARITIES.md`).

**Environment note.** The development sandbox cannot open TLS connections to
`site.api.espn.com`, `site.web.api.espn.com`, `www.olbg.com`, `apiweb.owgr.com`
or `api.open-meteo.com` (`SSL_ERROR_SYSCALL`). All live verification was done
through a hosted fetch, and all collection runs in GitHub Actions
(`.github/workflows/golf-collect.yml`, `.github/workflows/collect.yml`). This
is the same constraint recorded for tennis and Formula 1.

---

## 1. ESPN golf — public JSON, no API key

| Purpose | Endpoint | Verified |
|---|---|---|
| Season calendar + the event covering a date | `https://site.api.espn.com/apis/site/v2/sports/golf/{pga\|eur\|lpga\|champions-tour}/scoreboard?dates=YYYYMMDD` | 2026-09-02 |
| Full leaderboard: field, tee times, positions, result codes, round scores, course, cut, winner, purse | `https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league={league}&event={eventId}` | 2026-09-02 |
| Signature-event flag, purse, scoring system | `https://sports.core.api.espn.com/v2/sports/golf/leagues/{league}/events/{eventId}` | 2026-09-02 |
| Tournament identity across seasons (id, cut line, winner ref) | `https://sports.core.api.espn.com/v2/sports/golf/leagues/{league}/tournaments/{tournamentId}/seasons/{year}` | 2026-09-02 |
| Season statistics by athlete (PGA TOUR only) | `https://site.web.api.espn.com/apis/common/v3/sports/golf/pga/statistics/byathlete?season=YYYY&limit=50&page=N` | 2026-09-02 |
| Player game log with per-tournament stats (driving distance, accuracy, GIR, putts per GIR, birdies) | `https://site.web.api.espn.com/apis/common/v3/sports/golf/athletes/{athleteId}/gamelog?season=YYYY` | 2026-09-02 (inspected; not collected — see IR-GOLF-09) |

Human-readable review links (open these to check any figure by hand):

- Leaderboard — `https://www.espn.com/golf/leaderboard?tournamentId={eventId}`
  (every event object in `data/golf_events.json` and every entry in
  `data/golf_results.json` carries this under `sources.espnLeaderboard` /
  `sourceUrl`)
- Player — `https://www.espn.com/golf/player/_/id/{athleteId}`
- Schedule — <https://www.espn.com/golf/schedule>

### Fields ESPN actually publishes (verified against the TOUR Championship
`401811964` and the Omega European Masters `401822700`)

- **Event** — `id`, `name`, `date`/`endDate`, `league.slug` (`pga` = 1106,
  `eur` = 7002, `lpga` = 1107, `champions-tour` = 1105), `tournament.id`
  (stable across seasons — `3383` is the European Masters every year),
  `tournament.major`, `numberOfRounds`, `cutRound`, `cutScore`, `cutCount`,
  `purse`, `status.type.state` (`pre`/`in`/`post`), `winner`,
  `defendingChampion`, `courses[] {name, totalYards, shotsToPar, address}`.
- **Competitor** — `athlete {id, displayName, flag.alt (country),
  birthPlace.countryAbbreviation, amateur}`, `status.type.shortDetail`
  (`F`, `CUT`, `WD`, `DQ`, `Scheduled`), `status.position {id, displayName,
  isTie}`, `status.teeTime`, `status.startHole`, `status.thru`,
  `score {value (strokes), displayValue (to par)}`, `linescores[] {period,
  value (strokes), displayValue (to par), teeTime, startPosition,
  currentPosition}`, `earnings`, `movement`, `statistics[] {scoreToPar,
  officialAmount, cupPoints}`.
- **Upcoming events** publish the full entry list with round-one and
  round-two tee times before the first ball is struck (verified 2026-09-02
  on `401822700`, ~150 competitors).
- **Leaders** — per-event stat leaders only (driving distance, driving
  accuracy, GIR, putts per GIR); not per player.
- **Season statistics** (PGA TOUR) — `amount`, `cupPoints`,
  `tournamentsPlayed`, `roundsPlayed`, `cutsMade`, `topTenFinishes`, `wins`,
  `scoringAverage`, `yardsPerDrive`, `driveAccuracyPct`, `greensInRegPct`,
  `strokesPerHole`, `sandSaves`, `savePct`, `birdiesPerRound`. The same
  endpoint for `eur` returns no athlete rows (verified 2026-09-02).

### Fields ESPN does NOT publish for golf

- **Odds.** The scoreboard shows `provider: Draft Kings` for team sports, but
  every golf event inspected (upcoming and completed, PGA TOUR and DP World
  Tour) has no odds object, and the core `…/competitions/{id}/odds` resource
  returns `count: 0` (verified 2026-09-02 on `401850914` and `401822700`).
- **Strokes gained** in any form.
- **Course type, grass type, links/coastal classification.**
- **OWGR** (see section 2).

## 2. Official World Golf Ranking — public JSON

| Purpose | Endpoint | Verified |
|---|---|---|
| Current ranking, top 1000 | `https://apiweb.owgr.com/api/owgr/rankings/getRankings?pageSize=1000&pageNumber=1&countryId=0&sortString=Rank+ASC` | 2026-09-02 |
| Human-readable | <https://www.owgr.com/current-world-ranking> and `https://www.owgr.com/playerprofile/{slug}-{id}` | 2026-09-02 |

Fields used: `rank`, `player.fullName`, `player.country {name, code3,
region.name}`, `pointsAverage`, `lastWeekRank`, `endLastYearRank`,
`isAmateur`. The endpoint reported 9,510 ranked players on 2026-09-02; the
top five were Scheffler, McIlroy, Young, Fitzpatrick, Clark, which matches
the OWGR top-15 table reproduced on the OLBG golf index the same day.

OWGR uses its own player ids. Matching to ESPN is by normalised name (see
IR-GOLF-05).

## 3. PGA TOUR statistics — strokes gained (ShotLink)

| Category | Page | Verified |
|---|---|---|
| SG: approach the green | <https://www.pgatour.com/stats/detail/02568> | 2026-09-02 (page renders a full table: rank, movement, player, average, total, measured rounds) |
| SG: off the tee | <https://www.pgatour.com/stats/detail/02567> | stat id documented by the PGA TOUR site |
| SG: around the green | <https://www.pgatour.com/stats/detail/02569> | stat id documented by the PGA TOUR site |
| SG: putting | <https://www.pgatour.com/stats/detail/02564> | stat id documented by the PGA TOUR site |
| SG: tee-to-green | <https://www.pgatour.com/stats/detail/02674> | stat id documented by the PGA TOUR site |
| SG: total | <https://www.pgatour.com/stats/detail/02675> | stat id documented by the PGA TOUR site |

These are **season-to-date averages**, not the last-eight-events window the
prompt asks for, and they exist for the PGA TOUR only. The pages are
JavaScript-rendered; `parsePgaTourStatPage` reads the embedded page data or
the rendered table and refuses to return anything below fifty plausible rows.
When a category cannot be parsed in CI it is absent and the engine scores it
as missing (IR-GOLF-02).

## 4. Open-Meteo — weather (free, key-less)

| Purpose | Endpoint |
|---|---|
| Geocode the course city | `https://geocoding-api.open-meteo.com/v1/search?name={city}&count=5` |
| Daily wind / rain / temperature for the four tournament days + hourly wind and rain for round one | `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=…&hourly=wind_speed_10m,precipitation_probability&timezone=auto&start_date=…&end_date=…` |

Collected by `scripts/collect_golf_weather.mjs` inside seven days of the
first round. The round-one trend (improving / stable / deteriorating)
compares the 13:00–16:00 local window with 07:00–10:00 (IR-GOLF-06).

## 5. OLBG — golf betting tips index (markets and consensus only)

| Purpose | URL | Verified |
|---|---|---|
| Sport index (id 5) | <https://www.olbg.com/betting-tips/Golf/5> | 2026-09-02 |
| Event page | `https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/{Event_Name}/5?event_id={id}` | 2026-09-02 (`101769` Omega European Masters) |

Rows observed on 2026-09-02: Walker Cup (`101768`, Win Tournament, USA,
3/4 tips), Omega European Masters (`101769`, Win Tournament, Ryan Gerard,
2/4 tips), NI Legends (`101770`, Win Tournament, Steven Alker, 1/1 tips). The
index also carries an editorial "golfers in form" table and the OWGR top 15;
both are parsed for cross-checking only. OLBG's server-rendered HTML carries
no prices (IR-GOLF-01), and tipster consensus is display-only.

## 6. What each committed file contains

| File | Built by | Contents |
|---|---|---|
| `data/golf_events.json` | `scripts/collect_golf_espn.mjs` | events inside −10/+21 days for the PGA TOUR and DP World Tour with full fields, tee times, course facts; the LPGA/Champions event covering today (show-only); every tour's season calendar |
| `data/golf_results.json` | same | compact results tape (`[athleteId, position, result, toPar, r1, r2, r3, r4]`) for every completed event of the current and previous season(s), plus a player index |
| `data/golf_rankings.json` | same | OWGR top 1000 |
| `data/golf_stats.json` | same | ESPN PGA TOUR season statistics + PGA TOUR strokes-gained tables when parseable |
| `data/golf_weather.json` | `scripts/collect_golf_weather.mjs` | forecasts per upcoming event |
| `data/golf_slate.json` | `scripts/collect_golf_olbg.py` | OLBG golf rows, team events, editorial tables |
| `data/golf_backtest.json`, `data/golf_predictions.json` | `scripts/backtest_golf.mjs` | walk-forward grades per market and the ledger |
| `data/golf_provenance.json` | `scripts/collect_golf_espn.mjs` | the source list above in machine-readable form + the irregularities register |
