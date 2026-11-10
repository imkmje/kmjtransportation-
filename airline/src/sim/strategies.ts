import { config } from '../config';
import { AIRCRAFT, CITIES, cityById, typeById } from '../data';
import { Game, type GameOptions } from './game';
import { canFly, distanceKm, maxWeeklyRoundTrips, priceFactor, baseFare } from './model';
import { Rng } from './rng';

/** 배정을 시도하고, 슬롯이 모자라면 필요한 만큼 사서 다시 시도한다(그래도 안 되면 횟수를 줄인다) */
export function assignWithSlots(g: Game, planeId: number, routeId: number, weekly: number): boolean {
  for (let w = weekly; w >= 1; w = Math.floor(w * 0.7) || 0) {
    for (let tries = 0; tries < 6; tries++) {
      const r = g.assign(planeId, routeId, w);
      if (r.ok) return true;
      if (!r.error.includes('슬롯')) return false;
      const rt = g.route(routeId)!;
      const full = [rt.a, rt.b].find((c) => g.slotsUsed(c) + (w * 2) / 7 > g.slotCapacity(c) + 1e-9);
      if (!full || !g.buySlot(full).ok) break;
    }
    if (w === 1) break;
  }
  return false;
}

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
  const rg = g.scenario.goals.find((x) => x.type === 'region'), region = rg && rg.type === 'region' ? rg.cities : null;
  let best: { a: string; b: string; score: number } | null = null;
  for (const A of CITIES) for (const B of CITIES) {
    if (A.id >= B.id) continue;
    if (!canFly(t, A, B).ok) continue;
    if (region && !(region.includes(A.id) && region.includes(B.id))) continue; // 지역 목표가 있는 시나리오는 그 지역 안의 노선만
    const km = distanceKm(A, B);
    if (maxWeeklyRoundTrips(km, t) < minLegsOk) continue;
    // 서울에서 출발하거나 이미 열린 노선과 연결된 도시를 선호(점수에 가산)
    const connected = g.state.routes.some((r) => r.open && (r.a === A.id || r.b === A.id || r.a === B.id || r.b === B.id));
    if (region && g.state.routes.some((r) => r.open && g.planesOn(r.id).length && ((r.a === A.id && r.b === B.id) || (r.a === B.id && r.b === A.id)))) continue; // 지역 목표: 이미 비행기가 있는 노선에는 또 보내지 않는다(도시를 넓힌다)
    const base = baseFare(km), season = 1;
    const demandProxy = (A.pop * A.income * B.pop * B.income) / Math.pow(km / 1000 + config.demand.distOffset, config.demand.distExp);
    const revPerSeat = base * priceFactor(base, base);
    const score = demandProxy * revPerSeat * season * (A.id === g.state.base || B.id === g.state.base || connected ? 1.5 : 1) / (1 + km / 8000);
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
    assignWithSlots(g, p.id, o.routeId, maxWeeklyRoundTrips(km, typeById(p.type)));
    fillFare(g, o.routeId);
  }
}
/** 정비 상태가 나쁜 항공기를 점검한다(현금 여유가 있을 때) */
const maintain = (g: Game) => { for (const p of g.state.planes) if (p.cond < 0.55 && p.shop <= 0 && g.state.cash > g.serviceCost(p) + 3) g.service(p.id); };
const retune = (g: Game) => { for (const r of g.state.routes) if (r.open) fillFare(g, r.id); };

/** 보수적: 중형기만, 현금이 넉넉할 때만 한 대씩 추가 */
export const conservative: Strategy = {
  name: '보수적',
  step(g) {
    if (g.state.day % 30 !== 0) return;
    deployIdle(g);
    retune(g);
    maintain(g);
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
    maintain(g);
    for (const id of ['A350', 'B737']) if (g.state.cash > typeById(id).price + 3) { g.buyPlane(id); break; }
  },
};

/** 대출형: 한도까지 빌려 가장 큰 기종부터 사서 빠르게 키운다(이자와 노후화를 감수) */
export const leveraged: Strategy = {
  name: '대출형',
  step(g) {
    if (g.state.day % 30 !== 0) return;
    deployIdle(g);
    retune(g);
    maintain(g);
    // 현금이 넉넉해지면 먼저 대출을 갚고, 부족하면 빌려서 산다
    if (g.state.loan > 0 && g.state.cash > g.state.loan + 40) g.repay(g.state.loan);
    for (const id of ['A350', 'B737']) {
      const t = typeById(id);
      if (g.state.cash < t.price + 3) { const need = t.price + 3 - g.state.cash, room = g.loanLimit - g.state.loan; if (need <= room) g.borrow(Math.ceil(need)); }
      if (g.state.cash >= t.price + 3) { g.buyPlane(id); break; }
    }
  },
};

/** 종합형: 대출형에 새 기능을 더한다 — 장거리 노선은 비즈니스석 20%, 현금이 넉넉하면 화물기, 슬롯은 필요한 만큼 */
export const smart: Strategy = {
  name: '종합형',
  step(g, rng) {
    leveraged.step(g, rng);
    if (g.state.day % 30 !== 0) return;
    for (const p of g.state.planes) {
      const r = p.routeId ? g.route(p.routeId) : null;
      if (!r || typeById(p.type).seats === 0) continue;
      const km = distanceKm(cityById(r.a), cityById(r.b));
      const want = km > 3000 ? 0.2 : km > 1500 ? 0.1 : 0;
      if (p.bizShare !== want) g.setCabin(p.id, want);
      if (km > 3000) g.setFareBiz(r.id, g.routeBaseFareBiz(r) * 1.0);
    }
    const hasFreighter = g.state.planes.some((p) => p.type === 'F77');
    if (!hasFreighter && g.state.cash > typeById('F77').price + 40) {
      const b = g.buyPlane('F77');
      if (b.ok) { const pick = bestRouteFor(g, 'F77'); if (pick) { const o = g.openRoute(pick.a, pick.b); if (o.ok) assignWithSlots(g, b.planeId, o.routeId, maxWeeklyRoundTrips(distanceKm(cityById(pick.a), cityById(pick.b)), typeById('F77'))); } }
    }
  },
};

/** 무모형: 한도까지 빌려 현금 여유 없이 사고 또 산다(과한 확장이 파산으로 이어지는지 점검) */
export const reckless: Strategy = {
  name: '무모형',
  step(g) {
    if (g.state.day % 30 !== 0) return;
    deployIdle(g);
    retune(g);
    maintain(g);
    // 현금이 0이 될 때까지 계속 사고, 한도까지 빌려 또 산다(완충 현금 없음)
    for (let i = 0; i < 6; i++) {
      const t = typeById('B737'), room = g.loanLimit - g.state.loan;
      if (g.state.cash < t.price && room > 1) g.borrow(Math.min(room, Math.ceil(t.price - g.state.cash)));
      if (g.state.cash >= t.price) g.buyPlane(t.id); else break;
    }
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
      assignWithSlots(g, p.id, o.routeId, 1 + rng.int(max));
      const r = g.route(o.routeId)!; g.setFare(r.id, g.routeBaseFare(r) * (0.6 + rng.next() * 1.2));
    }
  },
};

/** 임대형: 대출 없이 현금이 버티는 만큼 중형기를 계속 빌린다(임대가 너무 유리한지 점검) */
export const leaser: Strategy = {
  name: '임대형',
  step(g) {
    if (g.state.day % 30 !== 0) return;
    deployIdle(g);
    retune(g);
    maintain(g);
    if (g.state.cash > 8 && g.state.planes.every((p) => p.routeId !== null)) { const r = g.leasePlane('B737'); if (!r.ok) return; }
  },
};

/** 임대 대형: 임대 가능하면 A350을, 아니면 중형기를 빌려 장거리에 투입(임대로 대형기를 굴리는 것이 너무 유리한지 점검) */
export const leaserBig: Strategy = {
  name: '임대대형',
  step(g) {
    if (g.state.day % 30 !== 0) return;
    deployIdle(g);
    retune(g);
    maintain(g);
    if (g.state.cash > 10 && g.state.planes.every((p) => p.routeId !== null)) { const r = g.leasePlane('A350'); if (!r.ok) g.leasePlane('B737'); }
  },
};

export const STRATEGIES: Strategy[] = [passive, conservative, aggressive, leveraged, smart, reckless, random, leaser, leaserBig];

export interface RunResult { strategy: string; seed: number; status: string; months: number; cash: number; cumProfit: number; planes: number; routes: number }
/** 한 전략을 한 시드로 끝날 때까지(또는 maxMonths까지) 돌린다 */
export function run(strategy: Strategy, seed: number, maxMonths = 24, opts: GameOptions = {}): RunResult {
  const g = new Game(seed, undefined, opts), rng = new Rng(seed * 7919 + 13);
  while (g.state.status === 'playing' && g.monthsPassed < maxMonths) {
    strategy.step(g, rng);
    g.advanceDay();
  }
  return { strategy: strategy.name, seed, status: g.state.status, months: g.monthsPassed, cash: g.state.cash, cumProfit: g.state.cumProfit, planes: g.state.planes.length, routes: g.state.routes.filter((r) => r.open).length };
}
