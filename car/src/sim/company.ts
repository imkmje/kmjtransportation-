// 회사(설계서 9.1 직원, 9.2 본사, 9.3 공장): 등급 표 조회와 직원 상태 판정. 순수 함수(상태를 바꾸지 않는다)
import { config } from '../config';
import { eventCostMult, productionMult } from './events';
import { costCut, upkeepCut } from './research';
import { diffOf } from './difficulty';
import type { CarState, Role, Staff } from './types';

const C = config.staff;
export const hqDef = (s: CarState) => config.hq.levels[s.hqLevel - 1];
export const factoryDef = (s: CarState) => config.factory.levels[s.factory.level - 1];
/** 직원 정원 = 본사 등급의 정원 − 임원 수(0.7.0: 임원도 정원 안에서 자리를 차지한다) */
export const staffCap = (s: CarState): number => hqDef(s).staff - Object.keys(s.execs?.seats ?? {}).length;
/** 동시 개발팀 수(6.4) */
export const devTeams = (s: CarState): number => hqDef(s).teams;
/** 옵션 슬롯(5.4) */
export const optionSlots = (s: CarState): number => hqDef(s).options;
/** 월 생산 한도 = 공장 등급 × 사건 배수(감염병·파업, 11장) */
export const capacityOf = (s: CarState): number => factoryDef(s).capacity * productionMult(s);
export const linesOf = (s: CarState): number => factoryDef(s).lines;
/** 원가 배수 = 공장 등급 × (1 − 연구 원가 인하) × 사건(원자재·환율) */
export const costMultOf = (s: CarState): number => factoryDef(s).costMult * (1 - costCut(s)) * eventCostMult(s);
/** 월 유지비 = (공장 × (1 − 연구 유지비 인하) + 본사) × 난이도 배수 */
export const upkeepOf = (s: CarState): number => factoryUpkeep(s, s.factory.level) + hqUpkeep(s, s.hqLevel);
/** 0.5.1: 등급별 실제 월 유지비(난이도 배수, 공장은 연구 감면 반영). 화면 등급표·승급 미리보기·장부가 같은 값을 쓴다 */
export const factoryUpkeep = (s: CarState, level: number): number => config.factory.levels[level - 1].upkeep * (1 - upkeepCut(s)) * diffOf(s).upkeepMult;
export const hqUpkeep = (s: CarState, level: number): number => config.hq.levels[level - 1].upkeep * diffOf(s).upkeepMult;

/** 9.3 생산 배분: 수동 몫(share)이 있는 차는 한도 × 몫까지, 나머지 한도는 자동(null) 차들에 수요 비례. 차마다 만드는 대수(반올림). 월 결산과 임원 배분 제안이 같이 쓴다 */
export function allocate(cap: number, demand: number[], shares: (number | null)[]): number[] {
  const manual = shares.reduce<number>((a, x) => a + (x ?? 0), 0), autoCap = Math.max(0, cap * (1 - manual));
  const autoTotal = demand.reduce((a, d, i) => a + (shares[i] === null ? d : 0), 0), fill = autoTotal > autoCap ? autoCap / autoTotal : 1;
  return demand.map((d, i) => Math.round(shares[i] === null ? d * fill : Math.min(d, cap * shares[i]!)));
}

export const isDevRole = (r: Role): boolean => r !== 'sales';
/** 교육 중(교육을 시작한 주부터 4주) */
export const isTraining = (x: Staff, week: number): boolean => x.trainings.length > 0 && week < x.trainings[x.trainings.length - 1] + C.train.weeks;
export const isResting = (x: Staff, week: number): boolean => x.restUntil !== null && week < x.restUntil;
/** 교육·휴식 때문에 자리를 비움(프로젝트 산출 0) */
export const isAway = (x: Staff, week: number): boolean => isTraining(x, week) || isResting(x, week);
/** 올해 교육 횟수(연 2회 제한) */
export const trainingsThisYear = (x: Staff, week: number): number => {
  const wpy = config.time.weeksPerMonth * config.time.monthsPerYear, y = Math.floor(week / wpy);
  return x.trainings.filter((w) => Math.floor(w / wpy) === y).length;
};
/** 교육비 = 능력 × 20만원(최소 300만) */
export const trainCost = (ability: number): number => Math.max(C.train.min, ability * C.train.perAbility);
/** 컨디션에 따른 산출 배수: 0.3 미만 ×0.6, 0.3~0.6 ×0.85, 그 이상 ×1 */
export const conditionMult = (c: number): number => (c < C.condition.low ? C.condition.lowMult : c < C.condition.mid ? C.condition.midMult : 1);
/** 퇴직금 = 월급 × 2 */
export const severanceOf = (salary: number): number => salary * C.severanceMonths;

/** 교육 가능 여부와 이유 */
export function trainError(s: CarState, x: Staff): string | null {
  if (isTraining(x, s.week)) return '이미 교육 중입니다.';
  if (isResting(x, s.week)) return '휴식 중에는 교육할 수 없습니다.';
  if (x.ability >= x.potential) return '잠재력에 도달해 더 배울 수 없습니다.';
  if (trainingsThisYear(x, s.week) >= C.train.perYear) return `올해 교육을 이미 ${C.train.perYear}번 받았습니다.`;
  if (s.cash < trainCost(x.ability)) return '현금이 모자랍니다.';
  return null;
}

/** 영업 직원 능력 합(자리를 비운 직원 제외) */
export const salesPower = (s: CarState): number =>
  s.staff.filter((x) => x.role === 'sales' && !isAway(x, s.week)).reduce((a, x) => a + x.ability, 0);
/** 영업 효과: 인지도 수렴 속도 가산(최대 +0.15) */
export const salesAwarenessBonus = (s: CarState): number => Math.min(C.sales.awarenessMax, salesPower(s) / C.sales.awarenessDiv);
/** 영업 효과: 법인·택시 고객층 매력 배수(최대 1.3) */
export const salesFleetMult = (s: CarState): number => Math.min(C.sales.fleetMax, 1 + salesPower(s) / C.sales.fleetDiv);

/** 본사 승급 조건: 다음 등급, 비용·평판, 이유 */
export function hqUpgradeError(s: CarState): string | null {
  const next = config.hq.levels[s.hqLevel];
  if (!next) return '본사가 최고 등급입니다.';
  if (s.reputation < next.rep) return `평판 ${next.rep} 이상이어야 합니다(지금 ${Math.floor(s.reputation)}).`;
  if (s.cash < next.cost) return '현금이 모자랍니다.';
  return null;
}
/** 공장 증설 조건 */
export function factoryExpandError(s: CarState): string | null {
  if (s.factory.build) return '공장 증설 공사 중에는 추가 증설을 할 수 없습니다.';
  const next = config.factory.levels[s.factory.level];
  if (!next) return '공장이 최고 등급입니다.';
  if (s.cash < next.cost) return '현금이 모자랍니다.';
  return null;
}
