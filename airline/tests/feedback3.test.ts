import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { seasonOf, rawMonthlyDemand } from '../src/sim/model';
import { cityById } from '../src/data';

describe('대기 항공기 배정 추천', () => {
  it('열린 노선 중 이익이 늘어나는 순서로 알려 주고, 배정 중인 항공기는 빈 목록', () => {
    const g = new Game(1, undefined, { sandbox: true }); g.state.cash = 900;
    const o1 = g.openRoute('ICN', 'NRT'), o2 = g.openRoute('ICN', 'SIN'); if (!o1.ok || !o2.ok) throw new Error('open');
    const idle = g.buyPlane('A220'); if (!idle.ok) throw new Error('buy');
    const adv = g.assignAdvice(idle.planeId);
    expect(adv.length).toBeGreaterThan(0); expect(adv.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < adv.length; i++) expect(adv[i - 1].profit).toBeGreaterThanOrEqual(adv[i].profit);
    expect(g.plane(idle.planeId)!.routeId).toBeNull(); // 계산 뒤에 원래대로
    g.assign(idle.planeId, adv[0].routeId, adv[0].weekly); expect(g.assignAdvice(idle.planeId)).toEqual([]);
  });
});

describe('계절 수요', () => {
  it('12개월 수요가 고정이 아니고, 성수기가 가장 높다', () => {
    const a = cityById('ICN'), b = cityById('NRT'), v = Array.from({ length: 12 }, (_, i) => rawMonthlyDemand(a, b, i + 1));
    expect(Math.max(...v) / Math.min(...v)).toBeGreaterThan(1.1);
    expect(new Set(v.map((x) => Math.round(x))).size).toBeGreaterThan(6);
    const peak = a.peak.months[0]; expect(seasonOf(a, peak)).toBeGreaterThan(seasonOf(a, ((peak + 5) % 12) + 1));
  });
  it('연평균은 1에 가깝다(균형을 크게 흔들지 않는다)', () => {
    const a = cityById('ICN'), mean = Array.from({ length: 12 }, (_, i) => seasonOf(a, i + 1)).reduce((x, y) => x + y, 0) / 12;
    expect(mean).toBeGreaterThan(0.95); expect(mean).toBeLessThan(1.12);
  });
});

describe('자유 모드 경쟁사 성장', () => {
  it('3년 뒤에는 처음보다 항공기가 늘어난 경쟁사가 있다', () => {
    const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 800;
    const start = g.state.competitors.filter((c) => !c.major).map((c) => c.planes);
    for (let i = 0; i < 3; i++) { g.advanceDays(360); g.state.cash = 800; }
    const grown = g.state.competitors.filter((c) => !c.major).some((c) => c.planes >= 4);
    expect(start.every((n) => n === 0)).toBe(true); expect(grown).toBe(true);
    expect(g.state.competitors.some((c) => (c.pHist?.length ?? 0) > 1)).toBe(true);
  });
});

describe('계약 보상', () => {
  it('보상 설정이 낮아졌다(월 이익의 몇 배 이내)', () => {
    expect(config.contract.rewardMonths).toBeLessThanOrEqual(4); expect(config.contract.rewardMax).toBeLessThanOrEqual(150);
    expect(config.contract.kindMult.otp).toBeLessThan(config.contract.kindMult.cities);
  });
});
