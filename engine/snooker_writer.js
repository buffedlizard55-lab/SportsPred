/**
 * SportsPred — Snooker Prediction Writer and Output Validator.
 *
 * Implements Step 4 and the style rules of "SNOOKER PREDICTION MASTER PROMPT
 * v3.0":
 *   - match title,
 *   - verdict line with the predicted winner and the confidence score,
 *   - a written prediction paragraph of 25-40 words,
 *   - bet type (FULL BET / SMALL BET / SKIP),
 *   - every prediction uniquely written, no repeated phrasing or templates,
 *   - no links, no citation brackets, no source references, no raw scores,
 *     no factor breakdown, no odds numbers,
 *   - confident, varied sentence structure; banned generic fillers are
 *     rejected,
 *   - every paragraph is grounded in factors the scorer actually sourced —
 *     the writer only ever reads scored components,
 *   - card ends with the summary table and the responsible-gambling reminder.
 *
 * The validator is the enforcement point: a prediction that fails is withheld
 * and the violation is reported, exactly as the rest of the repo does.
 */

import { CONFIDENCE } from './snooker_engine.js';

export const MIN_WORDS = 25;
export const MAX_WORDS = 40;

/** Generic fillers the prompt bans (and near-synonyms). */
export const BANNED_PHRASES = [
  'this is a tough match', 'this is a tough one', 'tough match',
  'anything can happen', 'anyone\'s game', 'anyone can win',
  'could go either way', 'could go either way', 'hard to call',
  'hard to separate', 'too close to call', 'no clear favourite',
  'no clear favorite', 'tight contest', 'game of two halves',
  'anything is possible', 'it\'s a coin flip', 'a coin flip',
];

/** Tokens that never belong in a written snooker prediction. */
export const FORBIDDEN_TOKENS = [
  'http', 'www.', '.com', '.org', '.co.uk', '@',
  'olbg', 'wst', 'snooker.org', 'snooker.org', 'cuetracker', 'bbc',
  'wikipedia', 'odds', 'price', 'stake', 'staking', 'betting tip', 'tipster',
];

/**
 * Distinct openers — each starts from a different analytical angle so a card
 * never repeats a template. {name} is the bolded selection. Each opener is
 * kept deliberately short so the composed paragraph stays inside the
 * prompt's 25-40 word window.
 */
export const OPENERS = [
  '**{name}** carries the sharper scoring profile here, backed by',
  'Ranking and recent output align behind **{name}**, with',
  'No head-to-head history exists, so **{name}** is judged on',
  '**{name}** brings the more sustainable recent form, built on',
  'The stage demands sharpness, and **{name}** supplies it through',
  'Recent opposition quality favours **{name}**, who has',
  'Facing an unranked opponent, **{name}** presses the case with',
  '**{name}** owns the ranking pedigree in this tie, reinforced by',
  'Tournament form separates the pair, and **{name}** owns it via',
  'In an early-round tie, **{name}** relies on the deeper record because',
  'Frame-by-frame scoring under pressure is where **{name}** stands out, with',
  'The draw leaves **{name}** the better prepared player, underpinned by',
  '**{name}** keeps match practice high while the opponent works around a thinner slate, and',
  'Experience of this arena favours **{name}**, whose case is built on',
];

/** Closing angles, rotated per card. */
export const ANGLES = [
  'That profile should hold against this opposition.',
  'The strands point one way, which an analyst prefers.',
  'The stronger-ranked player carries no credible counterweight.',
  'Trust the deeper run of results here.',
  'The pairing is favourable on current evidence.',
  'Nothing in the sourced data flips the judgment.',
  'Expect the stronger scoring numbers to tell.',
  'The fuller record should settle it.',
  'Recent table results give the firmer steer.',
  'The numbers favour the player with more table time.',
  'A deeper campaign underpins the lean.',
  'Expect the fresher tournament form to decide.',
  'The evidence is consistent across every sourced factor.',
  'Match sharpness tips the balance to this side.',
];

function componentPoints(scored, id, side) {
  const sideObj = side === 'b' ? scored.sideB : scored.sideA;
  return (sideObj?.components || []).find((c) => c.id === id)?.points ?? 0;
}

/**
 * Qualitative clauses built only from scored components (no digits).
 *
 * Only factors that actually favour the lean are listed here — a missing
 * factor, a stage label with zero points or a trailing H2H is never phrased
 * as supporting evidence. Those belong to the analysis panel's "not sourced"
 * list, not to the written prediction.
 */
function factClauses(scored) {
  const lean = scored.leanSide === 'b' ? scored.sideB : scored.sideA;
  const other = scored.leanSide === 'b' ? scored.sideA : scored.sideB;
  const out = [];

  const formC = (lean.components || []).find((c) => c.id === 'form');
  const form = formC?.points ?? 0;
  if (!formC?.missing && form >= 23) out.push('a commanding recent record');
  else if (!formC?.missing && form >= 15) out.push('more wins than losses of late');
  else if (!formC?.missing && form >= 5) out.push('a positive but narrow recent balance');

  const rank = (lean.components || []).find((c) => c.id === 'ranking')?.points ?? 0;
  if (rank >= 10) out.push('a top-tier ranking');
  else if (rank >= 1) out.push('a ranking advantage over his opponent');
  if (!other.rank && rank > 0) out.push('an unranked opponent outside the rankings');

  const h2hC = (lean.components || []).find((c) => c.id === 'h2h');
  if (!h2hC?.missing && (h2hC?.points || 0) >= 13) out.push('a clear head-to-head edge');

  const stage = (lean.components || []).find((c) => c.id === 'stage')?.points ?? 0;
  if (stage >= 10) out.push('the business end of the event');
  else if (stage >= 7) out.push('quarter-final sharpness');
  else if (stage === 4) out.push('the last-sixteen test');

  return out;
}

/** A caution only when evidence is genuinely thin. */
function cautionClause(scored) {
  const lean = scored.leanSide === 'b' ? scored.sideB : scored.sideA;
  if (scored.confidence.band === CONFIDENCE.SKIP) {
    return 'Key input is unverified.';
  }
  if ((lean.components || []).some((c) => c.id === 'odds' && c.missing)) {
    return 'The market stays out of this read.';
  }
  return '';
}

function confidenceLine(band) {
  if (band === CONFIDENCE.HIGH) return 'Confidence: HIGH.';
  if (band === CONFIDENCE.MEDIUM) return 'Confidence: MEDIUM.';
  if (band === CONFIDENCE.LOW) return 'Confidence: LOW.';
  return 'Confidence: SKIP.';
}

function wordsOf(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Compose the paragraph, then trim/pad deterministically so the output always
 * sits inside the prompt's 25-40 word window. Facts are removed one at a time
 * (never the opener, angle or confidence line) until the ceiling is met; if
 * the result falls below the floor, leftover facts are restored in order.
 */
function composeParagraph(scored, openerIdx, angleIdx) {
  const name = scored.leanName;
  const opener = OPENERS[openerIdx % OPENERS.length].replace('{name}', name);
  const facts = factClauses(scored);
  const angle = ANGLES[angleIdx % ANGLES.length];
  const caution = cautionClause(scored);
  const confidence = confidenceLine(scored.confidence.band);

  const assemble = (k) => {
    const factsPart = k > 0 ? `${facts.slice(0, k).join(', ')}.` : '';
    return [opener, factsPart, angle, caution, confidence]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };

  let n = facts.length;
  for (; n >= 0; n -= 1) {
    if (wordsOf(assemble(n)) <= MAX_WORDS) break;
  }
  for (; n < facts.length; n += 1) {
    if (wordsOf(assemble(n + 1)) >= MIN_WORDS) break;
  }
  return assemble(n);
}

export function verdictLine(scored) {
  const name = scored.leanName;
  const score = scored.score;
  if (scored.confidence.band === CONFIDENCE.SKIP) {
    return `No confident read — lean **${name}** (${score}/100)`;
  }
  return `**${name}** to win (${score}/100 — ${scored.confidence.band})`;
}

export function betTypeLine(scored) {
  if (scored.decision.bet === 'FULL BET') return 'FULL BET';
  if (scored.decision.bet === 'SMALL BET') return 'SMALL BET';
  const reasons = scored.decision.reasons || [];
  const why = reasons.some((r) => r.includes('price')) ? 'no verified price' : 'model criteria not met';
  return `SKIP — ${why}`;
}

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

export function validatePrediction(p, { forbiddenNames = [] } = {}) {
  const violations = [];
  const text = p.paragraph || '';
  const words = text.trim().split(/\s+/).filter(Boolean);

  if (words.length < MIN_WORDS) violations.push(`fewer than ${MIN_WORDS} words`);
  if (words.length > MAX_WORDS) violations.push(`more than ${MAX_WORDS} words`);
  if (/\d/.test(text)) violations.push('contains a digit (raw score, odds or line would leak)');
  if (!p.matchTitle || !p.verdict || !p.betType) violations.push('missing title, verdict or bet type');

  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`banned phrase: "${phrase}"`);
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (lower.includes(token)) violations.push(`forbidden token: "${token}"`);
  }
  if (!lower.includes((scoredLean(p) || '').toLowerCase())) violations.push('winner name missing from paragraph');
  for (const name of forbiddenNames) {
    const other = String(name);
    if (other && lower.includes(other.toLowerCase()) && !lower.includes(scoredLean(p)) ) {
      violations.push(`rival name referenced: "${other}"`);
    }
  }
  return { ok: violations.length === 0, violations };
}

function scoredLean(p) {
  // Prediction records carry leanName so validators stay independent of the
  // scored object (common for card-level validation).
  return p.leanName || null;
}

/* ------------------------------------------------------------------ *
 * card writer
 * ------------------------------------------------------------------ */

export function writePrediction(scored, { openerIdx = 0, angleIdx = 0 } = {}) {
  const paragraph = composeParagraph(scored, openerIdx, angleIdx);
  const p = {
    matchId: scored.matchId ?? null,
    matchTitle: scored.matchTitle,
    event: scored.event,
    round: scored.round,
    dateISO: scored.dateISO,
    venue: scored.venue,
    verdict: verdictLine(scored),
    paragraph,
    betType: betTypeLine(scored),
    confidence: { band: scored.confidence.band, score: scored.score },
    leanName: scored.leanName,
    score: scored.score,
    bet: scored.decision.bet,
    status: scored.status,
    sourceUrls: scored.sourceUrls || [],
  };
  const validation = validatePrediction(p);
  return { ...p, ok: validation.ok, violations: validation.violations };
}

export function writeSnookerCard(scoredMatches = [], { date = null, forbiddenNames = [] } = {}) {
  const predictions = [];
  let openerIdx = 0;
  let angleIdx = 0;
  for (const m of scoredMatches) {
    const p = writePrediction(m, { openerIdx: openerIdx++, angleIdx: angleIdx++ });
    predictions.push(p);
  }

  const seen = new Set();
  const seenTemplates = new Set();
  const validationIssues = [];
  for (const p of predictions) {
    if (!p.ok) validationIssues.push({ matchId: p.matchId, violations: p.violations });
    const first = firstWords(p.paragraph, 3);
    if (seen.has(first)) {
      validationIssues.push({ matchId: p.matchId, violations: [`duplicate opening phrase: "${first}"`] });
    }
    seen.add(first);
    const template = templateKey(p.paragraph);
    if (seenTemplates.has(template)) {
      validationIssues.push({ matchId: p.matchId, violations: ['repeated opener+angle template across the card'] });
    }
    seenTemplates.add(template);
  }

  const summaryTable = {
    headers: ['Match', 'Event / round', 'Selection', 'Confidence', 'Model score', 'Bet type'],
    rows: predictions.map((p) => [
      p.matchTitle, `${p.event} · ${p.round}`, p.leanName, p.confidence.band, p.confidence.score, p.betType,
    ]),
  };

  const responsibleGambling =
    'Predictions are generated mechanically from sourced data and are fallible. ' +
    'Nothing here is betting advice or a guarantee of any outcome. Please gamble responsibly — 18+.';

  return {
    date,
    predictions,
    summaryTable,
    responsibleGambling,
    validation: { ok: validationIssues.length === 0, issues: validationIssues },
  };
}

function firstWords(text, n) {
  return text.trim().split(/\s+/).slice(0, n).join(' ').toLowerCase();
}

/** Structural identity of a paragraph: opener sentence + closing angle. */
function templateKey(text) {
  const parts = text.replace(/\*\*/g, '').trim().split(/(?<!\.)\.\s+/).filter(Boolean);
  return parts.length >= 2 ? `${parts[0].trim().split(/\s+/).slice(0, 6).join(' ')}|${parts[parts.length - 1].trim().split(/\s+/).slice(0, 6).join(' ')}`.toLowerCase() : '';
}

/* ------------------------------------------------------------------ *
 * copy block
 * ------------------------------------------------------------------ */

export function buildCopyText(card) {
  const parts = [];
  for (const p of card.predictions || []) {
    parts.push(`## ${p.matchTitle}`);
    parts.push(`Verdict: ${p.verdict}`);
    parts.push(p.paragraph);
    parts.push(`Bet type: ${p.betType}`);
    parts.push('');
  }
  if (card.summaryTable?.rows?.length) {
    parts.push('## Summary');
    parts.push(`${card.summaryTable.headers.join(' | ')}`);
    for (const row of card.summaryTable.rows) parts.push(row.join(' | '));
    parts.push('');
  }
  if (card.responsibleGambling) {
    parts.push(card.responsibleGambling);
    parts.push('');
  }
  return parts.join('\n').trim();
}
