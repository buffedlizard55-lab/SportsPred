#!/usr/bin/env python3
"""
Validate and report on the SportsPred data layer.

`npm run build:data` maps to this script. It does not fetch anything and it does
not generate any statistic: it checks that every committed data file is
well-formed and that any *sourced* value carries the provenance the project
promises (a source URL and a fetch timestamp). It is the machine-checkable part
of the "no hallucinations" rule for the static data the site reads.

    python3 scripts/build_data.py            # validate + print a report
    python3 scripts/build_data.py --strict   # fail (non-zero exit) on any problem
"""

from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

# Tennis files
SLATE = os.path.join(DATA, 'slate.json')
PLAYERS = os.path.join(DATA, 'players.json')
PREDICTIONS = os.path.join(DATA, 'predictions.json')
RESULTS = os.path.join(DATA, 'results.json')
PROVENANCE = os.path.join(DATA, 'provenance.json')
SURFACES = os.path.join(DATA, 'surfaces.json')

# Formula 1 files (optional until the first CI collection completes)
F1_EVENTS = os.path.join(DATA, 'f1_events.json')
F1_STANDINGS = os.path.join(DATA, 'f1_standings.json')
F1_SLATE = os.path.join(DATA, 'f1_slate.json')
F1_WEATHER = os.path.join(DATA, 'f1_weather.json')
F1_PROVENANCE = os.path.join(DATA, 'f1_provenance.json')
F1_PREDICTIONS = os.path.join(DATA, 'f1_predictions.json')
OLBG_SPORTS = os.path.join(DATA, 'olbg_sports.json')

# Golf files (optional until the first CI collection completes)
GOLF_EVENTS = os.path.join(DATA, 'golf_events.json')
GOLF_RESULTS = os.path.join(DATA, 'golf_results.json')
GOLF_RANKINGS = os.path.join(DATA, 'golf_rankings.json')
GOLF_STATS = os.path.join(DATA, 'golf_stats.json')
GOLF_WEATHER = os.path.join(DATA, 'golf_weather.json')
GOLF_SLATE = os.path.join(DATA, 'golf_slate.json')
GOLF_PROVENANCE = os.path.join(DATA, 'golf_provenance.json')
GOLF_BACKTEST = os.path.join(DATA, 'golf_backtest.json')
GOLF_PREDICTIONS = os.path.join(DATA, 'golf_predictions.json')

# Greyhound files
GREYHOUND_MEETINGS = os.path.join(DATA, 'greyhound_meetings.json')
GREYHOUND_HISTORY = os.path.join(DATA, 'greyhound_history.json')
GREYHOUND_SLATE = os.path.join(DATA, 'greyhound_slate.json')
GREYHOUND_PROVENANCE = os.path.join(DATA, 'greyhound_provenance.json')
GREYHOUND_BACKTEST = os.path.join(DATA, 'greyhound_backtest.json')
GREYHOUND_PREDICTIONS = os.path.join(DATA, 'greyhound_predictions.json')

# Volleyball files
VOLLEYBALL_SLATE = os.path.join(DATA, 'volleyball_slate.json')
VOLLEYBALL_TAPE = os.path.join(DATA, 'volleyball_tape.json')
VOLLEYBALL_MATCHES = os.path.join(DATA, 'volleyball_matches.json')
VOLLEYBALL_PROVENANCE = os.path.join(DATA, 'volleyball_provenance.json')
VOLLEYBALL_PREDICTIONS = os.path.join(DATA, 'volleyball_predictions.json')
VOLLEYBALL_BACKTEST = os.path.join(DATA, 'volleyball_backtest.json')

# Snooker files
SNOOKER_SLATE = os.path.join(DATA, 'snooker_slate.json')
SNOOKER_RESULTS = os.path.join(DATA, 'snooker_results.json')
SNOOKER_RANKINGS = os.path.join(DATA, 'snooker_rankings.json')
SNOOKER_PROVENANCE = os.path.join(DATA, 'snooker_provenance.json')
SNOOKER_PREDICTIONS = os.path.join(DATA, 'snooker_predictions.json')
SNOOKER_BACKTEST = os.path.join(DATA, 'snooker_backtest.json')

# Darts files
DARTS_SLATE = os.path.join(DATA, 'darts_slate.json')
DARTS_RESULTS = os.path.join(DATA, 'darts_results.json')
DARTS_RANKINGS = os.path.join(DATA, 'darts_rankings.json')
DARTS_PROVENANCE = os.path.join(DATA, 'darts_provenance.json')
DARTS_PREDICTIONS = os.path.join(DATA, 'darts_predictions.json')
DARTS_BACKTEST = os.path.join(DATA, 'darts_backtest.json')

# GAA files
GAA_SLATE = os.path.join(DATA, 'gaa_slate.json')
GAA_HURLING_SLATE = os.path.join(DATA, 'gaa_hurling_slate.json')
GAA_RESULTS = os.path.join(DATA, 'gaa_results.json')
GAA_RANKINGS = os.path.join(DATA, 'gaa_rankings.json')
GAA_PROVENANCE = os.path.join(DATA, 'gaa_provenance.json')
GAA_PREDICTIONS = os.path.join(DATA, 'gaa_predictions.json')
GAA_BACKTEST = os.path.join(DATA, 'gaa_backtest.json')

# Handball files
HANDBALL_SLATE = os.path.join(DATA, 'handball_slate.json')
HANDBALL_TEAMS = os.path.join(DATA, 'handball_teams.json')
HANDBALL_MATCHES = os.path.join(DATA, 'handball_matches.json')
HANDBALL_PROVENANCE = os.path.join(DATA, 'handball_provenance.json')
HANDBALL_PREDICTIONS = os.path.join(DATA, 'handball_predictions.json')

# Rugby League files
RUGBY_SLATE = os.path.join(DATA, 'rugby_league_slate.json')
RUGBY_TEAMS = os.path.join(DATA, 'rugby_league_teams.json')
RUGBY_MATCHES = os.path.join(DATA, 'rugby_league_matches.json')
RUGBY_PROVENANCE = os.path.join(DATA, 'rugby_league_provenance.json')
RUGBY_PREDICTIONS = os.path.join(DATA, 'rugby_league_predictions.json')
RUGBY_BACKTEST = os.path.join(DATA, 'rugby_league_backtest.json')
RUGBY_WEATHER = os.path.join(DATA, 'rugby_league_weather.json')

# NRL (nrl.html) — the NRL PREDICTION MASTER PROMPT v1.0 layer
NRL_MATCHES = os.path.join(DATA, 'nrl_matches.json')
NRL_TEAMS = os.path.join(DATA, 'nrl_teams.json')
NRL_SLATE = os.path.join(DATA, 'nrl_slate.json')
NRL_WEATHER = os.path.join(DATA, 'nrl_weather.json')
NRL_ORIGIN = os.path.join(DATA, 'nrl_origin.json')
NRL_PROVENANCE = os.path.join(DATA, 'nrl_provenance.json')
NRL_PREDICTIONS = os.path.join(DATA, 'nrl_predictions.json')
NRL_BACKTEST = os.path.join(DATA, 'nrl_backtest.json')

# The published table after round 26, 2026. If a refresh ever breaks the tape,
# this is the check that catches it. (club, played, won, lost, differential, points)
NRL_PUBLISHED_LADDER_R26 = [
    ('New Zealand Warriors', 23, 17, 6, 309, 40),
    ('Penrith Panthers', 23, 17, 6, 308, 40),
    ('Dolphins', 23, 16, 7, 152, 38),
    ('Sydney Roosters', 23, 16, 7, 148, 38),
    ('Cronulla-Sutherland Sharks', 23, 14, 9, 153, 34),
    ('South Sydney Rabbitohs', 23, 13, 10, 83, 32),
    ('Newcastle Knights', 24, 14, 10, 42, 32),
    ('North Queensland Cowboys', 23, 13, 10, -64, 32),
    ('Manly Warringah Sea Eagles', 23, 11, 12, 100, 28),
    ('Canterbury-Bankstown Bulldogs', 23, 11, 12, -46, 28),
    ('Melbourne Storm', 23, 10, 13, 14, 26),
    ('Canberra Raiders', 23, 10, 13, -65, 26),
    ('Parramatta Eels', 23, 9, 14, -179, 24),
    ('Wests Tigers', 23, 8, 15, -226, 22),
    ('Brisbane Broncos', 23, 7, 16, -220, 20),
    ('Gold Coast Titans', 23, 6, 17, -182, 18),
    ('St George Illawarra Dragons', 23, 4, 19, -327, 14),
]

# Baseball files (optional until the first CI collection completes)
BASEBALL_FIXTURES = os.path.join(DATA, 'baseball_fixtures.json')
BASEBALL_TAPE = os.path.join(DATA, 'baseball_tape.json')
BASEBALL_STANDINGS = os.path.join(DATA, 'baseball_standings.json')
BASEBALL_TEAM_STATS = os.path.join(DATA, 'baseball_team_stats.json')
BASEBALL_PITCHERS = os.path.join(DATA, 'baseball_pitchers.json')
BASEBALL_SLATE = os.path.join(DATA, 'baseball_slate.json')
BASEBALL_BACKTEST = os.path.join(DATA, 'baseball_backtest.json')
BASEBALL_PROVENANCE = os.path.join(DATA, 'baseball_provenance.json')
BASEBALL_PREDICTIONS = os.path.join(DATA, 'baseball_predictions.json')

# NPB (Baseball sub-page) files — seeded from dated npb.jp captures, replaced by the CI collector
NPB_FIXTURES = os.path.join(DATA, 'npb_fixtures.json')
NPB_TAPE = os.path.join(DATA, 'npb_tape.json')
NPB_STANDINGS = os.path.join(DATA, 'npb_standings.json')
NPB_PITCHERS = os.path.join(DATA, 'npb_pitchers.json')
NPB_BACKTEST = os.path.join(DATA, 'npb_backtest.json')
NPB_PROVENANCE = os.path.join(DATA, 'npb_provenance.json')
NPB_PREDICTIONS = os.path.join(DATA, 'npb_predictions.json')
NPB_CODES = {'T', 'G', 'DB', 'S', 'C', 'D', 'H', 'L', 'F', 'B', 'M', 'E'}

SOURCED_FIELDS = {
    'rank', 'odds', 'firstSetOdds', 'handicapOdds', 'form', 'surface', 'serve', 'rest',
}


def load(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        raise SystemExit(f'INVALID JSON: {path}: {exc}')


def validate_slate(slate):
    problems = []
    events = slate.get('events', [])
    if not isinstance(events, list):
        problems.append('slate.events is not a list')
    if not slate.get('source', {}).get('url'):
        problems.append('slate.source.url missing')
    if not slate.get('source', {}).get('fetched_at_utc'):
        problems.append('slate.source.fetched_at_utc missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in slate: {sorted(dups)}')
    for e in events:
        for field in ('event_id', 'home', 'away'):
            if not e.get(field):
                problems.append(f'event {e.get("event_id")} missing "{field}"')
        for key in ('odds', 'price', 'american', 'decimal'):
            if key in e:
                problems.append(
                    f'event {e.get("event_id")} contains a price-like field "{key}" '
                    '— OLBG publishes no structured odds (IR-01)')
    return problems, len(events)


def validate_players(store):
    problems = []
    players = store.get('players', {})
    for key, rec in players.items():
        if not isinstance(rec, dict):
            problems.append(f'player "{key}" record is not an object')
            continue
        for field in SOURCED_FIELDS:
            if field in rec:
                val = rec[field]
                if val is None:
                    continue
                if isinstance(val, dict):
                    if not (val.get('source') or rec.get('_sources')):
                        problems.append(
                            f'player "{key}" field "{field}" has no source URL or _sources entry')
                else:
                    problems.append(f'player "{key}" field "{field}" is not an object')
    return problems, len(players)


def validate_surfaces(doc):
    problems = []
    tournaments = doc.get('tournaments')
    if not isinstance(tournaments, dict) or not tournaments:
        return ['no tournaments in surface map'], 0
    if not doc.get('sources'):
        problems.append('surface map declares no sources')
    if not doc.get('files_used'):
        problems.append('surface map records no source files')
    allowed = {'Hard', 'Clay', 'Grass', 'Carpet'}
    resolved = 0
    floor = doc.get('min_agreement', 0.9)
    for key, t in tournaments.items():
        surface = t.get('surface')
        if surface is None:
            continue
        resolved += 1
        if surface not in allowed:
            problems.append(f'{key}: unexpected surface {surface!r}')
        if not t.get('matches'):
            problems.append(f'{key}: resolved surface cites no source rows')
        if (t.get('agreement') or 0) < floor:
            problems.append(f'{key}: agreement below the declared floor')
    return problems, resolved


def validate_handball_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        problems.append('handball_slate.events is not a list')
    if not doc.get('source', {}).get('url'):
        problems.append('handball_slate.source.url missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in handball slate: {sorted(dups)}')
    for e in events:
        for field in ('event_id', 'home', 'away'):
            if not e.get(field):
                problems.append(f'handball event {e.get("event_id")} missing "{field}"')
    return problems, len(events)


def validate_handball_teams(doc):
    problems = []
    teams = doc.get('teams', {})
    if not isinstance(teams, dict) or not teams:
        return ['no teams in handball_teams.json'], 0
    for name, t in teams.items():
        if not t.get('standings') or 'rank' not in t.get('standings'):
            problems.append(f'team "{name}" missing standings.rank')
        if not t.get('form') or not isinstance(t.get('form', {}).get('last5'), list):
            problems.append(f'team "{name}" missing form.last5 list')
        if not t.get('source_url'):
            problems.append(f'team "{name}" missing source_url')
    return problems, len(teams)


def validate_f1_events(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['f1_events.events is not a list'], 0
    ids = [e.get('id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event ids in f1_events: {sorted(dups)}')
    for e in events:
        for field in ('id', 'name', 'startDate'):
            if not e.get(field):
                problems.append(f'f1 event missing "{field}": {e}')
        if e.get('state') == 'post' and not e.get('race', {}).get('result'):
            problems.append(f'completed f1 event {e.get("id")} has no race result')
        if e.get('circuit') and not e.get('circuit', {}).get('fullName'):
            problems.append(f'f1 event {e.get("id")} circuit record incomplete')
    return problems, len(events)


def validate_f1_standings(doc):
    problems = []
    drivers = doc.get('drivers', [])
    constructors = doc.get('constructors', [])
    if not isinstance(drivers, list) or not drivers:
        return ['f1_standings.drivers empty or not a list'], 0
    if not isinstance(constructors, list) or not constructors:
        problems.append('f1_standings.constructors empty or not a list')
    ranks = [d.get('rank') for d in drivers]
    if any(r is None for r in ranks):
        problems.append('a driver entry is missing rank')
    if not doc.get('source', {}).get('url'):
        problems.append('f1_standings.source.url missing')
    return problems, len(drivers)


def validate_f1_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['f1_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('f1_slate.source.url missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in f1 slate: {sorted(dups)}')
    for e in events:
        for field in ('event_id', 'event_name', 'url'):
            if not e.get(field):
                problems.append(f'f1 slate row missing "{field}": {e}')
        for key in ('odds', 'price', 'american', 'decimal'):
            if key in e:
                problems.append(f'f1 slate row {e.get("event_id")} contains price-like field "{key}"')
    return problems, len(events)


PRICE_KEYS = ('odds', 'price', 'american', 'decimal', 'stake')


def validate_golf_events(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['golf_events.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('golf_events.source.url missing')
    if not doc.get('fetched_at_utc'):
        problems.append('golf_events.fetched_at_utc missing')
    ids = [e.get('id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event ids in golf_events: {sorted(dups)}')
    for e in events:
        for field in ('id', 'tour', 'name', 'startDate', 'state'):
            if not e.get(field):
                problems.append(f'golf event {e.get("id")} missing "{field}"')
        if not (e.get('sources') or {}).get('espnLeaderboard'):
            problems.append(f'golf event {e.get("id")} missing sources.espnLeaderboard')
        for key in PRICE_KEYS:
            if key in e:
                problems.append(f'golf event {e.get("id")} contains price-like field "{key}"')
        for p in e.get('field') or []:
            if not p.get('athleteId') or not p.get('name'):
                problems.append(f'golf event {e.get("id")} has a field entry without athleteId/name')
                break
            if p.get('position') is not None and p.get('result') not in ('F', 'MDF', 'active'):
                problems.append(f'golf event {e.get("id")} player {p.get("athleteId")} has a position with result {p.get("result")}')
                break
    return problems, len(events)


def validate_golf_results(doc):
    problems = []
    events = doc.get('events', {})
    if not isinstance(events, dict):
        return ['golf_results.events is not an object'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('golf_results.source.url missing')
    fmt = doc.get('row_format')
    if fmt != ['athleteId', 'position', 'result', 'toPar', 'r1', 'r2', 'r3', 'r4']:
        problems.append(f'golf_results.row_format unexpected: {fmt}')
    players = doc.get('players', {})
    rows = 0
    for eid, e in events.items():
        for field in ('tour', 'name', 'startDate', 'endDate', 'sourceUrl'):
            if not e.get(field):
                problems.append(f'golf results event {eid} missing "{field}"')
        if not str(e.get('sourceUrl', '')).startswith('https://'):
            problems.append(f'golf results event {eid} sourceUrl is not https')
        for r in e.get('rows') or []:
            rows += 1
            if not isinstance(r, list) or len(r) != 8:
                problems.append(f'golf results event {eid} row malformed: {r}')
                break
            if r[1] is not None and r[2] not in ('F', 'MDF'):
                problems.append(f'golf results event {eid} player {r[0]} has a position with result {r[2]}')
                break
            if str(r[0]) not in players:
                problems.append(f'golf results event {eid} player {r[0]} missing from players index')
                break
    return problems, len(events)


def validate_golf_rankings(doc):
    problems = []
    rows = doc.get('rows', [])
    if not isinstance(rows, list):
        return ['golf_rankings.rows is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('golf_rankings.source.url missing')
    if not doc.get('fetched_at_utc'):
        problems.append('golf_rankings.fetched_at_utc missing')
    if rows and len(rows) < 100:
        problems.append(f'golf_rankings has only {len(rows)} rows')
    for r in rows[:50]:
        if not isinstance(r.get('rank'), int) or not r.get('name'):
            problems.append(f'golf ranking row malformed: {r}')
            break
    return problems, len(rows)


def validate_golf_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['golf_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('golf_slate.source.url missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in golf slate: {sorted(dups)}')
    for e in events + list(doc.get('team_events') or []):
        for field in ('event_id', 'url'):
            if not e.get(field):
                problems.append(f'golf slate row missing "{field}": {e}')
        for key in PRICE_KEYS:
            if key in e:
                problems.append(f'golf slate row {e.get("event_id")} contains price-like field "{key}"')
    return problems, len(events)


def validate_greyhound_meetings(doc):
    problems = []
    races = doc.get('races', [])
    if not isinstance(races, list):
        return ['greyhound_meetings.races is not a list'], 0
    src = doc.get('source', {})
    if not src.get('base'):
        problems.append('greyhound_meetings.source.base missing')
    seen = set()
    for r in races:
        rid = r.get('raceId')
        if rid in seen:
            problems.append(f'duplicate raceId {rid}')
        seen.add(rid)
        for field in ('track', 'date', 'time', 'grade', 'distance'):
            if not r.get(field):
                problems.append(f'greyhound race {rid} missing "{field}"')
        if r.get('status') not in ('result', 'scheduled'):
            problems.append(f'greyhound race {rid} has bad status {r.get("status")!r}')
        runners = r.get('runners', [])
        if not isinstance(runners, list) or len(runners) < 2:
            problems.append(f'greyhound race {rid} has fewer than two runners')
        for rn in runners:
            if not rn.get('dogId') or not rn.get('name') or rn.get('trap') is None:
                problems.append(f'greyhound race {rid} runner missing dogId/name/trap: {rn.get("name")}')
    return problems, len(races)


def validate_greyhound_history(doc):
    problems = []
    dogs = doc.get('dogs', {})
    if not isinstance(dogs, dict):
        return ['greyhound_history.dogs is not an object'], 0
    n_runs = 0
    for dog_id, d in dogs.items():
        if not d.get('dogId'):
            problems.append(f'greyhound history dog {dog_id} missing dogId')
        runs = d.get('runs', [])
        if not isinstance(runs, list):
            problems.append(f'greyhound history dog {dog_id} runs is not a list')
            continue
        n_runs += len(runs)
        for run in runs:
            if not run.get('position') or not run.get('track') or not run.get('grade'):
                problems.append(f'greyhound history run for {dog_id} missing position/track/grade')
    return problems, n_runs


def validate_snooker_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['snooker_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('snooker_slate.source.url missing')
    ids = []
    for e in events:
        ids.append(e.get('event_id'))
        for field in ('event_id', 'url', 'matchup'):
            if not e.get(field):
                problems.append(f'snooker slate row missing "{field}": {e.get("event_id")}')
        # Never carry a price the source does not publish.
        for key in ('odds', 'price', 'decimal', 'american_odds', 'fractional'):
            if key in e:
                problems.append(f'snooker slate row {e.get("event_id")} contains price-like field "{key}"')
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in snooker slate: {sorted(dups)}')
    return problems, len(events)


def validate_snooker_results(doc):
    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list):
        return ['snooker_results.matches is not a list'], 0
    if not doc.get('source', {}).get('event_page'):
        problems.append('snooker_results.source.event_page missing')
    seen = set()
    for m in matches:
        mid = m.get('id')
        if mid in seen:
            problems.append(f'duplicate match id {mid}')
        seen.add(mid)
        for field in ('event', 'round', 'round_index', 'player_a', 'player_b', 'score_a', 'score_b'):
            if m.get(field) is None:
                problems.append(f'snooker result {mid} missing "{field}"')
        if m.get('player_a', {}).get('name') is None or m.get('player_b', {}).get('name') is None:
            problems.append(f'snooker result {mid} missing player name')
        # Championship League group matches legitimately end level; a framed
        # match with equal frames and no winner is a draw, not an error.
        if m.get('winner') is None and m.get('score_a') == m.get('score_b'):
            continue
        if not m.get('source_urls'):
            problems.append(f'snooker result {mid} has no source_urls (every row must be verifiable)')
    return problems, len(matches)


def validate_snooker_rankings(doc):
    problems = []
    entries = doc.get('entries', [])
    if not isinstance(entries, list):
        return ['snooker_rankings.entries is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('snooker_rankings.source.url missing')
    for e in entries:
        if e.get('rank') is None or not e.get('name'):
            problems.append(f'snooker ranking row invalid: {e}')
    return problems, len(entries)


def validate_darts_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['darts_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('darts_slate.source.url missing')
    ids = []
    for e in events:
        ids.append(e.get('event_id'))
        for field in ('event_id', 'url'):
            if not e.get(field):
                problems.append(f'darts slate row missing "{field}": {e.get("event_id")}')
        if e.get('type') != 'outright' and not e.get('matchup'):
            problems.append(f'darts slate row {e.get("event_id")} missing matchup')
        for key in ('odds', 'price', 'decimal', 'american_odds', 'fractional'):
            if key in e:
                problems.append(f'darts slate row {e.get("event_id")} contains price-like field "{key}"')
        blob = json.dumps(e).lower()
        if '"odds"' in blob or '"american_odds"' in blob:
            problems.append(f'darts slate row {e.get("event_id")} nested price-like field')
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in darts slate: {sorted(dups)}')
    return problems, len(events)


def validate_darts_results(doc):
    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list):
        return ['darts_results.matches is not a list'], 0
    if not doc.get('source', {}).get('event_page'):
        problems.append('darts_results.source.event_page missing')
    seen = set()
    for m in matches:
        mid = m.get('id')
        if mid in seen:
            problems.append(f'duplicate match id {mid}')
        seen.add(mid)
        for field in ('event', 'round', 'round_index', 'player_a', 'player_b', 'score_a', 'score_b'):
            if m.get(field) is None:
                problems.append(f'darts result {mid} missing "{field}"')
        if m.get('player_a', {}).get('name') is None or m.get('player_b', {}).get('name') is None:
            problems.append(f'darts result {mid} missing player name')
        if not m.get('winner'):
            problems.append(f'darts result {mid} has no winner — unfinished rows do not belong on the tape')
        if not m.get('source_urls'):
            problems.append(f'darts result {mid} has no source_urls (every row must be verifiable)')
        # Averages may be absent (IR-DARTS-02) but must never be invented as 0.
        for avg_key in ('average_a', 'average_b'):
            if avg_key in m and m[avg_key] is not None and not isinstance(m[avg_key], (int, float)):
                problems.append(f'darts result {mid} {avg_key} is not numeric')
    return problems, len(matches)


def validate_gaa_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['gaa_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('gaa_slate.source.url missing')
    ids = []
    for e in events:
        ids.append(e.get('event_id'))
        for field in ('event_id', 'url'):
            if not e.get(field):
                problems.append(f'gaa slate row missing "{field}": {e.get("event_id")}')
        if e.get('type') != 'outright' and not e.get('matchup'):
            problems.append(f'gaa slate row {e.get("event_id")} missing matchup')
        for key in ('odds', 'price', 'decimal', 'american_odds', 'fractional'):
            if key in e:
                problems.append(f'gaa slate row {e.get("event_id")} contains price-like field "{key}"')
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in gaa slate: {sorted(dups)}')
    return problems, len(events)


def validate_gaa_results(doc):
    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list):
        return ['gaa_results.matches is not a list'], 0
    if not doc.get('source', {}).get('event_page'):
        problems.append('gaa_results.source.event_page missing')
    seen = set()
    for m in matches:
        mid = m.get('id')
        if mid in seen:
            problems.append(f'duplicate match id {mid}')
        seen.add(mid)
        for field in ('event', 'round', 'team_a', 'team_b', 'total_a', 'total_b', 'winner'):
            if m.get(field) is None:
                problems.append(f'gaa result {mid} missing "{field}"')
        if not m.get('source_urls'):
            problems.append(f'gaa result {mid} has no source_urls')
        expected = None
        if m.get('goals_a') is not None and m.get('points_a') is not None:
            expected = m['goals_a'] * 3 + m['points_a']
            if m.get('total_a') != expected:
                problems.append(f'gaa result {mid} total_a {m.get("total_a")} != 3*goals+points {expected}')
        if m.get('goals_b') is not None and m.get('points_b') is not None:
            expected_b = m['goals_b'] * 3 + m['points_b']
            if m.get('total_b') != expected_b:
                problems.append(f'gaa result {mid} total_b mismatch')
    return problems, len(matches)


def validate_gaa_rankings(doc):
    problems = []
    entries = doc.get('entries', [])
    if not isinstance(entries, list):
        return ['gaa_rankings.entries is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('gaa_rankings.source.url missing')
    for e in entries:
        if e.get('rank') is None or not e.get('name'):
            problems.append(f'gaa ranking row invalid: {e}')
    return problems, len(entries)


def validate_darts_rankings(doc):
    problems = []
    entries = doc.get('entries', [])
    if not isinstance(entries, list):
        return ['darts_rankings.entries is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('darts_rankings.source.url missing')
    for e in entries:
        if e.get('rank') is None or not e.get('name'):
            problems.append(f'darts ranking row invalid: {e}')
    return problems, len(entries)


def validate_greyhound_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['greyhound_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('greyhound_slate.source.url missing')
    for e in events:
        for field in ('event_id', 'url', 'event_name'):
            if not e.get(field):
                problems.append(f'greyhound slate row missing "{field}": {e.get("event_id")}')
    return problems, len(events)


def validate_volleyball_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['volleyball_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('volleyball_slate.source.url missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in volleyball slate: {sorted(dups)}')
    for e in events:
        for field in ('event_id', 'home', 'away', 'url'):
            if not e.get(field):
                problems.append(f'volleyball slate row {e.get("event_id")} missing "{field}"')
        for key in PRICE_KEYS:
            if key in e:
                problems.append(
                    f'volleyball slate row {e.get("event_id")} contains price-like field "{key}" '
                    '— OLBG listings are display-only (IR-VB-02)')
    return problems, len(events)


def validate_volleyball_tape(doc):
    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list):
        return ['volleyball_tape.matches is not a list'], 0
    if not doc.get('source', {}).get('url') and not doc.get('source', {}).get('name'):
        problems.append('volleyball_tape.source missing')
    ids = [m.get('id') for m in matches]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate match ids in volleyball tape: {sorted(dups)}')
    for m in matches:
        for field in ('id', 'family', 'date', 'home', 'away'):
            if not m.get(field):
                problems.append(f'volleyball tape row {m.get("id")} missing "{field}"')
        if m.get('family') == 'ncaa' and m.get('phase') == 'eurovolley':
            problems.append(f'volleyball tape row {m.get("id")} mixes ncaa family with eurovolley phase')
        if m.get('winner') and not m.get('setScore') and not m.get('setsIncomplete'):
            problems.append(f'volleyball tape row {m.get("id")} has a winner without a sourced set score')
        if m.get('source_url') and not str(m.get('source_url')).startswith('https://'):
            problems.append(f'volleyball tape row {m.get("id")} source_url is not https')
    return problems, len(matches)


def validate_volleyball_matches(doc):
    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list):
        return ['volleyball_matches.matches is not a list'], 0
    for m in matches:
        for field in ('id', 'family', 'date', 'home', 'away', 'source_url'):
            if not m.get(field):
                problems.append(f'volleyball match {m.get("id")} missing "{field}"')
        for key in PRICE_KEYS:
            if key in m:
                problems.append(f'volleyball match {m.get("id")} contains price-like field "{key}"')
        if m.get('source_url') and not str(m.get('source_url')).startswith('https://'):
            problems.append(f'volleyball match {m.get("id")} source_url is not https')
    return problems, len(matches)


def validate_handball_matches(doc):

    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list):
        return ['handball_matches.matches is not a list'], 0
    for m in matches:
        for field in ('competition_id', 'date', 'home', 'away'):
            if not m.get(field):
                problems.append(f'handball match {m.get("competition_id")} missing "{field}"')
    return problems, len(matches)


def validate_rugby_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['rugby_league_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('rugby_league_slate.source.url missing')
    if not doc.get('source', {}).get('fetched_at_utc'):
        problems.append('rugby_league_slate.source.fetched_at_utc missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in rugby slate: {sorted(dups)}')
    for e in events:
        if e.get('type') == 'outright':
            for field in ('event_id', 'name'):
                if not e.get(field):
                    problems.append(f'rugby outright {e.get("event_id")} missing "{field}"')
            continue
        for field in ('event_id', 'home', 'away'):
            if not e.get(field):
                problems.append(f'rugby event {e.get("event_id")} missing "{field}"')
        # prices are allowed to be absent — OLBG slate is display only
    return problems, len(events)


def validate_rugby_teams(doc):
    problems = []
    teams = doc.get('teams', {})
    if not isinstance(teams, dict) or not teams:
        return ['no teams in rugby_league_teams.json'], 0
    for name, t in teams.items():
        # alias entries share same object but we check required fields
        if not t.get('name'):
            problems.append(f'team \"{name}\" missing name')
        if t.get('standings') is not None and 'rank' not in t.get('standings', {}):
            problems.append(f'team \"{name}\" missing standings.rank')
        if t.get('form') is not None and not isinstance(t.get('form', {}).get('last5'), list):
            problems.append(f'team \"{name}\" missing form.last5 list')
    if not doc.get('source', {}).get('fetched_at_utc') and not doc.get('generated_at_utc'):
        problems.append('rugby_league_teams missing generated_at_utc/fetched_at_utc')
    return problems, len(teams)


def validate_rugby_matches(doc):
    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list):
        return ['rugby_league_matches.matches is not a list'], 0
    for m in matches:
        for field in ('competition_id', 'date', 'home', 'away'):
            if not m.get(field):
                problems.append(f'rugby match {m.get("competition_id")} missing \"{field}\"')
        if not (m.get('source_url') or '').startswith('https://'):
            # allow empty but warn
            pass
    return problems, len(matches)


def nrl_ladder(matches, through_round=None):
    """Recompute the NRL table from the tape: 2 a win, 1 a draw, 2 a bye."""
    rows = {}

    def blank(team):
        return {'team': team, 'P': 0, 'W': 0, 'D': 0, 'L': 0, 'B': 0, 'PF': 0, 'PA': 0}

    played = [m for m in matches
              if m.get('status') == 'completed'
              and isinstance(m.get('homeScore'), int) and isinstance(m.get('awayScore'), int)
              and (through_round is None or (m.get('round') or 0) <= through_round)]
    for m in played:
        for side in (m['home'], m['away']):
            rows.setdefault(side, blank(side))
    rounds = sorted({m.get('round') for m in played if m.get('round')})
    for m in played:
        h, a = rows.setdefault(m['home'], blank(m['home'])), rows.setdefault(m['away'], blank(m['away']))
        hs, as_ = m['homeScore'], m['awayScore']
        h['P'] += 1; a['P'] += 1
        h['PF'] += hs; h['PA'] += as_
        a['PF'] += as_; a['PA'] += hs
        if hs > as_: h['W'] += 1; a['L'] += 1
        elif hs < as_: a['W'] += 1; h['L'] += 1
        else: h['D'] += 1; a['D'] += 1
    for team, r in rows.items():
        for rd in rounds:
            if not any(m.get('round') == rd and team in (m['home'], m['away']) for m in played):
                r['B'] += 1
        r['PD'] = r['PF'] - r['PA']
        r['Pts'] = 2 * r['W'] + r['D'] + 2 * r['B']
    return sorted(rows.values(), key=lambda r: (-r['Pts'], -r['PD'], -r['PF'], r['team']))


def validate_nrl_matches(doc):
    """The tape: schema, no half-scored rows, and the ladder check."""
    problems = []
    matches = doc.get('matches', [])
    if not isinstance(matches, list) or not matches:
        return ['nrl_matches.matches is missing or empty'], 0
    for m in matches:
        label = f'{m.get("date")} {m.get("home")} v {m.get("away")}'
        for field in ('date', 'home', 'away', 'status', 'round'):
            if m.get(field) in (None, ''):
                problems.append(f'nrl match {label} missing "{field}"')
        completed = m.get('status') == 'completed'
        scores = (m.get('homeScore'), m.get('awayScore'))
        if completed and not all(isinstance(x, int) for x in scores):
            problems.append(f'nrl match {label} is completed without both scores')
        if not completed and any(x is not None for x in scores):
            problems.append(f'nrl match {label} is not completed but carries a score')
    rounds = {m.get('round') for m in matches}
    if len(rounds) != 27:
        problems.append(f'nrl_matches covers {len(rounds)} rounds, expected 27')
    clubs = {m['home'] for m in matches} | {m['away'] for m in matches}
    if len(clubs) != 17:
        problems.append(f'nrl_matches covers {len(clubs)} clubs, expected 17')
    # the anti-typo check
    table = {r['team']: r for r in nrl_ladder(matches, through_round=26)}
    for name, P, W, L, PD, Pts in NRL_PUBLISHED_LADDER_R26:
        r = table.get(name)
        if r is None:
            problems.append(f'nrl ladder after round 26 is missing {name}')
            continue
        if (r['P'], r['W'], r['L'], r['PD'], r['Pts']) != (P, W, L, PD, Pts):
            problems.append(
                f'nrl ladder after round 26 disagrees with the published table for {name}: '
                f'computed {r["P"]}/{r["W"]}/{r["L"]}/{r["PD"]}/{r["Pts"]} v published {P}/{W}/{L}/{PD}/{Pts}')
    return problems, len(matches)


def validate_nrl_teams(doc):
    problems = []
    teams = doc.get('teams', {})
    if not isinstance(teams, dict) or not teams:
        return ['nrl_teams.teams is missing or empty'], 0
    for name, t in teams.items():
        for field in ('short', 'venue', 'city', 'country', 'lat', 'lon'):
            if t.get(field) in (None, ''):
                problems.append(f'nrl team {name} missing "{field}"')
        if not isinstance(t.get('aliases'), list) or not t['aliases']:
            problems.append(f'nrl team {name} has no aliases (the OLBG/ESPN join needs them)')
    if len(teams) != 17:
        problems.append(f'nrl_teams has {len(teams)} clubs, expected 17')
    return problems, len(teams)


def validate_nrl_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list) or not events:
        return ['nrl_slate.events is missing or empty'], 0
    for e in events:
        if e.get('type') == 'outright':
            continue
        for field in ('event_id', 'home', 'away', 'url'):
            if not e.get(field):
                problems.append(f'nrl slate event {e.get("event_id")} missing "{field}"')
        if not str(e.get('url', '')).startswith('https://www.olbg.com/'):
            problems.append(f'nrl slate event {e.get("event_id")} url is not an OLBG https link')
        for m in e.get('markets', []) or []:
            if 'line' in m and not isinstance(m['line'], (int, float, type(None))):
                problems.append(f'nrl slate event {e.get("event_id")} has a non-numeric line')
        # no prices may ever appear in this file
        blob = json.dumps(e)
        for token in ('odds', 'price', 'fraction', 'decimal'):
            if f'"{token}"' in blob:
                problems.append(f'nrl slate event {e.get("event_id")} carries a {token} field (no price feed exists)')
    return problems, len(events)


def validate_nrl_provenance(doc):
    problems = []
    if not doc.get('sources'):
        problems.append('nrl_provenance has no sources')
    for s in doc.get('sources', []):
        if not str(s.get('url', '')).startswith('https://'):
            problems.append(f'nrl provenance source {s.get("id")} url is not https')
    if not doc.get('irregularities'):
        problems.append('nrl_provenance has no irregularities register')
    for i in doc.get('irregularities', []):
        for field in ('id', 'status', 'title', 'detail', 'effect'):
            if not i.get(field):
                problems.append(f'nrl irregularity {i.get("id")} missing "{field}"')
    return problems, len(doc.get('sources', []))


def validate_nrl_backtest(doc):
    problems = []
    if not doc.get('rows'):
        return ['nrl_backtest.rows is empty (run scripts/backtest_nrl.mjs)'], 0
    w = (doc.get('summary') or {}).get('win_match') or {}
    if not w.get('selections'):
        problems.append('nrl_backtest has no WIN MATCH selections')
    if 'strike' not in w:
        problems.append('nrl_backtest WIN MATCH summary has no strike rate')
    blob = json.dumps(doc)
    for token in ('roi', 'profit', 'units', 'return on investment'):
        if token in blob.lower() and 'no return on investment' not in blob.lower():
            problems.append(f'nrl_backtest mentions "{token}" — no ROI is possible without prices')
    if not (doc.get('summary') or {}).get('handicap', {}).get('settled') is False:
        problems.append('nrl_backtest must record the handicap as not settled')
    return problems, len(doc.get('rows', []))


def validate_nrl_predictions(doc):
    problems = []
    preds = doc.get('predictions', [])
    if not isinstance(preds, list):
        return ['nrl_predictions.predictions is not a list'], 0
    for p in preds:
        for field in ('match', 'market', 'market_label', 'band'):
            if not p.get(field):
                problems.append(f'nrl prediction {p.get("key")} missing "{field}"')
        if p.get('skip'):
            continue
        tip = p.get('tip', '')
        words = tip.replace('**', '').split()
        if len(words) < 40:
            problems.append(f'nrl prediction {p.get("key")} tip is {len(words)} words (minimum 40)')
        if re.search(r'\d', tip):
            problems.append(f'nrl prediction {p.get("key")} tip carries a figure')
        if not re.search(r'Confidence:\s*(LOW|MEDIUM|HIGH)', tip):
            problems.append(f'nrl prediction {p.get("key")} tip does not state a confidence')
    return problems, len(preds)


def validate_nrl_weather(doc):
    problems = []
    venues = doc.get('venues', {})
    if not venues:
        return ['nrl_weather.venues is empty'], 0
    # A venue the clubs do not carry can never join, so the forecast would be
    # silently absent from every card. Caught here rather than on the page.
    try:
        with open(NRL_TEAMS) as fh:
            club_venues = {t.get('venue') for t in (json.load(fh).get('teams') or {}).values()}
    except (OSError, ValueError):
        club_venues = None
    if club_venues:
        for name in venues:
            if name not in club_venues:
                problems.append(f'nrl weather venue "{name}" is not a venue in nrl_teams.json, so the forecast can never join')
    for name, v in venues.items():
        if not v.get('daily'):
            problems.append(f'nrl weather venue {name} has no daily forecast')
        for d in v.get('daily', []):
            if not d.get('date'):
                problems.append(f'nrl weather venue {name} has a day with no date')
    return problems, len(venues)


def validate_nrl_origin(doc):
    problems = []
    games = doc.get('games', [])
    if len(games) != 3:
        problems.append(f'nrl_origin has {len(games)} games, expected three')
    for g in games:
        for field in ('game', 'date', 'venue', 'result'):
            if not g.get(field):
                problems.append(f'nrl origin game {g.get("game")} missing "{field}"')
    if not (doc.get('source') or {}).get('urls'):
        problems.append('nrl_origin has no source urls')
    return problems, len(games)


def validate_ice_hockey_fixtures(doc):
    problems = []
    fixtures = doc.get('fixtures', [])
    if not isinstance(fixtures, list):
        return ['ice_hockey_fixtures.fixtures is not a list'], 0
    endpoints = doc.get('endpoints', [])
    if not endpoints:
        problems.append('ice_hockey_fixtures has no endpoint provenance')
    for e in endpoints:
        if not str(e.get('url', '')).startswith('https://'):
            problems.append(f'ice hockey endpoint url is not https: {e.get("url")}')
    ids = [str(f.get('id')) for f in fixtures]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate fixture ids in ice_hockey_fixtures: {sorted(dups)}')
    for f in fixtures:
        for field in ('id', 'dateISO', 'startUtc', 'source'):
            if not f.get(field):
                problems.append(f'ice hockey fixture {f.get("id")} missing "{field}"')
        for side in ('home', 'away'):
            if not (f.get(side) or {}).get('name'):
                problems.append(f'ice hockey fixture {f.get("id")} missing {side}.name')
    return problems, len(fixtures)


def validate_ice_hockey_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['ice_hockey_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('ice_hockey_slate.source.url missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in ice hockey slate: {sorted(dups)}')
    for e in events:
        for field in ('event_id', 'home', 'away', 'url'):
            if not e.get(field):
                problems.append(f'ice hockey slate row {e.get("event_id")} missing "{field}"')
        if not str(e.get('url', '')).startswith('https://www.olbg.com/betting-tips/Ice_Hockey/'):
            problems.append(f'ice hockey slate row {e.get("event_id")} url is not the OLBG ice hockey index')
        # OLBG publishes tipster consensus, never a price. A price here is a bug.
        if e.get('odds') is not None:
            problems.append(f'ice hockey slate row {e.get("event_id")} carries an odds value; OLBG publishes none')
    return problems, len(events)


def validate_ice_hockey_provenance(doc):
    problems = []
    for s in doc.get('sources', []):
        if not str(s.get('url', '')).startswith('https://'):
            problems.append(f'ice hockey source "{s.get("name")}" has no https url')
        if not s.get('provides'):
            problems.append(f'ice hockey source "{s.get("name")}" does not state what it provides')
        if s.get('status') != 200:
            problems.append(f'ice hockey source "{s.get("name")}" was not verified with HTTP 200 (got {s.get("status")})')
    for i in doc.get('irregularities', []):
        if not i.get('id') or not i.get('title') or len(str(i.get('effect', ''))) < 30:
            problems.append(f'ice hockey irregularity {i.get("id")} is missing an id, title or a real effect statement')
    if not doc.get('sources'):
        problems.append('ice_hockey_provenance lists no sources')
    return problems, len(doc.get('sources', []))


def validate_baseball_provenance(doc):
    """Check the derived baseball source register.

    The register is generated by scripts/build_baseball_provenance.mjs from the
    endpoint arrays inside the committed baseball documents, so this validator
    guards against it drifting out of step with them: every source must be an
    https endpoint that states what it provides, any claimed HTTP status must
    be a real success code (a source may carry no status at all, which is how
    the OLBG slate is recorded, but it may not claim a failure), and the
    coverage block must agree with the fixture count actually committed.
    """
    problems = []
    sources = doc.get('sources', [])
    if not sources:
        problems.append('baseball_provenance lists no sources')
    for s in sources:
        label = s.get('name') or s.get('id')
        if not str(s.get('url', '')).startswith('https://'):
            problems.append(f'baseball source "{label}" has no https url')
        if not s.get('provides'):
            problems.append(f'baseball source "{label}" does not state what it provides')
        status = s.get('status')
        if status is not None and status != 200:
            problems.append(f'baseball source "{label}" records a non-200 status ({status})')
        if not s.get('verified_utc'):
            problems.append(f'baseball source "{label}" carries no verification timestamp')
        ok, req = s.get('requests_ok'), s.get('requests')
        if req is not None and ok is not None and ok != req:
            problems.append(f'baseball source "{label}" had {req - ok} failed requests of {req}')
    for i in doc.get('irregularities', []):
        if not i.get('id') or not i.get('title') or len(str(i.get('effect', ''))) < 30:
            problems.append(f'baseball irregularity {i.get("id")} lacks an id, title or real effect statement')
        if not i.get('evidence'):
            problems.append(f'baseball irregularity {i.get("id")} cites no evidence')
    cov = doc.get('coverage') or {}
    if not cov:
        problems.append('baseball_provenance has no coverage block')
    else:
        fixtures = load(BASEBALL_FIXTURES) or {}
        committed = (fixtures.get('counts') or {}).get('fixtures')
        if committed is not None and cov.get('fixtures_scored') != committed:
            problems.append(
                'baseball_provenance coverage.fixtures_scored '
                f'({cov.get("fixtures_scored")}) does not match the committed fixture count ({committed})')
        published, generated = cov.get('tips_published'), cov.get('tips_generated')
        if published is not None and generated is not None:
            if published > generated:
                problems.append('baseball_provenance reports more published tips than generated')
            if cov.get('tips_skipped') != generated - published:
                problems.append('baseball_provenance tips_skipped does not reconcile')
    return problems, len(sources)


def validate_ice_hockey_backtest(doc):
    problems = []
    results = doc.get('results', {})
    if not results:
        problems.append('ice_hockey_backtest has no results block')
    for market in ('puck_line', 'game_total'):
        if results.get(market, {}).get('graded', 0) == 0 and not results.get(market, {}).get('reason'):
            problems.append(f'ice_hockey_backtest.{market} is ungraded without saying why')
    if results.get('roi') is None and not results.get('roi_reason'):
        problems.append('ice_hockey_backtest reports no ROI without saying why')
    if not doc.get('method'):
        problems.append('ice_hockey_backtest does not state its method')
    return problems, results.get('graded', 0)


def _https_endpoints(doc):
    problems = []
    endpoints = doc.get('endpoints', [])
    if not endpoints:
        problems.append('no endpoint provenance')
    for e in endpoints:
        if not str(e.get('url', '')).startswith('https://'):
            problems.append(f'endpoint url is not https: {e.get("url")}')
    return problems


def validate_baseball_fixtures(doc):
    problems = []
    fixtures = doc.get('fixtures', [])
    if not isinstance(fixtures, list):
        return ['baseball_fixtures.fixtures is not a list'], 0
    problems += _https_endpoints(doc)
    ids = [str(f.get('id')) for f in fixtures]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate fixture ids: {sorted(dups)}')
    for f in fixtures:
        for field in ('id', 'dateISO', 'startUtc', 'source'):
            if not f.get(field):
                problems.append(f'fixture {f.get("id")} missing "{field}"')
        for side in ('home', 'away'):
            if not (f.get(side) or {}).get('name'):
                problems.append(f'fixture {f.get("id")} missing {side}.name')
        # No key-less baseball price feed exists; a price here is a bug.
        if f.get('odds') is not None:
            problems.append(f'fixture {f.get("id")} carries an odds value; no key-less price feed exists')
    return problems, len(fixtures)


def _npb_common(doc, name):
    problems = []
    if doc.get('league') != 'npb':
        problems.append(f'{name}.league is not "npb"')
    if doc.get('mode') not in ('seed', 'live'):
        problems.append(f'{name}.mode must be "seed" or "live"')
    return problems


def validate_npb_fixtures(doc):
    problems = _npb_common(doc, 'npb_fixtures')
    fixtures = doc.get('fixtures', [])
    if not isinstance(fixtures, list):
        return ['npb_fixtures.fixtures is not a list'], 0
    ids = [str(f.get('id')) for f in fixtures]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate fixture ids: {sorted(dups)}')
    with_sp = 0
    for f in fixtures:
        for field in ('id', 'dateISO', 'status'):
            if not f.get(field):
                problems.append(f'fixture {f.get("id")} missing "{field}"')
        for side in ('home', 'away'):
            code = (f.get(side) or {}).get('code')
            if code not in NPB_CODES:
                problems.append(f'fixture {f.get("id")} {side}.code {code!r} is not an NPB club code')
        if f.get('odds') is not None:
            problems.append(f'fixture {f.get("id")} carries an odds value; no key-less three-way NPB feed exists')
        if f.get('roof') not in (None, 'dome', 'retractable', 'open'):
            problems.append(f'fixture {f.get("id")} roof {f.get("roof")!r} is not dome/retractable/open/null')
        sp = f.get('announcedStarters')
        if sp is not None:
            if not (isinstance(sp, dict) and sp.get('home') and sp.get('away')):
                problems.append(f'fixture {f.get("id")} announcedStarters must name both sides or be null')
            else:
                with_sp += 1
        if f.get('status') == 'final' and f.get('homeScore') is None:
            problems.append(f'fixture {f.get("id")} is final without a score')
    if doc.get('upcomingWithStarters') is not None and doc.get('upcomingWithStarters') > with_sp:
        problems.append('upcomingWithStarters exceeds the fixtures that actually carry starters')
    return problems, len(fixtures)


def validate_npb_tape(doc):
    problems = _npb_common(doc, 'npb_tape')
    games = doc.get('games', [])
    if not isinstance(games, list):
        return ['npb_tape.games is not a list'], 0
    draws = 0
    postponed = 0
    for g in games:
        if not g.get('id') or not g.get('dateISO'):
            problems.append(f'tape game {g.get("id")} missing id/dateISO')
        if g.get('home') not in NPB_CODES or g.get('away') not in NPB_CODES:
            problems.append(f'tape game {g.get("id")} has a non-NPB club code')
        if not str(g.get('url', '')).startswith('https://npb.jp/'):
            problems.append(f'tape game {g.get("id")} lacks an https://npb.jp review link')
        if g.get('postponed'):
            postponed += 1
            if g.get('homeScore') is not None:
                problems.append(f'tape game {g.get("id")} is postponed but carries a score')
            continue
        hs, as_ = g.get('homeScore'), g.get('awayScore')
        if not isinstance(hs, int) or not isinstance(as_, int):
            problems.append(f'tape game {g.get("id")} has a non-integer score')
            continue
        if (hs == as_) != bool(g.get('draw')):
            problems.append(f'tape game {g.get("id")} draw flag disagrees with the score {hs}-{as_}')
        if hs == as_:
            draws += 1
            if g.get('winner') is not None:
                problems.append(f'tape game {g.get("id")} is a draw but names a winner')
    if doc.get('count') != len(games):
        problems.append(f'npb_tape.count {doc.get("count")} != {len(games)} games')
    if doc.get('draws') != draws:
        problems.append(f'npb_tape.draws {doc.get("draws")} != {draws} level scores on tape')
    if doc.get('postponed') != postponed:
        problems.append(f'npb_tape.postponed {doc.get("postponed")} != {postponed}')
    return problems, len(games)


def validate_npb_standings(doc):
    problems = _npb_common(doc, 'npb_standings')
    n = 0
    for league in ('central', 'pacific'):
        block = doc.get(league)
        if not block:
            problems.append(f'npb_standings.{league} missing')
            continue
        if not str(block.get('source', '')).startswith('https://npb.jp/'):
            problems.append(f'npb_standings.{league} lacks an npb.jp source link')
        teams = block.get('teams') or []
        if len(teams) != 6:
            problems.append(f'npb_standings.{league} has {len(teams)} teams, expected 6')
        for t in teams:
            n += 1
            if t.get('code') not in NPB_CODES:
                problems.append(f'standings row {t.get("code")!r} is not an NPB club code')
            for k in ('wins', 'losses', 'ties'):
                if not isinstance(t.get(k), int):
                    problems.append(f'standings {t.get("code")} {k} is not an integer')
            w, l = t.get('wins') or 0, t.get('losses') or 0
            if w + l and t.get('pct') is not None and abs(t['pct'] - round(w / (w + l), 3)) > 0.001:
                problems.append(f'standings {t.get("code")} pct {t.get("pct")} does not match {w}-{l} (ties excluded)')
    return problems, n


def validate_npb_pitchers(doc):
    problems = _npb_common(doc, 'npb_pitchers')
    lines = doc.get('lines', [])
    if not isinstance(lines, list):
        return ['npb_pitchers.lines is not a list'], 0
    for ln in lines:
        if ln.get('team') not in NPB_CODES:
            problems.append(f'pitching line {ln.get("name")} has a non-NPB team code')
        if ln.get('role') not in ('starter', 'relief'):
            problems.append(f'pitching line {ln.get("name")} role {ln.get("role")!r}')
        if not str(ln.get('url', '')).startswith('https://npb.jp/'):
            problems.append(f'pitching line {ln.get("name")} lacks an npb.jp box link')
        for k in ('ip', 'er', 'r'):
            if not isinstance(ln.get(k), (int, float)):
                problems.append(f'pitching line {ln.get("name")} {k} missing')
    if doc.get('count') != len(lines):
        problems.append(f'npb_pitchers.count {doc.get("count")} != {len(lines)}')
    cov = doc.get('coverage') or {}
    if cov.get('pct') is not None and not (0 <= cov['pct'] <= 100):
        problems.append('npb_pitchers.coverage.pct out of range')
    return problems, len(lines)


def validate_npb_backtest(doc):
    problems = _npb_common(doc, 'npb_backtest')
    rows = doc.get('rows', [])
    if doc.get('games') != len(rows):
        problems.append(f'npb_backtest.games {doc.get("games")} != {len(rows)} rows')
    if 'strictly before the game' not in str(doc.get('method', '')):
        problems.append('npb_backtest.method must state the walk-forward rule')
    m = doc.get('markets') or {}
    win, rl, tot = m.get('win') or {}, m.get('runLine') or {}, m.get('total') or {}
    sk = doc.get('skipped') or {}
    if (win.get('n') or 0) + (sk.get('win') or 0) != len(rows):
        problems.append('win plays + skips != games')
    if (rl.get('n') or 0) + (sk.get('runLine') or 0) != len(rows):
        problems.append('run line plays + skips != games')
    if tot.get('ungradeable') != tot.get('n'):
        problems.append('game totals must be reported ungradeable (no posted line is archived)')
    for band, v in (doc.get('bands') or {}).items():
        if v.get('n') and v.get('hitRate') is not None and abs(v['hitRate'] - round(v['hits'] / v['n'], 4)) > 0.001:
            problems.append(f'band {band} hitRate does not match hits/n')
    for r in rows:
        if r.get('actual') not in ('home', 'away', 'draw'):
            problems.append(f'backtest row {r.get("id")} actual {r.get("actual")!r}')
        if r.get('win') and r['win'].get('pick') not in ('home', 'away', 'draw'):
            problems.append(f'backtest row {r.get("id")} win pick {r["win"].get("pick")!r}')
    return problems, len(rows)


def validate_npb_predictions(doc):
    problems = _npb_common(doc, 'npb_predictions')
    preds = doc.get('predictions', [])
    for p in preds:
        for mk in ('win', 'runLine', 'total'):
            conf = (p.get(mk) or {}).get('confidence')
            if conf not in ('HIGH', 'MEDIUM', 'LOW', 'SKIP'):
                problems.append(f'prediction {p.get("id")} {mk} confidence {conf!r}')
        if not isinstance((p.get('win') or {}).get('drawScore'), (int, float)):
            problems.append(f'prediction {p.get("id")} has no draw score — the draw must be assessed on every match')
        if not isinstance(p.get('missing'), list):
            problems.append(f'prediction {p.get("id")} missing[] absent')
    return problems, len(preds)


def validate_npb_provenance(doc):
    problems = _npb_common(doc, 'npb_provenance')
    for s in doc.get('sources') or []:
        if not str(s.get('url', '')).startswith('https://npb.jp/'):
            problems.append(f'provenance source {s.get("label")} is not an npb.jp page')
    for e in doc.get('endpoints') or []:
        if not str(e.get('url', '')).startswith('https://'):
            problems.append(f'endpoint {e.get("url")} is not https')
    irr = doc.get('irregularities') or []
    if doc.get('mode') == 'seed' and not any(i.get('id') == 'NPB-SEED' for i in irr):
        problems.append('seed-mode provenance must carry the NPB-SEED irregularity')
    for i in irr:
        if i.get('severity') not in ('info', 'low', 'medium', 'high'):
            problems.append(f'irregularity {i.get("id")} severity {i.get("severity")!r}')
    if not any('three-way' in str(x) for x in doc.get('notSourced') or []):
        problems.append('provenance must state that no three-way price was sourced')
    return problems, len(irr)


def validate_baseball_tape(doc):
    problems = []
    games = doc.get('games', [])
    if not isinstance(games, list):
        return ['baseball_tape.games is not a list'], 0
    problems += _https_endpoints(doc)
    for g in games:
        if not g.get('id') or not g.get('dateISO'):
            problems.append(f'tape game missing id/dateISO: {g.get("id")}')
        if g.get('phase') != 'results':
            problems.append(f'tape game {g.get("id")} is not a settled result')
        score = g.get('score') or {}
        if score.get('home') is None or score.get('away') is None:
            problems.append(f'tape game {g.get("id")} has no numeric score for both sides')
    return problems, len(games)


def validate_baseball_standings(doc):
    problems = []
    teams = doc.get('teams', {})
    if not isinstance(teams, dict):
        return ['baseball_standings.teams is not an object'], 0
    problems += _https_endpoints(doc)
    for tid, t in teams.items():
        if not isinstance(t, dict) or t.get('wins') is None or t.get('losses') is None:
            problems.append(f'standings team {tid} has no W-L record')
    return problems, len(teams)


def validate_baseball_team_stats(doc):
    problems = []
    teams = doc.get('teams', {})
    if not isinstance(teams, dict):
        return ['baseball_team_stats.teams is not an object'], 0
    problems += _https_endpoints(doc)
    for tid, t in teams.items():
        if not (t.get('hitting') or t.get('pitching')):
            problems.append(f'team stats entry {tid} has neither hitting nor pitching')
    return problems, len(teams)


def validate_baseball_pitchers(doc):
    problems = []
    pitchers = doc.get('pitchers', {})
    if not isinstance(pitchers, dict):
        return ['baseball_pitchers.pitchers is not an object'], 0
    for pid, p in pitchers.items():
        if not (p.get('id') or p.get('name')):
            problems.append(f'pitcher {pid} has no id or name')
    return problems, len(pitchers)


def validate_baseball_slate(doc):
    problems = []
    events = doc.get('events', [])
    if not isinstance(events, list):
        return ['baseball_slate.events is not a list'], 0
    if not doc.get('source', {}).get('url'):
        problems.append('baseball_slate.source.url missing')
    ids = [e.get('event_id') for e in events]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        problems.append(f'duplicate event_ids in baseball slate: {sorted(dups)}')
    for e in events:
        for field in ('event_id', 'home', 'away', 'url'):
            if not e.get(field):
                problems.append(f'baseball slate row {e.get("event_id")} missing "{field}"')
        if not str(e.get('url', '')).startswith('https://www.olbg.com/betting-tips/Baseball/'):
            problems.append(f'baseball slate row {e.get("event_id")} url is not the OLBG baseball index')
        # OLBG publishes tipster consensus, never a price. A price here is a bug.
        if e.get('odds') is not None:
            problems.append(f'baseball slate row {e.get("event_id")} carries an odds value; OLBG publishes none')
    return problems, len(events)


def validate_baseball_backtest(doc):
    problems = []
    results = doc.get('results', {})
    if not results:
        problems.append('baseball_backtest has no results block')
    for market in ('run_line', 'game_total'):
        if results.get(market, {}).get('graded', 0) == 0 and not results.get(market, {}).get('reason'):
            problems.append(f'baseball_backtest.{market} is ungraded without saying why')
    if results.get('roi') is None and not results.get('roi_reason'):
        problems.append('baseball_backtest reports no ROI without saying why')
    if not doc.get('method'):
        problems.append('baseball_backtest does not state its method')
    return problems, results.get('graded', 0)


def report(name, problems, count=0):
    status = 'OK' if not problems else 'PROBLEMS'
    print(f'  [{status:8}] {name}')
    for p in problems:
        print(f'              ! {p}')
    return len(problems)


def main():
    strict = '--strict' in sys.argv
    total = 0

    print('SportsPred Data Validation')
    print('=' * 65)

    # Tennis Validation
    print('--- Tennis Data Layer ---')
    slate = load(SLATE)
    if slate is None:
        print('  [MISSING] data/slate.json'); total += 1
    else:
        problems, n = validate_slate(slate)
        total += report('data/slate.json', problems, n)
        print(f'              {n} matches, {len(slate.get("outrights", []))} outrights, '
              f'fetched {slate.get("source", {}).get("fetched_at_utc")}')

    players = load(PLAYERS)
    if players is None:
        print('  [MISSING] data/players.json'); total += 1
    else:
        problems, n = validate_players(players)
        total += report('data/players.json', problems, n)
        print(f'              {n} player records')

    surfaces = load(SURFACES)
    if surfaces is None:
        print('  [MISSING] data/surfaces.json'); total += 1
    else:
        problems, n = validate_surfaces(surfaces)
        total += report('data/surfaces.json', problems, n)
        rows = sum(f.get('rows', 0) for f in surfaces.get('files_used', []))
        print(f'              {n} tournaments resolved from {rows} source match rows')

    for name, path in [('data/predictions.json', PREDICTIONS),
                       ('data/results.json', RESULTS),
                       ('data/provenance.json', PROVENANCE)]:
        blob = load(path)
        if blob is None:
            print(f'  [MISSING] {name}'); total += 1
        else:
            total += report(name, [], 0)

    # Handball Validation
    print('\n--- Handball Data Layer ---')
    hb_slate = load(HANDBALL_SLATE)
    if hb_slate is None:
        print('  [MISSING] data/handball_slate.json'); total += 1
    else:
        problems, n = validate_handball_slate(hb_slate)
        total += report('data/handball_slate.json', problems, n)
        print(f'              {n} verified handball match events')

    hb_teams = load(HANDBALL_TEAMS)
    if hb_teams is None:
        print('  [MISSING] data/handball_teams.json'); total += 1
    else:
        problems, n = validate_handball_teams(hb_teams)
        total += report('data/handball_teams.json', problems, n)
        print(f'              {n} verified handball team profiles')

    hb_matches = load(HANDBALL_MATCHES)
    if hb_matches is None:
        print('  [MISSING] data/handball_matches.json'); total += 1
    else:
        problems, n = validate_handball_matches(hb_matches)
        total += report('data/handball_matches.json', problems, n)
        print(f'              {n} scheduled/finished handball matches')

    for name, path in [('data/handball_provenance.json', HANDBALL_PROVENANCE),
                       ('data/handball_predictions.json', HANDBALL_PREDICTIONS)]:
        blob = load(path)
        if blob is None:
            print(f'  [MISSING] {name}'); total += 1
        else:
            total += report(name, [], 0)

    # Formula 1 Validation (optional until first collection; a missing file is
    # not an error — it is reported so the deploy/PR log shows the gap).
    print('\n--- Formula 1 Data Layer ---')
    f1_names = [('data/f1_events.json', F1_EVENTS, validate_f1_events),
                ('data/f1_standings.json', F1_STANDINGS, validate_f1_standings),
                ('data/f1_slate.json', F1_SLATE, validate_f1_slate),
                ('data/f1_weather.json', F1_WEATHER, None),
                ('data/f1_provenance.json', F1_PROVENANCE, None),
                ('data/f1_predictions.json', F1_PREDICTIONS, None),
                ('data/olbg_sports.json', OLBG_SPORTS, None)]
    for name, path, fn in f1_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the scheduled F1 collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
        else:
            total += report(name, [], 0)

    # Golf Validation (optional until first collection; a missing file is
    # reported, not failed, so the deploy log shows the gap).
    print('\n--- Golf Data Layer ---')
    golf_names = [('data/golf_events.json', GOLF_EVENTS, validate_golf_events),
                  ('data/golf_results.json', GOLF_RESULTS, validate_golf_results),
                  ('data/golf_rankings.json', GOLF_RANKINGS, validate_golf_rankings),
                  ('data/golf_slate.json', GOLF_SLATE, validate_golf_slate),
                  ('data/golf_stats.json', GOLF_STATS, None),
                  ('data/golf_weather.json', GOLF_WEATHER, None),
                  ('data/golf_provenance.json', GOLF_PROVENANCE, None),
                  ('data/golf_backtest.json', GOLF_BACKTEST, None),
                  ('data/golf_predictions.json', GOLF_PREDICTIONS, None)]
    for name, path, fn in golf_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the scheduled golf collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
        else:
            total += report(name, [], 0)

    # Greyhound Validation (official GBGB data; populated by the greyhound collector)
    print('\n--- Greyhound Data Layer ---')
    gh_names = [('data/greyhound_meetings.json', GREYHOUND_MEETINGS, validate_greyhound_meetings),
                ('data/greyhound_history.json', GREYHOUND_HISTORY, validate_greyhound_history),
                ('data/greyhound_slate.json', GREYHOUND_SLATE, validate_greyhound_slate),
                ('data/greyhound_provenance.json', GREYHOUND_PROVENANCE, None),
                ('data/greyhound_backtest.json', GREYHOUND_BACKTEST, None),
                ('data/greyhound_predictions.json', GREYHOUND_PREDICTIONS, None)]
    for name, path, fn in gh_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the scheduled greyhound collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
        else:
            total += report(name, [], 0)

    # Snooker Validation (source-linked taper + official ranking snapshot;
    # populated by the snooker collectors and the record script)
    print('\n--- Snooker Data Layer ---')
    sn_names = [('data/snooker_slate.json', SNOOKER_SLATE, validate_snooker_slate),
                ('data/snooker_results.json', SNOOKER_RESULTS, validate_snooker_results),
                ('data/snooker_rankings.json', SNOOKER_RANKINGS, validate_snooker_rankings),
                ('data/snooker_provenance.json', SNOOKER_PROVENANCE, None),
                ('data/snooker_predictions.json', SNOOKER_PREDICTIONS, None),
                ('data/snooker_backtest.json', SNOOKER_BACKTEST, None)]
    for name, path, fn in sn_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the scheduled snooker collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
        else:
            total += report(name, [], 0)

    print('\n--- Volleyball Data Layer ---')
    vb_names = [('data/volleyball_slate.json', VOLLEYBALL_SLATE, validate_volleyball_slate),
                ('data/volleyball_tape.json', VOLLEYBALL_TAPE, validate_volleyball_tape),
                ('data/volleyball_matches.json', VOLLEYBALL_MATCHES, validate_volleyball_matches),
                ('data/volleyball_provenance.json', VOLLEYBALL_PROVENANCE, None),
                ('data/volleyball_predictions.json', VOLLEYBALL_PREDICTIONS, None),
                ('data/volleyball_backtest.json', VOLLEYBALL_BACKTEST, None)]
    for name, path, fn in vb_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the volleyball collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
        else:
            total += report(name, [], 0)

    print('\n--- Rugby League Data Layer ---')
    rl_names = [('data/rugby_league_slate.json', RUGBY_SLATE, validate_rugby_slate),
                ('data/rugby_league_teams.json', RUGBY_TEAMS, validate_rugby_teams),
                ('data/rugby_league_matches.json', RUGBY_MATCHES, validate_rugby_matches),
                ('data/rugby_league_provenance.json', RUGBY_PROVENANCE, None),
                ('data/rugby_league_predictions.json', RUGBY_PREDICTIONS, None),
                ('data/rugby_league_backtest.json', RUGBY_BACKTEST, None),
                ('data/rugby_league_weather.json', RUGBY_WEATHER, None)]
    for name, path, fn in rl_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the rugby league collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
            if n:
                print(f'              {n} records')
        else:
            total += report(name, [], 0)

    print('\n--- NRL Data Layer (nrl.html, NRL Master Prompt v1.0) ---')
    nrl_names = [('data/nrl_matches.json', NRL_MATCHES, validate_nrl_matches),
                 ('data/nrl_teams.json', NRL_TEAMS, validate_nrl_teams),
                 ('data/nrl_slate.json', NRL_SLATE, validate_nrl_slate),
                 ('data/nrl_weather.json', NRL_WEATHER, validate_nrl_weather),
                 ('data/nrl_origin.json', NRL_ORIGIN, validate_nrl_origin),
                 ('data/nrl_provenance.json', NRL_PROVENANCE, validate_nrl_provenance),
                 ('data/nrl_predictions.json', NRL_PREDICTIONS, validate_nrl_predictions),
                 ('data/nrl_backtest.json', NRL_BACKTEST, validate_nrl_backtest)]
    for name, path, fn in nrl_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the NRL collector)')
            continue
        problems, n = fn(blob)
        total += report(name, problems, n)
        if n:
            print(f'              {n} records')

    print('\n--- Ice Hockey Data Layer ---')
    ih_names = [
        ('data/ice_hockey_fixtures.json', os.path.join(DATA, 'ice_hockey_fixtures.json'), validate_ice_hockey_fixtures),
        ('data/ice_hockey_slate.json', os.path.join(DATA, 'ice_hockey_slate.json'), validate_ice_hockey_slate),
        ('data/ice_hockey_provenance.json', os.path.join(DATA, 'ice_hockey_provenance.json'), validate_ice_hockey_provenance),
        ('data/ice_hockey_backtest.json', os.path.join(DATA, 'ice_hockey_backtest.json'), validate_ice_hockey_backtest),
        ('data/ice_hockey_standings.json', os.path.join(DATA, 'ice_hockey_standings.json'), None),
        ('data/ice_hockey_tape.json', os.path.join(DATA, 'ice_hockey_tape.json'), None),
        ('data/ice_hockey_goalies.json', os.path.join(DATA, 'ice_hockey_goalies.json'), None),
        ('data/ice_hockey_injuries.json', os.path.join(DATA, 'ice_hockey_injuries.json'), None),
        ('data/ice_hockey_predictions.json', os.path.join(DATA, 'ice_hockey_predictions.json'), None),
    ]
    for name, path, fn in ih_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the ice hockey collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
            if n:
                print(f'              {n} records')
        else:
            empty = not (blob.get('teams') or blob.get('games') or blob.get('byTeam') or blob.get('picks'))
            total += report(name, [], 0)
            if empty:
                print('              empty by design: the engine records those factors as missing')

    print('\n--- Baseball Data Layer ---')
    bb_names = [
        ('data/baseball_fixtures.json', BASEBALL_FIXTURES, validate_baseball_fixtures),
        ('data/baseball_tape.json', BASEBALL_TAPE, validate_baseball_tape),
        ('data/baseball_standings.json', BASEBALL_STANDINGS, validate_baseball_standings),
        ('data/baseball_team_stats.json', BASEBALL_TEAM_STATS, validate_baseball_team_stats),
        ('data/baseball_pitchers.json', BASEBALL_PITCHERS, validate_baseball_pitchers),
        ('data/baseball_slate.json', BASEBALL_SLATE, validate_baseball_slate),
        ('data/baseball_backtest.json', BASEBALL_BACKTEST, validate_baseball_backtest),
        ('data/baseball_provenance.json', BASEBALL_PROVENANCE, validate_baseball_provenance),
        ('data/baseball_predictions.json', BASEBALL_PREDICTIONS, None),
    ]
    for name, path, fn in bb_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the baseball collector)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
            if n:
                print(f'              {n} records')
        else:
            total += report(name, [], 0)

    print('\n--- NPB Data Layer (Baseball sub-page) ---')
    npb_names = [
        ('data/npb_fixtures.json', NPB_FIXTURES, validate_npb_fixtures),
        ('data/npb_tape.json', NPB_TAPE, validate_npb_tape),
        ('data/npb_standings.json', NPB_STANDINGS, validate_npb_standings),
        ('data/npb_pitchers.json', NPB_PITCHERS, validate_npb_pitchers),
        ('data/npb_backtest.json', NPB_BACKTEST, validate_npb_backtest),
        ('data/npb_predictions.json', NPB_PREDICTIONS, validate_npb_predictions),
        ('data/npb_provenance.json', NPB_PROVENANCE, validate_npb_provenance),
    ]
    for name, path, fn in npb_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (seed with scripts/build_npb_seed.mjs or the NPB collector)')
            continue
        problems, n = fn(blob)
        total += report(name, problems, n)
        if n:
            print(f'              {n} records' + (' · mode=' + str(blob.get('mode')) if blob.get('mode') else ''))

    print('\n--- GAA Data Layer ---')
    gaa_names = [
        ('data/gaa_slate.json', GAA_SLATE, validate_gaa_slate),
        ('data/gaa_hurling_slate.json', GAA_HURLING_SLATE, validate_gaa_slate),
        ('data/gaa_results.json', GAA_RESULTS, validate_gaa_results),
        ('data/gaa_rankings.json', GAA_RANKINGS, validate_gaa_rankings),
        ('data/gaa_provenance.json', GAA_PROVENANCE, None),
        ('data/gaa_predictions.json', GAA_PREDICTIONS, None),
        ('data/gaa_backtest.json', GAA_BACKTEST, None),
    ]
    for name, path, fn in gaa_names:
        blob = load(path)
        if blob is None:
            print(f'  [PENDING] {name} (populated by the GAA collector / backtest)')
            continue
        if fn:
            problems, n = fn(blob)
            total += report(name, problems, n)
            if n:
                print(f'              {n} records')
        else:
            total += report(name, [], 0)

    print('=' * 65)
    if total:
        print(f'Validation failed with {total} problem(s).')
        return 1 if strict else 0
    print('All committed data files are well-formed, complete, and provenance-verified.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
