#!/usr/bin/env node
/**
 * Walk-forward backtest over the committed volleyball tape.
 * Each completed match is scored using ONLY earlier matches in the SAME family.
 * NCAA form never grades a EuroVolley fixture.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { enrichVolleyballMatch } from '../engine/volleyball_data.js';
import { scoreVolleyballMatch } from '../engine/volleyball_engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAPE = join(ROOT, 'data', 'volleyball_tape.json');
const OUT = join(ROOT, 'data', 'volleyball_backtest.json');

function invert(s) {
  const m = String(s || '').match(/^(\d)-(\d)$/);
  return m ? `${m[2]}-${m[1]}` : s;
}

function main() {
  const tapeDoc = JSON.parse(readFileSync(TAPE, 'utf8'));
  const all = [...(tapeDoc.matches || [])]
    .filter((m) => m.phase === 'results' && m.winner)
    .sort((a, b) => String(a.startUtc || a.date).localeCompare(String(b.startUtc || a.date)));

  const graded = [];
  for (let i = 0; i < all.length; i += 1) {
    const m = all[i];
    const prior = all.slice(0, i);
    const raw = {
      id: m.id,
      family: m.family,
      phase: 'upcoming',
      date: m.date,
      startUtc: m.startUtc,
      home: m.home,
      away: m.away,
      venue: m.venue,
      neutral: true,
    };
    const enriched = enrichVolleyballMatch(raw, prior);
    const scored = scoreVolleyballMatch(enriched);
    const wm = scored.markets.win_match;
    const ss = scored.markets.set_score;
    const actualScore = m.setsIncomplete ? null : m.setScore;
    const winnerIsHome = m.winner === m.home;
    const winnerSet = actualScore
      ? (winnerIsHome ? actualScore : invert(actualScore))
      : null;
    graded.push({
      id: m.id,
      family: m.family,
      date: m.date,
      match: `${m.home} v ${m.away}`,
      actualWinner: m.winner,
      actualSetScore: winnerSet,
      winPick: wm.selection,
      winBand: wm.band,
      winHit: wm.selection ? wm.selection === m.winner : null,
      setPick: ss.selection,
      setBand: ss.band,
      setHit: ss.selection && winnerSet ? ss.selection === winnerSet : null,
    });
  }

  const published = graded.filter((g) => g.winHit !== null);
  const winHits = published.filter((g) => g.winHit).length;
  const setPub = graded.filter((g) => g.setHit !== null);
  const setHits = setPub.filter((g) => g.setHit).length;

  const out = {
    schema_version: 1,
    sport: 'Volleyball',
    generated_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    method: 'Walk-forward over committed tape rows in the same competition family. No NCAA row is visible to a EuroVolley fixture.',
    events: graded.length,
    summary: [
      { market: 'win_match', graded: published.length, hits: winHits, hitRate: published.length ? Number((winHits / published.length).toFixed(4)) : null },
      { market: 'set_score', graded: setPub.length, hits: setHits, hitRate: setPub.length ? Number((setHits / setPub.length).toFixed(4)) : null },
    ],
    rows: graded,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Volleyball backtest: ${graded.length} events, win ${winHits}/${published.length}, set ${setHits}/${setPub.length}`);
}

main();
