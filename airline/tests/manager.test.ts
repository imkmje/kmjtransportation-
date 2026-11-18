import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 9999; g.state.rights = undefined; return g; };
const months = (g: Game, n: number) => g.advanceDays(30 * n);
/** 2년차까지 돌려 후보를 만들고, 자회사 하나(51%)를 만든다 */
const setup = () => { const g = sb(); months(g, 25); g.state.cash = 9999; const c = g.state.competitors.find((x) => !x.major)!; expect(g.buyStake(c.id, 0.51).ok).toBe(true); return { g, c }; };
const cand = (g: Game, o: Partial<{ style: 'bold' | 'careful' | 'steady'; skill: number }> = {}) => { const x = g.state.mgrPool![0]; Object.assign(x, o); return x; };

describe('위임 경영진(3.14.0)', () => {
  it('2년차부터 해마다 후보 3명이 오고, 같은 이름은 겹치지 않는다', () => {
    const g = sb(); months(g, 23); expect(g.state.mgrPool).toBeUndefined(); months(g, 2); expect(g.state.mgrPool!.length).toBe(config.mgr.pool);
    expect(new Set(g.state.mgrPool!.map((x) => x.name)).size).toBe(config.mgr.pool); const year = g.state.mgrPoolYear, ids = g.state.mgrPool!.map((x) => x.id);
    months(g, 11); expect(g.state.mgrPoolYear).toBe(year! + 1); expect(g.state.mgrPool!.map((x) => x.id)).not.toEqual(ids);
    for (const x of g.state.mgrPool!) { expect(x.skill).toBeGreaterThanOrEqual(0.7); expect(x.skill).toBeLessThanOrEqual(1.3); expect(Math.abs(x.shown - g.mgrStars(x.skill))).toBeLessThanOrEqual(1); }
  });
  it('영입: 계약금을 내고 후보가 빠지며, 자회사 효율이 능력만큼 오르고 해임하면 돌아온다', () => {
    const { g, c } = setup(), x = cand(g, { skill: 1.3, style: 'steady' }), eff0 = c.eff ?? 1, cash0 = g.state.cash, fee = g.mgrFee(x);
    expect(g.hireMgr(x.id, c.id).ok).toBe(true); expect(g.state.cash).toBeCloseTo(cash0 - fee, 6); expect(g.state.mgrPool!.some((y) => y.id === x.id)).toBe(false);
    expect(c.eff).toBeCloseTo(eff0 + 0.3 * config.mgr.effPerSkill, 6); expect(g.mgrOf(c.id)?.name).toBe(x.name);
    expect(g.fireMgr(g.mgrOf(c.id)!.id).ok).toBe(true); expect(c.eff).toBeCloseTo(eff0, 6); expect(g.mgrOf(c.id)).toBeUndefined();
  });
  it('영입 조건: 후보가 있어야, 빈 자리여야, 자회사(51%)나 동맹 회원이 있어야, 돈이 있어야', () => {
    const { g, c } = setup(); const [a, b] = g.state.mgrPool!;
    expect(g.hireMgr(999, c.id).ok).toBe(false); expect(g.hireMgr(a.id, 'alli').ok).toBe(false); // 동맹 회원이 없음
    const other = g.state.competitors.find((x) => !x.major && x.id !== c.id)!; expect(g.hireMgr(a.id, other.id).ok).toBe(false); // 자회사가 아님
    g.state.cash = 0; expect(g.hireMgr(a.id, c.id).ok).toBe(false); g.state.cash = 9999;
    expect(g.hireMgr(a.id, c.id).ok).toBe(true); expect(g.hireMgr(b.id, c.id).ok).toBe(false); // 이미 경영자가 있음
    g.state.alliance = [other.id]; expect(g.hireMgr(b.id, 'alli').ok).toBe(true);
    expect(g.mgrPosts().length).toBe(0);
  });
  it('월급을 매달 낸다', () => {
    const { g, c } = setup(), x = cand(g, { style: 'careful', skill: 1 }); g.hireMgr(x.id, c.id); const sal = g.mgrOf(c.id)!.salary; g.state.cash = 5000; const m = g.mgrOf(c.id)!;
    m.budget = 20; g.state.cash = 5000; const s0 = g.state.cash; months(g, 1); expect(s0 - g.state.cash).toBeGreaterThanOrEqual(sal - 1e-6); // 월급은 반드시 빠진다(다른 수입도 있어 정확히 같지는 않다)
    expect(g.state.cur.cost).toBeGreaterThan(0);
  });
  it('증자 요청에 알아서 응하고, 예산을 넘기지 않는다', () => {
    const { g, c } = setup(), x = cand(g, { style: 'steady', skill: 1 }); g.hireMgr(x.id, c.id); const m = g.mgrOf(c.id)!; g.state.cash = 9999; c.call = { amount: 8, expires: g.monthsPassed + 3 };
    months(g, 1); expect(c.call).toBeUndefined(); expect(m.spent).toBeGreaterThanOrEqual(8);
    c.call = { amount: m.budget + 50, expires: g.monthsPassed + 3 }; const sp = m.spent; months(g, 1); expect(c.call).toBeDefined(); expect(m.spent).toBe(sp); // 예산보다 큰 요청은 알아서 하지 않는다
  });
  it('현금이 모자라면 자본금을 넣어 지분이 오른다(한 달 예산 안에서)', () => {
    const { g, c } = setup(), x = cand(g, { style: 'bold', skill: 1 }); g.hireMgr(x.id, c.id); const m = g.mgrOf(c.id)!; m.budget = 50; c.cash = 1; delete c.call; g.state.cash = 9999; const st0 = c.stake!;
    (g as unknown as { mgrStep: (n: number) => void }).mgrStep(g.monthsPassed); expect(m.used).toBeGreaterThan(0); expect(m.used).toBeLessThanOrEqual(50); expect(c.stake!).toBeGreaterThan(st0);
  });
  it('방향을 바꾸되 3개월에 한 번까지만', () => {
    const { g, c } = setup(), x = cand(g, { style: 'careful', skill: 1.3 }); g.hireMgr(x.id, c.id); const m = g.mgrOf(c.id)!; c.dir = 'grow'; c.cash = 5; c.hist = [{ rev: 5, profit: -3, planes: 3 }];
    const run = () => (g as unknown as { mgrStep: (n: number) => void }).mgrStep(g.monthsPassed); run(); expect(c.dir).toBe('profit'); const at = m.dirAt; c.dir = 'grow'; c.cash = 5; run(); expect(c.dir).toBe('grow'); expect(m.dirAt).toBe(at); // 3개월 안엔 다시 안 바꿈
  });
  it('동맹 사무총장: 회의 안건을 고르고, 가입 요청을 받으며, 빼 가려는 회원을 붙잡는다', () => {
    const { g, c } = setup(); const o = g.state.competitors.filter((x) => !x.major && x.id !== c.id); g.state.alliance = [o[0].id]; g.state.alli = { name: '우리 동맹', xp: 0 };
    const x = cand(g, { style: 'steady', skill: 1.3 }); expect(g.hireMgr(x.id, 'alli').ok).toBe(true); const run = () => (g as unknown as { mgrStep: (n: number) => void }).mgrStep(g.monthsPassed);
    g.state.alli!.meeting = { expires: g.monthsPassed + 2 }; run(); expect(g.state.alli!.meeting).toBeNull(); expect(g.state.alli!.agenda).toBeTruthy();
    o[1].cash = 100; g.state.alli!.req = { comp: o[1].id, expires: g.monthsPassed + 3, fee: 5 }; g.state.cash = 9999; run(); expect(g.state.alliance).toContain(o[1].id); expect(g.state.alli!.req).toBeNull();
    g.state.alli!.poach = { comp: o[0].id, expires: g.monthsPassed + 2, cost: 10 }; run(); expect(g.state.alli!.poach).toBeNull(); expect(g.state.alliance).toContain(o[0].id);
  });
  it('실수하면 예산 안에서 돈을 잃는다', () => {
    const { g, c } = setup(), x = cand(g, { style: 'bold', skill: 0.7 }); g.hireMgr(x.id, c.id); const m = g.mgrOf(c.id)!; m.budget = 50; const k = config.mgr.styles.bold, p0 = k.mistake; k.mistake = 100;
    try { g.state.cash = 9999; const c0 = g.state.cash; (g as unknown as { mgrStep: (n: number) => void }).mgrStep(g.monthsPassed); const lost = c0 - g.state.cash - m.salary - m.used; expect(lost).toBeGreaterThan(0); expect(lost).toBeLessThanOrEqual(50 + 1e-6); expect(m.notes.some((t) => t.includes('손실'))).toBe(true); expect(m.lost).toBeCloseTo(lost, 1); expect(g.mgrReport(m).lost).toBeCloseTo(lost, 1); } finally { k.mistake = p0; }
  });
  it('맡은 자회사가 없어지거나 지분이 줄면 계약이 끝난다', () => {
    const { g, c } = setup(), x = cand(g, { style: 'steady', skill: 1 }); g.hireMgr(x.id, c.id); const eff = c.eff ?? 1; c.stake = 0.3; months(g, 1);
    expect(g.state.mgrs!.length).toBe(0); expect(c.eff ?? 1).toBeLessThan(eff + 1e-9);
  });
  it('성과(투입 대비 산출): 비용은 계약금+월급+실수 손실, 자회사 산출은 받은 배당+이익 개선 추정', () => {
    const { g, c } = setup(), x = cand(g, { style: 'careful', skill: 1 }); const fee = g.mgrFee(x); g.hireMgr(x.id, c.id); const m = g.mgrOf(c.id)!;
    expect(m.paid).toBe(fee); expect(m.divAt).toBe(c.divTotal ?? 0); let r = g.mgrReport(m); expect(r.expense).toBeCloseTo(fee, 1); expect(r.gain).toBe(0); expect(r.net).toBeCloseTo(-fee, 1);
    months(g, 3); r = g.mgrReport(m); expect(m.paid).toBeCloseTo(fee + 3 * m.salary, 4); expect(r.months).toBe(3); expect(r.salary).toBeCloseTo(3 * m.salary, 1);
    m.lost = 5; c.divTotal = (m.divAt ?? 0) + 12; c.hist = Array.from({ length: 12 }, () => ({ rev: 10, profit: 1, planes: 3 })); m.base = 0; r = g.mgrReport(m);
    expect(r.div).toBeCloseTo(12, 1); expect(r.est).toBeCloseTo(12 / 12 * 3, 1); expect(r.lost).toBe(5); expect(r.gain).toBeCloseTo(r.div + r.est, 1); expect(r.expense).toBeCloseTo(fee + 3 * m.salary + 5, 0);
    expect(r.net).toBeCloseTo(r.gain - r.expense, 1); expect(r.capital).toBe(m.spent);
  });
  it('예전 저장(성과 기록이 없는 경영자)도 보고서가 나온다', () => {
    const { g, c } = setup(), x = cand(g, { style: 'steady', skill: 1 }); g.hireMgr(x.id, c.id); const m = g.mgrOf(c.id)!; delete m.paid; delete m.lost; delete m.acts; delete m.divAt; m.hired = g.monthsPassed - 4;
    const r = g.mgrReport(m); expect(r.expense).toBeCloseTo(g.mgrFee(m) + 4 * m.salary, 0); expect(Number.isFinite(r.net)).toBe(true);
  });
  it('동맹 경영자 성과: 가입비 수입이 산출, 한 일 횟수가 쌓이고 붙잡기 비용은 비용에 들어간다', () => {
    const { g, c } = setup(); const o = g.state.competitors.filter((x) => !x.major && x.id !== c.id); g.state.alliance = [o[0].id]; g.state.alli = { name: '우리 동맹', xp: 0 };
    const x = cand(g, { style: 'steady', skill: 1.3 }); g.hireMgr(x.id, 'alli'); const m = g.mgrOf('alli')!, run = () => (g as unknown as { mgrStep: (n: number) => void }).mgrStep(g.monthsPassed);
    o[1].cash = 100; g.state.alli.req = { comp: o[1].id, expires: g.monthsPassed + 3, fee: 5 }; g.state.cash = 9999; run(); expect(m.earned).toBeCloseTo(5, 1); expect(m.acts!.join).toBe(1);
    g.state.alli.meeting = { expires: g.monthsPassed + 2 }; run(); expect(m.acts!.agenda).toBe(1); g.state.alli.poach = { comp: o[0].id, expires: g.monthsPassed + 2, cost: 10 }; run(); expect(m.acts!.keep).toBe(1);
    const r = g.mgrReport(m); expect(r.fees).toBeCloseTo(5, 1); expect(r.gain).toBeCloseTo(5, 1); expect(r.expense).toBeGreaterThanOrEqual(g.mgrFee(m) + 10 - 0.1); expect(r.members[0]).toBe(1); expect(r.members[1]).toBe(2);
  });
  it('1년 평가에 투입·산출·순성과가 같이 나온다', () => {
    const { g, c } = setup(), x = cand(g, { style: 'careful', skill: 1.0 }); g.hireMgr(x.id, c.id); g.mgrOf(c.id)!.hired = g.monthsPassed - 11; months(g, 1);
    expect(g.state.log.some((l) => l.includes('1년 평가') && l.includes('순성과'))).toBe(true);
  });
  it('1년이 지나면 진짜 평가(별점)가 나온다', () => {
    const { g, c } = setup(), x = cand(g, { style: 'careful', skill: 1.0 }); g.hireMgr(x.id, c.id); const m = g.mgrOf(c.id)!; expect(m.stars).toBeUndefined(); m.hired = g.monthsPassed - 11; months(g, 1);
    expect(g.mgrOf(c.id)?.stars).toBe(g.mgrStars(1.0)); expect(g.state.log.some((l) => l.includes('1년 평가'))).toBe(true);
  });
});
