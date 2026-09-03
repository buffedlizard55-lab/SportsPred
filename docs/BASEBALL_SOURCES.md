# Baseball — Sources

Every endpoint the baseball layer reads, verified live on 2026-09-03, with the
URL a reviewer can open. Nothing here is assumed; each field map is quoted in
[`engine/baseball_espn.js`](../engine/baseball_espn.js) with the URL it came
from.

## Official MLB StatsAPI (primary, key-less)

| Endpoint | What it supplies | Review link |
|---|---|---|
| `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,linescore,team` | Fixtures, results, scores, team W-L records, and the probable (announced) starting pitcher id and name per game | [open](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-09-02&hydrate=probablePitcher,linescore,team) |
| `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026` | W-L record, run differential, runs scored/allowed, home/away splits, last-ten, and left/right splits per team | [open](https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026) |
| `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=hitting&season=2026&sportId=1` | Season batting per team: AVG, OBP, SLG, OPS, runs, games played | [open](https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=hitting&season=2026&sportId=1) |
| `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=pitching&season=2026&sportId=1` | Season pitching per team: ERA, WHIP, strikeouts per 9, runs allowed | [open](https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=pitching&season=2026&sportId=1) |
| `https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=season&group=pitching&season=2026` | A probable starter's season ERA, WHIP, strikeouts per 9, W-L | [example](https://statsapi.mlb.com/api/v1/people/663554/stats?stats=season&group=pitching&season=2026) |
| `https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=gameLog&season=2026&group=pitching` | A starter's game log: innings, earned runs, hits, strikeouts, walks, pitches per start (for quality starts and the last-4-starts factor) | [example](https://statsapi.mlb.com/api/v1/people/663554/stats?stats=gameLog&season=2026&group=pitching) |

Human-facing review pages: [MLB scoreboard](https://www.mlb.com/scores),
[MLB standings](https://www.mlb.com/standings).

## ESPN public API (key-less, enrichment)

| Endpoint | What it supplies | Review link |
|---|---|---|
| `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=YYYYMMDD` | Venue name and indoor flag, game-time weather summary and temperature, a probable-starter ERA/W-L cross-check, and team records overall/home/road | [open](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260904) |

Human-facing review page: [ESPN MLB scoreboard](https://www.espn.com/mlb/scoreboard).

## OLBG (market slate, never a price)

| Endpoint | What it supplies | Review link |
|---|---|---|
| `https://www.olbg.com/betting-tips/Baseball/12` | The baseball market slate: MLB (and NPB/KBO per the page copy) rows with fixture ("Away @ Home"), league, kickoff, consensus market ("Money Line") and tipster win-tip counts | [open](https://www.olbg.com/betting-tips/Baseball/12) |

OLBG publishes tipster consensus, not bookmaker prices. The `odds` field on
every slate row is therefore null forever, and the slate is display-and-join
context only.

## What does not exist (verified absent, not assumed)

- **Moneyline / run line / total odds.** The ESPN baseball scoreboard carries no
  odds block; the core odds endpoint
  `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/{id}/competitions/{id}/odds`
  returns `{"count":0}`; the summary endpoint carries no pickcenter/odds block.
  The Odds API requires a key. See `IR-BASEBALL-01`.
- **Bullpen ERA rank and 3-day usage.** No verified key-less endpoint isolates
  relievers; the team pitching endpoint is team-wide. See `IR-BASEBALL-02`.
- **Wind direction and speed.** The ESPN weather block carries a summary and
  temperature only. See `IR-BASEBALL-03`.
- **A posted total line** for Over/Under trend measurement. See `IR-BASEBALL-04`.
- **Injuries / social sentiment.** No verified key-less structured feed; the
  prompt marks both internal-only and the engine invents neither.
