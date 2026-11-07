import { describe, expect, it } from 'vitest';
import { generate, twoStep } from './generate';
import { mark, plan, stepUpCandidate, updateReviews, mastery, streak, addDays, day, checkAwards } from './logic';
import { estimateQuestion } from './generate';
import { SKILLS } from './skills';
import { freshState } from '../store';

const st = freshState();
const o = { rates: st.rates, friendly: true, tomanUnit: 'million' as const, roundRates: true };

describe('generator', () => {
  for (const s of SKILLS) s.levels.forEach((name, i) => {
    it(`${s.name} Lv ${i + 1} (${name}) gives sane questions`, () => {
      for (let k = 0; k < 300; k++) {
        const q = generate(s.id, i + 1, o);
        expect(Number.isFinite(q.answer)).toBe(true);
        expect(q.answer).toBeGreaterThan(0);
        expect(q.prompt.length).toBeGreaterThan(2);
        // friendly: at most 2 decimals, and whole numbers for most skills
        expect(Math.round(q.answer * 100) / 100).toBeCloseTo(q.answer, 6);
      }
    });
  });
  it('$ → £ lands on whole pounds with the default rate', () => {
    for (let k = 0; k < 200; k++) expect(Number.isInteger(generate('fx', 2, o).answer)).toBe(true);
  });
  it('two-step works', () => { expect(twoStep(o).answer).toBeGreaterThan(0); });
});

describe('marking', () => {
  const q = { skill: 'mul' as const, level: 4, kind: 'mul-2x2', title: 'Multiply', prompt: '34 × 23', answer: 782, hint: '' };
  it('exact, close and wrong', () => {
    expect(mark(q, 782, 2)).toBe('exact');
    expect(mark(q, 790, 2)).toBe('close');
    expect(mark(q, 7820, 2)).toBe('wrong'); // a stray zero is always wrong
    expect(mark(q, 790, 0)).toBe('wrong');
    expect(mark(q, null, 2)).toBe('wrong');
    expect(mark(q, 830, 2, true, 10)).toBe('estimate');   // ~6% off, answered as an estimate
    expect(mark(q, 830, 2, false, 10)).toBe('wrong');     // same answer, not flagged as an estimate
    expect(mark({ ...q, estimateOk: true }, 830, 2, false, 10)).toBe('estimate');
  });
});

describe('planner and adaptivity', () => {
  it('plans the requested number of questions', () => {
    const s = freshState();
    for (const n of [5, 10, 20]) { s.settings.sessionLength = n; expect(plan(s)).toHaveLength(n); }
  });
  it('never plans paused skills', () => {
    const s = freshState(); s.skills.toman.status = 'pause';
    for (let k = 0; k < 30; k++) expect(plan(s).some(q => q.skill === 'toman')).toBe(false);
  });
  it('queues a miss and clears it after three good reviews', () => {
    const s = freshState(); const q = generate('mul', 4, o);
    updateReviews(s, q, 'wrong', 3); expect(s.reviews).toHaveLength(1);
    for (let k = 0; k < 3; k++) updateReviews(s, { ...q, review: true }, 'exact', 1);
    expect(s.reviews).toHaveLength(0);
  });
  it('offers a step-up only after enough strong sessions', () => {
    const s = freshState();
    const add = (sid: string, ok: boolean) => s.attempts.push({ id: Math.random() + '', sessionId: sid, skill: 'pct', level: 4, kind: 'pct-new',
      prompt: '', answer: 1, given: 1, result: ok ? 'exact' : 'wrong', tries: 1, ms: 3000, at: new Date().toISOString(), review: false });
    for (let i = 0; i < 4; i++) { add('s' + i, true); add('s' + i, true); }
    expect(stepUpCandidate(s)).toBe(null);
    add('s4', true); add('s4', true);
    expect(stepUpCandidate(s)).toBe('pct');
    s.settings.offerStepUps = false; expect(stepUpCandidate(s)).toBe(null);
    expect(mastery(s.attempts, 'pct', 4)).toBe(100);
  });
});

describe('questions are clear', () => {
  it('every question has an instruction, and every conversion shows its rate', () => {
    for (const s of SKILLS) s.levels.forEach((_, i) => {
      for (let k = 0; k < 100; k++) {
        const q = generate(s.id, i + 1, o);
        expect(q.title.length).toBeGreaterThan(3);
        expect(q.hint.length).toBeGreaterThan(5);
        if (s.id === 'fx' || s.id === 'toman') expect(q.context ?? '').toMatch(/=/);
      }
    });
    for (let k = 0; k < 100; k++) { const q = estimateQuestion(o); expect(q.estimateOk).toBe(true); expect(q.answer).toBeGreaterThan(0); }
  });
});

describe('session modes', () => {
  it('builds each mode', () => {
    const s = freshState();
    expect(plan(s, { mode: 'quick' })).toHaveLength(5);
    expect(plan(s, { mode: 'skill', skill: 'toman' }).every(q => q.skill === 'toman')).toBe(true);
    expect(plan(s, { mode: 'estimate' }).every(q => q.estimateOk)).toBe(true);
    expect(plan(s, { mode: 'review' })).toHaveLength(0);
    updateReviews(s, generate('fx', 2, o), 'wrong', 1);
    expect(plan(s, { mode: 'review' }).every(q => q.kind === 'fx-usd-gbp' && q.review)).toBe(true);
  });
});

describe('streak freezes', () => {
  it('covers one missed day per week', () => {
    const s = freshState(); const t = day();
    const mk = (d: string) => s.sessions.push({ id: d, mode: 'daily', label: '', startedAt: d + 'T12:00:00', endedAt: d + 'T12:05:00', total: 10, correct: 10, firstTry: 10, ms: 1 });
    mk(t); mk(addDays(t, -1)); mk(addDays(t, -3)); mk(addDays(t, -4));
    expect(streak(s).count).toBe(4);
    checkAwards(s); expect(s.awards.first).toBeTruthy();
  });
});
