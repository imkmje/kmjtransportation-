import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';
import { CITIES, typeById } from '../src/data';
import { baseSlots, bizDemandShare, cargoRate, rawCargoDemand } from '../src/sim/model';
import { cityById } from '../src/data';

const open = (g: Game, a: string, b: string, weekly?: number, plane = g.state.planes[0]) => {
  const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error);
  if (weekly) { const r = g.assign(plane.id, o.routeId, weekly); if (!r.ok) throw new Error(r.error); }
  return o.routeId;
};

describe('도시 확장', () => {
  it('도시 41개: 모두 유효한 좌표·활주로·규모, 시작 도시 서울 하나', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(30);
    for (const c of CITIES) { expect(Math.abs(c.lat)).toBeLessThanOrEqual(90); expect(Math.abs(c.lon)).toBeLessThanOrEqual(180); expect(c.runway).toBeGreaterThanOrEqual(3000); expect(c.pop).toBeGreaterThan(0); }
    expect(CITIES.filter((c) => c.base).length).toBe(1);
  });
});

describe('공항 슬롯·허브', () => {
  it('배정은 두 공항의 슬롯 한도 안에서만 되고, 슬롯을 사면 늘어난다', () => {
    const g = new Game(1); g.state.cash = 500;
    const cap = g.slotCapacity('CJU'); // 제주(시장 12×1.0 → 6+0.35×12 = 10)
    expect(cap).toBe(baseSlots(cityById('CJU')));
    const ids = Array.from({ length: 4 }, () => { const r = g.buyPlane('B737'); if (!r.ok) throw new Error(r.error); return r.planeId; });
    const rt = g.openRoute('ICN', 'CJU'); if (!rt.ok) throw new Error();
    g.assign(g.state.planes[0].id, rt.routeId, 21); // 하루 6편 → 제주 6.0/10
    const over = g.assign(ids[0], rt.routeId, 21); // 6 + 6 = 12 > 10
    expect(over.ok).toBe(false); if (!over.ok) expect(over.error).toContain('슬롯이 모자랍니다');
    expect(g.slotsUsed('CJU')).toBeCloseTo(6, 6);
    const before = g.state.cash;
    expect(g.buySlot('CJU').ok).toBe(true); expect(g.buySlot('CJU').ok).toBe(true);
    expect(g.slotCapacity('CJU')).toBe(cap + 2); expect(g.state.cash).toBeLessThan(before);
    expect(g.assign(ids[0], rt.routeId, 21).ok).toBe(true);
    expect(g.fixedMonthly).toBeCloseTo(config.cost.fixedMonthly + config.cost.perPlaneMonthly * 5 + config.slot.lease * 2, 9);
  });
  it('같은 노선의 횟수를 바꿀 때는 자기 사용분이 중복으로 세어지지 않는다', () => {
    const g = new Game(1); const r = open(g, 'ICN', 'CJU', 12);
    expect(g.assign(g.state.planes[0].id, r, 21).ok).toBe(true);
    expect(g.slotsUsed('ICN')).toBeCloseTo(6, 6);
  });
  it('허브: 한 도시에 노선이 여러 개면 그 노선들의 수요가 늘어난다', () => {
    const g = new Game(1); g.state.cash = 500;
    const b = g.buyPlane('B737'); if (!b.ok) throw new Error();
    const r1 = open(g, 'ICN', 'CJU', 10); const solo = g.routeDay(g.route(r1)!).demand;
    const r2 = open(g, 'ICN', 'NRT', 8, g.plane(b.planeId)!);
    expect(g.hubBonus('ICN')).toBeCloseTo(config.hub.perLink, 9);
    expect(g.routeDay(g.route(r1)!).demand).toBeGreaterThan(solo);
    expect(r2).toBeGreaterThan(0);
  });
});

describe('노선별 일일 기록', () => {
  it('하루마다 기록이 쌓이고 최근 60일만 남는다', () => {
    const g = new Game(1); const r = open(g, 'ICN', 'CJU', 20);
    g.advanceDays(10);
    expect(g.route(r)!.daily.length).toBe(10);
    g.advanceDays(70);
    expect(g.route(r)!.daily.length).toBe(60);
    const d = g.route(r)!.daily.at(-1)!; expect(d.pax).toBeGreaterThan(0); expect(d.seats).toBeGreaterThanOrEqual(d.pax);
  });
});

describe('좌석 등급', () => {
  it('비즈니스석 비율을 바꾸면 일반석이 줄고 비즈니스석이 생긴다(면적 환산), 화물기는 불가', () => {
    const g = new Game(1); const r = open(g, 'ICN', 'JFK', 1, (() => { g.state.cash = 400; const p = g.buyPlane('A350'); if (!p.ok) throw new Error(); return g.plane(p.planeId)!; })());
    const rt = g.route(r)!; const before = g.routeDay(rt);
    expect(before.seatsB).toBe(0);
    const p = g.planesOn(r)[0];
    expect(g.setCabin(p.id, 0.2).ok).toBe(true);
    const after = g.routeDay(rt);
    expect(after.seatsB).toBeGreaterThan(0); expect(after.seatsE).toBeLessThan(before.seatsE);
    expect(after.seatsB).toBeCloseTo((300 * 0.2) / config.cabin.bizSeatArea * ((p.weekly * 2) / 7), 6);
    expect(g.setCabin(p.id, 0.15)).toEqual({ ok: false, error: '지원하지 않는 비율입니다' });
    g.state.cash = 400; const f = g.buyPlane('F77'); if (!f.ok) throw new Error();
    expect(g.setCabin(f.planeId, 0.1)).toEqual({ ok: false, error: '화물기에는 좌석이 없습니다' });
  });
  it('비즈니스 승객 비율은 소득이 높고 먼 노선에서 더 크다', () => {
    expect(bizDemandShare(cityById('ICN'), cityById('JFK'))).toBeGreaterThan(bizDemandShare(cityById('ICN'), cityById('CJU')));
    const g = new Game(1); const r = open(g, 'ICN', 'CJU', 20); const rt = g.route(r)!; g.setCabin(g.state.planes[0].id, 0.3);
    const d = g.routeDay(rt); expect(d.paxB).toBeLessThanOrEqual(d.seatsB + 1e-9); expect(d.paxB + d.paxE).toBeCloseTo(d.pax, 9);
    g.setFareBiz(r, 1e9); expect(rt.fareBiz).toBe(Math.round(g.routeBaseFareBiz(rt) * config.fare.maxRatio));
  });
});

describe('화물', () => {
  it('화물 적재량과 수요에 따라 화물 수익이 생기고, 화물기는 좌석 없이 화물만 싣는다', () => {
    const g = new Game(1); g.state.cash = 400;
    const f = g.buyPlane('F77'); if (!f.ok) throw new Error();
    const r = open(g, 'ICN', 'NRT', 10, g.plane(f.planeId)!); const d = g.routeDay(g.route(r)!);
    expect(d.pax).toBe(0); expect(d.seats).toBe(0);
    expect(d.cargoCap).toBeGreaterThan(0); expect(d.cargoT).toBeGreaterThan(0);
    expect(d.cargoRevenue).toBeGreaterThan(0); expect(d.revenue).toBeCloseTo(d.cargoRevenue, 9);
    expect(typeById('F77').cargo).toBe(100);
    expect(cargoRate(1000)).toBeCloseTo(config.cargo.base + config.cargo.perKm * 1000, 9);
    expect(rawCargoDemand(cityById('ICN'), cityById('NRT'))).toBeGreaterThan(rawCargoDemand(cityById('ICN'), cityById('JFK')));
  });
  it('화물 운임이 높으면 수요가 줄고 범위로 제한된다', () => {
    const g = new Game(1); g.state.cash = 400; const f = g.buyPlane('F77'); if (!f.ok) throw new Error();
    const r = open(g, 'ICN', 'NRT', 10, g.plane(f.planeId)!), rt = g.route(r)!;
    const lo = g.routeDay(rt).cargoDemand; g.setCargoRatio(r, 1.6); expect(g.routeDay(rt).cargoDemand).toBeLessThan(lo);
    g.setCargoRatio(r, 99); expect(rt.cargoRatio).toBe(config.fare.maxRatio);
  });
});

describe('경쟁사', () => {
  it('경쟁사가 시간이 지나며 항공기와 노선을 늘리고, 같은 노선이면 우리 수요가 줄어든다', () => {
    const g = new Game(1); g.advanceDays(30 * 14);
    const comps = g.state.competitors;
    expect(comps.length).toBeGreaterThanOrEqual(1); expect(comps.length).toBeLessThanOrEqual(config.competitors.max); expect(comps.filter((c) => !(c.born ?? 0)).every((c) => c.planes > 0 && c.routes.length > 0)).toBe(true); // 막 생긴 신생 항공사는 제외
    // 경쟁사 노선을 우리도 연다 → 점유율 < 1
    const c = comps[0], cr = c.routes[0]; const g2 = new Game(1); g2.state.competitors = JSON.parse(JSON.stringify(comps));
    const rid = open(g2, cr.a, cr.b); // 같은 도시 쌍
    expect(g2.competitorsOn(cr.a, cr.b).length).toBeGreaterThan(0);
    const noService = g2.routeDay(g2.route(rid)!).share; expect(noService).toBe(1); // 항공기가 없으면 점유율 계산 안 함
  });
  it('경쟁이 있는 노선은 같은 조건에서 우리 수요·탑승객이 독점일 때보다 적다', () => {
    const a = new Game(1), b = new Game(1);
    const ra = open(a, 'ICN', 'PUS', 14); const rb = open(b, 'ICN', 'PUS', 14);
    b.state.competitors[0].routes.push({ a: 'ICN', b: 'PUS', seatsDay: 600, fareRatio: 0.85 });
    expect(b.routeDay(b.route(rb)!).demand).toBeLessThan(a.routeDay(a.route(ra)!).demand);
    expect(b.routeDay(b.route(rb)!).share).toBeLessThan(1);
    expect(b.marketShare).toBeLessThan(1);
  });
  it('경쟁사 진행은 결정론적이다', () => {
    const a = new Game(3), b = new Game(3); a.advanceDays(30 * 10); b.advanceDays(30 * 10);
    expect(JSON.stringify(a.state.competitors)).toBe(JSON.stringify(b.state.competitors));
  });
});

describe('도시 성장', () => {
  it('취항하는 도시는 시장이 자라고, 취항하지 않는 도시는 1로 돌아간다', () => {
    const g = new Game(1); open(g, 'ICN', 'CJU', 20);
    g.advanceDays(30 * 12);
    expect(g.growthOf('ICN')).toBeGreaterThan(1.02); expect(g.growthOf('CJU')).toBeGreaterThan(1.02);
    expect(g.growthOf('SYD')).toBeCloseTo(1, 6);
    expect(g.growthOf('ICN')).toBeLessThanOrEqual(config.growth.max);
  });
  it('성장한 도시는 수요가 더 크다', () => {
    const g = new Game(1); const r = open(g, 'ICN', 'CJU', 20); const rt = g.route(r)!; const d0 = g.routeDay(rt).demand;
    g.state.growth['ICN'] = 1.3; expect(g.routeDay(rt).demand).toBeGreaterThan(d0);
  });
});

describe('저장 형식 3', () => {
  it('형식 2 파일을 읽으면 슬롯·성장 없음, 경쟁사 초기화, 일반석 기본으로 변환되고 이어서 실행된다', () => {
    const g = new Game(4); open(g, 'ICN', 'CJU', 20); g.advanceDays(40);
    const v2 = JSON.parse(JSON.stringify(g.toJSON())); v2.formatVersion = 2;
    delete v2.slots; delete v2.growth; delete v2.competitors; for (const p of v2.planes) delete p.bizShare; for (const r of v2.routes) { delete r.fareBiz; delete r.cargoRatio; delete r.daily; } for (const h of v2.history) delete h.cargo;
    const back = Game.fromJSON(v2);
    expect(back.state.formatVersion).toBe(12); expect(back.state.competitors.length).toBe(config.competitors.start); expect(back.state.planes[0].bizShare).toBe(0);
    expect(back.state.routes[0].cargoRatio).toBe(1); expect(back.state.routes[0].fareBiz).toBeGreaterThan(0);
    back.advanceDays(60); expect(back.state.status).toBe('playing');
  });
  it('저장·불러오기 후 이어서 실행한 결과가 끊김 없이 실행한 결과와 같다(경쟁사·성장 포함)', () => {
    const g = new Game(7); open(g, 'ICN', 'CJU', 20); g.advanceDays(100);
    const loaded = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    g.advanceDays(300); loaded.advanceDays(300);
    expect(JSON.stringify(loaded.toJSON())).toBe(JSON.stringify(g.toJSON()));
  });
});

describe('경기 변동·사건 강화·경쟁사 가격 반응', () => {
  it('경기 지수는 범위 안에서 움직이고, 호황이면 수요가 늘고 비즈니스가 더 크게 반응한다(결정론)', () => {
    const a = new Game(2), b = new Game(2); a.advanceDays(30 * 24); b.advanceDays(30 * 24);
    expect(a.state.economy).toBe(b.state.economy);
    expect(a.state.economy).toBeGreaterThanOrEqual(config.economy.min); expect(a.state.economy).toBeLessThanOrEqual(config.economy.max);
    const g = new Game(1); const r = open(g, 'ICN', 'JFK', 1, (() => { g.state.cash = 400; const p = g.buyPlane('A350'); if (!p.ok) throw new Error(); g.setCabin(p.planeId, 0.2); return g.plane(p.planeId)!; })()); const rt = g.route(r)!;
    const base = g.routeDay(rt); g.state.economy = 1.2; const boom = g.routeDay(rt);
    expect(boom.demandE / base.demandE).toBeCloseTo(1.2, 6);
    expect(boom.demandB / base.demandB).toBeCloseTo(1.2 ** config.economy.bizPow, 6);
    g.state.economy = 0.8; expect(g.routeDay(rt).demandE).toBeLessThan(base.demandE);
    expect(g.economyLabel).toBe('불황');
  });
  it('새 사건: 감염병은 수요를 크게 줄이고, 파업은 운영비·운항에 영향, 엔진 결함은 그 항공기만 멈춘다(대응하면 절반)', () => {
    const g = new Game(1); const r = open(g, 'ICN', 'CJU', 20); const rt = g.route(r)!; const p = g.state.planes[0];
    const base = g.routeDay(rt);
    g.state.events.push({ def: 'pandemic', monthsLeft: 4 });
    expect(g.routeDay(rt).demandE).toBeCloseTo(base.demandE * 0.65, 6);
    g.state.events.length = 0;
    g.state.events.push({ def: 'strike', monthsLeft: 2 });
    const st = g.routeDay(rt); expect(st.seats).toBeCloseTo(base.seats * 0.8, 6); expect(st.cost).toBeGreaterThan(base.cost * 0.79);
    g.state.events.length = 0;
    g.state.events.push({ def: 'engine', monthsLeft: 2, planeId: p.id });
    expect(g.routeDay(rt).seats).toBe(0);
    expect(g.respondEvent(0).ok).toBe(true); expect(g.routeDay(rt).seats).toBeCloseTo(base.seats * 0.5, 6);
    g.sellPlane(p.id); expect(g.state.events.length).toBe(0); // 팔면 그 사건은 사라진다
  });
  it('담보 가치가 떨어져 대출 한도를 넘으면 은행이 초과분을 회수한다(현금이 모자라면 파산 위험)', () => {
    const g = new Game(1); g.borrow(g.loanLimit - 0.01);
    g.state.planes[0].book = 0; // 담보 가치 급락
    g.advanceDays(30);
    expect(g.state.loan).toBeCloseTo(g.loanLimit, 6); // 한도(기본 20)까지 줄었다
    expect(g.state.log.some((l) => l.includes('회수'))).toBe(true);
  });
  it('경쟁사 가격 반응: 우리가 더 싸게 팔면 경쟁사가 따라 내리고(바닥까지), 그렇지 않으면 목표 가격으로 돌아간다', () => {
    const chance = config.war.chance; config.war.chance = 0; // 운임 전쟁(무작위)은 이 검사에서 끈다
    const g = new Game(1); const r = open(g, 'ICN', 'PUS', 14);
    g.state.competitors[0].routes.push({ a: 'ICN', b: 'PUS', seatsDay: 300, fareRatio: 1.0 });
    g.setFare(r, g.routeBaseFare(g.route(r)!) * 0.6); // 크게 인하
    for (let i = 0; i < 9; i++) { g.advanceDays(30); if (g.state.status !== 'playing') break; }
    expect(g.state.competitors[0].routes[0].fareRatio).toBeCloseTo(config.rival.lowFloor, 6);
    g.setFare(r, g.routeBaseFare(g.route(r)!) * 1.5);
    for (let i = 0; i < 6; i++) g.advanceDays(30);
    expect(g.state.competitors[0].routes[0].fareRatio).toBeCloseTo(config.rival.lowTarget, 6);
    config.war.chance = chance;
  });
});
