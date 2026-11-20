// 판매 공식(설계서 7.3)과 경쟁사 규칙(7.4). 시장 칸 = 지역 × 차체. 유행·시대 사건(11장)·지역 취향(7.5)의 배수가 들어간다
import { config } from '../config';
import { COMPAT, MARKET, NAMES, RANDOM_EVENTS, RIVALS, SEGMENTS, bodyById } from '../data';
import { grades, lifeFactor } from './cars';
import { salesFleetMult } from './company';
import { REGION, announceRivalHit, chargingInfra, eraNow, eraWeights, marketMult, ptDemandMult, regulationsNow, saleBanned, trendOf } from './events';
import { diffOf } from './difficulty';
import { hash01, type Rng } from './rng';
import { yearOfMonth } from './time';
import { josa } from './josa';
import { STATS, type CarState, type GameEvent, type Generation, type RivalDef, type RivalModel, type RivalState, type SegmentDef, type Stats } from './types';

export { REGION };
/** 지역 4곳(자료 순서: 국내, 아시아, 유럽, 북미) */
export const REGIONS = Object.keys(MARKET);
export const cellKey = (region: string, body: string): string => `${region}:${body}`;
const MPY = config.time.monthsPerYear;

/** 표 보간(범위 밖은 끝값). t는 소수 연도(달마다 매끄럽게). geometric이면 두 점 사이를 비율로(연 규모: 일정한 성장률) */
function interp(years: number[], vals: number[], t: number, geometric = false): number {
  if (t <= years[0]) return vals[0];
  for (let i = 1; i < years.length; i++) if (t <= years[i]) {
    const f = (t - years[i - 1]) / (years[i] - years[i - 1]), a = vals[i - 1], b = vals[i];
    return geometric && a > 0 && b > 0 ? a * (b / a) ** f : a + (b - a) * f;
  }
  return vals[vals.length - 1];
}

/** 칸(지역 × 차체)의 월 규모(대, 사건 배수 전). t: 소수 연도(monthTime). 연 규모는 기하 보간, × 시장 배수 × 지역 배수 */
export function cellMonthly(body: string, t: number, region = REGION): number {
  const m = MARKET[region], share = m?.bodyShare[body];
  if (!share) return 0;
  return (interp(m.years, m.annual, t, true) * interp(m.years, share, t) * config.market.scale * (config.market.regionScale[region] ?? 1)) / MPY;
}
/** 지역의 연 시장 규모(대, 사건 배수 전) */
export const regionAnnual = (region: string, t: number): number => BODY_IDS.reduce((a, b) => a + cellMonthly(b, t, region), 0) * MPY;
const BODY_IDS = Object.keys(MARKET[REGION].bodyShare);

/** 지역 취향 배수(7.5): 차체 × 동력 × 품질 기준(품질 등급이 기준보다 낮으면 1등급당 감점, 하한). 국내는 1 */
export function tasteMult(region: string, body: string, powertrain: string | undefined, qGrade: number): number {
  const t = MARKET[region].taste;
  let m = (t.body[body] ?? 1) * (powertrain ? t.pt[powertrain] ?? 1 : 1);
  if (t.quality && qGrade < t.quality.min) m *= Math.max(t.quality.floor, 1 - t.quality.per * (t.quality.min - qGrade));
  return m;
}

/** 매력(차, 고객층) = Σ 가중치 × 표시 등급/5 × 궁합 × 유행. w: 사건이 바꾼 가중치(생략하면 자료값), trend: 유행 계수(차체 × 동력, 생략하면 1) */
export function attractiveness(g: Stats, body: string, segment: string, w?: Stats, trend = 1): number {
  const seg = SEGMENTS.find((s) => s.id === segment)!, ww = w ?? seg.w;
  return STATS.reduce((a, k) => a + ww[k] * (g[k] / config.grade.mid), 0) * (COMPAT[body]?.[segment] ?? 1) * trend;
}

/** 가격 매력 = (기준가 × 매력 / 판매가)^ε, 0.2~2.5. 기준가보다 비싸면 (기준가/판매가)^overpriceExp를 더 곱한다(자르기 뒤, 3단계 추가 계수) */
export const priceAppeal = (basePrice: number, attract: number, price: number, eps: number): number =>
  Math.min(config.market.priceAppealMax, Math.max(config.market.priceAppealMin, ((basePrice * attract) / price) ** eps))
  * Math.min(1, basePrice / price) ** config.market.overpriceExp;

/** 판매 계산에 필요한 차 한 대의 요약(출시 전 미리보기에도 쓴다). powertrain: 동력 종류(유행·사건 수요 배수, 없으면 배수 1) */
export interface SaleCar { body: string; segment: string; stats: Stats; price: number; awareness: number; life: number; powertrain?: string }

/** 점유 점수 A(차, 고객층) = 매력 × 가격 매력 × 인지도 × 수명. 등급은 그해 기준(소수 연도는 내림). fleetMult: 영업 직원의 법인·택시 매력 배수(9.1).
 *  w·trend: 사건이 바꾼 고객층 가중치와 유행 계수(생략하면 자료값·1). region: 지역 취향(매력 배수)과 가격 민감도(ε 배수), 인지도는 그 지역 값을 넣을 것 */
export function scoreA(c: SaleCar, segment: string, year: number, fleetMult = 1, w?: Stats, trend = 1, region = REGION): number {
  const g = grades(c.stats, Math.floor(year));
  const attract = attractiveness(g, c.body, segment, w, trend) * tasteMult(region, c.body, c.powertrain, g.Q) * (segment === config.staff.sales.fleetSegment ? fleetMult : 1);
  const eps = SEGMENTS.find((s) => s.id === segment)!.eps * MARKET[region].taste.eps;
  const aw = Math.min(1, c.awareness * (segment === c.segment ? config.market.primaryBoost : 1));
  return attract * priceAppeal(bodyById(c.body).basePrice, attract, c.price, eps) * aw * c.life;
}

/** 칸 하나의 판매(생산 상한 적용 전): cars(같은 지역·차체의 내 차들)의 월 수요와 경쟁 차별 월 판매.
 *  월 수요 = Σ 고객층 칸 월 규모 × 비중 × 점유율, 점유율 = A^지수 / Σ A^지수(내 차들 + 경쟁 차). 시대 사건: 칸 규모 × 차체 수요 × 지역 시장 규모, 고객층 비중 × 고객층 배수,
 *  가중치 배수, 유행(차체 × 동력, 지역별), 내 차의 동력 수요 배수(지역 포함)·전기 충전 인프라는 점유 뒤에 곱한다. 판매가 금지된 동력(지역 규제)은 0 */
export interface CellSales { size: number; mine: number[]; rivals: { id: string; units: number; model: RivalModel }[] }
export function cellSales(state: CarState, region: string, body: string, cars: SaleCar[], year: number): CellSales {
  const m = Math.floor((year - config.time.startYear) * MPY + 1e-6), n = eraNow(state.seed, m), key = cellKey(region, body);
  const size = cellMonthly(body, year, region) * (n.body[body] ?? 1) * marketMult(n, region), mix = MARKET[region]?.mix[body] ?? {};
  const e = config.market.shareExp, fm = salesFleetMult(state), rm = diffOf(state).rivalMult; // rm: 난이도의 경쟁 차 A 배수
  const ch = chargingInfra(state.seed, m), ptMult = (pt: string) => ptDemandMult(n, pt, region) * (pt === config.events.charging.powertrain ? ch : 1);
  const trs = cars.map((c) => trendOf(c.body, year, n, region) * (c.powertrain ? trendOf(c.powertrain, year, n, region) : 1));
  const rv = state.rivals.flatMap((r) => { const md = r.models[key]; return md ? [{ id: r.id, model: md, a: rivalA(md, m) * rm * trendOf(md.pt, year, n, region) * ptMult(md.pt) }] : []; });
  const out: CellSales = { size, mine: cars.map(() => 0), rivals: rv.map((x) => ({ id: x.id, units: 0, model: x.model })) };
  const base = bodyById(body).basePrice;
  for (const seg of SEGMENTS) {
    const w = (mix[seg.id] ?? 0) * (n.seg[seg.id] ?? 1);
    if (w <= 0) continue;
    const ww = eraWeights(seg.w, n);
    const mine = cars.map((c, i) => scoreA(c, seg.id, year, fm, ww, trs[i], region) ** e);
    const theirs = rv.map((x) => (x.a * rivalTilt(x.model, seg, base)) ** e);
    const tot = mine.reduce((a, x) => a + x, 0) + theirs.reduce((a, x) => a + x, 0);
    if (tot <= 0) continue;
    mine.forEach((x, i) => { if (x > 0) out.mine[i] += (size * w * x) / tot; });
    theirs.forEach((x, i) => { out.rivals[i].units += (size * w * x) / tot; });
  }
  cars.forEach((c, i) => { if (c.powertrain) out.mine[i] *= saleBanned(state.seed, m, region, c.powertrain) ? 0 : ptMult(c.powertrain); });
  return out;
}

/** 월 수요(생산 상한 적용 전, 한 지역). others: 내 다른 차(같은 차체만 경쟁). year: 소수 연도(monthTime). region: 지역(생략하면 국내), car.awareness는 그 지역 인지도 */
export function monthlyDemand(state: CarState, car: SaleCar, others: SaleCar[], year: number, region = REGION): number {
  return cellSales(state, region, car.body, [car, ...others.filter((o) => o.body === car.body)], year).mine[0];
}

/** 고객층의 스포티 정도: (성능 + 디자인) − (실용 + 연비) 가중치 */
const segSport = (seg: SegmentDef) => seg.w.P + seg.w.D - seg.w.U - seg.w.E;
/** 경쟁 차의 고객층별 A 배수: 성격이 그 고객층 취향에 맞으면 강하고, 비싼 차는 가격에 민감한 층에서 약하다 */
export function rivalTilt(md: RivalModel, seg: SegmentDef, basePrice: number): number {
  const r = config.rivals;
  return Math.max(0.1, 1 + r.sportTilt * (md.sport - 0.5) * segSport(seg)) * (basePrice / md.price) ** (r.priceTilt * (seg.eps - config.market.epsMean));
}
/** 차의 성격(0 실용 ~ 1 스포티): (성능 + 디자인)이 (실용 + 연비)보다 얼마나 큰가. 같으면 0.5 */
export function personality(st: Pick<Stats, 'P' | 'D' | 'U' | 'E'>): number {
  const tot = st.P + st.D + st.U + st.E;
  return tot > 0 ? Math.min(1, Math.max(0, (2 * (st.P + st.D)) / tot - 0.5)) : 0.5;
}

export const currentEdition = (g: Generation) => g.editions[g.editions.length - 1];
export const ageMonths = (g: Generation, month: number): number => month - g.launchMonth;
/** 수명 나이(페이스리프트로 되돌아간 나이) */
export const lifeAge = (g: Generation, month: number): number => month - g.lifeMonth;
/** 지역 인지도(국내는 awareness, 해외는 foreignAwareness) */
export const awarenessIn = (g: Generation, region: string): number => (region === REGION ? g.awareness : g.foreignAwareness?.[region] ?? 0);
export const setAwarenessIn = (g: Generation, region: string, v: number): void => { if (region === REGION) g.awareness = v; else g.foreignAwareness[region] = v; };
export const toSaleCar = (g: Generation, month: number, region = REGION): SaleCar => {
  const ed = currentEdition(g);
  return { body: g.body, segment: g.segment, stats: ed.stats, price: ed.price, awareness: awarenessIn(g, region), life: lifeFactor(lifeAge(g, month)), powertrain: g.powertrain };
};

/** 목표 인지도 = 0.15 + 평판/250 + 마케팅 가산 + 입소문(품질 등급). 해외(region)는 기본값이 낮고 평판의 일부만 반영 */
export function awarenessTarget(reputation: number, marketing: number, qGrade: number, region = REGION): number {
  const a = config.awareness, f = region === REGION ? { base: a.base, repShare: 1 } : a.foreign;
  return Math.min(1, Math.max(0, f.base + (reputation * f.repShare) / a.repDiv + a.marketingTarget[marketing] + a.wordOfMouth * qGrade));
}
/** 출시(또는 그 지역 판매 시작) 때 인지도 = 0.15 + 평판/250 + 평론 보너스(+ 차종 자산은 호출하는 쪽). 해외는 기본값이 낮고 평판의 일부만 */
export function awarenessStart(reputation: number, reviewAvg: number, region = REGION): number {
  const a = config.awareness, f = region === REGION ? { base: a.base, repShare: 1 } : a.foreign;
  return Math.min(1, Math.max(0, f.base + (reputation * f.repShare) / a.repDiv + (reviewAvg - config.grade.mid) * a.reviewPer));
}

/** 경쟁사가 그 지역에 있는 해인가(진출 연도 ~ 철수 연도) */
export const rivalPresent = (def: RivalDef, region: string, year: number): boolean => year >= (def.enter?.[region] ?? def.from) && (def.until === null || year < def.until);
/** 경쟁사 해시 번호: 자료 순서(앞 셋은 4단계까지의 정렬 순서와 같아 국내 칸의 교체 주기가 그대로다) */
const rivalIndex = (id: string) => RIVALS.findIndex((r) => r.id === id);
const strKey = (k: string): number => [...k].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0), 7) >>> 0;
/** 칸 해시 키: 국내는 4단계와 같은 차체 키, 해외는 "지역:차체" */
const hashKey = (region: string, body: string) => strKey(region === REGION ? body : cellKey(region, body));
const rivalCycle = (seed: number, ri: number, hk: number, n: number): number =>
  config.rivals.cycleMin + Math.floor(hash01(seed, 1, ri, hk, n) * (config.rivals.cycleMax - config.rivals.cycleMin + 1));
const HIT = (RANDOM_EVENTS.find((d) => d.onFire?.type === 'rivalHit')!.onFire as { add: number; months: number });

/** 경쟁사의 성장(3단계 설계 결정 b): 경쟁 차 기본 A = 1970년 base에서 해마다 growth씩 올라 max에서 멈춘다. 새 모델을 낼 때의 달로 정한다 */
export const rivalBase = (month: number): number => {
  const r = config.rivals;
  return Math.min(r.baseMax, r.base + (r.baseGrowth * month) / MPY);
};
/** 차체 자체의 성격(차체 배수로 본 스포티 정도) */
const bodySport = (body: string) => personality(bodyById(body).mult);
/** 새 모델의 동력: 회사의 연대별 구성 × 지금 사건의 동력 수요 배수 × 유행. 그 지역에서 출시가 금지된 동력은 뺀다. 시드 해시로 고른다 */
function rivalPt(seed: number, def: RivalDef, ri: number, region: string, body: string, n: number, month: number): string {
  const y = config.time.startYear + month / MPY, era = eraNow(seed, month), banned = regulationsNow(seed, month, region).flatMap((r) => r.rule.powertrains ?? []);
  const ws = Object.keys(def.pt.mix).sort().map((pt) => ({ pt, w: banned.includes(pt) ? 0 : Math.max(0, interp(def.pt.years, def.pt.mix[pt], y)) * ptDemandMult(era, pt, region) * trendOf(pt, y, era, region) }));
  const tot = ws.reduce((a, x) => a + x.w, 0);
  if (tot <= 0) return ws.find((x) => def.pt.mix[x.pt].some((v) => v > 0))?.pt ?? 'gasoline';
  let r = hash01(seed, 7, ri, hashKey(region, body), n) * tot;
  for (const x of ws) { r -= x.w; if (r < 0) return x.pt; }
  return ws[ws.length - 1].pt;
}
/** 경쟁 차 모델 하나(n번째, start 달 출시, 기본 A = base) */
function makeModel(seed: number, def: RivalDef, region: string, body: string, n: number, start: number, cycle: number, base: number, month: number): RivalModel {
  const ri = rivalIndex(def.id), hk = hashKey(region, body), r = config.rivals;
  const price = Math.round(bodyById(body).basePrice * def.price * (1 + (hash01(seed, 8, ri, hk, n) * 2 - 1) * r.priceNoise));
  const sport = Math.round(Math.min(1, Math.max(0, bodySport(body) + def.sport + (hash01(seed, 9, ri, hk, n) * 2 - 1) * r.sportNoise)) * 1000) / 1000;
  return { n, start, cycle, base, name: NAMES.rivalCars[def.id]?.[body] ?? def.name, price, sport, pt: rivalPt(seed, def, ri, region, body, n, month) };
}
/** 이미 있던 칸 값(base)으로 첫 모델을 만든다. 출시 달은 month 이전으로 흩어 둔다(모든 경쟁 차가 한꺼번에 낡지 않게) */
export function firstRivalModel(seed: number, def: RivalDef, region: string, body: string, base: number, month = 0): RivalModel {
  const ri = rivalIndex(def.id), hk = hashKey(region, body), cycle = rivalCycle(seed, ri, hk, 0);
  return makeModel(seed, def, region, body, 0, month - Math.floor(hash01(seed, 2, ri, hk) * cycle), cycle, base, month);
}
/** 경쟁 차의 지금 A: 새 모델 × (1 + fresh) × (1 − decay)^수명 나이 + 히트작 가산. 주기 절반에 페이스리프트(수명 나이 40%로) */
export function rivalA(md: RivalModel, month: number): number {
  const r = config.rivals, age = month - md.start, half = md.cycle * r.faceliftAt;
  const life = age < half ? age : half * r.faceliftKeep + (age - half);
  return md.base * (1 + r.fresh) * (1 - r.decay) ** life + (md.hit !== undefined && month < md.hit ? HIT.add : 0);
}
/** 새 칸 모델의 기본 A = 그 달의 기본값 + 강약 ± 해시 흔들림 */
const freshBase = (seed: number, def: RivalDef, region: string, body: string, n: number, month: number): number =>
  rivalBase(month) + (def.strength[region]?.[body] ?? 0) + (hash01(seed, 3, rivalIndex(def.id), hashKey(region, body), n) * 2 - 1) * config.rivals.noise;

/** 경쟁사 6곳: 1970년에 있는 칸마다 첫 모델. 기본 A = 기본값 + 강약 ± 흔들림. 1970년 국내에 있던 회사(4단계까지의 3곳)의 국내 칸만 게임 난수를 쓰고(예전 순서 그대로),
 *  나머지는 해시. ID 순 */
export function initRivals(rng: Rng, seed: number): RivalState[] {
  return [...RIVALS].sort((a, b) => (a.id < b.id ? -1 : 1)).map((def) => {
    const models: Record<string, RivalModel> = {};
    for (const region of REGIONS) for (const body of Object.keys(def.strength[region] ?? {}).sort()) {
      const v = def.strength[region][body];
      if (v === null || !rivalPresent(def, region, config.time.startYear)) continue;
      const noise = region === REGION ? rng.range(-config.rivals.noise, config.rivals.noise) : (hash01(seed, 3, rivalIndex(def.id), hashKey(region, body), 0) * 2 - 1) * config.rivals.noise;
      models[cellKey(region, body)] = firstRivalModel(seed, def, region, body, rivalBase(0) + v + noise);
    }
    const st: RivalState = { id: def.id, name: def.name, cells: {}, models };
    refreshCells(st, 0);
    return st;
  });
}
/** 화면 호환용 국내 칸 A(차체별) */
function refreshCells(st: RivalState, month: number): void {
  st.cells = {};
  for (const [k, md] of Object.entries(st.models)) if (k.startsWith(`${REGION}:`)) st.cells[k.slice(REGION.length + 1)] = rivalA(md, month);
}

/** 매달(월말 정산 전): 경쟁사의 진출·철수, 주기가 끝난 칸은 새 모델(기본 A·동력·히트작을 해시로, 게임 난수 소비 없음), 대응 신차 반영, 국내 칸 값 갱신. ID·지역·차체 순.
 *  ev를 주면 히트작·대응 신차 소식을 낸다 */
export function updateRivals(s: CarState, month: number, ev: GameEvent[] = []): void {
  const y = yearOfMonth(month), seed = s.seed;
  for (const st of s.rivals) {
    const def = RIVALS.find((x) => x.id === st.id);
    if (!def) continue;
    for (const region of REGIONS) for (const body of Object.keys(def.strength[region] ?? {}).sort()) {
      const key = cellKey(region, body), md = st.models[key];
      if (def.strength[region][body] === null || !rivalPresent(def, region, y)) { if (md) delete st.models[key]; continue; }
      if (!md) { const n = 0; st.models[key] = makeModel(seed, def, region, body, n, month, rivalCycle(seed, rivalIndex(def.id), hashKey(region, body), n), freshBase(seed, def, region, body, n, month), month); continue; } // 진출: 새 모델
      if (month - md.start < md.cycle) continue;
      const n = md.n + 1, response = s.market?.response[key] === st.id;
      const nm = makeModel(seed, def, region, body, n, month, rivalCycle(seed, rivalIndex(def.id), hashKey(region, body), n), freshBase(seed, def, region, body, n, month) + (response ? config.rivals.responseAdd : 0), month);
      if (response) {
        nm.response = true; delete s.market.response[key]; s.market.dominance[key] = 0;
        responseNews(s, ev, st.name, nm.name, region, body);
      }
      if (hash01(seed, 4, rivalIndex(def.id), hashKey(region, body), n) < config.rivals.hitChance) {
        nm.hit = month + HIT.months;
        if (s.market) { s.market.hits.push({ rival: st.id, cell: key, month, name: nm.name }); if (s.market.hits.length > 20) s.market.hits.splice(0, s.market.hits.length - 20); }
        if (s.events) announceRivalHit(s, ev, st.name, nm.name, region, body);
      }
      st.models[key] = nm;
    }
    refreshCells(st, month);
  }
}
const regionNameOf = (r: string) => MARKET[r]?.name ?? r;
function responseNews(s: CarState, ev: GameEvent[], rival: string, model: string, region: string, body: string): void {
  const text = `[대응 신차] ${rival}${josa(rival, '이/가')} ${regionNameOf(region)} ${bodyById(body).name} 시장을 되찾으려고 대응 신차 「${model}」${josa(model, '을/를')} 내놓았습니다.`;
  s.events.news.push({ week: s.week, text, category: 'other' });
  if (s.events.news.length > config.events.newsMax) s.events.news.splice(0, s.events.news.length - config.events.newsMax);
  ev.push({ kind: 'news', text, category: 'other' });
}
