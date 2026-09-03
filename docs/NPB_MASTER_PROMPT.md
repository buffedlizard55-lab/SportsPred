# NPB BASEBALL PREDICTION MASTER PROMPT v1.0 — spec of record

This file is the specification the NPB layer (Baseball → NPB sub-page)
implements. The line-by-line mapping to code and tests lives in
[`NPB_PROMPT_REVIEW.md`](NPB_PROMPT_REVIEW.md); every data source is verified
in [`NPB_SOURCES.md`](NPB_SOURCES.md); every finding that did not check out is
in [`NPB_IRREGULARITIES.md`](NPB_IRREGULARITIES.md).

> **Fidelity note (flagged for review).** The MLB analogue
> (`BASEBALL_MASTER_PROMPT.md`) preserves its prompt verbatim. For NPB this
> file is a *structured restatement* of the prompt as supplied — every point
> value, threshold, gate, banned phrase and output rule is reproduced exactly,
> but sentence-level wording is not guaranteed verbatim. If the exact prose
> matters for audit, paste the original over the sections below; nothing in
> the code depends on this file's wording.

---

## STEP 1 — DATA COLLECTION (internal only, never displayed)

For every match on the card, gather before scoring:

- Three-way moneyline (home / draw / away), run line (+1.5 / −1.5) and game
  total from at least two sources, cross-referenced for line movement.
- Each team's last 5 results with run scores, last month weighted; games in
  the last two weeks weighted double.
- Season W-L-**T** record — draws are a real, structural result in NPB
  (regular-season games end level after 12 innings) — plus each team's draw
  count and draw rate, and the league norm.
- Run differential over the last month.
- Head-to-head: same-league meetings weighted; interleague meetings noted but
  not scored in the head-to-head block.
- Starting pitcher: announced starter (予告先発), last 4 starts — innings,
  runs allowed, quality starts — assessed on **form**, not season ERA.
- Bullpen effectiveness and usage over the last three days.
- Opposing lineup performance against the starter's handedness (last 30 days).
- Runs scored per game over the last month.
- League and DH status: Central League plays **without** the DH through 2026
  (universal DH from 2027); Pacific League uses the DH; interleague follows the
  home club's league.
- Foreign-player registration: at most four registered imports on the active
  roster, no more than three pitchers or three position players.
- Venue enclosure: enclosed (dome) and retractable-roof venues are common; a
  weather check applies only to open-air parks.
- Weather at game time for open-air parks, with the rainy season (June to
  mid-July) and typhoon season (August to mid-October) treated as elevated
  game-condition risk. Confirm the scoring environment via search.
- Pennant context and any recent form streak of four or more.

## STEP 2 — SCORING

### 2a. WIN MATCH — HOME OR AWAY (100 pts, scored for each side)

| Block | Pts | Rule |
|---|---|---|
| Recent Form | 25 | Won 4+ of last 5 = 25 · 3 = 16 · 2 = 7 · ≤1 = 0. +5 for a 4+ game winning streak. +4 if the opponent lost 4+ of their last 5. Last month counted, last two weeks weighted double. |
| Starting Pitcher Quality | 25 | Form-based, no ERA: strong recent form (2+ quality starts in last 4) = 25 · solid (1 QS in last 3) = 17 · inconsistent = 9 · poor (5+ runs / <4 IP average) = 0 · unconfirmed = 0. +5 if the opposing lineup has struggled against this handedness. −8 for unusually short rest versus the staff's normal pattern. |
| Run Differential Value | 20 | ≥ +1.5 per game = 20 · +0.5 to +1.49 = 12 · −0.49 to +0.49 = 5 · below −0.5 = 0. +4 if the opponent carries a negative differential. |
| Odds and Value Assessment | 20 | Favourite ≤ −200 = 20 · −150 to −199 = 14 · −100 to −149 = 9 · plus-price underdog = 14 **only** with a run-differential advantage **and** superior form (underdog value flag). −8 if shorter than −250 with an unconfirmed starter or a fatigued bullpen. |
| Head-to-Head (same league) | 10 | Won 6+ of last 10 same-league meetings = 10 · 5 = 6 · trailing = 2. Interleague / Japan Series meetings are a supplementary note only. |

### 2b. DRAW LIKELIHOOD ASSESSMENT (100 pts, run independently on every match)

| Block | Pts |
|---|---|
| Both confirmed starters in strong recent form | 30 |
| Both bullpens effective and unfatigued over the last three days | 25 |
| Run-differential gap between the sides under 1.0 per game | 20 |
| Either team's draw rate above the league norm | 15 |
| Same-league matchup with recent close, low-scoring meetings | 10 |

The draw becomes the **primary pick** when the draw score is **65 or higher
AND** the home and away win scores sit **within 10 points** of each other. It
is a genuine selection on its own merits — never a hedge.

### 2c. RUN LINE +1.5 / −1.5 (100 pts)

Only assessed when the favourite's win score is **≥ 60 AND** the draw score is
**< 55**. Base = the win-match blocks with Head-to-Head (10) replaced by
**run-margin analysis (20)**: average margin in recent wins ≥ 3 = 20 ·
2–2.9 = 12 · < 2 = 0. Modifiers: +10 starter in strong form averaging 6+
innings · +8 effective bullpen (−1.5 side) / +8 to the +1.5 side when the
opponent's bullpen is fatigued or shallow · +8 run differential above +2.0.
**Never −1.5** when the average winning margin in the last five wins is below
2 runs — teams winning close games cannot cover, and those are the games most
likely to be drawn. The +1.5 underdog is playable when its starter scores 17+
and its bullpen supports it.

### 2d. GAME TOTAL (Over ledger vs Under ledger)

| Block | Pts |
|---|---|
| Combined offensive output (runs per game, last month) | 35 — both 5+ = 35 Over · one 5+, other 4–4.9 = 22 Over · either below 3.5 = 20 Under · both 4–4.9 = 12 neutral |
| Starting pitcher run suppression | 25 — both strong = 25 Under · both struggling = 25 Over · one unconfirmed = 12 Over · split = neutral |
| Bullpen and late-inning run environment | 20 — both fatigued/poor = 20 Over · both effective/rested = 18 Under · split = 10 neutral |
| Recent total trends | 15 — both Over in 4/5 = 15 Over · both Over 3/5 = 9 Over · both Under 3+/5 = 14 Under · mixed = 4 neutral |
| Venue and weather | 5 — enclosed or roof closed = no weather scoring · open-air with **rain** in the rainy/typhoon window = 5 **Under** · wind blowing out confirmed = 5 Over |

## STEP 3 — CONFIDENCE GATES

- **Win match:** 70+ = HIGH · 55–69 with at least two strongly aligned factors
  = MEDIUM · below 55 = SKIP. Draw override per 2b. Never recommend a
  favourite at **−300 or shorter** unless the starter block is the maximum 25
  and the run differential exceeds +2.5.
- **Run line:** 70+ = HIGH · 55–69 = MEDIUM · below 55 = SKIP (and only when
  win ≥ 60 and draw < 55).
- **Game total:** directional advantage of 20+ = HIGH · 15–19 = MEDIUM · under
  15 = SKIP.

## STEP 4 — OUTPUT RULES

- Every tip is at least **40 words**; the **bolded outcome** appears within the
  first 20 words.
- **Never** show statistics, odds, numbers, player names, home/away wording,
  stadium names, league names or source names.
- Run line tips state **only the team that covers**; total tips state **only
  Over or Under**.
- Each tip has its own opening style; confidence LOW / MEDIUM / HIGH stated on
  every tip; SKIP is a single sentence.
- Banned phrases: "this should be a low-scoring affair" · "hard to look past" ·
  "the pitching matchup favours" · "on current form" · "could go either way" ·
  "both lineups" · "a tight contest".
- End the card with a summary table (fixture · market · selection ·
  confidence), the underdog value flag, a draw-flag note, and a responsible
  gambling reminder.

## NPB-SPECIFIC NOTES

- Draws are structural: score them on every match and present them as a
  genuine pick.
- DH divide: CL without DH through 2026 (CL adopts the DH in 2027); PL with DH.
- Import cap: four registered foreign players, no more than three of one type.
- Six-team leagues: same-league head-to-head samples are large; weight them.
- Enclosed venues are common; weather applies only to open-air parks.
- Confirm the scoring environment via search before scoring.
