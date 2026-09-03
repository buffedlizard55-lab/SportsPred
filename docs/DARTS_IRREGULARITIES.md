# Darts irregularities register

Everything that did not check out while implementing the darts master
prompt. The machine-readable copy is
[`data/darts_provenance.json`](../data/darts_provenance.json), rendered on
[sources.html#darts-irr](../sources.html). Each entry states its effect on
output and gives links for manual verification.

## IR-DARTS-01 — No free, key-less **odds** feed (high, open)

**Finding.** The prompt's 25-point Odds Strength category and Step 3's
price-gated rules (Full Bet ≤ −150, Small Bet −130…−200, profitability guard)
need a current price. OLBG server-rendered HTML carries tipster vote counts
but no prices; PDC.tv and Wikipedia publish none; the ESPN site API has no
darts coverage; The Odds API requires a key.
**Effect on output.** The odds component is scored missing on every live card;
Step 3 resolves to `SKIP — no verified price`; written verdicts and confidence
are still produced from sourced factors; HIGH is impossible live. Bet-tier
evaluation in the backtest is reported as untestable, and the backtest is a
model-lean report, not a betting record.
**Verify:** <https://www.olbg.com/betting-tips/Darts/15> ·
<https://www.pdc.tv/>

## IR-DARTS-02 — 3-dart averages only when printed (high, open)

**Finding.** Wikipedia match reports print a three-dart average for a minority
of Hungarian Darts Trophy matches (Cross 101.90 / Greaves 104.88, van
Duijvenbode 90.71 / Písek 77.24, Smith 101.01 in the final). Most rows have
none.
**Effect on output.** The 20-pt average component is `missing` unless
`average_a` / `average_b` is on that tape row. Career or estimated averages
are never invented.
**Verify:** <https://en.wikipedia.org/wiki/2026_Hungarian_Darts_Trophy>

## IR-DARTS-03 — PDC.tv player and ranking pages are JS-rendered (medium, open)

**Finding.** Official PDC player / Order of Merit pages hydrate in the
browser. Static HTML is not a usable ranking table.
**Effect on output.** The Order of Merit snapshot is taken from
dartsrankings.com (public table dated 30 August 2026, after ET11), with
PDC.tv kept as a review link. Ranks are never guessed.
**Verify:** <https://www.dartsrankings.com/> · <https://www.pdc.tv/players>

## IR-DARTS-04 — No key-less PDC results/averages API (medium, open)

**Finding.** There is no public key-less JSON results/averages feed. The
registry previously marked darts unpredictable for this reason.
**Effect on output.** The specialist layer scores from a committed,
source-tagged tape transcribed from Wikipedia match reports plus the public
Order of Merit table. Checkout percentage, 180s rate and first-9 average have
no free source and are not scored at all (see IR-DARTS-07).
**Verify:** <https://www.pdc.tv/> ·
<https://en.wikipedia.org/wiki/2026_Hungarian_Darts_Trophy>

## IR-DARTS-05 — Incomplete later-round scores are omitted, never reconstructed (high, open)

**Finding.** First round (16 matches, 28 Aug) is complete. Several
second-round and later matches have printed scores; others are described only
by seed-exit labels (e.g. Wattimena reached the third round) without a score.
**Effect on output.** Unscored matches are absent from the tape. Seed-exit
labels are never turned into 6–x results. The backtest grades only the printed
matches.
**Verify:** <https://en.wikipedia.org/wiki/2026_Hungarian_Darts_Trophy>

## IR-DARTS-06 — Czech Darts Open first-round draw is not yet published (high, RESOLVED 2026-09-03)

**Finding.** The event is scheduled 4–6 September 2026 at PVA Expo Prague.
Host-nation qualifier is listed as 3 September. The fetched Wikipedia page
has the seeded field but no first-round pairings. OLBG carried only outright
tournament markets when first collected on 2026-09-03.
**Effect on output.** No Czech Open match is invented. The live slate has
outrights for display only. Historical leans are written against the Hungarian
tape until pairings exist.
**Verify:** <https://en.wikipedia.org/wiki/2026_Czech_Darts_Open> ·
<https://www.olbg.com/betting-tips/Darts/15>

> **Resolved later the same day.** The slate refreshed at 2026-09-03T19:25:14Z
> carries the published Round One draw: eleven first-round matches dated
> "Tomorrow" (Friday 4 September) plus two World Series of Darts Finals matches
> dated 17 September, and three outrights. Each of the eleven was checked
> against the published schedule of play before being accepted — Menzies v
> Engström, Joyce v Huybrechts, Doets v Evans, Cullen v Burton, Rydz v Reyes,
> Zonneveld v de Graaf, van Duijvenbode v Vandenbogaerde, Gurney v Greaves,
> Woodhouse v Scutt, Cross v Barry, Schindler v Owen. Every event carries its
> OLBG `event_id` and review URL; nothing was inferred from the seeded field.
> The four Host Nation Qualifier slots are still unpublished and are still
> absent from the slate rather than filled in.
> **Verify:** <https://dailysport.co.uk/featured/humphries-to-face-gurney-or-greaves-in-prague-opener/> ·
> <https://dartsworld.com/2026/09/humphries-aims-for-czech-hat-trick-as-littler-returns/> ·
> <https://pdpa.co.uk/event/czech-darts-open-2026/>

## IR-DARTS-07 — Checkout %, 180s and first-9 average have no free structured source (medium, open)

**Finding.** Isolated checkout mentions exist (Cross 170, Dobey 170, Smith 73%
doubles in the final) but there is no per-player checkout or 180s table.
**Effect on output.** Those prompt inputs are not scored. They do not appear
as zero-tiered components; they are simply absent from the model.
**Verify:** <https://en.wikipedia.org/wiki/2026_Hungarian_Darts_Trophy>

## IR-DARTS-08 — A test asserted the shape of one day's slate, so publishing the draw broke the build (high, FIXED)

**Finding.** `tests/darts_integration.test.mjs` asserted `fixturesFromSlate(slate).length === 0`
and `buildDartsCard(docs, {}).scored.length === 0` — that is, it asserted the
outrights-only slate described in IR-DARTS-06 above. When the Round One draw was
published and the collector committed it, both assertions became `13 !== 0`. The
data was correct; the test had frozen a temporary state of the market into a
permanent expectation.
**Effect on output.** None on the site. The effect was on the pipeline: the
"Tests must pass" gate went red on `main`, which blocked every collector
workflow and the Pages deploy (see IR-21 in [IRREGULARITIES.md](IRREGULARITIES.md)).
**Fix.** Both tests now derive their expectation from the committed slate and
assert provenance instead of a count: one fixture per sourced non-outright
event, each fixture id carrying its OLBG `event_id`, each linking the event it
came from, both player names present in the published matchup, and an outright
market never becoming a two-player fixture. A quiet day still yields zero and a
tournament day yields thirteen, with the same guarantee either way.
**Verify:** <https://www.olbg.com/betting-tips/Darts/15>
