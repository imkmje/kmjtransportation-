import { describe, it, expect } from 'vitest';
import { config } from '../src/config';
import { typeById } from '../src/data';
import { Game } from '../src/sim/game';

const fly = (g: Game, a: string, b: string, planeId: number, w = 5) => {
  const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error);
  let r = g.assign(planeId, o.routeId, w);
  while (!r.ok && r.error.includes('슬롯')) { g.buySlot(a); g.buySlot(b); r = g.assign(planeId, o.routeId, w); }
  if (!r.ok) throw new Error(r.error);
  return g.route(o.routeId)!;
};

describe('임대·중고·제휴·환승', () => {
  it('임대: 현금이 들지 않고 월 고정비가 임대료만큼 늘며, 담보·감가상각이 없다', () => {
    const g = new Game(3), cash = g.state.cash, fixed = g.fixedMonthly, limit = g.loanLimit, t = typeById('A350');
    const r = g.leasePlane('A350'); if (!r.ok) throw new Error(r.error);
    const p = g.plane(r.planeId)!;
    expect(g.state.cash).toBe(cash);
    expect(p.leased).toBe(true); expect(p.book).toBe(0);
    expect(g.fixedMonthly - fixed).toBeCloseTo(t.price * config.lease.rate + config.cost.perPlaneMonthly, 6);
    expect(g.loanLimit).toBe(limit);
    g.advanceDays(30);
    expect(g.state.history[0].depreciation).toBeCloseTo(typeById('B737').price / config.cost.depreciationMonths, 6); // 시작 기체 것만
    expect(p.book).toBe(0);
  });
  it('임대기 반납: 위약금(임대료 1개월치)이 나가고 기체가 사라진다', () => {
    const g = new Game(3), r = g.leasePlane('B737'); if (!r.ok) throw new Error(r.error);
    const cash = g.state.cash, s = g.sellPlane(r.planeId);
    expect(s.ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(cash - typeById('B737').price * config.lease.rate * config.lease.returnMonths, 6);
    expect(g.plane(r.planeId)).toBeUndefined();
  });
  it('중고: 값이 싸고, 나이가 많아 운영비가 더 들며 정비 상태가 낮다', () => {
    const g = new Game(3); g.state.cash = 100;
    const r = g.buyPlane('B737', true); if (!r.ok) throw new Error(r.error);
    const p = g.plane(r.planeId)!, price = typeById('B737').price * config.used.price;
    expect(g.state.cash).toBeCloseTo(100 - price, 6);
    expect(p.book).toBeCloseTo(price, 6); expect(p.age).toBe(config.used.age); expect(p.cond).toBe(config.used.cond);
    expect(g.agingMult(p)).toBeGreaterThan(1.2);
    g.state.cash = 1;
    expect(g.buyPlane('B737', true).ok).toBe(false);
  });
  it('제휴: 월 수수료가 붙고, 그 경쟁사와 겹치는 노선의 점유율이 오른다', () => {
    const g = new Game(3), r = fly(g, 'ICN', 'NRT', g.state.planes[0].id);
    g.state.competitors[1].routes.push({ a: 'NRT', b: 'ICN', seatsDay: 400, fareRatio: 1 });
    const before = g.routeDay(r).share, fixed = g.fixedMonthly;
    expect(before).toBeLessThan(1);
    expect(g.setAlly(99).ok).toBe(false);
    expect(g.setAlly(g.state.competitors[1].id).ok).toBe(true);
    expect(g.routeDay(r).share).toBeGreaterThan(before);
    expect(g.fixedMonthly - fixed).toBeCloseTo(config.ally.fee, 6);
    g.setAlly(null);
    expect(g.routeDay(r).share).toBeCloseTo(before, 9);
  });
  it('환승: 허브에서 이어지는 노선이 생기면 수요가 늘고, 직항을 열면 그 몫은 사라진다', () => {
    const g = new Game(3); g.state.cash = 500;
    const r1 = fly(g, 'NRT', 'ICN', g.state.planes[0].id);
    expect(g.routeDay(r1).transfer).toBe(0);
    const b = g.buyPlane('B737'); if (!b.ok) throw new Error(b.error);
    fly(g, 'ICN', 'PEK', b.planeId); // 도쿄 → 서울 → 베이징: 거의 일직선
    const t = g.routeDay(r1).transfer;
    expect(t).toBeGreaterThan(0);
    const c = g.buyPlane('B737'); if (!c.ok) throw new Error(c.error);
    fly(g, 'NRT', 'PEK', c.planeId); // 직항이 생기면 갈아탈 이유가 없다
    expect(g.routeDay(r1).transfer).toBe(0);
  });
  it('환승: 너무 돌아가는 길은 세지 않는다', () => {
    const g = new Game(3); g.state.cash = 500;
    const r1 = fly(g, 'ICN', 'NRT', g.state.planes[0].id);
    const b = g.buyPlane('B737'); if (!b.ok) throw new Error(b.error);
    fly(g, 'ICN', 'PUS', b.planeId, 3); // 도쿄 → 서울 → 부산은 크게 돌아간다
    expect(g.routeDay(r1).transfer).toBe(0);
  });
  it('저장 형식 8: 형식 7 파일은 제휴 없음으로 변환되고, 임대·제휴는 저장 후에도 유지된다', () => {
    const g = new Game(3); g.leasePlane('A220'); g.setAlly(1);
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(back.state.ally).toBe(1); expect(back.state.planes[1].leased).toBe(true);
    const old = g.toJSON() as unknown as Record<string, unknown>; old.formatVersion = 7; delete old.ally;
    const conv = Game.fromJSON(old);
    expect(conv.state.formatVersion).toBe(8); expect(conv.state.ally).toBeNull();
  });
});
