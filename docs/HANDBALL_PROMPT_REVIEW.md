# Handball Prediction Master Prompt Review (v1.0)

This document provides a line-by-line analytical review of the **HANDBALL PREDICTION MASTER PROMPT v1.0** and how each component is implemented in `engine/handball_engine.js` and `engine/handball_writer.js`.

---

## Step 1 — Data Collection

| Prompt Requirement | Implementation & Data Source | Verification Ref |
|---|---|---|
| **Odds, Handicap, Total from $\ge$ 2 sources** | Gathered and cross-referenced from verified public market slates and OLBG directories. | `data/handball_slate.json`, `data/handball_teams.json` |
| **Last 5 matches from past month (double weight recent 2 weeks)** | Form tapes stored as 5-game arrays; winning/losing streaks recorded. | `scoreRecentForm()` |
| **Home and Away split records** | Extracted from official league standings (`played`, `wins`, `draws`, `losses`, `winRate`). | `scoreStageAndHome()`, `homeRecord` |
| **Head-to-head last 3 years (weight last 3 meetings double)** | Historical H2H record with last 3 meetings double-weighted. | `scoreH2H()` |
| **Injury and availability report** | Absence modifiers for attack and defense scored separately (+8/+5/+3/-8). | `scoreHandicapSpread()`, `scoreGameTotal()` |
| **League standings, points tally, and goal difference** | Sourced from official league tables (HBL, Tophaandbold, LNH, NHF). | `scoreStandings()` |
| **Competition context** | Coded by stage: Final/Semi (10pts), Knockout (8pts), High-Stakes League (7pts), Mid-table (4pts), Dead rubber (0pts). | `scoreStageAndHome()` |
| **Fixture congestion (48-hour turnarounds)** | Modifiers applied: +6pts if opponent played within 48h, -6pts if own team played. | `scoreHandicapSpread()` |

---

## Step 2 — Market Scoring

### 1. WIN MATCH MARKET (100pts total)
- **Recent Form (30pts):** 5 wins = 30pts; 4 wins = 22pts; 3 wins = 13pts; $\le$2 wins = 0pts. Streak bonus +5pts for 4+ win streak; +5pts for opponent 4+ losing streak.
- **Odds and Value Assessment (25pts):** $\le$-300 = 25pts; -200 to -299 = 18pts; -150 to -199 = 12pts; -100 to -149 = 6pts; Near-even/plus with strong form ($\ge$22 form) = 10pts; Deduct 8pts if shorter than -300 but form $<15$.
- **Head-to-Head Last 3 Years (20pts):** $\ge$70% win rate = 20pts; 55–69% = 13pts; 45–54% (even) = 5pts; $<45\%$ = 0pts. Last 3 meetings weighted double.
- **Standings and Season Quality (15pts):** Top 3 = 15pts; 4th–6th = 10pts; 7th–10th = 5pts; Outside top half = 0pts. Deduct 5pts if opponent ranked higher in division.
- **Competition Stage & Home Advantage (10pts):** Final/Semi = 10pts; QF/Knockout = 8pts; High-stakes = 7pts; Mid-table = 4pts; Dead rubber = 0pts. +3pts for home advantage with $\ge$60% home win rate.

### 2. HANDICAP SPREAD MARKET (100pts total)
- Base score from win market factors.
- ATS trend replaces stage: $\ge$7/10 covers = 10pts; 6/10 = 6pts; $\le$5/10 = 0pts.
- Injury modifiers: Opponent attacking absence = +8pts; Opponent defensive absence = +5pts; Own fully fit = +3pts; Own key absence = -8pts.
- Fixture congestion: Opponent played $<48$h = +6pts; Own team played $<48$h = -6pts.
- Goal difference modifier: Team avg winning margin exceeds spread = +5pts.

### 3. GAME TOTAL MARKET (100pts total)
- **Attacking Pace (35pts):** Both avg 30+ = 35pts (Over); One 30+, other 25-29 = 22pts (Over); Both 25-29 = 12pts (neutral); One/both $<25$ = 15pts (Under).
- **Defensive Structure (25pts):** Both concede 28+ = 25pts (Over); One $\ge$28, one $<28$ = 12pts (neutral); Both concede $<25$ = 20pts (Under).
- **Injury Impact (20pts):** Key attacking absence = +15pts (Under); Full attack strength = +10pts (Over); Defensive injuries creating gaps = +8pts (Over).
- **Recent Total Trends (20pts):** Both Over in 3+/5 = 20pts (Over); Both Under in 3+/5 = 20pts (Under); Mixed = 5pts.

---

## Step 3 — Bet Decision Rules

- **Thresholds:** $\ge$70 = HIGH confidence; 50–69 = MEDIUM confidence; $<50$ = SKIP / LOW confidence.
- **Profitability Rules:**
  - Odds shorter than -300 require score $\ge$75; otherwise downgraded or flagged.
  - Handicap spread requires margin support.
  - Game total anomaly check: flags if total deviates $>7.0$ goals from seasonal combined scoring averages.
- **Draw Flag:** League fixtures with near-even form and H2H flag draw possibility without forcing a winner.

---

## Step 4 — Output Constraints

- Exact market order: WIN MATCH, POINT SPREAD, GAME TOTAL.
- Minimum 40 words per non-skip tip.
- Bolded outcome in first 20 words.
- Zero numerals or digits in tips (blocks leaks of odds, lines, and scores).
- No player names, stadium names, injury names, URLs, bracket references.
- 75+ unique opening words ensuring no two tips share an opening word.
- Banned phrases rejected mechanically by `validateHandballTip`.
- Formatted summary table + Responsible Gambling reminder.
