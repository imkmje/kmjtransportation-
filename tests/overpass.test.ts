import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';

describe('입체교차(고가)', () => {
  const make = () => { const e = new Editor(config); expect(e.build({ x: -200, y: 0 }, { x: 200, y: 0 }, 'road2').ok).toBe(true); return e; };

  it('아래 도로를 가르지 않고 위로 지나간다(구간 2개, 교차로 노드 없음)', () => {
    const e = make();
    const r = e.buildOver({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2');
    expect(r.ok).toBe(true);
    const n = e.network;
    expect(n.segments.size).toBe(2); expect(n.nodes.size).toBe(4);
    const over = [...n.segments.values()].find((s) => s.over)!;
    expect(over.structure).toBe('bridge');
    expect(n.segmentZ(over, 200)).toBeCloseTo(config.terrain.overHeight, 6); // 가운데는 고가 높이
    expect(n.segmentZ(over, 0)).toBe(0);
    e.undo(); expect(n.segments.size).toBe(1);
  });

  it('교차하지 않거나, 너무 짧거나, 교차 지점이 끝에 너무 가까우면 거부', () => {
    const e = make();
    expect(e.buildOver({ x: 0, y: 50 }, { x: 0, y: 300 }, 'road2')).toMatchObject({ ok: false, error: 'overpass' }); // 교차 없음
    expect(e.buildOver({ x: 0, y: -60 }, { x: 0, y: 60 }, 'road2')).toMatchObject({ ok: false, error: 'overpass' }); // 너무 짧음
    expect(e.buildOver({ x: 0, y: -20 }, { x: 0, y: 300 }, 'road2')).toMatchObject({ ok: false, error: 'overpass' }); // 교차 지점이 시작점 근처라 높이 부족
  });

  it('고가 아래로 일반 도로를 지나가게 할 수 있고, 고가 위에서는 갈라질 수 없다', () => {
    const e = make();
    expect(e.buildOver({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2').ok).toBe(true);
    const before = e.network.segments.size;
    expect(e.build({ x: -100, y: -100 }, { x: 100, y: -100 }, 'road2').ok).toBe(true); // 고가 아래를 가로지름
    expect(e.network.segments.size).toBe(before + 1); // 가르지 않음
    expect(e.build({ x: -60, y: 100 }, { x: 0, y: 100 }, 'road2')).toMatchObject({ ok: false }); // 고가 중간에 붙이기 불가
  });

  it('차량이 고가와 아래 도로를 각각 달려 충돌 없이 도착하고, 저장·불러오기가 된다', () => {
    const e = make();
    expect(e.buildOver({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2').ok).toBe(true);
    const sim = new Sim(config, e.network), n = e.network;
    const segs = [...n.segments.values()], under = segs.find((s) => !s.over)!, over = segs.find((s) => s.over)!;
    sim.traffic.requestTrip({ segId: under.id, t: 20 }, { segId: under.id, t: n.segmentLength(under) - 20 }, 6);
    sim.traffic.requestTrip({ segId: over.id, t: 20 }, { segId: over.id, t: n.segmentLength(over) - 20 }, 6);
    for (let i = 0; i < 20 * 150; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(12);
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
    const back = Network.parse(JSON.parse(JSON.stringify(n.toJSON())), config);
    expect(back.segments.filter((s) => s.over).length).toBe(1);
  }, 60_000);
});
