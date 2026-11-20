// 개발 프로젝트(설계서 6장): 기획 검증, 주간 점수·결함, 주간 개발비
import { config } from '../config';
import { BODIES, POWERTRAINS, OPTIONS, SEGMENTS } from '../data';
import { salaryOf, zeroStats } from './cars';
import type { Rng } from './rng';
import { yearOf } from './time';
import { STATS, type Budget, type CarState, type Project, type ProjectSpec, type Staff, type Stats } from './types';

/** 기획 검증: 문제가 있으면 한국어 이유, 없으면 null */
export function specError(state: CarState, s: ProjectSpec): string | null {
  const year = yearOf(state.week);
  const body = BODIES.find((b) => b.id === s.body);
  if (!body || body.year > year) return '아직 쓸 수 없는 차체입니다.';
  if (!SEGMENTS.some((x) => x.id === s.segment)) return '없는 고객층입니다.';
  const pt = POWERTRAINS.find((p) => p.id === s.powertrain);
  if (!pt || pt.year > year) return '아직 쓸 수 없는 동력입니다.';
  if (!Number.isInteger(s.tier) || s.tier < 1 || s.tier > pt.tiers.length) return `동력 단계는 1~${pt.tiers.length} 중에서 고르세요.`;
  if (!Array.isArray(s.options)) return '옵션 목록이 올바르지 않습니다.';
  if (s.options.length > config.dev.maxOptions) return `옵션은 최대 ${config.dev.maxOptions}개까지 고를 수 있습니다.`;
  if (new Set(s.options).size !== s.options.length) return '같은 옵션을 두 번 고를 수 없습니다.';
  if (s.options.some((id) => { const o = OPTIONS.find((x) => x.id === id); return !o || o.year > year; })) return '아직 쓸 수 없는 옵션입니다.';
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
export const weeklyDevCost = (state: CarState, p: Project): number => devCostPerWeek(staffOn(state, p), p.budget);

/** 설계 한 주의 능력치별 점수. rand(): 직원마다 한 번 부르는 난수(0.85~1.15) */
export function designWeek(team: Staff[], spec: Pick<ProjectSpec, 'budget' | 'direction'>, rand: () => number): Stats {
  const d = config.dev, week = zeroStats();
  for (const s of team) {
    const out = (s.ability / d.abilityDiv) * d.budgets[spec.budget].out * s.condition * rand() * d.scale;
    const split = d.roleSplit[s.role];
    for (const k of STATS) week[k] += out * (split[k] ?? 0) * (d.dirBase + spec.direction[k] / d.dirDiv);
  }
  return week;
}
/** 시험 한 주에 줄어드는 결함 = Σ 테스터 꼼꼼함/10 + Σ 엔지니어 기술/30 */
export const testCut = (team: Staff[]): number =>
  team.reduce((a, s) => a + s.ability / (s.role === 'tester' ? config.dev.testerDiv : s.role === 'engineer' ? config.dev.engineerDiv : Infinity), 0);

/** 한 주 진행. 설계가 끝난 주면 true */
export function stepProject(state: CarState, p: Project, rng: Rng): boolean {
  const d = config.dev, team = staffOn(state, p);
  let designDone = false;
  if (p.phase === 'design') {
    const week = designWeek(team, p, () => rng.range(d.randMin, d.randMax));
    let made = 0;
    for (const k of STATS) { p.points[k] += week[k]; made += week[k]; }
    p.defects += made * d.defectPerPoint;
    p.weeksDone++;
    if (p.weeksDone >= p.designWeeks) { p.phase = 'test'; designDone = true; }
  } else {
    p.defects = Math.max(0, p.defects - testCut(team));
    p.testWeeks++;
  }
  const cost = weeklyDevCost(state, p);
  p.spent += cost; state.pendingDev += cost;
  p.defectEst = Math.round(p.defects * (1 + rng.range(-d.estError, d.estError)));
  return designDone;
}
