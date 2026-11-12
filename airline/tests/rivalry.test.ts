import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { LADDERS } from '../src/sim/achievements';

const sandbox = (seed = 3) => { const g = new Game(seed, undefined, { sandbox: true }); g.state.cash = 900; return g; };
const comp = (g: Game, id: number, hub: string, planes: number, routes: { a: string; b: string }[] = [], extra: object = {}) => {
  g.state.competitors.push({ id, name: `시험${id}`, style: 'low', hub, cash: 80, planes, routes: routes.map((r) => ({ ...r, seatsDay: 300, fareRatio: 0.9 })), low: 0, ...extra } as never);
  return g.state.competitors.at(-1)!;
};
const myRoute = (g: Game, a = 'ICN', b = 'NRT') => { const o = g.openRoute(a, b); if (!o.ok) throw new Error('open'); const p = g.buyForRoute(o.routeId, 'A220', 'new'); if (!p.ok) throw new Error('buy'); return o.routeId; };
const withCfg = <T>(fn: () => T): T => { const t = { ...config.rivalry.threat }, m = { ...config.rivalry.merge }; try { return fn(); } finally { Object.assign(config.rivalry.threat, t); Object.assign(config.rivalry.merge, m); } };

describe('경쟁사 성격', () => {
  it('자유 모드에서만 성격이 정해지고, 시나리오에는 없다', () => {
    const g = sandbox(); g.advanceDays(31);
    expect(g.state.competitors.filter((c) => !c.major).every((c) => !!c.trait && !!g.traitOf(c))).toBe(true);
    const sc = new Game(3); sc.advanceDays(31); expect(sc.state.competitors.every((c) => !c.trait)).toBe(true);
  });
});

describe('진출 예고', () => {
  it('예고 → 2개월 뒤 진출, 제휴하면 철회', () => withCfg(() => {
    config.rivalry.threat.chance = 1; config.rivalry.merge.chance = 0;
    const g = sandbox(); myRoute(g, 'ICN', 'NRT'); g.state.competitors = []; const c = comp(g, 90, 'NRT', 4, [{ a: 'NRT', b: 'HKG' }]);
    g.advanceDays(31); expect(g.state.threats?.length).toBe(1);
    const t = g.state.threats![0]; expect(g.state.log.some((l) => l.includes('진출을 검토'))).toBe(true);
    config.rivalry.threat.chance = 0; g.advanceDays(30 * config.rivalry.threat.lead);
    expect(c.routes.some((r) => (r.a === t.a && r.b === t.b) || (r.a === t.b && r.b === t.a))).toBe(true);
    const g2 = sandbox(); myRoute(g2); g2.state.competitors = []; comp(g2, 91, 'NRT', 4, [{ a: 'NRT', b: 'HKG' }]);
    config.rivalry.threat.chance = 1; g2.advanceDays(31); config.rivalry.threat.chance = 0; g2.setAlly(91); g2.advanceDays(30 * config.rivalry.threat.lead + 1);
    expect(g2.state.competitors[0].routes.length).toBe(1);
  }));
});

describe('합병', () => {
  it('큰 회사가 약한 회사를 인수·합병하고 기록이 남는다', () => withCfg(() => {
    config.rivalry.merge.chance = 1; config.rivalry.merge.minMonth = 0; config.rivalry.threat.chance = 0;
    const g = sandbox(); g.state.competitors = []; const big = comp(g, 90, 'FRA', 7, [{ a: 'FRA', b: 'LHR' }], { cash: 100 }); comp(g, 91, 'HKG', 1, [{ a: 'HKG', b: 'SIN' }]);
    g.advanceDays(31);
    expect(g.state.competitors.map((c) => c.id)).toEqual([90]); expect(big.planes).toBeGreaterThanOrEqual(8); expect(g.state.rivalsGone.at(-1)).toMatchObject({ acq: true, by: '시험90' });
  }));
});

describe('라이벌', () => {
  it('12개월 뒤 라이벌이 정해지고, 퇴장하면 다시 정해진다', () => {
    const g = sandbox(); myRoute(g); comp(g, 90, 'HKG', 2, [{ a: 'HKG', b: 'SIN' }]); g.advanceDays(30 * 14);
    expect(g.state.rivalId).not.toBeNull(); expect(typeof g.state.rivalLead).toBe('boolean');
    const first = g.state.rivalId!; g.state.competitors = g.state.competitors.filter((c) => c.id !== first); comp(g, 95, 'DXB', 2, [{ a: 'DXB', b: 'DEL' }], { revHist: [1] });
    g.advanceDays(31); expect(g.state.rivalId).not.toBe(first);
    expect(g.setRival(g.state.competitors.find((c) => c.major)?.id ?? -1).ok).toBe(false);
  });
});

describe('슬롯 선점', () => {
  it('경쟁사가 노선을 가진 도시의 빈 슬롯을 선점하되 쓰는 슬롯은 건드리지 않는다', () => {
    const g = sandbox(); myRoute(g, 'ICN', 'NRT'); g.state.competitors = []; comp(g, 90, 'NRT', 4, [{ a: 'NRT', b: 'HKG' }, { a: 'NRT', b: 'SIN' }, { a: 'NRT', b: 'BKK' }, { a: 'NRT', b: 'MNL' }]);
    g.advanceDays(31); const taken = g.state.taken?.NRT ?? 0;
    expect(taken).toBeGreaterThan(0); expect(g.slotCapacity('NRT')).toBe(g.slotCapacityRaw('NRT') - taken); expect(g.slotCapacity('NRT')).toBeGreaterThanOrEqual(g.slotsUsed('NRT') - 1e-9);
    const sc = new Game(3); sc.advanceDays(31); expect(sc.state.taken).toBeUndefined();
  });
});

describe('경쟁 대응', () => {
  it('광고는 경쟁사가 있는 노선에서만, 비용을 내고 점유율을 올린 뒤 끝난다', () => {
    const g = sandbox(); const rid = myRoute(g, 'ICN', 'NRT'); expect(g.adRoute(rid).ok).toBe(false);
    g.state.competitors = []; comp(g, 90, 'NRT', 4, [{ a: 'ICN', b: 'NRT' }]);
    const r = g.route(rid)!, before = g.routeDay(r).share, c0 = g.state.cash; expect(g.adRoute(rid).ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(c0 - config.rivalry.ad.cost, 9); expect(g.routeDay(r).share).toBeGreaterThan(before); expect(g.adRoute(rid).ok).toBe(false);
    g.advanceDays(30 * config.rivalry.ad.months + 1); expect(r.ad ?? 0).toBe(0);
  });
  it('상대 운임에 맞추면 내 운임이 상대 수준으로 내려간다', () => {
    const g = sandbox(); const rid = myRoute(g); g.state.competitors = []; comp(g, 90, 'NRT', 4, [{ a: 'ICN', b: 'NRT' }]);
    const r = g.route(rid)!; g.setFare(rid, g.routeBaseFare(r) * 1.4); g.matchRivalFare(rid);
    expect(r.fare / g.routeBaseFare(r)).toBeCloseTo(Math.max(config.fare.minRatio, 0.9), 1);
  });
});

describe('이야기 사건', () => {
  it('선택하면 효과가 적용되고, 현금이 모자라면 거절된다', () => {
    const g = sandbox(); g.state.story = { id: 'celeb', expires: 99 }; const c0 = g.state.cash, r0 = g.state.reputation = 0.5;
    g.state.cash = 1; expect(g.chooseStory(0).ok).toBe(false); g.state.cash = c0;
    expect(g.chooseStory(0).ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - 3, 9); expect(g.state.reputation).toBeCloseTo(r0 + 0.05, 9); expect(g.state.story).toBeNull();
    expect(g.chooseStory(0).ok).toBe(false);
  });
  it('답을 미루면 기회가 지나가고, 자유 모드에서 가끔 새 이야기가 생긴다', () => {
    const g = sandbox(); g.state.story = { id: 'green', expires: 1 }; g.advanceDays(61); expect(g.state.log.some((l) => l.includes('기회가 지나갔습니다'))).toBe(true);
    let seen = 0; for (let seed = 1; seed <= 6; seed++) { const h = sandbox(seed); h.advanceDays(30 * 24); if (h.state.log.some((l) => /\(지도 탭에서 \d개월 안에 선택\)/.test(l))) seen++; }
    expect(seen).toBeGreaterThan(0);
  });
  it('이야기 정의가 올바르다', () => { for (const d of config.story.list) { expect(d.choices.length).toBeGreaterThanOrEqual(2); expect(d.title.length).toBeGreaterThan(5); } });
});

describe('올해의 도전', () => {
  it('2년차에 도전이 나오고, 달성하면 보상을 받는다', () => {
    const g = sandbox(); myRoute(g); g.advanceDays(30 * 12 + 1);
    expect(g.state.season).toBeTruthy(); const se = g.state.season!; expect(se.done).toBe(false);
    const c0 = g.state.cash; se.best = 1e12; g.advanceDays(30); expect(g.state.season!.done).toBe(true); expect(g.state.cash).toBeGreaterThan(c0 - 1 + se.cash - 100); expect(g.state.log.some((l) => l.includes('올해의 도전 달성'))).toBe(true);
  });
});

describe('후반 이정표', () => {
  it('새 사다리가 있고 단계가 오름차순이다', () => {
    for (const id of ['totalpax', 'years', 'acq', 'rights']) expect(LADDERS.some((l) => l.id === id)).toBe(true);
    for (const l of LADDERS) for (let i = 1; i < l.steps.length; i++) expect(l.steps[i]).toBeGreaterThan(l.steps[i - 1]);
  });
});

describe('노선 점유율', () => {
  it('경쟁사가 없으면 내가 100%, 있으면 나와 경쟁사 점유율의 합이 100%', () => {
    const g = sandbox(); const rid = myRoute(g); g.state.competitors = []; const r = g.route(rid)!;
    expect(g.routeShares(r)).toEqual([{ name: '우리', share: 1, me: true, id: 0 }]);
    comp(g, 90, 'NRT', 4, [{ a: 'ICN', b: 'NRT' }]); comp(g, 91, 'HKG', 4, [{ a: 'ICN', b: 'NRT' }]);
    const sh = g.routeShares(r); expect(sh.length).toBe(3); expect(sh.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 9);
    expect(sh[0].share).toBeCloseTo(g.routeDay(r).share, 9); expect(sh.every((x) => x.share > 0)).toBe(true);
  });
});

describe('점유율 전략', () => {
  const setup = () => { const g = sandbox(); const rid = myRoute(g); g.state.competitors = []; comp(g, 90, 'NRT', 6, [{ a: 'ICN', b: 'NRT' }]); g.state.competitors[0].routes[0].seatsDay = 900; return { g, rid, r: g.route(rid)! }; };
  it('서비스 등급은 점유율을 올리고 항공기 1대당 월 비용이 든다', () => {
    const { g, rid, r } = setup(); const s0 = g.routeDay(r).share, c0 = g.routeDay(r).cost;
    expect(g.setService(rid, 2).ok).toBe(true); const d = g.routeDay(r);
    expect(d.share).toBeGreaterThan(s0); expect((d.cost - c0) * config.daysPerMonth).toBeGreaterThan(config.strategy.svcCost[2] * 0.9 - 0.5); // 비용 증가(수요 변화로 일부 상쇄 가능)
    expect(g.setService(rid, 9).ok).toBe(false); expect(g.setService(rid, 0).ok).toBe(true); expect(r.svc).toBeUndefined();
  });
  it('점유율 우선 운임은 경쟁사 최저가보다 싸게 맞추고, 경쟁사가 없으면 거절', () => {
    const { g, rid, r } = setup(); g.setFare(rid, g.routeBaseFare(r) * 1.3);
    expect(g.setStance(rid, true).ok).toBe(true); const base = g.routeBaseFare(r);
    expect(r.fare / base).toBeLessThanOrEqual(0.9 * config.strategy.undercut + 0.01);
    g.setFare(rid, base * 1.3); g.advanceDays(8); expect(r.fare / base).toBeLessThanOrEqual(0.9 * config.strategy.undercut + 0.01); // 매주 다시 맞춘다
    g.setStance(rid, false); expect(r.stance).toBeUndefined();
    const solo = sandbox(); const rid2 = myRoute(solo); solo.state.competitors = []; expect(solo.setStance(rid2, true).ok).toBe(false);
  });
  it('항공기 추가 추천에 점유율 변화가 나오고, 점유율 낮은 노선은 조언에 뜬다', () => {
    const { g, rid } = setup(); const o = g.routeOptions(rid)[0];
    expect(o.shareAfter).toBeGreaterThan(o.shareBefore);
    g.state.competitors[0].routes[0].seatsDay = 5000; g.state.competitors[0].routes[0].fareRatio = 0.6;
    expect(g.routeDay(g.route(rid)!).share).toBeLessThan(0.5);
  });
});
