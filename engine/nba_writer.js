/**
 * NBA v5 presentation writer.
 *
 * This is intentionally separate from the universal writer. The NBA brief asks
 * for three independent market outputs and forbids price/line/player details in
 * the published prose. The scorer remains the source of truth; this module
 * only describes a scored market and never fills a missing input.
 */

export const NBA_WRITER_VERSION = 'nba-v5-writer-1.0';

const MARKET_COPY = {
  match_result: {
    label: 'WIN MATCH',
    opener: 'On the win market',
    body: 'the available team-strength and recent-results signals point in this direction. The recommendation is deliberately limited to the evidence that was actually sourced for this fixture, with unavailable inputs withheld rather than estimated.',
  },
  handicap: {
    label: 'POINT SPREAD',
    opener: 'Against the point spread',
    body: 'the available team-strength and spread-related signals support this side only where the underlying evidence is present. No line value or movement is repeated in the copy-ready text.',
  },
  total: {
    label: 'GAME TOTAL',
    opener: 'For the game total',
    body: 'the available pace, scoring and defensive signals support this direction only when the scorer has evidence to support it. Missing inputs are reported as a reason to pass, not converted into a guess.',
  },
};

const title = (market) => MARKET_COPY[market]?.label || market;

function band(market) {
  return market?.band && market.band !== 'SKIP' ? market.band : 'LOW';
}

function selection(market, marketName) {
  if (!market?.selection) return null;
  // The scorer may carry a spread/total number for internal settlement. NBA v5
  // prose must not expose that number.
  if (marketName === 'total') return String(market.selection).split(/\s+/)[0];
  if (marketName === 'handicap') return String(market.selection).replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, '').trim();
  return String(market.selection);
}

function safeReason(marketName) {
  if (marketName === 'handicap') return 'the verified spread evidence was insufficient';
  if (marketName === 'total') return 'the verified total evidence was insufficient';
  return 'the verified win-market evidence was insufficient';
}

/** Return a copy-ready NBA v5 tip for one market. */
export function writeNbaMarketTip(result, marketName, openerIndex = 0) {
  const market = result?.markets?.[marketName];
  const meta = MARKET_COPY[marketName] || { label: title(marketName), opener: 'For this market', body: 'the available sourced evidence is recorded without adding unsupported detail.' };
  const level = band(market);
  const pick = selection(market, marketName);
  const missing = (result?.missing || []).slice(0, 2).map((x) => x.label).join(' and ');

  if (!pick || market?.band === 'SKIP') {
    const reason = safeReason(marketName);
    return {
      ok: false, market: marketName, band: 'SKIP', score: 0, words: 0,
      text: `SKIP ${meta.label}: no selection is published because ${reason}. The site will not turn absent odds, availability, pace, recent totals, head-to-head history or spread evidence into a prediction. Review the linked official sources before making any decision. No wager is recommended, and this withheld result should remain visible for later audit rather than being treated as a low-confidence pick.`,
      reason,
    };
  }

  const prefix = [
    'Starting with the win market,',
    'From a spread perspective,',
    'Looking at the total,',
    'For this market,',
  ][openerIndex % 4];
  const text = `**${pick}** is the ${meta.label.toLowerCase()} selection, rated ${level} confidence. ${prefix} ${meta.opener.toLowerCase()} ${meta.body}${missing ? ` The unavailable ${missing} inputs keep the language measured.` : ' The recommendation is not a guarantee and should be treated as a model output, not betting advice.'}`;
  return { ok: true, market: marketName, band: level, score: Number(market.score) || 0, words: text.trim().split(/\s+/).length, text };
}

/** Produce the required ordered trio for one game. */
export function writeNbaGame(result) {
  return ['match_result', 'handicap', 'total'].map((market, i) => writeNbaMarketTip(result, market, i));
}

/** Produce ordered market tips for a card. */
export function writeNbaCard(results = []) {
  return results.flatMap((result) => writeNbaGame(result));
}
