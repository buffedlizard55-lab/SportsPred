# FIVB VNL Women master-prompt review

**Reviewed:** 2026-09-03 · **Scope now enforced:** FIVB Volleyball Nations League — Women only.

The previous volleyball implementation did **not** meet this prompt: it evaluated NCAA and EuroVolley data while calling itself a VNL model, substituted a different points allocation, and wrote generic claims that were not tied to collected evidence. Those paths have been retired from the VNL scorer. This document is the implementation contract, not a claim that every data block is currently available.

## Line-by-line disposition

| Prompt requirement | Status | Implementation / review link |
|---|---|---|
| One disclosed analytical voice | Implemented | `engine/volleyball_writer.js` writes one deterministic card; it never attributes a pick to analysts or tipsters. |
| MATCH WINNER and SET SCORE only | Implemented | `engine/volleyball_engine.js`; OLBG monitor may show other discovered market headings but they are never scored. |
| Current odds from two sportsbooks | Gated | `consensusFavourite` requires two **named** book lines which agree. OLBG votes are not odds. See [IR-VB-02](VOLLEYBALL_IRREGULARITIES.md#irregularities). |
| VNL and recent major-event form | Partially ready | `formFromVolleyballTape` accepts only `vnl-women` verified rows. A separate source-tagged major-event adapter is still required before that field is scored. |
| Week, pool and four-of-five scheduling context | Ready in schema; data blocked | Collector schema carries `context.week` and `context.pool`; no value is invented. [Official schedule](https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/schedule/). |
| Standings and VNL points system | Ready in schema; data blocked | `standings` / `stakes` fields are source-gated. The [official women’s table](https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/standings/women/) is linked for manual review. |
| Finals/relegation status | Ready in schema; data blocked | `stakes.status` allows only `finals_fight`, `relegation_fight`, `comfortably_qualified`, `eliminated`; unknown scores zero. |
| Confirmed match roster | Ready in schema; data blocked | `roster.status` permits only confirmed full, documented rotation/replacement, or documented key absence; no player name is output. |
| Host / travel context | Ready in schema; data blocked | Host contributes within the capped Stakes block; travel is collected for audit but is not assigned an invented weight. |
| Kills, blocks, ace:error per set | Ready in schema; data blocked | `qualityGap` refuses to classify the set market without all three verified team rate fields. |
| WIN MATCH allocation 25 / 20 / 20 / 15 / 20 | Implemented | `scoreForm`, `scoreH2H`, `scoreRoster`, `scoreOdds`, `scoreStakes`; exact total remains 100. |
| SET SCORE allocation 35 / 30 / 20 / 15 | Implemented with explicit thresholds | `scoreSetMarket`; unquantified narrative instructions are made deterministic and tested. |
| HIGH / MEDIUM / SKIP rules | Implemented | Winner: HIGH ≥70, MEDIUM ≥50 and at least two positive blocks; set: HIGH ≥70, MEDIUM ≥55, and no leading-outcome gap under ten. |
| Never force a market | Implemented | Missing two-book favourite, VNL fixture data, or close set outcomes produce an explicit SKIP. |
| 40-word tips, bold pick early, no figures or sources | Implemented | `validateVolleyballTip` is a hard writer gate; only the bold set-score token may contain numerals. |
| Summary table, value note, responsible-gambling section | Implemented | `buildVolleyballFormattedCardText`; it contains current checked support wording. |
| OLBG current open markets in calendar/scoreboard | Implemented as a separate monitor | `scripts/collect_volleyball_olbg.py` discovers index events and verifies each event-page heading. No market is presumed from a standard list. |
| Complete backtest | Blocked honestly | `scripts/backtest_volleyball.mjs` needs a complete parse-verified VNL Women result tape. Current result is explicitly zero graded, not an invented hit rate. |

## Deliberate safety decisions

1. **Competition-family isolation.** A volleyball event only enters the VNL scorer if its `family` is exactly `vnl-women`. A matching team name, an OLBG category, or a generic volleyball page cannot bypass this check.
2. **No synthetic favourite.** The scorer withholds both markets when it cannot find a two-named-book consensus. This is stricter than treating a community vote as a price.
3. **No stale “current” label.** The OLBG panel displays the committed fetch timestamp and links to the original event. The browser never scrapes OLBG directly.
4. **No false backtest.** A walk-forward report with zero source-verified rows is more useful than accuracy claims derived from other competitions.

## Prompt ambiguities flagged instead of silently changed

- The MATCH WINNER blocks nominally sum to 100, but the prompt also says to add five hosting points to a 20-point Stakes block. The engine caps the block at 20; see IR-VB-05.
- The set-score narrative says a 3–2 loser has a standings bonus and then refers to an incentive on a “side” that may extend the match. The engine awards its standings-incentive support to the 3–2 outcome only when either team has verified Finals/relegation urgency.
- “Recent form at major events” and “recent set-score pattern” give categories but not a deterministic sample size. The implementation requires at least three verified rows before scoring those blocks. This conservative floor is a model parameter, not a sourced fact.

## What must happen before active VNL picks are published

1. Add a collector that produces official schedule/result rows and retains a review URL for every row.
2. Add two named legal sportsbook price sources for each fixture, with fetch timestamps and no use of OLBG votes as a proxy.
3. Add roster, standings/qualification, travel and team-rate adapters, each with a source URL and match timestamp.
4. Run the walk-forward backtest over those committed VNL rows, report sample size and calibration, and do **not** report profit/ROI unless prices and settlement are available.

Until then, the site remains useful as a source-linked scoreboard/market monitor, but it deliberately withholds predictions rather than manufacture certainty.
