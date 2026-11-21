// 균형 점검 봇(설계서 16장): 방치·신중·서툰 플레이·리프트 안 함·새 이름만·가격 올리기·확장 안 함·연구 안 함
import { config } from '../config';
import { COMPAT, MARKET, RANDOM_EVENTS, SEGMENTS, TECHS, bodyById } from '../data';
import { bodiesAt, optionsAt, unitCost } from './cars';
import { eraTimeline, optionTech, requiredOptions } from './events';
import { researchCost, researchError } from './research';
import { loanLimit } from './finance';
import { hash01 } from './rng';
import { capacityOf, devTeams, factoryExpandError, hqUpgradeError, isAway, isDevRole, linesOf, optionSlots, staffCap, trainCost, trainError } from './company';
import { Game, allGens, linesUsed, sellingGens } from './game';
import { REGION, basePriceOf, cellMonthly, currentEdition } from './market';
import { planPreview } from './queries';
import { rescueOptions } from './insight';
import { DELEGATIONS, execSkill, monthlyFixed, seatsOf } from './execs';
import { compareToPrev, latestGen, launchAvgGrade } from './lifecycle';
import { monthOf, yearOf } from './time';
import type { Budget, CarState, Difficulty, ExecRole, Generation, Role, Staff } from './types';

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
  research: boolean; // 연구(10장): 그해까지 등장한 기술 중 차체 해금 → 가솔린 단계 → 규제 옵션·옵션 → 나머지, 같은 순위면 싼 것
  // 서툰 플레이(novice, 0.4.1)용 손잡이. 기본값은 신중과 같다
  sloppy: boolean; // 개발 방향을 한쪽으로 몰거나 균등하게 대충(시드 해시), 직전 차보다 못해도 기간·예산을 올리지 않음, 연구는 값싼 것만
  faceliftShare: number; // 페이스리프트를 하는 세대의 비율(세대 ID 해시)
  manageEvery: number; // 채용·교육·연구를 몇 개월마다 하는가
  expandRatio: number; // 공장 증설: 지난달 주문이 한도의 이 배수 이상
  borrowShare: number; // 현금이 음수가 되면 대출 한도의 이 비율까지 빌린다(0이면 안 빌림)
  priceMult: number; // 출시 가격 = 기준가 × 이 값
  best: boolean; // 0.10.0: 판매 중인 차마다 자동 가격 '최고 이익 매달'을 켠다
  rescue: boolean; // 0.10.0: 수습 대상(혹평·판매 부진)인 차에 긴급 개선, 후속 풀체인지를 개발 중인 혹평 차는 가격 인하 판매
}
const STEADY: SteadyOptions = {
  budget: 'normal', designWeeks: config.dev.designWeeks[1], marketing: 1, launchDefects: 5, maxTestWeeks: 28, // 0.4.2: 시험 속도가 약 2.3배 느려져 12 → 28주
   faceliftMonths: 36, changeMonths: 78, successor: 'fullchange', // 0.4.2: 3년 리프트, 6.5년 풀체인지(8.4 의도한 흐름, 개발이 약 1년이 되어 30·60 → 36·78)
  manage: true, expand: true, gouge: false, research: true,
  sloppy: false, faceliftShare: 1, manageEvery: 1, expandRatio: config.bots.expandRatio, borrowShare: 0, priceMult: 1, best: false, rescue: false,
};
const B = config.bots;

/** 신중(8.4 의도한 흐름): 보통 예산·중간 설계 기간, 36개월 페이스리프트, 78개월 풀체인지. 경영: 정원까지 채용·쉬는 직원 교육, 여유 현금으로 본사 승급,
 *  주문이 한도의 1.3배를 3개월 넘으면 공장 증설, 생산 라인이 늘면 차종을 늘린다(쓸 수 있는 차체 수까지) */
export function steady(opts: Partial<SteadyOptions> = {}): Bot {
  const o = { ...STEADY, ...opts };
  return { // 봇은 기억을 두지 않는다(저장 → 불러오기 뒤 새 봇으로 이어도 같은 결과)
    name: 'steady',
    step(g) {
      if (o.borrowShare > 0 && g.state.cash < 0) { const room = loanLimit(g.state) * o.borrowShare - g.state.loan.balance; if (room >= 1) g.command({ type: 'borrow', amount: Math.floor(Math.min(room, -g.state.cash + fixedCost(g.state) * 2)) }); }
      for (const pc of [...g.state.events.pending]) g.command({ type: 'resolveEvent', eventId: pc.id, choice: RANDOM_DEFAULT(pc.eventId) }); // 사건은 기본 선택으로 바로 답한다
      researchRequired(g); // 0.4.2: 규제 예고가 나오면 의무 장비 기술부터(연구를 안 하는 봇도, 안 하면 개발이 막힌다)
      launchReady(g, o);
      startProjects(g, o);
      const turn = monthOf(g.state.week) % o.manageEvery === 0; // 서툰 플레이는 가끔만 챙긴다
      if (turn) hireBest(g);
      if (o.research && turn) research(g, o.sloppy);
      if (o.rescue) rescue(g);
      if (g.state.week % config.time.weeksPerMonth === 0) monthly(g, o); // 달 첫 주(전달 결산을 본 뒤, 개발 배치 다음에: 쉬는 직원만 교육)
    },
  };
}
/** 서툰 플레이(0.4.1, 처음 하는 사람 흉내): 방향 대충, 화면 결함 10개쯤에서 출시, 가격 기준가·광고 1, 페이스리프트는 절반만, 풀체인지 7~8년,
 *  채용·교육·연구(값싼 것)는 6개월에 한 번, 공장 증설은 주문이 한도의 2배를 넘은 뒤, 현금이 음수면 대출 한도의 절반까지 빌린다 */
export const novice = (opts: Partial<SteadyOptions> = {}): Bot => ({
  ...steady({ sloppy: true, launchDefects: B.novice.launchDefects, faceliftShare: 0.5, changeMonths: B.novice.changeMonths, manageEvery: B.novice.manageEvery, expandRatio: B.novice.expandRatio, borrowShare: 0.5, ...opts }), name: 'novice',
});
/** 더 서툰 플레이(0.4.1, 쉬움 난이도 점검용): 시험 5주만 하고 출시(결함이 많이 남음, 0.4.2 시간 척도 전의 2주와 같은 양), 가격은 기준가의 110%, 광고 0,
 *  페이스리프트·연구·채용·교육·본사·공장 투자 안 함, 풀체인지는 10년에 한 번, 현금이 음수면 대출 한도 끝까지 빌린다 */
export const clumsy = (opts: Partial<SteadyOptions> = {}): Bot => ({
  ...steady({ sloppy: true, launchDefects: Infinity, maxTestWeeks: B.clumsy.testWeeks, priceMult: B.clumsy.priceMult, marketing: 0, faceliftMonths: Infinity, changeMonths: B.clumsy.changeMonths, research: false, manage: false, borrowShare: 1, ...opts }), name: 'clumsy',
});
/** 리프트 안 함(16장): 신중과 같은 주기, 페이스리프트만 없다 */
export const noFacelift = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ faceliftMonths: Infinity, changeMonths: STEADY.changeMonths, ...opts }), name: 'noFacelift' });
/** 새 이름만: 페이스리프트·풀체인지 없이 신중과 같은 주기로 매번 새 차종(전 세대를 단종하고 라인이 비면 출시) */
export const newNameOnly = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ faceliftMonths: Infinity, changeMonths: STEADY.changeMonths, successor: 'newName', ...opts }), name: 'newNameOnly' });
/** 가격 올리기: 신중과 같되 주문이 밀리면 매달 가격 +5%, 남으면 −5% */
export const gouger = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ gouge: true, ...opts }), name: 'gouger' });
/** 확장 안 함: 신중과 같되 본사·공장을 키우지 않는다 */
export const noExpand = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ expand: false, ...opts }), name: 'noExpand' });
/** 연구 안 함: 신중과 같되 연구를 전혀 하지 않는다(소형 세단·가솔린 3단계·옵션 없음으로만) */
export const noResearch = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ research: false, ...opts }), name: 'noResearch' });

/** 임원을 쓰는 신중(0.7.0 균형 점검): 신중과 같고, 달 첫 주마다 맡기기가 있는 빈 임원 자리(인사·생산·연구소장)를 채운다(맡기기를 켤 수 있는 직원이 있으면 임명, 없으면 공고를 내 가장 나은 후보를 채용),
 *  켤 수 있는 맡기기를 모두 켜고, 교체 고용 제안은 승인한다. 그 밖의 제안(보고)은 읽기만 한다 */
export const steadyExec = (opts: Partial<SteadyOptions> = {}): Bot => {
  const base = steady(opts);
  return { name: 'steadyExec', step(g) { base.step(g); if (g.state.week % config.time.weeksPerMonth === 0) manageExecs(g); } };
};
const EXEC_ORDER: ExecRole[] = ['hr', 'production', 'research']; // 봇은 제안을 읽지 않으므로 맡기기가 있는 자리만 채운다
function manageExecs(g: Game): void {
  const s = g.state, X = config.exec;
  for (const role of EXEC_ORDER) {
    const yearProfit = s.ledger.slice(-config.time.monthsPerYear).reduce((a, e) => a + e.profit, 0);
    if (Object.keys(s.execs?.seats ?? {}).length >= seatsOf(s) || s.cash < fixedCost(s) * B.execCashMonths || yearProfit <= 0) break; // 지난 1년 흑자이고 현금에 여유가 있을 때만(창업 초기에 가장 나은 직원을 개발에서 빼 무너지지 않게)
    if (s.execs?.seats[role]) continue;
    const inside = s.staff.filter((x) => x.projectId === null && execSkill(role, x) >= X.delegateSkill).sort((a, b) => execSkill(role, b) - execSkill(role, a) || a.id - b.id)[0];
    if (inside) { g.command({ type: 'appointExec', role, staffId: inside.id }); continue; }
    if (s.cash < X.postCost + fixedCost(s) * B.reserveMonths || !g.command({ type: 'postExecJob', role }).ok) break;
    const best = (s.execs?.candidates ?? []).filter((c) => c.role === role).sort((a, b) => b.skill - a.skill || a.id - b.id)[0];
    if (best) g.command({ type: 'hireExec', role, candidateId: best.id });
  }
  for (const role of EXEC_ORDER) if (s.execs?.seats[role]) for (const d of DELEGATIONS[role]) if (!s.execs.delegations[role]?.includes(d.key)) g.command({ type: 'setDelegation', role, key: d.key, on: true });
  for (const r of s.execs?.replacements ?? []) if (r.status === 'proposed') g.command({ type: 'approveReplacement', id: r.id });
}

/** 최고 이익 가격 정책을 쓰는 신중(0.10.0 균형 기준선 측정용) */
export const steadyBest = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ best: true, ...opts }), name: 'steadyBest' });
/** 최고 이익 가격 + 임원을 쓰는 신중(0.10.0 균형 기준선 측정용) */
export const steadyBestExec = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steadyExec({ best: true, ...opts }), name: 'steadyBestExec' });
/** 수습 수단을 쓰는 신중(0.10.0 균형 점검) */
export const steadyRescue = (opts: Partial<SteadyOptions> = {}): Bot => ({ ...steady({ rescue: true, ...opts }), name: 'steadyRescue' });
/** 수습: 대상 차에 긴급 개선(현금이 비용 + 여유분 이상, 개발팀이 비어 있을 때). 혹평 차의 후속 풀체인지를 개발 중이면 가격 인하 판매 */
function rescue(g: Game): void {
  const s = g.state, reserve = fixedCost(s) * B.reserveMonths;
  for (const x of sellingGens(s).filter((y) => y.status === 'onSale')) {
    const r = rescueOptions(s, x.id);
    if (!r || r.target) continue;
    if (r.fix.ok && s.cash >= r.fix.cost + reserve) { g.command({ type: 'quickFix', generationId: x.id }); continue; }
    const np = s.nameplates.find((n) => n.generations.includes(x))!;
    if (r.clearance.ok && x.reviewAvg <= config.rescue.reviewMax && s.projects.some((p) => p.kind === 'fullchange' && p.targetId === np.id)) g.command({ type: 'clearance', generationId: x.id });
  }
}

const RANDOM_DEFAULT = (eventId: string): number => RANDOM_EVENTS_BY_ID.get(eventId)!.defaultChoice;
const RANDOM_EVENTS_BY_ID = new Map(RANDOM_EVENTS.map((d) => [d.id, d]));

/** 연구 순위: 차체 해금·규제 옵션(과 그 선행) 0 → 가솔린 단계 1 → 옵션 2 → 나머지 3(값싼 것 먼저). 등장 연도 전에는 하지 않는다(할증) */
const techRank = (s: CarState, id: string): number => {
  const e = TECHS.find((t) => t.id === id)!.effects, req = regulatedOptions(s, true);
  const leadsToReq = TECHS.some((t) => t.pre.includes(id) && t.effects.some((x) => x.type === 'option' && req.includes(x.id)));
  return e.some((x) => x.type === 'body' || (x.type === 'option' && req.includes(x.id))) || leadsToReq ? 0 : e.some((x) => x.type === 'ptLevel' && x.id === 'gasoline') ? 1 : e.some((x) => x.type === 'option') ? 2 : 3;
};
/** 예고·시행된 규제의 의무 장비를 여는 기술(과 선행)을 현금이 되는 대로 시작한다 */
function researchRequired(g: Game): void {
  const s = g.state, need = new Set<string>();
  const add = (id: string) => { if (need.has(id) || s.research.done.includes(id)) return; need.add(id); for (const q of TECHS.find((t) => t.id === id)!.pre) add(q); };
  for (const o of regulatedOptions(s, true)) { const t = optionTech(o); if (t) add(t.id); }
  for (const t of TECHS.filter((x) => need.has(x.id) && !researchError(s, x.id))) g.command({ type: 'startResearch', techId: t.id });
}
function research(g: Game, cheapOnly = false): void {
  const s = g.state, y = yearOf(s.week), reserve = fixedCost(s) * B.reserveMonths;
  const cands = TECHS.filter((t) => t.year <= y && !researchError(s, t.id) && s.cash >= researchCost(s, t).money + reserve && (!cheapOnly || researchCost(s, t).money <= s.cash * B.novice.cheapShare))
    .sort((a, b) => (cheapOnly ? 0 : techRank(s, a.id) - techRank(s, b.id)) || researchCost(s, a).money - researchCost(s, b).money || (a.id < b.id ? -1 : 1));
  if (cands.length) g.command({ type: 'startResearch', techId: cands[0].id });
}
/** 규제 옵션(발표된 국내 규제, 유예 중 포함). early: 예고 뉴스가 나온 것까지 */
const regulatedOptions = (s: CarState, early = false): string[] => {
  const m = monthOf(s.week) + (early ? config.events.warnMonths : 0);
  return eraTimeline(s.seed).filter((sp) => m >= sp.start).flatMap((sp) => sp.def.effects.flatMap((e) => (e.type === 'regulation' && e.region === REGION ? e.options ?? [] : [])));
};
/** 옵션 고르기: 쓸 수 있는 규제 옵션 먼저, 나머지는 원가가 기준가의 optionCostShare 이하인 최신 옵션(가격을 올리지 않으므로 비싼 옵션은 대당 이익을 깎는다).
 *  keep을 주면 그 옵션을 남기고 규제 옵션만 끼워 넣는다 */
function pickOptions(s: CarState, body: string, keep?: string[]): string[] {
  const have = new Set(optionsAt(s).map((o) => o.id)), req = regulatedOptions(s).filter((o) => have.has(o)), force = requiredOptions(s);
  const slots = optionSlots(s) - req.filter((o) => !force.includes(o)).length; // 시행된 의무 장비는 옵션 칸을 차지하지 않는다(0.4.2)
  const cheap = optionsAt(s).filter((o) => o.cost <= bodyPrice(body) * B.optionCostShare).map((o) => o.id);
  const rest = keep ? keep.filter((o) => !req.includes(o)) : cheap.filter((o) => !req.includes(o)).reverse();
  return [...req, ...rest.slice(0, Math.max(0, slots))];
}

const bodyPrice = (id: string) => bodyById(id).basePrice;
const fixedCost = (s: CarState) => monthlyFixed(s); // 직원·임원 월급 + 유지비(임원이 없으면 0.7.0 전과 같다)

/** 달마다: 가격(gouge), 공장 증설, 본사 승급, 채용, 교육 */
function monthly(g: Game, o: SteadyOptions): void {
  const s = g.state, reserve = fixedCost(s) * B.reserveMonths;
  const gens = sellingGens(s).filter((x) => x.status === 'onSale');
  if (o.best) for (const x of gens) if (!x.pricePolicy && !x.clearance) g.command({ type: 'setPricePolicy', generationId: x.id, policy: { kind: 'best' } });
  if (o.gouge) for (const x of gens) {
    const ed = currentEdition(x), base = basePriceOf(s, x.body);
    const price = x.lostSales >= 1 ? Math.min(base * config.price.max, ed.price * (1 + B.gougeStep)) : Math.max(base, ed.price * (1 - B.gougeStep));
    if (Math.round(price) !== ed.price) g.command({ type: 'setPrice', generationId: x.id, price: Math.round(price) });
  }
  if (!o.manage || monthOf(s.week) % o.manageEvery !== 0) return;
  // 주문이 밀린 지 3개월: 지난 3개월 모두 한도까지 팔았고(장부 판매 ≥ 한도의 97%), 지난달 주문이 한도의 1.3배 이상
  const cap = capacityOf(s), demand = gens.reduce((a, x) => a + x.lastDemand, 0), last = s.ledger.slice(-B.expandMonths);
  const backlogged = demand >= cap * o.expandRatio && last.length === B.expandMonths && last.every((e) => e.sold >= cap * B.boundShare);
  if (o.expand) {
    const nf = config.factory.levels[s.factory.level];
    const top = s.factory.level + 1 === config.factory.levels.length; // 0.4.2: 마지막 등급(월 유지비 240억)은 그 한도의 75%를 채울 주문이 있을 때만(봇이 증설 뒤 유지비에 무너졌다)
    if (backlogged && nf && (!top || demand >= nf.capacity * B.expandFill) && !factoryExpandError(s) && s.cash >= nf.cost + reserve) g.command({ type: 'expandFactory' });
    const nh = config.hq.levels[s.hqLevel];
    if (nh && !backlogged && !hqUpgradeError(s) && s.cash >= nh.cost * B.hqCashMult + reserve) g.command({ type: 'upgradeHQ' }); // 0.4.2: 주문이 밀리면 공장 증설이 먼저(평판이 올라 본사 승급이 가능해지자 증설 자금을 본사에 썼다)
  }
  // 채용 공고: 정원이 남으면 모자란 직무로(후보는 다음 주에 hireBest가 고른다)
  if (!s.candidates.length && s.staff.length < staffCap(s)) {
    const tier = s.cash >= B.tier3Cash && s.reputation >= config.staff.hire.tier3Rep ? 3 : s.cash >= B.tier2Cash ? 2 : 1, cost = config.staff.hire.postCost[tier - 1];
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

/** 약한 차(지난달 수요가 라인 하나 몫 생산량의 weakShare 미만)는 풀체인지 가능 시점(36개월)에 바로 교체한다 */
const changeAt = (s: CarState, o: SteadyOptions, x: Generation): number =>
  x.lastDemand < (capacityOf(s) / Math.max(1, sellingGens(s).length)) * B.weakShare ? Math.min(o.changeMonths, config.lifecycle.fullChange.afterMonths) : o.changeMonths;

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
    if (p.kind === 'fix') continue; // 긴급 개선은 저절로 끝난다
    if (!(p.phase === 'test' && p.testWeeks >= config.dev.minTestWeeks && (p.defectEst <= o.launchDefects || p.testWeeks >= o.maxTestWeeks))) continue;
    const launch = (price: number) => g.command({ type: 'launch', projectId: p.id, price, marketing: o.marketing, color: '#c8102e', wheels: 0 });
    if (p.kind === 'facelift') { // 가격은 그대로(기준가보다 비싸면 가격 매력이 빠르게 떨어진다). 의무 장비로 시장 기준가가 올랐으면 거기까지 올린다(0.4.2)
      const gen = allGens(s).find((x) => x.id === p.targetId);
      if (!gen || gen.status !== 'onSale') { g.command({ type: 'cancelProject', projectId: p.id }); continue; }
      launch(Math.max(currentEdition(gen).price, Math.round(basePriceOf(s, gen.body))));
      continue;
    }
    if (p.kind === 'fullchange') { launch(Math.round(basePriceOf(s, p.body) * o.priceMult)); continue; } // 같은 생산 라인을 이어받는다. 가격은 시장 기준가(의무 장비 원가 포함) 기준
    if (linesUsed(s) < linesOf(s)) { launch(Math.round(basePriceOf(s, p.body) * o.priceMult)); continue; }
    // 라인이 없으면 교체 시기가 된 가장 오래된 차를 단종(그달 말 라인이 빈다)
    const old = sellingGens(s).filter((x) => x.status === 'onSale' && m - x.launchMonth >= changeAt(s, o, x)).sort((a, b) => a.launchMonth - b.launchMonth || a.id - b.id)[0];
    if (old && !sellingGens(s).some((x) => x.status === 'ending')) g.command({ type: 'discontinue', generationId: old.id });
  }
}

/** 빈 개발팀이 있으면: 페이스리프트 → 후속(풀체인지) → 새 차종(생산 라인 수, 쓸 수 있는 차체 수까지) 순서로 하나 시작 */
function startProjects(g: Game, o: SteadyOptions): void {
  const s = g.state, m = monthOf(s.week);
  if (s.projects.length >= devTeams(s) || !pickTeam(s).length) return;
  const onSale = sellingGens(s).filter((x) => x.status === 'onSale');
  const age = (x: Generation) => m - x.launchMonth;
  const targeted = (id: number | null) => s.projects.some((p) => p.targetId === id);
  const npOf = (x: Generation) => s.nameplates.find((n) => n.generations.includes(x))!;
  for (const x of onSale) {
    if (o.faceliftMonths !== Infinity && hash01(s.seed, 61, x.id) < o.faceliftShare && !x.editions.some((e) => e.kind === 'facelift') && age(x) >= o.faceliftMonths && changeAt(s, o, x) === o.changeMonths && age(x) < o.changeMonths - B.leadMonths && !targeted(x.id)) { // 약한 차는 리프트 없이 교체, 생산 한도에 묶인 차는 리프트를 미룬다(늘어난 주문을 팔 수 없으므로)
      g.command({ type: 'startFacelift', generationId: x.id, options: pickOptions(s, x.body, currentEdition(x).options), team: pickTeam(s) }); // 옵션은 그대로(가격을 안 올리므로 원가가 늘면 대당 이익이 준다), 규제 옵션만 넣는다
      return;
    }
  }
  if (o.successor === 'fullchange') for (const x of onSale) {
    const np = npOf(x);
    if (age(x) >= changeAt(s, o, x) - B.leadMonths && latestGen(np) === x && !targeted(np.id)) { start(g, o, np.id, x); return; }
  }
  const aged = o.successor === 'newName' ? onSale.filter((x) => age(x) >= changeAt(s, o, x) - B.leadMonths).length : 0;
  const newProjects = s.projects.filter((p) => p.kind === 'new').length;
  const want = Math.min(linesOf(s), bodiesAt(s).length * B.modelsPerBody);
  if (onSale.length - aged + newProjects < Math.max(1, want)) start(g, o, null, undefined);
}

/** 새 차종(nameplateId null) 또는 풀체인지 시작. 차체: 아직 안 쓰는 것 중 (칸 규모 × 대당 이익)이 큰 것, 고객층: 그 차체에서 안 쓰는 것 중 궁합 × 비중이 큰 것 */
function start(g: Game, o: SteadyOptions, nameplateId: number | null, prev: Generation | undefined): void {
  const s = g.state, year = yearOf(s.week), team = pickTeam(s);
  const others = sellingGens(s).filter((x) => x !== prev && x.status === 'onSale');
  const body = bestBody(s, year, others);
  const mix = MARKET[REGION].mix[body], used = new Set(others.filter((x) => x.body === body).map((x) => x.segment));
  const segment = [...SEGMENTS].sort((a, b) => Number(used.has(a.id)) - Number(used.has(b.id)) || COMPAT[body][b.id] * mix[b.id] - COMPAT[body][a.id] * mix[a.id])[0].id;
  const spec = {
    body, segment, powertrain: 'gasoline', tier: 2, options: pickOptions(s, body),
    direction: o.sloppy ? SLOPPY_DIRS[Math.floor(hash01(s.seed, 62, s.nextId) * SLOPPY_DIRS.length)] : { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: o.budget, designWeeks: o.designWeeks,
  };
  // 직전 차보다 못한 차를 내지 않으려고, 예상 등급이 직전 세대 출시 당시보다 낮으면 기간·예산을 올린다
  const last = prev ?? (s.nameplates.length ? latestGen(s.nameplates[s.nameplates.length - 1]) : undefined);
  const long = config.dev.designWeeks[2], tries = [spec, { ...spec, designWeeks: long }, { ...spec, designWeeks: long, budget: 'high' as Budget }];
  // 0.4.2: 풀체인지는 미리보기의 전작 비교(원점수)가 '못하다'가 아니게(모자라면 쉬는 개발 직원 전원을 넣는다), 새 차종은 직전 차의 출시 등급 이상이 되게
  const all = s.staff.filter((x) => x.projectId === null && isDevRole(x.role) && !isAway(x, s.week) && !x.lab).map((x) => x.id);
  const cands = [...tries.map((t) => ({ t, team })), ...(prev && all.length > team.length ? tries.map((t) => ({ t, team: all })) : [])];
  const okTry = (c: (typeof cands)[number]) => { const pv = planPreview(s, { ...c.t, name: '' }, s.staff.filter((x) => c.team.includes(x.id))); return prev ? compareToPrev(prev, pv.stats, c.t.body) !== 'worse' : pv.avg >= launchAvgGrade(last!); };
  const pick = o.sloppy ? cands[0] : (last && cands.find(okTry)) || cands[last ? tries.length - 1 : 0];
  if (nameplateId !== null) g.command({ type: 'startFullChange', nameplateId, ...pick.t, team: pick.team });
  else g.command({ type: 'startProject', name: '', ...pick.t, team: pick.team });
}

/** 서툰 개발 방향: 균등하거나 한쪽(성능·디자인 / 실용·연비 / 품질)으로 몰기 */
const SLOPPY_DIRS = [{ P: 2, E: 2, U: 2, D: 2, Q: 2 }, { P: 4, E: 1, U: 1, D: 4, Q: 0 }, { P: 1, E: 4, U: 4, D: 1, Q: 0 }, { P: 1, E: 1, U: 2, D: 2, Q: 4 }];

/** 쓸 수 있는 차체 중 (칸 규모 × 기준가 대당 이익)이 가장 큰 것. 이미 파는 차체는 (1 + 그 차 수)^bodySpread로 나눠 본다(새 차체 활용) */
const bestBody = (s: CarState, year: number, selling: Generation[]): string =>
  bodiesAt(s).map((b) => ({ id: b.id, v: (cellMonthly(b.id, year) * (b.basePrice - unitCost(b.id, 'gasoline', 2, []))) / (1 + selling.filter((x) => x.body === b.id).length) ** B.bodySpread }))
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
/** difficulty: 생략하면 'normal'(균형 측정의 기준) */
export function runBot(bot: Bot, seed: number, years: number, difficulty: Difficulty = 'normal'): RunResult {
  const g = Game.create({ seed, companyName: bot.name, difficulty });
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
