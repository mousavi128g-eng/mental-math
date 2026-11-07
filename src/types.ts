export type SkillId = 'mul' | 'pct' | 'fx' | 'toman' | 'div';
/** exact / close (within tolerance) / estimate (answered as an estimate, within the wider estimate tolerance) / wrong / skipped */
export type Result = 'exact' | 'close' | 'estimate' | 'wrong' | 'skipped';
export type SkillStatus = 'practise' | 'pause' | 'review';
export type SessionMode = 'daily' | 'quick' | 'skill' | 'estimate' | 'review' | 'weak';

export interface Rates {
  gbpUsd: number;   // £1 = $x
  eurGbp: number;   // €1 = £x
  gbpToman: number; // £1 = x Toman
  setAt: string;    // ISO date of last change
  source?: 'manual' | 'live';
}

export interface Question {
  skill: SkillId;
  level: number;
  kind: string;          // pattern id used for review, e.g. "mul-2x2"
  title: string;         // one-line instruction, e.g. "Convert to dollars"
  prompt: string;        // the sum itself
  context?: string;      // rate or fact needed, e.g. "£1 = $1.27"
  unit?: string;         // shown inside the answer field, e.g. "$"
  answer: number;
  hint: string;          // short method, shown on Hint and after a miss
  estimateOk?: boolean;  // an estimate is the expected way to answer
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
  tries: number;
  ms: number;
  at: string;
  review: boolean;
  estimate?: boolean;
}

export interface Session {
  id: string;
  mode: SessionMode;
  label: string;
  startedAt: string;
  endedAt: string;
  total: number;
  correct: number;
  firstTry: number;
  ms: number;
}

export interface SkillState { level: number; status: SkillStatus; declinedAt?: string }

export interface ReviewItem { skill: SkillId; level: number; kind: string; due: string; step: number }

export interface Change { at: string; what: 'level' | 'rate' | 'setting'; label: string; by: 'you' | 'offer' | 'auto' | 'live' }

export interface Settings {
  sessionLength: number;
  mix: 'focus' | 'even';
  twoStep: 'never' | 'sometimes' | 'often';
  friendly: boolean;
  tolerance: Record<SkillId, number>;
  estimateTolerance: number;          // percent, used when you answer as an estimate
  retries: number;                    // extra tries before the answer is shown
  minimalFeedback: boolean;
  showExactOnClose: boolean;
  showTimer: boolean;
  offerStepUps: boolean;
  stepUpPct: number;
  stepUpSessions: number;
  autoStepDown: boolean;
  tomanUnit: 'million' | 'thousand' | 'full';
  roundRates: boolean;
  rateReminderDays: number;
  rateMode: 'manual' | 'live';        // live = £/$ and €/£ fetched daily; Toman stays manual
  keypad: 'phone' | 'calculator';
  theme: 'system' | 'light' | 'dark';
  quietMode: boolean;                 // no award or personal-best pop-ups
  weeklyReview: boolean;
  reminderTime: string;               // "08:15"
}

export interface PersonalBests {
  fastestClean?: { ms: number; at: string; total: number };
  longestRun?: { n: number; at: string };
  bestWeek?: { pct: number; week: string };
}

export interface State {
  version: 2;
  settings: Settings;
  rates: Rates;
  rateHistory: Rates[];
  lastLiveFetch?: string;
  skills: Record<SkillId, SkillState>;
  attempts: Attempt[];
  sessions: Session[];
  reviews: ReviewItem[];
  changes: Change[];
  awards: Record<string, string>;     // award id → date earned
  pbs: PersonalBests;
  lastWeeklySeen?: string;            // monday of the week whose review was opened
}
