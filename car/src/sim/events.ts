// 시대 사건(설계서 11장). 고정 사건은 시드와 날짜만으로 계산한다(상태 없음): 시작 달 = 자료 연·월 ± 1년(시드 해시).
// 무작위 사건은 해마다 시드 해시로 횟수·달을 정하고, 뜬 사건과 기간 효과·뉴스만 상태(events)에 둔다. 게임 난수는 쓰지 않는다.
import { config } from '../config';
import { ERA_EVENTS, MARKET, RANDOM_EVENTS, optionById, powertrainById, bodyById, segmentById } from '../data';
import { grades } from './cars';
import { josa } from './josa';
import { hash01 } from './rng';
import { monthOf, monthLabel, yearOf, yearOfMonth } from './time';
import { STATS, type CarState, type EraEffect, type EraEventDef, type EventMod, type GameEvent, type Generation, type NewsCategory, type ProjectKind, type Stat, type Stats } from './types';

const E = config.events, MPY = config.time.monthsPerYear;
export const REGION = 'domestic';

/** 고정 사건 i의 시작 달(월 번호): 자료 연도 ± shiftYears(시드로 확정), 자료의 달 */
export function eraStart(seed: number, i: number): number {
  const d = ERA_EVENTS[i], shift = Math.floor(hash01(seed, 41, i) * (2 * E.shiftYears + 1)) - E.shiftYears;
  return (d.year + shift - config.time.startYear) * MPY + (d.month - 1);
}
export interface EraSpan { def: EraEventDef; index: number; start: number; end: number | null } // end: 끝나는 달(이 달부터 효과 없음), null = 영구
export const eraTimeline = (seed: number): EraSpan[] =>
  ERA_EVENTS.map((def, index) => { const start = eraStart(seed, index); return { def, index, start, end: def.months === null ? null : start + def.months }; });
const activeAt = (sp: EraSpan, m: number) => m >= sp.start && (sp.end === null || m < sp.end);

/** 한 달의 고정 사건 효과 합(배수는 곱, 유행 가산은 합) */
export interface EraNow {
  statW: Partial<Record<Stat, number>>; body: Record<string, number>; pt: Record<string, number>; seg: Record<string, number>;
  market: Record<string, number>; trendAdd: Record<string, number>; loan: number; production: number;
}
export function eraNow(seed: number, m: number): EraNow {
  const n: EraNow = { statW: {}, body: {}, pt: {}, seg: {}, market: {}, trendAdd: {}, loan: 1, production: 1 };
  const mul = (o: Record<string, number>, k: string, v: number) => { o[k] = (o[k] ?? 1) * v; };
  for (const sp of eraTimeline(seed)) {
    if (!activeAt(sp, m)) continue;
    for (const e of sp.def.effects) switch (e.type) {
      case 'statWeight': n.statW[e.stat] = (n.statW[e.stat] ?? 1) * e.mult; break;
      case 'bodyDemand': for (const b of e.bodies) mul(n.body, b, e.mult); break;
      case 'ptDemand': mul(n.pt, e.powertrain, e.mult); break;
      case 'segDemand': mul(n.seg, e.segment, e.mult); break;
      case 'marketSize': mul(n.market, e.region, e.mult); break;
      case 'trend': n.trendAdd[e.id] = (n.trendAdd[e.id] ?? 0) + e.add + (e.perYear ?? 0) * Math.floor((m - sp.start) / MPY); break;
      case 'loanRate': n.loan *= e.mult; break;
      case 'production': n.production *= e.mult; break;
      default: break; // regulation·charging·exportEase는 따로 본다
    }
  }
  return n;
}
/** 지역 시장 규모 배수(그 지역 + 'all') */
export const marketMult = (n: EraNow, region = REGION): number => (n.market[region] ?? 1) * (n.market.all ?? 1);

/** 고객층 가중치에 사건 배수를 곱하고 합 1로 다시 맞춘다 */
export function eraWeights(w: Stats, n: EraNow): Stats {
  if (!Object.keys(n.statW).length) return w;
  const x = { ...w };
  for (const k of STATS) x[k] *= n.statW[k] ?? 1;
  const sum = STATS.reduce((a, k) => a + x[k], 0);
  for (const k of STATS) x[k] /= sum;
  return x;
}

/** 유행 계수(7.3): market.json의 연대별 값(직선 보간) × (1 + 사건 가산), 하한 trendMin. id: 차체 또는 동력 */
export function trendOf(id: string, t: number, n: EraNow): number {
  const m = MARKET[REGION], v = m.trend?.[id];
  let base = 1;
  if (v) {
    const ys = m.years;
    if (t <= ys[0]) base = v[0]; else if (t >= ys[ys.length - 1]) base = v[v.length - 1];
    else for (let i = 1; i < ys.length; i++) if (t <= ys[i]) { base = v[i - 1] + ((v[i] - v[i - 1]) * (t - ys[i - 1])) / (ys[i] - ys[i - 1]); break; }
  }
  return Math.max(E.trendMin, base * (1 + (n.trendAdd[id] ?? 0)));
}

/** 충전 인프라(0~1): 전기차 등장 사건의 시작 달부터 start, 해마다 perYear씩. 그 전은 0 */
export function chargingInfra(seed: number, m: number): number {
  const sp = eraTimeline(seed).find((x) => x.def.effects.some((e) => e.type === 'charging'));
  if (!sp || m < sp.start) return 0;
  return Math.min(1, E.charging.start + (E.charging.perYear * (m - sp.start)) / MPY);
}

type Regulation = Extract<EraEffect, { type: 'regulation' }>;
/** 지금 국내에서 효력이 있는 규제(유예가 끝난 것) */
export const regulationsNow = (seed: number, m: number): { name: string; rule: Regulation }[] =>
  eraTimeline(seed).flatMap((sp) => sp.def.effects.filter((e): e is Regulation => e.type === 'regulation' && e.region === REGION && m >= sp.start + e.graceMonths).map((rule) => ({ name: sp.def.name, rule })));
const optNames = (ids: string[]) => ids.map((o) => optionById(o).name).join('·');
const PLAN_NAME: Record<ProjectKind, string> = { new: '신차', facelift: '페이스리프트', fullchange: '풀체인지' };
/** 규제 때문에 신규 출시를 못 하는 이유(없으면 null). kind가 있으면 이미 개발 중인 차(출시 화면), 없으면 기획 중인 차 */
export function regulationError(s: CarState, car: { options: string[]; powertrain: string; kind?: ProjectKind }): string | null {
  for (const { name, rule } of regulationsNow(s.seed, monthOf(s.week))) {
    const missing = (rule.options ?? []).filter((o) => !car.options.includes(o)), list = optNames(missing);
    if (missing.length) return `${name}: 이제 ${list}${josa(list, '이/가')} 없는 차는 출시할 수 없습니다. ${car.kind
      ? `이 차는 그대로 낼 수 없으니 개발을 취소하고 ${PLAN_NAME[car.kind]} 기획을 다시 하면서 옵션에 ${list}${josa(list, '을/를')} 넣으세요.`
      : `옵션 단계에서 ${list}${josa(list, '을/를')} 넣으세요.`}`;
    if (rule.powertrains?.includes(car.powertrain)) { const pt = powertrainById(car.powertrain).name; return `${name}: 이제 ${pt}차는 출시할 수 없습니다.`; }
  }
  return null;
}

// ---------- 무작위 사건 기간 효과 ----------
const modsNow = (s: CarState, kind: EventMod['kind'], m = monthOf(s.week)) => s.events.mods.filter((x) => x.kind === kind && m < x.untilMonth);
/** 생산 배수: 고정 사건 × 파업 등 */
export const productionMult = (s: CarState): number => eraNow(s.seed, monthOf(s.week)).production * modsNow(s, 'production').reduce((a, x) => a * x.value, 1);
/** 원가 배수(원자재·환율) */
export const eventCostMult = (s: CarState): number => modsNow(s, 'cost').reduce((a, x) => a * x.value, 1);
/** 대출 이율 배수 */
export const loanRateMult = (s: CarState): number => eraNow(s.seed, monthOf(s.week)).loan;
/** 경쟁 차 히트작 가산(경쟁사·차체 칸) */
export const rivalHitAdd = (s: CarState, rivalId: string, body: string, m: number): number =>
  modsNow(s, 'rivalHit', m).filter((x) => x.rivalId === rivalId && x.body === body).reduce((a, x) => a + x.value, 0);

function addNews(s: CarState, ev: GameEvent[], text: string, category: NewsCategory, kind: 'news' | 'choice' = 'news', id?: number): void {
  s.events.news.push({ week: s.week, text, category });
  if (s.events.news.length > E.newsMax) s.events.news.splice(0, s.events.news.length - E.newsMax);
  ev.push(id === undefined ? { kind, text, category } : { kind, text, id, category });
}
export { addNews };

/** 달 첫 주: 고정 사건의 예고(6개월 전)·시작·규제 발효·끝 뉴스, 그리고 무작위 사건 */
export function monthStart(s: CarState, ev: GameEvent[]): void {
  const m = monthOf(s.week);
  s.events.mods = s.events.mods.filter((x) => m < x.untilMonth);
  for (const sp of eraTimeline(s.seed)) {
    if (m === sp.start - E.warnMonths) addNews(s, ev, `[예고] ${sp.def.warn}`, 'preview');
    if (m === sp.start) addNews(s, ev, `[${sp.def.name}] ${sp.def.start}`, 'start');
    for (const e of sp.def.effects) if (e.type === 'regulation' && e.region === REGION && e.graceMonths > 0 && m === sp.start + e.graceMonths) {
      const list = optNames(e.options ?? []);
      addNews(s, ev, `[${sp.def.name}] 오늘부터 ${list}${josa(list, '이/가')} 없는 신차는 출시할 수 없습니다.`, 'regulation');
    }
    if (sp.end !== null && m === sp.end && sp.def.end) addNews(s, ev, `[${sp.def.name}] ${sp.def.end}`, 'end');
  }
  rollRandom(s, m, ev);
}

/** 그해 무작위 사건 횟수(0~2)와 달 */
export function randomMonths(seed: number, year: number): number[] {
  if (year < E.randomFrom) return [];
  const r = hash01(seed, 51, year);
  let n = 0, acc = 0;
  for (let i = 0; i < E.randomPerYear.length; i++) { acc += E.randomPerYear[i]; if (r < acc) { n = i; break; } n = i; }
  return Array.from({ length: n }, (_, k) => Math.floor(hash01(seed, 52, year, k) * MPY));
}
const onSaleGens = (s: CarState): Generation[] => s.nameplates.flatMap((n) => n.generations).filter((g) => g.status === 'onSale').sort((a, b) => a.id - b.id);
const genName = (s: CarState, g: Generation) => s.nameplates.find((n) => n.generations.includes(g))?.name ?? '';

function rollRandom(s: CarState, m: number, ev: GameEvent[]): void {
  const year = yearOfMonth(m);
  randomMonths(s.seed, year).forEach((mon, k) => {
    if (mon !== m % MPY) return;
    const gens = onSaleGens(s), defect = gens.filter((g) => g.editions[g.editions.length - 1].defects > 0);
    const room = s.staff.length < config.hq.levels[s.hqLevel - 1].staff;
    const ok = RANDOM_EVENTS.filter((d) => d.needs === 'none' || (d.needs === 'defectCar' ? defect.length > 0 : d.needs === 'staffRoom' ? room : gens.length > 0));
    if (!ok.length) return;
    const def = ok[Math.floor(hash01(s.seed, 53, year, k) * ok.length)];
    const pool = def.needs === 'defectCar' ? defect : gens, g = def.needs === 'none' || def.needs === 'staffRoom' ? undefined : pool[Math.floor(hash01(s.seed, 54, year, k) * pool.length)];
    let fx: number | null = null;
    if (def.onFire?.type === 'rivalHit' && g && s.rivals.length) {
      const r = s.rivals[Math.floor(hash01(s.seed, 55, year, k) * s.rivals.length)];
      s.events.mods.push({ kind: 'rivalHit', value: def.onFire.add, untilMonth: m + def.onFire.months, body: g.body, rivalId: r.id, label: `${r.name} ${bodyById(g.body).name} 히트작` });
    }
    if (def.onFire?.type === 'fxRoll') fx = hash01(s.seed, 56, year, k) < def.onFire.goodShare ? def.onFire.good : def.onFire.bad;
    const car = g ? genName(s, g) : '', id = s.nextId++;
    const text = def.text.replace('{car}', car).replace(/\{(을\/를|이\/가|은\/는|과\/와|으로\/로)\}/g, (_, p) => josa(car, p)); // 「{car}」{을/를}: 차 이름에 맞는 조사
    s.events.pending.push({ id, eventId: def.id, text, week: s.week, deadline: s.week + E.choiceWeeks, genId: g?.id ?? null, fx });
    addNews(s, ev, `[${def.name}] ${text}`, 'choice', 'choice', id);
  });
}

// ---------- 조회 ----------
const STAT_WORD: Record<Stat, string> = { P: '성능', E: '연비', U: '실용성', D: '디자인', Q: '품질' };
const pct = (x: number) => Math.round(Math.abs(x - 1) * 100);
const sells = (x: number) => `${pct(x)}% ${x < 1 ? '덜' : '더'} 팔립니다`;
const ptCar = (id: string) => `${powertrainById(id).name}차`;
const trendName = (id: string) => (MARKET[REGION].bodyShare[id] ? bodyById(id).name : ptCar(id));
/** 유행 효과의 서술부(주어 뒤): "유행해 인기가 20% 오릅니다." / "인기가 해마다 3%씩 줄어듭니다." */
const trendText = (e: Extract<EraEffect, { type: 'trend' }>) => [
  e.add ? `${e.add > 0 ? '유행해 인기가' : '인기가'} ${Math.round(Math.abs(e.add) * 100)}% ${e.add > 0 ? '오릅니다' : '떨어집니다'}.` : '',
  e.perYear ? `인기가 해마다 ${Math.round(Math.abs(e.perYear) * 100)}%씩 ${e.perYear < 0 ? '줄어듭니다' : '늘어납니다'}.` : '',
].filter(Boolean).join(' ');
/** 고정 사건 효과 한 문장(쉬운 말). since: 사건이 시작한 뒤 지난 달 수(규제의 봐주는 기간 계산) */
function eraEffectText(e: EraEffect, since: number): string {
  switch (e.type) {
    case 'statWeight': { const n = STAT_WORD[e.stat]; return `고객이 차를 고를 때 ${n}${josa(n, '을/를')} ${e.mult >= 1.5 ? '훨씬 더' : e.mult > 1 ? '더' : '덜'} 따집니다.`; }
    case 'bodyDemand': { const n = e.bodies.map((b) => bodyById(b).name).join('·'); return `${n}${josa(n, '이/가')} ${sells(e.mult)}.`; }
    case 'ptDemand': { const n = ptCar(e.powertrain); return `${n}${josa(n, '이/가')} ${sells(e.mult)}.`; }
    case 'segDemand': { const n = segmentById(e.segment).name; return `${n}${josa(n, '이/가')} 차를 ${pct(e.mult)}% ${e.mult < 1 ? '덜' : '더'} 삽니다.`; }
    case 'marketSize': return `${e.region === 'all' ? '모든 지역의' : MARKET[e.region]?.name ?? e.region} 자동차 시장이 ${pct(e.mult)}% ${e.mult < 1 ? '줄어듭니다' : '커집니다'}.`;
    case 'trend': { const n = trendName(e.id); return `${n}${josa(n, '이/가')} ${trendText(e)}`; }
    case 'loanRate': return `대출 이자가 ${e.mult === 2 ? '두 배' : `${e.mult}배`}${e.mult > 1 ? '로 오릅니다' : '로 내립니다'}.`;
    case 'production': return `모든 공장의 생산이 ${e.mult === 0.5 ? '절반으로' : `${pct(e.mult)}%`} 줄어듭니다.`;
    case 'regulation': {
      if (e.region !== REGION) return '외국에만 해당하는 규제라, 국내에서 차를 파는 우리 회사에는 영향이 없습니다.';
      const n = optNames(e.options ?? []), left = e.graceMonths - since;
      return left > 0 ? `${left}개월 뒤부터 ${n}${josa(n, '이/가')} 없는 신차는 출시할 수 없습니다(그때까지는 봐주는 기간입니다).` : `${n}${josa(n, '이/가')} 없는 신차는 출시할 수 없습니다.`;
    }
    case 'charging': return '충전소가 해마다 늘어 전기차가 점점 더 잘 팔립니다.';
    case 'exportEase': return '외국 시장 이야기라, 국내에서 차를 파는 우리 회사에는 영향이 없습니다.';
  }
}
/** 무작위 사건이 남긴 기간 효과 한 문장 */
const modText = (x: EventMod): string =>
  x.kind === 'production' ? `공장 생산이 ${x.value === 0.5 ? '절반으로' : `${pct(x.value)}%`} 줄어듭니다.`
  : x.kind === 'cost' ? `차 한 대 원가가 ${pct(x.value)}% ${x.value < 1 ? '내립니다' : '오릅니다'}.`
  : `경쟁 차가 크게 히트해 ${x.body ? bodyById(x.body).name : '그 차급'} 손님을 한동안 많이 빼앗아 갑니다.`;
export interface ActiveEvent { id: string; name: string; text: string; effects: string[]; startMonth: number; monthsLeft: number | null; kind: 'era' | 'random' }
/** 진행 중인 사건 효과와 남은 기간(쉬운 설명): 고정 사건 + 무작위 사건의 기간 효과 */
export function activeEvents(s: CarState): { events: ActiveEvent[]; chargingInfra: number; requiredOptions: string[] } {
  const m = monthOf(s.week);
  const era = eraTimeline(s.seed).filter((sp) => activeAt(sp, m)).map((sp): ActiveEvent => ({
    id: sp.def.id, name: sp.def.name, text: sp.def.start, effects: sp.def.effects.map((e) => eraEffectText(e, m - sp.start)), startMonth: sp.start, monthsLeft: sp.end === null ? null : sp.end - m, kind: 'era',
  }));
  const mods = s.events.mods.filter((x) => m < x.untilMonth).map((x, i): ActiveEvent => ({
    id: `mod${i}`, name: x.label, text: x.label, kind: 'random', startMonth: m, monthsLeft: x.untilMonth - m, effects: [modText(x)],
  }));
  return { events: [...era, ...mods], chargingInfra: chargingInfra(s.seed, m), requiredOptions: regulationsNow(s.seed, m).flatMap((r) => r.rule.options ?? []) };
}
/** 판매 중인 차 한 대에 지금 걸린 사건 효과(쉬운 문장, "사건 이름: 내용"): 그 차의 차체·동력·고객층에 걸린 것과,
 *  모든 차에 걸리지만 이 차에 특히 유리·불리한 것(고객이 더 따지는 능력치가 이 차에서 높거나 낮을 때) */
export function eventImpactOn(s: CarState, generationId: number): string[] {
  const g = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === generationId);
  if (!g) return [];
  const m = monthOf(s.week), body = bodyById(g.body).name, pt = ptCar(g.powertrain), seg = segmentById(g.segment).name;
  const gr = grades(g.editions[g.editions.length - 1].stats, yearOf(s.week));
  const one = (e: EraEffect): string | null => {
    switch (e.type) {
      case 'bodyDemand': return e.bodies.includes(g.body) ? `이 차는 ${body}${josa(body, '이라/라')} ${sells(e.mult)}.` : null;
      case 'ptDemand': return e.powertrain === g.powertrain ? `이 차는 ${pt}${josa(pt, '이라/라')} ${sells(e.mult)}.` : null;
      case 'segDemand': return e.segment === g.segment ? `이 차를 사는 ${seg}${josa(seg, '이/가')} 차를 ${pct(e.mult)}% ${e.mult < 1 ? '덜' : '더'} 삽니다.` : null;
      case 'trend': { const n = e.id === g.body ? body : e.id === g.powertrain ? pt : null; return n && trendText(e) ? `이 차는 ${n}${josa(n, '이라/라')} ${trendText(e)}` : null; }
      case 'charging': return g.powertrain === E.charging.powertrain ? `충전소가 늘수록 이 차가 잘 팔립니다(지금 충전소 보급 ${Math.round(chargingInfra(s.seed, m) * 100)}%).` : null;
      case 'statWeight': {
        const n = STAT_WORD[e.stat], v = gr[e.stat];
        if (e.mult <= 1 || (v > 4 && v < 6)) return null;
        return `고객이 ${n}${josa(n, '을/를')} 더 따지는데, 이 차는 ${n}${josa(n, '이/가')} ${v >= 6 ? '좋아 유리합니다' : '약해 불리합니다'}.`;
      }
      default: return null; // 시장 규모·대출·생산·규제는 모든 차에 똑같이 걸린다
    }
  };
  const out = eraTimeline(s.seed).filter((sp) => activeAt(sp, m)).flatMap((sp) => sp.def.effects.map(one).filter((t): t is string => !!t).map((t) => `${sp.def.name}: ${t}`));
  for (const x of s.events.mods) if (x.kind === 'rivalHit' && x.body === g.body && m < x.untilMonth) out.push(`${x.label}: 경쟁 차가 크게 히트해 이 차의 손님을 빼앗아 갑니다.`);
  return out;
}
/** 답을 기다리는 무작위 사건: 선택지·기본 선택·남은 주 */
export function pendingChoices(s: CarState) {
  return s.events.pending.map((p) => {
    const def = RANDOM_EVENTS.find((d) => d.id === p.eventId)!;
    return { id: p.id, eventId: p.eventId, name: def.name, text: p.text, choices: def.choices.map((c) => ({ label: c.label, result: c.result })), defaultChoice: def.defaultChoice, weeksLeft: p.deadline - s.week };
  });
}
/** 뉴스 기록(최신이 앞). category가 없는 예전 항목은 'other' */
export const newsLog = (s: CarState): { week: number; text: string; date: string; category: NewsCategory }[] =>
  [...s.events.news].reverse().map((x) => ({ week: x.week, text: x.text, category: x.category ?? 'other', date: monthLabel(monthOf(x.week)) }));
/** 다가오는 고정 사건(예고가 나온 것만, 시작 전) */
export const upcomingEvents = (s: CarState) => {
  const m = monthOf(s.week);
  return eraTimeline(s.seed).filter((sp) => m >= sp.start - E.warnMonths && m < sp.start).map((sp) => ({ id: sp.def.id, warn: sp.def.warn, monthsLeft: sp.start - m }));
};
