#!/usr/bin/env python3
"""Collect the current OLBG Volleyball slate into data/volleyball_slate.json."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.olbg_page_health import diagnose  # noqa: E402
from lib.volleyball_olbg_parse import (  # noqa: E402
    parse_volleyball_index,
    resolve_volleyball_date,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'volleyball_slate.json')

INDEX_URLS = [
    'https://www.olbg.com/betting-tips/Volleyball/21',
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


def build_payload(events: list[dict], now: datetime, warnings: list[str],
                  page_health: list[dict] | None = None) -> dict:
    return {
        'schema_version': 1,
        'sport': 'Volleyball',
        'source': {
            'name': 'OLBG — Volleyball Betting Tips',
            'url': INDEX_URLS[0],
            'indexes': INDEX_URLS,
            'fetched_at_utc': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'method': 'Verified HTTP fetch of public OLBG Volleyball slate',
            'licence_note': 'Publicly available event listing for factual review.',
        },
        'markets_covered': ['Win Match', 'Set Score'],
        'notes': [
            'Only Win Match and Set Score are scored by the volleyball engine.',
            'OLBG Total Points and Points Handicap are review-only.',
            'Display times are not used to place matches on the calendar (U-02 / IR-VB-06).',
        ],
        'collection_warnings': warnings,
        'page_health': page_health or [],
        'events': events,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--from-file', help='Parse local file instead of network')
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    events_map = {}
    warnings = []
    page_health = []

    if args.from_file:
        with open(args.from_file, 'r', encoding='utf-8') as fh:
            content = fh.read()
        parsed = parse_volleyball_index(content)
        for ev in parsed:
            events_map[ev['event_id']] = ev
        health = diagnose(content, event_count=len(parsed), sport='Volleyball')
        page_health.append({'url': args.from_file, **health})
        warnings.extend(health['warnings'])
    else:
        for url in INDEX_URLS:
            try:
                html = fetch(url)
                parsed = parse_volleyball_index(html)
                for ev in parsed:
                    events_map[ev['event_id']] = ev
                # A successful fetch that yields no rows is ambiguous on its own:
                # a bot-block, a cookie wall and a real off-season all parse to
                # nothing. Record which of those the delivered bytes show.
                health = diagnose(html, event_count=len(parsed), sport='Volleyball')
                page_health.append({'url': url, **health})
                warnings.extend(f'{url}: {w}' for w in health['warnings'])
            except (HTTPError, URLError, OSError) as e:
                warnings.append(f'{url}: {e}')
                page_health.append({'url': url, 'status': 'fetch-failed',
                                    'healthy': False, 'evidence': {'error': str(e)}})

    events = list(events_map.values())
    for ev in events:
        resolved_date, basis = resolve_volleyball_date(ev.get('display_date'), now)
        ev['resolved_date'] = resolved_date
        ev['date_basis'] = basis

    payload = build_payload(events, now, warnings, page_health)

    if args.dry_run:
        print(f'Parsed {len(events)} volleyball events.')
        for ev in events[:5]:
            print(f"  {ev['event_id']}: {ev['home']} v {ev['away']} ({ev.get('resolved_date')})")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write('\n')

    print(f'Wrote {len(events)} Volleyball events to {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
