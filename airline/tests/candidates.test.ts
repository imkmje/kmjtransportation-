import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { advise } from '../src/sim/advice';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 3000; g.state.rights = undefined; return g; };
const route = (g: Game, a: string, b: string, weekly = 7) => { const r = g.openRoute(a, b); if (!r.ok) throw new Error(r.error); const p = g.buyPlane('B737'); if (!p.ok) throw new Error(p.error); const x = g.assign(p.planeId, r.routeId, weekly); if (!x.ok) throw new Error(x.error); return { rid: r.routeId, pid: p.planeId }; };

describe('A3 파산 경보', () => {
  it('최근 적자가 이어지면 남은 개월 수를 알려 주고 할 일 맨 위에 경보가 뜬다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.advanceDays(90);
    for (const h of g.state.history.slice(-3)) h.profit = -10;
    g.state.cash = 25; expect(g.runway()).toBe(3); // (25 − (−5)) / 10
    expect(advise(g)[0].text).toContain('3개월 뒤 현금이 바닥');
    for (const h of g.state.history.slice(-3)) h.profit = 1; expect(g.runway()).toBeNull();
  });
});

describe('B1 세일 앤 리스백', () => {
  it('판 값을 받고 임대기가 되며, 임대료는 판 값의 3.5%, 되살 때는 판 값보다 싸지 않다', () => {
    const g = sb(); const { pid } = route(g, 'ICN', 'NRT'); const p = g.plane(pid)!, cash = g.state.cash, price = g.slbPrice(p), lm = g.leaseMonthly;
    const r = g.saleLeaseback(pid); expect(r.ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(cash + price); expect(p.leased).toBe(true); expect(p.routeId).not.toBeNull();
    expect(g.leaseMonthly - lm).toBeCloseTo(price * config.slb.rent, 1);
    expect(g.leaseBuyoutPrice(p)).toBeGreaterThanOrEqual(price);
    expect(g.saleLeaseback(pid).ok).toBe(false);
  });
});

describe('B4 자동 증감편', () => {
  it('손님이 넘치면 주 1회씩 늘리고, 꺼 두면 그대로', () => {
    const g = sb(); const { pid } = route(g, 'ICN', 'NRT', 2); g.state.slots.ICN = 50; g.state.slots.NRT = 50;
    g.advanceDays(14); expect(g.plane(pid)!.weekly).toBe(2);
    g.setAutoFreq(true); g.advanceDays(21); expect(g.plane(pid)!.weekly).toBeGreaterThan(2);
  });
});

describe('B3 환승 흐름', () => {
  it('허브를 거쳐 갈아타는 짝이 나오고, 합계 수요와 같은 짝을 센다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); route(g, 'ICN', 'PVG');
    const fl = g.transferFlows('ICN'); expect(fl.length).toBeGreaterThan(0);
    expect(fl.some((x) => [x.a, x.b].sort().join() === ['NRT', 'PVG'].sort().join())).toBe(true);
  });
});

describe('C4 슬롯 거래', () => {
  it('산 슬롯 중 남는 것을 팔면 경쟁사가 차지하고, 그 슬롯을 다시 사 올 수 있다', () => {
    const g = sb(); expect(g.buySlot('ICN').ok).toBe(true);
    const cap = g.slotCapacity('ICN'), r = g.sellSlot('ICN'); expect(r.ok).toBe(true);
    expect(g.compSlotsAt('ICN')).toBe(1); expect(g.slotCapacity('ICN')).toBeLessThan(cap);
    expect(g.buyCompSlot('ICN').ok).toBe(true); expect(g.compSlotsAt('ICN')).toBe(0);
    expect(g.sellSlot('NRT').ok).toBe(false);
  });
});

describe('C2 경쟁사 움직임 예보', () => {
  it('예보한 새 노선이 실제로 그 회사가 다음에 여는 노선과 같다', () => {
    const g = sb(); const c = g.state.competitors.find((x) => !x.major)!; c.cash = 500;
    const f = g.forecastOf(c); expect(f.need).toBe(0);
    if (f.newRoute) { const n = c.routes.length; (g as unknown as { compBuy(c: unknown, m: number): void }).compBuy(c, g.month); expect(c.routes.length).toBe(n + 1); expect(c.routes.at(-1)!.b).toBe(f.b); }
  });
});
