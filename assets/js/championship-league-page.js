/**
 * SportsPred — Championship League Snooker page controller.
 *
 * This is an OVERLAY sub-page. It does not replace snooker.html: every other
 * snooker event on the OLBG slate keeps the generic SNOOKER PREDICTION MASTER
 * PROMPT v3.0. This page runs the CHAMPIONSHIP LEAGUE SNOOKER PREDICTION
 * MASTER PROMPT v1.0 over one machine-verified document.
 *
 * Data layer (committed in CI, no key-less live snooker feed exists):
 *   data/snooker_cls.json           verified tape — 253 matches, 168 published
 *                                   table rows, all 42 group tables recomputed
 *                                   from the scorelines and diffed field by
 *                                   field against the published standings
 *   data/snooker_cls_backtest.json  walk-forward ledger over the same tape
 *   data/snooker_slate.json         live OLBG snooker markets (display only)
 *
 * Honesty rules enforced here:
 *   - the card for a date is built ONLY from matches that finished strictly
 *     earlier (same-day-earlier counts, same-day-later never does), so what
 *     the page shows is what the engine could actually have known;
 *   - the edition is a hard gate — the ranking and invitational events use
 *     different formats, so the user picks one and the engine scores that one;
 *   - nothing is invented: a market with no supporting evidence prints SKIP.
 */

import { getSport } from '../../engine/registry.js';
import { buildDayCard, datesIn, seedMap } from '../../engine/snooker_cls_card.js';
import { buildCopyText } from '../../engine/snooker_cls_writer.js';
import { loadStatic, clearCache, siteUrl } from './data-client.js';
import {
  $, $$, esc, todayISO, fmtDateLong, renderShell, renderFooter, toast, copyText, qs, setQS,
} from './ui.js';

const OLBG_SNOOKER = 'https://www.olbg.com/betting-tips/Snooker/8';
const CLS_OFFICIAL = 'https://championshipleaguesnooker.co.uk/ranking/';

const state = {
  sport: null,
  doc: null,
  backtestDoc: null,
  slate: null,
  dates: [],
  date: qs('date', null),
  edition: qs('edition', 'ranking'),
  market: 'all',
  search: '',
  card: null,
  seeds: null,
  calMonth: null,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('snooker');
  renderShell({ activeSport: 'snooker', activePage: 'snooker.html' });
  renderFooter();
  renderTabs();
  renderSportLinks();
  wire();

  // loadStatic resolves with { data, error } rather than rejecting, so a
  // failure has to be checked for explicitly. A missing tape must show as a
  // missing tape, never as an empty card that looks like "no matches today".
  const tape = await loadStatic('data/snooker_cls.json');
  if (!tape?.data) {
    $('#board').innerHTML = `<div class="card-body empty">Could not load the verified Championship League tape${tape?.error ? ` (${esc(tape.error)})` : ''}. Nothing is shown rather than guessed.</div>`;
    return;
  }
  state.doc = tape.data;

  state.dates = datesIn(state.doc);
  state.seeds = seedMap(state.doc);
  if (!state.dates.includes(state.date)) {
    const today = todayISO();
    state.date = state.dates.includes(today)
      ? today
      : (state.dates.find((d) => d >= today) || state.dates[state.dates.length - 1]);
  }
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  $('#date-input').value = state.date;
  $('#edition').value = state.edition;

  renderEditionBanner();
  renderVerification();
  renderGroupTables();
  generate();

  // Side panels are non-blocking: a missing one must never break the card.
  loadStatic('data/snooker_cls_backtest.json')
    .then((r) => {
      if (!r?.data) throw new Error(r?.error || 'unavailable');
      state.backtestDoc = r.data;
      renderBacktest();
    })
    .catch(() => { $('#backtest').textContent = 'Backtest ledger not published yet.'; });
  loadStatic('data/snooker_slate.json')
    .then((r) => {
      if (!r?.data) throw new Error(r?.error || 'unavailable');
      state.slate = r.data;
      renderOlbg();
    })
    .catch(() => { $('#olbg-box').textContent = 'OLBG slate unavailable.'; });
}

function wire() {
  $('#prev-day').onclick = () => step(-1);
  $('#next-day').onclick = () => step(1);
  $('#first-day').onclick = () => setDate(state.dates[0]);
  $('#date-input').onchange = (e) => setDate(e.target.value);
  $('#edition').onchange = (e) => {
    state.edition = e.target.value;
    setQS({ edition: state.edition });
    renderEditionBanner();
    generate();
  };
  $('#market-filter').onchange = (e) => { state.market = e.target.value; renderBoard(); };
  $('#search').oninput = (e) => { state.search = e.target.value.trim().toLowerCase(); renderBoard(); };
  $('#generate').onclick = () => { clearCache(); generate(true); };
  $('#copy-all').onclick = async () => {
    if (!state.card) return;
    await copyText(buildCopyText(state.card));
    toast('Full card copied');
  };
  $('#cal-prev').onclick = () => { state.calMonth.setUTCMonth(state.calMonth.getUTCMonth() - 1); renderCalendar(); };
  $('#cal-next').onclick = () => { state.calMonth.setUTCMonth(state.calMonth.getUTCMonth() + 1); renderCalendar(); };
}

function step(n) {
  const i = state.dates.indexOf(state.date);
  const next = state.dates[Math.min(state.dates.length - 1, Math.max(0, i + n))];
  if (next) setDate(next);
}

function setDate(d) {
  if (!d || d === state.date) return;
  state.date = d;
  $('#date-input').value = d;
  state.calMonth = new Date(`${d}T12:00:00Z`);
  setQS({ date: d });
  generate();
}

/* ------------------------------------------------------- generate & render */

function generate(announce = false) {
  $('#progress-label').textContent = 'Scoring every fixture on this date…';
  try {
    state.card = buildDayCard(state.doc, state.date, { edition: state.edition, seeds: state.seeds });
  } catch (err) {
    state.card = null;
    $('#board').innerHTML = `<div class="card-body empty">${esc(err.message)}</div>`;
    $('#progress-label').textContent = '';
    return;
  }
  renderBoard();
  renderCalendar();
  renderDateStrip();
  renderRail();
  const invalid = state.card.validation.issues.length;
  $('#progress-label').textContent = invalid
    ? `${invalid} tip${invalid === 1 ? '' : 's'} failed the output rules and are marked below.`
    : 'Every tip on this card passes the output rules: minimum length, bolded pick in the opening, no figures, no citations, varied openings.';
  if (announce) toast('Predictions regenerated');
}

function renderTabs() {
  const tabs = $('#league-tabs');
  if (!tabs) return;
  tabs.innerHTML = (state.sport?.subPages || [])
    .map((p) => `<a href="${siteUrl(p.href)}" class="${p.href === 'championship-league.html' ? 'on' : ''}" title="${esc(p.name)}">${esc(p.label)}</a>`)
    .join('');
}

function renderSportLinks() {
  $('#sport-links').innerHTML = (state.sport?.officialLinks || [])
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`)
    .join(' · ');
}

function renderEditionBanner() {
  const ranking = state.edition === 'ranking';
  $('#edition-banner').innerHTML = `
    <div class="card" style="border-left:4px solid var(--accent)">
      <div class="card-body" style="font-size:13.5px">
        <strong>Edition: ${ranking ? 'ranking' : 'invitational'}.</strong>
        ${ranking
    ? 'One hundred and twenty-eight players, thirty-two groups of four, matches over the best of four frames. A match can therefore end level at two frames each — three points for a win, one point each for a draw — and the fourth frame is not played once someone reaches three. The correct-score set is 3-0, 3-1 and 2-2.'
    : 'Twenty-five players in groups of seven, matches over the best of five frames, with the top four going straight into same-day play-offs. A draw is impossible, so the correct-score set is 3-0, 3-1 and 3-2 and the draw modifier is switched off.'}
        The committed tape on this page is the <strong>ranking</strong> edition, so choosing the invitational rules re-scores that tape under a format it was not played under. That is useful for testing the ruleset, not for judging results.
      </div>
    </div>`;
}

function visibleEntries() {
  if (!state.card) return [];
  return state.card.entries.filter((e) => {
    if (state.search && !`${e.subject} ${e.group || ''} ${e.stageLabel || ''}`.toLowerCase().includes(state.search)) return false;
    if (state.market !== 'all' && !e.tips.some((t) => t.market === state.market)) return false;
    return true;
  });
}

function badge(conf) {
  return `<span class="badge ${esc(conf)}">${esc(conf)}</span>`;
}

function tipHtml(entry, tip, idx) {
  const problem = state.card.validation.issues.find((v) => v.subject === entry.subject && v.market === tip.market);
  const body = esc(tip.text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return `
    <div class="tip-box" data-market="${esc(tip.market)}">
      <div class="tip-meta">
        <span class="badge ghost">${esc(tip.market)}</span>
        ${badge(tip.confidence)}
        <span class="meta-line">${tip.skip ? 'no selection' : `pick: <strong>${esc(tip.pick)}</strong>`}</span>
        <span class="sp" style="flex:1"></span>
        <button class="btn sm copy-one" data-i="${idx}">📋 Copy</button>
      </div>
      <div class="tip-text">${body}</div>
      ${problem ? `<div class="meta-line" style="color:var(--live)">Output rule failed: ${esc(problem.violations.join('; '))}</div>` : ''}
    </div>`;
}

function renderBoard() {
  if (!state.card) return;
  const rows = visibleEntries();
  $('#day-title').textContent = fmtDateLong(state.date);
  const played = rows.filter((r) => r.kind !== 'group').length;
  const groups = rows.length - played;
  const tips = rows.reduce((n, r) => n + r.tips.length, 0);
  $('#counts').textContent = `${played} match card${played === 1 ? '' : 's'} · ${groups} group card${groups === 1 ? '' : 's'} · ${tips} tips`;

  if (!rows.length) {
    $('#board').innerHTML = '<div class="card-body empty">Nothing on this date matches the current filter.</div>';
    return;
  }

  const flat = [];
  $('#board').innerHTML = rows.map((e) => {
    const tipsHtml = e.tips
      .filter((t) => state.market === 'all' || t.market === state.market)
      .map((t) => { flat.push(t); return tipHtml(e, t, flat.length - 1); })
      .join('');
    return `
      <div class="match">
        <div class="match-main" style="display:block;padding:12px 14px">
          <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
            <strong style="font-size:15px">${esc(e.subject)}</strong>
            <span class="meta-line">${esc(e.stageLabel || e.group || '')}${e.kind === 'group' ? ' · group card' : ''}</span>
          </div>
          ${tipsHtml}
        </div>
      </div>`;
  }).join('');

  $$('#board .copy-one').forEach((b) => {
    b.onclick = async () => {
      await copyText(flat[Number(b.dataset.i)].text.replace(/\*\*/g, ''));
      toast('Tip copied');
    };
  });
}

function renderDateStrip() {
  const i = state.dates.indexOf(state.date);
  const window = state.dates.slice(Math.max(0, i - 5), Math.max(0, i - 5) + 11);
  $('#datestrip').innerHTML = window.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return `<button class="day ${d === state.date ? 'on' : ''}" data-d="${d}">
      <span class="dow">${dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
      <span class="dnum">${dt.getUTCDate()}</span>
      <span class="dot"></span>
    </button>`;
  }).join('');
  $$('#datestrip .day').forEach((b) => { b.onclick = () => setDate(b.dataset.d); });
}

function matchCountByDate() {
  const m = new Map();
  for (const mt of state.doc.matches) m.set(mt.date, (m.get(mt.date) || 0) + 1);
  return m;
}

function renderCalendar() {
  const counts = matchCountByDate();
  const y = state.calMonth.getUTCFullYear();
  const mo = state.calMonth.getUTCMonth();
  $('#cal-title').textContent = state.calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const first = new Date(Date.UTC(y, mo, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday-first
  const cells = [];
  for (let k = 0; k < 42; k += 1) {
    const d = new Date(Date.UTC(y, mo, 1 + k - offset));
    const iso = d.toISOString().slice(0, 10);
    const n = counts.get(iso) || 0;
    cells.push(`<button class="cell ${d.getUTCMonth() === mo ? '' : 'other'} ${iso === state.date ? 'on' : ''} ${iso === todayISO() ? 'today' : ''}"
      data-d="${iso}" ${n ? '' : 'disabled'} title="${n ? `${n} matches` : 'no play'}">
      <span class="n">${d.getUTCDate()}</span><span class="c">${n || ''}</span></button>`);
  }
  $('#calgrid').innerHTML = cells.join('');
  $$('#calgrid .cell').forEach((b) => { b.onclick = () => setDate(b.dataset.d); });
}

function renderGroupTables() {
  const byGroup = new Map();
  for (const r of state.doc.tables) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  $('#tables-note').textContent = `${byGroup.size} groups · every row recomputed from the scorelines and matched to the published standing`;
  $('#grouptables').innerHTML = [...byGroup.entries()].map(([g, rows]) => `
    <details>
      <summary style="padding:8px 14px;cursor:pointer;font-weight:600">${esc(g)} — winner ${esc(rows.find((r) => r.pos === 1)?.player || '—')}</summary>
      <table class="data">
        <thead><tr><th>#</th><th>Player</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">FF</th><th class="num">FA</th><th class="num">HB</th><th class="num">Pts</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="num">${r.pos}</td><td>${esc(r.player)}</td>
          <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
          <td class="num">${r.framesFor}</td><td class="num">${r.framesAgainst}</td>
          <td class="num">${r.highestBreak ?? '—'}</td><td class="num"><strong>${r.points}</strong></td>
        </tr>`).join('')}</tbody>
      </table>
    </details>`).join('');
}

/* ------------------------------------------------------------------ rail */

function renderRail() {
  const t = state.card.summaryTable;
  const shown = new Set(visibleEntries().map((e) => e.subject));
  const rows = t.rows.filter((r) => shown.has(r[0]));
  $('#rail-summary').innerHTML = `
    <table class="data">
      <thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r[0])}</td><td>${esc(r[1])}</td><td><strong>${esc(r[2])}</strong></td>
        <td>${badge(r[3])}</td></tr>`).join('')}</tbody>
    </table>`;

  const v = state.card.valueCandidates || [];
  $('#rail-value').innerHTML = v.length
    ? v.map((c) => `<div style="margin-bottom:6px">• <strong>${esc(c.name)}</strong> — ${esc(c.subject)}, on ${esc(c.basis)}.</div>`).join('')
    : 'No value candidate on this card. Value cannot be measured without a price, and no free key-less snooker price feed exists, so a flag is only raised when the model rates a side clearly above the field on evidence alone.';

  const rg = state.card.responsibleGambling;
  $('#rg-box').innerHTML = `<p><strong>${esc(rg.heading)}</strong></p>`
    + rg.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
}

function renderVerification() {
  const v = state.doc.verification;
  const src = (state.doc.event.sources || [])[0];
  $('#verification').innerHTML = `
    <p>${esc(v.method)}</p>
    <table class="kv">
      <tr><th>Groups checked</th><td class="num">${v.groups_checked}</td></tr>
      <tr><th>Table rows checked</th><td class="num">${v.rows_checked}</td></tr>
      <tr><th>Matches checked</th><td class="num">${v.matches_checked}</td></tr>
      <tr><th>Mismatches</th><td class="num"><strong style="color:${v.problems.length ? 'var(--live)' : 'var(--win)'}">${v.problems.length}</strong></td></tr>
    </table>
    ${v.problems.length ? `<p style="color:var(--live)">${v.problems.map(esc).join('<br>')}</p>` : '<p>Every published standing reproduces exactly from the transcribed scorelines.</p>'}
    <p>Highest break cannot be derived from a scoreline, so it is carried from the published table and labelled as such.</p>
    ${src ? `<p><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">Open the source revision</a></p>` : ''}`;
}

function renderBacktest() {
  const b = state.backtestDoc;
  const pct = (c, g) => (g ? `${Math.round((c / g) * 100)}%` : '—');
  $('#backtest').innerHTML = `
    <p>Every card re-scored using only matches that had finished at the time, then settled against the published result.</p>
    <table class="kv">
      ${Object.entries(b.byMarket).map(([m, r]) => `<tr><th>${esc(m)}</th><td class="num">${r.correct}/${r.graded} · ${pct(r.correct, r.graded)}</td></tr>`).join('')}
      <tr><th>Graded</th><td class="num">${b.graded}</td></tr>
      <tr><th>Skipped</th><td class="num">${b.skipped}</td></tr>
    </table>
    <p>Most rows are skipped on purpose. The odds-and-value category is worth fifteen points and there is no free price feed, so a large share of match-result reads never clear the confidence floor. A skip is recorded as a skip, never quietly upgraded.</p>
    <p>No return figure is published, because without prices any return would be invented.</p>`;
}

function renderOlbg() {
  const evs = (state.slate?.events || []).slice(0, 8);
  $('#olbg-box').innerHTML = `
    <p>Live snooker markets currently listed on OLBG:</p>
    ${evs.length
    ? `<ul style="margin:0;padding-left:18px">${evs.map((e) => `<li>${esc(e.name || e.title || e.id)}</li>`).join('')}</ul>`
    : '<p>No snooker market is on the OLBG slate right now.</p>'}
    <p>OLBG publishes tipster vote shares, not prices, so nothing here is treated as an odds input.</p>
    <p><a href="${OLBG_SNOOKER}" target="_blank" rel="noopener noreferrer">OLBG snooker tips</a> · <a href="${CLS_OFFICIAL}" target="_blank" rel="noopener noreferrer">Championship League official site</a></p>`;
}

function renderSources() {
  const links = [...new Set((state.doc.event.sources || []))];
  $('#sources').innerHTML = `
    <p>Every line on this page traces to a fixed source revision, so it can be checked by hand:</p>
    <ul style="margin:0;padding-left:18px">
      ${links.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}
      <li><a href="${CLS_OFFICIAL}" target="_blank" rel="noopener noreferrer">Championship League Snooker — official</a></li>
      <li><a href="https://www.wst.tv/" target="_blank" rel="noopener noreferrer">World Snooker Tour</a></li>
      <li><a href="https://www.snooker.org/res/index.asp" target="_blank" rel="noopener noreferrer">snooker.org results</a></li>
      <li><a href="${siteUrl('docs/CLS_SNOOKER_IRREGULARITIES.md')}">Irregularity register</a></li>
      <li><a href="${siteUrl('docs/CLS_SNOOKER_MASTER_PROMPT.md')}">The prompt this page implements</a></li>
    </ul>`;
}

boot().then(() => { try { renderSources(); } catch { /* sources panel is decorative */ } });
