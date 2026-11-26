// 4.0.0 세계 시장 1부(설계서 7.5)와 경쟁사 6곳(7.4): 진출 조건, 관세·운송비, 생산 한도 공유·배분, 판매 법인, 권역 취향, 권역 가격, 자동 수출, 저장 변환·왕복, 수출 봇
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { config } from '../src/config';
import { RIVALS, regionById } from '../src/data';
import { Game, allGens, sellingGens } from '../src/sim/game';
import { steadyExec } from '../src/sim/bots';
import { capacityOf } from '../src/sim/company';
import { carBasePrice, cellNorm, entryMonth, rivalBase } from '../src/sim/market';
import { rivalModelName } from '../src/sim/rivals';
import { monthOf } from '../src/sim/time';
import { autoRegionPrice, entryCost, genUnit, landedCost, officeCost, regionBlock, regionCap, regionCar, regionDemandOf, regionOf, regionPrice, regionRanking, splitMade, tariffRate } from '../src/sim/world';
import type { CarState } from '../src/sim/types';
import { ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 120_000 });
const FIX = 'car/tests/fixtures/save-v10.json'; // 3.7.1로 만든 2000년 판: 본사 5등급, 평판 266, 포티 인수(인수 브랜드 모델 12종), 시상식 기록
const raw = () => JSON.parse(readFileSync(FIX, 'utf8')) as CarState;
const load = () => Game.fromJSON(raw());
const onSale = (s: CarState) => sellingGens(s).filter((g) => g.status === 'onSale');

describe('4.0.0 진출', () => {
  it('조건: 본사 3등급·권역 평판, 진출비가 현금에서 나가고 장부의 일회성 지출로 남는다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' });
    expect(g.command({ type: 'openRegion', region: 'na' }).ok).toBe(false); // 본사 1등급
    g.state.hqLevel = 3; g.state.reputation = 30;
    const r = g.command({ type: 'openRegion', region: 'na' });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain('평판 40');
    ok(g.command({ type: 'openRegion', region: 'em' })); // 신흥 시장은 평판 25
    const s = g.state, cost = regionById('em').entry;
    expect(s.cash).toBe(config.start.cash - cost);
    expect(regionOf(s, 'em')).toMatchObject({ office: 0, auto: true, aw: config.world.awStart });
    expect(regionOf(s, 'em')!.rep).toBeCloseTo(30 * config.world.repCarry);
    expect(g.command({ type: 'openRegion', region: 'em' }).ok).toBe(false); // 이미 진출
    toMonthEnd(g);
    expect(s.ledger.at(-1)!.worldInv).toBe(cost);
    expect(s.ledger.at(-1)!.oneOff).toBeGreaterThanOrEqual(cost);
  });
  it('수출 호황(1988년 전후 2년) 동안 진출비는 절반', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), s = g.state;
    const costs = new Set<number>();
    for (let y = 1985; y < 1993; y++) { s.week = (y - 1970) * 48; costs.add(entryCost(s, 'na')); }
    expect([...costs].sort((a, b) => a - b)).toEqual([regionById('na').entry / 2, regionById('na').entry]);
  });
  it('3.7.1 저장(형식 10)을 불러온 판도 조건을 채우면 바로 진출할 수 있다', () => {
    const g = load();
    expect(g.state.world).toBeUndefined();
    for (const id of ['na', 'eu', 'em']) ok(g.command({ type: 'openRegion', region: id }));
    expect(g.state.world!.regions.map((r) => r.id)).toEqual(['na', 'eu', 'em']);
  });
});

describe('4.0.0 판매·원가·배분', () => {
  const opened = () => { const g = load(); ok(g.command({ type: 'openRegion', region: 'na' })); ok(g.command({ type: 'openRegion', region: 'eu' })); toMonthEnd(g); return g; };
  it('관세·운송비: 장부 관세 = Σ 대수 × 원가 × 관세율, 운송비 = Σ 대수 × 권역 운송비, 이익에서 빠진다', () => {
    const g = opened(); toMonthEnd(g);
    const s = g.state, e = s.ledger.at(-1)!, t = s.week / 48 + 1970;
    expect(e.world?.na.sold).toBeGreaterThan(0);
    let tariff = 0, ship = 0;
    for (const gen of sellingGens(s)) for (const [rid, w] of Object.entries(gen.world ?? {})) if (w.sold) {
      const { uc } = genUnit(s, gen, Math.floor(t - 1 / 12));
      tariff += w.sold * uc * tariffRate(rid, gen.body, t - 1 / 12); ship += w.sold * regionById(rid).ship;
      expect(landedCost(rid, gen.body, uc, t)).toBeCloseTo(uc * tariffRate(rid, gen.body, t) + regionById(rid).ship);
    }
    expect(e.tariff!).toBeCloseTo(tariff, -3); expect(e.ship!).toBeCloseTo(ship, 0);
    const parts = e.revenue - e.cogs - e.salaries - e.upkeep - e.dev - e.marketing - e.interest - e.recall - e.oneOff + (e.subDiv ?? 0) - e.tariff! - e.ship! - e.worldUpkeep!;
    expect(e.profit).toBeCloseTo(parts, 3);
    expect(tariffRate('na', 'pickup', 2000)).toBe(0.25); // 북미 픽업 관세
  });
  it('생산 한도 공유: 국내 + 수출 ≤ 공장 한도, 모자라면 대당 이익이 큰 곳부터(국내 우선이면 국내부터)', () => {
    const g = opened(); g.state.factory.level = 2; toMonthEnd(g); // 생산 한도를 줄여 모자라게
    const s = g.state, made = sellingGens(s).reduce((a, x) => a + (x.sales.at(-1) ?? 0) + Object.values(x.world ?? {}).reduce((b, w) => b + w.sold, 0), 0);
    expect(made).toBeLessThanOrEqual(capacityOf(s) + sellingGens(s).length);
    const rows = [{ rid: 'na', d: 50, price: 0, unit: 300, land: 0, tr: 0, n: 0 }, { rid: 'eu', d: 50, price: 0, unit: 100, land: 0, tr: 0, n: 0 }];
    expect(splitMade(70, 50, 200, rows, false)).toBe(20); expect(rows.map((r) => r.n)).toEqual([50, 0]);
    expect(splitMade(70, 50, 200, rows, true)).toBe(50); expect(rows.map((r) => r.n)).toEqual([20, 0]);
    expect(splitMade(500, 50, 200, rows, false)).toBe(400); // 넉넉하면 모두 채우고 반올림 나머지는 국내
  });
  it('국내 우선 명령과 수출 끄기: 끈 차는 그 권역에서 팔지 않고 자동 수출도 다시 넣지 않는다', () => {
    const g = opened(), s = g.state, gen = onSale(s).find((x) => x.world?.na?.on)!;
    ok(g.command({ type: 'setDomFirst', generationId: gen.id, on: true })); expect(gen.domFirst).toBe(true);
    ok(g.command({ type: 'setExport', generationId: gen.id, region: 'na', on: false }));
    toMonthEnd(g); toMonthEnd(g);
    expect(gen.world!.na).toMatchObject({ on: false, sold: 0, no: true });
  });
  it('판매 법인: 판매 상한·인지도 목표가 오르고 유지비가 장부에 붙는다', () => {
    const g = opened(), s = g.state, r = regionOf(s, 'na')!, m = monthOf(s.week);
    const cap0 = regionCap(s, r, m);
    ok(g.command({ type: 'investOffice', region: 'na' }));
    expect(r.office).toBe(1); expect(regionCap(s, r, m) / cap0).toBeCloseTo(config.world.capShare[1] / config.world.capShare[0]);
    const aw0 = r.aw; toMonthEnd(g);
    expect(r.aw).toBeGreaterThan(aw0);
    expect(s.ledger.at(-1)!.world!.na.upkeep).toBe(Math.round(config.world.office.upkeep[0] * regionById('na').officeMult));
    expect(s.ledger.at(-1)!.worldInv).toBe(officeCost('na', 1));
    for (let i = 0; i < 2; i++) ok(g.command({ type: 'investOffice', region: 'na' }));
    expect(g.command({ type: 'investOffice', region: 'na' }).ok).toBe(false); // 3등급이 끝
  });
});

describe('4.0.0 권역 취향·가격·자동 수출', () => {
  it('취향: 같은 차라도 권역마다 잘 팔리는 차급이 다르다(북미 픽업·대형 SUV, 유럽 해치백, 신흥 시장 소형 세단)', () => {
    const g = load(), s = g.state, m = monthOf(s.week);
    for (const id of ['na', 'eu', 'em']) ok(g.command({ type: 'openRegion', region: id }));
    const gen = onSale(s)[0], table: Record<string, Record<string, number>> = {};
    for (const rid of ['na', 'eu', 'em']) for (const body of ['sedanS', 'hatch', 'sedanM', 'suvL', 'pickup']) {
      const c0 = { ...regionCar(s, gen, regionOf(s, rid)!, m), body, awareness: 0.5 }, car = { ...c0, price: Math.round(carBasePrice(s, c0) * regionById(rid).priceMult) };
      (table[rid] ??= {})[body] = regionDemandOf(s, car, [], m, rid);
    }
    const r = (rid: string, a: string, b: string) => table[rid][a] / table[rid][b];
    expect(r('na', 'pickup', 'hatch')).toBeGreaterThan(r('eu', 'pickup', 'hatch') * 3); // 북미는 픽업
    expect(r('na', 'suvL', 'sedanM')).toBeGreaterThan(r('eu', 'suvL', 'sedanM') * 2); // 북미는 대형 SUV
    expect(r('eu', 'hatch', 'sedanM')).toBeGreaterThan(r('na', 'hatch', 'sedanM') * 3); // 유럽은 해치백
    expect(r('em', 'sedanS', 'sedanM')).toBeGreaterThan(r('na', 'sedanS', 'sedanM') * 2); // 신흥 시장은 소형 세단
    expect(r('em', 'sedanS', 'sedanM')).toBeGreaterThan(r('eu', 'sedanS', 'sedanM'));
  });
  it('유럽 내연기관 규제(2032년 전후)·앞선 안전 규제: 해당 차는 그 권역에서 팔 수 없다', () => {
    const g = load(), s = g.state, gen = onSale(s)[0];
    expect(regionBlock(s, gen, 'eu')).toBeNull();
    s.week = (2040 - 1970) * 48;
    expect(regionBlock(s, gen, 'eu')).toMatch(/유럽의 내연기관 규제: 가솔린차는 팔 수 없습니다/);
    expect(regionBlock(s, gen, 'na')).toBeNull();
    s.week = (1994 - 1970) * 48; const ed = gen.editions.at(-1)!, keep = ed.options; ed.options = keep.filter((o) => o !== 'abs');
    expect(regionBlock(s, gen, 'na')).toMatch(/ABS/); // 북미는 국내보다 3년 먼저(국내 의무는 1995년 ± 1년)
    expect(regionBlock(s, gen, 'em')).toBeNull();
    ed.options = keep;
  });
  it('권역 가격: 자동은 권역 기준가 × (94~106%) 중 이익이 가장 큰 값, 수동은 범위 안에서만, null이면 자동으로', () => {
    const g = load(), s = g.state; ok(g.command({ type: 'openRegion', region: 'na' })); toMonthEnd(g);
    const gen = onSale(s).find((x) => x.world?.na?.on)!, r = regionOf(s, 'na')!, m = monthOf(s.week);
    const auto = autoRegionPrice(s, gen, r, m, [], Math.floor(s.week / 48) + 1970), base = regionPrice(s, gen, 'na');
    expect(auto).toBeGreaterThan(0); expect(base).toBe(gen.world!.na.ap);
    expect(g.command({ type: 'setRegionPrice', generationId: gen.id, region: 'na', price: 1 }).ok).toBe(false);
    ok(g.command({ type: 'setRegionPrice', generationId: gen.id, region: 'na', price: base + 100 }));
    expect(regionPrice(s, gen, 'na')).toBe(base + 100);
    toMonthEnd(g); expect(regionPrice(s, gen, 'na')).toBe(base + 100); // 자동 갱신이 덮지 않는다
    ok(g.command({ type: 'setRegionPrice', generationId: gen.id, region: 'na', price: null }));
    expect(gen.world!.na.price).toBeUndefined();
  });
  it('자동 수출: 진출 다음 결산에 이익이 나는 차를 넣고, 단종한 차는 뺀다. 끄면 새 차를 넣지 않는다', () => {
    const g = load(), s = g.state; ok(g.command({ type: 'openRegion', region: 'na' }));
    expect(onSale(s).some((x) => x.world?.na?.on)).toBe(false);
    toMonthEnd(g);
    const inList = onSale(s).filter((x) => x.world?.na?.on);
    expect(inList.length).toBeGreaterThan(0);
    expect(s.events.news.some((n) => n.category === 'world' && n.text.startsWith('자동 수출:'))).toBe(true);
    const gen = inList[0]; ok(g.command({ type: 'discontinue', generationId: gen.id }));
    toMonthEnd(g); toMonthEnd(g);
    expect(gen.world!.na.on).toBe(false);
    const g2 = load(); ok(g2.command({ type: 'openRegion', region: 'na' })); ok(g2.command({ type: 'setRegionAuto', region: 'na', on: false })); toMonthEnd(g2);
    expect(onSale(g2.state).some((x) => x.world?.na?.on)).toBe(false);
  });
  it('수출하지 않으면 국내 판매는 진출하지 않은 판과 같다(진출비만 다르다)', () => {
    const a = load(), b = load();
    ok(b.command({ type: 'openRegion', region: 'na' })); ok(b.command({ type: 'setRegionAuto', region: 'na', on: false }));
    for (let i = 0; i < 6; i++) { toMonthEnd(a); toMonthEnd(b); }
    expect(allGens(b.state).map((x) => x.sales)).toEqual(allGens(a.state).map((x) => x.sales));
    expect(a.state.ledger.at(-1)!.world).toBeUndefined();
  });
  it('권역 경쟁사 순위: 점유 합 ≈ 1, 현지 업체와 내 회사 포함', () => {
    const g = load(); ok(g.command({ type: 'openRegion', region: 'eu' })); for (let i = 0; i < 3; i++) toMonthEnd(g);
    const rk = regionRanking(g.state, 'eu');
    expect(rk.some((x) => x.local) && rk.some((x) => x.mine)).toBe(true);
    expect(rk.reduce((a, x) => a + x.share, 0)).toBeGreaterThan(0.95); expect(rk.reduce((a, x) => a + x.share, 0)).toBeLessThan(1.05);
    expect(rk.find((x) => x.id === 'bmv')!.share).toBeGreaterThan(rk.find((x) => x.id === 'hyundae')!.share); // 비엠브이는 유럽에서 강하다
  });
});

describe('4.0.0 경쟁사 6곳', () => {
  it('처음 5곳, 테슬러는 2010년 ± 1년에 등장(뉴스 한 줄). 경쟁 합(Σ(기본 + 강약)^2 × 몫 × 정규화^2)은 처음 3곳과 같다', () => {
    const g = Game.create({ seed: 3, difficulty: 'normal' }), s = g.state, tm = entryMonth(3, 'tesler');
    expect(s.rivals.map((r) => r.id)).toEqual(['hyundae', 'porty', 'toyoda', 'bmv', 'hondi']);
    expect(tm).toBeGreaterThanOrEqual(39 * 12); expect(tm).toBeLessThanOrEqual(41 * 12 + 11);
    for (const body of ['sedanS', 'kei', 'sports']) {
      const b = rivalBase(0), ref = ['hyundae', 'porty', 'toyoda'].reduce((a, id) => a + (b + RIVALS.find((r) => r.id === id)!.cells[body]) ** 2, 0);
      const k = cellNorm(s.rivals, 3, body, 0), tot = s.rivals.reduce((a, r) => { const c = RIVALS.find((d) => d.id === r.id)!.cells[body]; return a + (c === undefined ? 0 : (b + c) ** 2); }, 0);
      expect(tot * k * k).toBeCloseTo(ref, 9);
    }
    s.week = tm * 4 - 1; toMonthEnd(g); while (monthOf(s.week) <= tm) toMonthEnd(g);
    expect(s.rivals.at(-1)!.id).toBe('tesler');
    expect(s.events.news.some((n) => n.text.startsWith('새 경쟁사 테슬러 등장'))).toBe(true);
  });
  it('저장 변환 10 → 11: 새 회사는 뒤에 붙고(순번 유지), 인수 브랜드·시상식의 옛 모델 이름이 새 이름으로, 테슬러는 등장 달이 지났으면 불러올 때', () => {
    const old = raw(), g = Game.fromJSON(old), s = g.state;
    expect(s.saveVersion).toBe(12);
    expect(s.rivals.map((r) => r.id)).toEqual(['hyundae', 'porty', 'toyoda', 'bmv', 'hondi']);
    expect(s.rivalry!.out).toEqual(['porty']);
    const sub = s.subs!.find((x) => x.from === 'porty')!;
    for (const md of sub.models) expect(md.name).toBe(rivalModelName(s.seed, 1, 'porty', md.body));
    const legacy = new Set(RIVALS.flatMap((r) => r.legacy ?? []));
    for (const a of s.rivalry!.awards) if (a.who !== 'mine') expect(legacy.has(a.car)).toBe(false);
    expect(s.events.news.filter((n) => n.text.startsWith('새 경쟁사')).length).toBe(2);
    const late = raw(); late.week = (2013 - 1970) * 48;
    expect(Game.fromJSON(late).state.rivals.map((r) => r.id)).toContain('tesler');
  });
  it('저장 왕복: 해외에 진출한 판을 저장 → 불러오기 해도 이어서 같은 결과', () => {
    const g = load(); ok(g.command({ type: 'openRegion', region: 'na' })); ok(g.command({ type: 'openRegion', region: 'em' }));
    for (let i = 0; i < 4; i++) toMonthEnd(g);
    const h = Game.fromJSON(g.toJSON());
    for (let i = 0; i < 8; i++) { toMonthEnd(g); toMonthEnd(h); }
    expect(JSON.stringify(h.state)).toBe(JSON.stringify(g.state));
  });
});

describe('4.0.0 수출 봇', () => {
  it('자동 수출 + 판매 법인 봇(임원·최고 이익 가격): 60년 파산 없음, 해외 진출', () => {
    for (const seed of [1, 2]) {
      const g = Game.create({ seed, difficulty: 'normal' }), bot = steadyExec({ best: true, world: true });
      for (let w = 0; w < 60 * 48 && g.state.status === 'playing'; w++) { bot.step(g); g.tick(); }
      expect(g.state.status).toBe('playing');
      expect(g.state.world!.regions.length).toBe(3);
      expect(g.state.world!.regions.some((r) => r.office > 0)).toBe(true);
    }
  });
});
