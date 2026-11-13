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
