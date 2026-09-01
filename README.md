# SportsPred

A tennis scoreboard and three-market prediction engine, built around one rule:
**nothing is published without a source.**

The site collects live tennis matches, results and rankings from ESPN's public
key-less endpoints, resolves each tournament's court surface from recorded match
data, overlays matching OLBG event rows for market review, scores every match
across Win Match, First Set Winner and Games Handicap, and writes copy-ready
predictions. Every one of those steps is machine-checked.

Pick any date on the calendar — past, today, or upcoming — and the scoreboard
loads that day's real card. Each match card shows sourced rank trajectory,
recent form, surface record, and manual-review links back to ESPN/OLBG where
available. One button turns the card into written tips you can copy.

**Live site:** GitHub Pages is already enabled for this repository at
<https://buffedlizard55-lab.github.io/SportsPred/>. Workflow files are present
on this branch under `.github/workflows/` and mirrored in [`ci/`](ci/README.md).
At the time of writing, the public Pages site is still configured in **legacy**
mode from `main` until the repository Pages source is switched to **GitHub Actions**.
**Local preview:** `python3 scripts/serve.py 8000` then open <http://localhost:8000>.

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
  engine.js             Step 2 scoring and Step 3 decision rules
  writer.js             Step 4 tip writing and the output-rule validator
  espn.js               ESPN payload parsers + player-stat derivation
  olbg.js               OLBG snapshot/date/market helpers for the site
  surface.js            tournament -> court surface, or null with a reason
  tournament.js         tour level / round coding, H2H orientation
  join.js               slate -> engine input; never fills a gap
assets/js/
  collector.js          live browser collection from ESPN (no key, no server)
  app.js                controller: scoreboard, calendar, OLBG overlay, copy buttons
data/
  surfaces.json         tournament -> surface, built from recorded match rows
  slate.json            an OLBG slate snapshot, with source URL and fetch time
  players.json          player statistics + per-factor collection status
  predictions.json      append-only record of every selection made
  results.json          settled outcomes (empty — see IR-02)
  provenance.json       the irregularity register
scripts/
  collect_olbg.py       OLBG slate collector (stdlib only)
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
tests/                  129 Node tests + 23 Python tests
docs/
  LIVE_DATA.md          the live data architecture and what ESPN does not publish
  PROMPT_REVIEW.md      line-by-line review of the master prompt
  PROMPT_FEATURE_MATRIX.md  prompt line -> repo feature/status/source matrix
  SOURCES.md            every source with its verification status
  IRREGULARITIES.md     everything that did not check out
  BACKTEST.md           historical backtest method + results
```

The engine is imported directly by the browser **and** by the tests. There is no
copy of the scoring logic, so the site cannot drift from what is tested.

---

## Running it

```bash
npm test                                          # 120 tests: engine, writer, ESPN parsers, OLBG helpers, join, pipeline
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
