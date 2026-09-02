"""
Parser for OLBG Volleyball betting tips pages.

Extracts fixtures, resolved dates, tipster consensus, and the two markets
the volleyball master prompt scores: Win Match and Set Score.

Stdlib only.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from html import unescape

MONTH_MAP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}


def resolve_volleyball_date(display_date: str | None, now_utc: datetime) -> tuple[str | None, str]:
    if not display_date:
        return None, 'missing'
    s = display_date.strip().lower()
    if s == 'today':
        return now_utc.strftime('%Y-%m-%d'), 'relative:today'
    if s == 'tomorrow':
        return (now_utc + timedelta(days=1)).strftime('%Y-%m-%d'), 'relative:tomorrow'
    m = re.match(r'^(\d{1,2})\s+([a-z]{3,4})$', s)
    if m:
        day = int(m.group(1))
        month = MONTH_MAP.get(m.group(2))
        if month:
            year = now_utc.year
            if now_utc.month == 12 and month == 1:
                year += 1
            elif now_utc.month == 1 and month == 12:
                year -= 1
            return f'{year:04d}-{month:02d}-{day:02d}', 'calendar:explicit'
    return None, 'unparseable'


def parse_volleyball_index(html: str) -> list[dict]:
    matches = []
    text = unescape(html)
    pattern = re.compile(
        r'\[\*\*([^*]+?)\s+vs\s+([^*]+?)\*\*\]\((https?://[^\s)"]+?[?&]event_id=(\d+)[^)]*)\)'
        r'(.*?)(?=\[\*\*[^*]+?\s+vs\s+[^*]+?\*\*\]|\Z)',
        re.DOTALL | re.IGNORECASE,
    )
    for m in pattern.finditer(text):
        home = m.group(1).strip()
        away = m.group(2).strip()
        raw_url = m.group(3).strip().split('"')[0].strip()
        event_id = m.group(4).strip()
        body = m.group(5)

        time_m = re.search(r'(Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,4})\s+(\d{1,2}:\d{2})', body)
        display_date = time_m.group(1) if time_m else None
        display_time = time_m.group(2) if time_m else None

        market_m = re.search(r'(Win\s*Match|Set\s*Score|Total\s*Points|Points\s*Handicap)', body, re.IGNORECASE)
        market = market_m.group(1).strip() if market_m else 'Win Match'

        selection_m = re.search(r'\[\*\*([^*]+?)\*\*\]', body)
        selection = selection_m.group(1).strip() if selection_m else None

        tips_m = re.search(r'\*\*(\d+)\s*/\s*(\d+)\s*(?:Win\s*Tips|Tips)?\*\*', body)
        tips_for = int(tips_m.group(1)) if tips_m else None
        tips_total = int(tips_m.group(2)) if tips_m else None

        pct_m = re.search(r'(\d+)%', body)
        pct = int(pct_m.group(1)) if pct_m else None

        matches.append({
            'event_id': event_id,
            'sport': 'Volleyball',
            'home': home,
            'away': away,
            'url': raw_url,
            'display_date': display_date,
            'display_time': display_time,
            'consensus': {
                'market': market,
                'selection': selection,
                'tips_for': tips_for,
                'tips_total': tips_total,
                'percentage': pct,
            },
            'markets_available': ['Win Match', 'Set Score'],
            'markets_verified': False,
        })
    return matches


def parse_volleyball_event_page(html: str) -> dict:
    text = unescape(html)
    markets = []
    if re.search(r'Win\s*Match', text, re.IGNORECASE):
        markets.append('Win Match')
    if re.search(r'Set\s*Score', text, re.IGNORECASE):
        markets.append('Set Score')
    if re.search(r'Total\s*Points', text, re.IGNORECASE):
        markets.append('Total Points')
    if re.search(r'Points\s*Handicap', text, re.IGNORECASE):
        markets.append('Points Handicap')
    return {
        'markets_on_event_page': sorted(list(set(markets))),
        'markets_verified': len(markets) > 0,
        'scored_markets': [m for m in markets if m in ('Win Match', 'Set Score')],
        'review_only_markets': [m for m in markets if m not in ('Win Match', 'Set Score')],
    }
