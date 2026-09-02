"""
Pure parsers for OLBG Motor Racing (F1) pages.

Takes an HTML string and returns plain data. No network I/O, so it is testable
without connectivity (see tests/test_f1_olbg_parse.py).

GROUNDING (verified via hosted page fetch on 2026-09-02):
  - Sport index:   https://www.olbg.com/betting-tips/Motor_Racing/14
                   lists season outrights ("Formula 1 Drivers Championship
                   2026" / "Formula 1 Constructors Championship 2026") and
                   per-race events ("Italian Grand Prix" / "Win Race" and
                   "Fastest Qualifier"), each with an `event_id`.
  - All Events:    https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/14
                   same rows, fullest list.
  - Event page:    https://www.olbg.com/betting-tips/Motor_Racing/All_Motor_Racing/All_Events/Italian_Grand_Prix/14?event_id=899
                   publishes per-selection tip counts for ONE market and, in
                   the article body, "Previous ... Grand Prix Winners" and
                   "<Circuit> Circuit Fastest Laps" year lists.
  - OLBG states on the Motor Racing page that F1 tips cover Race Winner,
    Podium Finish and Fastest Lap plus Most Team Points and a Without market.
    Only markets actually observed on the page are recorded by this module.

The anchor pattern below is read directly from observed URLs; the `<li>` block
split is a structural assumption stated inline (the same convention used by the
tennis/cricket parsers, which were verified against saved captures).
"""

from __future__ import annotations

import re

from .olbg_parse import strip_tags, resolve_date  # shared helpers

EVENT_HREF = re.compile(
    r'/betting-tips/Motor_Racing/[A-Za-z0-9_/\-]+/14\?event_id=(\d+)'
)

# Market names observed on OLBG Motor Racing pages (2026-09-02). Order matters:
# the more specific labels are listed first.
MARKET_NAMES = [
    'Fastest Qualifier',
    'Win Race',
    'Win Tournament',
    'Fastest Lap',
    'Podium Finish',
    'Win Podium',
    'Most Team Points',
    'Win Without',
    'Win Match',
    'Race Winner',
]

TIME_TEXT = re.compile(
    r'(?P<label>Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,}(?:\s+\d{4})?)\s+(?P<time>\d{1,2}:\d{2})'
)

TIPS_TEXT = re.compile(r'(?P<for>\d+)\s*/\s*(?P<total>\d+)\s*Win Tips')
PCT_TEXT = re.compile(r'(?P<pct>\d{1,3})\s*%')
COMMENTS_TEXT = re.compile(r'(?P<n>\d+)\s+comment')

# Year lists on event pages: "2025: Max Verstappen (Red Bull Racing)".
YEAR_SELECTION = re.compile(
    r'(?P<year>\d{4})\s*:\s*(?P<name>[A-Z][\w.\'\-À-ÿ ]+?)\s*\((?P<team>[^)]+)\)'
)

EVENT_NAME_MARKERS = ('Grand Prix', 'Championship', 'Race')


def split_blocks(html: str) -> list[str]:
    parts = re.split(r'(?i)<li[\s>]', html)
    return [p for p in parts if EVENT_HREF.search(p)]


def parse_event_href(block: str):
    m = EVENT_HREF.search(block)
    if not m:
        return None
    event_id = m.group(1)
    href = m.group(0)
    slug = href.split('/All_Events/')[-1].split('/14')[0] if '/All_Events/' in href else None
    url = f'https://www.olbg.com{href.split("?")[0]}?event_id={event_id}'
    return event_id, slug, url


def parse_anchor_text(block: str) -> list[str]:
    return [strip_tags(a) for a in re.findall(r'(?is)<a[^>]*>(.*?)</a>', block) if strip_tags(a)]


def is_event_name(text: str) -> bool:
    t = text.strip()
    return any(m in t for m in EVENT_NAME_MARKERS)


def parse_block(block: str, fetch_now=None) -> dict | None:
    ref = parse_event_href(block)
    if not ref:
        return None
    event_id, slug, url = ref
    texts = parse_anchor_text(block)
    plain = strip_tags(block)

    event_anchor = next((t for t in texts if is_event_name(t)), None)
    selection = next((t for t in texts if t != event_anchor and t.strip()), None)
    market = next((m for m in MARKET_NAMES if m in plain), None)
    tm = TIME_TEXT.search(plain)
    tips = TIPS_TEXT.search(plain)
    pct = PCT_TEXT.search(plain)
    comments = COMMENTS_TEXT.search(plain)

    row = {
        'event_id': event_id,
        'url': url,
        'slug': slug,
        'event_name': event_anchor,
        'display_date': tm.group('label') if tm else None,
        'display_time': tm.group('time') if tm else None,
        'type': 'match' if event_anchor and 'Grand Prix' in event_anchor else 'outright',
        'consensus': None,
        'markets_verified': False,
        'track_history': None,
    }
    if market and selection and tips:
        row['consensus'] = {
            'market': market,
            'selection': selection,
            'tips_for': int(tips.group('for')),
            'tips_total': int(tips.group('total')),
            'pct': int(pct.group('pct')) if pct else None,
            'comments': int(comments.group('n')) if comments else 0,
            'experts': 1 if 'expert' in plain else 0,
        }
    if fetch_now is not None:
        iso, basis = resolve_date(row.get('display_date'), fetch_now)
        row['resolved_date'] = iso
        row['date_basis'] = basis
    return row


def parse_index(html: str) -> tuple[list[dict], list[dict]]:
    matches, outrights = [], []
    seen = set()
    for block in split_blocks(html):
        row = parse_block(block)
        if not row or row['event_id'] in seen:
            continue
        seen.add(row['event_id'])
        (matches if row['type'] == 'match' else outrights).append(row)
    return matches, outrights


def parse_event_page_markets(html: str) -> list[str]:
    """Markets actually named in section headings of an event page.

    Conservative: a market is only recorded when it appears in an explicit
    heading (h3/h4/h5) — prose mentions ("fastest lap setter", "podium and
    points finishes") are not counted as offered markets.
    """
    headings = re.findall(r'(?is)<h[3-5][^>]*>(.*?)</h[3-5]>', html)
    # History-style headings are article content, not markets.
    plain_headings = [
        strip_tags(h) for h in headings
        if not re.search(r'winners|fastest laps|previous|past|history', strip_tags(h), re.I)
    ]
    return [m for m in MARKET_NAMES if m in ' '.join(plain_headings)]


def parse_track_history(html: str) -> list[dict]:
    """Parse year lists in the event-page article (winners / fastest laps)."""
    plain = strip_tags(html)
    out = []
    for m in YEAR_SELECTION.finditer(plain):
        out.append({
            'year': int(m.group('year')),
            'name': m.group('name').strip(),
            'team': m.group('team').strip(),
        })
    return out
