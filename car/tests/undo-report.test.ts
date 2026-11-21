// 0.8.0 되돌리기(같은 주 직전 조작 하나)와 연 보고서 집계
import { describe, it, expect } from 'vitest';
import { Game, allGens } from '../src/sim/game';
import { undoInfo, yearReport, reportYears } from '../src/sim/queries';
import { config } from '../src/config';
import { TECHS } from '../src/data';
import { researchError } from '../src/sim/research';
import type { Command } from '../src/sim/types';
import { launched, ok } from './util';

const snap = (g: Game) => JSON.stringify(g.toJSON());
/** 명령 → 되돌리기 뒤 상태가 명령 전과 같고, 이후 n주 진행 결과도 명령을 안 한 판과 같다 */
function undoSame(make: () => Game, cmd: (g: Game) => Command, prep: (g: Game) => void = () => {}, weeks = 12): string {
  const a = make(), b = make(); prep(a); prep(b);
  const before = snap(a);
  ok(a.command(cmd(a)));
  const label = undoInfo(a.state).label;
  expect(undoInfo(a.state).available).toBe(true);
  ok(a.undoLast());
  expect(snap(a)).toBe(before);
  expect(undoInfo(a.state).available).toBe(false);
  for (let i = 0; i < weeks; i++) { a.tick(); b.tick(); }
  expect(snap(a)).toBe(snap(b));
  return label;
}

describe('되돌리기(0.8.0)', () => {
  const sold = () => { const { g } = launched(3); for (let i = 0; i < 8; i++) g.tick(); return g; };
  it('해고·교육(난수)·휴식·대출·가격·광고·단종·증설·승급·연구·임원 임명: 상태와 이후 진행이 명령 전과 같다', () => {
    expect(undoSame(sold, (g) => ({ type: 'fire', staffId: g.state.staff[0].id }))).toBe(`해고: ${sold().state.staff[0].name}`);
    undoSame(sold, (g) => ({ type: 'train', staffId: g.state.staff[0].id }), (g) => { g.state.cash += 1e6; g.state.staff[0].ability = g.state.staff[0].potential - 5; });
    undoSame(sold, (g) => ({ type: 'rest', staffId: g.state.staff[1].id, weeks: 2 }));
    expect(undoSame(sold, () => ({ type: 'borrow', amount: 10000 }))).toBe('대출: 1억원');
    undoSame(sold, (g) => ({ type: 'setPrice', generationId: allGens(g.state)[0].id, price: 1300 }));
    undoSame(sold, (g) => ({ type: 'setMarketing', generationId: allGens(g.state)[0].id, marketing: 3 }));
    undoSame(sold, (g) => ({ type: 'discontinue', generationId: allGens(g.state)[0].id }));
    undoSame(sold, () => ({ type: 'expandFactory' }), (g) => { g.state.cash += 1e7; });
    undoSame(sold, () => ({ type: 'upgradeHQ' }), (g) => { g.state.cash += 1e7; g.state.reputation = 90; });
    undoSame(sold, (g) => ({ type: 'appointExec', role: 'hr', staffId: g.state.staff[0].id }));
    undoSame(sold, (g) => ({ type: 'startResearch', techId: TECHS.find((t) => researchError(g.state, t.id) === null)!.id }), (g) => { g.state.cash += 1e7; });
  });
  it('공고 → 채용·돌려보내기를 되돌리면 후보가 돌아온다', () => {
    const make = () => { const g = Game.create({ seed: 5, difficulty: 'normal' }); ok(g.command({ type: 'postJob', role: 'designer', tier: 1 })); return g; };
    expect(undoSame(make, (g) => ({ type: 'hire', candidateId: g.state.candidates[0].id }))).toMatch(/^채용: /);
    undoSame(make, () => ({ type: 'dismissCandidates' }));
  });
  it('한 주가 지나거나 제외 명령(개발 시작·출시·사건·개발자 메뉴)·다른 명령을 하면 되돌릴 수 없다', () => {
    const g = sold();
    ok(g.command({ type: 'rest', staffId: g.state.staff[0].id, weeks: 2 }));
    g.tick();
    expect(undoInfo(g.state).available).toBe(false);
    expect(g.undoLast().ok).toBe(false);
    ok(g.command({ type: 'rest', staffId: g.state.staff[1].id, weeks: 2 }));
    ok(g.devCheat('restStaff'));
    expect(g.undoLast().ok).toBe(false);
    ok(g.command({ type: 'borrow', amount: 10000 }));
    ok(g.command({ type: 'assign', staffId: g.state.staff[2].id, projectId: null }));
    expect(undoInfo(g.state).available).toBe(false);
  });
  it('일괄 교육(chain)은 한 번에 되돌린다: "교육: ○○ 외 1명"', () => {
    const g = sold(), before = snap(g); g.state.cash += 1e6;
    const xs = g.state.staff.slice(0, 2); for (const x of xs) { x.trainings = []; x.ability = Math.min(x.ability, x.potential - 3); }
    const before2 = snap(g);
    ok(g.command({ type: 'train', staffId: xs[0].id })); ok(g.command({ type: 'train', staffId: xs[1].id }, true));
    expect(undoInfo(g.state).label).toBe(`교육: ${xs[0].name} 외 1명`);
    ok(g.undoLast());
    expect(snap(g)).toBe(before2); expect(before2).not.toBe(before);
  });
  it('저장 파일에는 되돌리기가 없다(불러오면 되돌릴 수 없음)', () => {
    const g = sold(); ok(g.command({ type: 'borrow', amount: 10000 }));
    const h = Game.fromJSON(g.toJSON());
    expect(undoInfo(h.state).available).toBe(false);
    expect(JSON.stringify(g.toJSON())).not.toContain('snap');
  });
});

describe('연 보고서(0.8.0)', () => {
  it('합계가 그해 월 장부 합과 같고, 차종별 판매 합 = 장부 판매, 평판 이유 합 = 평판 변화', () => {
    const { g } = launched(3);
    const W = config.time.weeksPerMonth * config.time.monthsPerYear, y = config.time.startYear + 1;
    while (g.state.week < W * 2) g.tick();
    expect(reportYears(g.state)).toEqual([y, y - 1]);
    const r = yearReport(g.state, y), rows = g.state.ledger.filter((e) => e.year === y);
    expect(rows.length).toBe(12);
    const sum = (k: 'revenue' | 'profit' | 'sold') => rows.reduce((a, e) => a + e[k], 0);
    expect(r.money!.revenue).toBeCloseTo(sum('revenue'), 6);
    expect(r.money!.profit).toBeCloseTo(sum('profit'), 6);
    expect(r.money!.sold).toBe(sum('sold'));
    expect(r.money!.cash).toBe(rows[11].cash);
    expect(r.prev!.cash).toBe(g.state.ledger.filter((e) => e.year === y - 1)[11].cash);
    expect(r.cars.reduce((a, c) => a + c.sold, 0)).toBe(sum('sold'));
    expect(r.best?.sold).toBe(Math.max(...r.cars.map((c) => c.sold)));
    const y0 = yearReport(g.state, y - 1);
    expect(y0.launches.length).toBe(1);
    expect(y0.repChange).toBeCloseTo(y0.repReasons.reduce((a, x) => a + x.delta, 0), 1);
    expect(y0.repReasons.length).toBeGreaterThan(0);
  });
  it('예전 저장(기록 없음)도 장부로 보인다', () => {
    const { g } = launched(3);
    while (g.state.week < 48) g.tick();
    const d = g.toJSON(); delete d.years;
    const r = yearReport(Game.fromJSON(d).state, config.time.startYear);
    expect(r.money!.sold).toBe(d.ledger.reduce((a, e) => a + e.sold, 0));
    expect(r.cars[0].profit).toBeNull();
  });
});
