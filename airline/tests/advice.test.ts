import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { advise } from '../src/sim/advice';
import { ACHIEVEMENTS, achieved } from '../src/sim/achievements';

describe('조언·업적', () => {
  it('새 게임: 노는 항공기가 있으면 경고가 맨 앞에 온다', () => {
    const g = new Game(7);
    const a = advise(g);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a[0].level).toBe('bad');
    expect(a[0].text).toContain('노는 항공기');
  });
  it('끝난 게임에서는 조언이 없다', () => {
    const g = new Game(7);
    g.state.status = 'bankrupt';
    expect(advise(g)).toEqual([]);
  });
  it('업적: 새 게임은 아무것도 달성하지 못하고, id는 중복이 없다', () => {
    const g = new Game(7);
    expect(achieved(g)).toEqual([]);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
  it('업적: 노선을 열고 항공기를 배정하면 "첫 비행"', () => {
    const g = new Game(7);
    const b = g.state.base;
    const ok = ['JFK', 'LHR', 'ICN', 'NRT', 'SIN', 'LAX', 'CDG', 'HKG', 'SYD'].some((id) => {
      if (id === b) return false;
      const o = g.openRoute(b, id);
      return o.ok && g.assign(g.state.planes[0].id, o.routeId, 3).ok;
    });
    expect(ok).toBe(true);
    expect(achieved(g)).toContain('first');
  });
});
