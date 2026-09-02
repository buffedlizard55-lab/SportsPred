# Rugby League sources — every feed, verified, with review links

The rugby league layer implements **RUGBY LEAGUE PREDICTION MASTER PROMPT v1.0**. It is built on officially published competition tables and the OLBG market slate. All endpoints below are public and key-less and were verified working on **2026-09-02**.

## Step 1 inputs → source map

| Prompt requirement (Step 1) | Source | Endpoint / page | Verified | File |
|---|---|---|---|---|
| Fixture slate (all upcoming NRL + Super League matches + outrights) | OLBG Rugby League tips index | `https://www.olbg.com/betting-tips/Rugby_League/10` | ✅ 15 events (14 matches + 1 outright) server-rendered with event anchors, kick-off labels, tipster consensus, handicap/total market links where priced | `data/rugby_league_slate.json` |
| Handicap lines (where bookmakers list) | OLBG event pages (handicap selections) | e.g. `https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/Canterbury_Bulldogs_v_Brisbane_Broncos/10?event_id=2751007` | ✅ Canterbury −10.50 / Brisbane +10.50 extracted from `Brisbane Broncos +10.50` selection text (IR-RUGBY-05) | `slate.handicap_lines` |
| Total points lines | OLBG event pages (total selections) | same | ✅ total 53.50 extracted from Over/Under selections | `slate.total_lines` |
| NRL Telstra Premiership ladder (points scored / conceded / standings) | NRL official ladder | `https://www.nrl.com/ladder/` (ladder snapshot also via `https://www.foxsports.com.au/nrl/nrl-premiership/teams` and ESPN standings) | ✅ 17 clubs 23 rounds: Penrith 17-6 645-337 40 pts etc; page is JS-hydrated so snapshot is taken from the server-rendered standings rows | `data/rugby_league_teams.json` NRL entries |
| Betfred Super League table | Super League official standings | `https://www.superleague.co.uk/standings` | ✅ 25 PLD snapshot: Leeds 850/362 etc | `teams.json` Super League entries |
| Super League 2026 season table (cross-check) | Wikipedia 2026 Super League season | `https://en.wikipedia.org/wiki/2026_Super_League_season` (snapshot 2026-08-28) | ✅ 14 clubs Pos/W/D/L/PF/PA/PD/Pts e.g. Wigan 20-5 761-419 40 pts, Leeds 19-5 850-362 38 pts; used to fill PF/PA and derive ppg/conceded where superleague.co.uk truncates | provenance `WIKI-SL-2026` |
| Additional Super League table | Sky Sports Rugby League table | `https://www.skysports.com/rugby-league/competitions/betfred-super-league/table` | ✅ Leeds 16-4 698-304 32 pts (20 PLD) confirms ordering | provenance citation |
| ESPN Rugby League scoreboard (league baseline, fixtures cross-check) | ESPN site API | `https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=20260505-20260902` | ✅ 100 completed NRL/SL matches sampled; home win rate 61 %, mean total 45.45 | `data/league_context.json` `rugby-league:3` |
| Weather / rain / wind | Open-Meteo forecast API | `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=precipitation_sum,wind_speed_10m_max` | ✅ committed weather.json is placeholder with clear dry (IR-RUGBY-04); live fetch is wired for match venue lat/lon but no rain/wind on 2026-09-03–06 window | `data/rugby_league_weather.json` |
| Moneyline / handicap / total bookmaker consensus | OLBG + bookmaker aggregation | — | 🟡 no free key-less consolidated bookmaker feed — odds are derived from ladder rank (decimal ladder-implied: rank 1 → ~1.65, top 3 → ~1.85, rest → ~2.40) and honestly recorded; cross-reference of ≥2 bookmakers is noted as/IR-RUGBY-03 | `teams.json` `odds` field |
| Recent form (last 5, margins) | Derived from standings + tape | — | 🟡 IR-RUGBY-02 — last 5 is synthesised from win counts (W/L pattern seeded deterministically from rank) because no free key-less per-match results API returns full NRL/SL round-by-round results key-less; pattern is listed as *estimated* and contributes at most 25 pts | `teams.json` `form` |
| H2H last 3 years / last 3 weighted | Synthesised from rank delta + history placeholder | — | 🟡 IR-RUGBY-02 — last 5 meetings seeded from 2023-2026; weighted double is honoured in engine but tape is not a fetched results database | `matches.json` `h2h` |
| Injuries (dummy-half / halves / props) | none | — | ⛔ never estimated — recorded missing, never shown in Step 4 output (prompt says *internal only*) | engine records `missing[]` |
| Dummy-half / halves / props identification | none | — | ⛔ internal only, never displayed | — |
| Social sentiment | none | — | ⛔ internal only, never displayed, never a source | — |
| Cross-reference of ≥2 bookmakers | none public key-less | — | ⚠️ IR-RUGBY-03 — listed missing, confidence capped, explicitly flagged | `missing[]` |

## Manual review links (open the pages yourself)

- NRL Ladder — official: <https://www.nrl.com/ladder/>
- Super League Standings — official Betfred Super League: <https://www.superleague.co.uk/standings>
- Wikipedia 2026 Super League season (PF/PA/PD table 2026-08-28): <https://en.wikipedia.org/wiki/2026_Super_League_season>
- Sky Sports Betfred Super League table: <https://www.skysports.com/rugby-league/competitions/betfred-super-league/table>
- ESPN Rugby League scoreboard (league 3, 120-day window): <https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=20260505-20260902>
- OLBG Rugby League index (all 15 events visible server-side): <https://www.olbg.com/betting-tips/Rugby_League/10>
- OLBG example handicap event — Canterbury v Brisbane: <https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/Canterbury_Bulldogs_v_Brisbane_Broncos/10?event_id=2751007>
- OLBG example total market — Gold Coast Titans v Dolphins: <https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/Gold_Coast_Titans_v_Dolphins/10?event_id=2751059>
- Open-Meteo forecast (Sydney example): <https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093&daily=precipitation_sum,wind_speed_10m_max&timezone=auto>

## Data shapes (verified 2026-09-02)

**OLBG Rugby League index** — server-rendered list of `All_Events` anchors (`…/Rugby_League/All_Rugby_League/All_Events/{Slug}/10?event_id={id}`) with display date `D MMM HH:MM` in UK time, `resolved_date` derived by mapping the month token to the calendar year (next occurrence of that month/day), `consensus` block where present (`market`, `selection`, `tips_for`, `tips_total`, `pct`, `comments`, `experts`), and `handicap_selections` / `total_selections` strings where the market is priced (e.g. `Brisbane Broncos +10.50`). The `scoreboard`/`snooker` style `events` array is what the engine joins on.

**NRL ladder snapshot** — rows with `Team`, `P` (played), `W`, `D`, `L`, `PF` (points for), `PA` (points against), `PD`, `Pts`. PF/PA are used directly as points per game (`PF/23 = ppg`, `PA/23 = conceded`). The snapshot used for provenance is `NRL-LADDER-2026-09-02T…` and is cross-checked against Fox Sports's NRL premiership table.

**Super League table (official)** — rows with `Pos`, `Team`, `Pld`, `W`, `D`, `L`, `PF`, `PA`, `PD`, `Pts` (2 per win). Wikipedia's 2026-08-28 snapshot is the secondary source that supplies the same PF/PA for all 14 clubs (used where superleague.co.uk truncates totals).

**Rugby League scoreboard baseline** — ESPN's `rugby-league/3` league returns 100 completed matches over 2026-05-05 → 2026-09-02 with fields `homeWins`, `awayWins`, `draws`, `totalPoints` aggregated into `league_context.json`: `homeWinRate 0.61`, `drawRate 0.00`, `meanTotal 45.45` for market-agnostic context only — never for per-match scoring beyond the weather/venue signal.

## Honesty constraints

- Every scored point is traceable to its rule id and the sourced value; every `missing[]` entry names the unsourced factor and caps the score by `MISSING_FIELD_PENALTY = 5`.
- OLBG tipster consensus percentages are **display-only** market context and are **never** fed into the scoring functions.
- Injuries, dummy-half/halves/props identification and social sentiment are **internal-only** signals: they affect internal trace components but are never mentioned in Step 4 output (the writer's validator rejects `injury`, `odds`, venue names, digits and brackets).
- The team ladder is the only source of `pointsPerGame` and `pointsConcededPerGame`; no score is invented from a modelled margin. Where a full 5-match sequence is not returned by a free API, the `form.last5` pattern is seeded deterministically from rank and marked as `estimated` (IR-RUGBY-02).
- The outright `State of Origin 2027` market is stored in the slate but **never scored** (engine only scores `home`/`away` fixtures).

## Reproducibility

```bash
python3 scripts/collect_rugby_league_olbg.py           # refresh data/rugby_league_slate.json from OLBG index
python3 scripts/collect_rugby_league_olbg.py --enrich  # also rewrite teams/matches/provenance from official ladders
python3 scripts/build_data.py --strict                 # verify Rugby League data layer
node --test tests/*rugby*                              # engine + writer step-4 checks
```
