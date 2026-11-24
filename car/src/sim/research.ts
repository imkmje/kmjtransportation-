// 연구(설계서 10장): 기술 해금 상태, 연구 비용(선행 할증·늦은 할인), 주간 연구 점수, 연구 화면 조회. 상태를 바꾸는 것은 researchWeek뿐
import { config } from '../config';
import { BODIES, OPTIONS, POWERTRAINS, TECHS, bodyById, optionById, powertrainById, techById } from '../data';
import { isAway } from './company';
import { josa } from './josa';
import { yearOf } from './time';
import { REGION, eraTimeline } from './events';
import type { Battery, BodyDef, CarState, GameEvent, OptionDef, PowertrainDef, Staff, TechDef, TechEffect, TechField } from './types';

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
/** 동력 원가 가산: 바닥(minCostAdd)이 있는 동력(전기)은 연구로 줄어든다. 1.2.0 전기차는 × 배터리 용량 배수 × 전용 플랫폼 절감(생략하면 표준·플랫폼 없음 = 1.1.0과 같다) */
export function ptCostAdd(s: CarState, powertrain: string, battery?: Battery, platform?: boolean): number {
  const pt = powertrainById(powertrain), V = config.ev;
  const add = pt.minCostAdd === undefined ? pt.costAdd : Math.max(pt.minCostAdd, pt.costAdd - sumOf(s, 'evCostCut'));
  return powertrain === config.events.charging.powertrain ? add * V.battery[battery ?? 'std'].cost * (platform ? 1 - V.platform.costCut : 1) : add;
}
/** 1.2.0 전기차 충전 연구 단계(충전 속도 효과를 낸 기술 수) */
export const chargeStep = (s: CarState): number => effectsOf(s).filter((e) => e.type === 'evCharge').length;
/** 1.2.0 전기차 전용 플랫폼 연구를 마쳤는가 */
export const platformReady = (s: CarState): boolean => effectsOf(s).some((e) => e.type === 'evPlatform');
/** 자료 순서대로 이 기술까지 한 충전 단계(연구 카드·완료 알림의 분 표시용) */
const chargeStepAt = (t: TechDef): number => TECHS.slice(0, TECHS.indexOf(t) + 1).flatMap((x) => x.effects).filter((e) => e.type === 'evCharge').length;
const chargeMin = (step: number): number => { const m = config.ev.charge.minutes; return m[Math.min(step, m.length - 1)]; };

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

/** 연구를 시작할 수 없는 이유(없으면 null) */
export function researchError(s: CarState, techId: string): string | null {
  const t = TECHS.find((x) => x.id === techId);
  if (!t) return '없는 기술입니다.';
  if (!t.repeatable && isDone(s, t.id)) return '이미 연구한 기술입니다.';
  if (s.research.active.some((a) => a.techId === t.id)) return '이미 연구 중인 기술입니다.';
  if (t.year - yearOf(s.week) > R.earlyMax) return `${t.year - R.earlyMax}년부터 연구할 수 있습니다.`;
  const pre = missingPre(s, t);
  if (pre.length) { const names = pre.map((x) => `「${x.name}」`).join(', '); return `먼저 ${names}${josa(names, '을/를')} 연구해야 합니다.`; }
  if (s.research.active.length >= researchSlots(s)) return researchSlots(s) < R.slots[R.slots.length - 1] ? '연구 칸이 찼습니다(본사 등급을 올리면 칸이 늘어납니다).' : '연구 칸이 찼습니다.';
  if (s.cash < researchCost(s, t).money) return '현금이 모자랍니다.';
  return null;
}

/** 직원 한 명의 주간 연구 점수: 프로젝트·교육·휴식에 없는 엔지니어가 능력 / 10, 전담 연구원 × 1.5 */
export const staffResearchPoints = (x: Staff, week: number): number =>
  x.role !== 'engineer' || isAway(x, week) ? 0 : (x.ability / R.pointsDiv) * (x.lab ? R.labMult : x.projectId !== null ? R.projectShare : 1);
/** 3.5.0 기술 제휴 중이면 제휴 한 곳마다 × (1 + config.rivalry.alliance.speed)만큼 더 */
export const weeklyResearchPoints = (s: CarState): number => s.staff.reduce((a, x) => a + staffResearchPoints(x, s.week), 0) * (1 + (s.rivalry?.alliances.length ?? 0) * config.rivalry.alliance.speed);

/** 전기차 추가 원가(%)가 이 기술 직전·직후에 얼마인지: 자료 순서대로 앞선 배터리 연구를 모두 했다고 본다 */
function evCostSpan(t: TechDef, cut: number): [number, number] {
  const ev = POWERTRAINS.find((p) => p.id === config.events.charging.powertrain)!, prior = TECHS.slice(0, TECHS.indexOf(t)).flatMap((x) => x.effects).reduce((a, e) => a + (e.type === 'evCostCut' ? e.value : 0), 0);
  const before = Math.max(ev.minCostAdd ?? 0, ev.costAdd - prior);
  return [Math.round(before * 100), Math.round(Math.max(ev.minCostAdd ?? 0, before - cut) * 100)];
}
/** 효과 한 줄(연구 카드용 짧은 말) */
export function effectText(e: TechEffect, t?: TechDef): string {
  switch (e.type) {
    case 'body': return `${bodyById(e.id).name} 차체를 쓸 수 있음`;
    case 'option': return `${optionById(e.id).name} 옵션을 쓸 수 있음`;
    case 'powertrain': return `${powertrainById(e.id).name} 동력을 쓸 수 있음`;
    case 'ptLevel': return `${powertrainById(e.id).name} 동력 ${e.amount === 1 ? '한' : e.amount} 단계 향상`;
    case 'costCut': return `차 원가 ${Math.round(e.value * 100)}% 절감`;
    case 'defectCut': return `개발 중 생기는 결함 ${Math.round(e.value * 100)}% 감소`;
    case 'upkeepCut': return `공장 유지비 ${Math.round(e.value * 100)}% 절감`;
    case 'devSpeed': return `개발 속도 ${Math.round(e.value * 100)}% 향상`;
    case 'evCostCut': { if (!t) return '전기차 추가 원가 감소'; const [a, b] = evCostSpan(t, e.value); return `전기차 추가 원가 ${a}% → ${b}%`; }
    case 'evCharge': { if (!t) return '전기차 충전 속도 향상'; const n = chargeStepAt(t); return `전기차 10→80% 충전 ${chargeMin(n - 1)}분 → ${chargeMin(n)}분`; }
    case 'evPlatform': return '새로 개발하는 전기차에 전용 플랫폼 적용(실용·주행 거리 향상, 원가 절감)';
  }
}
/** 카드용 효과 줄. 동력 단계 효과는 하나로 묶는다("가솔린·디젤 동력 한 단계 향상") */
// shortcut: 묶을 때(여기와 unlockText) 단계 수를 1로 본다(자료가 모두 1), 2 이상인 기술이 생기면 따로 적을 것
export function techEffectsText(t: TechDef): string {
  const lv = t.effects.filter((e) => e.type === 'ptLevel').map((e) => powertrainById((e as { id: string }).id).name).join('·');
  return [...(lv ? [`${lv} 동력 한 단계 향상`] : []), ...t.effects.filter((e) => e.type !== 'ptLevel').map((e) => effectText(e, t))].join(', ');
}
/** 연구 완료 알림 문장: 해금은 "이제 ○○을 만들 수 있습니다.", 단계·비율 효과는 바뀐 결과를 문장으로 */
export function unlockText(t: TechDef): string {
  const names = (type: TechEffect['type'], name: (id: string) => string) => t.effects.flatMap((e) => (e.type === type && 'id' in e ? [name(e.id)] : [])).join('·');
  const body = names('body', (id) => bodyById(id).name), opt = names('option', (id) => optionById(id).name), pt = names('powertrain', (id) => powertrainById(id).name), lv = names('ptLevel', (id) => powertrainById(id).name);
  const out: string[] = [];
  if (body) out.push(`이제 ${body}${josa(body, '을/를')} 만들 수 있습니다.`);
  if (opt) out.push(`이제 차에 ${opt}${josa(opt, '을/를')} 넣을 수 있습니다.`);
  if (pt) out.push(`이제 ${pt} 동력을 쓸 수 있습니다.`);
  if (lv) out.push(`${lv} 동력이 한 단계 좋아졌습니다.`);
  for (const e of t.effects) switch (e.type) {
    case 'costCut': out.push(`차 원가가 ${Math.round(e.value * 100)}% 줄었습니다.`); break;
    case 'defectCut': out.push(`개발 중 생기는 결함이 ${Math.round(e.value * 100)}% 줄었습니다.`); break;
    case 'upkeepCut': out.push(`공장 유지비가 ${Math.round(e.value * 100)}% 줄었습니다.`); break;
    case 'devSpeed': out.push(`개발 속도가 ${Math.round(e.value * 100)}% 빨라졌습니다.`); break;
    case 'evCostCut': { const [a, b] = evCostSpan(t, e.value); out.push(`전기차를 만들 때 더 드는 원가가 ${a}%에서 ${b}%로 줄었습니다.`); break; }
    case 'evCharge': out.push(`전기차 10→80% 충전 시간이 약 ${chargeMin(chargeStepAt(t))}분으로 줄었습니다(표준 배터리 기준).`); break;
    case 'evPlatform': out.push('이제 새로 개발하는 전기차 세대는 전용 플랫폼을 씁니다. 실내가 넓어지고 주행 거리가 늘며 전기차 원가 가산이 줄어듭니다. 이미 출시한 세대는 그대로입니다.'); break;
    default: break;
  }
  return out.join(' ');
}

/** 진행 중 연구별 이번 주 점수(0.5.1): 우선 연구(맨 앞)가 있으면 그 연구에 priorityShare, 나머지는 고르게. 다 채워 남는 점수는 남은 연구에 고르게 다시 나눈다.
 *  need: 연구별 남은 점수(생략하면 지금 상태). pts: 이번 주 점수 */
export function researchShares(s: CarState, pts: number, need = s.research.active.map((a) => a.need - a.points)): number[] {
  const act = s.research.active, got = act.map(() => 0), pri = act.findIndex((a) => a.techId === s.research.priority);
  let left = pts;
  for (let round = 0; round < act.length && left > 1e-9; round++) {
    const open = act.map((_, i) => i).filter((i) => need[i] - got[i] > 1e-9);
    if (!open.length) break;
    const priOpen = pri >= 0 && open.includes(pri) && open.length > 1, pool = left;
    for (const i of open) {
      const share = priOpen ? (i === pri ? R.priorityShare : (1 - R.priorityShare) / (open.length - 1)) : 1 / open.length;
      const use = Math.min(pool * share, need[i] - got[i]);
      got[i] += use; left -= use;
    }
  }
  return got;
}
/** 0.5.1: 예고(또는 시행)된 국내 규제의 의무 장비를 여는 기술(선행 포함) 중 아직 안 한 것과 그 시행 주. 연구 화면·우선순위용 */
export function regulatedTechs(s: CarState): Map<string, { eventName: string; week: number }> {
  const out = new Map<string, { eventName: string; week: number }>(), m = Math.floor(s.week / config.time.weeksPerMonth);
  for (const sp of eraTimeline(s.seed)) for (const e of sp.def.effects) {
    if (e.type !== 'regulation' || e.region !== REGION || !e.options?.length || m < sp.start - config.events.warnMonths) continue;
    const week = (sp.start + e.graceMonths) * config.time.weeksPerMonth;
    const add = (id: string) => { if (isDone(s, id) || out.has(id)) return; out.set(id, { eventName: sp.def.name, week }); for (const q of techById(id).pre) add(q); };
    for (const o of e.options) { const t = TECHS.find((x) => !x.repeatable && x.effects.some((f) => f.type === 'option' && f.id === o)); if (t) add(t.id); }
  }
  return out;
}

/** 한 주 연구(0.5.1): 주간 점수를 진행 중인 연구에 고르게 나눈다(우선 연구는 50%). 규제로 필요한 기술이 진행 중이면 자동으로 우선. 완료하면 이벤트 */
export function researchWeek(s: CarState, ev: GameEvent[]): void {
  const req = regulatedTechs(s), cur = s.research.priority;
  if (!(cur && req.has(cur) && s.research.active.some((a) => a.techId === cur))) { const r = s.research.active.find((a) => req.has(a.techId)); if (r) { s.research.priority = r.techId; s.research.active = [r, ...s.research.active.filter((a) => a !== r)]; } }
  const got = researchShares(s, weeklyResearchPoints(s));
  s.research.active.forEach((a, i) => { a.points += got[i]; });
  const done = s.research.active.filter((a) => a.points >= a.need - 1e-9);
  if (!done.length) return;
  s.research.active = s.research.active.filter((a) => !done.includes(a));
  if (s.research.priority && !s.research.active.some((a) => a.techId === s.research.priority)) delete s.research.priority;
  for (const a of done) {
    const t = techById(a.techId), early = yearOf(s.week) < t.year;
    s.research.done.push(t.id);
    if (early && !s.research.early.includes(t.id)) s.research.early.push(t.id);
    ev.push({ kind: 'unlock', category: 'research', text: `「${t.name}」 연구를 마쳤습니다. ${unlockText(t)}${early ? ' 세계 최초입니다. 이 기술을 처음 쓰는 차는 평론 점수를 1점씩 더 받습니다.' : ''}` });
  }
}

/** "세계 최초": 먼저 연구해 아직 쓰지 않은 기술 중 이 차가 쓰는 것(차체·동력·옵션 해금, 그 동력의 단계) */
export function worldFirstTechs(s: CarState, car: { body: string; powertrain: string; options: string[] }): string[] {
  return s.research.early.filter((id) => techById(id).effects.some((e) =>
    (e.type === 'body' && e.id === car.body) || (e.type === 'option' && car.options.includes(e.id)) || ((e.type === 'powertrain' || e.type === 'ptLevel') && e.id === car.powertrain)
    || ((e.type === 'evCharge' || e.type === 'evPlatform') && car.powertrain === config.events.charging.powertrain)));
}

// ---------- 연구 화면 조회 ----------
export type TechStatus = 'done' | 'active' | 'available' | 'locked' | 'hidden';
export interface TechRow {
  id: string; name: string; desc: string; info: string; field: TechField; year: number; repeatable: boolean; count: number; // count: 완료 횟수(반복 기술)
  status: TechStatus; // 완료 / 진행 중 / 가능 / 선행 필요 / 아직 이름만 보임(등장 4년 전보다 이름)
  cost: { money: number; points: number; mult: number }; // 지금 시작하면(배수 반영). 진행 중이면 시작 때 값
  pointsLeft: number; weeksLeft: number | null; // 남은 점수, 지금 주간 점수로 예상 주(점수가 0이면 null)
  effects: string; pre: { id: string; name: string; done: boolean }[];
  reason: string | null; // 시작할 수 없는 이유(가능하면 null)
  requiredBy: { eventName: string; week: number } | null; // 0.5.1: 예고·시행된 규제의 의무 장비에 필요한 기술이면 그 사건 이름과 시행 주(아직 안 했을 때만)
}
export const FIELD_NAMES: Record<TechField, string> = { powertrain: '동력', body: '차체·안전', electronics: '편의 장비', production: '생산', eco: '친환경' };
export interface ResearchInfo {
  fields: { id: TechField; name: string; techs: TechRow[] }[];
  pointsPerWeek: number; slots: number; used: number;
  active: { techId: string; name: string; points: number; need: number; weeksLeft: number | null; pointsPerWeek: number; priority: boolean; requiredBy: { eventName: string; week: number } | null }[]; // 0.5.1: pointsPerWeek 이번 주 실제로 받는 점수, weeksLeft 나눠 받기·먼저 끝난 연구의 몫 넘김을 따라간 남은 주, priority 우선 연구
  doneCount: number; // 완료한 기술 수(반복 기술은 횟수만큼)
}
export function researchInfo(s: CarState): ResearchInfo {
  const ppw = weeklyResearchPoints(s), y = yearOf(s.week), req = regulatedTechs(s);
  const weeks = (left: number) => (left <= 0 ? 0 : ppw > 0 ? Math.ceil(left / ppw) : null);
  // 진행 중 연구의 남은 주: 지금 주간 점수가 그대로라고 보고 나눠 받기를 주마다 따라간다(최대 10년)
  const need = s.research.active.map((a) => a.need - a.points), now = researchShares(s, ppw, need), wl: (number | null)[] = need.map((x) => (x <= 1e-9 ? 0 : null));
  for (let w = 1, left = [...need]; ppw > 0 && w <= 480 && wl.some((x) => x === null); w++) {
    const got = researchShares(s, ppw, left);
    left = left.map((x, i) => x - got[i]); left.forEach((x, i) => { if (wl[i] === null && x <= 1e-9) wl[i] = w; });
  }
  const row = (t: TechDef): TechRow => {
    const act = s.research.active.find((a) => a.techId === t.id), done = !t.repeatable && isDone(s, t.id);
    const hidden = !done && !act && t.year - y > R.earlyMax, reason = act || done ? null : researchError(s, t.id);
    const cost = act ? { money: 0, points: act.need, mult: 1 } : researchCost(s, t), left = act ? act.need - act.points : done ? 0 : cost.points;
    return {
      id: t.id, name: t.name, desc: hidden ? '' : t.desc, info: hidden ? '' : t.info, field: t.field, year: t.year, repeatable: !!t.repeatable, count: doneCount(s, t.id),
      status: done ? 'done' : act ? 'active' : hidden ? 'hidden' : missingPre(s, t).length ? 'locked' : 'available',
      cost, pointsLeft: left, weeksLeft: weeks(left), effects: hidden ? '' : techEffectsText(t),
      pre: t.pre.map((id) => ({ id, name: techById(id).name, done: isDone(s, id) })), reason, requiredBy: req.get(t.id) ?? null,
    };
  };
  return {
    fields: (Object.keys(FIELD_NAMES) as TechField[]).map((f) => ({ id: f, name: FIELD_NAMES[f], techs: TECHS.filter((t) => t.field === f).map(row) })),
    pointsPerWeek: ppw, slots: researchSlots(s), used: s.research.active.length,
    active: s.research.active.map((a, i) => ({ techId: a.techId, name: techById(a.techId).name, points: a.points, need: a.need, weeksLeft: wl[i], pointsPerWeek: now[i], priority: a.techId === s.research.priority, requiredBy: req.get(a.techId) ?? null })),
    doneCount: s.research.done.length,
  };
}
