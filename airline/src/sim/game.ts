import { config } from '../config';
import { EVENTS, CITIES, typeById, cityById } from '../data';
import { Rng } from './rng';
import { baseFare, blockHours, canFly, distanceKm, maxWeeklyRoundTrips, priceFactor, rawMonthlyDemand } from './model';
import type { GameState, MonthReport, Plane, Route } from './types';

export const FORMAT_VERSION = 2; // 1 → 2: 대출·샌드박스·항공기 나이·사건 대응 추가
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const month1 = (day: number) => (Math.floor(day / config.daysPerMonth) % 12) + 1; // 1일차는 1월

/** 노선 하루 계산 결과(화면 추정과 실제 정산이 같은 함수를 쓴다) */
export interface RouteDay { demand: number; seats: number; pax: number; revenue: number; cost: number; legs: number }

export class Game {
  state: GameState;
  private rng: Rng;

  constructor(seed = 1, state?: GameState) {
    if (state) { this.state = state; this.rng = new Rng(state.seed); this.rng.setState(state.rng); return; }
    this.rng = new Rng(seed);
    this.state = {
      formatVersion: FORMAT_VERSION, seed, rng: this.rng.getState(), day: 0,
      cash: config.start.cash, reputation: config.start.reputation, nextId: 1,
      planes: [], routes: [], events: [], cumProfit: 0, loan: 0, sandbox: false, history: [],
      cur: { revenue: 0, cost: 0, pax: 0, seats: 0 }, status: 'playing', lowCashMonths: 0, log: [],
    };
    this.addPlane(config.start.plane, typeById(config.start.plane).price); // 시작 항공기는 무료로 받지만 장부가·감가상각은 같다
  }

  // ---------- 조회 ----------
  get month(): number { return month1(this.state.day); }
  get monthsPassed(): number { return Math.floor(this.state.day / config.daysPerMonth); }
  plane(id: number): Plane | undefined { return this.state.planes.find((p) => p.id === id); }
  route(id: number): Route | undefined { return this.state.routes.find((r) => r.id === id); }
  planesOn(routeId: number): Plane[] { return this.state.planes.filter((p) => p.routeId === routeId); }
  routeBaseFare(r: Route): number { return baseFare(distanceKm(cityById(r.a), cityById(r.b))); }

  /** 노선의 하루 결과(현재 달·평판·운임·사건 기준). 실제 정산도 이 값을 쓴다 */
  routeDay(r: Route): RouteDay {
    const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), s = this.state, ps = this.planesOn(r.id);
    const base = baseFare(km);
    // 수요: 기본 수요 × 운임 계수 × 평판 × 사건
    let dem = rawMonthlyDemand(A, B, this.month) * priceFactor(r.fare, base) * (1 + config.demand.repBoost * s.reputation);
    let capMult = 1, costMult = 1;
    for (const e of s.events) {
      const def = EVENTS.find((x) => x.id === e.def)!, k = e.handled && def.option ? def.option.scale : 1; // 대응하면 효과가 줄어든다
      if (def.effect.demand) dem *= 1 + def.effect.demand * k;
      if (def.effect.cost) costMult *= 1 + def.effect.cost * k;
      if (def.effect.routeDemand && e.city && (r.a === e.city || r.b === e.city)) dem *= 1 + def.effect.routeDemand * k;
      if (def.effect.cityCap && e.city && (r.a === e.city || r.b === e.city)) capMult *= 1 + def.effect.cityCap * k;
    }
    dem /= config.daysPerMonth;
    let seats = 0, hours = 0, legs = 0;
    for (const p of ps) {
      const t = typeById(p.type), l = (p.weekly * 2) / 7;
      seats += t.seats * l; legs += l; hours += l * blockHours(km, t) * t.hourly * this.agingMult(p) / 1000; // hours: 비용(M), 노후하면 정비비가 는다
    }
    seats *= capMult; legs *= capMult; hours *= capMult;
    const pax = Math.min(dem, seats);
    const revenue = (pax * r.fare) / 1e6;
    const c = config.cost, cost = (hours + (legs * c.landingFeeK) / 1000 + (pax * c.perPaxFee) / 1e6) * costMult;
    return { demand: dem, seats, pax, revenue, cost, legs };
  }

  /** 월 고정비 = 본사 고정비 + 항공기 1대당 정비·보험·승무원 기지 비용 */
  get fixedMonthly(): number { return config.cost.fixedMonthly + config.cost.perPlaneMonthly * this.state.planes.length; }
  /** 이번 달 대출 월 이율(한도를 많이 쓸수록 오른다) */
  get loanRate(): number { const lim = this.loanLimit; return config.loan.baseRate + config.loan.spread * (lim > 0 ? Math.min(1, this.state.loan / lim) : 0); }
  agingMult(p: Plane): number { return Math.min(config.aging.maxMult, 1 + config.aging.maintPerMonth * p.age); }
  /** 대출 한도 = 기본 + 보유 항공기 장부가 합 × 비율 */
  get loanLimit(): number { return config.loan.limitBase + config.loan.limitBookRatio * this.state.planes.reduce((a, p) => a + p.book, 0); }

  // ---------- 행동 ----------
  private addPlane(type: string, price: number): Plane {
    const p: Plane = { id: this.state.nextId++, type, book: price, routeId: null, weekly: 0, age: 0 };
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
    const r: Route = { id: this.state.nextId++, a: aId, b: bId, fare: Math.round(baseFare(distanceKm(A, B))), open: true };
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
  /** 항공기를 노선에 배정하거나(이미 배정되어 있으면 옮기거나) 주간 왕복 횟수를 바꾼다 */
  assign(planeId: number, routeId: number, weekly: number): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const p = this.plane(planeId), r = this.route(routeId);
    if (!p || !r || !r.open) return fail('항공기나 노선이 없습니다');
    const t = typeById(p.type), A = cityById(r.a), B = cityById(r.b), ok = canFly(t, A, B);
    if (!ok.ok) return fail(ok.reason === 'range' ? '항속거리가 모자랍니다' : '활주로가 짧아 이 기종이 뜨고 내릴 수 없습니다');
    const max = maxWeeklyRoundTrips(distanceKm(A, B), t);
    if (max < 1) return fail('하루 가용 시간 안에 왕복할 수 없는 거리입니다');
    if (weekly < 1 || weekly > max) return fail(`주간 왕복은 1~${max}회입니다`);
    p.routeId = routeId; p.weekly = Math.floor(weekly);
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
      s.events.push({ def: def.id, monthsLeft: def.months, city });
      s.log.push(`${this.monthsPassed + 1}개월차: ${def.name}${city ? ` (${cityById(city).name})` : ''} — ${def.text}`);
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
    const profit = s.cur.revenue - s.cur.cost - dep - fixed - interest;
    s.cumProfit += profit;
    const lf = s.cur.seats > 0 ? s.cur.pax / s.cur.seats : 0;
    const rep: MonthReport = { month: this.monthsPassed, revenue: s.cur.revenue, cost: s.cur.cost, depreciation: dep, fixed, interest, profit, pax: s.cur.pax, seats: s.cur.seats, loadFactor: lf, cash: s.cash };
    s.history.push(rep);
    // 평판: 탑승률이 적정(70~90%)이면 오르고 낮으면 내린다
    if (s.cur.seats > 0) {
      const target = Math.min(1, Math.max(0, (lf - 0.5) / 0.4));
      s.reputation += (target - s.reputation) * 0.1;
    }
    s.cur = { revenue: 0, cost: 0, pax: 0, seats: 0 };
    // 승패
    s.lowCashMonths = s.cash < rules.bankruptCash ? s.lowCashMonths + 1 : 0;
    const served = new Set<string>();
    for (const r of s.routes) if (r.open && this.planesOn(r.id).length) { served.add(r.a); served.add(r.b); }
    if (s.lowCashMonths >= rules.bankruptMonths) { s.status = 'bankrupt'; s.log.push('파산했습니다.'); }
    else if (s.sandbox) { /* 자유 모드: 목표·기한 없음 */ }
    else if (s.cumProfit >= rules.winProfit || served.size >= Math.min(rules.winCities, CITIES.length)) { s.status = 'won'; s.log.push('목표를 달성했습니다!'); }
    else if (this.monthsPassed >= rules.timeLimitMonths) { s.status = 'timeup'; s.log.push('제한 기간이 끝났습니다.'); }
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
      st.formatVersion = 2;
    }
    return new Game(st.seed ?? 1, st);
  }
}
