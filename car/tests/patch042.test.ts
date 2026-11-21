// 0.4.2 균형 패치: 시간 척도, 페이스리프트 이익, 규제 의무 장비, 교육 상한, 개발자 메뉴
import { describe, it, expect } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { currentEdition } from '../src/sim/market';
import { eraTimeline, optionTech, requiredOptions } from '../src/sim/events';
import { researchError } from '../src/sim/research';
import { faceliftPreview, planEntries, planPreview, retrofitInfo, unitCost } from '../src/sim/queries';
import { costMultOf } from '../src/sim/company';
import { monthOf } from '../src/sim/time';
import { techById } from '../src/data';
import type { Difficulty } from '../src/sim/types';
import { config } from '../src/config';
import { SPEC, grant, ok } from './util';

describe('개발자 메뉴(0.4.2)', () => {
  it('devCheat: 현금·평판(상한)·연구 완료·개발 출시 대기·컨디션, devUsed, 명령 기록과 저장 왕복', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), s = g.state;
    expect(s.devUsed).toBeUndefined();
    const cash = s.cash; ok(g.devCheat('cash')); expect(s.cash).toBe(cash + config.devCheat.cash); expect(s.devUsed).toBe(true);
    ok(g.devCheat('reputation')); expect(s.reputation).toBe(config.start.reputation + config.devCheat.reputation);
    s.reputation = 95; ok(g.devCheat('reputation')); expect(s.reputation).toBe(100);
    ok(g.command({ type: 'startResearch', techId: 'el_radio' }));
    const r = g.devCheat('finishResearch');
    expect(s.research.active).toEqual([]); expect(s.research.done).toContain('el_radio'); expect(r.ok && r.events?.some((e) => e.kind === 'unlock')).toBe(true);
    ok(g.command({ type: 'startProject', ...SPEC })); g.tick();
    const p = s.projects[0], team = s.staff.filter((x) => x.projectId === p.id).map((x) => x.id);
    for (const x of s.staff) x.condition = 0.2;
    ok(g.devCheat('finishDev'));
    expect(p).toMatchObject({ phase: 'test', waiting: true, defects: 0, defectEst: 0, crew: team }); expect(p.testWeeks).toBeGreaterThanOrEqual(config.dev.minTestWeeks);
    expect(s.staff.every((x) => x.projectId === null)).toBe(true);
    ok(g.devCheat('restStaff')); expect(s.staff.every((x) => x.condition === 1)).toBe(true);
    ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    expect(g.devCheat('nope' as never).ok).toBe(false);
    expect(s.history.filter((h) => h.cmd.type === 'devCheat').map((h) => (h.cmd as { kind: string }).kind)).toEqual(['cash', 'reputation', 'reputation', 'finishResearch', 'finishDev', 'restStaff']);
    // 저장 왕복: 이어서 돌린 결과가 같다
    const b = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(b.state.devUsed).toBe(true);
    for (let i = 0; i < 20; i++) { g.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
});

/** 통제 시나리오: 1970년 첫 차(보통 예산·중간 설계 기간, 결함 0으로 출시), 공장 2등급(생산 한도에 묶이지 않게), 현금 넉넉, 그 뒤 아무 결정도 안 함.
 *  liftAt개월에 페이스리프트(옵션 그대로, 가격 그대로). 달마다 세대 순이익(누적 이익 − 개발비, 리프트 비용 포함) */
function liftRun(seed: number, d: Difficulty, months: number, liftAt?: number) {
  const g = Game.create({ seed, difficulty: d }); g.state.cash = 1e9; g.state.factory.level = 2;
  ok(g.command({ type: 'startProject', ...SPEC }));
  const ready = () => { const q = g.state.projects[0]; return q.phase === 'test' && q.testWeeks >= config.dev.minTestWeeks && (q.defectEst <= 5 || !!q.waiting); };
  while (!ready()) g.tick();
  ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
  const gen = allGens(g.state)[0]; gen.editions[0].defects = 0;
  const net: number[] = []; let liftDone = -1;
  for (let m = 0; m < months; m++) {
    for (let w = 0; w < 4; w++) {
      if (liftAt !== undefined && m === liftAt && w === 0) ok(g.command({ type: 'startFacelift', generationId: gen.id, options: currentEdition(gen).options }));
      if (g.state.projects.length && ready()) { ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: currentEdition(gen).price, marketing: gen.marketing, color: 'red', wheels: 0 })); liftDone = m; }
      g.tick();
    }
    net.push(gen.profit - gen.devCost);
  }
  return { net, liftDone };
}

describe('페이스리프트 손익(0.4.2)', () => {
  it('적기(출시 36개월) 페이스리프트: 모든 난이도에서 리프트 출시 뒤 18개월 안에 비용을 회수하고, 24개월 누적 이익이 미실시보다 크며, 96개월 세대 순이익이 15~40% 많다', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const pay: number[] = [], gain: number[] = [];
      for (const seed of [1, 2, 3, 4]) {
        const B = liftRun(seed, d, 96), A = liftRun(seed, d, 96, 36);
        expect(A.liftDone).toBeGreaterThan(36);
        const p = A.net.findIndex((x, i) => i >= A.liftDone && x >= B.net[i]);
        pay.push(p < 0 ? Infinity : p - A.liftDone);
        expect(A.net[36 + 24] - A.net[35]).toBeGreaterThan(B.net[36 + 24] - B.net[35]); // 리프트 시작부터 24개월 누적(리프트 비용 포함)
        gain.push(A.net[95] / B.net[95] - 1);
      }
      const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      console.log(`${d}: 회수 ${pay.join(',')}개월, 세대 순이익 +${gain.map((x) => Math.round(x * 100)).join(',')}%`);
      expect(Math.max(...pay)).toBeLessThanOrEqual(18);
      expect(med(gain)).toBeGreaterThanOrEqual(0.15); expect(med(gain)).toBeLessThanOrEqual(0.4);
    }
  });
  it('리프트는 디자인 밖의 능력치도 refresh만큼 올린다(미리보기와 출시 값이 같다)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 5 }); g.state.cash = 1e9;
    ok(g.command({ type: 'startProject', ...SPEC })); while (g.state.projects[0].phase === 'design' || g.state.projects[0].testWeeks < config.dev.minTestWeeks) g.tick();
    ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    const gen = allGens(g.state)[0], before = { ...gen.editions[0].stats };
    while (monthOf(g.state.week) - gen.launchMonth < 30) g.tick();
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    const p = g.state.projects[0]; while (p.phase === 'design' || p.testWeeks < config.dev.minTestWeeks) g.tick();
    const pv = faceliftPreview(g.state, gen.id, { options: [] })!;
    ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    const after = gen.editions[1].stats;
    expect(after.P).toBeCloseTo(before.P * (1 + config.lifecycle.facelift.refresh), 6); expect(after.D).toBeGreaterThan(before.D);
    expect(pv.cost).toBeGreaterThan(0);
  });
});

describe('규제 의무 장비(0.4.2)', () => {
  const safety = (seed: number) => eraTimeline(seed).find((x) => x.def.id === 'safety')!;
  /** 안전 규제 시행 뒤(유예 끝 + 4개월)의 게임. research: ABS·에어백 연구 여부 */
  const enforced = (research: boolean) => { const g = Game.create({ difficulty: 'normal', seed: 1 }); g.state.cash = 1e9; g.state.week = (safety(1).start + 40) * 4; if (research) grant(g, 'bd_airbag'); return g; };
  it('모든 규제의 필수 기술은 예고 시점에 연구할 수 있다(선행 기술 포함, 연도·본사·평판에 막히지 않음)', () => {
    let checked = 0;
    for (let seed = 1; seed <= 30; seed++) for (const sp of eraTimeline(seed)) for (const e of sp.def.effects) {
      if (e.type !== 'regulation' || !e.options?.length) continue;
      const g = Game.create({ difficulty: 'normal', seed }); g.state.cash = 1e9; g.state.hqLevel = 1; g.state.reputation = 0;
      g.state.week = (sp.start - config.events.warnMonths) * 4;
      expect(e.graceMonths).toBeGreaterThan(0); // 예고 → 유예 → 시행
      const need: string[] = [], add = (id: string) => { for (const q of techById(id).pre) add(q); if (!need.includes(id)) need.push(id); };
      for (const o of e.options) { const t = optionTech(o); if (t) add(t.id); }
      for (const id of need) { expect(researchError(g.state, id), `${seed} ${sp.def.id} ${id}`).toBeNull(); grant(g, id); checked++; }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('규제 시행 후 필수 기술을 연구하지 않았으면 신차·풀체인지·페이스리프트 개발 시작이 거부되고, 기획 조회에 이유가 나온다', () => {
    // 시행 전에 차를 하나 내 둔다
    const g = Game.create({ difficulty: 'normal', seed: 1 }); g.state.cash = 1e9; g.state.week = (safety(1).start - 6) * 4;
    ok(g.command({ type: 'startProject', ...SPEC })); g.devCheat('finishDev');
    ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    const gen = allGens(g.state)[0]; g.state.week = (safety(1).start + 40) * 4; // 시행 뒤(출시 46개월)
    const why = '안전 규제로 ABS·에어백이 의무 장비가 되었습니다. 「ABS」, 「에어백」 연구가 필요합니다.';
    const r = (x: { ok: boolean; reason?: string }) => (x.ok ? '' : x.reason);
    expect(r(g.command({ type: 'startProject', ...SPEC }))).toBe(why);
    expect(r(g.command({ type: 'startFullChange', nameplateId: g.state.nameplates[0].id, ...SPEC }))).toBe(why);
    expect(r(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }))).toBe(why);
    const pe = planEntries(g.state);
    expect(pe.blockedBy).toBe(why); expect(pe.newModel).toMatchObject({ ok: false, reason: why });
    expect(pe.nameplates[0].fullChange.reason).toBe(why); expect(pe.nameplates[0].facelift.reason).toBe(why);
    expect(planPreview(g.state, SPEC).blockedBy).toBe(why);
    grant(g, 'bd_airbag');
    expect(planEntries(g.state).blockedBy).toBeNull(); expect(planPreview(g.state, SPEC).required).toEqual(['abs', 'airbag']);
    ok(g.command({ type: 'startFacelift', generationId: gen.id, options: [] }));
    expect(g.state.projects[0].options).toEqual(['abs', 'airbag']); // 페이스리프트에도 의무 장비가 자동으로 들어간다
  });
  it('의무 장비는 옵션 칸을 차지하지 않는다(본사 1등급 옵션 칸 2개 + 의무 장비 2개), 원가에는 들어간다', () => {
    const g = enforced(true); grant(g, 'el_radio', 'el_aircon');
    expect(requiredOptions(g.state)).toEqual(['abs', 'airbag']);
    ok(g.command({ type: 'startProject', ...SPEC, options: ['radio', 'aircon'] }));
    const p = g.state.projects[0]; expect(p.options).toEqual(['radio', 'aircon', 'abs', 'airbag']);
    expect(unitCost(p.body, p.powertrain, p.tier, p.options)).toBeCloseTo(unitCost(p.body, p.powertrain, p.tier, ['radio', 'aircon']) + 70 + 60, 9);
  });
  it('retrofit: 판매 중인 차에 의무 장비 추가(연구 필요, 일시 비용, 원가·품질 반영, 바로 적용), 필요 없으면 거부', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }); g.state.cash = 1e9; g.state.week = (safety(1).start - 6) * 4;
    ok(g.command({ type: 'startProject', ...SPEC })); g.devCheat('finishDev');
    ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    const gen = allGens(g.state)[0];
    expect(retrofitInfo(g.state, gen.id)).toMatchObject({ needed: false, ok: false, reason: '추가할 의무 장비가 없습니다.' });
    g.state.week = (safety(1).start + 40) * 4;
    expect(retrofitInfo(g.state, gen.id)).toMatchObject({ needed: true, ok: false, options: ['abs', 'airbag'], unitCostAdd: 130 });
    expect(g.command({ type: 'retrofit', generationId: gen.id })).toEqual({ ok: false, reason: '안전 규제로 ABS·에어백이 의무 장비가 되었습니다. 「ABS」, 「에어백」 연구가 필요합니다.' });
    grant(g, 'bd_airbag');
    const info = retrofitInfo(g.state, gen.id), cash = g.state.cash, ed = currentEdition(gen), q0 = ed.stats.Q;
    expect(info.cost).toBe(Math.max(config.lifecycle.retrofit.min, gen.devCost * config.lifecycle.retrofit.costShare));
    ok(g.command({ type: 'retrofit', generationId: gen.id }));
    expect(g.state.cash).toBeCloseTo(cash - info.cost, 6); expect(ed.options).toEqual(['abs', 'airbag']);
    expect(ed.stats.Q).toBeGreaterThan(q0);
    expect(unitCost(gen.body, gen.powertrain, ed.tier, ed.options, costMultOf(g.state))).toBeCloseTo(unitCost(gen.body, gen.powertrain, ed.tier, [], costMultOf(g.state)) + 130 * costMultOf(g.state), 6);
    expect(g.command({ type: 'retrofit', generationId: gen.id })).toEqual({ ok: false, reason: '추가할 의무 장비가 없습니다.' });
  });
});

describe('페이스리프트 옵션과 의무 장비(0.6.0 버그)', () => {
  it('미리보기 능력치에 의무 장비가 들어간다(옵션 목록에 없어도 출시 때처럼 자동 포함)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }), start = eraTimeline(1).find((x) => x.def.id === 'safety')!.start;
    g.state.cash = 1e9; g.state.week = (start - 30) * 4;
    ok(g.command({ type: 'startProject', ...SPEC })); g.devCheat('finishDev');
    ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    const gen = allGens(g.state)[0];
    g.state.week = (start + 40) * 4; grant(g, 'bd_airbag');
    const a = faceliftPreview(g.state, gen.id, { options: [] })!, b = faceliftPreview(g.state, gen.id, { options: ['abs', 'airbag'] })!;
    expect(a.grades).toEqual(b.grades); expect(a.profitAfter).toBeCloseTo(b.profitAfter, 6);
  });
});
