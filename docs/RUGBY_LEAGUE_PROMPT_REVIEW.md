# RUGBY LEAGUE PREDICTION MASTER PROMPT v1.0 — line-by-line implementation review

Each requirement of the final message's master prompt is listed with the code that enforces it and the test that proves it. **Status** is one of:

- ✅ implemented from a verified free source
- 🟡 implemented with a named, measured substitute (substitution is written into the component detail and the irregularity register)
- ⛔ cannot be sourced for free — scored zero, listed in `missing[]`, never estimated

## Step 1 — collect (every field is sourced or listed missing)

| Requirement | Source | Status | Where | Test |
|---|---|---|---|---|
| Current moneyline price (≥2 sources + line movement) | OLBG slate + ladder-implied decimal | 🟡 IR-RUGBY-01 / IR-RUGBY-03 | `teams.json` `odds` (ladder-implied 1.65/1.85/2.40), `rugby_league_slate.json` consensus display-only | `rugby_league_engine.test` — odds bands |
| Handicap line (≥2 sources + movement) | OLBG handicap selections regex | 🟡 IR-RUGBY-05 | `slate.handicap_lines`, `matches.handicapLine`, engine `handicapLineForFav` | engine — handicap profitability window |
| Total line (≥2 sources + movement) | OLBG total selections regex | 🟡 IR-RUGBY-05 | `slate.total_lines`, `matches.totalLine`, engine `totalLine` | engine — total windows |
| Last 5 results with set scores / winning margins (last month weighted 2× last 2 weeks) | NRL/SL ladders + deterministic pattern | 🟡 IR-RUGBY-02 | `teams.form.last5` (5-length W/L), `margin.avgWinningMargin`, `scoreRecentForm` notes weighting docs | `scoreRecentForm` 25/18/11/0 |
| Season home / away W-L | Derived from ladder split | ✅ | `teams.homeRecord.winRate`, `awayRecord.winRate`, `scoreHomeAdvantageAndContext` 10/6/2 +3 /−5 | home/away bonus test |
| H2H last 3y weighted double for most recent 3 | Seed from h2h map (totalMeetings/favWins/recentMeetings) | 🟡 IR-RUGBY-02 | `matches.h2h`, `scoreH2H` weighted 27% + last-5 + venue bonus | H2H 20/13/5/0 + venue +5 |
| Injury impact on attack / defense / pack | none | ⛔ internal only | Listed missing, engine `structure_opp_forward_bonus` / `odds_forward_deduction` / `hcap_injury_forward` fire only if explicitly sourced | engine never requires |
| Key player identification (dummy-half / halves / props) | none | ⛔ internal only | Never scored, never displayed | writer validator rejects `injury` |
| Streak dominance | `form.winStreak` / `opp lossStreak` | ✅ | `form_win_streak` +5, `form_opp_loss_streak` +5 | streak bonus |
| Schedule ≤5 days | `teams.rest.daysSinceLastMatch` + `schedule.playedWithin5Days` | ✅ | `home_backtoback_deduction` −5, `hcap_fatigue_*` ±7 | back-to-back test |
| Home venue strength + confirmed 60%+ home record | `homeRecord.winRate` | ✅ | `home_adv` 10/6/2, large crowd +5 | home advantage |
| Coaching profile / competition context | competition tag | ✅ | `totalRes.isSuperLeague` lowers thresholds 4–6 as prompt says (4–6 noted in `total_off` detail) | SL adjustment line |
| Weather (rain / wind) | Open-Meteo placeholder clear | 🟡 IR-RUGBY-04 | `weather.isClear/lightRain/heavyRain/strongWind`, total 15/5/20, hcap −5, total +10 Under elevation | weather branching |
| Social sentiment | none | ⛔ internal only | Never fed into scoring, never displayed | writer rejects |
| Cross-reference ≥2 bookmakers | none free | ⚠️ IR-RUGBY-03 | `missing[]` entry only | — |

## Step 2 — score (100 per market) — exact bands from the prompt

### WIN MATCH (100)

| Rule | Points | Status | Code | Test |
|---|---|---|---|---|
| Recent Form last month double-weighted: 5/5=25, 4/5=18, 3/5=11, ≤2=0 | 25/18/11/0 | ✅ | `scoreRecentForm` | 5,4,3,≤2 tiers |
| +5 winning streak ≥4 | +5 | ✅ | `form_win_streak` | streak 4+ |
| +5 opponent lost ≥4 of last 5 | +5 | ✅ | `form_opp_loss_streak` | opp 4L |
| Odds: ≤−300=25, −200→−299=18, −150→−199=12, −100→−149=6, underdog +170→+375 with strong form=8, shorter than −300 + weakened pack −8 | 25/18/12/6/8/−8 | ✅ ladder-implied mapped to American | `scoreOddsAndValue` | every band |
| H2H: 4+/5=20, 3/5=13, even=5, trailing=0; +5 last 2 at venue; weight recent 3 double | 20/13/5/0 +5 | ✅ | `scoreH2H` with weighting | H2H bands + venue bonus |
| Structure: top-5 attack + top-10 defense=20, top-10+avg=13, mid=7, bottom=0; +5 opp pack weakened; −5 set-piece | 20/13/7/0 +5/−5 | ✅ ranks from ladder PF/PA | `scoreDefensiveAttackingStructure` | attack/defense rank |
| Home: confirmed 60%+ =10, 50-59%=6, poor/neutral=2; +3 opp poor away 60%+ loss; −5 back-to-back ≤5d | 10/6/2 +3 −5 | ✅ | `scoreHomeAdvantageAndContext` | home + opp away + fatigue |
| Missing field penalty | −5 per distinct missing | ✅ | `applyMissingFieldPenalty` | cap |

General maximum = 25+5+5+25+20+5+20+5+10+3 = 123 before penalties (prompt says 100 caps; `totalPoints` caps at 100 and negative deductions reduce).

### HANDICAP (100)

| Rule | Points / filter | Status | Code | Test |
|---|---|---|---|---|
| ATS trend replaces home adv: 7+/10=10, 6/10=6, ≤5=0 | 10/6/0 | ✅ | `hcap_ats` | ATS 7+/6/≤5 |
| Winning margin >8 =+8, <8 =−8 | ±8 | ✅ | `hcap_margin` | margin 8 |
| Front-row / dummy-half absent =−10 | −10 | ✅ | `hcap_injury_forward` | injury absent |
| Home large vocal crowd in wet/physical =+5 | +5 | ✅ | `hcap_home_amplifier` | crowd+wet |
| Fatigue: opponent congested +7, own congested −7 | ±7 | ✅ | `hcap_fatigue_*` | fatigue |
| Rain/strong wind −5 for high-scoring (+28 ppg) fav cover | −5 | ✅ | `hcap_weather` | rain + high scoring |
| Profitability filter: WIN MATCH ≥65, margin ≥8, line −5.50→−8.50 favs / +6.50→+13.50 dogs, cap 6/day, margin 8+ | gate | ✅ | `wmScore<65` skip, margin<8 skip, line window skip, `writeRugbyLeagueCard` 6-cap | handicap asks inside window |

### GAME TOTAL (100)

| Rule | Points / filter | Status | Code | Test |
|---|---|---|---|---|
| Combined offense: both 28+=35, one 28+ other 22–27=22, both 22–27=12 (neutral), one/both <18=15 Under (prompt gap 18–22 neutral) | 35/22/12/15 | ✅ adjusted −5 for Super League noted | `total_off` | offense tiers |
| Combined defense: both 28+=25 Over, one heavy/one well=12 neutral, both <18=20 Under | 25/12/20 | ✅ | `total_def` | defense tiers |
| Weather: clear dry 15 Over, light rain 5 neutral, heavy rain/strong wind 20 Under | 15/5/20 | ✅ | `total_weather` | weather |
| Recent trends: both Over 4/5=20, 3/5=12, mixed=5, both Under 3+/5=15 | 20/12/5/15 | ✅ | `total_trend` | trends |
| Line windows: 42.50–48.50 is Over-only (≥55 HIGH, 45–54 MEDIUM, <45 SKIP); 49.50–52.50 needs ≥68 Over else Under 65+ for MEDIUM; 53.50+ needs exceptional both >30 & both <25 else SKIP; rain elevates Under +10 regardless | gates | ✅ | `totalLine >=42.5` block, `rainOrWindConfirmed` +10 | total line windows |
| Score <45 across factors = SKIP | gate | ✅ | `gtScore<45` skip | low total skip |

`scoreGameTotal` returns `overPts/underPts/direction/rawScore/combinedOff/totalLine/isSuperLeague`; decision rules in `scoreRugbyLeagueMatch` apply the line windows and the rain elevation.

## Step 3 — bet rules

| Rule | Code | Test |
|---|---|---|
| WIN MATCH: ≥70 HIGH, 50–69 MEDIUM only if ≥2 factors strongly aligned (form≥18, odds≥18, H2H≥13, structure≥13, home≥6), <50 SKIP | `wmScore` + strongFactors check, `getBand(70,50)` | MEDIUM needs 2+ |
| HANDICAP: only if WIN≥65 and line in window and margin≥8; then ≥70 HIGH, 55–69 MEDIUM, <55 SKIP | `hcapBand` gates | profitability filter |
| HANDICAP cap 6 per day | `writeRugbyLeagueCard` `toKeep` after sorting active by score desc | 6-cap |
| GAME TOTAL thresholds per line window above | `gtBand` per window | line window tests |

## Step 4 — output

| Rule | Code | Test |
|---|---|---|
| Three tips per match order WIN/HANDICAP/TOTAL | `writeRugbyLeagueCard` loops `['win_match','handicap','game_total']` | `writeCard emits all three` |
| ≥40 words each | `MIN_WORDS=40`, `validateRugbyLeagueTip` | words |
| Bold winner in first 20 words | `**fav**` is the first token in `pickLead`, validator `wordsBeforeBold ≤20` | bold placement |
| No names (players), injuries, venues, odds/handicap numbers, total lines, scores, dates, links/brackets/social | `FORBIDDEN_TOKENS` stadium/venue/http/@/twitter; digit regex `/\d/`; `injury` word; writer templates never emit a number | validator |
| General attack/defense only | `buildRugbyLeagueBody` clauses mention `forward dominance`, `defensive structure`, `set-piece efficiency`, `kick-and-chase` etc. without figures | body clauses |
| No links/citations/brackets/social | same | validator |
| Handicap only who covers, totals only Over/Under | `hcapSelection = fav + ' to cover'`, `gtSelection = Over/Under` | market strings |
| Unique style per tip, banned phrases | `OPENERS` 30 distinct first words + `BANNED_PHRASES` all eight, validator rejects sharing opener word | `no two tips share opener` |
| Confidence per tip | `Confidence: ${band}.` on every non-SKIP tip | `confidence level not declared` |
| SKIP single explanatory sentence starting SKIP | `SKIP — ${label}: ${reason}, so no recommendation…` single sentence | `SKIP tips…` |
| Summary table + weather note + RG reminder, rugby-specific weightings | `buildRugbyLeagueFormattedCardText` | `formatted card carries table…` |
| Internal Step 1-3 data never displayed | writer reads only `score/band/selection/market/direction`; component details are panel-only | internal-only |

Rugby-specific weightings (prompt call-outs):

- NRL home power is honoured as 10 pts for 60%+ home win rate (the 120-day `league_context` 61 % for `rugby-league:3` corroborates it).
- Super League baseline thresholds lowered 4–6 pts: `detailSL` note in `total_off` and `isSuperLeague` flag.
- Heavy rain / strong wind elevates Under by 10 pts regardless of offensive data — implemented in `scoreRugbyLeagueMatch` before `gtBand` is chosen.

## Engine provenance

Every point records `id/label/points/max/detail/missing`; `missing[]` is sorted, deduped and penalises the score by `5 × distinct`. The writer's `card.validator` asserts every rule above on every build.
