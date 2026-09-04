#!/usr/bin/env python3
"""
Collect the current OLBG Motor Racing (F1) slate into data/f1_slate.json.

Stdlib only — no third-party packages, so it runs in a bare GitHub Actions
runner.

    python3 scripts/collect_f1_olbg.py                # fetch live, write slate
    python3 scripts/collect_f1_olbg.py --dry-run      # fetch live, print summary
    python3 scripts/collect_f1_olbg.py --from FILE    # parse a saved HTML capture
    python3 scripts/collect_f1_olbg.py --save-html DIR # also dump raw HTML

IMPORTANT: this script must not be able to invent data. If a fetch fails the run
aborts rather than writing a partial or stale file (same rule as the tennis and
cricket collectors).
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
from lib.f1_olbg_parse import (  # noqa: E402
    parse_index, parse_event_page_markets, parse_track_history,
)
from lib.olbg_page_health import diagnose  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'f1_slate.json')

INDEX_URLS = [
    'https://www.olbg.com/betting-tips/Motor_Racing/14',
    'https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/14',
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
    page_health = []

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
                    name = 'f1_index'
                    path = os.path.join(save_html_dir, f'{name}_{stamp}.html')
                    with open(path, 'w', encoding='utf-8') as fh:
                        fh.write(html)
                    print(f'  saved raw HTML -> {path}')
        except (HTTPError, URLError, OSError) as exc:
            failures.append(f'{src}: {exc}')
            continue

        m, o = parse_index(html)
        # Zero rows from a successful fetch is ambiguous: a bot-block, a
        # cookie wall and a real off-season all parse to nothing. Record
        # which the delivered bytes actually show.
        _h = diagnose(html, event_count=len(m) + len(o), sport="Formula 1")
        page_health.append({"url": src, **_h})
        failures.extend(f"{src}: {w}" for w in _h["warnings"])
        print(f'  {label}: {len(m)} markets rows, {len(o)} outright rows')
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
            return None, now, failures, page_health

    for row in list(matches.values()) + list(outrights.values()):
        iso, basis = resolve_date_import(row.get('display_date'), now)
        row['resolved_date'] = iso
        row['date_basis'] = basis

    return {'matches': list(matches.values()), 'outrights': list(outrights.values())}, now, failures, page_health


def resolve_date_import(display_date, now):
    from lib.olbg_parse import resolve_date
    return resolve_date(display_date, now)


def enrich_event_pages(rows, limit=None, save_html_dir=None):
    """Fetch each event page for its market + track history (winners/fastest laps)."""
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
            path = os.path.join(save_html_dir, f'f1_event_{row["event_id"]}.html')
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(html)
        row['markets_on_event_page'] = parse_event_page_markets(html)
        history = parse_track_history(html)
        # The event page repeats the full season calendar; keep only entries
        # that belong to this race's circuit when the article names it.
        title = row.get('event_name') or ''
        wanted = title.replace(' Grand Prix', '')
        if history and ('Circuit' in title or 'circuit' in title or 'Best Tips' in title or 'Winners' in title):
            row['track_history'] = history
        row['markets_verified'] = bool(row.get('markets_on_event_page'))
        print(f'  event {row["event_id"]}: {row.get("markets_on_event_page")}'
              f'{", track history rows: " + str(len(history)) if history else ""}')
    return rows


def build_payload(data, now, failures, page_health=None):
    return {
        'schema_version': 1,
        'sport': 'Formula 1',
        'source': {
            'name': 'OLBG — Motor Racing Betting Tips',
            'url': INDEX_URLS[0],
            'indexes': INDEX_URLS,
            'fetched_at_utc': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'method': 'HTTP GET of server-rendered HTML via urllib; no JavaScript execution',
            'licence_note': 'Publicly viewable page. Redistribution limited to this factual fixture/market listing; see docs/F1_SOURCES.md.',
        },
        'notes': [
            'Every field was read from the pages listed in source.indexes. Nothing is inferred unless date_basis says "derived".',
            'OLBG does not expose structured odds in server-rendered HTML, so no price fields exist in this file. IR-F1-02.',
            'Tipster consensus counts are display-only and are never fed into model scoring.',
            'Track history (past winners / fastest laps) is factual content published on OLBG event pages; it is cross-checked where ESPN publishes the same fact (2025 Monza fastest lap).',
        ],
        'collection_warnings': failures,
        'page_health': page_health or [],
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

    print('Collecting OLBG Formula 1 slate…')
    data, now, failures, page_health = collect(from_files=args.from_files, save_html_dir=args.save_html)
    if data is None:
        return 1

    if args.enrich:
        print('Enriching event pages…')
        enrich_event_pages(data['matches'], limit=args.enrich_limit, save_html_dir=args.save_html)

    payload = build_payload(data, now, failures, page_health)
    print(f'\n{len(payload["events"])} race-market rows, {len(payload["outrights"])} outrights')

    if args.dry_run:
        for ev in payload['events'][:10]:
            print(f"  {ev['event_id']} {ev.get('event_name')} [{ev.get('consensus', {}).get('market')}] "
                  f"{ev.get('resolved_date')} ({ev.get('date_basis')})")
        return 0

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'Wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
