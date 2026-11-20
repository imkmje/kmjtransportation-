/** 카 컴퍼니의 모든 튜닝 수치(설계서 docs/car/design.md의 초기 후보값, 봇 측정으로 조정). 금액 단위는 만원 */
export const config = {
  time: { startYear: 1970, weeksPerMonth: 4, monthsPerYear: 12 }, // 4장: 1 tick = 1주, 4주 = 1개월, 48주 = 1년
  start: { cash: 300000, reputation: 10, roles: ['designer', 'engineer', 'engineer', 'tester'] as const, abilityMin: 25, abilityMax: 35, potentialMin: 50, potentialMax: 75 }, // 현금 30억(설계자 결정 2026-11-20, 9.4의 15억에서 변경), 평판 10, 직원 4명(능력 25~35)
  reputation: { // 9.5
    min: 0, max: 100,
    // 0.4.2: 평판을 올릴 길이 명차(+4)뿐이라 리콜(−5)에 깎여 30년 뒤 중앙값이 0이었다(본사 3등급 조건 30에 닿지 못함). 두 가지를 더한다(시상식은 아직 없음)
    launchBase: 5, launchPer: 1.5, // 신차·풀체인지 출시: 평판 += (평론 평균 − 5) × 1.5(명차·실패작 가감과 별도)
    yearSoldDiv: 2500, yearMax: 3, // 12월 결산: 평판 += min(3, 그해 판매 대수 / 2,500)
  },
  grade: { base: 100, growth: 0.045, max: 10, mid: 5 }, // 5.1: 기준(연도) = 100 × (1 + growth)^(연도 − 1970), 표시 = 5 × 원점수 / 기준. 3단계 조정 3.5% → 4.5%(설계 결정 d, 허용 3~5%)
  powertrain: { base: 40, growth: 1.22 }, // 5.3: 동력 점수 = 40 × 1.22^(단계 − 1)
  salary: { base: 250, perAbility: 12 }, // 9.1: 월급 = 250 + 능력 × 12
  dev: { // 6장
    scale: 1.03, // 0.4.2 시간 척도: 2.4 → 1.03(보통 설계 기간 12 → 28주, 총 점수는 그대로).
    // 보정 계수(설계서 공식에 없는 값, 1.0이면 평균 등급 약 2.2): 주간 산출에 곱한다(1970년·초기 직원·보통·12주·균등이면 표시 등급 평균 4~5가 되도록)
    abilityDiv: 8, randMin: 0.85, randMax: 1.15, // 직원 1명 주간 산출 = 능력 / 8 × 예산 배수 × 컨디션 × 난수
    roleSplit: { designer: { D: 0.6, U: 0.4 }, engineer: { P: 0.5, E: 0.5 }, tester: { Q: 1 } } as Record<string, Partial<Record<'P' | 'E' | 'U' | 'D' | 'Q', number>>>,
    dirTotal: 10, dirMax: 4, dirBase: 0.5, dirDiv: 4, // 방향 배수 = 0.5 + 배분점 / 4
    budgets: { low: { out: 0.8, cost: 0.5 }, normal: { out: 1, cost: 1 }, high: { out: 1.25, cost: 2 } },
    designWeeks: [20, 28, 36], minTestWeeks: 2, // 0.4.2 시간 척도(신차 개발 약 40~60주): 8/12/16 → 20/28/36주
    prototypePerWeek: 2150, staffCostShare: 0.43, // 0.4.2: 설계가 12 → 28주로 늘어 주당 시제차 비용 5000 → 2150, 주간 개발비의 직원 몫도 × 0.43(총 개발비는 그대로).
    // 시제차 비용(주당). 0.4.1 난이도 완화 5600 → 5000(첫 차 개발비 약 10.6억). 4단계 5800 → 5600(경쟁사 난수 순서가 바뀌어 첫 차 개발비 중앙값이 12억을 조금 넘어서). 2단계 조정 4000 → 5800: 시장 보간을 바꾸며 시장 배수를 올리자 첫 차 회수가 짧아져서, 개발비를 약 11.8억(설계자 결정 6~12억 안)으로
    defectPerPoint: 1 / 12, testerDiv: 23, engineerDiv: 70, // 6.3: 설계 중 결함 += 점수/12, 시험 중 결함 −= 꼼꼼함/23 + 기술/70(0.4.2 시간 척도: 10·30 → 23·70, 시험 기간도 약 2.3배)
    defectQPer: 0.01, defectQMax: 0.4, // 남은 결함 1개당 품질 −1%(최대 −40%)
    estError: 0.15, // 화면용 결함 수 오차 ±15%
    teamBase: 4, teamExp: 0.53, // 팀 규모 체감: 산출 × (n / 4)^(−0.53), 4명 이하는 1(3단계 설계 결정 a, k 허용 0~0.6)
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
    scale: 0.53, // 시장 규모 배수(보정용). 2단계 1.15 → 2.1(기하 보간으로 1970년대 시장이 줄어서). 3단계 2.1 → 0.53: 공장 증설로 생산 한도가 풀리자
    // 1990년 주문이 5등급 공장(월 2만 대)의 3배를 넘어서, 경쟁 차 기본 A(rivals.base)를 함께 낮춰 1970년대 판매는 그대로 두고 후반 시장만 줄였다
    shareExp: 2, // 점유율 = A^지수 / Σ A^지수. 설계서 7.3은 3, 승자 독식 완화로 2(설계자 결정 허용 범위 2~3)
    priceAppealMin: 0.2, priceAppealMax: 2.5,
    overpriceExp: 20, // 3단계 추가 계수: 기준가보다 비싸게 팔면 가격 매력 × (기준가/판매가)^이 값(0.2 자르기에 막히지 않게 자르기 뒤에 곱한다)
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
  life: { start: 0.6, rampMonths: 3, plateauMonths: 30, decay: 0.006 }, // 출시 0~3개월 0.6 → 1.0, 30개월까지 1.0, 이후 매달 −0.6%. 0.4.2: 매달 −1.2%(3개월부터)에서 바꿈. 기준 상승(등급 낮아짐)만으로도 판매가 해마다 약 20%씩 줄어, 수명 감소를 늦게·약하게 해야 6~7년에 정점의 25% 아래가 된다
  recall: { perDefect: 0.02, maxYear: 0.4, costPerCar: 12, rep: -5, awarenessMult: 0.8 }, // 6.3. 리콜 대당 비용 0.4.1에서 15 → 12만원(결함이 남은 차의 부담 완화)
  factory: { // 9.3 공장. capacity·lines·upkeep·costMult는 1등급 값(화면 호환용), sim은 levels를 쓴다
    capacity: 300, lines: 1, upkeep: 4000, costMult: 1, // 0.4.1: 1등급 유지비 5,000 → 4,000
    levels: [ // 월 생산, 생산 라인(동시 차종), 건설비, 월 유지비, 원가 배수
      // 3단계 봇 측정으로 조정(설계서 9.3 표: 건설비 8억/50억/250억/1,200억, 유지비 0.5/1.5/4/10/25억, 원가 배수 1/.95/.9/.85/.8).
      // 후속 보정: 건설비 17억/260억/2,200억/7,000억, 유지비 0.5/1.9/5.2/18.6/52.5억(성장이 30년 이상에 걸치도록)
      // 대당 이익이 판매가의 약 10%라 원가 배수 0.8이면 이익이 3배가 되어 돈이 폭발했다 → 배수를 완만하게, 건설비·유지비를 올림
      // 0.4.1 난이도 완화: 1·2등급 유지비 0.5/1.9억 → 0.4/1.6억(초반 부담), 3등급 건설비 260 → 320억·유지비 15.6 → 22억(초반 완화로 신중 봇의 공장이 너무 빨리 커지지 않게)
      { capacity: 300, lines: 1, cost: 0, upkeep: 4000, costMult: 1 },
      { capacity: 1000, lines: 2, cost: 170000, upkeep: 16000, costMult: 0.99 },
      // 4단계 보정: 3~5등급 유지비 5.2/18.6/52.5억 → 15.6/84/240억(연구로 차체·동력이 좋아져 1980년대 이익이 커진 만큼, 큰 공장을 굴리는 비용을 올림)
      { capacity: 3000, lines: 3, cost: 3200000, upkeep: 220000, costMult: 0.98 },
      { capacity: 8000, lines: 5, cost: 22000000, upkeep: 840000, costMult: 0.97 },
      { capacity: 20000, lines: 8, cost: 70000000, upkeep: 2400000, costMult: 0.96 },
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
      potentialMin: 5, potentialMax: 20, // 잠재력 = 능력 + 5~20(최대 100, 설계 결정 c)
      tier3Rep: 40, // 3등급 공고는 평판 40 이상
      candidates: 3, expireWeeks: 4,
    },
    severanceMonths: 2, // 퇴직금 = 월급 2개월분
    train: { perAbility: 40, min: 500, gainMin: 1, gainMax: 3, weeks: 4, perYear: 1 }, // 교육비 = 능력 × 40만원(최소 500만), 능력 +1~3, 4주, 연 1회(설계 결정 c)
    exp: { min: 1, max: 2 }, // 프로젝트를 마치면(출시) 참여 직원 능력 +1~2(잠재력 상한)
    condition: { // 컨디션 0~1
      perWeek: { low: 0.0022, normal: 0.0043, high: 0.011 }, // 프로젝트에서 일한 주마다 감소(예산 등급별). 0.4.2 시간 척도로 × 0.43
      recover: 0.05, // 프로젝트에서 일하지 않은 주마다 회복
      low: 0.3, lowMult: 0.6, mid: 0.6, midMult: 0.85, // 0.3 미만 산출 ×0.6, 0.3~0.6 ×0.85
    },
    restMaxWeeks: 12,
    sales: { awarenessDiv: 400, awarenessMax: 0.15, fleetDiv: 1000, fleetMax: 1.3, fleetSegment: 'fleet' }, // 영업: 인지도 수렴 +합/400(최대 +0.15), 법인 매력 ×(1 + 합/1000, 최대 1.3)
  },
  discontinue: { lastMonthMult: 0.5, recentMonths: 3, wellSelling: 0.7, rep: -2, adviceSales: 10, adviceMonths: 6, adviceDrop: 0.6 }, // 8.6
  loan: { base: 300000, revenueRatio: 0.3, rate: 0.006, highRate: 0.01, highUse: 0.7, bailoutLimitMult: 0.5 }, // 9.4: 한도 30억(0.4.1에서 20억 → 30억) + 최근 12개월 매출 × 0.3
  bankruptcy: { months: 12, bailoutRep: -20 }, // 0.4.1: 파산까지의 유예 6 → 12개월(사용자 피드백: 파산이 너무 잘 뜬다)
  rivals: { // 7.4·8.4: 경쟁 차 A = 기본값 + 강약 ± 0.1. 4~7년 주기로 새 모델, 주기 중간에 페이스리프트(2단계 단순 규칙, 5단계에서 완성)
    base: 0.39, noise: 0.1, // 1970년 경쟁 차 기본 A. 3단계 조정 1 → 0.42(시장 규모 배수와 함께, 위 market.scale 설명). 0.4.1 난이도 완화 0.42 → 0.39(초반만 약하게)
    baseGrowth: 0.052, baseMax: 1.25, // 경쟁사의 성장(설계 결정 b): 해마다 +0.052(0.4.1에서 0.05 → 0.052, 최대에 닿는 1986년쯤은 그대로), 최대 1.25(새 모델을 낼 때 반영)
    cycleMin: 48, cycleMax: 84, // 모델 교체 주기(개월)
    fresh: 0.15, decay: 0.006, // 새 모델 A = 기본 × (1 + 0.15), 수명 나이 1개월마다 ×(1 − 0.006). 주기 평균이 약 1.0이 되도록
    faceliftAt: 0.5, faceliftKeep: 0.4, // 주기의 절반에 페이스리프트: 수명 나이를 40%로
  },
  lifecycle: { // 8장
    facelift: {
      afterMonths: 18, designWeeks: 12, costShare: 0.4, // 출시 18개월 뒤, 설계 12주(0.4.2 시간 척도: 4 → 12, 리프트 전체 약 16~28주), 비용 = 그 세대 개발비의 40%(설계 4주 + 최소 시험 2주에 나눠 낸다). 설계서 25% → 40%(설계자 허용 25~40%, 리프트가 필수가 되지 않게, 3단계 봇 측정)
      dCap: 0.1, // 디자이너 점수는 D에만, 상한은 그 세대 원래 D의 +10%(설계서 +15% → 허용 8~15% 안)
      refresh: 0.025, // 0.4.2: 디자인 밖의 능력치(성능·연비·실용·품질)도 × 1.06(연식 변경 개선). 기준 상승으로 해마다 등급이 낮아지는 만큼을 약 1.3년 되돌린다(리프트 이익이 너무 작아서)
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
    retrofit: { costShare: 0.05, min: 5000 }, // 0.4.2 의무 장비 추가: 일시 비용 = 그 세대 개발비 × 5%(최소 5,000만원). 대당 원가는 장비 원가만큼 오른다
    lookCandidates: 3, // 3D 모양 후보 수
  },
  bots: { // 균형 봇의 경영 규칙(16장, 테스트용)
    reserveMonths: 6, // 고정비(월급 + 유지비) 몇 개월치를 남기고 투자하는가
    expandRatio: 1.3, expandMonths: 3, boundShare: 0.97, // 공장 증설: 지난 3개월 모두 한도의 97% 이상 팔았고 지난달 주문이 한도의 1.3배 이상
    hqCashMult: 6, // 본사 승급: 현금이 승급비 × 6 + 여유분 이상일 때
    tier2Cash: 500000, tier3Cash: 5000000, // 채용 공고 등급: 현금 50억 이상 2등급, 500억 이상 3등급
    salesShare: 0.2, // 정원 중 영업 직원 비율
    leadMonths: 12, // 후속 차 개발을 시작하는 시점(교체 몇 개월 전). 0.4.2: 개발이 약 1년이 되어 5 → 12
    modelsPerBody: 1, // 차종 수 상한 = 쓸 수 있는 차체 수 × 이 값(생산 라인 수 이내)
    gougeStep: 0.05, // 가격 올리기 봇: 매달 ±5%
    optionCostShare: 0.04, // 4단계: 옵션은 원가가 기준가의 4% 이하인 것만(규제 옵션은 예외, 가격을 올리지 않으므로 비싼 옵션은 대당 이익을 깎는다)
    bodySpread: 2, // 4단계: 이미 파는 차체의 가치를 (1 + 차 수)^2로 나눠 새 차체를 쓰게 한다
    weakShare: 0.5, // 지난달 수요가 (한도 ÷ 판매 차종 수)의 50% 미만인 약한 차는 풀체인지 가능 시점(36개월)에 교체
    clumsy: { priceMult: 1.1, changeMonths: 120 }, // 0.4.1 더 서툰 봇: 기준가의 110%로 출시, 풀체인지 10년
    novice: { launchDefects: 10, changeMonths: 96, manageEvery: 6, expandRatio: 2, cheapShare: 0.1 }, // 0.4.1 서툰 플레이 봇: 화면 결함 10개쯤에서 출시, 풀체인지 8년(0.4.2: 7.5 → 8년, 신중이 6.5년이 되어), 6개월마다 채용·교육·연구(현금의 10% 이하인 기술만), 주문이 한도의 2배를 넘어야 증설
  },
  research: { // 10장 연구
    pointsDiv: 10, // 프로젝트·교육·휴식에 없는 엔지니어 1명이 매주 능력 / 10 점
    labMult: 1.5, labHq: 4, // 전담 연구원(본사 4등급부터): 산출 × 1.5
    slots: [3, 4, 5, 6, 6], // 본사 등급별 동시 연구 수. 0.4.2: 1/1/1/2/2 → 3/4/5/6/6(사용자 피드백: 연구 두 개는 박하다). 주간 점수는 시작 순으로 채우므로 칸이 늘어도 전체 속도는 같다
    earlyRate: 0.25, earlyMax: 4, // 등장 연도보다 먼저: 비용 × (1 + 0.25 × 앞당긴 햇수), 최대 4년
    lateYears: 8, lateMult: 0.5, // 등장 연도 + 8년이 지나면 비용 × 0.5
    repeatGrowth: 1.5, // 반복 기술(차세대)은 할 때마다 비용 × 1.5
    worldFirst: 1, // 먼저 연구한 기술을 쓴 첫 차의 평론 +1(기술마다 한 번)
  },
  events: { // 11장 시대 사건
    shiftYears: 1, // 고정 사건 연도 ±1년(시드로 확정)
    warnMonths: 6, // 예고 뉴스: 시작 6개월 전
    lastEraYear: 2035, // 이 해 뒤로는 고정 사건이 없다(무작위 사건만)
    randomFrom: 1971, randomPerYear: [0.3, 0.5, 0.2], // 무작위 사건: 1971년부터 해마다 0/1/2회 확률
    choiceWeeks: 4, // 답하지 않으면 4주 뒤 기본 선택
    revenueMonths: 12, // 선택지 비용의 "최근 월평균 매출" 기간
    newsMax: 60, // 뉴스 기록 보관 개수
    trendMin: 0.2, // 유행 계수 하한
    charging: { powertrain: 'ev', start: 0.05, perYear: 0.045 }, // 충전 인프라: 전기차 등장 사건부터 0.05, 해마다 +0.045(최대 1)
  },
  // 0.4.1 난이도(설계자 결정): 새 게임에서 고른다(인자를 빼면 easy). 예전 저장은 normal로 본다. 공식은 그대로, 아래 값을 읽는 자리에서 바꾼다.
  // cash: 시작 현금, loanBase: 대출 기본 한도, bankruptcyMonths: 파산 유예, rivalMult: 경쟁 차 A 배수, upkeepMult: 본사·공장 유지비 배수,
  // prototypeMult: 시제차 비용 배수, recallMult: 리콜 비용 배수(무상 수리 선택 포함), manyDefects: 평론 감점 결함 기준, bailouts: 구제 금융 횟수
  difficulty: {
    easy: { name: '쉬움', desc: '자금이 넉넉하고 경쟁이 약합니다. 처음 하는 분께 권합니다.', cash: 500000, loanBase: 500000, bankruptcyMonths: 18, rivalMult: 0.88, upkeepMult: 0.8, prototypeMult: 0.8, recallMult: 0.6, manyDefects: 20, bailouts: 2 },
    normal: { name: '보통', desc: '설계한 기본 균형입니다. 경영 게임에 익숙한 분께 맞습니다.', cash: 300000, loanBase: 300000, bankruptcyMonths: 12, rivalMult: 1, upkeepMult: 1, prototypeMult: 1, recallMult: 1, manyDefects: 15, bailouts: 1 },
    hard: { name: '어려움', desc: '자금이 빠듯하고 경쟁이 강하며, 구제 금융이 없습니다.', cash: 220000, loanBase: 200000, bankruptcyMonths: 6, rivalMult: 1.05, upkeepMult: 1.1, prototypeMult: 1, recallMult: 1, manyDefects: 15, bailouts: 0 },
  },
  devCheat: { cash: 5000000, reputation: 10 }, // 개발자 메뉴: 현금 +500억, 평판 +10
  ledgerMonths: 24,
  price: { min: 0.6, max: 2.0 },
};
