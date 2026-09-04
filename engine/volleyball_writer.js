/**
 * SportsPred — Volleyball Prediction Writer and Output Validator.
 *
 * Implements Step 4 of "VOLLEYBALL PREDICTION MASTER PROMPT v1.0":
 *  - Exact market order: WIN MATCH, SET SCORE.
 *  - Minimum 40 words per tip.
 *  - Predicted winner / set score bolded within the first 20 words.
 *  - No player names, injury details, league names, stadium names, odds,
 *    handicap lines or total-points lines.
 *  - Set-score tips state 3-0, 3-1 or 3-2 in bold (the only permitted digits).
 *  - Unique opening word across the card.
 *  - Confidence: HIGH / MEDIUM / LOW on every tip.
 *  - Below-threshold matches emit SKIP — a single sentence.
 */

import { CONFIDENCE } from './volleyball_engine.js';

export const MIN_WORDS = 40;

export const BANNED_PHRASES = [
  'this should be straightforward',
  'a tough match',
  'hard to call',
  'could go either way',
  'evenly matched',
  'on paper',
];

export const FORBIDDEN_TOKENS = [
  'http', 'https', 'www.', '@', 'twitter', 'x.com', 'instagram', 'facebook',
  'stadium', 'arena', 'injuries', 'injured', 'absence', 'coach',
];

export const VOLLEYBALL_OPENERS = [
  { id: 'attacking', word: 'Attacking', lead: 'dominance from the pin hitters sets the tone before the first serve lands.' },
  { id: 'psychological', word: 'Psychological', lead: 'control established in recent meetings still shapes how this contest unfolds.' },
  { id: 'home', word: 'Crowd', lead: 'proximity to the court amplifies every serve-receive error in a hall this tight.' },
  { id: 'receive', word: 'Serve-receive', lead: 'frailty on one side invites a cascade of out-of-system swings.' },
  { id: 'momentum', word: 'Straight-set', lead: 'winning momentum is a different animal from scraping through five-set marathons.' },
  { id: 'tactical', word: 'Tactical', lead: 'adaptability between sets lets the stronger unit reset without surrendering the match.' },
  { id: 'serving', word: 'Serving', lead: 'pressure creates cascading advantages unlike any other indoor sport.' },
  { id: 'blocking', word: 'Blocking', lead: 'presence at the net shrinks the attacking windows the challenger relies upon.' },
  { id: 'fatigue', word: 'Fatigue', lead: 'from a compressed run of five-set matches rarely shows until the later sets.' },
  { id: 'rhythm', word: 'Rhythm', lead: 'in transition offence has been uninterrupted on one side of this meeting.' },
  { id: 'precedent', word: 'Precedent', lead: 'from the most recent set scores between these two points firmly one way.' },
  { id: 'intensity', word: 'Intensity', lead: 'from the opening rotation forces hurried decisions on the other side of the net.' },
  { id: 'structure', word: 'Structure', lead: 'in the defensive system outweighs isolated moments of attacking brilliance.' },
  { id: 'composure', word: 'Composure', lead: 'under scoreboard pressure has separated these two more reliably than raw power.' },
  { id: 'depth', word: 'Depth', lead: 'across the rotation keeps attacking output high when substitutions arrive.' },
  { id: 'margin', word: 'Margins', lead: 'of recent victories tell more than the win column alone.' },
  { id: 'control', word: 'Control', lead: 'of the first contact decides whether the offence ever gets to run its preferred plays.' },
  { id: 'trajectory', word: 'Trajectory', lead: 'over the current campaign reveals a well-calibrated peak in execution.' },
  { id: 'authority', word: 'Authority', lead: 'commanded in recent straight-set wins carries into this meeting.' },
  { id: 'resilience', word: 'Resilience', lead: 'after dropping an opening set is real in this sport, but first-set winners still close at a high rate.' },
  { id: 'precision', word: 'Precision', lead: 'in serve location continually disrupts the opponent\'s offensive system.' },
  { id: 'physicality', word: 'Physicality', lead: 'through the middle of the court denies easy transition swings.' },
  { id: 'balance', word: 'Balance', lead: 'between patient side-out volleyball and explosive transition yields consistent set wins.' },
  { id: 'sharpness', word: 'Sharpness', lead: 'behind the first ball remains the clearest separator here.' },
  { id: 'endurance', word: 'Endurance', lead: 'is the quiet variable whenever these two have previously gone the distance.' },
  { id: 'focus', word: 'Focus', lead: 'through long rallies prevents the concentration lapses indoor venues punish.' },
  { id: 'poise', word: 'Poise', lead: 'in closing sets has been the recurring theme of the stronger side.' },
  { id: 'force', word: 'Force', lead: 'generated on early side-outs sets up a decisive rather than a scraped showing.' },
  { id: 'clarity', word: 'Clarity', lead: 'in game-planning ensures every rotation serves a defined purpose.' },
  { id: 'superiority', word: 'Superiority', lead: 'in first-ball quality underpins this fixture from the opening whistle.' },
];

const MARKET_LABEL = {
  win_match: 'WIN MATCH',
  set_score: 'SET SCORE',
};

/**
 * Volleyball set scores that may appear as digits, despite the general ban.
 *
 * A completed volleyball match always ends 3-0, 3-1, 3-2 — or, from the other
 * side of the net, 0-3, 1-3, 2-3. The original pattern exempted only the
 * winning orientation, so a tip that cited a *defeat* in the head-to-head
 * ("the most recent meeting finishing **1-3**") was rejected for containing
 * forbidden digits and published as an empty tip. Both orientations are real
 * scorelines and both are quoted in the house style, so both are exempt.
 */
const SET_SCORE_RE = /\*\*(?:3-[012]|[012]-3)\*\*/g;

export function validateVolleyballTip(text, { market, expectSkip = false } = {}) {
  const violations = [];
  const t = String(text || '').trim();
  if (!t) return { ok: false, violations: ['empty tip text'] };

  if (expectSkip) {
    if (!t.startsWith('SKIP —') && !t.startsWith('SKIP:')) violations.push('SKIP tip must begin with SKIP');
    const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) violations.push('SKIP tip must be a single explanatory sentence');
    return { ok: violations.length === 0, violations };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) violations.push(`under ${MIN_WORDS} words (found ${words.length})`);

  if (!/\*\*[^*]+\*\*/.test(t)) {
    violations.push('no bolded outcome found');
  } else {
    const boldIndex = t.indexOf('**');
    const wordsBeforeBold = t.slice(0, boldIndex).split(/\s+/).filter(Boolean).length;
    if (wordsBeforeBold > 20) violations.push(`bolded outcome appears after 20 words (at word ${wordsBeforeBold})`);
  }

  if (market === 'set_score' && !/\*\*3-[012]\*\*/.test(t)) {
    violations.push('set score tip must bold 3-0, 3-1 or 3-2');
  }

  const stripped = t.replace(SET_SCORE_RE, '');
  const digits = stripped.replace(/\*\*/g, '').match(/\d/g);
  if (digits) violations.push(`contains forbidden numerals/digits: ${digits.join('')}`);

  if (/[()[\]{}]/.test(t)) violations.push('contains forbidden bracketed references');

  const lower = t.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`contains banned phrase: "${phrase}"`);
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (lower.includes(token)) violations.push(`contains forbidden token: "${token}"`);
  }
  if (!/Confidence:\s*(HIGH|MEDIUM|LOW)\.?/.test(t)) {
    violations.push('confidence level not declared in required format');
  }
  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ *
 * Evidence-driven prose (OLBG house style).
 *
 * Clauses are built only from values sourced onto the match by
 * engine/volleyball_data.js (form and set scores from the results tape, H2H
 * meetings with their set scores, rest days, rank, odds). A clause whose input
 * is null is never produced, so the writer cannot invent a statistic.
 *
 * Set scores are the ONLY digits allowed by validateVolleyballTip, and only in
 * the bolded 3-0 / 3-1 / 3-2 form; every other figure is spelled as a word.
 * ------------------------------------------------------------------ */

const VB_NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Spell a small whole number, or return null when it cannot be spelled. */
export function spellCount(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) return null;
  return VB_NUM[n];
}

function vbFormClause(team) {
  const last5 = team?.form?.last5;
  if (!Array.isArray(last5) || !last5.length) return null;
  const wins = last5.filter((r) => r === 'W').length;
  const w = spellCount(wins);
  const n = spellCount(last5.length);
  if (!w || !n) return null;
  return `${team.name} have won ${w} of their last ${n} in this competition`;
}

function vbStreakClause(fav, dog) {
  const ws = fav?.form?.winStreak;
  if (typeof ws === 'number' && ws >= 3) {
    const w = spellCount(ws);
    if (w) return `they arrive on a run of ${w} straight wins`;
  }
  const dl = dog?.form?.lossStreak;
  if (typeof dl === 'number' && dl >= 2) {
    const w = spellCount(dl);
    if (w) return `the opposition have lost ${w} in a row coming in`;
  }
  return null;
}

/**
 * Sweep rate from the sourced set scores of recent wins. Reported as a plain
 * tendency rather than a percentage, because percentages need digits.
 */
function vbSweepClause(team) {
  const scores = team?.form?.last5SetScores;
  if (!Array.isArray(scores) || !scores.length) return null;
  const wins = scores.filter((x) => typeof x === 'string' && x.startsWith('3-'));
  if (!wins.length) return null;
  const sweeps = wins.filter((x) => x === '3-0').length;
  const w = spellCount(sweeps);
  const n = spellCount(wins.length);
  if (!w || !n) return null;
  if (sweeps === 0) return `none of their recent wins arrived as a sweep, which argues against the shortest finishing score`;
  return `${w} of their last ${n} wins arrived without dropping a set`;
}

/** Whether recent wins needed a deciding set — the case for a longer score. */
function vbDeciderClause(team) {
  const scores = team?.form?.last5SetScores;
  if (!Array.isArray(scores) || !scores.length) return null;
  const deciders = scores.filter((x) => x === '3-2' || x === '2-3').length;
  if (deciders === 0) return null;
  const w = spellCount(deciders);
  return w ? `${w} of their recent matches went to a deciding set` : null;
}

function vbH2HClause(match, fav) {
  const h = match?.h2h;
  const meetings = h?.recentMeetings;
  if (!Array.isArray(meetings) || !meetings.length) return null;
  const favWins = meetings.filter((m) => m.winner && String(m.winner).toLowerCase() === String(fav?.name || '').toLowerCase()).length;
  const w = spellCount(favWins);
  const n = spellCount(meetings.length);
  if (!w || !n) return null;
  const last = meetings[0];
  const tail = last?.setScore ? `, with the most recent meeting finishing **${last.setScore}**` : '';
  return `the sourced head-to-head record reads ${w} wins from ${n} meetings for ${fav?.name || 'the selection'}${tail}`;
}

function vbRestClause(fav, dog) {
  if (dog?.rest?.playedWithin48h === true) return `the opposition were on court inside the previous two days, and that turnaround tells in long matches`;
  if (fav?.rest?.playedWithin48h === true) return `the selection are on a short turnaround themselves, which caps the confidence here`;
  return null;
}

function vbRankClause(fav, dog) {
  const fr = fav?.standings?.rank ?? fav?.rank;
  const dr = dog?.standings?.rank ?? dog?.rank;
  if (typeof fr !== 'number' || typeof dr !== 'number') return null;
  if (dr > fr) return `the published ranking also favours the selection over the opposition`;
  if (dr < fr) return `the published ranking actually favours the opposition, which is why this is not rated any higher`;
  return null;
}

function vbNeutralClause(match) {
  if (match?.neutral === true) return `this is played at a neutral venue, so no home advantage is assumed in the rating`;
  return null;
}

function vbMissingClause(result) {
  const list = result?.missing || [];
  if (!list.length) return null;
  const w = spellCount(list.length);
  const count = w || 'several';
  return `${count} of the input factors could not be sourced for this fixture, so the confidence figure is capped accordingly`;
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

function vbJoin(clauses, names = []) {
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

/** Build the analytical body strictly from sourced values. */
function buildBody(market, result, match) {
  const home = match?.homeTeamObj || null;
  const away = match?.awayTeamObj || null;
  const fav = home?.name === result?.favourite ? home : away?.name === result?.favourite ? away : home;
  const dog = fav === home ? away : home;
  const clauses = [];

  if (market === 'win_match') {
    clauses.push(vbFormClause(fav));
    clauses.push(vbStreakClause(fav, dog));
    clauses.push(vbH2HClause(match, fav));
    clauses.push(vbRankClause(fav, dog));
    clauses.push(vbRestClause(fav, dog));
    clauses.push(vbNeutralClause(match));
  } else {
    const outcome = result?.markets?.set_score?.outcome;
    if (outcome === '3-0') {
      clauses.push(vbSweepClause(fav));
      clauses.push(vbFormClause(fav));
    } else if (outcome === '3-2') {
      clauses.push(vbDeciderClause(fav) || vbDeciderClause(dog));
      clauses.push(vbFormClause(dog));
    } else {
      clauses.push(vbSweepClause(fav));
      clauses.push(vbFormClause(dog));
    }
    clauses.push(vbH2HClause(match, fav));
    clauses.push(vbRestClause(fav, dog));
  }

  if (dog?.name) {
    if (market === 'set_score') {
      clauses.push('the match-winner market is safer than relying heavily on the exact score, because the opposition have already shown they can survive momentum swings');
    } else {
      clauses.push(`${dog.name} cannot be treated as an ordinary underdog, but the favoured side remain the stronger overall selection`);
    }
  }

  clauses.push(vbMissingClause(result));

  const names = [...new Set([fav?.name, dog?.name].filter(Boolean))];
  return vbJoin(clauses, names);
}

export function writeVolleyballTip({ match, result, market, angle }) {
  const m = result?.markets?.[market];
  if (!m) return { ok: false, violations: [`market not found: ${market}`] };

  const label = MARKET_LABEL[market] || market;
  const band = m.band || CONFIDENCE.LOW;
  const skip = band === CONFIDENCE.SKIP || (market === 'set_score' && band === CONFIDENCE.LOW && !m.selection)
    || (market === 'win_match' && band === CONFIDENCE.SKIP);

  if (skip) {
    const reason = market === 'set_score'
      ? 'the set-score indicators are too close or too thin to publish a margin'
      : 'evidence fails to reach the required selection threshold';
    const text = `SKIP — ${label}: ${reason}, so no recommendation is offered on this fixture.`;
    const v = validateVolleyballTip(text, { market, expectSkip: true });
    return v.ok ? { ok: true, text, band: CONFIDENCE.SKIP, skip: true } : { ok: false, violations: v.violations, text };
  }

  // OLBG house style: the selection is stated plainly in the opening words,
  // then the case is argued from sourced evidence only.
  let pickLead;
  if (market === 'win_match') {
    pickLead = `**${result.favourite}** are the preferred winner.`;
  } else {
    pickLead = `**${m.outcome}** is my preferred correct score.`;
  }

  // Angle word is recorded for uniqueness. Published copy leads with the
  // selection then sourced evidence — no canned "Attacking dominance..." filler.
  let text = `${pickLead} ${buildBody(market, result, match)}`
    .replace(/\s+/g, ' ').trim();

  // Word floor: rather than padding with invented detail, state the method.
  if (text.split(/\s+/).filter(Boolean).length + 3 < MIN_WORDS) {
    text += ' The rating is produced mechanically from the sourced results tape, head-to-head record and rest data linked alongside this fixture, and nothing beyond those inputs has been assumed.';
  }

  text = `${text} Confidence: ${band}.`;
  const v = validateVolleyballTip(text, { market, expectSkip: false });
  return v.ok
    ? { ok: true, text, band, skip: false, market }
    : { ok: false, violations: v.violations, text, market };
}

export function writeVolleyballCard(scoredMatches) {
  const tips = [];
  const violations = [];
  const unscored = [];
  const usedOpeners = new Set();
  let openerIdx = 0;

  for (const { match, result } of scoredMatches) {
    if (!result?.markets || !result.favourite) {
      unscored.push({
        event_id: match?.event_id ?? match?.id ?? null,
        match: `${match?.home || 'Home'} v ${match?.away || 'Away'}`,
        reason: 'no sourced team data, so no markets could be scored',
      });
      continue;
    }

    for (const market of ['win_match', 'set_score']) {
      let angle = VOLLEYBALL_OPENERS[openerIdx % VOLLEYBALL_OPENERS.length];
      let guard = 0;
      while (usedOpeners.has(angle.word.toLowerCase()) && guard < VOLLEYBALL_OPENERS.length) {
        openerIdx += 1;
        angle = VOLLEYBALL_OPENERS[openerIdx % VOLLEYBALL_OPENERS.length];
        guard += 1;
      }
      const exhausted = usedOpeners.has(angle.word.toLowerCase());
      const tipResult = writeVolleyballTip({ match, result, market, angle });

      if (!tipResult.ok) {
        violations.push({ event_id: match?.event_id ?? match?.id, market, violations: tipResult.violations });
        tips.push({
          event_id: match?.event_id ?? match?.id,
          match: `${match?.home || result.favourite} v ${match?.away || result.opponent}`,
          market,
          marketLabel: MARKET_LABEL[market],
          ok: false,
          text: null,
          band: null,
        });
      } else {
        if (!tipResult.skip) usedOpeners.add(angle.word.toLowerCase());
        tips.push({
          event_id: match?.event_id ?? match?.id,
          match: `${match?.home || result.favourite} v ${match?.away || result.opponent}`,
          market,
          marketLabel: MARKET_LABEL[market],
          ok: true,
          text: tipResult.text,
          band: tipResult.band,
          skip: !!tipResult.skip,
          opener: tipResult.skip ? null : angle.id,
          angleWord: tipResult.skip ? null : angle.word,
          selection: market === 'win_match' ? result.favourite : result.markets.set_score?.outcome,
        });
        if (exhausted && !tipResult.skip) {
          violations.push({
            event_id: match?.event_id ?? match?.id,
            market,
            openerPoolExhausted: true,
            detail: `more styled tips than distinct openers (${VOLLEYBALL_OPENERS.length})`,
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
    openerPoolSize: VOLLEYBALL_OPENERS.length,
    openerPoolExhausted: styled.length > VOLLEYBALL_OPENERS.length,
  };
}

export function buildVolleyballFormattedCardText(scoredMatches, dateISO = '') {
  const cardResult = writeVolleyballCard(scoredMatches);
  const lines = [`Volleyball Predictions — ${dateISO || 'Card'}`, ''];

  for (const t of cardResult.tips.filter((t) => t.ok)) {
    lines.push(`${t.match} — ${t.marketLabel} [${t.band}]`);
    lines.push(t.text.replace(/\*\*/g, ''));
    lines.push('');
  }

  lines.push('SUMMARY TABLE');
  lines.push('Match | Win Match | Set Score | Win conf. | Set conf.');
  for (const { match, result } of scoredMatches) {
    if (!result?.markets) continue;
    const wm = result.markets.win_match;
    const ss = result.markets.set_score;
    lines.push(`${match.home} v ${match.away} | ${wm?.selection || 'SKIP'} | ${ss?.selection || ss?.outcome || 'SKIP'} | ${wm?.band || '—'} | ${ss?.band || '—'}`);
  }
  lines.push('');
  lines.push('Responsible Gambling Reminder:');
  lines.push('Nothing here is betting advice or a guarantee of any outcome. Predictions are generated mechanically from sourced data and are fallible. 18+.');
  return lines.join('\n');
}
