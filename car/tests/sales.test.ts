import { describe, it, expect } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { awarenessTarget, monthlyDemand, toSaleCar, updateRivals, type SaleCar } from '../src/sim/market';
import { grade, lifeFactor, standard } from '../src/sim/cars';
import { advice, expectedReviews, generationUnitProfit, lifeBar, salesForecast } from '../src/sim/queries';
import { criticScores } from '../src/sim/reviews';
import { monthOf, monthTime } from '../src/sim/time';
import { config } from '../src/config';
import { devReady, launched, ok, toMonthEnd } from './util';

const car = (over: Partial<SaleCar> = {}): SaleCar => ({ body: 'sedanS', segment: 'worker', stats: { P: 90, E: 90, U: 90, D: 90, Q: 90 }, price: 1200, awareness: 0.4, life: 1, ...over });

describe('판매 공식(7.3)', () => {
  const s = Game.create({ seed: 1 }).state;
  it('가격을 올리면 판매가 준다', () => {
    const d = [800, 1200, 1600, 2000].map((price) => monthlyDemand(s, car({ price }), [], 1970));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);
  });
  it('능력치 등급이 오르면 판매가 는다', () => {
    const lo = monthlyDemand(s, car(), [], 1970), hi = monthlyDemand(s, car({ stats: { P: 110, E: 110, U: 110, D: 110, Q: 110 } }), [], 1970);
    expect(hi).toBeGreaterThan(lo);
  });
  it('인지도·수명이 높을수록, 주 고객층과 궁합이 맞을수록 판매가 는다', () => {
    expect(monthlyDemand(s, car({ awareness: 0.6 }), [], 1970)).toBeGreaterThan(monthlyDemand(s, car(), [], 1970));
    expect(monthlyDemand(s, car({ life: 0.6 }), [], 1970)).toBeLessThan(monthlyDemand(s, car(), [], 1970));
    expect(monthlyDemand(s, car({ segment: 'worker' }), [], 1970)).toBeGreaterThan(monthlyDemand(s, car({ segment: 'rich' }), [], 1970));
  });
  it('같은 칸의 내 다른 차도 경쟁자다', () => {
    expect(monthlyDemand(s, car(), [car()], 1970)).toBeLessThan(monthlyDemand(s, car(), [], 1970));
  });
  it('기준 상승(5.1): 같은 원점수라도 해가 갈수록 표시 등급이 낮아진다', () => {
    expect(standard(1970)).toBe(100);
    expect(grade(100, 1970)).toBe(5);
    expect(grade(100, 1980)).toBeCloseTo(5 / 1.035 ** 10, 9);
    expect(grade(1000, 1970)).toBe(10); // 10에서 자른다
  });
  it('수명: 출시 0~3개월 0.6 → 1.0, 이후 매달 −1.2%', () => {
    expect(lifeFactor(0)).toBeCloseTo(0.6, 9);
    expect(lifeFactor(3)).toBe(1);
    expect(lifeFactor(15)).toBeCloseTo(0.988 ** 12, 9);
    for (let a = 4; a < 120; a++) expect(lifeFactor(a)).toBeLessThan(lifeFactor(a - 1));
  });
  it('공장 생산량 상한: 수요가 넘쳐도 월 300대까지만 판다', () => {
    const { g, gen } = launched(1);
    gen.awareness = 1; gen.editions[0].stats = { P: 300, E: 300, U: 300, D: 300, Q: 300 };
    toMonthEnd(g); toMonthEnd(g);
    expect(gen.lastDemand).toBeGreaterThan(config.factory.capacity);
    expect(gen.sales.at(-1)).toBe(config.factory.capacity);
    expect(advice(gen)).toContain('생산량을 넘습니다');
  });
  it('월말 정산: 매출 = 판매 × 가격, 원가 = 판매 × 대당 원가, 대당 이익 = 판매가 − 원가', () => {
    const { g, gen } = launched(2, 1300);
    toMonthEnd(g); toMonthEnd(g);
    const l = g.state.ledger.at(-1)!, n = gen.sales.at(-1)!;
    expect(l.sold).toBe(n); expect(l.revenue).toBe(n * 1300); expect(l.cogs).toBeCloseTo(n * 984 * 1.1, 6);
    expect(generationUnitProfit(gen)).toBeCloseTo(1300 - 984 * 1.1, 9);
    expect(l.marketing).toBe(config.awareness.marketingCost[1]);
  });
  it('수명 막대는 출시 직후 1, 시간이 지나면 줄어든다', () => {
    const { g, gen } = launched(3);
    g.state.cash = 1e9; // 파산으로 시계가 멈추지 않게
    expect(lifeBar(g.state, gen)).toBe(1);
    for (let i = 0; i < 48 * 3; i++) g.tick();
    const b3 = lifeBar(g.state, gen);
    for (let i = 0; i < 48 * 2; i++) g.tick();
    expect(b3).toBeLessThan(1); expect(lifeBar(g.state, gen)).toBeLessThan(b3);
  });
});

describe('출시와 평론(7.1~7.2)', () => {
  it('평론가 4명 점수(1~10), 평균, 세대·판·차종이 생기고 직원이 풀린다', () => {
    const { g, gen } = launched(4);
    expect(gen.reviews.length).toBe(4);
    for (const r of gen.reviews) { expect(r).toBeGreaterThanOrEqual(1); expect(r).toBeLessThanOrEqual(10); }
    expect(gen.number).toBe(1); expect(gen.editions[0].kind).toBe('initial');
    expect(g.state.nameplates[0].name).toBe('테스트카');
    expect(g.state.projects.length).toBe(0);
    expect(g.state.staff.every((s) => s.projectId === null)).toBe(true);
    expect(gen.devCost).toBeGreaterThan(0);
  });
  it('평론: 결함이 많으면 전원 −1, 가성비파는 싸게 팔수록 높다', () => {
    const st = { P: 100, E: 100, U: 100, D: 100, Q: 100 };
    const clean = criticScores(st, 1970, 1200, 1200, 0, () => 0), dirty = criticScores(st, 1970, 1200, 1200, 20, () => 0);
    for (let i = 0; i < 4; i++) expect(dirty[i]).toBeCloseTo(clean[i] - 1, 9);
    expect(criticScores(st, 1970, 1200, 900, 0, () => 0)[3]).toBeGreaterThan(clean[3]);
  });
  it('명차(평균 8 이상)는 평판 +4, 평균 4 이하는 평판 −3', () => {
    const a = devReady(1); a.g.state.projects[0].points = { P: 400, E: 400, U: 400, D: 400, Q: 400 };
    ok(a.g.command({ type: 'launch', projectId: a.pid, price: 1200, marketing: 0, color: 'red', wheels: 0 }));
    expect(allGens(a.g.state)[0].masterpiece).toBe(true); expect(a.g.state.reputation).toBe(14);
    const b = devReady(1); b.g.state.projects[0].points = { P: 0, E: 0, U: 0, D: 0, Q: 0 };
    ok(b.g.command({ type: 'launch', projectId: b.pid, price: 1200, marketing: 0, color: 'red', wheels: 0 }));
    expect(b.g.state.reputation).toBe(7);
  });
  it('출시 검증: 시험 2주 미만·가격 범위·마케팅·바퀴', () => {
    const { g, pid } = devReady(1, 1);
    const L = (x: object) => { const r = g.command({ type: 'launch', projectId: pid, price: 1200, marketing: 1, color: 'red', wheels: 0, ...x } as never); return r.ok ? '' : r.reason; };
    expect(L({})).toBe('시험을 최소 2주 해야 출시할 수 있습니다.');
    g.tick();
    expect(L({ price: 700 })).toContain('0.6~2배');
    expect(L({ price: 2500 })).toContain('기준가');
    expect(L({ marketing: 4 })).toContain('마케팅');
    expect(L({ wheels: 3 })).toContain('바퀴');
    expect(L({ price: 720 })).toBe('');
  });
  it('미리보기: 예상 평점 4개, 예상 월 판매 범위(최소 ≤ 최대 ≤ 300)', () => {
    const { g, pid } = devReady(1);
    const ex = expectedReviews(g.state, pid, 1200)!;
    expect(ex.scores.length).toBe(4);
    const f = salesForecast(g.state, pid, 1200, 1)!, f2 = salesForecast(g.state, pid, 1800, 1)!;
    expect(f.min).toBeLessThanOrEqual(f.max); expect(f.max).toBeLessThanOrEqual(300); expect(f.max).toBeGreaterThan(0);
    expect(f2.max).toBeLessThan(f.max);
  });
});

describe('리콜(6.3)', () => {
  it('출시 때 결함이 0이면 10년 동안 리콜이 없다', () => {
    for (const seed of [1, 2, 3]) {
      const { g, gen } = launched(seed, 1200, 1, 30);
      expect(gen.editions[0].defects).toBe(0);
      for (let i = 0; i < 480; i++) expect(g.tick().some((e) => e.kind === 'recall')).toBe(false);
      expect(gen.recalls).toBe(0);
    }
  });
  it('결함이 많으면 리콜: 판매 누계 × 15만원, 평판 −5, 인지도 −20%, 결함은 수리되어 0', () => {
    let recalled = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { g, gen } = launched(seed);
      gen.editions[0].defects = 20; // 연 40%
      for (let i = 0; i < 48 * 4 && !gen.recalls; i++) {
        const aw = gen.awareness, rep = g.state.reputation;
        const awNoRecall = aw + (awarenessTarget(rep, gen.marketing, grade(gen.editions[0].stats.Q, 1970 + Math.floor(g.state.week / 48))) - aw) * config.awareness.rate;
        const ev = g.tick();
        if (ev.some((e) => e.kind === 'recall')) {
          recalled++;
          const l = g.state.ledger.at(-1)!;
          expect(l.recall).toBe(gen.totalSold * 15);
          expect(g.state.reputation).toBe(Math.max(0, rep - 5));
          expect(gen.editions[0].defects).toBe(0);
          expect(gen.awareness).toBeCloseTo(awNoRecall * 0.8, 9);
        }
      }
    }
    expect(recalled).toBeGreaterThanOrEqual(3);
  });
});

describe('단종(8.6)과 생산 라인', () => {
  it('판매 중인 차가 있으면 새 차 출시는 거부(개발 시작은 허용)', () => {
    const { g } = launched(1);
    ok(g.command({ type: 'startProject', name: '둘째', body: 'sedanS', segment: 'youth', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'low', designWeeks: 8 }));
    for (let i = 0; i < 10; i++) g.tick();
    expect(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 0, color: 'red', wheels: 0 })).toEqual({ ok: false, reason: '생산 라인이 없습니다. 기존 차를 단종하세요. 공장을 증설하면 라인이 늘어납니다.' });
  });
  it('단종: 그 달 말까지 판매(마지막 달 ×0.5), 다음 달부터 라인이 비어 새 차를 낼 수 있다', () => {
    const { g, gen } = launched(1);
    ok(g.command({ type: 'startProject', name: '둘째', body: 'sedanS', segment: 'youth', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'low', designWeeks: 8 }));
    while (g.state.projects[0].testWeeks < 2 || g.state.week % 4 !== 1) g.tick();
    ok(g.command({ type: 'discontinue', generationId: gen.id }));
    expect(gen.status).toBe('ending'); expect(gen.endMonth).toBe(monthOf(g.state.week));
    expect(g.command({ type: 'discontinue', generationId: gen.id })).toEqual({ ok: false, reason: '판매 중인 차가 아닙니다.' });
    const launch = () => g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 0, color: 'red', wheels: 0 });
    expect(launch().ok).toBe(false); // 그 달에는 아직 라인을 쓰고 있다
    g.tick(); g.tick(); // 월말 직전
    const m = monthOf(g.state.week), st = structuredClone(g.state);
    updateRivals(st.rivals, st.seed, m); // 월말 정산은 경쟁 차를 먼저 갱신한다
    const expected = monthlyDemand(st, toSaleCar(gen, m), [], monthTime(m)) * 0.5;
    const ev = g.tick();
    expect(gen.sales.at(-1)).toBe(Math.round(Math.min(expected, 300)));
    expect(gen.status).toBe('discontinued');
    expect(ev.some((e) => e.kind === 'discontinued')).toBe(true);
    const sold = gen.totalSold;
    ok(launch());
    toMonthEnd(g);
    expect(gen.totalSold).toBe(sold); // 단종된 차는 더 팔리지 않는다
    expect(advice(gen)).toBe('단종된 차입니다.');
  });
  it('잘 팔리는 차(최근 3개월 평균 ≥ 정점의 70%)를 단종하면 평판 −2, 안 팔리는 차는 불이익 없음', () => {
    const a = launched(1);
    a.gen.sales = [50, 60, 55, 58]; const r0 = a.g.state.reputation;
    ok(a.g.command({ type: 'discontinue', generationId: a.gen.id }));
    expect(a.g.state.reputation).toBe(r0 - 2);
    const b = launched(1);
    b.gen.sales = [100, 40, 30, 20]; const r1 = b.g.state.reputation;
    ok(b.g.command({ type: 'discontinue', generationId: b.gen.id }));
    expect(b.g.state.reputation).toBe(r1);
  });
  it('조언: 월 10대 미만이 6개월이면 단종 권유, 정점의 60% 이하면 후속 준비', () => {
    const { gen } = launched(1);
    gen.sales = [50, 9, 8, 7, 6, 5, 4];
    expect(advice(gen)).toContain('단종을 권합니다');
    gen.sales = [100, 80, 55];
    expect(advice(gen)).toContain('정점의 55%');
  });
});

describe('출시 뒤 조정: setPrice / setMarketing', () => {
  it('가격 변경은 기준가 0.6~2.0배만, 다음 월말 정산부터 반영', () => {
    const { g, gen } = launched(1);
    g.state.cash = 1e9;
    toMonthEnd(g);
    expect(g.command({ type: 'setPrice', generationId: gen.id, price: 2500 }).ok).toBe(false);
    expect(g.command({ type: 'setPrice', generationId: gen.id, price: 700 })).toEqual({ ok: false, reason: '가격은 기준가(1,200만원)의 0.6~2배 사이여야 합니다.' });
    ok(g.command({ type: 'setPrice', generationId: gen.id, price: 1500 }));
    expect(g.state.ledger.at(-1)!.revenue).toBe(gen.sales.at(-1)! * 1200); // 지난 정산은 그대로
    toMonthEnd(g);
    expect(g.state.ledger.at(-1)!.revenue).toBe(gen.sales.at(-1)! * 1500);
  });
  it('마케팅 등급 변경: 0~3, 다음 정산의 비용과 목표 인지도에 반영', () => {
    const { g, gen } = launched(1);
    expect(g.command({ type: 'setMarketing', generationId: gen.id, marketing: 4 })).toEqual({ ok: false, reason: '마케팅 등급은 0~3 중에서 고르세요.' });
    ok(g.command({ type: 'setMarketing', generationId: gen.id, marketing: 3 }));
    toMonthEnd(g);
    expect(g.state.ledger.at(-1)!.marketing).toBe(config.awareness.marketingCost[3]);
  });
  it('판매 중이 아닌 차(단종 신청·없는 ID)는 조정할 수 없다', () => {
    const { g, gen } = launched(1);
    expect(g.command({ type: 'setPrice', generationId: 999, price: 1200 })).toEqual({ ok: false, reason: '판매 중인 차가 아닙니다.' });
    ok(g.command({ type: 'discontinue', generationId: gen.id }));
    expect(g.command({ type: 'setMarketing', generationId: gen.id, marketing: 0 }).ok).toBe(false);
  });
});
