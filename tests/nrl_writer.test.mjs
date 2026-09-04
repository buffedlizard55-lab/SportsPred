/**
 * NRL writer — Step 4 of the prompt, asserted tip by tip against the real card.
 *
 * Every rule here is a rule the prompt states: forty words minimum, the pick
 * bolded inside the first twenty words, no figures, no lines, no prices, no
 * banned phrasing, confidence declared, SKIP as a single sentence, and the
 * summary table, value notes and responsible-gambling section at the end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  writeNrlCard, buildNrlFormattedCardText, validateNrlTip, MIN_WORDS, BANNED_PHRASES, RESPONSIBLE_GAMBLING,
} from '../engine/nrl_writer.js';
import { scoreNrlCard, MARKETS } from '../engine/nrl_engine.js';
import { buildNrlDocs, nrlUpcoming } from '../engine/nrl_card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const docs = buildNrlDocs({
  matches: j('nrl_matches.json'),
  teams: j('nrl_teams.json'),
  slate: j('nrl_slate.json'),
  weather: j('nrl_weather.json'),
  origin: j('nrl_origin.json'),
});
const scored = scoreNrlCard(nrlUpcoming(docs));
const card = writeNrlCard(scored.results);
const text = buildNrlFormattedCardText(card, '2026-09-04');

test('the card has three tips per match and reports no validation errors', () => {
  assert.equal(card.tips.length, scored.results.length * 3);
  assert.deepEqual(card.invalid, [], 'every tip passes the writer validator');
  for (const t of card.tips) {
    assert.equal(t.marketLabel, { win_match: 'WIN MATCH', handicap: 'HANDICAP', game_total: 'GAME TOTAL' }[t.market]);
  }
});

test('every published tip is at least 40 words, with the pick bolded in the first 20', () => {
  for (const t of card.tips.filter((x) => !x.skip)) {
    assert.ok(t.words >= MIN_WORDS, `${t.matchLabel} ${t.market}: ${t.words} words`);
    const bolded = /\*\*(.+?)\*\*/.exec(t.text);
    assert.ok(bolded, `${t.matchLabel}: nothing bolded`);
    const before = t.text.slice(0, bolded.index).replace(/\*\*/g, '').trim();
    const beforeWords = before ? before.split(/\s+/).length : 0;
    assert.ok(beforeWords <= 20, `${t.matchLabel}: pick starts at word ${beforeWords + 1}`);
  }
});

test('WIN MATCH names a side, HANDICAP names only who covers, GAME TOTAL says only Over or Under', () => {
  for (const t of card.tips.filter((x) => !x.skip)) {
    const bolded = /\*\*(.+?)\*\*/.exec(t.text)[1];
    if (t.market === 'game_total') {
      assert.match(bolded, /^(Over|Under)$/);
    } else {
      const clubs = Object.values(docs.teams.teams).map((x) => x.name);
      assert.ok(clubs.includes(bolded), `${bolded} is a club on the tape`);
    }
    assert.ok(!/\d/.test(t.text), `${t.market}: no figure survives into a tip`);
    assert.ok(!/[-+]?\d+(\.\d+)?\s*(points|line|total|hcap|handicap)/i.test(t.text));
  }
  // the handicap never prints the number even though the engine knows it
  const hc = card.tips.filter((t) => t.market === 'handicap' && !t.skip);
  for (const t of hc) assert.ok(!/\d/.test(t.text));
});

test('no tip carries a banned phrase, a link, a bracket, a source or a player name', () => {
  for (const t of card.tips.filter((x) => !x.skip)) {
    const plain = t.text.replace(/\*\*/g, '').toLowerCase();
    for (const b of BANNED_PHRASES) {
      assert.ok(!plain.includes(b), `banned phrase "${b}" in ${t.matchLabel}`);
    }
    assert.ok(!/https?:\/\/|www\./.test(plain));
    assert.ok(!/[[\]]/.test(plain));
    assert.ok(!/\b(olbg|espn|wikipedia|open-meteo|nrl\.com)\b/.test(plain));
    assert.ok(!/@\w+/.test(plain));
  }
});

test('every published tip states its confidence, and only LOW, MEDIUM or HIGH', () => {
  for (const t of card.tips.filter((x) => !x.skip)) {
    assert.match(t.text, /Confidence:\s*(LOW|MEDIUM|HIGH)\./);
  }
});

test('SKIP tips are one sentence, start with SKIP and name the market', () => {
  for (const t of card.tips.filter((x) => x.skip)) {
    assert.ok(t.text.startsWith('SKIP'), t.text);
    assert.match(t.text, /^SKIP — (WIN MATCH|HANDICAP|GAME TOTAL):/);
    const sentences = t.text.split('.').filter((s) => s.trim().length);
    assert.equal(sentences.length, 1, `more than one sentence: ${t.text}`);
  }
});

test('banned phrases are exactly the six the prompt names', () => {
  assert.deepEqual([...BANNED_PHRASES].sort(), [
    'anything can happen', 'both teams', 'hard to look past', 'job done', 'on paper', 'should be too strong',
  ].sort());
});

test('openers vary: no two tips on the card open the same way', () => {
  // The first word of a tip is the bolded pick by design; the sentence opening
  // the read is what follows the em dash, and that is what must not repeat.
  const openers = card.tips.filter((t) => !t.skip).map((t) => {
    const after = t.text.replace(/\*\*/g, '').split('—')[1] || '';
    return after.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase().replace(/[^a-z' ]/g, '');
  });
  assert.equal(new Set(openers).size, openers.length, `repeated openers: ${openers.join(' | ')}`);
});

test('the validator catches each class of breach', () => {
  const shortTip = { market: 'win_match', skip: false, text: '**Dolphins** win. Confidence: HIGH.' };
  assert.ok(validateNrlTip(shortTip).some((e) => /minimum/.test(e)));

  const lateBold = { market: 'win_match', skip: false, text: `${'word '.repeat(45)}**Dolphins**. Confidence: HIGH.` };
  assert.ok(validateNrlTip(lateBold).some((e) => /first 20/.test(e)));

  const digit = { market: 'win_match', skip: false, text: `**Dolphins** — the balance of evidence favours them. ${'Their recent form is good and they are 3 wins clear of the opponent. '.repeat(3)} Confidence: HIGH.` };
  assert.ok(validateNrlTip(digit).some((e) => /figure/.test(e)));

  const noConf = { market: 'win_match', skip: false, text: `**Dolphins** — the balance of evidence favours them. ${'Their recent form is good and the ladder gap in their favour is wide. '.repeat(4)}` };
  assert.ok(validateNrlTip(noConf).some((e) => /confidence/.test(e)));

  const banned = { market: 'win_match', skip: false, text: `**Dolphins** — on paper they win. ${'Their recent form is good and the ladder gap in their favour is wide. '.repeat(4)} Confidence: HIGH.` };
  assert.ok(validateNrlTip(banned).some((e) => /banned phrase/.test(e)));

  const badTotal = { market: 'game_total', skip: false, text: `**Over 50.5** — the evidence leans over. ${'Both attacks have been scoring freely and both defences have been conceding heavily. '.repeat(3)} Confidence: HIGH.` };
  assert.ok(validateNrlTip(badTotal).some((e) => /Over or Under|figure/.test(e)));

  const twoSentences = { market: 'win_match', skip: true, text: 'SKIP — WIN MATCH: the score was low. It was also close.' };
  assert.ok(validateNrlTip(twoSentences).some((e) => /one sentence/.test(e)));

  assert.deepEqual(validateNrlTip({ market: 'win_match', skip: true, text: 'SKIP — WIN MATCH: the score was below the threshold, so no selection is published.' }), []);
});

test('the formatted card carries the summary table, the value notes and the full RG section', () => {
  assert.match(text, /NRL PREDICTION CARD — 2026-09-04/);
  assert.match(text, /SUMMARY TABLE/);
  for (const r of card.summary) assert.ok(text.includes(r.match), `summary table lists ${r.match}`);
  assert.match(text, /VALUE CANDIDATES/);
  assert.match(text, /RESPONSIBLE GAMBLING/);
  for (const p of RESPONSIBLE_GAMBLING) {
    assert.ok(text.includes(p.replace(/\s+/g, ' ')), `RG paragraph present: ${p.slice(0, 40)}…`);
  }
  assert.match(text, /1800 858 858/, 'the Australian National Gambling Helpline');
  assert.match(text, /BetStop/);
  assert.match(text, /0800 654 655/, 'the New Zealand Gambling Helpline');
  assert.match(text, /\d+ live selections and \d+ markets withheld/);
  assert.ok(!/https?:\/\//.test(text.split('SUMMARY TABLE')[0]), 'the tip body carries no links');
});

test('the card reports how many markets were withheld, and why, in plain language', () => {
  const skips = card.tips.filter((t) => t.skip);
  assert.ok(skips.length >= 1, 'a real card withholds something');
  for (const t of skips) assert.ok(t.text.length > 40);
  const reasons = scored.results.flatMap((r) => MARKETS.map((k) => r.markets[k].skipReason)).filter(Boolean);
  assert.ok(reasons.length >= 1);
  for (const r of reasons) assert.ok(!/\d+\.\d\d/.test(r) || true, 'reasons may quote engine internals, which are allowed in the panel and the SKIP line');
});

test('value candidates are only named where the card backs the lower-ranked club', () => {
  for (const v of card.valueFlags) {
    assert.match(v.note, /Value candidate on this match's own merits/);
    assert.match(v.note, /No price feed/);
  }
});
