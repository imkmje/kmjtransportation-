// 0.7.0 임원: 자리·임명·채용, 제안(보고함) 일치, 맡기기 조건, 교체 고용, 결정론·저장
import { equipOf, expectEffect } from '../src/sim/equip';
import { yearOf } from '../src/sim/time';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, linesUsed, sellingGens } from '../src/sim/game';
import { steady, steadyExec } from '../src/sim/bots';
import { capacityOf, isTraining, linesOf, staffCap } from '../src/sim/company';
import { salaryOf } from '../src/sim/cars';
import { advice, faceliftPreview, factoryInfo, hiringInfo, hqInfo, lifeBar, priceForecast } from '../src/sim/queries';
import { execInfo, execReports, execSkill, execTier, execUnread, marketIdea, monthlyFixed, profitAlloc, recommendTech, weakCapped } from '../src/sim/execs';
import { regulatedTechs } from '../src/sim/research';
import { currentEdition } from '../src/sim/market';
import { config } from '../src/config';
import type { CarState, ExecRole, Staff } from '../src/sim/types';
import { SPEC, grant, launched, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 120_000 });
const X = config.exec;
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? '' : r.reason);

/** 외부 임원을 공고·채용하고 능력을 skill로 맞춘다(본사 자리 수는 지킨다) */
function hireExec(g: Game, role: ExecRole, skill = 80): Staff {
  g.state.cash = Math.max(g.state.cash, 1e6);
  ok(g.command({ type: 'postExecJob', role }));
  ok(g.command({ type: 'hireExec', role, candidateId: g.state.execs!.candidates.find((c) => c.role === role)!.id }));
  const x = g.state.execs!.seats[role]!.staff; x.ability = x.potential = skill;
  return x;
}
/** 테스트용: 본사 등급을 올려 자리를 늘린다(비용·평판 무시) */
const hq = (g: Game, level: number) => { g.state.hqLevel = level; };

describe('임원 자리·임명·채용', () => {
  it('본사 등급별 자리 수(1/2/4/5/6), 자리가 차면 임명 거절', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' });
    expect(execInfo(g.state).seats).toBe(1);
    ok(g.command({ type: 'appointExec', role: 'research', staffId: 2 }));
    expect(reason(g.command({ type: 'appointExec', role: 'hr', staffId: 3 }))).toContain('모두 찼습니다');
    expect(reason(g.command({ type: 'appointExec', role: 'research', staffId: 3 }))).toContain('이미 임원');
    for (const [lv, n] of [[2, 2], [3, 4], [4, 5], [5, 6]]) { hq(g, lv); expect(execInfo(g.state).seats).toBe(n); }
  });
  it('임명: 직원 목록에서 빠지고 개발에서도 빠지며, 월급 + 수당이 장부에 들어간다. 해임하면 원래 직무로 복귀', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const x = g.state.staff.find((y) => y.id === 2)!, pay = salaryOf(x.ability) + X.allowance;
    expect(x.projectId).not.toBeNull();
    ok(g.command({ type: 'appointExec', role: 'research', staffId: 2 }));
    expect(g.state.staff.some((y) => y.id === 2)).toBe(false);
    expect(g.state.execs!.seats.research!.staff.projectId).toBeNull();
    expect(execInfo(g.state).roles.find((r) => r.role === 'research')!.holder).toMatchObject({ staffId: 2, pay, hired: false, skill: execSkill('research', x) });
    toMonthEnd(g);
    expect(g.state.ledger.at(-1)!.salaries).toBe(g.state.staff.reduce((a, y) => a + salaryOf(y.ability), 0) + pay);
    ok(g.command({ type: 'dismissExec', role: 'research' }));
    expect(g.state.staff.find((y) => y.id === 2)?.role).toBe('engineer');
  });
  it('임원은 정원 밖(0.8.0 사용자 지시): 직원을 임명하면 그 자리가 비어 한 명을 더 뽑을 수 있고, 정원이 찬 채로도 외부 임원을 뽑는다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' });
    ok(g.command({ type: 'appointExec', role: 'hr', staffId: 1 }));
    expect(staffCap(g.state)).toBe(config.hq.levels[0].staff);
    expect(hiringInfo(g.state)).toMatchObject({ staffCount: 3, capacity: config.hq.levels[0].staff, full: false });
    expect(hqInfo(g.state).staffCount).toBe(3);
    hq(g, 2); while (g.state.staff.length < staffCap(g.state)) g.state.staff.push({ ...g.state.staff[0], id: g.state.nextId++ });
    hireExec(g, 'market');
    expect(g.state.staff.length).toBe(staffCap(g.state));
  });
  it('임원 수당 누진(0.8.0): 2명까지는 그대로, 3명부터 임원마다 seatAllowance가 더 붙는다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }); hq(g, 3);
    const pay = (r: ExecRole) => execInfo(g.state).roles.find((x) => x.role === r)!.holder!.pay;
    const x = g.state.staff.find((y) => y.id === 1)!, base = salaryOf(x.ability) + X.allowance;
    ok(g.command({ type: 'appointExec', role: 'hr', staffId: 1 })); ok(g.command({ type: 'appointExec', role: 'product', staffId: 2 }));
    expect(pay('hr')).toBe(base);
    ok(g.command({ type: 'appointExec', role: 'research', staffId: 3 }));
    expect(X.seatAllowance[2]).toBeGreaterThan(0);
    expect(pay('hr')).toBe(base + X.seatAllowance[2]);
    g.state.cash = 1e6; ok(g.command({ type: 'postExecJob', role: 'market' })); // 후보 카드 월급 = 뽑으면 실제 받을 월급(4명째 수당 포함)
    const c = g.state.execs!.candidates[0];
    expect(execInfo(g.state).roles.find((x) => x.role === 'market')!.candidates[0].pay).toBe(c.pay + X.seatAllowance[3]);
    toMonthEnd(g); expect(g.state.ledger.at(-1)!.salaries).toBe(g.state.staff.reduce((a, y) => a + salaryOf(y.ability), 0) + pay('hr') + pay('product') + pay('research'));
  });
  it('채용: 공고비, 후보 3명, 외부 임원 월급 = 직원 월급 × 1.6, 해임하면 퇴직금을 받고 떠난다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), c0 = g.state.cash;
    ok(g.command({ type: 'postExecJob', role: 'market' }));
    expect(c0 - g.state.cash).toBe(X.postCost);
    const cands = g.state.execs!.candidates;
    expect(cands).toHaveLength(X.candidates);
    for (const c of cands) { expect(c.skill).toBeGreaterThanOrEqual(X.hireSkillMin); expect(c.pay).toBe(Math.round(salaryOf(c.skill) * X.hiredPayMult)); }
    ok(g.command({ type: 'hireExec', role: 'market', candidateId: cands[0].id }));
    expect(g.state.execs!.candidates).toHaveLength(0);
    const n = g.state.staff.length, c1 = g.state.cash, pay = execInfo(g.state).roles.find((r) => r.role === 'market')!.holder!.pay;
    ok(g.command({ type: 'dismissExec', role: 'market' }));
    expect(g.state.staff).toHaveLength(n);
    expect(c1 - g.state.cash).toBe(pay * config.staff.severanceMonths);
  });
  it('능력 → 구체성 3단계, 맡기기는 능력 문턱 이상일 때만 켤 수 있고 기본은 꺼짐', () => {
    expect([execTier(X.tiers[0] - 1), execTier(X.tiers[0]), execTier(X.tiers[1])]).toEqual([1, 2, 3]);
    const g = Game.create({ seed: 1, difficulty: 'normal' }), x = hireExec(g, 'hr', X.delegateSkill - 1);
    const d = execInfo(g.state).roles.find((r) => r.role === 'hr')!.delegations;
    expect(d.every((k) => !k.on && !k.available && k.whyNot)).toBe(true);
    expect(reason(g.command({ type: 'setDelegation', role: 'hr', key: 'autoTrain', on: true }))).toContain(`${X.delegateSkill} 이상`);
    x.ability = X.delegateSkill;
    ok(g.command({ type: 'setDelegation', role: 'hr', key: 'autoTrain', on: true }));
    expect(execInfo(g.state).roles.find((r) => r.role === 'hr')!.delegations.find((k) => k.key === 'autoTrain')!.on).toBe(true);
    expect(reason(g.command({ type: 'setDelegation', role: 'hr', key: 'autoAlloc', on: true }))).toContain('그런 맡기기가 없습니다');
  });
});

/** 각 제안이 말한 조건이 그 순간의 상태와 맞는가(보고 key = 대상 ID) */
const CHECK: Record<string, (s: CarState, r: ReturnType<typeof execReports>[number] & { key: string }) => boolean> = {
  fire: (s, r) => weakCapped(s, s.staff.find((x) => x.id === r.goto!.id)!),
  replace: (s, r) => weakCapped(s, s.staff.find((x) => x.id === r.goto!.id)!) && s.cash > monthlyFixed(s) * X.replace.cashMonths,
  train: (s, r) => { const x = s.staff.find((y) => y.id === r.goto!.id)!; return x.projectId !== null || x.potential - x.ability + 3 >= X.hr.growGap; }, // 교육 뒤라 능력이 올랐을 수 있다(+1~3)
  rest: (s, r) => s.staff.find((y) => y.id === r.goto!.id)!.condition < config.staff.condition.low,
  hire: (s) => s.staff.length < staffCap(s),
  discontinue: (s, r) => advice(allGens(s).find((g) => g.id === r.goto!.id)!, s).includes('단종을 권합니다'),
  fullchange: (s, r) => lifeBar(s, allGens(s).find((g) => g.id === r.goto!.id)!) < X.product.fullChangeLife,
  facelift: (s, r) => { const g = allGens(s).find((x) => x.id === r.goto!.id)!, pv = faceliftPreview(s, g.id, { options: currentEdition(g).options })!; return pv.eligibility.ok && pv.paybackMonths !== null && pv.paybackMonths <= X.product.faceliftPayback && r.facts.slice(2).every((f) => f.includes(`${pv.paybackMonths}개월`)); },
  cashOut: (s) => s.ledger.slice(-3).reduce((a, e) => a + e.profit, 0) < 0,
  repay: (s) => s.loan.balance > 0 && s.cash - s.loan.balance >= monthlyFixed(s) * X.finance.repayMonths,
  priceUp: (s, r) => { const g = allGens(s).find((x) => x.id === r.goto!.id)!; const p = Number(r.facts[1]?.match(/→ ([\d,]+)만원/)?.[1].replace(/,/g, '') ?? NaN); return g.lostSales >= 1 && (r.facts.length < 3 || r.facts[2].includes(`${priceForecast(s, g.id, p)}대`)); },
  priceDown: (s, r) => allGens(s).find((x) => x.id === r.goto!.id)!.lostSales < 1,
  expand: (s) => factoryInfo(s).ratio >= config.bots.expandRatio,
  lines: (s) => linesUsed(s) >= linesOf(s),
  alloc: (s) => { const a = profitAlloc(s); return a.changed && a.after > a.now; },
  regulation: (s) => regulatedTechs(s).size > 0,
  emptySlot: (s, r) => recommendTech(s)?.id === r.key,
  build: (s, r) => { const [body, seg] = r.key.split(':'); return r.facts.length < 2 || r.facts[1].includes(`예상 월 판매 ${marketIdea(s, body, seg).sales}대`); },
  adUp: (s, r) => { const g = allGens(s).find((x) => x.id === r.goto!.id)!; return g.awareness < X.market.lowAwareness; },
  adDown: (s, r) => { const g = allGens(s).find((x) => x.id === r.goto!.id)!; return g.marketing >= 2 && g.lostSales >= 1; },
  expectEquip: (s, r) => { const g = allGens(s).find((x) => x.id === r.goto!.id)!, fx = expectEffect(equipOf(currentEdition(g)), g.body, yearOf(s.week)); return fx.missing.length + fx.optOnly.length > 0; }, // 1.1.0
};

describe('제안(보고함)', () => {
  it('임원별 최대 2건, 같은 제안은 재발행 간격 안에 다시 나오지 않는다, 결산 이벤트에 새 보고 수', () => {
    const { g } = launched(1);
    hq(g, 5); for (const r of ['hr', 'product', 'finance', 'production', 'research', 'market'] as ExecRole[]) hireExec(g, r);
    let ev = g.tick(); while (!ev.some((e) => e.kind === 'monthEnd')) ev = g.tick();
    const reps = execReports(g.state), e = ev.find((x) => x.kind === 'execReport');
    expect(reps.length).toBeGreaterThan(0);
    expect(e).toMatchObject({ kind: 'execReport', count: reps.length });
    for (const r of ['hr', 'product', 'finance', 'production', 'research', 'market']) expect(reps.filter((x) => x.role === r && !x.auto).length).toBeLessThanOrEqual(X.perExec);
    expect(execUnread(g.state)).toBe(reps.length);
    const keys = new Set(g.state.execs!.reports.map((r) => `${r.role}:${r.kind}:${r.key}`));
    toMonthEnd(g);
    expect(g.state.execs!.reports.filter((r) => r.week > reps[0].week && keys.has(`${r.role}:${r.kind}:${r.key}`))).toEqual([]);
    ok(g.command({ type: 'markReportsRead' })); expect(execUnread(g.state)).toBe(0);
    const first = g.state.execs!.reports[0]; ok(g.command({ type: 'dismissReport', id: first.id }));
    expect(g.state.execs!.cooldown[`${first.role}:${first.kind}:${first.key}`]).toBeGreaterThanOrEqual(g.state.week + X.ignoredMonths * 4 - 1);
  });
  it('구체성: 같은 상황에서 능력 1단계는 이름·수치를 말하지 않고 3단계는 말한다(근거 수치 개수도 다르다)', () => {
    const run = (skill: number) => {
      const g = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g, 'research', skill); toMonthEnd(g);
      return execReports(g.state).find((r) => r.kind === 'emptySlot')!;
    };
    const lo = run(30), hi = run(90);
    expect(lo.text).not.toContain('「'); expect(hi.text).toContain('「'); expect(hi.text).toMatch(/\d/);
    expect(lo.facts.length).toBe(1); expect(hi.facts.length).toBeGreaterThan(lo.facts.length);
  });
  it('모든 제안이 말한 조건이 그 순간의 실제 상태와 맞는다(신중 봇 + 임원 6명, 3판 × 30년)', () => {
    let skipped = 0;
    const seen = new Map<string, number>(), sa = X.seatAllowance;
    X.seatAllowance = sa.map(() => 0); // 창업 초 본사 1등급에 임원 6명을 앉힌 인공 상황이라 6명 몫 수당(0.8.0)이면 곧 파산한다(이 테스트는 제안 정합성만 본다)
    try { for (const seed of [1, 2, 3]) {
      const g = Game.create({ seed, difficulty: 'easy' }), b = steady();
      hq(g, 5); for (const r of ['hr', 'product', 'finance', 'production', 'research', 'market'] as ExecRole[]) hireExec(g, r);
      g.state.cash = 500000; g.state.hqLevel = 1;
      for (let w = 0; w < 30 * 48 && g.state.status === 'playing'; w++) {
        b.step(g);
        const last = g.state.execs!.reports.at(-1)?.id ?? -1, mods = JSON.stringify(g.state.events.mods);
        g.tick();
        // 결산 뒤 다음 달 첫 주 처리(무작위 사건의 기간 효과가 생기거나 끝남)가 수요를 바꾼 주는 보고 시점 상태를 되살릴 수 없어 건너뛴다
        const filt = g.state.events.mods.filter((m) => m.untilMonth > Math.floor(g.state.week / 4) - 1);
        if (JSON.stringify(filt) !== mods && g.state.week % 4 === 0) { skipped++; continue; }
        for (const r of g.state.execs!.reports.filter((x) => x.id > last && !x.auto)) {
          seen.set(r.kind, (seen.get(r.kind) ?? 0) + 1);
          const full = { ...execReports(g.state).find((x) => x.id === r.id)!, key: r.key }, at = { ...g.state, week: r.week }; // 보고를 만든 주(월 결산) 기준으로 본다
          expect(CHECK[r.kind], r.kind).toBeTypeOf('function');
          expect(CHECK[r.kind](at, full), `${r.kind} ${r.text} ${r.facts.join(' / ')}`).toBe(true);
        }
      }
    } } finally { X.seatAllowance = sa; }
    console.log('관찰한 제안:', [...seen].map(([k, v]) => `${k} ${v}`).join(', '), `(사건 효과가 바뀐 결산 ${skipped}번은 건너뜀)`);
    for (const k of ['fire', 'facelift', 'priceUp', 'build', 'emptySlot', 'expand']) expect(seen.has(k), k).toBe(true);
  });
  it('시장 조사: 아직 안 내 본 조합은 "잘 맞을 것으로 보입니다"까지만, 궁합 기호는 내 본 조합에만', () => {
    const { g } = launched(1); grant(g);
    hireExec(g, 'market', 90); toMonthEnd(g);
    const b = execReports(g.state).find((r) => r.kind === 'build')!, at = { ...g.state, week: b.week };
    expect(b.text).toMatch(/내 보는 건 어떨까요/);
    expect(b.text).not.toMatch(/[◎○△×]/);
    expect(b.facts[1]).toContain(`예상 월 판매 ${marketIdea(at, ...(g.state.execs!.reports.find((r) => r.kind === 'build')!.key.split(':') as [string, string])).sales}대`);
    expect(b.text).toContain('잘 맞을 것으로 보입니다');
  });
  it('기획·재무·생산·시장 조사: 풀체인지 적기, 가격 내리기, 생산 라인 부족, 광고 줄이기', () => {
    const kinds = (g: Game) => execReports(g.state).filter((r) => !r.auto).map((r) => r.kind);
    const check = (g: Game, kind: string) => { const r = g.state.execs!.reports.find((x) => x.kind === kind)!; expect(r, kind).toBeDefined(); expect(CHECK[kind]({ ...g.state, week: r.week }, { ...execReports(g.state).find((x) => x.id === r.id)!, key: r.key }), kind).toBe(true); };
    { const { g } = launched(1); hireExec(g, 'product', 90); g.state.week += 100 * 4; toMonthEnd(g); expect(kinds(g)).toContain('fullchange'); check(g, 'fullchange'); }
    { const { g } = launched(1, 1700); hireExec(g, 'finance', 90); toMonthEnd(g); toMonthEnd(g); expect(kinds(g)).toContain('priceDown'); check(g, 'priceDown'); }
    { const { g } = launched(1); hireExec(g, 'production', 90); ok(g.command({ type: 'startProject', ...SPEC, name: '둘째' })); toMonthEnd(g); expect(kinds(g)).toContain('lines'); check(g, 'lines'); }
    { const { g, gen } = launched(1, 1200, 3); hireExec(g, 'market', 90); g.state.events.mods.push({ kind: 'production', value: 0.05, untilMonth: 999, label: '테스트' }); gen.awareness = 0.9; toMonthEnd(g); expect(kinds(g)).toContain('adDown'); check(g, 'adDown'); }
  });
  it('연구소장: 규제가 예고되면 규제 대비 연구를 제안한다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g, 'research', 90);
    while (!regulatedTechs(g.state).size) g.state.week += 4;
    toMonthEnd(g);
    const r = execReports(g.state).find((x) => x.kind === 'regulation');
    expect(r?.text).toContain('의무 장비');
  });
  it('재무: 손실이 이어지면 현금 부족 예고, 대출을 갚을 여유가 있으면 상환 권유', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g, 'finance', 90);
    for (let i = 0; i < 3; i++) toMonthEnd(g);
    g.state.cash = 5000; g.state.execs!.cooldown = {}; toMonthEnd(g);
    expect(execReports(g.state).some((r) => r.kind === 'cashOut')).toBe(true);
    const g2 = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g2, 'finance', 90);
    ok(g2.command({ type: 'borrow', amount: 10000 })); g2.state.cash = 1e7; toMonthEnd(g2);
    expect(execReports(g2.state).find((r) => r.kind === 'repay')?.text).toContain('모두 갚아도');
  });
});

describe('맡기기', () => {
  it('자동 교육: 개발 중인 직원은 보내지 않고, 현금이 운영비 N개월 치 아래면 보내지 않으며, 동시 인원 제한', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g, 'hr', 90);
    ok(g.command({ type: 'setDelegation', role: 'hr', key: 'autoTrain', on: true }));
    ok(g.command({ type: 'startProject', ...SPEC, team: [1, 2] }));
    for (const x of g.state.staff) x.potential = 90;
    g.state.cash = monthlyFixed(g.state) * X.hr.trainCashMonths; // 교육비를 내면 기준 아래
    toMonthEnd(g);
    expect(g.state.staff.some((x) => x.trainings.length)).toBe(false);
    g.state.cash = 1e7; toMonthEnd(g);
    const trained = g.state.staff.filter((x) => x.trainings.length);
    expect(trained.length).toBeGreaterThan(0);
    expect(trained.length).toBeLessThanOrEqual(X.hr.trainMax);
    expect(trained.every((x) => x.id !== 1 && x.id !== 2)).toBe(true);
    expect(g.state.execs!.reports.some((r) => r.kind === 'autoTrain' && r.auto)).toBe(true);
    expect(g.state.staff.filter((x) => isTraining(x, g.state.week)).length).toBeLessThanOrEqual(X.hr.trainMax);
  });
  it('자동 교육: 성장 한계에 닿은 직원은 제외', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g, 'hr', 90); g.state.cash = 1e7;
    ok(g.command({ type: 'setDelegation', role: 'hr', key: 'autoTrain', on: true }));
    for (const x of g.state.staff) x.potential = x.ability;
    toMonthEnd(g);
    expect(g.state.staff.some((x) => x.trainings.length)).toBe(false);
  });
  it('자동 휴식: 지친 직원만 쉬게 하고 보고함에 남긴다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g, 'hr', 90);
    ok(g.command({ type: 'setDelegation', role: 'hr', key: 'autoRest', on: true }));
    g.state.staff[0].condition = 0; // 쉬는 동안 주마다 회복해 월말에 0.2
    toMonthEnd(g);
    expect(g.state.staff[0].restUntil).not.toBeNull();
    expect(g.state.staff.slice(1).every((x) => x.restUntil === null)).toBe(true);
    expect(execReports(g.state).find((r) => r.kind === 'autoRest')?.auto).toBe(true);
  });
  it('자동 연구: 빈 칸에 추천 연구(규제 필요 기술 우선), 현금 하한 아래면 시작하지 않음', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }); hireExec(g, 'research', 90);
    ok(g.command({ type: 'setDelegation', role: 'research', key: 'autoResearch', on: true }));
    g.state.cash = monthlyFixed(g.state) * X.research.cashMonths; toMonthEnd(g);
    expect(g.state.research.active).toHaveLength(0);
    g.state.cash = 1e8; toMonthEnd(g);
    expect(g.state.research.active.length).toBeGreaterThan(0);
    while (!regulatedTechs(g.state).size) g.state.week += 4;
    g.state.research.active = []; toMonthEnd(g);
    const req = regulatedTechs(g.state);
    expect(req.has(g.state.research.active[0].techId) || [...req.keys()].every((id) => g.state.research.active.some((a) => a.techId === id) || g.state.research.done.includes(id))).toBe(true);
  });
  it('자동 생산 배분: 주문이 한도를 넘으면 대당 이익이 큰 차부터, 한도 안이면 자동으로', () => {
    const r = steadyRun(1, 12);
    const g = r.g, gens = sellingGens(g.state);
    expect(gens.length).toBeGreaterThanOrEqual(2);
    hq(g, 5); hireExec(g, 'production', 90);
    ok(g.command({ type: 'setDelegation', role: 'production', key: 'autoAlloc', on: true }));
    for (const x of gens) x.lastDemand = capacityOf(g.state);
    const a = profitAlloc(g.state);
    expect(a.after).toBeGreaterThanOrEqual(a.now);
    const top = a.gens[a.unit.indexOf(Math.max(...a.unit))];
    expect(a.shares[a.gens.indexOf(top)]).toBeGreaterThan(0.9);
  });
});

const steadyRun = (seed: number, years: number, bot = steady()) => { const g = Game.create({ seed, difficulty: 'easy' }); for (let w = 0; w < years * 48; w++) { bot.step(g); g.tick(); } return { g }; };

describe('교체 고용', () => {
  const cap = X.replace.capGain;
  /** 디자이너 둘(한 명은 능력 30에서 성장 한계, 다른 한 명은 60)과 인사 임원, 넉넉한 현금 */
  function setup(seed = 1) {
    const g = Game.create({ seed, difficulty: 'normal' }); g.state.reputation = 50; hireExec(g, 'hr', 90);
    const d = g.state.staff.find((x) => x.role === 'designer')!; d.ability = d.potential = 30;
    g.state.staff.push({ ...d, id: g.state.nextId++, name: '보조디자이너', ability: 60, potential: 70 });
    g.state.cash = 1e8;
    return { g, d };
  }
  const propose = (g: Game) => { toMonthEnd(g); const r = g.state.execs!.replacements.find((x) => x.status === 'proposed'); expect(r).toBeDefined(); return r!; };
  it('제안: 성장 한계·같은 직무 평균보다 낮은 직원, 한 번에 한 건, 기준 = max(능력 + 25, 평균)(0.8.0: 15 → 25)', () => {
    const { g, d } = setup(), r = propose(g);
    expect(r.staffId).toBe(d.id); expect(r.minAbility).toBe(60);
    const rep = execReports(g.state).find((x) => x.replacement?.id === r.id)!;
    expect(rep.text).toContain(`${d.name}(디자인 30, 더 성장하기 어려움)`); expect(rep.text).toContain('디자인 60 이상');
    toMonthEnd(g);
    expect(g.state.execs!.replacements.filter((x) => x.status === 'proposed')).toHaveLength(1);
  });
  it('승인 → 개발 중이면 대기 → 개발이 끝난 주에 공고, 기준 이상이면 재승인 없이 교체', () => {
    const { g, d } = setup();
    ok(g.command({ type: 'startProject', ...SPEC, team: [d.id] }));
    const r = propose(g);
    ok(g.command({ type: 'approveReplacement', id: r.id }));
    g.tick();
    expect(r.status).toBe('waiting'); expect(r.waitingFor).toContain('개발이 끝나면');
    expect(g.state.staff.some((x) => x.id === d.id)).toBe(true);
    r.minAbility = 1; X.replace.capGain = 100; // 어떤 후보든 기준 이상, 상한 없음
    ok(g.command({ type: 'cancelProject', projectId: g.state.projects[0].id }));
    const ev = g.tick();
    expect(r.status).toBe('done');
    expect(g.state.staff.some((x) => x.id === d.id)).toBe(false);
    const t = ev.find((e) => e.kind === 'replacement')!;
    expect(t.text).toMatch(new RegExp(`${d.name} → .+\\(디자인 \\d+\\)`));
    expect(execReports(g.state)[0]).toMatchObject({ kind: 'replaceDone', auto: true });
    X.replace.capGain = cap;
    // 0.8.0: 같은 직무는 교체를 마친 뒤 gapMonths 동안 다시 교체를 제안하지 않는다(해고 권유는 그대로)
    const d2 = g.state.staff.find((x) => x.role === 'designer' && x.ability >= 60)!;
    g.state.staff.push({ ...d2, id: g.state.nextId++, name: '약한디자이너', ability: 20, potential: 20, projectId: null });
    toMonthEnd(g);
    expect(g.state.execs!.replacements.filter((x) => x.status === 'proposed')).toHaveLength(0);
    for (let i = 0; i < X.replace.gapMonths * 4; i++) g.tick();
    toMonthEnd(g);
    expect(g.state.execs!.replacements.filter((x) => x.status === 'proposed' && x.staffName === '약한디자이너')).toHaveLength(1);
  });
  it('0.8.0: 기준 + capGain을 넘는 후보는 오지 않는다(기준 1·상한 0이면 모든 후보가 넘어 교체 안 됨)', () => {
    const { g, d } = setup(), r = propose(g);
    ok(g.command({ type: 'approveReplacement', id: r.id }));
    r.minAbility = 1; X.replace.capGain = 0;
    try { g.tick(); } finally { X.replace.capGain = cap; }
    expect(r.status).toBe('approved'); expect(g.state.staff.some((x) => x.id === d.id)).toBe(true);
    expect(execReports(g.state)[0].text).toContain('디자인 1~1에 맞는 후보가 없어');
  });
  it('기준 미달 후보뿐이면 교체하지 않고(공고비는 듦) 몇 주 뒤 한 번 더, 그래도 없으면 포기', () => {
    const { g, d } = setup(), r = propose(g);
    ok(g.command({ type: 'approveReplacement', id: r.id }));
    r.minAbility = 101;
    const c0 = g.state.cash; g.tick();
    expect(r.status).toBe('approved'); expect(r.tries).toBe(1);
    expect(c0 - g.state.cash).toBeGreaterThan(0);
    expect(g.state.staff.some((x) => x.id === d.id)).toBe(true);
    for (let i = 0; i < X.replace.retryWeeks; i++) g.tick();
    expect(r.status).toBe('failed');
    expect(g.state.staff.some((x) => x.id === d.id)).toBe(true);
  });
  it('실행 때 현금이 모자라면 보류, 대상이 더는 약하지 않으면 취소, 예약은 취소할 수 있다', () => {
    const { g, d } = setup(), r = propose(g);
    ok(g.command({ type: 'approveReplacement', id: r.id }));
    g.state.cash = 100; g.tick();
    expect(r.status).toBe('approved'); expect(r.held).toBe(true); expect(r.waitingFor).toContain('현금');
    g.state.cash = 1e8; d.ability = 60; d.potential = 60;
    for (let i = 0; i < 5 && r.status === 'approved'; i++) g.tick();
    expect(r.status).toBe('cancelled');
    const s2 = setup(), r2 = propose(s2.g);
    ok(s2.g.command({ type: 'approveReplacement', id: r2.id }));
    ok(s2.g.command({ type: 'cancelReplacement', id: r2.id }));
    expect(r2.status).toBe('cancelled');
  });
  it('거절한 직원은 2년 동안 다시 제안하지 않는다', () => {
    const { g, d } = setup(), r = propose(g);
    ok(g.command({ type: 'rejectReplacement', id: r.id }));
    for (let i = 0; i < 23; i++) toMonthEnd(g);
    expect(g.state.execs!.replacements.filter((x) => x.staffId === d.id && x.status === 'proposed')).toHaveLength(0);
    for (let i = 0; i < 4; i++) toMonthEnd(g);
    expect(g.state.execs!.replacements.filter((x) => x.staffId === d.id && x.status === 'proposed')).toHaveLength(1);
  });
  it('임원 본인은 대상이 아니다(임원은 직원 목록에 없다)', () => {
    const { g } = setup();
    const id = g.state.execs!.seats.hr!.staff.id;
    toMonthEnd(g);
    expect(g.state.execs!.replacements.every((x) => x.staffId !== id)).toBe(true);
  });
});

describe('결정론·저장', () => {
  const play = (g: Game, months: number) => { const b = steadyExec(); for (let w = 0; w < months * 4; w++) { b.step(g); g.tick(); } };
  it('같은 시드·같은 명령이면 같은 결과, 저장 → 불러오기 뒤 이어도 같다', () => {
    const a = Game.create({ seed: 7, difficulty: 'easy' }), b = Game.create({ seed: 7, difficulty: 'easy' });
    play(a, 120); play(b, 120);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
    expect(Object.keys(a.state.execs?.seats ?? {}).length).toBeGreaterThan(0);
    const c = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    play(a, 60); play(c, 60);
    expect(JSON.stringify(c.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
  it('옛 저장(형식 4 fixture)을 열면 임원 없이 그대로, 임명하면 동작한다', () => {
    for (const f of ['save-v4.json', 'save-v3.json']) {
      const g = Game.fromJSON(JSON.parse(readFileSync(`car/tests/fixtures/${f}`, 'utf8')));
      expect(g.state.execs).toBeUndefined();
      expect(execInfo(g.state).used).toBe(0);
      ok(g.command({ type: 'appointExec', role: 'hr', staffId: g.state.staff[0].id }));
      toMonthEnd(g);
      expect(g.state.saveVersion).toBe(7);
    }
  });
});

// 쉬움 창업 5년 안에 임원 1명을 둬도 흑자 유지: 신중 봇 + 2년째에 직원 한 명을 인사 임원으로(수당 포함)
it('쉬움: 창업 2년째에 임원 1명을 둬도 5년째 연간 흑자(시드 20개, 신중 봇보다 1판 넘게 줄지 않음)', () => {
  let a = 0, b = 0;
  for (let seed = 1; seed <= 20; seed++) for (const withExec of [false, true]) {
    const g = Game.create({ seed, difficulty: 'easy' }), bot = steady();
    for (let w = 0; w < 5 * 48; w++) {
      if (withExec && w === 48) ok(g.command({ type: 'appointExec', role: 'hr', staffId: [...g.state.staff].sort((x, y) => execSkill('hr', y) - execSkill('hr', x))[0].id }));
      bot.step(g); g.tick();
    }
    const y = Number(g.state.ledger.slice(-12).reduce((x, e) => x + e.profit, 0) > 0);
    if (withExec) b += y; else a += y;
  }
  console.log(`쉬움 5년째 흑자: 신중 ${a}/20, 임원 1명 ${b}/20`);
  expect(b).toBeGreaterThanOrEqual(a - 1);
});
