import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { EMPTY_NETWORK } from '../src/maps/sample';
import { exportGame, importGame } from '../src/io/game';

const run = (sim: Sim, hours: number) => { const end = sim.tickCount + Math.round(hours * 150 * config.tickRate); while (sim.tickCount < end) sim.step(); };
const base = (cfg = config) => { const e = new Editor(cfg); e.loadData(EMPTY_NETWORK); e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road2'); return e; };

describe('학교와 학생', () => {
  const city = () => {
    const e = base();
    e.addBuilding('home', 'large', -200, 40, 'map', false);
    e.addBuilding('office', 'medium', 200, 40, 'map', false);
    e.addBuilding('school', 'medium', -50, 40, 'map', false);
    return { e, sim: new Sim(config, e.network) };
  };
  it('학생은 평일 아침 학교로 가고 오후에 돌아오며, 학교가 있으면 같은 사람이 낮 외출 몫에서 빠진다', () => {
    const { e, sim } = city();
    const school = [...e.network.buildings.values()].find((b) => b.kind === 'school')!.id;
    const home = [...e.network.buildings.values()].find((b) => b.kind === 'home')!.id;
    let toSchool = 0, fromSchool = 0, atHour = [] as number[];
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { if (v.meta?.kind === 'commute' && v.meta.to === school) { toSchool++; atHour.push(sim.clock().hour); } if (v.meta?.kind === 'return' && v.meta.from === school) fromSchool++; orig(v, t); };
    run(sim, 24);
    const students = Math.round(config.buildings.capacity.large * config.demand.studentShare);
    expect(toSchool).toBe(students);
    expect(fromSchool).toBe(students);
    expect(atHour.every((h) => h >= 7 && h <= 10)).toBe(true);
    expect(home).toBeGreaterThan(0);
    expect(sim.metrics.lost.abandoned + sim.metrics.lost.noRoute).toBe(0);
  }, 120_000);

});

describe('공장과 화물 트럭', () => {
  const city = () => {
    const e = base();
    e.addBuilding('factory', 'large', 100, 40, 'map', false);
    e.addBuilding('shop', 'medium', -100, 40, 'map', false);
    return { e, sim: new Sim(config, e.network) };
  };
  it('평일에 공장이 하루 몫만큼 트럭을 보내고, 트럭은 더 길고 느리며 모두 공장으로 돌아온다', () => {
    const { e, sim } = city();
    const fid = [...e.network.buildings.values()].find((b) => b.kind === 'factory')!.id;
    let out = 0, back = 0, maxLen = 0, minF = 9;
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { if (v.meta?.mode === 'truck') { maxLen = Math.max(maxLen, v.length); minF = Math.min(minF, v.factor); if (v.meta.kind === 'errand') out++; else if (v.meta.to === fid) back++; } orig(v, t); };
    run(sim, 24);
    expect(out).toBe(config.demand.freight.perDay.large);
    expect(back).toBe(out);
    expect(maxLen).toBe(config.demand.freight.length);
    expect(minF).toBeLessThanOrEqual(config.demand.freight.speedFactor);
  }, 120_000);

  it('주말에는 화물이 없다', () => {
    const cfg = { ...config, startClockHour: 5 + 24 * 5 };
    const e = base(cfg);
    e.addBuilding('factory', 'large', 100, 40, 'map', false);
    e.addBuilding('shop', 'medium', -100, 40, 'map', false);
    const sim = new Sim(cfg, e.network);
    let trucks = 0;
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { if (v.meta?.mode === 'truck') trucks++; orig(v, t); };
    run(sim, 18);
    expect(trucks).toBe(0);
  }, 60_000);

  it('산업 구역에는 공장, 사무 구역에는 사무 건물이 자라고, 공장 칸을 다른 종류로 칠하면 철거된다. 저장·불러오기 후 이어 돌려도 같다', () => {
    const e = base();
    e.addBuilding('home', 'large', -200, 40, 'map', false);
    e.network.paintZone(-4, 1, 1, 1, 'industrial');
    e.network.paintZone(2, 1, 6, 1, 'office');
    const sim = new Sim(config, e.network);
    sim.traffic.signals.reset();
    run(sim, 6);
    const kinds = new Set([...e.network.buildings.values()].filter((b) => b.source === 'auto').map((b) => b.kind));
    expect(kinds.has('office') && kinds.has('factory')).toBe(true);
    for (const b of e.network.buildings.values()) if (b.source === 'auto') expect(b.kind === 'factory' ? b.x < 50 : b.x > 20).toBe(true); // 산업 구역은 왼쪽(−80~20), 사무 구역은 오른쪽
    const saved = exportGame(e, sim);
    const e2 = new Editor(config), s2 = new Sim(config, e2.network);
    importGame(saved, e2, s2);
    run(sim, 4); run(s2, 4);
    expect(s2.getState()).toEqual(sim.getState());
    const f = [...e.network.buildings.values()].find((b) => b.kind === 'factory')!;
    e.network.paintZone(Math.round(f.x / 20), Math.round(f.y / 20), Math.round(f.x / 20), Math.round(f.y / 20), 'shop');
    expect(e.network.buildings.has(f.id)).toBe(false);
  }, 120_000);
});
