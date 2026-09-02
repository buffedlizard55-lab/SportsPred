# F1 Sources — verified, key-less, manually reviewable

Every Formula 1 field on this site comes from one of the endpoints below. Each
was fetched live and inspected before being used. Nothing on the F1 pages is
estimated, interpolated, or inferred: a factor that no source publishes is
recorded in `missing[]` and scored as a penalty (see `F1_IRREGULARITIES.md`).

**Environment note.** The development sandbox cannot open TLS connections to
`site.api.espn.com` or `www.olbg.com` (`SSL_ERROR_SYSCALL`). All live
verification was therefore done through a hosted fetch, and all collection runs
in GitHub Actions (`.github/workflows/f1-collect.yml`,
`.github/workflows/collect.yml`). This is the same constraint recorded for
tennis in `SOURCES.md`.

---

## 1. ESPN Formula 1 — public JSON, no API key

ESPN operates undocumented but public, CORS-enabled JSON endpoints that power
espn.com. They require no key and no account.

| Purpose | Endpoint | Verified |
|---|---|---|
| Season calendar + per-day sessions | `https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard?dates=YYYYMMDD` | 2026-09-02 |
| Full-season sweep (history) | `.../scoreboard?dates=YYYY0101-YYYY1231` | 2026-09-02 |
| Driver + constructor standings | `https://site.api.espn.com/apis/v2/sports/racing/f1/standings` | 2026-09-02 |
| Event detail (circuit ref, defending champion) | `https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/events/{eventId}` | 2026-09-02 |
| Session list w/ grid + vehicle | `.../events/{eventId}/competitions` | 2026-09-02 |
| Per-driver finishing status (DNF) | `.../competitions/{compId}/competitors/{athleteId}/status` | 2026-09-02 |
| Per-driver race statistics | `.../competitions/{compId}/competitors/{athleteId}/statistics` | 2026-09-02 |
| Circuit facts + lap record | `.../circuits/{circuitId}` | 2026-09-02 |

Human-readable review links (open these to check any figure by hand):

- Season hub — <https://www.espn.com/f1/schedule>
- Standings — <https://www.espn.com/f1/standings>
- A race — `https://www.espn.com/f1/race/_/id/{eventId}` (each event object in
  `data/f1_events.json` carries this under `sources.espnEvent`)

### Fields ESPN actually publishes

Verified against the Dutch GP (event `600057441`, competition `401839097`) and
the standings payload:

- **Session competitors** — `order` (classification in that session),
  `startOrder` (grid), `winner`, `vehicle.number`, `vehicle.manufacturer`
  (used as the team name), `vehicle.teamColor`.
- **Status** — `STATUS_CLASSIFIED`, `STATUS_RETIRED`, `STATUS_FINAL`. A DNF is
  recorded **only** when the status endpoint says retired/not classified; an
  absent status stays `null` and is never read as "finished".
- **Statistics** — `place`, `wins`, `pole`, `top5`, `top10`, `lapsCompleted`,
  `lapsLead`, `pitsTaken`, `championshipPts`, `bonus`, `penaltyPts`,
  `totalTime` (`displayValue` like `2:04:44.859`).
- **Standings** — `rank`, `championshipPts`, `topFinish`, plus per-race points
  keyed by the event id and stamped `played: true|false`.
- **Circuit** — `fullName`, `address.city`, `address.country`, `length`,
  `laps`, `turns`, `direction`, `established`, `fastestLapTime`,
  `fastestLapYear`, `fastestLapDriver` (a `$ref`), circuit diagrams.

### Verified circuit abbreviation list

The standings payload publishes the canonical 2026 code list, which the engine
uses as circuit identity:

```
AUS CHN JPN BRN SAU MIA CAN MCO BAR AUT GBR BEL HUN NLD ITA
ESP AZE MYS SGP USA MEX BRA LAS QAT UAE
```

This matters: the prompt names venues in prose ("Monaco, Hungary, Zandvoort";
"Monza, Baku, Spa"). Those map to **MCO, HUN, NLD** and **ITA, AZE, BEL**.
Earlier drafts of the engine used invented codes (`MON`, `ZAN`) that never
match ESPN, which silently disabled every F1-specific adjustment; that is now
locked by a regression test in `tests/f1_engine.test.mjs`.

### What ESPN does **not** publish

No odds. No per-race fastest-lap setter (only the circuit's all-time lap
record). No tyre compounds, no pit-lap timing, no overtake counts, no upgrade
packages. These are all recorded as missing factors — see
`F1_IRREGULARITIES.md`.

---

## 2. OLBG — Motor Racing tips index

Only one F1 path resolves. `Formula_1/`, `F1/` and `Motor_Racing/` (without the
id) all return 404.

| Purpose | URL |
|---|---|
| Motor Racing index (sport id 14) | <https://www.olbg.com/betting-tips/Motor_Racing/14> |
| All events, fullest listing | <https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/14> |
| A single event | `https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/{Slug}/14?event_id={id}` |
| Sport/slug directory | <https://www.olbg.com/sitemap-betting-tips.xml> |

Observed F1 rows (2026-09-02), each reviewable at the URL above:

| event_id | Event | Market | Consensus |
|---|---|---|---|
| 899 | Italian Grand Prix | Fastest Qualifier | Lando Norris, 7/14 tips (50%) |
| 900 | Italian Grand Prix | Win Race | Lando Norris, 6/19 tips (32%) |
| 827 | F1 Constructors Championship 2026 | Win Tournament | Mercedes, 14/32 tips (44%) |
| 828 | F1 Drivers Championship 2026 | Win Tournament | Max Verstappen, 9/27 tips (33%) |

Sport ids confirmed from the sitemap: Motor_Racing=14, Tennis=3, Cricket=7,
Handball=20.

**How OLBG is used.** Tipster consensus counts are *displayed only*. They are
never fed into scoring — they are a crowd tally, not a price, and treating them
as one would be exactly the kind of invention this project forbids. The event
pages also publish factual track history (past winners, past fastest laps),
which is parsed only from explicit headings and cross-checked against ESPN
where both publish the same fact.

---

## 3. Open-Meteo — race-day weather

Free, key-less, documented.

- Geocoding — `https://geocoding-api.open-meteo.com/v1/search?name={city}`
- Forecast — `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max&timezone=UTC&start_date={d}&end_date={d}`

Weather is the only external data point the master prompt permits in the
written output. It is used for the weather-impact note and the >30% rain
"weather-dependent" flag. Every stored forecast keeps its own `sourceUrl` and
`geocodeUrl` in `data/f1_weather.json` for manual review.

---

## 4. Rejected sources

- `https://www.formula1.com/en/results/2026/drivers.html` — returns 404. Not
  used for anything.
- Any bookmaker odds feed — none is available key-less. The engine does not
  substitute a proxy; see IR-F1-01.
