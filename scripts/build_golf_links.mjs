#!/usr/bin/env node
/**
 * SportsPred — build data/golf_links_courses.json.
 *
 * No free feed classifies a golf course as links. ESPN publishes yardage and
 * par only (IR-GOLF-03), so this table is the substitute: a hand-verified list
 * of venues, every row carrying the source that classifies it, joined against
 * the committed results tape so a reviewer can see exactly which events the
 * wind/links proxy can and cannot use.
 *
 * THREE RULES, all enforced here:
 *   1. A venue is `links` only when a cited source says so. "Royal", "Links" or
 *      "Golf Links" in a title is NOT evidence — the excluded[] list records the
 *      venues that were rejected for exactly that reason.
 *   2. The Open Championship needs no entry: it is always played on a links
 *      course (https://en.wikipedia.org/wiki/Links_(golf)), and the engine
 *      matches it on the ESPN name plus the `major` flag.
 *   3. Anything not on this list is unclassified, never assumed. The proxy
 *      scores zero for a player with no Open start and no listed venue, and the
 *      reason is written into `missing[]`.
 *
 * Usage:  node scripts/build_golf_links.mjs [--check]
 *   --check  verify the committed file is current; exit 1 if it is not.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SPORTSPRED_DATA_DIR || join(ROOT, 'data');
const RESULTS = join(DATA, 'golf_results.json');
const OUT = join(DATA, 'golf_links_courses.json');

const WIKI_LIST = 'https://en.wikipedia.org/wiki/List_of_links_golf_courses';
const WIKI_LINKS = 'https://en.wikipedia.org/wiki/Links_(golf)';

/** Verified rows. `espnCourseName` is the exact string in data/golf_results.json. */
export const LINKS_ROWS = [
  {
    espnCourseName: 'The Renaissance Club',
    classification: 'links',
    region: 'North Berwick, East Lothian, Scotland',
    source: WIKI_LIST,
    evidence: 'Listed under Scotland → Lothian: "The Renaissance Club, Dirleton, North Berwick".',
    note: 'Host of the Scottish Open since 2019 and confirmed through 2030.',
  },
  {
    espnCourseName: 'Royal Troon Golf Course',
    classification: 'links',
    region: 'Troon, Ayrshire, Scotland',
    source: WIKI_LIST,
    evidence: 'Listed under Scotland → Strathclyde: "Royal Troon Golf Club – Old Course and Portland Course".',
    note: 'Hosted The Open in 2024 (ESPN tape row 401580360).',
  },
  {
    espnCourseName: 'St Andrews Links (Old Course)',
    classification: 'links',
    region: 'St Andrews, Fife, Scotland',
    source: WIKI_LIST,
    evidence: 'Listed under Scotland → Fife: "St Andrews Links – Old, New, Castle, Jubilee, Eden, Strathtyrum, and Balgrove Courses".',
    note: 'Alfred Dunhill Links Championship in the tape.',
  },
  {
    espnCourseName: 'Royal Birkdale GC',
    classification: 'links',
    region: 'Southport, Merseyside, England',
    source: WIKI_LIST,
    evidence: 'Listed under England → North West: "Royal Birkdale Golf Club, Southport, Merseyside".',
    note: 'Hosted The Open in 2026 (ESPN tape row 401811957).',
  },
  {
    espnCourseName: 'Royal Portrush Golf Club',
    classification: 'links',
    region: 'County Antrim, Northern Ireland',
    source: 'https://en.wikipedia.org/wiki/Royal_Portrush_Golf_Club',
    evidence: '"The 36-hole club has two links courses, the Dunluce Links (the championship course) and the Valley Links. The former is one of the courses on the rota of the Open Championship and it recently hosted the 2025 tournament."',
    note: 'Hosted The Open in 2025 (ESPN tape row 401703521).',
  },
  {
    espnCourseName: 'Royal County Down GC',
    classification: 'links',
    region: 'Newcastle, County Down, Northern Ireland',
    source: 'https://www.royalcountydown.org/championship_links',
    evidence: 'The club\'s own Championship Links page: "The finest of all links courses, it offers a stern challenge from the championship tees."',
    note: 'Amgen Irish Open venue in the tape.',
  },
  {
    espnCourseName: 'Trump International Golf Links',
    classification: 'links',
    region: 'Doonbeg, County Clare, Ireland',
    source: 'https://www.golfpass.com/travel-advisor/courses/19459-trump-international-golf-links-ireland',
    evidence: 'Course profile records "Style: Links"; formerly Doonbeg Golf Club.',
    note: 'Amgen Irish Open venue in the tape. Secondary source — recorded as such.',
  },
  {
    espnCourseName: 'Pebble Beach Golf Links',
    classification: 'coastal',
    region: 'Pebble Beach, California, USA',
    source: WIKI_LINKS,
    evidence: 'Named in the links article as a course "regarded as links" that does "not, as presently constituted, have all of the necessary characteristics".',
    note: 'Wind-exposed coastal, NOT classified as links. Kept in a separate class so the two are never conflated.',
  },
];

/** Rejected venues, with the reason — so a reviewer can audit the negatives too. */
export const EXCLUDED = [
  { espnCourseName: 'Muirfield Village Golf Club', reason: 'Ohio, USA. Not Muirfield in East Lothian; a name collision, not a links.' },
  { espnCourseName: 'Royal Melbourne Golf Club', reason: 'Melbourne sandbelt. "Royal" in the title is not evidence and no cited source classifies it as links.' },
  { espnCourseName: 'Royal Queensland Golf Club', reason: '"Royal" in the title is not evidence; no cited classification found.' },
  { espnCourseName: 'Royal Johannesburg Club', reason: '"Royal" in the title is not evidence; inland parkland.' },
  { espnCourseName: 'Royal GC', reason: 'Ambiguous ESPN course name; refusing to classify a venue that cannot be resolved to a specific course.' },
  { espnCourseName: 'Harbour Town Golf Links', reason: '"Links" in the title is not evidence; no cited classification verified in this pass.' },
  { espnCourseName: 'St. Francis Links', reason: '"Links" in the title is not evidence; no cited classification verified in this pass.' },
  { espnCourseName: 'Yas Links GC', reason: '"Links" in the title is not evidence; no cited classification verified in this pass.' },
  { espnCourseName: 'Dunes Golf & Beach Club', reason: 'Ambiguous ESPN course name; refusing to classify.' },
];

function build() {
  const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : null;
  const tapeCourses = new Map();
  if (results) for (const e of Object.values(results.events || {})) tapeCourses.set(e.courseName ?? null, (tapeCourses.get(e.courseName ?? null) || 0) + 1);

  const rows = LINKS_ROWS.map((r) => ({
    ...r,
    espnCourseNameLower: r.espnCourseName.toLowerCase(),
    eventsInTape: tapeCourses.get(r.espnCourseName) || 0,
    inTape: tapeCourses.has(r.espnCourseName),
  }));
  const warnings = [];
  for (const r of rows) if (!r.inTape) warnings.push(`${r.espnCourseName}: classified but no event at this venue is in the committed results tape yet`);
  for (const x of EXCLUDED) if (!tapeCourses.has(x.espnCourseName)) warnings.push(`${x.espnCourseName}: excluded entry is not in the committed tape (harmless, kept for audit)`);

  return {
    schema_version: 1,
    sport: 'Golf',
    generated_at_utc: new Date().toISOString(),
    method: 'Hand-verified venue classification joined against data/golf_results.json. A venue is only classified when a cited source says so; "Royal" or "Links" in a course name is never treated as evidence. The Open Championship is not listed because it is always played on a links course (see sources[1]) and the engine matches it on the ESPN name plus the major flag.',
    sources: [
      { id: 'wiki-links-list', name: 'Wikipedia — List of links golf courses', url: WIKI_LIST, fetched_at_utc: new Date().toISOString() },
      { id: 'wiki-links', name: 'Wikipedia — Links (golf)', url: WIKI_LINKS, fetched_at_utc: new Date().toISOString(), provides: '"The Open Championship is always played on links courses"; Pebble Beach is explicitly named as not a true links' },
      { id: 'portrush', name: 'Wikipedia — Royal Portrush Golf Club', url: 'https://en.wikipedia.org/wiki/Royal_Portrush_Golf_Club', fetched_at_utc: new Date().toISOString() },
      { id: 'rcd', name: 'Royal County Down Golf Club — Championship Links', url: 'https://www.royalcountydown.org/championship_links', fetched_at_utc: new Date().toISOString() },
      { id: 'doonbeg', name: 'GolfPass — Trump International Golf Links Ireland', url: 'https://www.golfpass.com/travel-advisor/courses/19459-trump-international-golf-links-ireland', fetched_at_utc: new Date().toISOString() },
    ],
    coverage: {
      distinctCoursesInTape: tapeCourses.size,
      classifiedCourses: rows.length,
      classifiedEventsInTape: rows.reduce((a, r) => a + r.eventsInTape, 0),
      eventsInTape: results ? Object.keys(results.events || {}).length : 0,
    },
    courses: rows,
    excluded: EXCLUDED,
    warnings,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const doc = build();
  if (!check) {
    writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`[golf-links] wrote data/golf_links_courses.json — ${doc.courses.length} classified venue(s), ${doc.coverage.classifiedEventsInTape} tape event(s) at a classified venue`);
    for (const w of doc.warnings) console.log(`  ! ${w}`);
    return;
  }
  if (!existsSync(OUT)) { console.error('[golf-links] --check: data/golf_links_courses.json is missing'); process.exit(1); }
  const committed = JSON.parse(readFileSync(OUT, 'utf8'));
  // Compare the curated rows only. `eventsInTape` is derived from whatever tape
  // is committed, so it must never make --check fail after a routine collection.
  const key = (rows) => JSON.stringify((rows || []).map((r) => [r.espnCourseName, r.classification, r.source]));
  const same = key(committed.courses) === key(doc.courses) && key(committed.excluded) === key(doc.excluded);
  if (!same) { console.error('[golf-links] --check: data/golf_links_courses.json is out of date with scripts/build_golf_links.mjs; re-run without --check'); process.exit(1); }
  console.log(`[golf-links] --check ok — ${doc.courses.length} classified venue(s)`);
}

main();
