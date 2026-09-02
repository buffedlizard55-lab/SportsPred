# Irregularity register

Everything that did not check out, that could not be verified, or that conflicts
with the brief. The machine-readable version — which the site renders under
**Data quality** — lives in [`../data/provenance.json`](../data/provenance.json);
this page is the readable form and is kept in step with it.

Verified 2026-08-31.

---

## Blockers

### IR-01 — OLBG exposes no structured odds · HIGH · SUPERSEDED for the universal engine (2026-09-02)
> **Update.** This entry remains true *of OLBG*, and it still binds the three
> specialist prompts (cricket, handball, tennis) on `pro.html`, which are written
> against OLBG market rows. It is **no longer true of the site as a whole**: the
> ESPN scoreboard payload republishes a sportsbook's moneyline, spread and total
> in `competitions[0].odds[0]`, verified live on 2026-09-02 for `soccer/eng.1`
> event `401879286`. The universal engine consumes that price, de-vigs it and
> blends it at `marketWeight = 0.55`.
>
> The narrower, accurate limitation is recorded as **U-03** in
> [`../data/irregularities.json`](../data/irregularities.json) and rendered on
> [sources.html](../sources.html#irregularities): the ESPN price is a *single
> book* (DraftKings), not a consensus, so the two-bookmaker cross-reference the
> master prompts ask for is still unmet. It is attributed by name everywhere it
> is shown.

The tips index and event pages are server-rendered, but prices are injected
client-side into the betslip. The only price text found anywhere was inside
free-text tipster commentary on event 899350 ("Alcaraz is favored at 1.20,
Safiullin 5.50"), which is prose, not data.

Step 1 of the master prompt requires odds cross-referenced across at least two
bookmakers. That cannot be met from OLBG. Every odds-dependent factor is
therefore unscored:

- implied-probability band (25 pts, win match)
- first-set price band (−5 pts modifier)
- handicap price band (25 pts)
- both "shorter than −500" blocking rules

An integration test asserts that no odds field exists anywhere in `slate.json`,
so a future edit cannot quietly introduce an invented price.

### IR-02 — The standard free match dataset is gone, but verified mirrors exist · HIGH · PARTIALLY RESOLVED
`github.com/JeffSackmann/tennis_atp` returns 404 (re-verified 2026-08-31). A
GitHub API query for that user returned exactly one public repository,
`tennis_MatchChartingProject` — point-by-point charting, not match results.

**Resolution for history:** two verified forks/archives of the dataset exist and
are reachable via the GitHub API — `Kadantte/tennis_atp` (ATP) and
`Aneeshers/tennis-sackmann-archive` (ATP + WTA, with the CC BY-NC-SA 4.0
LICENSE). `scripts/backtest_historical.mjs` uses them and produces a genuine
walk-forward backtest (see `docs/BACKTEST.md`).

**Still open for the live slate:** the mirrors are snapshots (matches through
2026-05-25, rankings through 2026-06-08) with no current-season live feed, and
the official ATP/WTA ranking pages are client-side rendered, so current form
and rankings for today's matches remain unsourced. That part of `IR-02` stays
open — see `IR-14`.

---

## Verification gaps

### IR-03 — Collection cannot run from the development sandbox · MEDIUM · OPEN
No outbound network in the sandbox, so neither collector could be executed
against live pages. `data/slate.json` was transcribed from a live fetch, and
`scripts/collect_olbg.py` independently re-parses the same page shape and
reproduces the same events, which cross-checks the transcription.

The parser fixture at `tests/fixtures/olbg_tennis_index.RECONSTRUCTED.html` is
**reconstructed, not captured** — the real values are genuine, the surrounding
markup is not. Its tests prove the parser works on that shape, not on OLBG's
current markup. The first CI run with `--save-html` produces a real capture that
should replace it.

### IR-04 — Tournament, tour, round and surface are absent from the OLBG index · MEDIUM · OPEN
The index lists only player names, kickoff and consensus. The tournament stage
(10 pts) and surface form (20 pts) factors depend on data OLBG does not publish
here. The presence of "US Open" and "US Open Women" outright markets on the same
page hints at the event, but that is an inference — so the fields are `null`.

### IR-13 — Two Step 1 requirements are not achievable from free sources · MEDIUM · OPEN
X sentiment requires paid API access or ToS-restricted scraping. Structured
injury reporting has no free source. Both are excluded rather than approximated;
`scripts/collect_players.py` declares them as unverified adapters that
contribute nothing.

### IR-14 — The Sackmann mirrors are stale snapshots, not a live feed · HIGH · OPEN
The verified mirrors (`Kadantte/tennis_atp`, `Aneeshers/tennis-sackmann-archive`)
were last updated in early/mid June 2026: matches stop at **2026-05-25**, rankings
at **2026-06-08**. For a slate on 2026-08-31 that means "last 5 matches in the
last month" and "current ranking" cannot be honestly computed from them — feeding
May data into a "current form" field would misstate recency. The mirrors also
ship an **empty `atp_players.csv`**, and the rankings CSVs key players by ID, so
name→rank mapping needs a players file these mirrors do not provide.

Consequence: the mirrors unblock **backtesting** (and a labelled historical
rankings fallback), but the live slate still needs a current-season source or a
keyed odds/rankings API before its form and ranking factors can be filled.

### IR-15 — Historical feature builder uses a documented ordering approximation · LOW · MITIGATED
Sackmann's `tourney_date` is a tournament start date, so matches inside one
event, and matches in different events in the same week, share a date. The
builder orders strictly by `(tourney_date, match_num)`, so a same-week match in
another event may be treated as prior to a match it was actually simultaneous
with. The effect is a small amount of same-week lookahead, not a forecast leak
across weeks. Documented in `scripts/lib/historical.mjs` rather than hidden.

---

## Data observations

### IR-05 — The tips index only lists matches with tipster coverage · LOW · OPEN
The page is ordered by tip volume and paginates via "Load More Tips". Matches
nobody has tipped appear only on the All Events index. The collector targets
both, so `slate.json` becomes the fuller list on the first CI run.

### IR-06 — Two matches have consensus only on an excluded market · LOW · NOTED
Events 899314 (Grabher v Cirstea) and 899395 (Mensik v Mochizuki) list
Total Games as their consensus market. The prompt excludes total games entirely,
so no consensus signal exists for their scored markets.

### IR-09 — Cached search results disagree with the live page · LOW · NOTED
A search-engine cache of the OLBG tennis page listed "Iga Swiatek v Elena
Rybakina" and "Coco Gauff v Marta Kostyuk" as upcoming, while the live fetch on
2026-08-31 shows Swiatek v Xiyu Wang and Sonmez v Gauff. Only the live fetch was
used. Any future collector must not treat cached copies as authoritative.

### IR-10 — Kickoff times carry no explicit timezone · LOW · MITIGATED
OLBG renders UK local time but does not state it per row. `Today`/`Tomorrow`
labels were resolved against the 00:12 UTC fetch time; the literal "01 Sept"
rows on the same page are consistent with that resolution, which cross-checks
it. Every row carries `date_basis: observed` or `derived` so the distinction is
visible in the data rather than hidden in code.

---

## Conflicts with the brief

### IR-07 — Two Step 4 output rules contradict each other · MEDIUM · RESOLVED IN CODE
"The predicted winner must be bolded and obvious within the first 20 words" and
"no two tips may open with the same word" cannot both hold if the bolded name is
the first word: all three markets for one match would then open identically.

Resolution: the tip leads with a distinctive analytical opener and the bolded
pick lands inside the 20-word window. The validator enforces both at once, and a
test asserts the bold position and the opening-uniqueness together.

### IR-08 — The unique-opening rule is unbounded · MEDIUM · OPEN (documented limit)
Three markets per match means a 20-match card needs 60 tips. There are 24
distinct hand-written openings. Beyond that the rule cannot be honoured without
padding the prose with filler — which the same prompt bans.

`writeCard` reports `openerPoolExhausted` and the UI shows a warning rather than
silently repeating an opening. This is a limit of the requirement, not of the
implementation; the honest fixes are either a larger curated pool or relaxing
the rule to "per market".

### IR-11 — Defects in the prompt's scoring rules · HIGH · RESOLVED IN CODE
Full detail in [`PROMPT_REVIEW.md`](PROMPT_REVIEW.md). Summary:

| Defect | Effect | Patch |
|---|---|---|
| First-set market inherits the win-match base | Its floor sits above its own HIGH threshold, so it can only ever say HIGH | `firstSetIndependentScale` |
| Surface form scored on raw win count | A 2–0 record outscores an 8–3 record | `surfaceWinRateNotCount` |
| Bonuses stack past the 100-point ceiling | Scores can reach 118 | `capScoresAt100` |
| Odds band labelled "value" | Measures implied probability while implying edge; systematically rewards heavy favourites | `labelProbabilityNotValue` |
| Ranking bands omit top-20-vs-top-20 | Undefined pairings fall through | scored 0 and reported as missing |

Each patch is a named flag with a covering test, so literal v1.0 behaviour can be
restored and the difference measured.

### IR-12 — The WTA/ATP handicap equivalence is unsourced · MEDIUM · OPEN (assumption)
The prompt states a WTA −3.5 is roughly equivalent to an ATP −5.5, with no
source. The prompt also asserts that set betting and total games have
"documented negative expected value" with no citation, while excluding those
markets and simultaneously recommending games handicap — the same market family.

The engine applies **no** gender handicap adjustment. Baking an unverified
calibration factor into a betting line is precisely the kind of invention this
project exists to avoid. It needs the backtest corpus to calibrate.

---

### IR-16 — ESPN publishes no serve statistics for tennis · HIGH · OPEN
Every competitor object in the ESPN tennis scoreboard carries `statistics: []`.
First-serve percentage and aces per match are therefore unavailable from the
live source (verified 2026-08-31, ATP and WTA).

The prompt calls serve statistics "the strongest predictor of first set
outcomes", so this is a material gap. The +8 serving-advantage modifier can
never fire. Deriving a proxy from set scores was rejected: it would be a
fabricated statistic wearing the name of a real one.

### IR-17 — "Beat a higher-ranked player this event" is not derivable · LOW · OPEN
The +3 bonus needs each beaten opponent's ranking **at the time of that match**.
ESPN's scoreboard carries no per-match ranking, and applying today's ranking
retroactively would misstate history. Permanently unsourced.

### IR-18 — The missing-factor penalty is shared across all three markets · MEDIUM · OPEN
`applyMissingPenalty` subtracts a fixed amount per *distinct* missing factor
across the whole match, then applies that same total to win-match, first-set and
games-handicap alike. A first-set score is therefore reduced by gaps belonging to
another market — for example an unsourced handicap price.

With odds permanently unavailable (`IR-01`) the shared penalty is large, so
first-set scores sit near zero and that market almost always reports LOW or SKIP.

The behaviour is **conservative** — it understates confidence rather than
overstating it — so it is documented rather than quietly retuned. A proper fix
needs per-market missing sets plus a re-run of the backtest to recalibrate the
thresholds; changing the arithmetic without recalibrating would move selections
on no evidence.

### IR-19 — ESPN's league slug does not indicate the tour · MEDIUM · RESOLVED IN CODE
The **ATP** scoreboard returns **Women's Singles** groupings — observed at the
Nordea Open, competition `178684`, 2026-07-06. Treating the requested league as
the tour would mislabel those matches.

`tourOf()` reads the grouping/competition type text instead, and a regression
test pins this behaviour against the real payload.

### IR-20 — Arena GitHub auth initially blocked workflow-file push · MEDIUM · MITIGATED
On 2026-09-01 an earlier push of `arena/01a0558a-sportspred` containing
`.github/workflows/pages.yml` and `.github/workflows/collect.yml` was rejected
by GitHub with:

> refusing to allow a GitHub App to create or update workflow
> `.github/workflows/collect.yml` without `workflows` permission

That blocker was later cleared enough for the branch to be pushed and PR #7 to
be opened. The workflows are therefore now present on the remote feature branch.
What remains outside the code itself is repository configuration: the public
Pages site is still verified as **legacy** deployment from `main` until the
Pages source is switched to **GitHub Actions**.

---

### Rugby League — specialist engine (v1.0, 2026-09-02)

| ID | Title | Status |
|---|---|---|
| IR-RUGBY-01 | No free key-less consolidated odds feed (OLBG shows handicap/total strings only) | OPEN — ladder-implied decimal, never printed |
| IR-RUGBY-02 | No free key-less last-5 results tape | OPEN — pattern seeded deterministically from rank, marked estimated, capped |
| IR-RUGBY-03 | Cross-reference of ≥2 bookmakers | OPEN — recorded missing, flagged |
| IR-RUGBY-04 | Weather snapshot is clear/dry placeholder | PARTIAL — rain +10 Under wired but not triggered on this window |
| IR-RUGBY-05 | Handicap/total are selection strings not fields | OPEN — regex parse, display-only |
| IR-RUGBY-06 | Super League official standings truncated | OPEN — Wikipedia 2026-08-28 supplies full PF/PA |
| IR-RUGBY-07 | State of Origin outright vs match | ACKNOWLEDGED — excluded from scoring, kept in slate |

Detail lives in [`RUGBY_LEAGUE_IRREGULARITIES.md`](RUGBY_LEAGUE_IRREGULARITIES.md) and the register is mirrored in `data/rugby_league_provenance.json` (verified 2026-09-02, line-by-line with links in `docs/RUGBY_LEAGUE_SOURCES.md`).

---

## Not an irregularity, but worth stating

- **The live slate is still unscored.** With no odds and no *current-season*
  statistics sourced, every match on today's card is unscored, and the site says
  so rather than inventing a prediction. This is intended behaviour, not a bug.
- **The historical backtest now runs on real data.** `scripts/backtest_historical.mjs`
  grades the engine walk-forward over 2024–2025 ATP matches from the verified
  mirror: 5,377 win-match picks, **63.9% hit rate**, with the model's raw score
  monotonically tracking the outcome (58% → 69% → 77% → 96% across score
  buckets). This measures rank/form/surface/serve picking only — no odds are in
  the dataset, so **no profitability or value claim follows**. See
  [`BACKTEST.md`](BACKTEST.md).
