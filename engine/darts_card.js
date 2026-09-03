/**
 * SportsPred — Darts card builder.
 *
 * Joins the committed documents into scored, written cards:
 *
 *   data/darts_slate.json      OLBG darts markets + fixture identity
 *   data/darts_results.json    source-linked completed results tape
 *   data/darts_rankings.json   PDC Order of Merit snapshot
 *
 * Pure: the caller supplies every document. The same builder scores live
 * cards (odds component missing, confidence capped) and historical leans
 * against the tape (leak-free: only matches strictly before the target).
 */

import { prepareFixture, fixturesFromSlate, fixtureFromTapeRow, completedMatches } from './darts_data.js';
import { scoreMatch, normaliseCard, cardSummary } from './darts_engine.js';
import { writeDartsCard, buildCopyText } from './darts_writer.js';

function scoreOne(fx, docs, asOfISO) {
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
}

/** Build the scored + written card for every two-player fixture on the slate. */
export function buildDartsCard(docs = {}, opts = {}) {
  const slate = docs.slate || { events: [] };
  const asOfISO = opts.asOfISO || slate.source?.fetched_at_utc?.slice(0, 10) || null;
  const fixtures = fixturesFromSlate(slate);

  const scored = fixtures.map((fx) => scoreOne(fx, docs, asOfISO));
  const card = normaliseCard(scored);
  const written = writeDartsCard(card, { date: asOfISO, forbiddenNames: [] });
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

/**
 * Walk-forward historical leans over the results tape. Every completed match
 * is scored only from matches recorded strictly before it. Used by the page
 * so a results day still carries a written, source-grounded prediction.
 */
export function scoreTapeLeans(docs = {}, opts = {}) {
  const tape = docs.tape || { matches: [] };
  const completed = completedMatches(tape).filter((m) => m.winner && m.player_a?.name && m.player_b?.name);
  const asOfISO = opts.asOfISO || tape.as_of_utc?.slice(0, 10) || null;
  const scored = completed.map((row) => {
    const fx = fixtureFromTapeRow(row);
    return scoreOne(fx, docs, fx.dateISO || asOfISO);
  });
  const card = normaliseCard(scored);
  const written = writeDartsCard(card, { date: asOfISO, forbiddenNames: [] });
  return {
    asOfISO,
    fixtures: scored.length,
    scored: card,
    written,
    summary: cardSummary(card),
    copyText: buildCopyText(written),
  };
}

/** Whether the fixture has settled in the tape, and the outcome. */
export function settleFixture(scored, tape = { matches: [] }) {
  const row = (tape.matches || []).find((m) => m.id === scored.matchId || m?.match_id === scored.matchId);
  if (!row || !row.winner) {
    const byNames = (tape.matches || []).find((m) => {
      const names = [m.player_a?.name, m.player_b?.name].filter(Boolean).sort();
      const pred = String(scored.matchTitle || '').split(/\s+v(?:s)?\.?\s+/i).map((s) => s.trim()).sort();
      return names.length === 2 && pred.length === 2 && names[0] === pred[0] && names[1] === pred[1] && m.winner;
    });
    if (!byNames) return { matchId: scored.matchId, status: 'pending', settled: false };
    return {
      matchId: scored.matchId,
      selection: scored.leanName,
      predicted: scored.leanName === byNames.winner,
      actualWinner: byNames.winner,
      score: `${byNames.score_a}-${byNames.score_b}`,
      confidence: scored.confidence.band,
      bet: scored.decision.bet,
      settled: true,
      status: 'settled',
    };
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
