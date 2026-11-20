import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { loanLimit, loanRate } from '../src/sim/finance';
import { config } from '../src/config';
import { toMonthEnd } from './util';

describe('재무(9.4)', () => {
  it('월말 고정비: 월급 + 공장 유지비 + 본사 유지비', () => {
    const g = Game.create({ seed: 1 });
    toMonthEnd(g);
    const l = g.state.ledger[0], salary = g.state.staff.reduce((a, s) => a + 250 + 12 * s.ability, 0);
    expect(l.salaries).toBe(salary); expect(l.upkeep).toBe(5000 + config.hq.upkeep);
    expect(l.profit).toBe(-(salary + l.upkeep)); expect(g.state.cash).toBe(config.start.cash + l.profit);
  });
  it('장부는 최근 24개월만 남긴다', () => {
    const g = Game.create({ seed: 1 }); g.state.cash = 1e9;
    for (let i = 0; i < 48 * 3; i++) g.tick();
    expect(g.state.ledger.length).toBe(24);
    expect(g.state.ledger[23].month).toBe(35);
  });
  it('대출 한도 = 20억 + 최근 12개월 매출 × 0.3, 넘으면 거부', () => {
    const g = Game.create({ seed: 1 });
    expect(loanLimit(g.state)).toBe(200000);
    expect(g.command({ type: 'borrow', amount: 200001 })).toEqual({ ok: false, reason: '대출 한도를 넘습니다.' });
    expect(g.command({ type: 'borrow', amount: 0 })).toEqual({ ok: false, reason: '빌릴 금액이 올바르지 않습니다.' });
    expect(g.command({ type: 'borrow', amount: 150000 }).ok).toBe(true);
    expect(g.state.cash).toBe(config.start.cash + 150000); expect(g.state.loan.balance).toBe(150000);
    expect(g.command({ type: 'borrow', amount: 60000 }).ok).toBe(false);
    g.state.ledger.push({ month: 0, year: 1970, monthOfYear: 1, revenue: 100000, cogs: 0, salaries: 0, upkeep: 0, dev: 0, marketing: 0, interest: 0, recall: 0, profit: 0, cash: 0, sold: 0 });
    expect(loanLimit(g.state)).toBe(230000);
  });
  it('월 이율 0.6%, 한도의 70%를 넘게 쓰면 1.0%', () => {
    const g = Game.create({ seed: 1 });
    g.command({ type: 'borrow', amount: 100000 });
    expect(loanRate(g.state)).toBe(0.006);
    toMonthEnd(g);
    expect(g.state.ledger[0].interest).toBeCloseTo(600, 9);
    g.command({ type: 'borrow', amount: 50000 });
    expect(loanRate(g.state)).toBe(0.01);
  });
  it('상환: 남은 대출과 현금 안에서만', () => {
    const g = Game.create({ seed: 1 });
    g.command({ type: 'borrow', amount: 1000 });
    expect(g.command({ type: 'repay', amount: 2000 })).toEqual({ ok: false, reason: '남은 대출보다 많이 갚을 수 없습니다.' });
    expect(g.command({ type: 'repay', amount: 1000 }).ok).toBe(true);
    expect(g.state.loan.balance).toBe(0); expect(g.state.cash).toBe(config.start.cash);
    g.command({ type: 'borrow', amount: 1000 }); g.state.cash = 10;
    expect(g.command({ type: 'repay', amount: 1000 })).toEqual({ ok: false, reason: '현금이 모자랍니다.' });
  });
  it('파산: 현금 음수로 6개월 연속이면 게임 오버, 이후 진행·명령 불가', () => {
    const g = Game.create({ seed: 1 }); g.state.cash = -1;
    const kinds: string[] = [];
    for (let m = 0; m < 6; m++) { let ev; do ev = g.tick(); while (!ev.some((e) => e.kind === 'monthEnd')); kinds.push(...ev.map((e) => e.kind)); }
    expect(kinds.filter((k) => k === 'cashWarning').length).toBe(5);
    expect(kinds.at(-1)).toBe('gameOver');
    expect(g.state.status).toBe('gameOver');
    const w = g.state.week;
    expect(g.tick()).toEqual([]); expect(g.state.week).toBe(w);
    expect(g.command({ type: 'borrow', amount: 1 })).toEqual({ ok: false, reason: '게임이 끝났습니다.' });
  });
  it('현금이 다시 양수가 되면 연속 기록이 끊긴다', () => {
    const g = Game.create({ seed: 1 }); g.state.cash = -1;
    for (let i = 0; i < 4 * 5; i++) g.tick();
    expect(g.state.negMonths).toBe(5);
    g.state.cash = 1e6; toMonthEnd(g);
    expect(g.state.negMonths).toBe(0);
  });
  it('구제 금융: 한 판에 1회, 현금 음수일 때만, 현금 0·평판 −20·대출 한도 절반', () => {
    const g = Game.create({ seed: 1 });
    expect(g.command({ type: 'bailout' })).toEqual({ ok: false, reason: '현금이 마이너스일 때만 받을 수 있습니다.' });
    g.state.cash = -5000; g.state.negMonths = 4; g.state.reputation = 50;
    expect(g.command({ type: 'bailout' }).ok).toBe(true);
    expect(g.state.cash).toBe(0); expect(g.state.negMonths).toBe(0); expect(g.state.reputation).toBe(30);
    expect(loanLimit(g.state)).toBe(100000);
    g.state.cash = -1;
    expect(g.command({ type: 'bailout' })).toEqual({ ok: false, reason: '구제 금융은 한 번만 받을 수 있습니다.' });
  });
  it('파산 뒤 구제 금융(9.4): 게임 오버에서도 1회 받으면 다시 진행된다(현금 0·평판 −20·한도 절반·연속 적자 초기화)', () => {
    const g = Game.create({ seed: 1 }); g.state.cash = -1; g.state.reputation = 50;
    while (g.state.status === 'playing') g.tick();
    const w = g.state.week, ledger = g.state.ledger.length;
    expect(g.state.negMonths).toBe(config.bankruptcy.months);
    expect(g.command({ type: 'bailout' }).ok).toBe(true);
    expect(g.state.status).toBe('playing'); expect(g.state.cash).toBe(0); expect(g.state.negMonths).toBe(0);
    expect(g.state.reputation).toBe(30); expect(loanLimit(g.state)).toBe(100000);
    expect(g.state.week).toBe(w + 1); // 파산한 달의 정산을 두 번 하지 않는다
    toMonthEnd(g);
    expect(g.state.ledger.length).toBe(ledger + 1);
    expect(g.state.negMonths).toBe(1); // 월급만 나가므로 다시 적자 1개월째
    g.state.cash = -1;
    while ((g.state.status as string) === 'playing') g.tick();
    expect(g.command({ type: 'bailout' })).toEqual({ ok: false, reason: '구제 금융은 한 번만 받을 수 있습니다.' });
    expect(g.state.status).toBe('gameOver');
  });
});
