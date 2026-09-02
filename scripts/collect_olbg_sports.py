#!/usr/bin/env python3
"""
Collect the directory of ALL openly available OLBG sports/markets into
data/olbg_sports.json.

This is the answer to "look up all available markets on the OLBG website that
are currently available": the sitemap enumerates every sport index OLBG
publishes, and this script fetches each index to record the number of live
market rows and which market labels appear today. Sports with a dedicated
SportsPred engine (tennis, cricket, handball, Formula 1) are marked and link to
their detail slates; every other sport is listed with its OLBG review URL and
NO fabricated predictions.

Stdlib only. Refuses to write if the sitemap cannot be fetched.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'olbg_sports.json')

SITEMAP = 'https://www.olbg.com/sitemap-betting-tips.xml'
USER_AGENT = (
    'Mozilla/5.0 (compatible; SportsPredCollector/1.0; '
    '+https://github.com/buffedlizard55-lab/SportsPred)'
)
TIMEOUT = 25

# Sports that have a scored engine on this site.
COVERED = {
    'Tennis': 'Tennis',
    'Cricket': 'Cricket',
    'Handball': 'Handball',
    'Motor_Racing': 'Formula 1',
}

# Generic market labels that appear on OLBG sport indexes; count only exact-ish
# labels to avoid counting prose.
MARKET_NAMES = [
    'Fastest Qualifier', 'Win Race', 'Win Tournament', 'Full Time Result',
    'Money Line', 'Win Match', 'Man Of The Match', 'Draw No Bet',
    'To Win', 'Daily Racing', '1st Set Winner', 'Win Without',
]


def fetch(url: str) -> str:
    req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Language': 'en-GB,en;q=0.9'})
    with urlopen(req, timeout=TIMEOUT) as resp:
        charset = resp.headers.get_content_charset() or 'utf-8'
        return resp.read().decode(charset, errors='replace')


def strip_tags(html: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', html)
    text = (text.replace('&amp;', '&').replace('&nbsp;', ' ')
                .replace('&#39;', "'").replace('&quot;', '"'))
    return re.sub(r'\s+', ' ', text).strip()


def sport_roots(sitemap_xml: str) -> list[tuple[str, str]]:
    """Sport index rows: /betting-tips/<Sport>/<id> with exactly two segments."""
    out = []
    seen = set()
    for m in re.finditer(r'https://www\.olbg\.com/betting-tips/([A-Za-z_]+)/(\d+)', sitemap_xml):
        sport, sport_id = m.group(1), m.group(2)
        key = (sport, sport_id)
        if key in seen:
            continue
        seen.add(key)
        out.append((sport, sport_id))
    # Sort alphabetically for a stable board.
    out.sort(key=lambda x: (x[0].replace('_', ' ').title(), x[1]))
    return out


def parse_index(sport: str, sport_id: str, html: str) -> dict:
    plain = strip_tags(html)
    href_re = re.compile(rf'/betting-tips/{re.escape(sport)}/[A-Za-z0-9_/\-]+/{re.escape(sport_id)}\?event_id=(\d+)')
    event_ids = set(href_re.findall(html))
    tips_counts = re.findall(r'(?P<for>\d+)\s*/\s*(?P<total>\d+)\s*Win Tips', html)
    markets = []
    for m in MARKET_NAMES:
        # Only count when it appears next to a Win Tips count (a live row).
        for mm in re.finditer(re.escape(m) + r'(?=.*?\d+\s*/\s*\d+\s*Win Tips)', plain, re.S):
            markets.append(m)
            break
    return {
        'events': len(event_ids),
        'tip_rows': len(tips_counts),
        'markets_seen': sorted(set(markets)),
    }


def build_payload(now, sports, warnings):
    rows = []
    for sport, sport_id in sports:
        url = f'https://www.olbg.com/betting-tips/{sport}/{sport_id}'
        try:
            html = fetch(url)
            stats = parse_index(sport, sport_id, html)
        except (HTTPError, URLError, OSError) as exc:
            warnings.append(f'{url}: {exc}')
            stats = {'events': None, 'tip_rows': None, 'markets_seen': []}
        rows.append({
            'sport': sport,
            'display_name': sport.replace('_', ' ').title(),
            'olbg_id': sport_id,
            'url': url,
            'covered_by_engine': COVERED.get(sport),
            **stats,
            'fetched_at_utc': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        })
    return {
        'schema_version': 1,
        'fetched_at_utc': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': {
            'name': 'OLBG betting tips sitemap + sport indexes',
            'url': SITEMAP,
            'method': 'HTTP GET of server-rendered HTML via urllib; no JavaScript execution',
            'licence_note': 'Publicly viewable listing of facts (sport, URL, live row counts) for manual review.',
        },
        'note': 'Top-level enumeration of OLBG sports with live market-row counts. Sports without a '
                'scored engine are linked for manual review and never receive generated predictions.',
        'warnings': warnings,
        'sports': rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--save-html', dest='save_html')
    args = ap.parse_args()

    print('Collecting OLBG sports directory…')
    now = datetime.now(timezone.utc)
    try:
        sitemap = fetch(SITEMAP)
    except (HTTPError, URLError, OSError) as exc:
        print(f'Aborting: sitemap fetch failed: {exc}', file=sys.stderr)
        return 1
    if args.save_html:
        os.makedirs(args.save_html, exist_ok=True)
        path = os.path.join(args.save_html, f'olbg_sitemap_{now.strftime("%Y%m%dT%H%M%SZ")}.xml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(sitemap)
        print(f'  saved {path}')

    sports = sport_roots(sitemap)
    print(f'  {len(sports)} sport indexes found in sitemap')
    payload = build_payload(now, sports, [])

    if args.dry_run:
        for row in payload['sports']:
            print(f"  {row['display_name']:<24} id={row['olbg_id']:<4} events={row['events']} markets={row['markets_seen']}")
        return 0

    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'Wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
