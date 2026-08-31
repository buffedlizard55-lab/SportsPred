# Prompt review — TENNIS PREDICTION MASTER PROMPT v1.0

Line-by-line review. Each finding is marked:

- **DEFECT** — the rule does not do what it claims, or contradicts itself
- **GAP** — the rule is incomplete; a real case falls through it
- **UNSOURCED** — the rule asserts a fact with no evidence behind it
- **INFEASIBLE** — the rule cannot be met from free public data
- **OK** — implementable as written

Everything marked DEFECT or GAP is either patched behind a named flag in
`engine/engine.js` or recorded in `data/provenance.json`. Nothing was silently
"fixed" — each change is listed here with the test that covers it.

---

## Step 1 — Data collection

| Requirement | Verdict | Finding |
|---|---|---|
| Odds from ≥2 bookmakers, cross-referenced for line movement | **INFEASIBLE** | OLBG publishes no structured prices. The tips index and event pages are server-rendered, but odds are injected client-side into the betslip. The only price text observed anywhere was inside free-text tipster prose on event 899350. A price aggregator (The Odds API, Betfair) is required and every one needs an API key, which conflicts with "no manual input". Tracked as **IR-01**. |
| Last 5 results, last month, last two weeks double-weighted | **DEFECT** | The instruction says double-weight the last two weeks, but the Step 2 scoring band only counts wins out of 5. There is no weighting mechanism anywhere in the scoring rules, so the weighting instruction has no effect. Either the band needs weighted input or the instruction should be dropped. |
| Current ATP/WTA ranking + trajectory | **GAP** | Ranking is collected but "trajectory" is never scored. Step 2 uses only the static ranking band. The rising-at-80-vs-falling-at-40 example is never applied. |
| Surface record, last 12 months | **OK** | Implementable, but see the Step 2 defect below on how it is scored. |
| H2H over last 3 years, weighted to same surface | **GAP** | Only one narrow use: a −5 deduction when the underdog leads the last 3 same-surface meetings. The "weighted heavily" instruction is not reflected anywhere else. |
| Tournament round and context | **OK** | Scored. Note OLBG does not publish round or event on the tips index (**IR-04**), so it must come from ATP/WTA. |
| Straight-set win rate for the favourite | **OK** | Used in the handicap market. |
| First-set win rate, last 10, this surface | **OK** | Used in the first-set market. |
| Fatigue: days rest, sets played, back-to-back | **GAP** | Only one fatigue rule exists — a 3-setter in the last 24 hours. "Days rest" and "number of sets in previous rounds" are collected but never scored. |
| Injury and physical condition | **GAP / UNSOURCED** | No free structured source exists. The prompt asks for impact on serve speed, movement and endurance specifically, but Step 2 has no injury factor at all — the only place physical condition appears is a void-bet warning on the handicap market. |
| Social/analyst sentiment from X and specialist sites | **INFEASIBLE** | X requires paid API access; scraping it breaches its terms. No free equivalent. Excluded entirely rather than approximated. **IR-13**. |
| Cross-reference lines across ≥2 sources | **INFEASIBLE** | Same blocker as the first row. |

---

## Step 2 — Win Match market

Bands sum correctly: 25 + 25 + 20 + 20 + 10 = 100. **OK.**

### Recent form (25 pts) — DEFECT
Bonus stacking allows 25 + 5 + 5 = 35 points from a 25-point factor. Combined with the other bonuses (+5 surface, +3 stage) a match can reach 118 on a 100-point scale. Nothing caps it.
→ Patched: `capScoresAt100`. Test: *scores are capped at 100 despite bonuses*.

### Odds and value assessment (25 pts) — DEFECT (naming) and DEFECT (logic)
The heading says "value", but the bands award **more** points for **shorter** prices. That measures implied probability, not value. True value is edge over the closing line, and the prompt never computes it. The practical consequence is that the model systematically rewards heavy favourites — the opposite of finding value — and the label hides that.

Separately, "Odds -300 or lower" is ambiguous: "lower" could mean numerically lower (−400, i.e. shorter) or a lower absolute number (−200, i.e. longer). The intended reading is "shorter than −300".

→ Patched: `labelProbabilityNotValue` renames the factor to *Implied-probability band (NOT value)* so the output cannot misrepresent it. The band logic itself is kept, because the numbers clearly describe probability tiers. Flagged here as the single biggest analytical weakness in the prompt: **it is a confidence model being described as a value model.**

"Positive odds with strong form support = 8pts" is also unbounded — "strong form support" is undefined, so 8 points can be awarded on any judgement. → Implemented as: plus price scores 8 unconditionally, and the word "strong" is dropped rather than inventing a threshold.

### Ranking advantage (20 pts) — GAP
The bands are:

- top 20 vs outside top 100 → 20
- top 20 vs 50–99 → 14
- top 20 vs 21–49 → 8
- both outside top 50 → 4

Missing entirely: **top 20 vs top 20**, and **both inside top 50 but not both outside it** (e.g. #25 vs #35). A Grand Slam quarter-final is exactly where those pairings occur.
→ Implementation: an undefined pairing scores 0 and is recorded in `missing[]` with the reason `rank band undefined in v1.0 for this pairing`, so the gap is visible rather than papered over.

### Surface-specific form (20 pts) — DEFECT
Scored on **raw win count with no denominator**:

- 3+ wins including a title → 20
- 2 wins → 13
- 1 win → 6
- 0 wins → 0

A player 2–0 scores 13. A player 8–3 scores 6. That is backwards. It also rewards avoiding tournaments: playing fewer matches raises the score per win.
→ Patched: `surfaceWinRateNotCount` scores win rate with a 3-match minimum-sample gate (≥75% → 20, ≥55% → 13, >0 → 6, 0 → 0). The literal v1.0 behaviour is retained behind the flag so the difference can be measured.

Second issue: this factor is scored for "Player", not comparatively. Ranking is a *gap*, surface form is an *absolute*. A 12–4 record against an opponent who is 18–2 scores the same as against one who is 0–9.

### Tournament stage (10 pts) — GAP
"Grand Slam quarter-final or later = 10" is fine. But "ATP Masters or WTA 1000 knockout stage = 8" does not define where the knockout stage begins, and "Early rounds of any tournament = 5" overlaps with "Qualifying or lower-tier event = 2" for a qualifying match at a Masters event.
→ Implementation: M1000/W1000 counts as knockout from R64 onward; qualifying and Challenger/ITF take the 2-point band. Both choices are stated in the code comment so they can be challenged.

---

## Step 2 — First Set Winner market

### DEFECT — the market is not independent
"Use win match base score, then replace tournament stage score with first set win rate."

The win-match base is 90 points of the 100 before any first-set-specific factor. The modifiers that follow range from −16 to +13. So the floor is roughly **74** and the ceiling is 103. The decision thresholds for this market are 70 (HIGH) and 55 (MEDIUM).

**A score below 70 is arithmetically almost unreachable, so the first-set market can never say anything but HIGH.** The market is decorative.

→ Patched: `firstSetIndependentScale` rescales the modifiers onto the 90-point remainder so the market can actually discriminate. Test: *first-set score can fall below the HIGH threshold (v1.0 could not)* — this test fails against the literal v1.0 rules, which is the point.

### Other first-set modifiers
- Serving advantage +8: **"significantly higher" is undefined.** → Implemented as a stated threshold: first-serve percentage +3 points or aces +2 per match. Arbitrary but explicit, and easy to recalibrate.
- Slow starter −5: requires "documented history". No free structured source exists; scored only when `form.documentedSlowStarter` is present from a citable source, otherwise recorded missing.
- Fatigue −6/+5: **OK**, and the 24-hour rule is correctly narrow.
- Price band −5pts outside −150..−500: **OK** as a rule, but unscoreable without odds (**IR-01**).

---

## Step 2 — Games Handicap market

Bands sum correctly: 30 + 25 + 25 + 20 = 100. **OK.**

### DEFECT — double counting
Ranking gap (30) and straight-set rate (25) are re-scored here after already contributing to the win-match score. The handicap score is therefore mostly a restatement of the win-match score, and the thing that actually decides a handicap bet — whether the *line* is right — is barely modelled. "Handicap line value" is scored on price bands, not on line accuracy.

### DEFECT — gate stacking makes the market almost never fire
Three conditions must all hold: win-match ≥65, 2 of last 3 in straight sets, and handicap price between −120 and +110. Requiring 2 of the last 3 matches to be straight-set wins is a high bar even for a dominant player, and it must coincide with a near-even handicap price — but a player who has won 2 of 3 in straight sets will rarely be offered a near-even handicap. The two conditions pull against each other.

→ Implemented as written, because it is a deliberate conservatism. But the practical effect should be stated plainly: **expect this market to skip most of the time.** The site flags every skip with the reason.

### "Handicap shorter than -180 = 5pts — return insufficient" — OK
Clear and implementable.

---

## Step 3 — Decision rules

- Win match 70 / 50 bands: **OK.**
- "Score 50 to 69 with 2 or more factors aligned = MEDIUM": **GAP** — "factors aligned" is undefined. → Implemented as: MEDIUM by score alone, with an additional guard that caps confidence at MEDIUM when fewer than 4 factors could be sourced. That guard is not in the prompt; it is an anti-hallucination control and is documented as such.
- First set 70 / 55: **OK** as thresholds, but see the independence defect above.
- Handicap gating: **OK**, see stacking note.
- "Never a win-match bet shorter than −500 unless surface form ≥18": **OK.** Implemented.
- "Never a first-set bet shorter than −500": **OK.** Implemented — and note this rule is unconditional in Step 3. The first implementation nested it inside the moneyline check, which was a bug; test *a sub -500 first-set price is blocked at the market ceiling* now pins it.
- "Avoid set betting and total games entirely": **UNSOURCED** — "documented negative expected value" is asserted with no citation, and the same model recommends games handicap, which is the same market family. Kept as an explicit policy choice, not presented as fact.
- "3+ matches below 55 → reduce to the 3 highest": **GAP** — "below 55 across all markets" is ambiguous about whether a skipped market counts as below 55. → Implemented as: below 55 on both win-match and first-set. Test: *three or more weak matches trims the card*.

---

## Step 4 — Output format

- Minimum 40 words: **OK**, enforced and tested.
- Bolded winner within the first 20 words: **OK**, enforced and tested.
- No player name more than once: **OK** — and note that a *surname* is still a name, so the descriptors used after the first mention are fully anonymous ("the selection", "the favoured side of the handicap").
- No odds, lines, set scores or total games numbers: **OK** — enforced by a single rule that rejects **any** digit in a tip. This is stronger than the prompt requires and closes the loophole of writing "five and a half games".
- No injury details, draws, coaches, stadiums, links, citations, brackets, social media: **OK** — enforced by a forbidden-token list plus a bracket check.
- Handicap tips state only who covers: **OK**, enforced.
- Confidence stated on every tip: **OK**, enforced.
- SKIP as a single sentence: **OK**, enforced.
- Summary table + handicap skip flags + responsible gambling note: **OK**, all three rendered.

### DEFECT — two Step 4 rules conflict
"The predicted winner must be bolded and obvious within the first 20 words" **and** "no two tips may open with the same word, phrase, or sentence structure" cannot both hold if the bolded name is the first word — all three markets for one match would then open identically.

→ Resolution: the tip leads with a distinctive analytical opener and the bolded pick lands inside the 20-word window. Both rules are enforced simultaneously by the validator. **IR-07.**

### DEFECT — the uniqueness rule is unbounded
Three markets per match means a 20-match card needs 60 tips. There are 24 distinct hand-written openings. Beyond that the rule cannot be honoured without padding the prose with filler — which the same prompt bans.

→ `writeCard` reports `openerPoolExhausted` and the UI shows a warning instead of silently repeating an opening. **IR-08.** This is a genuine limit of the requirement, not of the implementation.

---

## Tennis-specific adjustments

- "Clay form is the single most predictive surface factor": **UNSOURCED.** Plausible, and consistent with the general view that clay amplifies skill differences, but no source is given and nothing reachable here tests it. Treated as a prior, not a fact.
- "Grand Slams and Masters produce the most reliable predictions": **UNSOURCED** but consistent with the scoring bands, so it is coherent within the model.
- "Serve statistics are the strongest predictor of first set outcomes": **UNSOURCED**, and the example given (68% first serve, 8 aces) is presented as though it settles the question. Directionally reasonable; not established by the prompt.
- "Three-set matches within 24 hours are a documented performance depressor": **UNSOURCED** — "documented" implies a citation that is not provided. Kept as a rule because it is cheap and conservative.
- "A WTA −3.5 is roughly equivalent to an ATP −5.5": **UNSOURCED** and consequential. The engine does **not** apply a gender handicap adjustment, because applying an unverified calibration factor to a betting line would be exactly the kind of invention this project is meant to avoid. It needs the backtest corpus to calibrate. **IR-12.**
- "Retirement produces a void bet in most markets": **partly correct.** Settlement on retirement varies by bookmaker — some void, some settle on completed sets. The engine flags the risk rather than asserting the outcome.

---

## What the prompt is missing entirely

1. **No calibration metric.** Nothing tracks Brier score or log loss, so "profitability" can only ever mean hit rate, which says nothing about whether the model beats the market.
2. **No vig removal or closing-line comparison.** Without those, no claim about edge is possible.
3. **No treatment of doubles.** The OLBG slate includes doubles; the model assumes singles.
4. **No handling of retirements and walkovers in the form data.** A walkover counts as neither a win nor a loss unless explicitly decided.
5. **No tiebreak adjustment for first-set win rate.** First-set win rate is inflated by tiebreaks, which are close to a coin flip regardless of serve quality.
6. **No deduplication or match identity.** Nothing keys a prediction to a settled result, which is what makes forward collection possible. `event_id` is used for this here.
7. **No timezone statement.** OLBG renders UK time; the prompt never says so.

---

## Summary of patches applied

| Flag in `engine/engine.js` | Default | Fixes | Test |
|---|---|---|---|
| `capScoresAt100` | on | bonus stacking past 100 | *scores are capped at 100 despite bonuses* |
| `firstSetIndependentScale` | on | first-set market cannot fall below HIGH | *first-set score can fall below the HIGH threshold* |
| `surfaceWinRateNotCount` | on | win count scored without a denominator | *fully sourced dominant match reaches HIGH* |
| `labelProbabilityNotValue` | on | "value" label on a probability measure | *decimalToAmerican / normaliseOdds* |

Turn any flag off to reproduce literal v1.0 behaviour; every one of them is
covered by a test in `tests/engine.test.mjs`.
