"""
Pure parser for the OLBG Darts betting-tips index and event pages.

The index (https://www.olbg.com/betting-tips/Darts/15) is server-rendered
HTML observed 2026-09-03. Each event block carries:

  - the event anchor, e.g.
    /betting-tips/Darts/All_Darts/All_Events/World_Series_of_Darts_Finals/15?event_id=31293
  - the event label
  - a date/time label ("17 Sept 13:15", "Today HH:MM")
  - the current tipster-consensus selection as a bold anchor
  - the market that selection belongs to ("Win Tournament")
  - the tip count, e.g. "2/2 Win Tips" and an optional percentage

No price appears anywhere in server-rendered HTML, so no price field is ever
produced (IR-DARTS-01).
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

SPORT_ID = '15'

INDEX_URL = 'https://www.olbg.com/betting-tips/Darts/15'

EVENT_RE = re.compile(
    r'/betting-tips/Darts/All_Darts/All_Events/([^"?]+)/' + SPORT_ID + r'\?event_id=(\d+)'
)
TIPS_RE = re.compile(r'(\d+)\s*/\s*(\d+)\s*(?:Win\s*)?Tips', re.I)
TIME_RE = re.compile(
    r'(?P<label>Today|Tomorrow|Tonight|\d{1,2}\s+[A-Za-z]{3,}(?:\s+\d{4})?)\s+(?P<time>\d{1,2}:\d{2})',
    re.I,
)
MARKET_NAMES = [
    'Win Match', 'Handicap Betting', 'Total Legs', 'Most 180s',
    'Highest Checkout', 'Win Tournament', 'Outright', 'Match Winner',
    'Correct Score', 'Leg Betting', 'To Reach',
]
MARKET_RE = re.compile('|'.join(re.escape(m) for m in MARKET_NAMES), re.I)


class _Text(HTMLParser):
    """Collapse a block to visible text; anchors become [text|href] tokens."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href', '')
            self.parts.append(f' [[A:{href}]] ')
        if tag in ('br', 'p', 'li', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'tr', 'td', 'th'):
            self.parts.append(' ')

    def handle_data(self, data):
        self.parts.append(data)


def _text(html: str) -> str:
    p = _Text()
    p.feed(html)
    return ' '.join(''.join(p.parts).split())


def split_event_blocks(html: str) -> list[str]:
    """Split the index into one raw block per darts event (list items)."""
    blocks = []
    for m in re.finditer(r'<li\b[^>]*>(.*?)</li>', html, re.S | re.I):
        if EVENT_RE.search(m.group(1)):
            blocks.append(m.group(1))
    return blocks


def _anchor_pairs(text: str):
    _boundary = re.compile(
        r'\b(Today|Tomorrow|Tonight)\b|'
        r'\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\b|'
        r'\b(?:%s)\b' % '|'.join(re.escape(x) for x in MARKET_NAMES),
        re.I,
    )
    for m in re.finditer(r'\[\[A:([^]]+)\]\]\s*([^[]*?)(?=\[\[A:|$)', text):
        label = m.group(2)
        cut = _boundary.search(label)
        if cut:
            label = label[:cut.start()]
        yield m.group(1), label.strip(' .,;:-')


def parse_index(html: str) -> list[dict]:
    """Event rows from the OLBG darts index (pure, no network, no prices)."""
    events = []
    seen = set()
    for block in split_event_blocks(html):
        ev = EVENT_RE.search(block)
        if not ev:
            continue
        event_id = ev.group(2)
        if event_id in seen:
            continue
        seen.add(event_id)

        text = _text(block)
        matchup = None
        selection = None
        seen_label = False
        for href, label in _anchor_pairs(text):
            if f'event_id={event_id}' not in href:
                continue
            if not matchup:
                matchup = label
                continue
            if not seen_label and matchup:
                selection = re.sub(r'\s+to\s+win\s+\d+\s*-\s*\d+\s*$', '', label, flags=re.I).strip()
                seen_label = True

        tm = TIME_RE.search(text)
        tips = TIPS_RE.search(text)
        pct = re.search(r'(\d{1,3})\s*%', text)
        market = None
        mm = MARKET_RE.search(text)
        if mm:
            market = mm.group(0)

        is_outright = bool(market and re.search(r'tournament|outright', market, re.I))
        if matchup and not re.search(r'\bv(?:s)?\b', matchup, re.I):
            is_outright = True

        events.append({
            'event_id': event_id,
            'slug': ev.group(1),
            'url': f'https://www.olbg.com/betting-tips/Darts/All_Darts/All_Events/'
                   f'{ev.group(1)}/{SPORT_ID}?event_id={event_id}',
            'matchup': matchup,
            'type': 'outright' if is_outright else 'match',
            'display_time': tm.group('time') if tm else None,
            'display_date_label': tm.group('label') if tm else None,
            'consensus': {
                'market': market,
                'selection': selection,
                'tips_for': int(tips.group(1)) if tips else None,
                'tips_total': int(tips.group(2)) if tips else None,
                'pct': int(pct.group(1)) if pct else None,
            },
        })
    return events


def parse_event_page_markets(html: str) -> list[dict]:
    """Market groups visible on an OLBG darts event page."""
    text = _text(html)
    header_idx = {}
    for m in MARKET_RE.finditer(text):
        header_idx.setdefault(m.start(), m.group(0))

    markets = []
    body_parts = []
    sorted_heads = sorted(header_idx.items(), key=lambda kv: kv[0])
    for i, (pos, name) in enumerate(sorted_heads):
        end = sorted_heads[i + 1][0] if i + 1 < len(sorted_heads) else len(text)
        body_parts.append((name, text[pos + len(name):end]))

    for name, body in body_parts:
        selections = []
        for sm in re.finditer(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+to\s+win\s+(\d+)\s*-\s*(\d+)', body):
            nxt = TIPS_RE.search(body, sm.end())
            pct = re.search(r'(\d{1,3})\s*%', body[sm.end():])
            selections.append({
                'name': f'{sm.group(1).strip()} {sm.group(2)}-{sm.group(3)}',
                'tips_for': int(nxt.group(1)) if nxt else None,
                'tips_total': int(nxt.group(2)) if nxt else None,
                'pct': int(pct.group(1)) if pct else None,
            })
        if not selections:
            for nm in re.finditer(
                r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+[+-]\d+\.\d+)?)\b', body,
            ):
                name_txt = nm.group(1)
                tail = body[nm.end():nm.end() + 40]
                if name_txt.lower() in {'read more', 'show selections', 'hide selections', 'win tips'}:
                    continue
                if 'win tips' in ' '.join(tail.split()).lower() or '%' in tail:
                    nxt = TIPS_RE.search(tail)
                    pct = re.search(r'(\d{1,3})\s*%', tail)
                    selections.append({
                        'name': name_txt,
                        'tips_for': int(nxt.group(1)) if nxt else None,
                        'tips_total': int(nxt.group(2)) if nxt else None,
                        'pct': int(pct.group(1)) if pct else None,
                    })
                if len(selections) >= 8:
                    break
        markets.append({'name': name, 'selections': selections})
    return markets


def parse_player_names(html: str) -> list[str]:
    """Both player names from an event page title/header."""
    text = _text(html)
    name = r'[A-Z][a-z]+(?:\s+(?!Tips\b)(?!Betting\b)[A-Z][a-z]+)*'
    m = re.search(
        rf'\b({name})\s+(?:v|vs)\s+({name})\b',
        text,
    )
    if m:
        return [m.group(1).strip(), m.group(2).strip()]
    return []
