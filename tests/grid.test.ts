import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { buildGridMap } from '../src/maps/grid';

describe('격자 도시', () => {
  it('도로·신호·회전교차로·구역·학교가 갖춰져 만들어진다', () => {
    const e = new Editor(config);
    buildGridMap(e);
    const n = e.network;
    expect(e.canUndo).toBe(false);
    expect([...n.nodes.values()].filter((x) => n.hasSignal(x.id)).length).toBe(3);
    expect([...n.nodes.values()].filter((x) => n.isActuated(x.id)).length).toBe(1);
    expect([...n.segments.values()].filter((s) => s.oneWay).length).toBeGreaterThanOrEqual(3); // 회전교차로 환형
    expect([...n.segments.values()].some((s) => s.locked)).toBe(true);
    const types = new Set(n.zones.values());
    expect(types).toEqual(new Set(['home', 'homeMid', 'homeHigh', 'shop', 'office', 'industrial']));
    expect(n.zones.size).toBeGreaterThan(300);
    expect([...n.buildings.values()].filter((b) => b.kind === 'school').length).toBe(2);
  });

  it('시간이 지나면 건물이 자라 출퇴근·외출·화물 이동이 생기고, 안전망·교착·충돌 없이 돈다', () => {
    const e = new Editor(config);
    buildGridMap(e);
    const sim = new Sim(config, e.network);
    const end = Math.round(((26 * 3600 - config.startClockHour * 3600) / 24) * config.tickRate); // 다음 날 02시까지
    const kinds = new Set<string>();
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { kinds.add(`${v.meta?.kind}/${v.meta?.mode}`); orig(v, t); };
    while (sim.tickCount < end) sim.step();
    const auto = [...e.network.buildings.values()].filter((b) => b.source === 'auto');
    expect(auto.length).toBeGreaterThan(30);
    expect(new Set(auto.map((b) => b.kind)).size).toBeGreaterThanOrEqual(4); // 주거·상업·사무·공장
    const st = sim.traffic.stats;
    expect(st.interventions + st.deadlocks + st.conflicts).toBe(0);
    expect(st.arrived).toBeGreaterThan(50);
  }, 240_000);
});
