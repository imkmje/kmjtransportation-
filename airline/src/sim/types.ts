export interface City { id: string; name: string; lat: number; lon: number; pop: number; income: number; runway: number; peak: { months: number[]; factor: number }; base?: boolean; label?: { dx: number; dy: number; align?: 'right' } }
export interface AircraftType { id: string; name: string; cls: string; seats: number; speed: number; range: number; runway: number; price: number; hourly: number }
export interface EventOption { label: string; cost: number; scale: number; text: string } // cost: 대응 비용(M), scale: 대응하면 효과가 이 배수로 줄어듦
export interface EventDef { id: string; name: string; months: number; option?: EventOption; effect: { cost?: number; demand?: number; cityCap?: number; routeDemand?: number }; text: string; snowCities?: string[]; boomCities?: string[] }

export interface Plane { id: number; type: string; book: number; routeId: number | null; weekly: number; age: number } // age: 보유 개월 수 // weekly: 주간 왕복 횟수
export interface Route { id: number; a: string; b: string; fare: number; open: boolean }
export interface ActiveEvent { def: string; monthsLeft: number; city?: string; handled?: boolean }
export interface MonthReport { month: number; revenue: number; cost: number; depreciation: number; fixed: number; interest: number; profit: number; pax: number; seats: number; loadFactor: number; cash: number }

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
  sandbox: boolean; // 목표·기한 없이 계속 운영
  history: MonthReport[];
  cur: { revenue: number; cost: number; pax: number; seats: number }; // 이번 달 누적
  status: 'playing' | 'bankrupt' | 'won' | 'timeup';
  lowCashMonths: number;
  log: string[];
}
