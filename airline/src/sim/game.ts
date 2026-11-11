import { config } from '../config';
import { AIRCRAFT, EVENTS, CITIES, typeById, cityById, scenarioById } from '../data';
import { Rng } from './rng';
import { marketSize, baseFare, baseSlots, bizDemandShare, blockHours, canFly, cargoRate, distanceKm, maxWeeklyRoundTrips, priceFactor, rawCargoDemand, rawMonthlyDemand } from './model';
import { ACHIEVEMENTS, LADDERS } from './achievements';
import type { ChronEntry, Competitor, Contract, ContractReward, DayStat, Difficulty, EventDef, GameState, GoalProgress, MonthReport, Plane, Route } from './types';

export const FORMAT_VERSION = 13; // 12 → 13: 연대기·허브 투자 / 11 → 12: 대형 항공사·시대·계약 / 10 → 11: 경매·예고된 행사 / 9 → 10: 경쟁사가 생기고 파산한다(경쟁사 ID 카운터·파산 기록) / 8 → 9: 경쟁사 수 증가 / 7 → 8: 임대기·제휴 / // 1 → 2: 대출·샌드박스·항공기 나이·사건 대응 / 2 → 3: 슬롯·허브·일일 기록·비즈니스석·화물·경쟁사·도시 성장 / 3 → 4: 경기 지수 / 4 → 5: 시작 도시·난이도·시나리오 / 5 → 6: 연료·정비·대출 중단 / 6 → 7: 노선 우선순위
export interface GameOptions { base?: string; difficulty?: Difficulty; scenario?: string; sandbox?: boolean; rights?: boolean } // rights: 자유 모드에서 지역 운수권 제한을 켠다 // sandbox: 목표·기한 없는 자유 모드로 시작(시작 자금·기체는 '자유 경영' 시나리오와 같다)
export interface RouteOption { type: string; weekly: number; price: number; profit: number; payback: number | null; slotCost: number; slotNeeds: { city: string; n: number }[]; recommended: boolean } // profit: 이 기종 한 대를 더 넣었을 때 늘어나는 월 이익(고정비·슬롯 임대료 반영), payback: 새 기체 값 ÷ profit(개월)
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const month1 = (day: number) => (Math.floor(day / config.daysPerMonth) % 12) + 1; // 1일차는 1월

/** 노선 하루 계산 결과(화면 추정과 실제 정산이 같은 함수를 쓴다) */
export interface RouteDay {
  demand: number; seats: number; pax: number; revenue: number; cost: number; legs: number; // pax·seats는 일반석+비즈니스석 합계
  paxE: number; paxB: number; seatsE: number; seatsB: number; demandE: number; demandB: number;
  cargoT: number; cargoCap: number; cargoDemand: number; cargoRevenue: number; share: number; // share: 경쟁 점유율(1 = 독점)
  transfer: number; // 환승 수요(월, 운임 반영 전)
  otp: number; compensation: number; // otp: 정시율(0~1), compensation: 지연 보상금(M)
  revenuePax: number; costOps: number; costLanding: number; costPax: number; // 손익 분해(M, 하루): 여객 수익, 운영·연료비, 착륙료, 승객당 수수료
}

/** 항공사 이름 풀: 앞의 둘은 처음부터 있고, 나머지는 시간이 지나며 신생 항공사로 등장한다(파산한 이름은 다시 쓰지 않는다) */
export const COMP_NAMES: [string, 'low' | 'premium', string][] = [['한바다항공', 'low', 'PUS'], ['그랜드 에어', 'premium', 'NRT'], ['유로윙즈', 'low', 'LHR'], ['아메리고 항공', 'premium', 'JFK'], ['사막의 별 항공', 'premium', 'DXB'], ['남십자성 항공', 'low', 'SYD'], ['실크로드 항공', 'premium', 'PEK'], ['블루 라군 에어', 'low', 'SIN'], ['하이랜드 항공', 'premium', 'DEL'], ['새벽 에어', 'low', 'ICN'], ['대서양 익스프레스', 'low', 'CDG'], ['안데스 항공', 'premium', 'GRU']];

export class Game {
  state: GameState;
  private rng: Rng;

  constructor(seed = 1, state?: GameState, opts: GameOptions = {}) {
    if (state) { this.state = state; this.rng = new Rng(state.seed); this.rng.setState(state.rng); return; }
    this.rng = new Rng(seed);
    const sc = scenarioById(opts.sandbox ? 'free' : opts.scenario ?? 'free'), diff = opts.difficulty ?? 'normal', dm = config.difficulty[diff];
    const base = sc.lockBase && sc.base ? sc.base : (opts.base && CITIES.some((c) => c.id === opts.base) ? opts.base : (sc.base ?? 'ICN'));
    this.state = {
      formatVersion: FORMAT_VERSION, seed, rng: this.rng.getState(), day: 0,
      cash: Math.round(sc.cash * dm.cash * 10) / 10, reputation: config.start.reputation, nextId: 1,
      planes: [], routes: [], events: sc.events.map((e) => ({ ...e })), cumProfit: 0, loan: sc.loan, slots: {}, growth: {}, competitors: Game.initCompetitors(dm.rival), economy: sc.economy, fuel: 1, hedge: null, ally: null, nextRival: config.competitors.start + 1, rivalsGone: [], auctions: [], upcoming: [], chronicle: [], hubs: {}, era: null, nextEra: null, eraFree: config.eras.firstFree, contracts: [], contractsDone: 0, nextOffer: config.contract.firstMonth, rights: opts.sandbox && opts.rights ? [cityById(base).region] : undefined, freeze: 0, sandbox: !!opts.sandbox, history: [],
      base, difficulty: diff, scenario: sc.id,
      cur: { revenue: 0, cost: 0, pax: 0, seats: 0 }, status: 'playing', lowCashMonths: 0, log: [],
    };
    this.addPlane(sc.plane, typeById(sc.plane).price); // 시작 항공기는 무료로 받지만 장부가·감가상각은 같다
  }

  static initCompetitors(rival = 1): Competitor[] {
    return COMP_NAMES.slice(0, config.competitors.start).map(([name, style, hub], i) => ({ id: i + 1, name, style, hub, cash: Math.round(config.competitors.startCash * rival), planes: 0, routes: [] }));
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
    const prio = this.state.routes.filter((r) => r.open && this.planesOn(r.id).length > 0).reduce((a, r) => a + Math.max(0, (r.priority ?? 1) - 1), 0) * config.delay.priorityFee; // 우선 배정 수수료(★1 기본은 무료)
    return (config.cost.fixedMonthly + config.cost.perPlaneMonthly * this.state.planes.length + config.slot.lease * slots + prio + this.leaseMonthly + this.hubUpkeep + (this.state.ally != null ? config.ally.fee : 0)) * this.mods.fixed;
  }
  /** 임대기 월 임대료 합계 */
  get leaseMonthly(): number { return this.state.planes.reduce((a, p) => a + (p.leased ? typeById(p.type).price * config.lease.rate : 0), 0); }
  /** 환승 수요(월, 일반석 환산): 이 노선의 한쪽 끝을 허브 삼아 우리 다른 노선으로 갈아타는 손님. 우리 직항이 없고 너무 돌아가지 않는 도시 쌍만 센다 */
  transferDemand(r: Route): number {
    if (!this.planesOn(r.id).length) return 0;
    const t = config.transfer, served = this.state.routes.filter((x) => x.open && x.id !== r.id && this.planesOn(x.id).length > 0);
    let sum = 0;
    for (const [h, o] of [[r.a, r.b], [r.b, r.a]]) for (const x of served) {
      const far = x.a === h ? x.b : x.b === h ? x.a : null;
      if (!far || far === o || served.some((y) => (y.a === o && y.b === far) || (y.a === far && y.b === o))) continue;
      const O = cityById(o), H = cityById(h), X = cityById(far);
      if ((distanceKm(O, H) + distanceKm(H, X)) / Math.max(1, distanceKm(O, X)) > t.maxDetour) continue;
      sum += Math.min(rawMonthlyDemand(O, X, this.month, this.growthOf(o), this.growthOf(far)) * t.share, this.monthlySeats(x.id) * t.seatCap); // 이어지는 노선에 자리가 있어야 갈아탈 수 있다
    }
    return sum;
  }
  /** 노선의 한 달 공급 좌석(사건·정비는 무시한 계획값) */
  monthlySeats(routeId: number): number { return this.planesOn(routeId).reduce((a, p) => a + typeById(p.type).seats * ((p.weekly * 2) / 7) * config.daysPerMonth, 0); }
  /** 이 노선에서 운임 전쟁 중인 경쟁사(없으면 undefined) */
  warOn(r: Route): { comp: Competitor; route: Competitor['routes'][number] } | undefined { return this.competitorsOn(r.a, r.b).find((x) => (x.route.war ?? 0) > 0); }
  /** 회사 업그레이드의 현재 효과(단계 × 1단계 효과). second면 두 번째 효과 */
  up(id: string, second = false): number { const u = config.upgrades.list.find((x) => x.id === id), lv = this.state.upgrades?.[id] ?? 0; return u ? lv * ((second ? (u as { effect2?: number }).effect2 : u.effect) ?? 0) : 0; }
  upgradeLevel(id: string): number { return this.state.upgrades?.[id] ?? 0; }
  /** 다음 단계 가격(M). 끝까지 올렸으면 null */
  upgradePrice(id: string): number | null { return config.upgrades.prices[this.upgradeLevel(id)] ?? null; }
  buyUpgrade(id: string): Result<{ level: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!config.upgrades.list.some((x) => x.id === id)) return fail('없는 업그레이드입니다');
    const price = this.upgradePrice(id);
    if (price === null) return fail('이미 최고 단계입니다');
    if (this.state.cash < price) return fail('현금이 모자랍니다');
    this.state.cash -= price; this.state.cur.cost += price;
    const level = this.upgradeLevel(id) + 1;
    this.state.upgrades = { ...this.state.upgrades, [id]: level };
    return { ok: true, level };
  }
  /** 난이도 보정 */
  get mods() { return config.difficulty[this.state.difficulty ?? 'normal']; }
  agingMult(p: Plane): number {
    let m = Math.min(config.aging.maxMult, 1 + config.aging.maintPerMonth * p.age); const e = this.eraNow;
    if (e?.oldCost && p.age > config.aging.capStart) m *= 1 + e.oldCost; // 탄소세 시대: 낡은 기체는 더 든다
    if (e?.newCost && (typeById(p.type).from ?? 0) > 0) m *= 1 + e.newCost; // 새로 출시된 기종은 덜 든다
    return m;
  }
  /** 지금 시대의 효과(평시면 null) */
  get eraNow() { const e = this.state.era; return e ? config.eras.list.find((x) => x.id === e.id) ?? null : null; }
  /** 대출 한도 = 기본 + 보유 항공기 장부가 합 × 비율 */
  get loanLimit(): number { return config.loan.limitBase + config.loan.limitBookRatio * this.state.planes.reduce((a, p) => a + p.book, 0); }
  /** 이번 달 대출 월 이율(한도를 많이 쓸수록 오른다) */
  get loanRate(): number { const lim = this.loanLimit; return (config.loan.baseRate + config.loan.spread * (lim > 0 ? Math.min(1, this.state.loan / lim) : 0) + Math.max(0, 0.95 - (this.state.economy ?? 1)) * config.loan.crunch) * this.mods.rate; } // 불황이면 은행이 이율을 올린다(신용 경색)

  // ---- 슬롯·허브 ----
  slotCapacity(cityId: string): number { return baseSlots(cityById(cityId)) + (this.state.slots[cityId] ?? 0) + this.hubLevel(cityId, 'terminal') * config.invest.terminal.slots; }
  // ---- 허브 투자 ----
  hubLevel(cityId: string, kind: 'terminal' | 'mro' | 'lounge'): number { return this.state.hubs?.[cityId]?.[kind] ?? 0; }
  hubPrice(cityId: string, kind: 'terminal' | 'mro' | 'lounge'): number | null { return config.invest[kind].prices[this.hubLevel(cityId, kind)] ?? null; }
  /** 허브 투자의 월 운영비 합계 */
  get hubUpkeep(): number { return Object.values(this.state.hubs ?? {}).reduce((a, h) => a + (h.terminal ?? 0) + (h.mro ?? 0) + (h.lounge ?? 0), 0) * config.investUpkeep; }
  buyHub(cityId: string, kind: 'terminal' | 'mro' | 'lounge'): Result<{ level: number }> {
    const s = this.state;
    if (s.status !== 'playing') return fail('게임이 끝났습니다');
    if (!CITIES.some((c) => c.id === cityId) || !(['terminal', 'mro', 'lounge'] as string[]).includes(kind)) return fail('없는 도시나 투자입니다');
    if (!this.cityOpen(cityId)) return fail('운수권이 없는 지역입니다');
    if (this.linksAt(cityId) < 1 && cityId !== s.base) return fail('이 도시에 취항(항공기 배정)한 뒤에 투자할 수 있습니다');
    const price = this.hubPrice(cityId, kind);
    if (price === null) return fail('이미 최고 단계입니다');
    if (s.cash < price) return fail(`현금이 모자랍니다 (필요 $${price}M, 지금 $${s.cash.toFixed(1)}M)`);
    s.cash -= price; s.cur.cost += price;
    const level = this.hubLevel(cityId, kind) + 1; s.hubs = { ...s.hubs, [cityId]: { ...s.hubs[cityId], [kind]: level } };
    this.note(this.monthsPassed + 1, 'invest', `${cityById(cityId).name} ${config.invest[kind].name} ${level}단계 완공($${price}M)`);
    return { ok: true, level };
  }
  /** 운항 노선 양끝 도시 중 정비 기지 단계가 높은 쪽(정비 상태가 덜 닳는 정도) */
  /** 이 항공기가 오가는 노선 양끝 중 정비 기지 단계가 높은 쪽 */
  private mroLevel(p: Plane): number { const r = p.routeId !== null ? this.route(p.routeId) : undefined; return r ? Math.max(this.hubLevel(r.a, 'mro'), this.hubLevel(r.b, 'mro')) : 0; }
  private mroFactor(p: Plane): number { return this.mroLevel(p) * config.invest.mro.decay; }
  // ---- 연대기 ----
  /** 연대기에 한 줄 남긴다(m: 개월차). key가 있으면 같은 key는 한 번만 */
  private note(m: number, kind: string, text: string, extra: Partial<ChronEntry> = {}): void {
    const s = this.state; if (extra.key && s.chronicle.some((e) => e.key === extra.key)) return;
    s.chronicle.push({ m, kind, text, ...extra }); if (s.chronicle.length > 400) s.chronicle.shift();
  }
  /** 월말 기록: 이정표·업적·최고 이익·연말 결산 */
  private noteMonthEnd(): void {
    const s = this.state, m = this.monthsPassed, h = s.history, last = h[h.length - 1];
    for (const l of LADDERS) { const v = l.value(this); for (const st of l.steps) if (v >= st) this.note(m, 'milestone', `${l.name} ${l.unit === 'M' ? `$${st}M` : `${st.toLocaleString('en-US')}${l.unit}`} 달성`, { key: `ms:${l.id}:${st}` }); }
    for (const a of ACHIEVEMENTS) if (a.test(this)) this.note(m, 'achievement', `업적 달성: ${a.name}`, { key: `ach:${a.id}` });
    const prevMax = Math.max(0, ...h.slice(0, -1).map((x) => x.profit)), lastRec = [...s.chronicle].reverse().find((e) => e.kind === 'record');
    if (h.length >= 4 && last.profit > 5 && last.profit > prevMax * 1.1 && (!lastRec || m - lastRec.m >= 3)) this.note(m, 'record', `월 이익 최고 기록 $${last.profit.toFixed(1)}M`);
    if (m % 12 === 0) {
      const yr = h.slice(-12), rk = this.ranking(), profit = yr.reduce((a, x) => a + x.profit, 0), rank = this.rank();
      this.note(m, 'year', `${m / 12}년차 결산: 이익 $${profit.toFixed(0)}M · 매출 순위 ${rank}/${rk.length}`, { d: { profit, pax: yr.reduce((a, x) => a + x.pax, 0), revenue: yr.reduce((a, x) => a + x.revenue, 0), planes: s.planes.length, cities: this.servedCities().size, rank, total: rk.length } });
    }
  }
  /** 옛 저장 파일: 이미 이룬 이정표·업적은 조용히 처리(연대기에 거짓 날짜가 남지 않게) */
  seedChronicle(): void { for (const l of LADDERS) for (const st of l.steps) if (l.value(this) >= st) this.state.chronicle.push({ m: 0, kind: 'old', text: '', key: `ms:${l.id}:${st}` }); for (const a of ACHIEVEMENTS) if (a.test(this)) this.state.chronicle.push({ m: 0, kind: 'old', text: '', key: `ach:${a.id}` }); }
  /** 이 도시에서 우리 항공사가 쓰는 하루 이착륙 횟수(왕복 1회 = 출발 1 + 도착 1) */
  slotsUsed(cityId: string): number {
    let ops = 0;
    const old = 1 + (this.eraNow?.oldSlots ?? 0); // 소음 규제 시대: 낡은 기체는 슬롯을 더 차지한다
    for (const r of this.state.routes) if (r.open && (r.a === cityId || r.b === cityId)) for (const p of this.planesOn(r.id)) ops += ((p.weekly * 2) / 7) * (p.age > config.aging.capStart ? old : 1);
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

  /** 노선의 정시율(0~1): 두 공항의 혼잡(우선순위로 완화) · 배정 항공기의 정비 상태 · 폭설·파업 사건에 따라 떨어진다 */
  routeOtp(r: Route): number {
    const d = config.delay, pr = Math.min(3, Math.max(1, r.priority ?? 1));
    let pen = 0;
    for (const c of [r.a, r.b]) {
      const ratio = this.slotsUsed(c) / Math.max(1, this.slotCapacity(c));
      pen += ((Math.min(1, Math.max(0, (ratio - d.congestStart) / (1 - d.congestStart))) * d.congestMax * d.priorityMult[pr]) / 2) * (1 - this.hubLevel(c, 'terminal') * config.invest.terminal.delay);
    }
    const ps = this.planesOn(r.id);
    if (ps.length) { const avg = ps.reduce((a, p) => a + p.cond, 0) / ps.length; pen += Math.max(0, d.condStart - avg) * d.condWeight; }
    for (const e of this.state.events) {
      const def = EVENTS.find((x) => x.id === e.def)!, k = e.handled ? 0.5 : 1;
      if (def.id === 'snow' && e.city && (r.a === e.city || r.b === e.city)) pen += d.snow * k;
      if (def.id === 'strike') pen += d.strike * k;
    }
    return Math.min(1, Math.max(d.min, 1 - pen * (1 - this.up('ground'))));
  }
  /** 우리 항공사 전체 정시율(좌석 가중 평균) */
  get avgOtp(): number {
    let w = 0, t = 0;
    for (const r of this.state.routes) if (r.open && this.planesOn(r.id).length) { const s = this.routeDay(r).seats || 1; w += s; t += s * this.routeOtp(r); }
    return w > 0 ? t / w : 1;
  }

  /** 노선의 하루 결과(현재 달·평판·운임·사건·경쟁·성장 기준). 실제 정산도 이 값을 쓴다 */
  routeDay(r: Route): RouteDay {
    const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), s = this.state, ps = this.planesOn(r.id);
    const base = baseFare(km), baseBiz = base * config.cabin.bizFareMult, c = config;
    // 기본 수요(일반석 환산): 규모·거리·계절·성장 × 허브 × 평판
    const hub = 1 + (this.hubBonus(r.a) + this.hubBonus(r.b)) / 2;
    const transfer = this.transferDemand(r);
    let d0 = (rawMonthlyDemand(A, B, this.month, this.growthOf(r.a), this.growthOf(r.b)) * hub + transfer) * (1 + c.demand.repBoost * s.reputation);
    let cg0 = rawCargoDemand(A, B, this.growthOf(r.a), this.growthOf(r.b)) * hub * (1 + c.demand.repBoost * s.reputation);
    const eco = s.economy ?? 1;
    const fuelPrice = s.hedge ? s.hedge.price : (s.fuel ?? 1), fuelMult = 1 - c.fuel.share + c.fuel.share * fuelPrice; // 계약 중이면 계약 가격
    d0 *= eco; cg0 *= Math.pow(eco, c.economy.cargoPow);
    let capMult = 1, costMult = 1 - this.up('ops');
    d0 *= 1 + this.up('marketing');
    for (const e of s.events) {
      const def = EVENTS.find((x) => x.id === e.def)!, k = e.handled && def.option ? def.option.scale : 1; // 대응하면 효과가 줄어든다
      if (def.effect.demand) { d0 *= 1 + def.effect.demand * k; cg0 *= 1 + def.effect.demand * k; }
      if (def.effect.cost) costMult *= 1 + def.effect.cost * k;
      if (def.effect.routeDemand && e.city && (r.a === e.city || r.b === e.city)) d0 *= 1 + def.effect.routeDemand * k;
      if (def.effect.cap) capMult *= 1 + def.effect.cap * k;
      if (def.effect.cityCap && e.city && (r.a === e.city || r.b === e.city)) capMult *= 1 + def.effect.cityCap * k;
    }
    const otp = this.routeOtp(r);
    d0 *= 1 - c.delay.demandWeight + c.delay.demandWeight * otp; cg0 *= 1 - c.delay.demandWeight + c.delay.demandWeight * otp; // 지연이 잦으면 손님이 떠난다
    const sb = bizDemandShare(A, B);
    // 공급: 항공기마다 일반석·비즈니스석·화물 적재량
    let seatsE = 0, seatsB = 0, cargoCap = 0, hours = 0, legs = 0;
    const grounded = new Map<number, number>(); // 엔진 결함: 해당 항공기는 운항하지 못한다(수리 대응하면 절반)
    for (const e of s.events) if (e.planeId !== undefined && EVENTS.find((x) => x.id === e.def)?.effect.ground) grounded.set(e.planeId, e.handled ? 0.5 : 0);
    for (const p of ps) {
      const t = typeById(p.type), l = ((p.weekly * 2) / 7) * capMult * (grounded.get(p.id) ?? 1) * (p.shop > 0 ? 0 : 1);
      const b = Math.min(0.3, Math.max(0, p.bizShare ?? 0));
      seatsB += ((t.seats * b) / c.cabin.bizSeatArea) * l; seatsE += t.seats * (1 - b) * l; cargoCap += t.cargo * l; legs += l;
      hours += l * blockHours(km, t) * t.hourly * this.agingMult(p) * fuelMult / 1000; // hours: 비용(M), 노후하면 정비비가, 연료가 오르면 연료비가 는다
    }
    // 경쟁 점유율: 좌석·운임·품질에 비례해 시장을 나눈다(경쟁사가 없으면 독점)
    let share = 1;
    const comps = this.competitorsOn(r.a, r.b);
    if (comps.length && seatsE + seatsB > 0) {
      const wp = Math.max(1, seatsE + seatsB) * (base / Math.max(1, r.fare)) * (1 + c.demand.repBoost * s.reputation);
      let wc = 0;
      for (const { comp, route } of comps) wc += route.seatsDay * (1 / Math.max(0.3, route.fareRatio)) * this.quality(comp.style) * (comp.id === s.ally ? c.ally.weight : 1);
      share = Math.min(1, Math.max(0.1, wp / (wp + wc)));
    }
    const demE = (d0 * (1 - sb) * priceFactor(r.fare, base) * share) / c.daysPerMonth;
    const demB = (d0 * sb * Math.pow(eco, c.economy.bizPow - 1) * priceFactor(r.fareBiz, baseBiz, c.cabin.bizElasticity) * share * (1 + this.up('service')) * (1 + ((this.hubLevel(r.a, 'lounge') + this.hubLevel(r.b, 'lounge')) / 2) * config.invest.lounge.biz)) / c.daysPerMonth; // 비즈니스는 경기에 더 민감(d0에 이미 한 번 곱함)
    const paxB = Math.min(demB, seatsB), paxE = Math.min(demE, seatsE), pax = paxE + paxB;
    const cgDem = (cg0 * priceFactor(r.cargoRatio, 1, c.cargo.elasticity) * share) / c.daysPerMonth, cargoT = Math.min(cgDem, cargoCap);
    const cargoRevenue = (cargoT * cargoRate(km) * r.cargoRatio) / 1e6;
    const revenue = (paxE * r.fare + paxB * r.fareBiz) / 1e6 + cargoRevenue;
    const compensation = revenue * (1 - otp) * c.delay.compensation; // 지연 보상금
    const cost = (hours + (legs * c.cost.landingFeeK) / 1000 + (pax * c.cost.perPaxFee) / 1e6) * costMult + compensation;
    const revenuePax = (paxE * r.fare + paxB * r.fareBiz) / 1e6, costOps = hours * costMult, costLanding = ((legs * c.cost.landingFeeK) / 1000) * costMult, costPax = ((pax * c.cost.perPaxFee) / 1e6) * costMult;
    return { revenuePax, costOps, costLanding, costPax, demand: demE + demB, seats: seatsE + seatsB, pax, revenue, cost, legs, paxE, paxB, seatsE, seatsB, demandE: demE, demandB: demB, cargoT, cargoCap, cargoDemand: cgDem, cargoRevenue, share, transfer, otp, compensation };
  }

  // ---------- 행동 ----------
  private addPlane(type: string, price: number, extra: Partial<Plane> = {}): Plane {
    const p: Plane = { id: this.state.nextId++, type, book: price, routeId: null, weekly: 0, age: 0, bizShare: 0, cond: 1, shop: 0, ...extra };
    this.state.planes.push(p);
    return p;
  }
  // ---- 지역 운수권 ----
  get rightsOn(): boolean { return !!this.state.rights; }
  regionName(region: string): string { return config.rights.regions[region] ?? region; }
  /** 이 도시로 노선을 열 수 있는가(운수권 제한이 없으면 항상 참) */
  cityOpen(cityId: string): boolean { return !this.state.rights || this.state.rights.includes(cityById(cityId).region); }
  /** 지역 운수권 값($M): 이미 가진 지역과 가까울수록 싸다 */
  rightsPrice(region: string): number {
    const owned = CITIES.filter((c) => this.state.rights?.includes(c.region)); let d = Infinity;
    for (const a of CITIES.filter((c) => c.region === region)) for (const o of owned) d = Math.min(d, distanceKm(a, o));
    return (config.rights.price.find(([lim]) => d < lim) ?? config.rights.price[config.rights.price.length - 1])[1];
  }
  /** 다음 지역을 사려면 필요한 누적 이익($M) */
  get rightsNeed(): number { const n = this.state.rights?.length ?? 1, k = config.rights.need; return k[Math.min(n - 1, k.length - 1)]; }
  regionInfo(region: string) {
    const owned = !!this.state.rights?.includes(region), price = this.rightsPrice(region), need = this.rightsNeed;
    return { id: region, name: this.regionName(region), owned, price, need, profitOk: this.state.cumProfit >= need, cashOk: this.state.cash >= price, cities: CITIES.filter((c) => c.region === region).map((c) => c.id) };
  }
  buyRights(region: string): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!this.state.rights) return fail('이 게임에는 운수권 제한이 없습니다');
    if (!(region in config.rights.regions)) return fail('없는 지역입니다');
    const i = this.regionInfo(region);
    if (i.owned) return fail('이미 운수권이 있는 지역입니다');
    if (!i.profitOk) return fail(`누적 이익 $${i.need}M 이상이 필요합니다 (지금 $${this.state.cumProfit.toFixed(1)}M)`);
    if (!i.cashOk) return fail(`현금이 모자랍니다 (필요 $${i.price}M, 지금 $${this.state.cash.toFixed(1)}M)`);
    this.state.cash -= i.price; this.state.rights = [...this.state.rights, region];
    this.note(this.monthsPassed + 1, 'rights', `${i.name} 운수권 확보($${i.price}M)`);
    return { ok: true };
  }
  /** 출시된 기종인가(처음부터 있는 기종이거나, 출시 개월이 지났거나, 이미 갖고 있으면 참) */
  isAvailable(typeId: string): boolean { const t = typeById(typeId); return this.monthsPassed >= (t.from ?? 0) || this.state.planes.some((p) => p.type === typeId); }
  /** 아직 출시 전인 기종(곧 나오는 순서) */
  upcomingTypes() { return AIRCRAFT.filter((t) => !this.isAvailable(t.id)).sort((a, b) => (a.from ?? 0) - (b.from ?? 0)); }
  private notReleased(typeId: string) { return fail(`아직 출시되지 않은 기종입니다 (${typeById(typeId).from}개월차 출시)`); }
  /** 항공기를 산다. used면 중고기: 싸지만 낡아서 운영비가 더 들고 정비 상태가 낮다 */
  buyPlane(typeId: string, used = false): Result<{ planeId: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!this.isAvailable(typeId)) return this.notReleased(typeId);
    const t = typeById(typeId), u = config.used, price = used ? Math.round(t.price * u.price * 10) / 10 : t.price;
    if (this.state.cash < price) return fail('현금이 모자랍니다');
    this.state.cash -= price;
    return { ok: true, planeId: this.addPlane(typeId, price, used ? { age: u.age, cond: u.cond } : {}).id };
  }
  /** 항공기를 빌린다: 살 돈은 안 들지만 매달 임대료를 낸다. 내 자산이 아니라서 담보(대출 한도)가 되지 않는다 */
  leasePlane(typeId: string): Result<{ planeId: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!this.isAvailable(typeId)) return this.notReleased(typeId);
    if (this.leasedCount >= this.leaseCap) return fail(`임대는 내 항공기 수 + ${config.lease.extra}대(지금 ${this.leaseCap}대)까지 가능합니다`);
    const deposit = typeById(typeId).price * config.lease.rate * config.lease.deposit;
    if (this.state.cash < deposit) return fail(`보증금 $${deposit.toFixed(1)}M이 모자랍니다`);
    this.state.cash -= deposit;
    return { ok: true, planeId: this.addPlane(typeId, 0, { leased: true, deposit }).id };
  }
  get leasedCount(): number { return this.state.planes.filter((p) => p.leased).length; }
  /** 임대 가능한 최대 대수 = 내 항공기(임대 아닌 것) 수 + 2 */
  get leaseCap(): number { return this.state.planes.filter((p) => !p.leased).length + config.lease.extra; }
  /** 임대기 반납 위약금: 최소 임대 기간(12개월)이 안 찼으면 남은 개월 임대료, 최소 1개월치 */
  leaseReturnFee(p: Plane): number { return typeById(p.type).price * config.lease.rate * Math.max(1, config.lease.minMonths - p.age); }
  /** 임대기 매입가: 새 기체 값 × (1 − 0.5% × 사용 개월), 최소 50% */
  leaseBuyoutPrice(p: Plane): number { return Math.round(typeById(p.type).price * Math.max(config.lease.buyoutMin, 1 - config.lease.buyoutDrop * p.age) * 10) / 10; }
  /** 임대기를 사서 내 항공기로 만든다(보증금은 돌려받아 매입가에서 뺀다). 이후 감가상각·담보·매각이 내 항공기와 같다 */
  buyOutLease(planeId: number): Result<{ price: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const p = this.plane(planeId);
    if (!p || !p.leased) return fail('임대 중인 항공기가 아닙니다');
    const price = this.leaseBuyoutPrice(p), net = price - (p.deposit ?? 0);
    if (this.state.cash < net) return fail('현금이 모자랍니다');
    this.state.cash -= net; p.leased = false; p.book = price; p.deposit = 0;
    return { ok: true, price };
  }
  /** 제휴(공동 운항)할 경쟁사를 정한다(null이면 해지). 한 번에 한 곳만 */
  setAlly(compId: number | null): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (compId !== null && !this.state.competitors.some((k) => k.id === compId)) return fail('없는 항공사입니다');
    this.state.ally = compId;
    for (const k of this.state.competitors) if (k.id === compId) for (const r of k.routes) delete r.war; // 제휴하면 운임 전쟁도 끝난다
    return { ok: true };
  }
  /** 항공기를 판다(노선에 배정돼 있으면 자동으로 뺀다). 매각가 = 장부가 × 0.9 */
  sellPlane(planeId: number): Result<{ price: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const i = this.state.planes.findIndex((p) => p.id === planeId);
    if (i < 0) return fail('없는 항공기입니다');
    const pl = this.state.planes[i], price = pl.leased ? (pl.deposit ?? 0) - this.leaseReturnFee(pl) : pl.book * config.sale.ratio; // 임대기는 반납: 보증금을 돌려받고 위약금을 낸다
    this.state.events = this.state.events.filter((e) => e.planeId !== planeId);
    this.state.planes.splice(i, 1);
    this.state.cash += price;
    return { ok: true, price };
  }
  /** 대출: 한도 안에서만. 이자는 매달 잔액 × 월 이율 */
  borrow(amount: number): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!(amount > 0)) return fail('금액이 올바르지 않습니다');
    if (this.state.freeze > 0) return fail(`은행이 대출을 중단했습니다 (${this.state.freeze}개월 남음)`);
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
  /** 정비 점검 비용(M): 기종 가격의 2%(최소 $0.5M) */
  serviceCost(p: Plane): number { return Math.max(config.maint.minCost, typeById(p.type).price * config.maint.costRatio) * this.agingMult(p) * (1 - this.up('hangar', true)) * (1 - this.mroLevel(p) * config.invest.mro.serviceCut); } // 낡을수록 점검도 비싸다, 정비 기지가 있으면 싸다
  /** 이 기체가 점검으로 회복할 수 있는 정비 상태의 상한(7년이 넘으면 낮아진다) */
  maxCond(p: Plane): number { const a = config.aging; return Math.max(a.capMin, 1 - Math.max(0, p.age - a.capStart) * a.capPerMonth); }
  /** 교체 권고: 점검해도 회복이 75% 아래까지만 되는 기체 */
  needsReplacement(p: Plane): boolean { return this.maxCond(p) < config.aging.replaceBelow; }
  /** 항공기를 정비 점검한다: 7일간 운항하지 못하고, 정비 상태가 100%로 돌아온다 */
  service(planeId: number): Result<{ cost: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const p = this.plane(planeId);
    if (!p) return fail('없는 항공기입니다');
    if (p.shop > 0) return fail('이미 정비 중입니다');
    const cap = this.maxCond(p);
    if (p.cond >= cap - 0.005) return fail(cap < 1 ? `이 기체는 낡아서 정비 상태를 ${Math.round(cap * 100)}% 넘게 회복할 수 없습니다` : '이미 정비 상태가 최고입니다');
    const cost = this.serviceCost(p);
    if (this.state.cash < cost) return fail('현금이 모자랍니다');
    this.state.cash -= cost; this.state.cur.cost += cost; p.cond = cap; p.shop = config.maint.shopDays;
    return { ok: true, cost };
  }
  /** 자리를 꽉 채우는 가장 높은 운임(수요 = 좌석이 되는 운임)으로 일반석 운임을 맞춘다 */
  fillFare(routeId: number): void {
    const r = this.route(routeId)!, base = this.routeBaseFare(r);
    const saved = r.fare; r.fare = Math.round(base);
    const d = this.routeDay(r);
    if (d.seatsE <= 0 || d.demandE <= 0) { r.fare = saved; return; }
    const ratio = 1 + Math.log(d.demandE / d.seatsE) / config.demand.elasticity; // 수요(운임) = 수요(기준)·priceFactor 이므로 해석적으로 구한다
    this.setFare(routeId, base * Math.min(config.fare.maxRatio, Math.max(config.fare.minRatio, ratio)));
    // 비즈니스석도 같은 방식으로: 수요가 좌석보다 많으면 운임을 올리고 모자라면 내린다(기내 서비스·라운지 같은 수요 효과가 운임으로 돌아온다)
    if (d.seatsB > 0) {
      const baseB = this.routeBaseFareBiz(r), savedB = r.fareBiz; r.fareBiz = Math.round(baseB);
      const db = this.routeDay(r);
      if (db.demandB > 0) this.setFareBiz(routeId, baseB * Math.min(config.fare.maxRatio, Math.max(config.fare.minRatio, 1 + Math.log(db.demandB / db.seatsB) / config.cabin.bizElasticity)));
      else r.fareBiz = savedB;
    }
  }
  setAutoFare(on: boolean): void { this.state.autoFare = on; }
  /** 노선 별명(빈 문자열이면 지움, 최대 16자) */
  setRouteName(routeId: number, name: string): Result {
    const r = this.route(routeId);
    if (!r) return fail('없는 노선입니다');
    const n = name.trim().slice(0, 16);
    if (n) r.name = n; else delete r.name;
    return { ok: true };
  }
  /** 자동 정비를 켜거나 끈다 */
  setAutoMaint(on: boolean): void { this.state.autoMaint = on; }
  /** 연료 계약: 지금 가격으로 6개월간 고정한다(오르면 이득, 내리면 손해) */
  hedgeFuel(): Result<{ price: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (this.state.hedge) return fail('이미 연료 계약 중입니다');
    const c = config.fuel;
    if (this.state.cash < c.hedgeCost) return fail('현금이 모자랍니다');
    this.state.cash -= c.hedgeCost; this.state.cur.cost += c.hedgeCost;
    this.state.hedge = { price: this.state.fuel, monthsLeft: c.hedgeMonths };
    return { ok: true, price: this.state.fuel };
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
  /** 항공기(planeId, 새 항공기면 null)를 노선에 주 weekly회로 배정할 때 모자라는 슬롯과 사는 데 드는 돈 */
  slotShortfall(planeId: number | null, routeId: number, weekly: number): { needs: { city: string; n: number }[]; cost: number } {
    const r = this.route(routeId), p = planeId === null ? undefined : this.plane(planeId), needs: { city: string; n: number }[] = []; let cost = 0;
    if (!r) return { needs, cost };
    const old = p && p.routeId !== null ? this.route(p.routeId) : undefined;
    for (const c of [r.a, r.b]) {
      const mine = old && p && (old.a === c || old.b === c) ? (p.weekly * 2) / 7 : 0;
      const short = this.slotsUsed(c) - mine + (Math.floor(weekly) * 2) / 7 - this.slotCapacity(c), n = short > 1e-9 ? Math.ceil(short - 1e-9) : 0;
      if (n > 0) { needs.push({ city: c, n }); cost += n * this.slotPrice(c) + (config.slot.priceStep * n * (n - 1)) / 2; }
    }
    return { needs, cost };
  }
  /** 슬롯이 모자라면 필요한 만큼 사고 배정한다(현금이 모자라면 아무것도 사지 않는다) */
  assignBuyingSlots(planeId: number, routeId: number, weekly: number): Result<{ slotCost: number }> {
    const sf = this.slotShortfall(planeId, routeId, weekly);
    if (this.state.cash < sf.cost) return fail(`슬롯을 살 현금이 모자랍니다 (필요 $${sf.cost.toFixed(1)}M)`);
    const first = this.assign(planeId, routeId, weekly);
    if (first.ok) return { ok: true, slotCost: 0 };
    if (!first.error.includes('슬롯')) return first;
    for (const { city, n } of sf.needs) for (let i = 0; i < n; i++) this.buySlot(city);
    const r = this.assign(planeId, routeId, weekly);
    return r.ok ? { ok: true, slotCost: sf.cost } : r;
  }
  /** 이 노선에 항공기 한 대를 더 넣는다면: 기종별 예상(현재 수요 기준의 추정). 추천 = 월 이익이 나면서 회수 기간이 가장 짧은 기종 */
  routeOptions(routeId: number): RouteOption[] {
    const r = this.route(routeId); if (!r || !r.open) return [];
    const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), s = this.state, dpm = config.daysPerMonth;
    const b = this.routeDay(r), before = b.revenue - b.cost, out: RouteOption[] = [];
    for (const t of AIRCRAFT) {
      if (!this.isAvailable(t.id) || !canFly(t, A, B).ok) continue;
      const weekly = maxWeeklyRoundTrips(km, t); if (weekly < 1) continue;
      s.planes.push({ id: -1, type: t.id, book: t.price, routeId, weekly, age: 0, bizShare: 0, cond: 1, shop: 0 }); // 잠깐 끼워 넣고 계산한 뒤 바로 뺀다
      let a; try { a = this.routeDay(r); } finally { s.planes.pop(); }
      const sf = this.slotShortfall(null, routeId, weekly), slots = sf.needs.reduce((x, n) => x + n.n, 0);
      const profit = (a.revenue - a.cost - before) * dpm - (config.cost.perPlaneMonthly + config.slot.lease * slots) * this.mods.fixed;
      out.push({ type: t.id, weekly, price: t.price, profit, payback: profit > 0.05 ? t.price / profit : null, slotCost: sf.cost, slotNeeds: sf.needs, recommended: false });
    }
    let best: RouteOption | null = null;
    for (const o of out) if (o.payback !== null && (!best || o.payback < best.payback!)) best = o;
    if (best) best.recommended = true;
    return out;
  }
  /** 노선 화면에서 바로 사기: how = 새것·중고·임대. 슬롯이 모자라면 필요한 만큼 함께 사서 최대 횟수로 배정한다. total은 한 번에 드는 돈(기체 값 또는 보증금 + 슬롯) */
  purchasePlan(routeId: number, typeId: string, how: 'new' | 'used' | 'lease'): Result<{ weekly: number; price: number; slotCost: number; slotNeeds: { city: string; n: number }[]; total: number }> {
    const r = this.route(routeId);
    if (!r || !r.open) return fail('열려 있는 노선이 아닙니다');
    if (!this.isAvailable(typeId)) return this.notReleased(typeId);
    const t = typeById(typeId), A = cityById(r.a), B = cityById(r.b);
    if (!canFly(t, A, B).ok) return fail('이 기종은 이 노선을 날 수 없습니다');
    const weekly = maxWeeklyRoundTrips(distanceKm(A, B), t); if (weekly < 1) return fail('하루 가용 시간 안에 왕복할 수 없는 거리입니다');
    const price = how === 'used' ? Math.round(t.price * config.used.price * 10) / 10 : how === 'lease' ? t.price * config.lease.rate * config.lease.deposit : t.price;
    const sf = this.slotShortfall(null, routeId, weekly);
    return { ok: true, weekly, price, slotCost: sf.cost, slotNeeds: sf.needs, total: price + sf.cost };
  }
  buyForRoute(routeId: number, typeId: string, how: 'new' | 'used' | 'lease'): Result<{ planeId: number; weekly: number; slotCost: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const plan = this.purchasePlan(routeId, typeId, how);
    if (!plan.ok) return plan;
    if (how === 'lease' && this.leasedCount >= this.leaseCap) return fail(`임대는 내 항공기 수 + ${config.lease.extra}대(지금 ${this.leaseCap}대)까지 가능합니다`);
    if (this.state.cash < plan.total) return fail(`현금이 모자랍니다 (필요 $${plan.total.toFixed(1)}M)`);
    const b = how === 'lease' ? this.leasePlane(typeId) : this.buyPlane(typeId, how === 'used');
    if (!b.ok) return b;
    const r = this.assignBuyingSlots(b.planeId, routeId, plan.weekly);
    if (!r.ok) return fail(`항공기는 샀지만 배정하지 못했습니다: ${r.error}`);
    return { ok: true, planeId: b.planeId, weekly: plan.weekly, slotCost: r.slotCost };
  }
  /** 파산한 경쟁사의 항공기를 경매가로 산다(새 기체 값의 40%, 5년 된 기체) */
  buyAuction(lotId: number): Result<{ planeId: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const lot = this.state.auctions.find((a) => a.id === lotId);
    if (!lot) return fail('이미 팔렸거나 기간이 끝난 경매입니다');
    if (this.state.cash < lot.price) return fail('현금이 모자랍니다');
    this.state.cash -= lot.price; this.state.auctions = this.state.auctions.filter((a) => a.id !== lotId);
    return { ok: true, planeId: this.addPlane(lot.type, lot.price, { age: lot.age, cond: lot.cond }).id };
  }
  /** 최근 12개월 매출 순위(우리 + 경쟁사). 경쟁사 매출은 여객 매출만 추정한 값이다 */
  ranking(): { name: string; revenue: number; me: boolean }[] {
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    return [{ name: '우리 항공사', revenue: sum(this.state.history.slice(-12).map((h) => h.revenue)), me: true }, ...this.state.competitors.map((c) => ({ name: c.name, revenue: sum(c.revHist ?? []), me: false }))].sort((a, b) => b.revenue - a.revenue);
  }
  /** 우리 순위(1부터) */
  rank(): number { return this.ranking().findIndex((x) => x.me) + 1; }
  /** 진행 중인 사건에 비용을 내고 대응한다(효과가 줄어든다) */
  /** 사건 대응 비용: 시간이 지나고 항공기가 많아질수록 비싸진다(기본 × min(3, 1 + 2.5%/월) × (1 + 5% × (항공기 − 2))) */
  eventCost(def: EventDef): number {
    const k = config.events, base = def.option?.cost ?? 0;
    return base * Math.min(k.costMaxMult, 1 + k.costGrowth * this.monthsPassed) * (1 + k.costPerPlane * Math.max(0, this.state.planes.length - k.costFreePlanes));
  }
  respondEvent(index: number): Result {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const e = this.state.events[index];
    const def = e && EVENTS.find((x) => x.id === e.def);
    if (!e || !def?.option) return fail('대응할 수 없는 사건입니다');
    if (e.handled) return fail('이미 대응했습니다');
    const cost = this.eventCost(def);
    if (this.state.cash < cost) return fail('현금이 모자랍니다');
    this.state.cash -= cost; this.state.cur.cost += cost; e.handled = true;
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
    for (const id of [aId, bId]) if (!this.cityOpen(id)) return fail(`${cityById(id).name}은(는) ${this.regionName(cityById(id).region)} 지역이라 운수권이 필요합니다. 지도 탭의 '지역 운수권'에서 살 수 있습니다.`);
    const A = cityById(aId), B = cityById(bId);
    const ex = this.state.routes.find((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId));
    if (ex) { ex.open = true; return { ok: true, routeId: ex.id }; }
    const base = baseFare(distanceKm(A, B));
    const r: Route = { id: this.state.nextId++, a: aId, b: bId, fare: Math.round(base), fareBiz: Math.round(base * config.cabin.bizFareMult), cargoRatio: 1, open: true, daily: [], priority: 1 };
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
  /** 공항 우선 배정 등급(1~3). 높을수록 혼잡할 때 덜 지연되지만 월 수수료($0.1M × (등급-1))가 든다 */
  setPriority(routeId: number, level: number): Result {
    const r = this.route(routeId);
    if (!r) return fail('없는 노선입니다');
    if (![1, 2, 3].includes(level)) return fail('우선순위는 1~3입니다');
    r.priority = level;
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
    if (s.autoFare && s.day % 7 === 0) for (const r of s.routes) if (r.open && this.planesOn(r.id).length) this.fillFare(r.id); // 자동 운임: 매주
    for (const r of s.routes) {
      if (!r.open) continue;
      const d = this.routeDay(r);
      s.cash += d.revenue - d.cost;
      s.cur.revenue += d.revenue; s.cur.cost += d.cost; s.cur.pax += d.pax; s.cur.seats += d.seats;
      const st: DayStat = { pax: d.pax, seats: d.seats, profit: d.revenue - d.cost, cargo: d.cargoT, otp: d.otp };
      r.daily.push(st); if (r.daily.length > 60) r.daily.shift();
    }
    for (const p of s.planes) if (p.shop > 0) p.shop--;
    s.day++;
    if (s.day % config.daysPerMonth === 0) this.endMonth();
    s.rng = this.rng.getState();
  }
  advanceDays(n: number): void { for (let i = 0; i < n && this.state.status === 'playing'; i++) this.advanceDay(); }

  private startMonth(): void {
    const s = this.state;
    s.events = s.events.map((e) => ({ ...e, monthsLeft: e.monthsLeft - 1 })).filter((e) => e.monthsLeft > 0);
    s.auctions = s.auctions.filter((a) => a.expires > this.monthsPassed);
    const mp = this.monthsPassed;
    const major = s.competitors.find((c) => c.major);
    if (major) for (const a of [...s.auctions]) { // 대형 항공사도 경매에 입찰한다(첫 달은 우리에게 양보)
      if (major.planes < config.competitors.major.cap && mp > a.expires - config.auction.months && this.rng.next() < config.competitors.major.bidChance) { s.auctions = s.auctions.filter((x) => x.id !== a.id); major.planes++; s.log.push(`${mp + 1}개월차: ${major.name}이(가) 경매에 나온 항공기를 낙찰받았습니다.`); }
    }
    this.eraStep(); this.contractStep();
    for (const t of AIRCRAFT) { // 신기종: 6개월 전에 발표하고, 때가 되면 출시한다
      if ((t.from ?? 0) > 0 && mp === (t.from ?? 0) - 6) s.log.push(`${mp + 1}개월차: 신기종 발표 — ${t.name}(${t.cls})이(가) 6개월 뒤 출시됩니다.`);
      if ((t.from ?? 0) > 0 && mp === t.from) { s.log.push(`${mp + 1}개월차: 신기종 출시 — ${t.name}(${t.cls})을(를) 이제 살 수 있습니다.`); this.note(mp + 1, 'release', `신기종 출시: ${t.name}`); }
    }
    for (const u of [...s.upcoming]) { // 예고된 행사가 때가 되면 열린다
      if (u.start > mp) continue;
      s.upcoming = s.upcoming.filter((x) => x !== u);
      const d = EVENTS.find((x) => x.id === u.def);
      if (d) { s.events.push({ def: d.id, monthsLeft: d.months, city: u.city }); s.log.push(`${mp + 1}개월차: ${d.name} 개막(${cityById(u.city).name}) — ${d.text}`); this.note(mp + 1, 'event', `${cityById(u.city).name}에서 ${d.name} 개막`); }
    }
    if (!s.upcoming.length && this.rng.next() < config.events.festivalChance) { // 새 행사를 예고한다
      const fest = EVENTS.filter((e) => e.scheduled), d = fest[this.rng.int(fest.length)], city = d.hosts![this.rng.int(d.hosts!.length)];
      s.upcoming.push({ def: d.id, city, start: mp + config.events.festivalLead });
      s.log.push(`${mp + 1}개월차: ${d.name} 예고 — ${cityById(city).name}에서 ${config.events.festivalLead}개월 뒤 열립니다. 미리 노선과 항공기를 준비하세요.`);
    }
    if (this.rng.next() < config.events.chancePerMonth * this.mods.event) {
      const pool = EVENTS.filter((e) => !e.scheduled), def = pool[this.rng.int(pool.length)];
      let city: string | undefined;
      if (def.snowCities) city = def.snowCities[this.rng.int(def.snowCities.length)];
      if (def.boomCities) city = def.boomCities[this.rng.int(def.boomCities.length)];
      let planeId: number | undefined;
      if (def.effect.ground) { const fleet = s.planes.filter((p) => p.routeId !== null); if (fleet.length) planeId = fleet[this.rng.int(fleet.length)].id; }
      if (!def.effect.ground || planeId !== undefined) {
        s.events.push({ def: def.id, monthsLeft: def.months, city, planeId });
        if (def.effect.cash) s.cash += def.effect.cash;
        s.log.push(`${this.monthsPassed + 1}개월차: ${def.name}${city ? ` (${cityById(city).name})` : ''}${planeId !== undefined ? ` (${typeById(this.plane(planeId)!.type).name})` : ''} — ${def.text}`);
      }
    }
    // 경기 지수: 평균으로 돌아가려는 힘 + 무작위 흔들림
    const ec = config.economy;
    const rev = s.economy < config.credit.stickyBelow ? config.credit.stickyReversion : ec.reversion; // 불황에서는 평균으로 돌아오는 힘이 약하다(연속 불황)
    s.economy = Math.min(ec.max, Math.max(ec.min, s.economy + ((this.eraNow?.econ ?? 1) - s.economy) * rev + (this.rng.next() - 0.5) * ec.noise));
    // 연료 가격 지수와 계약
    const fc = config.fuel;
    s.fuel = Math.min(fc.max, Math.max(fc.min, s.fuel + ((this.eraNow?.fuel ?? 1) - s.fuel) * fc.reversion + (this.rng.next() - 0.5) * fc.noise));
    if (s.hedge) { s.hedge.monthsLeft--; if (s.hedge.monthsLeft <= 0) { s.hedge = null; s.log.push(`${this.monthsPassed + 1}개월차: 연료 계약이 끝났습니다.`); } }
    // 심한 불황이면 은행이 대출을 중단한다
    if (s.freeze > 0) s.freeze--;
    else if (s.economy < config.credit.freezeEconomy) { s.freeze = config.credit.freezeMonths; s.log.push(`${this.monthsPassed + 1}개월차: 경기가 크게 나빠져 은행이 ${config.credit.freezeMonths}개월간 새 대출을 중단했습니다.`); }
    this.competitorStep();
    this.rivalLifecycle();
  }

  /** 경쟁사 한 달: 추정 이익을 현금에 더하고, 현금이 되면 항공기를 늘린다(노선 신설 또는 증편). 난수 없이 점수로만 고른다 */
  private competitorStep(): void {
    const s = this.state, k = config.competitors, month = this.month;
    const B737 = typeById('B737'), eco = s.economy ?? 1, fuelMult = 1 - config.fuel.share + config.fuel.share * (s.fuel ?? 1); // 경쟁사는 불황과 연료비에 그대로 흔들린다(우리의 연료 계약은 적용되지 않는다)
    for (const c of s.competitors) {
      const maxPlanes = Math.min(k.maxPlanesCap, Math.floor(k.maxPlanesBase + k.maxPlanesPerMonth * (this.monthsPassed - (c.born ?? 0)))); // 늦게 생긴 항공사는 처음부터 다시 키운다
      let profit = 0, revenue = 0;
      for (const r of c.routes) {
        const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), base = baseFare(km), fare = base * r.fareRatio;
        const mine = s.routes.find((x) => x.open && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)));
        const myW = mine && this.planesOn(mine.id).length ? this.routeDay(mine).seats * (base / Math.max(1, mine.fare)) : 0;
        const wc = r.seatsDay / Math.max(0.3, r.fareRatio) * this.quality(c.style), share = wc / (wc + myW || 1);
        const dem = (rawMonthlyDemand(A, B, month, this.growthOf(r.a), this.growthOf(r.b)) * eco * priceFactor(fare, base) * share) / config.daysPerMonth;
        const pax = Math.min(dem, r.seatsDay * 0.9);
        revenue += (pax * fare * config.daysPerMonth) / 1e6;
        profit += (pax * fare * (1 - Math.min(1.2, (k.costRatio * fuelMult) / (c.eff ?? 1))) * config.daysPerMonth) / 1e6; // 비용 비율은 연료비가 오르면 커지고 효율이 낮으면 더 커진다(적자 가능)
      }
      // 가격 반응: 우리가 같은 노선에서 더 싸게 팔면 따라 내리고(바닥까지), 아니면 천천히 목표 가격으로 돌아간다
      const rv = config.rival, floor = c.style === 'low' ? rv.lowFloor : rv.premFloor, target = c.style === 'low' ? rv.lowTarget : rv.premTarget;
      for (const r of c.routes) {
        const mine = s.routes.find((x) => x.open && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)));
        const pf = mine && this.planesOn(mine.id).length ? mine.fare / this.routeBaseFare(mine) : null;
        if (r.war) { r.war--; if (r.war <= 0) { delete r.war; s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) ${cityById(r.a).name} ⇄ ${cityById(r.b).name} 운임 전쟁을 끝냈습니다.`); } continue; } // 전쟁 중에는 운임을 바닥에 둔다
        if (pf !== null && pf < r.fareRatio - 0.05 && c.id !== s.ally) r.fareRatio = Math.max(floor, r.fareRatio - rv.step);
        else if (r.fareRatio < target) r.fareRatio = Math.min(target, r.fareRatio + rv.upStep);
        else if (r.fareRatio > target) r.fareRatio = Math.max(target, r.fareRatio - rv.upStep);
      }
      // 운임 전쟁: 우리와 겹치는 노선 하나에서 운임을 크게 내린다(제휴사는 걸어오지 않는다)
      if (c.id !== s.ally && !c.routes.some((r) => r.war)) {
        const over = c.routes.filter((r) => s.routes.some((x) => x.open && this.planesOn(x.id).length && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a))));
        if (over.length && this.rng.next() < config.war.chance * this.mods.event * (c.major ? k.major.warMult : 1) * (this.eraNow?.war ?? 1)) {
          const r = over[this.rng.int(over.length)]; r.war = config.war.months; r.fareRatio = config.war.ratio;
          s.log.push(`${this.monthsPassed + 1}개월차: 운임 전쟁 — ${c.name}이(가) ${cityById(r.a).name} ⇄ ${cityById(r.b).name} 노선 운임을 ${config.war.months}개월간 크게 내렸습니다. 운임을 따라 내리거나, 버티거나, 제휴를 맺으세요.`);
        }
      }
      c.revHist = [...(c.revHist ?? []), revenue].slice(-12);
      c.cash += profit - k.planeFixed * c.planes;
      if (!c.major && c.planes > 0 && this.rng.next() < k.shockChance) { // 경영 충격: 사고·파업·리콜·소송으로 큰돈이 나간다(현금이 얇은 항공사는 이것 하나로 무너질 수 있다)
        const loss = Math.round(k.shockMin + this.rng.next() * (k.shockMax - k.shockMin)), why = ['대형 사고 보상금', '장기 파업', '엔진 리콜', '소송 패소'][this.rng.int(4)];
        c.cash -= loss; s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) ${why}으로 $${loss}M 손실을 입었습니다.`);
      }
      c.low = c.cash < 0 ? (c.low ?? 0) + 1 : 0;
      if (c.major) { // 대형 항공사: 시장(시간·내 항공기 수)에 맞춰 돈과 상관없이 커지고, 파산하지 않는다
        c.cash = Math.max(c.cash, 50); c.low = 0;
        const M = k.major, target = Math.min(M.cap, Math.floor(M.base + M.perMonth * this.monthsPassed + M.perPlayerPlane * s.planes.length));
        for (let i = 0; i < M.addPerMonth && c.planes < target; i++) this.compBuy(c, month, true);
      } else if (c.cash >= B737.price && c.planes < maxPlanes) this.compBuy(c, month);
    }
  }

  /** 경쟁사가 B737 한 대를 늘린다(free면 돈을 내지 않는다). 새 노선(허브에서 출발) 또는 증편. 대형 항공사는 가끔 내 노선으로 진출한다 */
  private compBuy(c: Competitor, month: number, free = false): void {
    const s = this.state, B737 = typeById('B737');
    if (!free) c.cash -= B737.price;
    c.planes++;
    const legsDay = (km: number) => (2 * Math.max(1, maxWeeklyRoundTrips(km, B737))) / 7 * 0.8 * (c.major ? config.competitors.major.seatMult : 1), style = c.style === 'low' ? 0.85 : 1.15; // 대형 항공사는 대형기를 섞어 쓴다(좌석 2배)
    if (c.major && this.rng.next() < config.competitors.major.invadeChance) { // 내 노선 중 이익이 큰 곳으로 들어온다
      const mine = s.routes.filter((r) => r.open && this.planesOn(r.id).length > 0).map((r) => { const d = this.routeDay(r); return { r, p: d.revenue - d.cost }; }).sort((x, y) => y.p - x.p || x.r.id - y.r.id);
      for (const { r } of mine) {
        if (c.routes.some((x) => (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)) || !canFly(B737, cityById(r.a), cityById(r.b)).ok) continue;
        c.routes.push({ a: r.a, b: r.b, seatsDay: B737.seats * legsDay(distanceKm(cityById(r.a), cityById(r.b))), fareRatio: style });
        s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) ${cityById(r.a).name} ⇄ ${cityById(r.b).name} 노선에 진출했습니다. 내 노선과 겹칩니다.`);
        return;
      }
    }
    // 아직 안 열린 최고 점수 노선(허브에서 출발, 항속 범위 안)
    let best: { b: string; score: number } | null = null;
    for (const d of CITIES) {
      if (d.id === c.hub || !canFly(B737, cityById(c.hub), d).ok || c.routes.some((r) => (r.a === c.hub && r.b === d.id) || (r.b === c.hub && r.a === d.id))) continue;
      const km = distanceKm(cityById(c.hub), d), sc = rawMonthlyDemand(cityById(c.hub), d, month) / (1 + km / 6000);
      if (!best || sc > best.score || (sc === best.score && d.id < best.b)) best = { b: d.id, score: sc };
    }
    const addTo = c.routes.length >= Math.ceil(c.planes / 2) ? c.routes[0] : undefined; // 노선 수가 비행기의 절반을 넘으면 증편
    if (best && !addTo) c.routes.push({ a: c.hub, b: best.b, seatsDay: B737.seats * legsDay(distanceKm(cityById(c.hub), cityById(best.b))), fareRatio: style });
    else if (c.routes.length) { const r = c.routes[(c.planes - 1) % c.routes.length]; r.seatsDay += B737.seats * legsDay(distanceKm(cityById(r.a), cityById(r.b))); }
  }

  // ---------- 시대 ----------
  /** 시대 전환: 끝나면 쉬고, 때가 되면 다음 시대를 예고(6개월 전)하고 개막한다 */
  private eraStep(): void {
    const s = this.state, k = config.eras, mp = this.monthsPassed, m = mp + 1;
    if (s.era && mp >= s.era.end) { s.log.push(`${m}개월차: ${config.eras.list.find((x) => x.id === s.era!.id)!.name}이(가) 끝났습니다.`); s.era = null; s.eraFree = mp + k.rest; }
    if (s.nextEra && mp >= s.nextEra.start) { const d = k.list.find((x) => x.id === s.nextEra!.id)!; s.era = s.nextEra; s.nextEra = null; s.log.push(`${m}개월차: ${d.name} 시작 — ${d.desc}`); this.note(m, 'era', `${d.name} 시작`); }
    if (!s.era && !s.nextEra && mp >= s.eraFree) {
      const pool = k.list.filter((e) => e.id !== s.lastEra), d = pool[this.rng.int(pool.length)], months = d.months[0] + this.rng.int(d.months[1] - d.months[0] + 1);
      s.nextEra = { id: d.id, start: mp + k.lead, end: mp + k.lead + months }; s.lastEra = d.id;
      s.log.push(`${m}개월차: 시대 변화 예고 — ${k.lead}개월 뒤 ${d.name}가 시작됩니다(약 ${months}개월). ${d.desc}`);
    }
  }

  // ---------- 계약 ----------
  private avgMonthlyProfit(): number { const h = this.state.history.slice(-6); return h.length ? Math.max(0, h.reduce((a, m) => a + m.profit, 0) / h.length) : 0; }
  /** 새 계약 제안을 만든다(보상은 최근 월 이익의 6배 이상으로 크게) */
  private contractStep(): void {
    const s = this.state, k = config.contract, mp = this.monthsPassed;
    s.contracts = s.contracts.filter((c) => c.status === 'active' || c.expires > mp);
    if (mp < s.nextOffer || mp < k.firstMonth || s.contracts.length >= k.maxTotal) return;
    s.nextOffer = mp + k.gap[0] + this.rng.int(k.gap[1] - k.gap[0] + 1);
    const avg = this.avgMonthlyProfit(), base = Math.min(k.rewardMax, Math.max(k.rewardMin, Math.round(k.rewardMonths * Math.max(3, avg))));
    const served = s.routes.filter((r) => r.open && this.planesOn(r.id).length > 0), served0 = this.servedCities().size;
    const kinds: Contract['kind'][] = ['cities', 'profit']; if (served.length) kinds.push('pax', 'otp');
    const kind = kinds[this.rng.int(kinds.length)], months = 3 + this.rng.int(4), m$ = (v: number) => `$${v}M`;
    let c: Omit<Contract, 'id' | 'reward' | 'status' | 'expires' | 'progress'>;
    if (kind === 'pax') { const r = served[this.rng.int(served.length)], d = this.routeDay(r), goal = Math.max(3000, Math.round((d.pax * config.daysPerMonth * months * 1.15) / 500) * 500); c = { kind, goal, limit: months, a: r.a, b: r.b, title: `${cityById(r.a).name} ⇄ ${cityById(r.b).name} 노선에서 ${months}개월 안에 승객 ${goal.toLocaleString('en-US')}명 수송` }; }
    else if (kind === 'otp') c = { kind, goal: months, limit: months + 2, title: `정시율 ${Math.round(k.otpTarget * 100)}% 이상을 ${months}개월 연속 유지(${months + 2}개월 안에)` };
    else if (kind === 'cities') { const n = 2 + this.rng.int(2); c = { kind, goal: n, limit: months + 3, startCities: served0, title: `${months + 3}개월 안에 새 도시 ${n}곳에 취항` }; }
    else { const goal = Math.max(8, Math.round(Math.max(3, avg) * months * 1.25)); c = { kind: 'profit', goal, limit: months, title: `${months}개월 동안 누적 이익 ${m$(goal)} 달성` }; }
    const reward = this.makeReward(base);
    s.contracts.push({ ...c, id: s.nextId++, status: 'offer', expires: mp + k.offerMonths, progress: 0, reward });
    s.log.push(`${mp + 1}개월차: 새 계약 제안 — ${c.title}. 보상: ${reward.label} (지도 탭, ${k.offerMonths}개월 안에 수락)`);
  }
  private makeReward(base: number): ContractReward {
    const s = this.state, roll = this.rng.next(), cash = (v = base): ContractReward => ({ type: 'cash', value: v, label: `현금 $${v}M` });
    if (roll < 0.45) return cash();
    if (roll < 0.7) { // 새 항공기 한 대(보상 가치 안에서 가장 비싼 출시 기종)
      const t = AIRCRAFT.filter((x) => this.isAvailable(x.id) && x.price <= base * 1.6).sort((a, b) => b.price - a.price)[0];
      return t ? { type: 'plane', value: t.price, plane: t.id, label: `새 항공기 ${t.name}(가치 $${t.price}M)` } : cash();
    }
    if (roll < 0.85) { const ups = config.upgrades.list.filter((u) => this.upgradeLevel(u.id) < config.upgrades.prices.length); if (!ups.length) return cash(); const u = ups[this.rng.int(ups.length)]; return { type: 'upgrade', value: this.upgradePrice(u.id)!, upgrade: u.id, label: `업그레이드 '${u.name}' 1단계 무료(가치 $${this.upgradePrice(u.id)}M)` }; }
    if (roll < 0.95) { const rs = Object.keys(config.rights.regions).filter((r) => s.rights && !s.rights.includes(r)); if (!rs.length) return cash(); const r = rs.sort((a, b) => this.rightsPrice(a) - this.rightsPrice(b))[0]; return { type: 'rights', value: this.rightsPrice(r), region: r, label: `${this.regionName(r)} 운수권 무료(가치 $${this.rightsPrice(r)}M)` }; }
    return { type: 'rep', value: Math.round(base * 0.5), label: `현금 $${Math.round(base * 0.5)}M + 평판 +5%` };
  }
  acceptContract(id: number): Result {
    const s = this.state, c = s.contracts.find((x) => x.id === id);
    if (s.status !== 'playing') return fail('게임이 끝났습니다');
    if (!c || c.status !== 'offer') return fail('없거나 이미 수락한 계약입니다');
    if (s.contracts.filter((x) => x.status === 'active').length >= config.contract.maxActive) return fail(`진행 중인 계약은 ${config.contract.maxActive}건까지입니다`);
    c.status = 'active'; c.start = this.monthsPassed; if (c.kind === 'cities') c.startCities = this.servedCities().size;
    return { ok: true };
  }
  declineContract(id: number): Result {
    const s = this.state, c = s.contracts.find((x) => x.id === id);
    if (!c || c.status !== 'offer') return fail('없거나 이미 수락한 계약입니다');
    s.contracts = s.contracts.filter((x) => x.id !== id); return { ok: true };
  }
  /** 월말에 진행 중인 계약의 진행도를 갱신하고, 달성하면 보상, 기한이 지나면 실패 처리 */
  private evaluateContracts(): void {
    const s = this.state, mp = this.monthsPassed, m = mp, served = this.servedCities().size;
    for (const c of [...s.contracts]) {
      if (c.status !== 'active') continue;
      if (c.kind === 'pax') { const r = s.routes.find((x) => x.open && ((x.a === c.a && x.b === c.b) || (x.a === c.b && x.b === c.a))); if (r) c.progress += r.daily.slice(-config.daysPerMonth).reduce((a, d) => a + d.pax, 0); }
      else if (c.kind === 'otp') c.progress = this.avgOtp >= config.contract.otpTarget && s.routes.some((r) => r.open && this.planesOn(r.id).length) ? c.progress + 1 : 0;
      else if (c.kind === 'cities') c.progress = Math.max(0, served - (c.startCities ?? 0));
      else c.progress += s.history.at(-1)?.profit ?? 0;
      if (c.progress >= c.goal) { this.payReward(c.reward); s.contracts = s.contracts.filter((x) => x.id !== c.id); s.contractsDone++; s.log.push(`${m}개월차: 계약 성사! — ${c.title}. 보상: ${c.reward.label}`); this.note(m, 'contract', `계약 성사: ${c.title} (보상 ${c.reward.label})`); }
      else if (mp >= (c.start ?? 0) + c.limit) { s.contracts = s.contracts.filter((x) => x.id !== c.id); s.reputation = Math.max(0, s.reputation - config.contract.repLoss); s.log.push(`${m}개월차: 계약 실패 — ${c.title} (평판 −${Math.round(config.contract.repLoss * 100)}%)`); }
    }
  }
  private payReward(r: ContractReward): void {
    const s = this.state;
    if (r.type === 'cash' || r.type === 'rep') s.cash += r.value;
    if (r.type === 'rep') s.reputation = Math.min(1, s.reputation + 0.05);
    if (r.type === 'plane') this.addPlane(r.plane!, typeById(r.plane!).price * config.contract.planeBook); // 보상 기체의 장부가(대출 담보) 비율
    if (r.type === 'upgrade') s.upgrades = { ...s.upgrades, [r.upgrade!]: this.upgradeLevel(r.upgrade!) + 1 };
    if (r.type === 'rights' && s.rights && !s.rights.includes(r.region!)) s.rights = [...s.rights, r.region!];
  }

  /** 경쟁사의 파산과 신생: 현금이 마이너스인 채 석 달이 지나면 파산(노선·항공기가 시장에서 사라진다), 빈자리가 있으면 가끔 신생 항공사가 거점을 정해 등장한다 */
  private rivalLifecycle(): void {
    const s = this.state, k = config.competitors, m = this.monthsPassed + 1;
    for (const c of [...s.competitors]) {
      if (c.major || (c.low ?? 0) < k.bankruptMonths) continue;
      s.competitors = s.competitors.filter((x) => x.id !== c.id);
      s.rivalsGone = [...s.rivalsGone, { name: c.name, month: m }].slice(-12);
      if (s.ally === c.id) s.ally = null;
      const lots = Math.min(config.auction.maxLots, c.planes);
      for (let i = 0; i < lots; i++) s.auctions.push({ id: s.nextId++, from: c.name, type: 'B737', price: Math.round(typeById('B737').price * config.auction.price * 10) / 10, age: config.auction.age, cond: config.auction.cond, expires: this.monthsPassed + config.auction.months });
      this.note(m, 'rival', `${c.name} 파산`);
      s.log.push(`${m}개월차: ${c.name}이(가) 파산했습니다. 노선 ${c.routes.length}개가 사라졌고${lots ? `, 항공기 ${lots}대가 ${config.auction.months}개월간 경매에 나왔습니다(지도 탭).` : '.'}`);
    }
    if (!s.competitors.some((c) => c.major) && m > k.major.startMonth) { // 대형 항공사 출범
      const used = new Set(s.competitors.map((c) => c.hub)), hub = k.major.hubs.find((h) => h !== s.base && !used.has(h)) ?? k.major.hubs[0];
      s.competitors.push({ id: s.nextRival++, name: k.major.name, style: 'premium', hub, cash: 200, planes: 0, routes: [], born: this.monthsPassed, eff: k.major.eff, low: 0, major: true });
      this.note(m, 'major', `대형 항공사 ${k.major.name} 출범(${cityById(hub).name} 거점)`);
      s.log.push(`${m}개월차: 대형 항공사 ${k.major.name}이(가) ${cityById(hub).name}을(를) 거점으로 시장에 진출했습니다. 시장이 커질수록 함께 커지고, 내 노선에도 들어옵니다.`);
    }
    const regular = s.competitors.filter((c) => !c.major).length;
    if (m < k.entryMinMonth || regular >= k.max) return;
    const eco = s.economy ?? 1, open = k.max - regular;
    const chance = k.entryChance * (this.eraNow?.entry ?? 1) * this.mods.rival * (eco >= 1 ? 1.2 : 0.5) * (1 + 0.2 * (open - 1)); // 호황이면 더 잘 생기고, 빈자리가 많을수록 더 잘 생긴다
    if (this.rng.next() >= chance) return;
    const used = new Set([...s.competitors.map((c) => c.name), ...s.rivalsGone.filter((g) => m - g.month < 36).map((g) => g.name)]), hubs = new Set(s.competitors.map((c) => c.hub));
    const pool = COMP_NAMES.filter(([name, , hub]) => !used.has(name) && !hubs.has(hub));
    if (!pool.length) return;
    const w = pool.map(([, , hub]) => Math.sqrt(marketSize(cityById(hub)))), pick = (() => { let x = this.rng.next() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x <= 0) return pool[i]; } return pool[pool.length - 1]; })();
    const eff = 1 + (this.rng.next() * 2 - 1) * k.effSpread;
    s.competitors.push({ id: s.nextRival++, name: pick[0], style: pick[1], hub: pick[2], cash: Math.round(k.startCash * this.mods.rival * k.entryCash), planes: 0, routes: [], born: this.monthsPassed, eff, low: 0 });
    this.note(m, 'rival', `신생 항공사 ${pick[0]} 출범(${cityById(pick[2]).name} 거점)`);
    s.log.push(`${m}개월차: 신생 항공사 ${pick[0]}이(가) ${cityById(pick[2]).name}을(를) 거점으로 취항을 시작했습니다(${pick[1] === 'low' ? '저가형' : '프리미엄형'}).`);
  }

  private endMonth(): void {
    const s = this.state, c = config, rules = c.rules;
    const interest = s.loan * this.loanRate; // 이율은 감가상각 전(월초 기준) 한도로 정한다
    // 감가상각(장부 가치만 줄고 현금은 그대로), 고정비(현금)
    let dep = 0;
    for (const p of s.planes) { if (p.leased) continue; const d = Math.min(p.book, typeById(p.type).price / c.cost.depreciationMonths); dep += d; p.book -= d; } // 임대기는 내 자산이 아니라 감가상각이 없다
    for (const p of s.planes) p.age++;
    const mt = config.maint; // 정비 상태: 많이 날수록 빨리 닳고, 낮으면 고장 나서 한 달 못 난다
    for (const p of [...s.planes].sort((a, b) => a.id - b.id)) {
      p.cond = Math.max(0, p.cond - (mt.decayBase + (p.routeId !== null ? mt.decayPerWeekly * p.weekly : 0)) * (1 - this.up('hangar')) * (1 - this.mroFactor(p)));
      if (s.autoMaint && p.cond < mt.autoBelow && p.shop <= 0 && p.routeId !== null && s.cash >= this.serviceCost(p)) { // 자동 정비: 고장 나기 전에 점검(현금이 모자라면 건너뛴다)
        const r = this.service(p.id); if (r.ok) s.log.push(`${this.monthsPassed + 1}개월차: ${typeById(p.type).name} 자동 정비 (${r.cost.toFixed(1)}M)`);
      }
      if (p.cond < mt.lowCond && p.shop <= 0 && p.routeId !== null && this.rng.next() < mt.failChance * (1 + (mt.lowCond - p.cond) * 2)) { p.shop = mt.failDays; s.log.push(`${this.monthsPassed + 1}개월차: ${typeById(p.type).name} 고장 — 정비 상태가 나빠 ${mt.failDays}일간 운항하지 못합니다.`); }
    }
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
    this.evaluateContracts();
    this.noteMonthEnd();
    // 평판: 탑승률이 적정(70~90%)이면 오르고 낮으면 내린다
    if (s.cur.seats > 0) {
      const lfTarget = Math.min(1, Math.max(0, (lf - 0.5) / 0.4)), w = c.delay.repWeight;
      const target = (1 - w) * lfTarget + w * this.avgOtp; // 탑승률(좌석 채움)과 정시율이 평판을 정한다
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
    if (s.lowCashMonths >= rules.bankruptMonths) { s.status = 'bankrupt'; s.log.push('파산했습니다.'); }
    else if (s.sandbox) { /* 자유 모드: 목표·기한 없음 */ }
    else if (this.goalsMet()) { s.status = 'won'; s.log.push('목표를 달성했습니다!'); }
    else if (this.monthsPassed >= this.scenario.timeLimit) { s.status = 'timeup'; s.log.push('제한 기간이 끝났습니다.'); }
  }

  get scenario() { return scenarioById(this.state.scenario ?? 'free'); }
  /** 우리가 취항 중인 도시 */
  servedCities(): Set<string> {
    const served = new Set<string>();
    for (const r of this.state.routes) if (r.open && this.planesOn(r.id).length) { served.add(r.a); served.add(r.b); }
    return served;
  }
  /** 시나리오 목표별 진행(화면용). value는 지금 값, target은 목표 값 */
  goalProgress(): GoalProgress[] {
    const s = this.state, served = this.servedCities(), last = s.history.at(-1);
    return this.scenario.goals.map((g): GoalProgress => {
      if (g.type === 'profit') return { label: '누적 이익', value: s.cumProfit, target: g.value, done: s.cumProfit >= g.value, unit: 'M' };
      if (g.type === 'cities') { const n = served.size; return { label: '운항 중인 도시', value: n, target: Math.min(g.value, CITIES.length), done: n >= Math.min(g.value, CITIES.length), unit: '곳' }; }
      if (g.type === 'region') { const n = g.cities.filter((c) => served.has(c)).length; return { label: g.label ?? '지정 도시', value: n, target: g.value, done: n >= g.value, unit: '곳' }; }
      if (g.type === 'cargo') { const n = last?.cargo ?? 0; return { label: '지난달 화물 수익', value: n, target: g.value, done: n >= g.value, unit: 'M' }; }
      if (g.type === 'pax') { const n = last?.pax ?? 0; return { label: '지난달 탑승객', value: n, target: g.value, done: n >= g.value, unit: '명' }; }
      const done = this.monthsPassed >= g.months && s.cumProfit >= g.minProfit;
      return { label: `${g.months}개월 생존 + 누적 이익`, value: s.cumProfit, target: g.minProfit, done, unit: 'M' };
    });
  }
  private goalsMet(): boolean {
    const gp = this.goalProgress(), sc = this.scenario;
    // 생존 목표는 기한(개월)이 지나야 달성된다
    return sc.mode === 'all' ? gp.every((g) => g.done) : gp.some((g) => g.done);
  }
  /** 점수: 이익·현금·도시 수·승리·생존 개월 − 대출·파산, 난이도 배수 */
  get score(): number {
    const s = this.state, k = config.score, m = this.mods.score;
    const base = Math.max(0, s.cumProfit) * k.profit + Math.max(0, s.cash) * k.cash + this.servedCities().size * k.city + (s.status === 'won' ? k.win : 0) + this.monthsPassed * k.month - (s.status === 'bankrupt' ? k.bankrupt : 0) - s.loan * k.loan;
    return Math.max(0, Math.round(base * m));
  }

  /** 연료 단계 이름(화면용) */
  get fuelLabel(): string { const f = this.state.fuel; return f > 1.15 ? '비쌈' : f < 0.87 ? '저렴' : '보통'; }

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
    if (st.formatVersion < 8) st.ally = st.ally ?? null; // 형식 7 → 8
    if (st.formatVersion < 13) { st.chronicle = []; st.hubs = {}; } // 형식 12 → 13
    if (st.formatVersion < 12) { st.era = null; st.nextEra = null; st.eraFree = Math.max(config.eras.firstFree, Math.floor(st.day / config.daysPerMonth) + config.eras.rest); st.contracts = []; st.contractsDone = 0; st.nextOffer = Math.floor(st.day / config.daysPerMonth) + 2; } // 형식 11 → 12
    if (st.formatVersion < 11) { st.auctions = []; st.upcoming = []; } // 형식 10 → 11
    if (st.formatVersion < 10) { st.nextRival = Math.max(0, ...st.competitors.map((c) => c.id)) + 1; st.rivalsGone = []; } // 형식 9 → 10: 경쟁사는 있는 그대로 두고, 이후 파산·신생이 일어난다
    if (st.formatVersion < 7) for (const r of st.routes) r.priority = r.priority ?? 1; // 형식 6 → 7
    if (st.formatVersion < 6) { st.fuel = st.fuel ?? 1; st.hedge = st.hedge ?? null; st.freeze = st.freeze ?? 0; for (const p of st.planes) { p.cond = p.cond ?? 1; p.shop = p.shop ?? 0; } } // 형식 5 → 6
    if (st.formatVersion < 5) { st.base = st.base ?? 'ICN'; st.difficulty = st.difficulty ?? 'normal'; st.scenario = st.scenario ?? 'free'; } // 형식 4 → 5
    st.formatVersion = FORMAT_VERSION;
    const g = new Game(st.seed ?? 1, st); if (d.formatVersion < 13) g.seedChronicle();
    return g;
  }
}


