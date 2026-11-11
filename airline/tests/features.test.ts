import { describe, it, expect } from 'vitest';
import { featured, run, type Feat } from '../src/sim/strategies';

/**
 * 기능별 균형 측정: 종합형(기준)에 새 기능을 하나씩 더해 같은 시드로 5년을 돌리고, 누적 이익의 중앙값을 비교한다.
 * 어떤 기능이 압도적이거나(너무 셈) 오히려 손해(쓸모없음)인지 가려내기 위한 도구다. 자동 전략은 사람보다 단순하므로 "방향"을 보는 용도다.
 */
const SEEDS = Array.from({ length: 8 }, (_, i) => i + 1), MONTHS = 60;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const measure = (name: string, f: Feat, rights = false) => {
  const rs = SEEDS.map((seed) => run(featured(name, f), seed, MONTHS, { sandbox: true, rights }));
  return { name, profit: median(rs.map((r) => r.cumProfit)), cash: median(rs.map((r) => r.cash)), planes: median(rs.map((r) => r.planes)), bankrupt: rs.filter((r) => r.status === 'bankrupt').length };
};

describe('기능별 균형 측정(5년, 시드 8개, 참고용)', () => {
  it('새 기능을 쓰는 전략을 돌려 비교표를 출력한다', () => {
    const base = measure('기준', {});
    const rows = [base, measure('+업그레이드', { upgrades: true }), measure('+허브 투자', { hubs: true }), measure('+계약', { contracts: true }), measure('+신기종', { newgen: true }), measure('+경매', { auction: true }), measure('전부', { upgrades: true, hubs: true, contracts: true, newgen: true, auction: true })];
    const rb = measure('운수권 켬(구매 안 함)', {}, true), rr = measure('운수권 켬(구매함)', { rights: true }, true);
    const fmt = (r: ReturnType<typeof measure>) => `${r.name.padEnd(16)} 누적이익 ${r.profit.toFixed(0).padStart(5)} (${((r.profit / base.profit - 1) * 100).toFixed(0).padStart(4)}%)  현금 ${r.cash.toFixed(0).padStart(4)}  기단 ${r.planes}  파산 ${r.bankrupt}/${SEEDS.length}`;
    console.log('FEAT\n' + [...rows, rb, rr].map(fmt).join('\n'));
    // 자동 전략은 돈을 바닥까지 쓰기 때문에 기능을 얹을 때마다 결과가 크게 흔들린다(같은 기능도 시드·규칙 미세 변경에 따라 ±50%). 그래서 여기서는 "돌아가고 숫자가 나온다"만 확인하고, 기능 하나의 세기는 payback.test.ts가 정책과 무관하게 잰다.
    for (const r of [...rows, rb, rr]) expect(Number.isFinite(r.profit) && Number.isFinite(r.cash)).toBe(true);
  }, 600_000);
});
