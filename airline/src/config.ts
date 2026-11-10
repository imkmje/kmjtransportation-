/** 모든 튜닝 수치(초기 예시값, 균형 점검 도구로 조정). 코드에 흩어 두지 않는다 */
export const config = {
  daysPerMonth: 30,
  demand: { K: 220, distExp: 0.8, distOffset: 0.5, elasticity: 2.5, repBoost: 0.3 },
  fare: { base: 40, perKm: 0.085, minRatio: 0.5, maxRatio: 2.0 }, // 운임($) = 기준 × 비율
  flight: { turnaroundH: 1.2, taxiH: 0.5, dailyHours: 14 },
  cost: { landingFeeK: 2.0, perPaxFee: 6, fixedMonthly: 1.0, perPlaneMonthly: 0.4, depreciationMonths: 120 }, // landingFeeK: 이착륙 1회(천 달러), perPaxFee: 승객당($), fixedMonthly: M
  start: { cash: 20, reputation: 0.3, plane: 'B737' },
  rules: { bankruptCash: -5, bankruptMonths: 2, winProfit: 100, timeLimitMonths: 24, winCities: 12 },
  events: { chancePerMonth: 0.42 },
  fuel: { reversion: 0.1, noise: 0.18, min: 0.6, max: 1.9, share: 0.4, hedgeCost: 1.2, hedgeMonths: 6 }, // 연료 가격 지수와 계약. share: 운영비 중 연료 비중
  delay: { congestStart: 0.7, congestMax: 0.25, condStart: 0.6, condWeight: 0.3, snow: 0.15, strike: 0.1, min: 0.4, demandWeight: 0.15, compensation: 0.12, priorityFee: 0.1, priorityMult: [0, 1, 0.75, 0.5], repWeight: 0.3 }, // 정시율: 공항 혼잡·정비 상태·사건에 따라 떨어지고, 수요·평판·보상금에 영향
  maint: { autoBelow: 0.55, decayBase: 0.025, decayPerWeekly: 0.0014, lowCond: 0.45, failChance: 0.2, failDays: 30, shopDays: 7, costRatio: 0.02, minCost: 0.5 }, // 정비 상태는 매달 닳고, 낮으면 고장 위험
  credit: { freezeEconomy: 0.86, freezeMonths: 3, stickyBelow: 0.9, stickyReversion: 0.05 }, // 심한 불황이면 은행이 대출을 중단하고, 불황은 쉽게 끝나지 않는다
  economy: { reversion: 0.12, noise: 0.14, min: 0.75, max: 1.25, bizPow: 2, cargoPow: 1.5 }, // 경기 지수: 평균(1)으로 돌아가려는 힘 + 무작위 흔들림. 비즈니스는 경기에 더 민감
  war: { chance: 0.06, months: 3, ratio: 0.55 }, // 운임 전쟁: 경쟁사가 겹치는 노선 하나에서 3개월간 운임을 기준의 55%로 내린다(매달 6% 확률)
  rival: { step: 0.05, upStep: 0.03, lowFloor: 0.7, premFloor: 0.9, lowTarget: 0.85, premTarget: 1.15 }, // 경쟁사 가격 반응
  difficulty: { // 난이도: 시작 현금·사건 빈도·대출 이율·고정비·경쟁사 자금·점수 배수
    easy: { cash: 1.5, event: 0.6, rate: 0.8, fixed: 0.9, rival: 0.7, score: 0.7 },
    normal: { cash: 1, event: 1, rate: 1, fixed: 1, rival: 1, score: 1 },
    hard: { cash: 0.7, event: 1.4, rate: 1.3, fixed: 1.1, rival: 1.3, score: 1.5 },
  },
  score: { profit: 10, cash: 2, city: 40, win: 600, month: 5, bankrupt: 300, loan: 1 },
  loan: { baseRate: 0.01, spread: 0.03, crunch: 0.2, limitBase: 20, limitBookRatio: 0.5, step: 10 }, // 월 이율 = 기본 + 가산 × (잔액 ÷ 한도): 한도에 가까울수록 비싸다. 한도 = 기본 + 장부가 합 × 비율
  aging: { maintPerMonth: 0.004, maxMult: 1.6 }, // 노후 1개월당 운영비 +0.4%(최대 +60%)
  sale: { ratio: 0.9 }, // 매각가 = 장부가 × 0.9
  slot: { base: 6, perSize: 0.35, price: 2, priceStep: 0.2, lease: 0.12 }, // 공항 1일 이착륙 한도 = base + perSize × 시장 규모 + 구매분. 구매가(M)·월 임대료(M)
  lease: { rate: 0.03, deposit: 2, minMonths: 12, extra: 2, buyoutDrop: 0.005, buyoutMin: 0.5 }, // 임대: 월 임대료 = 새 기체 값 × 3%, 보증금 2개월치(반납 때 돌려받음), 최소 12개월(그 전에 반납하면 남은 개월 임대료를 위약금으로, 최소 1개월). 임대기 수는 보유기 + 2대까지. 매입가 = 새 기체 값 × (1 − 0.5% × 사용 개월), 최소 50%
  used: { price: 0.55, age: 96, cond: 0.7 }, // 중고기: 새 기체 값의 55%, 8년 된 기체(운영비가 더 든다), 정비 상태 70%
  ally: { fee: 0.4, weight: 0.5 }, // 제휴(공동 운항): 월 수수료(M). 제휴사가 같은 노선에서 우리 손님을 빼앗는 힘이 절반이 된다
  transfer: { share: 0.1, maxDetour: 1.4, seatCap: 0.3 }, // seatCap: 이어지는 노선 좌석의 30%까지만 환승 손님으로 센다 // 환승: 직항이 없는 도시 쌍 수요의 10%가 우리 허브를 거쳐 간다(돌아가는 거리가 직선의 1.4배 이내일 때)
  hub: { perLink: 0.04, max: 0.16 }, // 한 도시에 노선이 여러 개면 그 도시 수요 +4%씩(최대 +16%)
  cabin: { bizSeatArea: 2.5, bizFareMult: 2.8, bizElasticity: 1.2, shares: [0, 0.1, 0.2, 0.3] }, // 비즈니스 좌석 1개 = 일반석 2.5개 면적
  cargo: { K: 240, distExp: 0.6, base: 300, perKm: 0.45, elasticity: 1.5 }, // 화물 수요(톤/월), 운임($/톤) = base + perKm × km
  growth: { perMonth: 0.003, decay: 0.02, max: 1.8 }, // 운항 중인 도시는 매달 시장이 자란다
  competitors: { count: 2, startCash: 120, maxPlanesBase: 2, maxPlanesPerMonth: 0.35, maxPlanesCap: 10, costRatio: 0.62, planeFixed: 0.4 },
};
export type Config = typeof config;
