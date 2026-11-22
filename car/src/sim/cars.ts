// 차의 능력치·등급·원가·수명(설계서 5장, 6.3, 7.3). 모두 순수 함수.
import { config } from '../config';
import { BODIES, OPTIONS, POWERTRAINS, bodyById, optionById, powertrainById } from '../data';
import { unlockedBodies, unlockedOptions, unlockedPowertrains } from './research';
import { STATS, type CarState, type Stats } from './types';

export const zeroStats = (): Stats => ({ P: 0, E: 0, U: 0, D: 0, Q: 0 });

/** 5.1 기준(연도) = 100 × 구간별 상승률의 곱 */
const stdCache = new Map<number, number>(); // 1.0.0 성능: 판매 계산마다 불려 거듭제곱이 가장 비쌌다
export function standard(year: number): number {
  const c = stdCache.get(year);
  if (c !== undefined) return c;
  const { base, growthFrom: from, growthRates: r } = config.grade;
  let v = base;
  for (let i = 0; i < from.length; i++) v *= (1 + r[i]) ** Math.max(0, Math.min(year, from[i + 1] ?? Infinity) - from[i]); // 구간별 상승률(0.4.2)
  if (stdCache.size > 512) stdCache.clear();
  stdCache.set(year, v);
  return v;
}
/** 원점수 → 표시 등급 0~10 */
export const grade = (raw: number, year: number): number => Math.min(config.grade.max, (config.grade.mid * raw) / standard(year));
export const grades = (s: Stats, year: number): Stats => { const g = zeroStats(); for (const k of STATS) g[k] = grade(s[k], year); return g; };
export const avgGrade = (s: Stats, year: number): number => { const g = grades(s, year); return STATS.reduce((a, k) => a + g[k], 0) / STATS.length; };

/** 동력·옵션 점수(차체 배수 적용 전). level: 실제 동력 단계(연구로 오른다, 5.3) */
export function partStats(powertrain: string, level: number, options: string[], partial: Record<string, number> = {}): Stats {
  const pt = powertrainById(powertrain), s = zeroStats();
  const score = config.powertrain.base * config.powertrain.growth ** (level - 1);
  s.P = score * pt.split.P; s.E = score * pt.split.E;
  for (const id of options) { const o = optionById(id); s.U += o.U; s.D += o.D; s.Q += o.Q; }
  for (const [id, w] of Object.entries(partial)) { const o = optionById(id); s.U += o.U * w; s.D += o.D * w; s.Q += o.Q * w; } // 1.1.0 선택 사양: 효과 일부
  return s;
}

/** 결함에 따른 품질 배수(남은 결함 1개당 −1%, 최대 −40%) */
export const defectQMult = (defects: number): number => 1 - Math.min(config.dev.defectQMax, defects * config.dev.defectQPer);

/** 최종 능력치 = 차체 배수 × (동력·옵션 점수 + 개발 점수), 품질은 결함 감점. level: 실제 동력 단계. uMult(1.2.0): 실용 배수(전기차 전용 플랫폼) */
export function finalStats(body: string, powertrain: string, level: number, options: string[], points: Stats, defects: number, partial: Record<string, number> = {}, uMult = 1): Stats {
  const b = bodyById(body), part = partStats(powertrain, level, options, partial), s = zeroStats();
  for (const k of STATS) s[k] = b.mult[k] * (part[k] + points[k]);
  s.U *= uMult;
  s.Q *= defectQMult(defects);
  return s;
}

/** 대당 원가 = 차체 원가 × (1 + 동력 가산) × (1 + 등급 가산) + 옵션 원가, × 원가 배수 + 물류비.
 *  costMult: 원가 배수(costMultOf(state) = 공장 등급 × 연구 인하 × 사건, 생략하면 1). ptAdd: 동력 가산(ptCostAdd(state, 동력), 생략하면 자료값 = 연구 전 전기 +35%) */
export function unitCost(body: string, powertrain: string, tier: number, options: string[], costMult = 1, ptAdd?: number): number {
  const pt = powertrainById(powertrain);
  const base = bodyById(body).cost * (1 + (ptAdd ?? pt.costAdd)) * (1 + pt.tiers[tier - 1].costAdd) + options.reduce((a, id) => a + optionById(id).cost, 0);
  return base * costMult + config.market.logistics;
}

/** 7.3 수명: 출시 0~3개월 0.6 → 1.0, 30개월까지 1.0, 이후 매달 −0.6% */
export function lifeFactor(ageMonths: number): number {
  const { start, rampMonths, plateauMonths, decay } = config.life; // 1.0.0: oldMonths부터 oldDecay를 더 곱한다
  if (ageMonths < rampMonths) return start + ((1 - start) * ageMonths) / rampMonths;
  return (1 - decay) ** Math.max(0, ageMonths - plateauMonths) * Math.max(config.life.oldFloor, (1 - config.life.oldDecay) ** Math.max(0, ageMonths - config.life.oldMonths)); // 노후 감소에는 하한(oldFloor)이 있다(수명 0%가 되어 아무것도 팔리지 않던 문제)
}

export const salaryOf = (ability: number): number => config.salary.base + ability * config.salary.perAbility;

// ---------- 해금(4단계부터 연구로) ----------
// 상태를 주면 연구로 연 것(research.ts의 unlocked*와 같다), 연도를 주면 자료의 등장 연도 기준(옛 호환: 실제로 쓸 수 있는지는 연구가 정한다)
export const bodiesAt = (x: number | CarState) => (typeof x === 'number' ? BODIES.filter((b) => b.year <= x) : unlockedBodies(x));
export const powertrainsAt = (x: number | CarState) => (typeof x === 'number' ? POWERTRAINS.filter((p) => p.year <= x) : unlockedPowertrains(x));
export const optionsAt = (x: number | CarState) => (typeof x === 'number' ? OPTIONS.filter((o) => o.year <= x) : unlockedOptions(x));
