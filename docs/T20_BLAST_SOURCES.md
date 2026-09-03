# T20 Blast data sources — verification status

Every figure in the T20 Blast tape, table and card is traced to a source below.
A factor with no verified source is **never estimated**: it is recorded in the
result's `missing[]` list, penalised in scoring, and the affected market is
withheld. See `docs/T20_BLAST_IRREGULARITIES.md` for the full register.

All endpoints and pages below were verified on **2026-09-03**.

Competition: **T20 Blast (Vitality Blast, men) 2026** — England & Wales.
Season 22 May – 18 July 2026. Three groups of six (North; Central & West; South),
twelve fixtures per county (ten in-group plus two cross-pool), 108 group-stage
matches plus seven knockouts = **115 fixtures**. Champions:
**Northamptonshire Steelbacks**, their third title, beating Hampshire by 14 runs
in the final at Edgbaston.

---

## Authoritative sources used to build the tape

| ID | Source | URL | Provides | Status |
| --- | --- | --- | --- | --- |
| `cricinfo-table` | ESPNcricinfo points table | https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/points-table-standings | The **results tape**: every county's in-group fixtures with dates, opponents, result strings, margins; the final table with M/W/L/T/PTS/NRR and runs-for/against | ✅ Verified — authoritative |
| `cricinfo-fixtures` | ESPNcricinfo series fixtures & results | https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/match-schedule-fixtures-and-results | Venues, **all seven knockout event ids**, nine cross-pool event ids, season leaders rail | ✅ Verified |
| `cricinfo-series` | ESPNcricinfo series home | https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690 | Series identity (id `1512690`), navigation | ✅ Verified |
| `scorecard-by-event` | ESPNcricinfo scorecard redirect | `https://www.espncricinfo.com/matches/engine/match/{event_id}.html` | Human-review scorecard for any event id | ✅ Verified — event `1512885` confirmed to resolve to the Nottinghamshire v Surrey third quarter-final |
| `qf3-scorecard` | Third quarter-final full scorecard | https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/nottinghamshire-vs-surrey-3rd-quarter-final-1512885/full-scorecard | QF3 innings scores and top performances | ✅ Verified |
| `wikipedia` | Wikipedia 2026 T20 Blast | https://en.wikipedia.org/wiki/2026_T20_Blast | Format, groups, knockout bracket, season aggregates, champion | ✅ Verified — cross-check only |
| `wisden-sussex` | Wisden | https://www.wisden.com/series/county-championship-2026/cricket-news/county-hit-with-heavy-cross-competition-points-penalty-under-ecb-financial-framework | Sussex **two-point** Blast deduction | ✅ Verified |
| `sky-sussex` | Sky Sports | https://www.skysports.com/cricket/news/37706/13502388/sussex-to-start-2026-county-championship-with-12-point-deduction-after-entering-deal-with-ecb-to-combat-financial-issues | ECB financial framework context | ✅ Verified — cross-check |
| `sky-final` | Sky Sports live blog | https://www.skysports.com/cricket/live-blog/12123/13564698/vitality-blast-final-northamptonshire-vs-hampshire-live-text-updates-and-video-from-edgbaston-as-sides-eye-t20-glory | Final result and margin | ✅ Verified |
| `ecb` | England & Wales Cricket Board | https://www.ecb.co.uk/t20-blast | Competition owner; format and points system | ✅ Verified |
| `edgbaston-finals` | Edgbaston | https://edgbaston.com/news/2026-vitality-blast-finals-day-dates-revealed/ | Finals Day venue and date | ✅ Verified |
| `bbc-table` | BBC Sport table | https://www.bbc.com/sport/cricket/mens-england-twenty20/table | Independent table cross-check | ✅ Verified |

## Structured, key-less APIs (no authentication, no cost)

| ID | Endpoint | Provides | Status |
| --- | --- | --- | --- |
| `espn-standings-api` | `https://site.web.api.espn.com/apis/v2/sports/cricket/8053/standings?season=2026` | Structured JSON table: rank, M, W, L, T, N/R, PTS, NRR, runs for/against per county | ✅ Verified working. **Secondary only** — disagrees with ESPNcricinfo on `matchesPlayed` for several counties (TB-IR-07) |
| `espn-scoreboard-api` | `https://site.web.api.espn.com/apis/site/v2/sports/cricket/1512690/scoreboard?dates=YYYYMMDD` | Per-date events with ids, teams, venue, status, and results once complete | ✅ Verified working. The forward collector's primary endpoint |
| `espn-league-scoreboard` | `https://site.web.api.espn.com/apis/site/v2/sports/cricket/8053/scoreboard?dates=YYYYMMDD` | Whole-league per-date events; labels **cross-pool** fixtures, which the points tables do not | ✅ Verified working |
| `espn-scorepanel` | `https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel?dates=YYYYMMDD` | Today's slate across all cricket competitions | ✅ Verified working |

### ESPN league and team ids (verified from the league scoreboard payload)

League `8053`, series `1512690`. County ids: Warwickshire 1428, Derbyshire 904,
Durham 924, Essex 984, Glamorgan 1029, Gloucestershire 1034, Hampshire 1051,
Kent 1098, Lancashire 1116, Leicestershire 1133, Middlesex 1190,
Northamptonshire 1221, Nottinghamshire 1231, Somerset 1333, Surrey 1358,
Sussex 1371, Worcestershire 1458, Yorkshire 1464.

### Knockout event ids (verified on the series fixtures page)

| Fixture | Event id | Scorecard slug |
| --- | --- | --- |
| QF1 Hampshire v Essex | `1512883` | `hampshire-vs-essex-1st-quarter-final-1512883` |
| QF2 Gloucestershire v Northamptonshire | `1512884` | `northamptonshire-vs-gloucestershire-2nd-quarter-final-1512884` |
| QF3 Nottinghamshire v Surrey | `1512885` | `nottinghamshire-vs-surrey-3rd-quarter-final-1512885` |
| QF4 Yorkshire v Somerset | `1512886` | `yorkshire-vs-somerset-4th-quarter-final-1512886` |
| SF1 Northamptonshire v Somerset | `1512887` | `northamptonshire-vs-somerset-1st-semi-final-1512887` |
| SF2 Hampshire v Nottinghamshire | `1512888` | `hampshire-vs-nottinghamshire-2nd-semi-final-1512888` |
| Final Northamptonshire v Hampshire | `1512889` | `northamptonshire-vs-hampshire-final-1512889` |

The link text and URL slug on that page disagree about home/away for several
fixtures and do not disagree consistently, so only the **ids** were taken from
it (TB-IR-10). Orientation stays as verified from the points-table rows.

---

## Sources deliberately not used

| Source | Why not |
| --- | --- |
| The Odds API, Betfair | Require an API key. The prompt's odds bands are implemented and unit-tested but the factors are recorded missing (TB-IR-02) |
| ESPNcricinfo editorial pitch/weather prose | Not a structured field, so it cannot be scored without interpretation. Recording it would mean paraphrasing a report into a number (TB-IR-03) |
| Season batting/bowling aggregates as a proxy for player form | A season total cannot say who bats where in *this* fixture, so it cannot support a top-batsman tip. Using it would be a guess dressed as evidence (TB-IR-04) |
| Wikipedia per-match fixture boxes | Not fetched: roughly 115 cricketboxes at ~120 tokens each across 24 page chunks. Used only for targeted lookups where a specific knockout detail was needed |
| Any manually entered figure | The brief excludes manual input. Every number in the tape came from a page or endpoint listed above |

---

## How the tape was verified

`scripts/build_t20_blast.mjs` rebuilds all five documents from the sources above
and runs nine machine checks before writing. `--check` runs them without
writing; CI runs it on every push.

| Check | What it proves |
| --- | --- |
| 1 | Every row's winner resolves to one of the two teams in that row |
| 2 | The home team derived from a scorecard slug is a real county |
| 3 | No event id appears twice; every event id is numeric |
| 4 | Each in-group pairing meets exactly twice, less any **declared** gap |
| 5 | Every date falls inside the verified 22 May – 18 July window |
| 6 | The published points column equals `4×W + 2×T + 2×NR − deduction` for all eighteen counties |
| 7 | The published net run rate is **recomputed** from runs-for and runs-against and matched |
| 8 | The table's W/L/T reconciles with the captured group rows plus declared gaps |
| 9 | Every knockout row carries a verified event id **and** a full-scorecard slug |

Points system confirmed arithmetically: win 4, tie 2, no result 2, loss 0.
Sussex: 3 wins = 12 points, table shows 10, so the two-point deduction is
confirmed by arithmetic rather than taken on trust.

Latest run: **96 verified matches**, 18 counties across 3 groups, all nine
checks passing.

## Reviewing a figure by hand

Every row in `data/t20_blast_matches.json` carries `source_url` and a
`review_urls` array. Knockout rows point at the exact full scorecard; group rows
point at the `engine/match/{event_id}.html` redirect plus the series fixtures and
points-table pages. The T20 Blast page prints those links in each fixture's
**Analysis** panel, so any number on the site can be checked against its source
in one click.
