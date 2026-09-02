# Ice Hockey — Irregularities

Everything in the ICE HOCKEY PREDICTION MASTER PROMPT v1.0 that could not be
satisfied from a verified public source, what it does to the output, and what
would close it. Machine-readable copy: the `irregularities` array in
[`data/ice_hockey_provenance.json`](../data/ice_hockey_provenance.json).

---

## IR-HOCKEY-01 — One price source, not two

**Prompt:** "Cross-reference all odds, puck lines, and totals across a minimum
of two bookmakers before scoring."

**Finding:** Only one key-less price feed exists. ESPN republishes a single
book inside the scoreboard payload and names it (`provider.name`: "Draft
Kings"). OLBG publishes tipster vote counts, never prices. There is no second
free book to cross-reference against.

**Effect on output:** `oddsSourceCount` is 1 (or 0 when no odds block was
present at fetch time). The cross-reference rule cannot be met, so the price is
always attributed to one book and the analysis panel says so. No consensus price
is fabricated.

**Closes when:** a second key-less price feed is added, or the user supplies a
bookmaker API key.

---

## IR-HOCKEY-02 — No confirmed starting goaltender

**Prompt:** "Goaltender confirmation is the most critical data point in hockey
prediction… Always attempt to confirm starting goaltenders before finalising any
prediction."

**Finding:** No free feed names a starter for a future game. The NHL
`club-stats` feed gives season save percentages by goaltender; the game centre
`landing` endpoint is where a confirmed starter would appear, and it is not
populated for games this far out. ESPN carries no hockey probable-starter field.

**Effect on output:** `goaltender.confirmed` is `false` for every side. The risk
layer treats an unconfirmed starter as a veto, so a card built on unsourced
goaltending publishes **SKIP with its reason** rather than a confident tip. This
is the single biggest brake on output volume, and it is deliberate: the prompt
makes goaltending the most critical input, so its absence has to cost the play.

**Closes when:** the collector reads `gamecenter/{id}/landing` inside the
confirmation window (roughly the hour before puck drop) and records the starter.

---

## IR-HOCKEY-03 — Special teams and shot metrics unavailable

**Prompt:** requires power play %, penalty kill %, shots on goal per game
(offensive and defensive), league ranks in those metrics, and blocked shots.

**Finding:** the official standings endpoint publishes goals, points, splits,
last 10 and sequence ranks — but not shots, not power play percentage, not
penalty kill percentage, not blocked shots. The ESPN scoreboard does not carry
team season statistics either. The `api.nhle.com/stats/rest` family could not be
reached through this environment's fetch path, so it is recorded as unverified
rather than cited.

**Effect on output:** the Offensive and Defensive Structure block (20 pts) and
the special-teams components of the total market score **zero** and are recorded
in `missing[]`. Scores are therefore compressed downward and HIGH confidence is
harder to reach. Nothing is defaulted to a mid-table value.

**Closes when:** a stats feed that carries `ppPctg`, `pkPctg`, `shfpg`, `shapag`
and blocked shots is wired into the collector.

---

## IR-HOCKEY-04 — No European league statistics feed

**Prompt:** "NHL totals behave differently to European league totals… Adjust
baseline total thresholds downward by 0.5 goals when scoring European league
matches."

**Finding:** ESPN publishes six hockey leagues and none is European
(`nhl`, `mens-college-hockey`, `womens-college-hockey`, `hockey-world-cup`,
`olympics-mens-ice-hockey`, `olympics-womens-ice-hockey`). The OLBG slate does
carry Finnish SM Liiga and Swiss NLA rows, but nothing behind them.

**Effect on output:** the half-goal adjustment is implemented and unit-tested
(`totalLineGate(…, { european: true })`), and league detection is automatic from
the league name. But a European fixture arrives with no statistics at all, so it
scores as data-poor and resolves to SKIP. The adjustment is real; the data
behind it is not there yet.

**Closes when:** a European league feed (SHL, Liiga, NL, DEL, KHL) is added.

---

## IR-HOCKEY-05 — No retained closing lines

**Prompt:** Step 3 and the subagent layer both depend on the price; the
backtesting agent asks for "evidence of positive closing line value".

**Finding:** prices are stripped once a game is final. This is the same finding
this repository already records as `U-06` for the universal engine: zero of the
graded fixtures in that backtest carried a price.

**Effect on output:** the walk-forward backtest grades the outright market only.
Puck line and total are reported as `ungraded` with the reason, and ROI is
`null` with an explanation. Closing line value cannot be measured historically;
it can only accumulate from the forward ledger, which records the price at pick
time.

**Closes when:** the forward ledger has enough settled, priced picks.

---

## IR-HOCKEY-06 — OLBG row count differs from the index render

**Finding:** `data/olbg_sports.json` counted **4** ice hockey events on
2026-09-02, while the index page rendered **3** event cards above its "Load More
Tips" control.

**Effect on output:** the committed slate holds the three rows that were
actually read. The difference is recorded here rather than reconciled by
guessing what the fourth row was.

**Closes when:** the CI collector fetches the live index and paginates the
remaining rows.

---

## IR-HOCKEY-07 — Collectors could not be executed in this workspace

**Finding:** this sandbox has no outbound network (`curl` and `urllib` both fail
at the TLS handshake), so `scripts/collect_ice_hockey_nhl.mjs` and the live OLBG
fetch were not run here. Every endpoint in
[ICE_HOCKEY_SOURCES.md](ICE_HOCKEY_SOURCES.md) was verified individually during
review, and the seven committed fixtures were transcribed verbatim from those
verified responses. `jsdom` could not be installed for the same reason, so the
DOM smoke test skips locally.

**Effect on output:** `data/ice_hockey_standings.json`, `…_tape.json`,
`…_goalies.json` and `…_injuries.json` are schema-correct but empty, with a note
saying so. The engine records those factors as missing and reduces scores
accordingly.

**Closes when:** the scheduled workflow runs (it runs on push and twice an hour).

---

## Prompt-internal conflicts found while implementing

These are not data problems; they are places where the prompt contradicts
itself. Each resolution is implemented and unit-tested, and named here so a
reader can disagree with it deliberately.

| # | Conflict | Resolution |
|---|---|---|
| C-1 | "Combined offensive score of 55 or higher" gates the Over at 4.5, but the offensive block it names caps at 35 points — the gate would be unreachable | The gate value is the accumulated Over-side score across all four total factors (offence 35 + goaltending 25 + special teams 20 + trends 20 = 100), with neutral-band points counted on both sides |
| C-2 | Step 2 makes 55 a hard gate at a 4.5 line; Step 3 offers MEDIUM at 45-54 on the same line | Read as one confidence ladder: 55+ HIGH, 45-54 MEDIUM, below 45 SKIP. The stricter 5.5 and 6.5 gates stay hard, because Step 3 never offers HIGH above a 4.5 line |
| C-3 | Form is to be weighted "last two weeks double", but the points table is a plain count of wins in the last five | The table is implemented as written; the weighting instruction has no numerical effect on it. Recorded rather than silently reinterpreted |
| C-4 | "Positive odds with strong form = 8pts" never defines strong form | Strong form is the top two form bands (11 points or more, i.e. 3+ wins in 5). Stated in the component detail on every match |
