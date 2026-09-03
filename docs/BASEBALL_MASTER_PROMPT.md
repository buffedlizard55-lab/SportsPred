# BASEBALL PREDICTION MASTER PROMPT v1.0 — spec of record

This file preserves the prompt verbatim as the specification the baseball layer
implements. It is the baseball analogue of `GOLF_MASTER_PROMPT.md` and
`DARTS_MASTER_PROMPT.md`. The line-by-line mapping to code and tests lives in
[`BASEBALL_PROMPT_REVIEW.md`](BASEBALL_PROMPT_REVIEW.md); every data source is
verified in [`BASEBALL_SOURCES.md`](BASEBALL_SOURCES.md); every finding that did
not check out is in [`BASEBALL_IRREGULARITIES.md`](BASEBALL_IRREGULARITIES.md).

---

BASEBALL PREDICTION MASTER PROMPT v1.0

STEP 1 — DATA COLLECTION (Internal only, never display)

For every match on the card, search and gather the following before scoring:

- Current moneyline odds, run line (+1.5/-1.5), and game total from at least two sources, cross-referenced for any line movement
- Each team's last 5 game results from the last month including run scores, with games in the last two weeks weighted double
- Win-loss record for the current season overall and broken down by recent stretch
- Run differential — average runs scored minus runs allowed per game over the last month
- Head-to-head record over the last 3 years with specific run totals from the most recent 3 meetings weighted most heavily
- Starting pitcher confirmed for tonight — ERA, WHIP, strikeouts per 9, and recent start results over last 4 starts — this is the single most critical data point in baseball prediction
- Bullpen ERA and usage over last 3 days — a fatigued bullpen fundamentally changes run total and run line scoring
- Opposing batting average against starting pitcher type — left-handed vs right-handed splits matter significantly
- Team batting average, on-base percentage, and slugging over last 10 games — note upward or downward trend
- Team runs scored per game average over last month and last 10 games separately
- Team runs allowed per game average over last month — defensive efficiency trend
- Injury and roster availability report — assess impact on lineup depth and starting rotation only — never speculate on current team status for any player
- Ballpark run environment — some parks suppress runs, others inflate — use internally for total scoring only, never reference park name in output
- Weather conditions confirmed for game time — wind direction and speed, temperature — affect run totals significantly at outdoor venues
- Recent form streak — note winning or losing streaks of 4 or more games
- Underdog value flag — teams with odds between +100 and +200 with positive run differential and strong recent form represent primary value targets
- Social media and analyst sentiment from baseball-specific sources — use internally only, never reference in output
- Cross-reference all odds and lines across a minimum of two bookmakers before scoring

STEP 2 — SCORE EACH MATCH ACROSS THREE MARKETS (Internal only, never display)

WIN MATCH OUTRIGHT (100pts total):

- Recent Form — last month double weighted (25pts): won 4+ of last 5 = 25; won 3/5 = 16; won 2/5 = 7; won 1 or fewer = 0. Bonus +5 for winning streak of 4+; bonus +4 if opponent lost 4+ of last 5.
- Starting Pitcher Quality (25pts): confirmed starter ERA < 3.00 with 2+ quality starts in last 4 = 25; ERA 3.00–3.99 with 1+ quality start in last 3 = 17; ERA 4.00–4.99 or inconsistent = 9; ERA > 5.00 or unconfirmed = 0. Bonus +5 if opposing lineup below .235 vs this handedness in last 30 days; deduct 8 on short rest or 100+ pitches in each of last 2 starts.
- Run Differential Value (20pts): > +2.5 = 20; +1.5 to +2.4 = 13; 0 to +1.4 = 7; negative = 0. Bonus +4 if opponent negative over same period.
- Odds and Value Assessment (20pts): −200 or lower = 20; −150 to −199 = 14; −100 to −149 = 9; underdog positive odds AND run differential advantage AND superior recent form = 14 (primary value play flag). Deduct 8 if shorter than −250 but starter unconfirmed or bullpen heavily fatigued.
- Head-to-Head Record (10pts): won 6+ of last 10 = 10; won 5/10 = 6; trailing = 2. Bonus +3 if won last 3 consecutive meetings.

RUN LINE +1.5 / −1.5 (100pts total):

- Use win match base score then apply modifiers. Only activate when win match score is 60 or higher.
- Replace head-to-head with run margin analysis: avg margin ≥ 3 = 20; 2–2.9 = 12; < 2 = 0.
- Starter dominance: ERA < 3.00 with 6+ innings per start = +10 for the −1.5 side.
- Bullpen quality: top-10 bullpen ERA = +8 for −1.5; bottom-10 = +8 for +1.5 underdog.
- Run differential above +2.0 per game = +8.
- Fatigue: opponent bullpen heavily used in last 2 days = +7 for the run line favourite.
- Underdog run line value rule: +1.5 underdog with strong starter and run differential above 0 = value, score the +1.5 side separately.
- Never recommend −1.5 when the average winning margin in the last 5 wins is below 2 runs.

GAME TOTAL OVER/UNDER (100pts total):

- Combined offensive output (35pts): both 5+ = 35 Over; one 5+ other 4–4.9 = 22 Over; both 4–4.9 = 12 neutral; one or both below 3.5 = 20 Under.
- Starting pitcher run suppression (25pts): both < 3.50 = 25 Under; one < 3.50 one > 4.50 = 10 neutral lean Over; both > 4.50 = 25 Over; unconfirmed or bullpen game = +12 Over.
- Bullpen and late-inning run environment (20pts): both bottom-10 = 20 Over; one elite one poor = 10 neutral; both top-10 = 18 Under.
- Recent total trends (15pts): both Over 4/5 = 15 Over; both Over 3/5 = 9 Over; mixed = 4 neutral; both Under 3+ of 5 = 14 Under.
- Weather and park (5pts): wind out = 5 Over; wind in = 5 Under; dome or neutral = 0.
- Decision rule: state Over or Under clearly; only recommend when one direction leads by 15+ points.

STEP 3 — BET DECISION RULES (Internal only, never display)

- Win match: ≥ 70 HIGH; 55–69 with 2+ factors strongly aligned MEDIUM; < 55 SKIP. Never recommend a heavy favourite at −300 or shorter unless the starter score is maximum 25 and run differential is above +2.5.
- Run line: only when win match score ≥ 60; run line ≥ 70 HIGH; 55–69 MEDIUM; < 55 or win score < 60 SKIP. A +1.5 underdog may be recommended independently if its starter score is 17+ and the bullpen supports it.
- Game total: directional advantage ≥ 20 HIGH; 15–19 MEDIUM; < 15 SKIP. Bullpen game with no confirmed starter = automatic Over lean, elevate Over by 12 before deciding.
- Underdog value rule (all markets): teams with positive odds +100 to +200 with run differential advantage, strong recent form and a quality starter are the primary value play; always flag and score these separately.

STEP 4 — OUTPUT FORMAT (Display only, never include internal data)

Three predictions per match in this order: WIN MATCH OUTRIGHT, RUN LINE, GAME TOTAL.

- Minimum 40 words per tip.
- The predicted winner or market outcome bolded and inside the first 20 words.
- No statistics, run differentials, ERA figures, batting averages, odds figures, run line numbers, or game total lines anywhere in the output.
- No player names; no home or away references; no league name references, source citations, or social media mentions.
- Run line tips state only which team covers; game total tips state only Over or Under.
- Every tip in a completely unique style; no two tips open with the same word or phrase; banned fillers: "this should be a low-scoring affair", "hard to look past", "the pitching matchup favours", "on current form", "could go either way", "both lineups", "a tight contest".
- Confidence stated as LOW, MEDIUM or HIGH on every tip; below-threshold markets are written as SKIP with a single explanatory sentence.
- End each card with a summary table, an underdog value flag note if any, and a responsible gambling reminder.

---

The repository implements Step 2 and Step 3 in
[`engine/baseball_engine.js`](../engine/baseball_engine.js), Step 4 in
[`engine/baseball_writer.js`](../engine/baseball_writer.js), and the data join in
[`engine/baseball_data.js`](../engine/baseball_data.js).
