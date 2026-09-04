#!/usr/bin/env python3
"""
Collect the openly-available OLBG snooker markets slate.

Fetches the public OLBG snooker tips index (https://www.olbg.com/betting-tips/Snooker/8),
parses each event with the pure parser in scripts/lib/snooker_olbg_parse.py and
writes data/snooker_slate.json. With --enrich it also visits each event page to
record the market groups (Win Match / Handicap Betting / Frame Betting) that the
server html carries.

Stdlib only. The OLBG pages expose tipster vote counts but never prices, so the
output contains no odds field; consensus is display-only and never fed into the
model (IR-SNOOKER-01).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.snooker_olbg_parse import parse_index, parse_event_page_markets, INDEX_URL  # noqa: E402
from scripts.lib.olbg_page_health import diagnose  # noqa: E402

OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "snooker_slate.json",
)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def build_snapshot(html: str, fetched_at: datetime, enrich: bool = False) -> dict:
    rows = parse_index(html)
    events = []
    for row in rows:
        events.append({
            "event_id": row["event_id"],
            "url": row["url"],
            "matchup": row.get("matchup"),
            "display_time": row.get("display_time"),
            "display_date_label": row.get("display_date_label"),
            "consensus": row.get("consensus"),
            "markets_verified": False,
        })
    warnings = []
    if enrich:
        for ev in events:
            try:
                page = fetch(ev["url"], timeout=20)
                markets = parse_event_page_markets(page)
                ev["markets"] = markets
                ev["markets_verified"] = len(markets) > 0
            except Exception as err:  # noqa: BLE001 - collector must survive
                warnings.append(f"{ev['event_id']}: event page enrichment failed: {err}")
                ev["markets_verified"] = False
    # A parse that finds no rows is ambiguous by itself: a bot-block, a cookie
    # wall and a genuine off-season all yield zero events. diagnose() reads the
    # delivered bytes and records which it was, so an empty document is never
    # mistaken for a verified-empty schedule.
    _health = diagnose(html, event_count=len(events), sport="Snooker")

    return {
        "schema_version": 1,
        "sport": "Snooker",
        "as_of_utc": fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "name": "OLBG — Snooker Betting Tips",
            "url": INDEX_URL,
            "indexes": [INDEX_URL],
            "fetched_at_utc": fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": "HTTP GET of server-rendered HTML via urllib; no JavaScript execution",
            "licence_note": "Publicly viewable page. Factual market listing retained for review.",
        },
        "notes": [
            "OLBG tipster consensus counts are display-only and are never fed into snooker scoring.",
            "OLBG does not expose structured odds in server-rendered HTML, so no price fields exist (IR-SNOOKER-01).",
            "Tournament, round, venue and date are joined from the official WST/snooker.org records in the page/engine layer, never from OLBG alone.",
        ],
        "collection_warnings": warnings + _health["warnings"],
        "page_health": _health,
        "events": events,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from-file", help="Parse a saved HTML capture instead of fetching")
    ap.add_argument("--enrich", action="store_true", help="Visit each event page to record market groups")
    args = ap.parse_args()

    fetched_at = datetime.now(timezone.utc)
    if args.from_file:
        with open(args.from_file, encoding="utf-8") as fh:
            html = fh.read()
    else:
        html = fetch(INDEX_URL)

    doc = build_snapshot(html, fetched_at, enrich=args.enrich)
    print(f"Parsed {len(doc['events'])} snooker markets from OLBG")
    if args.dry_run:
        for e in doc["events"][:10]:
            c = e.get("consensus") or {}
            print(f"  {e.get('matchup')}: {c.get('selection')} ({c.get('tips_for')}/{c.get('tips_total')})")
        return 0
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print(f"Wrote {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
