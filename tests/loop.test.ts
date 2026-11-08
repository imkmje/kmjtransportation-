import { describe, it, expect } from 'vitest';
import { TickLoop } from '../src/sim/loop';

function make(max = 10) {
  let ticks = 0;
  const loop = new TickLoop(20, max, () => ticks++);
  return { loop, ticks: () => ticks };
}

describe('고정 tick 루프', () => {
  it('1×에서 현실 1초 = 20 tick (프레임이 잘게 나뉘어도 같다)', () => {
    const { loop, ticks } = make();
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, 1);
    expect(ticks()).toBe(20);
  });
  it('4×는 4배, 2×는 2배', () => {
    const a = make(), b = make();
    for (let i = 0; i < 60; i++) { a.loop.advance(1 / 60, 4); b.loop.advance(1 / 60, 2); }
    // 소수점 오차로 1 tick 늦을 수 있다(나머지는 다음 프레임으로 이월됨)
    expect(Math.abs(a.ticks() - 80)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.ticks() - 40)).toBeLessThanOrEqual(1);
    a.loop.advance(1 / 60, 4); // 이월된 tick이 사라지지 않았는지
    expect(a.ticks()).toBeGreaterThanOrEqual(81);
  });
  it('일시정지면 tick 없음', () => {
    const { loop, ticks } = make();
    loop.advance(1, 0);
    expect(ticks()).toBe(0);
  });
  it('프레임당 상한을 넘으면 밀린 tick은 버리고 실제 배속이 낮아진다', () => {
    const { loop, ticks } = make(10);
    for (let i = 0; i < 100; i++) loop.advance(1, 4); // 1초 멈춤 → 80 tick 요구, 10만 처리
    expect(ticks()).toBe(1000);
    expect(loop.actualSpeed).toBeLessThan(1);
  });
  it('정상 속도에서는 실제 배속이 목표와 같다(가짜 경고 없음)', () => {
    for (const speed of [1, 2, 4]) {
      const { loop } = make();
      let worst = Infinity;
      for (let i = 0; i < 300; i++) {
        loop.advance(1 / 60, speed);
        worst = Math.min(worst, loop.actualSpeed / speed);
      }
      expect(worst).toBeGreaterThan(0.9);
    }
  });
});
