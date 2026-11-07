import './style.css';
import type { Attempt, Question, Result, SkillId, State } from './types';
import { SKILLS, SKILL_IDS, maxLevel, skillMeta } from './engine/skills';
import { derivedRates, fmt, short } from './engine/generate';
import {
  accuracy, applyAutoStepDown, day, daysBetween, mark, mastery, median, plan, stepUpCandidate, streak, updateReviews, weakest, addDays,
} from './engine/logic';
import { DEFAULT_SETTINGS, freshState, load, logChange, save, toCSV } from './store';

let state: State = load();
const app = document.getElementById('app')!;

/* ---------------- helpers ---------------- */
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const persist = () => save(state);
const go = (hash: string) => { if (location.hash === '#' + hash) render(); else location.hash = hash; };
const rateAge = () => daysBetween(state.rates.setAt, day());
const pctTxt = (n: number | null) => (n === null ? '–' : `${n}%`);

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

const tabbar = (active: string) => `
  <nav class="tabbar" aria-label="Main">
    ${[['home', 'Today'], ['progress', 'Progress'], ['settings', 'Settings']].map(([h, l]) =>
      `<a href="#${h}" class="tab ${active === h ? 'on' : ''}" ${active === h ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
  </nav>`;

const ring = (pct: number | null, accent: boolean) => {
  const c = 2 * Math.PI * 19, off = c * (1 - (pct ?? 0) / 100);
  return `<svg width="50" height="50" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="19" class="ring-bg"/>
    <circle cx="25" cy="25" r="19" class="ring-fg ${accent ? 'accent' : ''}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 25 25)"/></svg>`;
};

const seg = (name: string, value: string, opts: [string, string][]) => `
  <div class="seg" role="radiogroup">${opts.map(([v, l]) =>
    `<button type="button" role="radio" aria-checked="${v === value}" class="${v === value ? 'on' : ''}" data-set="${name}" data-val="${v}">${l}</button>`).join('')}</div>`;

const toggle = (name: string, on: boolean, label: string) => `
  <label class="row"><span>${label}</span><input type="checkbox" class="toggle" data-toggle="${name}" ${on ? 'checked' : ''}></label>`;

/* ---------------- home ---------------- */
function home() {
  const st = streak(state), weak = weakest(state);
  const todayDone = state.sessions.filter(s => day(new Date(s.startedAt)) === day()).length;
  const d = derivedRates(state.rates, state.settings.roundRates);
  const age = rateAge();
  const due = state.reviews.filter(r => r.due <= day()).length;
  return `
  <main class="screen">
    <header class="top"><h1>Today</h1><span class="muted">${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span></header>
    <section class="tile streak">
      <div><span class="label">Streak</span><b>${st.count}</b> <span class="muted">day${st.count === 1 ? '' : 's'}</span></div>
      <div class="dots" aria-label="This week">${st.week.map((on, i) => `<i class="${on ? 'on' : ''}" title="${'MTWTFSS'[i]}"></i>`).join('')}</div>
    </section>
    <section class="tile">
      <span class="label">Mastery at your level</span>
      <div class="rings">${SKILLS.map(s => {
        const m = mastery(state.attempts, s.id, state.skills[s.id].level); const paused = state.skills[s.id].status === 'pause';
        return `<a href="#settings-difficulty" class="ringcell ${paused ? 'paused' : ''}">${ring(m, s.id === weak)}<span>${s.name}</span><small>${paused ? 'paused' : 'Lv ' + state.skills[s.id].level}</small></a>`;
      }).join('')}</div>
    </section>
    <a class="tile" href="#settings-rates">
      <span class="label">Rates in use</span>
      <span>£1 = $${fmt(state.rates.gbpUsd, 4)} · €1 = £${fmt(state.rates.eurGbp, 4)} · €1 = $${fmt(d.eurUsd, 4)}</span>
      <span class="${age >= state.settings.rateReminderDays ? 'accent' : 'muted'}">£1 = ${short(state.rates.gbpToman)} Toman · set ${age === 0 ? 'today' : age + ' day' + (age === 1 ? '' : 's') + ' ago'}${age >= state.settings.rateReminderDays ? ' · tap to refresh' : ''}</span>
    </a>
    ${due ? `<p class="muted small center">${due} question${due === 1 ? '' : 's'} from earlier misses ${due === 1 ? 'is' : 'are'} due today</p>` : ''}
    <button class="cta" data-action="start">${todayDone ? 'Another' : "Start today's"} ${state.settings.sessionLength} <small>~${Math.max(2, Math.round(state.settings.sessionLength * 0.6))} min</small></button>
  </main>${tabbar('home')}`;
}

/* ---------------- session ---------------- */
interface Run {
  id: string; startedAt: string; qs: Question[]; i: number; raw: string; tries: number; qStart: number;
  results: { q: Question; result: Result; tries: number; ms: number }[];
  phase: 'ask' | 'right' | 'retry' | 'reveal'; lastResult?: Result; hint: boolean; confirmQuit: boolean; timer?: number;
}
let run: Run | null = null;
let lastRun: { run: Run; offer: SkillId | null; steppedDown: SkillId[] } | null = null;

function startSession() {
  run = { id: uid(), startedAt: new Date().toISOString(), qs: plan(state), i: 0, raw: '', tries: 1, qStart: performance.now(),
    results: [], phase: 'ask', hint: false, confirmQuit: false };
  go('session');
}

const keypadKeys = () => (state.settings.keypad === 'phone'
  ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']
  : ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫']);

const displayRaw = (raw: string) => {
  if (!raw) return '';
  const [i, d] = raw.split('.');
  const ii = i ? Number(i).toLocaleString('en-GB') : '0';
  return d !== undefined ? `${ii}.${d}` : ii;
};

function sessionView() {
  if (!run) return home();
  const q = run.qs[run.i]; const s = state.settings; const meta = q.kind === 'two-step' ? { name: 'Two-step' } : skillMeta(q.skill);
  const progress = ((run.i + (run.phase === 'right' || run.phase === 'reveal' ? 1 : 0)) / run.qs.length) * 100;
  let fb = '';
  if (run.phase === 'right') {
    fb = `<p class="fb ok">Correct.</p>`;
    if (run.lastResult === 'close' && s.showExactOnClose) fb += `<p class="fb-sub">Exact: ${fmt(q.answer)}</p>`;
    else if (!s.minimalFeedback) fb += `<p class="fb-sub">${esc(q.hint)}</p>`;
  } else if (run.phase === 'retry') fb = `<p class="fb no">Not quite. Try again.</p>`;
  else if (run.phase === 'reveal') fb = `<p class="fb no">Answer: ${fmt(q.answer)}</p>`;
  return `
  <main class="screen session">
    <header class="sess-top">
      <button class="icon-btn" data-action="quit" aria-label="End session">✕</button>
      <div class="prog" role="progressbar" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><b style="width:${progress}%"></b></div>
      <span class="timer" id="timer">${s.showTimer ? '0s' : ''}</span>
    </header>
    ${run.confirmQuit ? `<div class="sheet"><p><b>End this session?</b></p><p class="muted small">Answers so far are saved.</p>
      <div class="btns"><button data-action="quit-no">Keep going</button><button class="p" data-action="quit-yes">End session</button></div></div>` : ''}
    <span class="chip">${meta.name}${q.review ? ' · review' : ''}</span>
    <div class="q" aria-live="polite">${esc(q.prompt)}</div>
    <div class="answer ${run.phase === 'retry' ? 'shake' : ''} ${run.phase === 'right' ? 'good' : ''}" id="answer"><span id="raw">${displayRaw(run.raw)}</span><i class="caret"></i>${q.unit ? `<small>${esc(q.unit)}</small>` : ''}</div>
    <div class="fbwrap">${fb}${run.hint && run.phase !== 'right' ? `<p class="hint">${esc(q.hint)}</p>` : ''}</div>
    ${run.phase === 'reveal'
      ? `<div class="reveal"><p class="hint">${esc(q.hint)}</p><button class="cta" data-action="next">Next</button></div>`
      : `<div class="pad">${keypadKeys().map(k => `<button type="button" data-key="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>`).join('')}
        <button type="button" class="ghost" data-action="explain">Explain</button><button type="button" class="go" data-action="enter">Enter</button></div>`}
  </main>`;
}

function updateRaw() { const el = document.getElementById('raw'); if (el && run) el.textContent = displayRaw(run.raw); }

function keyPress(k: string) {
  if (!run || run.phase === 'right' || run.phase === 'reveal') return;
  if (run.phase === 'retry') { run.phase = 'ask'; document.getElementById('answer')?.classList.remove('shake'); const f = document.querySelector('.fbwrap .fb'); f?.remove(); }
  if (k === '⌫') run.raw = run.raw.slice(0, -1);
  else if (k === '.') { if (!run.raw.includes('.')) run.raw = (run.raw || '0') + '.'; }
  else if (run.raw.replace('.', '').length < 12) run.raw = run.raw === '0' ? k : run.raw + k;
  updateRaw();
}

function recordAttempt(q: Question, given: number | null, result: Result, tries: number, ms: number) {
  const a: Attempt = { id: uid(), sessionId: run!.id, skill: q.skill, level: q.level, kind: q.kind, prompt: q.prompt,
    answer: q.answer, given, result, tries, ms: Math.round(ms), at: new Date().toISOString(), review: !!q.review };
  state.attempts.push(a);
  if (q.level > 0) updateReviews(state, q, result, tries);
  run!.results.push({ q, result, tries, ms });
  persist();
}

function enter() {
  if (!run || run.phase === 'right' || run.phase === 'reveal' || !run.raw) return;
  const q = run.qs[run.i]; const given = parseFloat(run.raw);
  const tol = q.kind === 'two-step' ? Math.max(state.settings.tolerance.fx, 2) : state.settings.tolerance[q.skill];
  const result = mark(q, given, tol);
  const ms = performance.now() - run.qStart;
  if (result !== 'wrong') {
    recordAttempt(q, given, result, run.tries, ms);
    run.phase = 'right'; run.lastResult = result; render();
    const wait = result === 'close' && state.settings.showExactOnClose ? 1500 : state.settings.minimalFeedback ? 650 : 2200;
    setTimeout(next, wait);
  } else if (run.tries <= state.settings.retries) {
    run.tries++; run.raw = ''; run.phase = 'retry'; render();
  } else {
    recordAttempt(q, given, 'wrong', run.tries, ms);
    run.phase = 'reveal'; render();
  }
}

function next() {
  if (!run || (run.phase !== 'right' && run.phase !== 'reveal')) return;
  run.i++; run.raw = ''; run.tries = 1; run.hint = false; run.phase = 'ask'; run.qStart = performance.now();
  if (run.i >= run.qs.length) finish(); else render();
}

function finish() {
  if (!run) return;
  const r = run; clearInterval(r.timer);
  if (r.results.length) {
    state.sessions.push({ id: r.id, startedAt: r.startedAt, endedAt: new Date().toISOString(), total: r.results.length,
      correct: r.results.filter(x => x.result !== 'wrong').length, firstTry: r.results.filter(x => x.result !== 'wrong' && x.tries === 1).length,
      ms: Math.round(r.results.reduce((t, x) => t + x.ms, 0)) });
  }
  const steppedDown = applyAutoStepDown(state);
  persist();
  lastRun = r.results.length ? { run: r, offer: stepUpCandidate(state), steppedDown } : null;
  run = null;
  go(lastRun ? 'done' : 'home');
}

/* ---------------- done ---------------- */
function doneView() {
  if (!lastRun) return home();
  const { run: r, offer, steppedDown } = lastRun;
  const total = r.results.length, correct = r.results.filter(x => x.result !== 'wrong').length;
  const first = r.results.filter(x => x.result !== 'wrong' && x.tries === 1).length;
  const secs = Math.round(r.results.reduce((t, x) => t + x.ms, 0) / 1000);
  const bySkill = SKILL_IDS.map(id => ({ id, xs: r.results.filter(x => x.q.skill === id && x.q.kind !== 'two-step') })).filter(x => x.xs.length);
  const two = r.results.filter(x => x.q.kind === 'two-step');
  const missed = r.results.filter(x => x.result === 'wrong' || x.tries > 1).length;
  return `
  <main class="screen">
    <header class="top"><h1>Done</h1><span class="muted">${Math.floor(secs / 60)}m ${secs % 60}s</span></header>
    <section class="tile big-score"><b>${correct}/${total}</b><span class="muted">${first} on the first try</span></section>
    <section class="tile">
      ${bySkill.map(({ id, xs }) => `<div class="row"><span>${skillMeta(id).name}</span><span class="v">${xs.filter(x => x.result !== 'wrong').length}/${xs.length}</span></div>`).join('')}
      ${two.length ? `<div class="row"><span>Two-step</span><span class="v">${two.filter(x => x.result !== 'wrong').length}/${two.length}</span></div>` : ''}
    </section>
    ${missed ? `<p class="muted small center">${missed} question${missed === 1 ? '' : 's'} will come back as review over the next week.</p>` : ''}
    ${steppedDown.length ? `<p class="muted small center">Auto step-down: ${steppedDown.map(id => skillMeta(id).name).join(', ')} moved down a level.</p>` : ''}
    ${offer ? `<section class="sheet">
      <span class="label">Ready for more?</span>
      <p><b>You've hit ${state.settings.stepUpPct}%+ on ${skillMeta(offer).name.toLowerCase()} ${state.settings.stepUpSessions} sessions running.</b></p>
      <p class="muted small">Next level: ${skillMeta(offer).levels[state.skills[offer].level]}. You can always step back down in Settings.</p>
      <div class="btns"><button data-action="decline" data-skill="${offer}">Not yet</button><button class="p" data-action="stepup" data-skill="${offer}">Step up</button></div>
    </section>` : ''}
    <a class="cta" href="#home">Back to Today</a>
  </main>`;
}

/* ---------------- progress ---------------- */
function lineChart() {
  const ss = state.sessions.slice(-30);
  if (ss.length < 2) return `<p class="muted small">The trend appears after your second session.</p>`;
  const W = 320, H = 150, L = 30, R = 10, T = 18, B = 22;
  const x = (i: number) => L + (i * (W - L - R)) / (ss.length - 1);
  const y = (p: number) => T + ((100 - p) * (H - T - B)) / 100;
  const pts = ss.map((s, i) => [x(i), y(Math.round((100 * s.firstTry) / s.total))]);
  const line = pts.map(p => p.join(',')).join(' ');
  const area = `M${pts[0][0]},${H - B} L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0]},${H - B} Z`;
  const first = ss[0].startedAt;
  const marks = state.changes.filter(c => c.at >= first && c.what !== 'setting').slice(-6).map(c => {
    const idx = ss.findIndex(s => s.startedAt >= c.at); if (idx <= 0) return '';
    const xm = (x(idx - 1) + x(idx)) / 2;
    return `<line x1="${xm}" x2="${xm}" y1="${T - 6}" y2="${H - B}" class="mk ${c.what}"/><text x="${xm + 3}" y="${T - 8}" class="mk-t ${c.what}">${c.what === 'rate' ? 'rate' : esc(c.label.split(' Lv')[0])}</text>`;
  }).join('');
  return `<div class="chartbox" id="trend"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="First-try accuracy over your last ${ss.length} sessions">
    ${[0, 50, 100].map(p => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="grid"/><text x="${L - 6}" y="${y(p) + 3}" text-anchor="end" class="ax">${p}%</text>`).join('')}
    <path d="${area}" class="area"/><polyline points="${line}" class="line"/>${marks}
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="4" class="end"/>
    ${pts.map((p, i) => `<rect x="${p[0] - 6}" y="${T}" width="12" height="${H - T - B}" class="hit" data-tip="${new Date(ss[i].startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${ss[i].firstTry}/${ss[i].total} first try"/>`).join('')}
  </svg><div class="tip" hidden></div></div>`;
}

function heatmap() {
  const counts = new Map<string, number>();
  for (const a of state.attempts) { const d = day(new Date(a.at)); counts.set(d, (counts.get(d) ?? 0) + 1); }
  const dow = (new Date().getDay() + 6) % 7; const start = addDays(day(), -dow - 28);
  const cells = Array.from({ length: 35 }, (_, i) => { const d = addDays(start, i); const n = counts.get(d) ?? 0;
    const lv = d > day() ? 'future' : n === 0 ? '' : n <= 5 ? 'l1' : n <= 10 ? 'l2' : 'l3';
    return `<i class="${lv}" title="${d}: ${n} answered"></i>`; }).join('');
  return `<div class="heat-head">${'MTWTFSS'.split('').map(c => `<span>${c}</span>`).join('')}</div><div class="heat">${cells}</div>`;
}

function errorPatterns() {
  const since = addDays(day(), -30);
  const recent = state.attempts.filter(a => a.at.slice(0, 10) >= since);
  const out: string[] = [];
  // multiplying instead of dividing on reverse conversions: given ≈ amount² / answer
  const rev = recent.filter(a => ['fx-usd-gbp', 'fx-gbp-eur', 'fx-usd-eur'].includes(a.kind) && a.result === 'wrong' && a.given);
  const flipped = rev.filter(a => { const p = parseFloat(a.prompt.replace(/[^0-9.]/g, '')); const wrongWay = (p * p) / a.answer;
    return Math.abs(a.given! - wrongWay) / wrongWay < 0.04; }).length;
  if (flipped) out.push(`Multiplied instead of divided on a conversion ${flipped} time${flipped === 1 ? '' : 's'}`);
  const zeros = recent.filter(a => a.result === 'wrong' && a.given && a.answer && [10, 0.1].some(f => Math.abs(a.given! / a.answer - f) < 0.02)).length;
  if (zeros) out.push(`Off by a zero ${zeros} time${zeros === 1 ? '' : 's'}`);
  const byKind = new Map<string, { n: number; w: number }>();
  for (const a of recent) { const k = byKind.get(a.kind) ?? { n: 0, w: 0 }; k.n++; if (a.result === 'wrong' || a.tries > 1) k.w++; byKind.set(a.kind, k); }
  const worst = [...byKind.entries()].filter(([, v]) => v.n >= 3 && v.w / v.n >= 0.3).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n).slice(0, 2);
  const KIND: Record<string, string> = { 'mul-2x2': '2-digit × 2-digit', 'mul-3x2': '3-digit × 2-digit', 'fx-usd-gbp': '$ → £', 'pct-change': '% change', 'pct-new': 'new value after %', 'pct-vat': 'before VAT', 'div-estimate': 'estimating division', 'toman-to-gbp': 'Toman → £' };
  for (const [k, v] of worst) out.push(`${KIND[k] ?? k}: ${Math.round((100 * v.w) / v.n)}% missed or retried`);
  return out;
}

function progressView() {
  const week = addDays(day(), -6);
  const wk = state.attempts.filter(a => day(new Date(a.at)) >= week);
  const st = streak(state);
  const patterns = errorPatterns();
  const weak = weakest(state);
  const changes = state.changes.slice(-8).reverse();
  return `
  <main class="screen">
    <header class="top"><h1>Progress</h1><span class="muted">${state.attempts.length} answered</span></header>
    <section class="stats">
      <div class="tile stat"><b>${pctTxt(accuracy(wk))}</b><span>first try, last 7 days</span></div>
      <div class="tile stat"><b>${st.count}</b><span>day streak</span></div>
    </section>
    <section class="tile"><span class="label">Practice calendar · 5 weeks</span>${heatmap()}</section>
    <section class="tile"><span class="label">First-try accuracy · level and rate changes marked</span>${lineChart()}</section>
    <section class="tile"><span class="label">By skill · current level</span>
      ${SKILLS.map(s => { const lv = state.skills[s.id].level; const xs = state.attempts.filter(a => a.skill === s.id && a.level === lv);
        const med = median(xs.slice(-30).filter(a => a.result !== 'wrong').map(a => a.ms)); const m = mastery(state.attempts, s.id, lv);
        return `<div class="skillrow"><div><b>${s.name}</b> <span class="muted small">Lv ${lv} · ${s.levels[lv - 1]}</span></div>
          <div class="bar"><i style="width:${m ?? 0}%" class="${s.id === weak && m !== null ? 'accent' : ''}"></i></div>
          <div class="v small">${pctTxt(m)}${med ? ` · ${(med / 1000).toFixed(1)}s` : ''}${s.id === weak && m !== null ? ' · weakest' : ''}</div></div>`; }).join('')}
    </section>
    <section class="tile"><span class="label">Patterns · last 30 days</span>
      ${patterns.length ? patterns.map(p => `<p class="small">${esc(p)}</p>`).join('') : `<p class="muted small">Nothing stands out yet.</p>`}
      <p class="muted small">${state.reviews.length} question pattern${state.reviews.length === 1 ? '' : 's'} in the review queue.</p>
    </section>
    <section class="tile"><span class="label">Recent changes</span>
      ${changes.length ? changes.map(c => `<div class="row"><span class="small">${esc(c.label)}</span><span class="v">${new Date(c.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${c.by}</span></div>`).join('') : `<p class="muted small">Level, rate and setting changes will show here.</p>`}
    </section>
  </main>${tabbar('progress')}`;
}

/* ---------------- settings ---------------- */
const back = `<a href="#settings" class="back">‹ Settings</a>`;
let confirm: string | null = null;

function settingsHome() {
  const s = state.settings;
  const link = (h: string, l: string, v: string) => `<a class="row" href="#${h}"><span>${l}</span><span class="v">${v} ›</span></a>`;
  return `<main class="screen"><header class="top"><h1>Settings</h1></header>
    <section class="group">${link('settings-difficulty', 'Difficulty', s.offerStepUps ? 'step-ups on' : 'manual')}${link('settings-rates', 'Exchange rates', rateAge() >= s.rateReminderDays ? `${rateAge()}d old` : 'up to date')}</section>
    <section class="group">${link('settings-session', 'Sessions', `${s.sessionLength} questions`)}${link('settings-marking', 'Marking and feedback', `±${s.tolerance.mul}%`)}</section>
    <section class="group">${link('settings-display', 'Display', s.theme === 'system' ? 'System' : s.theme === 'dark' ? 'Dark' : 'Light')}${link('settings-data', 'Your data', 'Export')}</section>
    <p class="muted small center">Mental Math · Phase 1 + 2</p>
  </main>${tabbar('settings')}`;
}

function difficultyView() {
  const s = state.settings;
  const lvChanges = state.changes.filter(c => c.what === 'level').slice(-10).reverse();
  return `<main class="screen">${back}<header class="top"><h1>Difficulty</h1></header>
    ${SKILLS.map(m => { const sk = state.skills[m.id]; return `
      <section class="group skillset">
        <div class="row"><span><b>${m.name}</b></span>
          <span class="stepper"><button data-action="lv" data-skill="${m.id}" data-d="-1" aria-label="Level down" ${sk.level <= 1 ? 'disabled' : ''}>−</button>
          <b>Lv ${sk.level}</b><button data-action="lv" data-skill="${m.id}" data-d="1" aria-label="Level up" ${sk.level >= maxLevel(m.id) ? 'disabled' : ''}>+</button></span></div>
        <p class="muted small">${m.levels[sk.level - 1]}${sk.level < maxLevel(m.id) ? ` · next: ${m.levels[sk.level]}` : ' · top level'}</p>
        ${seg(`status:${m.id}`, sk.status, [['practise', 'Practise'], ['review', 'Review only'], ['pause', 'Pause']])}
      </section>`; }).join('')}
    <section class="group">
      ${toggle('offerStepUps', s.offerStepUps, 'Offer step-ups')}
      <div class="row"><span>Step up after</span><span class="v">
        <select data-num="stepUpPct" aria-label="Accuracy">${[80, 85, 90, 95, 100].map(v => `<option value="${v}" ${v === s.stepUpPct ? 'selected' : ''}>${v}%</option>`).join('')}</select> ×
        <select data-num="stepUpSessions" aria-label="Sessions">${[3, 4, 5, 7].map(v => `<option value="${v}" ${v === s.stepUpSessions ? 'selected' : ''}>${v} sessions</option>`).join('')}</select></span></div>
      ${toggle('autoStepDown', s.autoStepDown, 'Auto step-down after two weak sessions')}
    </section>
    <section class="tile"><span class="label">Level history</span>
      ${lvChanges.length ? lvChanges.map(c => `<div class="row"><span class="small">${esc(c.label)}</span><span class="v">${new Date(c.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${c.by}</span></div>`).join('') : '<p class="muted small">No level changes yet. Starting levels came from the practice chat.</p>'}
    </section></main>`;
}

function ratesView() {
  const r = state.rates, s = state.settings, d = derivedRates(r, s.roundRates), age = rateAge();
  return `<main class="screen">${back}<header class="top"><h1>Rates</h1></header>
    <form class="group" id="rates-form">
      <label class="row"><span>£1 → $</span><input id="r-gbpUsd" inputmode="decimal" value="${r.gbpUsd}"></label>
      <label class="row"><span>€1 → £</span><input id="r-eurGbp" inputmode="decimal" value="${r.eurGbp}"></label>
      <label class="row"><span>£1 → Toman</span><input id="r-gbpToman" inputmode="numeric" value="${r.gbpToman}"></label>
      <button class="cta small-cta" type="submit">Save rates</button>
    </form>
    <p class="small center ${age >= s.rateReminderDays ? 'accent' : 'muted'}">Last set ${new Date(r.setAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} (${age === 0 ? 'today' : age + ' days ago'})</p>
    <section class="tile"><span class="label">Worked out from these</span>
      <div class="row"><span>€1 → $</span><span class="v">${fmt(d.eurUsd, 4)}</span></div>
      <div class="row"><span>£1 → €</span><span class="v">${fmt(d.gbpEur, 4)}</span></div>
      <div class="row"><span>$1 → Toman</span><span class="v">${fmt(d.usdToman, 0)}</span></div>
      <div class="row"><span>€1 → Toman</span><span class="v">${fmt(d.eurToman, 0)}</span></div>
    </section>
    <section class="group">
      ${toggle('roundRates', s.roundRates, 'Round worked-out rates')}
      <div class="row"><span>Toman answers in</span>${seg('tomanUnit', s.tomanUnit, [['thousand', 'Thousands'], ['full', 'Full']])}</div>
      <div class="row"><span>Remind me to refresh</span><select data-num="rateReminderDays">${[3, 7, 14, 30].map(v => `<option value="${v}" ${v === s.rateReminderDays ? 'selected' : ''}>every ${v} days</option>`).join('')}</select></div>
    </section>
    <section class="tile"><span class="label">Rate history</span>
      ${[...state.rateHistory].reverse().slice(0, 8).map(h => `<div class="row"><span class="small">$${h.gbpUsd} · €→£${h.eurGbp} · ${short(h.gbpToman)} T</span><span class="v">${new Date(h.setAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>`).join('')}
      <p class="muted small">Each answer is marked against the rate it was asked with, so changing rates never rewrites your history.</p>
    </section></main>`;
}

function sessionSettingsView() {
  const s = state.settings;
  return `<main class="screen">${back}<header class="top"><h1>Sessions</h1></header>
    <section class="group">
      <div class="col"><span>Questions per session</span>${seg('sessionLength', String(s.sessionLength), [['5', '5'], ['10', '10'], ['15', '15'], ['20', '20']])}</div>
      <div class="col"><span>Skill mix</span>${seg('mix', s.mix, [['focus', 'Weak-spot focus'], ['even', 'Even']])}</div>
      <div class="col"><span>Two-step questions</span>${seg('twoStep', s.twoStep, [['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often']])}</div>
      ${toggle('friendly', s.friendly, 'Friendly numbers only')}
    </section>
    <p class="muted small">Weak-spot focus: about 40% from your weakest skill, 20% review of earlier misses, the rest spread across your other skills. Pause or set skills to review only under Difficulty.</p>
  </main>`;
}

function markingView() {
  const s = state.settings;
  return `<main class="screen">${back}<header class="top"><h1>Marking</h1></header>
    <section class="group"><span class="label pad-top">Close-answer tolerance</span>
      ${SKILLS.map(m => `<div class="row"><span>${m.name}</span><select data-tol="${m.id}" aria-label="${m.name} tolerance">${[0, 1, 2, 3, 5].map(v => `<option value="${v}" ${v === s.tolerance[m.id] ? 'selected' : ''}>${v === 0 ? 'exact only' : '±' + v + '%'}</option>`).join('')}</select></div>`).join('')}
    </section>
    <section class="group">
      <div class="col"><span>Tries before the answer is shown</span>${seg('retries', String(s.retries), [['0', '1'], ['1', '2'], ['2', '3'], ['99', 'Unlimited']])}</div>
      ${toggle('minimalFeedback', s.minimalFeedback, 'Minimal feedback ("Correct." only)')}
      ${toggle('showExactOnClose', s.showExactOnClose, 'Show the exact figure after a close answer')}
      ${toggle('showTimer', s.showTimer, 'Show a timer')}
    </section></main>`;
}

function displayView() {
  const s = state.settings;
  return `<main class="screen">${back}<header class="top"><h1>Display</h1></header>
    <section class="group">
      <div class="col"><span>Theme</span>${seg('theme', s.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div class="col"><span>Keypad</span>${seg('keypad', s.keypad, [['phone', 'Phone (1 2 3 on top)'], ['calculator', 'Calculator (7 8 9)']])}</div>
    </section></main>`;
}

function dataView() {
  return `<main class="screen">${back}<header class="top"><h1>Your data</h1></header>
    <section class="tile">
      <div class="row"><span>Answers</span><span class="v">${state.attempts.length}</span></div>
      <div class="row"><span>Sessions</span><span class="v">${state.sessions.length}</span></div>
      <div class="row"><span>Review queue</span><span class="v">${state.reviews.length}</span></div>
    </section>
    <section class="group">
      <button class="row linkish" data-action="export">Export answers as CSV</button>
      <button class="row linkish" data-action="copy">Copy CSV to clipboard</button>
    </section>
    <p class="muted small">Everything is stored on this phone only. iPhone can clear a web app's data if it isn't opened for several weeks, so export now and then.</p>
    <section class="group">
      <div class="row"><span>Reset one skill</span><select id="reset-skill">${SKILLS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select></div>
      ${confirm === 'reset' ? `<div class="btns"><button data-action="cancel">Cancel</button><button class="p" data-action="reset-yes">Reset its history</button></div>`
        : `<button class="row linkish" data-action="reset">Reset this skill's history…</button>`}
      ${confirm === 'wipe' ? `<div class="btns"><button data-action="cancel">Cancel</button><button class="p" data-action="wipe-yes">Delete everything</button></div>`
        : `<button class="row linkish danger" data-action="wipe">Delete all data…</button>`}
    </section>
    <p id="toast" class="toast" role="status"></p></main>`;
}

/* ---------------- router ---------------- */
function render() {
  applyTheme();
  const h = location.hash.slice(1) || 'home';
  if (h !== 'session' && run) { clearInterval(run.timer); }
  const views: Record<string, () => string> = {
    home, session: sessionView, done: doneView, progress: progressView, settings: settingsHome,
    'settings-difficulty': difficultyView, 'settings-rates': ratesView, 'settings-session': sessionSettingsView,
    'settings-marking': markingView, 'settings-display': displayView, 'settings-data': dataView,
  };
  app.innerHTML = (views[h] ?? home)();
  app.dataset.view = h;
  if (h === 'session' && run && state.settings.showTimer) {
    clearInterval(run.timer);
    run.timer = window.setInterval(() => { const t = document.getElementById('timer'); if (t && run) t.textContent = Math.floor((performance.now() - run.qStart) / 1000) + 's'; }, 500);
  }
  if (h === 'session' && !run) go('home');
}

function toast(msg: string) { const t = document.getElementById('toast'); if (t) { t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2200); } }

function setSetting(name: string, val: string) {
  const s = state.settings as unknown as Record<string, unknown>;
  if (name.startsWith('status:')) {
    const id = name.split(':')[1] as SkillId; const from = state.skills[id].status;
    if (from === val) return;
    state.skills[id].status = val as State['skills'][SkillId]['status'];
    logChange(state, 'setting', `${skillMeta(id).name}: ${from} → ${val}`);
  } else {
    const before = s[name]; const num = ['sessionLength', 'retries'].includes(name);
    const v = num ? Number(val) : val; if (before === v) return;
    s[name] = v; logChange(state, 'setting', `${name} ${before} → ${v}`);
  }
  persist(); render();
}

/* ---------------- events ---------------- */
app.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest('button,[data-key]') as HTMLElement | null;
  if (!t) return;
  if (t.dataset.key) { keyPress(t.dataset.key); return; }
  if (t.dataset.set) { setSetting(t.dataset.set, t.dataset.val!); return; }
  const a = t.dataset.action;
  switch (a) {
    case 'start': startSession(); break;
    case 'enter': enter(); break;
    case 'next': next(); break;
    case 'explain': if (run) { run.hint = !run.hint; render(); } break;
    case 'quit': if (run) { run.confirmQuit = true; render(); } break;
    case 'quit-no': if (run) { run.confirmQuit = false; render(); } break;
    case 'quit-yes': finish(); break;
    case 'stepup': case 'decline': {
      const id = t.dataset.skill as SkillId; const sk = state.skills[id];
      if (a === 'stepup' && sk.level < maxLevel(id)) { logChange(state, 'level', `${skillMeta(id).name} Lv ${sk.level} → ${sk.level + 1}`, 'offer'); sk.level++; }
      else sk.declinedAt = day();
      if (lastRun) lastRun.offer = null; persist(); render(); break;
    }
    case 'lv': {
      const id = t.dataset.skill as SkillId; const d = Number(t.dataset.d); const sk = state.skills[id]; const to = sk.level + d;
      if (to < 1 || to > maxLevel(id)) return;
      logChange(state, 'level', `${skillMeta(id).name} Lv ${sk.level} → ${to}`); sk.level = to; persist(); render(); break;
    }
    case 'export': {
      const blob = new Blob([toCSV(state)], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `mental-math-${day()}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000); break;
    }
    case 'copy': navigator.clipboard?.writeText(toCSV(state)).then(() => toast('Copied.'), () => toast("Couldn't copy. Try Export instead.")); break;
    case 'reset': confirm = 'reset'; render(); break;
    case 'wipe': confirm = 'wipe'; render(); break;
    case 'cancel': confirm = null; render(); break;
    case 'reset-yes': {
      const id = (document.getElementById('reset-skill') as HTMLSelectElement).value as SkillId;
      state.attempts = state.attempts.filter(x => x.skill !== id); state.reviews = state.reviews.filter(x => x.skill !== id);
      logChange(state, 'setting', `${skillMeta(id).name} history reset`); confirm = null; persist(); render(); toast('Skill history reset.'); break;
    }
    case 'wipe-yes': state = freshState(); confirm = null; persist(); go('home'); break;
  }
});

app.addEventListener('change', e => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const s = state.settings as unknown as Record<string, unknown>;
  if (el instanceof HTMLInputElement && el.dataset.toggle) {
    const k = el.dataset.toggle; logChange(state, 'setting', `${k} ${s[k] ? 'on' : 'off'} → ${el.checked ? 'on' : 'off'}`);
    s[k] = el.checked; persist(); render();
  } else if (el.dataset.num) {
    const k = el.dataset.num; const v = Number(el.value); logChange(state, 'setting', `${k} ${s[k]} → ${v}`); s[k] = v; persist(); render();
  } else if (el.dataset.tol) {
    const id = el.dataset.tol as SkillId; const v = Number(el.value);
    logChange(state, 'setting', `${skillMeta(id).name} tolerance ±${state.settings.tolerance[id]}% → ±${v}%`);
    state.settings.tolerance[id] = v; persist(); render();
  }
});

app.addEventListener('submit', e => {
  e.preventDefault();
  if ((e.target as HTMLElement).id !== 'rates-form') return;
  const num = (id: string) => parseFloat((document.getElementById(id) as HTMLInputElement).value.replace(/,/g, ''));
  const next = { gbpUsd: num('r-gbpUsd'), eurGbp: num('r-eurGbp'), gbpToman: num('r-gbpToman') };
  if (Object.values(next).some(v => !isFinite(v) || v <= 0)) { alertInline('Each rate needs to be a number above 0.'); return; }
  const r = state.rates;
  const parts = [] as string[];
  if (next.gbpUsd !== r.gbpUsd) parts.push(`£/$ ${r.gbpUsd} → ${next.gbpUsd}`);
  if (next.eurGbp !== r.eurGbp) parts.push(`€/£ ${r.eurGbp} → ${next.eurGbp}`);
  if (next.gbpToman !== r.gbpToman) parts.push(`£/Toman ${short(r.gbpToman)} → ${short(next.gbpToman)}`);
  state.rates = { ...next, setAt: new Date().toISOString() };
  state.rateHistory.push(state.rates);
  logChange(state, 'rate', parts.length ? parts.join(', ') : 'Rates confirmed');
  persist(); render();
});

function alertInline(msg: string) {
  const f = document.getElementById('rates-form'); if (!f) return;
  let p = f.querySelector('.err') as HTMLElement | null; if (!p) { p = document.createElement('p'); p.className = 'err small'; f.appendChild(p); }
  p.textContent = msg;
}

// chart tooltip
app.addEventListener('pointerover', e => {
  const r = (e.target as Element).closest('[data-tip]') as SVGRectElement | null; const box = document.getElementById('trend');
  const tip = box?.querySelector('.tip') as HTMLElement | null; if (!box || !tip) return;
  if (!r) { tip.hidden = true; return; }
  const bb = box.getBoundingClientRect(), rb = r.getBoundingClientRect();
  tip.textContent = r.dataset.tip!; tip.style.left = `${rb.left - bb.left + rb.width / 2}px`; tip.style.top = `${rb.top - bb.top}px`; tip.hidden = false;
});

// physical keyboard (handy on a Mac)
document.addEventListener('keydown', e => {
  if (location.hash !== '#session' || !run) return;
  if (/^[0-9.]$/.test(e.key)) keyPress(e.key);
  else if (e.key === 'Backspace') keyPress('⌫');
  else if (e.key === 'Enter') { if (run.phase === 'reveal') next(); else enter(); }
});

window.addEventListener('hashchange', render);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// expose for debugging in the console
(window as unknown as { mm: unknown }).mm = { get state() { return state; }, get run() { return run; }, DEFAULT_SETTINGS };
