"""
Pure parser for the OLBG greyhound betting-tips index and event pages.

The index (https://www.olbg.com/betting-tips/Greyhounds/28) is server-rendered
HTML. Each race block carries:
  - the event link, e.g. /betting-tips/Greyhounds/.../8:47_Yarmouth/28?event_id=682293
  - the event label ("8:47 Yarmouth") and "Today"/"Tomorrow" context
  - the most-tipped runner name as a bolded link
  - the tip consensus, e.g. "2/2 Win Tips" and "100%"

This module extracts only what is visibly printed. No odds are present in the
server HTML (prices render client-side), so no price field is ever produced.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

EVENT_RE = re.compile(
    r'/betting-tips/Greyhounds/All_Greyhounds/All_Events/([^"?]+)/28\?event_id=(\d+)'
)
TIPS_RE = re.compile(r'(\d+)\s*/\s*(\d+)\s*Win\s*Tips', re.I)
PCT_RE = re.compile(r'(\d{1,3})\s*%')
LABEL_RE = re.compile(r'^(\d{1,2}):(\d{2})\s+(.+)$')


class _Text(HTMLParser):
    """Collapse a block to visible text with anchors as [text|href] tokens."""

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href', '')
            self.parts.append(f' [[A:{href}]] ')
        if tag in ('br', 'p', 'li', 'div'):
            self.parts.append(' ')

    def handle_data(self, data):
        self.parts.append(data)


def _text(block: str) -> str:
    parser = _Text()
    parser.feed(block)
    txt = ' '.join(''.join(parser.parts).split())
    return txt


def split_event_blocks(html: str) -> list[str]:
    """Split the index HTML into one block per greyhound event (list items)."""
    blocks = []
    for m in re.finditer(r'<li\b[^>]*>(.*?)</li>', html, re.S | re.I):
        block = m.group(1)
        if EVENT_RE.search(block):
            blocks.append(block)
    return blocks


def parse_event_block(block: str) -> dict | None:
    ev = EVENT_RE.search(block)
    if not ev:
        return None
    slug, event_id = ev.group(1), ev.group(2)

    # Label and the tipster-consensus runner come from anchors into the event.
    label = None
    selection = None
    for am in re.finditer(r'\[\[A:([^]]+)\]\]\s*([^\[]*?)(?=\[\[A:|$)', _text(block)):
        href, txt = am.group(1), am.group(2).strip()
        if f'event_id={event_id}' not in href:
            continue
        # The anchor label itself ("8:47 Yarmouth") precedes any "Today …" text.
        lm = re.match(r'^\s*(\d{1,2}):(\d{2})\s+(.+?)\s*(?:\b(?:Today|Tomorrow|Tonight)\b|$)', txt, re.I)
        if lm and label is None:
            label = f"{lm.group(1)}:{lm.group(2)} {lm.group(3).strip()}"
            continue
        clean = re.sub(r'\s+', ' ', txt).strip()
        # Drop page furniture trailing the runner anchor ("Daily Races",
        # "Today 15:47", tip counts, comments).
        clean = re.split(
            r'\b(Daily Races|Today|Tomorrow|Tonight|Win Tips|\d+\s*/\s*\d+|\d{1,3}%)\b',
            clean,
        )[0].strip(' :-,')
        if clean and label is not None and selection is None:
            selection = clean

    txt = _text(block)
    tips = TIPS_RE.search(txt)
    pct = PCT_RE.search(txt)

    track = None
    display_time = None
    if label:
        lm = LABEL_RE.match(label)
        if lm:
            display_time = f"{lm.group(1)}:{lm.group(2)}"
            track = lm.group(3).strip()

    return {
        'event_id': event_id,
        'slug': slug,
        'url': f'https://www.olbg.com{ev.group(0)}'.split('?')[0] + f'?event_id={event_id}',
        'event_name': label,
        'display_time': display_time,
        'track': track,
        'selection': selection,
        'tips_for': int(tips.group(1)) if tips else None,
        'tips_total': int(tips.group(2)) if tips else None,
        'pct': int(pct.group(1)) if pct else None,
    }


def parse_index(html: str) -> list[dict]:
    events = []
    seen = set()
    for block in split_event_blocks(html):
        row = parse_event_block(block)
        if not row or row['event_id'] in seen:
            continue
        seen.add(row['event_id'])
        events.append(row)
    events.sort(key=lambda e: e.get('display_time') or '')
    return events


def parse_event_runners(html: str) -> list[dict]:
    """Event page: every runner named for the race, for cross-checking draws."""
    names = []
    # Runner selections appear as bold anchors into the same event with tip
    # counts beside them; collect anchor texts that are not the event label.
    txt = _text(html)
    for am in re.finditer(r'\[\[A:([^]]+)\]\]\s*([^\[]*?)(?=\[\[A:|$)', txt):
        href, label = am.group(1), am.group(2).strip()
        if '/betting-tips/Greyhounds/' not in href:
            continue
        label = re.sub(r'\s+', ' ', label).strip()
        if not label or LABEL_RE.match(label):
            continue
        if label.lower() in {'add', 'read more', 'win'}:
            continue
        names.append(label)
    # De-duplicate, preserve order.
    seen, out = set(), []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out
