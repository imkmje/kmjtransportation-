/** 모든 튜닝 수치(초기 예시값, 균형 점검 도구로 조정). 코드에 흩어 두지 않는다 */
export const config = {
  daysPerMonth: 30,
  demand: { K: 220, distExp: 0.8, distOffset: 0.5, elasticity: 2.5, repBoost: 0.3, offSeason: 0.06, holiday: [1.05, 0.95, 0.98, 1.0, 1.0, 1.02, 1.07, 1.06, 0.97, 1.0, 0.96, 1.06] }, // offSeason: 성수기에서 먼 달의 수요 감소, holiday: 월별 공통 계절 계수(1~12월, 평균 약 1)
  fare: { base: 40, perKm: 0.085, minRatio: 0.5, maxRatio: 2.0 }, // 운임($) = 기준 × 비율
  flight: { turnaroundH: 1.2, taxiH: 0.5, dailyHours: 14 },
  cost: { landingFeeK: 2.0, perPaxFee: 6, fixedMonthly: 1.0, perPlaneMonthly: 0.4, depreciationMonths: 120 }, // landingFeeK: 이착륙 1회(천 달러), perPaxFee: 승객당($), fixedMonthly: M
  start: { cash: 20, reputation: 0.3, plane: 'B737' },
  rules: { bankruptCash: -5, bankruptMonths: 2, winProfit: 100, timeLimitMonths: 24, winCities: 12 },
  events: { chancePerMonth: 0.42, costGrowth: 0.025, costMaxMult: 3, costPerPlane: 0.05, costFreePlanes: 2, festivalChance: 0.06, festivalLead: 6 }, // 사건 대응 비용 = 기본 × min(3, 1 + 2.5% × 지난 개월) × (1 + 5% × (항공기 수 − 2)). festival: 예고된 행사(올림픽·월드컵·축제)가 한 달에 잡힐 확률과 예고 기간(개월)
  invest: { // 허브 투자(도시별, 각 3단계): 취항 중인 도시나 출발 도시에만. 단계 총합 × upkeep($M)이 매달 고정비로 든다
    terminal: { name: '터미널 확장', prices: [8, 15, 26], slots: 4, delay: 0.15, desc: '공항 슬롯 +4, 이 공항의 혼잡 지연 −15%(단계마다)' },
    mro: { name: '정비 기지', prices: [7, 13, 22], decay: 0.15, serviceCut: 0.2, desc: '이 도시를 오가는 항공기의 정비 상태가 15% 덜 닳고 점검 비용이 20% 쌈(단계마다)' },
    lounge: { name: '프리미엄 라운지', prices: [6, 12, 20], biz: 0.18, desc: '이 도시를 오가는 노선의 비즈니스 수요 +18%(단계마다, 양끝 평균)' },
  },
  investUpkeep: 0.05, // 허브 투자 단계 총합 1당 매달 드는 운영비($M)
  eras: { firstFree: 18, lead: 6, rest: 6, list: [ // 시대: 몇 해마다 규칙이 바뀐다. 6개월 전에 예고하고, 끝나면 6개월 쉬었다가 다음 시대를 예고한다(첫 시대는 24개월차 이후)
    { id: 'oil', name: '유가 위기 시대', desc: '연료 가격이 높은 수준에서 유지됩니다. 연료 계약과 효율 좋은 신형기가 중요해집니다.', months: [30, 48], fuel: 1.35 },
    { id: 'carbon', name: '탄소세 시대', desc: '낡은 기체(7년 초과)의 운영비가 25% 늘고, 새로 출시된 기종은 8% 줄어듭니다. 기단을 새로 바꿀 때입니다.', months: [36, 60], oldCost: 0.25, newCost: -0.08 },
    { id: 'noise', name: '소음 규제 시대', desc: '낡은 기체(7년 초과)는 공항 슬롯을 40% 더 차지합니다. 허브가 금방 꽉 찹니다.', months: [36, 60], oldSlots: 0.4 },
    { id: 'boom', name: '호황기', desc: '경기가 좋아 수요가 늘고 은행 대출도 쉬워집니다. 공격적으로 넓힐 기회입니다.', months: [24, 42], econ: 1.08 },
    { id: 'dereg', name: '항공 자유화 시대', desc: '신생 항공사가 두 배로 많이 생기고, 운임 전쟁도 두 배로 잦아집니다.', months: [30, 48], entry: 2, war: 2 },
    { id: 'slump', name: '장기 침체기', desc: '경기가 오래 나쁩니다. 은행이 대출을 자주 멈추니 현금을 아끼세요.', months: [24, 36], econ: 0.92 },
  ] } as { firstFree: number; lead: number; rest: number; list: { id: string; name: string; desc: string; months: [number, number]; fuel?: number; econ?: number; oldCost?: number; newCost?: number; oldSlots?: number; entry?: number; war?: number }[] },
  contract: { planeBook: 1, firstMonth: 3, gap: [2, 4], maxTotal: 4, maxActive: 2, offerMonths: 3, rewardMonths: 3.5, rewardMin: 8, rewardMax: 120, kindMult: { cities: 1, pax: 0.85, otp: 0.6, profit: 0.8 }, repLoss: 0.02, otpTarget: 0.95 }, // 계약 제안: 보상은 최근 월 이익의 6배(최소 $15M)로 크게 주고, 실패해도 평판만 조금 깎인다
  auction: { price: 0.4, age: 60, cond: 0.75, months: 3, maxLots: 4 }, // 파산한 경쟁사의 항공기 경매: 새 기체 값의 40%, 5년 된 정비 상태 75% 기체, 3개월간
  fuel: { reversion: 0.1, noise: 0.18, min: 0.6, max: 1.9, share: 0.4, hedgeCost: 1.2, hedgeMonths: 6, hedgeTiers: [{ months: 3, cost: 0.7 }, { months: 6, cost: 1.2 }, { months: 12, cost: 2.2 }] }, // 연료 가격 지수와 계약. share: 운영비 중 연료 비중
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
  aging: { maintPerMonth: 0.004, maxMult: 1.6, capStart: 84, capPerMonth: 0.004, capMin: 0.5, replaceBelow: 0.75 }, // capStart~: 7년이 넘으면 점검해도 정비 상태가 100%까지 안 돌아온다(상한 = 1 − 0.4%/월, 최소 50%). 상한이 75% 아래면 교체 권고. 점검 비용도 노후 배수만큼 든다. 아래는 원래 설명: // 노후 1개월당 운영비 +0.4%(최대 +60%)
  rivalry: { // 자유 모드 경쟁 강화(시나리오는 균형 때문에 적용하지 않는다)
    traits: { // 경쟁사 성격(자유 모드에서 ID로 정해진다)
      aggro: { name: '공세형', desc: '운임 전쟁을 자주 겁니다', war: 2 },
      expander: { name: '확장형', desc: '항공기를 빠르게 늘립니다', buy: 0.7, planes: 1.3 },
      quality: { name: '서비스형', desc: '서비스가 좋아 점유율에 유리합니다', q: 1.12 },
      steady: { name: '안정형', desc: '사고·파업 같은 충격에 강합니다', shock: 0.4 },
    },
    threat: { minPlanes: 3, chance: 0.06, lead: 2, minProfit: 0.3 }, // 내 이익 큰 노선에 진출 예고: 일반 경쟁사 항공기 minPlanes대 이상, 한 달 chance 확률, lead개월 전 예고
    slots: { perRoute: 0.5 }, // 경쟁사가 도시에 노선 1개를 가질 때마다 빈 슬롯 0.5개씩 선점
    rival: { startMonth: 12 }, // 라이벌 지정 시작(개월차)
    merge: { chance: 0.05, minMonth: 18 }, // 경쟁사 합병: 한 달 확률
    ad: { cost: 2, months: 3, boost: 1.25 }, // 맞대응 광고: 비용($M), 기간(개월), 점유율 가중치
  },
  story: { // 이야기 사건(자유 모드): 한 번에 하나, 선택하면 결과가 갈린다
    chance: 0.12, minMonth: 6, expires: 2,
    list: [
      { id: 'celeb', title: '유명 인플루언서가 우리 항공사를 칭찬했습니다', desc: '협찬 계약을 제안받았습니다.', choices: [{ label: '협찬 $3M', cash: -3, rep: 0.05, result: '화제가 되어 평판이 올랐습니다.' }, { label: '그냥 둔다', rep: 0.01, result: '조용히 지나갔지만 조금은 알려졌습니다.' }] },
      { id: 'union', title: '조종사 노조가 임금 인상을 요구합니다', desc: '협상이 결렬되면 파업이 날 수 있습니다.', choices: [{ label: '수용 $4M', cash: -4, rep: 0.02, result: '협상이 타결돼 사기가 올랐습니다.' }, { label: '거부', risk: { chance: 0.5, cash: -10, rep: -0.03, text: '파업이 일어나 $10M 손실을 입었습니다.' }, result: '협상은 결렬됐지만 파업은 피했습니다.' }] },
      { id: 'green', title: '환경 단체가 배출가스를 항의합니다', desc: '언론이 관심을 보이고 있습니다.', choices: [{ label: '탄소 상쇄 $2.5M', cash: -2.5, rep: 0.03, result: '친환경 항공사로 호평받았습니다.' }, { label: '무시', rep: -0.03, result: '비판 기사가 나와 평판이 내려갔습니다.' }] },
      { id: 'group', title: '대형 여행사가 단체 계약을 제안합니다', desc: '일정이 빠듯하지만 현금이 바로 들어옵니다.', choices: [{ label: '수락 +$6M', cash: 6, rep: -0.01, result: '현금을 받았지만 빡빡한 일정에 불만이 조금 나왔습니다.' }, { label: '거절', result: '제안을 정중히 거절했습니다.' }] },
      { id: 'airport', title: '공항이 터미널 확장 공사를 알렸습니다', desc: '지금 투자하면 슬롯을 먼저 확보할 수 있습니다.', choices: [{ label: '투자 $4M', cash: -4, slot: true, result: '가장 많이 취항하는 도시의 슬롯 1개를 확보했습니다.' }, { label: '관망', result: '공사가 끝나길 기다리기로 했습니다.' }] },
      { id: 'test', title: '제조사가 신기종 시범 운항을 제안합니다', desc: '홍보 효과가 있지만 비용이 듭니다.', choices: [{ label: '참여 $1.5M', cash: -1.5, rep: 0.04, result: '시범 운항이 보도돼 평판이 올랐습니다.' }, { label: '거절', result: '제안을 사양했습니다.' }] },
      { id: 'rumor', title: '경쟁사가 우리 정비 소문을 퍼뜨립니다', desc: '근거 없는 소문이지만 퍼지고 있습니다.', choices: [{ label: '해명 광고 $2M', cash: -2, result: '해명이 받아들여져 소문이 가라앉았습니다.' }, { label: '무시', risk: { chance: 0.5, rep: -0.04, text: '소문이 퍼져 평판이 내려갔습니다.' }, result: '소문은 저절로 사라졌습니다.' }] },
    ],
  },
  season: { start: 12, rewardMonths: 2.5, rewardMin: 5, rewardMax: 60, rep: 0.02 }, // 올해의 도전(자유 모드): 매년 하나, 보상은 월 이익의 rewardMonths배
  acquire: { min: 6, perPlane: 0.3, perRoute: 0.8, distress: 0.55, maxPlanes: 8, slots: 2, rep: 0.03 }, // 경쟁사 인수: 가격 = (항공기 × B7-37 값 × perPlane + 노선 × perRoute) (자금난이면 ×distress). 항공기(최대 maxPlanes)·거점 슬롯·평판을 받는다
  reopen: { months: 6, fee: 1.5, rep: 0.01 }, // 노선 폐지: 운항 중이던 노선을 닫으면 평판 −rep, 닫은 지 months개월 안에 다시 열면 fee($M)
  sale: { ratio: 0.9 }, // 매각가 = 장부가 × 0.9
  slot: { base: 6, perSize: 0.35, price: 2, priceStep: 0.2, lease: 0.12 }, // 공항 1일 이착륙 한도 = base + perSize × 시장 규모 + 구매분. 구매가(M)·월 임대료(M)
  rights: { // 지역 운수권(자유 모드): 처음에는 출발 도시가 속한 지역만 열려 있고, 돈과 누적 이익을 갖추면 다른 지역을 살 수 있다
    regions: { EA: '동아시아', SEA: '동남아시아', SAME: '남아시아·중동', EU: '유럽', AF: '아프리카', NA: '북미', LA: '중남미', OC: '오세아니아' } as Record<string, string>,
    price: [[2500, 6], [6000, 10], [10000, 16], [Infinity, 24]] as [number, number][], // 이미 가진 지역과 가장 가까운 도시 사이 거리(km)가 이보다 짧으면 이 값($M)
    need: [5, 20, 45, 85, 140, 210, 300], // 가진 지역 수(1부터)별로 다음 지역을 사려면 필요한 누적 이익($M)
  },
  lease: { rate: 0.03, deposit: 2, minMonths: 12, extra: 2, buyoutDrop: 0.005, buyoutMin: 0.5 }, // 임대: 월 임대료 = 새 기체 값 × 3%, 보증금 2개월치(반납 때 돌려받음), 최소 12개월(그 전에 반납하면 남은 개월 임대료를 위약금으로, 최소 1개월). 임대기 수는 보유기 + 2대까지. 매입가 = 새 기체 값 × (1 − 0.5% × 사용 개월), 최소 50%
  used: { price: 0.55, age: 96, cond: 0.7 }, // 중고기: 새 기체 값의 55%, 8년 된 기체(운영비가 더 든다), 정비 상태 70%
  ally: { fee: 0.4, weight: 0.5 }, // 제휴(공동 운항): 월 수수료(M). 제휴사가 같은 노선에서 우리 손님을 빼앗는 힘이 절반이 된다
  transfer: { share: 0.1, maxDetour: 1.4, seatCap: 0.3 }, // seatCap: 이어지는 노선 좌석의 30%까지만 환승 손님으로 센다 // 환승: 직항이 없는 도시 쌍 수요의 10%가 우리 허브를 거쳐 간다(돌아가는 거리가 직선의 1.4배 이내일 때)
  upgrades: { // 회사 업그레이드: 돈을 내고 영구히 올린다(각 3단계, 단계가 오를수록 비싸다). effect는 1단계당 효과
    prices: [8, 13, 20], // 같은 단계는 같은 값. 측정 도구(payback 테스트)로 "중반 항공사에서 본전을 뽑는 기간"이 비슷해지도록 맞췄다
    list: [
      { id: 'marketing', name: '브랜드 마케팅', desc: '모든 노선의 손님 수요 +6%', effect: 0.06 },
      { id: 'ops', name: '운항 최적화', desc: '노선 운영비 −5%', effect: 0.05 },
      { id: 'hangar', name: '정비 격납고', desc: '정비 상태가 닳는 속도 −15%, 점검 비용 −10%', effect: 0.15, effect2: 0.1 },
      { id: 'ground', name: '지상 조업 강화', desc: '지연(정시율 하락) −35%', effect: 0.35 },
      { id: 'service', name: '기내 서비스', desc: '비즈니스석 수요 +20%', effect: 0.2 },
    ],
  },
  hub: { perLink: 0.04, max: 0.16 }, // 한 도시에 노선이 여러 개면 그 도시 수요 +4%씩(최대 +16%)
  cabin: { bizSeatArea: 2.5, bizFareMult: 2.8, bizElasticity: 1.2, shares: [0, 0.1, 0.2, 0.3] }, // 비즈니스 좌석 1개 = 일반석 2.5개 면적
  cargo: { K: 240, distExp: 0.6, base: 300, perKm: 0.45, elasticity: 1.5 }, // 화물 수요(톤/월), 운임($/톤) = base + perKm × km
  growth: { perMonth: 0.003, decay: 0.02, max: 1.8 }, // 운항 중인 도시는 매달 시장이 자란다
  competitors: { major: { name: '글로벌 스카이', hubs: ['DXB', 'FRA', 'JFK', 'SIN'], startMonth: 9, base: 3, perMonth: 0.12, perPlayerPlane: 0.8, cap: 45, eff: 0.97, addPerMonth: 1, bidChance: 0.3, invadeChance: 0.15, warMult: 2, seatMult: 2 }, // 대형 항공사: 파산하지 않고, 시장(내 항공기 수·시간)에 맞춰 커지며, 내 노선에 들어오고, 경매에도 입찰한다
    start: 2, max: 6, entryChance: 0.1, entryMinMonth: 4, entryCash: 0.6, bankruptMonths: 3, effSpread: 0.12, shockChance: 0.012, shockMin: 10, shockMax: 40, // start: 처음에 있는 경쟁사 수, max: 동시에 있을 수 있는 최대 수, entryChance: 한 달에 신생 항공사가 생길 확률, bankruptMonths: 현금이 마이너스인 채 이만큼 지나면 파산, effSpread: 항공사마다 운영 효율이 ±12% 다르다
    startCash: 120, maxPlanesBase: 2, maxPlanesPerMonth: 0.35, maxPlanesCap: 10, costRatio: 0.62, planeFixed: 0.4, profitScale: 1.8, buyRatio: 0.5 }, // 자유 모드에서만: profitScale: 경쟁사 이익 배수(시나리오는 목표 균형 때문에 1배), buyRatio: 항공기 한 대를 살 때 실제로 현금에서 나가는 비율(나머지는 할부)
};
export type Config = typeof config;
