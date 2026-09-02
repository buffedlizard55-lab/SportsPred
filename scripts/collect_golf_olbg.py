#!/usr/bin/env python3
"""
Collect the current OLBG Golf slate into data/golf_slate.json.

Stdlib only — no third-party packages, so it runs in a bare GitHub Actions
runner.

    python3 scripts/collect_golf_olbg.py                # fetch live, write slate
    python3 scripts/collect_golf_olbg.py --dry-run      # fetch live, print summary
    python3 scripts/collect_golf_olbg.py --from FILE    # parse a saved HTML capture
    python3 scripts/collect_golf_olbg.py --save-html DIR # also dump raw HTML
    python3 scripts/collect_golf_olbg.py --enrich       # fetch each event page for its markets

IMPORTANT: this script must not be able to invent data. If a fetch fails the run
aborts rather than writing a partial or stale file (same rule as the tennis,
cricket and F1 collectors). OLBG server HTML carries no prices, so no price
field can ever appear in the output (validated by scripts/build_data.py).
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
from lib.golf_olbg_parse import (  # noqa: E402
    parse_index, parse_event_page_markets, parse_form_table, parse_owgr_links,
)
from lib.olbg_parse import resolve_date  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'golf_slate.json')

INDEX_URLS = [
    'https://www.olbg.com/betting-tips/Golf/5',
    'https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/5',
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
    tournaments: dict[str, dict] = {}
    teams: dict[str, dict] = {}
    form_table: list[dict] = []
    owgr_links: list[dict] = []
    failures = []

    sources = from_files or INDEX_URLS
    for src in sources:
        try:
            if from_files:
                with open(src, encoding='utf-8') as fh:
                    html = fh.read()
            else:
                html = fetch(src)
                if save_html_dir:
                    os.makedirs(save_html_dir, exist_ok=True)
                    stamp = now.strftime('%Y%m%dT%H%M%SZ')
                    path = os.path.join(save_html_dir, f'golf_index_{stamp}.html')
                    with open(path, 'w', encoding='utf-8') as fh:
                        fh.write(html)
                    print(f'  saved raw HTML -> {path}')
        except (HTTPError, URLError, OSError) as exc:
            failures.append(f'{src}: {exc}')
            continue

        t, tm = parse_index(html)
        print(f'  {src}: {len(t)} tournament rows, {len(tm)} team-event rows')
        for row in t:
            tournaments.setdefault(row['event_id'], row)
        for row in tm:
            teams.setdefault(row['event_id'], row)
        if not form_table:
            form_table = parse_form_table(html)
        if not owgr_links:
            owgr_links = parse_owgr_links(html)

    if failures:
        print('\nFetch failures:', file=sys.stderr)
        for f in failures:
            print(f'  {f}', file=sys.stderr)
        if not tournaments and not teams:
            print('\nAborting: nothing could be fetched. Refusing to overwrite '
                  'the existing snapshot with an empty one.', file=sys.stderr)
            return None, now, failures

    for row in list(tournaments.values()) + list(teams.values()):
        iso, basis = resolve_date(row.get('display_date'), now)
        row['resolved_date'] = iso
        row['date_basis'] = basis

    data = {
        'tournaments': list(tournaments.values()),
        'teams': list(teams.values()),
        'form_table': form_table,
        'owgr_links': owgr_links,
    }
    return data, now, failures


def enrich_event_pages(rows, limit=None, save_html_dir=None):
    """Fetch each event page for the list of markets it actually offers."""
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
            path = os.path.join(save_html_dir, f'golf_event_{row["event_id"]}.html')
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(html)
        row['markets_on_event_page'] = parse_event_page_markets(html)
        row['markets_verified'] = bool(row['markets_on_event_page'])
        print(f'  event {row["event_id"]}: {row["markets_on_event_page"]}')
    return rows


def build_payload(data, now, failures):
    return {
        'schema_version': 1,
        'sport': 'Golf',
        'source': {
            'name': 'OLBG — Golf Betting Tips',
            'url': INDEX_URLS[0],
            'indexes': INDEX_URLS,
            'fetched_at_utc': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'method': 'HTTP GET of server-rendered HTML via urllib; no JavaScript execution',
            'licence_note': 'Publicly viewable page. Redistribution limited to this factual fixture/market listing; see docs/GOLF_SOURCES.md.',
        },
        'notes': [
            'Every field was read from the pages listed in source.indexes. Nothing is inferred unless date_basis says "derived".',
            'OLBG does not expose structured odds in server-rendered HTML, so no price fields exist in this file. IR-GOLF-01.',
            'Tipster consensus counts are display-only and are never fed into model scoring.',
            'form_table and owgr_links are editorial content from the index article, kept for cross-checking the OWGR feed only.',
        ],
        'collection_warnings': failures,
        'events': data['tournaments'],
        'team_events': data['teams'],
        'form_table': data['form_table'],
        'owgr_links': data['owgr_links'],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--from', dest='from_files', nargs='+', help='parse saved HTML captures instead of fetching')
    ap.add_argument('--save-html', dest='save_html', help='directory to dump raw HTML captures')
    ap.add_argument('--enrich', action='store_true', help='also fetch each event page for its market list')
    ap.add_argument('--enrich-limit', type=int, default=None)
    args = ap.parse_args()

    print('Collecting OLBG Golf slate…')
    data, now, failures = collect(from_files=args.from_files, save_html_dir=args.save_html)
    if data is None:
        return 1

    if args.enrich:
        print('Enriching event pages…')
        enrich_event_pages(data['tournaments'] + data['teams'], limit=args.enrich_limit, save_html_dir=args.save_html)

    payload = build_payload(data, now, failures)
    print(f'\n{len(payload["events"])} tournament rows, {len(payload["team_events"])} team-event rows, '
          f'{len(payload["form_table"])} form-table rows')

    if args.dry_run:
        for ev in payload['events'][:10]:
            print(f"  {ev['event_id']} {ev.get('event_name')} [{(ev.get('consensus') or {}).get('market')}] "
                  f"{ev.get('resolved_date')} ({ev.get('date_basis')})")
        return 0

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'Wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
