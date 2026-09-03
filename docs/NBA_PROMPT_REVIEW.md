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

The scoreboard now uses the dedicated `engine/nba_writer.js` presentation layer. When a market clears the scorer's threshold it renders the required ordered trio — WIN MATCH, POINT SPREAD, and GAME TOTAL — as separate copy-ready blocks. The blocks deliberately omit player names, venue names, odds, and line figures. A missing or skipped market remains explicitly withheld; the writer never turns absent evidence into a selection.

## Recommended next implementation

Add a dedicated `nba_engine.js` backed by two independently archived odds sources, an official injury/availability source, and a reproducible historical odds store. Until those feeds exist, NBA scorecards must continue to withhold unsupported markets. The current dedicated writer is a formatting/compliance improvement, not a claim that those missing data sources have been found.

Manual review links: [ESPN NBA scoreboard](https://www.espn.com/nba/scoreboard), [NBA official stats](https://www.nba.com/stats), [NBA official injury report](https://official.nba.com/nba-injury-report-2025-26-season/), and [OLBG Basketball](https://www.olbg.com/betting-tips/Basketball/4).
