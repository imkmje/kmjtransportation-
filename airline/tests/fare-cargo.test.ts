import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { distanceKm, maxWeeklyRoundTrips } from '../src/sim/model';
import { assignWithSlots } from '../src/sim/strategies';
import { cityById, typeById } from '../src/data';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 9999; return g; };
const route = (g: Game, t: string, a = 'ICN', b = 'NRT') => { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); const p = g.buyPlane(t); if (!p.ok) throw new Error(p.error); if (!assignWithSlots(g, p.planeId, o.routeId, maxWeeklyRoundTrips(distanceKm(cityById(a), cityById(b)), typeById(t)))) throw new Error('배정'); return g.route(o.routeId)!; };

describe('최적 운임에 화물 포함(3.17.0)', () => {
  it('운임 맞추기를 누르면 화물 운임 배율도 수요=적재량이 되는 값으로 맞춰진다', () => {
    const g = sb(), r = route(g, 'A330N', 'ICN', 'LAX'); g.advanceDays(1); r.cargoRatio = 1; const d0 = g.routeDay(r); expect(d0.cargoCap).toBeGreaterThan(0);
    g.fillFare(r.id); const d = g.routeDay(r), lo = config.fare.minRatio, hi = config.fare.maxRatio;
    expect(r.cargoRatio).not.toBe(1); expect(r.cargoRatio).toBeGreaterThanOrEqual(lo); expect(r.cargoRatio).toBeLessThanOrEqual(hi);
    if (r.cargoRatio > lo + 0.02 && r.cargoRatio < hi - 0.02) expect(Math.abs(d.cargoDemand / d.cargoCap - 1)).toBeLessThan(0.05); // 범위 안이면 수요 = 적재량
  });
  it('엉뚱한 배율에서 시작해도 같은 값으로 돌아온다(과거 값에 의존하지 않음)', () => {
    const g = sb(), r = route(g, 'A330N', 'ICN', 'LAX'); g.advanceDays(1); r.cargoRatio = 0.6; g.fillFare(r.id); const a = r.cargoRatio; r.cargoRatio = 1.9; g.fillFare(r.id); expect(r.cargoRatio).toBe(a);
  });
  it('자동 운임을 켜면 매주 화물 배율도 맞춘다', () => {
    const g = sb(), r = route(g, 'A330N', 'ICN', 'LAX'); g.setAutoFare(true); g.advanceDays(1); r.cargoRatio = 1.9; g.advanceDays(8); expect(r.cargoRatio).not.toBe(1.9);
  });
  it('점유율 우선 노선도 화물은 맞춘다', () => {
    const g = sb(), r = route(g, 'A330N', 'ICN', 'LAX'); g.advanceDays(1); r.stance = 'share'; r.cargoRatio = 1.9; g.fillFare(r.id); expect(r.cargoRatio).not.toBe(1.9);
  });
  it('화물기(좌석 없음)만 있는 노선도 화물 배율을 맞춘다', () => {
    const g = sb(), r = route(g, 'F77', 'ICN', 'HKG'); g.advanceDays(1); r.cargoRatio = 1; g.fillFare(r.id); const d = g.routeDay(r); expect(d.seatsE).toBe(0); expect(d.cargoCap).toBeGreaterThan(0); expect(r.cargoRatio).not.toBe(1);
  });
});
