import type { Attempt, Question, Result, ReviewItem, Session, SessionMode, SkillId, State } from '../types';
import { SKILL_IDS, maxLevel, skillMeta } from './skills';
import { estimateQuestion, generate, similar, twoStep, type GenOptions, type Rng } from './generate';

/* ---------- dates ---------- */
export const day = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return day(d); };
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b.slice(0, 10) + 'T12:00:00').getTime() - new Date(a.slice(0, 10) + 'T12:00:00').getTime()) / 864e5);
export const mondayOf = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };
export const localDay = (isoTime: string) => day(new Date(isoTime));

export const isRight = (r: Result) => r === 'exact' || r === 'close' || r === 'estimate';

/* ---------- marking ---------- */
export function mark(q: Question, given: number | null, tolPct: number, asEstimate = false, estTolPct = 10): Result {
  if (given === null || Number.isNaN(given)) return 'wrong';
  if (Math.abs(given - q.answer) < 0.005) return 'exact';
  if (q.answer === 0) return 'wrong';
  const off = (Math.abs(given - q.answer) / Math.abs(q.answer)) * 100;
  if (off <= tolPct) return 'close';
  if ((asEstimate || q.estimateOk) && off <= estTolPct) return 'estimate';
  return 'wrong';
}

/* ---------- mastery ---------- */
const score = (a: Attempt) => {
  if (!isRight(a.result)) return 0;
  const base = a.result === 'estimate' ? 0.75 : 1;
  return a.tries === 1 ? base : base * 0.5;
};

export function mastery(attempts: Attempt[], skill: SkillId, level: number): number | null {
  const xs = attempts.filter(a => a.skill === skill && a.level === level).slice(-30).reverse();
  if (!xs.length) return null;
  let s = 0, w = 0;
  xs.forEach((a, i) => { const wt = Math.pow(0.93, i); s += score(a) * wt; w += wt; });
  return Math.round((100 * s) / w);
}

export function accuracy(attempts: Attempt[]) {
  if (!attempts.length) return null;
  return Math.round((100 * attempts.filter(a => isRight(a.result) && a.tries === 1).length) / attempts.length);
}

function sessionScores(state: State, skill: SkillId, level: number): number[] {
  const by = new Map<string, Attempt[]>();
  for (const a of state.attempts) {
    if (a.skill !== skill || a.level !== level) continue;
    if (!by.has(a.sessionId)) by.set(a.sessionId, []);
    by.get(a.sessionId)!.push(a);
  }
  return [...by.values()].filter(xs => xs.length >= 2).reverse().map(xs => accuracy(xs) ?? 0);
}

export function stepUpCandidate(state: State): SkillId | null {
  const s = state.settings;
  if (!s.offerStepUps) return null;
  for (const id of SKILL_IDS) {
    const sk = state.skills[id];
    if (sk.status !== 'practise' || sk.level >= maxLevel(id)) continue;
    if (sk.declinedAt && daysBetween(sk.declinedAt, day()) < 7) continue;
    const recent = sessionScores(state, id, sk.level).slice(0, s.stepUpSessions);
    if (recent.length >= s.stepUpSessions && recent.every(p => p >= s.stepUpPct)) return id;
  }
  return null;
}

export function applyAutoStepDown(state: State): SkillId[] {
  if (!state.settings.autoStepDown) return [];
  const out: SkillId[] = [];
  for (const id of SKILL_IDS) {
    const sk = state.skills[id];
    if (sk.level <= 1) continue;
    const recent = sessionScores(state, id, sk.level).slice(0, 2);
    if (recent.length === 2 && recent.every(p => p < 50)) {
      state.changes.push({ at: new Date().toISOString(), what: 'level', by: 'auto', label: `${skillMeta(id).name} Lv ${sk.level} → ${sk.level - 1}` });
      sk.level -= 1; out.push(id);
    }
  }
  return out;
}

/* ---------- review queue ---------- */
const INTERVALS = [1, 3, 7];

export function updateReviews(state: State, q: Question, result: Result, tries: number) {
  if (q.level <= 0) return; // estimation and two-step questions aren't queued
  const today = day();
  const i = state.reviews.findIndex(r => r.skill === q.skill && r.kind === q.kind && r.level === q.level);
  const good = isRight(result) && result !== 'estimate' && tries === 1;
  if (q.review && i >= 0) {
    const r = state.reviews[i];
    if (good) { r.step += 1; if (r.step >= INTERVALS.length) state.reviews.splice(i, 1); else r.due = addDays(today, INTERVALS[r.step]); }
    else { r.step = 0; r.due = addDays(today, 1); }
    return;
  }
  if (!isRight(result) || tries > 1) {
    const item: ReviewItem = { skill: q.skill, level: q.level, kind: q.kind, step: 0, due: addDays(today, 1) };
    if (i >= 0) state.reviews[i] = item; else state.reviews.push(item);
  }
}

/* ---------- planner ---------- */
function shuffle<T>(xs: T[], rng: Rng) {
  for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  return xs;
}

export function genOptions(state: State): GenOptions {
  const s = state.settings;
  return { rates: state.rates, friendly: s.friendly, tomanUnit: s.tomanUnit, roundRates: s.roundRates };
}

export function weakest(state: State): SkillId | null {
  const active = SKILL_IDS.filter(id => state.skills[id].status === 'practise');
  if (!active.length) return null;
  return active.map(id => ({ id, m: mastery(state.attempts, id, state.skills[id].level) ?? 60 })).sort((a, b) => a.m - b.m)[0].id;
}

export const dueReviews = (state: State) => state.reviews.filter(r => r.due <= day() && state.skills[r.skill].status !== 'pause');

function tidy(qs: Question[], o: GenOptions, rng: Rng) {
  shuffle(qs, rng);
  for (let i = 1; i < qs.length; i++) {
    if (qs[i].prompt === qs[i - 1].prompt && qs[i].level > 0) qs[i] = generate(qs[i].skill, qs[i].level, o, rng);
    if (i > 1 && qs[i].skill === qs[i - 1].skill && qs[i].skill === qs[i - 2].skill) {
      const j = qs.findIndex((x, k) => k > i && x.skill !== qs[i].skill);
      if (j > 0) [qs[i], qs[j]] = [qs[j], qs[i]];
    }
  }
  return qs;
}

export interface PlanRequest { mode: SessionMode; skill?: SkillId; n?: number }

export function plan(state: State, req: PlanRequest = { mode: 'daily' }, rng: Rng = Math.random): Question[] {
  const s = state.settings, o = genOptions(state);
  const n = req.n ?? (req.mode === 'quick' ? 5 : s.sessionLength);
  const lvl = (id: SkillId) => state.skills[id].level;

  if (req.mode === 'skill' && req.skill) return Array.from({ length: n }, () => generate(req.skill!, lvl(req.skill!), o, rng));
  if (req.mode === 'estimate') return Array.from({ length: n }, () => estimateQuestion(o, rng));
  if (req.mode === 'weak') { const w = weakest(state) ?? 'mul'; return Array.from({ length: n }, () => generate(w, lvl(w), o, rng)); }
  if (req.mode === 'review') {
    const pool = dueReviews(state).length ? dueReviews(state) : state.reviews;
    if (!pool.length) return [];
    return Array.from({ length: Math.min(n, Math.max(pool.length, 5)) }, (_, i) => { const r = pool[i % pool.length]; return similar(r.skill, r.level, r.kind, o, rng); });
  }

  // daily / quick: reviews, two-step, weak-spot focus, then an even spread
  let active = SKILL_IDS.filter(id => state.skills[id].status === 'practise');
  const qs: Question[] = [];
  for (const r of shuffle([...dueReviews(state)], rng).slice(0, Math.max(1, Math.round(n * 0.2)))) if (qs.length < n) qs.push(similar(r.skill, r.level, r.kind, o, rng));
  if (!active.length) active = SKILL_IDS.filter(id => state.skills[id].status !== 'pause');
  if (!active.length) active = [...SKILL_IDS];
  const extra = s.twoStep === 'never' || n < 8 ? 0 : s.twoStep === 'sometimes' ? Math.max(1, Math.round(n / 10)) : Math.round(n * 0.3);
  for (let i = 0; i < extra && qs.length < n; i++) qs.push(twoStep(o, rng));
  const weak = weakest(state);
  if (s.mix === 'focus' && weak && active.includes(weak)) for (let i = 0, k = Math.round(n * 0.4); i < k && qs.length < n; i++) qs.push(generate(weak, lvl(weak), o, rng));
  const order = shuffle([...active], rng);
  for (let i = 0; qs.length < n; i++) { const id = order[i % order.length]; qs.push(generate(id, lvl(id), o, rng)); }
  return tidy(qs, o, rng);
}

/* ---------- streak with freezes ---------- */
/** One missed day per Monday-to-Sunday week is covered automatically by a streak freeze. */
export function streak(state: State) {
  const days = new Set(state.sessions.map(s => localDay(s.startedAt)));
  const today = day();
  let d = days.has(today) ? today : addDays(today, -1);
  let count = 0; const frozenWeeks = new Set<string>(); const frozenDays: string[] = [];
  for (let guard = 0; guard < 2000; guard++) {
    if (days.has(d)) { count++; d = addDays(d, -1); continue; }
    const wk = mondayOf(d);
    // a gap can be frozen only if practice resumes before it (so it's a real gap, not the start)
    if (!frozenWeeks.has(wk) && days.has(addDays(d, -1)) && count > 0) { frozenWeeks.add(wk); frozenDays.push(d); d = addDays(d, -1); continue; }
    break;
  }
  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => { const x = addDays(monday, i); return days.has(x) ? 'on' : frozenDays.includes(x) ? 'frozen' : x > today ? 'future' : 'off'; });
  const freezeLeft = frozenWeeks.has(monday) ? 0 : 1;
  return { count, week, freezeLeft, practisedToday: days.has(today) };
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ---------- personal bests ---------- */
export interface PBNews { label: string; detail: string }

export function updatePBs(state: State, session: Session, atts: Attempt[]): PBNews[] {
  const news: PBNews[] = []; const pb = state.pbs;
  if (session.total >= 5 && session.firstTry === session.total && atts.every(a => a.result !== 'estimate')) {
    if (!pb.fastestClean || session.ms < pb.fastestClean.ms) {
      if (pb.fastestClean) news.push({ label: 'Fastest perfect session', detail: `${(session.ms / 1000).toFixed(0)}s, was ${(pb.fastestClean.ms / 1000).toFixed(0)}s` });
      pb.fastestClean = { ms: session.ms, at: session.startedAt, total: session.total };
    }
  }
  // longest run of first-try correct answers, across all sessions
  let run = 0, best = 0;
  for (const a of state.attempts) { run = isRight(a.result) && a.tries === 1 ? run + 1 : 0; best = Math.max(best, run); }
  if (best >= 5 && (!pb.longestRun || best > pb.longestRun.n)) {
    if (pb.longestRun) news.push({ label: 'Longest correct run', detail: `${best} in a row, was ${pb.longestRun.n}` });
    pb.longestRun = { n: best, at: session.startedAt };
  }
  // best week (at least 20 answers)
  const wk = mondayOf(localDay(session.startedAt));
  const inWeek = state.attempts.filter(a => mondayOf(localDay(a.at)) === wk);
  const acc = accuracy(inWeek);
  if (acc !== null && inWeek.length >= 20 && (!pb.bestWeek || acc > pb.bestWeek.pct)) {
    if (pb.bestWeek && pb.bestWeek.week !== wk) news.push({ label: 'Best week', detail: `${acc}% first try, was ${pb.bestWeek.pct}%` });
    pb.bestWeek = { pct: acc, week: wk };
  }
  return news;
}

/* ---------- awards ---------- */
export interface Award { id: string; name: string; how: string; test: (s: State) => boolean }

const answered = (s: State) => s.attempts.length;
export const AWARDS: Award[] = [
  { id: 'first', name: 'First session', how: 'Finish a session', test: s => s.sessions.length >= 1 },
  { id: 'perfect', name: 'Perfect 10', how: '10/10 on the first try', test: s => s.sessions.some(x => x.total >= 10 && x.firstTry === x.total) },
  { id: 'streak7', name: 'One week', how: '7-day streak', test: s => streak(s).count >= 7 },
  { id: 'streak30', name: 'One month', how: '30-day streak', test: s => streak(s).count >= 30 },
  { id: 'q100', name: '100 answers', how: 'Answer 100 questions', test: s => answered(s) >= 100 },
  { id: 'q500', name: '500 answers', how: 'Answer 500 questions', test: s => answered(s) >= 500 },
  { id: 'q1000', name: '1,000 answers', how: 'Answer 1,000 questions', test: s => answered(s) >= 1000 },
  { id: 'stepup', name: 'Levelled up', how: 'Accept a step-up', test: s => s.changes.some(c => c.what === 'level' && c.by === 'offer') },
  { id: 'mul2x2', name: '2-digit × 2-digit', how: '10 first-try 2d × 2d answers in a row', test: s => runOf(s, 'mul-2x2') >= 10 },
  { id: 'usdgbp', name: 'Divide, don\'t multiply', how: '5 first-try $ → £ answers in a row', test: s => runOf(s, 'fx-usd-gbp') >= 5 },
  { id: 'toman', name: 'Toman fluent', how: 'Reach Toman level 3', test: s => s.skills.toman.level >= 3 },
  { id: 'estimator', name: 'Good estimator', how: '20 good estimates', test: s => s.attempts.filter(a => a.result === 'estimate' || (a.estimate && isRight(a.result))).length >= 20 },
  { id: 'reviewer', name: 'Clean slate', how: 'Clear the review queue after 10+ answers', test: s => s.attempts.length >= 10 && s.reviews.length === 0 && s.attempts.some(a => a.review) },
];

function runOf(s: State, kind: string) {
  let run = 0, best = 0;
  for (const a of s.attempts) if (a.kind === kind) { run = isRight(a.result) && a.result !== 'estimate' && a.tries === 1 ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

export function checkAwards(state: State): Award[] {
  const fresh: Award[] = [];
  for (const a of AWARDS) if (!state.awards[a.id] && a.test(state)) { state.awards[a.id] = new Date().toISOString(); fresh.push(a); }
  return fresh;
}

/* ---------- weekly review ---------- */
export function weekSummary(state: State, monday: string) {
  const end = addDays(monday, 7), prevMon = addDays(monday, -7);
  const inRange = (a: Attempt, from: string, to: string) => { const d = localDay(a.at); return d >= from && d < to; };
  const cur = state.attempts.filter(a => inRange(a, monday, end));
  const prev = state.attempts.filter(a => inRange(a, prevMon, monday));
  const sessions = state.sessions.filter(s => { const d = localDay(s.startedAt); return d >= monday && d < end; });
  const days = new Set(sessions.map(s => localDay(s.startedAt))).size;
  const bySkill = SKILL_IDS.map(id => ({ id, now: accuracy(cur.filter(a => a.skill === id)), before: accuracy(prev.filter(a => a.skill === id)), n: cur.filter(a => a.skill === id).length }));
  const tried = bySkill.filter(x => x.n >= 3 && x.now !== null);
  const best = tried.length ? tried.reduce((a, b) => ((b.now! - (b.before ?? b.now!)) > (a.now! - (a.before ?? a.now!)) ? b : a)) : null;
  const worst = tried.length ? tried.reduce((a, b) => (b.now! < a.now! ? b : a)) : null;
  return { monday, cur, prev, sessions, days, acc: accuracy(cur), prevAcc: accuracy(prev), bySkill, best, worst,
    medianMs: median(cur.filter(a => isRight(a.result)).map(a => a.ms)) };
}
