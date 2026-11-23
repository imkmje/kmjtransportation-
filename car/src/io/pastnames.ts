// 1.5.0 지난 판들의 차 이름: 게임 저장과 따로 이 기기(localStorage)에 모아 둔다. 다른 기기로는 옮겨지지 않는다. sim과 무관(화면 쪽 값만)
import type { CarState } from '../sim/types';

export interface PastCar { name: string; body: string; segment: string; year: number; sold: number }
/** 판 하나: id = 시드:회사 이름(같은 판을 다시 열면 같은 칸을 고친다), at = 마지막으로 기록한 시각(최근 판 순 정렬용) */
export interface PastRun { id: string; company: string; startYear: number; at: number; cars: PastCar[] }

const KEY = 'car-company-past-names', MAX_RUNS = 30, MAX_CARS = 80;
export const runId = (s: Pick<CarState, 'seed' | 'companyName'>): string => `${s.seed}:${s.companyName}`;

export function loadPast(): PastRun[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(a)) return [];
    const str = (x: unknown) => typeof x === 'string', num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
    return a.filter((r) => r && str(r.id) && str(r.company) && num(r.at) && num(r.startYear) && Array.isArray(r.cars)).map((r) => ({
      id: r.id, company: r.company, startYear: r.startYear, at: r.at,
      cars: r.cars.filter((c: PastCar) => c && str(c.name) && str(c.body) && str(c.segment) && num(c.year) && num(c.sold)).slice(0, MAX_CARS),
    }));
  } catch { return []; }
}
const store = (runs: PastRun[]) => { try { localStorage.setItem(KEY, JSON.stringify(runs)); } catch { /* 저장 불가: 목록 없이 계속 */ } };

/** 지금 판의 출시한 차종을 기록(이름·차체·고객층·첫 출시 연도·누적 판매). 출시한 차가 없으면 기록하지 않는다 */
export function recordPast(s: CarState, startYear: number, yearOfMonth: (m: number) => number, now: number): void {
  const cars = s.nameplates.filter((n) => n.generations.length).map((n) => ({
    name: n.name, body: n.generations.at(-1)!.body, segment: n.generations.at(-1)!.segment, year: yearOfMonth(n.generations[0].launchMonth), sold: n.generations.reduce((a, g) => a + g.totalSold, 0),
  })).slice(0, MAX_CARS);
  if (!cars.length) return;
  const id = runId(s), runs = loadPast().filter((r) => r.id !== id);
  runs.unshift({ id, company: s.companyName, startYear, at: now, cars });
  store(runs.sort((a, b) => b.at - a.at).slice(0, MAX_RUNS));
}
/** 1.6.0 기기 연동으로 받은 목록을 합친다: 같은 판은 나중에 기록한 쪽 */
export function mergePast(other: PastRun[]): void {
  const by = new Map(loadPast().map((r) => [r.id, r]));
  for (const r of other) { const cur = r && typeof r.id === 'string' && typeof r.at === 'number' ? by.get(r.id) : null; if (cur !== null && (!cur || cur.at < r.at)) by.set(r.id, r); } // 모양 검사는 loadPast가 읽을 때
  store([...by.values()].sort((a, b) => b.at - a.at).slice(0, MAX_RUNS));
}
export const clearPast = (): void => { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } };
