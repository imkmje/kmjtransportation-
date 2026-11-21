// 0.5.1 플레이 점검 수정: 평판, 연구 배분, 유지비 조회, 리프트 손익, 이름값, 조언, 선택 비용, 생산 라인, 기획 매력
import { describe, it, expect } from 'vitest';
import { Game, allGens, linesUsed } from '../src/sim/game';
import { novice } from '../src/sim/bots';
import { activeEvents, factoryInfo, faceliftPreview, fullChangePreview, hqInfo, pendingChoices, planPreview, researchInfo, advice } from '../src/sim/queries';
import { eraTimeline } from '../src/sim/events';
import { RANDOM_EVENTS } from '../src/data';
import { config } from '../src/config';
import { SPEC, ok, toMonthEnd } from './util';

/** 보통으로 개발(시험 2주 이상, 화면 결함 5개 이하)해 기준가로 출시 */
const launchFirst = (g: Game) => { ok(g.command({ type: 'startProject', ...SPEC })); const p = g.state.projects[0]; while (!(p.phase === 'test' && p.testWeeks >= 2 && (p.defectEst <= 5 || p.waiting))) g.tick(); ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 })); return allGens(g.state).at(-1)!; };

describe('평판(0.5.1)', () => {
  it('쉬움에서 평론 4점대 차만 내도(서툰 플레이 봇) 8년 안에 본사 3등급 평판에 닿는다(시드 10개 중 8개 이상)', () => {
    const need = config.hq.levels[2].rep; let reached = 0; const reviews: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const g = Game.create({ seed, difficulty: 'easy' }), b = novice();
      for (let w = 0; w < 8 * 48 && g.state.reputation < need; w++) { b.step(g); g.tick(); }
      if (g.state.reputation >= need) reached++;
      reviews.push(...allGens(g.state).map((x) => x.reviewAvg));
    }
    console.log(`평판 ${need} 도달 ${reached}/10, 평론 ${[...reviews].sort((a, b) => a - b).map((x) => x.toFixed(1)).join(',')}`);
    expect(reached).toBeGreaterThanOrEqual(8);
  });
  it('평론 5 미만이어도 출시 감점 없음, 평판이 바뀌면 이유가 담긴 이벤트(누적 판매 마일스톤)', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' }), rep = g.state.reputation, gen = launchFirst(g);
    if (gen.reviewAvg > config.critics.flop && gen.reviewAvg <= 5) expect(g.state.reputation).toBe(rep);
    const evs = []; for (let i = 0; i < 48 * 3; i++) evs.push(...g.tick());
    const ms = evs.find((e) => e.kind === 'reputation' && e.reason === '누적 판매 1,000대');
    expect(ms && ms.kind === 'reputation' && ms.delta).toBeCloseTo(config.reputation.milestoneRep[0], 9);
    expect(ms?.text).toBe(`평판 +${config.reputation.milestoneRep[0].toFixed(1)}(누적 판매 1,000대)`);
  });
});

describe('연구 배분(0.5.1)', () => {
  it('규제로 필요한 기술은 예고 뒤 진행 중이면 자동으로 우선(절반), 연구 화면에 시행 주, 사건 화면에 기한', () => {
    const sp = eraTimeline(1).find((x) => x.def.id === 'safety')!;
    const g = Game.create({ seed: 1, difficulty: 'normal' }); g.state.cash = 1e9; g.state.week = (sp.start - 3) * 4;
    ok(g.command({ type: 'startResearch', techId: 'el_radio' })); ok(g.command({ type: 'startResearch', techId: 'bd_abs' }));
    g.tick();
    const info = researchInfo(g.state), abs = info.active.find((a) => a.techId === 'bd_abs')!;
    expect(g.state.research.priority).toBe('bd_abs'); expect(info.active[0].techId).toBe('bd_abs');
    expect(abs.requiredBy).toEqual({ eventName: '안전 규제', week: (sp.start + 36) * 4 });
    const reg = activeEvents(g.state).regulations.find((x) => x.name === '안전 규제')!;
    expect(reg).toMatchObject({ options: ['abs', 'airbag'], enforceWeek: (sp.start + 36) * 4 }); expect(reg.missingTechs).toContain('에어백');
  });
});

describe('유지비·라인 조회(0.5.1)', () => {
  it('유지비 조회 = 실제 청구액(쉬움), 장부에 본사 유지비 따로', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' });
    const hq = hqInfo(g.state), f = factoryInfo(g.state);
    expect(hq.current.upkeep + f.current.upkeep).toBeCloseTo(f.upkeepTotal, 9);
    expect(hq.next!.upkeep).toBeCloseTo(config.hq.levels[1].upkeep * config.difficulty.easy.upkeepMult, 9);
    toMonthEnd(g);
    const L = g.state.ledger.at(-1)!;
    expect(L.upkeep).toBeCloseTo(hq.current.upkeep + f.current.upkeep, 9); expect(L.upkeepHq).toBeCloseTo(hq.current.upkeep, 9);
  });
  it('풀체인지 달에 단종되는 전 세대는 새 세대와 같은 라인(라인 수는 차종 수)', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' }); g.state.cash = 1e9;
    const gen = launchFirst(g);
    while (Math.floor(g.state.week / 4) - gen.launchMonth < 36) g.tick();
    ok(g.command({ type: 'startFullChange', nameplateId: g.state.nameplates[0].id, ...SPEC })); g.devCheat('finishDev');
    ok(g.command({ type: 'launch', projectId: g.state.projects[0].id, price: 1200, marketing: 1, color: 'red', wheels: 0 }));
    expect(allGens(g.state).filter((x) => x.status !== 'discontinued').length).toBe(2);
    expect(linesUsed(g.state)).toBe(1); expect(factoryInfo(g.state).linesUsed).toBe(1);
  });
});

describe('미리보기·조언·선택 비용(0.5.1)', () => {
  it('faceliftPreview 손익: 월 판매·월 이익 전→후, 회수 개월, 너무 이른 리프트, 추천 팀(디자이너·테스터)', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' }); g.state.cash = 1e9;
    const gen = launchFirst(g);
    while (Math.floor(g.state.week / 4) - gen.launchMonth < 20) g.tick();
    const early = faceliftPreview(g.state, gen.id, { options: [] })!;
    expect(early.tooEarly).toBe(true);
    while (Math.floor(g.state.week / 4) - gen.launchMonth < 40) g.tick();
    const pv = faceliftPreview(g.state, gen.id, { options: [] })!;
    expect(pv.tooEarly).toBe(false);
    expect(pv.salesAfter).toBeGreaterThan(pv.salesBefore); expect(pv.profitAfter).toBeGreaterThan(pv.profitBefore);
    expect(pv.paybackMonths).toBe(Math.ceil(pv.cost / (pv.profitAfter - pv.profitBefore)));
    expect(pv.recommendedTeam.map((id) => g.state.staff.find((x) => x.id === id)!.role).sort()).toEqual(['designer', 'tester']);
  });
  it('fullChangePreview: 전작만 못하면 해결책 목록, 아니면 빈 목록. planPreview: 고객층 매력·추천 고객층', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' }); g.state.cash = 1e9;
    const gen = launchFirst(g);
    gen.editions[0].stats = { P: 1e4, E: 1e4, U: 1e4, D: 1e4, Q: 1e4 };
    const w = fullChangePreview(g.state, g.state.nameplates[0].id, SPEC)!;
    expect(w.compare).toBe('worse'); expect(w.hints.length).toBeGreaterThan(0); expect(w.hints[0]).toContain('설계 기간');
    gen.editions[0].stats = { P: 1, E: 1, U: 1, D: 1, Q: 1 };
    expect(fullChangePreview(g.state, g.state.nameplates[0].id, SPEC)!.hints).toEqual([]);
    const fam = planPreview(g.state, { ...SPEC, segment: 'family', direction: { P: 0, E: 2, U: 4, D: 0, Q: 4 } }), wrk = planPreview(g.state, { ...SPEC, segment: 'family' });
    expect(fam.segmentScore).toBeGreaterThan(wrk.segmentScore); // 가족용으로 실용·품질을 올리면 고객층 매력이 오른다
    expect(typeof fam.bestSegment).toBe('string');
  });
  it('조언: 주문이 넘치면 108%까지 올려 볼 만하다, 이미 높으면 증설', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' }); const gen = launchFirst(g);
    gen.sales.push(300); gen.lostSales = 50;
    expect(advice(gen, g.state)).toContain('108%까지는');
    gen.editions[0].price = 1300; expect(advice(gen, g.state)).toBe('주문이 생산량을 넘습니다. 값은 이미 충분히 높으니 공장 증설을 권합니다.');
  });
  it('선택 사건 비용: pendingChoices의 cost·costText가 실제 현금 변화와 같다', () => {
    const g = Game.create({ seed: 1, difficulty: 'easy' }); launchFirst(g);
    for (let i = 0; i < 12; i++) toMonthEnd(g);
    const def = RANDOM_EVENTS.find((d) => d.choices.some((c) => c.effects.some((e) => e.type === 'cash')))!;
    g.state.events.pending.push({ id: 9999, eventId: def.id, text: '', week: g.state.week, deadline: g.state.week + 4, genId: allGens(g.state)[0].id, fx: null });
    const pc = pendingChoices(g.state).find((x) => x.id === 9999)!, i = def.choices.findIndex((c) => c.effects.some((e) => e.type === 'cash'));
    const cash = g.state.cash;
    ok(g.command({ type: 'resolveEvent', eventId: 9999, choice: i }));
    expect(cash - g.state.cash).toBeCloseTo(pc.choices[i].cost, 6);
    expect(pc.choices[i].costText).toMatch(/^(비용|수입) 약 /);
  });
});
