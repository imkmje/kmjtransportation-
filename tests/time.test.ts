import { describe, it, expect } from 'vitest';
import { clockAt, clockRatio } from '../src/sim/time';
import { config } from '../src/config';

const o = config;

describe('두 시계', () => {
  it('하루 60분이면 시계는 24배 빠르다', () => {
    expect(clockRatio(60)).toBe(24);
    expect(clockRatio(30)).toBe(48);
    expect(clockRatio(120)).toBe(12);
  });
  it('시작은 1일차 월요일 05:00', () => {
    const c = clockAt(0, o);
    expect(c).toMatchObject({ day: 1, weekday: '월', hour: 5, minute: 0, isWeekend: false });
  });
  it('시계 1시간 = 시뮬 2분 30초', () => {
    expect(clockAt(150, o)).toMatchObject({ day: 1, hour: 6, minute: 0 });
  });
  it('하루 경계는 04:00: 03:59는 아직 1일차, 04:00에 2일차', () => {
    // 05:00 → 다음날 03:59 = 22시간 59분 = 82740 시계초 → 시뮬 3447.5초
    expect(clockAt(3447.5, o)).toMatchObject({ day: 1, hour: 3, minute: 59 });
    expect(clockAt(3450, o)).toMatchObject({ day: 2, weekday: '화', hour: 4, minute: 0 });
  });
  it('6일차·7일차는 주말, 8일차는 다시 월요일', () => {
    const at = (day: number) => clockAt((day - 1) * 3600 + 60, o); // 각 일차 05:00 직후
    expect(at(6)).toMatchObject({ day: 6, weekday: '토', isWeekend: true });
    expect(at(7)).toMatchObject({ day: 7, weekday: '일', isWeekend: true });
    expect(at(8)).toMatchObject({ day: 8, weekday: '월', isWeekend: false });
  });
});
