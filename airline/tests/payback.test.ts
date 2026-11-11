import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { fillFare } from '../src/sim/strategies';

/**
 * 투자 회수 측정(정책과 무관): 같은 상태를 둘로 나눠 한쪽에서만 기능을 사 두고 24개월을 그냥 두었을 때(자동 운임·자동 정비 켬),
 * 사지 않은 쪽보다 현금이 가격을 빼고도 얼마나 더 늘었는가를 본다. 자동 전략은 돈을 바닥까지 쓰는 습성이 있어 기능 하나의 효과를 가리기 어려워 이 방식으로 쟀다.
 * 상태: 서울 허브에 장거리 대형기(비즈니스 20%) 4대 + 근거리 중형기 2대, 서울 슬롯이 거의 가득 찬 "수요와 슬롯이 모자란 허브".
 */
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const clone = (g: Game) => Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
const hubState = (seed: number) => {
  const g = new Game(seed, undefined, { sandbox: true }); g.state.cash = 900;
  for (const d of ['LAX', 'LHR', 'SIN', 'DXB']) { const o = g.openRoute('ICN', d); if (!o.ok) continue; const b = g.buyForRoute(o.routeId, 'A350', 'new'); if (b.ok) { g.setCabin(b.planeId, 0.2); fillFare(g, o.routeId); } }
  const o2 = g.openRoute('ICN', 'NRT'); if (o2.ok) for (let i = 0; i < 2; i++) { const b = g.buyForRoute(o2.routeId, 'B737', 'new'); if (b.ok) fillFare(g, o2.routeId); }
  g.advanceDays(30 * 6); return g;
};
const FEATURES: [string, (c: Game) => number][] = [
  ...['marketing', 'ops', 'service', 'ground', 'hangar'].map((u): [string, (c: Game) => number] => [`업그레이드 ${u} 1단계`, (c) => { const p = c.upgradePrice(u)!; c.buyUpgrade(u); return p; }]),
  ...(['terminal', 'mro', 'lounge'] as const).map((k): [string, (c: Game) => number] => [`허브 ${k} 1단계(서울)`, (c) => { const p = c.hubPrice('ICN', k)!; c.buyHub('ICN', k); return p; }]),
];

describe('기능 투자 회수(서울 허브 상태, 시드 8개, 24개월)', () => {
  it('각 기능은 "쓸 만한 상황"에서 가격을 3~40개월 안에 회수한다(너무 약하지도, 너무 세지도 않다)', () => {
    const states = [1, 2, 3, 4, 5, 6, 7, 8].map(hubState), lines: string[] = [];
    for (const [name, buy] of FEATURES) {
      const rs = states.map((g) => { const a = clone(g), b = clone(g); a.state.cash += 800; b.state.cash += 800; a.state.autoFare = b.state.autoFare = true; a.state.autoMaint = b.state.autoMaint = true; const price = buy(b); a.advanceDays(30 * 24); b.advanceDays(30 * 24); return { price, gain: b.state.cash + price - a.state.cash }; });
      const price = med(rs.map((r) => r.price)), gain = med(rs.map((r) => r.gain)), payback = gain > 0 ? price / (gain / 24) : Infinity;
      lines.push(`${name.padEnd(22)} 가격 ${price.toFixed(0).padStart(3)} · 24개월 이득 ${gain.toFixed(1).padStart(6)} · 회수 ${Number.isFinite(payback) ? payback.toFixed(0) : '∞'}개월`);
      expect(payback, `${name}: 회수 ${payback}개월(너무 약하다)`).toBeLessThanOrEqual(40);
      expect(payback, `${name}: 회수 ${payback}개월(너무 세다)`).toBeGreaterThanOrEqual(3);
    }
    console.log('PAYBACK\n' + lines.join('\n'));
  }, 600_000);
});
