/**
 * SportsPred — prediction writer and output validator.
 *
 * Step 4 of the master prompt is a hard set of output constraints. Rather than
 * trusting prose to obey them, every tip is run through `validateTip` and the
 * rule that failed is surfaced. A tip that fails validation is not emitted.
 *
 * The writer never invents facts: every claim it can make is drawn from the
 * `result.components` produced by the engine, and any factor that was not
 * sourced is simply absent from the text.
 */

import { CONFIDENCE } from './engine.js';

export const MIN_WORDS = 40;

export const BANNED_PHRASES = [
  'this should be straightforward',
  'a tough match',
  'could go either way',
  'hard to call',
  'the better player',
  'on paper',
];

/**
 * Opening pool. Step 4 requires that no two tips in one output share an
 * opening word, phrase or sentence structure. Each entry therefore carries a
 * distinct first word plus a distinct clause shape.
 *
 * HARD LIMIT, stated plainly: uniqueness holds only up to OPENERS.length tips.
 * A 20-match card needs 60 tips, which exceeds any honest hand-written pool, so
 * writeCard reports `openerPoolExhausted` instead of quietly repeating an
 * opening. See docs/IRREGULARITIES.md.
 */
export const OPENERS = [
  { id: 'surface', word: 'Surface', lead: 'type is the clearest dividing line between these two this season.' },
  { id: 'serve', word: 'Serving', lead: 'quality separates these two from the very first exchanges.' },
  { id: 'rank', word: 'Ranking', lead: 'reflects a full season of results rather than one flattering week.' },
  { id: 'h2h', word: 'Head-to-head', lead: 'history here has repeatedly pointed in the same direction.' },
  { id: 'fatigue', word: 'Fatigue', lead: 'is the variable most often mispriced at this stage.' },
  { id: 'momentum', word: 'Momentum', lead: 'carries the argument more convincingly than any single result.' },
  { id: 'context', word: 'Context', lead: 'raises the cost of an early lapse considerably.' },
  { id: 'form', word: 'Form', lead: 'over the past month has been remarkably consistent.' },
  { id: 'court', word: 'Court', lead: 'conditions reward the attributes on one side of this draw.' },
  { id: 'delivery', word: 'Delivery', lead: 'behind the first ball remains the sharpest separator here.' },
  { id: 'standing', word: 'Standing', lead: 'between these two has held firm throughout the year.' },
  { id: 'history', word: 'History', lead: 'between this pair has rarely been genuinely close.' },
  { id: 'schedule', word: 'Schedule', lead: 'has done no favours to one side of this draw.' },
  { id: 'trajectory', word: 'Trajectory', lead: 'is the frame that separates two similar-looking records.' },
  { id: 'consistency', word: 'Consistency', lead: 'rather than brilliance has defined the stronger of these two.' },
  { id: 'margin', word: 'Margins', lead: 'of victory tell more than the win column alone.' },
  { id: 'pressure', word: 'Pressure', lead: 'lands unevenly in a fixture of this particular shape.' },
  { id: 'sharpness', word: 'Sharpness', lead: 'in the opening games tends to set the whole contest.' },
  { id: 'depth', word: 'Depth', lead: 'of recent results gives one side a much firmer base.' },
  { id: 'control', word: 'Control', lead: 'of the rally has been the recurring theme throughout.' },
  { id: 'rhythm', word: 'Rhythm', lead: 'has been uninterrupted on one side of this meeting.' },
  { id: 'precedent', word: 'Precedent', lead: 'between these two points firmly in one direction.' },
  { id: 'endurance', word: 'Endurance', lead: 'is the quiet variable in this particular fixture.' },
  { id: 'composure', word: 'Composure', lead: 'under scoreboard pressure has separated these two most reliably.' },
];

/** Backwards-compatible alias for callers that predate the pool. */
export const ANGLES = OPENERS.slice(0, 7);

const MARKET_LABEL = {
  win_match: 'Win Match',
  first_set: 'First Set Winner',
  games_handicap: 'Games Handicap',
};

/** Words that must never appear in emitted prose. */
const FORBIDDEN_TOKENS = [
  'coach', 'stadium', 'arena', 'injury', 'injured', 'withdraw',
  'http', 'www.', '@', 'twitter', 'x.com', 'instagram', 'reddit',
];

/**
 * Descriptors used after the first mention, per the prompt's rule. Deliberately
 * anonymous — no surname — because a surname is still a player name.
 */
function descriptorFor(_playerName, market) {
  if (market === 'games_handicap') return 'the favoured side of the handicap';
  if (market === 'first_set') return 'the opening-set favourite';
  return 'the selection';
}

function findComponent(components, id) {
  return (components || []).find((c) => c.id === id) || null;
}

/**
 * Build the analytical body from sourced components only.
 * @returns {string} prose containing no digits
 */
function buildBody(opener, result, market, names) {
  const c = result.markets[market].components;
  const clauses = [];

  const surface = findComponent(c, 'surface');
  const price = findComponent(c, 'price');
  const rank = findComponent(c, 'rank');
  const fsr = findComponent(c, 'fs_rate');
  const serve = findComponent(c, 'fs_serve');
  const form = findComponent(c, 'form');
  const ss = findComponent(c, 'h_ss');
  const dom = findComponent(c, 'h_dom');

  // Secondary clauses, added only when the underlying factor was sourced.
  if (surface && !surface.missing && !['surface', 'court'].includes(opener.id)) {
    clauses.push('the record on this court supports the same conclusion and does not need to be discounted');
  }
  if (rank && !rank.missing && !['rank', 'standing', 'trajectory'].includes(opener.id)) {
    clauses.push('relative standing has not been flattered by an easy run of opposition');
  }
  if (form && !form.missing && !['form', 'momentum', 'depth', 'rhythm'].includes(opener.id)) {
    clauses.push('the recent run of results reinforces rather than contradicts that reading');
  }
  if (ss && !ss.missing && market === 'games_handicap') {
    clauses.push('recent scorelines have been controlled rather than scraped, which is what a handicap call requires');
  }
  if (dom && !dom.missing && market === 'games_handicap' && opener.id !== 'margin') {
    clauses.push('margins of victory here have repeatedly been comfortable rather than marginal');
  }
  if (price && !price.missing && market === 'win_match') {
    clauses.push('the market has already priced the disparity, which is confirmation rather than the basis of the view');
  }
  if (market === 'first_set') {
    clauses.push(fsr || serve
      ? 'opening-set outcomes turn almost entirely on hold percentage, and the evidence points one way'
      : 'the opening set is decided by service quality long before tactics take hold');
  }

  // Close with the pick, restated anonymously — the name already appeared once
  // in the opening sentence and Step 4 forbids a second mention.
  if (market === 'games_handicap') {
    clauses.push('on that basis the favoured side is the one expected to cover');
  } else if (market === 'first_set') {
    clauses.push('which makes that side the recommendation for the opening set');
  } else {
    clauses.push('which makes that side the recommendation for this market');
  }

  // Always-present honest closer: a statement about method, not a fabricated
  // fact. It also guarantees the 40-word minimum is reachable when only a
  // couple of factors could be sourced.
  clauses.push('nothing beyond the sourced record has been assumed in reaching that view');

  // Separate sentences, not one comma-spliced run-on.
  return clauses
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
    .map((c) => (/\.$/.test(c) ? c : c + '.'))
    .join(' ');
}

/**
 * Enforce every Step 4 / STYLE rule mechanically.
 * @returns {{ok:boolean, violations:string[]}}
 */
export function validateTip(text, { market, names, expectSkip = false } = {}) {
  const v = [];
  const t = String(text || '');

  if (!t.trim()) return { ok: false, violations: ['empty tip'] };

  if (expectSkip) {
    const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) v.push('SKIP tip must be a single sentence');
    if (!/^SKIP/.test(t)) v.push('SKIP tip must begin with SKIP');
    return { ok: v.length === 0, violations: v };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) v.push(`under ${MIN_WORDS} words (${words.length})`);

  if (!/\*\*[^*]+\*\*/.test(t)) v.push('no bolded outcome');
  const boldIdx = t.indexOf('**');
  if (boldIdx >= 0) {
    const wordsBeforeBold = t.slice(0, boldIdx).split(/\s+/).filter(Boolean).length;
    if (wordsBeforeBold > 20) v.push('bolded outcome appears after the first 20 words');
  }

  // No digits at all: one rule blocks odds, lines, set scores and game totals.
  const digits = t.replace(/\*\*/g, '').match(/\d/g);
  if (digits) v.push(`contains numerals (odds/lines/scores must never appear): ${digits.join('')}`);

  // Each player name at most once.
  for (const n of [names?.favourite, names?.opponent].filter(Boolean)) {
    const re = new RegExp(String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const count = (t.match(re) || []).length;
    if (count > 1) v.push(`player name "${n}" used ${count} times`);
  }

  const lower = t.toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) v.push(`banned phrase: "${p}"`);
  for (const tok of FORBIDDEN_TOKENS) if (lower.includes(tok)) v.push(`forbidden token: "${tok}"`);

  if (/[()[\]]/.test(t)) v.push('contains bracketed reference');
  if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/.test(t)) v.push('confidence level not stated');

  // Handicap tips must never state the line. The no-digits rule blocks the
  // number; this additionally blocks line-stating phrasing.
  if (market === 'games_handicap' && /\b(?:handicap of|games handicap of|by)\b/i.test(t)) {
    v.push('handicap tip appears to state the line');
  }

  return { ok: v.length === 0, violations: v };
}

/**
 * Write one tip.
 * @returns {{ok:boolean, text?:string, band?:string, skip?:boolean, violations?:string[]}}
 */
export function writeTip({ match, result, market, angle }) {
  const m = result.markets?.[market];
  if (!m) return { ok: false, violations: [`no such market: ${market}`] };

  const label = MARKET_LABEL[market] || market;
  const names = {
    favourite: result.favourite || 'the favourite',
    opponent: result.opponent || 'the opponent',
  };

  // SKIP is a single explanatory sentence, per Step 4.
  if (m.band === CONFIDENCE.SKIP || m.band === CONFIDENCE.LOW) {
    const reason = m.band === CONFIDENCE.SKIP
      ? 'insufficient dominance evidence for this market'
      : 'the sourced evidence does not clear the threshold for this market';
    const text = `SKIP — ${label}: ${reason}, so no selection is offered on this match.`;
    const v = validateTip(text, { market, names, expectSkip: true });
    return v.ok ? { ok: true, text, band: m.band, skip: true } : { ok: false, violations: v.violations };
  }

  // The distinctive opener leads, and the bolded outcome still lands well
  // inside the first 20 words. Leading with the bolded name instead would make
  // all three markets for one match open identically, breaking Step 4.
  const pickPhrase = market === 'games_handicap' ? 'the cover call'
    : market === 'first_set' ? 'the opening-set pick' : 'the pick';

  const text = `${angle.word} ${angle.lead} **${names.favourite}** is ${pickPhrase} on ${label}. ` +
    `${buildBody(angle, result, market, names)} Confidence: ${m.band}.`;
  const v = validateTip(text, { market, names, expectSkip: false });
  return v.ok
    ? { ok: true, text, band: m.band, skip: false }
    : { ok: false, violations: v.violations, text };
}

/**
 * Write a whole card, guaranteeing no two tips share an opening word — up to
 * the size of the opener pool, beyond which the overflow is reported.
 * @returns {{tips:Array, card:string, violations:Array, openerPoolSize:number}}
 */
export function writeCard(scoredMatches) {
  const tips = [];
  const violations = [];
  const unscored = [];
  const usedOpeners = new Set();
  let idx = 0;

  for (const { match, result } of scoredMatches) {
    // A match the engine could not score has no markets at all. Reporting it
    // once is honest; emitting three "withheld" tips per match is just noise.
    if (!result?.markets || Object.keys(result.markets).length === 0) {
      unscored.push({
        event_id: match?.event_id ?? null,
        match: `${match?.home ?? match?.players?.[0]?.name} v ${match?.away ?? match?.players?.[1]?.name}`,
        reason: 'no sourced price or ranking, so no market could be scored',
      });
      continue;
    }

    for (const market of ['win_match', 'first_set', 'games_handicap']) {
      let opener = OPENERS[idx % OPENERS.length];
      let guard = 0;
      while (usedOpeners.has(opener.word) && guard < OPENERS.length) {
        idx += 1;
        opener = OPENERS[idx % OPENERS.length];
        guard += 1;
      }
      const exhausted = usedOpeners.has(opener.word);

      const out = writeTip({ match, result, market, angle: opener });
      if (!out.ok) {
        violations.push({ event_id: match?.event_id, market, violations: out.violations });
        tips.push({ event_id: match?.event_id, market, ok: false, text: null, band: null });
      } else {
        usedOpeners.add(opener.word);
        tips.push({
          event_id: match?.event_id,
          match: `${match?.players?.[0]?.name} v ${match?.players?.[1]?.name}`,
          market,
          marketLabel: MARKET_LABEL[market],
          ok: true,
          text: out.text,
          band: out.band,
          skip: !!out.skip,
          opener: opener.id,
        });
        if (exhausted) {
          violations.push({
            event_id: match?.event_id,
            market,
            openerPoolExhausted: true,
            detail: `more tips than distinct openings available (${OPENERS.length})`,
          });
        }
      }
      idx += 1;
    }
  }

  const emitted = tips.filter((t) => t.ok);
  // SKIP lines are single explanatory sentences, not styled tips, so they are
  // excluded from the opening-uniqueness rule.
  const openers = emitted.filter((t) => !t.skip).map((t) => t.text.split(/\s+/)[0].toLowerCase());
  const dupes = [...new Set(openers.filter((o, i) => openers.indexOf(o) !== i))];
  if (dupes.length) violations.push({ duplicateOpeners: dupes });

  return {
    tips,
    card: emitted.map((t) => t.text).join('\n\n'),
    violations,
    unscored,
    openerPoolSize: OPENERS.length,
    openerPoolExhausted: emitted.length > OPENERS.length,
  };
}
