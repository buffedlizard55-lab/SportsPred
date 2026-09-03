# NPB — Irregularities register

Everything that did not check out while building the NPB layer, its effect on
output, and where to review it. The machine-readable copy lives in
`data/npb_provenance.json` (`irregularities[]`, ids `NPB-*`) and is rendered on
the NPB page's Sources rail. Ids below (`IR-NPB-*`) are the durable register;
the collector's runtime ids (`NPB-SEED`, `NPB-STARTERS`, `NPB-BOX-COVERAGE`,
`NPB-XCHECK`, `NPB-PARSE`, `NPB-PARSE-DRIFT`) are per-run findings.

## IR-NPB-01 — No key-less three-way price feed

**Prompt:** three-way moneyline, run line and total from two sources; Odds and
Value block (20 pts); underdog value flag; the −300 heavy-favourite gate;
recent Over/Under trends (15 pts).

**Finding (2026-09-03):** OLBG's Baseball tips index carries MLB rows only and
no prices; ESPN has no NPB league; statsapi `sportId=31` is empty; every
three-way NPB price source found is keyed or scraped from bookmakers' own
sites, which this project does not do.

**Effect:** Odds block scores 0 and is recorded in `missing[]`; the underdog
value flag cannot fire; the heavy-favourite gate is inert; the total's trend
block is unsourced. Together with IR-NPB-02 this keeps most live cards under
the evidence floors (C-4/C-5) → SKIP. Nothing is defaulted to a mid-market
price. The card's "Underdog value flag" line says so explicitly.

**Closes when:** a configured price feed is wired into the collector.

## IR-NPB-02 — Box-score coverage is one game in the seed

**Finding:** only one Japanese box score (S-T game 21, 2026-09-03) could be
captured from the sandbox. Starter form (last four starts, quality starts,
rest) and bullpen state (three-day usage, relief RA9) derive **only** from
these lines, so on the seed card every announced starter shows "no sourced
recent starts" and every bullpen is missing. `data/npb_pitchers.json`
`coverage` reports `matchedInWindow: 0 of 142` and the provenance carries
`NPB-BOX-COVERAGE` (high).

**Effect:** starter (25), bullpen-dependent blocks and two draw blocks (55 of
the draw's 100 points) score 0 as missing; win-match and total markets fall
below the 60-point evidence floors → SKIP. The walk-forward backtest over
290 games therefore grades only 4 win plays (all MEDIUM, 1 hit) and 0 run
lines — **not a performance estimate**, just what the seed can honestly grade.

**Closes when:** `scripts/collect_npb.mjs` runs green in CI with
`--box-days 45` (default), which fetches every played game's box score in the
trailing window.

## IR-NPB-03 — Handedness splits not published

npb.jp publishes no opposing-lineup batting average against left/right-handed
starters over a 30-day window. The +5 starter bonus is recorded as missing.
Pitcher handedness itself is sourced from the `*` marker on the team pitching
register.

## IR-NPB-04 — No wind data

The schedule page carries only a JMA forecast icon (sunny / cloudy / rain
variants). Rain at an open-air park inside the rainy or typhoon window scores
Under 5 as the prompt specifies; the "wind blowing out" Over modifier can
never fire. Enclosed and retractable-roof venues score no weather at all.
Roof status comes from the venue table, not a live roof-open/closed feed.

## IR-NPB-05 — Foreign-player registrations not published

Per-game 出場選手登録 of the four-import cap is not available as a parseable
feed. The rule is displayed as context on every match and never scored or
inferred.

## IR-NPB-06 — Backtest approximations

The walk-forward backtest cannot see historical 予告先発 announcements, JMA
forecasts or standings snapshots. The actual starter from the box score stands
in for the announcement (NPB's announcement is binding; deviations are rare
but possible); weather and standings are left null, so every historical row
carries at least the same gaps as a live card. Totals are reported as
**ungradeable** — no posted line is archived and none is invented. Stated in
`npb_backtest.method` and validated by `build_data.py --strict`.

## IR-NPB-07 — Seed data from dated captures, not a live run

The sandbox cannot reach npb.jp, so the committed documents were built from
seven verbatim page captures (`tests/fixtures/npb_*.CAPTURE.md`, each with URL
and fetch date in its header) via `scripts/build_npb_seed.mjs`. Every document
carries `mode: "seed"` and the page shows a "seed data" banner. The three
`*.FIXTURE.html` files (`npb_box_s2026090201768`, `npb_idp1_h`, `npb_idb1_s`)
are **hand-built structural mirrors** of the English BIS pages — the header,
linescore and starter rows follow the live page as read on 2026-09-03 but the
reliever rows on the box fixture and the season lines on the register fixtures
are labelled structural samples. They exercise the parsers only; no committed
data document is built from them.

**Risk:** the parsers have only been run on markdown renderings of the live
pages and on those mirrors, never on the raw live HTML. The collector's
`NPB-PARSE-DRIFT` gate (tape must not shrink, 12 standings rows, ≥1 fixture,
no score mismatch) refuses to overwrite the seed if the live parse
misbehaves, and the workflow surfaces it as a warning.

## IR-NPB-08 — Announced starters only one day ahead

npb.jp publishes 予告先発 the evening before. On the capture date, 2026-09-04
had starters for all five games; 2026-09-05 and 09-06 had none
(`NPB-STARTERS`, low). Fixtures without an announcement carry
`announcedStarters: null`, the starter block is missing, and the draw block
"both confirmed starters strong" cannot fire — the engine never guesses a
rotation.

## IR-NPB-09 — Calendar rows that are not regular games

Skipped or specially handled while building the tape: All-Star Games 7/28–29
(`CL 5 - 7 PL` rows, warning suppressed by design); postponements 7/1 T-D,
7/4 T-C and B-L, 7/31 E-H, 8/11 and 8/13 S-C, 8/22 DB-T and M-F (kept on tape
as `postponed: true`, excluded from every factor); `(予備日)` reserve rows
9/27 and 9/29; neutral-site home games (Giants at Kyocera Dome 9/1–9/2,
Eagles at Akita 9/1 and Morioka 9/2, Buffaloes at Hotto Motto Kobe 9/9–9/10)
kept with their real venue and roof. Draws on tape: 7/2 DB-C 3-3, 7/3 B-L 4-4,
8/20 F-H 5-5, 9/2 F-H 1-1 (12 innings).

## IR-NPB-10 — No browser refresh

npb.jp sends no CORS headers, so the NPB page cannot re-fetch live pages from
the visitor's browser. The page has no Refresh button; the coverage rail
states the fetch time of the committed documents, and the workflow runs twice
a day (22:00 and 09:00 JST).

## IR-NPB-11 — Prompt readings recorded (see NPB_PROMPT_REVIEW.md)

C-1 form weighting has no numerical table; C-2 "last month" = 30 days;
C-3 "close, low-scoring" = ≥3 of last 5 same-league meetings decided by ≤1
run (or drawn) with ≤7 combined runs; C-4/C-5 evidence floors (60 sourced
points for win and total; 2 sourced starts for a starter rating) added
because the prompt's gates assume fully sourced inputs and would otherwise
emit HIGH verdicts from 20 sourced points; C-6 "unusually short rest" = under
5 days versus NPB's six-man pattern; C-7 bullpen "effective" = relief RA9
≤ 3.5 over the window, "fatigued" = a reliever used on each of the last three
days or 8+ relief appearances in three days.

## Site-level findings noted while working (outside the NPB layer)

- CI was red on every workflow from 2026-09-02 ~23:10 because tests pinned
  live-data content; fixed in `ba7c8cd` (tests now assert shape, not values).
- Snooker collector/engine schema mismatch (collector cannot emit
  engine-schema events) — unfixed, separate register.
- `data/baseball_*.json` absent on the live site until the baseball collector
  runs green.
