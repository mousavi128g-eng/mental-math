import type { Question, Rates, SkillId } from '../types';

export type Rng = () => number;

export interface GenOptions {
  rates: Rates;
  friendly: boolean;
  tomanUnit: 'thousand' | 'full';
  roundRates: boolean;
}

const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const sig3 = (n: number) => { const p = Math.pow(10, Math.floor(Math.log10(n)) - 2); return Math.round(n / p) * p; };

export const fmt = (n: number, dp = 2) =>
  n.toLocaleString('en-GB', { maximumFractionDigits: dp });

/** "12m", "750k", "1.5bn" style used for Toman and big figures */
export const short = (n: number) => {
  if (n >= 1e9) return fmt(n / 1e9) + 'bn';
  if (n >= 1e6) return fmt(n / 1e6) + 'm';
  if (n >= 1e4) return fmt(n / 1e3) + 'k';
  return fmt(n);
};

export function derivedRates(r: Rates, round: boolean) {
  const eurUsd = r.eurGbp * r.gbpUsd;
  const gbpEur = 1 / r.eurGbp;
  const usdToman = r.gbpToman / r.gbpUsd;
  const eurToman = r.gbpToman * r.eurGbp;
  return {
    eurUsd: round ? r2(eurUsd) : eurUsd,
    gbpEur: round ? r2(gbpEur) : gbpEur,
    usdToman: round ? sig3(usdToman) : usdToman,
    eurToman: round ? sig3(eurToman) : eurToman,
  };
}

type Gen = (rng: Rng, o: GenOptions) => Omit<Question, 'skill' | 'level'>;

const splitHint = (a: number, b: number) => {
  const t = Math.floor(b / 10) * 10, u = b - t;
  return u === 0 || t === 0
    ? `${a} × ${b} = ${fmt(a * b)}`
    : `Split the smaller number: ${a} × ${t} + ${a} × ${u} = ${fmt(a * t)} + ${fmt(a * u)} = ${fmt(a * b)}`;
};

const MUL: Gen[] = [
  rng => { const a = int(rng, 3, 12), b = int(rng, 3, 12);
    return { kind: 'mul-tables', prompt: `${a} × ${b}`, answer: a * b, hint: `${a} × ${b} = ${a * b}` }; },
  rng => { let a = int(rng, 12, 99); if (a % 10 === 0) a++;
    const d = Math.floor(a / 10) + (a % 10);
    return { kind: 'mul-x11', prompt: `${a} × 11`, answer: a * 11,
      hint: `Add the digits (${Math.floor(a / 10)} + ${a % 10} = ${d}) and put that in the middle${d > 9 ? ', carrying the 1' : ''}: ${fmt(a * 11)}` }; },
  rng => { let a = int(rng, 12, 99); if (a % 10 === 0) a++; const b = int(rng, 3, 9);
    return { kind: 'mul-2x1', prompt: `${a} × ${b}`, answer: a * b, hint: splitHint(b, a).replace(/^Split the smaller number/, 'Split the bigger number') }; },
  rng => { let a = int(rng, 12, 39), b = int(rng, 11, 29); if (a % 10 === 0) a++; if (b % 10 === 0) b++;
    if (b > a) [a, b] = [b, a];
    return { kind: 'mul-2x2', prompt: `${a} × ${b}`, answer: a * b, hint: splitHint(a, b) }; },
  rng => { const f = pick(rng, [1.2, 1.25, 1.5]); const step = f === 1.2 ? 5 : f === 1.25 ? 4 : 2;
    const a = step * int(rng, Math.ceil(20 / step), Math.floor(480 / step));
    const part = f === 1.2 ? 'a fifth' : f === 1.25 ? 'a quarter' : 'a half';
    return { kind: 'mul-factor', prompt: `${a} × ${f}`, answer: r2(a * f),
      hint: `× ${f} means add ${part}: ${a} + ${fmt(a * (f - 1))} = ${fmt(a * f)}` }; },
  rng => { const a = int(rng, 101, 399), b = int(rng, 11, 29);
    return { kind: 'mul-3x2', prompt: `${a} × ${b}`, answer: a * b, hint: splitHint(a, b) }; },
];

const PCT: Gen[] = [
  rng => { const p = pick(rng, [10, 5, 1]); const step = p === 10 ? 10 : p === 5 ? 20 : 100;
    const a = step * int(rng, 2, Math.floor(9900 / step));
    return { kind: 'pct-basic', prompt: `${p}% of ${fmt(a)}`, answer: (a * p) / 100,
      hint: p === 5 ? `10% is ${fmt(a / 10)}, and 5% is half of that: ${fmt(a / 20)}` : `${p}% of ${fmt(a)} = ${fmt(a * p / 100)}` }; },
  rng => { const p = pick(rng, [15, 20, 25, 30, 35, 40, 45, 60, 75]); const a = 20 * int(rng, 2, 100);
    return { kind: 'pct-any', prompt: `${p}% of ${fmt(a)}`, answer: (a * p) / 100,
      hint: `Build it from 10% (${fmt(a / 10)}) and 5% (${fmt(a / 20)}): ${p}% = ${fmt(a * p / 100)}` }; },
  rng => { const p = pick(rng, [5, 10, 15, 20, 25, 30, 40, 50]); const up = rng() < 0.5; const a = 20 * int(rng, 2, 50);
    const b = a * (1 + (up ? p : -p) / 100);
    return { kind: 'pct-change', prompt: `${fmt(a)} → ${fmt(b)}`, unit: `% ${up ? 'rise' : 'fall'}`, answer: p,
      hint: `Change ÷ start × 100: ${fmt(Math.abs(b - a))} ÷ ${fmt(a)} × 100 = ${p}%` }; },
  rng => { const p = pick(rng, [5, 10, 15, 20, 25, 30, 40]); const up = rng() < 0.6; const a = 20 * int(rng, 2, 100);
    const b = a * (1 + (up ? p : -p) / 100);
    return { kind: 'pct-new', prompt: `${fmt(a)} ${up ? '+' : '−'} ${p}%`, answer: b,
      hint: `${p}% of ${fmt(a)} is ${fmt(a * p / 100)}, so ${fmt(a)} ${up ? '+' : '−'} ${fmt(a * p / 100)} = ${fmt(b)}` }; },
  rng => { if (rng() < 0.6) { const net = 5 * int(rng, 4, 200); const gross = net * 1.2;
      return { kind: 'pct-vat', prompt: `£${fmt(gross)} incl. VAT`, unit: '£ before VAT', answer: net,
        hint: `Divide by 1.2, don't take 20% off: £${fmt(gross)} ÷ 1.2 = £${fmt(net)}` }; }
    const p = pick(rng, [10, 20, 25, 50]); const step = p === 10 ? 10 : p === 20 ? 5 : p === 25 ? 4 : 2;
    const before = step * 5 * int(rng, 2, 40);
    const after = before * (1 + p / 100);
    return { kind: 'pct-reverse', prompt: `${fmt(after)} after a ${p}% rise`, unit: 'before', answer: before,
      hint: `Divide by ${1 + p / 100}: ${fmt(after)} ÷ ${1 + p / 100} = ${fmt(before)}` }; },
];

function fxPair(rng: Rng, o: GenOptions, from: string, to: string, rate: number, kind: string, friendlyStep: number): ReturnType<Gen> {
  // pick an amount so the answer lands on a whole number where possible
  let amount = 0, answer = 0;
  for (let i = 0; i < 40; i++) {
    amount = friendlyStep * int(rng, 1, Math.floor(2000 / friendlyStep));
    answer = r2(amount * rate);
    if (!o.friendly || isWhole(answer)) break;
  }
  const hint = rate >= 1
    ? `${from}${fmt(amount)} × ${fmt(rate, 4)} = ${to}${fmt(answer)}`
    : `${from}${fmt(amount)} × ${fmt(rate, 4)} = ${to}${fmt(answer)} (the ${to} figure is smaller)`;
  return { kind, prompt: `${from}${fmt(amount)} → ${to}`, unit: to, answer, hint };
}

function fxReverse(rng: Rng, o: GenOptions, from: string, to: string, rate: number, kind: string, step: number): ReturnType<Gen> {
  // ask from→to where to = from ÷ rate; pick the answer first so the question is friendly
  let ans = 0, amount = 0;
  for (let i = 0; i < 40; i++) {
    ans = step * int(rng, 1, Math.floor(2000 / step));
    amount = r2(ans * rate);
    if (!o.friendly || isWhole(amount)) break;
  }
  return { kind, prompt: `${from}${fmt(amount)} → ${to}`, unit: to, answer: ans,
    hint: `Divide, don't multiply: ${from}${fmt(amount)} ÷ ${fmt(rate, 4)} = ${to}${fmt(ans)}` };
}

const FX: Gen[] = [
  (rng, o) => fxPair(rng, o, '£', '$', o.rates.gbpUsd, 'fx-gbp-usd', 100),
  (rng, o) => fxReverse(rng, o, '$', '£', o.rates.gbpUsd, 'fx-usd-gbp', 100),
  (rng, o) => rng() < 0.5 ? fxPair(rng, o, '€', '£', o.rates.eurGbp, 'fx-eur-gbp', 100)
                          : fxReverse(rng, o, '£', '€', o.rates.eurGbp, 'fx-gbp-eur', 20),
  (rng, o) => { const d = derivedRates(o.rates, o.roundRates);
    return rng() < 0.5 ? fxPair(rng, o, '€', '$', d.eurUsd, 'fx-eur-usd', 25)
                       : fxReverse(rng, o, '$', '€', d.eurUsd, 'fx-usd-eur', 25); },
  (rng, o) => { const d = derivedRates(o.rates, o.roundRates);
    const q = rng() < 0.5 ? fxPair(rng, o, '£', '€', d.gbpEur, 'fx-cross', 50)
                          : fxReverse(rng, o, '$', '£', o.rates.gbpUsd, 'fx-cross', 50);
    return q; },
];

const TOMAN: Gen[] = [
  (rng, o) => { const g = pick(rng, [10, 20, 25, 40, 50, 100, 150, 200, 250, 500]); const t = g * o.rates.gbpToman;
    const th = o.tomanUnit === 'thousand';
    return { kind: 'toman-gbp', prompt: `£${fmt(g)} → Toman`, unit: th ? 'thousand T' : 'Toman', answer: th ? t / 1000 : t,
      hint: `£${fmt(g)} × ${fmt(o.rates.gbpToman)} = ${short(t)} Toman${th ? ` (${fmt(t / 1000)} thousand)` : ''}` }; },
  (rng, o) => { const g = pick(rng, [10, 20, 25, 40, 50, 100, 200, 500]); const t = g * o.rates.gbpToman;
    return { kind: 'toman-to-gbp', prompt: `${short(t)} Toman → £`, unit: '£', answer: g,
      hint: `${short(t)} ÷ ${short(o.rates.gbpToman)} = £${g}` }; },
  rng => { if (rng() < 0.5) { const t = 1000 * pick(rng, [5, 12, 25, 45, 80, 150, 300, 750]);
      return { kind: 'toman-rial', prompt: `${fmt(t)} Toman → Rial`, unit: 'Rial', answer: t * 10, hint: 'Rial = Toman × 10 (add a zero)' }; }
    const r = 10000 * pick(rng, [5, 12, 25, 45, 80, 150, 300]);
    return { kind: 'toman-rial', prompt: `${fmt(r)} Rial → Toman`, unit: 'Toman', answer: r / 10, hint: 'Toman = Rial ÷ 10 (drop a zero)' }; },
  (rng, o) => { const d = derivedRates(o.rates, o.roundRates); const usd = rng() < 0.6;
    const amt = pick(rng, [10, 20, 50, 100, 200]); const rate = usd ? d.usdToman : d.eurToman; const t = amt * rate;
    const th = o.tomanUnit === 'thousand';
    return { kind: usd ? 'toman-usd' : 'toman-eur', prompt: `${usd ? '$' : '€'}${amt} → Toman`, unit: th ? 'thousand T' : 'Toman',
      answer: th ? Math.round(t / 1000) : Math.round(t),
      hint: `${usd ? '$1' : '€1'} ≈ ${fmt(rate)} Toman, so ${amt} × that ≈ ${short(t)}` }; },
];

const DIV: Gen[] = [
  rng => { const b = int(rng, 3, 12), c = int(rng, 4, 99);
    return { kind: 'div-clean', prompt: `${fmt(b * c)} ÷ ${b}`, answer: c, hint: `${b} × ${c} = ${fmt(b * c)}` }; },
  rng => { const b = pick(rng, [4, 5, 6, 8, 12, 15, 25]); const a = int(rng, 1000, 9999);
    return { kind: 'div-estimate', prompt: `${fmt(a)} ÷ ${b}`, unit: 'roughly', answer: Math.round(a / b),
      hint: `Round first: about ${fmt(Math.round(a / 100) * 100)} ÷ ${b} ≈ ${fmt(Math.round(a / b))}` }; },
  rng => { if (rng() < 0.5) { const m = 250 * int(rng, 4, 40); const y = m * 12;
      return { kind: 'div-per-month', prompt: `£${fmt(y)} a year`, unit: '£ per month', answer: m, hint: `÷ 12: £${fmt(y)} ÷ 12 = £${fmt(m)}` }; }
    const n = pick(rng, [8, 12, 16, 24, 25, 40]); const each = 5 * int(rng, 2, 60);
    return { kind: 'div-per-unit', prompt: `£${fmt(n * each)} for ${n}`, unit: '£ each', answer: each, hint: `£${fmt(n * each)} ÷ ${n} = £${each}` }; },
  rng => { const big = rng() < 0.6; const head = pick(rng, [1.2, 1.5, 2.4, 3.6, 4.8, 6]); const a = head * (big ? 1e6 : 1e9);
    const b = pick(rng, big ? [200, 300, 400, 600, 1200] : [2000, 3000, 4000, 6000]);
    return { kind: 'div-magnitude', prompt: `${short(a)} ÷ ${fmt(b)}`, answer: a / b,
      hint: `Cancel zeros first: ${short(a)} ÷ ${fmt(b)} = ${fmt(a / b)}` }; },
];

const TABLE: Record<SkillId, Gen[]> = { mul: MUL, pct: PCT, fx: FX, toman: TOMAN, div: DIV };

export function generate(skill: SkillId, level: number, o: GenOptions, rng: Rng = Math.random): Question {
  const gens = TABLE[skill];
  const g = gens[Math.max(0, Math.min(gens.length - 1, level - 1))];
  return { skill, level, ...g(rng, o) };
}

/** Two-step work-style question: % change, then convert £ → $ */
export function twoStep(o: GenOptions, rng: Rng = Math.random): Question {
  const p = pick(rng, [10, 20, 25, 50]); const up = rng() < 0.6; const a = 100 * int(rng, 2, 20);
  const g = a * (1 + (up ? p : -p) / 100); const ans = r2(g * o.rates.gbpUsd);
  return { skill: 'fx', level: 0, kind: 'two-step', prompt: `£${fmt(a)} ${up ? '+' : '−'} ${p}%`, unit: 'in $', answer: ans,
    hint: `First the %: £${fmt(g)}. Then × ${o.rates.gbpUsd}: $${fmt(ans)}` };
}

/** Regenerate a question of the same pattern (used by the review queue) */
export function similar(skill: SkillId, level: number, kind: string, o: GenOptions, rng: Rng = Math.random): Question {
  let q = generate(skill, level, o, rng);
  for (let i = 0; i < 12 && q.kind !== kind; i++) q = generate(skill, level, o, rng);
  return { ...q, review: true };
}
