import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { EMPTY_NETWORK } from '../src/maps/sample';

const run = (sim: Sim, hours: number) => { const end = sim.tickCount + Math.round(hours * 150 * config.tickRate); while (sim.tickCount < end) sim.step(); };
const city = () => {
  const e = new Editor(config); e.loadData(EMPTY_NETWORK);
  e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road2');
  e.build({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2');
  e.addBuilding('home', 'large', -200, 40, 'map', false);
  e.addBuilding('office', 'large', 200, 40, 'map', false);
  return { e, sim: new Sim(config, e.network) };
};

describe('차량 정보·이동 흐름 조회', () => {
  it('차량 가까이를 찾고, 남은 경로 점이 지금 위치에서 시작해 목적지 쪽으로 이어진다', () => {
    const { sim } = city();
    run(sim, 3); // 08:00 — 아침 출근이 한창일 때(시작 시각 05:00)
    const vs = [...sim.traffic.vehicles.values()].filter((v) => v.meta?.kind === 'commute');
    expect(vs.length).toBeGreaterThan(3);
    const v = vs[0];
    expect(sim.traffic.vehicleNear({ x: v.x + 1, y: v.y + 1 }, 7)?.id).toBeLessThanOrEqual(v.id + 1000); // 가까운 차를 찾는다
    expect(sim.traffic.vehicleNear({ x: v.x + 500, y: v.y + 500 }, 7)).toBeNull(); // 멀면 없다
    const pts = sim.traffic.routePoints(v);
    expect(pts.length).toBeGreaterThan(1);
    expect(pts[0]).toEqual({ x: v.x, y: v.y });
    const dest = [...sim.demand['net'].buildings.values()].find((b) => b.id === v.meta!.to)!;
    const end = pts[pts.length - 1];
    expect(Math.hypot(end.x - dest.x, end.y - dest.y)).toBeLessThan(75); // 경로 끝은 목적지 건물 가까이
  }, 60_000);

  it('도로를 지나는 차량 목록은 경로에 그 도로가 있는 차량만이다', () => {
    const { e, sim } = city();
    run(sim, 3);
    const avenue = [...e.network.segments.values()].filter((s) => e.network.nodes.get(s.a)!.y === 0 && e.network.nodes.get(s.b)!.y === 0);
    const used = new Set(avenue.flatMap((s) => sim.traffic.vehiclesUsing(s.id).map((v) => v.id)));
    expect(used.size).toBeGreaterThan(0);
    const vertical = [...e.network.segments.values()].filter((s) => e.network.nodes.get(s.a)!.x === 0 && e.network.nodes.get(s.b)!.x === 0);
    for (const s of vertical) for (const v of sim.traffic.vehiclesUsing(s.id)) expect(v.path.some((id) => sim.traffic.graph.tracks[id].segId === s.id)).toBe(true);
  }, 60_000);
});
