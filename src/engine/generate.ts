import type { Question, Rates, SkillId } from '../types';

export type Rng = () => number;

export interface GenOptions {
  rates: Rates;
  friendly: boolean;
  tomanUnit: 'million' | 'thousand' | 'full';
  roundRates: boolean;
}

type QBody = Omit<Question, 'skill' | 'level'>;
type Gen = (rng: Rng, o: GenOptions) => QBody;

const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;
export const r2 = (n: number) => Math.round(n * 100) / 100;
const sig3 = (n: number) => { const p = Math.pow(10, Math.floor(Math.log10(n)) - 2); return Math.round(n / p) * p; };

export const fmt = (n: number, dp = 2) => n.toLocaleString('en-GB', { maximumFractionDigits: dp });

/** "12m", "750k", "1.5bn" style for big figures */
export const short = (n: number) => {
  if (n >= 1e9) return fmt(n / 1e9) + 'bn';
  if (n >= 1e6) return fmt(n / 1e6) + 'm';
  if (n >= 1e4) return fmt(n / 1e3) + 'k';
  return fmt(n);
};
/** "12 million", "750,000" for spoken-style Toman amounts */
export const words = (n: number) => (n >= 1e6 ? `${fmt(n / 1e6)} million` : fmt(n));

export function derivedRates(r: Rates, round: boolean) {
  const eurUsd = r.eurGbp * r.gbpUsd;
  const usdToman = r.gbpToman / r.gbpUsd;
  const eurToman = r.gbpToman * r.eurGbp;
  return {
    eurUsd: round ? r2(eurUsd) : eurUsd,
    usdToman: round ? sig3(usdToman) : usdToman,
    eurToman: round ? sig3(eurToman) : eurToman,
  };
}

const splitHint = (a: number, b: number) => {
  const t = Math.floor(b / 10) * 10, u = b - t;
  return u === 0 || t === 0
    ? `${a} × ${b} = ${fmt(a * b)}`
    : `Split ${b} into ${t} + ${u}: ${a} × ${t} = ${fmt(a * t)}, ${a} × ${u} = ${fmt(a * u)}. Add them: ${fmt(a * b)}.`;
};

/* ---------------- multiplication ---------------- */
const MUL: Gen[] = [
  rng => { const a = int(rng, 3, 12), b = int(rng, 3, 12);
    return { kind: 'mul-tables', title: 'Multiply', prompt: `${a} × ${b}`, answer: a * b, hint: `${a} × ${b} = ${a * b}.` }; },
  rng => { let a = int(rng, 12, 99); if (a % 10 === 0) a++;
    const t = Math.floor(a / 10), u = a % 10, d = t + u;
    return { kind: 'mul-x11', title: 'Multiply by 11', prompt: `${a} × 11`, answer: a * 11,
      hint: `Write ${t} _ ${u} and put ${t} + ${u} = ${d} in the middle${d > 9 ? ' (carry the 1 onto the first digit)' : ''}: ${fmt(a * 11)}.` }; },
  rng => { let a = int(rng, 12, 99); if (a % 10 === 0) a++; const b = int(rng, 3, 9);
    const t = Math.floor(a / 10) * 10, u = a - t;
    return { kind: 'mul-2x1', title: 'Multiply', prompt: `${a} × ${b}`, answer: a * b,
      hint: `${t} × ${b} = ${t * b}, ${u} × ${b} = ${u * b}. Add them: ${a * b}.` }; },
  rng => { let a = int(rng, 12, 39), b = int(rng, 11, 29); if (a % 10 === 0) a++; if (b % 10 === 0) b++;
    if (b > a) [a, b] = [b, a];
    return { kind: 'mul-2x2', title: 'Multiply', prompt: `${a} × ${b}`, answer: a * b, hint: splitHint(a, b) }; },
  rng => { const f = pick(rng, [1.2, 1.25, 1.5]); const step = f === 1.2 ? 5 : f === 1.25 ? 4 : 2;
    const a = step * int(rng, Math.ceil(20 / step), Math.floor(480 / step));
    const part = f === 1.2 ? 'a fifth' : f === 1.25 ? 'a quarter' : 'a half';
    return { kind: 'mul-factor', title: 'Multiply', prompt: `${a} × ${f}`, answer: r2(a * f),
      hint: `× ${f} means "add ${part}": ${a} + ${fmt(a * (f - 1))} = ${fmt(a * f)}.` }; },
  rng => { const a = int(rng, 101, 399), b = int(rng, 11, 29);
    return { kind: 'mul-3x2', title: 'Multiply', prompt: `${a} × ${b}`, answer: a * b, hint: splitHint(a, b), estimateOk: true }; },
];

/* ---------------- percentages ---------------- */
const PCT: Gen[] = [
  rng => { const p = pick(rng, [10, 5, 1]); const step = p === 10 ? 10 : p === 5 ? 20 : 100;
    const a = step * int(rng, 2, Math.floor(9900 / step));
    return { kind: 'pct-basic', title: 'Find the percentage', prompt: `${p}% of ${fmt(a)}`, answer: (a * p) / 100,
      hint: p === 10 ? `10% = divide by 10: ${fmt(a / 10)}.` : p === 5 ? `10% is ${fmt(a / 10)}; 5% is half of that: ${fmt(a / 20)}.` : `1% = divide by 100: ${fmt(a / 100)}.` }; },
  rng => { const p = pick(rng, [15, 20, 25, 30, 35, 40, 45, 60, 75]); const a = 20 * int(rng, 2, 100);
    return { kind: 'pct-any', title: 'Find the percentage', prompt: `${p}% of ${fmt(a)}`, answer: (a * p) / 100,
      hint: `10% of ${fmt(a)} is ${fmt(a / 10)}, 5% is ${fmt(a / 20)}. Build ${p}% from those: ${fmt(a * p / 100)}.` }; },
  rng => { const p = pick(rng, [5, 10, 15, 20, 25, 30, 40, 50]); const up = rng() < 0.5; const a = 20 * int(rng, 2, 50);
    const b = a * (1 + (up ? p : -p) / 100);
    return { kind: 'pct-change', title: `What's the % ${up ? 'increase' : 'decrease'}?`, prompt: `${fmt(a)} → ${fmt(b)}`,
      context: 'Answer as a percentage', unit: '%', answer: p,
      hint: `Change ÷ starting value × 100: ${fmt(Math.abs(b - a))} ÷ ${fmt(a)} × 100 = ${p}%.` }; },
  rng => { const p = pick(rng, [5, 10, 15, 20, 25, 30, 40]); const up = rng() < 0.6; const a = 20 * int(rng, 2, 100);
    const b = a * (1 + (up ? p : -p) / 100);
    return { kind: 'pct-new', title: `${up ? 'Increase' : 'Decrease'} by ${p}%`, prompt: `${fmt(a)} ${up ? '+' : '−'} ${p}%`, answer: b,
      context: 'What is the new value?',
      hint: `${p}% of ${fmt(a)} is ${fmt(a * p / 100)}. ${fmt(a)} ${up ? '+' : '−'} ${fmt(a * p / 100)} = ${fmt(b)}.` }; },
  rng => { if (rng() < 0.6) { const net = 5 * int(rng, 4, 200); const gross = net * 1.2;
      return { kind: 'pct-vat', title: 'Remove the VAT', prompt: `£${fmt(gross)}`, context: 'Price includes 20% VAT. What was it before VAT?', unit: '£', answer: net,
        hint: `Divide by 1.2 (don't just take 20% off): £${fmt(gross)} ÷ 1.2 = £${fmt(net)}.` }; }
    const p = pick(rng, [10, 20, 25, 50]); const step = p === 10 ? 10 : p === 20 ? 5 : p === 25 ? 4 : 2;
    const before = step * 5 * int(rng, 2, 40); const after = before * (1 + p / 100);
    return { kind: 'pct-reverse', title: 'Undo the increase', prompt: `${fmt(after)} after +${p}%`, context: 'What was it before the rise?', answer: before,
      hint: `Divide by ${1 + p / 100}: ${fmt(after)} ÷ ${1 + p / 100} = ${fmt(before)}.` }; },
];

/* ---------------- currency ---------------- */
const CUR: Record<string, string> = { '£': 'pounds', '$': 'dollars', '€': 'euros' };

/** amount (from) × rate = to. "rateText" describes the rate as people quote it. */
function convert(rng: Rng, o: GenOptions, from: string, to: string, factor: number, rateText: string, kind: string, step: number, multiply: boolean): QBody {
  let amount = 0, answer = 0;
  for (let i = 0; i < 40; i++) {
    if (multiply) { amount = step * int(rng, 1, Math.floor(2000 / step)); answer = r2(amount * factor); }
    else { answer = step * int(rng, 1, Math.floor(2000 / step)); amount = r2(answer * factor); }
    if (!o.friendly || isWhole(multiply ? answer : amount)) break;
  }
  const hint = multiply
    ? `Multiply by the rate: ${from}${fmt(amount)} × ${fmt(factor, 4)} = ${to}${fmt(answer)}.`
    : `Divide by the rate: ${from}${fmt(amount)} ÷ ${fmt(factor, 4)} = ${to}${fmt(answer)}. (Dividing by ${factor > 1 ? 'more than 1 makes the number smaller' : 'less than 1 makes the number bigger'}.)`;
  return { kind, title: `Convert to ${CUR[to]}`, prompt: `${from}${fmt(amount)} → ${to}`, context: rateText, unit: to, answer, hint };
}

const FX: Gen[] = [
  (rng, o) => convert(rng, o, '£', '$', o.rates.gbpUsd, `£1 = $${fmt(o.rates.gbpUsd, 4)}`, 'fx-gbp-usd', 100, true),
  (rng, o) => convert(rng, o, '$', '£', o.rates.gbpUsd, `£1 = $${fmt(o.rates.gbpUsd, 4)}`, 'fx-usd-gbp', 100, false),
  (rng, o) => rng() < 0.5
    ? convert(rng, o, '€', '£', o.rates.eurGbp, `€1 = £${fmt(o.rates.eurGbp, 4)}`, 'fx-eur-gbp', 100, true)
    : convert(rng, o, '£', '€', o.rates.eurGbp, `€1 = £${fmt(o.rates.eurGbp, 4)}`, 'fx-gbp-eur', 20, false),
  (rng, o) => { const d = derivedRates(o.rates, o.roundRates);
    return rng() < 0.5
      ? convert(rng, o, '€', '$', d.eurUsd, `€1 = $${fmt(d.eurUsd, 4)}`, 'fx-eur-usd', 25, true)
      : convert(rng, o, '$', '€', d.eurUsd, `€1 = $${fmt(d.eurUsd, 4)}`, 'fx-usd-eur', 25, false); },
  (rng, o) => { const e = 100 * int(rng, 1, 20); const g = r2(e * o.rates.eurGbp); const usd = r2(g * o.rates.gbpUsd);
    return { kind: 'fx-cross', title: 'Convert to dollars (via pounds)', prompt: `€${fmt(e)} → $`,
      context: `€1 = £${fmt(o.rates.eurGbp, 4)} and £1 = $${fmt(o.rates.gbpUsd, 4)}`, unit: '$', answer: usd, estimateOk: true,
      hint: `First to pounds: €${fmt(e)} × ${o.rates.eurGbp} = £${fmt(g)}. Then to dollars: £${fmt(g)} × ${o.rates.gbpUsd} = $${fmt(usd)}.` }; },
];

/* ---------------- Toman ---------------- */
function tomanOut(t: number, unit: GenOptions['tomanUnit']) {
  if (unit === 'million') return { answer: r2(t / 1e6), unit: 'million T', label: ' (in millions)', said: `${fmt(t / 1e6)} million` };
  if (unit === 'thousand') return { answer: Math.round(t / 1000), unit: 'thousand T', label: ' (in thousands)', said: `${fmt(Math.round(t / 1000))} thousand` };
  return { answer: Math.round(t), unit: 'T', label: '', said: fmt(Math.round(t)) };
}

const TOMAN: Gen[] = [
  (rng, o) => { const g = pick(rng, [10, 20, 25, 40, 50, 100, 150, 200, 250, 500]); const t = g * o.rates.gbpToman; const out = tomanOut(t, o.tomanUnit);
    return { kind: 'toman-gbp', title: `Convert to Toman${out.label}`, prompt: `£${fmt(g)} → Toman`,
      context: `£1 = ${fmt(o.rates.gbpToman)} Toman`, unit: out.unit, answer: out.answer,
      hint: `£${fmt(g)} × ${fmt(o.rates.gbpToman)} = ${fmt(t)} Toman, which is ${out.said}.` }; },
  (rng, o) => { const g = pick(rng, [10, 20, 25, 40, 50, 100, 200, 500]); const t = g * o.rates.gbpToman;
    return { kind: 'toman-to-gbp', title: 'Convert to pounds', prompt: `${words(t)} Toman → £`,
      context: `£1 = ${fmt(o.rates.gbpToman)} Toman`, unit: '£', answer: g,
      hint: `Divide by the rate: ${fmt(t)} ÷ ${fmt(o.rates.gbpToman)} = £${g}. Tip: knock the same zeros off both numbers first.` }; },
  rng => { if (rng() < 0.5) { const t = 1000 * pick(rng, [5, 12, 25, 45, 80, 150, 300, 750]);
      return { kind: 'toman-rial', title: 'Convert to Rial', prompt: `${fmt(t)} Toman → Rial`, context: '1 Toman = 10 Rial', unit: 'Rial', answer: t * 10, hint: 'Rial = Toman × 10, so add a zero.' }; }
    const r = 10000 * pick(rng, [5, 12, 25, 45, 80, 150, 300]);
    return { kind: 'toman-rial', title: 'Convert to Toman', prompt: `${fmt(r)} Rial → Toman`, context: '1 Toman = 10 Rial', unit: 'T', answer: r / 10, hint: 'Toman = Rial ÷ 10, so drop a zero.' }; },
  (rng, o) => { const d = derivedRates(o.rates, o.roundRates); const usd = rng() < 0.6;
    const amt = pick(rng, [10, 20, 50, 100, 200]); const rate = usd ? d.usdToman : d.eurToman; const t = amt * rate;
    const c = usd ? '$' : '€'; const out = tomanOut(t, o.tomanUnit);
    return { kind: usd ? 'toman-usd' : 'toman-eur', title: `Convert to Toman${out.label}`, prompt: `${c}${amt} → Toman`,
      context: `${c}1 = ${fmt(rate)} Toman`, unit: out.unit, answer: out.answer, estimateOk: true,
      hint: `${amt} × ${fmt(rate)} = ${fmt(t)} Toman, which is ${out.said}.` }; },
];

/* ---------------- division and estimation ---------------- */
const DIV: Gen[] = [
  rng => { const b = int(rng, 3, 12), c = int(rng, 4, 99);
    return { kind: 'div-clean', title: 'Divide', prompt: `${fmt(b * c)} ÷ ${b}`, answer: c, hint: `${b} × ${c} = ${fmt(b * c)}, so the answer is ${c}.` }; },
  rng => { const b = pick(rng, [4, 5, 6, 8, 12, 15, 25]); const a = int(rng, 1000, 9999);
    const near = Math.round(a / b / 10) * 10 * b;
    return { kind: 'div-estimate', title: 'Estimate', prompt: `${fmt(a)} ÷ ${b}`, context: 'Roughly. A close estimate is fine.', answer: Math.round(a / b), estimateOk: true,
      hint: `Round to a number that divides nicely: ${fmt(near)} ÷ ${b} = ${fmt(near / b)}. Exact: ${fmt(a / b, 1)}.` }; },
  rng => { if (rng() < 0.5) { const m = 250 * int(rng, 4, 40); const y = m * 12;
      return { kind: 'div-per-month', title: 'Per month', prompt: `£${fmt(y)} a year`, context: 'How much is that per month?', unit: '£', answer: m, hint: `Divide by 12: £${fmt(y)} ÷ 12 = £${fmt(m)}.` }; }
    const n = pick(rng, [8, 12, 16, 24, 25, 40]); const each = 5 * int(rng, 2, 60);
    return { kind: 'div-per-unit', title: 'Price each', prompt: `£${fmt(n * each)} for ${n} items`, context: 'How much is each one?', unit: '£', answer: each, hint: `£${fmt(n * each)} ÷ ${n} = £${each}.` }; },
  rng => { const big = rng() < 0.6; const head = pick(rng, [1.2, 1.5, 2.4, 3.6, 4.8, 6]); const a = head * (big ? 1e6 : 1e9);
    const b = pick(rng, big ? [200, 300, 400, 600, 1200] : [2000, 3000, 4000, 6000]);
    return { kind: 'div-magnitude', title: 'Divide big numbers', prompt: `${short(a)} ÷ ${fmt(b)}`, context: big ? 'm = million' : 'bn = billion', answer: a / b,
      hint: `Write it out and cancel zeros: ${fmt(a)} ÷ ${fmt(b)} = ${fmt(a / b)}.` }; },
];

const TABLE: Record<SkillId, Gen[]> = { mul: MUL, pct: PCT, fx: FX, toman: TOMAN, div: DIV };

export function generate(skill: SkillId, level: number, o: GenOptions, rng: Rng = Math.random): Question {
  const gens = TABLE[skill];
  const g = gens[Math.max(0, Math.min(gens.length - 1, level - 1))];
  return { skill, level, ...g(rng, o) };
}

/** Two-step, work-style question: apply a % change, then convert £ → $ */
export function twoStep(o: GenOptions, rng: Rng = Math.random): Question {
  const p = pick(rng, [10, 20, 25, 50]); const up = rng() < 0.6; const a = 100 * int(rng, 2, 20);
  const g = a * (1 + (up ? p : -p) / 100); const ans = r2(g * o.rates.gbpUsd);
  return { skill: 'fx', level: 0, kind: 'two-step', title: `${up ? 'Increase' : 'Decrease'} by ${p}%, then convert to dollars`,
    prompt: `£${fmt(a)} ${up ? '+' : '−'} ${p}% → $`, context: `£1 = $${fmt(o.rates.gbpUsd, 4)}`, unit: '$', answer: ans, estimateOk: true,
    hint: `First the %: £${fmt(a)} ${up ? '+' : '−'} ${p}% = £${fmt(g)}. Then × ${o.rates.gbpUsd} = $${fmt(ans)}.` };
}

/** A question of the same pattern (used by the review queue) */
export function similar(skill: SkillId, level: number, kind: string, o: GenOptions, rng: Rng = Math.random): Question {
  let q = generate(skill, level, o, rng);
  for (let i = 0; i < 12 && q.kind !== kind; i++) q = generate(skill, level, o, rng);
  return { ...q, review: true };
}

/** Questions built for estimating: big, awkward numbers where a close answer is the goal */
export function estimateQuestion(o: GenOptions, rng: Rng = Math.random): Question {
  const k = int(rng, 0, 4);
  if (k === 0) { const a = int(rng, 41, 98), b = int(rng, 41, 98);
    return { skill: 'mul', level: 0, kind: 'est-mul', title: 'Estimate', prompt: `${a} × ${b}`, context: 'Round both numbers, then multiply.', answer: a * b, estimateOk: true,
      hint: `About ${Math.round(a / 10) * 10} × ${Math.round(b / 10) * 10} = ${fmt(Math.round(a / 10) * 10 * Math.round(b / 10) * 10)}. Exact: ${fmt(a * b)}.` }; }
  if (k === 1) { const a = int(rng, 1200, 9800); const p = pick(rng, [12, 17, 23, 35, 45]);
    return { skill: 'pct', level: 0, kind: 'est-pct', title: 'Estimate', prompt: `${p}% of ${fmt(a)}`, context: 'A close estimate is fine.', answer: r2(a * p / 100), estimateOk: true,
      hint: `10% is ${fmt(a / 10)}, so ${p}% is a bit ${p > 10 ? 'more' : 'less'} than that ×${fmt(p / 10, 1)}: about ${fmt(Math.round(a * p / 100))}.` }; }
  if (k === 2) { const g = int(rng, 130, 980);
    return { skill: 'fx', level: 0, kind: 'est-fx', title: 'Estimate in dollars', prompt: `£${fmt(g)} → $`, context: `£1 = $${fmt(o.rates.gbpUsd, 4)}`, unit: '$', answer: r2(g * o.rates.gbpUsd), estimateOk: true,
      hint: `Roughly add a quarter: £${fmt(g)} + ${fmt(Math.round(g / 4))} ≈ $${fmt(Math.round(g * 1.25))}. Exact: $${fmt(r2(g * o.rates.gbpUsd))}.` }; }
  if (k === 3) { const g = int(rng, 35, 480); const t = g * o.rates.gbpToman; const out = tomanOut(t, o.tomanUnit);
    return { skill: 'toman', level: 0, kind: 'est-toman', title: `Estimate in Toman${out.label}`, prompt: `£${fmt(g)} → Toman`, context: `£1 = ${fmt(o.rates.gbpToman)} Toman`,
      unit: out.unit, answer: out.answer, estimateOk: true, hint: `£${fmt(g)} × ${fmt(o.rates.gbpToman)} ≈ ${words(t)} Toman.` }; }
  const a = int(rng, 10000, 99000), b = pick(rng, [7, 12, 18, 24, 36]);
  return { skill: 'div', level: 0, kind: 'est-div', title: 'Estimate', prompt: `${fmt(a)} ÷ ${b}`, context: 'Round first. A close estimate is fine.', answer: Math.round(a / b), estimateOk: true,
    hint: `About ${fmt(Math.round(a / 1000) * 1000)} ÷ ${b} ≈ ${fmt(Math.round(Math.round(a / 1000) * 1000 / b))}. Exact: ${fmt(a / b, 1)}.` };
}
