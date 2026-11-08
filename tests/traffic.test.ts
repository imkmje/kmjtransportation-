import { describe, it, expect } from 'vitest';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';

const road = (n: Network, x1: number, y1: number, x2: number, y2: number, k: 'road2' | 'road4' = 'road2') => n.buildRoad({ x: x1, y: y1 }, { x: x2, y: y2 }, k);
const setup = (build: (n: Network) => void) => { const n = new Network(config); build(n); return { n, sim: new Sim(config, n) }; };
const run = (sim: Sim, ticks: number, each?: () => void) => { for (let i = 0; i < ticks; i++) { sim.step(); each?.(); } };
const KMH = 1 / 3.6;

describe('차량 주행', () => {
  it('한 대가 목적지까지 달려 도착한다. 제한속도를 넘지 않는다', () => {
    const { sim } = setup((n) => road(n, 0, 0, 500, 0));
    expect(sim.traffic.requestTrip({ segId: 1, t: 50 }, { segId: 1, t: 450 }, 1).ok).toBe(true);
    let maxV = 0, ticks = 0;
    while (sim.traffic.stats.arrived === 0 && ticks < 4000) {
      sim.step(); ticks++;
      for (const v of sim.traffic.vehicles.values()) maxV = Math.max(maxV, v.v);
    }
    expect(sim.traffic.stats.arrived).toBe(1);
    expect(maxV).toBeLessThanOrEqual(50 * KMH * 1.15 + 1e-6);
    // 약 393m. 제한속도 50km/h(13.9m/s)보다 빨리는 못 온다
    expect(ticks / 20).toBeGreaterThan(393 / (50 * KMH * 1.15));
    expect(ticks / 20).toBeLessThan(80);
  });

  it('막다른 끝에서 1초 정지한 뒤 회차해 반대 차선으로 돌아온다', () => {
    const { n, sim } = setup((x) => road(x, 0, 0, 300, 0));
    const g = sim.traffic.graph;
    const bNode = [...n.nodes.values()].find((p) => p.x === 300)!.id;
    const fwd = g.tracks.find((t) => t.kind === 'lane' && t.fwd)!;
    const bwd = g.tracks.find((t) => t.kind === 'lane' && !t.fwd)!;
    const u = g.tracks.find((t) => t.uturn && t.from === bNode)!;
    const v = sim.traffic.spawnOnPath([fwd.id, u.id, bwd.id], 10, 100, 1)!;
    let waiting = 0, maxWait = 0, ticks = 0, wasWaitingAtEnd = false;
    while (sim.traffic.stats.arrived === 0 && ticks < 5000) {
      sim.step(); ticks++;
      if (v.status === '회차 대기') { waiting++; wasWaitingAtEnd = v.s > fwd.length - 1; } else { maxWait = Math.max(maxWait, waiting); waiting = 0; }
    }
    expect(sim.traffic.stats.arrived).toBe(1);
    expect(wasWaitingAtEnd).toBe(true);
    expect(maxWait).toBeGreaterThanOrEqual(20); // 시뮬 1.0초 = 20 tick
    expect(maxWait).toBeLessThanOrEqual(22);
  });

  it('빠른 차가 느린 앞차를 만나도 겹치지 않고 안전망 개입도 0건', () => {
    const { sim } = setup((n) => road(n, 0, 0, 1000, 0));
    const lane = sim.traffic.graph.tracks.find((t) => t.kind === 'lane' && t.fwd)!;
    const leader = sim.traffic.spawnOnPath([lane.id], 50, 900, 0.85)!;
    run(sim, 100); // 앞차가 충분히 앞서 나간 뒤
    const follower = sim.traffic.spawnOnPath([lane.id], 5, 900, 1.15)!;
    let minGap = Infinity;
    run(sim, 3000, () => {
      if (sim.traffic.vehicles.has(leader.id) && sim.traffic.vehicles.has(follower.id)) {
        minGap = Math.min(minGap, leader.s - leader.length - follower.s);
      }
    });
    expect(minGap).toBeGreaterThanOrEqual(0.5);
    expect(sim.traffic.stats.interventions).toBe(0);
    expect(minGap).toBeLessThan(40); // 실제로 따라붙었다(테스트가 의미 있다는 확인)
  });

  it('연속 투입: 간격을 두고 한 대씩 나오고, 서로 겹치지 않는다', () => {
    const { sim } = setup((n) => road(n, 0, 0, 800, 0));
    sim.traffic.requestTrip({ segId: 1, t: 30 }, { segId: 1, t: 760 }, 6);
    let minGap = Infinity, maxCount = 0;
    run(sim, 20 * 120, () => {
      const vs = [...sim.traffic.vehicles.values()].sort((a, b) => a.s - b.s);
      maxCount = Math.max(maxCount, vs.length);
      for (let i = 1; i < vs.length; i++) minGap = Math.min(minGap, vs[i].s - vs[i].length - vs[i - 1].s);
    });
    expect(sim.traffic.stats.spawned).toBe(6);
    expect(sim.traffic.stats.arrived).toBe(6);
    expect(minGap).toBeGreaterThanOrEqual(0.5);
    expect(sim.traffic.stats.interventions).toBe(0);
    expect(maxCount).toBeGreaterThan(1);
  });

  it('교차로를 지나도 순간이동 없이 이어서 달린다', () => {
    const { n, sim } = setup((x) => { road(x, -200, 0, 200, 0); road(x, 0, -200, 0, 200); });
    const west = [...n.segments.values()].find((s) => n.nodes.get(s.a)!.x === -200)!;
    const north = [...n.segments.values()].find((s) => n.nodes.get(s.b)!.y === 200)!;
    expect(sim.traffic.requestTrip({ segId: west.id, t: 50 }, { segId: north.id, t: 150 }, 1).ok).toBe(true);
    const kinds = new Set<string>();
    let prev: { x: number; y: number } | null = null, maxJump = 0, ticks = 0;
    while (sim.traffic.stats.arrived === 0 && ticks < 4000) {
      sim.step(); ticks++;
      for (const v of sim.traffic.vehicles.values()) {
        kinds.add(sim.traffic.graph.tracks[v.path[v.pi]].kind);
        if (prev) maxJump = Math.max(maxJump, Math.hypot(v.x - prev.x, v.y - prev.y));
        prev = { x: v.x, y: v.y };
      }
    }
    expect(sim.traffic.stats.arrived).toBe(1);
    expect(kinds.has('conn')).toBe(true);
    expect(maxJump).toBeLessThan(1.0); // 최대 속도 16m/s × 0.05초 = 0.8m
  });

  it('경로가 없으면 투입하지 않고 기록만 남긴다', () => {
    const { sim } = setup((n) => { road(n, 0, 0, 200, 0); road(n, 0, 500, 200, 500); });
    const r = sim.traffic.requestTrip({ segId: 1, t: 50 }, { segId: 2, t: 50 }, 3);
    expect(r).toEqual({ ok: false, reason: 'noRoute' });
    expect(sim.traffic.stats.noRoute).toBe(3);
    run(sim, 100);
    expect(sim.traffic.vehicles.size).toBe(0);
  });

  it('다른 곳에 도로를 더 놓아도 달리던 차량은 그대로 이어서 달린다', () => {
    const { n, sim } = setup((x) => road(x, 0, 0, 500, 0));
    sim.traffic.requestTrip({ segId: 1, t: 50 }, { segId: 1, t: 450 }, 3);
    run(sim, 200);
    const before = [...sim.traffic.vehicles.values()].map((v) => [v.id, Math.round(v.s)]);
    expect(before.length).toBeGreaterThan(0);
    road(n, 0, 200, 300, 200); // 상관없는 도로
    run(sim, 1);
    expect([...sim.traffic.vehicles.keys()]).toEqual(before.map((b) => b[0])); // 한 대도 사라지지 않았다
    run(sim, 20 * 90);
    expect(sim.traffic.stats.arrived).toBe(3); // 끝까지 간다
  });

  it('달리던 도로가 철거되면 그 위의 차량은 사라지고 미완료로 알린다', () => {
    const { n, sim } = setup((x) => road(x, 0, 0, 500, 0));
    const lost: string[] = [];
    sim.traffic.onLost = (_v, meta, reason) => lost.push(`${meta.kind}:${reason}`);
    sim.traffic.requestTrip({ segId: 1, t: 50 }, { segId: 1, t: 450 }, 3);
    run(sim, 200);
    const live = sim.traffic.vehicles.size;
    expect(live).toBeGreaterThan(0);
    n.removeSegment(1);
    run(sim, 1);
    expect(sim.traffic.vehicles.size).toBe(0);
    expect(lost.length).toBe(live);
    expect(lost.every((x) => x === 'test:removed')).toBe(true);
  });

  it('교차로가 생겨 도로 끝 여유가 바뀌어도 같은 도로 위 차량은 같은 자리에서 이어 달린다', () => {
    const { n, sim } = setup((x) => road(x, -300, 0, 300, 0));
    sim.traffic.requestTrip({ segId: 1, t: 20 }, { segId: 1, t: 280 }, 1);
    run(sim, 20 * 4);
    const v = [...sim.traffic.vehicles.values()][0];
    const before = { x: v.x, y: v.y };
    road(n, 0, -200, 0, 0); // 진행 방향 앞쪽에 T자 교차로가 생겨 도로가 둘로 나뉜다
    run(sim, 1);
    expect(sim.traffic.vehicles.has(v.id)).toBe(true);
    expect(Math.hypot(v.x - before.x, v.y - before.y)).toBeLessThan(1.5); // 한 tick에 1.5m 이상 순간이동하지 않는다
  });

  it('같은 입력이면 같은 결과(결정론)', () => {
    const once = () => {
      const { sim } = setup((n) => { road(n, -200, 0, 200, 0); road(n, 0, -200, 0, 200); });
      sim.traffic.requestTrip({ segId: 1, t: 30 }, { segId: 3, t: 150 }, 8);
      run(sim, 800);
      return JSON.stringify([...sim.traffic.vehicles.values()].map((v) => [v.id, v.pi, v.s, v.v, v.factor])) + JSON.stringify(sim.traffic.stats);
    };
    expect(once()).toBe(once());
  });
});
