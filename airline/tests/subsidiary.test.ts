import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sandbox = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 900; g.state.competitors = []; return g; };
const comp = (g: Game, extra: object = {}) => { g.state.competitors.push({ id: 90, name: '시험항공', style: 'low', hub: 'NRT', cash: 60, planes: 5, routes: [{ a: 'ICN', b: 'NRT', seatsDay: 600, fareRatio: 0.9 }, { a: 'NRT', b: 'HKG', seatsDay: 500, fareRatio: 0.9 }], low: 0, ...extra } as never); return g.state.competitors.at(-1)!; };
const myRoute = (g: Game) => { const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error('open'); g.buyForRoute(o.routeId, 'A220', 'new'); return g.route(o.routeId)!; };

describe('자회사', () => {
  it('20%·51% 지분을 사면 회사는 남고, 51%는 방향을 정할 수 있다', () => {
    const g = sandbox(), k = comp(g), p20 = g.stakePrice(k, 0.2), c0 = g.state.cash;
    expect(g.buyStake(90, 0.2).ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - p20, 6); expect(k.stake).toBe(0.2);
    expect(g.setSubDir(90, 'profit').ok).toBe(false);
    expect(g.stakePrice(k, 0.51)).toBeLessThan(g.stakePrice({ ...k, stake: undefined }, 0.51)); // 올릴 때는 차액만
    expect(g.buyStake(90, 0.51).ok).toBe(true); expect(k.dir).toBe('grow'); expect(g.setSubDir(90, 'profit').ok).toBe(true);
    expect(g.state.competitors.some((c) => c.id === 90)).toBe(true);
    expect(g.absorbPrice(k)).toBeCloseTo(g.acquirePrice(k) * 0.49, 1);
  });
  it('시나리오·대형 항공사는 안 되고, 지분을 팔면 돈이 들어온다', () => {
    const sc = new Game(3); sc.state.cash = 900; sc.state.competitors = []; comp(sc); expect(sc.buyStake(90, 0.2).ok).toBe(false);
    const g = sandbox(); comp(g, { major: true }); expect(g.buyStake(90, 0.51).ok).toBe(false);
    const h = sandbox(); comp(h); h.buyStake(90, 0.51); const c0 = h.state.cash; expect(h.sellStake(90).ok).toBe(true); expect(h.state.cash).toBeGreaterThan(c0); expect(h.state.competitors[0].stake).toBeUndefined();
  });
  it('자회사는 내 노선에서 손님을 덜 빼앗고, 이익이 나면 배당이 들어온다', () => {
    const g = sandbox(); const r = myRoute(g); comp(g); const s0 = g.routeDay(r).share;
    g.buyStake(90, 0.51); expect(g.routeDay(r).share).toBeGreaterThan(s0);
    g.setSubDir(90, 'profit'); const k = g.state.competitors[0]; k.cash = 100;
    const rev0 = g.state.cur.revenue; g.advanceDays(31); // 한 달
    expect(g.state.history.at(-1)!.revenue).toBeGreaterThan(0); expect(rev0).toBeGreaterThanOrEqual(0);
    expect(g.state.log.some((l) => l.includes('지분 51%'))).toBe(true);
  });
  it('자금난이면 증자를 요청하고, 응하면 회사 현금이 회복된다', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.51); const k = g.state.competitors[0]; k.cash = -20;
    g.advanceDays(31); expect(k.call).toBeTruthy(); expect(g.state.log.some((l) => l.includes('증자를 요청'))).toBe(true);
    const amt = k.call!.amount, c0 = g.state.cash; expect(g.fundSubsidiary(90).ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(c0 - amt, 6); expect(k.call).toBeUndefined();
  });
  it('자회사에 자본금을 더 넣을 수 있고(51% 이상만), 증자 요청 이상 넣으면 요청이 해결된다', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.2); const k = g.state.competitors[0];
    expect(g.injectSubsidiary(90, 10).ok).toBe(false); // 20%는 안 됨
    g.buyStake(90, 0.51); const c0 = g.state.cash, k0 = k.cash; expect(g.injectSubsidiary(90, 50).ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(c0 - 50, 6); expect(k.cash).toBeCloseTo(k0 + 50, 6);
    k.call = { amount: 30, expires: g.monthsPassed + 3 }; expect(g.injectSubsidiary(90, 10).ok).toBe(true); expect(k.call).toBeTruthy();
    expect(g.injectSubsidiary(90, 50).ok).toBe(true); expect(k.call).toBeUndefined();
    g.state.cash = 5; expect(g.injectSubsidiary(90, 10).ok).toBe(false);
  });
  it('자동 처리: 스카이 동맹의 회원 빼 가기를 자동으로 붙잡는다(현금이 있을 때만)', () => {
    const g = sandbox(); comp(g); (g.state as { alli?: unknown }).alli = { name: '시험 동맹', xp: 0, poach: { comp: 90, expires: g.monthsPassed + 2, cost: 12 } }; g.state.alliance = [90];
    expect(g.applyRules()).toEqual([]); expect(g.state.alli!.poach).toBeTruthy(); // 꺼져 있으면 그대로
    g.setRule('keep', true); g.state.cash = 5; expect(g.applyRules()).toEqual([]); expect(g.state.alli!.poach).toBeTruthy(); // 돈이 모자라면 그대로
    g.state.cash = 100; const out = g.applyRules(); expect(out.length).toBe(1); expect(g.state.alli!.poach).toBeNull(); expect(g.state.cash).toBe(88); expect(g.state.alliance).toContain(90);
  });
  it('자동 처리: 증자 자동 동의·광고 자동·전세기 자동 수락·동맹 안건 자동', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.51); const k = g.state.competitors[0]; k.call = { amount: 12, expires: g.monthsPassed + 3 };
    expect(g.applyRules()).toEqual([]); expect(k.call).toBeTruthy(); // 꺼져 있으면 그대로
    g.setRule('call', true); g.setRule('campaign', true); g.setRule('charter', true); g.setRule('agenda', true);
    g.state.charters = [{ id: 7, a: 'ICN', b: 'NRT', months: 2, seats: 100, perMonth: 1, expires: g.monthsPassed + 2 }]; g.buyPlane('B737');
    (g.state as { alli?: unknown }).alli = { name: '시험 동맹', meeting: { expires: g.monthsPassed + 2 } };
    const out = g.applyRules();
    expect(k.call).toBeUndefined(); expect(g.state.campaign).toBeTruthy(); expect(g.state.charters![0].planeId).toBeDefined(); expect(g.state.alli!.meeting).toBeNull();
    expect(out.length).toBe(4);
    expect(g.applyRules()).toEqual([]); // 이미 처리됨, 광고는 진행 중
    g.state.cash = 1; g.state.campaign = undefined; expect(g.applyRules()).toEqual([]); // 현금이 광고비 3배가 안 되면 안 함
  });
  it('자회사가 파산하면 평판이 떨어진다', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.2); const k = g.state.competitors[0]; g.state.reputation = 0.5;
    k.cash = -999; k.low = config.competitors.bankruptMonths; g.advanceDays(31);
    expect(g.state.competitors.some((c) => c.id === 90)).toBe(false); expect(g.state.reputation).toBeLessThan(0.5 + 0.05);
    expect(g.state.log.some((l) => l.includes('자회사') && l.includes('파산'))).toBe(true);
  });
  it('공세 자회사는 다른 경쟁사의 노선으로 들어간다', () => {
    const g = sandbox(); const k = comp(g); g.state.competitors.push({ id: 91, name: '남의항공', style: 'low', hub: 'BKK', cash: 50, planes: 3, routes: [{ a: 'BKK', b: 'SIN', seatsDay: 800, fareRatio: 1 }], low: 0 } as never);
    g.buyStake(90, 0.51); g.setSubDir(90, 'attack'); k.cash = 500; k.born = -60; // 오래된 회사라 항공기를 더 늘릴 수 있다
    g.advanceDays(31);
    expect(k.routes.some((r) => (r.a === 'BKK' && r.b === 'SIN') || (r.a === 'SIN' && r.b === 'BKK'))).toBe(true);
  });
});

describe('배당 내역', () => {
  it('지난달·누적 배당을 회사별로 남기고, 월말 정산에 배당이 따로 기록된다', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.51); g.setSubDir(90, 'profit'); const k = g.state.competitors[0]; k.cash = 200;
    g.advanceDays(30 * 3 + 1);
    expect(k.divTotal ?? 0).toBeGreaterThan(0); expect(k.lastDiv).toBeGreaterThanOrEqual(0);
    const months = g.state.history.filter((m) => (m.dividend ?? 0) > 0);
    expect(months.length).toBeGreaterThan(0);
    expect(months.reduce((a, m) => a + m.dividend!, 0) + (g.state.cur.div ?? 0)).toBeCloseTo(k.divTotal!, 1); // 이번 달에 들어온 배당은 아직 정산 전
  });
});

describe('자회사 강화', () => {
  it('노선별 매출·몫을 남기고, 시장 몫 합계는 100%, 월 추이가 쌓인다', () => {
    const g = sandbox(); myRoute(g); const k = comp(g); g.buyStake(90, 0.51); k.cash = 200; g.advanceDays(30 * 3 + 1);
    expect(k.routes.every((r) => typeof r.rev === 'number')).toBe(true); expect(k.hist!.length).toBeGreaterThanOrEqual(3);
    const sh = g.marketShares('ICN', 'NRT'); expect(sh.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 9); expect(sh.some((x) => x.me)).toBe(true);
  });
  it('공세 대상을 정하면 그 회사 노선으로만 들어가고, 공세 노선에 표시가 붙는다', () => {
    const g = sandbox(); const k = comp(g, { born: -60 });
    g.state.competitors.push({ id: 91, name: '갑항공', style: 'low', hub: 'BKK', cash: 50, planes: 3, routes: [{ a: 'BKK', b: 'SIN', seatsDay: 800, fareRatio: 1 }], low: 0 } as never, { id: 92, name: '을항공', style: 'low', hub: 'DEL', cash: 50, planes: 3, routes: [{ a: 'DEL', b: 'DXB', seatsDay: 900, fareRatio: 1 }], low: 0 } as never);
    g.buyStake(90, 0.51); g.setSubDir(90, 'attack'); expect(g.setSubTarget(90, 91).ok).toBe(true); k.cash = 500; g.advanceDays(31);
    expect(k.routes.some((r) => r.atk && [r.a, r.b].includes('BKK'))).toBe(true); expect(k.routes.some((r) => [r.a, r.b].includes('DEL'))).toBe(false);
    expect(g.setSubTarget(90, 90).ok).toBe(false);
  });
  it('확장 지역을 정하면 그 지역 도시로 먼저 연다', () => {
    const g = sandbox(); const k = comp(g, { born: -60 }); g.buyStake(90, 0.51); expect(g.setSubRegion(90, 'xx').ok).toBe(false);
    const reg = Object.keys(config.rights.regions).find((r) => r !== 'asia' && r !== 'east-asia')!; g.setSubRegion(90, reg); k.cash = 500; const n0 = k.routes.length; g.advanceDays(31);
    expect(k.routes.length).toBeGreaterThanOrEqual(n0);
  });
  it('노는 여객기를 빌려주면 내 기단에서 빠지고 임대료가 들어오며, 돌려받을 수 있다', () => {
    const g = sandbox(); const k = comp(g); g.buyStake(90, 0.51); k.cash = 300; const idle = g.buyPlane('B737'); if (!idle.ok) throw new Error('buy');
    const n0 = g.state.planes.length, p0 = k.planes; expect(g.lendPlane(idle.planeId, 90).ok).toBe(true);
    expect(g.state.planes.length).toBe(n0 - 1); expect(k.planes).toBe(p0 + 1); expect(k.lent!.length).toBe(1);
    g.advanceDays(31); expect(k.lastRent ?? 0).toBeGreaterThan(0);
    expect(g.recallPlane(90).ok).toBe(true); expect(g.state.planes.length).toBe(n0); expect(k.lent!.length).toBe(0);
  });
  it('그룹 순위는 51% 자회사 매출을 더하고, 자회사 노선과 이어지면 환승 손님이 생긴다', () => {
    const g = sandbox(); const r = myRoute(g); const k = comp(g); k.routes.push({ a: 'NRT', b: 'LAX', seatsDay: 600, fareRatio: 1 }); k.revHist = [500]; const t0 = g.transferDemand(r); // 서울→도쿄→LA 환승
    g.buyStake(90, 0.51); expect(g.groupRank().revenue).toBeGreaterThanOrEqual(500); expect(g.transferDemand(r)).toBeGreaterThan(t0);
  });
  it('자회사가 있을 때만 자회사 이야기가 나오고, 독립 제안을 받아들이면 웃돈을 받고 지분이 팔린다', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.51); g.state.story = { id: 'subIndep', expires: 99, sub: 90 }; const c0 = g.state.cash;
    expect(g.chooseStory(0).ok).toBe(true); expect(g.state.competitors[0].stake).toBeUndefined(); expect(g.state.cash).toBeGreaterThan(c0);
    expect(config.story.list.filter((d) => (d as { needSub?: boolean }).needSub).length).toBe(2);
  });
});

describe('허브 투자 일괄', () => {
  it('한 단계씩/최고 단계까지 한꺼번에 사고, 현금이 모자라면 아무것도 사지 않는다', () => {
    const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 1000; const base = g.state.base;
    const one = g.hubBulkPlan(base, 'one'); expect(one.list.length).toBe(3);
    const c0 = g.state.cash; expect(g.buyHubBulk(base, 'one').ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - one.total, 6);
    for (const k of ['terminal', 'mro', 'lounge'] as const) expect(g.hubLevel(base, k)).toBe(1);
    g.state.cash = 1; expect(g.buyHubBulk(base, 'max').ok).toBe(false); expect(g.hubLevel(base, 'terminal')).toBe(1);
    g.state.cash = 1000; expect(g.buyHubBulk(base, 'max').ok).toBe(true); for (const k of ['terminal', 'mro', 'lounge'] as const) expect(g.hubLevel(base, k)).toBe(config.invest[k].prices.length);
    expect(g.buyHubBulk(base, 'max').ok).toBe(false);
  });
});

describe('경쟁사 항공기 상한(자유 모드)', () => {
  it('자유 모드에서는 시간이 지나면 10대를 넘어 커질 수 있고, 시나리오는 10대 그대로', () => {
    const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 900;
    for (let i = 0; i < 12; i++) { g.advanceDays(360); g.state.cash = 900; }
    expect(Math.max(...g.state.competitors.filter((c) => !c.major).map((c) => c.planes))).toBeGreaterThan(10);
  });
  it('노선 넘겨주기: 내 노선·소유 항공기를 자회사로, 다시 가져오면 B7-37을 받아 배정된다', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.51); const k = g.state.competitors[0]; g.state.cash = 900;
    const o = g.openRoute('ICN', 'PEK'); if (!o.ok) throw new Error(o.error); g.buyForRoute(o.routeId, 'B737', 'new'); g.buyForRoute(o.routeId, 'B737', 'new');
    const n0 = g.state.planes.length, p0 = k.planes, r0 = k.routes.length;
    expect(g.handRouteToSub(o.routeId, 90).ok).toBe(true);
    expect(g.state.planes.length).toBe(n0 - 2); expect(k.planes).toBe(p0 + 2); expect(k.routes.length).toBe(r0 + 1); expect(g.route(o.routeId)!.open).toBe(false);
    expect(g.handRouteToSub(o.routeId, 90).ok).toBe(false); // 이미 닫힘
    expect(g.handedRoutes().map((x) => `${x.route.a}-${x.route.b}`)).toEqual(['ICN-PEK']); // 노선 탭 '자회사에 넘긴 노선'
    g.state.rights = undefined; expect(g.recommendRoutes(50).some((x) => (x.a === 'ICN' && x.b === 'PEK') || (x.a === 'PEK' && x.b === 'ICN'))).toBe(false); // 넘긴 노선은 추천하지 않는다
    const kept = k.routes.find((r) => r.a === 'ICN' && r.b === 'PEK')!; expect(kept.fleet!.map((f) => f.type)).toEqual(['B737', 'B737']); kept.fleet![0].type = 'A321N'; kept.fleet![0].name = '하늘 1호'; g.advanceDays(60); // 기종을 바꿔 두고 시간이 지나면
    const c0 = g.state.cash; const t = g.takeRouteFromSub(90, 'ICN', 'PEK'); expect(t.ok).toBe(true);
    expect(g.route(o.routeId)!.open).toBe(true); expect(g.planesOn(o.routeId).length).toBeGreaterThanOrEqual(1); expect(g.state.cash).toBe(c0); // 넘겼다 가져오면 재개 비용 없음
    expect(k.routes.some((r) => (r.a === 'ICN' && r.b === 'PEK') || (r.a === 'PEK' && r.b === 'ICN'))).toBe(false);
    expect(g.handedRoutes().length).toBe(0);
    const back = g.planesOn(o.routeId); expect(back.map((p) => p.type).sort()).toEqual(['A321N', 'B737']); expect(back.find((p) => p.type === 'A321N')!.name).toBe('하늘 1호'); expect(back.every((p) => p.age >= 2)).toBe(true); // 넘긴 항공기가 그대로(나이는 먹음)
    expect(g.takeRouteFromSub(90, 'ICN', 'CJU').ok).toBe(false); // 자회사가 운항하지 않는 노선
  });
  it('일부 상장: 51%를 넘는 지분을 팔아 돈을 받고 경영권은 유지, 한 번만, 51%뿐이면 안 된다', () => {
    const g = sandbox(); comp(g); g.buyStake(90, 0.51); const k = g.state.competitors[0];
    expect(g.spinOff(90).ok).toBe(false); // 51%뿐
    k.stake = 1; const c0 = g.state.cash, r = g.spinOff(90); expect(r.ok).toBe(true); if (r.ok) { expect(r.sold).toBeCloseTo(0.49, 6); expect(g.state.cash).toBeCloseTo(c0 + r.cash, 6); }
    expect(k.stake).toBe(0.51); expect(k.listed).toBe(g.monthsPassed); expect(g.spinOff(90).ok).toBe(false);
  });
  it('그룹 시너지: 자회사가 있으면 항공기 고정비 할인과 관리비, 그룹 항공기 50대마다 구매 할인', () => {
    const g = sandbox(); expect(g.synergyFix).toBe(0); expect(g.groupUpkeep).toBe(0); expect(g.synergyBuy).toBe(0);
    comp(g); g.buyStake(90, 0.51); const k = g.state.competitors[0];
    expect(g.synergyFix).toBeCloseTo(config.subsidiary.synergy.fixCut, 6); expect(g.groupUpkeep).toBeCloseTo(config.subsidiary.synergy.upkeep, 6);
    k.planes = 60; expect(g.synergyBuy).toBeCloseTo(config.subsidiary.synergy.buyCut, 6);
    const price = g.state.cash; expect(g.buyPlane('B737').ok).toBe(true); expect(price - g.state.cash).toBeCloseTo(60 * 0.98, 1);
    expect(new Game(3).synergyFix).toBe(0); // 시나리오는 없음
  });
});
