import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { EMPTY_NETWORK } from '../src/maps/sample';

const run = (sim: Sim, hours: number) => { const end = sim.tickCount + Math.round(hours * 150 * config.tickRate); while (sim.tickCount < end) sim.step(); };
const base = () => { const e = new Editor(config); e.loadData(EMPTY_NETWORK); e.build({ x: -400, y: 0 }, { x: 400, y: 0 }, 'road2'); return e; };

describe('구역 종류와 밀도', () => {
  it('고밀 주거 구역에는 밀도 2의 대형(2×2칸) 건물만, 저밀에는 작은·중간 건물만 자라고 서로 겹치지 않는다', () => {
    const e = base();
    for (let i = 0; i < 9; i++) for (const y of [-40, 40]) e.addBuilding('office', 'large', 40 + i * 40, y, 'map', false); // 일자리가 충분해야 주거 수요가 계속 높다
    e.network.paintZone(-12, 1, -1, 2, 'homeHigh');
    e.network.paintZone(-30, -2, -13, -1, 'home');
    const sim = new Sim(config, e.network);
    run(sim, 24);
    const auto = [...e.network.buildings.values()].filter((b) => b.source === 'auto');
    const high = auto.filter((b) => b.density === 2), low = auto.filter((b) => b.density === 0);
    expect(high.length).toBeGreaterThan(1);
    expect(high.every((b) => b.size === 'large' && b.x < 0)).toBe(true);
    expect(low.length).toBeGreaterThan(1);
    expect(low.every((b) => b.size !== 'large' && b.x < -250)).toBe(true);
    // 건물이 차지한 칸이 겹치지 않는다
    const cells = e.network.occupiedCells();
    const expected = auto.reduce((n, b) => n + (b.size === 'large' ? 4 : 1), 0);
    expect(new Set([...cells.values()].filter((b) => b.source === 'auto')).size).toBe(auto.length);
    expect([...cells.entries()].filter(([, b]) => b.source === 'auto').length).toBe(expected);
  }, 120_000);

  it('밀도가 높은 건물은 거주 인원(출근 이동)이 더 많다', () => {
    const trips = (density: 0 | 1 | 2) => {
      const e = base();
      e.addBuilding('home', 'large', -200, 40, 'map', false, 0, density);
      e.addBuilding('office', 'large', 200, 40, 'map', false);
      const sim = new Sim(config, e.network);
      run(sim, 24);
      return sim.metrics.history[0].generated;
    };
    const a = trips(0), b = trips(2);
    expect(b).toBeGreaterThan(a * 1.5);
  }, 120_000);

  it('저장 왕복에서 구역 종류와 밀도가 유지되고, 옛 학교 구역(코드 3)은 버려진다', () => {
    const e = base();
    e.network.paintZone(-3, 2, 3, 3, 'office');
    e.network.paintZone(4, 2, 6, 3, 'industrial');
    e.network.paintZone(-8, 2, -5, 3, 'homeMid');
    e.addBuilding('home', 'medium', -300, 40, 'map', false, 5, 1);
    const e2 = new Editor(config); e2.loadText(e.exportText());
    expect(JSON.stringify(e2.network.toJSON())).toBe(JSON.stringify(e.network.toJSON()));
    expect(new Set(e2.network.zones.values())).toEqual(new Set(['office', 'industrial', 'homeMid']));
    expect([...e2.network.buildings.values()][0].density).toBe(1);
    const raw = JSON.parse(e.exportText()); raw.zones = [[1, 2, 3], [2, 2, 0]];
    expect(Network.parse(raw, config).zones.length).toBe(2); // 파싱은 통과하고
    const e3 = new Editor(config); e3.loadText(JSON.stringify(raw));
    expect(e3.network.zones.size).toBe(1); // 읽을 때 코드 3은 버려진다
  });

  it('수요 막대: 주거는 도시가 작으면 저밀 위주, 커지면 중·고밀이 늘고, 산업·사무는 따로 계산된다', () => {
    const e = base();
    e.addBuilding('office', 'large', 200, 40, 'map', false);
    e.addBuilding('factory', 'large', 300, 40, 'map', false);
    const sim = new Sim(config, e.network);
    const small = sim.growth.bars();
    expect(small.home).toBeGreaterThan(small.homeHigh);
    for (let i = 0; i < 12; i++) e.addBuilding('home', 'large', -380 + i * 40, 40, 'map', false, 0, 2);
    for (let i = 0; i < 18; i++) e.addBuilding('office', 'large', 100 + i * 40, -40, 'map', false); // 일자리도 충분히(주거 수요가 0이 되지 않게)
    const big = sim.growth.bars();
    expect(big.homeHigh / big.home).toBeGreaterThan(small.homeHigh / Math.max(small.home, 1e-9));
    expect(big.office).not.toBe(big.industrial);
  });
});
