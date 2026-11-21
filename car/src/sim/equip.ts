// 1.1.0 장비 구성: 장비마다 안 넣음 / 선택 사양(opt) / 기본 장비(std), 시대의 기대(rare/common/expected), 추천 구성. 순수 함수
import { config } from '../config';
import { OPTIONS, bodyById, optionById } from '../data';
import { requiredOptions } from './events';
import { optionsAt } from './cars';
import { basePriceOf, optionValue } from './market';
import { yearOf } from './time';
import type { CarState, Equip, EquipLevel } from './types';

export type Expectation = 'rare' | 'common' | 'expected';
const C = () => config.equip;

/** 차급: 차체 기준가 구간(소형 / 중형 / 대형·고급) */
export const bodyClass = (body: string): 'small' | 'mid' | 'big' => { const p = bodyById(body).basePrice, T = C().classPrice; return p < T[0] ? 'small' : p < T[1] ? 'mid' : 'big'; };
/** 그 해 그 차급에서 이 장비의 기대: 흔해지는 해 전 rare, 기대되는 해 전 common, 그 뒤 expected(자료 없으면 늘 rare) */
export function expectation(id: string, body: string, year: number): Expectation {
  const e = optionById(id).expect?.[bodyClass(body)];
  return !e || year < e[0] ? 'rare' : year < e[1] ? 'common' : 'expected';
}
/** 선택 사양 선택률(0~1): 기대 단계 기본값 × 고객층 궁합(optionValue가 원가보다 크면 fit) × 대형의 드문 장비 가산 */
export function takeRate(id: string, body: string, segment: string, year: number): number {
  const E = C(), ex = expectation(id, body, year), o = optionById(id);
  const fit = optionValue(id, segment) > o.cost;
  const r = E.take[ex] * (fit ? E.takeFit : E.takeMisfit) * (ex === 'rare' && bodyClass(body) === 'big' ? E.takeBigRare : 1);
  return Math.min(E.takeMax, Math.max(E.takeMin, r));
}
/** 선택 사양의 추가 요금 = 원가 × 마진 배수(10만원 단위) */
export const optPrice = (id: string): number => Math.round((optionById(id).cost * C().optMarkup) / 10) * 10;

/** 스펙·판의 장비 구성(equip이 없으면 options가 모두 기본 장비). 의무 장비는 늘 기본 장비 */
export function equipOf(x: { options: string[]; equip?: Equip }, s?: CarState): Equip {
  const out: Equip = { ...(x.equip ?? Object.fromEntries(x.options.map((o) => [o, 'std' as EquipLevel]))) };
  if (s) for (const o of requiredOptions(s)) out[o] = 'std';
  return out;
}
export const stdOf = (e: Equip): string[] => Object.keys(e).filter((k) => e[k] === 'std').sort();
export const optOf = (e: Equip): string[] => Object.keys(e).filter((k) => e[k] === 'opt').sort();
/** equip을 주면 options를 기본 장비 목록으로 맞춘다(명령·저장 공용) */
export function syncOptions<T extends { options: string[]; equip?: Equip }>(x: T): T { if (x.equip) x.options = stdOf(x.equip); return x; }

/** 선택 사양의 능력치 반영 비율(장비별) = partBase + partPerRate × 선택률 */
export const optWeights = (e: Equip, body: string, segment: string, year: number): Record<string, number> =>
  Object.fromEntries(optOf(e).map((id) => [id, C().partBase + C().partPerRate * takeRate(id, body, segment, year)]));
/** 선택 사양에서 대당 평균 추가 매출·원가(costMult: 원가 배수) */
export function optPerCar(e: Equip, body: string, segment: string, year: number, costMult = 1): { rev: number; cost: number } {
  let rev = 0, cost = 0;
  for (const id of optOf(e)) { const r = takeRate(id, body, segment, year); rev += r * optPrice(id); cost += r * optionById(id).cost * costMult; }
  return { rev, cost };
}
/** 시대의 기대가 매력에 주는 배수와 평론 가감: 기대되는 장비가 없으면 감점(선택 사양이면 작게), 드문 장비를 기본으로 넣으면 가점 */
export function expectEffect(e: Equip, body: string, year: number): { mult: number; review: number; missing: string[]; optOnly: string[]; fresh: string[] } {
  const E = C(), missing: string[] = [], optOnly: string[] = [], fresh: string[] = [];
  for (const o of OPTIONS) {
    if (o.year > year) continue;
    const ex = expectation(o.id, body, year), lv = e[o.id];
    if (ex === 'expected' && !lv) missing.push(o.id);
    else if (ex === 'expected' && lv === 'opt') optOnly.push(o.id);
    else if (ex === 'rare' && lv === 'std') fresh.push(o.id);
  }
  const mult = Math.max(E.multMin, 1 - E.missPen * missing.length - E.optPen * optOnly.length + E.freshBonus * Math.min(E.freshMax, fresh.length));
  const review = Math.max(-E.reviewMaxPen, -E.reviewMiss * missing.length - E.reviewOpt * optOnly.length) + Math.min(E.reviewMaxBonus, E.reviewFresh * fresh.length);
  return { mult, review, missing, optOnly, fresh };
}

/** expectEffect의 매력 배수만(판매 계산용, 같은 구성 객체·차체·해면 저장해 둔 값) */
const multCache = new WeakMap<Equip, { key: string; v: number }>();
export function expectMult(e: Equip, body: string, year: number): number {
  const key = `${body}:${year}`, c = multCache.get(e);
  if (c && c.key === key) return c.v;
  const v = expectEffect(e, body, year).mult;
  multCache.set(e, { key, v });
  return v;
}
const yearNow = (s: CarState, year?: number) => year ?? yearOf(s.week);
/** 추천 구성: 의무·기대 장비는 늘 기본 장비, 그 고객층이 중시하고(값 > 원가) 아직 기대되지 않는 것은 선택 사양, 나머지는 안 넣음.
 *  (1.1.0 배포 전: 기대 장비를 원가 상한으로 선택 사양으로 내리면 추천을 따라도 감점이 생겨 상한을 없앴다. powertrain은 화면 호환용) */
export function recommendedEquip(s: CarState, body: string, segment: string, _powertrain: string, year?: number): Equip {
  const y = yearNow(s, year), req = new Set(requiredOptions(s)), out: Equip = {};
  for (const o of optionsAt(s)) {
    const ex = expectation(o.id, body, y);
    if (req.has(o.id) || ex === 'expected') out[o.id] = 'std';
    else if (optionValue(o.id, segment) > o.cost) out[o.id] = 'opt';
  }
  return out;
}
const RANK = (l: EquipLevel | null) => (l === 'std' ? 2 : l === 'opt' ? 1 : 0);
/** 지금 구성에서 추천 구성까지 올릴 장비(추천과 같은 판단: 목표 단계 = recommendedEquip, 이미 그 단계 이상이면 변화 없음) */
export function equipChanges(s: CarState, prev: Equip, body: string, segment: string, year?: number): { id: string; name: string; from: EquipLevel | null; to: EquipLevel | null; reason: string }[] {
  const y = yearNow(s, year), req = new Set(requiredOptions(s)), rec = recommendedEquip(s, body, segment, '', y), out: { id: string; name: string; from: EquipLevel | null; to: EquipLevel | null; reason: string }[] = [];
  for (const o of optionsAt(s)) {
    const from = prev[o.id] ?? null, to = rec[o.id] ?? null;
    if (RANK(from) >= RANK(to)) continue;
    out.push({ id: o.id, name: o.name, from, to, reason: req.has(o.id) ? '규제로 의무 장비가 됐습니다.' : expectation(o.id, body, y) === 'expected' ? '이 차급에서 기대되는 장비가 됐습니다.' : '이 고객층이 중시하는 장비입니다. 선택 사양으로 넣을 만합니다.' });
  }
  return out;
}

export const LEGACY_TEXT = '이 차는 옛 구성입니다. 다음 페이스리프트부터 장비 기대가 적용됩니다.';
const EXPECT_TEXT: Record<Expectation, string> = { rare: '아직 드문 장비', common: '흔해지는 중인 장비', expected: '이 차급에서 기대되는 장비' };
const effectText = (id: string, w: number): string => { const o = optionById(id), p = (v: number) => Math.round(v * w * 10) / 10; return [o.U && `실용 +${p(o.U)}`, o.D && `디자인 +${p(o.D)}`, o.Q && `품질 +${p(o.Q)}`].filter(Boolean).join(', '); };
/** 장비 고르기 화면용: 장비마다 기대·원가·값·선택 사양 요금·선택률·효과, 합계(기본 장비 원가·값, 선택 사양 대당 이익, 차별 기준가, 빠진 기대 장비, 감점·가점) */
export function equipInfo(s: CarState, spec: { body: string; segment: string; powertrain: string; equip?: Equip; options?: string[]; equipLegacy?: boolean }, year?: number) {
  const y = yearNow(s, year), have = new Set(optionsAt(s).map((o) => o.id)), req = new Set(requiredOptions(s));
  const e = equipOf({ options: spec.options ?? [], equip: spec.equip }, s);
  const items = OPTIONS.map((o) => {
    const ex = expectation(o.id, spec.body, y), r = takeRate(o.id, spec.body, spec.segment, y);
    return {
      id: o.id, name: o.name, info: o.info, available: have.has(o.id), whyNot: have.has(o.id) ? null : o.year > y ? `${o.year}년에 등장합니다.` : '연구가 필요합니다.', required: req.has(o.id),
      expectation: ex, expectText: EXPECT_TEXT[ex], cost: o.cost, value: optionValue(o.id, spec.segment, y), optPrice: optPrice(o.id), takeRate: r, level: e[o.id] ?? null,
      effect: { std: effectText(o.id, 1), opt: effectText(o.id, C().partBase + C().partPerRate * r) },
    };
  });
  const legacy = !!spec.equipLegacy, std = stdOf(e), fx0 = expectEffect(e, spec.body, y), fx = legacy ? { ...fx0, mult: 1, missing: [] } : fx0, op = optPerCar(e, spec.body, spec.segment, y); // legacy: 옛 저장에서 올라온 출시된 판(기대 효과 없음)
  const stdValue = std.filter((id) => !req.has(id)).reduce((a, id) => a + optionValue(id, spec.segment, y), 0);
  return {
    items,
    totals: { stdCost: std.reduce((a, id) => a + optionById(id).cost, 0), stdValue, optProfitPerCar: op.rev - op.cost, basePrice: basePriceOf(s, spec.body, spec.powertrain) + stdValue,
      missingExpected: fx.missing.map((id) => optionById(id).name), penalty: 1 - Math.min(1, fx.mult), bonus: Math.max(0, fx.mult - 1),
      legacy, legacyText: legacy ? LEGACY_TEXT : null },
  };
}
