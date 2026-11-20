// 그림 재료: 가짜 로고(데모 logo()), 차 색 8가지(데모 PAINT), sim 값 → 렌더 CarLook 변환
import type { BodyId, CarLook } from '../render/look';
import { BODY } from '../render/shapes';

export const PAINT: [string, string][] = [['카민 레드', '#c8202f'], ['선셋 오렌지', '#f26a1b'], ['포레스트', '#1f5c4a'], ['코발트', '#1f4fd1'], ['펄 화이트', '#eef0f2'], ['그래파이트', '#3a3f47'], ['미드나잇', '#14213d'], ['샴페인', '#c9b38a']];
export const paintName = (hex: string): string => PAINT.find((p) => p[1] === hex)?.[0] ?? '사용자 색';
export const WHEELS = [{ name: '작은 휠', sub: '단정함' }, { name: '보통 휠', sub: '기본' }, { name: '큰 휠', sub: '멋스러움' }];

const LOGO: Record<string, string> = {
  me: '<rect x="2" y="2" width="28" height="28" rx="9" fill="#14171c"/><path d="M8 21h13M11 16h14M14 11h11" stroke="#ff5a1f" stroke-width="3" stroke-linecap="round"/>',
  toyotto: '<ellipse cx="16" cy="16" rx="14" ry="9.5" fill="none" stroke="#c0392b" stroke-width="2.5"/><ellipse cx="16" cy="16" rx="6" ry="9.5" fill="none" stroke="#c0392b" stroke-width="2.5"/>',
  hyundoy: '<rect x="5" y="5" width="22" height="22" rx="4" transform="rotate(45 16 16)" fill="none" stroke="#1f4e9c" stroke-width="2.5"/><path d="M11 22l4-12M17 22l4-12M12.5 17h8" stroke="#1f4e9c" stroke-width="2.4" stroke-linecap="round"/>',
  bmv: '<circle cx="16" cy="16" r="13" fill="#fff" stroke="#555" stroke-width="2.5"/><path d="M16 16V4a12 12 0 0 1 12 12z" fill="#2a77c9"/><path d="M16 16v12A12 12 0 0 1 4 16z" fill="#2a77c9"/>',
  tesler: '<path d="M16 3l11 4v9c0 7-5 11-11 13C10 27 5 23 5 16V7z" fill="#fff" stroke="#d6252b" stroke-width="2.4"/><path d="M10 11h12M16 11v11" stroke="#d6252b" stroke-width="2.6" stroke-linecap="round"/>',
  forty: '<rect x="2" y="8" width="28" height="16" rx="8" fill="#1d3c8f"/><text x="16" y="20" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" font-family="sans-serif">40</text>',
  other: '<circle cx="16" cy="16" r="12" fill="none" stroke="#5b6470" stroke-width="2.5"/>',
};
// rivals.json의 id → 데모 로고 도형
const RIVAL_LOGO: Record<string, string> = { toyoda: 'toyotto', hyundae: 'hyundoy', porty: 'forty', bmv: 'bmv', tesler: 'tesler' };
export const logo = (key: string, z = 26): string =>
  `<svg width="${z}" height="${z}" viewBox="0 0 32 32" aria-hidden="true" style="display:block;flex:none">${LOGO[key] ?? LOGO[RIVAL_LOGO[key]] ?? LOGO.other}</svg>`;

/** sim 차 값 → 3D 모양. 렌더에 없는 차체는 중형 세단 모양으로 대신한다. year는 출시(기획) 연도 */
export function lookOf(v: { body: string; powertrain: string; tier: number; color: string; wheels: 0 | 1 | 2; year: number; chassisSeed?: number; faceSeed?: number }): CarLook {
  const pt = v.powertrain === 'gasoline' ? 'gas' : v.powertrain === 'electric' ? 'ev' : v.powertrain;
  return {
    bodyId: (v.body in BODY ? v.body : 'sedanM') as BodyId,
    powertrain: (['gas', 'diesel', 'hybrid', 'ev'].includes(pt) ? pt : 'gas') as CarLook['powertrain'],
    color: v.color, wheel: v.wheels, sporty: v.tier >= 3,
    era: v.year as CarLook['era'], // 연도를 그대로 넘기면 render(eraOf)가 4시대로 나눈다
    chassisSeed: v.chassisSeed, faceSeed: v.faceSeed,
  };
}

/** 원형 점수 고리(데모 예상 평점) */
export const ring = (v: number, max = 10): string =>
  `<svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="21" fill="none" stroke="#d8dde4" stroke-width="6"/><circle cx="26" cy="26" r="21" fill="none" stroke="#14171c" stroke-width="6" stroke-linecap="round" stroke-dasharray="132" stroke-dashoffset="${(132 * (1 - Math.max(0, Math.min(1, v / max)))).toFixed(1)}" transform="rotate(-90 26 26)" style="transition:stroke-dashoffset .5s"/></svg>`;
