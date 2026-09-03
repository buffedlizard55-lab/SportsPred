/**
 * SportsPred — GAA Step 4 writer.
 * Minimum 40 words. No digits, links, sources, odds, venues, player names.
 * Unique openers across a card. Draw flagged when the engine set drawPossible.
 */

import { CONFIDENCE } from './gaa_engine.js';

export const MIN_WORDS = 40;
export const MAX_WORDS = 70;

export const BANNED_PHRASES = [
  'anything can happen on the day', 'it should be a close one', 'a real battle',
  'both teams will be looking to', 'this is a tough match', 'anything can happen',
  'could go either way', 'hard to call', 'too close to call',
];

export const FORBIDDEN_TOKENS = [
  'http', 'www.', '.com', '.org', '.ie', 'olbg', 'wikipedia', 'gaa.ie',
  'odds', 'price', 'stake', 'staking', 'tipster', 'rte', 'the42',
];

export const OPENERS = [
  '**{name}** holds the cleaner championship profile here, built from',
  'Recent championship output leans to **{name}**, grounded in',
  'Pedigree over the last cycle favours **{name}**, with',
  '**{name}** arrives with the firmer sourced record, because',
  'The knockout setting rewards the side with depth, and **{name}** supplies it through',
  'County form is thin on the tape, so **{name}** is judged on',
  '**{name}** carries the more coherent run of results, underpinned by',
  'Head-to-head history is scarce, which leaves **{name}** to be assessed via',
  'Stage weighting points at **{name}**, reinforced by',
  '**{name}** owns the ranking substitution on this card, thanks to',
  'Provincial championships still matter here, and **{name}** benefits from',
  'A conservative read still lands on **{name}**, given',
  '**{name}** is the lean after every missing input is discounted, due to',
  'The sourced tape is short, yet **{name}** remains the side with',
  'Hurling pedigree is applied only where named, and **{name}** qualifies through',
  'Football championship evidence, such as it is, backs **{name}** via',
];

export const ANGLES = [
  'That reading should hold against this opposition.',
  'The strands that can be sourced all point one way.',
  'Nothing verified on the tape reverses the judgment.',
  'Trust the deeper championship run where it exists.',
  'The pairing is favourable on current evidence.',
  'Expect the stronger championship numbers to tell.',
  'A fuller inter-county record still settles close calls.',
  'Match sharpness from recent knockout days underpins the lean.',
  'The evidence that exists is consistent across factors.',
  'Discount the gaps and the remainder still favours this side.',
  'Club championships without a tape stay conservative by design.',
  'Draws remain live whenever form and meetings sit even.',
  'Home provincial weight is used only when the venue is confirmed.',
  'A missing market figure keeps the live bet call off the card.',
];

function factClauses(scored) {
  const lean = scored.leanSide === 'b' ? scored.sideB : scored.sideA;
  const out = [];
  const formC = (lean.components || []).find((c) => c.id === 'form');
  const form = formC?.points ?? 0;
  if (!formC?.missing && form >= 20) out.push('a commanding recent championship record');
  else if (!formC?.missing && form >= 10) out.push('more wins than losses of late');
  else if (!formC?.missing) out.push('a modest recent balance');

  const rank = (lean.components || []).find((c) => c.id === 'ranking')?.points ?? 0;
  if (rank >= 12) out.push('a top-tier championship pedigree');
  else if (rank >= 4) out.push('a ranking edge over the opposition');

  const h2hC = (lean.components || []).find((c) => c.id === 'h2h');
  if (!h2hC?.missing && (h2hC?.points || 0) >= 13) out.push('a clear head-to-head lead');
  else if (h2hC?.missing) out.push('no recent meetings on the sourced tape');

  const stage = (lean.components || []).find((c) => c.id === 'stage')?.points ?? 0;
  if (stage >= 10) out.push('the business end of the championship');
  else if (stage >= 7) out.push('knockout sharpness');
  return out;
}

function cautionClause(scored) {
  if (scored.drawPossible) return 'A draw is a genuine outcome in this pairing.';
  if (scored.dataGap) return 'Public data is thin, so the call stays cautious.';
  if ((scored.sideA.components || []).some((c) => c.id === 'odds' && c.missing)) {
    return 'The market is left out of this read.';
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

function composeParagraph(scored, openerIdx, angleIdx) {
  const name = scored.leanName;
  const opener = OPENERS[openerIdx % OPENERS.length].replace('{name}', name);
  const facts = factClauses(scored);
  const angle = ANGLES[angleIdx % ANGLES.length];
  const caution = cautionClause(scored);
  const confidence = confidenceLine(scored.confidence.band);
  const extra = 'The sourced championship record is the only input behind this lean.';

  const assemble = (k, pad) => {
    const factsPart = k > 0 ? `${facts.slice(0, k).join(', ')}.` : '';
    return [opener, factsPart, angle, caution, pad ? extra : '', confidence]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };

  let n = facts.length;
  let text = assemble(n, false);
  if (wordsOf(text) > MAX_WORDS) {
    while (n > 0 && wordsOf(assemble(n, false)) > MAX_WORDS) n -= 1;
    text = assemble(n, false);
  }
  if (wordsOf(text) < MIN_WORDS) {
    const padded = assemble(n, true);
    if (wordsOf(padded) <= MAX_WORDS) text = padded;
  }
  if (wordsOf(text) < MIN_WORDS) {
    text = `${text} Analyst judgment stays inside the published tape and never fills a hole.`;
  }
  return text;
}

export function verdictLine(scored) {
  const name = scored.leanName;
  if (scored.confidence.band === CONFIDENCE.SKIP) {
    return `No confident read — lean **${name}**`;
  }
  return `**${name}** to win — ${scored.confidence.band}`;
}

export function betTypeLine(scored) {
  if (scored.decision.bet === 'FULL BET') return 'FULL BET';
  if (scored.decision.bet === 'SMALL BET') return 'SMALL BET';
  const reasons = scored.decision.reasons || [];
  const why = reasons.some((r) => r.includes('price')) ? 'no verified price' : 'model criteria not met';
  return `SKIP — ${why}`;
}

export function validatePrediction(p) {
  const violations = [];
  const text = p.paragraph || '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`fewer than ${MIN_WORDS} words`);
  if (words.length > MAX_WORDS) violations.push(`more than ${MAX_WORDS} words`);
  if (/\d/.test(text)) violations.push('contains a digit');
  if (!p.matchTitle || !p.verdict || !p.betType) violations.push('missing title, verdict or bet type');
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`banned phrase: "${phrase}"`);
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (lower.includes(token)) violations.push(`forbidden token: "${token}"`);
  }
  if (!lower.includes(String(p.leanName || '').toLowerCase())) violations.push('winner name missing from paragraph');
  return { ok: violations.length === 0, violations };
}

export function writePrediction(scored, { openerIdx = 0, angleIdx = 0 } = {}) {
  const paragraph = composeParagraph(scored, openerIdx, angleIdx);
  const p = {
    matchId: scored.matchId ?? null,
    matchTitle: scored.matchTitle,
    event: scored.event,
    round: scored.round,
    dateISO: scored.dateISO,
    venue: scored.venue,
    code: scored.code,
    verdict: verdictLine(scored),
    paragraph,
    betType: betTypeLine(scored),
    confidence: { band: scored.confidence.band, score: scored.score },
    leanName: scored.leanName,
    score: scored.score,
    bet: scored.decision.bet,
    drawPossible: !!scored.drawPossible,
    dataGap: !!scored.dataGap,
    status: scored.status,
    sourceUrls: scored.sourceUrls || [],
  };
  const validation = validatePrediction(p);
  if (p.dataGap) {
    p.dataGapNote = 'Note: limited publicly available data for this match — confidence adjusted accordingly';
  }
  return { ...p, ok: validation.ok, violations: validation.violations };
}

export function writeGaaCard(scoredMatches = [], { date = null } = {}) {
  const predictions = [];
  let openerIdx = 0;
  let angleIdx = 0;
  for (const m of scoredMatches) {
    predictions.push(writePrediction(m, { openerIdx: openerIdx++, angleIdx: angleIdx++ }));
  }
  const seen = new Set();
  const validationIssues = [];
  const checkUniques = predictions.length <= OPENERS.length;
  for (const p of predictions) {
    if (!p.ok) validationIssues.push({ matchId: p.matchId, violations: p.violations });
    if (!checkUniques) continue;
    const first = firstWords(p.paragraph, 3);
    if (seen.has(first)) {
      validationIssues.push({ matchId: p.matchId, violations: [`duplicate opening phrase: "${first}"`] });
    }
    seen.add(first);
  }
  const summaryTable = {
    headers: ['Match', 'Code / round', 'Selection', 'Confidence', 'Bet type'],
    rows: predictions.map((p) => [
      p.matchTitle, `${p.code || 'football'} · ${p.round || ''}`, p.leanName, p.confidence.band, p.betType,
    ]),
  };
  const responsibleGambling =
    'Predictions are generated mechanically from sourced data and are fallible. '
    + 'Nothing here is betting advice or a guarantee of any outcome. Please gamble responsibly — 18+.';
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

export function buildCopyText(card) {
  const parts = [];
  for (const p of card.predictions || []) {
    parts.push(`## ${p.matchTitle}`);
    parts.push(`Verdict: ${p.verdict}`);
    parts.push(p.paragraph);
    parts.push(`Bet type: ${p.betType}`);
    if (p.dataGapNote) parts.push(p.dataGapNote);
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
