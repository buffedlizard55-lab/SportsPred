/**
 * NPB writer — Step 4 output rules of the NPB BASEBALL PREDICTION MASTER
 * PROMPT v1.0, checked on generated text rather than on intentions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreNpbMatch } from '../engine/npb_engine.js';
import { writeNpbCard, validateNpbTip, drawFlagNote, BANNED_PHRASES, NPB_FORBIDDEN_WORDS, MIN_WORDS, OPENERS } from '../engine/npb_writer.js';

const sp = (qs4, qs3, { ip = 6.5, runs = 2 } = {}) => ({ name: 'X', confirmed: true, qualityStartsLast4: qs4, qualityStartsLast3: qs3, last4: [{ ip, runs }, { ip, runs }, { ip, runs }, { ip, runs }], shortRest: false, avgInningsPerStart: ip });
const side = (o = {}) => ({ name: 'Team', displayName: 'Team', code: 'X', league: 'central', form: { last5: ['W', 'W', 'W', 'W', 'L'] }, starter: sp(3, 2), runDiffPerGame: 1.0, drawRate: 0.03, bullpen: { effective: true, fatigued: false }, runsPerGameRecent: 3.2, avgWinMarginLast5Wins: 2.6, odds: { american: -150 }, vsStarterHandednessAvg: 0.25, recentTotals: { overs: 1, unders: 4 }, ...o });
const favMatch = (id = 'a') => ({
  id, dateISO: '2026-09-04', league: 'central', roof: 'open', forecast: 'rain', leagueDrawRate: 0.02,
  home: side({ name: 'Hanshin Tigers', displayName: 'Hanshin Tigers', code: 'T' }),
  away: side({ name: 'Yomiuri Giants', displayName: 'Yomiuri Giants', code: 'G', form: { last5: ['L', 'L', 'W', 'L', 'L'] }, starter: sp(0, 0, { runs: 5, ip: 4.5 }), runDiffPerGame: -1.2, odds: { american: 130 }, avgWinMarginLast5Wins: 1.2, runsPerGameRecent: 3.0 }),
  h2h: { sameLeague: { meetings: 10, winsA: 7, winsB: 3, draws: 0, recentClose: { qualifies: false, detail: '1 of last 5 close' } } },
});
const drawMatch = (id = 'b') => ({
  ...favMatch(id), roof: 'dome', forecast: null,
  home: side({ name: 'Fukuoka SoftBank Hawks', displayName: 'Fukuoka SoftBank Hawks', code: 'H', league: 'pacific' }),
  away: side({ name: 'Hokkaido Nippon-Ham Fighters', displayName: 'Hokkaido Nippon-Ham Fighters', code: 'F', league: 'pacific', runDiffPerGame: 0.8 }),
  league: 'pacific',
  h2h: { sameLeague: { meetings: 10, winsA: 5, winsB: 4, draws: 1, recentClose: { qualifies: true, detail: '3 of last 5 decided by 1 run or drawn' } } },
});
const thinMatch = (id = 'c') => ({
  ...favMatch(id),
  home: side({ name: 'Chunichi Dragons', displayName: 'Chunichi Dragons', code: 'D', starter: { name: 'A', confirmed: true }, odds: null, bullpen: null, vsStarterHandednessAvg: null, recentTotals: null }),
  away: side({ name: 'Tokyo Yakult Swallows', displayName: 'Tokyo Yakult Swallows', code: 'S', starter: { name: 'B', confirmed: true }, odds: null, bullpen: null, vsStarterHandednessAvg: null, recentTotals: null }),
});

const words = (t) => t.replace(/\*\*/g, '').split(/\s+/).filter(Boolean);

test('constants: 40-word floor, the seven banned phrases, NPB forbidden words, unique openers', () => {
  assert.equal(MIN_WORDS, 40);
  for (const p of ['this should be a low-scoring affair', 'hard to look past', 'the pitching matchup favours', 'on current form', 'could go either way', 'both lineups', 'a tight contest']) {
    assert.ok(BANNED_PHRASES.map((x) => x.toLowerCase()).includes(p), `banned: ${p}`);
  }
  for (const w of ['central', 'pacific', 'interleague', 'dome', 'npb']) assert.ok(NPB_FORBIDDEN_WORDS.includes(w));
  assert.equal(new Set(OPENERS.map((o) => o.word)).size, OPENERS.length, 'every opener word is distinct');
});

test('every active tip obeys Step 4: 40+ words, bold outcome inside 20 words, no digits, names, venues, leagues or sources; confidence stated', () => {
  const results = [favMatch('a'), drawMatch('b')].map(scoreNpbMatch);
  const card = writeNpbCard(results, { dateISO: '2026-09-04' });
  const active = card.tips.filter((t) => !t.skip);
  assert.ok(active.length >= 3, `expected several active tips, got ${active.length}`);
  for (const t of active) {
    assert.deepEqual(t.validation, { ok: true, violations: [] }, `${t.label}: ${t.validation.violations.join('; ')}`);
    const w = words(t.text);
    assert.ok(w.length >= 40, `${t.label} has ${w.length} words`);
    const boldAt = t.text.split(/\s+/).findIndex((x) => x.startsWith('**'));
    assert.ok(boldAt > -1 && boldAt < 20, `${t.label}: bold outcome at word ${boldAt}`);
    assert.ok(!/\d/.test(t.text), 'no digits');
    // Team names are allowed (the pick must be named); players, venues, leagues and sources are not.
    assert.ok(!/Koshien|Jingu|Kyocera|PayPay|npb\.jp|OLBG|Central|Pacific|Sasaki|Murakami/i.test(t.text), `no player/venue/league/source names: ${t.text}`);
    assert.match(t.text, /Confidence: (HIGH|MEDIUM|LOW)\.$/);
    for (const p of BANNED_PHRASES) assert.ok(!t.text.toLowerCase().includes(p.toLowerCase()), `banned phrase "${p}"`);
    if (t.market === 'game_total') assert.match(t.text, /\*\*(OVER|UNDER)\*\*/);
    if (t.market === 'run_line') assert.match(t.text, /cover/);
  }
  assert.deepEqual(card.openerProblems, [], 'no two active tips open the same way');
  const openers = active.map((t) => words(t.text)[0]);
  assert.equal(new Set(openers).size, openers.length);
});

test('a draw pick is written as a genuine selection with its own label, and the draw flag note names it', () => {
  const r = scoreNpbMatch(drawMatch());
  assert.equal(r.winMatch.decision.outcome, 'draw');
  const card = writeNpbCard([r], { dateISO: '2026-09-04' });
  const win = card.tips[0];
  assert.equal(win.label, 'DRAW');
  assert.equal(win.draw, true);
  assert.match(win.text, /\*\*Draw\*\*/);
  assert.ok(!/hedge|insurance policy|cover yourself/i.test(win.text.replace(/rather than as insurance/, '')), 'never framed as a hedge');
  assert.equal(card.tips[1].skip, true, 'run line withheld when the draw is live');
  assert.match(card.drawNote, /Hokkaido Nippon-Ham Fighters v Fukuoka SoftBank Hawks — draw likelihood exceeded the threshold and the draw is the primary selection/);
  assert.match(drawFlagNote([]), /no fixture on this card reached the draw likelihood threshold/);
});

test('SKIP is one sentence, digit-free, labelled, and carries the engine reason separately', () => {
  const r = scoreNpbMatch(thinMatch());
  const card = writeNpbCard([r], { dateISO: '2026-09-04' });
  assert.equal(card.tips.length, 3);
  for (const t of card.tips) {
    assert.equal(t.skip, true);
    assert.match(t.text, /^SKIP — (WIN MATCH OUTRIGHT|RUN LINE|GAME TOTAL): [^.]+\.$/);
    assert.ok(!/\d/.test(t.text));
    assert.ok(t.reason && /sourced|below|floor/.test(t.reason), `reason kept for the analysis panel: ${t.reason}`);
    assert.equal(t.validation.ok, true);
  }
  assert.deepEqual(card.summaryRows, []);
});

test('card ends with summary table, underdog value flag, draw flag and responsible-gambling line', () => {
  const card = writeNpbCard([favMatch('a'), drawMatch('b'), thinMatch('c')].map(scoreNpbMatch), { dateISO: '2026-09-04' });
  const text = card.formattedText;
  assert.match(text, /^NPB PREDICTIONS — 2026-09-04/);
  assert.match(text, /\nSUMMARY\n/);
  assert.ok(card.summaryRows.length >= 3);
  for (const row of card.summaryRows) assert.ok(row.fixture && row.market && row.selection && row.confidence);
  const tail = text.split('SUMMARY')[1];
  assert.match(tail, /Underdog value flag:/);
  assert.match(tail, /Draw flag:/);
  assert.match(tail, /gamble responsibly/i);
  assert.ok(text.indexOf('Underdog value flag') < text.indexOf('Draw flag'), 'flags follow the table in prompt order');
  assert.ok(text.trim().endsWith('promise.'), 'responsible-gambling reminder is the last line');
});

test('validator rejects each Step 4 violation', () => {
  const good = 'Momentum carries real weight in this spot. **Hanshin Tigers** are the call to win outright, and the case is built on the quality of the arm they send out, a rested relief corps and a run environment that keeps slipping their way. Confidence: HIGH.';
  assert.equal(validateNpbTip(good, { market: 'win_match' }).ok, true);
  assert.equal(validateNpbTip(good.replace('Confidence: HIGH.', ''), { market: 'win_match' }).ok, false, 'confidence required');
  assert.ok(validateNpbTip(good.replace('a rested', 'a 3-day rested'), { market: 'win_match' }).violations.some((v) => /numeral|digit/i.test(v)));
  assert.ok(validateNpbTip(good.replace('in this spot', 'in this Central spot'), { market: 'win_match' }).violations.some((v) => /central/.test(v)));
  assert.ok(validateNpbTip(good.replace('in this spot', 'in this dome'), { market: 'win_match' }).violations.some((v) => /dome/.test(v)));
  assert.ok(validateNpbTip(good.replace('Momentum carries real weight', 'Hard to look past momentum'), { market: 'win_match' }).violations.some((v) => /banned/i.test(v)));
  assert.equal(validateNpbTip('Short. **Team** wins. Confidence: HIGH.', { market: 'win_match' }).ok, false, 'word floor');
  const late = `${'Words '.repeat(25)}**Team** wins outright. ${'more words here '.repeat(8)}Confidence: HIGH.`;
  assert.equal(validateNpbTip(late, { market: 'win_match' }).ok, false, 'bold outcome must land inside the first twenty words');
});
