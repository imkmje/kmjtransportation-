import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { roadSpan } from '../src/sim/network';
import { findRoute } from '../src/sim/route';

const lanes = (sim: Sim) => sim.traffic.graph.tracks.filter((t) => t.kind === 'lane');

describe('도로 종류: 비대칭 3·5차로와 일방통행 전용', () => {
  it('비대칭 3차로: 그리는 방향(a→b) 2차선, 반대 방향 1차선이고 차선 번호는 오른쪽부터다', () => {
    const e = new Editor(config);
    e.build({ x: 0, y: 0 }, { x: 300, y: 0 }, 'road3');
    const ls = lanes(new Sim(config, e.network));
    expect(ls.filter((t) => t.fwd).length).toBe(2);
    expect(ls.filter((t) => !t.fwd).length).toBe(1);
    // a→b는 +x 방향이라 오른쪽은 −y: 1번 차선이 가장 바깥(−y 쪽)
    const f1 = ls.find((t) => t.fwd && t.index === 1)!, f2 = ls.find((t) => t.fwd && t.index === 2)!, b1 = ls.find((t) => !t.fwd)!;
    expect(f1.pts[0].y).toBeLessThan(f2.pts[0].y);
    expect(b1.pts[0].y).toBeGreaterThan(f2.pts[0].y); // 반대 방향 차선은 중앙선 반대쪽(+y)
    expect(b1.pts[0].y).toBeCloseTo(1.75); expect(f2.pts[0].y).toBeCloseTo(-1.75); expect(f1.pts[0].y).toBeCloseTo(-5.25);
  });

  it('도로 단면: 비대칭 도로는 한쪽으로 치우치고, 일방통행은 한 방향 차선 폭만 가운데에 모인다', () => {
    const r3 = config.roads.road3, r4 = config.roads.road4;
    expect(roadSpan(r3, false)).toEqual({ right: 7, left: 3.5, width: 10.5, shift: -1.75 });
    expect(roadSpan(r4, false).width).toBe(14);
    expect(roadSpan(r4, true)).toEqual({ right: 3.5, left: 3.5, width: 7, shift: 0 });
  });

  it('비대칭 도로 위에서 양쪽으로 차량이 달려 도착하고, 교차로에서 차선별 방향 수가 방향마다 다르다', () => {
    const e = new Editor(config);
    e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road5');
    e.build({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2');
    const n = e.network;
    const west = [...n.segments.values()].find((s) => n.nodes.get(s.a)!.x === -300)!;
    const c = [...n.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id;
    expect(n.lanesIncoming(west.id, c)).toBe(3); // 서쪽 도로(a=−300,b=0): b로 들어오는 차선 = a→b 방향 3개
    expect(n.setLaneDirs(west.id, c, [6, 2, 3])).toEqual({ ok: true });
    expect(n.setLaneDirs(west.id, c, [6, 2, 3, 1])).toEqual({ ok: false, error: 'badValue' });
    n.setLaneDirs(west.id, c, []);
    const east = [...n.segments.values()].find((s) => n.nodes.get(s.b)!.x === 300)!;
    const sim = new Sim(config, n);
    sim.traffic.requestTrip({ segId: west.id, t: 20 }, { segId: east.id, t: 100 }, 5);
    sim.traffic.requestTrip({ segId: east.id, t: n.segmentLength(east) - 20 }, { segId: west.id, t: 100 }, 5);
    for (let i = 0; i < 20 * 150; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(10);
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
  }, 60_000);

  it('일방통행 도로 만들기: 그리는 방향으로만 가고 한 번의 취소로 사라진다', () => {
    const e = new Editor(config);
    const r = e.buildOneWay({ x: 0, y: 0 }, { x: 300, y: 0 }, 'road4');
    expect(r.ok).toBe(true);
    const n = e.network;
    expect([...n.segments.values()].every((s) => s.oneWay === 'ab' && s.kind === 'road4')).toBe(true);
    const sim = new Sim(config, n);
    const seg = [...n.segments.values()][0];
    expect(lanes(sim).length).toBe(2);
    expect(findRoute(sim.traffic.graph, { segId: seg.id, t: 30 }, { segId: seg.id, t: 250 })).not.toBeNull();
    expect(findRoute(sim.traffic.graph, { segId: seg.id, t: 250 }, { segId: seg.id, t: 30 })).toBeNull();
    e.undo();
    expect(n.segments.size).toBe(0);
  });

  it('비대칭 도로는 넓히기·좁히기 대상이 아니고 저장 왕복에서 종류가 유지된다', () => {
    const e = new Editor(config);
    e.build({ x: 0, y: 0 }, { x: 200, y: 0 }, 'road3');
    expect(e.upgrade([...e.network.segments.keys()][0])).toEqual({ ok: false, error: 'notUpgradable' });
    const e2 = new Editor(config); e2.loadText(e.exportText());
    expect([...e2.network.segments.values()][0].kind).toBe('road3');
  });
});
