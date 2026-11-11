import { describe, it, expect } from 'vitest';
import { config } from '../src/config';
import { AIRCRAFT, EVENTS, cityById, typeById } from '../src/data';
import { Game } from '../src/sim/game';
import { advise } from '../src/sim/advice';
import { achieved } from '../src/sim/achievements';

const sandbox = (seed = 3) => { const g = new Game(seed, undefined, { sandbox: true }); g.state.cash = 99999; return g; };
const open = (g: Game, a: string, b: string) => { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); return o.routeId; };

describe('기종 다양화와 신기종 출시', () => {
  it('데이터: 13종, ID·이름이 겹치지 않고 값이 올바르며, 신기종은 출시 개월이 있다', () => {
    expect(AIRCRAFT.length).toBe(13);
    expect(new Set(AIRCRAFT.map((t) => t.id)).size).toBe(13); expect(new Set(AIRCRAFT.map((t) => t.name)).size).toBe(13);
    for (const t of AIRCRAFT) { expect(t.seats).toBeGreaterThanOrEqual(0); expect(t.price).toBeGreaterThan(0); expect(t.range).toBeGreaterThan(500); expect(t.runway).toBeGreaterThan(500); expect(t.speed).toBeGreaterThan(300); expect(t.hourly).toBeGreaterThan(0); expect(t.cargo).toBeGreaterThan(0); }
    const later = AIRCRAFT.filter((t) => (t.from ?? 0) > 0).map((t) => t.id).sort();
    expect(later).toEqual(['A321XLR', 'B737NX', 'B757', 'B787', 'F330']);
    // 신형은 같은 좌석당 운영비가 더 낮다
    const perSeat = (id: string) => typeById(id).hourly / typeById(id).seats;
    expect(perSeat('B737NX')).toBeLessThan(perSeat('B737')); expect(perSeat('B787')).toBeLessThan(perSeat('A350'));
  });
  it('출시 전 기종은 사지도 빌리지도 못하고, 출시 개월이 지나면 가능하다. 이미 가진 기종은 항상 가능', () => {
    const g = sandbox();
    expect(g.isAvailable('B787')).toBe(false);
    const buy = g.buyPlane('B787'); expect(buy.ok).toBe(false); if (!buy.ok) expect(buy.error).toContain('24개월차 출시');
    expect(g.leasePlane('B787').ok).toBe(false);
    expect(g.upcomingTypes().map((t) => t.id)).toEqual(['B757', 'F330', 'B787', 'B737NX', 'A321XLR']);
    const rid = open(g, 'ICN', 'LAX');
    expect(g.routeOptions(rid).map((o) => o.type)).not.toContain('B787'); expect(g.purchasePlan(rid, 'B787', 'new').ok).toBe(false);
    g.advanceDays(30 * 24);
    expect(g.isAvailable('B787')).toBe(true); expect(g.buyPlane('B787').ok).toBe(true);
    expect(g.upcomingTypes().map((t) => t.id)).toEqual(['B737NX', 'A321XLR']);
    // 시나리오가 주는 시작 기종은 처음부터 가능(화물 전문의 F7-77)
    expect(new Game(1, undefined, { scenario: 'cargo' }).isAvailable('F77')).toBe(true);
  });
  it('신기종은 6개월 전에 발표하고 때가 되면 출시한다', () => {
    const g = sandbox();
    g.advanceDays(30 * 6 + 1); expect(g.state.log.some((l) => l.includes('신기종 발표') && l.includes('보임 B7-57'))).toBe(true);
    expect(g.state.log.some((l) => l.includes('신기종 출시'))).toBe(false);
    g.advanceDays(30 * 6); expect(g.state.log.some((l) => l.includes('신기종 출시') && l.includes('보임 B7-57'))).toBe(true);
  });
  it('새 기종을 사면 "신형기 도입" 업적', () => {
    const g = sandbox(); expect(achieved(g)).not.toContain('newgen');
    g.advanceDays(30 * 12 + 1); g.buyPlane('B757'); expect(achieved(g)).toContain('newgen');
  });
});

describe('사건 대응 비용은 점점 오른다', () => {
  const fuel = EVENTS.find((e) => e.id === 'fuel')!;
  it('시작 때는 기본 비용, 시간이 지나고 항공기가 늘수록 오르며 상한이 있다', () => {
    const g = sandbox(); const base = fuel.option!.cost;
    expect(g.eventCost(fuel)).toBeCloseTo(base, 9); // 0개월, 항공기 1대
    g.advanceDays(30 * 12);
    expect(g.eventCost(fuel)).toBeCloseTo(base * (1 + config.events.costGrowth * g.monthsPassed), 9);
    const before = g.eventCost(fuel); for (let i = 0; i < 4; i++) g.buyPlane('T72');
    expect(g.eventCost(fuel)).toBeCloseTo(before * (1 + config.events.costPerPlane * 3), 9); // 항공기 5대: 기본 2대 초과분 3대
    g.advanceDays(30 * 120); expect(g.eventCost(fuel) / (1 + config.events.costPerPlane * 3)).toBeCloseTo(base * config.events.costMaxMult, 9);
  });
  it('대응하면 오른 비용만큼 현금이 나간다', () => {
    const g = sandbox(); g.advanceDays(30 * 20); g.state.events.push({ def: 'fuel', monthsLeft: 3 });
    const idx = g.state.events.length - 1, cash = g.state.cash, cost = g.eventCost(fuel);
    expect(cost).toBeGreaterThan(fuel.option!.cost);
    expect(g.respondEvent(idx).ok).toBe(true); expect(cash - g.state.cash).toBeCloseTo(cost, 9);
  });
});

describe('매출 순위', () => {
  it('우리와 경쟁사가 최근 12개월 매출로 정렬되고, 경쟁사 매출이 쌓인다', () => {
    const g = sandbox(); g.advanceDays(30 * 14);
    const r = g.ranking();
    expect(r.length).toBe(g.state.competitors.length + 1); expect(r.filter((x) => x.me).length).toBe(1);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].revenue).toBeGreaterThanOrEqual(r[i].revenue);
    expect(g.state.competitors.every((c) => (c.revHist?.length ?? 0) <= 12)).toBe(true);
    expect(g.state.competitors.some((c) => (c.revHist ?? []).some((v) => v > 0))).toBe(true);
    expect(g.rank()).toBe(r.findIndex((x) => x.me) + 1);
  });
  it('노선이 없으면 꼴찌, 큰 노선망을 운영하면 순위가 오른다', () => {
    const idle = sandbox(); idle.advanceDays(30 * 14); expect(idle.rank()).toBe(idle.state.competitors.length + 1);
    const g = sandbox(); const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 14);
    for (let i = 0; i < 4; i++) { const o = open(g, 'ICN', ['PEK', 'HKG', 'BKK', 'SIN'][i]); const b = g.buyForRoute(o, 'B737', 'new'); if (!b.ok) throw new Error(b.error); }
    g.advanceDays(30 * 14); expect(g.rank()).toBeLessThan(g.state.competitors.length + 1);
  });
});

describe('파산한 경쟁사의 경매', () => {
  const bankrupt = (g: Game, planes = 3) => { const k = g.state.competitors[1]; k.planes = planes; k.cash = -500; k.low = config.competitors.bankruptMonths - 1; g.advanceDays(31); return k; };
  it('파산하면 항공기가 최대 4대까지 40% 가격으로 경매에 나오고, 알림과 조언에 뜬다', () => {
    const g = sandbox(), k = bankrupt(g, 6);
    expect(g.state.auctions.length).toBe(config.auction.maxLots);
    const lot = g.state.auctions[0], price = Math.round(typeById('B737').price * config.auction.price * 10) / 10;
    expect(lot).toMatchObject({ from: k.name, type: 'B737', price, age: config.auction.age, cond: config.auction.cond });
    expect(g.state.log.some((l) => l.includes(k.name) && l.includes('경매'))).toBe(true);
    expect(advise(g).some((a) => a.text.includes('경매 중'))).toBe(true);
    expect(new Set(g.state.auctions.map((a) => a.id)).size).toBe(config.auction.maxLots);
  });
  it('항공기가 없는 경쟁사가 파산하면 경매가 없다', () => { const g = sandbox(); bankrupt(g, 0); expect(g.state.auctions.length).toBe(0); });
  it('낙찰: 돈을 내고 내 항공기가 되며(나이·정비 상태 반영), 현금이 모자라거나 이미 팔렸으면 거절', () => {
    const g = sandbox(); bankrupt(g, 2);
    const lot = g.state.auctions[0], cash = g.state.cash, n = g.state.planes.length;
    const r = g.buyAuction(lot.id); if (!r.ok) throw new Error(r.error);
    expect(g.state.cash).toBeCloseTo(cash - lot.price, 9); expect(g.state.planes.length).toBe(n + 1);
    const p = g.plane(r.planeId)!; expect(p).toMatchObject({ type: 'B737', age: config.auction.age, cond: config.auction.cond }); expect(p.leased).toBeFalsy(); expect(p.book).toBeCloseTo(lot.price, 9);
    expect(g.buyAuction(lot.id).ok).toBe(false);
    g.state.cash = 1; expect(g.buyAuction(g.state.auctions[0].id).ok).toBe(false); expect(g.buyAuction(999999).ok).toBe(false);
  });
  it('기간이 지나면 경매가 사라진다', () => {
    const g = sandbox(); bankrupt(g, 2); expect(g.state.auctions.length).toBe(2);
    g.advanceDays(30 * config.auction.months + 1); expect(g.state.auctions.length).toBe(0);
  });
  it('형식 10 저장 파일은 경매·예고 행사 없음으로 읽는다', () => {
    const g = sandbox(); const old = g.toJSON() as unknown as Record<string, unknown>; old.formatVersion = 10; delete old.auctions; delete old.upcoming;
    const back = Game.fromJSON(old); expect(back.state.auctions).toEqual([]); expect(back.state.upcoming).toEqual([]); expect(back.state.formatVersion).toBe(13);
  });
});

describe('예고된 행사', () => {
  const run = (seed: number, months: number) => { const g = sandbox(seed); const log: string[] = []; for (let m = 0; m < months; m++) { const n = g.state.log.length; g.advanceDays(30); log.push(...g.state.log.slice(n)); } return { g, log }; };
  it('예고 → 6개월 뒤 개막 → 수요 증가 효과, 예약 행사는 무작위 사건으로 뽑히지 않는다', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { g, log } = run(seed, 40);
      const announce = log.find((l) => /(올림픽|월드컵|대형 축제) 예고/.test(l)); if (!announce) continue; seen++;
      const m = Number(announce.match(/^(\d+)개월차/)![1]);
      const open = log.find((l) => /(올림픽|월드컵|대형 축제) 개막/.test(l) && Number(l.match(/^(\d+)개월차/)![1]) >= m);
      expect(open).toBeDefined(); expect(Number(open!.match(/^(\d+)개월차/)![1])).toBe(m + config.events.festivalLead);
      expect(g.state.upcoming.length).toBeLessThanOrEqual(1);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('개막한 행사는 개최 도시를 오가는 노선의 수요를 늘린다', () => {
    const g = sandbox(); const rid = open(g, 'ICN', 'LHR'); const r = g.route(rid)!;
    const before = g.routeDay(r);
    g.state.events.push({ def: 'olympic', monthsLeft: 2, city: 'LHR' });
    g.assign(g.state.planes[0].id, rid, 3);
    const d1 = g.routeDay(r); g.state.events.pop(); const d0 = g.routeDay(r);
    expect(d1.demand).toBeCloseTo(d0.demand * 1.4, 6); expect(before.demand).toBeGreaterThanOrEqual(0);
    expect(cityById('LHR').name).toBe('런던');
  });
  it('예약 행사 정의가 올바르다(개최지가 모두 실제 도시)', () => {
    const fest = EVENTS.filter((e) => e.scheduled); expect(fest.length).toBe(3);
    for (const f of fest) { expect(f.hosts!.length).toBeGreaterThan(3); for (const h of f.hosts!) expect(() => cityById(h)).not.toThrow(); expect(f.effect.routeDemand).toBeGreaterThan(0); }
  });
});
