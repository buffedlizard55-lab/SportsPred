/**
 * NPB source parsers, exercised against the verbatim npb.jp captures under
 * tests/fixtures/npb_*.CAPTURE.md. Every expected number below was read by
 * hand from the capture body (and, where it exists, from the live page on the
 * capture date) — see the header of each capture for URL and fetch date.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCalendarMonth, parseStandings, parseScheduleDetail, parseJaBoxScore,
  parseBoxScore, parseTeamPitching, parseTeamBatting,
  NPB_TEAMS, CENTRAL, PACIFIC, leagueOf, dhStatus, roofFor, venueFromJa, jstToUtc, teamByCode, WEATHER_ICON,
} from '../engine/npb_source.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'tests', 'fixtures');
const capture = (f) => readFileSync(join(FIX, f), 'utf8').split('\n---\n').slice(1).join('\n---\n');
const html = (f) => readFileSync(join(FIX, f), 'utf8');

test('team table: 12 clubs, 6 per league, codes match npb.jp', () => {
  assert.equal(Object.keys(NPB_TEAMS).length, 12);
  assert.deepEqual([...CENTRAL].sort(), ['C', 'D', 'DB', 'G', 'S', 'T']);
  assert.deepEqual([...PACIFIC].sort(), ['B', 'E', 'F', 'H', 'L', 'M']);
  assert.equal(teamByCode('DB').name, 'Yokohama DeNA BayStars');
  assert.equal(leagueOf('T', 'G'), 'central');
  assert.equal(leagueOf('H', 'L'), 'pacific');
  assert.equal(leagueOf('T', 'H'), 'interleague');
});

test('DH rule: CL no DH through 2026, universal from 2027, PL and interleague at PL parks use it', () => {
  assert.equal(dhStatus(2026, 'central', 'central').dh, false);
  assert.equal(dhStatus(2026, 'pacific', 'pacific').dh, true);
  assert.equal(dhStatus(2026, 'pacific', 'interleague').dh, true);
  assert.equal(dhStatus(2026, 'central', 'interleague').dh, false);
  assert.equal(dhStatus(2027, 'central', 'central').dh, true);
});

test('venues: roof table and Japanese labels', () => {
  assert.equal(roofFor('Tokyo Dome'), 'dome');
  assert.equal(roofFor('ES CON FIELD'), 'retractable');
  assert.equal(roofFor('Jingu'), 'open');
  assert.equal(roofFor('Koshien'), 'open');
  assert.equal(venueFromJa('神　宮'), 'Jingu');
  assert.equal(venueFromJa('京セラD大阪'), 'Kyocera Dome');
  assert.equal(roofFor('Nowhere Park'), null, 'unknown venues are null, never guessed');
});

test('jstToUtc: 18:00 JST is 09:00Z the same day', () => {
  assert.equal(jstToUtc('2026-09-04', '18:00'), '2026-09-04T09:00:00Z');
  assert.equal(jstToUtc('2026-09-05', '14:00'), '2026-09-05T05:00:00Z');
});

test('calendar July 2026: 134 results, 4 postponed, 2 draws, All-Star rows skipped', () => {
  const r = parseCalendarMonth(capture('npb_calendar_2026_07.CAPTURE.md'), { season: 2026 });
  assert.equal(r.results.length, 134);
  assert.equal(r.results.filter((g) => g.postponed).length, 4);
  assert.equal(r.results.filter((g) => g.draw).length, 2);
  const first = r.results[0];
  assert.deepEqual([first.dateISO, first.home, first.away, first.homeScore, first.awayScore, first.winner], ['2026-07-01', 'G', 'S', 2, 1, 'G']);
  assert.equal(first.url, 'https://npb.jp/bis/eng/2026/games/s2026070101258.html');
  const td = r.results.find((g) => g.dateISO === '2026-07-01' && g.home === 'T');
  assert.equal(td.postponed, true, 'T * - * D on 7/1 is a postponement, not a 0-0');
  const draw = r.results.find((g) => g.dateISO === '2026-07-02' && g.home === 'DB');
  assert.deepEqual([draw.away, draw.homeScore, draw.awayScore, draw.draw, draw.winner], ['C', 3, 3, true, null]);
  assert.ok(r.warnings.every((w) => /CL\/PL|PL\/CL/.test(w)), 'the only warnings are the All-Star rows');
});

test('calendar September 2026: results through 9/2, upcoming rows carry JST times, home listed first', () => {
  const r = parseCalendarMonth(capture('npb_calendar_2026_09.CAPTURE.md'), { season: 2026 });
  const fh = r.results.find((g) => g.dateISO === '2026-09-02' && g.home === 'F');
  assert.deepEqual([fh.away, fh.homeScore, fh.awayScore, fh.draw], ['H', 1, 1, true]);
  const up = r.upcoming.filter((u) => u.dateISO === '2026-09-04');
  assert.equal(up.length, 5);
  assert.deepEqual(up.map((u) => `${u.home}-${u.away}`), ['S-D', 'C-G', 'E-F', 'B-M', 'H-L']);
  assert.ok(up.every((u) => u.startLocal === '18:00'));
  const bm5 = r.upcoming.find((u) => u.dateISO === '2026-09-05' && u.home === 'B');
  assert.equal(bm5.startLocal, '14:00');
  assert.equal(r.upcoming.filter((u) => u.dateISO === '2026-09-07').length, 0, 'Monday off-day');
});

test('standings Central (captured 2026-09-03): W-L-T, home/road, per-opponent, interleague, draw rate', () => {
  const r = parseStandings(capture('npb_std_c.CAPTURE.md'), 'central');
  assert.equal(r.teams.length, 6);
  const t = r.teams[0];
  assert.deepEqual([t.code, t.wins, t.losses, t.ties, t.pct], ['T', 69, 50, 1, 0.58]);
  assert.deepEqual(t.home, { w: 30, l: 25, t: 1 });
  assert.deepEqual(t.road, { w: 39, l: 25, t: 0 });
  assert.deepEqual(t.vs.G, { w: 16, l: 7, t: 0 });
  assert.deepEqual(t.interleague, { w: 6, l: 12, t: 0 });
  assert.equal(t.drawRate, 0.0083);
  const c = r.teams.find((x) => x.code === 'C');
  assert.deepEqual([c.wins, c.losses, c.ties, c.drawRate], [49, 64, 4, 0.0342]);
  assert.deepEqual(c.vs.DB, { w: 7, l: 12, t: 2 });
  assert.deepEqual(r.teams.map((x) => x.code), ['T', 'G', 'DB', 'S', 'C', 'D']);
});

test('standings Pacific (captured 2026-09-03)', () => {
  const r = parseStandings(capture('npb_std_p.CAPTURE.md'), 'pacific');
  assert.deepEqual(r.teams.map((x) => `${x.code} ${x.wins}-${x.losses}-${x.ties}`), ['H 73-44-3', 'L 69-50-3', 'F 68-53-2', 'B 57-63-2', 'M 53-60-3', 'E 47-71-1']);
  const f = r.teams[2];
  assert.deepEqual(f.vs.H, { w: 5, l: 15, t: 2 });
  assert.deepEqual(f.interleague, { w: 14, l: 4, t: 0 });
  assert.deepEqual(r.warnings, []);
});

test('schedule detail September (JA): results with 勝/敗/分, upcoming with 先発 + JMA icon, venues + roofs', () => {
  const r = parseScheduleDetail(capture('npb_schedule_2026_09_detail.CAPTURE.md'), { season: 2026 });
  assert.equal(r.rows.length, 48);
  assert.deepEqual(r.warnings, []);
  const g1 = r.rows[0];
  assert.deepEqual([g1.dateISO, g1.home, g1.away, g1.homeScore, g1.awayScore, g1.venue, g1.roof], ['2026-09-01', 'G', 'DB', 4, 3, 'Kyocera Dome', 'dome']);
  assert.deepEqual(g1.decision, { winningPitcher: 'マルティネス', losingPitcher: 'ルイーズ' });
  assert.equal(g1.scoreUrl, 'https://npb.jp/scores/2026/0901/g-db-20/');
  const fh = r.rows.find((x) => x.dateISO === '2026-09-02' && x.home === 'F');
  assert.deepEqual([fh.homeScore, fh.awayScore, fh.venue, fh.roof], [1, 1, 'ES CON FIELD', 'retractable']);
  assert.deepEqual(fh.decision, { draw: ['福島', '杉山'] });
  const sd = r.rows.find((x) => x.dateISO === '2026-09-04' && x.home === 'S');
  assert.deepEqual(sd.announcedStarters, { home: '高梨', away: '髙橋宏' });
  assert.equal(sd.weather, 'cloudy with rain');
  assert.equal(sd.startLocal, '18:00');
  const hl = r.rows.find((x) => x.dateISO === '2026-09-04' && x.home === 'H');
  assert.deepEqual([hl.away, hl.venue, hl.roof, hl.weather], ['L', 'Mizuho PayPay', 'retractable', 'rain']);
  assert.deepEqual(hl.announcedStarters, { home: '前田悠', away: '髙橋光成' });
  const sd5 = r.rows.find((x) => x.dateISO === '2026-09-05' && x.home === 'S');
  assert.equal(sd5.announcedStarters, null, 'no starter is ever invented for a day npb.jp has not announced');
  const akita = r.rows.find((x) => x.dateISO === '2026-09-01' && x.home === 'E');
  assert.deepEqual([akita.venue, akita.roof], ['Akita', 'open'], 'regional neutral-site game keeps its real venue');
  assert.equal(WEATHER_ICON['10'], 'cloudy with rain');
});

test('Japanese box score S-T game 21 (2026-09-03): header, linescore, both pitching staffs', () => {
  const r = parseJaBoxScore(capture('npb_jabox_2026-09-03_s-t-21.CAPTURE.md'), { url: 'https://npb.jp/scores/2026/0903/s-t-21/box.html' });
  assert.deepEqual([r.dateISO, r.home, r.away, r.homeScore, r.awayScore, r.draw, r.innings], ['2026-09-03', 'S', 'T', 4, 7, false, 9]);
  assert.deepEqual([r.venue, r.roof, r.startLocal, r.endLocal, r.duration, r.attendance, r.gameNo], ['Jingu', 'open', '18:00', '21:14', '3:14', 27930, 21]);
  assert.equal(r.homePitchers.length, 7);
  assert.equal(r.awayPitchers.length, 5);
  const hs = r.homePitchers[0];
  assert.deepEqual([hs.name, hs.role, hs.decoration, hs.pitches, hs.bf, hs.ip, hs.h, hs.hr, hs.bb, hs.so, hs.r, hs.er], ['増居', 'starter', '●', 48, 15, 3, 5, 1, 1, 2, 4, 4]);
  const as = r.awayPitchers[0];
  assert.deepEqual([as.name, as.role, as.decoration, as.ip, as.er], ['伊藤将', 'starter', '○', 5, 1]);
  assert.deepEqual(r.awayPitchers.map((p) => p.decoration), ['○', 'H', null, 'H', 'S']);
  const ishihara = r.homePitchers.find((p) => p.name === '石原');
  assert.ok(Math.abs(ishihara.ip - 0.667) < 0.001, '0.2 innings is two thirds');
  assert.ok(r.homePitchers.slice(1).every((p) => p.role === 'relief'));
});

test('English BIS box score fixture (hand-built mirror, labelled): header W-L-T, linescore, pitching lines', () => {
  const r = parseBoxScore(html('npb_box_s2026090201768.FIXTURE.html'), { id: 's2026090201768' });
  assert.equal(r.id, 's2026090201768');
  assert.deepEqual([r.home, r.away, r.homeScore, r.awayScore, r.draw, r.innings], ['F', 'H', 1, 1, true, 12]);
  assert.ok(r.homePitchers.length >= 1 && r.awayPitchers.length >= 1);
  // first pitcher row is the starter: Tatsu 8 IP / 10 SO / 1 ER (verified against the live f-h-22 box on 2026-09-03)
  assert.deepEqual([r.homePitchers[0].name, r.homePitchers[0].ip, r.homePitchers[0].so, r.homePitchers[0].er], ['Tatsu', 8, 10, 1]);
});

test('team pitching / batting pages (hand-built mirrors): lefty marker, no invented team totals', () => {
  const p = parseTeamPitching(html('npb_idp1_h.FIXTURE.html'), 'H');
  assert.ok(p.pitchers.length >= 2);
  assert.ok(p.pitchers.some((x) => x.throws === 'L'), 'the * lefty marker is read');
  assert.ok(p.pitchers.some((x) => x.throws === 'R'));
  assert.ok(p.pitchers.every((x) => typeof x.name === 'string' && x.name.length && Number.isFinite(x.era)));
  const b = parseTeamBatting(html('npb_idb1_s.FIXTURE.html'), 'S');
  assert.ok(b.players.length >= 2);
  assert.ok(b.players.every((x) => Number.isFinite(x.avg) && Number.isFinite(x.obp)));
  assert.equal(b.teamTotals ?? null, null, 'npb.jp publishes no totals row; none is fabricated');
});
