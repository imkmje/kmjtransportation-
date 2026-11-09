import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { Sim } from '../src/sim/sim';
import { config } from '../src/config';
import { EMPTY_NETWORK } from '../src/maps/sample';
import { exportGame, importGame } from '../src/io/game';

// 큰길 하나 + 주거 2채 + 직장 1채 + 상점 1채
const city = (cfg = config, withShop = true) => {
  const e = new Editor(cfg);
  e.loadData(EMPTY_NETWORK);
  e.build({ x: -300, y: 0 }, { x: 300, y: 0 }, 'road2');
  e.addBuilding('home', 'large', -200, 40, 'map', false);
  e.addBuilding('home', 'medium', -100, -40, 'map', false);
  e.addBuilding('office', 'large', 200, 40, 'map', false);
  if (withShop) e.addBuilding('shop', 'medium', 40, 40, 'map', false);
  return { e, sim: new Sim(cfg, e.network) };
};
const run = (sim: Sim, hours: number) => { const end = sim.tickCount + Math.round(hours * 150 * config.tickRate); while (sim.tickCount < end) sim.step(); };
const weekendCfg = { ...config, startClockHour: 5 + 24 * 5 }; // 6일차 토요일 05:00에 시작

describe('출퇴근 말고 다른 이동', () => {
  it('상점이 없으면 이전과 똑같다(출퇴근만)', () => {
    const a = city(config, false).sim; run(a, 24);
    expect(a.metrics.today.generated + a.metrics.history.reduce((n, h) => n + h.generated, 0)).toBeGreaterThan(0);
    expect(a.traffic.stats.spawned).toBe(a.traffic.stats.arrived);
  }, 60_000);

  it('평일: 상점이 있으면 외출(상점 방문)과 복귀가 생기고 모두 끝난다', () => {
    const { sim, e } = city();
    const shop = [...e.network.buildings.values()].find((b) => b.kind === 'shop')!.id;
    let toShop = 0, fromShop = 0;
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { if (v.meta?.kind === 'errand' && v.meta.to === shop) toShop++; if (v.meta?.kind === 'return' && v.meta.from === shop) fromShop++; orig(v, t); };
    run(sim, 24);
    expect(toShop).toBeGreaterThan(10);
    expect(fromShop).toBe(toShop); // 간 사람은 모두 돌아온다
    const st = sim.traffic.stats;
    expect(st.interventions + st.deadlocks + st.conflicts).toBe(0);
    expect(sim.metrics.lost.abandoned + sim.metrics.lost.noRoute + sim.metrics.lost.removed).toBe(0);
  }, 120_000);

  it('주말: 출근은 없지만 상점 방문은 있다', () => {
    const { sim, e } = city(weekendCfg);
    const shop = [...e.network.buildings.values()].find((b) => b.kind === 'shop')!.id;
    let commute = 0, errand = 0;
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { if (v.meta?.kind === 'commute') commute++; if (v.meta?.kind === 'errand' && v.meta.to === shop) errand++; orig(v, t); };
    run(sim, 18);
    expect(commute).toBe(0);
    expect(errand).toBeGreaterThan(20);
  }, 120_000);

  it('재계획이 일어나도(건물 추가) 하루 몫보다 많이 나가지 않는다', () => {
    const { sim, e } = city(weekendCfg);
    const homes = [...e.network.buildings.values()].filter((b) => b.kind === 'home');
    const quota = homes.reduce((n, h) => { const cap = config.buildings.capacity[h.size], w = Math.round(cap * config.demand.workerShare); return n + Math.round((cap - w) * config.demand.errand.otherWeekend) + Math.round(w * config.demand.errand.workerLeisureWeekend); }, 0);
    let out = 0;
    const orig = sim.traffic.onArrive!;
    sim.traffic.onArrive = (v, t) => { if (v.meta?.kind === 'errand') out++; orig(v, t); };
    for (let i = 0; i < 6; i++) { run(sim, 2); e.addBuilding('office', 'small', -250 + i * 30, -40, 'map', false); } // 건물이 바뀔 때마다 재계획
    run(sim, 10);
    expect(out).toBeLessThanOrEqual(quota);
    expect(out).toBeGreaterThan(quota * 0.7);
  }, 120_000);

  it('저장했다 불러와 이어 돌려도 같다(외출 계획·몫 포함)', () => {
    const { sim, e } = city(weekendCfg);
    run(sim, 5);
    const saved = exportGame(e, sim);
    const e2 = new Editor(weekendCfg), s2 = new Sim(weekendCfg, e2.network);
    importGame(saved, e2, s2);
    run(sim, 8); run(s2, 8);
    expect(s2.getState()).toEqual(sim.getState());
  }, 120_000);

  it('상업 구역을 칠하면 수요에 따라 상점이 자라고, 저장 형식이 왕복한다', () => {
    const { sim, e } = city(config, false);
    e.network.paintZone(-3, 1, 3, 1, 'shop');
    expect(sim.growth.bars().shop).toBeGreaterThan(0);
    run(sim, 3);
    const shops = [...e.network.buildings.values()].filter((b) => b.kind === 'shop' && b.source === 'auto');
    expect(shops.length).toBeGreaterThan(0);
    const e2 = new Editor(config);
    e2.loadText(e.exportText());
    expect([...e2.network.zones.values()].filter((z) => z === 'shop').length).toBeGreaterThan(0);
  }, 60_000);
});
