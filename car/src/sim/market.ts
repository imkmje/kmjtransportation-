// 판매 공식(설계서 7.3). 1단계: 국내 시장만, 유행·지역 취향은 1.
import { config } from '../config';
import { COMPAT, MARKET, RIVALS, SEGMENTS, bodyById } from '../data';
import { grades, lifeFactor } from './cars';
import type { Rng } from './rng';
import { STATS, type CarState, type Generation, type RivalState, type Stats } from './types';

export const REGION = 'domestic';

/** 10년 단위 표 선형 보간(범위 밖은 끝값) */
function interp(years: number[], vals: number[], year: number): number {
  if (year <= years[0]) return vals[0];
  for (let i = 1; i < years.length; i++) if (year <= years[i]) return vals[i - 1] + ((vals[i] - vals[i - 1]) * (year - years[i - 1])) / (years[i] - years[i - 1]);
  return vals[vals.length - 1];
}

/** 칸(지역 × 차체)의 월 규모(대) */
export function cellMonthly(body: string, year: number): number {
  const m = MARKET[REGION], share = m.bodyShare[body];
  if (!share) return 0;
  return (interp(m.years, m.annual, year) * interp(m.years, share, year) * config.market.scale) / config.time.monthsPerYear;
}

/** 매력(차, 고객층) = Σ 가중치 × 표시 등급/5 × 궁합 (유행·지역 취향은 1단계에서 1) */
export function attractiveness(g: Stats, body: string, segment: string): number {
  const seg = SEGMENTS.find((s) => s.id === segment)!;
  return STATS.reduce((a, k) => a + seg.w[k] * (g[k] / config.grade.mid), 0) * (COMPAT[body]?.[segment] ?? 1);
}

/** 가격 매력 = (기준가 × 매력 / 판매가)^ε, 0.2~2.5 */
export const priceAppeal = (basePrice: number, attract: number, price: number, eps: number): number =>
  Math.min(config.market.priceAppealMax, Math.max(config.market.priceAppealMin, ((basePrice * attract) / price) ** eps));

/** 판매 계산에 필요한 차 한 대의 요약(출시 전 미리보기에도 쓴다) */
export interface SaleCar { body: string; segment: string; stats: Stats; price: number; awareness: number; life: number }

/** 점유 점수 A(차, 고객층) = 매력 × 가격 매력 × 인지도 × 수명 */
export function scoreA(c: SaleCar, segment: string, year: number): number {
  const attract = attractiveness(grades(c.stats, year), c.body, segment);
  const eps = SEGMENTS.find((s) => s.id === segment)!.eps;
  const aw = Math.min(1, c.awareness * (segment === c.segment ? config.market.primaryBoost : 1));
  return attract * priceAppeal(bodyById(c.body).basePrice, attract, c.price, eps) * aw * c.life;
}

/** 월 수요(생산 상한 적용 전) = Σ 고객층 칸 월 규모 × 비중 × 점유율. others: 같은 칸의 내 다른 차 */
export function monthlyDemand(state: CarState, car: SaleCar, others: SaleCar[], year: number): number {
  const size = cellMonthly(car.body, year), mix = MARKET[REGION].mix[car.body] ?? {};
  const e = config.market.shareExp;
  let total = 0;
  for (const seg of SEGMENTS) {
    const w = mix[seg.id] ?? 0;
    if (w <= 0) continue;
    const mine = scoreA(car, seg.id, year) ** e;
    let rest = 0;
    for (const r of state.rivals) rest += (r.cells[car.body] ?? 0) ** e;
    for (const o of others) if (o.body === car.body) rest += scoreA(o, seg.id, year) ** e;
    if (mine > 0) total += size * w * (mine / (mine + rest));
  }
  return total;
}

export const currentEdition = (g: Generation) => g.editions[g.editions.length - 1];
export const ageMonths = (g: Generation, month: number): number => month - g.launchMonth;
export const toSaleCar = (g: Generation, month: number): SaleCar => {
  const ed = currentEdition(g);
  return { body: g.body, segment: g.segment, stats: ed.stats, price: ed.price, awareness: g.awareness, life: lifeFactor(ageMonths(g, month)) };
};

/** 목표 인지도 = 0.15 + 평판/250 + 마케팅 가산 + 입소문(품질 등급) */
export function awarenessTarget(reputation: number, marketing: number, qGrade: number): number {
  const a = config.awareness;
  return Math.min(1, Math.max(0, a.base + reputation / a.repDiv + a.marketingTarget[marketing] + a.wordOfMouth * qGrade));
}
/** 출시 시 인지도 = 0.15 + 평판/250 + 평론 보너스 */
export function awarenessStart(reputation: number, reviewAvg: number): number {
  const a = config.awareness;
  return Math.min(1, Math.max(0, a.base + reputation / a.repDiv + (reviewAvg - config.grade.mid) * a.reviewPer));
}

/** 경쟁사 3곳: 칸마다 A = 기본값 + 강약 ± 난수(1단계는 게임 시작 때 한 번 정하고 고정) */
export function initRivals(rng: Rng): RivalState[] {
  return [...RIVALS].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => {
    const cells: Record<string, number> = {};
    for (const body of Object.keys(r.cells).sort()) cells[body] = config.rivals.base + r.cells[body] + rng.range(-config.rivals.noise, config.rivals.noise);
    return { id: r.id, name: r.name, cells };
  });
}
