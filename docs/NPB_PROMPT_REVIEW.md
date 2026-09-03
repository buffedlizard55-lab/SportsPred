# NPB BASEBALL PREDICTION MASTER PROMPT v1.0 — line-by-line review

Every instruction in the prompt, what the repository does with it, where that
lives, what proves it, and whether it could be satisfied from a verified
source.

Legend: **implemented** · **implemented with a documented reading** (C-n) ·
**recorded as missing** (no source; the engine records the gap, the block
scores 0, and the evidence floors decide whether a verdict is allowed) ·
**not applicable to a static site**.

Code: [`engine/npb_engine.js`](../engine/npb_engine.js) (scoring + gates),
[`engine/npb_writer.js`](../engine/npb_writer.js) (Step 4 output),
[`engine/npb_data.js`](../engine/npb_data.js) (tape/box → factors, backtest),
[`engine/npb_source.js`](../engine/npb_source.js) (npb.jp parsers),
[`assets/js/npb-page.js`](../assets/js/npb-page.js) (page). Tests:
`tests/npb_source.test.mjs`, `tests/npb_engine.test.mjs`,
`tests/npb_writer.test.mjs`, `tests/npb_data.test.mjs`, plus the jsdom checks
in `tests/dom_smoke.test.mjs` and the validators in `scripts/build_data.py`.

## Step 1 — data collection

| Required input | Status | Source / register |
|---|---|---|
| Three-way moneyline, run line, total from two books | **recorded as missing** | `IR-NPB-01` |
| Last 5 results with run scores, last month, last two weeks double | implemented (weighting has no numerical effect → C-1) | English calendar tape → `teamFactors` |
| Season W-L-T, draw count, draw rate, league norm | implemented | standings (`ties`, `drawRate`) with tape fallback; `leagueDrawRate` |
| Run differential last month | implemented (30 days → C-2) | tape → `runDiffPerGame` |
| Same-league head-to-head weighted; interleague noted | implemented | `headToHead` splits `sameLeague` / `interleague`; only same-league scores |
| Announced starter, last 4 starts, form-based | implemented when box lines exist; **missing** otherwise | schedule detail 予告先発 + Japanese box lines → `starterProfile` (`IR-NPB-02`, `IR-NPB-08`) |
| Bullpen effectiveness, 3-day usage | implemented from box lines (C-7); **missing** in the seed | `bullpenState` (`IR-NPB-02`) |
| Opposing lineup vs handedness (30 days) | **recorded as missing** | `IR-NPB-03` |
| Runs per game last month | implemented | tape |
| League + DH status | implemented | `dhStatus` — CL no DH through 2026, universal 2027, PL/interleague at PL park DH |
| Four-import cap, max three of one type | context only, never scored | `foreignPlayers` note (`IR-NPB-05`) |
| Enclosed venue check | implemented | `VENUE_ROOF` table, shown as a pill; weather scored only when `open` |
| Weather, rainy/typhoon season | implemented for rain (JMA icon); wind **missing** | `RAIN_FORECASTS`, `seasonWindow` (`IR-NPB-04`) |
| Pennant context, 4+ streak | streak implemented; pennant context shown via standings table, not scored | `form.winStreak`, `renderStandings` |
| "Confirm scoring environment via search" | **not applicable at runtime** — replaced by the sourced venue/roof/forecast/DH fields and the review links | — |

## Step 2a — Win match (100)

| Rule | Status | Test |
|---|---|---|
| Form 25 / 16 / 7 / 0; +5 streak; +4 opponent collapse; draws are neither win nor loss | implemented | `recent form bands…` |
| Starter 25 form-based (strong 25 · solid 17 · inconsistent 9 · poor 0 · unconfirmed 0); +5 handedness; −8 short rest | implemented; handedness missing; short rest = <5 days (C-6); 2-start minimum (C-5) | `starter rating is form-based…` |
| Run diff 20 / 12 / 5 / 0; +4 negative opponent | implemented | engine tests |
| Odds 20 / 14 / 9; underdog 14 with RD + form edge; −8 deduction | implemented in code; **cannot fire live** | `IR-NPB-01` |
| H2H same league 10 / 6 / 2; interleague supplementary | implemented | `headToHead…` |
| Evidence floor: ≥60 of the 100 base points sourced | **added** (C-4) | `evidence floor (C-4)…` |

## Step 2b — Draw likelihood (100, independent)

| Rule | Status | Test |
|---|---|---|
| Both starters strong 30 | implemented | `draw likelihood: all five blocks fire → 100` |
| Both bullpens fresh 25 | implemented | same |
| RD gap < 1.0 → 20 | implemented | same |
| Draw rate above league norm 15 | implemented | same |
| Same-league close, low-scoring history 10 | implemented (C-3); interleague → block does not apply | `draw is independent…` |
| Primary pick at ≥65 and win scores within 10 | implemented — draw HIGH at 70+, MEDIUM 65–69 | `draw override…` |
| Draw ≥55 blocks the run line; 55–64 = secondary flag | implemented | `draw secondary flag…` |
| Presented as a genuine pick, never a hedge | implemented — dedicated `DRAW` label, draw-specific body and tails, draw-flag note | `a draw pick is written as a genuine selection…` |
| Scored on every match | implemented — page "Draw watch" rail; `drawScore` on every ledger row; validator requires it | `validate_npb_predictions` |

## Step 2c — Run line

| Rule | Status | Test |
|---|---|---|
| Only when win ≥ 60 and draw < 55 | implemented | `run line…`, `draw likelihood…` |
| H2H replaced by margin 20 / 12 / 0 | implemented | `scoreRunLineSide` |
| +10 starter strong + 6 IP; +8 bullpen; +8 opponent bullpen; +8 RD > 2 | implemented | `run line…` |
| Never −1.5 when avg win margin < 2 | implemented (`supportsCovering`) | same |
| +1.5 underdog: starter 17+ and supporting bullpen | implemented | same |

## Step 2d — Game total

| Rule | Status | Test |
|---|---|---|
| Offence 35 / 22 / 20 Under / 12 neutral | implemented | `game total…` |
| Starters 25 Under / 25 Over / 12 Over unconfirmed | implemented | same |
| Bullpen 20 Over / 18 Under / 10 neutral | implemented | same |
| Trends 15 / 9 / 14 / 4 | implemented in code; **missing live** (no posted line) | `IR-NPB-01` |
| Venue/weather 5: rain = Under; enclosed = no weather; wind out = Over | implemented; wind missing | `game total: rain…` |
| Evidence floor ≥60 sourced | **added** (C-4) | same test |

## Step 3 — Gates

| Rule | Status |
|---|---|
| Win 70 HIGH / 55–69 with 2 strong factors MEDIUM / <55 SKIP | implemented (`Step 3 win gates…`) |
| −300 gate needing starter 25 and RD > 2.5 | implemented; inert without a price |
| Run line 70 / 55 | implemented |
| Total 20 / 15 | implemented |

## Step 4 — Output

| Rule | Status | Proof |
|---|---|---|
| 40-word minimum | implemented (`MIN_WORDS`) | writer tests |
| Bold outcome inside 20 words | implemented | writer tests |
| No stats/odds/numbers | implemented — digit check | writer + dom tests |
| No player names, home/away, stadium, league, source names | implemented — shared forbidden list + `NPB_FORBIDDEN_WORDS` (central, pacific, interleague, dome, npb, import…) | `validator rejects each Step 4 violation` |
| Run line names only the covering team; total only Over/Under | implemented | writer tests |
| Unique opener per tip | implemented (`validateOpenerUniqueness`, 3 NPB openers added) | writer tests |
| Confidence on every tip; SKIP one sentence | implemented | writer tests |
| Banned phrases (7) | implemented | writer tests |
| Summary table + underdog flag + draw flag + responsible gambling | implemented (`buildNpbFormattedCardText`) | `card ends with…` |

## Documented readings (C-n)

| Id | Prompt text | Reading | Why |
|---|---|---|---|
| C-1 | "last two weeks weighted double" | The 25/16/7/0 table is applied to the last five results as written; weighting has no numerical table in the prompt, so none is invented | fidelity |
| C-2 | "last month" | 30 calendar days (`WINDOW_DAYS`) | determinism |
| C-3 | "recent close, low-scoring meetings" | ≥3 of the last 5 same-league meetings decided by ≤1 run or drawn with ≤7 combined runs (`H2H_CLOSE_*`) | the prompt gives no numbers |
| C-4 | Step 3 gates | A verdict requires ≥60 of the 100 base points to have a sourced input (`MIN_SOURCED_POINTS_WIN/TOTAL`) | without it, 20 sourced points could yield HIGH; observed on the first seed build and rejected |
| C-5 | "starter in strong recent form" | A rating needs ≥2 sourced starts (`MIN_STARTS_FOR_RATING`) | one start is not form |
| C-6 | "unusually short rest for this staff" | <5 days since last start (six-man rotations) | NPB norm |
| C-7 | "effective / unfatigued bullpen" | relief RA9 ≤3.5 over the window; fatigued = a reliever on each of the last 3 days or ≥8 relief appearances in 3 days | prompt gives "three days" only |
| C-8 | Rainy / typhoon windows | 06-01→07-20 and 08-01→10-15 | JMA climatology; stated in `RAINY_SEASON`/`TYPHOON_SEASON` |

## Hyperparameters

`WINDOW_DAYS` 30 · `H2H_CLOSE_MAX_TOTAL` 7 · `H2H_CLOSE_MAX_MARGIN` 1 ·
`H2H_CLOSE_MIN` 3 · `SHORT_REST_DAYS` 5 · `BULLPEN_EFFECTIVE_RA9` 3.5 ·
`BULLPEN_FATIGUE_DAYS` 3 · `BULLPEN_FATIGUE_APPEARANCES` 3 ·
`MIN_SOURCED_POINTS_WIN` 60 · `MIN_SOURCED_POINTS_TOTAL` 60 ·
`MIN_STARTS_FOR_RATING` 2. All asserted in `tests/npb_data.test.mjs` and
`tests/npb_engine.test.mjs`.
