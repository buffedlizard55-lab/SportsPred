# Baseball — Irregularities register

Everything that did not check out while building the baseball layer, with the
effect on output and the review links. Machine-readable copy lives in
`data/baseball_provenance.json` and is rendered on the baseball page's Sources
rail.

## IR-BASEBALL-01 — No key-less moneyline / run line / total feed

**Prompt:** "Current moneyline odds, run line (+1.5/-1.5), and game total from
at least two sources, cross-referenced"; the Odds and Value block (20 pts); the
underdog value rule; and the "never recommend a heavy favourite at −300 or
shorter" gate.

**Finding (verified 2026-09-03):** ESPN publishes no baseball odds block — the
scoreboard competitions carry no `odds` array, the core odds endpoint
`https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/401877193/competitions/401877193/odds`
returns `{"count":0}`, and the summary endpoint has no pickcenter block. OLBG
publishes tipster consensus, not prices. The Odds API requires a key, which this
project does not use.

**Effect on output:** the Odds and Value block scores 0 and is recorded in
`missing[]`; the underdog value flag cannot fire on a live card; the
heavy-favourite gate is inert without a price. Confidence is capped accordingly.
Nothing is defaulted to a mid-market price.

**Closes when:** a key-less (or keyed, explicitly configured) multi-book
baseball price feed is wired into the collector.

## IR-BASEBALL-02 — Bullpen ERA rank and 3-day usage unavailable

**Prompt:** "Bullpen ERA and usage over last 3 days"; bullpen blocks in the run
line (+8) and total (20 pts) markets; the short-rest/−250 deduction.

**Finding:** the verified team pitching endpoint is team-wide (starters plus
relievers). No verified key-less endpoint isolates relief pitching or 3-day
usage. The ESPN scoreboard carries only team ERA.

**Effect on output:** the bullpen blocks and the bullpen-fatigue modifier score
0 and are recorded in `missing[]`. The starter short-rest/100-pitch deduction is
still sourced from the probable starter's game log.

**Closes when:** a relief-pitching stats endpoint is verified and wired in.

## IR-BASEBALL-03 — Wind direction and speed unavailable

**Prompt:** "Weather conditions confirmed for game time — wind direction and
speed".

**Finding:** the ESPN scoreboard weather block carries only a summary string and
temperature, not wind direction or speed. The venue indoor flag IS sourced.

**Effect on output:** the Weather and Park block contributes 0 for a dome
(sourced) and 0 for an outdoor venue with wind recorded as missing; no wind is
invented.

**Closes when:** a key-less game-time wind feed (e.g. Open-Meteo per venue) is
verified and wired in.

## IR-BASEBALL-04 — No retained closing lines

**Prompt:** Step 3's run-line and total gates depend on the line; the backtest
asks for closing-line value.

**Finding:** no key-less feed retains a baseball line once a game is final (the
same finding the repository records as `U-06` for the universal engine).

**Effect on output:** the walk-forward backtest grades the win-match market
only; run line and total are reported `ungraded` with the reason, and ROI is
null with an explanation.

**Closes when:** the forward ledger records enough priced picks.

## IR-BASEBALL-05 — Collectors cannot run in this workspace

**Finding:** this sandbox has no outbound network (`curl` and Node `fetch` fail
at the TLS handshake), so `scripts/collect_baseball_mlb.mjs` and the live OLBG
fetch were not executed here. Every endpoint in
[BASEBALL_SOURCES.md](BASEBALL_SOURCES.md) was verified individually during
review, and the committed fixtures were transcribed verbatim from those verified
responses.

**Effect on output:** the committed baseball documents are schema-correct but
small (a short verified window), with a note saying so. The engine records
missing factors as missing and reduces scores accordingly.

**Closes when:** the scheduled workflow runs (it runs on push and twice an
hour).

## IR-BASEBALL-06 — "Confirmed" starter is the announced probable pitcher

**Prompt:** "Starting pitcher confirmed for tonight".

**Finding:** MLB publishes `probablePitcher` (the announced starter) per game;
it is labelled "probable" because clubs can scratch a starter late. The
schedule's probable pitcher for a finished game is the pitcher who started.

**Effect on output:** the engine treats an announced probable pitcher as the
starter (`confirmed: true`, `source: mlb-probable-pitcher`) and states that
provenance in the analysis panel. When no probable pitcher is named the starter
scores 0 as unconfirmed, exactly as the prompt requires.

---

## Prompt-internal conflicts found while implementing

These are not data problems; they are places where the prompt contradicts
itself. Each resolution is implemented and unit-tested, and named here so a
reader can disagree with it deliberately.

| # | Conflict | Resolution |
|---|---|---|
| C-1 | Form is to be weighted "last two weeks double", but the points table is a plain count of wins in the last five | The table is implemented as written; the weighting instruction has no numerical effect on it. Recorded rather than silently reinterpreted |
| C-2 | "Underdog with positive odds AND run differential advantage AND superior recent form = 14pts" never defines "superior" or "advantage" | "Advantage" means strictly better than the opponent on the same measure; "superior form" means strictly more wins in the last five. Stated in the component detail |
| C-3 | Head-to-head says "most recent 3 meetings weighted most heavily" but the table is a plain count of the last ten | The table is implemented as written; the recency weighting has no numerical effect on it |
| C-4 | Run line total is "100pts" but the base (90) plus the run-margin block (20) plus modifiers (+10/+8/+8/+7) can exceed 100 | Scores are clamped to 100 and the clamp is stated in the component detail |
| C-5 | "Bullpen game = automatic Over lean, elevate Over by 12pts" appears in Step 3, while Step 2 gives unconfirmed starters +12 to the Over already | Implemented once in Step 2 (the +12 unconfirmed-starter Over component); Step 3's instruction is treated as referring to that same component rather than double-counting |
