/** 카 컴퍼니의 모든 튜닝 수치(설계서 docs/car/design.md의 초기 후보값, 봇 측정으로 조정). 금액 단위는 만원 */
export const config = {
  time: { startYear: 1970, weeksPerMonth: 4, monthsPerYear: 12 }, // 4장: 1 tick = 1주, 4주 = 1개월, 48주 = 1년
  start: { cash: 300000, reputation: 10, roles: ['designer', 'engineer', 'engineer', 'tester'] as const, abilityMin: 25, abilityMax: 35, potentialMin: 50, potentialMax: 75 }, // 현금 30억(설계자 결정 2026-11-20, 9.4의 15억에서 변경), 평판 10, 직원 4명(능력 25~35)
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
    prototypePerWeek: 5800, // 시제차 비용(주당). 2단계 조정 4000 → 5800: 시장 보간을 바꾸며 시장 배수를 올리자 첫 차 회수가 짧아져서, 개발비를 약 11.8억(설계자 결정 6~12억 안)으로
    defectPerPoint: 1 / 12, testerDiv: 10, engineerDiv: 30, // 6.3: 설계 중 결함 += 점수/12, 시험 중 결함 −= 꼼꼼함/10 + 기술/30
    defectQPer: 0.01, defectQMax: 0.4, // 남은 결함 1개당 품질 −1%(최대 −40%)
    estError: 0.15, // 화면용 결함 수 오차 ±15%
    maxOptions: 2, teams: 1, // 본사 1등급 값(화면 호환용). 실제 옵션 슬롯·개발팀 수는 hq.levels를 쓴다
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
    scale: 0.5, // 시장 규모 배수(보정용). 2단계 1.15 → 2.1(기하 보간으로 1970년대 시장이 줄어서). 3단계 2.1 → 0.5: 공장 증설로 생산 한도가 풀리자
    // 1990년 주문이 5등급 공장(월 2만 대)의 3배를 넘어서, 경쟁 차 기본 A(rivals.base)를 함께 낮춰 1970년대 판매는 그대로 두고 후반 시장만 줄였다
    shareExp: 2, // 점유율 = A^지수 / Σ A^지수. 설계서 7.3은 3, 승자 독식 완화로 2(설계자 결정 허용 범위 2~3)
    priceAppealMin: 0.2, priceAppealMax: 2.5,
    overpriceExp: 10, // 3단계 추가 계수: 기준가보다 비싸게 팔면 가격 매력 × (기준가/판매가)^이 값(0.2 자르기에 막히지 않게 자르기 뒤에 곱한다)
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
  factory: { // 9.3 공장. capacity·lines·upkeep·costMult는 1등급 값(화면 호환용), sim은 levels를 쓴다
    capacity: 300, lines: 1, upkeep: 5000, costMult: 1,
    levels: [ // 월 생산, 생산 라인(동시 차종), 건설비, 월 유지비, 원가 배수
      // 3단계 봇 측정으로 조정(설계서 9.3 표: 건설비 8억/50억/250억/1,200억, 유지비 0.5/1.5/4/10/25억, 원가 배수 1/.95/.9/.85/.8).
      // 대당 이익이 판매가의 약 10%라 원가 배수 0.8이면 이익이 3배가 되어 돈이 폭발했다 → 배수를 완만하게, 건설비·유지비를 올림
      { capacity: 300, lines: 1, cost: 0, upkeep: 5000, costMult: 1 },
      { capacity: 1000, lines: 2, cost: 300000, upkeep: 15000, costMult: 0.99 },
      { capacity: 3000, lines: 3, cost: 1500000, upkeep: 60000, costMult: 0.98 },
      { capacity: 8000, lines: 5, cost: 4000000, upkeep: 150000, costMult: 0.97 },
      { capacity: 20000, lines: 8, cost: 20000000, upkeep: 400000, costMult: 0.96 },
    ],
    buildMonths: 6, // 증설 공사 6개월
  },
  hq: { // 9.2 본사. upkeep은 1등급 값(화면 호환용)
    upkeep: 500,
    levels: [ // 이름, 승급비, 평판 조건, 정원, 개발팀, 옵션 슬롯, 월 유지비(유지비는 설계서에 없어 정한 후보값)
      { name: '창고 공장', cost: 0, rep: 0, staff: 4, teams: 1, options: 2, upkeep: 500 },
      { name: '소형 사옥', cost: 50000, rep: 0, staff: 8, teams: 1, options: 2, upkeep: 1500 },
      { name: '본사 빌딩', cost: 400000, rep: 30, staff: 12, teams: 2, options: 3, upkeep: 5000 },
      { name: '연구 단지', cost: 3000000, rep: 55, staff: 16, teams: 2, options: 4, upkeep: 15000 },
      { name: '글로벌 본사', cost: 15000000, rep: 80, staff: 20, teams: 3, options: 4, upkeep: 40000 },
    ],
  },
  staff: { // 9.1 직원
    roles: ['designer', 'engineer', 'tester', 'sales'] as const,
    hire: {
      postCost: [500, 2000, 10000], // 공고 1~3등급 비용
      abilityMin: [15, 30, 50], abilityMax: [35, 55, 80], // 등급별 후보 능력 범위
      repBonusDiv: 20, repBonusMax: 5, // 평판 보너스: 능력 + 평판/20(최대 +5)
      potentialMin: 10, potentialMax: 35, // 잠재력 = 능력 + 10~35(최대 100)
      candidates: 3, expireWeeks: 4,
    },
    severanceMonths: 2, // 퇴직금 = 월급 2개월분
    train: { perAbility: 20, min: 300, gainMin: 3, gainMax: 6, weeks: 4, perYear: 2 }, // 교육비 = 능력 × 20만원(최소 300만), 능력 +3~6, 4주, 연 2회
    exp: { min: 1, max: 2 }, // 프로젝트를 마치면(출시) 참여 직원 능력 +1~2(잠재력 상한)
    condition: { // 컨디션 0~1
      perWeek: { low: 0.005, normal: 0.01, high: 0.025 }, // 프로젝트에서 일한 주마다 감소(예산 등급별)
      recover: 0.05, // 프로젝트에서 일하지 않은 주마다 회복
      low: 0.3, lowMult: 0.6, mid: 0.6, midMult: 0.85, // 0.3 미만 산출 ×0.6, 0.3~0.6 ×0.85
    },
    restMaxWeeks: 12,
    sales: { awarenessDiv: 400, awarenessMax: 0.15, fleetDiv: 1000, fleetMax: 1.3, fleetSegment: 'fleet' }, // 영업: 인지도 수렴 +합/400(최대 +0.15), 법인 매력 ×(1 + 합/1000, 최대 1.3)
  },
  discontinue: { lastMonthMult: 0.5, recentMonths: 3, wellSelling: 0.7, rep: -2, adviceSales: 10, adviceMonths: 6, adviceDrop: 0.6 }, // 8.6
  loan: { base: 200000, revenueRatio: 0.3, rate: 0.006, highRate: 0.01, highUse: 0.7, bailoutLimitMult: 0.5 }, // 9.4: 한도 20억 + 최근 12개월 매출 × 0.3
  bankruptcy: { months: 6, bailoutRep: -20 },
  rivals: { // 7.4·8.4: 경쟁 차 A = 기본값 + 강약 ± 0.1. 4~7년 주기로 새 모델, 주기 중간에 페이스리프트(2단계 단순 규칙, 5단계에서 완성)
    base: 0.45, noise: 0.1, // 3단계 조정 1 → 0.45(시장 규모 배수와 함께, 위 market.scale 설명)
    cycleMin: 48, cycleMax: 84, // 모델 교체 주기(개월)
    fresh: 0.15, decay: 0.006, // 새 모델 A = 기본 × (1 + 0.15), 수명 나이 1개월마다 ×(1 − 0.006). 주기 평균이 약 1.0이 되도록
    faceliftAt: 0.5, faceliftKeep: 0.4, // 주기의 절반에 페이스리프트: 수명 나이를 40%로
  },
  lifecycle: { // 8장
    facelift: {
      afterMonths: 18, designWeeks: 4, costShare: 0.35, // 출시 18개월 뒤, 설계 4주, 비용 = 그 세대 개발비의 35%(설계 4주 + 최소 시험 2주에 나눠 낸다). 설계서 25% → 35%(설계자 허용 25~40%, 리프트가 필수가 되지 않게)
      dCap: 0.1, // 디자이너 점수는 D에만, 상한은 그 세대 원래 D의 +10%(설계서 +15% → 허용 8~15% 안)
      defectKeep: 0.5, defectRate: 1 / 3, // 남은 결함 × 0.5로 시작, 새 결함은 1/3 속도
      lifeKeep: 0.6, lateMonths: 60, lateLifeKeep: 0.8, // 수명 나이를 60%로(세대 나이 60개월 이후면 80%로). 설계서 40%/70% → 허용 45~65%/75~85% 안
      awareness: 0.06, switchMonthMult: 0.7, // 인지도 +0.06(설계서 +0.1 → 허용 0.04~0.10 안), 전환 달 생산 −30%
    },
    fullChange: {
      afterMonths: 36, sameBodyCost: 0.85, newBodyCost: 1, // 출시 36개월 뒤(또는 단종 상태), 비용 85%(같은 차체) / 100%
      equityPerReview: 0.03, equityReviewBase: 0.12, equityReviewMax: 0.2, equitySalesDiv: 500000, equitySalesMax: 0.1, equityMax: 0.3, // 자산 = clamp(0.03 × 평론 − 0.12, 0, 0.2) + min(0.1, 누적/50만)
      recallEquity: -0.05, newBodyEquity: 0.5, revivalMonths: 36, revivalEquity: 0.5, // 리콜 −0.05, 차체 변경 ×0.5, 단종 36개월 넘으면 부활 ×0.5
      worseReview: -1, betterReview: 0.5, // 전작 비교: 표시 등급 평균이 낮으면 평론 전원 −1, 높으면 +0.5
      rebuyShare: 0.03, rebuyMonths: 12, rebuyMinQ: 5, // 전 세대 누적 판매의 3%를 12개월에 나눠 추가 수요(전 세대 품질 등급 5 미만이면 0)
    },
    lookCandidates: 3, // 3D 모양 후보 수
  },
  bots: { // 균형 봇의 경영 규칙(16장, 테스트용)
    reserveMonths: 6, // 고정비(월급 + 유지비) 몇 개월치를 남기고 투자하는가
    expandRatio: 1.3, expandMonths: 3, boundShare: 0.97, // 공장 증설: 지난 3개월 모두 한도의 97% 이상 팔았고 지난달 주문이 한도의 1.3배 이상
    hqCashMult: 6, // 본사 승급: 현금이 승급비 × 6 + 여유분 이상일 때
    tier2Cash: 500000, tier3Cash: 5000000, // 채용 공고 등급: 현금 50억 이상 2등급, 500억 이상 3등급
    salesShare: 0.2, // 정원 중 영업 직원 비율
    leadMonths: 5, // 후속 차 개발을 시작하는 시점(교체 몇 개월 전)
    modelsPerBody: 1, // 차종 수 상한 = 쓸 수 있는 차체 수 × 이 값(생산 라인 수 이내)
    gougeStep: 0.05, // 가격 올리기 봇: 매달 ±5%
    weakShare: 0.5, // 지난달 수요가 (한도 ÷ 판매 차종 수)의 50% 미만인 약한 차는 풀체인지 가능 시점(36개월)에 교체
  },
  ledgerMonths: 24,
  price: { min: 0.6, max: 2.0 },
};
