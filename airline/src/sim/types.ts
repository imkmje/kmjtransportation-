export interface City { region: string; id: string; name: string; lat: number; lon: number; pop: number; income: number; runway: number; peak: { months: number[]; factor: number }; base?: boolean; label?: { dx: number; dy: number; align?: 'right' } }
export interface AircraftType { id: string; name: string; cls: string; seats: number; speed: number; range: number; runway: number; price: number; hourly: number; cargo: number; from?: number } // cargo: 화물 적재량(톤)
export interface EventOption { label: string; cost: number; scale: number; text: string } // cost: 대응 비용(M), scale: 대응하면 효과가 이 배수로 줄어듦
export interface EventDef { id: string; name: string; months: number; option?: EventOption; scheduled?: boolean; hosts?: string[]; effect: { cash?: number; cost?: number; demand?: number; cityCap?: number; routeDemand?: number; cap?: number; ground?: number }; text: string; snowCities?: string[]; season?: number[]; sandboxOnly?: boolean; boomCities?: string[] } // effect.cap: 전체 운항 증감, effect.ground: 항공기 한 대 운항 불가

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Goal = { type: 'profit'; value: number } | { type: 'cities'; value: number } | { type: 'region'; value: number; cities: string[]; label?: string } | { type: 'survive'; months: number; minProfit: number } | { type: 'pax'; value: number } | { type: 'cargo'; value: number }; // cargo: 한 달 화물 수익(M)
export interface Scenario { id: string; name: string; desc: string; lockBase: boolean; base?: string; cash: number; plane: string; economy: number; events: { def: string; monthsLeft: number; city?: string }[]; loan: number; timeLimit: number; mode: 'any' | 'all'; goals: Goal[] }
export interface GoalProgress { label: string; value: number; target: number; done: boolean; unit: string }

export interface Plane { id: number; type: string; book: number; routeId: number | null; weekly: number; age: number; bizShare: number; cond: number; shop: number; leased?: boolean; deposit?: number; name?: string; charter?: number ; rent?: number; slb?: number} // age: 보유 개월 수, bizShare: 비즈니스석 비율, cond: 정비 상태(0~1), shop: 정비·수리로 못 나는 남은 일수 // weekly: 주간 왕복 횟수
export interface DayStat { pax: number; seats: number; profit: number; cargo: number; otp?: number; share?: number } // 하루 기록(노선별 그래프용, 최근 60일)
export interface Route { id: number; a: string; b: string; fare: number; fareBiz: number; cargoRatio: number; open: boolean; daily: DayStat[]; priority: number; name?: string; closed?: number; ad?: number; stance?: 'share'; svc?: number; monthly?: { p: number; s: number }[] } // monthly: 최근 12개월 월 이익·평균 점유율 // priority: 공항 우선 배정 등급 1~3(높을수록 혼잡할 때 덜 지연되고 월 수수료가 든다)
export interface CompRoute { a: string; b: string; seatsDay: number; fareRatio: number; war?: number; rev?: number; share?: number; atk?: boolean; lost?: number } // rev: 지난달 매출(M), share: 우리와 나눈 몫(추정), atk: 공세로 진출, lost: 공세 자회사에 빼앗긴 몫 // war: 운임 전쟁 남은 개월
export interface Competitor { id: number; name: string; style: 'low' | 'premium'; hub: string; cash: number; planes: number; routes: CompRoute[]; born?: number; eff?: number; low?: number; revHist?: number[]; pHist?: number[]; trait?: string; major?: boolean; stake?: number; dir?: 'grow' | 'profit' | 'attack'; call?: { amount: number; expires: number }; lastDiv?: number; divTotal?: number; hist?: { rev: number; profit: number; planes: number }[]; target?: number; region?: string; lent?: { type: string; book: number; age: number }[]; lastRent?: number } // stake: 내 지분(0.2·0.51), dir: 51% 자회사의 운영 방향, call: 증자 요청 // born: 생긴 개월(없으면 0), eff: 운영 효율(1 = 평균, 높을수록 비용이 낮다), low: 현금이 마이너스인 채로 지난 개월 수
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
  loyalty?: { level: number; members: number }; // 마일리지 프로그램
  charters?: Charter[]; // 전세기 주문(제안·진행)
  alliance?: number[]; rivalAlliance?: number[]; // 우리 동맹 회원, 대형 항공사가 만든 동맹
  bids?: Bid[]; concessions?: Record<string, { holder: number; until: number }>; compSlots?: Record<string, number>; compLots?: { city: string; n: number; holder: number }[]; newAirport?: Record<string, number>; // 입찰·운영권·경쟁사 낙찰 슬롯·신공항 공용 슬롯
  mega?: { id: string; city?: string; done: number } | null; megaDone?: string[]; megaCity?: Record<string, number>; // 메가 프로젝트
  preorders?: { type: string; n: number; deposit: number }[]; // 신기종 선주문
  pioneered?: string[]; pioneer?: Record<string, number>; // 첫 취항한 도시, 보너스가 끝나는 개월차
  records?: Record<string, { v: number; m: number }>; noFail?: number; // 개인 기록, 고장 없이 지난 개월
  storyQueue?: { id: string; at: number }[]; // 이어지는 이야기
  netHist?: { m: number; routes: [string, string][] }[]; // 성장 타임랩스용 노선망 기록(6개월마다)
  typesFlown?: string[]; // 운용해 본 기종(도감)
  awards?: { y: number; won: string[]; winners: Record<string, string> }[]; // 연말 시상식
}
