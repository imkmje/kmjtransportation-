export interface City { id: string; name: string; lat: number; lon: number; pop: number; income: number; runway: number; peak: { months: number[]; factor: number }; base?: boolean }
export interface AircraftType { id: string; name: string; cls: string; seats: number; speed: number; range: number; runway: number; price: number; hourly: number }
export interface EventDef { id: string; name: string; months: number; effect: { cost?: number; demand?: number; cityCap?: number; routeDemand?: number }; text: string; snowCities?: string[]; boomCities?: string[] }

export interface Plane { id: number; type: string; book: number; routeId: number | null; weekly: number } // weekly: 주간 왕복 횟수
export interface Route { id: number; a: string; b: string; fare: number; open: boolean }
export interface ActiveEvent { def: string; monthsLeft: number; city?: string }
export interface MonthReport { month: number; revenue: number; cost: number; depreciation: number; fixed: number; profit: number; pax: number; seats: number; loadFactor: number; cash: number }

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
  history: MonthReport[];
  cur: { revenue: number; cost: number; pax: number; seats: number }; // 이번 달 누적
  status: 'playing' | 'bankrupt' | 'won' | 'timeup';
  lowCashMonths: number;
  log: string[];
}
