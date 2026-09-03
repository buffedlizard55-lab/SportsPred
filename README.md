# SportsPred

A multi-sport scoreboard, OLBG market directory and source-linked prediction
engine, built around one rule: **nothing is published without a source.**

**Live site:** <https://buffedlizard55-lab.github.io/SportsPred/>
**Local preview:** `npm run serve` then open <http://localhost:8000>.

## What the site is

| Page | What it does |
|---|---|
| [`index.html`](index.html) | Hub. Every OLBG sport as a tile, today's cross-sport card, jump-off points. |
| [`sport.html?sport=…`](sport.html) | Per-sport scoreboard. Date strip + month calendar, leagues grouped, past results / live / upcoming, per-match analysis panel. |
| [`predictions.html`](predictions.html) | Cross-sport generator. One button, every upcoming match on the slate, each tip copy-pasteable with a confidence score. |
| [`markets.html`](markets.html) | The OLBG directory — all 22 sports, their index URLs, whether this site predicts them or only links them for review. |
| [`sources.html`](sources.html) | Every feed, per sport, with the official governing-body link; the machine-verification report; the irregularity register. |
| [`method.html`](method.html) | The method, the facts-vs-hyperparameters split, the output rules, and the backtest. |
| [`pro.html`](pro.html) | The specialist engine console (cricket · handball · tennis · F1) with the per-sport master prompts. |
| [`greyhounds.html`](greyhounds.html) | Greyhound racing: daily GBGB racecards, results and month calendar with form/trap/distance/grade analysis and the written WIN tips generated per the GREYHOUND RACING PREDICTION MASTER PROMPT v1.0. |
| [`volleyball.html`](volleyball.html) | FIVB Volleyball Nations League — Women scoreboard and source-gated MATCH WINNER / SET SCORE card, with a separate OLBG market monitor. Non-VNL volleyball is never used as VNL evidence. |
| [`golf.html`](golf.html) | Golf: PGA TOUR / DP World Tour / LPGA / Champions leaderboards and calendars, and the six-market golf card (outright, top six, first round leader, top European, top American, top British & Irish) generated for every men's-tour event on the board. |
| [`snooker.html`](snooker.html) | Snooker: match scoreboard + month calendar over the OLBG market slate joined to the official WST ranking table and the public snooker.org results database. 100-point scoring (odds, form, H2H, ranking, stage) and 25-40 word written predictions per the SNOOKER PREDICTION MASTER PROMPT v3.0; no free price feed exists, so the odds factor is honestly recorded as missing and live bets resolve to SKIP. |
| [`darts.html`](darts.html) | Darts: match scoreboard + month calendar over the OLBG market slate joined to the public PDC Order of Merit and a committed, source-tagged European Tour results tape. 100-point scoring (odds, form, 3-dart average, H2H, Order of Merit, stage) and 25-40 word written predictions per the DARTS PREDICTION MASTER PROMPT v1.0; no free price feed exists, so the odds factor is honestly recorded as missing and live bets resolve to SKIP. Unpublished Czech Open pairings are never invented. |
| [`ice-hockey.html`](ice-hockey.html) | Ice hockey: scoreboard + month calendar over the NHL fixture list, scored by the ICE HOCKEY PREDICTION MASTER PROMPT v1.0. Three markets per match (outright winner, puck line, game total) behind a subagent risk layer that vetoes any play resting on an unsourced input. Fixtures, standings and goaltending from the official NHL API, prices from the ESPN odds block, OLBG slate for market context. |
| [`baseball.html`](baseball.html) | Baseball: scoreboard + month calendar over the MLB fixture list, scored by the BASEBALL PREDICTION MASTER PROMPT v1.0. Three tips per match (WIN MATCH OUTRIGHT, RUN LINE, GAME TOTAL) each with a confidence score, generated on load and re-scored by the Generate button with no network needed. Fixtures, results, standings, team batting/pitching stats and probable starters come from the official MLB StatsAPI; the ESPN scoreboard supplies venue/weather context; the OLBG slate is display-and-join context. No free key-less MLB price feed exists, so the odds factor is recorded as missing rather than guessed, and bullpen ERA rank/usage and wind are likewise reported missing (`docs/BASEBALL_SOURCES.md`, `docs/BASEBALL_IRREGULARITIES.md`). |
| [`npb.html`](npb.html) | Baseball → **NPB** sub-page (MLB \| NPB tabs on both pages): Nippon Professional Baseball scoreboard, month calendar and both league tables built from official npb.jp pages — English BIS calendars (results tape with draws and postponements) and standings, the Japanese schedule detail (予告先発 announced starters, venue, JMA forecast icon) and Japanese box scores (pitching lines). Scored by the NPB BASEBALL PREDICTION MASTER PROMPT v1.0: every match is assessed for a home win, an away win **and, independently, a draw** (12-inning limit), then run line and game total, with evidence floors so nothing reaches a verdict on unsourced blocks. No key-less three-way NPB price feed exists; the odds block, handedness splits, wind and import registrations are recorded as missing. The committed data was seeded from dated page captures and is replaced by the `npb-collect` workflow (`docs/NPB_SOURCES.md`, `docs/NPB_IRREGULARITIES.md`). |

Every sport is reachable from the rail in the masthead on every page.

## Coverage

20 OLBG sports are catalogued in [`engine/registry.js`](engine/registry.js).
For each, the registry records the OLBG index id and slug, the official
governing-body links, and — where one exists — the key-less ESPN feed and its
candidate leagues.

Sports with a structured feed are **predicted**. Sports without a usable
statistics feed (horse racing, Gaelic football, cycling, boxing) are
**listed and linked for manual review** and produce no output at all. Snooker
is predicted on its own page from the OLBG slate, the official WST ranking
table and the public snooker.org results database — the odds factor is the one
unsourced input, recorded as missing rather than guessed
(`docs/SNOOKER_SOURCES.md`, `docs/SNOOKER_IRREGULARITIES.md`). Darts is predicted
on its own page from the OLBG slate, the public PDC Order of Merit snapshot and
a committed Wikipedia-sourced European Tour results tape — averages are stored
only when printed, unpublished pairings are never invented, and the odds factor
is recorded as missing (`docs/DARTS_SOURCES.md`, `docs/DARTS_IRREGULARITIES.md`).
Golf is an outright
sport, so it bypasses the two-competitor universal engine and runs on its own
specialist page (`golf.html`) driven by the GOLF TOURNAMENT PREDICTION MASTER
PROMPT v1.0 (`docs/GOLF_MASTER_PROMPT.md`). Greyhounds likewise run on their
own page (`greyhounds.html`) driven by the GREYHOUND RACING PREDICTION MASTER
PROMPT v1.0 over the **official GBGB results API** (meetings, draws, results
and per-dog form histories) with the Sporting Life racecard index for
meeting enumeration and the OLBG slate as display-only context
(`docs/GREYHOUND_SOURCES.md`, `docs/GREYHOUND_IRREGULARITIES.md`). Aussie
Rules and eSports carry OLBG tipster content but no market feed we can reach.
That split is stated on [`markets.html`](markets.html) per sport, not buried.

## The universal engine

For any two-competitor sport, the flow is:

    ESPN scoreboard  →  parse  →  measure league baseline  →  score signals
                     →  de-vig and blend the published price  →  confidence + cap
                     →  write  →  validate  →  publish or withhold

Six signals (league baseline, form, season record, ranking, head-to-head, rest),
four markets (result, double chance, handicap, total), hard confidence caps when
evidence is missing, and a writer that can only reference signals the engine
actually sourced. Full line-by-line review:
[`docs/UNIVERSAL_ENGINE.md`](docs/UNIVERSAL_ENGINE.md).

**Odds are now available.** ESPN republishes a sportsbook's moneyline, spread
and total inside the scoreboard payload, which retires the long-standing
"no key-less odds feed" blocker for the universal engine. It is one book
(DraftKings), not a consensus — attributed everywhere it is shown, and recorded
as `U-03`.

## Speed

The site is static. Nothing heavyweight runs at load:

- Per-league baselines and the backtest are **precomputed in CI**
  (`.github/workflows/precompute.yml`) and committed as JSON.
- [`assets/js/data-client.js`](assets/js/data-client.js) memoises every fetch in
  memory and in `localStorage` with age-appropriate TTLs (live 45s, today 3m,
  future 30m, past 24h), de-duplicates concurrent requests, and serves stale
  data instantly while revalidating.
- Requests are pooled so switching sport fires a bounded number of parallel
  fetches, not one per league serially.

## Verification

```bash
npm run verify:all
```

runs, in order:

| Check | What it proves |
|---|---|
| `node --test tests/*.test.mjs` | 408 Node tests — engines, parsers, writers, registry, plus 27 jsdom tests that boot each real page and click the buttons |
| `python3 -m unittest discover -s tests` | 59 Python tests — collectors and parsers |
| `node scripts/verify_site.mjs` | Static site audit: every page's module import graph, every `$('#id')` resolves to an id that page actually has, id uniqueness, every local `href`/`src` exists on disk, external links are https and carry `rel=noopener`, every JS parses, every JSON parses |
| `python3 scripts/build_data.py --strict` | The committed data layer is internally consistent |

The DOM suite is the answer to "does the button work" — it asserts that clearing
the results and clicking Generate repopulates them, that the analysis panel
exposes the written tip, the price attribution, the market table, at least two
https review links, and an explicit list of what could not be sourced.

## What the first live run measured (2026-09-02)

The three builders ran for the first time in CI and produced real numbers, not
assumptions. Two of those numbers contradicted things this repository had
previously assumed, and both are now recorded rather than smoothed over:

- **96 endpoints checked, 95 live.** The one failure, `soccer/kor.1` (Korean K
  League 1), returns HTTP 400 and is absent from ESPN's full 218-league soccer
  index — it was never a valid slug. Removed from the registry and logged as
  `U-11`, with a test that fails if any endpoint the verifier proved dead is
  still listed. The follow-up run is **95 of 95 clean**.
- **90 leagues measured, 55 with enough history** for a baseline. The other 35
  are out of season or cup competitions; they get no baseline, no HIGH-confidence
  tip is possible for them, and the split is published (`U-12`).
- **1214 graded predictions over 120 days.** Hit rate by confidence band is
  **monotonic** — HIGH 64.1%, MEDIUM 61.8%, LOW 49.5% — which is the one thing a
  confidence scale must get right.
- **No ROI, and none is shown.** The repo had assumed the feed retains a closing
  price for finished matches. It does not: ESPN strips the odds block once an
  event is final, and *zero* of the 1214 graded fixtures carried a price. So the
  backtest grades the model probability only, the market-blend leg is untested by
  it, and `method.html` drops the ROI column and says why (`U-06`).

## Irregularities

Machine-readable: [`data/irregularities.json`](data/irregularities.json),
rendered at [sources.html#irregularities](sources.html#irregularities).
12 open or resolved entries, `U-01`…`U-12`, each with its effect on output and
its links. Prose registers per sport live in [`docs/`](docs/).

---

## The honesty constraint

The brief for this project was "no hallucinations, verify line by line". That is
implemented rather than promised:

1. **A factor with no source is never estimated.** It is recorded in the
   result's `missing[]` list and the score is reduced. The engine has no default
   value for anything.
2. **Unscoreable matches say so.** With no priced or ranked data, the engine
   returns an `UNSCORED` sentinel. The site shows "unscored" instead of a
   plausible-looking guess.
3. **Every point is traceable.** Each scored component records its rule id, the
   value that triggered it and the points awarded.
4. **Output rules are enforced, not requested.** `validateTip` rejects any tip
   containing a digit (so odds, lines and set scores cannot leak), any banned
   filler phrase, any repeated player name, any tip under 40 words, and any tip
   whose bolded outcome falls outside the first 20 words. A tip that fails is
   withheld and the violation is reported.
5. **What could not be verified is labelled.** See
   [`docs/SOURCES.md`](docs/SOURCES.md) and [`docs/IRREGULARITIES.md`](docs/IRREGULARITIES.md).

---

## Layout

```
engine/                 the model — pure functions, no I/O
  cricket_engine.js     Cricket Step 2 scoring (4 markets) + Step 3 rules
  cricket_writer.js     Cricket Step 4 tip writer + output-rule validator
  cricket_data.js       Cricket slate/fixtures -> scored & written card
  handball_engine.js    Handball Step 2 scoring + Step 3 rules
  handball_writer.js    Handball Step 4 writer + validator
  engine.js             Tennis Step 2 scoring and Step 3 decision rules
  writer.js             Tennis Step 4 tip writing and validator
  espn.js               ESPN payload parsers + player-stat derivation
  olbg.js               OLBG snapshot/date/market helpers for the site
  multi_sport.js        sport registry and shared configuration
  surface.js            tournament -> court surface, or null with a reason
  tournament.js         tour level / round coding, H2H orientation
  join.js               slate -> engine input; never fills a gap
  golf_engine.js        Golf Step 2 scoring (six markets) + Step 3 rules
  golf_writer.js        Golf Step 4 writer (five blocks, table, weather, RG) + validator
  golf_data.js          Golf results tape -> per-player profiles (leak-free)
  golf_card.js          Golf documents -> scored & written card
  golf_espn.js        ESPN golf / OWGR / PGA TOUR / ESPN-stats parsers
  greyhound_gbgb.js   GBGB official results API parsers (meetings, draws,
                      results, per-dog histories; trials excluded)
  greyhound_data.js   runner profiles from the results tape (trap/track/
                      distance/grade records, best/last times)
  greyhound_engine.js Greyhound Step 2 scoring (form 35, odds 25, trap &
                      distance 20, track/grade 20) + Step 3 card rules
  greyhound_writer.js Greyhound Step 4 tip writer + output-rule validator
  greyhound_card.js   slate -> scored & written WIN card; settlement
assets/js/
  golf-page.js          golf page controller (leaderboards, calendar, cards, button)
  golf-collector.js     live browser collection for golf from ESPN (no key)
  app.js                multi-sport controller (scoreboard, calendar, markets, copy)
  cricket-collector.js  live browser collection for cricket (scorepanel + summary)
  collector.js          live browser collection for tennis from ESPN (no key)
data/
  cricket_*.json        cricket fixtures / OLBG slate / provenance / predictions
  surfaces.json         tournament -> surface, built from recorded match rows
  slate.json            an OLBG slate snapshot, with source URL and fetch time
  players.json          player statistics + per-factor collection status
  predictions.json      append-only record of every selection made
  results.json          settled outcomes (empty — see IR-02)
  provenance.json       the irregularity register
  golf_*.json           golf events / results tape / OWGR / stats / weather / slate / backtest / provenance (built in CI)
scripts/
  collect_golf_espn.mjs golf events, results tape, OWGR, ESPN stats, PGA TOUR SG
  collect_golf_olbg.py  OLBG golf slate collector (stdlib only)
  collect_greyhound.mjs GBGB meetings/draws/results + dog histories; records
                        and settles forward picks (data/greyhound_*.json)
  collect_greyhound_olbg.py  OLBG greyhound slate collector (stdlib only)
  backtest_greyhound.mjs  walk-forward backtest over settled GBGB races
                        (official SP feeds the odds tier; PnL illustrative)
  collect_golf_weather.mjs  Open-Meteo four-day + round-one trend per event
  backtest_golf.mjs     golf walk-forward backtest + ledger
  data_changed.mjs      collector commit guard: exit 1 when only timestamps moved
  collect_cricket_olbg.py  OLBG cricket slate collector (stdlib only)
  collect_olbg.py       OLBG tennis/handball slate collector (stdlib only)
  record_cricket_predictions.mjs  cricket forward-collection ledger validation
  collect_players.py    statistics collector; refuses to write estimates
  record_predictions.mjs  forward collection
  backtest.mjs          grading of recorded picks: hit rate, Brier, log loss, ROI
  backtest_historical.mjs  walk-forward backtest on the Sackmann dataset mirror
  lib/historical.mjs    pre-match feature builder + grader (pure, tested)
  build_surface_map.mjs builds data/surfaces.json from the Sackmann mirrors
  verify_live.mjs       end-to-end live check against ESPN (exits 2 if unreachable)
  collect_espn.mjs      forward collection: record picks, settle finished matches
  build_data.py         data-layer validation (npm run build:data)
  serve.py              local preview server
.github/workflows/      installed Pages deploy + scheduled collection workflows
tests/                 408 Node tests + 59 Python tests
docs/
  LIVE_DATA.md          the live data architecture and what ESPN does not publish
  PROMPT_REVIEW.md      line-by-line review of the master prompt
  PROMPT_FEATURE_MATRIX.md  prompt line -> repo feature/status/source matrix
  SOURCES.md            every source with its verification status
  IRREGULARITIES.md     everything that did not check out
  BACKTEST.md           historical backtest method + results
  GOLF_MASTER_PROMPT.md the golf prompt (spec of record)
  GOLF_PROMPT_REVIEW.md prompt line -> code -> test, with every substitution named
  GOLF_FEATURE_MATRIX.md what the golf layer delivers and how it is proven
  GOLF_SOURCES.md       every golf endpoint, verified, with review links
  GOLF_IRREGULARITIES.md IR-GOLF-01..16
  SNOOKER_SOURCES.md    every snooker source, verified, with review links
  SNOOKER_IRREGULARITIES.md IR-SNOOKER-01..08
  SNOOKER_PROMPT_REVIEW.md prompt line -> code -> test, with every substitution named
  DARTS_SOURCES.md      every darts source, verified, with review links
  DARTS_IRREGULARITIES.md IR-DARTS-01..07
  DARTS_PROMPT_REVIEW.md prompt line -> code -> test, with every substitution named
  DARTS_MASTER_PROMPT.md the darts prompt (spec of record)
  ICE_HOCKEY_SOURCES.md every hockey endpoint, verified live, with review links
  ICE_HOCKEY_IRREGULARITIES.md IR-HOCKEY-01..07 + the four prompt conflicts found
  ICE_HOCKEY_PROMPT_REVIEW.md  prompt line -> code -> test for all three markets
  ICE_HOCKEY_FEATURE_MATRIX.md what the hockey layer delivers and how it is proved
```

The engine is imported directly by the browser **and** by the tests. There is no
copy of the scoring logic, so the site cannot drift from what is tested.

---

## Running it

```bash
npm test                                          # 404 tests: engines, writers, ESPN parsers, OLBG helpers, join, pipeline, DOM smoke
python3 -m unittest discover -s tests -p 'test_*.py'   # OLBG parsers
python3 scripts/build_data.py --strict            # validate the committed data layer
python3 scripts/serve.py 8000                     # local preview
node scripts/verify_live.mjs                      # live end-to-end check against ESPN
node scripts/build_surface_map.mjs                # rebuild the surface map
python3 scripts/collect_olbg.py --dry-run         # refresh the OLBG slate snapshot
node scripts/record_predictions.mjs               # forward collection
node scripts/backtest.mjs                         # grading report (recorded picks)
node scripts/backtest_historical.mjs              # walk-forward backtest (real data)
```

No third-party packages are required anywhere. The collectors are stdlib-only
and the site is plain ES modules with no build step.

---

## Current status — read this before trusting any output

The engine, the site, the **live collection** and the **historical backtest**
all work. What is available and what is not:

| Requirement | Status |
|---|---|
| Live fixtures, live scores, results | ✅ ESPN public API, no key |
| Current ATP/WTA rankings + trajectory | ✅ ESPN public API |
| Court surface per tournament | ✅ derived from 14,133 recorded match rows (349 tournaments) |
| Form, surface split, first-set rate, straight sets, rest, H2H | ✅ computed from a 120-day match tape |
| Tournament level and round | ✅ coded from recorded `tourney_level` data |
| Historical backtest | ✅ 2024–25 ATP walk-forward, 63.9% win-match hit rate |
| Forward collection + automatic result settlement | ✅ `scripts/collect_espn.mjs` records picks and grades them from ESPN |
| **Odds / prices** | ❌ **no free key-less source** — every price factor is unscored (`IR-01`) |
| **Serve %, ace rate** | ❌ ESPN ships empty tennis statistics (`IR-16`) |
| **Injuries, social sentiment** | ❌ no free structured source (`IR-13`) |

The consequence, stated plainly: **the site produces real predictions on real
matches, but with odds permanently unavailable the price-dependent factors are
scored as missing and confidence is capped accordingly.** Many first-set and
handicap selections will therefore read SKIP. That is the model refusing to bet
on evidence it does not have, not a bug — see `IR-18` for the one place where
this is more conservative than the prompt intends.

Full detail: [`docs/LIVE_DATA.md`](docs/LIVE_DATA.md).

To add odds, supply a key for The Odds API or Betfair and fill
`players[].odds` / `firstSetOdds` / `handicapOdds`; every odds rule in the
engine is already written and tested.

---

## Automation and deployment

This checkout now contains workflow files in `.github/workflows/`, with mirrored
copies in [`ci/`](ci/README.md):

- **`.github/workflows/collect.yml`** — every 30 minutes: run tests, refresh the
  OLBG slate, enrich event pages for market lists, collect/settle ESPN records,
  print the backtest report, and commit only when `data/` changed.
- **`.github/workflows/pages.yml`** — run the full test suite, validate the data
  layer, build a minimal Pages artifact, and deploy it with the official Pages
  Actions.

### What may still need a manual repository setting

The Pages site currently exists and was verified at:
<https://buffedlizard55-lab.github.io/SportsPred/>.

The workflow files are now present on this branch. The remaining manual step is
usually the repository Pages setting if it is still configured for **Deploy from
a branch** rather than **GitHub Actions**.

Step-by-step:

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Save the setting if GitHub prompts for confirmation.
5. Open the **Actions** tab and confirm the latest **Deploy site** run passed.
6. Re-open the Pages URL and verify the updated site content changed.

If GitHub refuses workflow runs or Pages deployment, review:

- branch protection on `main`
- repository Actions permissions
- Pages environment approval rules
- whether the workflow files have actually reached the branch GitHub is reading

Operational detail and fallback notes live in [`ci/README.md`](ci/README.md).

---

## Responsible gambling

Nothing here is betting advice, and no output should be read as a guarantee.
Predictions are generated mechanically from sourced data and are fallible. 18+.
