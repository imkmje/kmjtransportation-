// 3.5.0 경쟁 2부: 대응 신차 예고 → 출시, 가격 전쟁 두 선택, 이직 제안(직원을 잃지 않음), 경쟁사 인재 영입, 기술 제휴, 시상식, 자회사 상장 뒤 배당,
// 경쟁사 인수(경쟁사 수·자회사화·마지막 한 곳 금지), 저장 형식 9 → 10, 봇 60년 파산 없음, 초반 10년 가격 전쟁과 파산
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../src/config';
import { RANDOM_EVENTS, TECHS } from '../src/data';
import { Game, SAVE_VERSION, allGens } from '../src/sim/game';
import { novice, steady, steadyBestExec } from '../src/sim/bots';
import { activeRivals, rivalLineup, rivalModelName } from '../src/sim/rivals';
import { acquireError, acquireInfo, allianceFee, awardHistory, buyableTechs, listError, pressureFrom, rivalRelations, rivalValue, subValue, warPriceMult } from '../src/sim/rivalry';
import { weeklyResearchPoints } from '../src/sim/research';
import { subDetail, subsInfo } from '../src/sim/subs';
import { staffCap } from '../src/sim/company';
import { monthOf } from '../src/sim/time';
import type { CarState } from '../src/sim/types';
import { ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 300_000 });
const R = config.rivalry, WPY = 48;
/** 형식 9 fixture: 1998년, 본사 5등급, 현금 약 3.9조, 고급 브랜드 자회사 하나(3.1.1 코드로 만든 저장) */
const fixture = () => JSON.parse(readFileSync('car/tests/fixtures/save-v9.json', 'utf8'));
const load = () => Game.fromJSON(fixture());
const ticks = (g: Game, n: number, bot?: { step(g: Game): void }) => { for (let i = 0; i < n && g.state.status === 'playing'; i++) { bot?.step(g); g.tick(); } };
const clone = (g: Game) => Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
/** 그 결정 창이 뜰 때까지(최대 years년) */
function until(g: Game, eventId: string, years = 8): CarState['events']['pending'][number] {
  for (let i = 0; i < years * WPY; i++) { g.state.cash = Math.max(g.state.cash, 1e9); g.tick(); const p = g.state.events.pending.find((x) => x.eventId === eventId); if (p) return p; }
  throw new Error(`${eventId}가 ${years}년 안에 뜨지 않았다`);
}

describe('저장 형식 9 → 10', () => {
  it('형식 9 fixture가 10으로 올라오고 경쟁 2부가 빈 상태로 시작하며, 이어 돌리면 새 기능이 돌아가고 저장 왕복이 같다', () => {
    const raw = fixture();
    expect(raw.saveVersion).toBe(9); expect(raw.rivalry).toBeUndefined(); expect(SAVE_VERSION).toBe(10);
    const g = Game.fromJSON(raw), s = g.state;
    expect(s.saveVersion).toBe(10); expect(s.rivalry!.out).toEqual([]); expect(s.rivalry!.awards).toEqual([]);
    ticks(g, 2 * WPY);
    expect(awardHistory(s).length).toBeGreaterThanOrEqual(1); // 12월 시상식
    expect(s.rivalry!.talent.length).toBe(R.talent.count); // 본사 5등급: 경쟁사 인재 후보
    const a = JSON.stringify(g.toJSON());
    expect(JSON.stringify(Game.fromJSON(JSON.parse(a)).toJSON())).toBe(a);
    const b = clone(g); ticks(g, WPY); ticks(b, WPY);
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
});

describe('대응 신차', () => {
  it('점유율 1위 차급에 경쟁사가 신차를 예고하고(뉴스·알림), 예고한 달에 평소보다 조금 강한 새 세대를 낸다', () => {
    const g = load(), s = g.state;
    let c: NonNullable<CarState['rivalry']>['counters'][number] | undefined, ev: ReturnType<Game['tick']> = [];
    for (let i = 0; i < 10 * WPY && !c; i++) { s.cash = Math.max(s.cash, 1e9); ev = g.tick(); c = s.rivalry!.counters[0]; }
    expect(c, '10년 안에 대응 신차 예고가 없다').toBeDefined();
    expect(c!.launch - c!.announced).toBeGreaterThanOrEqual(R.counter.delayMin); expect(c!.launch - c!.announced).toBeLessThanOrEqual(R.counter.delayMax);
    expect(ev.some((e) => e.text.startsWith('[대응 신차 예고]') && e.text.includes(`약 ${c!.launch - c!.announced}개월 뒤`))).toBe(true);
    expect(rivalRelations(s).find((r) => r.id === c!.rivalId)!.counters.length).toBe(1);
    const ri = s.rivals.findIndex((r) => r.id === c!.rivalId), n0 = s.rivals[ri].models[c!.body].n;
    while (monthOf(s.week) <= c!.launch) { s.cash = Math.max(s.cash, 1e9); g.tick(); }
    const md = s.rivals[ri].models[c!.body];
    expect(md.n).toBe(n0 + 1); expect(md.start).toBe(c!.launch);
    const def = config.rivals, usual = md.base - R.counter.boost;
    expect(usual).toBeGreaterThanOrEqual(def.base - 1); // 평소 새 모델 + boost
    expect(s.events.news.some((x) => x.text.startsWith(`[대응 신차] ${s.rivals[ri].name}`))).toBe(true);
    expect(s.rivalry!.counters.some((x) => x.id === c!.id)).toBe(false);
    expect(s.rivalry!.counterCool[c!.body]).toBeGreaterThan(c!.launch); // 쿨다운
  });
});

describe('가격 전쟁', () => {
  it('두 선택: 따라 내리면 그 기간 그 차급 내 차 가격이 내려가고 끝나면 원래대로, 버티면 판매가 조금 준다. 어느 쪽도 큰 손실이 아니다', () => {
    const g = load(), pc = until(g, 'priceWar'), s0 = g.state, war = s0.rivalry!.wars.find((w) => w.id === pc.rv!.war)!;
    expect(monthOf(s0.week)).toBeGreaterThanOrEqual(pressureFrom(s0));
    expect(war.cut).toBeGreaterThanOrEqual(R.war.cutMin); expect(war.cut).toBeLessThanOrEqual(R.war.cutMax);
    expect(war.until - war.from).toBeGreaterThanOrEqual(R.war.monthsMin); expect(war.until - war.from).toBeLessThanOrEqual(R.war.monthsMax);
    const follow = clone(g), hold = clone(g), none = clone(g);
    ok(follow.command({ type: 'resolveEvent', eventId: pc.id, choice: 0 })); ok(hold.command({ type: 'resolveEvent', eventId: pc.id, choice: 1 }));
    none.state.rivalry!.wars = []; none.state.events.pending = none.state.events.pending.filter((p) => p.id !== pc.id); // 전쟁이 없던 판
    const body = war.body, gens = (s: CarState) => allGens(s).filter((x) => x.body === body && x.status === 'onSale');
    const price0 = gens(follow.state).map((x) => x.editions.at(-1)!.price);
    expect(warPriceMult(follow.state, body, monthOf(follow.state.week))).toBeCloseTo(1 - war.cut);
    expect(warPriceMult(hold.state, body, monthOf(hold.state.week))).toBe(1);
    const sold = (x: Game) => { let n = 0, rev = 0; const k0 = gens(x.state).map((y) => y.totalSold); for (let m = monthOf(x.state.week); m < war.until; m++) toMonthEnd(x); gens(x.state).forEach((y, i) => { n += y.totalSold - k0[i]; }); for (const e of x.state.ledger.slice(-(war.until - war.from))) rev += e.revenue; return { n, rev }; };
    const a = sold(follow), b = sold(hold), c = sold(none);
    expect(b.n).toBeLessThan(c.n); // 버티면 판매가 준다
    expect(b.n).toBeGreaterThan(c.n * 0.85); // 조금만
    expect(a.n).toBeGreaterThan(b.n); // 따라 내리면 판매를 지킨다
    toMonthEnd(follow); toMonthEnd(follow);
    expect(follow.state.rivalry!.wars.some((w) => w.id === war.id)).toBe(false);
    expect(warPriceMult(follow.state, body, monthOf(follow.state.week))).toBe(1); // 끝나면 원래대로
    toMonthEnd(hold); toMonthEnd(hold);
    const p1 = gens(follow.state).map((x) => x.editions.at(-1)!.price), p2 = gens(hold.state).map((x) => x.editions.at(-1)!.price);
    expect(price0.length).toBeGreaterThan(0);
    p1.forEach((p, i) => { if (p2[i]) expect(Math.abs(p / p2[i] - 1)).toBeLessThan(war.cut / 2); }); // 정한 가격 자체는 깎지 않았다(자동 가격의 작은 변화만)
    expect(follow.state.events.news.some((x) => x.text.startsWith('[가격 전쟁 끝]'))).toBe(true);
  });
  it('기본 선택은 버틴다(봇·답하지 않음)이고, 버틸 때 결과 문장에 판매 감소 어림이 있다', () => {
    const g = load(), pc = until(g, 'priceWar'), w = g.state.rivalry!.wars[0];
    expect(RANDOM_EVENTS.find((d) => d.id === 'priceWar')!.defaultChoice).toBe(1);
    expect(pc.rv!.results[1]).toMatch(/판매가 약 \d+% 줄어듭니다/);
    expect(w.follow).toBeNull();
  });
});

describe('이직 제안', () => {
  it('붙잡으면 월급이 오르고 능력·컨디션이 조금 오른다. 그대로 두거나 답하지 않아도 직원은 남는다', () => {
    const g = load(), pc = until(g, 'poach'), id = pc.rv!.staffId!, n0 = g.state.staff.length;
    const keep = clone(g), leave = clone(g), late = clone(g);
    const x0 = g.state.staff.find((x) => x.id === id)!;
    ok(keep.command({ type: 'resolveEvent', eventId: pc.id, choice: 0 })); ok(leave.command({ type: 'resolveEvent', eventId: pc.id, choice: 1 }));
    const k = keep.state.staff.find((x) => x.id === id)!;
    expect(k.pay).toBe((x0.pay ?? 0) + pc.rv!.raise!); expect(k.ability).toBe(Math.min(100, x0.ability + R.poach.ability)); expect(k.condition).toBeGreaterThanOrEqual(x0.condition);
    expect(leave.state.staff.find((x) => x.id === id)).toEqual(x0);
    ticks(late, 5); // 4주 동안 답하지 않으면 기본 선택(그대로 둔다)
    expect(late.state.events.pending.some((p) => p.id === pc.id)).toBe(false);
    for (const x of [keep, leave, late]) { expect(x.state.staff.length).toBeGreaterThanOrEqual(n0); expect(x.state.staff.some((y) => y.id === id)).toBe(true); }
  });
  it('인사 임원 위임(이직 제안 자동 대응)이 켜져 있으면 바로 처리하고 보고함에 남긴다', () => {
    const g = load(), s = g.state;
    if (!s.execs?.seats.hr) ok(g.command({ type: 'appointExec', role: 'hr', staffId: s.staff.filter((x) => x.role === 'sales').sort((a, b) => b.ability - a.ability)[0].id }));
    s.execs!.seats.hr!.staff.ability = Math.max(s.execs!.seats.hr!.staff.ability, 80);
    ok(g.command({ type: 'setDelegation', role: 'hr', key: 'autoPoach', on: true }));
    for (let i = 0; i < 10 * WPY && !s.execs!.reports.some((r) => r.kind === 'autoPoach'); i++) { s.cash = Math.max(s.cash, 1e9); g.tick(); }
    const r = s.execs!.reports.find((x) => x.kind === 'autoPoach')!;
    expect(r, '10년 안에 자동 처리한 이직 제안이 없다').toBeDefined();
    expect(r.auto).toBe(true); expect(r.text).toMatch(/^\[이직 제안\] /);
    expect(s.events.pending.some((p) => p.eventId === 'poach')).toBe(false);
  });
});

describe('경쟁사 인재·기술 제휴', () => {
  it('경쟁사 인재 영입: 영입비를 내고 직원이 되며(월급 웃돈), 그 경쟁사가 조금 약해진다', () => {
    const g = load(), s = g.state;
    toMonthEnd(g); g.tick();
    const t = s.rivalry!.talent[0], cash0 = s.cash, n0 = s.staff.length;
    expect(t.ability).toBeGreaterThanOrEqual(R.talent.minAbility);
    while (s.staff.length >= staffCap(s)) s.staff.splice(s.staff.findIndex((x) => x.projectId === null), 1); // 정원 여유
    ok(g.command({ type: 'hireRivalTalent', talentId: t.id }));
    const x = s.staff.find((y) => y.name === t.name)!;
    expect(x.from).toBe(t.rivalId); expect(x.pay).toBe(t.pay); expect(s.cash).toBeCloseTo(cash0 - t.fee, 0); expect(s.staff.length).toBeGreaterThanOrEqual(n0);
    expect(s.rivalry!.weak[t.rivalId]).toBeCloseTo(R.talent.weaken);
    const ri = s.rivals.findIndex((r) => r.id === t.rivalId), b = Object.keys(s.rivals[ri].cells)[0];
    toMonthEnd(g);
    const c = clone(g); delete c.state.rivalry!.weak[t.rivalId];
    const before = s.rivals[ri].cells[b]; toMonthEnd(g); toMonthEnd(c);
    expect(s.rivals[ri].cells[b] / c.state.rivals[ri].cells[b]).toBeCloseTo(1 - R.talent.weaken, 6);
    expect(before).toBeGreaterThan(0);
    expect(g.command({ type: 'hireRivalTalent', talentId: t.id }).ok).toBe(false); // 한 번만
  });
  it('기술 제휴: 계약금, 연구 속도 +25%(곳마다), 앞선 분야 기술을 바로 사 오기, 동시 2곳, 기간 만료', () => {
    const g = load(), s = g.state;
    // 1998년 fixture는 거의 다 연구했다: 도요다(친환경) 분야에서 다른 기술의 선행이 아닌 기술 하나를 연구 전으로 돌려 사 올 거리를 만든다
    const leaf = TECHS.find((t) => t.field === 'eco' && !t.repeatable && s.research.done.includes(t.id) && !TECHS.some((u) => u.pre.includes(t.id) && s.research.done.includes(u.id)))!;
    s.research.done = s.research.done.filter((x) => x !== leaf.id);
    const ids = activeRivals(s).map((r) => r.id).sort((a, b) => buyableTechs(s, b).length - buyableTechs(s, a).length);
    const p0 = weeklyResearchPoints(s), fee = allianceFee(s), cash0 = s.cash;
    ok(g.command({ type: 'allyRival', rivalId: ids[0] }));
    expect(s.cash).toBeCloseTo(cash0 - fee, 0); expect(weeklyResearchPoints(s)).toBeCloseTo(p0 * (1 + R.alliance.speed));
    ok(g.command({ type: 'allyRival', rivalId: ids[1] }));
    expect(weeklyResearchPoints(s)).toBeCloseTo(p0 * (1 + 2 * R.alliance.speed));
    expect(g.command({ type: 'allyRival', rivalId: ids[2] }).ok).toBe(false); // 동시 2곳
    const id = ids.slice(0, 2).find((x) => buyableTechs(s, x).length)!;
    expect(id, '사 올 기술이 있는 제휴사가 없다').toBeDefined();
    const t = buyableTechs(s, id)[0], c1 = s.cash;
    ok(g.command({ type: 'buyRivalTech', rivalId: id, techId: t.id }));
    expect(s.research.done).toContain(t.id); expect(s.cash).toBeCloseTo(c1 - t.cost, 0);
    expect(g.command({ type: 'buyRivalTech', rivalId: id, techId: t.id }).ok).toBe(false);
    ticks(g, R.alliance.months * 4 + 4);
    expect(s.rivalry!.alliances).toEqual([]);
    expect(s.events.news.some((x) => x.text.startsWith('[기술 제휴 만료]'))).toBe(true);
  });
});

describe('시상식', () => {
  it('12월 결산에 부문별 한 대씩 상을 주고, 내 차가 받으면 평판·판매 보너스·수상 표시, 기록 화면 이력', () => {
    const g = load(), s = g.state, bot = steadyBestExec();
    let years = 0;
    for (let i = 0; i < 10 * WPY && !s.rivalry!.awards.some((a) => a.who === 'mine'); i++) { bot.step(g); g.tick(); years = s.rivalry!.awards.length; }
    const h = awardHistory(s);
    expect(h.length).toBeGreaterThanOrEqual(1);
    for (const y of h) { expect(y.list.length).toBeLessThanOrEqual(R.awards.cats.length); expect(new Set(y.list.map((a) => a.cat)).size).toBe(y.list.length); }
    for (const x of s.rivalry!.awards) { // 수상 줄의 모델 이름·차급이 실제 그 회사·그 차급 모델과 같다
      if (x.who === 'rival') { const ri = s.rivals.findIndex((r) => r.name === x.company); expect(rivalModelName(s.seed, ri, s.rivals[ri].id, x.body)).toBe(x.car); }
      if (x.who === 'mine') expect(allGens(s).find((y) => y.id === x.genId)!.body).toBe(x.body);
      if (x.cat !== 'overall' && x.cat !== 'tech' && x.cat !== 'design') expect(R.awards.cats.find((c) => c.id === x.cat)!.bodies).toContain(x.body);
    }
    const a = s.rivalry!.awards.find((x) => x.who === 'mine')!;
    expect(a, `10년 안에 내 차 수상이 없다(${years}건)`).toBeDefined();
    const gen = allGens(s).find((x) => x.id === a.genId)!;
    expect(gen.awards).toContain(`${a.year}년 ${a.name}`);
    expect(gen.awardUntil).toBe((a.year - 1970) * 12 + 11 + 1 + R.awards.boostMonths);
    expect(Object.keys(s.years![a.year].rep).some((k) => k.includes(a.name))).toBe(true);
    expect(s.events.news.some((x) => x.text.startsWith(`[${a.year}년 자동차 시상식]`))).toBe(true);
  });
});

describe('자회사 상장', () => {
  it('설립 3년·흑자 조건, 판 지분만큼 현금, 뒤로는 배당이 지분만큼 줄고, 49%까지만', () => {
    const g = load(), s = g.state, sub = s.subs![0];
    ticks(g, WPY); // 흑자 12개월
    expect(listError(s, sub, 25)).toMatch(/20·30·49/);
    expect(listError(s, sub, 20)).toBeNull();
    const v = subValue(sub), cash0 = s.cash;
    ok(g.command({ type: 'listSub', subId: sub.id, pct: 20 }));
    expect(s.cash - cash0).toBeCloseTo(v * 0.2, -2); expect(sub.listed).toBe(0.2);
    expect(g.command({ type: 'listSub', subId: sub.id, pct: 20 }).ok).toBe(false);
    for (let i = 0; i < 6; i++) { // 이번 달 본사 배당 = 자회사가 낸 전체 배당 × 80%
      const cap0 = sub.capital; toMonthEnd(g);
      const row = sub.months.at(-1)!, full = cap0 + row.profit - sub.capital;
      if (row.profit > 0) expect(row.dividend).toBeCloseTo(full * 0.8, 0);
      expect(s.ledger.at(-1)!.subDiv).toBeCloseTo(row.dividend, 0);
    }
    ok(g.command({ type: 'listSub', subId: sub.id, pct: 49 }));
    expect(sub.listed).toBe(0.49); expect(listError(s, sub, 49)).toMatch(/49%까지만/);
    expect(subDetail(s, sub.id)!.sellPrice).toBe(Math.round(sub.capital * config.subs.sellShare * 0.51));
  });
  it('설립 직후 자회사는 상장할 수 없다', () => {
    const g = load(), s = g.state;
    ok(g.command({ type: 'foundSubsidiary', kind: 'value' }));
    expect(listError(s, s.subs!.at(-1)!, 20)).toMatch(/3년이 지나야/);
  });
});

describe('경쟁사 인수', () => {
  it('아무 경쟁사나 사서 인수 브랜드 자회사가 되고(이름·색·모델 이름 승계), 경쟁사 목록에서 빠지며, 마지막 한 곳은 못 산다', () => {
    const g = load(), s = g.state;
    s.cash = 1e10; // 1조 × 10
    const r0 = activeRivals(s)[0], ri = s.rivals.indexOf(r0), names = Object.keys(r0.models).sort().map((b) => rivalModelName(s.seed, ri, r0.id, b));
    const info = acquireInfo(s, r0.id)!, cash0 = s.cash;
    expect(info.reason).toBeNull(); expect(info.price).toBe(rivalValue(s, r0.id).price);
    expect(info.premium).toBeGreaterThan(0); expect(info.monthly).toBeGreaterThan(0); expect(info.monthly).toBeLessThan(info.rivalMonthly); // 빈 몫 일부는 남은 경쟁사가 가져간다
    ok(g.command({ type: 'acquireRival', rivalId: r0.id }));
    expect(s.cash).toBeCloseTo(cash0 - info.price, 0);
    const sub = s.subs!.at(-1)!;
    expect(sub.kind).toBe('acquired'); expect(sub.name).toBe(r0.name); expect(sub.from).toBe(r0.id);
    expect(sub.models.map((m) => m.name)).toEqual(names);
    expect(activeRivals(s).length).toBe(2); expect(rivalRelations(s).find((x) => x.id === r0.id)!.out).toBe(true);
    expect(subsInfo(s).used).toBe(2);
    const r1 = activeRivals(s)[0];
    ok(g.command({ type: 'acquireRival', rivalId: r1.id })); // 인수 브랜드는 종류마다 한 곳 제한의 예외
    expect(activeRivals(s).length).toBe(1);
    expect(acquireError(s, activeRivals(s)[0].id)).toMatch(/마지막 남은 경쟁사/);
    expect(g.command({ type: 'acquireRival', rivalId: activeRivals(s)[0].id }).ok).toBe(false);
    const w0 = s.week;
    ticks(g, 2 * WPY);
    expect(s.subs!.filter((x) => x.kind === 'acquired').every((x) => x.months.slice(-6).every((m) => m.sold > 0))).toBe(true);
    expect(s.events.news.filter((x) => x.week > w0).some((x) => x.category === 'rival' && (x.text.startsWith(`${r0.name}, `) || x.text.startsWith(`${r1.name}, `)) && x.text.includes('세대 출시'))).toBe(false); // 인수한 회사의 경쟁 모델 뉴스는 없다
    expect(rivalLineup(s, activeRivals(s)[0].id)).not.toBeNull();
  });
  it('인수 창 예상 실적은 월 결산과 같은 계산: 첫 달 판매가 예상과 같고, 12개월 실적이 예상의 ±25% 안', () => {
    const g = load(), s = g.state; s.cash = 1e10;
    while (s.week % 4 !== 0) g.tick();
    const a = acquireInfo(s, 'toyoda')!;
    ok(g.command({ type: 'acquireRival', rivalId: 'toyoda' }));
    const sub = s.subs!.at(-1)!, bot = steadyBestExec();
    for (let i = 0; i < 12 * 4; i++) { s.cash = Math.max(s.cash, 1e9); bot.step(g); g.tick(); }
    const m = sub.months.slice(-12), sold = m.reduce((x, y) => x + y.sold, 0) / 12, rev = m.reduce((x, y) => x + y.revenue, 0);
    expect(Math.abs(m[0].sold / a.monthly - 1)).toBeLessThan(0.02);
    expect(Math.abs(sold / a.monthly - 1)).toBeLessThan(0.25); expect(Math.abs(rev / a.yearRevenue - 1)).toBeLessThan(0.25);
    expect(Math.sign(m.reduce((x, y) => x + y.profit, 0))).toBe(Math.sign(a.yearProfit));
  });
  it('조건: 본사 5등급, 자회사 상한, 현금', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), s = g.state;
    expect(acquireError(s, s.rivals[0].id)).toMatch(/본사 5등급/);
    const f = load(); f.state.cash = 0;
    expect(acquireError(f.state, f.state.rivals[0].id)).toMatch(/현금이 모자랍니다/);
  });
});

describe('봇과 균형', () => {
  it('경쟁 2부를 모두 쓰는 봇(보통, 60년, 시드 2개)은 파산하지 않고 인수·상장·제휴·영입을 쓴다', () => {
    for (const seed of [1, 2]) {
      const g = Game.create({ seed, difficulty: 'normal' }), bot = steadyBestExec({ rivalry: true });
      ticks(g, 60 * WPY, bot);
      const s = g.state, used = (t: string) => s.history.filter((h) => h.cmd.type === t).length;
      console.log(`시드 ${seed}: 60년 현금 ${(s.cash / 1e8).toFixed(2)}조, 인수 ${used('acquireRival')}, 상장 ${used('listSub')}, 제휴 ${used('allyRival')}, 기술 구매 ${used('buyRivalTech')}, 영입 ${used('hireRivalTalent')}`);
      expect(s.status).toBe('playing');
      expect(used('acquireRival')).toBeGreaterThanOrEqual(1); expect(used('listSub')).toBeGreaterThanOrEqual(1); expect(used('allyRival')).toBeGreaterThanOrEqual(1);
      expect(activeRivals(s).length).toBeGreaterThanOrEqual(1);
    }
  });
  it('초반 10년: 가격 전쟁은 시작 뒤 정한 햇수 전에는 없고, 서툰 봇도 가격 전쟁으로 파산하지 않는다', () => {
    for (const difficulty of ['easy', 'normal'] as const) for (const seed of [1, 2, 3]) {
      const g = Game.create({ seed, difficulty }), bot = novice();
      let first = Infinity;
      for (let i = 0; i < 10 * WPY && g.state.status === 'playing'; i++) { bot.step(g); g.tick(); if (g.state.rivalry!.wars.length) first = Math.min(first, monthOf(g.state.week)); }
      expect(g.state.status, `${difficulty} ${seed}`).toBe('playing');
      expect(first).toBeGreaterThanOrEqual(pressureFrom(g.state));
    }
  });
  it('봇의 기존 흐름(경쟁 2부를 쓰지 않는 신중 봇)도 20년 파산 없음, 결정 창은 기본 선택으로 처리', () => {
    for (const seed of [4, 5]) { const g = Game.create({ seed, difficulty: 'normal' }), bot = steady(); ticks(g, 20 * WPY, bot); expect(g.state.status).toBe('playing'); expect(g.state.events.pending.length).toBeLessThanOrEqual(2); }
  });
});
