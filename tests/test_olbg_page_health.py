"""Tests for scripts/lib/olbg_page_health.py and its wiring into the collectors.

THE BUG THIS GUARDS
Every OLBG parser warned about an individual malformed row, but none said
anything when it found no rows at all. A Cloudflare interstitial, a cookie wall,
a truncated body and a real off-season all produced `events: []` with
`warnings: []`, so a collector could write an empty slate and exit 0. Three
committed slates (baseball, ice hockey, volleyball) sat at zero events with
nothing recorded to explain why.

An empty slate is a legitimate outcome, so these tests do not assert that empty
is an error. They assert that the *reason* is always recorded, and specifically
that a blocked fetch is never reported as a verified-empty schedule.
"""

import importlib
import os
import sys
import unittest
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from scripts.lib.olbg_page_health import (  # noqa: E402
    MIN_PLAUSIBLE_BYTES,
    diagnose,
)

NOW = datetime(2026, 9, 3, 18, 30, tzinfo=timezone.utc)

# A full-length page that is recognisably OLBG but lists no fixtures.
OFFSEASON = "<html><body>" + "<p>OLBG betting-tips index page copy.</p>" * 90 + "</body></html>"


class Diagnose(unittest.TestCase):
    def test_events_present_is_always_ok(self):
        """Real rows must be trusted even if the page also carries consent copy.

        A working page that happens to mention cookies must not be voided.
        """
        page = "<html><body>Please enable cookies. " + "x" * 5000 + "</body></html>"
        d = diagnose(page, event_count=7, sport="Baseball")
        self.assertEqual(d["status"], "ok")
        self.assertTrue(d["healthy"])
        self.assertEqual(d["warnings"], [])

    def test_empty_body_is_truncated_not_empty_slate(self):
        d = diagnose("", event_count=0, sport="Baseball")
        self.assertEqual(d["status"], "truncated")
        self.assertFalse(d["healthy"])
        self.assertIn("not an empty schedule", d["warnings"][0])

    def test_cloudflare_interstitial_is_blocked(self):
        d = diagnose("<html><body>Just a moment...</body></html>", event_count=0)
        self.assertEqual(d["status"], "blocked")
        self.assertFalse(d["healthy"])

    def test_cookie_wall_is_blocked(self):
        d = diagnose("<html><body>Please enable cookies to continue</body></html>", event_count=0)
        self.assertEqual(d["status"], "blocked")

    def test_rate_limit_page_is_blocked(self):
        d = diagnose("<html><body>Too many requests</body></html>", event_count=0)
        self.assertEqual(d["status"], "blocked")
        self.assertFalse(d["healthy"])

    def test_short_body_is_truncated(self):
        d = diagnose("<html><body>oops</body></html>", event_count=0)
        self.assertEqual(d["status"], "truncated")
        self.assertLess(d["evidence"]["bytes"], MIN_PLAUSIBLE_BYTES)

    def test_long_page_without_olbg_markers_is_rejected(self):
        page = "<html><body>" + "<p>unrelated site content</p>" * 200 + "</body></html>"
        d = diagnose(page, event_count=0)
        self.assertEqual(d["status"], "not-a-sport-page")
        self.assertFalse(d["healthy"])

    def test_genuine_offseason_is_reported_as_empty_and_healthy(self):
        """The one case where zero events is a real finding about the schedule."""
        d = diagnose(OFFSEASON, event_count=0, sport="Baseball")
        self.assertEqual(d["status"], "empty-slate")
        self.assertTrue(d["healthy"])
        self.assertIn("lists no upcoming fixtures", d["warnings"][0])

    def test_signatures_are_matched_in_visible_text_not_script_bodies(self):
        """A script that merely mentions a signature must not fake a block.

        Without stripping script bodies, any page shipping analytics code that
        contains the word 'captcha' would be misreported as intercepted.
        """
        page = (
            "<html><body><script>var x='captcha';</script>"
            + "<p>OLBG betting-tips listing.</p>" * 90
            + "</body></html>"
        )
        d = diagnose(page, event_count=0, sport="Darts")
        self.assertEqual(d["status"], "empty-slate")

    def test_evidence_is_always_returned_for_review(self):
        for html, count in ((OFFSEASON, 0), ("", 0), ("<html>Just a moment</html>", 0)):
            d = diagnose(html, event_count=count)
            self.assertIn("bytes", d["evidence"])
            self.assertIn("event_count", d["evidence"])


class CollectorWiring(unittest.TestCase):
    """Every OLBG collector must surface the diagnosis, not swallow it."""

    BLOCK = "<html><body>Just a moment... Cloudflare checking your browser</body></html>"

    def _statuses(self, html):
        """Return {collector: status} by driving each builder directly."""
        out = {}

        for sport in ("cricket", "greyhound", "darts", "snooker"):
            mod = importlib.import_module(f"scripts.collect_{sport}_olbg")
            out[sport] = mod.build_snapshot(html, NOW)["page_health"]["status"]

        for sport in ("baseball", "ice_hockey"):
            mod = importlib.import_module(f"collect_{sport}_olbg")
            out[sport] = mod.build_slate(html, "file://test")["page_health"]["status"]

        gaa = importlib.import_module("scripts.collect_gaa_olbg")
        out["gaa"] = gaa.snapshot(
            html, NOW, code="football", index_url="u", sport_id="25", slug="Gaelic_Football"
        )["page_health"]["status"]

        return out

    def test_every_collector_reports_a_block(self):
        for sport, status in self._statuses(self.BLOCK).items():
            self.assertEqual(status, "blocked", f"{sport} did not report the block")

    def test_every_collector_reports_a_genuine_empty_slate(self):
        for sport, status in self._statuses(OFFSEASON).items():
            self.assertEqual(status, "empty-slate", f"{sport} misreported an off-season")

    def test_blocked_page_adds_a_warning_to_the_document(self):
        mod = importlib.import_module("collect_baseball_olbg")
        slate = mod.build_slate(self.BLOCK, "file://test")
        self.assertEqual(slate["events"], [])
        self.assertTrue(slate["warnings"], "an intercepted fetch wrote no warning")
        self.assertFalse(slate["page_health"]["healthy"])

    def test_real_page_still_parses_with_no_spurious_warning(self):
        """The guard must not damage collection that already works."""
        fixture = os.path.join(ROOT, "tests", "fixtures", "olbg_baseball_index.RECONSTRUCTED.html")
        with open(fixture, encoding="utf-8") as fh:
            html = fh.read()
        mod = importlib.import_module("collect_baseball_olbg")
        slate = mod.build_slate(html, "file://test")
        self.assertGreater(len(slate["events"]), 0)
        self.assertEqual(slate["warnings"], [])
        self.assertEqual(slate["page_health"]["status"], "ok")


if __name__ == "__main__":
    unittest.main()
