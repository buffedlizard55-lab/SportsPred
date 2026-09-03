/**
 * SportsPred — GAA card builder.
 */

import { prepareFixture, fixturesFromSlate, fixtureFromTapeRow, completedMatches } from './gaa_data.js';
import { scoreMatch, normaliseCard, cardSummary } from './gaa_engine.js';
import { writeGaaCard, buildCopyText } from './gaa_writer.js';

function scoreOne(fx, docs, asOfISO) {
  const prepared = prepareFixture(fx, { tape: docs.tape, rankings: docs.rankings, asOfISO });
  return scoreMatch(prepared.match, {
    profiles: prepared.profiles,
    h2h: prepared.h2h,
    roundTier: prepared.roundTier,
    dateISO: fx.dateISO,
    asOfISO,
    rankA: prepared.match.teamA.rank,
    rankB: prepared.match.teamB.rank,
    code: fx.code,
  });
}

export function buildGaaCard(docs = {}, opts = {}) {
  const slates = [];
  if (docs.slate) slates.push({ doc: docs.slate, code: 'football' });
  if (docs.hurlingSlate) slates.push({ doc: docs.hurlingSlate, code: 'hurling' });
  const asOfISO = opts.asOfISO
    || docs.slate?.source?.fetched_at_utc?.slice(0, 10)
    || docs.hurlingSlate?.source?.fetched_at_utc?.slice(0, 10)
    || null;
  const fixtures = slates.flatMap((s) => fixturesFromSlate(s.doc, { code: s.code }));
  const scored = fixtures.map((fx) => scoreOne(fx, docs, asOfISO));
  const card = normaliseCard(scored);
  const written = writeGaaCard(card, { date: asOfISO });
  return {
    asOfISO,
    fixtures: scored.length,
    scored: card,
    written,
    summary: cardSummary(card),
    copyText: buildCopyText(written),
  };
}

export function scoreTapeLeans(docs = {}, opts = {}) {
  const tape = docs.tape || { matches: [] };
  const completed = completedMatches(tape).filter((m) => m.winner && (m.team_a?.name || m.player_a?.name));
  const asOfISO = opts.asOfISO || tape.as_of_utc?.slice(0, 10) || null;
  const scored = completed.map((row) => {
    const fx = fixtureFromTapeRow(row);
    return scoreOne(fx, docs, fx.dateISO || asOfISO);
  });
  const card = normaliseCard(scored);
  const written = writeGaaCard(card, { date: asOfISO });
  return {
    asOfISO,
    fixtures: scored.length,
    scored: card,
    written,
    summary: cardSummary(card),
    copyText: buildCopyText(written),
  };
}

export function settleFixture(scored, tape = { matches: [] }) {
  const namesOf = (m) => [m.team_a?.name || m.player_a?.name, m.team_b?.name || m.player_b?.name].filter(Boolean).sort();
  const pred = String(scored.matchTitle || '').split(/\s+v(?:s)?\.?\s+/i).map((s) => s.trim()).sort();
  const row = (tape.matches || []).find((m) => m.id === scored.matchId)
    || (tape.matches || []).find((m) => {
      const names = namesOf(m);
      return names.length === 2 && pred.length === 2 && names[0] === pred[0] && names[1] === pred[1] && m.winner;
    });
  if (!row || !row.winner) return { matchId: scored.matchId, status: 'pending', settled: false };
  const score = row.scoreline || `${row.total_a}-${row.total_b}`;
  return {
    matchId: scored.matchId,
    selection: scored.leanName,
    predicted: scored.leanName === row.winner,
    actualWinner: row.winner,
    score,
    confidence: scored.confidence.band,
    bet: scored.decision.bet,
    settled: true,
    status: 'settled',
  };
}
