# NPB — Feature Matrix

What the NPB layer (Baseball → NPB sub-page) delivers, how each piece is
proved, and what is deliberately absent. Companion to
[NPB_PROMPT_REVIEW.md](NPB_PROMPT_REVIEW.md) (prompt line → code → test),
[NPB_SOURCES.md](NPB_SOURCES.md) (every page, verified) and
[NPB_IRREGULARITIES.md](NPB_IRREGULARITIES.md).

## Site

| Feature | Where | Proof |
|---|---|---|
| Baseball split into league sub-pages: MLB \| NPB tabs on both pages | `engine/registry.js` `subPages`; `#league-tabs` in `baseball.html` / `npb.html` | `baseball.html carries the MLB \| NPB league tabs`; `npb.html boots as a baseball sub-page…` |
| NPB scoreboard: results (with draws and innings), postponements, upcoming with JST time, venue, roof pill, forecast pill, DH pill, announced starters | `renderMatch` in `assets/js/npb-page.js` | jsdom test |
| Date strip + month calendar with per-day counts (JST) | `renderDateStrip`, `renderCalendar` | same |
| League filter (Central / Pacific / Interleague), status filter, search | `#league-filter`, `#status-filter`, `#search` | same |
| Predictions generated on load **and** by the Generate button (pure engine, no network) | `boot()` / `#generate` → `buildAllCards()` | test clears `#board`, clicks, asserts rows and tips return |
| Three tips per match — win (or **DRAW**), run line, total — each with confidence or a one-sentence SKIP | `writeNpbCard` | writer + dom tests |
| Draw watch rail: draw score for every game on the slate with the blocks that fired | `renderDrawWatch` | dom test asserts `/100` |
| Analysis panel per match: four ledgers (home, away, draw, run line), total ledger, starters with linked starts, recent results linked to npb.jp, venue/roof/forecast/season window, DH + import rule, price status, `missing[]`, review links | `renderAnalysis` | dom test asserts "Draw likelihood", "Could not be sourced", "Price", ≥3 https links incl. npb.jp |
| Standings card (both leagues: W-L-T, PCT, GB, home/road/interleague, draw %) | `renderStandings` | dom test asserts two tables |
| Coverage rail with seed/live mode, fetch time, empty-document flags | `renderCoverage` | dom test |
| Backtest rail (walk-forward, draws on tape, plays, ungradeable totals) | `renderBacktest` | validator `validate_npb_backtest` |
| Sources rail with npb.jp links, not-sourced list, irregularities | `renderSources` | dom test asserts `NPB-SEED`/`IR-NPB-` |
| Copy tip / copy all / copy full card | `.copy-tip`, `#copy-all`, `#copy-card` | dom test on `#card-text` |
| Seed-data banner when documents are `mode: "seed"` | `renderNotes` | provenance validator requires `NPB-SEED` in seed mode |

## Engine

| Feature | Where | Proof |
|---|---|---|
| Win match per side, 5 blocks + bonuses/deductions | `scoreWinMatchSide` | `tests/npb_engine.test.mjs` |
| Independent draw likelihood, 5 blocks; primary/secondary flags | `scoreDrawLikelihood`, `decideWinMatch` | same |
| Run line with draw gate, margin swap, never −1.5 under 2 runs, +1.5 route | `scoreRunLineSide`, `decideRunLine` | same |
| Total Over/Under ledgers with rain-Under and enclosed-venue rule | `scoreTotalMarket`, `decideTotal` | same |
| Evidence floors (60/60 sourced points, 2 starts) | `MIN_SOURCED_POINTS_*`, `MIN_STARTS_FOR_RATING` | same |
| Missing-factor accounting, no defaults anywhere | every `score*` | `draw is independent…`, `starterProfile… never invent a log` |
| Step 4 validator with NPB forbidden words and draw label | `validateNpbTip`, `writeTip` | `tests/npb_writer.test.mjs` |

## Data

| Feature | Where | Proof |
|---|---|---|
| npb.jp parsers: month calendar, standings, schedule detail, Japanese box, English box, team registers | `engine/npb_source.js` | `tests/npb_source.test.mjs` over dated captures with hand-verified numbers |
| Tape → form, run diff, margins, draw rate, H2H (walk-forward) | `engine/npb_data.js` | `teamFactors is walk-forward…`, leak test in `backtest is walk-forward and leak-free` |
| Box lines → starter profile, bullpen state | `starterProfile`, `bullpenState` | data tests |
| Document builder shared by collector and seed | `scripts/npb_build_docs.mjs` | seed docs validated by `build_data.py --strict` |
| CI collector with parse-drift gate | `scripts/collect_npb.mjs`, `.github/workflows/npb-collect.yml` | never run from the sandbox (no network) — see `IR-NPB-07` |
| Seven `data/npb_*.json` validators | `scripts/build_data.py` | `npm run verify:all` |

## Deliberately absent

| Item | Why |
|---|---|
| Odds / underdog value flag / heavy-favourite gate live | no key-less three-way NPB feed (`IR-NPB-01`) |
| Browser-side refresh | npb.jp has no CORS (`IR-NPB-10`) |
| Any filled-in starter, bullpen, forecast or price | never; the block is missing and the market SKIPs |
| NPB as a 21st sport tile | NPB is a league inside Baseball; the registry keeps 20 OLBG sports |
