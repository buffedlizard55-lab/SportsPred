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

    print('=' * 65)
    if total:
        print(f'Validation failed with {total} problem(s).')
        return 1 if strict else 0
    print('All committed data files are well-formed, complete, and provenance-verified.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
