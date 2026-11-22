// 1.2.0 전기차 시대: 배터리 용량·주행 거리·충전 속도·전용 플랫폼·배터리 자체 생산. 순수 함수
import { config } from '../config';
import { bodyById, powertrainById } from '../data';
import { bodyClass } from './equip';
import { batteryPlantCut, batteryPlantError, batteryPlantUpkeep, costMultOf, eraCostAdd } from './company';
import { chargeStep, platformReady, ptCostAdd } from './research';
import { interp } from './market';
import { monthOf, yearOf } from './time';
import type { Battery, CarState, Generation, Project, ProjectSpec } from './types';

const V = () => config.ev;
export const EV = config.events.charging.powertrain;
export const BATTERIES: Battery[] = ['small', 'std', 'large'];
const BATTERY_INFO: Record<Battery, string> = {
  small: '용량이 작은 배터리 팩. 원가와 무게가 줄지만 주행 거리가 짧다. 주로 도심에서 타는 소형차는 손님이 덜 아쉬워한다.',
  std: '차급에 맞춘 보통 용량의 배터리 팩. 지금까지와 같은 원가와 주행 거리다.',
  large: '셀을 더 많이 넣은 큰 배터리 팩. 원가가 오르고 충전에 시간이 더 걸리지만 주행 거리가 길다. 주행 거리를 따지는 큰 차에서 값을 더 받는다.',
};

/** 주행 거리(km, 표시용 반올림): 표준 배터리 단계표 × 배터리 용량 × 전용 플랫폼 */
export function rangeKm(level: number, battery: Battery = 'std', platform = false): number {
  const R = V().range, last = R.levels[R.levels.length - 1];
  const base = level <= last ? interp(R.levels, R.km, level) : R.km[R.km.length - 1] + (level - last) * R.perLevel;
  return Math.round(base * V().battery[battery].range * (platform ? 1 + V().platform.range : 1));
}
/** 그 해 그 차급의 기대 주행 거리(km). year: 소수 연도 가능, 표 밖은 끝값 */
export const expectedRange = (body: string, year: number): number => Math.round(interp(V().expect.years, V().expect.km, year) * V().expect.class[bodyClass(body)]);
/** 주행 거리 매력 배수: 같은 단계 표준 배터리(플랫폼 없음)를 1로 본 상대값. 기대에 못 미칠수록 짧은 배터리가 크게 깎이고, 기대를 넘는 거리는 조금만 더 쳐 준다 */
export function rangeMult(body: string, level: number, battery: Battery = 'std', platform = false, year: number): number {
  const A = V().appeal, exp = expectedRange(body, year);
  const f = (km: number) => { const u = km / exp; return u < 1 ? u ** A.low : 1 + A.high * Math.min(u - 1, A.cap); };
  return Math.min(A.max, Math.max(A.min, f(rangeKm(level, battery, platform)) / f(rangeKm(level))));
}
const at = <T>(xs: T[], i: number): T => xs[Math.min(i, xs.length - 1)];
/** 10→80% 충전 시간(분): 회사의 충전 연구 단계 × 배터리 용량 */
export const chargeMinutes = (s: CarState, battery: Battery = 'std'): number => Math.round(at(V().charge.minutes, chargeStep(s)) * V().battery[battery].charge);
/** 충전 속도 매력 배수(회사 단위, 판매 중인 전기차 모두) */
export const chargeMult = (s: CarState): number => 1 + at(V().charge.appeal, chargeStep(s));
/** 전기차 수요 배수 = 주행 거리 × 충전 속도. level이 없으면(어림) 주행 거리는 1 */
export const evDemandMult = (s: CarState, car: { body: string; level?: number; battery?: Battery; evPlatform?: boolean }, year: number): number =>
  (car.level === undefined ? 1 : rangeMult(car.body, car.level, car.battery, !!car.evPlatform, year)) * chargeMult(s);

/** 이 프로젝트로 낼 차가 전용 플랫폼인가: 페이스리프트는 그 세대 그대로, 새 세대는 지금 연구가 끝나 있으면 */
export function projectPlatform(s: CarState, p: Pick<Project, 'powertrain'> & Partial<Pick<Project, 'kind' | 'targetId'>>): boolean {
  if (p.powertrain !== EV) return false;
  if (p.kind === 'facelift') return !!s.nameplates.flatMap((n) => n.generations).find((g) => g.id === p.targetId)?.evPlatform;
  return platformReady(s);
}
/** 전용 플랫폼의 실용 능력치 배수 */
export const platformUMult = (on: boolean): number => (on ? 1 + V().platform.u : 1);
/** 배터리 용량이 시장 기준가에 더하는 값(표준 0): 원가 차이 × 차급별 값 배수 × 시대 원가 상승 */
export function batteryValue(s: CarState, body: string, battery: Battery | undefined): number {
  if (!battery || battery === 'std') return 0;
  const B = V().battery[battery], y = s.week / config.time.weeksPerMonth / config.time.monthsPerYear + config.time.startYear;
  return bodyById(body).cost * ptCostAdd(s, EV) * (B.cost - 1) * B.value[bodyClass(body)] * (1 + eraCostAdd(y));
}

// ---------- 조회(화면용) ----------
export interface EvCarInfo { rangeKm: number; expectedKm: number; short: boolean; chargeMinutes: number; rangeMult: number; chargeMult: number; demandMult: number; battery: Battery; batteryName: string; platform: boolean }
/** 전기차 한 대의 주행 거리·기대·충전 시간·매력 배수. year를 빼면 지금 해 */
export function evCarInfo(s: CarState, car: { body: string; level: number; battery?: Battery; evPlatform?: boolean }, year = yearOf(s.week)): EvCarInfo {
  const b = car.battery ?? 'std', p = !!car.evPlatform, km = rangeKm(car.level, b, p), exp = expectedRange(car.body, year), rm = rangeMult(car.body, car.level, b, p, year), cm = chargeMult(s);
  return { rangeKm: km, expectedKm: exp, short: km < exp, chargeMinutes: chargeMinutes(s, b), rangeMult: rm, chargeMult: cm, demandMult: rm * cm, battery: b, batteryName: V().battery[b].name, platform: p };
}
/** 판매 중(또는 지난) 세대의 전기차 정보(지금 판 기준). 전기차가 아니면 null */
export function genEvInfo(s: CarState, generationId: number): EvCarInfo | null {
  const g: Generation | undefined = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === generationId);
  if (!g || g.powertrain !== EV) return null;
  const ed = g.editions[g.editions.length - 1];
  return evCarInfo(s, { body: g.body, level: ed.level, battery: ed.battery, evPlatform: g.evPlatform });
}
export interface BatteryChoice { id: Battery; name: string; info: string; rangeKm: number; expectedKm: number; chargeMinutes: number; costDelta: number; priceDelta: number; appeal: number }
/** 기획 화면의 배터리 선택지: 주행 거리, 기대, 충전 시간, 대당 원가 차이·시장 기준가 차이(표준 대비, 만원), 매력 배수(표준 = 1, 같은 플랫폼).
 *  level: 실제 동력 단계(levelForTier), platform을 빼면 지금 연구 기준. year를 빼면 지금 해.
 *  tier: 동력 등급(주면 등급 원가 가산까지 넣어 unitCost 차이와 같아진다. 빼면 예전 값, 봇이 쓴다) */
export function batteryChoices(s: CarState, spec: Pick<ProjectSpec, 'body'> & { level: number; platform?: boolean; tier?: number }, year = yearOf(s.week)): BatteryChoice[] {
  const tm = spec.tier ? 1 + (powertrainById(EV).tiers[spec.tier - 1]?.costAdd ?? 0) : 1;
  const p = spec.platform ?? platformReady(s), exp = expectedRange(spec.body, year), cm = (b: Battery) => bodyById(spec.body).cost * ptCostAdd(s, EV, b, p) * tm * costMultEv(s);
  const base = rangeMult(spec.body, spec.level, 'std', p, year);
  return BATTERIES.map((b) => ({
    id: b, name: V().battery[b].name, info: BATTERY_INFO[b], rangeKm: rangeKm(spec.level, b, p), expectedKm: exp, chargeMinutes: chargeMinutes(s, b),
    costDelta: cm(b) - cm('std'), priceDelta: batteryValue(s, spec.body, b), appeal: rangeMult(spec.body, spec.level, b, p, year) / base,
  }));
}
const costMultEv = (s: CarState) => costMultOf(s, EV);

/** 충전 속도(회사 단위): 연구 단계, 10→80% 충전 분(표준 배터리), 매력 배수, 다음 단계의 분(없으면 null) */
export function chargeInfo(s: CarState): { step: number; minutes: number; mult: number; nextMinutes: number | null } {
  const step = chargeStep(s), m = V().charge.minutes;
  return { step, minutes: chargeMinutes(s), mult: chargeMult(s), nextMinutes: step + 1 < m.length ? m[step + 1] : null };
}

/** 배터리 공장 등급 한 줄: 건설비, 실제 월 유지비, 대당 원가 절감, 공사 개월 */
const plantLevelInfo = (s: CarState, level: number) => { const L = V().plant.levels[level - 1]; return { level, cost: L.cost, upkeep: batteryPlantUpkeep(s, level), cut: L.cut, buildMonths: L.buildMonths }; };
export type BatteryPlantLevel = ReturnType<typeof plantLevelInfo>;
/** 배터리 자체 생산 화면: 등급표, 지금(0 = 없음)·다음 등급, 공사, 지을 수 있는지, 지난달 전기차 판매와 절감액·유지비(어림) */
export function batteryPlantInfo(s: CarState) {
  const b = s.batteryPlant, reason = batteryPlantError(s), last = s.ledger.at(-1);
  const gens = new Map(s.nameplates.flatMap((n) => n.generations).map((g) => [g.id, g]));
  let evSold = 0, evCogs = 0;
  for (const c of last?.cars ?? []) if (gens.get(c.id)?.powertrain === EV) { evSold += c.sold; evCogs += c.cogs; }
  const cut = batteryPlantCut(s);
  return {
    levels: V().plant.levels.map((_, i) => plantLevelInfo(s, i + 1)), level: b.level, current: b.level ? plantLevelInfo(s, b.level) : null, next: V().plant.levels[b.level] ? plantLevelInfo(s, b.level + 1) : null,
    canBuild: reason === null, reason, building: b.build ? { level: b.build.level, monthsLeft: b.build.doneMonth - monthOf(s.week) } : null,
    upkeep: batteryPlantUpkeep(s, b.level), lastMonth: { evSold, saving: cut > 0 ? (evCogs * cut) / (1 - cut) : 0 }, // saving: 지난달 전기차 원가 중 절감된 몫(선택 사양 원가 포함한 어림)
  };
}
