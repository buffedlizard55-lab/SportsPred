#!/usr/bin/env python3
"""
Collect the openly-available OLBG cricket markets slate.

Fetches the public OLBG cricket tips index, parses every event block (match
markets and outrights) with the pure parser in scripts/lib/cricket_olbg_parse.py,
and writes data/cricket_slate.json.

Stdlib only. With --dry-run it prints what it would write without writing.
If the network is unreachable it exits non-zero so the CI job can tell — it
never fabricates a slate.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.cricket_olbg_parse import parse_index, resolve_date  # noqa: E402

INDEX_URL = "https://www.olbg.com/betting-tips/Cricket/16"
OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "cricket_slate.json")

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def build_snapshot(html: str, fetched_at: datetime) -> dict:
    matches, outrights = parse_index(html)
    events = []
    for row in matches:
        iso, basis = resolve_date(row.get("display_date"), fetched_at)
        events.append({
            "event_id": row["event_id"],
            "sport": "Cricket",
            "type": "match",
            "home": row.get("home"),
            "away": row.get("away"),
            "url": row["url"],
            "slug": row.get("slug"),
            "display_date": row.get("display_date"),
            "display_time": row.get("display_time"),
            "resolved_date": iso,
            "date_basis": basis,
            "consensus": row.get("consensus"),
        })
    outright_rows = []
    for row in outrights:
        iso, basis = resolve_date(row.get("display_date"), fetched_at)
        outright_rows.append({
            "event_id": row["event_id"],
            "name": row.get("name"),
            "url": row["url"],
            "display_date": row.get("display_date"),
            "resolved_date": iso,
            "date_basis": basis,
            "consensus": row.get("consensus"),
        })
    return {
        "schema_version": 1,
        "sport": "Cricket",
        "source": {
            "name": "OLBG — Cricket Betting Tips",
            "url": INDEX_URL,
            "fetched_at_utc": fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": "Verified HTTP extraction of public OLBG cricket tips index",
            "licence_note": "Publicly viewable market listing for manual review and analysis.",
        },
        "markets_covered": [
            "Win Match",
            "Man Of The Match",
            "Draw No Bet",
            "Top Batsman / Total Runs (event pages)",
            "Outright Winner",
        ],
        "notes": [
            "Every field corresponds to a verified OLBG cricket event listing.",
            "Times are presented in UK local time as shown by OLBG.",
            "OLBG publishes tipster consensus counts, not bookmaker odds; no odds are recorded here.",
        ],
        "collection_warnings": [],
        "events": events,
        "outrights": outright_rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default=OUT_PATH)
    args = ap.parse_args()

    try:
        html = fetch(INDEX_URL)
    except Exception as exc:  # network failure — never fabricate
        print(f"ERROR: could not fetch OLBG cricket index: {exc}", file=sys.stderr)
        return 2

    fetched_at = datetime.now(timezone.utc)
    snap = build_snapshot(html, fetched_at)
    print(f"Parsed {len(snap['events'])} match events and "
          f"{len(snap['outrights'])} outrights from OLBG cricket.")

    if args.dry_run:
        print(json.dumps({k: snap[k] for k in ("events", "outrights")}, indent=2)[:4000])
        return 0

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(snap, f, indent=2, ensure_ascii=False)
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
