"""
Pure parsers for OLBG Golf pages.

Takes an HTML string and returns plain data. No network I/O, so it is testable
without connectivity (see tests/test_golf_olbg_parse.py).

GROUNDING (verified via hosted page fetch on 2026-09-02):
  - Sport index:   https://www.olbg.com/betting-tips/Golf/5
                   lists one row per event/market with an `event_id`, e.g.
                   "Omega European Masters" / "Win Tournament" / "Ryan Gerard"
                   / "2/4 Win Tips" / "50%" and a date such as "06 Sept 12:00".
  - Event page:    https://www.olbg.com/betting-tips/Golf/All_Golf/All_Events/Omega_European_Masters/5?event_id=101769
  - The index page also carries an editorial "in-form golfers" table
    ("Player (OWGR) (Tour) | Wins | Top 6's") and the OWGR top-15 table with
    links to https://www.owgr.com/playerprofile/{slug}-{id}. Both are article
    content and are parsed only for display/cross-checking, never for scoring.
  - OLBG's golf page states that tips cover the PGA Tour, DP World Tour, LPGA,
    Champions Tour, Korn Ferry Tour and the majors; typical golf markets on
    OLBG are Win Tournament, Top 5/10/20 Finish, First Round Leader, Top
    European / American / GB & Ireland, Winning Nationality and Make/Miss Cut.
    Only markets actually observed on a page are recorded.
"""

from __future__ import annotations

import re

from .olbg_parse import strip_tags, resolve_date  # shared helpers

EVENT_HREF = re.compile(
    r'/betting-tips/Golf/[A-Za-z0-9_/\-%]+/5\?event_id=(\d+)'
)

# Market names observed or documented on OLBG golf pages. Order matters: the
# more specific labels are tested first.
MARKET_NAMES = [
    'First Round Leader',
    '1st Round Leader',
    'Top European',
    'Top American',
    'Top GB & Ireland',
    'Top GB and Ireland',
    'Top British',
    'Top Irish',
    'Top Australian',
    'Top Asian',
    'Top Continental European',
    'Top Rest of World',
    'Top 5 Finish',
    'Top 6 Finish',
    'Top 10 Finish',
    'Top 20 Finish',
    'Top 40 Finish',
    'Winning Nationality',
    'Winning Score',
    'Make The Cut',
    'Miss The Cut',
    'To Make Cut',
    'To Miss Cut',
    'Tournament Match Bets',
    'Round Match Bets',
    '2 Balls',
    '3 Balls',
    'Win Tournament',
    'Outright Winner',
    'Each Way',
]

TIME_TEXT = re.compile(
    r'(?P<label>Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,}(?:\s+\d{4})?)\s+(?P<time>\d{1,2}:\d{2})'
)

TIPS_TEXT = re.compile(r'(?P<for>\d+)\s*/\s*(?P<total>\d+)\s*Win Tips')
PCT_TEXT = re.compile(r'(?P<pct>\d{1,3})\s*%')
COMMENTS_TEXT = re.compile(r'(?P<n>\d+)\s+comment')

# Editorial "in-form" table row:  "Scottie Scheffler (1) (PGA) | 2 (30/8/26) | 0"
# The name is two to four capitalised words immediately before "(OWGR) (Tour)".
FORM_ROW = re.compile(
    r"(?P<name>(?:[A-Z][\w.'\-]+\s+){1,3}[A-Z][\w.'\-]+)\s*\((?P<owgr>\d+|n/a)\)\s*\((?P<tour>[A-Za-z ]+)\)"
)

OWGR_LINK = re.compile(
    r'https://www\.owgr\.com/playerprofile/(?P<slug>[a-z0-9\-]+?)-(?P<id>\d+)'
)

EVENT_NAME_MARKERS = (
    'Open', 'Championship', 'Masters', 'Classic', 'Invitational', 'Cup',
    'Tournament', 'Challenge', 'Legends', 'Series', 'Pro-Am', 'Players',
    'Championships', 'Trophy', 'Match', 'Q-School',
)

TEAM_EVENT_MARKERS = ('Ryder Cup', 'Presidents Cup', 'Solheim Cup', 'Walker Cup', 'Curtis Cup')


def split_blocks(html: str) -> list[str]:
    parts = re.split(r'(?i)<li[\s>]', html)
    return [p for p in parts if EVENT_HREF.search(p)]


def parse_event_href(block: str):
    m = EVENT_HREF.search(block)
    if not m:
        return None
    event_id = m.group(1)
    href = m.group(0)
    slug = href.split('/All_Events/')[-1].split('/5')[0] if '/All_Events/' in href else None
    url = f'https://www.olbg.com{href.split("?")[0]}?event_id={event_id}'
    return event_id, slug, url


def parse_anchor_text(block: str) -> list[str]:
    return [strip_tags(a) for a in re.findall(r'(?is)<a[^>]*>(.*?)</a>', block) if strip_tags(a)]


def is_event_name(text: str) -> bool:
    t = text.strip()
    if any(m in t for m in TEAM_EVENT_MARKERS):
        return True
    return any(re.search(rf'\b{re.escape(m)}\b', t) for m in EVENT_NAME_MARKERS)


def classify_event(name: str | None) -> str:
    if not name:
        return 'tournament'
    if any(m in name for m in TEAM_EVENT_MARKERS):
        return 'team'
    return 'tournament'


def parse_block(block: str, fetch_now=None) -> dict | None:
    ref = parse_event_href(block)
    if not ref:
        return None
    event_id, slug, url = ref
    texts = parse_anchor_text(block)
    plain = strip_tags(block)

    event_anchor = next((t for t in texts if is_event_name(t)), None)
    if event_anchor is None and slug:
        event_anchor = slug.replace('_', ' ')
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
        'type': classify_event(event_anchor),
        'consensus': None,
        'markets_verified': False,
    }
    if market and selection and tips:
        row['consensus'] = {
            'market': market,
            'selection': selection,
            'tips_for': int(tips.group('for')),
            'tips_total': int(tips.group('total')),
            'pct': int(pct.group('pct')) if pct else None,
            'comments': int(comments.group('n')) if comments else 0,
            'experts': 1 if 'expert' in plain.lower() else 0,
        }
    if fetch_now is not None:
        iso, basis = resolve_date(row.get('display_date'), fetch_now)
        row['resolved_date'] = iso
        row['date_basis'] = basis
    return row


def parse_index(html: str) -> tuple[list[dict], list[dict]]:
    """Return (tournament rows, team-event rows), de-duplicated by event_id."""
    tournaments, teams = [], []
    seen = set()
    for block in split_blocks(html):
        row = parse_block(block)
        if not row or row['event_id'] in seen:
            continue
        seen.add(row['event_id'])
        (teams if row['type'] == 'team' else tournaments).append(row)
    return tournaments, teams


def parse_event_page_markets(html: str) -> list[str]:
    """Markets named in explicit section headings (h2-h5) of an event page.

    Conservative: prose mentions are not counted as offered markets.
    """
    headings = re.findall(r'(?is)<h[2-5][^>]*>(.*?)</h[2-5]>', html)
    plain_headings = [
        strip_tags(h) for h in headings
        if not re.search(r'winners|previous|past|history|course|who is|when will|which', strip_tags(h), re.I)
    ]
    joined = ' '.join(plain_headings)
    return [m for m in MARKET_NAMES if m in joined]


def parse_form_table(html: str) -> list[dict]:
    """Editorial in-form table on the golf index: player, OWGR, tour label."""
    plain = strip_tags(html)
    out = []
    seen = set()
    for m in FORM_ROW.finditer(plain):
        name = m.group('name').strip()
        if name.lower() in seen or len(name) < 4:
            continue
        seen.add(name.lower())
        owgr = m.group('owgr')
        out.append({
            'name': name,
            'owgr': int(owgr) if owgr.isdigit() else None,
            'tour': m.group('tour').strip(),
        })
    return out


def parse_owgr_links(html: str) -> list[dict]:
    """OWGR player-profile links embedded in the index article (top-15 table)."""
    out = []
    seen = set()
    for m in OWGR_LINK.finditer(html):
        if m.group('id') in seen:
            continue
        seen.add(m.group('id'))
        out.append({'owgr_id': m.group('id'), 'slug': m.group('slug'), 'url': m.group(0)})
    return out
