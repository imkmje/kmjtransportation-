// 0.8.0 최고 이익 가격·자동 가격·세대 기획 값
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { basePriceOf, bestLaunchPrice, bestPrice, priceForecast, salesForecast, unitCost, costMultOf, ptCostAdd } from '../src/sim/queries';
import { currentEdition, updateRivals } from '../src/sim/market';
import { monthOf } from '../src/sim/time';
import { execReports } from '../src/sim/queries';
import type { ExecRole } from '../src/sim/types';
import { bodyById } from '../src/data';
import { config } from '../src/config';
import { devReady, launched, ok, toMonthEnd } from './util';

function hireExec(g: Game, role: ExecRole): void {
  g.state.cash = Math.max(g.state.cash, 1e6);
  ok(g.command({ type: 'postExecJob', role }));
  ok(g.command({ type: 'hireExec', role, candidateId: g.state.execs!.candidates.find((c) => c.role === role)!.id }));
  const x = g.state.execs!.seats[role]!.staff; x.ability = x.potential = 90;
}
const scanMax = (lo: number, hi: number, f: (p: number) => number) => { let best = -Infinity, at = 0; for (let p = lo; p <= hi; p += 10) { const v = f(p); if (v > best) { best = v; at = p; } } return { at, best }; };
const range = (body: string) => { const b = bodyById(body).basePrice; return [Math.ceil((b * config.price.min) / 10) * 10, Math.floor((b * config.price.max) / 10) * 10]; };

describe('최고 이익 가격(0.8.0)', () => {
  it('bestPrice = priceForecast로 가격 범위를 훑은 월 이익 최댓값', () => {
    const { g, gen } = launched(3); toMonthEnd(g); toMonthEnd(g);
    const s = g.state, e = currentEdition(gen), uc = unitCost(gen.body, gen.powertrain, e.tier, e.options, costMultOf(s), ptCostAdd(s, gen.powertrain)), mk = config.awareness.marketingCost[gen.marketing];
    const [lo, hi] = range(gen.body), m = scanMax(lo, hi, (p) => priceForecast(s, gen.id, p)! * (p - uc) - mk), b = bestPrice(s, gen.id)!;
    expect(b.price).toBe(m.at); expect(b.profit).toBeCloseTo(m.best, 6);
    expect(b.sales).toBe(priceForecast(s, gen.id, b.price)); expect(b.vsBase).toBeCloseTo(b.price / basePriceOf(s, gen.body), 9);
  });
  it('bestLaunchPrice는 salesForecast 가운데 값(생산 한도) 기준으로 훑은 최댓값이고, 그 판매는 예상 범위 안', () => {
    const { g, pid } = devReady(2), s = g.state, p = s.projects[0], uc = unitCost(p.body, p.powertrain, p.tier, p.options, costMultOf(s), ptCostAdd(s, p.powertrain)), mk = config.awareness.marketingCost[1];
    const b = bestLaunchPrice(s, pid, 1)!, f = salesForecast(s, pid, b.price, 1)!;
    expect(b.sales).toBeGreaterThanOrEqual(f.min); expect(b.sales).toBeLessThanOrEqual(f.max);
    expect(b.profit).toBeCloseTo(b.sales * (b.price - uc) - mk, 6);
    const [lo, hi] = range(p.body);
    expect(b.price).toBeGreaterThanOrEqual(lo); expect(b.price).toBeLessThanOrEqual(hi); expect(b.price % 10).toBe(0);
  });
});

describe('자동 가격(0.8.0)', () => {
  it('기준가 % 정책은 월 결산에서 가격을 맞춘다', () => {
    const { g, gen } = launched(4);
    ok(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'base', pct: 105 } }));
    toMonthEnd(g);
    expect(currentEdition(gen).price).toBe(Math.round((basePriceOf(g.state, gen.body) * 1.05) / 10) * 10);
    expect(gen.pricePolicy).toEqual({ kind: 'base', pct: 105 });
  });
  it('best 정책의 가격은 결산 직전(경쟁 차 갱신 뒤) bestPrice와 같다', () => {
    const { g, gen } = launched(5, 1700); toMonthEnd(g);
    ok(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'best' } }));
    for (let k = 0; k < 3; k++) {
      while (g.state.week % 4 !== 3) g.tick();
      const twin = JSON.parse(JSON.stringify(g.state)) as typeof g.state; // 결산 주 직전 상태에서 경쟁 차만 이번 달로 갱신
      updateRivals(twin.rivals, twin.seed, monthOf(twin.week));
      const want = bestPrice(twin, gen.id)!.price;
      g.tick();
      expect(currentEdition(gen).price).toBe(want);
    }
    expect(currentEdition(gen).price).not.toBe(1700);
  });
  it('수동 setPrice는 정책을 끄고, 잘못된 정책은 거절, 판매 중이 아니면 거절', () => {
    const { g, gen } = launched(6);
    expect(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'base', pct: 300 } }).ok).toBe(false);
    expect(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'base', pct: 100.5 } }).ok).toBe(false);
    expect(g.command({ type: 'setPricePolicy', generationId: 9999, policy: { kind: 'best' } }).ok).toBe(false);
    ok(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'best' } }));
    ok(g.command({ type: 'setPrice', generationId: gen.id, price: 1300 }));
    expect(gen.pricePolicy).toBeUndefined();
    toMonthEnd(g); expect(currentEdition(gen).price).toBe(1300);
  });
  it('저장 왕복과 명령 기록 재실행이 같은 결과(결정론)', () => {
    const run = () => { const { g, gen } = launched(7); ok(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'best' } })); for (let i = 0; i < 24; i++) g.tick(); return g; };
    const a = run(), b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(b.toJSON()).toEqual(a.toJSON());
    for (let i = 0; i < 24; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
    expect(JSON.stringify(run().toJSON())).toBe(JSON.stringify(run().toJSON()));
  });
  it('자동 가격을 켠 차에는 재무 임원의 가격 내리기 제안이 없다', () => {
    const kinds = (g: Game) => execReports(g.state).filter((r) => !r.auto).map((r) => r.kind);
    { const { g } = launched(1, 1700); hireExec(g, 'finance'); toMonthEnd(g); toMonthEnd(g); expect(kinds(g)).toContain('priceDown'); } // 대조군
    { const { g, gen } = launched(1, 1700); hireExec(g, 'finance'); ok(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'base', pct: 120 } })); toMonthEnd(g); toMonthEnd(g); expect(kinds(g)).not.toContain('priceDown'); expect(kinds(g)).not.toContain('priceUp'); }
  });
});

describe('옛 저장 열기(0.8.0)', () => {
  it('형식 4 저장(정책·기획 값 없음)을 열고 진행할 수 있다. 저장 형식은 4 그대로', () => {
    for (const f of ['save-v4.json', 'save-v4b.json']) {
      const g = Game.fromJSON(JSON.parse(readFileSync(`car/tests/fixtures/${f}`, 'utf8')));
      expect(g.state.saveVersion).toBe(6);
      for (let i = 0; i < 8; i++) g.tick();
      expect(g.toJSON().saveVersion).toBe(6);
    }
  });
  it('출시한 세대에 기획 값(방향·예산·설계 기간·쓸 수 있던 옵션)이 남는다', () => {
    const { gen } = launched(9);
    expect(gen.plan).toMatchObject({ direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.dev.designWeeks[1] });
    expect(Array.isArray(gen.plan!.opts)).toBe(true);
  });
});
