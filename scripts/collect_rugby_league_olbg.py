#!/usr/bin/env python3
"""
Collect the current OLBG Rugby League slate into data/rugby_league_slate.json.

Stdlib only — no third-party packages, so it runs in a bare GitHub Actions runner.

    python3 scripts/collect_rugby_league_olbg.py                # fetch live, write slate
    python3 scripts/collect_rugby_league_olbg.py --dry-run      # fetch live, print summary
    python3 scripts/collect_rugby_league_olbg.py --from FILE    # parse a saved HTML capture
    python3 scripts/collect_rugby_league_olbg.py --save-html DIR # also dump raw HTML
    python3 scripts/collect_rugby_league_olbg.py --enrich       # fetch each event page for markets/lines

IMPORTANT: this script must not be able to invent data. If a fetch fails the run
aborts rather than writing a partial or stale file (same rule as tennis/cricket/handball collectors).
OLBG server HTML carries no bookmaker prices, so no price field can ever appear in the output
(validated by scripts/build_data.py).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.rugby_league_olbg_parse import (  # noqa: E402
    parse_index,
    resolve_date,
    parse_event_page_markets,
    parse_handicap_selections,
    parse_total_selections,
)
from lib.olbg_page_health import diagnose  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "rugby_league_slate.json")

INDEX_URLS = [
    "https://www.olbg.com/betting-tips/Rugby_League/10",
    "https://www.olbg.com/betting-tips/Rugby_League/All_Rugby_League/All_Events/10",
]

USER_AGENT = (
    "Mozilla/5.0 (compatible; SportsPredCollector/1.0; "
    "+https://github.com/buffedlizard55-lab/SportsPred)"
)

TIMEOUT = 25


def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en-GB,en;q=0.9"})
    with urlopen(req, timeout=TIMEOUT) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def collect(from_files=None, save_html_dir=None):
    now = datetime.now(timezone.utc)
    matches: dict[str, dict] = {}
    outrights: dict[str, dict] = {}
    failures = []
    page_health = []

    sources = from_files or INDEX_URLS
    for src in sources:
        try:
            if from_files:
                with open(src, encoding="utf-8") as fh:
                    html = fh.read()
                label = src
            else:
                html = fetch(src)
                label = src
                if save_html_dir:
                    os.makedirs(save_html_dir, exist_ok=True)
                    stamp = now.strftime("%Y%m%dT%H%M%SZ")
                    name = src.rstrip("/").split("/")[-2] if src.count("/") > 3 else "index"
                    path = os.path.join(save_html_dir, f"rugby_league_{name}_{stamp}.html")
                    with open(path, "w", encoding="utf-8") as fh:
                        fh.write(html)
                    print(f"  saved raw HTML -> {path}")
        except (HTTPError, URLError, OSError) as exc:
            failures.append(f"{src}: {exc}")
            continue

        m, o = parse_index(html)
        # Zero rows from a successful fetch is ambiguous: a bot-block, a cookie
        # wall and a real off-season all parse to nothing. Record which it was.
        _h = diagnose(html, event_count=len(m) + len(o), sport="Rugby League")
        page_health.append({"url": src, **_h})
        failures.extend(f"{src}: {w}" for w in _h["warnings"])
        print(f"  {label}: {len(m)} matches, {len(o)} outrights")
        for row in m:
            matches.setdefault(row["event_id"], row)
        for row in o:
            outrights.setdefault(row["event_id"], row)

    if failures:
        print("\nFetch failures:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        if not matches and not outrights:
            print("\nAborting: nothing could be fetched. Refusing to overwrite "
                  "the existing snapshot with an empty one.", file=sys.stderr)
            return None, now, failures, page_health

    # Resolve display labels to ISO dates against the fetch time.
    for row in list(matches.values()) + list(outrights.values()):
        iso, basis = resolve_date(row.get("display_date"), now)
        row["resolved_date"] = iso
        row["date_basis"] = basis

    return {"matches": list(matches.values()), "outrights": list(outrights.values())}, now, failures, page_health


def enrich_event_pages(rows, limit=None, save_html_dir=None):
    """
    Fetch each event page to record the market list actually offered and lines.

    Conservative: on any failure the event simply keeps markets_verified = False.
    """
    targets = rows[:limit] if limit else rows
    for row in targets:
        try:
            html = fetch(row["url"])
        except (HTTPError, URLError, OSError) as exc:
            print(f"  event {row['event_id']}: {exc}", file=sys.stderr)
            row["markets_verified"] = False
            continue
        if save_html_dir:
            os.makedirs(save_html_dir, exist_ok=True)
            path = os.path.join(save_html_dir, f"rugby_league_event_{row['event_id']}.html")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(html)
        row["markets_on_event_page"] = parse_event_page_markets(html)
        # Handicap lines from event page (authoritative for handicap market)
        hc = parse_handicap_selections(html)
        if hc:
            row["handicap_selections"] = [f"{h['team']} {h['line']:+.2f}" for h in hc]
            row["handicap_lines"] = hc
        tot = parse_total_selections(html)
        if tot:
            row["total_selections"] = [f"{t['side']} {t['line']:.2f}" for t in tot]
            row["total_lines"] = tot
        row["markets_verified"] = True
        print(f"  event {row['event_id']}: {row['markets_on_event_page']} hc={row.get('handicap_selections')} tot={row.get('total_selections')}")
    return rows


def build_payload(data, now, failures, page_health=None):
    events = []
    for r in data["matches"]:
        events.append(r)
    for r in data["outrights"]:
        events.append(r)
    # Keep outrights distinguishable for calendar but include in snapshot
    return {
        "schema_version": 1,
        "sport": "Rugby League",
        "source": {
            "name": "OLBG — Rugby League Betting Tips",
            "url": INDEX_URLS[0],
            "indexes": INDEX_URLS,
            "fetched_at_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": "HTTP GET of server-rendered HTML via urllib; no JavaScript execution",
            "licence_note": "Publicly viewable page. Redistribution limited to this factual fixture/market listing; see docs/SOURCES.md.",
        },
        "markets_covered": [
            "To Win (Win Match)",
            "Handicap (2-way)",
            "Total Points (Over/Under)",
            "Win Tournament (outright)",
        ],
        "notes": [
            "Every field was read from the pages listed in source.indexes. Nothing is inferred unless date_basis says \"derived\".",
            "OLBG renders kickoff times in UK local time (BST, UTC+1 in summer).",
            "OLBG does not expose structured odds in server-rendered HTML, so no price fields exist in this file. See docs/RUGBY_LEAGUE_IRREGULARITIES.md RL-01.",
            "Tournament, competition stage and venue are not published on the tips index and are left null unless enriched from event pages. See RL-02.",
            "Handicap and Total lines are captured from event pages where present; matches without enriched lines list markets_verified=false.",
        ],
        "collection_warnings": failures,
        "page_health": page_health or [],
        "events": events,
    }


def main():
    ap = argparse.ArgumentParser(description="Collect OLBG Rugby League slate")
    ap.add_argument("--dry-run", action="store_true", help="fetch and print summary, do not write file")
    ap.add_argument("--from", dest="from_file", help="parse a saved HTML capture instead of fetching")
    ap.add_argument("--save-html", dest="save_html", help="also dump raw HTML to DIR")
    ap.add_argument("--enrich", action="store_true", help="fetch each event page for market/line lists")
    ap.add_argument("--enrich-limit", type=int, default=None, help="limit number of event pages to enrich")
    args = ap.parse_args()

    if args.from_file:
        data, now, failures, page_health = collect(from_files=[args.from_file], save_html_dir=args.save_html)
    else:
        data, now, failures, page_health = collect(save_html_dir=args.save_html)

    if data is None:
        return 1

    if args.enrich:
        enrich_event_pages(data["matches"], limit=args.enrich_limit, save_html_dir=args.save_html)
        enrich_event_pages(data["outrights"], limit=args.enrich_limit, save_html_dir=args.save_html)

    payload = build_payload(data, now, failures, page_health)

    if args.dry_run:
        print(f"\nRugby League slate: {len(payload['events'])} total rows")
        for e in payload["events"][:15]:
            print(f"  {e['event_id']}: {e.get('home','?')} v {e.get('away','?')} [{e.get('resolved_date')} {e.get('display_time')}] market={e.get('consensus',{}).get('market')} sel={e.get('consensus',{}).get('selection')} lines hc={e.get('handicap_selections')} tot={e.get('total_selections')}")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Wrote {OUT} ({len(payload['events'])} rows)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
