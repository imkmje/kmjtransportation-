// 1.1.0 장비 고르기(기획·페이스리프트·풀체인지 공통): 장비마다 안 넣음 / 선택 사양 / 기본 장비, 시대의 기대, 추천 구성.
// 규칙은 sim(Q.equipInfo·recommendedEquip·equipChanges)이 정한다.
import { OPTIONS } from '../data';
import * as Q from '../sim/queries';
import type { CarState } from '../sim/types';
import { esc, josa, money, num } from './fmt';

export type EquipLevel = 'opt' | 'std';
export type Equip = Record<string, EquipLevel>;
export interface EquipItem {
  id: string; name: string; info: string; available: boolean; whyNot: string | null; required: boolean;
  expectation: 'rare' | 'common' | 'expected'; expectText: string; cost: number; value: number; optPrice: number; takeRate: number;
  level: EquipLevel | null; effect: { std: string; opt: string };
}
export interface EquipInfo { items: EquipItem[]; totals: { stdCost: number; stdValue: number; optProfitPerCar: number; basePrice: number; missingExpected: string[]; penalty: number; bonus: number; legacy?: boolean; legacyText?: string } } // legacy: 옛 저장(형식 4)의 출시된 판(감점·가점 없음)
export interface EquipChange { id: string; name: string; from: EquipLevel | null; to: EquipLevel | null; reason: string }
export interface EquipSpec { body: string; segment: string; powertrain: string; equip: Equip; [k: string]: unknown }

/** 옛 옵션 목록 → 장비 구성(모두 기본 장비). 옛 저장·프리셋 읽기용 */
export const fromOptions = (opts: readonly string[]): Equip => Object.fromEntries(opts.map((o) => [o, 'std' as const]));
/** 장비 구성 → sim의 options(기본 장비 목록, sim의 syncOptions와 같게). 선택 사양은 equip으로 함께 넘긴다 */
export const toOptions = (e: Equip): string[] => OPTIONS.filter((o) => e[o.id] === 'std').map((o) => o.id);
export const equipInfo = (s: CarState, spec: EquipSpec, year?: number): EquipInfo => Q.equipInfo(s, spec, year) as EquipInfo;
export const recommendedEquip = (s: CarState, body: string, segment: string, powertrain: string, year?: number): Equip => Q.recommendedEquip(s, body, segment, powertrain, year);
export const equipChanges = (s: CarState, prev: Equip, body: string, segment: string, year?: number): EquipChange[] => Q.equipChanges(s, prev, body, segment, year);

/** 장비 한 줄 요약: "기본: 라디오·에어컨 / 선택: 가죽 시트" */
export function equipLine(e: Equip): string {
  const n = (lv: EquipLevel) => OPTIONS.filter((o) => e[o.id] === lv).map((o) => o.name).join('·');
  const std = n('std'), opt = n('opt');
  return std || opt ? `${std ? `기본: ${std}` : ''}${std && opt ? ' / ' : ''}${opt ? `선택: ${opt}` : ''}` : '장비 없음';
}
const LV: [EquipLevel | '', string][] = [['', '안 넣음'], ['opt', '선택 사양'], ['std', '기본 장비']];
const EX_ORDER = { expected: 0, common: 1, rare: 2 } as const;
/** 장비 고르기 칸. t: 'plan' | 'lift'(어느 초안을 고치는지), changes: 풀체인지·페이스리프트의 '전작 이후 기대가 바뀐 장비', ib: ⓘ 버튼 */
export function equipPicker(s: CarState, spec: EquipSpec, t: 'plan' | 'lift' | 'proj', ib: (k: string, label?: string) => string, changes: EquipChange[] = [], mode = ''): string {
  const info = equipInfo(s, spec), T = info.totals;
  const items = [...info.items].sort((a, b) => Number(b.available) - Number(a.available) || EX_ORDER[a.expectation] - EX_ORDER[b.expectation] || a.name.localeCompare(b.name, 'ko'));
  const row = (x: EquipItem) => {
    const badge = `<span class="eq-x ex-${x.expectation}">${esc(x.expectText)}</span>`, lv = x.level ?? '';
    const seg = x.required ? `<span class="eq-lock">기본 장비 · 규제 의무로 고정</span>` : !x.available ? `<span class="eq-lock off">${esc(x.whyNot ?? '쓸 수 없습니다')}</span>`
      : `<div class="seg eq-seg" role="group" aria-label="${esc(x.name)}">${LV.map(([k, l]) => `<button data-act="eqSet" data-t="${t}" data-k="${x.id}" data-v="${k}" aria-pressed="${lv === k}">${l}</button>`).join('')}</div>`;
    const stdT = `원가 +${num(x.cost)}만원 · 기준가 +${num(x.value)}만원${x.effect.std ? ` · ${x.effect.std}` : ''}`;
    const optT = `손님의 약 ${Math.round(x.takeRate * 100)}%가 선택 · 추가 요금 ${num(x.optPrice)}만원 · 대당 이익 ${x.optPrice >= x.cost ? '+' : '−'}${num(Math.abs(x.takeRate * (x.optPrice - x.cost)))}만원${x.effect.opt ? ` · ${x.effect.opt}` : ''}`;
    const eff = x.level === 'std' || x.required ? stdT : x.level === 'opt' ? optT : `기본 장비면 ${stdT}`;
    return `<div class="eq-row${x.available ? '' : ' off'}${x.required ? ' req' : ''}" data-eq="${x.id}"><div class="eq-h"><b>${esc(x.name)}</b>${ib(`opt:${x.id}`, x.name)}${badge}</div>${seg}<p class="eq-eff">${esc(eff)}</p></div>`;
  };
  const miss = T.missingExpected.length ? `<div class="warnbox eq-miss">이 차급에서 기대되는 ${esc(T.missingExpected.join('·'))}${josa(T.missingExpected.join('·'), '이/가')} 없습니다 — 판매와 평론이 깎입니다.</div>` : '';
  const chg = changes.length ? `<div class="okbox eq-chg"><b>전작 이후 기대가 바뀐 장비 ${changes.length}개</b><ul>${changes.map((c) => `<li>${esc(c.name)}: ${c.from ? LV.find(([k]) => k === c.from)![1] : '안 넣음'} → ${c.to ? LV.find(([k]) => k === c.to)![1] : '안 넣음'} <small>${esc(c.reason)}</small></li>`).join('')}</ul><button class="btn" data-act="eqApply" data-t="${t}">한 번에 반영</button></div>` : '';
  const sum = `<div class="eq-sum"><div class="kpis">${k('기본 장비 원가', `+${money(T.stdCost)}`)}${k(`기준가 변화${ib('term:기준가')}`, `+${money(T.stdValue)}`)}${k(`선택 사양 대당 이익${ib('term:선택 사양')}`, `+${money(T.optProfitPerCar)}`)}</div>
    ${miss}${T.bonus > 0 ? `<p class="hint eq-bonus">아직 드문 장비를 넣어 평론·판매에 가점이 있습니다.</p>` : ''}
    <div class="row eq-btns"><button class="btn ink" data-act="eqRec" data-t="${t}">추천 구성으로</button><button class="btn" data-act="eqNone" data-t="${t}">모두 빼기</button>${mode ? `<span class="hint eq-mode">${esc(mode)}</span>` : ''}</div></div>`;
  return `<div class="equip">${chg}${sum}<div class="eq-list">${items.map(row).join('')}</div>
    <p class="note">기본 장비${ib('term:기본 장비')}는 모든 차에 넣어 원가와 기준가가 함께 오릅니다. 선택 사양${ib('term:선택 사양')}은 원하는 손님만 돈을 더 내고 고릅니다(선택률${ib('term:선택률')}). 시대의 기대${ib('term:시대의 기대')}에 맞는 장비가 빠지면 감점, 아직 드문 장비는 가점입니다. 장비 수에는 제한이 없습니다.</p></div>`;
}
const k = (label: string, v: string) => `<div class="kpi"><small>${label}</small><b>${v}</b></div>`;
