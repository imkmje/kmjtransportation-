// 5.6.0 모터스포츠(설계서 9.11): 참가 조건, 예산 차감·파산 방지, 전력과 순위, 벌칙 없음, 보상 적용·만료, 전담팀 배치 중 개발 불가, 위임의 현금 비율, 우승 기념 한정판 결정·자동 승인, 결정론, 저장 형식 13 → 14
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { config } from '../src/config';
import { Game, SAVE_VERSION, sellingGens } from '../src/sim/game';
import { AUTO_KINDS } from '../src/sim/autodecide';
import { steadyExec } from '../src/sim/bots';
import { carChoices, forecast, motorEliteBusy, motorInfo, motorSalesMult, rewardShare, seriesError } from '../src/sim/motor';
import { todoItems } from '../src/sim/todo';
import { monthOf } from '../src/sim/time';
import type { CarState } from '../src/sim/types';
import { SPEC, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 120_000 });
const M = config.motorsport;
const FIX = 'car/tests/fixtures/save-v13.json'; // 5.5.1 코드로 만든 2004년 12월 판(형식 12 픽스처를 6개월 이어 돌림): 본사 5등급, 세 권역 진출, 현금 약 2.1조
const raw = () => JSON.parse(readFileSync(FIX, 'utf8')) as CarState;
/** 픽스처를 1월 첫 주(올해 계획을 정할 수 있는 때)까지 */
const jan = (): Game => { const g = Game.fromJSON(raw()); toMonthEnd(g); expect(monthOf(g.state.week) % 12).toBe(0); return g; };
const months = (g: Game, n: number) => { for (let i = 0; i < n; i++) toMonthEnd(g); };
const touring = (g: Game, step = 3) => ok(g.command({ type: 'setMotor', series: 'touring', step }));
const entry = (g: Game, id = 'touring') => g.state.motor!.season!.entries.find((e) => e.series === id)!;
/** 경쟁 팀 전력을 낮춰(또는 높여) 결과를 정한다 */
const fixField = (g: Game, id: string, power: number) => { for (const t of entry(g, id).field) if (t.id !== 'me') t.power = power; };

describe('5.6.0 참가 조건', () => {
  it('투어링은 본사 3등급, 세계 랠리·내구는 5등급 + 해외 진출, 포뮬러는 6등급', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), s = g.state;
    const r = g.command({ type: 'setMotor', series: 'touring', step: 0 });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain('본사 3등급');
    s.hqLevel = 3; expect(seriesError(s, 'touring')).toBeNull(); expect(seriesError(s, 'rally')).toContain('5등급');
    s.hqLevel = 5; expect(seriesError(s, 'rally')).toContain('해외 권역');
    const f = jan(); expect(seriesError(f.state, 'rally')).toBeNull(); expect(seriesError(f.state, 'formula')).toContain('6등급');
    f.state.hqLevel = 6; expect(seriesError(f.state, 'formula')).toBeNull();
    expect(f.command({ type: 'setMotor', series: 'touring', step: 4 }).ok).toBe(false);
    expect(f.command({ type: 'setMotor', series: 'nope', step: 0 }).ok).toBe(false);
  });
  it('출전 차는 그 급의 차급(판매 중)만, 포뮬러는 차 선택이 없다', () => {
    const g = jan(), s = g.state, c = carChoices(s, 'touring');
    expect(c.length).toBeGreaterThan(0); expect(c.every((x) => M.series[0].bodies.includes(x.body))).toBe(true);
    const suv = sellingGens(s).find((x) => x.body === 'suv')!, np = s.nameplates.find((n) => n.generations.includes(suv))!;
    expect(g.command({ type: 'setMotor', series: 'touring', step: 1, car: np.id }).ok).toBe(false);
    ok(g.command({ type: 'setMotor', series: 'rally', step: 1, car: np.id }));
    expect(carChoices(s, 'formula')).toEqual([]);
  });
});

describe('5.6.0 시즌·예산', () => {
  it('2월 결산에 확정, 3~12월 월 결산마다 경기 한 번과 연 예산 ÷ 10, 장부의 motor 칸, 연중 변경은 다음 시즌', () => {
    const g = jan(), s = g.state; touring(g, 2);
    expect(motorInfo(s, false).planYear).toBe(2005);
    months(g, 2); // 1·2월 결산
    expect(s.motor!.season!.year).toBe(2005); expect(entry(g).races).toBe(0);
    expect(s.ledger.at(-1)!.motor ?? 0).toBe(0);
    ok(g.command({ type: 'setMotor', series: 'touring', step: 0 })); // 확정 뒤 바꾸면 내년부터
    expect(motorInfo(s, false).planYear).toBe(2006); expect(entry(g).step).toBe(2);
    const cash0 = s.cash; months(g, 1);
    const due = M.series[0].budget[2] / M.races;
    expect(entry(g).races).toBe(1); expect(s.ledger.at(-1)!.motor).toBeCloseTo(due, 6); expect(entry(g).paid).toBeCloseTo(due, 6);
    expect(s.cash).toBeCloseTo(cash0 + s.ledger.at(-1)!.profit, 3); // 장부 이익에서 빠졌다
    months(g, 9);
    expect(s.motor!.history.at(-1)).toMatchObject({ year: 2005, series: 'touring' }); expect(s.motor!.spent).toBeCloseTo(M.series[0].budget[2], 3);
    months(g, 2); expect(s.motor!.season!.entries[0].step).toBe(0); // 2006 시즌은 바꾼 계획
  });
  it('현금이 모자라면 남은 현금까지만 내고(예산 때문에 파산하지 않는다) 낸 비율만큼 전력이 준다', () => {
    const g = jan(), s = g.state; touring(g, 3); months(g, 2);
    s.cash = -1e10; months(g, 1); // 결산 뒤에도 현금이 음수: 이번 달 예산은 0원
    const e = entry(g), me = e.field.find((t) => t.id === 'me')!;
    expect(s.ledger.at(-1)!.motor).toBe(0); expect(e.paid).toBe(0); expect(e.races).toBe(1);
    expect(me.power).toBeCloseTo(e.parts.research + e.parts.car + e.parts.elite + e.parts.exp, 6);
    expect(s.events.news.some((n) => n.text.includes('현금이 모자라'))).toBe(true);
  });
  it('경고: 직접 정한 연 예산 합이 현금의 25%를 넘으면 경고 문구', () => {
    const g = jan(), s = g.state; touring(g, 3); expect(motorInfo(s, false).warn).toBeNull();
    s.cash = M.series[0].budget[3] / M.warnShare - 1; expect(motorInfo(s, false).warn).toContain('25%');
  });
});

describe('5.6.0 전력과 순위', () => {
  it('예산 단계가 높으면 전력과 예상 순위가 낫고, 시즌 결과도 전력 순서를 대체로 따른다', () => {
    const g = jan(), s = g.state;
    const lo = forecast(s, 'touring', { step: 0 }), hi = forecast(s, 'touring', { step: 3 });
    expect(hi.power - lo.power).toBeCloseTo(M.stepPts[3] - M.stepPts[0], 9);
    expect(hi.best).toBeLessThan(lo.best); expect(hi.worst).toBeLessThanOrEqual(lo.worst); expect(hi.win).toBeGreaterThanOrEqual(lo.win);
    touring(g, 3); s.motor!.exp.touring = 30; expect(forecast(s, 'touring', { step: 3 }).win).toBeGreaterThan(0.5); // 경험(가정)이 크면 대개 우승
    delete s.motor!.exp.touring;
    let strong = 0, weak = 0; // 같은 판에서 전력만 다르게 10시즌: 강한 쪽 평균 순위가 낫다
    for (const [k, p] of [[0, 20], [1, 95]] as const) for (let y = 0; y < 3; y++) {
      const h = jan(); touring(h, 3); months(h, 2); const e = entry(h); e.field.find((t) => t.id === 'me')!.power = p; e.parts = { budget: 0, research: 0, car: 0, elite: 0, exp: p }; e.due = 0;
      for (const t of e.field) if (t.id !== 'me') t.power += y; months(h, 10);
      const r = h.state.motor!.history.at(-1)!.rank; if (k === 0) weak += r; else strong += r;
    }
    expect(strong).toBeLessThan(weak); expect(strong).toBe(3); // 전력 95는 매번 우승
  });
  it('보상 배수: 우승 1, 순위가 낮을수록 작고 꼴찌는 0(벌칙 없음)', () => {
    expect(rewardShare(1, 6)).toBe(1); expect(rewardShare(2, 6)).toBeCloseTo(0.6); expect(rewardShare(6, 6)).toBe(0);
    for (let r = 2; r < 6; r++) expect(rewardShare(r, 6)).toBeGreaterThan(rewardShare(r + 1, 6));
  });
});

describe('5.6.0 보상과 벌칙 없음', () => {
  it('꼴찌여도 평판이 깎이지 않고 보상이 없다(잃는 것은 예산뿐)', () => {
    const g = jan(), s = g.state; touring(g, 0); months(g, 2); fixField(g, 'touring', 999);
    const rep0 = s.reputation; months(g, 10);
    expect(s.motor!.history.at(-1)!.rank).toBe(entry(g).field.length);
    expect(Object.entries(s.years![2005].rep).filter(([k]) => k.includes('모터스포츠')).every(([, v]) => v >= 0)).toBe(true);
    expect(s.motor!.boosts.filter((b) => b.series === 'touring')).toEqual([]);
    expect(s.reputation).toBeGreaterThan(rep0 - 50); // 다른 이유의 변화만
  });
  it('우승: 평판·차급 판매 가산(스포츠카·쿠페·출전 차 차급)·연구 속도, 기간이 지나면 사라진다. 세계 급은 권역 인지도', () => {
    const g = jan(), s = g.state; touring(g, 3); ok(g.command({ type: 'setMotor', series: 'rally', step: 0 })); months(g, 2);
    fixField(g, 'touring', -999); fixField(g, 'rally', -999); const car = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === entry(g).car)!;
    months(g, 10); const m = monthOf(s.week);
    const H = s.motor!.history.filter((h) => h.year === 2005); expect(H.map((h) => h.rank)).toEqual([1, 1]);
    expect(Object.keys(s.years![2005].rep).some((k) => k.includes('국내 투어링 1위'))).toBe(true);
    const sales = s.motor!.boosts.find((b) => b.kind === 'sales' && b.series === 'touring')!;
    expect(sales.bodies).toEqual(expect.arrayContaining(['sports', 'coupe', car.body])); expect(sales.value).toBeCloseTo(M.series[0].sales);
    expect(motorSalesMult(s, { body: car.body }, m)).toBeGreaterThan(1); expect(motorSalesMult(s, { body: 'kei' }, m)).toBe(1);
    expect(motorSalesMult(s, { body: 'kei', variant: 'gt' }, m)).toBeGreaterThan(1);
    expect(s.motor!.boosts.some((b) => b.kind === 'research')).toBe(true); expect(s.motor!.boosts.some((b) => b.kind === 'aw' && b.series === 'rally')).toBe(true);
    expect(s.motor!.boosts.some((b) => b.kind === 'brand')).toBe(false); // 포뮬러만
    ok(g.command({ type: 'setMotor', series: 'touring', step: null })); ok(g.command({ type: 'setMotor', series: 'rally', step: null }));
    months(g, M.series[0].salesMonths + 1);
    expect(s.motor!.boosts).toEqual([]); expect(motorSalesMult(s, { body: car.body }, monthOf(s.week))).toBe(1);
  });
  it('쉬면 경험이 준다, 나가면 쌓인다(최대)', () => {
    const g = jan(), s = g.state; touring(g, 0); months(g, 12); expect(s.motor!.exp.touring).toBe(M.exp.step);
    ok(g.command({ type: 'setMotor', series: 'touring', step: null })); months(g, 12); expect(s.motor!.exp.touring).toBeUndefined();
  });
});

describe('5.6.0 직속 전담팀 배치', () => {
  it('배치한 시즌 동안 전담팀은 차를 개발하지 못하고, 시즌이 끝나면 다시 할 수 있다. 전력 가산', () => {
    const g = jan(), s = g.state;
    const xs = s.staff.filter((x) => x.role !== 'sales' && !x.lab).slice(0, 3); for (const x of xs) { x.projectId = null; x.elite = true; } // 픽스처 직원은 개발 중이라 빼서 전담팀으로
    const base = forecast(s, 'touring', { step: 3 }).power;
    ok(g.command({ type: 'setMotor', series: 'touring', step: 3, elite: true }));
    expect(forecast(s, 'touring', { step: 3, elite: true }).power - base).toBeCloseTo(M.elite.pts * Math.min(1, xs.length / M.elite.full));
    ok(g.command({ type: 'setMotor', series: 'rally', step: 0, elite: true })); expect(s.motor!.plan.touring.elite).toBeUndefined(); // 한 급에만
    ok(g.command({ type: 'setMotor', series: 'touring', step: 3, elite: true }));
    months(g, 2); expect(entry(g).elite).toBe(true); expect(motorEliteBusy(s)).toBe(true);
    const r = g.command({ type: 'startProject', ...SPEC, name: '전담 테스트', team: xs.map((x) => x.id) });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain('모터스포츠');
    months(g, 10); expect(motorEliteBusy(s)).toBe(false);
  });
});

describe('5.6.0 위임', () => {
  it('시장 조사 임원 위임: 연 예산 합이 현금의 10%를 넘지 않고, 오늘 탭 계획 할 일이 없다', () => {
    const g = jan(), s = g.state, x = [...s.staff].filter((y) => y.projectId === null).sort((a, b) => b.ability - a.ability)[0]; x.ability = Math.max(x.ability, 80);
    ok(g.command({ type: 'appointExec', role: 'market', staffId: x.id })); ok(g.command({ type: 'setDelegation', role: 'market', key: 'autoMotor', on: true }));
    s.hqLevel = 6; s.cash = 3e7; // 3,000억: 10% = 300억이라 포뮬러·랠리는 못 나가고 투어링만
    expect(todoItems(s).some((t) => t.kind === 'motor')).toBe(false);
    months(g, 2);
    const total = s.motor!.season!.entries.reduce((a, e) => a + e.budget, 0);
    expect(total).toBeLessThanOrEqual(3e7 * M.autoShare + 1e-6); expect(s.motor!.season!.entries.map((e) => e.series)).toEqual(['touring']);
    expect(s.execs!.reports.some((r) => r.kind === 'autoMotor')).toBe(true);
  });
  it('직접 정할 때는 1~2월에 오늘 탭 정할 일, 확정하면 사라진다. 시즌 결과는 확인하면 사라진다', () => {
    const g = jan(), s = g.state;
    expect(todoItems(s).filter((t) => t.kind === 'motor').length).toBe(1);
    ok(g.command({ type: 'confirmMotor' })); expect(todoItems(s).some((t) => t.kind === 'motor')).toBe(false);
    touring(g, 0); months(g, 3); expect(todoItems(s).some((t) => t.kind === 'motorRace')).toBe(true);
    months(g, 9); expect(todoItems(s).some((t) => t.kind === 'motorResult')).toBe(true);
    ok(g.command({ type: 'ackMotor' })); expect(todoItems(s).some((t) => t.kind === 'motorResult')).toBe(false);
  });
});

describe('5.6.0 우승 기념 한정판', () => {
  const winTouring = (g: Game) => { touring(g, 3); months(g, 2); fixField(g, 'touring', -999); months(g, 10); };
  it('자동 승인 종류에 등록(규칙대로), 우승하면 결정이 뜨고 낸다를 고르면 비용·판매·평판', () => {
    const k = AUTO_KINDS.find((x) => x.id === 'motorLimited')!; expect(k.rule).toBe('exec'); expect(k.defaultChoice).toBe(1);
    const g = jan(), s = g.state; winTouring(g);
    const pc = s.events.pending.find((p) => p.eventId === 'motorLimited')!; expect(pc.ms!.units).toBe(M.series[0].units);
    expect(pc.ms!.price).toBeGreaterThan(pc.ms!.unit);
    const cash0 = s.cash, rep0 = s.reputation;
    ok(g.command({ type: 'resolveEvent', eventId: pc.id, choice: 0 }));
    expect(s.cash).toBeCloseTo(cash0 - pc.ms!.cost, 3); expect(s.reputation).toBeCloseTo(rep0 + pc.ms!.rep, 6);
    months(g, M.limited.months);
    const rev = s.ledger.slice(-M.limited.months).reduce((a, e) => a + (e.motorRev ?? 0), 0);
    expect(rev).toBeCloseTo(pc.ms!.units * pc.ms!.price, 3); expect(s.motor!.limited[0].left).toBe(0);
  });
  it('자동 승인을 켜면 결정 창 없이 처리한다(안전선 적용: 현금의 10% 이상이면 묻는다)', () => {
    const g = jan(), s = g.state; ok(g.command({ type: 'setAutoDecide', kind: 'motorLimited', on: true })); winTouring(g);
    expect(s.events.pending.some((p) => p.eventId === 'motorLimited')).toBe(false); expect(s.motor!.limited.length).toBe(1);
    const h = jan(); ok(h.command({ type: 'setAutoDecide', kind: 'motorLimited', on: true })); touring(h, 3); months(h, 2); fixField(h, 'touring', -999); months(h, 9);
    h.state.cash = 1e5; months(h, 1); // 10억: 한정판 비용이 현금의 10%를 넘는다
    expect(h.state.events.pending.some((p) => p.eventId === 'motorLimited')).toBe(true);
  });
  it('답하지 않으면 기본 선택(내지 않는다)', () => {
    const g = jan(), s = g.state; winTouring(g); const n0 = s.events.news.length; void n0;
    for (let i = 0; i < 6; i++) g.tick();
    expect(s.events.pending.some((p) => p.eventId === 'motorLimited')).toBe(false); expect(s.motor!.limited).toEqual([]);
  });
});

describe('5.6.0 결정론·저장', () => {
  it('같은 시드·같은 명령이면 같은 결과, 중간에 저장·불러오기해도 같다', () => {
    const run = (split: boolean) => { let g = jan(); touring(g, 3); ok(g.command({ type: 'setMotor', series: 'rally', step: 1 })); months(g, 6); if (split) g = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON()))); months(g, 10); return JSON.stringify(g.toJSON()); };
    const a = run(false); expect(run(false)).toBe(a); expect(run(true)).toBe(a);
  });
  it('형식 13 픽스처(5.5.1로 만든 판)가 14로 올라오고 모터스포츠는 없으며, 이어서 돌려도 쓰지 않으면 생기지 않는다', () => {
    const r = raw(); expect(r.saveVersion).toBe(13); expect(SAVE_VERSION).toBe(14);
    const g = Game.fromJSON(r); expect(g.state.saveVersion).toBe(14); expect(g.state.motor).toBeUndefined();
    months(g, 14); expect(g.state.motor).toBeUndefined(); expect(g.state.ledger.every((e) => e.motor === undefined)).toBe(true);
    const back = Game.fromJSON(g.toJSON()); expect(JSON.stringify(back.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
});

describe('5.6.0 봇', () => {
  it('모든 급에 전력으로 나가는 수출 봇이 40년 동안 파산하지 않고, 세 급 모두 시즌을 치르며 예산을 쓴다', () => {
    const g = Game.create({ seed: 2, difficulty: 'normal' }), bot = steadyExec({ best: true, world: true, world2: true, motor: 'all' });
    for (let w = 0; w < 40 * 48 && g.state.status === 'playing'; w++) { bot.step(g); g.tick(); }
    const s = g.state, H = s.motor!.history;
    expect(s.status).toBe('playing'); expect(s.cash).toBeGreaterThan(0);
    for (const x of M.series) expect(H.filter((h) => h.series === x.id).length).toBeGreaterThan(0);
    expect(s.motor!.spent).toBeGreaterThan(0); expect(s.ledger.every((e) => (e.motor ?? 0) >= 0)).toBe(true);
  }, 300_000);
});
