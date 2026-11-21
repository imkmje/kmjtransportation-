// 외관 고르기 화면 조각(0.13.0): 후보 6개(2×3) + [다른 후보 보기] + 직접 고르기 + 전작과 나란히 비교.
// 모양은 여전히 시드 두 개(chassisSeed·faceSeed)로만 정해진다. 후보·탐색은 render/pick.ts(순수 함수).
import './lookpick.css';
import type { CarLook } from '../render/look';
import { describeLook } from '../render/variant';
import {
  CHASSIS_PARTS, FACE_PARTS, PART_NAME, chassisCandidates, chassisChange, chassisChoices, faceCandidates, faceChange, faceChoices, faceParts, chassisParts, findSeed, type Want,
} from '../render/pick';

type Kind = 'face' | 'chassis';
type Thumb = (l: CarLook, yaw?: number, w?: number, h?: number) => string;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const SIDE = 0, FRONT = -Math.PI / 2, FRONT34 = -1.25;

/** 화면 상태(쪽 번호·직접 고르기 조건). 기획 대상(key)이 바뀌면 처음으로 */
const st = { key: '', page: { face: 0, chassis: 0 }, want: { face: {} as Want, chassis: {} as Want }, miss: { face: '', chassis: '' }, open: { face: false, chassis: false } };
export function lookKey(key: string): void { if (st.key !== key) Object.assign(st, { key, page: { face: 0, chassis: 0 }, want: { face: {}, chassis: {} }, miss: { face: '', chassis: '' }, open: { face: false, chassis: false } }); }

/** 후보 계산에 쓰는 것: 기준 모양(고르는 중인 차), 시드 줄의 시작(sim의 lookCandidates 첫 값), 피할 모양(지금 얼굴·전작) */
export interface LookCtx { base: CarLook; s0: number; avoid: CarLook[] }

export function candidates(kind: Kind, c: LookCtx): number[] {
  return kind === 'face' ? faceCandidates(c.base, c.s0, st.page.face, c.avoid) : chassisCandidates(c.base, c.s0, st.page.chassis, c.avoid);
}
/** 전작(지금 모습)과 새 모양의 기본값: 전작과 충분히 다른 첫 후보 */
export function firstDistinct(kind: Kind, c: LookCtx): number { return (kind === 'face' ? faceCandidates(c.base, c.s0, 0, c.avoid, 1) : chassisCandidates(c.base, c.s0, 0, c.avoid, 1))[0] ?? c.s0; }

/** 후보 6개 묶음. act·seedKey는 그 화면의 고르기 버튼(기획 'pick', 페이스리프트 'liftPick') */
export function candHtml(kind: Kind, c: LookCtx, cur: number, thumb: Thumb, act: string, cls = 'look'): string {
  const seeds = candidates(kind, c), seedKey = kind === 'face' ? 'faceSeed' : 'chassisSeed', yaw = kind === 'face' ? FRONT34 : SIDE;
  const tile = (s: number, label: string) => { const l = { ...c.base, [seedKey]: s }, d = describeLook(l); return `<button class="opt ${cls}" data-act="${act}" data-k="${seedKey}" data-v="${s}" aria-pressed="${cur === s}">${thumb(l, yaw, 200, 124)}<b>${label}</b><small>${esc(kind === 'face' ? d.face : d.chassis)}</small></button>`; };
  const inList = seeds.includes(cur);
  return `<div class="looks6">${seeds.map((s, i) => tile(s, `${kind === 'face' ? '얼굴' : '옆모습'} ${st.page[kind] * 6 + i + 1}`)).join('')}</div>
    <div class="look-more">${!inList ? `<span class="look-cur">고른 모양은 이 묶음 밖에 있습니다(직접 고르기 또는 앞 묶음)</span>` : ''}${st.page[kind] ? `<button class="btn" data-act="lookPage" data-t="${kind}" data-v="first">처음 후보</button>` : ''}<button class="btn" data-act="lookPage" data-t="${kind}" data-v="next">다른 후보 보기 ↻</button></div>
    ${pickerHtml(kind, c, cur)}`;
}

/** 직접 고르기: 부품별 칩. 이 시대·차체에서 나올 수 없는 부품은 흐리게 */
function pickerHtml(kind: Kind, c: LookCtx, cur: number): string {
  const l = { ...c.base, [kind === 'face' ? 'faceSeed' : 'chassisSeed']: cur }, now = (kind === 'face' ? faceParts(l) : chassisParts(l)) as unknown as Record<string, unknown>;
  const ch = (kind === 'face' ? faceChoices(c.base) : chassisChoices(c.base)) as Record<string, { v: string; label: string; ok: boolean }[]>, keys = kind === 'face' ? FACE_PARTS : CHASSIS_PARTS, want = st.want[kind] as Record<string, string | undefined>;
  const rows = keys.map((k) => `<div class="pick-row"><span class="pick-k">${PART_NAME[k]}</span><div class="pick-chips">
    <button class="lchip" data-act="lookWant" data-t="${kind}" data-k="${k}" data-v="" aria-pressed="${want[k] == null}">상관없음</button>
    ${ch[k].map((o) => `<button class="lchip${String(now[k]) === o.v ? ' now' : ''}" data-act="lookWant" data-t="${kind}" data-k="${k}" data-v="${o.v}" aria-pressed="${want[k] === o.v}" ${o.ok ? '' : 'disabled title="이 시대·차체에서는 고를 수 없습니다"'}>${esc(o.label)}</button>`).join('')}</div></div>`).join('');
  return `<details class="lpick" data-t="${kind}" ${st.open[kind] ? 'open' : ''}><summary>직접 고르기 · ${kind === 'face' ? '얼굴 부품' : '옆모습·장식'}</summary>${rows}
    <p class="note pick-miss">${st.miss[kind] ? esc(st.miss[kind]) : '부품을 고르면 조건에 맞는 모양을 찾아 바로 보여 줍니다. 밑줄은 지금 모양의 부품입니다.'}</p></details>`;
}

/** 직접 고르기 칩을 눌렀을 때: 조건을 갱신하고 맞는 시드를 찾는다(못 찾으면 가장 가까운 것과 못 맞춘 부품) */
export function onWant(kind: Kind, k: string, v: string, c: LookCtx): number {
  const w = st.want[kind] as Record<string, string | undefined>;
  if (v) w[k] = v; else delete w[k];
  st.open[kind] = true;
  if (!Object.keys(w).length) { st.miss[kind] = ''; return candidates(kind, c)[0] ?? c.s0; }
  const r = findSeed(kind, c.base, c.s0, w);
  st.miss[kind] = r.miss.length ? `모든 조건을 함께 만족하는 모양이 없어 가장 가까운 것을 골랐습니다. 맞추지 못한 부품: ${r.miss.join(', ')}` : '조건에 맞는 모양을 찾았습니다.';
  return r.seed;
}
export function onPage(kind: Kind, v: string): void { st.page[kind] = v === 'first' ? 0 : st.page[kind] + 1; }
export function onToggle(kind: Kind, open: boolean): void { st.open[kind] = open; }

/** 전작(지금)과 새 모양을 같은 각도로 나란히, 달라진 부품 한 줄 */
export function compareHtml(before: CarLook, after: CarLook, thumb: Thumb, withChassis: boolean, labels: [string, string] = ['지금', '새 모양']): string {
  const views: [number, string][] = withChassis ? [[FRONT, '정면'], [SIDE, '옆']] : [[FRONT, '정면'], [FRONT34, '앞 3/4']];
  const col = (l: CarLook, t: string) => `<div class="cmp-col"><b>${t}</b>${views.map(([y]) => thumb(l, y, 200, 124)).join('')}</div>`;
  return `<div class="look-cmp">${col(before, labels[0])}<span class="cmp-arrow" aria-hidden="true">→</span>${col(after, labels[1])}</div>
    <p class="look-diff"><b>달라진 점</b> ${esc(faceChange(before, after))}${withChassis ? ` · ${esc(chassisChange(before, after))}` : ''}</p>`;
}
// 직접 고르기를 펼치고 접은 상태를 다시 그려도 유지(toggle은 버블링하지 않아 캡처로 듣는다)
if (typeof document !== 'undefined') document.addEventListener('toggle', (e) => { const d = e.target; if (d instanceof HTMLDetailsElement && d.classList.contains("lpick")) onToggle(d.dataset.t as Kind, d.open); }, true);
