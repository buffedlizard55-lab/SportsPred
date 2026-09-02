# GREYHOUND RACING PREDICTION MASTER PROMPT v1.0 — line-by-line review

How each instruction is implemented in code, and what the sources do not
support. Engine: [`engine/greyhound_engine.js`](../engine/greyhound_engine.js),
writer: [`engine/greyhound_writer.js`](../engine/greyhound_writer.js),
data: [`engine/greyhound_data.js`](../engine/greyhound_data.js) +
[`engine/greyhound_gbgb.js`](../engine/greyhound_gbgb.js),
card: [`engine/greyhound_card.js`](../engine/greyhound_card.js).

## Step 1 — data collection

| Prompt line | Implementation | Status |
|---|---|---|
| Win odds from two sources, line movement | Not available free/key-less; odds component scored missing live; SP used for settled backtest | ⚠️ IR-GH-01 |
| Last 5 results: position, distance, track, grade | GBGB `/results/dog/{id}` history, parsed by `parseDogHistory`; profiles in `buildRunnerProfile` | ✅ |
| Trap draw today + record from that trap | meeting `traps[].trapNumber` + history filter in `scoreTrapAndDistance` | ✅ |
| Race distance + form over exact/comparable distance | `raceDistance`; comparable within 20 m; exact-match bonus | ✅ |
| Track-specific performance | history `trackName`; `scoreTrackAndGrade` | ✅ |
| Grade today vs recent grades | `gradeRank` / `gradeShift` (A1–A11, D, S, H, OR) | ✅ |
| Market moves / drifts / support | No free feed; live odds missing | ⚠️ IR-GH-01 |
| Timeform verdict, tip sheets, summaries | Paywalled; never scored/paraphrased | ⚠️ IR-GH-02 |
| Social / X sentiment | Never collected; forbidden in output by prompt | ⚠️ IR-GH-03 |
| Scratchings / withdrawals | Vacant traps detected on settled cards; live draw from official racecard | ✅ |

## Step 2 — scoring (out of 100)

| Component | Code | Notes |
|---|---|---|
| Recent form 35 pts, tiers verbatim | `scoreForm` | 3+places incl. win = 35; 3 places no win = 22; 2 incl. win = 15; 2 no win = 8; else 0 |
| +5 won most recent | `form_last_win` | |
| +5 two wins in last three | `form_hot` | |
| Last two runs weighted more | `form_recent2` + recency-tied profile; tier uses the 5-race string | ✅ adjustment |
| Odds & value 25 pts tiers | `scoreOdds` | live → missing; backtest maps SP probability to the American-odds tiers; -200 or shorter = 0; +400 inconsistent = handled via form gate |
| Trap 20 pts tiers | `scoreTrapAndDistance` | 2+ wins from trap = 20; placed no win = 12; no data but strong form = 6; underperformed = 0 |
| +5 distance matches last win | `dist_match` | |
| Distance specialist adjustment | `dist_specialist` (+6) | repeat winners at the trip; wrong-trip dogs flagged missing |
| Track & grade 20 pts tiers | `scoreTrackAndGrade` | win at track & same/lower grade = 20; placed same grade = 13; no track but dropping = 8; big rise = 0 |
| −5 moving up two grades | `grade_rise_pen` via `gradeShift >= 2` | |
| Grade drop adjustment | droppers credited in track/grade tier | ✅ |

## Step 3 — selection rules

| Rule | Implementation |
|---|---|
| Primary 70+ / secondary 60–69 / value 75+ odds bands | odds tiers `RULES`; without a live price the odds bands can't gate selection — score thresholds and evidence gates still apply; HIGH requires a measured price (backtest only) |
| Skip < 55 | `decide` hardSkip |
| Skip odds < -200 | odds tier scores 0 at short prices; confidence falls |
| Skip ≤2 top-three in last 5 | placed-run count gate (`formString` positions 1–3) |
| +500 trap bet guard | expressed via form-evidence gate; price leg untestable live (IR-GH-01) |
| Max 5–7 races, ≥2 tracks | `buildDailyCard` round-robin by track, cap 7 |
| Prioritise 15-point gap | `clearGap` sorts picks |
| ≤2 high-odds plays | odds-gated; recorded as untestable live |
| ≥3 sub-55 races reduces the card | selections naturally contract; cap and skip reporting surface it |

## Step 4 — output format

Enforced by `validateGreyhoundTip` / `validateGreyhoundCard` (tests in
`tests/greyhound_engine.test.mjs`):

- ≥40 words; winner **bolded** inside the first 15 words; LOW/MEDIUM/HIGH on
  every tip; no numerals, prices, source names, links, brackets, staking or
  risk language; no negative rival language; one unique opener and angle per
  tip; NO SELECTION is a single explanatory sentence; the day ends with a
  summary table (track, time, selection, trap, confidence) and the
  responsible-gambling reminder.

## No hallucination guarantees

1. Every scored component records its points and the triggering fact; factors
   with no source are `missing:true`, listed in `missing[]`, and lower the
   confidence ceiling.
2. Races without a qualifying runner read NO SELECTION with the reason — never
   a forced pick.
3. Every race card carries official review links (GBGB meeting record, GBGB
   results site, Sporting Life racecard, OLBG market).
4. All facts trace to GBGB payloads (or the OLBG/Sporting Life slate, display
   only). Data collection runs in CI; the collector aborts on fetch failure.
