"""
Pure parser for OLBG Gaelic Football (25) and Hurling (26) indexes.
No prices are ever produced (IR-GAA-01).
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

FOOTBALL_ID = '25'
HURLING_ID = '26'
FOOTBALL_INDEX = 'https://www.olbg.com/betting-tips/Gaelic_Football/25'
HURLING_INDEX = 'https://www.olbg.com/betting-tips/Hurling/26'

TIPS_RE = re.compile(r'(\d+)\s*/\s*(\d+)\s*(?:Win\s*)?Tips', re.I)
TIME_RE = re.compile(
    r'(?P<label>Today|Tomorrow|Tonight|\d{1,2}\s+[A-Za-z]{3,}(?:\s+\d{4})?)\s+(?P<time>\d{1,2}:\d{2})',
    re.I,
)
MARKET_NAMES = [
    'Win Match', 'FT Result', 'Win Tournament', 'Win Hurling', 'Outright',
    'Match Winner', 'Handicap Betting', 'Total Points',
]
MARKET_RE = re.compile('|'.join(re.escape(m) for m in MARKET_NAMES), re.I)


def event_re(sport_id: str, slug_folder: str) -> re.Pattern:
    return re.compile(
        rf'/betting-tips/{slug_folder}/All_{slug_folder}/All_Events/([^"?]+)/{sport_id}\?event_id=(\d+)'
    )


class _Text(HTMLParser):
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


def split_event_blocks(html: str, ere: re.Pattern) -> list[str]:
    blocks = []
    for m in re.finditer(r'<li\b[^>]*>(.*?)</li>', html, re.S | re.I):
        if ere.search(m.group(1)):
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


def parse_index(html: str, *, sport_id: str = FOOTBALL_ID, slug_folder: str = 'Gaelic_Football') -> list[dict]:
    ere = event_re(sport_id, slug_folder)
    events = []
    seen = set()
    for block in split_event_blocks(html, ere):
        ev = ere.search(block)
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
        is_outright = bool(market and re.search(r'tournament|outright|hurling', market, re.I) and 'Win Match' not in (market or '') and 'FT Result' not in (market or ''))
        if matchup and not re.search(r'\bv(?:s)?\b', matchup, re.I):
            is_outright = True
        events.append({
            'event_id': event_id,
            'slug': ev.group(1),
            'url': f'https://www.olbg.com/betting-tips/{slug_folder}/All_{slug_folder}/All_Events/'
                   f'{ev.group(1)}/{sport_id}?event_id={event_id}',
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


def parse_team_names(html: str) -> list[str]:
    text = _text(html)
    name = r'[A-Z][A-Za-z0-9\'.]+(?:\s+(?!Tips\b)(?!Betting\b)[A-Z][A-Za-z0-9\'.]+)*'
    m = re.search(rf'\b({name})\s+(?:v|vs)\s+({name})\b', text)
    if m:
        return [m.group(1).strip(), m.group(2).strip()]
    return []
