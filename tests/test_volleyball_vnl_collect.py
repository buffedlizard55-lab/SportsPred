"""Fail-closed official VNL schedule extraction tests."""

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from collect_volleyball_vnl import parse_schedule  # noqa: E402


class VnlOfficialCollectorTests(unittest.TestCase):
    def test_extracts_only_complete_women_vnl_objects(self):
        page = '''
        <script id="__NEXT_DATA__" type="application/json">{
          "props": {"pageProps": {"schedule": [
            {"id":"w-17","competitionName":"Volleyball Nations League","genderName":"Women","startDate":"2026-06-03T03:30:00Z","homeTeam":{"name":"Belgium"},"awayTeam":{"name":"Poland"},"status":"scheduled","roundName":"Pool 3","venueName":"Nanjing"},
            {"id":"m-18","competitionName":"Volleyball Nations League","genderName":"Men","startDate":"2026-06-10T03:30:00Z","homeTeam":{"name":"Poland"},"awayTeam":{"name":"Cuba"},"status":"scheduled"},
            {"id":"bad-time","competitionName":"Volleyball Nations League","genderName":"Women","startDate":"2026-06-04T12:00:00","homeTeam":{"name":"A"},"awayTeam":{"name":"B"},"status":"scheduled"}
          ]}}
        }</script>'''
        rows = parse_schedule(page)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['id'], 'w-17')
        self.assertEqual(rows[0]['family'], 'vnl-women')
        self.assertEqual(rows[0]['phase'], 'upcoming')
        self.assertEqual(rows[0]['startUtc'], '2026-06-03T03:30:00Z')
        self.assertTrue(rows[0]['source_url'].startswith('https://'))

    def test_does_not_guess_when_page_has_no_embedded_complete_row(self):
        self.assertEqual(parse_schedule('<html><body>Women VNL schedule</body></html>'), [])


if __name__ == '__main__':
    unittest.main()
