import { describe, it, expect } from 'vitest';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config as base } from '../src/config';
import { findCycles, idm } from '../src/sim/traffic';
import { findRoute } from '../src/sim/route';
import type { Config } from '../src/config';

const car = base.vehicles.car;
const road = (n: Network, x1: number, y1: number, x2: number, y2: number, k: 'road2' | 'road4' = 'road2') => n.buildRoad({ x: x1, y: y1 }, { x: x2, y: y2 }, k);
const setup = (build: (n: Network) => void, cfg: Config = base) => { const n = new Network(cfg); build(n); return { n, sim: new Sim(cfg, n) }; };
const run = (sim: Sim, ticks: number, each?: () => void) => { for (let i = 0; i < ticks; i++) { sim.step(); each?.(); } };
// 십자 교차로: 서·동·남·북 팔 길이 200m. 도로 ID는 건설·분할 순서에 따라 정해지므로 위치로 찾는다
const cross = (k: 'road2' | 'road4' = 'road2') => (n: Network) => { road(n, -200, 0, 200, 0, k); road(n, 0, -200, 0, 200, k); };
const arm = (n: Network, dx: number, dy: number) => [...n.segments.values()].find((s) => { const a = n.nodes.get(s.a)!, b = n.nodes.get(s.b)!; return [a, b].some((p) => p.x === dx && p.y === dy); })!;
const center = (n: Network) => [...n.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id;
// 팔의 바깥쪽 끝에서 안쪽으로 dist m 들어온 도로 위 지점(t는 도로 시작 노드 a 기준 거리)
const onArm = (n: Network, dx: number, dy: number, dist: number) => {
  const s = arm(n, dx, dy);
  const a = n.nodes.get(s.a)!;
  const len = n.segmentLength(s);
  return { segId: s.id, t: a.x === dx && a.y === dy ? dist : len - dist };
};

describe('IDM', () => {
  it('앞이 비면 최대 가속, 목표 속도에 가까우면 0, 앞차가 너무 가까우면 강한 감속', () => {
    expect(idm(car, 0, 14, Infinity, 0, car.s0)).toBeCloseTo(car.a);
    expect(Math.abs(idm(car, 14, 14, Infinity, 0, car.s0))).toBeLessThan(1e-9);
    expect(idm(car, 14, 14, 5, 0, car.s0)).toBeLessThan(-5);
    expect(Math.abs(idm(car, 0, 14, car.s0, 0, car.s0))).toBeLessThan(1e-9); // 정지 상태에서 최소 간격이면 평형
  });
  it('멈춘 상태에서 출발해 제한속도 근처까지 올라가고 넘지 않는다', () => {
    const { sim } = setup((n) => road(n, 0, 0, 1500, 0));
    const lane = sim.traffic.graph.tracks.find((t) => t.kind === 'lane' && t.fwd)!;
    const v = sim.traffic.spawnOnPath([lane.id], 5, 1400, 1)!;
    let maxV = 0, v10 = 0;
    run(sim, 20 * 60, () => { maxV = Math.max(maxV, v.v); if (sim.tickCount === 200) v10 = v.v; });
    expect(maxV).toBeGreaterThan(50 / 3.6 - 0.5);
    expect(maxV).toBeLessThanOrEqual(50 / 3.6 + 1e-6);
    expect(v10).toBeGreaterThan(10); // 10초면 36km/h 이상
    expect(v10).toBeLessThan(50 / 3.6); // 아직 다 올라가진 않았다(급가속 아님)
  });
});

describe('차선 변경', () => {
  const fwdLanes = (sim: Sim) => sim.traffic.graph.tracks.filter((t) => t.kind === 'lane' && t.fwd);
  it('느린 앞차를 만나면 옆 차선으로 비켜 추월하고, 겹치지 않는다', () => {
    const { sim } = setup((n) => road(n, 0, 0, 1500, 0, 'road4'));
    const [lane1] = fwdLanes(sim); // 1번 차선(오른쪽)
    const slow = sim.traffic.spawnOnPath([lane1.id], 100, 1300, 0.85)!;
    run(sim, 60);
    const fast = sim.traffic.spawnOnPath([lane1.id], 10, 1300, 1.15)!;
    let overtook = false, minGap = Infinity;
    run(sim, 20 * 90, () => {
      const ft = sim.traffic.graph.tracks[fast.path[fast.pi]], st = sim.traffic.graph.tracks[slow.path[slow.pi]];
      if (ft.index !== st.index && fast.s > slow.s) overtook = true;
      if (ft.id === st.id && slow.s > fast.s) minGap = Math.min(minGap, slow.s - slow.length - fast.s);
    });
    expect(sim.traffic.stats.laneChanges).toBeGreaterThanOrEqual(1);
    expect(overtook).toBe(true);
    expect(minGap).toBeGreaterThanOrEqual(0.5);
    expect(sim.traffic.stats.interventions).toBe(0);
  });
  it('혼자 달릴 때는(이득이 없으니) 차선을 바꾸지 않는다', () => {
    const { sim } = setup((n) => road(n, 0, 0, 1500, 0, 'road4'));
    const lane2 = fwdLanes(sim)[1];
    sim.traffic.spawnOnPath([lane2.id], 10, 1400, 1);
    run(sim, 20 * 60);
    expect(sim.traffic.stats.laneChanges).toBe(0);
  });
  it('차선에 막 들어선 직후(차 길이 + 10m 이내)에는 재량 차선 변경을 하지 않는다', () => {
    const { sim } = setup((n) => road(n, 0, 0, 800, 0, 'road4'));
    const [lane1] = fwdLanes(sim);
    sim.traffic.spawnOnPath([lane1.id], 45, 700, 0.85)!.v = 3; // 앞에 느린 차
    const fast = sim.traffic.spawnOnPath([lane1.id], 2, 700, 1.15)!; // 차선 시작 직후, 따라붙으면 차선을 바꾸고 싶어질 차
    fast.v = 9;
    let atChange = -1;
    run(sim, 20 * 20, () => { if (atChange < 0 && sim.traffic.graph.tracks[fast.path[fast.pi]].index !== 1) atChange = fast.s; });
    expect(atChange).toBeGreaterThan(0); // 결국 차선을 바꿨고
    expect(atChange).toBeGreaterThanOrEqual(fast.length + 10 - 1); // 바꾼 위치는 차선 시작에서 14.5m 이상
  });
  it('끝(정지선) 30m 안에서는 재량 차선 변경을 하지 않는다. 멀리서는 같은 상황에서 바꾼다(대조)', () => {
    const scenario = (fromEnd: number) => {
      const { sim } = setup((n) => road(n, 0, 0, 400, 0, 'road4'));
      const [lane1] = fwdLanes(sim);
      const slow = sim.traffic.spawnOnPath([lane1.id], lane1.length - fromEnd + 14, lane1.length - 1, 0.85)!;
      slow.v = 3;
      const fast = sim.traffic.spawnOnPath([lane1.id], lane1.length - fromEnd, lane1.length - 1, 1.15)!;
      fast.v = 10;
      run(sim, 20 * 4);
      return sim.traffic.stats.laneChanges;
    };
    expect(scenario(29)).toBe(0); // 맨 앞차가 정지선 앞 15m, 뒤차 29m
    expect(scenario(130)).toBeGreaterThanOrEqual(1); // 같은 배치를 멀리서 하면 차선을 바꾼다
  });
});

describe('교차로: 우선순위·충돌 점유', () => {
  it('4개 접근로에서 동시에 도착해도 막히지 않고 모두 지나간다(타이브레이크)', () => {
    const { n, sim } = setup(cross());
    const dirs: [number, number][] = [[-200, 0], [0, -200], [200, 0], [0, 200]];
    dirs.forEach(([dx, dy], i) => {
      const [ox, oy] = dirs[(i + 2) % 4];
      expect(sim.traffic.requestTrip(onArm(n, dx, dy, 60), onArm(n, ox, oy, 60), 1).ok).toBe(true); // 맞은편으로 직진
    });
    run(sim, 20 * 90);
    expect(sim.traffic.stats.arrived).toBe(4);
    expect(sim.traffic.stats.conflicts).toBe(0);
    expect(sim.traffic.stats.deadlocks).toBe(0);
    expect(sim.traffic.stats.interventions).toBe(0);
  });
  it('좌회전 차량은 맞은편 직진 차량에게 양보한다(같은 시각에 도착해도 직진이 먼저)', () => {
    const { n, sim } = setup(cross());
    const g = sim.traffic.graph;
    const straight = findRoute(g, onArm(n, -200, 0, 60), onArm(n, 200, 0, 60))!; // 서 → 동 직진
    const left = findRoute(g, onArm(n, 200, 0, 60), onArm(n, 0, -200, 60))!; // 동 → 남 좌회전
    expect(g.tracks[straight.path[1]].turn).toBe('straight');
    expect(g.tracks[left.path[1]].turn).toBe('left');
    // 속도 계수와 거리가 같아 두 차량이 같은 순간에 정지선 앞 요청 구간에 들어온다
    const vs = sim.traffic.spawnOnPath(straight.path, straight.startS, straight.endS, 1)!;
    const vl = sim.traffic.spawnOnPath(left.path, left.startS, left.endS, 1)!;
    const enter: Record<number, number> = {};
    run(sim, 20 * 60, () => {
      for (const v of [vs, vl]) if (!(v.id in enter) && g.tracks[v.path[v.pi]].kind === 'conn') enter[v.id] = sim.tickCount;
    });
    expect(enter[vs.id]).toBeDefined();
    expect(enter[vl.id]).toBeDefined();
    expect(enter[vs.id]).toBeLessThan(enter[vl.id]); // 직진이 먼저 들어간다
    expect(sim.traffic.stats.conflicts).toBe(0);
    expect(sim.traffic.stats.arrived).toBe(2);
  });
});

describe('정지·양보 표지', () => {
  const withSign = (kind: 'stop' | 'yield' | null) => {
    const { n, sim } = setup(cross());
    if (kind) expect(n.setSign(arm(n, 0, -200).id, center(n), kind).ok).toBe(true);
    sim.traffic.sync(); // 표지를 바꾸면 도로망이 바뀐 것이므로 그래프가 새로 만들어진다
    return { n, sim, g: sim.traffic.graph };
  };
  const nearLine = (sim: Sim, v: { path: number[]; pi: number; s: number }) => {
    const t = sim.traffic.graph.tracks[v.path[v.pi]];
    return t.kind === 'lane' && t.length - v.s < 2;
  };

  it('정지 표지: 정지선에서 완전히 1초 이상 선 뒤에 출발한다', () => {
    const { n, sim, g } = withSign('stop');
    const r = findRoute(g, onArm(n, 0, -200, 80), onArm(n, 0, 200, 60))!;
    const v = sim.traffic.spawnOnPath(r.path, r.startS, r.endS, 1)!;
    let run0 = 0, maxRun = 0, sawStatus = false, entered = false;
    run(sim, 20 * 90, () => {
      if (!entered && nearLine(sim, v) && v.v < 0.1) { run0++; maxRun = Math.max(maxRun, run0); } else run0 = 0;
      if (v.status === '정지 표지') sawStatus = true;
      if (g.tracks[v.path[v.pi]]?.kind === 'conn') entered = true;
    });
    expect(maxRun).toBeGreaterThanOrEqual(20); // 시뮬 1.0초
    expect(maxRun).toBeLessThan(30);
    expect(sawStatus).toBe(true);
    expect(sim.traffic.stats.arrived).toBe(1);
  });
  it('대조: 표지가 없으면 멈추지 않고 지나간다', () => {
    const { n, sim, g } = withSign(null);
    const r = findRoute(g, onArm(n, 0, -200, 80), onArm(n, 0, 200, 60))!;
    const v = sim.traffic.spawnOnPath(r.path, r.startS, r.endS, 1)!;
    let minNear = Infinity;
    run(sim, 20 * 40, () => { if (g.tracks[v.path[v.pi]]?.kind === 'lane' && g.tracks[v.path[v.pi]].length - v.s < 15 && v.pi === 0) minNear = Math.min(minNear, v.v); });
    expect(minNear).toBeGreaterThan(5);
  });
  it('정지 표지 쪽 차량은 표지 없는 큰길 차량에게 양보한다(먼저 도착했어도)', () => {
    const { n, sim, g } = withSign('stop');
    const minor = findRoute(g, onArm(n, 0, -200, 175), onArm(n, 0, 200, 60))!; // 남 → 북, 정지 표지 쪽: 정지선까지 약 18m로 먼저 도착한다
    const major = findRoute(g, onArm(n, -200, 0, 63), onArm(n, 200, 0, 60))!; // 서 → 동 직진: 정지선까지 약 130m
    const vm = sim.traffic.spawnOnPath(minor.path, minor.startS, minor.endS, 1)!;
    const vj = sim.traffic.spawnOnPath(major.path, major.startS, major.endS, 1)!;
    const enter: Record<number, number> = {};
    let sawYield = false;
    run(sim, 20 * 60, () => {
      for (const v of [vm, vj]) if (!(v.id in enter) && g.tracks[v.path[v.pi]]?.kind === 'conn') enter[v.id] = sim.tickCount;
      if (vm.status === '양보') sawYield = true;
    });
    expect(enter[vj.id]).toBeLessThan(enter[vm.id]);
    expect(sawYield).toBe(true);
    expect(sim.traffic.stats.conflicts).toBe(0);
    expect(sim.traffic.stats.arrived).toBe(2);
  });
  it('양보 표지: 멈추지 않고, 정지선에서 20km/h가 되도록 부드럽게(급제동 없이) 줄인다', () => {
    const { n, sim, g } = withSign('yield');
    const r = findRoute(g, onArm(n, 0, -200, 100), onArm(n, 0, 200, 60))!;
    const v = sim.traffic.spawnOnPath(r.path, r.startS, r.endS, 1)!;
    let atLine = 0, minV = Infinity, minAcc = 0;
    run(sim, 20 * 40, () => {
      const len = g.tracks[r.path[0]].length;
      if (v.pi === 0 && len - v.s < 40) { minV = Math.min(minV, v.v); minAcc = Math.min(minAcc, v.acc); }
      if (v.pi === 0 && len - v.s < 2) atLine = v.v;
    });
    expect(atLine).toBeLessThanOrEqual(20 / 3.6 + 1.5); // 20km/h 안팎(±5km/h)
    expect(atLine).toBeGreaterThan(3); // 서지 않고 통과한다
    expect(minV).toBeGreaterThan(3);
    expect(minAcc).toBeGreaterThan(-3); // 급제동(-6) 없이 부드럽게
    expect(sim.traffic.stats.arrived).toBe(1);
  });
});

describe('출구 공간 점검', () => {
  it('나갈 차선이 막혀 있으면 정지선에서 기다리고, 풀리면 지나간다', () => {
    const { n, sim } = setup(cross());
    const g = sim.traffic.graph;
    const r = findRoute(g, onArm(n, -200, 0, 80), onArm(n, 200, 0, 60))!;
    const blocker = sim.traffic.spawnOnPath([r.path[2]], 3, 150, 1)!; // 나갈 차선 맨 앞에 고정된 차
    blocker.hold = true;
    const v = sim.traffic.spawnOnPath(r.path, r.startS, r.endS, 1)!;
    let everInside = false;
    run(sim, 20 * 30, () => { if (g.tracks[v.path[v.pi]].kind === 'conn') everInside = true; });
    expect(everInside).toBe(false); // 교차로 안으로 들어가지 않았다
    expect(v.pi).toBe(0);
    expect(v.status).toBe('출구 공간 없음');
    expect(v.s).toBeGreaterThan(g.tracks[r.path[0]].length - 3); // 정지선에 붙어 서 있다
    blocker.hold = false;
    run(sim, 20 * 60);
    expect(sim.traffic.stats.arrived).toBe(2);
    expect(sim.traffic.stats.conflicts).toBe(0);
  });
});

describe('교착 탐지·해소', () => {
  it('순환 찾기: 서로 기다리는 고리만 찾는다', () => {
    const cyc = findCycles(new Map([[1, 2], [2, 3], [3, 1], [4, 1], [5, 6]]));
    expect(cyc.length).toBe(1);
    expect([...cyc[0]].sort()).toEqual([1, 2, 3]);
    expect(findCycles(new Map([[1, 2], [2, 3]])).length).toBe(0);
    expect(findCycles(new Map([[1, 1]])).length).toBe(1); // 자기 자신을 기다리는 경우도 순환
  });
  it('서로 기다리는 두 차량이 설정 시간 이상 풀리지 않으면 1단계(면제) 후 2단계(제거)', () => {
    const cfg: Config = { ...base, deadlock: { detectSec: 1, persistSec: 10, stage2Sec: 5 } };
    const { sim } = setup((n) => road(n, 0, 0, 600, 0, 'road4'), cfg);
    const [l1, l2] = sim.traffic.graph.tracks.filter((t) => t.kind === 'lane' && t.fwd);
    const x = sim.traffic.spawnOnPath([l1.id], 100, 500, 1)!;
    const y = sim.traffic.spawnOnPath([l2.id], 100, 500, 1)!;
    x.hold = y.hold = true;
    x.holdFor = y.id; y.holdFor = x.id;
    run(sim, 20 * 9);
    expect(sim.traffic.stats.deadlocks).toBe(0); // 아직 설정 시간 전
    run(sim, 20 * 3);
    expect(sim.traffic.stats.deadlocks).toBe(1);
    expect(x.waiver || y.waiver).toBe(true); // 1단계: 가장 오래 기다린 차에 면제
    run(sim, 20 * 8);
    expect(sim.traffic.stats.removed).toBe(1); // 2단계: 그래도 안 풀려 제거
    expect(sim.traffic.vehicles.size).toBe(1);
  });
  it('일반 시나리오(4지 교차로 동시 도착)에서는 교착이 0건', () => {
    const { n, sim } = setup(cross('road4'));
    for (const [dx, dy, ox, oy] of [[-200, 0, 200, 0], [200, 0, -200, 0], [0, -200, 0, 200], [0, 200, 0, -200]]) sim.traffic.requestTrip(onArm(n, dx, dy, 60), onArm(n, ox, oy, 60), 5);
    run(sim, 20 * 200);
    expect(sim.traffic.stats.deadlocks).toBe(0);
    expect(sim.traffic.stats.arrived).toBe(20);
  });
});

describe('설계서 완료 기준: 4지 교차로에 차량 1,000대', () => {
  for (const kind of ['road2', 'road4'] as const) {
    it(`왕복 ${kind === 'road2' ? '2' : '4'}차로: 충돌 지점 동시 점유 0, 안전망 개입 0, 교착 0, 전 차량 도착`, () => {
      // 신호 없는 4지 교차로의 처리 용량은 초당 약 0.4대. 수요를 초당 0.3대(12개 흐름 × 40초 간격)로 넣어 대기 한도(5분) 안에서 모두 지나가게 한다
      const cfg: Config = { ...base, driving: { ...base.driving, spawnIntervalSec: 40 } };
      const { n, sim } = setup(cross(kind), cfg);
      const arms: [number, number][] = [[-200, 0], [0, -200], [200, 0], [0, 200]];
      let pair = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        const count = 83 + (pair++ < 4 ? 1 : 0); // 83×12 + 4 = 1,000대
        expect(sim.traffic.requestTrip(onArm(n, arms[i][0], arms[i][1], 60), onArm(n, arms[j][0], arms[j][1], 60), count).ok).toBe(true);
      }
      const st = sim.traffic.stats;
      let ticks = 0, maxLive = 0;
      while (st.arrived + st.abandoned + st.removed < 1000 && ticks < 20 * 4000) { sim.step(); ticks++; maxLive = Math.max(maxLive, sim.traffic.vehicles.size); }
      expect(st.spawned + st.abandoned).toBe(1000);
      expect(st.arrived).toBe(1000);
      expect(st.conflicts).toBe(0);
      expect(st.interventions).toBe(0);
      expect(st.deadlocks).toBe(0);
      expect(maxLive).toBeGreaterThan(5); // 실제로 여러 대가 몰렸다
    }, 180_000);
  }
});

describe('결정론', () => {
  it('교차로·차선 변경이 있어도 같은 입력이면 같은 결과', () => {
    const once = () => {
      const { n, sim } = setup(cross('road4'));
      const arms: [number, number][] = [[-200, 0], [0, -200], [200, 0], [0, 200]];
      for (let i = 0; i < 4; i++) sim.traffic.requestTrip(onArm(n, arms[i][0], arms[i][1], 60), onArm(n, arms[(i + 1) % 4][0], arms[(i + 1) % 4][1], 60), 12);
      run(sim, 20 * 90);
      return JSON.stringify([...sim.traffic.vehicles.values()].map((v) => [v.id, v.path, v.pi, v.s, v.v])) + JSON.stringify(sim.traffic.stats);
    };
    expect(once()).toBe(once());
  });
});

describe('여러 교차로가 이어진 격자 도시', () => {
  for (const kind of ['road2', 'road4'] as const) {
    it(`왕복 ${kind === 'road2' ? '2' : '4'}차로 4×4 격자, 무작위 흐름 40개: 충돌 0, 안전망 0, 교착 0`, () => {
      const cfg: Config = { ...base, driving: { ...base.driving, spawnIntervalSec: 1 } };
      const n = new Network(cfg);
      const L = 160, N = 4, off = ((N - 1) * L) / 2;
      for (let i = 0; i < N; i++) road(n, -off - 100, -off + i * L, off + 100, -off + i * L, kind);
      for (let i = 0; i < N; i++) expect(road(n, -off + i * L, -off - 100, -off + i * L, off + 100, kind).ok).toBe(true);
      const sim = new Sim(cfg, n);
      const ends = [...n.nodes.values()].filter((p) => n.segmentsAt(p.id).length === 1);
      let seed = 777;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; // 테스트용 고정 난수
      const at = (id: number, d: number) => { const sg = n.segmentsAt(id)[0]; return { segId: sg.id, t: sg.a === id ? d : n.segmentLength(sg) - d }; };
      for (let f = 0; f < 40; f++) {
        const a = ends[Math.floor(rnd() * ends.length)], b = ends[Math.floor(rnd() * ends.length)];
        if (a !== b) sim.traffic.requestTrip(at(a.id, 40), at(b.id, 40), 25);
      }
      let maxLive = 0;
      run(sim, 20 * 600, () => { maxLive = Math.max(maxLive, sim.traffic.vehicles.size); });
      const st = sim.traffic.stats;
      expect(maxLive).toBeGreaterThan(150); // 실제로 많이 몰렸다
      expect(st.arrived).toBeGreaterThan(300);
      expect(st.conflicts).toBe(0);
      expect(st.interventions).toBe(0);
      expect(st.deadlocks).toBe(0);
    }, 120_000);
  }
});
