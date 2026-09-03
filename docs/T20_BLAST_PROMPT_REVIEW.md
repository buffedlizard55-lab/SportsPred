# T20 Blast master prompt — line-by-line review

A compliance review of the **T20 BLAST (ENGLAND & WALES) CRICKET PREDICTION
MASTER PROMPT v1.0** against what free public sources actually provide.

Three verdicts are used:

- **Implemented** — built, and covered by tests.
- **Implemented, unsourced** — the rule is written and unit-tested, but the input
  has no free key-less source, so it is recorded missing and the affected market
  is withheld. Never estimated.
- **Not satisfiable** — cannot be honoured from public data at all, with the
  reason and the remediation stated.

## Step 1 — collect and organise the data

| Requirement | Verdict | Where |
| --- | --- | --- |
| Fixtures and results for the competition | Implemented | 96 of 115 fixtures verified in `data/t20_blast_matches.json`; coverage and the three declared gaps in `counts` and `gaps` |
| Dates, venues, stages | Implemented | every row carries `date`, `stage`, `group`; `venue` where a source printed one, `null` where none did |
| Points table | Implemented | `data/t20_blast_standings.json`, all three groups, points arithmetic and NRR recomputed and matched (CHECKs 6–7) |
| Player statistics | **Implemented, unsourced** | Season aggregates captured in `data/t20_blast_leaders.json`. Per-match player figures and confirmed line-ups exist only for a live fixture (TB-IR-04) |
| Head-to-head | Implemented, limited | One season only; the prompt's three-year span needs a longer tape (TB-IR-05). `sample_basis` says so on every row |
| Odds | **Implemented, unsourced** | Every odds rule is written and tested; no free key-less feed exists (TB-IR-02) |
| Weather and pitch | **Implemented, unsourced** | Rules fire on a confirmed revised target; no structured forecast or pitch feed is tied to an event id (TB-IR-03) |
| No manual input | Implemented | Every figure came from a page or endpoint in `docs/T20_BLAST_SOURCES.md`; the builder re-derives all five documents from those sources |
| Links for manual review | Implemented | `source_url` plus a `review_urls` array on every row; knockouts point at the exact full scorecard; the page prints them in each Analysis panel |

## Step 2 — the five WIN MATCH factors

| Factor | Weight in the prompt | Verdict |
| --- | --- | --- |
| Recent form | yes | **Implemented** — last five captured fixtures, most recent first, streak and opposition form included |
| Head-to-head | yes | **Implemented** — three most recent meetings weighted double, oriented per side (TB-IR-09 fixed a bug where both sides got identical points) |
| Bowling matchup scouting | yes | **Implemented, unsourced** — needs a pitch report and per-bowler matchup data; neither has a free structured source |
| Batting depth from player form | yes | **Implemented, unsourced** — needs confirmed line-ups and rolling individual form, available only live |
| Bookmaker odds | yes | **Implemented, unsourced** — no free key-less price feed |

Because three of five factors cannot be sourced, the rubric **as literally
written** resolves to SKIP on 100% of fixtures. That is reported as a finding,
not patched over: the strict-path SKIP rate is printed beside the evidence
model's hit rate in the backtest and on the page. A declared evidence model built
only from verified results is what produces tips.

## Step 3 — confidence and correlation rules

| Rule | Verdict | Note |
| --- | --- | --- |
| Tiered confidence with explicit thresholds | Implemented | HIGH ≥ 70 and probability ≥ 0.60 with an adequate sample; MEDIUM ≥ 55; otherwise SKIP |
| Never more than three individual player markets per match | Implemented | Enforced in `scoreBlastMatch`; the weakest is withheld and a `CORRELATION` flag records it |
| Crossover fixtures carry thinner data | Implemented | `cross_pool_fixture` cap; can never read HIGH |
| Rain or a revised chase drops every market one tier | Implemented | `rain_or_dls` cap; fires on the one verified DLS fixture |
| A confirmed key absence reduces confidence | Implemented | `key_player_unavailable` cap; the absence must be confirmed, never inferred |
| MoM HIGH requires a score of 75+ **and** odds in +400..+900 | **Not satisfiable** | With no price feed the odds condition can never be met, so the tier is unreachable however strong the evidence. Best available is MEDIUM |
| Never claim certainty | Implemented | Probability clamped to 0.05–0.95 |
| Confidence must mean something | Implemented, and **capped** | Walk-forward validation shows the tiers inverted and the model overconfident by 19.3 points, so the publication gate caps everything at MEDIUM (TB-IR-11) |

## Step 4 — output format

| Rule | Verdict | How it is enforced |
| --- | --- | --- |
| Four tips per fixture, exact order | Implemented | `MARKET_ORDER`; asserted in tests |
| At least forty words per tip | Implemented | `MIN_WORDS = 40`; `validateBlastTip` rejects anything shorter |
| Below-threshold market is one sentence beginning SKIP | Implemented | `expectSkip` path rejects multi-sentence SKIPs and anything not starting `SKIP` |
| Selection bolded inside the first twenty words | Implemented | `BOLD_WORD_LIMIT = 20`; the word index of the bold span is measured |
| WIN MATCH names a team, never a player | Implemented | every known player name is checked against the prose outside the bold span |
| Player markets name a player, never a team | Implemented | `COUNTY_TOKENS` — all eighteen counties plus short names and Blast nicknames — is checked with word-boundary matching |
| No odds figures or prices | Implemented | digits banned in prose; `odds`, `price`, `bet`, `stake`, `wager`, `bookmaker`, `punter` banned as words |
| No source citations or social references | Implemented | `cricinfo`, `espn`, `olbg`, `bbc`, `wisden`, `http`, `@`, `twitter` banned |
| No dates | Implemented | every month and weekday name banned, plus `today`/`tomorrow`/`yesterday` |
| No speculation on availability | Implemented | `injured`, `injury`, `unavailable`, `ruled out`, `doubtful`, `fitness` banned |
| No reference to finances or a points deduction | Implemented | `deduction`, `finances`, `financial`, `special measures`, `salary cap`, `sanction` banned |
| Confidence stated on every tip | Implemented | a tier word must be present |
| Unique opener per card | Implemented | Hard within a fixture; soft across the page with `openerPoolExhausted` reported, so a long slate degrades instead of failing |
| Banned filler phrases | Implemented | all seven are matched case-insensitively |
| Summary table, value flag, weather note, responsible-gambling reminder | Implemented | `buildBlastFormattedCardText` emits all four, plus the validation disclosure |
| Copy-pasteable | Implemented | the card text is plain, with markdown bolding stripped |

## Style requirements

The prompt asks that no two tips share an opening word, phrase or structure. This
is met mechanically rather than by asking nicely: eighteen WIN angles and eight
player angles each open with a different word and take a different analytical
line; three phrasings exist per evidence component and are rotated
deterministically, so consecutive tips state the same sourced fact differently.
A hard rule is enforced inside each fixture; across a long slate the finite pool
is allowed to repeat and the repetition is reported.

## Where the prompt and reality diverge

1. **The rubric cannot run on public data.** Three of five WIN factors, and every
   price-dependent gate, need sources that do not exist free and key-less for
   county cricket. Implemented and reported; not estimated.
2. **MoM HIGH is unreachable.** It requires an odds band. Documented as
   TB-IR-02.
3. **Player markets need a live fixture.** Confirmed line-ups and rolling
   individual form are not published for a completed season. The path is built
   and tested against a synthetic confirmed XI, so a live season works; the
   historical tape correctly withholds.
4. **The confidence tiers do not survive validation.** The prompt assumes a
   tier means something. On this tape HIGH hit 40% against MEDIUM's 65%, and the
   model underperformed always-pick-home. The gate caps published confidence and
   prints the observed rates. The weights were not refitted to make the numbers
   look better — that would leave nothing to validate against.
