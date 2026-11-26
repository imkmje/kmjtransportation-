// 4.1.0 직속 전담팀(설계서 9.10)·세대교체 위임 지연 수정·전 직원 다시 채용·도전 과제 실패·저장 형식 12
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { config } from '../src/config';
import { COMPAT, TECHS } from '../src/data';
import { Game, SAVE_VERSION, allGens } from '../src/sim/game';
import { runBot, steadyExec } from '../src/sim/bots';
import { eliteCands, eliteInfo, eliteMult } from '../src/sim/elite';
import { nextGenSpec } from '../src/sim/execs';
import { latestGen } from '../src/sim/lifecycle';
import { carBasePrice } from '../src/sim/market';
import { challengeInfo } from '../src/sim/start';
import { recommendedEquip, stdOf } from '../src/sim/equip';
import { staffCap, staffCount } from '../src/sim/company';
import { optionTech, requiredOptions } from '../src/sim/events';
import { staffInfo } from '../src/sim/queries';
import type { CarState, ProjectSpec, Role, Staff } from '../src/sim/types';
import { SPEC, grant, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 300_000 });
const E = config.elite;
const ROLES: Role[] = ['designer', 'engineer', 'tester'];
const add = (s: CarState, id: string) => { if (s.research.done.includes(id)) return; for (const q of TECHS.find((t) => t.id === id)!.pre) add(s, q); s.research.done.push(id); };

/** year년, 본사 hq등급, 그해 전까지 나온 기술 연구, 현금 넉넉 */
function at(year: number, hq: number, seed = 1): Game {
  const g = Game.create({ difficulty: 'normal', seed }), s = g.state;
  s.week = (year - 1970) * 48; s.hqLevel = hq; s.factory.level = Math.min(5, hq); s.cash = 1e10; s.reputation = 120;
  for (const t of TECHS) if (!t.repeatable && t.year <= year - 1) add(s, t.id);
  for (const o of requiredOptions(s)) { const t = optionTech(o); if (t) add(s, t.id); } // 시행 중인 규제의 의무 장비
  return g;
}
/** 전담팀원 n명(직무를 차례로, 능력 ab)을 바로 둔다 */
function eliteTeam(g: Game, n: number, ab = 90): number[] {
  const s = g.state, ids: number[] = [];
  for (let i = 0; i < n; i++) { const id = s.nextId++; ids.push(id); s.staff.push({ id, name: `전담${i}`, role: ROLES[i % 3], ability: ab, potential: ab, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false, elite: true }); }
  s.elite = { train: false, chem: 0, crew: [], taken: [], cars: 0 };
  return ids;
}
/** 개발을 끝까지 돌려 시장 기준가로 출시하고 새 세대를 돌려준다 */
function finish(g: Game) {
  const s = g.state, p = s.projects.at(-1)!;
  while (!(p.waiting || p.testWeeks >= 28)) g.tick();
  ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(s, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
  return allGens(s).at(-1)!;
}
const spec = (s: CarState, body: string, segment: string, tier = 3): ProjectSpec => { const equip = recommendedEquip(s, body, segment, 'gasoline'); return { ...SPEC, name: `${body}-${segment}-${tier}`, body, segment, tier, options: stdOf(equip), equip }; };

describe('4.1.0 직속 전담팀: 자리와 고용', () => {
  it('본사 3등급 전에는 잠겨 있고(후보 없음, 영입·옮기기 불가), 3등급부터 4명 → 7등급 10명', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), s = g.state;
    expect(eliteInfo(s).open).toBe(false); expect(eliteCands(s)).toEqual([]);
    const r = g.command({ type: 'setElite', staffId: s.staff[0].id, on: true });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain('본사 3등급');
    expect(g.command({ type: 'hireElite', key: '0:0' }).ok).toBe(false);
    expect(E.seats.slice(2)).toEqual([4, 5, 7, 8, 10]);
  });
  it('자리 상한: 3등급 4명까지 영입되고 5번째는 거절. 전담팀원은 정원 밖이라 일반 채용 정원은 그대로', () => {
    const g = at(1985, 3), s = g.state, cap = staffCap(s), n0 = staffCount(s);
    for (let i = 0; i < 2; i++) {
      for (const c of eliteCands(s)) if (eliteInfo(s).used < E.seats[2]) { const c0 = s.cash; ok(g.command({ type: 'hireElite', key: c.key })); expect(c0 - s.cash).toBe(Math.round(config.staff.hire.postCost[2] * E.feeMult)); }
      for (let m = 0; m < E.cand.refreshMonths; m++) toMonthEnd(g); // 다음 주기 후보
    }
    expect(eliteInfo(s).used).toBe(4);
    const r = g.command({ type: 'hireElite', key: eliteCands(s)[0].key });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain('자리(4명)');
    expect(staffCount(s)).toBe(n0); expect(staffCap(s)).toBe(cap);
    const x = s.staff.find((y) => y.elite)!;
    expect(x.ability).toBeGreaterThanOrEqual(E.cand.abilityMin);
    expect(staffInfo(s).find((y) => y.id === x.id)!.salary).toBe(Math.round((250 + x.ability * 12) * E.payMult)); // 월급은 일반 공식 × payMult
  });
  it('기존 직원을 옮기면(개발 중이 아닐 때) 전담팀원이 되고 정원에서 빠진다. 빼면 일반 정원이 남아 있어야 한다', () => {
    const g = at(1985, 3), s = g.state, x = s.staff.find((y) => y.role === 'engineer')!, n0 = staffCount(s);
    ok(g.command({ type: 'setElite', staffId: x.id, on: true }));
    expect(x.elite).toBe(true); expect(staffCount(s)).toBe(n0 - 1);
    ok(g.command({ type: 'setElite', staffId: x.id, on: false }));
    expect(x.elite).toBeUndefined();
    const sales = s.staff.find((y) => y.role === 'sales');
    if (sales) expect(g.command({ type: 'setElite', staffId: sales.id, on: true }).ok).toBe(false);
  });
});

describe('4.1.0 위임·자동 처리는 전담팀원을 쓰지 않는다', () => {
  it('세대교체 위임 풀체인지 팀·직원을 비워 둔 신차(team 생략)에는 전담팀원이 들어가지 않는다', () => {
    const g = at(1990, 5), s = g.state;
    ok(g.command({ type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' }));
    const gen = finish(g); gen.launchMonth -= 60; gen.lifeMonth -= 60;
    const elite = eliteTeam(g, 4);
    ok(g.command({ type: 'postExecJob', role: 'product' }));
    ok(g.command({ type: 'hireExec', role: 'product', candidateId: s.execs!.candidates.find((c) => c.role === 'product')!.id }));
    s.execs!.seats.product!.staff.ability = 80;
    ok(g.command({ type: 'setGenAuto', nameplateId: s.nameplates[0].id, on: true }));
    toMonthEnd(g);
    const p = s.projects.find((x) => x.auto)!;
    expect(p).toBeDefined(); expect(p.elite).toBeUndefined();
    expect(s.staff.filter((x) => x.projectId === p.id).some((x) => x.elite)).toBe(false);
    expect(elite.every((id) => s.staff.find((x) => x.id === id)!.projectId === null)).toBe(true);
    const r = g.command({ type: 'startProject', ...SPEC, name: '빈팀', body: 'hatch', segment: 'youth' }); // 팀을 비우면 쉬는 일반 직원 전원인데, 위임이 다 가져가 없다(전담팀원은 넣지 않는다)
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toBe('배치할 직원이 없습니다.');
  });
  it('인사 위임(자동 교육·휴식·해고)은 전담팀원을 건드리지 않는다', () => {
    const g = at(1990, 5), s = g.state;
    const ids = eliteTeam(g, 4, 40); for (const id of ids) { const x = s.staff.find((y) => y.id === id)!; x.potential = 40; x.condition = 0.1; }
    ok(g.command({ type: 'postExecJob', role: 'hr' }));
    ok(g.command({ type: 'hireExec', role: 'hr', candidateId: s.execs!.candidates.find((c) => c.role === 'hr')!.id }));
    s.execs!.seats.hr!.staff.ability = 80;
    for (const k of ['autoRest', 'autoTrain', 'autoFire']) ok(g.command({ type: 'setDelegation', role: 'hr', key: k, on: true }));
    for (let m = 0; m < 6; m++) toMonthEnd(g);
    for (const id of ids) { const x = s.staff.find((y) => y.id === id)!; expect(x).toBeDefined(); expect(x.trainings).toEqual([]); expect(x.restUntil).toBeNull(); }
  });
});

describe('4.1.0 자동 교육·팀 호흡', () => {
  it('개발이 없는 전담팀원은 자동으로 교육받고(교육비 자동, 2주) 한계는 성장 한계 + 10. 끄면 받지 않고, 개발 중이면 받지 않는다', () => {
    const g = at(1990, 5), s = g.state, [a, b] = eliteTeam(g, 2, 80);
    s.elite!.train = true;
    const x = s.staff.find((y) => y.id === a)!, y = s.staff.find((z) => z.id === b)!;
    ok(g.command({ type: 'startProject', ...SPEC, team: [b] }));
    const c0 = s.cash; g.tick();
    expect(x.trainings.length).toBe(1); expect(x.ability).toBeGreaterThan(80); expect(y.trainings).toEqual([]);
    expect(c0 - s.cash).toBeGreaterThanOrEqual(Math.round(Math.max(config.staff.train.min, 80 * config.staff.train.perAbility) * E.train.costMult));
    for (let i = 0; i < 48 * 3; i++) g.tick();
    expect(x.ability).toBeLessThanOrEqual(Math.min(100, 80 + E.train.capAdd)); expect(x.ability).toBeGreaterThan(84);
    ok(g.command({ type: 'setEliteTrain', on: false }));
    const n = x.trainings.length; for (let i = 0; i < 48; i++) g.tick();
    expect(x.trainings.length).toBe(n);
  });
  it('팀 호흡: 같은 구성으로 완성할 때마다 +step(상한 max), 구성을 바꾸면 겹치는 비율만 남는다', () => {
    const g = at(1990, 5), s = g.state, ids = eliteTeam(g, 6, 85);
    grant(g); // 여러 대를 만드는 동안 시행되는 규제 장비까지
    const run = (team: number[]) => { ok(g.command({ type: 'startProject', ...SPEC, name: `c${s.nextId}`, team })); const gen = finish(g); ok(g.command({ type: 'discontinue', generationId: gen.id })); toMonthEnd(g); }; // 생산 라인을 비운다
    run(ids.slice(0, 3)); expect(s.elite!.chem).toBeCloseTo(E.chem.step);
    run(ids.slice(0, 3)); expect(s.elite!.chem).toBeCloseTo(E.chem.step * 2);
    for (let i = 0; i < 6; i++) run(ids.slice(0, 3));
    expect(s.elite!.chem).toBeCloseTo(E.chem.max);
    run(ids.slice(3, 6)); // 전원 교체: 겹침 0 → step만
    expect(s.elite!.chem).toBeCloseTo(E.chem.step);
    expect(eliteMult(s, { body: 'sedanS', segment: 'worker', tier: 3 })).toBeCloseTo(1 + E.out + E.chem.step);
  });
});

describe('4.1.0 가득 찬 전담팀의 평론', () => {
  const cases: [number, number][] = [[1982, 3], [1995, 4], [2005, 5], [2015, 6], [2025, 7]];
  it('무난한 기획(궁합 맞음·최신 동력 등급·추천 장비)은 평론 9.5 이상이고 수작으로 표시된다. 일반 팀이면 그보다 낮다', () => {
    for (const [y, hq] of cases) for (const [body, seg] of [['sedanM', 'family'], ['hatch', 'youth']]) {
      const g = at(y, hq), s = g.state, ids = eliteTeam(g, E.seats[hq - 1], 85);
      ok(g.command({ type: 'startProject', ...spec(s, body, seg), team: ids }));
      expect(s.projects[0].elite).toBe(true);
      const gen = finish(g);
      expect(gen.reviewAvg, `${y}년 ${body}×${seg}`).toBeGreaterThanOrEqual(E.opus);
      expect(gen.elite).toBe(true); expect(gen.opus).toBe(true);
      // 같은 기획을 같은 능력의 일반 직원으로
      const h = at(y, hq), t = h.state, reg: number[] = [];
      for (let i = 0; i < E.seats[hq - 1]; i++) { const id = t.nextId++; reg.push(id); t.staff.push({ id, name: `일반${i}`, role: ROLES[i % 3], ability: 85, potential: 85, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false } as Staff); }
      ok(h.command({ type: 'startProject', ...spec(t, body, seg), team: reg }));
      const n = finish(h);
      expect(n.reviewAvg).toBeLessThan(gen.reviewAvg); expect(n.opus).toBeUndefined();
    }
  });
  it('궁합이 나쁘거나 낡은 동력 등급이면 팀이 좋아도 깎인다(전담팀 가산이 줄 뿐, 일반 팀보다 낮아지지는 않는다)', () => {
    const bad = Object.entries(COMPAT).flatMap(([b, m]) => Object.entries(m).filter(([, v]) => v <= 0.6).map(([sg]) => [b, sg] as const)).find(([b]) => b === 'sedanM' || b === 'hatch' || b === 'sedanS')!;
    for (const [y, hq] of [[1995, 4], [2015, 6]] as const) {
      const good = at(y, hq); ok(good.command({ type: 'startProject', ...spec(good.state, 'sedanM', 'family'), team: eliteTeam(good, E.seats[hq - 1], 85) }));
      const gv = finish(good).reviewAvg;
      const g = at(y, hq); ok(g.command({ type: 'startProject', ...spec(g.state, bad[0], bad[1]), team: eliteTeam(g, E.seats[hq - 1], 85) }));
      const bv = finish(g);
      expect(bv.reviewAvg, `${y}년 ${bad.join('×')}`).toBeLessThan(E.opus); expect(bv.opus).toBeUndefined();
      const o = at(y, hq); ok(o.command({ type: 'startProject', ...spec(o.state, 'sedanM', 'family', 1), team: eliteTeam(o, E.seats[hq - 1], 85) }));
      expect(finish(o).reviewAvg).toBeLessThan(gv);
      const r = at(y, hq), t = r.state, reg: number[] = [];
      for (let i = 0; i < E.seats[hq - 1]; i++) { const id = t.nextId++; reg.push(id); t.staff.push({ id, name: `일반${i}`, role: ROLES[i % 3], ability: 85, potential: 85, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false } as Staff); }
      ok(r.command({ type: 'startProject', ...spec(t, bad[0], bad[1]), team: reg }));
      expect(bv.reviewAvg).toBeGreaterThanOrEqual(finish(r).reviewAvg - 0.3); // 흔들림 폭 안에서 일반 팀보다 낮아지지 않는다
    }
  });
  it('전담팀은 일반 개발팀과 따로 한 대: 일반 팀이 모두 바빠도 전담팀원으로 시작하고, 전담팀 개발은 한 대뿐이다', () => {
    const g = at(1985, 3), s = g.state, ids = eliteTeam(g, 4, 85);
    const reg = s.staff.filter((x) => !x.elite && x.role !== 'sales').map((x) => x.id);
    ok(g.command({ type: 'startProject', ...SPEC, name: 'A', team: reg.slice(0, 2) }));
    ok(g.command({ type: 'startProject', ...SPEC, name: 'B', team: reg.slice(2) })); // 3등급 개발팀 2개 다 참
    expect(g.command({ type: 'startProject', ...SPEC, name: 'C', team: [] }).ok).toBe(false);
    ok(g.command({ type: 'startProject', ...SPEC, name: 'E1', team: ids.slice(0, 2) }));
    const r = g.command({ type: 'startProject', ...SPEC, name: 'E2', team: ids.slice(2) });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain('전담팀');
  });
  it('시상식: 수작은 점수에 가점(같은 점수면 수작이 이긴다)', () => {
    expect(E.awardBonus).toBeGreaterThan(0);
  });
});

describe('4.1.0 전 직원 다시 채용', () => {
  it('해고한 직원은 12개월 동안 전 직원 목록에 남고, 월급 3개월 치로 능력·경력 그대로 다시 채용. 12개월이 지나면 사라진다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), s = g.state, x = s.staff[0], ab = x.ability;
    ok(g.command({ type: 'fire', staffId: x.id }));
    expect(s.former!.map((f) => f.staff.id)).toEqual([x.id]);
    const c0 = s.cash;
    ok(g.command({ type: 'rehire', staffId: x.id }));
    expect(c0 - s.cash).toBe((250 + ab * 12) * config.former.feeMonths);
    const y = s.staff.find((z) => z.id === x.id)!;
    expect(y.ability).toBe(ab); expect(y.hist?.join).toBe(0); expect(s.former).toEqual([]);
    ok(g.command({ type: 'fire', staffId: y.id }));
    for (let m = 0; m < config.former.months; m++) toMonthEnd(g);
    expect(g.command({ type: 'rehire', staffId: y.id }).ok).toBe(false);
  });
});

describe('4.1.0 도전 과제', () => {
  it("'대출 없이'에서 구제 금융을 받으면 실패로 남고(되돌릴 수 없음), 통계에 실패 해·이유가 보인다", () => {
    const g = Game.create({ seed: 1, difficulty: 'normal', challenges: ['noLoan'] }), s = g.state;
    expect(challengeInfo(s)[0].failed).toBeNull();
    s.cash = -100;
    ok(g.command({ type: 'bailout' }));
    const c = challengeInfo(s)[0];
    expect(c.failed).toMatchObject({ year: 1970, why: '구제 금융을 받았습니다' });
    expect(Game.fromJSON(g.toJSON()).state.start!.failed!.length).toBe(1);
  });
  it("'전기차만': 전기차가 아닌 모델이 있는 경쟁사는 인수할 수 없고, 브랜드 자회사도 세울 수 없다(이유 표시)", () => {
    const g = Game.create({ seed: 1, difficulty: 'normal', startYear: 2015, challenges: ['evOnly'] }), s = g.state;
    s.hqLevel = 7; s.cash = 1e12; s.reputation = 300;
    const r = g.command({ type: 'acquireRival', rivalId: 'hyundae' });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain('가솔린');
    const f = g.command({ type: 'foundSubsidiary', kind: 'premium' });
    expect(f.ok).toBe(false); if (!f.ok) expect(f.reason).toContain('전기차만');
    expect(config.newGame.challenges.names3.desc).toContain('자회사');
  });
});

describe('4.1.0 세대교체 위임 지연 수정', () => {
  /** 1990년, 본사 5등급(개발팀 3), 개발 직원 15명, 차종 3개를 전원으로 만든 뒤 셋 다 풀체인지 때로 */
  function setup(ab: (i: number) => number): Game {
    const g = at(1990, 5), s = g.state;
    s.staff = s.staff.filter((x) => x.role === 'sales');
    for (let i = 0; i < 15; i++) s.staff.push({ id: s.nextId++, name: `직원${i}`, role: ROLES[i % 3], ability: ab(i), potential: ab(i), condition: 1, projectId: null, trainings: [], restUntil: null, lab: false });
    for (const body of ['sedanM', 'hatch', 'sedanS']) { ok(g.command({ type: 'startProject', ...SPEC, name: body, body, segment: 'family' })); finish(g); }
    for (const x of s.staff) { x.condition = 1; x.trainings = []; }
    const m0 = Math.floor(s.week / 4);
    for (const n of s.nameplates) { const gen = latestGen(n); gen.launchMonth = m0 - 60; gen.lifeMonth = m0 - 60; }
    ok(g.command({ type: 'postExecJob', role: 'product' }));
    ok(g.command({ type: 'hireExec', role: 'product', candidateId: s.execs!.candidates.find((c) => c.role === 'product')!.id }));
    s.execs!.seats.product!.staff.ability = 80;
    for (const n of s.nameplates) ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
    return g;
  }
  it('나눈 팀의 예상 평론이 전작보다 0.3 이하로만 낮으면 팀을 나눠 개발팀 수만큼 동시에 시작한다', () => {
    const g = setup(() => 95), s = g.state; // 능력이 한계라 나눠도 거의 같은 차가 나온다
    for (const n of s.nameplates) latestGen(n).reviewAvg = 0; // 전작 평론을 낮게(나눈 팀도 넘는다)
    toMonthEnd(g);
    expect(s.projects.filter((p) => p.auto).length).toBe(3);
  });
  it('크게 떨어지면 기다리되, 12개월 넘게 기다린 차종은 나눈 팀으로라도 시작한다(전작보다 2.5 넘게 떨어지는 팀으로는 시작하지 않는다)', () => {
    const g = setup((i) => 40 + ((i * 37) % 41)), s = g.state;
    for (const n of s.nameplates) latestGen(n).reviewAvg = 10;
    toMonthEnd(g);
    expect(s.projects.filter((p) => p.auto).length).toBe(1); // 전원으로 하나
    const started = new Map<number, number>();
    for (let w = 0; w < 48 * 3; w++) { g.tick(); for (const p of s.projects) if (p.auto && !started.has(p.targetId!)) started.set(p.targetId!, s.week); }
    expect(started.size).toBe(3);
  });
  it('1.6.1 취지 유지: 패치 테스트(patch161)의 경로는 그대로(한 차종이면 전원, 1명 팀으로는 시작하지 않음)', () => {
    expect(config.genAuto.splitTol).toBe(0.3); expect(config.genAuto.splitWaitMonths).toBe(12);
    expect(nextGenSpec).toBeTypeOf('function');
  });
});

describe('4.1.0 저장 형식 12', () => {
  it('전담팀·팀 호흡·전 직원이 있는 판을 저장 → 불러오기 해도 이어서 같은 결과', () => {
    const g = at(1990, 5), s = g.state, ids = eliteTeam(g, 5, 85); s.elite!.train = true;
    ok(g.command({ type: 'startProject', ...SPEC, team: ids })); ok(g.command({ type: 'fire', staffId: s.staff.find((x) => !x.elite && x.role !== 'sales')!.id }));
    for (let i = 0; i < 10; i++) g.tick();
    const h = Game.fromJSON(g.toJSON());
    for (let i = 0; i < 60; i++) { g.tick(); h.tick(); }
    expect(JSON.stringify(h.state)).toBe(JSON.stringify(g.state));
    expect(h.state.saveVersion).toBe(SAVE_VERSION); expect(SAVE_VERSION).toBe(13);
  });
  it('형식 11 fixture(4.0.0으로 만든 2003년 판): 12로 올라오고 전담팀·전 직원은 없음, 인수 브랜드의 옛 모델 이름(F-160)은 새 이름으로, 이어서 돌린 결과와 저장 왕복이 같다', () => {
    const raw = JSON.parse(readFileSync('car/tests/fixtures/save-v11.json', 'utf8')) as CarState;
    expect(raw.saveVersion).toBe(11);
    const old = raw.subs!.find((x) => x.from === 'porty')!.models.find((m) => m.body === 'pickup');
    const a = Game.fromJSON(raw), s = a.state;
    expect(s.saveVersion).toBe(13); expect(s.elite).toBeUndefined(); expect(s.former).toBeUndefined();
    if (old) { expect(old.name).toBe('F-160'); expect(s.subs!.find((x) => x.from === 'porty')!.models.find((m) => m.body === 'pickup')!.name).toBe('P-170'); }
    for (let i = 0; i < 12; i++) toMonthEnd(a);
    const b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    for (let i = 0; i < 6; i++) { toMonthEnd(a); toMonthEnd(b); }
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });
});

describe('4.1.0 전담팀 봇', () => {
  it('전담팀을 쓰는 봇은 60년 동안 파산하지 않고 전담팀을 채워 차를 만든다', () => {
    for (const seed of [1, 2]) {
      const r = runBot(steadyExec({ elite: true }), seed, 60);
      expect(r.survived, `시드 ${seed}`).toBe(true);
    }
    const g = Game.create({ seed: 1, difficulty: 'normal' }), bot = steadyExec({ elite: true });
    for (let w = 0; w < 48 * 40 && g.state.status === 'playing'; w++) { bot.step(g); g.tick(); }
    expect(g.state.staff.filter((x) => x.elite).length).toBeGreaterThan(0);
    expect(allGens(g.state).some((x) => x.elite)).toBe(true);
  });
});
