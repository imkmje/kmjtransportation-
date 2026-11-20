import { describe, it, expect } from 'vitest';
import { idle, runBot, steady, type Bot } from '../src/sim/bots';
import { Game, allGens } from '../src/sim/game';
import { config } from '../src/config';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };

/** 봇을 months개월 돌려 첫 차의 평론·회수 개월·출시 3~14개월 판매 중앙값과 최저 현금을 잰다 */
function firstCar(bot: Bot, seed: number, months: number) {
  const g = Game.create({ seed });
  let payback: number | null = null, minCash = Infinity;
  for (let w = 0; w < months * config.time.weeksPerMonth && g.state.status === 'playing'; w++) {
    bot.step(g); g.tick();
    minCash = Math.min(minCash, g.state.cash);
    const f = allGens(g.state)[0];
    if (f && payback === null && f.profit >= f.devCost) payback = f.sales.length;
  }
  const f = allGens(g.state)[0];
  return { review: f?.reviewAvg ?? 0, payback, plateau: f ? median(f.sales.slice(3, 15)) : 0, devCost: f?.devCost ?? 0, minCash, loan: g.state.loan.balance };
}

describe('균형 봇(시드 20개, 설계자 보정 목표 2026-11-20)', () => {
  it('개발비: 12주 설계 + 시험이면 6~12억', () => {
    const dev = median(SEEDS.map((s) => firstCar(steady(), s, 12).devCost));
    console.log(`개발비 중앙값 ${(dev / 10000).toFixed(1)}억`);
    expect(dev).toBeGreaterThanOrEqual(60000); expect(dev).toBeLessThanOrEqual(120000);
  });
  it('1) 평론 5~6점대 첫 차의 개발비 회수 중앙값 6~20개월', () => {
    const rs = SEEDS.map((s) => firstCar(steady({ designWeeks: 16 }), s, 48)).filter((r) => r.review >= 5 && r.review < 7);
    const m = median(rs.map((r) => r.payback ?? 999));
    console.log(`평론 5~6점대 ${rs.length}판, 회수 개월: ${rs.map((r) => r.payback).join(',')} → 중앙값 ${m}`);
    expect(rs.length).toBeGreaterThanOrEqual(10);
    expect(m).toBeGreaterThanOrEqual(6); expect(m).toBeLessThanOrEqual(20);
  });
  it('2) 평론 4점대 차의 월 판매(출시 3~14개월 중앙값)가 생산 상한의 25~60%', () => {
    const rs = SEEDS.map((s) => firstCar(steady(), s, 24)).filter((r) => r.review >= 4 && r.review < 5);
    const ratio = median(rs.map((r) => r.plateau)) / config.factory.capacity;
    console.log(`평론 4점대 ${rs.length}판, 월 판매: ${rs.map((r) => Math.round(r.plateau)).join(',')} → 상한 대비 ${(ratio * 100).toFixed(0)}%`);
    expect(rs.length).toBeGreaterThanOrEqual(10);
    expect(ratio).toBeGreaterThanOrEqual(0.25); expect(ratio).toBeLessThanOrEqual(0.6);
  });
  it('3) 방치는 10년 안에 전부 파산, 신중은 10년 생존율 70% 이상 / 4) 신중의 10년 뒤 현금 중앙값 30~150억', () => {
    const id = SEEDS.map((s) => runBot(idle, s, 10));
    const st = SEEDS.map((s) => runBot(steady(), s, 10));
    const alive = st.filter((r) => r.survived).length, cash = median(st.map((r) => r.cash));
    console.log(`idle 파산 개월: ${id.map((r) => r.months).join(',')}\nsteady 생존 ${alive}/20, 10년 뒤 현금(억): ${st.map((r) => Math.round(r.cash / 10000)).join(',')} → 중앙값 ${Math.round(cash / 10000)}억`);
    expect(id.every((r) => !r.survived && r.months < 120)).toBe(true);
    expect(alive).toBeGreaterThanOrEqual(14);
    expect(cash).toBeGreaterThanOrEqual(300000); expect(cash).toBeLessThanOrEqual(1500000);
  });
  it('5) 실패작(절약·8주·시험 2주로 출시, 평론 3.5 이하) 하나만 팔면 36개월 안에 현금이 음수가 되거나 대출이 필요하다', () => {
    const flop = steady({ budget: 'low', designWeeks: 8, launchDefects: Infinity, maxTestWeeks: 2, changeMonths: Infinity, faceliftMonths: Infinity });
    const rs = SEEDS.map((s) => firstCar(flop, s, 36));
    console.log(`실패작 평론: ${rs.map((r) => r.review.toFixed(1)).join(',')}, 최저 현금(억): ${rs.map((r) => Math.round(r.minCash / 10000)).join(',')}`);
    for (const r of rs) { expect(r.review).toBeLessThanOrEqual(3.5); expect(r.minCash < 0 || r.loan > 0).toBe(true); }
  });
});
