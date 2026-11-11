import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const withRoute = (seed = 1) => {
  const g = new Game(seed); const o = g.openRoute('ICN', 'CJU'); if (!o.ok) throw new Error(o.error);
  g.assign(g.state.planes[0].id, o.routeId, 20);
  return { g, rt: g.route(o.routeId)! };
};

describe('연료 시장', () => {
  it('연료 가격 지수는 범위 안에서 움직이고 결정론적이다', () => {
    const a = new Game(5), b = new Game(5); a.advanceDays(30 * 36); b.advanceDays(30 * 36);
    expect(a.state.fuel).toBe(b.state.fuel);
    expect(a.state.fuel).toBeGreaterThanOrEqual(config.fuel.min); expect(a.state.fuel).toBeLessThanOrEqual(config.fuel.max);
  });
  it('연료가 비싸면 운영비가 늘고, 연료 계약을 맺으면 계약 가격에 고정되며 6개월 뒤 끝난다', () => {
    const { g, rt } = withRoute();
    const base = g.routeDay(rt).cost;
    g.state.fuel = 1.5; const pricey = g.routeDay(rt).cost; expect(pricey).toBeGreaterThan(base);
    const c0 = g.state.cash;
    const h = g.hedgeFuel(); expect(h.ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - config.fuel.hedgeCost, 9);
    expect(g.hedgeFuel()).toEqual({ ok: false, error: '이미 연료 계약 중입니다' });
    g.state.fuel = 0.7; // 시장이 내려도 계약 가격(1.5)을 낸다
    expect(g.routeDay(rt).cost).toBeCloseTo(pricey, 9);
    g.state.cash = 500; g.advanceDays(30 * 7);
    expect(g.state.hedge).toBeNull();
    const lowCash = new Game(1); lowCash.state.cash = 0.5; expect(lowCash.hedgeFuel()).toEqual({ ok: false, error: '현금이 모자랍니다' });
  });
});

describe('정비 관리', () => {
  it('정비 상태는 매달 닳고, 많이 날수록 빨리 닳는다', () => {
    const { g } = withRoute(); const idle = (() => { g.state.cash = 100; const b = g.buyPlane('B737'); if (!b.ok) throw new Error(); return g.plane(b.planeId)!; })();
    g.advanceDays(30);
    expect(g.state.planes[0].cond).toBeLessThan(idle.cond); // 노선을 나는 쪽이 더 닳는다
    expect(idle.cond).toBeCloseTo(1 - config.maint.decayBase, 9);
  });
  it('정비 점검: 비용을 내면 상태가 100%로 돌아오고 7일간 못 날며, 그동안 수익이 없다', () => {
    const { g, rt } = withRoute(); const p = g.state.planes[0];
    p.cond = 0.3; const c0 = g.state.cash, cost = g.serviceCost(p);
    expect(cost).toBeCloseTo(Math.max(config.maint.minCost, 60 * config.maint.costRatio), 9);
    expect(g.service(p.id).ok).toBe(true);
    expect(p.cond).toBe(1); expect(p.shop).toBe(config.maint.shopDays); expect(g.state.cash).toBeCloseTo(c0 - cost, 9);
    expect(g.routeDay(rt).seats).toBe(0);
    expect(g.service(p.id)).toEqual({ ok: false, error: '이미 정비 중입니다' });
    g.advanceDays(7); expect(p.shop).toBe(0); expect(g.routeDay(rt).seats).toBeGreaterThan(0);
  });
  it('정비 상태가 낮으면 고장 나서 한 달 운항하지 못한다(충분히 오래 방치하면 반드시 일어남)', () => {
    const { g } = withRoute(); const p = g.state.planes[0]; let broke = 0;
    for (let m = 0; m < 24 && g.state.status === 'playing'; m++) { p.cond = 0.1; g.advanceDays(30); if (g.state.log.some((l) => l.includes('고장'))) { broke++; break; } }
    expect(broke).toBe(1);
  });
  it('정비를 꾸준히 하면(상태가 높게 유지되면) 고장 나지 않는다', () => {
    const { g } = withRoute(); const p = g.state.planes[0];
    for (let m = 0; m < 24 && g.state.status === 'playing'; m++) { p.cond = 0.9; g.advanceDays(30); }
    expect(g.state.log.some((l) => l.includes('고장'))).toBe(false);
  });
});

describe('연속 불황·대출 중단', () => {
  it('불황(지수 0.9 아래)에서는 평균으로 돌아오는 힘이 약하다(평균 지속 기간이 더 길다)', () => {
    const med = (start: number) => { const out: number[] = []; for (let seed = 1; seed <= 20; seed++) { const g = new Game(seed); g.state.economy = start; g.advanceDays(30 * 6); out.push(g.state.economy); } return out.sort((a, b) => a - b)[10]; };
    expect(med(0.8)).toBeLessThan(0.95); expect(med(1.0)).toBeGreaterThan(0.9);
    expect(config.credit.stickyReversion).toBeLessThan(config.economy.reversion);
  });
  it('경기가 크게 나빠지면 은행이 대출을 중단하고, 몇 달 뒤 풀린다', () => {
    const g = new Game(1); g.state.economy = 0.78;
    g.advanceDays(30 * 1 + 1); // 다음 달 시작에서 판정
    expect(g.state.freeze).toBeGreaterThan(0);
    expect(g.borrow(5).ok).toBe(false);
    const msg = g.borrow(5); if (!msg.ok) expect(msg.error).toContain('대출을 중단');
    g.state.economy = 1.0; g.advanceDays(30 * (config.credit.freezeMonths + 2)); // 경기가 회복되면 풀린다
    expect(g.state.freeze).toBe(0);
    expect(g.borrow(5).ok).toBe(true);
  });
});

describe('저장 형식 6', () => {
  it('형식 5 파일은 연료 1·계약 없음·정비 100%로 변환된다', () => {
    const { g } = withRoute(4); g.advanceDays(40);
    const v5 = JSON.parse(JSON.stringify(g.toJSON())); v5.formatVersion = 5; delete v5.fuel; delete v5.hedge; delete v5.freeze; for (const p of v5.planes) { delete p.cond; delete p.shop; }
    const back = Game.fromJSON(v5);
    expect(back.state.formatVersion).toBe(13); expect(back.state.fuel).toBe(1); expect(back.state.hedge).toBeNull(); expect(back.state.freeze).toBe(0); expect(back.state.planes[0].cond).toBe(1);
    back.advanceDays(60); expect(back.state.status).toBe('playing');
  });
});

describe('자동 정비', () => {
  const setup = (auto: boolean) => {
    const g = new Game(5); g.state.cash = 100; g.state.autoMaint = auto;
    const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error(o.error);
    const p = g.state.planes[0]; if (!g.assign(p.id, o.routeId, 5).ok) throw new Error('assign');
    p.cond = 0.56; // 이번 달 닳은 뒤 기준선(55%) 아래로 내려간다
    return { g, p };
  };
  it('켜 두면 월말에 낮은 정비 상태를 점검하고 비용을 낸다', () => {
    const { g, p } = setup(true);
    g.advanceDays(30);
    expect(p.cond).toBe(1); expect(g.state.log.some((l) => l.includes('자동 정비'))).toBe(true);
  });
  it('꺼 두면 점검하지 않는다', () => {
    const { g, p } = setup(false);
    g.advanceDays(30);
    expect(p.cond).toBeLessThan(0.56); expect(g.state.log.some((l) => l.includes('자동 정비'))).toBe(false);
  });
  it('현금이 모자라면 건너뛴다', () => {
    const { g, p } = setup(true); g.state.cash = 0.1; g.state.loan = 0;
    g.advanceDays(1); g.state.cash = 0.1;
    g.advanceDays(29);
    expect(g.state.log.some((l) => l.includes('자동 정비'))).toBe(false); expect(p.cond).toBeLessThan(0.56);
  });
});
