# Snooker irregularities register

Everything that did not check out while implementing the snooker master
prompt. The machine-readable copy is
[`data/snooker_provenance.json`](../data/snooker_provenance.json), rendered on
[sources.html#snooker-irr](../sources.html). Each entry states its effect on
output and gives links for manual verification.

## IR-SNOOKER-01 — No free, key-less **odds** feed (high, open)

**Finding.** The prompt's 30-point Odds Strength category and Step 3's
price-gated rules (Full Bet ≤ −150, Small Bet −130…−200, profitability guard)
need a current price. OLBG server-rendered HTML carries tipster vote counts
but no prices; WST and snooker.org publish no odds; the ESPN site API has no
snooker coverage; The Odds API requires a key.
**Effect on output.** The odds component is scored missing on every live card;
Step 3 resolves to `SKIP — no verified price`; written verdicts and confidence
are still produced from sourced factors; HIGH is impossible live. Bet-tier
evaluation in the backtest is reported as untestable, and the backtest is a
model-lean report, not a betting record.
**Verify:** <https://www.olbg.com/betting-tips/Snooker/8> ·
<https://www.wst.tv/match-centre/4e7a310c-d41f-4042-bec2-77f20b24dd04>

## IR-SNOOKER-02 — Amateur replacement in the draw (high, open)

**Finding.** Mark Joyce is an amateur (last pro season 2023, career-best
ranking 29) who entered the British Open as Ronnie O'Sullivan's replacement;
Patrick Whelan likewise replaced Mark Allen. Joyce is NOT on the official WST
ranking list; Pang Junxu is ranked 27 (seed 25 on snooker.org).
**Effect on output.** Joyce's World Ranking component is 0 pts (unranked) with
the −5 opponent-ranked-higher deduction. No "upset" narrative is ever
invented — the factor simply scores what the official list shows.
**Verify:** <https://www.snooker.org/res/index.asp?player=48&season=2026> ·
<https://www.wst.tv/rankings/abfba8fe-1423-5a2a-a96b-d77e8b413ca8?showLive=false>

## IR-SNOOKER-03 — Match start time disagrees across public sources (medium, open)

**Finding.** For Pang v Joyce: OLBG prints "Today 17:00/17:15", WST's match
centre says 15:00, BBC Sport lists 21:00, and snooker.org shows "Est. Wed
02 Sep 16:00" in America/New_York (≈21:00 UK). The four cannot be reconciled
without knowing each site's timezone convention.
**Effect on output.** `start_utc` is `null` and **never inferred**. The
scoreboard displays the OLBG label and the official event date; the
irregularity is logged rather than averaged.
**Verify:** <https://www.olbg.com/betting-tips/Snooker/8> ·
<https://www.wst.tv/match-centre/4e7a310c-d41f-4042-bec2-77f20b24dd04> ·
<https://www.bbc.com/sport/snooker/results> ·
<https://www.snooker.org/res/index.asp?template=21&event=2547>

## IR-SNOOKER-04 — Key-less APIs return 401/wrong paths (medium, open)

**Finding.** `api.snooker.org` returns IIS 401.5 Unauthorized (auth required);
`https://www.wst.tv/players/{slug}` returns 404 for the players checked.
**Effect on output.** Only public HTML pages are used: snooker.org
`res/index.asp` (event/player/H2H templates) and WST match-centre/rankings
URLs. No key is ever requested or stored.
**Verify:** <https://api.snooker.org/> · <https://www.wst.tv/rankings>

## IR-SNOOKER-05 — Player pages are ordered by event, not by date (medium, open)

**Finding.** snooker.org player season pages list rows under each event, and
only the flagship event's stream carries per-match dates; qualification rows
only carry the event range.
**Effect on output.** Every tape row records `round_index`, `event_start/end`
and an explicit `date_basis` (`observed` vs `event-range`). Ordering uses the
observed date when known, else event end + round index — documented in the
tape, never guessed. Nothing before a fixture can see a later match
(leak-free rule).
**Verify:** <https://www.snooker.org/res/index.asp?player=1257&season=2026>

## IR-SNOOKER-06 — CueTracker pages expose no data to the fetch tool (low, open)

**Finding.** CueTracker player/season/head-to-head pages render a JS shell
(twitter widget, no tables) over the raw fetch used here.
**Effect on output.** CueTracker is a manual-review link only; nothing is
scored from it.
**Verify:** <https://cuetracker.net/players/pang-junxu>

## IR-SNOOKER-07 — Zero previous meetings (low, resolved)

**Finding.** The H2H page for Pang v Joyce lists only the upcoming fixture —
there are no completed meetings in the public database.
**Effect on output.** The 20-point H2H component is `missing` on both sides
("no completed meetings — not scored") and is NOT counted as "roughly even".
The writer never invents history.
**Verify:** <https://www.snooker.org/res/index.asp?player1=1257&player2=48&season=-1>

## IR-SNOOKER-08 — Registration times are not start times (low, open)

**Finding.** snooker.org prints "time registered" in America/New_York, which is
when the scorer entered the result, not when the match started.
**Effect on output.** Registration times are never converted to UTC and never
used as start times; only the date (with `date_basis`) and round index drive
ordering.
**Verify:** <https://www.snooker.org/res/index.asp?template=22&event=2547>
