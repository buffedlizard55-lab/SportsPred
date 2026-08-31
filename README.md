# SportsPred

A tennis scoreboard and three-market prediction engine, built around one rule:
**nothing is published without a source.**

The site collects the current OLBG tennis slate, joins it to player statistics
where those can be sourced, scores each match across Win Match, First Set Winner
and Games Handicap, and writes copy-ready predictions. Every one of those steps
is machine-checked.

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
  engine.mjs            Step 2 scoring and Step 3 decision rules
  writer.mjs            Step 4 tip writing and the output-rule validator
  join.mjs              slate -> engine input; never fills a gap
assets/js/app.js        browser controller: scoreboard, calendar, copy buttons
data/
  slate.json            the collected OLBG slate, with source URL and fetch time
  players.json          player statistics + per-factor collection status
  predictions.json      append-only record of every selection made
  results.json          settled outcomes (empty — see IR-02)
  provenance.json       the irregularity register
scripts/
  collect_olbg.py       OLBG slate collector (stdlib only)
  collect_players.py    statistics collector; refuses to write estimates
  record_predictions.mjs  forward collection
  backtest.mjs          grading: hit rate, Brier, log loss, ROI
  serve.py              local preview server
tests/                  55 Node tests + 23 Python tests
docs/
  PROMPT_REVIEW.md      line-by-line review of the master prompt
  SOURCES.md            every source with its verification status
  IRREGULARITIES.md     everything that did not check out
```

The engine is imported directly by the browser **and** by the tests. There is no
copy of the scoring logic, so the site cannot drift from what is tested.

---

## Running it

```bash
npm test                                          # engine, writer, join, backtest
python3 -m unittest discover -s tests -p 'test_*.py'   # OLBG parsers
python3 scripts/serve.py 8000                     # local preview
python3 scripts/collect_olbg.py --dry-run         # refresh the slate
node scripts/record_predictions.mjs               # forward collection
node scripts/backtest.mjs                         # grading report
```

No third-party packages are required anywhere. The collectors are stdlib-only
and the site is plain ES modules with no build step.

---

## Current status — read this before trusting any output

The engine and the site are complete and tested. **The data pipeline is not yet
feeding it**, for two verified reasons:

- **OLBG publishes no structured odds.** Its pages are server-rendered but
  prices are injected client-side into the betslip. Every odds-dependent factor
  is therefore unscored. (`IR-01`)
- **The canonical free ATP/WTA match dataset is gone.** `JeffSackmann/tennis_atp`
  returns 404; a GitHub API query for that user returns exactly one public
  repository. That blocks form, surface, serve and historical backtesting. (`IR-02`)

The consequence, stated plainly: **on today's data every match is unscored, and
the site says so rather than inventing predictions.** That is the correct
behaviour, not a failure — but it does mean the project needs an odds source
(API key) and a results source before it produces tips.

To unblock:

| Need | Options |
|---|---|
| Odds for ≥2 books | The Odds API, Betfair Exchange API — both need a key |
| Match results + form | A verified mirror of the Sackmann CSVs, or ATP/WTA results pages |
| Rankings | `atptour.com/en/rankings/singles`, `wtatennis.com/rankings/singles` |

Each is declared as an adapter in `scripts/collect_players.py` with its
verification state. Add a key as a repository secret and the corresponding
adapter starts contributing; no code change is needed to the engine.

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
