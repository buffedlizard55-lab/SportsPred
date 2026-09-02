import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_SPORTS, getSportConfig } from '../engine/multi_sport.js';

describe('Multi-Sport Coordinator', () => {
  it('registers supported sports including handball and tennis', () => {
    const ids = SUPPORTED_SPORTS.map((s) => s.id);
    assert.ok(ids.includes('handball'));
    assert.ok(ids.includes('tennis'));
    assert.ok(ids.includes('volleyball'));
  });

  it('getSportConfig returns configuration for handball and tennis', () => {
    const hb = getSportConfig('handball');
    assert.equal(hb.name, 'Handball');
    assert.equal(hb.promptVersion, 'v1.0');
    assert.ok(hb.markets.includes('WIN MATCH'));
    assert.ok(hb.markets.includes('POINT SPREAD'));
    assert.ok(hb.markets.includes('GAME TOTAL'));

    const tennis = getSportConfig('tennis');
    assert.equal(tennis.name, 'Tennis');
    assert.ok(tennis.markets.includes('Win Match'));
  });
});
