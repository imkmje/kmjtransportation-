/** 카 컴퍼니의 모든 튜닝 수치(설계서 docs/car/design.md의 초기 후보값, 봇 측정으로 조정). 금액 단위는 만원 */
export const config = {
  time: { startYear: 1970, weeksPerMonth: 4, monthsPerYear: 12 }, // 4장: 1 tick = 1주, 4주 = 1개월, 48주 = 1년
  start: { cash: 300000, reputation: 10, roles: ['designer', 'engineer', 'engineer', 'tester'] as const, abilityMin: 25, abilityMax: 35, potentialMin: 50, potentialMax: 75 }, // 현금 30억(설계자 결정 2026-11-20, 9.4의 15억에서 변경), 평판 10, 직원 4명(능력 25~35)
  reputation: { // 9.5
    min: 0, // 1.0.0: 위쪽 상한(100) 없앰(사용자 지시). 효과는 soft를 넘으면 로그로 완만해진다(repEffect: soft × (1 + softStep × log2(평판 / soft)), 100 → 200의 추가 효과가 0 → 100의 1/3)
    soft: 100, softStep: 1 / 3,
    // 0.4.2: 평판을 올릴 길이 명차(+4)뿐이라 리콜(−5)에 깎여 30년 뒤 중앙값이 0이었다(본사 3등급 조건 30에 닿지 못함). 두 가지를 더한다(시상식은 아직 없음)
    launchBase: 5, launchPer: 1, // 신차·풀체인지 출시: 평론 평균이 5 넘으면 평판 += (평균 − 5) × 1, 5 미만은 0(0.5.1, 혹평만 감점. 명차·혹평 가감과 별도)
    yearSoldDiv: 3000, yearMax: 3, // 12월 결산: 평판 += min(3, 그해 판매 대수 / 3,000). 0.5.1: 상한 2 → 3
    yearGoodReview: 6, yearGoodRep: 1, // 12월 결산: 판매 중인 차의 평론 평균이 6 이상이면 +1(0.5.1)
    milestones: [1000, 5000, 10000, 50000, 100000, 500000, 1000000], milestoneRep: [2, 2, 3, 3, 3, 3, 3], // 회사 누적 판매가 이 대수를 넘을 때마다 평판 +2~3(0.5.1)
    recallPer: 5000, recallMin: 0.5, // 리콜 평판 감점 = 누적 판매 / 5,000(0.5~3, 최대는 recall.rep), × 난이도 감점 배수(0.5.1: −5 고정에서 바꿈)
  },
  grade: { base: 100, max: 10, mid: 5, // 기준(연도) = 100 × 구간별 상승률의 곱(5.1)
    // 0.4.2: 기준 상승률을 구간별로(사용자 피드백 "다음 작품일수록 좋은 평가가 어렵다"). 1970~80년 7%, 1980~90년 2%, 1990년부터 2.5%.
    // 신중 봇의 원점수는 1970년대에 빠르게(직원 성장·팀 확대·초기 연구) 오르고 1985년 뒤로 느려져, 단일 4.5%면 등급이 1980년 7.5 → 1995년 5.9로 떨어졌다
    growthFrom: [1970, 1980, 1990, 2010], growthRates: [0.045, 0.03, 0.025, 0.015],
  }, // 5.1: 기준(연도) = 100 × (1 + growth)^(연도 − 1970), 표시 = 5 × 원점수 / 기준. 3단계 조정 3.5% → 4.5%(설계 결정 d, 허용 3~5%)
  powertrain: { base: 40, growth: 1.25 }, // 5.3: 동력 점수 = 40 × 1.25^(단계 − 1). 0.4.2: 1.22 → 1.25(연구 효과를 키워 연구를 게을리하면 등급이 떨어지게)
  salary: { base: 250, perAbility: 12 }, // 9.1: 월급 = 250 + 능력 × 12
  dev: { // 6장
    scale: 1.03, // 0.4.2 시간 척도: 2.4 → 1.03(보통 설계 기간 12 → 28주, 총 점수는 그대로).
    // 보정 계수(설계서 공식에 없는 값, 1.0이면 평균 등급 약 2.2): 주간 산출에 곱한다(1970년·초기 직원·보통·12주·균등이면 표시 등급 평균 4~5가 되도록)
    abilityDiv: 8, randMin: 0.85, randMax: 1.15, // 직원 1명 주간 산출 = 능력 / 8 × 예산 배수 × 컨디션 × 난수
    roleSplit: { designer: { D: 0.6, U: 0.4 }, engineer: { P: 0.5, E: 0.5 }, tester: { Q: 1 } } as Record<string, Partial<Record<'P' | 'E' | 'U' | 'D' | 'Q', number>>>,
    dirTotal: 10, dirMax: 4, dirBase: 0.5, dirDiv: 4, // 방향 배수 = 0.5 + 배분점 / 4
    budgets: { low: { out: 0.8, cost: 0.5 }, normal: { out: 1, cost: 1 }, high: { out: 1.25, cost: 2 } },
    designWeeks: [20, 28, 36], minTestWeeks: 2, // 0.4.2 시간 척도(신차 개발 약 40~60주): 8/12/16 → 20/28/36주
    devEra: { years: [1980, 1990, 2000, 2010, 2020, 2030], values: [1, 18, 58, 70, 70, 70], refBody: 'sedanS', bodyExp: 0.5 }, // 1.0.0 시제차 비용의 시대 배수(devScale)
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
    masterpiece: 8, masterpieceRep: 4, flop: 3.5, flopRep: -3, // 혹평: 평균 3.5 이하면 평판 −3 × 난이도 감점 배수(0.5.1: 4 → 3.5, 첫 차 평론 4점대는 혹평이 아니다)
  },
  market: { // 7.3
    scale: 0.53, // 시장 규모 배수(보정용). 2단계 1.15 → 2.1(기하 보간으로 1970년대 시장이 줄어서). 3단계 2.1 → 0.53: 공장 증설로 생산 한도가 풀리자
    // 1990년 주문이 5등급 공장(월 2만 대)의 3배를 넘어서, 경쟁 차 기본 A(rivals.base)를 함께 낮춰 1970년대 판매는 그대로 두고 후반 시장만 줄였다
    shareExp: 2, // 점유율 = A^지수 / Σ A^지수. 설계서 7.3은 3, 승자 독식 완화로 2(설계자 결정 허용 범위 2~3)
    priceAppealMin: 0.2, priceAppealMax: 2.5,
    overpriceExp: 6, overpriceHardAt: 1.08, overpriceHardExp: 20, // 기준가보다 비싸게 팔면 가격 매력 × (기준가/판매가)^6 × (기준가 × 1.08/판매가)^20(108% 넘는 부분만, 가격 올리기 봇이 유리해지지 않게). 0.5.0: 지수 20 하나였을 때 108%만 받아도 판매가 1/20로 줄었다(자르기 뒤에 곱한다)
    erosion: { fromYear: 1995, perYear: 0.004, max: 0.035 }, // 0.5.1 시장 포화: 1995년부터 시장 기준가가 해마다 0.4%씩 낮아져 최대 3.5%(후반 현금 폭발 억제, 원가는 그대로).
    // 0.7.0: 최대 6% → 3.5%. 대당 이익이 판매가의 약 9%라 6%를 깎으면 2010년 전후 공장 5등급 유지비를 못 넘어 보통 신중 봇 60년 생존이 6/20이었다(3.5%면 18/20). 2003년까지는 같은 값
    // 1.0.0 시대별 원가 상승: 1975년 0 → 1995년 +4%(원가 배수에 곱한다). 옵션 값을 기준가에 넣어(optionValue) 봇이 값싼 옵션으로 대당 이익을 깎지 않게 되자 1990년대 이익률이 약 4%p 올라서, 그만큼 되돌린다
    costEra: { from: 1975, to: 1995, max: 0.07 },
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
  life: { start: 0.6, rampMonths: 3, plateauMonths: 30, decay: 0.006, oldMonths: 72, oldDecay: 0.03, oldFloor: 0.3 }, // 1.0.0 oldMonths·oldDecay: 수명 나이 72개월(6년)부터 매달 3%씩 더 줄어든다(이 노후 몫은 oldFloor 30% 아래로 내려가지 않는다. 하한이 없으면 13년 된 차의 수명이 4%가 되어 판매 0, 페이스리프트 옵션도 예상에 반영되지 않았다. 사용자 화면: 11년 된 차가 수명 24%에도 월 수십억을 벌어 풀체인지할 이유가 약했다) // 출시 0~3개월 0.6 → 1.0, 30개월까지 1.0, 이후 매달 −0.6%. 0.4.2: 매달 −1.2%(3개월부터)에서 바꿈. 기준 상승(등급 낮아짐)만으로도 판매가 해마다 약 20%씩 줄어, 수명 감소를 늦게·약하게 해야 6~7년에 정점의 25% 아래가 된다
  recall: { perDefect: 0.02, maxYear: 0.4, costPerCar: 12, rep: -3, awarenessMult: 0.8 }, // rep: 평판 감점 최대(0.5.1: −5 고정 → 규모 비례 최대 −3) // 6.3. 리콜 대당 비용 0.4.1에서 15 → 12만원(결함이 남은 차의 부담 완화)
  factory: { // 9.3 공장. capacity·lines·upkeep·costMult는 1등급 값(화면 호환용), sim은 levels를 쓴다
    capacity: 300, lines: 1, upkeep: 3000, costMult: 1, // 0.4.1: 1등급 유지비 5,000 → 4,000. 0.4.2: 4,000 → 3,000(보통에서 서툰 플레이 봇 30년 파산 25% → 15%)
    levels: [ // 월 생산, 생산 라인(동시 차종), 건설비, 월 유지비, 원가 배수
      // 3단계 봇 측정으로 조정(설계서 9.3 표: 건설비 8억/50억/250억/1,200억, 유지비 0.5/1.5/4/10/25억, 원가 배수 1/.95/.9/.85/.8).
      // 후속 보정: 건설비 17억/260억/2,200억/7,000억, 유지비 0.5/1.9/5.2/18.6/52.5억(성장이 30년 이상에 걸치도록)
      // 대당 이익이 판매가의 약 10%라 원가 배수 0.8이면 이익이 3배가 되어 돈이 폭발했다 → 배수를 완만하게, 건설비·유지비를 올림
      // 0.4.1 난이도 완화: 1·2등급 유지비 0.5/1.9억 → 0.4/1.6억(초반 부담), 3등급 건설비 260 → 320억·유지비 15.6 → 22억(초반 완화로 신중 봇의 공장이 너무 빨리 커지지 않게)
      { capacity: 300, lines: 1, cost: 0, upkeep: 3000, costMult: 1 },
      { capacity: 1000, lines: 3, cost: 170000, upkeep: 16000, costMult: 0.99 },
      // 4단계 보정: 3~5등급 유지비 5.2/18.6/52.5억 → 15.6/84/240억(연구로 차체·동력이 좋아져 1980년대 이익이 커진 만큼, 큰 공장을 굴리는 비용을 올림)
      { capacity: 3000, lines: 3, cost: 3200000, upkeep: 150000, costMult: 0.98 },
      { capacity: 8000, lines: 5, cost: 25000000, upkeep: 340000, costMult: 0.97 },
      { capacity: 20000, lines: 8, cost: 90000000, upkeep: 850000, costMult: 0.96 },
      // 1.0.0 사용자 지적 "공장 유지비가 너무 비쌈": 3~5등급 유지비 22/110/260억 → 15/40/105억(한도의 70%를 채우면 매출의 약 3%). 중후반 돈은 개발비의 시대 상승(dev.devEra)으로 조인다.
      // 1.0.0 6·7등급(사용자 요청 "2만 대 넘게 팔린다"): 한도 1.6배씩, 월 유지비는 한도 1대당 약 52만원으로 5등급과 같게(규모가 커져도 대당 고정비가 낮아지지 않게), 원가 배수 그대로, 공사가 길다.
      // 국내 시장 전체가 월 약 5만 대라 7등급(5만 대)에서 멈춘다
      { capacity: 32000, lines: 11, cost: 200000000, upkeep: 1360000, costMult: 0.96, buildMonths: 9 },
      { capacity: 50000, lines: 14, cost: 320000000, upkeep: 2130000, costMult: 0.96, buildMonths: 12 },
    ],
    buildMonths: 6, // 증설 공사 6개월
    bigLevel: 4, // 1.0.0: 이 등급부터 난이도의 bigUpkeepMult로 유지비를 곱한다
  },
  hq: { // 9.2 본사. upkeep은 1등급 값(화면 호환용)
    upkeep: 500,
    levels: [ // 이름, 승급비, 평판 조건, 정원, 개발팀, 옵션 슬롯, 월 유지비(유지비는 설계서에 없어 정한 후보값). 0.4.2: 3등급 평판 조건 30 → 20(신중 봇의 10년 평판 중앙값이 쉬움 24·보통 22)
      { name: '창고 공장', cost: 0, rep: 0, staff: 6, teams: 1, options: 2, upkeep: 500 },
      { name: '소형 사옥', cost: 50000, rep: 0, staff: 8, teams: 1, options: 2, upkeep: 1500 },
      { name: '본사 빌딩', cost: 400000, rep: 20, staff: 12, teams: 2, options: 3, upkeep: 5000 },
      { name: '연구 단지', cost: 3000000, rep: 55, staff: 16, teams: 2, options: 4, upkeep: 15000 },
      { name: '글로벌 본사', cost: 15000000, rep: 80, staff: 20, teams: 3, options: 4, upkeep: 40000 },
      // 3.0.0(사용자 지시: 차 6대에 직원 20명 상한은 모자라다). 유지비는 등급마다 약 2.5배(기존 3배·2.7배 추세)
      { name: '그룹 본사', cost: 80000000, rep: 120, staff: 30, teams: 4, options: 4, upkeep: 100000 },
      { name: '글로벌 캠퍼스', cost: 300000000, rep: 170, staff: 40, teams: 6, options: 4, upkeep: 250000 },
    ],
  },
  staff: { // 9.1 직원
    roles: ['designer', 'engineer', 'tester', 'sales'] as const,
    hire: {
      postCost: [500, 2000, 10000], // 공고 1~3등급 비용
      abilityMin: [15, 30, 50], abilityMax: [35, 55, 80], // 등급별 후보 능력 범위
      repBonusDiv: 20, // 평판 보너스: 능력 + 평판 효과/20(평판 100에서 +5, 1.0.0: 상한 대신 평판 효과가 완만해진다)
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
    response: { from: 1985, to: 1995, share0: 0.1, k: 3 }, // 1.0.0 경쟁사의 대응(market.rivalResponse)
    // 2.0.0 경쟁 모델의 겉으로 보이는 값(표시용, 판매 계산에 쓰지 않는다. sim/rivals.ts). d = 모델 기본 A − 그때 경쟁 차 기본 A(rivalBase)
    view: { criticMid: 6, criticPer: 10, hitAt: 0.6, statJitter: 0.6, pricePer: 0.02 }, // 추정 평론 = 6 + d × 10(1~10), 히트작 = 난수 몫이 noise의 60% 이상, 능력치 = 평론 + 회사 모양 ± 0.6, 가격 = 시장 기준가 × (1 + (평론 − 6) × 2%)
    lateCells: ['suvL', 'suvS'], // 0.6.0에 더한 칸: 새 게임의 첫 모델 강약 난수를 게임 난수 대신 해시로 뽑는다(기존 시드의 난수 순서가 그대로)
  },
  lifecycle: { // 8장
    facelift: {
      goodFromMonths: 30, // 0.5.1: 출시 뒤 이보다 이르면 미리보기에 '지금 하면 효과가 작다'
      afterMonths: 18, designWeeks: 12, costShare: 0.4, // 출시 18개월 뒤, 설계 12주(0.4.2 시간 척도: 4 → 12, 리프트 전체 약 16~28주), 비용 = 그 세대 개발비의 40%(설계 4주 + 최소 시험 2주에 나눠 낸다). 설계서 25% → 40%(설계자 허용 25~40%, 리프트가 필수가 되지 않게, 3단계 봇 측정)
      dCap: 0.1, // 디자이너 점수는 D에만, 상한은 그 세대 원래 D의 +10%(설계서 +15% → 허용 8~15% 안)
      refresh: 0.025, // 0.4.2: 디자인 밖의 능력치(성능·연비·실용·품질)도 × 1.06(연식 변경 개선). 기준 상승으로 해마다 등급이 낮아지는 만큼을 약 1.3년 되돌린다(리프트 이익이 너무 작아서)
      defectKeep: 0.5, defectRate: 1 / 3, // 남은 결함 × 0.5로 시작, 새 결함은 1/3 속도
      lifeKeep: 0.3, lateMonths: 60, lateLifeKeep: 0.8, // 수명 나이를 30%로(세대 나이 60개월 이후면 80%로). 1.0.0: 0.6 → 0.3(출시 36개월 리프트가 '수요가 정점의 25%가 되는 때'를 12~29개월 → 24~41개월 늦추도록, 경쟁 차 고정 측정. 회수 4~8개월·세대 순이익 +26~35%로 0.4.2 범위 안)
      awareness: 0.06, switchMonthMult: 0.7, // 인지도 +0.06(설계서 +0.1 → 허용 0.04~0.10 안), 전환 달 생산 −30%
    },
    fullChange: {
      afterMonths: 36, sameBodyCost: 0.7, newBodyCost: 1, // 출시 36개월 뒤(또는 단종 상태), 비용 85%(같은 차체) / 100%
      equityPerReview: 0.03, equityReviewBase: 0.09, equityReviewMax: 0.2, equitySalesDiv: 150000, equitySalesMax: 0.1, equityMax: 0.3, // 자산 = clamp(0.03 × 평론 − 0.09, 0, 0.2) + min(0.1, 누적/15만). 0.5.1: −0.12·50만에서 바꿈(평론 4점·누적 5천 대부터 눈에 띄게)
      recallEquity: -0.05, newBodyEquity: 0.5, revivalMonths: 36, revivalEquity: 0.5, // 리콜 −0.05, 차체 변경 ×0.5, 단종 36개월 넘으면 부활 ×0.5
      worseReview: -1, betterReview: 0.5, // 전작 비교(0.4.2: 원점수 = 절대 성능): 어느 능력치든 전 세대 마지막 판보다 낮으면 평론 전원 −1, 모두 낮지 않고 평균이 뚜렷이 높으면 +0.5
      worseTolerance: 0.05, betterShare: 0.1, // 평균이 5% 넘게 낮아야 "못하다", 10% 이상 높아야 "진화했다"
      rebuyShare: 0.03, rebuyMonths: 12, rebuyMinQ: 3, // 전 세대 누적 판매의 3%를 12개월에 나눠 추가 수요(전 세대 품질 등급 3 미만이면 0, 0.5.1: 5 → 3)
    },
    retrofit: { costShare: 0.05, min: 5000 }, // 0.4.2 의무 장비 추가: 일시 비용 = 그 세대 개발비 × 5%(최소 5,000만원). 대당 원가는 장비 원가만큼 오른다
    lookCandidates: 3, // 3D 모양 후보 수
  },
  bots: { // 균형 봇의 경영 규칙(16장, 테스트용)
    reserveMonths: 6, // 고정비(월급 + 유지비) 몇 개월치를 남기고 투자하는가
    expandRatio: 1.3, expandMonths: 3, boundShare: 0.97, expandFill: 0.75, fillFrom: 5, expandLoan: 0.7, // expandLoan(1.0.0): 증설비가 모자라면 대출 한도의 70%까지 빌린다
    // fillFrom(1.0.0): 이 등급부터 expandFill 조건(전에는 마지막 등급만). expandFill(0.4.2): 마지막 등급은 지난달 주문이 그 한도의 75% 이상일 때만 증설 // 공장 증설: 지난 3개월 모두 한도의 97% 이상 팔았고 지난달 주문이 한도의 1.3배 이상
    hqCashMult: 6, // 본사 승급: 현금이 승급비 × 6 + 여유분 이상일 때
    tier2Cash: 500000, tier3Cash: 5000000, // 채용 공고 등급: 현금 50억 이상 2등급, 500억 이상 3등급
    salesShare: 0.2, // 정원 중 영업 직원 비율
    leadMonths: 12, // 후속 차 개발을 시작하는 시점(교체 몇 개월 전). 0.4.2: 개발이 약 1년이 되어 5 → 12
    modelsPerBody: 1, // 차종 수 상한 = 쓸 수 있는 차체 수 × 이 값(생산 라인 수 이내)
    gougeStep: 0.05, // 가격 올리기 봇: 매달 ±5%
    bodySpread: 2, // 4단계: 이미 파는 차체의 가치를 (1 + 차 수)^2로 나눠 새 차체를 쓰게 한다
    subs: { cashMonths: 24, investShare: 0.2, keepCash: 50000000 }, // 3.0.0 자회사 봇(선택): 지난 1년 흑자이고 설립비 + 고정비 24개월 치가 있으면 설립, 해마다 1월에 현금이 keepCash(5,000억)와 고정비 24개월 치를 넘으면 그 넘는 몫의 20%를 투자가 가장 적은(설립비 대비) 브랜드 자회사에
    execCashMonths: 12, // 0.7.0 임원 봇: 지난 1년 흑자이고 현금이 고정비 12개월 치 이상일 때만 임원 자리를 채운다
    weakShare: 0.5, // 지난달 수요가 (한도 ÷ 판매 차종 수)의 50% 미만인 약한 차는 풀체인지 가능 시점(36개월)에 교체
    clumsy: { priceMult: 1.1, changeMonths: 120, testWeeks: 5 }, // 0.4.1 더 서툰 봇: 기준가의 110%로 출시, 풀체인지 10년, 시험 5주(0.4.2 시간 척도 전의 최소 2주와 같은 양)
    ptLookYears: 2, ptAwareness: 0.6, // 1.0.0 동력 고르기: 출시 약 2년 뒤 시장, 인지도 0.6으로 어림
    novice: { launchDefects: 10, changeMonths: 96, manageEvery: 6, expandRatio: 2, cheapShare: 0.1 }, // 0.4.1 서툰 플레이 봇: 화면 결함 10개쯤에서 출시, 풀체인지 8년(0.4.2: 7.5 → 8년, 신중이 6.5년이 되어), 6개월마다 채용·교육·연구(현금의 10% 이하인 기술만), 주문이 한도의 2배를 넘어야 증설
  },
  research: { // 10장 연구
    pointsDiv: 10, // 교육·휴식 중이 아닌 엔지니어 1명이 매주 능력 / 10 점(개발에 배치되어 있으면 그 30%)
    projectShare: 0.3, // 0.5.0: 개발 중인 엔지니어도 연구 점수의 30%를 낸다(창업 직후 전원 개발이라 연구가 0이었다)
    labMult: 1.5, labHq: 4, // 전담 연구원(본사 4등급부터): 산출 × 1.5
    slots: [3, 4, 5, 6, 6, 6, 6], // 본사 등급별 동시 연구 수. 0.4.2: 1/1/1/2/2 → 3/4/5/6/6(사용자 피드백: 연구 두 개는 박하다). 주간 점수는 시작 순으로 채우므로 칸이 늘어도 전체 속도는 같다
    earlyRate: 0.25, earlyMax: 4, // 등장 연도보다 먼저: 비용 × (1 + 0.25 × 앞당긴 햇수), 최대 4년
    lateYears: 8, lateMult: 0.5, // 등장 연도 + 8년이 지나면 비용 × 0.5
    repeatGrowth: 1.5, // 반복 기술(차세대)은 할 때마다 비용 × 1.5
    priorityShare: 0.5, // 0.5.1: 진행 중 연구는 주간 점수를 고르게 나눠 받고, 우선 연구가 있으면 그 연구가 50%, 나머지가 50%를 나눈다(다 끝나 남는 점수는 다른 연구로)
    worldFirst: 1, // 먼저 연구한 기술을 쓴 첫 차의 평론 +1(기술마다 한 번)
  },
  events: { // 11장 시대 사건
    shiftYears: 1, // 고정 사건 연도 ±1년(시드로 확정)
    warnMonths: 6, // 예고 뉴스: 시작 6개월 전
    lastEraYear: 2058, // 이 해 뒤로는 고정 사건이 없다(무작위 사건만). 1.2.0: 2035 → 2058(가상 사건)
    randomFrom: 1971, randomPerYear: [0.3, 0.5, 0.2], // 무작위 사건: 1971년부터 해마다 0/1/2회 확률
    choiceWeeks: 4, // 답하지 않으면 4주 뒤 기본 선택
    revenueMonths: 12, // 선택지 비용의 "최근 월평균 매출" 기간
    newsMax: 120, // 뉴스 기록 보관 개수(2.0.0 60 → 120: 경쟁 모델 세대교체 뉴스가 해마다 6~7건 더해진다)
    trendMin: 0.2, // 유행 계수 하한
    charging: { powertrain: 'ev', start: 0.05, perYear: 0.045 }, // 충전 인프라: 전기차 등장 사건부터 0.05, 해마다 +0.045(최대 1)
  },
  // 1.5.0 새 게임 선택지(설계서 9.8). 시작 연도: 그 해 1월에 시작, 시작 연도 − techSlackYears까지 나온 기술은 연구 완료.
  // byYear: 시작 연도별 시작 현금 배수(난이도 현금에 곱한다)·본사/공장 등급·직원 능력 가산·더 두는 직원 직무(그 시대 개발비 devEra·원가에 맞춤.
  // 보통 신중 봇 시드 8개 20년 파산 0, 맨손 포함. 2000년 ×300·2015년 ×500에서는 2015년 1판이 19년째에, 맨손 2000년 4판이 6~10년째에 파산해 올렸다)
  newGame: {
    years: [1970, 1985, 2000, 2015] as const, techSlackYears: 3,
    byYear: {
      '1970': { cash: 1, hq: 1, factory: 1, ability: 0, roles: [] as const },
      '1985': { cash: 12, hq: 2, factory: 2, ability: 15, roles: ['designer', 'tester'] as const },
      '2000': { cash: 400, hq: 2, factory: 3, ability: 35, roles: ['designer', 'engineer', 'tester', 'sales'] as const },
      '2015': { cash: 600, hq: 2, factory: 3, ability: 40, roles: ['designer', 'engineer', 'tester', 'sales'] as const },
    },
    conditions: { // 시작 현금 배수(난이도와 별개)
      normal: { name: '보통', cash: 1 },
      rich: { name: '넉넉한 자금', cash: 1.5 },
      lean: { name: '맨손', cash: 0.7 },
    },
    challenges: { // 고르면 해당 명령을 거절한다. 보상 없음(기록에만 남는다)
      evOnly: { name: '전기차만', desc: '전기 외 동력으로는 신차·풀체인지 개발을 시작할 수 없습니다. 2010년 이후 시작에서만.', minYear: 2010, powertrain: 'ev', max: 0 },
      names3: { name: '차종 세 개까지', desc: '차종(파생 포함)은 세 개까지. 풀체인지·페이스리프트는 됩니다.', minYear: 0, powertrain: '', max: 3 },
      noLoan: { name: '대출 없이', desc: '은행 대출을 받을 수 없습니다(구제 금융은 됩니다).', minYear: 0, powertrain: '', max: 0 },
      noExec: { name: '임원 없이', desc: '임원을 임명하거나 채용할 수 없습니다.', minYear: 0, powertrain: '', max: 0 },
    },
  },
  // 0.4.1 난이도(설계자 결정): 새 게임에서 고른다(인자를 빼면 easy). 예전 저장은 normal로 본다. 공식은 그대로, 아래 값을 읽는 자리에서 바꾼다.
  // cash: 시작 현금, loanBase: 대출 기본 한도, bankruptcyMonths: 파산 유예, rivalMult: 경쟁 차 A 배수, upkeepMult: 본사·공장 유지비 배수,
  // prototypeMult: 시제차 비용 배수, recallMult: 리콜 비용 배수(무상 수리 선택 포함), manyDefects: 평론 감점 결함 기준, bailouts: 구제 금융 횟수, repLossMult: 평판 감점 배수(혹평·리콜·단종, 0.5.1),
  // bigUpkeepMult(1.0.0): 공장 4등급 이상의 유지비 배수(upkeepMult 대신). 쉬움은 초반(공장 1~3등급) 유지비 절반을 그대로 두고 4등급부터 0.75배(쉬움의 중반 이후 돈이 보통의 2.5배를 넘지 않게)
  difficulty: {
    easy: { name: '쉬움', desc: '자금이 넉넉하고 경쟁이 약합니다. 처음 하는 분께 권합니다.', cash: 500000, loanBase: 500000, bankruptcyMonths: 24, rivalMult: 0.8, upkeepMult: 0.5, prototypeMult: 0.7, recallMult: 0.6, manyDefects: 20, bailouts: 2, repLossMult: 0.5, bigUpkeepMult: 0.75 },
    normal: { name: '보통', desc: '설계한 기본 균형입니다. 경영 게임에 익숙한 분께 맞습니다.', cash: 300000, loanBase: 300000, bankruptcyMonths: 12, rivalMult: 1, upkeepMult: 1, prototypeMult: 1, recallMult: 1, manyDefects: 15, bailouts: 1, repLossMult: 1, bigUpkeepMult: 1 },
    hard: { name: '어려움', desc: '자금이 빠듯하고 경쟁이 강하며, 구제 금융이 없습니다.', cash: 220000, loanBase: 200000, bankruptcyMonths: 6, rivalMult: 1.05, upkeepMult: 1.1, prototypeMult: 1, recallMult: 1, manyDefects: 15, bailouts: 0, repLossMult: 1, bigUpkeepMult: 1.1 },
  },
  exec: { // 0.7.0 임원(9.7). 금액 만원
    seats: [1, 2, 4, 5, 6, 6, 6], // 본사 등급별 임원 자리 수
    allowance: 300, // 직원을 임원으로 임명하면 월급에 더하는 수당(월)
    seatAllowance: [0, 0, 5000, 7000, 9000, 10000], // 0.8.0: 임원이 n명일 때 임원마다 더 붙는 수당(월). 2명까지(본사 1~2등급)는 0, 3명부터 누진. 임원이 정원 밖이 되어 균형을 여기와 replace(기준·폭·간격)로 맞춘다
    hiredPayMult: 1.6, // 외부에서 뽑은 임원의 월급 = 직원 월급 공식(능력) × 1.6
    postCost: 3000, candidates: 3, expireWeeks: 4, // 임원 공고비, 후보 수, 후보가 기다리는 주
    hireSkillMin: 45, hireSkillMax: 70, repBonusDiv: 10, // 외부 후보 능력 = 45~70 + 평판 효과/10(평판 100에서 +10, 1.0.0: 상한 대신 평판 효과가 완만해진다)
    match: 0.75, // 직원을 임명할 때 관련 직무가 아니면 임원 능력 = 직원 능력 × 0.75(관련 직무는 아래 related 배수)
    related: { hr: { sales: 1, tester: 0.85 }, product: { designer: 1, tester: 0.85 }, finance: { sales: 1 }, production: { tester: 1, engineer: 0.9 }, research: { engineer: 1 }, market: { sales: 1, designer: 0.9 } } as Record<string, Record<string, number>>,
    tiers: [40, 60], // 임원 능력 40 미만: 뭉뚱그린 말(1단계), 60 미만: 대상만 짚음(2단계), 60 이상: 수치까지(3단계)
    delegateSkill: 45, // 위임을 켤 수 있는 임원 능력
    perExec: 2, reissueMonths: 6, ignoredMonths: 18, reportsMax: 60, // 월 결산 때 임원별 제안 최대 2건, 같은 제안은 6개월(지운 제안은 18개월) 뒤에 다시, 보고함 60건 보관
    hr: { growGap: 15, weakGap: 12, restWeeks: 2, trainCashMonths: 6, trainMax: 2 }, // 교육 권유: 성장 여지 15 이상, 해고 권유: 성장 한계 + 같은 직무 평균보다 12 낮음, 자동 교육: 현금이 운영비 6개월 치 이상, 동시에 2명까지
    replace: { cashMonths: 6, minGain: 25, capGain: 5, gapMonths: 24, rejectYears: 2, retryWeeks: 8, maxTries: 2 }, // 교체 고용: 현금이 운영비 6개월 치 초과, 기준 = max(대상 능력 + 25, 같은 직무 평균), 기준 + 5를 넘는 후보는 오지 않음, 같은 직무는 교체를 마친 뒤 24개월 동안 다시 제안하지 않음(0.8.0: 임원이 정원 밖이 되어 교체의 폭·빈도를 줄인다. 기준은 15 → 25), 거절하면 2년, 기준 미달이면 8주 뒤 한 번 더
    // 1.4.0 자동 채용·해고(인사 임원). 자동 채용: 현금 기준은 replace.cashMonths, 기준 미달이면 replace.retryWeeks 뒤 다시. 자동 해고: 판정은 hr.weakGap(성장 한계 + 같은 직무 평균보다 12 낮음),
    // 입사 tenureMonths개월 미만 제외, 한 달 1명, 직무별 minPerRole명·전체 minStaff명은 남김, 퇴직금을 내고도 운영비 fireCashMonths개월 치가 남을 때만
    autoStaff: { tenureMonths: 12, minPerRole: 1, minStaff: 4, fireCashMonths: 1 },
    research: { cashMonths: 6 }, // 자동 연구: 연구비를 내고도 운영비 6개월 치가 남을 때
    finance: { warnMonths: 6, avgMonths: 3, repayMonths: 6 }, // 현금 부족 예고: 최근 3개월 평균 손실이면 6개월 안에 바닥날 때, 대출 상환 권유: 갚고도 운영비 6개월 치가 남을 때
    product: { fullChangeLife: 0.55, faceliftPayback: 24 }, // 풀체인지 권유: 수명 막대 55% 아래, 페이스리프트 권유: 비용 회수 24개월 이내
    market: { minSales: 30, lowAwareness: 0.35 }, // 새 차급 권유: 예상 월 판매 30대 이상, 광고 권유: 인지도 35% 아래
  },
  // 1.3.0 세대교체 위임(기획 임원): 판매 중 세대 나이(개월) faceliftAt부터 페이스리프트(fullChangeAt − faceliftGap 전까지만), fullChangeAt부터(또는 수명 막대가 exec.product.fullChangeLife 아래로) 풀체인지.
  // 노후(life.oldMonths 72개월) 전에 다음 세대가 나오도록 개발 기간(약 10~12개월)만큼 앞서 시작한다. 현금: 예상 개발비 × cashDevMult + 운영비 cashMonths개월 치 이상일 때만.
  // waitReportMonths개월 넘게 못 하면 이유를 한 번 보고. 자동 출시: 결함을 다 잡았거나 시험이 maxTestWeeks주를 넘으면
  genAuto: { faceliftAt: 30, fullChangeAt: 58, faceliftGap: 18, cashDevMult: 1.5, cashMonths: 6, waitReportMonths: 6, maxTestWeeks: 28 },
  nameMax: 16, // 1.5.0 차종 이름 최대 글자 수(이름 바꾸기 검증, 화면 입력칸 maxlength와 같다)
  derivative: { defectRate: 0.5 }, // 1.3.0 파생 모델 설계 중 결함은 보통의 절반 속도(차대를 그대로 쓴다). 종류별 수치는 data/variants.json
  // 1.3.0 개발 중 직원 성과: 배치된 직원마다 주당 확률 = chance × 능력, 크기는 능력에 비례(size [능력 0, 능력 100]). 프로젝트당 최대 maxPerProject건, 종류별 합계 상한 caps
  // (stat: 능력치 배수 합, cost: 원가 인하 합, acclaim: 인지도 가산 합, time: 줄인 설계 주). 세대 원가 인하 합은 costCutMax까지
  staffWins: { chance: 0.00012, maxPerProject: 3, caps: { stat: 0.08, cost: 0.02, acclaim: 0.06, time: 2 }, size: { stat: [0.015, 0.04], cost: [0.004, 0.012], acclaim: [0.015, 0.04], defects: [2, 6] }, costCutMax: 0.04 },
  devCheat: { cash: 5000000, reputation: 10 }, // 개발자 메뉴: 현금 +500억, 평판 +10
  forecast: { months: 3, spread: 0.3 }, // 0.5.0 출시 화면 예상 월 판매: 출시 3개월째 수요 ± 30%
  optionValue: { good: 1.05, bad: 0.8, fitMin: 0.2 }, // 1.0.0 옵션 값 = 원가 × good(그 옵션의 능력치에 대한 고객층 가중치 평균 ≥ fitMin) / bad(아니면). 차별 기준가에 더한다
  // 1.1.0 장비 구성(equip.ts). classPrice: 차급 경계(차체 기준가 2,000만 미만 소형, 4,500만 미만 중형, 그 위 대형·고급)
  // take: 기대 단계별 선택 사양 선택률 기본값, takeFit/takeMisfit: 고객층 궁합 배수, takeBigRare: 대형의 드문 장비 배수, optMarkup: 선택 사양 요금 = 원가 × 배수,
  // partBase·partPerRate: 선택 사양의 능력치 반영 = 0.3 + 0.5 × 선택률. missPen·optPen·freshBonus: 매력 배수(기대 장비 없음 −4.5%·선택 사양만 −1.5%·드문 장비를 기본으로 +2%, 최대 freshMax개), multMin: 하한.
  // review*: 평론 가감(기대 장비 없음 −0.3, 선택 사양만 −0.1, 드문 기본 장비 +0.15, 합 −1.5~+0.5).
  equip: { classPrice: [2000, 4500], take: { rare: 0.15, common: 0.4, expected: 0.75 }, takeFit: 1.3, takeMisfit: 0.5, takeBigRare: 1.5, takeMin: 0.03, takeMax: 0.9, optMarkup: 1.4,
    partBase: 0.3, partPerRate: 0.5, missPen: 0.045, optPen: 0.015, freshBonus: 0.02, freshMax: 3, multMin: 0.6,
    reviewMiss: 0.3, reviewOpt: 0.1, reviewFresh: 0.15, reviewMaxPen: 1.5, reviewMaxBonus: 0.5 },
  ledgerMonths: 24,
  price: { min: 0.6, max: 2.0 },
  pricePolicy: { pctMin: 80, pctMax: 120, pctChoices: [95, 100, 105] }, // 0.8.0 자동 가격: 기준가 유지 비율(%) 허용 범위와 화면 선택지
  // 0.10.0 실패한 차의 수습. 대상: 판매 중이고 평론 평균 reviewMax 이하이거나, 최근 poorMonths개월 평균 판매가 (공장 한도 ÷ 판매 차종 수)의 poorShare 미만
  rescue: {
    reviewMax: 4.5, poorMonths: 3, poorShare: 0.3,
    // 긴급 개선: 테스터·엔지니어가 fixWeeks주 시험만 한다(결함 감소는 시험과 같은 식). 주간 비용 = max(세대 개발비 × costShare ÷ fixWeeks, 그 팀의 보통 시험 한 주 비용 × testCostMult).
    // 뒤쪽 하한: 개선판이 '처음부터 시험을 더 한 경우'보다 싸지 않게(대충 내고 고치는 전략 방지). 끝나면 품질 × (1 + qGain), 평론·인지도·수명은 그대로. 세대당 1회
    fixWeeks: 8, costShare: 0.12, testCostMult: 1, qGain: 0.04,
    // 가격 인하 판매: 시장 기준가의 pct로 months개월 고정, 시작할 때 인지도 +awareness(광고 효과), 끝나면 자동 단종(평판 감점 없음). 수명 막대 lifeMax 이하이거나 평론 reviewMax 이하일 때만
    clearPct: 0.88, clearMonths: 6, clearAwareness: 0.08, lifeMax: 0.5,
  },
  // 0.10.0 판매 요인 분해의 기준 상태(이 값과 비교해 몇 % 깎거나 올렸는지). awareness: 기준 인지도, slumpShare·dropShare: 요약 한 줄을 띄우는 부진 기준
  factors: { awareness: 0.5, slumpShare: 0.3, dropShare: 0.3, minShow: 0.01 },
  todo: { candUrgentWeeks: 1, regUrgentMonths: 12 }, // 0.7.0 할 일 목록: 채용 후보가 이 주 이하로 남거나 규제 시행이 이 개월 이하로 남으면 급한 일
  // 1.2.0 전기차 시대(ev.ts). 동력이 events.charging.powertrain(전기)인 차에만 적용한다
  ev: {
    // 배터리 용량: cost = 전기 원가 가산(ptCostAdd) 배수, range = 주행 거리 배수, charge = 충전 시간 배수.
    // value = 시장이 쳐 주는 값 ÷ 원가 차이(차급별). 소형차는 작은 배터리의 절감분을 덜 깎아 주고, 대형차는 큰 배터리 값을 더 쳐 준다(표준은 지금과 같다)
    battery: {
      small: { name: '소형', cost: 0.7, range: 0.7, charge: 0.8, value: { small: 0.8, mid: 1, big: 1.2 } },
      std: { name: '표준', cost: 1, range: 1, charge: 1, value: { small: 1, mid: 1, big: 1 } },
      large: { name: '대형', cost: 1.4, range: 1.35, charge: 1.25, value: { small: 0.8, mid: 0.95, big: 1.05 } },
    },
    // 표준 배터리 주행 거리(km): 전기 동력 단계별 표(직선 보간), 표 뒤로는 단계마다 perLevel씩(연구로 계속 는다)
    range: { levels: [7, 8, 9, 10, 11, 12, 13, 14], km: [150, 220, 310, 420, 490, 550, 600, 640], perLevel: 30 },
    // 기대 주행 거리: 중형 기준 연도 표(표 뒤로는 마지막 값), 차급 배수(도심형 소형차는 덜 기대한다)
    expect: { years: [2010, 2015, 2020, 2025, 2030, 2040, 2050, 2060], km: [150, 200, 300, 400, 470, 550, 620, 660], class: { small: 0.65, mid: 1, big: 1.2 } },
    // 주행 거리 매력 = f(이 차) ÷ f(같은 단계 표준 배터리), f(u) = u^low(기대 미만) / 1 + high × min(u − 1, cap)(기대 이상), u = 주행 거리 ÷ 기대. 표준 배터리는 늘 1(지금과 같다)
    appeal: { low: 0.6, high: 0.15, cap: 0.5, min: 0.7, max: 1.15 },
    // 충전 속도: 충전 연구 단계(0~)별 10→80% 충전 분(표준 배터리)과 매력 가산. 표 뒤로는 마지막 값
    charge: { minutes: [60, 35, 20, 12, 8], appeal: [0, 0.04, 0.07, 0.09, 0.1] },
    // 전용 플랫폼: 실용 × (1 + u), 주행 거리 × (1 + range), 전기 원가 가산 × (1 − costCut)
    platform: { u: 0.06, range: 0.08, costCut: 0.2 },
    // 배터리 자체 생산: 등급별 건설비·월 유지비·전기차 대당 원가 절감·공사 개월. tech: 지을 수 있게 되는 연구
    plant: { tech: 'ec_ev', levels: [
      { cost: 3000000, upkeep: 150000, cut: 0.03, buildMonths: 9 },
      { cost: 15000000, upkeep: 500000, cut: 0.06, buildMonths: 12 },
      { cost: 60000000, upkeep: 1500000, cut: 0.09, buildMonths: 15 },
    ] },
  },
  // 3.0.0 자회사(sim/subs.ts, 설계서 9.9). 금액 만원, 기간 개월. 자회사 모델은 경쟁 모델(rivals)과 같은 구조(세대·주기·기본 A)로 그 차급 수요를 나눠 갖는다
  subs: {
    hqMin: 4, maxByHq: [0, 0, 0, 1, 3, 4, 4], // 세울 수 있는 본사 등급, 본사 등급별 자회사 수 상한
    kinds: {
      // cost: 설립비, rep: 필요 평판, bodies·segments: 맡을 수 있는 차급·고객층(segment: 기본 고객층),
      // price·unitCost·vol: 시장 기준가·대당 원가·판매 대수 배수, a: 모델 세기(기본 A) 가산, rep0: 설립 때 브랜드 평판 = 본사 평판 × rep0
      premium: { name: '고급 브랜드', cost: 20000000, rep: 120, bodies: ['sedanM', 'sedanL', 'coupe', 'suv', 'suvL', 'sports'], segments: ['rich', 'enthusiast', 'youth'], segment: 'rich', price: 1.3, unitCost: 1.2, vol: 0.7, a: 0.03, rep0: 0.6, color: '#2b3a55' },
      value: { name: '보급형 브랜드', cost: 15000000, rep: 100, bodies: ['kei', 'hatch', 'sedanS', 'suvS', 'minivan', 'sedanM'], segments: ['worker', 'family', 'youth', 'fleet'], segment: 'worker', price: 1, unitCost: 0.97, vol: 1.15, a: 0, rep0: 0.4, color: '#d9822b' },
      parts: { name: '부품 회사', cost: 10000000, rep: 100, color: '#5b7f5a' },
      finance: { name: '할부 금융', cost: 10000000, rep: 100, color: '#4a6fa5' },
    },
    defaultSub: { dividend: 50, share: 1 }, // 설립 때 배당 50%·공유 보통, 전략은 브랜드 growth·사업 stable
    switchMonths: 6, // 전략 전환 기간(효과가 이 기간에 걸쳐 직선으로 바뀐다)
    evFrom: 2010, // 전동화 전환을 고를 수 있는 해
    capPerCar: 4000, // 월 생산 한도 = 자본 ÷ 이 값(대)
    capitalPerModel: 10000000, // 모델 수 상한 = max(1, 자본 ÷ 이 값)(영역의 차급 수 이내)
    upkeep: 0.002, // 월 유지비 = 쓰는 자본 × 이 값(브랜드: min(자본, 판매 대수 × capPerCar), 사업: 자본). 남는 자본(유보·과잉 투자)에는 유지비가 없다
    dev: 20, // 모델 하나의 월 개발비 = 시장 기준가 × 이 값 × 전략·공유 배수
    pricePe: 2, // 가격을 기준(종류 배수)보다 내리면 세기 × (기준/가격)^이 값
    noise: 0.06, // 세대마다 기본 A ± 이 값(해시)
    presA: 0.1, noPres: 0.25, presCost: 0.04, presAllowance: 300, // 사장 능력 q = 능력/100(없으면 noPres): 기본 A + presA × (q − 0.5), 원가 × (1 − presCost × (q − 0.5) × 2), 사장 월급 = 직원 월급 + 수당
    techA: 0.16, // 본사 기술 수준(그해까지 나온 기술 중 연구한 몫 f): 기본 A + techA × (f − 1)(다 연구했으면 0)
    investA: 0.04, investMax: 0.2, // 본사가 넣은 돈(설립비 + 추가 투자)이 설립비의 2배가 될 때마다 기본 A + investA(최대 investMax). 재투자(이익 유보)는 생산 한도·모델 수만 늘린다
    repA: 0.05, repCap: 200, // 브랜드 평판: 기본 A + repA × (min(평판, repCap) − 100)/100
    aw: { base: 0.45, repDiv: 250 }, // 인지도: 점유 점수 × min(1, base + min(평판, repCap)/repDiv)(새 브랜드는 덜 알려져 있다)
    repDrift: 0.02, // 브랜드 평판은 해마다 본사 평판 × rep0 쪽으로 2%씩
    shareFx: [{ a: 0.02, dev: 1.15, cost: 1.03 }, { a: 0, dev: 1, cost: 1 }, { a: -0.04, dev: 0.75, cost: 0.94 }], // 공유 범위 좁게·보통·넓게: 기본 A(추정 평론 × 10), 개발비, 대당 원가
    cannibal: 0.25, // 제 살 깎기: 본사 차의 경쟁 합에 같은 차급 자회사 모델 A^지수 × 이 값을 더한다
    sellShare: 0.7, // 매각 대금 = 자본 × 이 값
    reportsMax: 40, monthsMax: 24,
    // 전략별 효과(전환 중에는 비중대로 섞는다). a: 기본 A 가산(rival은 상대의 주력 차급에서만), price·cost·dev·vol: 배수, payout: 배당 비율 배수(최대 100%),
    // cycle: 세대교체 주기(개월), max: 모델 수 상한(0 = 자본 상한까지, -1 = 지금 수 유지), subRep·hqRep: 해마다 자회사·본사 평판 가산
    strat: {
      growth: { name: '성장 중심', a: 0, price: 1, cost: 1, dev: 1.3, vol: 1, payout: 0.4, cycle: 54, max: 0, subRep: 0, hqRep: 0 },
      share: { name: '점유율 중심', a: 0.06, price: 0.96, cost: 1, dev: 0.9, vol: 1.1, payout: 1, cycle: 60, max: 0, subRep: 0, hqRep: 0 },
      profit: { name: '수익 중심', a: -0.03, price: 1.03, cost: 0.95, dev: 0.7, vol: 1, payout: 1.4, cycle: 78, max: -1, subRep: 0, hqRep: 0 },
      rival: { name: '경쟁사 대응', a: 0.1, price: 0.96, cost: 1, dev: 1.2, vol: 1, payout: 1, cycle: 48, max: 0, subRep: 0, hqRep: 0, noise: 2.5 },
      tech: { name: '기술 선도', a: 0.1, price: 1.04, cost: 1.02, dev: 1.7, vol: 1, payout: 1, cycle: 54, max: 0, subRep: 1.5, hqRep: 0.3 },
      stable: { name: '안정 유지', a: -0.01, price: 1, cost: 0.98, dev: 0.75, vol: 1, payout: 1, cycle: 72, max: -1, subRep: 0, hqRep: 0 },
      niche: { name: '틈새 공략', a: 0.02, price: 1.07, cost: 1, dev: 0.9, vol: 1, payout: 1, cycle: 66, max: 2, subRep: 0.5, hqRep: 0 },
      prestige: { name: '명성 구축', a: 0.2, price: 1.5, cost: 1.15, dev: 0.6, vol: 0.45, payout: 1, cycle: 60, max: 1, subRep: 4, hqRep: 1 },
      ev: { name: '전동화 전환', a: 0.02, price: 1, cost: 0.95, dev: 1.2, vol: 1, payout: 1, cycle: 60, max: 0, subRep: 0.5, hqRep: 0.2 },
    },
    business: ['growth', 'profit', 'stable'], // 사업 자회사가 고를 수 있는 전략
    notFor: { premium: ['share'], value: ['prestige'] } as Record<string, string[]>, // 브랜드 종류에 맞지 않는 전략
    // 사업 자회사: 규모 = min(scaleMax, (자본 ÷ 설립비)^0.5) × 사장 배수(0.75 + q/2) × 전략 배수(fx). 부품: 본사 원가 × (1 − cut × 규모)(최대 cutMax), 이익 = 본사 원가 × margin × 규모.
    // 금융: 본사 판매 × (1 + boost × 규모)(최대 boostMax), 이익 = 본사 매출 × financed × spread × 규모
    parts: { cut: 0.01, cutMax: 0.03, margin: 0.005 },
    finance: { boost: 0.015, boostMax: 0.04, financed: 0.3, spread: 0.014 },
    scaleMax: 3,
    bizFx: { growth: { fx: 1, margin: 0.9 }, profit: { fx: 0.85, margin: 1.35 }, stable: { fx: 1, margin: 1 } } as Record<string, { fx: number; margin: number }>,
  },
};
