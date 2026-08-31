# Sources and their verification status

Every source this project uses or considered, with what was actually observed
and when. "Verified" means a response was received and read in this environment
on the stated date — not that the source is generally reliable, and not that it
is necessarily usable for a given purpose.

All checks below were re-run on **2026-08-31**.

---

## Verified — used

### ESPN public tennis API — PRIMARY LIVE SOURCE
- **Scoreboard:** `https://site.api.espn.com/apis/site/v2/sports/tennis/{atp|wta}/scoreboard?dates=YYYYMMDD`
- **Rankings:** `https://site.api.espn.com/apis/site/v2/sports/tennis/{atp|wta}/rankings`
- **Tournaments:** `http://sports.core.api.espn.com/v2/sports/tennis/leagues/{atp|wta}/events?dates=YYYYMMDD-YYYYMMDD`
- **Fetched:** 2026-08-31. No API key, no signup, no auth header of any kind.
- **Provides:** tournament and match identity, scheduled start, live/final
  status, per-set linescores with tiebreak detail, winner flags, round labels,
  seeds, venue city, `indoor` flag; and current rank, previous rank and points
  per player.
- **Used for:** the entire live scoreboard, results, calendar and every
  form/rank/surface-split statistic the engine consumes.
- **Status:** ESPN retired its public developer programme; these are the
  undocumented endpoints that serve espn.com itself. They are open and widely
  used, but **unofficial and unversioned** — ESPN can change them without
  notice. `scripts/verify_live.mjs` exists precisely to detect that breakage,
  and the parsers are pinned by tests against a captured excerpt.
- **Verified NOT to provide:**
  - **odds** — `…/competitions/{id}/odds` returns `{"count":0,…,"items":[]}` (`IR-01`)
  - **serve statistics** — every competitor carries `"statistics": []` (`IR-16`)
  - **court surface** — no surface field exists anywhere in the payload
- **Observed irregularity:** the ATP scoreboard returns Women's Singles
  groupings (Nordea Open, competition `178684`). The league slug is therefore
  not a reliable tour label (`IR-19`).

### OLBG tennis tips index
- **URL:** <https://www.olbg.com/betting-tips/Tennis/3>
- **Fetched:** 2026-08-31 (hosted page-fetch; the build sandbox cannot reach
  `olbg.com` directly — see the environment note at the bottom).
- **Provides:** match pairs, kickoff labels (`Today` / `Tomorrow` / `01 Sept`),
  kickoff times, `event_id`, the tipster consensus selection and its market,
  tip counts and percentages, comment counts, expert flags.
- **Used for:** `data/slate.json`.
- **Verified against the snapshot:** the live page on 2026-08-31 lists the same
  matches as `data/slate.json`. Tipster consensus numbers drift in real time
  (e.g. Tsitsipas v Fils was 2/4 for Tsitsipas at snapshot time and 3/5 for
  Fils at re-check) — expected behaviour for a vote-count page, and the reason
  the collector must refresh rather than treat the snapshot as fixed.

### OLBG event pages (market list)
- **Example:** <https://www.olbg.com/betting-tips/Tennis/All_Tennis/All_Events/Roman_Safiullin_vs_Carlos_Alcaraz/3?event_id=899350>
- **Provides:** the market list per match — `Win Match`, `Set Betting`,
  `1st Set Winner`, `Games Won`, `Total Games` — and the Games Won handicap
  labels (e.g. `Carlos Alcaraz -5.50`, `Roman Safiullin +5.50`).
- **Caveat, unchanged:** the market list was verified on **one** event page.
  It is not asserted for every other match; the collector fetches each event
  page and marks `markets_verified` per row.
- **No structured odds.** Prices are injected client-side into the betslip and
  are absent from server-rendered HTML. See `IR-01`.

### Sackmann tennis dataset — verified mirrors
The canonical repositories (`JeffSackmann/tennis_atp`, `tennis_wta`) are gone
(see "checked and rejected"). Two forks/archives of the same dataset were
verified reachable and are used **for historical backtesting only**:

- **Kadantte/tennis_atp** — <https://github.com/Kadantte/tennis_atp>
  - Fork of the deleted Sackmann ATP repo. Verified 2026-08-31 via the GitHub API.
  - Contains `atp_matches_1968.csv` … `atp_matches_2026.csv`,
    `atp_rankings_current.csv` and `atp_rankings_20s.csv` etc.
  - Last match date observed: **2026-05-25**; last ranking date: **2026-06-08**.
  - `atp_players.csv` is present but **empty** in this fork.
- **Aneeshers/tennis-sackmann-archive** — <https://github.com/Aneeshers/tennis-sackmann-archive>
  - "Archival mirror of Jeff Sackmann's tennis datasets" (473 files, `atp/` +
    `wta/` + `slam_pointbypoint/`). Verified 2026-08-31.
  - ATP and WTA matches through **2026-05-25**; rankings through **2026-06-08**.
  - Ships the original **LICENSE**: Creative Commons Attribution-NonCommercial-
    ShareAlike 4.0 (CC BY-NC-SA 4.0), requiring attribution to Jeff Sackmann.
- **Used for:** `scripts/backtest_historical.mjs` (2024–2025 ATP walk-forward
  backtest) **and** `scripts/build_surface_map.mjs`, which derives each
  tournament's court surface and tour level from the `surface` / `tourney_level`
  columns of 14,133 recorded match rows. Not used for live form, because the mirrors are a snapshot
  (~3 months behind on 2026-08-31) and there is no current-season live feed in
  them. See `IR-02` / `IR-14`.

### GitHub API
- **URL:** `https://api.github.com/repos/{owner}/{repo}/contents/{path}` and
  `https://api.github.com/search/repositories?q=…`
- **Fetched:** 2026-08-31 (reachable from the build sandbox — unlike
  `raw.githubusercontent.com`).
- **Used for:** verifying the mirrors above and for downloading the backtest
  CSVs.

---

## Checked and rejected / unreachable for machine use

| Source | Result | Consequence |
|---|---|---|
| `github.com/JeffSackmann/tennis_atp` | **404** (re-verified 2026-08-31) | Original repo gone; use the verified mirrors for history. `IR-02` |
| `github.com/JeffSackmann/tennis_wta` | **404** | Same |
| ATP rankings page `atptour.com/en/rankings/singles` | Reachable as a web page, but the ranking table is **client-side rendered** — no rows in the server response | Not machine-parseable without a headless browser. `IR-02` |
| WTA rankings page `wtatennis.com/rankings/singles` | Same: JS-rendered, no rows server-side | Same |
| `atptour.com/en/-/www/rankings/singles?...` | **404** — no such JSON endpoint at that path | No undocumented JSON endpoint assumed; none is used |
| OLBG structured odds | **Not present in server-rendered HTML** | `IR-01` |

Third-party aggregators (`matchstat.com`, `tennisratio.com`, `tennisstats.com`)
and paid API marketplaces (RapidAPI "Tennis API", Zylalabs "ATP Ranking Data
API", etc.) appeared in search results with the required statistics. They were
**not** used: the aggregators are unlicensed scrapes whose figures disagree
with each other, and the APIs require keys that violate the "free, no manual
input" constraint.

---

## Considered and not attempted

| Source | Why not |
|---|---|
| X / Twitter sentiment | Paid API; scraping breaches the terms of service. `IR-13` |
| Injury reporting | No free structured source exists |
| The Odds API, Betfair Exchange | Require an API key — conflicts with "no manual input". Declared as adapters in `scripts/collect_players.py`, ready for a repository secret |

---

## Environment note

Direct HTTP requests from the build sandbox succeed only for
`api.github.com` and `github.com`. They fail (connection code `000`) for
`olbg.com`, `raw.githubusercontent.com`, `atptour.com`, `wtatennis.com` and
`*.github.io`. Pages on those hosts were retrieved through the hosted
page-fetch facility, which has egress. Consequences:

- The OLBG collectors cannot be exercised against the live network *from the
  sandbox*; they are unit-tested against saved fixtures and are expected to run
  in GitHub Actions, whose runners have normal egress.
- The historical backtest downloads its CSVs over the GitHub API (reachable in
  both places), so it runs here and in CI.

---

## Attribution

- Sackmann mirror data is CC BY-NC-SA 4.0 and attributed to Jeff Sackmann
  (see the archive LICENSE). The project is non-commercial research.
- OLBG content is used as a factual fixture and market listing, with a link
  back to the originating page on every row. If OLBG objects, the collector can
  be pointed at ATP/WTA and an odds provider instead; nothing in the engine
  depends on OLBG specifically.
