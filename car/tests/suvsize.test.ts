// SUV 크기 구분(소형·중형·대형): 자료, 연구, 시장, 경쟁사, 옛 저장 호환, 봇
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, SAVE_VERSION } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { bodiesAt } from '../src/sim/cars';
import { cellMonthly, monthlyDemand, rivalBase, toSaleCar } from '../src/sim/market';
import { unlockedBodies } from '../src/sim/research';
import { monthOf, monthTime } from '../src/sim/time';
import { BODIES, COMPAT, MARKET, RIVALS, bodyById, techById } from '../src/data';
import { config } from '../src/config';
import { SPEC, grant, ok } from './util';

const WPY = 48;
const SUV = ['suvS', 'suv', 'suvL'] as const;
const load = (f: string) => JSON.parse(readFileSync(`car/tests/fixtures/${f}`, 'utf8'));

describe('SUV 소·중·대 자료', () => {
  it('세단처럼 크기 순: 기준가·원가가 소 < 중 < 대, 중형이 옛 SUV의 id·해금 연도·수치를 이어받는다, 원가는 기준가의 82%', () => {
    const [s, m, l] = SUV.map(bodyById);
    expect([s.name, m.name, l.name]).toEqual(['소형 SUV', '중형 SUV', '대형 SUV']);
    expect(s.basePrice).toBeLessThan(m.basePrice); expect(m.basePrice).toBeLessThan(l.basePrice);
    expect([m.year, m.basePrice, m.cost, m.mult]).toEqual([1993, 3800, 3116, { P: 1, E: 0.8, U: 1.4, D: 1.1, Q: 1 }]);
    expect(m.year).toBeLessThanOrEqual(l.year); expect(l.year).toBeLessThan(s.year); expect(s.year).toBeGreaterThanOrEqual(1995);
    // 세단과 같은 방향의 배수 차이: 작을수록 연비, 클수록 성능·디자인(연비는 낮게)
    expect(s.mult.E).toBeGreaterThan(m.mult.E); expect(l.mult.E).toBeLessThan(m.mult.E);
    expect(l.mult.P).toBeGreaterThan(m.mult.P); expect(l.mult.D).toBeGreaterThan(m.mult.D); expect(l.mult.U).toBeGreaterThanOrEqual(m.mult.U);
    // 세단·SUV가 크기 순으로 붙어 있다(기획 화면의 차체 줄 순서)
    const ids = BODIES.map((b) => b.id), at = (x: string) => ids.indexOf(x);
    expect([at('sedanM') - at('sedanS'), at('sedanL') - at('sedanM'), at('suv') - at('suvS'), at('suvL') - at('suv')]).toEqual([1, 1, 1, 1]);
  });
  it('연구: 소형은 중형 SUV·해치백, 대형은 중형 SUV·대형 세단이 먼저. 중형 SUV 기술은 그대로(사륜구동 포함)', () => {
    expect(techById('bd_suvS').pre).toEqual(['bd_suv', 'bd_hatch']); expect(techById('bd_suvL').pre).toEqual(['bd_suv', 'bd_sedanL']);
    expect(techById('bd_suv').effects).toEqual([{ type: 'body', id: 'suv' }, { type: 'option', id: 'awd' }]);
    for (const [t, b] of [['bd_suvS', 'suvS'], ['bd_suvL', 'suvL']]) { expect(techById(t).effects).toEqual([{ type: 'body', id: b }]); expect(techById(t).year).toBe(bodyById(b).year); }
    const g = Game.create({ difficulty: 'normal', seed: 3 });
    grant(g, 'bd_suv'); expect(unlockedBodies(g.state).map((b) => b.id).filter((x) => x.startsWith('suv'))).toEqual(['suv']);
    grant(g, 'bd_suvS', 'bd_suvL'); expect(unlockedBodies(g.state).map((b) => b.id).filter((x) => x.startsWith('suv'))).toEqual(['suvS', 'suv', 'suvL']);
    expect(bodiesAt(1996).map((b) => b.id).filter((x) => x.startsWith('suv'))).toEqual(['suvS', 'suv', 'suvL']);
  });
  it('시장: 세 칸의 합은 옛 SUV 칸 그대로(전체 시장 규모 불변), SUV 비중은 해마다 커지고 소형은 2010년대에 가장 빨리 큰다', () => {
    const sh = MARKET.domestic.bodyShare, sum = MARKET.domestic.years.map((_, i) => SUV.reduce((a, b) => a + sh[b][i], 0));
    [0, 0, 0.04, 0.12, 0.2, 0.27, 0.32].forEach((v, i) => expect(sum[i]).toBeCloseTo(v, 9));
    const i2010 = 4, i2020 = 5, grow = (b: string) => sh[b][i2020] / sh[b][i2010];
    expect(grow('suvS')).toBeGreaterThan(grow('suv')); expect(grow('suvS')).toBeGreaterThan(grow('suvL'));
    const mix = MARKET.domestic.mix;
    expect(mix.suvS.youth + mix.suvS.worker).toBeGreaterThanOrEqual(0.5); // 젊은 손님·직장인(해치백과 겹침)
    expect(mix.suvL.family + mix.suvL.rich).toBeGreaterThanOrEqual(0.7); // 고가·가족
    expect(COMPAT.suvS.youth).toBe(1.2); expect(COMPAT.suvL.rich).toBe(1.2); expect(COMPAT.suvL.family).toBe(1.2);
    expect(cellMonthly('suvS', 2015)).toBeGreaterThan(0); expect(cellMonthly('suvL', 2015)).toBeGreaterThan(0);
  });
});

describe('경쟁사와 저장 호환', () => {
  it('새 게임: 경쟁사 3곳이 소형·대형 SUV 칸에도 차를 낸다. 새 칸은 게임 난수를 쓰지 않는다(직원 잠재력 등 기존 시드의 난수 순서 유지)', () => {
    for (const seed of [1, 7, 42]) {
      const g = Game.create({ difficulty: 'normal', seed });
      for (const r of g.state.rivals) {
        expect(Object.keys(r.models).sort()).toEqual(Object.keys(RIVALS.find((x) => x.id === r.id)!.cells).sort());
        for (const b of ['suvS', 'suvL']) { const d = r.models[b].base - rivalBase(0) - RIVALS.find((x) => x.id === r.id)!.cells[b]; expect(Math.abs(d)).toBeLessThanOrEqual(config.rivals.noise); expect(r.cells[b]).toBeGreaterThan(0); }
      }
    }
    // 새 게임을 만든 직후의 게임 난수 상태가 0.5.1 코드로 잰 값과 같다(난수를 꺼낸 횟수가 같다)
    expect([1, 7, 42].map((seed) => Game.create({ difficulty: 'normal', seed }).state.rng)).toEqual([3911320115, 3911320121, 3911320156]);
  });
  it('0.5.1에서 만든 저장(중형 SUV를 팔던 2003년, 형식 4)을 그대로 연다: 옛 suv는 중형 SUV, 경쟁사 새 칸을 채운다, 이어서 3년 돌고 저장 왕복이 같다', () => {
    const raw = load('save-v4-suv.json');
    expect(raw.saveVersion).toBe(4); expect(SAVE_VERSION).toBe(7);
    expect(raw.rivals[0].models.suvS).toBeUndefined();
    const g = Game.fromJSON(raw), s = g.state, m = monthOf(s.week);
    const suv = allGens(s).find((x) => x.body === 'suv' && x.status === 'onSale')!;
    expect(bodyById(suv.body).name).toBe('중형 SUV');
    expect(monthlyDemand(s, toSaleCar(suv, m), [], monthTime(m))).toBeGreaterThan(0);
    for (const r of s.rivals) for (const b of ['suvS', 'suvL']) { expect(r.models[b].base).toBeCloseTo(rivalBase(m) + RIVALS.find((x) => x.id === r.id)!.cells[b], 9); expect(r.cells[b]).toBeGreaterThan(0); }
    expect(s.research.done).toContain('bd_suv'); expect(s.research.done).not.toContain('bd_suvS');
    const a = Game.fromJSON(load('save-v4-suv.json')), b = Game.fromJSON(JSON.parse(JSON.stringify(Game.fromJSON(load('save-v4-suv.json')).toJSON())));
    const ba = steady(), bb = steady();
    for (let i = 0; i < WPY * 3; i++) { ba.step(a); a.tick(); bb.step(b); b.tick(); }
    expect(a.state.status).toBe('playing');
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
  it('옛 픽스처(형식 1~4)도 모두 열리고 경쟁사 칸이 12종 모두 찬다', () => {
    for (const f of ['save-v1.json', 'save-v2.json', 'save-v3.json', 'save-v4.json', 'save-v4b.json']) {
      const s = Game.fromJSON(load(f)).state;
      expect(s.saveVersion).toBe(7);
      for (const r of s.rivals) expect(Object.keys(r.models).sort(), f).toEqual(BODIES.map((b) => b.id).sort());
    }
  });
});

describe('봇과 개발', () => {
  it('소형·대형 SUV로 개발을 시작해 출시할 수 있다', () => {
    for (const body of ['suvS', 'suvL']) {
      const g = Game.create({ difficulty: 'normal', seed: 5 }); g.state.week = 30 * WPY; g.state.cash = 1e9;
      expect(g.command({ type: 'startProject', ...SPEC, body }).ok).toBe(false);
      grant(g, `bd_${body}`, 'bd_abs', 'bd_airbag'); ok(g.command({ type: 'startProject', ...SPEC, body }));
      const p = g.state.projects[0]; while (!(p.phase === 'test' && p.testWeeks >= 2)) g.tick();
      ok(g.command({ type: 'launch', projectId: p.id, price: bodyById(body).basePrice, marketing: 1, color: 'red', wheels: 0 }));
      expect(allGens(g.state)[0].body).toBe(body);
    }
  });
  it('신중 봇이 대형 SUV는 2016년까지, 소형 SUV는 수요가 커지는 2010~2024년에 낸다(시드 5, 2025년까지)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 5 }), b = steady();
    for (let w = 0; w < 55 * WPY && g.state.status === 'playing'; w++) { b.step(g); g.tick(); }
    const first = (body: string) => Math.min(...allGens(g.state).filter((x) => x.body === body).map((x) => 1970 + Math.floor(x.launchWeek / WPY)));
    // 1.0.0: 공장 4등급 이상 건설비를 올려(유지비 대신 일회성 투자) 생산 라인이 늦게 늘어, 시드 1~6 측정 대형 SUV 2011~2016년·소형 SUV 2021~2023년. 2012/2020 → 2017/2025
    expect(first('suvL')).toBeLessThan(2017); expect(first('suvS')).toBeGreaterThanOrEqual(2010); expect(first('suvS')).toBeLessThan(2025);
  }, 120_000);
});
