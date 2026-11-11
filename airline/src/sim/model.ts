import { config } from '../config';
import { cityById } from '../data';
import { haversineKm } from './geo';
import type { AircraftType, City } from './types';

export const distanceKm = (a: City, b: City): number => haversineKm(a.lat, a.lon, b.lat, b.lon);
/** 기준 운임($): 거리에 비례 */
export const baseFare = (km: number): number => config.fare.base + config.fare.perKm * km;
/** 시장 규모: 인구 × 소득 계수 × 성장 배수 */
export const marketSize = (c: City, growth = 1): number => c.pop * c.income * growth;
/** 계절 계수(월은 1~12): 성수기 달은 peak.factor, 앞뒤 한 달은 절반, 그보다 먼 달은 조금 낮다. 모든 도시에 공통 월별 계수(방학·휴가철)도 곱한다 */
export const seasonOf = (c: City, month: number): number => {
  let w = 0;
  for (const m of c.peak.months) { const gap = Math.abs(month - m), dist = Math.min(gap, 12 - gap); w = Math.max(w, dist === 0 ? 1 : dist === 1 ? 0.5 : 0); }
  return (1 + (c.peak.factor - 1) * w - (w === 0 ? config.demand.offSeason : 0)) * config.demand.holiday[(month - 1 + 12) % 12];
};

/** 운임 비율에 따른 수요 계수(기준 운임이면 1, 비싸면 지수적으로 감소) */
export const priceFactor = (fare: number, base: number, elasticity = config.demand.elasticity): number => Math.exp(-(fare / base - 1) * elasticity);

/** 도시 쌍 한 달 수요(양방향 합계, 일반석 기준). 운임·평판·사건 보정 전에 계절·성장까지만 반영한 "기본 수요" */
export function rawMonthlyDemand(a: City, b: City, month: number, gA = 1, gB = 1): number {
  const d = config.demand, km = distanceKm(a, b);
  const season = (seasonOf(a, month) + seasonOf(b, month)) / 2;
  return (d.K * marketSize(a, gA) * marketSize(b, gB)) / Math.pow(km / 1000 + d.distOffset, d.distExp) * season;
}

/** 비즈니스 승객 비율: 소득이 높고 거리가 멀수록 크다(4~30%) */
export function bizDemandShare(a: City, b: City): number {
  const km = distanceKm(a, b), inc = (a.income + b.income) / 2;
  return Math.min(0.3, Math.max(0.04, 0.05 + 0.08 * (inc - 1) + 0.12 * Math.min(1, km / 9000)));
}
/** 화물 수요(톤/월): 두 도시 규모의 기하평균 ÷ 거리 */
export function rawCargoDemand(a: City, b: City, gA = 1, gB = 1): number {
  const c = config.cargo, km = distanceKm(a, b);
  return (c.K * Math.sqrt(marketSize(a, gA) * marketSize(b, gB))) / Math.pow(km / 1000 + config.demand.distOffset, c.distExp);
}
export const cargoRate = (km: number): number => config.cargo.base + config.cargo.perKm * km; // $/톤

/** 왕복 한 번 걸리는 시간(h): 비행 + 이착륙 + 회전(양 끝) */
export function roundTripHours(km: number, t: AircraftType): number {
  const f = config.flight;
  return 2 * (km / t.speed + f.taxiH) + 2 * f.turnaroundH;
}
/** 항공기 1대의 주간 최대 왕복 횟수(하루 가용 시간 기준) */
export const maxWeeklyRoundTrips = (km: number, t: AircraftType): number => Math.floor((config.flight.dailyHours * 7) / roundTripHours(km, t));

/** 편도 1편의 블록 시간(h) */
export const blockHours = (km: number, t: AircraftType): number => km / t.speed + config.flight.taxiH;

/** 이 기종이 이 두 도시 사이를 날 수 있는가(항속·두 공항 활주로). 안 되면 이유 */
export function canFly(t: AircraftType, a: City, b: City): { ok: true } | { ok: false; reason: 'range' | 'runway' } {
  if (distanceKm(a, b) > t.range) return { ok: false, reason: 'range' };
  if (a.runway < t.runway || b.runway < t.runway) return { ok: false, reason: 'runway' };
  return { ok: true };
}

/** 공항 하루 이착륙 한도(추가 구매분 제외) */
export const baseSlots = (c: City): number => Math.round(config.slot.base + config.slot.perSize * marketSize(c));

export const cityOf = (id: string): City => cityById(id);
