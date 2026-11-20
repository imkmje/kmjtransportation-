// 균형 점검 봇(설계서 16장): 방치·신중·리프트 안 함·새 이름만·가격 올리기·확장 안 함
import { config } from '../config';
import { COMPAT, MARKET, SEGMENTS, bodyById } from '../data';
import { bodiesAt, optionsAt, salaryOf, unitCost } from './cars';
import { capacityOf, devTeams, factoryExpandError, hqUpgradeError, isAway, isDevRole, linesOf, optionSlots, staffCap, trainCost, trainError, upkeepOf } from './company';
import { Game, allGens, sellingGens } from './game';
import { REGION, cellMonthly, currentEdition } from './market';
import { planPreview } from './queries';
import { latestGen, launchAvgGrade } from './lifecycle';
import { monthOf, yearOf } from './time';
import type { Budget, CarState, Generation, Role, Staff } from './types';

export interface Bot { name: string; step(g: Game): void }

/** 방치: 아무것도 하지 않는다(고정비만 나간다) */
export const idle: Bot = { name: 'idle', step() { /* 아무것도 안 함 */ } };

export interface SteadyOptions {
  budget: Budget; designWeeks: number; marketing: number; launchDefects: number; maxTestWeeks: number;
  faceliftMonths: number; // 세대 나이가 이 개월이 되면 페이스리프트(Infinity면 안 함)
  changeMonths: number; // 세대 나이가 이 개월이 되면 후속 차를 출시(그 5개월 전에 개발 시작)
  successor: 'fullchange' | 'newName'; // 후속: 같은 이름 풀체인지 / 매번 새 차종(전 세대 단종 뒤 출시)
  manage: boolean; // 직원 채용·교육(9.1)
  expand: boolean; // 본사 승급·공장 증설(9.2·9.3)
  gouge: boolean; // 주문이 밀리면 매달 가격 +5%, 남으면 −5%(기준가 아래로는 안 내림)
}
const STEADY: SteadyOptions = {
  budget: 'normal', designWeeks: 12, marketing: 1, launchDefects: 5, maxTestWeeks: 12, faceliftMonths: 30, changeMonths: 60, successor: 'fullchange',
  manage: true, expand: true, gouge: false,
};
const B = config.bots;

/** 봇이 판마다 기억하는 것(주문이 한도를 넘은 연속 달 수). 같은 봇을 여러 판에 써도 섞이지 않게 게임별로 */
interface Memo { month: number; overMonths: number }

/** 신중(8.4 의도한 흐름): 보통 예산·12주, 30개월 페이스리프트, 60개월 풀체인지. 경영: 정원까지 채용·쉬는 직원 교육, 여유 현금으로 본사 승급,
 *  주문이 한도의 1.3배를 3개월 넘으면 공장 증설, 생산 라인이 늘면 차종을 늘린다(쓸 수 있는 차체 수까지) */
export function steady(opts: Partial<SteadyOptions> = {}): Bot {
  const o = { ...STEADY, ...opts }, memo = new WeakMap<Game, Memo>();
  return {
    name: 'steady',
    step(g) {
      const s = g.state, m = monthOf(s.week);
      let me = memo.get(g);
      if (!me) memo.set(g, (me = { month: -1, overMonths: 0 }));
      launchReady(g, o);
      startProjects(g, o);
      hireBest(g);
      if (me.month !== m) { me.month = m; monthly(g, o, me); } // 달마다 한 번(전달 결산을 본 뒤, 개발 배치 다음에: 쉬는 직원만 교육)
    },
  };
}
/** 리프트 안 함(16장): 페이스리프트 없이 5년(60개월) 주기 풀체인지 */
export const noFacelift = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ faceliftMonths: Infinity, changeMonths: 60, ...opts }), name: 'noFacelift' });
/** 새 이름만: 페이스리프트·풀체인지 없이 5년(60개월) 주기로 매번 새 차종(전 세대를 단종하고 라인이 비면 출시) */
export const newNameOnly = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ faceliftMonths: Infinity, changeMonths: 60, successor: 'newName', ...opts }), name: 'newNameOnly' });
/** 가격 올리기: 신중과 같되 주문이 밀리면 매달 가격 +5%, 남으면 −5% */
export const gouger = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ gouge: true, ...opts }), name: 'gouger' });
/** 확장 안 함: 신중과 같되 본사·공장을 키우지 않는다 */
export const noExpand = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ expand: false, ...opts }), name: 'noExpand' });

const bodyPrice = (id: string) => bodyById(id).basePrice;
const fixedCost = (s: CarState) => s.staff.reduce((a, x) => a + salaryOf(x.ability), 0) + upkeepOf(s);

/** 달마다: 가격(gouge), 공장 증설, 본사 승급, 채용, 교육 */
function monthly(g: Game, o: SteadyOptions, me: Memo): void {
  const s = g.state, reserve = fixedCost(s) * B.reserveMonths;
  const gens = sellingGens(s).filter((x) => x.status === 'onSale');
  if (o.gouge) for (const x of gens) {
    const ed = currentEdition(x), base = bodyPrice(x.body);
    const price = x.lostSales >= 1 ? Math.min(base * config.price.max, ed.price * (1 + B.gougeStep)) : Math.max(base, ed.price * (1 - B.gougeStep));
    if (Math.round(price) !== ed.price) g.command({ type: 'setPrice', generationId: x.id, price: Math.round(price) });
  }
  if (!o.manage) return;
  const demand = gens.reduce((a, x) => a + x.lastDemand, 0);
  me.overMonths = demand > capacityOf(s) * B.expandRatio ? me.overMonths + 1 : 0;
  if (o.expand) {
    const nf = config.factory.levels[s.factory.level];
    if (me.overMonths >= B.expandMonths && nf && !factoryExpandError(s) && s.cash >= nf.cost + reserve && g.command({ type: 'expandFactory' }).ok) me.overMonths = 0;
    const nh = config.hq.levels[s.hqLevel];
    if (nh && !hqUpgradeError(s) && s.cash >= nh.cost * B.hqCashMult + reserve) g.command({ type: 'upgradeHQ' });
  }
  // 채용 공고: 정원이 남으면 모자란 직무로(후보는 다음 주에 hireBest가 고른다)
  if (!s.candidates.length && s.staff.length < staffCap(s)) {
    const tier = s.cash >= B.tier3Cash ? 3 : s.cash >= B.tier2Cash ? 2 : 1, cost = config.staff.hire.postCost[tier - 1];
    if (s.cash >= cost + reserve) g.command({ type: 'postJob', role: neededRole(s), tier });
  }
  // 교육: 쉬고 있는 직원부터(ID 순), 여유 현금이 있을 때
  for (const x of [...s.staff].sort((a, b) => a.id - b.id))
    if (x.projectId === null && !trainError(s, x) && s.cash >= trainCost(x.ability) + reserve) g.command({ type: 'train', staffId: x.id });
}

/** 후보가 있으면 가장 능력 높은 사람을 채용하고 나머지는 돌려보낸다 */
function hireBest(g: Game): void {
  const s = g.state;
  if (!s.candidates.length) return;
  const best = [...s.candidates].sort((a, b) => b.ability - a.ability || a.id - b.id)[0];
  if (s.staff.length < staffCap(s)) g.command({ type: 'hire', candidateId: best.id });
  if (s.candidates.length) g.command({ type: 'dismissCandidates' });
}

/** 정원에 맞춘 목표 구성(디자이너 1 : 엔지니어 2 : 테스터 1, 영업은 정원의 1/5)과 비교해 가장 모자란 직무 */
function neededRole(s: CarState): Role {
  const cap = staffCap(s), sales = Math.floor(cap * B.salesShare), dev = cap - sales;
  const want: Record<Role, number> = { designer: dev / 4, engineer: dev / 2, tester: dev / 4, sales };
  const have = (r: Role) => s.staff.filter((x) => x.role === r).length;
  return (['designer', 'engineer', 'tester', 'sales'] as Role[]).sort((a, b) => (have(a) - want[a]) - (have(b) - want[b]))[0];
}

/** 새 프로젝트 팀: 개발팀이 하나면 쉬는 개발 직원 전원, 여럿이면 개발 직원 수 ÷ 팀 수만큼 직무를 고르게 */
function pickTeam(s: CarState): number[] {
  const idle = s.staff.filter((x) => x.projectId === null && isDevRole(x.role) && !isAway(x, s.week)).sort((a, b) => a.id - b.id);
  const teams = devTeams(s);
  if (teams <= 1) return idle.map((x) => x.id);
  const size = Math.ceil(s.staff.filter((x) => isDevRole(x.role)).length / teams), byRole = new Map<string, Staff[]>();
  for (const x of idle) byRole.set(x.role, [...(byRole.get(x.role) ?? []), x]);
  const out: number[] = [];
  for (let i = 0; out.length < Math.min(size, idle.length); i++)
    for (const r of ['engineer', 'designer', 'tester', 'engineer']) { const x = byRole.get(r)?.shift(); if (x && out.length < size) out.push(x.id); }
  return out.sort((a, b) => a - b);
}

/** 시험이 충분히 된 프로젝트를 출시(ID 순) */
function launchReady(g: Game, o: SteadyOptions): void {
  const s = g.state, m = monthOf(s.week);
  for (const p of [...s.projects].sort((a, b) => a.id - b.id)) {
    if (!(p.phase === 'test' && p.testWeeks >= config.dev.minTestWeeks && (p.defectEst <= o.launchDefects || p.testWeeks >= o.maxTestWeeks))) continue;
    const launch = (price: number) => g.command({ type: 'launch', projectId: p.id, price, marketing: o.marketing, color: '#c8102e', wheels: 0 });
    if (p.kind === 'facelift') { // 늘어난 원가(옵션·동력 단계)만큼 가격을 올려 대당 이익을 지킨다
      const gen = allGens(s).find((x) => x.id === p.targetId);
      if (!gen || gen.status !== 'onSale') { g.command({ type: 'cancelProject', projectId: p.id }); continue; }
      const ed = currentEdition(gen), up = unitCost(p.body, p.powertrain, p.tier, p.options) - unitCost(p.body, p.powertrain, ed.tier, ed.options);
      launch(Math.min(bodyPrice(p.body) * config.price.max, Math.round(ed.price + Math.max(0, up))));
      continue;
    }
    if (p.kind === 'fullchange') { launch(bodyPrice(p.body)); continue; } // 같은 생산 라인을 이어받는다
    if (sellingGens(s).length < linesOf(s)) { launch(bodyPrice(p.body)); continue; }
    // 라인이 없으면: 새 이름 봇은 교체 시기가 된 가장 오래된 차를 단종(그달 말 라인이 빈다)
    const old = sellingGens(s).filter((x) => x.status === 'onSale' && m - x.launchMonth >= o.changeMonths).sort((a, b) => a.launchMonth - b.launchMonth || a.id - b.id)[0];
    if (o.successor === 'newName' && old && !sellingGens(s).some((x) => x.status === 'ending')) g.command({ type: 'discontinue', generationId: old.id });
  }
}

/** 빈 개발팀이 있으면: 페이스리프트 → 후속(풀체인지) → 새 차종(생산 라인 수, 쓸 수 있는 차체 수까지) 순서로 하나 시작 */
function startProjects(g: Game, o: SteadyOptions): void {
  const s = g.state, m = monthOf(s.week), year = yearOf(s.week);
  if (s.projects.length >= devTeams(s) || !pickTeam(s).length) return;
  const onSale = sellingGens(s).filter((x) => x.status === 'onSale');
  const age = (x: Generation) => m - x.launchMonth, opts = optionsAt(year).slice(-optionSlots(s)).map((x) => x.id);
  const targeted = (id: number | null) => s.projects.some((p) => p.targetId === id);
  const npOf = (x: Generation) => s.nameplates.find((n) => n.generations.includes(x))!;
  for (const x of onSale) {
    if (o.faceliftMonths !== Infinity && !x.editions.some((e) => e.kind === 'facelift') && age(x) >= o.faceliftMonths && age(x) < o.changeMonths - B.leadMonths && !targeted(x.id)) {
      g.command({ type: 'startFacelift', generationId: x.id, options: opts, team: pickTeam(s) });
      return;
    }
  }
  if (o.successor === 'fullchange') for (const x of onSale) {
    const np = npOf(x);
    if (age(x) >= o.changeMonths - B.leadMonths && latestGen(np) === x && !targeted(np.id)) { start(g, o, np.id, x); return; }
  }
  const aged = o.successor === 'newName' ? onSale.filter((x) => age(x) >= o.changeMonths - B.leadMonths).length : 0;
  const newProjects = s.projects.filter((p) => p.kind === 'new').length;
  const want = Math.min(linesOf(s), bodiesAt(year).length * B.modelsPerBody);
  if (onSale.length - aged + newProjects < Math.max(1, want)) start(g, o, null, undefined);
}

/** 새 차종(nameplateId null) 또는 풀체인지 시작. 차체: 아직 안 쓰는 것 중 (칸 규모 × 대당 이익)이 큰 것, 고객층: 그 차체에서 안 쓰는 것 중 궁합 × 비중이 큰 것 */
function start(g: Game, o: SteadyOptions, nameplateId: number | null, prev: Generation | undefined): void {
  const s = g.state, year = yearOf(s.week), team = pickTeam(s);
  const others = sellingGens(s).filter((x) => x !== prev && x.status === 'onSale');
  const body = bestBody(year, others);
  const mix = MARKET[REGION].mix[body], used = new Set(others.filter((x) => x.body === body).map((x) => x.segment));
  const segment = [...SEGMENTS].sort((a, b) => Number(used.has(a.id)) - Number(used.has(b.id)) || COMPAT[body][b.id] * mix[b.id] - COMPAT[body][a.id] * mix[a.id])[0].id;
  const spec = {
    body, segment, powertrain: 'gasoline', tier: 2, options: optionsAt(year).slice(-optionSlots(s)).map((x) => x.id),
    direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: o.budget, designWeeks: o.designWeeks,
  };
  // 직전 차보다 못한 차를 내지 않으려고, 예상 등급이 직전 세대 출시 당시보다 낮으면 기간·예산을 올린다
  const last = prev ?? (s.nameplates.length ? latestGen(s.nameplates[s.nameplates.length - 1]) : undefined);
  const tries = [spec, { ...spec, designWeeks: 16 }, { ...spec, designWeeks: 16, budget: 'high' as Budget }];
  const staff = s.staff.filter((x) => team.includes(x.id));
  const pick = (last && tries.find((t) => planPreview(s, { ...t, name: '' }, staff).avg >= launchAvgGrade(last))) || tries[last ? tries.length - 1 : 0];
  if (nameplateId !== null) g.command({ type: 'startFullChange', nameplateId, ...pick, team });
  else g.command({ type: 'startProject', name: '', ...pick, team });
}

/** 쓸 수 있는 차체 중 (칸 규모 × 기준가 대당 이익)이 가장 큰 것. 이미 파는 차체는 그 차 수만큼 칸 규모를 나눠 본다 */
const bestBody = (year: number, selling: Generation[]): string =>
  bodiesAt(year).map((b) => ({ id: b.id, v: (cellMonthly(b.id, year) * (b.basePrice - unitCost(b.id, 'gasoline', 2, []))) / (1 + selling.filter((x) => x.body === b.id).length) }))
    .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1))[0].id;

export interface RunResult {
  seed: number; survived: boolean; months: number; cash: number;
  firstReview: number | null; // 첫 차 평론 평균
  firstPayback: number | null; // 첫 차가 개발비를 회수한 개월 수(출시 달 = 0개월 뒤 1)
  cars: number; bailout: boolean;
  hqLevel: number; factoryLevel: number; staff: number;
  orderRatio: number; // 마지막 달 주문(수요 합) ÷ 생산 한도
}

/** 봇 한 판: years년 돌리고 요약 */
export function runBot(bot: Bot, seed: number, years: number): RunResult {
  const g = Game.create({ seed, companyName: bot.name });
  const weeks = years * config.time.monthsPerYear * config.time.weeksPerMonth;
  let first: Generation | undefined, payback: number | null = null;
  for (let w = 0; w < weeks && g.state.status === 'playing'; w++) {
    bot.step(g);
    g.tick();
    first ??= allGens(g.state)[0];
    if (first && payback === null && first.profit >= first.devCost) payback = first.sales.length;
  }
  const s = g.state;
  return {
    seed, survived: s.status === 'playing', months: monthOf(s.week), cash: s.cash,
    firstReview: first ? first.reviewAvg : null, firstPayback: payback, cars: allGens(s).length, bailout: s.loan.bailoutUsed,
    hqLevel: s.hqLevel, factoryLevel: s.factory.level, staff: s.staff.length,
    orderRatio: sellingGens(s).reduce((a, x) => a + x.lastDemand, 0) / capacityOf(s),
  };
}
