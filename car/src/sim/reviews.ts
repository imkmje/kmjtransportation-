// 평론가 4명(설계서 7.2)
import { config } from '../config';
import { avgGrade, grades } from './cars';
import { STATS, type Stats } from './types';

/** 평론 점수 4개(1~10, 소수 1자리). noise(): −1~1 사이 값을 주면 ±0.7로 흔든다. 미리보기는 () => 0 */
export function criticScores(stats: Stats, year: number, basePrice: number, price: number, defects: number, noise: () => number): number[] {
  const c = config.critics, g = grades(stats, year), avg = avgGrade(stats, year);
  const penalty = defects >= c.manyDefects ? c.manyDefectsPenalty : 0;
  return c.list.map((cr) => {
    const base = cr.w
      ? STATS.reduce((a, k) => a + (cr.w![k] ?? 0) * g[k], 0)
      : avg * Math.min(config.market.priceAppealMax, Math.max(config.market.priceAppealMin, (basePrice / price) ** c.valueEps));
    const v = base + noise() * c.noise - penalty;
    return Math.round(Math.min(c.max, Math.max(c.min, v)) * 10) / 10;
  });
}
export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
