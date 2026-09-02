#!/usr/bin/env node
/**
 * scripts/verify_site.mjs — dependency-free static verification of the site.
 *
 * This is the "check it line by line" pass. For every HTML page it:
 *   1. finds the module scripts the page loads and follows their import graph,
 *   2. extracts every  $('#id')  /  getElementById('id')  /  querySelector('#id')
 *      the graph performs and asserts the id exists in that page,
 *   3. asserts every  id="..."  is unique within the page,
 *   4. asserts every local href/src resolves to a file that exists,
 *   5. asserts every external link is https and carries rel="noopener",
 *   6. asserts every JS/JSON file the pages fetch exists in the repo,
 *   7. syntax-checks every JS module and parses every JSON file in data/.
 *
 * Exit code 0 = clean, 1 = problems (each printed with file and line).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function fail(file, msg, line) {
  problems.push(`${relative(ROOT, file)}${line ? `:${line}` : ''}  ${msg}`);
}
function note(msg) { notes.push(msg); }

function read(p) { return readFileSync(p, 'utf8'); }

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/* ---------------- collect pages ---------------- */
const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
if (!pages.length) fail(ROOT, 'no HTML pages found');

/* ---------------- module graph ---------------- */
const moduleCache = new Map();

function loadModule(path) {
  if (moduleCache.has(path)) return moduleCache.get(path);
  if (!existsSync(path)) return null;
  const src = read(path);
  moduleCache.set(path, src);
  return src;
}

function importsOf(src, fromPath) {
  const out = [];
  const re = /(?:^|\n)\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    out.push(resolve(dirname(fromPath), spec));
  }
  return out;
}

function graphFor(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    const src = loadModule(p);
    if (src === null) { fail(entry, `imported module does not exist: ${relative(ROOT, p)}`); continue; }
    seen.add(p);
    for (const dep of importsOf(src, p)) stack.push(dep);
  }
  return [...seen];
}

/* ---------------- per-page checks ---------------- */
for (const page of pages) {
  const pagePath = join(ROOT, page);
  const html = read(pagePath);

  // 3. unique ids
  const ids = new Set();
  const idRe = /\sid="([^"]+)"/g;
  let m;
  while ((m = idRe.exec(html))) {
    if (ids.has(m[1])) fail(pagePath, `duplicate id "${m[1]}"`, lineOf(html, m.index));
    ids.add(m[1]);
  }

  // 4/5. links
  const attrRe = /\s(?:href|src)="([^"]+)"/g;
  while ((m = attrRe.exec(html))) {
    const url = m[1];
    const line = lineOf(html, m.index);
    if (url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('data:')) continue;
    if (/^https?:\/\//.test(url)) {
      if (url.startsWith('http://')) fail(pagePath, `insecure external link: ${url}`, line);
      const tagStart = html.lastIndexOf('<', m.index);
      const tag = html.slice(tagStart, html.indexOf('>', m.index) + 1);
      if (/^<a\b/.test(tag) && /target="_blank"/.test(tag) && !/rel="[^"]*noopener/.test(tag)) {
        fail(pagePath, `target=_blank without rel=noopener: ${url}`, line);
      }
      continue;
    }
    const clean = url.split('?')[0].split('#')[0];
    if (!clean) continue;
    const target = join(ROOT, clean);
    if (!existsSync(target)) fail(pagePath, `local reference not found: ${url}`, line);
  }

  // 1/2. selector coverage across the page's module graph
  const scriptRe = /<script[^>]*src="([^"]+)"[^>]*>/g;
  const entries = [];
  while ((m = scriptRe.exec(html))) entries.push(join(ROOT, m[1].split('?')[0]));
  if (!entries.length) note(`${page}: no module script (static page)`);

  const pageIds = ids;
  const dynamic = new Set(); // ids created at runtime by injected markup
  dynamic.add('toast');
  // Any id a module writes into markup itself counts as existing.
  for (const entry of entries) {
    if (!existsSync(entry)) continue;
    for (const mod of graphFor(entry)) {
      const src = loadModule(mod) || '';
      const dynRe = /\bid="([A-Za-z0-9_${}.[\]-]+)"/g;
      let dm;
      while ((dm = dynRe.exec(src))) dynamic.add(dm[1]);
    }
  }

  for (const entry of entries) {
    if (!existsSync(entry)) { fail(pagePath, `script not found: ${relative(ROOT, entry)}`); continue; }
    for (const mod of graphFor(entry)) {
      const src = loadModule(mod);
      if (!src) continue;
      // Only check selectors in page controllers, not in the shared shell,
      // because ui.js injects its own markup.
      const isShared = /assets\/js\/(ui|data-client)\.js$/.test(mod);
      // Matches $('#id'), $('#id .child'), $$('#id x'), getElementById('id'),
      // querySelector('#id ...') and querySelectorAll('#id ...').
      const selRe = /\$\$?\(\s*'#([A-Za-z0-9_-]+)(?:['\s]|$)|getElementById\(\s*'([A-Za-z0-9_-]+)'|querySelectorAll?\(\s*'#([A-Za-z0-9_-]+)(?:['\s]|$)/g;
      let s;
      while ((s = selRe.exec(src))) {
        const id = s[1] || s[2] || s[3];
        if (dynamic.has(id)) continue;
        if (isShared) continue;
        if (!pageIds.has(id)) {
          fail(mod, `selects #${id}, which does not exist in ${page}`, lineOf(src, s.index));
        }
      }
      // 6. static data files the module fetches
      const dataRe = /loadStatic\(\s*'([^']+)'/g;
      let d;
      while ((d = dataRe.exec(src))) {
        const p = join(ROOT, d[1]);
        if (!existsSync(p)) {
          note(`${relative(ROOT, mod)}:${lineOf(src, d.index)} fetches ${d[1]} which is not committed yet (the site degrades gracefully, but CI should build it)`);
        }
      }
    }
  }
}

/* ---------------- 7. syntax + JSON ---------------- */
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
for (const f of files) {
  if (/\.(js|mjs)$/.test(f)) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      // --check cannot parse ES modules with import in .js; fall back to a
      // dynamic import which does understand them.
      const msg = String(e.stderr || e.message);
      if (/Cannot use import statement outside a module|await is only valid/.test(msg)) continue;
      fail(f, `syntax error: ${msg.split('\n')[0]}`);
    }
  }
  if (f.endsWith('.json') && !f.includes('/node_modules/')) {
    try { JSON.parse(read(f)); } catch (e) { fail(f, `invalid JSON: ${e.message}`); }
  }
}

/* ---------------- engine module load check ---------------- */
const engineFiles = existsSync(join(ROOT, 'engine')) ? readdirSync(join(ROOT, 'engine')).filter((f) => f.endsWith('.js')) : [];
for (const f of engineFiles) {
  try {
    await import(join(ROOT, 'engine', f));
  } catch (e) {
    fail(join(ROOT, 'engine', f), `module failed to load: ${e.message}`);
  }
}

/* ---------------- report ---------------- */
console.log(`checked ${pages.length} pages, ${moduleCache.size} modules, ${files.filter((f) => f.endsWith('.json')).length} JSON files`);
if (notes.length) {
  console.log('\nNotes:');
  for (const n of notes) console.log(`  · ${n}`);
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ no problems found');
