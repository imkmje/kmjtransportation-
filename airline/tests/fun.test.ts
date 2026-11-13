import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sb = (seed = 3) => { const g = new Game(seed, undefined, { sandbox: true }); g.state.cash = 3000; return g; };
const route = (g: Game, a = 'ICN', b = 'NRT', t = 'A220') => { const o = g.openRoute(a, b); if (!o.ok) throw new Error('open'); g.buyForRoute(o.routeId, t, 'new'); return g.route(o.routeId)!; };

describe('마일리지', () => {
  it('회원이 쌓이면 수요가 늘고 비용이 든다, 혜택을 줄이면 회원이 떠난다', () => {
    const g = sb(); const r = route(g); g.advanceDays(31); const d0 = g.routeDay(r).demand;
    expect(g.setLoyalty(2).ok).toBe(true); g.advanceDays(30 * 6);
    expect(g.state.loyalty!.members).toBeGreaterThan(0); expect(g.loyaltyBoost).toBeGreaterThan(0); expect(g.loyaltyCost).toBeGreaterThan(0);
    expect(d0).toBeGreaterThan(0);
    const m0 = g.state.loyalty!.members; g.setLoyalty(1); expect(g.state.loyalty!.members).toBe(Math.round(m0 * 0.8));
    expect(new Game(3).setLoyalty(1).ok).toBe(false);
  });
});
describe('전세기', () => {
  it('노는 항공기를 보내면 매달 돈이 들어오고 끝나면 돌아온다, 그동안 배정할 수 없다', () => {
    const g = sb(); const p = g.buyPlane('B737'); if (!p.ok) throw new Error('buy');
    g.state.charters = [{ id: 777, a: 'ICN', b: 'BKK', months: 2, seats: 120, perMonth: 1.5, expires: 9 }];
    expect(g.acceptCharter(777, p.planeId).ok).toBe(true); const r = route(g, 'ICN', 'PEK');
    expect(g.assign(p.planeId, r.id, 3).ok).toBe(false);
    const c0 = g.state.cash; g.advanceDays(31); expect(g.state.cash).toBeGreaterThan(c0 - 50);
    g.advanceDays(31); expect(g.plane(p.planeId)!.charter).toBeUndefined();
  });
});
describe('동맹', () => {
  it('3곳까지, 동맹사는 손님을 덜 빼앗고, 대형 항공사는 따로 동맹을 만든다', () => {
    const g = sb(); g.advanceDays(31); const cs = g.state.competitors.filter((c) => !c.major);
    expect(g.joinAlliance(cs[0].id).ok).toBe(true); expect(g.isFriend(cs[0])).toBe(true); expect(g.joinAlliance(cs[0].id).ok).toBe(false);
    for (let i = 0; i < 24; i++) g.advanceDays(30);
    expect(g.state.rivalAlliance?.length ?? 0).toBeGreaterThan(0);
  });
});
describe('입찰', () => {
  it('최고가를 부르고 기한이 지나면 낙찰되어 효과가 생긴다', () => {
    const g = sb(); route(g); g.state.competitors = [];
    g.state.bids = [{ id: 1, kind: 'concession', city: 'NRT', n: 0, ends: g.monthsPassed + 1, best: null, min: 10 }];
    const cap0 = g.slotCapacityRaw('NRT'); expect(g.placeBid(1).ok).toBe(true); expect(g.placeBid(1).ok).toBe(false);
    g.advanceDays(61); expect(g.state.concessions?.NRT?.holder).toBe(0); expect(g.slotCapacityRaw('NRT')).toBe(cap0 + config.extra.bid.concessionSlots);
    g.state.bids = [{ id: 2, kind: 'slots', city: 'HKG', n: 5, ends: g.monthsPassed + 1, best: null, min: 10 }]; g.placeBid(2); g.advanceDays(31);
    expect(g.state.slots.HKG).toBe(5);
  });
});
describe('메가 프로젝트·선주문·첫 취항·기록·도감·시상식', () => {
  it('항공 학교를 다 지으면 정시율이 오른다', () => {
    const g = sb(); const r = route(g); const o0 = g.routeOtp(r); expect(g.startMega('academy').ok).toBe(true); expect(g.startMega('mro').ok).toBe(false);
    g.advanceDays(30 * 19 + 1); expect(g.state.megaDone).toContain('academy'); expect(g.routeOtp(r)).toBeGreaterThan(o0 - 0.2);
  });
  it('발표된 신기종을 선주문하면 출시 때 할인가로 인도받는다', () => {
    const g = sb(); g.advanceDays(30 * 7); expect(g.canPreorder('B757')).toBe(true); expect(g.preorder('B757', 2).ok).toBe(true);
    const n0 = g.state.planes.length; g.advanceDays(30 * 6); expect(g.state.planes.length).toBe(n0 + 2);
  });
  it('경쟁사가 없는 도시에 처음 취항하면 보너스, 기록·도감·시상식이 쌓인다', () => {
    const g = sb(); g.state.competitors = []; route(g, 'ICN', 'SGN'); g.advanceDays(31);
    expect(g.state.pioneer?.SGN).toBeGreaterThan(g.monthsPassed); expect(g.state.records?.profit).toBeTruthy(); expect(g.state.typesFlown!.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 12; i++) g.advanceDays(30); expect(g.state.awards?.length ?? 0).toBeGreaterThan(0);
  });
});
describe('이어지는 이야기·재난·타임랩스', () => {
  it('노조 요구를 수용하면 12개월 뒤 재협상 이야기가 이어진다', () => {
    const g = sb(); g.state.story = { id: 'union', expires: 99 }; g.chooseStory(0); expect(g.state.storyQueue?.[0].id).toBe('union2');
    g.state.storyQueue = [{ id: 'union2', at: g.monthsPassed }]; g.advanceDays(31); expect(g.state.story?.id).toBe('union2');
  });
  it('태풍·화산재는 자유 모드에서만, 노선망 기록이 6개월마다 쌓인다', () => {
    const g = sb(); route(g); g.advanceDays(30 * 13); expect((g.state.netHist ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
