# Greyhound sources — every feed, verified, with review links

The greyhound layer implements **GREYHOUND RACING PREDICTION MASTER PROMPT
v1.0**. It is built on official data: the Greyhound Board of Great Britain
(GBGB) is the sport's governing body and every UK licensed track uploads and
reconciles results into its database. All endpoints below are public,
key-less and were verified working on **2026-09-02**.

## Step 1 inputs → source map

| Prompt requirement (Step 1) | Source | Endpoint / page | Verified |
|---|---|---|---|
| Racecard / slate of today's races | GBGB results API (day index) | `https://api.gbgb.org.uk/api/results?page=1&itemsPerPage=200&date=YYYY-MM-DD&race_type=race` | ✅ JSON, meeting ids + winner rows |
| Full draw for every meeting (unrun + settled) | GBGB meeting record | `https://api.gbgb.org.uk/api/results/meeting/{meetingId}` | ✅ JSON: races, traps, dogId, class, distance, prizes |
| Last-5 results: position, distance, track, grade, trap | GBGB dog history | `https://api.gbgb.org.uk/api/results/dog/{dogId}?page=1&itemsPerPage=60` | ✅ JSON, newest first, 97+ runs per dog |
| Trap draw today + historical performance from that trap | dog history `trapNumber` + meeting draw | same endpoints | ✅ |
| Race distance + proven form over the distance | meeting `raceDistance`, history `raceDistance` | same | ✅ comparable trips within 20 m |
| Track-specific performance | history `trackName` | same | ✅ |
| Grade today vs recent grades | meeting `raceClass`, history `raceClass` (A1–A11, D, S, H, OR) | same | ✅ |
| Starting prices / odds | GBGB meeting record `SP`, `resultPriceNumerator/Denominator` | meeting endpoint | ⚠️ **SP only, after the race** — see IR-GH-01 |
| Scratchings / non-runners | settled trap count vs six-trap card | meeting endpoint | ✅ after result; live draw taken from racecard |
| Racecard index for mornings before results land | Sporting Life racecards (links only; GBGB remains the data source) | `https://www.sportinglife.com/greyhounds/racecards` | ✅ date/track/race links |
| OLBG market slate (display only) | OLBG greyhound tips index | `https://www.olbg.com/betting-tips/Greyhounds/28` | ✅ event links + tipster consensus |
| Timeform analyst verdict | — | paywalled / not in free payload | — | ❌ never scored (IR-GH-02) |
| Tip sheet / Sporting Life form summaries | — | paywalled narrative | — | ❌ never scored (IR-GH-02) |
| Social / X sentiment | — | deliberately excluded; no structured feed | — | ❌ never collected (IR-GH-03) |
| Track handedness / configuration | — | not published as data | — | ❌ trap edge measured from results (IR-GH-04) |
| Live odds from two sources / line movement | — | no free key-less feed | — | ❌ IR-GH-01 |

## Manual review links

- GBGB results site (searchable by date, track, class, greyhound):
  <https://www.gbgb.org.uk/racing/results/>
- GBGB API — today's races (raw JSON):
  <https://api.gbgb.org.uk/api/results?page=1&itemsPerPage=20&date=2026-09-02&race_type=race>
- Sporting Life greyhound racecards: <https://www.sportinglife.com/greyhounds/racecards>
- OLBG greyhound tips: <https://www.olbg.com/betting-tips/Greyhounds/28>
- GBGB open-race calendar: <https://www.gbgb.org.uk/racing/open-races>

## Data shapes (verified)

**Day index** — one row per finished race (the winner); `meta.pageCount` paginates.

**Meeting record** — every race with `raceClass` (e.g. `A5`, `OR1`), `raceDistance`
(metres), `racePrizes`, and `traps[]` carrying `trapNumber`, `dogId`, `dogName`,
`trainerName`, breeding, and — once settled — `SP`, `resultPosition`,
`resultRunTime`, `resultSectionalTime`, `resultBtnDistance` and the in-running
`resultComment`. Races not yet run have the full declared draw with no result
fields. Trials (`raceType: "Trial"`, class `T1`/`T2`/…) are excluded.

**Dog history** — `items[]` newest first with `raceDate`, `trackName`,
`raceClass`, `raceDistance`, `trapNumber`, `resultPosition`, `SP`,
`resultRunTime`, `raceWinTime`, `resultComment` and paging meta. Trials are
excluded by the parser.

## Honesty constraints

- No value is ever invented. A missing factor is recorded in `missing[]`,
  shown in the analysis panel, and lowers the confidence ceiling.
- Sporting Life is used only to enumerate racecard links on mornings before
  the official results index has populated; **every scored fact comes from the
  GBGB payload**.
- OLBG tipster consensus is display-only market context and is never fed into
  scoring.
- The starting price exists only for settled races. It powers the backtest;
  the live card treats the 25-point odds category as unsourced.
