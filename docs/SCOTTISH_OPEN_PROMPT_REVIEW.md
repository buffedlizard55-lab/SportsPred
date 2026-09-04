# SCOTTISH OPEN MASTER PROMPT v1.0 — line-by-line implementation review

Every requirement of [`SCOTTISH_OPEN_MASTER_PROMPT.md`](SCOTTISH_OPEN_MASTER_PROMPT.md)
is listed with the code that enforces it and the test that proves it.
**Status** is one of:

- ✅ implemented from a verified free source;
- 🟡 implemented with a named, measured substitute (written into the component
  detail and into the irregularity register);
- ⛔ cannot be sourced for free — scored zero, listed in `missing[]`, never
  estimated.

Code: [`engine/golf_scottish_open.js`](../engine/golf_scottish_open.js)
(scoring + writing), [`engine/golf_event_profiles.js`](../engine/golf_event_profiles.js)
(dispatch), [`engine/golf_data.js`](../engine/golf_data.js) (`linksProfile`,
`r1Profile`), [`scripts/build_golf_links.mjs`](../scripts/build_golf_links.mjs),
[`scripts/build_scottish_open.mjs`](../scripts/build_scottish_open.mjs),
[`scripts/backtest_scottish_open.mjs`](../scripts/backtest_scottish_open.mjs).
Tests: [`tests/golf_scottish_open.test.mjs`](../tests/golf_scottish_open.test.mjs)
(26 tests).

---

## Which event this applies to

| Rule | Status | Code | Test |
|---|---|---|---|
| Applies to the men's Scottish Open only | ✅ | `matchScottishOpen` — name contains `scottish open`, tour is `pga` or `eur`, `women`/`senior`/`legends`/`amateur` rejected | "the overlay matches the men's Scottish Open and nothing else" |
| Every other event keeps the generic prompt | ✅ | `scoreEvent` in `golf_event_profiles.js`; `scoreGolfEvent` untouched | "scoreEvent routes the Scottish Open to the overlay…" |
| Venue recorded, never used to reject a match (historical rows carry only yardage and par) | ✅ | `atHost` is `true` / `false` / `null` (venue not published) | same test |
| Host venue and tournament identity pinned to the committed data | ✅ | `HOST_COURSE_ID = '10906'`, `HOST_TOURNAMENT_ID = '4161'` — both read from `data/golf_results.json` | — |

## Step 1 — data collection

| Requirement | Source | Status | Where |
|---|---|---|---|
| Odds for five markets from two bookmakers, cross-referenced | none | ⛔ IR-GOLF-17 | `odds` in every market's `missing[]` |
| Last five results, last six weeks double weighted | ESPN results tape | ✅ | `summariseForm` (`golf_data.js`) |
| Strokes gained, all categories, last eight events | PGA TOUR season averages via ESPN | 🟡 IR-GOLF-18 (PGA only) / ⛔ (DPWT) | `sgLookup`, `scoreBallStriking` |
| Course history at this venue | results tape by `tournamentId` | 🟡 tape window; the +5 bonus needs two appearances | `eventHistory`, `scoreLinksProxy` |
| Links / wind-exposed form, especially The Open | cited venue table + the `major` flag | 🟡 IR-GOLF-19 | `linksProfile`, `data/golf_links_courses.json` |
| Driving distance and accuracy (secondary) | ESPN season stats | 🟡 not used in scoring — the prompt ranks them below shot-shaping | — |
| Scrambling / around the green | ESPN season `savePct` | 🟡 field median as the "above-average" cut-off | `buildFieldContext.scrambleMedian`, `scoreCourseFitSo` |
| First-round scoring average | results tape round one | ✅ field-relative rank | `r1Profile`, `scoreFrlSo` |
| Confirmed tee times and the wave split | ESPN leaderboard `teeTime` + field median | ✅ | `waveAssignment` |
| Four-round forecast and AM/PM divergence | Open-Meteo daily + hourly | ✅ | `waveForecast`, `data/golf_weather.json` → `r1.windAmKmh` / `windPmKmh` |
| World ranking and trajectory | OWGR public JSON | ✅ | `scorePedigreeSo` |
| Nationality | ESPN flag + OWGR region | ✅ | `classifyRegion` |
| Race to Dubai standings | none | ⛔ IR-GOLF-22 | `missing[]` on every European candidate |
| Intent (rehearsal vs. tune-up) | none | ⛔ IR-GOLF-22 | `missing[]` on every American candidate |
| Social / analyst sentiment | none | ⛔ by design (never scored, never shown) | — |

## Step 2 — WIN TOURNAMENT (100)

| Rule | Points | Status | Code | Test |
|---|---|---|---|---|
| Gaining strokes in 3+ / 2 / 1 of the four categories | 25 / 16 / 9 | 🟡 IR-GOLF-18 | `scoreBallStriking` | "all-around ball-striking scores on how many of the four categories are positive" |
| Losing strokes in 3+ categories | 0 | 🟡 | `scoreBallStriking` | same |
| Between "one positive" and "three losing" — no tier in the prompt | 0 at the floor, detail says so | ✅ | `scoreBallStriking` | same |
| −6 one-dimensional profile | −6 | 🟡 measured: 1 positive, ≥0.30 lead, ≥2 losing | `so_ball_pen` | "a one-dimensional profile is penalised six points" |
| All four categories must be published | 0 + missing | ✅ | `scoreBallStriking` | "ball-striking is missing, not estimated" |
| Win / top 3 / ≥2 top-10 / 1 top-10 / no top-20 | 20 / 15 / 11 / 6 / 0 | ✅ | `scoreFormSo` | "recent form follows the prompt table 20/15/11/6/0" |
| +4 back-to-back top tens | +4 | ✅ | `so_form_b2b` | same |
| Top 10 / top 20 / made cut / none at The Open or a cited links venue | 20 / 13 / 7 / 0 | 🟡 IR-GOLF-19 | `scoreLinksProxy`, `linksProfile` | "the wind and links proxy scores 20/13/7/0" |
| +5 top five here in a prior edition | +5, needs ≥2 appearances | 🟡 IR-GOLF-19 (windiness unverifiable) | `so_venue` | "…needs two appearances for the venue bonus" |
| Low flight **and** scrambling = 20 | unreachable | ⛔ IR-GOLF-20 | `scoreCourseFitSo` | "course fit is capped at twelve" |
| Strong in one area = 12 | 12 | 🟡 scrambling vs field median | `so_fit` | same |
| Weak in both = 3 | 3 | 🟡 | `so_fit` | same |
| −8 high spin-heavy flight | never applied, listed as unassessed | ⛔ IR-GOLF-20 | `scoreCourseFitSo` | same |
| OWGR top 10 / 20 / 50 / outside | 15 / 11 / 6 / 2 | ✅ | `scorePedigreeSo` | "pedigree scores 15/11/6/2" |
| +5 major win **or runner-up** in two years | +5 | ✅ `majorWinOrRunnerUp2y` measured from the tape | `so_major` | same |
| Value rule: outside the top 15 in the field, links **and** fit both ≥15 | applied literally | 🟡 IR-GOLF-20 — unreachable as written; outside-the-top-fifteen fallback, VALUE PICK label withheld, flag raised | `isValuePickSo`, the outright selection block | "the mandatory value test is applied literally and its unreachability is disclosed" |

Full-evidence maximum = **106** (25 + 20 + 4 + 20 + 5 + 12 + 15 + 5), asserted in
"a full-evidence win score reaches the documented maximum of 106, never more".

## Step 2 — FIRST ROUND LEADER (100)

| Rule | Points | Status | Code | Test |
|---|---|---|---|---|
| Opening-round average, top 10 / 20 / 40 on tour | 30 / 20 / 11 / 0 | 🟡 field-relative rank (IR-GOLF-18) | `so_frl_r1` | via the card test |
| Favourable side of a clearly forecast split | 30 + `waveEdge` | ✅ | `waveForecast`, `so_frl_wave` | "the wave category scores 30/0/15/10" |
| Less favourable side of a clear split | 0 | ✅ | `so_frl_wave` | same |
| Only mild divergence | 15 | ✅ | `so_frl_wave` | same |
| No meaningful divergence | 10 for everyone regardless of tee time | ✅ | `so_frl_wave` | same |
| Tee time or forecast not published | 0 + missing | ✅ | `so_frl_wave` | same |
| SG putting top 10 / 25 / 50, negative = 0 | 20 / 13 / 6 / 0 | 🟡 season stands in for four events | `so_frl_putt` | — |
| Two or more opening rounds in the 60s **in notable wind** | 20 — unreachable | ⛔ IR-GOLF-21 | `so_frl_fast` | "the fast-start profile uses the twelve-point tier" |
| Two or more opening rounds in the 60s, any conditions | 12 | ✅ `in60sLast5` | `so_frl_fast` | "opening rounds in the sixties are counted separately" |
| Documented slow-start / late-charge pattern | 0 | ✅ measured | `so_frl_fast` | same |
| Top selection plus up to two more, minimum 50 | ✅ | `RULES.frl.extraSelections`, `skip: 50` | "the overlay scores exactly five markets" |

Split thresholds (`RULES.wave`: clear at ≥8 km/h or ≥25 pp rain, mild at
≥4 km/h) are the same cut-offs `scripts/collect_golf_weather.mjs` already uses
to label the round-one trend, so one forecast cannot produce two stories.

## Step 2 — regional markets

| Rule | Points | Status | Code |
|---|---|---|---|
| Top ranked American in the field | +10 | ✅ | `so_us_top` |
| PGA TOUR win in three months | +8 | ✅ from the tape | `so_us_win` |
| Travelled specifically as links preparation | +6 | ⛔ IR-GOLF-22, never assumed | `missing[]` |
| No prior links or severe-wind coastal start | −10 | 🟡 IR-GOLF-19 | `so_us_nolinks` |
| Top ranked European in the field | +10 | ✅ | `so_eu_top` |
| DP World Tour win or top three in six weeks | +8 | ✅ | `so_eu_dpwt` |
| Race to Dubai contention | +6 | ⛔ IR-GOLF-22 | `missing[]` |
| Missed cut in the last two consecutive starts | −10 | ✅ | `so_eu_mc` |
| Home national open status | +14 | ✅ confirmed national open (see the dossier) | `so_bi_home` |
| Top ranked GB and Ireland player | +10 | ✅ | `so_bi_top` |
| DP World Tour win or top five in four months | +8 | ✅ `tourTop5In` | `so_bi_dpwt` |
| Made the cut here before, or a strong links-major finish | +6 | ✅ either branch measured | `so_bi_cut` |
| No competitive start in three weeks | −8 | ✅ | `so_bi_rust` |
| Missed cuts in the last two starts | −10 | ✅ | `so_bi_mc` |
| Within five points → both flagged as co-selections at MEDIUM | ✅ | `bandRegionalSo({coSelected:true})` | "Step 3 thresholds are the prompt's" |

## Step 3 — bet decision rules

| Rule | Status | Code | Test |
|---|---|---|---|
| Win: ≥75 HIGH, 60–74 MEDIUM, <60 LOW and never skipped | ✅ | `bandWin` | "Step 3 thresholds are the prompt's" |
| FRL: <50 SKIP; ≥65 MEDIUM at most; ≥75 **and** confirmed wave edge HIGH | ✅ | `bandFrlSo` | same |
| Regional: ≥70 HIGH, 55–69 MEDIUM, <55 or within five points LOW | ✅ | `bandRegionalSo` | same |
| HIGH unreachable while a core factor is missing | ✅ | `coreMissing` on every band | same |
| Always one value selection outside the top five favourites | 🟡 IR-GOLF-20 fallback, flagged | the outright selection block | "the overlay scores exactly five markets" |
| No maximum course-history score on fewer than two appearances | ✅ | `RULES.minVenueAppearancesForVenueBonus` | "…needs two appearances for the venue bonus" |
| No FRL HIGH on scoring average alone without a wave edge | ✅ | `bandFrlSo(score, waveEdge, …)` | "Step 3 thresholds are the prompt's" |
| Regional markets scored independently; a shared headliner is flagged | ✅ | the `heads` map and its flag | "the overlay scores exactly five markets" |

## Step 4 — output

| Rule | Status | Code | Test |
|---|---|---|---|
| Five blocks, in the prompt's order | ✅ | `BLOCKS`, `writeScottishOpenCard` | "the card writes five blocks in the prompt order" |
| Block 1: top selection then the value selection | ✅ | block 1 | same |
| Block 2: top selection plus up to two | ✅ | `1 + RULES.frl.extraSelections` | "the card validator rejects…an over-long market" |
| Blocks 3-5: single tip or co-selection | ✅ | regional block | "the card writes five blocks" |
| Minimum forty words per tip | ✅ | `composeTipSo` pads; `validateGolfTip` enforces | same |
| Name bolded inside the first fifteen words | ✅ | `OPENERS`; validator counts words before `**` | "every overlay opener bolds the name inside fifteen words" |
| No odds, sponsor, tournament, course, source names | ✅ | `forbiddenNames` + `FORBIDDEN_TOKENS` | "the card writes five blocks" |
| No figures of any kind | ✅ | `validateGolfTip` numeral check | same |
| Weather and wind may be referenced | ✅ | the openers and the wave note use them freely | same |
| Confidence on every tip | ✅ | `confidenceSentence`; validator | same |
| VALUE PICK flag on the value tip | ✅ | `valuePick` prefix in `buildScottishOpenCardText` | same |
| Below threshold → SKIP plus one sentence | ✅ | `skipTipSo` | — |
| Unique opening word and phrase per tip | ✅ | `validateScottishOpenCard` | "the card validator rejects…" |
| Banned phrases (all eight, verbatim) | ✅ | `BANNED_PHRASES` | same test iterates all eight |
| Summary table, value summary, wave note, RG reminder | ✅ | `buildScottishOpenCardText` | "the card writes five blocks" |
| Wave and weather impact note **always** included | ✅ | `waveWeatherNoteSo`; validator fails the card without it | "the card validator rejects…a missing wave note" |
| Internal data never displayed | ✅ | only qualitative clauses leave `factClausesSo` / `cautionClausesSo` | — |

## Profitability and adjustment lines

| Line | Handling |
|---|---|
| "Wind is the deciding one" | Verified: eight editions range from −22 to −7 (`data/golf_scottish_open.json` → `venue_history`). Implemented as a thirty-point wave category and a mandatory wave note, not as rhetoric. |
| "Course history here is a thin sample" | The overlay has **no** venue-history category at all. Venue knowledge enters only as the +5 prior-top-five bonus, which requires two appearances. The wind and links proxy carries the weight instead. |
| "Does not reward one-dimensional power" | Implemented twice: the four-category breadth test (25) and the −6 one-dimensional penalty. |
| "Always confirm the wave split before finalising first round leader" | `bandFrlSo` cannot return HIGH without `waveEdge`, and a missing forecast marks the category missing on every player. |
| "Favour players who compete seriously in tune-up weeks" | ⛔ IR-GOLF-22. Intent is not published, so it is recorded as unassessed rather than inferred from a schedule. |
| "This event opens the closing stretch of the points race" | Verified against the DP World Tour Closing Swing page. The +6 European incentive still cannot be scored without a standings feed (IR-GOLF-22), and the dossier records the verification instead. |
| "Home nation motivation runs deeper" | +14 on the GB and Ireland market, the largest single regional bonus in the overlay. |

## Backtest

`node scripts/backtest_scottish_open.mjs` re-scores every edition in the
committed tape walk-forward and grades it against the published leaderboard.
Current output (`data/golf_scottish_open_backtest.json`): three editions,
fifteen ledger rows. Tee times and the round-one forecast are not published
historically, so the wave category is missing for every past edition and no
first-round-leader tip can read HIGH — the backtest is honest about that rather
than reconstructing a forecast.

Three editions is a small sample. It is reported as a sample and never as a
strike rate to trust; the aggregate table names the denominators.
