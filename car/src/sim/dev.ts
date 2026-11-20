// 개발 프로젝트(설계서 6장): 기획 검증, 주간 점수·결함, 주간 개발비
import { config } from '../config';
import { BODIES, POWERTRAINS, OPTIONS, SEGMENTS } from '../data';
import { defectCut, devSpeed, unlockedIds } from './research';
import { salaryOf, zeroStats } from './cars';
import { conditionMult, isAway, optionSlots } from './company';
import type { Rng } from './rng';
import { STATS, type Budget, type CarState, type Project, type ProjectSpec, type Staff, type Stats } from './types';

/** 기획 검증: 문제가 있으면 한국어 이유, 없으면 null */
export function specError(state: CarState, s: ProjectSpec): string | null {
  const body = BODIES.find((b) => b.id === s.body);
  if (!body || !unlockedIds(state, 'body').has(body.id)) return '아직 쓸 수 없는 차체입니다(연구가 필요합니다).';
  if (!SEGMENTS.some((x) => x.id === s.segment)) return '없는 고객층입니다.';
  const pt = POWERTRAINS.find((p) => p.id === s.powertrain);
  if (!pt || !unlockedIds(state, 'powertrain').has(pt.id)) return '아직 쓸 수 없는 동력입니다(연구가 필요합니다).';
  if (!Number.isInteger(s.tier) || s.tier < 1 || s.tier > pt.tiers.length) return `동력 등급은 1~${pt.tiers.length} 중에서 고르세요.`;
  if (!Array.isArray(s.options)) return '옵션 목록이 올바르지 않습니다.';
  if (s.options.length > optionSlots(state)) return `옵션은 최대 ${optionSlots(state)}개까지 고를 수 있습니다(본사 등급을 올리면 늘어납니다).`;
  if (new Set(s.options).size !== s.options.length) return '같은 옵션을 두 번 고를 수 없습니다.';
  const opts = unlockedIds(state, 'option');
  if (s.options.some((id) => !OPTIONS.some((x) => x.id === id) || !opts.has(id))) return '아직 쓸 수 없는 옵션입니다(연구가 필요합니다).';
  const d = s.direction;
  if (!d || STATS.some((k) => !Number.isInteger(d[k]) || d[k] < 0 || d[k] > config.dev.dirMax) || STATS.reduce((a, k) => a + d[k], 0) !== config.dev.dirTotal)
    return `개발 방향은 능력치마다 0~${config.dev.dirMax}점, 합계 ${config.dev.dirTotal}점이어야 합니다.`;
  if (!(s.budget in config.dev.budgets)) return '예산 등급이 올바르지 않습니다.';
  if (!config.dev.designWeeks.includes(s.designWeeks)) return `설계 기간은 ${config.dev.designWeeks.join('주, ')}주 중에서 고르세요.`;
  return null;
}

export const staffOn = (state: CarState, p: Project): Staff[] => state.staff.filter((s) => s.projectId === p.id);

/** 주간 개발비 = 참여 직원 월급 합 ÷ 4 × 비용 배수 + 시제차 비용 */
export const devCostPerWeek = (team: Staff[], budget: Budget): number =>
  (team.reduce((a, s) => a + salaryOf(s.ability), 0) / config.time.weeksPerMonth) * config.dev.budgets[budget].cost + config.dev.prototypePerWeek;
/** 페이스리프트의 주간 비용: 그 세대 개발비 × 25% ÷ (설계 4주 + 최소 시험 2주). 시험을 더 하면 그만큼 더 든다 */
export const faceliftWeekCost = (genDevCost: number): number =>
  (genDevCost * config.lifecycle.facelift.costShare) / (config.lifecycle.facelift.designWeeks + config.dev.minTestWeeks);
/** 풀체인지 비용 배수: 같은 차체 85%, 차체를 바꾸면 100% */
export const fullChangeCostMult = (sameBody: boolean): number => (sameBody ? config.lifecycle.fullChange.sameBodyCost : config.lifecycle.fullChange.newBodyCost);
const genById = (state: CarState, id: number | null) => state.nameplates.flatMap((n) => n.generations).find((g) => g.id === id);
const latestGenOf = (state: CarState, nameplateId: number | null) => state.nameplates.find((n) => n.id === nameplateId)?.generations.at(-1);
export function weeklyDevCost(state: CarState, p: Project): number {
  if (p.kind === 'facelift') return faceliftWeekCost(genById(state, p.targetId)?.devCost ?? 0);
  const base = devCostPerWeek(staffOn(state, p), p.budget);
  return p.kind === 'fullchange' ? base * fullChangeCostMult(latestGenOf(state, p.targetId)?.body === p.body) : base;
}

/** 팀 규모 체감(3단계 설계 결정): n명이면 산출에 (n / 4)^(−k)를 곱한다(4명 이하는 1) */
export const teamSizeMult = (n: number): number => (n <= config.dev.teamBase ? 1 : (n / config.dev.teamBase) ** -config.dev.teamExp);
/** 설계 한 주의 직원별 능력치 점수(팀 순서). rand(): 직원마다 한 번 부르는 난수(0.85~1.15, 자리를 비운 직원도 불러 순서를 지킨다).
 *  컨디션은 단계 배수(9.1), week를 주면 교육·휴식 중인 직원은 0 */
export function designWeekByStaff(team: Staff[], spec: Pick<ProjectSpec, 'budget' | 'direction'>, rand: () => number, week?: number): Stats[] {
  const d = config.dev, size = teamSizeMult(team.length);
  return team.map((s) => {
    const r = rand(), away = week !== undefined && isAway(s, week);
    const out = away ? 0 : (s.ability / d.abilityDiv) * d.budgets[spec.budget].out * conditionMult(s.condition) * r * d.scale * size;
    const split = d.roleSplit[s.role], w = zeroStats();
    for (const k of STATS) w[k] = out * (split[k] ?? 0) * (d.dirBase + spec.direction[k] / d.dirDiv);
    return w;
  });
}
/** 설계 한 주의 능력치별 점수(직원 합) */
export function designWeek(team: Staff[], spec: Pick<ProjectSpec, 'budget' | 'direction'>, rand: () => number): Stats {
  const week = zeroStats();
  for (const w of designWeekByStaff(team, spec, rand)) for (const k of STATS) week[k] += w[k];
  return week;
}
/** 페이스리프트 설계 한 주(8.2): 디자이너만, 점수는 D에만(디자이너 산출의 D 몫, 방향 배수 1) */
export function faceliftWeekByStaff(team: Staff[], spec: Pick<ProjectSpec, 'budget' | 'direction'>, rand: () => number, week?: number): Stats[] {
  const designers = designWeekByStaff(team.filter((s) => s.role === 'designer'), spec, rand, week);
  let i = 0;
  return team.map((s) => { const w = zeroStats(); if (s.role === 'designer') w.D = designers[i++].D; return w; });
}
/** 시험 한 주에 줄어드는 결함 = Σ 테스터 꼼꼼함/10 + Σ 엔지니어 기술/30 (week를 주면 교육·휴식 중인 직원 제외) */
export const testCut = (team: Staff[], week?: number): number =>
  team.filter((s) => week === undefined || !isAway(s, week))
    .reduce((a, s) => a + s.ability / (s.role === 'tester' ? config.dev.testerDiv : s.role === 'engineer' ? config.dev.engineerDiv : Infinity), 0);

/** 한 주 진행 결과: 설계가 끝났는지 + 직원별 점수와 결함 증감(사무실 화면용 주간 기록) */
export interface WeekLog { designDone: boolean; staff: { id: number; stats: Stats }[]; defectsAdded: number; defectsRemoved: number }

/** 한 주 진행(난수 순서: 설계 주는 직원마다 1번, 그다음 결함 추정 1번) */
export function stepProject(state: CarState, p: Project, rng: Rng): WeekLog {
  const d = config.dev, team = staffOn(state, p);
  const log: WeekLog = { designDone: false, staff: team.map((s) => ({ id: s.id, stats: zeroStats() })), defectsAdded: 0, defectsRemoved: 0 };
  if (p.phase === 'design') {
    const rand = () => rng.range(d.randMin, d.randMax);
    const per = p.kind === 'facelift' ? faceliftWeekByStaff(team, p, rand, state.week) : designWeekByStaff(team, p, rand, state.week);
    const week = zeroStats(), speed = 1 + devSpeed(state); // 연구: 개발 속도
    per.forEach((w, i) => { for (const k of STATS) { w[k] *= speed; week[k] += w[k]; } log.staff[i].stats = w; });
    let made = 0;
    for (const k of STATS) { p.points[k] += week[k]; made += week[k]; }
    log.defectsAdded = made * d.defectPerPoint * (p.kind === 'facelift' ? config.lifecycle.facelift.defectRate : 1) * (1 - defectCut(state)); // 연구: 결함 감소
    p.defects += log.defectsAdded;
    p.weeksDone++;
    if (p.weeksDone >= p.designWeeks) { p.phase = 'test'; log.designDone = true; }
  } else {
    const before = p.defects;
    p.defects = Math.max(0, p.defects - testCut(team, state.week));
    log.defectsRemoved = before - p.defects;
    p.testWeeks++;
  }
  const cost = weeklyDevCost(state, p);
  p.spent += cost; state.pendingDev += cost;
  p.defectEst = Math.round(p.defects * (1 + rng.range(-d.estError, d.estError)));
  return log;
}
