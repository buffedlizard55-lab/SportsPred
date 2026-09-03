# T20 Blast backtest

Walk-forward replay of the verified 2026 tape, produced by
`scripts/backtest_t20_blast.mjs`. The committed machine-readable artefact is
`data/t20_blast_backtest.json`; CI re-runs the replay with `--check` on every
push and fails if the look-ahead audit trips, if the metric counts stop
reconciling, or if the publication gate and its triggers disagree.

**Read the summary first.** This model has no demonstrated edge over simply
backing the home county, and its confidence tiers are inverted. Both facts are
printed on every card the site generates. The full reasoning, and what was
deliberately *not* done about it, is in
[`T20_BLAST_IRREGULARITIES.md`](T20_BLAST_IRREGULARITIES.md#tb-ir-11--the-model-is-overconfident-and-its-confidence-tiers-are-inverted).

Reproduce with:

```
node scripts/build_t20_blast.mjs --check     # verify the tape (9 checks)
node scripts/backtest_t20_blast.mjs          # replay + write the JSON
node scripts/backtest_t20_blast.mjs --check   # integrity assertions only
node scripts/backtest_t20_blast.mjs --md      # the section below
```

## Backtest — T20 Blast (Vitality Blast, men) 2026

Model `blast-evidence-1.0.0`, ruleset `T20 BLAST PREDICTION MASTER PROMPT v1.0`. Weights are declared a priori in `engine/t20_blast_engine.js` (form 30, season 20, h2h 15, venue 15, margin 10, rest 10) and were **not** fitted against this tape, so the numbers below measure the model rather than repeat it. The replay is walk-forward: each fixture is scored using only results strictly earlier than its own date, and that is asserted by a look-ahead audit rather than assumed.

| Measure | Value |
| --- | --- |
| Fixtures in tape | 96 |
| Decided / tied | 94 / 2 |
| Scored by the evidence model | 46 |
| Withheld (SKIP) | 48 (51.1%) |
| Home wins in tape | 50 of 94 (53.2%) |
| Hit rate, all scored fixtures | **54.3%** (25/46) |
| Brier score | 0.3067 |
| Log loss | 0.8477 |
| Mean probability assigned to the pick | 0.736 |
| Overconfidence (claimed minus delivered) | +0.1925 |
| Baseline: always pick home | 60.9% |
| Baseline: prior points leader | 52.3% (n=44) |
| Look-ahead audit | PASS |

| Wilson 95% interval, overall | 0.4018 – 0.6785 |
| Home picks | 15/23 (65.2%) |
| Away picks | 10/23 (43.5%) |
| Publication gate | capped at **MEDIUM** |

### By confidence band

| Band | n | Hits | Hit rate | Brier | Log loss |
| --- | --- | --- | --- | --- | --- |
| HIGH | 20 | 8 | 40% | 0.3919 | 1.0727 |
| MEDIUM | 26 | 17 | 65.4% | 0.2412 | 0.6746 |

### By stage

| Stage | n | Hits | Hit rate |
| --- | --- | --- | --- |
| group | 40 | 22 | 55% |
| quarter-final | 4 | 3 | 75% |
| semi-final | 2 | 0 | 0% |

### Calibration

| Predicted band | n | Mean predicted | Actual | Gap |
| --- | --- | --- | --- | --- |
| 40-60% | 7 | 0.5516 | 0.7143 | 0.1627 |
| 60-80% | 25 | 0.7097 | 0.48 | 0.2297 |
| 80-100% | 14 | 0.8751 | 0.5714 | 0.3036 |

### The two scoring paths

Applied literally, the master prompt's own rubric skipped **100%** of fixtures (96 of 96), because three of its five WIN factors — bowling matchup scouting, batting depth from individual form, and bookmaker odds — have no free key-less source for county cricket. Where it did produce a selection it was right —% of the time (0/0). The declared evidence model, built only from figures the tape verifies, scored 46 fixtures at 54.3%.

Both numbers are published. The first is what the prompt as written can honestly do with public data; the second is what a model restricted to sourced evidence can do. Neither invents a value, and every withheld market says why.

### What the backtest found, plainly

The evidence model hit **54.3%** across 46 scored fixtures. On the same fixtures, simply backing the home county every time would have hit **60.9%**. The model therefore shows **no demonstrated edge over home advantage** on this tape.

Confidence is inverted: the HIGH tier hit 40% (8/20) while MEDIUM hit 65.4% (17/26). The Wilson interval on the HIGH tier is 0.2188–0.6134, so at n=20 that tier is too thin to prove it is worse than MEDIUM — and far too thin to justify publishing it as HIGH. Either way the claim is unsupported, which is what the gate acts on.

The model assigns its picks a mean probability of 0.736 and they win 54.3% of the time — overconfident by 19.3 points. The calibration table shows the gap widening as the claimed probability rises: picks placed in the 80–100% bucket landed 57% of the time. The site therefore publishes the **observed** rate for a tier rather than the model's own probability.

Picks are not skewed toward home sides — the model chose home 23 times and away 23 times — but away picks hit 43.5% against an away base rate of 39.1%, so most of the shortfall sits there.

### The publication gate

These rules live in `scripts/backtest_t20_blast.mjs` and are applied mechanically to whatever the replay produces. The gate never alters a model weight and never refits anything; it only limits what the site may claim.

| Rule | Statement |
| --- | --- |
| `tier_inversion` | If the HIGH tier hit rate is below the MEDIUM tier hit rate, HIGH is not supported by the evidence and published confidence is capped at MEDIUM. |
| `insufficient_sample` | A tier validated on fewer than 30 fixtures cannot support a HIGH claim; the tier is marked insufficient_sample and capped at MEDIUM. |
| `no_edge_over_baseline` | If the overall hit rate does not exceed the always-pick-home baseline, the model has no demonstrated edge; the card must say so and confidence is capped at MEDIUM. |
| `overconfident_probability` | If the mean probability assigned to picks exceeds the observed hit rate by more than 0.10, the model probability is reported as uncalibrated and the observed tier rate is published instead of it. |

**Triggered on the 2026 tape:** `tier_inversion` — HIGH hit 40% over 20 fixtures while MEDIUM hit 65.4% over 26; the tiers are inverted; `insufficient_sample` — HIGH was validated on 20 fixtures, below the 30 needed to support the claim; `no_edge_over_baseline` — the model hit 54.3% against an always-pick-home baseline of 60.9% on the same fixtures; `overconfident_probability` — the model assigned its picks a mean probability of 0.736 and they won 54.3% of the time — overconfident by 19.3 points.

**Result: published confidence is capped at MEDIUM.** Walk-forward validation on the 2026 tape does not support a HIGH claim, so no tip is published above MEDIUM until a larger validated sample says otherwise.

Reweighting the model until it beat the baseline on these 96 fixtures was the obvious way to make these numbers look better, and it was deliberately not done: that would fit the weights to the only tape available and leave nothing to validate against. The gate is applied instead, and it will be re-evaluated whenever `scripts/collect_t20_blast.mjs` adds a season.

### Known limits

The tape captures 96 of 115 season fixtures: 88 of 90 in-group matches, 1 of 18 cross-pool fixtures, and all 7 knockouts. Form and head-to-head are therefore reconstructed from in-group fixtures for most dates, which thins the context around the two absent Derbyshire home fixtures and around every cross-pool date. The model responds by withholding rather than guessing — that is what the 51.1% SKIP rate mostly consists of. `scripts/collect_t20_blast.mjs` exists to close those gaps from the ESPN league calendar for the next season.

