// 시대 사건(설계서 11장). 고정 사건은 시드와 날짜만으로 계산한다(상태 없음): 시작 달 = 자료 연·월 ± 1년(시드 해시).
// 무작위 사건은 해마다 시드 해시로 횟수·달을 정하고, 뜬 사건과 기간 효과·뉴스만 상태(events)에 둔다. 게임 난수는 쓰지 않는다.
import { config } from '../config';
import { ERA_EVENTS, MARKET, RANDOM_EVENTS, optionById, powertrainById, bodyById } from '../data';
import { hash01 } from './rng';
import { monthOf, monthLabel, yearOfMonth } from './time';
import { STATS, type CarState, type EraEffect, type EraEventDef, type EventMod, type GameEvent, type Generation, type Stat, type Stats } from './types';

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
/** 규제 때문에 신규 출시를 못 하는 이유(없으면 null) */
export function regulationError(s: CarState, car: { options: string[]; powertrain: string }): string | null {
  for (const { name, rule } of regulationsNow(s.seed, monthOf(s.week))) {
    const missing = (rule.options ?? []).filter((o) => !car.options.includes(o));
    if (missing.length) return `${name}: ${missing.map((o) => optionById(o).name).join('·')} 옵션이 없는 신차는 출시할 수 없습니다. 페이스리프트나 다음 세대에서 옵션을 넣으세요.`;
    if (rule.powertrains?.includes(car.powertrain)) return `${name}: ${powertrainById(car.powertrain).name} 신차는 출시할 수 없습니다.`;
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

function addNews(s: CarState, ev: GameEvent[], text: string, kind: 'news' | 'choice' = 'news', id?: number): void {
  s.events.news.push({ week: s.week, text });
  if (s.events.news.length > E.newsMax) s.events.news.splice(0, s.events.news.length - E.newsMax);
  ev.push(id === undefined ? { kind, text } : { kind, text, id });
}
export { addNews };

/** 달 첫 주: 고정 사건의 예고(6개월 전)·시작·규제 발효·끝 뉴스, 그리고 무작위 사건 */
export function monthStart(s: CarState, ev: GameEvent[]): void {
  const m = monthOf(s.week);
  s.events.mods = s.events.mods.filter((x) => m < x.untilMonth);
  for (const sp of eraTimeline(s.seed)) {
    if (m === sp.start - E.warnMonths) addNews(s, ev, `[예고] ${sp.def.warn}`);
    if (m === sp.start) addNews(s, ev, `[${sp.def.name}] ${sp.def.start}`);
    for (const e of sp.def.effects) if (e.type === 'regulation' && e.region === REGION && e.graceMonths > 0 && m === sp.start + e.graceMonths)
      addNews(s, ev, `[${sp.def.name}] 오늘부터 ${(e.options ?? []).map((o) => optionById(o).name).join('·')} 없는 신차는 출시할 수 없습니다.`);
    if (sp.end !== null && m === sp.end && sp.def.end) addNews(s, ev, `[${sp.def.name}] ${sp.def.end}`);
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
    const id = s.nextId++, text = def.text.replace('{car}', g ? genName(s, g) : '');
    s.events.pending.push({ id, eventId: def.id, text, week: s.week, deadline: s.week + E.choiceWeeks, genId: g?.id ?? null, fx });
    addNews(s, ev, `[${def.name}] ${text}`, 'choice', id);
  });
}

// ---------- 조회 ----------
/** 고정 사건 효과 한 줄 */
function eraEffectText(e: EraEffect): string {
  const pct = (x: number) => `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;
  const STAT: Record<Stat, string> = { P: '성능', E: '연비', U: '실용', D: '디자인', Q: '품질' };
  switch (e.type) {
    case 'statWeight': return `고객이 ${STAT[e.stat]}을(를) 더 중시(가중치 ×${e.mult})`;
    case 'bodyDemand': return `${e.bodies.map((b) => bodyById(b).name).join('·')} 수요 ${pct(e.mult)}`;
    case 'ptDemand': return `${powertrainById(e.powertrain).name} 수요 ${pct(e.mult)}`;
    case 'segDemand': return `${e.segment === 'rich' ? '부유층' : e.segment} 구매 ${pct(e.mult)}`;
    case 'marketSize': return `${e.region === 'all' ? '전 지역' : MARKET[e.region]?.name ?? e.region} 시장 ${pct(e.mult)}`;
    case 'trend': {
      const name = MARKET[REGION].bodyShare[e.id] ? bodyById(e.id).name : powertrainById(e.id).name;
      return e.perYear ? `${name} 인기 해마다 ${Math.round(e.perYear * 100)}%` : `${name} 유행 +${Math.round(e.add * 100)}%`;
    }
    case 'loanRate': return `대출 이율 ×${e.mult}`;
    case 'production': return `전 공장 생산 ${pct(e.mult)}`;
    case 'regulation': return e.region === REGION ? `${(e.options ?? []).map((o) => optionById(o).name).join('·')} 없는 신차 출시 불가${e.graceMonths ? `(${e.graceMonths}개월 유예)` : ''}` : '해외 규제(수출 전에는 영향 없음)';
    case 'charging': return '충전 인프라가 해마다 늘어남(전기차 수요에 곱해짐)';
    case 'exportEase': return '수출 지역 해금 조건 완화(수출 전에는 영향 없음)';
  }
}
export interface ActiveEvent { id: string; name: string; text: string; effects: string[]; startMonth: number; monthsLeft: number | null; kind: 'era' | 'random' }
/** 진행 중인 사건 효과와 남은 기간(쉬운 설명): 고정 사건 + 무작위 사건의 기간 효과 */
export function activeEvents(s: CarState): { events: ActiveEvent[]; chargingInfra: number; requiredOptions: string[] } {
  const m = monthOf(s.week);
  const era = eraTimeline(s.seed).filter((sp) => activeAt(sp, m)).map((sp): ActiveEvent => ({
    id: sp.def.id, name: sp.def.name, text: sp.def.start, effects: sp.def.effects.map(eraEffectText), startMonth: sp.start, monthsLeft: sp.end === null ? null : sp.end - m, kind: 'era',
  }));
  const mods = s.events.mods.filter((x) => m < x.untilMonth).map((x, i): ActiveEvent => ({
    id: `mod${i}`, name: x.label, text: x.label, kind: 'random', startMonth: m, monthsLeft: x.untilMonth - m,
    effects: [x.kind === 'production' ? `생산 ×${x.value}` : x.kind === 'cost' ? `원가 ×${x.value}` : `경쟁 차 매력 +${x.value}`],
  }));
  return { events: [...era, ...mods], chargingInfra: chargingInfra(s.seed, m), requiredOptions: regulationsNow(s.seed, m).flatMap((r) => r.rule.options ?? []) };
}
/** 답을 기다리는 무작위 사건: 선택지·기본 선택·남은 주 */
export function pendingChoices(s: CarState) {
  return s.events.pending.map((p) => {
    const def = RANDOM_EVENTS.find((d) => d.id === p.eventId)!;
    return { id: p.id, eventId: p.eventId, name: def.name, text: p.text, choices: def.choices.map((c) => ({ label: c.label, result: c.result })), defaultChoice: def.defaultChoice, weeksLeft: p.deadline - s.week };
  });
}
/** 뉴스 기록(최신이 앞) */
export const newsLog = (s: CarState): { week: number; text: string; date: string }[] =>
  [...s.events.news].reverse().map((x) => ({ ...x, date: monthLabel(monthOf(x.week)) }));
/** 다가오는 고정 사건(예고가 나온 것만, 시작 전) */
export const upcomingEvents = (s: CarState) => {
  const m = monthOf(s.week);
  return eraTimeline(s.seed).filter((sp) => m >= sp.start - E.warnMonths && m < sp.start).map((sp) => ({ id: sp.def.id, warn: sp.def.warn, monthsLeft: sp.start - m }));
};
