// 3.0.0 자회사와 고급 브랜드(설계서 9.9). 자회사를 본사처럼 통째로 돌리지 않고, 브랜드 자회사는 경쟁 모델(market.ts RivalModel)과 같은 구조의
// "내 편 경쟁사"로 그 차급 수요를 나눠 갖는다. 사업 자회사(부품·금융)는 본사 원가·판매에 효과를 주고 그 규모로 이익을 낸다.
// 게임 난수를 쓰지 않는다(변화는 시드 해시). 자회사가 없는 판은 이 파일의 어떤 함수도 상태를 바꾸지 않는다. 수치는 config.subs
import { config } from '../config';
import { BODIES, COMPAT, RIVALS, SUB_DATA, TECHS, bodyById, segmentById } from '../data';
import { salaryOf, unitCost } from './cars';
import { costMultOf } from './company';
import { withRequired } from './dev';
import { addNews, chargingInfra, eraNow, marketMult, rivalHitAdd, trendOf } from './events';
import { diffOf } from './difficulty';
import { josa } from './josa';
import { basePriceOf, bodyKey, cellMonthly, monthlyDemand, rivalA, rivalBase, subPull, subSalesMult, toSaleCar } from './market';
import { myCellShare } from './rivals';
import { ptCostAdd, unlockedBodies, unlockedPowertrains } from './research';
import { hash01 } from './rng';
import { monthOf, monthTime, yearOf, yearOfMonth } from './time';
import { STATS, type CarState, type Command, type CommandResult, type GameEvent, type Staff, type Stats, type SubKind, type SubModel, type SubMonth, type SubStrategy, type Subsidiary } from './types';

const S = config.subs;
const EV = config.events.charging.powertrain;
export const SUB_KINDS: SubKind[] = ['premium', 'value', 'parts', 'finance'];
export const SUB_STRATEGIES: SubStrategy[] = ['growth', 'share', 'profit', 'rival', 'tech', 'stable', 'niche', 'prestige', 'ev'];
export const SHARE_NAMES = ['좁게', '보통', '넓게'] as const;
type BrandKind = 'premium' | 'value';
type StratKey = 'a' | 'price' | 'cost' | 'dev' | 'vol' | 'payout';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const won = (x: number): string => { const v = Math.abs(x); return `${x < 0 ? '−' : ''}${v >= 10000 ? `${(v / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}억원` : `${Math.round(v).toLocaleString()}만원`}`; };
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const isBrand = (k: SubKind): k is BrandKind => k === 'premium' || k === 'value';
const brandDef = (k: BrandKind) => S.kinds[k];
export const subById = (s: CarState, id: number): Subsidiary | undefined => s.subs?.find((x) => x.id === id);
export const stratName = (k: SubStrategy): string => S.strat[k].name;

// ---------- 전략 전환과 효과 ----------
/** 전환 진행(0~1): 바꾼 달부터 switchMonths개월에 걸쳐 1 */
export const switchProgress = (sub: Subsidiary, m: number): number => clamp((m - sub.switchMonth) / S.switchMonths, 0, 1);
/** 이번 달 전략 비중: 바꾸던 때의 비중(mix)에서 지금 전략으로 직선으로 옮겨 간다 */
export function stratWeights(sub: Subsidiary, m: number): [SubStrategy, number][] {
  const p = switchProgress(sub, m), w = new Map<SubStrategy, number>();
  for (const k of SUB_STRATEGIES) { const v = (sub.mix[k] ?? 0) * (1 - p) + (k === sub.strategy ? p : 0); if (v > 0) w.set(k, v); }
  return [...w];
}
/** 전략 효과 하나를 비중대로 섞은 값 */
const fx = (sub: Subsidiary, m: number, key: StratKey): number => stratWeights(sub, m).reduce((a, [k, w]) => a + w * S.strat[k][key], 0);
const presQ = (sub: Subsidiary): number => (sub.president ? sub.president.ability / 100 : S.noPres);

/** 본사 기술 수준: 그해까지 나온(반복 제외) 기술 중 연구를 마친 몫 */
export function techLevel(s: CarState): number {
  const y = yearOf(s.week), out = TECHS.filter((t) => !t.repeatable && t.year <= y), done = new Set(s.research.done);
  return out.length ? out.filter((t) => done.has(t.id)).length / out.length : 0;
}
/** 경쟁사 대응의 상대: 지정한 회사, 없으면 지금 가장 큰 경쟁사(차급별 세기 × 칸 규모의 합) */
export function rivalTarget(s: CarState, sub: Subsidiary): string {
  if (sub.rivalId && s.rivals.some((r) => r.id === sub.rivalId)) return sub.rivalId;
  const t = monthTime(monthOf(s.week)), size = (r: CarState['rivals'][number]) => Object.keys(r.cells).reduce((a, b) => a + r.cells[b] * cellMonthly(b, t), 0);
  return [...s.rivals].sort((a, b) => size(b) - size(a) || (a.id < b.id ? -1 : 1))[0].id;
}
/** 상대 경쟁사의 주력 차급(세기 × 칸 규모 상위 2개, 이 자회사가 맡은 차급 안에서) */
export function rivalFocus(s: CarState, sub: Subsidiary): string[] {
  const r = s.rivals.find((x) => x.id === rivalTarget(s, sub))!, t = monthTime(monthOf(s.week));
  return sub.bodies.filter((b) => r.cells[b] !== undefined && cellMonthly(b, t) > 0).sort((a, b) => r.cells[b] * cellMonthly(b, t) - r.cells[a] * cellMonthly(a, t) || (a < b ? -1 : 1)).slice(0, 2);
}

/** 새 세대의 기본 A = 그때 경쟁 차 기본 A + 종류 + 전략 + 공유 범위 + 사장 + 본사 기술 + 본사 투자 + 브랜드 평판 ± 해시 */
function newBase(s: CarState, sub: Subsidiary, body: string, n: number, m: number): number {
  const k = brandDef(sub.kind as BrandKind), w = stratWeights(sub, m), focus = w.some(([x]) => x === 'rival') ? rivalFocus(s, sub) : [];
  const strat = w.reduce((a, [x, v]) => a + v * (x === 'rival' && !focus.includes(body) ? 0 : S.strat[x].a), 0);
  const noiseMult = w.reduce((a, [x, v]) => a + v * ('noise' in S.strat[x] ? (S.strat[x] as { noise: number }).noise : 1), 0);
  const invest = clamp(S.investA * Math.log2(Math.max(1, sub.total.invested / S.kinds[sub.kind].cost)), 0, S.investMax);
  return rivalBase(m) + k.a + strat + S.shareFx[sub.share].a + S.presA * (presQ(sub) - 0.5) + S.techA * (techLevel(s) - 1) + invest
    + S.repA * (Math.min(sub.rep, S.repCap) - 100) / 100 + (hash01(s.seed, 30, sub.id, bodyKey(body), n) * 2 - 1) * S.noise * noiseMult;
}
const cycleOf = (s: CarState, sub: Subsidiary, body: string, n: number): number => S.strat[sub.strategy].cycle + Math.floor((hash01(s.seed, 31, sub.id, bodyKey(body), n) * 2 - 1) * 6);
const ptOf = (md: Pick<SubModel, 'ev'>): string => (md.ev ? EV : 'gasoline');
/** 대당 가격(시장 기준가 × 종류 × 전략) */
export const subPrice = (s: CarState, sub: Subsidiary, md: Pick<SubModel, 'body' | 'ev'>): number => basePriceOf(s, md.body, ptOf(md)) * brandDef(sub.kind as BrandKind).price * fx(sub, monthOf(s.week), 'price');
/** 대당 원가(본사 공장·연구·부품 자회사 혜택을 함께 쓴다) × 종류 × 전략 × 공유 범위 × 사장 */
export function subUnitCost(s: CarState, sub: Subsidiary, md: Pick<SubModel, 'body' | 'ev'>): number {
  const pt = ptOf(md), mult = costMultOf(s, pt) * brandDef(sub.kind as BrandKind).unitCost * fx(sub, monthOf(s.week), 'cost') * S.shareFx[sub.share].cost * (1 - S.presCost * (presQ(sub) - 0.5) * 2);
  return unitCost(md.body, pt, 2, withRequired(s, []), mult, ptCostAdd(s, pt));
}
/** 브랜드 인지도(0~1): 브랜드 평판이 높을수록 */
export const subAwareness = (sub: Subsidiary): number => Math.min(1, S.aw.base + Math.min(sub.rep, S.repCap) / S.aw.repDiv);
/** 이번 달 점유 점수 a = 세기(경쟁 차와 같은 노화) × 고객층 궁합 × 가격 효과 × 브랜드 인지도 */
function effA(sub: Subsidiary, md: SubModel, m: number): number {
  const seg = sub.segment ?? brandDef(sub.kind as BrandKind).segment;
  return rivalA(md, m) * (COMPAT[md.body]?.[seg] ?? 1) * fx(sub, m, 'price') ** -S.pricePe * subAwareness(sub);
}
/** 한 모델의 이번 달 수요(생산 한도 전): 칸 규모(시대 사건·유행·동력) × (1 − 본사 몫) × a^지수 ÷ (경쟁 차 + 자회사 모델) × 종류·전략 물량 */
function subDemand(s: CarState, sub: Subsidiary, md: SubModel, m: number): number {
  const t = monthTime(m), n = eraNow(s.seed, m), pt = ptOf(md), e = config.market.shareExp, rm = diffOf(s).rivalMult;
  const size = cellMonthly(md.body, t) * (n.body[md.body] ?? 1) * marketMult(n) * trendOf(md.body, t, n) * trendOf(pt, t, n) * (n.pt[pt] ?? 1) * (md.ev ? chargingInfra(s.seed, m) : 1);
  const rivals = s.rivals.reduce((a, r) => a + (((r.cells[md.body] ?? 0) + rivalHitAdd(s, r.id, md.body, m)) * rm) ** e, 0), tot = rivals + subPull(s, md.body);
  return tot > 0 ? size * (1 - myCellShare(s, md.body)) * md.a ** e / tot * brandDef(sub.kind as BrandKind).vol * fx(sub, m, 'vol') : 0;
}
/** 월 생산 한도(대) */
export const subCapacity = (sub: Subsidiary): number => Math.floor(sub.capital / S.capPerCar);
/** 모델 수 상한(자본, 맡은 차급 수 이내) */
export const subModelCap = (s: CarState, sub: Subsidiary): number => Math.max(1, Math.min(areaBodies(s, sub).length, Math.floor(sub.capital / S.capitalPerModel)));
/** 맡은 차급 중 본사가 연구로 연 것(기술·차대 공유) */
export const areaBodies = (s: CarState, sub: Pick<Subsidiary, 'bodies'>): string[] => { const u = new Set(unlockedBodies(s).map((b) => b.id)); return sub.bodies.filter((b) => u.has(b)); };
const evReady = (s: CarState): boolean => unlockedPowertrains(s).some((p) => p.id === EV);
/** 전략이 바라는 모델 수 */
function targetCount(s: CarState, sub: Subsidiary): number {
  const cap = subModelCap(s, sub), mx = S.strat[sub.strategy].max, kept = sub.models.filter((x) => x.keep).length;
  return Math.max(kept, mx === 0 ? cap : mx < 0 ? Math.min(cap, Math.max(1, sub.models.length)) : Math.min(cap, mx));
}
/** 새 모델을 낼 차급(전략별): 상대의 주력 차급 / 경쟁이 약한 차급 / 가장 비싼 차급 / 큰 칸 */
function pickBody(s: CarState, sub: Subsidiary, m: number): string | null {
  const t = monthTime(m), e = config.market.shareExp, have = new Set(sub.models.map((x) => x.body));
  const cand = areaBodies(s, sub).filter((b) => !have.has(b) && !sub.dropped.includes(b) && cellMonthly(b, t) > 0);
  if (!cand.length) return null;
  const focus = sub.strategy === 'rival' ? rivalFocus(s, sub) : [];
  const seg = sub.segment ?? brandDef(sub.kind as BrandKind).segment, mineIn = (b: string) => s.nameplates.some((n) => n.generations.some((g) => g.body === b && g.status !== 'discontinued'));
  const score = (b: string): number => {
    const big = cellMonthly(b, t) * bodyById(b).basePrice * (COMPAT[b]?.[seg] ?? 1);
    switch (sub.strategy) {
      case 'prestige': return bodyById(b).basePrice;
      case 'rival': return (focus.includes(b) ? 1e12 : 0) + big;
      case 'niche': return big / (s.rivals.reduce((a, r) => a + (r.cells[b] ?? 0) ** e, 0) + subPull(s, b) + (mineIn(b) ? 1 : 0) + 1e-9); // 경쟁 차·자회사·본사 차가 적은 칸
      default: return big;
    }
  };
  return cand.sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1))[0];
}
/** 모델 이름: 자료 목록을 시드 해시로 섞어 본사 차종·다른 자회사 모델과 겹치지 않는 첫 이름 */
function newModelName(s: CarState, sub: Subsidiary, body: string): string {
  const used = new Set([...s.nameplates.map((n) => n.name), ...(s.subs ?? []).flatMap((x) => x.models.map((md) => md.name))]);
  const order = SUB_DATA.models.map((nm, i) => [hash01(s.seed, 32, sub.id, i), nm] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return order.find((nm) => !used.has(nm)) ?? `${sub.name} ${bodyById(body).name}`;
}
/** 추정 평론(경쟁 모델과 같은 셈: 6 + (기본 A − 그때 경쟁 차 기본 A) × 10) */
const criticOf = (md: SubModel): number => r1(clamp(config.rivals.view.criticMid + (md.base - rivalBase(Math.max(0, md.start))) * config.rivals.view.criticPer, 1, 10));
const news = (s: CarState, ev: GameEvent[], sub: Subsidiary, text: string) => { addNews(s, ev, text, 'sub', 'news', sub.id, 'sub'); report(s, sub, text); };
const report = (s: CarState, sub: Subsidiary, text: string) => { sub.reports.push({ week: s.week, text }); if (sub.reports.length > S.reportsMax) sub.reports.splice(0, sub.reports.length - S.reportsMax); };
function launchModel(s: CarState, ev: GameEvent[], sub: Subsidiary, md: SubModel, first: boolean): void {
  if (criticOf(md) >= 7) sub.rep += 1; // 평론이 좋은 새 모델은 브랜드 평판 +1
  const shared = sub.share === 2 ? ' 평론가들은 본사 차의 판박이라고 평했다.' : '';
  news(s, ev, sub, `「${sub.name}」, 「${md.name}」 ${first ? '' : `${md.n + 1}세대 `}출시. ${bodyById(md.body).name}${md.ev ? ' 전기차' : ''}, 추정 평론 ${criticOf(md).toFixed(1)}.${shared}`);
}

// ---------- 월 결산 ----------
/** 월말 1단계(본사 판매 계산 전): 전환 완료 알림, 라인업(영역 밖 정리·세대교체·단종·추가 한 대), 이번 달 점유 점수, 사업 자회사 효과 */
export function subsMonthStart(s: CarState, ev: GameEvent[], m: number): void {
  for (const sub of [...(s.subs ?? [])].sort((a, b) => a.id - b.id)) {
    if (switchProgress(sub, m) >= 1 && (Object.keys(sub.mix).length !== 1 || !sub.mix[sub.strategy])) {
      sub.mix = { [sub.strategy]: 1 };
      news(s, ev, sub, `「${sub.name}」, ${stratName(sub.strategy)} 전략으로의 전환을 마쳤습니다.`);
    }
    if (!isBrand(sub.kind)) {
      const q = bizScale(sub) * S.bizFx[sub.strategy].fx;
      sub.effect = sub.kind === 'parts' ? Math.min(S.parts.cutMax, S.parts.cut * q) : Math.min(S.finance.boostMax, S.finance.boost * q);
      continue;
    }
    const area = new Set(areaBodies(s, sub)), wantEv = sub.strategy === 'ev' && evReady(s);
    for (const md of sub.models.filter((x) => !area.has(x.body))) { sub.models = sub.models.filter((x) => x !== md); news(s, ev, sub, `「${sub.name}」, 맡은 영역에서 빠진 「${md.name}」${josa(md.name, '을/를')} 단종했습니다.`); }
    const target = targetCount(s, sub);
    for (const md of [...sub.models].sort((a, b) => (a.body < b.body ? -1 : 1))) {
      if (m - md.start < md.cycle) continue;
      if (!md.keep && sub.models.length > target) { // 세대교체 대신 단종(전략이 모델 수를 줄인다)
        sub.models = sub.models.filter((x) => x !== md);
        news(s, ev, sub, `「${sub.name}」, ${stratName(sub.strategy)} 전략에 따라 「${md.name}」${josa(md.name, '을/를')} 후속 없이 단종했습니다.`);
        continue;
      }
      const n = md.n + 1;
      Object.assign(md, { n, start: m, cycle: cycleOf(s, sub, md.body, n), base: newBase(s, sub, md.body, n, m) });
      if (wantEv) md.ev = true; else if (sub.strategy !== 'ev') delete md.ev;
      launchModel(s, ev, sub, md, false);
    }
    if (sub.models.length < target) { // 한 달에 한 대까지
      const body = pickBody(s, sub, m);
      if (body) {
        const md: SubModel = { body, name: newModelName(s, sub, body), n: 0, start: m, cycle: cycleOf(s, sub, body, 0), base: newBase(s, sub, body, 0, m), a: 0, sold: 0, ...(wantEv ? { ev: true as const } : {}) };
        sub.models.push(md); sub.models.sort((a, b) => (a.body < b.body ? -1 : 1));
        launchModel(s, ev, sub, md, true);
      }
    }
    for (const md of sub.models) md.a = effA(sub, md, m);
  }
}
/** 사업 자회사 규모 = min(scaleMax, √(자본 ÷ 설립비)) × 사장 배수 */
const bizScale = (sub: Subsidiary): number => Math.min(S.scaleMax, Math.sqrt(sub.capital / S.kinds[sub.kind].cost)) * (0.75 + presQ(sub) / 2);
/** 사장 월급(직원 월급 + 수당, 자회사가 낸다) */
const presPay = (sub: Subsidiary): number => (sub.president ? salaryOf(sub.president.ability) + S.presAllowance : 0);

export interface SubSettle { dividend: number; rep: { name: string; value: number }[] }
/** 월말 2단계(본사 판매 뒤): 판매·이익·배당·재투자, 분기 보고, 연말 평판. hq: 이번 달 본사 매출·원가 */
export function subsSettle(s: CarState, ev: GameEvent[], m: number, hq: { revenue: number; cogs: number }): SubSettle {
  const out: SubSettle = { dividend: 0, rep: [] };
  for (const sub of [...(s.subs ?? [])].sort((a, b) => a.id - b.id)) {
    let sold = 0, demand = 0, revenue = 0, cost = 0;
    if (isBrand(sub.kind)) {
      const d = sub.models.map((md) => subDemand(s, sub, md, m)), tot = d.reduce((a, x) => a + x, 0), cap = subCapacity(sub), k = tot > cap ? cap / tot : 1;
      sub.models.forEach((md, i) => {
        md.sold = Math.floor(d[i] * k); sold += md.sold; demand += d[i];
        revenue += md.sold * subPrice(s, sub, md); cost += md.sold * subUnitCost(s, sub, md);
        cost += basePriceOf(s, md.body) * S.dev * fx(sub, m, 'dev') * S.shareFx[sub.share].dev; // 개발비(모델마다 매달)
      });
    } else {
      const B = sub.kind === 'parts' ? S.parts.margin : S.finance.financed * S.finance.spread;
      revenue = (sub.kind === 'parts' ? hq.cogs : hq.revenue) * B * bizScale(sub) * S.bizFx[sub.strategy].margin;
    }
    cost += (isBrand(sub.kind) ? Math.min(sub.capital, sold * S.capPerCar) : sub.capital) * S.upkeep + presPay(sub); // 유지비: 브랜드는 쓰는 설비(판매 대수 × 대당 자본)만큼, 사업 자회사는 자본만큼
    const profit = revenue - cost, payout = Math.min(1, sub.dividend / 100 * fx(sub, m, 'payout')), dividend = profit > 0 ? profit * payout : 0;
    sub.capital = Math.max(0, sub.capital + profit - dividend); // 손실은 자회사 자본이 떠안는다(본사로 넘어오지 않는다)
    out.dividend += dividend;
    const row: SubMonth = { month: m, sold, demand: Math.round(demand), revenue, profit, dividend };
    sub.months.push(row); if (sub.months.length > S.monthsMax) sub.months.splice(0, sub.months.length - S.monthsMax);
    Object.assign(sub.total, { profit: sub.total.profit + profit, dividend: sub.total.dividend + dividend, sold: sub.total.sold + sold });
    if (m % 3 === 2) quarterReport(s, ev, sub, m);
    if ((m + 1) % config.time.monthsPerYear === 0) { // 연말: 브랜드 평판(전략 가산, 본사 평판 쪽으로 조금씩), 본사 평판 가산
      const w = stratWeights(sub, m), subRep = w.reduce((a, [x, v]) => a + v * S.strat[x].subRep, 0), hqRep = w.reduce((a, [x, v]) => a + v * S.strat[x].hqRep, 0);
      const base = isBrand(sub.kind) ? brandDef(sub.kind).rep0 : 0.5;
      sub.rep = Math.max(0, sub.rep + subRep + (s.reputation * base - sub.rep) * S.repDrift);
      if (hqRep > 0 && isBrand(sub.kind)) { out.rep.push({ name: sub.name, value: hqRep }); sub.total.hqRep += hqRep; }
    }
  }
  return out;
}
/** 분기 보고 한 줄: 전략에 따른 행동(가격을 바꿨으면 그 폭) + 실적 */
function quarterReport(s: CarState, ev: GameEvent[], sub: Subsidiary, m: number): void {
  const q = sub.months.slice(-3), sold = q.reduce((a, x) => a + x.sold, 0), profit = q.reduce((a, x) => a + x.profit, 0), div = q.reduce((a, x) => a + x.dividend, 0);
  const head = `[「${sub.name}」 ${yearOfMonth(m)}년 ${Math.floor((m % 12) / 3) + 1}분기 보고]`, sn = stratName(sub.strategy);
  let act: string;
  if (!isBrand(sub.kind)) act = sub.kind === 'parts' ? `본사 차의 대당 원가를 ${pct(sub.effect, 1)} 줄였습니다` : `할부로 본사 판매를 ${pct(sub.effect, 1)} 늘렸습니다`;
  else {
    const pm = fx(sub, m, 'price'), dp = Math.round((pm / sub.lastPrice - 1) * 100), cap = subCapacity(sub), dem = q.at(-1)?.demand ?? 0;
    sub.lastPrice = pm;
    const evN = sub.models.filter((x) => x.ev).length, focus = sub.strategy === 'rival' ? rivalFocus(s, sub) : [];
    act = dp <= -1 ? `${sn} 전략에 따라 가격을 ${-dp}% 내렸습니다` : dp >= 1 ? `${sn} 전략에 따라 가격을 ${dp}% 올렸습니다`
      : ({
        growth: `${sn} 전략에 따라 모델 ${sub.models.length}개, 월 생산 한도 ${cap.toLocaleString()}대로 키우고 있습니다${dem > cap ? '. 주문이 생산 한도를 넘어 본사의 추가 투자가 필요합니다' : ''}`,
        share: `${sn} 전략에 따라 가격을 기준의 ${Math.round(pm * 100)}%로 두고 광고를 늘렸습니다`,
        profit: `${sn} 전략에 따라 가격을 유지하고 원가와 개발비를 줄였습니다`,
        rival: `${sn} 전략에 따라 ${RIVALS.find((r) => r.id === rivalTarget(s, sub))?.name ?? ''}의 주력 차급(${focus.map((b) => bodyById(b).name).join('·') || '없음'})에 맞불 모델을 두고 있습니다`,
        tech: `${sn} 전략에 따라 최신 기술과 고급 장비에 개발비를 더 썼습니다`,
        stable: `${sn} 전략에 따라 지금 라인업의 세대교체만 하고 있습니다`,
        niche: `${sn} 전략에 따라 경쟁 모델이 적은 차급(${sub.models.map((x) => bodyById(x.body).name).join('·') || '없음'})에 집중했습니다`,
        prestige: `${sn} 전략에 따라 소량 고급 모델로 평론과 평판을 노리고 있습니다`,
        ev: `${sn} 전략에 따라 라인업을 전기차로 바꾸고 있습니다(전기차 ${evN}/${sub.models.length})`,
      } as Record<SubStrategy, string>)[sub.strategy];
  }
  news(s, ev, sub, `${head} ${act}. ${isBrand(sub.kind) ? `판매 ${sold.toLocaleString()}대, ` : ''}이익 ${won(profit)}, 배당 ${won(div)}.`);
}

// ---------- 명령 ----------
export interface SubCtx { s: CarState; spend: (c: number) => void }
const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };
/** 자회사를 세울 수 없는 이유(없으면 null) */
export function foundError(s: CarState, kind: SubKind): string | null {
  if (!SUB_KINDS.includes(kind)) return '없는 자회사 종류입니다.';
  const K = S.kinds[kind], max = S.maxByHq[s.hqLevel - 1] ?? 0, n = s.subs?.length ?? 0;
  if (s.hqLevel < S.hqMin) return `자회사는 본사 ${S.hqMin}등급(${config.hq.levels[S.hqMin - 1].name})부터 세울 수 있습니다.`;
  if (s.subs?.some((x) => x.kind === kind)) return `이미 ${K.name}${josa(K.name, '이/가')} 있습니다. 종류마다 한 곳만 둘 수 있습니다.`;
  if (n >= max) { const nx = S.maxByHq.findIndex((v) => v > max); return `본사 ${s.hqLevel}등급에서는 자회사를 ${max}곳까지 둘 수 있습니다.${nx >= 0 ? ` 본사 ${nx + 1}등급이면 ${S.maxByHq[nx]}곳까지 둘 수 있습니다.` : ''}`; }
  if (s.reputation < K.rep) return `${K.name}${josa(K.name, '은/는')} 평판 ${K.rep} 이상이어야 세울 수 있습니다(지금 ${Math.floor(s.reputation)}).`;
  if (isBrand(kind) && !areaBodies(s, { bodies: brandDef(kind).bodies }).length) return `${K.name}${josa(K.name, '이/가')} 맡을 차급을 아직 연구하지 않았습니다.`;
  if (s.cash < K.cost) return `현금이 모자랍니다(설립비 ${won(K.cost)}).`;
  return null;
}
/** 전략을 고를 수 없는 이유(없으면 null) */
export function strategyError(s: CarState, sub: Pick<Subsidiary, 'kind'>, k: SubStrategy): string | null {
  if (!SUB_STRATEGIES.includes(k)) return '없는 전략입니다.';
  if (!isBrand(sub.kind)) return (S.business as readonly string[]).includes(k) ? null : `사업 자회사는 ${S.business.map((x) => stratName(x as SubStrategy)).join('·')} 전략만 고를 수 있습니다.`;
  if (S.notFor[sub.kind]?.includes(k)) return k === 'share' ? '고급 브랜드는 가격을 내려 점유율을 좇으면 브랜드 가치가 떨어집니다. 다른 전략을 고르세요.' : '보급형 브랜드는 소량 고급 모델을 낼 수 없습니다. 고급 브랜드에서 고르세요.';
  if (k === 'ev' && yearOf(s.week) < S.evFrom) return `전동화 전환은 ${S.evFrom}년부터 고를 수 있습니다.`;
  if (k === 'ev' && !evReady(s)) return '본사가 전기차 기술을 연구해야 전동화 전환을 고를 수 있습니다.';
  return null;
}
const nameError = (s: CarState, name: string, own?: string): string | null => {
  if (!name) return '이름을 입력하세요.';
  if ([...name].length > config.nameMax) return `이름은 ${config.nameMax}자까지 쓸 수 있습니다.`;
  if (name === own) return '지금 이름과 같습니다.';
  if (name === s.companyName || s.subs?.some((x) => x.name === name)) return `「${name}」${josa(name, '은/는')} 이미 쓰는 회사 이름입니다.`;
  return null;
};
const subOf = (s: CarState, id: number): Subsidiary | string => subById(s, id) ?? '없는 자회사입니다.';
const brandOnly = (sub: Subsidiary): string | null => (isBrand(sub.kind) ? null : '사업 자회사에는 없는 설정입니다.');
/** 사장 자리에서 직원 목록으로 돌려보낸다(임원 해임과 같다) */
const releasePresident = (s: CarState, sub: Subsidiary) => { if (sub.president) { s.staff.push(sub.president); s.staff.sort((a, b) => a.id - b.id); sub.president = null; } };

/** 자회사 명령. 자회사 명령이 아니면 null */
export function subCommand(c: SubCtx, cmd: Command, ev: GameEvent[]): CommandResult | null {
  const s = c.s, m = monthOf(s.week);
  switch (cmd.type) {
    case 'foundSubsidiary': {
      const err = foundError(s, cmd.kind); if (err) return fail(err);
      const K = S.kinds[cmd.kind], name = (cmd.name ?? '').trim() || SUB_DATA.names[cmd.kind].replace('{회사}', s.companyName);
      const ne = nameError(s, name); if (ne) return fail(ne);
      if (cmd.color !== undefined && !/^#[0-9a-f]{6}$/i.test(cmd.color)) return fail('로고 색이 올바르지 않습니다.');
      const brand = isBrand(cmd.kind), strategy: SubStrategy = brand ? 'growth' : 'stable';
      const sub: Subsidiary = {
        id: s.nextId++, kind: cmd.kind, name, color: cmd.color ?? K.color, founded: m, strategy, rivalId: null, mix: { [strategy]: 1 }, switchMonth: m - S.switchMonths,
        bodies: brand ? [...brandDef(cmd.kind as BrandKind).bodies] : [], segment: brand ? brandDef(cmd.kind as BrandKind).segment : null, dropped: [],
        dividend: S.defaultSub.dividend, share: S.defaultSub.share as 0 | 1 | 2, president: null, capital: K.cost, rep: s.reputation * (brand ? brandDef(cmd.kind as BrandKind).rep0 : 0.5), effect: 0,
        models: [], months: [], total: { invested: K.cost, profit: 0, dividend: 0, sold: 0, hqRep: 0 }, reports: [], lastPrice: 1,
      };
      c.spend(K.cost); s.pendingSubInv = (s.pendingSubInv ?? 0) + K.cost;
      (s.subs ??= []).push(sub);
      news(s, ev, sub, `${s.companyName}, ${K.name} 「${name}」${josa(name, '을/를')} 세웠습니다. 설립비 ${won(K.cost)}, 전략 ${stratName(strategy)}.`);
      return { ok: true, events: ev };
    }
    case 'setSubStrategy': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const err = strategyError(s, sub, cmd.strategy); if (err) return fail(err);
      const rid = cmd.strategy === 'rival' ? cmd.rivalId ?? null : null;
      if (rid !== null && !s.rivals.some((r) => r.id === rid)) return fail('없는 경쟁사입니다.');
      if (cmd.strategy === sub.strategy) {
        if (rid === sub.rivalId) return fail('이미 그 전략입니다.');
        sub.rivalId = rid; return OK; // 상대만 바꾸면 전환 기간 없이
      }
      sub.mix = Object.fromEntries(stratWeights(sub, m)); sub.switchMonth = m; sub.strategy = cmd.strategy; sub.rivalId = rid;
      return OK;
    }
    case 'setSubArea': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const be = brandOnly(sub); if (be) return fail(be);
      const K = brandDef(sub.kind as BrandKind), bodies = Array.isArray(cmd.bodies) ? cmd.bodies : [];
      if (!bodies.length || new Set(bodies).size !== bodies.length) return fail('맡을 차급을 하나 이상, 겹치지 않게 고르세요.');
      const bad = bodies.find((b) => !K.bodies.includes(b));
      if (bad) return fail(`${K.name}${josa(K.name, '은/는')} ${BODIES.some((x) => x.id === bad) ? bodyById(bad).name : '그 차급'}${josa(BODIES.some((x) => x.id === bad) ? bodyById(bad).name : '그 차급', '을/를')} 맡을 수 없습니다.`);
      const seg = cmd.segment ?? null;
      if (seg !== null && !K.segments.includes(seg)) return fail(`${K.name}${josa(K.name, '이/가')} 맡을 수 있는 고객층은 ${K.segments.map((x) => segmentById(x).name).join('·')}입니다.`);
      sub.bodies = [...bodies]; sub.segment = seg ?? K.segment; sub.dropped = sub.dropped.filter((b) => bodies.includes(b)); // 영역 밖 모델은 월말에 단종
      return OK;
    }
    case 'setSubDividend': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      if (!Number.isInteger(cmd.pct) || cmd.pct < 0 || cmd.pct > 100) return fail('배당 비율은 0~100% 사이 정수여야 합니다.');
      sub.dividend = cmd.pct; return OK;
    }
    case 'investSub': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      if (!Number.isFinite(cmd.amount) || cmd.amount <= 0) return fail('투자할 금액이 올바르지 않습니다.');
      if (cmd.amount > s.cash) return fail('현금이 모자랍니다.');
      c.spend(cmd.amount); s.pendingSubInv = (s.pendingSubInv ?? 0) + cmd.amount;
      sub.capital += cmd.amount; sub.total.invested += cmd.amount;
      return OK;
    }
    case 'setSubPresident': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      if (cmd.staffId === null) { if (!sub.president) return fail('사장이 없습니다.'); releasePresident(s, sub); return OK; }
      const x = s.staff.find((y) => y.id === cmd.staffId); if (!x) return fail('없는 직원입니다.');
      releasePresident(s, sub);
      x.projectId = null; x.lab = false; // 본사 일에서 빠진다(임원 임명과 같다)
      s.staff = s.staff.filter((y) => y !== x); sub.president = x;
      for (const r of s.execs?.replacements ?? []) if (r.staffId === x.id && (r.status === 'proposed' || r.status === 'approved' || r.status === 'waiting')) { r.status = 'cancelled'; r.waitingFor = null; }
      return OK;
    }
    case 'setSubShare': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const be = brandOnly(sub); if (be) return fail(be);
      if (cmd.share !== 0 && cmd.share !== 1 && cmd.share !== 2) return fail('공유 범위는 좁게·보통·넓게 중에서 고르세요.');
      if (cmd.share === sub.share) return fail('지금 공유 범위와 같습니다.');
      sub.share = cmd.share; return OK; // 다음 세대부터 세기에, 원가·개발비는 바로
    }
    case 'subAddModel': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const be = brandOnly(sub); if (be) return fail(be);
      if (!sub.bodies.includes(cmd.body)) return fail('맡은 영역에 없는 차급입니다. 먼저 영역에 넣으세요.');
      if (!areaBodies(s, sub).includes(cmd.body)) return fail('본사가 아직 연구하지 않은 차급입니다.');
      if (sub.models.some((x) => x.body === cmd.body)) return fail('이미 그 차급에 모델이 있습니다.');
      if (sub.models.length >= subModelCap(s, sub)) return fail(`자본이 모자라 모델을 더 둘 수 없습니다(지금 상한 ${subModelCap(s, sub)}개, 모델 하나에 자본 ${won(S.capitalPerModel)}). 투자하면 늘어납니다.`);
      const wantEv = sub.strategy === 'ev' && evReady(s);
      const md: SubModel = { body: cmd.body, name: newModelName(s, sub, cmd.body), n: 0, start: m, cycle: cycleOf(s, sub, cmd.body, 0), base: newBase(s, sub, cmd.body, 0, m), a: 0, sold: 0, keep: true, ...(wantEv ? { ev: true as const } : {}) };
      md.a = effA(sub, md, m);
      sub.models.push(md); sub.models.sort((a, b) => (a.body < b.body ? -1 : 1)); sub.dropped = sub.dropped.filter((b) => b !== cmd.body);
      launchModel(s, ev, sub, md, true);
      return { ok: true, events: ev };
    }
    case 'subDropModel': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const md = sub.models.find((x) => x.body === cmd.body); if (!md) return fail('그 차급에 모델이 없습니다.');
      sub.models = sub.models.filter((x) => x !== md); sub.dropped.push(md.body);
      news(s, ev, sub, `「${sub.name}」, 본사 지시로 「${md.name}」${josa(md.name, '을/를')} 단종했습니다.`);
      return { ok: true, events: ev };
    }
    case 'renameSubModel': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const md = sub.models.find((x) => x.body === cmd.body); if (!md) return fail('그 차급에 모델이 없습니다.');
      const name = typeof cmd.name === 'string' ? cmd.name.trim() : '';
      if (!name) return fail('이름을 입력하세요.');
      if ([...name].length > config.nameMax) return fail(`이름은 ${config.nameMax}자까지 쓸 수 있습니다.`);
      if (name === md.name) return fail('지금 이름과 같습니다.');
      if (s.nameplates.some((n) => n.name === name) || s.subs!.some((x) => x.models.some((y) => y.name === name))) return fail(`「${name}」${josa(name, '은/는')} 이미 있는 차 이름입니다.`);
      md.name = name; return OK;
    }
    case 'sellSubsidiary': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const price = Math.round(sub.capital * S.sellShare);
      c.spend(-price); releasePresident(s, sub);
      s.subs = s.subs!.filter((x) => x !== sub);
      addNews(s, ev, `${s.companyName}, 자회사 「${sub.name}」${josa(sub.name, '을/를')} ${won(price)}에 매각했습니다.`, 'sub', 'news', undefined, 'sub');
      return { ok: true, events: ev };
    }
    default: return null;
  }
}

// ---------- 조회(화면용) ----------
const SHAPE = SUB_DATA.shape as Record<BrandKind, Stats>;
/** 자회사 모델 한 대의 겉으로 보이는 값(경쟁 모델 RivalModelView와 같은 이름의 값 + 내 자회사 표시) */
export interface SubModelView { own: true; subId: number; company: string; color: string; body: string; bodyName: string; name: string; n: number; number: number; start: number; year: number; critic: number; grades: Stats; price: number; unitCost: number; share: number; sold: number; ev: boolean; keep: boolean; seed: number }
export function subModelView(s: CarState, sub: Subsidiary, md: SubModel): SubModelView {
  const m = monthOf(s.week), V = config.rivals.view, c0 = criticOf(md), now = c0 - (1 - rivalA(md, m) / (md.base * (1 + config.rivals.fresh))) * V.criticPer;
  const grades = Object.fromEntries(STATS.map((k, i) => [k, r1(clamp(now + SHAPE[sub.kind as BrandKind][k] + (hash01(s.seed, 33, sub.id, bodyKey(md.body), md.n, i) * 2 - 1) * V.statJitter, 0, 10))])) as Stats;
  const size = cellMonthly(md.body, monthTime(m));
  return { own: true, subId: sub.id, company: sub.name, color: sub.color, body: md.body, bodyName: bodyById(md.body).name, name: md.name, n: md.n, number: md.n + 1, start: md.start, year: yearOfMonth(md.start), critic: c0, grades,
    price: Math.round(subPrice(s, sub, md) / 10) * 10, unitCost: Math.round(subUnitCost(s, sub, md)), share: size > 0 ? Math.min(1, md.sold / size) : 0, sold: md.sold, ev: !!md.ev, keep: !!md.keep, seed: Math.floor(hash01(s.seed, 34, sub.id, bodyKey(md.body), md.n) * 2 ** 31) };
}
/** 한 차급의 내 자회사 모델(비교 화면·경쟁 모델 목록 옆에, own: true로 구분) */
export const subModelsIn = (s: CarState, body: string): SubModelView[] => (s.subs ?? []).flatMap((sub) => sub.models.filter((md) => md.body === body).map((md) => subModelView(s, sub, md)));
/** 자회사 모델 이름이면 그 자회사(뉴스·비교에서 "내 자회사" 표시용) */
export const subOfModelName = (s: CarState, name: string): { subId: number; subName: string } | null => {
  for (const sub of s.subs ?? []) if (sub.models.some((md) => md.name === name)) return { subId: sub.id, subName: sub.name };
  return null;
};
/** 제 살 깎기: 본사 판매 중인 차마다 자회사가 없을 때보다 줄어든 월 수요(대, 이번 달 어림)와 비율. 자회사 모델이 같은 차급에 있는 차만 */
export function cannibalInfo(s: CarState): { generationId: number; body: string; lost: number; share: number }[] {
  if (!s.subs?.length) return [];
  const m = monthOf(s.week), t = monthTime(m), gens = s.nameplates.flatMap((n) => n.generations).filter((g) => g.status === 'onSale').sort((a, b) => a.id - b.id), cars = gens.map((g) => toSaleCar(g, m));
  const bodies = new Set(s.subs.flatMap((x) => x.models.map((md) => md.body)));
  return gens.flatMap((g, i) => {
    if (!bodies.has(g.body)) return [];
    const others = cars.filter((_, j) => j !== i), withS = monthlyDemand(s, cars[i], others, t) / subSalesMult(s), without = monthlyDemand(s, cars[i], others, t, { noSubs: true });
    return [{ generationId: g.id, body: g.body, lost: Math.max(0, without - withS), share: without > 0 ? Math.max(0, 1 - withS / without) : 0 }];
  });
}

export interface SubStrategyChoice { id: SubStrategy; name: string; desc: string; ok: boolean; reason: string | null; current: boolean }
/** 고를 수 있는 전략과 못 고르는 이유 */
export const strategyChoices = (s: CarState, sub: Subsidiary): SubStrategyChoice[] =>
  SUB_STRATEGIES.map((k) => { const r = strategyError(s, sub, k); return { id: k, name: stratName(k), desc: SUB_DATA.strategies[k], ok: r === null, reason: r, current: k === sub.strategy }; });

/** 자회사 상세 */
export function subDetail(s: CarState, id: number) {
  const sub = subById(s, id);
  if (!sub) return null;
  const m = monthOf(s.week), p = switchProgress(sub, m), last12 = sub.months.slice(-config.time.monthsPerYear), sum = (k: 'sold' | 'revenue' | 'profit' | 'dividend') => last12.reduce((a, x) => a + x[k], 0);
  const brand = isBrand(sub.kind);
  return {
    id: sub.id, kind: sub.kind, kindName: S.kinds[sub.kind].name, kindDesc: SUB_DATA.kinds[sub.kind], brand, name: sub.name, color: sub.color, foundedYear: yearOfMonth(sub.founded),
    strategy: sub.strategy, strategyName: stratName(sub.strategy),
    transition: p < 1 ? { progress: p, monthsLeft: Math.ceil((1 - p) * S.switchMonths), from: stratWeights(sub, m).filter(([k]) => k !== sub.strategy).map(([k, w]) => ({ id: k, name: stratName(k), weight: w })) } : null,
    rival: sub.strategy === 'rival' ? { id: rivalTarget(s, sub), name: s.rivals.find((r) => r.id === rivalTarget(s, sub))!.name, chosen: sub.rivalId !== null, bodies: rivalFocus(s, sub) } : null,
    bodies: sub.bodies, areaReady: brand ? areaBodies(s, sub) : [], segment: sub.segment, bodyChoices: brand ? brandDef(sub.kind as BrandKind).bodies : [], segmentChoices: brand ? brandDef(sub.kind as BrandKind).segments : [],
    dividend: sub.dividend, payout: Math.min(1, sub.dividend / 100 * fx(sub, m, 'payout')), share: sub.share, shareName: SHARE_NAMES[sub.share],
    president: sub.president ? { id: sub.president.id, name: sub.president.name, role: sub.president.role, ability: sub.president.ability } : null,
    capital: sub.capital, capacity: brand ? subCapacity(sub) : 0, modelCap: brand ? subModelCap(s, sub) : 0, rep: sub.rep,
    models: brand ? sub.models.map((md) => subModelView(s, sub, md)) : [],
    lastMonth: sub.months.at(-1) ?? null, last12: { months: last12.length, sold: sum('sold'), revenue: sum('revenue'), profit: sum('profit'), dividend: sum('dividend') }, total: { ...sub.total },
    hqEffect: sub.kind === 'parts' ? { kind: 'cost' as const, value: sub.effect, text: `본사 차 대당 원가 −${pct(sub.effect, 1)}` } : sub.kind === 'finance' ? { kind: 'sales' as const, value: sub.effect, text: `본사 판매 +${pct(sub.effect, 1)}(할부)` } : null,
    cannibal: cannibalInfo(s).filter((x) => sub.models.some((md) => md.body === x.body)),
    strategies: strategyChoices(s, sub), reports: [...sub.reports].reverse(), sellPrice: Math.round(sub.capital * S.sellShare),
  };
}
export type SubDetail = NonNullable<ReturnType<typeof subDetail>>;
/** 자회사 목록·설립 선택지 */
export function subsInfo(s: CarState) {
  const max = S.maxByHq[s.hqLevel - 1] ?? 0, last = (sub: Subsidiary) => sub.months.slice(-config.time.monthsPerYear);
  return {
    used: s.subs?.length ?? 0, max,
    list: (s.subs ?? []).map((sub) => ({ id: sub.id, kind: sub.kind, kindName: S.kinds[sub.kind].name, name: sub.name, color: sub.color, strategy: sub.strategy, strategyName: stratName(sub.strategy), switching: switchProgress(sub, monthOf(s.week)) < 1,
      models: sub.models.length, capital: sub.capital, profit12: last(sub).reduce((a, x) => a + x.profit, 0), dividend12: last(sub).reduce((a, x) => a + x.dividend, 0), president: sub.president?.name ?? null })),
    found: SUB_KINDS.map((k) => { const r = foundError(s, k); return { kind: k, name: S.kinds[k].name, desc: SUB_DATA.kinds[k], cost: S.kinds[k].cost, rep: S.kinds[k].rep, defaultName: SUB_DATA.names[k].replace('{회사}', s.companyName), color: S.kinds[k].color, ok: r === null, reason: r }; }),
  };
}
/** 본사가 자회사에서 받은 효과 합(재무 화면용): 지난 12개월 배당, 부품 원가 절감, 할부 판매 가산 */
export function subHqEffects(s: CarState) {
  const subs = s.subs ?? [];
  return { dividend12: s.ledger.slice(-config.time.monthsPerYear).reduce((a, e) => a + (e.subDiv ?? 0), 0), invest12: s.ledger.slice(-config.time.monthsPerYear).reduce((a, e) => a + (e.subInv ?? 0), 0),
    costCut: subs.reduce((a, x) => a + (x.kind === 'parts' ? x.effect : 0), 0), salesBoost: subs.reduce((a, x) => a + (x.kind === 'finance' ? x.effect : 0), 0) };
}
/** 직원이 사장인 자회사(직원 화면에서 찾을 때) */
export const presidentOf = (s: CarState, staffId: number): Subsidiary | undefined => s.subs?.find((x) => x.president?.id === staffId);
export const presidents = (s: CarState): Staff[] => (s.subs ?? []).flatMap((x) => (x.president ? [x.president] : []));
