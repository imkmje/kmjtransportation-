import { describe, it, expect } from 'vitest';
import { cityById, typeById, CITIES } from '../src/data';
import { distanceKm, baseFare, canFly, maxWeeklyRoundTrips, roundTripHours, rawMonthlyDemand, priceFactor, seasonOf } from '../src/sim/model';

describe('지리·기본 모델', () => {
  it('대권거리: 서울(인천)-도쿄(나리타) 약 1,250km, 서울-뉴욕 약 11,000km, 서울-제주 약 450km (±5%)', () => {
    const d = (a: string, b: string) => distanceKm(cityById(a), cityById(b));
    expect(d('ICN', 'NRT')).toBeGreaterThan(1150); expect(d('ICN', 'NRT')).toBeLessThan(1320);
    expect(d('ICN', 'JFK')).toBeGreaterThan(10700); expect(d('ICN', 'JFK')).toBeLessThan(11300);
    expect(d('ICN', 'CJU')).toBeGreaterThan(420); expect(d('ICN', 'CJU')).toBeLessThan(480);
    expect(d('ICN', 'ICN')).toBe(0);
  });
  it('데이터: 도시 34개, 중복 없음, 활주로·인구가 양수', () => {
    expect(CITIES.length).toBe(34);
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(34);
    for (const c of CITIES) { expect(c.runway).toBeGreaterThan(1000); expect(c.pop * c.income).toBeGreaterThan(0); }
  });
  it('기준 운임은 거리에 비례해 늘고, 운임이 기준이면 수요 계수 1, 두 배면 크게 준다', () => {
    expect(baseFare(1000)).toBeGreaterThan(baseFare(500));
    expect(priceFactor(100, 100)).toBeCloseTo(1, 9);
    expect(priceFactor(200, 100)).toBeLessThan(0.2);
    expect(priceFactor(50, 100)).toBeGreaterThan(1);
  });
  it('수요: 거리가 멀수록 줄고, 성수기가 비수기보다 많다', () => {
    const A = cityById('ICN');
    expect(rawMonthlyDemand(A, cityById('CJU'), 1)).toBeGreaterThan(rawMonthlyDemand(A, cityById('JFK'), 1));
    const B = cityById('BKK'); // 11~2월 성수기
    expect(seasonOf(B, 12)).toBeGreaterThan(seasonOf(B, 6));
    expect(rawMonthlyDemand(A, B, 12)).toBeGreaterThan(rawMonthlyDemand(A, B, 6));
  });
  it('운항 가능 조건: 항속거리·활주로', () => {
    const a220 = typeById('A220'), b737 = typeById('B737'), a350 = typeById('A350');
    expect(canFly(b737, cityById('ICN'), cityById('JFK'))).toEqual({ ok: false, reason: 'range' }); // 약 11,000km > 6,000km
    expect(canFly(a350, cityById('ICN'), cityById('JFK')).ok).toBe(true);
    expect(canFly(a220, cityById('ICN'), cityById('CJU')).ok).toBe(true);
    const short = { ...cityById('CJU'), runway: 2500 }; // 활주로가 짧은 가상 공항
    expect(canFly(a350, cityById('ICN'), short)).toEqual({ ok: false, reason: 'runway' });
    expect(canFly(b737, cityById('ICN'), short).ok).toBe(true);
  });
  it('주간 왕복 한도: 단거리는 많고 초장거리는 적으며, 하루 가용 시간 안에서만', () => {
    const t = typeById('B737');
    expect(maxWeeklyRoundTrips(450, t)).toBeGreaterThan(maxWeeklyRoundTrips(5000, t));
    expect(maxWeeklyRoundTrips(450, t) * roundTripHours(450, t)).toBeLessThanOrEqual(14 * 7 + 1e-9);
  });
});
