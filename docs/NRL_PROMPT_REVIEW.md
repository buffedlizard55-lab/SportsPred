# NRL PREDICTION MASTER PROMPT v1.0 — line-by-line implementation review

Every requirement of the master prompt, with the code that enforces it and the
test that proves it. Status legend:

- ✅ implemented from a verified free source
- 🟡 implemented with a named, disclosed substitute
- ⛔ cannot be sourced for free — scored zero, listed as missing, never estimated

Run the proofs with:

```bash
node --test tests/nrl_data.test.mjs tests/nrl_engine.test.mjs tests/nrl_writer.test.mjs
node --test tests/dom_smoke.test.mjs        # nrl.html boots and the button works
```

## Step 1 — collect

| Requirement | Source | Status | Where | Test |
|---|---|---|---|---|
| Fixture slate / all markets currently on the board | OLBG Rugby League index + event pages | ✅ | `data/nrl_slate.json` | `nrl_data` market-lines test |
| Market list per event (To Win, Handicap 2-way, Total Points) | OLBG event page | ✅ | `slate.events[].markets` | markets-offered assertion |
| Handicap line | OLBG event page, labelled with its source | ✅ | `nrlMarketLines().handicapLine`, `handicapLineSource` | Titans v Dolphins = 12.5 / `olbg_event_page` |
| Total line | OLBG event page or index best tip | ✅ | `totalLine`, `totalLineSource` | 57.5 on the Titans fixture |
| Bookmaker prices, two books, line movement | none | ⛔ NRL-02 | the odds factor scores zero and is named on every card | 'a card never invents an odds figure' |
| Last 5-6 matches, recency weighted, with margins and opposition quality | the season tape | ✅ | `nrlForm()` — weights 1.0 → 0.5, `oppPos` from the ladder snapshot after the previous round | form walk-forward test |
| Ladder position and points (2 win / 1 draw / 2 bye, differential first) | computed from the tape, validated against the published table | ✅ | `nrlLadderAt()` | 'the tape reproduces the published ladder after round 26' |
| Finals cut-offs (top four double chance, five to eight sudden death) | ladder position | ✅ | `scoreLadderStakes()` records the band for both clubs | top-four detail assertion |
| State of Origin duty | 2026 Origin calendar (dates + result) | ✅ | `nrlOriginContext()` | Origin window test |
| Head-to-head, recent weighted | the tape | ✅ | `nrlH2H()` (3 : 2 : 1) | h2h test |
| Team list, judiciary suspensions | none | ⛔ NRL-03 | the factor's injury/suspension half is never scored | key-absences test |
| Warriors travel | club home venue + country | ✅ | `nrlTravelContext()` | trans-Tasman test |
| Golden point history | none labels the period | 🟡 NRL-05 | one- and two-point margins are recorded as *close finishes* | close-finishes test |
| Bye context | the draw | ✅ | `nrlRestAndBye()` | Canberra off the round 26 bye |
| Finals venue context | n/a until finals | ✅ | venue comes from the fixture listing and is shown, not assumed | — |
| Weather | Open-Meteo, key-less | ✅ | `nrlWeatherFor()` | weather classification test |

## Step 2 — score

### WIN MATCH (100)

| Rule | Status | Code | Test |
|---|---|---|---|
| Form 25 / 17 / 8 / 0 on last 6, recency weighted | ✅ | `scoreRecentForm` | every tier asserted |
| Ladder 20 / 12 / 5 / 0, with extra weight inside the top four | ✅ | `scoreLadderStakes` | every tier + the top-four note |
| H2H 15 / 7 / 0 on the last three, weighted 3 : 2 : 1 | ✅ | `scoreHeadToHead` | every tier |
| Absences 20 / 10 / 0, Origin included | 🟡 | `scoreKeyAbsences` — the Origin half is scored from the verified calendar, the injury half is left unscored | Origin baseline is `partial`, never `missing === false` |
| Odds 15 / 11 / 7 / 4, underdog value 8 | ⛔ | `scoreOddsAndValue` — every band is implemented; with no feed it returns 0 + `missing` | every price band asserted, including the underdog case |
| Travel 5 / 0, trans-Tasman and Origin return | ✅ | `scoreTravelAndVenue` | four cases asserted |

Coverage and the evidence cap (`coverageOf`, `winBand`): the prompt's thresholds
are applied to a score normalised over the weight that was actually sourced, and
confidence is then capped — nothing is published below 50 % coverage, nothing
reaches HIGH below 75 %, and a published market on 50–60 % coverage drops to LOW.
This is the mechanism that stops a missing factor from silently inflating a card.
Documented as a deviation in [`NRL_IRREGULARITIES.md`](NRL_IRREGULARITIES.md)
(NRL-02, NRL-03).

### HANDICAP (100)

| Rule | Status | Code | Test |
|---|---|---|---|
| Base = WIN MATCH score | ✅ | `scoreNrlHandicap` | base and score asserted |
| Margin trend +15 / −10 | ✅ | `hcap_margin_trend` | 80 → 95, 62 → 52 |
| Origin fatigue −8 | 🟡 | `hcap_origin_fatigue` — never applied as a guess; per-club Origin representation has no free feed | the component is recorded missing inside a window |
| Live only when WIN MATCH ≥ 60 | ✅ | gate | 'below the 60' reason asserted |
| 70+ HIGH, 55–69 MEDIUM, <55 SKIP | ✅ | `scoreNrlHandicap` band | asserted |

### GAME TOTAL (100)

| Rule | Status | Code | Test |
|---|---|---|---|
| Offence 30 Over / 25 Under | ✅ | `combined_offence` | 30, 25 and the neutral case |
| Defence 25 Over / 20 Under | ✅ | `combined_defence` | both directions |
| Recent totals 20 Over / 18 Under | ✅ | `recent_totals` measured against the market line, or the season mean when no line is published | both directions |
| Game state / golden point 15 Under | 🟡 | `golden_point_state` — close finishes are counted, golden point never asserted | the detail text says so explicitly |
| Weather 10 Over / 10 Under | ✅ | `weather` | dry, wet and intermediate |
| 20+ HIGH, 15–19 MEDIUM, <15 SKIP | ✅ | advantage gates | 15 → MEDIUM, 85 → HIGH |

## Step 3 — decision rules

| Rule | Code | Test |
|---|---|---|
| WIN MATCH 70 / 50–69 with two aligned / below 50 | `winBand` | every branch, including the coverage caps |
| Aligned factor = a component at 60 % or more of its weight | `scoreNrlWinMatchForSide` | covered by the band tests |
| HANDICAP live only at WIN MATCH ≥ 60; 70 / 55 / below | `scoreNrlHandicap` | asserted |
| GAME TOTAL 20 / 15 / below | `scoreNrlGameTotal` | asserted |
| Value candidate on the match's own merits | `valueFlag()` — the card backs the lower-ranked club on form or head-to-head, and says no price comparison is possible | 'value candidates are only named where…' |
| Cap active recommendations sensibly per match | `scoreNrlMatch`: at most two live markets; the total is preferred over a handicap on the same side; a handicap whose margin test adds nothing is withheld | 'every live card publishes at most two markets' |

## Step 4 — output

| Rule | Code | Test |
|---|---|---|
| Three markets per match, in order | `writeNrlCard` loops `MARKETS` | three tips per match |
| Minimum 40 words | `MIN_WORDS`, `padToMinimum` | every published tip asserted |
| Pick bolded inside the first 20 words | the tip text puts `**pick**` first, validator checks the word index | asserted |
| Handicap names only who covers, totals say only Over/Under | selection strings + a digit ban | asserted per market |
| No odds, figures, statistics, links, brackets or sources | `FORBIDDEN_PATTERNS` in `validateNrlTip` | each class of breach tested |
| No banned phrases | `BANNED_PHRASES` (exactly the prompt's six) | asserted against the live card |
| Varied openings | `takeOpener` (26 opening phrases, no repeats on a card) | 'openers vary' |
| Confidence stated | `Confidence: LOW|MEDIUM|HIGH.` | asserted |
| SKIP is one explanatory sentence | `skipText` | asserted |
| Summary table | `buildNrlFormattedCardText` | asserted |
| Value notes | `card.valueFlags` | asserted |
| Responsible gambling section | `RESPONSIBLE_GAMBLING` (six paragraphs: model estimates not guarantees, stake what you can afford and set limits, get help, AU 1800 858 858 + BetStop, NZ 0800 654 655, elsewhere + confirm details) | each paragraph asserted on the page and in the card text |

## Deviations, stated plainly

1. **Evidence-weighted scoring.** With no price feed and no absence feed, the
   raw score can never reach the prompt's thresholds. Rather than lowering the
   thresholds, the score is normalised over the weight that was sourced and
   confidence is capped by coverage. Every card states its coverage.
2. **The per-match cap.** "Cap sensibly" is not defined by the prompt, so it is
   defined here: two markets per fixture, the total preferred over a correlated
   handicap, and no handicap without a supporting margin trend. (NRL-09.)
3. **Weather is excluded from the backtest** rather than scored zero, because no
   free historical forecast is committed. (NRL-07.)
