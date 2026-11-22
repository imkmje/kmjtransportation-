// 1.2.0 후반 내용: 전기차 시대(배터리 용량·주행 거리·충전·전용 플랫폼·배터리 공장), 2036년 이후 가상 기술·사건, 저장 형식 6
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, sellingGens } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { unitCost } from '../src/sim/cars';
import { costMultOf, upkeepOf } from '../src/sim/company';
import { carBasePrice, monthlyDemand, toSaleCar, type SaleCar } from '../src/sim/market';
import { batteryChoices, batteryPlantInfo, chargeInfo, expectedRange, genEvInfo, projectPlatform, rangeKm, rangeMult } from '../src/sim/ev';
import { levelForTier, ptCostAdd, researchInfo } from '../src/sim/research';
import { projectPreview, salesFactors } from '../src/sim/queries';
import { monthOf, monthTime } from '../src/sim/time';
import { ERA_EVENTS, OPTIONS, TECHS } from '../src/data';
import { config } from '../src/config';
import type { Battery, Generation } from '../src/sim/types';
import { SPEC, grant, ok } from './util';

const at = (year: number, seed = 1) => { const g = Game.create({ difficulty: 'normal', seed }); g.state.week = (year - 1970) * 48; g.state.cash = 1e9; return g; };
/** 반복 기술과 skip을 뺀 기술 전부 완료 */
const grantExcept = (g: Game, ...skip: string[]) => { for (const t of TECHS) if (!t.repeatable && !skip.includes(t.id)) grant(g, t.id); };
const CHARGE = ['ec_fastCharge', 'ec_ultraCharge', 'ec_solidState', 'ec_wireless', 'ec_recycle'];
/** 중형 세단 전기차를 개발해(개발자 메뉴로 바로 출시 대기) 시장 기준가에 출시 */
function launchEv(g: Game, battery?: Battery): Generation {
  ok(g.command({ type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family', powertrain: 'ev', ...(battery ? { battery } : {}) }));
  const p = g.state.projects.at(-1)!;
  ok(g.devCheat('finishDev'));
  ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(g.state, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
  return allGens(g.state).at(-1)!;
}
const evCar = (level: number, battery?: Battery, evPlatform?: boolean): SaleCar => ({ body: 'sedanM', segment: 'family', stats: { P: 400, E: 400, U: 400, D: 400, Q: 400 }, price: 3000, awareness: 0.5, life: 1, powertrain: 'ev', options: [], level, battery, evPlatform });

describe('배터리 용량·주행 거리(1.2.0)', () => {
  it('소형 < 표준 < 대형: 원가·주행 거리·매력(표준 = 1). 2010년 표준 약 150km, 2025년(배터리 연구 3단계 + 전용 플랫폼) 약 450km', () => {
    const g = at(2021); grant(g); const s = g.state, lv = levelForTier(s, 'ev', 2);
    const c = batteryChoices(s, { body: 'sedanM', level: lv });
    expect(c.map((x) => x.id)).toEqual(['small', 'std', 'large']);
    expect(c[0].rangeKm).toBeLessThan(c[1].rangeKm); expect(c[2].rangeKm).toBeGreaterThan(c[1].rangeKm);
    expect(c[0].costDelta).toBeLessThan(0); expect(c[1].costDelta).toBe(0); expect(c[2].costDelta).toBeGreaterThan(0);
    expect(c[1].appeal).toBe(1); expect(c[0].appeal).toBeLessThan(1); expect(c[2].appeal).toBeGreaterThan(1);
    expect(c[0].chargeMinutes).toBeLessThan(c[2].chargeMinutes);
    const uc = (b: Battery) => unitCost('sedanM', 'ev', 2, [], costMultOf(s, 'ev'), ptCostAdd(s, 'ev', b));
    expect(uc('small')).toBeLessThan(uc('std')); expect(uc('large')).toBeGreaterThan(uc('std'));
    expect(rangeKm(7)).toBe(150); expect(Math.abs(rangeKm(10, 'std', true) - 450)).toBeLessThan(15);
    expect(rangeKm(20)).toBeGreaterThan(rangeKm(14)); // 표 뒤로도 연구로 는다
  });
  it('도심형 소형차는 작은 배터리 감점이 작고, 대형차는 큰 배터리 매력이 크다. 매력은 상한·하한 안(1970~2070년, 단계 1~40)', () => {
    expect(rangeMult('kei', 10, 'small', false, 2025)).toBeGreaterThan(rangeMult('sedanL', 10, 'small', false, 2025));
    expect(rangeMult('sedanL', 9, 'large', false, 2020)).toBeGreaterThan(rangeMult('kei', 9, 'large', false, 2020));
    expect(expectedRange('kei', 2025)).toBeLessThan(expectedRange('sedanL', 2025));
    const A = config.ev.appeal;
    for (const y of [1970, 2010, 2030, 2060, 2070]) for (const lv of [1, 7, 10, 20, 40]) for (const b of ['small', 'std', 'large'] as Battery[]) for (const p of [false, true]) {
      const v = rangeMult('sedanM', lv, b, p, y);
      expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(A.min); expect(v).toBeLessThanOrEqual(A.max);
    }
  });
  it('기본값(배터리 없음 = 표준, 플랫폼·충전 연구·배터리 공장 없음)은 1.1.0과 같다: 원가 가산·원가 배수·기준가·수요', () => {
    const g = at(2021); grantExcept(g, 'bd_evPlatform', ...CHARGE); const s = g.state;
    expect(ptCostAdd(s, 'ev')).toBeCloseTo(Math.max(0.1, 0.35 - 0.08 - 0.08 - 0.09), 12);
    expect(ptCostAdd(s, 'ev', 'std', false)).toBe(ptCostAdd(s, 'ev'));
    expect(costMultOf(s, 'ev')).toBe(costMultOf(s));
    const base = { body: 'sedanM', segment: 'family', powertrain: 'ev', options: [] };
    expect(carBasePrice(s, { ...base, battery: 'std' })).toBe(carBasePrice(s, base));
    for (const c of [evCar(10), evCar(10, 'std'), evCar(7, 'std', false)]) expect(monthlyDemand(s, c, [], 2021.5)).toBe(monthlyDemand(s, c, [], 2021.5, { noEv: true }));
    expect(chargeInfo(s)).toMatchObject({ step: 0, minutes: 60, mult: 1 });
    grant(g, 'ec_fastCharge'); // 충전 연구는 판매 중인 전기차 모두에 순수 가산
    expect(chargeInfo(s).minutes).toBeLessThan(60);
    expect(monthlyDemand(s, evCar(10), [], 2021.5)).toBeGreaterThan(monthlyDemand(s, evCar(10), [], 2021.5, { noEv: true }));
  });
  it('출시: 판에 배터리가 남고, 평론 뉴스에 주행 거리·충전 한 줄, 판매 요인에 주행 거리·충전(작은 배터리는 깎는 요인)', () => {
    const g = at(2021); grant(g); const s = g.state; s.factory.level = 3;
    ok(g.command({ type: 'startProject', ...SPEC, body: 'sedanL', segment: 'rich', powertrain: 'ev', battery: 'small' }));
    const p = s.projects[0]; ok(g.devCheat('finishDev'));
    const r = g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(s, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 });
    ok(r);
    expect(r.ok && r.events?.some((e) => /주행 거리 \d+km.*10→80% 충전은 \d+분/.test(e.text))).toBe(true);
    const gen = allGens(s)[0];
    expect(gen.editions[0].battery).toBe('small');
    for (let i = 0; i < 8; i++) g.tick();
    const f = salesFactors(s, gen.id)!.factors.find((x) => x.key === 'range')!;
    expect(f.detail).toContain('km'); expect(f.impact).toBeLessThan(0);
    expect(g.command({ type: 'startProject', ...SPEC, powertrain: 'ev', battery: 'huge' as Battery }).ok).toBe(false);
  });
});

describe('배터리 선택지 원가 차이(1.2.0 화면 버그)', () => {
  it('tier를 주면 costDelta가 실제 대당 원가(unitCost) 차이와 같다(동력 등급 원가 가산 포함)', () => {
    const g = at(2025); grant(g); const s = g.state;
    for (const tier of [1, 2, 3]) {
      const c = batteryChoices(s, { body: 'sedanM', level: levelForTier(s, 'ev', tier), tier });
      const uc = (b: Battery) => unitCost('sedanM', 'ev', tier, [], costMultOf(s, 'ev'), ptCostAdd(s, 'ev', b, true));
      for (const x of c) expect(x.costDelta).toBeCloseTo(uc(x.id) - uc('std'), 9);
    }
  });
});

describe('전용 플랫폼(1.2.0)', () => {
  it('연구 뒤 새로 출시하는 전기차 세대에만: 실용 +6%, 이미 출시한 세대(와 그 페이스리프트)는 그대로', () => {
    const g = at(2021); grantExcept(g, 'bd_evPlatform'); const s = g.state; s.factory.level = 3;
    const g1 = launchEv(g);
    expect(g1.evPlatform).toBeUndefined();
    grant(g, 'bd_evPlatform');
    expect(genEvInfo(s, g1.id)!.platform).toBe(false);
    expect(projectPlatform(s, { powertrain: 'ev', kind: 'facelift', targetId: g1.id })).toBe(false);
    expect(projectPlatform(s, { powertrain: 'gasoline' })).toBe(false);
    ok(g.command({ type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family', powertrain: 'ev' }));
    const p = s.projects.at(-1)!, u1 = projectPreview(s, p.id)!.stats.U;
    s.research.done = s.research.done.filter((x) => x !== 'bd_evPlatform');
    const u0 = projectPreview(s, p.id)!.stats.U;
    grant(g, 'bd_evPlatform');
    expect(u1 / u0).toBeCloseTo(1 + config.ev.platform.u, 9);
    ok(g.devCheat('finishDev'));
    ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(s, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
    const g2 = allGens(s).at(-1)!;
    expect(g2.evPlatform).toBe(true); expect(g1.evPlatform).toBeUndefined();
    expect(genEvInfo(s, g2.id)!.rangeKm).toBeGreaterThan(genEvInfo(s, g1.id)!.rangeKm);
    expect(ptCostAdd(s, 'ev', undefined, true)).toBeLessThan(ptCostAdd(s, 'ev'));
  });
});

describe('배터리 자체 생산(1.2.0)', () => {
  it('전기차 연구 뒤 건설: 건설비·공사 기간, 끝나면 전기차 원가 −3%·월 유지비, 전기차를 안 팔아도 유지비는 나간다', () => {
    const g = at(2021); const s = g.state, L = config.ev.plant.levels;
    expect(g.command({ type: 'buildBatteryPlant' }).ok).toBe(false);
    grant(g, 'ec_ev');
    const cash = s.cash, up0 = upkeepOf(s), m0 = monthOf(s.week);
    ok(g.command({ type: 'buildBatteryPlant' }));
    expect(s.cash).toBe(cash - L[0].cost); expect(s.batteryPlant.build).toEqual({ level: 1, doneMonth: m0 + L[0].buildMonths });
    expect(g.command({ type: 'buildBatteryPlant' }).ok).toBe(false); // 공사 중
    expect(batteryPlantInfo(s)).toMatchObject({ level: 0, canBuild: false, building: { level: 1 } });
    while (s.batteryPlant.level === 0) g.tick();
    expect(costMultOf(s, 'ev') / costMultOf(s)).toBeCloseTo(1 - L[0].cut, 12);
    const info = batteryPlantInfo(s);
    expect(info.upkeep).toBeGreaterThan(0); expect(upkeepOf(s)).toBeCloseTo(up0 + info.upkeep, 6);
    do g.tick(); while (s.week % 4 !== 0);
    expect(s.ledger.at(-1)!.upkeep).toBeCloseTo(up0 + info.upkeep, 6);
    expect(info.next?.level).toBe(2); expect(info.levels.length).toBe(3);
    s.batteryPlant.level = 3; expect(batteryPlantInfo(s).next).toBeNull(); expect(g.command({ type: 'buildBatteryPlant' }).ok).toBe(false);
  });
});

describe('저장 형식 6(1.2.0)', () => {
  it('형식 5 fixture: 배터리 공장 없음으로 올라오고, 옛 전기차(배터리 필드 없음)는 수요·원가가 그대로, 저장 왕복이 같다', () => {
    const raw = JSON.parse(readFileSync('car/tests/fixtures/save-v5.json', 'utf8'));
    expect(raw.saveVersion).toBe(5); expect(raw.batteryPlant).toBeUndefined();
    const a = Game.fromJSON(raw);
    expect(a.state.saveVersion).toBe(7); expect(a.state.batteryPlant).toEqual({ level: 0, build: null });
    const b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    for (let i = 0; i < 40; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
    // 옛 전기차: 판매 중 세대 하나를 전기차로 바꾼 형식 5(2025년)
    const r2 = JSON.parse(JSON.stringify(raw));
    r2.week = (2025 - 1970) * 48;
    const gens = r2.nameplates.flatMap((n: { generations: Generation[] }) => n.generations) as Generation[], old = gens.find((x) => x.status === 'onSale')!;
    old.powertrain = 'ev';
    const s = Game.fromJSON(r2).state, m = monthOf(s.week), on = sellingGens(s), i = on.findIndex((x) => x.id === old.id);
    const cars = on.map((x) => toSaleCar(x, m)), ed = on[i].editions.at(-1)!;
    expect(ed.battery).toBeUndefined(); expect(on[i].evPlatform).toBeUndefined();
    const others = cars.filter((_, j) => j !== i);
    expect(monthlyDemand(s, cars[i], others, monthTime(m))).toBe(monthlyDemand(s, cars[i], others, monthTime(m), { noEv: true }));
    expect(ptCostAdd(s, 'ev', ed.battery, on[i].evPlatform)).toBe(ptCostAdd(s, 'ev'));
  });
});

describe('2036년 이후 가상 기술·사건(1.2.0)', () => {
  it('기술 8~12개(2036~2058년, 해금 옵션은 기대 연도가 있다), 사건 5~7개', () => {
    const late = TECHS.filter((t) => t.year >= 2036 && !t.repeatable);
    expect(late.length).toBeGreaterThanOrEqual(8); expect(late.length).toBeLessThanOrEqual(12);
    for (const t of late) { expect(t.year).toBeLessThanOrEqual(2058); for (const e of t.effects) if (e.type === 'option') expect(OPTIONS.find((o) => o.id === e.id)?.expect, e.id).toBeTruthy(); }
    const ev = ERA_EVENTS.filter((e) => e.year >= 2036);
    expect(ev.length).toBeGreaterThanOrEqual(5); expect(ev.length).toBeLessThanOrEqual(7);
  });
  it('2030년부터 신중 봇으로 2065년까지: 오류·NaN 없이, 2036년 이후 사건이 모두 뜨고 새 기술을 연구하며, 봇의 전기차는 배터리를 고른다', () => {
    const g = at(2030, 7); grant(g); const s = g.state, bot = steady(), texts: string[] = [];
    while (s.week < (2065 - 1970) * 48) { bot.step(g); texts.push(...g.tick().map((e) => e.text)); }
    expect(s.status).toBe('playing'); expect(Number.isFinite(s.cash)).toBe(true);
    for (const e of s.ledger) for (const v of Object.values(e)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    for (const x of allGens(s)) for (const e of x.editions) for (const v of Object.values(e.stats)) expect(Number.isFinite(v)).toBe(true);
    for (const e of ERA_EVENTS.filter((x) => x.year >= 2036)) expect(texts.some((t) => t.startsWith(`[${e.name}]`)), e.name).toBe(true);
    expect(s.research.done.filter((id) => TECHS.find((t) => t.id === id)!.year >= 2036).length).toBeGreaterThan(0);
    for (const f of researchInfo(s).fields) for (const t of f.techs) expect(Number.isFinite(t.cost.money)).toBe(true);
    const evs = allGens(s).filter((x) => x.powertrain === 'ev');
    expect(evs.length).toBeGreaterThan(0);
    for (const x of evs) { expect(x.editions[0].battery).toBeDefined(); const i = genEvInfo(s, x.id)!; expect(Number.isFinite(i.demandMult) && i.rangeKm > 0).toBe(true); }
    for (const x of sellingGens(s)) for (const f of salesFactors(s, x.id)?.factors ?? []) expect(Number.isFinite(f.impact)).toBe(true);
  });
});
