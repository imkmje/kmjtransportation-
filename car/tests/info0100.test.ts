// 0.10.0 정보와 수습 수단: 차종별 손익, 판매 요인, 직원 성장 기록, 10년 회고, 긴급 개선·가격 인하 판매
import { describe, it, expect, vi } from 'vitest';
import { config } from '../src/config';
import { Game, allGens } from '../src/sim/game';
import { clearError, decadeReview, decadeYears, fixError, modelPnL, nameplatePnL, priceForecast, rescueOptions, salesFactors, staffBrief, staffHistory, basePriceOf } from '../src/sim/queries';
import { currentEdition, monthlyDemand, rivalBase, toSaleCar } from '../src/sim/market';
import { standard } from '../src/sim/cars';
import { sellingGens } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { monthOf, monthTime } from '../src/sim/time';
import { launched, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 60_000 });
const months = (g: Game, n: number) => { for (let i = 0; i < n; i++) toMonthEnd(g); };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('차종별 손익(0.10.0)', () => {
  it('월별 이익의 합 = 누적 이익, 매출 − 원가 − 광고비 − 리콜비 = 누적 이익, 개발비 = 세대 개발비', () => {
    const { g, gen } = launched(3); months(g, 24);
    const p = modelPnL(g.state, gen.id)!;
    expect(p.monthly.length).toBe(gen.sales.length);
    expect(sum(p.monthly)).toBeCloseTo(gen.profit, 4);
    expect(p.revenue - p.cogs - p.marketing - p.recall).toBeCloseTo(gen.profit, 4);
    expect(p.devTotal).toBeCloseTo(gen.devCost, 6); expect(p.estimated).toBe(false);
    let cum = 0; const at = p.monthly.findIndex((v) => (cum += v) >= p.devTotal);
    expect(p.paybackMonths).toBe(at < 0 ? null : at + 1);
    expect(p.recovered).toBe(gen.profit >= p.devTotal);
    const np = nameplatePnL(g.state, g.state.nameplates[0].id)!;
    expect(np.profit).toBeCloseTo(gen.profit, 6); expect(np.gens.length).toBe(1);
  });
  it('예전 저장(손익 기록 없음): 판매 기록으로 추정하고 "일부 추정"을 표시, 다음 결산부터 이어 쌓는다', () => {
    const { g, gen } = launched(3); months(g, 6);
    const save = g.toJSON(); delete save.nameplates[0].generations[0].pnl;
    const g2 = Game.fromJSON(save), gen2 = allGens(g2.state)[0];
    const p = modelPnL(g2.state, gen2.id)!;
    expect(p.estimated).toBe(true); expect(sum(p.monthly)).toBeCloseTo(gen2.profit, 4);
    toMonthEnd(g2);
    expect(gen2.pnl!.est).toBe(true); expect(gen2.pnl!.months.length).toBe(gen2.sales.length);
    expect(sum(gen2.pnl!.months)).toBeCloseTo(gen2.profit, 4);
    void gen;
  });
  it('페이스리프트 전후 비교: 같은 개월 수의 이익과 리프트 비용', () => {
    const { g, gen } = launched(5); months(g, 20);
    g.state.cash = 1e7;
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    while (g.state.projects.length && !(g.state.projects[0].phase === 'test' && g.state.projects[0].testWeeks >= 2)) g.tick();
    ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: currentEdition(gen).price, marketing: 1, color: 'red', wheels: 0 }));
    months(g, 14);
    const p = modelPnL(g.state, gen.id)!, f = p.facelift!;
    expect(p.dev.lift).toBeGreaterThan(0); expect(p.devTotal).toBeCloseTo(gen.devCost, 6);
    expect(f.months).toBe(12); expect(f.gain).toBeCloseTo(f.after - f.before - f.cost, 6);
    expect(f.text).toMatch(/이득|손해/);
  });
});

describe('판매 요인(0.10.0)', () => {
  it('요인을 모두 기준 상태로 돌린 수요 = base, 가격 요인만 바꾼 값 = priceForecast(시장 기준가)', () => {
    const { g, gen } = launched(2, 1300); months(g, 8);
    const s = g.state, f = salesFactors(s, gen.id)!, m = monthOf(s.week);
    const others = sellingGens(s).filter((x) => x.id !== gen.id && x.status === 'onSale').map((x) => toSaleCar(x, m));
    expect(f.demand).toBeCloseTo(monthlyDemand(s, toSaleCar(gen, m), others, monthTime(m)), 9);
    const price = f.factors.find((x) => x.key === 'price')!;
    expect(Math.round(Math.min(f.capacity, price.cf))).toBe(priceForecast(s, gen.id, basePriceOf(s, gen.body)));
    expect(price.impact).toBeLessThan(0); // 기준가보다 비싸다
    // 모든 요인을 기준 상태로 직접 만든 차(기준가, 기준 인지도, 수명 1, 표시 등급 5, 궁합 1, 경쟁 차 기본 A, 같은 칸 우리 차 없음, 사건 없음)의 수요 = base
    const std = standard(Math.floor(monthTime(m))), stats = { P: std, E: std, U: std, D: std, Q: std };
    const base = monthlyDemand(s, { ...toSaleCar(gen, m), price: basePriceOf(s, gen.body), awareness: config.factors.awareness, life: 1, stats }, others, monthTime(m), { compatSeg: gen.segment, rivalA: rivalBase(m), noOthers: true, noEra: true });
    expect(f.base).toBeCloseTo(base, 9);
    expect(f.factors.every((x) => Number.isFinite(x.impact) && x.fix !== undefined)).toBe(true);
  });
  it('이미 기준 상태인 요인은 0%: 기준가로 판 차의 가격 요인, 수명 1인 차의 수명 요인', () => {
    const { g, gen } = launched(2); months(g, 8);
    ok(g.command({ type: 'setPrice', generationId: gen.id, price: Math.round(basePriceOf(g.state, gen.body)) }));
    currentEdition(gen).price = basePriceOf(g.state, gen.body); // 10만원 단위가 아닌 값까지 정확히
    const f = salesFactors(g.state, gen.id)!;
    expect(f.factors.find((x) => x.key === 'price')!.impact).toBeCloseTo(0, 9);
    expect(f.factors.find((x) => x.key === 'life')!.impact).toBeCloseTo(0, 9); // 출시 8개월: 수명 1
  });
  it('부진하면 요약 한 줄에 깎는 요인을 큰 것부터', () => {
    const { g, gen } = launched(2, 1500); months(g, 4);
    gen.sales.push(gen.sales.at(-1)! * 3); // 전달이 지난달보다 훨씬 많았던 것으로
    gen.sales.push(1);
    const f = salesFactors(g.state, gen.id)!;
    expect(f.summary).toContain('판매가 부진합니다'); expect(f.summary).toContain('가격');
  });
});

describe('직원 성장 기록(0.10.0)', () => {
  it('입사 연월·능력, 해마다 능력, 참여한 차, 임원 경력', () => {
    const { g, gen } = launched(4); months(g, 14);
    const x = g.state.staff[0], h = staffHistory(g.state, x.id)!;
    expect(h.join).toBe(0); expect(h.joinAbility).toBeGreaterThan(0);
    expect(h.cars.map((c) => c.gen)).toContain(gen.id);
    expect(h.points.some((p) => p.year === 1970)).toBe(true);
    expect(staffBrief(g.state, x)).toMatch(/^입사 \d+년, 참여한 차 1대$/);
    g.state.cash = 1e7;
    ok(g.command({ type: 'appointExec', role: 'hr', staffId: x.id }));
    expect(staffHistory(g.state, x.id)!.execs[0]).toMatchObject({ role: 'hr', to: null });
    ok(g.command({ type: 'dismissExec', role: 'hr' }));
    expect(staffHistory(g.state, x.id)!.execs[0].to).toBe(g.state.week);
  });
  it('예전 저장(기록 없음)은 다음 결산부터 쌓는다', () => {
    const { g } = launched(4); const save = g.toJSON();
    for (const x of save.staff) delete x.hist;
    const g2 = Game.fromJSON(save); toMonthEnd(g2);
    const h = staffHistory(g2.state, g2.state.staff[0].id)!;
    expect(h.join).toBeNull(); expect(h.since).toBeGreaterThan(0); expect(staffBrief(g2.state, g2.state.staff[0])).toContain('년부터 기록');
  });
});

describe('10년 회고(0.10.0)', () => {
  it('1970년대: 판매는 차 기록의 합, 사건 3개 이하, 다음 10년 예고, 순위', () => {
    const g = Game.create({ difficulty: 'normal', seed: 3 }), b = steady();
    while (g.state.week < 10 * 48 + 4) { b.step(g); g.tick(); }
    expect(decadeYears(g.state)).toEqual([1970]);
    const r = decadeReview(g.state, 1970), want = sum(allGens(g.state).flatMap((x) => x.sales.filter((_, i) => x.launchMonth + i < 120)));
    expect(r.done).toBe(true); expect(r.sold).toBe(want);
    expect(r.events.length).toBeGreaterThan(0); expect(r.events.length).toBeLessThanOrEqual(3);
    expect(r.next.length).toBeGreaterThan(0); expect(r.rank).toBeGreaterThanOrEqual(1); expect(r.rank).toBeLessThanOrEqual(g.state.rivals.length + 1);
    expect(r.profit).not.toBeNull(); expect(r.headline).toContain('1970년대');
  });
});

describe('실패한 차의 수습(0.10.0)', () => {
  it('긴급 개선: 대상이 아니면 거부, 혹평 차는 8주 뒤 결함·품질 개선(평론·인지도·수명 그대로), 세대당 1회, 진행 중 페이스리프트 불가', () => {
    const { g, gen } = launched(6); months(g, 2);
    gen.reviewAvg = 6; gen.sales = gen.sales.map(() => 300); // 호평에 잘 팔리는 차는 대상이 아니다
    expect(fixError(g.state, gen.id)).toContain('할 수 있습니다');
    gen.reviewAvg = 3.4; currentEdition(gen).defects = 20;
    const before = { ...currentEdition(gen).stats }, rev = [...gen.reviews], life = gen.lifeMonth;
    const ro = rescueOptions(g.state, gen.id)!;
    expect(ro.target).toBeNull(); expect(ro.fix.ok).toBe(true); expect(ro.fix.recallAfter).toBeLessThan(ro.fix.recallNow);
    ok(g.command({ type: 'quickFix', generationId: gen.id }));
    expect(g.state.projects[0].kind).toBe('fix');
    expect(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }).ok).toBe(false);
    expect(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }).ok).toBe(false);
    const cash0 = g.state.cash;
    for (let i = 0; i < config.rescue.fixWeeks; i++) g.tick();
    expect(g.state.projects.length).toBe(0); expect(gen.fixed).toBeDefined();
    expect(currentEdition(gen).defects).toBeLessThan(20); expect(currentEdition(gen).stats.Q).toBeGreaterThan(before.Q);
    expect(currentEdition(gen).stats.P).toBe(before.P); expect(gen.reviews).toEqual(rev); expect(gen.lifeMonth).toBe(life);
    expect(gen.pnl!.dev.fix).toBeGreaterThan(0); expect(modelPnL(g.state, gen.id)!.dev.fix).toBe(gen.fixed!.cost);
    expect(gen.fixed!.cost).toBeGreaterThanOrEqual(gen.devCost * config.rescue.costShare - 1e-6);
    expect(cash0).toBeGreaterThan(g.state.cash - 1e9);
    expect(fixError(g.state, gen.id)).toContain('세대당 1회');
    expect(staffHistory(g.state, g.state.staff.find((x) => x.role === 'tester')!.id)!.cars.some((c) => c.kind === 'fix')).toBe(true);
  });
  it('긴급 개선 비용은 같은 팀이 같은 주 수만큼 시험하는 비용 이상(대충 내고 고치는 전략 방지)', () => {
    const { g, gen } = launched(6); gen.reviewAvg = 3; const ro = rescueOptions(g.state, gen.id)!;
    const team = g.state.staff.filter((x) => ro.fix.team.includes(x.id)), week = (team.reduce((a, x) => a + 250 + x.ability * 12, 0) / 4) * config.dev.staffCostShare + config.dev.prototypePerWeek;
    expect(ro.fix.cost).toBeGreaterThanOrEqual(week * config.rescue.fixWeeks - 1e-6);
  });
  it('가격 인하 판매: 기준가의 88%로 고정, 가격 바꾸기 불가, 6개월 판매 뒤 자동 단종, 평판 감점 없음', () => {
    const { g, gen } = launched(7); months(g, 3);
    gen.reviewAvg = 6;
    expect(clearError(g.state, gen.id)).toContain('할 수 없습니다');
    gen.reviewAvg = 3;
    const aw = gen.awareness, rep = g.state.reputation;
    ok(g.command({ type: 'clearance', generationId: gen.id }));
    expect(currentEdition(gen).price).toBe(Math.round((basePriceOf(g.state, gen.body) * config.rescue.clearPct) / 10) * 10);
    expect(gen.awareness).toBeCloseTo(aw + config.rescue.clearAwareness, 9);
    expect(g.command({ type: 'setPrice', generationId: gen.id, price: 1200 }).ok).toBe(false);
    expect(g.command({ type: 'setPricePolicy', generationId: gen.id, policy: { kind: 'best' } }).ok).toBe(false);
    const n0 = gen.sales.length;
    months(g, config.rescue.clearMonths - 1);
    expect(gen.status).toBe('onSale');
    toMonthEnd(g);
    expect(gen.status).toBe('discontinued'); expect(gen.sales.length - n0).toBe(config.rescue.clearMonths);
    expect(g.state.reputation).toBeGreaterThanOrEqual(rep - 1e-9 - 0); // 단종 감점(−2)이 없다(연말 가산만 있을 수 있음)
  });
  it('저장 왕복: 새 필드가 그대로', () => {
    const { g, gen } = launched(6); gen.reviewAvg = 3; ok(g.command({ type: 'quickFix', generationId: gen.id })); g.tick();
    const g2 = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(g2.state).toEqual(g.state);
    for (let i = 0; i < 12; i++) { g.tick(); g2.tick(); }
    expect(g2.state).toEqual(g.state);
  });
});
