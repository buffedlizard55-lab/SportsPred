# Greyhound irregularities register

Everything that did not check out while implementing the greyhound master
prompt. The machine-readable copy is
[`data/greyhound_provenance.json`](../data/greyhound_provenance.json), rendered
on [sources.html#greyhound-irr](../sources.html). Each entry states its effect
on output and gives links for manual verification.

## IR-GH-01 — No free key-less **live odds** feed (high, open)

**Finding.** The prompt's 25-point odds-and-value category, the
primary/secondary/value target bands and the +400 "trap bet" guard all depend
on current win odds from two sources with line movement. None exists on a free
key-less feed:

- OLBG's server HTML carries no structured prices (odds render client-side
  behind logged-in/bookmaker calls).
- Sporting Life free racecards show no pre-race greyhound prices.
- The GBGB official API publishes the **starting price** only *after* a race.

**Effect on output.** On a live card the odds component is scored zero and
marked missing; the odds-gated Step 3 tiers cannot fire; HIGH confidence is
unreachable live (it requires the price tiers), so live selections cap at
MEDIUM. The settled-race backtest scores the odds tier from the official SP,
which is the only odds evidence published. PnL is level-stake SP and labelled
illustrative.
**Verify:** <https://www.olbg.com/betting-tips/Greyhounds/28> ·
<https://www.sportinglife.com/greyhounds/racecards> ·
<https://api.gbgb.org.uk/api/results/meeting/451800>

## IR-GH-02 — Analyst verdicts and tip narratives are paywalled (medium, open)

**Finding.** The prompt lists Timeform analyst verdicts, tip sheets and
Sporting Life form summaries. The free racecard payload contains the draw,
class, distance, prize and runner identities but no editorial verdict.
**Effect on output.** No verdict-derived clauses are ever written. Tips argue
only from measured form, trap, distance, track and grade factors.
**Verify:** <https://www.sportinglife.com/greyhounds/racecards>

## IR-GH-03 — Social / tipster sentiment deliberately not collected (low, open)

**Finding.** The prompt instructs that X/social sentiment be used internally
and never referenced. There is no structured free feed, and the instruction is
explicit that it must never surface.
**Effect on output.** No sentiment input exists at any stage.
**Verify:** n/a (by design).

## IR-GH-04 — Track configuration not available as data (low, open)

**Finding.** The greyhound adjustment for rail-trap bias on left-handed tracks
needs per-track handedness/configuration, which GBGB does not publish as
structured data.
**Effect on output.** Rather than assume a structural edge from geometry, the
trap category measures each dog's actual wins/places from today's trap number
in the official results tape. The qualitative "rail/wide" running-style
language the prompt invites is therefore omitted (it would be unverified).
**Verify:** <https://www.gbgb.org.uk/racing/results/>

## IR-GH-05 — Meeting enumeration before results land (low, mitigated)

**Finding.** The GBGB day index only returns meeting ids once a meeting has at
least one finished race, and there is no open "meetings for date" list
endpoint (verified: `/api/meetings*` returns 404).
**Mitigation.** The collector reads the Sporting Life racecard index (which
lists every meeting each morning) to know the day's venues, then refreshes the
official GBGB meeting records through the evening; the page attempts a live
GBGB fetch and falls back to committed data, labelling the source. No
racecard fact comes from Sporting Life — links only.
**Verify:** <https://www.sportinglife.com/greyhounds/racecards> ·
<https://api.gbgb.org.uk/api/results?page=1&itemsPerPage=3&date=2026-09-03&race_type=race>
(empty ahead of the day)

## IR-GH-06 — Committed fixture is a verified sample (low, resolved in CI)

**Finding.** The repository snapshot ships a small, hand-verified sample
(Yarmouth meeting 451800, 2026-09-02) so the site renders before the first
scheduled collection run.
**Effect on output.** None on logic; the CI workflow
(`.github/workflows/greyhound-collect.yml`) replaces the sample with the full
rolling window (14 days back, twice an hour) and writes
`data/greyhound_meetings.json`, `data/greyhound_history.json`,
`data/greyhound_predictions.json` and `data/greyhound_backtest.json`.
