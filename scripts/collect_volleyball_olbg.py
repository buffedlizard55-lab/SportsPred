#!/usr/bin/env python3
"""Collect the openly rendered OLBG Volleyball market board.

The collector has two stages: index discovery, then per-event verification.
Only event-page market headings are labelled as verified. OLBG's tipster votes
are stored as display context and are never treated as prices or model input.
A failed fetch leaves the committed snapshot untouched.
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
from lib.volleyball_olbg_parse import parse_volleyball_event_page, parse_volleyball_index, resolve_volleyball_date  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'volleyball_slate.json')
INDEX_URL = 'https://www.olbg.com/betting-tips/Volleyball/21'
USER_AGENT = 'Mozilla/5.0 (compatible; SportsPredCollector/2.0; +https://github.com/buffedlizard55-lab/SportsPred)'
TIMEOUT = 25


def fetch(url: str) -> str:
    request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Language': 'en-GB,en;q=0.9'})
    with urlopen(request, timeout=TIMEOUT) as response:
        charset = response.headers.get_content_charset() or 'utf-8'
        return response.read().decode(charset, errors='replace')


def build_payload(events: list[dict], now: datetime, warnings: list[str]) -> dict:
    verified = sorted({name for event in events if event.get('markets_verified') for name in event.get('markets_available', [])})
    return {
        'schema_version': 2,
        'sport': 'Volleyball',
        'scope': 'All openly rendered OLBG Volleyball events; display-only market monitor.',
        'source': {
            'name': 'OLBG — Volleyball Betting Tips',
            'url': INDEX_URL,
            'fetched_at_utc': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'method': 'Index discovery followed by a direct public event-page market-heading check.',
            'licence_note': 'Facts are retained for manual review; no odds are inferred from tipster voting.',
        },
        'markets_verified_on_snapshot': verified,
        'notes': [
            'Only market names actually found on an event page are marked verified.',
            'OLBG consensus is a community vote, not a sportsbook quote, and is never an input to a prediction score.',
            'An OLBG display time is retained as display text only; it is not converted into an official kickoff timestamp.',
            'The FIVB VNL Women prediction engine accepts only verified VNL Women fixtures from its official-source dataset. Other OLBG volleyball competitions remain visible but are out of prediction scope.',
        ],
        'collection_warnings': warnings,
        'events': events,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--from-file', help='Parse a saved OLBG index fixture instead of network')
    parser.add_argument('--event-pages-dir', help='Directory with <event_id>.html event fixtures; useful for deterministic tests')
    parser.add_argument('--skip-event-pages', action='store_true', help='Do not claim event market verification')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    warnings: list[str] = []

    try:
        if args.from_file:
            with open(args.from_file, encoding='utf-8') as handle:
                index = handle.read()
        else:
            index = fetch(INDEX_URL)
    except (HTTPError, URLError, OSError) as exc:
        print(f'FAIL: OLBG index unavailable; {exc}. Existing snapshot was not changed.', file=sys.stderr)
        return 2

    events = parse_volleyball_index(index)
    for event in events:
        event['resolved_date'], event['date_basis'] = resolve_volleyball_date(event.get('display_date'), now)
        event['competition_scope'] = 'unclassified'
        event['markets_available'] = []
        event['markets_verified'] = False
        if args.skip_event_pages:
            continue
        try:
            local = os.path.join(args.event_pages_dir, f"{event['event_id']}.html") if args.event_pages_dir else None
            if local and os.path.exists(local):
                with open(local, encoding='utf-8') as handle:
                    page = handle.read()
            elif local:
                raise OSError(f'missing saved event page {local}')
            else:
                page = fetch(event['url'])
            parsed = parse_volleyball_event_page(page)
            event['markets_available'] = parsed['markets_on_event_page']
            event['markets'] = parsed['markets']
            event['markets_verified'] = parsed['markets_verified']
            if not parsed['markets_verified']:
                warnings.append(f"event {event['event_id']}: no recognized market headings on publicly rendered event page")
        except (HTTPError, URLError, OSError) as exc:
            warnings.append(f"event {event['event_id']} market page: {exc}")

    events.sort(key=lambda event: (event.get('resolved_date') or '9999-99-99', event.get('display_time') or '', event['event_id']))
    payload = build_payload(events, now, warnings)
    if args.dry_run:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write('\n')
    print(f"Wrote {len(events)} OLBG volleyball events; {sum(e['markets_verified'] for e in events)} event pages verified.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
