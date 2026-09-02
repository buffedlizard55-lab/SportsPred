/**
 * SportsPred — Snooker card builder.
 *
 * Joins the committed documents into scored, written cards:
 *
 *   data/snooker_slate.json      OLBG snooker markets + fixture identity
 *   data/snooker_results.json    source-linked completed results tape
 *   data/snooker_rankings.json   official WST ranking snapshot
 *
 * Pure: the caller supplies every document. The same builder scores live
 * cards (odds component missing, confidence capped) and settles them against
 * the tape afterwards.
 */

import { prepareFixture, fixturesFromSlate } from './snooker_data.js';
import { scoreMatch, normaliseCard, cardSummary } from './snooker_engine.js';
import { writeSnookerCard, buildCopyText } from './snooker_writer.js';

/** Build the scored + written card for every fixture on the slate. */
export function buildSnookerCard(docs = {}, opts = {}) {
  const slate = docs.slate || { events: [] };
  const asOfISO = opts.asOfISO || slate.source?.fetched_at_utc?.slice(0, 10) || null;
  const fixtures = fixturesFromSlate(slate);

  const scored = fixtures.map((fx) => {
    const prepared = prepareFixture(fx, { tape: docs.tape, rankings: docs.rankings, asOfISO });
    return scoreMatch(prepared.match, {
      profiles: prepared.profiles,
      h2h: prepared.h2h,
      roundTier: prepared.roundTier,
      dateISO: fx.dateISO,
      asOfISO,
      rankA: prepared.match.playerA.rank,
      rankB: prepared.match.playerB.rank,
    });
  });
  const card = normaliseCard(scored);
  const written = writeSnookerCard(card, {
    date: asOfISO,
    forbiddenNames: [],
  });
  const summary = cardSummary(card);
  return {
    asOfISO,
    fixtures: scored.length,
    scored: card,
    written,
    summary,
    copyText: buildCopyText(written),
  };
}

/** Whether the fixture has settled in the tape, and the outcome. */
export function settleFixture(scored, tape = { matches: [] }) {
  const row = (tape.matches || []).find((m) => m.id === scored.matchId || m?.match_id === scored.matchId);
  if (!row || !row.winner) {
    return { matchId: scored.matchId, status: 'pending', settled: false };
  }
  return {
    matchId: scored.matchId,
    selection: scored.leanName,
    predicted: scored.leanName === row.winner,
    actualWinner: row.winner,
    score: `${row.score_a}-${row.score_b}`,
    confidence: scored.confidence.band,
    bet: scored.decision.bet,
    settled: true,
    status: 'settled',
  };
}
