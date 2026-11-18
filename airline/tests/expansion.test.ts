import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { distanceKm } from '../src/sim/model';
import { AIRCRAFT, EVENTS, cityById, typeById } from '../src/data';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 5000; g.state.rights = undefined; return g; };
const route = (g: Game, a: string, b: string) => { const r = g.openRoute(a, b); if (!r.ok) throw new Error(r.error); const p = g.buyPlane('B737'); if (!p.ok) throw new Error(p.error); g.assign(p.planeId, r.routeId, 7); return { rid: r.routeId, pid: p.planeId }; };
const richHistory = (g: Game, rev: number) => { g.advanceDays(30); for (let i = 0; i < 12; i++) g.state.history.push({ ...g.state.history[0], month: 100 + i, revenue: rev }); };

// 대형 사업 해금 조건(3.11.0)은 따로 시험한다: 다른 시험에서는 조건을 잠시 없앤다
const needs = config.extra.mega.list.map((d) => d.need); beforeAll(() => { for (const d of config.extra.mega.list) (d as { need?: unknown }).need = undefined; }); afterAll(() => { config.extra.mega.list.forEach((d, i) => { d.need = needs[i]; }); });

describe('대형 사업 값은 고정, 조건을 채우면 해금(3.11.0)', () => {
  it('회사가 커져도 값이 오르지 않고, 일시금은 10% 할인', () => {
    const g = sb(), base = config.extra.mega.list.find((x) => x.id === 'academy')!.cost;
    expect(g.megaCost('academy')).toBe(base); richHistory(g, 500); expect(g.megaCost('academy')).toBe(base); expect(g.megaCost('academy', true)).toBe(Math.round(base * 0.9));
    expect(g.startMega('academy').ok).toBe(true); expect(g.state.megas![0].cost).toBe(base);
  });
  it('조건을 못 채우면 잠기고, 채우면 열린다(항공기 수·운항 노선·연차·앞 사업 완공)', () => {
    const g = sb(), d = config.extra.mega.list, need = (id: string) => needs[d.findIndex((x) => x.id === id)];
    const t = (id: string) => { const i = d.findIndex((x) => x.id === id); d[i].need = needs[i]; try { return g.megaLock(id); } finally { d[i].need = undefined; } };
    expect(t('academy')).toContain('항공기'); expect(t('own_KX200')).toContain('년차'); expect(t('own_KX300')).toContain('KX-200');
    expect(t('airport')).toContain('운항 노선'); expect(t('terminal')).toContain('출발 도시 노선');
    for (let i = 0; i < (need('academy')?.planes ?? 0); i++) (g as unknown as { addPlane: (t: string, b: number) => void }).addPlane('B737', 1);
    expect(t('academy')).toBeNull(); g.state.megaDone = ['own_KX200']; expect(t('own_KX300')).toBeNull();
    const i = d.findIndex((x) => x.id === 'mro'); d[i].need = needs[i]; try { expect(g.startMega('mro').ok).toBe(false); } finally { d[i].need = undefined; }
  });
  it('동시에 여러 개: 서로 다른 사업은 함께 진행되고 매달 각각 돈을 낸다. 같은 사업은 한 번에 하나', () => {
    const g = sb(); g.state.cash = 9999; const c0 = g.state.cash;
    expect(g.startMega('academy').ok).toBe(true); expect(g.startMega('mro').ok).toBe(true); expect(g.startMega('own_KX200').ok).toBe(true); expect(g.state.megas!.length).toBe(3);
    expect(g.startMega('academy').ok).toBe(false); // 같은 사업은 한 번에 하나
    const per = (id: string) => config.extra.mega.list.find((x) => x.id === id)!.cost / config.extra.mega.list.find((x) => x.id === id)!.months; g.advanceDays(31);
    expect(c0 - g.state.cash).toBeGreaterThanOrEqual(per('academy') + per('mro') + per('own_KX200') - 1e-6); expect(g.state.megas!.every((m) => m.done === 1)).toBe(true);
  });
  it('중단·일시중지는 그 사업만: 다른 사업은 계속된다', () => {
    const g = sb(); g.state.cash = 9999; g.startMega('academy'); g.startMega('mro'); const [a, b] = g.state.megas!;
    expect(g.pauseMega(a.uid).ok).toBe(true); g.advanceDays(31); expect(a.done).toBe(0); expect(b.done).toBe(1);
    expect(g.cancelMega(a.uid).ok).toBe(true); expect(g.state.megas!.map((m) => m.id)).toEqual(['mro']); expect(g.pauseMega(9999).ok).toBe(false); g.advanceDays(31); expect(g.state.megas![0].done).toBe(2);
  });
  it('돈이 모자라면 그 사업만 그 달 멈추고, 일시금 사업은 계속된다', () => {
    const g = sb(); g.state.cash = 9999; g.startMega('academy', undefined, true); g.startMega('mro'); g.state.cash = 1; g.advanceDays(31);
    expect(g.state.megas!.find((m) => m.id === 'academy')!.done).toBe(1); expect(g.state.megas!.find((m) => m.id === 'mro')!.done).toBe(0);
  });
  it('전용 터미널·허브 공항은 도시가 다르면 동시에 가능, 같은 도시는 불가', () => {
    const g = sb(); g.state.cash = 99999; expect(g.startMega('airport', 'PUS').ok).toBe(true); expect(g.startMega('airport', 'NRT').ok).toBe(true); expect(g.startMega('airport', 'PUS').ok).toBe(false);
  });
  it('3.17.0 이전 저장(mega 하나)을 불러오면 megas로 옮겨져 계속 진행된다', () => {
    const g = sb(); g.startMega('academy'); const raw = JSON.parse(JSON.stringify(g.state)); const m0 = raw.megas[0]; delete raw.megas; raw.mega = { id: m0.id, done: 5, cost: m0.cost };
    const h = Game.fromJSON(raw); expect(h.state.mega).toBeNull(); expect(h.state.megas!.length).toBe(1); expect(h.state.megas![0].done).toBe(5); h.advanceDays(31); expect(h.state.megas![0].done).toBe(6);
  });
  it('일시금: 10% 싸게 한 번에 내고, 공사 중엔 매달 내지 않는다', () => {
    const g = sb(); g.state.cash = 5000; const cost = g.megaCost('academy', true), c0 = g.state.cash;
    expect(g.startMega('academy', undefined, true).ok).toBe(true); expect(g.state.cash).toBeCloseTo(c0 - cost, 6); expect(g.state.megas![0].paid).toBe(true);
    const d = g.state.megas![0].done; g.state.cash = 1; g.advanceDays(31); expect(g.state.megas![0].done).toBe(d + 1); // 현금이 없어도 공사는 계속
    const h = sb(); h.state.cash = 1; expect(h.startMega('academy', undefined, true).ok).toBe(false);
  });
  it('전용 터미널: 슬롯 +24, 착륙료 −30%, 허브 효과 +20%', () => {
    const g = sb(), b = g.state.base, cap = g.slotCapacity(b), hb = g.hubBonus(b); g.state.megas = [{ uid: 1, ...{ id: 'terminal', done: 23, cost: 0, city: b } }]; g.advanceDays(31);
    expect(g.slotCapacity(b)).toBe(cap + 24); expect(g.hubBonus(b)).toBeCloseTo(hb + 0.2, 6);
  });
});

describe('마일리지 확장', () => {
  it('등급 회원이 생기고, 비용은 등급만큼 더 들며, 비즈니스 수요가 오른다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.setLoyalty(2); g.state.loyalty!.members = 2_000_000; g.advanceDays(30 * 24);
    const l = g.state.loyalty!; expect((l.silver ?? 0) + (l.gold ?? 0) + (l.plat ?? 0)).toBeGreaterThan(0); expect(l.plat ?? 0).toBeGreaterThan(0);
    expect(g.loyaltyCost).toBeGreaterThan((l.members / 1e6) * config.extra.loyalty.costPerM[2]);
    expect(g.eliteBiz).toBeGreaterThan(0);
  });
  it('제휴 카드는 가입비를 내고 매달 수입, 프로모션은 쉬는 기간이 있다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.setLoyalty(1); g.state.loyalty!.members = 1_000_000;
    const c0 = g.state.cash; expect(g.setCard(true).ok).toBe(true); expect(g.state.cash).toBe(c0 - config.extra.loyalty.card.fee);
    g.advanceDays(30); expect(g.state.loyalty!.cardInc).toBeGreaterThan(0);
    expect(g.startPromo().ok).toBe(true); expect(g.startPromo().ok).toBe(false);
    g.advanceDays(30 * 3); expect(g.startPromo().ok).toBe(false); // 2개월 진행 + 6개월 쉼
    g.advanceDays(30 * 6); expect(g.startPromo().ok).toBe(true);
  });
});

describe('경쟁사 수 한도(자유 모드)', () => {
  it('2년마다 1곳씩 늘어 최대 12곳', () => {
    const k = config.competitors; expect(Math.min(k.sandboxMax, k.max + Math.floor(96 / k.maxGrowMonths))).toBe(10);
    expect(Math.min(k.sandboxMax, k.max + Math.floor(240 / k.maxGrowMonths))).toBe(12);
  });
});

describe('동맹 확장', () => {
  it('이름을 짓고, 경험치로 등급이 오르면 혜택과 회원 한도가 커진다', () => {
    const g = sb(); const c = g.state.competitors.find((x) => !x.major)!; expect(g.joinAlliance(c.id).ok).toBe(true);
    expect(g.setAllianceName('하늘 연합').ok).toBe(true); expect(g.state.alli!.name).toBe('하늘 연합'); expect(g.setAllianceName('').ok).toBe(false);
    const cs = g.alliCodeshare, w = g.alliWeight, mx = g.alliMax;
    g.state.alli!.xp = 72; expect(g.alliLevel).toBe(4); expect(g.alliCodeshare).toBeGreaterThan(cs); expect(g.alliWeight).toBeLessThan(w); expect(g.alliMax).toBe(mx + 1);
  });
  it('공동 터미널은 본사 슬롯, 공동 라운지는 별점을 올린다', () => {
    const g = sb(); const { rid } = route(g, 'ICN', 'NRT'); const c = g.state.competitors.find((x) => !x.major)!; g.joinAlliance(c.id);
    const cap = g.slotCapacity(g.state.base), rt = g.routeRating(g.route(rid)!);
    expect(g.buyAlliProject('terminal').ok).toBe(true); expect(g.slotCapacity(g.state.base)).toBe(cap + 6);
    expect(g.buyAlliProject('lounge').ok).toBe(true); expect(g.routeRating(g.route(rid)!)).toBeGreaterThan(rt);
    expect(g.buyAlliProject('lounge').ok).toBe(false);
  });
  it('회의에서 공동 구매를 고르면 새 항공기가 5% 싸다', () => {
    const g = sb(); const c = g.state.competitors.find((x) => !x.major)!; g.joinAlliance(c.id);
    g.state.alli!.meeting = { expires: g.monthsPassed + 2 }; expect(g.chooseAgenda('buy').ok).toBe(true);
    const c0 = g.state.cash; g.buyPlane('B737'); expect(c0 - g.state.cash).toBeCloseTo(Math.round(typeById('B737').price * 0.95 * 10) / 10);
  });
  it('스카이 동맹 영입 시도: 붙잡으면 남고, 보내면 스카이로 간다', () => {
    const g = sb(); const [a, b] = g.state.competitors.filter((x) => !x.major); g.joinAlliance(a.id); g.joinAlliance(b.id); g.state.rivalAlliance = [];
    g.state.alli!.poach = { comp: a.id, expires: g.monthsPassed + 2, cost: 9 }; expect(g.keepMember().ok).toBe(true); expect(g.state.alliance).toContain(a.id);
    g.state.alli!.poach = { comp: b.id, expires: g.monthsPassed + 2, cost: 9 }; expect(g.releaseMember().ok).toBe(true);
    expect(g.state.alliance).not.toContain(b.id); expect(g.state.rivalAlliance).toContain(b.id);
    const r = g.recruitFromSky(b.id); expect(r.ok).toBe(true);
  });
});

describe('자회사 차리기', () => {
  it('거점·형태·자본금대로 지분 100% 자회사가 생기고, 지역 항공사는 단거리만 다닌다', () => {
    const g = sb(); const c0 = g.state.cash;
    const r = g.foundSubsidiary({ name: '바다항공', hub: 'ICN', kind: 'regional', size: 1 }); expect(r.ok).toBe(true);
    const c = g.state.competitors.find((x) => r.ok && x.id === r.id)!;
    expect(c.stake).toBe(1); expect(c.founded).toBe('regional'); expect(c.planes).toBe(config.extra.found.planes[1]); expect(g.state.cash).toBe(c0 - g.foundCost(1));
    for (const x of c.routes) expect(distanceKm(cityById(x.a), cityById(x.b))).toBeLessThanOrEqual(config.extra.found.regionalKm);
    expect(g.foundSubsidiary({ name: '바다항공', hub: 'ICN', kind: 'low', size: 0 }).ok).toBe(false); // 같은 이름
  });
});

describe('돈 쓸 곳', () => {
  it('객실 개조는 별점을 올리고, 광고는 평판과 수요를, 친환경 연료는 비용을 줄인다', () => {
    const g = sb(); const { rid, pid } = route(g, 'ICN', 'NRT'); const r = g.route(rid)!;
    const rt = g.routeRating(r); expect(g.refitCabin(pid).ok).toBe(true); expect(g.routeRating(r)).toBeGreaterThan(rt);
    const rep = g.state.reputation; expect(g.startCampaign('national').ok).toBe(true); expect(g.state.reputation).toBeGreaterThan(rep); expect(g.startCampaign('global').ok).toBe(false);
    g.plane(pid)!.shop = 0; const cost0 = g.routeDay(r).cost; expect(g.investGreen().ok).toBe(true); expect(g.routeDay(r).cost).toBeLessThan(cost0);
  });
  it('객실 일괄 개조: 노는 항공기는 한꺼번에, 운항 중이면 노선마다 한 대씩 동시에, 돈이 모자라면 기다린다', () => {
    const g = sb(); g.state.cash = 9999;
    for (const b of ['NRT', 'PEK', 'HKG']) { const { rid } = route(g, 'ICN', b); const p = g.buyPlane('B737'); if (!p.ok) throw new Error(p.error); expect(g.assign(p.planeId, rid, 7).ok).toBe(true); } // 노선 3개 × 2대
    g.buyPlane('B737'); g.buyPlane('A220'); // 노는 항공기 2대
    for (const p of g.state.planes) p.shop = 0;
    const own = g.state.planes.filter((p) => !p.leased && p.cabin === undefined); const idle = own.filter((p) => p.routeId === null).length; expect(idle).toBeGreaterThanOrEqual(2);
    const r = g.queueRefitAll(); expect(r.ok && r.n).toBe(own.length);
    const shopOn = (rid: number | null) => g.state.planes.filter((p) => p.shop > 0 && p.routeId === rid).length;
    expect(shopOn(null)).toBe(idle); for (const rt of g.state.routes) expect(shopOn(rt.id)).toBe(1); // 첫날: 노는 항공기 전부 + 노선마다 1대
    for (let d = 0; d < 12; d++) { for (const rt of g.state.routes) expect(shopOn(rt.id)).toBeLessThanOrEqual(1); g.advanceDays(1); }
    expect(own.every((p) => p.cabin === 1)).toBe(true); expect(g.state.refitQ).toBeUndefined(); // 한 대씩이면 45일, 이제 약 10일
    expect(g.queueRefitAll().ok).toBe(true); g.state.cash = 0; g.advanceDays(10); expect(g.state.refitQ!.length).toBeGreaterThan(0); // 돈이 없으면 멈춰 기다림
    g.cancelRefitQueue(); expect(g.state.refitQ).toBeUndefined();
  });
  it('객실을 개조하면 이름에 더 뉴 → 디 올 뉴가 붙고, 서비스 등급은 일괄로 바꿀 수 있다', () => {
    const g = sb(); g.state.cash = 9999; const { pid } = route(g, 'ICN', 'NRT'); const p = g.plane(pid)!, base = p.name ?? '';
    expect(g.refitCabin(pid).ok).toBe(true); expect(p.name).toMatch(/^더 뉴 /); p.shop = 0;
    expect(g.refitCabin(pid).ok).toBe(true); expect(p.name).toMatch(/^디 올 뉴 /); expect(p.name).not.toContain('더 뉴');
    if (base) expect(p.name).toBe(`디 올 뉴 ${base}`);
    route(g, 'ICN', 'PEK'); const r = g.setServiceAll(2); expect(r.ok && r.n).toBe(2); expect(g.state.routes.filter((x) => x.open).every((x) => x.svc === 2)).toBe(true);
  });
});

describe('월말 처리 금액이 보고에서 빠지지 않는다', () => {
  it('대형 사업 납입(월말)이 다음 달 보고의 비용에 들어간다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.advanceDays(30); expect(g.startMega('academy').ok).toBe(true);
    const pay = g.state.megas![0].cost! / 18; g.advanceDays(60);
    expect(g.state.history.at(-1)!.cost).toBeGreaterThanOrEqual(pay - 1e-6);
  });
});

describe('후반: 왕조 목표·자체 기종·허브 공항·상장·정책·순위전', () => {
  it('왕조 목표: 조건을 채우면 월말에 달성되고 업적에 들어간다', async () => {
    const { achieved } = await import('../src/sim/achievements');
    const g = sb(); expect(g.setDynasty('fleet').ok).toBe(true); expect(g.setDynasty('world1').ok).toBe(false);
    for (let i = 0; i < 100; i++) g.buyPlane('E175');
    g.advanceDays(30); expect(g.state.dynastyDone).toContain('fleet'); expect(g.state.dynasty).toBeNull();
    expect(achieved(g)).toContain('dyn_fleet');
  });
  it('자체 기종: 개발 전에는 못 사고, 완성되면 구매 목록에 나오고 기술료가 들어온다', () => {
    const g = sb(); expect(g.buyPlane('KX200').ok).toBe(false); expect(g.shopTypes().some((t) => t.id === 'KX200')).toBe(false);
    g.state.megas = [{ uid: 1, ...{ id: 'own_KX200', done: 35, cost: 36 } }]; g.advanceDays(30);
    expect(g.state.ownTypes).toContain('KX200'); expect(g.shopTypes().some((t) => t.id === 'KX200')).toBe(true); expect(g.buyPlane('KX200').ok).toBe(true);
    const c0 = g.state.cash, n = g.state.competitors.reduce((a, c) => a + c.planes, 0); (g as unknown as { lateStep(m: number): void }).lateStep(g.monthsPassed);
    expect(g.state.cash - c0).toBeCloseTo(Math.round(config.extra.royalty * n * 100) / 100);
  });
  it('자체 기종은 시중 최고 기종보다 좌석당 운항비가 25% 이상 낮고, 같은 노선에서 이익이 더 크다', () => {
    const per = (id: string) => typeById(id).hourly / typeById(id).seats, market = AIRCRAFT.filter((t) => t.seats >= 150);
    for (const id of ['KX200', 'KX300', 'KX400']) expect(per(id)).toBeLessThan(Math.min(...market.filter((t) => t.seats >= typeById(id).seats * 0.75).map((t) => t.hourly / t.seats)) * 0.75);
    const run = (type: string) => { const g = sb(); g.state.ownTypes = ['KX200']; const o = g.openRoute('ICN', 'HKG'); if (!o.ok) throw new Error(o.error); const p = g.buyPlane(type); if (!p.ok) throw new Error(p.error); g.assign(p.planeId, o.routeId, 7); g.advanceDays(60); return g.state.history.at(-1)!.profit; };
    expect(run('KX200')).toBeGreaterThan(run('A321N'));
    const g = sb(); const { rid, pid } = route(g, 'ICN', 'HKG'); expect(g.routeOptions(rid).some((x) => x.type === 'KX200')).toBe(false);
    g.state.ownTypes = ['KX200']; expect(g.routeOptions(rid).some((x) => x.type === 'KX200')).toBe(true); expect(g.replaceOptions(pid).some((x) => x.type === 'KX200')).toBe(true); // 노선 '항공기 추가'·교체 추천에도 자체 기종
  });
  it('자체 기종은 기종 도감(시중 기종 수)에 세지 않는다', () => {
    const g = sb(); g.state.ownTypes = ['KX200']; const o = g.openRoute('ICN', 'HKG'); if (!o.ok) throw new Error(o.error); const p = g.buyPlane('KX200'); if (!p.ok) throw new Error(p.error);
    expect(g.assign(p.planeId, o.routeId, 7).ok).toBe(true); expect(g.state.typesFlown ?? []).not.toContain('KX200');
  });
  it('대형 사업 일시중지: 멈춘 동안 돈도 진행도 멈추고, 재개하면 이어서', () => {
    const g = sb(); g.state.cash = 5000; expect(g.startMega('academy').ok).toBe(true); g.advanceDays(30 * 2); const d0 = g.state.megas![0].done;
    expect(g.pauseMega().ok).toBe(true); expect(g.state.megas![0].paused).toBe(true); const c0 = g.state.cash; g.advanceDays(30 * 3);
    expect(g.state.megas![0].done).toBe(d0); expect(g.state.log.some((l) => l.includes('공사가 이번 달 멈췄습니다'))).toBe(false);
    expect(g.pauseMega().ok).toBe(true); expect(g.state.megas![0].paused).toBeUndefined(); g.advanceDays(30 * 2); expect(g.state.megas![0].done).toBeGreaterThan(d0); void c0;
    expect(new Game(3, undefined, { sandbox: true }).pauseMega().ok).toBe(false);
  });
  it('입찰 자동: 경쟁사보다 높게 부르되 한도와 현금 2배 조건을 지킨다', () => {
    const g = sb(); g.state.base = 'ICN'; g.state.bids = [{ id: 1, kind: 'slots', city: 'HKG', n: 5, ends: g.monthsPassed + 3, best: { who: 99, amount: 12 }, min: 10 }];
    expect(g.applyRules().some((x) => x.startsWith('입찰'))).toBe(false); // 규칙 꺼짐
    g.setRule('autoBid', true); expect(g.applyRules().some((x) => x.startsWith('입찰 자동'))).toBe(true); expect(g.state.bids![0].best!.who).toBe(0);
    expect(g.applyRules().some((x) => x.startsWith('입찰 자동'))).toBe(false); // 이미 최고가
    const cap = g.bidCap(g.state.bids![0]); g.state.bids![0].best = { who: 99, amount: cap }; g.applyRules(); expect(g.state.bids![0].best!.who).toBe(99); // 한도 넘으면 안 부름
    g.state.bids![0].best = { who: 99, amount: 12 }; g.state.cash = 20; g.applyRules(); expect(g.state.bids![0].best!.who).toBe(99); // 현금이 2배 안 되면 안 부름
  });
  it('진행 중인 사건 자동 대응: 현금이 대응 비용 3배 이상일 때만', () => {
    const g = sb(), d = EVENTS.find((x) => x.option && !x.scheduled)!; g.state.events.push({ def: d.id, monthsLeft: 3 }); const i = g.state.events.length - 1;
    g.state.cash = g.eventCost(d) * 2; g.setRule('events', true); expect(g.applyRules().some((x) => x.startsWith('사건 자동 대응'))).toBe(false); expect(g.state.events[i].handled).toBeFalsy();
    g.state.cash = g.eventCost(d) * 3 + 1; expect(g.applyRules().some((x) => x.startsWith('사건 자동 대응'))).toBe(true); expect(g.state.events[i].handled).toBe(true);
    expect(g.applyRules().some((x) => x.startsWith('사건 자동 대응'))).toBe(false); // 한 번만
  });
  it('자회사 자본금: 넣은 만큼 내 지분이 오르고, 투자 성적에 잡힌다', () => {
    const g = sb(); g.advanceDays(30 * 12); g.state.cash = 99999; const c = g.state.competitors.find((x) => !x.major)!; const b = g.buyStake(c.id, 0.51); expect(b.ok).toBe(true);
    const v = g.acquirePrice(c), want = Math.round(((0.51 * v + 100) / (v + 100)) * 100) / 100; expect(g.stakeAfter(c, 100)).toBe(want);
    expect(g.injectSubsidiary(c.id, 100).ok).toBe(true); expect(c.stake).toBe(want); expect(c.stake).toBeGreaterThan(0.51);
    expect(g.subReturn(c).put).toBeCloseTo((b.ok ? b.price : 0) + 100); expect(g.stakeAfter(c, 1e9)).toBe(1); expect((g as unknown as { allyWeight: (x: typeof c) => number }).allyWeight(c)).toBe(config.subsidiary.weight['0.51']); // 51~99%는 자회사 힘
  });
  it('자회사는 비상금을 남기고 항공기를 산다', () => {
    const g = sb(); g.advanceDays(30 * 12); g.state.cash = 99999; const c = g.state.competitors.find((x) => !x.major)!; g.buyStake(c.id, 0.51); g.setSubDir(c.id, 'grow');
    const r0 = config.subsidiary.reserve; expect(r0).toBe(15);
    try { config.subsidiary.reserve = 1000; c.cash = 100; const n = c.planes; g.advanceDays(30); expect(c.planes).toBe(n); // 비상금보다 적으면 안 산다
      config.subsidiary.reserve = 0; c.cash = 100; g.advanceDays(30); expect(c.planes).toBeGreaterThan(n);
    } finally { config.subsidiary.reserve = r0; }
  });
  it('자회사 합병: 항공기·노선·현금을 합치고 지분은 가치 비율로, 흡수된 회사는 사라진다', () => {
    const g = sb(); g.advanceDays(30 * 12); g.state.cash = 99999; const [a, b] = g.state.competitors.filter((x) => !x.major); g.buyStake(a.id, 0.51); g.buyStake(b.id, 0.51); g.injectSubsidiary(b.id, 100);
    b.routes.push({ ...a.routes[0] }); const shared = a.routes[0], seats = shared.seatsDay, n0 = a.routes.length;
    const pa = a.planes, pb = b.planes, ca = a.cash, cb = b.cash, va = g.acquirePrice(a), vb = g.acquirePrice(b), sa = a.stake!, sbk = b.stake!, cost = g.mergeCost(b), c0 = g.state.cash;
    const r = g.mergeSubs(a.id, b.id); expect(r.ok).toBe(true);
    expect(a.planes).toBe(pa + pb); expect(a.cash).toBeCloseTo(ca + cb, 6); expect(g.state.cash).toBeCloseTo(c0 - cost, 6); expect(g.state.competitors.includes(b)).toBe(false);
    expect(a.stake).toBeCloseTo(Math.round(((sa * va + sbk * vb) / (va + vb)) * 100) / 100, 6); expect(a.stake).toBeGreaterThan(sa);
    expect(shared.seatsDay).toBe(Math.round(seats * 2)); expect(a.routes.length).toBe(n0 + b.routes.length - 1);
    expect(g.mergeSubs(a.id, a.id).ok).toBe(false); g.state.competitors.push({ id: 999, name: '남의 회사', style: 'low', hub: 'PUS', cash: 50, planes: 3, routes: [] }); expect(g.mergeSubs(a.id, 999).ok).toBe(false); // 자회사가 아니면 안 됨
  });
  it('허브 투자 여러 도시 일괄', () => {
    const g = sb(); const o = g.openRoute(g.state.base, 'NRT'); if (!o.ok) throw new Error(o.error); g.buyForRoute(o.routeId, 'B737', 'new');
    const cs = g.hubCities; expect(cs).toEqual(expect.arrayContaining([g.state.base, 'NRT'])); expect(cs).not.toContain('HKG');
    const cash = g.state.cash, r = g.buyHubMany([g.state.base, 'NRT', 'HKG'], 'one'); expect(r.ok && r.count).toBe(6);
    expect(g.hubLevel('NRT', 'lounge')).toBe(1); expect(g.hubLevel('HKG', 'lounge')).toBe(0); expect(cash - g.state.cash).toBeCloseTo(r.ok ? r.total : 0);
    g.state.cash = 1; expect(g.buyHubMany(['NRT'], 'max').ok).toBe(false); expect(g.hubLevel('NRT', 'terminal')).toBe(1); // 모자라면 하나도 안 산다
  });
  it('허브 공항: 도시를 골라야 착공되고, 완공되면 슬롯 +30·착륙료 면제', () => {
    const g = sb(); expect(g.startMega('airport').ok).toBe(false);
    const cap = g.slotCapacity('PUS'); expect(g.startMega('airport', 'PUS').ok).toBe(true);
    g.state.megas![0].done = 29; g.advanceDays(30); expect(g.state.myAirports).toContain('PUS'); expect(g.slotCapacity('PUS')).toBe(cap + 30);
  });
  it('상장: 3년차 전에는 못 하고, 상장하면 현금, 1년 뒤 주주 총회에서 배당', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); expect(g.goPublic().ok).toBe(false);
    g.advanceDays(30 * 36); const v = g.companyValue, c0 = g.state.cash; const r = g.goPublic(); expect(r.ok).toBe(true);
    expect(g.state.cash).toBeCloseTo(c0 + Math.round(v * config.extra.ipo.share)); expect(g.goPublic().ok).toBe(false);
    g.advanceDays(30 * 12); expect(g.state.ipo!.hist.length).toBe(2); expect(g.state.log.some((l) => l.includes('주주 총회'))).toBe(true);
  });
  it('보조금: 수락하고 그 노선을 운항하면 매달 받는다', () => {
    const g = sb(); g.state.subsidies = [{ id: 1, a: 'ICN', b: 'CJU', perMonth: 2, months: 24, expires: g.monthsPassed + 2 }];
    expect(g.acceptSubsidy(1).ok).toBe(true); route(g, 'ICN', 'CJU'); g.advanceDays(60);
    expect(g.state.subsidies![0].left).toBeLessThan(24);
  });
  it('운수권 할인: 기간 동안 반값', () => {
    const g = new Game(3, undefined, { sandbox: true, rights: true }); const region = Object.keys(config.rights.regions).find((r) => !g.state.rights!.includes(r))!;
    const p = g.rightsPrice(region); g.state.rightsSale = { region, until: g.monthsPassed + 3 }; expect(g.rightsPrice(region)).toBe(Math.round(p * 0.5));
  });
  it('경쟁사 대사: 동맹에 들어오면 대표가 한마디', () => {
    const g = sb(); const c = g.state.competitors.find((x) => !x.major)!; g.joinAlliance(c.id);
    expect(g.state.log.some((l) => l.includes(`${c.name} ${g.ceoOf(c)} 대표`))).toBe(true);
  });
  it('위기 사건은 5년차 전에는 생기지 않는다', async () => {
    const { EVENTS } = await import('../src/data'); expect(EVENTS.filter((e) => e.minMonth).map((e) => e.id).sort()).toEqual(['oilshock', 'pandemic', 'probe']);
  });
});

describe('플레이 감각: 도전 조건·자동 처리·추천 노선', () => {
  it('도전 조건대로 시작한다(빚·경쟁사 6곳·평판·작은 기종)', () => {
    const g = new Game(3, undefined, { sandbox: true, challenges: ['debt', 'crowded', 'lowrep', 'small'] }), b = new Game(3, undefined, { sandbox: true });
    expect(g.state.loan).toBe(b.state.loan + 100); expect(g.state.competitors.length).toBe(6); expect(g.state.reputation).toBe(0.05);
    expect(g.state.cash).toBeCloseTo(b.state.cash / 2); expect(typeById(g.state.planes[0].type).seats).toBeLessThan(typeById(b.state.planes[0].type).seats);
    expect(new Game(3, undefined, { scenario: 'europe', challenges: ['debt'] }).state.challenges).toBeUndefined(); // 시나리오에는 적용하지 않는다
  });
  it('자동 처리: 켜 둔 것만 처리한다', () => {
    const g = sb(); g.state.contracts.push({ id: 77, kind: 'cities', title: '시험', goal: 2, progress: 0, limit: 6, status: 'offer', expires: g.monthsPassed + 3, startCities: 0, reward: { type: 'cash', value: 1, label: '$1M' } });
    expect(g.applyRules()).toEqual([]); g.setRule('contracts', true); expect(g.applyRules().length).toBe(1);
    expect(g.state.contracts.find((c) => c.id === 77)!.status).toBe('active');
  });
  it('추천 노선은 아직 안 연 노선이고, 열면 목록에서 빠진다', () => {
    const g = sb(); const r = g.recommendRoutes(3); expect(r.length).toBe(3);
    expect(g.openRoute(r[0].a, r[0].b).ok).toBe(true); expect(g.recommendRoutes(3).some((x) => (x.a === r[0].a && x.b === r[0].b) || (x.a === r[0].b && x.b === r[0].a))).toBe(false);
  });
});

describe('대형 항공사와의 장기 대결', () => {
  it('대형 항공사 등장 18개월 뒤 슬롯 쟁탈 이야기가 오고, 양보하면 본사 슬롯을 잃고 2년 뒤 다음 이야기가 예약된다', () => {
    const g = sb(); let guard = 0;
    while (!g.state.story?.id.startsWith('saga') && guard++ < 80) { if (g.state.story) g.chooseStory(g.storyDef()!.choices.length - 1); g.advanceDays(30); }
    expect(g.state.story?.id).toBe('saga1');
    const cap = g.slotCapacity(g.state.base); expect(g.chooseStory(1).ok).toBe(true);
    expect(g.slotCapacity(g.state.base)).toBe(cap - 4); expect(g.state.storyQueue?.some((q) => q.id === 'saga2')).toBe(true);
  });
  it('최후의 대결: 12개월 뒤 매출로 판정하고, 이기면 평판·상금·업적', async () => {
    const { achieved } = await import('../src/sim/achievements');
    const g = sb(); route(g, 'ICN', 'NRT'); g.advanceDays(30 * 12);
    const major = g.state.competitors.find((c) => c.major)!; expect(major).toBeDefined();
    g.state.duel = { start: g.monthsPassed, until: g.monthsPassed + 1 }; major.revHist = [0]; const rep = g.state.reputation, planes = major.planes;
    g.advanceDays(30); expect(g.state.duelWon).toBe(true); expect(g.state.reputation).toBeGreaterThan(rep); expect(major.planes).toBeLessThanOrEqual(planes);
    expect(achieved(g)).toContain('giant');
  });
});

describe('중요한 알림 표시', () => {
  it('진출 예고 같은 알림은 중요 표시가 붙고, 일반 알림은 붙지 않는다', () => {
    const g = sb(); const n0 = g.state.log.length; g.state.log.push('일반 알림');
    expect(g.isAlert(n0)).toBe(false);
    (g as unknown as { alert(t: string): void }).alert('중요'); expect(g.isAlert(n0 + 1)).toBe(true);
    const old = Game.fromJSON({ ...JSON.parse(JSON.stringify(g.toJSON())), alertsAt: undefined }); expect(old.isAlert(0)).toBeNull(); // 옛 저장은 화면이 낱말로 판단
  });
});

describe('화면 다듬기용 계산', () => {
  it('자체 기종 이름을 지으면 기종 이름이 바뀌고, 새 게임에서는 원래 이름으로', () => {
    const g = sb(); expect(g.nameOwnType('KX200', '하늘새').ok).toBe(false); g.state.ownTypes = ['KX200'];
    expect(g.nameOwnType('KX200', '하늘새').ok).toBe(true); expect(typeById('KX200').name).toBe('하늘새');
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON()))); expect(typeById('KX200').name).toBe('하늘새'); void back;
    sb(); expect(typeById('KX200').name).toBe('KX-200');
  });
  it('왕조 목표 진행값', () => {
    const g = sb(); expect(g.dynastyProgress('fleet')).toMatchObject({ v: 1, t: 100 }); expect(g.dynastyProgress('regions').t).toBe(Object.keys(config.rights.regions).length);
  });
});

describe('두 번째 대형 항공사', () => {
  it('자유 모드 6년차 뒤 퍼시픽 크라운이 나오고, 시나리오에는 없다', () => {
    const g = sb(); for (let i = 0; i < 75; i++) { if (g.state.story) g.chooseStory(g.storyDef()!.choices.length - 1); g.advanceDays(30); }
    expect(g.state.competitors.filter((c) => c.major).map((c) => c.name)).toEqual(['글로벌 스카이', '퍼시픽 크라운']);
    const sc = new Game(3, undefined, { scenario: 'europe' }); for (let i = 0; i < 26; i++) sc.advanceDays(30); expect(sc.state.competitors.filter((c) => c.major).length).toBeLessThanOrEqual(1);
  });
});

describe('조종사·보험·채권', () => {
  it('조종사가 모자라면 좌석 공급이 그만큼 줄고, 급구 채용으로 채운다', () => {
    const g = sb(); const { rid } = route(g, 'ICN', 'NRT'); g.advanceDays(30); expect(g.state.pilots).toBeGreaterThanOrEqual(g.pilotsNeed);
    const seats = g.routeDay(g.route(rid)!).seats; g.state.pilots = Math.floor(g.pilotsNeed / 2);
    expect(g.crewFactor).toBeCloseTo(g.state.pilots / g.pilotsNeed); expect(g.routeDay(g.route(rid)!).seats).toBeLessThan(seats);
    expect(g.rushHire().ok).toBe(true); expect(g.state.pilots).toBe(Math.floor(g.pilotsNeed / 2) + config.extra.crew.rushN);
  });
  it('보험은 사건 피해를 줄이고 매달 보험료를 낸다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); expect(g.insCut).toBe(0); expect(g.setInsurance(2).ok).toBe(true); expect(g.insCut).toBe(0.5); expect(g.insPremium).toBeGreaterThan(0);
  });
  it('채권: 등급별 한도 안에서 발행하고, 만기에 원금을 갚는다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); const c0 = g.state.cash; expect(g.issueBond(50).ok).toBe(true); expect(g.state.cash).toBe(c0 + 50);
    expect(g.issueBond(500).ok).toBe(false); // 한도 초과
    g.state.bonds![0].until = g.monthsPassed + 1; g.advanceDays(30); expect(g.state.bonds!.length).toBe(0);
  });
});

describe('기능 끄기·연말 백업', () => {
  it('끈 기능은 쓸 수 없고 조종사 제약도 없다', () => {
    const g = new Game(3, undefined, { sandbox: true, off: ['alliance', 'finance', 'crew', 'subsidiary'] }); g.state.cash = 5000;
    const c = g.state.competitors.find((x) => !x.major)!;
    expect(g.joinAlliance(c.id).ok).toBe(false); expect(g.buyStake(c.id, 0.2).ok).toBe(false); expect(g.issueBond(50).ok).toBe(false);
    g.advanceDays(30); expect(g.state.pilots).toBeUndefined(); expect(g.crewFactor).toBe(1);
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON()))); expect(back.on('alliance')).toBe(false); expect(back.on('saga')).toBe(true);
    expect(new Game(3, undefined, { scenario: 'europe', off: ['crew'] }).state.off).toBeUndefined(); // 시나리오에는 적용하지 않는다
  });
  it('연말 백업은 저장 칸과 따로 저장되고 불러온다', async () => {
    const { saveBackup, backupInfo, loadBackup, slotInfos } = await import('../src/ui/saves');
    const mem = new Map<string, string>(), st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as unknown as Storage;
    const g = sb(); g.advanceDays(30); expect(backupInfo(st)).toBeNull(); expect(saveBackup(g, st)).toBe(true);
    expect(backupInfo(st)!.summary).toContain('항공기'); expect(loadBackup(st)!.state.day).toBe(g.state.day); expect(slotInfos(st).every((x) => x.empty)).toBe(true);
  });
});
