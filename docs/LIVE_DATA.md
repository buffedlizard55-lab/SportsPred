# Live data — how the site gets today's matches

This document records what was tried, what was verified, and what is still
impossible. Every endpoint below was checked on **2026-08-31**.

## The problem this solves

The project previously had no live source. The canonical free dataset
(`JeffSackmann/tennis_atp`) is deleted, its mirrors stop at 2026-05-25, and the
official ATP/WTA ranking pages are client-side rendered. The result was a site
that could score nothing on a current card.

## The source that works: ESPN's public endpoints

ESPN retired its developer programme, but the JSON endpoints that power
espn.com are open, need **no API key**, and are reachable cross-origin, so the
visitor's browser can call them directly from a static GitHub Page.

| Endpoint | Provides |
|---|---|
| `site.api.espn.com/apis/site/v2/sports/tennis/{atp\|wta}/scoreboard?dates=YYYYMMDD` | fixtures, live scores, final scores, set-by-set linescores, rounds, venue |
| `site.api.espn.com/apis/site/v2/sports/tennis/{atp\|wta}/rankings` | current rank, previous rank, points |
| `sports.core.api.espn.com/v2/sports/tennis/leagues/{atp\|wta}/events?dates=…` | tournament enumeration |

A tournament is one `event`; individual matches are `competitions` nested under
`groupings`. The parser lives in [`engine/espn.js`](../engine/espn.js) and is
covered by [`tests/espn.test.mjs`](../tests/espn.test.mjs) against a trimmed
excerpt of a genuine response.

### Why collection runs in the browser

There is no server and no key. GitHub Actions could also do it, but the
automation account here cannot push `.github/workflows/` (see [`ci/README.md`](../ci/README.md)),
so browser-side collection is what makes the site work today with no manual
step. The trade-off — a few seconds of loading, and a dependence on the
visitor's network — is stated in the UI rather than hidden.

## What ESPN does **not** publish

These were checked directly, not assumed:

| Missing | Evidence | Consequence |
|---|---|---|
| **Odds** | `…/competitions/{id}/odds` returns `{"count":0,…,"items":[]}` | Every price factor is unscored. `IR-01` |
| **Serve stats** | every competitor object carries `"statistics": []` | The +8 serving modifier can never fire. `IR-16` |
| **Court surface** | absent from every payload; only a city string and an `indoor` flag | Resolved separately, below. |

Nothing is substituted for any of these. They are reported as missing and the
confidence band is reduced accordingly.

## Surface: derived from recorded match data, not guessed

Surface is a 20-point factor and the prompt calls clay form the single most
predictive surface signal, so guessing was not acceptable.

[`scripts/build_surface_map.mjs`](../scripts/build_surface_map.mjs) builds
[`data/surfaces.json`](../data/surfaces.json) from the `surface` column of
**14,133 real match rows** (ATP + WTA, 2024–2026) in the verified Sackmann
mirrors. A tournament's surface is the surface its own matches were recorded on.

- **349** tournaments resolved.
- **2** left `null` because their source rows genuinely disagree — WTA Linz
  (Hard 54 / Clay 27) and WTA Prague (Clay 31 / Hard 31) have both changed
  surface. These are reported as conflicts, never coerced to a majority.
- Nothing is inferred from a tournament's **name**. "Indian Wells" is Hard
  because its rows say Hard.

The same file supplies each tournament's recorded `tourney_level` codes, which
is how [`engine/tournament.js`](../engine/tournament.js) codes the tour level
without inventing tiers.

## Verified irregularities found while building this

- **`IR-19` — the league slug is not the tour.** The **ATP** scoreboard returns
  **Women's Singles** groupings (Nordea Open, competition `178684`). Tour is
  therefore read from the grouping text, and a regression test pins this using
  the real payload.
- **`IR-16`** — no serve statistics (above).
- **`IR-17`** — "beat a higher-ranked player this event" needs each opponent's
  rank *at the time*, which no payload carries. Applying today's ranking
  retroactively would misstate history, so the bonus stays unsourced.
- **`IR-18`** — the missing-factor penalty is shared across all three markets,
  so the permanently-absent odds depress the first-set score. The effect is
  conservative (it understates confidence), so it is documented rather than
  silently retuned; correcting it needs per-market missing sets and a
  re-calibration run.

## Forward collection and grading

`scripts/collect_espn.mjs` closes the loop:

1. scores the live card and **appends** each selection to `data/predictions.json`
   (append-only, so history cannot be rewritten);
2. re-reads any earlier prediction whose match has since finished and writes the
   real outcome to `data/results.json`.

`scripts/backtest.mjs` then reports hit rate, Brier, log loss and calibration
over that record. Constraints that still apply:

- The **games-handicap market can never be graded**, because grading needs the
  line that was actually offered and no free odds source exists (`IR-01`).
  It reports `void`, never a guessed line.
- A match with an incomplete set record (retirement or walkover) is flagged
  `irregular` rather than recorded as a clean win.
- `tests/settlement.test.mjs` pins the field-name contract between the settler
  and the grader, which is otherwise easy to break silently.

## Reproducing the checks

```bash
node scripts/verify_live.mjs              # full live pipeline against ESPN, today
node scripts/verify_live.mjs --date 2026-08-30 --tape 30
node scripts/build_surface_map.mjs        # rebuild the surface map from source rows
node scripts/collect_espn.mjs --dry-run   # forward collection, without writing
npm test                                  # 104 tests, including the ESPN parsers
```

`verify_live.mjs` **fails loudly** with exit code 2 if ESPN cannot be reached.
It never prints a plausible-looking card it did not actually collect.

> Note: the development sandbox used to build this project has egress to
> GitHub only, so `verify_live.mjs` cannot run there — it exits 2 by design.
> Run it from a normal network or CI.
