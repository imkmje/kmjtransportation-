import { it, expect } from 'vitest';
import { Game } from '../src/sim/game';

// 화면 그리기·하루 정산에서 쓰는 재사용 계산(scoped)이 매번 새로 계산한 값과 같아야 한다
it('scoped 안에서도 노선 결과·추천·배정 변경이 그대로 반영된다', () => {
  const g = new Game(5, undefined, { sandbox: true }); g.state.cash = 9000; g.state.rights = undefined;
  const ids: number[] = [];
  for (const b of ['NRT', 'PEK', 'HKG', 'SIN', 'BKK']) { const o = g.openRoute('ICN', b); if (!o.ok) throw new Error(o.error); g.buyForRoute(o.routeId, 'B737', 'new'); ids.push(o.routeId); }
  g.advanceDays(40);
  const snap = () => ids.map((id) => { const r = g.route(id)!; const d = g.routeDay(r); return [d.revenue, d.cost, d.pax, g.transferDemand(r), g.routeOtp(r)]; });
  const plain = snap(), opts = g.routeOptions(ids[0]).map((x) => x.profit);
  g.scoped(() => {
    expect(snap()).toEqual(plain);
    expect(g.routeOptions(ids[0]).map((x) => x.profit)).toEqual(opts); // 잠깐 항공기를 넣어 보는 계산도 같아야 한다
    const p = g.planesOn(ids[1])[0]; g.unassign(p.id); expect(g.planesOn(ids[1]).length).toBe(0); // 배정을 바꾸면 바로 반영
    expect(g.routeDay(g.route(ids[1])!).seats).toBe(0);
  });
});
