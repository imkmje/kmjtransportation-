import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { terrainHeight, isWater, riverX, type TerrainDef } from '../src/sim/terrain';
import { findRoute } from '../src/sim/route';

const T: TerrainDef = { seed: 5, amp: 12, waterLevel: 0, river: true };
const withTerrain = () => { const e = new Editor(config); e.network.terrain = { ...T }; return e; };

describe('지형·강·다리', () => {
  it('높이 함수는 결정론이고, 지형이 없으면 0이다', () => {
    expect(terrainHeight(T, 123, -45)).toBe(terrainHeight({ ...T }, 123, -45));
    expect(terrainHeight(null, 123, -45)).toBe(0);
    expect(isWater(T, riverX(T, 0), 0)).toBe(true);
    expect(isWater(T, riverX(T, 0) + 300, 0)).toBe(false);
  });

  it('강을 가로지르는 도로는 다리가 되고, 강 한가운데에는 끝점을 둘 수 없다', () => {
    const e = withTerrain(), rx = riverX(T, 0);
    const r = e.build({ x: rx - 150, y: 0 }, { x: rx + 150, y: 0 }, 'road2');
    expect(r.ok).toBe(true);
    expect([...e.network.segments.values()][0].structure).toBe('bridge');
    expect(e.build({ x: riverX(T, 100), y: 100 }, { x: riverX(T, 100) + 40, y: 160 }, 'road2')).toMatchObject({ ok: false, error: 'inWater' });
    // 다리 위에서 갈라지는 교차로도 불가
    expect(e.build({ x: rx, y: 60 }, { x: rx, y: -60 }, 'road2')).toMatchObject({ ok: false }); // 다리와 교차하는 길(다리 위 교차로)은 불가
  });

  it('물 위가 너무 길면 다리를 놓을 수 없다', () => {
    const e = withTerrain();
    const t2 = { ...T, river: true }; e.network.terrain = t2;
    const rx = riverX(t2, 0);
    // 강을 따라 길게 놓으면 물 위 구간이 최대 길이를 넘는다
    const r = e.build({ x: rx, y: -400 }, { x: rx, y: 400 }, 'road2');
    expect(r.ok).toBe(false);
  });

  it('건물은 물 위에 지을 수 없고 노드 높이는 지형을 따른다', () => {
    const e = withTerrain(), rx = riverX(T, 0);
    expect(e.addBuilding('home', 'small', rx, 0)).toMatchObject({ ok: false, error: 'onWater' });
    e.build({ x: -300, y: 300 }, { x: -200, y: 300 }, 'road2');
    const n = [...e.network.nodes.values()][0];
    expect(n.z).toBeCloseTo(terrainHeight(T, n.x, n.y), 6);
  });

  it('너무 가파른 도로는 놓을 수 없다', () => {
    const e = new Editor({ ...config, terrain: { ...config.terrain, maxGrade: 0.001 } });
    e.network.terrain = { ...T, river: false };
    expect(e.build({ x: -200, y: 300 }, { x: 0, y: 300 }, 'road2')).toMatchObject({ ok: false, error: 'tooSteep' });
  });

  it('저장 형식 12: 지형이 저장·복원되고, 형식 11 파일은 평지로 열린다', () => {
    const e = withTerrain(), rx = riverX(T, 0);
    e.build({ x: rx - 150, y: 0 }, { x: rx + 150, y: 0 }, 'road2');
    const json = JSON.parse(e.exportText?.() ?? JSON.stringify(e.network.toJSON()));
    expect(json.formatVersion).toBe(12);
    const back = Network.parse(json, config);
    expect(back.terrain).toEqual(T);
    const old = { ...json, formatVersion: 11 }; delete old.terrain;
    expect(Network.parse(old, config).terrain).toBeNull();
  });

  it('차량이 다리를 건너 도착한다', () => {
    const e = withTerrain(), rx = riverX(T, 0);
    expect(e.build({ x: rx - 150, y: 0 }, { x: rx + 150, y: 0 }, 'road2').ok).toBe(true);
    const sim = new Sim(config, e.network), n = e.network, s = [...n.segments.values()][0];
    const A = { segId: s.id, t: 20 }, B = { segId: s.id, t: n.segmentLength(s) - 20 };
    expect(findRoute(sim.traffic.graph, A, B)).not.toBeNull();
    sim.traffic.requestTrip(A, B, 3);
    for (let i = 0; i < 20 * 120; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(3);
  }, 60_000);
});
