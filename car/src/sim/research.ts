// 연구(설계서 10장): 기술 해금 상태, 연구 비용(선행 할증·늦은 할인), 주간 연구 점수, 연구 화면 조회. 상태를 바꾸는 것은 researchWeek뿐
import { config } from '../config';
import { BODIES, OPTIONS, POWERTRAINS, TECHS, bodyById, optionById, powertrainById, techById } from '../data';
import { isAway } from './company';
import { yearOf } from './time';
import type { BodyDef, CarState, GameEvent, OptionDef, PowertrainDef, Staff, TechDef, TechEffect, TechField } from './types';

const R = config.research;
type UnlockType = 'body' | 'option' | 'powertrain';

/** 어떤 기술이 해금하는 항목 ID(이 목록에 없는 것은 처음부터 쓸 수 있다: 소형 세단, 가솔린) */
const lockedBy: Record<UnlockType, Set<string>> = { body: new Set(), option: new Set(), powertrain: new Set() };
for (const t of TECHS) for (const e of t.effects) if (e.type === 'body' || e.type === 'option' || e.type === 'powertrain') lockedBy[e.type].add(e.id);

const effectsOf = (s: CarState): TechEffect[] => s.research.done.flatMap((id) => techById(id).effects);
export const isDone = (s: CarState, id: string): boolean => s.research.done.includes(id);
export const doneCount = (s: CarState, id: string): number => s.research.done.filter((x) => x === id).length;

/** 해금된 항목 ID(시작부터 쓸 수 있는 것 + 연구로 연 것) */
export function unlockedIds(s: CarState, type: UnlockType): Set<string> {
  const all: { id: string }[] = type === 'body' ? BODIES : type === 'option' ? OPTIONS : POWERTRAINS;
  const set = new Set(all.filter((x) => !lockedBy[type].has(x.id)).map((x) => x.id));
  for (const e of effectsOf(s)) if (e.type === type) set.add(e.id);
  return set;
}
/** 기획 화면용: 연구로 연 차체·옵션·동력(자료 순서) */
export const unlockedBodies = (s: CarState): BodyDef[] => { const u = unlockedIds(s, 'body'); return BODIES.filter((b) => u.has(b.id)); };
export const unlockedOptions = (s: CarState): OptionDef[] => { const u = unlockedIds(s, 'option'); return OPTIONS.filter((o) => u.has(o.id)); };
export const unlockedPowertrains = (s: CarState): PowertrainDef[] => { const u = unlockedIds(s, 'powertrain'); return POWERTRAINS.filter((p) => u.has(p.id)); };

/** 동력 종류의 연구 단계(해금 안 됐으면 0) = 해금 단계 + 연구한 단계 */
export function ptLevel(s: CarState, id: string): number {
  if (!unlockedIds(s, 'powertrain').has(id)) return 0;
  return powertrainById(id).startLevel + effectsOf(s).reduce((a, e) => a + (e.type === 'ptLevel' && e.id === id ? e.amount : 0), 0);
}
/** 해금된 동력 종류별 연구 단계 */
export const powertrainLevels = (s: CarState): Record<string, number> => Object.fromEntries(unlockedPowertrains(s).map((p) => [p.id, ptLevel(s, p.id)]));
/** 등급(보급형/표준/고급 = tier 1~3) → 실제 단계: 연구한 최신 단계에서 0/−1/−2(최소 1) */
export const levelForTier = (s: CarState, powertrain: string, tier: number): number =>
  Math.max(1, ptLevel(s, powertrain) - (powertrainById(powertrain).tiers.length - tier));

const sumOf = (s: CarState, type: 'costCut' | 'defectCut' | 'upkeepCut' | 'devSpeed' | 'evCostCut'): number =>
  effectsOf(s).reduce((a, e) => a + (e.type === type ? e.value : 0), 0);
/** 원가 인하율(대당 원가 × (1 − 이 값)) */
export const costCut = (s: CarState): number => Math.min(0.5, sumOf(s, 'costCut'));
/** 개발 중 결함 감소율(설계 결함 × (1 − 이 값)) */
export const defectCut = (s: CarState): number => Math.min(0.8, sumOf(s, 'defectCut'));
/** 공장 유지비 인하율 */
export const upkeepCut = (s: CarState): number => Math.min(0.8, sumOf(s, 'upkeepCut'));
/** 개발 속도 가산(주간 점수 × (1 + 이 값)) */
export const devSpeed = (s: CarState): number => sumOf(s, 'devSpeed');
/** 동력 원가 가산: 바닥(minCostAdd)이 있는 동력(전기)은 연구로 줄어든다 */
export function ptCostAdd(s: CarState, powertrain: string): number {
  const pt = powertrainById(powertrain);
  return pt.minCostAdd === undefined ? pt.costAdd : Math.max(pt.minCostAdd, pt.costAdd - sumOf(s, 'evCostCut'));
}

/** 지금 시작하면 드는 비용: 먼저 하면 × (1 + 0.25 × 앞당긴 햇수), 등장 + 8년 뒤면 × 0.5, 반복 기술은 × 1.5^(한 횟수) */
export function researchCost(s: CarState, t: TechDef): { money: number; points: number; mult: number } {
  const y = yearOf(s.week);
  let mult = y < t.year ? 1 + R.earlyRate * (t.year - y) : y >= t.year + R.lateYears ? R.lateMult : 1;
  if (t.repeatable) mult *= R.repeatGrowth ** doneCount(s, t.id);
  return { money: Math.round(t.cost.money * mult), points: Math.round(t.cost.points * mult), mult };
}
/** 동시 연구 칸(본사 등급) */
export const researchSlots = (s: CarState): number => R.slots[s.hqLevel - 1];
const missingPre = (s: CarState, t: TechDef): TechDef[] => t.pre.filter((id) => !isDone(s, id)).map(techById);
const josa = (w: string) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를'; };

/** 연구를 시작할 수 없는 이유(없으면 null) */
export function researchError(s: CarState, techId: string): string | null {
  const t = TECHS.find((x) => x.id === techId);
  if (!t) return '없는 기술입니다.';
  if (!t.repeatable && isDone(s, t.id)) return '이미 연구한 기술입니다.';
  if (s.research.active.some((a) => a.techId === t.id)) return '이미 연구 중인 기술입니다.';
  if (t.year - yearOf(s.week) > R.earlyMax) return `${t.year - R.earlyMax}년부터 연구할 수 있습니다.`;
  const pre = missingPre(s, t);
  if (pre.length) { const names = pre.map((x) => `「${x.name}」`).join(', '); return `먼저 ${names}${josa(pre[pre.length - 1].name)} 연구해야 합니다.`; }
  if (s.research.active.length >= researchSlots(s)) return researchSlots(s) < R.slots[R.slots.length - 1] ? '연구 칸이 찼습니다(본사 4등급부터 2개를 함께 연구할 수 있습니다).' : '연구 칸이 찼습니다.';
  if (s.cash < researchCost(s, t).money) return '현금이 모자랍니다.';
  return null;
}

/** 직원 한 명의 주간 연구 점수: 프로젝트·교육·휴식에 없는 엔지니어가 능력 / 10, 전담 연구원 × 1.5 */
export const staffResearchPoints = (x: Staff, week: number): number =>
  x.role !== 'engineer' || x.projectId !== null || isAway(x, week) ? 0 : (x.ability / R.pointsDiv) * (x.lab ? R.labMult : 1);
export const weeklyResearchPoints = (s: CarState): number => s.staff.reduce((a, x) => a + staffResearchPoints(x, s.week), 0);

/** 효과 한 줄(쉬운 말) */
export function effectText(e: TechEffect): string {
  switch (e.type) {
    case 'body': return `${bodyById(e.id).name} 차체`;
    case 'option': return `${optionById(e.id).name} 옵션`;
    case 'powertrain': return `${powertrainById(e.id).name} 동력`;
    case 'ptLevel': return `${powertrainById(e.id).name} 단계 +${e.amount}`;
    case 'costCut': return `원가 −${Math.round(e.value * 100)}%`;
    case 'defectCut': return `개발 결함 −${Math.round(e.value * 100)}%`;
    case 'upkeepCut': return `공장 유지비 −${Math.round(e.value * 100)}%`;
    case 'devSpeed': return `개발 속도 +${Math.round(e.value * 100)}%`;
    case 'evCostCut': return `전기 원가 가산 −${Math.round(e.value * 100)}%p`;
  }
}
export const techEffectsText = (t: TechDef): string => t.effects.map(effectText).join(', ');

/** 한 주 연구: 주간 점수를 진행 중인 연구에 시작 순으로 채운다(남는 점수는 다음 연구로, 연구가 없으면 사라짐). 완료하면 이벤트 */
export function researchWeek(s: CarState, ev: GameEvent[]): void {
  let pts = weeklyResearchPoints(s);
  for (const a of s.research.active) { const use = Math.min(pts, a.need - a.points); a.points += use; pts -= use; }
  const done = s.research.active.filter((a) => a.points >= a.need - 1e-9);
  if (!done.length) return;
  s.research.active = s.research.active.filter((a) => !done.includes(a));
  for (const a of done) {
    const t = techById(a.techId), early = yearOf(s.week) < t.year;
    s.research.done.push(t.id);
    if (early && !s.research.early.includes(t.id)) s.research.early.push(t.id);
    ev.push({ kind: 'unlock', text: `연구 완료: 「${t.name}」 — ${techEffectsText(t)}${early ? '. 세계 최초! 이 기술을 쓴 첫 차는 평론 +1' : ''}` });
  }
}

/** "세계 최초": 먼저 연구해 아직 쓰지 않은 기술 중 이 차가 쓰는 것(차체·동력·옵션 해금, 그 동력의 단계) */
export function worldFirstTechs(s: CarState, car: { body: string; powertrain: string; options: string[] }): string[] {
  return s.research.early.filter((id) => techById(id).effects.some((e) =>
    (e.type === 'body' && e.id === car.body) || (e.type === 'option' && car.options.includes(e.id)) || ((e.type === 'powertrain' || e.type === 'ptLevel') && e.id === car.powertrain)));
}

// ---------- 연구 화면 조회 ----------
export type TechStatus = 'done' | 'active' | 'available' | 'locked' | 'hidden';
export interface TechRow {
  id: string; name: string; desc: string; field: TechField; year: number; repeatable: boolean; count: number; // count: 완료 횟수(반복 기술)
  status: TechStatus; // 완료 / 진행 중 / 가능 / 선행 필요 / 아직 이름만 보임(등장 4년 전보다 이름)
  cost: { money: number; points: number; mult: number }; // 지금 시작하면(배수 반영). 진행 중이면 시작 때 값
  pointsLeft: number; weeksLeft: number | null; // 남은 점수, 지금 주간 점수로 예상 주(점수가 0이면 null)
  effects: string; pre: { id: string; name: string; done: boolean }[];
  reason: string | null; // 시작할 수 없는 이유(가능하면 null)
}
export const FIELD_NAMES: Record<TechField, string> = { powertrain: '동력', body: '차체·안전', electronics: '전장·편의', production: '생산', eco: '친환경' };
export interface ResearchInfo {
  fields: { id: TechField; name: string; techs: TechRow[] }[];
  pointsPerWeek: number; slots: number; used: number;
  active: { techId: string; name: string; points: number; need: number; weeksLeft: number | null }[];
  doneCount: number; // 완료한 기술 수(반복 기술은 횟수만큼)
}
export function researchInfo(s: CarState): ResearchInfo {
  const ppw = weeklyResearchPoints(s), y = yearOf(s.week);
  const weeks = (left: number) => (left <= 0 ? 0 : ppw > 0 ? Math.ceil(left / ppw) : null);
  const row = (t: TechDef): TechRow => {
    const act = s.research.active.find((a) => a.techId === t.id), done = !t.repeatable && isDone(s, t.id);
    const hidden = !done && !act && t.year - y > R.earlyMax, reason = act || done ? null : researchError(s, t.id);
    const cost = act ? { money: 0, points: act.need, mult: 1 } : researchCost(s, t), left = act ? act.need - act.points : done ? 0 : cost.points;
    return {
      id: t.id, name: t.name, desc: hidden ? '' : t.desc, field: t.field, year: t.year, repeatable: !!t.repeatable, count: doneCount(s, t.id),
      status: done ? 'done' : act ? 'active' : hidden ? 'hidden' : missingPre(s, t).length ? 'locked' : 'available',
      cost, pointsLeft: left, weeksLeft: weeks(left), effects: hidden ? '' : techEffectsText(t),
      pre: t.pre.map((id) => ({ id, name: techById(id).name, done: isDone(s, id) })), reason,
    };
  };
  return {
    fields: (Object.keys(FIELD_NAMES) as TechField[]).map((f) => ({ id: f, name: FIELD_NAMES[f], techs: TECHS.filter((t) => t.field === f).map(row) })),
    pointsPerWeek: ppw, slots: researchSlots(s), used: s.research.active.length,
    active: s.research.active.map((a) => ({ techId: a.techId, name: techById(a.techId).name, points: a.points, need: a.need, weeksLeft: weeks(a.need - a.points) })),
    doneCount: s.research.done.length,
  };
}
