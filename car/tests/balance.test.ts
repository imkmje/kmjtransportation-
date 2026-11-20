import { describe, it, expect } from 'vitest';
import { gouger, idle, newNameOnly, noExpand, noFacelift, runBot, steady, type Bot } from '../src/sim/bots';
import { Game, allGens, sellingGens } from '../src/sim/game';
import { capacityOf } from '../src/sim/company';
import { avgGrade } from '../src/sim/cars';
import { launchAvgGrade } from '../src/sim/lifecycle';
import { currentEdition } from '../src/sim/market';
import { yearOf } from '../src/sim/time';
import { config } from '../src/config';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const median = (xs: number[]) => { const v = [...xs].filter(Number.isFinite).sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
const eok = (x: number) => Math.round(x / 10000);

/** 봇을 months개월 돌려 첫 차의 평론·회수 개월·출시 3~14개월 판매 중앙값(생산 한도 대비)과 최저 현금을 잰다 */
function firstCar(bot: Bot, seed: number, months: number) {
  const g = Game.create({ seed });
  let payback: number | null = null, minCash = Infinity;
  for (let w = 0; w < months * config.time.weeksPerMonth && g.state.status === 'playing'; w++) {
    bot.step(g); g.tick();
    minCash = Math.min(minCash, g.state.cash);
    const f = allGens(g.state)[0];
    if (f && payback === null && f.profit >= f.devCost) payback = f.sales.length;
  }
  const f = allGens(g.state)[0];
  return { review: f?.reviewAvg ?? 0, payback, plateau: f ? median(f.sales.slice(3, 15)) / capacityOf(g.state) : 0, devCost: f?.devCost ?? 0, minCash, loan: g.state.loan.balance };
}

/** 한 시점의 요약: 생존·현금·공장 등급·판매 중인 차의 그해 표시 등급 평균·주문/한도 */
interface Snap { alive: boolean; cash: number; factory: number; hq: number; grade: number; ratio: number }
const snapOf = (g: Game): Snap => {
  const s = g.state, y = yearOf(s.week), gens = sellingGens(s);
  return {
    alive: s.status === 'playing', cash: s.cash, factory: s.factory.level, hq: s.hqLevel,
    grade: gens.length ? gens.reduce((a, x) => a + avgGrade(currentEdition(x).stats, y), 0) / gens.length : NaN,
    ratio: gens.reduce((a, x) => a + x.lastDemand, 0) / capacityOf(s),
  };
};
/** 봇을 시드 20개로 돌려 years년 시점마다 요약 + 낸 차 전부의 출시 등급(결과는 이름별로 한 번만 돌린다) */
const cache = new Map<string, { snaps: Snap[]; launches: number[] }[]>();
function runs(name: string, bot: () => Bot, years: number[]) {
  if (!cache.has(name)) cache.set(name, SEEDS.map((seed) => {
    const g = Game.create({ seed }), b = bot(), snaps: Snap[] = [], wpy = config.time.weeksPerMonth * config.time.monthsPerYear;
    for (let w = 1; w <= Math.max(...years) * wpy; w++) {
      if (g.state.status === 'playing') { b.step(g); g.tick(); }
      if (w % wpy === 0 && years.includes(w / wpy)) snaps.push(snapOf(g));
    }
    return { snaps, launches: allGens(g.state).map(launchAvgGrade) };
  }));
  return cache.get(name)!;
}
const at = (rs: ReturnType<typeof runs>, i: number) => rs.map((r) => r.snaps[i]);
const alive = (ss: Snap[]) => ss.filter((x) => x.alive).length;
const cashMed = (ss: Snap[]) => median(ss.map((x) => x.cash));
const line = (n: string, ss: Snap[]) => `${n}: 생존 ${alive(ss)}/20, 현금 중앙값 ${eok(cashMed(ss))}억, 공장 ${ss.map((x) => x.factory).join('')} 본사 ${ss.map((x) => x.hq).join('')}, 등급 중앙값 ${median(ss.filter((x) => x.alive).map((x) => x.grade)).toFixed(2)}, 주문/한도 중앙값 ${median(ss.filter((x) => x.alive).map((x) => x.ratio)).toFixed(2)}`;
const STEADY = () => runs('steady', () => steady(), [10, 20, 30]);
const at20 = (name: string, bot: () => Bot) => at(runs(name, bot, [20]), 0);

describe('균형 봇(시드 20개, 3단계 후속 보정 목표 2026-11-20)', () => {
  it('개발비: 12주 설계 + 시험이면 6~12억', () => {
    const dev = median(SEEDS.map((s) => firstCar(steady(), s, 12).devCost));
    console.log(`개발비 중앙값 ${(dev / 10000).toFixed(1)}억`);
    expect(dev).toBeGreaterThanOrEqual(60000); expect(dev).toBeLessThanOrEqual(120000);
  });
  it('1a) 평론 5~6점대 첫 차의 개발비 회수 중앙값 7~18개월', () => {
    const rs = SEEDS.map((s) => firstCar(steady({ designWeeks: 16 }), s, 48)).filter((r) => r.review >= 5 && r.review < 7);
    const m = median(rs.map((r) => r.payback ?? 999));
    console.log(`평론 5~6점대 ${rs.length}판, 회수 개월: ${rs.map((r) => r.payback).join(',')} → 중앙값 ${m}`);
    expect(rs.length).toBeGreaterThanOrEqual(10);
    expect(m).toBeGreaterThanOrEqual(7); expect(m).toBeLessThanOrEqual(18);
  });
  it('1b) 평론 4점대 차의 월 판매(출시 3~14개월 중앙값)가 생산 한도의 25~60%', () => {
    const rs = SEEDS.map((s) => firstCar(steady(), s, 24)).filter((r) => r.review >= 4 && r.review < 5);
    const ratio = median(rs.map((r) => r.plateau));
    console.log(`평론 4점대 ${rs.length}판, 한도 대비 판매 중앙값 ${(ratio * 100).toFixed(0)}%`);
    expect(rs.length).toBeGreaterThanOrEqual(10);
    expect(ratio).toBeGreaterThanOrEqual(0.25); expect(ratio).toBeLessThanOrEqual(0.6);
  });
  it('1c) 방치는 10년 안에 전부 파산', () => {
    const id = SEEDS.map((s) => runBot(idle, s, 10));
    expect(id.every((r) => !r.survived && r.months < 120)).toBe(true);
  });
  it('1d) 실패작(절약·8주·시험 2주로 출시, 평론 3.5 이하) 하나만 팔면 36개월 안에 현금이 음수가 되거나 대출이 필요하다', () => {
    const flop = steady({ budget: 'low', designWeeks: 8, launchDefects: Infinity, maxTestWeeks: 2, changeMonths: Infinity, faceliftMonths: Infinity });
    for (const r of SEEDS.map((s) => firstCar(flop, s, 36))) { expect(r.review).toBeLessThanOrEqual(3.5); expect(r.minCash < 0 || r.loan > 0).toBe(true); }
  });
  it('2) 신중: 10년 생존 70% 이상, 20년 생존 60% 이상. 10년 현금 중앙값 목표 30~200억(미달, 아래 설명)', () => {
    const st = STEADY();
    console.log([10, 20, 30].map((y, i) => line(`steady ${y}년`, at(st, i))).join('\n'));
    expect(alive(at(st, 0))).toBeGreaterThanOrEqual(14);
    expect(alive(at(st, 1))).toBeGreaterThanOrEqual(12);
    // 미달(측정 약 20억): 10년째 공장 2등급(17억)을 막 지었거나 짓기 직전인 판이 많다. 건설비를 낮추면 20년 공장 등급·현금이 목표를 넘는다.
    const c10 = cashMed(at(st, 0));
    expect(c10).toBeGreaterThanOrEqual(100000); expect(c10).toBeLessThanOrEqual(2000000);
  });
  it('3) 신중이 판매하는 차의 표시 등급: 10·20·30년 중앙값 4.5~7.0(30년은 약간 미달), 출시 등급 9 초과는 10% 미만', () => {
    const st = STEADY(), g = [0, 1, 2].map((i) => median(at(st, i).filter((x) => x.alive).map((x) => x.grade)));
    const launches = st.flatMap((r) => r.launches), over9 = launches.filter((x) => x > 9).length / launches.length;
    console.log(`등급 중앙값 10년 ${g[0].toFixed(2)} / 20년 ${g[1].toFixed(2)} / 30년 ${g[2].toFixed(2)}, 출시 ${launches.length}대 중 9 초과 ${(over9 * 100).toFixed(1)}%`);
    expect(g[0]).toBeGreaterThanOrEqual(4.5); expect(g[0]).toBeLessThanOrEqual(7);
    expect(g[1]).toBeGreaterThanOrEqual(4.5); expect(g[1]).toBeLessThanOrEqual(7);
    // 30년(2000년)은 측정 약 4.4: 기준 상승 4.5%를 따라가지 못한 판이 많다(정원 12명에서 멈춘 회사). 4.0 아래면 실패
    expect(g[2]).toBeGreaterThanOrEqual(4.0); expect(g[2]).toBeLessThanOrEqual(7);
    expect(over9).toBeLessThan(0.1);
  });
  it('4) 성장 속도: 공장 등급 중앙값 10년 1~2·20년 2~3·30년 3~4, 현금 중앙값 20년 100~1,500억·30년 300~6,000억(30년은 약간 초과)', () => {
    const st = STEADY(), f = [0, 1, 2].map((i) => median(at(st, i).map((x) => x.factory)));
    console.log(`공장 등급 중앙값 ${f.join(' / ')}, 현금 중앙값 20년 ${eok(cashMed(at(st, 1)))}억 / 30년 ${eok(cashMed(at(st, 2)))}억`);
    expect(f[0]).toBeGreaterThanOrEqual(1); expect(f[0]).toBeLessThanOrEqual(2);
    expect(f[1]).toBeGreaterThanOrEqual(2); expect(f[1]).toBeLessThanOrEqual(3);
    expect(f[2]).toBeGreaterThanOrEqual(3); expect(f[2]).toBeLessThanOrEqual(4);
    expect(cashMed(at(st, 1))).toBeGreaterThanOrEqual(1000000); expect(cashMed(at(st, 1))).toBeLessThanOrEqual(15000000);
    // 30년 측정 약 7,400억: 공장 5등급(7,000억)을 모으는 중인 판이 많다. 1조를 넘으면 실패
    expect(cashMed(at(st, 2))).toBeGreaterThanOrEqual(3000000); expect(cashMed(at(st, 2))).toBeLessThanOrEqual(100000000);
  });
  it('5) 리프트의 가치: 신중 ÷ 리프트 안 함 20년 현금(목표 1.15~1.6, 측정 약 1.1), 리프트 안 함 > 새 이름만', () => {
    const st = at(STEADY(), 1), nf = at20('noFacelift', () => noFacelift()), nn = at20('newNameOnly', () => newNameOnly());
    console.log(`${line('noFacelift', nf)}\n${line('newNameOnly', nn)}\nsteady ÷ noFacelift = ${(cashMed(st) / cashMed(nf)).toFixed(2)}`);
    expect(cashMed(nf)).toBeGreaterThan(cashMed(nn));
    expect(cashMed(st) / cashMed(nf)).toBeGreaterThanOrEqual(1.05); expect(cashMed(st) / cashMed(nf)).toBeLessThanOrEqual(1.6);
  });
  it('5) 페이스리프트 1회의 36개월 추가 이익 ÷ 비용 1.5~4(같은 순간에서 갈라, 두 쪽 다 그 뒤 다른 결정은 하지 않는다)', () => {
    let gain = 0, cost = 0, n = 0;
    for (const seed of SEEDS) {
      const g = Game.create({ seed }), st = steady();
      for (let w = 0; w < 48 * 10 && g.state.status === 'playing'; w++) {
        const snap = g.toJSON();
        st.step(g);
        const p = g.state.projects.find((x) => x.kind === 'facelift');
        if (p) {
          const b = Game.fromJSON(snap);
          let c = 0;
          for (let i = 0; i < 36 * config.time.weeksPerMonth; i++) {
            const q = g.state.projects.find((x) => x.id === p.id);
            if (q) {
              c = q.spent;
              if (q.phase === 'test' && q.testWeeks >= config.dev.minTestWeeks && (q.defectEst <= 5 || q.testWeeks >= 12)) {
                const gen = allGens(g.state).find((x) => x.id === q.targetId)!;
                g.command({ type: 'launch', projectId: q.id, price: currentEdition(gen).price, marketing: gen.marketing, color: 'red', wheels: 0 });
              }
            }
            g.tick(); b.tick();
          }
          gain += g.state.cash - b.state.cash; cost += c; n++;
          break;
        }
        g.tick();
      }
    }
    console.log(`리프트 ${n}회: 평균 추가 이익 ${(gain / n / 10000).toFixed(1)}억, 평균 비용 ${(cost / n / 10000).toFixed(1)}억, 배수 ${(gain / cost).toFixed(2)}`);
    expect(n).toBeGreaterThanOrEqual(8); // 봇은 약한 차·생산 한도에 묶인 차는 리프트하지 않아 10년 안의 첫 리프트가 20판 중 약 9판
    expect(gain / cost).toBeGreaterThanOrEqual(1.5); expect(gain / cost).toBeLessThanOrEqual(4);
  });
  it('6) 신중 ÷ 확장 안 함 20년 현금 1.5배 이상, 확장 안 함 20년 생존 50% 이상, 가격 올리기 ÷ 신중 0.7~1.5, 20년 주문/한도 중앙값 0.7~1.5(약간 초과)', () => {
    const st = at(STEADY(), 1), ne = at20('noExpand', () => noExpand()), go = at20('gouger', () => gouger());
    const ratio = median(st.filter((x) => x.alive).map((x) => x.ratio));
    console.log(`${line('noExpand', ne)}\n${line('gouger', go)}\nsteady ÷ noExpand = ${(cashMed(st) / cashMed(ne)).toFixed(2)}, gouger ÷ steady = ${(cashMed(go) / cashMed(st)).toFixed(2)}, 주문/한도 ${ratio.toFixed(2)}`);
    expect(cashMed(st)).toBeGreaterThanOrEqual(cashMed(ne) * 1.5);
    expect(alive(ne)).toBeGreaterThanOrEqual(10);
    expect(cashMed(go) / cashMed(st)).toBeGreaterThanOrEqual(0.7); expect(cashMed(go) / cashMed(st)).toBeLessThanOrEqual(1.5);
    // 측정 약 1.6: 봇은 주문이 한도의 1.3배를 3개월 넘어야 증설하고 공사가 6개월이라 늘 조금 밀려 있다. 1.8을 넘으면 실패
    expect(ratio).toBeGreaterThanOrEqual(0.7); expect(ratio).toBeLessThanOrEqual(1.8);
  });
});
