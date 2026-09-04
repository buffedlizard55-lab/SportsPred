# CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT v1.0

This document is the specification the Championship League overlay implements,
followed by an exact map from each rule to the code that enforces it and the
test that proves it.

**This is an overlay, not a replacement.** Every other snooker event on the
OLBG slate keeps [`SNOOKER PREDICTION MASTER PROMPT v3.0`](SNOOKER_PROMPT_REVIEW.md)
and is still scored by `engine/snooker_engine.js` on `snooker.html`. The
overlay applies only when the competition is Championship League Snooker, and
only on `championship-league.html`.

---

## Why an overlay is needed

Championship League Snooker breaks two assumptions the generic snooker prompt
is built on.

1. **A match can be drawn.** The ranking edition plays the best of four
   frames, so 2-2 is a real, common result. A two-way match-result market is
   simply wrong here; the market is three-way.
2. **Two different events share one name.** The ranking and invitational
   editions use different group sizes, different match lengths and different
   qualification rules. Scoring one under the other's rules produces confident
   nonsense.

The overlay therefore makes the edition a hard gate and adds the draw as a
first-class outcome.

---

## Step 0 — Confirm the edition (hard gate)

Before anything is scored, the edition must be stated as `ranking` or
`invitational`. There is no default and no guess.

| | Ranking edition | Invitational edition |
|---|---|---|
| Field | 128 players | 25 players |
| Group shape | 32 groups of 4 | groups of 7 |
| Match format | best of 4 frames | best of 5 frames |
| Draws | **yes** — 2-2 | no |
| Points | 3 win / 1 draw / 0 loss | 3 win / 0 loss |
| Dead frame | fourth frame skipped at 3-0 | n/a |
| Qualification | group winner advances | top four to same-day play-offs |
| Correct-score set | 3-0, 3-1, **2-2** | 3-0, 3-1, **3-2** |

`editionFor()` throws on any other value. Nothing downstream can run without
an edition.

## Step 1 — Collect only sourced inputs

Permitted inputs, and nothing else: completed matches from the verified tape
(scorelines, dates, order of play), the published group standings, published
highest breaks, seed numbers, and the OLBG market slate for display.

Anything not present is recorded as **missing** and scores zero. It is never
estimated, interpolated or filled from memory. Each missing input is listed on
the card so a reader can see exactly what the number is not based on.

**No look-ahead.** A card for a given match is built only from matches that had
already finished — earlier dates, plus earlier matches on the same day, since
the published match order is the order of play. Same-day-later and future
matches are invisible to the scorer. The same builder produces both the live
card and the backtest, so the backtest cannot be more informed than the tip.

## Step 2 — Score the three markets out of 100

### MATCH RESULT

| Category | Max | What earns it |
|---|---|---|
| Recent short-format form | 30 | win rate over the last five completed short-format matches |
| Ranking and seeding gap | 20 | distance between published seed numbers |
| Head-to-head | 20 | earlier meetings in the tape; neutral default 8 when none exist |
| Break-building | 15 | published highest breaks, with a century treated as a decisive weapon |
| Odds and value | 15 | **always missing** — see IR-CLS-01 |

*Draw modifier (ranking edition only).* When the two sides finish within eight
points of each other and head-to-head is neutral, the draw becomes the
selection. Over the best of four frames between evenly matched players, level
is the honest read.

### CORRECT SCORE

| Category | Max |
|---|---|
| Alignment with the match-result read | 40 |
| Scoreline tendency in each player's record | 30 |
| Decisiveness — does this player close matches out or grind them | 20 |
| Break ceiling | 10 |

### GROUP WINNER

| Category | Max |
|---|---|
| Overall group strength (seeding plus short-format form) | 35 |
| Head-to-head advantage inside this group | 25 |
| Projected points path (outright wins are worth three times a draw) | 25 |
| Break ceiling — decides placings on the published tiebreak | 15 |

Players who are level on every sourced measure **share a rank**. Sort order is
not evidence, so it is never allowed to manufacture a gap between candidates
that the data cannot separate.

## Step 3 — Confidence thresholds

| Market | HIGH | MEDIUM | Otherwise |
|---|---|---|---|
| MATCH RESULT | ≥ 70 | ≥ 50 with at least two aligned factors | SKIP |
| CORRECT SCORE | ≥ 70 | ≥ 55 | SKIP |
| GROUP WINNER | ≥ 70 | ≥ 55 | SKIP |

**Group winner additionally requires a fifteen-point clearance** over the next
candidate. Inside that margin the group is declared *too open to call* and no
selection is named. Naming a winner in a four-player group decided on frame
difference and highest break would be a guess wearing a confidence label.

A SKIP is published as a SKIP. It is never quietly softened into a LOW.

## Step 4 — Output rules

Every tip must satisfy all of the following, and each is machine-checked
before the tip is allowed onto the page:

- at least **40 words**;
- the **pick in bold within the first twenty words**;
- **no odds, no statistics, no figures, no percentages** — the only digits
  permitted anywhere are the scoreline in a correct-score tip;
- **no citations, links, handles or source names** in the tip text;
- **varied openings** — the opening word is unique per market per card;
- none of the six banned phrases;
- an explicit confidence of LOW, MEDIUM, HIGH or SKIP.

Each card also carries a summary table, any value candidates, and the full
responsible-gambling section (GamCare, 0808 80 20 133, free, 24 hours a day).

---

## Rule → code → test map

| Rule | Implementation | Test |
|---|---|---|
| Edition hard gate | `editionFor` | *refuses to score without a stated edition* |
| Correct-score set switches by edition | `scoreCorrectScore` | *correct score outcome set* |
| Draw modifier, ranking only | `scoreMatchResult` | *draw modifier* |
| Missing inputs score zero, never guessed | `comp(..., { missing: true })` | *missing is recorded, not guessed* |
| Step 3 thresholds | `RULES`, `CONFIDENCE` | *confidence bands* |
| Fifteen-point group clearance | `scoreGroupWinner` | *too open when the leader is not fifteen points clear* |
| Tied players share a rank | `rankOf` map | *players level on every sourced measure share a strength tier* |
| No look-ahead | `seqIndex`, `priorMatches` | exercised by `backtest` |
| 40-word floor | `validateTip` | *minimum length* |
| Bolded pick in first 20 words | `validateTip` | *bolded pick* |
| Digit ban | `digitsAllowedFor` | *digit ban* |
| Banned phrases | `BANNED_PHRASES` | *banned phrases* |
| No citations or handles | `FORBIDDEN_TOKENS` | *links and handles* |
| Varied openings | `openingWord`, `pickUnique` | *openingWord* |
| Responsible gambling present | `RESPONSIBLE_GAMBLING` | *responsible gambling* |

Files: `engine/snooker_cls_engine.js` (scoring), `engine/snooker_cls_writer.js`
(writing and validation), `engine/snooker_cls_card.js` (card assembly and
walk-forward backtest), `tests/snooker_cls_engine.test.mjs` (30 tests).

## Data and verification

`scripts/build_cls_snooker.mjs` parses the transcribed match tape and the
published standings, **recomputes all 42 group tables from the scorelines**
and compares them field by field against the published tables. A single
mismatch fails the build. Current state: 253 matches, 168 rows, 42 groups,
zero problems. Output: `data/snooker_cls.json`.

`scripts/backtest_snooker_cls.mjs` replays every card in date order under the
no-look-ahead rule and settles it against the published result. Output:
`data/snooker_cls_backtest.json`. No return-on-investment figure is published,
because without prices any such figure would be invented.

See [`CLS_SNOOKER_SOURCES.md`](CLS_SNOOKER_SOURCES.md) and
[`CLS_SNOOKER_IRREGULARITIES.md`](CLS_SNOOKER_IRREGULARITIES.md).
