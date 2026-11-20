// 그림 재료: 가짜 로고(데모 logo()), 차 색 8가지(데모 PAINT), sim 값 → 렌더 CarLook 변환
import type { BodyId, CarLook } from '../render/look';
import { BODY } from '../render/shapes';
import { esc } from './fmt';

export const PAINT: [string, string][] = [['카민 레드', '#c8202f'], ['선셋 오렌지', '#f26a1b'], ['포레스트', '#1f5c4a'], ['코발트', '#1f4fd1'], ['펄 화이트', '#eef0f2'], ['그래파이트', '#3a3f47'], ['미드나잇', '#14213d'], ['샴페인', '#c9b38a']];
export const paintName = (hex: string): string => PAINT.find((p) => p[1] === hex)?.[0] ?? '사용자 색';
export const WHEELS = [{ name: '작은 휠', sub: '단정함' }, { name: '보통 휠', sub: '기본' }, { name: '큰 휠', sub: '멋스러움' }];

const LOGO: Record<string, string> = {
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

// ---------- 내 회사 로고(사용자가 꾸밈). 새로 그린 단순 도형만 쓴다 ----------
export const LOGO_SHAPES = { round: '둥근 사각', circle: '원', shield: '방패', hex: '육각', oval: '타원', diamond: '마름모', pill: '알약', square: '사각' } as const;
export const LOGO_MARKS = { stripes: '사선 줄무늬', hbars: '가로 줄무늬', vbars: '세로 줄무늬', wing: '날개', star: '별', mountain: '산', bolt: '번개', ring: '고리', arrow: '화살표', text: '글자' } as const;
export const LOGO_BG = ['#14171c', '#1f4fd1', '#c8202f', '#1f5c4a', '#f26a1b', '#eef0f2', '#6b3fa0', '#c9b38a', '#0f7c8c', '#3a3f47'];
export const LOGO_FG = ['#ff5a1f', '#ffffff', '#f5c518', '#14171c', '#9fd8ff', '#c8202f', '#7ed39b', '#c0c6cf', '#ffb3c1', '#1f4fd1'];
export type LogoShape = keyof typeof LOGO_SHAPES;
export type LogoMark = keyof typeof LOGO_MARKS;
export interface LogoSpec { shape: LogoShape; bg: string; fg: string; mark: LogoMark; text: string; border: boolean }
/** 예전 저장·새 게임의 기본 로고(0.4.0까지 쓰던 모양) */
export const DEFAULT_LOGO: LogoSpec = { shape: 'round', bg: '#14171c', fg: '#ff5a1f', mark: 'stripes', text: '', border: false };
const SHAPE_D: Record<LogoShape, string> = {
  round: 'M11 2h10a9 9 0 0 1 9 9v10a9 9 0 0 1-9 9H11a9 9 0 0 1-9-9V11a9 9 0 0 1 9-9z',
  circle: 'M16 2a14 14 0 1 1 0 28a14 14 0 1 1 0-28z',
  shield: 'M16 2l12 4v9c0 8-5.5 12.5-12 15C9.5 27.5 4 23 4 15V6z',
  hex: 'M16 2l12.1 7v14L16 30L3.9 23V9z',
  oval: 'M16 6c8.3 0 15 4.5 15 10s-6.7 10-15 10S1 21.5 1 16S7.7 6 16 6z',
  diamond: 'M16 1l15 15l-15 15L1 16z',
  pill: 'M10 7h12a9 9 0 0 1 0 18H10a9 9 0 0 1 0-18z',
  square: 'M3 3h26v26H3z',
};
const MARK_SVG: Record<Exclude<LogoMark, 'text'>, (c: string) => string> = {
  stripes: (c) => `<path d="M8 21h13M11 16h14M14 11h11" stroke="${c}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  hbars: (c) => `<path d="M9 11h14M9 16h14M9 21h14" stroke="${c}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
  vbars: (c) => `<path d="M11 10v12M16 9v14M21 10v12" stroke="${c}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
  wing: (c) => `<path d="M16 21c-2-4-6-6-10-6c3 1 5 3 6 5zM16 21c2-4 6-6 10-6c-3 1-5 3-6 5zM16 22c-1.5-3-5-5-9-4.5c3 1 5 2.5 6 5zM16 22c1.5-3 5-5 9-4.5c-3 1-5 2.5-6 5z" fill="${c}"/><circle cx="16" cy="13" r="2.4" fill="${c}"/>`,
  star: (c) => `<path d="M16 7.5l2.5 5.3l5.7.7l-4.2 3.9l1.1 5.7L16 20.3l-5.1 2.8l1.1-5.7l-4.2-3.9l5.7-.7z" fill="${c}"/>`,
  mountain: (c) => `<path d="M6 22l6.5-10l3.5 5l3-4l7 9z" fill="${c}"/>`,
  bolt: (c) => `<path d="M18 6l-8 11h5l-2 9l8-11h-5z" fill="${c}"/>`,
  ring: (c) => `<circle cx="16" cy="16" r="6.5" fill="none" stroke="${c}" stroke-width="3"/><circle cx="16" cy="16" r="1.8" fill="${c}"/>`,
  arrow: (c) => `<path d="M8 20l8-9l8 9" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 23h8" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`,
};
/** 로고 값 검사(저장 파일·화면 입력). 틀린 칸은 기본값으로 */
export function cleanLogo(v: unknown): LogoSpec {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<LogoSpec>, hex = (x: unknown, d: string) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : d);
  return {
    shape: typeof o.shape === 'string' && o.shape in LOGO_SHAPES ? o.shape : DEFAULT_LOGO.shape,
    bg: hex(o.bg, DEFAULT_LOGO.bg), fg: hex(o.fg, DEFAULT_LOGO.fg),
    mark: typeof o.mark === 'string' && o.mark in LOGO_MARKS ? o.mark : DEFAULT_LOGO.mark,
    text: typeof o.text === 'string' ? [...o.text.trim()].slice(0, 2).join('') : '',
    border: o.border === true,
  };
}
/** 내 회사 로고 SVG(상단바·타이틀·신문·사무실·기록 공용) */
export function logoSvg(spec: LogoSpec, size = 26): string {
  const L = cleanLogo(spec), d = SHAPE_D[L.shape];
  const t = [...L.text], fs = t.length > 1 ? 11 : 15;
  const mark = L.mark === 'text' ? (t.length ? `<text x="16" y="16" dy=".36em" text-anchor="middle" font-size="${fs}" font-weight="800" fill="${L.fg}" font-family="system-ui,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">${esc(t.join(''))}</text>` : '') : MARK_SVG[L.mark](L.fg);
  const border = L.border ? `<path d="${d}" fill="none" stroke="${L.fg}" stroke-width="1.6" transform="translate(16 16) scale(.84) translate(-16 -16)"/>` : '';
  return `<svg class="clogo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" style="display:block;flex:none"><path d="${d}" fill="${L.bg}"/>${border}${mark}</svg>`;
}

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
