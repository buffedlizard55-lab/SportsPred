/**
 * SportsPred — Championship League Snooker card builder.
 *
 * Joins the verified tape (data/snooker_cls.json) to the overlay engine and
 * writer. Pure: the caller supplies the document.
 *
 * LEAK-FREE RULE, as everywhere else in this repo: a match or group is only
 * ever scored from matches that finished strictly earlier. `asOf` walks the
 * calendar so the same builder produces a live card and a walk-forward
 * backtest with identical code.
 */

import {
  scoreMatchResult, scoreCorrectScore, scoreGroupWinner, flagValueCandidate, editionFor,
} from './snooker_cls_engine.js';
import {
  writeMatchResult, writeCorrectScore, writeGroupWinner, buildCard, buildCopyText,
} from './snooker_cls_writer.js';

/**
 * Chronology key. Matches are stored in published order, which is the order of
 * play, so the array index orders matches inside a single group day. Both are
 * combined so "strictly earlier" is well defined within a day as well as
 * across days.
 */
export function seqIndex(doc) {
  const idx = new Map();
  (doc.matches || []).forEach((m, i) => idx.set(m.id, i));
  return idx;
}

/**
 * Every completed, table-counting match strictly before `before`.
 * `before` is either an ISO date (all earlier days) or { date, seq } which
 * also admits earlier matches from the same day.
 */
export function priorMatches(doc, before, idx = null) {
  const seq = idx || seqIndex(doc);
  const date = typeof before === 'string' ? before : before.date;
  const cutoff = typeof before === 'string' ? -1 : before.seq;
  return (doc.matches || []).filter((m) => {
    if (m.walkover || m.expunged || m.score_a === null) return false;
    if (m.date < date) return true;
    if (m.date > date) return false;
    return seq.get(m.id) < cutoff;
  });
}

function resultFor(m, name) {
  if (m.player_a !== name && m.player_b !== name) return null;
  if (m.draw) return 'draw';
  return m.winner === name ? 'win' : 'loss';
}

function marginFor(m) {
  return Math.abs(m.score_a - m.score_b);
}

function scorelineFor(m, name) {
  const forFrames = m.player_a === name ? m.score_a : m.score_b;
  const against = m.player_a === name ? m.score_b : m.score_a;
  return `${Math.max(forFrames, against)}-${Math.min(forFrames, against)}`;
}

/** Build a player's short-format profile from matches before `date`. */
export function profileFor(doc, name, date, idx = null) {
  const own = priorMatches(doc, date, idx).filter((m) => m.player_a === name || m.player_b === name).reverse();
  return {
    name,
    last5: own.slice(0, 5).map((m) => ({
      id: m.id, date: m.date, group: m.group,
      opponent: m.player_a === name ? m.player_b : m.player_a,
      result: resultFor(m, name),
      margin: marginFor(m),
      scoreline: scorelineFor(m, name),
    })),
    played: own.length,
  };
}

/** Published highest breaks for a player in groups completed before `date`. */
export function breaksFor(doc, name, date) {
  const endOfGroup = new Map();
  for (const m of doc.matches || []) {
    if (!endOfGroup.has(m.group) || m.date > endOfGroup.get(m.group)) endOfGroup.set(m.group, m.date);
  }
  return (doc.tables || [])
    .filter((r) => r.player === name && r.highestBreak !== null && (endOfGroup.get(r.group) || '9999') < date)
    .map((r) => r.highestBreak);
}

/** Head-to-head between two players before `date`, most recent first. */
export function h2hFor(doc, name, opponent, date, idx = null) {
  const meetings = priorMatches(doc, date, idx)
    .filter((m) => (m.player_a === name && m.player_b === opponent) || (m.player_a === opponent && m.player_b === name))
    .reverse()
    .map((m) => ({ id: m.id, date: m.date, result: resultFor(m, name) }));
  return { total: meetings.length, meetings };
}

/** Seed number as published in the group table (seeds are allocated by ranking). */
export function seedFor(doc, name) {
  const row = (doc.tables || []).find((r) => r.player === name && Number.isFinite(r.seed));
  return row ? row.seed : null;
}

/** Assemble the engine input for one fixture. */
export function prepareFixture(doc, match, { edition = 'ranking', seeds = new Map(), idx = null } = {}) {
  const seq = idx || seqIndex(doc);
  const date = { date: match.date, seq: seq.get(match.id) };
  const a = match.player_a;
  const b = match.player_b;
  const profA = profileFor(doc, a, date, seq);
  const profB = profileFor(doc, b, date, seq);
  const history = [...profA.last5, ...profB.last5].map((m) => m.scoreline);
  return {
    id: match.id,
    edition,
    date: match.date,
    group: match.group,
    stageLabel: match.stage_label,
    a: {
      name: a, seed: seeds.get(a) ?? null, profile: profA,
      h2h: h2hFor(doc, a, b, date, seq), breaks: breaksFor(doc, a, match.date), odds: null,
    },
    b: {
      name: b, seed: seeds.get(b) ?? null, profile: profB,
      h2h: h2hFor(doc, b, a, date, seq), breaks: breaksFor(doc, b, match.date), odds: null,
    },
    scorelineHistory: history,
    recentMargins: [...profA.last5, ...profB.last5].map((m) => m.margin),
  };
}

/** Seed map from the published group tables of the source document. */
export function seedMap(doc) {
  const m = new Map();
  for (const r of doc.tables || []) if (Number.isFinite(r.seed)) m.set(r.player, r.seed);
  return m;
}

/** Score and write the card for every match on one date. */
export function buildDayCard(doc, date, { edition = 'ranking', seeds = null } = {}) {
  editionFor(edition);
  const seedsMap = seeds || seedMap(doc);
  const idx = seqIndex(doc);
  const matches = (doc.matches || []).filter((m) => m.date === date && !m.walkover);
  const entries = [];
  const valueCandidates = [];
  const usedOpeners = new Set();
  let i = 0;

  for (const match of matches) {
    const fixture = prepareFixture(doc, match, { edition, seeds: seedsMap, idx });
    const mr = scoreMatchResult(fixture);
    const cs = scoreCorrectScore(fixture, mr);
    const subject = `${match.player_a} v ${match.player_b}`;
    entries.push({
      subject,
      kind: 'match',
      matchId: match.id,
      group: match.group,
      stageLabel: match.stage_label,
      date: match.date,
      scored: { matchResult: mr, correctScore: cs },
      tips: [writeMatchResult(mr, { index: i, usedOpeners }), writeCorrectScore(cs, mr, { index: i, usedOpeners })],
    });
    const v = flagValueCandidate(mr);
    if (v) valueCandidates.push({ subject, ...v });
    i += 1;
  }

  // Group winner: one assessment per group appearing on this date.
  const groups = [...new Set(matches.map((m) => m.group))];
  for (const g of groups) {
    const names = [...new Set((doc.tables || []).filter((r) => r.group === g).map((r) => r.player))];
    const groupInput = {
      edition,
      label: `${matches.find((m) => m.group === g)?.stage_label || g}`,
      players: names.map((n) => ({
        name: n,
        seed: seedsMap.get(n) ?? null,
        profile: profileFor(doc, n, date),
        breaks: breaksFor(doc, n, date),
        groupH2H: names.filter((o) => o !== n)
          .flatMap((o) => h2hFor(doc, n, o, date).meetings),
      })),
    };
    const gw = scoreGroupWinner(groupInput);
    entries.push({
      subject: groupInput.label,
      kind: 'group',
      group: g,
      date,
      scored: { groupWinner: gw },
      tips: [writeGroupWinner(gw, { index: i, usedOpeners })],
    });
    i += 1;
  }

  const card = buildCard(entries, { date, edition: editionFor(edition).label, valueCandidates });
  return { ...card, copyText: buildCopyText(card) };
}

/** Every date on the calendar, ascending. */
export function datesIn(doc) {
  return [...new Set((doc.matches || []).map((m) => m.date))].sort();
}

/** Walk-forward backtest: score every day only from earlier days, then settle. */
export function backtest(doc, { edition = 'ranking' } = {}) {
  const seeds = seedMap(doc);
  const rows = [];
  for (const date of datesIn(doc)) {
    const card = buildDayCard(doc, date, { edition, seeds });
    for (const entry of card.entries) {
      if (entry.kind === 'match') {
        const actual = (doc.matches || []).find((m) => m.id === entry.matchId);
        const mrTip = entry.tips.find((t) => t.market === 'MATCH RESULT');
        const csTip = entry.tips.find((t) => t.market === 'CORRECT SCORE');
        const actualResult = actual.draw ? 'Draw' : actual.winner;
        const actualLine = `${Math.max(actual.score_a, actual.score_b)}-${Math.min(actual.score_a, actual.score_b)}`;
        rows.push({
          date, subject: entry.subject, market: 'MATCH RESULT',
          pick: mrTip.pick, confidence: mrTip.confidence,
          actual: actualResult,
          correct: mrTip.skip ? null : mrTip.pick === actualResult,
        });
        rows.push({
          date, subject: entry.subject, market: 'CORRECT SCORE',
          pick: csTip.pick, confidence: csTip.confidence,
          actual: actualLine,
          correct: csTip.skip ? null : csTip.pick === actualLine,
        });
      } else {
        const gwTip = entry.tips[0];
        const winner = (doc.tables || []).find((r) => r.group === entry.group && r.pos === 1)?.player ?? null;
        rows.push({
          date, subject: entry.subject, market: 'GROUP WINNER',
          pick: gwTip.pick, confidence: gwTip.confidence,
          actual: winner,
          correct: gwTip.skip ? null : gwTip.pick === winner,
        });
      }
    }
  }
  const graded = rows.filter((r) => r.correct !== null);
  const byMarket = {};
  for (const r of graded) {
    byMarket[r.market] = byMarket[r.market] || { graded: 0, correct: 0 };
    byMarket[r.market].graded += 1;
    if (r.correct) byMarket[r.market].correct += 1;
  }
  return {
    prompt: 'CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT v1.0',
    edition,
    method: 'Walk-forward: every card is scored using only matches that finished on an earlier date, then settled against the published result.',
    total: rows.length,
    graded: graded.length,
    skipped: rows.length - graded.length,
    byMarket,
    rows,
  };
}
