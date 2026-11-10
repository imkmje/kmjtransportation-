import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { SCENARIOS, scenarioById, cityById } from '../src/data';

const open = (g: Game, a: string, b: string, weekly: number) => {
  const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error);
  const r = g.assign(g.state.planes[0].id, o.routeId, weekly); if (!r.ok) throw new Error(r.error);
  return o.routeId;
};

describe('시나리오·시작 도시·난이도', () => {
  it('시나리오 4개: ID 중복 없고, 시작 도시·기종·목표가 유효하다', () => {
    expect(SCENARIOS.length).toBe(4);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) { expect(s.goals.length).toBeGreaterThan(0); expect(s.timeLimit).toBeGreaterThan(0); if (s.base) expect(() => cityById(s.base!)).not.toThrow(); }
    expect(scenarioById('없는 것').id).toBe('free'); // 모르는 ID는 자유 경영
  });
  it('기본 시작(new Game(seed))은 자유 경영·서울·보통이고 현금 20', () => {
    const g = new Game(1);
    expect(g.state.scenario).toBe('free'); expect(g.state.base).toBe('ICN'); expect(g.state.difficulty).toBe('normal'); expect(g.state.cash).toBe(20);
  });
  it('시작 도시를 고를 수 있고, 고정된 시나리오는 선택을 무시한다', () => {
    const a = new Game(1, undefined, { base: 'JFK' }); expect(a.state.base).toBe('JFK');
    const b = new Game(1, undefined, { scenario: 'europe', base: 'JFK' }); expect(b.state.base).toBe('FRA');
    const c = new Game(1, undefined, { base: '없는도시' }); expect(c.state.base).toBe('ICN');
  });
  it('난이도: 쉬움은 현금이 많고 어려움은 적으며, 사건 빈도·이율·고정비가 달라진다', () => {
    const e = new Game(1, undefined, { difficulty: 'easy' }), n = new Game(1), h = new Game(1, undefined, { difficulty: 'hard' });
    expect(e.state.cash).toBe(30); expect(n.state.cash).toBe(20); expect(h.state.cash).toBe(14);
    expect(h.fixedMonthly).toBeGreaterThan(n.fixedMonthly); expect(e.fixedMonthly).toBeLessThan(n.fixedMonthly);
    e.borrow(5); n.borrow(5); h.borrow(5);
    expect(h.loanRate).toBeGreaterThan(n.loanRate); expect(e.loanRate).toBeLessThan(n.loanRate);
    expect(h.state.competitors[0].cash).toBeGreaterThan(n.state.competitors[0].cash);
    // 어려운 쪽이 사건이 더 자주 일어난다(같은 시드로 5년)
    let ev = (g: Game) => { g.advanceDays(30 * 60); return g.state.log.filter((l) => /개월차/.test(l)).length; };
    const he = ev(new Game(3, undefined, { difficulty: 'hard' })), ee = ev(new Game(3, undefined, { difficulty: 'easy' }));
    expect(he).toBeGreaterThanOrEqual(ee);
  });
  it('시나리오 시작 조건: 감염병 위기는 사건·불황·대출이 이미 있고, 저가 도전은 현금이 적고 작은 비행기(A220)로 시작한다', () => {
    const c = new Game(1, undefined, { scenario: 'crisis' });
    expect(c.state.events.some((e) => e.def === 'pandemic')).toBe(true); expect(c.state.economy).toBeLessThan(0.9); expect(c.state.loan).toBe(10); expect(c.state.cash).toBe(35);
    const l = new Game(1, undefined, { scenario: 'lowcost' });
    expect(l.state.base).toBe('PUS'); expect(l.state.planes[0].type).toBe('A220'); expect(l.state.cash).toBe(15);
  });
});

describe('목표 판정과 점수', () => {
  it('자유 경영: 누적 이익 목표 또는 도시 수 목표 중 하나면 승리', () => {
    const g = new Game(1); open(g, 'ICN', 'CJU', 20);
    g.state.cumProfit = 130; g.advanceDays(30);
    expect(g.state.status).toBe('won');
    const p = g.goalProgress(); expect(p.some((x) => x.done)).toBe(true);
  });
  it('유럽 허브: 지정 도시 목표(6곳)를 채우면 승리, 목표 진행이 표시된다', () => {
    const g = new Game(1, undefined, { scenario: 'europe' });
    expect(g.goalProgress()[0]).toMatchObject({ target: 6, value: 0, done: false });
    g.state.cash = 400;
    // 프랑크푸르트에서 다른 유럽·중동 도시로 노선을 열어 항공기 배정
    const ids = ['LHR', 'CDG', 'IST', 'SVO', 'CAI', 'DXB'];
    for (const [i, c] of ids.entries()) {
      const plane = i === 0 ? g.state.planes[0] : (() => { const b = g.buyPlane('B737'); if (!b.ok) throw new Error(b.error); return g.plane(b.planeId)!; })();
      const o = g.openRoute('FRA', c); if (!o.ok) throw new Error(o.error);
      let w = 4, res = g.assign(plane.id, o.routeId, w);
      while (!res.ok && res.error.includes('슬롯')) { g.buySlot('FRA'); g.buySlot(c); res = g.assign(plane.id, o.routeId, w); }
      if (!res.ok) throw new Error(res.error);
    }
    expect(g.goalProgress()[0].value).toBe(7); // FRA + 6개 도시
    g.advanceDays(30);
    expect(g.state.status).toBe('won');
  });
  it('저가 도전: 지난달 탑승객이 목표에 닿으면 승리(기록 탑승객 기준)', () => {
    const g = new Game(1, undefined, { scenario: 'lowcost' });
    g.state.history.push({ month: 1, revenue: 1, cost: 1, depreciation: 0, fixed: 0, interest: 0, cargo: 0, profit: 0, pax: 130000, seats: 150000, loadFactor: 0.8, cash: 1 });
    expect(g.goalProgress()[0].done).toBe(true);
  });
  it('감염병 위기: 18개월을 버티고 누적 이익 $20M이면 승리, 아니면 시간 초과', () => {
    const g = new Game(1, undefined, { scenario: 'crisis' });
    g.state.cumProfit = 300; g.state.cash = 500; g.advanceDays(30 * 18);
    expect(g.state.status).toBe('won'); expect(g.monthsPassed).toBe(18);
    const h = new Game(1, undefined, { scenario: 'crisis' }); h.state.cash = 500; h.advanceDays(30 * 19);
    expect(h.state.status).toBe('timeup');
  });
  it('점수: 이익·도시·승리에 가산되고 파산·대출에 감산되며 난이도 배수를 곱한다', () => {
    const n = new Game(1), h = new Game(1, undefined, { difficulty: 'hard' }), e = new Game(1, undefined, { difficulty: 'easy' });
    for (const g of [n, h, e]) { g.state.cumProfit = 50; g.state.cash = 30; }
    expect(h.score).toBeGreaterThan(n.score); expect(e.score).toBeLessThan(n.score);
    const before = n.score; n.state.status = 'won'; expect(n.score).toBe(before + config.score.win);
    n.state.status = 'bankrupt'; expect(n.score).toBeLessThan(before);
    expect(new Game(1).score).toBe(Math.round(config.start.reputation * 0) + Math.round(20 * config.score.cash)); // 시작 현금 20 × 2
  });
});

describe('저장 형식 5', () => {
  it('형식 4 파일은 서울·보통·자유 경영으로 변환된다', () => {
    const g = new Game(4); open(g, 'ICN', 'CJU', 20); g.advanceDays(40);
    const v4 = JSON.parse(JSON.stringify(g.toJSON())); v4.formatVersion = 4; delete v4.base; delete v4.difficulty; delete v4.scenario;
    const back = Game.fromJSON(v4);
    expect(back.state.formatVersion).toBe(7); expect(back.state.base).toBe('ICN'); expect(back.state.difficulty).toBe('normal'); expect(back.state.scenario).toBe('free');
    back.advanceDays(30); expect(back.state.status).toBe('playing');
  });
});
