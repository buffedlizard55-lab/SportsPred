# F1 Irregularity Register

Every gap, limitation and safeguard in the Formula 1 layer. The rule this
project runs on is that a factor nobody publishes is **recorded as missing and
scored as a penalty**, never estimated. This register is the list of those
gaps, so a reviewer can see exactly what the model does not know.

Machine-readable counterparts live in `data/provenance.json` and in the
`missing[]` array attached to every scored market in `data/f1_predictions.json`.

---

### IR-F1-01: No key-less odds source exists for Formula 1
- **Observation:** The master prompt's scoring tables reference market prices
  (e.g. "market favourite", implied probability). No bookmaker publishes an
  odds feed without a commercial key, and OLBG's server HTML carries tipster
  counts but no prices.
- **Handling:** Odds are **not** synthesised from any proxy. Every market that
  the prompt prices carries `missing: ['odds (no key-less source)']`, which
  caps that market's confidence at MEDIUM — a HIGH band is unreachable on
  partial data by construction (`bandFromScore`). OLBG consensus percentages
  are displayed next to the pick as context and are never scored.

### IR-F1-02: Race-day fastest lap is not published per race
- **Observation:** ESPN publishes each circuit's all-time lap record
  (`fastestLapTime`, `fastestLapYear`, `fastestLapDriver`) but no per-race
  fastest-lap setter, and no free source publishes one.
- **Handling:** The `fastest_lap` market is emitted with the sentinel band
  `UNSCORED` rather than a guess, and the backtest reports it as an explicit
  unscored row (this is why `f1_backtest.json.summary` has five rows for four
  scored markets). The engine additionally forces `SKIP` when no pit-strategy
  evidence exists, so the market can never be published on vibes.

### IR-F1-03: A finished race with no published classification
- **Observation:** A race can be over while ESPN has not yet published a
  classification (timing delays, provisional results pending stewards).
- **Handling:** An event is published as `state: 'post'` **only** when a
  finishing order actually exists. A finished-but-unclassified race stays
  `pre`, is stamped `resultUnavailable: true`, and is listed under
  `unclassified_finished_races` in `data/f1_events.json` for review. The site
  therefore never shows a completed race with an empty result.

### IR-F1-04: Completion status is not in the core API
- **Observation:** The `sports.core.api.espn.com` competitions payload exposes
  session status only as a `$ref` — there is no inline `state` or `completed`
  field. An earlier collector read completion from that payload, so **every**
  race stayed `pre` and no result was ever recorded.
- **Handling:** Completion is taken from the **site** scoreboard, which carries
  inline `status.type.state` (`pre`/`in`/`post`) and `completed`. Core data is
  still used for competitor detail (grid via `startOrder`, vehicle, winner).
  For history seasons, whose year-range queries omit the status block, an event
  is treated as finished when the race date has passed **and** ESPN already
  publishes a classified `order` — a read of published data, not an assumption.
  Locked by regression tests in `tests/f1_espn.test.mjs`.

### IR-F1-05: Circuit identity is a `$ref`, not a field
- **Observation:** The event payload has no `circuitId`; it has
  `circuit.$ref`. An earlier collector read the non-existent field, so every
  event stored `circuitId: null` and no circuit facts were ever attached.
- **Handling:** Circuit and venue ids are parsed out of the `$ref` URLs by
  `parseCoreEvent`, then resolved against the circuits endpoint. An absent
  circuit stays `null` and is reported — never back-filled from a name guess.

### IR-F1-06: Circuit classifications are prompt-derived, not measured
- **Observation:** The prompt names low-overtaking venues (Monaco, Hungary,
  Zandvoort), power-sensitive venues (Monza, Baku, Spa) and "street circuits
  and Spa" for safety-car frequency. No free source publishes an overtaking
  difficulty index or a safety-car frequency rate.
- **Handling:** These are applied as **classifications from the prompt**, keyed
  to ESPN's verified abbreviations (`MCO`, `HUN`, `NLD`; `ITA`, `AZE`, `BEL`),
  and are documented as such rather than presented as measured data. When a
  circuit code is unknown the flags are `null` and the dependent modifier is
  recorded as missing rather than silently treated as "no". An earlier build
  used invented codes (`MON`, `ZAN`) that match nothing in ESPN's list, which
  disabled the adjustments entirely; `tests/f1_engine.test.mjs` now pins the
  codes.

### IR-F1-07: Grid position does not exist before qualifying
- **Observation:** Most of the prompt's biggest modifiers (grid position, front
  row, dark horse) require a starting grid, which does not exist until
  qualifying finishes — typically the day before the race.
- **Handling:** Before qualifying, grid-dependent components are emitted with
  `points: 0`, `missing: true` and their `max` retained, so the shortfall is
  visible in the component breakdown and drags the confidence band down. The
  card labels the race card "pre-qualifying" so a reader knows why confidence
  is capped. Grid is read from `startOrder` on the race competition (**not**
  from qualifying `order`, which is the qualifying classification).

### IR-F1-08: Tyre, pit-strategy and upgrade data are unavailable
- **Observation:** The prompt scores tyre strategy, undercut sophistication and
  car-upgrade packages. No key-less source publishes compounds, stint plans,
  pit-lap timing, or upgrade announcements.
- **Handling:** Recorded as named missing factors
  (`teamStrategySOPHISTICATION`, `upgrades`, `tyreStrategy`) on every affected
  market. `pitsTaken` from the statistics endpoint is the only real pit datum
  available and is used descriptively, not as a strategy proxy.

### IR-F1-09: DNF is only ever read from an explicit status
- **Observation:** It is tempting to infer a retirement from a low lap count.
- **Handling:** `dnf` is set only when the per-driver status endpoint returns a
  retired/not-classified state. If that fetch fails, `dnf` stays `null` and the
  row is left untouched — a failed request must never be read as "finished".
  Reliability scoring treats `null` as missing, not as a clean race.

### IR-F1-10: History depth is one prior season
- **Observation:** Deep per-driver status and statistics are fetched only for
  the current season; the default history sweep is the single prior season.
- **Handling:** This is a deliberate request-budget decision, not a data gap
  being hidden. History seasons therefore carry grid, finishing order, team and
  pole (derived from the completed qualifying session's order) but leave
  `pointsEarned` `null`. Track-suitability factors that need more history are
  reported as missing. Widen with `--history-seasons`.

### IR-F1-11: Team identity comes from `vehicle.manufacturer`
- **Observation:** ESPN's F1 feed has no constructor entity on the competitor;
  the team name is the vehicle manufacturer string.
- **Handling:** Used as-is, unnormalised, so it always matches what ESPN shows.
  Constructor standings are matched to it by exact name; an unmatched team is
  reported rather than fuzzy-matched into the wrong constructor.

### IR-F1-12: Sprint weekends run two qualifying sessions
- **Observation:** Sprint weekends add a Sprint Shootout, so "qualifying
  result" is ambiguous.
- **Handling:** The context builder flags `isSprintWeekend` from the session
  list. Grid for the grand prix is always taken from the **race**
  competition's `startOrder`, which is unaffected by the sprint, so the
  ambiguity cannot leak into scoring.

### IR-F1-13: The sandbox cannot reach the data sources
- **Observation:** Outbound TLS to `site.api.espn.com` and `www.olbg.com` fails
  from the development sandbox (`SSL_ERROR_SYSCALL` / `ECONNRESET`).
- **Handling:** All collection runs in GitHub Actions
  (`.github/workflows/f1-collect.yml` on push, and the scheduled
  `collect.yml`), which commits refreshed `data/` back to the branch. Local
  work runs against committed real payloads and captured fixtures. Each
  collector step is `continue-on-error` and emits a warning annotation, so a
  single failing source degrades that section instead of publishing stale data
  as fresh.
