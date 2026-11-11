import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const withRoute = (seed = 1, weekly = 20) => {
  const g = new Game(seed); const o = g.openRoute('ICN', 'CJU'); if (!o.ok) throw new Error(o.error);
  g.assign(g.state.planes[0].id, o.routeId, weekly);
  return { g, rt: g.route(o.routeId)!, id: o.routeId };
};

describe('정시율과 노선 우선순위', () => {
  it('여유가 있는 공항·좋은 정비 상태에서는 정시율 100%', () => {
    const { g, rt } = withRoute(1, 8);
    expect(g.routeOtp(rt)).toBe(1);
  });
  it('공항이 혼잡할수록, 정비 상태가 나쁠수록 정시율이 떨어진다(하한 있음)', () => {
    const { g, rt, id } = withRoute(1, 21); // 제주 하루 6편 / 한도 10 → 60%
    g.state.cash = 400; for (let i = 0; i < 3; i++) { const b = g.buyPlane('B737'); if (!b.ok) throw new Error(); g.assign((b as { planeId: number }).planeId, id, 21 - 0); }
    const lowUse = g.routeOtp(rt);
    while (g.slotsUsed('CJU') / g.slotCapacity('CJU') < 0.95) { const b = g.buyPlane('A220'); if (!b.ok) break; const r = g.assign((b as { planeId: number }).planeId, id, 5); if (!r.ok) break; }
    const crowded = g.routeOtp(rt); expect(crowded).toBeLessThan(lowUse);
    const bad = new Game(1), o = bad.openRoute('ICN', 'CJU'); if (!o.ok) throw new Error(); bad.assign(bad.state.planes[0].id, o.routeId, 8);
    const before = bad.routeOtp(bad.route(o.routeId)!); bad.state.planes[0].cond = 0.1;
    expect(bad.routeOtp(bad.route(o.routeId)!)).toBeLessThan(before);
    bad.state.planes[0].cond = 0; bad.state.events.push({ def: 'strike', monthsLeft: 2 }, { def: 'snow', monthsLeft: 1, city: 'CJU' });
    expect(bad.routeOtp(bad.route(o.routeId)!)).toBeGreaterThanOrEqual(config.delay.min);
  });
  it('우선순위가 높을수록 혼잡할 때 덜 지연되고, 등급당 월 수수료가 든다(기본 ★1은 무료)', () => {
    const { g, rt, id } = withRoute(1, 21);
    g.state.cash = 800; while (g.slotsUsed('CJU') / g.slotCapacity('CJU') < 0.95) { const b = g.buyPlane('A220'); if (!b.ok) break; const r = g.assign((b as { planeId: number }).planeId, id, 5); if (!r.ok) break; }
    const f1 = g.fixedMonthly, o1 = g.routeOtp(rt);
    expect(g.setPriority(id, 3).ok).toBe(true);
    expect(g.routeOtp(rt)).toBeGreaterThan(o1);
    expect(g.fixedMonthly).toBeCloseTo(f1 + 2 * config.delay.priorityFee, 9);
    expect(g.setPriority(id, 4)).toEqual({ ok: false, error: '우선순위는 1~3입니다' });
    expect(g.setPriority(999, 2).ok).toBe(false);
  });
  it('정시율이 낮으면 수요가 줄고 보상금이 나가 이익이 줄어든다', () => {
    const { g, rt } = withRoute(1, 20);
    const good = g.routeDay(rt); expect(good.compensation).toBe(0);
    g.state.planes[0].cond = 0; const bad = g.routeDay(rt);
    expect(bad.otp).toBeLessThan(good.otp); expect(bad.demand).toBeLessThan(good.demand); expect(bad.compensation).toBeGreaterThan(0);
    expect(bad.revenue - bad.cost).toBeLessThan(good.revenue - good.cost);
  });
  it('평판은 탑승률과 정시율 모두의 영향을 받는다', () => {
    const a = withRoute(1, 20).g, b = withRoute(1, 20).g;
    b.state.planes[0].cond = 0.2; // 정비를 안 한 쪽
    a.state.reputation = 0.5; b.state.reputation = 0.5;
    a.advanceDays(30); b.advanceDays(30);
    expect(a.state.reputation).toBeGreaterThan(b.state.reputation);
  });
  it('일일 기록에 정시율이 남는다', () => {
    const { g, rt } = withRoute(1, 20); g.advanceDays(3);
    expect(rt.daily.at(-1)!.otp).toBeGreaterThan(0);
  });
});

describe('저장 형식 7', () => {
  it('형식 6 파일은 노선 우선순위 ★1로 변환된다', () => {
    const { g } = withRoute(4); g.advanceDays(40);
    const v6 = JSON.parse(JSON.stringify(g.toJSON())); v6.formatVersion = 6; for (const r of v6.routes) delete r.priority;
    const back = Game.fromJSON(v6);
    expect(back.state.formatVersion).toBe(13); expect(back.state.routes[0].priority).toBe(1);
    back.advanceDays(60); expect(back.state.status).toBe('playing');
  });
});
