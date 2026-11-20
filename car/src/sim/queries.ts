// 화면이 쓰는 조회 함수(순수 함수, 상태를 바꾸지 않는다)
import { config } from '../config';
import { COMPAT, bodyById } from '../data';
import { avgGrade, finalStats, grade, grades, lifeFactor, salaryOf, standard, unitCost, zeroStats } from './cars';
import { designWeek, devCostPerWeek, faceliftWeekByStaff, faceliftWeekCost, fullChangeCostMult, testCut, weeklyDevCost } from './dev';
import { allGens, sellingGens } from './game';
import { capacityOf, conditionMult, costMultOf, factoryExpandError, hqUpgradeError, isDevRole, isResting, isTraining, linesOf, staffCap, trainCost, trainError, trainingsThisYear, upkeepOf } from './company';
import { carriedEquity, faceliftEligibility, fullChangeEligibility, launchAvgGrade, nameplateById, latestGen, rebuyPerMonth, type Eligibility } from './lifecycle';
import { awarenessStart, awarenessTarget, currentEdition, monthlyDemand, toSaleCar, lifeAge } from './market';
import { criticScores, mean } from './reviews';
import { defectCut, devSpeed, levelForTier, ptCostAdd } from './research';
import { monthLabel, monthOf, monthTime, yearOf, yearOfMonth } from './time';
import { STATS, type CarState, type Generation, type Project, type ProjectSpec, type Role, type Staff, type Stats } from './types';

export const projectById = (s: CarState, id: number): Project | undefined => s.projects.find((p) => p.id === id);
export const generationById = (s: CarState, id: number): Generation | undefined => allGens(s).find((g) => g.id === id);
export const nameplateOf = (s: CarState, genId: number) => s.nameplates.find((n) => n.generations.some((g) => g.id === genId));

/** 세대의 현재 표시 등급(올해 기준, 해마다 낮아진다) */
export const generationGrades = (s: CarState, g: Generation): Stats => grades(currentEdition(g).stats, yearOf(s.week));

/** 지금 출시하면 받을 능력치 원점수·표시 등급·평균 */
export function projectPreview(s: CarState, projectId: number): { stats: Stats; grades: Stats; avg: number } | null {
  const p = projectById(s, projectId);
  if (!p) return null;
  const stats = finalStats(p.body, p.powertrain, p.level, p.options, p.points, p.defects), y = yearOf(s.week);
  return { stats, grades: grades(stats, y), avg: avgGrade(stats, y) };
}

/** 예상 평점(난수 없이): 평론가 4명 점수와 평균 */
export function expectedReviews(s: CarState, projectId: number, price: number): { scores: number[]; avg: number } | null {
  const p = projectById(s, projectId), pv = projectPreview(s, projectId);
  if (!p || !pv) return null;
  const scores = criticScores(pv.stats, yearOf(s.week), bodyById(p.body).basePrice, price, p.defects, () => 0);
  return { scores, avg: mean(scores) };
}

/** 개발 진행 상태와 주간 개발비(0.4.1). waiting: 출시 대기(결함을 다 잡아 개발비가 0). weeklyCost: 지금 주마다 드는 개발비(만원) */
export function projectStatus(s: CarState, projectId: number): { phase: Project['phase']; waiting: boolean; weeklyCost: number; costNote: string } | null {
  const p = projectById(s, projectId);
  if (!p) return null;
  const waiting = !!p.waiting, weeklyCost = waiting ? 0 : weeklyDevCost(s, p), n = Math.round(weeklyCost).toLocaleString();
  const costNote = waiting ? '출시 대기 중이라 개발비가 들지 않습니다.'
    : p.kind === 'facelift' ? `페이스리프트 개발 중에는 주마다 약 ${n}만원이 듭니다.`
    : `${p.phase === 'design' ? '설계' : '시험'} 중에는 주마다 약 ${n}만원이 듭니다(직원 몫 + 시제차).`;
  return { phase: p.phase, waiting, weeklyCost, costNote };
}

/** 남은 결함(화면에 보이는 "약 N개") 판단: 15개 이상 많음 / 6~14 조금 더 / 5 이하 출시 좋음. recallYear: 연 리콜 확률(6.3) */
export function defectAdvice(p: Project): { level: 'many' | 'some' | 'ok'; text: string; recallYear: number } {
  const c = config.critics, n = p.defectEst, recallYear = Math.min(config.recall.maxYear, n * config.recall.perDefect);
  if (n >= c.manyDefects) return { level: 'many', recallYear, text: `결함이 아직 많습니다. 지금 출시하면 평론가 4명이 모두 ${c.manyDefectsPenalty}점씩 깎고, 리콜 위험이 큽니다.` };
  if (n > c.okDefects) return { level: 'some', recallYear, text: '조금 더 시험하면 좋습니다.' };
  return { level: 'ok', recallYear, text: '출시해도 좋습니다.' };
}

/** 쉬고 있는 개발 직무 직원(팀을 고르지 않았을 때의 기본 팀) */
const idleDevStaff = (s: CarState): Staff[] => s.staff.filter((x) => x.projectId === null && isDevRole(x.role));

/** 기획 미리보기: 지금 쉬는 개발 직원(team을 주면 그 팀)으로 개발하면 받을 표시 등급과 개발비(설계 + 최소 시험).
 *  min = 주간 난수가 모두 최저·최소 시험 주로 출시, max = 모두 최고·시험으로 결함을 다 없앤 경우. grades·avg는 난수 1.0·최소 시험 */
export function planPreview(s: CarState, spec: ProjectSpec, team: Staff[] = idleDevStaff(s)): { grades: Stats; avg: number; min: number; max: number; cost: number } {
  const d = config.dev;
  const y = yearOf(s.week + spec.designWeeks + d.minTestWeeks); // 출시하는 해 기준(해가 바뀌면 등급이 낮아진다)
  const level = levelForTier(s, spec.powertrain, spec.tier), speed = 1 + devSpeed(s), cut = 1 - defectCut(s); // 연구: 동력 단계·개발 속도·결함 감소
  const at = (r: number, defectFree: boolean): Stats => {
    const w = designWeek(team, spec, () => r), pts = zeroStats();
    for (const k of STATS) pts[k] = w[k] * spec.designWeeks * speed;
    const made = STATS.reduce((a, k) => a + pts[k], 0);
    const defects = defectFree ? 0 : Math.max(0, made * d.defectPerPoint * cut - testCut(team) * d.minTestWeeks);
    return finalStats(spec.body, spec.powertrain, level, spec.options, pts, defects);
  };
  const mid = at(1, false), lo = avgGrade(at(d.randMin, false), y), hi = avgGrade(at(d.randMax, true), y);
  return { grades: grades(mid, y), avg: avgGrade(mid, y), min: Math.min(lo, hi), max: Math.max(lo, hi), cost: devCostPerWeek(team, spec.budget) * (spec.designWeeks + d.minTestWeeks) };
}

/** 대당 이익 = 판매가 − 원가. costMult: 원가 배수(생략하면 1, 화면은 costMultOf(state)를 넘길 것). ptAdd: 동력 원가 가산(ptCostAdd(state, 동력), 생략하면 자료값) */
export const unitProfit = (body: string, powertrain: string, tier: number, options: string[], price: number, costMult = 1, ptAdd?: number): number => price - unitCost(body, powertrain, tier, options, costMult, ptAdd);
/** 세대의 지금 대당 이익. s를 주면 원가 배수(공장·연구·사건)와 연구로 줄어든 동력 가산을 반영 */
export const generationUnitProfit = (g: Generation, s?: CarState): number => { const e = currentEdition(g); return unitProfit(g.body, g.powertrain, e.tier, e.options, e.price, s ? costMultOf(s) : 1, s ? ptCostAdd(s, g.powertrain) : undefined); };

/** 예상 월 판매 범위: 최소 = 출시 첫 달(수명 0.6, 시작 인지도), 최대 = 수명 1.0·목표 인지도. 생산 상한 적용 */
export function salesForecast(s: CarState, projectId: number, price: number, marketing: number): { min: number; max: number } | null {
  const p = projectById(s, projectId), pv = projectPreview(s, projectId), ex = expectedReviews(s, projectId, price);
  if (!p || !pv || !ex) return null;
  const y = yearOf(s.week), m = monthOf(s.week);
  const others = sellingGens(s).filter((g) => g.status === 'onSale').map((g) => toSaleCar(g, m));
  const start = awarenessStart(s.reputation, ex.avg), target = Math.max(start, awarenessTarget(s.reputation, marketing, grade(pv.stats.Q, y)));
  const car = { body: p.body, segment: p.segment, stats: pv.stats, price, powertrain: p.powertrain };
  const cap = (d: number) => Math.round(Math.min(capacityOf(s), d));
  return {
    min: cap(monthlyDemand(s, { ...car, awareness: start, life: config.life.start }, others, monthTime(m))),
    max: cap(monthlyDemand(s, { ...car, awareness: target, life: 1 }, others, monthTime(m))),
  };
}

/** 수명 막대(0~1): 정점 이후의 수명 감소(페이스리프트가 되돌린 수명 나이 기준) × 기준 상승에 따른 낡음 */
export function lifeBar(s: CarState, g: Generation): number {
  const m = g.status === 'onSale' ? monthOf(s.week) : (g.endMonth ?? monthOf(s.week));
  const age = lifeAge(g, m), decay = age < config.life.rampMonths ? 1 : lifeFactor(age);
  return Math.max(0, Math.min(1, (decay * standard(yearOfMonth(g.launchMonth))) / standard(yearOfMonth(m))));
}

/** 차 카드 조언 한 줄. s를 주면 지금 달 기준으로 페이스리프트·풀체인지 권유를 정한다(없으면 판매 기록 길이로 어림) */
export function advice(g: Generation, s?: CarState): string {
  const d = config.discontinue;
  if (g.status === 'discontinued') return '단종된 차입니다.';
  if (g.status === 'ending') return '이번 달 말까지만 판매하고 단종됩니다.';
  if (!g.sales.length) return '출시 직후입니다. 첫 달 판매를 기다리세요.';
  const last = g.sales[g.sales.length - 1], peak = Math.max(...g.sales);
  if (g.sales.length >= d.adviceMonths && g.sales.slice(-d.adviceMonths).every((x) => x < d.adviceSales)) return `판매가 ${d.adviceMonths}개월째 월 ${d.adviceSales}대 미만입니다. 단종을 권합니다.`;
  if (peak > 0 && last <= peak * d.adviceDrop) {
    const head = `판매가 정점의 ${Math.round((last / peak) * 100)}%로 떨어졌습니다.`, L = config.lifecycle;
    const age = (s ? monthOf(s.week) : g.launchMonth + g.sales.length) - g.launchMonth;
    if (!g.editions.some((e) => e.kind === 'facelift') && age >= L.facelift.afterMonths) return `${head} 페이스리프트를 고려하세요.`;
    if (age >= L.fullChange.afterMonths) return `${head} 풀체인지를 고려하세요.`;
    return `${head} 후속 모델을 준비하세요.`;
  }
  if (g.lostSales >= 1) return '주문이 생산량을 넘습니다. 공장을 증설하세요. 가격을 올려도 잘 팔립니다.';
  if (currentEdition(g).defects > 0) return '남은 결함이 있어 리콜 위험이 있습니다.';
  return '판매가 순조롭습니다.';
}

/** 출시할 수 있는 빈 생산 라인이 있는가 */
export const hasFreeLine = (s: CarState): boolean => sellingGens(s).length < linesOf(s);

// ---------- 차종의 일생(8장) ----------
/** 페이스리프트 미리보기: 예상 비용(설계 4주 + 최소 시험), 예상 등급(난수 1.0·최소 시험), D 가산(상한 적용), 수명·인지도 변화 */
export interface FaceliftPreview {
  eligibility: Eligibility; cost: number; designWeeks: number; minTestWeeks: number;
  grades: Stats; avg: number; avgBefore: number; dGain: number; dCap: number;
  lifeBefore: number; lifeAfter: number; awarenessBefore: number; awarenessAfter: number;
}
export function faceliftPreview(s: CarState, generationId: number, spec: { options: string[]; tier?: number }): FaceliftPreview | null {
  const g = generationById(s, generationId);
  if (!g) return null;
  const fl = config.lifecycle.facelift, d = config.dev, ed = currentEdition(g), tier = spec.tier ?? ed.tier, team = idleDevStaff(s);
  const m = monthOf(s.week), y = yearOf(s.week + fl.designWeeks + d.minTestWeeks);
  const dir: Stats = { P: 2, E: 2, U: 2, D: 2, Q: 2 }, mult = bodyById(g.body).mult;
  const dRaw = faceliftWeekByStaff(team, { budget: 'normal', direction: dir }, () => 1).reduce((a, w) => a + w.D, 0) * fl.designWeeks;
  const dCap = fl.dCap * g.editions[0].stats.D, dGain = Math.min(mult.D * dRaw, dCap);
  const defects = Math.max(0, ed.defects * fl.defectKeep + dRaw * d.defectPerPoint * fl.defectRate - testCut(team) * d.minTestWeeks);
  const stats = finalStats(g.body, g.powertrain, Math.max(ed.level, levelForTier(s, g.powertrain, tier)), spec.options, g.points, defects);
  stats.D += dGain;
  const age = lifeAge(g, m), keep = m - g.launchMonth >= fl.lateMonths ? fl.lateLifeKeep : fl.lifeKeep;
  return {
    eligibility: faceliftEligibility(s, generationId), cost: faceliftWeekCost(g.devCost) * (fl.designWeeks + d.minTestWeeks), designWeeks: fl.designWeeks, minTestWeeks: d.minTestWeeks,
    grades: grades(stats, y), avg: avgGrade(stats, y), avgBefore: avgGrade(ed.stats, y), dGain, dCap,
    lifeBefore: lifeFactor(age), lifeAfter: lifeFactor(age * keep), awarenessBefore: g.awareness, awarenessAfter: Math.min(1, g.awareness + fl.awareness),
  };
}

/** 풀체인지 미리보기: planPreview + 비용 할인(같은 차체 85%), 이어받을 차종 자산, 전작 비교 예상, 재구매 수요 */
export interface FullChangePreview {
  eligibility: Eligibility; grades: Stats; avg: number; min: number; max: number; cost: number; costMult: number;
  equity: number; equityBase: number; bodyChanged: boolean; revival: boolean;
  prevAvg: number; compare: 'better' | 'worse' | 'same'; rebuyPerMonth: number;
}
export function fullChangePreview(s: CarState, nameplateId: number, spec: Omit<ProjectSpec, 'name'>): FullChangePreview | null {
  const n = nameplateById(s, nameplateId);
  if (!n || !n.generations.length) return null;
  const prev = latestGen(n), pv = planPreview(s, { ...spec, name: n.name }), costMult = fullChangeCostMult(prev.body === spec.body);
  const eq = carriedEquity(s, nameplateId, spec.body), prevAvg = launchAvgGrade(prev);
  return {
    eligibility: fullChangeEligibility(s, nameplateId), ...pv, cost: pv.cost * costMult, costMult,
    equity: eq.equity, equityBase: eq.base, bodyChanged: eq.bodyChanged, revival: eq.revival,
    prevAvg, compare: pv.avg > prevAvg ? 'better' : pv.avg < prevAvg ? 'worse' : 'same', rebuyPerMonth: rebuyPerMonth(prev),
  };
}

/** 차종 계보(기록 화면): 세대별 출시·단종 달, 평론, 판매, 판 */
export function lineage(s: CarState, nameplateId: number) {
  const n = nameplateById(s, nameplateId);
  return (n?.generations ?? []).map((g) => ({
    generationId: g.id, number: g.number, body: g.body, launchMonth: g.launchMonth, endMonth: g.endMonth, status: g.status,
    label: g.endMonth !== null ? `단종(${monthLabel(g.endMonth)})` : g.status === 'onSale' ? '판매 중' : '단종 예정',
    reviewAvg: g.reviewAvg, totalSold: g.totalSold, editions: g.editions.map((e) => e.kind), chassisSeed: g.chassisSeed,
  }));
}

export { planEntries, nameplateEquity, lookCandidates, faceliftEligibility, fullChangeEligibility, type PlanEntries, type NameplateEntry, type Eligibility } from './lifecycle';

/** 대출 남은 한도 */
export { loanLimit, loanRate } from './finance';
export { dateOf, dateLabel, monthLabel } from './time';
export { grade, grades, avgGrade, standard, unitCost, bodiesAt, powertrainsAt, optionsAt, salaryOf } from './cars';

// ---------- 연구(10장)·시대 사건(11장)·조합 노트(5.5) ----------
export { researchInfo, researchError, researchCost, researchSlots, weeklyResearchPoints, unlockedBodies, unlockedOptions, unlockedPowertrains, powertrainLevels, ptLevel, levelForTier, ptCostAdd, techEffectsText, FIELD_NAMES, type ResearchInfo, type TechRow, type TechStatus } from './research';
export { activeEvents, eventImpactOn, pendingChoices, newsLog, upcomingEvents, regulationError, chargingInfra, type ActiveEvent } from './events';

/** 궁합 기호(◎ 1.2 / ○ 1.0 / △ 0.8 / × 0.6) */
export const compatMark = (v: number): string => (v >= 1.2 ? '◎' : v >= 1 ? '○' : v >= 0.8 ? '△' : '×');
export interface ComboNote { body: string; segment: string; mark: string; value: number; carName: string; generationId: number; reviewAvg: number; launchMonth: number }
/** 조합 노트(5.5): 출시해 본 차체 × 고객층만 궁합이 공개된다. 그 조합을 처음 낸 차와 평론. 공개된 순서 */
export function comboNotes(s: CarState): ComboNote[] {
  return s.knownCombos.flatMap((key) => {
    const [body, segment] = key.split(':'), g = allGens(s).find((x) => x.body === body && x.segment === segment);
    const v = COMPAT[body]?.[segment] ?? 1;
    return g ? [{ body, segment, mark: compatMark(v), value: v, carName: nameplateOf(s, g.id)?.name ?? '', generationId: g.id, reviewAvg: g.reviewAvg, launchMonth: g.launchMonth }] : [];
  });
}
/** 기획 화면 한 칸의 궁합: 공개된 조합이면 기호, 아니면 null(아직 모름) */
export const comboMark = (s: CarState, body: string, segment: string): string | null =>
  s.knownCombos.includes(`${body}:${segment}`) ? compatMark(COMPAT[body]?.[segment] ?? 1) : null;

// ---------- 회사(9장) ----------
const hqLevelInfo = (level: number) => { const h = config.hq.levels[level - 1]; return { level, name: h.name, cost: h.cost, rep: h.rep, staffCap: h.staff, teams: h.teams, optionSlots: h.options, upkeep: h.upkeep }; };
export type HqLevelInfo = ReturnType<typeof hqLevelInfo>;
/** 본사(9.2): 지금 등급, 다음 등급(없으면 null)과 승급 가능 여부·이유 */
export function hqInfo(s: CarState): { current: HqLevelInfo; next: HqLevelInfo | null; canUpgrade: boolean; reason: string | null; staffCount: number } {
  const reason = hqUpgradeError(s);
  return { current: hqLevelInfo(s.hqLevel), next: s.hqLevel < config.hq.levels.length ? hqLevelInfo(s.hqLevel + 1) : null, canUpgrade: reason === null, reason, staffCount: s.staff.length };
}

const factoryLevelInfo = (level: number) => { const f = config.factory.levels[level - 1]; return { level, capacity: f.capacity, lines: f.lines, cost: f.cost, upkeep: f.upkeep, costMult: f.costMult }; };
export type FactoryLevelInfo = ReturnType<typeof factoryLevelInfo>;
/** 공장 차종별 줄: 지난달 수요·생산(판매)·밀린 주문(못 판 대수), 배분(manual = 수동 몫 또는 null, share = 지난달 실제 몫) */
export interface FactoryCar { generationId: number; name: string; demand: number; produced: number; backlog: number; manual: number | null; share: number }
/** 공장(9.3): 지금·다음 등급, 공사 남은 달, 생산 라인 사용, 차종별 배분·수요·밀린 주문, 주문/한도 비율 */
export function factoryInfo(s: CarState): {
  current: FactoryLevelInfo; next: FactoryLevelInfo | null; canExpand: boolean; reason: string | null;
  building: { level: number; monthsLeft: number } | null; linesUsed: number; upkeepTotal: number;
  cars: FactoryCar[]; demand: number; produced: number; ratio: number;
} {
  const reason = factoryExpandError(s), cap = capacityOf(s), b = s.factory.build;
  const cars = sellingGens(s).map((g): FactoryCar => {
    const produced = g.sales.at(-1) ?? 0;
    return { generationId: g.id, name: s.nameplates.find((n) => n.generations.includes(g))?.name ?? '', demand: g.lastDemand, produced, backlog: g.lostSales, manual: g.allocShare, share: produced / cap };
  });
  const demand = cars.reduce((a, c) => a + c.demand, 0), produced = cars.reduce((a, c) => a + c.produced, 0);
  return {
    current: factoryLevelInfo(s.factory.level), next: s.factory.level < config.factory.levels.length ? factoryLevelInfo(s.factory.level + 1) : null,
    canExpand: reason === null, reason, building: b ? { level: b.level, monthsLeft: b.doneMonth - monthOf(s.week) } : null,
    linesUsed: sellingGens(s).length, upkeepTotal: upkeepOf(s), cars, demand, produced, ratio: demand / cap,
  };
}

/** 직원 한 명의 화면용 요약(9.1). status: 개발 중 / 쉬는 중 / 교육 중 / 휴식 중 / 영업(영업 직무) */
export interface StaffRow {
  id: number; name: string; role: Role; ability: number; potential: number; atPotential: boolean; salary: number;
  condition: number; conditionMult: number; projectId: number | null;
  status: 'working' | 'idle' | 'training' | 'resting' | 'sales'; weeksLeft: number; // 교육·휴식 남은 주
  canTrain: boolean; trainReason: string | null; trainCost: number; trainingsThisYear: number; severance: number;
}
export function staffInfo(s: CarState): StaffRow[] {
  return [...s.staff].sort((a, b) => a.id - b.id).map((x) => {
    const tr = isTraining(x, s.week), rs = isResting(x, s.week), why = trainError(s, x);
    const weeksLeft = tr ? x.trainings[x.trainings.length - 1] + config.staff.train.weeks - s.week : rs ? x.restUntil! - s.week : 0;
    return {
      id: x.id, name: x.name, role: x.role, ability: x.ability, potential: x.potential, atPotential: x.ability >= x.potential, salary: salaryOf(x.ability),
      condition: x.condition, conditionMult: conditionMult(x.condition), projectId: x.projectId,
      status: tr ? 'training' : rs ? 'resting' : x.role === 'sales' ? 'sales' : x.projectId !== null ? 'working' : 'idle', weeksLeft,
      canTrain: why === null, trainReason: why, trainCost: trainCost(x.ability), trainingsThisYear: trainingsThisYear(x, s.week), severance: salaryOf(x.ability) * config.staff.severanceMonths,
    };
  });
}

/** 채용(9.1): 정원, 공고 등급별 비용, 후보 목록(남은 주) */
export function hiringInfo(s: CarState) {
  const H = config.staff.hire, full = s.staff.length >= staffCap(s);
  return {
    staffCount: s.staff.length, capacity: staffCap(s), full,
    tiers: H.postCost.map((cost, i) => ({ tier: (i + 1) as 1 | 2 | 3, cost, abilityMin: H.abilityMin[i], abilityMax: H.abilityMax[i], minRep: i === 2 ? H.tier3Rep : 0 })), // minRep: 그 등급 공고에 필요한 평판
    canPost: !full && !s.candidates.length, reason: full ? `정원(${staffCap(s)}명)이 찼습니다. 본사 등급을 올리면 정원이 늘어납니다.` : s.candidates.length ? '이미 공고한 후보가 있습니다.' : null,
    candidates: s.candidates.map((c) => ({ ...c, weeksLeft: c.expiresWeek - s.week })),
  };
}

/** 이 팀(직원 ID)으로 개발하면 예상 등급 범위와 개발비(planPreview를 팀 인자로). 없는 ID·영업 직원은 빼고 계산 */
export function teamPreview(s: CarState, staffIds: number[], spec: ProjectSpec) {
  return planPreview(s, spec, s.staff.filter((x) => staffIds.includes(x.id) && isDevRole(x.role)));
}

/** 생산 조언 한 줄(9.3): 주문/한도 비율로 */
export function capacityAdvice(s: CarState): string {
  const f = factoryInfo(s), r = f.ratio;
  if (!f.cars.length || f.demand <= 0) return '판매 중인 차가 없습니다.';
  const x = `한도의 ${r.toFixed(1)}배`;
  if (r >= 1.3) return f.building ? `주문이 ${x}입니다. 증설 공사가 ${f.building.monthsLeft}개월 남았습니다.` : f.next ? `주문이 ${x}입니다. 공장 증설을 고려하세요.` : `주문이 ${x}입니다. 가격을 올려도 잘 팔립니다.`;
  if (r > 1) return `주문이 한도를 조금 넘습니다(${x}).`;
  if (r < 0.7) return `생산에 여유가 있습니다(한도의 ${Math.round(r * 100)}%만 주문).`;
  return '생산량이 주문에 잘 맞습니다.';
}

export { hqDef, factoryDef, staffCap, devTeams, optionSlots, capacityOf, linesOf, costMultOf, upkeepOf } from './company';
