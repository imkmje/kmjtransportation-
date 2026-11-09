import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { findRoute } from '../src/sim/route';

const make = () => { const e = new Editor(config); e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road2'); return e; };
const lanes = (sim: Sim) => sim.traffic.graph.tracks.filter((t) => t.kind === 'lane');

describe('일방통행', () => {
  it('한쪽 방향 차선만 남고, 도로 가운데로 모이며, 가는 방향으로만 길이 있다', () => {
    const e = make(), n = e.network, seg = [...n.segments.values()][0];
    const sim0 = new Sim(config, n);
    expect(lanes(sim0).length).toBe(2);
    e.setOneWay(seg.id, 'ab');
    const sim = new Sim(config, n);
    const ls = lanes(sim);
    expect(ls.length).toBe(1);
    expect(ls[0].fwd).toBe(true);
    expect(Math.abs(ls[0].pts[0].y)).toBeLessThan(1e-9); // 가운데
    const aT = { segId: seg.id, t: 30 }, bT = { segId: seg.id, t: 270 };
    expect(findRoute(sim.traffic.graph, aT, bT)).not.toBeNull();
    expect(findRoute(sim.traffic.graph, bT, aT)).toBeNull();
    e.setOneWay(seg.id, 'ba');
    const sim2 = new Sim(config, n);
    expect(findRoute(sim2.traffic.graph, bT, aT)).not.toBeNull();
    expect(findRoute(sim2.traffic.graph, aT, bT)).toBeNull();
    e.setOneWay(seg.id, null);
    expect(lanes(new Sim(config, n)).length).toBe(2);
  });

  it('왕복 4차로 일방통행은 같은 방향 차선 2개가 가운데 좌우로 선다', () => {
    const e = new Editor(config);
    e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road4');
    e.setOneWay([...e.network.segments.keys()][0], 'ab');
    const ls = lanes(new Sim(config, e.network));
    expect(ls.length).toBe(2);
    const ys = ls.map((t) => t.pts[0].y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-1.75); expect(ys[1]).toBeCloseTo(1.75);
  });

  it('차량이 일방통행 방향으로 달려 모두 도착하고, 취소·저장이 되며 교차로를 거쳐도 이어진다', () => {
    const e = new Editor(config);
    e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road2');
    e.build({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2');
    const n = e.network;
    const west = [...n.segments.values()].find((s) => [n.nodes.get(s.a)!, n.nodes.get(s.b)!].some((p) => p.x === -300))!;
    e.setOneWay(west.id, 'ab'); // 서쪽 끝에서 교차로 쪽으로만
    const sim = new Sim(config, n);
    const from = { segId: west.id, t: 20 }, to = { segId: [...n.segments.values()].find((s) => [n.nodes.get(s.a)!, n.nodes.get(s.b)!].some((p) => p.y === 200))!.id, t: 60 };
    expect(findRoute(sim.traffic.graph, from, to)).not.toBeNull();
    sim.traffic.requestTrip(from, to, 5);
    for (let i = 0; i < 20 * 150; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(5);
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
    const e2 = new Editor(config); e2.loadText(e.exportText());
    expect([...e2.network.segments.values()].filter((s) => s.oneWay).length).toBe(1);
    e.undo();
    expect([...n.segments.values()].filter((s) => s.oneWay).length).toBe(0);
  }, 60_000);

  it('형식 8 파일(일방통행 없음)도 열리고, 잘못된 값은 거부', () => {
    const v8 = { formatVersion: 8, nextNodeId: 3, nextSegmentId: 2, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 100, y: 0, z: 0 }], segments: [{ id: 1, a: 1, b: 2, kind: 'road2', structure: 'ground', playerSpeedKmh: null, signA: null, signB: null }] };
    expect(Network.parse(v8, config).segments[0].oneWay).toBeNull();
    expect(() => Network.parse({ ...v8, segments: [{ ...v8.segments[0], oneWay: 'xx' }] }, config)).toThrow('손상');
  });
});
