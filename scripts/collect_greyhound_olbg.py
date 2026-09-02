#!/usr/bin/env python3
"""
Collect the openly-available OLBG greyhound markets slate.

Fetches the public OLBG greyhound tips index (the day's race markets and the
most-tipped runner per race), parses it with the pure parser in
scripts/lib/greyhound_olbg_parse.py, and writes data/greyhound_slate.json.

Stdlib only. With --dry-run it prints a summary without writing. The OLBG
server HTML carries no structured prices, so the output never contains an odds
field; tipster consensus is display-only and never fed into model scoring.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.greyhound_olbg_parse import parse_index  # noqa: E402

INDEX_URL = "https://www.olbg.com/betting-tips/Greyhounds/28"
OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "greyhound_slate.json",
)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def build_snapshot(html: str, fetched_at: datetime, enrich: bool = False) -> dict:
    rows = parse_index(html)
    today = fetched_at.strftime("%Y-%m-%d")
    events = []
    for row in rows:
        events.append({
            "event_id": row["event_id"],
            "url": row["url"],
            "event_name": row.get("event_name"),
            "display_time": row.get("display_time"),
            "track": row.get("track"),
            "type": "race",
            "date_basis": "observed",
            "resolved_date": today,
            "consensus": {
                "market": "Win",
                "selection": row.get("selection"),
                "tips_for": row.get("tips_for"),
                "tips_total": row.get("tips_total"),
                "pct": row.get("pct"),
            },
            "markets_verified": True,
        })
    return {
        "schema_version": 1,
        "sport": "Greyhounds",
        "source": {
            "name": "OLBG — Greyhound Betting Tips",
            "url": INDEX_URL,
            "indexes": [INDEX_URL],
            "fetched_at_utc": fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": "HTTP GET of server-rendered HTML via urllib; no JavaScript execution",
            "licence_note": "Publicly viewable page. Factual market listing retained for review.",
        },
        "notes": [
            "OLBG tipster consensus counts are display-only and are never fed into model scoring.",
            "OLBG does not expose structured odds in server-rendered HTML, so no price fields exist (IR-GH-01).",
            "Races are matched to the official GBGB meeting/draw records by track and scheduled time in the page layer.",
        ],
        "collection_warnings": [],
        "events": events,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from-file", help="Parse a saved HTML capture instead of fetching")
    ap.add_argument("--enrich", action="store_true", help="Reserved: event-page runner cross-check")
    args = ap.parse_args()

    fetched_at = datetime.now(timezone.utc)
    if args.from_file:
        with open(args.from_file, encoding="utf-8") as fh:
            html = fh.read()
    else:
        html = fetch(INDEX_URL)

    doc = build_snapshot(html, fetched_at, enrich=args.enrich)
    print(f"Parsed {len(doc['events'])} greyhound markets from OLBG")
    if args.dry_run:
        for e in doc["events"][:10]:
            c = e["consensus"]
            print(f"  {e['event_name']}: {c['selection']} ({c['tips_for']}/{c['tips_total']})")
        return 0
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print(f"Wrote {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
