# NBA master prompt review

## Status

The repository now exposes NBA through the verified universal scoreboard at `sport.html?sport=basketball`. It uses the ESPN public scoreboard endpoint for NBA, WNBA, NCAA men, NCAA women, and NBA G League. The OLBG directory remains a separate, source-linked market catalogue.

This is an implementation review, not a claim that every requested field is available for free. A field is only used when it is present in the response and is attributed to its source; otherwise the engine withholds the affected market.

## Requirement matrix

| Prompt requirement | Current treatment | Verification / limitation |
|---|---|---|
| Upcoming, live, and completed games | Implemented in the universal scoreboard | ESPN scoreboard responses are parsed by `engine/espn_universal.js`. |
| Calendar navigation | Implemented | Calendar counts are built from ESPN league calendars and dates can be selected directly. |
| OLBG market directory | Implemented as a committed snapshot plus official links | OLBG is a tipster-market index, not a guaranteed bookmaker closing-line feed. Missing rows are not invented. |
| Moneyline, spread, total | Parsed only when the ESPN odds block includes them | A single public odds block does not satisfy the prompt's two-source closing-price requirement. These markets must therefore be capped or skipped unless two independent records are present. |
| Recent form and standings | Implemented where ESPN supplies completed games and standings | The league context is measured from completed results; insufficient samples are explicitly marked. |
| Head to head, home/away split, pace, PPG | Partial | Generic ESPN responses do not consistently expose all NBA advanced/team fields. No fallback estimate is allowed. |
| Player injuries and availability | Not asserted by the generic engine | A free, stable, date-specific official feed is not guaranteed. Do not publish player-impact claims from absent data. |
| ATS last ten and closing odds from two sources | Not verified by the generic engine | Requires two independently archived price feeds and settlement rules. The engine must not infer ATS from the score alone. |
| 40-word, three-market prose | Universal writer provides sourced prose and validation, but its generic market vocabulary is not a literal NBA-v5 renderer | NBA-v5 output should be considered compliant only after a dedicated NBA writer is enabled. |

## Data-quality rules

1. Never turn an unavailable value into zero, an average, or a plausible default.
2. A prediction without the required independent market evidence is `SKIP`, not a low-confidence bet.
3. Every external source is rendered as a manual-review link. Snapshot age and stale-cache state are visible in the source/data-quality areas.
4. Backtests settle only predictions recorded before the event and only against an official result. They do not use future standings or closing information.
5. The site does not claim that OLBG consensus is bookmaker odds or that one ESPN odds block is two-source confirmation.

## Current implementation note

The scoreboard now uses a dedicated NBA v5.0 engine (`engine/nba_engine.js`) plus the
`engine/nba_writer.js` presentation layer.

`nba_engine.js` implements STEP 2's 100-point rubric **exactly**, line by line:

- **WIN MATCH**: odds strength (30) · recent form last-5 with the +5 streak bonus (25) ·
  head-to-head (20) · season record with the opponent-higher −5 (15) · context & home
  court with the strong-home-split +3 (10).
- **POINT SPREAD**: the moneyline factors as base, context replaced by the ATS-trend
  bucket, plus the injury (+8/+3/0) and fatigue (±5) modifiers.
- **GAME TOTAL**: offensive pace (35) · defensive efficiency (25) · injury impact on
  scoring (20) · recent over/under trends (20).
- **STEP 3**: ≥70 HIGH, 50–69 MEDIUM (small bet), <50 SKIP; a moneyline of −300 or
  heavier requires 75+; confidence is further capped by data completeness.

Every bucket that has no free key-less source is scored 0 and recorded in `missing[]`
with its reason — never inferred. In practice this means:

- **Game total** resolves to SKIP on the free feed, because pace ratings, defensive
  efficiency, a date-specific injury feed, and post-game closing totals are not
  available key-less. That is the correct, honest outcome, not a failure.
- **WIN MATCH and POINT SPREAD** produce real scores once a team has season records,
  a results tape (for form, head-to-head and rest), and a posted moneyline. The single
  ESPN-republished odds source is used but the missing second source is flagged, and
  ATS/injury/conference-rank buckets stay withheld.

`nba_writer.js` enforces STEP 4's output contract: three tips in prompt order, 40+
words, the selection bolded within the first 15 words, no player/injury/venue/odds/line
figures, no links or citations, no two tips sharing an opening word, confidence stated
as LOW/MEDIUM/HIGH (or SKIP), and none of the banned phrases or internal-process
language (model, edge, EV, implied probability, thresholds, filters, backtests).

## What is still withheld (and why)

The following STEP 1/2 inputs still have **no free, key-less, reproducible source**, so
they are recorded as missing rather than estimated:

1. A **second independent closing-odds source** (ESPN republishes a single book).
2. **ATS trends (last 10 covers)** — no free feed retains point-spread covers.
3. **Conference-rank standings** (top-3 / 4–6 / 7–10 tiers) — the ESPN standings
   feed is wired (`scripts/collect_basketball_espn.mjs` → `data/basketball_standings.json`,
   consumed by `buildStandingsMap`). Until that document is committed, the engine
   falls back to season win-rate and records `NBA-STANDINGS` in `missing[]`.
4. **Date-specific injury/availability impact** — the official NBA injury report is
   linked for manual review but is not a structured feed.
5. **Pace ratings and defensive efficiency** — not in the scoreboard feed.
6. **Game-stakes tier** (high/mid/low context).

A dedicated collector (`scripts/collect_basketball_espn.mjs`) now produces the
committed results tape (`data/basketball_tape.json`) and standings snapshot, and
`scripts/backtest_basketball.mjs` runs a leak-free walk-forward backtest that grades
WIN MATCH per confidence band (SPREAD/TOTAL are reported as ungraded because no
key-less feed retains a closing line once a game is final). Closing odds are still
not archived, so the backtest runs without the odds-strength bucket and says so.

Manual review links: [ESPN NBA scoreboard](https://www.espn.com/nba/scoreboard), [NBA official stats](https://www.nba.com/stats), [NBA official injury report](https://official.nba.com/nba-injury-report-2025-26-season/), and [OLBG Basketball](https://www.olbg.com/betting-tips/Basketball/4).
