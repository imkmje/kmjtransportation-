import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { isRaining } from '../src/sim/weather';
import { exportGame, importGame } from '../src/io/game';

const hot = { ...config, events: { ...config.events, accidentPerVehicleSec: 0.02, accidentDurationSec: 30 } }; // 사고가 자주 나게
const road = (cfg = config) => { const e = new Editor(cfg); e.build({ x: -600, y: 0 }, { x: 600, y: 0 }, 'road4'); return e; };
const trip = (sim: Sim, e: Editor, n: number) => { const s = [...e.network.segments.values()][0]; sim.traffic.requestTrip({ segId: s.id, t: 30 }, { segId: s.id, t: 1150 }, n); };

describe('사고', () => {
  it('이벤트가 꺼져 있으면 사고가 없다(기본)', () => {
    const e = road(hot), sim = new Sim(hot, e.network);
    trip(sim, e, 10);
    for (let i = 0; i < 20 * 120; i++) sim.step();
    expect(sim.traffic.stats.accidents).toBe(0);
    expect(sim.traffic.crashed.size).toBe(0);
  });

  it('사고가 나면 그 차량이 서서 뒤차가 막히고, 정해진 시간 뒤 치워져 모두 도착한다. 같은 시드면 결과가 같다', () => {
    const run = () => {
      const e = road(hot), sim = new Sim(hot, e.network);
      sim.setEvents(true);
      trip(sim, e, 12);
      let sawStopped = false;
      for (let i = 0; i < 20 * 400; i++) {
        sim.step();
        for (const id of sim.traffic.crashed.keys()) { const v = sim.traffic.vehicles.get(id); if (v && v.v === 0 && v.hold) sawStopped = true; }
      }
      return { sim, sawStopped };
    };
    const a = run(), b = run();
    expect(a.sim.traffic.stats.accidents).toBeGreaterThan(0);
    expect(a.sawStopped).toBe(true);
    expect(a.sim.traffic.crashed.size).toBe(0); // 모두 치워졌다
    expect(a.sim.traffic.stats.arrived).toBe(12);
    expect(a.sim.getState()).toEqual(b.sim.getState());
  }, 120_000);

  it('저장했다 불러와 이어 돌려도 같다(사고 차량·이벤트 설정 포함)', () => {
    const e = road(hot), sim = new Sim(hot, e.network);
    sim.setEvents(true); trip(sim, e, 12);
    for (let i = 0; i < 20 * 60; i++) sim.step();
    const saved = exportGame(e, sim);
    const e2 = new Editor(hot), s2 = new Sim(hot, e2.network);
    importGame(saved, e2, s2);
    expect(s2.traffic.eventsOn).toBe(true);
    for (let i = 0; i < 20 * 200; i++) { sim.step(); s2.step(); }
    expect(s2.getState()).toEqual(sim.getState());
  }, 120_000);
});

describe('날씨', () => {
  it('비 오는 날은 날마다 정해지고(결정론), 비율이 설정값 근처이며, 하루에 3~6시간 온다', () => {
    let rainyDays = 0;
    for (let day = 1; day <= 400; day++) {
      const hours = Array.from({ length: 24 * 4 }, (_, i) => isRaining(day, i / 4, config.seed, config)).filter(Boolean).length / 4;
      expect(isRaining(day, 12, config.seed, config)).toBe(isRaining(day, 12, config.seed, config));
      if (hours > 0) { rainyDays++; expect(hours).toBeGreaterThanOrEqual(3); expect(hours).toBeLessThanOrEqual(6); }
    }
    expect(rainyDays / 400).toBeGreaterThan(config.events.rainDayChance - 0.08);
    expect(rainyDays / 400).toBeLessThan(config.events.rainDayChance + 0.08);
  });

  it('비 오는 날은 같은 길도 느리게 달리고(속도 계수), 정체 지수 기준에도 반영되어 비 자체는 정체로 잡히지 않는다', () => {
    const maxV = (rain: boolean) => {
      const cfg = { ...config, events: { ...config.events, rainDayChance: rain ? 1 : 0 } };
      const e = road(cfg), sim = new Sim({ ...cfg, startClockHour: 9 }, e.network); // 비가 시작될 수 있는 시각
      sim.setEvents(true);
      for (let i = 0; i < 20 * 2400 && !sim.raining && rain; i++) sim.step(); // 비가 올 때까지(해시로 정해진 시작 시각)
      expect(sim.raining).toBe(rain);
      trip(sim, e, 1);
      let m = 0, ci: number[] = [];
      for (let i = 0; i < 20 * 80; i++) { sim.step(); for (const v of sim.traffic.vehicles.values()) m = Math.max(m, v.v); const c = sim.metrics.rollingCI(); if (c !== null) ci.push(c); }
      return { m, ci: ci.length ? Math.max(...ci) : 0 };
    };
    const dry = maxV(false), wet = maxV(true);
    expect(wet.m).toBeLessThan(dry.m * 0.95);
    expect(wet.ci).toBeLessThan(15);
  }, 180_000);
});
