/** 모든 튜닝 수치(초기 예시값, 균형 점검 도구로 조정). 코드에 흩어 두지 않는다 */
export const config = {
  daysPerMonth: 30,
  demand: { K: 220, distExp: 0.8, distOffset: 0.5, elasticity: 2.5, repBoost: 0.3 },
  fare: { base: 40, perKm: 0.085, minRatio: 0.5, maxRatio: 2.0 }, // 운임($) = 기준 × 비율
  flight: { turnaroundH: 1.2, taxiH: 0.5, dailyHours: 14 },
  cost: { landingFeeK: 2.0, perPaxFee: 6, fixedMonthly: 1.0, perPlaneMonthly: 0.4, depreciationMonths: 120 }, // landingFeeK: 이착륙 1회(천 달러), perPaxFee: 승객당($), fixedMonthly: M
  start: { cash: 20, reputation: 0.3, plane: 'B737' },
  rules: { bankruptCash: -5, bankruptMonths: 2, winProfit: 120, timeLimitMonths: 24, winCities: 12 },
  events: { chancePerMonth: 0.35 },
  loan: { baseRate: 0.01, spread: 0.03, limitBase: 20, limitBookRatio: 0.5, step: 10 }, // 월 이율 = 기본 + 가산 × (잔액 ÷ 한도): 한도에 가까울수록 비싸다. 한도 = 기본 + 장부가 합 × 비율
  aging: { maintPerMonth: 0.004, maxMult: 1.6 }, // 노후 1개월당 운영비 +0.4%(최대 +60%)
  sale: { ratio: 0.9 }, // 매각가 = 장부가 × 0.9
  slot: { base: 6, perSize: 0.35, price: 2, priceStep: 0.2, lease: 0.12 }, // 공항 1일 이착륙 한도 = base + perSize × 시장 규모 + 구매분. 구매가(M)·월 임대료(M)
  hub: { perLink: 0.04, max: 0.16 }, // 한 도시에 노선이 여러 개면 그 도시 수요 +4%씩(최대 +16%)
  cabin: { bizSeatArea: 2.5, bizFareMult: 2.8, bizElasticity: 1.2, shares: [0, 0.1, 0.2, 0.3] }, // 비즈니스 좌석 1개 = 일반석 2.5개 면적
  cargo: { K: 60, distExp: 0.6, base: 300, perKm: 0.45, elasticity: 1.5 }, // 화물 수요(톤/월), 운임($/톤) = base + perKm × km
  growth: { perMonth: 0.003, decay: 0.02, max: 1.8 }, // 운항 중인 도시는 매달 시장이 자란다
  competitors: { count: 2, startCash: 120, maxPlanesBase: 2, maxPlanesPerMonth: 0.35, maxPlanesCap: 10, costRatio: 0.62, planeFixed: 0.4 },
};
export type Config = typeof config;
