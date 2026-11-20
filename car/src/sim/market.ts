// 판매 공식(설계서 7.3). 1단계: 국내 시장만, 유행·지역 취향은 1.
import { config } from '../config';
import { COMPAT, MARKET, RIVALS, SEGMENTS, bodyById } from '../data';
import { grades, lifeFactor } from './cars';
import { hash01, type Rng } from './rng';
import { STATS, type CarState, type Generation, type RivalModel, type RivalState, type Stats } from './types';

export const REGION = 'domestic';

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

/** 매력(차, 고객층) = Σ 가중치 × 표시 등급/5 × 궁합 (유행·지역 취향은 1단계에서 1) */
export function attractiveness(g: Stats, body: string, segment: string): number {
  const seg = SEGMENTS.find((s) => s.id === segment)!;
  return STATS.reduce((a, k) => a + seg.w[k] * (g[k] / config.grade.mid), 0) * (COMPAT[body]?.[segment] ?? 1);
}

/** 가격 매력 = (기준가 × 매력 / 판매가)^ε, 0.2~2.5 */
export const priceAppeal = (basePrice: number, attract: number, price: number, eps: number): number =>
  Math.min(config.market.priceAppealMax, Math.max(config.market.priceAppealMin, ((basePrice * attract) / price) ** eps));

/** 판매 계산에 필요한 차 한 대의 요약(출시 전 미리보기에도 쓴다) */
export interface SaleCar { body: string; segment: string; stats: Stats; price: number; awareness: number; life: number }

/** 점유 점수 A(차, 고객층) = 매력 × 가격 매력 × 인지도 × 수명. 등급은 그해 기준(소수 연도는 내림) */
export function scoreA(c: SaleCar, segment: string, year: number): number {
  const attract = attractiveness(grades(c.stats, Math.floor(year)), c.body, segment);
  const eps = SEGMENTS.find((s) => s.id === segment)!.eps;
  const aw = Math.min(1, c.awareness * (segment === c.segment ? config.market.primaryBoost : 1));
  return attract * priceAppeal(bodyById(c.body).basePrice, attract, c.price, eps) * aw * c.life;
}

/** 월 수요(생산 상한 적용 전) = Σ 고객층 칸 월 규모 × 비중 × 점유율. others: 같은 칸의 내 다른 차. year: 소수 연도(monthTime, 시장 규모가 달마다 변한다) */
export function monthlyDemand(state: CarState, car: SaleCar, others: SaleCar[], year: number): number {
  const size = cellMonthly(car.body, year), mix = MARKET[REGION].mix[car.body] ?? {};
  const e = config.market.shareExp;
  let total = 0;
  for (const seg of SEGMENTS) {
    const w = mix[seg.id] ?? 0;
    if (w <= 0) continue;
    const mine = scoreA(car, seg.id, year) ** e;
    let rest = 0;
    for (const r of state.rivals) rest += (r.cells[car.body] ?? 0) ** e;
    for (const o of others) if (o.body === car.body) rest += scoreA(o, seg.id, year) ** e;
    if (mine > 0) total += size * w * (mine / (mine + rest));
  }
  return total;
}

export const currentEdition = (g: Generation) => g.editions[g.editions.length - 1];
export const ageMonths = (g: Generation, month: number): number => month - g.launchMonth;
/** 수명 나이(페이스리프트로 되돌아간 나이) */
export const lifeAge = (g: Generation, month: number): number => month - g.lifeMonth;
export const toSaleCar = (g: Generation, month: number): SaleCar => {
  const ed = currentEdition(g);
  return { body: g.body, segment: g.segment, stats: ed.stats, price: ed.price, awareness: g.awareness, life: lifeFactor(lifeAge(g, month)) };
};

/** 목표 인지도 = 0.15 + 평판/250 + 마케팅 가산 + 입소문(품질 등급) */
export function awarenessTarget(reputation: number, marketing: number, qGrade: number): number {
  const a = config.awareness;
  return Math.min(1, Math.max(0, a.base + reputation / a.repDiv + a.marketingTarget[marketing] + a.wordOfMouth * qGrade));
}
/** 출시 시 인지도 = 0.15 + 평판/250 + 평론 보너스 */
export function awarenessStart(reputation: number, reviewAvg: number): number {
  const a = config.awareness;
  return Math.min(1, Math.max(0, a.base + reputation / a.repDiv + (reviewAvg - config.grade.mid) * a.reviewPer));
}

/** 경쟁사 3곳: 칸마다 첫 모델의 기본 A = 기본값 + 강약 ± 난수(게임 난수는 1단계와 같은 순서로 이것만 쓴다). 첫 모델의 나이는 해시로 흩는다 */
export function initRivals(rng: Rng, seed: number): RivalState[] {
  return [...RIVALS].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r, ri) => {
    const cells: Record<string, number> = {}, models: Record<string, RivalModel> = {};
    for (const body of Object.keys(r.cells).sort()) {
      const base = config.rivals.base + r.cells[body] + rng.range(-config.rivals.noise, config.rivals.noise);
      models[body] = firstRivalModel(seed, ri, body, base);
    }
    const st = { id: r.id, name: r.name, cells, models };
    updateRivals([st], seed, 0);
    return st;
  });
}
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
        st.models[body] = { n, start: month, cycle: rivalCycle(seed, ri, body, n), base: r.base + (def?.cells[body] ?? 0) + (hash01(seed, 3, ri, bodyKey(body), n) * 2 - 1) * r.noise };
      }
      st.cells[body] = rivalA(st.models[body], month);
    }
  });
}
