import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { defectAdvice, planPreview, projectPreview } from '../src/sim/queries';
import { finalStats, zeroStats, partStats, unitCost } from '../src/sim/cars';
import { weeklyDevCost } from '../src/sim/dev';
import { config } from '../src/config';
import { SPEC, devReady, grant, ok } from './util';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('보정 목표(6.2): 1970년·초기 직원·보통 예산·12주·균등·표준 동력', () => {
  it('출시 시점(시험으로 결함이 약 5개 이하) 5개 능력치 표시 등급 평균이 4.0~5.0', () => {
    const avgs = SEEDS.map((seed) => {
      const g = Game.create({ difficulty: 'normal', seed });
      ok(g.command({ type: 'startProject', ...SPEC }));
      while (g.state.projects[0].phase === 'design' || g.state.projects[0].testWeeks < 2 || g.state.projects[0].defectEst > 5) g.tick();
      return projectPreview(g.state, g.state.projects[0].id)!.avg;
    }).sort((a, b) => a - b);
    console.log('보정 등급 평균(시드 20개):', avgs.map((x) => x.toFixed(2)).join(' '));
    const median = (avgs[9] + avgs[10]) / 2;
    expect(median).toBeGreaterThanOrEqual(4); expect(median).toBeLessThanOrEqual(5);
    expect(avgs.filter((x) => x >= 4 && x <= 5).length).toBeGreaterThanOrEqual(18); // 능력 25~35·주간 난수 때문에 한두 개는 벗어날 수 있다
    expect(avgs[0]).toBeGreaterThan(3.5); expect(avgs[19]).toBeLessThan(5.5);
  });
});

describe('개발(6장)', () => {
  it('설계 기간이 끝나면 시험으로 넘어가고 알림이 뜬다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    ok(g.command({ type: 'startProject', ...SPEC, designWeeks: 8 }));
    for (let i = 0; i < 7; i++) expect(g.tick().some((e) => e.kind === 'designDone')).toBe(false);
    expect(g.tick().some((e) => e.kind === 'designDone')).toBe(true);
    expect(g.state.projects[0].phase).toBe('test');
  });
  it('설계 중 결함은 매주 그 주 점수/12만큼 늘고, 시험 중에는 꼼꼼함/10 + 기술/30만큼 줄어든다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 3 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const p = g.state.projects[0];
    const sum = (s: typeof p.points) => s.P + s.E + s.U + s.D + s.Q;
    for (let i = 0; i < 12; i++) {
      const d0 = p.defects, pts0 = sum(p.points);
      g.tick();
      expect(p.defects - d0).toBeCloseTo((sum(p.points) - pts0) / 12, 9);
      expect(p.defects).toBeGreaterThan(d0);
    }
    const cut = g.state.staff.reduce((a, s) => a + (s.role === 'tester' ? s.ability / 10 : s.role === 'engineer' ? s.ability / 30 : 0), 0);
    const d0 = p.defects;
    g.tick();
    expect(d0 - p.defects).toBeCloseTo(Math.min(d0, cut), 9);
    for (let i = 0; i < 40; i++) g.tick();
    expect(p.defects).toBe(0); // 0 아래로는 내려가지 않는다
  });
  it('화면용 결함 수는 실제의 ±15% 안(반올림)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 5 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const p = g.state.projects[0];
    let differs = 0;
    for (let i = 0; i < 16; i++) {
      g.tick();
      expect(Math.abs(p.defectEst - p.defects)).toBeLessThanOrEqual(p.defects * 0.15 + 0.5);
      if (Math.round(p.defects) !== p.defectEst) differs++;
    }
    expect(differs).toBeGreaterThan(0); // 실제로 오차가 섞인다
  });
  it('남은 결함 1개당 품질 −1%, 최대 −40%', () => {
    const pts = zeroStats();
    const q0 = finalStats('sedanS', 'gasoline', 2, [], pts, 0).Q;
    pts.Q = 100;
    const clean = finalStats('sedanS', 'gasoline', 2, [], pts, 0).Q;
    expect(finalStats('sedanS', 'gasoline', 2, [], pts, 10).Q).toBeCloseTo(clean * 0.9, 9);
    expect(finalStats('sedanS', 'gasoline', 2, [], pts, 100).Q).toBeCloseTo(clean * 0.6, 9);
    expect(q0).toBe(0);
  });
  it('개발 방향: 배분점이 높은 능력치가 더 많이 쌓인다(0.5 + 점/4)', () => {
    const a = devReady(2, 2, { direction: { P: 4, E: 0, U: 2, D: 2, Q: 2 } }).g.state.projects[0].points;
    expect(a.P / a.E).toBeGreaterThan(2.2); // 1.5 : 0.5 = 3배(주간 난수는 둘이 같다)
  });
  it('예산 등급: 과감은 산출 ×1.25·비용 ×2, 절약은 ×0.8·×0.5', () => {
    const pts = (budget: 'low' | 'normal' | 'high') => { const p = devReady(4, 0, { budget }).g.state.projects[0]; return { s: p.points.P + p.points.E + p.points.U + p.points.D + p.points.Q, spent: p.spent }; };
    const lo = pts('low'), no = pts('normal'), hi = pts('high');
    expect(hi.s / no.s).toBeCloseTo(1.25, 6); expect(lo.s / no.s).toBeCloseTo(0.8, 6);
    const proto = config.dev.prototypePerWeek * 12;
    expect((hi.spent - proto) / (no.spent - proto)).toBeCloseTo(2, 6);
    expect((lo.spent - proto) / (no.spent - proto)).toBeCloseTo(0.5, 6);
  });
  it('주간 개발비 = 참여 직원 월급 합 ÷ 4 × 비용 배수 + 시제차 비용, 월말에 현금에서 나간다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const p = g.state.projects[0], salary = g.state.staff.reduce((a, s) => a + 250 + s.ability * 12, 0);
    expect(weeklyDevCost(g.state, p)).toBeCloseTo(salary / 4 + config.dev.prototypePerWeek, 9);
    for (let i = 0; i < 4; i++) g.tick();
    const l = g.state.ledger[0];
    expect(l.dev).toBeCloseTo((salary / 4 + config.dev.prototypePerWeek) * 4, 6);
    expect(l.salaries).toBe(salary);
    expect(g.state.cash).toBeCloseTo(config.start.cash - l.dev - salary - config.factory.upkeep - config.hq.upkeep, 6);
  });
  it('기획 검증: 방향 합 10·각 0~4, 옵션 2개까지·중복 금지, 설계 8/12/16주, 개발팀 1개', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    grant(g, 'el_radio');
    const bad = (x: object) => { const r = g.command({ type: 'startProject', ...SPEC, ...x } as never); return r.ok ? '' : r.reason; };
    expect(bad({ direction: { P: 5, E: 1, U: 2, D: 1, Q: 1 } })).toContain('개발 방향');
    expect(bad({ direction: { P: 2, E: 2, U: 2, D: 2, Q: 1 } })).toContain('합계 10점');
    expect(bad({ options: ['radio', 'radio'] })).toBe('같은 옵션을 두 번 고를 수 없습니다.');
    expect(bad({ designWeeks: 10 })).toContain('설계 기간');
    expect(bad({ tier: 4 })).toContain('동력 등급');
    expect(bad({ budget: 'x' })).toBe('예산 등급이 올바르지 않습니다.');
    expect(bad({ segment: 'x' })).toBe('없는 고객층입니다.');
    ok(g.command({ type: 'startProject', ...SPEC, options: ['radio'] }));
    expect(bad({})).toContain('개발팀이 모두 바쁩니다');
    expect(g.state.staff.every((s) => s.projectId === g.state.projects[0].id)).toBe(true);
  });
  it('이름이 비면 기본 이름을 붙인다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    ok(g.command({ type: 'startProject', ...SPEC, name: '' }));
    expect(g.state.projects[0].name.length).toBeGreaterThan(0);
  });
  it('개발 취소: 직원이 풀리고, 쓴 돈은 돌아오지 않는다', () => {
    const { g, pid } = devReady(1, 0);
    const spent = g.state.projects[0].spent, cash0 = g.state.cash, pending = g.state.pendingDev;
    ok(g.command({ type: 'cancelProject', projectId: pid }));
    expect(g.state.projects.length).toBe(0);
    expect(g.state.staff.every((s) => s.projectId === null)).toBe(true);
    expect(g.state.cash).toBe(cash0); expect(g.state.pendingDev).toBe(pending);
    expect(spent).toBeGreaterThan(0);
    expect(g.command({ type: 'cancelProject', projectId: pid })).toEqual({ ok: false, reason: '없는 개발 프로젝트입니다.' });
  });
  it('동력 단계 1~3: 점수 40 × 1.22^(단계−1)을 P 60 : E 40으로, 원가 가산 0% / +10% / +22%', () => {
    expect(partStats('gasoline', 1, []).P).toBeCloseTo(24, 9);
    expect(partStats('gasoline', 3, []).E).toBeCloseTo(40 * 1.22 ** 2 * 0.4, 9);
    expect(unitCost('sedanS', 'gasoline', 1, [])).toBe(984);
    expect(unitCost('sedanS', 'gasoline', 2, [])).toBeCloseTo(984 * 1.1, 9);
    expect(unitCost('sedanS', 'gasoline', 3, ['radio'])).toBeCloseTo(984 * 1.22 + 15, 9);
  });
});

describe('기획 미리보기(planPreview)와 결함 안내(defectAdvice)', () => {
  const specs = [SPEC, { ...SPEC, budget: 'high' as const, designWeeks: 16, direction: { P: 4, E: 0, U: 2, D: 4, Q: 0 } }, { ...SPEC, budget: 'low' as const, designWeeks: 8, options: ['radio'] }];
  it('실제로 개발한 등급이 예상 범위 안에 들고, 개발비는 설계 + 최소 시험 주 만큼', () => {
    for (const spec of specs) for (let seed = 1; seed <= 12; seed++) {
      const g = Game.create({ difficulty: 'normal', seed });
      grant(g, 'el_radio');
      const pv = planPreview(g.state, spec);
      expect(pv.min).toBeLessThanOrEqual(pv.avg); expect(pv.avg).toBeLessThanOrEqual(pv.max);
      ok(g.command({ type: 'startProject', ...spec }));
      const p = g.state.projects[0];
      while (p.phase === 'design' || p.testWeeks < config.dev.minTestWeeks) g.tick();
      const at2 = projectPreview(g.state, p.id)!.avg;
      expect(p.spent).toBeCloseTo(pv.cost, 6);
      expect(at2).toBeGreaterThanOrEqual(pv.min); expect(at2).toBeLessThanOrEqual(pv.max);
      for (let i = 0; i < 20; i++) g.tick(); // 시험을 오래 해도 최고치를 넘지 않는다
      expect(projectPreview(g.state, p.id)!.avg).toBeLessThanOrEqual(pv.max);
    }
  });
  it('결함 안내: 15개 이상 많음, 6~14 조금 더, 5 이하 출시 좋음 + 연 리콜 확률', () => {
    const { g, pid } = devReady(1);
    const p = g.state.projects.find((x) => x.id === pid)!;
    const at = (n: number) => { p.defectEst = n; return defectAdvice(p); };
    expect(at(15).level).toBe('many'); expect(at(15).text).toContain('평론가 4명이 모두 1점씩');
    expect(at(14).level).toBe('some'); expect(at(6).level).toBe('some');
    expect(at(5).level).toBe('ok'); expect(at(0).level).toBe('ok');
    expect(at(10).recallYear).toBeCloseTo(0.2); expect(at(40).recallYear).toBe(config.recall.maxYear);
  });
});
