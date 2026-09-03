# DARTS PREDICTION MASTER PROMPT v1.0 — line-by-line review

How each instruction is implemented in code, and what the sources do not
support. Engine: [`engine/darts_engine.js`](../engine/darts_engine.js),
writer: [`engine/darts_writer.js`](../engine/darts_writer.js),
data: [`engine/darts_data.js`](../engine/darts_data.js),
card: [`engine/darts_card.js`](../engine/darts_card.js).

The prompt text of record is [`docs/DARTS_MASTER_PROMPT.md`](DARTS_MASTER_PROMPT.md).
This session rebuilt the layer from that spec because the original sandbox
files were not recoverable.

## Step 1 — data collection

| Prompt line | Implementation | Status |
|---|---|---|
| Current betting odds from all available sources | No free key-less price feed anywhere; odds component scored missing live | ⚠️ IR-DARTS-01 |
| Recent form — last 5 completed matches | Wikipedia ET tape → `buildPlayerProfile` (last-5, wins/losses) | ✅ |
| Last 5 wins/losses, in-tournament record | profile `wins/losses`, `inTournament` + wins with +5 bonus for an undefeated run (≥2 event matches) | ✅ |
| 3-dart average | `lastAverage` from the most recent tape row that prints one | ⚠️ IR-DARTS-02 |
| Head-to-head, weighted to last 3 years | `h2hBetween` all-time + `last3Years`; zero meetings = missing, never "even" | ✅ |
| Official Order of Merit | dartsrankings.com snapshot → `rankFor`; unranked = 0 pts | ✅ / ⚠️ IR-DARTS-03 |
| Tournament stage | `roundTierFor` reads First/Second/Third round, QF, SF, Final | ✅ |
| Checkout %, 180s, first-9 | Not collected; no free structured source | ❌ IR-DARTS-07 |
| Player form narratives / pundit verdicts | Not collected; writer argues only from measured factors | ❌ by design (no-hallucination) |

## Step 2 — scoring (out of 100)

| Component | Points | Code | Notes |
|---|---|---|---|
| Odds strength | 25 | `scoreOddsSide` | −300 or shorter 25; −200…−299 18; −150…−199 12; −100…−149 5; else 0; **missing when no price** |
| Recent form | 20 + 5 | `scoreForm` | 5/5 20; 4/5 14; 3/5 8; ≤2 0; +5 when undefeated in-tournament (≥2 event matches) |
| 3-dart average | 20 | `scoreAverage` | 100+ 20; 96–99 14; 92–95 8; 88–91 4; else 0; **missing when unprinted** |
| H2H (last-3-years weighted) | 15 | `scoreH2H` | ≥70% 15; 55–69% 10; 45–54% 4; else 0; missing on zero meetings |
| Order of Merit | 10 −5 | `scoreRanking` | top 4 10; 5–8 7; 9–16 4; 17+/unranked 0; −5 when opponent ranked higher |
| Stage | 10 | `scoreStage` | final/semi 10; QF 7; R16 (ET third round) 4; second round & earlier 0 |

The score is `min(100, max(0, sum))`, so a −5 ranking deduction is visible in
the breakdown, never claimed as a sourced positive.

## Step 3 — decision rules

| Rule | Implementation |
|---|---|
| Full Bet: score ≥ 70 and odds ≤ −150 | `decideBet` `RULES.full` |
| Small Bet: 50–69, odds −130…−200, 2+ secondary factors aligned | `RULES.small` (odds range inclusive) |
| Skip below 50 / outside odds ranges / fewer aligned factors | default SKIP with reasons |
| Profitability guard: odds ≤ −300 requires score ≥ 75 | `RULES.profitability` (checked first) |
| No verified price → SKIP with IR-DARTS-01 reason | `decideBet` early return |
| Confidence HIGH requires a measured price and 3 measured signals | `confidenceFor`; missing price caps HIGH at MEDIUM; <2 signals caps MEDIUM at LOW |

## Step 4 — output format

Enforced by `validatePrediction` / `writeDartsCard` (tests in
`tests/darts_engine.test.mjs`, `tests/darts_writer.test.mjs`,
`tests/darts_integration.test.mjs`):

- 25–40 words, deterministic trim/pad in `composeParagraph`;
- verdict line with winner + model score (`X/100`);
- no digits, no links, no source names, no odds numbers, no factor breakdown
  in the paragraph (`FORBIDDEN_TOKENS`);
- banned generic fillers rejected (`BANNED_PHRASES`);
- one unique opener per prediction on a daily-sized card, 14 openers × 14
  angles rotating so no template repeats within that window;
- a walk-forward tape longer than the opener pool rotates rather than failing
  the card;
- card ends with the summary table (Match, Event/round, Selection,
  Confidence, Model score, Bet type) and the responsible-gambling reminder.

## No hallucination guarantees

1. Every scored component records its points and the triggering fact; factors
   with no source are `missing: true`, are listed in `missing[]`, and lower
   the confidence ceiling.
2. Zero H2H meetings are recorded as missing — never as "even", never invented.
3. Only the public Order of Merit list is used; an unranked opponent is scored
   as unranked, with the −5 penalty when facing a ranked player.
4. Averages, checkout % and 180s are never estimated.
5. Czech Open pairings are never synthesised from a seed list (IR-DARTS-06).
6. The collector parser tests, `build_data.py --strict` validation and the
   writer validators all reject price-like fields and digits in prose.
7. The backtest grades model leans only; bet-tier accuracy is reported as
   untestable because no price feed exists.
