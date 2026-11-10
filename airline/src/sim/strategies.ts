import { config } from '../config';
import { AIRCRAFT, CITIES, cityById, typeById } from '../data';
import { Game } from './game';
import { canFly, distanceKm, maxWeeklyRoundTrips, priceFactor, baseFare } from './model';
import { Rng } from './rng';

/** 용량을 다 채우는 가장 높은 운임(수요 = 좌석이 되는 운임)을 기준으로 운임을 조정 */
export function fillFare(g: Game, routeId: number): void {
  const r = g.route(routeId)!, base = g.routeBaseFare(r);
  const saved = r.fare; r.fare = Math.round(base);
  const d = g.routeDay(r);
  if (d.seats <= 0) { r.fare = saved; return; }
  // 수요(운임) = 수요(기준)·priceFactor 이므로, 좌석을 채우는 운임은 해석적으로 구한다
  const k = config.demand.elasticity;
  const ratio = 1 + Math.log(d.demand / d.seats) / k; // 기준 운임 대비 비율
  g.setFare(routeId, base * Math.min(config.fare.maxRatio, Math.max(config.fare.minRatio, ratio)));
}

export interface Strategy { name: string; step(g: Game, rng: Rng): void }

/** 아무것도 하지 않음(기준선: 고정비만 나간다) */
export const passive: Strategy = { name: '방치', step() { /* 아무것도 안 함 */ } };

/** 기단이 놀고 있으면 서울에서 갈 수 있는 가장 수요가 큰 노선에 배정, 현금이 남으면 같은 기종을 더 산다 */
function bestRouteFor(g: Game, typeId: string, minLegsOk = 1): { a: string; b: string } | null {
  const t = typeById(typeId);
  let best: { a: string; b: string; score: number } | null = null;
  for (const A of CITIES) for (const B of CITIES) {
    if (A.id >= B.id) continue;
    if (!canFly(t, A, B).ok) continue;
    const km = distanceKm(A, B);
    if (maxWeeklyRoundTrips(km, t) < minLegsOk) continue;
    // 서울에서 출발하거나 이미 열린 노선과 연결된 도시를 선호(점수에 가산)
    const connected = g.state.routes.some((r) => r.open && (r.a === A.id || r.b === A.id || r.a === B.id || r.b === B.id));
    const base = baseFare(km), season = 1;
    const demandProxy = (A.pop * A.income * B.pop * B.income) / Math.pow(km / 1000 + config.demand.distOffset, config.demand.distExp);
    const revPerSeat = base * priceFactor(base, base);
    const score = demandProxy * revPerSeat * season * (A.base || B.base || connected ? 1.5 : 1) / (1 + km / 8000);
    if (!best || score > best.score) best = { a: A.id, b: B.id, score };
  }
  return best;
}

function deployIdle(g: Game, typeFilter?: (id: string) => boolean): void {
  for (const p of g.state.planes) {
    if (p.routeId !== null) continue;
    if (typeFilter && !typeFilter(p.type)) continue;
    const pick = bestRouteFor(g, p.type);
    if (!pick) continue;
    const o = g.openRoute(pick.a, pick.b);
    if (!o.ok) continue;
    const km = distanceKm(cityById(pick.a), cityById(pick.b));
    g.assign(p.id, o.routeId, maxWeeklyRoundTrips(km, typeById(p.type)));
    fillFare(g, o.routeId);
  }
}
const retune = (g: Game) => { for (const r of g.state.routes) if (r.open) fillFare(g, r.id); };

/** 보수적: 중형기만, 현금이 넉넉할 때만 한 대씩 추가 */
export const conservative: Strategy = {
  name: '보수적',
  step(g) {
    if (g.state.day % 30 !== 0) return;
    deployIdle(g);
    retune(g);
    const t = typeById('B737');
    if (g.state.cash > t.price + 12) g.buyPlane('B737');
  },
};

/** 공격적: 현금이 닿는 대로 가장 큰 기종을 사서 장거리 노선에 투입 */
export const aggressive: Strategy = {
  name: '공격적',
  step(g) {
    if (g.state.day % 30 !== 0) return;
    deployIdle(g);
    retune(g);
    for (const id of ['A350', 'B737']) if (g.state.cash > typeById(id).price + 3) { g.buyPlane(id); break; }
  },
};

/** 무작위: 임의의 기종과 노선을 고르고 운임도 무작위(기준선) */
export const random: Strategy = {
  name: '무작위',
  step(g, rng) {
    if (g.state.day % 30 !== 0) return;
    if (rng.next() < 0.3) { const t = AIRCRAFT[rng.int(AIRCRAFT.length)]; if (g.state.cash > t.price + 2) g.buyPlane(t.id); }
    for (const p of g.state.planes) {
      if (p.routeId !== null && rng.next() > 0.2) continue;
      const A = CITIES[rng.int(CITIES.length)], B = CITIES[rng.int(CITIES.length)];
      if (A.id === B.id) continue;
      const o = g.openRoute(A.id, B.id);
      if (!o.ok) continue;
      const t = typeById(p.type);
      if (!canFly(t, A, B).ok) continue;
      const max = maxWeeklyRoundTrips(distanceKm(A, B), t);
      if (max < 1) continue;
      g.assign(p.id, o.routeId, 1 + rng.int(max));
      const r = g.route(o.routeId)!; g.setFare(r.id, g.routeBaseFare(r) * (0.6 + rng.next() * 1.2));
    }
  },
};

export const STRATEGIES: Strategy[] = [passive, conservative, aggressive, random];

export interface RunResult { strategy: string; seed: number; status: string; months: number; cash: number; cumProfit: number; planes: number; routes: number }
/** 한 전략을 한 시드로 끝날 때까지(또는 maxMonths까지) 돌린다 */
export function run(strategy: Strategy, seed: number, maxMonths = 24): RunResult {
  const g = new Game(seed), rng = new Rng(seed * 7919 + 13);
  while (g.state.status === 'playing' && g.monthsPassed < maxMonths) {
    strategy.step(g, rng);
    g.advanceDay();
  }
  return { strategy: strategy.name, seed, status: g.state.status, months: g.monthsPassed, cash: g.state.cash, cumProfit: g.state.cumProfit, planes: g.state.planes.length, routes: g.state.routes.filter((r) => r.open).length };
}
