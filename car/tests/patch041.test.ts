// 0.4.1 긴급 수정: 출시 대기(결함을 다 잡으면 개발비 0), 설명 필드(info), 문구 용어
import { describe, it, expect } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { defectAdvice, difficultyInfo, loanLimit, projectStatus, researchInfo, upkeepOf } from '../src/sim/queries';
import { weeklyDevCost } from '../src/sim/dev';
import { criticScores } from '../src/sim/reviews';
import { monthlyDemand } from '../src/sim/market';
import { clumsy, idle, novice, steady, type Bot } from '../src/sim/bots';
import { monthOf } from '../src/sim/time';
import type { Difficulty } from '../src/sim/types';
import { BODIES, OPTIONS, POWERTRAINS, SEGMENTS, TECHS, RANDOM_EVENTS, ERA_EVENTS } from '../src/data';
import { config } from '../src/config';
import { SPEC, ok } from './util';

/** 결함이 0이 되어 출시 대기가 될 때까지 진행(최대 60주). 그 주의 이벤트를 돌려준다 */
function toWaiting(g: Game) {
  const p = g.state.projects[0];
  for (let i = 0; i < 60; i++) { const ev = g.tick(); if (p.waiting) return ev; }
  throw new Error('출시 대기가 되지 않았습니다');
}

describe('출시 대기(0.4.1)', () => {
  it('시험 중 실제 결함이 0이 되고 최소 시험 주를 채우면 출시 대기: 알림, 직원 해방, 화면 결함 0, 그 뒤 개발비 0', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const p = g.state.projects[0], team = g.state.staff.filter((x) => x.projectId === p.id).map((x) => x.id);
    expect(projectStatus(g.state, p.id)!.waiting).toBe(false);
    expect(projectStatus(g.state, p.id)!.costNote).toMatch(/^설계 중에는 주마다 약 [\d,]+만원이 듭니다\(직원 몫 \+ 시제차\)\.$/);
    expect(projectStatus(g.state, p.id)!.weeklyCost).toBeGreaterThan(config.dev.prototypePerWeek);
    const ev = toWaiting(g);
    expect(p.defects).toBe(0); expect(p.defectEst).toBe(0); expect(p.testWeeks).toBeGreaterThanOrEqual(config.dev.minTestWeeks);
    expect(ev.some((e) => e.kind === 'advice' && e.text === `「${SPEC.name}」의 결함을 모두 잡았습니다. 이제 출시할 수 있습니다. 출시 대기 중에는 개발비가 들지 않습니다.`)).toBe(true);
    expect(g.state.staff.filter((x) => x.projectId === p.id)).toEqual([]);
    expect(p.crew).toEqual(team);
    expect(projectStatus(g.state, p.id)).toEqual({ phase: 'test', waiting: true, weeklyCost: 0, costNote: '출시 대기 중이라 개발비가 들지 않습니다.' });
    const spent = p.spent, tw = p.testWeeks;
    for (let i = 0; i < 12; i++) { const e = g.tick(); expect(e.some((x) => x.kind === 'devWeek')).toBe(false); }
    expect(p.spent).toBe(spent); expect(p.testWeeks).toBe(tw); expect(p.defectEst).toBe(0);
    expect(g.state.ledger.at(-1)!.dev).toBe(0);
    // 풀려난 엔지니어는 연구 점수를 만들 수 있다(진행 중인 연구가 있을 때)
    expect(researchInfo(g.state).pointsPerWeek).toBeGreaterThan(0);
    // 출시할 수 있고, 함께 만든 직원은 경험을 받는다
    const before = g.state.staff.filter((x) => team.includes(x.id)).map((x) => x.ability);
    ok(g.command({ type: 'launch', projectId: p.id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    expect(allGens(g.state).length).toBe(1); expect(allGens(g.state)[0].editions[0].defects).toBe(0);
    const after = g.state.staff.filter((x) => team.includes(x.id)).map((x) => x.ability);
    after.forEach((a, i) => expect(a).toBeGreaterThanOrEqual(before[i]));
    expect(after.some((a, i) => a > before[i]) || g.state.staff.filter((x) => team.includes(x.id)).every((x) => x.ability >= x.potential)).toBe(true);
  });
  it('출시 대기 중에도 개발팀 자리는 그대로 차지하고, 직원은 다른 프로젝트·연구로 돌릴 수 있다. 저장·불러오기 왕복', () => {
    const g = Game.create({ difficulty: 'normal', seed: 2 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    toWaiting(g);
    expect(g.command({ type: 'startProject', ...SPEC, name: '둘째' })).toEqual({ ok: false, reason: '개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.' });
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(back.state.projects[0].waiting).toBe(true);
    for (let i = 0; i < 8; i++) { g.tick(); back.tick(); }
    expect(JSON.stringify(back.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
  it('예전 저장(waiting 필드 없음)은 출시 대기가 아닌 것으로 본다', () => {
    const g = Game.create({ difficulty: 'normal', seed: 3 });
    ok(g.command({ type: 'startProject', ...SPEC }));
    const st = JSON.parse(JSON.stringify(g.toJSON())); delete st.projects[0].waiting;
    expect(projectStatus(Game.fromJSON(st).state, st.projects[0].id)!.waiting).toBe(false);
  });
});

describe('설명 필드와 용어(0.4.1)', () => {
  it('모든 기술·옵션·동력·차체·고객층에 info가 있고 10자 이상, 느낌표 없음', () => {
    for (const x of [...TECHS, ...OPTIONS, ...POWERTRAINS, ...BODIES, ...SEGMENTS] as { id: string; info?: string }[]) {
      expect(typeof x.info, x.id).toBe('string'); expect(x.info!.length, x.id).toBeGreaterThanOrEqual(10); expect(x.info, x.id).not.toContain('!');
    }
    const row = researchInfo(Game.create({ difficulty: 'normal', seed: 1 }).state).fields.flatMap((f) => f.techs).find((t) => t.id === 'el_radio')!;
    expect(row.info).toBe(TECHS.find((t) => t.id === 'el_radio')!.info);
  });
  it('기술 이름은 본래 용어, 유치한 풀이·괄호 풀이·느낌표를 쓰지 않는다', () => {
    const name = (id: string) => TECHS.find((t) => t.id === id)!.name;
    expect([name('pw_dohc'), name('pw_vvt'), name('pw_turbo'), name('pw_carb'), name('pw_gdi'), name('ec_phev'), name('pr_cad'), name('pr_ai'), name('ec_battery1')])
      .toEqual(['DOHC 16밸브', '가변 밸브 타이밍', '다운사이징 터보', '개량 기화기', '직접 분사', '플러그인 하이브리드', 'CAD 설계', 'AI 설계', '리튬이온 배터리 개량']);
    const texts = [...TECHS.flatMap((t) => [t.name, t.desc]), ...ERA_EVENTS.flatMap((e) => [e.warn, e.start, e.end]), ...RANDOM_EVENTS.flatMap((e) => [e.text, ...e.choices.flatMap((c) => [c.label, c.result])])];
    for (const t of texts) { expect(t).not.toContain('!'); expect(t).not.toMatch(/봐주는|알려진 정도|환율 보험|숨 잘 쉬는/); }
    expect(RANDOM_EVENTS.find((e) => e.id === 'fx')!.choices[0].label).toBe('환 헤지');
  });
});

describe('난이도(0.4.1)', () => {
  const D = config.difficulty;
  it('새 게임 기본은 쉬움, 예전 저장(필드 없음)은 보통. 시작 현금·대출 한도·유지비가 표대로', () => {
    const e = Game.create({ seed: 1 }).state, n = Game.create({ difficulty: 'normal', seed: 1 }).state, h = Game.create({ difficulty: 'hard', seed: 1 }).state;
    expect(e.difficulty).toBe('easy'); expect(e.cash).toBe(D.easy.cash); expect(n.cash).toBe(D.normal.cash); expect(h.cash).toBe(D.hard.cash);
    expect(loanLimit(e)).toBe(D.easy.loanBase); expect(loanLimit(n)).toBe(D.normal.loanBase); expect(loanLimit(h)).toBe(D.hard.loanBase);
    expect(upkeepOf(e)).toBeCloseTo(upkeepOf(n) * D.easy.upkeepMult, 9); expect(upkeepOf(h)).toBeCloseTo(upkeepOf(n) * D.hard.upkeepMult, 9);
    const old = JSON.parse(JSON.stringify(e)); delete old.difficulty;
    const loaded = Game.fromJSON(old).state;
    expect(loaded.difficulty).toBeUndefined(); expect(loanLimit(loaded)).toBe(D.normal.loanBase);
    expect(() => Game.create({ seed: 1, difficulty: 'nightmare' as never })).toThrow();
  });
  it('시제차 비용·평론 감점 기준·리콜 비용·경쟁 차 세기가 난이도를 따른다', () => {
    const mk = (d: 'easy' | 'normal') => { const g = Game.create({ difficulty: d, seed: 1 }); ok(g.command({ type: 'startProject', ...SPEC })); return g; };
    const e = mk('easy'), n = mk('normal'), pe = e.state.projects[0], pn = n.state.projects[0];
    expect(weeklyDevCost(n.state, pn) - weeklyDevCost(e.state, pe)).toBeCloseTo(config.dev.prototypePerWeek * (1 - D.easy.prototypeMult), 6);
    const stats = { P: 100, E: 100, U: 100, D: 100, Q: 100 };
    expect(criticScores(stats, 1970, 1200, 1200, 17, () => 0, D.easy.manyDefects)[0]).toBeGreaterThan(criticScores(stats, 1970, 1200, 1200, 17, () => 0, D.normal.manyDefects)[0]);
    pe.defectEst = 17; expect(defectAdvice(pe, e.state).level).toBe('some'); expect(defectAdvice(pe, n.state).level).toBe('many');
    const car = { body: 'sedanS', segment: 'worker', stats, price: 1200, awareness: 0.3, life: 1, powertrain: 'gasoline' };
    expect(monthlyDemand(e.state, car, [], 1975)).toBeGreaterThan(monthlyDemand(n.state, car, [], 1975)); // 쉬움은 경쟁 차가 약하다
    // 리콜 비용: 쉬움은 보통의 60%
    for (const g of [e, n]) { const s = g.state; while (s.projects[0].phase === 'design' || s.projects[0].testWeeks < 2) g.tick(); ok(g.command({ type: 'launch', projectId: s.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 })); }
    const recallCost = (g: Game) => { const gen = allGens(g.state)[0]; gen.editions[0].defects = 20; for (let i = 0; i < 48 * 6; i++) if (g.tick().some((x) => x.kind === 'recall')) return g.state.ledger.at(-1)!.recall / gen.totalSold; return NaN; }; // 리콜 비용 = 그달까지의 누적 판매 × 대당 비용
    expect(recallCost(e)).toBeCloseTo(config.recall.costPerCar * D.easy.recallMult, 6); expect(recallCost(n)).toBeCloseTo(config.recall.costPerCar, 6);
  });
  it('파산 유예·경고 문구·구제 금융 횟수가 난이도를 따른다(쉬움 24개월·2회(0.4.2), 어려움 6개월·0회)', () => {
    const g = Game.create({ seed: 1 }); g.state.cash = -1;
    const w: string[] = [];
    while (g.state.status === 'playing') for (const e of g.tick()) if (e.kind === 'cashWarning') w.push(e.text);
    expect(g.state.negMonths).toBe(D.easy.bankruptcyMonths);
    expect(w[0]).toBe('현금이 1개월째 마이너스입니다. 24개월이 되면 파산합니다. 대출 한도 50억원이 남아 있습니다.');
    ok(g.command({ type: 'bailout' })); expect(g.state.loan.bailoutUsed).toBe(false);
    g.state.cash = -1; ok(g.command({ type: 'bailout' })); expect(g.state.loan.bailoutUsed).toBe(true); expect(g.state.loan.bailouts).toBe(2);
    g.state.cash = -1; expect(g.command({ type: 'bailout' })).toEqual({ ok: false, reason: '구제 금융은 2번까지만 받을 수 있습니다.' });
    const h = Game.create({ seed: 1, difficulty: 'hard' }); h.state.cash = -1;
    expect(h.state.loan.bailoutUsed).toBe(true);
    expect(h.command({ type: 'bailout' })).toEqual({ ok: false, reason: '이 난이도에서는 구제 금융을 받을 수 없습니다.' });
    while (h.state.status === 'playing') h.tick();
    expect(h.state.negMonths).toBe(D.hard.bankruptcyMonths);
  });
  it('difficultyInfo: 세 난이도의 이름·설명·주요 차이', () => {
    expect(difficultyInfo().map((d) => [d.id, d.name, d.cash, d.loanBase, d.bankruptcyMonths, d.bailouts, d.isDefault])).toEqual([
      ['easy', '쉬움', 500000, 500000, 24, 2, true], ['normal', '보통', 300000, 300000, 12, 1, false], ['hard', '어려움', 220000, 200000, 6, 0, false]]);
    for (const d of difficultyInfo()) { expect(d.desc.length).toBeGreaterThan(10); expect(d.desc).not.toContain('!'); }
  });
});

describe('난이도 균형(0.4.1, 시드 20개)', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
  const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return (v[9] + v[10]) / 2; };
  /** years년 돌려 살아 있는 판 수·현금 중앙값·파산 달 */
  const run = (bot: () => Bot, d: Difficulty, years: number) => SEEDS.map((seed) => {
    const g = Game.create({ seed, difficulty: d }), b = bot();
    for (let w = 0; w < years * 48 && g.state.status === 'playing'; w++) { b.step(g); g.tick(); }
    return { alive: g.state.status === 'playing', cash: g.state.cash, month: monthOf(g.state.week) };
  });
  const alive = (rs: { alive: boolean }[]) => rs.filter((r) => r.alive).length;
  it('쉬움: novice 10년 생존 95% 이상·20년 90% 이상, clumsy 10년 70% 이상, idle은 15년 안에 파산', () => {
    const n10 = run(() => novice(), 'easy', 10), n20 = run(() => novice(), 'easy', 20), c10 = run(() => clumsy(), 'easy', 10), id = run(() => idle, 'easy', 15);
    console.log(`쉬움: novice 10년 ${alive(n10)}/20, 20년 ${alive(n20)}/20, clumsy 10년 ${alive(c10)}/20, idle 파산 달 중앙값 ${median(id.map((r) => r.month))}`);
    expect(alive(n10)).toBeGreaterThanOrEqual(19); expect(alive(n20)).toBeGreaterThanOrEqual(18);
    expect(alive(c10)).toBeGreaterThanOrEqual(14);
    for (const r of id) { expect(r.alive).toBe(false); expect(r.month).toBeLessThan(15 * 12); }
  });
  it('어려움: steady 10년 생존 50% 이상(0.5.1). novice 10년 현금 중앙값 쉬움 > 보통 > 어려움', () => {
    const st = run(() => steady(), 'hard', 10), cash = (['easy', 'normal', 'hard'] as const).map((d) => median(run(() => novice(), d, 10).map((r) => r.cash)));
    console.log(`어려움 steady 10년 ${alive(st)}/20, novice 10년 현금 중앙값 쉬움 ${Math.round(cash[0] / 1e4)}억 / 보통 ${Math.round(cash[1] / 1e4)}억 / 어려움 ${Math.round(cash[2] / 1e4)}억`);
    expect(alive(st)).toBeGreaterThanOrEqual(10); expect(alive(st)).toBeLessThanOrEqual(20); // 0.5.1: 이익률을 올려 어려움도 10년 생존 19/20(상한 17 → 20)
    expect(cash[0]).toBeGreaterThan(cash[1]); expect(cash[1]).toBeGreaterThan(cash[2]);
  });
});
