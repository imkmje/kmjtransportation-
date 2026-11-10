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
  it('임대: 보증금만 내고, 월 고정비가 임대료만큼 늘며, 담보·감가상각이 없다', () => {
    const g = new Game(3), cash = g.state.cash, fixed = g.fixedMonthly, limit = g.loanLimit, t = typeById('A350');
    const r = g.leasePlane('A350'); if (!r.ok) throw new Error(r.error);
    const p = g.plane(r.planeId)!, rent = t.price * config.lease.rate;
    expect(g.state.cash).toBeCloseTo(cash - rent * config.lease.deposit, 6); expect(p.deposit).toBeCloseTo(rent * config.lease.deposit, 6);
    expect(p.leased).toBe(true); expect(p.book).toBe(0);
    expect(g.fixedMonthly - fixed).toBeCloseTo(rent + config.cost.perPlaneMonthly, 6);
    expect(g.loanLimit).toBe(limit);
    g.advanceDays(30);
    expect(g.state.history[0].depreciation).toBeCloseTo(typeById('B737').price / config.cost.depreciationMonths, 6); // 시작 기체 것만
    expect(p.book).toBe(0);
  });
  it('임대: 보증금이 모자라면 거절, 임대기는 내 항공기 수 + 2대까지만', () => {
    const g = new Game(3); g.state.cash = 1;
    expect(g.leasePlane('A350').ok).toBe(false);
    g.state.cash = 500;
    for (let i = 0; i < 3; i++) expect(g.leasePlane('T72').ok).toBe(true); // 내 항공기 1대 + 2 = 3대
    const r = g.leasePlane('T72'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toContain('임대는');
    g.buyPlane('B737'); // 내 항공기가 늘면 한도도 는다
    expect(g.leasePlane('T72').ok).toBe(true);
  });
  it('임대기 조기 반납: 보증금을 돌려받고 남은 개월 임대료를 위약금으로 낸다(12개월이 지나면 1개월치)', () => {
    const g = new Game(3), r = g.leasePlane('B737'); if (!r.ok) throw new Error(r.error);
    const p = g.plane(r.planeId)!, rent = typeById('B737').price * config.lease.rate, cash = g.state.cash;
    p.age = 4;
    expect(g.leaseReturnFee(p)).toBeCloseTo(rent * 8, 6);
    expect(g.sellPlane(r.planeId).ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(cash + rent * config.lease.deposit - rent * 8, 6);
    expect(g.plane(r.planeId)).toBeUndefined();
    const r2 = g.leasePlane('B737'); if (!r2.ok) throw new Error(r2.error);
    g.plane(r2.planeId)!.age = 30;
    expect(g.leaseReturnFee(g.plane(r2.planeId)!)).toBeCloseTo(rent, 6);
  });
  it('임대기 매입: 보증금을 빼고 사서 내 항공기가 되고, 오래 쓸수록 싸진다', () => {
    const g = new Game(3); g.state.cash = 200;
    const r = g.leasePlane('B737'); if (!r.ok) throw new Error(r.error);
    const p = g.plane(r.planeId)!, dep = p.deposit!, t = typeById('B737');
    expect(g.leaseBuyoutPrice(p)).toBeCloseTo(t.price, 1);
    p.age = 40;
    const price = g.leaseBuyoutPrice(p); expect(price).toBeCloseTo(t.price * 0.8, 1);
    const cash = g.state.cash, own = g.state.planes.filter((x) => !x.leased).length;
    const b = g.buyOutLease(r.planeId); expect(b.ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(cash - (price - dep), 6);
    expect(p.leased).toBe(false); expect(p.book).toBeCloseTo(price, 6); expect(p.deposit).toBe(0);
    expect(g.state.planes.filter((x) => !x.leased).length).toBe(own + 1);
    expect(g.buyOutLease(r.planeId).ok).toBe(false); // 이미 내 항공기
    p.age = 400; expect(g.leaseBuyoutPrice({ ...p, leased: true })).toBeCloseTo(t.price * config.lease.buyoutMin, 1);
  });
  it('임대기 매입: 현금이 모자라면 거절', () => {
    const g = new Game(3), r = g.leasePlane('B737'); if (!r.ok) throw new Error(r.error);
    g.state.cash = 1;
    expect(g.buyOutLease(r.planeId).ok).toBe(false); expect(g.plane(r.planeId)!.leased).toBe(true);
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
