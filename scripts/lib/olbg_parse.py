"""
Pure parsers for OLBG tennis pages.

These functions take an HTML string and return plain data. They do no network
I/O, so they can be tested without connectivity (see tests/test_olbg_parse.py).

GROUNDING: the anchor pattern, the event_id parameter, the market names and the
"n/m Win Tips" / "n%" / "n comments" formats below were all read directly from a
live fetch of https://www.olbg.com/betting-tips/Tennis/3 on 2026-08-31. Where
this module has to make a structural assumption about OLBG's markup it says so
inline, and the caller records the result as unverified until a real capture
confirms it.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

EVENT_HREF = re.compile(
    r'/betting-tips/Tennis/[A-Za-z0-9_/]+/3\?event_id=(\d+)'
)

# A match anchor's text contains " vs ". Outright anchors do not.
VS_TEXT = re.compile(r'^(?P<home>.+?)\s+vs\s+(?P<away>.+?)$')

TIME_TEXT = re.compile(
    r'(?P<label>Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,})\s+(?P<time>\d{1,2}:\d{2})'
)

TIPS_TEXT = re.compile(r'(?P<for>\d+)\s*/\s*(?P<total>\d+)\s*Win Tips')
PCT_TEXT = re.compile(r'(?P<pct>\d{1,3})\s*%')
COMMENTS_TEXT = re.compile(r'(?P<n>\d+)\s+comment')

# Market names observed on OLBG tennis pages. Order matters: "1st Set Winner"
# must be tested before "Set Betting" style prefixes are considered.
MARKET_NAMES = [
    'Win Tournament',
    '1st Set Winner',
    'Win Match',
    'Games Won',
    'Total Games',
    'Set Betting',
]

TAG_RE = re.compile(r'<[^>]+>')
WS_RE = re.compile(r'\s+')


def strip_tags(html: str) -> str:
    """Remove tags and collapse whitespace. Entities are decoded for the few
    characters that actually appear in OLBG tips text."""
    text = TAG_RE.sub(' ', html)
    text = (text.replace('&amp;', '&').replace('&nbsp;', ' ')
                .replace('&#39;', "'").replace('&quot;', '"')
                .replace('&lt;', '<').replace('&gt;', '>'))
    return WS_RE.sub(' ', text).strip()


def split_blocks(html: str) -> list[str]:
    """
    Split the page into candidate event blocks.

    OLBG renders each tip as a list item. Splitting on '<li' is an assumption
    about markup structure; it is deliberately coarse — each block is then
    validated by requiring an event anchor inside it, so a wrong split yields
    fewer events rather than wrong ones.
    """
    parts = re.split(r'(?i)<li[\s>]', html)
    return [p for p in parts if EVENT_HREF.search(p)]


def parse_event_href(block: str):
    """Return (event_id, slug, url) for the first event anchor in a block."""
    m = EVENT_HREF.search(block)
    if not m:
        return None
    event_id = m.group(1)
    href = m.group(0)
    slug = href.split('/All_Events/')[-1].split('/3')[0] if '/All_Events/' in href else None
    return event_id, slug, f'https://www.olbg.com{href.split("?")[0]}?event_id={event_id}'


def parse_anchor_text(block: str) -> list[str]:
    """Text of every anchor in the block, in document order."""
    return [strip_tags(a) for a in re.findall(r'(?is)<a[^>]*>(.*?)</a>', block) if strip_tags(a)]


def parse_block(block: str) -> dict | None:
    """Parse one event block into a slate row, or None if it is not an event."""
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

    # The selection is the anchor text that is not the "A vs B" header.
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
        row['away'] = mv.group('away').strip()
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
    """Parse a tips index page into (matches, outrights)."""
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
    """
    Resolve OLBG's 'Today' / 'Tomorrow' / '01 Sept' labels to an ISO date.

    OLBG renders UK local time. The label alone is not a timestamp, so the
    resolution is *derived* from the fetch time and is returned with an explicit
    basis of 'derived' or 'observed' so downstream consumers can tell them apart.
    """
    if not display_date:
        return None, 'unknown'
    label = display_date.strip()
    if label == 'Today':
        return fetch_time.date().isoformat(), 'derived'
    if label == 'Tomorrow':
        return (fetch_time.date() + timedelta(days=1)).isoformat(), 'derived'

    m = re.match(r'^(\d{1,2})\s+([A-Za-z]{3,})$', label)
    if not m:
        return None, 'unknown'
    day = int(m.group(1))
    month = MONTHS.get(m.group(2)[:3].title())
    if not month:
        return None, 'unknown'
    year = fetch_time.year
    try:
        candidate = date(year, month, day)
    except ValueError:
        return None, 'unknown'
    # OLBG only lists upcoming events, so a resolved date before the fetch date
    # means the label referred to next year.
    if candidate < fetch_time.date():
        candidate = date(year + 1, month, day)
    return candidate.isoformat(), 'observed'


def parse_event_page_markets(html: str) -> list[str]:
    """
    Market names present on a single event page.

    Verified against event 899350 on 2026-08-31, which exposed:
    Win Match, Set Betting, 1st Set Winner, Games Won, Total Games.
    """
    plain = strip_tags(html)
    return [m for m in MARKET_NAMES if m in plain]


def parse_games_won_selections(html: str) -> list[dict]:
    """
    Extract Games Won handicap selections such as "Carlos Alcaraz -5.50" /
    "Roman Safiullin +5.50". These labels are the only place a handicap line is
    published in OLBG's server-rendered HTML.
    """
    plain = strip_tags(html)
    out = []
    for m in re.finditer(r'([A-Z][\w\.\-\']+(?:\s+[A-Z][\w\.\-\']+){0,3})\s+([+-]\d+(?:\.\d+)?)', plain):
        name, line = m.group(1).strip(), m.group(2)
        if len(name.split()) < 2 or len(name) < 5:
            continue
        out.append({'player': name, 'line': float(line)})
    return out
