import { describe, it, expect } from 'vitest';
import { config } from '../src/config';
import { CITIES, cityById, typeById } from '../src/data';
import { Game } from '../src/sim/game';
import { advise } from '../src/sim/advice';
import { distanceKm, maxWeeklyRoundTrips } from '../src/sim/model';

const open = (g: Game, a: string, b: string) => { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); return o.routeId; };

describe('노후 정비 상한·교체 권고', () => {
  it('7년이 넘으면 점검해도 상한까지만 회복되고, 낡을수록 점검이 비싸다', () => {
    const g = new Game(3); g.state.cash = 100; const p = g.state.planes[0];
    expect(g.maxCond(p)).toBe(1);
    p.age = 84 + 50; // 50개월 초과: 상한 80%
    expect(g.maxCond(p)).toBeCloseTo(1 - 50 * config.aging.capPerMonth, 9);
    p.cond = 0.3;
    const cost = g.serviceCost(p); expect(cost).toBeCloseTo(Math.max(config.maint.minCost, typeById(p.type).price * config.maint.costRatio) * g.agingMult(p), 9);
    const r = g.service(p.id); expect(r.ok).toBe(true);
    expect(p.cond).toBeCloseTo(g.maxCond(p), 9);
    p.shop = 0;
    const again = g.service(p.id); expect(again.ok).toBe(false); if (!again.ok) expect(again.error).toContain('넘게 회복할 수 없습니다'); // 상한까지 이미 회복
    p.age = 9999; expect(g.maxCond(p)).toBe(config.aging.capMin);
  });
  it('교체 권고: 상한이 75% 아래인 기체만, 조언에도 뜬다', () => {
    const g = new Game(3), p = g.state.planes[0];
    expect(g.needsReplacement(p)).toBe(false);
    p.age = 84 + 70; // 상한 72%
    expect(g.needsReplacement(p)).toBe(true);
    expect(advise(g).some((a) => a.text.includes('팔고 새로 사는 편'))).toBe(true);
    const u = new Game(3); u.state.cash = 100; const r = u.buyPlane('B737', true); if (!r.ok) throw new Error(r.error);
    expect(u.needsReplacement(u.plane(r.planeId)!)).toBe(false); // 중고기(8년)는 막 상한이 내려가기 시작한 정도
    expect(u.maxCond(u.plane(r.planeId)!)).toBeLessThan(1);
  });
});

describe('슬롯 구매와 배정', () => {
  /** 서울–제주에 B737 두 대: 첫 대를 최대 횟수로 배정해 두면 둘째 대는 제주 슬롯이 모자란다 */
  const crowd = () => {
    const g = new Game(3); g.state.cash = 500;
    const rid = open(g, 'ICN', 'CJU'), max = maxWeeklyRoundTrips(distanceKm(cityById('ICN'), cityById('CJU')), typeById('B737'));
    expect(g.assign(g.state.planes[0].id, rid, max).ok).toBe(true);
    const b = g.buyPlane('B737'); if (!b.ok) throw new Error(b.error);
    return { g, rid, weekly: max, second: b.planeId };
  };
  it('모자라는 슬롯 수와 비용이 실제 구매와 같다', () => {
    const { g, rid, weekly, second } = crowd();
    const sf = g.slotShortfall(second, rid, weekly);
    expect(sf.needs.length).toBeGreaterThan(0); expect(sf.cost).toBeGreaterThan(0);
    const before = g.state.cash;
    for (const { city, n } of sf.needs) for (let i = 0; i < n; i++) expect(g.buySlot(city).ok).toBe(true);
    expect(before - g.state.cash).toBeCloseTo(sf.cost, 9);
    expect(g.assign(second, rid, weekly).ok).toBe(true);
  });
  it('assignBuyingSlots: 필요한 만큼 사고 배정하며, 현금이 모자라면 아무것도 사지 않는다', () => {
    const { g, rid, weekly, second: id } = crowd();
    g.state.cash = 0.1; const slots = JSON.stringify(g.state.slots);
    const bad = g.assignBuyingSlots(id, rid, weekly); expect(bad.ok).toBe(false);
    expect(JSON.stringify(g.state.slots)).toBe(slots); expect(g.state.cash).toBe(0.1);
    g.state.cash = 500;
    const sf = g.slotShortfall(id, rid, weekly), r = g.assignBuyingSlots(id, rid, weekly);
    expect(r.ok).toBe(true); if (r.ok) expect(r.slotCost).toBeCloseTo(sf.cost, 9);
    expect(g.plane(id)!.weekly).toBe(weekly); expect(g.state.cash).toBeCloseTo(500 - sf.cost, 9);
  });
  it('슬롯이 충분하면 아무것도 사지 않고 바로 배정한다', () => {
    const g = new Game(3), rid = open(g, 'ICN', 'NRT'), cash = g.state.cash, r = g.assignBuyingSlots(g.state.planes[0].id, rid, 3);
    expect(r.ok).toBe(true); if (r.ok) expect(r.slotCost).toBe(0); expect(g.state.cash).toBe(cash);
  });
});

describe('노선 화면에서 바로 구매·추천', () => {
  it('기종 목록: 날 수 있는 기종만, 계산이 게임 상태를 바꾸지 않는다', () => {
    const g = new Game(3); const rid = open(g, 'ICN', 'LAX'); g.state.cash = 500;
    const snap = JSON.stringify(g.state);
    const opts = g.routeOptions(rid);
    expect(JSON.stringify(g.state)).toBe(snap);
    const ids = opts.map((o) => o.type);
    expect(ids).not.toContain('T72'); expect(ids).toContain('A350'); // 터보프롭은 태평양을 못 건넌다
    for (const o of opts) expect(o.weekly).toBe(maxWeeklyRoundTrips(distanceKm(cityById('ICN'), cityById('LAX')), typeById(o.type)));
  });
  it('추천은 정확히 하나이고 회수 기간이 가장 짧은 기종이다(이익이 나는 기종이 없으면 없음)', () => {
    const g = new Game(3); const rid = open(g, 'ICN', 'NRT'); g.state.cash = 500;
    const opts = g.routeOptions(rid), rec = opts.filter((o) => o.recommended);
    const paying = opts.filter((o) => o.payback !== null);
    expect(paying.length).toBeGreaterThan(0); expect(rec.length).toBe(1);
    expect(rec[0].payback).toBe(Math.min(...paying.map((o) => o.payback!)));
    for (const o of opts) expect(o.payback === null || Math.abs(o.payback - o.price / o.profit) < 1e-9).toBe(true);
    // 수요가 거의 없는 노선에 큰 비행기를 더하면 이익이 줄어 추천에서 빠진다
    const small = open(g, 'ADD', 'SCL');
    const o2 = g.routeOptions(small); const big = o2.find((o) => o.type === 'A380');
    if (big) expect(big.profit).toBeLessThan(o2.find((o) => o.type === 'A350')!.profit + 1e-9);
  });
  it('이미 비행기가 가득 찬 노선에 한 대 더: 새 비행기의 이익은 첫 비행기보다 작다(손님을 나눠 갖는다)', () => {
    const g = new Game(3); const rid = open(g, 'ICN', 'CJU'); g.state.cash = 500;
    const first = g.routeOptions(rid).find((o) => o.type === 'B737')!;
    const a = g.assignBuyingSlots(g.state.planes[0].id, rid, 14); expect(a.ok).toBe(true);
    const second = g.routeOptions(rid).find((o) => o.type === 'B737')!;
    expect(second.profit).toBeLessThan(first.profit);
  });
  it('buyForRoute: 새것·중고·임대 각각 돈이 맞게 나가고 이 노선에 최대 횟수로 배정된다', () => {
    for (const how of ['new', 'used', 'lease'] as const) {
      const g = new Game(3); g.state.cash = 500; const rid = open(g, 'ICN', 'NRT'), cash = g.state.cash;
      const plan = g.purchasePlan(rid, 'B737', how); if (!plan.ok) throw new Error(plan.error);
      const r = g.buyForRoute(rid, 'B737', how); if (!r.ok) throw new Error(r.error);
      const p = g.plane(r.planeId)!;
      expect(p.routeId).toBe(rid); expect(p.weekly).toBe(plan.weekly); expect(p.leased === true).toBe(how === 'lease');
      expect(cash - g.state.cash).toBeCloseTo(plan.total, 6);
    }
  });
  it('buyForRoute: 슬롯이 모자라면 같이 사고, 현금·임대 한도·기종 제한은 거절한다', () => {
    const g = new Game(3); g.state.cash = 500; const rid = open(g, 'ICN', 'PUS');
    const cap = Math.min(g.slotCapacity('ICN'), g.slotCapacity('PUS'));
    for (let i = 0; i < 6; i++) g.buyForRoute(rid, 'T72', 'new'); // 같은 노선에 계속 넣으면 어느 순간 슬롯이 모자란다
    expect(g.state.planes.length).toBe(7);
    expect(Object.values(g.state.slots).reduce((a, n) => a + n, 0)).toBeGreaterThan(0);
    expect(g.slotsUsed('ICN')).toBeLessThanOrEqual(g.slotCapacity('ICN') + 1e-9); expect(cap).toBeGreaterThan(0);
    const poor = new Game(3); poor.state.cash = 1; const r2 = open(poor, 'ICN', 'NRT');
    const e = poor.buyForRoute(r2, 'B737', 'new'); expect(e.ok).toBe(false); expect(poor.state.planes.length).toBe(1);
    expect(poor.buyForRoute(open(poor, 'ICN', 'LAX'), 'T72', 'new').ok).toBe(false); // 항속 부족
    const L = new Game(3); L.state.cash = 500; const r3 = open(L, 'ICN', 'NRT');
    for (let i = 0; i < 3; i++) expect(L.buyForRoute(r3, 'T72', 'lease').ok).toBe(true);
    expect(L.buyForRoute(r3, 'T72', 'lease').ok).toBe(false); // 내 항공기 1대 + 2대까지
  });
});

describe('자유 모드·경쟁사', () => {
  it('자유 모드로 시작하면 목표·기한이 없어 오래 지나도 끝나지 않는다', () => {
    const g = new Game(3, undefined, { sandbox: true });
    expect(g.state.sandbox).toBe(true); expect(g.state.cash).toBe(20);
    g.state.cash = 9999; g.advanceDays(30 * 60);
    expect(g.state.status).toBe('playing');
    const goal = new Game(3); goal.state.cash = 9999; goal.advanceDays(30 * 25);
    expect(goal.state.status).toBe('timeup');
  });
  it('처음에는 경쟁사 2곳뿐이고, 이름·거점이 서로 다르며 모두 실제 도시', () => {
    const g = new Game(3);
    expect(g.state.competitors.length).toBe(config.competitors.start); expect(config.competitors.start).toBe(2);
    expect(new Set(g.state.competitors.map((k) => k.name)).size).toBe(2); expect(new Set(g.state.competitors.map((k) => k.hub)).size).toBe(2);
    for (const k of g.state.competitors) expect(CITIES.some((c) => c.id === k.hub)).toBe(true);
    expect(g.state.nextRival).toBe(3); expect(g.state.rivalsGone).toEqual([]);
  });
  const run = (seed: number, months: number) => { const g = new Game(seed, undefined, { sandbox: true }); g.state.cash = 99999; const counts: number[] = []; for (let m = 0; m < months; m++) { g.advanceDays(30); counts.push(g.state.competitors.length); } return { g, counts }; };
  it('시간이 지나면 신생 항공사가 생기고, 동시에 max곳을 넘지 않으며 ID·이름이 겹치지 않는다', () => {
    const { g, counts } = run(5, 60);
    expect(g.state.log.some((l) => l.includes('신생 항공사'))).toBe(true);
    expect(Math.max(...counts)).toBeGreaterThan(config.competitors.start); expect(Math.max(...counts)).toBeLessThanOrEqual(config.competitors.max);
    const ids = g.state.competitors.map((c) => c.id); expect(new Set(ids).size).toBe(ids.length);
    const names = g.state.competitors.map((c) => c.name); expect(new Set(names).size).toBe(names.length);
    expect(g.state.nextRival).toBeGreaterThan(Math.max(...ids));
    expect(g.state.competitors.filter((c) => (c.born ?? 0) > 0).every((c) => (c.born ?? 0) >= config.competitors.entryMinMonth - 1)).toBe(true); // 너무 이른 시기에는 생기지 않는다
  });
  it('현금이 마이너스인 채 석 달이 지나면 파산해 사라지고, 제휴·기록이 정리된다', () => {
    const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 99999;
    const k = g.state.competitors[1], id = k.id, name = k.name;
    g.setAlly(id); expect(g.state.ally).toBe(id);
    k.cash = -500; k.low = config.competitors.bankruptMonths - 1; // 곧 파산할 상태(이번 달에도 마이너스)
    g.advanceDays(31);
    expect(g.state.competitors.some((c) => c.id === id)).toBe(false);
    expect(g.state.ally).toBeNull();
    expect(g.state.rivalsGone.some((x) => x.name === name)).toBe(true);
    expect(g.state.log.some((l) => l.includes(name) && l.includes('파산했습니다'))).toBe(true);
  });
  it('현금이 마이너스여도 석 달이 안 됐고 곧 회복하면 파산하지 않는다', () => {
    const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 99999;
    const k = g.state.competitors[0]; k.cash = -0.01; k.low = 0;
    g.advanceDays(31); // 한 달 이익으로 현금이 다시 0 위로 오른다
    expect(g.state.competitors.some((c) => c.id === k.id)).toBe(true);
  });
  it('몇 해를 돌리면 신생과 파산이 모두 일어나고, 경쟁사가 영영 0곳이 되지 않는다', () => {
    let gone = 0, born = 0;
    for (const seed of [1, 2, 3, 4]) { const { g, counts } = run(seed, 96); gone += g.state.log.filter((l) => l.includes('파산했습니다') && !l.startsWith('파산')).length; born += g.state.log.filter((l) => l.includes('신생 항공사')).length; expect(counts.slice(12).every((n) => n >= 1)).toBe(true); }
    expect(born).toBeGreaterThan(4); expect(gone).toBeGreaterThan(0);
  });
  it('같은 시드면 경쟁사의 생성·파산 순서도 같다(결정론)', () => {
    const a = run(7, 48), b = run(7, 48);
    expect(a.counts).toEqual(b.counts); expect(a.g.state.competitors.map((c) => c.name)).toEqual(b.g.state.competitors.map((c) => c.name));
  });
  it('형식 9 저장 파일(경쟁사 6곳)은 그대로 읽고 ID 카운터·파산 기록을 채운다', () => {
    const g = new Game(3, undefined, { sandbox: true });
    for (let i = 3; i <= 6; i++) g.state.competitors.push({ id: i, name: `옛경쟁사${i}`, style: 'low', hub: 'KIX', cash: 50, planes: 1, routes: [] });
    const old = g.toJSON() as unknown as Record<string, unknown>; old.formatVersion = 9; delete old.nextRival; delete old.rivalsGone;
    const back = Game.fromJSON(old);
    expect(back.state.competitors.length).toBe(6); expect(back.state.nextRival).toBe(7); expect(back.state.rivalsGone).toEqual([]);
    expect(back.state.formatVersion).toBe(10);
  });
});
