# T20 Blast irregularity register

Everything the T20 BLAST (ENGLAND & WALES) CRICKET PREDICTION MASTER PROMPT v1.0
asks for that could **not** be verified from a free public source, plus every
inconsistency found between sources while building the tape, is logged here. The
same ids are mirrored in `data/t20_blast_provenance.json` and surfaced on the
T20 Blast page under **Irregularities** and **Data coverage**.

The rule this register exists to enforce: a factor with no verified source is
**never estimated**. It is recorded in the result's `missing[]` list, penalised
in scoring, and the affected market is withheld rather than filled in.

---

## TB-IR-01 — The tape captures 96 of 115 season fixtures

The results tape in `data/t20_blast_matches.json` was read from ESPNcricinfo's
group points tables, which itemise only each county's **ten in-group** fixtures.

| Segment | Captured | Total | Note |
| --- | --- | --- | --- |
| In-group | 88 | 90 | Two Derbyshire home fixtures (v Durham, v Leicestershire) appear in no captured table row |
| Cross-pool | 1 | 18 | The group tables do not list cross-pool fixtures at all |
| Knockouts | 7 | 7 | Complete: four quarter-finals, two semi-finals, the final |

**Effect on scoring.** Form and head-to-head are reconstructed from in-group
fixtures only, so context is thinner around the two absent Derbyshire dates and
around every cross-pool date. The model responds by withholding: 48 of 94
decided fixtures resolve to SKIP, which is what most of the 51.1% withhold rate
in the backtest consists of.

**Remediation.** `scripts/collect_t20_blast.mjs` walks the ESPN league calendar,
which labels cross-pool fixtures explicitly and carries an event id for every
one. Run `node scripts/collect_t20_blast.mjs --dry-run` to see the plan. Nine
cross-pool event ids were already verified by hand and are recorded in
`data/t20_blast_provenance.json` under `cross_pool_known_ids` so the collector
resolves them directly instead of rediscovering them. Their **results** were not
captured and are not guessed; a row without a result would either be ignored by
the walk-forward context builders or invite an invented score.

---

## TB-IR-02 — No free key-less odds source for county cricket

The prompt's rubric leans on match-winner odds, Man-of-the-Match odds and
top-batsman odds, with explicit American-odds bands and a +400/+900 value zone
for the Man-of-the-Match HIGH tier.

- ESPN's cricket competitions return `"odds": []` — no prices.
- OLBG publishes tipster *consensus counts*, not bookmaker prices.
- The Odds API and Betfair both require a key.

**Effect.** `no_market_price` is declared as a cap on **every** fixture, and the
missing factor is recorded every time. One consequence is structural and worth
stating plainly: the prompt's Man-of-the-Match HIGH tier requires *both* a score
of 75 or more *and* odds in the +400..+900 zone. With no price feed the second
condition can never be met, so **that tier is unreachable** however strong the
sourced evidence is. The best available outcome for the market is MEDIUM.

**Remediation.** All the odds rules are already written and unit-tested via
`engine/cricket_engine.js`. Supplying `team.odds.win`, `player.odds.mom` and
`player.odds.topBatsman` from any feed activates them with no engine change.

---

## TB-IR-03 — Weather and pitch reports have no free structured feed

The prompt weights rain, a revised chase, and pitch character (spin, pace,
batting) heavily. No key-less JSON source publishes a machine-readable forecast
or pitch report tied to a Blast event id; ESPNcricinfo's weather and pitch notes
are editorial prose, not fields.

**Effect.** `row.weather` and `row.pitch` are `null` across the tape. Both are
recorded missing. The rain/DLS rule is still implemented and fires on the one
fixture the tape verifies as decided under a revised target, dropping every
market one tier — it simply has no forecast to fire on for the rest.

**Remediation.** A forecast can be attached per fixture as
`{ rain_likely: true, source: '…' }` with a link; the engine already reads it.
Nothing is inferred from the venue or the month.

---

## TB-IR-04 — Confirmed line-ups and rolling player figures exist only for live fixtures

The three player markets (MAN OF THE MATCH, TOP TEAM 1 BATSMAN, TOP TEAM 2
BATSMAN) need a confirmed starting XI, batting positions and rolling individual
form. Those come from a live match summary; there is no per-match player tape for
a completed season in any free source walked here.

**Effect.** All three player markets are withheld across the historical tape —
24 of the 26 SKIPs on a typical card. A season aggregate (most runs, most
wickets) is **not** a substitute: it cannot say who bats where in this fixture.

**Verified behaviour.** The path is implemented and exercised in
`tests/t20_blast.test.mjs`: given a fixture carrying a confirmed XI and rolling
figures, all four markets are written and every tip passes validation. The
page is ready for a live season; it is the data, not the code, that is absent.

**Two distinct SKIP reasons.** A market is withheld either because nothing could
be sourced (`skip_kind: 'unsourced'`) or because a candidate *was* sourced and
scored below the threshold (`skip_kind: 'below_threshold'`). Conflating them
would misreport the gap, and the page says which one applies.

---

## TB-IR-05 — Head-to-head spans one competition, not three years

The prompt asks for a three-year head-to-head span. This tape holds a single
season, so `h2h` reports `sample_basis: 'captured fixtures in this competition
only; a three-year span needs a longer tape'`.

**Effect.** Most county pairs meet twice in a season, so the head-to-head
component runs on one or two fixtures for most of the early calendar and is
marked `missing` until a meeting exists. Its 15-point weight is therefore earned
only where there is real history.

**Remediation.** Each season the collector adds extends the span; the component
already weights the three most recent meetings double, so a longer tape sharpens
it without a code change.

---

## TB-IR-06 — Sussex carry a two-point deduction

Sussex were deducted **two Blast points** under the ECB financial framework. The
published table shows Sussex on 10 points from 3 wins and 9 losses, where
`4 × 3 = 12`; the deduction accounts for the difference, and the builder's
CHECK 6 verifies that arithmetic for all eighteen counties rather than taking
the table on trust.

**Effect.** The table row is read as **adjusted performance**: the engine
restores the deduction when measuring season strength, so a county is not
penalised twice for the same sanction. A flag records that a deduction is in
play, marked *"Internal context only — never referenced in a tip."*

**Why it must never reach a tip.** The prompt forbids any reference to a
county's finances or points deduction in published prose. The writer enforces
this mechanically: `deduction`, `deducted`, `finances`, `financial`,
`special measures` and `salary cap` are all in the banned-token list, and a tip
containing one fails validation and is never returned.

**Sources.** [Wisden](https://www.wisden.com/series/county-championship-2026/cricket-news/county-hit-with-heavy-cross-competition-points-penalty-under-ecb-financial-framework),
[Sky Sports](https://www.skysports.com/cricket/news/37706/13502388/sussex-to-start-2026-county-championship-with-12-point-deduction-after-entering-deal-with-ecb-to-combat-financial-issues).

---

## TB-IR-07 — ESPN's structured standings disagree with ESPNcricinfo on matches played

Two sources publish a table for the same competition and they do not match on
`matchesPlayed` for several counties. ESPNcricinfo's points table is treated as
authoritative because it is the competition's own published table and because
its runs-for and runs-against figures allow net run rate to be **recomputed and
matched** — which CHECK 7 does for all eighteen counties.

**Effect.** The ESPN standings API is used as a secondary cross-check and as a
source of numeric team ids, never as the results tape. Where the two disagree,
the disagreement is recorded rather than averaged.

---

## TB-IR-08 — The first semi-final has no score in any captured source

Northamptonshire beat Somerset by 17 runs in the first semi-final (event
`1512887`), but no source walked here printed the innings scores, unlike the
other six knockouts. `score` is therefore `null` for that fixture.

**Effect.** None on the result, the winner or the margin — all three are
verified. The fixture simply carries no scoreline, and the page shows "venue not
captured"/no score rather than a reconstructed one.

---

## TB-IR-09 — A shared engine bug awarded both sides identical head-to-head points

Found while wiring the Blast engine into `engine/cricket_engine.js`: the
head-to-head factor scored the same block for both sides, so the two teams in a
fixture received **identical** H2H points and the factor could never separate
them.

**Fix.** `cricket_engine.js` now exports `orientH2H(h2h, teamName)`, which flips
the block for the side it was not written for; `scoreWinH2H` uses it. Blocks
with no `team` field behave exactly as before, so the change is
backwards-compatible — all 31 pre-existing cricket tests passed unchanged.

**Status.** Fixed and regression-tested. Logged because it affected every sport
sharing that engine, not only the Blast.

---

## TB-IR-10 — The series fixtures page contradicts itself on home and away

On ESPNcricinfo's series fixtures page, the **link text** and the **URL slug**
disagree about which county was home for several fixtures, and they do not
disagree consistently:

| Link text | URL slug | Agreement |
| --- | --- | --- |
| Yorkshire vs Hampshire — Cross Pool | `hampshire-vs-yorkshire-cross-pool-1512836` | mirror |
| Somerset vs Derbyshire — Cross Pool | `derbyshire-vs-somerset-cross-pool-1512862` | mirror |
| Durham vs Middlesex — Cross Pool | `middlesex-vs-durham-cross-pool-1512838` | mirror |
| Lancashire vs Derbyshire | `derbyshire-vs-lancashire-north-group-1512844` | mirror |
| Derbyshire vs Lancashire | `lancashire-vs-derbyshire-north-group-1512859` | mirror |
| Kent vs Notts — Cross Pool | `kent-vs-nottinghamshire-cross-pool-1512834` | identical |
| Gloucs vs Northants — 2nd quarter final | `northamptonshire-vs-gloucestershire-2nd-quarter-final-1512884` | mirror |

Some pairs mirror, some match, and the two Derbyshire–Lancashire fixtures mirror
in *opposite* directions. Neither field can be treated as authoritative for
venue orientation.

**Effect and decision.** Only the **event ids** were taken from that page — they
are unambiguous. Home/away for the tape's knockout rows is left exactly as
verified from the points-table rows, and the nine cross-pool fixtures keep their
orientation flagged as unresolved in
`data/t20_blast_provenance.json → cross_pool_known_ids[].orientation`. No row was
silently re-oriented on the strength of a slug.

**Remediation.** Read each scorecard, which states the venue and the toss. The
collector's normaliser takes home/away from the ESPN payload's explicit
`homeAway` label and never from array order or from a slug — a rule asserted in
`tests/t20_blast.test.mjs`.

---

## TB-IR-11 — The model is overconfident and its confidence tiers are inverted

This is the most consequential finding in the whole exercise, and it is reported
rather than tuned away.

Walk-forward over the 2026 tape (`data/t20_blast_backtest.json`):

| Measure | Value |
| --- | --- |
| Fixtures scored | 46 |
| Hit rate | 54.3% (25/46) |
| Always-pick-home baseline on the same fixtures | **60.9%** |
| HIGH tier | **40.0%** (8/20), Wilson 95% interval 0.219–0.613 |
| MEDIUM tier | **65.4%** (17/26), Wilson 95% interval 0.462–0.806 |
| Mean probability assigned to picks | 0.736 |
| Overconfidence (claimed − delivered) | **+19.3 points** |

The tiers are **inverted**: the model's most confident grade performed worse than
its middle grade and worse than simply backing the home county. At n=20 the
interval is far too wide to prove HIGH is worse than MEDIUM — and far too thin to
justify publishing it as HIGH. Either way the claim is unsupported.

Picks are not skewed toward home sides (23 home, 23 away), so this is not a
venue artefact. Away picks hit 43.5% against an away base rate of 39.1%, so most
of the shortfall sits there, dressed up as an average claimed probability of
0.710.

**What was deliberately not done.** Reweighting the model until it beat the
baseline on these 96 fixtures was the obvious way to make these numbers look
better. It was not done: that would fit the weights to the only tape available
and leave nothing to validate against. The weights in
`engine/t20_blast_engine.js` are declared a priori and the backtest reports
`weights_fitted_to_this_tape: false`.

**What was done instead — the publication gate.** Four rules in
`scripts/backtest_t20_blast.mjs` are applied mechanically to whatever the replay
produces. All four trigger on the 2026 tape:

| Rule | Statement | Triggered |
| --- | --- | --- |
| `tier_inversion` | HIGH below MEDIUM → cap at MEDIUM | yes |
| `insufficient_sample` | a tier validated on fewer than 30 fixtures cannot support HIGH | yes (n=20) |
| `no_edge_over_baseline` | overall hit rate must exceed always-pick-home | yes (54.3% vs 60.9%) |
| `overconfident_probability` | claimed probability may not exceed delivered by more than 0.10 | yes (+0.193) |

Result: **published confidence is capped at MEDIUM.** The gate changes what the
site may claim; it never changes a weight, a score or a probability. Each tip
keeps `modelBand` (the tier the model chose) beside the published `band`, and
quotes the observed rate for the tier the model actually chose — so capping
cannot launder a weak claim into a stronger-looking one.

Every card prints these numbers, including the baseline, and states plainly that
the model has no demonstrated edge over home advantage. The gate is
re-evaluated whenever the collector adds a season.

---

## TB-IR-12 — A scoring bug in the backtest's own summary statistic

Found while building the gate: `avgProbability` averaged **P(home win)** rather
than **P(the named side wins)**. Since the model picks the away side about half
the time, the two are very different numbers, and comparing P(home) against a
hit rate for the pick is meaningless. The overconfidence rule silently did not
fire — the model looked only mildly overconfident when it was 19.3 points out.

**Fix.** `summarise()` now returns `avgProbabilityHome` and `avgProbabilityPick`
separately, plus `overconfidence = claimed − delivered`. The gate rule uses the
pick figure. `--check` mode asserts that `overconfidence` equals claimed minus
delivered, so the two cannot drift apart again.

**Why it is logged.** A metric that quietly measures the wrong thing is worse
than a missing one, and this one was propping up the model's apparent
calibration. It was caught only because the calibration table disagreed with the
summary line.

---

## Site-level irregularity: the cricket Generate button

Logged here because it was found while wiring the Blast page, and fixed in
`assets/js/app.js`. See also `docs/CRICKET_IRREGULARITIES.md`.

`autoGeneratePredictions()` handled cricket by calling
`renderCricketPredictions()` alone — a repaint of whatever the last date-load
produced, with no scoring and no writing. If that load found no snapshot
matches, or the live collection was blocked, `state.writtenCard` stayed empty and
the button answered a click with *"No predictions generated yet. Click Generate
Predictions."* The handball branch immediately below it did the work correctly;
cricket, F1 and tennis all re-rendered, and only cricket was affected in
practice because the other two populate state at load time.

**Two fixes.**

1. The cricket branch now scores and writes the card itself, mirroring handball.
2. When every market on every fixture resolves to SKIP, the page says why: it
   lists the specific missing factors and their remediation instead of showing a
   wall of identical SKIP cards.

**The deeper cause is data, not code.** Every fixture in
`data/cricket_matches.json` carries null inputs — `form.last5` all null, `h2h`
all null, `odds` null, `batting.inFormBatsmen` null, `bowling.style` null, and
empty `momCandidates`/`batsmanCandidates`. With no sourced factor to score, the
rubric correctly withholds all 24 tips. The snapshot also holds six fixtures
across three past dates and none for the current day, so the default view opened
on an empty board. Fixing the button makes the failure legible; populating the
evidence is what will make it produce tips, and that is a collector run.

The T20 Blast page avoids the same trap by construction: it generates on load
*and* on click, scores from a committed 96-fixture tape with real results-derived
evidence, and opens on the nearest date that has fixtures rather than on an
empty today.
