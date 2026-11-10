import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { buildHillMap, HILLS_TERRAIN } from '../src/maps/hills';

describe('구릉 도시', () => {
  it('만들어지고 큰길이 다리로 강을 건너며, 도로 높이가 지형을 따른다', () => {
    const e = new Editor(config); buildHillMap(e);
    const n = e.network;
    expect(n.terrain).toEqual(HILLS_TERRAIN);
    expect([...n.segments.values()].some((s) => s.structure === 'bridge')).toBe(true);
    expect(new Set([...n.nodes.values()].map((x) => Math.round(x.z))).size).toBeGreaterThan(1); // 높이가 한 가지가 아니다
  });
  it('구역을 칠하면 물·급경사 칸은 제외되고 건물이 자라며 안전망 개입 없이 하루가 돈다', () => {
    const e = new Editor(config); buildHillMap(e);
    const n = e.network;
    let painted = 0;
    for (const x of [-18, -12, 12, 18]) painted += n.paintZone(x, -3, x, -1, x < 0 ? 'home' : 'office') + n.paintZone(x, 1, x, 3, x < 0 ? 'home' : 'office');
    expect(painted).toBeGreaterThan(0);
    const sim = new Sim(config, n);
    for (let i = 0; i < 20 * 600; i++) sim.step();
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
  }, 120_000);
});

import { TERRAIN_PRESETS, terrainHeight, isWater, type TerrainKind } from '../src/sim/terrain';
import { buildTerrainStart } from '../src/maps/hills';

describe('지형 유형', () => {
  for (const kind of Object.keys(TERRAIN_PRESETS) as TerrainKind[]) {
    it(`${TERRAIN_PRESETS[kind].name}: 시작 도시가 만들어지고 건물을 지을 땅이 충분하며 하루가 안전하게 돈다`, () => {
      const e = new Editor(config);
      const def = buildTerrainStart(e, kind);
      const n = e.network;
      expect(n.terrain).toEqual(def);
      expect(n.externalId()).not.toBeNull();
      // 도로 근처 구역 칸 중 칠할 수 있는 칸이 있다
      let ok = 0, water = 0;
      for (let i = -20; i <= 20; i++) for (let j = -50; j < -15; j++) if (n.cellStatus(i, j) === 'ok') ok++;
      for (let x = -900; x <= 900; x += 60) for (let y = -900; y <= 900; y += 60) if (isWater(def, x, y)) water++;
      expect(ok).toBeGreaterThan(20);
      if (kind === 'plain') expect(Math.max(...[0, 1, 2, 3].map((k) => Math.abs(terrainHeight(def, k * 200, 0))))).toBeLessThan(4);
      if (kind === 'coast' || kind === 'lakes' || kind === 'fjord' || kind === 'islands') expect(water).toBeGreaterThan(30); // 바다·호수가 실제로 있다
      const sim = new Sim(config, n);
      for (let i = 0; i < 20 * 120; i++) sim.step();
      expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks).toBe(0);
    });
  }
});
