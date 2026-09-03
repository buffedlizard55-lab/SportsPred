/**
 * Plain-language writer for the FIVB VNL Women card.
 *
 * It is deliberately downstream-only: a sentence may cite a factor only when
 * the scorer marked that factor as sourced evidence. No odds, numeric stats,
 * roster names, source names, or links can enter a tip.
 */

import { CONFIDENCE } from './volleyball_engine.js';

export const MIN_WORDS = 40;
export const BANNED_PHRASES = Object.freeze([
  'hard to look past', 'the better side', 'on paper', 'both teams', 'anything can happen', 'straightforward test',
]);
export const FORBIDDEN_TOKENS = Object.freeze([
  'odds', 'price', 'bookmaker', 'olbg', 'espn', 'fivb', 'volleyball world', 'twitter', 'instagram', 'http', 'www.',
]);

export const VOLLEYBALL_OPENERS = Object.freeze([
  { id: 'serve', word: 'Serve-receive', lead: 'sets the tone for this assessment.' },
  { id: 'rotation', word: 'Rotation', lead: 'is central to the model’s read of this fixture.' },
  { id: 'tempo', word: 'Tempo', lead: 'shapes the expectation for this contest.' },
  { id: 'pressure', word: 'Pressure', lead: 'gives the card its clearest angle here.' },
  { id: 'balance', word: 'Balance', lead: 'matters most in this matchup.' },
  { id: 'execution', word: 'Execution', lead: 'frames the current model view.' },
  { id: 'momentum', word: 'Momentum', lead: 'is assessed only through the verified record.' },
  { id: 'composure', word: 'Composure', lead: 'is the theme behind this measured selection.' },
]);

const SET_RE = /\*\*3-[012]\*\*/;

function words(text) { return String(text || '').trim().split(/\s+/).filter(Boolean); }

export function validateVolleyballTip(text, { market, expectSkip = false } = {}) {
  const value = String(text || '').trim();
  const violations = [];
  if (!value) return { ok: false, violations: ['empty tip text'] };
  if (expectSkip) {
    if (!value.startsWith('SKIP —')) violations.push('SKIP tip must begin with SKIP —');
    if (value.split(/(?<=[.!?])\s+/).filter(Boolean).length !== 1) violations.push('SKIP must be one explanatory sentence');
    return { ok: violations.length === 0, violations };
  }
  if (words(value).length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words`);
  const boldAt = value.indexOf('**');
  if (boldAt < 0) violations.push('no bolded pick');
  else if (words(value.slice(0, boldAt)).length > 20) violations.push('bolded pick occurs after the first 20 words');
  if (market === 'set_score' && !SET_RE.test(value)) violations.push('set-score tip must bold 3-0, 3-1, or 3-2');
  const withoutSetScore = value.replace(/\*\*3-[012]\*\*/g, '');
  if (/\d/.test(withoutSetScore.replace(/\*\*/g, ''))) violations.push('contains a forbidden numeral');
  if (/[\[\]{}()]/.test(value)) violations.push('contains a bracketed reference');
  const lower = value.toLowerCase();
  for (const phrase of BANNED_PHRASES) if (lower.includes(phrase)) violations.push(`contains banned phrase: "${phrase}"`);
  for (const token of FORBIDDEN_TOKENS) if (lower.includes(token)) violations.push(`contains forbidden token: "${token}"`);
  if (!/Confidence: (HIGH|MEDIUM|LOW)\.$/.test(value)) violations.push('missing terminal confidence label');
  return { ok: violations.length === 0, violations };
}

function evidenceSentences(evidence, market) {
  const available = new Set(evidence || []);
  const sentences = [];
  if (available.has('recent VNL form')) sentences.push('Recent competition form gives the selected side a verified performance edge.');
  if (available.has('head-to-head record')) sentences.push('The documented meeting history also points in the same direction.');
  if (available.has('confirmed squad availability')) sentences.push('The confirmed squad report does not introduce a material availability concern.');
  if (available.has('cross-checked market price')) sentences.push('Independent market checks agree on the direction, although figures are kept out of the written card.');
  if (available.has('standings stakes')) sentences.push('The confirmed standings situation is included because motivation and rotation can matter in this format.');
  if (available.has('quality gap')) sentences.push('The sourced recent team indicators establish the relevant quality gap for the margin call.');
  if (available.has('recent set pattern')) sentences.push('Recent comparable scorelines support that proposed match length.');
  if (available.has('standings incentive')) sentences.push('The standings incentive makes a longer finish more plausible than quality alone would suggest.');
  if (available.has('head-to-head set pattern')) sentences.push('Past documented set patterns reinforce the chosen margin.');
  if (!sentences.length) sentences.push(market === 'set_score'
    ? 'The margin is retained only when the available verified indicators reach the stated threshold.'
    : 'The selection is retained only when the available verified indicators reach the stated threshold.');
  return sentences;
}

function skipText(market, result) {
  const reason = result?.markets?.[market]?.reason
    || (market === 'set_score' ? 'the verified margin indicators are too close or incomplete' : 'the verified match-winner evidence does not clear the threshold');
  return `SKIP — ${market === 'win_match' ? 'MATCH WINNER' : 'SET SCORE'}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`;
}

export function writeVolleyballTip({ result, market, angle = VOLLEYBALL_OPENERS[0] }) {
  const scored = result?.markets?.[market];
  if (!scored || !result) return { ok: false, violations: ['market result is unavailable'] };
  const skip = scored.band === CONFIDENCE.SKIP || !scored.selection;
  if (skip) {
    const text = skipText(market, result);
    const check = validateVolleyballTip(text, { market, expectSkip: true });
    return { ...check, text, band: CONFIDENCE.SKIP, skip: true, selection: null };
  }

  const base = market === 'win_match'
    ? `${angle.word} ${angle.lead} **${scored.selection}** is the MATCH WINNER selection.`
    : `${angle.word} ${angle.lead} **${scored.outcome}** is the projected SET SCORE, with ${result.favourite} expected to win.`;
  const facts = evidenceSentences(result.evidence?.[market], market);
  const tail = 'This is a model-based estimate, not a guarantee, and it does not fill gaps with unverified information.';
  const text = `${base} ${facts.join(' ')} ${tail} Confidence: ${scored.band}.`;
  const check = validateVolleyballTip(text, { market });
  return { ...check, text, band: scored.band, skip: false, selection: scored.selection, market };
}

export function writeVolleyballCard(scoredMatches = []) {
  const tips = [];
  const violations = [];
  const used = new Set();
  let i = 0;
  for (const row of scoredMatches) {
    const match = row.match || {};
    const result = row.result;
    for (const market of ['win_match', 'set_score']) {
      let angle = VOLLEYBALL_OPENERS[i % VOLLEYBALL_OPENERS.length];
      while (used.has(angle.id) && used.size < VOLLEYBALL_OPENERS.length) {
        i += 1;
        angle = VOLLEYBALL_OPENERS[i % VOLLEYBALL_OPENERS.length];
      }
      const written = writeVolleyballTip({ result, market, angle });
      if (!written.ok) violations.push({ event_id: result?.event_id || match.event_id || match.id || null, market, violations: written.violations });
      if (!written.skip) used.add(angle.id);
      tips.push({
        event_id: result?.event_id || match.event_id || match.id || null,
        match: `${match.home || 'Home'} v ${match.away || 'Away'}`,
        market,
        marketLabel: market === 'win_match' ? 'MATCH WINNER' : 'SET SCORE',
        ...written,
      });
      i += 1;
    }
  }
  return { tips, card: tips.filter((tip) => tip.ok).map((tip) => tip.text).join('\n\n'), violations };
}

/** Copy-ready card. The support contacts were verified against GamCare and the
 * NCPG on 2026-09-03; their links remain in the site footer/source register. */
export function buildVolleyballFormattedCardText(scoredMatches = [], dateISO = '') {
  const card = writeVolleyballCard(scoredMatches);
  const lines = [`FIVB Volleyball Nations League — Women Predictions${dateISO ? ` — ${dateISO}` : ''}`, ''];
  for (const tip of card.tips) {
    lines.push(`${tip.match} — ${tip.marketLabel} [${tip.band}]`);
    lines.push(tip.text.replace(/\*\*/g, ''));
    lines.push('');
  }
  lines.push('SUMMARY TABLE');
  lines.push('Match | Match winner | Winner confidence | Set score | Set confidence');
  for (const row of scoredMatches) {
    const match = row.match || {};
    const result = row.result || {};
    const winner = result.markets?.win_match || {};
    const set = result.markets?.set_score || {};
    lines.push(`${match.home || 'Home'} v ${match.away || 'Away'} | ${winner.selection || 'SKIP'} | ${winner.band || 'SKIP'} | ${set.selection || 'SKIP'} | ${set.band || 'SKIP'}`);
  }
  lines.push('');
  lines.push('VALUE CANDIDATES');
  const values = scoredMatches.map((row) => ({ match: row.match, value: row.result?.valueCandidate })).filter((row) => row.value);
  lines.push(values.length ? values.map((row) => `${row.match.home} v ${row.match.away}: ${row.value.team} — ${row.value.reason}`).join('\n') : 'None flagged from verified per-match evidence.');
  lines.push('');
  lines.push('RESPONSIBLE GAMBLING');
  lines.push('These are model-based estimates, not guarantees or betting advice. Only wager an amount you are comfortable losing, and set spending and time limits before you start. Do not chase losses. In Great Britain, GamCare’s National Gambling Helpline is 0808 8020 133. In the United States, the National Council on Problem Gambling directs people to 1-800-MY-RESET; local availability can vary. Elsewhere, contact an appropriate national gambling-harm support resource. Contact details can change, so check the linked official support pages before publishing.');
  return lines.join('\n');
}
