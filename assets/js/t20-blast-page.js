/**
 * SportsPred — T20 Blast page controller (t20-blast.html), a sub-page of Cricket.
 *
 * Committed, provenance-tagged documents (built by scripts/build_t20_blast.mjs,
 * validated by the same script's --check mode and by scripts/backtest_t20_blast.mjs):
 *   data/t20_blast_competition.json   format, groups, points system, sources
 *   data/t20_blast_matches.json       the verified results tape (96 fixtures)
 *   data/t20_blast_standings.json     the three group tables, recomputed and matched
 *   data/t20_blast_leaders.json       season leaders and knockout performances
 *   data/t20_blast_provenance.json    source register, irregularities, known ids
 *   data/t20_blast_backtest.json      walk-forward report + the publication gate
 *   data/t20_blast_predictions.json   forward ledger
 *
 * THE BUTTON. Predictions are generated on load AND on every click of Generate.
 * Scoring is pure and runs in the browser against the committed documents, so
 * the button works with no network at all. There is no live refresh here: the
 * historical tape is complete and verified, and for a live season the collector
 * (scripts/collect_t20_blast.mjs) rewrites the tape in CI rather than the
 * browser guessing from a partial feed.
 *
 * THE GATE. Published confidence is capped by the committed backtest, and the
 * observed hit rate for each tier is shown beside every tip. The cap is applied
 * in engine/t20_blast_engine.js so the browser, CI and the backtest all agree.
 */

import { getSport } from '../../engine/registry.js';
import { contextFor, deductionMap, groupMap, tableAt, LEAGUE_STAGES } from '../../engine/t20_blast_data.js';
import { scoreBlastMatch, applyPublicationGate, gateFromBacktest, BAND } from '../../engine/t20_blast_engine.js';
import { writeBlastCard, buildBlastFormattedCardText, buildValidationDisclosure, MARKET_LABEL, MARKET_ORDER, openingWord } from '../../engine/t20_blast_writer.js';
import { loadStatic, addDays } from './data-client.js';
import { $, $$, esc, todayISO, fmtDateLong, relTime, renderShell, renderFooter, toast, copyText, qs, setQS, confBar, formPips } from './ui.js';

const state = {
  sport: null,
  date: qs('date', todayISO()),
  stage: 'all',
  status: 'all',
  search: '',
  docs: null,
  gate: null,
  byDate: new Map(),
  calMonth: null,
  generatedAt: null,
  movedFromDate: null,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sport = getSport('cricket');
  state.calMonth = new Date(`${state.date}T12:00:00Z`);
  renderShell({ activeSport: 'cricket', activePage: 't20-blast.html' });
  renderFooter();
  renderStatic();
  wireControls();
  await loadDocs();
  buildAllCards();

  // A completed season has no fixtures "today". Rather than open on an empty
  // board, move to the nearest date that has one and say so.
  if (!qs('date') && !state.byDate.has(state.date)) {
    const near = nearestDateWithFixtures(state.date);
    if (near && near !== state.date) {
      state.movedFromDate = state.date;
      state.date = near;
      $('#date-input').value = near;
      setQS({ date: near });
    }
  }

  renderAll();
  // Generate on load: the page must never open asking to be clicked.
  generate();
}

function renderStatic() {
  $('#page-title').textContent = 'Cricket — T20 Blast';
  $('#league-tabs').innerHTML = (state.sport?.subPages || []).map((p) => `
    <a href="${esc(p.href)}" class="${p.href === 't20-blast.html' ? 'on' : ''}" title="${esc(p.name)}">${esc(p.label)}</a>`).join('');
  $('#sport-links').innerHTML = (state.sport?.officialLinks || [])
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join(' · ');
  $('#sport-notes').innerHTML = (state.sport?.notes || []).map((n) => `
    <div class="card"><div class="card-body meta-line">${n}</div></div>`).join('');
}

async function loadDocs() {
  const want = [
    ['competition', 'data/t20_blast_competition.json'],
    ['matches', 'data/t20_blast_matches.json'],
    ['standings', 'data/t20_blast_standings.json'],
    ['leaders', 'data/t20_blast_leaders.json'],
    ['provenance', 'data/t20_blast_provenance.json'],
    ['backtest', 'data/t20_blast_backtest.json'],
    ['predictions', 'data/t20_blast_predictions.json'],
  ];
  const docs = {};
  const problems = [];
  for (const [key, path] of want) {
    try {
      docs[key] = await loadStatic(path);
    } catch (e) {
      problems.push(`${path} — ${e.message}`);
      docs[key] = null;
    }
  }
  state.docs = docs;
  state.loadProblems = problems;
  state.gate = docs.backtest ? gateFromBacktest(docs.backtest) : null;
  state.opts = {
    deductions: docs.standings ? deductionMap(docs.standings) : {},
    groupOf: docs.standings ? groupMap(docs.standings) : {},
  };
}

/* ------------------------------------------------------------------ scoring */

/**
 * Score every fixture in the tape once, walk-forward, and index by date.
 *
 * `contextFor` keeps only fixtures dated strictly before the one being scored,
 * so a past date shows exactly what the model could have known that morning.
 */
function buildAllCards() {
  const rows = state.docs?.matches?.matches || [];
  state.byDate.clear();
  for (const row of rows) {
    if (!row?.date) continue;
    let result;
    try {
      result = scoreBlastMatch(row, contextFor(row, state.docs.matches, state.opts));
      result = applyPublicationGate(result, state.gate);
    } catch (e) {
      result = { error: e.message, markets: {}, missing: [], flags: [], caps: [], review_urls: row.review_urls || [] };
    }
    if (!state.byDate.has(row.date)) state.byDate.set(row.date, []);
    state.byDate.get(row.date).push({ match: row, result });
  }
}

function fixturesFor(dateISO) {
  return state.byDate.get(dateISO) || [];
}

function visibleFixtures(dateISO) {
  const q = state.search.trim().toLowerCase();
  return fixturesFor(dateISO).filter(({ match }) => {
    if (state.stage === 'group' && match.stage !== 'group') return false;
    if (state.stage === 'cross' && match.stage !== 'cross') return false;
    if (state.stage === 'knockout' && !['quarter-final', 'semi-final', 'final'].includes(match.stage)) return false;
    const decided = !!match.winner_slug;
    if (state.status === 'results' && !decided) return false;
    if (state.status === 'upcoming' && decided) return false;
    if (q) {
      const hay = `${match.home} ${match.away} ${match.venue || ''} ${match.group || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ generate */

/**
 * The Generate handler. It does the work rather than repainting stale state —
 * the bug that made the cricket console's button look dead was a render-only
 * handler that could never recover from an empty load.
 */
function generate() {
  const rows = visibleFixtures(state.date);
  const out = $('#pred-out');
  const hints = $('#pred-hint');
  const warns = $('#pred-warnings');

  if (!rows.length) {
    state.card = null;
    state.cardText = null;
    out.innerHTML = `<div class="empty">No fixtures on ${esc(fmtDateLong(state.date))} match the current filters. Pick another day on the calendar, or clear the stage and status filters.</div>`;
    $('#card-text').textContent = 'No fixtures to build a card from.';
    hints.textContent = '';
    warns.innerHTML = '';
    renderRail();
    return;
  }

  let card;
  let text;
  try {
    card = writeBlastCard(rows);
    text = buildBlastFormattedCardText(rows, { dateLabel: fmtDateLong(state.date), gate: state.gate }).text;
  } catch (e) {
    out.innerHTML = `<div class="empty">The writer refused to publish this card: ${esc(e.message)}</div>
      <div class="card-body meta-line">That is deliberate. A tip that cannot satisfy every output rule is withheld rather than printed, so a rule break can never reach the page or the clipboard.</div>`;
    hints.textContent = 'card withheld';
    warns.innerHTML = '';
    return;
  }

  state.card = card;
  state.cardText = text;
  state.generatedAt = new Date().toISOString();
  $('#card-text').textContent = text;

  const active = card.tips.filter((t) => !t.skip);
  const skips = card.tips.filter((t) => t.skip);
  hints.textContent = `${active.length} tips · ${skips.length} withheld · ${card.matchCount} fixture(s) · generated ${relTime(state.generatedAt)}${card.openerPoolExhausted ? ' · openers repeat across fixtures' : ''}`;

  warns.innerHTML = renderComplianceNote(card);
  out.innerHTML = card.tips.map((tip, i) => renderTip(tip, rows, i)).join('');
  wireTipButtons();
  renderRail();
}

function renderComplianceNote(card) {
  const withheld = card.withheld?.length
    ? `<p style="margin:6px 0 0"><strong>${card.withheld.length} market(s) withheld on a rule conflict</strong> — the writer could not satisfy every output rule for them, so nothing was printed: ${card.withheld.map((w) => `<code>${esc(w.match)} / ${esc(w.market)}</code>`).join(', ')}.</p>`
    : '';
  return `
    <div class="info-box">
      <strong>Output rules enforced by code, not requested of a model.</strong>
      Four markets per fixture in the mandated order (${MARKET_ORDER.map((m) => esc(MARKET_LABEL[m])).join(', ')}).
      Every written tip is at least forty words, carries its selection bolded inside the first twenty, states a confidence tier,
      contains no digit outside the mandated market label, names no price, date, source or social reference, and never speculates on availability.
      WIN MATCH names a county and no player; the three player markets name a player and no county, short name or Blast nickname.
      No two tips on the same fixture open alike, and none uses a banned filler phrase.
      ${withheld}
    </div>`;
}

/**
 * Small helpers rather than one deeply nested template: the validated-rate and
 * skip notes each need their own conditional, and inlining them pushed the tip
 * template four levels deep, which is hard to read and easy to unbalance.
 */
function validatedNote(validated) {
  if (!validated) return '';
  const interval = validated.wilson95
    ? ` (95% interval ${esc(String(validated.wilson95.low))} to ${esc(String(validated.wilson95.high))}`
    : '';
  return `<p class="meta-line">Validated: tips this model graded ${esc(String(validated.modelBand))} were correct `
    + `${esc(String(validated.observedHitRatePct))}% of the time across ${esc(String(validated.observedN))} fixtures `
    + `in the last completed season${interval}. Source: <code>data/t20_blast_backtest.json</code>.</p>`;
}

function skipNote(tip) {
  if (!tip.skip || tip.skipKind !== 'below_threshold') return '';
  return `<p class="meta-line">A candidate was sourced and scored; it simply did not clear this market's threshold. `
    + `That is a different thing from having no data at all.</p>`;
}

function tierNote(market) {
  if (!market?.modelBand || market.modelBand === market.band) return '';
  return `<span class="mini-pill" title="The model graded this ${esc(String(market.modelBand))}; the committed `
    + `backtest caps published confidence at ${esc(String(market.band))}.">model graded ${esc(String(market.modelBand))}</span>`;
}

function renderTip(tip, rows, idx) {
  const row = rows[Math.floor(idx / MARKET_ORDER.length)];
  const market = row?.result?.markets?.[tip.market];
  const words = tip.text.split(/\s+/).filter(Boolean).length;
  const bandClass = tip.skip ? 'SKIP' : tip.band;
  const groupIdx = Math.floor(idx / MARKET_ORDER.length);
  const analysisBtn = row ? `<button class="btn secondary-btn" data-analysis-idx="${groupIdx}">Analysis</button>` : '';
  const analysisPanel = row ? renderAnalysis(row) : '';
  return `
    <div class="tip ${tip.skip ? 'skip' : ''}">
      <div class="tip-head">
        <span class="tip-title">${esc(tip.matchLabel)} · <span style="color:var(--accent-primary)">${esc(tip.marketLabel)}</span></span>
        <div class="tip-acts">
          <span class="badge ${bandClass}">${esc(bandClass)}</span>
          ${tierNote(market)}
          ${tip.skip ? '' : `<span class="words">${words} words</span>`}
          <button class="btn secondary-btn" data-copy-idx="${idx}">📋 Copy</button>
          ${analysisBtn}
        </div>
      </div>
      <p>${renderProse(tip.text)}</p>
      ${validatedNote(market?.validated)}
      ${skipNote(tip)}
      <div class="analysis" id="analysis-${groupIdx}" style="display:none">${analysisPanel}</div>
    </div>`;
}

/** Bold the selection for display; the copy-paste block stays plain text. */
function renderProse(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderAnalysis({ match, result }) {
  if (result?.error) return `<div class="card-body meta-line">Scoring failed for this fixture: ${esc(result.error)}</div>`;
  const wm = result.markets?.win_match || {};
  const compRows = (list) => (list || []).map((c) => `
    <tr>
      <td>${esc(c.label || c.id)}</td>
      <td style="text-align:right">${c.missing ? '<span class="badge SKIP">not sourced</span>' : `${esc(String(c.points))} / ${esc(String(c.max))}`}</td>
      <td class="meta-line">${esc(c.detail || '')}${c.proxy ? ' <em>(proxy)</em>' : ''}</td>
    </tr>`).join('');
  return `
    <div class="card-body">
      <p class="meta-line"><strong>Evidence score</strong> ${esc(String(wm.score ?? '?'))} for ${esc(String(wm.selection ?? '?'))} against ${esc(String(wm.opposition_score ?? '?'))} · <strong>model probability</strong> ${wm.probability ?? 'n/a'} · <strong>strict rubric as written</strong> ${esc(String(wm.strict_prompt?.band ?? 'SKIP'))}${wm.strict_prompt?.score != null ? ` (${esc(String(wm.strict_prompt.score))}/100)` : ''}</p>
      <table><thead><tr><th>Factor (selected side)</th><th>Points</th><th>Detail</th></tr></thead><tbody>${compRows(wm.components)}</tbody></table>
      <table><thead><tr><th>Factor (opposition)</th><th>Points</th><th>Detail</th></tr></thead><tbody>${compRows(wm.opposition_components)}</tbody></table>
      ${result.caps?.length ? `<p class="meta-line"><strong>Caps applied:</strong> ${result.caps.map((c) => `<code>${esc(c)}</code>`).join(', ')}</p>` : ''}
      ${result.flags?.length ? `<ul class="meta-line">${result.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${result.missing?.length ? `<p class="meta-line"><strong>Could not be sourced (never guessed):</strong></p><ul class="meta-line">${result.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      ${match.result_text ? `<p class="meta-line"><strong>Actual result:</strong> ${esc(match.result_text)}${match.score ? ` — ${esc(match.score.home || '')} v ${esc(match.score.away || '')}` : ''}${match.dl_method ? ' (revised target)' : ''}</p>` : ''}
      <p class="meta-line"><strong>Check every figure by hand:</strong> ${(result.review_urls || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace('https://www.espncricinfo.com/', ''))}</a>`).join('<br>')}</p>
    </div>`;
}

function wireTipButtons() {
  $$('#pred-out [data-copy-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tip = state.card?.tips?.[Number(btn.dataset.copyIdx)];
      if (!tip) return;
      await copyText(tip.text.replace(/\*\*/g, ''));
      toast('Tip copied');
    });
  });
  $$('#pred-out [data-analysis-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = $(`#analysis-${btn.dataset.analysisIdx}`);
      if (!panel) return;
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      btn.textContent = open ? 'Analysis' : 'Hide analysis';
    });
  });
}

/* ------------------------------------------------------------------ render */

function renderAll() {
  renderDay();
  renderBoard();
  renderDatestrip();
  renderCalendar();
  renderStandings();
  renderGate();
  renderBacktest();
  renderCoverage();
  renderLeaders();
  renderIrregularities();
  renderSources();
  renderRail();
}

function renderDay() {
  const all = fixturesFor(state.date);
  const shown = visibleFixtures(state.date);
  $('#day-title').textContent = fmtDateLong(state.date);
  $('#counts').textContent = `${shown.length} of ${all.length} fixture(s) shown · ${state.byDate.size} dates in the tape`;
  $('#date-input').value = state.date;
  $('#cal-title').textContent = state.calMonth.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (state.movedFromDate) {
    $('#progress-label').innerHTML = `No fixtures on ${esc(fmtDateLong(state.movedFromDate))} — this is a completed season, so the board opened on the nearest date that has one. Use the calendar to pick any day.`;
  }
}

function renderBoard() {
  const rows = visibleFixtures(state.date);
  const board = $('#board');
  if (!rows.length) {
    board.innerHTML = `<div class="empty">Nothing to show for these filters on ${esc(fmtDateLong(state.date))}.</div>`;
    return;
  }
  board.innerHTML = rows.map(({ match, result }, i) => {
    const wm = result.markets?.win_match || {};
    const decided = !!match.winner_slug;
    const bandClass = wm.band === BAND.SKIP ? 'SKIP' : wm.band;
    const tip = state.card?.tips?.[i * MARKET_ORDER.length];
    return `
      <div class="match">
        <div class="match-head">
          <span class="meta-line">${esc(match.group || match.stage)}${match.neutral ? ' · neutral venue' : ''}</span>
          <span class="sp"></span>
          <span class="badge ${bandClass}">${esc(bandClass)}</span>
          ${wm.modelBand && wm.modelBand !== wm.band ? `<span class="mini-pill" title="capped by the committed backtest">model ${esc(wm.modelBand)}</span>` : ''}
        </div>
        <div class="match-rows">
          <div class="team ${wm.selection === match.home ? 'pred' : ''}">
            <strong>${esc(match.home)}</strong>
            ${formPips(formOf(match.home_slug, match.date))}
            ${decided && match.winner_slug === match.home_slug ? '<span class="badge WIN">won</span>' : ''}
          </div>
          <div class="team ${wm.selection === match.away ? 'pred' : ''}">
            <strong>${esc(match.away)}</strong>
            ${formPips(formOf(match.away_slug, match.date))}
            ${decided && match.winner_slug === match.away_slug ? '<span class="badge WIN">won</span>' : ''}
          </div>
        </div>
        <div class="match-foot meta-line">
          ${match.venue ? esc(match.venue) : 'venue not captured'}
          ${match.score ? ` · ${esc(match.score.home || '?')} v ${esc(match.score.away || '?')}` : ''}
          ${match.result_text ? ` · ${esc(match.result_text)}` : ''}
          ${wm.probability != null ? ` · model probability ${esc(String(wm.probability))}` : ''}
          ${typeof wm.score === 'number' ? ` · evidence ${esc(String(wm.score))}/100` : ''}
        </div>
        ${tip && !tip.skip ? `<div class="match-tip">${renderProse(tip.text)}</div>` : ''}
        ${decided ? `<div class="match-foot meta-line"><strong>Settled:</strong> ${wm.band === BAND.SKIP ? 'withheld before the match' : wm.selection === match.winner ? 'the model named the winner' : `the model named ${esc(String(wm.selection))}; ${esc(match.winner)} won`}</div>` : ''}
      </div>`;
  }).join('');
}

function formOf(slug, dateISO) {
  const rows = (state.docs?.matches?.matches || []).filter((m) => m.date < dateISO && (m.home_slug === slug || m.away_slug === slug) && m.winner_slug)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  return rows.map((m) => (m.winner_slug === slug ? 'W' : 'L'));
}

function renderDatestrip() {
  const dates = [...state.byDate.keys()].sort();
  if (!dates.length) { $('#datestrip').innerHTML = ''; return; }
  const idx = dates.indexOf(state.date);
  const from = Math.max(0, (idx === -1 ? 0 : idx) - 5);
  $('#datestrip').innerHTML = dates.slice(from, from + 12).map((d) => `
    <button class="btn sm ${d === state.date ? 'primary' : ''}" data-date="${esc(d)}">
      ${esc(d.slice(5))}<span class="meta-line"> ${fixturesFor(d).length}</span>
    </button>`).join('');
  $$('#datestrip [data-date]').forEach((b) => b.addEventListener('click', () => goDate(b.dataset.date)));
}

function renderCalendar() {
  const grid = $('#calgrid');
  const y = state.calMonth.getUTCFullYear();
  const m = state.calMonth.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push('<span class="calcell pad"></span>');
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = fixturesFor(iso).length;
    cells.push(`<button class="calcell ${n ? 'has' : ''} ${iso === state.date ? 'on' : ''}" data-date="${iso}" ${n ? '' : 'disabled'}>
      <b>${d}</b>${n ? `<i>${n}</i>` : ''}</button>`);
  }
  grid.innerHTML = cells.join('');
  $$('#calgrid [data-date]').forEach((c) => c.addEventListener('click', () => goDate(c.dataset.date)));
}

function renderStandings() {
  const groups = state.docs?.standings?.groups || {};
  const names = Object.keys(groups);
  $('#standings-asof').textContent = state.docs?.standings?.generated_at_utc
    ? `verified ${relTime(state.docs.standings.generated_at_utc)}` : '';
  if (!names.length) { $('#standings').innerHTML = '<div class="empty">No standings document.</div>'; return; }
  $('#standings').innerHTML = names.map((g) => `
    <h3 style="margin:10px 0 4px">${esc(g)}</h3>
    <table>
      <thead><tr><th>#</th><th>County</th><th>M</th><th>W</th><th>L</th><th>T</th><th>Pts</th><th>NRR</th><th></th></tr></thead>
      <tbody>${(groups[g] || []).map((r) => `
        <tr>
          <td>${esc(String(r.position))}</td>
          <td><strong>${esc(r.team)}</strong>${r.points_deduction ? ` <span class="mini-pill" title="A verified points deduction is applied. Its table position is read as adjusted performance and is never mentioned in a tip.">−${esc(String(r.points_deduction))} pts</span>` : ''}</td>
          <td>${esc(String(r.played))}</td><td>${esc(String(r.won))}</td><td>${esc(String(r.lost))}</td><td>${esc(String(r.tied))}</td>
          <td><strong>${esc(String(r.points))}</strong></td>
          <td>${esc(String(r.nrr_published))}</td>
          <td class="meta-line">${esc(r.qualified_for || '')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${(() => {
      const captured = (groups[g] || []).reduce((s, r) => s + (r.captured_in_group || 0), 0);
      const uncaptured = (groups[g] || []).reduce((s, r) => s + (r.uncaptured_results || 0), 0);
      return `<p class="meta-line">${captured} in-group results captured for this group; ${uncaptured} are counted in the published table but not itemised in the tape (cross-pool fixtures). NRR was recomputed from the published runs-for and runs-against and matched.</p>`;
    })()}`).join('');
}

function renderGate() {
  const el = $('#gate-panel');
  const bt = state.docs?.backtest;
  if (!bt || !state.gate) {
    el.innerHTML = `<div class="empty">No committed backtest was found, so no historical hit rate can be quoted and no confidence cap has been applied. Every tier on this page is <strong>unvalidated</strong>.</div>`;
    $('#gate-asof').textContent = '';
    return;
  }
  const e = bt.evidence_path;
  const gate = state.gate;
  $('#gate-asof').textContent = `replayed ${bt.coverage?.scored_by_model ?? '?'} fixtures from the ${esc(String(bt.season))} season · model ${esc(bt.evidence_model)}`;
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><b>${esc(String(e.overall.hitRate))}%</b><span>hit rate over ${esc(String(e.overall.n))} scored fixtures</span></div>
      <div class="stat"><b>${esc(String(e.baselines.always_home.hitRate))}%</b><span>always backing the home county</span></div>
      <div class="stat"><b>${esc(String(e.byBand?.HIGH?.hitRate ?? '—'))}%</b><span>tips the model graded HIGH (n=${esc(String(e.byBand?.HIGH?.n ?? 0))})</span></div>
      <div class="stat"><b>${esc(String(e.byBand?.MEDIUM?.hitRate ?? '—'))}%</b><span>tips the model graded MEDIUM (n=${esc(String(e.byBand?.MEDIUM?.n ?? 0))})</span></div>
      <div class="stat"><b>${esc(String(gate.cap ?? 'none'))}</b><span>published confidence cap</span></div>
      <div class="stat"><b>+${esc(String(e.overall.overconfidence ?? '—'))}</b><span>overconfidence: claimed minus delivered</span></div>
    </div>
    <p style="margin:10px 0 0"><strong>The model has no demonstrated edge over home advantage on the validated sample.</strong> It hit ${esc(String(e.overall.hitRate))}% where simply backing the home county returned ${esc(String(e.baselines.always_home.hitRate))}%, and its HIGH tier landed ${esc(String(e.byBand?.HIGH?.hitRate ?? '—'))}% over ${esc(String(e.byBand?.HIGH?.n ?? 0))} fixtures — a 95% interval of ${esc(String(e.intervals?.byBand?.HIGH?.ci95?.low ?? '?'))} to ${esc(String(e.intervals?.byBand?.HIGH?.ci95?.high ?? '?'))}, too thin to support the claim either way. Published confidence is therefore capped at ${esc(String(gate.cap))}, and each tip shows the observed rate for the tier the model actually chose.</p>
    <p class="meta-line" style="margin:8px 0 0">Gate rules triggered: ${(gate.triggered || []).map((t) => `<code>${esc(typeof t === 'string' ? t : t.id)}</code>`).join(', ') || 'none'}. The weights were declared before the replay and were never fitted to it — see <code>scripts/backtest_t20_blast.mjs</code> and <code>docs/T20_BLAST_BACKTEST.md</code>.</p>`;
}

function renderBacktest() {
  const bt = state.docs?.backtest;
  if (!bt) { $('#backtest').textContent = 'No committed backtest.'; return; }
  const e = bt.evidence_path;
  $('#backtest').innerHTML = `
    <p>${esc(String(e.overall.n))} fixtures scored walk-forward · hit rate <strong>${esc(String(e.overall.hitRate))}%</strong> · Brier ${esc(String(e.overall.brier))} · log loss ${esc(String(e.overall.logLoss))}</p>
    <p>Home picks ${esc(String(e.byPickSide?.home?.hits ?? '?'))}/${esc(String(e.byPickSide?.home?.n ?? '?'))} · away picks ${esc(String(e.byPickSide?.away?.hits ?? '?'))}/${esc(String(e.byPickSide?.away?.n ?? '?'))}</p>
    <p>Withheld ${esc(String(bt.coverage?.withheld_by_model ?? '?'))} of ${esc(String(bt.coverage?.decided ?? '?'))} decided fixtures (${esc(String(bt.coverage?.withhold_rate_pct ?? '?'))}%)</p>
    <p>Look-ahead audit: <strong>${bt.method?.lookAheadAudit?.ok ? 'PASS' : 'FAIL'}</strong> over ${esc(String(bt.method?.lookAheadAudit?.checked ?? '?'))} fixtures</p>
    <p>Rubric exactly as the master prompt writes it: SKIP on ${esc(String(bt.strict_prompt_path?.skip_rate_pct ?? '?'))}% of fixtures, because three of its five WIN factors have no free key-less source.</p>`;
}

function renderCoverage() {
  const m = state.docs?.matches;
  if (!m) { $('#coverage').textContent = 'No committed tape.'; return; }
  const c = m.counts || {};
  $('#coverage').innerHTML = `
    <p><strong>${esc(String(c.captured ?? m.matches.length))}</strong> of ${esc(String(c.season_total ?? 115))} season fixtures captured.</p>
    <p>In-group ${esc(String(c.in_group_captured ?? '?'))}/${esc(String(c.in_group_total ?? 90))} · cross-pool ${esc(String(c.cross_pool_captured ?? '?'))}/${esc(String(c.cross_pool_total ?? 18))} · knockouts ${esc(String(c.knockout_total ?? 7))}/${esc(String(c.knockout_total ?? 7))}</p>
    <p class="meta-line">Cross-pool results are not itemised by the ESPNcricinfo group tables this tape was read from. Nine cross-pool event ids were verified separately and are recorded in the provenance document so the collector can resolve them; none is guessed.</p>
    ${(m.gaps || []).map((g) => `<p class="meta-line"><strong>Gap:</strong> ${esc(g.stage)} ${esc(g.home || '?')} v ${esc(g.away || '?')} — ${esc(g.reason)}</p>`).join('')}
    ${state.loadProblems?.length ? state.loadProblems.map((p) => `<p class="meta-line"><strong>Document failed to load:</strong> ${esc(p)}</p>`).join('') : ''}`;
}

function renderLeaders() {
  const l = state.docs?.leaders;
  if (!l) { $('#leaders').textContent = 'No leaders document.'; return; }
  const list = (arr, fmt) => (arr || []).slice(0, 5).map((x, i) => `<p>${i + 1}. ${fmt(x)}</p>`).join('');
  $('#leaders').innerHTML = `
    ${l.most_runs?.length ? `<p class="meta-line"><strong>Most runs</strong></p>${list(l.most_runs, (x) => `${esc(x.player)} (${esc(x.team)}) — ${esc(String(x.runs))}`)}` : ''}
    ${l.most_wickets?.length ? `<p class="meta-line"><strong>Most wickets</strong></p>${list(l.most_wickets, (x) => `${esc(x.player)} (${esc(x.team)}) — ${esc(String(x.wickets))}`)}` : ''}
    ${l.knockout_performances?.length ? `<p class="meta-line"><strong>Knockout performances</strong></p>${list(l.knockout_performances, (x) => `${esc(x.player)} (${esc(x.team)}) — ${esc(x.detail)}, ${esc(x.stage)}`)}` : ''}
    <p class="meta-line">Only figures a source printed. There is no per-match player tape in this pass, which is why the three player markets are withheld across the historical tape.</p>`;
}

function renderIrregularities() {
  const p = state.docs?.provenance;
  const ids = p?.irregularity_ids || [];
  $('#irregularities').innerHTML = ids.length
    ? `<p>${ids.length} irregularities logged against this competition: ${ids.map((i) => `<code>${esc(i)}</code>`).join(', ')}.</p>
       <p class="meta-line">Full register with sources and remediation: <code>docs/T20_BLAST_IRREGULARITIES.md</code>.</p>`
    : '<p>No irregularities register found.</p>';
}

function renderSources() {
  const comp = state.docs?.competition;
  const src = comp?.sources || state.docs?.provenance?.sources || {};
  const entries = Object.entries(src);
  $('#sources').innerHTML = entries.length
    ? entries.map(([k, v]) => `<p class="meta-line"><strong>${esc(k.replace(/_/g, ' '))}</strong><br><a href="${esc(typeof v === 'string' ? v : v.url)}" target="_blank" rel="noopener noreferrer">${esc(typeof v === 'string' ? v : v.url)}</a></p>`).join('')
    : '<p>No sources document.</p>';
}

function renderRail() {
  const card = state.card;
  const rail = $('#rail-preds');
  if (!card) { rail.innerHTML = '<div class="card-body meta-line">No card generated.</div>'; $('#rail-count').textContent = ''; return; }
  const byMatch = new Map();
  for (const t of card.tips) {
    if (!byMatch.has(t.matchLabel)) byMatch.set(t.matchLabel, []);
    byMatch.get(t.matchLabel).push(t);
  }
  rail.innerHTML = [...byMatch.entries()].map(([label, tips]) => `
    <div class="card-body" style="border-bottom:1px solid var(--line-2)">
      <strong>${esc(label)}</strong>
      ${tips.map((t) => `<div class="meta-line" style="margin-top:4px">${esc(t.marketLabel)}: ${t.skip
        ? '<span class="badge SKIP">withheld</span>'
        : `<strong>${esc(String(t.selection))}</strong> <span class="badge ${esc(t.band)}">${esc(t.band)}</span>`}</div>`).join('')}
    </div>`).join('');
  $('#rail-count').textContent = `${card.activeCount} written · ${card.skipCount} withheld · ${card.matchCount} fixture(s)${state.generatedAt ? ` · ${relTime(state.generatedAt)}` : ''}`;
}

/* ------------------------------------------------------------------ controls */

function goDate(iso) {
  if (!iso) return;
  state.date = iso;
  state.calMonth = new Date(`${iso}T12:00:00Z`);
  state.movedFromDate = null;
  setQS({ date: iso });
  renderAll();
  generate();
}

function nearestDateWithFixtures(iso) {
  const dates = [...state.byDate.keys()].sort();
  if (!dates.length) return null;
  let best = null;
  let bestGap = Infinity;
  for (const d of dates) {
    const gap = Math.abs(new Date(`${d}T12:00:00Z`) - new Date(`${iso}T12:00:00Z`));
    if (gap < bestGap) { bestGap = gap; best = d; }
  }
  return best;
}

function wireControls() {
  $('#prev-day').addEventListener('click', () => shiftDay(-1));
  $('#next-day').addEventListener('click', () => shiftDay(1));
  $('#today-btn').addEventListener('click', () => goDate(todayISO()));
  $('#date-input').addEventListener('change', (e) => goDate(e.target.value));
  $('#cal-prev').addEventListener('click', () => {
    state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() - 1, 1));
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    state.calMonth = new Date(Date.UTC(state.calMonth.getUTCFullYear(), state.calMonth.getUTCMonth() + 1, 1));
    renderCalendar();
  });
  $('#stage-filter').addEventListener('change', (e) => { state.stage = e.target.value; renderBoard(); generate(); });
  $('#status-filter').addEventListener('change', (e) => { state.status = e.target.value; renderBoard(); generate(); });
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); generate(); });
  $('#generate').addEventListener('click', () => { generate(); toast('Predictions generated for this slate'); });
  $('#copy-all').addEventListener('click', async () => {
    const tips = state.card?.tips?.filter((t) => !t.skip) || [];
    if (!tips.length) { toast('No written tips on this slate to copy'); return; }
    await copyText(tips.map((t) => `${t.matchLabel} — ${t.marketLabel}: ${t.text.replace(/\*\*/g, '')}`).join('\n\n'));
    toast(`${tips.length} tips copied`);
  });
  $('#copy-card').addEventListener('click', async () => {
    if (!state.cardText) { toast('Generate predictions first'); return; }
    await copyText(state.cardText);
    toast('Card copied');
  });
}

function shiftDay(delta) {
  const next = addDays(state.date, delta);
  goDate(next);
}

boot();
