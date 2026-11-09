import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { findRoute } from '../src/sim/route';

const make = () => {
  const e = new Editor(config);
  e.build({ x: -300, y: 0 }, { x: 0, y: 0 }, 'road2');
  e.build({ x: 0, y: 0 }, { x: 300, y: 0 }, 'road2'); // 가운데 노드는 도로 2개만 만나는 이음
  e.build({ x: 0, y: 0 }, { x: 0, y: 200 }, 'road2'); // 이제 (0,0)은 교차로
  return e;
};
const seg = (e: Editor, x: number, y: number) => [...e.network.segments.values()].find((s) => { const a = e.network.nodes.get(s.a)!, b = e.network.nodes.get(s.b)!; return [a, b].some((p) => p.x === x && p.y === y); })!;

describe('도로 넓히기', () => {
  it('교차로 사이 한 구간(이음 노드로 이어진 조각 포함)만 4차로가 되고 교차로에서 멈춘다', () => {
    const e = new Editor(config);
    e.build({ x: -300, y: 0 }, { x: -100, y: 0 }, 'road2');
    e.build({ x: -100, y: 0 }, { x: 200, y: 0 }, 'road2'); // 이음 (-100,0)
    e.build({ x: 100, y: -100 }, { x: 100, y: 100 }, 'road2'); // (100,0)에서 교차
    const n = e.network;
    const r = e.upgrade(seg(e, -300, 0).id);
    expect(r.ok && r.ids.length).toBe(2); // (-300..-100), (-100..100)
    expect([...n.segments.values()].filter((s) => s.kind === 'road4').length).toBe(2);
    expect(seg(e, 100, -100).kind).toBe('road2'); // 교차로 건너편은 그대로
    const r6 = e.upgrade(seg(e, -300, 0).id); // 4차로 → 6차로
    expect(r6.ok && r6.ids.length).toBe(2);
    expect(seg(e, -300, 0).kind).toBe('road6');
    expect(e.upgrade(seg(e, -300, 0).id)).toEqual({ ok: false, error: 'notUpgradable' }); // 더는 못 넓힌다
    const d = e.upgrade(seg(e, -300, 0).id, 'down'); // 좁히기
    expect(d.ok && d.ids.length).toBe(2);
    expect(seg(e, -300, 0).kind).toBe('road4');
    expect(e.upgrade(seg(e, -300, 0).id, 'down').ok).toBe(true);
    expect(e.upgrade(seg(e, -300, 0).id, 'down')).toEqual({ ok: false, error: 'notUpgradable' }); // 2차로보다 좁아질 수 없다
    e.upgrade(seg(e, -300, 0).id); // 아래 검사를 위해 4차로로
  });

  it('옆에 건물이 있어 4차로 폭이 걸리면 아무 구간도 바뀌지 않는다', () => {
    const e = make();
    expect(e.addBuilding('home', 'medium', 100, 13, 'map', false).ok).toBe(true); // 2차로(3.5+7+1=11.5)는 되지만 4차로(7+7+1=15)는 걸린다
    const r = e.upgrade(seg(e, 300, 0).id);
    expect(r).toEqual({ ok: false, error: 'onBuilding' });
    expect([...e.network.segments.values()].every((s) => s.kind === 'road2')).toBe(true);
  });

  it('실행 취소로 되돌아가고, 겹친 구역 칸은 지워지며, 제한속도는 새 상한을 넘지 않는다', () => {
    const e = make();
    const s = seg(e, 300, 0);
    e.network.paintZone(5, 1, 5, 1, 'home'); // (100, 20): 4차로 폭에 걸린다(7+10=17 미만이 되진 않음 → 아래서 확인)
    const before = e.network.zones.size;
    e.upgrade(s.id);
    expect(e.network.segments.get(s.id)!.kind).toBe('road4');
    expect(e.network.zones.size).toBeLessThanOrEqual(before);
    e.undo();
    expect(e.network.segments.get(s.id)!.kind).toBe('road2');
  });

  it('달리는 중에 넓혀도 차량이 사라지지 않고 모두 도착하며, 안전망·교착 0', () => {
    const e = new Editor(config);
    e.build({ x: -600, y: 0 }, { x: 600, y: 0 }, 'road2');
    const sim = new Sim(config, e.network);
    const s = [...e.network.segments.values()][0];
    const from = { segId: s.id, t: 30 }, to = { segId: s.id, t: 1150 };
    expect(findRoute(sim.traffic.graph, from, to)).not.toBeNull();
    sim.traffic.requestTrip(from, to, 12);
    while (sim.traffic.stats.spawned < 12) sim.step(); // 투입 대기열은 도로가 바뀌면 비워지므로 모두 나온 뒤에 넓힌다
    for (let i = 0; i < 20 * 5; i++) sim.step();
    expect(sim.traffic.vehicles.size).toBeGreaterThan(3);
    e.upgrade(s.id);
    for (let i = 0; i < 20 * 400; i++) sim.step();
    const st = sim.traffic.stats;
    expect(st.arrived).toBe(12);
    expect(st.interventions + st.deadlocks + st.conflicts).toBe(0);
  }, 60_000);

  it('저장 형식은 그대로(종류 값만 바뀜)이고 불러와도 4차로다', () => {
    const e = make();
    e.upgrade(seg(e, 300, 0).id);
    const e2 = new Editor(config);
    e2.loadText(e.exportText());
    expect([...e2.network.segments.values()].filter((x) => x.kind === 'road4').length).toBe(1);
  });
});

describe('도로 이름과 차선별 방향', () => {
  const cross = () => { const e = new Editor(config); e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road4'); e.build({ x: 0, y: -200 }, { x: 0, y: 200 }, 'road2'); return e; };
  const find = (e: Editor, x: number, y: number) => [...e.network.segments.values()].find((s) => { const a = e.network.nodes.get(s.a)!, b = e.network.nodes.get(s.b)!; return [a, b].some((p) => p.x === x && p.y === y); })!;
  const center = (e: Editor) => [...e.network.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id;

  it('이름은 이음 노드로 이어진 구간 전체에 붙고 저장된다(교차로에서 멈춤)', () => {
    const e = new Editor(config);
    e.build({ x: -300, y: 0 }, { x: -100, y: 0 }, 'road2');
    e.build({ x: -100, y: 0 }, { x: 100, y: 0 }, 'road2');
    e.build({ x: 0, y: -100 }, { x: 0, y: 100 }, 'road2'); // (0,0)에서 교차 → 둘째 구간이 둘로 나뉜다
    const west = find(e, -300, 0);
    expect(e.setName(west.id, '  중앙로  ')).toBe(2); // (-300..-100), (-100..0)
    expect(west.name).toBe('중앙로');
    expect(find(e, 100, 0).name).toBe('');
    const e2 = new Editor(config); e2.loadText(e.exportText());
    expect([...e2.network.segments.values()].filter((s) => s.name === '중앙로').length).toBe(2);
    expect(e.setName(west.id, 'x'.repeat(50))).toBe(2);
    expect(west.name.length).toBe(30);
  });

  it('차선별 방향: 지정한 방향의 연결만 남고, 없는 방향만 고르면 무시되며, 초기화·저장·형식 검사가 된다', () => {
    const e = cross(), n = e.network, c = center(e);
    const west = find(e, -300, 0).id;
    const turnsOf = (lane: number) => { const g = new Sim(config, n).traffic.graph; return g.tracks.filter((t) => t.kind === 'conn' && g.tracks[t.src].segId === west && g.tracks[t.src].index === lane && !t.uturn).map((t) => t.turn).sort(); };
    const all = turnsOf(1);
    expect(all).toContain('left'); expect(all).toContain('right'); expect(all).toContain('straight');
    expect(e.setLaneDirs(west, c, [6, 1])).toEqual({ ok: true }); // 1번(오른쪽) 차선 직진+우회전, 2번 차선 좌회전
    expect(turnsOf(1).every((t) => t !== 'left')).toBe(true);
    expect(turnsOf(2)).toEqual(all.filter((t) => t === 'left'));
    expect(e.setLaneDirs(west, c, [1])).toEqual({ ok: true });
    const only = turnsOf(1); expect(only.length).toBeGreaterThan(0); // 오른쪽 차선이 좌회전만 → 연결이 있다
    expect(e.setLaneDirs(west, c, [0])).toEqual({ ok: false, error: 'badValue' });
    expect(e.setLaneDirs(west, c, [1, 1, 1])).toEqual({ ok: false, error: 'badValue' }); // 차선 수 초과
    const e2 = new Editor(config); e2.loadText(e.exportText());
    expect(e2.network.laneDirsAt(find(e2, -300, 0).id, center(e2))).toEqual([1]);
    e.setLaneDirs(west, c, []);
    expect(turnsOf(1)).toEqual(all);
    e.setLaneDirs(west, c, [2]);
    e.undo(); // 초기화 직전 상태로
    expect(n.laneDirsAt(west, c)).toEqual([]);
  });

  it('차선별 방향을 지정해도 차량이 길을 찾아 도착하고 안전망·교착은 0', () => {
    const e = cross(), n = e.network, c = center(e);
    const west = find(e, -300, 0);
    e.setLaneDirs(west.id, c, [2, 5]); // 오른쪽 차선 직진, 왼쪽 차선 좌회전+우회전
    const sim = new Sim(config, n);
    const from = { segId: west.id, t: 20 }, north = find(e, 0, 200), east = find(e, 300, 0);
    sim.traffic.requestTrip(from, { segId: north.id, t: 40 }, 4);
    sim.traffic.requestTrip(from, { segId: east.id, t: 40 }, 4);
    for (let i = 0; i < 20 * 200; i++) sim.step();
    expect(sim.traffic.stats.arrived).toBe(8);
    expect(sim.traffic.stats.interventions + sim.traffic.stats.deadlocks + sim.traffic.stats.conflicts).toBe(0);
  }, 60_000);
});
