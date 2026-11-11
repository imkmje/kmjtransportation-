import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const rival = (g: Game, extra: object = {}) => { g.state.competitors.push({ id: 90, name: '시험항공', style: 'low', hub: 'HKG', cash: 50, planes: 5, routes: [{ a: 'HKG', b: 'SIN', seatsDay: 300, fareRatio: 1 }], low: 0, ...extra } as never); return g.state.competitors.at(-1)!; };

describe('경쟁사 인수', () => {
  it('인수하면 회사가 사라지고 항공기·슬롯·평판을 받는다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 500; const k = rival(g), price = g.acquirePrice(k), planes0 = g.state.planes.length, rep0 = g.state.reputation;
    const r = g.acquireCompetitor(90); expect(r.ok).toBe(true);
    expect(g.state.competitors.some((c) => c.id === 90)).toBe(false);
    expect(g.state.cash).toBeCloseTo(500 - price, 6); expect(g.state.planes.length).toBe(planes0 + 5);
    expect(g.state.slots.HKG).toBe(config.acquire.slots); expect(g.state.reputation).toBeGreaterThan(rep0 - 1e-9);
    expect(g.state.rivalsGone.at(-1)).toMatchObject({ name: '시험항공', acq: true });
  });
  it('자금난이면 싸고, 대형·현금 부족은 거절된다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 500; const k = rival(g), normal = g.acquirePrice(k); k.low = 2;
    expect(g.acquirePrice(k)).toBeLessThan(normal);
    g.state.cash = 1; expect(g.acquireCompetitor(90).ok).toBe(false);
    g.state.cash = 500; k.major = true; expect(g.acquireCompetitor(90).ok).toBe(false);
  });
});

describe('노선 폐지와 재개', () => {
  it('운항하던 노선을 닫으면 평판이 떨어지고, 6개월 안에 다시 열면 비용이 든다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 300; g.state.reputation = 0.5;
    const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error('open'); g.buyForRoute(o.routeId, 'B737', 'new');
    g.closeRoute(o.routeId); expect(g.state.reputation).toBeCloseTo(0.5 - config.reopen.rep, 9);
    const c0 = g.state.cash; expect(g.openRoute('ICN', 'NRT').ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - config.reopen.fee, 9);
    g.closeRoute(o.routeId); g.advanceDays(30 * config.reopen.months + 1);
    const c1 = g.state.cash; g.openRoute('ICN', 'NRT'); expect(g.state.cash).toBeGreaterThan(c1 - 1e-9 - 5); // 6개월이 지나면 재개 비용 없음(월 정산은 별개)
    expect(g.route(o.routeId)!.closed).toBeUndefined();
  });
  it('현금이 모자라면 재개가 거절된다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 300;
    const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error('open'); g.closeRoute(o.routeId); g.state.cash = 0.5;
    expect(g.openRoute('ICN', 'NRT').ok).toBe(false);
  });
});

describe('연료 계약 기간', () => {
  it('3·6·12개월을 고르고 비용이 다르다', () => {
    for (const t of config.fuel.hedgeTiers) {
      const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 50; const c0 = g.state.cash;
      expect(g.hedgeFuel(t.months).ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - t.cost, 9); expect(g.state.hedge!.monthsLeft).toBe(t.months);
    }
    expect(new Game(1).hedgeFuel(5).ok).toBe(false);
  });
});

describe('허브 환승', () => {
  it('via로 특정 도시를 거치는 환승만 센다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 800;
    for (const [a, b] of [['ICN', 'NRT'], ['ICN', 'SIN']] as const) { const o = g.openRoute(a, b); if (o.ok) g.buyForRoute(o.routeId, 'B737', 'new'); }
    const r = g.state.routes[0], all = g.transferDemand(r), viaIcn = g.transferDemand(r, 'ICN'), viaNrt = g.transferDemand(r, 'NRT');
    expect(viaIcn).toBeGreaterThan(0); expect(viaNrt).toBe(0); expect(all).toBeCloseTo(viaIcn + viaNrt, 6);
  });
});
