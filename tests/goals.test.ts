import { describe, it, expect } from 'vitest';
import { Editor } from '../src/sim/editor';
import { config } from '../src/config';
import { GOALS, goalsDone, dayScore } from '../src/sim/goals';
import type { DayRecord } from '../src/sim/metrics';

const rec = (day: number, o: Partial<DayRecord>): DayRecord => ({ day, ci: 10, generated: 300, arrived: 290, incomplete: 10, completion: 97, avgTravelMin: 20, throughput: 290, ...o });

describe('목표·업적', () => {
  const net = new Editor(config).network;
  it('기록이 없으면 아무것도 달성하지 않는다', () => { expect(goalsDone({ history: [], net, day: 1 })).toEqual([]); });
  it('하루 기록으로 원활·쾌적·연속 달성을 판정한다', () => {
    const h = [rec(1, {}), rec(2, {}), rec(3, {})];
    const d = goalsDone({ history: h, net, day: 4 });
    expect(d).toEqual(expect.arrayContaining(['first-day', 'smooth', 'smooth3', 'calm']));
    expect(goalsDone({ history: [rec(1, {}), rec(2, { completion: 80 }), rec(3, {})], net, day: 4 })).not.toContain('smooth3');
  });
  it('이동이 적은 날은 원활 목표로 치지 않는다', () => { expect(goalsDone({ history: [rec(1, { generated: 50 })], net, day: 2 })).not.toContain('smooth'); });
  it('심각했다가 다음 날 회복하면 병목 해결', () => { expect(goalsDone({ history: [rec(1, { ci: 70 }), rec(2, { ci: 30 })], net, day: 3 })).toContain('fixed'); });
  it('점수 계산과 목표 ID 중복 없음', () => {
    expect(dayScore(rec(1, { completion: 100, ci: 0 }))).toBe(100);
    expect(dayScore(rec(1, { completion: null }))).toBeNull();
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
  });
});
