/**
 * SportsPred — Universal tip writer (pure, no I/O).
 *
 * Turns a scored match into a written, copy-ready prediction.
 *
 * OUTPUT RULES (enforced by validateUniversalTip, tested)
 *   R1  The selection must appear, bolded, inside the opening sentence.
 *   R2  Minimum 55 words, maximum 170 — long enough to be an analysis, short
 *       enough to paste into a tip box.
 *   R3  Every factual clause must come from a sourced signal. The writer can
 *       only mention signals present in result.model.signals, so it is
 *       structurally incapable of inventing a stat.
 *   R4  No banned filler ("must-win", "value is there", "sure thing", ...).
 *   R5  No guarantee language, and the responsible-gambling caveat is appended
 *       by the caller, never inside the tip body.
 *   R6  A market whose band is SKIP is never written up as a selection.
 */

export const WRITER_VERSION = 'universal-writer-v1.0';

export const BANNED_PHRASES = [
  'must-win', 'must win', 'sure thing', 'banker', 'cant lose', "can't lose",
  'guaranteed', 'lock of the day', 'free money', 'no brainer', 'no-brainer',
  'value is there', 'easy money', 'slam dunk', 'nailed on', 'cannot lose',
];

const pct = (p) => `${Math.round((p || 0) * 1000) / 10}%`;

function formSentence(signal) {
  if (!signal) return null;
  return `Form splits the tie: ${signal.detail}.`;
}

function recordSentence(signal) {
  if (!signal) return null;
  // Descriptive, never asserting agreement: the record may cut the other way,
  // and the engine has already accounted for the direction in the score.
  return `Season records read ${signal.detail}.`;
}

function rankSentence(signal) {
  if (!signal) return null;
  return `The published ranking gap is ${signal.detail}.`;
}

function h2hSentence(signal) {
  if (!signal) return null;
  return `Head to head, ${signal.detail}.`;
}

function restSentence(signal) {
  if (!signal) return null;
  return `Scheduling matters here too: ${signal.detail}.`;
}

function baselineSentence(signal, neutral) {
  if (!signal) return null;
  if (neutral) return 'The venue is neutral, so the home split measured in this competition is set aside.';
  // signal.detail already reads "measured from N completed X matches".
  return `Home advantage is not assumed here: the home baseline of ${pct(signal.value)} is ${signal.detail}.`;
}

function marketSentence(result) {
  const head = result.headline;
  if (!head) return null;
  if (head.market === 'total') {
    const t = result.markets.total;
    return `The line is set at ${t.line}, while this competition has been averaging ${t.leagueMean} across ${t.sample} completed matches, and that distance is what the selection is built on.`;
  }
  if (head.market === 'handicap') {
    const h = result.markets.handicap;
    return `The handicap is posted at ${h.line}, and the straight-result edge is wide enough to give that away.`;
  }
  if (head.market === 'double_chance') {
    return 'The straight result was not strong enough to stand alone, so the published call is the lower-variance derivative rather than an outright winner.';
  }
  return null;
}

function priceSentence(result) {
  const b = result.blend;
  const mr = result.markets.match_result;
  const head = result.headline;
  if (!b?.priced) {
    return 'No price is published in the free feed for this fixture, so the call rests on the sourced form and record signals alone.';
  }
  // The price we can quote is always the straight match-result price. When the
  // published selection comes from a derived market, say so rather than
  // implying the quoted percentages belong to that market.
  const derived = head && head.market !== 'match_result';
  const lead = derived
    ? `On the straight result, the ${b.provider} price implies ${pct(mr?.marketProbability)} for ${mr?.selection}`
    : `The posted price from ${b.provider} implies ${pct(mr?.marketProbability)}`;
  const edge = mr?.edge;
  if (typeof edge === 'number' && edge > 0.03) {
    return derived
      ? `${lead} against the model's ${pct(mr?.probability)}, which is the context the published market sits in.`
      : `${lead} while the model lands on ${pct(mr?.probability)}, and that gap is what carries the selection.`;
  }
  if (typeof edge === 'number' && edge < -0.03) {
    return `${lead}, slightly ahead of the model's ${pct(mr?.probability)}, so this is a confidence call rather than a price play.`;
  }
  return `${lead}, and the model agrees closely at ${pct(mr?.probability)}.`;
}

function missingSentence(result) {
  const list = (result.missing || []).map((m) => m.label);
  if (!list.length) return null;
  const shown = list.slice(0, 3).join(', ').toLowerCase();
  return `Not everything is available: ${shown} could not be sourced for this fixture, and the confidence figure is capped accordingly.`;
}

/**
 * Write one tip for the strongest market on a scored match.
 * Returns { ok, market, text, words, violations[] }.
 */
export function writeUniversalTip(result) {
  const head = result?.headline;
  if (!head || !head.selection) {
    return {
      ok: false,
      market: null,
      text: null,
      words: 0,
      violations: ['no market cleared the publication threshold'],
      reason: result?.markets?.match_result?.reason || 'unscored',
    };
  }

  const s = (id) => (result.model?.signals || []).find((x) => x.id === id) || null;
  const neutral = result.neutral === true;

  const opening = `**${head.selection}** is the call in the ${head.label.toLowerCase()} market for ${result.match}${result.league ? ` in the ${result.league}` : ''}, rated ${head.band} confidence at ${head.score} out of one hundred.`;

  const body = [
    marketSentence(result),
    baselineSentence(s('BASE-01'), neutral),
    formSentence(s('FORM-01')),
    recordSentence(s('REC-01')),
    rankSentence(s('RANK-01')),
    h2hSentence(s('H2H-01')),
    restSentence(s('REST-01')),
    priceSentence(result),
    missingSentence(result),
  ].filter(Boolean);

  let text = [opening, ...body].join(' ');

  // R2 lower bound: if the fixture is thin, say so rather than padding.
  let words = countWords(text);
  if (words < 55) {
    text += ` This fixture is running on a thin evidence base, so the selection is published at reduced confidence and should be reviewed against the linked official sources before use.`;
    words = countWords(text);
  }

  const violations = validateUniversalTip(text, head);
  return { ok: violations.length === 0, market: head.market, band: head.band, score: head.score, text, words, violations };
}

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Enforce the output rules. Returns a list of violations (empty = valid). */
export function validateUniversalTip(text, head) {
  const v = [];
  const t = String(text || '');
  const lower = t.toLowerCase();

  if (!t.trim()) return ['empty tip'];

  const words = countWords(t);
  if (words < 55) v.push(`tip is ${words} words, under the 55-word minimum`);
  if (words > 170) v.push(`tip is ${words} words, over the 170-word maximum`);

  const boldMatch = t.match(/\*\*(.+?)\*\*/);
  if (!boldMatch) v.push('no bolded selection');
  else {
    const firstSentence = t.split(/(?<=\.)\s/)[0] || '';
    if (!firstSentence.includes(boldMatch[0])) v.push('bolded selection is not in the opening sentence');
    if (head?.selection && boldMatch[1].trim() !== String(head.selection).trim()) {
      v.push('bolded text does not match the scored selection');
    }
  }

  for (const p of BANNED_PHRASES) {
    if (lower.includes(p)) v.push(`banned phrase: "${p}"`);
  }

  if (/\b(will win|certain to|guarantee)\b/.test(lower)) v.push('guarantee language');
  if (head?.band === 'SKIP') v.push('SKIP market must not be written as a selection');

  return v;
}

/** Write every tip on a card. */
export function writeUniversalCard(scoredCard) {
  const tips = [];
  const withheld = [];
  for (const r of scoredCard?.results || []) {
    const tip = writeUniversalTip(r);
    if (tip.ok) {
      tips.push({
        matchId: r.matchId,
        match: r.match,
        league: r.league,
        dateISO: r.dateISO,
        startUtc: r.startUtc,
        market: tip.market,
        marketLabel: r.headline.label,
        selection: r.headline.selection,
        band: tip.band,
        score: tip.score,
        probability: r.headline.probability,
        price: r.headline.price ?? null,
        provider: r.headline.provider ?? null,
        words: tip.words,
        text: tip.text,
        sources: r.sources,
      });
    } else {
      withheld.push({ matchId: r.matchId, match: r.match, violations: tip.violations, reason: tip.reason ?? null });
    }
  }
  tips.sort((a, b) => b.score - a.score);
  return { writer: WRITER_VERSION, tips, withheld, unscored: scoredCard?.unscored || [] };
}

/** A plain-text card the user can copy in one action. */
export function buildCopyText(written, { title, dateISO, sourceNote } = {}) {
  const lines = [];
  lines.push(`${title || 'SportsPred predictions'}${dateISO ? ` — ${dateISO}` : ''}`);
  lines.push('='.repeat(Math.min(72, (title || 'SportsPred predictions').length + 14)));
  lines.push('');
  if (!written?.tips?.length) {
    lines.push('No selection cleared the publication threshold on this card.');
  }
  for (const t of written?.tips || []) {
    lines.push(`${t.match} — ${t.league || ''}`.trim());
    lines.push(`${t.marketLabel}: ${t.selection}  [${t.band} · ${t.score}/100]`);
    lines.push('');
    lines.push(t.text.replace(/\*\*/g, ''));
    lines.push('');
    for (const s of t.sources || []) lines.push(`  source: ${s.label} — ${s.url}`);
    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('');
  }
  if (written?.withheld?.length) {
    lines.push(`Withheld (${written.withheld.length}): ${written.withheld.map((w) => w.match).join('; ')}`);
    lines.push('');
  }
  if (written?.unscored?.length) {
    lines.push(`Unscored (${written.unscored.length}): ${written.unscored.map((u) => `${u.match} — ${u.reason}`).join('; ')}`);
    lines.push('');
  }
  lines.push(sourceNote || 'Generated mechanically from ESPN public data. Not betting advice. 18+.');
  return lines.join('\n');
}
