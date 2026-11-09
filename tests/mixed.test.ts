import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { EMPTY_NETWORK } from '../src/maps/sample';

const run = (sim: Sim, hours: number) => { const end = sim.tickCount + Math.round(hours * 150 * config.tickRate); while (sim.tickCount < end) sim.step(); };
const base = () => { const e = new Editor(config); e.loadData(EMPTY_NETWORK); e.build({ x: -400, y: 0 }, { x: 400, y: 0 }, 'road2'); return e; };

describe('혼합 용도(상가주택)와 구역 깊이', () => {
  it('구역을 도로에서 65m까지 칠할 수 있고, 대형 건물이 두 줄로 자란다', () => {
    const e = base();
    for (let i = 0; i < 9; i++) for (const y of [-40, 40]) e.addBuilding('office', 'large', 40 + i * 40, y, 'map', false); // 일자리
    e.network.paintZone(-14, 1, -4, 3, 'homeHigh'); // 세 줄(20·40·60m)
    expect(e.network.zones.size).toBe(33);
    const sim = new Sim(config, e.network);
    run(sim, 24);
    const high = [...e.network.buildings.values()].filter((b) => b.density === 2 && b.source === 'auto');
    expect(high.length).toBeGreaterThan(2);
    expect(high.every((b) => b.x < 0)).toBe(true);
    for (const b of high) expect(e.network.accessOf(b.id)).not.toBeNull(); // 안쪽 줄도 도로에 연결된다(연결 반경 70m)
  }, 120_000);

  it('혼합 용도 구역에 상가주택이 자라고, 주민이면서 상점이라 출퇴근과 외출이 모두 생긴다. 자기 자신에게는 가지 않는다', () => {
    const e = base();
    e.addBuilding('office', 'large', 200, 40, 'map', false);
    e.network.paintZone(-6, 1, 3, 2, 'mixed');
    const sim = new Sim(config, e.network);
    const kinds = new Map<string, number>(), selfTrips = { n: 0 };
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { const k = v.meta?.kind ?? '?'; kinds.set(k, (kinds.get(k) ?? 0) + 1); if (v.meta && v.meta.from === v.meta.to) selfTrips.n++; orig(v, t); };
    run(sim, 30);
    const mixed = [...e.network.buildings.values()].filter((b) => b.kind === 'mixed');
    expect(mixed.length).toBeGreaterThan(2);
    expect(kinds.get('commute') ?? 0).toBeGreaterThan(5); // 주민이 출근한다
    expect(kinds.get('errand') ?? 0).toBeGreaterThan(3); // 상점이 있어 외출이 생긴다
    expect(selfTrips.n).toBe(0);
    expect(sim.growth.bars().mixed).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('혼합 용도 구역 저장 왕복, 구역 종류 확인', () => {
    const e = base();
    e.network.paintZone(0, 1, 3, 1, 'mixed');
    const e2 = new Editor(config); e2.loadText(e.exportText());
    expect([...e2.network.zones.values()].every((z) => z === 'mixed')).toBe(true);
    expect(e2.network.zones.size).toBe(4);
    const r = e2.addBuilding('mixed', 'small', 100, 30, 'player');
    expect(r.ok).toBe(true);
    const e3 = new Editor(config); e3.loadText(e2.exportText());
    expect([...e3.network.buildings.values()][0].kind).toBe('mixed');
  });
});
