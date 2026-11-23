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

// ---------- 내 회사 로고(사용자가 꾸밈). 엠블럼 틀 + 안쪽 문양, 2색(바탕·금속색) + 절제된 금속 광택. 새로 그린 도형만 쓴다(실존 상표 모방 금지) ----------
// 키는 0.4.1 저장 파일과 같게 둔다(이름·그림만 다시). 0.4.2에 날개 배지·바퀴·왕관 추가
export const LOGO_SHAPES = { circle: '원형', shield: '방패', oval: '타원', round: '둥근 사각', hex: '육각', diamond: '마름모', pill: '가로 배지', square: '팔각', wings: '날개 배지' } as const;
export const LOGO_MARKS = { text: '이니셜', stripes: '사선', hbars: '가로선', vbars: '그릴', wing: '날개', star: '별빛', mountain: '봉우리', bolt: '번개', ring: '고리', arrow: '화살', wheel: '바퀴', crown: '왕관' } as const;
export const LOGO_BG = ['#14171c', '#1b2a4a', '#1f4fd1', '#7a1f2b', '#c8202f', '#1f5c4a', '#0f6b78', '#3a3f47', '#efeae0', '#ffffff'];
export const LOGO_FG = ['#c9ced6', '#ffffff', '#c9a54a', '#b07a4a', '#ff5a1f', '#c8202f', '#14171c', '#1f4fd1', '#9fd8ff', '#7ed39b'];
export type LogoShape = keyof typeof LOGO_SHAPES;
export type LogoMark = keyof typeof LOGO_MARKS;
/** border: 안쪽 가는 테두리(이중 테두리) */
export interface LogoSpec { shape: LogoShape; bg: string; fg: string; mark: LogoMark; text: string; border: boolean }
/** 예전 저장·새 게임의 기본 로고 */
export const DEFAULT_LOGO: LogoSpec = { shape: 'round', bg: '#14171c', fg: '#ff5a1f', mark: 'stripes', text: '', border: false };
/** 틀(64 격자). d: 바깥 테두리 선이 지나는 길, m: 문양 크기 배수, my: 문양 세로 위치 */
const FRAME: Record<LogoShape, { d: string; m: number; my?: number }> = {
  circle: { d: 'M32 4a28 28 0 1 1 0 56a28 28 0 1 1 0-56z', m: 1 },
  shield: { d: 'M32 4C40 7.5 48 8.5 56 8.5V30c0 14-10 23-24 30C18 53 8 44 8 30V8.5C16 8.5 24 7.5 32 4z', m: 0.92, my: 29 },
  oval: { d: 'M32 12c16 0 28 9 28 20S48 52 32 52S4 43 4 32S16 12 32 12z', m: 0.78 },
  round: { d: 'M18 5h28a13 13 0 0 1 13 13v28a13 13 0 0 1-13 13H18A13 13 0 0 1 5 46V18A13 13 0 0 1 18 5z', m: 1 },
  hex: { d: 'M32 3.5l24.7 14.25v28.5L32 60.5L7.3 46.25v-28.5z', m: 0.94 },
  diamond: { d: 'M32 3l29 29l-29 29L3 32z', m: 0.72 },
  pill: { d: 'M20 15h24a17 17 0 0 1 0 34H20a17 17 0 0 1 0-34z', m: 0.74 },
  square: { d: 'M21 5h22l16 16v22L43 59H21L5 43V21z', m: 0.96 },
  wings: { d: 'M32 11a21 21 0 1 1 0 42a21 21 0 1 1 0-42z', m: 0.74 },
};
// 날개 배지의 양옆 날개(가는 깃 세 줄씩)
const WINGS = 'M14 24.5C9 24 4.5 23 1.5 21c1.8 3.6 6 5.8 12 6.4zM13.6 30.6C8.7 30.3 4.6 29.4 2 27.8c1.6 3.2 5.5 5 11 5.3zM14 36.5c-4 .1-7.4-.5-10-1.8c1.7 2.8 5 4.3 9.6 4.4zM50 24.5c5-.5 9.5-1.5 12.5-3.5c-1.8 3.6-6 5.8-12 6.4zM50.4 30.6c4.9-.3 9-1.2 11.6-2.8c-1.6 3.2-5.5 5-11 5.3zM50 36.5c4 .1 7.4-.5 10-1.8c-1.7 2.8-5 4.3-9.6 4.4z';
/** 안쪽 문양(64 격자, 가운데 32·32, 지름 약 28 안) */
const MARK: Record<Exclude<LogoMark, 'text'>, (c: string) => string> = {
  stripes: (c) => `<path d="M20.5 41h17l3.5-4.6h-17zM23.8 34.3h20l3.5-4.6h-20zM27 27.6h17l3.5-4.6h-17z" fill="${c}"/>`,
  hbars: (c) => `<path d="M17 24.6h30v3.2H17zM20 30.4h24v3.2H20zM23 36.2h18v3.2H23z" fill="${c}"/>`,
  vbars: (c) => `<path d="M21 21h3.4v22H21zM27.6 19h3.4v26h-3.4zM33 19h3.4v26H33zM39.6 21H43v22h-3.4z" fill="${c}"/>`,
  wing: (c) => `<path d="M30.5 40.5L13 27.5l4.6-.6l12.9 9.4zM30.5 34.8L18 25.4l4.4-.5l8.1 6zM30.5 29.4l-7.4-5.7l4.2-.5l3.2 2.4zM33.5 40.5L51 27.5l-4.6-.6l-12.9 9.4zM33.5 34.8L46 25.4l-4.4-.5l-8.1 6zM33.5 29.4l7.4-5.7l-4.2-.5l-3.2 2.4z" fill="${c}"/><circle cx="32" cy="42.5" r="2.6" fill="${c}"/>`,
  star: (c) => `<path d="M32 16.5l3.3 12.2L47.5 32l-12.2 3.3L32 47.5l-3.3-12.2L16.5 32l12.2-3.3z" fill="${c}"/><circle cx="32" cy="32" r="2.2" fill="${c}"/>`,
  mountain: (c) => `<path d="M16 42l11-16l5.2 7.2L38 25l10 17zM27 31.8l-4.6 6.6h8.4zM38 31.2l-4.2 5.8l1 1.4h8.4z" fill="${c}" fill-rule="evenodd"/>`,
  bolt: (c) => `<path d="M35.5 16L22 34.5h8.2L27 48l15-19.5h-8.4z" fill="${c}"/>`,
  ring: (c) => `<circle cx="32" cy="32" r="11.5" fill="none" stroke="${c}" stroke-width="3.6"/><circle cx="32" cy="32" r="4" fill="${c}"/>`,
  arrow: (c) => `<path d="M32 17L47 37.5h-6.6L32 25.6L23.6 37.5H17z" fill="${c}"/><path d="M23 42h18v3.4H23z" fill="${c}"/>`,
  wheel: (c) => `<circle cx="32" cy="32" r="12.8" fill="none" stroke="${c}" stroke-width="3.2"/><circle cx="32" cy="32" r="3.4" fill="${c}"/><path d="M32 22v6.6M32 35.4V42M23.3 27l5.7 3.3M35 33.7l5.7 3.3M23.3 37l5.7-3.3M35 30.3l5.7-3.3" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`,
  crown: (c) => `<path d="M18 40l-2-15l8.5 6.5L32 20l7.5 11.5L48 25l-2 15z" fill="${c}"/><path d="M18 43h28v3H18z" fill="${c}"/>`,
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
/** 금속 광택(색과 무관한 흰·검 반투명 그라데이션)을 문서에 한 번만 둔다. 로고마다 id를 만들면 같은 로고가 여러 곳에 있을 때 겹치거나 숨은 칸의 것을 가리킨다 */
function ensureSheen(): void {
  if (typeof document === 'undefined' || document.getElementById('clg-defs')) return;
  const box = document.createElement('div');
  box.id = 'clg-defs'; box.setAttribute('aria-hidden', 'true'); box.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  box.innerHTML = '<svg width="0" height="0"><defs><linearGradient id="clg-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".48" stop-color="#fff" stop-opacity=".04"/><stop offset=".52" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>'
    + '<linearGradient id="clg-metal" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-color="#000" stop-opacity=".12"/><stop offset=".8" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs></svg>';
  document.body.append(box);
}
const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
/** 내 회사 로고 SVG(상단바·타이틀·신문·사무실·기록 공용). 36px 미만이면 가는 선을 빼고 테두리를 굵게(작게 봐도 뭉개지지 않게) */
export function logoSvg(spec: LogoSpec, size = 26): string {
  ensureSheen();
  const L = cleanLogo(spec), F = FRAME[L.shape], small = size < 36, my = F.my ?? 32;
  const rim = small ? 4.6 : 3.4, k = F.m * (small ? 1.06 : 1);
  // 바탕과 금속색이 너무 비슷하면(밝은 바탕에 은색 등) 테두리 바깥에 옅은 선을 둘러 모양이 보이게
  const edge = Math.abs(lum(L.bg) - lum(L.fg)) < 0.18 || lum(L.bg) > 0.85 ? `<path d="${F.d}" fill="none" stroke="#14171c" stroke-opacity=".28" stroke-width="${rim + 1.6}" stroke-linejoin="round"/>` : '';
  const wings = L.shape === 'wings' ? `<path d="${WINGS}" fill="${L.fg}"/><path d="${WINGS}" fill="url(#clg-metal)"/>` : '';
  const inner = L.border && !small ? `<path d="${F.d}" fill="none" stroke="${L.fg}" stroke-width="${1.1 / 0.84}" stroke-opacity=".85" transform="translate(32 ${my}) scale(.84) translate(-32 -${my})"/>` : '';
  const t = [...L.text], fs = t.length > 1 ? 21 : 29;
  const glyph = L.mark === 'text'
    ? (t.length ? `<text x="32" y="32" dy=".35em" text-anchor="middle" font-size="${fs}" font-weight="800" letter-spacing="${t.length > 1 ? -0.6 : 0}" fill="${L.fg}" stroke="${L.fg}" stroke-width=".7" font-family="'Pretendard','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',system-ui,sans-serif">${esc(t.join(''))}</text>` : '')
    : MARK[L.mark](L.fg);
  const mark = glyph ? `<g transform="translate(32 ${my}) scale(${k.toFixed(3)}) translate(-32 -32)">${glyph}<g style="mix-blend-mode:normal" opacity=".9">${glyph.replace(/fill="#[0-9a-fA-F]{6}"/g, 'fill="url(#clg-metal)"').replace(/stroke="#[0-9a-fA-F]{6}"/g, 'stroke="url(#clg-metal)"')}</g></g>` : '';
  return `<svg class="clogo" data-shape="${L.shape}" data-mark="${L.mark}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" style="display:block;flex:none">`
    + `${wings}${edge}<path d="${F.d}" fill="${L.bg}" stroke="${L.fg}" stroke-width="${rim}" stroke-linejoin="round"/>`
    + `<path d="${F.d}" fill="none" stroke="url(#clg-metal)" stroke-width="${rim}" stroke-linejoin="round"/>${inner}${mark}`
    + `<path d="${F.d}" fill="url(#clg-sheen)"/></svg>`;
}

/** sim 차 값 → 3D 모양. 렌더에 없는 차체는 중형 세단 모양으로 대신한다. year는 출시(기획) 연도 */
export function lookOf(v: { body: string; powertrain: string; tier: number; color: string; wheels: 0 | 1 | 2; year: number; chassisSeed?: number; faceSeed?: number; variant?: string }): CarLook {
  if (v.variant === 'coupe') v = { ...v, body: 'coupe' }; // 1.3.0 파생 모델 표시: 쿠페판은 쿠페 차체로, 고성능판은 스포일러·큰 휠·낮은 차고, 왜건은 긴 지붕
  const gt = v.variant === 'gt', pt = v.powertrain === 'gasoline' ? 'gas' : v.powertrain === 'electric' ? 'ev' : v.powertrain;
  return {
    bodyId: (v.body in BODY ? v.body : 'sedanM') as BodyId,
    powertrain: (['gas', 'diesel', 'hybrid', 'ev'].includes(pt) ? pt : 'gas') as CarLook['powertrain'],
    color: v.color, wheel: gt ? 2 : v.wheels, sporty: gt || v.tier >= 3, ...(gt || v.variant === 'wagon' || v.variant === 'ev' ? { variant: v.variant as 'wagon' | 'gt' | 'ev' } : {}),
    era: v.year as CarLook['era'], // 연도를 그대로 넘기면 render(eraOf)가 4시대로 나눈다
    chassisSeed: v.chassisSeed, faceSeed: v.faceSeed,
  };
}

/** 원형 점수 고리(데모 예상 평점) */
export const ring = (v: number, max = 10): string =>
  `<svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="21" fill="none" stroke="#d8dde4" stroke-width="6"/><circle cx="26" cy="26" r="21" fill="none" stroke="#14171c" stroke-width="6" stroke-linecap="round" stroke-dasharray="132" stroke-dashoffset="${(132 * (1 - Math.max(0, Math.min(1, v / max)))).toFixed(1)}" transform="rotate(-90 26 26)" style="transition:stroke-dashoffset .5s"/></svg>`;
