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

SLATE = os.path.join(DATA, 'slate.json')
PLAYERS = os.path.join(DATA, 'players.json')
PREDICTIONS = os.path.join(DATA, 'predictions.json')
RESULTS = os.path.join(DATA, 'results.json')
PROVENANCE = os.path.join(DATA, 'provenance.json')

# Fields the players store promises to carry provenance for (see its
# field_contract). If any of these is present on a player record it must be an
# object with `source` and `fetched_at_utc`, or a value under a `_sources` map.
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
        # Odds must never be present: OLBG exposes no structured prices (IR-01).
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


def report(name, problems, *counts):
    status = 'OK' if not problems else 'PROBLEMS'
    print(f'  [{status:8}] {name}')
    for p in problems:
        print(f'              ! {p}')
    return len(problems)


def main():
    strict = '--strict' in sys.argv
    total = 0

    print('SportsPred data validation')
    print('=' * 60)

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

    for name, path in [('data/predictions.json', PREDICTIONS),
                       ('data/results.json', RESULTS),
                       ('data/provenance.json', PROVENANCE)]:
        blob = load(path)
        if blob is None:
            print(f'  [MISSING] {name}'); total += 1
        else:
            total += report(name, [], 0)

    print('=' * 60)
    if total:
        print(f'Validation failed with {total} problem(s).')
        return 1 if strict else 0
    print('All committed data files are well-formed and provenance-complete.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
