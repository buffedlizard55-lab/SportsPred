#!/usr/bin/env python3
"""
Collect the current OLBG Baseball slate into data/baseball_slate.json.

Stdlib only, so it runs on a bare GitHub Actions runner:

    python3 scripts/collect_baseball_olbg.py                 # fetch live, write slate
    python3 scripts/collect_baseball_olbg.py --dry-run       # fetch live, print summary
    python3 scripts/collect_baseball_olbg.py --from FILE     # parse a saved HTML capture
    python3 scripts/collect_baseball_olbg.py --save-html DIR # also dump the raw HTML

HONESTY RULES (same as every other collector in this repo)
  - If a fetch fails the run aborts. It never writes a partial or stale file.
  - OLBG server HTML carries tipster vote counts, not bookmaker prices, so the
    `odds` field on every row is null and build_data.py fails if that changes.
  - Every row keeps the URL it was read from, for manual review.
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
from lib.baseball_olbg_parse import INDEX_URL, SPORT_ID, parse_index, parse_event_page_markets  # noqa: E402
from lib.olbg_page_health import diagnose  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "baseball_slate.json")

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


def build_slate(html: str, source_url: str, enrich: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    parsed = parse_index(html, now=now)
    health = diagnose(html, event_count=len(parsed["events"]), sport="Baseball")

    if enrich:
        for ev in parsed["events"]:
            try:
                page = fetch(ev["url"])
                ev["markets_printed"] = parse_event_page_markets(page)["markets_printed"]
                ev["event_page_fetched_utc"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            except (HTTPError, URLError, TimeoutError) as exc:
                ev["markets_printed"] = None
                ev["event_page_error"] = f"{type(exc).__name__}: {exc}"

    return {
        "schema_version": 1,
        "sport": "Baseball",
        "olbg_sport_id": SPORT_ID,
        "fetched_at_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "name": "OLBG Baseball betting-tips index",
            "url": source_url,
            "method": "HTTP GET of server-rendered HTML via urllib; no JavaScript execution",
            "licence_note": (
                "Publicly viewable listing of facts (fixture, league, kickoff, tip counts) "
                "recorded for manual review. No bookmaker price is published in this HTML, "
                "so no price field is produced."
            ),
        },
        "events": parsed["events"],
        "markets_seen": parsed["markets_seen"],
        # A parse that yields no rows is ambiguous on its own: a bot-block, a
        # cookie wall and a real off-season all look identical. diagnose()
        # inspects the delivered bytes and says which it was, so an empty
        # slate can never be mistaken for a verified-empty schedule.
        "warnings": parsed["warnings"] + health["warnings"],
        "page_health": health,
        "note": (
            "Display-and-join context for the baseball engine. OLBG publishes tipster "
            "consensus, not odds, so this slate can never supply a price. Fixtures, "
            "standings, team stats and probable starters come from the official MLB "
            "StatsAPI; the ESPN scoreboard supplies venue/weather context."
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from", dest="src", help="parse a saved HTML capture instead of fetching")
    ap.add_argument("--save-html", dest="save_html", help="directory to dump raw HTML into")
    ap.add_argument("--enrich", action="store_true", help="also fetch each event page for market labels")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    source_url = INDEX_URL
    if args.src:
        with open(args.src, encoding="utf-8") as fh:
            html = fh.read()
        source_url = f"file://{os.path.abspath(args.src)}"
    else:
        try:
            html = fetch(INDEX_URL)
        except (HTTPError, URLError, TimeoutError) as exc:
            print(f"ABORT: could not fetch {INDEX_URL}: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 2

    if args.save_html:
        os.makedirs(args.save_html, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = os.path.join(args.save_html, f"olbg_baseball_{stamp}.html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(html)
        print(f"saved raw HTML -> {path}")

    slate = build_slate(html, source_url, enrich=args.enrich)

    print(f"events: {len(slate['events'])}  markets: {', '.join(slate['markets_seen']) or 'none'}")
    for ev in slate["events"]:
        print(f"  {ev['resolved_date'] or ev['display_date']:>16}  {ev['away']} @ {ev['home']}  [{ev['league']}]")
    for w in slate["warnings"]:
        print(f"  WARNING: {w}")

    if args.dry_run:
        return 0

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(slate, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
