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
    expect(conv.state.formatVersion).toBe(9); expect(conv.state.ally).toBeNull();
  });
  it('운임 전쟁: 겹치는 노선에서 경쟁사가 운임을 크게 내리고, 기간이 끝나면 풀린다. 제휴하면 바로 끝난다', () => {
    const chance = config.war.chance; config.war.chance = 1;
    const g = new Game(3), r = fly(g, 'ICN', 'NRT', g.state.planes[0].id), k = g.state.competitors[1];
    k.routes.push({ a: 'NRT', b: 'ICN', seatsDay: 300, fareRatio: 1.15 });
    const before = g.routeDay(r).share;
    g.advanceDays(31); // 월초에 경쟁사가 움직인다
    const cr = k.routes.find((x) => x.a === 'NRT' && x.b === 'ICN')!;
    expect(cr.war).toBe(config.war.months); expect(cr.fareRatio).toBe(config.war.ratio);
    expect(g.warOn(r)?.comp.id).toBe(k.id);
    expect(g.routeDay(r).share).toBeLessThan(before);
    expect(g.state.log.some((l) => l.includes('운임 전쟁'))).toBe(true);
    config.war.chance = 0;
    g.advanceDays(30 * config.war.months);
    expect(cr.war).toBeUndefined(); expect(g.warOn(r)).toBeUndefined();
    cr.war = 2; g.setAlly(k.id);
    expect(cr.war).toBeUndefined();
    config.war.chance = chance;
  });
  it('환승은 이어지는 노선의 좌석 30%까지만 센다', () => {
    const g = new Game(3); g.state.cash = 500;
    const r1 = fly(g, 'NRT', 'ICN', g.state.planes[0].id);
    const b = g.buyPlane('T72'); if (!b.ok) throw new Error(b.error);
    const x = fly(g, 'ICN', 'PEK', b.planeId, 1); // 작은 비행기 주 1회: 자리가 거의 없다
    expect(g.routeDay(r1).transfer).toBeCloseTo(g.monthlySeats(x.id) * config.transfer.seatCap, 6);
  });
  it('자동 운임: 켜면 매주 자리를 채우는 운임으로 맞추고, 끄면 그대로 둔다', () => {
    const g = new Game(3), r = fly(g, 'ICN', 'NRT', g.state.planes[0].id);
    g.setFare(r.id, g.routeBaseFare(r) * 0.5); const low = r.fare; // 너무 싸서 자리가 모자란 상태
    g.advanceDays(8); expect(r.fare).toBe(low);
    g.setAutoFare(true); g.advanceDays(8);
    expect(r.fare).toBeGreaterThan(low);
    const d = g.routeDay(r); expect(d.paxE / d.seatsE).toBeGreaterThan(0.9);
  });
  it('노선 별명: 16자까지, 빈 값이면 지운다', () => {
    const g = new Game(3), r = fly(g, 'ICN', 'NRT', g.state.planes[0].id);
    g.setRouteName(r.id, '  효자 노선  '); expect(r.name).toBe('효자 노선');
    g.setRouteName(r.id, 'ㄱ'.repeat(30)); expect(r.name!.length).toBe(16);
    g.setRouteName(r.id, ' '); expect(r.name).toBeUndefined();
  });
  it('화물 목표: 지난달 화물 수익이 목표를 넘으면 달성', () => {
    const g = new Game(3, undefined, { scenario: 'cargo' });
    expect(g.goalProgress()[0]).toMatchObject({ label: '지난달 화물 수익', done: false, unit: 'M' });
    g.state.history.push({ month: 1, revenue: 0, cost: 0, depreciation: 0, fixed: 0, interest: 0, cargo: 99, profit: 0, pax: 0, seats: 0, loadFactor: 0, cash: 0 });
    expect(g.goalProgress()[0].done).toBe(true);
  });
  it('회사 업그레이드: 단계마다 비싸지고 3단계까지, 현금이 모자라면 거절', () => {
    const g = new Game(3); g.state.cash = 30;
    expect(g.upgradePrice('ops')).toBe(config.upgrades.prices[0]);
    expect(g.buyUpgrade('ops').ok).toBe(true); expect(g.state.cash).toBe(30 - config.upgrades.prices[0]); expect(g.upgradeLevel('ops')).toBe(1);
    expect(g.buyUpgrade('ops').ok).toBe(true);
    expect(g.buyUpgrade('ops').ok).toBe(false); // 3단계 값이 모자람
    g.state.cash = 100; expect(g.buyUpgrade('ops').ok).toBe(true);
    expect(g.upgradePrice('ops')).toBeNull(); expect(g.buyUpgrade('ops').ok).toBe(false);
    expect(g.buyUpgrade('없음').ok).toBe(false);
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON()))); expect(back.upgradeLevel('ops')).toBe(3);
  });
  it('회사 업그레이드 효과: 마케팅은 수요를, 운항 최적화는 비용을, 기내 서비스는 비즈니스 수요를, 격납고는 닳는 속도와 점검비를 바꾼다', () => {
    const mk = () => { const g = new Game(3); g.state.cash = 500; const r = fly(g, 'ICN', 'NRT', g.state.planes[0].id); g.setCabin(g.state.planes[0].id, 0.2); return { g, r }; };
    const base = mk(), d0 = base.g.routeDay(base.r);
    const a = mk(); a.g.buyUpgrade('marketing'); expect(a.g.routeDay(a.r).demandE).toBeCloseTo(d0.demandE * 1.04, 6);
    const b = mk(); b.g.buyUpgrade('ops'); const db = b.g.routeDay(b.r); expect(db.cost - db.compensation).toBeCloseTo((d0.cost - d0.compensation) * 0.97, 6);
    const c = mk(); c.g.buyUpgrade('service'); expect(c.g.routeDay(c.r).demandB).toBeCloseTo(d0.demandB * 1.1, 6); expect(c.g.routeDay(c.r).demandE).toBeCloseTo(d0.demandE, 6);
    const h = mk(), p0 = base.g.state.planes[0], ph = h.g.state.planes[0]; h.g.buyUpgrade('hangar');
    expect(h.g.serviceCost(ph)).toBeCloseTo(base.g.serviceCost(p0) * 0.85, 6);
    base.g.advanceDays(30); h.g.advanceDays(30);
    expect(1 - ph.cond).toBeCloseTo((1 - p0.cond) * 0.75, 6);
  });
  it('회사 업그레이드 효과: 지상 조업은 지연을 줄인다', () => {
    const g = new Game(3), r = fly(g, 'ICN', 'NRT', g.state.planes[0].id); g.state.planes[0].cond = 0.2; g.state.cash = 50;
    const before = g.routeOtp(r); expect(before).toBeLessThan(1);
    g.buyUpgrade('ground');
    expect(1 - g.routeOtp(r)).toBeCloseTo((1 - before) * 0.8, 6);
  });
});
