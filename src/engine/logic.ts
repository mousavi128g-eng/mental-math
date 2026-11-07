import type { Attempt, Question, Result, ReviewItem, SkillId, State } from '../types';
import { SKILL_IDS, maxLevel, skillMeta } from './skills';
import { generate, similar, twoStep, type GenOptions, type Rng } from './generate';

/* ---------- dates ---------- */
export const day = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return day(d);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b.slice(0, 10) + 'T12:00:00').getTime() - new Date(a.slice(0, 10) + 'T12:00:00').getTime()) / 864e5);

/* ---------- marking ---------- */
export function mark(q: Question, given: number | null, tolPct: number): Result {
  if (given === null || Number.isNaN(given)) return 'wrong';
  if (Math.abs(given - q.answer) < 0.005) return 'exact';
  const tol = Math.max(tolPct, q.kind === 'div-estimate' ? 5 : 0);
  if (q.answer !== 0 && (Math.abs(given - q.answer) / Math.abs(q.answer)) * 100 <= tol) return 'close';
  return 'wrong';
}

/* ---------- mastery ---------- */
const score = (a: Attempt) => (a.result === 'wrong' ? 0 : a.tries === 1 ? 1 : 0.5);

export function mastery(attempts: Attempt[], skill: SkillId, level: number): number | null {
  const xs = attempts.filter(a => a.skill === skill && a.level === level).slice(-30).reverse();
  if (!xs.length) return null;
  let s = 0, w = 0;
  xs.forEach((a, i) => { const wt = Math.pow(0.93, i); s += score(a) * wt; w += wt; });
  return Math.round((100 * s) / w);
}

export function accuracy(attempts: Attempt[]) {
  if (!attempts.length) return null;
  return Math.round((100 * attempts.filter(a => a.result !== 'wrong' && a.tries === 1).length) / attempts.length);
}

/** First-try accuracy per recent session for one skill at one level (newest first) */
function sessionScores(state: State, skill: SkillId, level: number): number[] {
  const bySession = new Map<string, Attempt[]>();
  for (const a of state.attempts) {
    if (a.skill !== skill || a.level !== level) continue;
    (bySession.get(a.sessionId) ?? bySession.set(a.sessionId, []).get(a.sessionId)!).push(a);
  }
  return [...bySession.values()].reverse().map(xs => accuracy(xs) ?? 0);
}

export function stepUpCandidate(state: State): SkillId | null {
  const s = state.settings;
  if (!s.offerStepUps) return null;
  const today = day();
  for (const id of SKILL_IDS) {
    const sk = state.skills[id];
    if (sk.status !== 'practise' || sk.level >= maxLevel(id)) continue;
    if (sk.declinedAt && daysBetween(sk.declinedAt, today) < 7) continue;
    const recent = sessionScores(state, id, sk.level).slice(0, s.stepUpSessions);
    if (recent.length >= s.stepUpSessions && recent.every(p => p >= s.stepUpPct)) return id;
  }
  return null;
}

/** Returns skills that were stepped down (only when the setting is on) */
export function applyAutoStepDown(state: State): SkillId[] {
  if (!state.settings.autoStepDown) return [];
  const out: SkillId[] = [];
  for (const id of SKILL_IDS) {
    const sk = state.skills[id];
    if (sk.level <= 1) continue;
    const recent = sessionScores(state, id, sk.level).slice(0, 2);
    if (recent.length === 2 && recent.every(p => p < 50)) {
      state.changes.push({ at: new Date().toISOString(), what: 'level', by: 'auto',
        label: `${skillMeta(id).name} Lv ${sk.level} → ${sk.level - 1}` });
      sk.level -= 1; out.push(id);
    }
  }
  return out;
}

/* ---------- review queue ---------- */
const INTERVALS = [1, 3, 7];

export function updateReviews(state: State, q: Question, result: Result, tries: number) {
  const today = day();
  const i = state.reviews.findIndex(r => r.skill === q.skill && r.kind === q.kind && r.level === q.level);
  const firstTryRight = result !== 'wrong' && tries === 1;
  if (q.review && i >= 0) {
    const r = state.reviews[i];
    if (firstTryRight) {
      r.step += 1;
      if (r.step >= INTERVALS.length) state.reviews.splice(i, 1);
      else r.due = addDays(today, INTERVALS[r.step]);
    } else { r.step = 0; r.due = addDays(today, 1); }
    return;
  }
  if (!firstTryRight) {
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
  return active
    .map(id => ({ id, m: mastery(state.attempts, id, state.skills[id].level) ?? 60 }))
    .sort((a, b) => a.m - b.m)[0].id;
}

export function plan(state: State, rng: Rng = Math.random): Question[] {
  const s = state.settings, n = s.sessionLength, o = genOptions(state), today = day();
  let active = SKILL_IDS.filter(id => state.skills[id].status === 'practise');
  const qs: Question[] = [];

  // reviews first (up to 20%), skipping paused skills
  const due = state.reviews.filter(r => r.due <= today && state.skills[r.skill].status !== 'pause');
  for (const r of shuffle([...due], rng).slice(0, Math.max(1, Math.round(n * 0.2)))) {
    if (qs.length < n) qs.push(similar(r.skill, r.level, r.kind, o, rng));
  }
  if (!active.length) active = SKILL_IDS.filter(id => state.skills[id].status !== 'pause');
  if (!active.length) active = [...SKILL_IDS];

  // two-step questions
  const extra = s.twoStep === 'never' ? 0 : s.twoStep === 'sometimes' ? Math.max(1, Math.round(n / 10)) : Math.round(n * 0.3);
  for (let i = 0; i < extra && qs.length < n; i++) qs.push(twoStep(o, rng));

  // weak-spot focus
  const weak = weakest(state);
  if (s.mix === 'focus' && weak && active.includes(weak)) {
    const k = Math.round(n * 0.4);
    for (let i = 0; i < k && qs.length < n; i++) qs.push(generate(weak, state.skills[weak].level, o, rng));
  }
  // spread the rest evenly
  const order = shuffle([...active], rng);
  for (let i = 0; qs.length < n; i++) { const id = order[i % order.length]; qs.push(generate(id, state.skills[id].level, o, rng)); }

  // shuffle, then avoid the same prompt twice and the same skill three times in a row
  shuffle(qs, rng);
  for (let i = 1; i < qs.length; i++) {
    if (qs[i].prompt === qs[i - 1].prompt) qs[i] = generate(qs[i].skill, Math.max(1, qs[i].level), o, rng);
    if (i > 1 && qs[i].skill === qs[i - 1].skill && qs[i].skill === qs[i - 2].skill) {
      const j = qs.findIndex((x, k) => k > i && x.skill !== qs[i].skill);
      if (j > 0) [qs[i], qs[j]] = [qs[j], qs[i]];
    }
  }
  return qs;
}

/* ---------- streak + misc ---------- */
export function streak(state: State): { count: number; week: boolean[] } {
  const local = new Set(state.sessions.map(s => day(new Date(s.startedAt))));
  let d = day(), count = 0;
  if (!local.has(d)) d = addDays(d, -1);
  while (local.has(d)) { count++; d = addDays(d, -1); }
  // Monday-first week
  const now = new Date(); const dow = (now.getDay() + 6) % 7;
  const monday = addDays(day(), -dow);
  const week = Array.from({ length: 7 }, (_, i) => local.has(addDays(monday, i)));
  return { count, week };
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
