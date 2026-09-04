"""Detect an OLBG index page that did not really deliver a fixture list.

WHY THIS EXISTS
Every OLBG parser in this repo reports a warning when an *individual* row is
malformed, but none of them says anything when it finds *no rows at all*. A
bot-block interstitial, a cookie wall, a JavaScript shell and a genuine
off-season all parse to `events: []` with `warnings: []`, so the collector
writes an empty slate and exits 0. That is how `data/baseball_slate.json`,
`data/ice_hockey_slate.json` and `data/volleyball_slate.json` came to sit at
zero events with nothing recorded to explain it (IR-BASEBALL-07).

An empty slate is a legitimate outcome — sports do have off-seasons — so the
fix is not to fail on empty. The fix is to make the *reason* observable, so a
review can tell "OLBG published no baseball fixtures today" apart from "OLBG
served us a challenge page".

HONESTY RULES
  - This module only reports what is visible in the delivered bytes. It never
    infers that fixtures exist, and never invents an event.
  - A diagnosis is returned with the evidence that produced it, so any claim in
    a slate document can be traced back to a substring of the page.
  - When the page looks like a normal sport page that simply lists nothing, that
    is reported as `empty-slate`, not as an error.
"""

from __future__ import annotations

import re

# Substrings that identify an interception page. Each is matched
# case-insensitively against the delivered HTML. These are generic
# anti-bot/consent phrases, not OLBG-specific markup, so they stay valid if the
# site's own layout changes.
BLOCK_SIGNATURES = [
    ("cloudflare", "Cloudflare challenge or error page"),
    ("just a moment", "Cloudflare 'Just a moment' interstitial"),
    ("checking your browser", "browser-check interstitial"),
    ("enable javascript", "page demands JavaScript execution"),
    ("please enable cookies", "cookie wall"),
    ("access denied", "access denied response"),
    ("captcha", "CAPTCHA challenge"),
    ("are you a robot", "bot challenge"),
    ("rate limit", "rate-limit notice"),
    ("too many requests", "HTTP 429 notice rendered as HTML"),
    ("temporarily unavailable", "upstream temporarily unavailable"),
    ("503 service", "HTTP 503 rendered as HTML"),
]

# A served OLBG sport index is a substantial document. Anything far below this
# is a stub, an error body or a redirect shell rather than a fixture listing.
MIN_PLAUSIBLE_BYTES = 2000

# Markers that the page really is an OLBG betting-tips page, even when it
# happens to list no fixtures right now.
SPORT_PAGE_MARKERS = ["betting-tips", "olbg"]


def _visible_text(html: str) -> str:
    """Strip tags and script/style bodies so signatures match copy, not markup."""
    without_code = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1>", " ", html or "", flags=re.IGNORECASE | re.DOTALL
    )
    return re.sub(r"<[^>]+>", " ", without_code)


def diagnose(html: str, *, event_count: int, sport: str = "") -> dict:
    """Explain why a parse produced `event_count` events from `html`.

    Returns a dict with:
      status    -- 'ok' | 'empty-slate' | 'blocked' | 'not-a-sport-page' | 'truncated'
      warnings  -- list of human-readable strings for the slate document
      evidence  -- what was observed, for manual review
      healthy   -- True when the document may be trusted as a real listing

    `event_count` is supplied by the caller because each parser returns a
    different shape; this module deliberately does no parsing of its own.
    """
    raw = html or ""
    text = _visible_text(raw).lower()
    byte_len = len(raw)
    evidence = {
        "bytes": byte_len,
        "event_count": event_count,
        "sport": sport or None,
    }

    # A page that produced fixtures is trusted regardless of its other copy: a
    # consent banner on a working page must not invalidate real rows.
    if event_count > 0:
        return {
            "status": "ok",
            "warnings": [],
            "evidence": evidence,
            "healthy": True,
        }

    if byte_len == 0:
        return {
            "status": "truncated",
            "warnings": [
                "OLBG returned an empty response body, so no fixture list was delivered. "
                "The empty slate below reflects a failed fetch, not an empty schedule."
            ],
            "evidence": evidence,
            "healthy": False,
        }

    for needle, description in BLOCK_SIGNATURES:
        if needle in text:
            evidence["matched_signature"] = needle
            return {
                "status": "blocked",
                "warnings": [
                    f"OLBG served a {description} instead of a fixture list "
                    f"(matched {needle!r}). The empty slate below reflects an intercepted "
                    "request, not an empty schedule."
                ],
                "evidence": evidence,
                "healthy": False,
            }

    if byte_len < MIN_PLAUSIBLE_BYTES:
        return {
            "status": "truncated",
            "warnings": [
                f"OLBG returned only {byte_len} bytes, far short of a rendered index page. "
                "The response was probably an error body or a redirect shell; the empty "
                "slate below is not evidence of an empty schedule."
            ],
            "evidence": evidence,
            "healthy": False,
        }

    if not any(marker in text for marker in SPORT_PAGE_MARKERS):
        return {
            "status": "not-a-sport-page",
            "warnings": [
                "The delivered page carries no OLBG betting-tips markers, so it is not the "
                "expected index. The empty slate below is not evidence of an empty schedule."
            ],
            "evidence": evidence,
            "healthy": False,
        }

    # A full, recognisably-OLBG page that lists nothing. This is the only case
    # where zero events is a real finding about the schedule.
    label = f"{sport} " if sport else ""
    return {
        "status": "empty-slate",
        "warnings": [
            f"OLBG delivered a complete {label}index page that lists no upcoming fixtures. "
            "Recorded as a genuinely empty slate."
        ],
        "evidence": evidence,
        "healthy": True,
    }
