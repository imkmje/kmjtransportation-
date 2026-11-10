import { config } from '../config';
import { cityById } from '../data';
import { haversineKm } from './geo';
import type { AircraftType, City } from './types';

export const distanceKm = (a: City, b: City): number => haversineKm(a.lat, a.lon, b.lat, b.lon);
/** 기준 운임($): 거리에 비례 */
export const baseFare = (km: number): number => config.fare.base + config.fare.perKm * km;
/** 시장 규모: 인구 × 소득 계수 */
export const marketSize = (c: City): number => c.pop * c.income;
/** 계절 계수: 성수기 달이면 peak.factor, 아니면 1 (월은 1~12) */
export const seasonOf = (c: City, month: number): number => (c.peak.months.includes(month) ? c.peak.factor : 1);

/** 운임 비율에 따른 수요 계수(기준 운임이면 1, 비싸면 지수적으로 감소) */
export const priceFactor = (fare: number, base: number): number => Math.exp(-(fare / base - 1) * config.demand.elasticity);

/** 도시 쌍 한 달 수요(양방향 합계). 운임·평판·사건 보정 전에 계절까지만 반영한 "기본 수요" */
export function rawMonthlyDemand(a: City, b: City, month: number): number {
  const d = config.demand, km = distanceKm(a, b);
  const season = (seasonOf(a, month) + seasonOf(b, month)) / 2;
  return (d.K * marketSize(a) * marketSize(b)) / Math.pow(km / 1000 + d.distOffset, d.distExp) * season;
}

/** 왕복 한 번 걸리는 시간(h): 비행 + 이착륙 + 회전(양 끝) */
export function roundTripHours(km: number, t: AircraftType): number {
  const f = config.flight;
  return 2 * (km / t.speed + f.taxiH) + 2 * f.turnaroundH;
}
/** 항공기 1대의 주간 최대 왕복 횟수(하루 가용 시간 기준) */
export const maxWeeklyRoundTrips = (km: number, t: AircraftType): number => Math.floor((f().dailyHours * 7) / roundTripHours(km, t));
const f = () => config.flight;

/** 편도 1편의 블록 시간(h) */
export const blockHours = (km: number, t: AircraftType): number => km / t.speed + config.flight.taxiH;

/** 이 기종이 이 두 도시 사이를 날 수 있는가(항속·두 공항 활주로). 안 되면 이유 */
export function canFly(t: AircraftType, a: City, b: City): { ok: true } | { ok: false; reason: 'range' | 'runway' } {
  if (distanceKm(a, b) > t.range) return { ok: false, reason: 'range' };
  if (a.runway < t.runway || b.runway < t.runway) return { ok: false, reason: 'runway' };
  return { ok: true };
}

export const cityOf = (id: string): City => cityById(id);
