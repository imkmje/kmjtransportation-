import { describe, it, expect } from 'vitest';
import { config } from '../src/config';
import { CITIES, cityById } from '../src/data';
import { Game } from '../src/sim/game';
import { advise } from '../src/sim/advice';
import { achieved } from '../src/sim/achievements';

const gated = (base = 'ICN', seed = 3) => new Game(seed, undefined, { sandbox: true, rights: true, base });
const regions = Object.keys(config.rights.regions);

describe('지역 운수권', () => {
  it('데이터: 모든 도시가 8개 지역 중 하나에 속하고, 지역마다 도시가 있다', () => {
    expect(regions.length).toBe(8);
    for (const c of CITIES) expect(regions).toContain(c.region);
    for (const r of regions) expect(CITIES.filter((c) => c.region === r).length).toBeGreaterThanOrEqual(2);
    expect(CITIES.filter((c) => c.region === 'EA').map((c) => c.id).sort()).toEqual(['CJU', 'HKG', 'ICN', 'KIX', 'NRT', 'PEK', 'PUS', 'PVG', 'TPE']);
  });
  it('기본은 제한 없음(시나리오·옛 저장), 켜면 출발 도시의 지역(작은 지역이면 이웃 지역까지)만 열려 있다', () => {
    const free = new Game(3, undefined, { sandbox: true }); expect(free.rightsOn).toBe(false); expect(free.cityOpen('JFK')).toBe(true); expect(free.openRoute('ICN', 'JFK').ok).toBe(true);
    const sc = new Game(3, undefined, { scenario: 'europe', rights: true }); expect(sc.rightsOn).toBe(false); // 시나리오는 제한하지 않는다
    const g = gated(); expect(g.rightsOn).toBe(true); expect(g.state.rights).toEqual(['EA']);
    expect(g.cityOpen('NRT')).toBe(true); expect(g.cityOpen('BKK')).toBe(false);
    expect(new Game(3, undefined, { sandbox: true, rights: true, base: 'FRA' }).state.rights).toEqual(['EU', 'SAME']); // 유럽은 5곳이라 가장 가까운 지역(이스탄불이 있는 남아시아·중동)도 연다
  });
  it('열린 지역 사이에서만 노선을 열 수 있고, 거절 이유에 지역 이름이 있다', () => {
    const g = gated();
    expect(g.openRoute('ICN', 'NRT').ok).toBe(true);
    const r = g.openRoute('ICN', 'BKK'); expect(r.ok).toBe(false); if (!r.ok) { expect(r.error).toContain('운수권'); expect(r.error).toContain('동남아시아'); }
    expect(g.openRoute('LHR', 'ICN').ok).toBe(false); expect(g.openRoute('LHR', 'JFK').ok).toBe(false);
    expect(g.state.routes.length).toBe(1);
  });
  it('가격은 이미 가진 지역과 가까울수록 싸고, 사면 가까운 지역이 더 싸진다', () => {
    const g = gated();
    expect(g.rightsPrice('SEA')).toBe(6); // 홍콩–마닐라 등 2,500km 안
    expect(g.rightsPrice('EU')).toBe(10); expect(g.rightsPrice('NA')).toBe(16); expect(g.rightsPrice('OC')).toBe(16); expect(g.rightsPrice('LA')).toBe(24);
    g.state.rights!.push('NA'); expect(g.rightsPrice('LA')).toBe(6); // 북미를 사면 중남미(LAX–멕시코시티 약 2,500km 안)가 가까워진다
  });
  it('구매: 누적 이익과 현금이 모두 필요하고, 사면 노선을 열 수 있으며 중복 구매·없는 지역은 거절', () => {
    const g = gated(); g.state.cash = 100;
    expect(g.rightsNeed).toBe(config.rights.need[0]);
    const poor = g.buyRights('SEA'); expect(poor.ok).toBe(false); if (!poor.ok) expect(poor.error).toContain('누적 이익');
    g.state.cumProfit = 5; g.state.cash = 3; const broke = g.buyRights('SEA'); expect(broke.ok).toBe(false); if (!broke.ok) expect(broke.error).toContain('현금');
    g.state.cash = 100;
    expect(g.buyRights('SEA').ok).toBe(true); expect(g.state.cash).toBe(94); expect(g.state.rights).toEqual(['EA', 'SEA']);
    expect(g.openRoute('ICN', 'BKK').ok).toBe(true); expect(g.openRoute('BKK', 'SIN').ok).toBe(true);
    expect(g.buyRights('SEA').ok).toBe(false); expect(g.buyRights('없는지역').ok).toBe(false);
    expect(g.rightsNeed).toBe(config.rights.need[1]); // 다음에는 더 많은 누적 이익이 필요
    expect(g.buyRights('EU').ok).toBe(false);
    expect(new Game(3, undefined, { sandbox: true }).buyRights('EU').ok).toBe(false); // 제한이 없는 게임
  });
  it('저장·불러오기 후에도 운수권이 유지되고, 운수권이 없는 옛 저장은 제한 없음으로 읽는다', () => {
    const g = gated(); g.state.cumProfit = 50; g.state.cash = 100; g.buyRights('SEA');
    const back = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON()))); expect(back.state.rights).toEqual(['EA', 'SEA']); expect(back.cityOpen('BKK')).toBe(true); expect(back.cityOpen('JFK')).toBe(false);
    const old = new Game(3, undefined, { sandbox: true }).toJSON() as unknown as Record<string, unknown>; delete old.rights;
    expect(Game.fromJSON(old).rightsOn).toBe(false);
  });
  it('조언·업적: 살 수 있는 지역이 있으면 알려 주고, 모든 지역을 사면 업적', () => {
    const g = gated(); g.state.cash = 100; g.state.cumProfit = 10;
    for (const [a, b] of [['ICN', 'NRT'], ['ICN', 'PEK']]) { const o = g.openRoute(a, b); if (!o.ok) throw new Error(o.error); const bp = g.buyForRoute(o.routeId, 'T72', 'new'); if (!bp.ok) throw new Error(bp.error); }
    g.state.cash = 100; expect(advise(g).some((a) => a.text.includes('운수권') && a.text.includes('살 수 있습니다'))).toBe(true);
    expect(achieved(g)).not.toContain('regions');
    g.state.rights = [...regions]; expect(achieved(g)).toContain('regions');
  });
  it('경쟁사와 비행 규칙은 운수권과 무관하다(기존 노선은 그대로 운항)', () => {
    const g = gated(); g.state.cash = 999; const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error(o.error);
    expect(g.buyForRoute(o.routeId, 'B737', 'new').ok).toBe(true);
    g.advanceDays(30 * 3); expect(g.state.history.length).toBe(3); expect(g.state.competitors.length).toBeGreaterThan(0);
    expect(cityById('ICN').region).toBe('EA');
  });
  it('도시가 적은 지역에서 시작하면 가장 가까운 지역도 처음부터 열리고, 다음 지역 기준은 산 지역부터 센다', () => {
    expect(Game.startRegions('ICN')).toEqual(['EA']); // 동아시아 9곳은 넉넉하다
    expect(Game.startRegions('SIN')).toEqual(['SEA', 'EA']); expect(Game.startRegions('SGN')).toEqual(['SEA', 'EA']);
    for (const c of CITIES) expect(Game.startRegions(c.id).map((r) => CITIES.filter((x) => x.region === r).length).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(7);
    const g = gated('SIN'); expect(g.state.rights).toEqual(['SEA', 'EA']); expect(g.cityOpen('ICN')).toBe(true); expect(g.rightsNeed).toBe(config.rights.need[0]);
    const old = gated('SGN'); old.state.rights = ['SEA']; const re = new Game(1, JSON.parse(JSON.stringify(old.state))); // 옛 저장: 동남아만 있던 게임
    expect(re.state.rights).toEqual(['SEA', 'EA']); expect(re.rightsNeed).toBe(config.rights.need[0]);
  });
  it('자유 모드 시작 기체는 출발 지역에 맞춘다(아프리카 A321N, 오세아니아 A330N, 그 밖은 기본)', () => {
    const t = (base: string) => new Game(3, undefined, { sandbox: true, rights: true, base }).state.planes[0].type;
    expect(t('JNB')).toBe('A321N'); expect(t('SYD')).toBe('A330N'); expect(t('ICN')).toBe('B737'); expect(t('SIN')).toBe('B737');
    expect(new Game(3, undefined, { scenario: 'europe' }).state.planes[0].type).not.toBe('A330N'); // 시나리오는 그대로
  });
});
