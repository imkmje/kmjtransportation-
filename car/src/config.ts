/** 카 컴퍼니의 모든 튜닝 수치(설계서 docs/car/design.md의 초기 후보값, 봇 측정으로 조정). 금액 단위는 만원 */
export const config = {
  time: { startYear: 1970, weeksPerMonth: 4, monthsPerYear: 12 }, // 4장: 1 tick = 1주, 4주 = 1개월, 48주 = 1년
  start: { cash: 300000, reputation: 10, roles: ['designer', 'engineer', 'engineer', 'tester'] as const, abilityMin: 25, abilityMax: 35 }, // 현금 30억(설계자 결정 2026-11-20, 9.4의 15억에서 변경), 평판 10, 직원 4명(능력 25~35)
  reputation: { min: 0, max: 100 },
  grade: { base: 100, growth: 0.035, max: 10, mid: 5 }, // 5.1: 기준(연도) = 100 × 1.035^(연도 − 1970), 표시 = 5 × 원점수 / 기준
  powertrain: { base: 40, growth: 1.22 }, // 5.3: 동력 점수 = 40 × 1.22^(단계 − 1)
  salary: { base: 250, perAbility: 12 }, // 9.1: 월급 = 250 + 능력 × 12
  dev: { // 6장
    scale: 2.4, // 보정 계수(설계서 공식에 없는 값, 1.0이면 평균 등급 약 2.2): 주간 산출에 곱한다(1970년·초기 직원·보통·12주·균등이면 표시 등급 평균 4~5가 되도록)
    abilityDiv: 8, randMin: 0.85, randMax: 1.15, // 직원 1명 주간 산출 = 능력 / 8 × 예산 배수 × 컨디션 × 난수
    roleSplit: { designer: { D: 0.6, U: 0.4 }, engineer: { P: 0.5, E: 0.5 }, tester: { Q: 1 } } as Record<string, Partial<Record<'P' | 'E' | 'U' | 'D' | 'Q', number>>>,
    dirTotal: 10, dirMax: 4, dirBase: 0.5, dirDiv: 4, // 방향 배수 = 0.5 + 배분점 / 4
    budgets: { low: { out: 0.8, cost: 0.5 }, normal: { out: 1, cost: 1 }, high: { out: 1.25, cost: 2 } },
    designWeeks: [8, 12, 16], minTestWeeks: 2,
    prototypePerWeek: 4000, // 시제차 비용(주당). 12주 설계 + 시험이면 개발비 약 8.5억이 되도록(설계자 결정 6~12억)
    defectPerPoint: 1 / 12, testerDiv: 10, engineerDiv: 30, // 6.3: 설계 중 결함 += 점수/12, 시험 중 결함 −= 꼼꼼함/10 + 기술/30
    defectQPer: 0.01, defectQMax: 0.4, // 남은 결함 1개당 품질 −1%(최대 −40%)
    estError: 0.15, // 화면용 결함 수 오차 ±15%
    maxOptions: 2, teams: 1, // 본사 1등급: 옵션 슬롯 2, 개발팀 1
  },
  critics: { // 7.2
    list: [
      { id: 'performance', name: '성능파', w: { P: 0.6, D: 0.4 } },
      { id: 'household', name: '살림꾼', w: { U: 0.4, E: 0.4, Q: 0.2 } },
      { id: 'design', name: '디자인파', w: { D: 0.7, Q: 0.3 } },
      { id: 'value', name: '가성비파', w: null }, // 전체 평균 × 가격 매력
    ] as { id: string; name: string; w: Partial<Record<'P' | 'E' | 'U' | 'D' | 'Q', number>> | null }[],
    noise: 0.7, manyDefects: 15, manyDefectsPenalty: 1, okDefects: 5, // 결함 15개 이상이면 전원 −1. 5개 이하면 화면에서 "출시해도 좋습니다"
    min: 1, max: 10,
    valueEps: 1, // 가성비파의 가격 매력 = (기준가 / 판매가)^1 (0.2~2.5)
    masterpiece: 8, masterpieceRep: 4, flop: 4, flopRep: -3,
  },
  market: { // 7.3
    scale: 1.15, // 시장 규모 배수(보정용, 설계서 연 규모 × 1.15)
    shareExp: 2, // 점유율 = A^지수 / Σ A^지수. 설계서 7.3은 3, 승자 독식 완화로 2(설계자 결정 허용 범위 2~3)
    priceAppealMin: 0.2, priceAppealMax: 2.5,
    primaryBoost: 1.25, // 주 고객층 인지도 +25%
    logistics: 0, // 국내 물류비(대당)
  },
  awareness: { // 7.3 인지도
    base: 0.15, repDiv: 250, reviewPer: 0.03, // 시작 = 0.15 + 평판/250 + (평론 평균 − 5) × 0.03
    marketingTarget: [0, 0.15, 0.3, 0.45], // 마케팅 등급별 목표 인지도 가산
    marketingCost: [0, 500, 1500, 4000], // 마케팅 등급별 월 비용
    wordOfMouth: 0.02, // 품질 표시 등급 1당 목표 +0.02
    rate: 0.15, // 매달 목표값으로 15%씩 다가간다
  },
  life: { start: 0.6, rampMonths: 3, decay: 0.012 }, // 출시 0~3개월 0.6 → 1.0, 이후 매달 −1.2%
  recall: { perDefect: 0.02, maxYear: 0.4, costPerCar: 15, rep: -5, awarenessMult: 0.8 }, // 6.3
  factory: { capacity: 300, lines: 1, upkeep: 5000, costMult: 1 }, // 9.3 공장 1등급: 월 300대, 라인 1, 유지비 0.5억
  hq: { upkeep: 500 }, // 본사 1등급 월 유지비(설계서에 값이 없어 정함)
  discontinue: { lastMonthMult: 0.5, recentMonths: 3, wellSelling: 0.7, rep: -2, adviceSales: 10, adviceMonths: 6, adviceDrop: 0.6 }, // 8.6
  loan: { base: 200000, revenueRatio: 0.3, rate: 0.006, highRate: 0.01, highUse: 0.7, bailoutLimitMult: 0.5 }, // 9.4: 한도 20억 + 최근 12개월 매출 × 0.3
  bankruptcy: { months: 6, bailoutRep: -20 },
  rivals: { base: 1, noise: 0.1 }, // 경쟁 차 A = 기본값 + 강약 ± 0.1
  ledgerMonths: 24,
  price: { min: 0.6, max: 2.0 },
};
