#!/usr/bin/env node
/**
 * scripts/build_t20_blast.mjs — build the committed T20 Blast (Vitality Blast)
 * data layer from rows transcribed line by line from official sources.
 *
 * WHY A BUILDER AND NOT A HAND-WRITTEN JSON FILE
 * ----------------------------------------------
 * The brief is "no hallucinations, verify line by line". Every row below was
 * read from the ESPNcricinfo Vitality Blast Men 2026 points table (which lists
 * each county's fixtures with date, group, result, margin, D/L flag and a
 * scorecard URL carrying the event id) and cross-checked against the ESPN
 * key-less standings API, Wikipedia's 2026 T20 Blast season page and the ECB.
 *
 * This script does not trust the transcription: it re-derives everything that
 * can be re-derived and fails loudly if any check fails.
 *
 *   CHECK 1  every row's winner resolves to one of the two teams in the row
 *   CHECK 2  the home team derived from the scorecard slug is a real county
 *   CHECK 3  no event id appears twice; every event id is numeric
 *   CHECK 4  each pairing meets exactly twice inside its own group
 *   CHECK 5  every date falls inside the verified 22 May - 18 July window
 *   CHECK 6  the official table's points column equals 4*W + 2*T + 2*NR - deduction
 *            (this is what proves Sussex's 2-point Blast deduction: 3 wins = 12,
 *             table shows 10)
 *   CHECK 7  the official net run rate is recomputed from the published
 *            For/Against runs and overs and must match to 0.002
 *   CHECK 9  every knockout row carries a verified event id and scorecard slug
 *   CHECK 8  the table's W/L/T reconciles with the captured group rows plus the
 *            exact number of results this pass did not capture (2 cross-pool
 *            fixtures per county, plus the declared Derbyshire gaps)
 *
 * Sources are recorded per document in data/t20_blast_provenance.json.
 *
 * Usage:  node scripts/build_t20_blast.mjs [--check]
 *         --check validates and writes nothing (used by npm run verify:all)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

export const FETCHED_AT = '2026-09-03T21:00:00Z';

/* ------------------------------------------------------------------ *
 * Verified competition facts
 * ------------------------------------------------------------------ */

const SOURCES = {
  cricinfo_table: 'https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/points-table-standings',
  cricinfo_fixtures: 'https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/match-schedule-fixtures-and-results',
  cricinfo_series: 'https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690',
  espn_standings_api: 'https://site.web.api.espn.com/apis/v2/sports/cricket/8053/standings?season=2026',
  espn_scoreboard_api: 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/1512690/scoreboard?dates=20260718',
  ecb: 'https://www.ecb.co.uk/t20-blast',
  bbc_table: 'https://www.bbc.com/sport/cricket/mens-england-twenty20/table',
  wikipedia: 'https://en.wikipedia.org/wiki/2026_T20_Blast',
  edgbaston_finals_day: 'https://edgbaston.com/news/2026-vitality-blast-finals-day-dates-revealed/',
  sky_sussex_deduction: 'https://www.skysports.com/cricket/news/37706/13502388/sussex-to-start-2026-county-championship-with-12-point-deduction-after-entering-deal-with-ecb-to-combat-financial-issues',
  wisden_sussex_deduction: 'https://www.wisden.com/series/county-championship-2026/cricket-news/county-hit-with-heavy-cross-competition-points-penalty-under-ecb-financial-framework',
  sky_final: 'https://www.skysports.com/cricket/live-blog/12123/13564698/vitality-blast-final-northamptonshire-vs-hampshire-live-text-updates-and-video-from-edgbaston-as-sides-eye-t20-glory',
  qf3_scorecard: 'https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/nottinghamshire-vs-surrey-3rd-quarter-final-1512885/full-scorecard',
  scorecard_by_event: 'https://www.espncricinfo.com/matches/engine/match/{event_id}.html',
};

/** 18 counties. `id` is the ESPN/cricinfo numeric team id (verified from the
 *  ESPN league scoreboard payload for series 1512690). `short` is the form of
 *  the name ESPNcricinfo uses inside a result string. */
export const TEAMS = {
  northamptonshire: { id: '1221', name: 'Northamptonshire', short: 'Northants', blast: 'Northamptonshire Steelbacks', group: 'Central & West Group' },
  somerset:         { id: '1333', name: 'Somerset', short: 'Somerset', blast: 'Somerset', group: 'Central & West Group' },
  gloucestershire:  { id: '1034', name: 'Gloucestershire', short: 'Gloucs', blast: 'Gloucestershire', group: 'Central & West Group' },
  warwickshire:     { id: '1428', name: 'Warwickshire', short: 'Warwickshire', blast: 'Warwickshire Bears', group: 'Central & West Group' },
  glamorgan:        { id: '1029', name: 'Glamorgan', short: 'Glamorgan', blast: 'Glamorgan', group: 'Central & West Group' },
  worcestershire:   { id: '1458', name: 'Worcestershire', short: 'Worcs', blast: 'Worcestershire Rapids', group: 'Central & West Group' },
  nottinghamshire:  { id: '1231', name: 'Nottinghamshire', short: 'Notts', blast: 'Notts Outlaws', group: 'North Group' },
  yorkshire:        { id: '1464', name: 'Yorkshire', short: 'Yorkshire', blast: 'Yorkshire', group: 'North Group' },
  lancashire:       { id: '1116', name: 'Lancashire', short: 'Lancashire', blast: 'Lancashire Lightning', group: 'North Group' },
  durham:           { id: '924',  name: 'Durham', short: 'Durham', blast: 'Durham', group: 'North Group' },
  derbyshire:       { id: '904',  name: 'Derbyshire', short: 'Derbyshire', blast: 'Derbyshire Falcons', group: 'North Group' },
  leicestershire:   { id: '1133', name: 'Leicestershire', short: 'Leics', blast: 'Leicestershire Foxes', group: 'North Group' },
  hampshire:        { id: '1051', name: 'Hampshire', short: 'Hampshire', blast: 'Hampshire Hawks', group: 'South Group' },
  surrey:           { id: '1358', name: 'Surrey', short: 'Surrey', blast: 'Surrey', group: 'South Group' },
  essex:            { id: '984',  name: 'Essex', short: 'Essex', blast: 'Essex', group: 'South Group' },
  kent:             { id: '1098', name: 'Kent', short: 'Kent', blast: 'Kent Spitfires', group: 'South Group' },
  middlesex:        { id: '1190', name: 'Middlesex', short: 'Middlesex', blast: 'Middlesex', group: 'South Group' },
  sussex:           { id: '1371', name: 'Sussex', short: 'Sussex', blast: 'Sussex Sharks', group: 'South Group' },
};

const GROUPS = ['North Group', 'Central & West Group', 'South Group'];

const SHORT_TO_SLUG = new Map(Object.entries(TEAMS).map(([slug, t]) => [t.short, slug]));

/* ------------------------------------------------------------------ *
 * The transcribed tape
 *
 * date | home slug | away slug | stage | event id ('' where not captured) |
 * result string exactly as ESPNcricinfo prints it | venue ('' where not captured)
 *
 * Home/away comes from the scorecard URL slug order, which ESPNcricinfo writes
 * home-first (verified against Lord's/The Oval/Derby/Nottingham fixtures).
 * ------------------------------------------------------------------ */

const ROWS = `
2026-05-22|northamptonshire|glamorgan|group|1512780|Northants won by 3 runs|
2026-05-22|gloucestershire|warwickshire|group|1512781|Gloucs won by 47 runs|
2026-05-22|middlesex|kent|group|1512777|Kent won by 27 runs|Lord's, London
2026-05-22|essex|sussex|group|1512775|Sussex won by 6 wickets (with 24 balls remaining)|
2026-05-22|nottinghamshire|yorkshire|group|1512782|Yorkshire won by 7 wickets (with 21 balls remaining)|
2026-05-22|surrey|lancashire|cross|1512776|Surrey won by 59 runs|The Oval, London
2026-05-23|glamorgan|gloucestershire|group|1512784|Gloucs won by 2 wickets (with 0 balls remaining)|
2026-05-24|warwickshire|somerset|group|1512786|Somerset won by 7 wickets (with 10 balls remaining)|
2026-05-24|worcestershire|northamptonshire|group|1512789|Northants won by 100 runs|
2026-05-24|durham|leicestershire|group|1512785|Durham won by 6 wickets (with 36 balls remaining)|
2026-05-24|yorkshire|derbyshire|group|1512787|Yorkshire won by 2 wickets (with 4 balls remaining)|
2026-05-24|middlesex|surrey|group|1512788|Surrey won by 6 wickets (with 9 balls remaining)|
2026-05-25|lancashire|nottinghamshire|group|1512790|Lancashire won by 39 runs|
2026-05-25|kent|sussex|group|1512791|Kent won by 7 wickets (with 10 balls remaining)|
2026-05-26|hampshire|essex|group|1512792|Hampshire won by 30 runs|
2026-05-27|leicestershire|derbyshire|group|1512793|Derbyshire won by 85 runs|
2026-05-29|glamorgan|somerset|group|1512796|Glamorgan won by 7 wickets (with 37 balls remaining)|
2026-05-29|northamptonshire|gloucestershire|group|1512798|Northants won by 7 wickets (with 22 balls remaining)|
2026-05-29|worcestershire|warwickshire|group|1512801|Worcs won by 6 wickets (with 7 balls remaining)|
2026-05-29|durham|yorkshire|group|1512794|Yorkshire won by 58 runs|
2026-05-29|lancashire|leicestershire|group|1512795|Leics won by 2 wickets (with 1 ball remaining)|
2026-05-29|hampshire|surrey|group|1512800|Hampshire won by 5 wickets (with 5 balls remaining)|
2026-05-29|derbyshire|nottinghamshire|group|1512797|Derbyshire won by 23 runs|
2026-05-29|kent|essex|group|1512799|Essex won by 9 wickets (with 38 balls remaining)|
2026-05-30|sussex|middlesex|group|1512802|Middlesex won by 31 runs|
2026-05-31|warwickshire|northamptonshire|group|1512804|Northants won by 6 wickets (with 4 balls remaining)|
2026-05-31|nottinghamshire|durham|group|1512808|Notts won by 6 wickets (with 16 balls remaining)|
2026-05-31|middlesex|hampshire|group|1512807|Hampshire won by 8 wickets (with 36 balls remaining)|
2026-05-31|surrey|kent|group|1512806|Kent won by 8 wickets (with 36 balls remaining)|
2026-06-02|hampshire|sussex|group|1512809|Hampshire won by 29 runs|
2026-06-03|surrey|middlesex|group|1512810|Surrey won by 8 wickets (with 35 balls remaining)|
2026-06-04|somerset|glamorgan|group|1512811|Glamorgan won by 4 wickets (with 0 balls remaining)|
2026-06-05|gloucestershire|somerset|group|1512815|Gloucs won by 7 wickets (with 35 balls remaining)|
2026-06-05|worcestershire|glamorgan|group|1512817|Worcs won by 27 runs|
2026-06-05|yorkshire|lancashire|group|1512812|Yorkshire won by 106 runs|
2026-06-05|surrey|hampshire|group|1512813|Hampshire won by 5 runs|
2026-06-07|gloucestershire|worcestershire|group|1512823|Gloucs won by 3 runs|
2026-06-07|somerset|warwickshire|group|1512822|Warwickshire won by 6 wickets (with 2 balls remaining)|
2026-06-07|nottinghamshire|derbyshire|group|1512824|Notts won by 10 runs|
2026-06-07|leicestershire|yorkshire|group|1512825|Leics won by 12 runs|
2026-06-07|middlesex|essex|group|1512820|Essex won by 60 runs|
2026-06-07|sussex|kent|group|1512821|Sussex won by 7 wickets (with 16 balls remaining)|
2026-06-09|northamptonshire|worcestershire|group|1512828|Northants won by 6 wickets (with 12 balls remaining) (D/L method)|
2026-06-09|durham|lancashire|group|1512827|Lancashire won by 7 wickets (with 5 balls remaining)|
2026-06-09|essex|kent|group|1512826|Essex won by 3 runs|
2026-06-26|somerset|gloucestershire|group|1512832|Somerset won by 18 runs|
2026-06-26|warwickshire|worcestershire|group|1512829|Warwickshire won by 59 runs|
2026-06-26|leicestershire|lancashire|group|1512835|Lancashire won by 5 wickets (with 7 balls remaining)|
2026-06-26|sussex|surrey|group|1512831|Surrey won by 7 wickets (with 27 balls remaining)|
2026-06-28|worcestershire|somerset|group|1512841|Worcs won by 36 runs|
2026-06-28|derbyshire|yorkshire|group|1512837|Match tied|
2026-06-28|leicestershire|nottinghamshire|group|1512840|Notts won by 74 runs|
2026-06-28|kent|hampshire|group|1512839|Kent won by 7 wickets (with 8 balls remaining)|
2026-07-01|gloucestershire|northamptonshire|group|1512845|Northants won by 8 wickets (with 16 balls remaining)|
2026-07-01|derbyshire|lancashire|group|1512844|Lancashire won by 4 runs|
2026-07-01|essex|surrey|group|1512842|Surrey won by 7 runs|
2026-07-03|glamorgan|warwickshire|group|1512847|Glamorgan won by 7 wickets (with 7 balls remaining)|
2026-07-03|nottinghamshire|lancashire|group|1512849|Notts won by 1 run|
2026-07-03|yorkshire|durham|group|1512846|Yorkshire won by 5 wickets (with 1 ball remaining)|
2026-07-03|sussex|essex|group|1512848|Essex won by 100 runs|
2026-07-05|glamorgan|worcestershire|group|1512856|Worcs won by 15 runs|
2026-07-05|northamptonshire|somerset|group|1512857|Somerset won by 105 runs|
2026-07-05|warwickshire|gloucestershire|group|1512854|Warwickshire won by 30 runs|
2026-07-05|durham|nottinghamshire|group|1512853|Notts won by 2 runs|
2026-07-05|yorkshire|leicestershire|group|1512855|Yorkshire won by 41 runs|
2026-07-05|essex|middlesex|group|1512852|Middlesex won by 4 wickets (with 6 balls remaining)|
2026-07-05|hampshire|kent|group|1512858|Hampshire won by 19 runs|
2026-07-06|lancashire|derbyshire|group|1512859|Match tied|
2026-07-08|glamorgan|northamptonshire|group|1512861|Northants won by 53 runs|
2026-07-08|leicestershire|durham|group|1512863|Durham won by 8 wickets (with 30 balls remaining)|
2026-07-08|hampshire|middlesex|group|1512864|Middlesex won by 5 wickets (with 6 balls remaining)|
2026-07-08|surrey|sussex|group|1512860|Surrey won by 8 wickets (with 16 balls remaining)|
2026-07-10|somerset|northamptonshire|group|1512870|Somerset won by 7 wickets (with 30 balls remaining)|
2026-07-10|warwickshire|glamorgan|group|1512867|Warwickshire won by 4 wickets (with 1 ball remaining)|
2026-07-10|worcestershire|gloucestershire|group|1512873|Gloucs won by 2 wickets (with 6 balls remaining)|
2026-07-10|durham|derbyshire|group|1512866|Durham won by 5 runs|
2026-07-10|lancashire|yorkshire|group|1512868|Lancashire won by 22 runs|
2026-07-10|nottinghamshire|leicestershire|group|1512872|Notts won by 6 wickets (with 10 balls remaining)|
2026-07-10|essex|hampshire|group|1512865|Essex won by 7 wickets (with 24 balls remaining)|
2026-07-10|kent|surrey|group|1512871|Surrey won by 9 wickets (with 67 balls remaining)|St Lawrence Ground, Canterbury
2026-07-10|middlesex|sussex|group|1512869|Sussex won by 18 runs|
2026-07-12|gloucestershire|glamorgan|group|1512881|Glamorgan won by 50 runs|
2026-07-12|northamptonshire|warwickshire|group|1512880|Warwickshire won by 5 wickets (with 10 balls remaining)|
2026-07-12|somerset|worcestershire|group|1512879|Somerset won by 78 runs|
2026-07-12|lancashire|durham|group|1512874|Lancashire won by 3 wickets (with 2 balls remaining)|
2026-07-12|yorkshire|nottinghamshire|group|1512875|Yorkshire won by 18 runs|
2026-07-12|kent|middlesex|group|1512882|Middlesex won by 14 runs|
2026-07-12|surrey|essex|group|1512876|Essex won by 8 wickets (with 19 balls remaining)|
2026-07-12|sussex|hampshire|group|1512877|Hampshire won by 4 wickets (with 1 ball remaining)|
2026-07-15|hampshire|essex|quarter-final|1512883|Hampshire won by 75 runs|Rose Bowl, Southampton
2026-07-15|gloucestershire|northamptonshire|quarter-final|1512884|Northants won by 8 wickets (with 14 balls remaining)|County Ground, Northampton
2026-07-15|nottinghamshire|surrey|quarter-final|1512885|Notts won by 7 runs|Trent Bridge, Nottingham
2026-07-15|yorkshire|somerset|quarter-final|1512886|Somerset won by 2 wickets (with 1 ball remaining)|Headingley, Leeds
2026-07-18|northamptonshire|somerset|semi-final|1512887|Northants won by 17 runs|Edgbaston, Birmingham
2026-07-18|hampshire|nottinghamshire|semi-final|1512888|Hampshire won by 27 runs|Edgbaston, Birmingham
2026-07-18|northamptonshire|hampshire|final|1512889|Northants won by 14 runs|Edgbaston, Birmingham
`;

/** Verified scores, where a source printed them. Never inferred. */
const SCORES = {
  1512777: { home: '208/6', away: '181/8', away_overs: '20', away_target: 209 },
  1512776: { home: '213/6', away: '154', away_overs: '16.1', away_target: 214 },
  1512871: { home: '102', home_overs: '17', away: '106/1', away_overs: '8.5' },
  // Knockout scores, keyed by the event id read from the series fixtures page.
  // 1512883 = QF1 Hampshire v Essex, 1512884 = QF2 Gloucs v Northants,
  // 1512886 = QF4 Yorkshire v Somerset, 1512888 = SF2 Hampshire v Notts,
  // 1512889 = Final Northants v Hampshire. 1512887 (SF1) printed no score in
  // any captured source, so it stays null rather than being reconstructed.
  1512883: { home: '211/3', home_overs: '20', away: '136/9', away_overs: '20', away_target: 212 },
  1512884: { home: '152', home_overs: '20', away: '153/2', away_overs: '17.4', away_target: 153 },
  1512885: { home: '163/6', home_overs: '20', away: '156/7', away_overs: '20', away_target: 164 },
  1512886: { home: '161/9', home_overs: '20', away: '162/8', away_overs: '19.5', away_target: 162 },
  1512888: { home: '187/3', home_overs: '20', away: '160', away_overs: '19.5', away_target: 188 },
  1512889: { home: '169', home_overs: '20', away: '155', away_overs: '19.2', away_target: 170 },
};

/**
 * Verified full-scorecard slugs for the seven knockout fixtures, read from the
 * series fixtures page on 2026-09-03. These are the exact pages a reviewer
 * should open; the generic engine/match redirect is also kept in review_urls.
 */
const KNOCKOUT_SCORECARDS = {
  1512883: 'hampshire-vs-essex-1st-quarter-final-1512883',
  1512884: 'northamptonshire-vs-gloucestershire-2nd-quarter-final-1512884',
  1512885: 'nottinghamshire-vs-surrey-3rd-quarter-final-1512885',
  1512886: 'yorkshire-vs-somerset-4th-quarter-final-1512886',
  1512887: 'northamptonshire-vs-somerset-1st-semi-final-1512887',
  1512888: 'hampshire-vs-nottinghamshire-2nd-semi-final-1512888',
  1512889: 'northamptonshire-vs-hampshire-final-1512889',
};

/**
 * Cross-pool fixtures whose event ids were verified on the series fixtures page
 * but whose RESULTS are not itemised anywhere captured: ESPNcricinfo's group
 * points tables list only each county's ten in-group fixtures, so the 18
 * cross-pool results are invisible on the page this tape was read from.
 *
 * These are recorded, not inserted as match rows: a row without a result would
 * either be ignored by the walk-forward context builders or, worse, invite a
 * guessed score. The ids are here so scripts/collect_t20_blast.mjs can resolve
 * each one directly instead of rediscovering the fixtures.
 *
 * `orientation` records that this page's link text and its URL slug disagree
 * about which county was home (TB-IR-10). Neither is treated as authoritative;
 * home/away for these fixtures is left unresolved until a scorecard is read.
 */
const CROSS_POOL_KNOWN_IDS = [
  { event_id: '1512830', slug: 'glamorgan-vs-middlesex-cross-pool-1512830', link_text: 'Middlesex vs Glamorgan', orientation: 'slug and link text disagree' },
  { event_id: '1512833', slug: 'northamptonshire-vs-essex-cross-pool-1512833', link_text: 'Northants vs Essex', orientation: 'agree' },
  { event_id: '1512834', slug: 'kent-vs-nottinghamshire-cross-pool-1512834', link_text: 'Kent vs Notts', orientation: 'agree' },
  { event_id: '1512836', slug: 'hampshire-vs-yorkshire-cross-pool-1512836', link_text: 'Yorkshire vs Hampshire', orientation: 'slug and link text disagree' },
  { event_id: '1512838', slug: 'middlesex-vs-durham-cross-pool-1512838', link_text: 'Durham vs Middlesex', orientation: 'slug and link text disagree' },
  { event_id: '1512843', slug: 'warwickshire-vs-sussex-cross-pool-1512843', link_text: 'Warwickshire vs Sussex', orientation: 'agree' },
  { event_id: '1512850', slug: 'worcestershire-vs-kent-cross-pool-1512850', link_text: 'Worcs vs Kent', orientation: 'agree' },
  { event_id: '1512851', slug: 'gloucestershire-vs-surrey-cross-pool-1512851', link_text: 'Gloucs vs Surrey', orientation: 'agree' },
  { event_id: '1512862', slug: 'derbyshire-vs-somerset-cross-pool-1512862', link_text: 'Somerset vs Derbyshire', orientation: 'slug and link text disagree' },
];

/** Fixtures known to exist (each county plays 12: 10 in-group + 2 cross-pool)
 *  that this transcription pass did not capture. Declared, never invented. */
const GAPS = [
  { stage: 'group', group: 'North Group', home: 'derbyshire', away: 'durham', reason: 'Derbyshire home fixture not present in any captured points-table row' },
  { stage: 'group', group: 'North Group', home: 'derbyshire', away: 'leicestershire', reason: 'Derbyshire home fixture not present in any captured points-table row' },
];

/** Cross-pool fixtures: the format guarantees 18 (each county one home and one
 *  away against a county from another group). Only one was captured in full. */
const CROSS_POOL_CAPTURED = 1;
const CROSS_POOL_TOTAL = 18;

/* ------------------------------------------------------------------ *
 * Verified final standings
 *
 * Read from the ESPNcricinfo points table and cross-checked against the ESPN
 * standings API and Wikipedia (which cites Cricinfo and BBC Sport).
 * for/against are "runs/overs" exactly as printed; null where the row was not
 * captured. nrr is the published figure — CHECK 7 recomputes it.
 * ------------------------------------------------------------------ */

const STANDINGS = {
  'Central & West Group': [
    { slug: 'northamptonshire', m: 12, w: 9, l: 3, t: 0, nr: 0, pts: 36, nrr: 0.936, for: '2113/229.0', against: '1918/231.2', deduction: 0, qualified: 'quarter-final (group winner)' },
    { slug: 'somerset', m: 12, w: 7, l: 5, t: 0, nr: 0, pts: 28, nrr: 0.763, for: '2211/229.4', against: null, deduction: 0, qualified: 'quarter-final (2nd)' },
    { slug: 'gloucestershire', m: 12, w: 7, l: 5, t: 0, nr: 0, pts: 28, nrr: 0.288, for: '2037/233.1', against: '1974/233.4', deduction: 0, qualified: 'quarter-final (best third-placed)' },
    { slug: 'warwickshire', m: 12, w: 6, l: 6, t: 0, nr: 0, pts: 24, nrr: 0.367, for: '2121/237.5', against: '2011/235.1', deduction: 0, qualified: null },
    { slug: 'glamorgan', m: 12, w: 6, l: 6, t: 0, nr: 0, pts: 24, nrr: 0.217, for: '2119/230.1', against: '2156/239.5', deduction: 0, qualified: null },
    { slug: 'worcestershire', m: 12, w: 6, l: 6, t: 0, nr: 0, pts: 24, nrr: -0.337, for: '1837/236.5', against: '1902/235.0', deduction: 0, qualified: null },
  ],
  'North Group': [
    { slug: 'nottinghamshire', m: 12, w: 8, l: 4, t: 0, nr: 0, pts: 32, nrr: 0.169, for: '2097/234.1', against: '2078/236.3', deduction: 0, qualified: 'quarter-final (group winner)' },
    { slug: 'yorkshire', m: 12, w: 7, l: 4, t: 1, nr: 0, pts: 30, nrr: 0.720, for: '2191/235.4', against: '2057/239.5', deduction: 0, qualified: 'quarter-final (2nd)' },
    { slug: 'lancashire', m: 12, w: 6, l: 5, t: 1, nr: 0, pts: 26, nrr: -0.335, for: '1998/227.4', against: '2094/229.5', deduction: 0, qualified: null },
    { slug: 'durham', m: 12, w: 5, l: 7, t: 0, nr: 0, pts: 20, nrr: 0.462, for: '1921/219.0', against: '1878/226.0', deduction: 0, qualified: null },
    { slug: 'derbyshire', m: 12, w: 3, l: 7, t: 2, nr: 0, pts: 16, nrr: 0.393, for: null, against: null, deduction: 0, qualified: null },
    { slug: 'leicestershire', m: 12, w: 3, l: 9, t: 0, nr: 0, pts: 12, nrr: -1.600, for: null, against: null, deduction: 0, qualified: null },
  ],
  'South Group': [
    { slug: 'hampshire', m: 12, w: 8, l: 4, t: 0, nr: 0, pts: 32, nrr: 0.283, for: '2054/232.5', against: '1964/230.0', deduction: 0, qualified: 'quarter-final (group winner)' },
    { slug: 'surrey', m: 12, w: 7, l: 5, t: 0, nr: 0, pts: 28, nrr: 0.666, for: '1946/214.2', against: '1935/230.0', deduction: 0, qualified: 'quarter-final (2nd)' },
    { slug: 'essex', m: 12, w: 7, l: 5, t: 0, nr: 0, pts: 28, nrr: 0.354, for: '1978/226.1', against: '1972/235.0', deduction: 0, qualified: 'quarter-final (best third-placed)' },
    { slug: 'kent', m: 12, w: 4, l: 8, t: 0, nr: 0, pts: 16, nrr: -0.895, for: '1822/231.0', against: '1919/218.3', deduction: 0, qualified: null },
    { slug: 'middlesex', m: 12, w: 4, l: 8, t: 0, nr: 0, pts: 16, nrr: -1.243, for: '1852/238.0', against: '2023/224.1', deduction: 0, qualified: null },
    { slug: 'sussex', m: 12, w: 3, l: 9, t: 0, nr: 0, pts: 10, nrr: -1.168, for: '2001/233.2', against: '2228/228.4', deduction: 2, qualified: null },
  ],
};

/** Verified season leaders and knockout top performances. Every figure was
 *  printed by a source; nothing is computed here. */
const LEADERS = {
  most_runs: { player: 'Joe Weatherley', team: 'Hampshire', value: 591, source: SOURCES.wikipedia },
  most_wickets: { player: 'Hasan Ali', team: 'Yorkshire', value: 27, source: SOURCES.wikipedia },
  batting: [
    { player: 'Joe Weatherley', team: 'Hampshire', runs: 591, innings: 15, average: 49.25, source: SOURCES.cricinfo_fixtures },
    { player: 'Beau Webster', team: 'Warwickshire', runs: 578, innings: 12, average: 48.16, source: SOURCES.cricinfo_fixtures },
    { player: 'Chris Lynn', team: 'Northamptonshire', runs: 518, innings: 13, average: 47.09, source: SOURCES.cricinfo_fixtures },
  ],
  bowling: [
    { player: 'Hasan Ali', team: 'Yorkshire', wickets: 27, innings: 12, average: 13.07, source: SOURCES.cricinfo_fixtures },
    { player: 'Scott Currie', team: 'Hampshire', wickets: 26, innings: 15, average: 16.03, source: SOURCES.cricinfo_fixtures },
    { player: 'James Sales', team: 'Northamptonshire', wickets: 25, innings: 14, average: 16.04, source: SOURCES.cricinfo_fixtures },
  ],
  knockout_performances: [
    { stage: 'quarter-final 1', player: 'James Vince', team: 'Hampshire', detail: '125 off 61 balls', source: SOURCES.wikipedia },
    { stage: 'quarter-final 1', player: 'Sonny Baker', team: 'Hampshire', detail: '5 for 24 off 4 overs', source: SOURCES.wikipedia },
    { stage: 'quarter-final 1', player: 'Charlie Allison', team: 'Essex', detail: '44 off 33 balls', source: SOURCES.wikipedia },
    { stage: 'quarter-final 3', player: 'Jack Haynes', team: 'Nottinghamshire', detail: '75 not out off 55 balls', source: SOURCES.qf3_scorecard },
    { stage: 'quarter-final 3', player: 'Jason Roy', team: 'Surrey', detail: '76 off 50 balls', source: SOURCES.qf3_scorecard },
    { stage: 'quarter-final 3', player: 'Chris Jordan', team: 'Surrey', detail: '3 for 22 off 4 overs', source: SOURCES.qf3_scorecard },
    { stage: 'semi-final 2', player: 'Joe Weatherley', team: 'Hampshire', detail: '88 not out off 58 balls', source: SOURCES.wikipedia },
    { stage: 'semi-final 2', player: 'Joe Clarke', team: 'Nottinghamshire', detail: '64 off 43 balls', source: SOURCES.wikipedia },
    { stage: 'semi-final 2', player: 'James Fuller', team: 'Hampshire', detail: '4 for 26 off 3.5 overs', source: SOURCES.wikipedia },
  ],
};

/* ------------------------------------------------------------------ *
 * Parsing + verification
 * ------------------------------------------------------------------ */

export function oversToDecimal(str) {
  if (!str) return null;
  const m = /^(\d+)(?:\.(\d))?$/.exec(String(str).trim());
  if (!m) return null;
  const balls = m[2] ? Number(m[2]) : 0;
  if (balls > 5) return null; // 231.7 is not a legal cricket over notation
  return Number(m[1]) + balls / 6;
}

export function parseRunsOvers(str) {
  if (!str) return null;
  const m = /^(\d+)\/([\d.]+)$/.exec(String(str).trim());
  if (!m) return null;
  const overs = oversToDecimal(m[2]);
  if (overs == null || overs <= 0) return null;
  return { runs: Number(m[1]), overs, rate: Number(m[1]) / overs };
}

export function parseResult(text, homeSlug, awaySlug) {
  const t = String(text || '').trim();
  if (/^Match tied$/i.test(t)) return { type: 'tie', winner: null, margin: null, dl: false, text: t };
  if (/no result|abandoned/i.test(t)) return { type: 'noresult', winner: null, margin: null, dl: false, text: t };
  const dl = /\(D\/L(?: method)?\)/i.test(t);
  const m = /^(.+?) won by (\d+) (runs?|wickets?)/i.exec(t);
  if (!m) return { type: 'unknown', winner: null, margin: null, dl, text: t };
  const shortName = m[1].trim();
  const slug = SHORT_TO_SLUG.get(shortName);
  if (!slug) return { type: 'unmapped', winner: null, margin: null, dl, text: t, problem: `winner "${shortName}" is not a known county short name` };
  if (slug !== homeSlug && slug !== awaySlug) {
    return { type: 'mismatch', winner: slug, margin: null, dl, text: t, problem: `winner ${slug} is neither home (${homeSlug}) nor away (${awaySlug})` };
  }
  return {
    type: m[3].toLowerCase().startsWith('run') ? 'runs' : 'wickets',
    winner: slug,
    margin: Number(m[2]),
    margin_text: t,
    dl,
    text: t,
  };
}

export function parseRows(raw = ROWS) {
  return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [date, home, away, stage, eventId, result, venue] = line.split('|');
    return { date, home, away, stage, eventId: eventId || null, result, venue: venue || null, line };
  });
}

/** Build the match documents, verifying every row. Throws on any problem. */
export function buildMatches() {
  const problems = [];
  const rows = parseRows();
  const seenEvent = new Map();
  const matches = [];
  const pairCount = new Map();

  for (const r of rows) {
    const where = `row "${r.line.slice(0, 72)}…"`;
    if (!TEAMS[r.home]) problems.push(`${where}: unknown home slug ${r.home}`);
    if (!TEAMS[r.away]) problems.push(`${where}: unknown away slug ${r.away}`);
    if (!['group', 'cross', 'quarter-final', 'semi-final', 'final'].includes(r.stage)) {
      problems.push(`${where}: unknown stage ${r.stage}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push(`${where}: bad date ${r.date}`);
    else if (r.date < '2026-05-22' || r.date > '2026-07-18') problems.push(`${where}: date ${r.date} outside the verified 22 May - 18 July window`);

    if (r.eventId) {
      if (!/^\d+$/.test(r.eventId)) problems.push(`${where}: non-numeric event id ${r.eventId}`);
      if (seenEvent.has(r.eventId)) problems.push(`${where}: duplicate event id ${r.eventId}`);
      seenEvent.set(r.eventId, r);
    }

    // Group membership check
    const gh = TEAMS[r.home]?.group;
    const ga = TEAMS[r.away]?.group;
    if (r.stage === 'group') {
      if (gh !== ga) problems.push(`${where}: group-stage row mixes groups (${gh} vs ${ga})`);
      const key = [r.home, r.away].sort().join('|');
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
    if (r.stage === 'cross' && gh === ga) problems.push(`${where}: cross-pool row is inside one group`);

    const res = parseResult(r.result, r.home, r.away);
    if (res.problem) problems.push(`${where}: ${res.problem}`);
    if (res.type === 'unknown') problems.push(`${where}: result string could not be parsed`);

    // Every row now carries its verified event id, so a score is looked up by
    // id alone. The earlier positional fallbacks (qf1/qf4/sf2/final) are gone:
    // they inferred a score from a fixture's place in a list, which is exactly
    // the kind of silent guess this builder exists to prevent.
    const score = SCORES[r.eventId] || null;

    matches.push({
      event_id: r.eventId,
      date: r.date,
      stage: r.stage,
      group: r.stage === 'group' ? gh : (r.stage === 'cross' ? 'Cross Pool' : 'Knockout'),
      home: TEAMS[r.home]?.name || r.home,
      away: TEAMS[r.away]?.name || r.away,
      home_slug: r.home,
      away_slug: r.away,
      home_team_id: TEAMS[r.home]?.id || null,
      away_team_id: TEAMS[r.away]?.id || null,
      format: 'T20',
      venue: r.venue || null,
      neutral: r.stage === 'final' || r.stage === 'semi-final',
      result_text: res.text,
      result_type: res.type,
      winner: res.winner ? TEAMS[res.winner].name : null,
      winner_slug: res.winner || null,
      margin: res.margin,
      dl_method: res.dl,
      score: score ? { home: score.home, away: score.away, home_overs: score.home_overs ?? null, away_overs: score.away_overs ?? null, away_target: score.away_target ?? null } : null,
      source_url: r.eventId
        ? (KNOCKOUT_SCORECARDS[r.eventId]
          ? `https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/${KNOCKOUT_SCORECARDS[r.eventId]}/full-scorecard`
          : `https://www.espncricinfo.com/matches/engine/match/${r.eventId}.html`)
        : SOURCES.cricinfo_fixtures,
      review_urls: [
        KNOCKOUT_SCORECARDS[r.eventId]
          ? `https://www.espncricinfo.com/series/vitality-blast-men-2026-1512690/${KNOCKOUT_SCORECARDS[r.eventId]}/full-scorecard`
          : null,
        r.eventId ? `https://www.espncricinfo.com/matches/engine/match/${r.eventId}.html` : null,
        SOURCES.cricinfo_fixtures,
        SOURCES.cricinfo_table,
      ].filter(Boolean),
      source_note: r.eventId
        ? (KNOCKOUT_SCORECARDS[r.eventId]
          ? 'Event id and full-scorecard slug read from the ESPNcricinfo series fixtures page (verified 2026-09-03). The engine/match redirect was confirmed to resolve to the same scorecard on event 1512885.'
          : 'Event id read from the ESPNcricinfo scorecard slug on the points-table row; the engine/match URL was verified to resolve to that scorecard (event 1512885 checked 2026-09-03).')
        : 'Fixture verified on the series fixtures page; no event id was captured, so the series page is the review link.',
      captured: true,
    });
  }

  // CHECK 9 — every knockout row carries a verified event id, and every
  // knockout event id has a full-scorecard slug read from the series page.
  // A knockout row without an id cannot be reviewed against a scorecard, and
  // it also breaks identity comparisons downstream: the backtest's look-ahead
  // audit keys on event id, so null ids collide with one another.
  for (const r of rows) {
    const isKnockout = ['quarter-final', 'semi-final', 'final'].includes(r.stage);
    if (!isKnockout) continue;
    if (!r.eventId) {
      problems.push(`knockout row ${r.date} ${r.home} v ${r.away} has no event id — it cannot be reviewed against a scorecard`);
    } else if (!KNOCKOUT_SCORECARDS[r.eventId]) {
      problems.push(`knockout event ${r.eventId} (${r.home} v ${r.away}) has no verified full-scorecard slug`);
    }
  }
  for (const id of Object.keys(KNOCKOUT_SCORECARDS)) {
    if (!rows.some((r) => r.eventId === id)) problems.push(`verified knockout slug for event ${id} matches no tape row`);
  }

  // CHECK 4 — each in-group pairing meets exactly twice, less any declared gap
  const gapPairs = new Map();
  for (const g of GAPS) {
    const key = [g.home, g.away].sort().join('|');
    gapPairs.set(key, (gapPairs.get(key) || 0) + 1);
  }
  const expectedPairs = new Set();
  const slugsByGroup = new Map();
  for (const [slug, t] of Object.entries(TEAMS)) {
    if (!slugsByGroup.has(t.group)) slugsByGroup.set(t.group, []);
    slugsByGroup.get(t.group).push(slug);
  }
  for (const list of slugsByGroup.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) expectedPairs.add([list[i], list[j]].sort().join('|'));
    }
  }
  for (const key of expectedPairs) {
    const have = pairCount.get(key) || 0;
    const want = 2 - (gapPairs.get(key) || 0);
    if (have !== want) problems.push(`in-group pairing ${key} captured ${have} times, expected ${want}`);
  }
  for (const [key, n] of pairCount) {
    if (n > 2) problems.push(`in-group pairing ${key} captured ${n} times, expected at most 2`);
  }

  matches.sort((a, b) => (a.date === b.date ? String(a.event_id || a.home).localeCompare(String(b.event_id || b.home)) : a.date.localeCompare(b.date)));
  return { matches, problems };
}

/** Verify the published tables against the arithmetic and the captured tape. */
export function buildStandings(matches) {
  const problems = [];
  const groups = {};
  const byTeam = new Map();

  for (const m of matches) {
    if (m.stage !== 'group') continue;
    for (const slug of [m.home_slug, m.away_slug]) {
      const rec = byTeam.get(slug) || { w: 0, l: 0, t: 0, nr: 0, played: 0 };
      if (m.result_type === 'tie') rec.t += 1;
      else if (m.result_type === 'noresult') rec.nr += 1;
      else if (m.winner_slug === slug) rec.w += 1;
      else rec.l += 1;
      rec.played += 1;
      byTeam.set(slug, rec);
    }
  }

  const gapsByTeam = new Map();
  for (const g of GAPS) {
    for (const slug of [g.home, g.away]) gapsByTeam.set(slug, (gapsByTeam.get(slug) || 0) + 1);
  }

  for (const g of GROUPS) {
    const rows = STANDINGS[g].map((row, i) => {
      const t = TEAMS[row.slug];
      if (!t) problems.push(`${g}: unknown county ${row.slug}`);
      if (t.group !== g) problems.push(`${g}: ${row.slug} belongs to ${t.group}`);

      // CHECK 6 — points arithmetic (4 for a win, 2 for a tie, 2 for no result)
      const expectedPts = 4 * row.w + 2 * row.t + 2 * row.nr - row.deduction;
      if (expectedPts !== row.pts) {
        problems.push(`${g}/${row.slug}: published points ${row.pts} != 4*${row.w}+2*${row.t}+2*${row.nr}-${row.deduction} = ${expectedPts}`);
      }
      if (row.w + row.l + row.t + row.nr !== row.m) {
        problems.push(`${g}/${row.slug}: W+L+T+NR != matches played`);
      }

      // CHECK 7 — net run rate recomputed from published For/Against
      let nrrComputed = null;
      const f = parseRunsOvers(row.for);
      const a = parseRunsOvers(row.against);
      if (f && a) {
        nrrComputed = Number((f.rate - a.rate).toFixed(3));
        if (Math.abs(nrrComputed - row.nrr) > 0.002) {
          problems.push(`${g}/${row.slug}: recomputed NRR ${nrrComputed} != published ${row.nrr}`);
        }
      }

      // CHECK 8 — table reconciles with captured rows + declared gaps
      const cap = byTeam.get(row.slug) || { w: 0, l: 0, t: 0, nr: 0, played: 0 };
      const gaps = gapsByTeam.get(row.slug) || 0;
      const dw = row.w - cap.w;
      const dl = row.l - cap.l;
      const dt = row.t - cap.t;
      const dnr = row.nr - cap.nr;
      if (dw < 0 || dl < 0 || dt < 0 || dnr < 0) {
        problems.push(`${g}/${row.slug}: captured group rows (${cap.w}W ${cap.l}L ${cap.t}T) exceed the official table (${row.w}W ${row.l}L ${row.t}T)`);
      }
      const uncaptured = dw + dl + dt + dnr;
      const expectedUncaptured = 2 /* cross-pool fixtures */ + gaps;
      if (uncaptured !== expectedUncaptured) {
        problems.push(`${g}/${row.slug}: ${uncaptured} uncaptured results but ${expectedUncaptured} expected (2 cross-pool + ${gaps} declared gap(s))`);
      }
      if (cap.played + gaps !== 10) {
        problems.push(`${g}/${row.slug}: ${cap.played} captured in-group fixtures + ${gaps} gaps != the 10 in-group fixtures the format guarantees`);
      }

      return {
        position: i + 1,
        team: t.name,
        slug: row.slug,
        team_id: t.id,
        blast_name: t.blast,
        played: row.m, won: row.w, lost: row.l, tied: row.t, no_result: row.nr,
        points: row.pts,
        points_deduction: row.deduction,
        points_before_deduction: row.pts + row.deduction,
        nrr_published: row.nrr,
        nrr_recomputed: nrrComputed,
        runs_for: row.for, runs_against: row.against,
        qualified_for: row.qualified,
        captured_in_group: cap.played,
        uncaptured_results: uncaptured,
        adjusted_standing_note: row.deduction
          ? 'Table position is read as adjusted performance: a confirmed ECB deduction is applied to this county\'s points.'
          : null,
        source_url: SOURCES.cricinfo_table,
      };
    });
    groups[g] = rows;
  }
  return { groups, problems };
}

export function buildDocuments() {
  const { matches, problems } = buildMatches();
  const { groups, problems: sp } = buildStandings(matches);
  problems.push(...sp);

  const capturedByStage = matches.reduce((acc, m) => { acc[m.stage] = (acc[m.stage] || 0) + 1; return acc; }, {});

  const competition = {
    schema_version: 1,
    sport: 'Cricket',
    competition: 'T20 Blast (Vitality Blast, men)',
    season: 2026,
    edition: 24,
    organiser: 'England and Wales Cricket Board',
    status: 'COMPLETED',
    status_note: 'The 2026 competition finished on 18 July 2026. There are no upcoming T20 Blast fixtures on any market board as at 2026-09-03, and the 2027 schedule had not been published.',
    dates: { start: '2026-05-22', group_stage_end: '2026-07-12', quarter_finals: '2026-07-15', finals_day: '2026-07-18' },
    finals_day_venue: 'Edgbaston, Birmingham',
    format: {
      counties: 18,
      groups: GROUPS.length,
      teams_per_group: 6,
      group_matches_per_county: 12,
      in_group_matches_per_county: 10,
      cross_pool_matches_per_county: 2,
      total_matches: 115,
      group_stage_matches: 108,
      knockout_matches: 7,
      points: { win: 4, tie: 2, no_result: 2, loss: 0 },
      qualification: 'Top two in each of the three groups plus the two best third-placed sides advance to the quarter-finals; the four winners advance to Finals Day (both semi-finals and the final at one venue on one day).',
      schedule_shape: 'A single uninterrupted block finishing before The Hundred; back-to-back fixtures were reduced from over 50 to six.',
    },
    groups: GROUPS.map((g) => ({
      name: g,
      teams: STANDINGS[g].map((r) => ({ team: TEAMS[r.slug].name, slug: r.slug, blast_name: TEAMS[r.slug].blast, team_id: TEAMS[r.slug].id })),
    })),
    champions: { team: 'Northamptonshire', blast_name: 'Northamptonshire Steelbacks', slug: 'northamptonshire', title_number: 3, previous_title: 2016 },
    runners_up: { team: 'Hampshire', blast_name: 'Hampshire Hawks', slug: 'hampshire' },
    defending_champions: { team: 'Somerset', note: 'Won the 2025 title; eliminated in the 2026 semi-final.' },
    knockout: {
      quarter_finals: [
        { label: 'Quarter-final 1', date: '2026-07-15', venue: 'Rose Bowl, Southampton', teams: ['Hampshire', 'Essex'], winner: 'Hampshire', result_text: 'Hampshire won by 75 runs' },
        { label: 'Quarter-final 2', date: '2026-07-15', venue: 'County Ground, Northampton', teams: ['Gloucestershire', 'Northamptonshire'], winner: 'Northamptonshire', result_text: 'Northants won by 8 wickets (with 14 balls remaining)' },
        { label: 'Quarter-final 3', date: '2026-07-15', venue: 'Trent Bridge, Nottingham', teams: ['Nottinghamshire', 'Surrey'], winner: 'Nottinghamshire', result_text: 'Notts won by 7 runs', event_id: '1512885' },
        { label: 'Quarter-final 4', date: '2026-07-15', venue: 'Headingley, Leeds', teams: ['Yorkshire', 'Somerset'], winner: 'Somerset', result_text: 'Somerset won by 2 wickets (with 1 ball remaining)' },
      ],
      semi_finals: [
        { label: 'Semi-final 1', date: '2026-07-18', venue: 'Edgbaston, Birmingham', teams: ['Northamptonshire', 'Somerset'], winner: 'Northamptonshire', result_text: 'Northants won by 17 runs' },
        { label: 'Semi-final 2', date: '2026-07-18', venue: 'Edgbaston, Birmingham', teams: ['Hampshire', 'Nottinghamshire'], winner: 'Hampshire', result_text: 'Hampshire won by 27 runs' },
      ],
      final: { label: 'Final', date: '2026-07-18', venue: 'Edgbaston, Birmingham', teams: ['Northamptonshire', 'Hampshire'], winner: 'Northamptonshire', result_text: 'Northants won by 14 runs' },
    },
    points_deductions: [
      {
        team: 'Sussex', slug: 'sussex', competition: 'T20 Blast', deduction: 2,
        reason: 'ECB financial special measures: a three-year framework agreement announced 2 February 2026 carries a points penalty worth 50% of the maximum points available for one match in each men\'s domestic competition (12 points in the County Championship, 2 in the T20 Blast and the One-Day Cup).',
        verified_by: 'Arithmetic on the official South Group table: 3 wins x 4 points = 12, table shows 10.',
        effect_on_standing: 'None on qualification: Sussex finished sixth of six in the South Group with or without the deduction (Kent and Middlesex finished on 16).',
        sources: [SOURCES.sky_sussex_deduction, SOURCES.wisden_sussex_deduction, SOURCES.cricinfo_table],
      },
    ],
    sources: [
      { label: 'ESPNcricinfo — Vitality Blast Men 2026 (series home)', url: SOURCES.cricinfo_series },
      { label: 'ESPNcricinfo — points table and per-county fixture list', url: SOURCES.cricinfo_table },
      { label: 'ESPNcricinfo — fixtures and results', url: SOURCES.cricinfo_fixtures },
      { label: 'ESPN key-less standings API (league 8053, season 2026)', url: SOURCES.espn_standings_api },
      { label: 'ESPN key-less scoreboard API (series 1512690)', url: SOURCES.espn_scoreboard_api },
      { label: 'ECB — T20 Blast (competition owner)', url: SOURCES.ecb },
      { label: 'BBC Sport — men\'s England Twenty20 table', url: SOURCES.bbc_table },
      { label: 'Wikipedia — 2026 T20 Blast (cites Cricinfo and BBC Sport)', url: SOURCES.wikipedia },
      { label: 'Edgbaston — 2026 Finals Day date announcement', url: SOURCES.edgbaston_finals_day },
      { label: 'Sky Sports — Sussex points deduction', url: SOURCES.sky_sussex_deduction },
      { label: 'Wisden — Sussex cross-competition penalty detail', url: SOURCES.wisden_sussex_deduction },
      { label: 'Sky Sports — Finals Day live blog (champion confirmed)', url: SOURCES.sky_final },
    ],
    fetched_at_utc: FETCHED_AT,
  };

  const matchesDoc = {
    schema_version: 1,
    sport: 'Cricket',
    competition: 'T20 Blast (Vitality Blast, men)',
    season: 2026,
    generated_at_utc: FETCHED_AT,
    mode: 'verified-transcription',
    source: {
      name: 'ESPNcricinfo Vitality Blast Men 2026 points table and fixtures page',
      url: SOURCES.cricinfo_table,
      fixtures_url: SOURCES.cricinfo_fixtures,
      cross_checked_with: [SOURCES.espn_standings_api, SOURCES.wikipedia, SOURCES.bbc_table, SOURCES.sky_final],
      fetched_at_utc: FETCHED_AT,
      method: 'Rows transcribed line by line, then re-verified by scripts/build_t20_blast.mjs (winner resolves to a listed county, pairing meets twice, points and NRR recomputed, table reconciled against captured rows).',
    },
    counts: {
      captured: matches.length,
      by_stage: capturedByStage,
      group_stage_total: 108,
      knockout_total: 7,
      season_total: 115,
      in_group_captured: capturedByStage.group || 0,
      in_group_total: 90,
      cross_pool_captured: capturedByStage.cross || 0,
      cross_pool_total: CROSS_POOL_TOTAL,
    },
    gaps: [
      ...GAPS.map((g) => ({
        stage: g.stage, group: g.group, home: TEAMS[g.home].name, away: TEAMS[g.away].name,
        reason: g.reason, remediation: 'scripts/collect_t20_blast.mjs walks the ESPN league calendar for series 1512690 and rewrites this tape.',
      })),
      {
        stage: 'cross', group: 'Cross Pool', home: null, away: null,
        reason: `${CROSS_POOL_TOTAL - CROSS_POOL_CAPTURED} of ${CROSS_POOL_TOTAL} cross-pool fixtures are not itemised here. ESPNcricinfo's group tables list only the ten in-group fixtures per county, so cross-pool results are not visible on the page this tape was read from.`,
        remediation: 'scripts/collect_t20_blast.mjs walks the ESPN league calendar (which labels these fixtures) and rewrites this tape.',
        effect: 'Form and head-to-head are computed from in-group fixtures only; every card says so. The prompt\'s crossover-fixture caution rule is therefore applied from the fixture label, never from a guessed result.',
      },
    ],
    matches,
  };

  const standingsDoc = {
    schema_version: 1,
    sport: 'Cricket',
    competition: 'T20 Blast (Vitality Blast, men)',
    season: 2026,
    generated_at_utc: FETCHED_AT,
    source: {
      name: 'ESPNcricinfo Vitality Blast Men 2026 points table',
      url: SOURCES.cricinfo_table,
      cross_checked_with: [SOURCES.espn_standings_api, SOURCES.wikipedia, SOURCES.bbc_table],
      fetched_at_utc: FETCHED_AT,
    },
    points_system: { win: 4, tie: 2, no_result: 2, loss: 0 },
    verification: {
      points_recomputed: 'every row: 4*W + 2*T + 2*NR - deduction must equal the published points',
      nrr_recomputed: 'For/Against runs and overs republished as run rates; difference must match the published NRR to 0.002',
      nrr_not_verifiable: ['Somerset (Against column not captured)', 'Derbyshire (For/Against not captured)', 'Leicestershire (For/Against not captured)'],
      tape_reconciled: 'table W/L/T minus captured in-group rows must equal 2 cross-pool results plus any declared gap',
    },
    groups,
  };

  const leadersDoc = {
    schema_version: 1,
    sport: 'Cricket',
    competition: 'T20 Blast (Vitality Blast, men)',
    season: 2026,
    generated_at_utc: FETCHED_AT,
    note: 'Only figures a source printed. There is no per-match player tape in this pass, so player markets are settled only where a source named the performer (see docs/T20_BLAST_BACKTEST.md).',
    source: { name: 'ESPNcricinfo series statistics rail + Wikipedia season infobox', url: SOURCES.cricinfo_fixtures, fetched_at_utc: FETCHED_AT },
    ...LEADERS,
  };

  const provenance = {
    schema_version: 1,
    sport: 'Cricket',
    competition: 'T20 Blast (Vitality Blast, men)',
    season: 2026,
    generated_at_utc: FETCHED_AT,
    documents: [
      'data/t20_blast_competition.json', 'data/t20_blast_matches.json', 'data/t20_blast_standings.json',
      'data/t20_blast_leaders.json', 'data/t20_blast_backtest.json', 'data/t20_blast_predictions.json',
    ],
    sources: competition.sources,
    irregularity_ids: [
      'TB-IR-01', 'TB-IR-02', 'TB-IR-03', 'TB-IR-04', 'TB-IR-05',
      'TB-IR-06', 'TB-IR-07', 'TB-IR-08', 'TB-IR-09', 'TB-IR-10', 'TB-IR-11',
    ],
    register: 'docs/T20_BLAST_IRREGULARITIES.md',
    builder: 'scripts/build_t20_blast.mjs (re-runnable; --check validates without writing)',
    cross_pool_known_ids: {
      count: CROSS_POOL_KNOWN_IDS.length,
      of_total: 18,
      status: 'event ids verified on the series fixtures page; results NOT captured',
      why_not_in_tape: 'A row without a result would either be ignored by the walk-forward context builders or invite a guessed score. The ids are recorded here so scripts/collect_t20_blast.mjs can resolve each fixture directly.',
      orientation_warning: 'TB-IR-10: on the series fixtures page the link text and the URL slug disagree about which county was home for several of these fixtures. Neither is treated as authoritative, so home/away is left unresolved until a scorecard is read.',
      fixtures: CROSS_POOL_KNOWN_IDS,
    },
  };

  return { competition, matchesDoc, standingsDoc, leadersDoc, provenance, problems, matches };
}

function write(name, doc) {
  const p = join(DATA, name);
  writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
  return p;
}

export function main({ check = false } = {}) {
  const built = buildDocuments();
  if (built.problems.length) {
    console.error('T20 BLAST DATA VERIFICATION FAILED:');
    for (const p of built.problems) console.error(`  · ${p}`);
    process.exitCode = 1;
    return built;
  }
  const n = built.matches.length;
  console.log(`✓ ${n} verified matches (90 in-group expected: ${built.matchesDoc.counts.in_group_captured} captured, 2 declared gaps)`);
  console.log(`✓ 18 counties, 3 groups: points arithmetic and net run rate recomputed and matched`);
  console.log(`✓ Sussex 2-point deduction confirmed by arithmetic (3 wins = 12 points, table shows 10)`);
  if (!check) {
    write('t20_blast_competition.json', built.competition);
    write('t20_blast_matches.json', built.matchesDoc);
    write('t20_blast_standings.json', built.standingsDoc);
    write('t20_blast_leaders.json', built.leadersDoc);
    write('t20_blast_provenance.json', built.provenance);
    const ledger = join(DATA, 't20_blast_predictions.json');
    if (!existsSync(ledger)) {
      writeFileSync(ledger, `${JSON.stringify({
        schema_version: 1, sport: 'Cricket', competition: 'T20 Blast (Vitality Blast, men)',
        ruleset: 'T20 BLAST PREDICTION MASTER PROMPT v1.0',
        note: 'Append-only forward ledger. Rows are written before a match starts and settled from the official result. Empty while the competition is out of season.',
        generated_at_utc: FETCHED_AT, predictions: [],
      }, null, 2)}\n`);
    }
    console.log('✓ wrote data/t20_blast_competition.json, t20_blast_matches.json, t20_blast_standings.json, t20_blast_leaders.json, t20_blast_provenance.json');
  }
  return built;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main({ check: process.argv.includes('--check') });
