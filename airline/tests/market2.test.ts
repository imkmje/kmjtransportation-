import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const rival = (g: Game, extra: object = {}) => { g.state.competitors.push({ id: 90, name: '시험항공', style: 'low', hub: 'HKG', cash: 50, planes: 5, routes: [{ a: 'HKG', b: 'SIN', seatsDay: 300, fareRatio: 1 }], low: 0, ...extra } as never); return g.state.competitors.at(-1)!; };

describe('경쟁사 인수', () => {
  it('인수하면 회사가 사라지고 항공기·슬롯·평판을 받는다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 500; const k = rival(g), price = g.acquirePrice(k), planes0 = g.state.planes.length, rep0 = g.state.reputation;
    const r = g.acquireCompetitor(90); expect(r.ok).toBe(true);
    expect(g.state.competitors.some((c) => c.id === 90)).toBe(false);
    expect(g.state.cash).toBeCloseTo(500 - price, 6); expect(g.state.planes.length).toBe(planes0 + 5);
    expect(g.state.slots.HKG).toBe(config.acquire.slots); expect(g.state.reputation).toBeGreaterThan(rep0 - 1e-9);
    expect(g.state.rivalsGone.at(-1)).toMatchObject({ name: '시험항공', acq: true });
  });
  it('자금난이면 싸고, 대형·현금 부족은 거절된다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 500; const k = rival(g), normal = g.acquirePrice(k); k.low = 2;
    expect(g.acquirePrice(k)).toBeLessThan(normal);
    g.state.cash = 1; expect(g.acquireCompetitor(90).ok).toBe(false);
    g.state.cash = 500; k.major = true; expect(g.acquireCompetitor(90).ok).toBe(false);
  });
});

describe('노선 폐지와 재개', () => {
  it('운항하던 노선을 닫으면 평판이 떨어지고, 6개월 안에 다시 열면 비용이 든다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 300; g.state.reputation = 0.5;
    const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error('open'); g.buyForRoute(o.routeId, 'B737', 'new');
    g.closeRoute(o.routeId); expect(g.state.reputation).toBeCloseTo(0.5 - config.reopen.rep, 9);
    const c0 = g.state.cash; expect(g.openRoute('ICN', 'NRT').ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - config.reopen.fee, 9);
    g.closeRoute(o.routeId); g.advanceDays(30 * config.reopen.months + 1);
    const c1 = g.state.cash; g.openRoute('ICN', 'NRT'); expect(g.state.cash).toBeGreaterThan(c1 - 1e-9 - 5); // 6개월이 지나면 재개 비용 없음(월 정산은 별개)
    expect(g.route(o.routeId)!.closed).toBeUndefined();
  });
  it('현금이 모자라면 재개가 거절된다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 300;
    const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error('open'); g.closeRoute(o.routeId); g.state.cash = 0.5;
    expect(g.openRoute('ICN', 'NRT').ok).toBe(false);
  });
});

describe('연료 계약 기간', () => {
  it('3·6·12개월을 고르고 비용이 다르다', () => {
    for (const t of config.fuel.hedgeTiers) {
      const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 50; const c0 = g.state.cash;
      expect(g.hedgeFuel(t.months).ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - t.cost, 9); expect(g.state.hedge!.monthsLeft).toBe(t.months);
    }
    expect(new Game(1).hedgeFuel(5).ok).toBe(false);
  });
});

describe('허브 환승', () => {
  it('via로 특정 도시를 거치는 환승만 센다', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 800;
    for (const [a, b] of [['ICN', 'NRT'], ['ICN', 'SIN']] as const) { const o = g.openRoute(a, b); if (o.ok) g.buyForRoute(o.routeId, 'B737', 'new'); }
    const r = g.state.routes[0], all = g.transferDemand(r), viaIcn = g.transferDemand(r, 'ICN'), viaNrt = g.transferDemand(r, 'NRT');
    expect(viaIcn).toBeGreaterThan(0); expect(viaNrt).toBe(0); expect(all).toBeCloseTo(viaIcn + viaNrt, 6);
  });
});

describe('대형 항공사 노선 확장', () => {
  it('거점 여러 곳에서 장거리 노선을 열어 노선이 11개 언저리에서 멈추지 않는다', () => {
    const g = new Game(5, undefined, { sandbox: true }); g.state.cash = 9000; for (let i = 0; i < 60; i++) g.buyPlane('B737'); // 사진 속 판처럼 내 기단이 크면 대형 항공사도 크게(항공기 최대 45대)
    g.advanceDays(30 * 120); // 10년
    const majors = g.state.competitors.filter((c) => c.major); expect(majors.length).toBeGreaterThanOrEqual(1);
    const gs = majors.find((c) => c.name === config.competitors.major.name)!;
    expect(gs.routes.length).toBeGreaterThan(11);
    expect(new Set(gs.routes.map((r) => r.a)).size).toBeGreaterThan(1); // 허브 한 곳에서만 나가지 않는다
  });
});

describe('대형 항공사 견제', () => {
  const setup = () => { const g = new Game(5, undefined, { sandbox: true }); g.state.cash = 2000; g.state.competitors.push({ id: 77, name: '시험 대형', style: 'premium', hub: 'DXB', cash: 50, planes: 20, routes: [{ a: 'DXB', b: 'LHR', seatsDay: 900, fareRatio: 1.15, war: 2 }], major: true, revHist: Array(12).fill(50) }); return g; };
  it('지분은 5%씩 10%까지, 배당이 들어오고 진출·운임 전쟁 확률이 줄며, 팔면 돈이 돌아온다', () => {
    const g = setup(), k = g.state.competitors.find((c) => c.id === 77)!;
    expect(g.majorDamp(k)).toBe(1); const p = g.majorStakePrice(k), c0 = g.state.cash;
    expect(g.buyMajorStake(77).ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - p, 6); expect(g.majorDamp(k)).toBeCloseTo(0.65, 6);
    const p2 = g.majorStakePrice(k); expect(p2).toBeGreaterThan(p); // 살수록 비싸진다
    expect(g.buyMajorStake(77).ok).toBe(true); expect(g.majorDamp(k)).toBeCloseTo(0.3, 6);
    const r0 = g.state.cur.revenue; (g as unknown as { majorDividends(): void }).majorDividends(); expect(g.state.cur.revenue - r0).toBeCloseTo(50 * 0.08 * 0.1, 6);
    for (let i = 0; i < 4; i++) expect(g.buyMajorStake(77).ok).toBe(true); expect(g.buyMajorStake(77).ok).toBe(false); expect(g.majorDamp(k)).toBeCloseTo(0.3, 6); // 30%까지, 확률 감소는 최대 70%
    const c1 = g.state.cash; expect(g.sellMajorStake(77).ok).toBe(true); expect(g.state.cash).toBeGreaterThan(c1); expect(g.majorDamp(k)).toBe(1);
    expect(g.buyMajorStake(1).ok).toBe(false); // 대형이 아니면 안 됨
    expect(new Game(5).buyMajorStake(77).ok).toBe(false); // 시나리오는 안 됨
  });
  it('반독점 제소: 12개월간 멈추고(운임 전쟁도 끝), 36개월 동안 다시 못 한다', () => {
    const g = setup(), k = g.state.competitors.find((c) => c.id === 77)!;
    expect(g.antitrust(77).ok).toBe(true); expect(g.majorFrozen(k)).toBe(true); expect(g.majorDamp(k)).toBe(0); expect(k.routes[0].war).toBe(0);
    expect(g.antitrust(77).ok).toBe(false);
    const n0 = k.planes; g.advanceDays(30 * 6); expect(k.planes).toBe(n0); // 제재 중에는 크지 않는다
    g.advanceDays(30 * 7); expect(g.majorFrozen(k)).toBe(false); expect(g.antitrust(77).ok).toBe(false); // 아직 36개월 안
  });
  it('이사회 의석(20% 이상): 12개월에 한 번 내 노선 진출을 막는다', () => {
    const g = setup(), k = g.state.competitors.find((c) => c.id === 77)!; g.state.cash = 99999;
    const o = g.openRoute('DXB', 'LHR'); if (!o.ok) throw new Error(o.error); g.buyForRoute(o.routeId, 'A330N', 'new');
    expect(g.majorVetoReady(k)).toBe(false); for (let i = 0; i < 4; i++) g.buyMajorStake(77); expect(g.majorVetoReady(k)).toBe(true);
    k.routes = []; config.competitors.major.invadeChance = 100; // 진출을 반드시 시도하게(지분 때문에 확률이 줄어도)
    try { (g as unknown as { compBuy(c: unknown, m: number, f: boolean): void }).compBuy(k, g.month, true); } finally { config.competitors.major.invadeChance = 0.15; }
    expect(k.routes.some((r) => (r.a === 'DXB' && r.b === 'LHR') || (r.a === 'LHR' && r.b === 'DXB'))).toBe(false); expect(g.majorVetoReady(k)).toBe(false); expect(g.state.log.at(-1)).toContain('거부권');
  });
  it('거점 공항 운영권: 입찰을 열 수 있고, 내 운영권이면 대형 항공사 매출이 줄어 그만큼 내 수입이 되며 잃은 매출로 기록된다', () => {
    const g = setup(), k = g.state.competitors.find((c) => c.id === 77)!; k.name = config.competitors.major.name; g.state.bids = [];
    expect(g.openHubBid(77, 'DXB').ok).toBe(true); expect(g.state.bids![0].city).toBe('DXB'); expect(g.openHubBid(77, 'FRA').ok).toBe(false); // 한 번에 하나
    expect(g.openHubBid(77, 'ICN').ok).toBe(false); // 거점이 아님
    g.state.bids = []; g.state.concessions = { DXB: { holder: 0, until: g.monthsPassed + 60 } };
    const c0 = g.state.cash; (g as unknown as { competitorStep(): void }).competitorStep();
    expect(k.lostNow!.fee).toBeGreaterThan(0); expect(k.lostHist!.at(-1)).toBeCloseTo(k.lostNow!.fee + k.lostNow!.alli + k.lostNow!.suit, 2);
    expect(k.lostHist!.length).toBe(k.revHist!.length); expect(g.state.cash).toBeGreaterThan(c0 - 1e-9);
  });
  it('동맹 공동 대응 안건: 운임 전쟁 0, 진출 절반', () => {
    const g = setup(), k = g.state.competitors.find((c) => c.id === 77)!; g.state.alliance = [1];
    (g.state as { alli?: unknown }).alli = { name: '시험 동맹', meeting: { expires: g.monthsPassed + 2 } };
    expect(g.chooseAgenda('defend').ok).toBe(true); expect(g.majorDamp(k, 'war')).toBe(0); expect(g.majorDamp(k)).toBeCloseTo(0.5, 6);
  });
});
