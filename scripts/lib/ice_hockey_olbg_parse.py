"""
Pure parser for the OLBG Ice Hockey betting-tips index and event pages.

Grounding: observed 2026-09-02 from a live fetch of
  https://www.olbg.com/betting-tips/Ice_Hockey/13
The index is server-rendered HTML. Each market row carries:
  - an anchor to /betting-tips/Ice_Hockey/<League_Path>/<Home_vs_Away>/13?event_id=NNNNNN
  - the fixture label, printed as "Home vs Away"
  - a league label, e.g. "Switzerland NLA", "Finland SM Liiga", "NHL"
  - a kickoff label, e.g. "15 Sept  13:45" or "Today 19:00"
  - a consensus market label, e.g. "Money Line"
  - tip counts like "3/3 Win Tips" and a percentage like "100%"

HONESTY RULES
  - Only what is visibly printed is parsed. No price is ever produced: the OLBG
    server HTML for ice hockey carries tipster vote counts, not bookmaker odds.
  - A row whose fixture label cannot be split into two team names is skipped
    and reported in `warnings`, never repaired by guessing.
  - Dates are resolved against the year implied by the label; a label whose
    month has already passed is taken as next year, and that inference is
    recorded on the row as `date_inferred_year: true`.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

SPORT_ID = "13"
SPORT_SLUG = "Ice_Hockey"
INDEX_URL = f"https://www.olbg.com/betting-tips/{SPORT_SLUG}/{SPORT_ID}"

EVENT_HREF_RE = re.compile(
    r"/betting-tips/Ice_Hockey/([^\"?]+?)/13\?event_id=(\d+)"
)
# An anchor block for one market row: href, then the printed link text.
ANCHOR_RE = re.compile(
    r"<a[^>]+href=\"/betting-tips/Ice_Hockey/([^\"?]+?)/13\?event_id=(\d+)\"[^>]*>(.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
VS_TEXT = re.compile(r"^(?P<home>.+?)\s+vs\.?\s+(?P<away>.+?)\s*$", re.IGNORECASE)
TIME_TEXT = re.compile(r"(?P<label>Today|Tomorrow|\d{1,2}\s+[A-Za-z]{3,})\s+(?P<time>\d{1,2}:\d{2})")
TIPS_TEXT = re.compile(r"(?P<for>\d+)\s*/\s*(?P<total>\d+)\s*Win Tips")
PCT_TEXT = re.compile(r"(?P<pct>\d{1,3})\s*%")

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# League paths seen on the index. Used only to label rows, never to invent them.
KNOWN_LEAGUE_PATHS = [
    "NHL", "KHL", "EIHL", "SHL", "Other/Finland_SM_Liiga", "Other/Switzerland_NLA",
    "Other/Sweden_SHL", "Other/Germany_DEL", "Other/Czech_Extraliga",
]


def strip_tags(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment or "")
    text = text.replace("&amp;", "&").replace("&#39;", "'").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def split_fixture(label: str):
    """'Davos vs SCL Tigers' -> ('Davos', 'SCL Tigers'). None when unsplittable."""
    m = VS_TEXT.match((label or "").strip())
    if not m:
        return None
    home = m.group("home").strip()
    away = m.group("away").strip()
    if not home or not away:
        return None
    return home, away


def resolve_date(label: str, time_text: str, now: datetime | None = None) -> dict:
    """
    Turn the printed kickoff label into an ISO date. The OLBG label has no year,
    so the year is inferred and the inference is flagged.
    """
    now = now or datetime.utcnow()
    m = TIME_TEXT.search(f"{label} {time_text}" if label else time_text or "")
    if not m:
        return {"display_date": f"{label} {time_text}".strip(), "resolved_date": None,
                "time": None, "date_inferred_year": False, "parse_error": "kickoff label not recognised"}

    raw_label = m.group("label").strip()
    clock = m.group("time")
    target = None
    inferred = False

    if raw_label.lower() == "today":
        target = now.date()
    elif raw_label.lower() == "tomorrow":
        target = (now + timedelta(days=1)).date()
    else:
        parts = raw_label.split()
        if len(parts) == 2:
            day = int(parts[0])
            month = MONTHS.get(parts[1][:3].lower())
            if month:
                year = now.year
                candidate = date(year, month, day)
                if candidate < (now - timedelta(days=1)).date():
                    year += 1
                    inferred = True
                target = date(year, month, day)

    if target is None:
        return {"display_date": f"{raw_label} {clock}".strip(), "resolved_date": None,
                "time": clock, "date_inferred_year": inferred, "parse_error": "date not resolvable"}

    return {
        "display_date": f"{raw_label} {clock}".strip(),
        "resolved_date": target.isoformat(),
        "time": clock,
        "date_inferred_year": inferred,
        "parse_error": None,
    }


def parse_index(html: str, now: datetime | None = None) -> dict:
    """
    Parse the ice hockey index page.

    Returns {"events": [...], "warnings": [...], "markets_seen": [...]}.
    Each event records only printed facts plus its own URL for manual review.
    """
    now = now or datetime.utcnow()
    events = []
    warnings = []
    markets_seen = set()
    seen_ids = set()

    # Anchor blocks: the href, the anchor's own link text, then the card body.
    for m in ANCHOR_RE.finditer(html or ""):
        league_path, event_id, inner = m.group(1), m.group(2), m.group(3)
        if event_id in seen_ids:
            continue
        tail = html[m.end(): m.end() + 4000]
        text = strip_tags(tail)

        # The fixture label is the anchor's link text ("Davos vs SCL Tigers").
        fixture = split_fixture(strip_tags(inner))
        if not fixture:
            # Fall back to the card body only when the anchor text carries no label.
            for candidate in re.findall(r"([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .&'-]*?)\s+vs\.?\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .&'-]*)", text):
                pair = split_fixture(f"{candidate[0]} vs {candidate[1]}")
                if pair:
                    fixture = pair
                    break

        if not fixture:
            warnings.append(f"event_id={event_id}: fixture label could not be split into two team names")
            continue

        home, away = fixture
        kickoff = TIME_TEXT.search(text)
        date_info = resolve_date("", kickoff.group(0) if kickoff else "", now)

        tips = TIPS_TEXT.search(text)
        pct = PCT_TEXT.search(text)
        # The href is <League_Path>/<Home_vs_Away>; the trailing segment is the
        # fixture slug, not part of the league label.
        segments = [s for s in league_path.split("/") if s]
        league_path_clean = "/".join(segments[:-1]) if len(segments) > 1 else ""
        league = league_path_clean.replace("Other/", "").replace("_", " ").strip() or "Ice Hockey"

        # The consensus market printed on the index card.
        market = None
        for name in ("Money Line", "Puck Line", "Total Goals", "Handicap", "Win Match"):
            if name.lower() in text.lower():
                market = name
                break
        if market:
            markets_seen.add(market)

        events.append({
            "event_id": event_id,
            "url": f"https://www.olbg.com/betting-tips/Ice_Hockey/{league_path}/13?event_id={event_id}",
            "league_path": league_path,
            "league": league,
            "home": home,
            "away": away,
            "market": market,
            "tips_for": int(tips.group("for")) if tips else None,
            "tips_total": int(tips.group("total")) if tips else None,
            "tip_pct": int(pct.group("pct")) if pct else None,
            "odds": None,  # the index prints no prices; this stays null forever
            **date_info,
        })
        seen_ids.add(event_id)

    return {
        "events": events,
        "warnings": warnings,
        "markets_seen": sorted(markets_seen),
    }


def parse_event_page_markets(html: str) -> dict:
    """
    Parse one OLBG event page for the market labels it prints.

    Ice hockey event pages print a Money Line block server-side. Puck line and
    total markets are hydrated client-side and are NOT in the server HTML, so
    this function records only what is printed and never fabricates a line.
    """
    text = strip_tags(html)
    markets = []
    for name in ("Money Line", "Puck Line", "Total Goals", "Handicap", "Correct Score"):
        if name.lower() in text.lower():
            markets.append(name)
    return {"markets_printed": markets, "prices": None}
