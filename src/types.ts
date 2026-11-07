export type SkillId = 'mul' | 'pct' | 'fx' | 'toman' | 'div';
export type Result = 'exact' | 'close' | 'wrong';
export type SkillStatus = 'practise' | 'pause' | 'review';

export interface Rates {
  gbpUsd: number;   // £1 = $x
  eurGbp: number;   // €1 = £x
  gbpToman: number; // £1 = x Toman
  setAt: string;    // ISO date of last change
}

export interface Question {
  skill: SkillId;
  level: number;
  kind: string;          // pattern id used for review, e.g. "mul-2x2"
  prompt: string;        // what is shown
  unit?: string;         // shown after the answer field, e.g. "$", "k Toman"
  answer: number;
  hint: string;          // shown only on "Explain"
  review?: boolean;
}

export interface Attempt {
  id: string;
  sessionId: string;
  skill: SkillId;
  level: number;
  kind: string;
  prompt: string;
  answer: number;
  given: number | null;
  result: Result;
  tries: number;         // 1 = first try
  ms: number;
  at: string;
  review: boolean;
}

export interface Session {
  id: string;
  startedAt: string;
  endedAt: string;
  total: number;
  correct: number;      // final correct (any try)
  firstTry: number;
  ms: number;
}

export interface SkillState {
  level: number;
  status: SkillStatus;
  declinedAt?: string;  // step-up offer declined
}

export interface ReviewItem {
  skill: SkillId;
  level: number;
  kind: string;
  due: string;          // yyyy-mm-dd
  step: number;         // 0 → 1d, 1 → 3d, 2 → 7d
}

export interface Change {
  at: string;
  what: 'level' | 'rate' | 'setting';
  label: string;        // human readable, e.g. "Multiply Lv 4 → 5"
  by: 'you' | 'offer' | 'auto';
}

export interface Settings {
  sessionLength: number;
  mix: 'focus' | 'even';
  twoStep: 'never' | 'sometimes' | 'often';
  friendly: boolean;
  tolerance: Record<SkillId, number>; // percent
  retries: number;                    // extra tries after the first; 99 = unlimited
  minimalFeedback: boolean;
  showExactOnClose: boolean;
  showTimer: boolean;
  offerStepUps: boolean;
  stepUpPct: number;
  stepUpSessions: number;
  autoStepDown: boolean;
  tomanUnit: 'thousand' | 'full';
  roundRates: boolean;
  rateReminderDays: number;
  keypad: 'phone' | 'calculator';
  theme: 'system' | 'light' | 'dark';
}

export interface State {
  version: 1;
  settings: Settings;
  rates: Rates;
  rateHistory: Rates[];
  skills: Record<SkillId, SkillState>;
  attempts: Attempt[];
  sessions: Session[];
  reviews: ReviewItem[];
  changes: Change[];
}
