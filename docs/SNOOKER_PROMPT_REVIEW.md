# SNOOKER PREDICTION MASTER PROMPT v3.0 — line-by-line review

How each instruction is implemented in code, and what the sources do not
support. Engine: [`engine/snooker_engine.js`](../engine/snooker_engine.js),
writer: [`engine/snooker_writer.js`](../engine/snooker_writer.js),
data: [`engine/snooker_data.js`](../engine/snooker_data.js),
card: [`engine/snooker_card.js`](../engine/snooker_card.js).

## Step 1 — data collection

| Prompt line | Implementation | Status |
|---|---|---|
| Current betting odds from all available sources | No free key-less price feed anywhere; odds component scored missing live | ⚠️ IR-SNOOKER-01 |
| Recent form — last 5 completed matches | snooker.org player season pages → `buildPlayerProfile` (last-5, wins/losses/draws) | ✅ |
| Last 5 wins/losses, in-tournament record | profile `wins/losses`, `inTournament` + wins with +5 bonus for an undefeated run | ✅ |
| Head-to-head, weighted to last 3 years | `h2hBetween` all-time + `last3Years`; zero meetings = missing, never "even" | ✅ / ⚠️ IR-SNOOKER-07 |
| Official world ranking | WST rankings snapshot → `rankFor`; unranked = 0 pts | ✅ / ⚠️ IR-SNOOKER-02 |
| Tournament stage | `roundTierFor` reads the explicit stage label in the tape; bare "Round 3" is never inferred as a stage | ✅ |
| Odds line movement | Not available; no line-movement component exists | ❌ IR-SNOOKER-01 |
| Player form narratives / pundit verdicts | Not collected; writer argues only from measured factors | ❌ by design (no-hallucination) |

## Step 2 — scoring (out of 100)

| Component | Points | Code | Notes |
|---|---|---|---|
| Odds strength | 30 | `scoreOddsSide` | −300 or shorter 30; −200…−299 22; −150…−199 14; −100…−149 6; else 0; **missing when no price** |
| Recent form | 25 + 5 | `scoreForm` | 5/5 25; 4/5 18; 3/5 10; ≤2 0; +5 capped at 30 when undefeated in-tournament (≥2 event matches) |
| H2H (last-3-years weighted) | 20 | `scoreH2H` | ≥70% 20; 55–69% 13; 45–54% 5; else 0; missing on zero meetings |
| World ranking | 15 −5 | `scoreRanking` | top5 15; 6–10 10; 11–20 5; 21+/unranked 0; −5 when opponent ranked higher |
| Stage | 10 | `scoreStage` | final/semi 10; QF 7; R16 4; last-32 & earlier 0 |

The score is `min(100, max(0, sum))`, so a −5 ranking deduction is visible in
the breakdown, never clamped away.

## Step 3 — decision rules

| Rule | Implementation |
|---|---|
| Full Bet: score ≥ 70 and odds ≤ −150 | `decideBet` `RULES.full` |
| Small Bet: 50–69, odds −130…−200, 2+ secondary factors aligned | `RULES.small` (odds range inclusive) |
| Skip below 50 / outside odds ranges / fewer aligned factors | default SKIP with reasons |
| Profitability guard: odds ≤ −300 requires score ≥ 75 | `RULES.profitability` (checked first) |
| No verified price → SKIP with IR-SNOOKER-01 reason | `decideBet` early return |
| Confidence HIGH requires a measured price and 3 measured signals | `confidenceFor`; missing price caps HIGH at MEDIUM; <2 signals caps MEDIUM at LOW |

## Step 4 — output format

Enforced by `validatePrediction` / `writeSnookerCard` (tests in
`tests/snooker_engine.test.mjs`, `tests/snooker_writer.test.mjs`,
`tests/snooker_integration.test.mjs`):

- 25–40 words, deterministic trim/pad in `composeParagraph`;
- verdict line with winner + model score (`X/100`);
- no digits, no links, no source names, no odds numbers, no factor breakdown
  in the paragraph (`FORBIDDEN_TOKENS`);
- banned generic fillers rejected (`BANNED_PHRASES`);
- one unique opener per prediction, 14 openers × 14 angles rotating so no
  template repeats within a card (checked by `templateKey`);
- card ends with the summary table (Match, Event/round, Selection,
  Confidence, Model score, Bet type) and the responsible-gambling reminder.

## No hallucination guarantees

1. Every scored component records its points and the triggering fact; factors
   with no source are `missing: true`, are listed in `missing[]`, and lower
   the confidence ceiling.
2. Zero H2H meetings are recorded as missing — never as "even", never invented.
3. Only the official WST ranking list is used; an unranked amateur is scored
   as unranked, with the −5 penalty, and no upset narrative is written.
4. The collector parser tests, `build_data.py --strict` validation and the
   writer validators all reject price-like fields and digits in prose.
5. Start times are never inferred: public sources disagree (IR-SNOOKER-03).
6. The backtest grades model leans only; bet-tier accuracy is reported as
   untestable because no price feed exists.
