import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { findRoute } from '../src/sim/route';

const make = () => { const e = new Editor(config); e.build({ x: -200, y: 0 }, { x: 200, y: 0 }, 'road2'); e.build({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2'); return e; };
const center = (n: Network) => [...n.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id;
const arm = (n: Network, dx: number, dy: number) => [...n.segments.values()].find((s) => [n.nodes.get(s.a)!, n.nodes.get(s.b)!].some((p) => p.x === dx && p.y === dy))!;
const onArm = (n: Network, dx: number, dy: number, dist: number) => { const s = arm(n, dx, dy); const a = n.nodes.get(s.a)!; return { segId: s.id, t: a.x === dx && a.y === dy ? dist : n.segmentLength(s) - dist }; };
const reach = (e: Editor, from: [number, number]) => {
  const sim = new Sim(config, e.network), n = e.network;
  return (['W', 'E', 'S', 'N'] as const).map((k, i) => { const to = ([[-200, 0], [200, 0], [0, -200], [0, 200]] as const)[i]; return (to[0] === from[0] && to[1] === from[1]) ? null : [k, findRoute(sim.traffic.graph, onArm(n, from[0], from[1], 10), onArm(n, to[0], to[1], 10)) !== null] as const; }).filter(Boolean);
};

describe('통행 제한', () => {
  it('제한이 없으면 서쪽 팔에서 다른 세 방향 모두 갈 수 있다', () => {
    expect(reach(make(), [-200, 0])).toEqual([['E', true], ['S', true], ['N', true]]);
  });

  it('좌회전 금지: 그 접근로의 좌회전 연결만 없어지고 직진·우회전은 남는다. 다른 접근로는 그대로(막다른 길로 돌아 나오는 우회는 가능)', () => {
    const e = make(), n = e.network;
    const turns = (seg: number) => { const g = new Sim(config, n).traffic.graph; return g.tracks.filter((t) => t.kind === 'conn' && g.tracks[t.src].segId === seg && !t.uturn).map((t) => t.turn); };
    const west = arm(n, -200, 0).id, east = arm(n, 200, 0).id;
    expect(turns(west)).toContain('left');
    e.setRestrict(west, center(n), 'noLeft');
    expect(turns(west)).not.toContain('left');
    expect(turns(west)).toContain('straight');
    expect(turns(west)).toContain('right');
    expect(turns(east)).toContain('left');
    expect(reach(e, [-200, 0]).find((x) => x![0] === 'E')![1]).toBe(true);
  });

  it('진입 금지: 교차로에서 그 도로로 들어가는 것만 막히고, 그 도로에서 나오는 것은 된다', () => {
    const e = make(), n = e.network;
    e.setRestrict(arm(n, 200, 0).id, center(n), 'noEntry');
    expect(reach(e, [-200, 0]).find((x) => x![0] === 'E')![1]).toBe(false);
    expect(reach(e, [200, 0]).every((x) => x![1])).toBe(true); // 동쪽에서 나오는 것은 된다
  });

  it('교차로가 아닌 곳에는 못 놓고, 다시 놓으면 풀 수 있으며, 실행 취소·저장이 된다', () => {
    const e = make(), n = e.network, c = center(n);
    const far = arm(n, -200, 0);
    const farNode = far.a === c ? far.b : far.a;
    expect(e.setRestrict(far.id, farNode, 'noLeft')).toEqual({ ok: false, error: 'notIntersection' });
    e.setRestrict(far.id, c, 'noEntry');
    expect(n.restrictAt(far.id, c)).toBe('noEntry');
    const e2 = new Editor(config);
    e2.loadText(e.exportText());
    expect(e2.network.restrictAt(arm(e2.network, -200, 0).id, center(e2.network))).toBe('noEntry');
    e.undo();
    expect(n.restrictAt(far.id, c)).toBeNull();
    e.setRestrict(far.id, c, null);
    expect(reach(e, [200, 0]).every((x) => x![1])).toBe(true);
  });

  it('형식 6 파일(제한 없음)도 열린다. 잘못된 값은 거부', () => {
    const v6 = { formatVersion: 6, nextNodeId: 3, nextSegmentId: 2, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 100, y: 0, z: 0 }], segments: [{ id: 1, a: 1, b: 2, kind: 'road2', structure: 'ground', playerSpeedKmh: null, signA: null, signB: null }] };
    const d = Network.parse(v6, config);
    expect(d.segments[0]).toMatchObject({ restrictA: null, restrictB: null });
    expect(() => Network.parse({ ...v6, segments: [{ ...v6.segments[0], restrictA: 'ufo' }] }, config)).toThrow('손상');
  });

  it('달리던 차량이 있어도 제한을 놓으면 다시 길을 찾아 모두 도착하고 안전망·교착은 0', () => {
    const e = make(), n = e.network;
    const sim = new Sim(config, n);
    const from = onArm(n, -200, 0, 10), to = onArm(n, 0, 200, 10);
    sim.traffic.requestTrip(from, to, 6);
    while (sim.traffic.stats.spawned < 6) sim.step();
    for (let i = 0; i < 100; i++) sim.step();
    e.setRestrict(arm(n, 200, 0).id, center(n), 'noEntry'); // 이 차량들과 상관없는 도로 끝
    for (let i = 0; i < 20 * 120; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(6);
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
  }, 60_000);
});
