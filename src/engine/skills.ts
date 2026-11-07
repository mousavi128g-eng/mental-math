import type { SkillId } from '../types';

export interface SkillMeta {
  id: SkillId;
  name: string;
  glyph: string;
  levels: string[]; // level n is levels[n-1]
}

export const SKILLS: SkillMeta[] = [
  { id: 'mul', name: 'Multiply', glyph: '×', levels: [
    'Tables to 12', '×11 trick', '2-digit × 1-digit', '2-digit × 2-digit', '× 1.2 / 1.25 / 1.5', '3-digit × 2-digit'] },
  { id: 'pct', name: 'Percent', glyph: '%', levels: [
    '10 / 5 / 1%', 'Any whole %', '% change', 'New value after % change', 'Reverse % (before VAT)'] },
  { id: 'fx', name: 'Currency', glyph: '£$', levels: [
    '£ → $', '$ → £', '€ ↔ £', '€ ↔ $', 'Cross-rates'] },
  { id: 'toman', name: 'Toman', glyph: 'T', levels: [
    '£ → Toman', 'Toman → £', 'Toman ↔ Rial', '$ and € → Toman'] },
  { id: 'div', name: 'Divide', glyph: '÷', levels: [
    'Clean division', 'Round and estimate', 'Per unit, per month', 'k / m / bn'] },
];

export const SKILL_IDS: SkillId[] = SKILLS.map(s => s.id);
export const skillMeta = (id: SkillId) => SKILLS.find(s => s.id === id)!;
export const maxLevel = (id: SkillId) => skillMeta(id).levels.length;
