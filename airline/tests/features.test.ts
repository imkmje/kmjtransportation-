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

describe('기능별 균형 측정(5년, 시드 8개)', () => {
  it('각 기능이 기준보다 너무 세거나 쓸모없지 않다', () => {
    const base = measure('기준', {});
    const rows = [base, measure('+업그레이드', { upgrades: true }), measure('+허브 투자', { hubs: true }), measure('+계약', { contracts: true }), measure('+신기종', { newgen: true }), measure('+경매', { auction: true }), measure('전부', { upgrades: true, hubs: true, contracts: true, newgen: true, auction: true })];
    const rb = measure('운수권 켬(구매 안 함)', {}, true), rr = measure('운수권 켬(구매함)', { rights: true }, true);
    const fmt = (r: ReturnType<typeof measure>) => `${r.name.padEnd(16)} 누적이익 ${r.profit.toFixed(0).padStart(5)} (${((r.profit / base.profit - 1) * 100).toFixed(0).padStart(4)}%)  현금 ${r.cash.toFixed(0).padStart(4)}  기단 ${r.planes}  파산 ${r.bankrupt}/${SEEDS.length}`;
    console.log('FEAT\n' + [...rows, rb, rr].map(fmt).join('\n'));
    expect(base.profit).toBeGreaterThan(0);
    for (const r of rows.slice(1, 6)) { // 기능 하나: 기준 대비 +70%를 넘으면 너무 세고, −35% 아래면 손해
      expect(r.profit, `${r.name}가 너무 세다`).toBeLessThan(base.profit * 1.7);
      expect(r.profit, `${r.name}가 손해다`).toBeGreaterThan(base.profit * 0.65);
    }
    expect(rows[6].profit, '전부 쓰면 너무 세다').toBeLessThan(base.profit * 2.6);
    expect(rr.profit, '운수권을 사도 못 따라간다').toBeGreaterThan(rb.profit * 0.9);
  }, 600_000);
});
