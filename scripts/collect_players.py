#!/usr/bin/env python3
"""
Collect player statistics into data/players.json.

THE RULE THIS SCRIPT IS BUILT AROUND: a field is only written if it has a
source URL and a fetch timestamp attached to it. There is no code path that
produces a statistic from a model, a default, or a plausible guess.

Current status (verified 2026-08-31): no free, structured, machine-readable
source for *current* live statistics has been confirmed reachable — the ATP/WTA
ranking pages are client-side rendered and the OLBG pages expose no odds. Each
live adapter below therefore declares its verification state, and an unverified
adapter contributes nothing.

Verified **historical** mirrors of the Sackmann dataset exist
(`Kadantte/tennis_atp`, `Aneeshers/tennis-sackmann-archive`) and are consumed by
`scripts/backtest_historical.mjs` — but they are snapshots (matches through
2026-05-25), so they are deliberately NOT used to fill the live slate. See
`HISTORICAL_SOURCES` below and docs/IRREGULARITIES.md IR-02 / IR-14.

    python3 scripts/collect_players.py --players "Carlos Alcaraz" --dry-run
    python3 scripts/collect_players.py --from-slate      # everyone on the card
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'players.json')
SLATE = os.path.join(ROOT, 'data', 'slate.json')

USER_AGENT = ('Mozilla/5.0 (compatible; SportsPredCollector/1.0; '
              '+https://github.com/buffedlizard55-lab/SportsPred)')
TIMEOUT = 25

# Each adapter: name -> (verified, description, fetch function)
# `verified` means a response was actually observed from this environment.
# An unverified adapter is never executed by default.
ADAPTERS = {
    'atp_rankings': {
        'verified': False,
        'source': 'https://www.atptour.com/en/rankings/singles',
        'provides': ['rank'],
        'note': 'Official. Not reachable from this sandbox (all outbound requests failed). '
                'Page is JavaScript-assisted; the rankings table may need the embedded data endpoint.',
    },
    'wta_rankings': {
        'verified': False,
        'source': 'https://www.wtatennis.com/rankings/singles',
        'provides': ['rank'],
        'note': 'Official. Same reachability caveat as atp_rankings.',
    },
    'sackmann_atp': {
        'verified': False,
        'source': 'https://github.com/JeffSackmann/tennis_atp',
        'provides': ['form.last5', 'form.straightSetsLast3', 'surface.*', 'serve.*', 'h2h'],
        'note': 'BLOCKED. Returns 404 (re-verified 2026-08-31). A GitHub API query for this user '
                'returned exactly one public repository (tennis_MatchChartingProject). Verified '
                'forks/archives of the dataset exist — see HISTORICAL_SOURCES — but they are '
                'snapshots, not a live feed, so they are not used to fill the live slate. See IR-02.',
    },
    'odds_aggregator': {
        'verified': False,
        'source': 'an odds aggregator API (The Odds API, Betfair Exchange, etc.)',
        'provides': ['odds', 'firstSetOdds', 'handicapOdds'],
        'note': 'BLOCKED by the no-API-key constraint. OLBG itself publishes no structured prices '
                '(IR-01). Without this, every odds-dependent factor stays unscored.',
    },
    'injury_reporting': {
        'verified': False,
        'source': 'none identified',
        'provides': ['rest.physicalConcernCited'],
        'note': 'No free structured source exists. Would require parsing tournament press releases. '
                'Left unset rather than inferred from match withdrawals.',
    },
    'social_sentiment': {
        'verified': False,
        'source': 'none',
        'provides': [],
        'note': 'Deliberately not implemented. X requires paid API access and scraping it breaches '
                'its terms. The prompt asks for this; it is excluded rather than faked. IR-13.',
    },
}


# Verified historical mirrors of the Sackmann dataset. Reachable via the GitHub
# API (verified 2026-08-31). Used by scripts/backtest_historical.mjs for the
# walk-forward backtest. NOT used for the live slate: they are snapshots whose
# data ends 2026-05-25 (matches) / 2026-06-08 (rankings), so they cannot
# honestly supply "current" form or ranking. See docs/IRREGULARITIES.md IR-14.
HISTORICAL_SOURCES = {
    'sackmann_mirror_atp': {
        'verified': True,
        'source': 'https://github.com/Kadantte/tennis_atp',
        'provides': ['historical ATP matches 1968-2026 (through 2026-05-25)',
                     'historical rankings (through 2026-06-08)'],
        'note': 'Fork of the deleted JeffSackmann/tennis_atp. CC BY-NC-SA 4.0 (attribution '
                'Jeff Sackmann). atp_players.csv is empty in this fork; matches carry '
                'winner_rank/loser_rank directly. Consumed by backtest_historical.mjs.',
    },
    'sackmann_mirror_atp_wta': {
        'verified': True,
        'source': 'https://github.com/Aneeshers/tennis-sackmann-archive',
        'provides': ['historical ATP + WTA matches and rankings (through 2026-05-25 / 2026-06-08)'],
        'note': 'Archival mirror of Sackmann datasets incl. WTA, with the original CC BY-NC-SA 4.0 '
                'LICENSE. 473 files. Not yet wired into the backtest (ATP-only for now).',
    },
}


def fetch(url: str) -> str:
    req = Request(url, headers={'User-Agent': USER_AGENT})
    with urlopen(req, timeout=TIMEOUT) as resp:
        charset = resp.headers.get_content_charset() or 'utf-8'
        return resp.read().decode(charset, errors='replace')


def load_players():
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as fh:
            return json.load(fh)
    return {'schema_version': 1, 'players': {}, 'h2h': {}}


def slate_player_names():
    if not os.path.exists(SLATE):
        return []
    with open(SLATE, encoding='utf-8') as fh:
        slate = json.load(fh)
    names = []
    for ev in slate.get('events', []):
        names.extend([ev.get('home'), ev.get('away')])
    return [n for n in names if n]


def probe(url: str) -> tuple[bool, str]:
    """Check reachability without parsing. Never raises."""
    try:
        body = fetch(url)
        return True, f'HTTP 200, {len(body)} bytes'
    except (HTTPError, URLError, OSError) as exc:
        return False, str(exc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--players', nargs='*', help='player names to collect')
    ap.add_argument('--from-slate', action='store_true', help='collect for everyone on the current card')
    ap.add_argument('--dry-run', action='store_true', help='report adapter status without writing')
    ap.add_argument('--probe', action='store_true', help='test reachability of each declared source')
    args = ap.parse_args()

    print('Player statistics collector')
    print('=' * 70)
    for name, spec in ADAPTERS.items():
        flag = 'VERIFIED' if spec['verified'] else 'NOT VERIFIED'
        print(f'[{flag:12}] {name}')
        print(f'               source:   {spec["source"]}')
        if spec['provides']:
            print(f'               provides: {", ".join(spec["provides"])}')
        print(f'               {spec["note"]}')
        print()

    print('Verified historical sources (backtest only, not the live slate):')
    for name, spec in HISTORICAL_SOURCES.items():
        flag = 'VERIFIED' if spec['verified'] else 'NOT VERIFIED'
        print(f'[{flag:12}] {name}')
        print(f'               source:   {spec["source"]}')
        print(f'               provides: {", ".join(spec["provides"])}')
        print(f'               {spec["note"]}')
        print()

    if args.probe:
        print('Probing declared sources…')
        for name, spec in ADAPTERS.items():
            if not spec['source'].startswith('http'):
                print(f'  {name}: skipped (no URL)')
                continue
            ok, detail = probe(spec['source'])
            print(f'  {name}: {"REACHABLE" if ok else "UNREACHABLE"} — {detail}')
        return 0

    wanted = args.players or (slate_player_names() if args.from_slate else [])
    if not wanted:
        print('No players requested. Use --from-slate or --players.')
        return 0

    available = [n for n, s in ADAPTERS.items() if s['verified'] and s['provides']]
    if not available:
        print('\nNo verified adapter can supply any statistic.')
        print('Refusing to write estimated values. data/players.json is left unchanged.')
        print('\nTo unblock, at least one of these must become reachable:')
        for name, spec in ADAPTERS.items():
            if spec['provides']:
                print(f'  - {name}: {spec["source"]}')
        return 2

    # Only reached when at least one adapter is verified.
    store = load_players()
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    for name in wanted:
        key = name.lower().strip()
        record = store['players'].setdefault(key, {})
        record.setdefault('_sources', {})
        record['_sources']['updated_at_utc'] = now
    store['generated_at_utc'] = now

    if args.dry_run:
        print(f'\nDry run: would touch {len(wanted)} player records.')
        return 0

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(store, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'Wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
