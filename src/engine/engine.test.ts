import { describe, expect, it } from 'vitest';
import { generate, twoStep } from './generate';
import { mark, plan, stepUpCandidate, updateReviews, mastery } from './logic';
import { SKILLS } from './skills';
import { freshState } from '../store';

const st = freshState();
const o = { rates: st.rates, friendly: true, tomanUnit: 'thousand' as const, roundRates: true };

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
  const q = { skill: 'mul' as const, level: 4, kind: 'mul-2x2', prompt: '34 × 23', answer: 782, hint: '' };
  it('exact, close and wrong', () => {
    expect(mark(q, 782, 2)).toBe('exact');
    expect(mark(q, 790, 2)).toBe('close');
    expect(mark(q, 7820, 2)).toBe('wrong'); // a stray zero is always wrong
    expect(mark(q, 790, 0)).toBe('wrong');
    expect(mark(q, null, 2)).toBe('wrong');
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
