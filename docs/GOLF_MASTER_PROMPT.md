# GOLF TOURNAMENT PREDICTION MASTER PROMPT v1.0

This is the specification of record for the golf layer. The engine
(`engine/golf_engine.js`), the writer (`engine/golf_writer.js`) and the tests
(`tests/golf_*.test.mjs`) implement it rule by rule; `GOLF_PROMPT_REVIEW.md`
maps every line below to the code that enforces it and names the lines that
cannot be honoured with free data (each of which is then recorded in
`GOLF_IRREGULARITIES.md` and in the `missing[]` array on every scored market).

---

## STEP 1 — DATA COLLECTION (internal only, never displayed)

For every player in the field collect:

- Outright odds, top 5/6/10 odds, first-round-leader odds, top European /
  top American / top British & Irish odds from at least two bookmakers.
- Last five tournament results, with results inside the last six weeks
  weighted double.
- Strokes gained: off the tee, approach, around the green, putting,
  tee-to-green and total over the last eight events.
- Driving distance and driving accuracy.
- Course history: the last four appearances at this event.
- Record on similar course types (links / parkland / coastal / desert;
  bentgrass / bermuda greens).
- Twelve-month top-ten rate.
- Whether the player has won in the last six months.
- Round-one scoring average.
- Round-one tee times and the round-one weather forecast.
- Four-round weather forecast: wind, rain, temperature.
- Major-championship record.
- Nationality.
- Official World Golf Ranking and its trajectory.
- Social / analyst sentiment (internal context only; never scored, never shown).

## STEP 2 — SCORING

### OUTRIGHT WINNER (base score out of 100)

**Form (25 points)**
- Win inside the last six weeks: 25
- Top-three finish inside the last six weeks: 19
- Two or more top-ten finishes in the last five starts: 14
- One top-ten finish in the last five starts: 8
- No top-twenty finish in the last five starts: 0
- Bonus +5: back-to-back top-ten finishes
- Bonus +5: top ten in a comparable or stronger field

**Strokes gained (25 points)**
- SG approach over the last eight events ranks top 5 in the field: 25;
  top 15: 17; top 30: 10; otherwise 0
- Bonus +5: top 20 in the field tee-to-green
- Bonus +3: SG putting positive in each of the last three events

**Course history (20 points)**
- Top-five finish at this event in the last three appearances: 20
- Top-ten finish in the last three appearances: 13
- Made the cut without a top-twenty finish: 6
- Missed the cut: 0
- Bonus +5: course type matches the player's best surface record

**Course fit (20 points)**
- Strong fit: 20; moderate fit: 12; weak fit: 3
- Penalty −8: the course punishes the player's primary weakness

**Ranking and pedigree (10 points)**
- OWGR top 10: 10; top 20: 7; top 50: 4; otherwise 1
- Bonus +5: a major or elevated-event win inside twelve months
- Bonus +3: multiple career wins

**Value rule.** Never select only the top-three favourites. At least one
player ranked fifteenth to fortieth in the field with a course-fit score of
eighteen or more and a form score of fourteen or more must be flagged as a
VALUE PICK.

### TOP 6 FINISH

Start from the outright base score and apply:
- Twelve-month top-ten rate above 35%: +15; 25–34%: +8; below 20%: −5
- Top-fifteen finish in two of the last three appearances at this event: +10
- Missed the cut in the most recent appearance at this event: −12
- Tee-to-green positive in four of the last five events: +10
- Back-to-back events without a missed cut: +5
- OWGR top 15: +8; top 30: +4; outside 50: −3

Select the top six by score; minimum score 55.

### FIRST ROUND LEADER (out of 100)

- Round-one scoring average ranks top 10 in the field: 35; top 20: 24;
  top 40: 14; otherwise 0
- Tee time and weather: early tee with deteriorating conditions: 25; early tee
  with stable conditions: 12; late tee with improving conditions: 8; late tee
  with worsening conditions: 0
- SG putting over the last four events ranks top 10 in the field: 20; top 25:
  13; top 50: 6; negative: 0
- Fast-start profile: two or more of the last five opening rounds at 67 or
  better: 20; the layout favours early scoring and a high birdie rate: 15;
  slow starter: 0

Select the top five; minimum score 50.

### TOP EUROPEAN

Outright base score plus:
- Top-three European in the field by OWGR: +10
- DP World Tour win or top-three inside six weeks: +8
- Superior links record: +5
- Missed the cut in the last two consecutive starts: −10

### TOP AMERICAN

Outright base score plus:
- Top-three American in the field by OWGR: +10
- PGA TOUR win inside three months: +8
- Power course (distance, wide fairways, bermuda greens): +6
- Multiple majors in the last two years: +5
- SG approach negative in three or more of the last five events: −10

### TOP BRITISH & IRISH

Outright base score plus:
- Links or coastal event: +12
- Top-two British or Irish player in the field: +10
- DP World Tour win inside four months: +8
- Made the cut in each of the last three appearances at this event: +6
- Has not competed in the last three weeks: −8
- Missed the cut in the last two starts: −10

**Regional rule.** Each regional market is a single selection. When two
players finish within five points of each other, both are selected at MEDIUM
confidence.

## STEP 3 — BET DECISION RULES

- **Outright:** 75 or more = HIGH; 60–74 = MEDIUM; below 60 = LOW (value
  play). Outright is never skipped.
- **Top 6:** 65 or more = HIGH; 55–64 = MEDIUM; below 55 = SKIP.
- **First round leader:** 65 or more = MEDIUM at most; 75 or more with a
  tee-time/weather edge = HIGH; below 55 = SKIP.
- **Regional markets:** 70 or more = HIGH; 55–69 = MEDIUM; below 55, or within
  five points of a rival, = LOW.
- Always include at least one value outright outside the top-five favourites.
- Never let all six top-six selections be top-six favourites: at least one
  must be ranked fifteenth or worse in the field.
- Regional markets are written up separately even when the same player heads
  more than one market, and the repetition is flagged.

## STEP 4 — WRITTEN OUTPUT (the only thing displayed)

Order:
1. **Block 1 — Outright winner:** the top pick, then five further top-six tips.
2. **Block 2 — First round leader:** the top pick, then four more.
3. **Block 3 — Top European.**
4. **Block 4 — Top American.**
5. **Block 5 — Top British & Irish.**

End with a summary table (market, selection, confidence), a value-picks
summary, a weather note, and a responsible-gambling reminder.

### Style rules

- Every tip is at least forty words.
- The player's name is bolded within the first fifteen words.
- Every tip has a unique style and opening; no two tips share an opening
  word, phrase or structure.
- Confidence is stated on every tip as LOW, MEDIUM or HIGH.
- Selections below a market's threshold are written as SKIP: "NO SELECTION"
  followed by one sentence.
- Banned phrases: "hard to look past", "the class of the field", "in fine
  form", "a natural fit", "on current form", "one to watch", "looks the
  part", "could go well here".
- General descriptive references to strokes gained, form and course history
  are allowed; figures, injury specifics, odds and the names of tournaments,
  courses, tours or data sources are not.
- Internal data — Step 1–3 scores, factor breakdowns, odds, statistics,
  strokes-gained numbers, staking advice, sentiment and reasoning — never
  appears in the displayed output. Only the written tip, the bolded player
  name, the confidence, VALUE PICK flags, the summary table, the value
  summary, the weather note and the responsible-gambling reminder do.

## GOLF-SPECIFIC ADJUSTMENTS

- Strokes gained approach is the most predictive category.
- Course fit can override ranking: a sixtieth-ranked player with two top-five
  finishes at the course beats a top-ten player with no history there.
- Wind above twenty miles per hour favours low-flight, links and
  course-management profiles.
- First round leader is driven by early tee times ahead of deteriorating
  weather, a hot putter and fast starts.
- Regional markets are scored independently of overall OWGR position.
- Cut-making consistency outranks raw scoring for the top-six market.
