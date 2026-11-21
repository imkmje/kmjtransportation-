// 1.1.0 장비 고르기(기획·페이스리프트·풀체인지 공통): 장비마다 안 넣음 / 선택 사양 / 기본 장비, 시대의 기대, 추천 구성.
// 규칙은 sim(Q.equipInfo·recommendedEquip·equipChanges, O1)이 정한다. 그 조회가 아직 없는 판에서는 같은 모양의 어림값(shim)으로 화면을 그린다.
import { OPTIONS, SEGMENTS, TECHS } from '../data';
import * as Q from '../sim/queries';
import { yearOf } from '../sim/time';
import type { CarState } from '../sim/types';
import { esc, josa, money, num } from './fmt';

export type EquipLevel = 'opt' | 'std';
export type Equip = Record<string, EquipLevel>;
export interface EquipItem {
  id: string; name: string; info: string; available: boolean; whyNot: string | null; required: boolean;
  expectation: 'rare' | 'common' | 'expected'; expectText: string; cost: number; value: number; optPrice: number; takeRate: number;
  level: EquipLevel | null; effect: { std: string; opt: string };
}
export interface EquipInfo { items: EquipItem[]; totals: { stdCost: number; stdValue: number; optProfitPerCar: number; basePrice: number; missingExpected: string[]; penalty: number; bonus: number } }
export interface EquipChange { id: string; name: string; from: EquipLevel | null; to: EquipLevel | null; reason: string }
export interface EquipSpec { body: string; segment: string; powertrain: string; equip: Equip; [k: string]: unknown }

type Api = {
  equipInfo?: (s: CarState, spec: EquipSpec, year?: number) => EquipInfo;
  recommendedEquip?: (s: CarState, body: string, segment: string, powertrain: string, year?: number) => Equip;
  equipChanges?: (s: CarState, prev: Equip, body: string, segment: string, year?: number) => EquipChange[];
};
const api = Q as unknown as Api;
/** O1의 sim 규칙이 들어왔는가(들어오면 어림값 대신 그것을 쓴다) */
export const equipLive = (): boolean => typeof api.equipInfo === 'function';

/** 옛 옵션 목록 → 장비 구성(모두 기본 장비). 옛 저장·프리셋·0.x 판 읽기용 */
export const fromOptions = (opts: readonly string[]): Equip => Object.fromEntries(opts.map((o) => [o, 'std' as const]));
/** 장비 구성 → sim이 받는 옵션 목록. shortcut: O1 규칙 연결 전에는 선택 사양도 기본 장비처럼 넣어 계산된다 */
export function toOptions(e: Equip, s?: CarState): string[] {
  if (equipLive()) return OPTIONS.filter((o) => e[o.id] === 'std').map((o) => o.id); // 규칙이 들어오면 O1과 같게 options = 기본 장비만(선택 사양은 equip으로 넘긴다)
  // shortcut: 연결 전의 sim은 옵션 칸 수를 검사하므로 기본 장비 → 선택 사양 순으로 칸 수까지만(규칙이 들어오면 이 갈래는 쓰지 않는다)
  const slots = (Q as unknown as { optionSlots?: (x: CarState) => number }).optionSlots, max = s && slots ? slots(s) : Infinity, req = new Set(s ? Q.requiredOptions(s) : []);
  return [...OPTIONS.filter((o) => e[o.id] === 'std'), ...OPTIONS.filter((o) => e[o.id] === 'opt')].filter((o) => !req.has(o.id)).slice(0, max).map((o) => o.id);
}

// ---------- 어림값(shim): O1 규칙이 오기 전 화면용. 등장 연도로 기대를 나누고, 값은 Q.optionValue ----------
const techYear = new Map<string, number>();
for (const t of TECHS) for (const e of t.effects) if (e.type === 'option') techYear.set(e.id, t.year);
const shimExpect = (id: string, year: number): EquipItem['expectation'] => { const y0 = techYear.get(id) ?? OPTIONS.find((o) => o.id === id)!.year, age = year - y0; return age >= 20 ? 'expected' : age >= 8 ? 'common' : 'rare'; };
function shimInfo(s: CarState, spec: EquipSpec, year = yearOf(s.week)): EquipInfo {
  const open = new Set(Q.optionsAt(s).map((o) => o.id)), req = new Set(Q.requiredOptions(s)), cm = Q.costMultOf(s), seg = SEGMENTS.find((x) => x.id === spec.segment);
  const items = OPTIONS.map((o): EquipItem => {
    const cost = o.cost * cm, value = Q.optionValue(o.id, spec.segment, year), optPrice = Math.round(value * 1.3), ex = shimExpect(o.id, year);
    const fit = seg ? (o.U * seg.w.U + o.D * seg.w.D + o.Q * seg.w.Q) / Math.max(1, o.U + o.D + o.Q) : 0, takeRate = Math.max(0.1, Math.min(0.7, 0.2 + fit));
    const st = (['U', 'D', 'Q'] as const).filter((k) => o[k]).map((k) => `${{ U: '실용', D: '디자인', Q: '품질' }[k]} +${o[k]}`).join(' · ');
    const level = req.has(o.id) ? 'std' : spec.equip[o.id] ?? null;
    return { id: o.id, name: o.name, info: o.info, available: open.has(o.id), whyNot: open.has(o.id) ? null : '연구가 필요합니다', required: req.has(o.id), expectation: ex,
      expectText: ex === 'expected' ? '이 시대에 기대되는 장비' : ex === 'common' ? '흔해지는 중' : '아직 드묾', cost, value, optPrice, takeRate, level,
      effect: { std: `원가 +${num(cost)}만원 · 기준가 +${num(value)}만원${st ? ` · ${st}` : ''}`, opt: `손님의 약 ${Math.round(takeRate * 100)}%가 선택 · 추가 요금 ${num(optPrice)}만원 · 대당 이익 +${num(takeRate * (optPrice - cost))}만원` } };
  });
  const std = items.filter((x) => x.level === 'std'), opt = items.filter((x) => x.level === 'opt');
  return { items, totals: { stdCost: std.reduce((a, x) => a + x.cost, 0), stdValue: std.reduce((a, x) => a + x.value, 0), optProfitPerCar: opt.reduce((a, x) => a + x.takeRate * (x.optPrice - x.cost), 0),
    basePrice: Q.carBasePrice(s, { body: spec.body, segment: spec.segment, powertrain: spec.powertrain, options: std.map((x) => x.id) }),
    missingExpected: items.filter((x) => x.available && x.expectation === 'expected' && !x.level).map((x) => x.name), penalty: 0, bonus: 0 } };
}
function shimRecommended(s: CarState, body: string, segment: string, powertrain: string, year?: number): Equip {
  const info = shimInfo(s, { body, segment, powertrain, equip: {} }, year), out: Equip = {};
  for (const x of info.items) if (x.available) { if (x.required || x.expectation === 'expected') out[x.id] = 'std'; else if (x.expectation === 'common' && x.value >= x.cost) out[x.id] = 'opt'; }
  return out;
}
function shimChanges(s: CarState, prev: Equip, body: string, segment: string, year?: number): EquipChange[] {
  const info = shimInfo(s, { body, segment, powertrain: '', equip: prev }, year);
  return info.items.filter((x) => x.available && x.expectation === 'expected' && prev[x.id] !== 'std').map((x) => ({ id: x.id, name: x.name, from: prev[x.id] ?? null, to: 'std' as const, reason: '이제 이 차급에서 기대되는 장비가 됐습니다' }));
}

export const equipInfo = (s: CarState, spec: EquipSpec, year?: number): EquipInfo => (api.equipInfo ?? shimInfo)(s, spec, year);
export const recommendedEquip = (s: CarState, body: string, segment: string, powertrain: string, year?: number): Equip => (api.recommendedEquip ?? shimRecommended)(s, body, segment, powertrain, year);
export const equipChanges = (s: CarState, prev: Equip, body: string, segment: string, year?: number): EquipChange[] => (api.equipChanges ?? shimChanges)(s, prev, body, segment, year);

/** 장비 한 줄 요약: "기본: 라디오·에어컨 / 선택: 가죽 시트" */
export function equipLine(e: Equip): string {
  const n = (lv: EquipLevel) => OPTIONS.filter((o) => e[o.id] === lv).map((o) => o.name).join('·');
  const std = n('std'), opt = n('opt');
  return std || opt ? `${std ? `기본: ${std}` : ''}${std && opt ? ' / ' : ''}${opt ? `선택: ${opt}` : ''}` : '장비 없음';
}
const LV: [EquipLevel | '', string][] = [['', '안 넣음'], ['opt', '선택 사양'], ['std', '기본 장비']];
const EX_ORDER = { expected: 0, common: 1, rare: 2 } as const;
/** 장비 고르기 칸. t: 'plan' | 'lift'(어느 초안을 고치는지), changes: 풀체인지·페이스리프트의 '전작 이후 기대가 바뀐 장비', ib: ⓘ 버튼 */
export function equipPicker(s: CarState, spec: EquipSpec, t: 'plan' | 'lift', ib: (k: string, label?: string) => string, changes: EquipChange[] = [], mode = ''): string {
  const info = equipInfo(s, spec), T = info.totals;
  const items = [...info.items].sort((a, b) => Number(b.available) - Number(a.available) || EX_ORDER[a.expectation] - EX_ORDER[b.expectation] || a.name.localeCompare(b.name, 'ko'));
  const row = (x: EquipItem) => {
    const badge = `<span class="eq-x ex-${x.expectation}">${esc(x.expectText)}</span>`, lv = x.level ?? '';
    const seg = x.required ? `<span class="eq-lock">기본 장비 · 규제 의무로 고정</span>` : !x.available ? `<span class="eq-lock off">${esc(x.whyNot ?? '쓸 수 없습니다')}</span>`
      : `<div class="seg eq-seg" role="group" aria-label="${esc(x.name)}">${LV.map(([k, l]) => `<button data-act="eqSet" data-t="${t}" data-k="${x.id}" data-v="${k}" aria-pressed="${lv === k}">${l}</button>`).join('')}</div>`;
    const eff = x.level === 'std' || x.required ? x.effect.std : x.level === 'opt' ? x.effect.opt : `기본 장비면 ${x.effect.std}`;
    return `<div class="eq-row${x.available ? '' : ' off'}${x.required ? ' req' : ''}" data-eq="${x.id}"><div class="eq-h"><b>${esc(x.name)}</b>${ib(`opt:${x.id}`, x.name)}${badge}</div>${seg}<p class="eq-eff">${esc(eff)}</p></div>`;
  };
  const miss = T.missingExpected.length ? `<div class="warnbox eq-miss">이 차급에서 기대되는 ${esc(T.missingExpected.join('·'))}${josa(T.missingExpected.join('·'), '이/가')} 없습니다 — 판매와 평론이 깎입니다.</div>` : '';
  const chg = changes.length ? `<div class="okbox eq-chg"><b>전작 이후 기대가 바뀐 장비 ${changes.length}개</b><ul>${changes.map((c) => `<li>${esc(c.name)}: ${c.from ? LV.find(([k]) => k === c.from)![1] : '안 넣음'} → ${c.to ? LV.find(([k]) => k === c.to)![1] : '안 넣음'} <small>${esc(c.reason)}</small></li>`).join('')}</ul><button class="btn" data-act="eqApply" data-t="${t}">한 번에 반영</button></div>` : '';
  const sum = `<div class="eq-sum"><div class="kpis">${k('기본 장비 원가', `+${money(T.stdCost)}`)}${k(`기준가 변화${ib('term:기준가')}`, `+${money(T.stdValue)}`)}${k(`선택 사양 대당 이익${ib('term:선택 사양')}`, `+${money(T.optProfitPerCar)}`)}</div>
    ${miss}${T.bonus > 0 ? `<p class="hint eq-bonus">아직 드문 장비를 넣어 평론·판매에 가점이 있습니다.</p>` : ''}
    <div class="row eq-btns"><button class="btn ink" data-act="eqRec" data-t="${t}">추천 구성으로</button><button class="btn" data-act="eqNone" data-t="${t}">모두 빼기</button>${mode ? `<span class="hint eq-mode">${esc(mode)}</span>` : ''}</div></div>`;
  return `<div class="equip">${chg}${sum}<div class="eq-list">${items.map(row).join('')}</div>
    <p class="note">기본 장비${ib('term:기본 장비')}는 모든 차에 넣어 원가와 기준가가 함께 오릅니다. 선택 사양${ib('term:선택 사양')}은 원하는 손님만 돈을 더 내고 고릅니다(선택률${ib('term:선택률')}). 시대의 기대${ib('term:시대의 기대')}에 맞는 장비가 빠지면 감점, 아직 드문 장비는 가점입니다. 장비 수에는 제한이 없습니다.${equipLive() ? '' : ' (규칙 연결 전: 효과는 어림값입니다)'}</p></div>`;
}
const k = (label: string, v: string) => `<div class="kpi"><small>${label}</small><b>${v}</b></div>`;
