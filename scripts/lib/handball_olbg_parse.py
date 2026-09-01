"""
Parser for OLBG Handball betting tips pages and event pages.

Extracts match fixtures, resolved dates, tipster consensus, and all available
markets (Money Line, Match Handicap, Points Total).

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


def resolve_handball_date(display_date: str | None, now_utc: datetime) -> tuple[str | None, str]:
    """
    Resolve OLBG relative/display date strings ('Today', 'Tomorrow', '03 Sept')
    to an ISO date ('YYYY-MM-DD').
    """
    if not display_date:
        return None, 'missing'
    s = display_date.strip().lower()

    if s == 'today':
        return now_utc.strftime('%Y-%m-%d'), 'relative:today'
    if s == 'tomorrow':
        return (now_utc + timedelta(days=1)).strftime('%Y-%m-%d'), 'relative:tomorrow'

    # '03 sept' or '3 sep'
    m = re.match(r'^(\d{1,2})\s+([a-z]{3,4})$', s)
    if m:
        day = int(m.group(1))
        mon_str = m.group(2)
        month = MONTH_MAP.get(mon_str)
        if month:
            year = now_utc.year
            if now_utc.month == 12 and month == 1:
                year += 1
            elif now_utc.month == 1 and month == 12:
                year -= 1
            return f'{year:04d}-{month:02d}-{day:02d}', 'calendar:explicit'

    return None, 'unparseable'


def parse_handball_index(html: str) -> list[dict]:
    """
    Parse OLBG handball index HTML / markdown excerpt to structured event rows.
    """
    matches = []
    text = unescape(html)

    # Markdown link pattern: [**Home vs Away**](url?event_id=XXXX ...)
    pattern = re.compile(
        r'\[\*\*([^*]+?)\s+vs\s+([^*]+?)\*\*\]\((https?://[^\s)"]+?[?&]event_id=(\d+)[^)]*)\)'
        r'(.*?)(?=\[\*\*[^*]+?\s+vs\s+[^*]+?\*\*\]|\Z)',
        re.DOTALL | re.IGNORECASE
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

        market_m = re.search(r'(Money\s*Line|Match\s*Handicap|Points\s*Total)', body, re.IGNORECASE)
        market = market_m.group(1).strip() if market_m else 'Money Line'

        selection_m = re.search(r'\[\*\*([^*]+?)\*\*\]', body)
        selection = selection_m.group(1).strip() if selection_m else None

        tips_m = re.search(r'\*\*(\d+)\s*/\s*(\d+)\s*(?:Win\s*Tips|Tips)?\*\*', body)
        tips_for = int(tips_m.group(1)) if tips_m else None
        tips_total = int(tips_m.group(2)) if tips_m else None

        pct_m = re.search(r'(\d+)%', body)
        pct = int(pct_m.group(1)) if pct_m else None

        matches.append({
            'event_id': event_id,
            'sport': 'Handball',
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
            'markets_available': ['Money Line', 'Match Handicap', 'Points Total'],
            'markets_verified': False,
        })

    return matches


def parse_handball_event_page(html: str) -> dict:
    """
    Parse an OLBG Handball event page to extract detailed markets and lines.
    """
    markets = []
    handicap_lines = []
    total_lines = []

    text = unescape(html)
    if 'Money Line' in text:
        markets.append('Money Line')
    if 'Match Handicap' in text:
        markets.append('Match Handicap')
    if 'Points Total' in text:
        markets.append('Points Total')

    for hm in re.finditer(r'([A-Za-z0-9\s]+?)\s*([+-]\d+(?:\.\d+)?)\s*(?:hcap)?', text):
        team = hm.group(1).strip()
        val = hm.group(2).strip()
        if any(w in team for w in ['Over', 'Under', 'Money', 'Points']):
            continue
        if 2 < len(team) < 35:
            handicap_lines.append(f'{team} {val}')

    for tm in re.finditer(r'(Over|Under)\s+(\d{2}(?:\.\d+)?)', text):
        total_lines.append(f'{tm.group(1)} {tm.group(2)}')

    return {
        'markets_on_event_page': sorted(list(set(markets))),
        'handicap_lines': sorted(list(set(handicap_lines))),
        'total_lines': sorted(list(set(total_lines))),
        'markets_verified': len(markets) > 0,
    }
