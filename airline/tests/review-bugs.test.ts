import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 3000; g.state.competitors = []; return g; };
const comp = (g: Game, id: number, extra: object = {}) => { g.state.competitors.push({ id, name: `회사${id}`, style: 'low', hub: 'NRT', cash: 80, planes: 4, routes: [{ a: 'NRT', b: 'HKG', seatsDay: 300, fareRatio: 1 }], low: 0, ...extra } as never); return g.state.competitors.at(-1)!; };

describe('점검 보고 BUG-1~4', () => {
  it('BUG-1·2: 전세 운항 중인 항공기는 빌려줄 수도 팔 수도 없다', () => {
    const g = sb(); comp(g, 90); g.buyStake(90, 0.51); const p = g.buyPlane('B737'); if (!p.ok) throw new Error('buy');
    g.state.charters = [{ id: 1, a: 'ICN', b: 'BKK', months: 3, seats: 120, perMonth: 1, expires: 9 }]; expect(g.acceptCharter(1, p.planeId).ok).toBe(true);
    expect(g.lendPlane(p.planeId, 90).ok).toBe(false); expect(g.sellPlane(p.planeId).ok).toBe(false);
    expect(g.state.charters[0].planeId).toBe(p.planeId);
  });
  it('BUG-3: 동맹사가 사라지거나 자회사가 되면 동맹 자리에서 빠진다', () => {
    const g = sb(); comp(g, 90); comp(g, 91); comp(g, 92);
    for (const id of [90, 91, 92]) expect(g.joinAlliance(id).ok).toBe(true);
    g.buyStake(91, 0.2); expect(g.state.alliance).not.toContain(91);
    g.state.competitors = g.state.competitors.filter((c) => c.id !== 92); g.advanceDays(31);
    expect(g.state.alliance).toEqual([90]); comp(g, 93); expect(g.joinAlliance(93).ok).toBe(true);
  });
  it('BUG-4: 운영권·낙찰 슬롯을 가진 경쟁사가 사라지면 함께 사라진다', () => {
    const g = sb(); comp(g, 90);
    g.state.bids = [{ id: 5, kind: 'slots', city: 'HKG', n: 5, ends: g.monthsPassed, best: { who: 90, amount: 10 }, min: 10 }];
    g.state.concessions = { NRT: { holder: 90, until: 99 } }; g.advanceDays(31);
    expect(g.state.compLots?.length).toBe(1);
    g.state.competitors = []; g.advanceDays(31);
    expect(g.state.concessions?.NRT).toBeUndefined(); expect(g.state.compLots).toEqual([]);
    expect(config.extra.bid.concessionSlots).toBeGreaterThan(0);
  });
});
