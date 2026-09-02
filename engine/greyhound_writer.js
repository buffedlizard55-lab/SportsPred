/**
 * SportsPred — Greyhound Prediction Writer and Output Validator.
 *
 * Implements Step 4 and the style rules of "GREYHOUND RACING PREDICTION
 * MASTER PROMPT v1.0":
 *   - one WIN RACE tip per selected race,
 *   - winner bolded and identifiable inside the first twenty words,
 *   - minimum forty words, LOW / MEDIUM / HIGH confidence on every tip,
 *   - no odds, prices, figures, source names, links or citation brackets,
 *   - no staking, sizing or risk language, no tipster or social references,
 *   - nothing negative about rivals — the case is for the selection only,
 *   - every tip opens differently and argues from a different angle
 *     (trap draw, distance specialism, grade drop, recent momentum,
 *     course experience),
 *   - unselected races are marked NO SELECTION with one explanatory line,
 *   - the day ends with the summary table and the responsible-gambling
 *     reminder.
 *
 * Internal data (scores, breakdowns, prices, sources, sentiment) never leaves
 * this module in prose; only qualitative clauses derived from scored
 * components do. The validator enforces every rule above and a failing tip is
 * withheld rather than published.
 */

import { CONFIDENCE } from './greyhound_engine.js';

export const MIN_WORDS = 40;
export const NAME_WITHIN_WORDS = 15; // prompt: obvious within first 20 words

export const BANNED_PHRASES = [
  'this dog', 'this runner', 'looks likely', 'should win', 'could be the one',
  'hard to beat', 'in good form',
];

export const FORBIDDEN_TOKENS = [
  'http', 'www.', '@', 'twitter', 'x.com', 'instagram', 'facebook',
  'olbg', 'gbgb', 'sporting life', 'timeform', 'tipster',
  'odds', 'price', 'stake', 'staking', 'each-way', 'each way', 'units',
  'bet ', 'risks', 'risk management', 'sentiment',
];

/**
 * Distinct openers — a different starting word, structure and analytical
 * angle for each. {name} is replaced by the bolded dog name so the winner is
 * identifiable from the opening clause.
 */
export const OPENERS = [
  'Trap-wise the standout is **{name}**, whose record from this box gives',
  'Over this trip **{name}** does the best work in the field, bringing',
  'Dropping through the grades suits **{name}**, who arrives with',
  'Momentum is everything in this code, and **{name}** arrives with',
  'Course experience counts heavily here, which points to **{name}**, who has',
  'Early pace is the theme of this heat, and **{name}** supplies',
  'Draw-wise a rail-running type is wanted, which suits **{name}**, whose',
  'Back-to-back efforts of this quality are rare in this grade, so **{name}** stands out with',
  'Steady progression through recent weeks puts **{name}** ahead of the field, offering',
  'Course-proven credentials anchor the case for **{name}**, who brings',
  'Clear-air racing from the boxes is what **{name}** thrives on, with',
  'Class relief favours the dropper in this line-up, **{name}**, whose',
  'Few in the race arrive as fresh and sharp as **{name}**, showing',
  'Sectional speed points one way here, towards **{name}**, whose',
  'Rails to middle, **{name}** owns the running style this track rewards, with',
  'Pace-map logic favours a fast breaker, and **{name}** has shown',
  'Consistency rather than flash carries **{name}** into this race, built on',
  'Wide-seeded and at home in the outer boxes, **{name}** brings',
  'Recent winning times give **{name}** the edge, underlined by',
  'Up in class but not outclassed, **{name}** arrives with',
  'Familiar-jacket value should not be underestimated here, and **{name}** has',
  'Straight-line speed is what wins these heats, and **{name}** offers',
  'Clock-watchers will side with **{name}**, whose',
  'Home-straight stamina tells at this distance, and **{name}** keeps producing',
  'Box-to-wire speed decides the majority of these heats, which is why **{name}** appeals, with',
];

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

export function validateGreyhoundTip(text, { expectSkip = false, forbiddenNames = [] } = {}) {
  const violations = [];
  const t = String(text || '').trim();
  if (!t) return { ok: false, violations: ['empty tip text'] };

  if (expectSkip) {
    if (!/^NO SELECTION\b/.test(t)) violations.push('SKIP tip must begin with NO SELECTION');
    const body = t.replace(/^NO SELECTION\s*[—-]?\s*/i, '').replace(/\s*Confidence:\s*(LOW|MEDIUM|HIGH)\.?\s*$/i, '').trim();
    const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length !== 1) violations.push('SKIP tip must be exactly one explanatory sentence');
    if (!/Confidence:\s*(LOW|MEDIUM|HIGH)\.?/i.test(t)) violations.push('confidence not declared');
    return { ok: violations.length === 0, violations };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words (found ${words.length})`);

  if (!/\*\*[^*]+?\*\*/.test(t)) {
    violations.push('no bolded dog name found');
  } else {
    const before = t.slice(0, t.indexOf('**')).split(/\s+/).filter(Boolean).length;
    if (before >= NAME_WITHIN_WORDS) violations.push(`bolded name after ${NAME_WITHIN_WORDS} words (at word ${before + 1})`);
  }

  const digits = t.replace(/\*\*[^*]+?\*\*/g, '').match(/\d/g);
  if (digits) violations.push(`contains forbidden numerals: ${[...new Set(digits)].join('')}`);
  if (/[()[\]{}]/.test(t)) violations.push('contains bracketed references');
  if (/[%$£€]/.test(t)) violations.push('contains a figure symbol');

  const lower = t.toLowerCase();
  for (const phrase of BANNED_PHRASES) if (lower.includes(phrase)) violations.push(`banned phrase: "${phrase}"`);
  for (const token of FORBIDDEN_TOKENS) if (lower.includes(token)) violations.push(`forbidden token: "${token}"`);
  for (const name of forbiddenNames || []) {
    // Track / venue names must not leak into prose; dog names are expected.
    const n = String(name || '').trim().toLowerCase();
    if (n.length < 4) continue;
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) violations.push(`names a venue or source: "${name}"`);
  }
  if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/i.test(t)) violations.push('confidence not declared');
  return { ok: violations.length === 0, violations };
}

/** Whole-card validation: tips pass, openings unique, summary present. */
export function validateGreyhoundCard(written) {
  const issues = [];
  const firstWords = new Set();
  const firstThree = new Set();
  const venueNames = written?.venues || [];
  for (const t of written?.tips || []) {
    const v = validateGreyhoundTip(t.text, { expectSkip: t.skip, forbiddenNames: t.skip ? [] : venueNames });
    if (!v.ok) issues.push({ raceId: t.raceId, dog: t.name, violations: v.violations });
    if (t.skip) continue;
    const ws = t.text.trim().split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));
    const w1 = ws[0];
    const w3 = ws.slice(0, 3).join(' ');
    if (firstWords.has(w1)) issues.push({ raceId: t.raceId, dog: t.name, violations: [`duplicate opening word: "${w1}"`] });
    if (firstThree.has(w3)) issues.push({ raceId: t.raceId, dog: t.name, violations: [`duplicate opening phrase: "${w3}"`] });
    firstWords.add(w1); firstThree.add(w3);
  }
  if (!written?.summaryTable) issues.push({ violations: ['summary table missing'] });
  if (!written?.responsibleGambling) issues.push({ violations: ['responsible gambling reminder missing'] });
  return { ok: issues.length === 0, issues };
}

/* ------------------------------------------------------------------ *
 * qualitative clauses
 * ------------------------------------------------------------------ */

function pts(c, id) {
  return (c.components || []).find((x) => x.id === id)?.points ?? 0;
}
function has(c, id) {
  return (c.components || []).some((x) => x.id === id && Number(x.points) > 0);
}

function factClauses(c) {
  const out = [];
  const form = pts(c, 'form');
  if (form >= 35) out.push('a winning record among recent starts with placed runs surrounding it');
  else if (form >= 22) out.push('a string of placed efforts in recent weeks');
  else if (form >= 15) out.push('a win and placed form inside the last handful of runs');
  else if (form >= 8) out.push('placed form in recent starts');
  if (has(c, 'form_last_win')) out.push('a winning effort last time out');
  if (has(c, 'form_hot')) out.push('more than one win from the last three runs');
  if (has(c, 'form_recent2')) out.push('placed efforts on both of the last two appearances');

  const trap = pts(c, 'trap');
  if (trap >= 20) out.push('a proven winning record from this exact trap');
  else if (trap >= 12) out.push('placed form from this trap in previous runs');
  if (has(c, 'dist_match')) out.push('a latest win over today\u2019s exact distance');
  if (has(c, 'dist_specialist')) out.push('repeated wins over this trip marking the runner as a distance specialist');

  const tg = pts(c, 'track_grade');
  if (tg >= 20) out.push('a winning record at the venue racing at no higher a level than today');
  else if (tg >= 13) out.push('placed course form at a comparable grade');
  else if (tg === 8) out.push('the respite of a drop in class for a runner still learning the venue');
  if (pts(c, 'grade_rise_pen') < 0) out.push('a class rise that asks a real question');

  if (!out.length) out.push('a sourced record that reads marginally better than the rest of the field');
  return [...new Set(out)];
}

function cautionClauses(c) {
  const out = [];
  if (pts(c, 'grade_rise_pen') < 0) out.push('the step up in class is the obvious caveat');
  if ((c.missing || []).some((m) => m.includes('track form'))) out.push('course experience is still light');
  if ((c.missing || []).some((m) => m.includes('distance form'))) out.push('the trip is slightly unproven');
  if (c.oddsMissing) out.push('the market evidence is not part of this read, so the grade is held back');
  return out;
}

function confidenceSentence(band) {
  if (band === CONFIDENCE.HIGH) return 'Confidence: HIGH.';
  if (band === CONFIDENCE.MEDIUM) return 'Confidence: MEDIUM.';
  return 'Confidence: LOW.';
}

function joinList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

const ANGLES = [
  (n) => `Put it together and ${n} owns the profile this kind of race rewards, with every edge pointing the same way.`,
  (n) => `Those strands combine to make ${n} the strongest win claim in the heat, built on evidence rather than reputation.`,
  (n) => `That is the package that wins races at this level, and ${n} brings it to the traps tonight.`,
  (n) => `Nothing in the sourced form suggests the run is a fluke, which is why ${n} gets the vote.`,
  (n) => `When the boxes open ${n} has the clearest path to the front, and front-runners at this track are hard to reel in.`,
  (n) => `Races of this shape usually fall to the runner with repeatable figures, and ${n} is that runner.`,
];

function composeTip({ candidate, band, openerIdx, angleIdx }) {
  const name = candidate.name;
  const opener = OPENERS[openerIdx % OPENERS.length].replace('{name}', name);
  const facts = factClauses(candidate).slice(0, 3);
  const angle = ANGLES[angleIdx % ANGLES.length](name);
  const cautions = cautionClauses(candidate);
  const caution = cautions.length ? ` The one reservation: ${cautions[0]}.` : '';
  let text = `${opener} ${joinList(facts)}. ${angle}${caution} ${confidenceSentence(band)}`.replace(/\s+/g, ' ').trim();
  if (text.split(/\s+/).length < MIN_WORDS) {
    text = text.replace(/\s*Confidence:[^.]*\.?\s*$/, '') +
      ' The read comes entirely from completed official runs rather than reputation, and it holds up across every angle this race turns on. ' +
      confidenceSentence(band);
  }
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    raceId: candidate.raceId,
    track: candidate.track,
    time: candidate.time,
    name,
    trap: candidate.trap,
    band,
    score: candidate.score,
    skip: false,
  };
}

function skipTip(race) {
  const reasons = race.decision?.reasons || [];
  let reason;
  if (reasons.some((r) => r.includes('below 55'))) reason = 'no runner clears the minimum form threshold for a win selection.';
  else if (reasons.some((r) => r.includes('placed runs'))) reason = 'the market leaders lack the placed recent runs the method requires.';
  else if (reasons.some((r) => r.includes('core categories'))) reason = 'the sourced evidence is too thin across trap, distance and grade factors.';
  else reason = 'none of the field meets the selection criteria for this heat.';
  return {
    text: `NO SELECTION — ${reason} Confidence: LOW.`.replace(/\s+/g, ' ').trim(),
    raceId: race.raceId, track: race.track, time: race.time,
    name: null, trap: null, band: CONFIDENCE.SKIP, score: null, skip: true,
  };
}

/**
 * Write the day's card. `card` is the output of buildDailyCard(): races with
 * winner, decision and cardSelected flags.
 */
export function writeGreyhoundCard(card, { date = null } = {}) {
  const races = card.races || [];
  const venues = [...new Set(races.map((r) => String(r.track || '').trim()).filter(Boolean))];
  const tips = [];
  let openerIdx = 0;
  let angleIdx = 0;
  for (const race of races) {
    if (race.cardSelected && race.winner && race.decision?.action === 'SELECT') {
      const candidate = { ...race.winner, raceId: race.raceId, track: race.track, time: race.time };
      tips.push(composeTip({ candidate, band: race.decision.confidence, openerIdx: openerIdx++, angleIdx: angleIdx++ }));
    } else {
      tips.push(skipTip(race));
    }
  }

  const tableRows = tips
    .filter((t) => !t.skip)
    .map((t) => ({ track: t.track, time: t.time, selection: t.name, trap: t.trap, confidence: t.band }));

  const summaryTable = {
    headers: ['Track', 'Race time', 'Selection', 'Trap', 'Confidence'],
    rows: tableRows,
  };

  const responsibleGambling =
    'Predictions are generated mechanically from official form data and are fallible. Nothing here is betting advice or a guarantee of any outcome. Please gamble responsibly — 18+.';

  return { date, venues, tips, summaryTable, responsibleGambling };
}
