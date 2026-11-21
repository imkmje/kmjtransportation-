// 0.7.0 할 일 목록: 각 항목이 조건에서만 나오고, goto가 실제 화면·대상을 가리킨다
import { describe, it, expect } from 'vitest';
import { Game, allGens, sellingGens } from '../src/sim/game';
import { todoItems, type TodoItem } from '../src/sim/todo';
import { config } from '../src/config';
import { eraTimeline } from '../src/sim/events';
import { faceliftPreview, todoItems as qTodo } from '../src/sim/queries';
import { devReady, grant, launched, ok } from './util';

const CO_SUBS = ['fin', 'staff', 'hq', 'factory', 'research', 'exec'];
/** goto 검사: 탭 이름과 하위 탭, id가 가리키는 대상이 상태에 있는지 */
function validGoto(g: Game, t: TodoItem): boolean {
  const s = g.state, { tab, sub, id } = t.goto;
  if (tab === 'garage') return sellingGens(s).some((x) => x.id === id);
  if (tab === 'dev') return sub === 'plan' ? id === undefined : sub === 'launch' && s.projects.some((p) => p.id === id && p.waiting);
  if (tab === 'company') return CO_SUBS.includes(sub ?? '');
  if (tab === 'choice') return s.events.pending.some((p) => p.id === id);
  return tab === 'reports';
}
const kinds = (g: Game, exec?: Parameters<typeof todoItems>[1]) => { const list = todoItems(g.state, exec); for (const t of list) expect(validGoto(g, t), t.key).toBe(true); expect(new Set(list.map((t) => t.key)).size).toBe(list.length); return list.map((t) => t.kind); };

describe('할 일 목록(0.7.0)', () => {
  it('새 게임: 개발팀·연구 칸·정원 여유만, 급한 일 없음', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), k = kinds(g);
    expect(k).toContain('team'); expect(k).toContain('hire');
    for (const x of ['choice', 'ready', 'cands', 'cash', 'retrofit', 'capacity', 'facelift', 'fullchange', 'tired', 'reports', 'exec']) expect(k).not.toContain(x);
    expect(todoItems(g.state).some((t) => t.urgent)).toBe(false);
  });
  it('출시 대기·개발팀 없음: 출시 대기 항목(급함)이 생기고 개발팀 항목은 빠진다', () => {
    const { g } = devReady(1, 99);
    const t = todoItems(g.state).find((x) => x.kind === 'ready');
    expect(g.state.projects[0].waiting).toBe(true);
    expect(t?.urgent).toBe(true); expect(t?.goto).toEqual({ tab: 'dev', sub: 'launch', id: g.state.projects[0].id });
    if (g.state.projects.length >= config.hq.levels[0].teams) expect(kinds(g)).not.toContain('team');
  });
  it('채용 후보: 있을 때만, 마지막 주에는 급함. 후보가 있으면 정원 여유 항목은 빠진다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' });
    ok(g.command({ type: 'postJob', role: 'designer', tier: 1 }));
    while (!g.state.candidates.length) g.tick();
    let c = todoItems(g.state).find((x) => x.kind === 'cands')!;
    expect(c.goto).toEqual({ tab: 'company', sub: 'staff' }); expect(kinds(g)).not.toContain('hire');
    while (g.state.candidates.length && g.state.candidates[0].expiresWeek - g.state.week > config.todo.candUrgentWeeks) g.tick();
    c = todoItems(g.state).find((x) => x.kind === 'cands')!;
    expect(c.urgent).toBe(true);
  });
  it('현금 마이너스·지친 직원·정원 참', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' });
    g.state.cash = -1; g.state.negMonths = 2; g.state.staff[0].condition = 0.1;
    const t = todoItems(g.state);
    expect(t[0].kind).toBe('cash'); expect(t[0].title).toContain('2개월째');
    expect(t.find((x) => x.kind === 'tired')?.title).toBe('지친 직원 1명');
    g.state.staff[0].restUntil = g.state.week + 2; expect(kinds(g)).not.toContain('tired');
    while (g.state.staff.length < config.hq.levels[0].staff) g.state.staff.push({ ...g.state.staff[0], id: 9000 + g.state.staff.length });
    expect(kinds(g)).not.toContain('hire');
    ok(g.command({ type: 'appointExec', role: 'hr', staffId: g.state.staff[1].id })); // 0.8.0: 임원은 정원 밖이라 임명하면 정원에 한 자리가 빈다
    expect(kinds(g)).toContain('hire');
  });
  it('결정할 사건이 생기면 항목, goto는 그 사건', () => {
    const g = Game.create({ seed: 3, difficulty: 'normal' }); g.state.cash = 1e9;
    for (let i = 0; i < 48 * 10 && !g.state.events.pending.length; i++) g.tick();
    expect(g.state.events.pending.length).toBeGreaterThan(0);
    const t = todoItems(g.state).find((x) => x.kind === 'choice')!;
    expect(t.goto).toEqual({ tab: 'choice', id: g.state.events.pending[0].id }); expect(t.urgent).toBe(true); kinds(g);
  });
  it('규제 예고 중 필요한 기술 미연구면 항목, 연구하면 사라짐', () => {
    const sp = eraTimeline(1).find((x) => x.def.id === 'safety')!;
    const g = Game.create({ seed: 1, difficulty: 'normal' }); g.state.week = (sp.start - 1) * 4;
    const t = todoItems(g.state).find((x) => x.kind === 'regulation');
    expect(t?.goto).toEqual({ tab: 'company', sub: 'research' });
    expect(t?.key).toBe(`reg:${sp.def.name}`);
    grant(g); expect(kinds(g)).not.toContain('regulation');
  });
  it('판매 중인 차: 생산 막힘·의무 장비·페이스리프트·풀체인지는 조건에서만', () => {
    const { g, gen } = launched(1);
    for (let i = 0; i < 4; i++) g.tick();
    const k0 = kinds(g);
    for (const x of ['facelift', 'fullchange', 'retrofit']) expect(k0).not.toContain(x);
    expect(k0.includes('capacity')).toBe(gen.lostSales >= 1);
    gen.lostSales = 50; gen.lastDemand = 500;
    expect(todoItems(g.state).find((x) => x.kind === 'capacity')?.goto).toEqual({ tab: 'company', sub: 'factory' });
    // 출시 40개월 뒤: 풀체인지 가능(개발팀이 비어 있을 때)
    gen.launchMonth -= 40; gen.launchWeek -= 160;
    const full = todoItems(g.state).find((x) => x.kind === 'fullchange');
    expect(full?.goto).toEqual({ tab: 'garage', id: gen.id });
    ok(g.command({ type: 'startProject', ...{ name: '둘째', body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.dev.designWeeks[0] } }));
    expect(g.state.projects.length).toBe(config.hq.levels[0].teams);
    const k1 = kinds(g);
    for (const x of ['fullchange', 'facelift', 'team']) expect(k1).not.toContain(x); // 개발팀이 모두 바쁘면 개발 항목은 빠진다
    expect(allGens(g.state).length).toBe(1);
  });
  it('페이스리프트 적기: 회수 가능하고 너무 이르지 않을 때만', () => {
    const { g, gen } = launched(1);
    for (let i = 0; i < 48 * 3; i++) g.tick();
    const t = todoItems(g.state).find((x) => x.kind === 'facelift');
    const fp = faceliftPreview(g.state, gen.id, { options: gen.editions.at(-1)!.options })!;
    expect(!!t).toBe(fp.eligibility.ok && !fp.tooEarly && fp.paybackMonths !== null && g.state.projects.length < config.hq.levels[0].teams);
    if (t) expect(t.goto).toEqual({ tab: 'garage', id: gen.id });
  });
  it('임원: 빈 자리·읽지 않은 보고는 받은 값이 있을 때만, 새 보고가 오면 키가 바뀐다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' });
    const a = todoItems(g.state, { vacant: 1, unread: 2, lastUnread: 7 }), b = todoItems(g.state, { vacant: 1, unread: 3, lastUnread: 9 });
    expect(a.find((x) => x.kind === 'exec')?.goto).toEqual({ tab: 'company', sub: 'exec' });
    expect(a.find((x) => x.kind === 'reports')?.goto).toEqual({ tab: 'reports' });
    expect(a.find((x) => x.kind === 'reports')!.key).not.toBe(b.find((x) => x.kind === 'reports')!.key);
    expect(kinds(g)).not.toContain('reports');
  });
  it('조회(Q.todoItems): 새 게임에는 빈 임원 자리 항목(본사 1등급 1자리), 보고는 없음', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), t = qTodo(g.state);
    expect(t.find((x) => x.kind === 'exec')?.title).toBe('비어 있는 임원 자리 1개');
    expect(t.some((x) => x.kind === 'reports')).toBe(false);
  });
  it('순수: 목록을 만들어도 상태가 바뀌지 않는다', () => {
    const { g } = launched(2);
    for (let i = 0; i < 48 * 2; i++) g.tick();
    const before = JSON.stringify(g.state); todoItems(g.state); expect(JSON.stringify(g.state)).toBe(before);
  });
});
