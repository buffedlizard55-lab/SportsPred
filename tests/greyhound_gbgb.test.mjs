/**
 * Tests for the GBGB official-API parsers and the card builder.
 *
 * The meeting-payload fixture mirrors the real api.gbgb.org.uk shape (verified
 * 2026-09-02): one settled A5 race with SPs, run times and comments, and one
 * upcoming OR1 heat with the declared draw but no results. The parser must
 * never invent a field and must drop trials.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseMeetingPayload, parseDogHistory, parseMeetingRace, normDateISO, normTime,
  isBetRace, raceStatus, GBGB_API_BASE,
} from '../engine/greyhound_gbgb.js';
import { buildRunnerProfile, enrichRace, formString } from '../engine/greyhound_data.js';
import { buildGreyhoundDayCard, historyIndex, racesFromDoc } from '../engine/greyhound_card.js';

const meetingPayload = [
  {
    meetingDate: '02/09/2026', meetingId: 451800, trackName: 'Yarmouth',
    races: [
      {
        raceTime: '20:47:00', raceDate: '02/09/2026', raceId: 1240674, raceNumber: '10',
        raceType: 'Flat', raceClass: 'OR1', raceDistance: 462.0,
        raceTitle: 'East Anglian Derby Heat 6', racePrizes: '1st £250 | Others £75',
        traps: [
          { trapNumber: '1', dogId: 657011, dogName: 'Jimmyjimmyjimmy', trainerName: 'P W Young' },
          { trapNumber: '4', dogId: 651042, dogName: 'Strathrannoch', trainerName: 'I J Barnard' },
          { trapNumber: '2', dogId: 641943, dogName: 'Outdoor Cracker', trainerName: 'E G Samuels' },
        ],
      },
      {
        raceTime: '18:31:00', raceDate: '02/09/2026', raceId: 1240666, raceNumber: '2',
        raceType: 'Flat', raceClass: 'A5', raceDistance: 462.0, racePrizes: '1st £115',
        raceForecast: '(6-2) £4.96', raceTricast: null,
        traps: [
          { trapNumber: '6', dogId: 657190, dogName: 'Ballycowen Alfie', trainerName: 'E G Samuels', SP: '11/4', resultPosition: 1, resultRunTime: '28.15', resultComment: 'W,LdRnUp' },
          { trapNumber: '2', dogId: 665880, dogName: 'Golden Hare', trainerName: 'K J Cobbold', SP: '8/13F', resultPosition: 2, resultRunTime: '28.38', resultComment: 'MidTRls,Crd1' },
          { trapNumber: '5', dogId: 659263, dogName: 'Lady Wright', trainerName: 'I J Barnard' }, // non-runner / vacant
        ],
      },
      {
        // Trial must be excluded.
        raceTime: '09:00:00', raceDate: '02/09/2026', raceId: 1240700, raceNumber: 'T1',
        raceType: 'Trial', raceClass: 'T3', raceDistance: 462.0,
        traps: [{ trapNumber: '1', dogId: 1, dogName: 'Schooling Pup', resultPosition: 1 }],
      },
    ],
  },
];

test('date and time normalisation', () => {
  assert.equal(normDateISO('02/09/2026'), '2026-09-02');
  assert.equal(normDateISO('bad'), null);
  assert.equal(normTime('20:47:00'), '20:47');
});

test('trials are excluded and bet races identified', () => {
  assert.equal(isBetRace({ raceType: 'Flat', raceClass: 'A5' }), true);
  assert.equal(isBetRace({ raceType: 'Trial', raceClass: 'T3' }), false);
  assert.equal(isBetRace({ raceType: 'Flat', raceClass: 'T2' }), false);
});

test('meeting payload parses draws, results and status', () => {
  const races = parseMeetingPayload(meetingPayload);
  assert.equal(races.length, 2); // trial dropped
  const upcoming = races.find((r) => r.raceId === 1240674);
  const settled = races.find((r) => r.raceId === 1240666);
  assert.equal(raceStatus(meetingPayload[0].races[0]), 'scheduled');
  assert.equal(raceStatus(meetingPayload[0].races[1]), 'result');
  assert.equal(upcoming.status, 'scheduled');
  assert.equal(settled.status, 'result');

  // runners sorted by trap
  assert.deepEqual(upcoming.runners.map((r) => r.trap), [1, 2, 4]);
  assert.equal(upcoming.runners[0].name, 'Jimmyjimmyjimmy');
  assert.equal(upcoming.grade, 'OR1');
  assert.equal(upcoming.distance, 462);

  // settled result facts
  assert.equal(settled.winnerName, 'Ballycowen Alfie');
  assert.equal(settled.winnerTrap, 6);
  assert.equal(settled.winnerSP, '11/4');
  assert.equal(settled.nonRunners, 3); // six-trap card expectation
  const winner = settled.runners.find((r) => r.position === 1);
  assert.equal(winner.runTime, 28.15);
  assert.equal(winner.comment, 'W,LdRnUp');
});

test('dog history parser keeps bet races newest first and drops trials', () => {
  const payload = {
    items: [
      { raceDate: '02/09/2026', trackName: 'Romford', raceClass: 'A4', raceDistance: 400.0, trapNumber: '2', resultPosition: 1, SP: '11/4', resultRunTime: '24.20', raceId: 1, meetingId: 9 },
      { raceDate: '29/08/2026', trackName: 'Romford', raceClass: 'T2', raceDistance: 400.0, trapNumber: '1', resultPosition: 1, raceId: 2, meetingId: 8 },
      { raceDate: '17/08/2026', trackName: 'Romford', raceClass: 'A3', raceDistance: 400.0, trapNumber: '2', resultPosition: 5, SP: '8/1', resultRunTime: '24.82', raceId: 3, meetingId: 7 },
    ],
  };
  const runs = parseDogHistory(payload);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].position, 1);
  assert.equal(runs[0].grade, 'A4');
  assert.equal(runs[1].position, 5);
});

test('runner profile aggregates trap, track and distance records', () => {
  const history = [
    { position: 1, trap: 4, track: 'Yarmouth', grade: 'OR1', distance: 462, runTime: 27.74 },
    { position: 1, trap: 4, track: 'Yarmouth', grade: 'OR1', distance: 462, runTime: 27.91 },
    { position: 3, trap: 2, track: 'Romford', grade: 'A1', distance: 400, runTime: 24.55 },
  ];
  const runner = { dogId: 651042, name: 'Strathrannoch', trap: 4 };
  const race = { track: 'Yarmouth', distance: 462, grade: 'OR1' };
  const p = buildRunnerProfile(runner, history, race);
  assert.equal(p.stats.trapWins, 2);
  assert.equal(p.stats.trackWins, 2);
  assert.equal(p.stats.distanceWins, 2);
  assert.equal(p.stats.last5Places, 3);
  assert.equal(formString(p), '113--');
  assert.equal(p.stats.cdBest, 27.74);
});

test('end-to-end day card from committed fixture data produces written, valid tips', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const meetingsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/greyhound_meetings.json'), 'utf-8'));
  const historyDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/greyhound_history.json'), 'utf-8'));
  assert.ok(racesFromDoc(meetingsDoc).length >= 2);
  const idx = historyIndex(historyDoc);
  assert.ok(idx.size >= 10);

  const card = buildGreyhoundDayCard({ meetingsDoc, historyDoc }, { date: '2026-09-02' });
  assert.equal(card.validation.ok, true, JSON.stringify(card.validation.issues));
  const tips = card.written.tips;
  assert.ok(tips.length >= 2);
  const pick = tips.find((t) => !t.skip);
  assert.ok(pick, 'at least one written selection');
  assert.match(pick.text, /Confidence: (LOW|MEDIUM|HIGH)\./);
  assert.ok(card.written.summaryTable.rows.length >= 1);
  assert.match(card.written.responsibleGambling, /18\+/);
  // every selected tip carries the official review source in its race record
  for (const r of card.races) {
    if (r.status === 'result' || r.cardSelected) assert.ok(String(r.sourceUrl || '').includes(GBGB_API_BASE));
  }
});

test('parseMeetingRace tolerates missing fields without inventing values', () => {
  const minimal = parseMeetingRace(
    { raceId: 1, raceTime: '18:00:00', raceDate: '02/09/2026', raceClass: '', raceDistance: null, traps: [] },
    { meetingId: 1, trackName: 'Nowhere', meetingDate: '02/09/2026' },
  );
  assert.equal(minimal.grade, null);
  assert.equal(minimal.distance, null);
  assert.deepEqual(minimal.runners, []);
  // No runners means no winner and no invented vacancies (an undeclared card
  // must not be reported as six scratchings).
  assert.equal(minimal.winnerName, null);
  assert.equal(minimal.nonRunners, 0);
});
