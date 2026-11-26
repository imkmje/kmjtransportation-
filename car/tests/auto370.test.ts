// 3.7.0 결정 자동 승인: 켠 종류는 대기 결정 없이 바로 처리, 끈 종류는 그대로 대기, 안전선(큰 지출·현금 부족)에서 묻기,
// 임원 규칙·기본 선택과 같은 선택지, 임원 위임이 먼저, 저장 왕복, 모두 켠 봇 60년, 끈 판 불변
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../src/config';
import { RANDOM_EVENTS } from '../src/data';
import { Game, SAVE_VERSION } from '../src/sim/game';
import { steady, steadyBestExec } from '../src/sim/bots';
import { choiceMoney } from '../src/sim/events';
import { autoChoice } from '../src/sim/rivalry';
import { AUTO_KINDS, autoHold, autoLog, autoPick } from '../src/sim/autodecide';
import type { GameEvent, PendingChoice } from '../src/sim/types';
import { ok } from './util';

vi.setConfig({ testTimeout: 300_000 });
const WPY = 48, ALL = RANDOM_EVENTS.map((d) => d.id);
const load = () => Game.fromJSON(JSON.parse(readFileSync('car/tests/fixtures/save-v9.json', 'utf8'))); // 1998년, 본사 5등급, 현금 약 3.9조
const defOf = (id: string) => RANDOM_EVENTS.find((d) => d.id === id)!;
/** 자동 승인 기록 한 줄에서 고른 선택지 이름 */
const picked = (text: string) => text.match(/→ (.+?) 선택 — /)?.[1];
const runAuto = (g: Game) => (g as unknown as { autoDecide(ev: GameEvent[]): void }).autoDecide.bind(g);
/** 자동 승인을 끈 채 그 종류의 결정이 뜰 때까지 */
function until(g: Game, test: (p: PendingChoice) => boolean, years = 12): PendingChoice {
  for (let i = 0; i < years * WPY; i++) { g.state.cash = Math.max(g.state.cash, 1e9); g.tick(); const p = g.state.events.pending.find(test); if (p) return p; }
  throw new Error(`${years}년 안에 결정이 뜨지 않았다`);
}

describe('결정 자동 승인', () => {
  it('종류 목록은 무작위 사건 8종 + 경쟁 2부 2종(임원 규칙)이고, 기본은 모두 끔(상태에 칸이 없다)', () => {
    expect(AUTO_KINDS.map((k) => k.id)).toEqual(ALL);
    expect(AUTO_KINDS.filter((k) => k.rule === 'exec').map((k) => k.id)).toEqual(['priceWar', 'poach']);
    const g = Game.create({ seed: 1 });
    expect(g.state.autoDecide).toBeUndefined();
    expect(g.command({ type: 'setAutoDecide', kind: 'nope', on: true }).ok).toBe(false);
    ok(g.command({ type: 'setAutoDecide', kind: 'all', on: true })); expect(g.state.autoDecide!.on).toEqual(ALL);
    ok(g.command({ type: 'setAutoDecide', kind: 'strike', on: false })); expect(g.state.autoDecide!.on).toEqual(ALL.filter((k) => k !== 'strike'));
    ok(g.command({ type: 'setAutoDecideGuard', on: false })); expect(g.state.autoDecide!.guard).toBe(false);
    ok(g.command({ type: 'setAutoDecideGuard', on: true })); expect('guard' in g.state.autoDecide!).toBe(false);
  });

  it('모두 켜고 안전선을 끄면 10년 동안 대기 결정이 한 번도 남지 않고, 결정 대기 이벤트도 나오지 않는다. 고른 것은 임원 규칙 또는 기본 선택', () => {
    const g = load(), s = g.state;
    ok(g.command({ type: 'setAutoDecide', kind: 'all', on: true })); ok(g.command({ type: 'setAutoDecideGuard', on: false }));
    const seen = new Map<string, number>();
    for (let i = 0; i < 10 * WPY; i++) {
      s.cash = Math.max(s.cash, 1e9);
      const ev = g.tick();
      expect(s.events.pending.length).toBe(0);
      expect(ev.some((e) => e.kind === 'choice')).toBe(false);
      for (const e of ev) if (e.kind === 'news' && e.topic === 'auto') {
        expect(e.text).toMatch(/^자동 승인: .+ → .+ 선택 — /);
        const d = RANDOM_EVENTS.find((x) => e.text.startsWith(`자동 승인: ${x.name} → `))!;
        expect(d).toBeDefined();
        if (d.needs !== 'rivalry') expect(picked(e.text)).toBe(d.choices[d.defaultChoice].label);
        seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
      }
    }
    console.log('10년 자동 승인 종류별 수', Object.fromEntries(seen));
    expect([...seen.values()].reduce((a, x) => a + x, 0)).toBeGreaterThanOrEqual(5);
    expect(autoLog(s).length).toBeGreaterThan(0); expect(autoLog(s)[0].text.startsWith('자동 승인: ')).toBe(true);
  });

  it('끈 종류는 지금처럼 대기하고(결정 대기 이벤트도 나온다), 켠 종류만 바로 처리된다', () => {
    const g = load(), s = g.state, OFF = ['motorshow', 'fx', 'materials', 'celebrity', 'poach'];
    for (const k of ALL.filter((x) => !OFF.includes(x))) ok(g.command({ type: 'setAutoDecide', kind: k, on: true }));
    ok(g.command({ type: 'setAutoDecideGuard', on: false }));
    let waited = 0;
    for (let i = 0; i < 10 * WPY; i++) {
      s.cash = Math.max(s.cash, 1e9);
      const ev = g.tick();
      for (const p of s.events.pending) expect(OFF).toContain(p.eventId);
      waited += ev.filter((e) => e.kind === 'choice').length;
    }
    expect(waited).toBeGreaterThan(0);
  });

  it('안전선: 고른 선택지의 현금 지출이 현금의 10% 이상이거나 현금보다 크면 묻고, 작으면 바로 처리한다. 안전선을 끄면 늘 처리', () => {
    const base = load();
    const pc0 = until(base, (p) => -choiceMoney(base.state, p, defOf(p.eventId).defaultChoice) > 0); // 기본 선택이 돈이 드는 결정(파업·결함 신고)
    const snap = JSON.stringify(base.toJSON());
    const cost = -choiceMoney(base.state, pc0, defOf(pc0.eventId).defaultChoice);
    const trial = (cash: number, guard: boolean) => {
      const g = Game.fromJSON(JSON.parse(snap)), s = g.state;
      ok(g.command({ type: 'setAutoDecide', kind: pc0.eventId, on: true })); ok(g.command({ type: 'setAutoDecideGuard', on: guard }));
      s.cash = cash;
      const pc = s.events.pending.find((p) => p.id === pc0.id)!;
      const hold = autoHold(s, pc, autoPick(s, pc).choice), ev: GameEvent[] = [];
      runAuto(g)(ev);
      return { hold, left: s.events.pending.some((p) => p.id === pc0.id), cashAfter: s.cash, ev };
    };
    const big = trial(cost * 20, true); // 5%
    expect(big.hold).toBeNull(); expect(big.left).toBe(false); expect(big.cashAfter).toBeCloseTo(cost * 19, 0);
    expect(big.ev.some((e) => e.kind === 'news' && e.topic === 'auto' && e.text.startsWith(`자동 승인: ${defOf(pc0.eventId).name} → ${defOf(pc0.eventId).choices[defOf(pc0.eventId).defaultChoice].label} 선택`))).toBe(true);
    const tenth = trial(cost * 5, true); // 20%
    expect(tenth.hold).toContain(`${Math.round(config.autoDecide.guardShare * 100)}%`); expect(tenth.left).toBe(true);
    const short = trial(cost / 2, true);
    expect(short.hold).toBe('현금이 모자랍니다'); expect(short.left).toBe(true);
    const neg = trial(-1e5, true); expect(neg.left).toBe(true);
    const off = trial(cost / 2, false);
    expect(off.hold).toBeNull(); expect(off.left).toBe(false);
  });

  it('가격 전쟁·이직 제안은 임원이 없어도 임원 규칙과 같은 선택지를 고른다', () => {
    for (const id of ['priceWar', 'poach']) {
      const base = load(), pc0 = until(base, (p) => p.eventId === id), snap = JSON.stringify(base.toJSON());
      const g = Game.fromJSON(JSON.parse(snap)), s = g.state, pc = s.events.pending.find((p) => p.id === pc0.id)!;
      const want = autoChoice(s, pc)!;
      expect(autoPick(s, pc).choice).toBe(want.choice);
      ok(g.command({ type: 'setAutoDecide', kind: id, on: true }));
      const ev: GameEvent[] = []; runAuto(g)(ev);
      expect(s.events.pending.some((p) => p.id === pc0.id)).toBe(false);
      const n = ev.find((e) => e.kind === 'news' && e.topic === 'auto')!;
      expect(picked(n.text)).toBe(defOf(id).choices[want.choice].label);
    }
  });

  it('임원 위임(이직 제안 자동 대응)이 켜져 있으면 지금처럼 임원이 처리하고 보고한다(자동 승인 기록 없음)', () => {
    const g = load(), s = g.state;
    if (!s.execs?.seats.hr) ok(g.command({ type: 'appointExec', role: 'hr', staffId: s.staff.filter((x) => x.role === 'sales').sort((a, b) => b.ability - a.ability)[0].id }));
    s.execs!.seats.hr!.staff.ability = Math.max(s.execs!.seats.hr!.staff.ability, 80);
    ok(g.command({ type: 'setDelegation', role: 'hr', key: 'autoPoach', on: true }));
    ok(g.command({ type: 'setAutoDecide', kind: 'all', on: true }));
    let autoPoachNews = 0;
    for (let i = 0; i < 10 * WPY && !s.execs!.reports.some((r) => r.kind === 'autoPoach'); i++) { s.cash = Math.max(s.cash, 1e9); const ev = g.tick(); autoPoachNews += ev.filter((e) => e.kind === 'news' && e.topic === 'auto' && e.text.startsWith('자동 승인: 이직 제안 ')).length; }
    const r = s.execs!.reports.find((x) => x.kind === 'autoPoach');
    expect(r, '10년 안에 임원이 처리한 이직 제안이 없다').toBeDefined();
    expect(r!.text).toMatch(/^\[이직 제안\] /);
    expect(autoPoachNews).toBe(0);
  });

  it('저장 왕복: 켠 종류·안전선이 저장되고 이어서 돌린 결과가 같다. 형식은 10 그대로, 예전 저장은 모두 끔', () => {
    expect(SAVE_VERSION).toBe(11);
    const old = load(); expect(old.state.autoDecide).toBeUndefined();
    const g = load();
    ok(g.command({ type: 'setAutoDecide', kind: 'all', on: true })); ok(g.command({ type: 'setAutoDecide', kind: 'motorshow', on: false })); ok(g.command({ type: 'setAutoDecideGuard', on: false }));
    for (let i = 0; i < WPY; i++) g.tick();
    const a = JSON.stringify(g.toJSON()), b = Game.fromJSON(JSON.parse(a));
    expect(JSON.stringify(b.toJSON())).toBe(a);
    expect(b.state.autoDecide).toEqual({ on: ALL.filter((k) => k !== 'motorshow'), guard: false });
    for (let i = 0; i < 2 * WPY; i++) { g.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });

  it('끈 판 불변: 켰다가 모두 끈 판은 손대지 않은 판과 결과가 같다(설정 칸·명령 기록 빼고)', () => {
    const run = (touch: boolean) => {
      const g = Game.create({ seed: 3, difficulty: 'normal' }), bot = steady();
      if (touch) { ok(g.command({ type: 'setAutoDecide', kind: 'all', on: true })); ok(g.command({ type: 'setAutoDecide', kind: 'all', on: false })); }
      for (let i = 0; i < 12 * WPY && g.state.status === 'playing'; i++) { bot.step(g); g.tick(); }
      const o = JSON.parse(JSON.stringify(g.toJSON())); delete o.autoDecide; delete o.history; return JSON.stringify(o);
    };
    expect(run(true)).toBe(run(false));
  });

  it('모두 켠 봇(임원·최고 이익 가격, 보통, 60년, 시드 2개)은 파산하지 않는다', () => {
    for (const seed of [1, 2]) {
      const g = Game.create({ seed, difficulty: 'normal' }), bot = steadyBestExec({ autoDecide: true });
      let auto = 0, held = 0, minCash = Infinity;
      for (let i = 0; i < 60 * WPY && g.state.status === 'playing'; i++) {
        bot.step(g); const ev = g.tick();
        auto += ev.filter((e) => e.kind === 'news' && e.topic === 'auto').length; held += ev.filter((e) => e.kind === 'choice').length; minCash = Math.min(minCash, g.state.cash);
      }
      const s = g.state;
      console.log(`시드 ${seed}: 60년 상태 ${s.status}, 현금 ${(s.cash / 1e8).toFixed(2)}조, 자동 승인 ${auto}건, 안전선·임원 밖으로 물은 결정 ${held}건, 최저 현금 ${(minCash / 1e4).toFixed(1)}억`);
      expect(s.status).toBe('playing');
      expect(auto).toBeGreaterThan(10);
    }
  });
});
