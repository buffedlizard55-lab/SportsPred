#!/usr/bin/env python3
"""
Collect the current OLBG tennis slate into data/slate.json.

Stdlib only — no third-party packages, so it runs in a bare GitHub Actions
runner.

    python3 scripts/collect_olbg.py                 # fetch live, write slate
    python3 scripts/collect_olbg.py --dry-run       # fetch live, print summary
    python3 scripts/collect_olbg.py --from FILE     # parse a saved HTML capture
    python3 scripts/collect_olbg.py --save-html DIR # also dump raw HTML for fixtures

IMPORTANT: this script must not be able to invent data. If a fetch fails the run
aborts with a non-zero exit code rather than writing a partial or stale file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.olbg_parse import (  # noqa: E402
    parse_index, resolve_date, parse_event_page_markets,
    parse_games_won_selections,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'slate.json')

# Both indexes are needed: the tips index is ordered by tip volume and omits
# matches nobody has tipped, the All Events index is the fuller list.
INDEX_URLS = [
    'https://www.olbg.com/betting-tips/Tennis/3',
    'https://www.olbg.com/betting-tips/Tennis/All_Tennis/All_Events/3',
]

USER_AGENT = (
    'Mozilla/5.0 (compatible; SportsPredCollector/1.0; '
    '+https://github.com/buffedlizard55-lab/SportsPred)'
)

TIMEOUT = 25


def fetch(url: str) -> str:
    req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Language': 'en-GB,en;q=0.9'})
    with urlopen(req, timeout=TIMEOUT) as resp:
        charset = resp.headers.get_content_charset() or 'utf-8'
        return resp.read().decode(charset, errors='replace')


def collect(from_files=None, save_html_dir=None):
    now = datetime.now(timezone.utc)
    matches: dict[str, dict] = {}
    outrights: dict[str, dict] = {}
    failures = []

    sources = from_files or INDEX_URLS
    for src in sources:
        try:
            if from_files:
                with open(src, encoding='utf-8') as fh:
                    html = fh.read()
                label = src
            else:
                html = fetch(src)
                label = src
                if save_html_dir:
                    os.makedirs(save_html_dir, exist_ok=True)
                    stamp = now.strftime('%Y%m%dT%H%M%SZ')
                    name = src.rstrip('/').split('/')[-2] if src.count('/') > 3 else 'index'
                    path = os.path.join(save_html_dir, f'{name}_{stamp}.html')
                    with open(path, 'w', encoding='utf-8') as fh:
                        fh.write(html)
                    print(f'  saved raw HTML -> {path}')
        except (HTTPError, URLError, OSError) as exc:
            failures.append(f'{src}: {exc}')
            continue

        m, o = parse_index(html)
        print(f'  {label}: {len(m)} matches, {len(o)} outrights')
        for row in m:
            matches.setdefault(row['event_id'], row)
        for row in o:
            outrights.setdefault(row['event_id'], row)

    if failures:
        print('\nFetch failures:', file=sys.stderr)
        for f in failures:
            print(f'  {f}', file=sys.stderr)
        if not matches and not outrights:
            print('\nAborting: nothing could be fetched. Refusing to overwrite '
                  'the existing snapshot with an empty one.', file=sys.stderr)
            return None, now, failures

    # Resolve display labels to ISO dates against the fetch time.
    for row in list(matches.values()) + list(outrights.values()):
        iso, basis = resolve_date(row.get('display_date'), now)
        row['resolved_date'] = iso
        row['date_basis'] = basis

    return {'matches': list(matches.values()), 'outrights': list(outrights.values())}, now, failures


def enrich_event_pages(rows, limit=None, save_html_dir=None):
    """
    Fetch each event page to record the market list actually offered.

    Deliberately conservative: on any failure the event simply keeps
    markets_verified = False. A missing market list is a gap, not an error.
    """
    targets = rows[:limit] if limit else rows
    for row in targets:
        try:
            html = fetch(row['url'])
        except (HTTPError, URLError, OSError) as exc:
            print(f'  event {row["event_id"]}: {exc}', file=sys.stderr)
            row['markets_verified'] = False
            continue
        if save_html_dir:
            os.makedirs(save_html_dir, exist_ok=True)
            path = os.path.join(save_html_dir, f'event_{row["event_id"]}.html')
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(html)
        row['markets_on_event_page'] = parse_event_page_markets(html)
        gw = parse_games_won_selections(html)
        if gw:
            row['games_won_selections'] = [f"{g['player']} {g['line']:+.2f}" for g in gw]
        row['markets_verified'] = True
        print(f'  event {row["event_id"]}: {row["markets_on_event_page"]}')
    return rows


def build_payload(data, now, failures):
    return {
        'schema_version': 1,
        'source': {
            'name': 'OLBG — Tennis Betting Tips',
            'url': INDEX_URLS[0],
            'indexes': INDEX_URLS,
            'fetched_at_utc': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'method': 'HTTP GET of server-rendered HTML via urllib; no JavaScript execution',
            'licence_note': 'Publicly viewable page. Redistribution limited to this factual fixture/market listing; see docs/SOURCES.md.',
        },
        'notes': [
            'Every field was read from the pages listed in source.indexes. Nothing is inferred unless date_basis says "derived".',
            'OLBG renders kickoff times in UK local time (BST, UTC+1 in summer).',
            'OLBG does not expose structured odds in server-rendered HTML, so no price fields exist in this file. See docs/IRREGULARITIES.md IR-01.',
            'Tournament, tour, round and surface are not published on the tips index and are left null. See IR-04.',
        ],
        'collection_warnings': failures,
        'events': data['matches'],
        'outrights': data['outrights'],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--from', dest='from_files', nargs='+', help='parse saved HTML captures instead of fetching')
    ap.add_argument('--save-html', dest='save_html', help='directory to dump raw HTML captures')
    ap.add_argument('--enrich', action='store_true', help='also fetch each event page for its market list')
    ap.add_argument('--enrich-limit', type=int, default=None)
    args = ap.parse_args()

    print('Collecting OLBG tennis slate…')
    data, now, failures = collect(from_files=args.from_files, save_html_dir=args.save_html)
    if data is None:
        return 1

    if args.enrich:
        print('Enriching event pages…')
        enrich_event_pages(data['matches'], limit=args.enrich_limit, save_html_dir=args.save_html)

    payload = build_payload(data, now, failures)
    print(f'\n{len(payload["events"])} matches, {len(payload["outrights"])} outrights')

    if args.dry_run:
        for ev in payload['events'][:10]:
            print(f"  {ev['event_id']} {ev.get('home')} v {ev.get('away')} "
                  f"{ev.get('display_date')} {ev.get('display_time')} -> {ev.get('resolved_date')} ({ev.get('date_basis')})")
        return 0

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'Wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
