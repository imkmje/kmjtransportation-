import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 9999; g.state.rights = undefined; return g; };
/** 해금 조건을 잠시 없앤다(조건 시험은 따로) */
const free = () => { for (const k of Object.values(config.biz.units)) k.need = undefined; };
const route = (g: Game, a = 'ICN', b = 'NRT', t = 'A220') => { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); const p = g.buyForRoute(o.routeId, t, 'new'); if (!p.ok) throw new Error(p.error); return g.route(o.routeId)!; };
const bizStep = (g: Game) => (g as unknown as { bizStep: () => void }).bizStep();
const needs = Object.fromEntries(Object.entries(config.biz.units).map(([k, v]) => [k, v.need]));
const restore = () => { for (const [k, n] of Object.entries(needs)) config.biz.units[k].need = n; };

describe('그룹 사업 다각화(3.15.0)', () => {
  it('해금 조건: 항공기·취항 도시 수를 채워야 세울 수 있고, 모자란 것이 메시지로 나온다', () => {
    const g = sb(); try { restore(); const t = config.biz.units.travel.need!; expect(g.unitLock('travel')).toContain('항공기'); expect(g.unitLock('travel')).toContain('취항 도시'); expect(g.buildUnit('travel').ok).toBe(false);
      expect(g.unitLock('catering')).toContain(`${config.biz.units.catering.need!.planes}대`); expect(t.planes).toBeGreaterThan(0);
      free(); expect(g.unitLock('travel')).toBeNull(); expect(g.buildUnit('travel').ok).toBe(true); } finally { restore(); }
  });
  it('세우고 키우기: 값을 내고 단계가 오르며, 최고 단계·돈 부족·없는 사업은 안 된다', () => {
    const g = sb(); try { free(); const k = config.biz.units.travel, c0 = g.state.cash;
      expect(g.buildUnit('travel').ok).toBe(true); expect(g.state.cash).toBe(c0 - k.cost[0]); expect(g.unitLevel('travel')).toBe(1); expect(g.buildUnit('travel').ok).toBe(true); expect(g.unitLevel('travel')).toBe(2);
      expect(g.unitCost('travel')).toBe(k.cost[2]); g.state.cash = 1; expect(g.buildUnit('travel').ok).toBe(false); g.state.cash = 9999; expect(g.buildUnit('travel').ok).toBe(true); expect(g.buildUnit('travel').ok).toBe(false); expect(g.unitCost('travel')).toBeNull();
      expect(g.buildUnit('없는사업').ok).toBe(false); expect(new Game(3).buildUnit('travel').ok).toBe(false); // 시나리오 모드는 불가
    } finally { restore(); }
  });
  it('월 소득: 여행사는 승객 수, 물류는 화물 수입, 기내식·정비는 경쟁사 항공기 수에 기대고 경기를 탄다', () => {
    const g = sb(); try { free(); route(g); g.advanceDays(31); const h = g.state.history.at(-1)!; h.pax = 100000; h.cargo = 50; g.state.economy = 1;
      for (const id of Object.keys(config.biz.units)) g.buildUnit(id);
      const U = config.biz.units, comp = g.state.competitors.reduce((a, c) => a + ((c.stake ?? 0) < 0.51 ? c.planes : 0), 0);
      expect(g.unitInfo('travel').rev).toBeCloseTo((100000 * U.travel.perPax![0]) / 1e6, 2); expect(g.unitInfo('logistics').rev).toBeCloseTo(50 * U.logistics.share![0], 2);
      expect(g.unitInfo('catering').rev).toBeCloseTo(comp * U.catering.ext![0], 2); expect(g.unitInfo('mro').rev).toBeCloseTo(comp * U.mro.ext![0], 2);
      expect(g.unitInfo('travel').net).toBeCloseTo(g.unitInfo('travel').rev * (1 - U.travel.opex), 2);
      const c0 = g.state.cash, tot = Object.keys(U).reduce((a, i) => a + g.unitInfo(i).net, 0); bizStep(g); expect(g.state.cash - c0).toBeCloseTo(tot, 1); // 사고가 없으면 정확히 합계만큼(사고는 아래에서)
    } finally { restore(); }
  });
  it('경기 충격: 여행사는 크게 줄고, 정비 회사는 불황에 오히려 늘며, 다각화하면 덜 줄어든다', () => {
    const g = sb(); try { free(); route(g); g.advanceDays(31); g.state.history.at(-1)!.pax = 200000; g.state.history.at(-1)!.cargo = 40; g.state.economy = 1;
      g.buildUnit('travel'); const t1 = g.bizNet(1), t2 = g.bizNet(0.8); expect(t2).toBeLessThan(t1 * 0.7); // 경기^1.6
      const m = sb(); free(); route(m); m.advanceDays(31); for (const c of m.state.competitors) c.planes = 40; m.buildUnit('mro'); expect(m.bizNet(0.8)).toBeGreaterThan(m.bizNet(1)); // 경기^−0.4
      g.buildUnit('mro'); g.buildUnit('catering'); const drop = 1 - g.bizNet(0.8) / g.bizNet(1); expect(drop).toBeLessThan(1 - t2 / t1); // 섞으면 덜 줄어든다
    } finally { restore(); }
  });
  it('사업 효과가 실제 계산에 들어간다: 여행사 수요, 기내식 운영비, 정비 점검비, 물류 화물 수입', () => {
    const g = sb(); try { free(); const r = route(g, 'ICN', 'NRT', 'A220'); g.advanceDays(31); const pl = g.planesOn(r.id)[0], U = config.biz.units;
      const d0 = g.routeDay(r), sv0 = g.serviceCost(pl), ex0 = (g as unknown as { extraDemand: (x: typeof r) => number }).extraDemand(r);
      for (const id of Object.keys(U)) g.buildUnit(id);
      const ex1 = (g as unknown as { extraDemand: (x: typeof r) => number }).extraDemand(r); expect(ex1 / ex0).toBeCloseTo(1 + U.travel.eff[0], 6);
      expect(g.serviceCost(pl) / sv0).toBeCloseTo(1 - U.mro.eff[0], 6);
      const d1 = g.routeDay(r); expect(d1.costOps / d0.costOps).toBeCloseTo(1 - U.catering.eff[0], 4);
      if (d0.cargoRevenue > 0) expect(d1.cargoRevenue / d0.cargoRevenue).toBeCloseTo(1 + U.logistics.eff[0], 4);
    } finally { restore(); }
  });
  it('다각화: 사업 종류가 3종이면 대출 이자가 내려가고 5종이면 더 내려간다', () => {
    const g = sb(); try { free(); route(g); g.advanceDays(31); const r0 = g.loanRate, d = config.biz.diversify; expect(g.bizKinds).toBe(0);
      g.buildUnit('travel'); g.buildUnit('catering'); expect(g.bizKinds).toBe(2); expect(g.loanRate).toBeCloseTo(r0, 8);
      g.buildUnit('mro'); expect(g.bizKinds).toBe(3); expect(g.loanRate).toBeCloseTo((r0 - d.cut1 * g.mods.rate), 8);
      g.buildUnit('logistics'); expect(g.buyLeasePlane('A220').ok || true).toBe(true); g.buildHotel('ICN'); expect(g.bizKinds).toBeGreaterThanOrEqual(5); expect(g.loanRate).toBeCloseTo((r0 - d.cut2 * g.mods.rate), 8);
      expect(new Game(3).diversifyCut).toBe(0);
    } finally { restore(); }
  });
  it('사업 사고: 사고가 나면 그 사업 순이익 몇 달치를 잃고, 보험이 줄여 준다', () => {
    const lossOf = (ins: number) => { const g = sb(); free(); route(g); g.advanceDays(31); g.state.history.at(-1)!.pax = 200000; g.state.insurance = ins; g.buildUnit('travel'); const d = config.biz.diversify, sh = d.shock; d.shock = 1;
      try { const net = g.unitInfo('travel').net, c0 = g.state.cash; bizStep(g); return { lost: net - (g.state.cash - c0), net }; } finally { d.shock = sh; restore(); } };
    const a = lossOf(0), b = lossOf(2); expect(a.lost).toBeCloseTo(a.net * config.biz.diversify.shockMonths, 1); expect(b.lost).toBeLessThan(a.lost); expect(b.lost).toBeCloseTo(b.net * config.biz.diversify.shockMonths * (1 - config.extra.insurance.cut[2]), 1);
  });
  it('사고 확률이 0이면 난수를 쓰지 않는다(측정이 어긋나지 않게)', () => {
    const g = sb(); try { free(); route(g); g.advanceDays(31); g.buildUnit('travel'); const d = config.biz.diversify, sh = d.shock; d.shock = 0; try { const rs = () => (g as unknown as { rng: { getState: () => number } }).rng.getState(), before = rs(); bizStep(g); expect(rs()).toBe(before); d.shock = 0.5; bizStep(g); expect(rs()).not.toBe(before); /* 확률이 있으면 난수를 쓴다 */ } finally { d.shock = sh; } } finally { restore(); }
  });
});
