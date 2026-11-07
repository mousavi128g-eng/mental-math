import './style.css';
import type { Attempt, Question, Result, SessionMode, SkillId, State } from './types';
import { SKILLS, SKILL_IDS, maxLevel, skillMeta } from './engine/skills';
import { derivedRates, fmt, r2, short } from './engine/generate';
import {
  AWARDS, accuracy, addDays, applyAutoStepDown, checkAwards, day, daysBetween, dueReviews, isRight, localDay, mark, mastery, median,
  mondayOf, plan, stepUpCandidate, streak, updatePBs, updateReviews, weakest, weekSummary, type PBNews, type PlanRequest,
} from './engine/logic';
import { fetchLiveRates, freshState, load, logChange, reminderICS, save, toCSV } from './store';

let state: State = load();
const app = document.getElementById('app')!;

/* ================= helpers ================= */
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
const persist = () => save(state);
const go = (hash: string) => { if (location.hash === '#' + hash) render(); else location.hash = hash; };
const rateAge = () => daysBetween(state.rates.setAt, day());
const pctTxt = (n: number | null) => (n === null ? '–' : `${n}%`);
const secs = (ms: number) => (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
const dateTxt = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(iso).toLocaleDateString('en-GB', opts);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
let menuOpen = false;
let toastQueue: string[] = [];

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}

const header = (title: string, right = '') => `
  <header class="top"><h1>${title}</h1><div class="top-r">${right}<button class="icon-btn" data-action="menu" aria-label="Open menu">${ICON.menu}</button></div></header>`;

const ICON = {
  menu: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const tabbar = (active: string) => `
  <nav class="tabbar" aria-label="Main">
    ${[['home', 'Today'], ['practice', 'Practice'], ['progress', 'Progress'], ['settings', 'Settings']].map(([h, l]) =>
      `<a href="#${h}" class="tab ${active === h ? 'on' : ''}" ${active === h ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
  </nav>`;

const ring = (pct: number | null, accent: boolean, size = 50) => {
  const r = size * 0.38, c = 2 * Math.PI * r, off = c * (1 - (pct ?? 0) / 100), h = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${h}" cy="${h}" r="${r}" class="ring-bg"/>
    <circle cx="${h}" cy="${h}" r="${r}" class="ring-fg ${accent ? 'accent' : ''}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${h} ${h})"/></svg>`;
};

const seg = (name: string, value: string, opts: [string, string][]) => `
  <div class="seg" role="radiogroup">${opts.map(([v, l]) =>
    `<button type="button" role="radio" aria-checked="${v === value}" class="${v === value ? 'on' : ''}" data-set="${name}" data-val="${v}">${l}</button>`).join('')}</div>`;

const toggle = (name: string, on: boolean, label: string, sub = '') => `
  <label class="row"><span>${label}${sub ? `<small class="sub">${sub}</small>` : ''}</span><input type="checkbox" class="toggle" data-toggle="${name}" ${on ? 'checked' : ''}></label>`;

const backLink = (href: string, label: string) => `<a href="#${href}" class="back">${ICON.back}<span>${label}</span></a>`;

/* ================= global menu ================= */
function menuSheet() {
  const due = dueReviews(state).length;
  const item = (action: string, label: string, sub = '', data = '') => `<button class="mi" data-action="${action}" ${data}><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
  const link = (href: string, label: string, sub = '') => `<a class="mi" href="#${href}" data-action="close-menu"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</a>`;
  return `<div class="overlay" data-action="close-menu"><div class="sheet menu" role="dialog" aria-label="Menu">
    <div class="sheet-head"><span class="label">Menu</span><button class="icon-btn sm" data-action="close-menu" aria-label="Close menu">${ICON.close}</button></div>
    <span class="label">Practise</span>
    <div class="mgrid">
      ${item('start', "Today's session", `${state.settings.sessionLength} mixed questions`, 'data-mode="daily"')}
      ${item('start', 'Quick 5', 'Five questions, about 2 minutes', 'data-mode="quick"')}
      ${item('start', 'Estimation round', 'Big numbers, close is fine', 'data-mode="estimate"')}
      ${item('start', 'Review misses', due ? `${due} due today` : state.reviews.length ? `${state.reviews.length} in the queue` : 'Nothing to review yet', `data-mode="review" ${state.reviews.length ? '' : 'disabled'}`)}
      ${item('start', 'Weak spot', skillMeta(weakest(state) ?? 'mul').name, 'data-mode="weak"')}
      ${link('practice', 'One skill…', 'Pick a skill to drill')}
    </div>
    <span class="label">See</span>
    <div class="mgrid">
      ${link('progress', 'Progress')}${link('progress-skills', 'Skills')}${link('progress-history', 'Session history')}
      ${link('progress-awards', 'Awards and bests')}${link('week', 'Weekly review')}${link('help', 'How it works')}
    </div>
    <span class="label">Change</span>
    <div class="mgrid">
      ${link('settings-difficulty', 'Difficulty')}${link('settings-rates', 'Exchange rates')}${link('settings', 'All settings')}
    </div>
  </div></div>`;
}

/* ================= TODAY ================= */
function home() {
  const st = streak(state), weak = weakest(state), d = derivedRates(state.rates, state.settings.roundRates), age = rateAge();
  const due = dueReviews(state).length;
  const lastMonday = addDays(mondayOf(day()), -7);
  const showWeekly = state.settings.weeklyReview && state.lastWeeklySeen !== lastMonday && state.sessions.some(s => mondayOf(localDay(s.startedAt)) === lastMonday);
  const lastAward = Object.entries(state.awards).sort((a, b) => b[1].localeCompare(a[1]))[0];
  return `
  <main class="screen">
    ${header('Today', `<span class="muted small">${dateTxt(new Date().toISOString(), { weekday: 'short', day: 'numeric', month: 'short' })}</span>`)}
    ${showWeekly ? `<a class="banner" href="#week"><span class="label">New</span><b>Your weekly review is ready</b><small>How last week went and what to focus on next</small></a>` : ''}
    <section class="tile streak">
      <div><span class="label">Streak</span><b>${st.count}</b> <span class="muted">${st.count === 1 ? 'day' : 'days'}</span>
        <small class="sub">${st.freezeLeft ? '1 streak freeze left this week' : 'Freeze used this week'}</small></div>
      <div class="dots" aria-label="This week">${st.week.map((s, i) => `<i class="${s}" title="${'MTWTFSS'[i]}"></i>`).join('')}</div>
    </section>
    <button class="cta" data-action="start" data-mode="daily">${st.practisedToday ? 'Another session' : "Start today's session"} <small>${state.settings.sessionLength} questions · ~${Math.max(2, Math.round(state.settings.sessionLength * 0.6))} min</small></button>
    <div class="quick">
      <button data-action="start" data-mode="quick"><b>Quick 5</b><small>2 min</small></button>
      <button data-action="start" data-mode="estimate"><b>Estimate</b><small>close is fine</small></button>
      <button data-action="start" data-mode="review" ${state.reviews.length ? '' : 'disabled'}><b>Review</b><small>${due ? `${due} due` : `${state.reviews.length} queued`}</small></button>
    </div>
    <section class="tile">
      <span class="label">Skills · tap one for details</span>
      <div class="rings">${SKILLS.map(s => {
        const m = mastery(state.attempts, s.id, state.skills[s.id].level); const paused = state.skills[s.id].status === 'pause';
        return `<a href="#skill-${s.id}" class="ringcell ${paused ? 'paused' : ''}">${ring(m, s.id === weak && m !== null)}<span>${s.name}</span><small>${paused ? 'paused' : 'Lv ' + state.skills[s.id].level}</small></a>`;
      }).join('')}</div>
    </section>
    <a class="tile linky" href="#settings-rates">
      <span class="label">Rates in use ${state.settings.rateMode === 'live' ? '· live' : ''}</span>
      <span>£1 = $${fmt(state.rates.gbpUsd, 4)} · €1 = £${fmt(state.rates.eurGbp, 4)} · €1 = $${fmt(d.eurUsd, 4)}</span>
      <span class="${age >= state.settings.rateReminderDays ? 'accent' : 'muted'}">£1 = ${fmt(state.rates.gbpToman)} Toman · set ${age === 0 ? 'today' : plural(age, 'day') + ' ago'}${age >= state.settings.rateReminderDays ? ' · tap to update' : ''}</span>
    </a>
    ${lastAward ? `<a class="tile linky slim" href="#progress-awards"><span class="label">Latest award</span><span>${esc(AWARDS.find(a => a.id === lastAward[0])?.name ?? '')} · ${dateTxt(lastAward[1])}</span></a>` : ''}
  </main>${tabbar('home')}`;
}

/* ================= PRACTICE ================= */
function practiceView() {
  const due = dueReviews(state).length, weak = weakest(state) ?? 'mul';
  const card = (mode: string, title: string, sub: string, extra = '') => `<button class="pcard" data-action="start" data-mode="${mode}" ${extra}><b>${title}</b><small>${sub}</small></button>`;
  return `<main class="screen">${header('Practice')}
    <div class="pgrid">
      ${card('daily', "Today's session", `${state.settings.sessionLength} mixed questions, weighted to your weak spots`)}
      ${card('quick', 'Quick 5', 'Five mixed questions, about 2 minutes')}
      ${card('weak', 'Weak spot', `10 × ${skillMeta(weak).name.toLowerCase()} at level ${state.skills[weak].level}`)}
      ${card('estimate', 'Estimation round', `Big, awkward numbers. Within ±${state.settings.estimateTolerance}% counts.`)}
      ${card('review', 'Review misses', state.reviews.length ? `${due ? `${due} due today` : 'None due today'}, ${state.reviews.length} in the queue` : 'Nothing to review yet', state.reviews.length ? '' : 'disabled')}
    </div>
    <span class="label">One skill · 10 questions at your level</span>
    <div class="skillpick">${SKILLS.map(s => { const lv = state.skills[s.id].level;
      return `<button data-action="start" data-mode="skill" data-skill="${s.id}"><span class="glyph">${s.glyph}</span><b>${s.name}</b><small>Lv ${lv} · ${s.levels[lv - 1]}</small></button>`; }).join('')}</div>
    <p class="muted small">Change levels under Settings › Difficulty.</p>
  </main>${tabbar('practice')}`;
}

/* ================= SESSION ================= */
interface Row { q: Question; given: number | null; result: Result; tries: number; ms: number; estimate: boolean }
interface Run {
  id: string; mode: SessionMode; label: string; req: PlanRequest; startedAt: string; qs: Question[]; i: number; raw: string; tries: number; qStart: number;
  rows: Row[]; phase: 'ask' | 'right' | 'retry' | 'reveal'; lastResult?: Result; lastGiven?: number | null;
  est: boolean; hint: boolean; sheet: null | 'menu' | 'quit' | 'restart'; timer?: number; advance?: number;
}
let run: Run | null = null;
let lastRun: { run: Run; offer: SkillId | null; steppedDown: SkillId[]; news: PBNews[]; awards: string[] } | null = null;

const LABELS: Record<SessionMode, string> = { daily: "Today's session", quick: 'Quick 5', skill: 'Skill drill', estimate: 'Estimation round', review: 'Review misses', weak: 'Weak spot' };

function startSession(mode: SessionMode, skill?: SkillId) {
  const req: PlanRequest = { mode, skill };
  const qs = plan(state, req);
  if (!qs.length) { toast('Nothing to review yet.'); return; }
  menuOpen = false;
  run = { id: uid(), mode, req, label: mode === 'skill' && skill ? `${skillMeta(skill).name} drill` : LABELS[mode], startedAt: new Date().toISOString(), qs, i: 0, raw: '',
    tries: 1, qStart: performance.now(), rows: [], phase: 'ask', est: mode === 'estimate', hint: false, sheet: null };
  go('session');
}

const keypadKeys = () => (state.settings.keypad === 'phone'
  ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] : ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫']);

const displayRaw = (raw: string) => {
  if (!raw) return '';
  const [i, d] = raw.split('.'); const ii = i ? Number(i).toLocaleString('en-GB') : '0';
  return d !== undefined ? `${ii}.${d}` : ii;
};
const unitPrefix = (u?: string) => (u === '£' || u === '$' || u === '€' ? u : '');
const unitSuffix = (u?: string) => (u && !unitPrefix(u) ? u : '');

function sessionView() {
  if (!run) return home();
  const r = run, q = r.qs[r.i], s = state.settings;
  const meta = q.kind === 'two-step' ? 'Two-step' : q.level === 0 ? 'Estimate' : `${skillMeta(q.skill).name} · Lv ${q.level}`;
  const done = r.i + (r.phase === 'right' || r.phase === 'reveal' ? 1 : 0);
  const progress = (done / r.qs.length) * 100;
  const answering = r.phase === 'ask' || r.phase === 'retry';
  let panel = '';
  if (r.phase === 'right') {
    const word = r.lastResult === 'estimate' ? 'Good estimate.' : 'Correct.';
    const exact = r.lastResult !== 'exact' && (s.showExactOnClose || r.lastResult === 'estimate') ? `<p class="fb-sub">Exact answer: ${unitPrefix(q.unit)}${fmt(q.answer)} ${unitSuffix(q.unit)}</p>` : '';
    panel = `<div class="fbwrap"><p class="fb ok">${word}</p>${exact}${!s.minimalFeedback ? `<p class="hint">${esc(q.hint)}</p>` : ''}</div>
      ${!s.minimalFeedback ? `<button class="cta" data-action="next">Next</button>` : ''}`;
  } else if (r.phase === 'retry') {
    panel = `<div class="fbwrap"><p class="fb no">Not quite. Try again.</p><button class="linkbtn" data-action="reveal">Show the answer</button></div>`;
  } else if (r.phase === 'reveal') {
    const skipped = r.lastResult === 'skipped';
    panel = `<div class="reveal">
      <p class="fb no">${skipped ? 'Skipped.' : 'Not quite.'}</p>
      <div class="answer-card"><span class="label">Correct answer</span><b>${unitPrefix(q.unit)}${fmt(q.answer)}<small> ${unitSuffix(q.unit)}</small></b>
        ${!skipped && r.lastGiven != null ? `<small class="muted">You said ${unitPrefix(q.unit)}${fmt(r.lastGiven)}</small>` : ''}</div>
      <p class="hint"><b>How:</b> ${esc(q.hint)}</p>
      <button class="cta" data-action="next">${r.i + 1 >= r.qs.length ? 'See results' : 'Next question'}</button></div>`;
  }
  return `
  <main class="screen session">
    <header class="sess-top">
      <button class="icon-btn" data-action="quit" aria-label="End session">${ICON.close}</button>
      <div class="prog-wrap"><div class="prog" role="progressbar" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><b style="width:${progress}%"></b></div>
        <small class="muted">${Math.min(r.i + 1, r.qs.length)} of ${r.qs.length}${s.showTimer ? ` · <span id="timer">0s</span>` : ''}</small></div>
      <button class="icon-btn" data-action="smenu" aria-label="Session options">${ICON.dots}</button>
    </header>
    <div class="qcard">
      <div class="chips"><span class="chip">${meta}</span>${q.review ? '<span class="chip">Review</span>' : ''}${q.estimateOk ? '<span class="chip soft">Estimate welcome</span>' : ''}</div>
      <p class="qtitle">${esc(q.title)}</p>
      <div class="q" aria-live="polite">${esc(q.prompt)}</div>
      ${q.context ? `<p class="context">${esc(q.context)}</p>` : ''}
    </div>
    <div class="answer ${r.phase === 'retry' ? 'shake' : ''} ${r.phase === 'right' ? 'good' : ''} ${r.phase === 'reveal' ? 'bad' : ''}" id="answer">
      ${r.est ? '<span class="approx" title="Estimate">≈</span>' : ''}<span class="pre">${unitPrefix(q.unit)}</span><span id="raw">${displayRaw(r.raw)}</span>${answering ? '<i class="caret"></i>' : ''}<small>${esc(unitSuffix(q.unit))}</small>
    </div>
    ${r.hint && answering ? `<p class="hint"><b>Hint:</b> ${esc(q.hint.split('.')[0])}.</p>` : ''}
    ${answering ? `
      <div class="tools">
        <button data-action="hint" class="${r.hint ? 'on' : ''}">Hint</button>
        <button data-action="estimate" class="${r.est ? 'on' : ''}" aria-pressed="${r.est}">≈ Estimate</button>
        <button data-action="skip">Skip</button>
      </div>
      ${r.phase === 'retry' ? panel : ''}
      <div class="pad">${keypadKeys().map(k => `<button type="button" data-key="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>`).join('')}</div>
      <button class="go" data-action="enter">Check answer</button>` : panel}
    ${r.sheet === 'menu' ? sessionMenu() : ''}
    ${r.sheet === 'quit' ? confirmSheet('End this session?', 'Answers so far are saved and count towards your stats.', 'quit-no', 'Keep going', 'quit-yes', 'End session') : ''}
    ${r.sheet === 'restart' ? confirmSheet('Restart with new questions?', 'Answers so far in this session are saved.', 'sheet-close', 'Cancel', 'restart-yes', 'Restart') : ''}
  </main>`;
}

function sessionMenu() {
  const s = state.settings;
  return `<div class="overlay" data-action="sheet-close"><div class="sheet" role="dialog" aria-label="Session options">
    <div class="sheet-head"><span class="label">This question</span><button class="icon-btn sm" data-action="sheet-close" aria-label="Close">${ICON.close}</button></div>
    <button class="mi" data-action="skip"><b>Skip this question</b><small>See the answer and how to work it out</small></button>
    <button class="mi" data-action="estimate"><b>${run?.est ? 'Answer exactly' : 'Answer as an estimate'}</b><small>Within ±${s.estimateTolerance}% counts as a good estimate</small></button>
    <button class="mi" data-action="hint"><b>${run?.hint ? 'Hide the hint' : 'Show a hint'}</b></button>
    <span class="label">This session</span>
    <button class="mi" data-action="restart"><b>Restart with new questions</b></button>
    <button class="mi" data-action="timer"><b>${s.showTimer ? 'Hide the timer' : 'Show a timer'}</b></button>
    <button class="mi" data-action="quit"><b>End session</b><small>Answers so far are saved</small></button>
  </div></div>`;
}

const confirmSheet = (title: string, sub: string, noAct: string, noLabel: string, yesAct: string, yesLabel: string) => `
  <div class="overlay"><div class="sheet" role="alertdialog" aria-label="${title}"><p><b>${title}</b></p><p class="muted small">${sub}</p>
  <div class="btns"><button data-action="${noAct}">${noLabel}</button><button class="p" data-action="${yesAct}">${yesLabel}</button></div></div></div>`;

function updateRaw() { const el = document.getElementById('raw'); if (el && run) el.textContent = displayRaw(run.raw); }

function keyPress(k: string) {
  if (!run || run.sheet || !(run.phase === 'ask' || run.phase === 'retry')) return;
  if (k === '⌫') run.raw = run.raw.slice(0, -1);
  else if (k === '.') { if (!run.raw.includes('.')) run.raw = (run.raw || '0') + '.'; }
  else if (run.raw.replace('.', '').length < 12) run.raw = run.raw === '0' ? k : run.raw + k;
  updateRaw();
}

function record(q: Question, given: number | null, result: Result, tries: number, ms: number) {
  const r = run!;
  const a: Attempt = { id: uid(), sessionId: r.id, skill: q.skill, level: q.level, kind: q.kind, prompt: q.prompt, answer: q.answer,
    given, result, tries, ms: Math.round(ms), at: new Date().toISOString(), review: !!q.review, estimate: r.est || undefined };
  state.attempts.push(a);
  updateReviews(state, q, result, tries);
  r.rows.push({ q, given, result, tries, ms, estimate: r.est });
  persist();
}

function enter() {
  if (!run || run.sheet || !(run.phase === 'ask' || run.phase === 'retry') || !run.raw) return;
  const r = run, q = r.qs[r.i], s = state.settings, given = parseFloat(r.raw);
  const tol = q.level === 0 ? Math.max(s.tolerance[q.skill], 2) : s.tolerance[q.skill];
  const result = mark(q, given, tol, r.est, s.estimateTolerance);
  const ms = performance.now() - r.qStart;
  r.lastGiven = given;
  if (isRight(result)) {
    record(q, given, result, r.tries, ms);
    r.phase = 'right'; r.lastResult = result; render();
    if (s.minimalFeedback) r.advance = window.setTimeout(next, result === 'exact' ? 700 : 1700);
  } else if (r.tries <= s.retries) {
    r.tries++; r.raw = ''; r.phase = 'retry'; render();
  } else {
    record(q, given, 'wrong', r.tries, ms);
    r.phase = 'reveal'; r.lastResult = 'wrong'; render();
  }
}

function reveal(skipped: boolean) {
  if (!run || !(run.phase === 'ask' || run.phase === 'retry')) return;
  const q = run.qs[run.i];
  record(q, skipped ? null : run.lastGiven ?? null, skipped ? 'skipped' : 'wrong', run.tries, performance.now() - run.qStart);
  run.phase = 'reveal'; run.lastResult = skipped ? 'skipped' : 'wrong'; run.sheet = null; render();
}

function next() {
  if (!run || (run.phase !== 'right' && run.phase !== 'reveal')) return;
  clearTimeout(run.advance);
  run.i++; run.raw = ''; run.tries = 1; run.hint = false; run.phase = 'ask'; run.lastGiven = null; run.qStart = performance.now();
  if (run.mode !== 'estimate') run.est = false;
  if (run.i >= run.qs.length) finish(); else render();
}

function finish() {
  if (!run) return;
  const r = run; clearInterval(r.timer); clearTimeout(r.advance);
  let news: PBNews[] = [], awards: string[] = [];
  if (r.rows.length) {
    const sess = { id: r.id, mode: r.mode, label: r.label, startedAt: r.startedAt, endedAt: new Date().toISOString(), total: r.rows.length,
      correct: r.rows.filter(x => isRight(x.result)).length, firstTry: r.rows.filter(x => isRight(x.result) && x.tries === 1).length,
      ms: Math.round(r.rows.reduce((t, x) => t + x.ms, 0)) };
    state.sessions.push(sess);
    news = updatePBs(state, sess, state.attempts.filter(a => a.sessionId === r.id));
    awards = checkAwards(state).map(a => a.name);
  }
  const steppedDown = applyAutoStepDown(state);
  persist();
  lastRun = r.rows.length ? { run: r, offer: stepUpCandidate(state), steppedDown, news, awards } : null;
  run = null;
  go(lastRun ? 'done' : 'home');
}

/* ================= DONE ================= */
const resultWord: Record<Result, string> = { exact: 'Correct', close: 'Close enough', estimate: 'Good estimate', wrong: 'Missed', skipped: 'Skipped' };

function answerList(rows: { prompt: string; title?: string; answer: number; given: number | null; result: Result; unit?: string; hint?: string }[]) {
  return rows.map(x => `<details class="arow ${isRight(x.result) ? 'ok' : 'no'}"><summary>
      <span class="aq">${esc(x.prompt)}</span><span class="ares">${resultWord[x.result]}</span></summary>
      <div class="adet">${x.title ? `<p class="muted small">${esc(x.title)}</p>` : ''}
        <p>Answer: <b>${unitPrefix(x.unit)}${fmt(x.answer)} ${esc(unitSuffix(x.unit))}</b>${x.given != null ? ` · you said ${fmt(x.given)}` : ''}</p>
        ${x.hint ? `<p class="small">${esc(x.hint)}</p>` : ''}</div></details>`).join('');
}

function doneView() {
  if (!lastRun) return home();
  const { run: r, offer, steppedDown, news, awards } = lastRun;
  const total = r.rows.length, correct = r.rows.filter(x => isRight(x.result)).length;
  const first = r.rows.filter(x => isRight(x.result) && x.tries === 1).length;
  const ests = r.rows.filter(x => x.result === 'estimate' || (x.estimate && isRight(x.result))).length;
  const skipped = r.rows.filter(x => x.result === 'skipped').length;
  const ms = r.rows.reduce((t, x) => t + x.ms, 0);
  const missed = r.rows.filter(x => !isRight(x.result)).length;
  const quiet = state.settings.quietMode;
  return `
  <main class="screen">
    ${header('Done', `<span class="muted small">${esc(r.label)}</span>`)}
    <section class="tile big-score"><b>${correct}/${total}</b>
      <span class="muted">${first} first try${ests ? ` · ${ests} as estimates` : ''}${skipped ? ` · ${skipped} skipped` : ''} · ${secs(ms)}</span></section>
    ${!quiet && (news.length || awards.length) ? `<section class="tile celebrate"><span class="label">New</span>
      ${awards.map(a => `<p><b>Award: ${esc(a)}</b></p>`).join('')}${news.map(n => `<p><b>${esc(n.label)}</b> <span class="muted small">${esc(n.detail)}</span></p>`).join('')}</section>` : ''}
    ${offer ? `<section class="sheet inline">
      <span class="label">Ready for more?</span>
      <p><b>You've hit ${state.settings.stepUpPct}%+ on ${skillMeta(offer).name.toLowerCase()} ${state.settings.stepUpSessions} sessions running.</b></p>
      <p class="muted small">Next level: ${skillMeta(offer).levels[state.skills[offer].level]}. You can step back down any time in Settings.</p>
      <div class="btns"><button data-action="decline" data-skill="${offer}">Not yet</button><button class="p" data-action="stepup" data-skill="${offer}">Step up</button></div>
    </section>` : ''}
    <section class="tile"><span class="label">Your answers · tap one to see how</span>
      ${answerList(r.rows.map(x => ({ prompt: x.q.prompt, title: x.q.title, answer: x.q.answer, given: x.given, result: x.result, unit: x.q.unit, hint: x.q.hint })))}</section>
    ${missed ? `<p class="muted small center">${plural(missed, 'question')} will come back in review over the next week.</p>` : ''}
    ${steppedDown.length ? `<p class="muted small center">Auto step-down: ${steppedDown.map(id => skillMeta(id).name).join(', ')} moved down a level.</p>` : ''}
    <div class="quick two">
      <button data-action="start" data-mode="${r.mode}" ${r.req.skill ? `data-skill="${r.req.skill}"` : ''}><b>Go again</b><small>${esc(r.label)}</small></button>
      <button data-action="start" data-mode="review" ${state.reviews.length ? '' : 'disabled'}><b>Review misses</b><small>${state.reviews.length} queued</small></button>
    </div>
    <a class="cta" href="#home">Back to Today</a>
  </main>`;
}

/* ================= PROGRESS ================= */
const progTabs = (active: string) => `<div class="seg tabs">${[['progress', 'Overview'], ['progress-skills', 'Skills'], ['progress-history', 'History'], ['progress-awards', 'Awards']]
  .map(([h, l]) => `<a href="#${h}" class="${active === h ? 'on' : ''}">${l}</a>`).join('')}</div>`;

function lineChart(points: { at: string; pct: number; tip: string }[], id: string, markers = true) {
  if (points.length < 2) return `<p class="muted small">The trend appears after your second session.</p>`;
  const W = 320, H = 150, L = 30, R = 10, T = 18, B = 18;
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (p: number) => T + ((100 - p) * (H - T - B)) / 100;
  const pts = points.map((p, i) => [x(i), y(p.pct)]);
  const line = pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  const area = `M${pts[0][0]},${H - B} L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0]},${H - B} Z`;
  const first = points[0].at;
  const marks = markers ? state.changes.filter(c => c.at >= first && c.what !== 'setting').slice(-5).map(c => {
    const idx = points.findIndex(s => s.at >= c.at); if (idx <= 0) return '';
    const xm = (x(idx - 1) + x(idx)) / 2;
    return `<line x1="${xm}" x2="${xm}" y1="${T - 6}" y2="${H - B}" class="mk ${c.what}"/><text x="${xm + 3}" y="${T - 8}" class="mk-t ${c.what}">${c.what === 'rate' ? 'rate' : esc(c.label.split(' Lv')[0])}</text>`;
  }).join('') : '';
  return `<div class="chartbox" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="First-try accuracy over ${points.length} sessions">
    ${[0, 50, 100].map(p => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="grid"/><text x="${L - 6}" y="${y(p) + 3}" text-anchor="end" class="ax">${p}%</text>`).join('')}
    <path d="${area}" class="area"/><polyline points="${line}" class="line"/>${marks}
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="4" class="end"/>
    ${pts.map((p, i) => `<rect x="${p[0] - 7}" y="${T}" width="14" height="${H - T - B}" class="hit" data-tip="${esc(points[i].tip)}"/>`).join('')}
  </svg><div class="tip" hidden></div></div>`;
}

const sessionPoints = (ss = state.sessions.slice(-30)) => ss.map(s => ({ at: s.startedAt, pct: Math.round((100 * s.firstTry) / s.total), tip: `${dateTxt(s.startedAt)} · ${s.label}: ${s.firstTry}/${s.total} first try` }));

function heatmap() {
  const counts = new Map<string, number>();
  for (const a of state.attempts) { const d = localDay(a.at); counts.set(d, (counts.get(d) ?? 0) + 1); }
  const start = addDays(mondayOf(day()), -28);
  const cells = Array.from({ length: 35 }, (_, i) => { const d = addDays(start, i); const n = counts.get(d) ?? 0;
    const lv = d > day() ? 'future' : n === 0 ? '' : n <= 5 ? 'l1' : n <= 10 ? 'l2' : 'l3';
    return `<i class="${lv}" title="${dateTxt(d)}: ${n} answered"></i>`; }).join('');
  return `<div class="heat-head">${'MTWTFSS'.split('').map(c => `<span>${c}</span>`).join('')}</div><div class="heat">${cells}</div>
    <div class="legend"><span>Less</span><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><span>More</span></div>`;
}

function errorPatterns() {
  const since = addDays(day(), -30);
  const recent = state.attempts.filter(a => localDay(a.at) >= since);
  const out: string[] = [];
  const rev = recent.filter(a => ['fx-usd-gbp', 'fx-gbp-eur', 'fx-usd-eur'].includes(a.kind) && a.result === 'wrong' && a.given);
  const flipped = rev.filter(a => { const p = parseFloat(a.prompt.replace(/[^0-9.]/g, '')); const w = (p * p) / a.answer; return Math.abs(a.given! - w) / w < 0.04; }).length;
  if (flipped) out.push(`Multiplied instead of divided on a conversion ${plural(flipped, 'time')}`);
  const zeros = recent.filter(a => a.result === 'wrong' && a.given && a.answer && [10, 0.1].some(f => Math.abs(a.given! / a.answer - f) < 0.02)).length;
  if (zeros) out.push(`Off by a zero ${plural(zeros, 'time')}`);
  const sk = recent.filter(a => a.result === 'skipped').length;
  if (sk >= 3) out.push(`Skipped ${sk} questions. Try an estimate instead next time.`);
  const byKind = new Map<string, { n: number; w: number }>();
  for (const a of recent) { const k = byKind.get(a.kind) ?? { n: 0, w: 0 }; k.n++; if (!isRight(a.result) || a.tries > 1) k.w++; byKind.set(a.kind, k); }
  const KIND: Record<string, string> = { 'mul-2x2': '2-digit × 2-digit', 'mul-3x2': '3-digit × 2-digit', 'fx-usd-gbp': '$ → £', 'pct-change': '% change', 'pct-new': 'new value after %', 'pct-vat': 'removing VAT', 'div-estimate': 'estimating division', 'toman-to-gbp': 'Toman → £', 'mul-factor': '× 1.2 / 1.25 / 1.5' };
  [...byKind.entries()].filter(([, v]) => v.n >= 3 && v.w / v.n >= 0.3).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n).slice(0, 3)
    .forEach(([k, v]) => out.push(`${KIND[k] ?? k}: ${Math.round((100 * v.w) / v.n)}% missed or retried`));
  return out;
}

function progressView() {
  const week = addDays(day(), -6);
  const wk = state.attempts.filter(a => localDay(a.at) >= week);
  const st = streak(state);
  const sessWeek = state.sessions.filter(s => localDay(s.startedAt) >= mondayOf(day())).length;
  const med = median(wk.filter(a => isRight(a.result)).map(a => a.ms));
  const patterns = errorPatterns();
  const changes = state.changes.slice(-6).reverse();
  return `<main class="screen">${header('Progress', `<span class="muted small">${plural(state.attempts.length, 'answer')}</span>`)}
    ${progTabs('progress')}
    <section class="stats">
      <div class="tile stat"><b>${pctTxt(accuracy(wk))}</b><span>first try, last 7 days</span></div>
      <div class="tile stat"><b>${st.count}</b><span>day streak</span></div>
      <div class="tile stat"><b>${sessWeek}</b><span>${sessWeek === 1 ? 'session' : 'sessions'} this week</span></div>
      <div class="tile stat"><b>${med ? (med / 1000).toFixed(1) + 's' : '–'}</b><span>typical time per answer</span></div>
    </section>
    <section class="tile"><span class="label">Practice calendar · 5 weeks</span>${heatmap()}</section>
    <section class="tile"><span class="label">First-try accuracy per session · level and rate changes marked</span>${lineChart(sessionPoints(), 'trend')}</section>
    <section class="tile"><span class="label">Patterns · last 30 days</span>
      ${patterns.length ? patterns.map(p => `<p class="small">${esc(p)}</p>`).join('') : `<p class="muted small">Nothing stands out yet. Patterns show up after a few sessions.</p>`}</section>
    <a class="tile linky" href="#week"><span class="label">Weekly review</span><span>See how this week compares with last week</span></a>
    <section class="tile"><span class="label">Recent changes</span>
      ${changes.length ? changes.map(c => `<div class="row"><span class="small">${esc(c.label)}</span><span class="v">${dateTxt(c.at)} · ${c.by}</span></div>`).join('') : `<p class="muted small">Level, rate and setting changes show here.</p>`}</section>
  </main>${tabbar('progress')}`;
}

function sparkline(vals: number[]) {
  if (vals.length < 2) return '';
  const W = 90, H = 26, x = (i: number) => (i * W) / (vals.length - 1), y = (v: number) => H - 2 - (v * (H - 4)) / 100;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="2.5"/></svg>`;
}

function skillStats(id: SkillId) {
  const lv = state.skills[id].level;
  const all = state.attempts.filter(a => a.skill === id);
  const at = all.filter(a => a.level === lv);
  const recent = all.filter(a => localDay(a.at) >= addDays(day(), -30));
  const bySess = new Map<string, Attempt[]>(); for (const a of all) { if (!bySess.has(a.sessionId)) bySess.set(a.sessionId, []); bySess.get(a.sessionId)!.push(a); }
  const spark = [...bySess.values()].slice(-12).map(xs => accuracy(xs) ?? 0);
  return { lv, all, at, m: mastery(state.attempts, id, lv), acc: accuracy(recent), med: median(at.slice(-30).filter(a => isRight(a.result)).map(a => a.ms)),
    estPct: all.length ? Math.round((100 * all.filter(a => a.estimate).length) / all.length) : null, spark };
}

function skillsView() {
  const weak = weakest(state);
  return `<main class="screen">${header('Progress')}${progTabs('progress-skills')}
    ${SKILLS.map(s => { const x = skillStats(s.id);
      return `<a class="tile linky skillcard" href="#skill-${s.id}">
        <div class="sc-top"><b>${s.name}</b><span class="muted small">Lv ${x.lv} · ${s.levels[x.lv - 1]}</span></div>
        <div class="bar"><i style="width:${x.m ?? 0}%" class="${s.id === weak && x.m !== null ? 'accent' : ''}"></i></div>
        <div class="sc-row"><span class="small">Mastery ${pctTxt(x.m)} · 30-day ${pctTxt(x.acc)}${x.med ? ` · ${(x.med / 1000).toFixed(1)}s` : ''}${s.id === weak && x.m !== null ? ' · <span class="accent">focus</span>' : ''}</span>${sparkline(x.spark)}</div>
      </a>`; }).join('')}
  </main>${tabbar('progress')}`;
}

function skillDetail(id: SkillId) {
  const s = skillMeta(id), x = skillStats(id);
  const kinds = new Map<string, { n: number; w: number; ex: string }>();
  for (const a of x.all.slice(-60)) { const k = kinds.get(a.kind) ?? { n: 0, w: 0, ex: a.prompt }; k.n++; if (!isRight(a.result)) { k.w++; k.ex = a.prompt; } kinds.set(a.kind, k); }
  const misses = x.all.filter(a => !isRight(a.result)).slice(-5).reverse();
  return `<main class="screen">${backLink('progress-skills', 'Skills')}${header(s.name)}
    <section class="tile big-score">${ring(x.m, false, 96)}<span class="muted">Mastery at level ${x.lv}</span></section>
    <section class="stats">
      <div class="tile stat"><b>${pctTxt(x.acc)}</b><span>first try, last 30 days</span></div>
      <div class="tile stat"><b>${x.med ? (x.med / 1000).toFixed(1) + 's' : '–'}</b><span>typical time at this level</span></div>
      <div class="tile stat"><b>${x.all.length}</b><span>answered in total</span></div>
      <div class="tile stat"><b>${x.estPct === null ? '–' : x.estPct + '%'}</b><span>answered as estimates</span></div>
    </section>
    <section class="tile"><span class="label">Levels</span>
      <div class="steps">${s.levels.map((l, i) => `<span class="step ${i + 1 < x.lv ? 'done' : i + 1 === x.lv ? 'now' : ''}">${i + 1}. ${l}</span>`).join('')}</div>
      <a class="small accent" href="#settings-difficulty">Change level</a></section>
    ${misses.length ? `<section class="tile"><span class="label">Recent misses</span>${answerList(misses.map(a => ({ prompt: a.prompt, answer: a.answer, given: a.given, result: a.result })))}</section>` : ''}
    <button class="cta" data-action="start" data-mode="skill" data-skill="${id}">Practise ${s.name.toLowerCase()} (10)</button>
  </main>${tabbar('progress')}`;
}

function historyView() {
  const ss = [...state.sessions].reverse().slice(0, 60);
  let lastDay = '';
  return `<main class="screen">${header('Progress')}${progTabs('progress-history')}
    ${ss.length ? `<section class="group">${ss.map(s => { const d = localDay(s.startedAt); const head = d !== lastDay ? `<span class="label pad-top">${dateTxt(s.startedAt, { weekday: 'long', day: 'numeric', month: 'short' })}</span>` : ''; lastDay = d;
      return `${head}<a class="row" href="#s-${s.id}"><span>${esc(s.label)}<small class="sub">${new Date(s.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${secs(s.ms)}</small></span><span class="v"><b class="score">${s.correct}/${s.total}</b> ›</span></a>`; }).join('')}</section>`
      : `<p class="muted center">Finished sessions show here. Tap one to see every answer.</p>`}
  </main>${tabbar('progress')}`;
}

function sessionDetail(id: string) {
  const s = state.sessions.find(x => x.id === id);
  if (!s) return historyView();
  const atts = state.attempts.filter(a => a.sessionId === id);
  return `<main class="screen">${backLink('progress-history', 'History')}${header(esc(s.label))}
    <section class="tile big-score"><b>${s.correct}/${s.total}</b><span class="muted">${dateTxt(s.startedAt, { weekday: 'short', day: 'numeric', month: 'short' })} · ${s.firstTry} first try · ${secs(s.ms)}</span></section>
    <section class="tile"><span class="label">Answers</span>${answerList(atts.map(a => ({ prompt: a.prompt, answer: a.answer, given: a.given, result: a.result })))}</section>
  </main>${tabbar('progress')}`;
}

function awardsView() {
  const pb = state.pbs;
  return `<main class="screen">${header('Progress')}${progTabs('progress-awards')}
    <section class="tile"><span class="label">Personal bests</span>
      <div class="row"><span>Fastest perfect session</span><span class="v">${pb.fastestClean ? `${secs(pb.fastestClean.ms)} · ${pb.fastestClean.total} questions` : '–'}</span></div>
      <div class="row"><span>Longest correct run</span><span class="v">${pb.longestRun ? `${pb.longestRun.n} in a row` : '–'}</span></div>
      <div class="row"><span>Best week</span><span class="v">${pb.bestWeek ? `${pb.bestWeek.pct}% · w/c ${dateTxt(pb.bestWeek.week)}` : '–'}</span></div>
    </section>
    <div class="awards">${AWARDS.map(a => { const got = state.awards[a.id];
      return `<div class="award ${got ? 'got' : ''}"><span class="medal">${got ? '★' : '☆'}</span><b>${esc(a.name)}</b><small>${got ? dateTxt(got) : esc(a.how)}</small></div>`; }).join('')}</div>
  </main>${tabbar('progress')}`;
}

/* ================= WEEKLY REVIEW ================= */
let weekOffset: number | null = null;
function weekView() {
  if (weekOffset === null) weekOffset = weekSummary(state, addDays(mondayOf(day()), -7)).cur.length ? -1 : 0;
  const monday = addDays(mondayOf(day()), weekOffset * 7);
  const w = weekSummary(state, monday);
  if (weekOffset === -1) { state.lastWeeklySeen = monday; persist(); }
  const arrow = (now: number | null, before: number | null) => (now === null || before === null ? '' : now > before ? `<span class="up">+${now - before}</span>` : now < before ? `<span class="down">${now - before}</span>` : '<span class="muted">±0</span>');
  const focus = w.worst?.id ?? weakest(state) ?? 'mul';
  return `<main class="screen">${backLink('progress', 'Progress')}${header('Week')}
    <div class="weeknav"><button class="icon-btn sm" data-action="week-prev" aria-label="Previous week">‹</button>
      <b>${dateTxt(monday)} – ${dateTxt(addDays(monday, 6))}</b>
      <button class="icon-btn sm" data-action="week-next" aria-label="Next week" ${(weekOffset ?? 0) >= 0 ? 'disabled' : ''}>›</button></div>
    ${w.cur.length ? `
    <section class="stats">
      <div class="tile stat"><b>${w.days}/7</b><span>days practised</span></div>
      <div class="tile stat"><b>${pctTxt(w.acc)} ${arrow(w.acc, w.prevAcc)}</b><span>first try${w.prevAcc !== null ? ` (was ${w.prevAcc}%)` : ''}</span></div>
      <div class="tile stat"><b>${w.cur.length}</b><span>questions</span></div>
      <div class="tile stat"><b>${w.medianMs ? (w.medianMs / 1000).toFixed(1) + 's' : '–'}</b><span>typical time</span></div>
    </section>
    <section class="tile"><span class="label">By skill · first try, change on the week before</span>
      ${w.bySkill.filter(x => x.n).map(x => `<div class="row"><span>${skillMeta(x.id).name} <small class="sub">${plural(x.n, 'question')}</small></span><span class="v">${pctTxt(x.now)} ${arrow(x.now, x.before)}</span></div>`).join('')}</section>
    ${w.best && w.best.before !== null && w.best.now! > w.best.before ? `<section class="tile"><span class="label">Most improved</span><p><b>${skillMeta(w.best.id).name}</b> went from ${w.best.before}% to ${w.best.now}%.</p></section>` : ''}
    <section class="tile"><span class="label">Focus for next week</span><p><b>${skillMeta(focus).name}</b>, Lv ${state.skills[focus].level} (${skillMeta(focus).levels[state.skills[focus].level - 1]}).</p>
      <button class="cta small-cta" data-action="start" data-mode="skill" data-skill="${focus}">Start a ${skillMeta(focus).name.toLowerCase()} session</button></section>`
    : `<p class="muted center">No practice that week.</p>`}
  </main>${tabbar('progress')}`;
}

/* ================= SETTINGS ================= */
let confirmKey: string | null = null;

function settingsHome() {
  const s = state.settings;
  const link = (h: string, l: string, v: string) => `<a class="row" href="#${h}"><span>${l}</span><span class="v">${v} ›</span></a>`;
  return `<main class="screen">${header('Settings')}
    <section class="group">${link('settings-difficulty', 'Difficulty', s.offerStepUps ? 'step-up offers on' : 'manual only')}
      ${link('settings-rates', 'Exchange rates', s.rateMode === 'live' ? 'live' : rateAge() >= s.rateReminderDays ? `${rateAge()} days old` : 'up to date')}</section>
    <section class="group">${link('settings-session', 'Sessions', `${s.sessionLength} questions`)}${link('settings-marking', 'Marking and feedback', s.retries ? `${s.retries + 1} tries` : 'answer shown after a miss')}</section>
    <section class="group">${link('settings-habit', 'Reminders and streaks', s.reminderTime)}${link('settings-display', 'Display', s.theme === 'system' ? 'System' : s.theme === 'dark' ? 'Dark' : 'Light')}
      ${link('settings-data', 'Your data', 'export, reset')}${link('help', 'How it works', '')}</section>
    <p class="muted small center">Mental Math · v0.3</p>
  </main>${tabbar('settings')}`;
}

function difficultyView() {
  const s = state.settings;
  const lvChanges = state.changes.filter(c => c.what === 'level').slice(-10).reverse();
  return `<main class="screen">${backLink('settings', 'Settings')}${header('Difficulty')}
    ${SKILLS.map(m => { const sk = state.skills[m.id]; return `
      <section class="group skillset">
        <div class="row"><span><b>${m.name}</b></span>
          <span class="stepper"><button data-action="lv" data-skill="${m.id}" data-d="-1" aria-label="${m.name} level down" ${sk.level <= 1 ? 'disabled' : ''}>−</button>
          <b>Lv ${sk.level}</b><button data-action="lv" data-skill="${m.id}" data-d="1" aria-label="${m.name} level up" ${sk.level >= maxLevel(m.id) ? 'disabled' : ''}>+</button></span></div>
        <p class="muted small">${m.levels[sk.level - 1]}${sk.level < maxLevel(m.id) ? ` · next: ${m.levels[sk.level]}` : ' · top level'}</p>
        ${seg(`status:${m.id}`, sk.status, [['practise', 'Practise'], ['review', 'Review only'], ['pause', 'Pause']])}
      </section>`; }).join('')}
    <section class="group">
      ${toggle('offerStepUps', s.offerStepUps, 'Offer step-ups', 'The level only changes if you accept')}
      <div class="row"><span>Offer after</span><span class="v">
        <select data-num="stepUpPct" aria-label="Accuracy needed">${[80, 85, 90, 95, 100].map(v => `<option value="${v}" ${v === s.stepUpPct ? 'selected' : ''}>${v}%</option>`).join('')}</select>
        <select data-num="stepUpSessions" aria-label="Sessions needed">${[3, 4, 5, 7].map(v => `<option value="${v}" ${v === s.stepUpSessions ? 'selected' : ''}>${v} sessions</option>`).join('')}</select></span></div>
      ${toggle('autoStepDown', s.autoStepDown, 'Auto step-down', 'After two sessions under 50% at a level')}
    </section>
    <section class="tile"><span class="label">Level history</span>
      ${lvChanges.length ? lvChanges.map(c => `<div class="row"><span class="small">${esc(c.label)}</span><span class="v">${dateTxt(c.at)} · ${c.by}</span></div>`).join('') : '<p class="muted small">No level changes yet. Starting levels came from your practice chat.</p>'}
    </section></main>`;
}

function ratesView() {
  const r = state.rates, s = state.settings, d = derivedRates(r, s.roundRates), age = rateAge();
  return `<main class="screen">${backLink('settings', 'Settings')}${header('Rates')}
    <section class="group"><div class="col"><span>£ / $ / € rates</span>${seg('rateMode', s.rateMode, [['manual', 'Set by me'], ['live', 'Live, daily']])}
      <small class="sub">Live uses European Central Bank rates, updated once a day. Toman is always set by you.</small></div>
      <button class="row linkish" data-action="fetch-rates">Get today's £/$/€ rates now</button></section>
    <form class="group" id="rates-form">
      <label class="row"><span>£1 = $</span><input id="r-gbpUsd" inputmode="decimal" value="${r.gbpUsd}"></label>
      <label class="row"><span>€1 = £</span><input id="r-eurGbp" inputmode="decimal" value="${r.eurGbp}"></label>
      <label class="row"><span>£1 = Toman</span><input id="r-gbpToman" inputmode="numeric" value="${r.gbpToman}"></label>
      <button class="cta small-cta" type="submit">Save rates</button>
    </form>
    <p class="small center ${age >= s.rateReminderDays ? 'accent' : 'muted'}">Last set ${dateTxt(r.setAt, { day: 'numeric', month: 'short', year: 'numeric' })} (${age === 0 ? 'today' : plural(age, 'day') + ' ago'}${r.source === 'live' ? ', live' : ''})</p>
    <section class="tile"><span class="label">Worked out from these</span>
      <div class="row"><span>€1 = $</span><span class="v">${fmt(d.eurUsd, 4)}</span></div>
      <div class="row"><span>$1 = Toman</span><span class="v">${fmt(d.usdToman, 0)}</span></div>
      <div class="row"><span>€1 = Toman</span><span class="v">${fmt(d.eurToman, 0)}</span></div></section>
    <section class="group">
      ${toggle('roundRates', s.roundRates, 'Round rates for mental maths', 'e.g. 1.2734 becomes 1.27')}
      <div class="col"><span>Toman answers in</span>${seg('tomanUnit', s.tomanUnit, [['million', 'Millions'], ['thousand', 'Thousands'], ['full', 'Full']])}</div>
      <div class="row"><span>Remind me to update Toman</span><select data-num="rateReminderDays">${[3, 7, 14, 30].map(v => `<option value="${v}" ${v === s.rateReminderDays ? 'selected' : ''}>every ${v} days</option>`).join('')}</select></div>
    </section>
    <section class="tile"><span class="label">Rate history</span>
      ${[...state.rateHistory].reverse().slice(0, 10).map(h => `<div class="row"><span class="small">£1 = $${h.gbpUsd} · €1 = £${fmt(h.eurGbp, 4)} · ${short(h.gbpToman)} T</span><span class="v">${dateTxt(h.setAt)}${h.source === 'live' ? ' · live' : ''}</span></div>`).join('')}
      <p class="muted small">Each answer is marked against the rate it was asked with, so changing rates never rewrites your history.</p></section>
    <p id="toast-anchor"></p></main>`;
}

function sessionSettingsView() {
  const s = state.settings;
  return `<main class="screen">${backLink('settings', 'Settings')}${header('Sessions')}
    <section class="group">
      <div class="col"><span>Questions in today's session</span>${seg('sessionLength', String(s.sessionLength), [['5', '5'], ['10', '10'], ['15', '15'], ['20', '20']])}</div>
      <div class="col"><span>Skill mix</span>${seg('mix', s.mix, [['focus', 'Weak-spot focus'], ['even', 'Even']])}</div>
      <div class="col"><span>Two-step questions</span>${seg('twoStep', s.twoStep, [['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often']])}</div>
      ${toggle('friendly', s.friendly, 'Friendly numbers only', 'Answers land on whole numbers where possible')}
    </section>
    <p class="muted small">Weak-spot focus: about 40% from your weakest skill, up to 20% review of earlier misses, the rest spread across your other skills.</p>
  </main>`;
}

function markingView() {
  const s = state.settings;
  return `<main class="screen">${backLink('settings', 'Settings')}${header('Marking')}
    <section class="group">
      <div class="col"><span>After a wrong answer</span>${seg('retries', String(s.retries), [['0', 'Show answer'], ['1', '1 retry'], ['2', '2 retries']])}</div>
      ${toggle('minimalFeedback', s.minimalFeedback, 'Quick feedback', 'Just "Correct." and move on. Off: show the method and a Next button')}
      ${toggle('showExactOnClose', s.showExactOnClose, 'Show the exact figure after a close answer')}
      ${toggle('showTimer', s.showTimer, 'Show a timer')}
    </section>
    <section class="group"><span class="label pad-top">Close-answer tolerance · counts as correct</span>
      ${SKILLS.map(m => `<div class="row"><span>${m.name}</span><select data-tol="${m.id}" aria-label="${m.name} tolerance">${[0, 1, 2, 3, 5].map(v => `<option value="${v}" ${v === s.tolerance[m.id] ? 'selected' : ''}>${v === 0 ? 'exact only' : '±' + v + '%'}</option>`).join('')}</select></div>`).join('')}
      <div class="row"><span>Estimates<small class="sub">When you tap ≈ Estimate, or the question says an estimate is welcome</small></span><select data-num="estimateTolerance" aria-label="Estimate tolerance">${[5, 10, 15, 20].map(v => `<option value="${v}" ${v === s.estimateTolerance ? 'selected' : ''}>±${v}%</option>`).join('')}</select></div>
    </section></main>`;
}

function habitView() {
  const s = state.settings, st = streak(state);
  const ics = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(reminderICS(s.reminderTime, location.href.split('#')[0]));
  return `<main class="screen">${backLink('settings', 'Settings')}${header('Habit')}
    <section class="group">
      <label class="row"><span>Daily reminder time</span><input type="time" id="reminder-time" value="${s.reminderTime}"></label>
      <a class="row linkish" href="${ics}">Add the daily reminder to my calendar</a>
      <p class="muted small pad-b">This adds a repeating 10-minute event to your iPhone calendar, with an alert and a link back here. Web apps can't send their own notifications without a server, so a calendar alert is the reliable way.</p>
    </section>
    <section class="group">
      ${toggle('weeklyReview', s.weeklyReview, 'Weekly review', 'A summary card on Today each Monday')}
      ${toggle('quietMode', s.quietMode, 'Quiet mode', 'No award or personal-best messages after sessions')}
    </section>
    <section class="tile"><span class="label">Streak freezes</span>
      <p class="small">You get one freeze each week (Monday to Sunday). If you miss a single day, it's used automatically and your streak carries on. ${st.freezeLeft ? 'This week\'s freeze is still available.' : 'This week\'s freeze has been used.'}</p></section>
  </main>`;
}

function displayView() {
  const s = state.settings;
  return `<main class="screen">${backLink('settings', 'Settings')}${header('Display')}
    <section class="group">
      <div class="col"><span>Theme</span>${seg('theme', s.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div class="col"><span>Keypad</span>${seg('keypad', s.keypad, [['phone', 'Phone (1 2 3 on top)'], ['calculator', 'Calculator (7 8 9)']])}</div>
    </section></main>`;
}

function dataView() {
  return `<main class="screen">${backLink('settings', 'Settings')}${header('Your data')}
    <section class="tile">
      <div class="row"><span>Answers</span><span class="v">${state.attempts.length}</span></div>
      <div class="row"><span>Sessions</span><span class="v">${state.sessions.length}</span></div>
      <div class="row"><span>Review queue</span><span class="v">${state.reviews.length}</span></div></section>
    <section class="group">
      <button class="row linkish" data-action="export">Export answers as CSV</button>
      <button class="row linkish" data-action="copy">Copy CSV to clipboard</button></section>
    <p class="muted small">Everything is stored on this phone only. iPhone can clear a web app's data if it isn't opened for several weeks, so export now and then.</p>
    <section class="group">
      <div class="row"><span>Reset one skill</span><select id="reset-skill">${SKILLS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select></div>
      ${confirmKey === 'reset' ? `<div class="btns"><button data-action="cancel">Cancel</button><button class="p" data-action="reset-yes">Reset its history</button></div>`
        : `<button class="row linkish" data-action="reset">Reset this skill's history…</button>`}
      ${confirmKey === 'wipe' ? `<div class="btns"><button data-action="cancel">Cancel</button><button class="p" data-action="wipe-yes">Delete everything</button></div>`
        : `<button class="row linkish danger" data-action="wipe">Delete all data…</button>`}
    </section></main>`;
}

function helpView() {
  const s = state.settings;
  const qa = (q: string, a: string) => `<details class="arow"><summary><span class="aq">${q}</span></summary><div class="adet"><p class="small">${a}</p></div></details>`;
  return `<main class="screen">${backLink('settings', 'Settings')}${header('How it works')}
    <section class="tile">
      ${qa('How is an answer marked?', `Exact is correct. Within ±${s.tolerance.mul}% also counts as correct (adjust per skill in Marking), and you'll see the exact figure. A stray zero is always wrong.`)}
      ${qa('What does ≈ Estimate do?', `Tap it before answering when you only want to estimate. Within ±${s.estimateTolerance}% counts as a good estimate. Estimates count as correct, but they build mastery a bit more slowly than exact answers, so step-ups still need precise answers. Some questions say "Estimate welcome", and those accept estimates automatically.`)}
      ${qa('What happens when I get one wrong?', 'You see the correct answer and a short explanation, then tap Next. The same kind of question comes back in review after 1, 3 and 7 days until you get it right first time. You can allow retries in Marking.')}
      ${qa('Can I skip?', 'Yes. Tap Skip, or use ⋯ during a session. You\'ll see the answer and the method, and it goes into review.')}
      ${qa('How do levels go up?', `Never on their own. After ${s.stepUpPct}%+ first-try accuracy for ${s.stepUpSessions} sessions at a level, you're offered a step-up. You can also set any level by hand in Difficulty.`)}
      ${qa('What is mastery?', 'Your first-try accuracy over your last 30 answers at the current level, with recent answers counting more.')}
      ${qa('How do streak freezes work?', 'One missed day per week is covered automatically, so a busy day doesn\'t reset your streak.')}
      ${qa('Where do the rates come from?', 'Your own practice rates, or live £/$/€ rates from the European Central Bank (Settings › Exchange rates). Every currency question shows the rate it uses.')}
    </section></main>`;
}

/* ================= router ================= */
function render() {
  applyTheme();
  const h = location.hash.slice(1) || 'home';
  if (h !== 'session' && run) clearInterval(run.timer);
  if (h !== 'week') weekOffset = null;
  let view: () => string;
  if (h.startsWith('skill-') && SKILL_IDS.includes(h.slice(6) as SkillId)) view = () => skillDetail(h.slice(6) as SkillId);
  else if (h.startsWith('s-')) view = () => sessionDetail(h.slice(2));
  else view = ({
    home, practice: practiceView, session: sessionView, done: doneView, progress: progressView, 'progress-skills': skillsView,
    'progress-history': historyView, 'progress-awards': awardsView, week: weekView, help: helpView, settings: settingsHome,
    'settings-difficulty': difficultyView, 'settings-rates': ratesView, 'settings-session': sessionSettingsView, 'settings-marking': markingView,
    'settings-habit': habitView, 'settings-display': displayView, 'settings-data': dataView,
  } as Record<string, () => string>)[h] ?? home;
  const y = window.scrollY;
  app.innerHTML = view() + (menuOpen && h !== 'session' ? menuSheet() : '') + '<p id="toast" class="toast" role="status"></p>';
  app.dataset.view = h.split('-')[0];
  if (render.lastHash === h) window.scrollTo(0, y); else window.scrollTo(0, 0);
  render.lastHash = h;
  if (h === 'session' && run && state.settings.showTimer) {
    clearInterval(run.timer);
    run.timer = window.setInterval(() => { const t = document.getElementById('timer'); if (t && run) t.textContent = Math.floor((performance.now() - run.qStart) / 1000) + 's'; }, 500);
  }
  if (h === 'session' && !run) go('home');
  if (toastQueue.length) { const m = toastQueue.shift()!; setTimeout(() => toast(m), 50); }
}
render.lastHash = '';

function toast(msg: string) {
  const t = document.getElementById('toast'); if (!t) { toastQueue.push(msg); return; }
  t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2400);
}

function setSetting(name: string, val: string) {
  const s = state.settings as unknown as Record<string, unknown>;
  if (name.startsWith('status:')) {
    const id = name.split(':')[1] as SkillId; const from = state.skills[id].status; if (from === val) return;
    state.skills[id].status = val as State['skills'][SkillId]['status'];
    logChange(state, 'setting', `${skillMeta(id).name}: ${from} → ${val}`);
  } else {
    const before = s[name]; const v = ['sessionLength', 'retries'].includes(name) ? Number(val) : val; if (before === v) return;
    s[name] = v; logChange(state, 'setting', `${name}: ${before} → ${v}`);
    if (name === 'rateMode' && v === 'live') void refreshLiveRates(true);
  }
  persist(); render();
}

function setRates(next: { gbpUsd: number; eurGbp: number; gbpToman: number }, source: 'manual' | 'live') {
  const r = state.rates, parts: string[] = [];
  if (next.gbpUsd !== r.gbpUsd) parts.push(`£/$ ${r.gbpUsd} → ${next.gbpUsd}`);
  if (Math.abs(next.eurGbp - r.eurGbp) > 1e-9) parts.push(`€/£ ${fmt(r.eurGbp, 4)} → ${fmt(next.eurGbp, 4)}`);
  if (next.gbpToman !== r.gbpToman) parts.push(`£/Toman ${short(r.gbpToman)} → ${short(next.gbpToman)}`);
  // live updates keep the Toman date, so the Toman reminder still works
  state.rates = { ...next, setAt: source === 'live' && next.gbpToman === r.gbpToman ? r.setAt : new Date().toISOString(), source };
  if (parts.length || source === 'manual') { state.rateHistory.push({ ...state.rates, setAt: new Date().toISOString() }); logChange(state, 'rate', parts.length ? parts.join(', ') : 'Rates confirmed', source === 'live' ? 'live' : 'you'); }
  persist();
}

async function refreshLiveRates(force = false) {
  if (!force && (state.settings.rateMode !== 'live' || (state.lastLiveFetch && Date.now() - Date.parse(state.lastLiveFetch) < 20 * 3600e3))) return;
  const live = await fetchLiveRates();
  if (!live) { if (force) toast("Couldn't reach the rates service. Try again later."); return; }
  const round = state.settings.roundRates;
  state.lastLiveFetch = new Date().toISOString();
  setRates({ gbpUsd: round ? r2(live.gbpUsd) : +live.gbpUsd.toFixed(4), eurGbp: round ? r2(live.eurGbp) : +live.eurGbp.toFixed(4), gbpToman: state.rates.gbpToman }, 'live');
  if (force) toast(`Updated: £1 = $${state.rates.gbpUsd}, €1 = £${state.rates.eurGbp}`);
  render();
}

/* ================= events ================= */
app.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest('button,[data-key],a[data-action],.overlay[data-action]') as HTMLElement | null;
  if (!t) return;
  if (t.dataset.key) { keyPress(t.dataset.key); return; }
  if (t.dataset.set) { setSetting(t.dataset.set, t.dataset.val!); return; }
  const a = t.dataset.action;
  if (!a) return;
  if (t.classList.contains('overlay') && e.target !== t) return;
  switch (a) {
    case 'menu': menuOpen = true; render(); break;
    case 'close-menu': menuOpen = false; if (t.tagName !== 'A') render(); break;
    case 'start': menuOpen = false; startSession(t.dataset.mode as SessionMode, t.dataset.skill as SkillId | undefined); break;
    case 'enter': enter(); break;
    case 'next': next(); break;
    case 'reveal': reveal(false); break;
    case 'skip': reveal(true); break;
    case 'hint': if (run) { run.hint = !run.hint; run.sheet = null; render(); } break;
    case 'estimate': if (run) { run.est = !run.est; run.sheet = null; render(); } break;
    case 'smenu': if (run) { run.sheet = 'menu'; render(); } break;
    case 'sheet-close': if (run) { run.sheet = null; render(); } break;
    case 'timer': state.settings.showTimer = !state.settings.showTimer; persist(); if (run) run.sheet = null; render(); break;
    case 'restart': if (run) { run.sheet = 'restart'; render(); } break;
    case 'restart-yes': if (run) { const { mode, req } = run; finishQuiet(); startSession(mode, req.skill); } break;
    case 'quit': if (run) { run.sheet = 'quit'; render(); } break;
    case 'quit-no': if (run) { run.sheet = null; render(); } break;
    case 'quit-yes': finish(); break;
    case 'stepup': case 'decline': {
      const id = t.dataset.skill as SkillId; const sk = state.skills[id];
      if (a === 'stepup' && sk.level < maxLevel(id)) { logChange(state, 'level', `${skillMeta(id).name} Lv ${sk.level} → ${sk.level + 1}`, 'offer'); sk.level++; checkAwards(state); }
      else sk.declinedAt = day();
      if (lastRun) lastRun.offer = null; persist(); render(); toast(a === 'stepup' ? `${skillMeta(id).name} is now level ${sk.level}.` : 'OK. Asking again in a week.'); break;
    }
    case 'lv': {
      const id = t.dataset.skill as SkillId; const sk = state.skills[id]; const to = sk.level + Number(t.dataset.d);
      if (to < 1 || to > maxLevel(id)) return;
      logChange(state, 'level', `${skillMeta(id).name} Lv ${sk.level} → ${to}`); sk.level = to; persist(); render(); break;
    }
    case 'week-prev': weekOffset = (weekOffset ?? 0) - 1; render(); break;
    case 'week-next': if ((weekOffset ?? 0) < 0) { weekOffset = (weekOffset ?? 0) + 1; render(); } break;
    case 'fetch-rates': void refreshLiveRates(true); break;
    case 'export': {
      const blob = new Blob([toCSV(state)], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `mental-math-${day()}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000); break;
    }
    case 'copy': navigator.clipboard?.writeText(toCSV(state)).then(() => toast('Copied.'), () => toast("Couldn't copy. Try Export instead.")); break;
    case 'reset': confirmKey = 'reset'; render(); break;
    case 'wipe': confirmKey = 'wipe'; render(); break;
    case 'cancel': confirmKey = null; render(); break;
    case 'reset-yes': {
      const id = (document.getElementById('reset-skill') as HTMLSelectElement).value as SkillId;
      state.attempts = state.attempts.filter(x => x.skill !== id); state.reviews = state.reviews.filter(x => x.skill !== id);
      logChange(state, 'setting', `${skillMeta(id).name} history reset`); confirmKey = null; persist(); render(); toast('Skill history reset.'); break;
    }
    case 'wipe-yes': state = freshState(); confirmKey = null; persist(); go('home'); break;
  }
});

/** End a session without the results screen (used by Restart) */
function finishQuiet() {
  if (!run) return;
  const r = run; clearInterval(r.timer); clearTimeout(r.advance);
  if (r.rows.length) state.sessions.push({ id: r.id, mode: r.mode, label: r.label, startedAt: r.startedAt, endedAt: new Date().toISOString(), total: r.rows.length,
    correct: r.rows.filter(x => isRight(x.result)).length, firstTry: r.rows.filter(x => isRight(x.result) && x.tries === 1).length, ms: Math.round(r.rows.reduce((t, x) => t + x.ms, 0)) });
  persist(); run = null;
}

app.addEventListener('change', e => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const s = state.settings as unknown as Record<string, unknown>;
  if (el instanceof HTMLInputElement && el.dataset.toggle) {
    const k = el.dataset.toggle; logChange(state, 'setting', `${k}: ${s[k] ? 'on' : 'off'} → ${el.checked ? 'on' : 'off'}`); s[k] = el.checked; persist(); render();
  } else if (el.dataset.num) {
    const k = el.dataset.num; const v = Number(el.value); logChange(state, 'setting', `${k}: ${s[k]} → ${v}`); s[k] = v; persist(); render();
  } else if (el.dataset.tol) {
    const id = el.dataset.tol as SkillId; const v = Number(el.value);
    logChange(state, 'setting', `${skillMeta(id).name} tolerance ±${state.settings.tolerance[id]}% → ±${v}%`); state.settings.tolerance[id] = v; persist(); render();
  } else if (el.id === 'reminder-time' && el.value) {
    state.settings.reminderTime = el.value; persist(); render(); toast('Reminder time saved. Add it to your calendar again to update the alert.');
  }
});

app.addEventListener('submit', e => {
  e.preventDefault();
  if ((e.target as HTMLElement).id !== 'rates-form') return;
  const num = (id: string) => parseFloat((document.getElementById(id) as HTMLInputElement).value.replace(/,/g, ''));
  const next = { gbpUsd: num('r-gbpUsd'), eurGbp: num('r-eurGbp'), gbpToman: num('r-gbpToman') };
  if (Object.values(next).some(v => !isFinite(v) || v <= 0)) { toast('Each rate needs to be a number above 0.'); return; }
  if (state.settings.rateMode === 'live' && (next.gbpUsd !== state.rates.gbpUsd || next.eurGbp !== state.rates.eurGbp)) {
    state.settings.rateMode = 'manual'; logChange(state, 'setting', 'rateMode: live → manual');
  }
  setRates(next, 'manual'); render(); toast('Rates saved.');
});

app.addEventListener('pointerover', e => {
  const r = (e.target as Element).closest('[data-tip]') as SVGRectElement | null; const box = (e.target as Element).closest('.chartbox') as HTMLElement | null;
  const tip = box?.querySelector('.tip') as HTMLElement | null; if (!box || !tip) return;
  if (!r) { tip.hidden = true; return; }
  const bb = box.getBoundingClientRect(), rb = r.getBoundingClientRect();
  tip.textContent = r.dataset.tip!; tip.style.left = `${Math.min(Math.max(rb.left - bb.left + rb.width / 2, 80), bb.width - 80)}px`; tip.style.top = `${rb.top - bb.top}px`; tip.hidden = false;
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (menuOpen) { menuOpen = false; render(); } else if (run?.sheet) { run.sheet = null; render(); } return; }
  if (location.hash !== '#session' || !run || run.sheet) return;
  if (/^[0-9.]$/.test(e.key)) keyPress(e.key);
  else if (e.key === 'Backspace') keyPress('⌫');
  else if (e.key === 'Enter') { if (run.phase === 'reveal' || run.phase === 'right') next(); else enter(); }
  else if (e.key.toLowerCase() === 'e') { run.est = !run.est; render(); }
});

window.addEventListener('hashchange', () => { menuOpen = false; render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);
render();
void refreshLiveRates();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').then(reg => reg.update()).catch(() => {}));
}

(window as unknown as { mm: unknown }).mm = { get state() { return state; }, get run() { return run; } };
