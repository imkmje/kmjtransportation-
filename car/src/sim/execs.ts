// 임원(0.7.0, 설계서 9.7): 자리·임명·채용, 월 결산 제안(보고함), 위임, 교체 고용.
// 제안 수치는 화면이 쓰는 조회(queries·research·company)와 같은 함수로 계산한다. 상태를 바꾸는 것은 execCommand·execWeek·execMonth뿐
import { won } from './won';
import { config } from '../config';
import { COMPAT, MARKET, SEGMENTS, bodyById, optionById, segmentById, techById } from '../data';
import { equipOf, expectEffect, recommendedEquip, stdOf } from './equip';
import { grade, payOf, salaryOf, unitCost } from './cars';
import { allocate, capacityOf, costMultOf, devTeams, isAway, isDevRole, isTraining, linesOf, regularStaff, repEffect, severanceOf, staffCap, staffCount, teamsUsed, trainCost, trainError, upkeepOf } from './company';
import { loanLimit, loanRate } from './finance';
import { linesUsed, noteFormer, sellingGens } from './game';
import { criticScores } from './reviews';
import { genUnit, landedNow, regionName, regionPrice, regionViews } from './world';
import { josa } from './josa';
import { compareToPrev, fullChangeEligibility, latestGen } from './lifecycle';
import { faceliftWeekCost, fullChangeCostMult, withRequired } from './dev';
import { derivativePlan, nameplateOfGen } from './derive';
import { REGION, awarenessTarget, basePriceOf, carBasePrice, genBasePrice, currentEdition, monthlyDemand, toSaleCar } from './market';
import { advice, comboNotes, factoryInfo, faceliftPreview, generationUnitProfit, lifeBar, planPreview, priceForecast } from './queries';
import { ptCostAdd, regulatedTechs, researchInfo, researchSlots, unlockedBodies } from './research';
import { mean } from './reviews';
import { noteExec, startHist } from './history';
import { staffBrief } from './insight';
import type { Rng } from './rng';
import { monthLabel, monthOf, monthTime, yearOf } from './time';
import type { CarState, Command, CommandResult, ExecGoto, ExecRole, ExecState, GameEvent, Generation, Nameplate, Project, ProjectSpec, Replacement, Role, Staff } from './types';

const X = config.exec;
export const EXEC_ROLES: ExecRole[] = ['hr', 'product', 'finance', 'production', 'research', 'market', 'world']; // world(5.5.0): 해외 담당(해외 권역에 진출한 판에서만 자리가 생긴다)
export const EXEC_TITLE: Record<ExecRole, string> = { hr: '인사 임원', product: '기획 임원', finance: '재무 임원', production: '생산 임원', research: '연구소장', market: '시장 조사 임원', world: '해외 담당 임원' };
/** 외부에서 뽑은 임원의 직무(능력 계산 기준) */
const EXEC_BASE_ROLE: Record<ExecRole, Role> = { hr: 'sales', product: 'designer', finance: 'sales', production: 'tester', research: 'engineer', market: 'sales', world: 'sales' };
const ROLE_KO: Record<Role, string> = { designer: '디자이너', engineer: '엔지니어', tester: '테스터', sales: '영업' };
const SKILL_KO: Record<Role, string> = { designer: '디자인', engineer: '기술', tester: '꼼꼼함', sales: '영업력' };
/** 위임 항목(자리별). note: 화면의 한 줄 설명, warn: 되돌리기 어려운 결정이라는 안내. 가격은 자동 가격 정책, 출시는 세대교체 위임(1.3.0), 해고는 자동 해고(1.4.0)로만 위임한다 */
const AS = config.exec.autoStaff;
export const DELEGATIONS: Record<ExecRole, { key: string; label: string; note?: string; warn?: string }[]> = {
  hr: [{ key: 'autoRest', label: '지친 직원 자동 휴식' }, { key: 'autoTrain', label: '성장 여지가 있는 직원 자동 교육' },
    { key: 'autoHire', label: '빈자리 자동 채용', note: '정원에 빈자리가 있고 현금에 여유가 있으면 가장 부족한 직무를 뽑습니다. 같은 직무 직원 평균 능력 이상인 후보를 뽑고, 공고로 평균에 닿기 어려우면 가장 높은 등급 공고에서 가장 나은 후보를 뽑습니다.' },
    { key: 'autoFire', label: '성장이 멈춘 직원 자동 해고', note: `성장 한계에 닿았고 같은 직무 평균보다 능력이 ${config.exec.hr.weakGap} 이상 낮은 직원을 한 달에 한 명까지 내보냅니다. 개발 중·교육·휴식 중이거나 입사 ${AS.tenureMonths}개월이 안 된 직원은 제외합니다.`,
      warn: `해고는 되돌릴 수 없습니다. 퇴직금이 나가고, 내보낸 직원은 ${config.former.months}개월 동안만 채용 화면의 전 직원 목록에서 다시 채용할 수 있습니다(채용비 월급 ${config.former.feeMonths}개월 치).` },
    { key: 'autoPoach', label: '이직 제안 자동 대응', note: '경쟁사가 직원에게 이직을 제안하면, 그 직원 능력이 같은 직무 평균 이상일 때 월급을 올려 붙잡습니다. 어느 쪽이든 직원은 남습니다(3.5.0).' }],
  product: [], finance: [{ key: 'autoPriceWar', label: '가격 전쟁 자동 대응', note: '경쟁사가 가격을 내리면, 버틸 때 줄어드는 판매가 인하 폭보다 크면 따라 내리고 아니면 가격을 지킵니다(3.5.0).' }],
  production: [{ key: 'autoAlloc', label: '생산 배분 자동 조정' }],
  research: [{ key: 'autoResearch', label: '빈 연구 칸에 추천 연구 시작' }],
  market: [{ key: 'autoMotor', label: '모터스포츠 예산 자동 조정', note: `해마다 2월 결산에 참가할 수 있는 모터스포츠 급에 모두 나가되, 연 예산 합이 지금 현금의 ${Math.round(config.motorsport.autoShare * 100)}%를 넘지 않게 가장 비싼 급부터 예산 단계를 낮춥니다(가장 작은 예산도 넘으면 그 급은 쉽니다). 출전 차가 없으면 평론이 가장 높은 차를 고르고, 우승 기념 한정판은 다 팔아 남는 돈이 있고 운영비 6개월 치가 남으면 냅니다(5.6.0).` }],
  world: [{ key: 'autoWorld', label: '해외 운영 자동 조정', note: '권역마다 자동 수출을 켜 두고, 손으로 정한 권역 가격을 자동 가격으로 돌리고, 현지 공장의 생산 차종을 자동(관세·운송비가 큰 차부터)으로 둡니다. 무역 협정 결정에는 앞당겨 아끼는 관세가 로비 비용보다 크고 운영비 6개월 치가 남으면 로비합니다(5.5.0).' }],
};
/** 보고 종류별 제목 */
const KIND_TITLE: Record<string, string> = {
  fire: '해고 권유', replace: '교체 고용 제안', train: '교육 권유', rest: '휴식 권유', hire: '채용 권유',
  facelift: '페이스리프트 적기', fullchange: '풀체인지 적기', discontinue: '단종 권고',
  cashOut: '현금 부족 예고', repay: '대출 상환', priceUp: '가격 올리기', priceDown: '가격 내리기',
  expand: '공장 증설', lines: '생산 라인 부족', alloc: '생산 배분',
  regulation: '규제 대비 연구', emptySlot: '빈 연구 칸',
  build: '새 차종 제안', adUp: '광고 늘리기', adDown: '광고 줄이기',
  autoPriceWar: '가격 전쟁 대응', autoPoach: '이직 제안 대응', autoRest: '자동 휴식', autoTrain: '자동 교육', autoHire: '자동 채용', autoHireFail: '자동 채용 보류', autoFire: '자동 해고', autoResearch: '자동 연구', autoAlloc: '자동 생산 배분',
  autoFullChange: '자동 풀체인지', autoFacelift: '자동 페이스리프트', autoDerive: '파생 모델 세대교체', autoGenWait: '세대교체 대기', autoLaunch: '자동 출시', autoLaunchFail: '자동 출시 보류',
  plant: '현지 공장 건설', worldOffice: '판매 법인 투자', worldOpen: '해외 진출', autoWorld: '해외 운영 자동 조정', // 5.5.0
  autoMotor: '모터스포츠 예산 자동 조정', // 5.6.0
  replaceDone: '교체 고용 완료', replaceFail: '교체 고용 실패', replaceHold: '교체 고용 보류', replaceCancel: '교체 고용 취소', replaceWait: '교체 고용 대기',
};

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const J = josa;

// ---------- 자리·능력·월급 ----------
export const seatsOf = (s: CarState): number => X.seats[s.hqLevel - 1] + (s.world?.regions.length ? 1 : 0); // 5.5.0 해외 권역에 진출하면 해외 담당 자리가 하나 늘어난다
/** 이 판에서 보이는 임원 자리(해외 담당은 진출한 판에서만) */
export const execRolesOf = (s: CarState): ExecRole[] => EXEC_ROLES.filter((r) => r !== 'world' || !!s.world?.regions.length || !!s.execs?.seats.world);
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
/** 운영비(월): 직원 월급 + 임원 월급 + 본사·공장 유지비. 위임·교체 고용의 현금 기준 */
export const monthlyFixed = (s: CarState): number => s.staff.reduce((a, x) => a + payOf(x), 0) + execPay(s) + upkeepOf(s);

const holder = (s: CarState, r: ExecRole) => s.execs?.seats[r];
export const delegationOn = (s: CarState, r: ExecRole, key: string): boolean => !!holder(s, r) && !!s.execs?.delegations[r]?.includes(key) && execSkill(r, holder(s, r)!.staff) >= X.delegateSkill;
const emptyExecs = (): ExecState => ({ seats: {}, delegations: {}, candidates: [], reports: [], cooldown: {}, replacements: [], rejected: {} });

// ---------- 조회(화면) ----------
export function execInfo(s: CarState) {
  const used = seated(s).length, seats = seatsOf(s);
  return {
    seats, used, postCost: X.postCost, delegateSkill: X.delegateSkill, nextSeatHq: nextSeatHq(s), tiers: X.tiers,
    roles: execRolesOf(s).map((role) => {
      const seat = s.execs?.seats[role], skill = seat ? execSkill(role, seat.staff) : 0;
      return {
        role, title: EXEC_TITLE[role],
        holder: seat ? { staffId: seat.staff.id, name: seat.staff.name, skill, tier: execTier(skill), hired: seat.hired, pay: execPayOf(s, seat.staff, seat.hired), staffRole: seat.staff.role } : null,
        canFill: !seat && used < seats, // 빈 자리(임명·채용 가능). 자리가 다 찼으면 false(잠김)
        delegations: DELEGATIONS[role].map((d) => {
          const whyNot = !seat ? '임원이 없습니다.' : skill < X.delegateSkill ? `임원 능력이 ${X.delegateSkill} 이상이어야 위임할 수 있습니다(지금 ${skill}).` : null;
          return { key: d.key, label: d.label, note: d.note ?? null, warn: d.warn ?? null, on: !!s.execs?.delegations[role]?.includes(d.key) && !whyNot, available: !whyNot, whyNot };
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
  const team = regularStaff(s).filter((x) => isDevRole(x.role));
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

/** 4.1.0 대당 이익: 수출하는 차는 지난달 국내·권역 주문 비율로 섞은 값(권역은 권역 가격 − 원가 − 관세·운송비). 수출이 없으면 국내 대당 이익 그대로.
 *  (4.0.0까지는 국내 값만 봐서, 권역에서 잘 팔리는 값싼 차가 생산 배분에서 밀렸다) */
function blendedUnit(s: CarState, g: Generation): number {
  const dom = generationUnitProfit(g, s), rows = Object.entries(g.world ?? {}).filter(([, w]) => w.on && w.demand > 0);
  if (!rows.length) return dom;
  const y = yearOf(s.week), m = monthOf(s.week), { uc, opRev } = genUnit(s, g, y), ex = (w: { demand: number; loc?: number }) => Math.max(0, w.demand - (w.loc ?? 0)), exp = rows.reduce((a, [, w]) => a + ex(w), 0), domD = Math.max(0, g.lastDemand - exp); // 5.5.0 현지 공장 몫은 국내 공장 배분에서 뺀다
  const sum = rows.reduce((a, [rid, w]) => a + ex(w) * (regionPrice(s, g, rid) + opRev - uc - landedNow(s, rid, g.body, uc, m)), domD * dom);
  return sum / Math.max(1e-9, domD + exp);
}
/** 생산 배분 제안·자동 조정: 주문이 한도를 넘으면 대당 이익이 큰 차부터 채운다(아니면 모두 자동). now·after: 지난달 주문 기준 월 이익(대당 이익 × 만드는 대수) */
export function profitAlloc(s: CarState) {
  const gens = sellingGens(s), cap = capacityOf(s), demand = gens.map((g) => g.lastDemand), total = demand.reduce((a, b) => a + b, 0);
  const unit = gens.map((g) => blendedUnit(s, g));
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
const roleAvg = (s: CarState, x: Staff): number | null => { const o = regularStaff(s).filter((y) => y.role === x.role && y.id !== x.id); return o.length ? mean(o.map((y) => y.ability)) : null; }; // 4.1.0 전담팀원은 비교에서 뺀다
/** 성장 한계에 닿았고 같은 직무 평균보다 weakGap 이상 낮다(전담팀원은 대상이 아니다) */
export const weakCapped = (s: CarState, x: Staff): boolean => { const a = roleAvg(s, x); return !x.elite && x.ability >= x.potential && a !== null && x.ability <= a - X.hr.weakGap; };
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

/** 부족한 직무 순서(채용 권유·자동 채용): 개발팀 구성(디자이너 1·엔지니어 2·테스터 1, 본사 2등급부터 영업 1) 대비 인원 비율이 낮은 순 */
function lackingRoles(s: CarState): { role: Role; have: number; want: number }[] {
  const want: Record<Role, number> = { designer: 1, engineer: 2, tester: 1, sales: s.hqLevel >= 2 ? 1 : 0 }, have = (r: Role) => regularStaff(s).filter((x) => x.role === r).length;
  return (['designer', 'engineer', 'tester', 'sales'] as Role[]).filter((k) => want[k] > 0).sort((a, b) => have(a) / want[a] - have(b) / want[b]).map((role) => ({ role, have: have(role), want: want[role] }));
}
/** 인사 임원이 낸 공고의 후보(교체 고용·자동 채용). 후보는 채용 화면에 오지 않고 임원이 바로 고른다 */
function rollCands(c: ExecCtx, tier: number): { ability: number; potential: number }[] {
  const H = config.staff.hire, bonus = repBonus(c.s);
  return Array.from({ length: H.candidates }, () => { const ability = Math.min(100, c.rng.intIn(H.abilityMin[tier - 1], H.abilityMax[tier - 1]) + bonus); return { ability, potential: Math.min(100, ability + c.rng.intIn(H.potentialMin, H.potentialMax)) }; });
}

// ---------- 제안 만들기 ----------
interface Idea { kind: string; key: string; text: [string, string, string]; facts: string[]; goto: ExecGoto | null; issue?: () => number }
const gName = (s: CarState, g: Generation) => s.nameplates.find((n) => n.generations.includes(g))?.name ?? '';
const staffGoto = (id?: number): ExecGoto => (id === undefined ? { tab: 'company', sub: 'staff' } : { tab: 'company', sub: 'staff', id });

function hrIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], fixed = monthlyFixed(s), C = config.staff.condition, T = config.staff.train;
  const weak = regularStaff(s).filter((x) => weakCapped(s, x)).sort((a, b) => a.ability - b.ability || a.id - b.id);
  const autoFire = delegationOn(s, 'hr', 'autoFire'), canReplace = !openReplacement(s) && s.cash > fixed * X.replace.cashMonths && !(autoFire && delegationOn(s, 'hr', 'autoHire')); // 1.4.0 자동 채용·해고를 둘 다 켜면 교체 제안은 겹치므로 내지 않는다
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
    if (autoFire) break; // 자동 해고가 처리한다
    out.push({ kind: 'fire', key: String(x.id), goto: staffGoto(x.id), facts,
      text: ['직원 가운데 더 성장하기 어려운 사람이 있습니다. 인원 정리를 검토해 보시죠.',
        `${x.name}${J(x.name, '은/는')} 더 성장하기 어렵습니다. 해고를 검토해 보시죠.`,
        `${x.name}(${ROLE_KO[x.role]}, ${sk} ${x.ability})${J(x.name + ')', '은/는')} 성장 한계에 닿았고 같은 직무 평균(${avg})보다 ${avg - x.ability} 낮습니다. 더 성장하기 어렵습니다. 해고를 권유합니다.`] });
    break;
  }
  for (const x of regularStaff(s).filter((y) => y.condition < C.low && !isAway(y, s.week)).sort((a, b) => a.condition - b.condition || a.id - b.id).slice(0, 1)) {
    const w = X.hr.restWeeks;
    out.push({ kind: 'rest', key: String(x.id), goto: staffGoto(x.id), facts: [`${x.name} 컨디션 ${pct(x.condition)}`, `지친 상태에서는 일의 양이 ${pct(1 - C.lowMult)} 줄어듭니다`],
      text: ['지친 직원이 있습니다. 쉬게 해 주는 편이 낫습니다.', `${x.name}${J(x.name, '이/가')} 많이 지쳤습니다. 휴식을 권합니다.`, `${x.name}의 컨디션이 ${pct(x.condition)}입니다. 이대로면 일의 양이 ${pct(1 - C.lowMult)} 줄어듭니다. ${w}주 휴식을 권합니다.`] });
  }
  for (const x of regularStaff(s).filter((y) => y.projectId === null && y.potential - y.ability >= X.hr.growGap && !trainError(s, y)).sort((a, b) => (b.potential - b.ability) - (a.potential - a.ability) || a.id - b.id).slice(0, 1)) {
    const sk = SKILL_KO[x.role];
    out.push({ kind: 'train', key: String(x.id), goto: staffGoto(x.id), facts: [`${x.name}: ${sk} ${x.ability}, 성장 한계 ${x.potential}`, `교육비 ${won(trainCost(x.ability))}, 능력 +${T.gainMin}~${T.gainMax}, ${T.weeks}주`],
      text: ['교육으로 더 클 수 있는 직원이 있습니다.', `${x.name}${J(x.name, '은/는')} 교육으로 더 클 수 있습니다. 교육을 보내 보시죠.`,
        `${x.name}(${sk} ${x.ability})${J(x.name + ')', '은/는')} 성장 한계까지 ${x.potential - x.ability} 남았고 지금 개발에 들어가 있지 않습니다. 교육비 ${won(trainCost(x.ability))}로 능력이 ${T.gainMin}~${T.gainMax} 오릅니다.`] });
  }
  if (staffCount(s) < staffCap(s) && !delegationOn(s, 'hr', 'autoHire')) { // 자동 채용을 켜면 임원이 직접 뽑는다
    const { role: r, have } = lackingRoles(s)[0], n = ROLE_KO[r];
    out.push({ kind: 'hire', key: r, goto: staffGoto(), facts: [`정원 ${staffCount(s)}/${staffCap(s)}명`, `${n} ${have}명`],
      text: ['정원에 여유가 있습니다. 채용을 검토해 보시죠.', `${n} 쪽 인력이 부족합니다. 채용을 권합니다.`, `정원 ${staffCount(s)}/${staffCap(s)}명입니다. ${n}${J(n, '이/가')} ${have}명뿐이라 가장 부족합니다. ${n} 채용 공고를 권합니다.`] });
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

/** 1.1.0 새 차 제안에 붙는 추천 구성 한 줄 */
const recLine = (s: CarState, body: string, seg: string): string => {
  const e = recommendedEquip(s, body, seg, 'gasoline'), nm = (lv: string) => Object.keys(e).filter((k) => e[k] === lv).map((id) => optionById(id).name).join('·');
  const std = nm('std'), opt = nm('opt');
  const t = `${std ? `기본 장비 ${std}` : ''}${std && opt ? ', ' : ''}${opt ? `선택 사양 ${opt}` : ''}`;
  return t ? ` 장비는 ${t}${J(t, '을/를')} 권합니다.` : '';
};
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
        `${bn}${J(bn, '을/를')} ${sn}용으로 내 보는 건 어떨까요. 이 차급은 ${main} 손님이 가장 많고 ${rival}. 기준가에 내면 월 ${i.sales}대 안팎이 예상됩니다.${fit ? ` ${fit}` : ''}${recLine(s, best.body, best.seg)}`] });
  }
  for (const g of sellingGens(s).filter((x) => x.status === 'onSale')) { // 1.1.0: 이 차급에서 기대되는 장비가 됐는데 지금 차에 없거나 선택 사양으로만 있으면(페이스리프트로)
    const ed = currentEdition(g), fx = expectEffect(equipOf(ed), g.body, yearOf(s.week)), lack = [...fx.missing, ...fx.optOnly];
    if (!lack.length) continue;
    if (ed.equipLegacy) { // 옛 저장의 출시된 판: 감점이 없으므로 안내만 한 번
      if ((s.execs?.reports ?? []).some((r) => r.kind === 'expectEquip' && r.key === `${g.id}:legacy`)) continue;
      const n0 = gName(s, g);
      out.push({ kind: 'expectEquip', key: `${g.id}:legacy`, goto: { tab: 'garage', id: g.id }, facts: [`「${n0}」 옛 구성(장비 기대 면제)`, `요즘 이 차급에서 기대되는 장비: ${lack.map((id) => optionById(id).name).join('·')}`],
        text: ['옛 구성으로 팔고 있는 차가 있습니다.', `「${n0}」 페이스리프트 때 추천 구성을 반영하세요.`, `「${n0}」${J(n0, '은/는')} 옛 구성이라 지금은 장비 기대 감점이 없습니다. 페이스리프트 때 추천 구성을 반영하세요.`] });
      continue;
    }
    const n = gName(s, g), names = lack.map((id) => optionById(id).name).join('·'), how = fx.missing.length ? '지금 차에는 없습니다' : '지금 차에는 선택 사양으로만 있습니다';
    out.push({ kind: 'expectEquip', key: `${g.id}:${lack.join(',')}`, goto: { tab: 'garage', id: g.id }, facts: [`「${n}」 ${bodyById(g.body).name} 차급에서 기대되는 장비: ${names}(${how})`, `기대 장비가 빠진 만큼 판매가 약 ${pct(1 - fx.mult)} 줄고 있습니다`],
      text: ['요즘 손님들이 당연하게 여기는 장비가 빠진 차가 있습니다.', `「${n}」에 요즘 기대되는 장비가 빠져 있습니다. 페이스리프트로 넣으시죠.`, `이 차급에서 ${names}${J(names, '이/가')} 기대되는 장비가 됐습니다(${how}). 「${n}」 페이스리프트로 기본 장비로 넣으면 판매가 약 ${pct(1 - fx.mult)} 회복됩니다.`] });
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

/** 5.5.0 해외 담당: 현지 공장(판매 법인 2등급, 지난달 수출이 다음 등급 생산의 60% 이상, 아끼는 관세·운송비 어림), 판매 법인(판매가 상한의 90% 이상), 새 권역 진출 */
function worldIdeas(s: CarState): Idea[] {
  const out: Idea[] = [], go: ExecGoto = { tab: 'company', sub: 'world' }, fixed = monthlyFixed(s), m = monthOf(s.week);
  for (const v of regionViews(s)) {
    if (!v.open) { if (!v.error) out.push({ kind: 'worldOpen', key: v.id, goto: go, facts: [`${v.name} 진출비 ${won(v.entry)}`, `한 달 시장 약 ${Math.round(v.market).toLocaleString()}대, 판매 상한 ${Math.round(v.cap).toLocaleString()}대`],
      text: ['아직 진출하지 않은 해외 권역이 있습니다.', `${v.name} 진출 조건을 채웠습니다. 진출을 검토해 보시죠.`, `${v.name} 진출 조건을 채웠습니다. 진출비 ${won(v.entry)}${J(won(v.entry), '으로/로')} 한 달 시장 약 ${Math.round(v.market).toLocaleString()}대에서 수출로 상한 ${Math.round(v.cap).toLocaleString()}대까지 팔 수 있습니다.`] }); continue; }
    const p = v.plant, n = p?.next;
    if (n && !n.error && s.cash >= n.cost + fixed * X.research.cashMonths && v.sold - (p?.made ?? 0) >= n.capacity * 0.6 && n.save > n.upkeep) {
      const net = n.save - n.upkeep, pay = Math.ceil(n.cost / Math.max(1, net)) + n.months;
      out.push({ kind: 'plant', key: `${v.id}:${n.level}`, goto: go, facts: [`${v.name} 지난달 판매 ${v.sold.toLocaleString()}대(현지 생산 ${(p?.made ?? 0).toLocaleString()}대), 관세 ${won(v.tariff)}·운송비 ${won(v.ship)}`, `현지 공장 ${n.level}등급: 한 달 ${n.capacity.toLocaleString()}대, 건설비 ${won(n.cost)}, 월 유지비 ${won(n.upkeep)}, ${n.months}개월 공사`, `늘어나는 월 이익 약 ${won(n.save)}(관세·운송비 절감과 국내 공장이 모자라 못 판 주문) → 본전까지 약 ${pay}개월`],
        text: ['해외 공장을 검토할 때입니다.', `${v.name}에 현지 공장을 지을 때입니다.`, `${v.name}에 현지 공장 ${n.level}등급을 지을 때입니다. 지금 수출하는 차를 현지에서 만들면 관세·운송비를 아끼고 국내 공장 한도가 비어 월 이익이 약 ${won(n.save)} 늘어, 유지비를 빼고 공사 기간을 더해 약 ${pay}개월이면 건설비를 되찾습니다. 관세 인상·수입 규제도 받지 않습니다.`] });
    }
    const o = v.officeNext;
    if (o && !o.error && v.sold >= v.cap * 0.9 && v.profit > 0 && s.cash >= o.cost + fixed * X.research.cashMonths)
      out.push({ kind: 'worldOffice', key: `${v.id}:${o.level}`, goto: go, facts: [`${v.name} 지난달 판매 ${v.sold.toLocaleString()}대 / 상한 ${Math.round(v.cap).toLocaleString()}대`, `판매 법인 ${o.level}등급: 상한 시장의 ${Math.round(o.capShare * 100)}%, 투자비 ${won(o.cost)}, 월 유지비 ${won(o.upkeep)}`],
        text: ['해외 판매가 상한에 막혀 있습니다.', `${v.name} 판매가 상한에 닿았습니다. 판매 법인을 키우시죠.`, `${v.name} 판매가 상한(${Math.round(v.cap).toLocaleString()}대)에 닿았습니다. 판매 법인 ${o.level}등급이면 상한이 시장의 ${Math.round(o.capShare * 100)}%로 늘어납니다(투자비 ${won(o.cost)}).`] });
  }
  void m;
  return out;
}
const IDEAS: Record<ExecRole, (s: CarState) => Idea[]> = { hr: hrIdeas, product: productIdeas, finance: financeIdeas, production: productionIdeas, research: researchIdeas, market: marketIdeas, world: worldIdeas };

// ---------- 상태 바꾸기 ----------
/** Game이 넘기는 손잡이: 일회성 지출, 명령 실행(검증 포함, 기록에는 남지 않음), 새 이름 */
export interface ExecCtx { s: CarState; rng: Rng; spend(cost: number): void; run(cmd: Command): CommandResult; newName(): string }

export function addReport(s: CarState, role: ExecRole, kind: string, text: string, facts: string[], goto: ExecGoto | null, auto: boolean, replacementId: number | null = null, key = ''): void {
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
      x.projectId = null; x.lab = false; delete x.elite; // 현업에서 빠진다(4.1.0 전담팀에서도)
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
      if (!DELEGATIONS[cmd.role].some((d) => d.key === cmd.key)) return fail('이 자리에는 그런 위임 항목이 없습니다.');
      const seat = s.execs?.seats[cmd.role];
      if (cmd.on) { if (!seat) return fail('임원이 없습니다.'); const k = execSkill(cmd.role, seat.staff); if (k < X.delegateSkill) return fail(`임원 능력이 ${X.delegateSkill} 이상이어야 위임할 수 있습니다(지금 ${k}).`); }
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
    case 'setGenAuto': { // 1.3.0 차종별 세대교체 위임(기획 임원이 없거나 능력이 모자라면 켤 수 없고, 켜 둔 설정은 그동안 멈춘다)
      const n = s.nameplates.find((x) => x.id === cmd.nameplateId);
      if (!n || !n.generations.length) return fail('없는 차종입니다.');
      if (cmd.on) { const w = genAutoWhyNot(s); if (w) return fail(w); }
      s.execs ??= emptyExecs();
      const m = (s.execs.genAuto ??= {});
      if (cmd.on) m[n.id] = { launch: cmd.launch ?? true, waitSince: m[n.id]?.waitSince ?? null, told: m[n.id]?.told ?? false }; else delete m[n.id];
      return OK;
    }
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
  autoLaunch(c, ev); // 1.3.0
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
  const cands = rollCands(c, tier);
  const top = rp.minAbility + X.replace.capGain, best = cands.filter((a) => a.ability >= rp.minAbility && a.ability <= top).sort((a, b) => b.ability - a.ability)[0]; // 0.8.0: 기준 + capGain을 넘는 후보는 이 자리 조건으로 오지 않는다(교체로 얻는 능력 폭 제한)
  const why = `${sk} ${rp.minAbility}~${top}에 맞는 후보가 없어`, seen = `후보 ${cands.map((a) => a.ability).sort((a, b) => b - a).join('·')}`;
  rp.tries++;
  if (best) {
    const id = s.nextId++, name = c.newName();
    c.spend(severanceOf(salaryOf(x.ability)));
    s.staff = s.staff.filter((y) => y !== x); noteFormer(s, x); // 4.1.0 전 직원 목록
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

/** 월 결산 뒤: 위임 실행 → 임원별 제안(최대 2건, 재발행 간격) */
export function execMonth(c: ExecCtx, ev: GameEvent[]): void {
  const s = c.s, e = s.execs;
  if (!e || !seated(s).length) return;
  const before = e.reports.length ? e.reports[e.reports.length - 1].id : -1;
  delegate(c, ev);
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

/** 위임: 인사(자동 휴식·자동 교육) → 생산(배분) → 연구소장(빈 칸 연구). 실행 내역은 보고함에(auto) */
function delegate(c: ExecCtx, ev: GameEvent[]): void {
  const s = c.s, fixed = () => monthlyFixed(s);
  autoStaff(c, ev); // 1.4.0 자동 해고 → 자동 채용(내보낸 자리를 같은 달에 채운다)
  if (delegationOn(s, 'hr', 'autoRest'))
    for (const x of regularStaff(s).sort((a, b) => a.id - b.id).filter((y) => y.condition < config.staff.condition.low && !isAway(y, s.week))) {
      const w = X.hr.restWeeks;
      if (c.run({ type: 'rest', staffId: x.id, weeks: w }).ok) addReport(s, 'hr', 'autoRest', `${x.name}${J(x.name, '이/가')} 지쳐 ${w}주 쉬게 했습니다(컨디션 ${pct(x.condition)}).`, [], staffGoto(x.id), true);
    }
  if (delegationOn(s, 'hr', 'autoTrain')) {
    const H = X.hr;
    for (const x of regularStaff(s).filter((y) => y.projectId === null && y.ability < y.potential).sort((a, b) => (b.potential - b.ability) - (a.potential - a.ability) || a.id - b.id)) {
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
  autoGen(c); // 1.3.0 세대교체 위임
  if (delegationOn(s, 'world', 'autoWorld')) { // 5.5.0 해외 담당: 자동 수출 켜기, 수동 권역 가격 → 자동, 현지 생산 차종 → 자동
    const done: string[] = [];
    for (const r of [...(s.world?.regions ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const nm = regionName(r.id);
      if (!r.auto && c.run({ type: 'setRegionAuto', region: r.id, on: true }).ok) done.push(`${nm} 자동 수출을 켰습니다`);
      const manual = sellingGens(s).filter((g) => g.world?.[r.id]?.price !== undefined);
      for (const g of manual) c.run({ type: 'setRegionPrice', generationId: g.id, region: r.id, price: null });
      if (manual.length) done.push(`${nm} 권역 가격 ${manual.length}대를 자동으로 돌렸습니다`);
      if (r.plant?.cars && c.run({ type: 'setPlantCars', region: r.id, cars: null }).ok) done.push(`${nm} 현지 생산 차종을 자동으로 돌렸습니다`);
    }
    if (done.length) addReport(s, 'world', 'autoWorld', `${done.join('. ')}.`, [], { tab: 'company', sub: 'world' }, true);
  }
  if (delegationOn(s, 'research', 'autoResearch'))
    for (let t = recommendTech(s, fixed() * X.research.cashMonths); t && s.research.active.length < researchSlots(s); t = recommendTech(s, fixed() * X.research.cashMonths)) {
      if (!c.run({ type: 'startResearch', techId: t.id }).ok) break;
      addReport(s, 'research', 'autoResearch', `빈 연구 칸에 「${t.name}」 연구를 시작했습니다(${won(t.cost.money)}${t.requiredBy ? ', 규제에 필요한 기술' : ''}).`, [], { tab: 'company', sub: 'research' }, true);
    }
}

// ---------- 1.4.0 자동 채용·해고(인사 임원) ----------
/** 자동 해고: 성장 한계·같은 직무 평균보다 weakGap 낮음(해고 권유와 같은 판정), 개발 중·교육·휴식 중·입사 tenureMonths개월 미만 제외, 한 달 1명, 직무별·전체 최소 인원 유지, 퇴직금 뒤 운영비 fireCashMonths개월 치.
 *  자동 채용: 정원에 빈자리, 부족한 직무 순으로 기준(같은 직무 평균, 직원이 없으면 그 공고 후보 평균)에 공고로 닿는 첫 직무, 현금 = 교체 고용과 같은 기준. 기준 이상 후보 중 가장 나은 사람(상한 없음), 없으면 retryWeeks 뒤 */
function autoStaff(c: ExecCtx, ev: GameEvent[]): void {
  const s = c.s, e = s.execs!, H = config.staff.hire, count = (r: Role) => regularStaff(s).filter((y) => y.role === r).length;
  const log = (kind: string, text: string, facts: string[], go: ExecGoto, key = '') => { addReport(s, 'hr', kind, text, facts, go, true, null, key); ev.push({ kind: 'replacement', text }); };
  const bonus = repBonus(s), topTier = s.reputation >= H.tier3Rep ? 3 : 2, topReach = H.abilityMax[topTier - 1] + bonus - 5; // 가장 높은 공고로 기대할 만한 능력(교체 기준과 같은 여유)
  const hireOn = delegationOn(s, 'hr', 'autoHire');
  if (delegationOn(s, 'hr', 'autoFire') && staffCount(s) > AS.minStaff) {
    const x = regularStaff(s).filter((y) => weakCapped(s, y) && y.projectId === null && !isAway(y, s.week) && !(y.hist?.join != null && s.week - y.hist.join < AS.tenureMonths * WPM) && count(y.role) > AS.minPerRole
      && !(hireOn && (roleAvg(s, y) ?? 0) > topReach && y.ability >= H.abilityMin[topTier - 1] + bonus)) // 자동 채용을 켜 두고 같은 직무 평균에 공고로 닿지 않을 때는, 가장 높은 공고의 어느 후보보다도 낮은 사람만(평균 미달로 뽑은 사람을 다시 내보내는 왕복 방지)
      .sort((a, b) => a.ability - b.ability || a.id - b.id)[0];
    const sev = x ? severanceOf(salaryOf(x.ability)) : 0;
    if (x && s.cash - sev >= monthlyFixed(s) * AS.fireCashMonths) {
      const avg = Math.round(roleAvg(s, x)!), sk = SKILL_KO[x.role], who = `${x.name}(${ROLE_KO[x.role]}, ${sk} ${x.ability}, 성장 한계 ${x.potential})`, facts = [`${x.name}: ${staffBrief(s, x)}`, `월급 ${won(salaryOf(x.ability))}이 줄어듭니다`];
      if (c.run({ type: 'fire', staffId: x.id }).ok) log('autoFire', `${who}${J(x.name, '을/를')} 내보냈습니다. 같은 직무 평균 ${avg}보다 ${avg - x.ability} 낮고 더 성장하기 어렵습니다. 퇴직금 ${won(sev)}.`, facts, staffGoto(), String(x.id));
    }
  }
  const retry = 'hr:autoHire:retry';
  if (!hireOn || staffCount(s) >= staffCap(s) || (e.cooldown[retry] ?? -1) > s.week) return;
  const order = lackingRoles(s);
  let pick: { role: Role; have: number; want: number; i: number; min: number; tier: number; basis: string; avg?: number } | undefined = order.map((o, i) => {
    const same = regularStaff(s).filter((y) => y.role === o.role), mid = (t: number) => Math.round((H.abilityMin[t - 1] + H.abilityMax[t - 1]) / 2) + bonus;
    const min = same.length ? Math.ceil(mean(same.map((y) => y.ability))) : mid(2), tier = replaceTier(s, min);
    return { ...o, i, min, tier, basis: same.length ? `같은 직무 평균 ${min}` : `공고 후보 평균 ${min}`, reach: min <= H.abilityMax[tier - 1] + bonus - 5 }; // 교체 기준과 같은 여유(공고로 거의 닿지 않으면 공고비만 든다)
  }).find((o) => o.reach);
  const head = `정원 ${staffCount(s)}/${staffCap(s)}명`;
  if (!pick) { // 어느 직무도 공고로 평균에 닿지 않는다: 가장 부족한 직무를 가장 높은 공고로 내 가장 나은 후보를 뽑는다(빈자리는 아무 일도 못 한다)
    const o = order[0], avg = Math.ceil(mean(regularStaff(s).filter((y) => y.role === o.role).map((y) => y.ability)));
    pick = { ...o, i: 0, min: 0, tier: topTier, avg, basis: `같은 직무 평균 ${avg}에는 공고로 닿지 않아 ${topTier}등급 공고의 가장 나은 후보` };
  }
  const cost = H.postCost[pick.tier - 1], need = monthlyFixed(s) * X.replace.cashMonths + cost;
  if (s.cash <= need) return; // 현금이 늘면 다음 달에
  c.spend(cost);
  const cands = rollCands(c, pick.tier), best = cands.filter((a) => a.ability >= pick.min).sort((a, b) => b.ability - a.ability || b.potential - a.potential)[0];
  const n = ROLE_KO[pick.role], sk = SKILL_KO[pick.role], seen = `후보 ${cands.map((a) => a.ability).sort((a, b) => b - a).join('·')}`;
  const why = `${head}에서 ${n}${J(n, '이/가')} ${pick.have}명(개발팀 구성 기준 ${pick.want}명)으로 ${pick.i ? '다음으로' : '가장'} 부족합니다`;
  const facts = [pick.avg === undefined ? `기준: ${pick.basis} 이상` : `기준: ${pick.basis}`, `${pick.tier}등급 공고비 ${won(cost)}, ${seen}`];
  if (!best) {
    e.cooldown[retry] = s.week + X.replace.retryWeeks;
    log('autoHireFail', `${why}. ${n} 공고를 냈지만 기준(${sk} ${pick.min}) 이상인 후보가 없어 뽑지 않았습니다(${seen}). ${X.replace.retryWeeks}주 뒤 다시 공고합니다.`, facts, staffGoto());
    return;
  }
  const id = s.nextId++, name = c.newName();
  s.staff.push(startHist({ id, name, role: pick.role, ability: best.ability, potential: best.potential, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false }, s.week));
  const note = pick.avg === undefined ? '' : ` 같은 직무 평균(${pick.avg})에는 못 미치지만 지금 구할 수 있는 가장 나은 후보입니다.`;
  log('autoHire', `${why}. ${n} 공고를 내 ${name}(${sk} ${best.ability}, 성장 한계 ${best.potential})${J(name + ')', '을/를')} 뽑았습니다.${note} 월급 ${won(salaryOf(best.ability))}.`, facts, staffGoto(id), String(id));
}

// ---------- 1.3.0 세대교체 위임(기획 임원) ----------
// 차종별로 켜면 기획 임원이 때가 된 차종의 페이스리프트·풀체인지(파생 차종은 바탕 차의 새 세대로 다음 세대)를 스스로 시작하고, 위임 옵션이면 출시까지 한다.
// 기획 값은 플레이어가 '전작 그대로'로 만들 때와 같고(보너스·불이익 없음), 판단 기준은 제안(productIdeas)과 같은 수명 막대에 시간 기준을 더했다
const GA = config.genAuto, WPM = config.time.weeksPerMonth;
/** 위임할 수 없는 이유(위임 공통 기준: 기획 임원 능력 delegateSkill 이상). 위임할 수 있으면 null */
const genAutoWhyNot = (s: CarState): string | null => {
  const h = holder(s, 'product');
  if (!h) return '기획 임원이 없습니다.';
  const k = execSkill('product', h.staff);
  return k < X.delegateSkill ? `기획 임원 능력이 ${X.delegateSkill} 이상이어야 위임할 수 있습니다(지금 ${k}).` : null;
};

/** 전작 그대로 다음 세대 기획(0.8.0 화면의 '전작 그대로'와 같은 값): 차체·고객층·동력·동력 등급(연구한 최신 단계 기준)·개발 방향·예산·설계 기간은 전작, 장비는 추천 구성, 전기차 배터리는 전작 */
export function nextGenSpec(s: CarState, nameplateId: number): Omit<ProjectSpec, 'name'> | null {
  const prev = s.nameplates.find((x) => x.id === nameplateId)?.generations.at(-1);
  if (!prev) return null;
  const e = currentEdition(prev), pl = prev.plan, equip = recommendedEquip(s, prev.body, prev.segment, prev.powertrain);
  return { body: prev.body, segment: prev.segment, powertrain: prev.powertrain, tier: e.tier, options: stdOf(equip), equip, ...(e.battery ? { battery: e.battery } : {}),
    direction: pl ? { ...pl.direction } : { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: pl?.budget ?? 'normal', designWeeks: pl?.designWeeks ?? config.dev.designWeeks[1] };
}

/** 위임 팀: 쉬는 개발 직원(전담 연구원·교육·휴식 중 제외), 능력 높은 순으로 직무를 고르게. parts몫으로 나눈 한 몫(빈 개발팀 수가 상한, 1이면 전원) */
function autoTeam(s: CarState, parts: number): number[] {
  const idle = regularStaff(s).filter((x) => x.projectId === null && isDevRole(x.role) && !x.lab && !isAway(x, s.week)).sort((a, b) => b.ability - a.ability || a.id - b.id); // 4.1.0 위임은 전담팀원을 쓰지 않는다
  parts = Math.min(parts, devTeams(s) - teamsUsed(s));
  if (parts <= 1) return idle.map((x) => x.id).sort((a, b) => a - b);
  // 4.1.0 직무마다 능력 순위에서 parts칸마다 한 명씩(1·4·7…번째): 나눈 팀들이 고르게 강하다(예전: 앞 팀이 직무를 돌며 가장 나은 사람부터 가져가 뒤 팀이 약했다)
  return (['designer', 'engineer', 'tester'] as Role[]).flatMap((r) => idle.filter((x) => x.role === r).filter((_, i) => i % parts === 0)).map((x) => x.id).sort((a, b) => a - b);
}
/** 위임 팀에 꼭 있어야 하는 직무(1.6.1: 빠지면 시작하지 않고 기다린다). 페이스리프트 설계는 디자이너만 한다 */
const NEED_ROLES: Record<GenStep['kind'], Role[]> = { autoFullChange: ['designer', 'engineer', 'tester'], autoDerive: ['designer', 'engineer', 'tester'], autoFacelift: ['designer', 'tester'] };
/** 풀체인지할 때가 된 차종(파생 제외, 판매 중, 진행 중인 개발 없음) */
function fullChangeDue(s: CarState, n: Nameplate): boolean {
  const g = latestGen(n), age = monthOf(s.week) - g.launchMonth;
  return n.baseOf === undefined && g.status === 'onSale' && !s.projects.some((p) => (p.kind === 'fullchange' && p.targetId === n.id) || ((p.kind === 'facelift' || p.kind === 'fix') && p.targetId === g.id))
    && (age >= GA.fullChangeAt || (age >= config.lifecycle.fullChange.afterMonths && lifeBar(s, g) < X.product.fullChangeLife));
}

interface GenStep { kind: 'autoFullChange' | 'autoFacelift' | 'autoDerive'; cmd: Command; cost: number; error: string | null; what: string; why: string; genId: number; team: number[]; worse?: boolean }
/** 이 차종에서 지금 시작할 때가 된 일(없으면 null): 파생 차종의 다음 세대 → 풀체인지 → 페이스리프트 순 */
function genAutoStep(s: CarState, n: Nameplate): GenStep | null {
  const g = latestGen(n), age = monthOf(s.week) - g.launchMonth, ed = currentEdition(g);
  if (g.status !== 'onSale') return null;
  if (s.projects.some((p) => (p.kind === 'fullchange' && p.targetId === n.id) || p.into === n.id || ((p.kind === 'facelift' || p.kind === 'fix') && p.targetId === g.id))) return null;
  if (n.baseOf !== undefined) {
    const bn = s.nameplates.find((x) => x.id === n.baseOf), bg = bn ? latestGen(bn) : undefined;
    if (bn && bg && bg.status === 'onSale' && bg.id !== g.fromGen && !s.projects.some((p) => p.kind === 'derivative' && p.variant === n.variant && nameplateOfGen(s, p.targetId)?.id === bn.id)) {
      const plan = derivativePlan(s, bg.id, n.variant!);
      return { kind: 'autoDerive', cmd: { type: 'startDerivative', generationId: bg.id, variant: n.variant! }, cost: typeof plan === 'string' ? 0 : plan.cost, error: typeof plan === 'string' ? plan : null,
        what: `${g.number + 1}세대 개발`, why: `바탕 차 「${bn.name}」${J(bn.name, '이/가')} ${bg.number}세대로 바뀌었습니다`, genId: g.id, team: autoTeam(s, Infinity) };
    }
  } else {
    const life = lifeBar(s, g);
    if (fullChangeDue(s, n)) {
      // 1.6.1 팀: 풀체인지 때가 된 위임 차종끼리 쉬는 직원을 나누되, 그 몫으로 전작보다 못한 차가 나오면(평론 감점) 전원, 전원으로도 못하면 직원이 돌아와 나아질 수 있을 때 기다린다(봇 pickTeam과 같은 기준)
      const spec = nextGenSpec(s, n.id)!, crew = (ids: number[]) => s.staff.filter((x) => ids.includes(x.id)), worse = (ids: number[]) => compareToPrev(g, planPreview(s, { ...spec, name: n.name }, crew(ids)).stats, spec.body) === 'worse';
      const map = s.execs?.genAuto ?? {}, all = autoTeam(s, 1), share = autoTeam(s, s.nameplates.filter((x) => map[x.id] && fullChangeDue(s, x)).length);
      // 4.1.0 나눈 팀의 예상 평론이 전작(전원 팀 예상이 더 낮으면 그 값)보다 splitTol 이하로만 낮으면 나눠 동시에 진행하고, splitWaitMonths개월 넘게 기다린 차종은 나눈 팀으로라도 시작한다
      const waited = map[n.id]?.waitSince != null && s.week - map[n.id]!.waitSince! >= GA.splitWaitMonths * WPM;
      const ref = Math.min(g.reviewAvg, estReview(s, g, spec, crew(all))), est = share.length < all.length ? estReview(s, g, spec, crew(share)) : -Infinity;
      const split = share.length < all.length && (!worse(share) || est >= ref - GA.splitTol || (waited && est >= g.reviewAvg - GA.splitWaitDrop)); // 기다린 차종도 전작보다 splitWaitDrop 넘게 떨어지는 팀으로는 나누지 않는다(급락 방지)
      const team = split ? share : all, roster = regularStaff(s).filter((x) => isDevRole(x.role) && !x.lab).map((x) => x.id);
      return { kind: 'autoFullChange', cmd: { type: 'startFullChange', nameplateId: n.id, ...spec }, cost: planPreview(s, { ...spec, name: n.name }, crew(team)).cost * fullChangeCostMult(true), error: null, team,
        worse: !split && team.length < roster.length && worse(team) && !worse(roster) && !(waited && estReview(s, g, spec, crew(team)) >= g.reviewAvg - GA.splitWaitDrop),
        what: `${g.number + 1}세대 풀체인지`, why: age >= GA.fullChangeAt ? `출시 ${age}개월째로, 노후가 시작되는 ${config.life.oldMonths}개월 전에 다음 세대가 나와야 합니다` : `출시 ${age}개월째에 수명이 ${pct(life)}까지 떨어졌습니다`, genId: g.id };
    }
  }
  if (!g.editions.some((e) => e.kind === 'facelift') && age >= GA.faceliftAt && (n.baseOf !== undefined || age < GA.fullChangeAt - GA.faceliftGap)) {
    const equip = recommendedEquip(s, g.body, g.segment, g.powertrain);
    return { kind: 'autoFacelift', cmd: { type: 'startFacelift', generationId: g.id, options: stdOf(equip), equip, tier: ed.tier }, cost: faceliftWeekCost(g.devCost) * (config.lifecycle.facelift.designWeeks + config.dev.minTestWeeks), error: null,
      what: '페이스리프트', why: `출시 ${age}개월째로 판매 수명의 중간입니다`, genId: g.id, team: autoTeam(s, Infinity) };
  }
  return null;
}

/** 4.1.0 이 팀으로 전작 그대로 풀체인지하면 예상 평론(흔들림 없이 시장 기준가, 전작 비교 가감 포함) */
function estReview(s: CarState, prev: Generation, spec: Omit<ProjectSpec, 'name'>, team: Staff[]): number {
  const pv = planPreview(s, { ...spec, name: '' }, team), y = yearOf(s.week + spec.designWeeks + config.dev.minTestWeeks), base = carBasePrice(s, { ...spec, options: withRequired(s, spec.options) });
  const cmp = compareToPrev(prev, pv.stats, spec.body), fc = config.lifecycle.fullChange;
  return mean(criticScores(pv.stats, y, base, base, 0, () => 0)) + (cmp === 'worse' ? fc.worseReview : cmp === 'better' ? fc.betterReview : 0);
}
/** 지금 시작하지 못하는 이유(시작할 수 있으면 null) */
function genAutoWait(s: CarState, step: GenStep): string | null {
  const team = step.team, need = step.cost * GA.cashDevMult + monthlyFixed(s) * GA.cashMonths, lack = NEED_ROLES[step.kind].find((r) => !s.staff.some((x) => x.role === r && team.includes(x.id)));
  return step.error ?? (teamsUsed(s) >= devTeams(s) ? '개발팀이 모두 바쁩니다' : !team.length ? '쉬고 있는 개발 직원이 없습니다' : lack ? `쉬고 있는 ${ROLE_KO[lack]}${J(ROLE_KO[lack], '이/가')} 없습니다`
    : step.worse ? `지금 쉬고 있는 개발 직원 ${team.length}명으로는 전작보다 못한 차가 나옵니다. 다른 일을 하는 직원이 돌아오면 시작합니다`
    : s.cash < need ? `현금이 ${won(need)}(예상 개발비 ${won(step.cost)}의 ${GA.cashDevMult}배와 운영비 ${GA.cashMonths}개월 치)에 못 미칩니다` : null);
}

/** 월 결산 뒤(위임): 켠 차종마다 때가 되면 시작. 현금(예상 개발비 × cashDevMult + 운영비 cashMonths개월 치)·빈 개발팀·쉬는 직원이 있어야 하고, 오래 못 하면 이유를 한 번 보고 */
function autoGen(c: ExecCtx): void {
  const s = c.s, map = s.execs?.genAuto;
  if (!map || genAutoWhyNot(s)) return;
  for (const n of s.nameplates.filter((x) => map[x.id] && x.generations.length).sort((a, b) => a.id - b.id)) {
    const st = map[n.id], step = genAutoStep(s, n);
    if (!step) { st.waitSince = null; st.told = false; continue; }
    const team = step.team, go: ExecGoto = { tab: 'garage', id: step.genId };
    let why = genAutoWait(s, step);
    if (!why) {
      const r = c.run({ ...step.cmd, team } as Command);
      if (r.ok) {
        s.projects[s.projects.length - 1].auto = true;
        addReport(s, 'product', step.kind, `「${n.name}」 ${step.what}${J(step.what, '을/를')} 시작했습니다. ${step.why}. 예상 개발비 ${won(step.cost)}, 팀 ${team.length}명.`, [`현금 ${won(s.cash)}`], go, true, null, String(n.id));
        st.waitSince = null; st.told = false;
        continue;
      }
      why = r.reason;
    }
    st.waitSince ??= s.week;
    if (!st.told && s.week - st.waitSince >= GA.waitReportMonths * WPM) {
      addReport(s, 'product', 'autoGenWait', `「${n.name}」 ${step.what}${J(step.what, '을/를')} ${Math.floor((s.week - st.waitSince) / WPM)}개월째 시작하지 못하고 있습니다. ${why!.replace(/\.$/, '')}.`, [`현금 ${won(s.cash)}`], go, true, null, String(n.id));
      st.told = true;
    }
  }
}

/** 위임한 개발(auto)이고 출시까지 위임했으며 위임이 유효하면 true: 출시 대기여도 곧 저절로 출시되므로 할 일에서 뺀다 */
export function autoLaunching(s: CarState, p: Project): boolean {
  const id = p.kind === 'fullchange' ? p.targetId : p.kind === 'derivative' ? p.into : nameplateOfGen(s, p.targetId)?.id;
  return !!p.auto && id !== undefined && id !== null && !!s.execs?.genAuto?.[id]?.launch && !genAutoWhyNot(s);
}

/** 매주: 위임으로 시작한 개발이 끝나면(결함을 다 잡았거나 시험 maxTestWeeks주) 출시. 가격은 자동 가격 정책이 있으면 그 정책(페이스리프트는 지금 값), 없으면 시장 기준가(추천가) */
function autoLaunch(c: ExecCtx, ev: GameEvent[]): void {
  const s = c.s, map = s.execs?.genAuto;
  if (!map || genAutoWhyNot(s)) return;
  for (const p of s.projects.filter((x) => x.auto).sort((a, b) => a.id - b.id)) {
    const nid = p.kind === 'fullchange' ? p.targetId : p.kind === 'derivative' ? p.into : nameplateOfGen(s, p.targetId)?.id, n = s.nameplates.find((x) => x.id === nid);
    if (!n || !map[n.id]?.launch || p.phase !== 'test' || p.testWeeks < config.dev.minTestWeeks || !(p.waiting || p.testWeeks >= GA.maxTestWeeks)) continue;
    const prev = latestGen(n), pe = currentEdition(prev), policy = prev.pricePolicy ?? null, b = bodyById(p.body).basePrice;
    const want = p.kind === 'facelift' && policy ? pe.price : carBasePrice(s, { ...p, options: withRequired(s, p.options) });
    const price = Math.min(Math.floor((b * config.price.max) / 10) * 10, Math.max(Math.ceil((b * config.price.min) / 10) * 10, Math.round(want / 10) * 10));
    const r = c.run({ type: 'launch', projectId: p.id, price, marketing: prev.marketing, color: pe.color, wheels: pe.wheels });
    if (!r.ok) { delete p.auto; addReport(s, 'product', 'autoLaunchFail', `「${p.name}」${J(p.name, '을/를')} 출시하지 못해 직접 출시하시도록 남겨 두었습니다. ${r.reason}`, [], { tab: 'dev', sub: 'launch', id: p.id }, true, null, String(n.id)); continue; }
    if (r.events) ev.push(...r.events);
    const g = latestGen(n);
    if (policy && p.kind !== 'facelift') g.pricePolicy = { ...policy };
    const what = p.kind === 'facelift' ? `${g.number}세대 페이스리프트` : `${g.number}세대`;
    addReport(s, 'product', 'autoLaunch', `「${n.name}」 ${what}${J(what, '을/를')} 출시했습니다. 가격 ${price.toLocaleString()}만원(${policy ? '자동 가격 정책 유지' : '시장 기준가'}), 평론 평균 ${g.reviewAvg.toFixed(1)}.`, [], { tab: 'garage', id: g.id }, true, null, String(n.id));
  }
}

/** 화면용: 세대교체 위임 상태(위임할 수 있는지, 차종별 켜짐·출시 자동·지금 할 때가 된 일·기다리기 시작한 주) */
export function genAutoInfo(s: CarState) {
  const whyNot = genAutoWhyNot(s), map = s.execs?.genAuto ?? {};
  return {
    available: !whyNot, whyNot,
    cars: s.nameplates.filter((n) => n.generations.length).sort((a, b) => a.id - b.id).map((n) => {
      const st = map[n.id], step = genAutoStep(s, n);
      return { nameplateId: n.id, name: n.name, derivative: n.baseOf !== undefined, on: !!st, launch: st?.launch ?? true, active: !!st && !whyNot, next: step ? step.what : null, waitingSince: st?.waitSince ?? null, why: step && st?.waitSince != null ? genAutoWait(s, step) : null };
    }),
  };
}
