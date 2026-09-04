# SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0

**Status: adopted as an event overlay on the golf layer.** It does not replace
[`GOLF_MASTER_PROMPT.md`](GOLF_MASTER_PROMPT.md). It supersedes it for exactly
one tournament — the men's Scottish Open — and every other event keeps scoring
against the generic prompt. The dispatch is in
[`engine/golf_event_profiles.js`](../engine/golf_event_profiles.js); the
implementation is [`engine/golf_scottish_open.js`](../engine/golf_scottish_open.js);
the line-by-line mapping is
[`SCOTTISH_OPEN_PROMPT_REVIEW.md`](SCOTTISH_OPEN_PROMPT_REVIEW.md).

The text below is the prompt as supplied, reproduced verbatim. Where a line
cannot be honoured with free data it is not quietly dropped: it is scored zero,
marked missing, listed on every affected market, and registered in
[`GOLF_IRREGULARITIES.md`](GOLF_IRREGULARITIES.md) as IR-GOLF-17 … IR-GOLF-23.

---

## Verification of the prompt's own factual claims

The prompt instructs that sponsor, dates and field be confirmed at the time of
use. That was done on **2026-09-04** and committed as
[`data/golf_scottish_open.json`](../data/golf_scottish_open.json), rebuilt by
`node scripts/build_scottish_open.mjs` and checked in CI by the same script with
`--check`. Eleven claims are **CONFIRMED** against a named primary source and
one is **UNCONFIRMED**.

| Claim in the prompt | Status | Primary source |
|---|---|---|
| The Renaissance Club, North Berwick, host since 2019 | CONFIRMED | [golfscotland.net](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) |
| Host venue confirmed through 2030 | CONFIRMED | [golfscotland.net](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) |
| Current title sponsor: Genesis | CONFIRMED | [DP World Tour event page](https://www.europeantour.com/dpworld-tour/genesis-scottish-open-2026/tickets-packages/) |
| Played the week immediately before The Open | CONFIRMED | [Golfweek/USA Today 2026 schedule](https://golfweek.usatoday.com/story/sports/golf/majors/british-open/2026-06-22/when-is-the-2026-open-championship-at-royal-birkdale/90641242007/) · [2026 Open Championship](https://en.wikipedia.org/wiki/2026_Open_Championship) |
| Co-sanctioned, counts on the Race to Dubai and the FedExCup | CONFIRMED | [golfscotland.net](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) |
| Opens the closing stretch of the season points race | CONFIRMED | [DP World Tour — The Closing Swing: All you need to know](https://www.europeantour.com/dpworld-tour/news/articles/detail/the-closing-swing-2026-all-you-need-to-know/) |
| Winner earns a Masters invite; leading finishers earn Open places | CONFIRMED | [DP World Tour — The Closing Swing](https://www.europeantour.com/dpworld-tour/news/articles/detail/the-closing-swing-2026-all-you-need-to-know/) |
| Winning scores range from the low twenties under to single figures under | CONFIRMED | [GolfNewsNet history table](https://thegolfnewsnet.com/ryan_ballengee/2026-07-05/genesis-scottish-open-history-results-and-past-winners-129852/) for 2019-2023; 2024-2026 **measured** from the committed ESPN results tape |
| The layout is not a static sample (rerouted for 2026) | CONFIRMED | [golfscotland.net](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) |
| Championship course is a par 70 | CONFIRMED | [ESPN leaderboard, 2026 edition](https://www.espn.com/golf/leaderboard?tournamentId=401811955) |
| This is the confirmed national open of the host nation | CONFIRMED | [golfscotland.net](https://www.golfscotland.net/golf-news/the-renaissance-club-to-host-genesis-scottish-open-through-to-2030/) |
| The 2027 dates (8-11 July 2027) | **UNCONFIRMED** — only a hospitality reseller publishes them; re-check before use | [Eventmasters](https://www.eventmasters.co.uk/golf-hospitality/scottish-open-hospitality.html) |

### Winning scores at The Renaissance Club

`measured` rows are read from leaderboard rows in
[`data/golf_results.json`](../data/golf_results.json), each carrying its own
ESPN URL. `secondary` rows are the published history tables cited above.

| Year | Winner | Score | Provenance |
|---|---|---|---|
| 2019 | Bernd Wiesberger | −22 | secondary |
| 2020 | Aaron Rai | −11 | secondary |
| 2021 | Min Woo Lee | −18 | secondary |
| 2022 | Xander Schauffele | −7 | secondary |
| 2023 | Rory McIlroy | −15 | secondary |
| 2024 | Robert MacIntyre | −18 | **measured** — [leaderboard](https://www.espn.com/golf/leaderboard?tournamentId=401580359) |
| 2025 | Chris Gotterup | −15 | **measured** — [leaderboard](https://www.espn.com/golf/leaderboard?tournamentId=401703519) |
| 2026 | Tom Kim | −17 | **measured** — [leaderboard](https://www.espn.com/golf/leaderboard?tournamentId=401811955) |

Range across eight editions: **−22 to −7**. That is the swing the prompt
describes, and it is why the wave and weather category carries thirty points.

---

## The prompt, verbatim

SCOTTISH OPEN GOLF PREDICTION MASTER PROMPT v1.0

Calibrated to the Scottish Open at its current host venue, The Renaissance Club in North Berwick, Scotland, host since 2019, played annually the week immediately before The Open Championship. Confirm the current title sponsor, exact dates, and confirmed field via search at the time of use — do not rely on prior knowledge for these details, as they change year to year.

### STEP 1 — DATA COLLECTION (Internal only, never display)

For this tournament, search and gather the following before scoring:

Current outright winner odds, top 10 odds, first round leader odds, top American odds, top European odds, and top GB and Ireland odds from at least two sources, cross-referenced for any line movement

Each contender's last 5 tournament results including finishing position, with events in the last 6 weeks weighted double

Strokes gained metrics over the last 8 events across all categories — Off-the-Tee, Approach, Around-the-Green, Putting, Tee-to-Green, Total — noting whether the player's profile is well-rounded or reliant on a single category

Course history at this specific venue since it joined the rotation — finishing positions for every prior appearance, while treating this sample as limited given the short history at this host course

Broader form on genuine links and wind-exposed coastal courses, especially recent performances at The Open Championship — the strongest available proxy where course-specific history is thin

Driving distance and driving accuracy, noted as secondary to shot-shaping and short game touch at this specific venue

Scrambling and around-the-green statistics from firm, fast turf and pot bunker recovery situations specifically, where available

First round scoring average over the last 12 months — critical for the first round leader market

Confirmed tee times for the opening two rounds and the wave split — morning versus afternoon groupings

Weather forecast for all four rounds by time of day, with particular attention to any forecast divergence between the morning and afternoon waves — this course has produced winning scores from the low twenties-under to single digits-under depending almost entirely on wind, making this the single highest-impact data point available

Current world ranking and ranking trajectory

Nationality confirmation for the American, European, and GB and Ireland markets

Recent Race to Dubai standings context for European contenders — this event opens the closing stretch of the season points race and carries added incentive for players in contention

Whether the player has shown intent to treat this week as serious competition versus a tune-up ahead of the following week's major — assess from schedule pattern and stated goals, never from speculation

Social media and analyst sentiment from golf-specific sources on X, Golf Channel, and specialist sites — use internally only, never reference in output

Cross-reference all odds across a minimum of two bookmakers before scoring any market

### STEP 2 — SCORE EACH PLAYER ACROSS ALL MARKETS (Internal only, never display)

Each player is scored independently. The top scoring players per market are selected as predictions.

**WIN TOURNAMENT — score each contender (100pts total):**

All-Around Ball-Striking Form (25pts):

Gaining strokes in 3 or more of the 4 major strokes gained categories over the last 8 events = 25pts

Gaining strokes in 2 of 4 categories = 16pts

Gaining strokes in only 1 category, however strong = 9pts

Losing strokes in 3 or more categories = 0pts

Deduct 6pts if the player's game is heavily reliant on one elite category with a clear weakness elsewhere — one-dimensional profiles are structurally vulnerable at this course

Recent Form — last 6 weeks double weighted (20pts):

Won a tournament in last 6 weeks = 20pts

Top 3 finish without a win = 15pts

Two or more top 10s in last 5 starts = 11pts

One top 10 in last 5 = 6pts

No top 20 in last 5 starts = 0pts

Bonus +4pts for back-to-back top 10 finishes

Wind and Links Proxy Form (20pts):

Top 10 finish at The Open Championship or another genuine wind-exposed links course in the last 2 years = 20pts

Top 20 finish in the same window = 13pts

Made the cut in a links or severe-wind event with no standout finish = 7pts

No competitive links or wind-exposed start on record = 0pts

Bonus +5pts for a top 5 finish at this specific tournament in a prior windy edition, where that data exists

Course Fit — Shot-Shaping and Short Game (20pts):

Demonstrated ability to flight the ball low under pressure AND above-average scrambling from thick rough or pot bunker recovery = 20pts

Strong in one of the two areas = 12pts

Weak in both areas = 3pts

Deduct 8pts if the player's primary strength is a high, spin-heavy ball flight with no evidence of adapting it in windy conditions

World Ranking and Field-Adjusted Pedigree (15pts):

Top 10 in world ranking = 15pts

Top 20 = 11pts

Top 50 = 6pts

Outside top 50 = 2pts

Bonus +5pts for a major championship win or runner-up finish in the last 2 years

Value selection rule: Never select only from the top 5 favourites. Always identify at minimum one player ranked outside the top 15 in the field whose combined wind and links proxy score and course fit score both sit at 15 or higher — this is the mandatory value selection for this market

**FIRST ROUND LEADER — score each contender (100pts total):**

First round scoring average (30pts):

Ranks top 10 on tour for first round scoring average over the last 12 months = 30pts

Top 20 = 20pts

Top 40 = 11pts

Below top 40 = 0pts

Tee time and weather wave advantage (30pts):

Confirmed wave assignment on the more favourable side of a clearly forecast weather split = 30pts

Wave assignment with only mild forecast divergence expected = 15pts

Wave assignment on the less favourable side of a clearly forecast split = 0pts

No meaningful forecast divergence expected between waves = 10pts for all players regardless of tee time

Putting form on true, contoured greens (20pts):

Top 10 in strokes gained putting over the last 4 events = 20pts

Top 25 = 13pts

Top 50 = 6pts

Negative putting trend = 0pts

Fast start profile under links pressure (20pts):

Scored in the 60s in at least 2 of the last 5 opening rounds played in notable wind = 20pts

Scored in the 60s in at least 2 of the last 5 opening rounds in any conditions = 12pts

Documented pattern of slow starts followed by late-week charges = 0pts — wrong profile for this market

Select the top selection plus up to 2 further contenders for this market. Minimum score threshold: 50pts.

**TOP AMERICAN PLAYER MARKET — score each American contender (100pts total):**

Use the win tournament base score for each American player. Then apply:

Bonus +10pts if player is currently the top ranked American in the field by world ranking

Bonus +8pts for a PGA Tour win in the last 3 months

Bonus +6pts if the player has clearly chosen to travel for this event specifically as competitive links preparation rather than the minimum required appearance

Deduct 10pts if the player has no prior competitive start on a genuine links or severe-wind coastal course

Select the single highest scoring American player. If two players are within 5pts of each other, flag both as co-selections at MEDIUM confidence rather than forcing one HIGH confidence pick.

**TOP EUROPEAN PLAYER MARKET — score each European contender (100pts total):**

Use the win tournament base score for each European player. Then apply:

Bonus +10pts if player is currently the top ranked European in the field by world ranking

Bonus +8pts for a DP World Tour win or top 3 finish in the last 6 weeks

Bonus +6pts if the player is in meaningful contention for the closing Race to Dubai points race — added incentive at this specific event

Deduct 10pts if player has missed the cut in the last 2 consecutive starts

Select the single highest scoring European player. Same co-selection rule applies if two players are within 5pts.

**TOP GB AND IRELAND PLAYER MARKET — score each British or Irish contender (100pts total):**

Use the win tournament base score for each British or Irish player. Then apply:

Bonus +14pts for home national open status — this bonus is larger than a standard home-conditions adjustment given this is the confirmed home national open for these players

Bonus +10pts if player is currently the top ranked GB and Ireland player in the field

Bonus +8pts for a DP World Tour win or top 5 finish in the last 4 months

Bonus +6pts for a made cut in a prior appearance at this event, or a strong recent finish at a links major where course-specific data is unavailable

Deduct 8pts if the player has not made a competitive start in the last 3 weeks

Deduct 10pts for missed cuts in the last 2 consecutive starts

Select the single highest scoring GB and Ireland player. Same co-selection rule applies if two players are within 5pts.

### STEP 3 — BET DECISION RULES (Internal only, never display)

Win Tournament — top selection and value selection scored independently:

Score 75 or higher = HIGH confidence

Score 60 to 74 = MEDIUM confidence

Score below 60 = LOW confidence — still written but flagged as value rather than banker

First Round Leader:

Score 65 or higher = MEDIUM confidence maximum — this market always carries significant variance regardless of score

Score 75 or higher AND confirmed wave advantage = HIGH confidence

Score below 50 = SKIP

Regional markets — American, European, GB and Ireland:

Score 70 or higher = HIGH confidence

Score 55 to 69 = MEDIUM confidence

Score below 55, or within 5pts of the nearest rival in the same market, = LOW confidence

Profitability rules applying to all markets:

Always include the mandatory value selection outside the top 5 favourites for the win tournament market — this is where long-term profit is generated in a large field with no head-to-head opponent

Never award a maximum course history score based on fewer than 2 prior appearances at this specific host venue — fall back to the wind and links proxy score as the primary substitute given the limited sample

Tee time and weather wave advantage is the single most decisive input for first round leader at this specific tournament — never award HIGH confidence on scoring average alone without a confirmed wave edge

Regional markets must be scored independently of one another — if the same player tops more than one regional market, flag this internally and confirm each write-up is justified on that market's own merits rather than copied across

### STEP 4 — OUTPUT FORMAT (Display only, never include internal data)

Write separate predictions in this exact order:

BLOCK 1: WIN TOURNAMENT — write the top selection first, then the mandatory value selection as a second, clearly separate tip

BLOCK 2: FIRST ROUND LEADER — write the top selection first, then up to 2 further selections as individual tips

BLOCK 3: TOP AMERICAN PLAYER — single tip or co-selection

BLOCK 4: TOP EUROPEAN PLAYER — single tip or co-selection

BLOCK 5: TOP GB AND IRELAND PLAYER — single tip or co-selection

Every written tip must follow all of these rules without exception:

Minimum 40 words per tip — no exceptions

The predicted player must be named and bolded within the first 15 words of every tip

No odds figures, sponsor or tournament names, course or venue names, source names, or social media references anywhere in the output

Strokes gained, course history, and form may be referenced in general descriptive terms — complete ball-striker, proven in tough conditions, sharp with the putter of late — but no specific statistics or figures stated

Weather and wind may be referenced naturally where relevant to the written prediction — this is the one external data point permitted directly in the output, consistent with how decisive it is at this event

No injury specifics — reference only in general terms if relevant, such as managing a physical concern

Every tip must be written in a completely unique style — different sentence structure, different opening phrase, different analytical angle, different rhythm from every other tip in the same output and from all previous outputs

Confidence level stated clearly as LOW, MEDIUM, or HIGH on every tip

The value selection must be clearly flagged as VALUE PICK at the top of that tip

Players scoring below threshold must be written as SKIP with a single explanatory sentence

End the full card with:

A clean summary table showing all markets, all selections, and all confidence levels

A value pick summary highlighting the flagged VALUE PICK

A wave and weather impact note — always included given how heavily this specific event is shaped by wind, since it is materially more decisive here than at a typical tour stop

A responsible gambling reminder

STYLE REQUIREMENTS — STRICTLY ENFORCED

No two tips in the same output may open with the same word, phrase, or sentence structure. Banned filler phrases include: "hard to look past," "will relish the test," "made for links golf," "on current form," "ticks every box," "one to watch," "a natural fit for this test," and "loves this time of year." Every tip must read as though written by a different experienced golf analyst — one might focus on ball-striking completeness, another on links pedigree earned elsewhere, another on the tee time draw, another on home motivation, another on Race to Dubai stakes, another on value versus the field. The predicted player must be named and bolded clearly within the first 15 words without stating any numerical data.

SCOTTISH OPEN-SPECIFIC ADJUSTMENTS

Wind is not simply an important variable at this course, it is the deciding one — calm editions have produced winning scores in the low twenties-under while windy editions have been won at or near single digits-under, a swing far wider than almost any other tour stop. Weight forecast conditions above nearly every other factor when the forecast is clear

Because this event has only been held at its current host venue since 2019, course-specific history here is a thin and somewhat unreliable sample on its own — broader form on genuine links and wind-exposed coastal courses, above all recent Open Championship form, is the strongest available substitute and should be weighted accordingly

This course has shown in its most difficult, windiest editions that it does not reward one-dimensional power the way some tour stops do — winners have gained strokes across the full bag rather than leaning on a single elite skill, so a complete, adaptable ball-striker is a more reliable selection than a pure distance specialist

The morning and afternoon tee time wave is one of the most under-appreciated edges available in golf prediction, and it is amplified further at this specific event given how sharply conditions can deteriorate through a single day — always confirm the wave split and forecast divergence before finalising the first round leader market

This event sits the week directly before the year's Open Championship, which pulls the field in two directions at once — it draws an unusually strong turnout using it as deliberate links rehearsal, while some of those same players are not yet fully switched on to win this particular week. Favour players with a track record of competing seriously in tune-up weeks, not just field quality alone

For European contenders specifically, this event opens the closing stretch of the season-long points race, giving players fighting for position an additional, genuine incentive layer beyond the prize fund itself — factor this into intent alongside recent form

Home nation motivation runs deeper here than a standard away-from-home links bonus — this is the confirmed national open for the host nation, and that status should be weighted above the general home-conditions adjustment used for other events

WHAT NEVER APPEARS IN OUTPUT

Scores, factor breakdowns, odds figures, course names, venue names, sponsor or tournament names, source names, social media references, specific statistics, strokes gained numbers, staking advice, or internal reasoning of any kind. Only the written prediction, bolded player name, confidence level, value pick flag, summary table, value summary, wave and weather note, and responsible gambling reminder are displayed.
