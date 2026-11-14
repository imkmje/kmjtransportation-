import { config } from '../config';
import { AIRCRAFT, EVENTS, CITIES, OWN_TYPES, applyOwnNames, typeById, cityById, scenarioById } from '../data';
import { Rng } from './rng';
import { marketSize, baseFare, baseSlots, bizDemandShare, blockHours, canFly, cargoRate, distanceKm, maxWeeklyRoundTrips, priceFactor, rawCargoDemand, rawMonthlyDemand } from './model';
import { ACHIEVEMENTS, LADDERS } from './achievements';
import type { Charter, ChronEntry, Competitor, Season, Threat, Contract, ContractReward, DayStat, Difficulty, EventDef, GameState, GoalProgress, MonthReport, Plane, Route } from './types';

type Trait = { name: string; desc: string; war?: number; buy?: number; planes?: number; q?: number; shock?: number };
type StoryChoice = { label: string; cash?: number; rep?: number; slot?: boolean; baseTaken?: number; duel?: boolean; subSell?: boolean; next?: { id: string; months: number }; result: string; risk?: { chance: number; cash?: number; rep?: number; subCash?: number; text: string } };
export type StoryDef = { id: string; title: string; desc: string; needSub?: boolean; chain?: boolean; choices: StoryChoice[] };
const TRAIT_IDS = ['aggro', 'expander', 'quality', 'steady'];
export const FORMAT_VERSION = 13; // 12 → 13: 연대기·허브 투자 / 11 → 12: 대형 항공사·시대·계약 / 10 → 11: 경매·예고된 행사 / 9 → 10: 경쟁사가 생기고 파산한다(경쟁사 ID 카운터·파산 기록) / 8 → 9: 경쟁사 수 증가 / 7 → 8: 임대기·제휴 / // 1 → 2: 대출·샌드박스·항공기 나이·사건 대응 / 2 → 3: 슬롯·허브·일일 기록·비즈니스석·화물·경쟁사·도시 성장 / 3 → 4: 경기 지수 / 4 → 5: 시작 도시·난이도·시나리오 / 5 → 6: 연료·정비·대출 중단 / 6 → 7: 노선 우선순위
export interface GameOptions { base?: string; difficulty?: Difficulty; scenario?: string; sandbox?: boolean; rights?: boolean; challenges?: string[] } // rights: 자유 모드에서 지역 운수권 제한을 켠다 // sandbox: 목표·기한 없는 자유 모드로 시작(시작 자금·기체는 '자유 경영' 시나리오와 같다)
export interface RouteOption { shareBefore: number; shareAfter: number; type: string; weekly: number; price: number; profit: number; payback: number | null; slotCost: number; slotNeeds: { city: string; n: number }[]; recommended: boolean } // profit: 이 기종 한 대를 더 넣었을 때 늘어나는 월 이익(고정비·슬롯 임대료 반영), payback: 새 기체 값 ÷ profit(개월)
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
/** 자유 모드에서만 더 쓰는 신생 항공사 후보(경쟁사가 최대 12곳까지 생길 수 있어서) */
const COMP_NAMES_MORE: [string, 'low' | 'premium', string][] = [['제주 하늘항공', 'low', 'CJU'], ['동방 에어', 'premium', 'PVG'], ['빅토리아 항공', 'premium', 'HKG'], ['시암 스카이', 'low', 'BKK'], ['오사카 블루', 'low', 'KIX'], ['포모사 항공', 'premium', 'TPE'], ['필리피나 에어', 'low', 'MNL'], ['메콩 항공', 'low', 'SGN'], ['적도 항공', 'low', 'CGK'], ['보스포루스 항공', 'premium', 'IST'], ['퍼시픽 코스트 항공', 'low', 'LAX'], ['레이크쇼어 항공', 'low', 'ORD'], ['메이플 에어', 'premium', 'YYZ'], ['아즈텍 항공', 'low', 'MEX'], ['사바나 항공', 'low', 'NBO']];
export const COMP_NAMES: [string, 'low' | 'premium', string][] = [['한바다항공', 'low', 'PUS'], ['그랜드 에어', 'premium', 'NRT'], ['유로윙즈', 'low', 'LHR'], ['아메리고 항공', 'premium', 'JFK'], ['사막의 별 항공', 'premium', 'DXB'], ['남십자성 항공', 'low', 'SYD'], ['실크로드 항공', 'premium', 'PEK'], ['블루 라군 에어', 'low', 'SIN'], ['하이랜드 항공', 'premium', 'DEL'], ['새벽 에어', 'low', 'ICN'], ['대서양 익스프레스', 'low', 'CDG'], ['안데스 항공', 'premium', 'GRU']];

export class Game {
  state: GameState;
  private rng: Rng;

  constructor(seed = 1, state?: GameState, opts: GameOptions = {}) {
    if (state) { this.state = state; this.rng = new Rng(state.seed); this.rng.setState(state.rng); applyOwnNames(state.ownNames); return; }
    applyOwnNames();
    this.rng = new Rng(seed);
    const sc = scenarioById(opts.sandbox ? 'free' : opts.scenario ?? 'free'), diff = opts.difficulty ?? 'normal', dm = config.difficulty[diff];
    const base = sc.lockBase && sc.base ? sc.base : (opts.base && CITIES.some((c) => c.id === opts.base) ? opts.base : (sc.base ?? 'ICN'));
    this.state = {
      formatVersion: FORMAT_VERSION, seed, rng: this.rng.getState(), day: 0,
      cash: Math.round(sc.cash * dm.cash * 10) / 10, reputation: config.start.reputation, nextId: 1,
      planes: [], routes: [], events: sc.events.map((e) => ({ ...e })), cumProfit: 0, loan: sc.loan, slots: {}, growth: {}, competitors: Game.initCompetitors(dm.rival), economy: sc.economy, fuel: 1, hedge: null, ally: null, nextRival: config.competitors.start + 1, rivalsGone: [], auctions: [], upcoming: [], chronicle: [], hubs: {}, era: null, nextEra: null, eraFree: config.eras.firstFree, contracts: [], contractsDone: 0, nextOffer: config.contract.firstMonth, rights: opts.sandbox && opts.rights ? [cityById(base).region] : undefined, freeze: 0, sandbox: !!opts.sandbox, history: [],
      base, difficulty: diff, scenario: sc.id,
      cur: { revenue: 0, cost: 0, pax: 0, seats: 0 }, status: 'playing', lowCashMonths: 0, log: [], alertsAt: [],
    };
    const ch = opts.sandbox ? (opts.challenges ?? []).filter((x) => config.extra.challenges[x]) : [];
    if (ch.length) { // 도전 조건(자유 모드)
      const s = this.state; s.challenges = ch;
      if (ch.includes('debt')) s.loan += 100;
      if (ch.includes('lowrep')) s.reputation = 0.05;
      if (ch.includes('small')) s.cash = Math.round(s.cash * 5) / 10;
      if (ch.includes('crowded')) { s.competitors = Game.initCompetitors(dm.rival, 6); s.nextRival = 7; }
    }
    const startPlane = ch.includes('small') ? [...AIRCRAFT].filter((t) => t.seats > 0 && !t.from).sort((a, b) => a.seats - b.seats)[0].id : sc.plane;
    this.addPlane(startPlane, typeById(startPlane).price); // 시작 항공기는 무료로 받지만 장부가·감가상각은 같다
  }

  static initCompetitors(rival = 1, n = config.competitors.start): Competitor[] {
    return COMP_NAMES.slice(0, n).map(([name, style, hub], i) => ({ id: i + 1, name, style, hub, cash: Math.round(config.competitors.startCash * rival), planes: 0, routes: [] }));
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
    return (config.cost.fixedMonthly + config.cost.perPlaneMonthly * this.state.planes.length + config.slot.lease * slots + prio + this.leaseMonthly + this.hubUpkeep + (this.state.ally != null ? config.ally.fee : 0) + (this.state.alliance?.length ?? 0) * config.extra.alliance.monthly + this.loyaltyCost) * this.mods.fixed;
  }
  /** 임대기 월 임대료 합계 */
  get leaseMonthly(): number { return this.state.planes.reduce((a, p) => a + (p.leased ? p.rent ?? typeById(p.type).price * config.lease.rate : 0), 0); }
  /** 환승 수요(월, 일반석 환산): 이 노선의 한쪽 끝을 허브 삼아 우리 다른 노선으로 갈아타는 손님. 우리 직항이 없고 너무 돌아가지 않는 도시 쌍만 센다 */
  /** via를 주면 그 도시를 거치는 환승만 센다(허브 도시 화면용) */
  transferDemand(r: Route, via?: string, flows?: Map<string, number>): number {
    if (!this.planesOn(r.id).length) return 0;
    const t = config.transfer, served = this.state.routes.filter((x) => x.open && x.id !== r.id && this.planesOn(x.id).length > 0);
    const dpm = config.daysPerMonth, subs = this.state.sandbox ? this.state.competitors.filter((c) => (c.stake ?? 0) >= 0.51).flatMap((c) => c.routes.map((y) => ({ a: y.a, b: y.b, cap: y.seatsDay * dpm, f: config.subsidiary.codeshare }))) : [];
    const allied = this.state.sandbox ? this.state.competitors.filter((c) => this.state.alliance?.includes(c.id)).flatMap((c) => c.routes.map((y) => ({ a: y.a, b: y.b, cap: y.seatsDay * dpm, f: this.alliCodeshare }))) : [];
    const links = [...served.map((x) => ({ a: x.a, b: x.b, cap: this.monthlySeats(x.id), f: 1 })), ...subs, ...allied]; // 자회사 노선도 갈아탈 수 있다(공동 운항)
    let sum = 0;
    for (const [h, o] of [[r.a, r.b], [r.b, r.a]]) for (const x of links) {
      if (via && h !== via) continue;
      const far = x.a === h ? x.b : x.b === h ? x.a : null;
      if (!far || far === o || served.some((y) => (y.a === o && y.b === far) || (y.a === far && y.b === o))) continue;
      const O = cityById(o), H = cityById(h), X = cityById(far);
      if ((distanceKm(O, H) + distanceKm(H, X)) / Math.max(1, distanceKm(O, X)) > t.maxDetour) continue;
      const v = Math.min(rawMonthlyDemand(O, X, this.month, this.growthOf(o), this.growthOf(far)) * t.share * x.f, x.cap * t.seatCap); // 이어지는 노선에 자리가 있어야 갈아탈 수 있다
      sum += v; if (flows) { const key = [o, far].sort().join('|'); flows.set(key, Math.max(flows.get(key) ?? 0, v)); }
    }
    return sum;
  }
  /** 허브 h를 거쳐 갈아타는 손님(월): 출발·도착 짝별, 많은 순 */
  transferFlows(h: string): { a: string; b: string; n: number }[] {
    const m = new Map<string, number>();
    for (const r of this.state.routes) if (r.open && (r.a === h || r.b === h)) this.transferDemand(r, h, m);
    return [...m].map(([k, n]) => { const [a, b] = k.split('|'); return { a, b, n }; }).filter((x) => x.n > 0).sort((x, y) => y.n - x.n || (x.a + x.b < y.a + y.b ? -1 : 1));
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
    if (e?.oldCost && p.age > config.aging.capStart) m *= 1 + e.oldCost * (1 - config.extra.green.carbon * (this.state.green ?? 0)); // 탄소세 시대: 낡은 기체는 더 든다
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
  slotCapacity(cityId: string): number { return this.slotCapacityRaw(cityId) - (this.state.taken?.[cityId] ?? 0); }
  /** 경쟁사 선점분을 빼기 전의 슬롯 한도 */
  slotCapacityRaw(cityId: string): number { const s = this.state; return baseSlots(cityById(cityId)) + (s.newAirport?.[cityId] ?? 0) + (s.concessions?.[cityId]?.holder === 0 && s.concessions[cityId].until > this.monthsPassed ? config.extra.bid.concessionSlots : 0) + (s.megaCity?.[cityId] ?? 0) + (s.slots[cityId] ?? 0) + this.hubLevel(cityId, 'terminal') * config.invest.terminal.slots + (cityId === s.base && s.alli?.proj?.terminal === -1 ? config.extra.alliance.projects.terminal.slots ?? 0 : 0) + (s.myAirports?.filter((x) => x === cityId).length ?? 0) * config.extra.airport.slots; }
  // ---- 허브 투자 ----
  hubLevel(cityId: string, kind: 'terminal' | 'mro' | 'lounge'): number { return this.state.hubs?.[cityId]?.[kind] ?? 0; }
  hubPrice(cityId: string, kind: 'terminal' | 'mro' | 'lounge'): number | null { return config.invest[kind].prices[this.hubLevel(cityId, kind)] ?? null; }
  /** 허브 투자의 월 운영비 합계 */
  get hubUpkeep(): number { return Object.values(this.state.hubs ?? {}).reduce((a, h) => a + (h.terminal ?? 0) + (h.mro ?? 0) + (h.lounge ?? 0), 0) * config.investUpkeep; }
  /** 허브 투자 일괄: 'one' = 세 가지를 한 단계씩, 'max' = 모두 최고 단계까지. 살 순서와 합계 */
  hubBulkPlan(cityId: string, mode: 'one' | 'max'): { list: { kind: 'terminal' | 'mro' | 'lounge'; price: number }[]; total: number } {
    const kinds = ['terminal', 'mro', 'lounge'] as const, list: { kind: 'terminal' | 'mro' | 'lounge'; price: number }[] = [];
    for (const kind of kinds) { const lv = this.hubLevel(cityId, kind), prices = config.invest[kind].prices; for (let i = lv; i < (mode === 'one' ? Math.min(lv + 1, prices.length) : prices.length); i++) list.push({ kind, price: prices[i] }); }
    return { list, total: list.reduce((a, x) => a + x.price, 0) };
  }
  buyHubBulk(cityId: string, mode: 'one' | 'max'): Result<{ count: number; total: number }> {
    const plan = this.hubBulkPlan(cityId, mode);
    if (!plan.list.length) return fail('이미 모두 최고 단계입니다');
    if (this.state.cash < plan.total) return fail(`현금이 모자랍니다 (필요 $${plan.total}M, 지금 $${this.state.cash.toFixed(1)}M)`);
    for (const x of plan.list) { const r = this.buyHub(cityId, x.kind); if (!r.ok) return fail(r.error); }
    return { ok: true, count: plan.list.length, total: plan.total };
  }
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
  private quality(c: Competitor): number { return (c.style === 'premium' ? 1.25 : 0.9) * (this.traitOf(c)?.q ?? 1) * (this.state.rivalAlliance?.includes(c.id) ? config.extra.alliance.rivalQ : 1); }
  /** 자유 모드에서만 경쟁사에게 성격이 있다 */
  traitOf(c: Competitor): Trait | null { return this.state.sandbox && c.trait ? (config.rivalry.traits as Record<string, Trait>)[c.trait] ?? null : null; }

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
      if (def.effect.cityCap && e.city && (r.a === e.city || r.b === e.city)) pen += d.snow * k;
      if (def.id === 'strike') pen += d.strike * k;
    }
    return Math.min(1, Math.max(d.min, 1 - pen * (1 - this.up('ground')) + (this.state.megaDone?.includes('academy') ? 0.03 : 0)));
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
    let d0 = (rawMonthlyDemand(A, B, this.month, this.growthOf(r.a), this.growthOf(r.b)) * hub + transfer) * (1 + c.demand.repBoost * s.reputation) * this.extraDemand(r);
    let cg0 = rawCargoDemand(A, B, this.growthOf(r.a), this.growthOf(r.b)) * hub * (1 + c.demand.repBoost * s.reputation);
    const eco = s.economy ?? 1;
    const fuelPrice = s.hedge ? s.hedge.price : (s.fuel ?? 1), fuelMult = 1 - c.fuel.share + c.fuel.share * fuelPrice; // 계약 중이면 계약 가격
    d0 *= eco; cg0 *= Math.pow(eco, c.economy.cargoPow);
    let capMult = 1, costMult = (1 - this.up('ops')) * (1 - c.extra.green.ops * (s.green ?? 0)); // 친환경 연료: 운영비 절감
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
    const sb = Math.min(0.6, bizDemandShare(A, B) * (1 + this.eliteBiz + this.cabinOf(r) * c.extra.cabin.biz));
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
      const wp = Math.max(1, seatsE + seatsB) * (base / Math.max(1, r.fare)) * (1 + c.demand.repBoost * s.reputation) * ((r.ad ?? 0) > 0 ? c.rivalry.ad.boost : 1) * c.strategy.svcWeight[r.svc ?? 0];
      let wc = 0;
      for (const { comp, route } of comps) wc += route.seatsDay * (1 / Math.max(0.3, route.fareRatio)) * this.quality(comp) * this.allyWeight(comp);
      share = Math.min(1, Math.max(0.1, wp / (wp + wc)));
    }
    const demE = (d0 * (1 - sb) * priceFactor(r.fare, base) * share) / c.daysPerMonth;
    const demB = (d0 * sb * Math.pow(eco, c.economy.bizPow - 1) * priceFactor(r.fareBiz, baseBiz, c.cabin.bizElasticity) * share * (1 + this.up('service')) * (1 + ((this.hubLevel(r.a, 'lounge') + this.hubLevel(r.b, 'lounge')) / 2) * config.invest.lounge.biz)) / c.daysPerMonth; // 비즈니스는 경기에 더 민감(d0에 이미 한 번 곱함)
    const paxB = Math.min(demB, seatsB), paxE = Math.min(demE, seatsE), pax = paxE + paxB;
    const cgDem = (cg0 * priceFactor(r.cargoRatio, 1, c.cargo.elasticity) * share) / c.daysPerMonth, cargoT = Math.min(cgDem, cargoCap);
    const cargoRevenue = (cargoT * cargoRate(km) * r.cargoRatio) / 1e6;
    const prem = this.premium(r), revenue = ((paxE * r.fare + paxB * r.fareBiz) / 1e6) * prem + cargoRevenue; // prem: 광고·객실 개조로 붙는 운임 프리미엄
    const compensation = revenue * (1 - otp) * c.delay.compensation; // 지연 보상금
    const svcDaily = (this.planesOn(r.id).length * c.strategy.svcCost[r.svc ?? 0]) / c.daysPerMonth; // 노선 서비스 등급 비용(항공기 1대당 월 비용)
    const lfee = this.landingFactor(r), cost = (hours + (legs * c.cost.landingFeeK * lfee) / 1000 + (pax * c.cost.perPaxFee) / 1e6) * costMult + compensation + svcDaily;
    const revenuePax = ((paxE * r.fare + paxB * r.fareBiz) / 1e6) * prem, costOps = hours * costMult + svcDaily, costLanding = ((legs * c.cost.landingFeeK * lfee) / 1000) * costMult, costPax = ((pax * c.cost.perPaxFee) / 1e6) * costMult;
    return { revenuePax, costOps, costLanding, costPax, demand: demE + demB, seats: seatsE + seatsB, pax, revenue, cost, legs, paxE, paxB, seatsE, seatsB, demandE: demE, demandB: demB, cargoT, cargoCap, cargoDemand: cgDem, cargoRevenue, share, transfer, otp, compensation };
  }

  // ---------- 행동 ----------
  private addPlane(type: string, price: number, extra: Partial<Plane> = {}): Plane {
    const p: Plane = { id: this.state.nextId++, type, book: price, routeId: null, weekly: 0, age: 0, bizShare: 0, cond: 1, shop: 0, ...extra };
    this.state.planes.push(p);
    if (!(this.state.typesFlown ?? []).includes(type)) { this.state.typesFlown = [...(this.state.typesFlown ?? []), type]; if (this.state.typesFlown.length === AIRCRAFT.length) this.note(this.monthsPassed + 1, 'record', '기종 도감 완성'); }
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
    const p = (config.rights.price.find(([lim]) => d < lim) ?? config.rights.price[config.rights.price.length - 1])[1];
    const sale = this.state.rightsSale; return sale && sale.region === region && sale.until > this.monthsPassed ? Math.round(p * config.extra.policy.saleCut) : p; // 정부 운수권 할인
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
  isAvailable(typeId: string): boolean { const t = typeById(typeId); if (t.own) return !!this.state.ownTypes?.includes(typeId) || this.state.planes.some((p) => p.type === typeId); return this.monthsPassed >= (t.from ?? 0) || this.state.planes.some((p) => p.type === typeId); }
  /** 살 수 있는 기종(자체 개발 기종 포함) */
  shopTypes() { return [...AIRCRAFT, ...OWN_TYPES.filter((t) => this.state.ownTypes?.includes(t.id))].filter((t) => this.isAvailable(t.id)); }
  /** 아직 출시 전인 기종(곧 나오는 순서) */
  upcomingTypes() { return AIRCRAFT.filter((t) => !this.isAvailable(t.id)).sort((a, b) => (a.from ?? 0) - (b.from ?? 0)); }
  private notReleased(typeId: string) { return fail(`아직 출시되지 않은 기종입니다 (${typeById(typeId).from}개월차 출시)`); }
  /** 항공기를 산다. used면 중고기: 싸지만 낡아서 운영비가 더 들고 정비 상태가 낮다 */
  buyPlane(typeId: string, used = false): Result<{ planeId: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (!this.isAvailable(typeId)) return this.notReleased(typeId);
    const t = typeById(typeId), u = config.used, price = Math.round((used ? t.price * u.price : t.price) * (this.agendaOn('buy') ? 0.95 : 1) * 10) / 10;
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
  slbPrice(p: Plane): number { return Math.round(p.book * config.slb.ratio * 10) / 10; }
  /** 세일 앤 리스백: 내 항공기를 팔고 그대로 빌려 쓴다(운항은 그대로, 현금을 당장 확보하는 대신 매달 임대료) */
  saleLeaseback(planeId: number): Result<{ price: number; rent: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const p = this.plane(planeId);
    if (!p) return fail('없는 항공기입니다');
    if (p.leased) return fail('이미 임대 중인 항공기입니다');
    if (p.charter !== undefined) return fail('전세 운항 중인 항공기입니다');
    const price = this.slbPrice(p); if (price < 1) return fail('장부가가 너무 낮아 팔 수 없습니다');
    const rent = Math.round(price * config.slb.rent * 100) / 100;
    this.state.cash += price; p.leased = true; p.deposit = 0; p.rent = rent; p.slb = price; p.book = 0;
    this.state.log.push(`${this.monthsPassed + 1}개월차: ${typeById(p.type).name}을(를) $${price}M에 팔고 월 $${rent}M에 다시 빌렸습니다(세일 앤 리스백).`);
    return { ok: true, price, rent };
  }
  /** 중요한 알림: 기록하고 순번을 남긴다(화면은 이것만 띠·소리·자동 정지로 알린다) */
  private alert(text: string): void { const s = this.state; s.alertsAt = [...(s.alertsAt ?? []), s.log.length]; s.log.push(text); }
  /** i번째 알림이 중요한지(이 기록이 없는 옛 저장은 null — 화면이 낱말로 판단) */
  isAlert(i: number): boolean | null { const a = this.state.alertsAt; return a ? a.includes(i) : null; }
  /** 최근 3개월 평균이 적자면, 이대로 갈 때 현금이 파산선 아래로 내려가기까지 남은 개월 수(흑자거나 기록이 모자라면 null) */
  runway(): number | null {
    const h = this.state.history.slice(-3); if (h.length < 2) return null;
    const avg = h.reduce((a, x) => a + x.profit, 0) / h.length; if (avg >= 0) return null;
    return Math.max(0, Math.floor((this.state.cash - config.rules.bankruptCash) / -avg));
  }
  get leasedCount(): number { return this.state.planes.filter((p) => p.leased).length; }
  /** 임대 가능한 최대 대수 = 내 항공기(임대 아닌 것) 수 + 2 */
  get leaseCap(): number { return this.state.planes.filter((p) => !p.leased).length + config.lease.extra; }
  /** 임대기 반납 위약금: 최소 임대 기간(12개월)이 안 찼으면 남은 개월 임대료, 최소 1개월치 */
  leaseReturnFee(p: Plane): number { return (p.rent ?? typeById(p.type).price * config.lease.rate) * Math.max(1, config.lease.minMonths - p.age); }
  /** 임대기 매입가: 새 기체 값 × (1 − 0.5% × 사용 개월), 최소 50% */
  leaseBuyoutPrice(p: Plane): number { return Math.round(Math.max(typeById(p.type).price * Math.max(config.lease.buyoutMin, 1 - config.lease.buyoutDrop * p.age), (p.slb ?? 0) * config.slb.buyback) * 10) / 10; } // 세일 앤 리스백한 기체는 판 값보다 싸게 되살 수 없다
  /** 임대기를 사서 내 항공기로 만든다(보증금은 돌려받아 매입가에서 뺀다). 이후 감가상각·담보·매각이 내 항공기와 같다 */
  buyOutLease(planeId: number): Result<{ price: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    const p = this.plane(planeId);
    if (!p || !p.leased) return fail('임대 중인 항공기가 아닙니다');
    const price = this.leaseBuyoutPrice(p), net = price - (p.deposit ?? 0);
    if (this.state.cash < net) return fail('현금이 모자랍니다');
    this.state.cash -= net; p.leased = false; p.book = price; p.deposit = 0; p.rent = undefined; p.slb = undefined;
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
    if (this.state.planes[i].charter !== undefined) return fail('전세 운항 중인 항공기는 전세가 끝난 뒤 팔 수 있습니다');
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
    if (r.stance === 'share') { // 점유율 우선: 경쟁사 최저가보다 5% 싸게(자리가 안 차도 점유율을 먼저 챙긴다)
      const cs = this.competitorsOn(r.a, r.b);
      if (cs.length) { const low = Math.min(...cs.map((x) => x.route.fareRatio)) * config.strategy.undercut; if (r.fare / base > low) this.setFare(routeId, base * low); }
    }
    // 비즈니스석도 같은 방식으로: 수요가 좌석보다 많으면 운임을 올리고 모자라면 내린다(기내 서비스·라운지 같은 수요 효과가 운임으로 돌아온다)
    if (d.seatsB > 0) {
      const baseB = this.routeBaseFareBiz(r), savedB = r.fareBiz; r.fareBiz = Math.round(baseB);
      const db = this.routeDay(r);
      if (db.demandB > 0) this.setFareBiz(routeId, baseB * Math.min(config.fare.maxRatio, Math.max(config.fare.minRatio, 1 + Math.log(db.demandB / db.seatsB) / config.cabin.bizElasticity)));
      else r.fareBiz = savedB;
    }
  }
  setAutoFare(on: boolean): void { this.state.autoFare = on; }
  setAutoFreq(on: boolean): void { this.state.autoFreq = on; }
  /** 자동 증감편: 손님이 좌석보다 5% 넘게 많거나(자동 운임이 운임을 10% 넘게 올려 둔 것도 포함) 하면 한 대를 주 1회 늘리고, 탑승률 70% 미만이면 1회 줄인다 */
  private autoFreqStep(r: Route): void {
    const ps = this.planesOn(r.id).filter((p) => p.shop <= 0 && p.charter === undefined); if (!ps.length) return;
    const d = this.routeDay(r); if (d.seats <= 0) return;
    const lf = d.pax / d.seats;
    if (d.demand > d.seats * 1.05 || (lf > 0.97 && r.fare > this.routeBaseFare(r) * 1.1)) { for (const p of [...ps].sort((a, b) => a.weekly - b.weekly || a.id - b.id)) if (this.assign(p.id, r.id, p.weekly + 1).ok) return; }
    else if (lf < 0.7) { const p = [...ps].sort((a, b) => b.weekly - a.weekly || a.id - b.id)[0]; if (p.weekly > 1) this.assign(p.id, r.id, p.weekly - 1); }
  }
  /** 점유율 우선 운임: 켜면 매주 경쟁사 최저가보다 5% 싸게 맞춘다(경쟁사가 없으면 그냥 자동 운임) */
  setStance(routeId: number, on: boolean): Result {
    const r = this.route(routeId); if (!r || !r.open) return fail('열려 있는 노선이 아닙니다');
    if (on && !this.competitorsOn(r.a, r.b).length) return fail('경쟁사가 없는 노선입니다');
    if (on) r.stance = 'share'; else delete r.stance;
    if (on && this.planesOn(routeId).length) this.fillFare(routeId);
    return { ok: true };
  }
  /** 노선 서비스 등급(0 기본·1 고급·2 최고급): 경쟁사와 나누는 몫이 커지고, 항공기 1대당 월 비용이 든다 */
  setService(routeId: number, level: number): Result {
    const r = this.route(routeId); if (!r || !r.open) return fail('열려 있는 노선이 아닙니다');
    if (!Number.isInteger(level) || level < 0 || level >= config.strategy.svcWeight.length) return fail('없는 등급입니다');
    if (level) r.svc = level; else delete r.svc;
    return { ok: true };
  }
  /** 노선 별명(빈 문자열이면 지움, 최대 16자) */
  /** 항공기 이름(빈 문자열이면 지움, 최대 12자) */
  setPlaneName(planeId: number, name: string): Result {
    const p = this.plane(planeId); if (!p) return fail('없는 항공기입니다');
    const n = name.trim().slice(0, 12); if (n) p.name = n; else delete p.name;
    return { ok: true };
  }
  /** 도색 색 */
  setLivery(color: string): Result { if (!config.livery.includes(color)) return fail('고를 수 없는 색입니다'); this.state.livery = color; return { ok: true }; }
  /** 이 항공기를 같은 노선에서 다른 새 기종으로 바꾸면: 월 이익 변화, 실제로 드는 돈(새 기체 값 − 지금 기체 매각·반납), 회수 개월 */
  replaceOptions(planeId: number): { type: string; gain: number; cost: number; payback: number | null; weekly: number }[] {
    const p = this.plane(planeId); if (!p || p.routeId === null || p.shop > 0) return [];
    const r = this.route(p.routeId); if (!r) return [];
    const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), cur = typeById(p.type), dpm = config.daysPerMonth;
    const b = this.routeDay(r), before = b.revenue - b.cost, sale = p.leased ? (p.deposit ?? 0) - this.leaseReturnFee(p) : p.book * config.sale.ratio, rentSaved = p.leased ? cur.price * config.lease.rate : 0;
    const out: { type: string; gain: number; cost: number; payback: number | null; weekly: number }[] = [];
    for (const t of AIRCRAFT) {
      if (t.id === p.type || !this.isAvailable(t.id) || (t.seats > 0) !== (cur.seats > 0) || !canFly(t, A, B).ok) continue;
      const weekly = Math.min(p.weekly || maxWeeklyRoundTrips(km, t), maxWeeklyRoundTrips(km, t)); if (weekly < 1) continue;
      const save = { type: p.type, age: p.age, cond: p.cond, weekly: p.weekly, bizShare: p.bizShare, leased: p.leased };
      p.type = t.id; p.age = 0; p.cond = 1; p.weekly = weekly; p.leased = false;
      let a; try { a = this.routeDay(r); } finally { Object.assign(p, save); }
      const gain = (a.revenue - a.cost - before) * dpm + rentSaved, cost = Math.round((t.price - sale) * 10) / 10;
      out.push({ type: t.id, gain, cost, payback: gain > 0.05 ? Math.max(0, cost) / gain : null, weekly });
    }
    return out.filter((o) => o.payback !== null).sort((x, y) => x.payback! - y.payback! || y.gain - x.gain);
  }
  /** 교체: 지금 항공기를 팔고(임대기는 반납) 새 기종을 사서 같은 노선에 넣는다. 이름·객실 비율은 이어받는다 */
  replacePlane(planeId: number, typeId: string): Result<{ planeId: number; cost: number }> {
    const s = this.state; if (s.status !== 'playing') return fail('게임이 끝났습니다');
    const p = this.plane(planeId), o = this.replaceOptions(planeId).find((x) => x.type === typeId);
    if (!p || !o) return fail('지금은 이 기종으로 바꿀 수 없습니다');
    if (s.cash < o.cost) return fail('현금이 모자랍니다');
    const routeId = p.routeId!, name = p.name, biz = p.bizShare, t = typeById(typeId);
    this.sellPlane(planeId);
    s.cash -= t.price;
    const np = this.addPlane(typeId, t.price, { bizShare: t.seats > 0 ? biz : 0, ...(name ? { name } : {}) });
    const asg = this.assign(np.id, routeId, o.weekly);
    if (!asg.ok) this.assign(np.id, routeId, 1);
    s.log.push(`${this.monthsPassed + 1}개월차: ${name ? `${name}(` : ''}${typeById(p.type).name}${name ? ')' : ''}을(를) ${t.name}(으)로 교체했습니다(순비용 $${o.cost}M).`);
    return { ok: true, planeId: np.id, cost: o.cost };
  }
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
  hedgeFuel(months: number = config.fuel.hedgeMonths): Result<{ price: number }> {
    if (this.state.status !== 'playing') return fail('게임이 끝났습니다');
    if (this.state.hedge) return fail('이미 연료 계약 중입니다');
    const tier = config.fuel.hedgeTiers.find((t) => t.months === months);
    if (!tier) return fail('없는 계약 기간입니다');
    if (this.state.cash < tier.cost) return fail('현금이 모자랍니다');
    this.state.cash -= tier.cost; this.state.cur.cost += tier.cost;
    this.state.hedge = { price: this.state.fuel, monthsLeft: tier.months };
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
  /** 슬롯 거래: 사서 늘린 슬롯 중 남는 것을 경쟁사에 판다(그 슬롯은 경쟁사가 차지한다) */
  sellSlot(cityId: string): Result<{ price: number }> {
    const s = this.state; if (s.status !== 'playing') return fail('게임이 끝났습니다');
    if ((s.slots[cityId] ?? 0) <= 0) return fail('사서 늘린 슬롯이 없습니다');
    if (this.slotsUsed(cityId) > this.slotCapacity(cityId) - 1 + 1e-9) return fail('남는 슬롯이 없습니다(쓰고 있는 슬롯은 팔 수 없습니다)');
    s.slots[cityId] -= 1; const price = Math.round(this.slotPrice(cityId) * config.slotTrade.sell * 10) / 10;
    s.cash += price; s.compSlots = { ...(s.compSlots ?? {}), [cityId]: (s.compSlots?.[cityId] ?? 0) + 1 }; this.updateTaken();
    return { ok: true, price };
  }
  /** 경쟁사가 가진 슬롯(우리가 판 것·입찰로 딴 것)을 웃돈을 주고 사 온다 */
  compSlotsAt(cityId: string): number { const s = this.state; return (s.compSlots?.[cityId] ?? 0) + (s.compLots ?? []).filter((l) => l.city === cityId).reduce((a, l) => a + l.n, 0); }
  buyCompSlot(cityId: string): Result<{ price: number }> {
    const s = this.state; if (s.status !== 'playing') return fail('게임이 끝났습니다');
    if (this.compSlotsAt(cityId) <= 0) return fail('경쟁사가 내놓을 슬롯이 없습니다');
    const price = Math.round(this.slotPrice(cityId) * config.slotTrade.buy * 10) / 10;
    if (s.cash < price) return fail('현금이 모자랍니다');
    if ((s.compSlots?.[cityId] ?? 0) > 0) s.compSlots = { ...s.compSlots, [cityId]: s.compSlots![cityId] - 1 };
    else { const l = s.compLots!.find((x) => x.city === cityId)!; l.n -= 1; const c = s.competitors.find((x) => x.id === l.holder); if (c) c.cash += price; s.compLots = s.compLots!.filter((x) => x.n > 0); }
    s.cash -= price; s.slots[cityId] = (s.slots[cityId] ?? 0) + 1; this.updateTaken();
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
      out.push({ shareBefore: b.share, shareAfter: a.share, type: t.id, weekly, price: t.price, profit, payback: profit > 0.05 ? t.price / profit : null, slotCost: sf.cost, slotNeeds: sf.needs, recommended: false });
    }
    let best: RouteOption | null = null;
    for (const o of out) if (o.payback !== null && (!best || o.payback < best.payback!)) best = o;
    if (best) best.recommended = true;
    return out;
  }
  /** 놀고 있는 항공기를 어느 열린 노선에 넣으면 좋은지(월 이익 증가 추정 순). 최대 횟수로 배정한다고 가정하고, 슬롯이 모자라면 슬롯 값도 뺀다 */
  assignAdvice(planeId: number, limit = 3): { routeId: number; weekly: number; profit: number; slotCost: number }[] {
    const p = this.plane(planeId); if (!p || p.routeId !== null) return [];
    const t = typeById(p.type), dpm = config.daysPerMonth, out: { routeId: number; weekly: number; profit: number; slotCost: number }[] = [];
    for (const r of this.state.routes) {
      if (!r.open) continue;
      const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B);
      if (!canFly(t, A, B).ok) continue;
      const weekly = maxWeeklyRoundTrips(km, t); if (weekly < 1) continue;
      const b = this.routeDay(r), before = b.revenue - b.cost;
      p.routeId = r.id; p.weekly = weekly; // 잠깐 넣어 보고 바로 되돌린다
      let a; try { a = this.routeDay(r); } finally { p.routeId = null; p.weekly = 0; }
      const sf = this.slotShortfall(planeId, r.id, weekly), slots = sf.needs.reduce((x, n) => x + n.n, 0);
      out.push({ routeId: r.id, weekly, profit: (a.revenue - a.cost - before) * dpm - config.slot.lease * slots * this.mods.fixed, slotCost: sf.cost });
    }
    return out.sort((x, y) => y.profit - x.profit || x.routeId - y.routeId).slice(0, limit);
  }
  /** 이 노선의 시장 점유율: 나와 경쟁사별(합계 1). 경쟁사가 없으면 내가 1 */
  routeShares(r: Route): { name: string; share: number; me: boolean; id: number }[] {
    const d = this.routeDay(r), cs = this.competitorsOn(r.a, r.b), me = { name: '우리', share: d.share, me: true, id: 0 };
    if (!cs.length || d.share >= 1) return [{ ...me, share: 1 }];
    const w = cs.map(({ comp, route }) => route.seatsDay * (1 / Math.max(0.3, route.fareRatio)) * this.quality(comp) * this.allyWeight(comp)), tot = w.reduce((a, b) => a + b, 0) || 1;
    return [me, ...cs.map(({ comp }, i) => ({ name: comp.name, share: (1 - d.share) * (w[i] / tot), me: false, id: comp.id }))];
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

  // ================= 자유 모드 재미 요소 =================
  get loyaltyCost(): number { const l = this.state.loyalty, t = config.extra.loyalty.tierCost; return l && this.state.sandbox ? ((l.members + (l.silver ?? 0) * t[0] + (l.gold ?? 0) * t[1] + (l.plat ?? 0) * t[2]) / 1e6) * config.extra.loyalty.costPerM[l.level] : 0; }
  /** 마일리지 상위 등급(골드·플래티넘)이 늘리는 비즈니스 수요 비율 */
  get eliteBiz(): number { const l = this.state.loyalty, k = config.extra.loyalty; if (!l || !this.state.sandbox || !l.level) return 0; return Math.min(k.bizMax[l.level], ((l.gold ?? 0) + 2 * (l.plat ?? 0)) / Math.max(1, this.state.history.at(-1)?.pax ?? 0)); }
  get promoCost(): number { const l = this.state.loyalty, k = config.extra.loyalty.promo; return Math.round((k.base + ((l?.members ?? 0) / 1e6) * k.perM) * 10) / 10; }
  setCard(on: boolean): Result {
    const s = this.state, l = s.loyalty, k = config.extra.loyalty.card; if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (on && (!l || !l.level)) return fail('마일리지 프로그램을 먼저 시작하세요');
    if (on && !l!.card) { if (s.cash < k.fee) return fail('현금이 모자랍니다'); s.cash -= k.fee; s.cur.cost += k.fee; }
    if (l) l.card = on; return { ok: true };
  }
  startPromo(): Result {
    const s = this.state, l = s.loyalty, k = config.extra.loyalty.promo, mp = this.monthsPassed; if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!l || !l.level) return fail('마일리지 프로그램을 먼저 시작하세요');
    if ((l.promo ?? 0) > 0) return fail('프로모션 진행 중입니다');
    if (mp < (l.promoNext ?? 0)) return fail(`${(l.promoNext ?? 0) - mp}개월 뒤에 다시 할 수 있습니다`);
    const cost = this.promoCost; if (s.cash < cost) return fail('현금이 모자랍니다');
    s.cash -= cost; s.cur.cost += cost; l.promo = k.months; l.promoNext = mp + k.months + k.cool;
    s.log.push(`${mp + 1}개월차: 마일 2배 프로모션을 시작했습니다($${cost}M, ${k.months}개월).`); return { ok: true };
  }
  private loyaltyStep(): void {
    const s = this.state, l = s.loyalty; if (!l) return;
    const k = config.extra.loyalty, pax = s.history.at(-1)?.pax ?? 0, promo = (l.promo ?? 0) > 0;
    const join = k.join[l.level] * (l.card && l.level ? k.card.join : 1) * (promo ? k.promo.join : 1);
    l.members = Math.max(0, Math.round(l.members * (1 - k.churn[l.level]) + pax * join));
    const [ps, pg, pp] = k.promote, ec = l.level ? k.eliteChurn : 0.2, on = l.level ? 1 : 0;
    let sv = l.silver ?? 0, gd = l.gold ?? 0, pt = l.plat ?? 0;
    const up1 = Math.max(0, l.members - sv - gd - pt) * ps * on, up2 = sv * pg * on, up3 = gd * pp * on;
    sv = sv * (1 - ec) + up1 - up2; gd = gd * (1 - ec) + up2 - up3; pt = pt * (1 - ec) + up3;
    const tot = sv + gd + pt; if (tot > l.members) { const f = l.members / tot; sv *= f; gd *= f; pt *= f; }
    l.silver = Math.round(sv); l.gold = Math.round(gd); l.plat = Math.round(pt);
    if (l.card && l.level) { const inc = Math.round((l.members / 1e6) * k.card.perM * 100) / 100; s.cash += inc; s.cur.revenue += inc; l.cardInc = inc; } else l.cardInc = 0;
    if (promo) l.promo = (l.promo ?? 1) - 1;
  }
  /** 마일리지로 늘어나는 수요(0~최대) */
  get loyaltyBoost(): number {
    const l = this.state.loyalty, k = config.extra.loyalty; if (!l || !this.state.sandbox || !l.level) return 0;
    const pax = this.state.history.at(-1)?.pax ?? 0; return k.maxBoost[l.level] * Math.min(1, l.members / Math.max(1, pax * 3)) + ((l.promo ?? 0) > 0 ? k.promo.boost : 0);
  }
  setLoyalty(level: number): Result {
    if (!this.state.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (![0, 1, 2].includes(level)) return fail('없는 단계입니다');
    const l = this.state.loyalty ?? { level: 0, members: 0 };
    if (level < l.level) l.members = Math.round(l.members * 0.8); // 혜택을 줄이면 회원 20%가 떠난다
    if (level === 0) l.card = false;
    l.level = level; this.state.loyalty = l; return { ok: true };
  }
  /** 노선 별점(1~5): 정시율·서비스 등급·평판·혼잡 */
  routeRating(r: Route): number {
    const otp = this.routeOtp(r), d = this.state.reputation;
    return Math.round(Math.min(5, Math.max(1, 2.5 + Math.max(-1.5, Math.min(1.5, (otp - 0.85) * 10)) + (r.svc ?? 0) * 0.4 + d + (this.state.alli?.proj?.lounge === -1 && this.state.alliance?.length ? config.extra.alliance.projects.lounge.rating ?? 0 : 0) + this.cabinOf(r) * config.extra.cabin.rating)) * 10) / 10;
  }
  /** 자유 모드 수요 보정: 마일리지, 첫 취항 보너스, 별점 */
  private extraDemand(r: Route): number {
    const s = this.state; if (!s.sandbox) return 1;
    const mp = this.monthsPassed, pio = [r.a, r.b].some((id) => (s.pioneer?.[id] ?? -1) > mp) ? config.extra.pioneer.boost : 0;
    return (1 + this.loyaltyBoost) * (1 + pio) * (1 + config.extra.rating.weight * (this.routeRating(r) - 3)) * this.alliDemand(r) * (s.campaign && s.campaign.until > mp ? 1 + (config.extra.campaign[s.campaign.kind]?.boost ?? 0) : 1);
  }
  /** 착륙료 배율: 우리가 운영권을 가진 공항이면 싸다 */
  private landingFactor(r: Route): number {
    if (this.state.myAirports?.some((x) => x === r.a || x === r.b)) return [r.a, r.b].every((x) => this.state.myAirports!.includes(x)) ? 0 : 0.5; // 내 공항: 착륙료 면제(한쪽만이면 절반)
    const c = this.state.concessions; if (!c) return 1;
    return [r.a, r.b].some((id) => c[id]?.holder === 0 && c[id].until > this.monthsPassed) ? config.extra.bid.concessionFee : 1;
  }
  isFriend(c: Competitor): boolean { return c.id === this.state.ally || !!c.stake || !!this.state.alliance?.includes(c.id); }

  // ---- 전세기 ----
  acceptCharter(id: number, planeId: number): Result {
    const s = this.state, ch = (s.charters ?? []).find((x) => x.id === id), p = this.plane(planeId);
    if (!ch || ch.planeId !== undefined) return fail('없는 전세 주문입니다');
    if (!p || p.routeId !== null || p.shop > 0 || p.charter !== undefined) return fail('노는 항공기만 보낼 수 있습니다');
    const t = typeById(p.type), km = distanceKm(cityById(ch.a), cityById(ch.b));
    if (t.seats < ch.seats) return fail(`좌석 ${ch.seats}석 이상이 필요합니다`);
    if (t.range < km) return fail('항속 거리가 모자랍니다');
    p.charter = id; ch.planeId = planeId; ch.left = ch.months;
    s.log.push(`${this.monthsPassed + 1}개월차: 전세기 주문 수락 — ${cityById(ch.a).name} ⇄ ${cityById(ch.b).name}, ${t.name} ${ch.months}개월(월 $${ch.perMonth}M).`);
    return { ok: true };
  }
  private charterStep(m: number): void {
    const s = this.state, k = config.extra.charter;
    for (const ch of [...(s.charters ?? [])]) {
      if (ch.planeId === undefined) { if (m >= ch.expires) s.charters = s.charters!.filter((x) => x !== ch); continue; }
      const p = this.plane(ch.planeId);
      if (!p) { s.charters = s.charters!.filter((x) => x !== ch); continue; }
      s.cash += ch.perMonth; s.cur.revenue += ch.perMonth; p.cond = Math.max(0, p.cond - config.maint.decayBase * 1.5);
      ch.left = (ch.left ?? 1) - 1;
      if (ch.left <= 0) { delete p.charter; s.charters = s.charters!.filter((x) => x !== ch); s.log.push(`${m + 1}개월차: 전세 운항이 끝났습니다(${typeById(p.type).name} 대기 중).`); }
    }
    if (m + 1 < k.startMonth || (s.charters ?? []).filter((x) => x.planeId === undefined).length >= k.maxOffers || this.rng.next() >= k.chance) return;
    const pool = CITIES.filter((c) => this.cityOpen(c.id));
    for (let tries = 0; tries < 8; tries++) {
      const A = pool[this.rng.int(pool.length)], B = pool[this.rng.int(pool.length)]; if (A.id === B.id) continue;
      const km = distanceKm(A, B); if (km < 1500 || km > 9000) continue;
      const seats = k.seats[this.rng.int(k.seats.length)], months = k.months[0] + this.rng.int(k.months[1] - k.months[0] + 1);
      const ch: Charter = { id: s.nextId++, a: A.id, b: B.id, months, seats, perMonth: Math.round(k.payK * seats * Math.sqrt(km / 1000) * 10) / 10, expires: m + k.offerMonths };
      s.charters = [...(s.charters ?? []), ch];
      s.log.push(`${m + 1}개월차: 전세기 주문 — ${A.name} ⇄ ${B.name}, ${seats}석 이상 ${months}개월, 월 $${ch.perMonth}M(현황 탭, ${k.offerMonths}개월 안에).`);
      return;
    }
  }

  // ---- 항공 동맹 ----
  joinAlliance(id: number): Result {
    const s = this.state, c = s.competitors.find((x) => x.id === id), k = config.extra.alliance;
    if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!c || c.major || c.stake) return fail('동맹에 넣을 수 없는 회사입니다');
    if (s.rivalAlliance?.includes(id)) return fail('다른 동맹에 들어가 있는 회사입니다');
    if ((s.alliance ?? []).includes(id)) return fail('이미 동맹입니다');
    if ((s.alliance ?? []).length >= this.alliMax) return fail(`동맹은 지금 ${this.alliMax}곳까지입니다(동맹 등급이 오르면 늘어남)`);
    const fee = this.agendaOn('expand') ? 0 : k.joinFee;
    if (s.cash < fee) return fail('현금이 모자랍니다');
    s.cash -= fee; s.alliance = [...(s.alliance ?? []), id]; if (!s.alli) s.alli = { name: '우리 동맹', xp: 0 };
    if (s.rivalId === id) s.rivalId = null;
    s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) 우리 동맹에 들어왔습니다.`); this.quote(c, 'join'); this.note(this.monthsPassed + 1, 'rival', `${c.name} 동맹 가입`);
    return { ok: true };
  }
  // ---- 우리 동맹: 이름·등급·공동 사업·회의·영입 ----
  get alliLevel(): number { const xp = this.state.alli?.xp ?? 0; return 1 + config.extra.alliance.levels.filter((x) => xp >= x).length; }
  get alliMax(): number { const lv = this.alliLevel; return config.extra.alliance.max + (lv >= 3 ? 1 : 0) + (lv >= 5 ? 1 : 0) + (this.agendaOn('expand') ? 1 : 0); }
  get alliCodeshare(): number { const k = config.extra.alliance; return k.codeshare + k.lvCodeshare * (this.alliLevel - 1); }
  get alliWeight(): number { const k = config.extra.alliance; return Math.max(0.2, k.weight - k.lvWeight * (this.alliLevel - 1)); }
  agendaOn(id: string): boolean { const a = this.state.alli?.agenda; return !!a && a.id === id && a.until > this.monthsPassed && !!this.state.alliance?.length; }
  alliProjCost(id: string): number { const p = config.extra.alliance.projects[id]; return p ? Math.round(Math.max(p.cost, this.monthlyRev * p.rev)) : 0; }
  /** 동맹이 늘리는 수요: 공동 마케팅(동맹사가 다니는 도시), 공동 운임(동맹사와 겹치는 노선) */
  private alliDemand(r: Route): number {
    const s = this.state, mem = s.competitors.filter((c) => s.alliance?.includes(c.id)); if (!mem.length || !s.alli) return 1;
    const k = config.extra.alliance, mp = this.monthsPassed; let f = 1;
    if ((s.alli.proj?.mkt ?? 0) > mp && mem.some((c) => [r.a, r.b].some((x) => c.hub === x || c.routes.some((y) => y.a === x || y.b === x)))) f *= 1 + (k.projects.mkt.boost ?? 0);
    if (this.agendaOn('fare') && mem.some((c) => c.routes.some((y) => this.sameRoute(y, r.a, r.b)))) f *= 1.05;
    return f;
  }
  setAllianceName(name: string): Result {
    const n = name.replace(/[<>&"']/g, '').trim(); if (n.length < 1 || n.length > 16) return fail('이름은 1~16자로 지어 주세요');
    const s = this.state; s.alli = { ...(s.alli ?? { xp: 0 }), name: n }; return { ok: true };
  }
  buyAlliProject(id: string): Result {
    const s = this.state, p = config.extra.alliance.projects[id], mp = this.monthsPassed;
    if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!p) return fail('없는 사업입니다');
    if (!s.alliance?.length) return fail('동맹 회원이 있어야 합니다');
    const cur = s.alli?.proj?.[id]; if (cur === -1) return fail('이미 갖췄습니다'); if (cur !== undefined && cur > mp) return fail('진행 중입니다');
    const cost = this.alliProjCost(id); if (s.cash < cost) return fail('현금이 모자랍니다');
    s.cash -= cost; s.cur.cost += cost; s.alli = s.alli ?? { name: '우리 동맹', xp: 0 }; s.alli.proj = { ...(s.alli.proj ?? {}), [id]: p.months ? mp + p.months : -1 };
    s.log.push(`${mp + 1}개월차: ${s.alli.name} 공동 사업 — ${p.name}($${cost}M). ${p.desc}.`); return { ok: true };
  }
  chooseAgenda(id: string): Result {
    const s = this.state, k = config.extra.alliance; if (!s.alli?.meeting) return fail('열린 동맹 회의가 없습니다');
    if (!k.agendas[id]) return fail('없는 안건입니다');
    s.alli.agenda = { id, until: this.monthsPassed + k.agendaMonths }; s.alli.meeting = null;
    s.log.push(`${this.monthsPassed + 1}개월차: ${s.alli.name} 회의에서 '${k.agendas[id].name}' 안건을 통과시켰습니다. ${k.agendas[id].desc}.`); return { ok: true };
  }
  /** 스카이 동맹이 우리 회원을 빼 가려 할 때: 붙잡으려면 돈을 낸다 */
  keepMember(): Result {
    const s = this.state, p = s.alli?.poach; if (!p) return fail('영입 시도가 없습니다');
    if (s.cash < p.cost) return fail('현금이 모자랍니다');
    s.cash -= p.cost; s.cur.cost += p.cost; s.alli!.poach = null; const c = s.competitors.find((x) => x.id === p.comp);
    s.log.push(`${this.monthsPassed + 1}개월차: $${p.cost}M을 들여 ${c?.name ?? '회원사'}을(를) 붙잡았습니다.`); return { ok: true };
  }
  releaseMember(): Result {
    const s = this.state, p = s.alli?.poach; if (!p) return fail('영입 시도가 없습니다');
    this.loseToSky(p.comp); return { ok: true };
  }
  private loseToSky(id: number): void {
    const s = this.state, c = s.competitors.find((x) => x.id === id); s.alli!.poach = null;
    s.alliance = (s.alliance ?? []).filter((x) => x !== id); if (c && s.rivalAlliance) s.rivalAlliance = [...s.rivalAlliance, id];
    this.alert(`${this.monthsPassed + 1}개월차: ${c?.name ?? '회원사'}이(가) 우리 동맹을 떠나 스카이 동맹으로 옮겼습니다.`); if (c) this.quote(c, 'leave');
  }
  recruitCost(c: Competitor): number { const k = config.extra.alliance.recruit; return Math.round(k.fee + this.acquirePrice(c) * k.ratio); }
  get recruitChance(): number { const k = config.extra.alliance.recruit; return Math.min(0.9, k.base + k.perLv * (this.alliLevel - 1)); }
  /** 스카이 동맹 회원을 우리 동맹으로 데려오려 한다(돈은 성공과 상관없이 낸다) */
  recruitFromSky(id: number): Result<{ won: boolean }> {
    const s = this.state, c = s.competitors.find((x) => x.id === id);
    if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!c || c.major || !s.rivalAlliance?.includes(id)) return fail('스카이 동맹 회원이 아닙니다');
    if ((s.alliance ?? []).length >= this.alliMax) return fail(`동맹은 지금 ${this.alliMax}곳까지입니다`);
    const cost = this.recruitCost(c); if (s.cash < cost) return fail('현금이 모자랍니다');
    s.cash -= cost; s.cur.cost += cost;
    const won = this.rng.next() < this.recruitChance;
    if (won) { s.rivalAlliance = s.rivalAlliance.filter((x) => x !== id); s.alliance = [...(s.alliance ?? []), id]; if (!s.alli) s.alli = { name: '우리 동맹', xp: 0 }; if (s.rivalId === id) s.rivalId = null; }
    s.log.push(`${this.monthsPassed + 1}개월차: ${c.name} 영입 ${won ? '성공 — 우리 동맹에 들어왔습니다' : '실패 — 스카이 동맹에 남았습니다'}($${cost}M).`);
    return { ok: true, won };
  }
  /** 매달: 경험치, 연례 회의, 스카이 동맹의 영입 시도 */
  private alliStep(m: number): void {
    const s = this.state, k = config.extra.alliance, n = s.alliance?.length ?? 0; if (!s.alli) { if (!n) return; s.alli = { name: '우리 동맹', xp: 0 }; }
    const a = s.alli, lv = this.alliLevel; a.xp += n;
    if (this.alliLevel > lv) s.log.push(`${m}개월차: ${a.name}이(가) ${this.alliLevel}등급이 됐습니다(환승·회원 한도 혜택 증가).`);
    if (a.meeting && m >= a.meeting.expires) { a.meeting = null; s.log.push(`${m}개월차: ${a.name} 회의가 안건 없이 끝났습니다.`); }
    if (n && m % 12 === k.meetMonth && !a.meeting) { a.meeting = { expires: m + k.meetMonths }; s.log.push(`${m}개월차: ${a.name} 연례 회의가 열렸습니다. 경쟁사 탭에서 안건을 고르세요(${k.meetMonths}개월 안).`); }
    if (a.poach && m >= a.poach.expires) this.loseToSky(a.poach.comp);
    else if (!a.poach && n && s.rivalAlliance && this.rng.next() < k.poach.chance) {
      const id = s.alliance![this.rng.int(n)], c = s.competitors.find((x) => x.id === id);
      if (c) { a.poach = { comp: id, expires: m + k.poach.months, cost: Math.round(5 + c.planes * 1.5) }; this.alert(`${m}개월차: 스카이 동맹이 ${c.name}에 영입을 제안했습니다. $${a.poach.cost}M을 들여 붙잡거나 보내 주세요(${k.poach.months}개월 안).`); }
    }
  }
  leaveAlliance(id: number): Result { const s = this.state; if (!(s.alliance ?? []).includes(id)) return fail('동맹이 아닙니다'); s.alliance = s.alliance!.filter((x) => x !== id); return { ok: true }; }

  // ---- 입찰: 공항 운영권·신공항 슬롯 ----
  placeBid(id: number): Result<{ amount: number }> {
    const s = this.state, b = (s.bids ?? []).find((x) => x.id === id), k = config.extra.bid;
    if (!b) return fail('끝난 입찰입니다');
    if (b.best?.who === 0) return fail('이미 최고가입니다');
    const amount = b.best ? b.best.amount + k.step : b.min;
    if (s.cash < amount) return fail(`현금이 모자랍니다(낙찰되면 $${amount}M을 냅니다)`);
    b.best = { who: 0, amount }; return { ok: true, amount };
  }
  /** 경쟁사가 매기는 입찰 가치. 경쟁사는 이 값의 0.8~1.4배까지 부른다 */
  bidValue(b: NonNullable<GameState['bids']>[number]): number { return b.kind === 'concession' ? 14 + 2 * this.state.competitors.reduce((a, c) => a + c.routes.filter((r) => r.a === b.city || r.b === b.city).length, 0) : b.n * 4; }
  private bidStep(m: number): void {
    const s = this.state, k = config.extra.bid, mp = this.monthsPassed;
    for (const b of [...(s.bids ?? [])]) {
      if (mp < b.ends) { // 경쟁사가 값을 올린다
        const value = this.bidValue(b);
        const bidders = s.competitors.filter((c) => !this.isFriend(c) && c.cash > 20 && (c.hub === b.city || c.routes.some((r) => r.a === b.city || r.b === b.city) || c.major));
        const next = b.best ? b.best.amount + k.step : b.min;
        if (bidders.length && next <= value * (0.8 + this.rng.next() * 0.6) && b.best?.who !== bidders[0].id && this.rng.next() < 0.6) { const c = bidders[this.rng.int(bidders.length)]; b.best = { who: c.id, amount: next }; s.log.push(`${m + 1}개월차: ${c.name}이(가) ${cityById(b.city).name} ${b.kind === 'concession' ? '운영권' : '슬롯'} 입찰에서 $${next}M을 불렀습니다.`); }
        continue;
      }
      s.bids = s.bids!.filter((x) => x !== b);
      const w = b.best; if (!w) { s.log.push(`${m + 1}개월차: ${cityById(b.city).name} 입찰이 유찰됐습니다.`); continue; }
      if (w.who === 0) {
        if (s.cash < w.amount) { s.reputation = Math.max(0, s.reputation - 0.01); s.log.push(`${m + 1}개월차: 낙찰됐지만 현금이 모자라 ${cityById(b.city).name} 입찰을 포기했습니다(평판 하락).`); continue; }
        s.cash -= w.amount; s.cur.cost += w.amount;
        if (b.kind === 'concession') s.concessions = { ...(s.concessions ?? {}), [b.city]: { holder: 0, until: mp + k.concessionMonths } }; else s.slots[b.city] = (s.slots[b.city] ?? 0) + b.n;
        s.log.push(`${m + 1}개월차: ${cityById(b.city).name} ${b.kind === 'concession' ? `공항 운영권(5년: 슬롯 +${k.concessionSlots}, 착륙료 −30%)` : `슬롯 ${b.n}개`}을(를) $${w.amount}M에 낙찰받았습니다!`); this.note(m + 1, 'invest', `${cityById(b.city).name} ${b.kind === 'concession' ? '운영권' : '신공항 슬롯'} 낙찰`);
      } else {
        const c = s.competitors.find((x) => x.id === w.who); if (c) c.cash -= w.amount;
        if (b.kind === 'concession') s.concessions = { ...(s.concessions ?? {}), [b.city]: { holder: w.who, until: mp + k.concessionMonths } };
        else s.compLots = [...(s.compLots ?? []), { city: b.city, n: b.n, holder: w.who }];
        this.alert(`${m + 1}개월차: ${c?.name ?? '경쟁사'}이(가) ${cityById(b.city).name} ${b.kind === 'concession' ? '공항 운영권' : `슬롯 ${b.n}개`}을(를) $${w.amount}M에 가져갔습니다.`);
      }
    }
    if (m + 1 < k.startMonth || (s.bids ?? []).length) return;
    if (this.rng.next() < k.concessionChance) { // 공항 운영권: 노선이 많이 몰린 도시
      const cnt = new Map<string, number>(); for (const r of s.routes) if (r.open) for (const id of [r.a, r.b]) cnt.set(id, (cnt.get(id) ?? 0) + 1); for (const c of s.competitors) for (const r of c.routes) for (const id of [r.a, r.b]) cnt.set(id, (cnt.get(id) ?? 0) + 1);
      const city = [...cnt].filter(([id]) => !(s.concessions?.[id] && s.concessions[id].until > mp)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
      if (city) { s.bids = [{ id: s.nextId++, kind: 'concession', city, n: 0, ends: mp + k.months, best: null, min: k.concessionMin }]; s.log.push(`${m + 1}개월차: ${cityById(city).name} 공항 운영권 입찰이 열렸습니다(${k.months}개월, 낙찰되면 5년간 슬롯 +${k.concessionSlots}·착륙료 −30%).`); }
    } else if (this.rng.next() < k.airportChance) { // 신공항 개항: 공용 슬롯이 늘고, 일부는 입찰
      const cands = CITIES.filter((c) => !(s.newAirport?.[c.id])).sort((a, b) => b.pop * b.income - a.pop * a.income), city = cands[this.rng.int(Math.min(10, cands.length))];
      if (city) { s.newAirport = { ...(s.newAirport ?? {}), [city.id]: k.airportPublic }; s.bids = [{ id: s.nextId++, kind: 'slots', city: city.id, n: k.airportLot, ends: mp + k.months, best: null, min: Math.round(k.airportLot * 2) }]; s.log.push(`${m + 1}개월차: ${city.name} 신공항 개항! 공용 슬롯 +${k.airportPublic}, 나머지 슬롯 ${k.airportLot}개는 입찰로 나왔습니다(${k.months}개월).`); this.note(m + 1, 'event', `${city.name} 신공항 개항`); }
    }
  }

  // ---- 메가 프로젝트 ----
  /** 회사 규모 배수: 최근 12개월 매출 ÷ $150M (최소 1) */
  get megaMult(): number { const rev = this.state.history.slice(-12).reduce((a, h) => a + h.revenue, 0); return Math.max(1, Math.round((rev / config.extra.mega.scalePer) * 10) / 10); }
  /** 최근 12개월 월평균 매출 */
  get monthlyRev(): number { const h = this.state.history.slice(-12); return h.length ? h.reduce((a, x) => a + x.revenue, 0) / h.length : 0; }
  megaCost(id: string): number { const d = config.extra.mega.list.find((x) => x.id === id); return d ? Math.round(d.cost * this.megaMult) : 0; }
  startMega(id: string, city?: string): Result {
    const s = this.state, d = config.extra.mega.list.find((x) => x.id === id);
    if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!d) return fail('없는 사업입니다');
    if (s.mega) return fail('이미 진행 중인 대형 사업이 있습니다');
    if (id !== 'terminal' && id !== 'airport' && (s.megaDone ?? []).includes(id)) return fail('이미 완공했습니다');
    if (id === 'airport' && (!city || !this.cityOpen(city) || s.myAirports?.includes(city))) return fail('공항을 지을 도시를 골라 주세요(운수권이 있고 아직 내 공항이 없는 곳)');
    const cost = this.megaCost(id); s.mega = { id, done: 0, cost, ...(id === 'terminal' || id === 'airport' ? { city: city ?? s.base } : {}) };
    s.log.push(`${this.monthsPassed + 1}개월차: 대형 사업 착공 — ${d.name}(${d.months}개월, 매달 $${Math.round((cost / d.months) * 10) / 10}M).`); this.note(this.monthsPassed + 1, 'invest', `${d.name} 착공`);
    return { ok: true };
  }
  cancelMega(): Result { if (!this.state.mega) return fail('진행 중인 사업이 없습니다'); this.state.mega = null; return { ok: true }; }
  private megaStep(m: number): void {
    const s = this.state, mg = s.mega; if (!mg) return;
    const d = config.extra.mega.list.find((x) => x.id === mg.id)!, pay = (mg.cost ?? d.cost) / d.months;
    if (s.cash < pay) { s.log.push(`${m + 1}개월차: 현금이 모자라 ${d.name} 공사가 이번 달 멈췄습니다.`); return; }
    s.cash -= pay; s.cur.cost += pay; mg.done++;
    if (mg.done >= d.months) {
      s.megaDone = [...(s.megaDone ?? []), mg.id];
      if (mg.id === 'terminal' && mg.city) s.megaCity = { ...(s.megaCity ?? {}), [mg.city]: (s.megaCity?.[mg.city] ?? 0) + 12 };
      if (mg.id === 'academy') s.reputation = Math.min(1, s.reputation + 0.05);
      if (mg.id === 'airport' && mg.city) s.myAirports = [...(s.myAirports ?? []), mg.city];
      if (mg.id.startsWith('own_')) s.ownTypes = [...(s.ownTypes ?? []), mg.id.slice(4)];
      s.log.push(`${m + 1}개월차: 대형 사업 완공 — ${d.name}${mg.city ? `(${cityById(mg.city).name})` : ''}! ${d.desc}.`); this.note(m + 1, 'invest', `${d.name} 완공`);
      s.mega = null;
    }
  }

  // ---- 신기종 선주문 ----
  canPreorder(typeId: string): boolean { const t = typeById(typeId), mp = this.monthsPassed; return this.state.sandbox && (t.from ?? 0) > mp && mp >= (t.from ?? 0) - 6; }
  preorder(typeId: string, n: number): Result<{ deposit: number }> {
    const s = this.state, k = config.extra.preorder, t = typeById(typeId);
    if (!this.canPreorder(typeId)) return fail('발표된 뒤 출시 전까지만 선주문할 수 있습니다');
    const have = (s.preorders ?? []).filter((x) => x.type === typeId).reduce((a, x) => a + x.n, 0);
    if (n < 1 || have + n > k.max) return fail(`한 기종에 ${k.max}대까지입니다`);
    const deposit = Math.round(t.price * n * k.deposit * 10) / 10; if (s.cash < deposit) return fail('현금이 모자랍니다');
    s.cash -= deposit; s.preorders = [...(s.preorders ?? []), { type: typeId, n, deposit }];
    s.log.push(`${this.monthsPassed + 1}개월차: ${t.name} ${n}대 선주문(계약금 $${deposit}M, 출시 때 ${Math.round(k.discount * 100)}% 할인가로 인도).`);
    return { ok: true, deposit };
  }
  private deliverPreorders(typeId: string): void {
    const s = this.state, k = config.extra.preorder, t = typeById(typeId);
    for (const o of (s.preorders ?? []).filter((x) => x.type === typeId)) {
      const unit = t.price * (1 - k.discount) - o.deposit / o.n; let got = 0;
      for (let i = 0; i < o.n; i++) { if (s.cash < unit) break; s.cash -= unit; this.addPlane(typeId, t.price * (1 - k.discount)); got++; }
      s.log.push(`${this.monthsPassed + 1}개월차: 선주문한 ${t.name} ${got}대를 인도받았습니다${got < o.n ? `(현금이 모자라 ${o.n - got}대는 계약금을 잃었습니다)` : ''}.`);
    }
    s.preorders = (s.preorders ?? []).filter((x) => x.type !== typeId);
  }

  // ---- 시상식·기록·첫 취항·타임랩스·동맹 결성 ----
  private awardsStep(m: number): void {
    const s = this.state; if (m % 12 !== 0 || m === 0) return;
    const sum = (x: number[]) => x.reduce((a, b) => a + b, 0), y = m / 12, yr = s.history.slice(-12), prev = s.history.slice(-24, -12);
    const myRev = sum(yr.map((h) => h.revenue)), myGrowth = prev.length ? myRev / Math.max(1, sum(prev.map((h) => h.revenue))) - 1 : 0;
    const served = s.routes.filter((r) => r.open && this.planesOn(r.id).length), myRating = served.length ? sum(served.map((r) => this.routeRating(r))) / served.length : 0;
    const comps = s.competitors.filter((c) => !c.major);
    const compOtp = (c: Competitor) => 0.8 + 0.15 * Math.min(1, Math.max(0, ((c.eff ?? 1) - 0.88) / 0.24)), compRating = (c: Competitor) => 2.4 + (this.quality(c) - 0.9) * 2;
    const compGrowth = (c: Competitor) => { const h = c.revHist ?? []; return h.length >= 12 ? h.slice(-3).reduce((a, b) => a + b, 0) / Math.max(0.01, h.slice(0, 3).reduce((a, b) => a + b, 0)) - 1 : 0; };
    const jit = (c: Competitor, k: number) => ((((c.id * 7919 + y * 104729 + k * 31) % 1000) + 1000) % 1000 / 1000 - 0.5) * [0.06, 0.08, 0.2][k]; // 경쟁사 성적이 해마다 조금씩 흔들린다(같은 회사가 매년 받지 않게). 난수 대신 고정 계산이라 결정론 유지
    const cats: [string, number, (c: Competitor) => number][] = [['정시율상', this.avgOtp, (c) => compOtp(c) + jit(c, 0)], ['서비스상', myRating / 5, (c) => compRating(c) / 5 + jit(c, 1)], ['성장상', myGrowth, (c) => compGrowth(c) + jit(c, 2)]];
    const won: string[] = [], winners: Record<string, string> = {};
    for (const [name, mine, f] of cats) {
      const best = [...comps].sort((a, b) => f(b) - f(a))[0];
      if (!served.length) continue;
      if (!best || mine >= f(best)) { won.push(name); winners[name] = '우리'; } else winners[name] = best.name;
    }
    s.awards = [...(s.awards ?? []), { y, won, winners }].slice(-20);
    if (won.length) s.reputation = Math.min(1, s.reputation + config.extra.award.rep * won.length);
    s.log.push(`${m}개월차: ${y}년차 항공 시상식 — ${Object.entries(winners).map(([k, v]) => `${k} ${v}`).join(', ')}${won.length ? ` (우리 ${won.length}개 수상, 평판 상승)` : ''}.`);
    if (won.length) this.note(m, 'record', `${y}년차 시상식 ${won.join('·')} 수상`);
  }
  private recordsStep(m: number): void {
    const s = this.state, h = s.history.at(-1); if (!h) return;
    s.noFail = (s.noFail ?? 0) + 1;
    const served = s.routes.filter((r) => r.open && this.planesOn(r.id).length);
    const cur: Record<string, number> = { profit: h.profit, pax: Math.round(h.pax), planes: s.planes.length, cities: this.servedCities().size, longest: Math.round(Math.max(0, ...served.map((r) => distanceKm(cityById(r.a), cityById(r.b))))), noFail: s.noFail };
    const rec = { ...(s.records ?? {}) }, names: Record<string, string> = { profit: '월 최고 이익', pax: '월 최다 탑승객', planes: '최대 기단', cities: '최다 취항 도시', longest: '최장 노선', noFail: '최장 무고장' };
    const newOnes: string[] = [];
    for (const [k, v] of Object.entries(cur)) { if (!rec[k] || v > rec[k].v) { if (rec[k] && rec[k].v > 0 && k !== 'noFail' && k !== 'planes' && k !== 'cities') newOnes.push(names[k]); rec[k] = { v, m }; } }
    s.records = rec;
    if (newOnes.length) s.log.push(`${m}개월차: 새 기록 — ${newOnes.join(', ')}`);
  }
  private pioneerStep(m: number): void {
    const s = this.state, k = config.extra.pioneer, done = new Set(s.pioneered ?? []);
    for (const id of this.servedCities()) {
      if (done.has(id) || id === s.base) { done.add(id); continue; }
      done.add(id);
      if (!s.competitors.some((c) => c.routes.some((r) => r.a === id || r.b === id))) { s.pioneer = { ...(s.pioneer ?? {}), [id]: m + k.months }; s.log.push(`${m}개월차: ${cityById(id).name}에 처음 취항한 항공사가 됐습니다 — ${k.months}개월간 이 도시 노선 수요 +${Math.round(k.boost * 100)}%.`); }
    }
    s.pioneered = [...done];
  }
  private rivalAllianceStep(m: number): void {
    const s = this.state, k = config.extra.alliance; if (m < k.rivalMonth || s.rivalAlliance) return;
    const major = s.competitors.find((c) => c.major); if (!major) return;
    const mem = s.competitors.filter((c) => !c.major && !this.isFriend(c)).sort((a, b) => b.planes - a.planes || a.id - b.id).slice(0, 2);
    s.rivalAlliance = [major.id, ...mem.map((c) => c.id)];
    s.log.push(`${m}개월차: ${major.name}이(가) ${mem.map((c) => c.name).join('·')}과(와) '스카이 동맹'을 결성했습니다. 회원사는 서비스 품질이 올라 손님을 더 끌어갑니다.`); this.note(m, 'rival', '스카이 동맹 결성');
  }
  /** 월말: 자유 모드 재미 요소를 한꺼번에 돌린다 */
  private extraMonth(): void {
    const s = this.state, m = this.monthsPassed; if (!s.sandbox) return;
    this.loyaltyStep(); this.alliStep(m); this.lateStep(m);
    this.charterStep(m); this.bidStep(m); this.megaStep(m); this.awardsStep(m); this.recordsStep(m); this.pioneerStep(m); this.rivalAllianceStep(m);
    if (m % 6 === 0) s.netHist = [...(s.netHist ?? []), { m, routes: s.routes.filter((r) => r.open && this.planesOn(r.id).length).map((r) => [r.a, r.b] as [string, string]) }].slice(-60);
    for (const id of Object.keys(s.concessions ?? {})) if (s.concessions![id].until <= m) { const c = { ...s.concessions! }; delete c[id]; s.concessions = c; }
  }

  // ---------- 자유 모드 경쟁 강화 ----------
  /** 매달: 진출 예고·합병·라이벌·슬롯 선점·이야기 사건 */
  /** 파산·합병·인수로 사라졌거나 자회사가 된 회사를 동맹 명단·운영권·낙찰 슬롯에서 정리한다 */
  cleanGone(): void {
    const s = this.state, ids = new Set(s.competitors.map((c) => c.id)), stake = new Set(s.competitors.filter((c) => c.stake).map((c) => c.id));
    if (s.alliance) s.alliance = s.alliance.filter((id) => ids.has(id) && !stake.has(id));
    const sub = new Set(s.competitors.filter((c) => (c.stake ?? 0) >= 0.51).map((c) => c.id)); // 자회사는 라이벌 동맹에 남지 않는다
    if (s.rivalAlliance) s.rivalAlliance = s.rivalAlliance.filter((id) => ids.has(id) && !sub.has(id));
    if (s.concessions) for (const [city, c] of Object.entries(s.concessions)) if (c.holder !== 0 && !ids.has(c.holder)) { const nc: Record<string, { holder: number; until: number }> = { ...s.concessions }; delete nc[city]; s.concessions = nc; }
    if (s.compLots) s.compLots = s.compLots.filter((l) => ids.has(l.holder));
  }
  private rivalryStep(): void {
    const s = this.state; if (!s.sandbox) return;
    const m = this.monthsPassed;
    this.threatStep(m); this.mergeStep(m); this.rivalPick(m); this.cleanGone(); this.updateTaken(); this.storyStep(m);
  }
  private sameRoute = (x: { a: string; b: string }, a: string, b: string) => (x.a === a && x.b === b) || (x.a === b && x.b === a);
  /** 일반 경쟁사가 내 이익 큰 노선에 진출을 예고하고(2개월 전), 때가 되면 들어온다. 제휴를 맺으면 막을 수 있다 */
  private threatStep(m: number): void {
    const s = this.state, th = config.rivalry.threat, B737 = typeById('B737'), dpm = config.daysPerMonth, keep: Threat[] = [];
    for (const t of s.threats ?? []) {
      const c = s.competitors.find((x) => x.id === t.comp);
      if (!c) continue;
      if (m < t.start) { keep.push(t); continue; }
      if (c.id === s.ally) { s.log.push(`${m + 1}개월차: ${c.name}이(가) 제휴 덕분에 ${cityById(t.a).name} ⇄ ${cityById(t.b).name} 진출을 접었습니다.`); continue; }
      if (c.routes.some((x) => this.sameRoute(x, t.a, t.b))) continue;
      const km = distanceKm(cityById(t.a), cityById(t.b));
      c.routes.push({ a: t.a, b: t.b, seatsDay: B737.seats * ((2 * Math.max(1, maxWeeklyRoundTrips(km, B737))) / 7) * 0.8, fareRatio: c.style === 'low' ? 0.85 : 1.15 });
      s.log.push(`${m + 1}개월차: ${c.name}이(가) 예고대로 ${cityById(t.a).name} ⇄ ${cityById(t.b).name} 노선에 진출했습니다.`);
      this.note(m + 1, 'rival', `${c.name}, ${cityById(t.a).name} ⇄ ${cityById(t.b).name} 진출`);
    }
    s.threats = keep;
    for (const c of s.competitors) {
      if (c.major || this.isFriend(c) || c.planes < th.minPlanes || keep.some((x) => x.comp === c.id)) continue;
      if (this.rng.next() >= th.chance * this.mods.rival) continue;
      const cand = s.routes.filter((r) => r.open && this.planesOn(r.id).length > 0 && !c.routes.some((x) => this.sameRoute(x, r.a, r.b)) && this.competitorsOn(r.a, r.b).length < config.competitors.maxOnRoute && canFly(B737, cityById(r.a), cityById(r.b)).ok
        && (r.a === c.hub || r.b === c.hub || c.routes.some((x) => [x.a, x.b].some((id) => id === r.a || id === r.b))))
        .map((r) => { const d = this.routeDay(r); return { r, p: (d.revenue - d.cost) * dpm }; }).filter((x) => x.p > th.minProfit).sort((x, y) => y.p - x.p || x.r.id - y.r.id)[0];
      if (!cand) continue;
      const t: Threat = { comp: c.id, a: cand.r.a, b: cand.r.b, start: m + th.lead }; keep.push(t);
      this.alert(`${m + 1}개월차: ${c.name}이(가) ${cityById(t.a).name} ⇄ ${cityById(t.b).name} 노선 진출을 검토 중입니다(${th.lead}개월 뒤). 제휴를 맺거나 인수하면 막을 수 있습니다.`); this.quote(c, 'threat');
    }
  }
  /** 경쟁사끼리 합병: 큰 회사가 약한 회사(자금난·소형)를 인수한다(대형 항공사도 포함) */
  private mergeStep(m: number): void {
    const s = this.state, mg = config.rivalry.merge, mon = m + 1;
    if (mon < mg.minMonth || this.rng.next() >= mg.chance * this.mods.rival) return;
    const buyer = s.competitors.filter((c) => !c.stake && (c.major || (c.planes >= 5 && c.cash > 20))).sort((a, b) => b.planes - a.planes || a.id - b.id)[0];
    const target = s.competitors.filter((c) => !c.major && !c.stake && c.id !== buyer?.id && ((c.low ?? 0) > 0 || c.planes <= 2)).sort((a, b) => a.planes - b.planes || a.cash - b.cash || a.id - b.id)[0];
    if (!buyer || !target) return;
    const gain = Math.max(0, Math.min(6, target.planes, buyer.major ? config.competitors.major.cap - buyer.planes : 99)); buyer.planes += gain; // 대형 항공사는 상한을 넘지 않는다
    for (const r of target.routes.slice(0, 2)) if (!buyer.routes.some((x) => this.sameRoute(x, r.a, r.b))) buyer.routes.push({ ...r });
    s.competitors = s.competitors.filter((c) => c.id !== target.id); if (s.ally === target.id) s.ally = null;
    s.rivalsGone = [...s.rivalsGone, { name: target.name, month: mon, acq: true, by: buyer.name }].slice(-12);
    this.alert(`${mon}개월차: ${buyer.name}이(가) ${target.name}을(를) 인수·합병했습니다. 시장이 하나로 합쳐졌습니다.`);
    this.note(mon, 'rival', `${buyer.name}, ${target.name} 합병`);
  }
  /** 라이벌: 내 매출과 가장 가까운 일반 경쟁사를 정하고, 앞서고 뒤처지는 순간을 알린다 */
  private rivalPick(m: number): void {
    const s = this.state, mon = m + 1; if (mon < config.rivalry.rival.startMonth) return;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), mine = sum(s.history.slice(-12).map((h) => h.revenue));
    let r = s.competitors.find((c) => c.id === s.rivalId && !c.major && !c.stake);
    if (!r) {
      r = s.competitors.filter((c) => !c.major && !c.stake && (c.revHist?.length ?? 0) >= 1).sort((a, b) => Math.abs(sum(a.revHist!) - mine) - Math.abs(sum(b.revHist!) - mine) || a.id - b.id)[0];
      if (!r) { s.rivalId = null; return; }
      s.rivalId = r.id; s.rivalLead = mine >= sum(r.revHist ?? []);
      s.log.push(`${mon}개월차: 라이벌이 ${r.name}으로 정해졌습니다. 최근 12개월 매출 순위로 승부합니다.`); this.note(mon, 'rival', `라이벌: ${r.name}`);
      return;
    }
    const lead = mine >= sum(r.revHist ?? []);
    if (lead !== s.rivalLead) { s.rivalLead = lead; s.log.push(`${mon}개월차: ${lead ? `라이벌 ${r.name}을(를) 매출에서 앞질렀습니다!` : `라이벌 ${r.name}에게 매출을 추월당했습니다.`}`); this.note(mon, 'rival', lead ? `라이벌 ${r.name} 추월` : `라이벌 ${r.name}에게 추월당함`); }
  }
  /** 라이벌을 직접 정한다 */
  setRival(id: number): Result {
    const c = this.state.competitors.find((x) => x.id === id);
    if (!c || c.major) return fail('라이벌로 정할 수 없는 항공사입니다');
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    this.state.rivalId = id; this.state.rivalLead = sum(this.state.history.slice(-12).map((h) => h.revenue)) >= sum(c.revHist ?? []);
    return { ok: true };
  }
  /** 경쟁사가 도시에 노선을 가진 만큼 그 도시의 빈 슬롯을 선점한다(이미 쓰는 슬롯은 건드리지 않는다) */
  private updateTaken(): void {
    const s = this.state, cnt: Record<string, number> = {}, out: Record<string, number> = {};
    for (const c of s.competitors) for (const r of c.routes) for (const id of [r.a, r.b]) cnt[id] = (cnt[id] ?? 0) + 1;
    for (const l of s.compLots ?? []) cnt[l.city] = cnt[l.city] ?? 0;
    for (const id of Object.keys(s.compSlots ?? {})) cnt[id] = cnt[id] ?? 0;
    for (const [id, n] of Object.entries(cnt)) {
      const want = Math.min(config.rivalry.slots.maxPerCity, Math.floor(n * config.rivalry.slots.perRoute)) + (s.compSlots?.[id] ?? 0) + (s.compLots ?? []).filter((l) => l.city === id).reduce((a, l) => a + l.n, 0) + (s.concessions?.[id] && s.concessions[id].holder !== 0 && s.concessions[id].until > this.monthsPassed ? config.extra.bid.concessionSlots : 0), free = Math.floor(this.slotCapacityRaw(id) - this.slotsUsed(id)), t = Math.min(want, Math.max(0, free));
      if (t > 0) out[id] = t;
    }
    s.taken = out;
  }
  /** 노선에서 경쟁사에 맞서 광고를 낸다: 몇 달간 점유율이 오른다 */
  adRoute(routeId: number): Result {
    const s = this.state, r = this.route(routeId), k = config.rivalry.ad;
    if (s.status !== 'playing') return fail('게임이 끝났습니다');
    if (!r || !r.open) return fail('열려 있는 노선이 아닙니다');
    if (!this.competitorsOn(r.a, r.b).length) return fail('경쟁사가 없는 노선입니다');
    if ((r.ad ?? 0) > 0) return fail('이미 광고 중입니다');
    if (s.cash < k.cost) return fail('현금이 모자랍니다');
    s.cash -= k.cost; s.cur.cost += k.cost; r.ad = k.months; return { ok: true };
  }
  /** 운임 전쟁 대응: 상대 운임 수준으로 맞춘다 */
  matchRivalFare(routeId: number): Result {
    const r = this.route(routeId); if (!r || !r.open) return fail('열려 있는 노선이 아닙니다');
    const cs = this.competitorsOn(r.a, r.b); if (!cs.length) return fail('경쟁사가 없는 노선입니다');
    const lowest = Math.min(...cs.map((x) => x.route.fareRatio));
    return this.setFare(routeId, this.routeBaseFare(r) * lowest);
  }

  // ---------- 이야기 사건(자유 모드) ----------
  storyDef(): StoryDef | undefined { const st = this.state.story; return st ? (config.story.list as unknown as StoryDef[]).find((x) => x.id === st.id) : undefined; }
  private storyStep(m: number): void {
    const s = this.state, k = config.story, list = k.list as unknown as StoryDef[];
    if (s.story) { if (m >= s.story.expires) { const d = this.storyDef(); s.log.push(`${m + 1}개월차: '${d?.title ?? '제안'}' — 답을 미뤄서 기회가 지나갔습니다.`); s.story = null; } return; }
    const due = (s.storyQueue ?? []).find((q) => q.at <= m);
    if (due) { s.storyQueue = (s.storyQueue ?? []).filter((q) => q !== due); const nd = list.find((x) => x.id === due.id); if (nd) { s.story = { id: nd.id, expires: m + k.expires }; s.log.push(`${m + 1}개월차: ${nd.title} — ${nd.desc} (현황 탭에서 ${k.expires}개월 안에 선택)`); return; } }
    if (m + 1 < k.minMonth || this.rng.next() >= k.chance) return;
    const sub = s.competitors.find((c) => (c.stake ?? 0) >= 0.51), pool = list.filter((x) => !x.chain && (!x.needSub || sub));
    const d = pool[this.rng.int(pool.length)]; s.story = { id: d.id, expires: m + k.expires, ...(d.needSub && sub ? { sub: sub.id } : {}) };
    s.log.push(`${m + 1}개월차: ${d.title} — ${d.desc} (현황 탭에서 ${k.expires}개월 안에 선택)`);
  }
  /** 이야기 선택지의 돈: 대형 항공사와의 대결 이야기는 회사 규모 배수만큼 커진다 */
  storyCash(i: number): number { const d = this.storyDef(), c = d?.choices[i]?.cash ?? 0; return d?.id.startsWith('saga') ? Math.round(c * this.megaMult) : c; }
  chooseStory(i: number): Result<{ text: string }> {
    const s = this.state, d = this.storyDef(); if (!d || !s.story) return fail('선택할 이야기가 없습니다');
    const ch = d.choices[i]; if (!ch) return fail('없는 선택입니다');
    const cash = this.storyCash(i);
    if (cash < 0 && s.cash < -cash) return fail('현금이 모자랍니다');
    const m = this.monthsPassed + 1; let text = ch.result;
    s.cash += cash; s.reputation = Math.min(1, Math.max(0, s.reputation + (ch.rep ?? 0)));
    if (ch.slot) { const c = [...CITIES].sort((a, b) => this.linksAt(b.id) - this.linksAt(a.id) || (a.id < b.id ? -1 : 1))[0]; const id = this.linksAt(c.id) > 0 ? c.id : s.base; s.slots[id] = (s.slots[id] ?? 0) + 1; text = `${cityById(id).name} 슬롯 1개를 확보했습니다.`; }
    const sc = s.story.sub !== undefined ? s.competitors.find((x) => x.id === s.story!.sub) : undefined;
    if (ch.subSell && sc && sc.stake) { const bonus = Math.round(this.acquirePrice(sc) * sc.stake * config.subsidiary.priceMult * 0.25 * 10) / 10; const r = this.sellStake(sc.id); if (r.ok) { s.cash += bonus; text = `${ch.result} (매각 $${r.price}M + 웃돈 $${bonus}M)`; } }
    if (ch.risk && this.rng.next() < ch.risk.chance) { if (ch.risk.subCash && sc) sc.cash += ch.risk.subCash; s.cash += ch.risk.cash ?? 0; s.reputation = Math.min(1, Math.max(0, s.reputation + (ch.risk.rep ?? 0))); text = ch.risk.text; }
    if (ch.baseTaken) { s.compSlots = { ...(s.compSlots ?? {}), [s.base]: (s.compSlots?.[s.base] ?? 0) + ch.baseTaken }; this.updateTaken(); } // 대형 항공사가 본사 공항 슬롯을 가져간다
    if (ch.duel) s.duel = { start: this.monthsPassed, until: this.monthsPassed + 12 };
    if (ch.next) s.storyQueue = [...(s.storyQueue ?? []), { id: ch.next.id, at: this.monthsPassed + ch.next.months }];
    s.story = null; s.log.push(`${m}개월차: ${d.title} → ${ch.label}: ${text}`); this.note(m, 'story', `${d.title} → ${ch.label}`);
    return { ok: true, text };
  }

  // ---------- 올해의 도전(자유 모드) ----------
  /** 월말: 새 해가 되면 새 도전을 내고, 진행도를 갱신하고, 달성하면 보상을 준다 */
  private seasonStep(): void {
    const s = this.state, k = config.season, mp = this.monthsPassed; if (!s.sandbox || mp < k.start) return;
    const yr = Math.floor(mp / 12), h = s.history, last = h[h.length - 1];
    if (s.season && s.season.year < yr) { if (!s.season.done) s.log.push(`${mp}개월차: 올해의 도전 '${s.season.text}'을(를) 달성하지 못했습니다.`); s.season = null; }
    if (!s.season) {
      const past = h.slice(-12), avg = Math.max(3, past.reduce((a, x) => a + x.profit, 0) / Math.max(1, past.length));
      const kinds: Season['kind'][] = ['pax', 'profit', 'otp', 'cities'], kind = kinds[this.rng.int(kinds.length)], cash = Math.min(k.rewardMax, Math.max(k.rewardMin, Math.round(avg * k.rewardMonths)));
      const bestPax = Math.max(1, ...past.map((x) => x.pax)), bestProfit = Math.max(1, ...past.map((x) => x.profit));
      const goal = kind === 'pax' ? Math.round((bestPax * 1.08) / 500) * 500 : kind === 'profit' ? Math.round(bestProfit * 1.1 * 10) / 10 : kind === 'otp' ? 0.97 : 2;
      const text = kind === 'pax' ? `올해 안에 한 달 탑승객 ${goal.toLocaleString('en-US')}명 기록` : kind === 'profit' ? `올해 안에 한 달 이익 $${goal}M 기록` : kind === 'otp' ? '올해 안에 한 달 정시율 97% 이상' : '올해 안에 새 도시 2곳에 취항';
      s.season = { year: yr, kind, goal, best: 0, start: this.servedCities().size, done: false, cash, text };
      s.log.push(`${mp + 1}개월차: 올해의 도전 — ${text}. 달성하면 현금 $${cash}M과 평판 보너스(현황 탭).`);
    }
    const se = s.season; if (!se || se.done || !last) return;
    se.best = se.kind === 'pax' ? Math.max(se.best, last.pax) : se.kind === 'profit' ? Math.max(se.best, last.profit) : se.kind === 'otp' ? Math.max(se.best, this.avgOtp) : this.servedCities().size - se.start;
    if (se.best >= se.goal) { se.done = true; s.cash += se.cash; s.reputation = Math.min(1, s.reputation + k.rep); s.log.push(`${mp}개월차: 올해의 도전 달성! '${se.text}' — 현금 $${se.cash}M과 평판 보너스.`); this.note(mp, 'season', `올해의 도전 달성: ${se.text}`); }
  }

  /** 내 노선과 겹칠 때 이 회사가 손님을 빼앗는 힘(제휴·자회사는 약하다) */
  private allyWeight(c: Competitor): number {
    const w = c.stake ? config.subsidiary.weight[String(c.stake)] ?? 1 : 1;
    return Math.min(w, c.id === this.state.ally ? config.ally.weight : 1, this.state.alliance?.includes(c.id) ? this.alliWeight : 1);
  }
  // ---------- 자회사 ----------
  /** 지분 값(지분율 pct까지 가지려면 더 내야 하는 돈) */
  stakePrice(c: Competitor, pct: number): number { return Math.max(1, Math.round(this.acquirePrice(c) * (pct - (c.stake ?? 0)) * config.subsidiary.priceMult * 10) / 10); }
  /** 완전 흡수 가격: 남은 지분만큼 */
  absorbPrice(c: Competitor): number { return Math.round(this.acquirePrice(c) * (1 - (c.stake ?? 0)) * 10) / 10; }
  /** 경쟁사 지분을 산다(20% 또는 51%). 회사는 그대로 운영되고 매달 배당을 받는다. 자유 모드에서만, 대형 항공사는 안 됨 */
  buyStake(id: number, pct: number): Result<{ price: number }> {
    const s = this.state, c = s.competitors.find((x) => x.id === id);
    if (s.status !== 'playing') return fail('게임이 끝났습니다');
    if (!s.sandbox) return fail('자회사는 자유 모드에서만 둘 수 있습니다');
    if (!c) return fail('없는 항공사입니다');
    if (c.major) return fail('대형 항공사의 지분은 살 수 없습니다');
    if (pct !== 0.2 && pct !== 0.51) return fail('지분은 20% 또는 51%입니다');
    if ((c.stake ?? 0) >= pct) return fail('이미 그만큼 지분을 가지고 있습니다');
    const price = this.stakePrice(c, pct);
    if (s.cash < price) return fail('현금이 모자랍니다');
    s.cash -= price; c.cash += price * 0.5; c.stake = pct; if (s.alliance?.includes(id)) s.alliance = s.alliance.filter((x) => x !== id); if (pct >= 0.51 && !c.dir) c.dir = 'grow'; // 낸 돈의 절반은 회사 운영 자금으로 들어간다
    if (s.ally === id) s.ally = null; // 자회사는 제휴보다 가까운 관계
    if (s.rivalId === id) { s.rivalId = null; this.note(this.monthsPassed + 1, 'rival', `라이벌 ${c.name}을(를) 자회사로`); }
    s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}의 지분 ${Math.round(pct * 100)}%를 $${price}M에 샀습니다. ${pct >= 0.51 ? '경영권을 가진 자회사가 되어 운영 방향을 정할 수 있습니다.' : '매달 이익의 일부를 배당으로 받습니다.'}`);
    this.note(this.monthsPassed + 1, 'rival', `${c.name} 지분 ${Math.round(pct * 100)}% 확보`);
    return { ok: true, price };
  }
  /** 51% 자회사의 운영 방향 */
  setSubDir(id: number, dir: 'grow' | 'profit' | 'attack'): Result {
    const c = this.state.competitors.find((x) => x.id === id);
    if (!c || (c.stake ?? 0) < 0.51) return fail('경영권(51%)을 가진 자회사만 방향을 정할 수 있습니다');
    if (!config.subsidiary.dirs[dir]) return fail('없는 방향입니다');
    c.dir = dir; return { ok: true };
  }
  /** 지분을 판다 */
  sellStake(id: number): Result<{ price: number }> {
    const s = this.state, c = s.competitors.find((x) => x.id === id);
    if (!c || !c.stake) return fail('지분이 없습니다');
    const price = Math.round(this.acquirePrice(c) * c.stake * config.subsidiary.priceMult * config.subsidiary.sellRatio * 10) / 10;
    s.cash += price; s.log.push(`${this.monthsPassed + 1}개월차: ${c.name} 지분 ${Math.round(c.stake * 100)}%를 $${price}M에 팔았습니다.`);
    this.returnLent(c); delete c.stake; delete c.dir; delete c.call; delete c.target; delete c.region;
    return { ok: true, price };
  }
  /** 공세 대상 회사(null이면 자동) */
  setSubTarget(id: number, target: number | null): Result {
    const c = this.state.competitors.find((x) => x.id === id);
    if (!c || (c.stake ?? 0) < 0.51) return fail('경영권(51%)을 가진 자회사만 정할 수 있습니다');
    if (target === null) { delete c.target; return { ok: true }; }
    const t = this.state.competitors.find((x) => x.id === target);
    if (!t || t.id === id || t.stake) return fail('공세 대상으로 정할 수 없는 회사입니다');
    c.target = target; return { ok: true };
  }
  /** 확장 지역(null이면 자유) */
  setSubRegion(id: number, region: string | null): Result {
    const c = this.state.competitors.find((x) => x.id === id);
    if (!c || (c.stake ?? 0) < 0.51) return fail('경영권(51%)을 가진 자회사만 정할 수 있습니다');
    if (region === null) { delete c.region; return { ok: true }; }
    if (!CITIES.some((x) => x.region === region)) return fail('없는 지역입니다');
    c.region = region; return { ok: true };
  }
  /** 노는 내 항공기를 51% 자회사에 빌려준다: 매달 임대료를 받고, 자회사는 그만큼 커진다 */
  lendPlane(planeId: number, id: number): Result<{ rent: number }> {
    const s = this.state, c = s.competitors.find((x) => x.id === id), p = this.plane(planeId);
    if (!c || (c.stake ?? 0) < 0.51) return fail('경영권(51%)을 가진 자회사에만 빌려줄 수 있습니다');
    if (!p) return fail('없는 항공기입니다');
    if (p.routeId !== null || p.shop > 0) return fail('노선에 배정되지 않고 정비 중이 아닌 항공기만 빌려줄 수 있습니다');
    if (p.charter !== undefined) return fail('전세 운항 중인 항공기입니다');
    if (p.leased) return fail('임대해 온 항공기는 다시 빌려줄 수 없습니다');
    if (typeById(p.type).seats <= 0) return fail('화물기는 빌려줄 수 없습니다');
    s.planes = s.planes.filter((x) => x.id !== planeId);
    c.lent = [...(c.lent ?? []), { type: p.type, book: p.book, age: p.age }];
    this.compBuy(c, this.month, true);
    const rent = Math.round(typeById(p.type).price * config.lease.rate * config.subsidiary.lendRate * 100) / 100;
    s.log.push(`${this.monthsPassed + 1}개월차: ${typeById(p.type).name}을(를) 자회사 ${c.name}에 빌려주었습니다(월 임대료 $${rent}M).`);
    return { ok: true, rent };
  }
  /** 빌려준 항공기 한 대를 돌려받는다(자회사의 좌석이 그만큼 준다) */
  recallPlane(id: number): Result {
    const s = this.state, c = s.competitors.find((x) => x.id === id);
    if (!c || !c.lent?.length) return fail('빌려준 항공기가 없습니다');
    const l = c.lent[c.lent.length - 1]; c.lent = c.lent.slice(0, -1);
    const f = c.planes > 1 ? (c.planes - 1) / c.planes : 1; c.planes = Math.max(1, c.planes - 1);
    for (const r of c.routes) r.seatsDay = Math.round(r.seatsDay * f);
    this.addPlane(l.type, l.book, { age: l.age, cond: 0.7 });
    s.log.push(`${this.monthsPassed + 1}개월차: 자회사 ${c.name}에 빌려준 ${typeById(l.type).name}을(를) 돌려받았습니다(대기 중).`);
    return { ok: true };
  }
  private returnLent(c: Competitor): void {
    for (const l of c.lent ?? []) this.addPlane(l.type, l.book, { age: l.age, cond: 0.7 });
    if (c.lent?.length) this.state.log.push(`${this.monthsPassed + 1}개월차: ${c.name}에 빌려준 항공기 ${c.lent.length}대를 돌려받았습니다(대기 중).`);
    delete c.lent;
  }
  /** 이 도시 쌍의 시장 몫(추정): 우리·각 경쟁사. 화면용 */
  marketShares(a: string, b: string): { id: number; name: string; share: number; me: boolean; stake?: number }[] {
    const s = this.state, A = cityById(a), B = cityById(b), base = baseFare(distanceKm(A, B)), out: { id: number; name: string; w: number; me: boolean; stake?: number }[] = [];
    const mine = s.routes.find((x) => x.open && ((x.a === a && x.b === b) || (x.a === b && x.b === a)) && this.planesOn(x.id).length > 0);
    if (mine) out.push({ id: 0, name: '우리', w: this.routeDay(mine).seats * (base / Math.max(1, mine.fare)) * (1 + config.demand.repBoost * s.reputation), me: true });
    for (const { comp, route } of this.competitorsOn(a, b)) {
      const atk = !comp.stake && s.competitors.some((x) => x.dir === 'attack' && x.stake && x.routes.some((y) => (y.a === a && y.b === b) || (y.a === b && y.b === a)));
      out.push({ id: comp.id, name: comp.name, w: route.seatsDay / Math.max(0.3, route.fareRatio) * this.quality(comp) * (atk ? 0.75 : 1), me: false, stake: comp.stake });
    }
    const tot = out.reduce((x, y) => x + y.w, 0) || 1;
    return out.map(({ w, ...o }) => ({ ...o, share: w / tot }));
  }
  /** 그룹(우리 + 51% 자회사) 최근 12개월 매출 순위 */
  groupRank(): { rank: number; total: number; revenue: number } {
    const s = this.state, sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
    const group = sum(s.history.slice(-12).map((h) => h.revenue)) + sum(s.competitors.filter((c) => (c.stake ?? 0) >= 0.51).map((c) => sum(c.revHist ?? [])));
    const others = s.competitors.filter((c) => (c.stake ?? 0) < 0.51).map((c) => sum(c.revHist ?? []));
    return { rank: 1 + others.filter((v) => v > group).length, total: others.length + 1, revenue: group };
  }
  /** 증자 요청에 응한다 */
  fundSubsidiary(id: number): Result<{ price: number }> {
    const s = this.state, c = s.competitors.find((x) => x.id === id);
    if (!c || !c.call) return fail('증자 요청이 없습니다');
    if (s.cash < c.call.amount) return fail('현금이 모자랍니다');
    s.cash -= c.call.amount; c.cash += c.call.amount / (c.stake ?? 1); c.low = 0; // 다른 주주도 지분만큼 함께 넣는다
    const price = c.call.amount; delete c.call;
    s.log.push(`${this.monthsPassed + 1}개월차: 자회사 ${c.name}에 $${price}M을 증자했습니다.`);
    return { ok: true, price };
  }
  /** 자회사 한 달: 이익이면 배당을 받고, 돈이 마르면 증자를 요청한다 */
  private subsidiaryMonth(c: Competitor, net: number): void {
    const s = this.state, k = config.subsidiary, m = this.monthsPassed;
    if (net > 0 && c.cash > 0) { const div = Math.round(net * c.stake! * (k.payout[c.dir ?? 'none'] ?? 0.4) * 100) / 100; if (div > 0) { c.cash -= div; s.cash += div; s.cur.revenue += div; s.cur.div = (s.cur.div ?? 0) + div; } c.lastDiv = div > 0 ? div : 0; c.divTotal = Math.round(((c.divTotal ?? 0) + Math.max(0, div)) * 100) / 100; } else c.lastDiv = 0;
    const rent = (c.lent ?? []).reduce((a, l) => a + typeById(l.type).price * config.lease.rate * k.lendRate, 0);
    c.lastRent = 0;
    if (rent > 0 && c.cash > 0) { const pay = Math.round(Math.min(rent, c.cash) * 100) / 100; c.cash -= pay; s.cash += pay; s.cur.revenue += pay; c.lastRent = pay; }
    if (c.call && m >= c.call.expires) { delete c.call; s.log.push(`${m + 1}개월차: 자회사 ${c.name}의 증자 요청 기한이 지났습니다. 자금난이 이어지면 파산할 수 있습니다.`); }
    if (!c.call && c.cash < 0) {
      const amount = Math.round(Math.min(k.callMax, -c.cash + 10) * c.stake! * 10) / 10;
      c.call = { amount, expires: m + k.callMonths };
      this.alert(`${m + 1}개월차: 자회사 ${c.name}이(가) 자금난으로 $${amount}M 증자를 요청했습니다(${k.callMonths}개월 안에, 경쟁사 탭).`);
    }
  }
  /** 경쟁사 인수 가격(자금난이면 싸다) */
  acquirePrice(c: Competitor): number {
    const k = config.acquire;
    return Math.round(Math.max(k.min, (c.planes * typeById('B737').price * k.perPlane + c.routes.length * k.perRoute) * ((c.low ?? 0) > 0 ? k.distress : 1)) * 10) / 10;
  }
  /** 경쟁사를 인수한다: 그 회사는 사라지고, 항공기(중고)·거점 슬롯·평판을 받는다. 대형 항공사는 인수할 수 없다 */
  acquireCompetitor(id: number): Result<{ price: number; planes: number }> {
    const s = this.state;
    if (s.status !== 'playing') return fail('게임이 끝났습니다');
    const c = s.competitors.find((x) => x.id === id);
    if (!c) return fail('없는 항공사입니다');
    if (c.major) return fail('대형 항공사는 인수할 수 없습니다');
    const price = this.absorbPrice(c);
    if (s.cash < price) return fail('현금이 모자랍니다');
    const k = config.acquire, n = Math.min(k.maxPlanes, c.planes), m = this.monthsPassed + 1;
    s.cash -= price; this.returnLent(c); s.competitors = s.competitors.filter((x) => x.id !== id); if (s.ally === id) s.ally = null;
    s.acquired = (s.acquired ?? 0) + 1; if (s.rivalId === id) s.rivalId = null; this.cleanGone();
    s.rivalsGone = [...s.rivalsGone, { name: c.name, month: m, acq: true }].slice(-12);
    for (let i = 0; i < n; i++) this.addPlane('B737', typeById('B737').price * 0.5, { age: 48, cond: 0.7 });
    s.slots[c.hub] = (s.slots[c.hub] ?? 0) + k.slots; s.reputation = Math.min(1, s.reputation + k.rep);
    this.note(m, 'rival', `${c.name} 인수($${price}M)`);
    s.log.push(`${m}개월차: ${c.name}을(를) $${price}M에 인수했습니다. 항공기 ${n}대와 ${cityById(c.hub).name} 슬롯 ${k.slots}개를 받았습니다(항공기는 노선에 배정해야 합니다).`);
    return { ok: true, price, planes: n };
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
    for (const id of [aId, bId]) if (!this.cityOpen(id)) return fail(`${cityById(id).name}은(는) ${this.regionName(cityById(id).region)} 지역이라 운수권이 필요합니다. 현황 탭의 '지역 운수권'에서 살 수 있습니다.`);
    const A = cityById(aId), B = cityById(bId);
    const ex = this.state.routes.find((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId));
    if (ex) {
      if (ex.open) return { ok: true, routeId: ex.id };
      const k = config.reopen, fee = ex.closed !== undefined && this.monthsPassed - ex.closed < k.months ? k.fee : 0; // 닫은 지 얼마 안 된 노선을 다시 열면 비용이 든다
      if (this.state.cash < fee) return fail(`노선을 닫은 지 ${k.months}개월이 안 돼 재개 비용 $${fee}M이 듭니다(현금 모자람)`);
      this.state.cash -= fee; this.state.cur.cost += fee; ex.open = true; delete ex.closed;
      return { ok: true, routeId: ex.id };
    }
    const base = baseFare(distanceKm(A, B));
    const r: Route = { id: this.state.nextId++, a: aId, b: bId, fare: Math.round(base), fareBiz: Math.round(base * config.cabin.bizFareMult), cargoRatio: 1, open: true, daily: [], priority: 1 };
    this.state.routes.push(r);
    return { ok: true, routeId: r.id };
  }
  closeRoute(routeId: number): Result {
    const r = this.route(routeId);
    if (!r) return fail('없는 노선입니다');
    const served = this.planesOn(routeId).length > 0;
    for (const p of this.planesOn(routeId)) { p.routeId = null; p.weekly = 0; }
    if (r.open) { r.closed = this.monthsPassed; if (served) this.state.reputation = Math.max(0, this.state.reputation - config.reopen.rep); } // 운항하던 노선을 닫으면 평판이 조금 떨어진다
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
    if (this.plane(planeId)?.charter !== undefined) return fail('전세 운항 중인 항공기입니다');
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
    if (s.day % 7 === 0 && s.autoFreq) for (const r of s.routes) if (r.open) this.autoFreqStep(r);
    if (s.day % 7 === 0) for (const r of s.routes) if (r.open && (s.autoFare || r.stance === 'share') && this.planesOn(r.id).length) this.fillFare(r.id); // 자동 운임·점유율 우선: 매주
    for (const r of s.routes) {
      if (!r.open) continue;
      const d = this.routeDay(r);
      s.cash += d.revenue - d.cost;
      s.cur.revenue += d.revenue; s.cur.cost += d.cost; s.cur.pax += d.pax; s.cur.seats += d.seats;
      const st: DayStat = { pax: d.pax, seats: d.seats, profit: d.revenue - d.cost, cargo: d.cargoT, otp: d.otp, ...(this.planesOn(r.id).length ? { share: d.share } : {}) };
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
      if ((t.from ?? 0) > 0 && mp === t.from) { s.log.push(`${mp + 1}개월차: 신기종 출시 — ${t.name}(${t.cls})을(를) 이제 살 수 있습니다.`); this.note(mp + 1, 'release', `신기종 출시: ${t.name}`); this.deliverPreorders(t.id); }
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
      const pool = EVENTS.filter((e) => !e.scheduled && (!e.sandboxOnly || s.sandbox) && (!e.season || e.season.includes(this.month)) && this.monthsPassed >= (e.minMonth ?? 0)), def = pool[this.rng.int(pool.length)];
      let city: string | undefined;
      if (def.snowCities) city = def.snowCities[this.rng.int(def.snowCities.length)];
      if (def.boomCities) city = def.boomCities[this.rng.int(def.boomCities.length)];
      let planeId: number | undefined;
      if (def.effect.ground) { const fleet = s.planes.filter((p) => p.routeId !== null); if (fleet.length) planeId = fleet[this.rng.int(fleet.length)].id; }
      if (!def.effect.ground || planeId !== undefined) {
        s.events.push({ def: def.id, monthsLeft: def.months, city, planeId });
        if (def.effect.cash) s.cash += def.effect.cash;
        this.alert(`${this.monthsPassed + 1}개월차: ${def.name}${city ? ` (${cityById(city).name})` : ''}${planeId !== undefined ? ` (${typeById(this.plane(planeId)!.type).name})` : ''} — ${def.text}`);
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
    this.rivalryStep();
  }

  /** 경쟁사 한 달: 추정 이익을 현금에 더하고, 현금이 되면 항공기를 늘린다(노선 신설 또는 증편). 난수 없이 점수로만 고른다 */
  private competitorStep(): void {
    const s = this.state, k = config.competitors, month = this.month;
    const B737 = typeById('B737'), eco = s.economy ?? 1, fuelMult = 1 - config.fuel.share + config.fuel.share * (s.fuel ?? 1); // 경쟁사는 불황과 연료비에 그대로 흔들린다(우리의 연료 계약은 적용되지 않는다)
    for (const c of s.competitors) {
      if (s.sandbox && !c.trait && !c.major) c.trait = TRAIT_IDS[(c.id * 7 + c.hub.charCodeAt(0)) % TRAIT_IDS.length]; // 성격은 ID로 정해진다(난수 없음)
      const tr = this.traitOf(c);
      const capNow = s.sandbox ? Math.min(k.sandboxCap, k.maxPlanesCap + Math.floor(this.monthsPassed / k.capGrowMonths)) : k.maxPlanesCap; // 자유 모드는 시간이 갈수록 경쟁사도 더 커질 수 있다
      const maxPlanes = Math.min(capNow, Math.floor((k.maxPlanesBase + k.maxPlanesPerMonth * (this.monthsPassed - (c.born ?? 0))) * (tr?.planes ?? 1) * (c.dir === 'grow' ? 1.2 : 1))); // 늦게 생긴 항공사는 처음부터 다시 키운다
      let profit = 0, revenue = 0;
      for (const r of c.routes) {
        const A = cityById(r.a), B = cityById(r.b), km = distanceKm(A, B), base = baseFare(km), fare = base * r.fareRatio;
        const mine = s.routes.find((x) => x.open && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)));
        const myW = mine && this.planesOn(mine.id).length ? this.routeDay(mine).seats * (base / Math.max(1, mine.fare)) : 0;
        const atk = !c.stake && s.competitors.some((x) => x.dir === 'attack' && x.stake && x.routes.some((y) => (y.a === r.a && y.b === r.b) || (y.a === r.b && y.b === r.a)));
        const wc = r.seatsDay / Math.max(0.3, r.fareRatio) * this.quality(c), share = (wc / (wc + myW || 1)) * (atk ? 0.75 : 1); // 내 공세 자회사와 겹치면 손님을 빼앗긴다
        const dem = (rawMonthlyDemand(A, B, month, this.growthOf(r.a), this.growthOf(r.b)) * eco * priceFactor(fare, base) * share) / config.daysPerMonth;
        const pax = Math.min(dem, r.seatsDay * 0.9);
        r.rev = Math.round((pax * fare * config.daysPerMonth) / 1e4) / 100; r.share = Math.round(share * 1000) / 1000; r.lost = atk ? Math.round((share / 0.75) * 0.25 * 1000) / 1000 : 0; // 화면용 노선별 기록(추정)
        revenue += (pax * fare * config.daysPerMonth) / 1e6;
        profit += (pax * fare * (1 - Math.min(1.2, (k.costRatio * fuelMult) / (c.eff ?? 1))) * config.daysPerMonth) / 1e6; // 비용 비율은 연료비가 오르면 커지고 효율이 낮으면 더 커진다(적자 가능)
      }
      // 가격 반응: 우리가 같은 노선에서 더 싸게 팔면 따라 내리고(바닥까지), 아니면 천천히 목표 가격으로 돌아간다
      const rv = config.rival, floor = c.style === 'low' ? rv.lowFloor : rv.premFloor, target = c.style === 'low' ? rv.lowTarget : rv.premTarget;
      for (const r of c.routes) {
        const mine = s.routes.find((x) => x.open && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)));
        const pf = mine && this.planesOn(mine.id).length ? mine.fare / this.routeBaseFare(mine) : null;
        if (r.war) { r.war--; if (r.war <= 0) { delete r.war; s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) ${cityById(r.a).name} ⇄ ${cityById(r.b).name} 운임 전쟁을 끝냈습니다.`); } continue; } // 전쟁 중에는 운임을 바닥에 둔다
        if (pf !== null && pf < r.fareRatio - 0.05 && !this.isFriend(c)) r.fareRatio = Math.max(floor, r.fareRatio - rv.step);
        else if (r.fareRatio < target) r.fareRatio = Math.min(target, r.fareRatio + rv.upStep);
        else if (r.fareRatio > target) r.fareRatio = Math.max(target, r.fareRatio - rv.upStep);
      }
      // 운임 전쟁: 우리와 겹치는 노선 하나에서 운임을 크게 내린다(제휴사는 걸어오지 않는다)
      if (!this.isFriend(c) && !c.routes.some((r) => r.war)) {
        const over = c.routes.filter((r) => s.routes.some((x) => x.open && this.planesOn(x.id).length && ((x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a))));
        if (over.length && this.rng.next() < config.war.chance * this.mods.event * (c.major ? k.major.warMult : 1) * (this.eraNow?.war ?? 1) * (tr?.war ?? 1)) {
          const r = over[this.rng.int(over.length)]; r.war = config.war.months; r.fareRatio = config.war.ratio;
          this.alert(`${this.monthsPassed + 1}개월차: 운임 전쟁 — ${c.name}이(가) ${cityById(r.a).name} ⇄ ${cityById(r.b).name} 노선 운임을 ${config.war.months}개월간 크게 내렸습니다. 운임을 따라 내리거나, 버티거나, 제휴를 맺으세요.`); this.quote(c, 'war');
        }
      }
      c.revHist = [...(c.revHist ?? []), revenue].slice(-12);
      c.pHist = [...(c.pHist ?? [c.planes]), c.planes].slice(-13); // 항공기 수 기록(화면의 증감 표시용)
      const net = profit * (s.sandbox ? k.profitScale : 1) - k.planeFixed * c.planes;
      c.cash += net;
      if (c.stake) { this.subsidiaryMonth(c, net); c.hist = [...(c.hist ?? []), { rev: Math.round(revenue * 100) / 100, profit: Math.round(net * 100) / 100, planes: c.planes }].slice(-12); } // profitScale: 모형에 없는 노선·부대 수입까지 포함한 몫(1이면 노선 하나 분만 계산)
      if (!c.major && c.planes > 0 && this.rng.next() < k.shockChance * (tr?.shock ?? 1)) { // 경영 충격: 사고·파업·리콜·소송으로 큰돈이 나간다(현금이 얇은 항공사는 이것 하나로 무너질 수 있다)
        const loss = Math.round(k.shockMin + this.rng.next() * (k.shockMax - k.shockMin)), why = ['대형 사고 보상금', '장기 파업', '엔진 리콜', '소송 패소'][this.rng.int(4)];
        c.cash -= loss; s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) ${why}으로 $${loss}M 손실을 입었습니다.`);
      }
      c.low = c.cash < 0 ? (c.low ?? 0) + 1 : 0;
      if (c.major) { // 대형 항공사: 시장(시간·내 항공기 수)에 맞춰 돈과 상관없이 커지고, 파산하지 않는다
        c.cash = Math.max(c.cash, 50); c.low = 0;
        const M = k.major, target = Math.min(M.cap, Math.floor(M.base + M.perMonth * this.monthsPassed + M.perPlayerPlane * s.planes.length));
        for (let i = 0; i < M.addPerMonth && c.planes < target; i++) this.compBuy(c, month, true);
      } else if (c.cash >= B737.price * (s.sandbox ? k.buyRatio : 1) * (tr?.buy ?? 1) * (c.dir === 'grow' ? 0.7 : c.dir === 'profit' ? 1.5 : 1) && c.planes < maxPlanes) this.compBuy(c, month);
    }
  }

  /** 경쟁사가 B737 한 대를 늘린다(free면 돈을 내지 않는다). 새 노선(허브에서 출발) 또는 증편. 대형 항공사는 가끔 내 노선으로 진출한다 */
  private compBuy(c: Competitor, month: number, free = false): void {
    const s = this.state, B737 = typeById('B737');
    if (!free) c.cash -= B737.price * (s.sandbox ? config.competitors.buyRatio : 1); // 나머지는 할부·리스로 처리했다고 본다
    c.planes++;
    if (!free && !c.major && (c.planes === 5 || c.planes === 10)) s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) 항공기 ${c.planes}대를 돌파했습니다(노선 확장 중).`);
    const legsDay = (km: number) => (2 * Math.max(1, maxWeeklyRoundTrips(km, B737))) / 7 * 0.8 * (c.major ? config.competitors.major.seatMult : 1) * (c.founded === 'regional' ? config.extra.found.regionalSeat : 1), style = c.style === 'low' ? 0.85 : 1.15; // 대형 항공사는 대형기를 섞어 쓴다(좌석 2배)
    if (c.major && this.rng.next() < config.competitors.major.invadeChance) { // 내 노선 중 이익이 큰 곳으로 들어온다
      const mine = s.routes.filter((r) => r.open && this.planesOn(r.id).length > 0).map((r) => { const d = this.routeDay(r); return { r, p: d.revenue - d.cost }; }).sort((x, y) => y.p - x.p || x.r.id - y.r.id);
      for (const { r } of mine) {
        if (c.routes.some((x) => (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)) || !canFly(B737, cityById(r.a), cityById(r.b)).ok || (s.sandbox && this.competitorsOn(r.a, r.b).length >= config.competitors.maxOnRoute)) continue;
        c.routes.push({ a: r.a, b: r.b, seatsDay: B737.seats * legsDay(distanceKm(cityById(r.a), cityById(r.b))), fareRatio: style });
        s.log.push(`${this.monthsPassed + 1}개월차: ${c.name}이(가) ${cityById(r.a).name} ⇄ ${cityById(r.b).name} 노선에 진출했습니다. 내 노선과 겹칩니다.`);
        return;
      }
    }
    if (c.stake && c.dir === 'attack') { // 공세 자회사: 다른 경쟁사의 노선 중 아직 안 가는 곳으로 들어간다
      const tgt = s.competitors.some((y) => y.id === c.target) ? c.target : undefined;
      const opp = s.competitors.filter((x) => x.id !== c.id && !x.stake && (tgt === undefined || x.id === tgt)).flatMap((x) => x.routes).filter((r) => !c.routes.some((y) => (y.a === r.a && y.b === r.b) || (y.a === r.b && y.b === r.a)) && canFly(B737, cityById(r.a), cityById(r.b)).ok).sort((x, y) => y.seatsDay - x.seatsDay || (x.a + x.b < y.a + y.b ? -1 : 1))[0];
      if (opp) { c.routes.push({ a: opp.a, b: opp.b, seatsDay: B737.seats * legsDay(distanceKm(cityById(opp.a), cityById(opp.b))), fareRatio: 0.9, atk: true }); s.log.push(`${this.monthsPassed + 1}개월차: 자회사 ${c.name}이(가) ${cityById(opp.a).name} ⇄ ${cityById(opp.b).name} 노선에 공세로 진출했습니다.`); return; }
    }
    // 아직 안 열린 최고 점수 노선(허브에서 출발, 항속 범위 안)
    const best = this.compBest(c, month);
    const addTo = c.routes.length >= Math.ceil(c.planes / 2) ? c.routes[0] : undefined; // 노선 수가 비행기의 절반을 넘으면 증편
    if (best && !addTo) c.routes.push({ a: c.hub, b: best.b, seatsDay: B737.seats * legsDay(distanceKm(cityById(c.hub), cityById(best.b))), fareRatio: style });
    else if (c.routes.length) { const r = c.routes[(c.planes - 1) % c.routes.length]; r.seatsDay += B737.seats * legsDay(distanceKm(cityById(r.a), cityById(r.b))); }
  }
  /** 경쟁사가 다음에 열 노선(허브에서 출발, 아직 안 연 곳 중 점수 최고). 난수 없음 */
  compBest(c: Competitor, month = this.month): { b: string; score: number } | null {
    const s = this.state, B737 = typeById('B737');
    let best: { b: string; score: number } | null = null;
    for (const only of c.region ? [true, false] : [false]) { // 자회사에 확장 지역을 정했으면 그 지역 도시부터
      for (const d of CITIES) {
        if (only && d.region !== c.region) continue;
        if (d.id === c.hub || !canFly(B737, cityById(c.hub), d).ok || c.routes.some((r) => (r.a === c.hub && r.b === d.id) || (r.b === c.hub && r.a === d.id))) continue;
        const km = distanceKm(cityById(c.hub), d), others = s.competitors.filter((x) => x.id !== c.id && x.routes.some((r) => (r.a === c.hub && r.b === d.id) || (r.b === c.hub && r.a === d.id))).length + (s.routes.some((r) => r.open && ((r.a === c.hub && r.b === d.id) || (r.b === c.hub && r.a === d.id))) ? 1 : 0);
        if (c.founded === 'regional' && km > config.extra.found.regionalKm) continue; // 지역 항공사는 단거리만
        const sc = rawMonthlyDemand(cityById(c.hub), d, month) / (1 + km / 6000) / (s.sandbox ? 1 + config.competitors.crowd * others : 1); // 자유 모드: 붐비는 노선은 피한다
        if (!best || sc > best.score || (sc === best.score && d.id < best.b)) best = { b: d.id, score: sc };
      }
      if (best) break;
    }
    return best;
  }
  foundCost(size: number): number { return config.extra.found.capital[size] ?? 0; }
  /** 자회사 차리기: 거점·형태·자본금을 정해 새 항공사를 세운다(지분 100%, 운영은 51% 자회사와 같다) */
  foundSubsidiary(o: { name: string; hub: string; kind: 'low' | 'premium' | 'regional'; size: number }): Result<{ id: number }> {
    const s = this.state, k = config.extra.found, name = o.name.replace(/[<>&"']/g, '').trim();
    if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (name.length < 1 || name.length > 16) return fail('이름은 1~16자로 지어 주세요');
    if (s.competitors.some((c) => c.name === name)) return fail('같은 이름의 항공사가 있습니다');
    if (!CITIES.some((c) => c.id === o.hub) || !this.cityOpen(o.hub)) return fail('거점으로 고를 수 없는 도시입니다(운수권 확인)');
    if (!k.kinds[o.kind] || !(o.size in k.capital)) return fail('형태나 자본금을 골라 주세요');
    if (s.competitors.filter((c) => c.founded).length >= k.max) return fail(`직접 차린 자회사는 ${k.max}곳까지입니다`);
    const cost = this.foundCost(o.size); if (s.cash < cost) return fail('현금이 모자랍니다');
    s.cash -= cost; s.cur.cost += cost;
    const c: Competitor = { id: s.nextRival++, name, style: o.kind === 'premium' ? 'premium' : 'low', hub: o.hub, cash: Math.round(cost * k.cashShare), planes: 0, routes: [], born: this.monthsPassed, eff: k.kinds[o.kind].eff, low: 0, stake: 1, dir: 'grow', founded: o.kind };
    s.competitors.push(c);
    for (let i = 0; i < k.planes[o.size]; i++) this.compBuy(c, this.month, true);
    s.log.push(`${this.monthsPassed + 1}개월차: 자회사 ${name}(${k.kinds[o.kind].name}, ${cityById(o.hub).name} 거점)을 세웠습니다. 항공기 ${c.planes}대·노선 ${c.routes.length}개로 출발합니다($${cost}M).`); this.note(this.monthsPassed + 1, 'invest', `자회사 ${name} 창업`);
    return { ok: true, id: c.id };
  }
  // ---- 후반: 왕조 목표·자체 기종 기술료·내 공항 사용료·상장·정부 정책·동맹 순위전·경쟁사 대사 ----
  private quote(c: Competitor, kind: string): void {
    if (!this.state.sandbox) return; const q = config.extra.quotes[kind]?.[c.style]; if (!q?.length) return;
    this.state.log.push(`${this.monthsPassed + 1}개월차: ${c.name} 대표 — "${q[(c.id + this.monthsPassed) % q.length]}"`);
  }
  /** 왕조 목표 달성 여부(지금 상태 기준) */
  dynastyMet(id: string): boolean {
    const s = this.state, sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    if (id === 'world1') return this.monthsPassed >= 12 && this.rank() === 1;
    if (id === 'regions') { const served = this.servedCities(); return Object.keys(config.rights.regions).every((r) => CITIES.some((c) => c.region === r && served.has(c.id))); }
    if (id === 'group') return sum(s.history.slice(-12).map((h) => h.revenue)) + sum(s.competitors.filter((c) => (c.stake ?? 0) >= 0.51).map((c) => sum((c.hist ?? []).map((x) => x.rev)))) >= 3000;
    if (id === 'fleet') return s.planes.length >= 100;
    return false;
  }
  setDynasty(id: string): Result {
    const s = this.state, k = config.extra.dynasty; if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!k.list[id]) return fail('없는 목표입니다'); if (s.dynasty) return fail('이미 도전 중인 목표가 있습니다'); if (s.dynastyDone?.includes(id)) return fail('이미 이룬 목표입니다');
    s.dynasty = { id, until: this.monthsPassed + k.months }; s.log.push(`${this.monthsPassed + 1}개월차: 왕조 목표 '${k.list[id].name}'에 도전합니다(${k.months / 12}년 안).`); return { ok: true };
  }
  /** 왕조 목표 진행: 지금 값·목표·단위 */
  dynastyProgress(id: string): { v: number; t: number; text: string } {
    const s = this.state, sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    if (id === 'world1') { const r = this.rank(); return { v: Math.max(0, 6 - r), t: 5, text: `지금 매출 ${r}위` }; }
    if (id === 'regions') { const served = this.servedCities(), all = Object.keys(config.rights.regions), n = all.filter((r) => CITIES.some((c) => c.region === r && served.has(c.id))).length; return { v: n, t: all.length, text: `${n}/${all.length}개 지역` }; }
    if (id === 'group') { const v = sum(s.history.slice(-12).map((h) => h.revenue)) + sum(s.competitors.filter((c) => (c.stake ?? 0) >= 0.51).map((c) => sum((c.hist ?? []).map((x) => x.rev)))); return { v, t: 3000, text: `그룹 연 매출 $${Math.round(v)}M / $3,000M` }; }
    if (id === 'fleet') return { v: s.planes.length, t: 100, text: `항공기 ${s.planes.length}/100대` };
    return { v: 0, t: 1, text: '' };
  }
  /** 자체 기종 이름 짓기 */
  nameOwnType(id: string, name: string): Result {
    const s = this.state, n = name.replace(/[<>&"']/g, '').trim(); if (!s.ownTypes?.includes(id)) return fail('개발을 마친 자체 기종이 아닙니다');
    if (n.length < 1 || n.length > 16) return fail('이름은 1~16자로 지어 주세요');
    s.ownNames = { ...(s.ownNames ?? {}), [id]: n }; applyOwnNames(s.ownNames); return { ok: true };
  }
  giveUpDynasty(): Result { if (!this.state.dynasty) return fail('도전 중인 목표가 없습니다'); this.state.dynasty = null; return { ok: true }; }
  /** 회사 가치: 항공기 장부가 + 최근 12개월 이익 × 8(적자면 0) */
  get companyValue(): number { const s = this.state, p12 = s.history.slice(-12).reduce((a, h) => a + h.profit, 0); return Math.max(50, Math.round(s.planes.reduce((a, p) => a + p.book, 0) + Math.max(0, p12) * config.extra.ipo.pe)); }
  goPublic(): Result<{ cash: number }> {
    const s = this.state, k = config.extra.ipo; if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (s.ipo) return fail('이미 상장했습니다'); if (this.monthsPassed < k.minMonth) return fail(`${k.minMonth / 12}년차부터 상장할 수 있습니다`);
    const cash = Math.round(this.companyValue * k.share), base = s.history.slice(-12).reduce((a, h) => a + h.profit, 0);
    s.cash += cash; s.ipo = { month: this.monthsPassed, price: 100, base, hist: [100] };
    s.log.push(`${this.monthsPassed + 1}개월차: 주식 시장에 상장했습니다! 지분 ${Math.round(k.share * 100)}%를 팔아 $${cash}M을 얻었습니다. 해마다 이익의 ${Math.round(k.payout * 100)}%를 배당하고, 이익 ${Math.round(k.growth * 100)}% 이상 성장을 요구받습니다.`); this.note(this.monthsPassed + 1, 'invest', '주식 상장');
    return { ok: true, cash };
  }
  private lateStep(m: number): void {
    const s = this.state, sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    // 왕조 목표
    if (s.dynasty) { const d = config.extra.dynasty.list[s.dynasty.id];
      if (this.dynastyMet(s.dynasty.id)) { s.dynastyDone = [...(s.dynastyDone ?? []), s.dynasty.id]; s.reputation = Math.min(1, s.reputation + 0.05); s.log.push(`${m}개월차: 왕조 목표 달성 — ${d.name}! 평생 업적에 기록됩니다.`); this.note(m, 'record', `왕조 목표 달성: ${d.name}`); s.dynasty = null; }
      else if (m >= s.dynasty.until) { s.log.push(`${m}개월차: 왕조 목표 '${d.name}'을(를) 기한 안에 이루지 못했습니다.`); s.dynasty = null; } }
    // 자체 기종 기술료, 내 공항 사용료
    const own = s.ownTypes?.length ?? 0;
    if (own) { const inc = Math.round(own * config.extra.royalty * sum(s.competitors.map((c) => c.planes)) * 100) / 100; if (inc > 0) { s.cash += inc; s.cur.revenue += inc; } }
    for (const city of s.myAirports ?? []) { const n = sum(s.competitors.map((c) => c.routes.filter((r) => r.a === city || r.b === city).length)), inc = Math.round(n * config.extra.airport.fee * 100) / 100; if (inc > 0) { s.cash += inc; s.cur.revenue += inc; } }
    // 상장: 해마다 주주 평가와 배당
    const ip = s.ipo, k = config.extra.ipo;
    if (ip && m > ip.month && (m - ip.month) % 12 === 0) {
      const p12 = sum(s.history.slice(-12).map((h) => h.profit)), target = ip.base > 0 ? ip.base * (1 + k.growth) : ip.base + 10, ok = p12 >= target;
      const g = ip.base > 0 ? p12 / ip.base - 1 : (p12 - ip.base) / 50; ip.price = Math.max(10, Math.round(ip.price * (1 + Math.max(-0.4, Math.min(0.6, g))))); ip.hist = [...ip.hist, ip.price].slice(-20);
      s.reputation = Math.max(0, Math.min(1, s.reputation + (ok ? k.repUp : -k.repDown)));
      const want = p12 > 0 ? Math.round(p12 * k.payout * 10) / 10 : 0, div = Math.min(want, Math.max(0, Math.floor((s.cash - Math.max(k.cashKeep, this.monthlyRev * k.keepRev)) * 10) / 10)); // 현금이 모자라면 배당을 줄인다(대신 평판 하락)
      if (div > 0) { s.cash -= div; s.cur.cost += div; } if (div < want) s.reputation = Math.max(0, s.reputation - 0.02);
      s.log.push(`${m}개월차: 주주 총회 — 최근 12개월 이익 $${Math.round(p12)}M(목표 ${ip.base > 0 ? `$${Math.round(target)}M 이상` : '작년보다 $10M 이상 개선'}) ${ok ? '달성, 주가 상승' : '미달, 주가 하락·평판 하락'}. 주가 지수 ${ip.price}${div ? `, 배당 $${div}M` : ''}${div < want ? `(현금이 모자라 약속한 $${want}M보다 줄임, 평판 하락)` : ''}.`);
      ip.base = p12; ip.res = [...(ip.res ?? []), ok].slice(-20);
    }
    // 대형 항공사와의 장기 대결: 시작과 1년 매출 대결 결과
    const major = s.competitors.find((c) => c.major), K = config.extra.saga;
    if (major && !s.sagaStarted && m >= (major.born ?? 0) + K.startAfter) { s.sagaStarted = true; s.storyQueue = [...(s.storyQueue ?? []), { id: 'saga1', at: m }]; }
    if (s.duel && m >= s.duel.until) {
      const mine = sum(s.history.slice(-12).map((h) => h.revenue)), theirs = major ? sum(major.revHist ?? []) : 0, won = mine > theirs;
      if (won) { s.reputation = Math.min(1, s.reputation + K.winRep); s.cash += K.winCash; s.cur.revenue += K.winCash; if (major) major.planes = Math.max(1, Math.round(major.planes * (1 - K.winShrink))); }
      else { s.reputation = Math.max(0, s.reputation - K.loseRep); if (major) major.planes += K.loseGrow; }
      s.duelWon = won; s.duelDone = true; s.duel = null;
      this.alert(`${m}개월차: 최후의 대결 결과 — 우리 $${Math.round(mine)}M vs 글로벌 스카이 $${Math.round(theirs)}M. ${won ? `승리! 평판 +${Math.round(K.winRep * 100)}%, 상금 $${K.winCash}M, 상대는 항공기를 줄입니다.` : '패배. 평판이 떨어지고 상대가 더 커집니다.'}`); this.note(m, 'rival', won ? '최후의 대결 승리' : '최후의 대결 패배');
    }
    // 정부 정책: 벽지 노선 보조금, 운수권 할인
    const P = config.extra.policy;
    s.subsidies = (s.subsidies ?? []).filter((x) => (x.left === undefined ? x.expires > m : x.left > 0));
    for (const x of s.subsidies) if (x.left !== undefined && s.routes.some((r) => r.open && this.planesOn(r.id).length && this.sameRoute(r, x.a, x.b))) { s.cash += x.perMonth; s.cur.revenue += x.perMonth; x.left--; }
    if (m >= P.subMinMonth && !s.subsidies.some((x) => x.left === undefined) && this.rng.next() < P.subChance) {
      const small = CITIES.filter((c) => this.cityOpen(c.id) && marketSize(c) < 3).sort((a, b) => a.id.localeCompare(b.id)), big = [...this.servedCities()].sort();
      const pairs: [string, string][] = []; for (const a of big) for (const c of small) if (a !== c.id && distanceKm(cityById(a), c) < 3000 && !s.routes.some((r) => r.open && this.sameRoute(r, a, c.id))) pairs.push([a, c.id]);
      if (pairs.length) { const [a, b] = pairs[this.rng.int(pairs.length)], perMonth = Math.round((1.5 + distanceKm(cityById(a), cityById(b)) / 1000) * 10) / 10;
        s.subsidies.push({ id: (s.nextSub = (s.nextSub ?? 0) + 1), a, b, perMonth, months: P.subMonths, expires: m + P.subExpire });
        s.log.push(`${m}개월차: 정부가 ${cityById(a).name} ⇄ ${cityById(b).name} 벽지 노선 운항에 보조금(월 $${perMonth}M, ${P.subMonths}개월)을 제안했습니다.`); }
    }
    if (s.rights && !s.rightsSale && this.rng.next() < P.saleChance) { const left = Object.keys(config.rights.regions).filter((r) => !s.rights!.includes(r)).sort(); if (left.length) { const region = left[this.rng.int(left.length)]; s.rightsSale = { region, until: m + P.saleMonths }; s.log.push(`${m}개월차: 정부가 ${this.regionName(region)} 운수권을 ${P.saleMonths}개월간 반값에 내놓았습니다.`); } }
    if (s.rightsSale && s.rightsSale.until <= m) s.rightsSale = null;
    // 동맹 순위전(연말)
    if (m % 12 === 0 && m > 0 && s.alliance?.length && s.rivalAlliance?.length) {
      const rev = (c: Competitor) => sum(c.revHist ?? []), mine = sum(s.history.slice(-12).map((h) => h.revenue)) + sum(s.competitors.filter((c) => s.alliance!.includes(c.id)).map(rev)), sky = sum(s.competitors.filter((c) => s.rivalAlliance!.includes(c.id)).map(rev)), won = mine > sky;
      s.allianceRank = { y: m / 12, mine: Math.round(mine), sky: Math.round(sky), won };
      if (won) { s.reputation = Math.min(1, s.reputation + config.extra.allianceRace.rep); if (s.alli) s.alli.xp += config.extra.allianceRace.xp; }
      s.log.push(`${m}개월차: 동맹 순위전 — ${s.alli?.name ?? '우리 동맹'} $${Math.round(mine)}M vs 스카이 동맹 $${Math.round(sky)}M. ${won ? '우리 동맹 1위! 평판 상승' : '스카이 동맹 1위'}.`);
    }
  }
  acceptSubsidy(id: number): Result {
    const x = this.state.subsidies?.find((y) => y.id === id); if (!x || x.left !== undefined) return fail('받을 수 있는 보조금 제안이 없습니다');
    x.left = x.months; this.state.log.push(`${this.monthsPassed + 1}개월차: ${cityById(x.a).name} ⇄ ${cityById(x.b).name} 보조금을 받기로 했습니다. 이 노선을 운항하는 달마다 $${x.perMonth}M을 받습니다.`); return { ok: true };
  }
  // ---- 돈 쓸 곳: 객실 개조·광고 캠페인·친환경 연료 ----
  /** 운임 수입 배수: 광고 캠페인 중이면 브랜드 값, 객실을 개조한 기체가 다니면 그만큼 */
  premium(r: Route): number { const s = this.state; if (!s.sandbox) return 1; const cp = s.campaign && s.campaign.until > this.monthsPassed ? config.extra.campaign[s.campaign.kind]?.premium ?? 0 : 0; const l = s.loyalty, lk = config.extra.loyalty, loy = l && l.level ? lk.premium[l.level] * Math.min(1, l.members / Math.max(1, (s.history.at(-1)?.pax ?? 0) * 3)) : 0; return 1 + cp + loy + this.cabinOf(r) * config.extra.cabin.premium; } // loy: 마일리지 단골 손님
  cabinOf(r: Route): number { const ps = this.planesOn(r.id); return ps.length ? ps.reduce((a, p) => a + (p.cabin ?? 0), 0) / ps.length : 0; }
  cabinCost(p: Plane): number | null { const lv = p.cabin ?? 0; return lv >= 2 ? null : Math.round(typeById(p.type).price * config.extra.cabin.cost[lv] * 10) / 10; }
  refitCabin(planeId: number): Result {
    const s = this.state, p = this.plane(planeId); if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!p) return fail('없는 항공기입니다'); if (p.leased) return fail('임대기는 개조할 수 없습니다');
    if (typeById(p.type).seats === 0) return fail('화물기는 객실이 없습니다');
    const cost = this.cabinCost(p); if (cost === null) return fail('이미 최고급입니다'); if (s.cash < cost) return fail('현금이 모자랍니다');
    s.cash -= cost; s.cur.cost += cost; p.cabin = (p.cabin ?? 0) + 1; p.shop = Math.max(p.shop, config.extra.cabin.shop); p.book += cost;
    s.log.push(`${this.monthsPassed + 1}개월차: ${p.name ?? typeById(p.type).name} 객실을 '${config.extra.cabin.names[p.cabin]}'으로 개조합니다($${cost}M, ${config.extra.cabin.shop}일).`); return { ok: true };
  }
  campaignCost(kind: string): number { const k = config.extra.campaign[kind]; return k ? Math.round(Math.max(k.cost, this.monthlyRev * k.rev)) : 0; }
  startCampaign(kind: string): Result {
    const s = this.state, k = config.extra.campaign[kind], mp = this.monthsPassed; if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    if (!k) return fail('없는 캠페인입니다'); if (s.campaign && s.campaign.until > mp) return fail('이미 캠페인 중입니다');
    const cost = this.campaignCost(kind); if (s.cash < cost) return fail('현금이 모자랍니다');
    s.cash -= cost; s.cur.cost += cost; s.reputation = Math.min(1, s.reputation + k.rep); s.campaign = { kind, until: mp + k.months };
    s.log.push(`${mp + 1}개월차: ${k.name}을 시작했습니다($${cost}M). 평판 +${Math.round(k.rep * 100)}%, ${k.months}개월간 운임 수입 +${Math.round(k.premium * 100)}%·수요 +${Math.round(k.boost * 100)}%.`); return { ok: true };
  }
  greenCost(): number | null { const g = this.state.green ?? 0, k = config.extra.green; return g >= k.max ? null : Math.round(Math.max(k.cost, this.monthlyRev * k.rev) * (g + 1)); }
  investGreen(): Result {
    const s = this.state; if (!s.sandbox) return fail('자유 모드에서만 쓸 수 있습니다');
    const cost = this.greenCost(); if (cost === null) return fail('최고 단계입니다'); if (s.cash < cost) return fail('현금이 모자랍니다');
    s.cash -= cost; s.cur.cost += cost; s.green = (s.green ?? 0) + 1;
    s.log.push(`${this.monthsPassed + 1}개월차: 친환경 연료 ${s.green}단계 투자($${cost}M). 운영비 −${Math.round(config.extra.green.ops * s.green * 100)}%.`); return { ok: true };
  }
  /** 자동 처리 규칙을 적용한다(화면이 하루마다 부른다). 돌려주는 값: 처리한 일 설명 */
  applyRules(): string[] {
    const s = this.state, r = s.rules, out: string[] = []; if (!r || s.status !== 'playing') return out;
    if (r.contracts) for (const c of s.contracts.filter((x) => x.status === 'offer')) if (this.acceptContract(c.id).ok) out.push(`계약 자동 수락: ${c.title}`);
    if (r.subsidy) for (const x of s.subsidies ?? []) if (x.left === undefined && this.acceptSubsidy(x.id).ok) out.push(`보조금 자동 수락: ${cityById(x.a).name} ⇄ ${cityById(x.b).name}`);
    if (r.story && s.story) { const d = this.storyDef(); if (d) { const i = d.choices.reduce((best, c, k) => ((c.cash ?? 0) >= (d.choices[best].cash ?? 0) ? k : best), d.choices.length - 1); if (this.chooseStory(i).ok) out.push(`이야기 자동 선택: ${d.title} → ${d.choices[i].label}`); } }
    return out;
  }
  setRule(k: 'contracts' | 'auctions' | 'bids' | 'subsidy' | 'story', on: boolean): void { this.state.rules = { ...(this.state.rules ?? {}), [k]: on }; }
  /** 지금 열면 좋을 노선: 내가 다니는 도시(또는 본사)에서 아직 안 연 도시로, 수요 × 기준 운임 ÷ (경쟁사 수·거리) 점수 상위 */
  recommendRoutes(n = 3): { a: string; b: string; demand: number; comps: number; km: number }[] {
    const s = this.state, from = new Set([s.base, ...this.servedCities()]), range = Math.max(0, ...s.planes.map((p) => typeById(p.type).range), typeById('B737').range), out: { a: string; b: string; demand: number; comps: number; km: number; sc: number }[] = [];
    for (const a of [...from].sort()) for (const B of CITIES) {
      if (B.id === a || !this.cityOpen(a) || !this.cityOpen(B.id) || s.routes.some((r) => r.open && this.sameRoute(r, a, B.id)) || out.some((x) => this.sameRoute(x, a, B.id))) continue;
      const A = cityById(a), km = distanceKm(A, B); if (km > range * 0.95) continue;
      const demand = rawMonthlyDemand(A, B, this.month, this.growthOf(a), this.growthOf(B.id)), comps = this.competitorsOn(a, B.id).length;
      out.push({ a, b: B.id, demand, comps, km, sc: (demand * baseFare(km)) / (1 + 0.7 * comps) / (1 + km / 8000) });
    }
    return out.sort((x, y) => y.sc - x.sc || (x.a + x.b < y.a + y.b ? -1 : 1)).slice(0, n).map(({ sc: _sc, ...x }) => x);
  }
  /** 경쟁사 움직임 예보: 다음 항공기를 사면 새 노선을 여는지(아니면 증편), 어디로, 살 돈이 얼마 남았는지 */
  forecastOf(c: Competitor): { b: string | null; newRoute: boolean; need: number } {
    const k = config.competitors, tr = this.traitOf(c), need = typeById('B737').price * (this.state.sandbox ? k.buyRatio : 1) * (tr?.buy ?? 1) * (c.dir === 'grow' ? 0.7 : c.dir === 'profit' ? 1.5 : 1);
    const newRoute = c.routes.length < Math.ceil((c.planes + 1) / 2), best = newRoute ? this.compBest(c) : null;
    return { b: best?.b ?? null, newRoute: newRoute && !!best, need: Math.max(0, Math.round((need - c.cash) * 10) / 10) };
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
    if (kind === 'pax') { const r = served[this.rng.int(served.length)], d = this.routeDay(r), goal = Math.max(3000, Math.round((d.pax * config.daysPerMonth * months * (1.15 - 0.05 * Math.min(3, this.competitorsOn(r.a, r.b).length))) / 500) * 500); c = { kind, goal, limit: months, a: r.a, b: r.b, title: `${cityById(r.a).name} ⇄ ${cityById(r.b).name} 노선에서 ${months}개월 안에 승객 ${goal.toLocaleString('en-US')}명 수송` }; }
    else if (kind === 'otp') c = { kind, goal: months, limit: months + 2, title: `정시율 ${Math.round(k.otpTarget * 100)}% 이상을 ${months}개월 연속 유지(${months + 2}개월 안에)` };
    else if (kind === 'cities') { const n = 2 + this.rng.int(2); c = { kind, goal: n, limit: months + 3, startCities: served0, title: `${months + 3}개월 안에 새 도시 ${n}곳에 취항` }; }
    else { const goal = Math.max(8, Math.round(Math.max(3, avg) * months * 1.25)); c = { kind: 'profit', goal, limit: months, title: `${months}개월 동안 누적 이익 ${m$(goal)} 달성` }; }
    const reward = this.makeReward(Math.max(k.rewardMin, Math.round(base * k.kindMult[kind])));
    s.contracts.push({ ...c, id: s.nextId++, status: 'offer', expires: mp + k.offerMonths, progress: 0, reward });
    s.log.push(`${mp + 1}개월차: 새 계약 제안 — ${c.title}. 보상: ${reward.label} (현황 탭, ${k.offerMonths}개월 안에 수락)`);
  }
  private makeReward(base: number): ContractReward {
    const s = this.state, roll = this.rng.next(), cash = (v = base): ContractReward => ({ type: 'cash', value: v, label: `현금 $${v}M` });
    if (roll < 0.45) return cash();
    if (roll < 0.7) { // 새 항공기 한 대(보상 가치 안에서 가장 비싼 출시 기종)
      const t = AIRCRAFT.filter((x) => this.isAvailable(x.id) && x.price <= base * 1.2).sort((a, b) => b.price - a.price)[0];
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
      if (c.stake) { this.returnLent(c); s.reputation = Math.max(0, s.reputation - config.subsidiary.failRep); s.log.push(`${m}개월차: 자회사 ${c.name}이(가) 파산해 지분 ${Math.round(c.stake * 100)}%를 잃고 평판이 떨어졌습니다.`); this.note(m, 'rival', `자회사 ${c.name} 파산`); }
      const lots = Math.min(config.auction.maxLots, c.planes);
      for (let i = 0; i < lots; i++) s.auctions.push({ id: s.nextId++, from: c.name, type: 'B737', price: Math.round(typeById('B737').price * config.auction.price * 10) / 10, age: config.auction.age, cond: config.auction.cond, expires: this.monthsPassed + config.auction.months });
      this.note(m, 'rival', `${c.name} 파산`);
      this.alert(`${m}개월차: ${c.name}이(가) 파산했습니다. 노선 ${c.routes.length}개가 사라졌고${lots ? `, 항공기 ${lots}대가 ${config.auction.months}개월간 경매에 나왔습니다(현황 탭).` : '.'}`);
    }
    if (s.sandbox && s.competitors.filter((c) => c.major).length === 1 && m > k.major2.startMonth && !s.competitors.some((c) => c.name === k.major2.name)) { // 두 번째 대형 항공사(자유 모드)
      const used = new Set(s.competitors.map((c) => c.hub)), hub = k.major2.hubs.find((h) => h !== s.base && !used.has(h)) ?? k.major2.hubs[0];
      s.competitors.push({ id: s.nextRival++, name: k.major2.name, style: 'premium', hub, cash: 200, planes: 0, routes: [], born: this.monthsPassed, eff: k.major.eff, low: 0, major: true });
      this.note(m, 'major', `두 번째 대형 항공사 ${k.major2.name} 출범(${cityById(hub).name} 거점)`);
      this.alert(`${m}개월차: 두 번째 대형 항공사 ${k.major2.name}이(가) ${cityById(hub).name}을(를) 거점으로 진출했습니다. 글로벌 스카이와 우리, 세 회사의 경쟁이 시작됩니다.`);
    }
    if (!s.competitors.some((c) => c.major) && m > k.major.startMonth) { // 대형 항공사 출범
      const used = new Set(s.competitors.map((c) => c.hub)), hub = k.major.hubs.find((h) => h !== s.base && !used.has(h)) ?? k.major.hubs[0];
      s.competitors.push({ id: s.nextRival++, name: k.major.name, style: 'premium', hub, cash: 200, planes: 0, routes: [], born: this.monthsPassed, eff: k.major.eff, low: 0, major: true });
      this.note(m, 'major', `대형 항공사 ${k.major.name} 출범(${cityById(hub).name} 거점)`);
      s.log.push(`${m}개월차: 대형 항공사 ${k.major.name}이(가) ${cityById(hub).name}을(를) 거점으로 시장에 진출했습니다. 시장이 커질수록 함께 커지고, 내 노선에도 들어옵니다.`);
    }
    const regular = s.competitors.filter((c) => !c.major && !c.founded).length; // 내가 차린 자회사는 세지 않는다
    const maxNow = s.sandbox ? Math.min(k.sandboxMax, k.max + Math.floor(this.monthsPassed / k.maxGrowMonths)) : k.max; // 자유 모드: 2년마다 1곳씩 더 생길 수 있다(최대 12곳)
    if (m < k.entryMinMonth || regular >= maxNow) return;
    const eco = s.economy ?? 1, open = maxNow - regular;
    const chance = k.entryChance * (this.eraNow?.entry ?? 1) * this.mods.rival * (eco >= 1 ? 1.2 : 0.5) * (1 + 0.2 * (open - 1)) * (s.sandbox ? 1 + this.monthsPassed / 48 : 1) * (s.challenges?.includes('crowded') ? 2 : 1); // 호황이면 더 잘 생기고, 빈자리가 많을수록 더 잘 생긴다. 자유 모드는 시장이 커질수록 신생 항공사가 더 자주 생긴다
    if (this.rng.next() >= chance) return;
    const used = new Set([...s.competitors.map((c) => c.name), ...s.rivalsGone.filter((g) => m - g.month < 36).map((g) => g.name)]), hubs = new Set(s.competitors.map((c) => c.hub));
    const pool = (s.sandbox ? [...COMP_NAMES, ...COMP_NAMES_MORE] : COMP_NAMES).filter(([name, , hub]) => !used.has(name) && !hubs.has(hub));
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
      p.cond = Math.max(0, p.cond - (mt.decayBase + (p.routeId !== null ? mt.decayPerWeekly * p.weekly : 0)) * (1 - this.up('hangar')) * (1 - this.mroFactor(p)) * (this.state.megaDone?.includes('mro') ? 0.8 : 1));
      if (s.autoMaint && p.cond < mt.autoBelow && p.shop <= 0 && p.routeId !== null && s.cash >= this.serviceCost(p)) { // 자동 정비: 고장 나기 전에 점검(현금이 모자라면 건너뛴다)
        const r = this.service(p.id); if (r.ok) s.log.push(`${this.monthsPassed + 1}개월차: ${typeById(p.type).name} 자동 정비 (${r.cost.toFixed(1)}M)`);
      }
      if (p.cond < mt.lowCond && p.shop <= 0 && p.routeId !== null && this.rng.next() < mt.failChance * (1 + (mt.lowCond - p.cond) * 2)) { p.shop = mt.failDays; s.noFail = 0; s.log.push(`${this.monthsPassed + 1}개월차: ${typeById(p.type).name} 고장 — 정비 상태가 나빠 ${mt.failDays}일간 운항하지 못합니다.`); if (s.sandbox && !s.story && this.rng.next() < 0.25) { s.story = { id: 'accident', expires: this.monthsPassed + 1 }; s.log.push(`${this.monthsPassed + 1}개월차: 항공기 고장으로 승객들이 크게 불편을 겪었습니다 — 대응을 정하세요(현황 탭).`); } }
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
    const rep: MonthReport = { month: this.monthsPassed, revenue: s.cur.revenue, cost: s.cur.cost, depreciation: dep, fixed, interest, cargo: cargoRev, profit, pax: s.cur.pax, seats: s.cur.seats, loadFactor: lf, cash: s.cash, ...(s.cur.div ? { dividend: Math.round(s.cur.div * 100) / 100 } : {}) };
    s.history.push(rep);
    this.evaluateContracts();
    this.noteMonthEnd();
    for (const r of s.routes) { // 노선별 월 추이(최근 12개월): 월 이익과 평균 점유율
      if (!r.open || !r.daily.length) continue;
      const last = r.daily.slice(-c.daysPerMonth), sh = last.filter((x) => x.share !== undefined);
      r.monthly = [...(r.monthly ?? []), { p: Math.round(last.reduce((a, x) => a + x.profit, 0) * 100) / 100, s: sh.length ? Math.round((sh.reduce((a, x) => a + x.share!, 0) / sh.length) * 1000) / 1000 : 1 }].slice(-12);
    }
    this.seasonStep();
    this.extraMonth();
    for (const r of s.routes) if ((r.ad ?? 0) > 0) r.ad = (r.ad ?? 0) - 1;
    // 평판: 탑승률이 적정(70~90%)이면 오르고 낮으면 내린다
    if (s.cur.seats > 0) {
      const lfTarget = Math.min(1, Math.max(0, (lf - 0.5) / 0.4)), w = c.delay.repWeight;
      const target = (1 - w) * lfTarget + w * this.avgOtp; // 탑승률(좌석 채움)과 정시율이 평판을 정한다
      s.reputation += (target - s.reputation) * 0.1;
    }
    s.cur = { revenue: s.cur.revenue - rep.revenue, cost: s.cur.cost - rep.cost, pax: 0, seats: 0 }; // 보고를 만든 뒤 월말에 생긴 수입·지출(전세기·카드·대형 사업 등)은 다음 달 보고로 넘긴다
    // 도시 성장: 우리 항공기가 취항하는 도시는 시장이 조금씩 커지고, 아니면 기본값으로 천천히 돌아간다
    const recession = s.events.some((e) => e.def === 'recession');
    for (const city of CITIES) {
      const g = this.growthOf(city.id);
      const next = this.linksAt(city.id) > 0 ? g + c.growth.perMonth * (1 - (g - 1) / (c.growth.max - 1) * 0.5) - (recession ? 0.002 : 0) : g + (1 - g) * c.growth.decay;
      s.growth[city.id] = Math.min(c.growth.max, Math.max(0.8, next));
    }
    // 승패
    s.lowCashMonths = s.cash < rules.bankruptCash ? s.lowCashMonths + 1 : 0;
    if (s.lowCashMonths >= rules.bankruptMonths) { s.status = 'bankrupt'; this.alert('파산했습니다.'); }
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


