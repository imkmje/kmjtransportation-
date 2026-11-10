import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const setup = (seed = 1) => {
  const g = new Game(seed);
  const o = g.openRoute('ICN', 'CJU'); if (!o.ok) throw new Error(o.error);
  const plane = g.state.planes[0];
  expect(g.assign(plane.id, o.routeId, 20).ok).toBe(true);
  return { g, routeId: o.routeId, plane };
};

describe('게임 규칙', () => {
  it('시작 상태: 현금 20, 중형기 1대, 평판 0.3, 노선 없음', () => {
    const g = new Game(1);
    expect(g.state.cash).toBe(20); expect(g.state.planes.length).toBe(1); expect(g.state.planes[0].type).toBe('B737');
    expect(g.state.routes.length).toBe(0); expect(g.state.status).toBe('playing');
  });
  it('항공기 구매: 현금이 모자라면 거절', () => {
    const g = new Game(1);
    expect(g.buyPlane('A350')).toEqual({ ok: false, error: '현금이 모자랍니다' });
    expect(g.state.cash).toBe(20);
  });
  it('항공기 구매 금액만큼 현금이 줄어든다(현금 80일 때 A220 구매)', () => {
    const g = new Game(1); g.state.cash = 80;
    expect(g.buyPlane('A220').ok).toBe(true);
    expect(g.state.cash).toBe(35); expect(g.state.planes.length).toBe(2);
  });
  it('배정 검증: 항속 부족·주간 한도 초과·없는 노선은 거절', () => {
    const g = new Game(1);
    const far = g.openRoute('ICN', 'JFK'); if (!far.ok) throw new Error();
    expect(g.assign(g.state.planes[0].id, far.routeId, 1)).toEqual({ ok: false, error: '항속거리가 모자랍니다' });
    const near = g.openRoute('ICN', 'CJU'); if (!near.ok) throw new Error();
    expect(g.assign(g.state.planes[0].id, near.routeId, 999).ok).toBe(false);
    expect(g.assign(g.state.planes[0].id, 9999, 1).ok).toBe(false);
    expect(g.openRoute('ICN', 'ICN').ok).toBe(false);
  });
  it('노선을 닫으면 배정이 풀리고 같은 쌍을 다시 열면 같은 노선이다', () => {
    const { g, routeId, plane } = setup();
    g.closeRoute(routeId);
    expect(plane.routeId).toBeNull();
    const again = g.openRoute('CJU', 'ICN');
    expect(again.ok && again.routeId).toBe(routeId);
  });
  it('운임은 기준의 0.5~2.0배로 제한된다', () => {
    const { g, routeId } = setup();
    const base = g.routeBaseFare(g.route(routeId)!);
    g.setFare(routeId, 1); expect(g.route(routeId)!.fare).toBe(Math.round(base * config.fare.minRatio));
    g.setFare(routeId, 99999); expect(g.route(routeId)!.fare).toBe(Math.round(base * config.fare.maxRatio));
  });
  it('수입 > 비용이면 현금이 늘고, 월말에 보고서·고정비·감가상각이 반영된다', () => {
    const { g } = setup();
    const c0 = g.state.cash;
    g.advanceDays(30);
    const h = g.state.history[0];
    expect(g.state.history.length).toBe(1);
    expect(h.revenue).toBeGreaterThan(0); expect(h.pax).toBeGreaterThan(0);
    expect(h.depreciation).toBeCloseTo(60 / config.cost.depreciationMonths, 9);
    // 현금 증감 = 수입 - 운영비 - 고정비 (감가상각은 현금 아님)
    expect(g.state.cash - c0).toBeCloseTo(h.revenue - h.cost - h.fixed, 6);
    expect(h.fixed).toBeCloseTo(config.cost.fixedMonthly + config.cost.perPlaneMonthly, 9);
    expect(h.profit).toBeCloseTo(h.revenue - h.cost - h.depreciation - h.fixed, 9);
  });
  it('탑승객은 수요와 좌석 중 작은 쪽, 운임을 올리면 수요가 줄어든다', () => {
    const { g, routeId } = setup();
    const r = g.route(routeId)!;
    const d = g.routeDay(r);
    expect(d.pax).toBeCloseTo(Math.min(d.demand, d.seats), 9);
    const lo = g.routeDay(r).demand; g.setFare(routeId, r.fare * 1.5);
    expect(g.routeDay(r).demand).toBeLessThan(lo);
  });
  it('방치하면 고정비만 나가고, 현금이 -5 아래로 2개월 지속되면 파산', () => {
    const g = new Game(1); g.state.cash = -4.9;
    g.advanceDays(30 * 4);
    expect(g.state.status).toBe('bankrupt');
    const before = g.state.day; g.advanceDays(30);
    expect(g.state.day).toBe(before); // 끝난 게임은 더 진행되지 않는다
  });
  it('결정론: 같은 시드와 같은 행동이면 같은 결과', () => {
    const a = setup(5).g, b = setup(5).g;
    a.advanceDays(360); b.advanceDays(360);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
    const c = setup(6).g; c.advanceDays(360);
    expect(JSON.stringify(c.toJSON())).not.toBe(JSON.stringify(a.toJSON())); // 시드가 다르면 사건이 달라진다
  });
  it('저장·불러오기 후 이어서 실행한 결과가 끊김 없이 실행한 결과와 같다', () => {
    const { g } = setup(3);
    g.advanceDays(95);
    const loaded = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    g.advanceDays(200); loaded.advanceDays(200);
    expect(JSON.stringify(loaded.toJSON())).toBe(JSON.stringify(g.toJSON()));
    expect(() => Game.fromJSON({ formatVersion: 99 })).toThrow('더 새로운');
    expect(() => Game.fromJSON({ nope: 1 })).toThrow('저장 파일이 아닙니다');
  });
  it('사건: 시간이 지나면 일부 달에 사건이 생기고 기록이 남는다(결정론)', () => {
    const { g } = setup(2);
    g.advanceDays(30 * 20);
    expect(g.state.log.length).toBeGreaterThan(0);
  });
});
