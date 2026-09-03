# T20 Blast feature matrix

What is built, where it lives, and how it is verified. ✅ implemented and tested ·
⚠️ implemented but the input has no free source, so the market is withheld ·
❌ not built, with the reason.

## Data layer

| Feature | Status | Where |
| --- | --- | --- |
| Verified results tape, 96 fixtures | ✅ | `data/t20_blast_matches.json`, built by `scripts/build_t20_blast.mjs` |
| Points table, all three groups | ✅ | `data/t20_blast_standings.json`; CHECK 6 verifies `4W + 2T + 2NR − deduction` for all eighteen counties |
| Net run rate recomputed and matched | ✅ | CHECK 7, from published runs-for and runs-against |
| Sussex two-point deduction | ✅ | Confirmed by arithmetic; read as adjusted performance; never mentioned in a tip (TB-IR-06) |
| Knockout event ids and scorecard slugs | ✅ | All seven; CHECK 9 requires an id and a slug on every knockout row |
| Season leaders and knockout performances | ✅ | `data/t20_blast_leaders.json` |
| Source register and known cross-pool ids | ✅ | `data/t20_blast_provenance.json` |
| Forward ledger | ✅ | `data/t20_blast_predictions.json` |
| All 115 fixtures | ⚠️ | 96 captured; two Derbyshire home fixtures and seventeen cross-pool results are not itemised by the source the tape was read from (TB-IR-01) |
| Per-match player tape | ❌ | No free source publishes it for a completed season (TB-IR-04) |
| Odds | ❌ | No free key-less feed (TB-IR-02) |
| Pitch and weather per fixture | ❌ | No free structured feed tied to an event id (TB-IR-03) |

## Context and scoring

| Feature | Status | Where |
| --- | --- | --- |
| Walk-forward context, strict `date <` | ✅ | `engine/t20_blast_data.js`; look-ahead audit in the backtest |
| Form, head-to-head, table, rest, margins | ✅ | `formFor`, `h2h`, `tableAt`, `restFor`, `marginProfile` |
| League home-win rate **measured**, not assumed | ✅ | `homeWinRate`; excludes neutral venues |
| Table counts league stage only | ✅ | `tableAt` with `LEAGUE_STAGES`; knockouts excluded |
| Six-factor evidence model, weights declared | ✅ | `EVIDENCE_WEIGHTS`, summing to 100, never fitted |
| Logistic probability, clamped | ✅ | `evidenceProbability`, slope 12, clamped 0.05–0.95 |
| Strict-prompt rubric reported alongside | ✅ | `strict_prompt` on every WIN market; 100% SKIP, published as a finding |
| Caps: no price, cross-pool, rain/DLS, key absence | ✅ | `scoreBlastMatch` |
| Three-player-market correlation cap | ✅ | weakest withheld, `CORRELATION` flag |
| Oriented head-to-head | ✅ | `orientH2H` in `engine/cricket_engine.js` (TB-IR-09) |
| Player markets from a confirmed XI | ✅ | Delegates to `cricket_engine`; exercised in tests with a synthetic live fixture |
| Bowling matchup scouting | ⚠️ | Rule written; needs a pitch report (TB-IR-03) |
| Batting depth from individual form | ⚠️ | Rule written; needs a live line-up (TB-IR-04) |

## Output

| Feature | Status | Where |
| --- | --- | --- |
| Four markets per fixture, mandated order | ✅ | `MARKET_ORDER` |
| Forty-word floor; SKIP is one sentence | ✅ | `validateBlastTip` |
| Bold selection inside the first twenty words | ✅ | `BOLD_WORD_LIMIT` |
| WIN names a county, player markets name a player | ✅ | `playerNames` and `COUNTY_TOKENS` checks |
| No digits in prose | ✅ | `digitScope`, with the mandated label and a sourced name explicitly exempt |
| No prices, dates, citations, social references | ✅ | `FORBIDDEN_SUBSTRINGS`, `FORBIDDEN_WORDS` |
| No availability or finance speculation | ✅ | same lists |
| Seven banned filler phrases | ✅ | `BANNED_PHRASES` |
| Unique openers | ✅ | Hard per fixture, soft across the page, `openerPoolExhausted` reported |
| Distinct SKIP reason per market and per situation | ✅ | `SKIP_REASON` plus engine `skip_kind`: `unsourced` vs `below_threshold` |
| Summary table, value flag, weather note, gambling reminder | ✅ | `buildBlastFormattedCardText` |
| Validation disclosure with observed rates | ✅ | `buildValidationDisclosure`; digits confined to this block |
| Unwritable market withheld, not thrown | ✅ | `skip_kind: 'withheld_rule_conflict'` recorded in `card.withheld` |

## Validation and publication

| Feature | Status | Where |
| --- | --- | --- |
| Walk-forward replay of a full season | ✅ | `scripts/backtest_t20_blast.mjs`, 46 scored fixtures |
| Look-ahead audit | ✅ | Asserted per fixture; identity-safe against null event ids |
| Hit rate by band, stage, group, result type, pick side | ✅ | backtest report |
| Brier, log loss, calibration buckets | ✅ | backtest report |
| Wilson 95% intervals on every rate | ✅ | `wilson()`; small samples cannot be over-read |
| Baselines: always-home, prior points leader | ✅ | the model must beat them to claim an edge |
| Publication gate, four declared rules | ✅ | `buildPublicationGate`; all four trigger on 2026 |
| Gate caps published confidence, keeps `modelBand` | ✅ | `applyPublicationGate`, pure |
| Observed rate belongs to the model's tier | ✅ | prevents capping from laundering a weak claim |
| Backtest integrity checks in CI | ✅ | `--check` on every push |

## Site

| Feature | Status | Where |
| --- | --- | --- |
| Dedicated page with scoreboard | ✅ | `t20-blast.html` + `assets/js/t20-blast-page.js` |
| Month calendar with per-day fixture counts | ✅ | navigable, disabled days have no fixtures |
| Date strip, day navigation, today button | ✅ | |
| Stage, status and search filters | ✅ | group / cross-pool / knockout; results / upcoming / tipped |
| Generate on load **and** on click | ✅ | the cricket console's render-only handler was the bug behind the dead Generate button (TB-IR-12 note in the irregularity register) |
| Opens on the nearest date with fixtures | ✅ | a completed season has no fixtures "today" |
| Copy a single tip, all tips, or the whole card | ✅ | card text is plain, bolding stripped |
| Per-fixture Analysis panel | ✅ | every factor and its points, caps, flags, what could not be sourced, actual result, and scorecard links |
| Standings with the deduction marked | ✅ | all three groups, qualification noted |
| Gate panel above the fold | ✅ | hit rate, baseline, both tiers, cap, overconfidence |
| Backtest, coverage, leaders, irregularities, sources rails | ✅ | |
| Registry entry and navigation | ✅ | `engine/registry.js` cricket `subPages` and `candidateLeagues`; league tabs on the page |
| Live in-season refresh in the browser | ❌ | The historical tape is complete and verified; for a live season `scripts/collect_t20_blast.mjs` rewrites the tape in CI rather than the browser guessing from a partial feed |

## Tests

| Suite | Coverage |
| --- | --- |
| `tests/t20_blast.test.mjs` | 74 tests: walk-forward guarantees, points arithmetic and the deduction, bands and caps, the gate, every writer output rule with positive and negative cases, card generation including a twelve-fixture slate, the collector's pure core, and the committed artefacts |
| `tests/cricket_engine.test.mjs` | 31 tests, including the `orientH2H` regression |
| `scripts/verify_site.mjs` | Every `$('#id')` in the module graph resolves, ids unique, local links exist, external links https with `rel="noopener"`, fetched JSON present, all modules syntax-checked |
| `scripts/build_t20_blast.mjs --check` | Nine tape checks |
| `scripts/backtest_t20_blast.mjs --check` | Look-ahead audit, metric reconciliation, gate consistency |

Run everything with `npm run verify:all`.
