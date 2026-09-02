# Ice Hockey — Feature Matrix

What the layer delivers, how each piece is proved, and what is deliberately
absent. Companion to [ICE_HOCKEY_PROMPT_REVIEW.md](ICE_HOCKEY_PROMPT_REVIEW.md)
(prompt line → code → test) and
[ICE_HOCKEY_SOURCES.md](ICE_HOCKEY_SOURCES.md) (every endpoint, verified).

## Site

| Feature | Where | Proof |
|---|---|---|
| Scoreboard with past results, live and upcoming | `assets/js/ice-hockey-page.js` `renderDay` | jsdom test in `tests/dom_smoke.test.mjs` |
| Date strip + month calendar with per-day match counts | `renderDateStrip`, `renderCalendar` | same |
| Auto-generated predictions on load | `boot()` → `buildAllCards()` | `ice-hockey.html boots, auto-generates three tips per match` |
| Generate button that actually re-scores | `$('#generate').onclick` → `buildAllCards()` → `renderDay()` | same test clears `#board`, clicks, and asserts rows and tips return |
| Copy per tip, copy all tips, copy the whole card | `#copy-all`, `#copy-card`, `.copy-tip` | card text asserted to carry every section |
| Per-match analysis panel: every rule, its points, what could not be sourced, https review links | `renderAnalysis` | jsdom test asserts the panel, the gap list and ≥3 https links |
| Live feed refresh with graceful fallback | `refreshLiveFeeds()` | falls back to committed data and reports which feed failed |
| Coverage panel that says when a document is empty | `renderCoverage` | integration test asserts the empty standings table |
| Source register and irregularity list rendered on the page | `renderSources` | `data/ice_hockey_provenance.json` validated by `build_data.py --strict` |

## Engine

| Feature | Where | Proof |
|---|---|---|
| Three markets scored per match, 100 points each | `scoreIceHockeyMatch` | 44 engine tests |
| Subagent pipeline: two reasoning paths, consensus, agreement, edge | `modelProbability*`, `buildConsensus`, `riskFilter` | `pipeline:` tests |
| Risk vetoes: edge floor, unconfirmed starter, violent disagreement, weak score | `riskFilter` | four separate tests |
| Daily cap of six active picks across all markets | `scoreIceHockeyCard` | `card: the six-active-pick daily cap` |
| Per-match European flag so NHL cards never inherit the half-goal shift | `scoreIceHockeyCardMixed` | `card: mixed scoring applies each match's own European flag` |
| Missing-factor accounting with no defaults anywhere | every `score*` function | `a missing last-five record is recorded, never guessed` |
| UNSCORED sentinel for fixtures with no competitor names | `scoreIceHockeyMatch` | `a fixture with no competitor names returns the UNSCORED sentinel` |

## Writer

| Feature | Where | Proof |
|---|---|---|
| 40-word floor, bolded outcome inside the first 20 words, no digits, no forbidden tokens, confidence stated | `validateIceHockeyTip` | 21 writer tests |
| Six banned filler phrases rejected | `BANNED_PHRASES` | `BANNED_PHRASES covers every filler phrase the prompt names` |
| 30 distinct opening angles; no two tips in a card open alike | `OPENERS`, `validateOpenerUniqueness` | `every opener word is distinct` |
| SKIP verdicts with a digit-free sentence and the numeric reason kept for the panel | `writeTip` | `writeTip returns the numeric reason alongside a digit-free SKIP tip` |
| Copy-paste card: tips, summary table, back-to-back note, responsible gambling line | `buildIceHockeyFormattedCardText` | `the formatted card text is copy-paste ready` |

## Data and pipeline

| Feature | Where | Proof |
|---|---|---|
| OLBG ice hockey slate collector, stdlib only, never writes a price | `scripts/collect_ice_hockey_olbg.py`, `scripts/lib/ice_hockey_olbg_parse.py` | 16 Python tests over a reconstructed capture of the verified page |
| NHL + ESPN collector writing five provenance-tagged documents | `scripts/collect_ice_hockey_nhl.mjs` | syntax-checked; runs in CI (no outbound network here) |
| Walk-forward backtest with no leakage | `scripts/backtest_ice_hockey.mjs` | features come only from games before the fixture; the report states what cannot be graded |
| Data-layer validation | `scripts/build_data.py --strict` | nine ice hockey documents validated, including "OLBG row carries no odds" |
| Scheduled collection and Pages deploy | `.github/workflows/ice-hockey-collect.yml` | runs on push and twice an hour |

## Deliberately absent

| Absent | Why |
|---|---|
| A second bookmaker price | none exists key-less → IR-HOCKEY-01 |
| Confirmed starting goaltenders | no free feed publishes them → IR-HOCKEY-02 |
| Power play %, penalty kill %, shots, blocked shots | not published by any reachable feed → IR-HOCKEY-03 |
| European league statistics | ESPN publishes no European hockey league → IR-HOCKEY-04 |
| Historical puck line and total grading, and ROI | no retained closing lines → IR-HOCKEY-05 |
| Sentiment inputs | the prompt marks them internal-only and no verified source exists, so nothing is invented |
