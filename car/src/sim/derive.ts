// 1.3.0 파생 모델(왜건·쿠페·고성능판·전기차판): 판매 중인 세대를 바탕으로 짧고 싸게 개발하는 별도 차종.
// 자기 고객층·가격·판매 집계를 갖고, 바탕 차종과 계보(Nameplate.baseOf)로 이어지며 생산 라인을 함께 쓴다. 종류별 수치는 data/variants.json
import { config } from '../config';
import { VARIANTS, bodyById, powertrainById } from '../data';
import { costMultOf } from './company';
import { unlockedIds } from './research';
import { currentEdition } from './market';
import { EV } from './ev';
import { josa } from './josa';
import { STATS, type CarState, type Generation, type Nameplate, type ProjectSpec, type Stats, type VariantDef, type Battery } from './types';

export const variantById = (id?: string): VariantDef | undefined => (id ? VARIANTS.find((v) => v.id === id) : undefined);
/** 파생 모델의 능력치 배수(바꾼 값을 돌려준다). variant가 없으면 그대로 */
export function variantStats(st: Stats, variant?: string): Stats { const v = variantById(variant); if (v) for (const k of STATS) st[k] *= v.mult[k]; return st; }
/** 세대의 원가 배수 = 회사 원가 배수(공장·연구·사건·배터리 공장) × 파생 모델 원가 배수 × (1 − 직원 성과 원가 인하) */
export const genCostMult = (s: CarState, g: Pick<Generation, 'powertrain' | 'variant' | 'costCut'>): number => costMultOf(s, g.powertrain) * (variantById(g.variant)?.cost ?? 1) * (1 - (g.costCut ?? 0));
/** 생산 라인 묶음: 파생 차종은 바탕 차종의 라인을 함께 쓴다 */
export const lineRoot = (n: Nameplate): number => n.baseOf ?? n.id;
export const nameplateOfGen = (s: CarState, genId: number | null): Nameplate | undefined => s.nameplates.find((n) => n.generations.some((g) => g.id === genId));
/** 파생 개발의 주간 비용 = 바탕 세대 개발비 × devShare ÷ (설계 주 + 최소 시험 주). 시험을 더 하면 그만큼 더 든다 */
export const derivativeWeekCost = (baseDevCost: number, v: VariantDef): number => (baseDevCost * v.devShare) / (v.designWeeks + config.dev.minTestWeeks);

export interface DerivativePlan { base: Generation; baseNp: Nameplate; v: VariantDef; into: Nameplate | null; spec: ProjectSpec; cost: number; weeks: number }
/** 파생 개발 계획(검증 포함, 문제가 있으면 이유 문자열). 같은 종류의 파생 차종이 이미 있으면 그 다음 세대(into)가 된다.
 *  차체·동력 등급·장비는 바탕 세대의 지금 판 그대로, 동력은 종류가 정하면 그것(전기차판), 고객층은 직접 고르거나 이전 파생 세대·종류 기본값 */
export function derivativePlan(s: CarState, generationId: number, variant: string, o: { name?: string; segment?: string; battery?: Battery } = {}): DerivativePlan | string {
  const v = variantById(variant);
  if (!v) return '없는 파생 모델 종류입니다.';
  const baseNp = nameplateOfGen(s, generationId), base = baseNp?.generations.find((g) => g.id === generationId);
  if (!baseNp || !base) return '없는 세대입니다.';
  if (baseNp.baseOf !== undefined) return '파생 모델을 바탕으로 다시 파생 모델을 만들 수는 없습니다.';
  if (base.status !== 'onSale') return '판매 중인 세대만 바탕으로 쓸 수 있습니다.';
  const bn = bodyById(base.body).name, pt = v.powertrain ?? base.powertrain, ptn = powertrainById(pt).name;
  if (!v.bodies.includes(base.body)) return `${bn}${josa(bn, '으로/로')}는 ${v.name}${josa(v.name, '을/를')} 만들 수 없습니다.`;
  if (v.powertrain && base.powertrain === v.powertrain) return `이미 ${ptn} 차입니다.`;
  if (!unlockedIds(s, 'powertrain').has(pt)) return `${v.name}에는 ${ptn} 동력 연구가 필요합니다.`;
  const into = s.nameplates.find((n) => n.baseOf === baseNp.id && n.variant === v.id) ?? null, prevD = into?.generations.at(-1);
  if (prevD?.fromGen === base.id) return `「${into!.name}」${josa(into!.name, '은/는')} 이미 이 세대를 바탕으로 나왔습니다.`;
  if (s.projects.some((p) => p.kind === 'derivative' && p.variant === v.id && nameplateOfGen(s, p.targetId)?.id === baseNp.id)) return `이 차종의 ${v.name}${josa(v.name, '을/를')} 이미 개발하고 있습니다.`;
  const ed = currentEdition(base), battery = pt === EV ? o.battery ?? (prevD ? currentEdition(prevD).battery : undefined) ?? ed.battery : undefined;
  const spec: ProjectSpec = {
    name: o.name?.trim() || into?.name || `${baseNp.name} ${v.suffix}`, body: base.body, segment: o.segment ?? prevD?.segment ?? v.segment ?? base.segment, powertrain: pt, tier: ed.tier,
    options: [...ed.options], ...(ed.equip ? { equip: { ...ed.equip } } : {}), ...(battery ? { battery } : {}),
    direction: base.plan ? { ...base.plan.direction } : { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: v.designWeeks,
  };
  return { base, baseNp, v, into, spec, cost: base.devCost * v.devShare, weeks: v.designWeeks + config.dev.minTestWeeks };
}

/** 화면용: 이 세대로 만들 수 있는 파생 모델 4종(가능 여부·이유, 기본 이름, 고객층, 예상 비용(설계 + 최소 시험), 주 수, 이어 갈 파생 차종 ID) */
export function derivativeOptions(s: CarState, generationId: number) {
  return VARIANTS.map((v) => {
    const p = derivativePlan(s, generationId, v.id), ok = typeof p !== 'string';
    return { id: v.id, name: v.name, suffix: v.suffix, info: v.info, ok, reason: ok ? null : p, defaultName: ok ? p.spec.name : '', segment: ok ? p.spec.segment : v.segment ?? null,
      cost: ok ? p.cost : 0, weeks: v.designWeeks + config.dev.minTestWeeks, into: ok ? p.into?.id ?? null : null, powertrain: v.powertrain ?? null };
  });
}
/** 화면용: 차종의 파생 차종 목록(바탕이면 파생들, 파생이면 바탕) */
export function derivativesOf(s: CarState, nameplateId: number): { base: Nameplate | null; derivatives: Nameplate[] } {
  const n = s.nameplates.find((x) => x.id === nameplateId);
  if (!n) return { base: null, derivatives: [] };
  const rootId = lineRoot(n);
  return { base: s.nameplates.find((x) => x.id === rootId) ?? null, derivatives: s.nameplates.filter((x) => x.baseOf === rootId).sort((a, b) => a.id - b.id) };
}
