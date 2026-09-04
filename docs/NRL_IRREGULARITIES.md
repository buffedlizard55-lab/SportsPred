# NRL irregularities - what is missing, and what the engine does about it

Nothing on this page is smoothed over. Where a factor has no free source it is
scored zero and named on the card, rather than estimated. This register is the
same data as `data/nrl_provenance.json`, rendered.

### NRL-01 - OLBG renders kick-off times in the viewer's timezone (open)

The OLBG index came back with US Eastern times (UTC-4) on this capture, so an OLBG clock reading of 04:00 is 08:00 UTC, not 04:00 UTC. Every kickoff_utc on this page comes from the round fixture listing (Rugby League Project) or the ESPN scoreboard, never from OLBG's clock. Note that the older combined rugby-league page treats OLBG display times as UTC, so its matches.json kick-offs are several hours out; that is a known defect on that page, not on this one.

**Effect on the card:** None on the NRL page. Flagged so the two rugby league pages are not assumed to agree.

### NRL-02 - No key-less price feed, so the odds factor always scores zero (open)

OLBG's server-rendered HTML carries no bookmaker prices and no free NRL odds API exists without a key. The prompt's 15-point odds-and-value factor therefore scores zero on every card, evidence coverage sits at 75 per cent, and no return on investment is published anywhere.

**Effect on the card:** Confidence is capped at MEDIUM on every NRL card until a price source is committed. No prices are guessed.

### NRL-03 - Team lists, Origin squads and judiciary outcomes are not published on any free feed (open)

The 20-point key-absences factor is the largest single gap. Outside the verified Origin window the Origin half is scored (10 points, marked partial) because no player can be on Origin duty; inside it the whole factor is left unscored. Injury and suspension halves are never estimated, and no tip ever mentions personnel.

**Effect on the card:** Named on every card. Cards inside an Origin window will mostly resolve to SKIP, which the prompt expects.

### NRL-04 - The results tape is a transcription, validated end to end (mitigated)

The tape was transcribed from the Rugby League Project data page (rounds 1-25) and from published round 26 tables. It is validated by recomputing the ladder after round 26 and comparing it with the published table: all seventeen clubs match exactly on played, won, lost, differential and points. Any mistyped or missing score would break that check.

**Effect on the card:** None known. The check is re-run whenever the tape is rebuilt.

### NRL-05 - Golden point is not labelled in the tape (open)

The results tape records final scores only. A one- or two-point margin almost always means golden point, but the period is not labelled, so the engine records close finishes and says so rather than asserting golden point. The prompt's regular-season draw possibility is likewise not modelled, because the tape contains no draws in 2026.

**Effect on the card:** The game-state factor leans Under on close finishes, described on the card as a close finish.

### NRL-06 - No free historical handicap or total lines (open)

Nothing free publishes historical NRL handicap and total lines, so the HANDICAP market is reported as unbacktested rather than settled against an invented line, and the GAME TOTAL backtest is settled against the rolling season mean total the engine itself would have used on the day.

**Effect on the card:** The backtest reports strike rates only, with the totals figure explicitly labelled as not-a-market-line.

### NRL-07 - No free historical weather, and venues are recorded for fixtures only (open)

Venue names are committed for upcoming fixtures (they come from the round listing) but not for completed matches, and no free historical forecast is committed. The walk-forward backtest therefore runs with the weather factor removed from the model — ten fewer points — rather than scoring it zero.

**Effect on the card:** The backtested engine has one fewer factor than the live card. Stated on the backtest panel.

### NRL-08 - OLBG handicap lines differ between bookmakers on the same event (open)

On the Titans v Dolphins event page the listed handicap selection is +12.50 / -12.50 while tipster comments quote 10.50 and -13.50 from other bookmakers. The engine records the event-page line where one exists and the index best-tip line otherwise, and labels which it used.

**Effect on the card:** Lines are review context only. They are never written into a tip and never change a score.

### NRL-09 - Per-match cap and the handicap margin test are an interpretation of 'cap sensibly' (informational)

The prompt asks for active recommendations to be capped sensibly without defining the cap. This implementation publishes at most two markets per fixture, prefers the total over a handicap on the same side of the same match (the two stand or fall together), and withholds any handicap whose margin-of-victory test does not add points.

**Effect on the card:** Fewer, less correlated selections. Every withholding is written on the card with its reason.

### NRL-10 - Five-minute kick-off discrepancy on Cronulla v Melbourne (open)

The round listing gives 7:30 pm for Cronulla-Sutherland v Melbourne; OLBG's index shows 05:35 EDT, which is 7:35 pm AEST. The tape uses 7:35 pm, matching OLBG and the usual NRL time slot.

**Effect on the card:** None on scoring. Recorded so the fixture listing is not assumed to be exact to the minute.

### NRL-11 - The travel factor measures this round's trip only (open)

The five-point travel factor compares the two clubs' home venues for the fixture in hand. It does not model a club's travel sequence across rounds, so the Warriors' cumulative commute — they fly to or from Auckland for every away or home turnaround — is not captured, and neither is a club playing away twice in a row.

**Effect on the card:** The home side always scores the full five points. Flagged so the factor is not read as a full travel model.

### NRL-12 - ESPN files State of Origin in the same NRL feed (mitigated)

The ESPN rugby-league scoreboard for league 3 carries representative fixtures alongside the club competition. Two 2026 Origin games arrive with club-shaped records — New South Wales 22-20 Queensland on 2026-05-27 and Queensland 12-30 New South Wales on 2026-07-08 — each with a week number, so nothing in the payload marks them as anything other than an ordinary round fixture. Left unfiltered they enter the tape as two extra clubs and distort the bye count, which is what broke strict validation on the 2026-09-04 collector run.

**Effect on the card:** scripts/collect_nrl_espn.mjs admits only matches where both sides canonicalise to one of the 17 clubs in data/nrl_teams.json; everything else is skipped and reported on the command line. The tape check (--check) now fails if a non-club side ever reaches data/nrl_matches.json. Origin is modelled separately in data/nrl_origin.json.

### NRL-13 - The tape dates matches locally; ESPN dates them in UTC, so the Las Vegas games fall on different days (mitigated)

data/nrl_matches.json dates each match by its local kick-off, while ESPN's scoreboard dates each event in UTC. For every match played in Australia the two agree. They do not for the two round 1 games played at Allegiant Stadium in Las Vegas: 2026-02-28 local is 2026-03-01 in UTC. Because the collector matched on date + home + away, it treated both games as new fixtures and appended them beside the rows the tape already held, double-counting Newcastle, North Queensland, Canterbury-Bankstown and St George Illawarra in the ladder.

**Effect on the card:** The collector now matches a fetched fixture against the tape by exact date, then by the same pairing within one day, then by the same pairing and round within a week, so a fixture the tape already holds is merged rather than duplicated. The tape keeps its local dates; ESPN only backfills venue, UTC kick-off and event id. Replaying the four events the failed run collected is covered by tests/nrl_espn.test.mjs.

### NRL-14 - Venue names are written three different ways, which silently emptied the weather factor (mitigated)

The tape carries grounds as 'Allianz Stadium, Sydney' (Rugby League Project) and as 'Allianz Stadium' (ESPN); nrl_teams.json and the Open-Meteo collector use the bare name. The forecast was first committed with 'Venue, City' keys, so the lookup in enrichNrlMatch — which passes the match's venue string — missed on every fixture and the ten-point weather factor was quietly scored zero rather than reported as unsourced.

**Effect on the card:** nrlWeatherFor now matches on the bare ground name as well as the exact key, so all three spellings resolve; all seven upcoming fixtures resolve a forecast. build_data.py fails if any forecast venue is not a venue in nrl_teams.json, and tests/nrl_data.test.mjs asserts the weather factor resolves for every upcoming fixture, so the join cannot silently empty again.

## Standing rules

1. A factor with no source scores zero and appears in the fixture's *not
   sourced* list. It is never back-filled.
2. Confidence is capped by evidence coverage: below 50 % nothing is published,
   below 60 % a published market drops to LOW, below 75 % it cannot be HIGH.
3. No return on investment is ever reported, because no price feed exists.
4. Lines and prices are review context on the page. They are never written into
   a tip.
