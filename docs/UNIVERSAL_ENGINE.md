# Universal engine — line-by-line review

This document walks the universal two-competitor engine from raw feed to written
tip, and states for every step what is **measured**, what is **chosen**, and what
is **refused**. It is the honesty audit for `engine/espn_universal.js`,
`engine/universal_engine.js` and `engine/universal_writer.js`.

Every claim below is backed by a test in `tests/universal.test.mjs` (30 tests)
or `tests/dom_smoke.test.mjs` (8 tests) unless marked otherwise.

---

## 1. Feed layer — `engine/espn_universal.js`

### 1.1 The endpoint

```
https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD-YYYYMMDD
```

No key. CORS-open, so the browser calls it directly. The date-range form was
verified live on 2026-09-02 against `soccer/sco.1` for `20260901-20260903`,
which returned the Celtic v Aberdeen fixture — a range query genuinely works and
is what makes a one-request history scan possible.

### 1.2 Field map (verified 2026-09-02, `soccer/eng.1`, event `401879286`)

| Feed path | Parsed to | Notes |
|---|---|---|
| `event.id` | `id` | |
| `event.date` | `startUtc`, `dateISO` | ISO 8601 with `Z` |
| `competitions[0].status.type.state` | `phase` | `pre`→upcoming, `in`→live, `post`→results |
| `competitions[0].venue.fullName` | `venue` | |
| `competitions[0].neutralSite` | `neutral` | suppresses the home-baseline sentence |
| `competitors[].form` | `home.form` / `away.form` | soccer only; `"WWDLW"` |
| `competitors[].records[].summary` | `record` | `"1-1-0"` → W-L-D |
| `competitors[].curatedRank.current` | `rank` | poll sports only; sentinel >90 discarded |
| `competitions[0].odds[0].moneyline.{home,away,draw}.close.odds` | `odds.moneyline` | American |
| `competitions[0].odds[0].pointSpread.home.close.line` | `odds.spread` | |
| `competitions[0].odds[0].total.over.close.line` | `odds.total` | |
| `competitions[0].odds[0].provider.name` | `odds.provider` | attributed in the UI and in the tip |

**This is the biggest change in this revision.** The previous version of the
repository recorded `IR-01: no free key-less odds source`, and every
price-dependent rule was permanently skipped. That is no longer true: ESPN
republishes a sportsbook's moneyline, spread and total inside the same
scoreboard payload. `IR-01` is superseded for the universal engine by `U-03`,
which states the narrower, accurate limitation — it is one book, not a market.

### 1.3 What the parser refuses

- `parseRecord('')`, `parseRecord('   ')`, `parseRecord('1-2-3-4')`,
  `parseRecord('x-y')` and `parseRecord('0-0-0')` all return `null`. (An earlier
  draft returned a record with `played: NaN` for the empty string; the test
  caught it.)
- `parseOdds` returns `null` when the odds array is absent or empty; it never
  fabricates a price.
- `devig` returns `null` if any leg is missing, so a partial book never produces
  a fair probability.
- Any field ESPN omits stays `null` and becomes an entry in `missing[]`.

---

## 2. League baseline — measured, not assumed

`buildLeagueContext(completedMatches)` computes, from finished matches only:

- `homeWinRate`, `drawRate`, `awayWinRate`
- `meanTotal` — the mean combined score
- `sample` — how many matches it saw

**Under 10 completed matches it returns `sufficient: false` and no rates at
all.** The engine then falls back to a neutral 0.500 baseline, records
`BASE-01` in `missing[]`, and caps confidence at 62 — which is below the HIGH
threshold, so a league with no measured baseline can never produce a HIGH tip.

There is no home-advantage constant anywhere in the codebase. Search for one and
you will not find it; the tests assert the baseline is sourced or absent.

---

## 3. Signals

| Rule | Source | Contributes |
|---|---|---|
| `BASE-01` | measured league home-win share of decided games | the starting log-odds |
| `FORM-01` | `competitor.form` (live) or the match tape (backtest) | `WEIGHTS.form × (homeFormRate − awayFormRate)` |
| `REC-01` | `competitor.records` (live) or the tape (backtest) | `WEIGHTS.record × (homeWinPct − awayWinPct)` |
| `RANK-01` | `curatedRank` | `WEIGHTS.rank × clamp((awayRank − homeRank)/25, −1, 1)` |
| `H2H-01` | prior meetings in the collected window, ≥3 required | `WEIGHTS.h2h × win-share edge` |
| `REST-01` | days since each side's last completed fixture | `WEIGHTS.rest × clamp(Δdays/7, −1, 1)` |

Each signal records `{id, label, value, detail, source, points}`. A signal with
no data contributes nothing and appends `{id, label, reason}` to `missing[]`.
The reason is a sentence, not a code — it has to explain itself to a reader.

---

## 4. Market blend

When a price exists:

1. American → decimal → raw implied probability.
2. Proportional de-vig across the two or three legs so they sum to 1.
3. `p_final = 0.55 × p_market + 0.45 × p_model`.

When no price exists, `p_final = p_model`, no price rule fires, and the
confidence ceiling drops to 74.

The frozen `WEIGHTS` export, in full:

```js
{ form: 1.1, record: 1.3, rank: 0.55, h2h: 0.45, rest: 0.1, marketWeight: 0.55 }
```

`WEIGHTS.marketWeight = 0.55` is a **chosen** number. So are the five signal
weights. They are exported as a frozen object precisely so they can be argued
with, and the backtest exists to argue with them.

---

## 5. Confidence and caps

```
probability part : (p − 0.5) / 0.4, clamped 0..1, × 52, + 40
evidence part    : (signals / 5), clamped 0..1, × 8
market part      : +4 if priced, plus up to +6 for a positive model edge
```

then clipped by a cap:

| Condition | Cap |
|---|---|
| no measured league baseline | 62 |
| no published price | 74 |
| fewer than 3 sourced signals | 66 |
| fewer than 2 sourced signals | 0 → SKIP |

Bands: **HIGH** ≥ 72, **MEDIUM** ≥ 58, **LOW** ≥ 46, otherwise **SKIP**.

---

## 6. Markets published

| Market | Published when |
|---|---|
| Match result (moneyline / full time result) | always attempted |
| Double chance | three-way sports only, and only as a fallback headline — see below |
| Handicap | a spread line is published **and** the favourite's straight-result probability ≥ 0.62 |
| Total | a total line is published **and** the measured league mean sits ≥ 6% away from it |

**Headline selection.** Double chance is structurally the safest bet on any
three-way card and would otherwise win every headline, making every tip on the
site read the same. The headline is therefore the highest-scoring
**non-derived** market; a derived market is only promoted when nothing else
cleared the threshold. This is enforced in `scoreUniversalMatch` and is visible
in the market table on every match card.

---

## 7. Writer and output rules

The writer can only reference signals present in `result.model.signals`. It has
no access to the raw match object, so it is structurally unable to state a fact
the engine did not source.

Enforced by `validateUniversalTip` and tested one rule at a time:

1. bolded selection inside the opening sentence
2. bolded text equals the scored selection exactly
3. 55–170 words
4. no banned filler (16 phrases, each individually tested)
5. no guarantee language
6. a SKIP market can never be written as a selection

A tip that fails is **withheld**, and the violation list is shown in the UI in
its place.

Sentences are descriptive, not persuasive: "Season records read X" rather than
"Season records back it up", because the record may point the other way and the
engine has already weighed the direction.

---

## 8. Backtest leak control

`scripts/backtest_universal.mjs` does **not** use `competitor.form` or
`competitor.records` when grading history, because for a finished match those
fields describe the team *after* that match. It rebuilds form, season record,
league baseline and head-to-head from games that completed strictly before each
fixture's kick-off.

The one thing it cannot do is grade the price. This was assumed to be a
"closing price is sharper" caveat until the 2026-09-02 CI run measured it:
**across 1214 graded fixtures, zero carried an odds block.** ESPN attaches odds
to pre-match and in-play events and strips them once the event is final.

So `roi` is reported as `null`, not estimated, and the backtest grades the
**model probability only** — the 0.55 market-blend leg is untested by it. Only
forward collection, which stores the pre-match price at capture time, can grade
the blended output. Recorded as `U-06`.

### What the 2026-09-02 run actually measured

120-day window, 1214 graded match-result predictions:

| Band | n | Hit rate | Brier |
|---|---|---|---|
| HIGH | 145 | **64.1%** | 0.261 |
| MEDIUM | 612 | **61.8%** | 0.255 |
| LOW | 457 | **49.5%** | 0.255 |
| Overall | 1214 | 57.4% | 0.256 |

The bands are monotonic — HIGH beats MEDIUM beats LOW — which is the one thing a
confidence scale has to get right, and it is the only claim this table supports.
It is a single 120-day window on mostly-soccer fixtures, it grades the model leg
only, and it is not evidence of profitability, because without prices no
profitability figure exists.

---

## 9. What this engine does not do

- It does not predict horse racing, greyhounds, darts, snooker, Gaelic football,
  cycling, boxing or golf. There is no key-less structured feed for the first
  six; boxing has no fighter-form feed; golf is an outright over a full field
  rather than a two-competitor contest. Those sports are listed with their OLBG
  index and their governing body and produce nothing.
- It does not use injury news, lineup news, weather or social sentiment. No free
  structured source exists for them, so they are absent rather than approximated.
- It does not claim its weights are optimal. It claims they are visible.
