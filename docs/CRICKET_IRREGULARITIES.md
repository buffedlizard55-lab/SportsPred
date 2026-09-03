# Cricket irregularity register

Everything the master prompt asks for that could **not** be verified from a free
public source is logged here, mirrored in `data/cricket_provenance.json`, and
shown on the site's **Data Quality** tab. The engine records each missing factor
in `missing[]` and withholds the affected market rather than guessing.

## CR-IR-01 — No free key-less odds source for cricket

The prompt's scoring leans on match-winner odds, Man-of-the-Match odds and
top-batsman odds (with explicit American-odds bands and a +400/+900 value zone).

- ESPN's cricket competitions return `"odds": []` — no prices.
- OLBG shows tipster *consensus counts* (`4/4 Win Tips`, `100%`), not
  bookmaker prices.
- The Odds API / Betfair require an API key.

**Mitigation:** `normaliseOdds()` accepts decimal or American and converts
correctly (unit-tested), and every odds rule is already written; the factors are
scored `missing` until a key is supplied. Add an odds feed by filling
`team.odds.win`, `player.odds.mom`, and `player.odds.topBatsman` — no engine
change needed.

## CR-IR-02 — Pitch reports and weather have no free structured feed

The prompt weights spin/pace/batting pitch conditions and rain heavily. No
key-less JSON source publishes a machine-readable pitch report or forecast tied
to an event id; ESPNcricinfo editorial prose is not a structured field.

**Mitigation:** `match.pitch` is `null`; pitch-dependent bonuses and the
spin/pace matchup are recorded missing. Manually verified pitch notes can be
added with a source link, but are never invented.

## CR-IR-03 — Rolling last-5 player aggregates not exposed key-less

The match summary gives complete per-match scorecard figures (runs, SR,
wickets, economy, batting position), but a single key-less call does not return a
player's rolling last-5 form. Computing it requires walking prior events for
each player (a large request fan-out).

**Mitigation:** The live collector derives **team** form (last-5 W/L) and
**head-to-head** from a rolling 30-day scorepanel tape, and pulls confirmed XIs +
this-match figures from each summary. Player last-5 aggregates (`fiftyOrWicket3`,
`scoresOver40`) are scored `missing` until a player-tape pass is enabled.

## CR-IR-04 — Injuries, availability and social/analyst sentiment

The prompt asks for injury impact and X/ESPNcricinfo analyst sentiment "used
internally". There is no key-less structured feed for either.

**Mitigation:** Confirmed starters come from the summary roster
(`starter: true`); the engine only ever names confirmed starting players. Injury
and sentiment factors are omitted and listed missing — never speculated.

## CR-IR-05 — OLBG ↔ ESPN team-name mismatch

OLBG uses short/county names and abbreviations (e.g. "Northants", "E Lewis",
"England W"); ESPN uses full names. Not every OLBG event id maps automatically
to an ESPN event id.

**Mitigation:** The overlay matches on normalised team names with a tolerant
token/`includes()` comparison (`engine/cricket_data.js`). Unmatched OLBG events
still appear on the **OLBG Markets** tab with their own review link rather than
being force-joined.

## CR-IR-06 — Odds band thresholds are American but prices are absent

The prompt states thresholds in American odds (e.g. -250, +400…+900,
+700…+1600). The engine converts and applies these bands; with no prices present
the branches are inert.

**Mitigation:** conversion is unit-tested; the rules activate unchanged once a
price feed exists (CR-IR-01).

## CR-IR-07 — Committed snapshot is a fallback, not a substitute for live data

The sandbox that builds this repo has no outbound network, so `data/` contains
verified snapshots read on 2026-09-01 rather than fabricated rows. The live site
collects real data browser-side first and falls back to the snapshot only if
ESPN is unreachable.

**Mitigation:** every snapshot row carries an ESPNcricinfo/ESPN source URL; the
site labels whether a card used live data or the verified snapshot.

---

## Cricket OLBG index id corrected — 2026-09-02 · FIXED

The repository addressed the OLBG cricket tips index as
`https://www.olbg.com/betting-tips/Cricket/16`. OLBG resolves these URLs by the
**slug**, not the numeric id, so `/16` still rendered a page titled "Cricket
Tips" and the error was invisible: the id was wrong but the page looked right.

Fetching it on 2026-09-02 showed the giveaway — every event link on that page
carried `/7`, and the sidebar article rail was boxing content. The canonical
cricket index is:

    https://www.olbg.com/betting-tips/Cricket/7

Corrected in `engine/registry.js` (`olbgId: 7`). A test in
`tests/universal.test.mjs` asserts the cricket entry is `7`, and a DOM test in
`tests/dom_smoke.test.mjs` asserts the rendered market directory links to
`/betting-tips/Cricket/7` and never to `/16`. Tracked as **U-01** in
[`../data/irregularities.json`](../data/irregularities.json).

A second observation from the same fetch, tracked as **U-02**: the index mixes
absolute datetimes ("05 Sept 06:00") and relative ones ("Tomorrow 19:00") in the
same list, so an index row's date is only meaningful relative to the moment the
page was fetched. Relative rows are tagged `date_basis: 'derived'` and are never
used to place a match on the calendar.

## CR-IR-08 — The Generate button repainted instead of generating

`autoGeneratePredictions()` in `assets/js/app.js` handled cricket by calling
`renderCricketPredictions()` alone. That function only repaints whatever the last
date-load produced; it never scores and never writes. If the load found no
snapshot matches for the selected date, or the live collection was blocked,
`state.writtenCard` stayed empty and the button answered a click with
*"No predictions generated yet. Click 'Generate Predictions.'"* — the reported
symptom exactly.

The handball branch immediately below it did the work correctly
(`scoreHandballCard` → `writeHandballCard` → render). F1 and tennis also
re-render rather than regenerate, but both populate `state.writtenCard` at load
time (`loadF1Date`, `loadTennisDate`), so in practice only cricket was affected.
`generateForMatch()` — the per-match button — did score and write, which is why
that one appeared to work while the slate-level button did not.

**Fix.** The cricket branch now scores the current slate and writes the card
before rendering, mirroring handball, and records `state.cricketGeneratedAt`.

**Second fix, for legibility.** When every market on every fixture resolves to
SKIP, the page previously showed a wall of identical SKIP cards, which reads as a
broken button. It now names the specific missing factors with their counts and
states the remediation, so a data gap is distinguishable from a scoring failure.

**The root cause is data, not code.** Every fixture in `data/cricket_matches.json`
carries null inputs: `form.last5` all null, `h2h` all null, `odds` null,
`batting.inFormBatsmen` null, `bowling.style` null, and empty `momCandidates` and
`batsmanCandidates`. With no sourced factor to score, the rubric correctly
withholds all 24 tips across the six-fixture snapshot. The snapshot also spans
three past dates (2026-08-30, 09-01, 09-02) and holds nothing for the current
day, so the default view opened on an empty board.

Fixing the button makes the failure legible. Producing cricket tips requires a
collector run that populates results-derived form and head-to-head for the
current slate — the same evidence the T20 Blast tape carries, which is why that
page generates 48 tips from 96 verified fixtures.
