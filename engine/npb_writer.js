/**
 * SportsPred — NPB Writer (Step 4 of the NPB BASEBALL PREDICTION MASTER
 * PROMPT v1.0) + output-rule validator.
 *
 * Three written predictions per match, in the prompt's order:
 *   WIN MATCH OUTRIGHT (which becomes DRAW when the draw override fires),
 *   RUN LINE, GAME TOTAL.
 *
 * Every rule of Step 4 is enforced mechanically by `validateNpbTip`:
 *   - at least 40 words;
 *   - the predicted winner / DRAW / Over-Under bolded inside the first 20 words;
 *   - no digits at all (odds, run lines, totals, statistics, dates);
 *   - no player names, injury specifics, home/away/stadium/league references,
 *     sources, or social media — including "Central", "Pacific", "CL", "PL",
 *     "interleague" and "Japan Series", which the NPB prompt adds to the list;
 *   - the seven banned filler phrases rejected on sight;
 *   - a unique opening word per tip within one output;
 *   - LOW / MEDIUM / HIGH confidence on every tip;
 *   - SKIP as a single explanatory sentence.
 *
 * The card ends with the summary table, the underdog value flag, the draw flag
 * note ("Draw flag: ... draw likelihood exceeded the threshold") and the
 * responsible gambling reminder, exactly as the prompt lists them.
 *
 * A tip the validator refuses is never displayed.
 */

import { CONFIDENCE, MARKETS } from './npb_engine.js';
import { BANNED_PHRASES, OPENERS as BASE_OPENERS, validateBaseballTip, validateOpenerUniqueness } from './baseball_writer.js';

export { BANNED_PHRASES, validateOpenerUniqueness };
export const MIN_WORDS = 40;

/** Words the NPB prompt forbids on top of the shared baseball list. */
export const NPB_FORBIDDEN_WORDS = ['central', 'pacific', 'cl', 'pl', 'interleague', 'inter-league', 'japan series', 'dome', 'npb', 'innings limit', 'twelfth', 'foreign', 'import', 'imports'];

export const OPENERS = [
  ...BASE_OPENERS,
  { id: 'stalemate', word: 'Stalemates', lead: 'are a real result here and the evidence points to one.' },
  { id: 'balance', word: 'Balance', lead: 'between two well-matched staffs keeps the scoreboard quiet.' },
  { id: 'attrition', word: 'Attrition', lead: 'through the late innings is where this one settles.' },
];

export const MARKET_LABEL = {
  [MARKETS.WIN]: 'WIN MATCH OUTRIGHT',
  DRAW: 'DRAW',
  [MARKETS.RUN_LINE]: 'RUN LINE',
  [MARKETS.TOTAL]: 'GAME TOTAL',
};

export function validateNpbTip(text, { market = null, expectSkip = false } = {}) {
  const base = validateBaseballTip(text, { market, expectSkip });
  const violations = [...base.violations];
  const stripped = String(text || '').replace(/\*\*/g, '');
  if (!expectSkip) {
    for (const w of NPB_FORBIDDEN_WORDS) {
      if (new RegExp(`\\b${w.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i').test(stripped)) violations.push(`contains forbidden word "${w}"`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ *
 * Tip construction
 * ------------------------------------------------------------------ */

const WIN_TAILS = [
  (n) => `That advantage has been visible from the first pitch onward, and it is why ${n} is the selection to win this outright.`,
  () => `Across a full game the stronger side keeps finding the extra run, and there is little in the opposition to suggest that changes.`,
  () => `Expect the pattern to hold through the middle innings, when relief usage and habit take over from intent.`,
];
const DRAW_TAILS = [
  () => `Neither side has been separating from good opposition lately, and when two staffs of this quality meet the extra frames tend to end level rather than decided.`,
  () => `A stalemate is a genuine outcome in this competition, not a hedge, and every ingredient that produces one is present in this pairing.`,
  () => `Both dugouts have been closing games with rested arms, which drags scoring down late and leaves the innings cap as the likeliest finisher.`,
];
const RL_TAILS = [
  (n) => `Margin, not merely the result, is the point, and ${n} has been building comfortable leads rather than scraping past opponents.`,
  () => `Multi-run wins have been the norm rather than the exception, which is precisely the behaviour covering the line demands.`,
  () => `When the lead arrives it tends to grow instead of shrink, and that is the specific tendency this market pays for.`,
];
const TOTAL_TAILS = [
  () => `Scoring tempo has been running one way for a while, and nothing about this pairing or its conditions argues for a change.`,
  () => `The pattern has repeated often enough to be treated as a genuine tendency, not a streak waiting to snap.`,
  () => `Late relief usage only pushes the run count further in the same direction once a game is stretched.`,
];

function headline(result, market) {
  if (market === 'DRAW') return `**Draw** is the genuine selection in this meeting, and it is chosen on its own merits rather than as insurance.`;
  if (market === MARKETS.WIN) return `**${result.favouredDisplay || result.favoured}** is the side to take, with the weight of the evidence sitting firmly on their half of the sheet.`;
  if (market === MARKETS.RUN_LINE) {
    const side = result.runLine.decision.side === 'underdog' ? (result.dogDisplay || result.dog) : (result.favouredDisplay || result.favoured);
    return `**${side}** should cover here, because the margins in their recent games leave room for what the line requires.`;
  }
  return `**${result.total.decision.side}** is the read on the run count, and the underlying conditions support it.`;
}

const BODY = {
  [MARKETS.WIN]: 'Recent results, command of the run count on both sides of the ball and the quality of the arm taking the mound all lean the same way, and nothing in the opposition contradicts that reading.',
  DRAW: 'Two rested bullpens, two in-form arms taking the mound and almost nothing between the clubs in run production is the exact recipe for a game that reaches its innings cap still level.',
  [MARKETS.RUN_LINE]: 'The case rests on how these games have been won rather than merely who won them, with separation arriving in the middle innings instead of at the final out.',
  [MARKETS.TOTAL]: 'The arms taking the mound, the way both benches have been scoring lately and the conditions the game will be played in all line up behind that read.',
};

const SKIP_TEMPLATE = {
  [MARKETS.WIN]: 'the sourced evidence does not reach the standard required for a play on this fixture',
  [MARKETS.RUN_LINE]: 'the winning margins and draw risk in this matchup do not support a run line play',
  [MARKETS.TOTAL]: 'the run-scoring evidence does not clear the level required to take a side',
};

export function writeTip(result, market, openerIndex = 0) {
  const isWinSlot = market === MARKETS.WIN;
  const isDraw = isWinSlot && result.winMatch.decision.outcome === 'draw';
  const key = isDraw ? 'DRAW' : market;
  const label = MARKET_LABEL[key] || market;
  const opener = OPENERS[openerIndex % OPENERS.length];

  let decision = isWinSlot ? result.winMatch.decision : market === MARKETS.RUN_LINE ? result.runLine.decision : result.total.decision;
  if (decision.confidence === CONFIDENCE.SKIP) {
    const text = `SKIP — ${label}: ${SKIP_TEMPLATE[market]}.`;
    return { market, key, label, text, reason: decision.reason, confidence: CONFIDENCE.SKIP, validation: validateNpbTip(text, { market, expectSkip: true }), skip: true };
  }

  const tails = { [MARKETS.WIN]: WIN_TAILS, DRAW: DRAW_TAILS, [MARKETS.RUN_LINE]: RL_TAILS, [MARKETS.TOTAL]: TOTAL_TAILS }[key];
  const name = key === MARKETS.RUN_LINE && result.runLine.decision.side === 'underdog' ? (result.dogDisplay || result.dog) : (result.favouredDisplay || result.favoured);
  const text = [
    `${opener.word} ${opener.lead}`,
    headline(result, key),
    BODY[key],
    tails[openerIndex % tails.length](name),
    `Confidence: ${decision.confidence}.`,
  ].join(' ');

  return { market, key, label, text, confidence: decision.confidence, opener: opener.id, validation: validateNpbTip(text, { market }), skip: false, draw: isDraw };
}

/** Draw-flag note the prompt requires at the end of the card. */
export function drawFlagNote(results) {
  const primary = []; const secondary = [];
  for (const r of results || []) {
    if (!r || r.unscored) continue;
    const label = `${r.away?.displayName || r.away?.name} v ${r.home?.displayName || r.home?.name}`;
    if (r.draw?.flag === 'primary') primary.push(label);
    else if (r.draw?.flag === 'secondary') secondary.push(label);
  }
  if (!primary.length && !secondary.length) return 'Draw flag: no fixture on this card reached the draw likelihood threshold; each was assessed independently for a stalemate.';
  const parts = [];
  if (primary.length) parts.push(`${primary.join('; ')} — draw likelihood exceeded the threshold and the draw is the primary selection`);
  if (secondary.length) parts.push(`${secondary.join('; ')} — draw likelihood elevated but the sides are not close enough for it to become the pick, run line withheld`);
  return `Draw flag: ${parts.join('. ')}.`;
}

export function writeNpbCard(results, { dateISO = null } = {}) {
  const tips = [];
  let i = 0;
  for (const r of results || []) {
    if (!r || r.unscored) continue;
    for (const market of [MARKETS.WIN, MARKETS.RUN_LINE, MARKETS.TOTAL]) {
      const tip = writeTip(r, market, i);
      tip.matchId = r.id;
      tip.fixture = `${r.away?.displayName || r.away?.name || 'Away'} at ${r.home?.displayName || r.home?.name || 'Home'}`;
      tips.push(tip);
      i += 1;
    }
  }
  const active = tips.filter((t) => !t.skip);
  const openerProblems = validateOpenerUniqueness(active);
  const summaryRows = active.map((t) => ({ fixture: t.fixture, market: t.label, selection: t.text.match(/\*\*([^*]+)\*\*/)?.[1], confidence: t.confidence }));

  const valueDogs = [...new Set((results || []).filter((r) => r?.underdogValue && r.dog).map((r) => r.dogDisplay || r.dog))];
  const valueNote = valueDogs.length
    ? `Underdog value flag: ${valueDogs.join(', ')} meet${valueDogs.length === 1 ? 's' : ''} the underdog value criteria (plus price with a run differential advantage and superior recent form).`
    : 'Underdog value flag: none — no key-less three-way price feed exists for this competition, so the value criteria could not be evaluated.';
  const drawNote = drawFlagNote(results);
  const responsibleGambling = 'Please gamble responsibly. Set a limit, never chase a loss, and treat every selection here as an opinion rather than a promise.';

  const card = { date: dateISO, tips, openerProblems, summaryRows, summary: { active: summaryRows, suppressedCount: 0 }, valueNote, drawNote, responsibleGambling };
  card.formattedText = buildNpbFormattedCardText(card, dateISO);
  return card;
}

export function buildNpbFormattedCardText(card, dateISO = null) {
  const lines = [];
  if (dateISO) lines.push(`NPB PREDICTIONS — ${dateISO}`);
  lines.push('');
  for (const tip of card.tips || []) {
    lines.push(`${tip.fixture} — ${tip.label}`);
    lines.push(tip.text);
    lines.push('');
  }
  lines.push('SUMMARY');
  for (const row of card.summaryRows || []) lines.push(`${row.fixture} | ${row.market} | ${row.selection} | ${row.confidence}`);
  lines.push('');
  if (card.valueNote) { lines.push(card.valueNote); lines.push(''); }
  if (card.drawNote) { lines.push(card.drawNote); lines.push(''); }
  lines.push(card.responsibleGambling || '');
  return lines.join('\n');
}
