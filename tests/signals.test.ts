import { describe, it, expect } from 'vitest';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { findRoute } from '../src/sim/route';

const road = (n: Network, x1: number, y1: number, x2: number, y2: number) => n.buildRoad({ x: x1, y: y1 }, { x: x2, y: y2 }, 'road2');
const make = () => { const n = new Network(config); road(n, -200, 0, 200, 0); road(n, 0, -200, 0, 200); const c = [...n.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id; return { n, c }; };
const arm = (n: Network, dx: number, dy: number) => [...n.segments.values()].find((s) => [n.nodes.get(s.a)!, n.nodes.get(s.b)!].some((p) => p.x === dx && p.y === dy))!;
const onArm = (n: Network, dx: number, dy: number, dist: number) => { const s = arm(n, dx, dy); const a = n.nodes.get(s.a)!; return { segId: s.id, t: a.x === dx && a.y === dy ? dist : n.segmentLength(s) - dist }; };

describe('신호등', () => {
  it('교차로에서만 켤 수 있고, 십자는 마주 보는 쌍이 두 단계, T자는 한 쌍 + 혼자 한 단계', () => {
    const { n, c } = make();
    expect(n.setSignal(c, true)).toEqual({ ok: true });
    expect(n.setSignal(arm(n, -200, 0).a === c ? arm(n, -200, 0).b : arm(n, -200, 0).a, true)).toEqual({ ok: false, error: 'notIntersection' });
    const sim = new Sim(config, n);
    const ph = sim.traffic.signals.phases(c);
    expect(ph.length).toBe(2);
    expect(ph.every((p) => p.length === 2)).toBe(true);
    const t = new Network(config); road(t, -200, 0, 200, 0); road(t, 0, 0, 0, 200);
    const tc = [...t.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id;
    t.setSignal(tc, true);
    expect(new Sim(config, t).traffic.signals.phases(tc).map((p) => p.length).sort()).toEqual([1, 2]);
  });

  it('녹색 → 황색 → 전적색 순서로 돌고, 한 번에 한 단계만 녹색이다', () => {
    const { n, c } = make();
    n.setSignal(c, true);
    const sim = new Sim(config, n);
    const [a, b] = sim.traffic.signals.phases(c);
    const s = config.signals, rate = config.tickRate;
    const at = (sec: number, seg: number) => sim.traffic.signals.light(c, seg, Math.round(sec * rate));
    expect(at(1, a[0])).toBe('green'); expect(at(1, a[1])).toBe('green'); expect(at(1, b[0])).toBe('red');
    expect(at(s.greenSec + 1, a[0])).toBe('yellow');
    expect(at(s.greenSec + s.yellowSec + 0.5, a[0])).toBe('red');
    expect(at(s.greenSec + s.yellowSec + 0.5, b[0])).toBe('red'); // 전적색
    expect(at(s.greenSec + s.yellowSec + s.allRedSec + 1, b[0])).toBe('green');
    for (let t = 0; t < 120; t += 0.5) expect([a[0], b[0]].filter((id) => at(t, id) === 'green').length).toBeLessThanOrEqual(1);
  });

  it('신호가 켜지면 정지·양보 표지는 무시되고, 저장·불러오기로 유지된다', () => {
    const { n, c } = make();
    const s = arm(n, 0, -200);
    n.setSignal(c, true);
    n.setSign(s.id, c, 'stop');
    const sim = new Sim(config, n);
    expect(sim.traffic.graph.tracks.filter((t) => t.sign).length).toBe(0);
    const n2 = new Network(config);
    n2.load(Network.parse(JSON.parse(JSON.stringify(n.toJSON())), config));
    expect(n2.hasSignal(c)).toBe(true);
  });

  it('빨간불에서는 정지선을 넘지 않고, 사방에서 온 차량이 모두 충돌 없이 도착한다', () => {
    const { n, c } = make();
    n.setSignal(c, true);
    const sim = new Sim(config, n);
    const arms: [number, number][] = [[-200, 0], [200, 0], [0, -200], [0, 200]];
    let total = 0;
    for (const [dx, dy] of arms) for (const [ex, ey] of arms) {
      if (dx === ex && dy === ey) continue;
      for (let i = 0; i < 3; i++) {
        const r = findRoute(sim.traffic.graph, onArm(n, dx, dy, 10), onArm(n, ex, ey, 10));
        expect(r).not.toBeNull();
        sim.traffic.requestTrip(onArm(n, dx, dy, 10), onArm(n, ex, ey, 10), 1);
        total++;
      }
    }
    let violations = 0;
    const tracks = () => sim.traffic.graph.tracks;
    for (let i = 0; i < 20 * 400; i++) {
      sim.step();
      for (const v of sim.traffic.vehicles.values()) {
        const tr = tracks()[v.path[v.pi]];
        // 연결선(교차로 안)에 막 들어선 차량은 그 진입 방향의 신호가 적색이 아니어야 한다(황색 진입은 허용). 단 신호를 받은 지 1초 안(전적색 직전 진입)은 제외
        if (tr.kind === 'conn' && v.s < 1.5 && v.v > 2) {
          const L = sim.traffic.signals.light(c, tracks()[tr.src].segId, sim.tickCount);
          const L1 = sim.traffic.signals.light(c, tracks()[tr.src].segId, sim.tickCount - config.tickRate * 2);
          if (L === 'red' && L1 === 'red') violations++;
        }
      }
    }
    expect(sim.traffic.stats.arrived).toBe(total);
    expect(violations).toBe(0);
    expect(sim.traffic.stats.conflicts).toBe(0);
    expect(sim.traffic.stats.interventions).toBe(0);
    expect(sim.traffic.stats.deadlocks).toBe(0);
  }, 120_000);
});
