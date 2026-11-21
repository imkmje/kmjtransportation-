// 임원(0.7.0, 설계서 9.7): 자리·임명·채용, 월 결산 제안(보고함), 맡기기, 교체 고용.
// 제안 수치는 화면이 쓰는 조회(queries·research·company)와 같은 함수로 계산한다. 상태를 바꾸는 것은 execCommand·execWeek·execMonth뿐
import { config } from '../config';
import { COMPAT, MARKET, SEGMENTS, bodyById, segmentById, techById } from '../data';
import { grade, salaryOf, unitCost } from './cars';
import { allocate, capacityOf, costMultOf, isAway, isDevRole, isTraining, linesOf, repEffect, severanceOf, staffCap, trainCost, trainError, upkeepOf } from './company';
import { loanLimit, loanRate } from './finance';
import { linesUsed, sellingGens } from './game';
import { josa } from './josa';
import { fullChangeEligibility } from './lifecycle';
import { REGION, awarenessTarget, basePriceOf, genBasePrice, currentEdition, monthlyDemand, toSaleCar } from './market';
import { advice, comboNotes, factoryInfo, faceliftPreview, generationUnitProfit, lifeBar, planPreview, priceForecast } from './queries';
import { ptCostAdd, regulatedTechs, researchInfo, researchSlots, unlockedBodies } from './research';
import { mean } from './reviews';
import { noteExec, startHist } from './history';
import { staffBrief } from './insight';
import type { Rng } from './rng';
import { monthLabel, monthOf, monthTime, yearOf } from './time';
import type { CarState, Command, CommandResult, ExecGoto, ExecRole, ExecState, GameEvent, Generation, Replacement, Role, Staff } from './types';

const X = config.exec;
export const EXEC_ROLES: ExecRole[] = ['hr', 'product', 'finance', 'production', 'research', 'market'];
export const EXEC_TITLE: Record<ExecRole, string> = { hr: '인사 임원', product: '기획 임원', finance: '재무 임원', production: '생산 임원', research: '연구소장', market: '시장 조사 임원' };
/** 외부에서 뽑은 임원의 직무(능력 계산 기준) */
const EXEC_BASE_ROLE: Record<ExecRole, Role> = { hr: 'sales', product: 'designer', finance: 'sales', production: 'tester', research: 'engineer', market: 'sales' };
const ROLE_KO: Record<Role, string> = { designer: '디자이너', engineer: '엔지니어', tester: '테스터', sales: '영업' };
const SKILL_KO: Record<Role, string> = { designer: '디자인', engineer: '기술', tester: '꼼꼼함', sales: '영업력' };
/** 맡기기 항목(자리별). 해고·가격·출시 같은 큰 결정은 없다 */
export const DELEGATIONS: Record<ExecRole, { key: string; label: string }[]> = {
  hr: [{ key: 'autoRest', label: '지친 직원 자동 휴식' }, { key: 'autoTrain', label: '성장 여지가 있는 직원 자동 교육' }],
  product: [], finance: [],
  production: [{ key: 'autoAlloc', label: '생산 배분 자동 조정' }],
  research: [{ key: 'autoResearch', label: '빈 연구 칸에 추천 연구 시작' }],
  market: [],
};
/** 보고 종류별 제목 */
const KIND_TITLE: Record<string, string> = {
  fire: '해고 권유', replace: '교체 고용 제안', train: '교육 권유', rest: '휴식 권유', hire: '채용 권유',
  facelift: '페이스리프트 적기', fullchange: '풀체인지 적기', discontinue: '단종 권고',
  cashOut: '현금 부족 예고', repay: '대출 상환', priceUp: '가격 올리기', priceDown: '가격 내리기',
  expand: '공장 증설', lines: '생산 라인 부족', alloc: '생산 배분',
  regulation: '규제 대비 연구', emptySlot: '빈 연구 칸',
  build: '새 차종 제안', adUp: '광고 늘리기', adDown: '광고 줄이기',
  autoRest: '자동 휴식', autoTrain: '자동 교육', autoResearch: '자동 연구', autoAlloc: '자동 생산 배분',
  replaceDone: '교체 고용 완료', replaceFail: '교체 고용 실패', replaceHold: '교체 고용 보류', replaceCancel: '교체 고용 취소', replaceWait: '교체 고용 대기',
};

const won = (x: number): string => { const v = Math.abs(x); return `${x < 0 ? '−' : ''}${v >= 10000 ? `${(v / 10000).toFixed(1)}억원` : `${Math.round(v).toLocaleString()}만원`}`; };
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const J = josa;

// ---------- 자리·능력·월급 ----------
export const seatsOf = (s: CarState): number => X.seats[s.hqLevel - 1];
/** 지금 임원 자리를 다 쓰면 다음으로 자리가 느는 본사 등급(없으면 null) */
const nextSeatHq = (s: CarState): number | null => { const i = X.seats.findIndex((n, k) => k >= s.hqLevel && n > seatsOf(s)); return i < 0 ? null : i + 1; };
const seated = (s: CarState): [ExecRole, Staff, boolean][] => EXEC_ROLES.flatMap((r) => { const x = s.execs?.seats[r]; return x ? [[r, x.staff, x.hired] as [ExecRole, Staff, boolean]] : []; });
/** 임원 능력(0~100): 관련 직무면 직원 능력 그대로(또는 related 배수), 아니면 × match */
export const execSkill = (role: ExecRole, x: Pick<Staff, 'ability' | 'role'>): number => Math.round(Math.min(100, x.ability * (X.related[role]?.[x.role] ?? X.match)));
/** 제안의 구체성 1~3 */
export const execTier = (skill: number): 1 | 2 | 3 => (skill < X.tiers[0] ? 1 : skill < X.tiers[1] ? 2 : 3);
/** 임원 수에 따라 임원마다 더 붙는 수당(0.8.0: 임원이 정원 밖이 되어 균형을 수당으로 맞춘다) */
export const seatAllowance = (n: number): number => X.seatAllowance[Math.min(n, X.seatAllowance.length) - 1] ?? 0;
/** 임원 월급: 임명한 직원은 원래 월급 + 수당, 외부 임원은 직원 월급 공식 × 1.6. 둘 다 임원 수에 따른 수당이 더 붙는다 */
export const execPayOf = (s: CarState, x: Staff, hired: boolean): number => (hired ? Math.round(salaryOf(x.ability) * X.hiredPayMult) : salaryOf(x.ability) + X.allowance) + seatAllowance(seated(s).length);
export const execPay = (s: CarState): number => seated(s).reduce((a, [, x, h]) => a + execPayOf(s, x, h), 0);
/** 운영비(월): 직원 월급 + 임원 월급 + 본사·공장 유지비. 맡기기·교체 고용의 현금 기준 */
export const monthlyFixed = (s: CarState): number => s.staff.reduce((a, x) => a + salaryOf(x.ability), 0) + execPay(s) + upkeepOf(s);

const holder = (s: CarState, r: ExecRole) => s.execs?.seats[r];
const delegationOn = (s: CarState, r: ExecRole, key: string): boolean => !!holder(s, r) && !!s.execs?.delegations[r]?.includes(key) && execSkill(r, holder(s, r)!.staff) >= X.delegateSkill;
const emptyExecs = (): ExecState => ({ seats: {}, delegations: {}, candidates: [], reports: [], cooldown: {}, replacements: [], rejected: {} });

// ---------- 조회(화면) ----------
export function execInfo(s: CarState) {
  const used = seated(s).length, seats = seatsOf(s);
  return {
    seats, used, postCost: X.postCost, delegateSkill: X.delegateSkill, nextSeatHq: nextSeatHq(s), tiers: X.tiers,
    roles: EXEC_ROLES.map((role) => {
      const seat = s.execs?.seats[role], skill = seat ? execSkill(role, seat.staff) : 0;
      return {
        role, title: EXEC_TITLE[role],
        holder: seat ? { staffId: seat.staff.id, name: seat.staff.name, skill, tier: execTier(skill), hired: seat.hired, pay: execPayOf(s, seat.staff, seat.hired), staffRole: seat.staff.role } : null,
        canFill: !seat && used < seats, // 빈 자리(임명·채용 가능). 자리가 다 찼으면 false(잠김)
        delegations: DELEGATIONS[role].map((d) => {
          const whyNot = !seat ? '임원이 없습니다.' : skill < X.delegateSkill ? `임원 능력이 ${X.delegateSkill} 이상이어야 맡길 수 있습니다(지금 ${skill}).` : null;
          return { key: d.key, label: d.label, on: !!s.execs?.delegations[role]?.includes(d.key) && !whyNot, available: !whyNot, whyNot };
        }),
        internal: [...s.staff].map((x) => ({ staffId: x.id, name: x.name, role: x.role, skill: execSkill(role, x), busyWith: x.projectId !== null ? `「${s.projects.find((p) => p.id === x.projectId)?.name ?? ''}」 개발 중` : x.lab ? '전담 연구원' : null }))
          .sort((a, b) => b.skill - a.skill || a.staffId - b.staffId),
        candidates: (s.execs?.candidates ?? []).filter((c) => c.role === role).map((c) => ({ id: c.id, name: c.name, skill: c.skill, tier: execTier(c.skill), pay: c.pay + seatAllowance(seated(s).length + 1), weeksLeft: c.expiresWeek - s.week })),
      };
    }),
  };
}
export type ExecInfo = ReturnType<typeof execInfo>;

/** 보고함(최신순) */
export function execReports(s: CarState) {
  const reps = s.execs?.replacements ?? [];
  return [...(s.execs?.reports ?? [])].reverse().map((r) => {
    const rp = r.replacementId === null ? undefined : reps.find((x) => x.id === r.replacementId);
    return {
      id: r.id, week: r.week, role: r.role, title: KIND_TITLE[r.kind] ?? r.kind, execName: r.execName, kind: r.kind, text: r.text, facts: r.facts, goto: r.goto, unread: r.unread, auto: r.auto,
      replacement: rp ? { id: rp.id, status: rp.status, waitingFor: rp.waitingFor, staffName: rp.staffName, minAbility: rp.minAbility } : null,
    };
  });
}
export const execUnread = (s: CarState): number => (s.execs?.reports ?? []).filter((r) => r.unread).length;

/** 시장 조사: 이 차체 × 고객층으로 지금 회사 개발 직원 전원·가솔린 표준·보통 예산·중간 기간으로 만들어 기준가·광고 1에 내면 예상 월 판매(생산 한도까지).
 *  mainSegment: 이 차급에서 손님이 가장 많은 고객층, weakRival: 이 차급에서 가장 약한 경쟁사(고르면 null), known: 내 본 조합이면 조합 노트 */
export function marketIdea(s: CarState, body: string, segment: string) {
  const team = s.staff.filter((x) => isDevRole(x.role));
  const pv = planPreview(s, { name: '', body, segment, powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.dev.designWeeks[1] }, team);
  const m = monthOf(s.week), price = Math.round(basePriceOf(s, body));
  const others = sellingGens(s).filter((g) => g.status === 'onSale').map((g) => toSaleCar(g, m));
  const aw = awarenessTarget(s.reputation, 1, grade(pv.stats.Q, yearOf(s.week)));
  const d = monthlyDemand(s, { body, segment, stats: pv.stats, price, awareness: aw, life: 1, powertrain: 'gasoline' }, others, monthTime(m));
  const mix = MARKET[REGION].mix[body] ?? {}, mainSegment = [...SEGMENTS].sort((a, b) => (mix[b.id] ?? 0) - (mix[a.id] ?? 0) || (a.id < b.id ? -1 : 1))[0].id;
  const cells = s.rivals.map((r) => ({ name: r.name, a: r.cells[body] ?? 0 })).sort((a, b) => a.a - b.a), avgA = mean(cells.map((c) => c.a));
  return {
    sales: Math.round(Math.min(capacityOf(s), d)), price, unitProfit: price - unitCost(body, 'gasoline', 2, [], costMultOf(s), ptCostAdd(s, 'gasoline')),
    mainSegment, weakRival: cells.length && cells[0].a < avgA * 0.95 ? cells[0].name : null,
    known: comboNotes(s).find((c) => c.body === body && c.segment === segment) ?? null,
  };
}

/** 생산 배분 제안·자동 조정: 주문이 한도를 넘으면 대당 이익이 큰 차부터 채운다(아니면 모두 자동). now·after: 지난달 주문 기준 월 이익(대당 이익 × 만드는 대수) */
export function profitAlloc(s: CarState) {
  const gens = sellingGens(s), cap = capacityOf(s), demand = gens.map((g) => g.lastDemand), total = demand.reduce((a, b) => a + b, 0);
  const unit = gens.map((g) => generationUnitProfit(g, s));
  let shares: (number | null)[] = gens.map(() => null);
  if (gens.length >= 2 && total > cap) {
    let rem = cap;
    const order = gens.map((_, i) => i).sort((a, b) => unit[b] - unit[a] || gens[a].id - gens[b].id);
    shares = gens.map(() => 0);
    for (const i of order) { const take = Math.max(0, Math.min(demand[i], rem)); shares[i] = Math.floor((take / cap) * 1000) / 1000; rem -= take; }
  }
  const profit = (sh: (number | null)[]) => allocate(cap, demand, sh).reduce((a, n, i) => a + n * unit[i], 0);
  const cur = gens.map((g) => g.allocShare);
  return { gens, shares, unit, now: profit(cur), after: profit(shares), changed: shares.some((x, i) => (x === null) !== (cur[i] === null) || Math.abs((x ?? 0) - (cur[i] ?? 0)) > 0.005) };
}

/** 추천 연구: 시작할 수 있는(현금 포함) 기술 중 규제 필요 → 차체 → 지금 쓰는 동력 단계 → 옵션 → 나머지, 같으면 싼 것. 등장 연도 전 기술은 규제에 필요할 때만. cashFloor: 연구비를 내고 남아야 할 현금 */
export function recommendTech(s: CarState, cashFloor = 0) {
  const y = yearOf(s.week), pts = new Set(['gasoline', ...sellingGens(s).map((g) => g.powertrain)]);
  const rank = (id: string, req: boolean) => { const e = techById(id).effects; return req ? 0 : e.some((x) => x.type === 'body') ? 1 : e.some((x) => x.type === 'ptLevel' && pts.has(x.id)) ? 2 : e.some((x) => x.type === 'option') ? 3 : 4; };
  return researchInfo(s).fields.flatMap((f) => f.techs)
    .filter((t) => t.status === 'available' && t.reason === null && (t.year <= y || t.requiredBy) && s.cash - t.cost.money >= cashFloor)
    .sort((a, b) => rank(a.id, !!a.requiredBy) - rank(b.id, !!b.requiredBy) || a.cost.money - b.cost.money || (a.id < b.id ? -1 : 1))[0];
}

// ---------- 직원 판정(인사) ----------
const roleAvg = (s: CarState, x: Staff): number | null => { const o = s.staff.filter((y) => y.role === x.role && y.id !== x.id); return o.length ? mean(o.map((y) => y.ability)) : null; };
/** 성장 한계에 닿았고 같은 직무 평균보다 weakGap 이상 낮다 */
export const weakCapped = (s: CarState, x: Staff): boolean => { const a = roleAvg(s, x); return x.ability >= x.potential && a !== null && x.ability <= a - X.hr.weakGap; };
const replaceTier = (s: CarState, min: number): 2 | 3 => (min > config.staff.hire.abilityMax[1] - 10 && s.reputation >= config.staff.hire.tier3Rep ? 3 : 2);
const repBonus = (s: CarState): number => Math.floor(repEffect(s.reputation) / config.staff.hire.repBonusDiv);
/** 교체 기준 능력(대상 능력 + replace.minGain과 같은 직무 평균 중 큰 값, 공고로 닿을 수 있을 때만) */
export function replaceMin(s: CarState, x: Staff): number | null {
  const a = roleAvg(s, x); if (a === null) return null;
  const min = Math.max(x.ability + X.replace.minGain, Math.ceil(a)), H = config.staff.hire;
  return min <= H.abilityMax[replaceTier(s, min) - 1] + repBonus(s) - 5 ? min : null;
}
/** 같은 직무에서 교체를 마친 지 replace.gapMonths가 안 지났다(0.8.0: 교체 빈도 제한. 마친 교체의 nextWeek = 마친 주) */
const recentReplace = (s: CarState, role: Role): boolean => !!s.execs?.replacements.some((r) => r.status === 'done' && r.staffRole === role && s.week < r.nextWeek + X.replace.gapMonths * config.time.weeksPerMonth);
const openReplacement = (s: CarState): Replacement | undefined => s.execs?.replacements.find((r) => r.status === 'proposed' || r.status === 'approved' || r.status === 'waiting');

// ---------- 제안 만들기 ----------
interface Idea { kind: string; key: string; text: [string, string, string]; facts: string[]; goto: ExecGoto | null; issue?: () => number }
const gName = (s: CarState, g: Generation) => s.nameplates.find((n) => n.generations.includes(g))?.name ?? '';
const staffGoto = (id?: number): ExecGoto => (id === undefined ? { tab: 'company', sub: 'staff' } : { tab: 'company', sub: 'staff', id });

function hrIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], fixed = monthlyFixed(s), C = config.staff.condition, T = config.staff.train;
  const weak = s.staff.filter((x) => weakCapped(s, x)).sort((a, b) => a.ability - b.ability || a.id - b.id);
  const canReplace = !openReplacement(s) && s.cash > fixed * X.replace.cashMonths;
  for (const x of weak) {
    const avg = Math.round(roleAvg(s, x)!), sk = SKILL_KO[x.role], min = replaceMin(s, x);
    const facts = [`${x.name}: ${ROLE_KO[x.role]}, ${sk} ${x.ability}(성장 한계 ${x.potential})`, `${x.name}: ${staffBrief(s, x)}`, `같은 직무 평균 ${avg}`, `월급 ${won(salaryOf(x.ability))}, 내보내면 퇴직금 ${won(severanceOf(salaryOf(x.ability)))}`];
    if (canReplace && min !== null && !((s.execs?.rejected[x.id] ?? -1) > s.week) && !recentReplace(s, x.role)) {
      out.push({ kind: 'replace', key: String(x.id), goto: staffGoto(x.id), facts: [...facts, `기준: ${sk} ${min} 이상(${min + X.replace.capGain}을 넘는 후보는 오지 않음), 공고비 ${won(config.staff.hire.postCost[replaceTier(s, min) - 1])}`],
        text: ['더 성장하기 어려운 직원 한 명을 더 나은 사람으로 바꾸는 것을 제안합니다. 승인하시면 알맞은 때에 공고를 내 교체하겠습니다.',
          `${x.name}${J(x.name, '은/는')} 더 성장하기 어렵습니다. 내보내고 ${sk}${J(sk, '이/가')} 더 높은 사람을 고용할까요?`,
          `${x.name}(${sk} ${x.ability}, 더 성장하기 어려움)${J(x.name + ')', '을/를')} 내보내고 ${sk} ${min} 이상인 사람을 고용할까요? 승인하시면 공고를 내고, 기준 이상인 후보가 있을 때만 교체합니다. 개발 중이면 그 개발이 끝난 뒤에 진행합니다.`],
        issue: () => { const r: Replacement = { id: s.nextId++, staffId: x.id, staffName: x.name, staffRole: x.role, ability: x.ability, minAbility: min, status: 'proposed', tries: 0, nextWeek: s.week, waitingFor: null, held: false }; s.execs!.replacements.push(r); return r.id; } });
      break; // 교체 제안은 한 번에 한 건
    }
    out.push({ kind: 'fire', key: String(x.id), goto: staffGoto(x.id), facts,
      text: ['직원 가운데 더 성장하기 어려운 사람이 있습니다. 인원 정리를 검토해 보시죠.',
        `${x.name}${J(x.name, '은/는')} 더 성장하기 어렵습니다. 해고를 검토해 보시죠.`,
        `${x.name}(${ROLE_KO[x.role]}, ${sk} ${x.ability})${J(x.name + ')', '은/는')} 성장 한계에 닿았고 같은 직무 평균(${avg})보다 ${avg - x.ability} 낮습니다. 더 성장하기 어렵습니다. 해고를 권유합니다.`] });
    break;
  }
  for (const x of [...s.staff].filter((y) => y.condition < C.low && !isAway(y, s.week)).sort((a, b) => a.condition - b.condition || a.id - b.id).slice(0, 1)) {
    const w = X.hr.restWeeks;
    out.push({ kind: 'rest', key: String(x.id), goto: staffGoto(x.id), facts: [`${x.name} 컨디션 ${pct(x.condition)}`, `지친 상태에서는 일의 양이 ${pct(1 - C.lowMult)} 줄어듭니다`],
      text: ['지친 직원이 있습니다. 쉬게 해 주는 편이 낫습니다.', `${x.name}${J(x.name, '이/가')} 많이 지쳤습니다. 휴식을 권합니다.`, `${x.name}의 컨디션이 ${pct(x.condition)}입니다. 이대로면 일의 양이 ${pct(1 - C.lowMult)} 줄어듭니다. ${w}주 휴식을 권합니다.`] });
  }
  for (const x of [...s.staff].filter((y) => y.projectId === null && y.potential - y.ability >= X.hr.growGap && !trainError(s, y)).sort((a, b) => (b.potential - b.ability) - (a.potential - a.ability) || a.id - b.id).slice(0, 1)) {
    const sk = SKILL_KO[x.role];
    out.push({ kind: 'train', key: String(x.id), goto: staffGoto(x.id), facts: [`${x.name}: ${sk} ${x.ability}, 성장 한계 ${x.potential}`, `교육비 ${won(trainCost(x.ability))}, 능력 +${T.gainMin}~${T.gainMax}, ${T.weeks}주`],
      text: ['교육으로 더 클 수 있는 직원이 있습니다.', `${x.name}${J(x.name, '은/는')} 교육으로 더 클 수 있습니다. 교육을 보내 보시죠.`,
        `${x.name}(${sk} ${x.ability})${J(x.name + ')', '은/는')} 성장 한계까지 ${x.potential - x.ability} 남았고 지금 개발에 들어가 있지 않습니다. 교육비 ${won(trainCost(x.ability))}로 능력이 ${T.gainMin}~${T.gainMax} 오릅니다.`] });
  }
  if (s.staff.length < staffCap(s)) {
    const want: Record<Role, number> = { designer: 1, engineer: 2, tester: 1, sales: s.hqLevel >= 2 ? 1 : 0 }, have = (r: Role) => s.staff.filter((x) => x.role === r).length;
    const r = (['designer', 'engineer', 'tester', 'sales'] as Role[]).filter((k) => want[k] > 0).sort((a, b) => have(a) / want[a] - have(b) / want[b])[0], n = ROLE_KO[r];
    out.push({ kind: 'hire', key: r, goto: staffGoto(), facts: [`정원 ${s.staff.length}/${staffCap(s)}명`, `${n} ${have(r)}명`],
      text: ['정원에 여유가 있습니다. 채용을 검토해 보시죠.', `${n} 쪽 인력이 부족합니다. 채용을 권합니다.`, `정원 ${s.staff.length}/${staffCap(s)}명입니다. ${n}${J(n, '이/가')} ${have(r)}명뿐이라 가장 부족합니다. ${n} 채용 공고를 권합니다.`] });
  }
  return out;
}

function productIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], m = monthOf(s.week), P = X.product, D = config.discontinue;
  for (const g of sellingGens(s).filter((x) => x.status === 'onSale')) {
    const n = gName(s, g), age = m - g.launchMonth, go: ExecGoto = { tab: 'garage', id: g.id };
    if (advice(g, s).includes('단종을 권합니다')) {
      out.push({ kind: 'discontinue', key: String(g.id), goto: go, facts: [`「${n}」 최근 ${D.adviceMonths}개월 판매 ${g.sales.slice(-D.adviceMonths).join('·')}대`],
        text: ['거의 팔리지 않는 차가 있습니다. 정리를 검토해 보시죠.', `「${n}」${J(n, '은/는')} 거의 팔리지 않습니다. 단종을 권합니다.`, `「${n}」${J(n, '은/는')} ${D.adviceMonths}개월째 월 ${D.adviceSales}대 미만입니다. 단종하고 생산 라인을 다른 차에 쓰는 편이 낫습니다.`] });
      continue;
    }
    const life = lifeBar(s, g);
    if (fullChangeEligibility(s, s.nameplates.find((x) => x.generations.includes(g))!.id).ok && life < P.fullChangeLife) {
      out.push({ kind: 'fullchange', key: String(g.id), goto: go, facts: [`「${n}」 출시 ${age}개월째, 수명 ${pct(life)}`, `지난달 판매 ${g.sales.at(-1) ?? 0}대`],
        text: ['오래된 차가 있습니다. 다음 세대를 준비할 때입니다.', `「${n}」${J(n, '이/가')} 많이 낡았습니다. 풀체인지를 시작할 때입니다.`, `「${n}」${J(n, '은/는')} 출시 ${age}개월째로 많이 낡았습니다(수명 ${pct(life)}). 다음 세대 개발을 시작할 때입니다. 개발에 1년 안팎이 걸립니다.`] });
      continue;
    }
    const pv = faceliftPreview(s, g.id, { options: currentEdition(g).options });
    if (pv && pv.eligibility.ok && !pv.tooEarly && pv.paybackMonths !== null && pv.paybackMonths <= P.faceliftPayback)
      out.push({ kind: 'facelift', key: String(g.id), goto: go, facts: [`「${n}」 출시 ${age}개월째`, `월 판매 ${pv.salesBefore}대 → ${pv.salesAfter}대`, `비용 ${won(pv.cost)}, 약 ${pv.paybackMonths}개월에 회수`],
        text: ['판매 중인 차 가운데 페이스리프트할 때가 된 차가 있습니다.', `「${n}」 페이스리프트를 할 때입니다.`, `「${n}」${J(n, '은/는')} 출시 ${age}개월째입니다. 지금 페이스리프트하면 월 판매가 ${pv.salesBefore}대에서 ${pv.salesAfter}대 안팎으로 늘고, 비용 ${won(pv.cost)}${J(won(pv.cost), '은/는')} 약 ${pv.paybackMonths}개월에 회수됩니다.`] });
  }
  return out;
}

function financeIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], F = X.finance, fixed = monthlyFixed(s), last = s.ledger.slice(-F.avgMonths), fin: ExecGoto = { tab: 'company', sub: 'fin' };
  if (last.length === F.avgMonths) {
    const avg = mean(last.map((e) => e.profit)), months = s.cash > 0 && avg < 0 ? Math.floor(s.cash / -avg) : 0, room = Math.max(0, loanLimit(s) - s.loan.balance);
    if (avg < 0 && months < F.warnMonths)
      out.push({ kind: 'cashOut', key: 'cash', goto: fin, facts: [`최근 ${F.avgMonths}개월 평균 이익 ${won(avg)}`, `현금 ${won(s.cash)}`, `남은 대출 한도 ${won(room)}`],
        text: ['현금 흐름이 좋지 않습니다. 지출을 살펴보시죠.', '몇 달 안에 현금이 모자랄 수 있습니다. 대출이나 지출 정리를 검토해 보시죠.',
          s.cash <= 0 ? `현금이 이미 마이너스이고 최근 ${F.avgMonths}개월 평균 ${won(-avg)}씩 손실입니다. 남은 대출 한도는 ${won(room)}입니다.` : `최근 ${F.avgMonths}개월 평균 ${won(-avg)}씩 손실입니다. 이대로면 약 ${months}개월 뒤 현금이 바닥납니다. 남은 대출 한도는 ${won(room)}입니다.`] });
  }
  if (s.loan.balance > 0 && s.cash - s.loan.balance >= fixed * F.repayMonths)
    out.push({ kind: 'repay', key: 'loan', goto: fin, facts: [`대출 ${won(s.loan.balance)}, 월 이자 ${won(s.loan.balance * loanRate(s))}`, `갚고 남는 현금 ${won(s.cash - s.loan.balance)}(운영비 ${Math.floor((s.cash - s.loan.balance) / fixed)}개월 치)`],
      text: ['현금에 여유가 있습니다. 대출 상환을 검토해 보시죠.', '대출을 갚을 여유가 있습니다. 이자를 줄이시죠.', `대출 ${won(s.loan.balance)}${J(won(s.loan.balance), '을/를')} 모두 갚아도 운영비 ${F.repayMonths}개월 치 이상이 남습니다. 월 이자 ${won(s.loan.balance * loanRate(s))}${J(won(s.loan.balance * loanRate(s)), '을/를')} 줄일 수 있습니다.`] });
  for (const g of sellingGens(s).filter((x) => x.status === 'onSale' && !x.pricePolicy)) { // 자동 가격을 켠 차는 가격 제안을 하지 않는다(0.8.0)
    const n = gName(s, g), ed = currentEdition(g), base = genBasePrice(s, g), top = base * config.market.overpriceHardAt, go: ExecGoto = { tab: 'garage', id: g.id }, sold = g.sales.at(-1) ?? 0, unit = generationUnitProfit(g, s);
    if (g.lostSales >= 1 && ed.price < top - 1) {
      const p = Math.round(Math.min(top, ed.price * 1.05)), f = priceForecast(s, g.id, p) ?? 0;
      out.push({ kind: 'priceUp', key: String(g.id), goto: go, facts: [`「${n}」 지난달 주문 ${Math.round(g.lastDemand)}대, 판매 ${sold}대`, `가격 ${ed.price.toLocaleString()}만원 → ${p.toLocaleString()}만원(기준가 ${Math.round(base).toLocaleString()}만원)`, `바꾼 가격의 예상 월 판매 ${f}대`],
        text: ['주문이 밀린 차가 있습니다. 값을 조금 올려 볼 만합니다.', `「${n}」${J(n, '은/는')} 주문이 생산량을 넘습니다. 값을 조금 올려 보시죠.`, `「${n}」${J(n, '은/는')} 지난달 주문 ${Math.round(g.lastDemand)}대 가운데 ${sold}대만 만들었습니다. 값을 ${ed.price.toLocaleString()}만원에서 ${p.toLocaleString()}만원으로 올려도 월 ${f}대 안팎이 팔릴 것으로 보입니다.`] });
    } else if (g.lostSales < 1 && ed.price > base * 1.02) {
      const p = Math.round(base), f = priceForecast(s, g.id, p) ?? 0;
      if (f * (unit - (ed.price - p)) > sold * unit)
        out.push({ kind: 'priceDown', key: String(g.id), goto: go, facts: [`「${n}」 가격 ${ed.price.toLocaleString()}만원(기준가의 ${pct(ed.price / base)})`, `지난달 판매 ${sold}대 → 기준가면 약 ${f}대`],
          text: ['값이 비싸 덜 팔리는 차가 있습니다.', `「${n}」${J(n, '은/는')} 값이 비싸 덜 팔립니다. 기준가로 내리는 편이 낫습니다.`, `「${n}」${J(n, '은/는')} 기준가보다 ${pct(ed.price / base - 1)} 비쌉니다. 기준가 ${p.toLocaleString()}만원으로 내리면 월 판매가 ${sold}대에서 ${f}대 안팎으로 늘어 이익도 커집니다.`] });
    }
  }
  return out;
}

function productionIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], f = factoryInfo(s), fac: ExecGoto = { tab: 'company', sub: 'factory' };
  if (f.ratio >= config.bots.expandRatio && f.next && !f.building) {
    const lost = Math.round(f.cars.reduce((a, c) => a + c.backlog, 0));
    out.push({ kind: 'expand', key: String(f.next.level), goto: fac, facts: [`지난달 주문 ${Math.round(f.demand)}대, 생산 한도 ${Math.round(capacityOf(s))}대(${f.ratio.toFixed(1)}배)`, `${f.next.level}등급: 한 달 ${f.next.capacity.toLocaleString()}대, 건설비 ${won(f.next.cost)}, 월 유지비 ${won(f.next.upkeep)}`],
      text: ['주문을 다 소화하지 못하고 있습니다. 공장 증설을 검토해 보시죠.', `주문이 생산 한도를 크게 넘습니다. 공장을 ${f.next.level}등급으로 늘리시죠.`, `지난달 주문이 생산 한도의 ${f.ratio.toFixed(1)}배였고 못 판 차가 ${lost.toLocaleString()}대입니다. 공장을 ${f.next.level}등급으로 늘리면 한 달 ${f.next.capacity.toLocaleString()}대를 만들 수 있습니다(건설비 ${won(f.next.cost)}, 월 유지비 ${won(f.next.upkeep)}).`] });
  }
  const fresh = s.projects.filter((p) => p.kind === 'new').sort((a, b) => a.id - b.id)[0];
  if (fresh && linesUsed(s) >= linesOf(s))
    out.push({ kind: 'lines', key: String(fresh.id), goto: fac, facts: [`생산 라인 ${linesUsed(s)}/${linesOf(s)}개 사용`, `개발 중인 새 차종 「${fresh.name}」`],
      text: ['생산 라인이 모두 차 있습니다.', `생산 라인이 모두 차 있어 「${fresh.name}」${J(fresh.name, '을/를')} 낼 자리가 없습니다.`, `생산 라인 ${linesOf(s)}개를 모두 쓰고 있습니다. 개발 중인 「${fresh.name}」${J(fresh.name, '을/를')} 출시하려면 판매 중인 차 하나를 단종하거나 공장을 늘려야 합니다.`] });
  const a = profitAlloc(s);
  if (a.changed && a.after - a.now >= Math.max(500, a.now * 0.01)) {
    const top = a.gens.map((g, i) => ({ g, u: a.unit[i] })).sort((x, y) => y.u - x.u)[0];
    out.push({ kind: 'alloc', key: 'alloc', goto: fac, facts: [...a.gens.map((g, i) => `「${gName(s, g)}」 대당 이익 ${won(a.unit[i])}, 지난달 주문 ${Math.round(g.lastDemand)}대`), `월 이익 약 ${won(a.now)} → ${won(a.after)}`],
      text: ['생산 배분을 조정하면 이익이 늘어납니다.', `대당 이익이 큰 「${gName(s, top.g)}」부터 만들도록 배분을 바꾸시죠.`, `주문이 생산 한도를 넘습니다. 대당 이익이 큰 「${gName(s, top.g)}」부터 만들면 월 이익이 약 ${won(a.after - a.now)} 늘어납니다.`] });
  }
  return out;
}

function researchIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], rows = researchInfo(s).fields.flatMap((f) => f.techs), res: ExecGoto = { tab: 'company', sub: 'research' };
  const byEvent = new Map<string, { week: number; ids: string[] }>();
  for (const [id, r] of regulatedTechs(s)) if (!s.research.active.some((a) => a.techId === id)) { const e = byEvent.get(r.eventName) ?? { week: r.week, ids: [] }; e.ids.push(id); byEvent.set(r.eventName, e); }
  for (const [ev, { week, ids }] of byEvent) {
    const names = ids.map((id) => `「${techById(id).name}」`).join(', '), when = monthLabel(Math.floor(week / config.time.weeksPerMonth));
    out.push({ kind: 'regulation', key: ev, goto: res, facts: [`${ev}: ${when} 시행`, ...ids.map((id) => { const t = rows.find((x) => x.id === id)!; return `「${t.name}」 ${won(t.cost.money)} + ${t.cost.points.toLocaleString()}점${t.reason ? `(${t.reason})` : ''}`; })],
      text: ['곧 시행될 규제에 대비한 연구가 필요합니다.', `${ev}에 대비해 ${names} 연구를 시작해야 합니다.`, `${ev}${J(ev, '으로/로')} ${when}부터 의무 장비가 생깁니다. ${names} 연구가 아직 시작되지 않았습니다. 늦으면 그때부터 새 차를 개발·출시할 수 없습니다.`] });
  }
  const free = researchSlots(s) - s.research.active.length, t = free > 0 ? recommendTech(s) : undefined;
  if (t)
    out.push({ kind: 'emptySlot', key: t.id, goto: res, facts: [`연구 칸 ${s.research.active.length}/${researchSlots(s)}개 사용`, `「${t.name}」: ${t.effects}`, `${won(t.cost.money)} + ${t.cost.points.toLocaleString()}점${t.weeksLeft === null ? '' : `, 지금 점수로 약 ${t.weeksLeft}주`}`],
      text: ['연구 칸이 비어 있습니다.', `연구 칸이 비어 있습니다. 다음 연구로 「${t.name}」${J(t.name + '」', '을/를')} 권합니다.`, `연구 칸 ${free}개가 비어 있습니다. 다음 연구로 「${t.name}」(${t.effects})${J(')', '을/를')} 권합니다. 비용 ${won(t.cost.money)}${t.weeksLeft === null ? '' : `, 지금 점수로 약 ${t.weeksLeft}주`}입니다.`] });
  return out;
}

function marketIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], M = X.market, selling = new Set(sellingGens(s).filter((g) => g.status === 'onSale').map((g) => g.body));
  const best = unlockedBodies(s).filter((b) => !selling.has(b.id)).map((b) => {
    const mix = MARKET[REGION].mix[b.id] ?? {}, known = new Set(s.knownCombos.filter((k) => k.startsWith(`${b.id}:`)).map((k) => k.split(':')[1]));
    const seg = [...SEGMENTS].sort((x, y) => (mix[y.id] ?? 0) * (COMPAT[b.id]?.[y.id] ?? 1) - (mix[x.id] ?? 0) * (COMPAT[b.id]?.[x.id] ?? 1) || Number(known.has(y.id)) - Number(known.has(x.id)) || (x.id < y.id ? -1 : 1))[0].id;
    const idea = marketIdea(s, b.id, seg);
    return { body: b.id, seg, idea, v: idea.sales * idea.unitProfit };
  }).filter((x) => x.idea.sales >= M.minSales).sort((a, b) => b.v - a.v || (a.body < b.body ? -1 : 1))[0];
  if (best) {
    const bn = bodyById(best.body).name, sn = segmentById(best.seg).name, main = segmentById(best.idea.mainSegment).name, i = best.idea;
    const fit = i.known ? `전에 「${i.known.carName}」${J(i.known.carName, '으로/로')} 이 조합을 내 봤을 때 평론 ${i.known.reviewAvg.toFixed(1)}이었습니다(궁합 ${i.known.mark}).` : (COMPAT[best.body]?.[best.seg] ?? 1) >= 1 ? '아직 내 보지 않은 조합이지만 잘 맞을 것으로 보입니다.' : '';
    const rival = i.weakRival ? `경쟁사 ${i.weakRival}${J(i.weakRival, '이/가')} 약합니다` : '경쟁사들이 고르게 버팁니다';
    out.push({ kind: 'build', key: `${best.body}:${best.seg}`, goto: { tab: 'dev', sub: 'plan' }, facts: [`${bn}: 손님이 가장 많은 고객층 ${main}`, `기준가 ${i.price.toLocaleString()}만원에 내면 예상 월 판매 ${i.sales}대`, i.weakRival ? `가장 약한 경쟁사 ${i.weakRival}` : '경쟁사 강약이 고름'],
      text: ['수요는 큰데 우리 차가 없는 차급이 있습니다. 새 차종을 검토해 보시죠.', `${bn}${J(bn, '을/를')} ${sn}용으로 내 보는 건 어떨까요. 이 차급은 수요가 큰데 우리 차가 없습니다.`,
        `${bn}${J(bn, '을/를')} ${sn}용으로 내 보는 건 어떨까요. 이 차급은 ${main} 손님이 가장 많고 ${rival}. 기준가에 내면 월 ${i.sales}대 안팎이 예상됩니다.${fit ? ` ${fit}` : ''}`] });
  }
  for (const g of sellingGens(s).filter((x) => x.status === 'onSale')) {
    const n = gName(s, g), mk = config.awareness.marketingCost, go: ExecGoto = { tab: 'garage', id: g.id }, q = grade(currentEdition(g).stats.Q, yearOf(s.week));
    if (g.awareness < M.lowAwareness && g.marketing < mk.length - 1) {
      const a = awarenessTarget(s.reputation, g.marketing, q), b = awarenessTarget(s.reputation, g.marketing + 1, q);
      out.push({ kind: 'adUp', key: String(g.id), goto: go, facts: [`「${n}」 인지도 ${pct(g.awareness)}, 광고 ${g.marketing}등급`, `광고 ${g.marketing + 1}등급이면 목표 인지도 ${pct(a)} → ${pct(b)}, 월 ${won(mk[g.marketing + 1])}`],
        text: ['알려지지 않은 차가 있습니다. 광고를 검토해 보시죠.', `「${n}」${J(n, '은/는')} 인지도가 낮습니다. 광고를 늘리시죠.`, `「${n}」 인지도가 ${pct(g.awareness)}로 낮습니다. 광고를 ${g.marketing + 1}등급으로 올리면 목표 인지도가 ${pct(a)}에서 ${pct(b)}로 오릅니다(월 ${won(mk[g.marketing + 1])}).`] });
    } else if (g.marketing >= 2 && g.lostSales >= 1) {
      const save = mk[g.marketing] - mk[g.marketing - 1];
      out.push({ kind: 'adDown', key: String(g.id), goto: go, facts: [`「${n}」 광고 ${g.marketing}등급, 지난달 못 판 주문 ${Math.round(g.lostSales)}대`, `한 단계 낮추면 월 ${won(save)} 절약`],
        text: ['광고비를 아낄 수 있는 차가 있습니다.', `「${n}」${J(n, '은/는')} 이미 잘 팔립니다. 광고를 줄여도 됩니다.`, `「${n}」${J(n, '은/는')} 이미 주문이 생산량을 넘습니다. 광고를 한 단계 낮추면 월 ${won(save)}${J(won(save), '을/를')} 아낄 수 있습니다.`] });
    }
  }
  return out;
}

const IDEAS: Record<ExecRole, (s: CarState) => Idea[]> = { hr: hrIdeas, product: productIdeas, finance: financeIdeas, production: productionIdeas, research: researchIdeas, market: marketIdeas };

// ---------- 상태 바꾸기 ----------
/** Game이 넘기는 손잡이: 일회성 지출, 명령 실행(검증 포함, 기록에는 남지 않음), 새 이름 */
export interface ExecCtx { s: CarState; rng: Rng; spend(cost: number): void; run(cmd: Command): CommandResult; newName(): string }

function addReport(s: CarState, role: ExecRole, kind: string, text: string, facts: string[], goto: ExecGoto | null, auto: boolean, replacementId: number | null = null, key = ''): void {
  const e = s.execs!, seat = e.seats[role];
  e.reports.push({ id: s.nextId++, week: s.week, role, execName: seat?.staff.name ?? '', kind, key, text, facts, goto, unread: true, auto, replacementId });
  if (e.reports.length > X.reportsMax) e.reports.splice(0, e.reports.length - X.reportsMax);
}
const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };

/** 임원 명령. 임원 명령이 아니면 null */
export function execCommand(c: ExecCtx, cmd: Command): CommandResult | null {
  const s = c.s;
  const roleErr = (r: unknown) => (EXEC_ROLES.includes(r as ExecRole) ? null : '없는 임원 자리입니다.');
  const seatErr = (r: ExecRole) => (s.execs?.seats[r] ? '이미 임원이 있는 자리입니다.' : seated(s).length >= seatsOf(s) ? `임원 자리 ${seatsOf(s)}석이 모두 찼습니다.${nextSeatHq(s) ? ` 본사 ${nextSeatHq(s)}등급부터 자리가 늘어납니다.` : ''}` : null);
  switch (cmd.type) {
    case 'appointExec': {
      const err = roleErr(cmd.role) ?? seatErr(cmd.role); if (err) return fail(err);
      const x = s.staff.find((y) => y.id === cmd.staffId); if (!x) return fail('없는 직원입니다.');
      s.execs ??= emptyExecs();
      x.projectId = null; x.lab = false; // 현업에서 빠진다
      s.staff = s.staff.filter((y) => y !== x);
      s.execs.seats[cmd.role] = { staff: x, hired: false, since: s.week }; noteExec(x, cmd.role, s.week, true);
      for (const r of s.execs.replacements) if (r.staffId === x.id && (r.status === 'proposed' || r.status === 'approved' || r.status === 'waiting')) { r.status = 'cancelled'; r.waitingFor = null; }
      return OK;
    }
    case 'dismissExec': {
      const err = roleErr(cmd.role); if (err) return fail(err);
      const seat = s.execs?.seats[cmd.role]; if (!seat) return fail('비어 있는 자리입니다.');
      delete s.execs!.seats[cmd.role]; s.execs!.delegations[cmd.role] = []; noteExec(seat.staff, cmd.role, s.week, false);
      if (seat.hired) c.spend(severanceOf(execPayOf(s, seat.staff, true))); // 외부 임원은 회사를 떠난다(퇴직금)
      else { seat.staff.projectId = null; seat.staff.lab = false; s.staff.push(seat.staff); s.staff.sort((a, b) => a.id - b.id); } // 원래 직무로 복귀
      return OK;
    }
    case 'postExecJob': {
      const err = roleErr(cmd.role) ?? seatErr(cmd.role); if (err) return fail(err);
      if (s.execs?.candidates.some((x) => x.role === cmd.role)) return fail('이미 공고한 후보가 있습니다. 먼저 뽑거나 기다리세요.');
      if (s.cash < X.postCost) return fail('현금이 모자랍니다.');
      s.execs ??= emptyExecs();
      c.spend(X.postCost);
      const bonus = Math.floor(repEffect(s.reputation) / X.repBonusDiv);
      for (let i = 0; i < X.candidates; i++) {
        const skill = Math.min(100, c.rng.intIn(X.hireSkillMin, X.hireSkillMax) + bonus);
        s.execs.candidates.push({ id: s.nextId++, name: c.newName(), role: cmd.role, skill, pay: Math.round(salaryOf(skill) * X.hiredPayMult), expiresWeek: s.week + X.expireWeeks });
      }
      return OK;
    }
    case 'hireExec': {
      const err = roleErr(cmd.role) ?? seatErr(cmd.role); if (err) return fail(err);
      const cd = s.execs?.candidates.find((x) => x.id === cmd.candidateId && x.role === cmd.role); if (!cd) return fail('없는 후보입니다.');
      const e = s.execs!;
      e.candidates = e.candidates.filter((x) => x.role !== cmd.role);
      e.seats[cmd.role] = { staff: startHist({ id: cd.id, name: cd.name, role: EXEC_BASE_ROLE[cmd.role], ability: cd.skill, potential: cd.skill, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false }, s.week), hired: true, since: s.week };
      noteExec(e.seats[cmd.role]!.staff, cmd.role, s.week, true);
      return OK;
    }
    case 'setDelegation': {
      const err = roleErr(cmd.role); if (err) return fail(err);
      if (!DELEGATIONS[cmd.role].some((d) => d.key === cmd.key)) return fail('이 자리에는 그런 맡기기가 없습니다.');
      const seat = s.execs?.seats[cmd.role];
      if (cmd.on) { if (!seat) return fail('임원이 없습니다.'); const k = execSkill(cmd.role, seat.staff); if (k < X.delegateSkill) return fail(`임원 능력이 ${X.delegateSkill} 이상이어야 맡길 수 있습니다(지금 ${k}).`); }
      s.execs ??= emptyExecs();
      const list = (s.execs.delegations[cmd.role] ?? []).filter((k) => k !== cmd.key);
      s.execs.delegations[cmd.role] = cmd.on ? [...list, cmd.key] : list;
      return OK;
    }
    case 'dismissReport': {
      const e = s.execs, r = e?.reports.find((x) => x.id === cmd.id); if (!r) return fail('없는 보고입니다.');
      e!.reports = e!.reports.filter((x) => x !== r);
      const ck = `${r.role}:${r.kind}:${r.key}`; e!.cooldown[ck] = Math.max(e!.cooldown[ck] ?? 0, s.week + X.ignoredMonths * config.time.weeksPerMonth); // 지운 제안은 더 오래 다시 내지 않는다
      const rp = e!.replacements.find((x) => x.id === r.replacementId && x.status === 'proposed'); if (rp) reject(s, rp);
      return OK;
    }
    case 'markReportsRead': for (const r of s.execs?.reports ?? []) r.unread = false; return OK;
    case 'approveReplacement': case 'rejectReplacement': case 'cancelReplacement': {
      const rp = s.execs?.replacements.find((x) => x.id === cmd.id); if (!rp) return fail('없는 교체 제안입니다.');
      if (cmd.type === 'cancelReplacement') { if (rp.status !== 'approved' && rp.status !== 'waiting') return fail('예약된 교체가 아닙니다.'); rp.status = 'cancelled'; rp.waitingFor = null; return OK; }
      if (rp.status !== 'proposed') return fail('이미 답한 제안입니다.');
      if (cmd.type === 'rejectReplacement') { reject(s, rp); return OK; }
      rp.status = 'approved'; rp.nextWeek = s.week; rp.waitingFor = null;
      return OK;
    }
    default: return null;
  }
}
const reject = (s: CarState, rp: Replacement) => { rp.status = 'cancelled'; rp.waitingFor = null; s.execs!.rejected[rp.staffId] = s.week + X.replace.rejectYears * config.time.monthsPerYear * config.time.weeksPerMonth; };

/** 매주: 임원 후보 만료, 예약된 교체 고용 진행(개발 중이면 끝날 때까지 대기) */
export function execWeek(c: ExecCtx, ev: GameEvent[]): void {
  const s = c.s, e = s.execs;
  if (!e) return;
  for (const rp of e.replacements.filter((r) => (r.status === 'approved' || r.status === 'waiting') && s.week >= r.nextWeek).sort((a, b) => a.id - b.id)) runReplacement(c, rp, ev);
}
/** 매주 week가 오른 뒤: 기다린 임원 후보가 떠난다 */
export function execExpire(s: CarState, ev: GameEvent[]): void {
  const e = s.execs; if (!e?.candidates.length) return;
  const gone = e.candidates.filter((x) => s.week >= x.expiresWeek);
  if (gone.length) { e.candidates = e.candidates.filter((x) => s.week < x.expiresWeek); ev.push({ kind: 'company', text: `임원 후보 ${gone.length}명이 다른 회사로 갔습니다.` }); }
}

function runReplacement(c: ExecCtx, rp: Replacement, ev: GameEvent[]): void {
  const s = c.s, x = s.staff.find((y) => y.id === rp.staffId), sk = SKILL_KO[rp.staffRole], H = config.staff.hire;
  const end = (status: Replacement['status'], kind: string, text: string) => { rp.status = status; rp.waitingFor = null; addReport(s, 'hr', kind, text, [], staffGoto(x?.id), true, rp.id); ev.push({ kind: 'replacement', text }); };
  if (!x) return end('cancelled', 'replaceCancel', `${rp.staffName}${J(rp.staffName, '이/가')} 이미 회사를 떠나 교체를 취소했습니다.`);
  if (!s.execs!.seats.hr) return end('cancelled', 'replaceCancel', `인사 임원이 없어 ${rp.staffName} 교체를 취소했습니다.`);
  if (!weakCapped(s, x)) return end('cancelled', 'replaceCancel', `${x.name}${J(x.name, '이/가')} 더는 교체할 이유가 없어(${sk} ${x.ability}, 같은 직무 평균과의 차이가 줄었습니다) 교체를 취소했습니다.`);
  if (x.projectId !== null) { // 개발 중인 직원은 그 개발이 끝난 주에 진행
    const p = s.projects.find((q) => q.id === x.projectId);
    if (rp.status !== 'waiting') addReport(s, 'hr', 'replaceWait', `${x.name}${J(x.name, '이/가')} 「${p?.name ?? ''}」 개발 중이라 개발이 끝나면 교체를 진행합니다.`, [], staffGoto(x.id), true, rp.id);
    rp.status = 'waiting'; rp.waitingFor = `「${p?.name ?? ''}」 개발이 끝나면`;
    return;
  }
  const tier = replaceTier(s, rp.minAbility), cost = H.postCost[tier - 1];
  if (s.cash <= monthlyFixed(s) * X.replace.cashMonths + cost) { // 실행 때 현금 조건을 다시 본다
    if (!rp.held) addReport(s, 'hr', 'replaceHold', `현금이 운영비 ${X.replace.cashMonths}개월 치에 못 미쳐 ${x.name} 교체를 보류합니다. 현금이 늘면 진행합니다.`, [`현금 ${won(s.cash)}`, `운영비 ${X.replace.cashMonths}개월 치 ${won(monthlyFixed(s) * X.replace.cashMonths)}`], staffGoto(x.id), true, rp.id);
    rp.held = true; rp.status = 'approved'; rp.waitingFor = '현금이 늘면'; rp.nextWeek = s.week + config.time.weeksPerMonth;
    return;
  }
  rp.held = false;
  c.spend(cost); // 인사 임원이 공고를 낸다(후보는 채용 화면에 오지 않고 바로 고른다)
  const bonus = repBonus(s);
  const cands = Array.from({ length: H.candidates }, () => { const ability = Math.min(100, c.rng.intIn(H.abilityMin[tier - 1], H.abilityMax[tier - 1]) + bonus); return { ability, potential: Math.min(100, ability + c.rng.intIn(H.potentialMin, H.potentialMax)) }; });
  const top = rp.minAbility + X.replace.capGain, best = cands.filter((a) => a.ability >= rp.minAbility && a.ability <= top).sort((a, b) => b.ability - a.ability)[0]; // 0.8.0: 기준 + capGain을 넘는 후보는 이 자리 조건으로 오지 않는다(교체로 얻는 능력 폭 제한)
  const why = `${sk} ${rp.minAbility}~${top}에 맞는 후보가 없어`, seen = `후보 ${cands.map((a) => a.ability).sort((a, b) => b - a).join('·')}`;
  rp.tries++;
  if (best) {
    const id = s.nextId++, name = c.newName();
    c.spend(severanceOf(salaryOf(x.ability)));
    s.staff = s.staff.filter((y) => y !== x);
    s.staff.push(startHist({ id, name, role: x.role, ability: best.ability, potential: best.potential, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false }, s.week));
    rp.nextWeek = s.week;
    return end('done', 'replaceDone', `${x.name} → ${name}(${sk} ${best.ability}). 공고비 ${won(cost)}, 퇴직금 ${won(severanceOf(salaryOf(x.ability)))}.`);
  }
  if (rp.tries < X.replace.maxTries) {
    addReport(s, 'hr', 'replaceFail', `${why} ${x.name}${J(x.name, '을/를')} 교체하지 않았습니다(${seen}). 공고비 ${won(cost)}${J(won(cost), '이/가')} 들었습니다. ${X.replace.retryWeeks}주 뒤 한 번 더 공고합니다.`, [], staffGoto(x.id), true, rp.id);
    rp.status = 'approved'; rp.nextWeek = s.week + X.replace.retryWeeks; rp.waitingFor = `${X.replace.retryWeeks}주 뒤 다시 공고`;
    return;
  }
  end('failed', 'replaceFail', `두 번 공고했지만 ${why} ${x.name} 교체를 그만둡니다(${seen}, 공고비 ${won(cost)}).`);
}

/** 월 결산 뒤: 맡기기 실행 → 임원별 제안(최대 2건, 재발행 간격) */
export function execMonth(c: ExecCtx, ev: GameEvent[]): void {
  const s = c.s, e = s.execs;
  if (!e || !seated(s).length) return;
  const before = e.reports.length ? e.reports[e.reports.length - 1].id : -1;
  delegate(c);
  for (const r of e.replacements) if (r.status === 'proposed' && !s.staff.some((x) => x.id === r.staffId)) { r.status = 'cancelled'; r.waitingFor = null; }
  for (const [role, x] of seated(s)) {
    const tier = execTier(execSkill(role, x));
    let n = 0;
    for (const idea of IDEAS[role](s)) {
      if (n >= X.perExec) break;
      const ck = `${role}:${idea.kind}:${idea.key}`;
      if ((e.cooldown[ck] ?? -1) > s.week) continue;
      e.cooldown[ck] = s.week + X.reissueMonths * config.time.weeksPerMonth;
      const rid = idea.issue ? idea.issue() : null;
      addReport(s, role, idea.kind, idea.text[tier - 1], idea.facts.slice(0, tier === 1 ? 1 : tier === 2 ? 2 : idea.facts.length), idea.goto, false, rid, idea.key);
      n++;
    }
  }
  for (const k of Object.keys(e.cooldown)) if (e.cooldown[k] <= s.week) delete e.cooldown[k]; // 지난 기록은 지운다(저장 크기)
  const count = e.reports.filter((r) => r.id > before).length;
  if (count) ev.push({ kind: 'execReport', count, text: `임원 보고 ${count}건이 보고함에 들어왔습니다.` });
}

/** 맡기기: 인사(자동 휴식·자동 교육) → 생산(배분) → 연구소장(빈 칸 연구). 실행 내역은 보고함에(auto) */
function delegate(c: ExecCtx): void {
  const s = c.s, fixed = () => monthlyFixed(s);
  if (delegationOn(s, 'hr', 'autoRest'))
    for (const x of [...s.staff].sort((a, b) => a.id - b.id).filter((y) => y.condition < config.staff.condition.low && !isAway(y, s.week))) {
      const w = X.hr.restWeeks;
      if (c.run({ type: 'rest', staffId: x.id, weeks: w }).ok) addReport(s, 'hr', 'autoRest', `${x.name}${J(x.name, '이/가')} 지쳐 ${w}주 쉬게 했습니다(컨디션 ${pct(x.condition)}).`, [], staffGoto(x.id), true);
    }
  if (delegationOn(s, 'hr', 'autoTrain')) {
    const H = X.hr;
    for (const x of [...s.staff].filter((y) => y.projectId === null && y.ability < y.potential).sort((a, b) => (b.potential - b.ability) - (a.potential - a.ability) || a.id - b.id)) {
      if (s.staff.filter((y) => isTraining(y, s.week)).length >= H.trainMax) break;
      if (trainError(s, x) || s.cash - trainCost(x.ability) < fixed() * H.trainCashMonths) continue;
      const a0 = x.ability, cost = trainCost(x.ability);
      if (c.run({ type: 'train', staffId: x.id }).ok) addReport(s, 'hr', 'autoTrain', `${x.name}${J(x.name, '을/를')} 교육에 보냈습니다(${SKILL_KO[x.role]} ${a0} → ${x.ability}, 교육비 ${won(cost)}).`, [], staffGoto(x.id), true);
    }
  }
  if (delegationOn(s, 'production', 'autoAlloc')) {
    const a = profitAlloc(s);
    if (a.changed) {
      for (const g of a.gens) c.run({ type: 'setAllocation', generationId: g.id, share: null });
      a.gens.forEach((g, i) => { if (a.shares[i] !== null) c.run({ type: 'setAllocation', generationId: g.id, share: a.shares[i] }); });
      addReport(s, 'production', 'autoAlloc', a.shares.every((x) => x === null) ? '주문이 생산 한도 안이라 배분을 주문 비례(자동)로 돌렸습니다.' : `대당 이익이 큰 차부터 만들도록 배분을 바꿨습니다: ${a.gens.map((g, i) => `「${gName(s, g)}」 ${pct(a.shares[i] ?? 0)}`).join(', ')}.`, [], { tab: 'company', sub: 'factory' }, true);
    }
  }
  if (delegationOn(s, 'research', 'autoResearch'))
    for (let t = recommendTech(s, fixed() * X.research.cashMonths); t && s.research.active.length < researchSlots(s); t = recommendTech(s, fixed() * X.research.cashMonths)) {
      if (!c.run({ type: 'startResearch', techId: t.id }).ok) break;
      addReport(s, 'research', 'autoResearch', `빈 연구 칸에 「${t.name}」 연구를 시작했습니다(${won(t.cost.money)}${t.requiredBy ? ', 규제에 필요한 기술' : ''}).`, [], { tab: 'company', sub: 'research' }, true);
    }
}
