"""Strict parsers for publicly rendered OLBG Volleyball pages.

The index supplies the currently listed events. The collector then fetches each
listed event page and records only market headings actually present there. It
never fills a standard market list into an event that was not checked.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from html import unescape
from urllib.parse import parse_qs, urljoin, urlparse

MONTH_MAP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}
MARKET_NAMES = ('Win Match', 'Set Score', 'Total Points', 'Points Handicap')


def resolve_volleyball_date(display_date: str | None, now_utc: datetime) -> tuple[str | None, str]:
    """Resolve an OLBG display-day to an ISO date, retaining the basis.

    It resolves a calendar *day* only. An OLBG display time is not represented
    as an official kickoff timestamp because that would be an unsupported
    timezone conversion.
    """
    if not display_date:
        return None, 'missing'
    value = display_date.strip().lower()
    if value == 'today':
        return now_utc.strftime('%Y-%m-%d'), 'olbg-relative-today'
    if value == 'tomorrow':
        return (now_utc + timedelta(days=1)).strftime('%Y-%m-%d'), 'olbg-relative-tomorrow'
    match = re.match(r'^(\d{1,2})\s+([a-z]{3,4})$', value)
    if not match:
        return None, 'unparseable'
    day = int(match.group(1))
    month = MONTH_MAP.get(match.group(2))
    if not month:
        return None, 'unparseable'
    year = now_utc.year
    if now_utc.month == 12 and month == 1:
        year += 1
    elif now_utc.month == 1 and month == 12:
        year -= 1
    try:
        return datetime(year, month, day).strftime('%Y-%m-%d'), 'olbg-explicit-calendar-day'
    except ValueError:
        return None, 'unparseable'


def _clean(value: str) -> str:
    value = re.sub(r'<[^>]+>', ' ', value)
    value = unescape(value)
    return re.sub(r'\s+', ' ', value).strip()


def _event_id(url: str) -> str | None:
    query = parse_qs(urlparse(url).query)
    return (query.get('event_id') or [None])[0]


def _dedupe(events: list[dict]) -> list[dict]:
    result = []
    seen = set()
    for event in events:
        key = event.get('event_id')
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(event)
    return result


def _markdown_index_events(text: str) -> list[dict]:
    events = []
    pattern = re.compile(
        r'\[\*\*([^*]+?)\s+vs\s+([^*]+?)\*\*\]\((https?://[^\s)"]+?[?&]event_id=(\d+)[^)]*)\)'
        r'(.*?)(?=\[\*\*[^*]+?\s+vs\s+[^*]+?\*\*\]|\Z)',
        re.DOTALL | re.IGNORECASE,
    )
    for match in pattern.finditer(text):
        body = match.group(5)
        date_match = re.search(r'(Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,4})\s+(\d{1,2}:\d{2})', body)
        selection_match = re.search(r'\[\*\*([^*]+?)\*\*\]', body)
        tips_match = re.search(r'\*\*(\d+)\s*/\s*(\d+)\s*(?:Win\s*Tips|Tips)?\*\*', body)
        percentage_match = re.search(r'(\d+)%', body)
        events.append({
            'event_id': match.group(4),
            'sport': 'Volleyball',
            'home': _clean(match.group(1)),
            'away': _clean(match.group(2)),
            'url': match.group(3).strip().split('"')[0].strip(),
            'display_date': date_match.group(1) if date_match else None,
            'display_time': date_match.group(2) if date_match else None,
            'consensus': {
                'market': 'Win Match',
                'selection': _clean(selection_match.group(1)) if selection_match else None,
                'tips_for': int(tips_match.group(1)) if tips_match else None,
                'tips_total': int(tips_match.group(2)) if tips_match else None,
                'percentage': int(percentage_match.group(1)) if percentage_match else None,
            },
            'markets_available': [],
            'markets_verified': False,
        })
    return events


def _html_index_events(html: str) -> list[dict]:
    """Best-effort fallback for OLBG's server-rendered HTML.

    We only retain anchors whose visible text itself has a `v` pairing. The
    same event URL may occur again for selection links, hence deduplication.
    """
    events = []
    anchor = re.compile(r'<a\b[^>]*?href=["\']([^"\']*event_id=\d+[^"\']*)["\'][^>]*>(.*?)</a>', re.I | re.S)
    for match in anchor.finditer(html):
        href = urljoin('https://www.olbg.com', unescape(match.group(1)))
        label = _clean(match.group(2))
        pair = re.match(r'^(.+?)\s+v(?:s\.?|\.)?\s+(.+?)$', label, flags=re.I)
        if not pair:
            continue
        event_id = _event_id(href)
        if not event_id:
            continue
        tail = _clean(html[match.end():match.end() + 2500])
        date_match = re.search(r'\b(Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,4})\s+(\d{1,2}:\d{2})\b', tail, re.I)
        tips_match = re.search(r'\b(\d+)\s*/\s*(\d+)\s*Win\s*Tips\b', tail, re.I)
        percentage_match = re.search(r'\b(\d+)%\b', tail)
        events.append({
            'event_id': event_id,
            'sport': 'Volleyball',
            'home': _clean(pair.group(1)),
            'away': _clean(pair.group(2)),
            'url': href,
            'display_date': date_match.group(1) if date_match else None,
            'display_time': date_match.group(2) if date_match else None,
            'consensus': {
                'market': 'Win Match', 'selection': None,
                'tips_for': int(tips_match.group(1)) if tips_match else None,
                'tips_total': int(tips_match.group(2)) if tips_match else None,
                'percentage': int(percentage_match.group(1)) if percentage_match else None,
            },
            'markets_available': [],
            'markets_verified': False,
        })
    return events


def parse_volleyball_index(content: str) -> list[dict]:
    """Parse rendered markdown or raw HTML without claiming unseen markets."""
    text = unescape(content or '')
    markdown = _markdown_index_events(text)
    return _dedupe(markdown or _html_index_events(text))


def parse_volleyball_event_page(content: str) -> dict:
    """Read exact market headings and visible selections from one event page.

    Selection labels are only parsed from the accessible markdown heading form.
    Raw HTML can still verify a market heading, but it does not manufacture a
    selection list when the markup cannot be unambiguously sectioned.
    """
    text = unescape(content or '')
    plain = _clean(text)
    headings = []
    heading_re = re.compile(r'(?m)^[ \t]*(?:[-*][ \t]+)?#{3,6}[ \t]+(.+?)\s*$')
    for match in heading_re.finditer(text):
        label = _clean(match.group(1))
        headings.append((match.start(), match.end(), label))

    raw_market_hits = [(start, end, label) for start, end, label in headings if label.lower() in {m.lower() for m in MARKET_NAMES}]
    # The rendered page can repeat a market under “Most Popular Tip” before
    # the full expandable market. The latter has the actual selections.
    by_market = {}
    for hit in raw_market_hits:
        by_market[hit[2].lower()] = hit
    market_hits = sorted(by_market.values())
    if market_hits:
        markets = []
        for index, (start, _end, name) in enumerate(market_hits):
            section_end = market_hits[index + 1][0] if index + 1 < len(market_hits) else len(text)
            selections = []
            for h_start, _h_end, label in headings:
                if not start < h_start < section_end:
                    continue
                lowered = label.lower()
                if lowered in {name.lower(), 'hide selections', 'most popular tip'}:
                    continue
                # Retain actual selection labels, not ancillary headings.
                if lowered not in {m.lower() for m in MARKET_NAMES} and not label.startswith('#'):
                    selections.append(label)
            markets.append({'name': name, 'selections': list(dict.fromkeys(selections))})
    else:
        # Heading-only verification fallback for raw HTML. `plain` does not
        # preserve section positions, so no individual selection is claimed.
        names = [name for name in MARKET_NAMES if re.search(rf'(?<![A-Za-z]){re.escape(name)}(?![A-Za-z])', plain, re.I)]
        markets = [{'name': name, 'selections': []} for name in names]
    names = [row['name'] for row in markets]
    return {
        'markets': markets,
        'markets_on_event_page': names,
        'markets_verified': bool(names),
        'scored_markets': [name for name in names if name in ('Win Match', 'Set Score')],
        'review_only_markets': [name for name in names if name not in ('Win Match', 'Set Score')],
    }
