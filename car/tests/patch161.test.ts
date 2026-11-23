// 1.6.1 세대교체 위임의 팀: 위임으로 낸 차의 평론이 플레이어가 '전작 그대로'로 만든 차보다 크게 낮던 문제(사용자 보고)
import { describe, it, expect, vi } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { config } from '../src/config';
import { nextGenSpec } from '../src/sim/execs';
import { carBasePrice } from '../src/sim/market';
import { latestGen } from '../src/sim/lifecycle';
import type { ExecRole, Role } from '../src/sim/types';
import { SPEC, grant, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 120_000 });

/** 1990년, 본사 5등급(개발팀 3), 개발 직원 15명(능력 40~80), 첫 세대를 전원으로 실제 개발해 출시하고 풀체인지 때(60개월)로 돌린 게임 */
function setup(seed: number): Game {
  const g = Game.create({ difficulty: 'normal', seed }), s = g.state;
  s.week = 20 * 48; s.cash = 1e10; s.hqLevel = 5; s.factory.level = 5; s.reputation = 60;
  grant(g);
  s.staff = s.staff.filter((x) => x.role === 'sales');
  const roles: Role[] = ['designer', 'engineer', 'tester'];
  for (let i = 0; i < 15; i++) s.staff.push({ id: s.nextId++, name: `직원${i}`, role: roles[i % 3], ability: 40 + ((i * 37) % 41), potential: 95, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false });
  ok(g.command({ type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' }));
  const p = s.projects[0];
  while (!(p.waiting || p.testWeeks >= 28)) g.tick();
  ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(s, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
  for (const x of s.staff) { x.condition = 1; x.restUntil = null; }
  const gen = latestGen(s.nameplates[0]); gen.launchMonth -= 60; gen.lifeMonth -= 60;
  return g;
}
function product(g: Game): void {
  const role: ExecRole = 'product';
  ok(g.command({ type: 'postExecJob', role }));
  ok(g.command({ type: 'hireExec', role, candidateId: g.state.execs!.candidates.find((c) => c.role === role)!.id }));
  const x = g.state.execs!.seats[role]!.staff; x.ability = x.potential = 80;
}
const devIdle = (g: Game) => g.state.staff.filter((x) => x.role !== 'sales' && x.projectId === null).map((x) => x.id);

describe('1.6.1 세대교체 위임 팀', () => {
  it('차종 하나를 위임하면 쉬는 개발 직원 전원으로 풀체인지하고, 평론이 플레이어가 전원으로 만든 차보다 낮지 않다(0.3 이내)', () => {
    for (const seed of [1, 2]) {
      const a = setup(seed), b = Game.fromJSON(a.toJSON()), n = a.state.nameplates[0];
      // 플레이어: 전작 그대로 + 쉬는 개발 직원 전원, 결함을 다 잡으면(또는 시험 maxTestWeeks주) 시장 기준가로 출시
      ok(a.command({ type: 'startFullChange', nameplateId: n.id, ...nextGenSpec(a.state, n.id)!, team: devIdle(a) }));
      const p = a.state.projects[0];
      while (!(p.waiting || p.testWeeks >= config.genAuto.maxTestWeeks)) a.tick();
      ok(a.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(a.state, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
      const mine = allGens(a.state).at(-1)!.reviewAvg;
      // 위임
      product(b);
      const idle = devIdle(b);
      ok(b.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
      toMonthEnd(b);
      expect(b.state.projects[0]).toMatchObject({ kind: 'fullchange', auto: true });
      expect(b.state.staff.filter((x) => x.projectId === b.state.projects[0].id).map((x) => x.id).sort((x, y) => x - y)).toEqual(idle.sort((x, y) => x - y));
      for (let i = 0; i < 80 && latestGen(b.state.nameplates[0]).number < 2; i++) b.tick();
      const auto = latestGen(b.state.nameplates[0]);
      expect(auto.number).toBe(2);
      expect(auto.reviewAvg, `시드 ${seed}: 위임 ${auto.reviewAvg} / 직접 ${mine}`).toBeGreaterThanOrEqual(mine - 0.3);
    }
  });

  it('다른 개발에 직원이 묶여 한 명만 쉬고 있으면 1명 팀으로 시작하지 않고(전작 8점대 → 2점대가 되던 경로), 직원이 돌아오면 전원으로 시작해 전작보다 낫다', () => {
    const g = setup(1), s = g.state, n = s.nameplates[0], prev = latestGen(n).reviewAvg;
    product(g);
    const tester = s.staff.find((x) => x.role === 'tester')!;
    ok(g.command({ type: 'startProject', ...SPEC, name: '플레이어 차', body: 'hatch', segment: 'youth', team: devIdle(g).filter((id) => id !== tester.id) }));
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
    toMonthEnd(g);
    expect(s.projects.filter((p) => p.auto).length).toBe(0);
    const mine = s.projects[0];
    while (!(mine.waiting || mine.testWeeks >= 28)) g.tick();
    ok(g.command({ type: 'launch', projectId: mine.id, price: Math.round(carBasePrice(s, mine) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
    toMonthEnd(g);
    const p = s.projects.find((x) => x.auto)!;
    expect(s.staff.filter((x) => x.projectId === p.id).length).toBe(15);
    for (let i = 0; i < 80 && latestGen(n).number < 2; i++) g.tick();
    expect(latestGen(n).reviewAvg).toBeGreaterThan(prev);
  });

  it('필요한 직무(테스터)가 쉬고 있지 않으면 시작하지 않고 기다리며, 오래 못 하면 그 이유를 보고한다', () => {
    const g = setup(1), s = g.state, n = s.nameplates[0];
    product(g);
    for (const x of s.staff) if (x.role === 'tester') x.lab = true;
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
    for (let m = 0; m <= config.genAuto.waitReportMonths; m++) toMonthEnd(g);
    expect(s.projects.length).toBe(0);
    const w = s.execs!.reports.filter((r) => r.kind === 'autoGenWait');
    expect(w.length).toBe(1); expect(w[0].text).toContain('테스터');
    for (const x of s.staff) x.lab = false;
    toMonthEnd(g);
    expect(s.projects[0]).toMatchObject({ kind: 'fullchange', auto: true });
  });
});
