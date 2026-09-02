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

# Handball files
HANDBALL_SLATE = os.path.join(DATA, 'handball_slate.json')
HANDBALL_TEAMS = os.path.join(DATA, 'handball_teams.json')
HANDBALL_MATCHES = os.path.join(DATA, 'handball_matches.json')
HANDBALL_PROVENANCE = os.path.join(DATA, 'handball_provenance.json')
HANDBALL_PREDICTIONS = os.path.join(DATA, 'handball_predictions.json')

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

    print('=' * 65)
    if total:
        print(f'Validation failed with {total} problem(s).')
        return 1 if strict else 0
    print('All committed data files are well-formed, complete, and provenance-verified.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
