import test from 'node:test';
import assert from 'node:assert/strict';
import { writeNbaGame } from '../engine/nba_writer.js';

const result = {
  markets: {
    match_result: { selection: 'Home Team', band: 'HIGH', score: 80 },
    handicap: { selection: 'Home Team -7.5', band: 'MEDIUM', score: 62 },
    total: { selection: 'Under 224.5', band: 'LOW', score: 51 },
  },
  missing: [{ label: 'player availability' }],
};

test('NBA writer emits three independent markets in prompt order', () => {
  const card = writeNbaGame(result);
  assert.deepEqual(card.map((x) => x.market), ['match_result', 'handicap', 'total']);
  assert.deepEqual(card.map((x) => x.band), ['HIGH', 'MEDIUM', 'LOW']);
  for (const tip of card) {
    assert.equal(tip.ok, true);
    assert.ok(tip.words >= 40);
    assert.match(tip.text, /\*\*[^*]+\*\*/);
    assert.doesNotMatch(tip.text, /\d/);
  }
  assert.match(card[1].text, /\*\*Home Team\*\*/);
  assert.match(card[2].text, /\*\*Under\*\*/);
});

test('NBA writer withholds a market without exposing source details', () => {
  const [tip] = writeNbaGame({ markets: { match_result: { band: 'SKIP', reason: 'posted line 224.5 was unavailable' } } });
  assert.equal(tip.ok, false);
  assert.equal(tip.band, 'SKIP');
  assert.match(tip.text, /^SKIP WIN MATCH:/);
  assert.doesNotMatch(tip.text, /\d|posted line/);
  assert.ok(tip.text.split(/\s+/).length >= 40);
});
