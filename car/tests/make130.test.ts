// 1.3.0 차 만들기: 세대교체 위임, 개발 중 직원 성과, 파생 모델, 평론가별 시승기, 알림 유형, 저장 형식 7
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, linesUsed, sellingGens } from '../src/sim/game';
import { config } from '../src/config';
import { CRITICS, NOTIFY } from '../src/data';
import { derivativeOptions, derivativesOf } from '../src/sim/derive';
import { applyWinsToGen, winStats } from '../src/sim/wins';
import { critiquesOf } from '../src/sim/critiques';
import { eventTopic, newsTopic, topicLocked } from '../src/sim/notify';
import { todoItems } from '../src/sim/queries';
import { genAutoInfo, nextGenSpec } from '../src/sim/execs';
import { genEvInfo } from '../src/sim/ev';
import { carBasePrice, currentEdition, genBasePrice } from '../src/sim/market';
import { fullChangeEligibility, latestGen } from '../src/sim/lifecycle';
import { generationUnitProfit } from '../src/sim/queries';
import { linesOf } from '../src/sim/company';
import { monthOf } from '../src/sim/time';
import type { CarState, ExecRole, GameEvent, Generation, Nameplate, Role, StaffWin } from '../src/sim/types';
import { SPEC, grant, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 240_000 });
const W = 48; // 주/년

/** year년 1월, 연구 전부, 현금 넉넉, 본사 5·공장 levels(라인), 능력 ability인 개발 직원 n명(디자이너·엔지니어·테스터 고르게) */
function big(year = 1990, seed = 1, o: { cash?: number; factory?: number; staff?: number; ability?: number } = {}): Game {
  const g = Game.create({ difficulty: 'normal', seed }), s = g.state;
  s.week = (year - 1970) * W; s.cash = o.cash ?? 1e9; s.hqLevel = 5; s.factory.level = o.factory ?? 5; s.reputation = 60;
  grant(g);
  const roles: Role[] = ['designer', 'engineer', 'tester'];
  for (let i = s.staff.length; i < (o.staff ?? 15); i++) s.staff.push({ id: s.nextId++, name: `직원${i}`, role: roles[i % 3], ability: o.ability ?? 60, potential: 90, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false });
  for (const x of s.staff) { x.ability = o.ability ?? 60; x.potential = Math.min(100, Math.max(x.potential, x.ability + 5)); }
  return g;
}
/** 개발자 메뉴로 바로 출시 대기 → 시장 기준가로 출시. 새로 생긴(또는 바뀐) 세대 */
function quick(g: Game, cmd: Parameters<Game['command']>[0]): Generation {
  ok(g.command(cmd));
  const p = g.state.projects.at(-1)!;
  ok(g.devCheat('finishDev'));
  ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(g.state, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
  return p.kind === 'facelift' ? allGens(g.state).find((x) => x.id === p.targetId)! : allGens(g.state).at(-1)!;
}
/** 실제로 개발해(결함을 다 잡거나 시험 20주) 시장 기준가로 출시. 새로 생긴 세대 */
function real(g: Game, cmd: Parameters<Game['command']>[0]): Generation {
  ok(g.command(cmd));
  const p = g.state.projects.at(-1)!;
  while (!(p.waiting || p.testWeeks >= 20)) g.tick();
  ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(g.state, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
  return allGens(g.state).at(-1)!;
}
const npOf = (s: CarState, g: Generation): Nameplate => s.nameplates.find((n) => n.generations.includes(g))!;
function product(g: Game, skill = 80): void {
  const role: ExecRole = 'product';
  ok(g.command({ type: 'postExecJob', role }));
  ok(g.command({ type: 'hireExec', role, candidateId: g.state.execs!.candidates.find((c) => c.role === role)!.id }));
  const x = g.state.execs!.seats[role]!.staff; x.ability = x.potential = skill;
}
const ticks = (g: Game, n: number, ev: GameEvent[] = []) => { for (let i = 0; i < n; i++) ev.push(...g.tick()); return ev; };

describe('세대교체 위임(기획 임원)', () => {
  it('기획 임원(능력 기준 이상)이 있어야 켤 수 있고, 차종별로 켜고 끈다(기본 꺼짐, 출시도 자동이 기본)', () => {
    const g = big(), car = quick(g, { type: 'startProject', ...SPEC }), n = npOf(g.state, car);
    expect(genAutoInfo(g.state)).toMatchObject({ available: false, cars: [{ nameplateId: n.id, on: false }] });
    expect(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }).ok).toBe(false);
    product(g, config.exec.delegateSkill - 1);
    expect(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }).ok).toBe(false);
    g.state.execs!.seats.product!.staff.ability = 80;
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
    expect(genAutoInfo(g.state).cars[0]).toMatchObject({ on: true, launch: true, active: true });
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true, launch: false }));
    expect(genAutoInfo(g.state).cars[0].launch).toBe(false);
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: false }));
    expect(g.state.execs!.genAuto![n.id]).toBeUndefined();
    expect(g.command({ type: 'setGenAuto', nameplateId: 99999, on: true }).ok).toBe(false);
  });

  it('6차종 + 파생 1종을 위임해 20년: 끊기지 않고 세대교체(세대 나이 84개월 미만, 차종마다 3세대 이상·리프트), 출시까지 위임, 보고가 남는다', () => {
    const g = big(1990, 3, { staff: 18 }), s = g.state;
    const bodies = ['sedanS', 'sedanM', 'sedanL', 'hatch', 'suv', 'minivan'], segs = ['worker', 'family', 'rich', 'youth', 'family', 'family'];
    const firsts = bodies.map((body, i) => { const x = quick(g, { type: 'startProject', ...SPEC, name: `차${i}`, body, segment: segs[i] }); ticks(g, 4 * 4); return x; });
    quick(g, { type: 'startDerivative', generationId: firsts[1].id, variant: 'wagon' });
    product(g);
    for (const n of s.nameplates) ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
    let maxAge = 0;
    const kinds = new Set<string>();
    for (let m = 0; m < 20 * 12; m++) {
      ticks(g, 4);
      for (const r of s.execs!.reports) kinds.add(r.kind);
      for (const n of s.nameplates) {
        const on = n.generations.filter((x) => x.status !== 'discontinued');
        expect(on.length, `${n.name} ${monthOf(s.week)}`).toBeGreaterThan(0);
        maxAge = Math.max(maxAge, ...on.filter((x) => x.status === 'onSale').map((x) => monthOf(s.week) - x.launchMonth));
      }
    }
    expect(s.status).toBe('playing');
    expect(maxAge).toBeLessThan(84);
    for (const n of s.nameplates) {
      expect(n.generations.length, n.name).toBeGreaterThanOrEqual(3);
      expect(n.generations.filter((x) => x.editions.some((e) => e.kind === 'facelift')).length, n.name).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < n.generations.length; i++) if (n.baseOf === undefined) { // 전작 그대로: 차체·고객층·동력
        expect(n.generations[i].body).toBe(n.generations[i - 1].body); expect(n.generations[i].segment).toBe(n.generations[i - 1].segment);
      }
    }
    const wagon = s.nameplates.find((n) => n.variant === 'wagon')!, base = s.nameplates.find((n) => n.id === wagon.baseOf)!;
    expect(wagon.generations.every((x) => x.variant === 'wagon')).toBe(true);
    expect(base.generations.map((x) => x.id)).toEqual(expect.arrayContaining(wagon.generations.map((x) => x.fromGen!)));
    expect([...kinds]).toEqual(expect.arrayContaining(['autoFullChange', 'autoFacelift', 'autoDerive', 'autoLaunch']));
    expect(s.projects.every((p) => p.kind !== 'fix')).toBe(true);
  });

  it('현금이 모자라면 시작하지 않고 기다리며, 오래 못 하면 이유를 한 번만 보고한다. 현금이 생기면 시작한다', () => {
    const g = big(1995, 2), s = g.state, car = quick(g, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' }), n = npOf(s, car);
    product(g);
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
    car.launchMonth -= 62; car.lifeMonth -= 62; // 풀체인지 때
    s.cash = 1000; s.loan.limitMult = 0;
    for (let m = 0; m < 9; m++) { s.cash = Math.max(s.cash, 1000); toMonthEnd(g); }
    expect(s.projects.length).toBe(0);
    const waits = s.execs!.reports.filter((r) => r.kind === 'autoGenWait');
    expect(waits.length).toBe(1); expect(waits[0].text).toContain('현금이');
    expect(s.execs!.genAuto![n.id].waitSince).not.toBeNull();
    s.cash = 1e9; toMonthEnd(g);
    expect(s.projects.length).toBe(1);
    expect(s.projects[0]).toMatchObject({ kind: 'fullchange', targetId: n.id, auto: true, body: 'sedanM', segment: 'family' });
    expect(s.execs!.reports.at(-1)!.kind).toBe('autoFullChange');
    expect(nextGenSpec(s, n.id)).toMatchObject({ body: 'sedanM', segment: 'family', powertrain: car.powertrain });
  });

  it('출시까지 위임한 개발의 출시 대기는 할 일에 잡히지 않고(다음 일까지가 멈추지 않음), 직접 출시일 때만 잡힌다', () => {
    const g = big(1995, 4), s = g.state, car = quick(g, { type: 'startProject', ...SPEC }), n = npOf(s, car);
    product(g);
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
    car.launchMonth -= 31; car.lifeMonth -= 31;
    ok(g.command({ type: 'startFacelift', generationId: car.id, options: [], tier: 2 }));
    ok(g.devCheat('finishDev'));
    const p = s.projects[0], ready = () => todoItems(s).some((x) => x.kind === 'ready');
    expect(p.waiting).toBe(true);
    expect(ready()).toBe(true); // 직접 시작한 개발
    p.auto = true; expect(ready()).toBe(false); // 출시까지 위임한 개발
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true, launch: false })); expect(ready()).toBe(true);
  });

  it('출시 자동을 끄면 개발이 끝나도 출시하지 않는다(플레이어 몫)', () => {
    const g = big(1995, 4), s = g.state, car = quick(g, { type: 'startProject', ...SPEC }), n = npOf(s, car);
    product(g);
    ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true, launch: false }));
    car.launchMonth -= 31; car.lifeMonth -= 31;
    toMonthEnd(g);
    expect(s.projects[0]).toMatchObject({ kind: 'facelift', auto: true });
    ticks(g, 60 * 4);
    expect(s.projects.length).toBe(1); expect(s.projects[0].phase).toBe('test');
  });
});

describe('개발 중 직원 성과', () => {
  /** 팀 능력 ability로 새 차 하나를 개발해 출시까지(시드 여럿), 성과 목록 */
  function wins(ability: number, seeds: number[]): { all: StaffWin[]; per: StaffWin[][]; g: Game[] } {
    const per: StaffWin[][] = [], gs: Game[] = [];
    for (const seed of seeds) {
      const g = big(1985, seed, { ability, staff: 8 }), s = g.state;
      ok(g.command({ type: 'startProject', ...SPEC, designWeeks: config.dev.designWeeks[2] }));
      const p = s.projects[0];
      while (!(p.waiting || p.testWeeks >= 20)) g.tick();
      per.push([...(p.wins ?? [])]); gs.push(g);
    }
    return { all: per.flat(), per, g: gs };
  }
  it('항상 이득이고, 프로젝트당 횟수·종류별 합계 상한을 지킨다. 낸 직원·내용이 뉴스와 직원 기록에 남는다', () => {
    const r = wins(90, [1, 2, 3, 4, 5, 6, 7, 8]), C = config.staffWins;
    expect(r.all.length).toBeGreaterThan(0);
    for (const [i, list] of r.per.entries()) {
      expect(list.length).toBeLessThanOrEqual(C.maxPerProject);
      const sum = (f: (w: StaffWin) => boolean) => list.filter(f).reduce((a, w) => a + w.value, 0);
      expect(sum((w) => w.kind.startsWith('stat:'))).toBeLessThanOrEqual(C.caps.stat + 1e-9);
      expect(sum((w) => w.kind === 'cost')).toBeLessThanOrEqual(C.caps.cost + 1e-9);
      expect(sum((w) => w.kind === 'acclaim')).toBeLessThanOrEqual(C.caps.acclaim + 1e-9);
      expect(sum((w) => w.kind === 'time')).toBeLessThanOrEqual(C.caps.time);
      const s = r.g[i].state;
      for (const w of list) {
        expect(w.value).toBeGreaterThan(0);
        expect(w.text).toContain(w.name); expect(w.text).not.toMatch(/[!]|\(를\)|을\(를\)/);
        expect(s.events.news.some((x) => x.text.includes(w.text) && x.topic === 'dev')).toBe(true);
        expect(s.staff.find((x) => x.id === w.staffId)!.hist!.wins!.some((h) => h.text === w.text && h.project === '테스트카')).toBe(true);
      }
    }
  });
  it('능력이 높을수록 자주 생긴다', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
    expect(wins(90, seeds).all.length).toBeGreaterThan(wins(20, seeds).all.length);
  });
  it('출시 때 반영: 능력치 배수·원가 인하(세대 상한)·인지도, 세대 기록. 대당 이익이 오른다', () => {
    const st = { P: 100, E: 100, U: 100, D: 100, Q: 100 };
    const w = (kind: StaffWin['kind'], value: number): StaffWin => ({ week: 0, staffId: 1, name: 'x', role: 'engineer', kind, value, text: '' });
    expect(winStats({ ...st }, [w('stat:P', 0.03), w('stat:Q', 0.02)])).toEqual({ P: 103, E: 100, U: 100, D: 100, Q: 102 });
    const g = big(), gen = quick(g, { type: 'startProject', ...SPEC }), up0 = generationUnitProfit(gen, g.state), aw0 = gen.awareness;
    applyWinsToGen(gen, [w('cost', 0.01), w('acclaim', 0.03)]);
    expect(gen.costCut).toBeCloseTo(0.01, 12); expect(gen.awareness).toBeCloseTo(aw0 + 0.03, 12); expect(gen.wins!.length).toBe(2 + 0);
    expect(generationUnitProfit(gen, g.state)).toBeGreaterThan(up0);
    applyWinsToGen(gen, [w('cost', 0.02), w('cost', 0.02)]);
    expect(gen.costCut).toBe(config.staffWins.costCutMax);
  });
  it('개발한 프로젝트의 성과가 출시한 세대에 그대로 기록된다', () => {
    const r = wins(90, [1, 2, 3, 4, 5, 6]), i = r.per.findIndex((x) => x.length > 0), g = r.g[i];
    const p = g.state.projects[0];
    ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    expect(allGens(g.state).at(-1)!.wins).toEqual(r.per[i]);
  });
});

describe('파생 모델', () => {
  it('차체·연구에 따라 가능한 것만: 중형 세단은 왜건·쿠페·GT, 전기차판은 전기 연구 뒤. 중형 SUV는 왜건·쿠페 불가', () => {
    const g = big(), s = g.state;
    s.research.done = s.research.done.filter((x) => x !== 'ec_ev');
    const sedan = quick(g, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' });
    const o = Object.fromEntries(derivativeOptions(s, sedan.id).map((x) => [x.id, x]));
    expect([o.wagon.ok, o.coupe.ok, o.gt.ok, o.ev.ok]).toEqual([true, true, true, false]);
    expect(o.ev.reason).toContain('연구');
    expect(o.wagon.defaultName).toBe(`${SPEC.name} 왜건`); expect(o.gt.defaultName).toBe(`${SPEC.name} GT`); expect(o.coupe.defaultName).toBe(`${SPEC.name} 쿠페`);
    grant(g, 'ec_ev');
    expect(derivativeOptions(s, sedan.id).find((x) => x.id === 'ev')!).toMatchObject({ ok: true, defaultName: `${SPEC.name} EV` });
    const suv = quick(g, { type: 'startProject', ...SPEC, name: '큰차', body: 'suv', segment: 'family' });
    const so = Object.fromEntries(derivativeOptions(s, suv.id).map((x) => [x.id, x.ok]));
    expect(so).toMatchObject({ wagon: false, coupe: false, gt: true, ev: true });
  });

  it('왜건: 싸고 빠르다(바탕 개발비의 일부), 별도 차종·계보 연결, 실용↑·가족층, 생산 라인을 함께 쓴다(라인이 다 차도 출시), 이름을 바꿀 수 있다', () => {
    const g = big(1990, 1, { factory: 1 }), s = g.state, base = real(g, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'worker' });
    expect(linesUsed(s)).toBe(linesOf(s));
    ok(g.command({ type: 'startDerivative', generationId: base.id, variant: 'wagon', name: '  패밀리  ' }));
    const p = s.projects[0], v = config;
    expect(p).toMatchObject({ kind: 'derivative', variant: 'wagon', targetId: base.id, segment: 'family', body: 'sedanM', name: '패밀리', designWeeks: 12 });
    while (!(p.waiting || p.testWeeks >= 20)) g.tick();
    expect(p.weeksDone + p.testWeeks).toBeLessThan(v.dev.designWeeks[1] + 10);
    expect(p.spent).toBeLessThan(base.devCost * 0.6);
    ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(s, p) / 10) * 10, marketing: 1, color: 'blue', wheels: 1 }));
    const d = allGens(s).at(-1)!, dn = npOf(s, d), bn = npOf(s, base);
    expect(dn).toMatchObject({ name: '패밀리', baseOf: bn.id, variant: 'wagon' });
    expect(d).toMatchObject({ variant: 'wagon', fromGen: base.id, segment: 'family', number: 1 });
    expect(linesUsed(s)).toBe(1);
    const be = currentEdition(base).stats, de = d.editions[0].stats;
    expect(de.U / be.U).toBeGreaterThan(1.1); expect((de.U / be.U) / (de.P / be.P)).toBeGreaterThan(1.15); // 직원 성과가 붙을 수 있어 비율로 본다
    expect(derivativesOf(s, bn.id).derivatives.map((x) => x.id)).toEqual([dn.id]);
    expect(derivativesOf(s, dn.id).base!.id).toBe(bn.id);
    expect(genBasePrice(s, d)).toBeGreaterThan(genBasePrice(s, base));
    toMonthEnd(g);
    expect(d.sales.at(-1)!).toBeGreaterThan(0); expect(s.ledger.at(-1)!.cars!.some((c) => c.id === d.id)).toBe(true);
    expect(fullChangeEligibility(s, dn.id).ok).toBe(false); // 파생은 바탕 차의 새 세대로 잇는다
    expect(g.command({ type: 'startDerivative', generationId: base.id, variant: 'wagon' }).ok).toBe(false); // 이 세대로 이미 냈다
    expect(g.command({ type: 'startDerivative', generationId: d.id, variant: 'gt' }).ok).toBe(false); // 파생의 파생 없음
  });

  it('고성능판: 성능 크게↑·원가↑·평판 가점, 쿠페: 디자인·성능↑ 실용↓, 전기차판: 동력 전기·주행 거리 규칙', () => {
    const g = big(2024), s = g.state, base = real(g, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' }), be = currentEdition(base).stats;
    const rep0 = s.reputation, gt = quick(g, { type: 'startDerivative', generationId: base.id, variant: 'gt' }), ge = gt.editions[0].stats;
    expect(ge.P / be.P).toBeGreaterThan(1.25);
    expect(gt.reviewAvg >= config.reputation.launchBase ? s.reputation - rep0 : 1).toBeGreaterThan(0);
    const unitCostOf = (x: Generation) => currentEdition(x).price - generationUnitProfit(x, s);
    expect(unitCostOf(gt)).toBeGreaterThan(unitCostOf(base) * 1.08);
    const cp = quick(g, { type: 'startDerivative', generationId: base.id, variant: 'coupe' }), ce = cp.editions[0].stats;
    expect(ce.D / be.D).toBeGreaterThan(1.1); expect(ce.U / be.U).toBeLessThan(0.85); expect(cp.segment).toBe('youth');
    const ev = quick(g, { type: 'startDerivative', generationId: base.id, variant: 'ev', battery: 'large' });
    expect(ev.powertrain).toBe('ev'); expect(ev.editions[0].battery).toBe('large');
    expect(genEvInfo(s, ev.id)!.rangeKm).toBeGreaterThan(0);
    expect(s.nameplates.filter((n) => n.baseOf === npOf(s, base).id).map((n) => n.variant)).toEqual(['gt', 'coupe', 'ev']);
    expect(linesUsed(s)).toBe(1);
  });

  it('파생을 내면 합계 판매·이익이 는다(시드 3개 × 왜건·GT, 24개월, 파생 개발비 포함)', () => {
    for (const seed of [1, 2, 3]) for (const variant of ['wagon', 'gt']) {
      const a = big(1990, seed), base = real(a, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' });
      ticks(a, 12 * 4);
      const b = Game.fromJSON(a.toJSON());
      ok(a.command({ type: 'startDerivative', generationId: base.id, variant }));
      const p = a.state.projects[0];
      while (!(p.waiting || p.testWeeks >= 20)) a.tick();
      ok(a.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(a.state, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
      while (b.state.week < a.state.week) b.tick();
      ticks(a, 24 * 4); ticks(b, 24 * 4);
      const sum = (g: Game, f: (x: Generation) => number) => allGens(g.state).reduce((t, x) => t + f(x), 0);
      expect(sum(a, (x) => x.totalSold), `${seed} ${variant}`).toBeGreaterThan(sum(b, (x) => x.totalSold));
      expect(sum(a, (x) => x.profit - (x.variant ? x.devCost : 0)), `${seed} ${variant}`).toBeGreaterThan(sum(b, (x) => x.profit));
    }
  });

  it('바탕 차가 풀체인지되면 파생도 다음 세대로 이어 간다(같은 파생 차종의 2세대, 전 세대는 단종)', () => {
    const g = big(), s = g.state, base = quick(g, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' });
    const w1 = quick(g, { type: 'startDerivative', generationId: base.id, variant: 'wagon', name: '왜건원' }), wn = npOf(s, w1);
    base.launchMonth -= 40;
    const base2 = quick(g, { type: 'startFullChange', nameplateId: npOf(s, base).id, ...nextGenSpec(s, npOf(s, base).id)! });
    expect(base2.number).toBe(2);
    const w2 = quick(g, { type: 'startDerivative', generationId: base2.id, variant: 'wagon' });
    expect(npOf(s, w2)).toBe(wn); expect(w2).toMatchObject({ number: 2, fromGen: base2.id, variant: 'wagon' }); expect(wn.name).toBe('왜건원');
    expect(w1.status).toBe('ending');
    toMonthEnd(g);
    expect(sellingGens(s).map((x) => x.id).sort()).toEqual([base2.id, w2.id].sort());
  });
});

describe('평론가별 시승기', () => {
  it('여러 시드·여러 차에서 한 차의 시승기 문장이 서로 겹치지 않는다', () => {
    for (let seed = 1; seed <= 6; seed++) for (const [body, powertrain] of [['sedanM', 'ev'], ['sedanS', 'gasoline'], ['sedanM', 'gasoline']] as const) {
      const g = big(2025, seed), gen = quick(g, { type: 'startProject', ...SPEC, body, segment: 'family', powertrain });
      const cs = critiquesOf(g.state, gen.id), parts = cs.flatMap((c) => c.text.split(/(?<=다\.)\s/));
      expect(new Set(parts).size).toBe(parts.length);
      expect(cs.map((c) => c.score)).toEqual(gen.reviews);
    }
  });

  it('평론가 4명(이름·매체), 점수는 기존 평론 그대로(평균 = reviewAvg), 2~3문장, 차 이름·주행 거리(전기차) 반영, 같은 시드 같은 글', () => {
    const make = (seed: number) => { const g = big(2025, seed); return { g, gen: quick(g, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family', powertrain: 'ev' }) }; };
    const { g, gen } = make(5), cs = critiquesOf(g.state, gen.id);
    expect(cs.map((c) => c.critic)).toEqual(config.critics.list.map((c) => c.id));
    expect(cs.map((c) => c.score)).toEqual(gen.reviews);
    expect(cs.reduce((a, c) => a + c.score, 0) / cs.length).toBeCloseTo(gen.reviewAvg, 12);
    for (const c of cs) {
      expect(c.name).toBeTruthy(); expect(c.outlet).toBeTruthy();
      const n = c.text.split(/(?<=다\.)\s/).length;
      expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(3);
      expect(c.text).toContain(`「${SPEC.name}」`); expect(c.text).not.toMatch(/!|\{|\}|\(를\)|\(이\)|undefined/);
    }
    expect(cs.some((c) => /주행 거리 \d+km/.test(c.text))).toBe(true);
    expect(cs.find((c) => c.critic === 'value')!.text).toMatch(/가격|값|돈/);
    expect(make(5).gen.critiques).toEqual(gen.critiques);
    expect(CRITICS.critics.length).toBe(4);
  });
});

describe('알림 유형', () => {
  it('14가지(2.0.0 경쟁사 신차, 3.0.0 자회사, 3.7.0 자동 승인, 4.0.0 세계 시장 포함), 경고만 끌 수 없음. 20년 봇 이벤트·뉴스가 모두 목록 안의 유형으로 나뉘고, 교육·성과·공장·결산·경고가 구분된다', () => {
    expect(NOTIFY.map((x) => x.id)).toEqual(['training', 'hiring', 'research', 'dev', 'launch', 'exec', 'finance', 'market', 'rival', 'factory', 'sub', 'auto', 'world', 'warning']);
    expect(NOTIFY.filter((x) => x.locked).map((x) => x.id)).toEqual(['warning']); expect(topicLocked('warning')).toBe(true);
    const g = big(1985, 1, { ability: 90 }), s = g.state, ev: GameEvent[] = [], ids = new Set(NOTIFY.map((x) => x.id));
    ok(g.command({ type: 'startProject', ...SPEC }));
    ok(g.command({ type: 'train', staffId: s.staff.find((x) => x.projectId === null)?.id ?? s.staff[0].id }));
    s.factory.build = { level: 6, doneMonth: monthOf(s.week) + 1 };
    ticks(g, 60, ev);
    const seen = new Set(ev.map(eventTopic));
    for (const t of seen) expect(ids.has(t)).toBe(true);
    for (const n of s.events.news) expect(ids.has(newsTopic(n))).toBe(true);
    expect([...seen]).toEqual(expect.arrayContaining(['dev', 'finance', 'training', 'factory']));
    expect(eventTopic({ kind: 'recall', text: '' })).toBe('warning');
    expect(eventTopic({ kind: 'news', text: '', category: 'regulation' })).toBe('warning');
    expect(eventTopic({ kind: 'execReport', text: '', count: 1 })).toBe('exec');
    expect(eventTopic({ kind: 'unlock', text: '', category: 'research' })).toBe('research');
  });
});

describe('저장 형식 7(1.3.0)', () => {
  it('형식 6 fixture: 7(지금은 8)로 올라오고 출시된 세대마다 시승기(점수 = 기존 평론)가 생기며, 이어서 돌린 결과와 저장 왕복이 같다', () => {
    const raw = JSON.parse(readFileSync('car/tests/fixtures/save-v6.json', 'utf8'));
    expect(raw.saveVersion).toBe(6);
    const a = Game.fromJSON(raw);
    expect(a.state.saveVersion).toBe(11);
    const gens = allGens(a.state);
    expect(gens.length).toBeGreaterThan(2);
    for (const x of gens) { expect(x.critiques!.map((c) => c.score)).toEqual(x.reviews); for (const c of x.critiques!) expect(c.text.length).toBeGreaterThan(10); }
    expect(Game.fromJSON(raw).toJSON()).toEqual(a.toJSON()); // 변환도 결정론
    const b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    for (let i = 0; i < 96; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
  it('결정론: 같은 시드·같은 조작이면 위임·파생·성과까지 같은 결과, 저장 왕복 뒤에도 같다', () => {
    const run = () => {
      const g = big(1992, 9, { staff: 12 }), base = quick(g, { type: 'startProject', ...SPEC, body: 'sedanM', segment: 'family' });
      quick(g, { type: 'startDerivative', generationId: base.id, variant: 'gt' });
      product(g);
      for (const n of g.state.nameplates) ok(g.command({ type: 'setGenAuto', nameplateId: n.id, on: true }));
      ticks(g, 4 * W);
      const c = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
      ticks(g, 4 * W); ticks(c, 4 * W);
      expect(JSON.stringify(c.toJSON())).toBe(JSON.stringify(g.toJSON()));
      return g.toJSON();
    };
    const x = run(), y = run();
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    expect(allGens(x as unknown as CarState).length).toBeGreaterThan(2);
    expect(latestGen((x as CarState).nameplates[0]).number).toBeGreaterThanOrEqual(2);
  });
});
