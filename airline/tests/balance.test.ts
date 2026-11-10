import { describe, it, expect } from 'vitest';
import { STRATEGIES, run } from '../src/sim/strategies';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('균형 점검(전략별 24개월 × 20개 시드)', () => {
  it('결과를 출력하고, 기본적인 건전성을 확인한다', () => {
    const rows = STRATEGIES.map((s) => {
      const rs = SEEDS.map((seed) => run(s, seed));
      const n = (st: string) => rs.filter((r) => r.status === st).length;
      const med = (k: 'cash' | 'cumProfit' | 'months') => { const v = rs.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
      return { name: s.name, 파산: n('bankrupt'), 승리: n('won'), 시간초과: n('timeup'), 중간이익: +med('cumProfit').toFixed(1), 중간현금: +med('cash').toFixed(1), 중간개월: med('months'), 평균기체: +(rs.reduce((a, r) => a + r.planes, 0) / rs.length).toFixed(1) };
    });
    console.log('BALANCE\n' + rows.map((r) => JSON.stringify(r)).join('\n'));
    // 건전성: 방치는 승리하지 못하고, 어떤 전략도 실행 중 예외 없이 끝난다
    const by = (n: string) => rows.find((r) => r.name === n)!;
    expect(by('방치').승리).toBe(0);
    expect(by('방치').파산).toBeGreaterThan(SEEDS.length * 0.5); // 아무것도 안 하면 고정비로 파산한다
    expect(by('무작위').승리).toBe(0);
    expect(by('보수적').승리).toBeLessThan(SEEDS.length * 0.5); // 쉬운 전략이 절반 넘게 이기면 너무 쉬운 게임
    expect(by('대출형').승리).toBeGreaterThan(0); // 대출을 잘 쓰면 이길 수 있어야 한다
    expect(by('대출형').승리).toBeLessThan(SEEDS.length * 0.9); // 그래도 항상 이기면 위험이 없는 게임
    expect(by('종합형').승리).toBeGreaterThanOrEqual(by('대출형').승리); // 새 기능(등급·화물·허브)을 쓰는 쪽이 더 낫다
    expect(by('종합형').승리).toBeLessThan(SEEDS.length); // 그래도 항상 이기지는 않는다
    expect(by('무모형').중간이익).toBeLessThan(by('대출형').중간이익); // 과한 확장은 신중한 대출보다 못하다
  }, 300_000);
});
