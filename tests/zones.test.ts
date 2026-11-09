import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Network } from '../src/sim/network';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { buildStartMap } from '../src/maps/start';
import { buildSampleMap, EMPTY_NETWORK } from '../src/maps/sample';
import { exportGame, importGame } from '../src/io/game';

const withRoad = () => { const e = new Editor(config); e.loadData(EMPTY_NETWORK); e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road2'); return e; };

describe('구역', () => {
  it('도로 옆 칸만 칠해진다: 도로 위·너무 먼 곳·지도 밖은 건너뛴다', () => {
    const n = withRoad().network;
    expect(n.cellStatus(0, 0)).toBe('road');
    expect(n.cellStatus(0, 1)).toBe('ok'); // 20m: 도로 반폭 + 칸 반쪽(약 17m) 밖, 45m 안
    expect(n.cellStatus(0, 3)).toBe('far'); // 60m
    expect(n.cellStatus(60, 1)).toBe('out');
    // 세로 -5..5칸, 가로 -2..2칸 칠하기 → 도로 양쪽 첫 줄과 둘째 줄(40m)만
    expect(n.paintZone(-2, -5, 2, 5, 'home')).toBe(2 * 2 * 5); // y=±20, ±40의 칸 × 가로 5칸
    expect(n.zones.size).toBe(20);
    expect(n.paintZone(-2, -5, 2, 5, 'home')).toBe(0); // 다시 칠해도 바뀐 칸 없음
  });

  it('다른 종류로 다시 칠하면 바뀌고, 지우기는 구역을 없앤다', () => {
    const n = withRoad().network;
    n.paintZone(0, 1, 2, 1, 'home');
    expect(n.paintZone(0, 1, 1, 1, 'office')).toBe(2);
    expect(n.zoneList().map((z) => z.type)).toEqual(['office', 'office', 'home']);
    expect(n.paintZone(0, 1, 2, 1, null)).toBe(3);
    expect(n.zones.size).toBe(0);
  });

  it('한 번에 칠할 수 있는 사각형은 한 변 maxRect칸까지', () => {
    const e = new Editor(config); e.loadData(EMPTY_NETWORK);
    e.build({ x: -980, y: 0 }, { x: 980, y: 0 }, 'road4');
    expect(e.network.paintZone(-40, 1, 40, 1, 'home')).toBe(config.zones.maxRect);
  });

  it('구역 위에 도로를 새로 놓으면 겹친 칸의 구역이 지워진다', () => {
    const e = withRoad();
    e.network.paintZone(2, 1, 2, 5, 'home');
    expect(e.network.zones.size).toBe(2); // y=20, 40만
    e.build({ x: 40, y: 20 }, { x: 40, y: 100 }, 'road2');
    expect(e.network.zones.size).toBe(0);
  });

  it('건물이 있는 곳으로는 도로를 놓을 수 없다(onBuilding)', () => {
    const e = withRoad();
    e.addBuilding('home', 'medium', 100, 60, 'auto');
    const r = e.network.planRoad({ x: 100, y: 20 }, { x: 100, y: 120 }, 'road2');
    expect(r).toEqual({ ok: false, error: 'onBuilding' });
  });

  it('자동 건물이 있는 칸을 다른 구역으로 칠하면 건물이 철거되고, 직접 놓은 건물이 있는 칸은 건너뛴다', () => {
    const e = withRoad();
    const n = e.network;
    n.paintZone(0, 1, 1, 1, 'home');
    const a = e.addBuilding('home', 'small', 0, 20, 'auto');
    const m = e.addBuilding('home', 'small', 20, 20, 'map', false);
    expect(a.ok && m.ok).toBe(true);
    expect(n.paintZone(0, 1, 1, 1, 'office')).toBe(1); // 0,1만 바뀌고 map 건물(주거)이 있는 1,1은 건너뜀
    expect(n.buildings.size).toBe(1);
    expect(n.paintZone(0, 1, 1, 1, null)).toBe(2); // 구역 지우기: 건물(map)은 남는다
    expect(n.buildings.size).toBe(1);
  });
});

describe('외부 연결', () => {
  it('새 도시: 철거할 수 없는 도로 하나와 외부 연결점만 있다', () => {
    const e = new Editor(config);
    buildStartMap(e);
    const n = e.network;
    expect(n.segments.size).toBe(1);
    expect([...n.segments.values()][0].locked).toBe(true);
    expect(n.buildings.size).toBe(1);
    expect(n.buildings.get(n.externalId()!)!.kind).toBe('external');
    expect(n.accessOf(n.externalId()!)).not.toBeNull(); // 연결됨
    expect(e.demolish([...n.segments.keys()][0])).toBe(false);
    expect(n.removeBuilding(n.externalId()!)).toEqual({ ok: false, error: 'locked' });
    expect(e.canUndo).toBe(false);
  });

  it('잠긴 도로는 다른 도로가 가로질러도 조각 모두 잠겨 있다', () => {
    const e = new Editor(config);
    buildStartMap(e);
    e.build({ x: -100, y: -700 }, { x: 100, y: -700 }, 'road2');
    const locked = [...e.network.segments.values()].filter((s) => s.locked);
    expect(locked.length).toBe(2);
    expect(e.network.segments.size).toBe(4);
  });

  it('외부 연결점 때문에 도로 건설이 막히지 않는다', () => {
    const e = new Editor(config);
    buildStartMap(e);
    expect(e.build({ x: 0, y: -400 }, { x: 100, y: -400 }, 'road2').ok).toBe(true);
  });
});

describe('저장 형식 4', () => {
  it('구역·건물 모양·잠금이 왕복해도 같다', () => {
    const e = new Editor(config);
    buildStartMap(e);
    e.build({ x: 0, y: -600 }, { x: 200, y: -600 }, 'road2');
    e.network.paintZone(-2, -30, 2, -29, 'home');
    expect(e.addBuilding('home', 'small', 100, -560, 'auto', true, 77).ok).toBe(true);
    const text = e.exportText();
    const e2 = new Editor(config);
    e2.loadText(text);
    expect(JSON.stringify(e2.network.toJSON())).toBe(JSON.stringify(e.network.toJSON()));
    expect([...e2.network.buildings.values()].find((b) => b.kind === 'home')!.variant).toBe(77);
  });
  it('형식 3 파일(구역 없음, 건물 모양 없음)도 열리고, 잘못된 구역은 거부', () => {
    const v3 = { formatVersion: 3, nextNodeId: 3, nextSegmentId: 2, nextBuildingId: 2,
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 100, y: 0, z: 0 }],
      segments: [{ id: 1, a: 1, b: 2, kind: 'road2', structure: 'ground', playerSpeedKmh: null, signA: null, signB: null }],
      buildings: [{ id: 1, kind: 'home', size: 'small', x: 50, y: 40, source: 'map', deletable: false, parking: 0 }] };
    const d = Network.parse(v3, config);
    expect(d.zones).toEqual([]);
    expect(d.buildings[0].variant).toBe(0);
    expect(d.segments[0].locked).toBe(false);
    expect(() => Network.parse({ ...v3, formatVersion: 4, zones: [[1, 2, 9]] }, config)).toThrow('손상');
    expect(() => Network.parse({ ...v3, formatVersion: 4, zones: 'x' }, config)).toThrow('손상');
  });
});

describe('외부 통근과 건물 성장', () => {
  const day = (_sim: Sim, hour: number) => Math.round((((hour * 3600) - config.startClockHour * 3600) / (86400 / (config.dayLengthMinutes * 60))) * config.tickRate);

  it('샘플 맵: 외부에서 들어오는 이동과 외부로 나가는 이동이 생기고 완료된다', () => {
    const e = new Editor(config); buildSampleMap(e);
    const sim = new Sim(config, e.network);
    const ext = e.network.externalId()!;
    const seen = { inbound: 0, outbound: 0, arrivedExt: 0 };
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => {
      if (v.meta?.kind === 'commute') { if (v.meta.from === ext) seen.inbound++; if (v.meta.to === ext) seen.outbound++; }
      if (v.meta?.to === ext && v.meta.kind === 'return') seen.arrivedExt++;
      orig(v, t);
    };
    while (sim.tickCount < day(sim, 24 + 4.2)) sim.step();
    expect(seen.inbound).toBeGreaterThan(20);
    expect(seen.outbound).toBeGreaterThan(10);
    expect(seen.arrivedExt).toBeGreaterThan(20); // 외부 사람이 저녁에 외부로 돌아간다
  }, 120_000);

  it('구역을 칠하면 수요 막대만큼 건물이 자라고, 같은 시드면 결과가 같다', () => {
    const run = () => {
      const e = new Editor(config); buildStartMap(e);
      e.network.paintZone(-4, -30, 4, -27, 'home'); // 도로(x=0, y≈-400~-1000) 옆
      e.network.paintZone(-4, -26, 4, -24, 'office');
      const sim = new Sim(config, e.network);
      while (sim.tickCount < config.tickRate * 600) sim.step(); // 시뮬 10분
      return { e, sim };
    };
    const a = run(), b = run();
    const kinds = (e: Editor) => [...e.network.buildings.values()].filter((x) => x.source === 'auto');
    expect(kinds(a.e).length).toBeGreaterThan(5);
    expect(kinds(a.e).some((x) => x.kind === 'home')).toBe(true);
    expect(kinds(a.e).some((x) => x.kind === 'office')).toBe(true);
    expect(new Set(kinds(a.e).map((x) => x.variant)).size).toBeGreaterThan(3); // 모양이 다양하다
    expect(JSON.stringify(a.e.network.toJSON())).toBe(JSON.stringify(b.e.network.toJSON()));
    expect(a.sim.getState()).toEqual(b.sim.getState());
    // 자란 건물은 모두 구역 칸 안에 있고 도로에 연결된다
    for (const x of kinds(a.e)) expect(a.e.network.accessOf(x.id)).not.toBeNull();
  }, 120_000);

  it('구역이 없으면 자라지 않는다. 일자리가 넘치면 주거 수요가, 주거가 넘치면 직장 수요가 높다', () => {
    const e = new Editor(config); buildStartMap(e);
    const sim = new Sim(config, e.network);
    for (let i = 0; i < config.tickRate * 200; i++) sim.step();
    expect(e.network.buildings.size).toBe(1);
    const base = sim.growth.bars();
    expect(base.home).toBeCloseTo(config.growth.base);
    e.network.addBuilding('office', 'large', 40, -600, 'map', false);
    expect(sim.growth.bars().home).toBeGreaterThan(base.home);
    expect(sim.growth.bars().office).toBeLessThan(base.office);
  });

  it('교통이 막히면 수요가 줄어든다(감점)', () => {
    const e = new Editor(config); buildStartMap(e);
    const sim = new Sim(config, e.network);
    const free = sim.growth.bars().home;
    sim.metrics.rollingCI = () => config.growth.trafficFull;
    expect(sim.growth.bars().home).toBeCloseTo(free * (1 - config.growth.trafficPenalty));
  });

  it('성장 상태까지 저장·불러오기 후 이어 돌려도 같다', () => {
    const e = new Editor(config); buildStartMap(e);
    e.network.paintZone(-4, -30, 4, -28, 'home');
    const sim = new Sim(config, e.network);
    for (let i = 0; i < config.tickRate * 130; i++) sim.step();
    const saved = exportGame(e, sim);
    const e2 = new Editor(config), s2 = new Sim(config, e2.network);
    importGame(saved, e2, s2);
    for (let i = 0; i < config.tickRate * 200; i++) { sim.step(); s2.step(); }
    expect(s2.getState()).toEqual(sim.getState());
    expect(JSON.stringify(e2.network.toJSON())).toBe(JSON.stringify(e.network.toJSON()));
  }, 120_000);
});
