# Golf Master Prompt v1.0 — line-by-line implementation review

Each requirement of `GOLF_MASTER_PROMPT.md` is listed with the code that
enforces it and the test that proves it. **Status** is one of:

- ✅ implemented from a verified free source;
- 🟡 implemented with a named, measured substitute (the substitution is
  written into the component detail and the irregularity register);
- ⛔ cannot be sourced for free — scored zero, listed in `missing[]`, never
  estimated.

## Step 1 — data collection

| Requirement | Source | Status | Where |
|---|---|---|---|
| Odds (outright, top 5/6/10, FRL, regional) | none | ⛔ IR-GOLF-01 | `scoreGolfEvent` pushes `odds` into every market's `missing[]` |
| Last five results, six-week double weight | ESPN results tape | ✅ | `summariseForm` (`golf_data.js`); `golf_data.test.mjs` |
| SG OTT/APP/ARG/PUTT/T2G/total, last eight events | PGA TOUR season averages | 🟡 IR-GOLF-02 (PGA) / ⛔ (DPWT) | `sgLookup`, `scoreStrokesGained` |
| Driving distance and accuracy | ESPN season stats (PGA) | 🟡 IR-GOLF-09 | `statsLookup`, `course.shortHitter/longHitter` |
| Course history, last four appearances | ESPN results tape by `tournamentId` | 🟡 IR-GOLF-04 | `eventHistory` |
| Similar course types | yardage class | 🟡 IR-GOLF-03 | `courseClass`, `courseClassRecord`, `bestCourseClass` |
| Twelve-month top-ten rate | results tape | ✅ | `summariseForm.top10Rate12m` (null under five starts) |
| Win in last six months | results tape | ✅ | `summariseForm.winIn6m` |
| Round-one scoring average | results tape R1 column | ✅ | `r1Profile` |
| Tee times + R1 weather | ESPN leaderboard + Open-Meteo hourly | ✅ / 🟡 IR-GOLF-06 | `field[].teeTime`, `collect_golf_weather.mjs r1Trend` |
| Four-round weather | Open-Meteo daily | ✅ | `buildWeatherNote` |
| Major record | ESPN `tournament.major` on tape rows | ✅ | `majorsWonLast2y` |
| Nationality | ESPN flag + OWGR region | ✅ | `classifyRegion` |
| OWGR + trajectory | OWGR public JSON | ✅ | `parseOwgr`, `owgr.trajectory` |
| Sentiment | none | ⛔ by design (never scored, never shown) | — |

## Step 2 — outright base (100)

| Rule | Points | Status | Code | Test |
|---|---|---|---|---|
| Win in 6 weeks / top-3 in 6 weeks / ≥2 top-10 in 5 / 1 top-10 / none | 25/19/14/8/0 | ✅ | `scoreForm` | "outright form tiers" |
| +5 back-to-back top-10 | 5 | ✅ | `form_b2b` | same |
| +5 top-10 in comparable field | 5 | 🟡 purse ≥ 80 % or major/signature | `form_field` | same |
| SG APP top 5/15/30 in field | 25/17/10/0 | 🟡 IR-GOLF-02 | `scoreStrokesGained` | "strokes gained approach" |
| +5 top-20 T2G | 5 | 🟡 | `sg_t2g` | same |
| +3 positive putting last three | 3 | 🟡 season sign | `sg_putt_pos` | same |
| Course history top-5 / top-10 / made cut / MC | 20/13/6/0 | ✅ within tape | `scoreCourseHistory` | "course history 20/13/6/0" |
| +5 course type matches best surface | 5 | 🟡 yardage class | `course_type` | — |
| Course fit strong/moderate/weak | 20/12/3 | 🟡 yardage class record | `scoreCourseFit` | same test |
| −8 course punishes weakness | −8 | 🟡 long course + bottom-quartile distance | `course_fit_pen` | same |
| OWGR top 10/20/50/else | 10/7/4/1 | ✅ | `scoreRanking` | "ranking 10/7/4/1" |
| +5 major/elevated win 12 m | 5 | ✅ (`major` or `isSignature`) | `owgr_elev` | same |
| +3 multiple career wins | 3 | 🟡 wins within the tape window | `owgr_wins` | same |
| Value rule: field rank 15–40, fit ≥ 18, form ≥ 14 → VALUE PICK; never only top-3 favourites | — | 🟡 IR-GOLF-10 | `isValuePick`, outright selection block | "outright always names a value pick" |

Full-evidence maximum = 131 (100 base + 31 bonuses), asserted in "a
full-evidence profile totals exactly the prompt maxima".

## Step 2 — top 6

| Rule | Status | Code |
|---|---|---|
| 12-month top-10 rate > 35 % +15 / 25–34 % +8 / < 20 % −5 | ✅ (null under five starts → missing) | `t6_rate` |
| Top-15 in two of last three here +10 | ✅ | `t6_event` |
| MC most recent here −12 | ✅ | `t6_mc` |
| T2G positive four of last five +10 | 🟡 season sign | `t6_t2g` |
| Back-to-back events no MC +5 | ✅ | `t6_b2b` |
| OWGR top 15 +8 / top 30 +4 / outside 50 −3 | ✅ | `t6_owgr` |
| Top six by score, minimum 55 | ✅ | `RULES.top6` |
| Never six top-six favourites; ≥ 1 ranked 15th+ | 🟡 field rank | top-six guard; test "top-six guard" |

## Step 2 — first round leader

| Rule | Status | Code |
|---|---|---|
| R1 scoring rank top 10/20/40 → 35/24/14/0 | ✅ (last eight starts, ≥ 4 rounds) | `frl_r1` |
| Early + deteriorating 25 / early stable 12 / late improving 8 / late worsening 0 | ✅ tee from ESPN; trend from Open-Meteo | `frl_tee` |
| SG putting top 10/25/50 → 20/13/6, negative 0 | 🟡 IR-GOLF-02 | `frl_putt` |
| ≥ 2 of last 5 opening rounds ≤ 67 → 20; layout favours early scoring → 15; slow starter 0 | ✅ / 🟡 prior-edition mean R1 ≤ −1.0 | `frl_fast` |
| Top five, listed from 50, written from 55; HIGH needs ≥ 75 + tee/weather edge | ✅ | `RULES.frl`, `bandFrl` |

## Step 2 — regional markets

| Rule | Status | Code |
|---|---|---|
| Top-3 European in field +10 | ✅ (OWGR within eligible players) | `eu_top3` |
| DPWT win/top-3 in 6 weeks +8 | ✅ | `eu_dpwt` |
| Superior links record +5 | ⛔ IR-GOLF-03 | listed missing |
| MC last two consecutive −10 | ✅ | `eu_mc` |
| Top-3 American +10 / PGA win 3 m +8 / power course +6 / multiple majors 2 y +5 / SG APP negative −10 | ✅ / ✅ / 🟡 / ✅ / 🟡 | `us_*` |
| Links or coastal event +12 | ⛔ | listed missing |
| Top-2 British/Irish +10 / DPWT win 4 m +8 / cut in each of last 3 here +6 / no start in 3 weeks −8 / MC last two −10 | ✅ | `bi_*` |
| Single selection; two within five points → co-selection at MEDIUM | ✅ | `regional()` in `scoreGolfEvent`; test "regional markets pick one" |

## Step 3 — bands

All thresholds are constants in `RULES` and asserted in "Step 3 bands"; HIGH
is unreachable whenever a core category is missing (`coreMissing`). Outright
is never SKIP; a market with **no** sourced evidence for any player is written
as NO SELECTION rather than naming an arbitrary player (`hasEvidence`, test
"refuses to pick without evidence").

## Step 4 — output

| Rule | Code | Test |
|---|---|---|
| Block order B1 (outright + five top-six) → B2 (FRL top + four) → B3/B4/B5 | `writeGolfCard` | "follows the Step 4 block order" |
| Summary table, value summary, weather note, RG reminder | `buildGolfCardText`, `buildWeatherNote` | "card text carries the table…" |
| ≥ 40 words; name bolded within 15 words; confidence stated | `validateGolfTip` | "validator rejects every style violation" |
| Unique opening per tip | `GOLF_OPENERS` (28 distinct first words) + `validateGolfCard` | "every opener…", "openers are unique" |
| Banned phrases | `BANNED_PHRASES` (all eight) | "rule set matches the prompt" |
| No figures, odds, source / tournament / course / tour names | digit + token + `forbiddenNames` checks | same; DOM smoke test checks the live card |
| SKIP = "NO SELECTION" + one sentence | `skipTip`, `validateGolfTip({expectSkip})` | "SKIP tips must be…" |
| Internal data never displayed | writer reads only component ids/points and renders qualitative clauses (`factClauses`) | "fact clauses never expose figures" |
| Same player in several markets → separate write-ups, flagged | `scoreGolfEvent` heads check | "flags shared headliners" |

## Golf-specific adjustments

| Adjustment | Handling |
|---|---|
| SG approach most predictive | 25 of 100 base points as the prompt allocates; when unsourced the whole market is capped at MEDIUM |
| Course fit can override ranking | course history (20) + fit (20) outweigh ranking (10) by construction; a 60th-ranked player with two top-fives here scores 40 in those two categories against a top-ten player's 10 with no history |
| Wind > 20 mph favours low-flight profiles | reported in the weather note (`buildWeatherNote`, 20 mph = 32.2 km/h); not scored because ball-flight data is not published |
| FRL = early tee + deteriorating weather + hot putter + fast start | `scoreFrl` categories exactly |
| Regional markets independent of overall OWGR | eligibility by nationality; ranking bonus is rank **within the region's players in the field** |
| Cut-making outranks raw scoring for top six | top-six modifiers reward cuts made, penalise a missed cut here, and use the top-ten rate rather than scoring average |
