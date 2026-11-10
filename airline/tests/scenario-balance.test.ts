import { describe, it, expect } from 'vitest';
import { SCENARIOS } from '../src/data';
import { STRATEGIES, run } from '../src/sim/strategies';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const names = ['보수적', '대출형', '종합형'];

describe('시나리오·난이도별 균형 점검', () => {
  it('시나리오마다 전략별 결과를 출력하고, 승리 불가능하거나 너무 쉬운 시나리오가 없는지 확인한다', () => {
    const lines: string[] = [];
    const wins: Record<string, number> = {};
    for (const sc of SCENARIOS) for (const diff of ['easy', 'normal', 'hard'] as const) {
      const cells = names.map((n) => {
        const st = STRATEGIES.find((x) => x.name === n)!;
        const rs = SEEDS.map((seed) => run(st, seed, sc.timeLimit, { scenario: sc.id, difficulty: diff }));
        const w = rs.filter((r) => r.status === 'won').length, b = rs.filter((r) => r.status === 'bankrupt').length;
        wins[`${sc.id}/${diff}/${n}`] = w;
        return `${n}[승${w} 파${b}]`;
      });
      lines.push(`SCEN ${sc.id} ${diff}: ${cells.join(' ')}`);
    }
    console.log(lines.join('\n'));
    for (const sc of SCENARIOS) {
      const best = Math.max(...names.map((n) => wins[`${sc.id}/normal/${n}`]));
      expect(best).toBeGreaterThan(0); // 보통 난이도에서 잘하면 이길 수 있어야 한다
      expect(Math.min(...names.map((n) => wins[`${sc.id}/hard/${n}`]))).toBeLessThan(SEEDS.length); // 어려움에서는 쉬운 전략이 항상 이기지 못한다
    }
  }, 600_000);
});
