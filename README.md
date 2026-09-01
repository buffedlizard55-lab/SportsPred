# SportsPred

A tennis scoreboard and three-market prediction engine, built around one rule:
**nothing is published without a source.**

The site collects live tennis matches, results and rankings from ESPN's public
key-less endpoints, resolves each tournament's court surface from recorded match
data, scores every match across Win Match, First Set Winner and Games Handicap,
and writes copy-ready predictions. Every one of those steps is machine-checked.

Pick any date on the calendar — past, today, or upcoming — and the scoreboard
loads that day's real card. One button turns it into written tips you can copy.

**Live site:** published from `main` via GitHub Pages. The workflows are ready in
[`ci/`](ci/README.md) but need one manual step to install — see below.
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
  surface.js            tournament -> court surface, or null with a reason
  tournament.js         tour level / round coding, H2H orientation
  join.js               slate -> engine input; never fills a gap
  olbg.js               OLBG snapshot view-model + live-card correlation (display only)
assets/js/
  collector.js          live browser collection from ESPN (no key, no server)
  app.js                controller: scoreboard, calendar, copy buttons
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
tests/                  120 Node tests + 23 Python tests
docs/
  LIVE_DATA.md          the live data architecture and what ESPN does not publish
  PROMPT_REVIEW.md      line-by-line review of the master prompt
  SOURCES.md            every source with its verification status
  IRREGULARITIES.md     everything that did not check out
  BACKTEST.md           historical backtest method + results
```

The engine is imported directly by the browser **and** by the tests. There is no
copy of the scoring logic, so the site cannot drift from what is tested.

---

## Running it

```bash
npm test                                          # 120 tests: engine, writer, ESPN parsers, pipeline, OLBG view-model
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
| OLBG markets in a scoreboard with calendar | ✅ committed snapshot rendered as the scoreboard's "OLBG market snapshot" panel, correlated to the live card and marked on the calendar; refreshed by scheduled CI collection |
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

## Automation — needs one manual step

Two workflows are written and complete, in [`ci/`](ci/README.md):

- **`ci/collect.yml`** — every 30 minutes: collect the slate, record predictions,
  print the backtest report, commit only if data changed. A failed collection
  leaves the previous snapshot untouched.
- **`ci/pages.yml`** — runs the full test suite, then publishes `index.html`,
  `assets/`, `engine/` and `data/`. Scripts and fixtures are deliberately
  excluded from the public artifact.

They sit in `ci/` rather than `.github/workflows/` because the automation
account used here lacks the `workflows` permission GitHub requires to create
them; the push was rejected with that exact error. To enable:

```bash
mkdir -p .github/workflows
cp ci/pages.yml ci/collect.yml .github/workflows/
git add .github/workflows && git commit -m "ci: enable workflows" && git push
```

Then set **Settings → Pages → Source** to **GitHub Actions**. Full detail in
[`ci/README.md`](ci/README.md).

---

## Responsible gambling

Nothing here is betting advice, and no output should be read as a guarantee.
Predictions are generated mechanically from sourced data and are fallible. 18+.
