// 3.1.0 자회사 직접 운영: 운영 방식·직접 기획·제작 지시·배지·가격·목표·그룹 종합·저장, 봇(직접 운영 대 전반 위임, 20년 파산 없음), 본사 7등급 조건
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../src/config';
import { Game, SAVE_VERSION } from '../src/sim/game';
import { steadyBestExec } from '../src/sim/bots';
import { badgeChoices, cannibalInfo, groupSummary, subDetail, subModelsIn, subPlanPreview, subPrice, autoSpec } from '../src/sim/subs';
import { monthOf } from '../src/sim/time';
import type { CarState, ProjectSpec, SubKind } from '../src/sim/types';
import { ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 600_000 });
const S = config.subs, WPY = 48;
const fixture = () => JSON.parse(readFileSync('car/tests/fixtures/save-v8.json', 'utf8'));
/** 형식 8 fixture(1994년, 본사 5등급·평판 186·현금 2.9조)에서 자회사 하나를 세운 판 */
function founded(kind: SubKind = 'premium'): { g: Game; id: number } {
  const g = Game.fromJSON(fixture());
  ok(g.command({ type: 'foundSubsidiary', kind }));
  return { g, id: g.state.subs!.at(-1)!.id };
}
const ticks = (g: Game, n: number, bot?: { step(g: Game): void }) => { for (let i = 0; i < n && g.state.status === 'playing'; i++) { bot?.step(g); g.tick(); } };
const subOf = (s: CarState, id: number) => s.subs!.find((x) => x.id === id)!;
/** 그 자회사가 지금 낼 수 있는 빈 차급의 자동 사양(이름 포함) */
const specFor = (g: Game, id: number, name = '테스트차'): ProjectSpec => {
  const sub = subOf(g.state, id), d = subDetail(g.state, id)!, body = d.areaReady.find((b) => !sub.models.some((m) => m.body === b) && !sub.orders?.some((o) => o.body === b))!;
  return autoSpec(g.state, sub, body, 'luxury', 'mid', name);
};

describe('운영 방식', () => {
  it('브랜드 자회사만 직접 운영. 직접 운영이면 스스로 모델을 늘리거나 줄이지 않고, 전반 위임으로 돌리면 정한 가격이 풀린다', () => {
    const { g, id } = founded('premium'), s = g.state;
    ok(g.command({ type: 'foundSubsidiary', kind: 'parts' }));
    expect(g.command({ type: 'setSubMode', subId: s.subs!.at(-1)!.id, mode: 'direct' })).toEqual({ ok: false, reason: '부품·금융 자회사는 전반 위임으로만 운영합니다.' });
    expect(g.command({ type: 'setSubMode', subId: id, mode: 'delegate' })).toEqual({ ok: false, reason: '이미 전반 위임 중입니다.' });
    ok(g.command({ type: 'setSubMode', subId: id, mode: 'direct' }));
    ticks(g, 2 * WPY);
    expect(subOf(s, id).models.length).toBe(0); // 전반 위임이면 첫 월말에 첫 모델이 나온다(sub300)
    expect(subDetail(s, id)!.mode).toBe('direct');
    ok(g.command({ type: 'setSubMode', subId: id, mode: 'delegate' }));
    toMonthEnd(g);
    expect(subOf(s, id).models.length).toBe(1);
    ok(g.command({ type: 'setSubMode', subId: id, mode: 'direct' }));
    const body = subOf(s, id).models[0].body;
    expect(g.command({ type: 'setSubModelPrice', subId: id, body, pct: 200 }).ok).toBe(false);
    const p0 = subPrice(s, subOf(s, id), subOf(s, id).models[0]);
    ok(g.command({ type: 'setSubModelPrice', subId: id, body, pct: 120 }));
    expect(subPrice(s, subOf(s, id), subOf(s, id).models[0])).toBeGreaterThan(p0 * 1.05);
    expect(subDetail(s, id)!.models[0].pricePct).toBe(120);
    ok(g.command({ type: 'setSubMode', subId: id, mode: 'delegate' }));
    expect(subOf(s, id).models[0].price).toBeUndefined();
    expect(g.command({ type: 'setSubModelPrice', subId: id, body, pct: 110 })).toEqual({ ok: false, reason: '가격은 직접 운영 중인 자회사에서만 정할 수 있습니다.' });
  });
});

describe('직접 기획', () => {
  it('거절 사유: 전반 위임·고객층·공유 범위·이름·자본', () => {
    const { g, id } = founded('premium'), s = g.state, spec = specFor(g, id);
    expect(g.command({ type: 'subPlanModel', subId: id, ...spec }).ok).toBe(false); // 전반 위임 중
    ok(g.command({ type: 'setSubMode', subId: id, mode: 'direct' }));
    expect(g.command({ type: 'subPlanModel', subId: id, ...spec, segment: 'worker' })).toMatchObject({ ok: false, reason: expect.stringMatching(/고급 브랜드가 맡을 수 있는 고객층/) });
    expect(g.command({ type: 'subPlanModel', subId: id, ...spec, name: s.nameplates[0].name })).toMatchObject({ ok: false, reason: expect.stringMatching(/이미 있는 차 이름/) });
    ok(g.command({ type: 'setSubShare', subId: id, share: 0 }));
    expect(g.command({ type: 'subPlanModel', subId: id, ...spec, tier: 3 })).toEqual({ ok: false, reason: '공유 범위가 좁게이면 동력 등급은 2까지 쓸 수 있습니다.' });
    ok(g.command({ type: 'setSubShare', subId: id, share: 1 }));
    subOf(s, id).capital = 100;
    expect(g.command({ type: 'subPlanModel', subId: id, ...spec })).toMatchObject({ ok: false, reason: expect.stringMatching(/자회사 자본이 모자랍니다.*추가 투자/) });
  });
  it('개발 기간이 지나면 출시: 본사와 같은 평론 계산, 개발비는 자회사 비용, 같은 차급에 다시 기획하면 다음 세대', () => {
    const { g, id } = founded('premium'), s = g.state;
    ok(g.command({ type: 'setSubMode', subId: id, mode: 'direct' }));
    const spec = specFor(g, id, '루체'), pv = subPlanPreview(s, subOf(s, id), spec), cap0 = subOf(s, id).capital;
    expect(pv.error).toBeNull(); expect(pv.cost).toBeGreaterThan(0); expect(pv.teamSize).toBe(S.team.roles.length);
    ok(g.command({ type: 'subPlanModel', subId: id, ...spec }));
    expect(subDetail(s, id)!.orders).toMatchObject([{ body: spec.body, how: 'plan', name: '루체', monthsLeft: pv.months }]);
    expect(g.command({ type: 'subPlanModel', subId: id, ...spec, name: '다른' })).toEqual({ ok: false, reason: '그 차급의 차를 이미 개발하고 있습니다.' });
    toMonthEnd(g);
    expect(subOf(s, id).months.at(-1)!.profit).toBeLessThan(-pv.cost * 0.9); // 개발비가 그달 비용
    expect(subOf(s, id).capital).toBeLessThan(cap0 - pv.cost * 0.9);
    ticks(g, pv.months * 4);
    const md = subOf(s, id).models.find((m) => m.body === spec.body)!;
    expect(md.car).toMatchObject({ how: 'plan', spec: { name: '루체', body: spec.body } });
    expect(md.name).toBe('루체');
    expect(Math.abs(md.car!.critic - pv.critic)).toBeLessThan(config.critics.noise + 0.11); // 흔들림(±0.7) 안
    const v = subModelsIn(s, spec.body).find((x) => x.name === '루체')!;
    expect(v).toMatchObject({ own: true, how: 'plan', critic: md.car!.critic, chassisSeed: md.car!.chassisSeed });
    expect(s.events.news.some((n) => n.text.includes('「루체」 출시') && n.text.includes('직접 기획'))).toBe(true);
    ok(g.command({ type: 'subPlanModel', subId: id, ...spec, name: '루체' })); // 같은 이름으로 다음 세대
    ticks(g, (pv.months + 1) * 4);
    expect(subOf(s, id).models.find((m) => m.body === spec.body)!.n).toBe(1);
  });
});

describe('제작 지시와 배지', () => {
  it('제작 지시: 전반 위임에서도 된다. 개발 중 n개월 남음, 출시하면 실제 사양', () => {
    const { g, id } = founded('value'), s = g.state, spec = specFor(g, id);
    expect(g.command({ type: 'subOrderModel', subId: id, body: spec.body, character: 'fast' as 'sport', priceBand: 'mid' }).ok).toBe(false);
    expect(g.command({ type: 'subOrderModel', subId: id, body: 'sedanL', character: 'value', priceBand: 'mid' }).ok).toBe(false); // 영역 밖
    ok(g.command({ type: 'subOrderModel', subId: id, body: spec.body, character: 'sport', priceBand: 'high', name: '모아 스포츠' }));
    const o = subDetail(s, id)!.orders[0];
    expect(o).toMatchObject({ how: 'order', character: '스포츠', band: '높게', name: '모아 스포츠' });
    toMonthEnd(g);
    expect(subDetail(s, id)!.orders[0].monthsLeft).toBe(o.monthsLeft - 1);
    ticks(g, o.monthsLeft * 4);
    const md = subOf(s, id).models.find((m) => m.name === '모아 스포츠')!;
    expect(md.car).toMatchObject({ how: 'order', character: 'sport', band: 'high', spec: { direction: S.character.sport.dir } });
  });
  it('배지: 개발비 30%·기간 1/3, 평론 −0.5, 본사 원본과의 자기 잠식이 일반 자회사 모델보다 크다', () => {
    const { g, id } = founded('value'), s = g.state;
    const ch = badgeChoices(s, subOf(s, id)), c = ch.find((x) => x.ok && x.body === 'hatch')!, src = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === c.generationId)!;
    expect(c.cost).toBeCloseTo(src.devCost * S.badge.costShare, 6);
    expect(c.months).toBeLessThanOrEqual(Math.ceil(Math.ceil((src.plan!.designWeeks + config.dev.minTestWeeks) / 4) / 3));
    expect(c.critic).toBeCloseTo(Math.round((src.reviewAvg - 0.5) * 10) / 10, 6);
    const other = founded('value');
    ok(g.command({ type: 'subBadgeModel', subId: id, modelId: c.generationId }));
    ok(other.g.command({ type: 'subOrderModel', subId: other.id, body: 'hatch', character: 'value', priceBand: 'mid' }));
    expect(g.command({ type: 'subBadgeModel', subId: id, modelId: 999999 }).ok).toBe(false);
    ticks(g, 12 * 4); ticks(other.g, 12 * 4);
    const md = subOf(s, id).models.find((m) => m.body === 'hatch')!;
    expect(md.car).toMatchObject({ how: 'badge', fromGen: c.generationId, critic: c.critic });
    expect(subDetail(s, id)!.models.find((m) => m.body === 'hatch')!.fromName).toBe(s.nameplates.find((n) => n.generations.includes(src))!.name);
    const lost = (st: CarState) => cannibalInfo(st).filter((x) => x.body === 'hatch').reduce((a, x) => a + x.share, 0);
    expect(lost(s)).toBeGreaterThan(lost(other.g.state) * 1.5);
  });
});

describe('목표와 그룹 종합', () => {
  it('목표: 이루면 브랜드·본사 평판이 오르고 뉴스, 못 미치면 뉴스 한 줄(벌칙 없음)', () => {
    const run = (value: number) => {
      const { g, id } = founded('value'), s = g.state;
      expect(g.command({ type: 'setSubTarget', subId: id, target: { kind: 'sold', value: -1 } }).ok).toBe(false);
      ok(g.command({ type: 'setSubTarget', subId: id, target: { kind: 'sold', value } }));
      while (monthOf(s.week) % 12 !== 0 || monthOf(s.week) === monthOf(fixture().week)) toMonthEnd(g); // 그해 12월 결산까지
      return { s, sub: subOf(s, id) };
    };
    const a = run(1), b = run(1e7);
    expect(a.sub.rep).toBeGreaterThan(b.sub.rep + S.target.subRep - 0.01);
    expect(a.s.events.news.some((n) => n.text.includes('목표(판매 1대)를 이뤘습니다'))).toBe(true);
    expect(b.s.events.news.some((n) => n.text.includes('에 못 미쳤습니다'))).toBe(true);
    expect(a.s.reputation).toBeGreaterThan(b.s.reputation);
    ok(Game.fromJSON(fixture()).command({ type: 'foundSubsidiary', kind: 'parts' }));
    const p = founded('parts');
    expect(p.g.command({ type: 'setSubTarget', subId: p.id, target: { kind: 'sold', value: 10 } }).ok).toBe(false);
    ok(p.g.command({ type: 'setSubTarget', subId: p.id, target: { kind: 'profit', value: 10000 } }));
  });
  it('그룹 종합: 자회사가 없으면 없음, 회사별 합이 그룹 합이고 본사 이익에서 배당·투자는 뺀다', () => {
    expect(groupSummary(Game.fromJSON(fixture()).state)).toBeNull();
    const { g } = founded('premium');
    ticks(g, 14 * 4);
    const x = groupSummary(g.state)!, e = g.state.ledger.slice(-12);
    expect(x.months.length).toBe(12);
    expect(x.total.profit).toBeCloseTo(x.companies.reduce((a, c) => a + c.profit, 0), 3);
    expect(x.companies[0].profit).toBeCloseTo(e.reduce((a, r) => a + r.profit - (r.subDiv ?? 0) + (r.subInv ?? 0), 0), 3);
    expect(x.companies[1].sold).toBe(g.state.subs![0].months.slice(-12).reduce((a, r) => a + r.sold, 0));
  });
});

describe('저장과 결정론', () => {
  it('저장 형식은 9 그대로. 개발 중인 차·직접 운영·목표가 저장 왕복과 이어 돌리기에서 같다', () => {
    const run = (split: boolean) => {
      let { g, id } = founded('premium');
      ok(g.command({ type: 'setSubMode', subId: id, mode: 'direct' }));
      ok(g.command({ type: 'subPlanModel', subId: id, ...specFor(g, id, '아스터') }));
      ok(g.command({ type: 'subBadgeModel', subId: id, modelId: 387 }));
      ok(g.command({ type: 'setSubTarget', subId: id, target: { kind: 'profit', value: 100000 } }));
      ticks(g, 6 * 4);
      if (split) g = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
      ticks(g, 3 * WPY);
      return JSON.stringify(g.toJSON());
    };
    const a = run(false);
    expect(SAVE_VERSION).toBe(14); expect(JSON.parse(a).saveVersion).toBe(14);
    expect(run(true)).toBe(a);
    const s = JSON.parse(a) as CarState;
    expect(s.subs![0].models.map((m) => m.car?.how).sort()).toEqual(expect.arrayContaining(['badge', 'plan']));
  });
});

// ---------- 봇 ----------
const base = new Map<string, string>();
const baseAt = (seed: number, yrs: number): string => {
  const k = `${seed}:${yrs}`;
  if (!base.has(k)) { const g = Game.create({ seed, difficulty: 'normal' }); ticks(g, yrs * WPY, steadyBestExec()); base.set(k, JSON.stringify(g.toJSON())); }
  return base.get(k)!;
};
describe('봇', () => {
  it('직접 운영(기획·배지)이 전반 위임보다 대체로 더 번다(1990년 설립, 6년, 고급·보급형)', () => {
    const res: string[] = []; let wins = 0, n = 0;
    for (const kind of ['premium', 'value'] as SubKind[]) {
      const r = [false, true].map((direct) => {
        const g = Game.fromJSON(JSON.parse(baseAt(1, 20)));
        g.state.cash += 5e7; g.state.reputation = Math.max(g.state.reputation, 130); g.state.hqLevel = Math.max(g.state.hqLevel, 4);
        ok(g.command({ type: 'foundSubsidiary', kind }));
        const id = g.state.subs![0].id;
        ticks(g, 6 * WPY, steadyBestExec({ subs: true, subDirect: direct }));
        expect(g.state.status).toBe('playing');
        const d = subDetail(g.state, id)!;
        if (direct) expect(d.models.every((m) => m.how !== null)).toBe(true);
        return d.total.profit;
      });
      res.push(`${kind}: 위임 ${Math.round(r[0] / 1e4)}억 / 직접 ${Math.round(r[1] / 1e4)}억`); n++; if (r[1] >= r[0]) wins++;
    }
    console.log(`직접 운영 대 전반 위임(6년 누적 이익): ${res.join(', ')}`);
    expect(wins / n).toBeGreaterThanOrEqual(0.5);
  });
  it('직접 운영 봇 20년(1990 → 2010): 파산하지 않고 기획·배지를 쓴다', () => {
    const g = Game.fromJSON(JSON.parse(baseAt(1, 20))), b = steadyBestExec({ subs: true, subDirect: true }), hows = new Set<string | undefined>();
    for (let y = 0; y < 20; y++) { ticks(g, WPY, b); for (const x of g.state.subs ?? []) for (const m of x.models) hows.add(m.car?.how); }
    expect(g.state.status).toBe('playing');
    expect(g.state.subs!.some((x) => x.mode === 'direct')).toBe(true);
    expect(hows.has('plan')).toBe(true); expect(hows.has('badge')).toBe(true);
    console.log(`직접 운영 봇 2010년: 현금 ${(g.state.cash / 1e8).toFixed(2)}조, 본사 ${g.state.hqLevel}등급, 자회사 ${g.state.subs!.map((x) => `${x.name} 자본 ${Math.round(x.capital / 1e4)}억 모델 ${x.models.length}`).join(', ')}`);
  });
});

describe('본사 7등급 조건(3.1.0)', () => {
  it('조건이 낮아졌고 정원·개발팀·유지비는 그대로', () => {
    const L = config.hq.levels[6];
    expect(L).toMatchObject({ staff: 40, teams: 6, upkeep: 250000 });
    expect(L).toMatchObject({ cost: 150000000, rep: 150 }); // 3조·170에서(봇 60년 6판: 모범 6/6, 신중 3/6 도달, CHANGELOG 3.1.0)
  });
});
