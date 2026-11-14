import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { distanceKm } from '../src/sim/model';
import { cityById, typeById } from '../src/data';

const sb = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 5000; g.state.rights = undefined; return g; };
const route = (g: Game, a: string, b: string) => { const r = g.openRoute(a, b); if (!r.ok) throw new Error(r.error); const p = g.buyPlane('B737'); if (!p.ok) throw new Error(p.error); g.assign(p.planeId, r.routeId, 7); return { rid: r.routeId, pid: p.planeId }; };
const richHistory = (g: Game, rev: number) => { g.advanceDays(30); for (let i = 0; i < 12; i++) g.state.history.push({ ...g.state.history[0], month: 100 + i, revenue: rev }); };

describe('대형 사업 비용은 회사 규모에 따라', () => {
  it('최근 12개월 매출이 클수록 비싸지고, 착공 때 값이 고정된다', () => {
    const g = sb(), base = config.extra.mega.list.find((x) => x.id === 'academy')!.cost;
    expect(g.megaCost('academy')).toBe(base);
    richHistory(g, 50); // 연 매출 $600M → 4배
    expect(g.megaMult).toBe(4); expect(g.megaCost('academy')).toBe(base * 4);
    expect(g.startMega('academy').ok).toBe(true); expect(g.state.mega!.cost).toBe(base * 4);
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
});

describe('월말 처리 금액이 보고에서 빠지지 않는다', () => {
  it('대형 사업 납입(월말)이 다음 달 보고의 비용에 들어간다', () => {
    const g = sb(); route(g, 'ICN', 'NRT'); g.advanceDays(30); expect(g.startMega('academy').ok).toBe(true);
    const pay = g.state.mega!.cost! / 18; g.advanceDays(60);
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
    g.state.mega = { id: 'own_KX200', done: 35, cost: 36 }; g.advanceDays(30);
    expect(g.state.ownTypes).toContain('KX200'); expect(g.shopTypes().some((t) => t.id === 'KX200')).toBe(true); expect(g.buyPlane('KX200').ok).toBe(true);
    const c0 = g.state.cash, n = g.state.competitors.reduce((a, c) => a + c.planes, 0); (g as unknown as { lateStep(m: number): void }).lateStep(g.monthsPassed);
    expect(g.state.cash - c0).toBeCloseTo(Math.round(config.extra.royalty * n * 100) / 100);
  });
  it('허브 공항: 도시를 골라야 착공되고, 완공되면 슬롯 +30·착륙료 면제', () => {
    const g = sb(); expect(g.startMega('airport').ok).toBe(false);
    const cap = g.slotCapacity('PUS'); expect(g.startMega('airport', 'PUS').ok).toBe(true);
    g.state.mega!.done = 29; g.advanceDays(30); expect(g.state.myAirports).toContain('PUS'); expect(g.slotCapacity('PUS')).toBe(cap + 30);
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
    expect(g.state.log.some((l) => l.includes(`${c.name} 대표`))).toBe(true);
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
