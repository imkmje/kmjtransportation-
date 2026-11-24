// 3.6.0 안정화: 인수 창의 본사 판매 변화, 대응 신차 예고 알림 줄이기, 인수 브랜드 매각 뒤 경쟁사 복귀, sim 문장 금액 표기, 연구 효과 캐시
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { steadyBestExec } from '../src/sim/bots';
import { activeRivals, isOut } from '../src/sim/rivals';
import { acquireInfo, rivalRelations } from '../src/sim/rivalry';
import { won } from '../src/sim/won';
import { costCut } from '../src/sim/research';
import { SPEC, grant, ok, toMonthEnd } from './util';
import { carBasePrice } from '../src/sim/market';
import type { CarState } from '../src/sim/types';

vi.setConfig({ testTimeout: 600_000 });
const load = () => Game.fromJSON(JSON.parse(readFileSync('car/tests/fixtures/save-v9.json', 'utf8')));
const clone = (g: Game) => Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));

describe('3.6.0 인수 창: 본사 판매 변화 예상', () => {
  it('인수 전/후 본사 월 판매를 같은 계산으로 보이고, 인수하면 다음 달 본사 판매가 실제로 그만큼 는다(±3%)', () => {
    const g = load(), s = g.state; s.cash = 1e10;
    while (s.week % 4 !== 0) g.tick();
    const a = acquireInfo(s, 'toyoda')!;
    expect(a.hqMonthlyAfter).toBeGreaterThan(a.hqMonthly); // 빈 몫 일부를 본사 차가 가져간다
    expect(a.hqYearProfit).toBeGreaterThan(0);
    const b = clone(g);
    ok(g.command({ type: 'acquireRival', rivalId: 'toyoda' }));
    toMonthEnd(g); toMonthEnd(b);
    const d = g.state.ledger.at(-1)!.sold - b.state.ledger.at(-1)!.sold, est = a.hqMonthlyAfter - a.hqMonthly;
    expect(Math.abs(d - est) / Math.max(1, b.state.ledger.at(-1)!.sold)).toBeLessThan(0.03);
  });
});

describe('3.6.0 인수 브랜드 매각', () => {
  it('인수 브랜드를 팔면 그 회사가 경쟁사로 돌아오고(인수됨 해제) 라인업이 그대로 있으며, 다시 인수할 수 있다', () => {
    const g = load(), s = g.state; s.cash = 1e10;
    const id = activeRivals(s)[0].id, n0 = activeRivals(s).length;
    ok(g.command({ type: 'acquireRival', rivalId: id }));
    expect(isOut(s, id)).toBe(true);
    for (let i = 0; i < 12; i++) g.tick();
    const sub = s.subs!.find((x) => x.from === id)!, bodies = Object.keys(s.rivals.find((r) => r.id === id)!.models).sort();
    ok(g.command({ type: 'sellSubsidiary', subId: sub.id }));
    expect(isOut(s, id)).toBe(false); expect(activeRivals(s).length).toBe(n0);
    expect(rivalRelations(s).find((r) => r.id === id)!.out).toBe(false);
    expect(Object.keys(s.rivals.find((r) => r.id === id)!.models).sort()).toEqual(bodies);
    expect(s.events.news.at(-1)!.text).toContain('다시 독립 경쟁사가 됩니다');
    expect(acquireInfo(s, id)!.reason).toBeNull();
  });
  it('상장한 인수 브랜드를 팔아도 경쟁사로 돌아오고 매각 대금은 본사 지분만큼', () => {
    const g = load(), s = g.state; s.cash = 1e10;
    const id = activeRivals(s)[1].id;
    ok(g.command({ type: 'acquireRival', rivalId: id }));
    const sub = s.subs!.find((x) => x.from === id)!; sub.listed = 0.3;
    const c0 = s.cash, price = Math.round(sub.capital * 0.7 * 0.7);
    ok(g.command({ type: 'sellSubsidiary', subId: sub.id }));
    expect(s.cash - c0).toBeCloseTo(price, -1); expect(isOut(s, id)).toBe(false);
  });
});

describe('3.6.0 대응 신차 예고 알림', () => {
  it('같은 내 차를 겨냥한 예고는 처음 한 번만 알림으로 띄우고, 뉴스에는 모두 남는다(발생 수는 그대로)', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), bot = steadyBestExec();
    let alerts = 0, all = 0;
    for (let i = 0; i < 60 * 48 && g.state.status === 'playing'; i++) {
      bot.step(g); const n0 = g.state.nextId, ev = g.tick();
      alerts += ev.filter((e) => e.text.startsWith('[대응 신차 예고]')).length;
      all += g.state.rivalry!.counters.filter((c) => c.id >= n0).length;
    }
    const told = g.state.rivalry!.told ?? [];
    console.log(`60년: 예고 ${all}건 중 알림 ${alerts}건(겨냥한 차 ${told.length}대)`);
    expect(alerts).toBe(told.length); expect(new Set(told).size).toBe(told.length);
    expect(all).toBeGreaterThanOrEqual(30); // 발생은 그대로(3.5.0 측정 약 40번)
    expect(alerts).toBeLessThan(all / 2);
    expect(g.state.events.news.at(-1)).toBeDefined();
  });
});

describe('3.6.0 가격 전쟁 결정 창 문장', () => {
  it('이 차급 내 차 판매가 거의 없으면 "한 달 매출이 약 0만원 줄어듭니다" 대신 매출이 거의 줄지 않는다고 쓴다', () => {
    const g = Game.create({ seed: 7, difficulty: 'normal' }), s = g.state;
    s.week = (2005 - 1970) * 48; s.cash = 1e9; s.hqLevel = 5; s.reputation = 150; grant(g);
    ok(g.command({ type: 'startProject', ...SPEC, name: '아리아', body: 'sedanM', segment: 'family', tier: 1 }));
    const p = s.projects[0]; g.devCheat('finishDev');
    ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(s, p) * 1.3 / 10) * 10, marketing: 0, color: 'red', wheels: 0 })); // 비싸게: 거의 팔리지 않는다
    s.events.pending.length = 0;
    let pc: CarState['events']['pending'][number] | undefined;
    for (let i = 0; i < 48 * 10 && !pc; i++) { s.cash = Math.max(s.cash, 1e9); g.tick(); pc = s.events.pending.find((x) => x.eventId === 'priceWar'); }
    expect(pc, '10년 안에 가격 전쟁이 없다').toBeDefined();
    expect(pc!.rv!.results[0]).not.toMatch(/약 0만원/);
  });
});

describe('3.6.0 sim 문장 금액 표기', () => {
  it('1조 이상은 "조 억원", 음수 기호, 억 단위 소수 한 자리', () => {
    expect(won(1.2345e8)).toBe('1조 2,345억원'); expect(won(-2e8)).toBe('−2조원'); expect(won(32000)).toBe('3.2억원'); expect(won(4500)).toBe('4,500만원');
  });
});

describe('3.6.0 연구 효과 캐시', () => {
  it('연구를 마치거나 되돌리면(배열 교체) 효과가 바로 바뀐다', () => {
    const g = load(), s = g.state, c0 = costCut(s);
    const t = s.research.done.find((id) => id.length && costCut({ ...s, research: { ...s.research, done: s.research.done.filter((x) => x !== id) } }) !== c0)!;
    s.research.done = s.research.done.filter((x) => x !== t);
    expect(costCut(s)).toBeLessThan(c0);
    s.research.done.push(t);
    expect(costCut(s)).toBeCloseTo(c0, 9);
  });
});
