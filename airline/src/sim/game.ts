import { config } from '../config';
import { EVENTS, CITIES, typeById, cityById } from '../data';
import { Rng } from './rng';
import { baseFare, baseSlots, bizDemandShare, blockHours, canFly, cargoRate, distanceKm, maxWeeklyRoundTrips, priceFactor, rawCargoDemand, rawMonthlyDemand } from './model';
import type { Competitor, DayStat, GameState, MonthReport, Plane, Route } from './types';

export const FORMAT_VERSION = 4; // 1 → 2: 대출·샌드박스·항공기 나이·사건 대응 / 2 → 3: 슬롯·허브·일일 기록·비즈니스석·화물·경쟁사·도시 성장 / 3 → 4: 경기 지수
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const month1 = (day: number) => (Math.floor(day / config.daysPerMonth) % 12) + 1; // 1일차는 1월

/** 노선 하루 계산 결과(화면 추정과 실제 정산이 같은 함수를 쓴다) */
export interface RouteDay {
  demand: number; seats: number; pax: number; revenue: number; cost: number; legs: number; // pax·seats는 일반석+비즈니스석 합계
  paxE: number; paxB: number; seatsE: number; seatsB: number; demandE: number; demandB: number;
  cargoT: number; cargoCap: number; cargoDemand: number; cargoRevenue: number; share: number; // share: 경쟁 점유율(1 = 독점)
}

const COMP_NAMES: [string, 'low' | 'premium', string][] = [['한바다항공', 'low', 'PUS'], ['그랜드 에어', 'premium', 'NRT']];

export class Game {
  state: GameState;
  private rng: Rng;

  constructor(seed = 1, state?: GameState) {
    if (state) { this.state = state; this.rng = new Rng(state.seed); this.rng.setState(state.rng); return; }
    this.rng = new Rng(seed);
    this.state = {
      formatVersion: FORMAT_VERSION, seed, rng: this.rng.getState(), day: 0,
      cash: config.start.cash, reputation: config.start.reputation, nextId: 1,
      planes: [], routes: [], events: [], cumProfit: 0, loan: 0, slots: {}, growth: {}, competitors: Game.initCompetitors(), economy: 1, sandbox: false, history: [],
      cur: { revenue: 0, cost: 0, pax: 0, seats: 0 }, status: 'playing', lowCashMonths: 0, log: [],
    };
    this.addPlane(config.start.plane, typeById(config.start.plane).price); // 시작 항공기는 무료로 받지만 장부가·감가상각은 같다
  }

  static initCompetitors(): Competitor[] {
    return COMP_NAMES.slice(0, config.competitors.count).map(([name, style, hub], i) => ({ id: i + 1, name, style, hub, cash: config.competitors.startCash, planes: 0, routes: [] }));
  }

  // ---------- 조회 ----------
  get month(): number { return month1(this.state.day); }
  get monthsPassed(): number { return Math.floor(this.state.day / config.daysPerMonth); }
  plane(id: number): Plane | undefined { return this.state.planes.find((p) => p.id === id); }
  route(id: number): Route | undefined { return this.state.routes.find((r) => r.id === id); }
  planesOn(routeId: number): Plane[] { return this.state.planes.filter((p) => p.routeId === routeId); }
  routeBaseFare(r: Route): number { return baseFare(distanceKm(cityById(r.a), cityById(r.b))); }
  routeBaseFareBiz(r: Route): number { return this.routeBaseFare(r) * config.cabin.bizFareMult; }
  growthOf(id: string): number { return this.state.growth[id] ?? 1; }

  /** 월 고정비 = 본사 + 항공기 1대당 정비·보험 + 추가 슬롯 임대료 */
  get fixedMonthly(): number {
    const slots = Object.values(this.state.slots).reduce((a, n) => a + n, 0);
    return config.cost.fixedMonthly + config.cost.perPlaneMonthly * this.state.planes.length + config.slot.lease * slots;
  }
  agingMult(p: Plane): number { return Math.min(config.aging.maxMult, 1 + config.aging.maintPerMonth * p.age); }
  /** 대출 한도 = 기본 + 보유 항공기 장부가 합 × 비율 */
  get loanLimit(): number { return config.loan.limitBase + config.loan.limitBookRatio * this.state.planes.reduce((a, p) => a + p.book, 0); }
  /** 이번 달 대출 월 이율(한도를 많이 쓸수록 오른다) */
  get loanRate(): number { const lim = this.loanLimit; return config.loan.baseRate + config.loan.spread * (lim > 0 ? Math.min(1, this.state.loan / lim) : 0) + Math.max(0, 0.95 - (this.state.economy ?? 1)) * config.loan.crunch; } // 불황이면 은행이 이율을 올린다(신용 경색)

  // ---- 슬롯·허브 ----
  slotCapacity(cityId: string): number { return baseSlots(cityById(cityId)) + (this.state.slots[cityId] ?? 0); }
  /** 이 도시에서 우리 항공사가 쓰는 하루 이착륙 횟수(왕복 1회 = 출발 1 + 도착 1) */
  slotsUsed(cityId: string): number {
    let ops = 0;
    for (const r of this.state.routes) if (r.open && (r.a === cityId || r.b === cityId)) for (const p of this.planesOn(r.id)) ops += (p.weekly * 2) / 7;
    return ops;
  }
  slotPrice(cityId: string): number { return config.slot.price + config.slot.priceStep * (this.state.slots[cityId] ?? 0); }
  /** 항공기가 있는 노선이 이 도시에 몇 개 닿는가 */
  linksAt(cityId: string): number {
    return this.state.routes.filter((r) => r.open && (r.a === cityId || r.b === cityId) && this.planesOn(r.id).length > 0).length;
  }
  /** 허브 효과: 노선이 2개 이상이면 그 도시 수요 보너스 */
  hubBonus(cityId: string): number { const n = this.linksAt(cityId); return n > 1 ? Math.min(config.hub.max, config.hub.perLink * (n - 1)) : 0; }

  // ---- 경쟁 ----
  /** 같은 도시 쌍의 경쟁사 노선들 */
  competitorsOn(a: string, b: string): { comp: Competitor; route: Competitor['routes'][number] }[] {
    const out: { comp: Competitor; route: Competitor['routes'][number] }[] = [];
    for (const comp of this.state.competitors) for (const route of comp.routes) if ((route.a === a && route.b === b) || (route.a === b && route.b === a)) out.push({ comp, route });
    return out;
  }
  private quality(style: 'low' | 'premium'): number { return style === 'premium' ? 1.25 : 0.9; }

  /** 노선의 하루 결과(현재 달·평판·운임·사건·경쟁·성장 기준). 실제 정산도 이 값을 쓴다 */
  routeDay(r: Route): RouteDay {
    const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), s = this.state, ps = this.planesOn(r.id);
    const base = baseFare(km), baseBiz = base * config.cabin.bizFareMult, c = config;
    // 기본 수요(일반석 환산): 규모·거리·계절·성장 × 허브 × 평판
    const hub = 1 + (this.hubBonus(r.a) + this.hubBonus(r.b)) / 2;
    let d0 = rawMonthlyDemand(A, B, this.month, this.growthOf(r.a), this.growthOf(r.b)) * hub * (1 + c.demand.repBoost * s.reputation);
    let cg0 = rawCargoDemand(A, B, this.growthOf(r.a), this.growthOf(r.b)) * hub * (1 + c.demand.repBoost * s.reputation);
    const eco = s.economy ?? 1;
    d0 *= eco; cg0 *= Math.pow(eco, c.economy.cargoPow);
    let capMult = 1, costMult = 1;
    for (const e of s.events) {
      const def = EVENTS.find((x) => x.id === e.def)!, k = e.handled && def.option ? def.option.scale : 1; // 대응하면 효과가 줄어든다
      if (def.effect.demand) { d0 *= 1 + def.effect.demand * k; cg0 *= 1 + def.effect.demand * k; }
      if (def.effect.cost) costMult *= 1 + def.effect.cost * k;
      if (def.effect.routeDemand && e.city && (r.a === e.city || r.b === e.city)) d0 *= 1 + def.effect.routeDemand * k;
      if (def.effect.cap) capMult *= 1 + def.effect.cap * k;
      if (def.effect.cityCap && e.city && (r.a === e.city || r.b === e.city)) capMult *= 1 + def.effect.cityCap * k;
    }
    const sb = bizDemandShare(A, B);
    // 공급: 항공기마다 일반석·비즈니스석·화물 적재량
    let seatsE = 0, seatsB = 0, cargoCap = 0, hours = 0, legs = 0;
    const grounded = new Map<number, number>(); // 엔진 결함: 해당 항공기는 운항하지 못한다(수리 대응하면 절반)
    for (const e of s.events) if (e.planeId !== undefined && EVENTS.find((x) => x.id === e.def)?.effect.ground) grounded.set(e.planeId, e.handled ? 0.5 : 0);
    for (const p of ps) {
      const t = typeById(p.type), l = ((p.weekly * 2) / 7) * capMult * (grounded.get(p.id) ?? 1);
      const b = Math.min(0.3, Math.max(0, p.bizShare ?? 0));
      seatsB += ((t.seats * b) / c.cabin.bizSeatArea) * l; seatsE += t.seats * (1 - b) * l; cargoCap += t.cargo * l; legs += l;
      hours += l * blockHours(km, t) * t.hourly * this.agingMult(p) / 1000; // hours: 비용(M), 노후하면 정비비가 는다
    }
    // 경쟁 점유율: 좌석·운임·품질에 비례해 시장을 나눈다(경쟁사가 없으면 독점)
    let share = 1;
    const comps = this.competitorsOn(r.a, r.b);
    if (comps.length && seatsE + seatsB > 0) {
      const wp = Math.max(1, seatsE + seatsB) * (base / Math.max(1, r.fare)) * (1 + c.demand.repBoost * s.reputation);
      let wc = 0;
      for (const { comp, route } of comps) wc += route.seatsDay * (1 / Math.max(0.3, route.fareRatio)) * this.quality(comp.style);
      share = Math.min(1, Math.max(0.1, wp / (wp + wc)));
    }
    const demE = (d0 * (1 - sb) * priceFactor(r.fare, base) * share) / c.daysPerMonth;
    const demB = (d0 * sb * Math.pow(eco, c.economy.bizPow - 1) * priceFactor(r.fareBiz, baseBiz, c.cabin.bizElasticity) * share) / c.daysPerMonth; // 비즈니스는 경기에 더 민감(d0에 이미 한 번 곱함)
    const paxB = Math.min(demB, seatsB), paxE = Math.min(demE, seatsE), pax = paxE + paxB;
    const cgDem = (cg0 * priceFactor(r.cargoRatio, 1, c.cargo.elasticity) * share) / c.daysPerMonth, cargoT = Math.min(cgDem, cargoCap);
    const cargoRevenue = (cargoT * cargoRate(km) * r.cargoRatio) / 1e6;
    const revenue = (paxE * r.fare + paxB * r.fareBiz) / 1e6 + cargoRevenue;
    const cost = (hours + (legs * c.cost.landingFeeK) / 1000 + (pax * c.cost.perPaxFee) / 1e6) * costMult;
    return { demand: demE + demB, seats: seatsE + seatsB, pax, revenue, cost, legs, paxE, paxB, seatsE, seatsB, demandE: demE, demandB: demB, cargoT, cargoCap, cargoDemand: cgDem, cargoRevenue, share };
  }

  // ---------- 행동 ----------
  private addPlane(type: string, price: number): Plane {
    const p: Plane = { id: this.state.nextId++, type, book: price, routeId: null, weekly: 0, age: 0, bizShare: 0 };
    this.state.planes.push(p);
    return p;
  }
  buyPlane(typeId: string): Result<{ planeId: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const t = typeById(typeId);
    if (this.state.cash < t.price) return fail('현금이 모자랍니다');
    this.state.cash -= t.price;
    return { ok: true, planeId: this.addPlane(typeId, t.price).id };
  }
  /** 항공기를 판다(노선에 배정돼 있으면 자동으로 뺀다). 매각가 = 장부가 × 0.9 */
  sellPlane(planeId: number): Result<{ price: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const i = this.state.planes.findIndex((p) => p.id === planeId);
    if (i < 0) return fail('없는 항공기입니다');
    const price = this.state.planes[i].book * config.sale.ratio;
    this.state.events = this.state.events.filter((e) => e.planeId !== planeId);
    this.state.planes.splice(i, 1);
    this.state.cash += price;
    return { ok: true, price };
  }
  /** 대출: 한도 안에서만. 이자는 매달 잔액 × 월 이율 */
  borrow(amount: number): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!(amount > 0)) return fail('금액이 올바르지 않습니다');
    if (this.state.loan + amount > this.loanLimit + 1e-9) return fail('대출 한도를 넘습니다');
    this.state.loan += amount; this.state.cash += amount;
    return { ok: true };
  }
  repay(amount: number): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const a = Math.min(amount, this.state.loan);
    if (!(a > 0)) return fail('갚을 대출이 없습니다');
    if (this.state.cash < a) return fail('현금이 모자랍니다');
    this.state.loan -= a; this.state.cash -= a;
    return { ok: true };
  }
  /** 공항 슬롯 1개를 산다(그 도시의 하루 이착륙 한도가 1 늘고, 월 임대료가 든다) */
  buySlot(cityId: string): Result<{ price: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!CITIES.some((c) => c.id === cityId)) return fail('없는 도시입니다');
    const price = this.slotPrice(cityId);
    if (this.state.cash < price) return fail('현금이 모자랍니다');
    this.state.cash -= price; this.state.slots[cityId] = (this.state.slots[cityId] ?? 0) + 1;
    return { ok: true, price };
  }
  /** 진행 중인 사건에 비용을 내고 대응한다(효과가 줄어든다) */
  respondEvent(index: number): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const e = this.state.events[index];
    const def = e && EVENTS.find((x) => x.id === e.def);
    if (!e || !def?.option) return fail('대응할 수 없는 사건입니다');
    if (e.handled) return fail('이미 대응했습니다');
    if (this.state.cash < def.option.cost) return fail('현금이 모자랍니다');
    this.state.cash -= def.option.cost; this.state.cur.cost += def.option.cost; e.handled = true;
    return { ok: true };
  }
  /** 목표를 이루었거나 기간이 끝난 뒤에도 목표 없이 계속 운영한다(파산은 여전히 있다) */
  continuePlay(): Result {
    const st = this.state.status;
    if (st !== 'won' && st !== 'timeup') return fail('계속할 수 없는 상태입니다');
    this.state.status = 'playing'; this.state.sandbox = true;
    return { ok: true };
  }
  openRoute(aId: string, bId: string): Result<{ routeId: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (aId === bId) return fail('같은 도시입니다');
    const A = cityById(aId), B = cityById(bId);
    const ex = this.state.routes.find((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId));
    if (ex) { ex.open = true; return { ok: true, routeId: ex.id }; }
    const base = baseFare(distanceKm(A, B));
    const r: Route = { id: this.state.nextId++, a: aId, b: bId, fare: Math.round(base), fareBiz: Math.round(base * config.cabin.bizFareMult), cargoRatio: 1, open: true, daily: [] };
    this.state.routes.push(r);
    return { ok: true, routeId: r.id };
  }
  closeRoute(routeId: number): Result {
    const r = this.route(routeId);
    if (!r) return fail('없는 노선입니다');
    for (const p of this.planesOn(routeId)) { p.routeId = null; p.weekly = 0; }
    r.open = false;
    return { ok: true };
  }
  setFare(routeId: number, fare: number): Result {
    const r = this.route(routeId);
    if (!r) return fail('없는 노선입니다');
    const b = this.routeBaseFare(r), f = config.fare;
    r.fare = Math.round(Math.min(b * f.maxRatio, Math.max(b * f.minRatio, fare)));
    return { ok: true };
  }
  setFareBiz(routeId: number, fare: number): Result {
    const r = this.route(routeId);
    if (!r) return fail('없는 노선입니다');
    const b = this.routeBaseFareBiz(r), f = config.fare;
    r.fareBiz = Math.round(Math.min(b * f.maxRatio, Math.max(b * f.minRatio, fare)));
    return { ok: true };
  }
  setCargoRatio(routeId: number, ratio: number): Result {
    const r = this.route(routeId);
    if (!r) return fail('없는 노선입니다');
    r.cargoRatio = Math.round(Math.min(config.fare.maxRatio, Math.max(config.fare.minRatio, ratio)) * 100) / 100;
    return { ok: true };
  }
  /** 항공기의 비즈니스석 비율(객실 면적 기준 0·10·20·30%). 노선에 배정된 상태에서도 바꿀 수 있다 */
  setCabin(planeId: number, share: number): Result {
    const p = this.plane(planeId);
    if (!p) return fail('없는 항공기입니다');
    if (!config.cabin.shares.includes(share)) return fail('지원하지 않는 비율입니다');
    if (typeById(p.type).seats === 0) return fail('화물기에는 좌석이 없습니다');
    p.bizShare = share;
    return { ok: true };
  }
  /** 항공기를 노선에 배정하거나(이미 배정되어 있으면 옮기거나) 주간 왕복 횟수를 바꾼다. 두 공항의 슬롯이 모자라면 거절 */
  assign(planeId: number, routeId: number, weekly: number): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const p = this.plane(planeId), r = this.route(routeId);
    if (!p || !r || !r.open) return fail('항공기나 노선이 없습니다');
    const t = typeById(p.type), A = cityById(r.a), B = cityById(r.b), ok = canFly(t, A, B);
    if (!ok.ok) return fail(ok.reason === 'range' ? '항속거리가 모자랍니다' : '활주로가 짧아 이 기종이 뜨고 내릴 수 없습니다');
    const max = maxWeeklyRoundTrips(distanceKm(A, B), t);
    if (max < 1) return fail('하루 가용 시간 안에 왕복할 수 없는 거리입니다');
    if (weekly < 1 || weekly > max) return fail(`주간 왕복은 1~${max}회입니다`);
    const w = Math.floor(weekly), old = p.routeId !== null ? this.route(p.routeId) : undefined;
    for (const c of [A, B]) { // 슬롯: 이 항공기의 지금 사용분은 빼고 새 사용분을 더해 한도와 비교
      const mine = old && (old.a === c.id || old.b === c.id) ? (p.weekly * 2) / 7 : 0;
      const after = this.slotsUsed(c.id) - mine + (w * 2) / 7, cap = this.slotCapacity(c.id);
      if (after > cap + 1e-9) return fail(`${c.name} 공항 슬롯이 모자랍니다 (${after.toFixed(1)}/${cap}). 지도에서 ${c.name}을(를) 눌러 슬롯을 사세요`);
    }
    p.routeId = routeId; p.weekly = w;
    return { ok: true };
  }
  unassign(planeId: number): Result {
    const p = this.plane(planeId);
    if (!p) return fail('없는 항공기입니다');
    p.routeId = null; p.weekly = 0;
    return { ok: true };
  }

  // ---------- 시간 ----------
  /** 하루를 진행한다. 끝난 게임에서는 아무 일도 하지 않는다 */
  advanceDay(): void {
    const s = this.state;
    if (s.status !== 'playing') return;
    if (s.day > 0 && s.day % config.daysPerMonth === 0) this.startMonth();
    for (const r of s.routes) {
      if (!r.open) continue;
      const d = this.routeDay(r);
      s.cash += d.revenue - d.cost;
      s.cur.revenue += d.revenue; s.cur.cost += d.cost; s.cur.pax += d.pax; s.cur.seats += d.seats;
      const st: DayStat = { pax: d.pax, seats: d.seats, profit: d.revenue - d.cost, cargo: d.cargoT };
      r.daily.push(st); if (r.daily.length > 60) r.daily.shift();
    }
    s.day++;
    if (s.day % config.daysPerMonth === 0) this.endMonth();
    s.rng = this.rng.getState();
  }
  advanceDays(n: number): void { for (let i = 0; i < n && this.state.status === 'playing'; i++) this.advanceDay(); }

  private startMonth(): void {
    const s = this.state;
    s.events = s.events.map((e) => ({ ...e, monthsLeft: e.monthsLeft - 1 })).filter((e) => e.monthsLeft > 0);
    if (this.rng.next() < config.events.chancePerMonth) {
      const def = EVENTS[this.rng.int(EVENTS.length)];
      let city: string | undefined;
      if (def.snowCities) city = def.snowCities[this.rng.int(def.snowCities.length)];
      if (def.boomCities) city = def.boomCities[this.rng.int(def.boomCities.length)];
      let planeId: number | undefined;
      if (def.effect.ground) { const fleet = s.planes.filter((p) => p.routeId !== null); if (fleet.length) planeId = fleet[this.rng.int(fleet.length)].id; }
      if (!def.effect.ground || planeId !== undefined) {
        s.events.push({ def: def.id, monthsLeft: def.months, city, planeId });
        s.log.push(`${this.monthsPassed + 1}개월차: ${def.name}${city ? ` (${cityById(city).name})` : ''}${planeId !== undefined ? ` (${typeById(this.plane(planeId)!.type).name})` : ''} — ${def.text}`);
      }
    }
    // 경기 지수: 평균으로 돌아가려는 힘 + 무작위 흔들림
    const ec = config.economy;
    s.economy = Math.min(ec.max, Math.max(ec.min, s.economy + (1 - s.economy) * ec.reversion + (this.rng.next() - 0.5) * ec.noise));
    this.competitorStep();
  }

  /** 경쟁사 한 달: 추정 이익을 현금에 더하고, 현금이 되면 항공기를 늘린다(노선 신설 또는 증편). 난수 없이 점수로만 고른다 */
  private competitorStep(): void {
    const s = this.state, k = config.competitors, month = this.month;
    const maxPlanes = Math.min(k.maxPlanesCap, Math.floor(k.maxPlanesBase + k.maxPlanesPerMonth * this.monthsPassed));
    const B737 = typeById('B737');
    for (const c of s.competitors) {
      let profit = 0;
      for (const r of c.routes) {
        const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), base = baseFare(km), fare = base * r.fareRatio;
        const mine = s.routes.find((x) => x.open && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)));
        const myW = mine && this.planesOn(mine.id).length ? this.routeDay(mine).seats * (base / Math.max(1, mine.fare)) : 0;
        const wc = r.seatsDay / Math.max(0.3, r.fareRatio) * this.quality(c.style), share = wc / (wc + myW || 1);
        const dem = (rawMonthlyDemand(A, B, month, this.growthOf(r.a), this.growthOf(r.b)) * priceFactor(fare, base) * share) / config.daysPerMonth;
        const pax = Math.min(dem, r.seatsDay * 0.9);
        profit += (pax * fare * (1 - k.costRatio) * config.daysPerMonth) / 1e6;
      }
      // 가격 반응: 우리가 같은 노선에서 더 싸게 팔면 따라 내리고(바닥까지), 아니면 천천히 목표 가격으로 돌아간다
      const rv = config.rival, floor = c.style === 'low' ? rv.lowFloor : rv.premFloor, target = c.style === 'low' ? rv.lowTarget : rv.premTarget;
      for (const r of c.routes) {
        const mine = s.routes.find((x) => x.open && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)));
        const pf = mine && this.planesOn(mine.id).length ? mine.fare / this.routeBaseFare(mine) : null;
        if (pf !== null && pf < r.fareRatio - 0.05) r.fareRatio = Math.max(floor, r.fareRatio - rv.step);
        else if (r.fareRatio < target) r.fareRatio = Math.min(target, r.fareRatio + rv.upStep);
        else if (r.fareRatio > target) r.fareRatio = Math.max(target, r.fareRatio - rv.upStep);
      }
      c.cash += profit - k.planeFixed * c.planes;
      if (c.cash >= B737.price && c.planes < maxPlanes) {
        c.cash -= B737.price; c.planes++;
        const legsDay = (km: number) => (2 * Math.max(1, maxWeeklyRoundTrips(km, B737))) / 7 * 0.8;
        // 아직 안 열린 최고 점수 노선(허브에서 출발, 항속 범위 안)
        let best: { b: string; score: number } | null = null;
        for (const d of CITIES) {
          if (d.id === c.hub || !canFly(B737, cityById(c.hub), d).ok || c.routes.some((r) => (r.a === c.hub && r.b === d.id) || (r.b === c.hub && r.a === d.id))) continue;
          const km = distanceKm(cityById(c.hub), d), sc = rawMonthlyDemand(cityById(c.hub), d, month) / (1 + km / 6000);
          if (!best || sc > best.score || (sc === best.score && d.id < best.b)) best = { b: d.id, score: sc };
        }
        const addTo = c.routes.length >= Math.ceil(c.planes / 2) ? c.routes[0] : undefined; // 노선 수가 비행기의 절반을 넘으면 증편
        if (best && !addTo) c.routes.push({ a: c.hub, b: best.b, seatsDay: B737.seats * legsDay(distanceKm(cityById(c.hub), cityById(best.b))), fareRatio: c.style === 'low' ? 0.85 : 1.15 });
        else if (c.routes.length) { const r = c.routes[(c.planes - 1) % c.routes.length]; r.seatsDay += B737.seats * legsDay(distanceKm(cityById(r.a), cityById(r.b))); }
      }
    }
  }

  private endMonth(): void {
    const s = this.state, c = config, rules = c.rules;
    const interest = s.loan * this.loanRate; // 이율은 감가상각 전(월초 기준) 한도로 정한다
    // 감가상각(장부 가치만 줄고 현금은 그대로), 고정비(현금)
    let dep = 0;
    for (const p of s.planes) { const d = typeById(p.type).price / c.cost.depreciationMonths; dep += d; p.book = Math.max(0, p.book - d); }
    for (const p of s.planes) p.age++;
    const fixed = this.fixedMonthly;
    s.cash -= fixed + interest;
    const excess = s.loan - this.loanLimit; // 담보(항공기 장부가)가 줄어 한도를 넘으면 은행이 초과분을 즉시 회수한다
    if (excess > 0.005) { s.loan -= excess; s.cash -= excess; s.log.push(`${this.monthsPassed}개월차: 담보 가치 하락으로 은행이 대출 $${excess.toFixed(1)}M을 회수했습니다.`); }
    const profit = s.cur.revenue - s.cur.cost - dep - fixed - interest;
    s.cumProfit += profit;
    const lf = s.cur.seats > 0 ? s.cur.pax / s.cur.seats : 0;
    let cargoRev = 0;
    for (const r of s.routes) if (r.open && r.daily.length) { const last = r.daily.slice(-30); const km = distanceKm(cityById(r.a), cityById(r.b)); cargoRev += (last.reduce((a, d) => a + d.cargo, 0) * cargoRate(km) * r.cargoRatio) / 1e6; }
    const rep: MonthReport = { month: this.monthsPassed, revenue: s.cur.revenue, cost: s.cur.cost, depreciation: dep, fixed, interest, cargo: cargoRev, profit, pax: s.cur.pax, seats: s.cur.seats, loadFactor: lf, cash: s.cash };
    s.history.push(rep);
    // 평판: 탑승률이 적정(70~90%)이면 오르고 낮으면 내린다
    if (s.cur.seats > 0) {
      const target = Math.min(1, Math.max(0, (lf - 0.5) / 0.4));
      s.reputation += (target - s.reputation) * 0.1;
    }
    s.cur = { revenue: 0, cost: 0, pax: 0, seats: 0 };
    // 도시 성장: 우리 항공기가 취항하는 도시는 시장이 조금씩 커지고, 아니면 기본값으로 천천히 돌아간다
    const recession = s.events.some((e) => e.def === 'recession');
    for (const city of CITIES) {
      const g = this.growthOf(city.id);
      const next = this.linksAt(city.id) > 0 ? g + c.growth.perMonth * (1 - (g - 1) / (c.growth.max - 1) * 0.5) - (recession ? 0.002 : 0) : g + (1 - g) * c.growth.decay;
      s.growth[city.id] = Math.min(c.growth.max, Math.max(0.8, next));
    }
    // 승패
    s.lowCashMonths = s.cash < rules.bankruptCash ? s.lowCashMonths + 1 : 0;
    const served = new Set<string>();
    for (const r of s.routes) if (r.open && this.planesOn(r.id).length) { served.add(r.a); served.add(r.b); }
    if (s.lowCashMonths >= rules.bankruptMonths) { s.status = 'bankrupt'; s.log.push('파산했습니다.'); }
    else if (s.sandbox) { /* 자유 모드: 목표·기한 없음 */ }
    else if (s.cumProfit >= rules.winProfit || served.size >= Math.min(rules.winCities, CITIES.length)) { s.status = 'won'; s.log.push('목표를 달성했습니다!'); }
    else if (this.monthsPassed >= rules.timeLimitMonths) { s.status = 'timeup'; s.log.push('제한 기간이 끝났습니다.'); }
  }

  /** 경기 단계 이름(화면용) */
  get economyLabel(): string { const e = this.state.economy; return e > 1.07 ? '호황' : e < 0.93 ? '불황' : '보통'; }

  /** 시장 점유율 추정(화면용): 우리 좌석 ÷ (우리 + 경쟁사) — 취항 노선 전체의 평균 */
  get marketShare(): number {
    let mine = 0, all = 0;
    for (const r of this.state.routes) if (r.open && this.planesOn(r.id).length) { const d = this.routeDay(r); mine += d.seats * d.share; all += d.seats; }
    return all > 0 ? mine / all : 1;
  }

  // ---------- 저장 ----------
  toJSON(): GameState { return JSON.parse(JSON.stringify(this.state)); }
  static fromJSON(data: unknown): Game {
    const d = data as Partial<GameState> | null;
    if (!d || typeof d !== 'object' || typeof d.formatVersion !== 'number') throw new Error('The Air 저장 파일이 아닙니다');
    if (d.formatVersion > FORMAT_VERSION) throw new Error('더 새로운 버전에서 저장한 파일입니다');
    if (!Array.isArray(d.planes) || !Array.isArray(d.routes) || typeof d.cash !== 'number' || typeof d.day !== 'number') throw new Error('저장 파일이 손상되었습니다');
    const st = JSON.parse(JSON.stringify(d)) as GameState;
    if (st.formatVersion < 2) { // 형식 1 → 2: 대출 없음, 목표 모드, 항공기 나이 0
      st.loan = 0; st.sandbox = false;
      for (const p of st.planes) p.age = p.age ?? 0;
      for (const h of st.history) (h as { interest?: number }).interest = (h as { interest?: number }).interest ?? 0;
    }
    if (st.formatVersion < 3) { // 형식 2 → 3: 슬롯·성장·경쟁사 없음→초기 경쟁사, 일반석만, 노선 기록 비움
      st.slots = {}; st.growth = {}; st.competitors = Game.initCompetitors();
      for (const p of st.planes) p.bizShare = p.bizShare ?? 0;
      for (const r of st.routes) {
        const base = baseFare(distanceKm(cityById(r.a), cityById(r.b)));
        r.fareBiz = r.fareBiz ?? Math.round(base * config.cabin.bizFareMult); r.cargoRatio = r.cargoRatio ?? 1; r.daily = r.daily ?? [];
      }
      for (const h of st.history) h.cargo = h.cargo ?? 0;
    }
    if (st.formatVersion < 4) st.economy = st.economy ?? 1; // 형식 3 → 4: 경기 보통
    st.formatVersion = FORMAT_VERSION;
    return new Game(st.seed ?? 1, st);
  }
}


