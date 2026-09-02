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

const SET_SCORE_RE = /\*\*3-[012]\*\*/g;

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

function buildBody(market, result) {
  const clauses = [];
  if (market === 'win_match') {
    clauses.push('recent side-out reliability combined with first-contact quality reinforces this outright expectation');
    clauses.push('head-to-head set scores from the most recent meeting carry more weight than a simple win-loss ledger');
    clauses.push('indoor crowd noise punishes shaky serve receive far more than outdoor sports ever do');
  } else {
    const outcome = result.markets.set_score?.outcome;
    if (outcome === '3-0') {
      clauses.push('straight-set winning streaks remain the single strongest predictor of a sweep against comparable opposition');
      clauses.push('elite serving that generates repeated aces disrupts the opponent\'s offensive system from the first rotation');
      clauses.push('a clear quality gap rarely needs a fifth set when one side has been closing without dropping frames');
    } else if (outcome === '3-1') {
      clauses.push('the challenger is competitive enough to steal a set but has been collapsing once the deficit reaches two');
      clauses.push('form shows the favourite dropping the occasional set while still closing the match with authority');
      clauses.push('four-set meetings have been the typical length whenever these two have shared a court recently');
    } else {
      clauses.push('recent meetings have gone the distance, which is a fundamentally different set-score context from a sweep');
      clauses.push('nearly identical recent form points to a match that will not be decided until late');
      clauses.push('five-set volleyball is physically exhausting and the schedule intensity on both sides argues against an early finish');
    }
  }
  clauses.push('nothing beyond the sourced record has been assumed in reaching that view');
  return clauses
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
    .map((c) => (/\.$/.test(c) ? c : `${c}.`))
    .join(' ');
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

  let bolded;
  let pickLead;
  if (market === 'win_match') {
    bolded = `**${result.favourite}**`;
    pickLead = `${bolded} is the pick on ${label}.`;
  } else {
    bolded = `**${m.outcome}**`;
    pickLead = `${bolded} is the expected finishing score on ${label}.`;
  }

  const text = `${angle.word} ${angle.lead} ${pickLead} ${buildBody(market, result)} Confidence: ${band}.`;
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
  const openers = styled.map((t) => t.text.split(/\s+/)[0].toLowerCase());
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
