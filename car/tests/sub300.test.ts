// 3.0.0 자회사와 고급 브랜드: 설립 조건·명령·저장(형식 8 → 9)·결정론, 전략별 행동 차이(6년), 너그러움, 전환 기간, 제 살 깎기, 봇 40년(다이어트)
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../src/config';
import { Game, SAVE_VERSION } from '../src/sim/game';
import { steadyBestExec } from '../src/sim/bots';
import { NOTIFY_TOPICS } from '../src/sim/notify';
import { rivalModelsIn } from '../src/sim/rivals';
import { SUB_STRATEGIES, cannibalInfo, foundError, strategyError, stratWeights, subDetail, subModelsIn, subPrice, subsInfo } from '../src/sim/subs';
import { monthOf } from '../src/sim/time';
import type { CarState, SubKind, SubStrategy } from '../src/sim/types';
import { grant, ok, toMonthEnd } from './util';

vi.setConfig({ testTimeout: 600_000 }); // 3.0.0 다이어트 뒤 로컬 약 1분(CI는 몇 배 느리다)
const S = config.subs, WPY = 48;
const fixture = () => JSON.parse(readFileSync('car/tests/fixtures/save-v8.json', 'utf8'));
/** 형식 8 fixture(1994년, 본사 5등급·평판 186·현금 2.9조)에서 자회사 하나를 세운 판 */
function founded(kind: SubKind = 'premium'): { g: Game; id: number } {
  const g = Game.fromJSON(fixture());
  ok(g.command({ type: 'foundSubsidiary', kind }));
  return { g, id: g.state.subs!.at(-1)!.id };
}
const ticks = (g: Game, n: number, bot?: { step(g: Game): void }) => { for (let i = 0; i < n && g.state.status === 'playing'; i++) { bot?.step(g); g.tick(); } };

describe('설립 조건과 거절 사유', () => {
  it('본사 등급·평판·현금·종류당 한 곳·본사 등급별 상한', () => {
    const g = Game.create({ seed: 1, difficulty: 'normal' }), s = g.state;
    expect(foundError(s, 'premium')).toMatch(/본사 4등급/);
    const r = g.command({ type: 'foundSubsidiary', kind: 'premium' });
    expect(r.ok).toBe(false);
    s.hqLevel = 4; s.reputation = 50; s.cash = 1e9;
    expect(foundError(s, 'premium')).toContain(`평판 ${S.kinds.premium.rep} 이상`);
    s.reputation = 120; s.cash = 100;
    expect(foundError(s, 'parts')).toMatch(/현금이 모자랍니다/);
    s.cash = 1e9;
    expect(foundError(s, 'parts')).toBeNull();
    ok(g.command({ type: 'foundSubsidiary', kind: 'parts' }));
    expect(foundError(s, 'parts')).toMatch(/이미 부품 회사가 있습니다/);
    expect(foundError(s, 'finance')).toMatch(/본사 4등급에서는 자회사를 1곳까지/);
    s.hqLevel = 5;
    ok(g.command({ type: 'foundSubsidiary', kind: 'finance' }));
    expect(g.command({ type: 'foundSubsidiary', kind: 'nope' as SubKind })).toEqual({ ok: false, reason: '없는 자회사 종류입니다.' });
    expect(subsInfo(s)).toMatchObject({ used: 2, max: 3 });
  });
  it('설립: 설립비가 나가고 장부의 자회사 투자에 적히며, 뉴스(자회사 알림 유형)가 난다', () => {
    const g = Game.fromJSON(fixture()), c0 = g.state.cash, r = g.command({ type: 'foundSubsidiary', kind: 'premium', name: '루미에르', color: '#112233' });
    expect(r.ok).toBe(true);
    expect(g.state.cash).toBe(c0 - S.kinds.premium.cost);
    expect(r.ok && r.events?.some((e) => 'topic' in e && e.topic === 'sub')).toBe(true);
    expect(NOTIFY_TOPICS.some((t) => t.id === 'sub' && !t.locked)).toBe(true);
    toMonthEnd(g);
    expect(g.state.ledger.at(-1)!.subInv).toBe(S.kinds.premium.cost);
    expect(g.state.subs![0].models.length).toBe(1); // 첫 월말에 첫 모델
    expect(g.state.events.news.some((n) => n.topic === 'sub' && n.text.includes('「루미에르」'))).toBe(true);
    expect(g.command({ type: 'foundSubsidiary', kind: 'value', name: '루미에르' })).toEqual({ ok: false, reason: '「루미에르」는 이미 쓰는 회사 이름입니다.' });
    expect(g.command({ type: 'foundSubsidiary', kind: 'value', color: 'red' })).toEqual({ ok: false, reason: '로고 색이 올바르지 않습니다.' });
  });
});

describe('명령', () => {
  it('전략: 종류에 맞지 않거나 시기가 이른 전략은 이유와 함께 거절, 경쟁사 지정', () => {
    const { g, id } = founded('premium'), s = g.state;
    expect(g.command({ type: 'setSubStrategy', subId: id, strategy: 'share' })).toMatchObject({ ok: false, reason: expect.stringMatching(/고급 브랜드는/) });
    expect(g.command({ type: 'setSubStrategy', subId: id, strategy: 'ev' })).toEqual({ ok: false, reason: '전동화 전환은 2010년부터 고를 수 있습니다.' });
    expect(g.command({ type: 'setSubStrategy', subId: id, strategy: 'growth' })).toEqual({ ok: false, reason: '이미 그 전략입니다.' });
    expect(g.command({ type: 'setSubStrategy', subId: id, strategy: 'rival', rivalId: 'nobody' })).toEqual({ ok: false, reason: '없는 경쟁사입니다.' });
    ok(g.command({ type: 'setSubStrategy', subId: id, strategy: 'rival', rivalId: 'porty' }));
    expect(subDetail(s, id)!.rival).toMatchObject({ id: 'porty', chosen: true });
    ok(g.command({ type: 'setSubStrategy', subId: id, strategy: 'rival', rivalId: null })); // 상대만 바꾸기(가장 큰 경쟁사)
    expect(subDetail(s, id)!.rival!.chosen).toBe(false);
    ok(g.command({ type: 'foundSubsidiary', kind: 'parts' }));
    const pid = s.subs!.at(-1)!.id;
    expect(g.command({ type: 'setSubStrategy', subId: pid, strategy: 'tech' })).toEqual({ ok: false, reason: '사업 자회사는 성장 중심·수익 중심·안정 유지 전략만 고를 수 있습니다.' });
    ok(g.command({ type: 'setSubStrategy', subId: pid, strategy: 'profit' }));
    ok(g.command({ type: 'foundSubsidiary', kind: 'value' }));
    expect(strategyError(s, { kind: 'value' }, 'prestige')).toMatch(/보급형 브랜드는/);
    const ch = subDetail(s, id)!.strategies;
    expect(ch.map((x) => x.id)).toEqual(SUB_STRATEGIES);
    expect(ch.filter((x) => !x.ok).every((x) => x.reason)).toBe(true);
    expect(g.command({ type: 'setSubStrategy', subId: 999, strategy: 'growth' })).toEqual({ ok: false, reason: '없는 자회사입니다.' });
  });
  it('영역·배당·공유 범위·투자', () => {
    const { g, id } = founded('premium'), s = g.state, sub = () => s.subs!.find((x) => x.id === id)!;
    expect(g.command({ type: 'setSubArea', subId: id, bodies: ['kei'] })).toEqual({ ok: false, reason: '고급 브랜드는 경차를 맡을 수 없습니다.' });
    expect(g.command({ type: 'setSubArea', subId: id, bodies: [] }).ok).toBe(false);
    expect(g.command({ type: 'setSubArea', subId: id, bodies: ['sedanL'], segment: 'fleet' }).ok).toBe(false);
    ticks(g, 4);
    expect(sub().models.length).toBeGreaterThan(0);
    ok(g.command({ type: 'setSubArea', subId: id, bodies: ['sedanL', 'coupe'], segment: 'enthusiast' }));
    ticks(g, 4);
    expect(sub().models.every((m) => ['sedanL', 'coupe'].includes(m.body))).toBe(true); // 영역 밖 모델은 월말에 단종
    expect(g.command({ type: 'setSubDividend', subId: id, pct: 101 }).ok).toBe(false);
    expect(g.command({ type: 'setSubDividend', subId: id, pct: 12.5 }).ok).toBe(false);
    ok(g.command({ type: 'setSubDividend', subId: id, pct: 80 })); expect(sub().dividend).toBe(80);
    expect(g.command({ type: 'setSubShare', subId: id, share: 1 })).toEqual({ ok: false, reason: '지금 공유 범위와 같습니다.' });
    ok(g.command({ type: 'setSubShare', subId: id, share: 2 }));
    const c0 = s.cash, cap0 = sub().capital;
    expect(g.command({ type: 'investSub', subId: id, amount: -5 }).ok).toBe(false);
    expect(g.command({ type: 'investSub', subId: id, amount: s.cash + 1 })).toEqual({ ok: false, reason: '현금이 모자랍니다.' });
    ok(g.command({ type: 'investSub', subId: id, amount: 5000000 }));
    expect(s.cash).toBe(c0 - 5000000); expect(sub().capital).toBe(cap0 + 5000000); expect(sub().total.invested).toBe(S.kinds.premium.cost + 5000000);
    expect(g.undoLast().ok).toBe(true); expect(sub().capital).toBe(cap0); // 되돌리기
    ok(g.command({ type: 'foundSubsidiary', kind: 'finance' }));
    expect(g.command({ type: 'setSubShare', subId: s.subs!.at(-1)!.id, share: 2 })).toEqual({ ok: false, reason: '사업 자회사에는 없는 설정입니다.' });
  });
  it('공유 범위를 넓히면 원가·개발비는 줄고 다음 세대의 추정 평론이 깎이며 "판박이" 평이 붙는다', () => {
    const a = founded('premium'), b = founded('premium');
    ok(b.g.command({ type: 'setSubShare', subId: b.id, share: 2 }));
    ticks(a.g, 4); ticks(b.g, 4);
    const ma = subDetail(a.g.state, a.id)!.models[0], mb = subDetail(b.g.state, b.id)!.models[0];
    expect(mb.body).toBe(ma.body);
    expect(mb.unitCost).toBeLessThan(ma.unitCost);
    expect(mb.critic).toBeLessThan(ma.critic);
    expect(b.g.state.events.news.some((n) => n.text.includes('판박이'))).toBe(true);
  });
  it('사장: 직원 목록에서 빠지고 해임하면 돌아온다. 사장이 있으면 새 모델이 더 세다', () => {
    const { g, id } = founded('premium'), s = g.state, x = [...s.staff].sort((p, q) => q.ability - p.ability)[0], n0 = s.staff.length;
    ok(g.command({ type: 'setSubPresident', subId: id, staffId: x.id }));
    expect(s.staff.length).toBe(n0 - 1); expect(s.staff.some((y) => y.id === x.id)).toBe(false);
    expect(subDetail(s, id)!.president).toMatchObject({ id: x.id, ability: x.ability });
    expect(g.command({ type: 'setSubPresident', subId: id, staffId: 12345 })).toEqual({ ok: false, reason: '없는 직원입니다.' });
    const other = founded('premium');
    ticks(g, 4); ticks(other.g, 4);
    expect(subDetail(s, id)!.models[0].critic).toBeGreaterThan(subDetail(other.g.state, other.id)!.models[0].critic);
    ok(g.command({ type: 'setSubPresident', subId: id, staffId: null }));
    expect(s.staff.some((y) => y.id === x.id)).toBe(true);
    expect(g.command({ type: 'setSubPresident', subId: id, staffId: null })).toEqual({ ok: false, reason: '사장이 없습니다.' });
  });
  it('모델 추가·단종·이름 바꾸기 지시', () => {
    const { g, id } = founded('premium'), s = g.state, sub = () => s.subs!.find((x) => x.id === id)!;
    ticks(g, 4);
    const have = sub().models.map((m) => m.body), free = sub().bodies.find((b) => !have.includes(b) && subDetail(s, id)!.areaReady.includes(b))!;
    expect(g.command({ type: 'subAddModel', subId: id, body: 'kei' })).toEqual({ ok: false, reason: '맡은 영역에 없는 차급입니다. 먼저 영역에 넣으세요.' });
    expect(g.command({ type: 'subAddModel', subId: id, body: have[0] })).toEqual({ ok: false, reason: '이미 그 차급에 모델이 있습니다.' });
    ok(g.command({ type: 'investSub', subId: id, amount: 20000000 }));
    ok(g.command({ type: 'subAddModel', subId: id, body: free }));
    expect(sub().models.find((m) => m.body === free)!.keep).toBe(true);
    const nm = sub().models[0].name;
    expect(g.command({ type: 'renameSubModel', subId: id, body: sub().models[0].body, name: s.nameplates[0].name }).ok).toBe(false);
    ok(g.command({ type: 'renameSubModel', subId: id, body: sub().models[0].body, name: '새이름' }));
    expect(sub().models[0].name).toBe('새이름'); expect(nm).not.toBe('새이름');
    ok(g.command({ type: 'subDropModel', subId: id, body: free }));
    expect(sub().models.some((m) => m.body === free)).toBe(false);
    ticks(g, 12 * 4);
    expect(sub().models.some((m) => m.body === free)).toBe(false); // 단종을 지시한 차급은 전략이 다시 내지 않는다
    expect(g.command({ type: 'subDropModel', subId: id, body: free })).toEqual({ ok: false, reason: '그 차급에 모델이 없습니다.' });
  });
  it('매각: 자본의 일부를 받고 사장은 직원으로 돌아온다', () => {
    const { g, id } = founded('value'), s = g.state, x = s.staff[0];
    ok(g.command({ type: 'setSubPresident', subId: id, staffId: x.id }));
    ticks(g, 24);
    const cap = s.subs![0].capital, c0 = s.cash;
    ok(g.command({ type: 'sellSubsidiary', subId: id }));
    expect(s.cash).toBeCloseTo(c0 + Math.round(cap * S.sellShare), 6);
    expect(s.subs).toEqual([]); expect(s.staff.some((y) => y.id === x.id)).toBe(true);
    ticks(g, 8);
    expect(g.state.status).toBe('playing');
  });
});

describe('저장과 결정론', () => {
  it('형식 8 fixture: 9로 올라오고 자회사가 없으며, 저장 왕복·이어서 돌린 결과가 같다', () => {
    const raw = fixture();
    expect(raw.saveVersion).toBe(8); expect(raw.subs).toBeUndefined();
    const a = Game.fromJSON(raw);
    expect(SAVE_VERSION).toBe(11); expect(a.state.saveVersion).toBe(11); expect(a.state.subs).toBeUndefined();
    expect(Game.fromJSON(raw).toJSON()).toEqual(a.toJSON());
    const b = Game.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    ticks(a, 96); ticks(b, 96);
    expect(JSON.stringify(b.toJSON())).toBe(JSON.stringify(a.toJSON()));
    expect(a.state.ledger.at(-1)!.subDiv).toBeUndefined(); // 자회사가 없으면 장부에 칸이 생기지 않는다
  });
  it('자회사가 있는 판: 같은 명령이면 같은 결과, 중간에 저장·불러오기해도 같다', () => {
    const run = (split: boolean) => {
      let { g, id } = founded('premium');
      ok(g.command({ type: 'foundSubsidiary', kind: 'finance' }));
      ok(g.command({ type: 'setSubStrategy', subId: id, strategy: 'tech' }));
      ticks(g, 3 * WPY);
      if (split) g = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
      ok(g.command({ type: 'setSubStrategy', subId: id, strategy: 'niche' }));
      ticks(g, 3 * WPY);
      return JSON.stringify(g.toJSON());
    };
    const a = run(false);
    expect(run(false)).toBe(a); expect(run(true)).toBe(a);
    expect(JSON.parse(a).saveVersion).toBe(11);
  });
});

describe('전환 기간과 보이는 값', () => {
  it('전략을 바꾼 직후 효과(가격 등)는 바로 다 바뀌지 않고 약 6개월에 걸쳐 바뀐다', () => {
    const { g, id } = founded('value'), s = g.state, sub = () => s.subs!.find((x) => x.id === id)!;
    ticks(g, 8);
    const md = sub().models[0], p0 = subPrice(s, sub(), md);
    ok(g.command({ type: 'setSubStrategy', subId: id, strategy: 'share' }));
    const target = p0 * S.strat.share.price; // 기준가가 그대로라면 바뀐 뒤 값
    ticks(g, 4);
    const p1 = subPrice(s, sub(), md), d1 = subDetail(s, id)!;
    expect(d1.transition).not.toBeNull(); expect(d1.transition!.progress).toBeGreaterThan(0); expect(d1.transition!.progress).toBeLessThan(0.5);
    expect(p1).toBeLessThan(p0 * 0.999); expect(p1).toBeGreaterThan(target * 1.02);
    ticks(g, 6 * 4);
    expect(subDetail(s, id)!.transition).toBeNull();
    expect(stratWeights(sub(), monthOf(s.week))).toEqual([['share', 1]]);
    expect(s.events.news.some((n) => n.text.includes('점유율 중심 전략으로의 전환을 마쳤습니다'))).toBe(true);
    ticks(g, 4 * 4);
    expect(sub().reports.some((r) => r.text.includes('점유율 중심 전략에 따라 가격을'))).toBe(true); // 분기 보고: 행동이 드러난다
  });
  it('자회사 모델은 비교 목록에서 "내 자회사"(own)로 구분되고, 그 차급 경쟁 모델의 점유를 나눠 갖는다. 제 살 깎기는 작다', () => {
    const { g, id } = founded('premium');
    ticks(g, 2 * WPY);
    const s = g.state, md = subDetail(s, id)!.models[0], mine = subModelsIn(s, md.body);
    expect(mine[0]).toMatchObject({ own: true, subId: id, company: s.subs![0].name });
    const rivals = rivalModelsIn(s, md.body);
    expect(rivals.reduce((a, r) => a + r.share, 0)).toBeLessThan(1);
    for (const c of cannibalInfo(s)) expect(c.share).toBeLessThan(0.1);
  });
});
// ---------- 측정(전략 × 종류) ----------
// 3.0.0 테스트 다이어트: 개발 중에는 시드 2개·10년·사업 자회사 전략 3개씩·60년 봇 2판으로 넓게 쟀다(CHANGELOG 3.0.0 '개발 중 측정').
// 여기서는 같은 방향을 시드 1개·YRS년으로 확인하고, 1990·2010·2030년 판은 같은 봇 판을 이어 붙여 한 번만 만든다.
const YRS = Number(process.env.SUB300_YRS ?? 6);
interface Run { kind: SubKind; strategy: SubStrategy; profit: number; invested: number; lossYears: number; earlyDiv: number; dividend: number; share: number; sold: number; models: number; capital: number; rep: number; hqRep: number }
const base = new Map<number, string>();
/** 편의 기능 봇(자회사 없음)으로 돌린 시드 1 판: 1990(20년) → 2010(40년) → 2030(60년)을 이어서 만든다 */
function baseAt(at: number): string {
  if (!base.has(at)) {
    const prev = at > 20 ? baseAt(at - 20) : null, g = prev ? Game.fromJSON(JSON.parse(prev)) : Game.create({ seed: 1, difficulty: 'normal' });
    ticks(g, (prev ? 20 : at) * WPY, steadyBestExec()); base.set(at, JSON.stringify(g.toJSON()));
  }
  return base.get(at)!;
}
/** 그 판에서 자회사 하나를 세워 전략만 정하고 봇과 함께 yrs년 */
function measure(kind: SubKind, strategy: SubStrategy, at = 20, yrs = YRS): Run {
  const g = Game.fromJSON(JSON.parse(baseAt(at))), b = steadyBestExec();
  if (at >= 40) grant(g, 'ec_ev'); // 전동화 비교: 본사가 전기차를 연구한 판(봇이 아직 안 했으면)
  expect(foundError(g.state, kind)).toBeNull();
  ok(g.command({ type: 'foundSubsidiary', kind }));
  const id = g.state.subs![0].id;
  if (g.state.subs![0].strategy !== strategy) ok(g.command({ type: 'setSubStrategy', subId: id, strategy }));
  g.state.subs![0].switchMonth -= S.switchMonths; // 설립과 함께 정한 전략(전환 기간 없이 비교)
  let lossYears = 0, earlyDiv = 0, shareSum = 0;
  const late = Math.floor(yrs / 2);
  for (let y = 0; y < yrs; y++) {
    ticks(g, WPY, b);
    const d = subDetail(g.state, id)!;
    if (d.last12.profit < 0) lossYears++;
    if (y < 3) earlyDiv += d.last12.dividend;
    if (y >= late) shareSum += d.models.reduce((a, m) => a + m.share, 0) / Math.max(1, d.models.length);
  }
  const d = subDetail(g.state, id)!;
  return { kind, strategy, profit: d.total.profit, invested: d.total.invested, lossYears, earlyDiv, dividend: d.total.dividend, share: shareSum / (yrs - late), sold: d.total.sold, models: d.models.length, capital: d.capital, rep: d.rep, hqRep: d.total.hqRep };
}
const eok = (x: number) => `${Math.round(x / 1e4).toLocaleString()}억`;
const brandRuns: Run[] = [];
function brandMatrix(): Run[] {
  if (brandRuns.length) return brandRuns;
  for (const kind of ['premium', 'value'] as SubKind[]) for (const st of SUB_STRATEGIES)
    if (st !== 'ev' && !S.notFor[kind].includes(st)) brandRuns.push(measure(kind, st)); // 전동화는 2010년 이후라 따로 잰다
  console.log(brandRuns.map((r) => `${r.kind} ${S.strat[r.strategy].name}: 이익 ${eok(r.profit)}(투자 ${eok(r.invested)}) 적자 ${r.lossYears}년, 첫 3년 배당 ${eok(r.earlyDiv)}, 배당 ${eok(r.dividend)}, 점유 ${(r.share * 100).toFixed(1)}%, 판매 ${r.sold.toLocaleString()}대, 모델 ${r.models}, 자본 ${eok(r.capital)}, 평판 ${r.rep.toFixed(0)}, 본사 평판 +${r.hqRep.toFixed(1)}`).join('\n'));
  return brandRuns;
}
const pick = (rs: Run[], kind: SubKind, st: SubStrategy) => rs.filter((r) => r.kind === kind && r.strategy === st);
const avg = (rs: Run[], k: keyof Run) => rs.reduce((a, r) => a + (r[k] as number), 0) / rs.length;

describe(`전략별 행동 차이(1990년 설립, ${YRS}년)`, () => {
  it('약속한 방향: 점유율 중심 점유 > 수익 중심, 수익 중심 배당 > 성장 중심의 초반 배당, 성장 중심 규모 > 안정 유지, 명성 구축 평판 최고·판매 최저, 틈새는 모델 2개 이하', () => {
    const rs = brandMatrix();
    expect(avg(pick(rs, 'value', 'share'), 'share')).toBeGreaterThan(avg(pick(rs, 'value', 'profit'), 'share'));
    for (const k of ['premium', 'value'] as SubKind[]) {
      expect(avg(pick(rs, k, 'profit'), 'earlyDiv')).toBeGreaterThan(avg(pick(rs, k, 'growth'), 'earlyDiv'));
      expect(avg(pick(rs, k, 'growth'), 'models')).toBeGreaterThan(avg(pick(rs, k, 'stable'), 'models'));
      expect(avg(pick(rs, k, 'growth'), 'capital')).toBeGreaterThan(avg(pick(rs, k, 'stable'), 'capital'));
      expect(avg(pick(rs, k, 'tech'), 'rep')).toBeGreaterThan(avg(pick(rs, k, 'growth'), 'rep'));
      for (const r of pick(rs, k, 'niche')) expect(r.models).toBeLessThanOrEqual(2);
    }
    const prem = rs.filter((r) => r.kind === 'premium');
    expect(avg(pick(rs, 'premium', 'prestige'), 'rep')).toBe(Math.max(...SUB_STRATEGIES.filter((x) => pick(prem, 'premium', x).length).map((x) => avg(pick(prem, 'premium', x), 'rep'))));
    expect(avg(pick(rs, 'premium', 'prestige'), 'sold')).toBe(Math.min(...SUB_STRATEGIES.filter((x) => pick(prem, 'premium', x).length).map((x) => avg(pick(prem, 'premium', x), 'sold'))));
    for (const r of pick(rs, 'premium', 'prestige')) expect(r.hqRep).toBeGreaterThan(YRS * 0.5);
  });
  it('한 전략이 이익·점유·평판·규모 모두에서 동시에 1등이 아니다', () => {
    const rs = brandMatrix();
    for (const k of ['premium', 'value'] as SubKind[]) {
      const sts = SUB_STRATEGIES.filter((x) => pick(rs, k, x).length), best = (key: keyof Run) => sts.reduce((a, x) => (avg(pick(rs, k, x), key) > avg(pick(rs, k, a), key) ? x : a));
      const tops = (['profit', 'share', 'rep', 'capital'] as (keyof Run)[]).map(best);
      expect(new Set(tops).size, `${k}: ${tops.join(',')}`).toBeGreaterThan(1);
      expect(tops[0], `${k} 이익 1등`).not.toBe('niche'); // 3.1.1 틈새는 이익률은 높지만 규모에 한계: 이익 총액 1등이 아니다(성장 중심·기술 선도가 위)
    }
  });
  it('너그러움: 누적 이익이 흑자이고 연 단위 적자는 드물며, 본전(설립비 + 투자)을 찾아가는 중이다. 사업 자회사도 본전을 찾는다', () => {
    const rs = brandMatrix(), loss = rs.reduce((a, r) => a + r.lossYears, 0);
    console.log(`누적 이익/투자: ${rs.map((r) => `${r.kind[0]}${S.strat[r.strategy].name} ${(r.profit / r.invested).toFixed(2)}`).join(', ')} · 적자 연도 ${loss}/${rs.length * YRS}`);
    expect(loss / (rs.length * YRS)).toBeLessThanOrEqual(0.1);
    for (const r of rs) expect(r.profit, `${r.kind} ${r.strategy}`).toBeGreaterThan(0); // 명성 구축도 누적 적자는 아니다
    expect(rs.filter((r) => r.profit > r.invested * (YRS / 10) * 0.8).length / rs.length).toBeGreaterThanOrEqual(0.8); // 10년이면 본전: YRS년에 그 몫의 80% 이상
    for (const [kind, st] of [['parts', 'growth'], ['finance', 'profit']] as [SubKind, SubStrategy][]) {
      const r = measure(kind, st);
      console.log(`${kind} ${S.strat[st].name}: 이익 ${eok(r.profit)} / 투자 ${eok(r.invested)}`);
      expect(r.profit, `${kind} ${st}`).toBeGreaterThan(r.invested * (YRS / 10)); expect(r.lossYears).toBe(0);
    }
  });
  it('경쟁사 대응: 상대의 주력 차급에서 그 경쟁사 모델의 점유가 성장 중심일 때보다 줄어든다', () => {
    const at = (st: SubStrategy) => {
      const g = Game.fromJSON(fixture());
      ok(g.command({ type: 'foundSubsidiary', kind: 'premium' }));
      const id = g.state.subs![0].id;
      if (st !== 'growth') ok(g.command({ type: 'setSubStrategy', subId: id, strategy: st, rivalId: 'porty' }));
      ticks(g, 4 * WPY);
      return g.state;
    };
    const r = at('rival'), gr = at('growth'), focus = subDetail(r, r.subs![0].id)!.rival!.bodies;
    expect(focus.length).toBeGreaterThan(0);
    const porty = (s: CarState) => focus.reduce((a, b) => a + (rivalModelsIn(s, b).find((m) => m.rivalId === 'porty')?.share ?? 0), 0);
    expect(porty(r)).toBeLessThan(porty(gr));
    expect(r.subs![0].reports.some((x) => x.text.includes('포티의 주력 차급'))).toBe(true);
  });
  it('전동화 전환: 2010년대 이익은 성장 중심보다 적지만 3분의 1은 넘고, 2030년대에는 많다', () => {
    const ev = measure('value', 'ev', 40, 4), gr = measure('value', 'growth', 40, 4), ev3 = measure('value', 'ev', 60, 4), gr3 = measure('value', 'growth', 60, 4);
    console.log(`보급형 4년 이익: 2010년대 전동화 ${eok(ev.profit)} / 성장 ${eok(gr.profit)}, 2030년대 전동화 ${eok(ev3.profit)} / 성장 ${eok(gr3.profit)}`);
    expect(ev.profit).toBeLessThan(gr.profit);
    expect(ev.profit).toBeGreaterThan(gr.profit / 3); // 3.1.1 2010년대 바닥(3.1.0은 약 15분의 1)
    expect(ev3.profit).toBeGreaterThan(gr3.profit);
  });
});

describe('봇 40년(자회사를 쓰는 편의 기능 봇)', () => {
  it('1990년 판에서 20년 더: 파산하지 않고, 자회사를 세우며, 현금은 자회사를 쓰지 않는 같은 봇의 몇 배 안이다(측정값 출력)', () => {
    const g = Game.fromJSON(JSON.parse(baseAt(20))), b = steadyBestExec({ subs: true });
    ticks(g, 20 * WPY, b);
    const a = g.state, z = JSON.parse(baseAt(40)) as CarState; // 자회사를 쓰지 않는 같은 봇은 2010년 판 그대로
    expect(a.status).toBe('playing');
    expect(a.subs!.length).toBeGreaterThan(0);
    const first = Math.min(...a.subs!.map((x) => x.founded)) / 12 + 1970;
    expect(first).toBeLessThan(2000);
    console.log(`시드 1: 2010년 현금 자회사 ${(a.cash / 1e8).toFixed(2)}조 / 없음 ${(z.cash / 1e8).toFixed(2)}조(×${(a.cash / z.cash).toFixed(2)}), 첫 설립 ${Math.floor(first)}년, 본사 ${a.hqLevel}등급`);
    expect(a.cash / z.cash).toBeLessThan(3);
  });
});
