/**
 * SportsPred — Formula 1 Prediction Writer and Output Validator.
 *
 * Implements Step 4 of "F1 GRAND PRIX PREDICTION MASTER PROMPT v1.0":
 *  - Five categories: RACE WINNER (up to 3), PODIUM FINISH (up to 3),
 *    FASTEST LAP, POINTS FINISH, TOP 6 FINISH.
 *  - Every tip: 40+ words, bolded outcome in the first 20 words, no digits,
 *    no odds, no source names, no links, no social media, unique opener.
 *  - SKIPped categories are written exactly as "NO SELECTION" + one sentence.
 *  - Confidence (LOW/MEDIUM/HIGH) declared on every tip.
 *  - Card ends with a summary table, weather impact note and RG reminder.
 *  - Max 6 active selections per weekend (Step 3 profitability rules).
 */

import { CONFIDENCE, RULESET_VERSION, PROMPT_VERSION } from './f1_engine.js';

export const MIN_WORDS = 40;
export const MAX_SELECTIONS = 6;

export const BANNED_PHRASES = [
  'the faster car',
  'should be on the podium',
  'hard to look past',
  'on current form',
  'it would be a surprise',
  'the class of the field',
  'could go either way',
  'both drivers',
];

export const FORBIDDEN_TOKENS = [
  'http', 'https', 'www.', '@', 'twitter', 'x.com', 'instagram', 'facebook',
  'olbg', 'espn', 'bet365', 'bookmaker', 'odds', 'price', 'stake', 'betting market',
  'handicap', 'over/under', 'safety car probability', 'upgrade kit',
];

export const MARKET_LABEL = {
  race_winner: 'RACE WINNER',
  podium_finish: 'PODIUM FINISH',
  fastest_lap: 'FASTEST LAP',
  points_finish: 'POINTS FINISH (TOP 10)',
  top6_finish: 'TOP 6 FINISH',
};

/** Distinct opening lines — one per tip in a card. */
export const F1_OPENERS = [
  'A qualifying storm has been building for this driver all summer, and',
  'Racecraft under pressure is where this competitor separates himself,',
  'Championship pressure sharpens this weekend, and',
  'Circuit-specific pedigree points strongly toward one name,',
  'Teammate battles reveal the truth of a car, and',
  'Podium talk begins with a driver who',
  'Looking beyond the headlines, the data favours a driver who',
  'A weekend like this rewards the boldest tyre call,',
  'Track position remains king here, a reality that',
  'Momentum rarely lies, and this driver arrives with',
  'The midfield fight deserves attention because',
  'Low-downforce confidence defines this venue,',
  'Every detail of the qualifying battle matters, so',
  'Reliability so often decides the closing rounds,',
  'A driver who masters the traffic is the one to watch here,',
  'The constructor recent trajectory cannot be ignored;',
  'Home-soil emotion can tip a tight contest, and',
  'While the favourites attract attention,',
  'Strategy depth from the pit wall suggests',
  'Lap one composure sets the tone for the afternoon,',
];

export function validateF1Tip(text, { expectSkip = false } = {}) {
  const violations = [];
  const t = String(text || '').trim();
  if (!t) return { ok: false, violations: ['empty tip text'] };

  if (expectSkip) {
    if (!/^NO SELECTION\b/.test(t)) violations.push('SKIP tip must begin with NO SELECTION');
    // A trailing "Confidence: LOW." is allowed; the explanatory sentence is the body.
    const body = t.replace(/\s*Confidence:\s*(LOW|MEDIUM|HIGH)\.?\s*$/i, '').trim();
    const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) violations.push('SKIP tip must be a single explanatory sentence');
    if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/.test(t)) violations.push('confidence not declared');
    return { ok: violations.length === 0, violations };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words (found ${words.length})`);

  if (!/\*\*[^*]+\*\*/.test(t)) {
    violations.push('no bolded outcome found');
  } else {
    const before = t.slice(0, t.indexOf('**')).split(/\s+/).filter(Boolean).length;
    if (before > 20) violations.push(`bolded outcome after 20 words (at word ${before})`);
  }

  const digits = t.replace(/\*\*/g, '').match(/\d/g);
  if (digits) violations.push(`contains forbidden numerals: ${digits.join('')}`);

  if (/[()[\]{}]/.test(t)) violations.push('contains bracketed references');

  const lower = t.toLowerCase();
  for (const phrase of BANNED_PHRASES) if (lower.includes(phrase)) violations.push(`banned phrase: "${phrase}"`);
  for (const token of FORBIDDEN_TOKENS) if (lower.includes(token)) violations.push(`forbidden token: "${token}"`);

  if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/.test(t)) violations.push('confidence not declared');
  return { ok: violations.length === 0, violations };
}

/** Qualitative renderer — maps verified numeric facts to word-safe prose. */
function factClauses(profile, ctx) {
  const out = [];
  const p = profile || {};
  const last5 = p.last5 || [];
  if (p.last5Wins >= 1) out.push('recent winning form in the closing rounds');
  else if (p.last5Podiums >= 1) out.push('consistent podium presence in recent races');
  else if (p.last5Points >= 1) out.push('regular points scorer in recent races');
  if ((p.outqualified?.wins ?? 0) >= 3 && (p.outqualified?.total ?? 0) >= 4) {
    out.push('a clear qualifying edge over his teammate');
  }
  if ((p.trackWins ?? 0) >= 1) out.push('victory pedigree at this exact venue');
  else if ((p.trackPodiums ?? 0) >= 1) out.push('past podium finishes at this exact venue');
  else if ((p.trackPoints ?? 0) >= 1) out.push('points-scoring history at this exact venue');
  if (p.championshipRank === 1) out.push('the championship lead');
  else if (p.championshipRank != null && p.championshipRank <= 3) out.push('a leading championship position');
  if (p.fastestLapHistory?.length) out.push('a fastest lap at this circuit');
  if (!out.length) out.push('sourced form and history data');
  return out;
}

function confidenceSentence(band) {
  if (band === CONFIDENCE.HIGH) return 'Confidence: HIGH.';
  if (band === CONFIDENCE.MEDIUM) return 'Confidence: MEDIUM.';
  return 'Confidence: LOW.';
}

function composedTip({ market, label, profile, band, openerIdx, ctx }) {
  const facts = factClauses(profile, ctx);
  const factText = facts.slice(0, 2).join(', and ');
  const opener = F1_OPENERS[openerIdx % F1_OPENERS.length];
  const name = profile?.name || 'this driver';
  const angle = market === 'race_winner'
    ? 'the strongest claim to the race win'
    : market === 'podium_finish'
      ? 'the soundest podium claim'
      : market === 'fastest_lap'
        ? 'the most credible fastest-lap candidate'
        : market === 'points_finish'
          ? 'the safest points-finish selection'
          : 'the most dependable top-six finisher';
  const text =
    `${opener} **${name}** carries ${factText}. The case rests on sourced race data, ` +
    `not reputation: the pattern above repeats across the rounds that matter. ` +
    `That makes ${name} ${angle} for this Grand Prix, with the conditions and ` +
    `the venue both supporting the argument. ${confidenceSentence(band)}`;
  return { text, ok: true, violations: [], band, market: label, name, skip: false };
}

function skipTip(label, reason) {
  return {
    text: `NO SELECTION ${reason} Confidence: LOW.`,
    ok: true,
    violations: [],
    band: CONFIDENCE.SKIP,
    market: label,
    name: null,
    skip: true,
  };
}

/** Reasons paraphrased from the engine's missing[] without internal detail. */
function skipReasonFor(missing) {
  const m = missing || [];
  const joined = m.join(' ');
  if (joined.includes('strategy') || joined.includes('fastestLapStrategy')) {
    return 'The fastest-lap market requires specific tyre-strategy evidence that is not openly published, so no selection is made.';
  }
  if (joined.includes('odds')) {
    return 'No driver reaches the scoring threshold because priced market data is unavailable, so no selection is made.';
  }
  return 'No driver reaches the scoring threshold on the sourced data available, so no selection is made.';
}

/**
 * Write the five-category card for one race.
 *
 * @param {object} scored  result of scoreF1Race
 * @param {object} event   parsed event metadata (name, dates, weather)
 * @returns {object} { tips, summary, cardText }
 */
export function writeF1RaceCard(scored, event) {
  const tips = [];
  const markets = scored?.markets || {};
  const order = ['race_winner', 'podium_finish', 'fastest_lap', 'points_finish', 'top6_finish'];
  let openerIdx = 0;

  for (const key of order) {
    const m = markets[key];
    const label = MARKET_LABEL[key];
    if (!m || m.band === CONFIDENCE.SKIP || !m.selection) {
      tips.push(skipTip(label, skipReasonFor(m?.missing)));
      continue;
    }
    // One selection per category in the written card ("up to 3" is a ceiling:
    // the Step 3 max-6 rule and the five-category output table both assume one
    // headline pick per category; runner-up candidates stay on the scoreboard).
    const c = (m.candidates || []).find((x) => x.band !== CONFIDENCE.SKIP);
    if (!c) {
      tips.push(skipTip(label, skipReasonFor(m.missing)));
      continue;
    }
    const profile = { name: c.name, team: c.team, ...(c.profile || {}) };
    tips.push(composedTip({ market: key, label, profile, band: c.band, openerIdx, ctx: event }));
    openerIdx += 1;
  }

  return { tips, event };
}

/** Summary table + weather note + RG footer (card-level text). */
export function buildF1CardText(written, event) {
  const rows = (written?.tips || []).map((t) => {
    const name = t.skip ? 'NO SELECTION' : t.name;
    return `| ${t.market} | ${name} | ${t.band} |`;
  }).join('\n');
  const weather = event?.weather?.precipProbPct != null && event.weather.precipProbPct >= 30
    ? `Weather impact: rain probability is high for the race window; all selections should be treated as weather-dependent.`
    : `Weather impact: no material rain risk is forecast for the race window.`;
  const active = (written?.tips || []).filter((t) => !t.skip).length;
  return [
    `Formula 1 — ${event?.name || 'Grand Prix'} — Prediction Card`,
    ``,
    `| Category | Selection | Confidence |`,
    `|---|---|---|`,
    rows,
    ``,
    weather,
    ``,
    `Active selections this weekend: ${active} (max ${MAX_SELECTIONS}).`,
    `Responsible Gambling. Nothing here is betting advice. Predictions are generated mechanically from sourced data and are fallible. 18+.`,
  ].join('\n');
}

/** Validate a whole written card: every tip passes, openers are unique. */
export function validateF1Card(written) {
  const issues = [];
  const openers = new Set();
  for (const t of written?.tips || []) {
    const v = validateF1Tip(t.text, { expectSkip: t.skip });
    if (!v.ok) issues.push({ market: t.market, violations: v.violations });
    if (!t.skip) {
      const word = t.text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (openers.has(word)) issues.push({ market: t.market, violations: [`duplicate opener: "${word}"`] });
      openers.add(word);
    }
  }
  const active = (written?.tips || []).filter((t) => !t.skip).length;
  if (active > MAX_SELECTIONS) issues.push({ violations: [`more than ${MAX_SELECTIONS} active selections`] });
  return { ok: issues.length === 0, issues };
}
