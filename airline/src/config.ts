/** 모든 튜닝 수치(초기 예시값, 균형 점검 도구로 조정). 코드에 흩어 두지 않는다 */
export const config = {
  daysPerMonth: 30,
  demand: { K: 220, distExp: 0.8, distOffset: 0.5, elasticity: 2.5, repBoost: 0.3 },
  fare: { base: 40, perKm: 0.085, minRatio: 0.5, maxRatio: 2.0 }, // 운임($) = 기준 × 비율
  flight: { turnaroundH: 1.2, taxiH: 0.5, dailyHours: 14 },
  cost: { landingFeeK: 2.0, perPaxFee: 6, fixedMonthly: 1.0, depreciationMonths: 120 }, // landingFeeK: 이착륙 1회(천 달러), perPaxFee: 승객당($), fixedMonthly: M
  start: { cash: 20, reputation: 0.3, plane: 'B737' },
  rules: { bankruptCash: -5, bankruptMonths: 2, winProfit: 100, timeLimitMonths: 24, winCities: 12 },
  events: { chancePerMonth: 0.35 },
};
export type Config = typeof config;
