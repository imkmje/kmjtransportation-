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
    expect(by('무작위').승리).toBe(0);
    expect(by('보수적').승리).toBeLessThan(SEEDS.length * 0.5); // 쉬운 전략이 절반 넘게 이기면 너무 쉬운 게임
    expect(by('공격적').승리).toBeGreaterThan(0); // 좋은 전략은 이길 수 있어야 한다
    expect(by('보수적').파산 + by('공격적').파산).toBeLessThan(SEEDS.length); // 좋은 전략이 항상 파산하면 너무 어려운 게임
  }, 300_000);
});
