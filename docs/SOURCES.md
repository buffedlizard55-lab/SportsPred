# Sources and their verification status

Every source this project uses or considered, with what was actually observed
and when. "Verified" means a response was received and read in this environment
on the stated date — not that the source is generally reliable.

All checks below were run on **2026-08-31**.

---

## Verified — used

### OLBG tennis tips index
- **URL:** <https://www.olbg.com/betting-tips/Tennis/3>
- **Fetched:** 2026-08-31 00:12 UTC
- **Provides:** match pairs, kickoff labels (`Today` / `Tomorrow` / `01 Sept`),
  kickoff times, `event_id`, the tipster consensus selection and its market,
  tip counts and percentages, comment counts, expert flags.
- **Method:** HTTP GET of server-rendered HTML. No JavaScript execution was
  needed to read any of the above.
- **Used for:** `data/slate.json`.
- **Note:** the wrong path `/betting/tips/Tennis` returns an empty page. The
  correct path is `/betting-tips/Tennis/3`.

### OLBG event pages
- **Example:** <https://www.olbg.com/betting-tips/Tennis/All_Tennis/All_Events/Roman_Safiullin_vs_Carlos_Alcaraz/3?event_id=899350>
- **Fetched:** 2026-08-31 00:12 UTC
- **Provides:** the full market list for one match — `Win Match`,
  `Set Betting`, `1st Set Winner`, `Games Won`, `Total Games` — with the
  selection available under each, and the Games Won handicap labels
  (`Carlos Alcaraz -5.50`, `Roman Safiullin +5.50`).
- **Note:** the market list was verified on **one** event page only. It is not
  asserted for the other 19 matches in the snapshot. The collector fetches each
  event page and marks `markets_verified` per row.

### OLBG all-events index
- **URL:** <https://www.olbg.com/betting-tips/Tennis/All_Tennis/All_Events/3>
- **Status:** referenced as a collector target. Not separately captured in this
  session, so its exact structure is unverified.

### GitHub API
- **URL:** `https://api.github.com/users/JeffSackmann/repos`
- **Fetched:** 2026-08-31
- **Returned:** exactly one public repository, `tennis_MatchChartingProject`
  (updated 2026-08-30, pushed 2026-05-25).
- **Used for:** establishing that the Sackmann match CSVs are no longer public.

---

## Checked and rejected

| Source | Result | Consequence |
|---|---|---|
| `github.com/JeffSackmann/tennis_atp` | **404** over both the HTML and `raw.githubusercontent.com` paths | Form, surface, serve and H2H factors have no source. `IR-02` |
| `github.com/JeffSackmann/tennis_wta` | **404** | Same |
| `ultimatetennisstatistics.com/api` | **404** (`Object Not Found`) | No JSON API at that path |
| `ultimatetennisstatistics.com/stats` | **404** | — |
| OLBG structured odds | **Not present in HTML** | Prices are client-side only. `IR-01` |

Third-party aggregators (`matchstat.com`, `tennisratio.com`, `tennisstats.com`)
appeared in search results with the required statistics. They were **not** used:
they are unlicensed scrapes of official data, their figures disagree with each
other, and building on them would undermine the "official verified sources"
requirement.

---

## Considered and not attempted

| Source | Why not |
|---|---|
| X / Twitter sentiment | Paid API; scraping breaches the terms of service. The prompt asks for this. `IR-13` |
| Injury reporting | No free structured source exists |
| The Odds API, Betfair | Require an API key, which conflicts with "no manual input". Declared as adapters in `scripts/collect_players.py`, ready for a repository secret |

---

## Official sources referenced but not reachable from here

These are the correct authoritative sources and are linked from the site, but no
request to them succeeded from this environment (see the environment note below).
They are listed as **unverified**, not as working.

- ATP Tour — <https://www.atptour.com/> (schedule, rankings, results)
- WTA Tennis — <https://www.wtatennis.com/> (schedule, rankings, results)

---

## Environment note

Every direct HTTP request issued from the build sandbox failed with no response
at all (connection code `000`) for `olbg.com`, `raw.githubusercontent.com`,
`atptour.com`, `wtatennis.com` and `ultimatetennisstatistics.com`. The pages
above were retrieved through a hosted page-fetch facility that does have egress.

Consequences, stated plainly:

- `data/slate.json` was transcribed field by field from a live fetch. It is real
  data, but the transcription was done by hand, so `scripts/collect_olbg.py`
  re-derives it and the two are cross-checked.
- The collectors cannot be exercised against the live network here. Their parser
  logic is unit-tested; the fixture is **reconstructed**, not captured. The
  first CI run with `--save-html` produces a genuine capture that should replace
  it. `IR-03`

---

## Attribution

OLBG content is used here as a factual fixture and market listing, with a link
back to the originating page on every row. If OLBG objects to this use the
collector can be pointed at ATP/WTA and an odds provider instead; nothing in the
engine depends on OLBG specifically.
