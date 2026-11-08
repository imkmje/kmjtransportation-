import { describe, it, expect } from 'vitest';
import { Network } from '../src/sim/network';
import { buildLaneGraph } from '../src/sim/lanes';
import { findRoute } from '../src/sim/route';
import { config } from '../src/config';

const net = () => new Network(config);
const road = (n: Network, x1: number, y1: number, x2: number, y2: number, k: 'road2' | 'road4' = 'road2') => n.buildRoad({ x: x1, y: y1 }, { x: x2, y: y2 }, k);
const graph = (n: Network) => buildLaneGraph(n, config);
const lanes = (g: ReturnType<typeof graph>) => g.tracks.filter((t) => t.kind === 'lane');
const conns = (g: ReturnType<typeof graph>) => g.tracks.filter((t) => t.kind === 'conn');

describe('차선 그래프', () => {
  it('왕복 2차로: 방향별 차선 1개씩, 오른쪽에 붙어 달린다', () => {
    const n = net(); road(n, 0, 0, 200, 0);
    const g = graph(n);
    const [fwd, bwd] = lanes(g);
    expect(lanes(g).length).toBe(2);
    expect(fwd.pts[0].y).toBeCloseTo(-1.75); // 동쪽으로 갈 때 오른쪽 = 남쪽(-y)
    expect(bwd.pts[0].y).toBeCloseTo(1.75);
    expect(fwd.pts[0].x).toBeCloseTo(3.5); // 노드에서 반폭(3.5m)만큼 떨어져 시작
    expect(fwd.length).toBeCloseTo(193);
    expect(bwd.pts[0].x).toBeGreaterThan(bwd.pts[1].x); // 반대 방향
  });
  it('왕복 4차로: 1번 차선이 중앙선에서 가장 멀다', () => {
    const n = net(); road(n, 0, 0, 200, 0, 'road4');
    const g = graph(n);
    const f = lanes(g).filter((t) => t.fwd);
    expect(f.map((t) => t.index)).toEqual([1, 2]);
    expect(f[0].pts[0].y).toBeCloseTo(-5.25);
    expect(f[1].pts[0].y).toBeCloseTo(-1.75);
  });
  it('막다른 끝마다 회차 연결선 1개(같은 번호 차선끼리)', () => {
    const n = net(); road(n, 0, 0, 200, 0, 'road4');
    const g = graph(n);
    expect(conns(g).length).toBe(4); // 끝 2곳 × 차선 2개
    expect(conns(g).every((c) => c.uturn)).toBe(true);
  });
  it('십자 교차로: 한 노드에서 다른 도로 3개로 12개 연결 + 막다른 끝 회차 4개', () => {
    const n = net(); road(n, -100, 0, 100, 0); road(n, 0, -100, 0, 100);
    const g = graph(n);
    expect(lanes(g).length).toBe(8);
    expect(conns(g).filter((c) => !c.uturn).length).toBe(12);
    expect(conns(g).filter((c) => c.uturn).length).toBe(4);
  });
  it('연결선은 들어오는 차선 끝과 나가는 차선 시작에 정확히 붙는다', () => {
    const n = net(); road(n, -100, 0, 100, 0); road(n, 0, -100, 0, 100);
    const g = graph(n);
    for (const t of g.tracks) {
      for (const id of t.next) {
        const u = g.tracks[id];
        const a = t.pts[t.pts.length - 1], b = u.pts[0];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
      }
    }
  });
  it('같은 도로망이면 같은 그래프(결정론)', () => {
    const make = () => { const n = net(); road(n, -100, 0, 100, 0); road(n, 0, -100, 0, 100, 'road4'); return JSON.stringify(graph(n).tracks); };
    expect(make()).toBe(make());
  });
});

describe('경로 탐색', () => {
  it('같은 도로 위 앞쪽으로: 차선 하나로 직진', () => {
    const n = net(); road(n, 0, 0, 400, 0);
    const r = findRoute(graph(n), { segId: 1, t: 100 }, { segId: 1, t: 300 })!;
    expect(r.path.length).toBe(1);
    expect(r.startS).toBeCloseTo(96.5);
    expect(r.endS).toBeCloseTo(296.5);
  });
  it('뒤쪽으로 가려면 반대 방향 차선을 쓴다', () => {
    const n = net(); road(n, 0, 0, 400, 0);
    const g = graph(n);
    const r = findRoute(g, { segId: 1, t: 300 }, { segId: 1, t: 100 })!;
    expect(g.tracks[r.path[0]].fwd).toBe(false);
  });
  it('교차로를 지나는 경로: 차선 → 연결선 → 차선, 모두 실제로 이어져 있다', () => {
    const n = net(); road(n, -100, 0, 100, 0); road(n, 0, -100, 0, 100);
    const g = graph(n);
    const west = [...n.segments.values()].find((s) => n.nodes.get(s.a)!.x === -100)!;
    const north = [...n.segments.values()].find((s) => n.nodes.get(s.b)!.y === 100)!;
    const r = findRoute(g, { segId: west.id, t: 30 }, { segId: north.id, t: 70 })!;
    expect(r).not.toBeNull();
    expect(g.tracks[r.path[1]].kind).toBe('conn');
    for (let i = 0; i < r.path.length - 1; i++) expect(g.tracks[r.path[i]].next).toContain(r.path[i + 1]);
  });
  it('이어지지 않은 도로로는 경로 없음', () => {
    const n = net(); road(n, 0, 0, 200, 0); road(n, 0, 500, 200, 500);
    expect(findRoute(graph(n), { segId: 1, t: 50 }, { segId: 2, t: 50 })).toBeNull();
  });
});
