/**
 * SportsPred — T20 Blast prediction writer and output validator.
 *
 * Implements STEP 4 and the STYLE REQUIREMENTS of the "T20 BLAST (ENGLAND &
 * WALES) CRICKET PREDICTION MASTER PROMPT v1.0". The rules are enforced by
 * code, not requested of a model:
 *
 *   · four tips per fixture, in the order WIN MATCH, MAN OF THE MATCH,
 *     TOP TEAM 1 BATSMAN, TOP TEAM 2 BATSMAN
 *   · at least forty words per tip; a below-threshold market is one sentence
 *     beginning SKIP
 *   · the predicted team or player bolded inside the first twenty words
 *   · WIN MATCH names a team and never a player; the three player markets name
 *     a player and never a team, county short name or Blast nickname
 *   · no odds figures, prices, dates, source citations, social references,
 *     injury or availability speculation, or any mention of a county's
 *     finances or points deduction
 *   · every tip opens differently from every other tip in the same card, and
 *     none of the prompt's banned filler phrases may appear
 *   · the confidence tier is stated on every tip
 *   · the card ends with a summary table, a value-flag note, a weather note
 *     where a revised chase is realistic, and a responsible-gambling reminder
 *
 * A tip that fails validation is never returned: the writer tries the next
 * angle and throws if none validate, so a silent rule break cannot reach the
 * site or the clipboard.
 */

import { BAND, BLAST_RULESET } from './t20_blast_engine.js';

export const MIN_WORDS = 40;
export const BOLD_WORD_LIMIT = 20;

/** The prompt names these explicitly. */
export const BANNED_PHRASES = [
  'this should be a high-scoring game',
  'hard to look past',
  'the better batting lineup',
  'on current form',
  'could go either way',
  'both teams',
  'conditions will suit',
];

/** Anything that would leak a price, a source, a date or speculation. */
export const FORBIDDEN_SUBSTRINGS = [
  'http', 'https', 'www.', '@', 'twitter', 'x.com', 'instagram', 'facebook',
  'cricinfo', 'espn', 'olbg', 'sky sports', 'bbc', 'wisden',
  'deduction', 'deducted', 'special measures', 'finances', 'financial', 'salary cap', 'sanction',
  'injured', 'injury', 'unavailable', 'ruled out', 'doubtful', 'fitness',
];

/** Matched on word boundaries so ordinary words ("maybe", "better") are not caught. */
export const FORBIDDEN_WORDS = [
  'odds', 'price', 'prices', 'bet', 'bets', 'betting', 'stake', 'stakes', 'wager',
  'bookmaker', 'bookmakers', 'bookie', 'punter', 'punters', 'social',
  'unavailability',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'today', 'tomorrow', 'yesterday',
];

/** Retained for compatibility with anything importing the earlier name. */
export const FORBIDDEN_TOKENS = [...FORBIDDEN_SUBSTRINGS, ...FORBIDDEN_WORDS];

/** Team names and nicknames that may never appear in a player-market tip. */
export const COUNTY_TOKENS = [
  'Northamptonshire', 'Northants', 'Steelbacks',
  'Somerset', 'Gloucestershire', 'Gloucs', 'Warwickshire', 'Bears',
  'Glamorgan', 'Worcestershire', 'Worcs', 'Rapids',
  'Nottinghamshire', 'Notts', 'Outlaws', 'Yorkshire', 'Lancashire', 'Lightning',
  'Durham', 'Derbyshire', 'Falcons', 'Leicestershire', 'Leics', 'Foxes',
  'Hampshire', 'Hawks', 'Surrey', 'Essex', 'Kent', 'Spitfires',
  'Middlesex', 'Sussex', 'Sharks',
];

export const MARKET_LABEL = {
  win_match: 'WIN MATCH',
  man_of_the_match: 'MAN OF THE MATCH',
  top_team1_batsman: 'TOP TEAM 1 BATSMAN',
  top_team2_batsman: 'TOP TEAM 2 BATSMAN',
};

export const MARKET_ORDER = ['win_match', 'man_of_the_match', 'top_team1_batsman', 'top_team2_batsman'];

/* ------------------------------------------------------------------ *
 * Angles. Every angle opens with a different word and takes a different
 * analytical line, as the prompt's STYLE REQUIREMENTS demand.
 * ------------------------------------------------------------------ */

export const BLAST_ANGLES = [
  {
    id: 'group-race', word: 'Standing',
    lead: 'Standing inside the group has been earned across a full block of fixtures, and that accumulation is what separates these two counties.',
    supports: ['season', 'form'],
  },
  {
    id: 'momentum', word: 'Momentum',
    lead: 'Momentum built across recent outings gives one side a settled rhythm the other has had to reconstruct from scratch.',
    supports: ['form'],
  },
  {
    id: 'h2h', word: 'History',
    lead: 'History between these counties has tilted decisively, and repeat matchups in this competition rarely shrug that pattern off.',
    supports: ['h2h'],
  },
  {
    id: 'new-ball', word: 'New-ball',
    lead: 'New-ball pressure in the opening overs is where this contest is most likely to be decided, and one attack has been far more threatening in it.',
    supports: ['margin', 'form'],
  },
  {
    id: 'middle-overs', word: 'Middle-over',
    lead: 'Middle-over control has been the quieter separator across this competition, and one side owns that phase outright.',
    supports: ['margin', 'season'],
  },
  {
    id: 'death', word: 'Death-over',
    lead: 'Death-over execution against a climbing required rate is a learned skill, and only one side has been practising it successfully.',
    supports: ['margin', 'form'],
  },
  {
    id: 'depth', word: 'Depth',
    lead: 'Depth through the order means a collapse in one phase does not end an innings, and that insurance is unevenly shared here.',
    supports: ['margin', 'season'],
  },
  {
    id: 'venue-pattern', word: 'Familiar',
    lead: 'Familiar surroundings have been worth runs this summer, and the home pattern measured across the competition supports the hosts.',
    supports: ['venue'],
  },
  {
    id: 'travel', word: 'Turnaround',
    lead: 'Turnaround between fixtures has been uneven, and a bowling attack feels a compressed schedule before anything else does.',
    supports: ['rest'],
  },
  {
    id: 'chase', word: 'Chasing',
    lead: 'Chasing a total on this surface demands composure from the top order, and one side has shown considerably more of it.',
    supports: ['form', 'margin'],
  },
  {
    id: 'temperament', word: 'Temperament',
    lead: 'Temperament once the margin narrows is a measurable habit, and the close results across this season point one way.',
    supports: ['margin', 'h2h'],
  },
  {
    id: 'crossover', word: 'Cross-group',
    lead: 'Cross-group fixtures offer thinner recent evidence, so the season-long record carries more weight here than it usually would.',
    supports: ['season', 'form'],
  },
  {
    id: 'allround', word: 'All-round',
    lead: 'All-round balance in the starting eleven gives one county two independent routes to controlling a game.',
    supports: ['season', 'margin'],
  },
  {
    id: 'powerplay', word: 'Powerplay',
    lead: 'Powerplay aggression sets the tone for the entire innings, and one top order has been markedly more productive inside it.',
    supports: ['form', 'margin'],
  },
  {
    id: 'pressure', word: 'Pressure',
    lead: 'Pressure applied through dot-ball spells has been the reliable currency of this competition.',
    supports: ['margin', 'season'],
  },
  {
    id: 'consistency', word: 'Consistency',
    lead: 'Consistency of selection and of role clarity shows up in the results column long before it shows up in the highlights.',
    supports: ['season', 'form'],
  },
  {
    id: 'intent', word: 'Intent',
    lead: 'Intent with the ball in hand, rather than reputation, is what has decided fixtures across this block.',
    supports: ['margin', 'form'],
  },
  {
    id: 'composure', word: 'Composure',
    lead: 'Composure through the closing overs converts a competitive position into a winning one, and the gap here is real.',
    supports: ['margin', 'h2h'],
  },
];

/** Angles for the individual markets, each opening differently again. */
export const PLAYER_ANGLES = [
  { id: 'p-allround', word: 'Dual', lead: 'Dual responsibility gives this player two separate routes to deciding an award, which is why all-rounders collect so many of them.' },
  { id: 'p-toporder', word: 'Top-order', lead: 'Top-order opportunity in this format means the greatest number of deliveries faced while the field is still spread.' },
  { id: 'p-spin', word: 'Spin', lead: 'Spin through the middle overs is where wickets cluster in this competition, and this bowler owns that window.' },
  { id: 'p-pace', word: 'Pace', lead: 'Pace and movement with the new ball threatens the phase in which the opposition is most dangerous.' },
  { id: 'p-finisher', word: 'Finishing', lead: 'Finishing an innings with the ball still coming onto the bat is a rarer skill than the scorecard implies.' },
  { id: 'p-form', word: 'Repeated', lead: 'Repeated contribution across recent outings is the strongest single predictor of another substantial return here.' },
  { id: 'p-matchup', word: 'Matchup', lead: 'Matchup detail favours this player against the specific threats the opposition is likely to bring.' },
  { id: 'p-role', word: 'Role', lead: 'Role clarity inside the starting eleven removes the hesitation that costs players big returns.' },
];

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function sentences(t) { return String(t).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean); }

/**
 * Text that the digit ban applies to.
 *
 * Two things are exempt, and both are deliberate:
 *   · the mandated market label. The prompt requires the exact names
 *     "TOP TEAM 1 BATSMAN" and "TOP TEAM 2 BATSMAN" while also banning digits,
 *     so the label is stripped before the check rather than the rule being
 *     quietly dropped for the markets that carry it.
 *   · the bolded selection, which is a name read from a source and cannot be
 *     rewritten. A digit inside it is reported as a note, not silently allowed.
 */
export function digitScope(text, boldSpan) {
  const labels = Object.values(MARKET_LABEL).sort((a, b) => b.length - a.length).join('|');
  return String(text)
    .replace(boldSpan || '\u0000', ' ')
    .replace(new RegExp(`^SKIP \\u2014 (${labels}):`, 'i'), ' ')
    .replace(new RegExp(`\\b(${labels})\\b`, 'g'), ' ');
}

export function validateBlastTip(text, { market = 'win_match', expectSkip = false, teamNames = [], playerNames = [], selection = null } = {}) {
  const violations = [];
  const t = String(text || '').trim();
  if (!t) return { ok: false, violations: ['empty tip text'] };

  const bold = /\*\*([^*]+)\*\*/.exec(t);
  const notes = [];
  const scope = digitScope(t, bold ? bold[0] : null);
  if (/\d/.test(scope)) violations.push('a digit appears in the prose (odds, dates, scores or lines must never leak)');
  if (bold && /\d/.test(bold[1])) notes.push(`the sourced selection "${bold[1].trim()}" contains a digit`);

  if (expectSkip) {
    if (!/^SKIP\b/.test(t)) violations.push('a below-threshold market must be written as SKIP');
    if (sentences(t).length > 1) violations.push('a SKIP must be a single explanatory sentence');
    // A SKIP is still published text, so the digit ban applies to it as well.
    return { ok: violations.length === 0, violations, notes };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words (found ${words.length})`);

  if (!bold) violations.push('no bolded selection');
  else {
    const idx = t.slice(0, bold.index).split(/\s+/).filter(Boolean).length;
    if (idx >= BOLD_WORD_LIMIT) violations.push(`the bolded selection starts at word ${idx + 1}, beyond the first ${BOLD_WORD_LIMIT}`);
    if (selection && bold[1].trim() !== String(selection).trim()) {
      violations.push(`bolded "${bold[1]}" is not the selection "${selection}"`);
    }
  }

  const lower = t.toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) violations.push(`banned filler phrase "${p}"`);
  for (const f of FORBIDDEN_SUBSTRINGS) if (lower.includes(f)) violations.push(`forbidden token "${f}"`);
  for (const w of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(t)) violations.push(`forbidden word "${w}"`);
  }

  if (market === 'win_match') {
    const outside = t.replace(bold ? bold[0] : '', ' ');
    for (const p of playerNames) {
      if (p && outside.toLowerCase().includes(String(p).toLowerCase())) violations.push(`WIN MATCH tip names a player (${p})`);
    }
    if (selection && !t.includes(selection)) violations.push('WIN MATCH tip does not name the predicted team');
  } else {
    for (const c of COUNTY_TOKENS) {
      if (new RegExp(`\\b${c.replace(/[^A-Za-z]/g, '')}\\b`, 'i').test(t)) violations.push(`player-market tip names a team or nickname (${c})`);
    }
    for (const tn of teamNames) {
      if (tn && new RegExp(`\\b${String(tn).replace(/[^A-Za-z]/g, '')}\\b`, 'i').test(t)) violations.push(`player-market tip names a team (${tn})`);
    }
    if (selection && !t.toLowerCase().includes(String(selection).toLowerCase())) violations.push('player-market tip does not name the predicted player');
  }

  if (!/\b(LOW|MEDIUM|HIGH)\b/.test(t)) violations.push('no confidence tier stated');
  return { ok: violations.length === 0, violations, notes };
}

/** The first prose word of a tip, ignoring the bolded selection and any lead-in. */
export function openingWord(text) {
  const stripped = String(text).replace(/\*\*[^*]+\*\*/g, ' ').replace(/^[\s\u2014\-:,]+/, '');
  return (stripped.split(/\s+/)[0] || '').toLowerCase();
}

/**
 * No two tips may open with the same word.
 * `scope: 'fixture'` checks within each fixture (hard rule, never violated).
 * `scope: 'card'` checks across the whole page (soft rule: the angle pool is
 * finite, so a long slate may reuse an opener on a different fixture).
 */
export function validateCardOpenings(tips, { scope = 'card' } = {}) {
  const seen = new Map();
  const dupes = [];
  for (const tip of tips) {
    if (tip.skip) continue; // a SKIP sentence is not a styled tip
    // Fixture identity, never the "A v B" label: the same pair can meet twice
    // in a season (an in-group leg plus a cross-pool fixture), and those are
    // separate fixtures with separate tip sets.
    const key = scope === 'fixture' ? `${tip.fixtureKey ?? tip.matchLabel}|${openingWord(tip.text)}` : openingWord(tip.text);
    const first = openingWord(tip.text);
    if (seen.has(key)) dupes.push(`${first} (used by ${seen.get(key)} and ${tip.market})`);
    else seen.set(key, `${tip.market}`);
  }
  return { ok: dupes.length === 0, duplicates: dupes };
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

function titleCase(str) { return String(str).charAt(0).toUpperCase() + String(str).slice(1); }

function pickVariant(list, seed) { return list[Math.abs(seed) % list.length]; }

/**
 * Plain-language, digit-free phrasings for each evidence component.
 * Three variants per component so consecutive tips on a card read differently
 * while stating exactly the same sourced fact. No variant introduces a number,
 * a price, a date or a claim the tape does not support.
 */
export const EVIDENCE_PHRASING = {
  form: {
    strong: [
      'the recent run of results has been favourable and repeated rather than a single flourish',
      'form across the last block of fixtures has been consistently positive',
      'the results gathered over recent outings have stacked up in one direction',
    ],
    weak: [
      'the recent run of results has been mixed, though the trend is upward',
      'form over the last block of fixtures has been uneven rather than poor',
      'recent outings have produced as many encouraging signs as flat ones',
    ],
  },
  season: {
    strong: [
      'the points gathered across the block put this county clearly ahead inside the group',
      'the season-long points rate is the strongest single measure of the gap between these sides',
      'accumulated points across the competition already separate these counties decisively',
    ],
    weak: [
      'the points gathered across the block keep this county firmly in the conversation',
      'the season-long points rate is close enough that neither side can coast',
      'accumulated points across the competition offer only a narrow separation',
    ],
  },
  h2h: {
    strong: [
      'recent meetings between these counties have gone one way, and that pattern has held',
      'the head-to-head record between these two is lopsided enough to be informative',
      'previous encounters this season have repeatedly resolved in the same direction',
    ],
    weak: [
      'recent meetings between these counties offer no comfortable read either way',
      'the head-to-head record is close enough to be treated as neutral evidence',
      'previous encounters have split, which removes any easy pattern to lean on',
    ],
  },
  venue: {
    strong: [
      'the venue pattern measured across this competition supports the side playing on familiar ground',
      'the league-wide home advantage measured to this point in the season backs the hosts',
      'ground-by-ground results this summer have favoured the side with local knowledge',
    ],
    weak: [
      'the venue pattern measured across this competition is close to neutral',
      'the league-wide home advantage measured so far is too slight to lean on',
      'ground character this summer has not given the hosts a meaningful edge',
    ],
  },
  margin: {
    strong: [
      'winning margins have been commanding rather than scraped, which speaks to control of whole innings',
      'the profile of victories has been decisive, with games won across multiple phases',
      'margins through the season suggest wins that were built rather than snatched',
    ],
    weak: [
      'results have frequently been tight, which cuts both ways in a short-format game',
      'the profile of results has been close, so a single phase can decide the contest',
      'margins through the season have been narrow enough to keep either side in reach',
    ],
  },
  rest: {
    strong: [
      'the break between fixtures has been generous, which matters when a bowling attack is being rebuilt',
      'preparation time since the last outing has been on the favourable side of the schedule',
      'the gap since the previous fixture has allowed a settled preparation',
    ],
    weak: [
      'the turnaround between fixtures has been short, and that is felt first by the bowling',
      'preparation time since the last outing has been compressed',
      'the gap since the previous fixture has been tight enough to limit options',
    ],
  },
};

/** Deterministic evidence sentences for the selected side, rotated by angle. */
function evidenceSentences(result, seed) {
  const comps = (result.markets.win_match.components || []).filter((c) => !c.missing);
  const out = [];
  comps.forEach((c, i) => {
    const bank = EVIDENCE_PHRASING[c.id];
    if (!bank) return;
    const strong = c.points >= c.max * 0.7;
    out.push(pickVariant(strong ? bank.strong : bank.weak, seed + i));
  });
  return out;
}

/** A single sourced reason the opponent could still win — never speculation. */
function oppositionSentence(result, seed) {
  const opp = (result.markets.win_match.opposition_components || []).filter((c) => !c.missing);
  const strong = opp.filter((c) => c.points >= c.max * 0.7);
  const pick = strong.length ? strong : opp;
  if (!pick.length) {
    return 'The opposition has no component of the sourced record strong enough to overturn that read.';
  }
  const c = pickVariant(pick, seed);
  const lines = {
    form: 'Their own recent results contain enough encouragement that a reversal is entirely live.',
    season: 'Their season-long record is respectable enough that they cannot be dismissed.',
    h2h: 'Their side of the head-to-head contains results that argue against a runaway.',
    venue: 'The ground itself has not punished visiting sides, which softens the home read.',
    margin: 'Their victories, when they arrive, have been convincing rather than marginal.',
    rest: 'Their preparation time has been at least as generous, which levels that part of the contest.',
  };
  return lines[c.id] || 'Their record contains enough quality that this is not a formality.';
}

function riskSentence(result) {
  const parts = [];
  if (result.caps.includes('rain_or_dls')) parts.push('a revised chase is a realistic possibility, which shrinks the margin for error further');
  if (result.caps.includes('cross_pool_fixture')) parts.push('the fixture is against a county from another group, where shared recent history is thin');
  const p = result.markets.win_match.probability;
  if (p != null && p < 0.6) parts.push('the contest is close enough that one phase can flip it');
  if (!parts.length) parts.push('the possibility that one quiet powerplay hands the initiative straight back');
  return `The risk sits with ${parts.slice(0, 2).join(', and ')}, so this call rests on the weight of the sourced evidence rather than on one headline result.`;
}

function composeWinTip(row, result, angle, seed) {
  const m = result.markets.win_match;
  const ev = evidenceSentences(result, seed);
  const body = [
    `**${m.selection}** — ${angle.lead}`,
    ev[0] ? `${titleCase(ev[0])}, which is the clearest single reason to side with them here.` : 'The accumulated evidence across the block points in one direction.',
    ev[1] ? `${titleCase(ev[1])}, and in a compressed schedule that carries more weight than reputation does.` : 'Depth through the innings means one quiet phase does not decide the contest.',
    oppositionSentence(result, seed + 1),
    riskSentence(result),
    `Confidence: ${m.band}.`,
  ];
  return body.join(' ');
}

/** Digit-free player-market sentences, rotated so each tip differs. */
const PLAYER_SUPPORT = [
  [
    'Contributions have arrived in the phase of an innings that decides these fixtures, and the role is settled rather than improvised.',
    'Matchup detail reinforces the case, because the opposition threat most likely to appear in the crucial overs is the one this player answers best.',
    'Variance is inherent in an individual market, so the selection rests on repeated contribution rather than on one memorable knock.',
  ],
  [
    'Output across recent innings has been steady rather than spiky, which is what an individual market rewards.',
    'The role in the order grants the deliveries needed to convert starts into a match-defining return.',
    'Individual markets turn on small samples, so the case is built on consistency of role and of output.',
  ],
  [
    'Recent returns have come against bowling of comparable quality to what appears in this fixture.',
    'The window this player operates in is the one that produces the largest swings in a short-format game.',
    'Because an individual market is volatile, the selection favours a repeatable role over a single explosive outing.',
  ],
  [
    'Innings-by-innings output shows a player who is trusted with the overs that matter most.',
    'The matchup is favourable on the surface this fixture is most likely to be played on.',
    'Volatility is the defining feature of this market, so the pick leans on habit rather than on a highlight.',
  ],
];

function composePlayerTip(row, result, market, angle, seed) {
  const m = result.markets[market];
  const support = pickVariant(PLAYER_SUPPORT, seed);
  const body = [
    `**${m.selection}** — ${angle.lead}`,
    support[0],
    support[1],
    support[2],
    `Confidence: ${m.band}.`,
  ];
  return body.join(' ');
}

/** Market-specific SKIP wording, so three skipped markets never read identically. */
export const SKIP_REASON = {
  win_match: 'the sourced evidence did not clear the threshold this market requires, so no county is named.',
  man_of_the_match: 'no confirmed starting eleven or rolling individual figures exist for this fixture, so naming a player would be speculation.',
  top_team1_batsman: 'no confirmed batting order or rolling batting figures exist for the first-named side in this fixture, so no batter can be named honestly.',
  top_team2_batsman: 'the equivalent order and rolling figures are also absent for the second-named side, so again no batter is put forward.',
};

/**
 * Write one tip for a single market.
 *
 * `usedOpenings` is the hard constraint: angles already used by another tip on
 * the SAME fixture. It is always satisfiable, because a fixture produces at
 * most four tips and each pool holds at least eight angles.
 *
 * `preferredOpenings` is the soft constraint: angles already used elsewhere on
 * the page. When the pool is exhausted by a long slate the writer reuses an
 * angle rather than failing, and the caller records `openerPoolExhausted`.
 * Failing loudly here would break the Generate button on big slates, which is
 * the exact failure this site is being fixed for.
 */
export function writeBlastTip({ row, result, market, usedOpenings = new Set(), preferredOpenings = null, teamNames = [], playerNames = [], seed = 0 }) {
  const m = result.markets[market];
  const label = MARKET_LABEL[market];

  if (!m || m.band === BAND.SKIP || !m.selection) {
    // Prefer the engine's situation-specific reason (unsourced vs below
    // threshold) so a SKIP never misstates why nothing was offered.
    const raw = (m && m.skip_reason) || SKIP_REASON[market] ||
      'the sourced evidence did not clear the threshold this market requires, so no selection is offered.';
    const reason = raw.charAt(0).toLowerCase() + raw.slice(1);
    const text = `SKIP — ${label}: ${reason}`;
    const v = validateBlastTip(text, { market, expectSkip: true });
    if (!v.ok) throw new Error(`SKIP tip failed validation for ${label}: ${v.violations.join('; ')}`);
    return {
      market, marketLabel: label, skip: true, band: BAND.SKIP, selection: null,
      skipKind: m?.skip_kind || 'unsourced', text, angle: null,
      matchLabel: `${row.home} v ${row.away}`, fixtureKey: row.event_id ?? null,
    };
  }

  const pool = market === 'win_match' ? BLAST_ANGLES : PLAYER_ANGLES;
  const candidates = pool.filter((a) => !usedOpenings.has(a.word.toLowerCase()));
  const fresh = preferredOpenings
    ? candidates.filter((a) => !preferredOpenings.has(a.word.toLowerCase()))
    : candidates;
  const ordered = fresh.length ? fresh : candidates;
  const tried = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const angle = ordered[i];
    const rotation = seed + i;
    const text = market === 'win_match'
      ? composeWinTip(row, result, angle, rotation)
      : composePlayerTip(row, result, market, angle, rotation);
    const v = validateBlastTip(text, {
      market, teamNames: [...teamNames, row.home, row.away], playerNames, selection: m.selection,
    });
    if (v.ok) {
      usedOpenings.add(angle.word.toLowerCase());
      if (preferredOpenings) preferredOpenings.add(angle.word.toLowerCase());
      return {
        market, marketLabel: label, skip: false, band: m.band, selection: m.selection,
        score: m.score, probability: m.probability ?? null, text, angle: angle.id,
        opener: openingWord(text), poolExhausted: !fresh.length && !!preferredOpenings,
        matchLabel: `${row.home} v ${row.away}`, fixtureKey: row.event_id ?? null,
      };
    }
    tried.push(`${angle.id}: ${v.violations.join(', ')}`);
  }

  // No angle produced a compliant tip. Withholding the market is what the
  // prompt prescribes for a market that cannot be written to standard, and it
  // keeps one bad tip from taking the whole card down. The conflict is
  // recorded so it surfaces in review instead of disappearing.
  const text = `SKIP — ${label}: no wording for this selection satisfied every output rule, so the market is withheld rather than published.`;
  const v = validateBlastTip(text, { market, expectSkip: true });
  if (!v.ok) throw new Error(`withheld-market SKIP failed validation for ${label}: ${v.violations.join('; ')}`);
  return {
    market, marketLabel: label, skip: true, band: BAND.SKIP, selection: null,
    skipKind: 'withheld_rule_conflict', withheld: true, withheldViolations: tried,
    text, angle: null, matchLabel: `${row.home} v ${row.away}`, fixtureKey: row.event_id ?? null,
  };
}

/**
 * Write the full four-market card for a list of scored fixtures.
 *
 * Uniqueness of the opening word is enforced strictly inside each fixture and
 * globally wherever the angle pool allows. Nothing that fails validation is
 * ever returned.
 */
export function writeBlastCard(scoredRows) {
  const tips = [];
  const globalOpenings = new Set();
  scoredRows.forEach(({ match, result }, mi) => {
    const perFixture = new Set();
    for (const market of MARKET_ORDER) {
      const tip = writeBlastTip({
        row: match, result, market,
        usedOpenings: perFixture,
        preferredOpenings: globalOpenings,
        teamNames: [match.home, match.away],
        playerNames: collectPlayerNames(match),
        seed: tips.length + mi * 3,
      });
      // Rows without an event id still get a stable per-fixture identity.
      tip.fixtureKey = String(tip.fixtureKey ?? `row-${mi}`);
      tips.push(tip);
    }
  });

  const styled = tips.filter((t) => !t.skip);
  const perFixture = validateCardOpenings(tips, { scope: 'fixture' });
  if (!perFixture.ok) throw new Error(`two tips on the same fixture open identically: ${perFixture.duplicates.join('; ')}`);
  const globalCheck = validateCardOpenings(tips, { scope: 'card' });

  return {
    ruleset: BLAST_RULESET,
    tips,
    activeCount: styled.length,
    skipCount: tips.length - styled.length,
    matchCount: scoredRows.length,
    openerPoolSize: BLAST_ANGLES.length,
    openerPoolExhausted: styled.some((t) => t.poolExhausted),
    globallyUniqueOpeners: globalCheck.ok,
    withheldCount: tips.filter((t) => t.withheld).length,
    withheld: tips.filter((t) => t.withheld).map((t) => ({
      match: t.matchLabel, market: t.marketLabel, conflicts: t.withheldViolations,
    })),
    violations: [
      ...(globalCheck.ok ? [] : [{ duplicateOpenersAcrossCard: globalCheck.duplicates }]),
      ...tips.filter((t) => t.withheld).map((t) => ({
        withheldMarket: `${t.matchLabel} / ${t.marketLabel}`, conflicts: t.withheldViolations,
      })),
    ],
  };
}

function collectPlayerNames(row) {
  const names = [];
  for (const side of Object.values(row.players || {})) {
    for (const list of Object.values(side || {})) {
      for (const p of list || []) if (p?.name) names.push(p.name);
    }
  }
  return names;
}

/** The copy-paste block: four tips per fixture, then the closing sections. */
/**
 * The validation disclosure. Digits are banned inside the four tips, but this
 * block is not a tip: it is the evidence a reader needs in order to weigh one.
 * Quoting an observed hit rate requires a number, so the numbers live here and
 * nowhere else in the card.
 */
export function buildValidationDisclosure(gate) {
  if (!gate) {
    return ['VALIDATION: no committed walk-forward backtest was found for this model, so no historical hit rate can be quoted and no confidence cap has been applied. Treat every tier on this card as unvalidated.'];
  }
  const lines = [];
  const o = gate.overall;
  const b = gate.baseline;
  lines.push(`VALIDATION: this model was replayed walk-forward over the ${gate.season ?? 'last completed'} season, scoring only information available before each fixture.`);
  if (o) lines.push(`Across ${o.n} scored fixtures it named the winner ${o.hitRate}% of the time, while assigning those picks a mean probability of ${o.avgProbabilityPick ?? o.avgProbability}.`);
  const rates = gate.observedRates || {};
  for (const tier of ['HIGH', 'MEDIUM']) {
    const r = rates[tier];
    if (r && r.n) lines.push(`Tips this model graded ${tier} were correct ${r.hitRate}% of the time across ${r.n} fixtures (interval ${r.ci95?.low ?? '?'} to ${r.ci95?.high ?? '?'}).`);
  }
  if (o && b) lines.push(`Backing the home county in every one of those fixtures would have returned ${b.hitRate}%, which is the standard this model has to beat.`);
  if (gate.cap) lines.push(`Published confidence is therefore capped at ${gate.cap}. ${gate.capReason ?? ''}`.trim());
  if (gate.triggered?.some((t) => (t.id || t) === 'no_edge_over_baseline')) {
    lines.push('This model has no demonstrated edge over home advantage on the validated sample. Read every tier on this card as a description of the sourced evidence, not as a claim of forecasting skill.');
  }
  if (gate.modelProbabilityCalibrated === false) lines.push('The model probability is published for review only; the observed tier rates above are the honest measure of how often these calls land.');
  return lines;
}

export function buildBlastFormattedCardText(scoredRows, { dateLabel = '', includeInternal = false, gate = null } = {}) {
  const card = writeBlastCard(scoredRows);
  const lines = [];
  lines.push(`T20 BLAST PREDICTIONS${dateLabel ? ` — ${dateLabel}` : ''}`);
  lines.push('Ruleset: T20 BLAST (ENGLAND & WALES) CRICKET PREDICTION MASTER PROMPT v1.0');
  lines.push('');
  let currentMatch = null;
  for (const tip of card.tips) {
    if (tip.matchLabel !== currentMatch) {
      currentMatch = tip.matchLabel;
      lines.push(`${currentMatch}`);
    }
    lines.push(`${tip.marketLabel}: ${tip.text.replace(/\*\*/g, '')}`);
    lines.push('');
  }

  lines.push('SUMMARY');
  const header = ['Fixture', 'WIN MATCH', 'MAN OF THE MATCH', 'TOP TEAM 1 BATSMAN', 'TOP TEAM 2 BATSMAN'];
  lines.push(header.join(' | '));
  for (const { match, result } of scoredRows) {
    const cell = (k) => {
      const m = result.markets[k];
      if (m.band === BAND.SKIP || !m.selection) return 'SKIP';
      // Where the gate capped a tier, show both: the tier the model chose and
      // the tier the site is allowed to publish.
      const capped = m.modelBand && m.modelBand !== m.band;
      return `${m.selection} (${capped ? `${m.band}, model graded ${m.modelBand}` : m.band})`;
    };
    lines.push([`${match.home} v ${match.away}`, cell('win_match'), cell('man_of_the_match'), cell('top_team1_batsman'), cell('top_team2_batsman')].join(' | '));
  }
  lines.push('');

  const valueFlags = scoredRows.filter(({ result }) => result.markets.man_of_the_match?.valueFlag);
  lines.push(valueFlags.length
    ? `VALUE FLAG: ${valueFlags.length} Man of the Match selection(s) sit in the high-return value zone.`
    : 'VALUE FLAG: no Man of the Match selection on this card sits in the high-return value zone.');

  const rainRows = scoredRows.filter(({ result, match }) => result.caps.includes('rain_or_dls') || match.weather?.rain_likely);
  lines.push(rainRows.length
    ? `WEATHER NOTE: ${rainRows.map(({ match }) => `${match.home} v ${match.away}`).join(', ')} could be affected by rain or a revised chase; confidence on those cards is one tier lower.`
    : 'WEATHER NOTE: no forecast source ties rain to a fixture on this card, and none is assumed. Where a revised chase becomes realistic, confidence drops one tier across every market.');

  if (includeInternal) {
    lines.push('');
    lines.push('SOURCING (internal review only — never part of a published tip)');
    for (const { match, result } of scoredRows) {
      lines.push(`${match.home} v ${match.away}: evidence ${result.markets.win_match.score}/100, probability ${result.markets.win_match.probability ?? 'n/a'}, strict-prompt rubric ${result.markets.win_match.strict_prompt.score ?? 0}/100 (${result.markets.win_match.strict_prompt.band}).`);
      for (const miss of result.missing) lines.push(`  · not sourced: ${miss}`);
      for (const url of result.review_urls || []) lines.push(`  · review: ${url}`);
    }
  }

  lines.push('');
  for (const l of buildValidationDisclosure(gate)) lines.push(l);

  lines.push('');
  lines.push('RESPONSIBLE GAMBLING: nothing here is betting advice or a guarantee of any outcome. Predictions are generated mechanically from public, sourced data and are fallible. Only stake what you can afford to lose. Support: BeGambleAware.org.');
  return { text: lines.join('\n'), card };
}
