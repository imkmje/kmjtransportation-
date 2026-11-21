// 1.1.0 장비 구성: 안 넣음 / 선택 사양 / 기본 장비, 시대의 기대, 추천 구성, 저장 형식 5
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, SAVE_VERSION } from '../src/sim/game';
import { equipChanges, equipInfo, equipOf, expectEffect, expectation, optPerCar, optPrice, recommendedEquip, takeRate } from '../src/sim/equip';
import { monthlyDemand } from '../src/sim/market';
import { planPreview } from '../src/sim/queries';
import { BODIES, OPTIONS } from '../src/data';
import { config } from '../src/config';
import { SPEC, grant, ok } from './util';
import type { Equip } from '../src/sim/types';

const at = (year: number) => { const g = Game.create({ difficulty: 'normal', seed: 1 }); g.state.week = (year - 1970) * 48; grant(g); return g; };

describe('시대의 기대(1.1.0)', () => {
  it('1970년에는 어느 차급에서도 기대되는 장비가 없어, 장비가 없어도 감점이 없다', () => {
    for (const b of BODIES) for (const o of OPTIONS) expect(expectation(o.id, b.id, 1970)).not.toBe('expected');
    for (const b of BODIES) expect(expectEffect({}, b.id, 1970).mult).toBe(1);
  });
  it('대형이 먼저, 소형이 늦게 기대된다(자료 순서)', () => {
    for (const o of OPTIONS) { const e = o.expect!; expect(e.big[1]).toBeLessThanOrEqual(e.mid[1]); expect(e.mid[1]).toBeLessThanOrEqual(e.small[1]); expect(e.big[0]).toBeLessThanOrEqual(e.big[1]); }
  });
  it('기대 장비가 다 빠진 차는 뚜렷이 덜 팔린다(2015년 중형 세단: 수요 −25~45%), 선택 사양으로만 있으면 조금 덜', () => {
    const g = at(2015), s = g.state, std = recommendedEquip(s, 'sedanM', 'family', 'gasoline');
    const req = Object.fromEntries(Object.entries(std).filter(([id]) => id === 'abs' || id === 'airbag')) as Equip;
    const optOnly = Object.fromEntries(Object.entries(std).map(([id, v]) => [id, id === 'abs' || id === 'airbag' ? v : 'opt'])) as Equip;
    const car = (e: Equip) => ({ body: 'sedanM', segment: 'family', stats: { P: 300, E: 300, U: 300, D: 300, Q: 300 }, price: 2600, awareness: 0.5, life: 1, powertrain: 'gasoline', equip: e });
    const d = (e: Equip) => monthlyDemand(s, car(e), [], 2015, { noExpect: false });
    const fx = expectEffect(req, 'sedanM', 2015);
    expect(fx.missing.length).toBeGreaterThanOrEqual(3);
    const r = d(req) / d(std), ro = d(optOnly) / d(std);
    expect(r).toBeGreaterThan(0.55); expect(r).toBeLessThan(0.75);
    expect(ro).toBeGreaterThan(r); expect(ro).toBeLessThan(1);
  });
});

describe('선택 사양(1.1.0)', () => {
  it('선택률만큼 대당 평균 이익이 늘고(요금 − 원가), 선택률은 기대·궁합·차급을 따른다', () => {
    const p = optPerCar({ leather: 'opt' }, 'sedanL', 'rich', 2000), r = takeRate('leather', 'sedanL', 'rich', 2000);
    expect(p.rev - p.cost).toBeCloseTo(r * (optPrice('leather') - OPTIONS.find((o) => o.id === 'leather')!.cost), 6);
    expect(optPrice('leather')).toBeGreaterThan(OPTIONS.find((o) => o.id === 'leather')!.cost);
    expect(takeRate('aircon', 'sedanM', 'family', 1995)).toBeGreaterThan(takeRate('aircon', 'sedanM', 'family', 1979)); // 흔해질수록 많이 단다
    expect(takeRate('aircon', 'sedanM', 'family', 1985)).toBeGreaterThan(takeRate('aircon', 'sports', 'enthusiast', 1985)); // 맞는 손님이 많이 단다
  });
  it('기본 장비 > 선택 사양 > 안 넣음 순으로 예상 등급이 높다(선택 사양은 효과 일부)', () => {
    const g = at(1990), s = g.state, spec = (equip: Equip) => ({ ...SPEC, body: 'sedanM', segment: 'family', options: [], equip });
    const a = planPreview(s, spec({})).avg, b = planPreview(s, spec({ aircon: 'opt', autoTrans: 'opt' })).avg, c = planPreview(s, spec({ aircon: 'std', autoTrans: 'std' })).avg;
    expect(b).toBeGreaterThan(a); expect(c).toBeGreaterThan(b);
  });
});

describe('추천 구성과 바뀐 기대(1.1.0)', () => {
  it('추천: 의무·기대 장비는 기본 장비, 고객층이 중시하는 장비는 선택 사양, 기본 장비 원가는 기준가의 stdCap 이하', () => {
    const g = at(2010), s = g.state, e = recommendedEquip(s, 'sedanM', 'family', 'gasoline');
    expect(e.abs).toBe('std'); expect(e.airbag).toBe('std'); expect(e.aircon).toBe('std');
    const info = equipInfo(s, { body: 'sedanM', segment: 'family', powertrain: 'gasoline', equip: e });
    expect(info.totals.missingExpected).toEqual([]);
    expect(info.totals.stdCost).toBeLessThanOrEqual(2600 * config.equip.stdCap + 140); // 의무 장비 몫은 상한 밖
    expect(Object.values(e)).toContain('opt');
  });
  it('equipChanges: 전작에 없던 기대 장비는 기본 장비로 바꾸라고 알린다', () => {
    const g = at(2016), ch = equipChanges(g.state, { radio: 'std' }, 'sedanM', 'family');
    const nav = ch.find((x) => x.id === 'navigation');
    expect(ch.find((x) => x.id === 'aircon')).toMatchObject({ from: null, to: 'std' });
    expect(nav?.to).toBe('std');
  });
});

describe('명령과 저장 형식 5(1.1.0)', () => {
  it('startProject의 equip: options는 기본 장비 목록, 출시 판에 equip이 남고, 장비 칸 수 제한이 없다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 2 }); g.state.week = 48 * 15; grant(g, 'el_aircon', 'el_powerSteering', 'el_autoTrans');
    ok(g.command({ type: 'startProject', ...SPEC, options: [], equip: { radio: 'std', aircon: 'opt', powerSteering: 'opt', autoTrans: 'opt' } }));
    const p = g.state.projects[0];
    expect(p.options).toEqual(['radio']); expect(p.equip).toEqual({ radio: 'std', aircon: 'opt', powerSteering: 'opt', autoTrans: 'opt' });
    while (!(p.phase === 'test' && p.testWeeks >= config.dev.minTestWeeks)) g.tick();
    ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    expect(allGens(g.state)[0].editions[0].equip).toEqual({ radio: 'std', aircon: 'opt', powerSteering: 'opt', autoTrans: 'opt' });
    expect(g.command({ type: 'startProject', ...SPEC, options: [], equip: { radio: 'x' as never } }).ok).toBe(false);
  });
  it('형식 4 저장의 옵션은 모두 기본 장비로 바뀌고(형식 5), 형식 5 fixture가 열리며 저장 왕복이 같다', () => {
    expect(SAVE_VERSION).toBe(5);
    const v4 = Game.fromJSON(JSON.parse(readFileSync('car/tests/fixtures/save-v4.json', 'utf8')));
    expect(v4.state.saveVersion).toBe(5);
    for (const g of allGens(v4.state)) for (const e of g.editions) expect(e.equip).toEqual(Object.fromEntries(e.options.map((o) => [o, 'std'])));
    const raw = JSON.parse(readFileSync('car/tests/fixtures/save-v5.json', 'utf8'));
    expect(raw.saveVersion).toBe(5);
    const a = Game.fromJSON(raw), b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(allGens(a.state).some((g) => Object.values(equipOf(g.editions.at(-1)!)).includes('opt'))).toBe(true);
    for (let i = 0; i < 40; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
});
