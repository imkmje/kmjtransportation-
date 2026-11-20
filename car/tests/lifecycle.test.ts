// 차종의 일생(설계서 8장): 페이스리프트·풀체인지·차종 자산·기획 첫 화면·모양 후보·주간 기록·저장 형식 1 → 4
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, SAVE_VERSION } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { finalStats, grade, avgGrade } from '../src/sim/cars';
import { devCostPerWeek } from '../src/sim/dev';
import { carriedEquity, lookCandidates, nameplateEquity, planEntries } from '../src/sim/lifecycle';
import { cellMonthly, monthlyDemand, toSaleCar, updateRivals } from '../src/sim/market';
import { advice, faceliftPreview, fullChangePreview } from '../src/sim/queries';
import { Rng } from '../src/sim/rng';
import { monthOf, monthTime, yearOf } from '../src/sim/time';
import { STATS, type Generation, type ProjectSpec } from '../src/sim/types';
import { MARKET, bodyById } from '../src/data';
import { config } from '../src/config';
import { SPEC, grant, launched, ok, toMonthEnd } from './util';

const FL = config.lifecycle.facelift;
const FULL: Omit<ProjectSpec, 'name'> = { body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.dev.designWeeks[0] };
const LAUNCH = { price: 1200, marketing: 1, color: 'red', wheels: 0 as const };

/** 첫 차를 출시하고 세대 나이 months개월까지 진행(파산하지 않게 현금을 넉넉히) */
function aged(months: number, seed = 1): { g: Game; gen: Generation } {
  const { g, gen } = launched(seed);
  g.state.cash = 1e9;
  while (monthOf(g.state.week) - gen.launchMonth < months) g.tick();
  return { g, gen };
}
/** 개발 중인 첫 프로젝트를 시험 최소 주까지 */
function toTest(g: Game) { const p = g.state.projects[0]; while (p.phase === 'design' || p.testWeeks < config.dev.minTestWeeks) g.tick(); return p; }
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? '' : r.reason);

describe('페이스리프트(8.2)', () => {
  it('조건: 출시 18개월 뒤부터(이유와 남은 개월), 판매 중인 세대만', () => {
    const { g, gen } = aged(10);
    const r = g.command({ type: 'startFacelift', generationId: gen.id, options: [] });
    expect(reason(r)).toBe(`출시 후 18개월이 지나야 합니다. 앞으로 ${18 - (monthOf(g.state.week) - gen.launchMonth)}개월 남았습니다.`);
    while (monthOf(g.state.week) - gen.launchMonth < 18) g.tick();
    expect(g.command({ type: 'startFacelift', generationId: 999, options: [] })).toEqual({ ok: false, reason: '없는 세대입니다.' });
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    expect(g.state.projects[0].kind).toBe('facelift'); expect(g.state.projects[0].designWeeks).toBe(FL.designWeeks);
    const b = aged(18, 2);
    ok(b.g.command({ type: 'discontinue', generationId: b.gen.id }));
    expect(reason(b.g.command({ type: 'startFacelift', generationId: b.gen.id, options: [] }))).toContain('판매 중인 세대만');
  });
  it('세대당 1회, 진행 중이면 다시 못 함, 동력 단계는 낮출 수 없음', () => {
    const { g, gen } = aged(18);
    grant(g, 'el_radio');
    expect(reason(g.command({ type: 'startFacelift', generationId: gen.id, options: [], tier: 1 }))).toContain('낮출 수 없습니다');
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: ['radio'], tier: 3 }));
    expect(reason(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }))).toContain('이미 개발하고 있습니다');
    const p = toTest(g);
    ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    expect(gen.editions.map((e) => e.kind)).toEqual(['initial', 'facelift']);
    expect(gen.editions[1].tier).toBe(3); expect(gen.editions[1].options).toEqual(['radio']);
    expect(reason(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }))).toContain('이미 페이스리프트를 했습니다');
  });
  it('비용: 설계 주 + 최소 시험 주면 그 세대 개발비 × 비용 비율(config, 설계자 허용 25~40%)', () => {
    expect(FL.costShare).toBeGreaterThanOrEqual(0.25); expect(FL.costShare).toBeLessThanOrEqual(0.4);
    const { g, gen } = aged(20);
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    const p = toTest(g);
    expect(p.weeksDone).toBe(FL.designWeeks);
    expect(p.spent).toBeCloseTo(gen.devCost * FL.costShare, 6);
    expect(faceliftPreview(g.state, gen.id, { options: [] })!.cost).toBeCloseTo(gen.devCost * FL.costShare, 6);
  });
  it('디자이너 점수만 D에 추가되고 상한은 원래 D의 +dCap(config, 허용 8~15%), 결함은 남은 결함 × 0.5에서 시작해 1/3 속도로 쌓인다', () => {
    for (const ability of [1, 1000]) {
      const { g, gen } = aged(18);
      gen.editions[0].defects = 8;
      for (const x of g.state.staff) if (x.role === 'designer') x.ability = ability;
      ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
      const p = g.state.projects[0];
      expect(p.defects).toBe(4);
      for (let w = 0; w < 4; w++) {
        const d0 = p.defects, D0 = p.points.D;
        g.tick();
        expect(p.points.P + p.points.E + p.points.U + p.points.Q).toBe(0);
        expect(p.defects - d0).toBeCloseTo(((p.points.D - D0) / 12) / 3, 9);
      }
      toTest(g);
      const before = finalStats(gen.body, gen.powertrain, p.tier, p.options, gen.points, p.defects).D, origD = gen.editions[0].stats.D;
      ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
      const gain = gen.editions[1].stats.D - before;
      if (ability === 1) { expect(gain).toBeCloseTo(bodyById(gen.body).mult.D * p.points.D, 9); expect(gain).toBeLessThan(origD * FL.dCap); }
      else expect(gain).toBeCloseTo(origD * FL.dCap, 9);
    }
  });
  it('출시: 수명 나이를 lifeKeep로(세대 나이 60개월 이후면 lateLifeKeep), 인지도 +awareness, 평론 재평가 없음(기사 한 줄), 생산 라인을 새로 요구하지 않음', () => {
    for (const [months, keep] of [[24, FL.lifeKeep], [60, FL.lateLifeKeep]] as const) {
      const { g, gen } = aged(months);
      ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
      const p = toTest(g);
      const m = monthOf(g.state.week), age = m - gen.lifeMonth, aw = gen.awareness, rep = g.state.reputation, reviews = [...gen.reviews];
      expect(config.factory.lines).toBe(1);
      const r = g.command({ type: 'launch', projectId: p.id, ...LAUNCH });
      expect(r.ok).toBe(true);
      expect(m - gen.lifeMonth).toBeCloseTo(age * keep, 9);
      expect(gen.awareness).toBeCloseTo(Math.min(1, aw + FL.awareness), 9);
      expect(gen.reviews).toEqual(reviews); expect(g.state.reputation).toBe(rep);
      expect(r.ok && r.events?.[0].kind).toBe('news');
      expect(gen.editions[1].headline).toContain('페이스리프트');
      expect(allGens(g.state).length).toBe(1);
    }
  });
  it('전환 달 판매 −30%', () => {
    const { g, gen } = aged(20);
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    const p = toTest(g);
    while (g.state.week % 4 !== 0) g.tick(); // 달 첫 주에 출시
    ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    g.tick(); g.tick(); g.tick();
    const m = monthOf(g.state.week), st = structuredClone(g.state);
    updateRivals(st.rivals, st.seed, m);
    const expected = monthlyDemand(st, toSaleCar(gen, m), [], monthTime(m)) * FL.switchMonthMult;
    g.tick();
    expect(gen.sales.at(-1)).toBe(Math.round(Math.min(expected, config.factory.capacity)));
  });
});

describe('풀체인지(8.3)', () => {
  it('조건: 현 세대 출시 36개월 뒤이거나 단종 상태', () => {
    const { g, gen } = aged(20);
    const np = g.state.nameplates[0];
    expect(reason(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }))).toBe(`출시 후 36개월이 지나야 합니다. 앞으로 ${36 - (monthOf(g.state.week) - gen.launchMonth)}개월 남았습니다.`);
    expect(reason(g.command({ type: 'startFullChange', nameplateId: 999, ...FULL }))).toBe('없는 차종입니다.');
    ok(g.command({ type: 'discontinue', generationId: gen.id }));
    ok(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }));
    expect(reason(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }))).toContain('이미 개발하고 있습니다');
    const b = aged(36, 2);
    ok(b.g.command({ type: 'startFullChange', nameplateId: b.g.state.nameplates[0].id, ...FULL }));
  });
  it('비용: 같은 차체 85%, 차체를 바꾸면 100%', () => {
    for (const [body, mult] of [['sedanS', 0.85], ['hatch', 1]] as const) {
      const { g } = aged(48);
      while (yearOf(g.state.week) < 1974) g.tick();
      grant(g, 'bd_hatch');
      const team = g.state.staff.filter((x) => x.projectId === null);
      const spec = { ...FULL, body, segment: 'youth' };
      const pv = fullChangePreview(g.state, g.state.nameplates[0].id, spec)!;
      ok(g.command({ type: 'startFullChange', nameplateId: g.state.nameplates[0].id, ...spec }));
      const p = toTest(g);
      expect(p.spent).toBeCloseTo(devCostPerWeek(team, 'normal') * (FULL.designWeeks + config.dev.minTestWeeks) * mult, 6);
      expect(pv.cost).toBeCloseTo(p.spent, 6); expect(pv.costMult).toBe(mult);
    }
  });
  it('출시: 같은 생산 라인을 이어받고, 전 세대는 그 달 말 단종(다음 달부터 안 팔림), 세대 번호 자동 증가', () => {
    const { g, gen } = aged(36);
    const np = g.state.nameplates[0];
    ok(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }));
    const p = toTest(g);
    expect(config.factory.lines).toBe(1);
    ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    const m = monthOf(g.state.week), g2 = np.generations[1];
    expect(np.generations.length).toBe(2); expect(g2.number).toBe(2); expect(g.state.nameplates.length).toBe(1);
    expect(gen.status).toBe('ending'); expect(gen.endMonth).toBe(m);
    toMonthEnd(g);
    expect(gen.status).toBe('discontinued');
    const sold = gen.totalSold;
    toMonthEnd(g);
    expect(gen.totalSold).toBe(sold); expect(g2.sales.length).toBe(2);
    // 3세대
    while (monthOf(g.state.week) - g2.launchMonth < 36) g.tick();
    ok(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }));
    ok(g.command({ type: 'launch', projectId: toTest(g).id, ...LAUNCH }));
    expect(np.generations.map((x) => x.number)).toEqual([1, 2, 3]);
  });
  it('차종 자산 = clamp(0.03 × 평론 − 0.12, 0, 0.2) + min(0.1, 누적/50만), 리콜 −0.05, 항상 0~0.3', () => {
    const { g, gen } = aged(1);
    const id = g.state.nameplates[0].id;
    for (const review of [1, 3, 4, 5, 6.5, 8, 10]) for (const sold of [0, 1000, 49999, 200000, 2e6]) for (const recalls of [0, 1]) {
      gen.reviewAvg = review; gen.totalSold = sold; gen.recalls = recalls;
      const want = Math.min(0.3, Math.max(0, Math.min(0.2, Math.max(0, 0.03 * review - 0.12)) + Math.min(0.1, sold / 500000) - (recalls ? 0.05 : 0)));
      const e = nameplateEquity(g.state, id);
      expect(e).toBeCloseTo(want, 12); expect(e).toBeGreaterThanOrEqual(0); expect(e).toBeLessThanOrEqual(0.3);
    }
    gen.reviewAvg = 10; gen.totalSold = 1e6; gen.recalls = 0;
    expect(nameplateEquity(g.state, id)).toBeCloseTo(0.28, 12); // 평론 10점 0.18 + 판매 0.1
  });
  it('자산은 새 세대의 시작 인지도에 더해지고, 차체를 바꾸면 절반', () => {
    for (const body of ['sedanS', 'hatch']) {
      const { g, gen } = aged(36);
      while (yearOf(g.state.week) < 1974) g.tick();
      grant(g, 'bd_hatch');
      gen.reviewAvg = 7; gen.totalSold = 30000; gen.recalls = 0;
      const np = g.state.nameplates[0];
      ok(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL, body, segment: 'youth' }));
      const p = toTest(g);
      const base = nameplateEquity(g.state, np.id), c = carriedEquity(g.state, np.id, body);
      expect(c.equity).toBeCloseTo(body === 'sedanS' ? base : base / 2, 12); expect(c.bodyChanged).toBe(body !== 'sedanS');
      ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH, price: bodyById(body).basePrice }));
      expect(np.generations[1].equity).toBeCloseTo(c.equity, 12);
    }
  });
  it('전작 비교: 표시 등급 평균이 전 세대 출시 당시보다 낮으면 평론 전원 −1 "전작만 못하다", 높으면 +0.5 "진화했다"', () => {
    const { g, gen } = aged(36);
    const np = g.state.nameplates[0];
    ok(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }));
    const p = toTest(g), snap = g.toJSON();
    const run = (stat: number) => {
      const h = Game.fromJSON(snap), prev = h.state.nameplates[0].generations[0];
      prev.editions[0].stats = { P: stat, E: stat, U: stat, D: stat, Q: stat };
      const r = h.command({ type: 'launch', projectId: p.id, ...LAUNCH });
      return { r, g2: h.state.nameplates[0].generations[1] };
    };
    const worse = run(1000), better = run(1);
    expect(avgGrade(worse.g2.editions[0].stats, yearOf(g.state.week))).toBeGreaterThan(avgGrade({ P: 1, E: 1, U: 1, D: 1, Q: 1 }, yearOf(gen.launchWeek)));
    for (let i = 0; i < 4; i++) {
      const a = worse.g2.reviews[i], b = better.g2.reviews[i];
      if (a > 1 && b < 10) expect(b - a).toBeCloseTo(1.5, 9);
    }
    expect(worse.g2.editions[0].headline).toContain('전작만 못하다'); expect(better.g2.editions[0].headline).toContain('진화했다');
    expect(better.r.ok && better.r.events?.some((e) => e.text.includes('진화했다'))).toBe(true);
  });
  it('기존 고객 재구매: 전 세대 누적 판매 × 3%를 12개월에 나눠 추가 수요(전 세대 품질 등급 5 미만이면 0)', () => {
    const { g, gen } = aged(36);
    const np = g.state.nameplates[0];
    ok(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }));
    const p = toTest(g), snap = g.toJSON();
    const hi = Game.fromJSON(snap), lo = Game.fromJSON(snap);
    const q = (h: Game, Q: number) => { const e = h.state.nameplates[0].generations[0].editions[0]; e.stats = { ...e.stats, Q }; };
    q(hi, 1000); q(lo, 1);
    expect(grade(1000, yearOf(gen.launchWeek))).toBeGreaterThanOrEqual(5);
    ok(hi.command({ type: 'launch', projectId: p.id, ...LAUNCH })); ok(lo.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    const g2 = hi.state.nameplates[0].generations[1], sold = hi.state.nameplates[0].generations[0].totalSold;
    expect(g2.rebuy).toBeCloseTo((sold * 0.03) / 12, 9);
    expect(lo.state.nameplates[0].generations[1].rebuy).toBe(0);
    // 실제 수요에 더해진다: 재구매만 0으로 바꾼 복제본과 비교(출시 다음 달)
    const no = Game.fromJSON(hi.toJSON()); no.state.nameplates[0].generations[1].rebuy = 0;
    toMonthEnd(hi); toMonthEnd(no); toMonthEnd(hi); toMonthEnd(no);
    expect(g2.lastDemand - no.state.nameplates[0].generations[1].lastDemand).toBeCloseTo(g2.rebuy, 6);
  });
  it('단종 36개월 안이면 자산을 그대로, 넘으면 "부활"로 절반', () => {
    const { g, gen } = aged(20);
    gen.reviewAvg = 7; gen.totalSold = 30000;
    const np = g.state.nameplates[0];
    ok(g.command({ type: 'discontinue', generationId: gen.id }));
    toMonthEnd(g);
    const base = nameplateEquity(g.state, np.id);
    const m = monthOf(g.state.week);
    gen.endMonth = m - 36;
    expect(carriedEquity(g.state, np.id, 'sedanS')).toMatchObject({ revival: false });
    expect(carriedEquity(g.state, np.id, 'sedanS').equity).toBeCloseTo(base, 12);
    gen.endMonth = m - 37;
    expect(carriedEquity(g.state, np.id, 'sedanS').equity).toBeCloseTo(base / 2, 12);
    ok(g.command({ type: 'startFullChange', nameplateId: np.id, ...FULL }));
    const r = g.command({ type: 'launch', projectId: toTest(g).id, ...LAUNCH });
    expect(r.ok && r.events?.[0].text).toContain('부활');
    expect(np.generations[1].equity).toBeCloseTo(base / 2, 12);
  });
  it('리콜 이력이 있으면 자산 −0.05', () => {
    const { g, gen } = aged(1);
    gen.reviewAvg = 7; gen.totalSold = 30000; gen.recalls = 0;
    const a = nameplateEquity(g.state, g.state.nameplates[0].id);
    gen.recalls = 1;
    expect(nameplateEquity(g.state, g.state.nameplates[0].id)).toBeCloseTo(a - 0.05, 12);
  });
});

describe('기획 첫 화면(8.7)과 조언', () => {
  it('planEntries: 새 차종은 항상 가능, 차종별 가능 여부·이유·남은 개월', () => {
    expect(planEntries(Game.create({ difficulty: 'normal', seed: 1 }).state)).toEqual({ newModel: { ok: true, reason: null, monthsLeft: 0 }, blockedBy: null, nameplates: [] });
    const { g, gen } = aged(10);
    const left18 = 18 - (monthOf(g.state.week) - gen.launchMonth), left36 = left18 + 18;
    const e = planEntries(g.state).nameplates[0];
    expect(e).toMatchObject({ name: '테스트카', generation: 1, generationId: gen.id, status: 'onSale', reviewAvg: gen.reviewAvg, totalSold: gen.totalSold });
    expect(e.facelift).toEqual({ ok: false, reason: `출시 후 18개월이 지나야 합니다. 앞으로 ${left18}개월 남았습니다.`, monthsLeft: left18 });
    expect(e.fullChange).toEqual({ ok: false, reason: `출시 후 36개월이 지나야 합니다. 앞으로 ${left36}개월 남았습니다.`, monthsLeft: left36 });
    while (monthOf(g.state.week) - gen.launchMonth < 18) g.tick();
    expect(planEntries(g.state).nameplates[0].facelift).toEqual({ ok: true, reason: null, monthsLeft: 0 });
    ok(g.command({ type: 'discontinue', generationId: gen.id }));
    const d = planEntries(g.state).nameplates[0];
    expect(d.fullChange.ok).toBe(true); expect(d.facelift.reason).toContain('판매 중인 세대만');
  });
  it('조언: 판매가 정점의 60% 이하로 떨어지면 페이스리프트(18개월 뒤), 리프트 뒤에는 풀체인지(36개월 뒤)를 권한다', () => {
    const { g, gen } = aged(20);
    gen.sales = [...gen.sales.map(() => 100), 50];
    expect(advice(gen, g.state)).toBe('판매가 정점의 50%로 떨어졌습니다. 페이스리프트를 고려하세요.');
    gen.editions.push({ ...gen.editions[0], kind: 'facelift' });
    expect(advice(gen, g.state)).toContain('후속 모델을 준비하세요');
    while (monthOf(g.state.week) - gen.launchMonth < 36) g.tick();
    gen.sales = [...gen.sales.map(() => 100), 50];
    expect(advice(gen, g.state)).toBe('판매가 정점의 50%로 떨어졌습니다. 풀체인지를 고려하세요.');
  });
  it('8.6: 판매가 월 10대 미만으로 6개월째가 된 달에 한 번 "단종을 권합니다" 소식', () => {
    const { g, gen } = aged(2);
    gen.sales = [50, 1, 1, 1, 1, 1];
    let fired = 0;
    for (let i = 0; i < 3; i++) {
      gen.awareness = 0; // 이번 달 판매 0
      do { const ev = g.tick(); fired += ev.filter((e) => e.kind === 'advice' && e.text.includes('단종을 권합니다')).length; } while (g.state.week % 4 !== 0);
    }
    expect(fired).toBe(1);
  });
});

describe('3D 모양 시드(8.5)', () => {
  it('lookCandidates: 같은 입력 = 같은 후보 3개, 게임 난수를 소비하지 않는다, 종류·차종·세대마다 다르다', () => {
    const { g, gen } = aged(18);
    const id = g.state.nameplates[0].id, rng = g.state.rng;
    const a = lookCandidates(g.state, id, 'face'), b = lookCandidates(g.state, id, 'face');
    expect(a).toEqual(b); expect(a.length).toBe(3); expect(new Set(a).size).toBe(3);
    for (const x of a) expect(Number.isInteger(x) && x >= 0 && x <= 0xffffffff).toBe(true);
    expect(g.state.rng).toBe(rng);
    expect(lookCandidates(g.state, id, 'chassis')).not.toEqual(a);
    expect(lookCandidates(g.state, id, 'face', 'nextGen')).not.toEqual(a);
    expect(lookCandidates(g.state, 0, 'face')).not.toEqual(a);
    expect(lookCandidates(Game.create({ difficulty: 'normal', seed: 2 }).state, 0, 'face')).not.toEqual(lookCandidates(Game.create({ difficulty: 'normal', seed: 1 }).state, 0, 'face'));
    // 페이스리프트: 시드를 빼면 첫 후보, 판에 저장되고 차대 시드는 그대로
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    expect(g.state.projects[0].faceSeed).toBe(a[0]);
    ok(g.command({ type: 'launch', projectId: toTest(g).id, ...LAUNCH }));
    expect(gen.editions[1].faceSeed).toBe(a[0]); expect(g.state.projects.length).toBe(0);
  });
  it('신차: 시드를 주면 세대·판에 그대로, 빼면 첫 후보, 잘못된 시드는 거부', () => {
    const g = Game.create({ difficulty: 'normal', seed: 3 });
    expect(reason(g.command({ type: 'startProject', ...SPEC, faceSeed: -1 }))).toBe('모양 시드가 올바르지 않습니다.');
    expect(reason(g.command({ type: 'startProject', ...SPEC, chassisSeed: 1.5 }))).toBe('모양 시드가 올바르지 않습니다.');
    const c = lookCandidates(g.state, 0, 'chassis'), f = lookCandidates(g.state, 0, 'face');
    ok(g.command({ type: 'startProject', ...SPEC }));
    expect(g.state.projects[0]).toMatchObject({ kind: 'new', targetId: null, chassisSeed: c[0], faceSeed: f[0] });
    const h = Game.create({ difficulty: 'normal', seed: 3 });
    ok(h.command({ type: 'startProject', ...SPEC, chassisSeed: 77, faceSeed: 88 }));
    ok(h.command({ type: 'launch', projectId: toTest(h).id, ...LAUNCH }));
    const gen = allGens(h.state)[0];
    expect(gen.chassisSeed).toBe(77); expect(gen.editions[0].faceSeed).toBe(88);
  });
});

describe('주간 개발 기록 이벤트(devWeek)', () => {
  it('직원별 점수 합 = 실제 점수 증가, 결함 증감도 일치, 시험 주는 점수 0', () => {
    const g = Game.create({ difficulty: 'normal', seed: 4 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const p = g.state.projects[0];
    for (let w = 0; w < SPEC.designWeeks + 4; w++) {
      const pts = { ...p.points }, d0 = p.defects;
      const e = g.tick().find((x) => x.kind === 'devWeek');
      if (!e || e.kind !== 'devWeek') throw new Error('devWeek 없음');
      expect(e.projectId).toBe(p.id);
      expect(e.staff.map((x) => x.id)).toEqual(g.state.staff.filter((x) => x.projectId === p.id).map((x) => x.id));
      for (const k of STATS) expect(e.staff.reduce((a, x) => a + x.stats[k], 0)).toBeCloseTo(p.points[k] - pts[k], 9);
      expect(e.defectsAdded - e.defectsRemoved).toBeCloseTo(p.defects - d0, 9);
      if (w >= SPEC.designWeeks) expect(e.staff.every((x) => STATS.every((k) => x.stats[k] === 0))).toBe(true);
    }
  });
  it('난수 호출 순서는 1단계와 같다(설계 주: 직원마다 1번 + 결함 추정 1번, 시험 주: 결함 추정 1번)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 6 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const r = new Rng(0); r.setState(g.state.rng);
    for (let w = 0; w < SPEC.designWeeks + 2; w++) {
      g.tick();
      const n = w < SPEC.designWeeks ? g.state.staff.length + 1 : 1;
      for (let i = 0; i < n; i++) r.next();
      expect(g.state.rng).toBe(r.getState());
    }
  });
});

describe('직원 경험(9.1)과 경쟁 차 교체(8.4)', () => {
  it('출시로 프로젝트를 마치면 참여 직원 능력 +1~2(잠재력 상한)', () => {
    const { g, gen } = aged(18);
    const before = g.state.staff.map((x) => x.ability);
    g.state.staff[0].ability = 59; g.state.staff[0].potential = 60;
    for (const x of g.state.staff.slice(1)) x.potential = 100;
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    ok(g.command({ type: 'launch', projectId: toTest(g).id, ...LAUNCH }));
    g.state.staff.forEach((x, i) => {
      if (i === 0) expect(x.ability).toBe(60);
      else { expect(x.ability - before[i]).toBeGreaterThanOrEqual(1); expect(x.ability - before[i]).toBeLessThanOrEqual(2); }
    });
  });
  it('경쟁 차는 낡았다가 4~7년 주기로 새 모델이 되고, 게임 난수를 소비하지 않는다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 8 }), rng = g.state.rng, start = structuredClone(g.state.rivals);
    g.state.cash = 1e9; // 파산으로 멈추지 않게
    for (let i = 0; i < 48 * 10; i++) g.tick();
    expect(g.state.rng).toBe(rng);
    for (const r of g.state.rivals) for (const body of Object.keys(r.models)) {
      expect(r.models[body].n).toBeGreaterThanOrEqual(1);
      expect(r.models[body].cycle).toBeGreaterThanOrEqual(48); expect(r.models[body].cycle).toBeLessThanOrEqual(84);
      expect(r.cells[body]).toBeLessThanOrEqual(r.models[body].base * 1.15 + 1e-12);
    }
    expect(g.state.rivals).not.toEqual(start);
    const h = Game.create({ difficulty: 'normal', seed: 8 });
    h.state.cash = 1e9;
    for (let i = 0; i < 48 * 10; i++) h.tick();
    expect(h.state.rivals).toEqual(g.state.rivals);
  });
});

describe('시장 규모(7.3, 7.5): 달마다 매끄럽게, 연도 사이는 비율 보간', () => {
  it('연초에도 전달 대비 +15% 이내, 기준점(1970·1990·2020)은 3단계와 같은 연 규모', () => {
    const bodies = Object.keys(MARKET.domestic.bodyShare);
    const total = (m: number) => bodies.reduce((a, b) => a + cellMonthly(b, monthTime(m)), 0);
    for (let m = 1; m < 12 * 60; m++) {
      expect(total(m) / total(m - 1)).toBeLessThan(1.15);
      for (const b of ['sedanS', 'hatch', 'sedanM']) expect(cellMonthly(b, monthTime(m)) / cellMonthly(b, monthTime(m - 1))).toBeLessThan(1.15);
    }
    const annual = (y: number) => (total((y - 1970) * 12) * 12) / config.market.scale; // 칸 비중의 합이 1이므로 모든 칸의 합 = 연 규모
    expect(annual(1970)).toBeCloseTo(20000, 6); expect(annual(1990)).toBeCloseTo(1e6, 3); expect(annual(2020)).toBeCloseTo(1.8e6, 3);
    expect(annual(1980)).toBeCloseTo(20000 * Math.sqrt(50), 0); // 비율 보간: 1970과 1990의 기하 평균
  });
});

describe('저장 형식 1 → 4', () => {
  it(`SAVE_VERSION = 4, 형식 1 파일을 올려서 불러오고 이어서 실행할 수 있다`, () => {
    expect(SAVE_VERSION).toBe(4);
    const v1 = JSON.parse(readFileSync('car/tests/fixtures/save-v1.json', 'utf8'));
    expect(v1.saveVersion).toBe(1);
    const g = Game.fromJSON(v1), s = g.state;
    expect(s.saveVersion).toBe(4);
    expect(s.hqLevel).toBe(1); expect(s.factory).toEqual({ level: 1, build: null });
    for (const x of s.staff) expect(x.potential).toBe(Math.max(60, x.ability));
    const gen = allGens(s)[0], ed = gen.editions[0];
    expect(gen.lifeMonth).toBe(gen.launchMonth); expect(gen.equity).toBe(0); expect(gen.rebuy).toBe(0);
    expect(Number.isInteger(gen.chassisSeed)).toBe(true); expect(Number.isInteger(ed.faceSeed)).toBe(true); expect(ed.headline).toBeNull();
    const back = finalStats(gen.body, gen.powertrain, ed.tier, ed.options, gen.points, ed.defects); // 원점수를 거꾸로 계산한 값으로 출시 능력치가 다시 나온다
    for (const k of STATS) expect(back[k]).toBeCloseTo(ed.stats[k], 6);
    expect(s.projects[0]).toMatchObject({ kind: 'new', targetId: null });
    for (const r of s.rivals) expect(Object.keys(r.models).sort()).toEqual(Object.keys(r.cells).sort());
    // 이어서 3년: 페이스리프트·풀체인지까지 가는 봇으로
    const bot = steady();
    s.cash = Math.max(s.cash, 1e6);
    for (let i = 0; i < 48 * 3 && s.status === 'playing'; i++) { bot.step(g); g.tick(); }
    expect(s.status).toBe('playing');
    expect(allGens(s).length).toBeGreaterThanOrEqual(1);
    // 올린 상태도 저장 왕복 = 끊지 않은 실행
    const a = Game.fromJSON(v1), b = Game.fromJSON(JSON.parse(JSON.stringify(Game.fromJSON(v1).toJSON())));
    for (let i = 0; i < 48 * 2; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
});
