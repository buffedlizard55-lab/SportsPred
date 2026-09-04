/**
 * SportsPred — event-profile registry for the golf layer.
 *
 * Some tournaments carry their own master prompt because the generic
 * GOLF TOURNAMENT PREDICTION MASTER PROMPT v1.0 is deliberately calibrated for
 * an average tour stop. This module is the single place that decides which
 * ruleset an event is scored under, so the site, the walk-forward backtest and
 * the prediction ledger can never disagree about it.
 *
 *   no profile match  → engine/golf_engine.js  (GOLF TOURNAMENT … v1.0)
 *   scottish-open     → engine/golf_scottish_open.js (SCOTTISH OPEN … v1.0)
 *
 * Adding an overlay means adding one entry to PROFILES. Nothing else changes:
 * `scoreEvent` and `writeEventCard` dispatch on the match, and the generic
 * engine is untouched.
 */

import { scoreGolfEvent } from './golf_engine.js';
import { writeGolfCard, validateGolfCard } from './golf_writer.js';
import {
  matchScottishOpen, scoreScottishOpen, writeScottishOpenCard, validateScottishOpenCard,
  RULESET_VERSION as SO_RULESET, PROMPT_TITLE as SO_PROMPT, PROMPT_DOC as SO_DOC,
} from './golf_scottish_open.js';

export const PROFILES = Object.freeze([
  {
    id: 'scottish-open',
    label: 'Scottish Open overlay',
    prompt: SO_PROMPT,
    doc: SO_DOC,
    ruleset: SO_RULESET,
    match: matchScottishOpen,
    score: scoreScottishOpen,
    write: writeScottishOpenCard,
    validate: validateScottishOpenCard,
  },
]);

/** @returns {object|null} the matching profile, or null for the generic ruleset. */
export function matchEventProfile(event) {
  for (const p of PROFILES) {
    const hit = p.match(event);
    if (hit) return { ...p, match: hit };
  }
  return null;
}

/** Score an event under whichever ruleset its profile selects. */
export function scoreEvent(event, profiles, ctx) {
  const profile = matchEventProfile(event);
  if (!profile) return scoreGolfEvent(event, profiles, ctx);
  const scored = profile.score(event, profiles, ctx);
  return { ...scored, profile: { id: profile.id, label: profile.label, prompt: profile.prompt, doc: profile.doc, ruleset: profile.ruleset, match: profile.match } };
}

/** Write the card for an event under whichever ruleset scored it. */
export function writeEventCard(scored, event, weather = null) {
  if (!scored || scored.unscored) return null;
  const profile = scored.profile ? PROFILES.find((p) => p.id === scored.profile.id) : null;
  return profile ? profile.write(scored, event) : writeGolfCard(scored, event, weather);
}

/** Validate a written card with the rules of the ruleset that wrote it. */
export function validateEventCard(scored, written) {
  if (!written) return null;
  const profile = scored?.profile ? PROFILES.find((p) => p.id === scored.profile.id) : null;
  return profile ? profile.validate(written) : validateGolfCard(written);
}

export { matchScottishOpen };
