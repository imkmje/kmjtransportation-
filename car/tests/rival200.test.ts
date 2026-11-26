// 2.0.0 경쟁 1부: 경쟁 모델 이름·겉으로 보이는 값(표시용 파생값)·세대교체 뉴스. 판매 계산과 게임 난수는 그대로여야 한다
import { describe, it, expect, vi } from 'vitest';
import { config } from '../src/config';
import { NAMES, RIVALS, bodyById } from '../src/data';
import { Game, allGens } from '../src/sim/game';
import { steady, steadyExec } from '../src/sim/bots';
import { rivalCycle } from '../src/sim/market';
import { rivalHistory, rivalLineup, rivalModelName, rivalModelsIn } from '../src/sim/rivals';
import { hash32 } from '../src/sim/rng';
import type { CarState } from '../src/sim/types';
import { launched } from './util';

vi.setConfig({ testTimeout: 120_000 });
const names = (s: CarState) => s.rivals.flatMap((r, ri) => Object.keys(r.models).sort().map((b) => rivalModelName(s.seed, ri, r.id, b)));
const ticks = (g: Game, months: number) => { const ev = []; for (let i = 0; i < months * 4; i++) { g.state.cash = Math.max(g.state.cash, 1e7); ev.push(...g.tick()); } return ev; }; // 차 없는 판이 파산해 멈추지 않게
const rivalNews = (s: CarState) => s.events.news.filter((n) => n.category === 'rival');
const gens = (s: CarState) => s.rivals.reduce((a, r) => a + Object.values(r.models).reduce((b, md) => b + md.n, 0), 0);

describe('2.0.0 경쟁 모델', () => {
  it('자료(4.0.0): 회사마다 차급마다 이름이 있고, 모든 이름이 서로·플레이어 기본 이름과 다르다', () => {
    const all = RIVALS.flatMap((r) => Object.values(r.models));
    for (const r of RIVALS) expect(Object.keys(r.models).sort()).toEqual(Object.keys(r.cells).sort());
    expect(new Set(all).size).toBe(all.length);
    for (const n of NAMES.cars) expect(all).not.toContain(n);
  });
  it('이름: 같은 시드면 같고, 세대가 바뀌어도 이어지며, 한 판 안에서 겹치지 않는다', () => {
    for (const seed of [1, 2, 3, 77]) {
      const a = Game.create({ seed, difficulty: 'normal' }), b = Game.create({ seed, difficulty: 'normal' }), n0 = names(a.state);
      expect(names(b.state)).toEqual(n0);
      expect(new Set(n0).size).toBe(n0.length);
      const g0 = gens(a.state); ticks(a, 96);
      expect(gens(a.state)).toBeGreaterThan(g0); // 8년이면 세대교체가 있다
      expect(names(a.state)).toEqual(n0);
    }
    expect(names(Game.create({ seed: 1 }).state)).toEqual(names(Game.create({ seed: 2 }).state)); // 4.0.0: 차급마다 정한 이름(시드와 무관)
  });
  it('겉으로 보이는 값: 범위와 결정론(평론 1~10, 등급 0~10, 가격 > 0, 칸 점유 합 ≤ 1)', () => {
    const a = Game.create({ seed: 5, difficulty: 'normal' }), b = Game.create({ seed: 5, difficulty: 'normal' });
    for (let y = 0; y < 4; y++) {
      ticks(a, 60); ticks(b, 60);
      for (const body of Object.keys(a.state.rivals[0].models)) {
        const v = rivalModelsIn(a.state, body);
        expect(JSON.stringify(v)).toBe(JSON.stringify(rivalModelsIn(b.state, body)));
        expect(v.reduce((x, m) => x + m.share, 0)).toBeLessThanOrEqual(1 + 1e-9);
        for (const m of v) {
          expect(m.critic).toBeGreaterThanOrEqual(1); expect(m.critic).toBeLessThanOrEqual(10);
          for (const k of Object.values(m.grades)) { expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(10); }
          expect(m.price).toBeGreaterThan(0); expect(m.share).toBeGreaterThanOrEqual(0);
          expect(m.year).toBe(1970 + Math.floor(m.start / 12));
        }
      }
    }
  });
  it('지난 세대: 저장 없이 거꾸로 셈한 시작 달·평론이 그 세대가 지금이던 때의 값과 같다(첫 모델 제외)', () => {
    const g = Game.create({ seed: 11, difficulty: 'normal' }), seen = new Map<string, { start: number; critic: number; hit: boolean }>();
    for (let m = 0; m < 12 * 25; m++) {
      ticks(g, 1);
      g.state.rivals.forEach((r, ri) => { for (const b of Object.keys(r.models)) { const h = rivalHistory(g.state, ri, b).at(-1)!; seen.set(`${ri}:${b}:${h.n}`, { start: h.start, critic: h.critic, hit: h.hit }); } });
    }
    let checked = 0;
    g.state.rivals.forEach((r, ri) => { for (const b of Object.keys(r.models)) {
      const h = rivalHistory(g.state, ri, b);
      expect(h.map((x) => x.n)).toEqual(h.map((_, i) => i));
      for (let i = 1; i < h.length; i++) expect(h[i].start - h[i - 1].start).toBe(rivalCycle(g.state.seed, ri, b, i - 1));
      for (const x of h) if (x.n > 0) { expect({ start: x.start, critic: x.critic, hit: x.hit }).toEqual(seen.get(`${ri}:${b}:${x.n}`)); checked++; }
    } });
    expect(checked).toBeGreaterThan(50);
  });
  it('3.1.1 히트작 표시: 같은 차급에서 옆 경쟁 차보다 추정 평론이 낮은 히트작이 없다(비교 화면·지난 세대)', () => {
    let shown = 0;
    for (const seed of [1, 2, 3, 4]) {
      const g = Game.create({ seed, difficulty: 'normal' });
      for (let y = 0; y < 30; y++) {
        ticks(g, 12);
        for (const body of new Set(g.state.rivals.flatMap((r) => Object.keys(r.models)))) {
          const v = rivalModelsIn(g.state, body);
          for (const m of v.filter((x) => x.hit)) { shown++; for (const o of v) expect(m.critic, `${seed} ${body} ${m.name} ${o.name}`).toBeGreaterThanOrEqual(o.critic); }
        }
      }
      g.state.rivals.forEach((r, ri) => { for (const b of Object.keys(r.models)) for (const x of rivalHistory(g.state, ri, b).filter((h) => h.hit)) {
        g.state.rivals.forEach((q, rj) => { if (rj === ri || !q.models[b]) return; const o = rivalHistory(g.state, rj, b).filter((h) => h.start <= x.start).at(-1); if (o) expect(x.critic).toBeGreaterThanOrEqual(o.critic); });
      } });
    }
    expect(shown).toBeGreaterThan(10);
  });
  it('히트작: 그 회사·그 칸의 평소(강약만 반영한 평론)보다 뚜렷이 높은 세대만, 열에 한둘', () => {
    let hits = 0, all = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = Game.create({ seed, difficulty: 'normal' }); ticks(g, 12 * 30);
      g.state.rivals.forEach((r, ri) => { for (const b of Object.keys(r.models)) for (const x of rivalHistory(g.state, ri, b)) {
        if (x.n === 0) continue;
        const usual = config.rivals.view.criticMid + (RIVALS.find((d) => d.id === r.id)!.cells[b]) * config.rivals.view.criticPer;
        all++; if (x.hit) { hits++; expect(x.critic).toBeGreaterThanOrEqual(usual + config.rivals.view.hitAt * config.rivals.noise * config.rivals.view.criticPer - 0.051); } // 3.1.1 평소보다 강해도 옆 경쟁 차보다 낮으면 히트작이 아니다(위 점검)
      } });
    }
    console.log(`히트작 비율 ${(hits / all * 100).toFixed(1)}%`);
    expect(hits / all).toBeGreaterThan(0.05); expect(hits / all).toBeLessThan(0.3);
  });
  it('뉴스: 세대교체 수와 뉴스 수가 같고, 줄마다 그 세대 번호가 있다. 내 차가 없으면 알림(이벤트)은 없다', () => {
    const g = Game.create({ seed: 4, difficulty: 'normal' }), g0 = gens(g.state);
    const ev = ticks(g, 48), news = rivalNews(g.state);
    expect(news.length).toBe(gens(g.state) - g0);
    expect(news.length).toBeGreaterThan(3);
    for (const n of news) { expect(n.topic).toBe('rival'); expect(n.text).toMatch(/^(현다이|포티|도요다|비엠브이|혼디|테슬러), .+ \d+세대 출시\. /); }
    expect(ev.filter((e) => e.kind === 'news' && 'topic' in e && e.topic === 'rival')).toEqual([]);
    const l = rivalLineup(g.state, 'toyoda')!;
    for (const m of l.models) if (news.some((n) => n.text.includes(`${m.name} ${m.number}세대`))) expect(m.n).toBeGreaterThan(0);
  });
  it('뉴스: 내가 그 칸에 차를 팔면 관련을 덧붙이고 알림(이벤트)을 낸다', () => {
    const { g, gen } = launched(3, 1200);
    const name = g.state.nameplates[0].name;
    let ev: ReturnType<Game['tick']> = [];
    for (let i = 0; i < 12 * 12 * 4 && !ev.some((e) => 'topic' in e && e.topic === 'rival'); i++) ev = g.tick();
    const e = ev.find((x) => 'topic' in x && x.topic === 'rival')!;
    expect(e.text).toContain(`「${name}」`);
    expect(e.text).toContain(`같은 ${bodyById(gen.body).name}`);
    expect(rivalNews(g.state).some((n) => n.text === e.text)).toBe(true);
  });
  it('늦은 시작(2015년): 시작 직후 지난 세대교체 뉴스가 쏟아지지 않는다', () => {
    for (const seed of [1, 2, 3]) {
      const g = Game.create({ seed, difficulty: 'normal', startYear: 2015 });
      expect(rivalNews(g.state)).toEqual([]);
      ticks(g, 2);
      expect(rivalNews(g.state).length).toBeLessThanOrEqual(3);
      expect(names(g.state).slice(0, names(Game.create({ seed, difficulty: 'normal' }).state).length)).toEqual(names(Game.create({ seed, difficulty: 'normal' }).state)); // 이름은 시작 연도와 무관(2015년 시작에는 그 전에 나타난 테슬러가 뒤에 더 있다)
    }
  });
  it('기존 판 결과 불변: 같은 시드의 판매·현금·난수·장부·경쟁 차가 2.0.0 이전(1.6.1)과 같다', () => {
    const h = (x: unknown) => { const s = JSON.stringify(x); let v = 7; for (let i = 0; i < s.length; i++) v = hash32(v, s.charCodeAt(i)); return v; };
    const run = (seed: number, years: number, bot = steadyExec(), startYear?: number) => {
      const g = Game.create({ seed, difficulty: 'normal', ...(startYear ? { startYear } : {}) });
      for (let w = 0; w < years * 48 && g.state.status === 'playing'; w++) { bot.step(g); g.tick(); }
      const s = g.state;
      return { cash: s.cash, sold: allGens(s).reduce((a, x) => a + x.totalSold, 0), rng: s.rng, ledger: h(s.ledger), rivals: h(s.rivals) };
    };
    // 4.0.0 경쟁사 6곳(정규화)으로 다시 뽑은 값(3.7.1까지: 87412019.57/940508, 45466261.72/792658, 98958003.82/304542). 처음 값은 1.6.1(커밋 de79c75). 3.5.0: 경쟁 2부(시상식·대응 신차·가격 전쟁 등)를 끈 계산이 그대로인지 본다(켠 값은 아래 3.5.0 고정값)
    const R = config.rivalry as { on: boolean };
    R.on = false;
    let off;
    try { off = [run(1, 20), run(2, 20, steady()), run(3, 8, steadyExec(), 2015)]; } finally { R.on = true; }
    expect(off).toEqual([
      { cash: 96005860.2696497, sold: 1015671, rng: 1512446508, ledger: 452230256, rivals: 3702366129 },
      { cash: 54280678.835944586, sold: 855705, rng: 3656142007, ledger: 1093000369, rivals: 2582769295 },
      { cash: 98947680.7056947, sold: 307802, rng: 3830396908, ledger: 48041485, rivals: 1001147149 },
    ]);
    // 3.5.0 경쟁 2부를 켠 판(지금 게임): 시상식 평판·판매 보너스, 대응 신차, 가격 전쟁(봇은 기본 선택 '버틴다'), 이직 제안(임원 봇은 인사 위임으로 붙잡는다)이 결과를 바꾼다
    expect([run(1, 20), run(2, 20, steady()), run(3, 8, steadyExec(), 2015)]).toEqual([
      { cash: 125019841.36865704, sold: 1060249, rng: 1576387705, ledger: 1285195934, rivals: 2997189494 }, // 4.0.0 경쟁사 6곳(3.7.1: 108126213.49/1075924)
      { cash: 52624735.88964106, sold: 869654, rng: 3791600701, ledger: 1494045141, rivals: 769045974 }, // (3.7.1: 51269056.79/823653)
      { cash: 96625424.71161187, sold: 313477, rng: 3559479520, ledger: 549864667, rivals: 3651925573 }, // (3.7.1: 95369860.97/312140)
    ]);
  });
});
