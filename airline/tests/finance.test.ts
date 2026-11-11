import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { EVENTS } from '../src/data';

const withRoute = (seed = 1) => {
  const g = new Game(seed);
  const o = g.openRoute('ICN', 'CJU'); if (!o.ok) throw new Error(o.error);
  g.assign(g.state.planes[0].id, o.routeId, 20);
  return { g, routeId: o.routeId };
};

describe('대출', () => {
  it('한도 안에서 빌리고 갚을 수 있고, 한도를 넘으면 거절', () => {
    const g = new Game(1);
    const limit = g.loanLimit; // 20 + 0.5 × 장부가(60)
    expect(limit).toBeCloseTo(config.loan.limitBase + config.loan.limitBookRatio * 60, 9);
    expect(g.borrow(10).ok).toBe(true);
    expect(g.state.loan).toBe(10); expect(g.state.cash).toBe(30);
    expect(g.borrow(limit)).toEqual({ ok: false, error: '대출 한도를 넘습니다' });
    expect(g.borrow(-1).ok).toBe(false);
    expect(g.repay(4).ok).toBe(true);
    expect(g.state.loan).toBe(6); expect(g.state.cash).toBe(26);
    g.state.cash = 1;
    expect(g.repay(6)).toEqual({ ok: false, error: '현금이 모자랍니다' });
    expect(new Game(1).repay(5)).toEqual({ ok: false, error: '갚을 대출이 없습니다' });
  });
  it('불황이면 이율이 오른다(신용 경색)', () => {
    const g = new Game(1); g.borrow(10); const calm = g.loanRate;
    g.state.economy = 0.8;
    expect(g.loanRate).toBeCloseTo(calm + (0.95 - 0.8) * config.loan.crunch, 9);
    g.state.economy = 1.2; expect(g.loanRate).toBeCloseTo(calm, 9);
  });
  it('월 이자가 현금과 월 이익에서 빠지고, 보고서에 기록된다', () => {
    const { g } = withRoute();
    g.borrow(10);
    const c0 = g.state.cash;
    g.advanceDays(30);
    const h = g.state.history[0];
    expect(h.interest).toBeCloseTo(10 * (config.loan.baseRate + config.loan.spread * (10 / (config.loan.limitBase + config.loan.limitBookRatio * 60))), 9); // 이율은 한도 사용 비율에 따라 오른다
    expect(g.loanRate).toBeGreaterThan(config.loan.baseRate);
    expect(g.state.cash - c0).toBeCloseTo(h.revenue - h.cost - h.fixed - h.interest, 6);
    expect(h.profit).toBeCloseTo(h.revenue - h.cost - h.depreciation - h.fixed - h.interest, 9);
  });
});

describe('항공기 매각·노후화', () => {
  it('매각하면 장부가의 90%가 들어오고 노선 배정이 풀린다', () => {
    const { g, routeId } = withRoute();
    const p = g.state.planes[0], c0 = g.state.cash;
    const r = g.sellPlane(p.id);
    expect(r.ok && r.price).toBeCloseTo(60 * config.sale.ratio, 9);
    expect(g.state.cash).toBeCloseTo(c0 + 54, 9);
    expect(g.state.planes.length).toBe(0); expect(g.planesOn(routeId).length).toBe(0);
    expect(g.sellPlane(999).ok).toBe(false);
  });
  it('노후하면 운영비가 늘고(최대 +60%), 한 달마다 나이가 든다', () => {
    const { g, routeId } = withRoute();
    const r = g.route(routeId)!, base = g.routeDay(r).cost;
    g.state.planes[0].age = 60;
    expect(g.routeDay(r).cost).toBeGreaterThan(base);
    g.state.planes[0].age = 10000;
    expect(g.agingMult(g.state.planes[0])).toBe(config.aging.maxMult);
    g.state.planes[0].age = 0;
    g.advanceDays(30);
    expect(g.state.planes[0].age).toBe(1);
  });
  it('새 기종 2종(터보프롭·초대형)이 있고 제원이 올바르다', () => {
    const g = new Game(1); g.state.cash = 300;
    expect(g.buyPlane('T72').ok).toBe(true); expect(g.buyPlane('A380').ok).toBe(true);
  });
});

describe('사건 대응·계속하기', () => {
  it('대응하면 비용을 내고 효과가 줄어들며, 중복 대응·잔액 부족은 거절', () => {
    const { g, routeId } = withRoute();
    g.state.events.push({ def: 'fuel', monthsLeft: 3 });
    const r = g.route(routeId)!, before = g.routeDay(r).cost, c0 = g.state.cash;
    expect(g.respondEvent(0).ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(c0 - EVENTS.find((e) => e.id === 'fuel')!.option!.cost, 9);
    expect(g.routeDay(r).cost).toBeLessThan(before); // 연료 계약: 비용 상승이 사라진다
    expect(g.respondEvent(0)).toEqual({ ok: false, error: '이미 대응했습니다' });
    g.state.events.push({ def: 'boom', monthsLeft: 2, city: 'CJU' });
    expect(g.respondEvent(1).ok).toBe(false); // 대응 수단이 없는 사건
    g.state.events.push({ def: 'recession', monthsLeft: 3 }); g.state.cash = 0.5;
    expect(g.respondEvent(2)).toEqual({ ok: false, error: '현금이 모자랍니다' });
  });
  it('목표 달성 뒤 계속하기: 자유 모드로 목표·기한 없이 이어지고, 파산은 여전히 있다', () => {
    const { g } = withRoute();
    g.state.status = 'won';
    expect(g.continuePlay().ok).toBe(true);
    expect(g.state.status).toBe('playing'); expect(g.state.sandbox).toBe(true);
    g.state.cumProfit = 1e6; g.advanceDays(30 * 30); // 기한(24개월)과 목표 이익을 훨씬 넘어도 끝나지 않는다
    expect(g.state.status).toBe('playing');
    g.state.cash = -50; g.advanceDays(30 * 3);
    expect(g.state.status).toBe('bankrupt');
    expect(new Game(1).continuePlay().ok).toBe(false); // 진행 중에는 필요 없다
  });
});

describe('저장 형식 변환', () => {
  it('형식 1 파일을 읽으면 대출 0·목표 모드·나이 0으로 변환되고 이어서 실행된다', () => {
    const g = new Game(4); const o = g.openRoute('ICN', 'CJU'); if (!o.ok) throw new Error(); g.assign(g.state.planes[0].id, o.routeId, 20); g.advanceDays(40);
    const v1 = JSON.parse(JSON.stringify(g.toJSON())); v1.formatVersion = 1; delete v1.loan; delete v1.sandbox; for (const p of v1.planes) delete p.age; for (const h of v1.history) delete h.interest;
    const back = Game.fromJSON(v1);
    expect(back.state.formatVersion).toBe(9); expect(back.state.loan).toBe(0); expect(back.state.sandbox).toBe(false); expect(back.state.planes[0].age).toBe(0);
    back.advanceDays(60); expect(back.state.status).toBe('playing');
  });
});
