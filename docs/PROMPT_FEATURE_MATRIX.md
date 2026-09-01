# Prompt-to-feature matrix

Verified against this repository on **2026-08-31**.

This document maps the supplied **TENNIS PREDICTION MASTER PROMPT v1.0** to the
actual code, data and documented blockers in the repo. It is intentionally
mechanical: every row states whether the prompt line is implemented, partially
implemented, blocked, patched, or explicitly excluded.

## Status legend

- **IMPLEMENTED** — present in code and used
- **PATCHED** — implemented, but not literally; the repo documents and fixes a defect in the prompt
- **PARTIAL** — some data/logic exists, but the prompt requirement is broader than what is honestly sourced or scored
- **BLOCKED** — not honestly achievable in the current free public no-key source stack
- **EXCLUDED** — deliberately not used because the source would be unsound or against terms
- **ENFORCED** — output rule is mechanically validated

## Primary evidence files

- `engine/engine.js`
- `engine/writer.js`
- `engine/espn.js`
- `engine/tournament.js`
- `engine/surface.js`
- `engine/join.js`
- `engine/olbg.js`
- `assets/js/collector.js`
- `assets/js/app.js`
- `scripts/collect_olbg.py`
- `docs/PROMPT_REVIEW.md`
- `docs/SOURCES.md`
- `docs/LIVE_DATA.md`
- `docs/IRREGULARITIES.md`
- `data/slate.json`
- `data/provenance.json`

---

## Step 1 — Data collection

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Current moneyline odds from at least two sources | **BLOCKED** | ESPN odds endpoint verified empty; OLBG server-rendered HTML has no structured odds | `IR-01` | `docs/SOURCES.md`, `docs/IRREGULARITIES.md`, `engine/engine.js` |
| Current first set winner odds from at least two sources | **BLOCKED** | Same as above | `IR-01` | same |
| Current games handicap line from at least two sources | **PARTIAL** | OLBG event pages can expose some `Games Won` selection labels in server-rendered HTML | No cross-bookmaker pricing; line labels are only observed when event pages are fetched | `scripts/collect_olbg.py`, `scripts/lib/olbg_parse.py`, `data/slate.json` |
| Cross-reference line movement | **BLOCKED** | No verified multi-book odds feed in repo | `IR-01` | `docs/SOURCES.md`, `docs/IRREGULARITIES.md` |
| Last 5 match results from the last month | **IMPLEMENTED** | ESPN scoreboard tape over prior days | None | `assets/js/collector.js`, `engine/espn.js` |
| Last two weeks weighted double | **PARTIAL** | Recent form exists, but the prompt's Step 2 bands do not actually use weighted scoring | Prompt defect documented | `docs/PROMPT_REVIEW.md`, `engine/engine.js` |
| Current ATP/WTA world ranking for both players | **IMPLEMENTED** | ESPN rankings endpoint | None | `assets/js/collector.js`, `engine/espn.js` |
| Ranking trajectory noted | **IMPLEMENTED** | ESPN rankings current vs previous ranking | Trajectory is collected; prompt under-specifies how to score it | `engine/espn.js`, `assets/js/app.js`, `docs/PROMPT_REVIEW.md` |
| Surface-specific record for current surface in last 12 months | **IMPLEMENTED** | Derived from recorded match tape + tournament surface map | Surface must resolve from map; unresolved tournaments stay null | `engine/espn.js`, `engine/surface.js`, `data/surfaces.json` |
| Head-to-head over last 3 years | **PARTIAL** | H2H built from the recent tape in live mode | Live tape is 120 days, not a guaranteed 3-year store | `assets/js/collector.js`, `engine/espn.js`, `docs/LIVE_DATA.md` |
| Weight H2H heavily toward same-surface meetings | **PARTIAL** | Same-surface H2H orientation exists for one deduction | Prompt mentions heavy weighting more broadly than it actually scores | `engine/tournament.js`, `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Tournament round and context | **IMPLEMENTED** | ESPN scoreboard round + coded tournament level from source rows | None | `engine/tournament.js`, `assets/js/collector.js` |
| Early rounds favour big servers / later rounds favour baseline consistency | **PARTIAL** | Stage is scored | Specific stylistic distinction is not independently sourced/scored | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Recent straight-set win rate for favourite | **IMPLEMENTED** | Derived from recent completed matches | None | `engine/espn.js`, `engine/engine.js` |
| First set win rate for favourite over last 10 on this surface | **IMPLEMENTED** | Derived from recent completed matches on that surface when sample exists | Small samples stay null | `engine/espn.js`, `engine/engine.js` |
| Fatigue and scheduling context | **PARTIAL** | Days since last match, last-match set count, and three-setter-in-last-day proxy are derived | Prompt asks for more than it scores | `engine/espn.js`, `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Days rest | **IMPLEMENTED** | Derived from prior completed match date | Day-granular only | `engine/espn.js` |
| Number of sets played in previous rounds | **PARTIAL** | Last match set count exists | Not fully aggregated across tournament rounds | `engine/espn.js`, `docs/PROMPT_REVIEW.md` |
| Back-to-back scheduling | **PARTIAL** | `played3SetsLast24h` proxy exists | Date granularity makes this approximate by calendar day | `engine/espn.js` |
| Injury and physical condition reports | **BLOCKED** | No free structured source verified | `IR-13` | `docs/SOURCES.md`, `docs/IRREGULARITIES.md` |
| Assess impact on serve speed, movement or endurance | **BLOCKED** | No verified injury/biomechanics feed in repo | `IR-13` | same |
| Social media and analyst sentiment from X | **EXCLUDED** | Not used | Paid API / ToS-restricted scraping | `docs/SOURCES.md`, `docs/IRREGULARITIES.md` |
| Social media and analyst sentiment from specialist sites | **BLOCKED** | No verified free structured source used | `IR-13` | same |
| Use sentiment internally only | **N/A / BLOCKED** | No sentiment source used | same blocker | same |
| Cross-reference all odds across minimum two bookmakers | **BLOCKED** | No verified two-book source in repo | `IR-01` | same |

---

## Step 2 — Win Match market

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Score Win Match market out of 100 | **IMPLEMENTED** | Engine market with component bookkeeping | None | `engine/engine.js` |
| Recent Form factor (25 pts) | **IMPLEMENTED** | Last-5 form from ESPN tape | None | `engine/engine.js`, `engine/espn.js` |
| Won last 5 = 25 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Won 4 of last 5 = 18 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Won 3 of last 5 = 10 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Won 2 or fewer = 0 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Bonus +5 tournament winning streak of 3+ | **IMPLEMENTED** | derived from recent event sequence | None | `engine/espn.js`, `engine/engine.js` |
| Bonus +5 if opponent lost last match in straight sets | **IMPLEMENTED** | derived from opponent's latest completed match | None | `engine/espn.js`, `engine/engine.js` |
| Odds and Value Assessment (25 pts) | **PATCHED** | Market band exists only when odds exist | Prompt labels implied probability as value | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Odds -300 or shorter = 25 | **IMPLEMENTED WHEN SOURCED** | price band logic exists | No free live odds | `engine/engine.js`, `docs/IRREGULARITIES.md` |
| Odds -200 to -299 = 18 | **IMPLEMENTED WHEN SOURCED** | same | `IR-01` in live use | same |
| Odds -150 to -199 = 12 | **IMPLEMENTED WHEN SOURCED** | same | `IR-01` | same |
| Odds -100 to -149 = 6 | **IMPLEMENTED WHEN SOURCED** | same | `IR-01` | same |
| Positive odds with strong form support = 8 | **PATCHED** | repo awards 8 when plus-money odds are present | “strong form support” was undefined in prompt | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Deduct 10 if shorter than -500 and weak surface form | **IMPLEMENTED WHEN SOURCED** | explicit deduction exists | Live odds absent | `engine/engine.js`, `docs/IRREGULARITIES.md` |
| Ranking Advantage factor (20 pts) | **IMPLEMENTED** | ESPN rankings | Prompt leaves gaps | `engine/engine.js`, `engine/espn.js` |
| Top 20 vs outside top 100 = 20 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Top 20 vs 50 to 99 = 14 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Top 20 vs 21 to 49 = 8 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Both outside top 50 = 4 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Deduct 5 if lower-ranked player won 2+ of last 3 same-surface meetings | **IMPLEMENTED WHEN SOURCED** | H2H orientation helper | Same-surface H2H may be missing | `engine/tournament.js`, `engine/engine.js` |
| Surface-Specific Form factor (20 pts) | **PATCHED** | surface record exists | Prompt's raw win-count logic is corrected to rate-based scoring by default | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| 3+ wins including a title = 20 | **IMPLEMENTED ONLY IF PATCH DISABLED** | literal v1.0 behavior retained behind flag | Prompt defect | `engine/engine.js` |
| 2 wins = 13 | **IMPLEMENTED ONLY IF PATCH DISABLED** | literal v1.0 behavior retained behind flag | Prompt defect | `engine/engine.js` |
| 1 win or limited matches = 6 | **PATCHED** | sample-sensitive rate scoring | Prompt defect | `engine/engine.js` |
| 0 wins = 0 | **IMPLEMENTED** | both literal and patched logic can yield 0 | None | `engine/engine.js` |
| Bonus +5 if opponent has documented poor record on surface | **IMPLEMENTED WHEN SAMPLE EXISTS** | opponent losing record on surface over a minimum sample | Only fires when opponent surface sample is meaningful | `engine/espn.js`, `engine/engine.js` |
| Tournament Stage and Context factor (10 pts) | **IMPLEMENTED** | coded tournament level + round | Some tournament coding decisions are documented assumptions | `engine/tournament.js`, `engine/engine.js` |
| Grand Slam quarter-final or later = 10 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| ATP Masters or WTA 1000 knockout stage = 8 | **IMPLEMENTED** | direct band | Prompt leaves “knockout stage” ambiguous; repo documents its coding | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Early rounds of any tournament = 5 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Qualifying or lower-tier event = 2 | **IMPLEMENTED** | direct band | None | `engine/engine.js`, `engine/tournament.js` |
| Add 3 if favourite beat higher-ranked player this tournament | **BLOCKED** | No trustworthy per-match historical opponent ranking from live feed | `IR-17` | `docs/LIVE_DATA.md`, `docs/IRREGULARITIES.md`, `engine/espn.js` |

---

## Step 2 — First Set Winner market

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Score First Set Winner separately out of 100 | **PATCHED** | independent first-set scoring logic exists | Literal prompt logic was defective and non-discriminating | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Use win match base score, then apply modifiers | **PATCHED** | repo rescales instead of inheriting the broken base literally | `IR-11` | same |
| Replace tournament stage with first set win rate | **IMPLEMENTED** | first-set win rate factor exists | Requires sample | `engine/engine.js`, `engine/espn.js` |
| 70%+ = 10 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| 60–69% = 6 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Below 60% = 0 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Serving advantage +8 | **BLOCKED IN LIVE SOURCE STACK** | Modifier exists in code | ESPN tennis competitor statistics are empty | `IR-16` | `engine/engine.js`, `docs/LIVE_DATA.md`, `docs/IRREGULARITIES.md` |
| Significantly higher first-serve % and ace rate | **PATCHED / BLOCKED LIVE** | explicit threshold coded | Live serve stats absent | `engine/engine.js` |
| Slow starter -5 | **IMPLEMENTED WHEN SOURCED** | field exists in model | No free structured source currently fills it | `IR-13` | `engine/engine.js`, `engine/espn.js` |
| Favourite played a 3-set match within last 24 hours = -6 | **IMPLEMENTED** | derived from recent completed match date + sets | day-granular proxy | `engine/engine.js`, `engine/espn.js` |
| Opponent played a long match recently = +5 | **IMPLEMENTED** | same | same | `engine/engine.js`, `engine/espn.js` |
| Optimal odds range -150 to -500, else -5 | **IMPLEMENTED WHEN SOURCED** | price modifier exists | Live odds absent | `engine/engine.js`, `docs/IRREGULARITIES.md` |

---

## Step 2 — Games Handicap market

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Only score handicap when win match score reaches 65+ | **IMPLEMENTED** | explicit gate | None | `engine/engine.js` |
| Never recommend handicap bets on close matches | **IMPLEMENTED** | explicit gate + skip reason | None | `engine/engine.js` |
| Ranking gap modifier (30 pts) | **IMPLEMENTED** | rankings | None | `engine/engine.js` |
| Top 20 vs outside top 100 = 30 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Top 20 vs 50 to 99 = 20 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Top 20 vs 21 to 49 = 10 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Closely ranked players = 0 | **IMPLEMENTED** | default fallback | None | `engine/engine.js` |
| Straight-set win rate factor (25 pts) | **IMPLEMENTED** | last three matches from ESPN tape | None | `engine/engine.js`, `engine/espn.js` |
| Won last 3 in straight sets = 25 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Won 2 of last 3 in straight sets = 16 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Won 1 of last 3 in straight sets = 6 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| No recent straight-set wins = 0 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Handicap line value factor (25 pts) | **IMPLEMENTED WHEN SOURCED** | logic exists for odds band | Live price is missing | `engine/engine.js`, `docs/IRREGULARITIES.md` |
| Near-even price = 25 | **IMPLEMENTED WHEN SOURCED** | direct band | `IR-01` | `engine/engine.js` |
| -120 to -180 = 15 | **IMPLEMENTED WHEN SOURCED** | direct band | `IR-01` | `engine/engine.js` |
| Shorter than -180 = 5 | **IMPLEMENTED WHEN SOURCED** | direct band | `IR-01` | `engine/engine.js` |
| Surface dominance factor (20 pts) | **IMPLEMENTED** | recent wins by 6+ games on surface | Requires surface + set scores | `engine/espn.js`, `engine/engine.js` |
| Multiple recent wins by 6+ games = 20 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Inconsistent margins = 8 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Tight matches even in wins = 0 | **IMPLEMENTED** | direct band | None | `engine/engine.js` |
| Profitability filter: win match 65+ | **IMPLEMENTED** | gate | None | `engine/engine.js` |
| Profitability filter: at least 2 of last 3 straight sets | **IMPLEMENTED** | gate | None | `engine/engine.js` |
| Profitability filter: handicap odds between -120 and +110 | **IMPLEMENTED WHEN SOURCED** | gate exists | Live price absent | `engine/engine.js` |

---

## Step 3 — Bet decision rules

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Win Match score 70+ = HIGH | **IMPLEMENTED** | explicit band | None | `engine/engine.js` |
| Win Match score 50–69 with 2+ factors aligned = MEDIUM | **PATCHED** | MEDIUM band exists | “factors aligned” undefined in prompt; repo documents extra guard | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Win Match below 50 = SKIP/LOW | **IMPLEMENTED** | LOW band / withheld betting intent | None | `engine/engine.js`, `engine/writer.js` |
| First Set score 70+ = HIGH | **IMPLEMENTED** | explicit band | Depends on patched independence fix | `engine/engine.js` |
| First Set score 55–69 = MEDIUM | **IMPLEMENTED** | explicit band | None | `engine/engine.js` |
| First Set below 55 = SKIP | **IMPLEMENTED** | LOW / SKIP behavior in writer | None | `engine/engine.js`, `engine/writer.js` |
| Games Handicap only activates when win match 65+ | **IMPLEMENTED** | explicit gate | None | `engine/engine.js` |
| Handicap 70+ = HIGH | **IMPLEMENTED** | explicit band | None | `engine/engine.js` |
| Handicap 55–69 = MEDIUM | **IMPLEMENTED** | explicit band | None | `engine/engine.js` |
| Handicap below 55 or win match below 65 = SKIP | **IMPLEMENTED** | explicit gate + band | None | `engine/engine.js` |
| Never recommend win match shorter than -500 unless surface form 18+ | **IMPLEMENTED WHEN PRICE EXISTS** | explicit block | Live odds absent | `engine/engine.js` |
| Never recommend first set shorter than -500 | **IMPLEMENTED WHEN PRICE EXISTS** | explicit block | Live odds absent | `engine/engine.js` |
| Avoid set betting and total games entirely | **IMPLEMENTED AS POLICY** | model only writes three markets | Prompt cites negative EV without evidence; repo treats as policy rather than fact | `engine/writer.js`, `docs/PROMPT_REVIEW.md` |
| If 3+ matches score below 55 across all markets, reduce to top 3 | **IMPLEMENTED WITH DOCUMENTED INTERPRETATION** | card trimming exists | Prompt wording ambiguous; repo documents its interpretation | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |

---

## Step 4 — Output format

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Write three separate predictions per match in exact order | **IMPLEMENTED** | writer emits win match, first set, handicap in order | Unscored matches are reported, not fabricated | `engine/writer.js` |
| Minimum 40 words per tip | **ENFORCED** | validator checks word count | None | `engine/writer.js`, `tests/writer.test.mjs` |
| Predicted winner/outcome bolded within first 20 words | **ENFORCED** | validator checks bold marker position | Prompt conflict documented | `engine/writer.js`, `docs/IRREGULARITIES.md` |
| No player names used more than once per tip | **ENFORCED** | validator counts occurrences | None | `engine/writer.js` |
| Use descriptors after first mention | **IMPLEMENTED** | anonymous descriptors | None | `engine/writer.js` |
| No odds figures in output | **ENFORCED** | no digits rule | None | `engine/writer.js` |
| No handicap lines in output | **ENFORCED** | no digits rule + wording guard | None | `engine/writer.js` |
| No set scores in output | **ENFORCED** | no digits rule | None | `engine/writer.js` |
| No total games numbers in output | **ENFORCED** | no digits rule | None | `engine/writer.js` |
| No injury details | **ENFORCED** | forbidden token checks | None | `engine/writer.js` |
| No tournament draws | **PARTIAL / ENFORCED BY STYLE** | writer does not emit draws | No dedicated draw-token list, but no sourced draw detail is written | `engine/writer.js` |
| No coach names | **ENFORCED** | forbidden token list | None | `engine/writer.js` |
| No stadium references | **ENFORCED** | forbidden token list | None | `engine/writer.js` |
| No links | **ENFORCED** | forbidden token list blocks `http` / `www.` | None | `engine/writer.js` |
| No source citations | **ENFORCED** | writer never emits them; bracket checks block references | None | `engine/writer.js` |
| No bracket references | **ENFORCED** | validator blocks brackets | None | `engine/writer.js` |
| No social media mentions | **ENFORCED** | forbidden token list blocks common tokens | None | `engine/writer.js` |
| For handicap tips, state only who will cover | **ENFORCED** | writer uses abstract cover phrasing | None | `engine/writer.js` |
| Every tip in a unique style | **PARTIAL / ENFORCED UP TO POOL LIMIT** | opener pool and validator enforce distinct openings | Finite opener pool documented as `IR-08` | `engine/writer.js`, `docs/IRREGULARITIES.md` |
| Confidence LOW/MEDIUM/HIGH on every tip | **ENFORCED** | validator checks confidence string | None | `engine/writer.js` |
| Below-threshold matches written as SKIP with single explanatory sentence | **ENFORCED** | validator checks SKIP shape | None | `engine/writer.js` |
| End full card with summary table | **IMPLEMENTED** | summary renderer | None | `assets/js/app.js` |
| Flag handicap skips due to insufficient dominance evidence | **IMPLEMENTED** | summary note + flags | None | `assets/js/app.js`, `engine/engine.js` |
| Responsible gambling reminder | **IMPLEMENTED** | site footer + copied card text | None | `index.html`, `assets/js/app.js` |

---

## Style requirements — strict enforcement section

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| No two tips in same output may open with same word | **ENFORCED UP TO POOL LIMIT** | unique opener pool | `IR-08` when pool exhausted | `engine/writer.js` |
| No two tips may open with same phrase or sentence structure | **PARTIAL** | curated distinct opener clauses | Not formally parsed beyond opener pool | `engine/writer.js` |
| Banned filler phrase: this should be straightforward | **ENFORCED** | validator | None | `engine/writer.js` |
| Banned filler phrase: a tough match | **ENFORCED** | validator | None | `engine/writer.js` |
| Banned filler phrase: could go either way | **ENFORCED** | validator | None | `engine/writer.js` |
| Banned filler phrase: hard to call | **ENFORCED** | validator | None | `engine/writer.js` |
| Banned filler phrase: the better player | **ENFORCED** | validator | None | `engine/writer.js` |
| Banned filler phrase: on paper | **ENFORCED** | validator | None | `engine/writer.js` |
| Winner must be clear within first 20 words without numerical data | **ENFORCED** | bold-position check + no-digit rule | None | `engine/writer.js` |

---

## Tennis-specific adjustments

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Clay form is the single most predictive surface factor | **PARTIAL / POLICY PRIOR** | surface is a major factor | Statement itself is unsourced | `docs/PROMPT_REVIEW.md`, `engine/engine.js` |
| Weight surface record above general ranking when they conflict | **PARTIAL** | surface is scored heavily and patched more sensibly | No explicit override rule between factors | `engine/engine.js` |
| Grand Slams and Masters produce most reliable predictions | **PARTIAL / POLICY PRIOR** | stage weighting favors them | Statement itself unsourced | `docs/PROMPT_REVIEW.md`, `engine/engine.js` |
| Early-round upsets more common in 250/500s | **PARTIAL / POLICY PRIOR** | stage weighting implicitly reflects lower confidence | Not separately verified/calibrated in live code | `engine/engine.js` |
| Serve stats are strongest predictor of first set outcomes | **PARTIAL / BLOCKED LIVE** | first-set market has serve modifier hook | Live serve stats unavailable from ESPN | `IR-16` | `engine/engine.js`, `docs/LIVE_DATA.md` |
| Example: 68% first serve and 8 aces per match | **BLOCKED LIVE** | no live source in repo provides these stats | `IR-16` | same |
| Three-set matches within 24h are performance depressor | **IMPLEMENTED AS POLICY RULE** | explicit fatigue modifier exists | “documented” claim in prompt is uncited | `engine/engine.js`, `docs/PROMPT_REVIEW.md` |
| Women's tennis tighter scorelines on average than men's | **PARTIAL / UNSOURCED** | no blanket numeric adjustment applied | Prompt claim not verified in repo | `docs/PROMPT_REVIEW.md`, `docs/IRREGULARITIES.md` |
| Adjust handicap expectations downward for WTA | **BLOCKED / NOT APPLIED** | repo intentionally does not apply a numeric WTA handicap conversion | `IR-12` | `docs/IRREGULARITIES.md`, `engine/engine.js` |
| WTA -3.5 roughly equals ATP -5.5 | **BLOCKED / NOT APPLIED** | not implemented | `IR-12` | same |
| Retirement and walkover risk exists | **PARTIAL** | physical-concern flag can void handicap if sourced | No free structured source for live physical concerns | `engine/engine.js`, `engine/espn.js`, `docs/SOURCES.md` |
| Note physical concerns before recommending handicap | **PARTIAL** | model supports skip on `physicalConcernCited` | field currently unsourced | `engine/engine.js`, `engine/espn.js` |
| Retirement voids bet in most markets | **PARTIAL / NOT ASSERTED AS FACT** | repo flags risk rather than asserting settlement policy | bookmaker rules vary | `docs/PROMPT_REVIEW.md`, `docs/IRREGULARITIES.md` |

---

## What never appears in output

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Scores never appear | **ENFORCED** | no-digits rule | None | `engine/writer.js` |
| Factor breakdowns never appear | **IMPLEMENTED** | writer uses prose only; components stay internal | None | `engine/writer.js` |
| Odds figures never appear | **ENFORCED** | no-digits rule | None | `engine/writer.js` |
| Handicap lines never appear | **ENFORCED** | no-digits rule + line-language guard | None | `engine/writer.js` |
| Total games numbers never appear | **ENFORCED** | no-digits rule | None | `engine/writer.js` |
| Set betting lines never appear | **ENFORCED** | no-digits rule | None | `engine/writer.js` |
| Source names never appear | **IMPLEMENTED** | writer does not emit sources | None | `engine/writer.js` |
| Player physical condition details never appear | **ENFORCED** | forbidden tokens + absent source | None | `engine/writer.js` |
| Coach references never appear | **ENFORCED** | forbidden tokens | None | `engine/writer.js` |
| Stadium names never appear | **ENFORCED** | forbidden tokens | None | `engine/writer.js` |
| Social media references never appear | **ENFORCED** | forbidden tokens | None | `engine/writer.js` |
| Staking advice never appears | **IMPLEMENTED** | no staking language in writer | None | `engine/writer.js` |
| Internal reasoning never appears | **PARTIAL** | output is prose only, not factor table | The writer still states method-level caveats such as “nothing beyond the sourced record has been assumed” | `engine/writer.js` |
| Only prediction, bolded winner/outcome, confidence, summary table, handicap skip flags displayed | **IMPLEMENTED** | site output follows this pattern | None | `assets/js/app.js`, `engine/writer.js` |

---

## OLBG / site / process requirements appended after the model prompt

| Prompt line | Repo status | Source used / verified basis | Blocker / irregularity | File reference |
|---|---|---|---|---|
| Look up all available markets on OLBG currently available | **PARTIAL** | repo collects OLBG index rows and can enrich event pages for market lists | Current committed snapshot verifies event-page markets only where fetched; not every row is guaranteed verified | `scripts/collect_olbg.py`, `data/slate.json`, `engine/olbg.js`, `assets/js/app.js` |
| Collect all openly available OLBG markets | **PARTIAL** | market names are collected when event pages are fetched | Structured odds remain absent; unverified rows stay labeled unverified | same |
| Include OLBG markets in a scoreboard with calendar functionality | **IMPLEMENTED** | dedicated OLBG markets tab + calendar grid + scoreboard overlay | Uses committed snapshot, not live OLBG fetch in browser | `index.html`, `assets/js/app.js`, `assets/css/styles.css`, `engine/olbg.js` |
| Use free publicly available APIs and public results/upcoming matches | **IMPLEMENTED WITH DOCUMENTED LIMITS** | ESPN public JSON + OLBG public pages + verified Sackmann mirrors | Some desired features still blocked in free stack | `docs/SOURCES.md`, `docs/LIVE_DATA.md` |
| Collect player stats, dates, match stats | **IMPLEMENTED WITH DOCUMENTED LIMITS** | ESPN tape and rankings; surface map from mirrors | Serve/injury/sentiment gaps remain | `engine/espn.js`, `assets/js/collector.js` |
| Aim for complete backtesting | **IMPLEMENTED WITH DOCUMENTED LIMITS** | walk-forward historical backtest exists | No odds => no value/profitability claim | `scripts/backtest_historical.mjs`, `docs/BACKTEST.md` |
| Aim for forward collection | **IMPLEMENTED** | prediction recording + settlement scripts | Handicap grading stays void without line | `scripts/collect_espn.mjs`, `scripts/record_predictions.mjs`, `docs/LIVE_DATA.md` |
| Provide links for manual review | **IMPLEMENTED** | site now shows ESPN/OLBG/surface-map links where applicable | None | `assets/js/app.js` |
| No manual input | **PARTIAL** | collection and site operation are automated from public sources | Full odds/injury/sentiment compliance would still require an external source not presently available in free no-key form | `docs/SOURCES.md`, `docs/IRREGULARITIES.md` |
| Flag irregularities for review | **IMPLEMENTED** | machine-readable + human-readable irregularity registers | None | `data/provenance.json`, `docs/IRREGULARITIES.md`, `assets/js/app.js` |
| Verify no hallucinations | **IMPLEMENTED AS PROJECT POLICY** | unsourced fields stay null, unscoreable matches stay unscored, output is validated | None | `README.md`, `engine/engine.js`, `engine/writer.js` |
| Create a GitHub Page for the repo | **PARTIAL / DEPLOYMENT READY** | Pages site already exists; workflow files have been created in this checkout for Actions deployment | Remote installation of `.github/workflows/*` from this Arena session is blocked by missing `workflows` permission (`IR-20`) | `index.html`, `.github/workflows/pages.yml`, `README.md`, `docs/IRREGULARITIES.md` |
| Clean UI, user friendly, simple | **IMPLEMENTED** | static tabbed UI with scoreboard/calendar/predictions/quality/OLBG | subjective design requirement; implementation present | `index.html`, `assets/css/styles.css`, `assets/js/app.js` |
| Previous results, current matches, upcoming matches | **IMPLEMENTED** | ESPN scoreboard by date with phase filters | Depends on ESPN reachability in browser | `assets/js/collector.js`, `assets/js/app.js` |
| Generate written predictions with a click | **IMPLEMENTED** | Predict buttons + generate-all button | Unscored matches remain withheld | `assets/js/app.js`, `engine/writer.js` |
| Predictions should be copy/paste ready | **IMPLEMENTED** | per-tip copy + full-card copy | None | `assets/js/app.js` |
| Generate predictions for every upcoming match | **PARTIAL** | engine attempts all scoreable matches on the live card | Matches with insufficient sourced data remain unscored by design | `engine/engine.js`, `engine/writer.js`, `docs/LIVE_DATA.md` |
| Give each prediction a score/confidence level | **IMPLEMENTED** | HIGH/MEDIUM/LOW/SKIP bands | None | `engine/engine.js`, `engine/writer.js`, `assets/js/app.js` |

---

## Bottom line

The repo already satisfies a large share of the prompt **honestly**, especially
on:

- live scoreboard/calendar UX
- prediction generation
- output-rule enforcement
- backtesting / forward collection
- provenance and irregularity tracking
- source transparency

The main gap between the prompt and full compliance is not coding effort; it is
**data availability**. The exact prompt still requires inputs that are not
honestly available from the repo's verified free public no-key source stack:

- cross-bookmaker odds and line movement (`IR-01`)
- serve percentage / ace-rate live feed (`IR-16`)
- structured injury / physical-condition reporting (`IR-13`)
- X/social sentiment (`IR-13`)

Those gaps are exposed rather than hidden, which is what keeps the project in
bounds for the stated "no hallucinations" requirement.
