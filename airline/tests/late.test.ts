import { describe, it, expect } from 'vitest';
import { config } from '../src/config';
import { typeById } from '../src/data';
import { Game } from '../src/sim/game';
import { advise } from '../src/sim/advice';
import { achieved } from '../src/sim/achievements';
import type { Contract } from '../src/sim/types';

const sandbox = (seed = 3) => { const g = new Game(seed, undefined, { sandbox: true }); g.state.cash = 99999; return g; };
const open = (g: Game, a: string, b: string) => { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); return o.routeId; };
const months = (g: Game, n: number) => g.advanceDays(30 * n);
const major = (g: Game) => g.state.competitors.find((c) => c.major);

describe('대형 항공사', () => {
  it('9개월차 이후 한 곳만 출범하고, 내 출발 도시가 아닌 거점을 쓴다', () => {
    const g = sandbox(); months(g, 9); expect(major(g)).toBeUndefined();
    months(g, 2);
    const m = major(g)!; expect(m).toBeDefined(); expect(m.name).toBe(config.competitors.major.name); expect(m.hub).not.toBe(g.state.base); expect(m.style).toBe('premium');
    expect(g.state.log.some((l) => l.includes('대형 항공사') && l.includes('진출'))).toBe(true);
    months(g, 24); expect(g.state.competitors.filter((c) => c.major).length).toBe(1);
    const home = new Game(3, undefined, { sandbox: true, base: 'DXB' }); home.state.cash = 99999; months(home, 11); expect(major(home)!.hub).toBe('FRA'); // 내 출발 도시(두바이)는 피한다
  });
  it('파산하지 않고, 시간과 내 항공기 수에 맞춰 커지며 상한이 있다', () => {
    const g = sandbox(); months(g, 12); const m = major(g)!; m.cash = -9999; m.low = 99; months(g, 2);
    expect(major(g)).toBeDefined(); expect(g.state.log.some((l) => l.includes(m.name) && l.includes('파산'))).toBe(false);
    const before = major(g)!.planes; for (let i = 0; i < 10; i++) g.buyPlane('T72'); months(g, 12);
    expect(major(g)!.planes).toBeGreaterThan(before);
    months(g, 600); expect(major(g)!.planes).toBeLessThanOrEqual(config.competitors.major.cap);
  });
  it('내 이익이 큰 노선으로 진출하고(겹침 알림), 경매에도 입찰한다', () => {
    const k = config.competitors.major, inv = k.invadeChance, bid = k.bidChance; k.invadeChance = 1; k.bidChance = 1;
    try {
      const g = sandbox(); const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 14); months(g, 14);
      const m = major(g)!; expect(m.routes.some((r) => (r.a === 'ICN' && r.b === 'NRT') || (r.a === 'NRT' && r.b === 'ICN'))).toBe(true);
      expect(g.state.log.some((l) => l.includes(m.name) && l.includes('내 노선과 겹칩니다'))).toBe(true);
      expect(g.competitorsOn('ICN', 'NRT').some((x) => x.comp.major)).toBe(true);
      g.state.auctions.push({ id: 9999, from: '테스트', type: 'B737', price: 24, age: 60, cond: 0.75, expires: g.monthsPassed + 3 }); // 이번 달에 나온 경매
      months(g, 1); expect(g.state.auctions.some((a) => a.id === 9999)).toBe(true); // 첫 달은 우리에게 양보
      months(g, 1); expect(g.state.auctions.some((a) => a.id === 9999)).toBe(false);
      expect(g.state.log.some((l) => l.includes('경매에 나온 항공기를 낙찰받았습니다'))).toBe(true);
    } finally { k.invadeChance = inv; k.bidChance = bid; }
  });
  it('매출 순위에 포함되고 저장·불러오기 후에도 유지된다', () => {
    const g = sandbox(); months(g, 24);
    expect(g.ranking().some((x) => x.name === config.competitors.major.name)).toBe(true);
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON()))); expect(major(back)!.planes).toBe(major(g)!.planes);
  });
});

describe('시대', () => {
  it('24개월차 이후에 첫 시대가 오고, 6개월 전에 예고하며, 같은 시대가 연달아 오지 않는다', () => {
    const g = sandbox(5); const log: string[] = []; let started = 0; const seen: string[] = [];
    for (let m = 0; m < 160; m++) { const n = g.state.log.length; months(g, 1); log.push(...g.state.log.slice(n)); if (g.state.era && !seen.includes(`${g.state.era.id}@${g.state.era.start}`)) { seen.push(`${g.state.era.id}@${g.state.era.start}`); started++; } }
    expect(started).toBeGreaterThanOrEqual(2);
    const first = log.findIndex((l) => l.includes('시대 변화 예고')), firstStart = log.findIndex((l) => / 시작 — /.test(l));
    expect(first).toBeGreaterThanOrEqual(0); expect(firstStart).toBeGreaterThan(first);
    const startMonth = Number(log[firstStart].match(/^(\d+)개월차/)![1]); expect(startMonth).toBeGreaterThanOrEqual(24);
    const ids = seen.map((x) => x.split('@')[0]); for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    expect(g.state.log.some((l) => l.includes('이(가) 끝났습니다'))).toBe(true);
  });
  it('시나리오(짧은 기간)는 시대 변화를 거의 겪지 않는다: 24개월차 전에는 예고도 없다', () => {
    const g = sandbox(2); months(g, 17); expect(g.state.nextEra).toBeNull(); expect(g.state.era).toBeNull();
  });
  it('탄소세: 낡은 기체는 비싸지고 신기종은 싸진다. 소음 규제: 낡은 기체가 슬롯을 더 쓴다', () => {
    const g = sandbox(); g.state.cash = 99999; months(g, 12);
    const rid = open(g, 'ICN', 'NRT'); const old = g.state.planes[0]; old.age = config.aging.capStart + 10; g.assign(old.id, rid, 7);
    const nb = g.buyPlane('B757'); if (!nb.ok) throw new Error(nb.error); const nw = g.plane(nb.planeId)!;
    const a0 = g.agingMult(old), n0 = g.agingMult(nw), s0 = g.slotsUsed('ICN');
    g.state.era = { id: 'carbon', start: 0, end: 999 };
    expect(g.agingMult(old)).toBeCloseTo(a0 * 1.25, 9); expect(g.agingMult(nw)).toBeCloseTo(n0 * 0.92, 9);
    g.state.era = { id: 'noise', start: 0, end: 999 }; expect(g.slotsUsed('ICN')).toBeCloseTo(s0 * 1.4, 9);
    g.state.era = null; expect(g.agingMult(old)).toBeCloseTo(a0, 9);
  });
  it('유가 위기는 연료를, 호황·침체는 경기를 그 방향으로 끌어간다', () => {
    const avg = (id: string | null, key: 'fuel' | 'economy') => { let t = 0, n = 0; for (const seed of [1, 2, 3, 4]) { const g = sandbox(seed); for (let m = 0; m < 40; m++) { g.state.era = id ? { id, start: 0, end: 999 } : null; months(g, 1); t += g.state[key]; n++; } } return t / n; };
    expect(avg('oil', 'fuel')).toBeGreaterThan(avg(null, 'fuel') + 0.15);
    expect(avg('boom', 'economy')).toBeGreaterThan(avg(null, 'economy') + 0.03);
    expect(avg('slump', 'economy')).toBeLessThan(avg(null, 'economy') - 0.03);
  });
  it('시대 정의가 올바르다', () => {
    const l = config.eras.list; expect(l.length).toBe(6); expect(new Set(l.map((e) => e.id)).size).toBe(6);
    for (const e of l) { expect(e.months[0]).toBeLessThan(e.months[1]); expect(e.desc.length).toBeGreaterThan(10); }
  });
});

describe('계약 제안', () => {
  const offerOf = (g: Game) => g.state.contracts.filter((c) => c.status === 'offer');
  const mk = (over: Partial<Contract>): Contract => ({ id: 777, kind: 'profit', title: '시험 계약', goal: 10, progress: 0, limit: 3, status: 'active', expires: 99, start: 0, reward: { type: 'cash', value: 40, label: '현금 $40M' }, ...over });
  it('3개월차부터 제안이 생기고, 최대 4건이며, 기간이 지나면 사라진다. 보상은 크다', () => {
    const g = sandbox(); months(g, 2); expect(g.state.contracts.length).toBe(0);
    for (let i = 0; i < 12; i++) months(g, 1);
    expect(g.state.log.some((l) => l.includes('새 계약 제안'))).toBe(true); expect(g.state.contracts.length).toBeLessThanOrEqual(config.contract.maxTotal);
    for (const c of offerOf(g)) { expect(c.reward.value).toBeGreaterThanOrEqual(config.contract.rewardMin * 0.5); expect(c.reward.label.length).toBeGreaterThan(3); expect(c.limit).toBeGreaterThanOrEqual(3); }
    const ids = offerOf(g).map((c) => c.id); months(g, config.contract.offerMonths + 1);
    expect(g.state.contracts.some((c) => ids.includes(c.id) && c.status === 'offer')).toBe(false);
  });
  it('보상 현금은 최근 월 이익의 6배(최소 $15M)이다', () => {
    const g = sandbox(); g.state.history = Array.from({ length: 6 }, (_, i) => ({ month: i + 1, revenue: 20, cost: 5, depreciation: 0, fixed: 0, interest: 0, cargo: 0, profit: 10, pax: 1, seats: 1, loadFactor: 1, cash: 0 }));
    g.state.nextOffer = 0; months(g, 4);
    const cash = g.state.contracts.filter((c) => c.reward.type === 'cash' || c.reward.type === 'rep');
    for (const c of cash) expect(c.reward.value).toBeGreaterThanOrEqual(30); // 월 이익 10 × 6 = 60(평판 보상은 절반)
    expect(g.state.contracts.length).toBeGreaterThan(0);
  });
  it('수락·거절: 진행 중은 2건까지, 없는 계약은 거절', () => {
    const g = sandbox(); g.state.contracts = [mk({ id: 1, status: 'offer', expires: 99 }), mk({ id: 2, status: 'offer', expires: 99 }), mk({ id: 3, status: 'offer', expires: 99 })];
    expect(g.acceptContract(1).ok).toBe(true); expect(g.acceptContract(2).ok).toBe(true);
    const third = g.acceptContract(3); expect(third.ok).toBe(false); if (!third.ok) expect(third.error).toContain('2건');
    expect(g.acceptContract(1).ok).toBe(false); expect(g.acceptContract(99).ok).toBe(false);
    expect(g.declineContract(3).ok).toBe(true); expect(g.state.contracts.some((c) => c.id === 3)).toBe(false); expect(g.declineContract(1).ok).toBe(false);
  });
  it('이익 계약: 달성하면 보상을 받고 업적이 풀린다. 기한 안에 못 하면 실패(평판 소폭 하락)', () => {
    const g = sandbox(); g.state.nextOffer = 9999; const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 14);
    g.state.contracts = [mk({ goal: -1e9, limit: 3 })]; const cash = g.state.cash; months(g, 1);
    expect(g.state.contracts.length).toBe(0); expect(g.state.contractsDone).toBe(1); expect(g.state.cash).toBeGreaterThan(cash + 30); expect(achieved(g)).toContain('contract1');
    const rep = g.state.reputation; g.state.contracts = [mk({ id: 5, goal: 99999, limit: 2 })]; months(g, 3);
    expect(g.state.contracts.length).toBe(0); expect(g.state.contractsDone).toBe(1); expect(g.state.reputation).toBeLessThan(rep + 0.5); expect(g.state.log.some((l) => l.includes('계약 실패'))).toBe(true);
  });
  it('수송·정시·취항 계약의 진행도가 계산된다', () => {
    const g = sandbox(); g.state.nextOffer = 9999; const rid = open(g, 'ICN', 'NRT'); g.assign(g.state.planes[0].id, rid, 14);
    g.state.contracts = [mk({ id: 1, kind: 'pax', goal: 1e9, limit: 6, a: 'ICN', b: 'NRT' }), mk({ id: 2, kind: 'otp', goal: 3, limit: 6 }), mk({ id: 3, kind: 'cities', goal: 5, limit: 6, startCities: 0 })];
    months(g, 2);
    const by = (id: number) => g.state.contracts.find((c) => c.id === id)!;
    expect(by(1).progress).toBeGreaterThan(1000); expect(by(2).progress).toBeGreaterThanOrEqual(1); expect(by(3).progress).toBe(2); // 서울·도쿄 취항
  });
  it('보상 종류: 현금·항공기·업그레이드·운수권·평판', () => {
    const g = new Game(3, undefined, { sandbox: true, rights: true }); g.state.nextOffer = 9999; g.state.cash = 0;
    const run = (r: Contract['reward']) => { g.state.contracts = [mk({ goal: -1e9, limit: 3, reward: r })]; months(g, 1); };
    const n = g.state.planes.length; run({ type: 'plane', value: 22, plane: 'T72', label: 'x' }); expect(g.state.planes.length).toBe(n + 1);
    run({ type: 'upgrade', value: 8, upgrade: 'ops', label: 'x' }); expect(g.upgradeLevel('ops')).toBe(1);
    run({ type: 'rights', value: 6, region: 'SEA', label: 'x' }); expect(g.state.rights).toContain('SEA');
    g.state.cash = 1000; const rep = g.state.reputation; const cash = g.state.cash; run({ type: 'rep', value: 10, label: 'x' }); expect(g.state.cash).toBeGreaterThanOrEqual(cash + 10 - 8); expect(g.state.reputation).toBeGreaterThanOrEqual(rep); // 한 달 고정비가 섞인다
  });
  it('조언에 새 제안이 뜨고, 형식 11 저장 파일은 시대·계약 없음으로 읽는다', () => {
    const g = sandbox(); g.state.contracts = [mk({ status: 'offer', expires: 99 })]; expect(advise(g).some((a) => a.text.includes('새 계약 제안'))).toBe(true);
    const old = sandbox().toJSON() as unknown as Record<string, unknown>; old.formatVersion = 11; for (const k of ['era', 'nextEra', 'eraFree', 'contracts', 'contractsDone', 'nextOffer']) delete old[k];
    const back = Game.fromJSON(old); expect(back.state.era).toBeNull(); expect(back.state.contracts).toEqual([]); expect(back.state.formatVersion).toBe(13); expect(back.state.eraFree).toBeGreaterThanOrEqual(config.eras.firstFree);
    expect(typeById('T72').price).toBe(22);
  });
});
