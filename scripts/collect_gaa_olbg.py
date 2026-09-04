#!/usr/bin/env python3
"""Collect OLBG Gaelic Football (25) and Hurling (26) indexes into data/gaa_*_slate.json."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.gaa_olbg_parse import (  # noqa: E402
    parse_index, parse_team_names, FOOTBALL_INDEX, HURLING_INDEX, FOOTBALL_ID, HURLING_ID,
)
from scripts.lib.olbg_page_health import diagnose  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def snapshot(html: str, fetched_at: datetime, *, code: str, index_url: str, sport_id: str, slug: str) -> dict:
    rows = parse_index(html, sport_id=sport_id, slug_folder=slug)
    events = []
    for row in rows:
        team_a = team_b = None
        if row.get("type") != "outright" and row.get("matchup"):
            names = parse_team_names(f"<h1>{row['matchup']}</h1>")
            if len(names) == 2:
                team_a = {"name": names[0]}
                team_b = {"name": names[1]}
        events.append({
            "event_id": row["event_id"],
            "type": row.get("type") or "match",
            "code": code,
            "url": row["url"],
            "matchup": row.get("matchup"),
            "display_time": row.get("display_time"),
            "display_date_label": row.get("display_date_label"),
            "consensus": row.get("consensus"),
            "teamA": team_a,
            "teamB": team_b,
        })
    # Zero rows is ambiguous on its own: a bot-block, a cookie wall and a real
    # off-season all parse to nothing. Record which the delivered bytes show.
    _health = diagnose(html, event_count=len(events), sport=f"GAA {code}")

    return {
        "schema_version": 1,
        "sport": "Hurling" if code == "hurling" else "Gaelic Football",
        "code": code,
        "as_of_utc": fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "name": f"OLBG — {'Hurling' if code == 'hurling' else 'Gaelic Football'} Betting Tips",
            "url": index_url,
            "indexes": [index_url],
            "fetched_at_utc": fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": "HTTP GET of server-rendered HTML via urllib; no JavaScript execution",
            "licence_note": "Publicly viewable page. Factual market listing retained for review.",
        },
        "notes": [
            "OLBG tipster consensus counts are display-only and are never fed into GAA scoring.",
            "OLBG does not expose structured odds in server-rendered HTML (IR-GAA-01).",
        ],
        "collection_warnings": _health["warnings"],
        "page_health": _health,
        "events": events,
    }


def write_doc(path: str, doc: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from-file")
    ap.add_argument("--code", choices=["football", "hurling", "both"], default="both")
    args = ap.parse_args()
    fetched_at = datetime.now(timezone.utc)

    jobs = []
    if args.code in ("football", "both"):
        jobs.append(("football", FOOTBALL_INDEX, FOOTBALL_ID, "Gaelic_Football", os.path.join(ROOT, "data", "gaa_slate.json")))
    if args.code in ("hurling", "both"):
        jobs.append(("hurling", HURLING_INDEX, HURLING_ID, "Hurling", os.path.join(ROOT, "data", "gaa_hurling_slate.json")))

    for code, url, sid, slug, out in jobs:
        if args.from_file and args.code != "both":
            with open(args.from_file, encoding="utf-8") as fh:
                html = fh.read()
        else:
            html = fetch(url)
        doc = snapshot(html, fetched_at, code=code, index_url=url, sport_id=sid, slug=slug)
        print(f"Parsed {len(doc['events'])} {code} markets from OLBG")
        if args.dry_run:
            continue
        write_doc(out, doc)
        print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
