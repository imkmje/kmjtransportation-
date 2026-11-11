import { describe, it, expect } from 'vitest';
import { config } from '../src/config';
import { Game } from '../src/sim/game';
import { newspaper } from '../src/sim/report';
import { ACHIEVEMENTS } from '../src/sim/achievements';

const sandbox = (seed = 3, extra = {}) => { const g = new Game(seed, undefined, { sandbox: true, ...extra }); g.state.cash = 99999; return g; };
const months = (g: Game, n: number) => g.advanceDays(30 * n);
const open = (g: Game, a: string, b: string) => { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); return o.routeId; };

describe('연대기와 연말 신문', () => {
  it('이정표·업적·연말 결산·경쟁사 소식이 개월차와 함께 남고, 같은 이정표는 한 번만 남는다', () => {
    const g = sandbox(); const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 14);
    for (let i = 0; i < 4; i++) { const o = open(g, 'ICN', ['PEK', 'HKG', 'PVG', 'TPE'][i]); const b = g.buyForRoute(o, 'B737', 'new'); if (!b.ok) throw new Error(b.error); }
    months(g, 26);
    const c = g.state.chronicle, kinds = new Set(c.map((e) => e.kind));
    for (const k of ['milestone', 'achievement', 'year', 'major']) expect(kinds.has(k)).toBe(true);
    const keys = c.map((e) => e.key).filter(Boolean); expect(new Set(keys).size).toBe(keys.length);
    expect(c.filter((e) => e.kind === 'year').map((e) => e.m)).toEqual([12, 24]);
    expect(c.every((e) => e.m >= 0 && e.text.length > 0)).toBe(true);
    for (let i = 1; i < c.length; i++) expect(c[i].m).toBeGreaterThanOrEqual(c[i - 1].m - 1); // 시간 순서(같은 달의 앞뒤 1개월 오차까지)
    expect(c.length).toBeLessThanOrEqual(400);
  });
  it('연말 결산 기록에 숫자가 들어 있다', () => {
    const g = sandbox(); open(g, 'ICN', 'NRT'); months(g, 12);
    const y = g.state.chronicle.find((e) => e.kind === 'year')!; expect(y.m).toBe(12);
    for (const k of ['profit', 'pax', 'revenue', 'planes', 'cities', 'rank', 'total']) expect(typeof y.d![k]).toBe('number');
    expect(y.d!.total).toBe(g.state.competitors.length + 1);
  });
  it('신문: 연말 결산이 있는 해만 만들고, 머리기사·소식·숫자·한마디가 채워진다', () => {
    const g = sandbox(); const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 14); months(g, 24);
    expect(newspaper(g, 3)).toBeNull(); expect(newspaper(g, 0)).toBeNull();
    const p = newspaper(g, 1)!; expect(p.year).toBe(1); expect(p.headline.length).toBeGreaterThan(5); expect(p.numbers.length).toBe(6); expect(p.quote).toContain('—');
    expect(p.subs.length).toBeLessThanOrEqual(4); expect(newspaper(g, 2)!.headline.length).toBeGreaterThan(5);
    expect(newspaper(g, 1)).toEqual(p); // 같은 입력이면 같은 신문
  });
  it('신문 머리기사: 순위가 오르면 도약, 1위가 되면 1위 소식', () => {
    const g = sandbox(); g.state.chronicle = [
      { m: 12, kind: 'year', text: '1년차', d: { profit: 10, pax: 1000, revenue: 50, planes: 3, cities: 3, rank: 4, total: 5 } },
      { m: 24, kind: 'year', text: '2년차', d: { profit: 30, pax: 2000, revenue: 90, planes: 5, cities: 4, rank: 2, total: 6 } },
      { m: 36, kind: 'year', text: '3년차', d: { profit: 60, pax: 3000, revenue: 140, planes: 7, cities: 6, rank: 1, total: 6 } },
      { m: 40, kind: 'rival', text: '한바다항공 파산' }, { m: 40, kind: 'milestone', text: '누적 이익 $100M 달성' },
    ];
    expect(newspaper(g, 2)!.headline).toContain('4위에서 2위로 도약'); expect(newspaper(g, 3)!.headline).toContain('1위로 올라서다');
    g.state.chronicle.push({ m: 48, kind: 'year', text: '4년차', d: { profit: 80, pax: 1, revenue: 1, planes: 1, cities: 1, rank: 1, total: 6 } }, { m: 44, kind: 'rival', text: '한바다항공 파산' });
    const p4 = newspaper(g, 4)!; expect(p4.headline).toContain('끝내 파산'); expect(p4.subs.some((x) => x.text.includes('1위를 지킨'))).toBe(true);
  });
  it('옛 저장 파일: 이미 이룬 업적은 조용히 처리되어 연대기에 거짓 날짜로 남지 않는다', () => {
    const g = sandbox(); const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 14); months(g, 5);
    const old = g.toJSON() as unknown as Record<string, unknown>; old.formatVersion = 12; delete old.chronicle; delete old.hubs;
    const back = Game.fromJSON(old); expect(back.state.chronicle.every((e) => e.kind === 'old')).toBe(true); expect(back.state.chronicle.some((e) => e.key === 'ach:first')).toBe(true);
    months(back, 2); expect(back.state.chronicle.filter((e) => e.key === 'ach:first').length).toBe(1);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(18);
  });
});

describe('허브 투자', () => {
  const setup = () => { const g = sandbox(); const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 7); return { g, rid }; };
  it('터미널: 슬롯이 늘고 지연이 줄며, 단계마다 비싸지고 3단계까지', () => {
    const { g, rid } = setup(); const cap = g.slotCapacity('ICN'), pen0 = g.routeOtp(g.route(rid)!);
    expect(g.hubPrice('ICN', 'terminal')).toBe(config.invest.terminal.prices[0]);
    const cash = g.state.cash; expect(g.buyHub('ICN', 'terminal').ok).toBe(true); expect(cash - g.state.cash).toBe(config.invest.terminal.prices[0]);
    expect(g.slotCapacity('ICN')).toBe(cap + config.invest.terminal.slots); expect(g.hubPrice('ICN', 'terminal')).toBe(config.invest.terminal.prices[1]);
    g.state.planes[0].weekly = 7; expect(g.routeOtp(g.route(rid)!)).toBeGreaterThanOrEqual(pen0);
    expect(g.buyHub('ICN', 'terminal').ok).toBe(true); expect(g.buyHub('ICN', 'terminal').ok).toBe(true);
    const full = g.buyHub('ICN', 'terminal'); expect(full.ok).toBe(false); if (!full.ok) expect(full.error).toContain('최고 단계'); expect(g.hubPrice('ICN', 'terminal')).toBeNull();
  });
  it('터미널은 혼잡한 공항의 지연을 줄인다', () => {
    const { g, rid } = setup(); const r = g.route(rid)!; g.state.planes[0].weekly = 21; g.state.slots['ICN'] = 0; g.state.slots['NRT'] = 0;
    const cap = Math.min(g.slotCapacity('ICN'), g.slotCapacity('NRT')); const p = g.buyPlane('B737'); if (!p.ok) throw new Error(p.error);
    for (let w = 22; w >= 1; w--) if (g.assign(p.planeId, rid, w).ok) break; // 한도까지 채운다
    const before = g.routeOtp(r); expect(before).toBeLessThan(1); expect(cap).toBeGreaterThan(0);
    g.buyHub('ICN', 'terminal'); g.buyHub('NRT', 'terminal'); expect(g.routeOtp(r)).toBeGreaterThan(before);
  });
  it('정비 기지: 그 도시를 오가는 항공기의 정비 상태가 덜 닳는다', () => {
    const a = setup().g, b = setup().g; b.buyHub('ICN', 'mro'); months(a, 1); months(b, 1);
    const wear = (g: Game) => 1 - g.state.planes[0].cond; expect(wear(b)).toBeCloseTo(wear(a) * (1 - config.invest.mro.decay), 9);
  });
  it('라운지: 비즈니스 수요가 늘고 일반석 수요는 그대로', () => {
    const { g, rid } = setup(); g.setCabin(g.state.planes[0].id, 0.2); const r = g.route(rid)!, d0 = g.routeDay(r);
    g.buyHub('ICN', 'lounge'); const d1 = g.routeDay(r);
    expect(d1.demandB).toBeCloseTo(d0.demandB * (1 + config.invest.lounge.biz / 2), 9); expect(d1.demandE).toBeCloseTo(d0.demandE, 9);
    g.buyHub('NRT', 'lounge'); expect(g.routeDay(r).demandB).toBeCloseTo(d0.demandB * (1 + config.invest.lounge.biz), 9);
  });
  it('투자하면 매달 운영비가 든다', () => {
    const { g } = setup(); const fixed = g.fixedMonthly; g.buyHub('ICN', 'terminal'); g.buyHub('ICN', 'mro'); g.buyHub('NRT', 'lounge');
    expect(g.hubUpkeep).toBeCloseTo(3 * config.investUpkeep, 9); expect(g.fixedMonthly - fixed).toBeCloseTo(3 * config.investUpkeep * g.mods.fixed, 9);
  });
  it('조건: 취항했거나 출발 도시여야 하고, 운수권·현금이 있어야 하며, 잘못된 입력은 거절', () => {
    const { g } = setup(); const far = g.buyHub('JFK', 'mro'); expect(far.ok).toBe(false); if (!far.ok) expect(far.error).toContain('취항');
    expect(g.buyHub('ICN', 'upkeep' as never).ok).toBe(false); expect(g.buyHub('없음', 'mro').ok).toBe(false);
    g.state.cash = 1; const broke = g.buyHub('ICN', 'terminal'); expect(broke.ok).toBe(false); if (!broke.ok) expect(broke.error).toContain('현금');
    const gated = new Game(3, undefined, { sandbox: true, rights: true }); gated.state.cash = 999; expect(gated.buyHub('ICN', 'terminal').ok).toBe(true); // 출발 도시는 취항 전에도 가능
    expect(gated.buyHub('BKK', 'terminal').ok).toBe(false);
  });
  it('저장·불러오기 후에도 투자가 유지된다', () => {
    const { g } = setup(); g.buyHub('ICN', 'terminal'); const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(back.hubLevel('ICN', 'terminal')).toBe(1); expect(back.slotCapacity('ICN')).toBe(g.slotCapacity('ICN'));
    expect(g.state.chronicle.some((e) => e.kind === 'invest')).toBe(true);
  });
});
