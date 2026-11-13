import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { config } from '../src/config';

const sandbox = () => { const g = new Game(3, undefined, { sandbox: true }); g.state.cash = 2000; return g; };

describe('노선 월 추이', () => {
  it('매달 노선별 월 이익과 평균 점유율을 최근 12개월까지 남긴다', () => {
    const g = sandbox(); const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error('open'); g.buyForRoute(o.routeId, 'A220', 'new');
    g.advanceDays(30 * 14 + 1); const m = g.route(o.routeId)!.monthly!;
    expect(m.length).toBe(12); for (const x of m) { expect(Number.isFinite(x.p)).toBe(true); expect(x.s).toBeGreaterThan(0); expect(x.s).toBeLessThanOrEqual(1); }
  });
});

describe('교체 추천', () => {
  it('낡은 기체를 새 기종으로 바꾸면 이득인 경우를 회수 개월 순으로 알려 주고, 교체하면 같은 노선에 들어간다', () => {
    const g = sandbox(); const o = g.openRoute('ICN', 'NRT'); if (!o.ok) throw new Error('open');
    const b = g.buyForRoute(o.routeId, 'T72', 'new'); if (!b.ok) throw new Error('buy'); const p = g.plane(b.planeId)!; p.age = 240; p.cond = 0.5; g.setPlaneName(p.id, '하늘1호');
    const opts = g.replaceOptions(p.id); expect(opts.length).toBeGreaterThan(0);
    for (let i = 1; i < opts.length; i++) expect(opts[i - 1].payback!).toBeLessThanOrEqual(opts[i].payback!);
    expect(opts.every((x) => typeof x.cost === 'number' && x.gain > 0)).toBe(true);
    const n0 = g.state.planes.length, c0 = g.state.cash, best = opts[0];
    const r = g.replacePlane(p.id, best.type); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(g.state.planes.length).toBe(n0); expect(g.plane(p.id)).toBeUndefined();
    const np = g.plane(r.planeId)!; expect(np.type).toBe(best.type); expect(np.routeId).toBe(o.routeId); expect(np.name).toBe('하늘1호');
    expect(g.state.cash).toBeCloseTo(c0 - best.cost, 0);
  });
  it('화물기는 화물기끼리만, 대기 중이면 추천 없음', () => {
    const g = sandbox(); const idle = g.buyPlane('B737'); if (!idle.ok) throw new Error('buy'); expect(g.replaceOptions(idle.planeId)).toEqual([]);
  });
});

describe('이름·도색', () => {
  it('항공기 이름은 12자까지, 도색은 정해진 색만', () => {
    const g = sandbox(); const p = g.state.planes[0];
    g.setPlaneName(p.id, '아주아주아주아주긴이름입니다'); expect(p.name!.length).toBe(12); g.setPlaneName(p.id, ''); expect(p.name).toBeUndefined();
    expect(g.setLivery(config.livery[2]).ok).toBe(true); expect(g.state.livery).toBe(config.livery[2]); expect(g.setLivery('#123456').ok).toBe(false);
  });
});
