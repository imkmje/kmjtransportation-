// 0.5.0 초반 체감 균형: 첫 차 판매, 가격 벌점 완화, 예상 판매 폭, 창업 직후 연구, 본사 1등급 정원
import { describe, it, expect } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { salesForecast } from '../src/sim/queries';
import { researchError, weeklyResearchPoints } from '../src/sim/research';
import { TECHS } from '../src/data';
import { config } from '../src/config';
import { SPEC, ok } from './util';

/** 쉬움 새 게임, 시작 직원 전원으로 보통 예산·중간 설계 기간 첫 차, 화면 결함 5개 이하에서 기준가 × priceMult·광고 1로 출시하고 months개월 판매 */
function firstCar(seed: number, priceMult: number, months = 6) {
  const g = Game.create({ seed, difficulty: 'easy' });
  ok(g.command({ type: 'startProject', ...SPEC }));
  const p = g.state.projects[0];
  while (!(p.phase === 'test' && p.testWeeks >= config.dev.minTestWeeks && (p.defectEst <= 5 || p.waiting))) g.tick();
  const price = Math.round(1200 * priceMult), fc = salesForecast(g.state, p.id, price, 1)!;
  ok(g.command({ type: 'launch', projectId: p.id, price, marketing: 1, color: 'red', wheels: 0 }));
  const gen = allGens(g.state)[0];
  while (gen.sales.length < months) g.tick();
  return { sales: gen.sales, fc, g };
}

describe('첫 차(0.5.0)', () => {
  it('쉬움에서 평범한 첫 차(등급 4~5)를 기준가에 광고 1로 내면 출시 3개월째 월 30대 이상 팔리고, 기준가의 108%여도 월 20대 이상(중앙값)', () => {
    const over: number[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(firstCar(seed, 1).sales[2], `seed ${seed}`).toBeGreaterThanOrEqual(30);
      over.push(firstCar(seed, 1.08).sales[3]);
    }
    expect([...over].sort((a, b) => a - b)[2]).toBeGreaterThanOrEqual(20); // 108%: 출시 4개월째 중앙값(평론이 낮은 차는 조금 덜)
  });
  it('기준가보다 조금 비싸면 조금 덜 팔리고(108%에서 절반쯤), 108%를 넘으면 빠르게 줄어든다', () => {
    const at = (m: number) => firstCar(1, m).sales[4];
    const a = at(1), b = at(1.08), c = at(1.2);
    expect(b / a).toBeGreaterThan(0.25); expect(b / a).toBeLessThan(0.75);
    expect(c / a).toBeLessThan(0.05);
  });
  it('출시 화면 예상 월 판매는 ±30% 폭(최대 ÷ 최소 ≈ 1.3 / 0.7)', () => {
    const { fc } = firstCar(2, 1, 1);
    expect(fc.max / fc.min).toBeGreaterThan(1.7); expect(fc.max / fc.min).toBeLessThan(1.95);
  });
  it('쉬움에서 첫 차만으로 창업 30개월 안에 월 흑자', () => {
    for (const seed of [1, 2, 3]) {
      const { g } = firstCar(seed, 1, 24);
      expect(g.state.ledger.some((e) => e.profit > 0 && e.month < 30), `seed ${seed}`).toBe(true);
    }
  });
});

describe('창업 직후(0.5.0)', () => {
  it('창업 직후에도 연구 점수가 0이 아니다(전원 개발 중이어도), 1970년에 바로 연구할 수 있는 기술이 5개 이상', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' });
    ok(g.command({ type: 'startProject', ...SPEC }));
    expect(g.state.staff.every((x) => x.projectId !== null)).toBe(true);
    expect(weeklyResearchPoints(g.state)).toBeGreaterThan(0);
    expect(TECHS.filter((t) => researchError(g.state, t.id) === null).length).toBeGreaterThanOrEqual(5);
  });
  it('본사 1등급에서 2명을 더 채용할 수 있다(시작 직원 4명, 정원 6)', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' });
    expect(g.state.staff.length).toBe(4);
    for (let i = 0; i < 2; i++) { ok(g.command({ type: 'postJob', role: 'engineer', tier: 1 })); ok(g.command({ type: 'hire', candidateId: g.state.candidates[0].id })); ok(g.command({ type: 'dismissCandidates' })); }
    expect(g.state.staff.length).toBe(6);
    expect(g.command({ type: 'postJob', role: 'engineer', tier: 1 }).ok).toBe(false);
  });
});
