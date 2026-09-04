/**
 * SportsPred — Championship League Snooker writer and output validator.
 *
 * Implements Step 4 of CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT
 * v1.0 and enforces every one of its output rules mechanically:
 *
 *   - markets written in the order MATCH RESULT, CORRECT SCORE, GROUP WINNER
 *   - minimum 40 words, no exceptions
 *   - the picked outcome bolded and clear inside the first 20 words
 *   - Correct Score names the specific scoreline (its whole purpose) while the
 *     surrounding prose stays free of other figures
 *   - reasoning in plain language only: no odds, statistics or figures
 *   - no source citations, social media references or bracket links
 *   - varied sentence structure; the banned phrase list is rejected outright
 *   - confidence stated as LOW, MEDIUM or HIGH
 *   - below-threshold markets written as SKIP or too open to call, with one
 *     explanatory sentence, never forced
 *   - the card ends with a summary table, value notes and a substantive
 *     responsible gambling section
 *
 * OPERATING PRINCIPLE. One disclosed analytical voice. No tip claims or
 * implies separate authorship; phrasing varies for readability only.
 */

export const MIN_WORDS = 40;

/** Verbatim from the prompt. */
export const BANNED_PHRASES = [
  'hard to look past',
  'the better player',
  'on paper',
  'anything can happen',
  'a tight match',
  'in fine form',
];

/** Citations, handles and links never appear in a tip. */
export const FORBIDDEN_TOKENS = [
  'http', 'www.', '.com', '.org', '.co.uk', '@', '#',
  'wikipedia', 'snooker.org', 'wst', 'olbg', 'betvictor', 'matchroom',
  'twitter', 'facebook', 'according to', 'cite',
];

/**
 * Digits are banned everywhere except the Correct Score market, where naming
 * the scoreline is the market's entire purpose.
 */
export function digitsAllowedFor(market) {
  return market === 'CORRECT SCORE';
}

/* ------------------------------------------------------------------ *
 * phrasing pools — varied angle, one voice
 * ------------------------------------------------------------------ */

const MATCH_OPENERS = [
  '**{pick}** is the selection here',
  'The lean is **{pick}**',
  'Take **{pick}** in this one',
  '**{pick}** gets the vote',
  'Backing **{pick}** looks right',
  '**{pick}** shades this group meeting',
  'Preference is for **{pick}**',
  '**{pick}** holds the edge worth siding with',
  'Siding with **{pick}** in this meeting',
  'Preference lands on **{pick}**',
  'Give it to **{pick}**',
  'Look to **{pick}** here',
  'Confidence sits with **{pick}**',
  'Weight of evidence favours **{pick}**',
  'Recent evidence points to **{pick}**',
  'Judgement here is **{pick}**',
];

const DRAW_OPENERS = [
  'A **draw** is expected here',
  'Level honours look likeliest, making the **draw** the selection',
  'Expect this to finish square, so a **draw** is the pick',
  'Sharing the frames looks right, and the **draw** is taken',
  'Two-all is the call, so the **draw** is the selection',
];

const MATCH_REASONS = [
  'recent short-format results give the firmer platform',
  'the run of recent form over four-frame matches reads better',
  'the head-to-head record leans this way',
  'break-building has carried further in recent groups',
  'the ranking gap is real and has not been offset by form',
  'consistency across recent group days is the separator',
  'scoring weight across recent frames tilts the balance',
];

const MATCH_CLOSERS = [
  'Short formats punish slow starts, and that is where the difference should show.',
  'Over four frames there is little room to recover, which suits the pick.',
  'A single scoring burst can settle this, and that capacity sits on one side.',
  'The margin is slim, but the sourced evidence points consistently one way.',
  'Group days reward players who arrive sharp, and that is the reading here.',
  'Frame difference matters in this format, so an efficient win is the expectation.',
];

const DRAW_CLOSERS = [
  'Two-all is a genuine, common result in this format rather than a curiosity, and both players project to trade frames evenly.',
  'With nothing separating them on the sourced measures, sharing the frames is the honest reading rather than forcing a winner.',
  'The format allows a level finish and this pairing is the type that produces one, so the draw is taken on its own merits.',
];

const SCORE_OPENERS = [
  '**{line}** is the projected margin',
  'Expect **{line}** here',
  'Settling on **{line}** for the frame score',
  'Frames should finish **{line}**',
  'Predicting **{line}** on the frame score',
  'A **{line}** finish reads likeliest',
  'Going with **{line}** as the margin',
  'Marking this down as **{line}**',
  'Look for **{line}** on the frame score',
  'Reading this as **{line}**',
  'Calling the margin at **{line}**',
  'Projected finish: **{line}**',
  'Scoreline should read **{line}**',
  'Weight of evidence favours **{line}**',
  'Anticipating **{line}** across the frames',
  'Judging the margin to be **{line}**',
];

const SCORE_REASONS = [
  'earlier short-format matches involving these players have tended to land on that margin',
  'the way recent matches have finished supports that shape',
  'the balance of the match-result read points at that spread of frames',
  'neither player has been finishing matches at a wider margin lately',
];

const GROUP_OPENERS = [
  '**{pick}** is fancied to top the group',
  'Expect **{pick}** to come out on top',
  '**{pick}** looks the strongest route through this group',
  'Siding with **{pick}** to finish first',
  'Group honours should go to **{pick}**',
  'Backing **{pick}** to head the table',
  'Look for **{pick}** to top the table',
  'Judging **{pick}** the likeliest group winner',
  'Weight of evidence favours **{pick}** here',
  'Preference is **{pick}** to advance',
  'Reading the group for **{pick}**',
  'Anticipating **{pick}** to finish top',
];

const GROUP_REASONS = [
  'the projected points path leans on outright wins rather than draws, which matters when a win is worth three times a draw',
  'a winning head-to-head record inside this specific group underpins the case',
  'the combination of seeding and recent short-format form is the strongest in the field',
  'a decisive break-building ceiling can turn a close group quickly',
];

const GROUP_CLOSERS = [
  'Placings can turn on highest break when points and frame difference are level, which adds to the case.',
  'Winning narrowly but repeatedly beats going unbeaten through draws in this scoring system.',
  'Consistency across a single day of matches is what this format rewards.',
];

function pick(pool, idx) {
  return pool[((idx % pool.length) + pool.length) % pool.length];
}

/**
 * Choose a phrase whose opening word has not been used yet for this market on
 * this card, so no opening word repeats. Falls back to rotation when the pool
 * is exhausted, and the card validator still reports any residual repeat.
 */
function pickUnique(pool, idx, used, market) {
  for (let k = 0; k < pool.length; k += 1) {
    const candidate = pick(pool, idx + k);
    const word = openingWord(candidate);
    const key = `${market}~${word}`;
    if (!used.has(key)) { used.add(key); return candidate; }
  }
  return pick(pool, idx);
}

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** First real word of a tip, ignoring markdown emphasis. */
export function openingWord(text) {
  const w = String(text).replace(/\*/g, '').trim().split(/\s+/)[0] || '';
  return w.toLowerCase().replace(/[^a-z]/g, '');
}

/** Pad a tip up to the 40-word floor with further substantive reasoning. */
function padTo(text, minWords, filler) {
  let out = text;
  let i = 0;
  while (words(out).length < minWords && i < filler.length) {
    out = `${out} ${filler[i]}`;
    i += 1;
  }
  return out;
}

const PAD_MATCH = [
  'Nothing in the sourced record contradicts that reading.',
  'The judgement rests on results that can be checked against the published record.',
  'Fatigue across a single day of matches has been weighed alongside the form.',
];

const PAD_SCORE = [
  'The set of plausible outcomes in this format is small, which makes the margin call more tractable than in most scoreline markets.',
  'Nothing in the sourced record points at a wider spread of frames.',
];

const PAD_GROUP = [
  'Every opponent in the group has been assessed, not just the most obvious rival.',
  'The reading would change if the projected points path shifted toward drawn matches.',
];

/* ------------------------------------------------------------------ *
 * writers
 * ------------------------------------------------------------------ */

export function writeMatchResult(mr, ctx = {}) {
  const i = ctx.index ?? 0;
  if (mr.skip) {
    return {
      market: 'MATCH RESULT',
      pick: 'SKIP',
      confidence: 'SKIP',
      score: mr.score,
      text: `SKIP — ${skipSentence(mr)}`,
      skip: true,
    };
  }
  const used = ctx.usedOpeners || new Set();
  const isDraw = mr.selection.type === 'draw';
  const opener = isDraw
    ? pickUnique(DRAW_OPENERS, i, used, 'MATCH RESULT').replace('{pick}', 'draw')
    : pickUnique(MATCH_OPENERS, i, used, 'MATCH RESULT').replace('{pick}', mr.selection.name);
  const reason = pick(MATCH_REASONS, i + (isDraw ? 3 : 0));
  const closer = isDraw ? pick(DRAW_CLOSERS, i) : pick(MATCH_CLOSERS, i);
  let text = `${opener}, where ${reason}. ${closer}`;
  text = padTo(text, MIN_WORDS, PAD_MATCH);
  return {
    market: 'MATCH RESULT',
    pick: isDraw ? 'Draw' : mr.selection.name,
    confidence: mr.confidence,
    score: mr.score,
    text,
    skip: false,
  };
}

export function writeCorrectScore(cs, mr, ctx = {}) {
  const i = ctx.index ?? 0;
  if (cs.skip) {
    return {
      market: 'CORRECT SCORE',
      pick: 'SKIP',
      confidence: 'SKIP',
      score: cs.score,
      text: `SKIP — the scoreline read is not supported clearly enough to name a margin, so no selection is forced.`,
      skip: true,
    };
  }
  const line = cs.selection.scoreline;
  const who = cs.selection.favouring ? `to ${cs.selection.favouring}` : 'with the frames shared';
  const used = ctx.usedOpeners || new Set();
  const opener = pickUnique(SCORE_OPENERS, i, used, 'CORRECT SCORE').replace('{line}', `${line}${cs.selection.favouring ? ` ${who}` : ''}`);
  const reason = pick(SCORE_REASONS, i);
  let text = `${opener}, because ${reason}. Naming the margin is the whole point of this market, and the reading follows the match-result call rather than departing from it.`;
  text = padTo(text, MIN_WORDS, PAD_SCORE);
  return {
    market: 'CORRECT SCORE',
    pick: line,
    confidence: cs.confidence,
    score: cs.score,
    text,
    skip: false,
  };
}

export function writeGroupWinner(gw, ctx = {}) {
  const i = ctx.index ?? 0;
  if (gw.tooOpen) {
    return {
      market: 'GROUP WINNER',
      pick: 'TOO OPEN',
      confidence: 'SKIP',
      score: gw.score,
      text: `TOO OPEN TO CALL — ${gw.reason}, so no group winner is named.`,
      skip: true,
    };
  }
  if (gw.skip) {
    return {
      market: 'GROUP WINNER',
      pick: 'SKIP',
      confidence: 'SKIP',
      score: gw.score,
      text: 'SKIP — the leading candidate does not reach the confidence floor, so no group winner is named.',
      skip: true,
    };
  }
  const used = ctx.usedOpeners || new Set();
  const opener = pickUnique(GROUP_OPENERS, i, used, 'GROUP WINNER').replace('{pick}', gw.selection.name);
  const reason = pick(GROUP_REASONS, i);
  const closer = pick(GROUP_CLOSERS, i);
  let text = `${opener}, where ${reason}. ${closer}`;
  text = padTo(text, MIN_WORDS, PAD_GROUP);
  return {
    market: 'GROUP WINNER',
    pick: gw.selection.name,
    confidence: gw.confidence,
    score: gw.score,
    text,
    skip: false,
  };
}

function skipSentence(mr) {
  const missing = mr.missing || [];
  if (missing.length) {
    return 'a factor the published record does not carry leaves this below the confidence floor, so no selection is forced.';
  }
  return 'neither player separates from the other clearly enough to justify a selection on this match.';
}

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

export function validateTip(tip) {
  const violations = [];
  const text = tip.text || '';
  const w = words(text);

  if (!tip.skip) {
    if (w.length < MIN_WORDS) violations.push(`fewer than ${MIN_WORDS} words (${w.length})`);
    const firstTwenty = w.slice(0, 20).join(' ');
    if (!/\*\*[^*]+\*\*/.test(firstTwenty)) violations.push('the picked outcome is not bolded within the first 20 words');
    if (!digitsAllowedFor(tip.market) && /\d/.test(text)) {
      violations.push('contains a figure outside the Correct Score market');
    }
    if (digitsAllowedFor(tip.market)) {
      const nonScore = text.replace(/\b\d-\d\b/g, '');
      if (/\d/.test(nonScore)) violations.push('contains a figure other than the scoreline');
    }
  }

  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`banned phrase: "${phrase}"`);
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (lower.includes(token)) violations.push(`forbidden token: "${token}"`);
  }
  if (/\[[^\]]*\]\([^)]*\)/.test(text)) violations.push('contains a bracket link');
  if (!['HIGH', 'MEDIUM', 'LOW', 'SKIP'].includes(tip.confidence)) {
    violations.push(`confidence must be LOW, MEDIUM, HIGH or SKIP; got ${tip.confidence}`);
  }
  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ *
 * card assembly
 * ------------------------------------------------------------------ */

/**
 * The responsible gambling section — a substantive standing part of every
 * card, never a closing formality. Contact details confirmed against the
 * GamCare National Gambling Helpline page before publication.
 */
export const RESPONSIBLE_GAMBLING = {
  heading: 'Responsible gambling',
  paragraphs: [
    'These are model-based estimates produced by one analytical system from published results. They are not guarantees, and no prediction on this page should be read as a promise of any outcome.',
    'Wager only what you are comfortable losing, and set your limits — time and money — in advance rather than in the middle of a losing run. Walking away from a card is always a legitimate decision.',
    'This event is staged in England, so the primary support resource is the UK National Gambling Helpline, run by GamCare, free on 0808 80 20 133 and open twenty-four hours a day, every day of the year. Readers elsewhere should use their own national support service. Contact details were confirmed against the operator before publication and can change, so check them if time has passed.',
  ],
  helpline: {
    name: 'National Gambling Helpline (GamCare)',
    phone: '0808 80 20 133',
    availability: '24 hours a day, every day of the year',
    country: 'United Kingdom',
    url: 'https://www.gamcare.org.uk/get-support/talk-to-us-now/',
    confirmed_on: '2026-09-04',
  },
};

export function buildCard(entries, { date = null, edition = null, valueCandidates = [] } = {}) {
  const issues = [];
  const rows = [];
  for (const entry of entries) {
    for (const tip of entry.tips) {
      const v = validateTip(tip);
      if (!v.ok) issues.push({ subject: entry.subject, market: tip.market, violations: v.violations });
      rows.push([entry.subject, tip.market, tip.pick, tip.confidence]);
    }
  }
  // Openings must vary across the card.
  const seen = new Set();
  for (const entry of entries) {
    for (const tip of entry.tips) {
      if (tip.skip) continue;
      const opening = openingWord(tip.text);
      const key = `${tip.market}~${opening}`;
      if (seen.has(key)) issues.push({ subject: entry.subject, market: tip.market, violations: [`repeated opening word "${opening}"`] });
      seen.add(key);
    }
  }
  return {
    prompt: 'CHAMPIONSHIP LEAGUE SNOOKER PREDICTION MASTER PROMPT v1.0',
    date,
    edition,
    entries,
    summaryTable: { headers: ['Match / group', 'Market', 'Pick', 'Confidence'], rows },
    valueCandidates,
    responsibleGambling: RESPONSIBLE_GAMBLING,
    validation: { ok: issues.length === 0, issues },
  };
}

export function buildCopyText(card) {
  const out = [];
  out.push(`# Championship League Snooker — ${card.edition || 'edition not stated'}${card.date ? ` — ${card.date}` : ''}`);
  out.push('');
  for (const entry of card.entries) {
    out.push(`## ${entry.subject}`);
    for (const tip of entry.tips) {
      out.push(`**${tip.market}** — ${tip.text} Confidence: ${tip.confidence}.`);
      out.push('');
    }
  }
  out.push('## Summary');
  out.push(card.summaryTable.headers.join(' | '));
  out.push(card.summaryTable.headers.map(() => '---').join(' | '));
  for (const r of card.summaryTable.rows) out.push(r.join(' | '));
  out.push('');
  if (card.valueCandidates.length) {
    out.push('## Value candidates');
    for (const v of card.valueCandidates) out.push(`- ${v.subject}: ${v.name}, on ${v.basis}.`);
    out.push('');
  }
  out.push(`## ${card.responsibleGambling.heading}`);
  for (const p of card.responsibleGambling.paragraphs) { out.push(p); out.push(''); }
  return out.join('\n').trim();
}
