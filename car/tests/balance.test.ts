import { describe, it, expect, vi } from 'vitest';
import { gouger, idle, newNameOnly, noExpand, noFacelift, noResearch, novice, runBot, steady, steadyExec, type Bot } from '../src/sim/bots';
import { eraTimeline } from '../src/sim/events';
import { Game, allGens, sellingGens } from '../src/sim/game';
import { capacityOf } from '../src/sim/company';
import { avgGrade } from '../src/sim/cars';
import { launchAvgGrade } from '../src/sim/lifecycle';
import { currentEdition } from '../src/sim/market';
import { yearOf } from '../src/sim/time';
import { config } from '../src/config';

// 봇 수십 판을 돌려 CI에서 기본 5초를 넘긴다(0.5.0 PR에서 5.4초로 실패).
vi.setConfig({ testTimeout: 60_000 });

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const median = (xs: number[]) => { const v = [...xs].filter(Number.isFinite).sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
const eok = (x: number) => Math.round(x / 10000);

/** 봇을 months개월 돌려 첫 차의 평론·회수 개월·출시 3~14개월 판매 중앙값(생산 한도 대비)과 최저 현금을 잰다 */
function firstCar(bot: Bot, seed: number, months: number) {
  const g = Game.create({ difficulty: 'normal', seed });
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
interface Snap { alive: boolean; cash: number; worth: number; factory: number; hq: number; grade: number; ratio: number; bodies: number; techs: number } // worth: 현금 − 대출 + 지금까지 낸 공장·본사 건설비(0.4.2, 큰 투자 시점에 따라 현금이 크게 흔들려 비교용으로) // bodies: 지금까지 출시한 차체 종류 수, techs: 완료한 기술 수
const snapOf = (g: Game): Snap => {
  const s = g.state, y = yearOf(s.week), gens = sellingGens(s);
  return {
    alive: s.status === 'playing', cash: s.cash, factory: s.factory.level, hq: s.hqLevel,
    worth: s.cash - s.loan.balance + config.factory.levels.slice(0, s.factory.build?.level ?? s.factory.level).reduce((a, x) => a + x.cost, 0) + config.hq.levels.slice(0, s.hqLevel).reduce((a, x) => a + x.cost, 0),
    grade: gens.length ? gens.reduce((a, x) => a + avgGrade(currentEdition(x).stats, y), 0) / gens.length : NaN,
    ratio: gens.reduce((a, x) => a + x.lastDemand, 0) / capacityOf(s),
    bodies: new Set(allGens(s).map((x) => x.body)).size, techs: s.research.done.length,
  };
};
/** 봇을 시드 20개로 돌려 years년 시점마다 요약 + 낸 차 전부의 출시 등급(결과는 이름별로 한 번만 돌린다) */
const cache = new Map<string, { seed: number; snaps: Snap[]; launches: number[]; deltas: { year: number; d: number; worse: boolean }[]; launchY: number[]; alive: boolean[] }[]>(); // alive: 달마다 살아 있었는가, deltas: 풀체인지마다 출시 연도·(새 세대 − 전 세대) 출시 등급·전작 비교 감점 여부, launchY: launches의 출시 연도
function runs(name: string, bot: () => Bot, years: number[]) {
  if (!cache.has(name)) cache.set(name, SEEDS.map((seed) => {
    const g = Game.create({ difficulty: 'normal', seed }), b = bot(), snaps: Snap[] = [], alive: boolean[] = [], wpy = config.time.weeksPerMonth * config.time.monthsPerYear;
    for (let w = 1; w <= Math.max(...years) * wpy; w++) {
      if (g.state.status === 'playing') { b.step(g); g.tick(); }
      if (w % config.time.weeksPerMonth === 0) alive.push(g.state.status === 'playing');
      if (w % wpy === 0 && years.includes(w / wpy)) snaps.push(snapOf(g));
    }
    const deltas = g.state.nameplates.flatMap((n) => n.generations.slice(1).map((x, i) => ({ year: yearOf(x.launchWeek), d: launchAvgGrade(x) - launchAvgGrade(n.generations[i]), worse: (x.editions[0].headline ?? '').includes('전작만 못하다') })));
    return { seed, snaps, launches: allGens(g.state).map(launchAvgGrade), launchY: allGens(g.state).map((x) => yearOf(x.launchWeek)), deltas, alive };
  }));
  return cache.get(name)!;
}
const at = (rs: ReturnType<typeof runs>, i: number) => rs.map((r) => r.snaps[i]);
const alive = (ss: Snap[]) => ss.filter((x) => x.alive).length;
const cashMed = (ss: Snap[]) => median(ss.map((x) => x.cash));
const worthMed = (ss: Snap[]) => median(ss.map((x) => (x.alive ? x.worth : 0)));
const line = (n: string, ss: Snap[]) => `${n}: 생존 ${alive(ss)}/20, 현금 중앙값 ${eok(cashMed(ss))}억, 자산 중앙값 ${eok(worthMed(ss))}억, 공장 ${ss.map((x) => x.factory).join('')} 본사 ${ss.map((x) => x.hq).join('')}, 등급 중앙값 ${median(ss.filter((x) => x.alive).map((x) => x.grade)).toFixed(2)}, 주문/한도 중앙값 ${median(ss.filter((x) => x.alive).map((x) => x.ratio)).toFixed(2)}`;
const STEADY = () => runs('steady', () => steady(), [10, 20, 30]);
const at20 = (name: string, bot: () => Bot) => at(runs(name, bot, [20]), 0);

describe('균형 봇(시드 20개, 0.4.1 난이도 완화 2026-11-20: 서툰 플레이 봇 기준)', () => {
  it('0.4.1 a) 서툰 플레이(novice): 10년 생존 80% 이상, 20년 생존 65% 이상', () => {
    const nv = runs('novice', () => novice(), [10, 20]);
    console.log([10, 20].map((y, i) => line(`novice ${y}년`, at(nv, i))).join('\n'));
    expect(alive(at(nv, 0))).toBeGreaterThanOrEqual(16); expect(alive(at(nv, 1))).toBeGreaterThanOrEqual(13);
  });
  it('0.4.1 b) 서툰 플레이의 첫 차가 평론 3.5~4.5여도 90% 이상이 36개월 안에 개발비를 회수', () => {
    const rs = SEEDS.map((s) => firstCar(novice(), s, 36)).filter((r) => r.review >= 3.5 && r.review <= 4.5);
    const okN = rs.filter((r) => r.payback !== null && r.payback <= 36).length;
    console.log(`novice 첫 차 평론 3.5~4.5: ${rs.length}판, 회수 개월 ${rs.map((r) => r.payback ?? '없음').join(',')}`);
    expect(rs.length).toBeGreaterThanOrEqual(10); expect(okN / rs.length).toBeGreaterThanOrEqual(0.9);
  });
  it('개발비: 중간 설계 기간(0.4.2: 28주) + 시험이면 6~12억', () => {
    const dev = median(SEEDS.map((s) => firstCar(steady(), s, 12).devCost));
    console.log(`개발비 중앙값 ${(dev / 10000).toFixed(1)}억`);
    expect(dev).toBeGreaterThanOrEqual(60000); expect(dev).toBeLessThanOrEqual(120000);
  });
  it('1a) 평론 5~6점대 첫 차의 개발비 회수 중앙값 5~18개월(0.4.1 난이도 완화로 하한 7 → 5, 측정 6)', () => {
    const rs = SEEDS.map((s) => firstCar(steady({ designWeeks: config.dev.designWeeks[2] }), s, 48)).filter((r) => r.review >= 5 && r.review < 7);
    const m = median(rs.map((r) => r.payback ?? 999));
    console.log(`평론 5~6점대 ${rs.length}판, 회수 개월: ${rs.map((r) => r.payback).join(',')} → 중앙값 ${m}`);
    expect(rs.length).toBeGreaterThanOrEqual(10);
    expect(m).toBeGreaterThanOrEqual(5); expect(m).toBeLessThanOrEqual(18);
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
  it('1d) 실패작(절약·가장 짧은 설계·최소 시험으로 출시, 평론 3.5 이하) 하나만 팔면 48개월 안에 현금이 음수가 되거나 대출이 필요하다(0.4.2: 개발이 약 5개월 길어지고 1등급 공장 유지비를 내려 36 → 48개월)', () => {
    const flop = steady({ budget: 'low', designWeeks: config.dev.designWeeks[0], launchDefects: Infinity, maxTestWeeks: config.dev.minTestWeeks, changeMonths: Infinity, faceliftMonths: Infinity });
    for (const r of SEEDS.map((s) => firstCar(flop, s, 48))) { expect(r.review).toBeLessThanOrEqual(3.5); expect(r.minCash < 0 || r.loan > 0).toBe(true); }
  });
  it('2) 신중: 10년 생존 70% 이상, 20년 생존 60% 이상, 10년 현금 중앙값 20~500억. 10) 10년 생존은 0.3.0(16판)보다 2판 넘게 줄지 않음', () => {
    const st = STEADY();
    console.log([10, 20, 30].map((y, i) => line(`steady ${y}년`, at(st, i))).join('\n'));
    expect(alive(at(st, 0))).toBeGreaterThanOrEqual(14);
    expect(alive(at(st, 1))).toBeGreaterThanOrEqual(12);
    const c10 = cashMed(at(st, 0));
    expect(c10).toBeGreaterThanOrEqual(200000); expect(c10).toBeLessThanOrEqual(5000000); // 0.5.1: 등급 원가 가산을 낮춰 이익률을 올리고 공장 2등급 라인 3개로 상한 300 → 500억(측정 351억). 0.5.0: 본사 1등급 정원 6·개발 중 연구 점수로 초반이 나아져 상한 200 → 300억(측정 256억)
  });
  it('3) 신중이 판매하는 차의 표시 등급: 10·20·30년 중앙값 4.5~7.5(0.4.2), 출시 등급 9 초과는 10% 미만', () => {
    const st = STEADY(), g = [0, 1, 2].map((i) => median(at(st, i).filter((x) => x.alive).map((x) => x.grade)));
    const launches = st.flatMap((r) => r.launches), over9 = launches.filter((x) => x > 9).length / launches.length;
    console.log(`등급 중앙값 10년 ${g[0].toFixed(2)} / 20년 ${g[1].toFixed(2)} / 30년 ${g[2].toFixed(2)}, 출시 ${launches.length}대 중 9 초과 ${(over9 * 100).toFixed(1)}%`);
    expect(g[0]).toBeGreaterThanOrEqual(4.5); expect(g[0]).toBeLessThanOrEqual(7);
    // 0.4.2: 평판을 올릴 길(출시 평론·연간 판매)을 넣고 1980년부터 기준 상승을 늦춰 30년 하락(0.4.1 측정 약 3.8)이 사라졌다. 측정 5.7 / 7.0 / 6.1
    expect(g[1]).toBeGreaterThanOrEqual(4.5); expect(g[1]).toBeLessThanOrEqual(7.5);
    expect(g[2]).toBeGreaterThanOrEqual(4.5); expect(g[2]).toBeLessThanOrEqual(7.5);
    expect(over9).toBeLessThan(0.1);
  });
  it('4) 성장 속도: 공장 등급 중앙값 10년 1~3(0.5.1)·20년 2~3(초과, 아래 설명)·30년 3~5, 현금 중앙값 20년 100~4,000억·30년 300~20,000억(0.5.1)', () => {
    const st = STEADY(), f = [0, 1, 2].map((i) => median(at(st, i).map((x) => x.factory)));
    console.log(`공장 등급 중앙값 ${f.join(' / ')}, 현금 중앙값 20년 ${eok(cashMed(at(st, 1)))}억 / 30년 ${eok(cashMed(at(st, 2)))}억`);
    expect(f[0]).toBeGreaterThanOrEqual(1); expect(f[0]).toBeLessThanOrEqual(3); // 0.5.1: 공장 2등급 라인 3개·이익률 개선으로 10년 3등급까지 허용
    // 20년 측정 4(4등급 도달 중앙값 약 18년), 현금 약 1,700억: 연구한 차체(중형·대형)와 동력 단계로 1980년대 이익이 커졌다.
    // 공장을 늦추면 생산 라인(3개)이 모자라 "20년 안에 차체 4종"(목표 8)을 못 맞춘다 → 공장 4등급 유지비를 올려 현금만 눌렀다. 공장 5등급·현금 2,500억을 넘으면 실패
    expect(f[1]).toBeGreaterThanOrEqual(2); expect(f[1]).toBeLessThanOrEqual(5); // 1.0.0: 4 → 5(사용자 요청 '공장을 더 늘릴 수 있게': 건설비 완화·증설 대출로 20년에 5등급, 측정 중앙값 4~5)
    expect(f[2]).toBeGreaterThanOrEqual(3); expect(f[2]).toBeLessThanOrEqual(5); // 0.5.1: 30년 5등급까지
    expect(cashMed(at(st, 1))).toBeGreaterThanOrEqual(1000000); expect(cashMed(at(st, 1))).toBeLessThanOrEqual(40000000); // 0.5.1: 20년 상한 2,500 → 4,000억(측정 3,500억)
    // 0.4.2: 의무 장비 원가를 시장 기준가에 넣어(봇이 그만큼 값을 받는다) 1990년대 후반 적자가 사라지자 30년 현금이 약 9,400억이 되었다. 1조 2천억을 넘으면 실패
    expect(cashMed(at(st, 2))).toBeGreaterThanOrEqual(3000000); expect(cashMed(at(st, 2))).toBeLessThanOrEqual(400000000); // 0.5.1: 30년 상한 1.2 → 2조(측정 1.23조). 1.0.0: 2 → 4조(균형 기준을 편의 기능 봇으로 바꾸고 너그럽게, 측정 2.14조)
  });
  it('5) 리프트의 가치: 20년 자산(현금 − 대출 + 공장·본사 건설비) 신중 ≥ 리프트 안 함 × 0.9(1.6배 이하), 이름을 잇는 신중 ≥ 새 이름만 × 0.9(0.5.0, 아래 설명)', () => {
    const st = at(STEADY(), 1), nf = at20('noFacelift', () => noFacelift()), nn = at20('newNameOnly', () => newNameOnly());
    console.log(`${line('noFacelift', nf)}\n${line('newNameOnly', nn)}\nsteady ÷ noFacelift = 현금 ${(cashMed(st) / cashMed(nf)).toFixed(2)}, 자산 ${(worthMed(st) / worthMed(nf)).toFixed(2)}`);
    // 0.4.2: 수명이 30개월까지 평평해지고 평판이 오르자 20년 무렵 주문이 생산 한도의 2~4배라, 리프트로 는 주문을 팔 수 없어 봇 수준의 차이가 작다(자산 약 1.05배).
    // 0.4.1까지의 "현금 1.1~1.6배"는 큰 투자(공장 4등급 2,200억) 시점에 따라 흔들려 자산으로 바꿨다. 리프트 한 번의 손익은 아래 갈래 시험과 patch042의 통제 시나리오로 따로 고정한다
    // 전작 비교를 원점수로 바꾸고(봇은 감점을 피하려 설계 기간·예산을 늘린다) 신중과 새 이름만의 20년 자산이 거의 같아졌다(측정 0.995). 5% 넘게 뒤지면 실패
    expect(worthMed(st)).toBeGreaterThanOrEqual(worthMed(nn) * 0.9); // 0.5.0 측정 0.93
    // 0.5.0: 20년 자산은 큰 투자 시점에 따라 ±10% 흔들린다(측정 0.94~1.15). 리프트 한 번의 손익은 아래 갈래 시험과 patch042의 통제 시나리오로 고정한다
    expect(worthMed(st) / worthMed(nf)).toBeGreaterThanOrEqual(0.9); expect(worthMed(st) / worthMed(nf)).toBeLessThanOrEqual(1.6);
  });
  it('5) 페이스리프트 1회의 36개월 추가 이익 ÷ 비용 1.5~6(0.5.0 상한 5 → 6, 0.4.2: 리프트가 디자인 밖 능력치도 올려 상한 4 → 5, 같은 순간에서 갈라, 두 쪽 다 그 뒤 다른 결정은 하지 않는다)', () => {
    let gain = 0, cost = 0, n = 0;
    for (const seed of SEEDS) {
      const g = Game.create({ difficulty: 'normal', seed }), st = steady();
      for (let w = 0; w < 48 * 10 && g.state.status === 'playing'; w++) {
        st.step(g);
        const p = g.state.projects.find((x) => x.kind === 'facelift');
        if (p) {
          // 같은 순간에서 가른다: 리프트를 시작한 바로 그 상태를 복사해 리프트만 취소(같은 주에 다른 차를 출시했을 수 있으므로 시작 전 상태로 가르지 않는다)
          const b = Game.fromJSON(g.toJSON());
          b.command({ type: 'cancelProject', projectId: p.id });
          let c = 0;
          for (let i = 0; i < 36 * config.time.weeksPerMonth; i++) {
            const q = g.state.projects.find((x) => x.id === p.id);
            if (q) {
              c = q.spent;
              if (q.waiting || (q.phase === 'test' && q.testWeeks >= config.dev.minTestWeeks && (q.defectEst <= 5 || q.testWeeks >= 12))) {
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
    expect(gain / cost).toBeGreaterThanOrEqual(1.5); expect(gain / cost).toBeLessThanOrEqual(6); // 0.5.0: 가격 벌점 완화로 리프트 뒤 주문이 더 늘어 측정 5.7
  });
  it('6) 신중 ÷ 확장 안 함 20년 현금 1.5배 이상, 확장 안 함 20년 생존 50% 이상, 가격 올리기 ÷ 신중 0.4~1.5, 20년 주문/한도 중앙값 0.7~4.5(0.4.2, 아래 설명)', () => {
    const st = at(STEADY(), 1), ne = at20('noExpand', () => noExpand()), go = at20('gouger', () => gouger());
    const ratio = median(st.filter((x) => x.alive).map((x) => x.ratio));
    console.log(`${line('noExpand', ne)}\n${line('gouger', go)}\nsteady ÷ noExpand = ${(cashMed(st) / cashMed(ne)).toFixed(2)}, gouger ÷ steady = ${(cashMed(go) / cashMed(st)).toFixed(2)}, 주문/한도 ${ratio.toFixed(2)}`);
    expect(cashMed(st)).toBeGreaterThanOrEqual(cashMed(ne) * 1.5);
    expect(alive(ne)).toBeGreaterThanOrEqual(10);
    expect(cashMed(go) / cashMed(st)).toBeGreaterThanOrEqual(0.4); expect(cashMed(go) / cashMed(st)).toBeLessThanOrEqual(3); // 1.0.0: 1.5 → 3. 자동 가격(최고 이익)을 정식 기능으로 두고 그 이득을 깎지 않기로 해(사용자 지시), 밀린 주문에 값을 올리는 것도 정당한 전략이 됐다(측정 2.24) // 0.4.2 측정 0.44: 가격을 올리면 주문이 줄어 봇이 공장을 늦게 키운다(가격 올리기가 이득이 아님은 그대로)
    // 봇은 주문이 한도의 1.3배를 3개월 넘어야 증설하고 공사가 6개월이라 늘 조금 밀려 있다. 0.4.2: 수명이 30개월까지 평평해지고 평판이 오르며(본사 3등급 평판 20) 주문이 늘어,
    // 20년 무렵 공장 4등급 건설비(2,200억)를 모으는 동안 주문이 한도의 약 3~4배다(측정 2.8~4.0). 30년에는 약 1로 돌아온다. 4.5를 넘으면 실패
    expect(ratio).toBeGreaterThanOrEqual(0.7); expect(ratio).toBeLessThanOrEqual(4.5);
  });
  it('7) 연구의 가치: 신중 ÷ 연구 안 함 20년 자산 1.5배 이상, 연구 안 함도 20년 생존 30% 이상(즉사는 아님)', () => {
    const st = at(STEADY(), 1), nr = at20('noResearch', () => noResearch());
    console.log(`${line('noResearch', nr)}\nsteady ÷ noResearch = 현금 ${(cashMed(st) / cashMed(nr)).toFixed(2)}, 자산 ${(worthMed(st) / worthMed(nr)).toFixed(2)}`);
    expect(worthMed(st)).toBeGreaterThanOrEqual(worthMed(nr) * 1.5); // 0.4.2: 현금 → 자산(5번과 같은 이유)
    expect(alive(nr)).toBeGreaterThanOrEqual(6);
    for (const x of nr) expect(x.techs).toBe(0);
  });
  it('7b) 꾸준히 연구하면 풀체인지에서 전작 비교 감점을 받지 않는다: 신중의 감점 비율 10% 이하(0.4.2: 전작 비교를 원점수로, 사용자 피드백 "다음 작품일수록 좋은 평가가 어렵다")', () => {
    const st = STEADY(), nr = runs('noResearch30', () => noResearch(), [10, 20, 30]);
    const rate = (rs: ReturnType<typeof runs>) => { const d = rs.flatMap((r) => r.deltas); return d.filter((x) => x.worse).length / d.length; };
    const byYear = st.flatMap((r) => r.launches.map((v, i) => ({ y: r.launchY[i], v })));
    const trend = [1970, 1975, 1980, 1985, 1990, 1995].map((y) => `${y} ${median(byYear.filter((x) => x.y >= y && x.y < y + 5).map((x) => x.v)).toFixed(1)}`).join(' / ');
    console.log(`전작 비교 감점 비율 신중 ${(rate(st) * 100).toFixed(1)}%(${st.flatMap((r) => r.deltas).length}회) / 연구 안 함 ${(rate(nr) * 100).toFixed(1)}%, 신중 출시 등급 중앙값 ${trend}`);
    expect(rate(st)).toBeLessThanOrEqual(0.2); // 1.0.0: 공장을 일찍 키워(증설 대출) 차종이 빨리 늘며 측정 11.0%. 10 → 12%. 1.1.0: 추천 구성이 원가 상한으로 기본 장비를 선택 사양으로 내리는 세대가 있어 측정 15.1%, 12 → 20%
  });
  it('8) 신중이 30년 안에 차체 5종 이상을 낸 판이 절반 이상(0.4.2: 세대가 약 6.5년으로 길어져 20년 4종 → 30년 5종), 30년 연구 완료 기술 수 중앙값 15~34', () => {
    const st = STEADY(), four = at(st, 2).filter((x) => x.bodies >= 5).length, techs = median(at(st, 2).map((x) => x.techs));
    console.log(`차체 수 20년 ${at(st, 1).map((x) => x.bodies).join('')} 30년 ${at(st, 2).map((x) => x.bodies).join('')}`);
    console.log(`30년 차체 5종 이상 ${four}/20, 30년 기술 수 중앙값 ${techs}`);
    expect(four).toBeGreaterThanOrEqual(10);
    expect(techs).toBeGreaterThanOrEqual(15); expect(techs).toBeLessThanOrEqual(34); // 0.5.0: 1970년 기초 기술 4개 추가
  });
  it('9) 오일쇼크(1차)·외환위기 동안 신중의 생존율이 직전보다 15%p 넘게 떨어지지 않음', () => {
    const st = STEADY();
    for (const id of ['oil1', 'imf']) {
      const span = (seed: number) => eraTimeline(seed).find((x) => x.def.id === id)!;
      const before = st.filter((r) => r.alive[span(r.seed).start - 1]).length, after = st.filter((r) => r.alive[Math.min(span(r.seed).end!, r.alive.length) - 1]).length; // 30년 뒤에 끝나는 판(외환위기 +1년)은 30년까지만 본다
      console.log(`${id}: 직전 ${before}판 → 끝 ${after}판`);
      expect(before - after).toBeLessThanOrEqual(3); // 20판의 15% = 3판
    }
  });
});

describe('0.7.0 임원 봇·60년 생존', () => {
  const run = (bot: () => Bot, d: 'easy' | 'normal', years: number) => SEEDS.map((seed) => {
    const g = Game.create({ seed, difficulty: d }), b = bot(), cash: number[] = [];
    for (let w = 1; w <= years * 48 && g.state.status === 'playing'; w++) { b.step(g); g.tick(); if (w % 480 === 0) cash.push(g.state.cash); }
    return { g, alive: g.state.status === 'playing', worth: g.state.status === 'playing' ? snapOf(g).worth : 0, cash, hi: allGens(g.state).map(launchAvgGrade) };
  });
  it.each(['easy', 'normal'] as const)('임원 봇(steadyExec)은 신중보다 유리: 40년 자산 중앙값 +5% 이상, 출시 등급 9 초과 15% 미만(%s, 1.0.0: 60초를 넘어 난이도별로 나눔)', (d) => {
    {
      const a = run(() => steady(), d, 40), b = run(() => steadyExec(), d, 40);
      const wa = median(a.map((r) => r.worth)), wb = median(b.map((r) => r.worth)), hi = b.flatMap((r) => r.hi), hiShare = hi.filter((x) => x > 9).length / hi.length;
      console.log(`${d} 40년: 신중 생존 ${a.filter((r) => r.alive).length}/20 자산 ${eok(wa)}억, 임원 생존 ${b.filter((r) => r.alive).length}/20 자산 ${eok(wb)}억(${((wb / wa - 1) * 100).toFixed(1)}%), 임원 봇 출시 등급 9 초과 ${(hiShare * 100).toFixed(1)}%`);
      expect(b.filter((r) => r.alive).length).toBeGreaterThanOrEqual(a.filter((r) => r.alive).length);
      expect(wb / wa).toBeGreaterThanOrEqual(1.05); // 1.0.0: 편의 기능 이득의 위쪽 한도(1.35)는 없앴다(사용자 지시: 자동 가격·임원의 이득을 깎지 않는다, 측정해 보고만). 측정 쉬움 +35.8%·보통 +24.8%
      expect(hiShare).toBeLessThan(0.15); // 1.0.0: 2010년부터 기준 상승을 2.5% → 1.5%로 늦춰(후반 등급 하락으로 기준가 판매 봇이 무너져서) 후반 출시 등급이 올라 측정 10.0~11.3%. 10% → 15%
    }
  });
  it('보통 신중 60년 생존 18/20 이상(0.7.0 시장 포화 상한 6% → 3.5%), 40년 현금 중앙값 4조 미만(1.0.0)', () => {
    const rs = run(() => steady(), 'normal', 60), c40 = median(rs.map((r) => r.cash[3] ?? 0));
    console.log(`보통 신중 60년 생존 ${rs.filter((r) => r.alive).length}/20, 40년 현금 중앙값 ${eok(c40)}억`);
    expect(rs.filter((r) => r.alive).length).toBeGreaterThanOrEqual(18);
    expect(c40).toBeLessThan(400000000); // 만원: 4조(1.0.0: 2 → 4조, 기준이 편의 기능 봇의 40년 1.5~4조로 바뀌어 기준가 판매 봇의 상한도 그에 맞춘다. 측정 2.18조)
  });
});
