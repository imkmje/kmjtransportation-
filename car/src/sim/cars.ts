// 차의 능력치·등급·원가·수명(설계서 5장, 6.3, 7.3). 모두 순수 함수.
import { config } from '../config';
import { BODIES, OPTIONS, POWERTRAINS, bodyById, optionById, powertrainById } from '../data';
import { STATS, type Stats } from './types';

export const zeroStats = (): Stats => ({ P: 0, E: 0, U: 0, D: 0, Q: 0 });

/** 5.1 기준(연도) */
export const standard = (year: number): number => config.grade.base * (1 + config.grade.growth) ** (year - config.time.startYear);
/** 원점수 → 표시 등급 0~10 */
export const grade = (raw: number, year: number): number => Math.min(config.grade.max, (config.grade.mid * raw) / standard(year));
export const grades = (s: Stats, year: number): Stats => { const g = zeroStats(); for (const k of STATS) g[k] = grade(s[k], year); return g; };
export const avgGrade = (s: Stats, year: number): number => { const g = grades(s, year); return STATS.reduce((a, k) => a + g[k], 0) / STATS.length; };

/** 동력·옵션 점수(차체 배수 적용 전) */
export function partStats(powertrain: string, tier: number, options: string[]): Stats {
  const pt = powertrainById(powertrain), s = zeroStats();
  const score = config.powertrain.base * config.powertrain.growth ** (tier - 1);
  s.P = score * pt.split.P; s.E = score * pt.split.E;
  for (const id of options) { const o = optionById(id); s.U += o.U; s.D += o.D; s.Q += o.Q; }
  return s;
}

/** 결함에 따른 품질 배수(남은 결함 1개당 −1%, 최대 −40%) */
export const defectQMult = (defects: number): number => 1 - Math.min(config.dev.defectQMax, defects * config.dev.defectQPer);

/** 최종 능력치 = 차체 배수 × (동력·옵션 점수 + 개발 점수), 품질은 결함 감점 */
export function finalStats(body: string, powertrain: string, tier: number, options: string[], points: Stats, defects: number): Stats {
  const b = bodyById(body), part = partStats(powertrain, tier, options), s = zeroStats();
  for (const k of STATS) s[k] = b.mult[k] * (part[k] + points[k]);
  s.Q *= defectQMult(defects);
  return s;
}

/** 대당 원가 = 차체 원가 × (1 + 동력 가산) × (1 + 단계 가산) + 옵션 원가, × 공장 원가 배수 + 물류비 */
export function unitCost(body: string, powertrain: string, tier: number, options: string[]): number {
  const pt = powertrainById(powertrain);
  const base = bodyById(body).cost * (1 + pt.costAdd) * (1 + pt.tiers[tier - 1].costAdd) + options.reduce((a, id) => a + optionById(id).cost, 0);
  return base * config.factory.costMult + config.market.logistics;
}

/** 7.3 수명: 출시 0~3개월 0.6 → 1.0, 이후 매달 −1.2% */
export function lifeFactor(ageMonths: number): number {
  const { start, rampMonths, decay } = config.life;
  if (ageMonths < rampMonths) return start + ((1 - start) * ageMonths) / rampMonths;
  return (1 - decay) ** (ageMonths - rampMonths);
}

export const salaryOf = (ability: number): number => config.salary.base + ability * config.salary.perAbility;

// ---------- 해금(1단계: 연구 없이 연도 자동 해금) ----------
export const bodiesAt = (year: number) => BODIES.filter((b) => b.year <= year);
export const powertrainsAt = (year: number) => POWERTRAINS.filter((p) => p.year <= year);
export const optionsAt = (year: number) => OPTIONS.filter((o) => o.year <= year);
