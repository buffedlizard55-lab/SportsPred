#!/usr/bin/env node
/**
 * SportsPred — build data/snooker_cls.json from the verbatim Championship League
 * source capture, and machine-verify it line by line.
 *
 * Inputs (both transcribed verbatim from one dated Wikipedia revision, which
 * itself cites snooker.org event pages and WST match centres for every group):
 *
 *   data/raw/cls2026_matches.txt   every group match, in published order
 *   data/raw/cls2026_tables.txt    every published group table row
 *
 * VERIFICATION (run with --check in CI): the group tables are RECOMPUTED from
 * the match list under the published rules — 3 points for a win, 1 for a draw,
 * frame difference, head-to-head, highest break — and compared row by row with
 * the published tables. Any played/won/drawn/lost/frames/points mismatch is a
 * hard failure, so a mistyped scoreline cannot survive. Highest break is not
 * derivable from scorelines and is carried across from the published table,
 * flagged `hb_source: "published_table"`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATCHES = path.join(ROOT, 'data/raw/cls2026_matches.txt');
const TABLES = path.join(ROOT, 'data/raw/cls2026_tables.txt');
const OUT = path.join(ROOT, 'data/snooker_cls.json');

export const EVENT = Object.freeze({
  id: 'cls-2026-ranking',
  name: '2026 BetVictor Championship League Snooker',
  edition: 'ranking',
  season: '2026-27',
  organisation: 'Matchroom Sport',
  venue: 'Leicester Arena',
  city: 'Leicester',
  country: 'England',
  start: '2026-06-22',
  end: '2026-07-15',
  prize_fund_gbp: 328000,
  winner_share_gbp: 33000,
  champion: 'Jak Jones',
  runner_up: 'David Gilbert',
  final_score: '3-2',
  group_match_format: 'best of 4 frames (draws possible)',
  final_format: 'best of 5 frames',
  points: { win: 3, draw: 1, loss: 0 },
  tiebreak: ['points', 'frame difference', 'head-to-head', 'highest break'],
  sources: [
    'https://en.wikipedia.org/w/index.php?title=2026_Championship_League_(ranking)&oldid=1364748219',
    'https://www.snooker.org/res/index.asp?event=2760',
    'https://championshipleaguesnooker.co.uk/ranking/',
    'https://www.wst.tv/news/2026/july/15/Jones-Wins-First-Ranking-Title/',
  ],
});

const STAGE_OF = (g) => {
  if (/^G\d+$/.test(g)) return { stage: 1, label: `Stage One Group ${g.slice(1)}` };
  if (/^G[A-H]$/.test(g)) return { stage: 2, label: `Stage Two Group ${g.slice(1)}` };
  if (/^WG[12]$/.test(g)) return { stage: 3, label: `Winners' group ${g.slice(2)}` };
  if (g === 'FINAL') return { stage: 4, label: 'Final' };
  throw new Error(`unknown group key ${g}`);
};

/** Parse one match line: "G1|2026-07-09|Zhao Xintong 3-0 Simon Blackwell". */
export function parseMatchLine(line) {
  const [group, date, body] = line.split('|');
  if (!group || !date || !body) throw new Error(`malformed match line: ${line}`);
  if (body.startsWith('EXPUNGED ')) {
    const inner = parseMatchLine(`${group}|${date}|${body.slice('EXPUNGED '.length)}`);
    return { ...inner, expunged: true };
  }
  if (body.startsWith('WALKOVER')) {
    const m = body.match(/^WALKOVER (.+) w\/d - (.+) w\/o$/);
    if (!m) throw new Error(`malformed walkover: ${line}`);
    return { group, date, walkover: true, withdrew: m[1].trim(), advanced: m[2].trim() };
  }
  const m = body.match(/^(.+?) (\d)-(\d) (.+)$/);
  if (!m) throw new Error(`malformed score: ${line}`);
  const [, a, sa, sb, b] = m;
  const scoreA = Number(sa);
  const scoreB = Number(sb);
  const isFinal = group === 'FINAL';
  const maxFrames = isFinal ? 3 : 3;
  if (scoreA > maxFrames || scoreB > maxFrames) throw new Error(`impossible score: ${line}`);
  if (!isFinal && scoreA + scoreB > 4) throw new Error(`best-of-four exceeded: ${line}`);
  if (!isFinal && scoreA !== 3 && scoreB !== 3 && !(scoreA === 2 && scoreB === 2)) {
    throw new Error(`unfinished best-of-four: ${line}`);
  }
  return {
    group,
    date,
    playerA: a.trim(),
    playerB: b.trim(),
    scoreA,
    scoreB,
    draw: scoreA === scoreB,
    winner: scoreA === scoreB ? null : (scoreA > scoreB ? a.trim() : b.trim()),
  };
}

export function readLines(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Parse one published table row (12 fields). */
export function parseTableLine(line) {
  const p = line.split('|');
  if (p.length !== 12) throw new Error(`table row needs 12 fields, got ${p.length}: ${line}`);
  return {
    group: p[0],
    pos: Number(p[1]),
    player: p[2],
    played: Number(p[3]),
    won: Number(p[4]),
    drawn: Number(p[5]),
    lost: Number(p[6]),
    framesFor: Number(p[7]),
    framesAgainst: Number(p[8]),
    frameDiff: Number(p[9]),
    highestBreak: p[10] === '-' ? null : Number(p[10]),
    points: Number(p[11]),
  };
}

/** Recompute a group table from its matches under the published rules. */
export function computeTable(matches) {
  const rows = new Map();
  const ensure = (name) => {
    if (!rows.has(name)) {
      rows.set(name, {
        player: name, played: 0, won: 0, drawn: 0, lost: 0,
        framesFor: 0, framesAgainst: 0, frameDiff: 0, points: 0,
      });
    }
    return rows.get(name);
  };
  for (const m of matches) {
    if (m.walkover) { ensure(m.withdrew); ensure(m.advanced); continue; }
    // Struck from the group table by the organisers after a withdrawal.
    if (m.expunged) { ensure(m.playerA); ensure(m.playerB); continue; }
    const A = ensure(m.playerA);
    const B = ensure(m.playerB);
    A.played += 1; B.played += 1;
    A.framesFor += m.scoreA; A.framesAgainst += m.scoreB;
    B.framesFor += m.scoreB; B.framesAgainst += m.scoreA;
    if (m.draw) { A.drawn += 1; B.drawn += 1; A.points += 1; B.points += 1; }
    else if (m.scoreA > m.scoreB) { A.won += 1; B.lost += 1; A.points += 3; }
    else { B.won += 1; A.lost += 1; B.points += 3; }
  }
  for (const r of rows.values()) r.frameDiff = r.framesFor - r.framesAgainst;
  return rows;
}

const COMPARE = ['played', 'won', 'drawn', 'lost', 'framesFor', 'framesAgainst', 'frameDiff', 'points'];

export function verify(matchLines, tableLines) {
  const matches = matchLines.map(parseMatchLine);
  const published = tableLines.map(parseTableLine);
  const problems = [];

  const byGroup = new Map();
  for (const m of matches) {
    if (m.group === 'FINAL') continue;
    if (!byGroup.has(m.group)) byGroup.set(m.group, []);
    byGroup.get(m.group).push(m);
  }
  const pubByGroup = new Map();
  for (const r of published) {
    if (!pubByGroup.has(r.group)) pubByGroup.set(r.group, []);
    pubByGroup.get(r.group).push(r);
  }

  for (const [group, rows] of pubByGroup) {
    const ms = byGroup.get(group) || [];
    // Round-robin of four players => six fixtures, always.
    if (ms.length !== 6) problems.push(`${group}: ${ms.length} matches transcribed, expected 6`);
    const computed = computeTable(ms);
    for (const pub of rows) {
      const got = computed.get(pub.player);
      if (!got) { problems.push(`${group}: ${pub.player} in published table but in no transcribed match`); continue; }
      for (const f of COMPARE) {
        if (got[f] !== pub[f]) {
          problems.push(`${group} ${pub.player}: ${f} computed ${got[f]} but published ${pub[f]}`);
        }
      }
    }
    for (const name of computed.keys()) {
      if (!rows.some((r) => r.player === name)) problems.push(`${group}: ${name} played but is not in the published table`);
    }
    // Winner check: published position 1 must be top on points, then FD, then highest break.
    const sorted = [...rows].sort((a, b) => (
      b.points - a.points || b.frameDiff - a.frameDiff || (b.highestBreak ?? 0) - (a.highestBreak ?? 0)
    ));
    if (sorted[0].player !== rows.find((r) => r.pos === 1)?.player) {
      // head-to-head can legitimately break the tie before highest break; only
      // flag when points/FD themselves put someone else clearly ahead.
      const top = rows.find((r) => r.pos === 1);
      if (sorted[0].points > top.points || (sorted[0].points === top.points && sorted[0].frameDiff > top.frameDiff)) {
        problems.push(`${group}: published winner ${top.player} is behind ${sorted[0].player} on points/frame difference`);
      }
    }
  }
  return { matches, published, problems };
}

export function build() {
  const { matches, published, problems } = verify(readLines(MATCHES), readLines(TABLES));
  if (problems.length) {
    const err = new Error(`Championship League verification failed:\n  ${problems.join('\n  ')}`);
    err.problems = problems;
    throw err;
  }
  const hb = new Map(published.map((r) => [`${r.group}~${r.player}`, r.highestBreak]));
  const out = {
    schema_version: 1,
    sport: 'Snooker',
    competition: 'Championship League',
    event: EVENT,
    verification: {
      method: 'Every group table recomputed from the transcribed match list under the published points rules and compared field by field with the published table.',
      groups_checked: new Set(published.map((r) => r.group)).size,
      rows_checked: published.length,
      matches_checked: matches.length,
      problems: [],
    },
    matches: matches.map((m, i) => {
      const st = STAGE_OF(m.group);
      return {
        id: `cls2026-${m.group.toLowerCase()}-${String(i).padStart(3, '0')}`,
        event_id: EVENT.id,
        group: m.group,
        stage: st.stage,
        stage_label: st.label,
        date: m.date,
        best_of: m.group === 'FINAL' ? 5 : 4,
        walkover: Boolean(m.walkover),
        expunged: Boolean(m.expunged),
        player_a: m.walkover ? m.withdrew : m.playerA,
        player_b: m.walkover ? m.advanced : m.playerB,
        score_a: m.walkover ? null : m.scoreA,
        score_b: m.walkover ? null : m.scoreB,
        draw: m.walkover ? false : m.draw,
        winner: m.walkover ? m.advanced : m.winner,
        source: EVENT.sources[0],
      };
    }),
    tables: published.map((r) => ({ ...r, hb_source: 'published_table', source: EVENT.sources[0] })),
  };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  let doc;
  try {
    doc = build();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (check) {
    const existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const same = JSON.stringify(existing) === JSON.stringify(doc);
    console.log(same ? 'snooker_cls.json is up to date and verified' : 'snooker_cls.json is STALE — rerun without --check');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${doc.matches.length} matches, ${doc.tables.length} table rows, ${doc.verification.groups_checked} groups verified`);
}
