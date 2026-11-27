// 5.5.0 세계 시장 2부(설계서 7.5 2부): 현지 공장, 현지 경쟁사, 무역 사건, 자회사 해외 진출(인수 브랜드 인지도 승계), 해외 담당 임원, 자동 승인 등록, 저장 형식 13, 결정론, 2부 봇
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { config } from '../src/config';
import { REGIONS, RIVALS, regionById } from '../src/data';
import { Game, SAVE_VERSION, sellingGens } from '../src/sim/game';
import { steadyExec } from '../src/sim/bots';
import { AUTO_KINDS, autoPick } from '../src/sim/autodecide';
import { seatsOf, execInfo } from '../src/sim/execs';
import { subRegionAw } from '../src/sim/subs';
import { monthOf } from '../src/sim/time';
import { fxNow, genUnit, localSplit, plantCapOf, plantCost, plantUpkeep, quotaNow, regionCap, regionOf, regionRanking, regionViews, tariffNow, tariffRate, worldMonthStart } from '../src/sim/world';
import type { CarState } from '../src/sim/types';
import { ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 180_000 });
const FIX = 'car/tests/fixtures/save-v12.json'; // 5.2.0 코드로 만든 2004년 판: 본사 5등급, 세 권역 진출(판매 법인 신흥 0·유럽 1·북미 2등급), 고급 브랜드·인수 브랜드(포티)
const raw = () => JSON.parse(readFileSync(FIX, 'utf8')) as CarState;
const load = () => Game.fromJSON(raw());
const P = config.world.plant;
/** 북미 판매 법인 2등급(현지 공장 조건)인 판에 현지 공장 1등급을 짓고 완공까지 */
function withPlant(): Game {
  const g = load(); ok(g.command({ type: 'buildPlant', region: 'na' }));
  while (!regionOf(g.state, 'na')!.plant!.level) toMonthEnd(g);
  return g;
}

describe('5.5.0 현지 공장', () => {
  it('조건·비용: 판매 법인 2등급부터, 건설비가 장부의 해외 투자로, 공사 기간 뒤 완공, 다음 등급은 공사 중에 못 짓는다', () => {
    const g = load(), s = g.state;
    const r = g.command({ type: 'buildPlant', region: 'eu' }); // 유럽은 법인 1등급
    expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain(`판매 법인 ${P.office}등급`);
    const cash = s.cash, cost = plantCost('na', 1);
    expect(cost).toBe(Math.round(P.levels[0].cost * regionById('na').plantMult));
    ok(g.command({ type: 'buildPlant', region: 'na' }));
    expect(s.cash).toBe(cash - cost);
    expect(g.command({ type: 'buildPlant', region: 'na' }).ok).toBe(false);
    const pl = regionOf(s, 'na')!.plant!, m0 = monthOf(s.week);
    expect(pl).toMatchObject({ level: 0, build: { level: 1, doneMonth: m0 + P.levels[0].months } });
    toMonthEnd(g); expect(s.ledger.at(-1)!.worldInv).toBe(cost);
    while (!pl.level) toMonthEnd(g);
    expect(monthOf(s.week)).toBe(m0 + P.levels[0].months);
    expect(pl.build).toBeNull();
  });
  it('현지 공장이 만든 차는 관세·운송비 0, 국내 공장 한도를 쓰지 않는다. 장부 관세 = 수출 대수만큼', () => {
    const g = withPlant(); toMonthEnd(g);
    const s = g.state, e = s.ledger.at(-1)!, pl = regionOf(s, 'na')!.plant!, m = monthOf(s.week) - 1;
    expect(pl.made).toBeGreaterThan(0); expect(pl.made).toBeLessThanOrEqual(plantCapOf(1));
    let tariff = 0, loc = 0;
    for (const gen of sellingGens(s)) for (const [rid, w] of Object.entries(gen.world ?? {})) if (w.sold) {
      const { uc } = genUnit(s, gen, Math.floor(m / 12) + 1970);
      tariff += (w.sold - (w.loc ?? 0)) * uc * tariffNow(s, rid, gen.body, m); if (rid === 'na') loc += w.loc ?? 0;
    }
    expect(loc).toBe(pl.made);
    expect(e.tariff!).toBeCloseTo(tariff, -3);
    const ship = sellingGens(s).reduce((a, x) => a + Object.entries(x.world ?? {}).reduce((b, [rid, w]) => b + (w.sold - (w.loc ?? 0)) * regionById(rid).ship, 0), 0);
    expect(e.ship!).toBeCloseTo(ship, 0);
    const domMade = sellingGens(s).reduce((a, x) => a + (x.sales.at(-1) ?? 0) + Object.values(x.world ?? {}).reduce((b, w) => b + w.sold - (w.loc ?? 0), 0), 0);
    expect(domMade).toBeLessThanOrEqual(config.factory.levels[s.factory.level - 1].capacity + sellingGens(s).length); // 국내 공장 한도는 국내 + 수출만
    expect(e.world!.na.upkeep).toBe(Math.round(config.world.office.upkeep[1] * regionById('na').officeMult) + plantUpkeep('na', 1));
  });
  it('현지 생산 차종을 고르면 그 차만 현지에서 만든다. null이면 자동으로', () => {
    const g = withPlant(), s = g.state, ex = sellingGens(s).filter((x) => x.world?.na?.on);
    expect(ex.length).toBeGreaterThan(1);
    if (s.execs?.delegations.production?.includes('autoAlloc')) ok(g.command({ type: 'setDelegation', role: 'production', key: 'autoAlloc', on: false })); // 생산 배분 위임이 켜져 있으면 자동으로 고른다
    const pick = ex.at(-1)!;
    ok(g.command({ type: 'setPlantCars', region: 'na', cars: [pick.id] })); toMonthEnd(g);
    for (const x of ex) if (x !== pick) expect(x.world!.na.loc ?? 0).toBe(0);
    ok(g.command({ type: 'setPlantCars', region: 'na', cars: null })); expect(regionOf(s, 'na')!.plant!.cars).toBeUndefined();
    expect(g.command({ type: 'setPlantCars', region: 'eu', cars: null }).ok).toBe(false); // 공장 없는 권역
  });
});

describe('5.5.0 현지 경쟁사', () => {
  it('권역마다 1곳, 국내 경쟁사 목록에 없다. 현지 업체 몫을 나눌 뿐 합은 그대로(차급마다 비율 합 1)', () => {
    for (const R of REGIONS) {
      expect(R.makers.length).toBe(1);
      for (const x of R.makers) { expect(RIVALS.some((r) => r.id === x.id || r.name === x.name)).toBe(false); for (const b of Object.keys(x.cells)) expect(x.models[b]).toBeTruthy(); }
      for (const b of Object.keys(R.bodyShare)) expect(localSplit(R.id, b).reduce((a, x) => a + x.f, 0)).toBeCloseTo(1, 9);
    }
    expect(localSplit('na', 'pickup')[0].f).toBeGreaterThan(localSplit('na', 'kei')[0].f); // 쉐보래는 픽업에 강하고 경차에 약하다
  });
  it('권역 순위에 현지 경쟁사(가장 강한 차급의 모델)·내 자회사가 보이고 점유 합 ≈ 1', () => {
    const g = load(); toMonthEnd(g);
    for (const rid of ['na', 'eu', 'em']) {
      const rk = regionRanking(g.state, rid), mk = rk.find((x) => x.maker)!;
      expect(mk.name).toBe(regionById(rid).makers[0].name); expect(mk.model).toBeTruthy();
      expect(rk.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 1);
    }
    expect(regionRanking(g.state, 'na').some((x) => x.sub)).toBe(true); // 전반 위임 자회사가 자동으로 수출
  });
});

describe('5.5.0 무역 사건', () => {
  const at = (g: Game) => monthOf(g.state.week);
  it('관세 인상·인하·환율·수입 규제: 기간 동안 관세율·받는 돈·판매 상한이 바뀐다. 현지 공장이 있으면 인상·규제는 받지 않는다', () => {
    const g = load(), s = g.state, m = at(g), r = regionOf(s, 'na')!;
    const t0 = tariffNow(s, 'na', 'sedanM', m), cap0 = regionCap(s, r, m);
    expect(t0).toBe(tariffRate('na', 'sedanM', m / 12 + 1970));
    s.world!.trade = [{ kind: 'tariffUp', region: 'na', value: 0.08, until: m + 6 }, { kind: 'fxDown', region: 'na', value: 0.95, until: m + 6 }, { kind: 'quota', region: 'na', value: 0.5, until: m + 6 }];
    expect(tariffNow(s, 'na', 'sedanM', m)).toBeCloseTo(t0 + 0.08); expect(fxNow(s, 'na', m)).toBe(0.95); expect(regionCap(s, r, m)).toBeCloseTo(cap0 * 0.5);
    expect(tariffNow(s, 'na', 'sedanM', m + 6)).toBe(tariffRate('na', 'sedanM', (m + 6) / 12 + 1970)); // 기간이 끝나면 원래대로
    r.plant = { level: 1, build: null, made: 0, saved: 0, total: 0 };
    expect(tariffNow(s, 'na', 'sedanM', m)).toBeCloseTo(t0); expect(quotaNow(s, 'na', m)).toBe(1); expect(regionCap(s, r, m)).toBeCloseTo(cap0); // 공장의 가치
    expect(fxNow(s, 'na', m)).toBe(0.95); // 환율은 공장과 무관
  });
  it('굴림: 진출한 권역에만, 시드 해시(같은 시드·같은 달이면 같은 사건), 끝나고 gap개월은 다시 생기지 않는다', () => {
    const run = () => { const s = raw(); s.events.pending = []; const ev: never[] = [], m0 = monthOf(s.week); for (let m = m0; m < m0 + 240; m++) { s.week = m * 4; worldMonthStart(s, ev, m); } return s; };
    const a = run(), b = run();
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world)); expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const news = a.events.news.filter((x) => /^\[(관세|환율|수입|무역)/.test(x.text));
    expect(news.length).toBeGreaterThan(5);
    const g0 = Game.create({ seed: 1, difficulty: 'normal' }), s0 = g0.state; worldMonthStart(s0, [], 0); expect(s0.world).toBeUndefined(); // 진출 전이면 아무 일도 없다
  });
  it('무역 협정(결정): 로비하면 비용을 내고 3개월 뒤, 기다리면 3년 뒤 그 권역 관세 × 0.5(영구). 오늘 탭 결정 목록에 나오고 자동 승인 종류에 있다', () => {
    const find = (): { s: CarState; m: number } => { const s = raw(); s.events.pending = []; const m0 = monthOf(s.week); for (let m = m0; m < m0 + 600; m++) { s.week = m * 4; worldMonthStart(s, [], m); if (s.events.pending.some((p) => p.tr)) return { s, m }; } throw new Error('협정 없음'); };
    for (const lobby of [true, false]) {
      const { s, m } = find(), g = Game.fromJSON(s), pc = g.state.events.pending.find((p) => p.tr)!, rid = pc.tr!.region, cash = g.state.cash;
      expect(pc.eventId).toBe('tradeDeal'); expect(pc.tr!.cost).toBeGreaterThanOrEqual(config.world.trade.minLobby);
      ok(g.command({ type: 'resolveEvent', eventId: pc.id, choice: lobby ? 0 : 1 }));
      expect(g.state.cash).toBeCloseTo(cash - (lobby ? pc.tr!.cost : 0), 3);
      const d = g.state.world!.deals!.find((x) => x.region === rid)!;
      expect(d.at).toBe(m + (lobby ? config.world.trade.fast : config.world.trade.wait));
      expect(tariffNow(g.state, rid, 'sedanS', d.at)).toBeCloseTo(tariffRate(rid, 'sedanS', d.at / 12 + 1970) * 0.5);
      expect(tariffNow(g.state, rid, 'sedanS', d.at - 1)).toBeCloseTo(tariffRate(rid, 'sedanS', (d.at - 1) / 12 + 1970));
    }
    const k = AUTO_KINDS.find((x) => x.id === 'tradeDeal')!;
    expect(k.rule).toBe('exec');
    const { s } = find(), pc = s.events.pending.find((p) => p.tr)!;
    expect(autoPick(s, pc).choice).toBe(pc.tr!.save > pc.tr!.cost ? 0 : 1);
  });
  it('자동 승인: 켜 두면 규칙대로 답하고, 로비 비용이 현금의 안전선 이상이면 묻는다', () => {
    // 결정이 생기는 달(시드 해시로 미리 찾는다) 직전 상태에서 tick으로 굴린다
    const base = raw(); base.events.pending = [];
    let m0 = -1;
    { const s = JSON.parse(JSON.stringify(base)) as CarState, b0 = monthOf(s.week); for (let m = b0 + 1; m < b0 + 600; m++) { s.week = m * 4; worldMonthStart(s, [], m); if (s.events.pending.some((p) => p.tr)) { m0 = m; break; } } }
    expect(m0).toBeGreaterThan(0);
    for (const poor of [false, true]) {
      const s = JSON.parse(JSON.stringify(base)) as CarState; s.week = m0 * 4 - 1; s.events.pending = [];
      const g = Game.fromJSON(s); ok(g.command({ type: 'setAutoDecide', kind: 'tradeDeal', on: true }));
      if (poor) g.state.cash = 1;
      g.tick();
      const left = g.state.events.pending.filter((p) => p.tr);
      if (poor) { const d = g.state.world!.deals; expect(left.length === 1 || (d?.length ?? 0) > 0).toBe(true); } // 로비를 골랐다면 묻고, 기다리기를 골랐다면 처리
      else { expect(left.length).toBe(0); expect(g.state.world!.deals!.length).toBe(1); expect(g.state.events.news.some((x) => x.topic === 'auto' && x.text.includes('무역 협정'))).toBe(true); }
    }
  });
});

describe('5.5.0 자회사 해외 진출', () => {
  it('전반 위임 자회사는 본사가 진출한 권역에서 자동으로 판다(진출비 없음). 끄면 팔지 않고, 직접 운영은 켜야 판다', () => {
    const g = load(), s = g.state; toMonthEnd(g);
    const sub = s.subs!.find((x) => x.kind === 'premium')!;
    expect(Object.values(sub.abroad ?? {}).reduce((a, x) => a + x.sold, 0)).toBeGreaterThan(0);
    const cash = s.cash;
    for (const rid of ['na', 'eu', 'em']) ok(g.command({ type: 'setSubRegion', subId: sub.id, region: rid, on: false }));
    expect(s.cash).toBe(cash);
    toMonthEnd(g); expect(sub.abroad).toBeUndefined();
    ok(g.command({ type: 'setSubMode', subId: sub.id, mode: 'direct' }));
    expect(g.command({ type: 'setSubRegion', subId: sub.id, region: 'na', on: null }).ok).toBe(false);
    ok(g.command({ type: 'setSubRegion', subId: sub.id, region: 'na', on: true })); toMonthEnd(g);
    expect(sub.abroad?.na?.sold ?? 0).toBeGreaterThan(0); expect(sub.abroad?.eu).toBeUndefined();
    expect(sub.months.at(-1)!.sold).toBeGreaterThanOrEqual(sub.abroad!.na.sold); // 자회사 판매 합에 해외 몫이 들어간다
    expect(g.command({ type: 'setSubRegion', subId: sub.id, region: 'xx', on: true }).ok).toBe(false);
  });
  it('인수 브랜드는 그 회사가 가졌던 권역 세기의 일부를 권역 인지도로 이어받는다(본사 인지도가 더 높으면 그 값)', () => {
    const g = load(), s = g.state, acq = s.subs!.find((x) => x.from === 'porty')!, prem = s.subs!.find((x) => x.kind === 'premium')!;
    for (const rid of ['na', 'eu', 'em']) {
      const inh = (RIVALS.find((r) => r.id === 'porty')!.regions[rid]) * config.world.sub.inherit, hq = regionOf(s, rid)!.aw;
      expect(subRegionAw(s, acq, rid)).toBeCloseTo(Math.min(1, Math.max(hq, inh)));
      expect(subRegionAw(s, prem, rid)).toBeCloseTo(hq);
    }
    regionOf(s, 'em')!.aw = 0.1; expect(subRegionAw(s, acq, 'em')).toBeGreaterThan(0.5); // 1부에서는 인수하면 해외에서 빠지던 몫
  });
});

describe('5.5.0 해외 담당 임원', () => {
  it('해외에 진출한 판에서만 자리가 하나 늘어나고 화면에 보인다', () => {
    const g = load(), s = g.state;
    expect(seatsOf(s)).toBe(config.exec.seats[s.hqLevel - 1] + 1);
    expect(execInfo(s).roles.map((r) => r.role)).toContain('world');
    const n = Game.create({ seed: 1, difficulty: 'normal' });
    expect(seatsOf(n.state)).toBe(config.exec.seats[0]); expect(execInfo(n.state).roles.map((r) => r.role)).not.toContain('world');
  });
  it('임명하면 권역 인지도가 더 빨리 오르고, 위임하면 자동 수출·권역 가격·현지 생산 차종을 자동으로 돌리고 보고한다. 제안도 낸다', () => {
    const g = withPlant(), s = g.state, h = Game.fromJSON(g.toJSON());
    const x = s.staff.filter((y) => y.role === 'sales' && y.projectId === null).sort((a, b) => b.ability - a.ability)[0] ?? s.staff.filter((y) => y.projectId === null)[0];
    ok(g.command({ type: 'appointExec', role: 'world', staffId: x.id }));
    const r = regionOf(s, 'em')!; r.aw = 0.2; regionOf(h.state, 'em')!.aw = 0.2;
    toMonthEnd(g); toMonthEnd(h);
    expect(regionOf(s, 'em')!.aw).toBeGreaterThan(regionOf(h.state, 'em')!.aw);
    const gen = sellingGens(s).find((y) => y.world?.na?.on)!;
    ok(g.command({ type: 'setRegionPrice', generationId: gen.id, region: 'na', price: gen.world!.na.ap! })); ok(g.command({ type: 'setRegionAuto', region: 'eu', on: false })); ok(g.command({ type: 'setPlantCars', region: 'na', cars: [gen.id] }));
    if (s.execs!.seats.world!.staff.ability < config.exec.delegateSkill) s.execs!.seats.world!.staff.ability = 80;
    ok(g.command({ type: 'setDelegation', role: 'world', key: 'autoWorld', on: true }));
    toMonthEnd(g);
    expect(gen.world!.na.price).toBeUndefined(); expect(regionOf(s, 'eu')!.auto).toBe(true); expect(regionOf(s, 'na')!.plant!.cars).toBeUndefined();
    expect(s.execs!.reports.some((y) => y.role === 'world' && y.kind === 'autoWorld')).toBe(true);
    const ideas = Game.fromJSON(raw()); const y = ideas.state.staff.find((z) => z.projectId === null)!; ok(ideas.command({ type: 'appointExec', role: 'world', staffId: y.id }));
    ideas.state.cash = 1e12; for (let i = 0; i < 3; i++) toMonthEnd(ideas);
    expect(ideas.state.execs!.reports.some((z) => z.role === 'world' && (z.kind === 'plant' || z.kind === 'worldOffice'))).toBe(true);
  });
});

describe('5.5.0 저장 형식 13·결정론', () => {
  it('형식 12 fixture(5.2.0으로 만든 2004년 판)가 13(5.6.0부터 14)으로 올라오고 새 칸은 없으며, 이어서 돌린 결과와 저장 왕복이 같다', () => {
    const r0 = raw(); expect(r0.saveVersion).toBe(12);
    const a = Game.fromJSON(r0), s = a.state;
    expect(s.saveVersion).toBe(14); expect(SAVE_VERSION).toBe(14);
    expect(s.world!.regions.every((r) => !r.plant)).toBe(true); expect(s.world!.trade).toBeUndefined(); expect(s.subs!.every((x) => !x.regions)).toBe(true);
    for (let i = 0; i < 6; i++) toMonthEnd(a);
    const b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    for (let i = 0; i < 12; i++) { toMonthEnd(a); toMonthEnd(b); }
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });
  it('현지 공장·무역 사건·자회사 해외 판매·해외 담당이 있는 판: 같은 명령이면 같은 결과, 중간에 저장·불러오기 해도 같다', () => {
    const mk = () => { const g = withPlant(); const x = g.state.staff.find((y) => y.projectId === null)!; ok(g.command({ type: 'appointExec', role: 'world', staffId: x.id })); return g; };
    const a = mk(), b = mk();
    for (let i = 0; i < 6; i++) { toMonthEnd(a); toMonthEnd(b); }
    const c = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    for (let i = 0; i < 24; i++) { toMonthEnd(a); toMonthEnd(b); toMonthEnd(c); }
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state)); expect(JSON.stringify(c.state)).toBe(JSON.stringify(a.state));
  });
  it('신흥 시장 진출비 20억(5.5.0, 전에는 30억). 진출 전 화면 줄에 현지 공장·무역 사건은 없다', () => {
    expect(regionById('em').entry).toBe(200000);
    const v = regionViews(Game.create({ seed: 1, difficulty: 'normal' }).state);
    expect(v.every((x) => x.plant === null && !x.trade.length && x.deal === null)).toBe(true);
  });
});

describe('5.5.0 2부 봇', () => {
  it('수출 봇이 2부 기능(현지 공장·해외 담당·무역 협정 자동 승인)을 쓰면 60년 파산 없이 현지 공장을 짓는다', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), bot = steadyExec({ best: true, world: true, world2: true });
    for (let w = 0; w < 60 * 48 && g.state.status === 'playing'; w++) { bot.step(g); g.tick(); }
    const s = g.state;
    expect(s.status).toBe('playing');
    expect(s.world!.regions.filter((r) => (r.plant?.level ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
    expect(s.execs!.seats.world).toBeTruthy();
  });
});
