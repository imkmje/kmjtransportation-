// 3.7.1 결정 자동 승인의 종류별 답: 고른 답대로 처리, 규칙대로 선택지, 할 수 없는 답·안전선에서 묻기, 3.7.0 저장 읽기, 저장 왕복, 명령 검사
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RANDOM_EVENTS } from '../src/data';
import { Game } from '../src/sim/game';
import { staffCap } from '../src/sim/company';
import { autoChoice } from '../src/sim/rivalry';
import { autoAnswer, autoHold, autoPick } from '../src/sim/autodecide';
import type { GameEvent, PendingChoice } from '../src/sim/types';
import { ok } from './util';

vi.setConfig({ testTimeout: 300_000 });
const WPY = 48, ALL = RANDOM_EVENTS.map((d) => d.id);
const load = () => Game.fromJSON(JSON.parse(readFileSync('car/tests/fixtures/save-v9.json', 'utf8')));
const defOf = (id: string) => RANDOM_EVENTS.find((d) => d.id === id)!;
const runAuto = (g: Game) => (g as unknown as { autoDecide(ev: GameEvent[]): void }).autoDecide.bind(g);
function until(g: Game, test: (p: PendingChoice) => boolean, years = 15): PendingChoice {
  for (let i = 0; i < years * WPY; i++) { g.state.cash = Math.max(g.state.cash, 1e9); g.tick(); const p = g.state.events.pending.find(test); if (p) return p; }
  throw new Error(`${years}년 안에 결정이 뜨지 않았다`);
}
/** 그 종류가 떠 있는 판을 한 번 만들어 두고, 시도마다 새로 읽는다 */
function fixtureWith(id: string) {
  const base = load(), pc0 = until(base, (p) => p.eventId === id), snap = JSON.stringify(base.toJSON());
  return () => { const g = Game.fromJSON(JSON.parse(snap)); return { g, s: g.state, pc: g.state.events.pending.find((p) => p.id === pc0.id)! }; };
}

describe('결정 자동 승인 3.7.1: 종류별 답', () => {
  it('명령 검사: 규칙대로는 규칙 종류만, 번호는 선택지 안, 모두에는 답을 줄 수 없다. 처음 값을 고르면 칸이 지워진다', () => {
    const g = Game.create({ seed: 1 }), s = g.state;
    expect(g.command({ type: 'setAutoDecide', kind: 'motorshow', on: true, choice: 'rule' }).ok).toBe(false);
    expect(g.command({ type: 'setAutoDecide', kind: 'motorshow', on: true, choice: 2 }).ok).toBe(false);
    expect(g.command({ type: 'setAutoDecide', kind: 'motorshow', on: true, choice: 0.5 }).ok).toBe(false);
    expect(g.command({ type: 'setAutoDecide', kind: 'all', on: true, choice: 0 }).ok).toBe(false);
    expect(s.autoDecide).toBeUndefined(); // 실패한 명령은 상태를 바꾸지 않는다
    ok(g.command({ type: 'setAutoDecide', kind: 'poach', on: false, choice: 0 }));
    ok(g.command({ type: 'setAutoDecide', kind: 'motorshow', on: true, choice: 0 }));
    expect(s.autoDecide).toEqual({ on: ['motorshow'], pick: { motorshow: 0, poach: 0 } }); // 자료 순서
    expect(autoAnswer(s, 'celebrity')).toBe(defOf('celebrity').defaultChoice); expect(autoAnswer(s, 'priceWar')).toBe('rule');
    ok(g.command({ type: 'setAutoDecide', kind: 'all', on: true })); expect(s.autoDecide!.pick).toEqual({ motorshow: 0, poach: 0 }); // 모두 켜기는 답을 건드리지 않는다
    ok(g.command({ type: 'setAutoDecide', kind: 'poach', on: true, choice: 'rule' }));
    ok(g.command({ type: 'setAutoDecide', kind: 'motorshow', on: true, choice: defOf('motorshow').defaultChoice }));
    expect('pick' in s.autoDecide!).toBe(false);
  });

  it('고른 답대로 처리한다: 모터쇼 초청 → 콘셉트카 출품(평판이 오르고 비용이 든다)', () => {
    const make = fixtureWith('motorshow'), { g, s, pc } = make();
    ok(g.command({ type: 'setAutoDecide', kind: 'motorshow', on: true, choice: 0 }));
    expect(autoPick(s, pc).choice).toBe(0);
    const rep = s.reputation, cash = s.cash, ev: GameEvent[] = []; runAuto(g)(ev);
    expect(s.events.pending.some((p) => p.id === pc.id)).toBe(false);
    expect(ev.some((e) => e.kind === 'news' && e.topic === 'auto' && e.text.startsWith('자동 승인: 모터쇼 초청 → 콘셉트카 출품 선택 — '))).toBe(true);
    expect(s.reputation).toBeGreaterThan(rep); expect(s.cash).toBeLessThan(cash);
    // 안전선: 같은 답이라도 현금의 10% 이상이 들면 묻는다
    const b = make(); ok(b.g.command({ type: 'setAutoDecide', kind: 'motorshow', on: true, choice: 0 }));
    b.s.cash = 1; // 출품비보다 훨씬 적은 현금
    expect(autoHold(b.s, b.pc, 0)).toBe('현금이 모자랍니다');
    runAuto(b.g)([]); expect(b.s.events.pending.some((p) => p.id === b.pc.id)).toBe(true);
  });

  it('규칙 종류: 규칙대로면 임원 규칙, 답을 정하면 그 답(이직 제안·가격 전쟁)', () => {
    for (const id of ['poach', 'priceWar']) {
      const make = fixtureWith(id);
      const a = make(); ok(a.g.command({ type: 'setAutoDecide', kind: id, on: true, choice: 'rule' }));
      expect(autoPick(a.s, a.pc).choice).toBe(autoChoice(a.s, a.pc)!.choice);
      const want = 1 - autoChoice(a.s, a.pc)!.choice, b = make(); // 규칙과 다른 답
      ok(b.g.command({ type: 'setAutoDecide', kind: id, on: true, choice: want })); ok(b.g.command({ type: 'setAutoDecideGuard', on: false }));
      const ev: GameEvent[] = []; runAuto(b.g)(ev);
      expect(b.s.events.pending.some((p) => p.id === b.pc.id)).toBe(false);
      expect(ev.find((e) => e.kind === 'news' && e.topic === 'auto')!.text).toContain(`→ ${defOf(id).choices[want].label} 선택 — `);
    }
  });

  it('고른 답을 지금 할 수 없으면(정원이 다 참, 대상 직원이 없음) 안전선을 꺼도 묻는다', () => {
    const g = load(), s = g.state, pc: PendingChoice = { id: s.nextId++, eventId: 'scout', text: '', week: s.week, deadline: s.week + 4, genId: null, fx: null }; // 정원이 남아야 뜨는 사건이라 직접 띄운다
    s.events.pending.push(pc);
    ok(g.command({ type: 'setAutoDecide', kind: 'scout', on: true, choice: 0 })); ok(g.command({ type: 'setAutoDecideGuard', on: false }));
    while (s.staff.length < staffCap(s)) s.staff.push({ ...s.staff[0], id: s.nextId++ });
    expect(autoHold(s, pc, 0)).toBe('직원 정원이 다 찼습니다');
    runAuto(g)([]); expect(s.events.pending.some((p) => p.id === pc.id)).toBe(true);
    const p = fixtureWith('poach')();
    ok(p.g.command({ type: 'setAutoDecide', kind: 'poach', on: true, choice: 0 }));
    p.s.staff = p.s.staff.filter((x) => x.id !== p.pc.rv!.staffId);
    expect(autoHold(p.s, p.pc, 0)).toBe('대상 직원이 회사에 없습니다');
    runAuto(p.g)([]); expect(p.s.events.pending.some((x) => x.id === p.pc.id)).toBe(true);
  });

  it('3.7.0 저장(autoDecide.on만 있음)을 그대로 읽고 3.7.0과 같은 답을 고른다. 저장 파일의 잘못된 답은 처음 값', () => {
    const make = fixtureWith('poach'), { g } = make();
    const o = g.toJSON() as unknown as { autoDecide?: unknown };
    o.autoDecide = { on: ALL, guard: false };
    const old = Game.fromJSON(JSON.parse(JSON.stringify(o))), s = old.state, pc = s.events.pending.find((p) => p.eventId === 'poach')!;
    expect(s.autoDecide).toEqual({ on: ALL, guard: false });
    for (const k of ALL) expect(autoAnswer(s, k)).toBe(defOf(k).needs === 'rivalry' ? 'rule' : defOf(k).defaultChoice);
    expect(autoPick(s, pc).choice).toBe(autoChoice(s, pc)!.choice);
    o.autoDecide = { on: ALL, pick: { motorshow: 'rule', strike: 9, poach: 0 } };
    const bad = Game.fromJSON(JSON.parse(JSON.stringify(o))).state;
    expect(autoAnswer(bad, 'motorshow')).toBe(1); expect(autoAnswer(bad, 'strike')).toBe(0); expect(autoAnswer(bad, 'poach')).toBe(0);
  });

  it('저장 왕복: 정한 답이 저장되고 이어서 돌린 결과가 같다', () => {
    const g = load();
    ok(g.command({ type: 'setAutoDecide', kind: 'all', on: true })); ok(g.command({ type: 'setAutoDecideGuard', on: false }));
    for (const [k, c] of [['motorshow', 0], ['celebrity', 0], ['rivalHit', 0], ['poach', 0]] as const) ok(g.command({ type: 'setAutoDecide', kind: k, on: true, choice: c }));
    for (let i = 0; i < WPY; i++) { g.state.cash = Math.max(g.state.cash, 1e9); g.tick(); }
    const a = JSON.stringify(g.toJSON()), b = Game.fromJSON(JSON.parse(a));
    expect(JSON.stringify(b.toJSON())).toBe(a);
    expect(b.state.autoDecide!.pick).toEqual({ celebrity: 0, motorshow: 0, rivalHit: 0, poach: 0 });
    for (let i = 0; i < 3 * WPY; i++) { g.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
});
