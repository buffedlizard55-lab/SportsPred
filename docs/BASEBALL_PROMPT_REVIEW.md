# BASEBALL PREDICTION MASTER PROMPT v1.0 — line-by-line review

Every instruction in the prompt, what the repository does with it, where that
lives, what proves it, and whether it could be satisfied from a verified source.

Legend: **implemented** · **implemented with a documented reading** ·
**recorded as missing** (no source, so the engine records the gap and reduces
the score) · **not applicable to a static site**.

Code: [`engine/baseball_engine.js`](../engine/baseball_engine.js) (scoring +
decision rules),
[`engine/baseball_writer.js`](../engine/baseball_writer.js) (Step 4 output),
[`engine/baseball_data.js`](../engine/baseball_data.js) (join),
[`engine/baseball_espn.js`](../engine/baseball_espn.js) (feed parsers).
Tests: `tests/baseball_engine.test.mjs`, `tests/baseball_writer.test.mjs`,
`tests/baseball_integration.test.mjs`, `tests/test_baseball_olbg_parse.py`, plus
the jsdom check in `tests/dom_smoke.test.mjs`.

## Step 1 — data collection

| Required input | Status | Source |
|---|---|---|
| Moneyline, run line, total from two books | **recorded as missing** | no key-less baseball price feed exists → `IR-BASEBALL-01` |
| Last 5 results, last month, last two weeks double-weighted | implemented (weighting has no effect on the table → C-1) | MLB schedule tape → `scheduleFactors` |
| Season W-L record, recent stretch | implemented | MLB standings + fixture `leagueRecord` |
| Run differential over the last month | implemented | tape → `scheduleFactors().runDiffPerGame` |
| Head-to-head last 3 years, recent 3 weighted | implemented (weighting has no effect on the table → C-3) | tape → `headToHeadFromTape` |
| Starting pitcher ERA, WHIP, K/9, last 4 starts | implemented | MLB probable pitcher + person gameLog/season stats |
| Bullpen ERA and 3-day usage | **recorded as missing** | `IR-BASEBALL-02` |
| Opposing BA vs starter handedness | **recorded as missing** | no key-less split vs handedness in last 30 days; team-level left/right W-L is in standings but is a record, not BA |
| Team BA / OBP / SLG over last 10 | implemented for season (team stats); last-10 trend **recorded as missing** | MLB team hitting stats (season); no key-less 10-game window |
| Runs per game, last month and last 10 | implemented for last month (tape); last-10 **recorded as missing** | tape (last month); standings last-ten is W-L, not runs |
| Runs allowed per game, last month | implemented | tape |
| Injury / roster report | **not used** — no verified key-less feed; the engine never speculates on players | `IR-BASEBALL` (sentiment/injuries not invented) |
| Ballpark run environment | implemented for indoor (dome) flag only | ESPN venue `indoor` |
| Weather wind direction/speed | **recorded as missing** (dome flag sourced, temperature summary sourced) | `IR-BASEBALL-03` |
| Recent form streak 4+ | implemented | `scheduleFactors().form.winStreak` |
| Underdog value flag | implemented in code; **cannot fire live** without a price | `scoreOddsAndValue`, `IR-BASEBALL-01` |
| Social / analyst sentiment | **not used** | internal-only per prompt; nothing invented |
| Cross-reference odds across two books | **not satisfiable** | `IR-BASEBALL-01` |

## Step 2 — market scoring

### WIN MATCH OUTRIGHT (100)

| Rule | Status | Where |
|---|---|---|
| Form 4+ = 25 / 3 = 16 / 2 = 7 / ≤1 = 0 | implemented | `scoreRecentForm` |
| +5 winning streak 4+; +4 opponent lost 4+ of 5 | implemented | `scoreRecentForm` |
| Starter ERA < 3.00 with 2+ QS in last 4 = 25; 3.00–3.99 with 1+ QS in last 3 = 17; 4.00–4.99 = 9; > 5.00 or unconfirmed = 0 | implemented | `scoreStartingPitcher` |
| +5 opponent below .235 vs handedness | **recorded as missing** | `scoreStartingPitcher` |
| −8 short rest or 100+ pitches in last 2 | implemented (from game log) | `scoreStartingPitcher` |
| Run differential > +2.5 = 20 / +1.5–2.4 = 13 / 0–1.4 = 7 / negative = 0; +4 opponent negative | implemented | `scoreRunDifferential` |
| Odds −200 = 20 / −150–199 = 14 / −100–149 = 9 / underdog value = 14 | implemented with a documented reading (C-2); **input missing live** | `scoreOddsAndValue` |
| −8 if shorter than −250 with unconfirmed starter or fatigued bullpen | implemented (price-gated) | `scoreOddsAndValue` |
| Head-to-head 6+ = 10 / 5 = 6 / trailing = 2; +3 last 3 | implemented | `scoreHeadToHead` |

### RUN LINE (100)

| Rule | Status | Where |
|---|---|---|
| Activate only when win score ≥ 60 | implemented | `decideRunLine` |
| Replace H2H with run-margin analysis (≥3 = 20, 2–2.9 = 12, <2 = 0) | implemented | `scoreRunLineSide` |
| +10 starter ERA < 3.00 with 6+ IP/start | implemented | `scoreRunLineSide` |
| +8 top-10 bullpen (−1.5) / bottom-10 (+1.5) | implemented, **input missing** | `scoreRunLineSide` |
| +8 run differential > +2.0 | implemented | `scoreRunLineSide` |
| +7 opponent bullpen heavy last 2 days | implemented, **input missing** | `scoreRunLineSide` |
| Never recommend −1.5 when avg win margin in last 5 wins < 2 | implemented | `decideRunLine` (supportsCovering) |
| +1.5 underdog independent route (starter 17+, bullpen supports) | implemented | `decideRunLine` |
| 100pt cap | implemented with a documented reading (C-4) | clamp |

### GAME TOTAL (100)

| Rule | Status | Where |
|---|---|---|
| Combined offence: both 5+ = 35 Over / one 5+ other 4–4.9 = 22 / both 4–4.9 = 12 / one or both < 3.5 = 20 Under | implemented | `scoreTotalMarket` |
| Starter run suppression: both < 3.50 = 25 Under / one < 3.50 one > 4.50 = 10 Over-lean / both > 4.50 = 25 Over / unconfirmed +12 Over | implemented | `scoreTotalMarket` |
| Bullpen: both bottom-10 = 20 Over / one elite one poor = 10 / both top-10 = 18 Under | implemented, **input missing** | `scoreTotalMarket` |
| Recent totals trends (15) | implemented, **input missing** (needs a posted line) | `scoreTotalMarket` |
| Weather & park (5): wind out/in, dome | implemented for dome; wind **missing** | `scoreTotalMarket` |
| Only recommend when one direction leads by 15+ | implemented | `decideTotal` |

## Step 3 — decision rules

| Rule | Status | Where |
|---|---|---|
| Win ≥ 70 HIGH; 55–69 with 2+ factors aligned MEDIUM; < 55 SKIP | implemented | `decideWinMatch` |
| Never recommend −300+ favourite unless starter max and run diff > +2.5 | implemented (price-gated) | `decideWinMatch` |
| Run line ≥ 70 HIGH; 55–69 MEDIUM; < 55 or win < 60 SKIP | implemented | `decideRunLine` |
| Total advantage ≥ 20 HIGH; 15–19 MEDIUM; < 15 SKIP | implemented | `decideTotal` |
| Bullpen game auto Over-lean +12 | implemented once (C-5) | `scoreTotalMarket` |
| Underdog value flag | implemented, price-gated | `scoreBaseballMatch.underdogValue` |

## Step 4 — output format

| Rule | Status | Where |
|---|---|---|
| Three tips per match in order WIN MATCH OUTRIGHT, RUN LINE, GAME TOTAL | implemented | `writeBaseballCard` |
| 40-word floor, bolded outcome in first 20 words, no digits | enforced | `validateBaseballTip` |
| No stats/odds/lines/player names/home-away/league/sources | enforced | `validateBaseballTip` forbidden word/substring lists |
| Run line states only who covers; total states only Over/Under | enforced | `validateBaseballTip` |
| Seven banned filler phrases | enforced | `BANNED_PHRASES` |
| No two tips open alike; unique style per tip | enforced | `OPENERS`, `validateOpenerUniqueness` |
| Confidence LOW/MEDIUM/HIGH; SKIP single sentence | enforced | `validateBaseballTip` |
| Summary table + underdog value flag + responsible gambling reminder | implemented | `writeBaseballCard`, `buildBaseballFormattedCardText` |
