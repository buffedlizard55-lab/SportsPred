"""Tests for validate_baseball_provenance in scripts/build_data.py.

The baseball source register is generated rather than hand-written, so the
danger is not a typo but silent drift: the register keeps asserting yesterday's
numbers after the collector refreshes the documents. These tests mutate a copy
of the committed register and assert that each class of drift is caught, so the
validator cannot pass vacuously.
"""

import copy
import importlib.util
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_spec = importlib.util.spec_from_file_location(
    "build_data", os.path.join(ROOT, "scripts", "build_data.py")
)
build_data = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_data)


def register():
    with open(os.path.join(ROOT, "data", "baseball_provenance.json"), encoding="utf-8") as fh:
        return json.load(fh)


class BaseballProvenanceValidation(unittest.TestCase):
    def setUp(self):
        self.doc = register()

    def check(self, doc):
        problems, _count = build_data.validate_baseball_provenance(doc)
        return problems

    def test_committed_register_is_clean(self):
        self.assertEqual(self.check(self.doc), [])

    def test_counts_sources(self):
        _problems, count = build_data.validate_baseball_provenance(self.doc)
        self.assertEqual(count, len(self.doc["sources"]))

    def test_rejects_non_https_source(self):
        d = copy.deepcopy(self.doc)
        d["sources"][0]["url"] = "http://statsapi.mlb.com"
        self.assertTrue(any("https" in p for p in self.check(d)))

    def test_rejects_failed_status(self):
        d = copy.deepcopy(self.doc)
        d["sources"][0]["status"] = 503
        self.assertTrue(any("non-200" in p for p in self.check(d)))

    def test_allows_absent_status(self):
        """A source with no recorded status is legitimate; a failing one is not.

        The OLBG slate collector records no HTTP code, and the register must be
        able to say so honestly instead of claiming a 200 it never observed.
        """
        d = copy.deepcopy(self.doc)
        d["sources"][0]["status"] = None
        self.assertEqual([p for p in self.check(d) if "status" in p], [])

    def test_rejects_partially_failed_requests(self):
        d = copy.deepcopy(self.doc)
        d["sources"][0]["requests"] = 100
        d["sources"][0]["requests_ok"] = 61
        self.assertTrue(any("failed requests" in p for p in self.check(d)))

    def test_rejects_source_without_fields(self):
        d = copy.deepcopy(self.doc)
        d["sources"][0]["provides"] = []
        self.assertTrue(any("does not state what it provides" in p for p in self.check(d)))

    def test_rejects_source_without_timestamp(self):
        d = copy.deepcopy(self.doc)
        d["sources"][0]["verified_utc"] = None
        self.assertTrue(any("verification timestamp" in p for p in self.check(d)))

    def test_rejects_irregularity_without_evidence(self):
        d = copy.deepcopy(self.doc)
        d["irregularities"][0].pop("evidence", None)
        self.assertTrue(any("cites no evidence" in p for p in self.check(d)))

    def test_rejects_irregularity_without_real_effect(self):
        d = copy.deepcopy(self.doc)
        d["irregularities"][0]["effect"] = "broken"
        self.assertTrue(any("real effect statement" in p for p in self.check(d)))

    def test_rejects_fixture_count_drift(self):
        d = copy.deepcopy(self.doc)
        d["coverage"]["fixtures_scored"] = d["coverage"]["fixtures_scored"] + 1
        self.assertTrue(any("does not match the committed fixture count" in p for p in self.check(d)))

    def test_rejects_unreconciled_tip_arithmetic(self):
        d = copy.deepcopy(self.doc)
        d["coverage"]["tips_skipped"] = 0
        self.assertTrue(any("tips_skipped does not reconcile" in p for p in self.check(d)))

    def test_rejects_more_published_than_generated(self):
        d = copy.deepcopy(self.doc)
        d["coverage"]["tips_published"] = d["coverage"]["tips_generated"] + 5
        self.assertTrue(any("more published tips than generated" in p for p in self.check(d)))

    def test_rejects_missing_coverage_block(self):
        d = copy.deepcopy(self.doc)
        d.pop("coverage")
        self.assertTrue(any("no coverage block" in p for p in self.check(d)))

    def test_rejects_empty_source_list(self):
        d = copy.deepcopy(self.doc)
        d["sources"] = []
        self.assertTrue(any("lists no sources" in p for p in self.check(d)))


if __name__ == "__main__":
    unittest.main()
