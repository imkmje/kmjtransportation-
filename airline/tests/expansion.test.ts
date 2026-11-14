import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { distanceKm } from '../src/sim/model';
import { cityById, typeById } from '../src/data';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 5000; g.state.rights = undefined; return g; };
const route = (g: Game, a: string, b: string) => { const r = g.openRoute(a, b); if (!r.ok) throw new Error(r.error); const p = g.buyPlane('B737'); if (!p.ok) throw new Error(p.error); g.assign(p.planeId, r.routeId, 7); return { rid: r.routeId, pid: p.planeId }; };
const richHistory = (g: Game, rev: number) => { g.advanceDays(30); for (let i = 0; i < 12; i++) g.state.history.push({ ...g.state.history[0], month: 100 + i, revenue: rev }); };

describe('대형 사업 비용은 회사 규모에 따라', () => {
  it('최근 12개월 매출이 클수록 비싸지고, 착공 때 값이 고정된다', () => {
    const g = sb(), base = config.extra.mega.list.find((x) => x.id === 'academy')!.cost;
    expect(g.megaCost('academy')).toBe(base);
    richHistory(g, 50); // 연 매출 $600M → 4배
    expect(g.megaMult).toBe(4); expect(g.megaCost('academy')).toBe(base * 4);
    expect(g.startMega('academy').ok).toBe(true); expect(g.state.mega!.cost).toBe(base * 4);
  });
});

describe('마일리지 확장', () => {
  it('등급 회원이 생기고, 비용은 등급만큼 더 들며, 비즈니스 수요가 오른다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.setLoyalty(2); g.state.loyalty!.members = 2_000_000; g.advanceDays(30 * 24);
    const l = g.state.loyalty!; expect((l.silver ?? 0) + (l.gold ?? 0) + (l.plat ?? 0)).toBeGreaterThan(0); expect(l.plat ?? 0).toBeGreaterThan(0);
    expect(g.loyaltyCost).toBeGreaterThan((l.members / 1e6) * config.extra.loyalty.costPerM[2]);
    expect(g.eliteBiz).toBeGreaterThan(0);
  });
  it('제휴 카드는 가입비를 내고 매달 수입, 프로모션은 쉬는 기간이 있다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.setLoyalty(1); g.state.loyalty!.members = 1_000_000;
    const c0 = g.state.cash; expect(g.setCard(true).ok).toBe(true); expect(g.state.cash).toBe(c0 - config.extra.loyalty.card.fee);
    g.advanceDays(30); expect(g.state.loyalty!.cardInc).toBeGreaterThan(0);
    expect(g.startPromo().ok).toBe(true); expect(g.startPromo().ok).toBe(false);
    g.advanceDays(30 * 3); expect(g.startPromo().ok).toBe(false); // 2개월 진행 + 6개월 쉼
    g.advanceDays(30 * 6); expect(g.startPromo().ok).toBe(true);
  });
});

describe('경쟁사 수 한도(자유 모드)', () => {
  it('2년마다 1곳씩 늘어 최대 12곳', () => {
    const k = config.competitors; expect(Math.min(k.sandboxMax, k.max + Math.floor(96 / k.maxGrowMonths))).toBe(10);
    expect(Math.min(k.sandboxMax, k.max + Math.floor(240 / k.maxGrowMonths))).toBe(12);
  });
});

describe('동맹 확장', () => {
  it('이름을 짓고, 경험치로 등급이 오르면 혜택과 회원 한도가 커진다', () => {
    const g = sb(); const c = g.state.competitors.find((x) => !x.major)!; expect(g.joinAlliance(c.id).ok).toBe(true);
    expect(g.setAllianceName('하늘 연합').ok).toBe(true); expect(g.state.alli!.name).toBe('하늘 연합'); expect(g.setAllianceName('').ok).toBe(false);
    const cs = g.alliCodeshare, w = g.alliWeight, mx = g.alliMax;
    g.state.alli!.xp = 72; expect(g.alliLevel).toBe(4); expect(g.alliCodeshare).toBeGreaterThan(cs); expect(g.alliWeight).toBeLessThan(w); expect(g.alliMax).toBe(mx + 1);
  });
  it('공동 터미널은 본사 슬롯, 공동 라운지는 별점을 올린다', () => {
    const g = sb(); const { rid } = route(g, 'ICN', 'NRT'); const c = g.state.competitors.find((x) => !x.major)!; g.joinAlliance(c.id);
    const cap = g.slotCapacity(g.state.base), rt = g.routeRating(g.route(rid)!);
    expect(g.buyAlliProject('terminal').ok).toBe(true); expect(g.slotCapacity(g.state.base)).toBe(cap + 6);
    expect(g.buyAlliProject('lounge').ok).toBe(true); expect(g.routeRating(g.route(rid)!)).toBeGreaterThan(rt);
    expect(g.buyAlliProject('lounge').ok).toBe(false);
  });
  it('회의에서 공동 구매를 고르면 새 항공기가 5% 싸다', () => {
    const g = sb(); const c = g.state.competitors.find((x) => !x.major)!; g.joinAlliance(c.id);
    g.state.alli!.meeting = { expires: g.monthsPassed + 2 }; expect(g.chooseAgenda('buy').ok).toBe(true);
    const c0 = g.state.cash; g.buyPlane('B737'); expect(c0 - g.state.cash).toBeCloseTo(Math.round(typeById('B737').price * 0.95 * 10) / 10);
  });
  it('스카이 동맹 영입 시도: 붙잡으면 남고, 보내면 스카이로 간다', () => {
    const g = sb(); const [a, b] = g.state.competitors.filter((x) => !x.major); g.joinAlliance(a.id); g.joinAlliance(b.id); g.state.rivalAlliance = [];
    g.state.alli!.poach = { comp: a.id, expires: g.monthsPassed + 2, cost: 9 }; expect(g.keepMember().ok).toBe(true); expect(g.state.alliance).toContain(a.id);
    g.state.alli!.poach = { comp: b.id, expires: g.monthsPassed + 2, cost: 9 }; expect(g.releaseMember().ok).toBe(true);
    expect(g.state.alliance).not.toContain(b.id); expect(g.state.rivalAlliance).toContain(b.id);
    const r = g.recruitFromSky(b.id); expect(r.ok).toBe(true);
  });
});

describe('자회사 차리기', () => {
  it('거점·형태·자본금대로 지분 100% 자회사가 생기고, 지역 항공사는 단거리만 다닌다', () => {
    const g = sb(); const c0 = g.state.cash;
    const r = g.foundSubsidiary({ name: '바다항공', hub: 'ICN', kind: 'regional', size: 1 }); expect(r.ok).toBe(true);
    const c = g.state.competitors.find((x) => r.ok && x.id === r.id)!;
    expect(c.stake).toBe(1); expect(c.founded).toBe('regional'); expect(c.planes).toBe(config.extra.found.planes[1]); expect(g.state.cash).toBe(c0 - g.foundCost(1));
    for (const x of c.routes) expect(distanceKm(cityById(x.a), cityById(x.b))).toBeLessThanOrEqual(config.extra.found.regionalKm);
    expect(g.foundSubsidiary({ name: '바다항공', hub: 'ICN', kind: 'low', size: 0 }).ok).toBe(false); // 같은 이름
  });
});

describe('돈 쓸 곳', () => {
  it('객실 개조는 별점을 올리고, 광고는 평판과 수요를, 친환경 연료는 비용을 줄인다', () => {
    const g = sb(); const { rid, pid } = route(g, 'ICN', 'NRT'); const r = g.route(rid)!;
    const rt = g.routeRating(r); expect(g.refitCabin(pid).ok).toBe(true); expect(g.routeRating(r)).toBeGreaterThan(rt);
    const rep = g.state.reputation; expect(g.startCampaign('national').ok).toBe(true); expect(g.state.reputation).toBeGreaterThan(rep); expect(g.startCampaign('global').ok).toBe(false);
    g.plane(pid)!.shop = 0; const cost0 = g.routeDay(r).cost; expect(g.investGreen().ok).toBe(true); expect(g.routeDay(r).cost).toBeLessThan(cost0);
  });
});

describe('월말 처리 금액이 보고에서 빠지지 않는다', () => {
  it('대형 사업 납입(월말)이 다음 달 보고의 비용에 들어간다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.advanceDays(30); expect(g.startMega('academy').ok).toBe(true);
    const pay = g.state.mega!.cost! / 18; g.advanceDays(60);
    expect(g.state.history.at(-1)!.cost).toBeGreaterThanOrEqual(pay - 1e-6);
  });
});
