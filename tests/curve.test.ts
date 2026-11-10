import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { curvePoints, CURVE_PIECE } from '../src/sim/curve';
import { findRoute } from '../src/sim/route';

describe('곡선 도로', () => {
  it('곡선 점 목록: 양 끝이 그대로이고 조각 길이가 고르며 최소 길이 이상이다', () => {
    const pts = curvePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 });
    expect(pts[0]).toEqual({ x: 0, y: 0 }); expect(pts[pts.length - 1]).toEqual({ x: 200, y: 200 });
    const L = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    expect(Math.min(...L)).toBeGreaterThanOrEqual(CURVE_PIECE - 1);
    expect(Math.max(...L) - Math.min(...L)).toBeLessThan(6);
    expect(curvePoints({ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 40, y: 0 }).length).toBeGreaterThanOrEqual(2);
  });

  it('곡선 도로는 이음 노드로 이어진 여러 구간이 되고, 취소 한 번으로 전체가 사라진다', () => {
    const e = new Editor(config);
    const r = e.buildCurve({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, 'road2');
    expect(r.ok).toBe(true);
    const n = e.network;
    expect(n.segments.size).toBeGreaterThanOrEqual(8);
    expect(n.jointChain([...n.segments.keys()][0]).length).toBe(n.segments.size); // 한 줄로 이어짐
    e.undo();
    expect(n.segments.size).toBe(0);
    expect(e.canUndo).toBe(false);
  });

  it('너무 급한 곡선은 아무것도 만들지 않고 실패한다(기존 도로 유지)', () => {
    const e = new Editor(config);
    e.build({ x: 0, y: 0 }, { x: 100, y: 0 }, 'road2');
    const before = e.network.segments.size;
    const r = e.buildCurve({ x: 100, y: 0 }, { x: 300, y: 5 }, { x: 100, y: 12 }, 'road2'); // 거의 U턴(헤어핀)
    expect(r.ok).toBe(false);
    expect(e.network.segments.size).toBe(before);
  });

  it('곡선 위를 차량이 달려 도착하고, 곡선을 기존 도로에 이을 수 있다', () => {
    const e = new Editor(config);
    e.build({ x: -200, y: 0 }, { x: 0, y: 0 }, 'road2');
    expect(e.buildCurve({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, 'road2').ok).toBe(true);
    const sim = new Sim(config, e.network);
    const n = e.network;
    const first = [...n.segments.values()][0], last = [...n.segments.values()].pop()!;
    const from = { segId: first.id, t: 20 }, to = { segId: last.id, t: n.segmentLength(last) - 15 };
    expect(findRoute(sim.traffic.graph, from, to)).not.toBeNull();
    sim.traffic.requestTrip(from, to, 4);
    for (let i = 0; i < 20 * 200; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(4);
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
  }, 60_000);

  it('짧은 조각(12m)의 곡선에서 양방향 40대가 안전망 개입·교착 없이 모두 도착한다', () => {
    const e = new Editor(config);
    e.build({ x: -200, y: 0 }, { x: 0, y: 0 }, 'road2');
    expect(e.buildCurve({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, 'road2').ok).toBe(true);
    e.build({ x: 200, y: 200 }, { x: 200, y: 400 }, 'road2');
    const sim = new Sim(config, e.network), n = e.network;
    const first = [...n.segments.values()][0], last = [...n.segments.values()].pop()!;
    const A = { segId: first.id, t: 20 }, B = { segId: last.id, t: n.segmentLength(last) - 15 };
    sim.traffic.requestTrip(A, B, 20); sim.traffic.requestTrip(B, A, 20);
    for (let i = 0; i < 20 * 400; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(40);
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
  }, 60_000);

  for (const kind of ['road4', 'road6'] as const) {
    it(`넓은 도로(${kind})의 12m 조각 곡선에서도 양방향 40대가 안전망 개입 없이 도착한다`, () => {
      const e = new Editor(config);
      e.build({ x: -200, y: 0 }, { x: 0, y: 0 }, kind);
      expect(e.buildCurve({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, kind).ok).toBe(true);
      e.build({ x: 200, y: 200 }, { x: 200, y: 400 }, kind);
      const sim = new Sim(config, e.network), n = e.network;
      const first = [...n.segments.values()][0], last = [...n.segments.values()].pop()!;
      const A = { segId: first.id, t: 20 }, B = { segId: last.id, t: n.segmentLength(last) - 15 };
      sim.traffic.requestTrip(A, B, 20); sim.traffic.requestTrip(B, A, 20);
      for (let i = 0; i < 20 * 400; i++) sim.step();
      expect(sim.traffic.stats.arrived).toBe(40);
      expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
    }, 60_000);
  }
});
