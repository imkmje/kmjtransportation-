// 1.0.0 명예의 전당: 각 항목이 실제 최댓값(최솟값)과 같다
import { describe, expect, it } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { hallOfFame } from '../src/sim/hall';
import { modelPnL } from '../src/sim/insight';
import { SPEC, ok } from './util';

function played(): Game {
  const g = Game.create({ difficulty: 'easy', seed: 5 });
  g.state.cash += 5_000_000; g.state.factory.level = 2; g.state.hqLevel = 3;
  for (const [i, price] of [1100, 1500].entries()) {
    ok(g.command({ type: 'startProject', ...SPEC, name: ['가', '나'][i], segment: ['worker', 'family'][i] }));
    const pid = g.state.projects.at(-1)!.id;
    while (!g.state.projects.find((p) => p.id === pid)!.waiting && !(g.state.projects.find((p) => p.id === pid)!.phase === 'test' && g.state.projects.find((p) => p.id === pid)!.testWeeks >= 3)) g.tick();
    ok(g.command({ type: 'launch', projectId: pid, price, marketing: 1, color: 'red', wheels: 0 }));
    for (let w = 0; w < 30; w++) g.tick();
  }
  return g;
}

describe('hallOfFame', () => {
  it('빈 회사는 empty', () => { expect(hallOfFame(Game.create({ difficulty: 'normal', seed: 1 }).state).empty).toBe(true); });
  it('각 차 항목이 실제 최댓값·최솟값과 같다', () => {
    const g = played(), s = g.state, gens = allGens(s), h = hallOfFame(s), at = (k: string) => h.cars.find((x) => x.key === k) ?? h.shame.find((x) => x.key === k);
    expect(h.empty).toBe(false);
    expect(at('sold')!.value).toBe(Math.max(...gens.map((x) => x.totalSold)));
    expect(at('pricey')!.value).toBe(Math.max(...gens.map((x) => x.editions[0].price)));
    expect(at('cheap')!.value).toBe(Math.min(...gens.map((x) => x.editions[0].price)));
    expect(at('review')!.value).toBe(Math.max(...gens.map((x) => x.reviewAvg)));
    expect(at('worstReview')!.value).toBe(Math.min(...gens.map((x) => x.reviewAvg)));
    expect(at('long')!.value).toBe(Math.max(...gens.map((x) => x.sales.length)));
    expect(at('month')!.value).toBe(Math.max(...gens.flatMap((x) => x.sales)));
    const nets = gens.map((x) => modelPnL(s, x.id)!.net);
    if (Math.max(...nets) > 0) expect(at('profit')!.value).toBe(Math.max(...nets)); else expect(at('profit')).toBeUndefined();
    if (Math.min(...nets) < 0) expect(at('loss')!.value).toBe(Math.min(...nets)); else expect(at('loss')).toBeUndefined();
    expect(h.company.find((x) => x.key === 'totalSold')!.value).toBe(gens.reduce((a, x) => a + x.totalSold, 0));
    expect(hallOfFame(s)).toEqual(h); // 결정론
  });
});
