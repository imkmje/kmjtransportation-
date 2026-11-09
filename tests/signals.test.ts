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

describe('감응식 신호', () => {
  it('차가 없는 방향은 건너뛰고, 차가 온 방향에 최소 녹색 뒤 넘어가며, 최대 녹색을 넘기지 않는다', () => {
    const { n, c } = make();
    n.setSignal(c, true, 'actuated');
    const sim = new Sim(config, n);
    const s = config.signals, rate = config.tickRate;
    const ph = sim.traffic.signals.phases(c);
    const west = arm(n, -200, 0).id, north = arm(n, 0, -200).id;
    const cur = () => ph.findIndex((p) => sim.traffic.signals.light(c, p[0], sim.tickCount) !== 'red');
    for (let i = 0; i < rate * 60; i++) sim.step(); // 차가 하나도 없으면 한 방향에 녹색으로 머문다
    const idle = cur();
    expect(idle).toBeGreaterThanOrEqual(0);
    expect(sim.traffic.signals.light(c, ph[idle][0], sim.tickCount)).toBe('green');
    // 녹색을 받지 않는 방향에 차 한 대
    const other = ph[1 - idle][0] === west || ph[1 - idle][0] === north ? ph[1 - idle][0] : ph[1 - idle][0];
    const seg = n.segments.get(other)!;
    const ox = n.nodes.get(seg.a === c ? seg.b : seg.a)!;
    const t0 = sim.tickCount;
    sim.traffic.requestTrip(onArm(n, ox.x, ox.y, 10), onArm(n, -ox.x, -ox.y, 10), 1);
    let switched = -1;
    for (let i = 0; i < rate * 80 && switched < 0; i++) { sim.step(); if (sim.traffic.signals.light(c, other, sim.tickCount) === 'green') switched = (sim.tickCount - t0) / rate; }
    expect(switched).toBeGreaterThan(0);
    expect(switched).toBeLessThan(s.maxGreenSec + s.yellowSec + s.allRedSec + 5);
    for (let i = 0; i < rate * 60; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(1);
  }, 60_000);

  it('사방 교통에서 모두 도착하고 충돌·교착이 없으며, 저장했다 이어 돌려도 같다', () => {
    const { n, c } = make();
    n.setSignal(c, true, 'actuated');
    const sim = new Sim(config, n);
    const arms: [number, number][] = [[-200, 0], [200, 0], [0, -200], [0, 200]];
    let total = 0;
    for (const [dx, dy] of arms) for (const [ex, ey] of arms) if (dx !== ex || dy !== ey) { sim.traffic.requestTrip(onArm(n, dx, dy, 10), onArm(n, ex, ey, 10), 3); total += 3; }
    for (let i = 0; i < 20 * 100; i++) sim.step();
    const saved = JSON.parse(JSON.stringify(sim.getState()));
    const n2 = new Network(config); n2.load(JSON.parse(JSON.stringify(n.toJSON())));
    const sim2 = new Sim(config, n2);
    sim2.setState(saved);
    for (let i = 0; i < 20 * 300; i++) { sim.step(); sim2.step(); }
    expect(sim2.getState()).toEqual(sim.getState());
    expect(sim.traffic.stats.arrived).toBe(total);
    expect(sim.traffic.stats.conflicts + sim.traffic.stats.interventions + sim.traffic.stats.deadlocks).toBe(0);
  }, 120_000);
});
