// 4단계: 연구(10장)·차체 10종·동력 4종·옵션(5장)·시대 사건(11장)·조합 노트(5.5)·저장 형식 3 → 4
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, allGens, SAVE_VERSION } from '../src/sim/game';
import { steady } from '../src/sim/bots';
import { unitCost } from '../src/sim/cars';
import { capacityOf, costMultOf } from '../src/sim/company';
import { loanRate } from '../src/sim/finance';
import { chargingInfra, eraNow, eraStart, eraTimeline, marketMult, randomMonths, regulationError } from '../src/sim/events';
import { monthlyDemand, type SaleCar } from '../src/sim/market';
import { requiredOptions, activeEvents, comboMark, comboNotes, eventImpactOn, newsLog, pendingChoices } from '../src/sim/queries';
import { josa } from '../src/sim/josa';
import { levelForTier, powertrainLevels, ptCostAdd, ptLevel, researchCost, researchError, researchInfo, unlockedBodies, unlockedOptions, unlockedPowertrains, weeklyResearchPoints } from '../src/sim/research';
import { monthOf, monthTime } from '../src/sim/time';
import { BODIES, COMPAT, ERA_EVENTS, MARKET, OPTIONS, POWERTRAINS, RANDOM_EVENTS, SEGMENTS, TECHS, techById } from '../src/data';
import { config } from '../src/config';
import type { CarState } from '../src/sim/types';
import { SPEC, grant, launched, ok } from './util';

const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? '' : r.reason);
const WPY = 48;
/** year년 1월 1주로 옮긴 새 게임(현금 넉넉히) */
const gameAt = (year: number, seed = 1) => { const g = Game.create({ difficulty: 'normal', seed }); g.state.week = (year - 1970) * WPY; g.state.cash = 1e9; return g; };
/** 개발 중인 첫 프로젝트를 시험 최소 주까지 */
const toTest = (g: Game) => { const p = g.state.projects[0]; while (p.phase === 'design' || p.testWeeks < config.dev.minTestWeeks) g.tick(); return p; };
const LAUNCH = { price: 1200, marketing: 1, color: 'red', wheels: 0 as const };

describe('자료 무결성(4단계)', () => {
  it('차체 12종(3D 담당이 쓰는 ID, 0.6.0: SUV를 소·중·대로 나누고 세단·SUV를 크기 순으로 묶음), 원가 = 기준가의 82%, 동력 4종, 옵션 12 + 추가', () => {
    expect(BODIES.map((b) => b.id)).toEqual(['sedanS', 'sedanM', 'sedanL', 'hatch', 'coupe', 'minivan', 'kei', 'suvS', 'suv', 'suvL', 'pickup', 'sports']);
    for (const b of BODIES) { expect(b.cost).toBe(Math.round(b.basePrice * 0.82)); expect(b.mult.Q).toBe(1); }
    expect(POWERTRAINS.map((p) => [p.id, p.year])).toEqual([['gasoline', 1970], ['diesel', 1982], ['hybrid', 1998], ['ev', 2010]]);
    for (const p of POWERTRAINS) expect(p.tiers.length).toBe(3);
    const need = ['radio', 'aircon', 'powerSteering', 'autoTrans', 'abs', 'airbag', 'navigation', 'rearCamera', 'smartKey', 'adas', 'bigScreen', 'autonomy2'];
    for (const id of need) expect(OPTIONS.some((o) => o.id === id), id).toBe(true);
    expect(OPTIONS.length).toBeGreaterThanOrEqual(16); expect(OPTIONS.length).toBeLessThanOrEqual(20); // 1.2.0: 2036년 이후 4개
    const byYear = [...OPTIONS].sort((a, b) => a.year - b.year), pts = (o: typeof OPTIONS[0]) => o.U + o.D + o.Q;
    expect(pts(byYear.at(-1)!)).toBeGreaterThan(pts(byYear[0]) * 5); // 뒤 시대 옵션일수록 원점수가 크다
  });
  it('기술 40~52개(0.5.0: 1970년 기초 기술 4개 추가, 0.6.0: 소형·대형 SUV 차체 2개 추가)·분야 5개, 선행이 모두 있고 순환이 없으며 선행은 같거나 이른 해, 해금 대상이 모두 있다. 반복 기술 1~2개(2035)', () => {
    expect(TECHS.length).toBeGreaterThanOrEqual(40); expect(TECHS.length).toBeLessThanOrEqual(64); // 1.2.0: 전기차 3개 + 2036년 이후 9개
    expect(new Set(TECHS.map((t) => t.field))).toEqual(new Set(['powertrain', 'body', 'electronics', 'production', 'eco']));
    expect(new Set(TECHS.map((t) => t.id)).size).toBe(TECHS.length);
    const ids = new Set(TECHS.map((t) => t.id));
    for (const t of TECHS) {
      expect(t.desc.length).toBeGreaterThan(5); expect(t.cost.money).toBeGreaterThan(0); expect(t.cost.points).toBeGreaterThan(0);
      for (const p of t.pre) { expect(ids.has(p), `${t.id} ← ${p}`).toBe(true); expect(techById(p).year).toBeLessThanOrEqual(t.year); }
      for (const e of t.effects) {
        if (e.type === 'body') expect(BODIES.some((b) => b.id === e.id)).toBe(true);
        if (e.type === 'option') expect(OPTIONS.some((o) => o.id === e.id)).toBe(true);
        if (e.type === 'powertrain' || e.type === 'ptLevel') expect(POWERTRAINS.some((p) => p.id === e.id)).toBe(true);
      }
    }
    const seen = new Set<string>(), visiting = new Set<string>(); // 순환 검사(깊이 우선)
    const visit = (id: string) => { if (seen.has(id)) return; expect(visiting.has(id), `순환: ${id}`).toBe(false); visiting.add(id); techById(id).pre.forEach(visit); visiting.delete(id); seen.add(id); };
    TECHS.forEach((t) => visit(t.id));
    const rep = TECHS.filter((t) => t.repeatable);
    expect(rep.length).toBeGreaterThanOrEqual(1); expect(rep.length).toBeLessThanOrEqual(2); for (const t of rep) expect(t.year).toBe(2035);
    // 1970~2035에 고르게: 10년마다 기술이 있다
    for (let y = 1970; y < 2030; y += 10) expect(TECHS.some((t) => t.year >= y && t.year < y + 10), `${y}년대`).toBe(true);
    // 소형 세단·가솔린 말고는 모두 어떤 기술이 연다
    const unlocks = (type: string) => new Set(TECHS.flatMap((t) => t.effects.filter((e) => e.type === type).map((e) => (e as { id: string }).id)));
    expect(BODIES.filter((b) => !unlocks('body').has(b.id)).map((b) => b.id)).toEqual(['sedanS']);
    expect(POWERTRAINS.filter((p) => !unlocks('powertrain').has(p.id)).map((p) => p.id)).toEqual(['gasoline']);
    expect(OPTIONS.filter((o) => !unlocks('option').has(o.id))).toEqual([]);
  });
  it('market: 연대별 칸 비중 합 1, 차체별 고객층 구성비 합 1, 칸 비중·구성비가 12종 모두 있음. compat 72칸(◎○△×)', () => {
    const m = MARKET.domestic;
    expect(m.years).toEqual([1970, 1980, 1990, 2000, 2010, 2020, 2030]);
    m.years.forEach((_, i) => expect(BODIES.reduce((a, b) => a + m.bodyShare[b.id][i], 0)).toBeCloseTo(1, 9));
    for (const b of BODIES) {
      expect(m.bodyShare[b.id].length).toBe(m.years.length);
      expect(SEGMENTS.reduce((a, s) => a + (m.mix[b.id][s.id] ?? NaN), 0)).toBeCloseTo(1, 9);
      for (const s of SEGMENTS) expect([1.2, 1, 0.8, 0.6]).toContain(COMPAT[b.id][s.id]);
    }
    expect(Object.keys(COMPAT).length * SEGMENTS.length).toBe(72);
    expect([COMPAT.minivan.family, COMPAT.sports.enthusiast, COMPAT.sports.rich, COMPAT.kei.youth, COMPAT.kei.worker, COMPAT.pickup.fleet]).toEqual([1.2, 1.2, 1.2, 1.2, 1.2, 1]);
  });
  it('사건: 고정 13개(11.1 연도), 무작위 8종(선택지 2~3개, 기본 선택이 범위 안)', () => {
    expect(ERA_EVENTS.map((e) => e.year)).toEqual([1973, 1979, 1986, 1988, 1992, 1997, 2002, 2008, 2012, 2015, 2020, 2025, 2032, 2037, 2041, 2045, 2049, 2052, 2057]); // 1.2.0 가상 사건 6개
    expect(RANDOM_EVENTS.filter((d) => d.needs !== 'rivalry').length).toBe(8); // 3.5.0 경쟁 2부의 결정 창 2종(가격 전쟁·이직 제안)은 추첨하지 않는다
    for (const d of RANDOM_EVENTS) { expect(d.choices.length).toBeGreaterThanOrEqual(2); expect(d.choices.length).toBeLessThanOrEqual(3); expect(d.defaultChoice).toBeLessThan(d.choices.length); }
  });
});

describe('해금은 연구로만(10장)', () => {
  it('시작: 소형 세단·가솔린만, 옵션 없음. 몇 년이 지나도 그대로', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    const now = (s: CarState) => [unlockedBodies(s).map((b) => b.id), unlockedPowertrains(s).map((p) => p.id), unlockedOptions(s).map((o) => o.id)];
    expect(now(g.state)).toEqual([['sedanS'], ['gasoline'], []]);
    g.state.week = 20 * WPY; // 1990년(안전 규제 시행 전. 시행 뒤에는 ABS·에어백 연구 없이 개발을 시작할 수 없다)
    expect(now(g.state)).toEqual([['sedanS'], ['gasoline'], []]);
    expect(reason(g.command({ type: 'startProject', ...SPEC, powertrain: 'diesel' }))).toBe('아직 쓸 수 없는 동력입니다(연구가 필요합니다).');
    grant(g, 'pw_diesel', 'bd_suv', 'el_radio');
    expect(now(g.state)).toEqual([['sedanS', 'sedanM', 'minivan', 'suv'], ['gasoline', 'diesel'], ['radio', 'awd']]); // 선행(중형·미니밴, 기화기)도 함께
    ok(g.command({ type: 'startProject', ...SPEC, body: 'suv', powertrain: 'diesel', options: ['awd'] }));
  });
});

describe('연구 진행(10장)', () => {
  it('돈은 바로, 쉬는 엔지니어가 매주 능력/10씩 쌓아 완료(이벤트). 개발 중인 엔지니어는 그 30%(0.5.0, 창업 직후에도 연구 점수가 0이 아니다)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 3 }), s = g.state, t = techById('el_radio'), cash = s.cash;
    const eng = s.staff.filter((x) => x.role === 'engineer'), ppw = eng.reduce((a, x) => a + x.ability / 10, 0);
    expect(weeklyResearchPoints(s)).toBeCloseTo(ppw, 12);
    ok(g.command({ type: 'startResearch', techId: 'el_radio' }));
    expect(s.cash).toBe(cash - t.cost.money);
    expect(researchInfo(s).active[0]).toMatchObject({ techId: 'el_radio', points: 0, need: t.cost.points, weeksLeft: Math.ceil(t.cost.points / ppw) });
    let weeks = 0, done = false;
    while (!done) { done = g.tick().some((e) => e.kind === 'unlock' && e.text.includes('카 라디오')); weeks++; }
    expect(weeks).toBe(Math.ceil(t.cost.points / ppw));
    expect(s.research.done).toEqual(['el_radio']); expect(s.research.active).toEqual([]);
    // 개발에 배치된 엔지니어는 연구 점수의 30%를 낸다
    ok(g.command({ type: 'startProject', ...SPEC }));
    expect(weeklyResearchPoints(s)).toBeCloseTo(ppw * config.research.projectShare, 12); expect(weeklyResearchPoints(s)).toBeGreaterThan(0);
  });
  it('선행·현금·연구 칸(본사 1등급 3개, 0.4.2)·중복을 확인하고, 취소하면 돈은 돌아오지 않는다', () => {
    const g = gameAt(1982);
    expect(reason(g.command({ type: 'startResearch', techId: 'bd_coupe' }))).toBe('먼저 「해치백 차체」를 연구해야 합니다.');
    expect(reason(g.command({ type: 'startResearch', techId: 'nope' }))).toBe('없는 기술입니다.');
    ok(g.command({ type: 'startResearch', techId: 'bd_hatch' }));
    expect(reason(g.command({ type: 'startResearch', techId: 'bd_hatch' }))).toBe('이미 연구 중인 기술입니다.');
    ok(g.command({ type: 'startResearch', techId: 'bd_sedanM' })); ok(g.command({ type: 'startResearch', techId: 'pr_line' }));
    expect(reason(g.command({ type: 'startResearch', techId: 'el_radio' }))).toBe('연구 칸이 찼습니다(본사 등급을 올리면 칸이 늘어납니다).');
    const cash = g.state.cash;
    ok(g.command({ type: 'cancelResearch', techId: 'bd_hatch' }));
    expect(g.state.cash).toBe(cash); expect(g.state.research.active.map((x) => x.techId)).toEqual(['bd_sedanM', 'pr_line']);
    expect(reason(g.command({ type: 'cancelResearch', techId: 'bd_hatch' }))).toBe('진행 중인 연구가 아닙니다.');
    g.state.cash = 0;
    expect(reason(g.command({ type: 'startResearch', techId: 'bd_hatch' }))).toBe('현금이 모자랍니다.');
    grant(g, 'bd_hatch');
    g.state.cash = 1e9;
    expect(reason(g.command({ type: 'startResearch', techId: 'bd_hatch' }))).toBe('이미 연구한 기술입니다.');
  });
  it('연구 칸은 본사 등급마다 3/4/5/6/6개(0.4.2). 진행 중 연구는 모두 매주 점수를 고르게 받고, 우선 연구가 절반을 받는다(0.5.1)', () => {
    expect(config.research.slots).toEqual([3, 4, 5, 6, 6, 6, 6]); // 3.0.0 6·7등급도 6칸
    const g = gameAt(1982); g.state.hqLevel = 5;
    ok(g.command({ type: 'startResearch', techId: 'bd_hatch' })); ok(g.command({ type: 'startResearch', techId: 'bd_sedanM' }));
    for (const t of TECHS.filter((x) => !researchError(g.state, x.id)).slice(0, 4)) ok(g.command({ type: 'startResearch', techId: t.id }));
    expect(reason(g.command({ type: 'startResearch', techId: TECHS.find((x) => researchError(g.state, x.id) === '연구 칸이 찼습니다.')!.id }))).toBe('연구 칸이 찼습니다.');
    const ppw = weeklyResearchPoints(g.state), n = g.state.research.active.length;
    g.tick();
    for (const a of g.state.research.active) expect(a.points).toBeCloseTo(ppw / n, 9); // 고르게
    const last = g.state.research.active[n - 1].techId, before = g.state.research.active.map((a) => a.points);
    ok(g.command({ type: 'prioritizeResearch', techId: last }));
    expect(g.state.research.active[0].techId).toBe(last); expect(researchInfo(g.state).active[0]).toMatchObject({ techId: last, priority: true });
    expect(researchInfo(g.state).active[0].pointsPerWeek).toBeCloseTo(ppw * config.research.priorityShare, 9);
    g.tick();
    const after = g.state.research.active;
    expect(after[0].points - before[n - 1]).toBeCloseTo(ppw * config.research.priorityShare, 9);
    for (let i = 1; i < n; i++) expect(after[i].points - before[i - 1]).toBeCloseTo((ppw * (1 - config.research.priorityShare)) / (n - 1), 9);
    expect(reason(g.command({ type: 'prioritizeResearch', techId: 'nope' }))).toBe('진행 중인 연구가 아닙니다.');
  });
  it('먼저 하면 × (1 + 0.25 × 앞당긴 햇수)(최대 4년), 등장 + 8년 뒤면 × 0.5', () => {
    const t = techById('bd_sedanM'); // 1978
    const at = (y: number) => researchCost(gameAt(y).state, t);
    expect(at(1978)).toEqual({ money: t.cost.money, points: t.cost.points, mult: 1 });
    expect(at(1976).mult).toBe(1.5); expect(at(1974).mult).toBe(2);
    expect(at(1974).money).toBe(Math.round(t.cost.money * 2));
    expect(reason(gameAt(1973).command({ type: 'startResearch', techId: 'bd_sedanM' }))).toBe('1974년부터 연구할 수 있습니다.');
    expect(at(1985).mult).toBe(1); expect(at(1986).mult).toBe(0.5);
    const info = researchInfo(gameAt(1970).state).fields.flatMap((f) => f.techs);
    expect(info.find((x) => x.id === 'bd_sedanM')!.status).toBe('hidden'); // 아직 이름만 보임
    expect(info.find((x) => x.id === 'bd_sedanM')!.desc).toBe('');
    expect(info.find((x) => x.id === 'bd_hatch')!.status).toBe('available');
    expect(info.find((x) => x.id === 'bd_coupe')!.status).toBe('hidden');
  });
  it('반복 기술(2035 차세대)은 할 때마다 비용 × 1.5, 단계가 계속 오른다', () => {
    const g = gameAt(2036); grant(g);
    const t = techById('pw_next'), lv = ptLevel(g.state, 'gasoline');
    expect(researchCost(g.state, t).mult).toBe(1);
    g.state.research.done.push('pw_next');
    expect(researchCost(g.state, t).mult).toBe(1.5); expect(ptLevel(g.state, 'gasoline')).toBe(lv + 1);
    expect(g.command({ type: 'startResearch', techId: 'pw_next' }).ok).toBe(true);
  });
  it('"세계 최초": 등장 연도보다 먼저 완료한 기술을 쓴 첫 차만 평론 +1(기술마다 한 번)', () => {
    const run = (early: boolean) => {
      const g = gameAt(1972, 5);
      grant(g, 'bd_hatch');
      if (early) g.state.research.early.push('bd_hatch');
      ok(g.command({ type: 'startProject', ...SPEC, body: 'hatch', segment: 'youth' }));
      const p = toTest(g), r = g.command({ type: 'launch', projectId: p.id, ...LAUNCH, price: 1100 });
      ok(r);
      return { g, reviews: allGens(g.state)[0].reviews, events: r.ok ? r.events ?? [] : [] };
    };
    const a = run(false), b = run(true);
    b.reviews.forEach((x, i) => expect(x).toBeCloseTo(Math.min(10, a.reviews[i] + 1), 9));
    expect(b.events.some((e) => e.text.includes('세계 최초'))).toBe(true); expect(a.events.some((e) => e.text.includes('세계 최초'))).toBe(false);
    expect(b.g.state.research.early).toEqual([]); // 한 번 쓰면 끝
    // 연구 완료가 등장 연도보다 이르면 early에 들어간다
    const g = gameAt(1972); ok(g.command({ type: 'startResearch', techId: 'bd_hatch' }));
    while (g.state.research.active.length) g.tick();
    expect(g.state.research.early).toEqual(['bd_hatch']);
  });
  it('전담 연구원: 본사 4등급부터, 엔지니어만, 산출 × 1.5, 기본 팀·직접 팀에 못 들어감', () => {
    const g = gameAt(1985), s = g.state, eng = s.staff.find((x) => x.role === 'engineer')!, des = s.staff.find((x) => x.role === 'designer')!;
    expect(reason(g.command({ type: 'assign', staffId: eng.id, projectId: 'lab' }))).toContain('본사 4등급');
    s.hqLevel = 4;
    expect(reason(g.command({ type: 'assign', staffId: des.id, projectId: 'lab' }))).toBe('전담 연구원은 엔지니어만 될 수 있습니다.');
    const before = weeklyResearchPoints(s);
    ok(g.command({ type: 'assign', staffId: eng.id, projectId: 'lab' }));
    expect(eng.lab).toBe(true);
    expect(weeklyResearchPoints(s)).toBeCloseTo(before + (eng.ability / 10) * 0.5, 9);
    expect(reason(g.command({ type: 'startProject', ...SPEC, team: [eng.id] }))).toContain('전담 연구원');
    ok(g.command({ type: 'startProject', ...SPEC }));
    expect(eng.projectId).toBeNull(); // 기본 팀(쉬는 개발 직원 전원)에서 빠진다
    ok(g.command({ type: 'assign', staffId: eng.id, projectId: s.projects[0].id }));
    expect(eng.lab).toBe(false);
  });
});

describe('동력 단계(5.3)와 등급(tier)', () => {
  it('가솔린 시작 3단계: 고급/표준/보급형 = 3/2/1(3단계까지와 같음). 연구하면 최신에서 0/−1/−2', () => {
    const g = gameAt(1990);
    expect(powertrainLevels(g.state)).toEqual({ gasoline: 3 });
    expect([3, 2, 1].map((t) => levelForTier(g.state, 'gasoline', t))).toEqual([3, 2, 1]);
    grant(g, 'pw_carb', 'pw_efi');
    expect([3, 2, 1].map((t) => levelForTier(g.state, 'gasoline', t))).toEqual([5, 4, 3]);
    ok(g.command({ type: 'startProject', ...SPEC, tier: 3 }));
    const p = g.state.projects[0];
    expect(p.level).toBe(5);
    grant(g, 'pw_dohc');
    toTest(g); ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    expect(allGens(g.state)[0].editions[0]).toMatchObject({ tier: 3, level: 5 }); // 시작 때 단계로 고정
    grant(g, 'pw_diesel');
    expect(powertrainLevels(g.state)).toEqual({ gasoline: 6, diesel: 6 }); // 디젤 해금 5단계 + 전자 연료 분사
  });
  it('전기: 원가 가산 +35%에서 연구로 +10%까지, 대당 원가에 반영', () => {
    const g = gameAt(2030);
    expect(ptCostAdd(g.state, 'ev')).toBeCloseTo(0.35, 12); expect(ptCostAdd(g.state, 'gasoline')).toBe(0);
    grant(g, 'ec_battery1'); expect(ptCostAdd(g.state, 'ev')).toBeCloseTo(0.27, 12);
    grant(g, 'ec_battery3'); expect(ptCostAdd(g.state, 'ev')).toBeCloseTo(0.1, 12);
    expect(unitCost('sedanS', 'ev', 1, [], 1, ptCostAdd(g.state, 'ev'))).toBeCloseTo(984 * 1.1, 9);
    expect(unitCost('sedanS', 'ev', 1, [])).toBeCloseTo(984 * 1.35, 9); // 상태 없이 부르면 자료값
  });
  it('충전 인프라: 전기차 등장 사건 전 0, 시작 달 0.05, 해마다 +0.045. 전기차 수요에 곱해진다', () => {
    const seed = 4, sp = eraTimeline(seed).find((x) => x.def.id === 'evDawn')!;
    expect(chargingInfra(seed, sp.start - 1)).toBe(0); expect(chargingInfra(seed, sp.start)).toBeCloseTo(0.05, 12);
    expect(chargingInfra(seed, sp.start + 24)).toBeCloseTo(0.14, 12); expect(chargingInfra(seed, sp.start + 12 * 40)).toBe(1);
    const g = Game.create({ difficulty: 'normal', seed }), car = (powertrain: string): SaleCar => ({ body: 'sedanS', segment: 'worker', stats: { P: 900, E: 900, U: 900, D: 900, Q: 900 }, price: 1200, awareness: 0.5, life: 1, powertrain });
    expect(monthlyDemand(g.state, car('ev'), [], monthTime(sp.start - 1))).toBe(0);
    const t = monthTime(sp.start + 24);
    const ev = monthlyDemand(g.state, car('ev'), [], t), gas = monthlyDemand(g.state, car('gasoline'), [], t);
    expect(ev).toBeGreaterThan(0); expect(ev).toBeLessThan(gas * 0.3); // 인프라 0.14 × 유행 차이
  });
});

describe('시대 사건(11.1): 시드로 정한 연도 ±1년, 효과·기간·예고', () => {
  it('시작 달 = 자료 연도 ± 1년(시드로 고정), 같은 시드 = 같은 연도, 세 가지 어긋남이 모두 나온다', () => {
    const shifts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) ERA_EVENTS.forEach((d, i) => {
      const m = eraStart(seed, i), y = 1970 + Math.floor(m / 12);
      expect(Math.abs(y - d.year)).toBeLessThanOrEqual(1); expect(m % 12).toBe(d.month - 1);
      expect(eraStart(seed, i)).toBe(m); shifts.add(y - d.year);
    });
    expect([...shifts].sort()).toEqual([-1, 0, 1]);
  });
  it('오일쇼크: 36개월 동안 연비 가중치 × 1.6·대형·쿠페 수요 × 0.65, 그 밖에는 없음', () => {
    const seed = 7, sp = eraTimeline(seed).find((x) => x.def.id === 'oil1')!;
    expect(sp.end).toBe(sp.start + 36);
    expect(eraNow(seed, sp.start - 1).statW.E).toBeUndefined();
    expect(eraNow(seed, sp.start).statW.E).toBe(1.6); expect(eraNow(seed, sp.start).body.sedanL).toBe(0.65); expect(eraNow(seed, sp.start).body.coupe).toBe(0.65);
    expect(eraNow(seed, sp.end! - 1).statW.E).toBe(1.6); expect(eraNow(seed, sp.end!).statW.E).toBeUndefined();
  });
  it('외환위기: 국내 시장 × 0.6·대출 이율 × 2(24개월). 금융위기: 전 지역 × 0.75·부유층 × 0.6. 디젤 파문은 영구', () => {
    const seed = 2, T = eraTimeline(seed), at = (id: string) => T.find((x) => x.def.id === id)!;
    const imf = at('imf');
    expect(marketMult(eraNow(seed, imf.start))).toBeCloseTo(0.6, 12); expect(eraNow(seed, imf.start).loan).toBe(2); expect(imf.end).toBe(imf.start + 24);
    const g = Game.create({ difficulty: 'normal', seed }); g.state.loan.balance = 1000;
    g.state.week = (imf.start - 1) * 4; const r0 = loanRate(g.state);
    g.state.week = imf.start * 4; expect(loanRate(g.state)).toBeCloseTo(r0 * 2, 12);
    const gfc = at('gfc');
    expect(marketMult(eraNow(seed, gfc.start))).toBeCloseTo(0.75, 12); expect(eraNow(seed, gfc.start).seg.rich).toBe(0.6);
    const dg = at('dieselgate');
    expect(dg.end).toBeNull(); expect(eraNow(seed, dg.start + 12 * 20).pt.diesel).toBe(0.4); // 1.2.0: 2041년 도심 진입 제한이 더 깎기 전까지
  });
  it('감염병: 12개월 동안 공장 생산 × 0.7(생산 한도)', () => {
    const seed = 3, sp = eraTimeline(seed).find((x) => x.def.id === 'pandemic')!, g = Game.create({ difficulty: 'normal', seed });
    g.state.week = sp.start * 4; expect(capacityOf(g.state)).toBeCloseTo(300 * 0.7, 9);
    g.state.week = sp.end! * 4; expect(capacityOf(g.state)).toBe(300);
  });
  it('전기차 전환 가속: 전기 유행 +0.2, 가솔린 유행이 해마다 −3%(영구)', () => {
    const seed = 9, sp = eraTimeline(seed).find((x) => x.def.id === 'evShift')!;
    expect(eraNow(seed, sp.start).trendAdd).toMatchObject({ ev: 0.2, gasoline: 0 });
    expect(eraNow(seed, sp.start + 36).trendAdd.gasoline).toBeCloseTo(-0.09, 12);
  });
  it('예고(6개월 전)·시작·끝 뉴스가 그달 첫 주에 나오고 뉴스 기록에 남는다', () => {
    const seed = 11, sp = eraTimeline(seed).find((x) => x.def.id === 'oil1')!, g = Game.create({ difficulty: 'normal', seed });
    g.state.cash = 1e12; // 방치해도 파산하지 않게
    const texts: string[] = [];
    while (monthOf(g.state.week) <= sp.end!) for (const e of g.tick()) if (e.kind === 'news') texts.push(`${monthOf(g.state.week)}:${e.text}`);
    expect(texts).toContain(`${sp.start - 6}:[예고] ${sp.def.warn}`);
    expect(texts).toContain(`${sp.start}:[1차 오일쇼크] ${sp.def.start}`);
    expect(texts).toContain(`${sp.end}:[1차 오일쇼크] ${sp.def.end}`);
    expect(newsLog(g.state).some((x) => x.text.startsWith('[예고]'))).toBe(true);
    g.state.week = sp.start * 4 + 4;
    expect(activeEvents(g.state).events.find((x) => x.id === 'oil1')).toMatchObject({ name: '1차 오일쇼크', monthsLeft: 35 });
  });
  it('안전 규제(0.4.2): 36개월 유예 뒤 ABS·에어백은 의무 장비. 연구했으면 자동으로 들어가 옵션 칸을 차지하지 않고, 안 했으면 개발 시작·출시가 거부된다', () => {
    const seed = 1, sp = eraTimeline(seed).find((x) => x.def.id === 'safety')!;
    const at = (month: number, research = true) => { const g = Game.create({ difficulty: 'normal', seed }); g.state.cash = 1e9; g.state.week = month * 4; if (research) grant(g, 'bd_airbag', 'el_radio', 'el_aircon'); return g; };
    const BLOCK = '안전 규제로 ABS·에어백이 의무 장비가 되었습니다. 「ABS」, 「에어백」 연구가 필요합니다.';
    // 유예 중: 의무 아님(넣지 않아도 출시), 자동으로 넣지도 않는다
    const a = at(sp.start + 30 - 12);
    ok(a.command({ type: 'startProject', ...SPEC, options: [] }));
    expect(a.state.projects[0].options).toEqual([]);
    // 유예 중에 시작해 시행 뒤에 출시하면 그때 의무 장비를 넣는다
    a.state.week = (sp.start + 40) * 4; let p = toTest(a);
    ok(a.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    expect(allGens(a.state)[0].editions[0].options).toEqual(['abs', 'airbag']);
    // 시행 뒤: 본사 1등급(옵션 칸 2개)에서도 옵션 2개 + 의무 장비 2개
    const b = at(sp.start + 40);
    expect(requiredOptions(b.state)).toEqual(['abs', 'airbag']); expect(activeEvents(b.state).requiredOptions).toEqual(['abs', 'airbag']);
    ok(b.command({ type: 'startProject', ...SPEC, options: ['radio', 'aircon'] }));
    expect(b.state.projects[0].options).toEqual(['radio', 'aircon', 'abs', 'airbag']);
    expect(reason(b.command({ type: 'startProject', ...SPEC, options: ['radio', 'aircon', 'abs'] }))).toContain('개발팀이 모두 바쁩니다');
    p = toTest(b); ok(b.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    // 연구하지 않았으면 기획 단계에서 거부(이유에 필요한 기술), 출시도 거부
    const c = at(sp.start + 40, false);
    expect(regulationError(c.state, { powertrain: 'gasoline' })).toBe(BLOCK);
    expect(reason(c.command({ type: 'startProject', ...SPEC }))).toBe(BLOCK);
    const d = at(sp.start + 30); ok(d.command({ type: 'startProject', ...SPEC })); d.state.research.done = d.state.research.done.filter((x) => x !== 'bd_airbag');
    d.state.week = (sp.start + 40) * 4; p = toTest(d);
    expect(reason(d.command({ type: 'launch', projectId: p.id, ...LAUNCH }))).toBe('안전 규제로 ABS·에어백이 의무 장비가 되었습니다. 「에어백」 연구가 필요합니다.');
    const s = c.state; s.week = (sp.start + 12 * 60) * 4; grant(c, 'bd_airbag'); // 2032 유럽 내연기관 규제는 국내에 영향 없음
    expect(regulationError(s, { powertrain: 'gasoline' })).toBeNull();
  });
});

describe('사건 문구(쉬운 말)', () => {
  it('조사 도우미: 받침에 따라 을/를·이/가·으로/로(ㄹ 받침은 로), 숫자·영문은 읽는 소리로', () => {
    expect(['해치백', '노바', 'ABS·에어백', 'SUV', '2', '3'].map((w) => josa(w, '을/를'))).toEqual(['을', '를', '을', '를', '를', '을']);
    expect(['서울', '본사 빌딩', '연구 단지', '1'].map((w) => josa(w, '으로/로'))).toEqual(['로', '으로', '로', '로']);
    expect(josa('「아리아」', '이/가')).toBe('가');
  });
  it('eventImpactOn: 그 차에 걸린 사건만 쉬운 문장으로(차체 수요, 고객이 더 따지는 능력치가 이 차에 유리한지)', () => {
    const { g, gen } = launched(7), sp = eraTimeline(7).find((x) => x.def.id === 'oil1')!;
    gen.body = 'sedanL'; const ed = gen.editions[gen.editions.length - 1]; ed.stats = { ...ed.stats, E: 1000 };
    g.state.week = sp.start * 4;
    const t = eventImpactOn(g.state, gen.id);
    expect(t).toContain('1차 오일쇼크: 이 차는 대형 세단이라 35% 덜 팔립니다.');
    expect(t).toContain('1차 오일쇼크: 고객이 연비를 더 따지는데, 이 차는 연비가 좋아 유리합니다.');
    expect(activeEvents(g.state).events.find((x) => x.id === 'oil1')!.effects).toEqual(['고객이 차를 고를 때 연비를 훨씬 더 따집니다.', '대형 세단·쿠페가 35% 덜 팔립니다.']);
    g.state.week = (sp.start - 1) * 4;
    expect(eventImpactOn(g.state, gen.id)).toEqual([]);
    expect(eventImpactOn(g.state, -1)).toEqual([]);
  });
});

describe('무작위 사건(11.2)', () => {
  it('1971년부터 해마다 0~2회(시드로 고정), 1970년은 없음', () => {
    const counts = [0, 0, 0];
    for (let y = 1971; y < 2071; y++) { const n = randomMonths(5, y); counts[n.length]++; for (const m of n) { expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThan(12); } expect(randomMonths(5, y)).toEqual(n); }
    expect(randomMonths(5, 1970)).toEqual([]);
    expect(counts.every((c) => c > 5)).toBe(true);
  });
  it('뜨면 선택 대기(choice 이벤트), 답하면 효과와 뉴스, 4주 동안 답이 없으면 기본 선택', () => {
    const play = (answer: boolean) => {
      const g = Game.create({ difficulty: 'normal', seed: 6 }), bot = steady(); g.state.cash = 1e9;
      const seen: number[] = [];
      for (let w = 0; w < WPY * 15; w++) {
        bot.step(g); // 봇은 사건에 바로 기본 선택으로 답한다 → answer가 거짓이면 대기 중인 사건을 봇 전에 치운다
        if (!answer) g.state.events.pending = g.state.events.pending.filter((p) => !seen.includes(p.id));
        for (const e of g.tick()) if (e.kind === 'choice' && e.id !== undefined) seen.push(e.id);
      }
      return { g, seen };
    };
    const { g, seen } = play(true);
    expect(seen.length).toBeGreaterThan(3);
    expect(newsLog(g.state).filter((x) => x.text.includes('—')).length).toBeGreaterThan(0); // 선택 결과 뉴스
    // 직접 답하기
    const h = Game.create({ difficulty: 'normal', seed: 6 }); h.state.cash = 1e9;
    h.state.events.pending.push({ id: 999, eventId: 'motorshow', text: '모터쇼', week: 0, deadline: 4, genId: null, fx: null });
    expect(pendingChoices(h.state)[0]).toMatchObject({ id: 999, name: '모터쇼 초청', defaultChoice: 1, weeksLeft: 4 });
    expect(reason(h.command({ type: 'resolveEvent', eventId: 999, choice: 5 }))).toBe('선택지는 0~1 중에서 고르세요.');
    const rep = h.state.reputation, cash = h.state.cash;
    ok(h.command({ type: 'resolveEvent', eventId: 999, choice: 0 }));
    expect(h.state.reputation).toBe(rep + 3); expect(h.state.cash).toBe(cash - 3000);
    expect(reason(h.command({ type: 'resolveEvent', eventId: 999, choice: 0 }))).toBe('답할 사건이 없습니다.');
    // 기본 선택: 4주 뒤
    h.state.events.pending.push({ id: 1000, eventId: 'motorshow', text: '모터쇼', week: h.state.week, deadline: h.state.week + 4, genId: null, fx: null });
    const r2 = h.state.reputation;
    for (let i = 0; i < 3; i++) h.tick();
    expect(h.state.events.pending.length).toBe(1);
    h.tick();
    expect(h.state.events.pending.length).toBe(0); expect(h.state.reputation).toBe(r2); // 기본 = 불참
    expect(newsLog(h.state)[0].text).toContain('기본 선택');
  });
  it('결함 의심 신고(기존 리콜 규칙과 이어짐): 전량 수리 = 돈을 내고 결함 0(리콜 위험 없음), 버티기 = 평판 −4·인지도 × 0.85', () => {
    const mk = () => {
      const g = Game.create({ difficulty: 'normal', seed: 2 }); g.state.cash = 1e9;
      ok(g.command({ type: 'startProject', ...SPEC })); const p = toTest(g);
      ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
      const gen = allGens(g.state)[0]; gen.editions[0].defects = 10; gen.totalSold = 1000;
      g.state.events.pending.push({ id: 900, eventId: 'recallCase', text: '', week: g.state.week, deadline: g.state.week + 4, genId: gen.id, fx: null });
      return { g, gen };
    };
    const a = mk(), cash = a.g.state.cash;
    ok(a.g.command({ type: 'resolveEvent', eventId: 900, choice: 0 }));
    expect(a.gen.editions[0].defects).toBe(0); expect(a.g.state.cash).toBeCloseTo(cash - 1000 * config.recall.costPerCar * 0.6, 6);
    const b = mk(), rep = b.g.state.reputation, aw = b.gen.awareness;
    ok(b.g.command({ type: 'resolveEvent', eventId: 900, choice: 1 }));
    expect(b.g.state.reputation).toBe(rep - 4); expect(b.gen.awareness).toBeCloseTo(aw * 0.85, 12); expect(b.gen.editions[0].defects).toBe(10);
  });
  it('기간 효과: 파업 버티기는 그달 생산 × 0.5, 원자재 감수는 6개월 원가 × 1.04', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 }); g.state.cash = 1e9;
    g.state.events.pending.push({ id: 1, eventId: 'strike', text: '', week: 0, deadline: 4, genId: null, fx: null }, { id: 2, eventId: 'materials', text: '', week: 0, deadline: 4, genId: null, fx: null });
    ok(g.command({ type: 'resolveEvent', eventId: 1, choice: 1 })); ok(g.command({ type: 'resolveEvent', eventId: 2, choice: 1 }));
    expect(capacityOf(g.state)).toBe(150); expect(unitCost('sedanS', 'gasoline', 1, [], costMultOf(g.state))).toBeCloseTo(984 * 1.04, 9);
    for (let i = 0; i < 4; i++) g.tick();
    expect(capacityOf(g.state)).toBe(300); expect(activeEvents(g.state).events.some((x) => x.kind === 'random')).toBe(true);
  });
});

describe('조합 노트(5.5)', () => {
  it('출시해 본 차체 × 고객층만 공개(궁합 기호와 그때 차·평론)', () => {
    const g = Game.create({ difficulty: 'normal', seed: 1 });
    expect(comboNotes(g.state)).toEqual([]); expect(comboMark(g.state, 'sedanS', 'worker')).toBeNull();
    ok(g.command({ type: 'startProject', ...SPEC, name: '노트카' })); const p = toTest(g);
    ok(g.command({ type: 'launch', projectId: p.id, ...LAUNCH }));
    const gen = allGens(g.state)[0];
    expect(g.state.knownCombos).toEqual(['sedanS:worker']);
    expect(comboNotes(g.state)).toEqual([{ body: 'sedanS', segment: 'worker', mark: '◎', value: 1.2, carName: '노트카', generationId: gen.id, reviewAvg: gen.reviewAvg, launchMonth: gen.launchMonth }]);
    expect(comboMark(g.state, 'sedanS', 'worker')).toBe('◎'); expect(comboMark(g.state, 'sedanS', 'rich')).toBeNull();
  });
});

describe('저장 형식 3 → 4', () => {
  it('형식 3 파일(0.3.0 코드로 만든 픽스처)을 올리고 이어서 실행할 수 있다', () => {
    expect(SAVE_VERSION).toBe(11);
    const v3 = JSON.parse(readFileSync('car/tests/fixtures/save-v3.json', 'utf8'));
    expect(v3.saveVersion).toBe(3);
    const g = Game.fromJSON(v3), s = g.state;
    expect(s.saveVersion).toBe(11);
    // 이미 쓰던(판매·개발 중) 라디오·에어컨·중형 세단·파워 스티어링(선행 포함)을 연구 완료로, 소형 세단·가솔린은 원래 열려 있음
    expect(s.research.done).toEqual(['el_radio', 'el_aircon', 'bd_sedanM', 'el_powerSteering']); expect(s.research.active).toEqual([]); expect(s.research.early).toEqual([]);
    expect(s.knownCombos).toEqual(['sedanS:worker', 'sedanS:youth']);
    for (const x of s.staff) expect(x.lab).toBe(false);
    for (const gen of allGens(s)) for (const e of gen.editions) expect(e.level).toBe(e.tier);
    for (const p of s.projects) expect(p.level).toBe(p.tier);
    expect({ ...s.events, news: s.events.news.filter((n) => !n.text.startsWith('새 경쟁사')) }).toEqual({ pending: [], mods: [], news: [] }); // 4.0.0 형식 10 → 11 변환이 새 경쟁사 등장 뉴스를 남긴다
    for (const r of s.rivals.slice(0, 3)) { expect(Object.keys(r.models).sort()).toEqual(BODIES.map((b) => b.id).sort()); expect(Object.keys(r.cells).sort()).toEqual(BODIES.map((b) => b.id).sort()); }
    const bot = steady();
    for (let i = 0; i < WPY * 3 && s.status === 'playing'; i++) { bot.step(g); g.tick(); }
    expect(s.status).toBe('playing'); expect(s.research.done.length).toBeGreaterThan(2);
    const a = Game.fromJSON(v3), b = Game.fromJSON(JSON.parse(JSON.stringify(Game.fromJSON(v3).toJSON())));
    const ba = steady(), bb = steady();
    for (let i = 0; i < WPY * 2; i++) { ba.step(a); a.tick(); bb.step(b); b.tick(); }
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
  });
  it('형식 1·2 파일도 4로 올라간다', () => {
    for (const f of ['save-v1.json', 'save-v2.json']) {
      const s = Game.fromJSON(JSON.parse(readFileSync(`car/tests/fixtures/${f}`, 'utf8'))).state;
      expect(s.saveVersion).toBe(11); expect(s.research.done).toContain('el_radio'); expect(s.knownCombos.length).toBeGreaterThan(0);
    }
  });
});

describe('결정론(연구·사건 포함)', () => {
  it('같은 시드·같은 명령 = 같은 상태, 저장 → 불러오기 → 이어서 = 끊지 않은 실행(15년, 사건·연구 포함)', () => {
    const run = (g: Game, from: number, to: number) => { const b = steady(); for (let w = from; w < to && g.state.status === 'playing'; w++) { b.step(g); g.tick(); } };
    const whole = Game.create({ difficulty: 'normal', seed: 12 }); run(whole, 0, WPY * 15);
    const part = Game.create({ difficulty: 'normal', seed: 12 }); run(part, 0, WPY * 6 + 9);
    const loaded = Game.fromJSON(JSON.parse(JSON.stringify(part.toJSON()))); run(loaded, WPY * 6 + 9, WPY * 15);
    expect(JSON.stringify(loaded.toJSON())).toBe(JSON.stringify(whole.toJSON()));
    expect(whole.state.research.done.length).toBeGreaterThan(5);
    expect(whole.state.events.news.length).toBeGreaterThan(3);
    expect(whole.state.history.some((h) => h.cmd.type === 'startResearch')).toBe(true);
  });
});
