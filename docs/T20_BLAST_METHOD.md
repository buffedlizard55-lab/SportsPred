# T20 Blast method

How a fixture becomes four published markets, and what stops a fabricated or
non-compliant tip reaching the site.

Competition: T20 Blast (Vitality Blast, men), England & Wales. Ruleset:
`T20 BLAST (ENGLAND & WALES) CRICKET PREDICTION MASTER PROMPT v1.0`.

## Layers

```
data/t20_blast_matches.json          verified tape, 96 fixtures
        │
engine/t20_blast_data.js             walk-forward context (pure, no I/O)
        │   formFor · h2h · tableAt · homeWinRate · restFor · marginProfile
        │   contextFor(row, matchesDoc, opts)
        ▼
engine/t20_blast_engine.js           scoreBlastMatch(row, ctx)
        │   two paths: strict prompt rubric + declared evidence model
        │   caps, flags, missing[]
        │   applyPublicationGate(result, gate)
        ▼
engine/t20_blast_writer.js           writeBlastCard(scoredRows)
        │   validateBlastTip() gates every tip; nothing unvalidated is returned
        ▼
assets/js/t20-blast-page.js          board · calendar · tips · card text
```

`scripts/build_t20_blast.mjs` builds and verifies the tape (nine checks).
`scripts/backtest_t20_blast.mjs` replays it walk-forward and computes the gate.
`scripts/collect_t20_blast.mjs` extends it for a new season.

## Two scores, deliberately

**`strict_prompt`** — the rubric exactly as the master prompt writes it,
delegated to `engine/cricket_engine.js`. Three of its five WIN factors have no
free key-less source for county cricket: bowling matchup scouting, batting depth
from individual player form, and bookmaker odds. Each is recorded missing and
penalised, which under the prompt's own thresholds drives **every** fixture to
SKIP. That is the honest output of the rubric as written against the data that
exists, so it is reported rather than hidden — the backtest prints its 100% SKIP
rate beside the evidence model's numbers.

**`evidence`** — a declared walk-forward model built only from figures the tape
verifies. This is what produces tips.

| Factor | Weight | Source |
| --- | --- | --- |
| Recent form, last five captured fixtures | 30 | tape results |
| Season points rate to date, deduction restored | 20 | tape results + table |
| Head-to-head, three most recent meetings weighted double | 15 | tape results |
| Venue — the league's own **measured** home-win rate to date | 15 | tape results |
| Winning-margin profile, decisive against narrow | 10 | tape result strings |
| Rest, days since the previous captured fixture | 10 | tape dates |

Weights sum to 100, are declared in `engine/t20_blast_engine.js`, and were
**never fitted** against the tape they are validated on
(`weights_fitted_to_this_tape: false`). No home-advantage constant is assumed
anywhere: it is measured from the fixtures already played.

Probability is a logistic mapping of the evidence gap,
`p = 1 / (1 + e^−((score − 50) / 12))`, clamped to 0.05–0.95 so a sourced model
never claims certainty. The slope is declared, not fitted.

Bands: HIGH needs a score of 70 or more, probability 0.60 or more, and an
adequate sample; MEDIUM needs 55 or more with an adequate sample; otherwise SKIP.
"Sample adequate" means both sides have three or more earlier captured fixtures —
early-season fixtures are withheld rather than scored on one or two results.

## Walk-forward, and the guarantee that it stays that way

`resultsBefore(matches, dateISO)` filters on a **strict** `date < dateISO`. A
fixture therefore never enters its own context, and nothing dated later can leak
in. That is asserted, not assumed: the backtest runs a look-ahead audit over all
96 fixtures and fails if any fixture appears in its own prior-results set or if a
later-dated fixture enters a context. Identities are compared on event id where
present and on a composite key otherwise — comparing on event id alone produced a
false positive when six knockout rows had null ids, which is how that gap was
found (TB-IR-10).

Net run rate is deliberately **excluded** from context. It is a season-cumulative
figure that cannot be reconstructed as it stood on a past date without the full
ball-by-ball record, so using it would be look-ahead. The builder recomputes it
from published runs-for and runs-against to verify the table, and the model never
reads it.

`tableAt` counts **league-stage fixtures only**. A quarter-final win is not four
league points and does not belong in a group table; including it inflated a
county's season-strength component precisely when that component was being used
to score the knockout it came from.

## Caps and flags

Applied in `scoreBlastMatch`, in this order:

- `no_market_price` — always. No free key-less price feed exists (TB-IR-02).
- `cross_pool_fixture` — a fixture against a county from another group has thinner
  head-to-head and matchup evidence, so it can never read HIGH (prompt Step 3).
- `rain_or_dls` — a confirmed or highly likely revised chase drops every market
  one tier.
- `key_player_unavailable` — a confirmed absence drops every market one tier.

A county's points deduction is read as **adjusted performance** (the deduction is
restored when measuring season strength, so nobody is penalised twice) and is
flagged as internal context only. It can never appear in a tip: the writer bans
`deduction`, `finances`, `special measures` and related tokens outright.

## The writer

Four markets per fixture in the mandated order — WIN MATCH, MAN OF THE MATCH,
TOP TEAM 1 BATSMAN, TOP TEAM 2 BATSMAN. Rules are enforced by code, not requested
of a model:

- at least forty words; a withheld market is one sentence beginning `SKIP`
- the selection bolded inside the first twenty words
- WIN MATCH names a county and never a player; player markets name a player and
  never a county, short name or Blast nickname (`COUNTY_TOKENS` covers all
  eighteen plus their nicknames)
- no digit in the prose — odds, dates, scores and lines can never leak. Two
  exemptions are explicit: the mandated label `TOP TEAM 1 BATSMAN` itself, and a
  sourced name inside the bold span, which is reported as a note rather than
  silently allowed
- no price, source citation, social reference, month or weekday name, and no
  speculation about availability
- none of the prompt's banned filler phrases
- a confidence tier stated on every tip
- no two tips on the same fixture open with the same word

A tip that fails validation is never returned. The writer tries the next angle
and, if none validate, **withholds the market** and records the conflict in
`card.withheld` — it does not throw the card away. Failing loudly on a long slate
would break the Generate button, which is the exact failure this site is being
fixed for. Uniqueness is therefore hard per fixture and soft across the page:
with eighteen WIN angles and eight player angles, a twenty-fixture slate cannot
open every tip differently, so `openerPoolExhausted` is reported instead.

The card ends with a summary table, a value-flag note, a weather note, a
validation disclosure and a responsible-gambling reminder. Digits appear only in
the disclosure, because quoting an observed hit rate requires a number and the
tips are not where it belongs.

## The publication gate

`scripts/backtest_t20_blast.mjs` derives four rules from the replay; all four
trigger on the 2026 tape, capping published confidence at **MEDIUM**.
`applyPublicationGate(result, gate)` is pure — it takes the gate as an argument
and never reads a file — so the browser, CI and the backtest all apply it
identically.

The gate caps a tier and never touches a weight, a score or a probability. Each
market keeps `modelBand` beside the published `band`, and the observed rate shown
to a reader belongs to the tier the model actually chose. Without that, capping
would quietly launder a weak claim into a stronger-looking one.

Full numbers and reasoning: [`T20_BLAST_BACKTEST.md`](T20_BLAST_BACKTEST.md).
