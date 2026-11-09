import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { buildSampleMap } from '../src/maps/sample';
import { exportGame, importGame } from '../src/io/game';

const make = () => { const e = new Editor(config); buildSampleMap(e); return { e, sim: new Sim(config, e.network) }; };
const tickAt = (day: number, hour: number) => Math.round(((((day - 1) * 86400 + hour * 3600) - config.startClockHour * 3600) / (86400 / (config.dayLengthMinutes * 60))) * config.tickRate);
const runTo = (sim: Sim, tick: number) => { while (sim.tickCount < tick) sim.step(); };
const fnv = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const DAY1_END = tickAt(2, 4.2);

describe('샘플 맵', () => {
  it('만들어지고, 모든 건물이 도로에 연결되며, 큰길 교차로에 정지 표지가 있다', () => {
    const { e, sim } = make();
    const n = e.network;
    expect(n.buildings.size).toBe(24); // 주거·직장 23채 + 외부 연결점
    expect(n.externalId()).not.toBeNull();
    expect([...n.segments.values()].some((s) => s.locked)).toBe(true);
    expect(sim.demand.unconnected()).toEqual([]);
    expect([...n.segments.values()].filter((s) => s.signA === 'stop').length + [...n.segments.values()].filter((s) => s.signB === 'stop').length).toBe(6);
    expect([...n.segments.values()].some((s) => s.kind === 'road4')).toBe(true);
    expect(e.canUndo).toBe(false); // 샘플을 만든 과정은 취소 기록에 남지 않는다
  });

  it('[설계서 완료 기준] 시계 1일 실행: 완료율 95% 이상, 안전망 개입 0, 교착 0, 충돌 지점 동시 점유 0', () => {
    const { sim } = make();
    runTo(sim, DAY1_END);
    const rec = sim.metrics.history[0];
    const st = sim.traffic.stats;
    expect(rec.day).toBe(1);
    expect(rec.generated).toBeGreaterThan(504); // 직장인 252명 × (출근 + 퇴근) + 외부 사람과 외부로 나가는 이동
    expect(rec.completion!).toBeGreaterThanOrEqual(95);
    expect(st.interventions).toBe(0);
    expect(st.deadlocks).toBe(0);
    expect(st.conflicts).toBe(0);
    expect(rec.ci!).toBeLessThan(50); // 샘플은 "붐비지만 풀리는" 도시(외부 통근이 더해져 1.0.0의 15보다 높다)
    expect(sim.demand.poolSize()).toBe(0);
  }, 120_000);

  it('[설계서 완료 기준] 결정론: 같은 시드로 두 번 돌리면 모든 상태가 같다', () => {
    const a = make(), b = make();
    runTo(a.sim, tickAt(1, 14));
    runTo(b.sim, tickAt(1, 14));
    expect(a.sim.getState()).toEqual(b.sim.getState());
  }, 120_000);

  it('[설계서 완료 기준] 저장했다 불러와 이어서 실행한 결과가, 끊김 없이 실행한 결과와 같다', () => {
    const run = make();
    runTo(run.sim, tickAt(1, 8.5)); // 출근이 한창일 때: 달리는 차, 출발 대기, 계획된 이동이 모두 있는 순간
    expect(run.sim.traffic.vehicles.size).toBeGreaterThan(5);
    const saved = exportGame(run.e, run.sim);
    // 새 프로그램에서 파일을 연 것처럼
    const e2 = new Editor(config);
    const sim2 = new Sim(config, e2.network);
    expect(importGame(saved, e2, sim2)).toBe('game');
    expect(sim2.getState()).toEqual(run.sim.getState()); // 불러온 직후 상태가 같다
    runTo(run.sim, tickAt(1, 14));
    runTo(sim2, tickAt(1, 14));
    expect(sim2.getState()).toEqual(run.sim.getState()); // 이어서 돌린 결과도 같다
    expect(JSON.stringify(e2.network.toJSON())).toBe(JSON.stringify(run.e.network.toJSON()));
  }, 120_000);

  it('저장 파일이 글자 하나로 왕복해도(JSON) 같다 / 도로망만 있는 옛 파일도 열린다 / 잘못된 파일은 쉬운 메시지로 거부', () => {
    const { e, sim } = make();
    runTo(sim, tickAt(1, 7.5));
    const text = exportGame(e, sim);
    const e2 = new Editor(config), s2 = new Sim(config, e2.network);
    importGame(JSON.stringify(JSON.parse(text)), e2, s2);
    expect(s2.getState()).toEqual(sim.getState());
    // 도로망만 있는 파일(형식 2, 건물 없음)
    const old = { formatVersion: 2, nextNodeId: 3, nextSegmentId: 2, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 100, y: 0, z: 0 }], segments: [{ id: 1, a: 1, b: 2, kind: 'road2', structure: 'ground', playerSpeedKmh: null, signA: null, signB: null }] };
    expect(importGame(JSON.stringify(old), e2, s2)).toBe('network');
    expect(e2.network.segments.size).toBe(1);
    expect(s2.tickCount).toBe(0); // 시뮬레이션은 처음부터
    expect(() => importGame('이건 JSON이 아님', e2, s2)).toThrow('저장 파일이 아닙니다');
    expect(() => importGame(JSON.stringify({ kind: 'game', formatVersion: 99 }), e2, s2)).toThrow('더 새로운');
    expect(() => importGame(JSON.stringify({ kind: 'game', formatVersion: 3, network: old }), e2, s2)).toThrow('손상');
    expect(() => importGame(JSON.stringify({ ...JSON.parse(text), network: { formatVersion: 3, nodes: 5 } }), e2, s2)).toThrow();
  });

  it('[회귀 스냅샷] 시드·tick 수를 고정한 시나리오 결과. 바뀌면 의도한 변경인지 확인하고 스냅샷을 갱신한다', () => {
    const { sim } = make();
    runTo(sim, DAY1_END);
    const summary = {
      day1: sim.metrics.history[0],
      stats: sim.traffic.stats,
      ticks: sim.tickCount,
      live: sim.traffic.vehicles.size,
      stateHash: fnv(JSON.stringify(sim.getState())),
    };
    expect(summary).toMatchSnapshot();
  }, 120_000);
});
