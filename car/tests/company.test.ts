// 회사(설계서 9.1 직원, 9.2 본사, 9.3 공장, 6.4 동시 개발)와 저장 형식 2 → 3
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, sellingGens } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { capacityOf, conditionMult, factoryBuildMonths, costMultOf, devTeams, linesOf, optionSlots, salesAwarenessBonus, salesFleetMult, staffCap, upkeepOf } from '../src/sim/company';
import { designWeekByStaff, teamSizeMult } from '../src/sim/dev';
import { monthlyDemand, rivalBase, type SaleCar } from '../src/sim/market';
import { capacityAdvice, factoryInfo, hiringInfo, hqInfo, planPreview, staffInfo, teamPreview } from '../src/sim/queries';
import { salaryOf, unitCost } from '../src/sim/cars';
import { monthOf } from '../src/sim/time';
import { NAMES, RIVALS } from '../src/data';
import { config } from '../src/config';
import type { Staff } from '../src/sim/types';
import { SPEC, grant, launched, ok, toMonthEnd } from './util';

const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? '' : r.reason);
const H = config.staff.hire, C = config.staff.condition;
/** 본사 2등급(정원 8)까지 올린 새 게임 */
function hq2(seed = 1, cash = 1e7): Game {
  const g = Game.create({ difficulty: 'normal', seed });
  g.state.cash = cash;
  ok(g.command({ type: 'upgradeHQ' }));
  return g;
}
/** 공고 → 첫 후보 채용, 새 직원 반환 */
function hireOne(g: Game, role: Staff['role'] = 'designer', tier: 1 | 2 | 3 = 1): Staff {
  ok(g.command({ type: 'postJob', role, tier }));
  const c = g.state.candidates[0];
  ok(g.command({ type: 'hire', candidateId: c.id }));
  ok(g.command({ type: 'dismissCandidates' }));
  return g.state.staff.find((x) => x.id === c.id)!;
}

describe('채용(9.1)', () => {
  it('본사 1등급에서 2명을 더 채용할 수 있고(정원 6, 시작 직원 4명, 0.5.0), 정원이 차면 공고 거부, 본사를 올리면 된다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    expect(g.state.staff.length).toBe(4);
    for (let i = 0; i < 2; i++) { ok(g.command({ type: 'postJob', role: 'designer', tier: 1 })); ok(g.command({ type: 'hire', candidateId: g.state.candidates[0].id })); ok(g.command({ type: 'dismissCandidates' })); }
    expect(g.state.staff.length).toBe(6);
    expect(reason(g.command({ type: 'postJob', role: 'designer', tier: 1 }))).toBe('정원(6명)이 찼습니다. 본사 등급을 올리면 정원이 늘어납니다.');
    g.state.cash = 1e7;
    ok(g.command({ type: 'upgradeHQ' }));
    ok(g.command({ type: 'postJob', role: 'designer', tier: 1 }));
  });
  it('공고비 500만 / 2,000만 / 1억, 후보 3명(등급별 능력 범위, 잠재력 = 능력 + 5~20, 요구 월급 = 250 + 능력 × 12), 이미 후보가 있으면 거부, 3등급은 평판 40 이상', () => {
    const t3 = hq2(9);
    expect(reason(t3.command({ type: 'postJob', role: 'engineer', tier: 3 }))).toBe('3등급 공고는 평판 40 이상이어야 합니다.');
    for (const tier of [1, 2, 3] as const) {
      const g = hq2(tier), cash = g.state.cash;
      if (tier === 3) g.state.reputation = 40;
      const bonus = tier === 3 ? 2 : 0; // 평판 40 → +2
      ok(g.command({ type: 'postJob', role: 'engineer', tier }));
      expect(cash - g.state.cash).toBe(H.postCost[tier - 1]);
      expect(g.state.candidates.length).toBe(3);
      for (const c of g.state.candidates) {
        expect(c.role).toBe('engineer');
        expect(c.ability).toBeGreaterThanOrEqual(H.abilityMin[tier - 1] + bonus); expect(c.ability).toBeLessThanOrEqual(H.abilityMax[tier - 1] + bonus); // 평판 10 → 보너스 0
        expect(c.potential - c.ability).toBeGreaterThanOrEqual(Math.min(5, 100 - c.ability)); expect(c.potential - c.ability).toBeLessThanOrEqual(20); expect(c.potential).toBeLessThanOrEqual(100);
        expect(c.salary).toBe(250 + c.ability * 12);
        expect(c.expiresWeek).toBe(g.state.week + 4);
      }
      expect(new Set(g.state.candidates.map((c) => c.name)).size).toBe(3);
      expect(reason(g.command({ type: 'postJob', role: 'engineer', tier }))).toContain('이미 공고한 후보');
    }
    const g = hq2();
    expect(reason(g.command({ type: 'postJob', role: 'boss' as never, tier: 1 }))).toBe('없는 직무입니다.');
    expect(reason(g.command({ type: 'postJob', role: 'tester', tier: 4 as never }))).toBe('공고 등급은 1~3 중에서 고르세요.');
    g.state.cash = 100;
    expect(reason(g.command({ type: 'postJob', role: 'tester', tier: 1 }))).toBe('현금이 모자랍니다.');
  });
  it('이름은 성 + 이름 풀에서 시드 난수로, 같은 시드 = 같은 후보(결정론)', () => {
    const a = hq2(5), b = hq2(5), c = hq2(6);
    for (const g of [a, b, c]) ok(g.command({ type: 'postJob', role: 'sales', tier: 2 }));
    expect(a.state.candidates).toEqual(b.state.candidates);
    expect(a.state.candidates).not.toEqual(c.state.candidates);
    for (const x of a.state.candidates) expect(NAMES.family.includes(x.name[0]) && NAMES.given.includes(x.name.slice(1))).toBe(true);
  });
  it('평판이 높으면 후보가 조금 더 좋다(능력 + 평판/20, 최대 +5)', () => {
    const lo = hq2(3), hi = hq2(3);
    hi.state.reputation = 100;
    ok(lo.command({ type: 'postJob', role: 'designer', tier: 1 })); ok(hi.command({ type: 'postJob', role: 'designer', tier: 1 }));
    expect(hi.state.candidates.map((c) => c.ability)).toEqual(lo.state.candidates.map((c) => c.ability + 5));
  });
  it('채용: 후보가 직원이 된다(컨디션 1, 쉬는 중). 정원이 차면 거부. 돌려보내기', () => {
    const g = hq2();
    ok(g.command({ type: 'postJob', role: 'tester', tier: 2 }));
    const c = g.state.candidates[1];
    ok(g.command({ type: 'hire', candidateId: c.id }));
    expect(g.state.staff.at(-1)).toEqual({ id: c.id, name: c.name, role: 'tester', ability: c.ability, potential: c.potential, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false, hist: { join: g.state.week, joinAbility: c.ability, since: g.state.week, years: {}, cars: [], execs: [] } }); // 0.10.0 성장 기록
    expect(g.state.candidates.length).toBe(2);
    expect(reason(g.command({ type: 'hire', candidateId: c.id }))).toBe('없는 후보입니다.');
    while (g.state.staff.length < 8) g.state.staff.push({ ...g.state.staff[0], id: 900 + g.state.staff.length });
    expect(reason(g.command({ type: 'hire', candidateId: g.state.candidates[0].id }))).toContain('정원(8명)이 찼습니다');
    ok(g.command({ type: 'dismissCandidates' }));
    expect(g.state.candidates).toEqual([]);
    expect(reason(g.command({ type: 'dismissCandidates' }))).toBe('돌려보낼 후보가 없습니다.');
  });
  it('후보는 4주 뒤 사라진다(소식 1번)', () => {
    const g = hq2();
    ok(g.command({ type: 'postJob', role: 'designer', tier: 1 }));
    for (let i = 0; i < 3; i++) { g.tick(); expect(g.state.candidates.length).toBe(3); }
    const ev = g.tick();
    expect(g.state.candidates).toEqual([]);
    expect(ev.filter((e) => e.kind === 'company' && e.text.includes('다른 회사')).length).toBe(1);
  });
  it('일회성 지출(공고비)은 바로 현금에서 나가고, 그달 장부 oneOff에 적히며 이익에 들어간다(현금은 두 번 빠지지 않는다)', () => {
    const g = hq2();
    g.state.reputation = 40;
    toMonthEnd(g);
    const before = g.state.cash;
    ok(g.command({ type: 'postJob', role: 'designer', tier: 3 }));
    expect(g.state.cash).toBe(before - 10000);
    toMonthEnd(g);
    const l = g.state.ledger.at(-1)!;
    expect(l.oneOff).toBe(10000);
    expect(g.state.cash).toBeCloseTo(before + l.profit, 6);
  });
});

describe('해고·교육·경험·컨디션·휴식(9.1)', () => {
  it('해고: 퇴직금 = 월급 2개월분, 배치 중이면 빠진다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const x = g.state.staff[1], cash = g.state.cash;
    ok(g.command({ type: 'fire', staffId: x.id }));
    expect(cash - g.state.cash).toBe(2 * salaryOf(x.ability));
    expect(g.state.staff.some((y) => y.id === x.id)).toBe(false);
    expect(g.tick().find((e) => e.kind === 'devWeek' && e.staff.some((s) => s.id === x.id))).toBeUndefined();
    expect(reason(g.command({ type: 'fire', staffId: x.id }))).toBe('없는 직원입니다.');
  });
  it('교육: 비용 = 능력 × 40만원(최소 500만), 능력 +1~3(잠재력 상한), 연 1회, 잠재력에 도달하면 거부', () => {
    const g = Game.create({ difficulty: 'normal', seed: 2 });
    g.state.cash = 1e7;
    const x = g.state.staff[0], a0 = x.ability, cash = g.state.cash;
    ok(g.command({ type: 'train', staffId: x.id }));
    expect(cash - g.state.cash).toBe(Math.max(500, a0 * 40));
    expect(x.ability - a0).toBeGreaterThanOrEqual(1); expect(x.ability - a0).toBeLessThanOrEqual(3);
    expect(reason(g.command({ type: 'train', staffId: x.id }))).toBe('이미 교육 중입니다.');
    for (let i = 0; i < 4; i++) g.tick();
    expect(reason(g.command({ type: 'train', staffId: x.id }))).toBe('올해 교육을 이미 1번 받았습니다.');
    g.state.week = 48; // 다음 해
    ok(g.command({ type: 'train', staffId: x.id }));
    const y = g.state.staff[1];
    y.ability = 10; y.potential = 11;
    const c0 = g.state.cash;
    ok(g.command({ type: 'train', staffId: y.id }));
    expect(c0 - g.state.cash).toBe(500); expect(y.ability).toBe(11);
    g.state.week += 48;
    expect(reason(g.command({ type: 'train', staffId: y.id }))).toBe('잠재력에 도달해 더 배울 수 없습니다.');
    g.state.cash = 0;
    expect(reason(g.command({ type: 'train', staffId: g.state.staff[2].id }))).toBe('현금이 모자랍니다.');
  });
  it('교육 중 4주는 프로젝트 산출 0(난수 순서는 그대로), 끝나면 소식', () => {
    const g = Game.create({ difficulty: 'normal', seed: 3 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const x = g.state.staff[0];
    ok(g.command({ type: 'train', staffId: x.id }));
    for (let i = 0; i < 4; i++) {
      const ev = g.tick(), w = ev.find((e) => e.kind === 'devWeek');
      if (!w || w.kind !== 'devWeek') throw new Error('devWeek 없음');
      const mine = w.staff.find((s) => s.id === x.id)!;
      expect(Object.values(mine.stats).every((v) => v === 0)).toBe(true);
      expect(w.staff.filter((s) => s.id !== x.id).some((s) => Object.values(s.stats).some((v) => v > 0))).toBe(true);
      if (i === 3) expect(ev.some((e) => e.kind === 'company' && e.text.includes('교육을 마쳤습니다'))).toBe(true);
    }
    const w = g.tick().find((e) => e.kind === 'devWeek');
    expect(w?.kind === 'devWeek' && Object.values(w.staff.find((s) => s.id === x.id)!.stats).some((v) => v > 0)).toBe(true);
  });
  it('경험: 출시로 마친 직원 능력 +1~2, 잠재력을 넘지 않는다', () => {
    const { g } = launched(4);
    for (const x of g.state.staff) expect(x.ability).toBeLessThanOrEqual(x.potential);
    const h = Game.create({ difficulty: 'normal', seed: 4 });
    for (const x of h.state.staff) x.potential = x.ability; // 이미 잠재력
    ok(h.command({ type: 'startProject', ...SPEC }));
    const before = h.state.staff.map((x) => x.ability), p = h.state.projects[0];
    while (p.phase === 'design' || p.testWeeks < 2) h.tick();
    ok(h.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 0, color: 'red', wheels: 0 }));
    expect(h.state.staff.map((x) => x.ability)).toEqual(before);
  });
  it('컨디션: 프로젝트 주마다 −0.01(보통)/−0.025(과감)/−0.005(절약), 쉬는 주 +0.05(최대 1)', () => {
    for (const budget of ['low', 'normal', 'high'] as const) {
      const g = Game.create({ difficulty: 'normal', seed: 1 });
      ok(g.command({ type: 'startProject', ...SPEC, budget }));
      for (let i = 0; i < 10; i++) g.tick();
      for (const x of g.state.staff) expect(x.condition).toBeCloseTo(1 - 10 * C.perWeek[budget], 9);
      ok(g.command({ type: 'cancelProject', projectId: g.state.projects[0].id }));
      g.tick();
      for (const x of g.state.staff) expect(x.condition).toBeCloseTo(Math.min(1, 1 - 10 * C.perWeek[budget] + 0.05), 9);
    }
  });
  it('컨디션 산출 배수: 0.3 미만 ×0.6, 0.3~0.6 ×0.85, 그 이상 ×1', () => {
    expect([0, 0.29, 0.3, 0.59, 0.6, 1].map(conditionMult)).toEqual([0.6, 0.6, 0.85, 0.85, 1, 1]);
    const s = Game.create({ difficulty: 'normal', seed: 1 }).state.staff[1], spec = { budget: 'normal' as const, direction: SPEC.direction };
    const at = (c: number) => designWeekByStaff([{ ...s, condition: c }], spec, () => 1)[0].P;
    expect(at(0.2) / at(1)).toBeCloseTo(0.6, 12); expect(at(0.5) / at(1)).toBeCloseTo(0.85, 12); expect(at(0.7)).toBe(at(1));
  });
  it('휴식: 1~12주, 그동안 산출 0·회복, 끝나면 소식. 교육 중에는 거부', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    ok(g.command({ type: 'startProject', ...SPEC, budget: 'high' }));
    for (let i = 0; i < 8; i++) g.tick();
    const x = g.state.staff[2], c0 = x.condition;
    expect(reason(g.command({ type: 'rest', staffId: x.id, weeks: 0 }))).toBe('휴식은 1~12주 사이로 정하세요.');
    ok(g.command({ type: 'rest', staffId: x.id, weeks: 2 }));
    const e1 = g.tick().find((e) => e.kind === 'devWeek');
    expect(e1?.kind === 'devWeek' && Object.values(e1.staff.find((s) => s.id === x.id)!.stats).every((v) => v === 0)).toBe(true);
    const ev = g.tick();
    expect(x.condition).toBeCloseTo(Math.min(1, c0 + 0.1), 9);
    expect(ev.some((e) => e.kind === 'company' && e.text.includes('휴식을 마치고'))).toBe(true);
    expect(x.restUntil).toBeNull(); expect(x.projectId).toBe(g.state.projects[0].id); // 프로젝트 배치는 유지
    g.state.cash = 1e7;
    ok(g.command({ type: 'train', staffId: x.id }));
    expect(reason(g.command({ type: 'rest', staffId: x.id, weeks: 1 }))).toBe('교육 중에는 휴식할 수 없습니다.');
  });
});

describe('팀 배치와 영업(9.1)', () => {
  it('startProject의 team: 고른 직원만 배치, 생략하면 쉬는 개발 직무 전원(영업 제외), 잘못된 팀은 거부', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), [a, b] = g.state.staff;
    expect(reason(g.command({ type: 'startProject', ...SPEC, team: [] }))).toContain('한 명 이상');
    expect(reason(g.command({ type: 'startProject', ...SPEC, team: [a.id, a.id] }))).toContain('겹치지 않게');
    expect(reason(g.command({ type: 'startProject', ...SPEC, team: [999] }))).toBe('없는 직원입니다.');
    ok(g.command({ type: 'startProject', ...SPEC, team: [a.id, b.id] }));
    expect(g.state.staff.map((x) => x.projectId)).toEqual([g.state.projects[0].id, g.state.projects[0].id, null, null]);
    const h = hq2(2), s = hireOne(h, 'sales');
    expect(reason(h.command({ type: 'startProject', ...SPEC, team: [s.id] }))).toBe('영업 직원은 개발에 배치할 수 없습니다.');
    ok(h.command({ type: 'startProject', ...SPEC }));
    expect(s.projectId).toBeNull();
    expect(h.state.staff.filter((x) => x.role !== 'sales').every((x) => x.projectId === h.state.projects[0].id)).toBe(true);
  });
  it('이미 다른 개발에 배치된 직원은 고를 수 없다. 진행 중 assign으로 넣고 빼기(영업 거부)', () => {
    const g = hq2(3), sales = hireOne(g, 'sales');
    while (g.state.hqLevel < 3) { g.state.reputation = 100; ok(g.command({ type: 'upgradeHQ' })); }
    const [a, b, c, d] = g.state.staff;
    ok(g.command({ type: 'startProject', ...SPEC, team: [a.id, b.id] }));
    const p1 = g.state.projects[0];
    expect(reason(g.command({ type: 'startProject', ...SPEC, team: [b.id, c.id] }))).toContain('이미 다른 개발에 배치');
    ok(g.command({ type: 'startProject', ...SPEC, team: [c.id] }));
    const p2 = g.state.projects[1];
    ok(g.command({ type: 'assign', staffId: d.id, projectId: p2.id }));
    ok(g.command({ type: 'assign', staffId: a.id, projectId: p2.id }));
    ok(g.command({ type: 'assign', staffId: b.id, projectId: null }));
    expect([a, b, c, d].map((x) => x.projectId)).toEqual([p2.id, null, p2.id, p2.id]);
    expect(reason(g.command({ type: 'assign', staffId: sales.id, projectId: p1.id }))).toBe('영업 직원은 개발에 배치할 수 없습니다.');
    expect(reason(g.command({ type: 'assign', staffId: a.id, projectId: 999 }))).toBe('없는 개발 프로젝트입니다.');
    const ev = g.tick().filter((e) => e.kind === 'devWeek');
    expect(ev.find((e) => e.kind === 'devWeek' && e.projectId === p1.id)!.staff).toEqual([]); // 아무도 없으면 점수 0
    expect(ev.find((e) => e.kind === 'devWeek' && e.projectId === p2.id)!.staff.map((x) => x.id)).toEqual([a.id, c.id, d.id]);
  });
  it('teamPreview: 팀이 클수록 예상 등급이 높고, 기본 팀(쉬는 개발 직원 전원)이면 planPreview와 같다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), ids = g.state.staff.map((x) => x.id);
    expect(teamPreview(g.state, ids, SPEC)).toEqual(planPreview(g.state, SPEC));
    expect(teamPreview(g.state, ids.slice(0, 2), SPEC).avg).toBeLessThan(teamPreview(g.state, ids, SPEC).avg);
  });
  it('영업: 인지도 수렴 +영업 능력 합/400(최대 +0.15), 법인·택시 매력 ×(1 + 합/1000, 최대 1.3), 자리를 비우면 효과 없음', () => {
    const g = hq2(1);
    expect(salesAwarenessBonus(g.state)).toBe(0); expect(salesFleetMult(g.state)).toBe(1);
    const s = hireOne(g, 'sales');
    s.ability = 40;
    expect(salesAwarenessBonus(g.state)).toBeCloseTo(0.1, 12); expect(salesFleetMult(g.state)).toBeCloseTo(1.04, 12);
    s.ability = 100; g.state.staff.push({ ...s, id: 999 });
    expect(salesAwarenessBonus(g.state)).toBe(0.15); expect(salesFleetMult(g.state)).toBeCloseTo(1.2, 12);
    for (let i = 0; i < 2; i++) g.state.staff.push({ ...s, id: 1000 + i });
    expect(salesFleetMult(g.state)).toBe(1.3);
    const car: SaleCar = { body: 'sedanS', segment: 'fleet', stats: { P: 90, E: 90, U: 90, D: 90, Q: 90 }, price: 1200, awareness: 0.4, life: 1 };
    const withSales = monthlyDemand(g.state, car, [], 1972);
    const none = structuredClone(g.state); none.staff = none.staff.filter((x) => x.role !== 'sales');
    expect(withSales).toBeGreaterThan(monthlyDemand(none, car, [], 1972));
    s.restUntil = g.state.week + 2;
    expect(salesFleetMult(g.state)).toBeCloseTo(1.3, 12); // 3명 300 → 여전히 상한
    for (const x of g.state.staff) if (x.role === 'sales') x.restUntil = g.state.week + 2;
    expect(salesFleetMult(g.state)).toBe(1);
  });
  it('영업 직원이 있으면 인지도가 목표로 더 빨리 다가간다', () => {
    const run = (sales: boolean) => {
      const { g, gen } = launched(5);
      g.state.cash = 1e9;
      if (sales) g.state.staff.push({ id: 999, name: '영업왕', role: 'sales', ability: 60, potential: 60, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false });
      gen.awareness = 0;
      toMonthEnd(g); toMonthEnd(g);
      return gen.awareness;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
});

describe('본사(9.2)와 동시 개발(6.4)', () => {
  it('등급별 정원 6/8/12/16/20(0.5.0: 1등급 4 → 6), 개발팀 1/1/2/2/3, 옵션 슬롯 2/2/3/4/4, 승급비·평판 조건, 최고 등급', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    const got = [];
    s.cash = 0;
    expect(reason(g.command({ type: 'upgradeHQ' }))).toBe('현금이 모자랍니다.');
    s.cash = 1e9;
    for (let lv = 1; lv <= 5; lv++) {
      got.push([staffCap(s), devTeams(s), optionSlots(s)]);
      if (lv === 5) break;
      const next = config.hq.levels[lv];
      if (next.rep > 0) { s.reputation = next.rep - 1; expect(reason(g.command({ type: 'upgradeHQ' }))).toBe(`평판 ${next.rep} 이상이어야 합니다(지금 ${next.rep - 1}).`); s.reputation = next.rep; }
      const cash = s.cash;
      ok(g.command({ type: 'upgradeHQ' }));
      expect(cash - s.cash).toBe(next.cost); expect(s.hqLevel).toBe(lv + 1);
    }
    expect(got).toEqual([[6, 1, 2], [8, 1, 2], [12, 2, 3], [16, 2, 4], [20, 3, 4]]);
    expect([50000, 400000, 3000000, 15000000]).toEqual(config.hq.levels.slice(1).map((x) => x.cost)); // 5억 / 40억 / 300억 / 1,500억
    expect([20, 55, 80]).toEqual(config.hq.levels.slice(2).map((x) => x.rep));
    expect(reason(g.command({ type: 'upgradeHQ' }))).toBe('본사가 최고 등급입니다.');
  });
  it('옵션 슬롯: 본사 1등급은 2개, 3등급이면 3개까지', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    g.state.week = 48 * 10; // 1980년: 옵션 3개 연구
    grant(g, 'el_aircon', 'el_powerSteering');
    const three = { ...SPEC, options: ['radio', 'aircon', 'powerSteering'] };
    expect(reason(g.command({ type: 'startProject', ...three }))).toBe('옵션은 최대 2개까지 고를 수 있습니다(본사 등급을 올리면 늘어납니다).');
    g.state.cash = 1e9; g.state.reputation = 30;
    ok(g.command({ type: 'upgradeHQ' })); ok(g.command({ type: 'upgradeHQ' }));
    ok(g.command({ type: 'startProject', ...three }));
  });
  it('개발팀 수만큼 동시에 개발(페이스리프트도 팀 하나), 넘으면 거부', () => {
    const { g, gen } = launched(2);
    g.state.cash = 1e9;
    while (monthOf(g.state.week) - gen.launchMonth < 18) g.tick();
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [], team: [g.state.staff[0].id] }));
    expect(reason(g.command({ type: 'startProject', ...SPEC }))).toContain('개발팀이 모두 바쁩니다');
    g.state.reputation = 30; ok(g.command({ type: 'upgradeHQ' })); ok(g.command({ type: 'upgradeHQ' }));
    ok(g.command({ type: 'startProject', ...SPEC }));
    expect(g.state.projects.length).toBe(2);
    expect(reason(g.command({ type: 'startProject', ...SPEC }))).toContain('개발팀이 모두 바쁩니다');
    for (let i = 0; i < 20; i++) g.tick(); // 두 프로젝트 모두 진행
    expect(g.state.projects.every((p) => p.weeksDone > 0)).toBe(true);
  });
  it('월 유지비 = 공장 + 본사(등급별)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    g.state.cash = 1e9;
    expect(upkeepOf(g.state)).toBe(config.factory.levels[0].upkeep + config.hq.levels[0].upkeep);
    ok(g.command({ type: 'upgradeHQ' }));
    toMonthEnd(g);
    expect(g.state.ledger.at(-1)!.upkeep).toBe(config.factory.levels[0].upkeep + config.hq.levels[1].upkeep);
  });
  it('hqInfo: 지금·다음 등급, 승급 가능 여부와 이유', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    const i = hqInfo(g.state);
    expect(i.current).toMatchObject({ level: 1, name: '창고 공장', staffCap: 6, teams: 1, optionSlots: 2 });
    expect(i.next).toMatchObject({ level: 2, name: '소형 사옥', cost: 50000, staffCap: 8 });
    expect(i.canUpgrade).toBe(true); expect(i.staffCount).toBe(4);
    g.state.cash = 1e9; ok(g.command({ type: 'upgradeHQ' }));
    expect(hqInfo(g.state)).toMatchObject({ canUpgrade: false, reason: '평판 20 이상이어야 합니다(지금 10).' }); // 0.4.2: 30 → 20
  });
});

describe('공장(9.3)', () => {
  it('증설: 다음 등급 건설비, 공사 6개월 뒤 반영(공사 중 추가 증설 불가), 생산 한도·라인·유지비·원가 배수가 표대로', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    s.cash = 1e10; // 1.0.0: 6·7등급까지 건설비 합이 10조를 넘는다
    const L = config.factory.levels;
    for (let lv = 1; lv < L.length; lv++) { // 1.0.0: 7등급까지
      expect([capacityOf(s), linesOf(s), costMultOf(s)]).toEqual([L[lv - 1].capacity, L[lv - 1].lines, L[lv - 1].costMult]);
      const cash = s.cash, m0 = monthOf(s.week);
      ok(g.command({ type: 'expandFactory' }));
      expect(cash - s.cash).toBe(L[lv].cost);
      expect(s.factory.build).toEqual({ level: lv + 1, doneMonth: m0 + factoryBuildMonths(lv + 1) });
      expect(reason(g.command({ type: 'expandFactory' }))).toBe('공장 증설 공사 중에는 추가 증설을 할 수 없습니다.');
      expect(factoryInfo(s).building).toEqual({ level: lv + 1, monthsLeft: factoryBuildMonths(lv + 1) });
      let done = false;
      while (!done) { done = g.tick().some((e) => e.kind === 'company' && e.text.includes('증설을 마쳤습니다')); if (!done) expect(s.factory.level).toBe(lv); }
      expect(monthOf(s.week)).toBe(m0 + factoryBuildMonths(lv + 1)); // 공사 개월째 달 초부터 새 등급(1~5등급 6개월, 1.0.0: 6·7등급 9·12개월)
      expect(s.factory).toEqual({ level: lv + 1, build: null });
    }
    expect([capacityOf(s), linesOf(s)]).toEqual([50000, 14]);
    expect(L.map((x) => [x.capacity, x.lines])).toEqual([[300, 1], [1000, 3], [3000, 3], [8000, 5], [20000, 8], [32000, 11], [50000, 14]]);
    expect(reason(g.command({ type: 'expandFactory' }))).toBe('공장이 최고 등급입니다.');
    toMonthEnd(g);
    expect(s.ledger.at(-1)!.upkeep).toBe(L[L.length - 1].upkeep + config.hq.levels[0].upkeep);
    const h = Game.create({ difficulty: 'normal', seed: 1 }); h.state.cash = 0;
    expect(reason(h.command({ type: 'expandFactory' }))).toBe('현금이 모자랍니다.');
  });
  it('원가 배수가 대당 원가(장부 원가)에 들어간다', () => {
    const { g, gen } = launched(2);
    g.state.cash = 1e9; g.state.factory.level = 3;
    toMonthEnd(g); toMonthEnd(g);
    const l = g.state.ledger.at(-1)!, ed = gen.editions[0];
    expect(l.cogs).toBeCloseTo(gen.sales.at(-1)! * unitCost(gen.body, gen.powertrain, ed.tier, ed.options, config.factory.levels[2].costMult), 6);
  });
  it('생산 라인 수만큼 동시 판매(2등급 라인 3개, 0.5.1), 라인이 없으면 출시 거부(증설 안내)', () => {
    const { g } = twoCars(1);
    expect(sellingGens(g.state).length).toBe(2);
    for (const name of ['셋째', '넷째']) {
      ok(g.command({ type: 'startProject', ...SPEC, name }));
      const q = g.state.projects[0];
      while (q.phase === 'design' || q.testWeeks < 2) g.tick();
      if (name === '셋째') ok(g.command({ type: 'launch', projectId: q.id, price: 1200, marketing: 0, color: 'red', wheels: 0 }));
    }
    const p = g.state.projects[0];
    expect(reason(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 0, color: 'red', wheels: 0 }))).toBe('빈 생산 라인이 없습니다. 판매 중인 차를 단종하거나 공장을 증설하세요.');
  });
  it('생산 배분: 자동은 수요 비례, 수동 몫은 한도 × 몫까지, 남은 한도는 자동 차에. 합이 1을 넘으면 거부, null이면 자동', () => {
    const { g, a, b } = twoCars(2);
    g.state.week += 48 * 10; // 1980년대: 두 차의 주문이 한도를 넘도록 시장을 키운다
    for (const x of [a, b]) { x.awareness = 1; x.editions[0].stats = { P: 400, E: 400, U: 400, D: 400, Q: 400 }; x.lifeMonth = monthOf(g.state.week) - 3; }
    toMonthEnd(g); toMonthEnd(g);
    const cap = capacityOf(g.state), total = a.lastDemand + b.lastDemand;
    expect(total).toBeGreaterThan(cap);
    expect(a.sales.at(-1)).toBe(Math.round((a.lastDemand * cap) / total)); expect(b.sales.at(-1)).toBe(Math.round((b.lastDemand * cap) / total));
    expect(a.lostSales).toBeCloseTo(a.lastDemand - a.sales.at(-1)!, 9);
    ok(g.command({ type: 'setAllocation', generationId: a.id, share: 0.7 }));
    expect(reason(g.command({ type: 'setAllocation', generationId: b.id, share: 0.31 }))).toBe('차종별 배분의 합이 100%를 넘습니다.');
    expect(reason(g.command({ type: 'setAllocation', generationId: b.id, share: 1.5 }))).toBe('배분 몫은 0~100% 사이여야 합니다.');
    expect(reason(g.command({ type: 'setAllocation', generationId: 999, share: 0.1 }))).toBe('판매 중인 차가 아닙니다.');
    toMonthEnd(g);
    expect(a.sales.at(-1)).toBe(Math.round(Math.min(a.lastDemand, cap * 0.7)));
    expect(b.sales.at(-1)).toBe(Math.round(Math.min(b.lastDemand, cap * 0.3)));
    ok(g.command({ type: 'setAllocation', generationId: b.id, share: 0.3 }));
    ok(g.command({ type: 'setAllocation', generationId: a.id, share: null }));
    expect(a.allocShare).toBeNull(); expect(b.allocShare).toBe(0.3);
    const f = factoryInfo(g.state);
    expect(f.cars.map((c) => c.generationId)).toEqual([a.id, b.id]);
    expect(f.cars[0]).toMatchObject({ manual: null, demand: a.lastDemand, produced: a.sales.at(-1), backlog: a.lostSales });
    expect(f.ratio).toBeCloseTo(total > 0 ? (a.lastDemand + b.lastDemand) / cap : 0, 9);
  });
  it('밀린 주문 기록과 조언: 주문이 한도의 1.3배 이상이면 증설 권유, 0.7 미만이면 여유', () => {
    const { g, gen } = launched(3);
    g.state.cash = 1e9;
    gen.awareness = 1; gen.editions[0].stats = { P: 400, E: 400, U: 400, D: 400, Q: 400 };
    toMonthEnd(g); toMonthEnd(g);
    expect(gen.lostSales).toBeGreaterThan(0);
    const r = gen.lastDemand / 300;
    expect(r).toBeGreaterThanOrEqual(1.3);
    expect(capacityAdvice(g.state)).toBe(`주문이 한도의 ${r.toFixed(1)}배입니다. 공장 증설을 고려하세요.`);
    ok(g.command({ type: 'expandFactory' }));
    expect(capacityAdvice(g.state)).toBe(`주문이 한도의 ${r.toFixed(1)}배입니다. 증설 공사가 6개월 남았습니다.`);
    gen.lastDemand = 100;
    expect(capacityAdvice(g.state)).toBe('생산에 여유가 있습니다(한도의 33%만 주문).');
    gen.lastDemand = 250;
    expect(capacityAdvice(g.state)).toBe('생산량이 주문에 잘 맞습니다.');
    expect(capacityAdvice(Game.create({ difficulty: 'normal', seed: 1 }).state)).toBe('판매 중인 차가 없습니다.');
  });
});

/** 공장 2등급(라인 2)에서 차 두 대를 파는 게임 */
function twoCars(seed: number) {
  const { g, gen: a } = launched(seed);
  g.state.cash = 1e9;
  ok(g.command({ type: 'expandFactory' }));
  while (g.state.factory.level < 2) g.tick();
  ok(g.command({ type: 'startProject', ...SPEC, name: '둘째', segment: 'youth' }));
  const p = g.state.projects[0];
  while (p.phase === 'design' || p.testWeeks < 2) g.tick();
  ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'blue', wheels: 0 }));
  return { g, a, b: allGens(g.state)[1] };
}

describe('조회 함수(화면용)', () => {
  it('staffInfo: 직무·능력·잠재력 도달·월급·컨디션·상태·교육 가능 여부와 이유', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    g.state.cash = 1e7;
    ok(g.command({ type: 'startProject', ...SPEC, team: [1, 2] }));
    ok(g.command({ type: 'train', staffId: 3 }));
    ok(g.command({ type: 'rest', staffId: 4, weeks: 3 }));
    const rows = staffInfo(g.state);
    expect(rows.map((r) => r.status)).toEqual(['working', 'working', 'training', 'resting']);
    expect(rows[2]).toMatchObject({ weeksLeft: 4, canTrain: false, trainReason: '이미 교육 중입니다.', trainingsThisYear: 1 });
    expect(rows[3]).toMatchObject({ weeksLeft: 3, canTrain: false, trainReason: '휴식 중에는 교육할 수 없습니다.' });
    const x = g.state.staff[0];
    expect(rows[0]).toMatchObject({ id: x.id, role: x.role, ability: x.ability, potential: x.potential, atPotential: false, salary: salaryOf(x.ability), condition: 1, conditionMult: 1, projectId: g.state.projects[0].id, canTrain: true, trainCost: Math.max(500, x.ability * 40), severance: 2 * salaryOf(x.ability) });
  });
  it('hiringInfo: 정원·공고비·후보와 남은 주', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    expect(hiringInfo(g.state)).toMatchObject({ staffCount: 4, capacity: 6, full: false, canPost: true, candidates: [] });
    g.state.hqLevel = 1; g.state.staff.push(...g.state.staff.slice(0, 2).map((x, i) => ({ ...x, id: 100 + i })));
    expect(hiringInfo(g.state)).toMatchObject({ staffCount: 6, capacity: 6, full: true, canPost: false });
    g.state.staff = g.state.staff.slice(0, 4);
    expect(hiringInfo(g.state).tiers.map((t) => t.cost)).toEqual([500, 2000, 10000]);
    g.state.cash = 1e7; ok(g.command({ type: 'upgradeHQ' })); ok(g.command({ type: 'postJob', role: 'designer', tier: 1 }));
    g.tick();
    const h = hiringInfo(g.state);
    expect(h.canPost).toBe(false); expect(h.candidates.map((c) => c.weeksLeft)).toEqual([3, 3, 3]);
  });
});

describe('저장 형식 2 → 4', () => {
  it('형식 2 파일(0.2.0 코드로 만든 픽스처)을 올려서 불러오고 이어서 실행할 수 있다', () => {
    const v2 = JSON.parse(readFileSync('car/tests/fixtures/save-v2.json', 'utf8'));
    expect(v2.saveVersion).toBe(2);
    const g = Game.fromJSON(v2), s = g.state;
    expect(s.saveVersion).toBe(4);
    expect(s.hqLevel).toBe(1); expect(s.factory).toEqual({ level: 1, build: null }); expect(s.candidates).toEqual([]); expect(s.pendingOneOff).toBe(0);
    for (const x of s.staff) { expect(x.potential).toBe(Math.max(60, x.ability)); expect(x.trainings).toEqual([]); expect(x.restUntil).toBeNull(); }
    for (const x of allGens(s)) { expect(x.allocShare).toBeNull(); expect(x.lostSales).toBe(0); }
    for (const e of s.ledger) expect(e.oneOff).toBe(0);
    expect(s.projects[0]).toMatchObject({ kind: 'facelift' }); // 진행 중이던 페이스리프트
    const bot = steady();
    for (let i = 0; i < 48 * 3 && s.status === 'playing'; i++) { bot.step(g); g.tick(); }
    expect(s.status).toBe('playing');
    expect(allGens(s).length).toBeGreaterThanOrEqual(2);
    // 올린 상태도 저장 왕복 = 끊지 않은 실행
    const a = Game.fromJSON(v2), b = Game.fromJSON(JSON.parse(JSON.stringify(Game.fromJSON(v2).toJSON())));
    for (let i = 0; i < 48 * 2; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
  it('회사 명령(채용·교육·증설·배분)이 섞인 게임도 저장 → 불러오기 → 이어서 = 끊지 않은 실행', () => {
    const play = (g: Game, from: number, to: number) => {
      const bot = steady();
      for (let w = from; w < to && g.state.status === 'playing'; w++) {
        if (w === 20) { g.state.cash += 1e6; g.command({ type: 'upgradeHQ' }); g.command({ type: 'postJob', role: 'sales', tier: 2 }); }
        if (w === 21 && g.state.candidates.length) g.command({ type: 'hire', candidateId: g.state.candidates[2].id });
        if (w === 30) g.command({ type: 'expandFactory' });
        bot.step(g); g.tick();
      }
    };
    const whole = Game.create({ difficulty: 'normal', seed: 11 });
    play(whole, 0, 48 * 5);
    const part = Game.create({ difficulty: 'normal', seed: 11 });
    play(part, 0, 48 + 7);
    const loaded = Game.fromJSON(JSON.parse(JSON.stringify(part.toJSON())));
    play(loaded, 48 + 7, 48 * 5);
    expect(JSON.stringify(loaded.toJSON())).toBe(JSON.stringify(whole.toJSON()));
    expect(whole.state.staff.some((x) => x.role === 'sales')).toBe(true);
    expect(whole.state.factory.level).toBeGreaterThanOrEqual(2);
  });
});

describe('3단계 후속 보정 장치', () => {
  it('팀 규모 체감: n명이면 산출 × (n/4)^(−k), 4명 이하는 1. planPreview에도 반영', () => {
    const k = config.dev.teamExp;
    expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(0.6);
    expect(teamSizeMult(1)).toBe(1); expect(teamSizeMult(4)).toBe(1);
    expect(teamSizeMult(8)).toBeCloseTo(2 ** -k, 12); expect(teamSizeMult(20)).toBeCloseTo(5 ** -k, 12);
    const x = Game.create({ difficulty: 'normal', seed: 1 }).state.staff[1], spec = { budget: 'normal' as const, direction: SPEC.direction };
    const one = designWeekByStaff([x], spec, () => 1)[0].P, eight = designWeekByStaff(Array(8).fill(x), spec, () => 1);
    expect(eight[0].P).toBeCloseTo(one * 2 ** -k, 12);
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    s.staff = Array.from({ length: 8 }, (_, i) => ({ ...s.staff[i % 4], id: i + 1 }));
    expect(planPreview(s, SPEC).avg).toBeLessThan(planPreview(s, SPEC, s.staff.slice(0, 4)).avg * 2);
    expect(planPreview(s, SPEC).avg).toBeGreaterThan(planPreview(s, SPEC, s.staff.slice(0, 4)).avg);
  });
  it('경쟁사의 성장: 기본 A는 1970년 base에서 해마다 baseGrowth씩 올라 baseMax에서 멈추고, 새 모델은 그 해 값을 쓴다', () => {
    const r = config.rivals;
    expect(rivalBase(0)).toBe(r.base);
    expect(rivalBase(120)).toBeCloseTo(Math.min(r.baseMax, r.base + 10 * r.baseGrowth), 12);
    expect(rivalBase(12 * 60)).toBe(r.baseMax);
    const g = Game.create({ difficulty: 'normal', seed: 8 });
    g.state.cash = 1e12;
    for (let i = 0; i < 48 * 30; i++) g.tick();
    for (const rv of g.state.rivals) for (const body of Object.keys(rv.models)) {
      const md = rv.models[body], cell = (RIVALS.find((x) => x.id === rv.id)!.cells[body] ?? 0);
      expect(md.base - cell).toBeCloseTo(rivalBase(md.start), 0); // ± 난수 0.1
      expect(Math.abs(md.base - cell - rivalBase(md.start))).toBeLessThanOrEqual(r.noise + 1e-12);
    }
  });
  it('7) 직원 20명·본사 5등급: 균등 배분·보통 예산·중간 설계 기간 차의 표시 등급 평균이 1985~1995년 기준 6~9(0.4.2: 1990년부터 기준 상승이 느려져 상한 8.5 → 9)', () => {
    for (const year of [1985, 1990, 1995]) {
      const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
      s.week = (year - 1970) * 48; s.hqLevel = 5;
      const roles = [...Array(5).fill('designer'), ...Array(10).fill('engineer'), ...Array(5).fill('tester')] as Staff['role'][];
      s.staff = roles.map((role, i) => ({ id: i + 1, name: `직원${i}`, role, ability: 60 + ((i * 7) % 21), potential: 100, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false })); // 능력 60~80
      const avg = planPreview(s, { ...SPEC, body: 'sedanM', segment: 'family' }).avg;
      console.log(`7) ${year}년 20명 팀 예상 등급 ${avg.toFixed(2)}`);
      expect(avg).toBeGreaterThanOrEqual(6); expect(avg).toBeLessThanOrEqual(9);
    }
  });
});
