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
  strategy: { svcWeight: [1, 1.1, 1.22], svcCost: [0, 0.12, 0.3], svcName: ['기본', '고급', '최고급'], undercut: 0.95 }, // 점유율 전략: 노선 서비스 등급(경쟁사와 나누는 몫의 가중치, 항공기 1대당 월 비용 $M), 점유율 우선 운임은 경쟁사 최저가의 95%
  rivalry: { // 자유 모드 경쟁 강화(시나리오는 균형 때문에 적용하지 않는다)
    traits: { // 경쟁사 성격(자유 모드에서 ID로 정해진다)
      aggro: { name: '공세형', desc: '운임 전쟁을 자주 겁니다', war: 2 },
      expander: { name: '확장형', desc: '항공기를 빠르게 늘립니다', buy: 0.7, planes: 1.3 },
      quality: { name: '서비스형', desc: '서비스가 좋아 점유율에 유리합니다', q: 1.12 },
      steady: { name: '안정형', desc: '사고·파업 같은 충격에 강합니다', shock: 0.4 },
    },
    threat: { minPlanes: 3, chance: 0.06, lead: 2, minProfit: 0.3 }, // 내 이익 큰 노선에 진출 예고: 일반 경쟁사 항공기 minPlanes대 이상, 한 달 chance 확률, lead개월 전 예고
    slots: { perRoute: 0.3, maxPerCity: 4 }, // 경쟁사 노선 1개마다 빈 슬롯 0.3개 선점, 한 도시에 최대 4개(입찰로 딴 것은 따로)
    rival: { startMonth: 12 }, // 라이벌 지정 시작(개월차)
    merge: { chance: 0.05, minMonth: 18 }, // 경쟁사 합병: 한 달 확률
    ad: { cost: 2, months: 3, boost: 1.25 }, // 맞대응 광고: 비용($M), 기간(개월), 점유율 가중치
  },
  story: { // 이야기 사건(자유 모드): 한 번에 하나, 선택하면 결과가 갈린다
    chance: 0.12, minMonth: 6, expires: 2,
    list: [
      { id: 'celeb', title: '유명 인플루언서가 우리 항공사를 칭찬했습니다', desc: '협찬 계약을 제안받았습니다.', choices: [{ label: '협찬 $3M', cash: -3, rep: 0.05, result: '화제가 되어 평판이 올랐습니다.', next: { id: 'celeb2', months: 8 } }, { label: '그냥 둔다', rep: 0.01, result: '조용히 지나갔지만 조금은 알려졌습니다.' }] },
      { id: 'union', title: '조종사 노조가 임금 인상을 요구합니다', desc: '협상이 결렬되면 파업이 날 수 있습니다.', choices: [{ label: '수용 $4M', cash: -4, rep: 0.02, result: '협상이 타결돼 사기가 올랐습니다.', next: { id: 'union2', months: 12 } }, { label: '거부', risk: { chance: 0.5, cash: -10, rep: -0.03, text: '파업이 일어나 $10M 손실을 입었습니다.' }, result: '협상은 결렬됐지만 파업은 피했습니다.' }] },
      { id: 'green', title: '환경 단체가 배출가스를 항의합니다', desc: '언론이 관심을 보이고 있습니다.', choices: [{ label: '탄소 상쇄 $2.5M', cash: -2.5, rep: 0.03, result: '친환경 항공사로 호평받았습니다.', next: { id: 'green2', months: 12 } }, { label: '무시', rep: -0.03, result: '비판 기사가 나와 평판이 내려갔습니다.' }] },
      { id: 'group', title: '대형 여행사가 단체 계약을 제안합니다', desc: '일정이 빠듯하지만 현금이 바로 들어옵니다.', choices: [{ label: '수락 +$6M', cash: 6, rep: -0.01, result: '현금을 받았지만 빡빡한 일정에 불만이 조금 나왔습니다.' }, { label: '거절', result: '제안을 정중히 거절했습니다.' }] },
      { id: 'airport', title: '공항이 터미널 확장 공사를 알렸습니다', desc: '지금 투자하면 슬롯을 먼저 확보할 수 있습니다.', choices: [{ label: '투자 $4M', cash: -4, slot: true, result: '가장 많이 취항하는 도시의 슬롯 1개를 확보했습니다.' }, { label: '관망', result: '공사가 끝나길 기다리기로 했습니다.' }] },
      { id: 'test', title: '제조사가 신기종 시범 운항을 제안합니다', desc: '홍보 효과가 있지만 비용이 듭니다.', choices: [{ label: '참여 $1.5M', cash: -1.5, rep: 0.04, result: '시범 운항이 보도돼 평판이 올랐습니다.' }, { label: '거절', result: '제안을 사양했습니다.' }] },
      { id: 'subStrike', needSub: true, title: '자회사 노조가 파업을 예고했습니다', desc: '모회사가 지원하면 협상이 쉬워집니다.', choices: [{ label: '지원 $3M', cash: -3, rep: 0.01, result: '자회사 노사가 합의해 파업을 피했습니다.' }, { label: '자회사에 맡긴다', risk: { chance: 0.5, subCash: -15, text: '파업이 일어나 자회사가 $15M 손실을 입었습니다.' }, result: '자회사가 스스로 협상을 마무리했습니다.' }] },
      { id: 'subIndep', needSub: true, title: '자회사 경영진이 독립을 원합니다', desc: '지분을 넉넉한 값에 되사겠다고 제안합니다.', choices: [{ label: '지분 매각(웃돈 25%)', subSell: true, result: '지분을 웃돈을 받고 팔았습니다. 이제 독립한 경쟁사입니다.' }, { label: '거절', rep: -0.01, result: '경영진을 설득해 자회사로 남겼습니다(관계가 조금 서먹해졌습니다).' }] },
      { id: 'film', title: '영화 제작사가 기내 촬영을 요청합니다', desc: '개봉하면 홍보가 되지만 촬영 동안 한 편이 멈춥니다.', choices: [{ label: '허락(+$2M)', cash: 2, rep: 0.03, result: '영화에 우리 항공기가 나와 화제가 됐습니다.' }, { label: '거절', result: '정중히 거절했습니다.' }] },
      { id: 'vip', title: '유명 배우가 전용기 대신 우리 항공편을 타겠다고 합니다', desc: '특별 서비스를 준비하면 좋은 인상을 남깁니다.', choices: [{ label: '특별 준비 $1M', cash: -1, rep: 0.04, result: '배우의 칭찬 글이 퍼졌습니다.' }, { label: '평소대로', risk: { chance: 0.4, rep: -0.02, text: '불편했다는 후기가 퍼졌습니다.' }, result: '무난하게 지나갔습니다.' }] },
      { id: 'saga1', chain: true, title: '글로벌 스카이가 우리 본사 공항의 슬롯을 사들이려 합니다', desc: '대형 항공사가 우리 안방 공항까지 노리기 시작했습니다. 이 다툼은 몇 년 동안 이어질 것입니다.', choices: [{ label: '맞서 슬롯 확보 $40M', cash: -40, slot: true, rep: 0.02, next: { id: 'saga2', months: 24 }, result: '먼저 슬롯을 확보해 안방을 지켰습니다.' }, { label: '양보한다', baseTaken: 4, next: { id: 'saga2', months: 24 }, result: '글로벌 스카이가 본사 공항 슬롯 4개를 가져갔습니다.' }] },
      { id: 'saga2', chain: true, title: '글로벌 스카이가 본사 공항 운영권을 노립니다', desc: '공항 당국에 거액을 제시했다는 소문입니다. 운영권을 빼앗기면 슬롯이 더 줄어듭니다.', choices: [{ label: '방어 투자 $80M', cash: -80, rep: 0.04, next: { id: 'saga3', months: 24 }, result: '공항 당국과 장기 협약을 맺어 운영권 다툼을 막았습니다.' }, { label: '양보한다', baseTaken: 3, rep: -0.02, next: { id: 'saga3', months: 24 }, result: '운영권 일부를 내줘 슬롯 3개를 잃었습니다.' }] },
      { id: 'saga3', chain: true, title: '글로벌 스카이가 정면 대결을 선언합니다', desc: '"1년 뒤 매출로 누가 하늘의 주인인지 가리자." 받아들이면 12개월 동안 매출로 겨룹니다. 이기면 큰 보상, 지면 큰 손해입니다.', choices: [{ label: '대결을 받아들인다', duel: true, result: '12개월 매출 대결이 시작됐습니다. 현황 탭에서 진행을 볼 수 있습니다.' }, { label: '피한다', rep: -0.03, result: '대결을 피했습니다. 업계는 우리를 한 수 아래로 봅니다.' }] },
      { id: 'union2', chain: true, title: '작년 임금 합의가 만료돼 노조가 재협상을 요구합니다', desc: '지난번 수용한 조건을 이어 갈지 정해야 합니다.', choices: [{ label: '재계약 $5M', cash: -5, rep: 0.01, result: '노사 관계가 안정됐습니다.' }, { label: '동결', risk: { chance: 0.6, cash: -12, rep: -0.02, text: '파업이 일어나 $12M 손실을 입었습니다.' }, result: '노조가 동결을 받아들였습니다.' }] },
      { id: 'celeb2', chain: true, title: '그 인플루언서가 장기 홍보 계약을 제안합니다', desc: '지난 협찬 반응이 좋아 1년 계약을 원합니다.', choices: [{ label: '1년 계약 $6M', cash: -6, rep: 0.06, result: '꾸준한 홍보로 평판이 크게 올랐습니다.' }, { label: '거절', result: '한 번으로 충분하다고 판단했습니다.' }] },
      { id: 'green2', chain: true, title: '친환경 인증 심사가 열립니다', desc: '지난번 탄소 상쇄 덕분에 인증 후보가 됐습니다.', choices: [{ label: '인증 투자 $4M', cash: -4, rep: 0.05, result: '친환경 인증을 받아 평판이 올랐습니다.' }, { label: '포기', result: '이번 심사는 건너뛰었습니다.' }] },
      { id: 'accident', chain: true, title: '항공기 고장으로 승객들이 크게 불편을 겪었습니다', desc: '언론이 대응을 지켜보고 있습니다.', choices: [{ label: '사과와 보상 $4M', cash: -4, rep: 0.01, result: '빠른 사과와 보상으로 신뢰를 지켰습니다.' }, { label: '원인 공개 조사 $2M', cash: -2, result: '투명한 조사로 비판이 가라앉았습니다.' }, { label: '최소 대응', rep: -0.04, result: '대응이 미흡하다는 비판을 받았습니다.' }] },
      { id: 'rumor', title: '경쟁사가 우리 정비 소문을 퍼뜨립니다', desc: '근거 없는 소문이지만 퍼지고 있습니다.', choices: [{ label: '해명 광고 $2M', cash: -2, result: '해명이 받아들여져 소문이 가라앉았습니다.' }, { label: '무시', risk: { chance: 0.5, rep: -0.04, text: '소문이 퍼져 평판이 내려갔습니다.' }, result: '소문은 저절로 사라졌습니다.' }] },
    ],
  },
  season: { start: 12, rewardMonths: 2.5, rewardMin: 5, rewardMax: 60, rep: 0.02 }, // 올해의 도전(자유 모드): 매년 하나, 보상은 월 이익의 rewardMonths배
  livery: ['#ffffff', '#ffd86b', '#ff9d6b', '#7cc4ff', '#8fdc9c', '#c9a6ff', '#ff8fb1'], // 도색(지도의 내 비행기 색) 고를 수 있는 색
  extra: { // 자유 모드 재미 요소(시나리오에는 적용하지 않는다)
    loyalty: { names: ['없음', '기본', '풍성'], join: [0, 0.02, 0.035], churn: [0.1, 0.01, 0.005], costPerM: [0, 5, 11], maxBoost: [0, 0.06, 0.12],
      promote: [0.01, 0.03, 0.02], eliteChurn: 0.01, tierCost: [0.5, 2, 5], bizMax: [0, 0.1, 0.2], // 등급: 일반→실버 1%/월, 실버→골드 3%, 골드→플래티넘 2%. 등급 회원은 비용이 더 든다(일반 대비 +50%·+200%·+500%). (골드 + 2×플래티넘) ÷ 월 탑승객만큼 비즈니스 수요(기본 최대 +10%, 풍성 +20%)
      card: { fee: 3, perM: 4, join: 1.25 }, // 제휴 신용카드: 가입비 $3M, 회원 100만 명당 월 $4M 수입, 가입 1.25배
      promo: { base: 1.5, perM: 1.5, join: 3, boost: 0.04, months: 2, cool: 6 } }, // 마일 2배 프로모션: $3M + 회원 100만 명당 $1.5M, 2개월간 가입 3배·수요 +4%, 끝나고 6개월 뒤 다시 // 마일리지: 탑승객 중 가입 비율, 월 이탈, 회원 100만 명당 월 비용($M), 최대 수요 증가
    charter: { chance: 0.15, startMonth: 6, maxOffers: 2, offerMonths: 2, months: [2, 4], seats: [120, 180, 250], payK: 0.0055 }, // 전세기 주문
    alliance: { max: 3, joinFee: 3, monthly: 0.3, weight: 0.5, codeshare: 0.3, rivalMonth: 24, rivalQ: 1.08, // 항공 동맹
      levels: [12, 36, 72, 120], lvCodeshare: 0.05, lvWeight: 0.05, // 동맹 경험치(매달 회원 수만큼): 12·36·72·120이면 2~5등급. 등급마다 환승 +0.05, 동맹사가 빼앗는 힘 −0.05, 3·5등급에 회원 한도 +1
      projects: { mkt: { name: '공동 마케팅', desc: '12개월간 동맹사가 다니는 도시의 내 노선 수요 +4%', cost: 15, rev: 0.2, months: 12, boost: 0.04 }, lounge: { name: '공동 라운지', desc: '모든 내 노선 별점 +0.3(영구)', cost: 25, rev: 0.4, rating: 0.3 }, terminal: { name: '공동 터미널', desc: '본사 공항 슬롯 +6(영구)', cost: 40, rev: 0.3, slots: 6 } } as Record<string, { name: string; desc: string; cost: number; rev: number; months?: number; boost?: number; rating?: number; slots?: number }>, // 비용 = max(기본, 최근 월평균 매출 × rev)
      poach: { chance: 0.06, months: 2 }, recruit: { base: 0.3, perLv: 0.1, fee: 10, ratio: 0.15 }, // 스카이 동맹의 영입 시도(월 6%), 내가 스카이 회원을 데려오기: $10M + 인수가의 15%, 성공 30% + 등급마다 10%
      meetMonth: 6, meetMonths: 2, agendaMonths: 12, agendas: { fare: { name: '공동 운임', desc: '12개월간 동맹사와 겹치는 내 노선 수요 +5%' }, buy: { name: '공동 구매', desc: '12개월간 새 항공기 값 −5%' }, expand: { name: '회원 확대', desc: '12개월간 회원 한도 +1, 가입비 면제' } } as Record<string, { name: string; desc: string }> }, // 해마다 7월 동맹 회의(2개월 안에 안건 선택)
    bid: { months: 2, step: 2, concessionChance: 0.08, concessionMin: 10, concessionMonths: 60, concessionSlots: 3, concessionFee: 0.7, airportChance: 0.04, airportPublic: 3, airportLot: 5, startMonth: 12 }, // 입찰: 공항 운영권·신공항 슬롯
    rating: { weight: 0.04 }, // 별점 1점당 수요 ±4%
    award: { rep: 0.02 }, // 연말 시상식 수상 1개당 평판
    mega: { scalePer: 150, list: [ // scalePer: 비용 = 기본 비용 × max(1, 최근 12개월 매출 ÷ $150M) — 회사가 클수록 큰 사업도 비싸진다(착공 때 고정)
      { id: 'terminal', name: '전용 터미널', desc: '출발 도시에 슬롯 +12', cost: 120, months: 24 },
      { id: 'mro', name: '정비 단지', desc: '모든 항공기의 정비 상태가 20% 덜 닳음', cost: 150, months: 30 },
      { id: 'academy', name: '항공 학교', desc: '정시율 +3%p, 완공 때 평판 +5%', cost: 90, months: 18 },
      { id: 'airport', name: '허브 공항 건설', desc: '고른 도시에 내 공항: 슬롯 +30, 내 착륙료 면제, 그 도시를 쓰는 경쟁사 노선마다 월 사용료', cost: 300, months: 30 },
      { id: 'own_KX200', name: '자체 기종 개발: KX-200', desc: '200석 단거리 고효율기. 완성되면 나만 살 수 있고, 경쟁사 항공기 수에 비례해 기술료', cost: 400, months: 36 },
      { id: 'own_KX300', name: '자체 기종 개발: KX-300', desc: '300석 중거리 광동체. 완성되면 나만 살 수 있고 기술료', cost: 600, months: 42 },
      { id: 'own_KX400', name: '자체 기종 개발: KX-400', desc: '400석 장거리 광동체. 완성되면 나만 살 수 있고 기술료', cost: 800, months: 48 },
    ] },
    found: { capital: [40, 90, 180], planes: [2, 4, 8], cashShare: 0.35, max: 3, regionalKm: 1500, regionalSeat: 0.55, sizes: ['소', '중', '대'], kinds: { low: { name: '저가 항공사', desc: '운임이 싸고 운영비가 낮습니다', eff: 1.05 }, premium: { name: '프리미엄 항공사', desc: '운임이 비싸고 품질이 높습니다', eff: 0.97 }, regional: { name: '지역 항공사', desc: '1,500km 안 단거리만, 작은 기체로 자주 다닙니다', eff: 1 } } as Record<string, { name: string; desc: string; eff: number }> }, // 자회사 차리기: 자본금(고정) 중 35%는 운영 자금, 나머지로 항공기를 들인다
    cabin: { cost: [0.08, 0.14], rating: 0.3, biz: 0.08, premium: 0.08, shop: 5, names: ['기본', '개조', '최고급'] }, // 객실 개조: 새 기체 값의 8%·14%, 단계마다(노선 평균) 운임 수입 +8%·별점 +0.3·비즈니스 수요 +8%, 5일간 운항 못 함
    campaign: { national: { name: '전국 광고', cost: 10, rev: 0.1, rep: 0.03, boost: 0.03, premium: 0.04, months: 6 }, global: { name: '세계 광고', cost: 30, rev: 0.2, rep: 0.08, boost: 0.06, premium: 0.08, months: 6 } } as Record<string, { name: string; cost: number; rev: number; rep: number; boost: number; premium: number; months: number }>, // 대형 광고: 비용 = max(기본, 최근 월평균 매출 × rev). 바로 평판, 6개월간 운임 수입 +premium(브랜드 값)·수요 +boost
    green: { max: 5, cost: 15, rev: 0.12, ops: 0.03, carbon: 0.15 }, // 친환경 연료 투자: n단계 비용 = max($15M, 최근 월평균 매출 × 0.12) × n, 단계마다 운영비 −3%(연료 효율), 탄소세 시대 낡은 기체 부담 −15%
    airport: { slots: 30, fee: 0.4 }, // 내 허브 공항: 슬롯 +30, 그 도시에 다니는 경쟁사 노선 1개마다 월 $0.4M
    royalty: 0.03, // 자체 기종 하나마다 경쟁사(대형 포함) 항공기 1대당 월 $0.03M 기술료
    dynasty: { months: 120, list: { world1: { name: '세계 1위 항공사', desc: '최근 12개월 매출 1위(대형 항공사 포함)' }, regions: { name: '전 지역 취항', desc: '모든 지역에 운항 중인 도시가 있다' }, group: { name: '그룹 연 매출 $3B', desc: '우리 + 자회사(51% 이상) 최근 12개월 매출 $3,000M' }, fleet: { name: '항공기 100대', desc: '내 항공기 100대(임대 포함)' } } as Record<string, { name: string; desc: string }> }, // 왕조 목표: 하나를 골라 10년 안에
    ipo: { minMonth: 36, share: 0.25, pe: 8, payout: 0.1, growth: 0.05, cashKeep: 30, keepRev: 1.5, repUp: 0.01, repDown: 0.03 }, // 배당은 현금을 max($30M, 월평균 매출 × 1.5) 남기는 만큼만 // 상장: 3년차부터, 회사 가치(장부가 + 최근 12개월 이익 × 8)의 25%를 받는다. 해마다 이익의 15% 배당, 이익 5% 이상 성장 목표
    quotes: { threat: { low: ['그 노선, 우리가 더 싸게 날겠습니다.', '손님은 결국 값을 따라옵니다.'], premium: ['그 노선의 진짜 서비스를 보여 드리죠.', '격이 다른 비행을 준비하고 있습니다.'] }, war: { low: ['가격으로 승부합시다. 버틸 수 있겠습니까?', '이번엔 끝까지 내립니다.'], premium: ['잠시 값을 낮출 뿐, 품질은 그대로입니다.', '이 노선은 양보할 수 없습니다.'] }, join: { low: ['함께라면 더 멀리 갑니다.', '좋은 조건이군요. 손잡겠습니다.'], premium: ['동맹의 품격을 높이겠습니다.', '오랜 협력이 되길 바랍니다.'] }, leave: { low: ['조건이 더 좋은 쪽을 택했습니다.', '사업은 사업입니다.'], premium: ['새로운 동반자를 찾았습니다.', '그동안 고마웠습니다.'] } } as Record<string, Record<string, string[]>>, // 경쟁사 대표 한마디(자유 모드)
    policy: { subChance: 0.04, subMonths: 24, subExpire: 2, subMinMonth: 12, saleChance: 0.03, saleMonths: 6, saleCut: 0.5 }, // 정부 정책: 벽지 노선 보조금 제안(월 4%, 24개월), 운수권 할인(월 3%, 6개월간 반값)
    allianceRace: { rep: 0.03, xp: 12 }, // 동맹 순위전(해마다 연말): 우리 동맹 매출이 스카이 동맹보다 크면 평판 +3%, 동맹 경험치 +12
    saga: { startAfter: 18, winRep: 0.1, winCash: 100, winShrink: 0.2, loseRep: 0.05, loseGrow: 5 }, // 대형 항공사와의 장기 대결: 대형 항공사 등장 18개월 뒤 시작. 최후 대결 승리 평판 +10%·$100M·상대 항공기 −20%, 패배 평판 −5%·상대 +5대
    challenges: { debt: { name: '빚더미 출발', desc: '대출 $100M을 안고 시작' }, crowded: { name: '치열한 시장', desc: '경쟁사 6곳으로 시작, 신생 항공사 2배' }, lowrep: { name: '평판 바닥', desc: '평판 5%로 시작' }, small: { name: '작은 출발', desc: '가장 작은 기종 한 대와 현금 절반' } } as Record<string, { name: string; desc: string }>, // 자유 모드 도전 조건
    preorder: { deposit: 0.1, discount: 0.15, max: 3 }, // 신기종 선주문: 계약금 10%, 15% 할인, 최대 3대
    pioneer: { months: 6, boost: 0.15 }, // 첫 취항 보너스
  },
  subsidiary: { // 자회사(자유 모드): 경쟁사 지분을 사서 회사는 그대로 두고 배당을 받는다
    priceMult: 1.2, // 지분 값 = 인수가 × 지분율 × 1.2(경영권 웃돈)
    weight: { 0.2: 0.6, 0.51: 0.3, 1: 0.2 } as Record<string, number>, // 내 노선과 겹칠 때 손님을 빼앗는 힘(1 = 보통 경쟁사, 제휴 0.5)
    payout: { none: 0.4, grow: 0.2, profit: 0.6, attack: 0.3 } as Record<string, number>, // 자회사 월 이익 중 배당으로 나눠 주는 비율(방향별)
    sellRatio: 0.8, // 지분을 팔 때 받는 값 = 지분 값 × 0.8
    callMonths: 2, callMax: 30, // 증자 요청: 응답 기한(개월), 최대 금액($M, 지분율을 곱함)
    failRep: 0.03, // 자회사가 파산하면 평판 하락
    codeshare: 0.5, // 51% 자회사 노선과 내 노선이 이어지면 환승 손님(내 노선끼리의 절반)
    lendRate: 0.8, // 내 항공기를 자회사에 빌려주면 받는 월 임대료 = 새 기체 값 × 임대율 × 0.8
    dirs: { grow: { name: '확장', desc: '항공기를 빨리 늘립니다(배당 적음)' }, profit: { name: '수익', desc: '배당을 많이 줍니다(성장 느림)' }, attack: { name: '공세', desc: '다른 경쟁사 노선에 들어가 손님을 빼앗습니다' } } as Record<string, { name: string; desc: string }>,
  },
  acquire: { min: 6, perPlane: 0.3, perRoute: 0.8, distress: 0.55, maxPlanes: 8, slots: 2, rep: 0.03 }, // 경쟁사 인수: 가격 = (항공기 × B7-37 값 × perPlane + 노선 × perRoute) (자금난이면 ×distress). 항공기(최대 maxPlanes)·거점 슬롯·평판을 받는다
  reopen: { months: 6, fee: 1.5, rep: 0.01 }, // 노선 폐지: 운항 중이던 노선을 닫으면 평판 −rep, 닫은 지 months개월 안에 다시 열면 fee($M)
  sale: { ratio: 0.9 }, // 매각가 = 장부가 × 0.9
  slot: { base: 6, perSize: 0.35, price: 2, priceStep: 0.2, lease: 0.12 }, // 공항 1일 이착륙 한도 = base + perSize × 시장 규모 + 구매분. 구매가(M)·월 임대료(M)
  rights: { // 지역 운수권(자유 모드): 처음에는 출발 도시가 속한 지역만 열려 있고, 돈과 누적 이익을 갖추면 다른 지역을 살 수 있다
    regions: { EA: '동아시아', SEA: '동남아시아', SAME: '남아시아·중동', EU: '유럽', AF: '아프리카', NA: '북미', LA: '중남미', OC: '오세아니아' } as Record<string, string>,
    price: [[2500, 6], [6000, 10], [10000, 16], [Infinity, 24]] as [number, number][], // 이미 가진 지역과 가장 가까운 도시 사이 거리(km)가 이보다 짧으면 이 값($M)
    need: [5, 20, 45, 85, 140, 210, 300], // 가진 지역 수(1부터)별로 다음 지역을 사려면 필요한 누적 이익($M)
  },
  slb: { ratio: 0.95, rent: 0.035, buyback: 1.05 }, // 세일 앤 리스백: 장부가의 95%를 받고 판 뒤 판 값의 월 3.5%를 임대료로 낸다. 되살 때는 판 값의 105% 이상
  slotTrade: { sell: 0.7, buy: 1.6 }, // 슬롯 거래: 남는 슬롯을 경쟁사에 팔면 지금 슬롯 값의 70%, 경쟁사 슬롯을 사 오면 160%
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
    start: 2, max: 6, sandboxMax: 12, maxGrowMonths: 24, entryChance: 0.1, entryMinMonth: 4, entryCash: 0.6, bankruptMonths: 3, effSpread: 0.12, shockChance: 0.012, shockMin: 10, shockMax: 40, // start: 처음에 있는 경쟁사 수, max: 동시에 있을 수 있는 최대 수, entryChance: 한 달에 신생 항공사가 생길 확률, bankruptMonths: 현금이 마이너스인 채 이만큼 지나면 파산, effSpread: 항공사마다 운영 효율이 ±12% 다르다
    startCash: 120, maxPlanesBase: 2, maxPlanesPerMonth: 0.35, maxPlanesCap: 10, sandboxCap: 24, capGrowMonths: 12, crowd: 0.8, maxOnRoute: 2, // 자유 모드: 상한이 12개월마다 1대씩 올라 최대 24대, crowd: 다른 회사가 많은 노선은 덜 고른다(회사 하나마다 점수 ÷ (1 + crowd×수)), maxOnRoute: 내 노선 하나에 진출해 오는 경쟁사는 2곳까지
     costRatio: 0.62, planeFixed: 0.4, profitScale: 1.4, buyRatio: 0.65 }, // 자유 모드에서만: profitScale: 경쟁사 이익 배수(시나리오는 목표 균형 때문에 1배), buyRatio: 항공기 한 대를 살 때 실제로 현금에서 나가는 비율(나머지는 할부)
};
export type Config = typeof config;
