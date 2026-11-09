import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { findRoute } from '../src/sim/route';

const cross = (len = 200) => { const e = new Editor(config); e.build({ x: -len, y: 0 }, { x: len, y: 0 }, 'road2'); e.build({ x: 0, y: -len }, { x: 0, y: len }, 'road2'); return e; };
const center = (e: Editor) => [...e.network.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id;
const armAt = (e: Editor, dx: number, dy: number) => [...e.network.segments.values()].find((s) => [e.network.nodes.get(s.a)!, e.network.nodes.get(s.b)!].some((p) => Math.abs(p.x - dx) < 1 && Math.abs(p.y - dy) < 1) && !s.oneWay)!;
const onArm = (e: Editor, dx: number, dy: number, dist: number) => { const s = armAt(e, dx, dy), n = e.network; const a = n.nodes.get(s.a)!; return { segId: s.id, t: Math.abs(a.x - dx) < 1 && Math.abs(a.y - dy) < 1 ? dist : n.segmentLength(s) - dist }; };

describe('회전교차로', () => {
  it('4갈래 교차로가 환형(반시계 일방통행) 4조각과 양보 표지로 바뀐다', () => {
    const e = cross(), n = e.network;
    const c = center(e);
    const r = e.makeRoundabout(c);
    expect(r.ok && r.ring.length).toBe(4);
    expect(n.nodes.has(c)).toBe(false);
    const ring = [...n.segments.values()].filter((s) => s.oneWay === 'ab');
    expect(ring.length).toBe(4);
    // 반시계: 각 조각은 각도가 커지는 방향
    for (const s of ring) { const a = n.nodes.get(s.a)!, b = n.nodes.get(s.b)!; let d = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x); if (d < 0) d += Math.PI * 2; expect(d).toBeGreaterThan(0); expect(d).toBeLessThan(Math.PI); }
    const arms = [...n.segments.values()].filter((s) => !s.oneWay);
    expect(arms.every((s) => s.signA === 'yield' || s.signB === 'yield')).toBe(true);
    expect(arms.every((s) => n.segmentLength(s) >= config.geometry.minSegmentLength)).toBe(true);
  });

  it('도로가 너무 짧거나 건물이 가깝거나 교차로가 아니면 바뀌지 않는다', () => {
    const e = cross(40);
    expect(e.makeRoundabout(center(e))).toEqual({ ok: false, error: 'tooShort' });
    const e2 = cross();
    e2.addBuilding('home', 'small', 20, 20, 'map', false);
    expect(e2.makeRoundabout(center(e2))).toEqual({ ok: false, error: 'onBuilding' });
    const leaf = [...e2.network.nodes.values()].find((p) => p.x === 200)!.id;
    expect(e2.makeRoundabout(leaf)).toEqual({ ok: false, error: 'notIntersection' });
    expect(e2.network.segments.size).toBe(4);
  });

  it('사방에서 서로 다른 방향으로 가는 차량 36대가 모두 환형을 거쳐 도착하고, 안전망·교착·충돌은 0', () => {
    const e = cross();
    e.makeRoundabout(center(e));
    const sim = new Sim(config, e.network);
    const dirs: [number, number][] = [[-200, 0], [200, 0], [0, -200], [0, 200]];
    let total = 0;
    for (const [dx, dy] of dirs) for (const [ex, ey] of dirs) {
      if (dx === ex && dy === ey) continue;
      const from = onArm(e, dx, dy, 15), to = onArm(e, ex, ey, 15);
      expect(findRoute(sim.traffic.graph, from, to)).not.toBeNull();
      sim.traffic.requestTrip(from, to, 3);
      total += 3;
    }
    for (let i = 0; i < 20 * 400; i++) sim.step();
    const st = sim.traffic.stats;
    expect(st.arrived).toBe(total);
    expect(st.interventions + st.deadlocks + st.conflicts).toBe(0);
  }, 120_000);

  it('3갈래도 바뀌고, 4차로 도로가 있으면 환형도 4차로이며, 저장·실행 취소가 된다', () => {
    const e = new Editor(config);
    e.build({ x: -200, y: 0 }, { x: 200, y: 0 }, 'road4');
    e.build({ x: 0, y: 0 }, { x: 0, y: 200 }, 'road2'); // T자(가운데 노드는 도로 위 점)
    const c3 = center(e);
    const r = e.makeRoundabout(c3);
    expect(r.ok && r.ring.length).toBe(3);
    expect([...e.network.segments.values()].filter((s) => s.oneWay).every((s) => s.kind === 'road4')).toBe(true);
    const e2 = new Editor(config); e2.loadText(e.exportText());
    expect([...e2.network.segments.values()].filter((s) => s.oneWay).length).toBe(3);
    e.undo();
    expect([...e.network.segments.values()].filter((s) => s.oneWay).length).toBe(0);
    expect([...e.network.nodes.values()].some((p) => p.x === 0 && p.y === 0)).toBe(true);
  });
});
