export interface City { region: string; id: string; name: string; lat: number; lon: number; pop: number; income: number; runway: number; peak: { months: number[]; factor: number }; base?: boolean; label?: { dx: number; dy: number; align?: 'right' } }
export interface AircraftType { id: string; name: string; cls: string; seats: number; speed: number; range: number; runway: number; price: number; hourly: number; cargo: number; from?: number; own?: boolean } // cargo: 화물 적재량(톤)
export interface EventOption { label: string; cost: number; scale: number; text: string } // cost: 대응 비용(M), scale: 대응하면 효과가 이 배수로 줄어듦
export interface EventDef { id: string; name: string; months: number; option?: EventOption; scheduled?: boolean; hosts?: string[]; effect: { cash?: number; cost?: number; demand?: number; cityCap?: number; routeDemand?: number; cap?: number; ground?: number }; text: string; snowCities?: string[]; season?: number[]; sandboxOnly?: boolean; boomCities?: string[]; minMonth?: number } // effect.cap: 전체 운항 증감, effect.ground: 항공기 한 대 운항 불가

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Goal = { type: 'profit'; value: number } | { type: 'cities'; value: number } | { type: 'region'; value: number; cities: string[]; label?: string } | { type: 'survive'; months: number; minProfit: number } | { type: 'pax'; value: number } | { type: 'cargo'; value: number }; // cargo: 한 달 화물 수익(M)
export interface Scenario { id: string; name: string; desc: string; lockBase: boolean; base?: string; cash: number; plane: string; economy: number; events: { def: string; monthsLeft: number; city?: string }[]; loan: number; timeLimit: number; mode: 'any' | 'all'; goals: Goal[] }
export interface GoalProgress { label: string; value: number; target: number; done: boolean; unit: string }

export interface Plane { id: number; type: string; book: number; routeId: number | null; weekly: number; age: number; bizShare: number; cond: number; shop: number; leased?: boolean; deposit?: number; name?: string; charter?: number ; rent?: number; slb?: number; cabin?: number} // age: 보유 개월 수, bizShare: 비즈니스석 비율, cond: 정비 상태(0~1), shop: 정비·수리로 못 나는 남은 일수 // weekly: 주간 왕복 횟수
export interface DayStat { pax: number; seats: number; profit: number; cargo: number; otp?: number; share?: number } // 하루 기록(노선별 그래프용, 최근 60일)
export interface Route { id: number; a: string; b: string; fare: number; fareBiz: number; cargoRatio: number; open: boolean; daily: DayStat[]; priority: number; name?: string; closed?: number; ad?: number; stance?: 'share'; svc?: number; monthly?: { p: number; s: number }[] } // monthly: 최근 12개월 월 이익·평균 점유율 // priority: 공항 우선 배정 등급 1~3(높을수록 혼잡할 때 덜 지연되고 월 수수료가 든다)
export interface CompRoute { a: string; b: string; seatsDay: number; fareRatio: number; war?: number; rev?: number; share?: number; atk?: boolean; lost?: number; fleet?: { type: string; book: number; age: number; cabin?: number; name?: string; at?: number }[]; fleetAt?: number; handSeats?: number } // at: 그 항공기를 넘긴 개월, handSeats: 내가 넘겨서 늘어난 좌석(가져오면 이만큼만 빠진다) // fleet: 내가 넘긴 항공기(가져올 때 그대로 돌려받음), fleetAt: 넘긴 개월 // rev: 지난달 매출(M), share: 우리와 나눈 몫(추정), atk: 공세로 진출, lost: 공세 자회사에 빼앗긴 몫 // war: 운임 전쟁 남은 개월
/** 위임 경영진(3.14.0): 영입 후보와 고용한 경영자 */
export interface MgrCand { id: number; name: string; style: 'bold' | 'careful' | 'steady'; skill: number; shown: number } // skill: 진짜 능력(0.7~1.3), shown: 후보 카드에 보이는 별점(오차 ±1)
export interface Manager extends MgrCand { post: 'alli' | number; budget: number; hired: number; used: number; spent: number; base: number; salary: number; notes: string[]; stars?: number; effBonus: number; dirAt?: number; paid?: number; lost?: number; earned?: number; divAt?: number; membersAt?: number; xpAt?: number; acts?: Record<string, number> } // 3.17.0 성과: paid 계약금+월급 누적, lost 실수 손실 누적, earned 동맹 가입비 수입, divAt/membersAt/xpAt 영입 때 값, acts 한 일 횟수 // post: 동맹 또는 자회사 id, used: 이번 달 쓴 돈, spent: 누적, base: 영입 때 자회사 연 이익
export interface Competitor { id: number; name: string; style: 'low' | 'premium'; hub: string; cash: number; planes: number; routes: CompRoute[]; born?: number; eff?: number; low?: number; revHist?: number[]; listed?: number; lostHist?: number[]; lostNow?: { fee: number; alli: number; suit: number; ad?: number }; pHist?: number[]; trait?: string; major?: boolean; hubs?: string[]; invested?: number; /* invested: 내가 이 회사에 넣은 돈 합계(지분 매입·자본금·증자, 3.8.0부터 기록) */ ahead?: number; /* ahead: 가장 작은 대형보다 매출이 큰 채 지난 개월(자리 바꾸기) */ stake?: number; dir?: 'grow' | 'profit' | 'attack'; call?: { amount: number; expires: number }; lastDiv?: number; divTotal?: number; hist?: { rev: number; profit: number; planes: number }[]; target?: number; region?: string; lent?: { type: string; book: number; age: number }[]; lastRent?: number; founded?: 'low' | 'premium' | 'regional' } // stake: 내 지분(0.2·0.51), dir: 51% 자회사의 운영 방향, call: 증자 요청 // born: 생긴 개월(없으면 0), eff: 운영 효율(1 = 평균, 높을수록 비용이 낮다), low: 현금이 마이너스인 채로 지난 개월 수
export interface Auction { id: number; from: string; type: string; price: number; age: number; cond: number; expires: number } // 파산한 경쟁사가 내놓은 항공기 한 대(expires: 이 개월차가 되면 사라진다)
export interface Upcoming { def: string; city: string; start: number } // 예고된 행사(start: 시작하는 개월차)
export interface ActiveEra { id: string; start: number; end: number } // 시대(start·end: 개월차)
export interface ContractReward { type: 'cash' | 'plane' | 'upgrade' | 'rights' | 'rep'; value: number; label: string; plane?: string; upgrade?: string; region?: string }
export interface Contract { id: number; kind: 'pax' | 'otp' | 'cities' | 'profit'; title: string; goal: number; progress: number; limit: number; status: 'offer' | 'active'; expires: number; start?: number; a?: string; b?: string; startCities?: number; reward: ContractReward } // limit: 수락한 뒤 주어지는 개월, expires: 제안이 사라지는 개월차
export interface ChronEntry { m: number; kind: string; text: string; key?: string; d?: Record<string, number> } // 연대기 한 줄(m: 개월차, kind: 종류, d: 연말 결산 숫자)
export interface RivalGone { name: string; month: number; acq?: boolean; by?: string } // acq: 우리가 인수함
export interface ActiveEvent { def: string; monthsLeft: number; city?: string; planeId?: number; handled?: boolean }
export interface MonthReport { month: number; revenue: number; cost: number; depreciation: number; fixed: number; interest: number; cargo: number; profit: number; pax: number; seats: number; loadFactor: number; cash: number; dividend?: number }

export interface Charter { id: number; a: string; b: string; months: number; seats: number; perMonth: number; expires: number; planeId?: number; left?: number } // 전세기: planeId가 있으면 진행 중
export interface Bid { id: number; kind: 'concession' | 'slots'; city: string; n: number; ends: number; best: { who: number; amount: number } | null; min: number } // who: 0 = 우리
export interface Threat { comp: number; a: string; b: string; start: number } // 경쟁사가 내 노선에 진출 예고(start: 이 개월차에 진출)
export interface Season { year: number; kind: 'pax' | 'profit' | 'otp' | 'cities'; goal: number; best: number; start: number; done: boolean; cash: number; text: string } // 올해의 도전
export interface GameState {
  formatVersion: number;
  seed: number;
  rng: number;
  day: number; // 0부터. 30일 = 1개월
  cash: number; // M(백만 달러 단위의 게임 화폐)
  reputation: number; // 0~1
  nextId: number;
  planes: Plane[];
  routes: Route[];
  events: ActiveEvent[];
  cumProfit: number;
  loan: number; // 대출 잔액(M)
  slots: Record<string, number>; // 도시별로 추가 구매한 공항 슬롯 수
  growth: Record<string, number>; // 도시별 시장 성장 배수(기본 1)
  competitors: Competitor[];
  economy: number; // 경기 지수(1 = 보통). 수요에 곱해진다
  fuel: number; // 연료 가격 지수(1 = 기준)
  hedge: { price: number; monthsLeft: number } | null; // 연료 계약(가격 고정)
  upgrades?: Record<string, number>; // 회사 업그레이드 단계(없으면 0)
  rights?: string[]; // 지역 운수권: 이 지역들 사이에서만 노선을 열 수 있다(없으면 제한 없음)
  autoFare?: boolean; autoFreq?: boolean; // autoFreq: 자동 증감편(매주 수요에 맞춰 주간 왕복 ±1) // 자동 운임: 매주 자리를 꽉 채우는 운임으로 맞춘다(없으면 꺼짐)
  autoMaint?: boolean; // 자동 정비: 노선에 배정된 항공기의 정비 상태가 낮아지면 월말에 알아서 점검한다(없으면 꺼짐)
  nextRival: number; // 다음 경쟁사 ID(파산으로 빠져도 ID를 다시 쓰지 않는다)
  chronicle: ChronEntry[]; // 연대기(회사의 주요 사건, 최대 400줄)
  hubs: Record<string, Partial<Record<'terminal' | 'mro' | 'lounge', number>>>; // 허브 투자 단계(도시별)
  era: ActiveEra | null; // 지금 시대(없으면 평시)
  nextEra: ActiveEra | null; // 예고된 다음 시대
  eraFree: number; // 이 개월차부터 다음 시대를 예고할 수 있다
  lastEra?: string;
  contracts: Contract[]; // 제안과 진행 중인 계약
  contractsDone: number;
  nextOffer: number; // 이 개월차부터 새 계약을 제안할 수 있다
  auctions: Auction[]; // 경매 중인 항공기
  upcoming: Upcoming[]; // 예고된 행사
  adWar?: { comp: number; until: number } | null; /* 대형 항공사 겨냥 비교 광고 */
  slotLock?: Record<string, number>; /* 대형 거점 슬롯 선점: 도시 → 끝나는 개월 */
  majorPaid?: Record<number, number>; /* 대형 항공사 지분에 쓴 돈(인수하면 투자 성적으로) */
  support?: { monthly: number; total?: number }; /* 3.16.0 개척 지원금: 출발 도시가 작은 시장일 때 매달 받는 돈 */
  mgrExtra?: number; /* 3.18.0 경영진 본부 확장으로 늘린 자리 수 */
  mgrs?: Manager[]; mgrPool?: MgrCand[]; mgrPoolYear?: number; /* 위임 경영진 */
  fallen?: string[]; /* 대형 지위를 잃은 대형 항공사 이름(같은 이름으로 다시 출범하지 않게) */
  rivalsGone: RivalGone[]; // 파산한 경쟁사 기록(이름은 다시 쓰지 않는다)
  ally: number | null; // 제휴(공동 운항) 중인 경쟁사 ID
  freeze: number; // 은행의 대출 중단 남은 개월(0 = 정상)
  base: string; // 시작(본사) 도시
  difficulty: Difficulty;
  scenario: string; // 시나리오 ID
  sandbox: boolean; // 목표·기한 없이 계속 운영
  history: MonthReport[];
  cur: { revenue: number; cost: number; pax: number; seats: number; div?: number }; // 이번 달 누적
  status: 'playing' | 'bankrupt' | 'won' | 'timeup';
  lowCashMonths: number;
  log: string[];
  threats?: Threat[]; // 진출 예고 중인 경쟁사
  taken?: Record<string, number>; // 경쟁사가 선점한 도시별 슬롯
  rivalId?: number | null; // 라이벌로 지정한 경쟁사
  rivalLead?: boolean; // 라이벌보다 앞서 있는가
  story?: { id: string; expires: number; sub?: number } | null; // 선택을 기다리는 이야기 사건
  season?: Season | null; // 올해의 도전
  acquired?: number; // 인수한 경쟁사 수
  livery?: string; // 도색 색(지도의 내 비행기)
  loyalty?: { level: number; members: number; silver?: number; gold?: number; plat?: number; card?: boolean; cardInc?: number; promo?: number; promoNext?: number }; // 등급별 회원, 제휴 카드, 프로모션(남은 개월·다음 가능 개월)
  alli?: { name: string; xp: number; proj?: Record<string, number>; agenda?: { id: string; until: number } | null; meeting?: { expires: number } | null; poach?: { comp: number; expires: number; cost: number } | null; req?: { comp: number; expires: number; fee: number } | null }; // 우리 동맹: 이름·경험치·공동 사업(끝나는 개월, −1은 영구)·회의 안건·영입 시도
  campaign?: { kind: string; until: number } | null; green?: number;
  ownTypes?: string[]; myAirports?: string[]; dynasty?: { id: string; until: number } | null; dynastyDone?: string[]; // 자체 기종, 내 허브 공항, 왕조 목표(진행 중·달성)
  ipo?: { month: number; price: number; base: number; hist: number[]; res?: boolean[] } | null; // 상장: 상장 개월, 주가 지수(상장 때 100), 작년 12개월 이익, 해마다 주가
  subsidies?: { id: number; a: string; b: string; perMonth: number; months: number; expires: number; left?: number }[]; rightsSale?: { region: string; until: number } | null; nextSub?: number; // 정부 보조금 노선 제안·진행, 운수권 할인
  allianceRank?: { y: number; mine: number; sky: number; won: boolean } | null; // 동맹 순위전 결과
  off?: string[]; // 자유 모드에서 끈 기능(crew·alliance·subsidiary·finance·crisis·saga·policy)
  pilots?: number; crewShort?: boolean; autoHire?: boolean; insurance?: number; bonds?: { amount: number; rate: number; until: number }[]; // 조종사 수·자동 채용(끄면 false), 보험 단계(0~2), 채권(원금·월 이율·만기 개월)
  biz?: { hotels?: Record<string, number>; lessor?: { id: number; type: string; book: number; age: number; lessee?: number }[]; units?: Record<string, number>; last?: { hotel: number; lease: number; units?: Record<string, number> } }; // 3.15.0 units: 여행사·기내식·정비 회사·항공 물류의 단계(1~3) // 그룹 사업(자유 모드): 호텔(도시 → 단계 1~3), 리스 회사 보유기(빌려 간 경쟁사), 지난달 순이익
  majorVeto?: Record<number, number>; // 대형 항공사 이사회 거부권을 마지막으로 쓴 개월
  majorHold?: Record<number, number>; majorFreeze?: Record<number, number>; majorSuit?: Record<number, number>; // 대형 항공사 견제: 내 지분(0~0.1), 제재가 끝나는 개월, 다음 제소 가능 개월
  refitQ?: number[]; refitNow?: number[]; // 객실 일괄 개조: 기다리는 항공기 ID, 지금 개조 중인 항공기 ID(옛 저장의 refitCur는 무시)
  ownNames?: Record<string, string>; // 자체 기종 이름(내가 지음)
  alertsAt?: number[]; // 중요한 알림의 순번(log 배열 번호)
  challenges?: string[]; // 자유 모드 도전 조건(debt·crowded·lowrep·small)
  sagaStarted?: boolean; duel?: { start: number; until: number } | null; duelWon?: boolean; duelDone?: boolean; // 대형 항공사와의 장기 대결: 시작 여부, 1년 매출 대결(시작·끝 개월), 결과
  rules?: { contracts?: boolean; auctions?: boolean; bids?: boolean; subsidy?: boolean; story?: boolean; call?: boolean; campaign?: boolean; charter?: boolean; agenda?: boolean; keep?: boolean; autoBid?: boolean; events?: boolean; adWar?: boolean }; /* events: 진행 중인 사건 자동 대응(현금이 대응 비용 3배 이상일 때) */ /* autoBid: 입찰 자동(경쟁사가 부를 수 있는 최고가까지) */ // keep: 스카이 동맹이 회원사를 빼 가려 하면 자동으로 붙잡기 // call: 자회사 증자 자동 동의, campaign: 광고 자동, charter: 전세기 주문 자동 수락, agenda: 동맹 회의 안건 자동 // 자동 처리: 계약 자동 수락, 경매·입찰 알림 끄기, 보조금 자동 수락, 이야기 자동 선택 // 대형 광고 캠페인, 친환경 연료 투자 단계 // 마일리지 프로그램
  charters?: Charter[]; // 전세기 주문(제안·진행)
  alliance?: number[]; rivalAlliance?: number[]; // 우리 동맹 회원, 대형 항공사가 만든 동맹
  bids?: Bid[]; concessions?: Record<string, { holder: number; until: number }>; compSlots?: Record<string, number>; compLots?: { city: string; n: number; holder: number }[]; newAirport?: Record<string, number>; // 입찰·운영권·경쟁사 낙찰 슬롯·신공항 공용 슬롯
  megas?: { uid: number; id: string; city?: string; done: number; cost?: number; paused?: boolean; paid?: boolean }[]; /* 3.18.0: 대형 사업은 동시에 여러 개(uid: 진행 중인 사업 번호) */
  mega?: { id: string; city?: string; done: number; cost?: number; paused?: boolean; paid?: boolean } | null; /* 3.17.0 이전 저장(불러올 때 megas로 옮김) */ megaDone?: string[]; megaCity?: Record<string, number>; // 메가 프로젝트
  preorders?: { type: string; n: number; deposit: number }[]; // 신기종 선주문
  pioneered?: string[]; pioneer?: Record<string, number>; // 첫 취항한 도시, 보너스가 끝나는 개월차
  records?: Record<string, { v: number; m: number }>; noFail?: number; // 개인 기록, 고장 없이 지난 개월
  storyQueue?: { id: string; at: number }[]; // 이어지는 이야기
  netHist?: { m: number; routes: [string, string][] }[]; // 성장 타임랩스용 노선망 기록(6개월마다)
  typesFlown?: string[]; // 운용해 본 기종(도감)
  awards?: { y: number; won: string[]; winners: Record<string, string> }[]; // 연말 시상식
}
