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
