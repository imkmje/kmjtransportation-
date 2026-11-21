// 화면이 쓰는 조회 함수(순수 함수, 상태를 바꾸지 않는다)
import { config } from '../config';
import { COMPAT, MARKET, SEGMENTS, bodyById } from '../data';
import { avgGrade, finalStats, grade, grades, lifeFactor, salaryOf, standard, unitCost, zeroStats } from './cars';
import { withRequired, devScale, designWeek, devCostPerWeek, faceliftWeekByStaff, faceliftWeekCost, fullChangeCostMult, testCut, weeklyDevCost } from './dev';
import { allGens, linesUsed, sellingGens } from './game';
import { factoryBuildMonths, factoryUpkeep, hqUpkeep, capacityOf, conditionMult, costMultOf, factoryExpandError, hqUpgradeError, isDevRole, isResting, isTraining, linesOf, staffCap, trainCost, trainError, trainingsThisYear, upkeepOf } from './company';
import { carriedEquity, compareToPrev, faceliftEligibility, faceliftRefresh, fullChangeEligibility, launchAvgGrade, nameplateById, latestGen, rebuyPerMonth, type Eligibility } from './lifecycle';
export { basePriceOf, carBasePrice, genBasePrice, optionValue } from './market';
import { REGION, carBasePrice, genBasePrice, awarenessStart, awarenessTarget, currentEdition, monthlyDemand, toSaleCar, lifeAge } from './market';
import { criticScores, mean } from './reviews';
import { diffOf } from './difficulty';
import { regulationBlock, requiredOptions } from './events';
export { difficultyInfo } from './difficulty';
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
  const scores = criticScores(pv.stats, yearOf(s.week), carBasePrice(s, p), price, p.defects, () => 0, diffOf(s).manyDefects);
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

/** 남은 결함(화면에 보이는 "약 N개") 판단: 감점 기준(보통 15개, s를 주면 난이도 값) 이상 많음 / 6개~기준 미만 조금 더 / 5 이하 출시 좋음. recallYear: 연 리콜 확률(6.3) */
export function defectAdvice(p: Project, s?: CarState): { level: 'many' | 'some' | 'ok'; text: string; recallYear: number } {
  const c = config.critics, n = p.defectEst, recallYear = Math.min(config.recall.maxYear, n * config.recall.perDefect);
  if (n >= (s ? diffOf(s).manyDefects : c.manyDefects)) return { level: 'many', recallYear, text: `결함이 아직 많습니다. 지금 출시하면 평론가 4명이 모두 ${c.manyDefectsPenalty}점씩 깎고, 리콜 위험이 큽니다.` };
  if (n > c.okDefects) return { level: 'some', recallYear, text: '조금 더 시험하면 좋습니다.' };
  return { level: 'ok', recallYear, text: '출시해도 좋습니다.' };
}

/** 쉬고 있는 개발 직무 직원(팀을 고르지 않았을 때의 기본 팀) */
const idleDevStaff = (s: CarState): Staff[] => s.staff.filter((x) => x.projectId === null && isDevRole(x.role));

/** 기획 미리보기: 지금 쉬는 개발 직원(team을 주면 그 팀)으로 개발하면 받을 표시 등급과 개발비(설계 + 최소 시험).
 *  min = 주간 난수가 모두 최저·최소 시험 주로 출시, max = 모두 최고·시험으로 결함을 다 없앤 경우. grades·avg는 난수 1.0·최소 시험 */
/** segmentScore(0.5.1): 고른 고객층이 느끼는 매력 = Σ 고객층 가중치 × 표시 등급(0~10, 궁합은 숨김이라 빼고). bestSegment: 이 차의 등급과 이 차체 손님 구성으로 본 추천 고객층 */
export function planPreview(s: CarState, spec: ProjectSpec, team: Staff[] = idleDevStaff(s)): { stats: Stats; grades: Stats; avg: number; min: number; max: number; cost: number; blockedBy: string | null; required: string[]; segmentScore: number; bestSegment: string } {
  const d = config.dev;
  const y = yearOf(s.week + spec.designWeeks + d.minTestWeeks); // 출시하는 해 기준(해가 바뀌면 등급이 낮아진다)
  const level = levelForTier(s, spec.powertrain, spec.tier), speed = 1 + devSpeed(s), cut = 1 - defectCut(s); // 연구: 동력 단계·개발 속도·결함 감소
  const at = (r: number, defectFree: boolean): Stats => {
    const w = designWeek(team, spec, () => r), pts = zeroStats();
    for (const k of STATS) pts[k] = w[k] * spec.designWeeks * speed;
    const made = STATS.reduce((a, k) => a + pts[k], 0);
    const defects = defectFree ? 0 : Math.max(0, made * d.defectPerPoint * cut - testCut(team) * d.minTestWeeks);
    return finalStats(spec.body, spec.powertrain, level, withRequired(s, spec.options), pts, defects); // 의무 장비 포함(0.4.2)
  };
  const mid = at(1, false), lo = avgGrade(at(d.randMin, false), y), hi = avgGrade(at(d.randMax, true), y);
  const gr = grades(mid, y), fit = (seg: string) => STATS.reduce((a, k) => a + SEGMENTS.find((x) => x.id === seg)!.w[k] * gr[k], 0), mix = MARKET[REGION].mix[spec.body] ?? {};
  const bestSegment = [...SEGMENTS].sort((a, b) => fit(b.id) * (mix[b.id] ?? 0) - fit(a.id) * (mix[a.id] ?? 0) || (a.id < b.id ? -1 : 1))[0].id;
  return { segmentScore: fit(spec.segment), bestSegment, blockedBy: regulationBlock(s), required: [...requiredOptions(s)], stats: mid, grades: grades(mid, y), avg: avgGrade(mid, y), min: Math.min(lo, hi), max: Math.max(lo, hi), cost: devCostPerWeek(team, spec.budget, diffOf(s).prototypeMult * devScale(s, spec.body)) * (spec.designWeeks + d.minTestWeeks) };
}

/** 대당 이익 = 판매가 − 원가. costMult: 원가 배수(생략하면 1, 화면은 costMultOf(state)를 넘길 것). ptAdd: 동력 원가 가산(ptCostAdd(state, 동력), 생략하면 자료값) */
export const unitProfit = (body: string, powertrain: string, tier: number, options: string[], price: number, costMult = 1, ptAdd?: number): number => price - unitCost(body, powertrain, tier, options, costMult, ptAdd);
/** 세대의 지금 대당 이익. s를 주면 원가 배수(공장·연구·사건)와 연구로 줄어든 동력 가산을 반영 */
export const generationUnitProfit = (g: Generation, s?: CarState): number => { const e = currentEdition(g); return unitProfit(g.body, g.powertrain, e.tier, e.options, e.price, s ? costMultOf(s) : 1, s ? ptCostAdd(s, g.powertrain) : undefined); };

/** 예상 월 판매 범위(0.5.0): 출시 3개월째(수명 1.0, 인지도가 3개월 동안 목표로 다가간 값)의 수요 ± forecastSpread(30%). 생산 상한 적용.
 *  (예전: 출시 첫 달 최저 ~ 목표 인지도 최고라 "2~47대"처럼 폭이 너무 넓었다) */
export function salesForecast(s: CarState, projectId: number, price: number, marketing: number): { min: number; max: number } | null {
  const mid = launchDemand(s, projectId, price, marketing), F = config.forecast, cap = (d: number) => Math.round(Math.min(capacityOf(s), d));
  return mid === null ? null : { min: cap(mid * (1 - F.spread)), max: cap(mid * (1 + F.spread)) };
}
/** 출시 3개월째 월 수요(생산 한도 전). salesForecast·bestLaunchPrice가 함께 쓴다 */
function launchDemand(s: CarState, projectId: number, price: number, marketing: number): number | null {
  const p = projectById(s, projectId), pv = projectPreview(s, projectId), ex = expectedReviews(s, projectId, price);
  if (!p || !pv || !ex) return null;
  const y = yearOf(s.week), m = monthOf(s.week);
  const others = sellingGens(s).filter((g) => g.status === 'onSale').map((g) => toSaleCar(g, m));
  const start = awarenessStart(s.reputation, ex.avg), target = Math.max(start, awarenessTarget(s.reputation, marketing, grade(pv.stats.Q, y)));
  const car = { body: p.body, segment: p.segment, stats: pv.stats, price, powertrain: p.powertrain, options: withRequired(s, p.options) };
  const aw = target + (start - target) * (1 - config.awareness.rate) ** config.forecast.months;
  return monthlyDemand(s, { ...car, awareness: aw, life: 1 }, others, monthTime(m));
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
  if (g.lostSales >= 1) { // 0.5.1: 가격 벌점(기준가 초과 ^6, 108% 넘으면 급감)에 맞춘 조언
    const top = (s ? genBasePrice(s, g) : bodyById(g.body).basePrice) * config.market.overpriceHardAt;
    return currentEdition(g).price < top - 1e-6 ? `주문이 생산량을 넘습니다. 기준가의 ${Math.round(config.market.overpriceHardAt * 100)}%까지는 값을 조금씩 올려 볼 만합니다. 공장 증설도 고려하세요.` : '주문이 생산량을 넘습니다. 값은 이미 충분히 높으니 공장 증설을 권합니다.';
  }
  if (currentEdition(g).defects > 0) return '남은 결함이 있어 리콜 위험이 있습니다.';
  return '판매가 순조롭습니다.';
}

/** 출시할 수 있는 빈 생산 라인이 있는가 */
export const hasFreeLine = (s: CarState): boolean => linesUsed(s) < linesOf(s);

// ---------- 차종의 일생(8장) ----------
/** 페이스리프트 미리보기: 예상 비용(설계 4주 + 최소 시험), 예상 등급(난수 1.0·최소 시험), D 가산(상한 적용), 수명·인지도 변화 */
export interface FaceliftPreview {
  eligibility: Eligibility; cost: number; designWeeks: number; minTestWeeks: number;
  grades: Stats; avg: number; avgBefore: number; dGain: number; dCap: number;
  lifeBefore: number; lifeAfter: number; awarenessBefore: number; awarenessAfter: number;
  // 0.5.1 손익(지금 달 시장 기준 어림, 생산 한도 적용): 월 판매·월 이익(광고비 뺌, 월급·유지비 제외) 전→후, 비용 회수 개월(이익이 늘지 않으면 null)
  salesBefore: number; salesAfter: number; profitBefore: number; profitAfter: number; paybackMonths: number | null;
  tooEarly: boolean; // 출시 goodFromMonths(30)개월 전: 지금 하면 수명을 덜 되돌려 효과가 작다
  recommendedTeam: number[]; // 추천 팀: 쉬는 디자이너·테스터(엔지니어는 연구에 남긴다)
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
  const stats = faceliftRefresh(finalStats(g.body, g.powertrain, Math.max(ed.level, levelForTier(s, g.powertrain, tier)), withRequired(s, spec.options), g.points, defects)); // 출시 때처럼 의무 장비 포함
  stats.D += dGain;
  const age = lifeAge(g, m), keep = m - g.launchMonth >= fl.lateMonths ? fl.lateLifeKeep : fl.lifeKeep;
  return {
    eligibility: faceliftEligibility(s, generationId), cost: faceliftWeekCost(g.devCost) * (fl.designWeeks + d.minTestWeeks), designWeeks: fl.designWeeks, minTestWeeks: d.minTestWeeks,
    grades: grades(stats, y), avg: avgGrade(stats, y), avgBefore: avgGrade(ed.stats, y), dGain, dCap,
    lifeBefore: lifeFactor(age), lifeAfter: lifeFactor(age * keep), awarenessBefore: g.awareness, awarenessAfter: Math.min(1, g.awareness + fl.awareness),
    ...faceliftMoney(s, g, stats, spec.options, Math.max(tier, ed.tier), age * keep),
    tooEarly: m - g.launchMonth < fl.goodFromMonths,
    recommendedTeam: s.staff.filter((x) => x.projectId === null && !x.lab && (x.role === 'designer' || x.role === 'tester')).map((x) => x.id).sort((a, b) => a - b),
  };
}
/** 리프트 전후 월 판매·월 이익 어림(지금 달, 같은 가격·광고). 판매는 이 차의 지난달 수요 대비 한도 몫으로 자른다 */
function faceliftMoney(s: CarState, g: Generation, stats: Stats, options: string[], tier: number, lifeAgeAfter: number) {
  const m = monthOf(s.week), ed = currentEdition(g), fl = config.lifecycle.facelift, t = monthTime(m);
  const others = sellingGens(s).filter((x) => x !== g && x.status === 'onSale').map((x) => toSaleCar(x, m)), cur = toSaleCar(g, m);
  const cap = capacityOf(s) * (g.allocShare ?? 1), mk = config.awareness.marketingCost[g.marketing];
  const before = Math.min(cap, monthlyDemand(s, cur, others, t)), after = Math.min(cap, monthlyDemand(s, { ...cur, stats, options: withRequired(s, options), awareness: Math.min(1, g.awareness + fl.awareness), life: lifeFactor(lifeAgeAfter) }, others, t));
  const unit = (opts: string[], tr: number) => ed.price - unitCost(g.body, g.powertrain, tr, opts, costMultOf(s), ptCostAdd(s, g.powertrain));
  const pb = before * unit(ed.options, ed.tier) - mk, pa = after * unit(withRequired(s, options), tier) - mk, cost = faceliftWeekCost(g.devCost) * (fl.designWeeks + config.dev.minTestWeeks);
  return { salesBefore: Math.round(before), salesAfter: Math.round(after), profitBefore: pb, profitAfter: pa, paybackMonths: pa > pb ? Math.ceil(cost / (pa - pb)) : null };
}

/** 풀체인지 미리보기: planPreview + 비용 할인(같은 차체 85%), 이어받을 차종 자산, 전작 비교 예상, 재구매 수요 */
export interface FullChangePreview {
  eligibility: Eligibility; grades: Stats; avg: number; min: number; max: number; cost: number; costMult: number;
  equity: number; equityBase: number; bodyChanged: boolean; revival: boolean;
  prevAvg: number; compare: 'better' | 'worse' | 'same'; rebuyPerMonth: number;
  hints: string[]; // 0.5.1: '전작만 못함'일 때 해결책(설계 기간·예산·팀·교육), 아니면 빈 목록
}
export function fullChangePreview(s: CarState, nameplateId: number, spec: Omit<ProjectSpec, 'name'>): FullChangePreview | null {
  const n = nameplateById(s, nameplateId);
  if (!n || !n.generations.length) return null;
  const prev = latestGen(n), pv = planPreview(s, { ...spec, name: n.name }), costMult = fullChangeCostMult(prev.body === spec.body);
  const eq = carriedEquity(s, nameplateId, spec.body), prevAvg = launchAvgGrade(prev);
  return {
    eligibility: fullChangeEligibility(s, nameplateId), ...pv, cost: pv.cost * costMult, costMult,
    equity: eq.equity, equityBase: eq.base, bodyChanged: eq.bodyChanged, revival: eq.revival,
    prevAvg, compare: compareToPrev(prev, pv.stats, spec.body), rebuyPerMonth: rebuyPerMonth(prev), // 전작 비교는 원점수로(0.4.2), prevAvg는 화면 참고용
    hints: compareToPrev(prev, pv.stats, spec.body) === 'worse' ? fullChangeHints(s, spec) : [],
  };
}

/** 전작보다 못할 때 해결책 한 줄씩(0.5.1) */
function fullChangeHints(s: CarState, spec: Omit<ProjectSpec, 'name'>): string[] {
  const d = config.dev, out: string[] = [], max = d.designWeeks[d.designWeeks.length - 1];
  if (spec.designWeeks < max) out.push(`설계 기간을 ${max}주로 늘리면 점수가 더 쌓입니다.`);
  if (spec.budget !== 'high') out.push("예산을 '과감'으로 올리면 주간 점수가 25% 늘어납니다(비용 2배).");
  if (s.staff.some((x) => x.projectId === null && isDevRole(x.role) && !x.lab)) out.push('쉬고 있는 개발 직원을 팀에 더 넣으세요.');
  if (s.staff.some((x) => isDevRole(x.role) && !trainError(s, x))) out.push('직원을 교육해 능력을 올린 뒤 시작하면 좋습니다.');
  out.push('전작이 페이스리프트로 좋아졌다면, 같은 옵션과 동력 등급 이상을 고르세요.');
  return out;
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

export { planEntries, retrofitInfo, type RetrofitInfo, nameplateEquity, lookCandidates, faceliftEligibility, fullChangeEligibility, type PlanEntries, type NameplateEntry, type Eligibility } from './lifecycle';

/** 대출 남은 한도 */
export { loanLimit, loanRate } from './finance';
export { dateOf, dateLabel, monthLabel } from './time';
export { grade, grades, avgGrade, standard, unitCost, bodiesAt, powertrainsAt, optionsAt, salaryOf } from './cars';

// ---------- 연구(10장)·시대 사건(11장)·조합 노트(5.5) ----------
export { researchInfo, researchError, researchCost, researchSlots, weeklyResearchPoints, unlockedBodies, unlockedOptions, unlockedPowertrains, powertrainLevels, ptLevel, levelForTier, ptCostAdd, techEffectsText, FIELD_NAMES, type ResearchInfo, type TechRow, type TechStatus } from './research';
export { activeEvents, eventImpactOn, pendingChoices, newsLog, upcomingEvents, regulationError, regulationBlock, requiredOptions, chargingInfra, type ActiveEvent, type RegulationDeadline } from './events';

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
const hqLevelInfo = (s: CarState, level: number) => { const h = config.hq.levels[level - 1]; return { level, name: h.name, cost: h.cost, rep: h.rep, staffCap: h.staff, teams: h.teams, optionSlots: h.options, upkeep: hqUpkeep(s, level) }; }; // upkeep: 실제 월 청구액(난이도 배수, 0.5.1)
export type HqLevelInfo = ReturnType<typeof hqLevelInfo>;
/** 본사(9.2): 지금 등급, 다음 등급(없으면 null)과 승급 가능 여부·이유 */
export function hqInfo(s: CarState): { current: HqLevelInfo; next: HqLevelInfo | null; canUpgrade: boolean; reason: string | null; staffCount: number } {
  const reason = hqUpgradeError(s);
  return { current: hqLevelInfo(s, s.hqLevel), next: s.hqLevel < config.hq.levels.length ? hqLevelInfo(s, s.hqLevel + 1) : null, canUpgrade: reason === null, reason, staffCount: s.staff.length }; // 임원은 정원 밖(0.8.0)
}

const factoryLevelInfo = (s: CarState, level: number) => { const f = config.factory.levels[level - 1]; return { level, capacity: f.capacity, lines: f.lines, cost: f.cost, upkeep: factoryUpkeep(s, level), costMult: f.costMult, buildMonths: factoryBuildMonths(level) }; }; // upkeep: 실제 월 청구액(난이도 배수·연구 감면, 0.5.1)
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
    current: factoryLevelInfo(s, s.factory.level), next: s.factory.level < config.factory.levels.length ? factoryLevelInfo(s, s.factory.level + 1) : null,
    canExpand: reason === null, reason, building: b ? { level: b.level, monthsLeft: b.doneMonth - monthOf(s.week) } : null,
    linesUsed: linesUsed(s), upkeepTotal: upkeepOf(s), cars, demand, produced, ratio: demand / cap,
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
  if (r >= 1.3) return f.building ? `주문이 ${x}입니다. 증설 공사가 ${f.building.monthsLeft}개월 남았습니다.` : f.next ? `주문이 ${x}입니다. 공장 증설을 고려하세요.` : `주문이 ${x}입니다. 기준가의 ${Math.round(config.market.overpriceHardAt * 100)}%까지는 값을 조금씩 올려 볼 만합니다.`;
  if (r > 1) return `주문이 한도를 조금 넘습니다(${x}).`;
  if (r < 0.7) return `생산에 여유가 있습니다(한도의 ${Math.round(r * 100)}%만 주문).`;
  return '생산량이 주문에 잘 맞습니다.';
}

export { hqDef, factoryDef, staffCap, devTeams, optionSlots, capacityOf, linesOf, costMultOf, upkeepOf, factoryUpkeep, hqUpkeep } from './company';
export { linesUsed } from './game';

/** 판매 중인 차의 가격을 price로 바꾸면 이번 달 예상 판매(대, 생산 한도까지). 가격 슬라이더 미리 보기용(배분·재구매·단종 달 보정은 뺀 어림) */
export function priceForecast(s: CarState, generationId: number, price: number): number | null {
  const g = generationById(s, generationId);
  if (!g) return null;
  const m = monthOf(s.week), others = sellingGens(s).filter((x) => x.id !== g.id && x.status === 'onSale').map((x) => toSaleCar(x, m));
  return Math.round(Math.min(capacityOf(s), monthlyDemand(s, { ...toSaleCar(g, m), price }, others, monthTime(m))));
}

// ---------- 0.8.0 최고 이익 가격 ----------
/** 가격 결과: 가격, 예상 월 판매, 예상 월 이익(광고비 뺌, 월급·유지비 제외), 시장 기준가 대비 비율(1.05 = +5%) */
export interface BestPrice { price: number; sales: number; profit: number; vsBase: number }
/** 허용 가격(차체 기준가 × 0.6~2.0, sim setPrice 검사와 같은 범위)을 10만원 단위로 훑어 월 이익이 가장 큰 값. 같으면 싼 쪽 */
function scanPrices(body: string, base: number, f: (price: number) => { sales: number; profit: number }, uc = -Infinity, mk = 0): BestPrice {
  const b = bodyById(body).basePrice, step = 10, lo = Math.ceil((b * config.price.min) / step) * step, hi = Math.floor((b * config.price.max) / step) * step;
  const scan = (from: number, cut: boolean): BestPrice => {
    let best: BestPrice | null = null;
    for (let price = from; price <= hi; price += step) {
      const r = f(price);
      if (!best || r.profit > best.profit) best = { price, ...r, vsBase: 0 };
      if (cut && r.sales <= 0) break; // 수요는 값이 오를수록 줄므로 판매 0 뒤로는 이익이 −광고비뿐
    }
    return best!;
  };
  // 1.0.0 성능(같은 결과): 원가 이하 가격은 이익이 −광고비 이하라, 원가 위에서 −광고비보다 나은 값이 나오면 그것이 최댓값이다(아니면 전부 훑는다)
  const start = Math.max(lo, Math.ceil((uc + 1e-9) / step) * step);
  let best = start > lo ? scan(start, true) : null;
  if (!best || best.profit <= -mk) best = scan(lo, false);
  best.vsBase = best.price / base;
  return best;
}
/** 판매 중인 세대의 이번 달 최고 이익 가격(priceForecast와 같은 계산: 생산 한도, 지금 광고비) */
export function bestPrice(s: CarState, generationId: number): BestPrice | null {
  const g = generationById(s, generationId);
  if (!g) return null;
  const e = currentEdition(g), uc = unitCost(g.body, g.powertrain, e.tier, e.options, costMultOf(s), ptCostAdd(s, g.powertrain)), mk = config.awareness.marketingCost[g.marketing];
  const m = monthOf(s.week), car = toSaleCar(g, m), cap = capacityOf(s), t = monthTime(m), others = sellingGens(s).filter((x) => x.id !== g.id && x.status === 'onSale').map((x) => toSaleCar(x, m)); // priceForecast와 같은 계산(1.0.0 성능: 다른 차는 한 번만)
  return scanPrices(g.body, genBasePrice(s, g), (price) => { const sales = Math.round(Math.min(cap, monthlyDemand(s, { ...car, price }, others, t))); return { sales, profit: sales * (price - uc) - mk }; }, uc, mk);
}
/** 출시 전 프로젝트의 최고 이익 가격(출시 3개월째 수요, salesForecast의 가운데 값·생산 한도) */
export function bestLaunchPrice(s: CarState, projectId: number, marketing: number): BestPrice | null {
  const p = projectById(s, projectId);
  if (!p) return null;
  const uc = unitCost(p.body, p.powertrain, p.tier, withRequired(s, p.options), costMultOf(s), ptCostAdd(s, p.powertrain)), mk = config.awareness.marketingCost[marketing] ?? 0;
  return scanPrices(p.body, carBasePrice(s, { ...p, options: withRequired(s, p.options) }), (price) => { const sales = Math.round(Math.min(capacityOf(s), launchDemand(s, projectId, price, marketing)!)); return { sales, profit: sales * (price - uc) - mk }; });
}

// ---------- 0.7.0 할 일 목록 ----------
import { todoItems as todoCore, type TodoItem } from './todo';
export type { TodoItem, TodoKind, TodoGoto } from './todo';
/** 할 일 목록(급한 일 먼저). 임원 자리·보고는 임원 조회에서 받는다 */
export const todoItems = (s: CarState): TodoItem[] => {
  const unread = (s.execs?.reports ?? []).filter((r) => r.unread), info = execInfoQ(s);
  return todoCore(s, { vacant: info.seats - info.used, unread: unread.length, lastUnread: unread.reduce((a, r) => Math.max(a, r.id), 0) });
};
import { execInfo as execInfoQ } from './execs';

// ---------- 임원(0.7.0) ----------
export { execInfo, execReports, execUnread, marketIdea, profitAlloc, recommendTech, execSkill, execTier, execPay, monthlyFixed, seatsOf, EXEC_ROLES, EXEC_TITLE, DELEGATIONS, type ExecInfo } from './execs';

// ---------- 0.8.0 연 보고서·되돌리기 ----------
export { yearReport, reportYears, type YearReport, type YearCarRow, type YearMoney } from './report';
export { undoInfo } from './game';

// ---------- 0.10.0 정보와 수습 수단 ----------
export { modelPnL, nameplatePnL, salesFactors, staffHistory, staffBrief, decadeReview, decadeYears, rescueOptions, fixError, clearError, type ModelPnL, type NameplatePnL, type SalesFactor, type SalesFactors, type FactorKey, type StaffHistory, type DecadeReview, type RescueOptions } from './insight';

// ---------- 1.0.0 평판 ----------
export { repEffect, factoryBuildMonths } from './company';
import { repEffect } from './company';
/** 평판 효과가 eff가 되는 평판(repEffect의 역함수) */
const repFor = (eff: number): number => { const R = config.reputation; return eff <= R.soft ? eff : R.soft * 2 ** ((eff / R.soft - 1) / R.softStep); };
export interface ReputationInfo {
  value: number; effect: number; // 평판, 평판 효과(100까지는 같고 넘으면 완만하게)
  soft: boolean; // 평판이 soft(100)를 넘어 효과가 완만해지는 구간인가
  effects: { key: 'awareness' | 'hire' | 'exec' | 'tier3' | 'hq'; label: string; text: string }[]; // 지금 평판이 주는 효과
  next: { rep: number; text: string } | null; // 다음 문턱(가장 가까운 것)
}
/** 1.0.0 평판의 효과 목록과 다음 문턱(화면 ⓘ용). 평판은 위쪽 상한이 없고, 100을 넘으면 효과가 로그로 완만해진다 */
export function reputationInfo(s: CarState): ReputationInfo {
  const rep = s.reputation, eff = repEffect(rep), H = config.staff.hire, X = config.exec, hq = config.hq.levels[s.hqLevel];
  const hire = Math.floor(eff / H.repBonusDiv), ex = Math.floor(eff / X.repBonusDiv);
  const effects: ReputationInfo['effects'] = [
    { key: 'awareness', label: '인지도', text: `새 차의 시작·목표 인지도 +${Math.round((eff / config.awareness.repDiv) * 100)}%p` },
    { key: 'hire', label: '채용 후보', text: `직원 후보 능력 +${hire}` },
    { key: 'exec', label: '임원 후보', text: `외부 임원 후보 능력 +${ex}` },
    { key: 'tier3', label: '3등급 공고', text: rep >= H.tier3Rep ? '낼 수 있음' : `평판 ${H.tier3Rep}부터` },
  ];
  if (hq) effects.push({ key: 'hq', label: '본사 승급', text: rep >= hq.rep ? `${hq.name} 평판 조건 충족` : `${hq.name}: 평판 ${hq.rep} 필요` });
  const cands: { rep: number; text: string }[] = [
    ...config.hq.levels.filter((l) => l.rep > 0).map((l) => ({ rep: l.rep, text: `${l.name} 승급 조건` })),
    { rep: H.tier3Rep, text: '3등급 채용 공고' },
    { rep: repFor((hire + 1) * H.repBonusDiv), text: `직원 후보 능력 +${hire + 1}` },
  ];
  const next = cands.filter((c) => c.rep > rep + 1e-9).sort((a, b) => a.rep - b.rep)[0] ?? null;
  return { value: rep, effect: eff, soft: rep > config.reputation.soft, effects, next: next && { rep: Math.ceil(next.rep), text: next.text } };
}

// ---------- 1.0.0 고객층에 맞는 개발팀 자동 배치(화면용 순수 조회) ----------
/** shortcut: 멈춤 기준(매력 증가 최소값)은 화면 추천용 상수라 여기 둔다. 밸런스에서 조정할 일이 생기면 config.dev로 옮길 것 */
const BEST_TEAM_MIN_GAIN = 0.1;
export interface BestTeam { team: number[]; segmentScore: number; grade: number; cost: number; weeks: number; reserved: number | null; reason: string[] }
/** 고른 고객층의 매력(planPreview.segmentScore)이 가장 커지도록 팀을 탐욕적으로 고른다. 한 명을 더해 매력이 BEST_TEAM_MIN_GAIN 미만으로 오르면 멈춘다(팀 규모 체감·개발비).
 *  후보: 개발 직무, 교육·휴식 중이 아님, 전담 연구원 아님, 쉬는 직원(includeBusy면 다른 개발 중인 직원도). 임원은 직원 목록에 없다.
 *  keepEngineer: 전담 연구원이 없으면 쉬는 엔지니어 1명(능력 낮은 쪽)을 연구에 남긴다. 순서는 ID로 고정(결정론) */
export function bestTeam(s: CarState, spec: ProjectSpec, opts: { includeBusy?: boolean; keepEngineer?: boolean } = {}): BestTeam {
  const keepEng = opts.keepEngineer !== false, reason: string[] = [];
  let cands = s.staff.filter((x) => isDevRole(x.role) && !x.lab && !isTraining(x, s.week) && !isResting(x, s.week) && (x.projectId === null || opts.includeBusy)).sort((a, b) => a.id - b.id);
  let reserved: number | null = null;
  if (keepEng && !s.staff.some((x) => x.lab)) {
    const eng = cands.filter((x) => x.role === 'engineer' && x.projectId === null).sort((a, b) => a.ability - b.ability || a.id - b.id)[0];
    if (eng) { reserved = eng.id; cands = cands.filter((x) => x !== eng); reason.push(`연구에 엔지니어 ${eng.name} 1명을 남겼습니다.`); }
  }
  const score = (t: Staff[]) => planPreview(s, spec, t).segmentScore;
  const team: Staff[] = []; let cur = score(team);
  const seg = SEGMENTS.find((x) => x.id === spec.segment);
  if (seg) { const top = STATS.filter((k) => seg.w[k] > 0).sort((a, b) => seg.w[b] - seg.w[a]).slice(0, 2); const w = top.map((k) => STAT_KO[k]).join('·'); reason.push(`${seg.name} 고객층은 ${w}${josaQ(w, '을/를')} 중시합니다.`); }
  while (cands.length) {
    let best: Staff | null = null, bestV = -Infinity;
    for (const c of cands) { const v = score([...team, c]); if (v > bestV + 1e-9) { bestV = v; best = c; } }
    if (!best || (team.length && bestV - cur < BEST_TEAM_MIN_GAIN)) { if (best) reason.push(`한 명을 더 넣어도 매력이 ${BEST_TEAM_MIN_GAIN} 미만으로 올라 ${team.length}명에서 멈췄습니다.`); break; }
    team.push(best); cands = cands.filter((x) => x !== best); cur = bestV;
  }
  // 여러 명을 함께 넣어야 오르는 경우: 남은 후보 전원을 더한 팀이 사람당 기준 이상 높으면 그 팀
  if (cands.length) { const all = [...team, ...cands], v = score(all); if (v - cur >= BEST_TEAM_MIN_GAIN * cands.length) { team.push(...cands); cur = v; reason.push('남은 후보를 모두 넣는 편이 사람당 충분히 높아 모두 넣었습니다.'); } }
  const p = planPreview(s, spec, team);
  return { team: team.map((x) => x.id).sort((a, b) => a - b), segmentScore: p.segmentScore, grade: p.avg, cost: p.cost, weeks: spec.designWeeks + config.dev.minTestWeeks, reserved, reason };
}
import { josa as josaQ } from './josa';
const STAT_KO: Record<string, string> = { P: '성능', E: '연비', U: '실용', D: '디자인', Q: '품질' };
export { hallOfFame, type HallOfFame, type HallCar, type HallRow } from './hall';
