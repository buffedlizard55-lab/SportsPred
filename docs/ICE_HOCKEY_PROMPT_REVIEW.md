# ICE HOCKEY PREDICTION MASTER PROMPT v1.0 — line-by-line review

Every instruction in the prompt, what the repository does with it, where that
lives, what proves it, and whether it could be satisfied from a verified source.

Legend: **implemented** · **implemented with a documented reading** ·
**recorded as missing** (no source, so the engine records the gap and reduces the
score) · **not applicable to a static site**.

Code: [`engine/ice_hockey_engine.js`](../engine/ice_hockey_engine.js) (scoring +
decision rules + subagent layer),
[`engine/ice_hockey_writer.js`](../engine/ice_hockey_writer.js) (Step 4 output),
[`engine/ice_hockey_data.js`](../engine/ice_hockey_data.js) (join),
[`engine/ice_hockey_espn.js`](../engine/ice_hockey_espn.js) (feed parsers).
Tests: `tests/ice_hockey_engine.test.mjs` (44), `tests/ice_hockey_writer.test.mjs`
(21), `tests/ice_hockey_integration.test.mjs` (13),
`tests/test_ice_hockey_olbg_parse.py` (16), plus the jsdom check in
`tests/dom_smoke.test.mjs`.

---

## Core objective

| Prompt | Status | Where |
|---|---|---|
| "The objective is not to maximise the number of bets… maximise long-term profitability through strict filtering" | implemented | the risk layer vetoes before any pick is made; `scoreIceHockeyCard` caps active picks at 6 per day |
| "disciplined rejection of weak opportunities" | implemented | Step 3 SKIP bands + `riskFilter` veto |

## Internal subagent pipeline

| Stage | Status | Where |
|---|---|---|
| 1 Data Agent — gather and normalise odds, results, standings, injuries, schedule, context | implemented | `scripts/collect_ice_hockey_nhl.mjs`, `scripts/collect_ice_hockey_olbg.py`, `engine/ice_hockey_espn.js` |
| "If key data is missing, mark the gap explicitly and downgrade confidence" | implemented | every factor pushes to `missing[]`; caps in Step 3; `renderAnalysis` prints the list |
| "Never invent or assume unavailable facts" | implemented, enforced | there is no default value anywhere in the engine; `tests/ice_hockey_engine.test.mjs` asserts a missing factor records a gap |
| 2 Feature Engineering — form, efficiency gaps, matchup edges, fatigue, venue, line movement, market context | implemented for what is sourced | `scheduleFactors`, `parseNhlStandings`, `parseNhlClubStats` |
| "Weight recency appropriately" | implemented with a documented reading | see C-3 in [ICE_HOCKEY_IRREGULARITIES.md](ICE_HOCKEY_IRREGULARITIES.md) |
| 3 Modelling — consensus from more than one reasoning path | implemented | `modelProbabilityFromScore` + `modelProbabilityFromOdds` → `buildConsensus` |
| "Measure model agreement and penalise unstable or contradictory signals" | implemented | `agreement`; >20 points is a recorded penalty, >30 is a veto |
| "Compare consensus against implied probability… edge = model − implied" | implemented | `riskFilter` returns `edgePp` from the de-vigged price |
| 4 Backtesting — historical stability, ROI, drawdown, closing line value | implemented, partly ungradable | `scripts/backtest_ice_hockey.mjs`; puck line and total are `ungraded` with the reason (IR-HOCKEY-05) |
| "If the profile is historically weak, downgrade or reject" | implemented | `opts.historicalSignal === 'weak'` adds a risk penalty |
| 5 Risk Filter — reject low-edge, high-variance, data-poor, contradictory | implemented | `riskFilter` |
| "Edge below roughly 3 to 5 percentage points should normally be rejected" | implemented | `MIN_EDGE_PP = 3.0`, unit-tested |
| "Penalise outsized dependence on one fragile variable" | implemented | fragile-input penalty when 2+ of goaltending/odds/injury/special teams are unsourced |
| 6 Strategy — only a surviving selection becomes a recommendation | implemented | the writer emits SKIP for anything vetoed |
| 7 No-Bet — final veto | implemented | `pipeline.noBet`, surfaced as a `NO BET` badge on the page |

## Model discipline rules

| Prompt | Status | Where |
|---|---|---|
| Selectivity over volume | implemented | 6-pick cap, SKIP bands, veto layer |
| Risk control over hit rate | implemented | veto on unconfirmed goaltender regardless of score |
| Long-term ROI over short-term variance | implemented | backtest reports hit rate by band and monotonicity; ROI only from priced forward picks |
| Consistency over complexity | implemented | one pure scoring module, imported by the page and the tests |
| Positive expected value is mandatory | implemented | edge floor + SKIP |
| "If no selection clearly passes the filters, output NO BET" | implemented | `NO BET` badge + SKIP tips with the reason |

## Step 1 — data collection

| Required input | Status | Source |
|---|---|---|
| Moneyline, puck line, total from at least two sources, cross-referenced | **recorded as missing / partial** | ESPN scoreboard carries all three from one book (DraftKings); no second free book exists → IR-HOCKEY-01 |
| Last 5 results, last month, last two weeks double-weighted | implemented (weighting has no effect on the points table → C-3) | NHL scoreboard tape → `scheduleFactors` |
| Home and away splits including goals for and against | implemented | `parseNhlStandings` → `home`, `road` |
| Head-to-head over the last 3 years, recent weighted | implemented | `headToHeadFromTape(tape, a, b, beforeUtc, { years: 3 })` |
| Full injury and availability report, split by offence / defence / goaltending | implemented, coarser than asked | ESPN injuries by position; the prompt's three-way split is reduced to a forward-line count → `keyForwardLineMissing` |
| Shots on goal per game, offensive and defensive | **recorded as missing** | IR-HOCKEY-03 |
| Time on ice distribution for top lines | implemented | `parseNhlClubStats` → `topLine` (avg TOI per game, shifts) |
| Power play % and penalty kill % | **recorded as missing** | IR-HOCKEY-03 |
| Save % for the confirmed starter; adjust for a backup | implemented for the number, **starter unconfirmed** | `parseNhlClubStats` → best save %; `confirmed: false` → IR-HOCKEY-02 |
| Blocked shots per game | **recorded as missing** | IR-HOCKEY-03 |
| Goals scored and conceded in last 5 | implemented | `scheduleFactors` → `recentGames` |
| Back-to-back scheduling flag | implemented | `scheduleFactors` → `backToBack` (previous game within 30 hours) |
| League context (NHL / AHL / European / international) | implemented | `isEuropeanLeague` + per-match `european` flag |
| Social media and analyst sentiment | not used | the prompt says internal-only; no verified source, so nothing is invented |
| Cross-reference odds across two books | **not satisfiable** | IR-HOCKEY-01 |

## Step 2 — market scoring

### Outright winner (100)

| Rule | Status | Test |
|---|---|---|
| Form: 5 wins 25 / 4 wins 18 / 3 wins 11 / ≤2 wins 0 | implemented | `form: the 4/5, 3/5 and 2-or-fewer bands` |
| +5 winning streak of 4+ | implemented | `form: streak bonus and opponent-collapse bonus` |
| +5 opponent lost 4+ of last 5 | implemented | same test |
| Odds: −300 or lower 25 / −200 to −299 18 / −150 to −199 12 / −100 to −149 6 | implemented | `odds bands` |
| Positive odds with strong form 8 | implemented with a documented reading (C-4) | `odds: plus price with strong form` |
| Deduct 8 if shorter than −300 and the goaltender is unconfirmed or a backup | implemented | `odds: short price with an unconfirmed goaltender` |
| Goaltending: >.920 20 / .910-.919 13 / .900-.909 6 / <.900 or backup 0 | implemented | `goaltending bands` + `a confirmed backup scores zero` |
| +5 opposing goaltender below .900 in last 5 starts | implemented | `goaltending: weak opposing starter` |
| Structure: top 5 shots for and top 10 against 20 / top 10 for and mid-table 13 / mid-table both 7 / bottom half both 0 | implemented, **inputs missing** | `structure:` tests; ranks are null today → IR-HOCKEY-03 |
| +5 power play above 25%, −5 penalty kill below 75% | implemented, **inputs missing** | same |
| Home: 60%+ 10 / average 6 / poor or neutral 2 | implemented | `home context:` tests |
| +5 away on a back-to-back, −5 home on a back-to-back | implemented | `home context: 60%+ home wins scores 10 and back-to-backs swing 5 points` |

### Puck line (100)

| Rule | Status | Test |
|---|---|---|
| Outright base with home advantage replaced by the ATS trend (7+ of 10 = 10, 6 = 6, ≤5 = 0) | implemented | `puck line: cover trend, margin, injury…` |
| Goal differential modifier: margin >1.5 +8, <1.5 −8 | implemented | same |
| Key forward line missing −10 regardless of other factors | implemented | `puck line: a missing forward line costs 10 points` |
| Power play 28%+ = +6 | implemented, **input missing** | same |
| Opponent on a back-to-back +7, own team −7 | implemented | same |
| Only recommend when the outright score is 65+ and margins support covering | implemented | `Step 3 puck line` test |

### Game total (100)

| Rule | Status | Test |
|---|---|---|
| Offence: both 3.5+ = 35 / one 3.5+ and other 2.8-3.4 = 22 / both 2.8-3.4 = 12 neutral / below 2.5 = 15 Under | implemented | `total: two 3.5-goal offences…` |
| Goaltending: both <.900 = 25 Over / one <.900 one >.910 = 12 neutral / both >.915 = 20 Under / backup +10 Over | implemented | three separate tests |
| Special teams: combined opportunities >7 = 15 Over / elite PP v poor PK +10 / both PK >85% = 10 Under | implemented, **inputs missing** | `total: two elite starters…` covers the PK route |
| Trends: both Over 4/5 = 20 / both 3/5 = 12 / mixed 5 / both Under 3+ = 15 Under | implemented, needs a posted line | `total:` tests |
| 4.5 line needs 55+ | implemented with a documented reading (C-1) | `gate: a 4.5 line needs a combined offensive score of 55` |
| 5.5 line needs 70+ and both above 3.2 | implemented | `gate: a 5.5 line needs 70 plus both sides above 3.2` |
| 6.5+ needs both above 3.8 and both goalies below .905 | implemented | `totalLineGate` |
| European leagues: thresholds down 0.5 | implemented, no European data | `gate: European leagues shift the effective line down` |

## Step 3 — decision rules

| Rule | Status | Test |
|---|---|---|
| Outright 70+ HIGH, 50-69 MEDIUM, <50 SKIP | implemented | `Step 3 outright` |
| Puck line only when outright 65+; 70+ HIGH, 55-69 MEDIUM, else SKIP | implemented | `Step 3 puck line` |
| Over 4.5 with 55+ = HIGH (primary value play) | implemented | `Step 3 total: 55+ at a 4.5 line is HIGH` |
| Over 4.5 with 45-54 = MEDIUM | implemented (C-2) | same test |
| Over 5.5 only with 70+ and never HIGH | implemented | `Step 3 total: an Over at 5.5 can never be HIGH` |
| Under only with a 65+ defensive score and both goalies above .915, MEDIUM | implemented | `Step 3 total: two starters above .915…` |
| Below 45 across all total factors = SKIP | implemented | `decideTotal` low-score branch |
| Never recommend a puck line on a team winning by under 1.5 | implemented | `supportsCovering` |
| Backup goaltender is the strongest Over indicator (+10) | implemented | `total: a confirmed backup adds 10 points` |
| Back-to-back is the strongest Under and puck line fade | implemented | modifiers in both markets |
| Cap active selections at 6 per day across all markets | implemented | `card: the six-active-pick daily cap` |

## Step 4 — output format

| Rule | Status | Test |
|---|---|---|
| Three predictions per match in the order OUTRIGHT, PUCK LINE, TOTAL | implemented | `three markets are written per match in the order the prompt demands` |
| Minimum 40 words per tip, no exceptions | implemented, validated | `every written tip passes its own validator` |
| Winner bolded and obvious inside the first 20 words | implemented, validated | `the bolded outcome sits inside the first 20 words` |
| No player names, injuries, goaltender names, arena names, odds, line numbers or totals | implemented, validated | the digit ban plus the forbidden-token list; `no tip may contain a digit` |
| General offence/defence analysis allowed, no statistics | implemented | openers and body prose carry no figures |
| No links, citations, brackets or social references | implemented, validated | `the validator rejects links, brackets and internal vocabulary` |
| Puck line tips say who covers, never the line | implemented, validated | `a puck line tip states who covers` |
| Total tips say Over or Under, never the number | implemented, validated | `a game total tip states Over or Under` |
| Every tip in a completely unique style | implemented, validated | 30 distinct angles; `no two tips in one card open with the same word` |
| Confidence LOW / MEDIUM / HIGH on every tip | implemented, validated | validator requires it |
| Below threshold written as SKIP with one explanatory sentence | implemented | `a below-threshold match is written as SKIP` |
| Summary table of active picks and confidence | implemented | `the summary table lists active picks` |
| Back-to-back flag note | implemented | `a card with a tired side names that side` |
| Responsible gambling reminder | implemented | `a data-poor card still publishes a summary…` |
| Banned filler phrases rejected | implemented | `BANNED_PHRASES covers every filler phrase the prompt names` |

## Ice hockey-specific adjustments

| Prompt | Status |
|---|---|
| Goaltender confirmation is the most critical data point | implemented as a hard veto (IR-HOCKEY-02) |
| Over 4.5 is the primary profit vehicle; prioritise it in confidence allocation | implemented — 4.5 is the only line that can reach HIGH |
| Power play efficiency interacts with totals; check the matchup before scoring totals | implemented, **inputs missing** |
| European leagues score lower; adjust thresholds by 0.5 | implemented, no European data (IR-HOCKEY-04) |
| Overtime and shootouts add variance to close calls | stated on the page; NHL moneyline includes overtime, so no separate rule |
| Empty-net goals make Unders riskier late | stated in the method copy; no numeric rule in the prompt to implement |
| Physical defensive teams with elite goaltending push games Under | implemented through the Under ledger (both starters >.915 + 65+ defensive score) |

## What never appears in output

Enforced by `validateIceHockeyTip`: digits, links, brackets, social handles,
internal vocabulary (model, edge, implied probability, threshold, backtest,
filter), banned filler, repeated openers, and any tip under 40 words. A tip that
fails is withheld on the page and the violation is printed instead.
