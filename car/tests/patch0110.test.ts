// 1.0.0 밸런스: 평판 상한 없앰, 동력 시장 가산, 옵션 값, 공장 6·7등급, 기준가 초과 벌점의 시대 변화, 페이스리프트 수명
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens } from '../src/sim/game';
import { awarenessTarget, basePriceOf, carBasePrice, optionValue, currentEdition, monthlyDemand, toSaleCar } from '../src/sim/market';
import { capacityOf, costMultOf, factoryBuildMonths, repEffect } from '../src/sim/company';
import { requiredOptions } from '../src/sim/events';
import { withRequired } from '../src/sim/dev';
import { ptCostAdd } from '../src/sim/research';
import { unitCost } from '../src/sim/cars';
import { OPTIONS } from '../src/data';
import { faceliftPreview, factoryInfo, modelPnL, reputationInfo } from '../src/sim/queries';
import { monthOf, monthTime } from '../src/sim/time';
import { config } from '../src/config';
import { SPEC, launched, ok, toMonthEnd } from './util';

describe('평판 상한 없앰(1.0.0)', () => {
  it('평판은 100을 넘는다. 효과는 100까지 그대로, 100 → 200의 추가 효과가 0 → 100의 1/3', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    g.state.reputation = 98; ok(g.devCheat('reputation')); expect(g.state.reputation).toBe(108);
    expect(repEffect(0)).toBe(0); expect(repEffect(55)).toBe(55); expect(repEffect(100)).toBe(100);
    expect(repEffect(200) - repEffect(100)).toBeCloseTo((repEffect(100) - repEffect(0)) / 3, 9);
    expect(repEffect(400)).toBeLessThan(repEffect(100) * 2); // 로그로 완만하게
    const aw = (r: number) => awarenessTarget(r, 0, 0);
    expect(aw(200) - aw(100)).toBeCloseTo((aw(100) - aw(0)) / 3, 9);
  });
  it('평판 조회: 효과 목록(인지도·채용·임원 후보·3등급 공고·본사)과 다음 문턱', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    let r = reputationInfo(s);
    expect(r.value).toBe(10); expect(r.effects.map((x) => x.key)).toEqual(['awareness', 'hire', 'exec', 'tier3', 'hq']);
    expect(r.next).toEqual({ rep: 20, text: '본사 빌딩 승급 조건' });
    s.reputation = 150; r = reputationInfo(s);
    expect(r.soft).toBe(true); expect(r.effect).toBeCloseTo(repEffect(150), 9);
    expect(r.effects.find((x) => x.key === 'hire')!.text).toBe('직원 후보 능력 +5');
    expect(r.next!.text).toBe('직원 후보 능력 +6'); expect(repEffect(r.next!.rep)).toBeGreaterThanOrEqual(120); expect(repEffect(r.next!.rep - 1)).toBeLessThan(120);
  });
  it('0.10.0에서 평판 100에 붙어 있던 저장(형식 4)을 불러 이어 하면 평판이 100을 넘고, 저장 왕복이 같다', () => {
    const save = JSON.parse(readFileSync('car/tests/fixtures/save-v4-suv.json', 'utf8'));
    expect(save.reputation).toBe(100);
    const g = Game.fromJSON(save);
    for (let i = 0; i < 12; i++) toMonthEnd(g);
    expect(g.state.status).toBe('playing'); expect(g.state.saveVersion).toBe(12);
    expect(g.state.reputation).toBeGreaterThan(100);
    const b = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    for (let i = 0; i < 8; i++) { g.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
});

describe('동력 시장 가산(1.0.0)', () => {
  it('하이브리드·전기차의 시장 기준가는 원가가 비싼 만큼 높고(전기는 해마다 줄어듦), 가솔린은 그대로', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    s.week = (2015 - 1970) * 48;
    const gas = basePriceOf(s, 'sedanM'), hy = basePriceOf(s, 'sedanM', 'hybrid'), ev = basePriceOf(s, 'sedanM', 'ev');
    expect(basePriceOf(s, 'sedanM', 'gasoline')).toBe(gas);
    expect(hy).toBeGreaterThan(gas * 1.1); expect(ev).toBeGreaterThan(hy);
    s.week = (2035 - 1970) * 48;
    expect(basePriceOf(s, 'sedanM', 'ev') / basePriceOf(s, 'sedanM')).toBeLessThan(ev / gas);
  });
});

describe('페이스리프트 수명(1.0.0)', () => {
  /** 1970년 첫 차(결함 0, 공장 2등급)를 160개월 팔며 liftAt개월에 페이스리프트. 경쟁 차를 고정(A 0.5)한 수요로 '정점의 25%'가 되는 달을 잰다(경쟁사 새 모델의 흔들림을 뺀다) */
  function run(seed: number, liftAt?: number, total = 160) {
    const g = Game.create({ seed, difficulty: 'normal' }); g.state.cash = 1e9; g.state.factory.level = 2;
    ok(g.command({ type: 'startProject', ...SPEC }));
    const ready = () => { const q = g.state.projects[0]; return q.phase === 'test' && q.testWeeks >= config.dev.minTestWeeks && (q.defectEst <= 5 || !!q.waiting); };
    while (!ready()) g.tick();
    ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    const gen = allGens(g.state)[0]; gen.editions[0].defects = 0;
    const dem: number[] = [];
    for (let m = 0; m < total; m++) {
      for (let w = 0; w < 4; w++) {
        if (m === liftAt && w === 0) ok(g.command({ type: 'startFacelift', generationId: gen.id, options: currentEdition(gen).options }));
        if (g.state.projects.length && ready()) ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: currentEdition(gen).price, marketing: gen.marketing, color: 'red', wheels: 0 }));
        g.tick();
      }
      const mm = monthOf(g.state.week) - 1;
      dem.push(monthlyDemand(g.state, toSaleCar(gen, mm), [], monthTime(mm), { rivalA: 0.5 }));
    }
    return { dem, g, gen };
  }
  it('출시 36개월 리프트가 수요가 정점의 25%가 되는 때를 24~36개월(중앙값) 늦춘다(1.0.0: 수명 되돌림 60% → 30%)', () => {
    const ext = [1, 2, 3, 4].map((seed) => {
      const b = run(seed).dem, a = run(seed, 36).dem, peak = Math.max(...b.slice(0, 40)), q = (x: number[]) => x.findIndex((v, j) => j > 10 && v < peak * 0.25);
      return q(a) - q(b);
    }).sort((x, y) => x - y);
    console.log(`리프트 수명 연장(개월): ${ext.join(', ')}`);
    const med = (ext[1] + ext[2]) / 2;
    expect(med).toBeGreaterThanOrEqual(24); expect(med).toBeLessThanOrEqual(36);
  });
  it('적기(출시 36개월) 리프트는 차종별 손익의 리프트 비교(하지 않았을 때 추정 대비)에서 이익으로 나온다', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { g, gen } = run(seed, 36, 36 + 8 + 12), f = modelPnL(g.state, gen.id)!.facelift!;
      expect(f.months, `seed ${seed}`).toBe(12);
      expect(f.gain, `seed ${seed}: ${f.text}`).toBeGreaterThan(0);
    }
  });
});

describe('옵션 값(1.0.0, 사용자 보고 "옵션을 넣을수록 적자")', () => {
  it('차별 기준가 = 차급 기준가(동력·의무 장비 포함) + 의무 장비가 아닌 옵션의 값', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    s.week = (1996 - 1970) * 48; // 안전 규제(ABS·에어백) 시행 뒤
    const req = requiredOptions(s);
    expect(req.length).toBeGreaterThan(0);
    const car = { body: 'sedanM', segment: 'family', powertrain: 'gasoline', options: [...req, 'aircon', 'leather'] };
    const t = 1996;
    expect(carBasePrice(s, car)).toBeCloseTo(basePriceOf(s, 'sedanM', 'gasoline') + optionValue('aircon', 'family', t) + optionValue('leather', 'family', t), 6);
    expect(carBasePrice(s, { ...car, options: req })).toBeCloseTo(basePriceOf(s, 'sedanM', 'gasoline'), 6);
  });
  it('맞는 옵션은 원가보다 조금 더(good), 안 맞는 옵션은 덜(bad) 쳐 준다', () => {
    const V = config.optionValue, o = (id: string) => OPTIONS.find((x) => x.id === id)!.cost;
    expect(optionValue('leather', 'rich')).toBeCloseTo(o('leather') * V.good, 9); // 디자인·품질을 따지는 부유층
    expect(optionValue('aircon', 'enthusiast')).toBeCloseTo(o('aircon') * V.bad, 9); // 실용을 안 따지는 마니아
  });
  it('고객층에 맞는 옵션을 넣으면 같은 판매 조건(차별 기준가에 판매)에서 대당 이익이 줄지 않고, 안 맞는 옵션은 줄인다', () => {
    for (const lv of [1, 3, 5]) for (const year of [1980, 2000, 2020]) {
      const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
      s.factory.level = lv; s.week = (year - 1970) * 48;
      const unit = (seg: string, options: string[]) => { const c = { body: 'sedanM', segment: seg, powertrain: 'gasoline', options: withRequired(s, options) }; return carBasePrice(s, c) - unitCost(c.body, c.powertrain, 2, c.options, costMultOf(s), ptCostAdd(s, c.powertrain)); };
      expect(unit('family', ['aircon', 'powerSteering'])).toBeGreaterThanOrEqual(unit('family', []) - 1e-6);
      expect(unit('enthusiast', ['aircon', 'powerSteering'])).toBeLessThan(unit('enthusiast', []));
    }
  });
});

describe('공장 6·7등급(1.0.0, 사용자 요청 "2만 대 넘게 팔린다")', () => {
  it('등급마다 한도·라인이 늘고, 한도 1대당 월 유지비가 줄지 않으며, 공사 기간이 길어진다', () => {
    const L = config.factory.levels;
    expect(L.length).toBe(7);
    for (let i = 4; i < L.length; i++) {
      expect(L[i].capacity).toBeGreaterThan(L[i - 1].capacity); expect(L[i].lines).toBeGreaterThan(L[i - 1].lines);
      expect(L[i].upkeep / L[i].capacity).toBeGreaterThanOrEqual(L[i - 1].upkeep / L[i - 1].capacity - 1e-9);
      expect(factoryBuildMonths(i + 1)).toBeGreaterThanOrEqual(factoryBuildMonths(i));
    }
  });
  it('옛 저장(5등급 공장)을 열어 6등급으로 증설하면 공사 기간 뒤 한도가 늘고, 조회가 다음 등급을 보여 준다', () => {
    const g = Game.fromJSON(JSON.parse(readFileSync('car/tests/fixtures/save-v4-suv.json', 'utf8'))), s = g.state;
    expect(s.factory.level).toBe(5);
    const f = factoryInfo(s);
    expect(f.next?.level).toBe(6); expect(f.next?.buildMonths).toBe(factoryBuildMonths(6));
    s.cash = Math.max(s.cash, config.factory.levels[5].cost * 2);
    ok(g.command({ type: 'expandFactory' }));
    const m0 = monthOf(s.week);
    while (s.factory.level === 5) g.tick();
    expect(monthOf(s.week) - m0).toBe(factoryBuildMonths(6));
    expect(capacityOf(s)).toBe(config.factory.levels[5].capacity);
    expect(factoryInfo(s).next?.level).toBe(7);
  });
});

describe('오래된 차의 수명 하한(1.0.0 스모크 재현: 1997년 13년 된 차의 페이스리프트 옵션이 예상에 반영되지 않음)', () => {
  it('출시 13년 된 차도 수명이 0이 되지 않아, 페이스리프트 옵션(에어컨)이 예상 판매·이익을 바꾼다', () => {
    const { g, gen } = launched(1); toMonthEnd(g); toMonthEnd(g);
    const m = monthOf(g.state.week); gen.launchMonth = m - 156; gen.lifeMonth = m - 156;
    const a = faceliftPreview(g.state, gen.id, { options: [] })!, b = faceliftPreview(g.state, gen.id, { options: ['aircon'] })!;
    expect(a.lifeBefore).toBeGreaterThan(0.1);
    expect(a.salesAfter).toBeGreaterThan(0);
    expect(b.profitAfter).not.toBeCloseTo(a.profitAfter, 0);
  });
});
