import { describe, it, expect } from 'vitest';
import { Network } from '../src/sim/network';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { buildLaneGraph } from '../src/sim/lanes';
import { config } from '../src/config';
import type { Config } from '../src/config';

const road = (n: Network, x1: number, y1: number, x2: number, y2: number, k: 'road2' | 'road4' = 'road2') => n.buildRoad({ x: x1, y: y1 }, { x: x2, y: y2 }, k);
const run = (sim: Sim, ticks: number, each?: () => void) => { for (let i = 0; i < ticks; i++) { sim.step(); each?.(); } };
const KMH = 1 / 3.6;

describe('속도 제한', () => {
  it('고를 수 있는 값이고 도로 종류의 상한 이하일 때만 바뀐다. 기본값으로 돌리면 "바꾸지 않음"', () => {
    const n = new Network(config); road(n, 0, 0, 300, 0); // 왕복 2차로: 기본 50, 상한 60
    expect(n.setSpeedLimit(1, 30)).toEqual({ ok: true });
    expect(n.segments.get(1)!.playerSpeedKmh).toBe(30);
    expect(n.setSpeedLimit(1, 50)).toEqual({ ok: true }); // 기본값
    expect(n.segments.get(1)!.playerSpeedKmh).toBe(null);
    expect(n.setSpeedLimit(1, 80)).toEqual({ ok: false, error: 'badSpeed' }); // 2차로 상한(60) 초과
    expect(n.setSpeedLimit(1, 45)).toEqual({ ok: false, error: 'badSpeed' }); // 고를 수 없는 값
    expect(n.setSpeedLimit(99, 30)).toEqual({ ok: false, error: 'noSuchSegment' });
    expect(n.setSpeedLimit(1, 60).ok).toBe(true);
  });

  it('실행 취소로 되돌리고, 저장했다 불러와도 남는다', () => {
    const e = new Editor(config); e.build({ x: 0, y: 0 }, { x: 300, y: 0 }, 'road2');
    e.setSpeedLimit(1, 30);
    const text = e.exportText();
    const e2 = new Editor(config); e2.loadText(text);
    expect(e2.network.segments.get(1)!.playerSpeedKmh).toBe(30);
    e.undo();
    expect(e.network.segments.get(1)!.playerSpeedKmh).toBe(null);
  });

  it('차선의 제한속도는 바뀌지만 정체 지수의 기준 속도는 기본 제한속도 그대로', () => {
    const n = new Network(config); road(n, 0, 0, 300, 0); n.setSpeedLimit(1, 30);
    const lane = buildLaneGraph(n, config).tracks.find((t) => t.kind === 'lane')!;
    expect(lane.vmax).toBeCloseTo(30 * KMH);
    expect(lane.vbase).toBeCloseTo(50 * KMH);
  });

  it('차량은 제한속도를 지키고, 제한을 낮춰도 CI가 좋아지지 않는다(오히려 지체로 잡힌다)', () => {
    const maxCI = (limit: number | null) => {
      const n = new Network(config); road(n, 0, 0, 900, 0);
      if (limit) n.setSpeedLimit(1, limit);
      const sim = new Sim(config, n);
      sim.traffic.requestTrip({ segId: 1, t: 30 }, { segId: 1, t: 870 }, 3);
      let maxV = 0, ci = 0;
      run(sim, 20 * 120, () => { for (const v of sim.traffic.vehicles.values()) maxV = Math.max(maxV, v.v); ci = Math.max(ci, sim.metrics.rollingCI() ?? 0); });
      return { maxV, ci };
    };
    const slow = maxCI(30), normal = maxCI(null);
    expect(slow.maxV).toBeLessThanOrEqual(30 * KMH * 1.15 + 1e-6);
    expect(normal.ci).toBeLessThan(10); // 한산하면 원활
    expect(slow.ci).toBeGreaterThan(25); // 기본(50) 기준으로는 한참 느린 것이므로 지체
  });
});

describe('도로별 정체 지수(히트맵)', () => {
  it('통과 차량이 5대 미만이면 판정 없음(null), 5대 이상이면 값이 생긴다', () => {
    const n = new Network(config); road(n, 0, 0, 900, 0);
    const sim = new Sim(config, n);
    sim.traffic.requestTrip({ segId: 1, t: 30 }, { segId: 1, t: 870 }, 4);
    run(sim, 20 * 60);
    expect(sim.metrics.segmentCIs().get(1)).toBe(null); // 4대
    sim.traffic.requestTrip({ segId: 1, t: 30 }, { segId: 1, t: 870 }, 3);
    run(sim, 20 * 60);
    const ci = sim.metrics.segmentCIs().get(1);
    expect(ci).not.toBe(null); // 최근 윈도우 안에 5대 이상
    expect(ci!).toBeLessThan(10); // 한산
  });

  it('용량을 넘는 교차로의 접근 도로는 높은 CI(지체 이상)로 나오고, 한산한 도로는 낮다', () => {
    const cfg: Config = { ...config, driving: { ...config.driving, spawnIntervalSec: 6 } };
    const n = new Network(cfg);
    road(n, -200, 0, 200, 0); road(n, 0, -200, 0, 200);
    const sim = new Sim(cfg, n);
    const arm = (dx: number, dy: number) => { const s = [...n.segments.values()].find((sg) => [n.nodes.get(sg.a)!, n.nodes.get(sg.b)!].some((p) => p.x === dx && p.y === dy))!; const a = n.nodes.get(s.a)!; return { segId: s.id, t: a.x === dx && a.y === dy ? 60 : n.segmentLength(s) - 60 }; };
    const arms: [number, number][] = [[-200, 0], [0, -200], [200, 0], [0, 200]];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) sim.traffic.requestTrip(arm(...arms[i]), arm(...arms[j]), 40);
    let worst = 0;
    run(sim, 20 * 600, () => { for (const c of sim.metrics.segmentCIs().values()) if (c !== null) worst = Math.max(worst, c); });
    expect(worst).toBeGreaterThan(40);
  }, 120_000);
});
