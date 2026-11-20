import { describe, it, expect } from 'vitest';
import { idle, runBot, steady } from '../src/sim/bots';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('균형 봇(시드 20개 × 10년)', () => {
  it('방치는 10년 안에 전부 파산한다', () => {
    const rs = SEEDS.map((s) => runBot(idle, s, 10));
    console.log('idle 파산 개월:', rs.map((r) => r.months).join(','));
    expect(rs.every((r) => !r.survived && r.months < 120)).toBe(true);
  });
  it('신중(steady)은 10년 생존율 70% 이상', () => {
    const rs = SEEDS.map((s) => runBot(steady(), s, 10));
    const alive = rs.filter((r) => r.survived).length;
    console.log(`steady 생존 ${alive}/20, 첫 차 평론: ${rs.map((r) => r.firstReview?.toFixed(1)).join(',')}, 회수 개월: ${rs.map((r) => r.firstPayback).join(',')}, 10년 뒤 현금(억): ${rs.map((r) => Math.round(r.cash / 10000)).join(',')}`);
    expect(alive).toBeGreaterThanOrEqual(14);
  });
  it('첫 차가 평론 5~6점대면 24개월 안에 개발비를 회수한다', () => {
    // 평론 5~6점대를 내려고 설계 16주(나머지는 신중과 같음)로 돌린다
    const rs = SEEDS.map((s) => runBot(steady({ designWeeks: 16 }), s, 3)).filter((r) => r.firstReview !== null && r.firstReview >= 5 && r.firstReview < 7);
    console.log(`평론 5~6점대 ${rs.length}판, 회수 개월: ${rs.map((r) => `${r.firstReview!.toFixed(1)}→${r.firstPayback}`).join(', ')}`);
    expect(rs.length).toBeGreaterThanOrEqual(10);
    for (const r of rs) { expect(r.firstPayback).not.toBeNull(); expect(r.firstPayback!).toBeLessThanOrEqual(24); }
  });
});
