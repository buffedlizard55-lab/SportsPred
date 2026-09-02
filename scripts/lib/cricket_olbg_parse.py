"""
Pure parsers for OLBG cricket tips pages.

Takes an HTML string and returns plain data. No network I/O, so it is testable
without connectivity (see tests/test_cricket_olbg_parse.py).

GROUNDING: the anchor pattern /betting-tips/Cricket/.../7?event_id=NNNN, the
"n/m Win Tips", "n%", "n comments", "1 expert" strings and the market labels
("Win Match", "Man Of The Match", "Draw No Bet", "Outright Winner") were read
directly from a live fetch of https://www.olbg.com/betting-tips/Cricket/16 on
2026-09-01. Any structural assumption is stated inline.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

EVENT_HREF = re.compile(
    r'/betting-tips/Cricket/[A-Za-z0-9_/\-]+/7\?event_id=(\d+)'
)

# A match anchor's text contains " vs ". Outright anchors do not.
VS_TEXT = re.compile(
    r'^(?P<home>.+?)\s+vs\s+(?P<away>.+?)'
    r'(?:\s+(?:T20|ODI|Test|2nd\s+ODI|1st\s+ODI|3rd\s+ODI|2nd\s+T20I|1st\s+T20I))?$',
    re.IGNORECASE,
)

TIME_TEXT = re.compile(
    r'(?P<label>Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,}(?:\s+\d{4})?)\s+(?P<time>\d{1,2}:\d{2})'
)

TIPS_TEXT = re.compile(r'(?P<for>\d+)\s*/\s*(?P<total>\d+)\s*Win Tips')
PCT_TEXT = re.compile(r'(?P<pct>\d{1,3})\s*%')
COMMENTS_TEXT = re.compile(r'(?P<n>\d+)\s+comment')

# Market names observed on OLBG cricket pages (checked 2026-09-01). Order
# matters: "Man Of The Match" and "Draw No Bet" are specific.
MARKET_NAMES = [
    'Man Of The Match',
    'Man of the Match',
    'Draw No Bet',
    'Outright Winner',
    'Win Match',
    'Top Batsman',
    'Total Runs',
]

TAG_RE = re.compile(r'<[^>]+>')
WS_RE = re.compile(r'\s+')


def strip_tags(html: str) -> str:
    text = TAG_RE.sub(' ', html)
    text = (text.replace('&amp;', '&').replace('&nbsp;', ' ')
                .replace('&#39;', "'").replace('&quot;', '"')
                .replace('&lt;', '<').replace('&gt;', '>'))
    return WS_RE.sub(' ', text).strip()


def split_blocks(html: str) -> list[str]:
    """Split the page into candidate event blocks (one tip per <li>)."""
    parts = re.split(r'(?i)<li[\s>]', html)
    return [p for p in parts if EVENT_HREF.search(p)]


def parse_event_href(block: str):
    m = EVENT_HREF.search(block)
    if not m:
        return None
    event_id = m.group(1)
    href = m.group(0)
    slug = href.split('/All_Events/')[-1].split('/7')[0] if '/All_Events/' in href else None
    url = f'https://www.olbg.com{href.split("?")[0]}?event_id={event_id}'
    return event_id, slug, url


def parse_anchor_text(block: str) -> list[str]:
    return [strip_tags(a) for a in re.findall(r'(?is)<a[^>]*>(.*?)</a>', block) if strip_tags(a)]


def parse_block(block: str) -> dict | None:
    ref = parse_event_href(block)
    if not ref:
        return None
    event_id, slug, url = ref

    texts = parse_anchor_text(block)
    match_anchor = next((t for t in texts if VS_TEXT.match(t)), None)
    plain = strip_tags(block)

    tm = TIME_TEXT.search(plain)
    tips = TIPS_TEXT.search(plain)
    pct = PCT_TEXT.search(plain)
    comments = COMMENTS_TEXT.search(plain)

    selection = next((t for t in texts if t != match_anchor), None)
    market = next((m for m in MARKET_NAMES if m in plain), None)

    row = {
        'event_id': event_id,
        'url': url,
        'slug': slug,
        'display_date': tm.group('label') if tm else None,
        'display_time': tm.group('time') if tm else None,
        'consensus': None,
    }

    if match_anchor:
        mv = VS_TEXT.match(match_anchor)
        row['type'] = 'match'
        row['home'] = mv.group('home').strip()
        away = mv.group('away').strip()
        # Normalise a trailing format/match suffix e.g. "... Falcons T20",
        # "Ireland W 2nd ODI". The match number isn't part of the team name.
        away = re.sub(
            r'\s+((T20|ODI|Test|T20I)(\s+(T20|ODI|Test|T20I))?|\d+(st|nd|rd|th)\s+(ODI|T20I|T20|Test|Match))$',
            '', away, flags=re.IGNORECASE)
        row['away'] = away
    else:
        row['type'] = 'outright'
        row['name'] = texts[0] if texts else slug

    if selection and market and tips:
        row['consensus'] = {
            'market': market,
            'selection': selection,
            'tips_for': int(tips.group('for')),
            'tips_total': int(tips.group('total')),
            'pct': int(pct.group('pct')) if pct else None,
            'comments': int(comments.group('n')) if comments else 0,
            'experts': 1 if 'expert' in plain else 0,
        }
    return row


def parse_index(html: str) -> tuple[list[dict], list[dict]]:
    """Parse a cricket tips index into (matches, outrights)."""
    matches, outrights = [], []
    seen = set()
    for block in split_blocks(html):
        row = parse_block(block)
        if not row or row['event_id'] in seen:
            continue
        seen.add(row['event_id'])
        (matches if row['type'] == 'match' else outrights).append(row)
    return matches, outrights


MONTHS = {m: i for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], start=1)}


def resolve_date(display_date: str, fetch_time: datetime) -> tuple[str | None, str]:
    """Resolve OLBG's 'Today'/'Tomorrow'/'05 Sept'/'26 Nov 2027' labels."""
    if not display_date:
        return None, 'unknown'
    label = display_date.strip()
    if label == 'Today':
        return fetch_time.date().isoformat(), 'derived'
    if label == 'Tomorrow':
        return (fetch_time.date() + timedelta(days=1)).isoformat(), 'derived'

    m = re.match(r'^(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?$', label)
    if not m:
        return None, 'unknown'
    day = int(m.group(1))
    month = MONTHS.get(m.group(2)[:3].title())
    if not month:
        return None, 'unknown'
    year = int(m.group(3)) if m.group(3) else fetch_time.year
    try:
        candidate = date(year, month, day)
    except ValueError:
        return None, 'unknown'
    if not m.group(3) and candidate < fetch_time.date():
        candidate = date(year + 1, month, day)
    return candidate.isoformat(), 'observed'
