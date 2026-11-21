// 판매 공식(설계서 7.3). 국내 시장만, 지역 취향은 1. 유행과 시대 사건(11장)의 배수가 들어간다
import { config } from '../config';
import { COMPAT, MARKET, RIVALS, SEGMENTS, bodyById, optionById, powertrainById } from '../data';
import { grades, lifeFactor } from './cars';
import { eraCostAdd, repEffect, salesFleetMult } from './company';
import { REGION, chargingInfra, eraNow, type EraNow, eraWeights, marketMult, requiredOptions, rivalHitAdd, trendOf } from './events';
import { hash01, type Rng } from './rng';
import { diffOf } from './difficulty';
import { STATS, type CarState, type Generation, type RivalModel, type RivalState, type Stats } from './types';

export { REGION };

/** 표 보간(범위 밖은 끝값). t는 소수 연도(달마다 매끄럽게). geometric이면 두 점 사이를 비율로(연 규모: 일정한 성장률) */
function interp(years: number[], vals: number[], t: number, geometric = false): number {
  if (t <= years[0]) return vals[0];
  for (let i = 1; i < years.length; i++) if (t <= years[i]) {
    const f = (t - years[i - 1]) / (years[i] - years[i - 1]), a = vals[i - 1], b = vals[i];
    return geometric && a > 0 && b > 0 ? a * (b / a) ** f : a + (b - a) * f;
  }
  return vals[vals.length - 1];
}

/** 칸(지역 × 차체)의 월 규모(대). t: 소수 연도(monthTime) */
export function cellMonthly(body: string, t: number): number {
  const m = MARKET[REGION], share = m.bodyShare[body];
  if (!share) return 0;
  return (interp(m.years, m.annual, t, true) * interp(m.years, share, t) * config.market.scale) / config.time.monthsPerYear;
}

/** 매력(차, 고객층) = Σ 가중치 × 표시 등급/5 × 궁합 × 유행. w: 사건이 바꾼 가중치(생략하면 자료값), trend: 유행 계수(차체 × 동력, 생략하면 1) */
export function attractiveness(g: Stats, body: string, segment: string, w?: Stats, trend = 1, compat = COMPAT[body]?.[segment] ?? 1): number {
  const seg = SEGMENTS.find((s) => s.id === segment)!, ww = w ?? seg.w;
  return STATS.reduce((a, k) => a + ww[k] * (g[k] / config.grade.mid), 0) * compat * trend;
}

/** 가격 매력 = (기준가 × 매력 / 판매가)^ε, 0.2~2.5. 기준가보다 비싸면 (기준가/판매가)^6, 기준가의 108%(overpriceHardAt)를 넘으면 그 넘는 부분에 ^20을 더 곱한다(자르기 뒤, 0.5.0) */
export const priceAppeal = (basePrice: number, attract: number, price: number, eps: number): number =>
  Math.min(config.market.priceAppealMax, Math.max(config.market.priceAppealMin, ((basePrice * attract) / price) ** eps))
  * Math.min(1, basePrice / price) ** config.market.overpriceExp * Math.min(1, (basePrice * config.market.overpriceHardAt) / price) ** config.market.overpriceHardExp;

/** 시장 기준가(0.4.2) = 차체 기준가 + 지금 규제 의무 장비의 원가. 모든 회사가 의무 장비를 넣으므로 시장 가격이 그만큼 오른다(가격 매력·가성비 평론·봇 가격에 쓴다) */
/** 1.0.0: powertrain을 주면 그 동력의 시장 가산(powertrains.json premium, 연도 표 보간)을 곱한다. 하이브리드·전기차는 원가가 비싼 만큼 시장 가격도 높다(없으면 기준가에 팔 때 적자) */
export const basePriceOf = (s: CarState, body: string, powertrain?: string): number => bodyById(body).basePrice * priceErosion(Math.floor(s.week / config.time.weeksPerMonth)) * (1 + ptPremium(powertrain, s.week / config.time.weeksPerMonth / config.time.monthsPerYear + config.time.startYear)) + requiredOptions(s).reduce((a, o) => a + optionById(o).cost, 0);
/** 1.0.0 옵션 하나를 손님이 쳐 주는 값 = 옵션 원가 × (1 + 시대 원가 상승) × (그 옵션이 올리는 능력치(실용·디자인·품질)에 대한 이 고객층의 가중치 평균이 fitMin 이상이면 good, 아니면 bad).
 *  맞는 장비를 맞는 손님에게 넣으면 원가보다 조금 더 받고, 아무 장비나 넣으면 손해(전에는 옵션 값이 기준가에 없어 넣을수록 대당 이익이 줄었다) */
export function optionValue(id: string, segment: string, year = config.time.startYear): number {
  const o = optionById(id), w = SEGMENTS.find((x) => x.id === segment)?.w, tot = o.U + o.D + o.Q, V = config.optionValue;
  const fit = w && tot > 0 ? (o.U * w.U + o.D * w.D + o.Q * w.Q) / tot : 0;
  return o.cost * (1 + eraCostAdd(year)) * (fit >= V.fitMin ? V.good : V.bad); // 시대 원가 상승(eraCostAdd)만큼 값도 오른다(공장 원가 배수 ≤ 1이므로 맞는 옵션은 대당 이익을 줄이지 않는다)
}
/** 1.0.0 차별 기준가 = 차급 기준가(basePriceOf: 동력 가산·의무 장비 포함) + 단 옵션(의무 장비 제외)의 값. 가격 매력·가성비 평론·최고 이익 가격·자동 가격 % 기준·화면 '기준가'가 같이 쓴다 */
export function carBasePrice(s: CarState, car: { body: string; segment: string; powertrain?: string; options?: string[] }): number {
  const req = requiredOptions(s);
  return basePriceOf(s, car.body, car.powertrain) + (car.options ?? []).reduce((a, o) => a + (req.includes(o) ? 0 : optionValue(o, car.segment, s.week / config.time.weeksPerMonth / config.time.monthsPerYear + config.time.startYear)), 0);
}
/** 판매 중인 세대의 차별 기준가(지금 판의 옵션) */
export const genBasePrice = (s: CarState, g: Generation): number => carBasePrice(s, { body: g.body, segment: g.segment, powertrain: g.powertrain, options: currentEdition(g).options });
/** 동력의 시장 가격 가산(1.0.0). t: 소수 연도 */
export const ptPremium = (powertrain: string | undefined, t: number): number => { const p = powertrain ? powertrainById(powertrain).premium : undefined; return p ? interp(p.years, p.values, t) : 0; };
/** 0.5.1 시장 포화(가격 경쟁): fromYear부터 시장 기준가가 해마다 perYear씩 낮아진다(최대 max). month: 월 번호 */
export const priceErosion = (month: number): number => { const e = config.market.erosion, y = config.time.startYear + month / config.time.monthsPerYear; return 1 - Math.min(e.max, Math.max(0, (y - e.fromYear) * e.perYear)); };

/** 판매 계산에 필요한 차 한 대의 요약(출시 전 미리보기에도 쓴다). powertrain: 동력 종류(유행·사건 수요 배수, 없으면 배수 1) */
export interface SaleCar { body: string; segment: string; stats: Stats; price: number; awareness: number; life: number; powertrain?: string; options?: string[] } // options(1.0.0): 단 옵션(차별 기준가에 쓴다)

/** 점유 점수 A(차, 고객층) = 매력 × 가격 매력 × 인지도 × 수명. 등급은 그해 기준(소수 연도는 내림). fleetMult: 영업 직원의 법인·택시 매력 배수(9.1).
 *  w·trend: 사건이 바꾼 고객층 가중치와 유행 계수(생략하면 자료값·1) */
export function scoreA(c: SaleCar, segment: string, year: number, fleetMult = 1, w?: Stats, trend = 1, base = bodyById(c.body).basePrice, compat?: number): number {
  const attract = attractiveness(grades(c.stats, Math.floor(year)), c.body, segment, w, trend, compat) * (segment === config.staff.sales.fleetSegment ? fleetMult : 1);
  const eps = SEGMENTS.find((s) => s.id === segment)!.eps;
  const aw = Math.min(1, c.awareness * (segment === c.segment ? config.market.primaryBoost : 1));
  return attract * priceAppeal(base, attract, c.price, eps) * aw * c.life;
}

/** 월 수요(생산 상한 적용 전) = Σ 고객층 칸 월 규모 × 비중 × 점유율. others: 같은 칸의 내 다른 차. year: 소수 연도(monthTime, 시장 규모가 달마다 변한다).
 *  시대 사건(11장): 칸 규모 × 차체 수요 × 시장 규모, 고객층 비중 × 고객층 배수, 가중치 배수, 유행(차체 × 동력), 동력 수요 배수, 전기는 × 충전 인프라, 경쟁 차 히트작 */
/** 0.10.0 판매 요인 분해용 바꿔 넣기(생략하면 실제 계산): noEra 시대 사건 효과(충전 인프라 포함) 없음, rivalA 경쟁 차마다 이 A(난이도 배수 전, 히트작 없음),
 *  noOthers 같은 차급의 우리 다른 차 없음, compatSeg 이 고객층의 궁합을 1로 */
export interface DemandAlt { noEra?: boolean; rivalA?: number; noOthers?: boolean; compatSeg?: string }
const NO_ERA: EraNow = { statW: {}, body: {}, pt: {}, seg: {}, market: {}, trendAdd: {}, loan: 1, production: 1 };
export function monthlyDemand(state: CarState, car: SaleCar, others: SaleCar[], year: number, alt: DemandAlt = {}): number {
  const m = Math.floor((year - config.time.startYear) * config.time.monthsPerYear + 1e-6), n = alt.noEra ? NO_ERA : eraNow(state.seed, m);
  const size = cellMonthly(car.body, year) * (n.body[car.body] ?? 1) * marketMult(n), mix = MARKET[REGION].mix[car.body] ?? {};
  const e = config.market.shareExp, fm = salesFleetMult(state), rm = diffOf(state).rivalMult; // rm: 난이도의 경쟁 차 A 배수
  const tr = (c: SaleCar) => trendOf(c.body, year, n) * (c.powertrain ? trendOf(c.powertrain, year, n) : 1);
  const trMine = tr(car), bp = new Map<SaleCar, number>(), baseOf = (c: SaleCar) => { let v = bp.get(c); if (v === undefined) bp.set(c, (v = carBasePrice(state, c))); return v; }; // 1.0.0 차별 기준가(성능: 고객층마다 다시 구하지 않는다)
  let total = 0, rivals = 0;
  const resp = alt.rivalA === undefined ? rivalResponse(state, car.body, year) : 1;
  for (const r of state.rivals) rivals += ((alt.rivalA ?? (r.cells[car.body] ?? 0) * resp + rivalHitAdd(state, r.id, car.body, m)) * rm) ** e; // 경쟁 차는 고객층과 무관(1.0.0 성능: 한 번만)
  for (const seg of SEGMENTS) {
    const w = (mix[seg.id] ?? 0) * (n.seg[seg.id] ?? 1);
    if (w <= 0) continue;
    const ww = eraWeights(seg.w, n);
    const mine = scoreA(car, seg.id, year, fm, ww, trMine, baseOf(car), alt.compatSeg === seg.id ? 1 : undefined) ** e;
    let rest = rivals;
    if (!alt.noOthers) for (const o of others) if (o.body === car.body) rest += scoreA(o, seg.id, year, fm, ww, tr(o), baseOf(o)) ** e;
    if (mine > 0) total += size * w * (mine / (mine + rest));
  }
  if (car.powertrain) total *= (n.pt[car.powertrain] ?? 1) * (car.powertrain === config.events.charging.powertrain && !alt.noEra ? chargingInfra(state.seed, m) : 1);
  return total;
}

/** 1.0.0 경쟁사의 대응(설계서 7.4 '쉬운 독점 방지'): 지난달 이 차급에서 우리 판매가 칸 월 규모의 share0를 넘으면 그 넘는 몫 × k만큼 경쟁 차 A가 세진다.
 *  시장이 성숙하는 from~to년에 0에서 1로 켜진다(창업 초기 작은 시장에서는 없음). 한 차급을 장악한 회사일수록 그 차급의 웃돈·판매가 줄어든다 */
export function rivalResponse(state: CarState, body: string, t: number): number {
  const R = config.rivals.response, on = Math.min(1, Math.max(0, (t - R.from) / (R.to - R.from)));
  if (on <= 0) return 1;
  let sold = 0;
  for (const n of state.nameplates) for (const g of n.generations) if (g.body === body && g.status !== 'discontinued') sold += g.sales.at(-1) ?? 0;
  const size = cellMonthly(body, t);
  return size > 0 ? 1 + on * R.k * Math.max(0, sold / size - R.share0) : 1;
}
export const currentEdition = (g: Generation) => g.editions[g.editions.length - 1];
export const ageMonths = (g: Generation, month: number): number => month - g.launchMonth;
/** 수명 나이(페이스리프트로 되돌아간 나이) */
export const lifeAge = (g: Generation, month: number): number => month - g.lifeMonth;
export const toSaleCar = (g: Generation, month: number): SaleCar => {
  const ed = currentEdition(g);
  return { body: g.body, segment: g.segment, stats: ed.stats, price: ed.price, awareness: g.awareness, life: lifeFactor(lifeAge(g, month)), powertrain: g.powertrain, options: ed.options };
};

/** 목표 인지도 = 0.15 + 평판/250 + 마케팅 가산 + 입소문(품질 등급) */
export function awarenessTarget(reputation: number, marketing: number, qGrade: number): number {
  const a = config.awareness;
  return Math.min(1, Math.max(0, a.base + repEffect(reputation) / a.repDiv + a.marketingTarget[marketing] + a.wordOfMouth * qGrade));
}
/** 출시 시 인지도 = 0.15 + 평판/250 + 평론 보너스 */
export function awarenessStart(reputation: number, reviewAvg: number): number {
  const a = config.awareness;
  return Math.min(1, Math.max(0, a.base + repEffect(reputation) / a.repDiv + (reviewAvg - config.grade.mid) * a.reviewPer));
}

/** 경쟁사 3곳: 칸마다 첫 모델의 기본 A = 기본값 + 강약 ± 난수(게임 난수는 1단계와 같은 순서로 이것만 쓴다). 첫 모델의 나이는 해시로 흩는다 */
export function initRivals(rng: Rng, seed: number): RivalState[] {
  return [...RIVALS].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r, ri) => {
    const cells: Record<string, number> = {}, models: Record<string, RivalModel> = {};
    for (const body of Object.keys(r.cells).sort()) {
      const late = (config.rivals.lateCells as readonly string[]).includes(body), n = config.rivals.noise;
      const base = rivalBase(0) + r.cells[body] + (late ? (hash01(seed, 4, ri, bodyKey(body)) * 2 - 1) * n : rng.range(-n, n));
      models[body] = firstRivalModel(seed, ri, body, base);
    }
    const st = { id: r.id, name: r.name, cells, models };
    updateRivals([st], seed, 0);
    return st;
  });
}
/** 경쟁사의 성장(3단계 설계 결정 b): 경쟁 차 기본 A = 1970년 base에서 해마다 growth씩 올라 max에서 멈춘다. 새 모델을 낼 때의 달로 정한다 */
export const rivalBase = (month: number): number => {
  const r = config.rivals;
  return Math.min(r.baseMax, r.base + (r.baseGrowth * month) / config.time.monthsPerYear);
};
const bodyKey = (body: string): number => [...body].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0), 7) >>> 0;
const rivalCycle = (seed: number, ri: number, body: string, n: number): number =>
  config.rivals.cycleMin + Math.floor(hash01(seed, 1, ri, bodyKey(body), n) * (config.rivals.cycleMax - config.rivals.cycleMin + 1));
/** 이미 있던 칸 값(base)으로 첫 모델을 만든다. 출시 달은 0 이전으로 흩어 둔다(모든 경쟁 차가 한꺼번에 낡지 않게) */
export function firstRivalModel(seed: number, ri: number, body: string, base: number): RivalModel {
  const cycle = rivalCycle(seed, ri, body, 0);
  return { n: 0, start: -Math.floor(hash01(seed, 2, ri, bodyKey(body)) * cycle), cycle, base };
}
/** 경쟁 차의 지금 A: 새 모델 × (1 + fresh) × (1 − decay)^수명 나이. 주기 절반에 페이스리프트(수명 나이 40%로) */
export function rivalA(md: RivalModel, month: number): number {
  const r = config.rivals, age = month - md.start, half = md.cycle * r.faceliftAt;
  const life = age < half ? age : half * r.faceliftKeep + (age - half);
  return md.base * (1 + r.fresh) * (1 - r.decay) ** life;
}
/** 매달: 주기가 끝난 칸은 새 모델(기본 A를 해시 난수로 다시 뽑음, 게임 난수 소비 없음), 그리고 칸 값 갱신. ID·차체 순 */
export function updateRivals(rivals: RivalState[], seed: number, month: number): void {
  const r = config.rivals;
  rivals.forEach((st, ri) => {
    const def = RIVALS.find((x) => x.id === st.id);
    for (const body of Object.keys(st.models).sort()) {
      const md = st.models[body];
      if (month - md.start >= md.cycle) {
        const n = md.n + 1;
        st.models[body] = { n, start: month, cycle: rivalCycle(seed, ri, body, n), base: rivalBase(month) + (def?.cells[body] ?? 0) + (hash01(seed, 3, ri, bodyKey(body), n) * 2 - 1) * r.noise };
      }
      st.cells[body] = rivalA(st.models[body], month);
    }
  });
}
