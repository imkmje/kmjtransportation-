// 3.0.0 자회사와 고급 브랜드(설계서 9.9). 자회사를 본사처럼 통째로 돌리지 않고, 브랜드 자회사는 경쟁 모델(market.ts RivalModel)과 같은 구조의
// "내 편 경쟁사"로 그 차급 수요를 나눠 갖는다. 사업 자회사(부품·금융)는 본사 원가·판매에 효과를 주고 그 규모로 이익을 낸다.
// 게임 난수를 쓰지 않는다(변화는 시드 해시). 자회사가 없는 판은 이 파일의 어떤 함수도 상태를 바꾸지 않는다. 수치는 config.subs
import { config } from '../config';
import { BODIES, COMPAT, OPTIONS, RIVALS, SUB_DATA, TECHS, bodyById, optionById, powertrainById, segmentById } from '../data';
import { grade, payOf, unitCost } from './cars';
import { costMultOf } from './company';
import { specError, withRequired } from './dev';
import { addNews, chargingInfra, eraNow, marketMult, requiredOptions, rivalHitAdd, trendOf } from './events';
import { diffOf } from './difficulty';
import { josa } from './josa';
import { basePriceOf, bodyKey, carBasePrice, cellMonthly, currentEdition, monthlyDemand, rivalA, rivalBase, subPull, subSalesMult, toSaleCar } from './market';
import { recommendedEquip, stdOf } from './equip';
import { planPreview } from './queries';
import { criticScores, mean } from './reviews';
import { isOut, myCellShare, rivalModelName } from './rivals';
import { levelForTier, ptCostAdd, unlockedBodies, unlockedPowertrains } from './research';
import { hash01, hash32 } from './rng';
import { monthOf, monthTime, yearOf, yearOfMonth } from './time';
import { STATS, type Budget, type CarState, type Command, type CommandResult, type GameEvent, type Generation, type PriceBand, type ProjectSpec, type Staff, type Stats, type SubCar, type SubCharacter, type SubKind, type SubModel, type SubMonth, type SubOrder, type SubStrategy, type Subsidiary } from './types';

const S = config.subs;
const EV = config.events.charging.powertrain;
export const SUB_KINDS: SubKind[] = ['premium', 'value', 'parts', 'finance'];
export const SUB_STRATEGIES: SubStrategy[] = ['growth', 'share', 'profit', 'rival', 'tech', 'stable', 'niche', 'prestige', 'ev'];
export const SHARE_NAMES = ['좁게', '보통', '넓게'] as const;
type BrandKind = 'premium' | 'value' | 'acquired'; // acquired(3.5.0): 인수 브랜드
type StratKey = 'a' | 'price' | 'cost' | 'dev' | 'vol' | 'payout';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const won = (x: number): string => { // 3.1.1 1조 이상은 "3조 5,000억원"(전에는 "35,000억원"), 자릿수 표기는 기기 언어와 무관하게 ko-KR
  const v = Math.abs(x), sg = x < 0 ? '−' : '', k = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d });
  if (v >= 1e8) { const e = Math.round(v / 1e4), jo = Math.floor(e / 1e4), eok = e % 1e4; return `${sg}${k(jo)}조${eok ? ` ${k(eok)}억` : ''}원`; }
  return `${sg}${v >= 10000 ? `${k(v / 10000, 1)}억원` : `${k(Math.round(v))}만원`}`;
};
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const isBrand = (k: SubKind): k is BrandKind => k === 'premium' || k === 'value' || k === 'acquired';
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
/** 3.1.1 대당 원가 배수: 전동화 전환의 원가 절감은 전기차에만(2010년대에 남겨 둔 가솔린 모델은 1) */
const costFx = (sub: Subsidiary, m: number, ev: boolean): number => stratWeights(sub, m).reduce((a, [k, w]) => a + w * (k === 'ev' && !ev ? 1 : S.strat[k].cost), 0);
const presQ = (sub: Subsidiary): number => (sub.president ? sub.president.ability / 100 : S.noPres);

/** 본사 기술 수준: 그해까지 나온(반복 제외) 기술 중 연구를 마친 몫 */
export function techLevel(s: CarState): number {
  const y = yearOf(s.week), out = TECHS.filter((t) => !t.repeatable && t.year <= y), done = new Set(s.research.done);
  return out.length ? out.filter((t) => done.has(t.id)).length / out.length : 0;
}
/** 경쟁사 대응의 상대: 지정한 회사, 없으면 지금 가장 큰 경쟁사(차급별 세기 × 칸 규모의 합) */
export function rivalTarget(s: CarState, sub: Subsidiary): string {
  if (sub.rivalId && s.rivals.some((r) => r.id === sub.rivalId) && !isOut(s, sub.rivalId)) return sub.rivalId;
  const t = monthTime(monthOf(s.week)), size = (r: CarState['rivals'][number]) => Object.keys(r.cells).reduce((a, b) => a + r.cells[b] * cellMonthly(b, t), 0);
  return [...s.rivals].filter((r) => !isOut(s, r.id)).sort((a, b) => size(b) - size(a) || (a.id < b.id ? -1 : 1))[0].id;
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
  const invest = investA(sub);
  return rivalBase(m) + k.a + strat + S.shareFx[sub.share].a + S.presA * (presQ(sub) - 0.5) + S.techA * (techLevel(s) - 1) + invest
    + repA(sub) + fromA(sub, body) + (hash01(s.seed, 30, sub.id, bodyKey(body), n) * 2 - 1) * S.noise * noiseMult;
}
/** 3.5.0 인수 브랜드는 그 경쟁사의 차급별 강약(rivals.json cells)을 물려받는다 */
const fromA = (sub: Subsidiary, body: string): number => (sub.from ? RIVALS.find((r) => r.id === sub.from)?.cells[body] ?? 0 : 0);
/** 3.5.0 투자 기준: 인수 브랜드는 인수 값, 그 밖은 종류의 설립비 */
export const subCost = (sub: Subsidiary): number => sub.cost ?? S.kinds[sub.kind].cost;
const investA = (sub: Subsidiary): number => clamp(S.investA * Math.log2(Math.max(1, sub.total.invested / subCost(sub))), 0, S.investMax);
const repA = (sub: Subsidiary): number => S.repA * (Math.min(sub.rep, S.repCap) - 100) / 100;
/** 3.1.0 실제 사양이 있는 차의 기본 A = 그때 경쟁 차 기본 A + (평론 − 6) ÷ 10(추정 평론 셈을 뒤집은 것) + 종류 + 공유 범위 + 본사 투자 + 브랜드 평판. 전략·사장·기술은 평론(사양)에 이미 들어 있다 */
const carBase = (sub: Subsidiary, critic: number, m: number): number =>
  rivalBase(m) + (critic - config.rivals.view.criticMid) / config.rivals.view.criticPer + brandDef(sub.kind as BrandKind).a + S.shareFx[sub.share].a + investA(sub) + repA(sub);
const cycleOf = (s: CarState, sub: Subsidiary, body: string, n: number): number => S.strat[sub.strategy].cycle + Math.floor((hash01(s.seed, 31, sub.id, bodyKey(body), n) * 2 - 1) * 6);
const ptOf = (md: Pick<SubModel, 'ev' | 'car'>): string => md.car?.spec.powertrain ?? (md.ev ? EV : 'gasoline');
/** 시장 기준가: 실제 사양이 있으면 본사 차와 같은 차별 기준가(동력 가산·단 장비 값·배터리), 없으면 차급 기준가 */
const carBase0 = (s: CarState, md: Pick<SubModel, 'body' | 'ev' | 'car'>): number => (md.car ? carBasePrice(s, { ...md.car.spec, options: withRequired(s, specOpts(md.car.spec)) }) : basePriceOf(s, md.body, ptOf(md)));
const bandMult = (md: Pick<SubModel, 'car'>): number => (md.car?.band ? S.band[md.car.band].price : 1);
/** 가격 배수: 직접 운영에서 정한 값, 없으면 전략 */
const priceFx = (sub: Subsidiary, md: Pick<SubModel, 'price'>, m: number): number => md.price ?? fx(sub, m, 'price');
export const isDirect = (sub: Pick<Subsidiary, 'mode'>): boolean => sub.mode === 'direct';
/** 대당 가격(시장 기준가 × 종류 × 전략) */
export const subPrice = (s: CarState, sub: Subsidiary, md: Pick<SubModel, 'body' | 'ev' | 'car' | 'price'>): number => carBase0(s, md) * brandDef(sub.kind as BrandKind).price * priceFx(sub, md, monthOf(s.week)) * bandMult(md);
/** 대당 원가(본사 공장·연구·부품 자회사 혜택을 함께 쓴다) × 종류 × 전략 × 공유 범위 × 사장 */
export function subUnitCost(s: CarState, sub: Subsidiary, md: Pick<SubModel, 'body' | 'ev' | 'car'>): number {
  const pt = ptOf(md), mult = costMultOf(s, pt) * brandDef(sub.kind as BrandKind).unitCost * costFx(sub, monthOf(s.week), pt === EV) * S.shareFx[sub.share].cost * (1 - S.presCost * (presQ(sub) - 0.5) * 2);
  const c = md.car?.spec; // 3.1.0 실제 사양이면 그 동력 등급·기본 장비·배터리
  return c ? unitCost(md.body, pt, c.tier, withRequired(s, specOpts(c)), mult, ptCostAdd(s, pt, c.battery)) : unitCost(md.body, pt, 2, withRequired(s, []), mult, ptCostAdd(s, pt));
}
const specOpts = (x: Pick<ProjectSpec, 'options' | 'equip'>): string[] => (x.equip ? stdOf(x.equip) : x.options);
/** 브랜드 인지도(0~1): 브랜드 평판이 높을수록 */
export const subAwareness = (sub: Subsidiary): number => Math.min(1, S.aw.base + Math.min(sub.rep, S.repCap) / S.aw.repDiv);
/** 이번 달 점유 점수 a = 세기(경쟁 차와 같은 노화) × 고객층 궁합 × 가격 효과 × 브랜드 인지도 */
function effA(sub: Subsidiary, md: SubModel, m: number): number {
  const seg = md.car?.spec.segment ?? sub.segment ?? brandDef(sub.kind as BrandKind).segment;
  return rivalA(md, m) * (sub.from ? 1 : COMPAT[md.body]?.[seg] ?? 1) * priceFx(sub, md, m) ** -S.pricePe * subAwareness(sub); // 3.5.0 인수 브랜드는 경쟁사 때처럼 모든 고객층에 판다(궁합 1)
}
/** 한 모델의 이번 달 수요(생산 한도 전): 칸 규모(시대 사건·유행·동력) × (1 − 본사 몫) × a^지수 ÷ (경쟁 차 + 자회사 모델) × 종류·전략 물량 */
function subDemand(s: CarState, sub: Subsidiary, md: SubModel, m: number): number {
  const t = monthTime(m), n = eraNow(s.seed, m), pt = ptOf(md), e = config.market.shareExp, rm = diffOf(s).rivalMult;
  const size = cellMonthly(md.body, t) * (n.body[md.body] ?? 1) * marketMult(n) * trendOf(md.body, t, n) * trendOf(pt, t, n) * (n.pt[pt] ?? 1) * (pt === EV ? chargingInfra(s.seed, m) : 1);
  const rivals = s.rivals.reduce((a, r) => a + (((r.cells[md.body] ?? 0) + rivalHitAdd(s, r.id, md.body, m)) * rm) ** e, 0), tot = rivals + subPull(s, md.body);
  return tot > 0 ? size * (1 - myCellShare(s, md.body)) * md.a ** e / tot * brandDef(sub.kind as BrandKind).vol * fx(sub, m, 'vol') * ((md.awardUntil ?? -1) > m ? 1 + config.rivalry.awards.salesBoost : 1) : 0; // 3.5.0 수상 판매 보너스
}
/** 추정 방식 모델 하나의 월 개발비 */
export const subModelDev = (s: CarState, sub: Subsidiary, md: Pick<SubModel, 'body'>, m: number): number => basePriceOf(s, md.body) * S.dev * fx(sub, m, 'dev') * S.shareFx[sub.share].dev;
/** 월 생산 한도(대) */
export const subCapacity = (sub: Subsidiary): number => Math.floor(sub.capital / S.capPerCar);
/** 모델 수 상한(자본, 맡은 차급 수 이내) */
export const subModelCap = (s: CarState, sub: Subsidiary): number => Math.max(1, Math.min(areaBodies(s, sub).length, Math.floor(sub.capital / S.capitalPerModel)));
/** 맡은 차급 중 본사가 연구로 연 것(기술·차대 공유) */
export const areaBodies = (s: CarState, sub: Pick<Subsidiary, 'bodies'> & { from?: string }): string[] => { if (sub.from) return [...sub.bodies]; const u = new Set(unlockedBodies(s).map((b) => b.id)); return sub.bodies.filter((b) => u.has(b)); }; // 3.5.0 인수 브랜드는 자기 차대 기술이 있어 본사 연구와 무관
const evReady = (s: CarState): boolean => unlockedPowertrains(s).some((p) => p.id === EV);
/** 3.1.1 전동화 전환에서 이 차(없으면 새 모델)를 전기차로 낼지: 라인업의 전기차가 충전 인프라를 따라(모델 수 × min(1, 인프라 × evPace), 올림) 될 때까지 바꾼다. 이미 전기차인 차는 그대로.
 *  3.1.0까지는 한꺼번에 다 바꿔 충전 인프라가 모자란 2010년대에 성장 중심의 약 15분의 1밖에 못 벌었다 */
function evNext(s: CarState, sub: Subsidiary, m: number, md?: SubModel): boolean {
  if (sub.strategy !== 'ev' || !evReady(s)) return false;
  if (md?.ev) return true;
  const n = sub.models.length + (md && sub.models.includes(md) ? 0 : 1);
  return sub.models.filter((x) => x.ev).length < Math.ceil(n * Math.min(1, chargingInfra(s.seed, m) * S.evPace) - 1e-9);
}
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
export function newModelName(s: CarState, sub: Subsidiary, body: string): string {
  const used = new Set([...s.nameplates.map((n) => n.name), ...(s.subs ?? []).flatMap((x) => [...x.models.map((md) => md.name), ...(x.orders ?? []).flatMap((o) => (o.name ? [o.name] : []))])]);
  const order = SUB_DATA.models.map((nm, i) => [hash01(s.seed, 32, sub.id, i), nm] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return order.find((nm) => !used.has(nm)) ?? `${sub.name} ${bodyById(body).name}`;
}
/** 추정 평론(경쟁 모델과 같은 셈: 6 + (기본 A − 그때 경쟁 차 기본 A) × 10) */
const estCritic = (md: SubModel): number => r1(clamp(config.rivals.view.criticMid + (md.base - rivalBase(Math.max(0, md.start))) * config.rivals.view.criticPer, 1, 10));
/** 평론: 실제 사양이 있으면 그 평론, 없으면 추정 평론 */
const criticOf = (md: SubModel): number => (md.car ? md.car.critic : estCritic(md));
const news = (s: CarState, ev: GameEvent[], sub: Subsidiary, text: string) => { addNews(s, ev, text, 'sub', 'news', sub.id, 'sub'); report(s, sub, text); };
const report = (s: CarState, sub: Subsidiary, text: string) => { sub.reports.push({ week: s.week, text }); if (sub.reports.length > S.reportsMax) sub.reports.splice(0, sub.reports.length - S.reportsMax); };
function launchModel(s: CarState, ev: GameEvent[], sub: Subsidiary, md: SubModel, first: boolean): void {
  if (criticOf(md) >= 7) sub.rep += 1; // 평론이 좋은 새 모델은 브랜드 평판 +1
  const shared = sub.share === 2 ? ' 평론가들은 본사 차의 판박이라고 평했다.' : '';
  news(s, ev, sub, `「${sub.name}」, 「${md.name}」 ${first ? '' : `${md.n + 1}세대 `}출시. ${bodyById(md.body).name}${md.ev ? ' 전기차' : ''}, 추정 평론 ${criticOf(md).toFixed(1)}.${shared}`);
}

// ---------- 3.1.0 실제 사양이 있는 자회사 차(직접 기획·제작 지시·배지) ----------
const WPM = config.time.weeksPerMonth;
/** 팀 능력을 대신하는 가상 팀: 직무 config.subs.team.roles, 능력 = max(floor, 본사 개발 직원 평균) + presBonus × 사장 능력/100. 컨디션 최상 */
export function subTeam(s: CarState, sub: Subsidiary): Staff[] {
  const T = S.team, dev = s.staff.filter((x) => x.role !== 'sales'), avg = dev.length ? dev.reduce((a, x) => a + x.ability, 0) / dev.length : 0;
  const ability = Math.round(Math.min(100, Math.max(T.floor, avg) + T.presBonus * (sub.president ? sub.president.ability / 100 : 0)));
  return T.roles.map((role, i) => ({ id: -1 - i, name: '', role, ability, potential: ability, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false }));
}
/** 공유 범위로 쓸 수 있는 본사 기술인지(아니면 이유). 나온 지 shareLag년이 안 된 동력·장비(의무 장비 제외)와 동력 등급 상한 */
export function shareTechError(s: CarState, sub: Subsidiary, spec: Pick<ProjectSpec, 'powertrain' | 'tier' | 'options' | 'equip'>): string | null {
  const lag = S.shareLag[sub.share], y = yearOf(s.week), tmax = S.shareTier[sub.share], sn = SHARE_NAMES[sub.share], req = new Set(requiredOptions(s));
  if (spec.tier > tmax) return `공유 범위가 ${sn}이면 동력 등급은 ${tmax}까지 쓸 수 있습니다.`;
  const pt = powertrainById(spec.powertrain);
  if (pt.year + lag > y) return `공유 범위가 ${sn}이면 나온 지 ${lag}년이 안 된 동력(${pt.name})은 쓸 수 없습니다.`;
  const bad = [...new Set([...spec.options, ...Object.keys(spec.equip ?? {})])].find((id) => !req.has(id) && OPTIONS.some((o) => o.id === id) && optionById(id).year + lag > y);
  return bad ? `공유 범위가 ${sn}이면 나온 지 ${lag}년이 안 된 장비(${optionById(bad).name})는 쓸 수 없습니다.` : null;
}
/** 자회사가 스스로 짜는 사양(제작 지시·다시 개발): 성격 → 개발 방향, 가격대 → 동력 등급·예산, 동력은 전동화 전략이면 evNext를 따라 전기(3.1.1) 아니면 가솔린, 장비는 추천 구성(공유 범위 안) */
export function autoSpec(s: CarState, sub: Subsidiary, body: string, character: SubCharacter, band: PriceBand, name = ''): ProjectSpec {
  const seg = sub.segment ?? brandDef(sub.kind as BrandKind).segment, pt = evNext(s, sub, monthOf(s.week), sub.models.find((x) => x.body === body)) ? EV : 'gasoline', B = S.band[band];
  const tier = Math.min(B.tier, S.shareTier[sub.share], powertrainById(pt).tiers.length), lag = S.shareLag[sub.share], y = yearOf(s.week), req = new Set(requiredOptions(s));
  const equip = Object.fromEntries(Object.entries(recommendedEquip(s, body, seg, pt)).filter(([id]) => req.has(id) || optionById(id).year + lag <= y));
  return { name, body, segment: seg, powertrain: pt, tier, options: stdOf(equip), equip, direction: { ...S.character[character].dir }, budget: B.budget as Budget, designWeeks: config.dev.designWeeks[1] };
}
/** 개발비(가상 팀으로 본사 신차와 같은 계산 × 공유 범위 개발비 배수)와 개발 개월(설계 + 최소 시험) */
export const planCost = (s: CarState, sub: Subsidiary, spec: ProjectSpec): { cost: number; months: number } =>
  ({ cost: planPreview(s, spec, subTeam(s, sub)).cost * S.planCost * S.shareFx[sub.share].dev, months: Math.ceil((spec.designWeeks + config.dev.minTestWeeks) / WPM) });
/** 배지 개발비·개월: 원본 세대 개발비 × costShare, 원본 개발 기간 × timeShare */
export const badgeCost = (g: Generation): { cost: number; months: number } =>
  ({ cost: g.devCost * S.badge.costShare, months: Math.max(1, Math.ceil(Math.ceil(((g.plan?.designWeeks ?? config.dev.designWeeks[1]) + config.dev.minTestWeeks) / WPM) * S.badge.timeShare)) });
/** 사양으로 차를 만든다(출시하는 달): 가상 팀의 능력치(본사 기획 미리보기와 같은 계산), 평론가 4명(본사와 같은 계산, 흔들림은 시드 해시) */
function buildCar(s: CarState, sub: Subsidiary, spec: ProjectSpec, how: SubCar['how'], o: { character?: SubCharacter; band?: PriceBand; chassisSeed?: number; faceSeed?: number }, n: number): SubCar {
  const m = monthOf(s.week), y = yearOf(s.week), pv = planPreview(s, spec, subTeam(s, sub)), key = bodyKey(spec.body);
  const bp = carBasePrice(s, { ...spec, options: withRequired(s, specOpts(spec)) }) * brandDef(sub.kind as BrandKind).price, price = bp * (o.band ? S.band[o.band].price : 1);
  let k = 0;
  const reviews = criticScores(pv.stats, y, bp, price, 0, () => hash01(s.seed, 35, sub.id, key, m, n, k++) * 2 - 1, diffOf(s).manyDefects);
  return { how, spec: { ...spec }, level: levelForTier(s, spec.powertrain, spec.tier), stats: pv.stats, reviews, critic: r1(mean(reviews)),
    chassisSeed: o.chassisSeed ?? hash32(s.seed, 36, sub.id, key, n), faceSeed: o.faceSeed ?? hash32(s.seed, 37, sub.id, key, n),
    ...(o.character ? { character: o.character } : {}), ...(o.band ? { band: o.band } : {}) };
}
/** 화면·봇용 기획 미리보기: 가상 팀으로 본사 기획 미리보기와 같은 능력치, 흔들림 없는 평론 4명과 평균, 개발비·개월, 못 하는 이유(자본 부족은 따로) */
export function subPlanPreview(s: CarState, sub: Subsidiary, spec: ProjectSpec) {
  const team = subTeam(s, sub), pv = planPreview(s, spec, team), y = yearOf(s.week);
  const bp = carBasePrice(s, { ...spec, options: withRequired(s, specOpts(spec)) }) * brandDef(sub.kind as BrandKind).price;
  const reviews = criticScores(pv.stats, y, bp, bp, 0, () => 0, diffOf(s).manyDefects), { cost, months } = planCost(s, sub, spec);
  const K = brandDef(sub.kind as BrandKind), seg = K.segments.includes(spec.segment) ? null : `${K.name}${josa(K.name, '이/가')} 맡을 수 있는 고객층은 ${K.segments.map((x) => segmentById(x).name).join('·')}입니다.`;
  return { stats: pv.stats, grades: pv.grades, avg: pv.avg, reviews, critic: r1(mean(reviews)), cost, months, team: team[0].ability, teamSize: team.length, price: bp,
    error: slotError(s, sub, spec.body) ?? seg ?? specError(s, spec) ?? shareTechError(s, sub, spec), fundError: fundError(sub, cost) };
}
/** 본사 세대를 자회사 이름으로: 지금 판의 능력치·평론(평론 badge.critic 감점), 모양은 본사 차 그대로 */
function badgeCar(s: CarState, g: Generation): SubCar {
  const ed = currentEdition(g), np = s.nameplates.find((x) => x.generations.includes(g));
  const spec: ProjectSpec = { name: np?.name ?? '', body: g.body, segment: g.segment, powertrain: g.powertrain, tier: ed.tier, options: [...ed.options], ...(ed.equip ? { equip: { ...ed.equip } } : {}), ...(ed.battery ? { battery: ed.battery } : {}),
    direction: g.plan ? { ...g.plan.direction } : { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: g.plan?.budget ?? 'normal', designWeeks: g.plan?.designWeeks ?? config.dev.designWeeks[1] };
  return { how: 'badge', spec, level: ed.level, stats: { ...ed.stats }, reviews: [...g.reviews], critic: r1(clamp(g.reviewAvg + S.badge.critic, 1, 10)), chassisSeed: g.chassisSeed, faceSeed: ed.faceSeed, fromGen: g.id };
}
/** 차를 그 차급에 낸다: 모델이 있으면 다음 세대, 없으면 새 모델(추가 지시처럼 전략이 줄이지 않는다) */
function putCar(s: CarState, ev: GameEvent[], sub: Subsidiary, body: string, car: SubCar, name: string | undefined, m: number): void {
  const old = sub.models.find((x) => x.body === body), n = old ? old.n + 1 : 0;
  const md: SubModel = old ?? { body, name: '', n: 0, start: m, cycle: 0, base: 0, a: 0, sold: 0, keep: true };
  Object.assign(md, { n, start: m, cycle: cycleOf(s, sub, body, n), base: carBase(sub, car.critic, m), car, name: name || old?.name || newModelName(s, sub, body) });
  if (car.spec.powertrain === EV) md.ev = true; else delete md.ev;
  if (!old) { sub.models.push(md); sub.models.sort((a, b) => (a.body < b.body ? -1 : 1)); sub.dropped = sub.dropped.filter((b) => b !== body); }
  md.a = effA(sub, md, m);
  if (car.critic >= 7) sub.rep += 1; // 평론이 좋은 새 모델은 브랜드 평판 +1(추정 방식과 같다)
  const src = car.how === 'badge' ? ` 본사 「${car.spec.name}」의 배지 모델입니다.` : car.how === 'plan' ? ' 본사가 직접 기획한 차입니다.' : '';
  news(s, ev, sub, `「${sub.name}」, 「${md.name}」 ${old ? `${n + 1}세대 ` : ''}출시. ${bodyById(body).name}${car.spec.powertrain === EV ? ' 전기차' : ''}, 평론 ${car.critic.toFixed(1)}.${src}`);
}
/** 개발이 끝난 차 출시 */
function launchOrder(s: CarState, ev: GameEvent[], sub: Subsidiary, o: SubOrder, m: number): void {
  const n = (sub.models.find((x) => x.body === o.body)?.n ?? -1) + 1, g = o.fromGen === undefined ? undefined : s.nameplates.flatMap((x) => x.generations).find((x) => x.id === o.fromGen);
  const car = o.how === 'badge' && g ? badgeCar(s, g) : buildCar(s, sub, o.spec ?? autoSpec(s, sub, o.body, o.character ?? S.defaultOrder[sub.kind as BrandKind].character as SubCharacter, o.band ?? S.defaultOrder[sub.kind as BrandKind].band as PriceBand), o.how, o, n);
  putCar(s, ev, sub, o.body, car, o.name, m);
}
/** 실제 사양이 있는 차의 세대교체(손대지 않은 차, 전략 주기에 맞춰): 직접 기획한 차는 같은 기획을 다시(안 되면 지시와 같은 방식), 그 밖은 성격·가격대대로. 개발비는 그달 비용 */
function relaunchCar(s: CarState, ev: GameEvent[], sub: Subsidiary, md: SubModel, m: number): void {
  const c = md.car!, D = S.defaultOrder[sub.kind as BrandKind], again = c.how === 'plan' ? { ...c.spec, name: md.name } : null;
  const spec = again && !specError(s, again) && !shareTechError(s, sub, again) ? again : autoSpec(s, sub, md.body, c.character ?? D.character as SubCharacter, c.band ?? D.band as PriceBand, md.name);
  sub.devDue = (sub.devDue ?? 0) + planCost(s, sub, spec).cost;
  putCar(s, ev, sub, md.body, buildCar(s, sub, spec, c.how === 'plan' ? 'plan' : 'order', { character: c.character, band: c.band }, md.n + 1), md.name, m);
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
    const area = new Set(areaBodies(s, sub)), direct = isDirect(sub);
    if (sub.orders?.length) { // 3.1.0 개발 중인 차: 영역에서 빠진 차급은 취소, 개발이 끝나면 출시
      for (const o of [...sub.orders].sort((a, b) => a.id - b.id)) {
        if (!area.has(o.body)) { sub.orders = sub.orders.filter((x) => x !== o); news(s, ev, sub, `「${sub.name}」, 맡은 영역에서 빠진 ${bodyById(o.body).name} 개발을 멈췄습니다.`); }
        else if (m >= o.doneMonth) { sub.orders = sub.orders.filter((x) => x !== o); launchOrder(s, ev, sub, o, m); }
      }
    }
    const pend = new Set((sub.orders ?? []).map((o) => o.body));
    for (const md of sub.models.filter((x) => !area.has(x.body))) { sub.models = sub.models.filter((x) => x !== md); news(s, ev, sub, `「${sub.name}」, 맡은 영역에서 빠진 「${md.name}」${josa(md.name, '을/를')} 단종했습니다.`); }
    const target = targetCount(s, sub);
    for (const md of [...sub.models].sort((a, b) => (a.body < b.body ? -1 : 1))) {
      if (m - md.start < md.cycle || pend.has(md.body)) continue; // 3.1.0 그 차급의 새 차를 개발 중이면 기다린다
      if (md.car) { relaunchCar(s, ev, sub, md, m); continue; } // 3.1.0 실제 사양이 있는 차
      if (!direct && !md.keep && sub.models.length > target) { // 세대교체 대신 단종(전략이 모델 수를 줄인다). 3.1.0 직접 운영에서는 스스로 단종하지 않는다
        sub.models = sub.models.filter((x) => x !== md);
        news(s, ev, sub, `「${sub.name}」, ${stratName(sub.strategy)} 전략에 따라 「${md.name}」${josa(md.name, '을/를')} 후속 없이 단종했습니다.`);
        continue;
      }
      const n = md.n + 1;
      Object.assign(md, { n, start: m, cycle: cycleOf(s, sub, md.body, n), base: newBase(s, sub, md.body, n, m) });
      if (evNext(s, sub, m, md)) md.ev = true; else if (sub.strategy !== 'ev') delete md.ev;
      launchModel(s, ev, sub, md, false);
    }
    if (!direct && sub.models.length < target) { // 한 달에 한 대까지(3.1.0 직접 운영에서는 스스로 추가하지 않는다)
      const body = pickBody(s, sub, m);
      if (body) {
        const md: SubModel = { body, name: newModelName(s, sub, body), n: 0, start: m, cycle: cycleOf(s, sub, body, 0), base: newBase(s, sub, body, 0, m), a: 0, sold: 0, ...(evNext(s, sub, m) ? { ev: true as const } : {}) };
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
const presPay = (sub: Subsidiary): number => (sub.president ? payOf(sub.president) + S.presAllowance : 0);

export interface SubSettle { dividend: number; rep: { name: string; value: number; reason?: string }[] }
/** 3.1.0 연간 목표: 올해 실적이 목표 이상이면 브랜드 평판·본사 평판이 조금 오르고 뉴스, 못 미치면 뉴스 한 줄(벌칙 없음) */
export const targetProgress = (sub: Subsidiary, m: number): number => sub.months.filter((x) => yearOfMonth(x.month) === yearOfMonth(m)).reduce((a, x) => a + (sub.target?.kind === 'profit' ? x.profit : x.sold), 0);
const targetText = (t: { kind: 'sold' | 'profit'; value: number }, v: number) => (t.kind === 'sold' ? `판매 ${Math.round(v).toLocaleString()}대` : `이익 ${won(v)}`);
function yearTarget(s: CarState, ev: GameEvent[], sub: Subsidiary, m: number, out: SubSettle): void {
  const t = sub.target!, v = targetProgress(sub, m), y = yearOfMonth(m), T = S.target;
  if (v >= t.value) {
    sub.rep += T.subRep; sub.total.hqRep += T.hqRep;
    out.rep.push({ name: sub.name, value: T.hqRep, reason: `자회사 「${sub.name}」 목표 달성` });
    news(s, ev, sub, `「${sub.name}」, ${y}년 목표(${targetText(t, t.value)})를 이뤘습니다. 실적 ${targetText(t, v)}. 브랜드 평판 +${T.subRep}, 본사 평판 +${T.hqRep}.`);
  } else news(s, ev, sub, `「${sub.name}」, ${y}년 목표(${targetText(t, t.value)})에 못 미쳤습니다. 실적 ${targetText(t, v)}.`);
}
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
        if (!md.car) cost += subModelDev(s, sub, md, m); // 개발비(모델마다 매달). 3.1.0 실제 사양이 있는 차는 개발할 때 한 번 낸다
      });
    } else {
      const B = sub.kind === 'parts' ? S.parts.margin : S.finance.financed * S.finance.spread;
      revenue = (sub.kind === 'parts' ? hq.cogs : hq.revenue) * B * bizScale(sub) * S.bizFx[sub.strategy].margin;
    }
    if (sub.devDue) { cost += sub.devDue; sub.devDue = 0; } // 3.1.0 직접 기획·지시·배지·다시 개발의 개발비
    cost += (isBrand(sub.kind) ? Math.min(sub.capital, sold * S.capPerCar) : sub.capital) * S.upkeep + presPay(sub); // 유지비: 브랜드는 쓰는 설비(판매 대수 × 대당 자본)만큼, 사업 자회사는 자본만큼
    const profit = revenue - cost, payout = Math.min(1, sub.dividend / 100 * fx(sub, m, 'payout')), dividend = profit > 0 ? profit * payout : 0;
    sub.capital = Math.max(0, sub.capital + profit - dividend); // 손실은 자회사 자본이 떠안는다(본사로 넘어오지 않는다)
    const own = dividend * (1 - (sub.listed ?? 0)); // 3.5.0 상장한 지분만큼은 다른 주주 몫
    out.dividend += own;
    const row: SubMonth = { month: m, sold, demand: Math.round(demand), revenue, profit, dividend: own };
    sub.months.push(row); if (sub.months.length > S.monthsMax) sub.months.splice(0, sub.months.length - S.monthsMax);
    Object.assign(sub.total, { profit: sub.total.profit + profit, dividend: sub.total.dividend + own, sold: sub.total.sold + sold });
    if (m % 3 === 2) quarterReport(s, ev, sub, m);
    if ((m + 1) % config.time.monthsPerYear === 0) { // 연말: 브랜드 평판(전략 가산, 본사 평판 쪽으로 조금씩), 본사 평판 가산
      const w = stratWeights(sub, m), subRep = w.reduce((a, [x, v]) => a + v * S.strat[x].subRep, 0), hqRep = w.reduce((a, [x, v]) => a + v * S.strat[x].hqRep, 0);
      const base = isBrand(sub.kind) ? brandDef(sub.kind).rep0 : 0.5;
      sub.rep = Math.max(0, sub.rep + subRep + (s.reputation * base - sub.rep) * S.repDrift);
      if (hqRep > 0 && isBrand(sub.kind)) { out.rep.push({ name: sub.name, value: hqRep }); sub.total.hqRep += hqRep; }
      if (sub.target) yearTarget(s, ev, sub, m, out);
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
/** 매각 대금 = 자본 × sellShare × 본사 지분(3.5.0 상장한 몫 제외) */
export const sellPrice = (sub: Subsidiary): number => Math.round(sub.capital * S.sellShare * (1 - (sub.listed ?? 0)));
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
      if (sub.orders?.some((o) => o.body === cmd.body)) return fail('그 차급의 차를 이미 개발하고 있습니다.');
      if (sub.models.length + newOrders(sub) >= subModelCap(s, sub)) return fail(`자본이 모자라 모델을 더 둘 수 없습니다(지금 상한 ${subModelCap(s, sub)}개, 모델 하나에 자본 ${won(S.capitalPerModel)}). 투자하면 늘어납니다.`);
      const md: SubModel = { body: cmd.body, name: newModelName(s, sub, cmd.body), n: 0, start: m, cycle: cycleOf(s, sub, cmd.body, 0), base: newBase(s, sub, cmd.body, 0, m), a: 0, sold: 0, keep: true, ...(evNext(s, sub, m) ? { ev: true as const } : {}) };
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
      const price = sellPrice(sub);
      c.spend(-price); releasePresident(s, sub);
      s.subs = s.subs!.filter((x) => x !== sub);
      addNews(s, ev, `${s.companyName}, 자회사 「${sub.name}」${josa(sub.name, '을/를')} ${won(price)}에 매각했습니다.`, 'sub', 'news', undefined, 'sub');
      return { ok: true, events: ev };
    }
    // ---------- 3.1.0 직접 운영 ----------
    case 'setSubMode': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      if (!isBrand(sub.kind)) return fail('부품·금융 자회사는 전반 위임으로만 운영합니다.');
      if (cmd.mode !== 'direct' && cmd.mode !== 'delegate') return fail('운영 방식은 전반 위임·직접 운영 중에서 고르세요.');
      if ((cmd.mode === 'direct') === isDirect(sub)) return fail(`이미 ${cmd.mode === 'direct' ? '직접 운영' : '전반 위임'} 중입니다.`);
      if (cmd.mode === 'direct') sub.mode = 'direct';
      else { delete sub.mode; for (const md of sub.models) delete md.price; } // 전반 위임으로 돌리면 가격도 전략이 정한다
      return OK;
    }
    case 'subPlanModel': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const be = brandOnly(sub); if (be) return fail(be);
      if (!isDirect(sub)) return fail('직접 운영 중인 자회사만 신차를 직접 기획할 수 있습니다. 먼저 직접 운영으로 바꾸세요.');
      const { type: _t, subId: _i, chassisSeed, faceSeed, ...spec0 } = cmd, spec: ProjectSpec = { ...spec0, name: typeof spec0.name === 'string' ? spec0.name.trim() : '' };
      const K = brandDef(sub.kind as BrandKind);
      const err = slotError(s, sub, spec.body) ?? (K.segments.includes(spec.segment) ? null : `${K.name}${josa(K.name, '이/가')} 맡을 수 있는 고객층은 ${K.segments.map((x) => segmentById(x).name).join('·')}입니다.`)
        ?? specError(s, spec) ?? shareTechError(s, sub, spec) ?? carNameError(s, sub, spec.name, spec.body) ?? seedErr(chassisSeed) ?? seedErr(faceSeed);
      if (err) return fail(err);
      const { cost, months } = planCost(s, sub, spec), fe = fundError(sub, cost); if (fe) return fail(fe);
      addOrder(s, sub, { body: spec.body, how: 'plan', months, cost, name: spec.name, spec, ...(chassisSeed !== undefined ? { chassisSeed } : {}), ...(faceSeed !== undefined ? { faceSeed } : {}) });
      return OK;
    }
    case 'subOrderModel': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const be = brandOnly(sub); if (be) return fail(be);
      if (!(cmd.character in S.character)) return fail('차의 성격은 고급·스포츠·실속 중에서 고르세요.');
      if (!(cmd.priceBand in S.band)) return fail('가격대는 낮게·보통·높게 중에서 고르세요.');
      const name = typeof cmd.name === 'string' ? cmd.name.trim() : '';
      const err = slotError(s, sub, cmd.body) ?? (name ? carNameError(s, sub, name, cmd.body) : null); if (err) return fail(err);
      const { cost, months } = planCost(s, sub, autoSpec(s, sub, cmd.body, cmd.character, cmd.priceBand)), fe = fundError(sub, cost); if (fe) return fail(fe);
      addOrder(s, sub, { body: cmd.body, how: 'order', months, cost, ...(name ? { name } : {}), character: cmd.character, band: cmd.priceBand });
      return OK;
    }
    case 'subBadgeModel': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const be = brandOnly(sub); if (be) return fail(be);
      const g = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === cmd.modelId);
      if (!g || g.status !== 'onSale') return fail('본사가 판매 중인 차만 자회사 이름으로 낼 수 있습니다.');
      const err = slotError(s, sub, g.body); if (err) return fail(err);
      const { cost, months } = badgeCost(g), fe = fundError(sub, cost); if (fe) return fail(fe);
      addOrder(s, sub, { body: g.body, how: 'badge', months, cost, fromGen: g.id });
      return OK;
    }
    case 'subCancelOrder': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const o = sub.orders?.find((x) => x.id === cmd.orderId); if (!o) return fail('개발 중인 차가 아닙니다.');
      sub.orders = sub.orders!.filter((x) => x !== o); // 쓴 개발비는 돌아오지 않는다(본사 개발 취소와 같다)
      return OK;
    }
    case 'setSubModelPrice': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      if (!isDirect(sub)) return fail('가격은 직접 운영 중인 자회사에서만 정할 수 있습니다.');
      const md = sub.models.find((x) => x.body === cmd.body); if (!md) return fail('그 차급에 모델이 없습니다.');
      const P = S.modelPrice;
      if (cmd.pct === null) { delete md.price; return OK; }
      if (!Number.isInteger(cmd.pct) || cmd.pct < P.min || cmd.pct > P.max) return fail(`가격은 브랜드 기준 가격의 ${P.min}~${P.max}% 사이 정수로 정하세요.`);
      md.price = cmd.pct / 100; md.a = effA(sub, md, m); return OK;
    }
    case 'setSubTarget': {
      const sub = subOf(s, cmd.subId); if (typeof sub === 'string') return fail(sub);
      const T = cmd.target;
      if (T === null) { if (!sub.target) return fail('정한 목표가 없습니다.'); sub.target = null; return OK; }
      if (!T || (T.kind !== 'sold' && T.kind !== 'profit')) return fail('목표는 판매 대수나 이익 중에서 고르세요.');
      if (T.kind === 'sold' && !isBrand(sub.kind)) return fail('사업 자회사는 판매 대수 목표를 정할 수 없습니다. 이익 목표를 정하세요.');
      const max = T.kind === 'sold' ? S.target.maxSold : S.target.maxProfit;
      if (!Number.isInteger(T.value) || T.value <= 0 || T.value > max) return fail('목표 값이 올바르지 않습니다.');
      sub.target = { kind: T.kind, value: T.value }; return OK;
    }
    default: return null;
  }
}
/** 3.5.0 경쟁사 ri를 인수 브랜드로: 이름·로고 색·라인업(모델 이름·세대·출시 달·세기)을 그대로 물려받는다. 상태에 넣지는 않는다(인수 명령·예상 실적이 함께 쓴다) */
export function buildAcquired(s: CarState, ri: number, price: number): Subsidiary {
  const r = s.rivals[ri], def = RIVALS.find((x) => x.id === r.id)!, m = monthOf(s.week), A = config.rivalry.acquire, bodies = Object.keys(r.models).sort();
  const taken = (n: string) => n === s.companyName || !!s.subs?.some((x) => x.name === n);
  const sub: Subsidiary = {
    id: s.nextId, kind: 'acquired', name: taken(r.name) ? `${r.name} 브랜드` : r.name, color: def.color, founded: m, strategy: 'growth', rivalId: null, mix: { growth: 1 }, switchMonth: m - S.switchMonths,
    bodies, segment: def.segment, dropped: [], dividend: S.defaultSub.dividend, share: S.defaultSub.share as 0 | 1 | 2, president: null,
    capital: Math.round(price * A.capital), rep: Math.max(s.reputation, A.rep), effect: 0, models: [], months: [], total: { invested: price, profit: 0, dividend: 0, sold: 0, hqRep: 0 },
    reports: [], lastPrice: 1, from: r.id, cost: price,
  };
  sub.models = bodies.map((body) => { const md = r.models[body]; return { body, name: rivalModelName(s.seed, ri, r.id, body), n: md.n, start: md.start, cycle: md.cycle, base: md.base, a: 0, sold: 0 }; });
  for (const md of sub.models) md.a = effA(sub, md, m);
  return sub;
}
/** 개발 중인 차 중 아직 모델이 없는 차급(모델 수 상한에 넣는다) */
const newOrders = (sub: Subsidiary): number => (sub.orders ?? []).filter((o) => !sub.models.some((x) => x.body === o.body)).length;
/** 그 차급에 새 차를 낼 수 없는 이유(영역·연구·개발 중·모델 수 상한) */
export function slotError(s: CarState, sub: Subsidiary, body: string): string | null {
  if (!sub.bodies.includes(body)) return '맡은 영역에 없는 차급입니다. 먼저 영역에 넣으세요.';
  if (!areaBodies(s, sub).includes(body)) return '본사가 아직 연구하지 않은 차급입니다.';
  if (sub.orders?.some((o) => o.body === body)) return '그 차급의 차를 이미 개발하고 있습니다.';
  if (!sub.models.some((x) => x.body === body) && sub.models.length + newOrders(sub) >= subModelCap(s, sub)) return `자본이 모자라 모델을 더 둘 수 없습니다(지금 상한 ${subModelCap(s, sub)}개, 모델 하나에 자본 ${won(S.capitalPerModel)}). 투자하면 늘어납니다.`;
  return null;
}
/** 개발비를 낼 수 있는 자본(이번 달에 이미 낼 개발비를 뺀 값) */
export const subFunds = (sub: Subsidiary): number => Math.max(0, sub.capital - (sub.devDue ?? 0));
const fundError = (sub: Subsidiary, cost: number): string | null => (subFunds(sub) < cost ? `자회사 자본이 모자랍니다(개발비 ${won(cost)}, 쓸 수 있는 자본 ${won(subFunds(sub))}). 본사에서 추가 투자하면 개발할 수 있습니다.` : null);
const seedErr = (x: unknown): string | null => (x === undefined || (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 0xffffffff) ? null : '모양 시드가 올바르지 않습니다.');
function carNameError(s: CarState, sub: Subsidiary, name: string, body: string): string | null {
  if (!name) return '이름을 입력하세요.';
  if ([...name].length > config.nameMax) return `이름은 ${config.nameMax}자까지 쓸 수 있습니다.`;
  const used = s.nameplates.some((n) => n.name === name) || (s.subs ?? []).some((x) => x.models.some((y) => y.name === name && !(x === sub && y.body === body)) || (x.orders ?? []).some((o) => o.name === name));
  return used ? `「${name}」${josa(name, '은/는')} 이미 있는 차 이름입니다.` : null;
}
function addOrder(s: CarState, sub: Subsidiary, o: { body: string; how: SubCar['how']; months: number; cost: number; name?: string; spec?: ProjectSpec; character?: SubCharacter; band?: PriceBand; fromGen?: number; chassisSeed?: number; faceSeed?: number }): void {
  const m = monthOf(s.week), { months, chassisSeed, faceSeed, ...rest } = o;
  const spec = rest.spec ? { ...rest.spec } : undefined;
  (sub.orders ??= []).push({ id: s.nextId++, ...rest, ...(spec ? { spec } : {}), start: m, doneMonth: m + months, ...(chassisSeed !== undefined ? { chassisSeed } : {}), ...(faceSeed !== undefined ? { faceSeed } : {}) } as SubOrder);
  sub.devDue = (sub.devDue ?? 0) + o.cost;
}

// ---------- 조회(화면용) ----------
const SHAPE = SUB_DATA.shape as Record<BrandKind, Stats>;
/** 자회사 모델 한 대의 겉으로 보이는 값(경쟁 모델 RivalModelView와 같은 이름의 값 + 내 자회사 표시) */
export interface SubModelView { own: true; subId: number; company: string; color: string; body: string; bodyName: string; name: string; n: number; number: number; start: number; year: number; critic: number; grades: Stats; price: number; unitCost: number; share: number; sold: number; ev: boolean; keep: boolean; seed: number;
  how: SubCar['how'] | null; powertrain: string; tier: number; segment: string; chassisSeed: number; faceSeed: number; pricePct: number | null; stdPrice: number; fromName: string | null; reviews: number[] | null; cycleLeft: number } // 3.1.0 실제 사양(how null = 추정 방식), 직접 정한 가격(%), 브랜드 기준 가격, 배지 원본 이름, 다음 세대교체까지 개월
export function subModelView(s: CarState, sub: Subsidiary, md: SubModel): SubModelView {
  const m = monthOf(s.week), V = config.rivals.view, c0 = criticOf(md), now = c0 - (1 - rivalA(md, m) / (md.base * (1 + config.rivals.fresh))) * V.criticPer;
  const c = md.car, grades = c ? Object.fromEntries(STATS.map((k) => [k, r1(grade(c.stats[k], yearOf(s.week)))])) as Stats
    : Object.fromEntries(STATS.map((k, i) => [k, r1(clamp(now + (sub.from ? RIVALS.find((r) => r.id === sub.from)!.shape : SHAPE[sub.kind as BrandKind])[k] + (hash01(s.seed, 33, sub.id, bodyKey(md.body), md.n, i) * 2 - 1) * V.statJitter, 0, 10))])) as Stats;
  const size = cellMonthly(md.body, monthTime(m)), seed = Math.floor(hash01(s.seed, 34, sub.id, bodyKey(md.body), md.n) * 2 ** 31), std = carBase0(s, md) * brandDef(sub.kind as BrandKind).price * bandMult(md);
  const from = c?.fromGen === undefined ? null : s.nameplates.find((x) => x.generations.some((g) => g.id === c.fromGen))?.name ?? null;
  return { own: true, subId: sub.id, company: sub.name, color: sub.color, body: md.body, bodyName: bodyById(md.body).name, name: md.name, n: md.n, number: md.n + 1, start: md.start, year: yearOfMonth(md.start), critic: c0, grades,
    price: Math.round(subPrice(s, sub, md) / 10) * 10, unitCost: Math.round(subUnitCost(s, sub, md)), share: size > 0 ? Math.min(1, md.sold / size) : 0, sold: md.sold, ev: !!md.ev, keep: !!md.keep, seed,
    how: c?.how ?? null, powertrain: ptOf(md), tier: c?.spec.tier ?? 2, segment: c?.spec.segment ?? sub.segment ?? brandDef(sub.kind as BrandKind).segment, chassisSeed: c?.chassisSeed ?? seed, faceSeed: c?.faceSeed ?? seed >>> 3,
    pricePct: md.price === undefined ? null : Math.round(md.price * 100), stdPrice: Math.round(std / 10) * 10, fromName: from, reviews: c ? [...c.reviews] : null, cycleLeft: Math.max(0, md.start + md.cycle - m) };
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
    strategies: strategyChoices(s, sub), reports: [...sub.reports].reverse(), sellPrice: sellPrice(sub), listed: sub.listed ?? 0, from: sub.from ?? null,
    mode: isDirect(sub) ? 'direct' as const : 'delegate' as const, funds: subFunds(sub), devDue: sub.devDue ?? 0, team: brand ? subTeam(s, sub)[0].ability : 0,
    orders: (sub.orders ?? []).map((o) => ({ id: o.id, body: o.body, bodyName: bodyById(o.body).name, how: o.how, name: o.name ?? (o.how === 'badge' ? s.nameplates.find((x) => x.generations.some((g) => g.id === o.fromGen))?.name ?? '' : ''),
      monthsLeft: Math.max(0, o.doneMonth - m), months: o.doneMonth - o.start, cost: o.cost, character: o.character ? S.character[o.character].name : null, band: o.band ? S.band[o.band].name : null, replaces: sub.models.find((x) => x.body === o.body)?.name ?? null })),
    target: sub.target ? { ...sub.target, progress: targetProgress(sub, m), year: yearOfMonth(m) } : null,
    shareTech: { lag: S.shareLag[sub.share], tierMax: S.shareTier[sub.share] },
    badges: brand ? badgeChoices(s, sub) : [],
  };
}
export type SubDetail = NonNullable<ReturnType<typeof subDetail>>;
/** 3.1.0 배지로 낼 수 있는 본사 차(판매 중, 이 자회사의 영역 차급): 가능 여부·이유·개발비·개월·자회사 평론 */
export function badgeChoices(s: CarState, sub: Subsidiary) {
  return s.nameplates.flatMap((n) => n.generations.filter((g) => g.status === 'onSale').map((g) => ({ g, n }))).filter(({ g }) => sub.bodies.includes(g.body)).sort((a, b) => a.g.id - b.g.id).map(({ g, n }) => {
    const { cost, months } = badgeCost(g), why = slotError(s, sub, g.body) ?? fundError(sub, cost);
    return { generationId: g.id, name: n.name, body: g.body, bodyName: bodyById(g.body).name, critic: r1(clamp(g.reviewAvg + S.badge.critic, 1, 10)), hqCritic: g.reviewAvg, cost, months, ok: why === null, reason: why, replaces: sub.models.find((x) => x.body === g.body)?.name ?? null };
  });
}
/** 3.1.0 그룹 종합(재무 화면): 본사 + 자회사의 달별 판매·매출·이익(최근 12개월), 회사별 12개월 합과 비중. 본사 이익에서 자회사 배당은 빼고 자회사 투자는 되돌린다(그룹 안의 돈 이동). 자회사가 없으면 null */
export function groupSummary(s: CarState) {
  if (!s.subs?.length) return null;
  const L = s.ledger.slice(-config.time.monthsPerYear), subs = [...s.subs].sort((a, b) => a.id - b.id);
  const row = (sold: number, revenue: number, profit: number) => ({ sold, revenue, profit });
  const months = L.map((e) => ({ month: e.month, hq: row(e.sold, e.revenue, e.profit - (e.subDiv ?? 0) + (e.subInv ?? 0)), subs: subs.map((x) => { const r = x.months.find((y) => y.month === e.month); return row(r?.sold ?? 0, r?.revenue ?? 0, r?.profit ?? 0); }) }));
  const sum = (f: (mo: typeof months[number]) => { sold: number; revenue: number; profit: number }) => months.reduce((a, mo) => { const r = f(mo); return row(a.sold + r.sold, a.revenue + r.revenue, a.profit + r.profit); }, row(0, 0, 0));
  const companies = [{ id: 0, name: s.companyName, kind: 'hq' as const, color: '', ...sum((mo) => mo.hq), last: months.at(-1)?.hq ?? row(0, 0, 0) },
    ...subs.map((x, i) => ({ id: x.id, name: x.name, kind: x.kind, color: x.color, ...sum((mo) => mo.subs[i]), last: months.at(-1)?.subs[i] ?? row(0, 0, 0) }))];
  const total = companies.reduce((a, c) => row(a.sold + c.sold, a.revenue + c.revenue, a.profit + c.profit), row(0, 0, 0));
  const last = companies.reduce((a, c) => row(a.sold + c.last.sold, a.revenue + c.last.revenue, a.profit + c.last.profit), row(0, 0, 0));
  return { months: months.map((mo) => ({ month: mo.month, sold: mo.hq.sold + mo.subs.reduce((a, r) => a + r.sold, 0), revenue: mo.hq.revenue + mo.subs.reduce((a, r) => a + r.revenue, 0), profit: mo.hq.profit + mo.subs.reduce((a, r) => a + r.profit, 0), hqProfit: mo.hq.profit })), companies, total, last };
}
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
