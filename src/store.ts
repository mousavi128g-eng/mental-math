import type { Change, Settings, State } from './types';
import { SKILL_IDS } from './engine/skills';

const KEY = 'mental-math.v1';

export const DEFAULT_SETTINGS: Settings = {
  sessionLength: 10,
  mix: 'focus',
  twoStep: 'sometimes',
  friendly: true,
  tolerance: { mul: 2, pct: 2, fx: 2, toman: 2, div: 2 },
  retries: 2,
  minimalFeedback: true,
  showExactOnClose: true,
  showTimer: false,
  offerStepUps: true,
  stepUpPct: 90,
  stepUpSessions: 5,
  autoStepDown: false,
  tomanUnit: 'thousand',
  roundRates: true,
  rateReminderDays: 7,
  keypad: 'phone',
  theme: 'system',
};

export function freshState(): State {
  const rates = { gbpUsd: 1.27, eurGbp: 0.85, gbpToman: 300000, setAt: '2026-09-24T12:00:00.000Z' };
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    rates,
    rateHistory: [rates],
    // starting levels come from the practice-chat sessions
    skills: {
      mul: { level: 4, status: 'practise' },
      pct: { level: 4, status: 'practise' },
      fx: { level: 2, status: 'practise' },
      toman: { level: 1, status: 'practise' },
      div: { level: 2, status: 'practise' },
    },
    attempts: [], sessions: [], reviews: [], changes: [],
  };
}

export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw) as State;
    const base = freshState();
    // fill in anything added in later versions
    s.settings = { ...base.settings, ...s.settings, tolerance: { ...base.settings.tolerance, ...s.settings?.tolerance } };
    for (const id of SKILL_IDS) s.skills[id] ??= base.skills[id];
    return s;
  } catch { return freshState(); }
}

export function save(s: State) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
}

export function logChange(s: State, what: Change['what'], label: string, by: Change['by'] = 'you') {
  s.changes.push({ at: new Date().toISOString(), what, label, by });
}

export function toCSV(s: State): string {
  const head = ['at', 'session', 'skill', 'level', 'kind', 'question', 'answer', 'given', 'result', 'tries', 'seconds', 'review'];
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = s.attempts.map(a => [a.at, a.sessionId, a.skill, a.level, a.kind, a.prompt, a.answer, a.given, a.result, a.tries, (a.ms / 1000).toFixed(1), a.review]);
  return [head, ...rows].map(r => r.map(esc).join(',')).join('\n');
}
