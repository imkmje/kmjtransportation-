export interface City { region: string; id: string; name: string; lat: number; lon: number; pop: number; income: number; runway: number; peak: { months: number[]; factor: number }; base?: boolean; label?: { dx: number; dy: number; align?: 'right' } }
export interface AircraftType { id: string; name: string; cls: string; seats: number; speed: number; range: number; runway: number; price: number; hourly: number; cargo: number; from?: number } // cargo: 화물 적재량(톤)
export interface EventOption { label: string; cost: number; scale: number; text: string } // cost: 대응 비용(M), scale: 대응하면 효과가 이 배수로 줄어듦
export interface EventDef { id: string; name: string; months: number; option?: EventOption; scheduled?: boolean; hosts?: string[]; effect: { cash?: number; cost?: number; demand?: number; cityCap?: number; routeDemand?: number; cap?: number; ground?: number }; text: string; snowCities?: string[]; boomCities?: string[] } // effect.cap: 전체 운항 증감, effect.ground: 항공기 한 대 운항 불가

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Goal = { type: 'profit'; value: number } | { type: 'cities'; value: number } | { type: 'region'; value: number; cities: string[]; label?: string } | { type: 'survive'; months: number; minProfit: number } | { type: 'pax'; value: number } | { type: 'cargo'; value: number }; // cargo: 한 달 화물 수익(M)
export interface Scenario { id: string; name: string; desc: string; lockBase: boolean; base?: string; cash: number; plane: string; economy: number; events: { def: string; monthsLeft: number; city?: string }[]; loan: number; timeLimit: number; mode: 'any' | 'all'; goals: Goal[] }
export interface GoalProgress { label: string; value: number; target: number; done: boolean; unit: string }

export interface Plane { id: number; type: string; book: number; routeId: number | null; weekly: number; age: number; bizShare: number; cond: number; shop: number; leased?: boolean; deposit?: number } // age: 보유 개월 수, bizShare: 비즈니스석 비율, cond: 정비 상태(0~1), shop: 정비·수리로 못 나는 남은 일수 // weekly: 주간 왕복 횟수
export interface DayStat { pax: number; seats: number; profit: number; cargo: number; otp?: number } // 하루 기록(노선별 그래프용, 최근 60일)
export interface Route { id: number; a: string; b: string; fare: number; fareBiz: number; cargoRatio: number; open: boolean; daily: DayStat[]; priority: number; name?: string } // priority: 공항 우선 배정 등급 1~3(높을수록 혼잡할 때 덜 지연되고 월 수수료가 든다)
export interface CompRoute { a: string; b: string; seatsDay: number; fareRatio: number; war?: number } // war: 운임 전쟁 남은 개월
export interface Competitor { id: number; name: string; style: 'low' | 'premium'; hub: string; cash: number; planes: number; routes: CompRoute[]; born?: number; eff?: number; low?: number; revHist?: number[] } // born: 생긴 개월(없으면 0), eff: 운영 효율(1 = 평균, 높을수록 비용이 낮다), low: 현금이 마이너스인 채로 지난 개월 수
export interface Auction { id: number; from: string; type: string; price: number; age: number; cond: number; expires: number } // 파산한 경쟁사가 내놓은 항공기 한 대(expires: 이 개월차가 되면 사라진다)
export interface Upcoming { def: string; city: string; start: number } // 예고된 행사(start: 시작하는 개월차)
export interface RivalGone { name: string; month: number }
export interface ActiveEvent { def: string; monthsLeft: number; city?: string; planeId?: number; handled?: boolean }
export interface MonthReport { month: number; revenue: number; cost: number; depreciation: number; fixed: number; interest: number; cargo: number; profit: number; pax: number; seats: number; loadFactor: number; cash: number }

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
  autoFare?: boolean; // 자동 운임: 매주 자리를 꽉 채우는 운임으로 맞춘다(없으면 꺼짐)
  autoMaint?: boolean; // 자동 정비: 노선에 배정된 항공기의 정비 상태가 낮아지면 월말에 알아서 점검한다(없으면 꺼짐)
  nextRival: number; // 다음 경쟁사 ID(파산으로 빠져도 ID를 다시 쓰지 않는다)
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
  cur: { revenue: number; cost: number; pax: number; seats: number }; // 이번 달 누적
  status: 'playing' | 'bankrupt' | 'won' | 'timeup';
  lowCashMonths: number;
  log: string[];
}
