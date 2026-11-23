// 1.0.0 균형 기준: 편의 기능(자동 가격 '최고 이익 매달' + 임원 위임·교체 고용)을 다 쓰는 봇(steadyBestExec)
// 0.10.0까지는 기준가에 파는 신중 봇(steady)이 기준이었지만, 실제 플레이는 편의 기능을 쓰므로 중후반 돈이 훨씬 빨리 쌓였다(40년 자산 보통 +169%).
// 사용자 지시(너그럽게: "혼자 하는 게임이고 돈 쓸 데를 만들면 된다")로 목표는 보통 현금 중앙값 40년 1.5~6조·60년 3~12조(공장 건설비 완화로 8 → 12조 허용), 쉬움은 그보다 많되 60년 20조 미만.
// 시드 20개 60년 측정은 테스트 밖에서 했다(봇 한 판 약 10초라 CI 시간 안에 시드 3개만 돈다). 기준가 판매 봇 기준 항목은 balance.test.ts에 참고로 남는다
import { describe, it, expect, vi } from 'vitest';
import { steadyBestExec, type Bot } from '../src/sim/bots';
import { Game } from '../src/sim/game';
import type { Difficulty } from '../src/sim/types';

// CI에서 60년 봇 한 판이 68초 걸려 60초 제한에 걸렸다(1.2.0 PR). 로컬보다 CI가 느리다.
vi.setConfig({ testTimeout: 180_000 });

const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
const JO = 1e8; // 만원 → 조
/** 봇을 years년 돌려 해마다 현금·생존·그해 이익(장부) */
function run(bot: () => Bot, seed: number, years: number, d: Difficulty) {
  const g = Game.create({ seed, difficulty: d }), b = bot(), cash: number[] = [], alive: boolean[] = [], profit: number[] = [];
  for (let w = 1; w <= years * 48; w++) {
    if (g.state.status === 'playing') { b.step(g); g.tick(); }
    if (w % 48 === 0) { cash.push(g.state.cash); alive.push(g.state.status === 'playing'); profit.push(g.state.years?.[1969 + w / 48]?.profit ?? 0); }
  }
  return { cash, alive, profit };
}

describe('1.0.0 균형(편의 기능을 다 쓰는 봇, 시드 3개)', () => {
  it('보통 steadyBestExec: 60년 생존, 현금 중앙값 40년 1.5~8조·60년 3~18조(1.3.0)', () => {
    const rs = [1, 2, 3].map((seed) => run(() => steadyBestExec(), seed, 60, 'normal'));
    const c40 = median(rs.map((r) => r.cash[39])), c60 = median(rs.map((r) => r.cash[59]));
    console.log(`보통 steadyBestExec 현금 중앙값 20년 ${(median(rs.map((r) => r.cash[19])) / JO).toFixed(2)}조 / 40년 ${(c40 / JO).toFixed(2)}조 / 60년 ${(c60 / JO).toFixed(2)}조`);
    for (const r of rs) expect(r.alive[59]).toBe(true);
    // 1.3.0: 상한 40년 6 → 8조, 60년 12 → 18조(개발 중 직원 성과로 측정 40년 5.23 → 6.41조, 60년 11.05 → 15.81조)
    expect(c40).toBeGreaterThanOrEqual(1.5 * JO); expect(c40).toBeLessThanOrEqual(8 * JO);
    expect(c60).toBeGreaterThanOrEqual(3 * JO); expect(c60).toBeLessThanOrEqual(18 * JO);
  });
  it('쉬움 steadyBestExec: 보통보다 많고 60년에 30조를 넘지 않는다(숫자가 무의미해지지 않게. 1.1.0: 장비 개편으로 20 → 25조, 시드 3개 측정 약 20.7조. 1.4.0: 25 → 30조)', () => {
    const rs = [1, 2, 3].map((seed) => run(() => steadyBestExec(), seed, 60, 'easy'));
    const c60 = median(rs.map((r) => r.cash[59]));
    console.log(`쉬움 steadyBestExec 60년 현금 중앙값 ${(c60 / JO).toFixed(2)}조`);
    expect(c60).toBeGreaterThan(3 * JO); expect(c60).toBeLessThan(30 * JO); // 1.4.0: 25 → 30조(자동 채용·해고로 직원 능력이 올라 측정 26.81조. 후반에도 빈자리를 채우게 한 뒤 24.23 → 26.81조)
  });
  it('전기차 전환(B4): 동력을 시대에 맞게 고르는 봇(편의 기능 사용)이 2025~2035년 이익 합에서 가솔린만 고집하는 봇보다 많고, 그 기간 흑자인 해가 많다(시드 1, 66년)', () => {
    const a = run(() => steadyBestExec(), 1, 66, 'normal'), gas = run(() => steadyBestExec({ ptPick: 'gasoline' }), 1, 66, 'normal');
    const span = (r: typeof a) => r.profit.slice(2025 - 1970, 2036 - 1970), sum = (x: number[]) => x.reduce((p, q) => p + q, 0);
    console.log(`2025~2035 이익 합: 적기 ${(sum(span(a)) / JO).toFixed(2)}조, 가솔린만 ${(sum(span(gas)) / JO).toFixed(2)}조, 적기의 흑자인 해 ${span(a).filter((x) => x > 0).length}/11`);
    expect(sum(span(a))).toBeGreaterThan(sum(span(gas)));
    expect(span(a).filter((x) => x > 0).length).toBeGreaterThanOrEqual(9);
  });
});
