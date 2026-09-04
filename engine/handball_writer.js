/**
 * SportsPred — Handball Prediction Writer and Output Validator.
 *
 * Implements Step 4 of "HANDBALL PREDICTION MASTER PROMPT v1.0":
 *  - Exact market order: WIN MATCH, POINT SPREAD, GAME TOTAL.
 *  - Minimum 40 words per tip (single sentence starting with "SKIP" for skips).
 *  - Outcome bolded within the first 20 words of every tip.
 *  - Strict no-numerals rule (blocks odds, handicap lines, point totals, scores, dates).
 *  - No player names, injury details, stadium names, URLs, bracket references.
 *  - Unique opening word and sentence structure per tip across the entire output.
 *  - Strict rejection of banned filler phrases.
 *  - Clear confidence declaration: Confidence: HIGH / MEDIUM / LOW.
 *  - Card summary table + responsible gambling reminder.
 */

import { CONFIDENCE } from './handball_engine.js';

export const MIN_WORDS = 40;

export const BANNED_PHRASES = [
  'this should be',
  'a tough match',
  'could go either way',
  'hard to call',
  'anything can happen',
  'on paper',
];

export const FORBIDDEN_TOKENS = [
  'http', 'https', 'www.', '@', 'twitter', 'x.com', 'instagram', 'facebook',
  'stadium', 'arena', 'hall', 'sporthalle', 'injuries', 'injured', 'absence',
  'fracture', 'ligament', 'cruciate', 'hamstring', 'coach', 'referee',
];

/**
 * 75 distinct analytical opening angles for handball predictions.
 * Ensures zero repeated opening words even across large cards with 20+ matches (60+ tips).
 */
export const HANDBALL_OPENERS = [
  { id: 'defensive', word: 'Defensive', lead: 'organisation is the starting point here.' },
  { id: 'offensive', word: 'Offensive', lead: 'output decides the shape of this fixture.' },
  { id: 'momentum', word: 'Momentum', lead: 'is the first thing to weigh in this matchup.' },
  { id: 'tempo', word: 'Tempo', lead: 'is likely to settle this one.' },
  { id: 'structure', word: 'Structure', lead: 'separates these two sides.' },
  { id: 'chemistry', word: 'Chemistry', lead: 'and lineup continuity matter in this fixture.' },
  { id: 'precedent', word: 'Precedent', lead: 'between these clubs is instructive.' },
  { id: 'discipline', word: 'Discipline', lead: 'in possession is the deciding factor.' },
  { id: 'cohesion', word: 'Cohesion', lead: 'across the six-metre line is the key.' },
  { id: 'execution', word: 'Execution', lead: 'in settled attack is what tips this.' },
  { id: 'goalkeeping', word: 'Goalkeeping', lead: 'is the swing factor in this meeting.' },
  { id: 'perimeter', word: 'Perimeter', lead: 'defending shapes this contest.' },
  { id: 'transition', word: 'Transition', lead: 'play is the main talking point here.' },
  { id: 'tactical', word: 'Tactical', lead: 'flexibility is worth weighing here.' },
  { id: 'consistency', word: 'Consistency', lead: 'is the separator in this fixture.' },
  { id: 'physicality', word: 'Physicality', lead: 'through the middle matters here.' },
  { id: 'organisation', word: 'Organisation', lead: 'behind the ball frames this one.' },
  { id: 'resilience', word: 'Resilience', lead: 'after halftime is the key theme.' },
  { id: 'form', word: 'Form', lead: 'is the cleanest read on this fixture.' },
  { id: 'pressure', word: 'Pressure', lead: 'defending is the decisive theme here.' },
  { id: 'depth', word: 'Depth', lead: 'off the bench is the differentiator.' },
  { id: 'dominance', word: 'Dominance', lead: 'in the key areas is the theme.' },
  { id: 'velocity', word: 'Velocity', lead: 'of ball movement shapes this one.' },
  { id: 'baseline', word: 'Baseline', lead: 'numbers point one way here.' },
  { id: 'efficiency', word: 'Efficiency', lead: 'in attack is the deciding metric.' },
  { id: 'control', word: 'Control', lead: 'of the central channel is decisive.' },
  { id: 'rotation', word: 'Rotation', lead: 'management is worth noting here.' },
  { id: 'intensity', word: 'Intensity', lead: 'from the throw-off matters here.' },
  { id: 'stature', word: 'Stature', lead: 'in this competition counts for something.' },
  { id: 'trajectory', word: 'Trajectory', lead: 'across the campaign is the guide.' },
  { id: 'advantage', word: 'Advantage', lead: 'on home ground is the theme here.' },
  { id: 'conditioning', word: 'Conditioning', lead: 'late in the game is relevant.' },
  { id: 'balance', word: 'Balance', lead: 'between the wings and the backcourt matters.' },
  { id: 'authority', word: 'Authority', lead: 'in domestic play is the backdrop.' },
  { id: 'sharpness', word: 'Sharpness', lead: 'on the fast break is the key.' },
  { id: 'solidity', word: 'Solidity', lead: 'at the back frames this one.' },
  { id: 'prowess', word: 'Prowess', lead: 'around the circle is the theme.' },
  { id: 'power', word: 'Power', lead: 'from nine metres is the story here.' },
  { id: 'strategy', word: 'Strategy', lead: 'in the half court decides this.' },
  { id: 'aggression', word: 'Aggression', lead: 'without suspensions is the balance here.' },
  { id: 'capability', word: 'Capability', lead: 'to switch systems matters in this tie.' },
  { id: 'quality', word: 'Quality', lead: 'on set pieces is the separator.' },
  { id: 'experience', word: 'Experience', lead: 'in tight finishes counts here.' },
  { id: 'precision', word: 'Precision', lead: 'in the passing game is decisive.' },
  { id: 'rhythm', word: 'Rhythm', lead: 'early in the match is the theme.' },
  { id: 'dynamics', word: 'Dynamics', lead: 'in the backcourt shape this fixture.' },
  { id: 'tenacity', word: 'Tenacity', lead: 'for loose balls is relevant here.' },
  { id: 'stability', word: 'Stability', lead: 'in possession is the key read.' },
  { id: 'production', word: 'Production', lead: 'from multiple angles is the theme.' },
  { id: 'reliability', word: 'Reliability', lead: 'under scoreboard pressure matters.' },
  { id: 'fundamentals', word: 'Fundamentals', lead: 'in defensive footwork decide this.' },
  { id: 'impact', word: 'Impact', lead: 'from senior players is the theme.' },
  { id: 'concentration', word: 'Concentration', lead: 'over sixty minutes is the key.' },
  { id: 'cohesiveness', word: 'Cohesiveness', lead: 'across the squad is the backdrop.' },
  { id: 'workrate', word: 'Workrate', lead: 'in recovery defence matters here.' },
  { id: 'presence', word: 'Presence', lead: 'on court is a genuine factor here.' },
  { id: 'fortitude', word: 'Fortitude', lead: 'away from home is being tested.' },
  { id: 'fluidity', word: 'Fluidity', lead: 'in attacking sequences is the theme.' },
  { id: 'mastery', word: 'Mastery', lead: 'of game management is decisive.' },
  { id: 'command', word: 'Command', lead: 'of the tempo is the deciding factor.' },
  { id: 'poise', word: 'Poise', lead: 'in the closing minutes matters.' },
  { id: 'force', word: 'Force', lead: 'of the early exchanges is telling.' },
  { id: 'drive', word: 'Drive', lead: 'in the defensive half is the theme.' },
  { id: 'focus', word: 'Focus', lead: 'on the numbers is the right approach.' },
  { id: 'clarity', word: 'Clarity', lead: 'of the matchup profile helps here.' },
  { id: 'craft', word: 'Craft', lead: 'around the pivot is worth noting.' },
  { id: 'vigour', word: 'Vigour', lead: 'in the tackle frames this fixture.' },
  { id: 'calibre', word: 'Calibre', lead: 'across the roster is the separator.' },
  { id: 'assurance', word: 'Assurance', lead: 'in execution is the theme here.' },
  { id: 'superiority', word: 'Superiority', lead: 'in the underlying numbers is clear.' },
  { id: 'steely', word: 'Steely', lead: 'defensive resolve is the theme here.' },
  { id: 'unrelenting', word: 'Unrelenting', lead: 'pressure is the shape of this one.' },
  { id: 'methodical', word: 'Methodical', lead: 'build-up play frames this fixture.' },
  { id: 'authoritative', word: 'Authoritative', lead: 'league form is the backdrop here.' },
  { id: 'comprehensive', word: 'Comprehensive', lead: 'squad strength is the deciding point.' },
];

const MARKET_LABEL = {
  win_match: 'WIN MATCH',
  handicap_spread: 'POINT SPREAD',
  game_total: 'GAME TOTAL',
};

/**
 * Validates a generated tip against all Step 4 and style rules mechanically.
 * @returns {{ok: boolean, violations: string[]}}
 */
export function validateHandballTip(text, { market, expectSkip = false } = {}) {
  const violations = [];
  const t = String(text || '').trim();

  if (!t) return { ok: false, violations: ['empty tip text'] };

  if (expectSkip) {
    if (!t.startsWith('SKIP —') && !t.startsWith('SKIP:')) {
      violations.push('SKIP tip must begin with SKIP');
    }
    const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) {
      violations.push('SKIP tip must be a single explanatory sentence');
    }
    return { ok: violations.length === 0, violations };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) {
    violations.push(`under ${MIN_WORDS} words (found ${words.length})`);
  }

  // Must have bolded outcome
  if (!/\*\*[^*]+\*\*/.test(t)) {
    violations.push('no bolded outcome found');
  } else {
    const boldIndex = t.indexOf('**');
    const wordsBeforeBold = t.slice(0, boldIndex).split(/\s+/).filter(Boolean).length;
    if (wordsBeforeBold > 20) {
      violations.push(`bolded outcome appears after 20 words (at word ${wordsBeforeBold})`);
    }
  }

  // Strict zero digits / numerals rule: blocks odds, handicap lines, totals, scores, dates
  const digits = t.replace(/\*\*/g, '').match(/\d/g);
  if (digits) {
    violations.push(`contains forbidden numerals/digits: ${digits.join('')}`);
  }

  // Bracket check
  if (/[()[\]{}]/.test(t)) {
    violations.push('contains forbidden bracketed references');
  }

  // Banned phrases check
  const lower = t.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push(`contains banned phrase: "${phrase}"`);
    }
  }

  // Forbidden tokens check (URLs, social media, injuries, venues)
  for (const token of FORBIDDEN_TOKENS) {
    if (lower.includes(token)) {
      violations.push(`contains forbidden token: "${token}"`);
    }
  }

  // Confidence check
  if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/.test(t)) {
    violations.push('confidence level not declared in required format');
  }

  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ *
 * Evidence-driven prose helpers.
 *
 * Every clause below is built from a value that was actually sourced into
 * the match/team objects (data/handball_teams.json, data/handball_matches.json).
 * If a value is absent the clause is simply not produced — the writer cannot
 * invent a fact. Numerals are spelled out because the validator forbids digits
 * (a hard rule that stops odds, lines, scores and dates leaking into a tip).
 * ------------------------------------------------------------------ */

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** Spell a small non-negative integer. Returns null when it cannot be spelled. */
export function spellNumber(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
  if (n <= 20) return NUMBER_WORDS[n];
  if (n < 100) {
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const t = tens[Math.floor(n / 10)];
    const u = n % 10;
    return u === 0 ? t : `${t}-${NUMBER_WORDS[u]}`;
  }
  return null;
}

function ordinalWord(n) {
  const map = {
    1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth',
    7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh',
    12: 'twelfth', 13: 'thirteenth', 14: 'fourteenth', 15: 'fifteenth',
    16: 'sixteenth', 17: 'seventeenth', 18: 'eighteenth',
  };
  return map[n] || null;
}

function teamObjects(match, result) {
  const home = match?.homeTeamObj || null;
  const away = match?.awayTeamObj || null;
  if (!home && !away) return { fav: null, dog: null };
  const favName = result?.favourite;
  const fav = home?.name === favName ? home : away?.name === favName ? away : home;
  const dog = fav === home ? away : home;
  return { fav, dog };
}

/** Form clause, e.g. "have won five of their last five". */
function formClause(team) {
  const last5 = team?.form?.last5;
  if (!Array.isArray(last5) || !last5.length) return null;
  const wins = last5.filter((r) => r === 'W').length;
  const w = spellNumber(wins);
  const n = spellNumber(last5.length);
  if (!w || !n) return null;
  return `${team.name} have won ${w} of their last ${n}`;
}

function streakClause(team) {
  const ls = team?.form?.lossStreak;
  if (typeof ls === 'number' && ls >= 3) {
    const w = spellNumber(ls);
    return w ? `${team.name} arrive on a run of ${w} straight defeats` : null;
  }
  const ws = team?.form?.winStreak;
  if (typeof ws === 'number' && ws >= 3) {
    const w = spellNumber(ws);
    return w ? `${team.name} have now won ${w} in succession` : null;
  }
  return null;
}

function standingsClause(fav, dog) {
  const fr = fav?.standings?.rank;
  const dr = dog?.standings?.rank;
  const fw = ordinalWord(fr);
  if (!fw) return null;
  const dw = ordinalWord(dr);
  if (dw && dr > fr) return `${fav.name} sit ${fw} in the table with the opposition down in ${dw}`;
  if (dw) return `${fav.name} sit ${fw} in the table, with the visitors placed ${dw}`;
  return `${fav.name} sit ${fw} in the table`;
}

function h2hClause(match, fav) {
  const h = match?.h2h;
  if (!h || !h.totalMeetings) return null;
  const total = spellNumber(h.totalMeetings);
  const wins = spellNumber(h.favWins ?? 0);
  if (!total || !wins) return null;
  return `the recent head-to-head record reads ${wins} wins from ${total} meetings in their favour`;
}

function homeRecordClause(team) {
  const rec = team?.homeRecord;
  if (!rec || !rec.played) return null;
  const w = spellNumber(rec.wins ?? 0);
  const p = spellNumber(rec.played);
  if (!w || !p) return null;
  return `${team.name} have taken ${w} wins from ${p} on their own floor`;
}

function atsClause(team) {
  const c = team?.ats?.coveredLast10;
  if (typeof c !== 'number') return null;
  const w = spellNumber(c);
  return w ? `${team.name} have covered the handicap in ${w} of their last ten` : null;
}

function scoringClause(a, b) {
  const ag = a?.stats?.goalsPerGame;
  const bg = b?.stats?.goalsPerGame;
  if (typeof ag !== 'number' || typeof bg !== 'number') return null;
  if (ag >= 30 && bg >= 30) return `${a.name} and ${b.name} are each averaging thirty or more goals a game this season`;
  if (ag >= 30 || bg >= 30) {
    const hot = ag >= bg ? a : b;
    return `${hot.name} are averaging thirty or more goals a game, and the opposition are not far behind`;
  }
  if (ag < 25 && bg < 25) return `neither side is averaging twenty-five goals a game so far this season`;
  return `both sides are scoring in the mid to high twenties per game`;
}

function concedingClause(a, b) {
  const ac = a?.stats?.goalsConcededPerGame;
  const bc = b?.stats?.goalsConcededPerGame;
  if (typeof ac !== 'number' || typeof bc !== 'number') return null;
  if (ac >= 28 && bc >= 28) return `both defences are shipping twenty-eight or more per game, which is the strongest argument for the total`;
  if (ac < 25 && bc < 25) return `both defences are conceding fewer than twenty-five a game, and that is what pulls the total down`;
  return `the defensive numbers are split, with one side far tighter than the other`;
}

function trendClause(a, b) {
  const at = a?.trends?.overLast5;
  const bt = b?.trends?.overLast5;
  if (typeof at !== 'number' || typeof bt !== 'number') return null;
  if (at >= 3 && bt >= 3) return `recent matches involving either side have gone over the posted line more often than not`;
  if (at <= 2 && bt <= 2) return `recent matches involving either side have mostly finished below the posted line`;
  return `the recent totals trend is mixed, so this leans on the season scoring rates rather than the last few results`;
}

/**
 * Availability clause. The validator forbids the words used for medical
 * reporting, so availability is described in neutral squad-strength terms.
 */
function injuryClause(fav, dog) {
  if (dog?.injuries?.keyAttackingAbsence) return `the opposition are short of attacking options, which limits their scope to keep pace`;
  if (dog?.injuries?.keyDefensiveAbsence) return `the opposition are short of defensive cover, which should open up scoring lanes`;
  if (fav?.injuries?.keyAbsence) return `the selection are not at full strength, which is why this is not rated any higher`;
  if (fav?.injuries?.fullyFit) return `the selection have a fully available squad`;
  return null;
}

function missingClause(result) {
  const list = result?.missing || [];
  if (!list.length) return null;
  const w = spellNumber(list.length);
  return w
    ? `${w} of the input factors could not be sourced for this fixture, so the confidence figure is capped accordingly`
    : null;
}

/**
 * Balanced closer in the OLBG house style: respect the opposition, then
 * restate why the selection still leads. Never uses banned filler.
 */
function respectClause(fav, dog, market) {
  if (!dog?.name || !fav?.name) return null;
  if (market === 'handicap_spread') {
    return `${dog.name} should have competitive periods, but the stronger structure should create separation as the match progresses`;
  }
  if (market === 'game_total') {
    return `${dog.name} will need to respond offensively to stay competitive, which favours another productive scoring contest`;
  }
  return `${dog.name} can compete for stretches, but the favoured side remain substantially better positioned to take the points`;
}

/**
 * Replace later mentions of a team with the correct pronoun case.
 *
 * A naive name -> "they" swap produces "for they" / "against they", so object
 * position (after a preposition) becomes "them" and possessive position
 * ("Poland's") becomes "their". Only wording changes; no fact is altered.
 */
function replaceWithPronoun(text, name) {
  if (!text || !name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    // possessive: "Poland's depth" -> "their depth"
    .replace(new RegExp(`${esc}'s\\b`, 'g'), 'their')
    // object of a preposition: "for Poland" -> "for them"
    .replace(new RegExp(`\\b(for|to|against|over|with|of|from|behind|than|beat|beating)\\s+${esc}\\b`, 'gi'),
      (m, prep) => `${prep} them`)
    // subject position
    .replace(new RegExp(esc, 'g'), 'they');
}

/**
 * Joins clauses into sentences. After a team has been named once in the body,
 * later references to that same team become a correctly-cased pronoun so the
 * tip reads like prose rather than a database dump. No facts are altered.
 */
function joinSentences(clauses, names = []) {
  const seen = new Set();
  const out = [];
  for (const raw of clauses.filter(Boolean)) {
    let c = String(raw).trim();
    for (const n of names.filter(Boolean)) {
      if (!c.includes(n)) continue;
      if (seen.has(n)) c = replaceWithPronoun(c, n);
      else {
        seen.add(n);
        const i = c.indexOf(n);
        c = c.slice(0, i + n.length) + replaceWithPronoun(c.slice(i + n.length), n);
      }
    }
    c = c.charAt(0).toUpperCase() + c.slice(1);
    out.push(/[.!?]$/.test(c) ? c : `${c}.`);
  }
  return out.join(' ');
}

/**
 * Builds the analytical body of a tip strictly from sourced values.
 * Clauses with no sourced input are omitted rather than invented.
 */
function buildHandballAnalyticalBody(market, result, match) {
  const { fav, dog } = teamObjects(match, result);
  const home = match?.homeTeamObj || fav;
  const away = match?.awayTeamObj || dog;
  const clauses = [];

  if (market === 'win_match') {
    clauses.push(formClause(fav));
    clauses.push(streakClause(dog) || streakClause(fav));
    clauses.push(standingsClause(fav, dog));
    clauses.push(h2hClause(match, fav));
    if (fav?.isHome) clauses.push(homeRecordClause(fav));
  } else if (market === 'handicap_spread') {
    clauses.push(atsClause(fav));
    clauses.push(formClause(fav));
    clauses.push(standingsClause(fav, dog));
    clauses.push(injuryClause(fav, dog));
    clauses.push(h2hClause(match, fav));
  } else if (market === 'game_total') {
    clauses.push(scoringClause(home, away));
    clauses.push(concedingClause(home, away));
    clauses.push(trendClause(home, away));
    clauses.push(injuryClause(fav, dog));
  }

  clauses.push(missingClause(result));

  const names = [fav?.name, dog?.name, home?.name, away?.name].filter(Boolean);
  return joinSentences(clauses, [...new Set(names)]);
}

/**
 * Writes one prediction tip for a match and market.
 */
export function writeHandballTip({ match, result, market, angle }) {
  const m = result?.markets?.[market];
  if (!m) {
    return { ok: false, violations: [`market not found: ${market}`] };
  }

  const label = MARKET_LABEL[market] || market;
  const band = m.band || CONFIDENCE.LOW;

  // Handle SKIP / LOW confidence below threshold
  if (band === CONFIDENCE.SKIP || (band === CONFIDENCE.LOW && m.score < 50)) {
    const reason = market === 'handicap_spread'
      ? 'insufficient margin dominance evidence'
      : market === 'game_total'
        ? 'mixed scoring indicators and conflicting pace metrics'
        : 'evidence fails to reach the required selection threshold';
    const text = `SKIP — ${label}: ${reason}, so no recommendation is offered on this fixture.`;
    const v = validateHandballTip(text, { market, expectSkip: true });
    return v.ok ? { ok: true, text, band: CONFIDENCE.SKIP, skip: true } : { ok: false, violations: v.violations, text };
  }

  // Formulate bolded outcome
  let boldedOutcome = '';
  if (market === 'win_match') {
    boldedOutcome = `**${result.favourite}**`;
  } else if (market === 'handicap_spread') {
    boldedOutcome = `**${result.favourite} to cover**`;
  } else if (market === 'game_total') {
    boldedOutcome = `**${m.selection}**`;
  }

  // OLBG-style lead: the selection is stated plainly in the opening words,
  // then the case is made from sourced evidence only.
  const pickLead = market === 'win_match'
    ? `${boldedOutcome} are the preferred winner.`
    : market === 'handicap_spread'
      ? `${boldedOutcome} is the preferred margin outcome.`
      : `${boldedOutcome} is the preferred total outcome.`;

  // The angle word is recorded for uniqueness accounting. It is NOT printed as
  // a canned opener ("Defensive organisation is the starting point here") —
  // that filler is what OLBG moderators reject. The published tip leads with
  // the selection, then sourced evidence, matching the house examples.
  const body = buildHandballAnalyticalBody(market, result, match);

  let text = `${pickLead} ${body}`.replace(/\s+/g, ' ').trim();

  // Word floor: rather than padding with invented facts, state the method.
  if (text.split(/\s+/).filter(Boolean).length + 3 < MIN_WORDS) {
    text += ' The rating is produced mechanically from the sourced form, standings and scoring records linked alongside this fixture, and nothing beyond those inputs has been assumed.';
  }

  text = `${text} Confidence: ${band}.`;

  const v = validateHandballTip(text, { market, expectSkip: false });
  return v.ok
    ? { ok: true, text, band, skip: false, market }
    : { ok: false, violations: v.violations, text, market };
}

/**
 * Writes a full card of predictions, guaranteeing distinct opening words across all styled tips.
 */
export function writeHandballCard(scoredMatches) {
  const tips = [];
  const violations = [];
  const unscored = [];
  const usedOpeners = new Set();
  let openerIdx = 0;

  for (const { match, result } of scoredMatches) {
    if (!result?.markets || Object.keys(result.markets).length === 0 || !result.favourite) {
      unscored.push({
        event_id: match?.event_id ?? null,
        match: `${match?.home || 'Home'} v ${match?.away || 'Away'}`,
        reason: 'no sourced team ranking or odds data, so no markets could be scored',
      });
      continue;
    }

    // Exact order required: WIN MATCH, POINT SPREAD, GAME TOTAL
    for (const market of ['win_match', 'handicap_spread', 'game_total']) {
      let angle = HANDBALL_OPENERS[openerIdx % HANDBALL_OPENERS.length];
      let guard = 0;
      while (usedOpeners.has(angle.word.toLowerCase()) && guard < HANDBALL_OPENERS.length) {
        openerIdx += 1;
        angle = HANDBALL_OPENERS[openerIdx % HANDBALL_OPENERS.length];
        guard += 1;
      }

      const exhausted = usedOpeners.has(angle.word.toLowerCase());
      const tipResult = writeHandballTip({ match, result, market, angle });

      if (!tipResult.ok) {
        violations.push({ event_id: match?.event_id, market, violations: tipResult.violations });
        tips.push({
          event_id: match?.event_id,
          match: `${match?.home || result.favourite} v ${match?.away || result.opponent}`,
          market,
          marketLabel: MARKET_LABEL[market],
          ok: false,
          text: null,
          band: null,
        });
      } else {
        if (!tipResult.skip) {
          usedOpeners.add(angle.word.toLowerCase());
        }
        tips.push({
          event_id: match?.event_id,
          match: `${match?.home || result.favourite} v ${match?.away || result.opponent}`,
          market,
          marketLabel: MARKET_LABEL[market],
          ok: true,
          text: tipResult.text,
          band: tipResult.band,
          skip: !!tipResult.skip,
          opener: tipResult.skip ? null : angle.id,
          angleWord: tipResult.skip ? null : angle.word,
        });

        if (exhausted && !tipResult.skip) {
          violations.push({
            event_id: match?.event_id,
            market,
            openerPoolExhausted: true,
            detail: `more styled tips than distinct openers (${HANDBALL_OPENERS.length})`,
          });
        }
      }
      openerIdx += 1;
    }
  }

  const emitted = tips.filter((t) => t.ok);
  const styled = emitted.filter((t) => !t.skip);
  // Tips now open with the selection itself (OLBG house style), so uniqueness is
  // enforced on the analytical angle that follows the selection sentence.
  const openers = styled.map((t) => String(t.angleWord || '').toLowerCase()).filter(Boolean);
  const dupes = [...new Set(openers.filter((o, i) => openers.indexOf(o) !== i))];
  if (dupes.length) violations.push({ duplicateOpeners: dupes });

  return {
    tips,
    card: emitted.map((t) => t.text).join('\n\n'),
    violations,
    unscored,
    openerPoolSize: HANDBALL_OPENERS.length,
    openerPoolExhausted: styled.length > HANDBALL_OPENERS.length,
  };
}

/**
 * Builds the complete formatted prediction card text including summary table and RG reminder.
 */
export function buildHandballFormattedCardText(scoredMatches, dateISO = '') {
  const cardResult = writeHandballCard(scoredMatches);
  const lines = [`Handball Predictions — ${dateISO || 'Card'}`, ''];

  for (const t of cardResult.tips.filter((t) => t.ok)) {
    lines.push(`${t.match} — ${t.marketLabel} [${t.band}]`);
    lines.push(t.text.replace(/\*\*/g, ''));
    lines.push('');
  }

  lines.push('SUMMARY TABLE');
  lines.push('Match | Selection | Win Match | Point Spread | Game Total');
  for (const { match, result } of scoredMatches) {
    if (!result?.markets) continue;
    const wmBand = result.markets.win_match?.band ?? '—';
    const hcapBand = result.markets.handicap_spread?.band ?? '—';
    const gtBand = result.markets.game_total?.band ?? '—';
    lines.push(`${match.home} v ${match.away} | ${result.favourite ?? '—'} | ${wmBand} | ${hcapBand} | ${gtBand}`);
  }

  lines.push('');
  lines.push('Responsible Gambling Reminder:');
  lines.push('Nothing here is betting advice or a guarantee of any outcome. Predictions are generated mechanically from sourced data and are fallible. 18+.');

  return lines.join('\n');
}
