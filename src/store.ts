import type { Change, Settings, State } from './types';
import { SKILL_IDS } from './engine/skills';

const KEY = 'mental-math.v1';

export const DEFAULT_SETTINGS: Settings = {
  sessionLength: 10,
  mix: 'focus',
  twoStep: 'sometimes',
  friendly: true,
  tolerance: { mul: 2, pct: 2, fx: 2, toman: 2, div: 2 },
  estimateTolerance: 10,
  retries: 0,
  minimalFeedback: true,
  showExactOnClose: true,
  showTimer: false,
  offerStepUps: true,
  stepUpPct: 90,
  stepUpSessions: 5,
  autoStepDown: false,
  tomanUnit: 'million',
  roundRates: true,
  rateReminderDays: 7,
  rateMode: 'manual',
  keypad: 'phone',
  theme: 'system',
  quietMode: false,
  weeklyReview: true,
  reminderTime: '08:15',
};

export function freshState(): State {
  const rates = { gbpUsd: 1.27, eurGbp: 0.85, gbpToman: 300000, setAt: '2026-09-24T12:00:00.000Z', source: 'manual' as const };
  return {
    version: 2,
    settings: structuredClone(DEFAULT_SETTINGS),
    rates,
    rateHistory: [rates],
    skills: {
      mul: { level: 4, status: 'practise' },
      pct: { level: 4, status: 'practise' },
      fx: { level: 2, status: 'practise' },
      toman: { level: 1, status: 'practise' },
      div: { level: 2, status: 'practise' },
    },
    attempts: [], sessions: [], reviews: [], changes: [], awards: {}, pbs: {},
  };
}

export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    const base = freshState();
    const wasV1 = s.version !== 2;
    s.settings = { ...base.settings, ...s.settings, tolerance: { ...base.settings.tolerance, ...s.settings?.tolerance } };
    if (wasV1) { s.settings.retries = 0; s.settings.tomanUnit = 'million'; } // new defaults
    for (const id of SKILL_IDS) s.skills[id] ??= base.skills[id];
    s.awards ??= {}; s.pbs ??= {}; s.changes ??= []; s.reviews ??= []; s.rateHistory ??= [s.rates];
    for (const x of s.sessions ?? []) { x.mode ??= 'daily'; x.label ??= 'Daily session'; }
    s.version = 2;
    return s as State;
  } catch { return freshState(); }
}

export function save(s: State) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
}

export function logChange(s: State, what: Change['what'], label: string, by: Change['by'] = 'you') {
  s.changes.push({ at: new Date().toISOString(), what, label, by });
}

export function toCSV(s: State): string {
  const head = ['at', 'session', 'skill', 'level', 'kind', 'question', 'answer', 'given', 'result', 'as_estimate', 'tries', 'seconds', 'review'];
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = s.attempts.map(a => [a.at, a.sessionId, a.skill, a.level, a.kind, a.prompt, a.answer, a.given, a.result, a.estimate ? 'yes' : '', a.tries, (a.ms / 1000).toFixed(1), a.review]);
  return [head, ...rows].map(r => r.map(esc).join(',')).join('\n');
}

/** A repeating daily calendar event, as an .ics file */
export function reminderICS(time: string, url: string) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(h)}${p(m)}00`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mental Math//EN', 'BEGIN:VEVENT',
    `UID:mental-math-daily-${Date.now()}@mental-math`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${local}`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY', 'SUMMARY:Mental Math (10 minutes)', `URL:${url}`,
    `DESCRIPTION:Today's practice: ${url}`, 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Mental Math', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export async function fetchLiveRates(): Promise<{ gbpUsd: number; eurGbp: number } | null> {
  const urls = ['https://api.frankfurter.dev/v1/latest?base=GBP&symbols=USD,EUR', 'https://api.frankfurter.app/latest?from=GBP&to=USD,EUR'];
  for (const u of urls) {
    try {
      const r = await fetch(u); if (!r.ok) continue;
      const j = await r.json(); const usd = j?.rates?.USD, eur = j?.rates?.EUR;
      if (usd > 0 && eur > 0) return { gbpUsd: usd, eurGbp: 1 / eur };
    } catch { /* try the next one */ }
  }
  return null;
}
