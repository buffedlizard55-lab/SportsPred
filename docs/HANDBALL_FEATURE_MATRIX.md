# Handball Feature & Prompt Implementation Matrix

This matrix maps every rule in `HANDBALL PREDICTION MASTER PROMPT v1.0` to its implementation in code, status, and test coverage.

| Prompt Rule | Code Implementation | Status | Test Coverage |
|---|---|---|---|
| Recent Form: 5/5 = 30, 4/5 = 22, 3/5 = 13, <=2 = 0 | `engine/handball_engine.js:scoreRecentForm` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Form streak bonus: +5pts for 4+ win streak | `engine/handball_engine.js:scoreRecentForm` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Opponent streak bonus: +5pts for opp 4+ loss streak | `engine/handball_engine.js:scoreRecentForm` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Odds Band: <=-300 (25), -200..-299 (18), -150..-199 (12), -100..-149 (6) | `engine/handball_engine.js:scoreOddsAndValue` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Positive/near-even odds with strong form = 10pts | `engine/handball_engine.js:scoreOddsAndValue` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Deduction -8pts if odds < -300 but form < 15 | `engine/handball_engine.js:scoreOddsAndValue` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| H2H Last 3 Years: >=70% (20), 55-69% (13), 45-54% (5), <45% (0) | `engine/handball_engine.js:scoreH2H` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Weight last 3 meetings double in H2H | `engine/handball_engine.js:scoreH2H` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Standings: Top 3 (15), 4th-6th (10), 7th-10th (5), Outside top half (0) | `engine/handball_engine.js:scoreStandings` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Deduct 5pts if opponent ranked higher in division | `engine/handball_engine.js:scoreStandings` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Stage: Final/Semi (10), Knockout (8), High-stakes (7), Mid-table (4) | `engine/handball_engine.js:scoreStageAndHome` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Home advantage bonus: +3pts for >=60% home win rate | `engine/handball_engine.js:scoreStageAndHome` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Handicap ATS trend: >=7 (10), 6 (6), <=5 (0) | `engine/handball_engine.js:scoreHandicapSpread` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Handicap injury modifiers: +8 / +5 / +3 / -8 | `engine/handball_engine.js:scoreHandicapSpread` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Fixture congestion modifier: +6 / -6 for 48h turnaround | `engine/handball_engine.js:scoreHandicapSpread` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Goal diff modifier: avg margin > spread (+5) | `engine/handball_engine.js:scoreHandicapSpread` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Game total attacking pace: 30+ both (35 Over), one 30+ (22 Over), <25 (15 Under) | `engine/handball_engine.js:scoreGameTotal` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Game total defensive score: 28+ both (25 Over), <25 both (20 Under) | `engine/handball_engine.js:scoreGameTotal` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Game total injury impact: Attack absence (+15 Under), Full attack (+10 Over) | `engine/handball_engine.js:scoreGameTotal` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Game total recent trends: Over 3+/5 (+20 Over), Under 3+/5 (+20 Under) | `engine/handball_engine.js:scoreGameTotal` | ✅ Implemented | `tests/handball_engine.test.mjs` |
| Market Order: WIN MATCH, POINT SPREAD, GAME TOTAL | `engine/handball_writer.js:writeHandballCard` | ✅ Implemented | `tests/handball_writer.test.mjs` |
| Min 40 words per tip | `engine/handball_writer.js:validateHandballTip` | ✅ Implemented | `tests/handball_writer.test.mjs` |
| Bolded outcome in first 20 words | `engine/handball_writer.js:validateHandballTip` | ✅ Implemented | `tests/handball_writer.test.mjs` |
| Zero digits / numerals in output | `engine/handball_writer.js:validateHandballTip` | ✅ Implemented | `tests/handball_writer.test.mjs` |
| Unique opening word per tip (no repetitions) | `engine/handball_writer.js:HANDBALL_OPENERS` | ✅ Implemented (75 openers) | `tests/handball_writer.test.mjs` |
| Banned phrases rejected mechanically | `engine/handball_writer.js:BANNED_PHRASES` | ✅ Implemented | `tests/handball_writer.test.mjs` |
| Summary Table and RG Reminder | `engine/handball_writer.js:buildHandballFormattedCardText` | ✅ Implemented | `tests/handball_writer.test.mjs` |
| Draw outcome flag for tight league fixtures | `engine/handball_engine.js:scoreHandballMatch` | ✅ Implemented | `tests/handball_engine.test.mjs` |
