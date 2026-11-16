import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 3000; g.state.rights = undefined; return g; };
const route = (g: Game, a: string, b: string) => { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); g.buyForRoute(o.routeId, 'B737', 'new'); return g.route(o.routeId)!; };
const month = (g: Game) => (g as unknown as { bizStep(): void }).bizStep();

describe('그룹 사업: 호텔', () => {
  it('열고 3단계까지 키우며, 큰 도시일수록 비싸고, 내 노선이 많을수록 점유율이 오른다', () => {
    const g = sb(); const c1 = g.hotelCost('ICN')!, small = g.hotelCost('CJU')!; expect(c1).toBeGreaterThan(small);
    expect(g.buildHotel('ICN').ok).toBe(true); expect(g.hotelLevel('ICN')).toBe(1);
    const occ0 = g.hotelInfo('ICN').occ; route(g, 'ICN', 'NRT'); route(g, 'ICN', 'PEK'); expect(g.hotelInfo('ICN').occ).toBeGreaterThan(occ0);
    expect(g.buildHotel('ICN').ok).toBe(true); expect(g.buildHotel('ICN').ok).toBe(true); expect(g.buildHotel('ICN').ok).toBe(false); expect(g.hotelCost('ICN')).toBeNull();
    expect(new Game(3).buildHotel('ICN').ok).toBe(false); // 시나리오는 없음
  });
  it('매달 순이익이 들어오고, 호텔 도시를 오가는 내 노선 수요가 는다', () => {
    const g = sb(); const r = route(g, 'ICN', 'NRT'); const d0 = g.routeDay(r).demandE;
    g.buildHotel('NRT'); expect(g.routeDay(r).demandE).toBeGreaterThan(d0 * (1 + config.biz.hotel.boost[0]) - 1e-6);
    const c0 = g.state.cash; month(g); expect(g.state.cash - c0).toBeCloseTo(g.hotelInfo('NRT').net, 2); expect(g.state.biz!.last!.hotel).toBeGreaterThan(0);
  });
});

describe('그룹 사업: 리스 회사', () => {
  it('경쟁사 기단의 20%까지 빌려 주고 월세를 받으며, 자리가 없으면 논다. 망한 회사 기체는 돌아오고, 팔 수 있다', () => {
    const g = sb(); g.state.competitors = [{ id: 50, name: '시험항공', style: 'low', hub: 'NRT', cash: 50, planes: 10, routes: [] }];
    expect(g.leaseDemand().get(50)).toBe(2);
    for (let i = 0; i < 3; i++) expect(g.buyLeasePlane('B737').ok).toBe(true);
    const L = g.state.biz!.lessor!; expect(L.filter((p) => p.lessee === 50).length).toBe(2); expect(L.filter((p) => p.lessee === undefined).length).toBe(1);
    const c0 = g.state.cash, b0 = L[0].book; month(g); expect(g.state.cash - c0).toBeCloseTo(2 * g.rentOf('B737'), 2); expect(L[0].book).toBeLessThan(b0);
    g.state.competitors = []; month(g); expect(g.state.biz!.lessor!.every((p) => p.lessee === undefined)).toBe(true); // 회사가 없어지면 돌아온다
    const id = L[0].id, c1 = g.state.cash; const r = g.sellLeasePlane(id); expect(r.ok).toBe(true); expect(g.state.cash).toBeGreaterThan(c1); expect(g.state.biz!.lessor!.length).toBe(2);
    expect(g.buyLeasePlane('A380').ok).toBe(false); // 리스용 기종이 아님
  });
  it('작은 경쟁사도(3대) 1대는 빌려 가고, 남은 자리를 센다', () => {
    const g = sb(); g.state.competitors = [{ id: 60, name: '작은항공', style: 'low', hub: 'NRT', cash: 5, planes: 3, routes: [] }, { id: 61, name: '더작은항공', style: 'low', hub: 'PEK', cash: 5, planes: 2, routes: [] }];
    expect(g.leaseDemand().get(60)).toBe(1); expect(g.leaseDemand().get(61)).toBe(0); expect(g.leaseFree).toBe(1);
    g.buyLeasePlane('B737'); expect(g.leaseFree).toBe(0);
  });
  it('내 51% 자회사는 리스 수요에서 빠진다', () => {
    const g = sb(); g.state.competitors = [{ id: 51, name: '자회사', style: 'low', hub: 'NRT', cash: 50, planes: 10, routes: [], stake: 0.51 }];
    expect(g.leaseDemand().has(51)).toBe(false);
  });
});
