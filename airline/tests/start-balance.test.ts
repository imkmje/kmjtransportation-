import { describe, it, expect } from 'vitest';
import { CITIES, cityById, typeById } from '../src/data';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { distanceKm, maxWeeklyRoundTrips } from '../src/sim/model';
import { assignWithSlots } from '../src/sim/strategies';

const K = () => config.rights.startSupport;
const fresh = (base: string, o: { rights?: boolean; challenges?: string[] } = {}) => new Game(1, undefined, { base, sandbox: true, rights: o.rights ?? true, challenges: o.challenges });
/** 시작 기체를 추천 노선 상위 n곳에 투입해 12개월 돌린 누적 이익 중 최선(시작 균형 측정과 같은 방식) */
const opening = (base: string, n = 3) => {
  let best = -1e9;
  for (const r of fresh(base).recommendRoutes(n)) {
    const g = fresh(base), p = g.state.planes[0], o = g.openRoute(r.a, r.b); if (!o.ok) continue;
    const km = distanceKm(cityById(r.a), cityById(r.b)); if (!assignWithSlots(g, p.id, o.routeId, maxWeeklyRoundTrips(km, typeById(p.type)))) continue; g.fillFare(o.routeId);
    while (g.state.status === 'playing' && g.monthsPassed < 12) { g.advanceDay(); if (g.state.day % 30 === 0) for (const q of g.state.planes) if (q.cond < 0.55 && q.shop <= 0 && g.state.cash > g.serviceCost(q) + 3) g.service(q.id); }
    best = Math.max(best, g.state.cumProfit);
  }
  return best;
};

describe('지역별 시작 균형(3.16.0)', () => {
  it('설정이 말이 된다: 지원 도시는 실제 도시, 금액은 상한 이하, 시작 기체는 실제 기종', () => {
    for (const [id, v] of Object.entries(K().table)) { expect(CITIES.some((c) => c.id === id)).toBe(true); expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(K().cap); }
    for (const [reg, t] of Object.entries(config.rights.startPlane)) { expect(CITIES.some((c) => c.region === reg)).toBe(true); expect(typeById(t).seats).toBeGreaterThan(0); }
  });
  it('개척 지원금: 시장이 작은 출발 도시만, 지역 운수권을 켠 자유 모드만, 도전 조건이 없을 때만 받는다', () => {
    const g = fresh('SYD'); expect(g.state.support?.monthly).toBe(K().table.SYD); expect(g.state.log.some((l) => l.includes('개척 지원금'))).toBe(true);
    expect(fresh('ICN').state.support).toBeUndefined(); expect(fresh('SYD', { rights: false }).state.support).toBeUndefined(); expect(fresh('SYD', { challenges: ['debt'] }).state.support).toBeUndefined(); expect(new Game(1).state.support).toBeUndefined();
  });
  it('지원금 곡선: 처음 12개월 그대로, 이후 12개월에 걸쳐 0으로', () => {
    const g = fresh('SYD'), s = K().table.SYD, k = K(); expect(g.supportNow(1)).toBe(s); expect(g.supportNow(k.hold - 1)).toBe(s); expect(g.supportNow(k.hold)).toBe(s);
    expect(g.supportNow(k.hold + k.fade / 2)).toBeCloseTo(s / 2, 2); expect(g.supportNow(k.hold + k.fade)).toBe(0); expect(g.supportNow(60)).toBe(0); expect(fresh('ICN').supportNow(3)).toBe(0);
  });
  it('매달 현금과 수익에 들어오고, 끝나는 달 알림이 남는다', () => {
    const g = fresh('MEL'), s = K().table.MEL; g.advanceDays(31); const t1 = g.state.support!.total!; expect(t1).toBeCloseTo(s, 2);
    const c0 = g.state.cash, r0 = g.state.cur.revenue; (g as unknown as { supportStep: (m: number) => void }).supportStep(2); expect(g.state.cash - c0).toBeCloseTo(s, 2); expect(g.state.cur.revenue - r0).toBeCloseTo(s, 2);
    g.state.support!.total = 0; for (let m = 1; m <= K().hold + K().fade + 1; m++) (g as unknown as { supportStep: (m: number) => void }).supportStep(m);
    expect(g.state.log.some((l) => l.includes('개척 지원금이 끝났습니다'))).toBe(true); expect(g.state.support!.total).toBeGreaterThan(0);
  });
  it('첫 12개월 시작 이익이 지역 상관없이 비슷한 범위에 든다(시드니·요하네스버그·두바이도 흑자, 서울·싱가포르도 너무 쉽지 않게)', () => {
    const bases = ['SYD', 'AKL', 'JNB', 'NBO', 'DXB', 'FRA', 'GRU', 'ICN', 'SIN', 'JFK'], got = Object.fromEntries(bases.map((b) => [b, opening(b)]));
    for (const b of bases) { expect(got[b], `${b} ${got[b].toFixed(1)}`).toBeGreaterThan(3); expect(got[b], `${b} ${got[b].toFixed(1)}`).toBeLessThan(45); }
    const vals = Object.values(got); expect(Math.max(...vals) - Math.min(...vals), JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, Math.round(v)])))).toBeLessThan(35); /* 3년 자동 운영 시험으로 지원금을 조정했기 때문에 첫 해 격차는 조금 남는다 */
  });
  it('지원금이 없으면 시드니는 적자다(지원금이 실제로 균형을 맞추고 있다)', () => {
    const t = K().table, old = { ...t }; try { for (const k of Object.keys(t)) delete t[k]; expect(opening('SYD')).toBeLessThan(3); } finally { Object.assign(t, old); }
  });
});
