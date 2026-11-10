export interface City { id: string; name: string; lat: number; lon: number; pop: number; income: number; runway: number; peak: { months: number[]; factor: number }; base?: boolean; label?: { dx: number; dy: number; align?: 'right' } }
export interface AircraftType { id: string; name: string; cls: string; seats: number; speed: number; range: number; runway: number; price: number; hourly: number; cargo: number } // cargo: 화물 적재량(톤)
export interface EventOption { label: string; cost: number; scale: number; text: string } // cost: 대응 비용(M), scale: 대응하면 효과가 이 배수로 줄어듦
export interface EventDef { id: string; name: string; months: number; option?: EventOption; effect: { cost?: number; demand?: number; cityCap?: number; routeDemand?: number; cap?: number; ground?: number }; text: string; snowCities?: string[]; boomCities?: string[] } // effect.cap: 전체 운항 증감, effect.ground: 항공기 한 대 운항 불가

export interface Plane { id: number; type: string; book: number; routeId: number | null; weekly: number; age: number; bizShare: number } // age: 보유 개월 수, bizShare: 비즈니스석에 쓰는 객실 면적 비율(0~0.3) // weekly: 주간 왕복 횟수
export interface DayStat { pax: number; seats: number; profit: number; cargo: number } // 하루 기록(노선별 그래프용, 최근 60일)
export interface Route { id: number; a: string; b: string; fare: number; fareBiz: number; cargoRatio: number; open: boolean; daily: DayStat[] }
export interface CompRoute { a: string; b: string; seatsDay: number; fareRatio: number }
export interface Competitor { id: number; name: string; style: 'low' | 'premium'; hub: string; cash: number; planes: number; routes: CompRoute[] }
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
  sandbox: boolean; // 목표·기한 없이 계속 운영
  history: MonthReport[];
  cur: { revenue: number; cost: number; pax: number; seats: number }; // 이번 달 누적
  status: 'playing' | 'bankrupt' | 'won' | 'timeup';
  lowCashMonths: number;
  log: string[];
}
