# Baseball — Feature Matrix

What the layer delivers, how each piece is proved, and what is deliberately
absent. Companion to [BASEBALL_PROMPT_REVIEW.md](BASEBALL_PROMPT_REVIEW.md)
(prompt line → code → test) and
[BASEBALL_SOURCES.md](BASEBALL_SOURCES.md) (every endpoint, verified).

## Site

| Feature | Where | Proof |
|---|---|---|
| Scoreboard with past results, live and upcoming | `assets/js/baseball-page.js` `renderDay` | jsdom test in `tests/dom_smoke.test.mjs` |
| Date strip + month calendar with per-day match counts | `renderDateStrip`, `renderCalendar` | same |
| Auto-generated predictions on load | `boot()` → `buildAllCards()` | `baseball.html boots, auto-generates three tips per match` |
| Generate button that actually re-scores | `$('#generate').onclick` → `buildAllCards()` → `renderDay()` | same test clears `#board`, clicks, and asserts rows and tips return |
| Copy per tip, copy all tips, copy the whole card | `#copy-all`, `#copy-card`, `.copy-tip` | card text asserted to carry every section |
| Per-match analysis panel: every rule, its points, what could not be sourced, https review links | `renderAnalysis` | jsdom test asserts the panel, the gap list and ≥3 https links |
| Live feed refresh with graceful fallback | `refreshLiveFeeds()` | falls back to committed data and reports which feed failed |
| Coverage panel that says when a document is empty | `renderCoverage` | integration test asserts the empty standings table |
| Source register and irregularity list rendered on the page | `renderSources` | `data/baseball_provenance.json` validated by `build_data.py --strict` |

## Engine

| Feature | Where | Proof |
|---|---|---|
| Three markets scored per match | `scoreBaseballMatch` | `tests/baseball_engine.test.mjs` |
| Starting-pitcher quality with quality-start derivation | `scoreStartingPitcher` | engine tests |
| Run line: base + run-margin swap + modifiers, cover gate | `scoreRunLineSide`, `decideRunLine` | engine tests |
| Total: Over/Under ledgers + 15-point directional gate | `scoreTotalMarket`, `decideTotal` | engine tests |
| Missing-factor accounting with no defaults anywhere | every `score*` function | `a missing last-five record is recorded, never guessed` |
| UNSCORED sentinel for fixtures with no competitor names | `scoreBaseballMatch` | engine tests |

## Writer

| Feature | Where | Proof |
|---|---|---|
| 40-word floor, bolded outcome inside the first 20 words, no digits, no forbidden words, confidence stated | `validateBaseballTip` | `tests/baseball_writer.test.mjs` |
| Seven banned filler phrases rejected | `BANNED_PHRASES` | writer tests |
| 20 distinct opening angles; no two tips in a card open alike | `OPENERS`, `validateOpenerUniqueness` | writer tests |
| SKIP verdicts with a digit-free sentence and the numeric reason kept for the panel | `writeTip` | writer tests |
| Copy-paste card: tips, summary table, underdog value flag, responsible gambling line | `buildBaseballFormattedCardText` | writer tests |

## Data and pipeline

| Feature | Where | Proof |
|---|---|---|
| OLBG baseball slate collector, stdlib only, never writes a price | `scripts/collect_baseball_olbg.py`, `scripts/lib/baseball_olbg_parse.py` | `tests/test_baseball_olbg_parse.py` |
| MLB + ESPN collector writing five provenance-tagged documents | `scripts/collect_baseball_mlb.mjs` | syntax-checked; runs in CI (no outbound network here) |
| Walk-forward backtest with no leakage | `scripts/backtest_baseball.mjs` | features come only from games before the fixture; the report states what cannot be graded |
| Data-layer validation | `scripts/build_data.py --strict` | baseball documents validated, including "OLBG row carries no odds" |
| Scheduled collection | `.github/workflows/baseball-collect.yml` | runs on push and twice an hour |

## Deliberately absent

| Absent | Why |
|---|---|
| Odds (moneyline / run line / total) | no key-less baseball price feed → `IR-BASEBALL-01` |
| Bullpen ERA rank and 3-day usage | no key-less relief split → `IR-BASEBALL-02` |
| Wind direction and speed | not published by any verified feed → `IR-BASEBALL-03` |
| Historical run line and total grading, and ROI | no retained closing lines → `IR-BASEBALL-04` |
| Player names, injuries, sentiment | the prompt forbids them in output, and no verified structured feed exists, so nothing is invented |
