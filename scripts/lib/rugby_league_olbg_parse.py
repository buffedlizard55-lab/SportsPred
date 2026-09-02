"""
Pure parser for OLBG Rugby League betting-tips index and event pages.

Grounding: observed 2026-09-02 from live fetches of
  https://www.olbg.com/betting-tips/Rugby_League/10
  https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/10
  and one event page .../Canterbury_Bulldogs_v_Brisbane_Broncos/10?event_id=2751007

The index is server-rendered HTML. Each tip row carries:
  - an anchor to /betting-tips/Rugby_League/All_Rugby_League/All_Events/<Slug>/10?event_id=NNNN
  - the fixture label "Home v Away" (note single 'v' not 'vs')
  - a kickoff label: "Today HH:MM", "Tomorrow HH:MM", or "04 Sept HH:MM"
  - the consensus market label on the index card: "To Win" (alias for Win Match)
    and sometimes the consensus selection bolded elsewhere
  - tip counts like "23/31 Win Tips" and "74%" etc.

Event pages render three markets server-side:
  - "To Win" / "Win Match"
  - "Handicap (2-way)" with selections like "Brisbane Broncos +10.50" or "Canterbury Bulldogs -10.50"
  - "Total Points" with "Over 53.50" / "Under 53.50"
Markets beyond those are hydrated client-side and are NOT present in the server HTML,
so the parser records only what is visibly printed and never invents a price.

No bookmaker odds appear in server-rendered index HTML — only tip counts and
handicap/total line labels on event pages. This file never produces a price.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

SPORT_ID = "10"
EVENT_HREF_RE = re.compile(
    r"/betting-tips/Rugby_League/All_Rugby_League/All_Events/[^\"?]+/10\\?event_id=(\\d+)"
)
# fallback generic href capture for any Rugby_League event link
EVENT_HREF_GENERIC_RE = re.compile(
    r"/betting-tips/Rugby_League/[^\"?]*?/10\\?event_id=(\\d+)"
)

# Fixture labels use " v " not " vs " — observed "Canterbury Bulldogs v Brisbane Broncos"
# Also tolerate " vs " for robustness.
VS_TEXT = re.compile(r"^(?P<home>.+?)\s+v(?:s)?\.?\s+(?P<away>.+?)\s*$", re.IGNORECASE)

TIME_TEXT = re.compile(
    r"(?P<label>Today|Tomorrow|\\d{1,2}\\s+[A-Za-z]{3,})\\s+(?P<time>\\d{1,2}:\\d{2})"
)

TIPS_TEXT = re.compile(r"(?P<for>\\d+)\\s*/\\s*(?P<total>\\d+)\\s*Win Tips")
PCT_TEXT = re.compile(r"(?P<pct>\\d{1,3})\\s*%")
COMMENTS_TEXT = re.compile(r"(?P<n>\\d+)\\s+comment")

MARKET_NAMES_INDEX = [
    "To Win",
    "Handicap (2-way)",
    "Total Points",
    "Win Tournament",
]

MARKET_NAMES_EVENT = [
    "To Win",
    "Handicap (2-way)",
    "Handicap",
    "Total Points",
    "Win Tournament",
]

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\\s+")

MONTHS = {m: i for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], start=1)}


def strip_tags(html: str) -> str:
    text = TAG_RE.sub(" ", html)
    text = (text.replace("&amp;", "&").replace("&nbsp;", " ")
                .replace("&#39;", "'").replace("&quot;", '"')
                .replace("&lt;", "<").replace("&gt;", ">"))
    return WS_RE.sub(" ", text).strip()


def split_blocks(html: str) -> list[str]:
    """
    Split page into candidate event blocks. OLBG renders each tip as <li>.
    Each block is then validated by requiring an event anchor inside it.
    """
    parts = re.split(r"(?i)<li[\\s>]", html)
    return [p for p in parts if EVENT_HREF_GENERIC_RE.search(p)]


def parse_event_href(block: str):
    m = EVENT_HREF_GENERIC_RE.search(block)
    if not m:
        return None
    event_id = m.group(1)
    # Extract full href
    href_m = re.search(r'href="([^"]*?event_id=' + re.escape(event_id) + r'[^"]*)"', block)
    href = href_m.group(1) if href_m else f"/betting-tips/Rugby_League/All_Rugby_League/All_Events/Event/10?event_id={event_id}"
    # slug is segment before /10?event_id=...
    slug = None
    if "/All_Events/" in href:
        try:
            slug = href.split("/All_Events/")[-1].split("/10")[0]
        except Exception:
            slug = None
    url = f"https://www.olbg.com{href.split('?')[0]}?event_id={event_id}" if href.startswith("/") else href.split("?")[0] + f"?event_id={event_id}"
    if url.startswith("https://www.olbg.comhttps"):
        url = url.replace("https://www.olbg.comhttps", "https")
    return event_id, slug, url


def parse_anchor_text(block: str) -> list[str]:
    return [strip_tags(a) for a in re.findall(r"(?is)<a[^>]*>(.*?)</a>", block) if strip_tags(a)]


def parse_block(block: str) -> dict | None:
    ref = parse_event_href(block)
    if not ref:
        return None
    event_id, slug, url = ref

    texts = parse_anchor_text(block)
    # The fixture anchor is the one containing " v "  (or " vs ")
    match_anchor = next((t for t in texts if VS_TEXT.match(t.strip())), None)
    plain = strip_tags(block)

    tm = TIME_TEXT.search(plain)
    tips = TIPS_TEXT.search(plain)
    pct = PCT_TEXT.search(plain)
    comments = COMMENTS_TEXT.search(plain)

    selection = None
    # Selection is usually the team name anchor after the fixture anchor.
    # On index cards the selection appears as a separate anchor like "Canterbury Bulldogs"
    if match_anchor:
        idx = texts.index(match_anchor) if match_anchor in texts else -1
        # Look at next few anchors for a team name
        for cand in texts[idx+1: idx+4]:
            if cand and not VS_TEXT.match(cand) and "Win Tips" not in cand and "comment" not in cand.lower() and cand not in ("Add", "To Win", "Handicap (2-way)", "Total Points"):
                # Heuristic: team names are 2+ words, not numeric
                if len(cand.split()) >= 1 and len(cand) >= 4 and not re.search(r"\d+/\d+", cand):
                    selection = cand.strip()
                    break
    if not selection:
        # Fallback: any anchor that is not the fixture and looks like a team
        for t in texts:
            if t != match_anchor and not re.search(r"Win Tips|%|comment|expert|Add|To Win", t, re.I) and len(t) >= 4:
                # Must not be a market label
                if t not in MARKET_NAMES_INDEX:
                    selection = t
                    break

    market = None
    # Market detection: presence of labels in plain text
    for mn in MARKET_NAMES_INDEX:
        if mn in plain:
            market = mn
            break
    # Normalize "To Win" -> "Win Match" alias used by engine but keep original too
    if market == "To Win":
        market = "To Win"

    row = {
        "event_id": event_id,
        "url": url,
        "slug": slug,
        "display_date": tm.group("label") if tm else None,
        "display_time": tm.group("time") if tm else None,
        "consensus": None,
    }

    if match_anchor:
        mv = VS_TEXT.match(match_anchor.strip())
        if mv:
            row["type"] = "match"
            row["home"] = mv.group("home").strip()
            row["away"] = mv.group("away").strip()
        else:
            row["type"] = "match"
            row["home"] = match_anchor.split(" v ")[0].strip()
            row["away"] = match_anchor.split(" v ")[-1].strip()
    else:
        row["type"] = "outright"
        row["name"] = texts[0] if texts else slug

    if selection and tips:
        row["consensus"] = {
            "market": market or "To Win",
            "selection": selection,
            "tips_for": int(tips.group("for")),
            "tips_total": int(tips.group("total")),
            "pct": int(pct.group("pct")) if pct else None,
            "comments": int(comments.group("n")) if comments else 0,
            "experts": 1 if "expert" in plain.lower() else 0,
        }
    elif tips:
        # Even without selection, keep market shape for counting
        row["consensus"] = {
            "market": market or "To Win",
            "selection": selection,
            "tips_for": int(tips.group("for")),
            "tips_total": int(tips.group("total")),
            "pct": int(pct.group("pct")) if pct else None,
            "comments": int(comments.group("n")) if comments else 0,
            "experts": 1 if "expert" in plain.lower() else 0,
        }

    return row


def parse_index(html: str) -> tuple[list[dict], list[dict]]:
    """Parse a Rugby League tips index page into (matches, outrights)."""
    matches, outrights = [], []
    seen = set()
    for block in split_blocks(html):
        row = parse_block(block)
        if not row or row["event_id"] in seen:
            continue
        seen.add(row["event_id"])
        (matches if row.get("type") == "match" else outrights).append(row)
    return matches, outrights


def resolve_date(display_date: str, fetch_time: datetime) -> tuple[str | None, str]:
    """
    Resolve OLBG's 'Today' / 'Tomorrow' / '04 Sept' labels to an ISO date.
    OLBG renders UK local time (BST). The label alone is not a timestamp, so
    resolution is derived from the fetch time and marked accordingly.
    """
    if not display_date:
        return None, "unknown"
    label = display_date.strip()
    if label == "Today":
        return fetch_time.date().isoformat(), "derived"
    if label == "Tomorrow":
        return (fetch_time.date() + timedelta(days=1)).isoformat(), "derived"

    m = re.match(r"^(\\d{1,2})\s+([A-Za-z]{3,})$", label)
    if not m:
        return None, "unknown"
    day = int(m.group(1))
    month = MONTHS.get(m.group(2)[:3].title())
    if not month:
        return None, "unknown"
    year = fetch_time.year
    try:
        candidate = date(year, month, day)
    except ValueError:
        return None, "unknown"
    if candidate < fetch_time.date():
        candidate = date(year + 1, month, day)
    return candidate.isoformat(), "observed"


def parse_event_page_markets(html: str) -> list[str]:
    """
    Market names present on a single Rugby League event page.
    Verified against event 2751007 on 2026-09-02 which exposed:
    To Win, Handicap (2-way), Total Points.
    """
    plain = strip_tags(html)
    out = []
    for m in MARKET_NAMES_EVENT:
        if m in plain:
            out.append(m)
    # Deduplicate but keep order
    seen = set()
    uniq = []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def parse_handicap_selections(html: str) -> list[dict]:
    """
    Extract Handicap (2-way) selections such as "Brisbane Broncos +10.50"
    / "Canterbury Bulldogs -10.50". These labels are the only place a
    handicap line is published in OLBG's server-rendered HTML.
    """
    plain = strip_tags(html)
    out = []
    # Match team name then +/- line - must appear near "Handicap" region
    for m in re.finditer(r"([A-Z][\\w\\-\\'&]+(?:\\s+[A-Z][\\w\\-\\'&\\.]+){0,4})\\s+([+-]\\d+(?:\\.\\d+)?)", plain):
        name, line = m.group(1).strip(), m.group(2)
        # Filter obvious false positives: very short or containing market words
        if len(name.split()) < 1 or len(name) < 4:
            continue
        if any(word in name for word in ["Over", "Under", "Total", "Points", "Handicap", "Win Tips", "comments"]):
            continue
        # Team names typically have 2-4 words and at least one capitalised word
        if not re.search(r"[A-Z]", name):
            continue
        try:
            val = float(line)
        except ValueError:
            continue
        # Handicap lines for rugby league are typically 1.5 to 24.5
        if abs(val) < 0.5 or abs(val) > 30:
            continue
        out.append({"team": name, "line": val})
    # Deduplicate
    seen = set()
    uniq = []
    for r in out:
        key = (r["team"], r["line"])
        if key not in seen:
            seen.add(key)
            uniq.append(r)
    return uniq


def parse_total_selections(html: str) -> list[dict]:
    """Extract Total Points selections \"Over 53.50\" / \"Under 53.50\"."""
    plain = strip_tags(html)
    out = []
    for m in re.finditer(r"\\b(Over|Under)\\s+(\\d{2,3}(?:\\.\\d+)?)", plain, re.IGNORECASE):
        side = m.group(1).capitalize()
        try:
            val = float(m.group(2))
        except ValueError:
            continue
        if 30 <= val <= 80:
            out.append({"side": side, "line": val})
    # Deduplicate
    seen = set()
    uniq = []
    for r in out:
        key = (r["side"], r["line"])
        if key not in seen:
            seen.add(key)
            uniq.append(r)
    return uniq
