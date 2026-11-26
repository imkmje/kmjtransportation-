// 1.5.0 새 게임 선택지: 시작 연도(기술·경쟁사·자금·본사/공장), 시작 조건, 도전 과제(명령 거절), 저장 형식 8, 통계 집계
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../src/config';
import { TECHS, bodyById } from '../src/data';
import { Game, allGens, SAVE_VERSION } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { regulationBlock, regulationError } from '../src/sim/events';
import { challengeError, challengeInfo, eraStartOf } from '../src/sim/start';
import { statsData } from '../src/sim/report';
import { monthOf, yearOf } from '../src/sim/time';
import type { CarState, Nameplate } from '../src/sim/types';
import { SPEC, ok } from './util';

const why = (r: { ok: boolean; reason?: string }) => r.reason ?? '';

vi.setConfig({ testTimeout: 300_000 });
const NG = config.newGame, WPY = 48;

/** 새 차 하나를 기획해 결함을 다 잡을 때까지(또는 시험 40주) 개발 */
function develop(g: Game, spec = {}): number {
  ok(g.command({ type: 'startProject', ...SPEC, ...spec }));
  const p = g.state.projects.at(-1)!;
  while (!p.waiting && (p.phase === 'design' || p.testWeeks < 40)) g.tick();
  return p.id;
}

describe('시작 연도', () => {
  it.each(NG.years)('%i년 시작: 그 해 1월, 기술(시작 − 여유 햇수까지)·자금·본사·공장·직원, 과거 뉴스 없음, 경쟁사는 그 시대 모델', (y) => {
    const g = Game.create({ seed: 3, difficulty: 'normal', startYear: y }), s = g.state, Y = eraStartOf(y);
    expect(yearOf(s.week)).toBe(y); expect(s.week % WPY).toBe(0);
    expect(s.cash).toBe(Math.round(config.difficulty.normal.cash * Y.cash));
    expect(s.hqLevel).toBe(Y.hq); expect(s.factory.level).toBe(Y.factory);
    expect(s.staff.length).toBe(config.start.roles.length + Y.roles.length);
    for (const x of s.staff) { expect(x.ability).toBeGreaterThanOrEqual(config.start.abilityMin + Y.ability); expect(x.hist!.join).toBe(s.week); }
    const want = TECHS.filter((t) => !t.repeatable && t.year <= y - NG.techSlackYears).map((t) => t.id);
    for (const id of want) expect(s.research.done).toContain(id);
    for (const id of s.research.done) for (const q of TECHS.find((t) => t.id === id)!.pre) expect(s.research.done).toContain(q); // 선행 기술도
    expect(regulationBlock(s)).toBeNull();
    expect(regulationError(s, { powertrain: 'gasoline' })).toBeNull();
    expect(s.events.news).toEqual([]);
    for (let i = 0; i < 8; i++) g.tick();
    expect(s.events.news.filter((n) => n.category === 'start').length).toBeLessThanOrEqual(2); // 지난 사건이 한꺼번에 뜨지 않는다
    const m = monthOf(s.week);
    for (const r of s.rivals) for (const md of Object.values(r.models)) if (y > 1970) expect(m - md.start).toBeLessThan(config.rivals.cycleMax + 2);
    expect(y === 1970 ? s.start : s.start?.year).toBe(y === 1970 ? undefined : y); // 기본 선택이면 start를 두지 않는다(옛 판과 같은 상태)
  });
  it.each(NG.years)('%i년 시작 직후 차 개발·출시가 규제에 막히지 않는다', (y) => {
    const g = Game.create({ seed: 5, difficulty: 'normal', startYear: y });
    const pid = develop(g);
    ok(g.command({ type: 'launch', projectId: pid, price: bodyById(SPEC.body).basePrice, marketing: 1, color: 'red', wheels: 0 }));
    expect(allGens(g.state)).toHaveLength(1);
  });
  it('2015년 시작은 전기차를 바로 기획할 수 있다', () => {
    const g = Game.create({ seed: 2, difficulty: 'normal', startYear: 2015 });
    expect(regulationError(g.state, { powertrain: 'ev' })).toBeNull();
    ok(g.command({ type: 'startProject', ...SPEC, powertrain: 'ev', battery: 'std' }));
  });
  it('결정론: 같은 시드·같은 선택이면 같은 상태, 저장 왕복 뒤 이어서도 같다', () => {
    const a = Game.create({ seed: 9, startYear: 2000, condition: 'lean', challenges: ['noLoan'] }), b = Game.create({ seed: 9, startYear: 2000, condition: 'lean', challenges: ['noLoan'] });
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
    const c = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(c.state.start).toEqual({ year: 2000, condition: 'lean', challenges: ['noLoan'] });
    for (let i = 0; i < 60; i++) { a.tick(); c.tick(); }
    expect(JSON.stringify(c.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
  it('잘못된 선택은 거절한다(없는 연도, 전기차만은 2010년 이후 시작만)', () => {
    expect(() => Game.create({ seed: 1, startYear: 1990 })).toThrow();
    expect(() => Game.create({ seed: 1, startYear: 2000, challenges: ['evOnly'] })).toThrow(/2010/);
    expect(() => Game.create({ seed: 1, challenges: ['noLoan', 'noLoan'] })).toThrow();
    expect(Game.create({ seed: 1, startYear: 2015, challenges: ['evOnly'] }).state.start?.challenges).toEqual(['evOnly']);
  });
});

describe('시작 조건', () => {
  it('넉넉한 자금·맨손은 시작 현금 배수만 바꾼다(난이도·시작 연도와 곱)', () => {
    for (const y of [1970, 2000]) {
      const base = Game.create({ seed: 1, difficulty: 'hard', startYear: y }).state.cash;
      expect(Game.create({ seed: 1, difficulty: 'hard', startYear: y, condition: 'rich' }).state.cash).toBe(Math.round(base * NG.conditions.rich.cash));
      expect(Game.create({ seed: 1, difficulty: 'hard', startYear: y, condition: 'lean' }).state.cash).toBe(Math.round(base * NG.conditions.lean.cash));
    }
  });
});

describe('도전 과제', () => {
  it('전기차만: 전기 외 동력으로 개발 시작·풀체인지 거절, 전기는 된다', () => {
    const g = Game.create({ seed: 4, startYear: 2015, challenges: ['evOnly'] });
    const r = g.command({ type: 'startProject', ...SPEC });
    expect(r.ok).toBe(false); expect(why(r)).toMatch(/도전 과제/);
    expect(challengeError(g.state, { type: 'startFullChange', nameplateId: 1, ...SPEC })).toMatch(/전기/);
    ok(g.command({ type: 'startProject', ...SPEC, powertrain: 'ev', battery: 'std' }));
  });
  it('차종 세 개까지: 개발 중인 새 차종까지 세어 네 번째 새 차종을 거절한다', () => {
    const g = Game.create({ seed: 4, challenges: ['names3'] }), s = g.state;
    ok(g.command({ type: 'startProject', ...SPEC }));
    s.nameplates.push({ id: 900, name: 'A', generations: [] } as unknown as Nameplate, { id: 901, name: 'B', generations: [] } as unknown as Nameplate);
    const r = g.command({ type: 'startProject', ...SPEC, name: '넷째' });
    expect(r.ok).toBe(false); expect(why(r)).toMatch(/3개/);
  });
  it('대출 없이: 대출 거절, 현금 경고에 대출 안내 없음. 임원 없이: 임명·공고·채용 거절', () => {
    const g = Game.create({ seed: 4, challenges: ['noLoan', 'noExec'] });
    expect(why(g.command({ type: 'borrow', amount: 1000 }))).toMatch(/대출/);
    expect(why(g.command({ type: 'appointExec', role: 'hr', staffId: 1 }))).toMatch(/임원/);
    expect(why(g.command({ type: 'postExecJob', role: 'hr' }))).toMatch(/임원/);
    expect(why(g.command({ type: 'hireExec', role: 'hr', candidateId: 1 }))).toMatch(/임원/);
    g.state.cash = -1; let txt = '';
    for (let i = 0; i < 4; i++) for (const e of g.tick()) if (e.kind === 'cashWarning') txt = e.text;
    expect(txt).toContain('마이너스'); expect(txt).not.toContain('대출');
    const info = challengeInfo(g.state);
    expect(info.map((x) => x.id)).toEqual(['noLoan', 'noExec']);
    const free = Game.create({ seed: 4 });
    ok(free.command({ type: 'borrow', amount: 1000 }));
  });
});

describe('초반 파산 방지(봇)', () => {
  it('시작 연도 4개 × 보통: 신중 봇이 20년 파산하지 않는다(시드 1~4, 2000·2015년은 맨손도 시드 1~2)', () => {
    const runs = [...NG.years.flatMap((y) => [1, 2, 3, 4].map((seed) => ({ y, seed, condition: 'normal' as const }))), ...[2000, 2015].flatMap((y) => [1, 2].map((seed) => ({ y, seed, condition: 'lean' as const })))];
    for (const { y, seed, condition } of runs) {
      const g = Game.create({ seed, difficulty: 'normal', startYear: y, condition }), b = steady();
      for (let w = 0; w < 20 * WPY && g.state.status === 'playing'; w++) { b.step(g); g.tick(); }
      expect(g.state.status, `${y}년 ${condition} 시드 ${seed}`).toBe('playing');
      expect(allGens(g.state).length, `${y}년 시드 ${seed}`).toBeGreaterThan(3);
    }
  });
});

describe('저장 형식 8', () => {
  it('형식 7 fixture: 8로 올라오고 지난 해의 연말 평판이 채워지며, 이어서 돌린 결과와 저장 왕복이 같다', () => {
    const raw = JSON.parse(readFileSync('car/tests/fixtures/save-v7.json', 'utf8'));
    expect(raw.saveVersion).toBe(7); expect(raw.start).toBeUndefined();
    const a = Game.fromJSON(raw), s = a.state;
    expect(SAVE_VERSION).toBe(12); expect(s.saveVersion).toBe(12); expect(s.start).toBeUndefined();
    const done = Object.keys(s.years!).map(Number).filter((y) => y < yearOf(s.week));
    expect(done.length).toBeGreaterThan(5);
    for (const y of done) expect(s.years![y].repEnd).toBeTypeOf('number');
    const last = done.at(-1)!, d = Object.values(s.years![yearOf(s.week)]?.rep ?? {}).reduce((x, v) => x + v, 0);
    expect(s.years![last].repEnd).toBeCloseTo(s.reputation - d, 6);
    expect(Game.fromJSON(raw).toJSON()).toEqual(a.toJSON());
    const b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    for (let i = 0; i < 96; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
    expect(statsData(a.state, 'all').years.length).toBeGreaterThan(5);
  });
});

describe('통계 집계', () => {
  it('연도별 값은 장부 합계와 같고, 요약·차종별 합은 세대 기록과 같다', () => {
    const g = Game.create({ seed: 6, difficulty: 'normal' }), b = steady();
    for (let w = 0; w < 10 * WPY; w++) { b.step(g); g.tick(); }
    const s: CarState = g.state, st = statsData(s, 'all'), cur = yearOf(s.week);
    expect(st.years.at(-1)!.year).toBe(cur - 1); expect(st.years[0].year).toBe(1970);
    for (const y of [cur - 1, cur - 2]) { // 장부(최근 24개월)에 열두 달이 다 있는 해
      const rows = s.ledger.filter((e) => e.year === y), row = st.years.find((r) => r.year === y)!;
      expect(rows).toHaveLength(12);
      expect(row.sold).toBe(rows.reduce((a, e) => a + e.sold, 0));
      expect(row.revenue).toBeCloseTo(rows.reduce((a, e) => a + e.revenue, 0), 3);
      expect(row.profit).toBeCloseTo(rows.reduce((a, e) => a + e.profit, 0), 3);
      expect(row.cash).toBe(rows.at(-1)!.cash);
      expect(row.staff).toBe(s.years![y].staff); expect(row.rep).toBe(s.years![y].repEnd);
    }
    const all = allGens(s), gensSold = all.reduce((a, x) => a + x.totalSold, 0);
    expect(st.summary.sold).toBe(gensSold);
    const thisYear = all.reduce((a, x) => a + x.sales.reduce((c, v, i) => c + (yearOf((x.launchMonth + i) * 4) === cur ? v : 0), 0), 0);
    expect(st.cars.reduce((a, c) => a + c.sold, 0)).toBe(gensSold - thisYear); // 끝난 해만
    expect(st.mix.reduce((a, d) => a + d.total, 0)).toBe(gensSold - thisYear);
    expect(st.summary.names).toBe(s.nameplates.length);
    const ten = statsData(s, '10y');
    expect(ten.years[0].year).toBe(Math.max(1970, cur - 10));
  });
});
