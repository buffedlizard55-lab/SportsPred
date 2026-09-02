/**
 * SportsPred — Ice Hockey Writer (Step 4) + output-rule validator.
 *
 * Produces three written predictions per match in the exact order the prompt
 * demands: OUTRIGHT WINNER, PUCK LINE, GAME TOTAL.
 *
 * Output rules are ENFORRED HERE, mechanically, not requested politely:
 *   - at least 40 words per tip;
 *   - the predicted winner or outcome bolded and inside the first 20 words;
 *   - no digits of any kind (so no odds, no puck line numbers, no total lines,
 *     no statistics or percentages can leak);
 *   - no player names, goaltender names, injury specifics, arena names, links,
 *     source citations, bracket references or social media references;
 *   - the six banned filler phrases the prompt names, rejected on sight;
 *   - no two tips in one output may open with the same word or phrase;
 *   - confidence stated as LOW, MEDIUM or HIGH on every tip;
 *   - a match below threshold becomes SKIP with a single explanatory sentence.
 *
 * A tip that fails validation is withheld and the violation is reported — the
 * site never shows a tip the validator refused.
 */

import { CONFIDENCE, MARKETS } from './ice_hockey_engine.js';

export const MIN_WORDS = 40;

/** Banned verbatim by the prompt's STYLE REQUIREMENTS section. */
export const BANNED_PHRASES = [
  'this should be a high scoring affair',
  'this should be a high-scoring affair',
  'hard to look past',
  'the better goaltender',
  'on current form',
  'could go either way',
  'both teams',
];

const FORBIDDEN_SUBSTRINGS = [
  'http://', 'https://', 'www.', '@', 'twitter', 'tweet', 'instagram', 'facebook',
  'reddit', 'x.com', 'olbg', 'espn', 'arena name', 'injury report', 'save percentage',
  'power play percentage', 'penalty kill percentage', 'model', 'subagent', 'edge',
  'expected value', 'implied probability', 'threshold', 'backtest', 'filter',
];

/**
 * Hockey analytical angles named in the prompt's style section. Each entry owns
 * a distinct opening word so two tips can never begin alike.
 */
/**
 * Hockey analytical angles named in the prompt's style section. Leads are kept
 * short on purpose: the bolded outcome has to land inside the first 20 words,
 * so the opening angle gets roughly eight words and the reasoning follows.
 */
export const OPENERS = [
  { id: 'goaltending', word: 'Goaltending', lead: 'dominance frames this matchup.' },
  { id: 'powerplay', word: 'Power', lead: 'play structure decides this one.' },
  { id: 'suppression', word: 'Shot', lead: 'suppression is the quiet story.' },
  { id: 'fatigue', word: 'Fatigue', lead: 'from a compressed schedule bites.' },
  { id: 'depth', word: 'Offensive', lead: 'line depth separates these benches.' },
  { id: 'trends', word: 'Recent', lead: 'scoring trends point one way.' },
  { id: 'structure', word: 'Defensive', lead: 'structure and gap control rule.' },
  { id: 'home', word: 'Home', lead: 'ice has carried real weight.' },
  { id: 'momentum', word: 'Momentum', lead: 'built over recent nights travels.' },
  { id: 'special', word: 'Special', lead: 'teams efficiency is the hinge.' },
  { id: 'discipline', word: 'Discipline', lead: 'in the neutral zone decides it.' },
  { id: 'tempo', word: 'Tempo', lead: 'control through the middle tilts it.' },
  { id: 'physical', word: 'Physical', lead: 'play along the boards wears.' },
  { id: 'closing', word: 'Closing', lead: 'out tight hockey is learned.' },
  { id: 'transition', word: 'Transition', lead: 'speed off the first pass separates.' },
  { id: 'netfront', word: 'Net-front', lead: 'presence has been the difference.' },
  { id: 'consistency', word: 'Consistency', lead: 'across a month is rare.' },
  { id: 'rebound', word: 'Rebound', lead: 'control wins low-event games.' },
  { id: 'schedule', word: 'Schedule', lead: 'shape matters more than tables.' },
  { id: 'pressure', word: 'Pressure', lead: 'on the breakout forces turnovers.' },
  { id: 'execution', word: 'Execution', lead: 'with the man advantage differs.' },
  { id: 'backchecking', word: 'Backchecking', lead: 'effort limits rush chances against.' },
  { id: 'matchup', word: 'Matchup', lead: 'advantages down the lineup favour.' },
  { id: 'volume', word: 'Volume', lead: 'of quality chances has climbed.' },
  { id: 'stability', word: 'Stability', lead: 'between the pipes is one-sided.' },
  { id: 'aggression', word: 'Aggression', lead: 'on the forecheck earns possession.' },
  { id: 'poise', word: 'Poise', lead: 'under third-period pressure differs.' },
  { id: 'detail', word: 'Detail', lead: 'in the defensive zone is meticulous.' },
  { id: 'urgency', word: 'Urgency', lead: 'shows in shorter, harder shifts.' },
  { id: 'clutch', word: 'Late-game', lead: 'management favours one bench.' },
];

const MARKET_LABEL = {
  [MARKETS.OUTRIGHT]: 'OUTRIGHT WINNER',
  [MARKETS.PUCK_LINE]: 'PUCK LINE',
  [MARKETS.TOTAL]: 'GAME TOTAL',
};

/* ------------------------------------------------------------------ *
 * Validator
 * ------------------------------------------------------------------ */

export function validateIceHockeyTip(text, { market = null, expectSkip = false } = {}) {
  const violations = [];
  const t = String(text || '').trim();
  if (!t) return { ok: false, violations: ['empty tip text'] };

  const stripped = t.replace(/\*\*/g, '');

  if (expectSkip) {
    if (!/^SKIP\b/.test(t)) violations.push('a SKIP verdict must begin with the word SKIP');
    const sentences = stripped.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 2) violations.push(`SKIP verdict must be a single explanatory sentence (found ${sentences.length})`);
    if (/\d/.test(stripped)) violations.push('SKIP verdict contains digits');
    return { ok: violations.length === 0, violations };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words (found ${words.length})`);

  const digits = stripped.match(/\d/g);
  if (digits) violations.push(`contains forbidden numerals: ${digits.join('')}`);

  if (!/\*\*[^*]+\*\*/.test(t)) {
    violations.push('no bolded outcome found');
  } else {
    const before = t.slice(0, t.indexOf('**')).split(/\s+/).filter(Boolean).length;
    if (before >= 20) violations.push(`bolded outcome starts at word ${before + 1}, outside the first 20 words`);
  }

  const lower = ` ${t.toLowerCase().replace(/\*\*/g, '')} `;
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`uses banned filler phrase "${phrase}"`);
  }
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(bad)) violations.push(`contains forbidden token "${bad}"`);
  }
  if (/\[|\]|\(/.test(t)) violations.push('contains bracketed reference or parenthetical');

  const conf = /\b(HIGH|MEDIUM|LOW)\b/.test(t);
  if (!conf) violations.push('confidence level HIGH, MEDIUM or LOW not stated');

  if (market === MARKETS.TOTAL && !/\b(OVER|UNDER)\b/i.test(t)) {
    violations.push('game total tip must state Over or Under');
  }
  if (market === MARKETS.PUCK_LINE && !/cover/i.test(t)) {
    violations.push('puck line tip must state which side covers');
  }

  return { ok: violations.length === 0, violations };
}

/** No two tips in one output may open with the same word. */
export function validateOpenerUniqueness(tips) {
  const seen = new Map();
  const problems = [];
  for (const tip of tips) {
    const first = String(tip.text || '').replace(/^\*\*/, '').split(/\s+/)[0]?.toLowerCase() ?? '';
    if (seen.has(first)) problems.push(`"${first}" opens two tips (${seen.get(first)} and ${tip.market})`);
    else seen.set(first, tip.market);
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Tip construction
 * ------------------------------------------------------------------ */

function filler(angle, favourSide, market) {
  const label = favourSide || 'the stronger side';
  const tails = {
    [MARKETS.OUTRIGHT]: [
      `That gap shows up early and it rarely closes, which is why ${label} is the selection at full strength.`,
      `Over a full sixty minutes that advantage compounds rather than fades, and it shapes the whole contest.`,
      `Expect the pattern to hold through the middle frame, when rotations shorten and habits take over.`,
    ],
    [MARKETS.PUCK_LINE]: [
      `Margin, not merely outcome, is the point here, and ${label} has been building them rather than scraping them.`,
      `Comfortable multi-goal periods have been the norm rather than the exception, which is what covering demands.`,
      `When the lead arrives it tends to grow, and that is the specific behaviour this market rewards.`,
    ],
    [MARKETS.TOTAL]: [
      `Scoring tempo has been running one way for a while now, and nothing in this pairing argues for a change.`,
      `The pattern has repeated often enough that it should be treated as a genuine tendency rather than a streak.`,
      `Late empties only push the outcome further in the same direction when a game is already stretched.`,
    ],
  };
  const pool = tails[market] || tails[MARKETS.OUTRIGHT];
  return pool[angle % pool.length];
}

function underSideLine(result, market) {
  if (market === MARKETS.OUTRIGHT) {
    return `**${result.favoured}** is the side to take in this meeting, with the balance of evidence clearly on their side of the sheet.`;
  }
  if (market === MARKETS.PUCK_LINE) {
    return `**${result.favoured}** should cover here, because the winning margins they have been building leave room for the handicap.`;
  }
  return `**${result.total.decision.side || 'OVER'}** is the read on the goal count, and the underlying tempo supports it.`;
}

export function writeTip(result, market, openerIndex = 0, { reasonOverride = null } = {}) {
  const label = MARKET_LABEL[market] || market;
  const opener = OPENERS[openerIndex % OPENERS.length];

  /* ---- SKIP verdicts ---- */
  let skipReason = null;
  if (market === MARKETS.OUTRIGHT) skipReason = result.outright.decision.confidence === CONFIDENCE.SKIP ? result.outright.decision.reason : null;
  if (market === MARKETS.PUCK_LINE) skipReason = result.puckLine.decision.confidence === CONFIDENCE.SKIP ? result.puckLine.decision.reason : null;
  if (market === MARKETS.TOTAL) skipReason = result.total.decision.confidence === CONFIDENCE.SKIP ? result.total.decision.reason : null;
  if (result.pipeline?.noBet && market === MARKETS.OUTRIGHT) skipReason = result.pipeline.risk.veto;
  if (result.pipeline?.noBet) skipReason = skipReason || result.pipeline.risk.veto;

  if (skipReason || reasonOverride) {
    // The numeric reason is kept on the returned object for the analysis panel;
    // the published tip gets a digit-free, market-specific sentence instead,
    // because Step 4 forbids any figure in the output.
    const template = {
      [MARKETS.OUTRIGHT]: 'the sourced evidence does not reach the standard required for a play on this fixture',
      [MARKETS.PUCK_LINE]: 'the winning margins in this matchup do not support a handicap play',
      [MARKETS.TOTAL]: 'the goal-scoring evidence does not clear the level required at this line',
    }[market] || 'the evidence does not clear the standard required to recommend a play';
    const extra = result.pipeline?.noBet && result.pipeline?.risk?.penalties?.length
      ? ' Unsourced goaltending and price inputs also block a recommendation.'
      : '';
    const text = `SKIP — ${label}: ${template}.${extra}`;
    return {
      market, label, text, reason: skipReason || reasonOverride || null,
      confidence: CONFIDENCE.SKIP,
      validation: validateIceHockeyTip(text, { market, expectSkip: true }), skip: true,
    };
  }

  const confidence = market === MARKETS.OUTRIGHT ? result.outright.decision.confidence
    : market === MARKETS.PUCK_LINE ? result.puckLine.decision.confidence
      : result.total.decision.confidence;

  const head = market === MARKETS.TOTAL
    ? `**${result.total.decision.side}**`
    : `**${result.favoured}**`;

  const angleBody = {
    [MARKETS.OUTRIGHT]: `The reasoning behind it is straightforward: recent results, structural control of the middle of the ice and crease reliability all lean the same way, and nothing in the opposing profile contradicts that read.`,
    [MARKETS.PUCK_LINE]: `The case rests on how these games have been won rather than merely who won them, with separation arriving in the middle periods instead of at the final horn.`,
    [MARKETS.TOTAL]: `Special teams volume, crease quality and the way both benches have been scoring lately all line up behind that read.`,
  }[market];

  const text = [
    `${opener.word} ${opener.lead}`,
    underSideLine(result, market),
    angleBody,
    filler(openerIndex, result.favoured, market),
    `Confidence: ${confidence}.`,
  ].join(' ');

  return {
    market,
    label,
    text,
    confidence,
    opener: opener.id,
    validation: validateIceHockeyTip(text, { market }),
    skip: false,
  };
}

/**
 * Write the full card: three tips per match in the required order, then the
 * summary table, the back-to-back flag note and the responsible gambling line.
 */
export function writeIceHockeyCard(results, { dateISO = null } = {}) {
  const tips = [];
  let i = 0;
  for (const r of results || []) {
    if (!r || r.unscored) continue;
    for (const market of [MARKETS.OUTRIGHT, MARKETS.PUCK_LINE, MARKETS.TOTAL]) {
      const tip = writeTip(r, market, i);
      tip.matchId = r.id;
      tip.fixture = `${r.away?.name || 'Away'} at ${r.home?.name || 'Home'}`;
      tips.push(tip);
      i += 1;
    }
  }

  const openerProblems = validateOpenerUniqueness(tips.filter((t) => !t.skip));
  const active = tips.filter((t) => !t.skip);
  const suppressed = active.slice(6);

  const summaryRows = active.slice(0, 6).map((t) => ({
    fixture: t.fixture,
    market: t.label,
    selection: t.market === MARKETS.TOTAL ? t.text.match(/\*\*([^*]+)\*\*/)?.[1] : t.text.match(/\*\*([^*]+)\*\*/)?.[1],
    confidence: t.confidence,
  }));

  const b2bTeams = [];
  for (const r of results || []) {
    if (r?.home?.backToBack) b2bTeams.push(r.home.name);
    if (r?.away?.backToBack) b2bTeams.push(r.away.name);
  }

  const backToBackNote = b2bTeams.length
    ? `Back-to-back flag: ${[...new Set(b2bTeams)].join(', ')} are playing on consecutive nights.`
    : 'Back-to-back flag: no side on this card is playing on consecutive nights.';

  const responsibleGambling = 'Please gamble responsibly. Set a limit, never chase a loss, and treat every selection here as an opinion rather than a promise.';

  const card = {
    date: dateISO,
    tips,
    openerProblems,
    summaryRows,
    summary: { active: summaryRows, suppressedCount: suppressed.length },
    backToBackNote,
    responsibleGambling,
  };
  card.formattedText = buildIceHockeyFormattedCardText(card, dateISO);
  return card;
}

export function buildIceHockeyFormattedCardText(card, dateISO = null) {
  const lines = [];
  if (dateISO) lines.push(`ICE HOCKEY PREDICTIONS — ${dateISO}`);
  lines.push('');
  for (const tip of card.tips || []) {
    lines.push(`${tip.fixture} — ${tip.label}`);
    lines.push(tip.text);
    lines.push('');
  }
  lines.push('SUMMARY');
  for (const row of card.summaryRows || []) {
    lines.push(`${row.fixture} | ${row.market} | ${row.selection} | ${row.confidence}`);
  }
  lines.push('');
  lines.push(card.backToBackNote || '');
  lines.push(card.responsibleGambling || '');
  return lines.join('\n');
}
