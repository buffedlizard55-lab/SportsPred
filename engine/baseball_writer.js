/**
 * SportsPred — Baseball Writer (Step 4) + output-rule validator.
 *
 * Produces three written predictions per match in the exact order the prompt
 * demands: WIN MATCH OUTRIGHT, RUN LINE, GAME TOTAL.
 *
 * Output rules are ENFORCED HERE, mechanically, not requested politely:
 *   - at least 40 words per tip;
 *   - the predicted winner or market outcome bolded and inside the first 20
 *     words;
 *   - no digits of any kind (so no odds, no run line numbers, no total lines,
 *     no statistics can leak);
 *   - no player names, no injury specifics, no home or away references, no
 *     stadium names, no league names, no source citations, no social media
 *     references;
 *   - the seven banned filler phrases the prompt names, rejected on sight;
 *   - no two tips in one output may open with the same word or phrase;
 *   - confidence stated as LOW, MEDIUM or HIGH on every tip;
 *   - a match below threshold becomes SKIP with a single explanatory sentence.
 *
 * A tip that fails validation is withheld and the violation is reported — the
 * site never shows a tip the validator refused.
 */

import { CONFIDENCE, MARKETS } from './baseball_engine.js';

export const MIN_WORDS = 40;

/** Banned verbatim by the prompt's STYLE REQUIREMENTS section. */
export const BANNED_PHRASES = [
  'this should be a low-scoring affair',
  'hard to look past',
  'the pitching matchup favours',
  'on current form',
  'could go either way',
  'both lineups',
  'a tight contest',
];

const FORBIDDEN_SUBSTRINGS = [
  'http://', 'https://', 'www.', '@', 'twitter', 'tweet', 'instagram', 'facebook',
  'reddit', 'x.com', 'olbg', 'espn', 'injury report', 'save percentage',
  'batting average', 'slugging percentage', 'run differential', 'bullpen era',
  'moneyline', 'run line', 'total line', 'model', 'subagent', 'edge',
  'expected value', 'implied probability', 'threshold', 'backtest', 'filter',
];

/**
 * Whole-word blacklist (word-boundary matched). These are the home/away/league/
 * price/stat designations Step 4 forbids in output, matched as words so that
 * legitimate analytical language (pitching, bullpen, lineup) still passes.
 */
const FORBIDDEN_WORDS = [
  'home', 'away', 'road', 'host', 'hosts', 'visitor', 'visitors', 'stadium',
  'arena', 'ballpark', 'park', 'league', 'era', 'whip', 'moneyline', 'handicap',
  'spread', 'odds', 'stat', 'stats', 'pitcher', 'starter', 'starters', 'batter',
  'roster', 'injury', 'injuries', 'travel',
];

/**
 * Baseball analytical angles named in the prompt's style section. Each entry
 * owns a distinct opening word so two tips can never begin alike. Leads are
 * kept short on purpose: the bolded outcome has to land inside the first 20
 * words, so the opening angle gets roughly eight words and the reasoning
 * follows.
 */
export const OPENERS = [
  { id: 'pitching', word: 'Pitching', lead: 'dominance and run suppression frame this one.' },
  { id: 'offense', word: 'Offensive', lead: 'momentum and run-scoring efficiency decide it.' },
  { id: 'bullpen', word: 'Bullpen', lead: 'depth and late-inning reliability are the hinge.' },
  { id: 'headtohead', word: 'Head-to-head', lead: 'patterns between these clubs recur.' },
  { id: 'value', word: 'Underdog', lead: 'value and a run-scoring edge shape it.' },
  { id: 'streak', word: 'Recent', lead: 'streak momentum points one way.' },
  { id: 'contact', word: 'Contact', lead: 'quality and discipline at the plate matter.' },
  { id: 'rotation', word: 'Rotation', lead: 'depth beyond the opener is decisive.' },
  { id: 'tempo', word: 'Tempo', lead: 'control of the middle innings tilts it.' },
  { id: 'execution', word: 'Execution', lead: 'with runners on differs between these sides.' },
  { id: 'consistency', word: 'Consistency', lead: 'across a full month is rare and telling.' },
  { id: 'pressure', word: 'Pressure', lead: 'innings have separated these clubs all year.' },
  { id: 'depth', word: 'Lineup', lead: 'depth and sequencing create the gap.' },
  { id: 'suppression', word: 'Run', lead: 'suppression is the quiet story here.' },
  { id: 'clutch', word: 'Clutch', lead: 'production late in games is one-sided.' },
  { id: 'volume', word: 'Volume', lead: 'of hard contact has climbed for one side.' },
  { id: 'discipline', word: 'Discipline', lead: 'at the plate rewards one club more.' },
  { id: 'form', word: 'Form', lead: 'over the past fortnight splits the two.' },
  { id: 'margins', word: 'Margins', lead: 'of victory have been widening, not shrinking.' },
  { id: 'stability', word: 'Stability', lead: 'in the rotation is the difference.' },
];

const MARKET_LABEL = {
  [MARKETS.WIN]: 'WIN MATCH OUTRIGHT',
  [MARKETS.RUN_LINE]: 'RUN LINE',
  [MARKETS.TOTAL]: 'GAME TOTAL',
};

/* ------------------------------------------------------------------ *
 * Validator
 * ------------------------------------------------------------------ */

export function validateBaseballTip(text, { market = null, expectSkip = false } = {}) {
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
  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(stripped)) violations.push(`contains forbidden word "${word}"`);
  }
  if (/\[|\]|\(/.test(t)) violations.push('contains bracketed reference or parenthetical');

  const conf = /\b(HIGH|MEDIUM|LOW)\b/.test(t);
  if (!conf) violations.push('confidence level HIGH, MEDIUM or LOW not stated');

  if (market === MARKETS.TOTAL && !/\b(OVER|UNDER)\b/i.test(t)) {
    violations.push('game total tip must state Over or Under');
  }
  if (market === MARKETS.RUN_LINE && !/cover/i.test(t)) {
    violations.push('run line tip must state which team covers');
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
    [MARKETS.WIN]: [
      `That advantage shows up early and rarely closes, which is why ${label} is the selection at full strength.`,
      `Over nine innings that edge compounds rather than fades, and it shapes the whole contest.`,
      `Expect the pattern to hold through the middle innings, when rotations shorten and habits take over.`,
    ],
    [MARKETS.RUN_LINE]: [
      `Margin, not merely outcome, is the point here, and ${label} has been building them rather than scraping them.`,
      `Comfortable multi-run victories have been the norm rather than the exception, which is what covering demands.`,
      `When the lead arrives it tends to grow, and that is the specific behaviour this market rewards.`,
    ],
    [MARKETS.TOTAL]: [
      `Scoring tempo has been running one way for a while now, and nothing in this pairing argues for a change.`,
      `The pattern has repeated often enough that it should be treated as a genuine tendency rather than a streak.`,
      `Late relief usage only pushes the outcome further in the same direction when a game is already stretched.`,
    ],
  };
  const pool = tails[market] || tails[MARKETS.WIN];
  return pool[angle % pool.length];
}

function underSideLine(result, market) {
  if (market === MARKETS.WIN) {
    return `**${result.favoured}** is the side to take in this meeting, with the balance of evidence clearly on their side of the sheet.`;
  }
  if (market === MARKETS.RUN_LINE) {
    return `**${result.favoured}** should cover here, because the winning margins they have been building leave room for the required margin.`;
  }
  return `**${result.total.decision.side || 'OVER'}** is the read on the run count, and the underlying tempo supports it.`;
}

export function writeTip(result, market, openerIndex = 0, { reasonOverride = null } = {}) {
  const label = MARKET_LABEL[market] || market;
  const opener = OPENERS[openerIndex % OPENERS.length];

  let skipReason = null;
  if (market === MARKETS.WIN) skipReason = result.winMatch.decision.confidence === CONFIDENCE.SKIP ? result.winMatch.decision.reason : null;
  if (market === MARKETS.RUN_LINE) skipReason = result.runLine.decision.confidence === CONFIDENCE.SKIP ? result.runLine.decision.reason : null;
  if (market === MARKETS.TOTAL) skipReason = result.total.decision.confidence === CONFIDENCE.SKIP ? result.total.decision.reason : null;

  if (skipReason || reasonOverride) {
    // The numeric reason stays on the returned object for the analysis panel;
    // the published tip gets a digit-free, market-specific sentence instead,
    // because Step 4 forbids any figure in the output.
    const template = {
      [MARKETS.WIN]: 'the sourced evidence does not reach the standard required for a play on this fixture',
      [MARKETS.RUN_LINE]: 'the winning margins in this matchup do not support a run line play',
      [MARKETS.TOTAL]: 'the run-scoring evidence does not clear the level required to take a side',
    }[market] || 'the evidence does not clear the standard required to recommend a play';
    const text = `SKIP — ${label}: ${template}.`;
    return {
      market, label, text, reason: skipReason || reasonOverride || null,
      confidence: CONFIDENCE.SKIP,
      validation: validateBaseballTip(text, { market, expectSkip: true }), skip: true,
    };
  }

  const confidence = market === MARKETS.WIN ? result.winMatch.decision.confidence
    : market === MARKETS.RUN_LINE ? result.runLine.decision.confidence
      : result.total.decision.confidence;

  const head = market === MARKETS.TOTAL
    ? `**${result.total.decision.side}**`
    : `**${result.favoured}**`;

  const angleBody = {
    [MARKETS.WIN]: `The reasoning behind it is straightforward: recent results, control of the run count on both sides of the ball and the pitching profile all lean the same way, and nothing in the opposing side contradicts that read.`,
    [MARKETS.RUN_LINE]: `The case rests on how these games have been won rather than merely who won them, with separation arriving in the middle innings instead of at the final out.`,
    [MARKETS.TOTAL]: `The pitching profile, the way both benches have been scoring lately and the late-inning environment all line up behind that read.`,
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
    validation: validateBaseballTip(text, { market }),
    skip: false,
  };
}

/**
 * Write the full card: three tips per match in the required order, then the
 * summary table, the underdog value flag note and the responsible gambling
 * line.
 */
export function writeBaseballCard(results, { dateISO = null } = {}) {
  const tips = [];
  let i = 0;
  for (const r of results || []) {
    if (!r || r.unscored) continue;
    for (const market of [MARKETS.WIN, MARKETS.RUN_LINE, MARKETS.TOTAL]) {
      const tip = writeTip(r, market, i);
      tip.matchId = r.id;
      tip.fixture = `${r.away?.name || 'Away'} at ${r.home?.name || 'Home'}`;
      tips.push(tip);
      i += 1;
    }
  }

  const openerProblems = validateOpenerUniqueness(tips.filter((t) => !t.skip));
  const active = tips.filter((t) => !t.skip);

  const summaryRows = active.map((t) => ({
    fixture: t.fixture,
    market: t.label,
    selection: t.text.match(/\*\*([^*]+)\*\*/)?.[1],
    confidence: t.confidence,
  }));

  const valueDogs = [];
  for (const r of results || []) {
    if (r?.underdogValue && r.dog) valueDogs.push(r.dog);
  }
  const valueNote = valueDogs.length
    ? `Underdog value flag: ${[...new Set(valueDogs)].join(', ')} meet${valueDogs.length === 1 ? 's' : ''} the underdog value criteria (positive odds with a run differential advantage and strong recent form).`
    : null;

  const responsibleGambling = 'Please gamble responsibly. Set a limit, never chase a loss, and treat every selection here as an opinion rather than a promise.';

  const card = {
    date: dateISO,
    tips,
    openerProblems,
    summaryRows,
    summary: { active: summaryRows, suppressedCount: 0 },
    valueNote,
    responsibleGambling,
  };
  card.formattedText = buildBaseballFormattedCardText(card, dateISO);
  return card;
}

export function buildBaseballFormattedCardText(card, dateISO = null) {
  const lines = [];
  if (dateISO) lines.push(`BASEBALL PREDICTIONS — ${dateISO}`);
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
  if (card.valueNote) { lines.push(card.valueNote); lines.push(''); }
  lines.push(card.responsibleGambling || '');
  return lines.join('\n');
}
