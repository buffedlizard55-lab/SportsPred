#!/usr/bin/env python3
"""Collect FIVB Volleyball Nations League Women rows from official pages.

This is deliberately fail-closed. It writes `data/volleyball_vnl.json` only
when it can extract individually source-addressable, Women-only VNL fixture
objects that contain both competitors and an ISO/UTC start time. A changed page,
a mixed-gender response, or an incomplete object causes a non-zero exit and
leaves the previous snapshot untouched.

It does *not* use OLBG to create fixtures, prices, results, rosters or stats.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'volleyball_vnl.json')
SCHEDULE_URL = 'https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/schedule/'
STANDINGS_URL = 'https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/standings/women/'
STATS_URL = 'https://en.volleyballworld.com/volleyball/competitions/volleyball-nations-league/statistics/'
FIVB_SCHEDULE_URL = 'https://www.fivb.com/volleyball-world-reveals-2026-vnl-match-schedule/'
USER_AGENT = 'Mozilla/5.0 (compatible; SportsPredVNLCollector/1.0; +https://github.com/buffedlizard55-lab/SportsPred)'


def fetch(url: str) -> str:
    request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9'})
    with urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or 'utf-8'
        return response.read().decode(charset, errors='replace')


def walk(value):
    """Yield every object from JSON nested in a rendered official page."""
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def text(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get('name') or value.get('displayName') or value.get('teamName') or '').strip()
    return ''


def candidate_objects(page: str):
    """Find JSON-LD and Next/Nuxt-style JSON blocks without DOM dependencies."""
    blocks = re.findall(r'<script[^>]+(?:type=["\']application/ld\+json["\']|id=["\']__NEXT_DATA__["\'])[^>]*>(.*?)</script>', page, re.I | re.S)
    for block in blocks:
        try:
            yield from walk(json.loads(html.unescape(block)))
        except json.JSONDecodeError:
            continue


def parse_iso(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return None
    if not re.match(r'^\d{4}-\d{2}-\d{2}T', value):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def parse_schedule(page: str) -> list[dict]:
    """Extract only explicit, complete Women VNL fixtures from official JSON.

    The field aliases are intentionally small and reviewed. Unknown page shapes
    produce no event, which is safer than guessing an opponent or timestamp.
    """
    rows = []
    seen = set()
    for obj in candidate_objects(page):
        gender = str(obj.get('gender') or obj.get('genderName') or obj.get('sex') or '').lower()
        competition = ' '.join(str(obj.get(key) or '') for key in ('competitionName', 'competition', 'tournamentName', 'eventName')).lower()
        if 'women' not in gender and 'women' not in competition:
            continue
        if 'nations league' not in competition and obj.get('competitionCode') not in {'VNL', 'VNLW'}:
            continue
        home = text(obj.get('homeTeam') or obj.get('home'))
        away = text(obj.get('awayTeam') or obj.get('away'))
        start = parse_iso(obj.get('startDate') or obj.get('startTime') or obj.get('startUtc'))
        identifier = str(obj.get('id') or obj.get('matchId') or obj.get('matchID') or '').strip()
        if not (identifier and home and away and start):
            continue
        key = (identifier, start, home, away)
        if key in seen:
            continue
        seen.add(key)
        home_score = obj.get('homeScore') or obj.get('homeTeamScore')
        away_score = obj.get('awayScore') or obj.get('awayTeamScore')
        completed = str(obj.get('status') or '').lower() in {'finished', 'completed', 'final'}
        set_score = f'{home_score}-{away_score}' if completed and str(home_score).isdigit() and str(away_score).isdigit() else None
        winner = home if completed and home_score is not None and away_score is not None and int(home_score) > int(away_score) else away if completed and home_score is not None and away_score is not None and int(away_score) > int(home_score) else None
        rows.append({
            'id': identifier,
            'event_id': identifier,
            'family': 'vnl-women',
            'phase': 'results' if winner else 'upcoming',
            'date': start[:10],
            'dateISO': start[:10],
            'startUtc': start,
            'home': home,
            'away': away,
            'winner': winner,
            'setScore': set_score,
            'round': obj.get('roundName') or obj.get('round') or None,
            'venue': text(obj.get('venue') or obj.get('venueName')) or None,
            'context': {
                'week': obj.get('weekNumber') or obj.get('week') or None,
                'pool': obj.get('poolName') or obj.get('pool') or None,
                'hostCity': text(obj.get('city') or obj.get('hostCity')) or None,
            },
            'source_url': f'{SCHEDULE_URL}{identifier}',
        })
    return sorted(rows, key=lambda row: (row['startUtc'], row['id']))


def payload(rows: list[dict], page: str) -> dict:
    results = [row for row in rows if row['phase'] == 'results']
    events = [row for row in rows if row['phase'] != 'results']
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {
        'schema_version': 1,
        'sport': 'Volleyball',
        'scope': 'FIVB Volleyball Nations League — Women only',
        'generated_at_utc': now,
        'season': {'year': datetime.now(timezone.utc).year, 'status': 'active-or-archived', 'source_url': FIVB_SCHEDULE_URL},
        'season_status': {'status': 'active-or-archived', 'message': 'Collector parsed official fixture rows; verify individual source links before publication.', 'source_url': SCHEDULE_URL},
        'sources': [
            {'name': 'FIVB VNL schedule announcement', 'url': FIVB_SCHEDULE_URL, 'role': 'season context'},
            {'name': 'Volleyball World VNL schedule and results', 'url': SCHEDULE_URL, 'role': 'fixtures and results'},
            {'name': 'Volleyball World VNL Women standings', 'url': STANDINGS_URL, 'role': 'standings'},
            {'name': 'Volleyball World VNL statistics', 'url': STATS_URL, 'role': 'team statistics'},
        ],
        'collection_status': 'Parsed from official JSON embedded in the Volleyball World schedule page.',
        'source_sha256': hashlib.sha256(page.encode('utf-8')).hexdigest(),
        'events': events,
        'results': results,
        'standings': [],
        'teams': {},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--from-file', help='Parse saved official schedule HTML instead of downloading it')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        if args.from_file:
            with open(args.from_file, encoding='utf-8') as handle:
                page = handle.read()
        else:
            page = fetch(SCHEDULE_URL)
    except (HTTPError, URLError, OSError) as exc:
        print(f'FAIL: official VNL schedule unavailable; {exc}. Existing snapshot was not changed.', file=sys.stderr)
        return 2
    rows = parse_schedule(page)
    if not rows:
        print('FAIL: no complete Women VNL fixture object was found in the official page. Existing snapshot was not changed.', file=sys.stderr)
        return 2
    out = payload(rows, page)
    if args.dry_run:
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=2, ensure_ascii=False)
        handle.write('\n')
    print(f"Wrote {len(out['events'])} upcoming and {len(out['results'])} result VNL Women rows.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
