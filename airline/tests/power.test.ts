import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 9999; g.state.rights = undefined; return g; };
const comp = (g: Game, id: number, hub: string, b: string, seats: number, extra: object = {}) => { g.state.competitors.push({ id, name: `시험${id}`, style: 'low', hub, cash: 50, planes: 3, routes: [{ a: hub, b, seatsDay: seats, fareRatio: 1 }], ...extra }); };

describe('세력도(3.13.0)', () => {
  it('도시마다 몫의 합이 100%이고, 세력별로 갈린다', () => {
    const g = sb(); g.state.competitors = [];
    comp(g, 71, 'LHR', 'CDG', 1000, { major: true }); comp(g, 72, 'LHR', 'CDG', 500); comp(g, 73, 'LHR', 'CDG', 250, { stake: 0.51 }); comp(g, 74, 'LHR', 'CDG', 250); comp(g, 75, 'LHR', 'CDG', 1000);
    g.state.alliance = [72]; g.state.rivalAlliance = [74];
    const p = g.cityPower('LHR')!; expect(Object.values(p.shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p.total).toBe(3000); expect(p.shares.major).toBeCloseTo(1000 / 3000, 6); expect(p.shares.alli).toBeCloseTo(500 / 3000, 6); expect(p.shares.mine).toBeCloseTo(250 / 3000, 6); expect(p.shares.sky).toBeCloseTo(250 / 3000, 6); expect(p.shares.other).toBeCloseTo(1000 / 3000, 6);
    expect(['major', 'other']).toContain(p.top); expect(p.contested).toBe(true); // 1위 몫이 40% 미만이면 접전
    expect(g.cityPower('SYD')).toBeUndefined(); // 아무도 안 가는 도시
  });
  it('내가 연 노선과 내가 직접 차린 자회사는 모두 내 그룹, 내 동맹에 든 대형은 대형이 아니라 동맹', () => {
    const g = sb(); g.state.competitors = []; const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error(o.error); g.buyForRoute(o.routeId, 'B737', 'new');
    const mine = g.routeDay(g.route(o.routeId)!).seats; comp(g, 81, 'ICN', 'NRT', mine, { major: true }); g.state.alliance = [81];
    const p = g.cityPower('ICN')!; expect(p.shares.mine).toBeCloseTo(0.5, 6); expect(p.shares.alli).toBeCloseTo(0.5, 6); expect(p.shares.major).toBe(0);
    expect(g.powerCounts().mine + g.powerCounts().alli).toBeGreaterThanOrEqual(2); // ICN·NRT
  });
  it('항공기를 새로 배정하면(같은 날이라도) 다시 계산한다', () => {
    const g = sb(); g.state.competitors = []; const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error(o.error);
    expect(g.cityPower('ICN')).toBeUndefined(); g.buyForRoute(o.routeId, 'B737', 'new'); expect(g.cityPower('ICN')!.shares.mine).toBe(1);
  });
  it('설정이 있다: 세력 5개, 접전 기준 40%', () => { expect(config.power.factions.map((f) => f.id)).toEqual(['mine', 'alli', 'sky', 'major', 'other']); expect(config.power.contest).toBe(0.4); });
});
