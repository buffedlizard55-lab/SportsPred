# CRICKET PREDICTION MASTER PROMPT v1.0 — line-by-line review

This maps every instruction in the master prompt to a repository feature, its
status, and its data source. "Engine" = `engine/cricket_engine.js`,
"Writer" = `engine/cricket_writer.js`, "Collector" =
`assets/js/cricket-collector.js`.

## STEP 1 — Data collection

| Prompt line | Feature | Status | Source |
|---|---|---|---|
| Match-winner / top-batsman / MoM odds from 2+ sources, line movement | Odds ingestion (`normaliseOdds`, all odds components) | ⚠️ Rules built; no key-less source | CR-IR-01 |
| Each team's last 5 results, scores & margins (last 2 weeks double) | Team form tape + `scoreWinRecentForm` | ✅ Team W/L from scorepanel; weights recent | `espn-scorepanel` |
| Win/loss by tournament, venue, conditions | Series/league grouping; venue on card | ✅ Venue; venue-condition splits partial | `espn-scorepanel` |
| H2H over 3 years, last 3 weighted double | `h2h()` tape + `scoreWinH2H` | ✅ Within tape window; 3-yr span needs longer tape | `espn-scorepanel` |
| Venue-specific spin/pace/scoring tendencies | Pitch/venue factor | ⚠️ Venue captured; structured pitch report missing | CR-IR-02 |
| Pitch report (dry/turning, green/seaming, flat) | `match.pitch.favours` | ⚠️ Field exists; not sourced | CR-IR-02 |
| Weather / rain (DLS, powerplay aggression) | Weather factor | ❌ No free structured source | CR-IR-02 |
| Format context (T20/ODI/Test) with separate thresholds | `classifyFormat`, format-aware rules | ✅ | `espn-scorepanel` (`class.eventType`) |
| MoM candidates' last-5 runs, SR, wickets, economy, all-round | `scoreMomCandidate` | ⚠️ Single-match stats sourced; last-5 aggregate missing | CR-IR-03 |
| Top batsmen: average, SR, position, 50s/100s, vs opposition | `scoreBatsmanCandidate` | ⚠️ Position & this-match SR sourced; aggregates partial | CR-IR-03 |
| Batting order confirmation — only confirmed starters | Summary roster `starter`, batting position | ✅ Confirmed XI only | `espn-summary` |
| All-rounder identification | `role === 'allrounder'`, dual styles | ✅ | `espn-summary` |
| Spinner vs pacer matchup vs opposition weakness | `scoreBowlingMatchup` | ✅ Style from roster; weakness flag (needs scouting) | `espn-summary` |
| Home advantage | Neutral/home flags, venue | ✅ homeAway/neutralSite | `espn-scorepanel` |
| Injury / squad availability | Confirmed roster starters | ⚠️ Starting XI yes; injury status no | CR-IR-04 |
| Social/analyst sentiment (internal only) | — | ❌ No free source; never referenced | CR-IR-04 |
| Cross-reference odds across ≥2 bookmakers | — | ❌ Blocked on odds feed | CR-IR-01 |

## STEP 2 — Scoring (all four markets implemented & tested)

| Market / component | Function | Points |
|---|---|---|
| Win: recent form + streak/opp-loss bonuses | `scoreWinRecentForm` | 25 +5 +4 |
| Win: H2H (last 3 double) + venue-sweep bonus | `scoreWinH2H` | 20 +5 |
| Win: bowling vs batting matchup + pitch bonus | `scoreBowlingMatchup` | 20 +4 |
| Win: batting depth + opp-weak-bowl bonus | `scoreBattingDepth` | 20 +4 |
| Win: odds value + underdog flag + favourite-trap deduction | `scoreWinOdds` | 15, −7 |
| MoM: recent form + all-rounder bonus | `playerRecentForm` | 35 +5 |
| MoM: matchup (spin/pace/batting) | `playerMatchup` | 25 |
| MoM: batting position + tail deduction | `playerBattingPosition` | 20, −10 |
| MoM: odds value zones | `playerOdds` | 20 |
| Top batsman: form + last-match 50 + vs-opposition | `scoreBatsmanCandidate` | 35 +6 +5 |
| Top batsman: position/opportunity + early-wicket deduction | same | 25, −8 |
| Top batsman: strike-rate suitability | same | 20 |
| Top batsman: odds value zones | same | 20 |
| All-rounder auto +5 elevation | `scoreMomCandidate` | +5 |
| Bottom-4 ineligibility unless frontline opening bowler | eligibility checks | enforced |

## STEP 3 — Bet decision rules

| Rule | Implementation |
|---|---|
| Win ≥70 HIGH, 55–69 aligned MEDIUM, <55 SKIP | `bandFor` + thresholds |
| MoM ≥75 **and** +400…+900 zone = HIGH; 65–74 MEDIUM; <65 SKIP | in `scoreCricketMatch` |
| All-rounder +5 elevation | `mom_allround_elev` |
| Top batsman ≥70 HIGH / 55–69 MEDIUM / <55 SKIP | `bandFor` |
| High-odds MoM (+700…+1600) only with pitch dominance or all-round form | `valueFlag` |
| Avoid openers unless exceptional; never pick #6+ for top batsman | eligibility + position scoring |
| Max 3 player markets per match (correlation) | correlation cap in `scoreCricketMatch` |
| T20 powerplay-bowling pitch → top-batsman confidence −1 tier | format modifier |

## STEP 4 — Output format

| Rule | Enforcement |
|---|---|
| Four tips per match in exact order | `writeCricketCard` market order |
| ≥40 words per tip | `validateCricketTip` (tested) |
| Pick bolded within first 20 words | validator word-position check |
| Win tips name team only; player tips name player only | `bolded` selection per market |
| No odds/dates/venues/tournament/sources/digits in prose | digit + banned-token + bracket checks |
| No speculation on active/injured players | confirmed roster only |
| Unique style/opening per tip | 48 unique opener angles, uniqueness tested |
| Confidence LOW/MEDIUM/HIGH on every tip | regex-checked |
| Below-threshold markets written as one-sentence SKIP | `expectSkip` path |
| Summary table, value-flag note, RG reminder | `buildCricketFormattedCardText` |
| Banned filler phrases | `BANNED_PHRASES` list enforced |

## Honesty note

Where a factor cannot be sourced, the engine scores it `missing`, applies a
per-factor penalty, and SKIPs the market rather than emitting a confident guess.
This means many player markets read **SKIP** until an odds feed and a player
form tape are connected — that is the model refusing to hallucinate, not a bug.
