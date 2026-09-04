# Golf Irregularity Register

Every gap, limitation and safeguard in the golf layer. The rule this project
runs on is that a factor nobody publishes is **recorded as missing and scored
as zero**, never estimated, and that partial evidence can never produce a HIGH
grade. This register is the list of those gaps, so a reviewer can see exactly
what the model does not know.

Machine-readable counterparts live in `data/golf_provenance.json`
(`irregularities[]`) and in the `missing[]` array attached to every scored
market and every candidate in the analysis panel.

---

### IR-GOLF-01: No free odds source exists for golf
- **Observation:** ESPN publishes DraftKings prices for team sports but no
  odds object for any golf event inspected (upcoming and completed, both
  tours; the core `…/odds` resource returns `count: 0`). OLBG's server HTML
  carries tipster counts but no prices.
- **Prompt lines affected:** Step 1 "odds from at least two bookmakers"; the
  value rule's "top-three / top-five favourites"; "never let all six top-six
  selections be top-six favourites".
- **Handling:** Odds are never synthesised. `odds` appears in `missing[]` on
  every market. Market favouritism is replaced by **OWGR rank within the
  field**, and every value flag and guard message says so. OLBG consensus is
  displayed next to the event and never scored.

### IR-GOLF-02: Strokes gained is only free for the PGA TOUR and only as season averages
- **Observation:** The PGA TOUR stat pages publish season-to-date strokes
  gained (ShotLink) for six categories. No free source publishes per-event or
  last-eight-events strokes gained, and none exists for the DP World Tour.
  The pages are JavaScript-rendered, so the parser is best-effort and refuses
  to return fewer than fifty plausible rows.
- **Prompt lines affected:** SG approach (25), tee-to-green bonus (+5),
  putting trend (+3), FRL putting (20), top-six tee-to-green (+10),
  American SG approach penalty (−10).
- **Handling:** Season averages stand in for the eight-event window and the
  substitution is written into the component detail. When a category is not
  parseable, or for any DP World Tour event, the SG components score zero,
  are marked missing, and the market is capped at MEDIUM by construction.
  Fields where only a minority of players carry a row are handled by the
  coverage floor in IR-GOLF-14.

### IR-GOLF-03: Course type and grass are not published
- **Observation:** ESPN publishes yardage and par only. No free source
  classifies links / parkland / coastal / desert or bentgrass / bermuda.
- **Prompt lines affected:** "course type matches best surface" (+5), course
  fit strong/moderate/weak, "power course" (+6), "links record" (+5),
  "links or coastal event" (+12), the wind-above-twenty adjustment.
- **Handling:** A measurable **yardage class** (short < 7,000 yds, mid
  7,000–7,399, long ≥ 7,400) replaces course type: course fit is the player's
  two-year top-ten rate and finish percentile on courses of the same class;
  the "best surface" bonus fires when the class with the player's best record
  matches; "power course" requires a long course and top-quartile driving
  distance. The links bonuses are left unassessed and listed as missing on
  every regional candidate. Wind above twenty mph is reported in the weather
  note, not scored.

### IR-GOLF-04: Course history is limited to the seasons in the tape
- **Observation:** The results tape holds the current and previous season(s)
  the collector has visited (two on the first run, three with `--history`).
  "Last four appearances" is usually one or two.
- **Handling:** History is scored only from editions present. When no prior
  edition of the tournament exists in the tape the whole category is marked
  missing (0/20) for every player, and the event-level `missing[]` says so.

### IR-GOLF-05: Name matching across ESPN, OWGR and the PGA TOUR
- **Observation:** The three sources use different player ids. Names are
  normalised (diacritics, punctuation, suffixes, `(a)` markers) and matched
  exactly; ambiguous keys (two OWGR rows with the same normalised name) are
  discarded.
- **Handling:** An unmatched player simply lacks a ranking or SG row and
  scores those categories as missing. The coverage panel on every card shows
  how many players matched each source.

### IR-GOLF-06: The round-one weather trend is a forecast
- **Observation:** The first-round-leader tee-time rule needs to know whether
  conditions deteriorate during day one. Open-Meteo hourly wind and rain
  probability are compared between the morning and afternoon tee windows; the
  forecast is only collected inside seven days of the event.
- **Handling:** No forecast → the tee/weather category is missing (0/25) and
  the market cannot read HIGH. Historical events in the backtest never have a
  forecast, so FRL is graded on the other three categories only.

### IR-GOLF-07: Amateurs are excluded
- **Observation:** ESPN flags amateurs; they cannot win prize money and are
  rarely priced.
- **Handling:** Excluded from every market; the card flags say so.

### IR-GOLF-08: LPGA and PGA TOUR Champions are shown but not scored
- **Observation:** The prompt's ranking and regional rules assume the men's
  world-ranked tours. The LPGA uses its own ranking and the Champions Tour is
  not ranked by OWGR.
- **Handling:** Their leaderboards and calendars appear on the golf page and
  the calendar; no tip is written and the analysis panel says why.

### IR-GOLF-09: Per-tournament driving statistics exist but are not collected
- **Observation:** ESPN's athlete game log publishes per-tournament driving
  distance, accuracy, GIR, putts per GIR and birdie counts. Collecting it for
  a 156-player field is one request per player per season and was judged too
  heavy for a scheduled run; season averages from the byathlete endpoint are
  used instead.
- **Handling:** Driving distance comes from the season table (PGA TOUR only);
  for DP World Tour fields the weakness / power bonuses are unassessed and
  listed as missing.

### IR-GOLF-10: Field rank stands in for market rank in the value and top-six guards
- **Observation:** Follows from IR-GOLF-01. "Top-five favourites" becomes
  "top five in the field by OWGR", and the strict VALUE PICK test (field rank
  15–40, fit ≥ 18, form ≥ 14) is applied literally. When no player passes it,
  the best-scoring player outside the top five is listed as the value outright
  at LOW and the card flag says the strict test was not met.

### IR-GOLF-11: Withdrawal scores in the ESPN payload
- **Observation:** A player who withdraws mid-round carries `score.displayValue
  "E"` but `statistics.scoreToPar` of, say, `+4`, and a round "value" that is
  really a nine-hole count (`23.0`). Verified on J.J. Spaun, TOUR Championship
  2026.
- **Handling:** `parseLeaderboardCompetitor` prefers `statistics.scoreToPar`,
  never assigns a position to `WD`/`CUT`/`DQ`, and the results-tape validator
  in `scripts/build_data.py` rejects any row that pairs a position with a
  non-finish. Opening-round measures only use rounds with a plausible stroke
  count (greater than zero) and the R1 average needs at least four rounds.

### IR-GOLF-12: Historical backtest has no tee times or weather
- **Observation:** ESPN publishes tee times for the live event only, and
  forecasts cannot be recovered historically.
- **Handling:** `scripts/backtest_golf.mjs` grades FRL on opening-round
  scoring, putting (when SG is available for the current season) and the
  fast-start profile only, states this in `method`, and skips the first eight
  events of the tape where no history exists at all.

### IR-GOLF-13: Sandbox cannot reach the sources
- **Observation:** As with tennis and Formula 1, the development sandbox
  cannot open TLS connections to ESPN, OLBG, OWGR or Open-Meteo.
- **Handling:** Every endpoint was verified through a hosted fetch and the
  verbatim excerpts are committed as fixtures
  (`tests/fixtures/espn_golf_leaderboard*.EXCERPT.json`). The collectors run
  only in GitHub Actions. Until the first run completes, every golf data file
  reports `[PENDING]` in `scripts/build_data.py`, the golf page still loads
  the live leaderboards from ESPN in the visitor's browser, and every
  history-based factor is honestly recorded as missing.

### IR-GOLF-14: Strokes-gained coverage floor (found on the first real run)
- **Observation:** The first collector run (2026-09-02) built the Omega
  European Masters card with strokes gained for 11 of 154 players — the
  handful of PGA TOUR members in a DP World Tour field. Ranking those eleven
  *within the field* handed them up to thirty-three points nobody else could
  earn, which lifted an otherwise MEDIUM outright to HIGH and put two
  Americans at the head of the first-round-leader list on putting rows the
  rest of the field did not have.
- **Prompt lines affected:** Every strokes-gained line (approach 25,
  tee-to-green +5, putting trend +3, FRL putting 20, top-six tee-to-green
  +10, American approach penalty −10).
- **Handling:** `applySgCoverageFloor` (engine/golf_data.js) scores strokes
  gained only when at least half of the non-amateur field carries a row;
  below that it is missing for everyone, the event-level `missing[]` says
  "only N of M players…", a flag is raised, and no market can read HIGH. The
  page's coverage line shows both numbers ("with SG (scored after the
  coverage floor)"). The backtest applies the same floor, so its
  current-season DP World Tour events are graded without strokes gained
  (`sgApplied` on every ledger row).

### IR-GOLF-15: Non-stroke-play rounds in the results tape
- **Observation:** ESPN publishes the Barracuda Championship (modified
  Stableford) round values as points (1–19), and partial rounds for
  withdrawn players (e.g. 23 strokes through nine holes). Both read as
  record-low opening rounds: 22 of 230 tape events had a "lowest round one"
  below 58, all from withdrawn players or the Stableford event.
- **Prompt lines affected:** FRL opening-round scoring rank (35), fast-start
  profile (20), the layout early-scoring bonus (15) and first-round-leader
  grading in the backtest.
- **Handling:** `isStrokePlayRound` (55–100 strokes) gates every opening-round
  measurement and the shared grader (`gradeGolfSelections`) refuses to grade
  first-round leader when fewer than twenty real opening rounds exist for
  the event — the Barracuda rows are `UNVERIFIED`, not misgraded.

### IR-GOLF-16: Course city spelling defeats the gazetteer
- **Observation:** ESPN lists the Omega European Masters venue city as
  "Crans Montana"; Open-Meteo's geocoder only knows "Crans-Montana", so the
  first weather run returned `geocoding failed for Crans Montana` and the
  weather note fell back to "no forecast was available".
- **Handling:** `cityQueryVariants` tries the hyphenated, de-hyphenated,
  "Saint"/"Mount" and first-token forms in turn, with country aliases
  (USA → United States, Scotland/England/Wales/Northern Ireland → United
  Kingdom). The variant that matched is recorded in the weather document.

### IR-GOLF-17: The Scottish Open overlay has no odds for any of its five markets
- **Observation:** Same gap as IR-GOLF-01, but the overlay's Step 1 asks for
  six price lists cross-referenced across a minimum of two bookmakers (outright,
  top ten, first round leader, top American, top European, top GB and Ireland),
  and its value rule is expressed in market terms ("never select only from the
  top 5 favourites", "ranked outside the top 15 in the field").
- **Prompt lines affected:** the whole of Step 1's first and last bullets; the
  value selection rule; the "top 5 favourites" profitability rule.
- **Handling:** `odds` is pushed into every market's `missing[]` with the reason.
  Market favouritism is replaced by **OWGR rank within the field**, exactly as
  in IR-GOLF-10, and the two-bookmaker cross-reference is recorded as
  impossible rather than approximated. OLBG's golf slate is matched to the event
  and displayed next to it; it publishes tipster votes, never prices, so it is
  never scored.

### IR-GOLF-18: The overlay's four-category ball-striking test uses season averages
- **Observation:** The prompt scores "gaining strokes in 3 or more of the 4
  major strokes gained categories over the last 8 events". No free source
  publishes an eight-event window, and no free source publishes strokes gained
  at all for DP World Tour members. The PGA TOUR tables republished by ESPN give
  off-the-tee, approach, around-the-green, putting, tee-to-green and total
  season averages for 151 players (see `data/golf_stats.json` → `sg`).
- **Prompt lines affected:** All-Around Ball-Striking Form (25) and its −6
  one-dimensional penalty; FRL putting form (20).
- **Handling:** Season averages stand in for the window and the substitution is
  written into the component detail. All four categories must be published or
  the category scores zero and is marked missing — three of four cannot answer
  "3 or more of the 4". The one-dimensional penalty is measured, not judged:
  exactly one positive category, that category leading the next best by 0.30
  strokes or more, and at least two of the other three losing strokes. The
  first-round-leader "top 10 on tour" ranking is field-relative, and the
  component says so.

### IR-GOLF-19: Links classification comes from eight cited venues and The Open
- **Observation:** The prompt's third pillar is "broader form on genuine links
  and wind-exposed coastal courses". No feed classifies a course. ESPN's
  course names actively mislead: the tape contains Muirfield **Village** (Ohio),
  Royal Melbourne (sandbelt), Royal Queensland, Royal Johannesburg, and an
  ambiguous "Royal GC" — none of them links — alongside Pebble Beach Golf Links,
  which the links literature names as a course that is *not* a true links.
- **Prompt lines affected:** Wind and Links Proxy Form (20) and its +5 venue
  bonus; the American market's −10 for no prior links start.
- **Handling:** `data/golf_links_courses.json` (built by
  `scripts/build_golf_links.mjs`) classifies eight venues, each carrying the
  source that classifies it: The Renaissance Club, Royal Troon, St Andrews Links
  (Old Course), Royal Birkdale, Royal Portrush, Royal County Down, Trump
  International Golf Links (links) and Pebble Beach (coastal, explicitly *not*
  links). Nine further tape venues are listed in `excluded[]` with the reason
  they were rejected, so the negative decisions are auditable too. The Open
  Championship needs no entry: it is always played on a links course
  ([Wikipedia](https://en.wikipedia.org/wiki/Links_(golf))) and the engine
  matches it on the ESPN name plus the `major` flag. Everything else is
  unclassified and scores zero with the reason in `missing[]`. Whether a *prior
  edition here* was windy is not recorded anywhere, so the +5 venue bonus is
  credited on the finish alone, requires two prior appearances, and says so.

### IR-GOLF-20: Ball flight is not published, so course fit caps at twelve
- **Observation:** The course-fit category needs "ability to flight the ball low
  under pressure" **and** above-average scrambling. Scrambling is published
  (ESPN's PGA TOUR season `savePct`, 151 players); ball flight, spin rate and
  trajectory are published nowhere for free.
- **Prompt lines affected:** Course Fit — Shot-Shaping and Short Game (20), its
  −8 penalty, and — as a consequence — the mandatory value rule, which asks for
  a course-fit score of fifteen or more.
- **Handling:** The scrambling half is measured against **this field's median**
  and the low-flight half is recorded as missing. The 20-point tier is therefore
  unreachable and twelve is the ceiling; the −8 penalty is never applied and is
  listed as unassessed. Because the ceiling is twelve, the value test as written
  can never fire on sourced evidence, so the engine falls back to the best
  scorer outside the top fifteen in the field (or outside the top five if none),
  **withholds the VALUE PICK label**, and raises a flag naming the reason. The
  alternative — inventing a ball-flight score to make the rule satisfiable —
  would be fabrication.

### IR-GOLF-21: Per-round wind for completed events is not published
- **Observation:** The twenty-point fast-start tier needs opening rounds
  "played in notable wind". The tape records strokes and dates; it does not
  record the weather, and no free archive supplies per-round wind for a
  completed tournament.
- **Prompt lines affected:** Fast start profile under links pressure (20).
- **Handling:** The tier is unreachable and the twelve-point tier ("at least two
  of the last five opening rounds in the sixties, in any conditions") is used,
  with the missing input named on every candidate. `r1Profile` publishes
  `in60sLast5` alongside `fastStarts` because the prompt grades an absolute
  score (in the 60s) while the generic prompt grades 67 or better. The
  "documented pattern of slow starts followed by late-week charges" test *is*
  measurable and is applied: three or more opening rounds at 73 or worse with
  two or more closing rounds two strokes or more better than the opening round.

### IR-GOLF-22: Race to Dubai standings, travel intent and sentiment have no feed
- **Observation:** Three of the prompt's inputs are not available from any free
  key-less source: the Race to Dubai points table (the DP World Tour site is
  JavaScript-rendered), whether a player travelled as deliberate links
  preparation, and social/analyst sentiment.
- **Prompt lines affected:** the European market's +6 incentive bonus; the
  American market's +6 preparation bonus; the Step 1 intent and sentiment
  bullets.
- **Handling:** All three are pushed into `missing[]` on every affected
  candidate and at event level. The bonuses are **never assumed** — an
  unassessed six points is better than a guessed one. Sentiment is never scored
  and never shown, which the prompt itself requires.

### IR-GOLF-23: The 2027 dates are published only by a hospitality reseller
- **Observation:** The prompt says to confirm dates at the time of use. As at
  2026-09-04 no DP World Tour, PGA TOUR or R&A page publishing 2027 dates could
  be found; a hospitality reseller lists 8–11 July 2027 at The Renaissance Club.
- **Handling:** Recorded in `data/golf_scottish_open.json` as
  `status: "UNCONFIRMED"` with the reseller as the named source and the
  explanation of what is missing. The site displays it as unconfirmed. The
  scoring overlay does not depend on it: it matches on the event name and the
  published venue, so it activates whenever a real edition appears.
