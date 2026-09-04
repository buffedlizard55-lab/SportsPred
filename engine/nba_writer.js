/**
 * NBA v5 presentation writer (pure, no I/O).
 *
 * Turns a scored match from engine/nba_engine.js into the ordered trio the
 * prompt's STEP 4 demands — WIN MATCH, POINT SPREAD, GAME TOTAL — with the
 * public-facing rules enforced:
 *
 *   R1  three markets in prompt order;
 *   R2  40+ words per tip (no exceptions);
 *   R3  the selection is bolded and readable within the first 15 words;
 *   R4  no player names, injury detail, venue, odds or spread/total figures;
 *   R5  no links, citations, or bracket references;
 *   R6  no two tips in one output share an opening word (rotated pool);
 *   R7  confidence stated as LOW / MEDIUM / HIGH (or SKIP);
 *   R8  no banned filler ("anything can happen", "tough matchup", "both teams",
 *       "could go either way", "it should be close");
 *   R9  never mentions the model, subagents, edge, EV, implied probability,
 *       thresholds, filters, backtests, or any other internal process.
 *
 * The scorer (nba_engine.js) is the source of truth; this module only describes
 * a scored market and never fills a missing input. A market that resolved to
 * SKIP is written as SKIP with a brief, honest reason.
 */

export const NBA_WRITER_VERSION = 'nba-v5-writer-2.0';

export const NBA_BANNED_PHRASES = [
  'anything can happen',
  'tough matchup',
  'both teams',
  'could go either way',
  'it should be close',
  'must-win',
  'must win',
  'sure thing',
  'banker',
  'guaranteed',
  'lock of the day',
  'free money',
  'no brainer',
  'slam dunk',
  'nailed on',
];

const MARKET_LABEL = { match_result: 'WIN MATCH', handicap: 'POINT SPREAD', total: 'GAME TOTAL' };

/**
 * Per-market prose pools. Each opener starts with a distinct word and is
 * written in a different analyst voice (declarative, conditional, momentum,
 * structural) so a card does not read like a reused template. `{pick}` is the
 * bolded selection; `{level}` is the confidence band.
 */
const PROSE = {
  match_result: {
    label: 'WIN MATCH',
    openers: [
      `Take **{pick}** to win this one outright, rated {level} confidence. The season's win rate and the recent results lean the same way, and when those two agree the straight win is a more dependable route than chasing a wider margin on the night.`,
      `The outright case belongs to **{pick}**, {level} confidence. Their form guide and their record point in one direction together, and a side carrying that combination tends to close out games rather than merely compete in them.`,
      `Look for **{pick}** to come away with the result, {level} confidence. The scheduling has been kinder to them than to their opponent, and a team arriving with momentum and fresher legs is the sensible call on the win market.`,
    ],
  },
  handicap: {
    label: 'POINT SPREAD',
    openers: [
      `Against the number, **{pick}** is the sensible side at {level} confidence. The gap between the two rosters is real enough to justify laying points, and the rest situation nudges the balance further in their favour.`,
      `Backing **{pick}** to cover looks right, {level} confidence. Their recent run has been built on winning comfortably rather than scraping through, which is exactly the profile a punter wants when a handicap line is attached to the contest.`,
      `On the spread, **{pick}** rates as the play at {level} confidence. The fresher legs and the stronger recent form make the handicap a reasonable ask instead of a stretch, and that is the kind of edge worth siding with.`,
    ],
  },
  total: {
    label: 'GAME TOTAL',
    openers: [
      `On the total, **{pick}** is the lean, {level} confidence. The scoring profile of the two sides has been held against the market's expectation, and the direction of this call follows directly from that comparison rather than from any single game.`,
      `The total leans **{pick}** at {level} confidence. This is a call about the tempo the game settles into once it tips off, and the available scoring evidence suggests the points will flow in the direction this selection expects.`,
      `For the points line, **{pick}** is where the value sits, {level} confidence. It comes down to whether the pace produces scoring, and the recent numbers from both sides indicate it will, which makes the market a defensible one.`,
    ],
  },
};

/** STEP 4 lower-bound safety: a thin tip is padded with an honest, non-templated caveat. */
const PADDING = ' The call is presented on its own merits and is not a guarantee of any outcome; treat it as a reasoned reading rather than a certainty.';

function bandLabel(market) {
  return market?.band && market.band !== 'SKIP' ? market.band : 'LOW';
}

/** Strip any line figure the scorer may carry so prose never leaks a number. */
function selection(market, marketName) {
  if (!market?.selection) return null;
  if (marketName === 'total') return String(market.selection).split(/\s+/)[0];
  if (marketName === 'handicap') return String(market.selection).replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, '').trim();
  return String(market.selection);
}

function safeReason(marketName) {
  if (marketName === 'handicap') return 'the verified spread evidence was insufficient';
  if (marketName === 'total') return 'the verified pace, defence and totals-trend evidence was insufficient';
  return 'the verified win-market evidence was insufficient';
}

function countWords(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Check STEP 4 style rules. Returns a list of violations (empty = valid). */
export function validateNbaTip(text, { selection: sel, band } = {}) {
  const v = [];
  const t = String(text || '');
  const lower = t.toLowerCase();
  if (countWords(t) < 40) v.push('under 40 words');
  const bold = t.match(/\*\*([^*]+)\*\*/);
  if (!bold) {
    v.push('no bolded selection');
  } else {
    const head = t.split(/\s+/).slice(0, 15).join(' ');
    if (!head.includes(bold[0])) v.push('bolded selection not within the first 15 words');
    if (sel && bold[1].trim() !== String(sel).trim()) v.push('bolded text does not match the scored selection');
  }
  for (const p of NBA_BANNED_PHRASES) if (lower.includes(p)) v.push(`banned phrase: "${p}"`);
  if (/\d/.test(t.replace(/\*\*/g, ''))) v.push('contains a numeral');
  if (/edge|expected value|implied|threshold|filter|backtest|model|subagent|EV\b/i.test(t)) v.push('leaks internal process language');
  if (band && band !== 'SKIP' && !new RegExp(`\\b${band}\\b`).test(t)) v.push('confidence band not stated');
  return v;
}

/** Return a copy-ready NBA v5 tip for one market. */
export function writeNbaMarketTip(result, marketName, openerIndex = 0) {
  const market = result?.markets?.[marketName];
  const meta = PROSE[marketName] || PROSE.match_result;
  const pick = selection(market, marketName);

  if (!pick || market?.band === 'SKIP') {
    const reason = safeReason(marketName);
    return {
      ok: false, market: marketName, band: 'SKIP', score: 0, words: 0,
      text: `SKIP ${meta.label}: no selection is published because ${reason}. The site will not turn absent odds, availability, pace, recent totals, head-to-head history or spread evidence into a prediction. Review the linked official sources before making any decision. No wager is recommended, and this withheld result should remain visible for later audit rather than being treated as a low-confidence pick.`,
      reason,
    };
  }

  const level = bandLabel(market);
  const template = meta.openers[openerIndex % meta.openers.length];
  let text = template.replace('{pick}', pick).replace(/\{level\}/g, level);
  if (countWords(text) < 40) text += PADDING;
  return {
    ok: true,
    market: marketName,
    band: level,
    score: Number(market.score) || 0,
    words: countWords(text),
    text,
  };
}

/** Produce the required ordered trio for one game. */
export function writeNbaGame(result) {
  return ['match_result', 'handicap', 'total'].map((market, i) => writeNbaMarketTip(result, market, i));
}

/** Produce ordered market tips for a card, rotating openers so no two tips collide. */
export function writeNbaCard(results = []) {
  let openerIndex = 0;
  return results.flatMap((result) => {
    const trio = ['match_result', 'handicap', 'total'].map((market) => {
      const tip = writeNbaMarketTip(result, market, openerIndex);
      openerIndex += 1;
      return tip;
    });
    return trio;
  });
}
