import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { routeMonthStats, bestWorst, subsolar, isNight, terminatorLat } from '../src/sim/report';

describe('월간 보고서', () => {
  it('노선별 최근 30일 요약과 최고·최저 노선', () => {
    const g = new Game(1); g.state.cash = 400;
    const o1 = g.openRoute('ICN', 'CJU'); if (!o1.ok) throw new Error(); g.assign(g.state.planes[0].id, o1.routeId, 20);
    const b = g.buyPlane('B737'); if (!b.ok) throw new Error();
    const o2 = g.openRoute('ICN', 'PUS'); if (!o2.ok) throw new Error(); g.assign(b.planeId, o2.routeId, 14);
    g.advanceDays(20);
    const st = routeMonthStats(g);
    expect(st.length).toBe(2); expect(st.every((s) => s.days === 20 && s.pax > 0 && s.otp > 0 && s.loadFactor > 0)).toBe(true);
    const { best, worst } = bestWorst(st);
    expect(best!.profit).toBeGreaterThanOrEqual(worst!.profit);
    expect(bestWorst([])).toEqual({ best: null, worst: null });
    expect(bestWorst([st[0]]).best).toBe(bestWorst([st[0]]).worst);
  });
});

describe('세계 낮밤 음영선(장식)', () => {
  it('해가 있는 바로 그 지점은 낮이고 정반대 지점은 밤이다', () => {
    const sun = subsolar(10);
    expect(isNight(sun.lat, sun.lon, sun)).toBe(false);
    const anti = { lat: -sun.lat, lon: sun.lon > 0 ? sun.lon - 180 : sun.lon + 180 };
    expect(isNight(anti.lat, anti.lon, sun)).toBe(true);
  });
  it('태양 위도는 ±23.5도 안, 경도는 시간이 갈수록 서쪽으로 움직인다', () => {
    for (let d = 0; d < 360; d += 7) expect(Math.abs(subsolar(d).lat)).toBeLessThanOrEqual(23.5);
    const a = subsolar(1), b = subsolar(2);
    const diff = ((a.lon - b.lon) % 360 + 360) % 360; expect(diff).toBeCloseTo(30, 6);
  });
  it('경계선(terminatorLat) 위에서는 태양 고도가 0에 가깝다', () => {
    const sun = subsolar(40);
    for (const lon of [-150, -60, 0, 45, 120]) { const lat = terminatorLat(lon, sun); const e = 0.3; expect(isNight(lat - e, lon, sun) !== isNight(lat + e, lon, sun)).toBe(true); }
  });
});
