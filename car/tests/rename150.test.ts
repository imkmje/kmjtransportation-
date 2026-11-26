// 1.5.0 출시 뒤 차종 이름 바꾸기(renameNameplate): 계보·판매 집계·이름값·명예의 전당 유지, 검증, 파생 이름 함께, 되돌리기, 저장 왕복, 결정론
import { describe, it, expect, vi } from 'vitest';
import { Game, allGens, SAVE_VERSION } from '../src/sim/game';
import { config } from '../src/config';
import { derivativesOf } from '../src/sim/derive';
import { carBasePrice } from '../src/sim/market';
import { carriedEquity } from '../src/sim/lifecycle';
import { hallOfFame } from '../src/sim/hall';
import type { Generation, Role } from '../src/sim/types';
import { SPEC, grant, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 120_000 });

function big(seed = 1): Game {
  const g = Game.create({ difficulty: 'normal', seed }), s = g.state;
  s.week = (2005 - 1970) * 48; s.cash = 1e9; s.hqLevel = 5; s.factory.level = 5; s.reputation = 60;
  grant(g);
  const roles: Role[] = ['designer', 'engineer', 'tester'];
  for (let i = s.staff.length; i < 15; i++) s.staff.push({ id: s.nextId++, name: `직원${i}`, role: roles[i % 3], ability: 60, potential: 90, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false });
  return g;
}
/** 출시까지(real이면 실제로 개발해 결함을 다 잡거나 시험 20주, 아니면 개발자 메뉴로 바로) */
function quick(g: Game, cmd: Parameters<Game['command']>[0], real = false): Generation {
  ok(g.command(cmd));
  const p = g.state.projects.at(-1)!;
  if (real) while (!(p.waiting || p.testWeeks >= 20)) g.tick(); else ok(g.devCheat('finishDev'));
  ok(g.command({ type: 'launch', projectId: p.id, price: Math.round(carBasePrice(g.state, p) / 10) * 10, marketing: 1, color: 'red', wheels: 0 }));
  return allGens(g.state).at(-1)!;
}
/** 바탕 「아리아」 + 파생 「아리아 왜건」(기본 이름) + 「패밀리」(직접 지은 이름의 고성능판) + 다른 차종 「보라」, 두 달 판매 */
function world(seed = 1) {
  const g = big(seed), s = g.state;
  const base = quick(g, { type: 'startProject', ...SPEC, name: '아리아', body: 'sedanM', segment: 'family' }, true);
  const wagon = quick(g, { type: 'startDerivative', generationId: base.id, variant: 'wagon' });
  const gt = quick(g, { type: 'startDerivative', generationId: base.id, variant: 'gt', name: '패밀리' });
  quick(g, { type: 'startProject', ...SPEC, name: '보라' });
  toMonthEnd(g); toMonthEnd(g);
  const np = (gen: Generation) => s.nameplates.find((n) => n.generations.includes(gen))!;
  return { g, s, base, wagon, gt, np };
}

describe('출시 뒤 이름 바꾸기(1.5.0)', () => {
  it('이름만 바뀌고 차종 ID·계보·판매 집계·이름값·명예의 전당·지난 뉴스는 그대로', () => {
    const { g, s, base, wagon, np } = world();
    const bn = np(base), sold = base.totalSold, sales = [...base.sales], ledger = JSON.stringify(s.ledger), news = JSON.stringify(s.events.news);
    const eq = carriedEquity(s, bn.id, base.body), hof = JSON.stringify(hallOfFame(s)), deriv = derivativesOf(s, bn.id).derivatives.map((x) => x.id);
    expect(sold).toBeGreaterThan(0);
    ok(g.command({ type: 'renameNameplate', nameplateId: bn.id, name: '  아리아 클래식  ' }));
    expect(bn.name).toBe('아리아 클래식');
    expect(np(base)).toBe(bn); expect(bn.generations[0]).toBe(base);
    expect(base.totalSold).toBe(sold); expect(base.sales).toEqual(sales);
    expect(JSON.stringify(s.ledger)).toBe(ledger); expect(JSON.stringify(s.events.news)).toBe(news); expect(news).toContain('아리아');
    expect(carriedEquity(s, bn.id, base.body)).toEqual(eq); // 이름값은 차종 ID 기준이라 불이익 없음
    expect(JSON.stringify(hallOfFame(s))).toBe(hof); // 명예의 전당은 ID를 들고 있다
    expect(derivativesOf(s, bn.id).derivatives.map((x) => x.id)).toEqual(deriv);
    expect(np(wagon).name).toBe('아리아 왜건'); // 선택하지 않으면 파생 이름은 그대로
    toMonthEnd(g);
    expect(base.sales.length).toBe(sales.length + 1); expect(base.totalSold).toBeGreaterThanOrEqual(sold);
    expect(s.ledger.at(-1)!.cars!.some((c) => c.id === base.id)).toBe(true);
  });

  it('파생 이름도 함께: 「바탕이름 + 접미사」 꼴만 바뀌고 직접 지은 이름은 그대로. 파생만 따로 바꿀 수 있다', () => {
    const { g, base, wagon, gt, np } = world();
    ok(g.command({ type: 'renameNameplate', nameplateId: np(base).id, name: '세레나', withDerivatives: true }));
    expect([np(base).name, np(wagon).name, np(gt).name]).toEqual(['세레나', '세레나 왜건', '패밀리']);
    ok(g.command({ type: 'renameNameplate', nameplateId: np(wagon).id, name: '세레나 투어러' }));
    expect([np(base).name, np(wagon).name]).toEqual(['세레나', '세레나 투어러']);
  });

  it('검증: 빈 이름·너무 긴 이름·같은 회사의 다른 차종과 중복·같은 이름·없는 차종은 거절하고 아무것도 바꾸지 않는다', () => {
    const { g, s, base, wagon, np } = world(), id = np(base).id, before = JSON.stringify(s);
    const no = (name: string, extra = {}) => { const r = g.command({ type: 'renameNameplate', nameplateId: id, name, ...extra }); expect(r.ok, name).toBe(false); return r.ok ? '' : r.reason; };
    expect(no('   ')).toContain('이름을 입력');
    expect(no('가'.repeat(config.nameMax + 1))).toContain(`${config.nameMax}자`);
    expect(no('보라')).toContain('이미 있는 차종 이름');
    expect(no('아리아 왜건')).toContain('이미 있는 차종 이름');
    expect(no('아리아')).toContain('같습니다');
    expect(no('가'.repeat(config.nameMax), { withDerivatives: true })).toContain(`${config.nameMax}자`); // 함께 바꿀 「… 왜건」이 넘친다
    expect(g.command({ type: 'renameNameplate', nameplateId: 999, name: '새 이름' }).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    ok(g.command({ type: 'renameNameplate', nameplateId: np(wagon).id, name: '가'.repeat(config.nameMax) })); // 딱 최대 길이는 된다
  });

  it('개발 중인 페이스리프트도 새 이름으로 출시한다', () => {
    const { g, s, base, np } = world();
    for (let i = 0; i < config.lifecycle.facelift.afterMonths; i++) toMonthEnd(g);
    ok(g.command({ type: 'startFacelift', generationId: base.id, options: [] }));
    const p = s.projects.at(-1)!;
    ok(g.command({ type: 'renameNameplate', nameplateId: np(base).id, name: '아리아 뉴' }));
    expect(p.name).toBe('아리아 뉴');
  });

  it('직전 조작 되돌리기로 원래 이름', () => {
    const { g, base, np } = world();
    ok(g.command({ type: 'renameNameplate', nameplateId: np(base).id, name: '세레나', withDerivatives: true }));
    ok(g.undoLast());
    expect(g.state.nameplates.map((n) => n.name)).toEqual(['아리아', '아리아 왜건', '패밀리', '보라']);
  });

  it('저장·불러오기 왕복(저장 형식 8), 결정론(같은 시드·같은 명령이면 같은 결과)', () => {
    expect(SAVE_VERSION).toBe(11);
    const run = () => { const { g, base, np } = world(3); ok(g.command({ type: 'renameNameplate', nameplateId: np(base).id, name: '세레나', withDerivatives: true })); return g; };
    const a = run(), b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    expect(b.state.saveVersion).toBe(11);
    expect(b.state.nameplates.map((n) => n.name)).toEqual(['세레나', '세레나 왜건', '패밀리', '보라']);
    for (let i = 0; i < 24; i++) { a.tick(); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
    expect(JSON.stringify(run().toJSON())).toBe(JSON.stringify(run().toJSON()));
  });
});
