// 쿼터뷰 사무실(design.md 13.1). 2D SVG, 보여 주기 전용: sim을 import하지 않고 뷰 자료만 받는다.
// 실제 사무실 비율(1m = U 사용자 단위, 사람 키 1.7m). 상태는 표정 대신 자세로, 사람은 통로를 따라 걸어 다닌다.
// 난수는 연출에만 쓴다(직원 외모는 id 해시로 고정).
import './office.css';
import { roomFor, assignSeats, findPath, nearestFree, CAPACITY, ELITE_SEATS, DESK_H, type Face, type Furn, type Level, type Room, type Spot, type WallItem, type Zone } from './layout';
import { pickLine, type Mood } from './lines';

export type Role = 'designer' | 'engineer' | 'tester' | 'sales';
export interface OfficeStaff { id: string; name: string; role: Role; condition: number /*0~1, 낮으면 지침*/; working: boolean /*프로젝트에 배치됨*/; elite?: boolean /*4.1.0 직속 전담팀원(금색 자리)*/ }
export interface OfficeView {
  level: Level;
  staff: OfficeStaff[];
  phase: 'rest' | 'design' | 'test';
  budget: 'low' | 'normal' | 'high';
  projectName?: string;
  carSvg?: string;      // 우리 코드가 만든 옆모습 SVG(silhouetteSvg). 그대로 끼워 넣으므로 외부 입력을 넣지 말 것
  progress?: number;
  defects?: number;
  logo?: string;        // 내 회사 로고 SVG(art.ts logoSvg가 만든 것). 표지판·로비 벽에 끼워 넣는다
  year?: number;        // 지금 연도: 책상 집기(제도판·타자기 → CRT → 모니터·태블릿)
  execs?: { id: string; name: string; title: string }[]; // 임명된 임원(창가 임원실, 직함 문패)
}
export type Stat = '성능' | '연비' | '실용' | '디자인' | '품질';
export type OfficeEvent =
  | { kind: 'score'; staffId: string; stat: Stat; amount: number }
  | { kind: 'defectFound'; staffId?: string }
  | { kind: 'defectFixed'; staffId?: string }
  // mood: 출시 직후·혹평 뒤·명차 뒤처럼 장면이 모르는 상황의 대사를 고를 때(없으면 지금 상황으로)
  | { kind: 'say'; staffId?: string; text?: string; mood?: Mood };
export interface Office {
  update(view: OfficeView): void;
  emit(events: OfficeEvent[]): void;
  setActive(on: boolean): void;
  dispose(): void;
}

// ---------- 그림 상수(차분한 색) ----------
const U = 34;
const ROLE: Record<Role, { shirt: string; job: string; order: number }> = {
  designer: { shirt: '#c48f98', job: '디자이너', order: 0 },
  engineer: { shirt: '#6f8db8', job: '엔지니어', order: 1 },
  tester: { shirt: '#7fa38a', job: '테스터', order: 2 },
  sales: { shirt: '#c6a46e', job: '영업', order: 3 },
};
const STAT_COL: Record<Stat, string> = { 성능: '#a8593a', 연비: '#4f8a64', 실용: '#4a8191', 디자인: '#a5566f', 품질: '#6a5f9c' };
const HAIR = ['#2b2826', '#3d3029', '#5a4334', '#6e5a48', '#2f3236', '#8a7560'];
const SKIN = ['#e9c7ab', '#ddb393', '#c99b78'];
const PANTS = ['#3f4652', '#4b4f57', '#5b5446', '#33405a'];

const f = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const P = (x: number, y: number, z = 0): [number, number] => [f((x - y) * U), f(((x + y) * U) / 2 - z * U)];
const pts = (a: [number, number][]) => a.map((p) => p.join(',')).join(' ');
const poly = (a: [number, number][], fill: string, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" ${extra}/>`;
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * (1 - k)))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
/** 상자: 보이는 세 면(윗면, +y면, +x면). 색 하나로 명암을 낸다 */
const box = (x: number, y: number, z: number, w: number, d: number, h: number, col: string, extra = '') =>
  poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], shade(col, 0.1), extra) +
  poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], shade(col, 0.2), extra) +
  poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], col, extra);
const top = (x: number, y: number, z: number, w: number, d: number, col: string, extra = '') => poly([P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)], col, extra);

const mix = (a: string, b: string, t: number) => { const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
interface Look { hair: string; skin: string; pants: string; style: number; glasses: boolean; v: number }
const lookOf = (id: string): Look => {
  const h = hash(id);
  return { hair: HAIR[h % HAIR.length], skin: SKIN[(h >>> 4) % SKIN.length], pants: PANTS[(h >>> 7) % PANTS.length], style: (h >>> 10) % 3, glasses: (h >>> 13) % 4 === 0, v: (h >>> 16) % 2 };
};

// ---------- 사람(오른쪽을 보는 기본형, 원점=엉덩이, 키 1.7m) ----------
function personSvg(role: Role, lk: Look, shirt?: string): string {
  const sh = shirt ?? ROLE[role].shirt, dk = shade(sh, 0.18), pn = lk.pants;
  const arm = (cls: string, x: number, col: string) => `<g transform="translate(${x},-15.5)"><g class="arm ${cls}">
    <path d="M0,0 L0,14.5" stroke="${col}" stroke-width="2.8" stroke-linecap="round"/><circle cy="15.4" r="1.25" fill="${lk.skin}"/>
    ${cls === 'armN' ? `<rect class="cup" x="-1.4" y="14.2" width="2.8" height="3.2" rx=".6" fill="#f4f1ec" stroke="#9aa3ae" stroke-width=".4"/><rect class="clip" x="-3" y="11.5" width="6" height="7.5" rx=".8" fill="#e8dcc2" stroke="#9a8f78" stroke-width=".5"/>` : ''}</g></g>`;
  const legStand = (cls: string, x: number) => `<g transform="translate(${x},0)"><g class="leg ${cls}"><path d="M0,0 L0,29.5" stroke="${pn}" stroke-width="3.2" stroke-linecap="round"/><path d="M-.6,30.4 h3" stroke="#2a2a2a" stroke-width="1.8" stroke-linecap="round"/></g></g>`;
  const hairBack = lk.style === 1 ? `<path d="M-4.6,-23 Q-4.8,-16.5 -1.5,-16.8 L-1.5,-22 Z" fill="${lk.hair}"/>` : lk.style === 2 ? `<circle cx="-3.4" cy="-26.4" r="1.8" fill="${lk.hair}"/>` : '';
  const headF = `<g class="hf">${hairBack}<circle cx="0" cy="-22.6" r="4.2" fill="${lk.hair}"/><circle cx=".7" cy="-22.1" r="3.8" fill="${lk.skin}"/>
    <path d="M-4.1,-22.4 Q-3.6,-27.4 1,-26.8 Q4.6,-26.2 4.4,-23.4 Q2,-25 -1.4,-23.6 Z" fill="${lk.hair}"/>
    <circle cx="1.9" cy="-22" r=".42" fill="#3a3530"/><circle cx="3.7" cy="-22" r=".42" fill="#3a3530"/>
    ${lk.glasses ? `<path d="M1,-22 h1.8 M2.9,-22 h1.6" stroke="#3a3530" stroke-width=".45"/>` : ''}</g>`;
  const headB = `<g class="hb">${hairBack}<circle cx="0" cy="-22.6" r="4.2" fill="${lk.hair}"/><ellipse cx="3.6" cy="-22" rx=".9" ry="1.2" fill="${lk.skin}"/></g>`;
  return `<g class="lstand">${legStand('lgA', -1.6)}${legStand('lgB', 1.8)}</g>
   <g class="lsit"><path d="M-1,-.5 L10,5 L10,18" stroke="${pn}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M2,0 L12.5,5.2 L12.5,18.5" stroke="${shade(pn, -0.12)}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>
   <g class="torso">${arm('armF', -2.6, dk)}
    <path d="M-4.4,0 L-4.9,-14.6 Q-4.9,-17 -2.6,-17 L2.8,-17 Q5,-17 5,-14.6 L4.6,0 Z" fill="${sh}"/>
    <rect x="-4.5" y="-1.6" width="9.1" height="2.6" rx="1" fill="${pn}"/>
    <rect x="-.6" y="-19" width="2.4" height="2.6" fill="${lk.skin}"/>
    <g transform="translate(.6,-18.6)"><g class="hd"><g transform="translate(-.6,18.6)">${headF}${headB}</g></g></g>
    ${arm('armN', 2.9, sh)}</g>`;
}

// ---------- 가구 ----------
const DESK_TOP = '#d9c4a3', LEG = '#8d939b', CHAIR = '#4a505a', GLASS = '#bcd6e2';
function faceVec(face: Face): [number, number] { return face === '+x' ? [1, 0] : face === '-x' ? [-1, 0] : face === '+y' ? [0, 1] : [0, -1]; }

/** 시험차: 낮은 차체 + 앞뒤 유리가 기운 객실(상자 두 개로 보이지 않게). +x 쪽이 앞(앞 유리·전조등) */
function carBox(x: number, y: number, z: number, w: number, d: number, col: string, wheels = true): string {
  let s = '';
  const wz = wheels ? 0.3 : 0, zb = z + wz, hb = 0.5, zt = zb + hb, hc = 0.42, y0 = y + 0.14, y1 = y + d - 0.14;
  const xb0 = x + w * 0.24, xb1 = x + w * 0.74, xr0 = x + w * 0.34, xr1 = x + w * 0.63; // 객실 아래·지붕 앞뒤
  if (wheels) for (const [wx, wy] of [[x + w * 0.2, y + d], [x + w * 0.8, y + d]] as [number, number][]) { const [cx, cy] = P(wx, wy, z + 0.3); s += `<ellipse cx="${cx}" cy="${cy}" rx="10" ry="10.5" fill="#2a2d31"/><ellipse cx="${cx}" cy="${cy}" rx="4.5" ry="5" fill="#9aa1a8"/>`; }
  s = box(x, y, zb, w, d, hb, col) + s;
  s += poly([P(x + w, y + 0.2, zb + 0.32), P(x + w, y + 0.55, zb + 0.32), P(x + w, y + 0.55, zb + 0.42), P(x + w, y + 0.2, zb + 0.42)], '#f4efd8'); // 전조등
  s += poly([P(x + w, y + d - 0.55, zb + 0.32), P(x + w, y + d - 0.2, zb + 0.32), P(x + w, y + d - 0.2, zb + 0.42), P(x + w, y + d - 0.55, zb + 0.42)], '#f4efd8');
  s += poly([P(xb0, y1, zt), P(xb1, y1, zt), P(xr1, y1, zt + hc), P(xr0, y1, zt + hc)], shade(col, 0.12)); // 객실 옆
  s += poly([P(xb0 + 0.12, y1, zt + 0.05), P(xb1 - 0.12, y1, zt + 0.05), P(xr1 - 0.04, y1, zt + hc - 0.06), P(xr0 + 0.04, y1, zt + hc - 0.06)], '#8fa7b6', 'opacity=".95"'); // 옆 유리
  s += poly([P(xb1, y0, zt), P(xb1, y1, zt), P(xr1, y1, zt + hc), P(xr1, y0, zt + hc)], '#a4bac7'); // 앞 유리(기울어짐)
  s += poly([P(xr0, y0, zt + hc), P(xr1, y0, zt + hc), P(xr1, y1, zt + hc), P(xr0, y1, zt + hc)], shade(col, -0.06)); // 지붕
  return s;
}

function deskSvg(fu: Furn, role: Role | undefined, kit: Kit = 'lcd', top0 = DESK_TOP): string {
  const { x, y, w, d } = fu, h = DESK_H;
  let s = '';
  for (const [lx, ly] of [[x + 0.05, y + d - 0.08], [x + w - 0.1, y + d - 0.08], [x + w - 0.1, y + 0.03]] as [number, number][]) s += box(lx, ly, 0, 0.05, 0.05, h - 0.03, LEG);
  s += box(x, y, h - 0.03, w, d, 0.03, top0);
  // 화면은 칸막이 쪽에 두고 앉은 사람 쪽을 본다. 시대별: 70년대 제도판·타자기, 80년대 단말기, 90년대 CRT, 2000년대 두꺼운 LCD, 2015~ 얇은 모니터·태블릿
  const my = fu.face === '+y' ? y + d - 0.12 : y + 0.06, showScreen = fu.face === '-y';
  const scr = (mx: number, mw: number, z0: number, z1: number, cls = 'scr') => showScreen ? poly([P(mx + 0.03, my + 0.05, z0), P(mx + mw - 0.03, my + 0.05, z0), P(mx + mw - 0.03, my + 0.05, z1), P(mx + 0.03, my + 0.05, z1)], '', `class="${cls}"`) : '';
  const ky = fu.face === '+y' ? y + 0.2 : y + d - 0.35;
  if (kit === 'drafting') {
    // 기울인 제도판(디자이너·엔지니어) 또는 타자기(그 밖)
    if (role === 'designer' || role === 'engineer') { const by = fu.face === '+y' ? y + d - 0.1 : y + 0.1, ty = fu.face === '+y' ? y + 0.25 : y + d - 0.25; s += poly([P(x + 0.2, by, h + 0.42), P(x + 1.2, by, h + 0.42), P(x + 1.2, ty, h + 0.04), P(x + 0.2, ty, h + 0.04)], '#f1eee6', 'stroke="#bdb6aa" stroke-width="1"') + `<path d="M${P(x + 0.35, (by + ty) / 2, h + 0.24)} L${P(x + 1.0, (by + ty) / 2, h + 0.24)}" stroke="#8b94a1" stroke-width="1"/>`; }
    else if (role) s += box(x + 0.45, ky - 0.05, h, 0.42, 0.3, 0.1, '#5d5148') + box(x + 0.52, ky + 0.18, h + 0.1, 0.28, 0.02, 0.16, '#faf8f3');
    if (role) { const ph = P(x + 1.15, ky, h); s += `<ellipse cx="${ph[0]}" cy="${ph[1] - 2}" rx="4" ry="2.2" fill="#2f3236"/>`; } // 전화기
  } else if (kit === 'terminal' || kit === 'crt') {
    // 베이지색 상자형 화면(뒤가 깊다). 80년대는 엔지니어만, 90년대는 모두
    if (kit === 'crt' || role === 'engineer') {
      const mx = x + 0.42, mw = 0.46, dy = fu.face === '+y' ? -0.3 : 0;
      s += box(mx + 0.06, my + dy, h, mw - 0.12, 0.42, 0.34, '#cfc8b6') + box(mx, my, h + 0.02, mw, 0.06, 0.4, '#ddd6c4');
      s += scr(mx + 0.02, mw - 0.04, h + 0.08, h + 0.36, kit === 'terminal' ? 'scr crt green' : 'scr crt');
    } else if (role) s += box(x + 0.45, ky - 0.05, h, 0.42, 0.3, 0.1, '#5d5148') + box(x + 0.52, ky + 0.18, h + 0.1, 0.28, 0.02, 0.16, '#faf8f3');
  } else {
    const n = role === 'engineer' ? 2 : 1, mw = kit === 'slim' ? 0.56 : 0.5, th = kit === 'slim' ? 0.025 : 0.06;
    for (let i = 0; i < n; i++) {
      const mx = x + (n === 2 ? 0.12 + i * 0.6 : 0.44);
      s += box(mx + mw / 2 - 0.03, my + 0.01, h, 0.06, 0.04, 0.1, '#5b6068');
      s += box(mx, my, h + 0.1, mw, th, 0.33, kit === 'slim' ? '#2b2f35' : '#3b4048');
      s += scr(mx, mw, h + 0.13, h + 0.4);
    }
    if (kit === 'slim' && role === 'designer') s += top(x + 0.95, ky - 0.02, h + 0.006, 0.26, 0.18, '#2b2f35'); // 태블릿
  }
  if (kit === 'drafting' || kit === 'terminal') return s + (role ? top(x + 0.95, ky, h + 0.004, 0.3, 0.22, '#f4f1ea') : ''); // 서류
  if (role === 'designer') s += top(x + 0.95, ky - 0.05, h + 0.005, 0.38, 0.26, '#4b5059');
  if (role === 'tester') s += top(x + 0.98, ky - 0.08, h + 0.005, 0.28, 0.34, '#f2efe8') + top(x + 1.0, ky - 0.06, h + 0.02, 0.28, 0.34, '#faf8f3');
  if (role === 'sales') s += top(x + 1.05, ky, h + 0.005, 0.12, 0.2, '#30343a');
  if (role) s += top(x + 0.45, ky, h + 0.005, 0.45, 0.15, '#c3c7cc');
  if (role) { const cup = P(x + 0.25, ky + 0.05, h); s += `<rect x="${cup[0] - 1.6}" y="${cup[1] - 4}" width="3.2" height="4" rx=".7" fill="#f2efe8"/>`; }
  return s;
}

/** 임원 책상: 짙은 나무 상판과 앞가림판. 임원이 있으면 화면이 켜진다 */
function xdeskSvg(fu: Furn, kit: Kit, on: boolean): string {
  const { x, y, w, d } = fu;
  return `<g class="desk${on ? ' on' : ''}">${deskSvg(fu, on ? 'sales' : undefined, kit, '#8a6a4e')}${box(x, y + d - 0.04, 0.08, w, 0.04, DESK_H - 0.11, '#6e5440')}</g>`;
}
/** 직함 문패: 유리 앞면(y=gy, 오른쪽 벽과 나란한 면)에 붙은 작은 판. 유리방이 아니면 책상 앞 바닥에 세운 작은 팻말 */
function platePlate(x: number, gy: number, z: number, title: string, name: string, glass: boolean): string {
  const w = 1.0 * U, h = 0.42 * U, [X, Y] = P(x, gy, z + 0.42);
  const stand = glass ? '' : box(x + 0.45, gy - 0.02, 0, 0.04, 0.04, z, '#6f767e');
  return stand + `<g transform="matrix(1 0.5 0 1 ${X} ${Y})"><rect width="${w}" height="${f(h)}" rx="1.5" fill="#2f343c"/><text x="${f(w / 2)}" y="6.4" text-anchor="middle" font-size="5.6" font-weight="700" fill="#f2f2f0">${esc(title)}</text><text x="${f(w / 2)}" y="12.2" text-anchor="middle" font-size="4.8" fill="#c9ced6">${esc(name)}</text></g>`;
}
/** 천장 조명(바닥 빛 자리는 따로): 1 알전구, 2·3 천장 매립(그림 없음), 4·5 긴 펜던트 */
function lampsSvg(rm: Room, kind: LevelStyle['light']): string {
  if (kind === 'panel') return '';
  let s = '';
  for (const [x, y] of rm.lights) {
    const [tx, ty] = P(x, y, rm.H), [bx, by] = P(x, y, 2.2);
    if (kind === 'bulb') s += `<path d="M${tx},${ty} L${bx},${by}" stroke="#5b6068" stroke-width=".8"/><circle cx="${bx}" cy="${f(by + 2.5)}" r="3" fill="#ffe7a3"/><circle cx="${bx}" cy="${f(by + 2.5)}" r="6" fill="#fff1c4" opacity=".35"/>`;
    else { for (const dx of [-0.9, 0.9]) { const [ax, ay] = P(x + dx, y, rm.H), [cx, cy] = P(x + dx, y, 2.3); s += `<path d="M${ax},${ay} L${cx},${cy}" stroke="#8b929b" stroke-width=".6"/>`; } s += box(x - 1.2, y - 0.06, 2.24, 2.4, 0.12, 0.06, '#3b4048') + poly([P(x - 1.15, y + 0.06, 2.24), P(x + 1.15, y + 0.06, 2.24), P(x + 1.15, y + 0.06, 2.25), P(x - 1.15, y + 0.06, 2.25)], '#fff6d8'); }
  }
  return `<g class="lamps" pointer-events="none">${s}</g>`;
}

function chairParts(x: number, y: number, face: Face): { pre: string; post: string } {
  // 앉는 판과 다리는 뒤, 등받이는 사람 뒤쪽(앞모습이면 먼저, 뒷모습이면 나중에 그린다)
  const seat = box(x - 0.04, y - 0.04, 0, 0.08, 0.08, 0.4, '#3a3f47') + box(x - 0.24, y - 0.24, 0.4, 0.48, 0.48, 0.07, CHAIR);
  const [fx, fy] = faceVec(face);
  const bx = fx ? x - fx * 0.26 - 0.03 : x - 0.22, by = fy ? y - fy * 0.26 - 0.03 : y - 0.22;
  const back = box(bx, by, 0.47, fx ? 0.06 : 0.44, fy ? 0.06 : 0.44, 0.48, shade(CHAIR, -0.08));
  return fx > 0 || fy > 0 ? { pre: seat + back, post: '' } : { pre: seat, post: back };
}

function furnSvg(fu: Furn, room: Room, carCol: string | null): string {
  const { x, y, w, d, h } = fu;
  switch (fu.kind) {
    case 'divider': return box(x, y, 0, w, d, h, '#aab4be');
    case 'glass': return box(x, y, 0, w, d, h, GLASS, 'opacity=".38"') + box(x, y, h, w, d, 0.04, '#8c98a4');
    case 'cabinet': return box(x, y, 0, w, d, h, '#e3e0da') + `<path d="M${P(x + w / 2, y + d, 0.05)} L${P(x + w / 2, y + d, h - 0.05)}" stroke="#c4c0b8" stroke-width="1"/>`;
    case 'rack': { let s = ''; for (const z of [0.1, 0.8, 1.5]) { s += box(x, y, z, w, d, 0.04, '#8e959d'); s += box(x + 0.1, y + 0.05, z + 0.04, 0.5, 0.4, 0.35, '#c9a77d') + box(x + 0.75, y + 0.08, z + 0.04, 0.6, 0.35, 0.28, '#b89670'); } return box(x, y + d - 0.04, 0, 0.04, 0.04, h, '#6f767e') + s + box(x + w - 0.04, y + d - 0.04, 0, 0.04, 0.04, h, '#6f767e'); }
    case 'counter': { const m = P(x + 0.5, y + 0.3, h); return box(x, y, 0, w, d, h, '#d9d5ce') + top(x, y, h, w, d, '#bfb8ad') + box(x + 0.3, y + 0.12, h, 0.35, 0.35, 0.42, '#3d4148') + `<rect x="${m[0] - 1}" y="${m[1] - 6}" width="2" height="3" fill="#cc8b4f"/>` + box(x + 1.4, y + 0.15, h, 0.5, 0.3, 0.06, '#f2efe8'); }
    case 'fridge': return box(x, y, 0, w, d, h, '#eceae6');
    case 'sofa': return box(x, y, 0, w, d, 0.4, '#8b97a6') + box(x, fu.face === '-y' ? y + d - 0.22 : y, 0.4, w, 0.22, 0.42, '#7c8898') + box(x, y, 0.4, 0.2, d, 0.2, '#7c8898') + box(x + w - 0.2, y, 0.4, 0.2, d, 0.2, '#7c8898');
    case 'plant': { const [cx, cy] = P(x + w / 2, y + d / 2, 0.45 + h * 0.4); return box(x + 0.05, y + 0.05, 0, w - 0.1, d - 0.1, 0.45, '#b9a48a') + `<ellipse cx="${cx}" cy="${cy}" rx="${f(w * 22)}" ry="${f(h * 15)}" fill="#7c9b78"/><ellipse cx="${cx - 4}" cy="${cy + 3}" rx="${f(w * 14)}" ry="${f(h * 9)}" fill="#6b8a68"/>`; }
    case 'table': { let s = ''; for (const [lx, ly] of [[x + 0.1, y + d - 0.15], [x + w - 0.15, y + d - 0.15], [x + w - 0.15, y + 0.1]] as [number, number][]) s += box(lx, ly, 0, 0.05, 0.05, h, LEG); return s + box(x, y, h - 0.04, w, d, 0.04, '#e4ddd2'); }
    case 'mchair': return box(x + 0.02, y + 0.02, 0.42, w - 0.04, d - 0.04, 0.06, CHAIR) + box(x, y, 0.48, w, 0.06, 0.42, shade(CHAIR, -0.08)) + box(x + w / 2 - 0.03, y + d / 2, 0, 0.06, 0.06, 0.42, '#3a3f47');
    case 'stool': return box(x, y, 0, w, d, h, '#7c8590');
    case 'drafting': {
      const s = box(x + 0.1, y + 0.1, 0, 0.06, 0.06, 0.75, LEG) + box(x + w - 0.16, y + d - 0.16, 0, 0.06, 0.06, 0.75, LEG) + box(x + w - 0.16, y + 0.1, 0, 0.06, 0.06, 0.95, LEG);
      return s + poly([P(x, y + d, 0.78), P(x + w, y + d, 0.78), P(x + w, y, 1.1), P(x, y, 1.1)], '#f4f2ee', 'stroke="#c9c3b8" stroke-width="1"') +
        `<path d="M${P(x + 0.2, y + 0.5, 0.95)} Q${P(x + 0.6, y + 0.2, 1.05)} ${P(x + 1.0, y + 0.45, 0.96)}" stroke="#8b94a1" stroke-width="1" fill="none"/>`;
    }
    case 'clay': return box(x, y, 0, w, d, h, '#d6d2cb') + carBox(x + 0.3, y + 0.25, h, w - 0.6, d - 0.5, '#b8916a', false);
    case 'car': return (room.level >= 2 ? box(x - 0.1, y + 0.2, 0, w + 0.2, d - 0.4, 0.08, '#6f767e') : '') + carBox(x, y, room.level >= 2 ? 0.35 : 0, w, d, carCol ?? '#9aa1a8');
    case 'post': return box(x, y, 0, w, d, h, '#c7a23c') + box(x - 0.05, y - 0.05, 0, w + 0.1, d + 0.1, 0.06, '#6f767e');
    case 'cart': return box(x, y, 0.08, w, d, h - 0.08, '#8e5a50') + [0.35, 0.6].map((z) => `<path d="M${P(x + 0.05, y + d, z)} L${P(x + w - 0.05, y + d, z)}" stroke="#6e443c" stroke-width="1"/>`).join('');
    case 'diag': { const m = P(x + w / 2, y + d, 1.15); return box(x + 0.2, y + 0.2, 0, 0.1, 0.1, 1.0, '#6f767e') + box(x, y, 1.0, w, d, 0.4, '#3b4048') + `<rect x="${m[0] - 6}" y="${m[1] - 4}" width="9" height="6" fill="#9fc3b0"/>`; }
    case 'workbench': return box(x, y, 0, w, d, h - 0.06, '#7d838b') + box(x, y, h - 0.06, w, d, 0.06, '#a98a62') + box(x + w - 0.08, y + d - 0.08, 0, 0.06, 0.06, h - 0.06, '#5b6068') + box(x + 0.1, y + 0.4, h, 0.4, 0.3, 0.2, '#b44c3c');
    case 'boxes': return box(x, y, 0, w, d, h * 0.6, '#c9a77d') + box(x + 0.1, y + 0.1, h * 0.6, w * 0.6, d * 0.6, h * 0.4, '#d4b48b');
    case 'dyno': return box(x, y, 0, w, d, 0.4, '#5b6068') + box(x + 0.3, y + 0.2, 0.4, 0.9, 0.8, 0.55, '#8c939b') + box(x + 1.25, y + 0.35, 0.4, 0.4, 0.5, 0.35, '#b44c3c');
    case 'tunnel': { const [cx, cy] = P(x + w, y + d / 2, h / 2); return box(x, y, 0, w, d, h, '#c9ced4') + `<ellipse cx="${cx}" cy="${cy}" rx="11" ry="15" fill="#5b6068"/><ellipse cx="${cx}" cy="${cy}" rx="4" ry="5" fill="#9aa1a8"/>`; }
    case 'reception': return box(x, y, 0, w, d, h, '#cdbfa8') + box(x - 0.05, y - 0.05, h, w + 0.1, d + 0.1, 0.04, '#e4ddd2');
    case 'printer': return box(x, y, 0, w, d, 0.7, '#d4d6d9') + box(x + 0.05, y + 0.05, 0.7, w - 0.1, d - 0.1, 0.3, '#e4e6e9');
    case 'cooler': return box(x, y, 0, w, d, 0.9, '#eceae6') + box(x + 0.1, y + 0.1, 0.9, w - 0.2, d - 0.2, 0.35, '#b5d3e2', 'opacity=".85"');
    default: return '';
  }
}

/** 창밖 풍경(창 안쪽 좌표, 아래가 h). 1 이웃 벽돌 벽 → 2·3 낮은 건물·가로수 → 4 나무와 먼 건물 → 5 높은 층에서 본 도심 */
function windowView(lv: Level, w: number, h: number, seed: number): string {
  const r = (i: number) => (hash(`${lv}:${seed.toFixed(1)}:${i}`) % 1000) / 1000;
  let s = '';
  if (lv === 1) { s += `<rect y="${f(h * .25)}" width="${w}" height="${f(h * .75)}" fill="#b58b72"/>`; for (let yy = h * .3; yy < h; yy += 4) s += `<path d="M0,${f(yy)} H${w}" stroke="#a37a62" stroke-width=".8"/>`; return s; }
  if (lv >= 5) { // 지평선이 낮다(높은 층). 가늘고 높은 건물 여러 채
    for (let i = 0; i < 7; i++) { const bw = w * (.1 + .08 * r(i)), x = (w * (i + r(i + 9) * .6)) / 7, bh = h * (.25 + .5 * r(i + 20)); s += `<rect x="${f(x)}" y="${f(h * .92 - bh)}" width="${f(bw)}" height="${f(bh)}" fill="${i % 2 ? '#aebdca' : '#9fb0bf'}"/>`; }
    return s + `<rect y="${f(h * .92)}" width="${w}" height="${f(h * .08)}" fill="#b9c3c9"/>`;
  }
  const far = lv >= 4, base = h * (far ? .78 : .7);
  for (let i = 0; i < 4; i++) { const bw = w * (.22 + .12 * r(i)), x = w * (i * .27 - .05 + .08 * r(i + 5)), bh = h * (far ? .18 + .14 * r(i + 11) : .28 + .25 * r(i + 11)); s += `<rect x="${f(x)}" y="${f(base - bh)}" width="${f(bw)}" height="${f(bh + h - base)}" fill="${far ? '#b3c1cc' : ['#c9bfae', '#bfb8ad', '#cbc4b8', '#b7b2a9'][i]}"/>`; }
  for (let i = 0; i < 3; i++) { const cx = w * (.15 + .35 * i + .1 * r(i + 30)), rr = h * (far ? .16 : .1); s += `<circle cx="${f(cx)}" cy="${f(h - rr * .6)}" r="${f(rr)}" fill="${far ? '#8fae8a' : '#9db596'}"/>`; }
  return s;
}

function wallSvg(it: WallItem, room: Room): string {
  const w = it.w * U, h = it.h * U, zt = it.z + it.h;
  const [X, Y] = it.wall === 'R' ? P(it.at, 0, zt) : P(0, it.at + it.w, zt);
  const g = (inner: string) => `<g transform="matrix(1 ${it.wall === 'R' ? 0.5 : -0.5} 0 1 ${X} ${Y})">${inner}</g>`;
  switch (it.kind) {
    case 'window': return g(`<rect width="${w}" height="${h}" fill="#d6e5ee"/>${windowView(room.level, w, h, it.at)}<rect width="${w}" height="${h}" fill="none" stroke="#f4f4f2" stroke-width="3"/><path d="M${w / 2},0 V${h}" stroke="#f4f4f2" stroke-width="2.5"/><rect y="${h}" width="${w}" height="2.5" fill="#d5d1ca"/>`);
    case 'whiteboard': return g(`<rect width="${w}" height="${h}" fill="#f7f7f5" stroke="#a8aeb5" stroke-width="1.5"/><path d="M${w * 0.1},${h * 0.35} h${w * 0.4} M${w * 0.1},${h * 0.55} h${w * 0.3} M${w * 0.6},${h * 0.3} l${w * 0.12},${h * 0.3} l${w * 0.14},${-h * 0.2}" stroke="#8b94a1" stroke-width="1.2" fill="none"/>`);
    case 'swatch': return g(`<rect width="${w}" height="${h}" fill="#efede8" stroke="#bdb6aa" stroke-width="1"/>` + ['#a8593a', '#c6a46e', '#6f8db8', '#4f8a64', '#d9d5ce', '#3d4148', '#a5566f', '#e1c49a'].map((c, i) => `<rect x="${4 + (i % 4) * (w - 8) / 4}" y="${4 + Math.floor(i / 4) * (h - 8) / 2}" width="${(w - 8) / 4 - 3}" height="${(h - 8) / 2 - 3}" fill="${c}"/>`).join(''));
    case 'sketch': return g(`<rect width="${w}" height="${h}" fill="#f6f4ef" stroke="#bdb6aa" stroke-width="1"/><g class="sketchcar"></g><path d="M${w * 0.1},${h * 0.85} h${w * 0.8}" stroke="#c9c3b8" stroke-width="1"/>`);
    case 'toolwall': {
      let s = `<rect width="${w}" height="${h}" fill="#c9b08a"/>`;
      for (let i = 0; i < 7; i++) s += `<path d="M${10 + i * (w - 20) / 6},${h * 0.25} v${h * (0.25 + (i % 3) * 0.12)}" stroke="#5b6068" stroke-width="${i % 2 ? 2 : 3}" stroke-linecap="round"/>`;
      return g(s);
    }
    case 'shutter': { let s = `<rect width="${w}" height="${h}" fill="#b9bec4"/>`; for (let yy = 4; yy < h; yy += 5) s += `<path d="M0,${yy} H${w}" stroke="#a3a9b0" stroke-width="1.2"/>`; return g(s + `<rect y="${h - 4}" width="${w}" height="4" fill="#8e959d"/>`); }
    case 'logo': { const z = Math.min(w, h) * 0.8; return g(`<rect width="${w}" height="${h}" fill="#3b4048"/><g class="wall-logo" transform="translate(${f((w - z) / 2)},${f((h - z) / 2)}) scale(${f(z / 32)})"></g>`); }
    case 'clock': { const r = w / 2; return g(`<circle cx="${r}" cy="${r}" r="${r}" fill="#f7f7f5" stroke="#5b6068" stroke-width="1.5"/><path d="M${r},${r} v${-r * 0.65} M${r},${r} h${r * 0.45}" stroke="#3b4048" stroke-width="1.3"/>`); }
    case 'sign': return g(`<rect width="${w}" height="${h}" rx="3" fill="#3b4048"/><g class="sign-logo" transform="translate(6,${f(h * 0.42 - 12)}) scale(.5)"></g><text class="sign-name" x="26" y="${f(h * 0.42)}" font-size="11" font-weight="700" fill="#f2f2f0"></text>
      <rect x="8" y="${f(h * 0.62)}" width="${w - 16}" height="4" rx="2" fill="#5b6068"/><rect class="sign-bar" x="8" y="${f(h * 0.62)}" width="0" height="4" rx="2" fill="#d87a4a"/>
      <g class="bugs" transform="translate(${w + 9},${f(h / 2)})" display="none"><g class="bugi"><circle r="8" fill="#b4553f" stroke="#fff" stroke-width="1.5"/><text class="bugn" y="3.6" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">0</text></g></g>`);
    default: void room; return '';
  }
}

const FLOOR: Record<Zone['kind'], string> = {
  office: '#c9ccd0', studio: '#dccbb0', test: '#bfc3c7', garage: '#c4c2bd', pantry: '#e2ddd3', meeting: '#c3c8cf', lab: '#c8cdd2', lobby: '#e6e2da', lounge: '#d9d6cf', exec: '#cbbfae', elite: '#e9dcb4',
};
/** 등급별 마감: 바닥(전체·사무 구역), 벽 두 면, 바닥 줄눈(콘크리트 이음·카펫 타일·마루), 조명 모양.
    1 차고형(콘크리트, 알전구) → 2 사무실 한 층(카펫 타일, 형광등) → 3 넓은 층 → 4 유리 벽·마루 스튜디오(긴 펜던트) → 5 대형 본사(돌 바닥) */
interface LevelStyle { base: string; office: string; wallL: string; wallR: string; seam: 'concrete' | 'tile' | 'plank' | 'stone'; light: 'bulb' | 'panel' | 'pendant' }
const LV: Record<Level, LevelStyle> = {
  1: { base: '#c9c6c0', office: '#c4c3bf', wallL: '#ddd8cf', wallR: '#cfc9be', seam: 'concrete', light: 'bulb' },
  2: { base: '#d3d0c9', office: '#c3c8cd', wallL: '#e4e1db', wallR: '#d6d2cb', seam: 'tile', light: 'panel' },
  3: { base: '#d6d3cc', office: '#bfc6ce', wallL: '#e6e3dd', wallR: '#d8d4cd', seam: 'tile', light: 'panel' },
  4: { base: '#d9d5cd', office: '#c9b99d', wallL: '#e9e6e0', wallR: '#dcd8d0', seam: 'plank', light: 'pendant' },
  5: { base: '#e2dfd8', office: '#c4bba9', wallL: '#ecebe7', wallR: '#e0ddd6', seam: 'stone', light: 'pendant' },
  6: { base: '#e2dfd8', office: '#bcc3c9', wallL: '#ecebe7', wallR: '#e0ddd6', seam: 'stone', light: 'pendant' },
  7: { base: '#e5e2dc', office: '#c2b8a6', wallL: '#efeeea', wallR: '#e3e0da', seam: 'stone', light: 'pendant' },
};
/** 시대별 책상 집기 */
type Kit = 'drafting' | 'terminal' | 'crt' | 'lcd' | 'slim';
const kitOf = (year = 2020): Kit => year < 1980 ? 'drafting' : year < 1990 ? 'terminal' : year < 2005 ? 'crt' : year < 2015 ? 'lcd' : 'slim';

// ---------- 그리는 순서(쿼터뷰 가림) ----------
type FP = [number, number, number, number];             // x1,y1,x2,y2
const before = (a: FP, b: FP) => a[2] <= b[0] + 1e-6 || a[3] <= b[1] + 1e-6;
const overlapX = (a: FP, b: FP) => a[0] - a[3] < b[2] - b[1] && b[0] - b[3] < a[2] - a[1];
function topoSort<T extends { fp: FP }>(items: T[]): T[] {
  const n = items.length, indeg = new Array(n).fill(0), out: number[][] = items.map(() => []);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j || !overlapX(items[i].fp, items[j].fp)) continue;
    if (before(items[i].fp, items[j].fp) && !before(items[j].fp, items[i].fp)) { out[i].push(j); indeg[j]++; }
  }
  const key = (t: T) => t.fp[0] + t.fp[1] + t.fp[2] + t.fp[3];
  const ready = items.map((_, i) => i).filter((i) => !indeg[i]);
  const res: T[] = [], done = new Uint8Array(n);
  while (res.length < n) {
    if (!ready.length) { const rest = items.map((_, i) => i).filter((i) => !done[i]).sort((a, b) => key(items[a]) - key(items[b])); ready.push(rest[0]); } // 순환 대비
    ready.sort((a, b) => key(items[a]) - key(items[b]));
    const i = ready.shift()!;
    if (done[i]) continue;
    done[i] = 1; res.push(items[i]);
    for (const j of out[i]) if (--indeg[j] === 0 && !done[j]) ready.push(j);
  }
  return res;
}

// ---------- 직원(배우) ----------
type PoseName = 'work' | 'focus' | 'rest' | 'slump' | 'chin' | 'test' | 'studio' | 'lab' | 'coffee' | 'meeting' | 'idle';
interface Place { kind: 'seat' | 'spot'; x: number; y: number; face: Face; spot?: Spot; seat?: number; cell: [number, number] }
interface Actor {
  staff: OfficeStaff; look: Look; node: SVGGElement; seat: number; home: Place;
  x: number; y: number; face: Face; seated: boolean;
  state: 'home' | 'walk' | 'stay'; path: [number, number][]; target: Place | null; stayUntil: number; pose: PoseName;
}
interface Item { fp: FP; svg: string; seat?: number }

export function createOffice(host: HTMLElement): Office {
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.createElement('div');
  root.className = 'office';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const world = document.createElementNS(NS, 'g');
  const fx = document.createElementNS(NS, 'g'), fxBub = document.createElementNS(NS, 'g');
  svg.append(world, fx, fxBub);
  const tagPop = document.createElement('div');
  tagPop.className = 'tagpop'; tagPop.hidden = true;
  // 끌거나 확대해 옮긴 뒤에만 보이는 "원위치" 버튼(누르면 기본 화면)
  const homeBtn = document.createElement('button');
  homeBtn.type = 'button'; homeBtn.className = 'ofc-home'; homeBtn.hidden = true;
  homeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>원위치';
  homeBtn.setAttribute('aria-label', '사무실 화면을 원래 위치로');
  root.append(svg, tagPop, homeBtn);
  host.append(root);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let view: OfficeView | null = null, room: Room | null = null, structKey = '';
  const actors = new Map<string, Actor>();
  let items: (Item & { node: SVGGElement })[] = [];
  let itemsG: SVGGElement | null = null;
  const slots = new Map<number, SVGGElement>();
  const spotTaken = new Map<Spot, string>();
  let vb = { x: 0, y: 0, w: 1, h: 1 };
  let cam = { cx: 0, cy: 0, s: 1, mode: 'auto' as 'auto' | 'free' };   // auto=기본 화면(가까이), free=사용자가 옮긴 뒤
  let hostW = 1, hostH = 1, fitS = 1;
  let active = true, disposed = false, raf = 0, idle = 0, last = 0, nextErrand = 0, nextTalk = 0;
  const bubbles: { id: string; g: SVGGElement; box: [number, number, number, number] }[] = [];
  const timeouts = new Set<number>();
  const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timeouts.delete(t); fn(); }, ms); timeouts.add(t); };
  let signEls: { name: SVGTextElement; bar: SVGRectElement; barW: number; bugs: SVGGElement; bugn: SVGTextElement; bugi: SVGGElement } | null = null;

  // ---------- 장면 짓기 ----------
  function build(v: OfficeView) {
    const rm = roomFor(v.level);
    room = rm;
    const sorted0 = [...v.staff].sort((a, b) => ROLE[a.role].order - ROLE[b.role].order || (a.id < b.id ? -1 : 1));
    const staff = [...sorted0.filter((x) => !x.elite).slice(0, CAPACITY[rm.level]), ...sorted0.filter((x) => x.elite).slice(0, ELITE_SEATS[rm.level])]; // 4.1.0 전담팀원은 금색 자리
    const seatOf = assignSeats(rm.level, staff);
    const occupant = new Map<number, OfficeStaff>();
    for (const s of staff) { const i = seatOf.get(s.id); if (i !== undefined) occupant.set(i, s); }
    const c0 = v.carSvg?.match(/fill="(#[0-9a-fA-F]{6})"/)?.[1];
    const carCol = c0 ? mix(c0, '#9aa1a8', 0.3) : null;   // 장면 색에 맞게 채도를 조금 낮춘다
    const { W, D, H } = rm;
    const x0 = -D * U - 10, x1 = W * U + 10, y0 = -(H + 0.15) * U - 10, y1 = ((W + D) * U) / 2 + 0.25 * U + 10;
    vb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

    // 벽·바닥
    const ls = LV[rm.level], kit = kitOf(v.year);
    let s = `<defs><radialGradient id="ofc-pool"><stop offset="0" stop-color="#fffdf4" stop-opacity=".55"/><stop offset="1" stop-color="#fffdf4" stop-opacity="0"/></radialGradient></defs>`;
    s += poly([P(0, 0), P(0, D), P(0, D, H), P(0, 0, H)], ls.wallL) + poly([P(0, 0), P(W, 0), P(W, 0, H), P(0, 0, H)], ls.wallR);
    s += poly([P(0, 0, H), P(0, D, H), P(-0.2, D, H), P(-0.2, -0.2, H), P(W, -0.2, H), P(W, 0, H)], '#b7b2aa');
    s += poly([P(W, 0), P(W, D), P(W, D, -0.25), P(W, 0, -0.25)], '#9c968d') + poly([P(0, D), P(W, D), P(W, D, -0.25), P(0, D, -0.25)], '#aaa49b');
    s += top(0, 0, 0, W, D, ls.base);
    for (const z of rm.zones) s += top(z.x, z.y, 0.001, z.w, z.d, z.kind === 'office' ? ls.office : FLOOR[z.kind]) + (z.kind === 'garage' || z.kind === 'test' || z.kind === 'elite' ? top(z.x + 0.3, z.y + 0.3, 0.002, z.w - 0.6, z.d - 0.6, 'none', 'stroke="#c9a94a" stroke-width="2" stroke-dasharray="8 6"') : '');
    // 바닥 줄눈: 콘크리트 이음(3m) / 카펫 타일(사무 구역 1m 격자) / 마루(사무 구역 한 방향 .3m) / 돌(전체 1.5m 격자)
    const seam = (x0: number, y0: number, x1: number, y1: number, col: string, op: number) => `<path d="M${P(x0, y0, 0.003)} L${P(x1, y1, 0.003)}" stroke="${col}" stroke-width="1" opacity="${op}"/>`;
    const oz = rm.zones.find((z) => z.kind === 'office')!;
    if (ls.seam === 'concrete') for (let x = 3; x < W; x += 3) s += seam(x, 0, x, D, '#bdb9b2', 1);
    if (ls.seam === 'tile') { for (let x = oz.x + 1; x < oz.x + oz.w; x += 1) s += seam(x, oz.y, x, oz.y + oz.d, '#000', .05); for (let y = oz.y + 1; y < oz.y + oz.d; y += 1) s += seam(oz.x, y, oz.x + oz.w, y, '#000', .05); }
    if (ls.seam === 'plank') for (let y = oz.y + .3; y < oz.y + oz.d; y += .3) s += seam(oz.x, y, oz.x + oz.w, y, '#7a6040', .12);
    if (ls.seam === 'stone') { for (let x = 1.5; x < W; x += 1.5) s += seam(x, 0, x, D, '#fff', .35); for (let y = 1.5; y < D; y += 1.5) s += seam(0, y, W, y, '#fff', .35); }
    // 조명이 바닥에 떨어진 밝은 자리
    for (const [lx, ly] of rm.lights) { const [cx, cy] = P(lx, ly + 0.4); s += `<ellipse cx="${cx}" cy="${cy}" rx="${f(2.4 * U)}" ry="${f(1.2 * U)}" fill="url(#ofc-pool)"/>`; }
    s += poly([P(0, 0), P(0, D), P(0, D, 0.1), P(0, 0, 0.1)], '#c3bfb8') + poly([P(0, 0), P(W, 0), P(W, 0, 0.1), P(0, 0, 0.1)], '#bcb7b0');
    for (const wi of rm.walls) s += wallSvg(wi, rm);
    // 가구 그림자(옅게)
    for (const fu of rm.furn) if (fu.kind !== 'glass' && fu.kind !== 'divider') s += top(fu.x + 0.06, fu.y + 0.06, 0.004, fu.w + 0.04, fu.d + 0.04, '#000', 'opacity=".06"');
    for (const st of rm.seats) s += `<ellipse cx="${P(st.x, st.y)[0]}" cy="${P(st.x, st.y)[1]}" rx="9" ry="4.5" fill="#000" opacity=".06"/>`;

    // 가구와 의자 → 가림 순서로 정렬
    const list: Item[] = [];
    for (const fu of rm.furn) {
      const occ = fu.seat !== undefined ? occupant.get(fu.seat) : undefined;
      const svg0 = fu.kind === 'desk' ? deskSvg(fu, occ?.role, kit, fu.elite ? '#d8bb6c' : undefined) : fu.kind === 'xdesk' ? xdeskSvg(fu, kit, !!v.execs?.[rm.furn.filter((q) => q.kind === 'xdesk').indexOf(fu)]) : furnSvg(fu, rm, carCol);
      list.push({ fp: [fu.x, fu.y, fu.x + fu.w, fu.y + fu.d], svg: fu.kind === 'desk' ? `<g class="desk" data-seat="${fu.seat}">${svg0}</g>` : svg0 });
    }
    rm.seats.forEach((st, i) => {
      const { pre, post } = chairParts(st.x, st.y, st.face);
      list.push({ fp: [st.x - 0.25, st.y - 0.25, st.x + 0.25, st.y + 0.25], svg: `${pre}<g class="slot"></g>${post}`, seat: i });
    });
    // 임원: 창가 자리에 정장 차림으로 앉고, 유리 앞에 직함 문패
    rm.execs.forEach((ex, i) => {
      const e = v.execs?.[i], { pre, post } = chairParts(ex.x, ex.y, ex.face);
      const [hx, hy] = P(ex.x, ex.y, 0.47);
      const person = e ? `<g class="pp vf sit p-work exec" transform="translate(${hx},${hy}) scale(-1,1)">${personSvg('sales', lookOf(e.id), '#3f4a5e')}</g>` : '';
      list.push({ fp: [ex.x - 0.25, ex.y - 0.25, ex.x + 0.25, ex.y + 0.25], svg: pre + person + post });
      if (e) list.push({ fp: [ex.plate[0], 3.12, ex.plate[0] + 1.0, 3.2], svg: platePlate(ex.plate[0], ex.glass ? 3.16 : 2.0, ex.plate[1], e.title, e.name, ex.glass) });
    });
    const sorted = topoSort(list);
    world.innerHTML = s + `<g class="items">${sorted.map((it) => `<g>${it.svg}</g>`).join('')}</g>` + lampsSvg(rm, ls.light);
    itemsG = world.querySelector('.items');
    items = sorted.map((it, i) => ({ ...it, node: itemsG!.children[i] as SVGGElement }));
    slots.clear();
    for (const it of items) if (it.seat !== undefined) slots.set(it.seat, it.node.querySelector('.slot')!);
    // 그림판 위 개발 중인 차(옆모습)
    const sk = world.querySelector('.sketchcar');
    if (sk && v.carSvg) { const sw = rm.walls.find((q) => q.kind === 'sketch')!; sk.innerHTML = v.carSvg.replace(/<svg\b/, `<svg x="${f(sw.w * U * 0.1)}" y="${f(sw.h * U * 0.15)}" width="${f(sw.w * U * 0.8)}" height="${f(sw.h * U * 0.6)}"`); }

    // 직원
    actors.clear(); spotTaken.clear();
    for (const sf of staff) {
      const si = seatOf.get(sf.id);
      if (si === undefined) continue;
      const st = rm.seats[si], lk = lookOf(sf.id);
      const node = document.createElementNS(NS, 'g');
      node.setAttribute('class', 'pp vf sit');
      node.innerHTML = personSvg(sf.role, lk);
      const home: Place = { kind: 'seat', x: st.x, y: st.y, face: st.face, seat: si, cell: st.access };
      const a: Actor = { staff: sf, look: lk, node, seat: si, home, x: st.x, y: st.y, face: st.face, seated: true, state: 'home', path: [], target: null, stayUntil: 0, pose: 'work' };
      actors.set(sf.id, a);
      sitDown(a, home);
    }
    const q = <T extends Element>(sel: string) => world.querySelector(sel) as T;
    const sign = rm.walls.find((w) => w.kind === 'sign')!;
    signEls = { name: q('.sign-name'), bar: q('.sign-bar'), barW: sign.w * U - 16, bugs: q('.bugs'), bugn: q('.bugn'), bugi: q('.bugi') };
    fx.replaceChildren(); fxBub.replaceChildren(); bubbles.length = 0; tagPop.hidden = true;
    const eN = staff.filter((x) => x.elite && actors.has(x.id)).length;
    svg.setAttribute('aria-label', `${rm.name} 사무실, 직원 ${actors.size - eN}명${eN ? `, 직속 전담팀 ${eN}명(금색 자리)` : ''}`);
  }

  // ---------- 배우 위치·자세 ----------
  function place(a: Actor) {
    const [hx, hy] = P(a.x, a.y, a.seated ? 0.47 : 0.9);
    const front = a.face === '+x' || a.face === '+y', mirror = a.face === '+y' || a.face === '-x';
    a.node.setAttribute('transform', `translate(${hx},${hy})${mirror ? ' scale(-1,1)' : ''}`);
    a.node.classList.toggle('vf', front); a.node.classList.toggle('vb', !front);
    a.node.classList.toggle('sit', a.seated); a.node.classList.toggle('stand', !a.seated);
    if (!a.seated) insertByDepth(a);
  }
  function insertByDepth(a: Actor) {
    if (!itemsG) return;
    const fp: FP = [a.x - 0.15, a.y - 0.15, a.x + 0.15, a.y + 0.15];
    let lo = -1;
    for (let i = 0; i < items.length; i++) if (overlapX(items[i].fp, fp) && before(items[i].fp, fp)) lo = i;
    const ref = items[lo + 1]?.node ?? null;
    if (a.node.parentNode !== itemsG || a.node.nextSibling !== ref) itemsG.insertBefore(a.node, ref);
  }
  function sitDown(a: Actor, p: Place) {
    a.x = p.x; a.y = p.y; a.face = p.face; a.seated = true; a.state = 'home'; a.target = null;
    slots.get(a.seat)?.append(a.node);
    place(a); setPose(a);
  }
  function setPose(a: Actor) {
    const v = view;
    let pose: PoseName = 'idle';
    const tired = a.staff.condition < 0.4;
    if (a.state === 'walk') pose = 'idle';
    else if (a.state === 'stay' && a.target?.spot) pose = a.target.spot.kind === 'coffee' ? 'coffee' : a.target.spot.kind === 'meeting' ? 'meeting' : 'idle';
    else if (a.home.kind === 'spot' && a.state === 'home') pose = a.home.spot!.kind as PoseName;
    else if (v) {
      const busy = v.phase !== 'rest' && a.staff.working;
      pose = !busy ? 'rest' : tired ? (a.look.v ? 'chin' : 'slump') : v.budget === 'high' ? 'focus' : 'work';
    }
    a.pose = pose;
    const cls = a.node.getAttribute('class')!.replace(/\bp-\w+|\bwalk\b/g, '').trim();
    a.node.setAttribute('class', `${cls} p-${pose}${a.state === 'walk' ? ' walk' : ''}`.replace(/\s+/g, ' '));
    const sp = !v ? 1 : (v.phase === 'rest' ? 0.8 : { low: 0.8, normal: 1, high: 1.3 }[v.budget]) * (tired ? 0.6 : 1);
    a.node.style.setProperty('--sp', String(sp));
    world.querySelector(`.desk[data-seat="${a.seat}"]`)?.classList.toggle('on', a.seated && (pose === 'work' || pose === 'focus' || pose === 'chin'));
  }

  const spotPlace = (sp: Spot): Place => ({ kind: 'spot', x: sp.x, y: sp.y, face: sp.face, spot: sp, cell: [sp.x, sp.y] });

  /** p로 걸어가기. 움직임 줄이기 설정이면 바로 옮긴다 */
  function walkTo(a: Actor, p: Place) {
    const rm = room!;
    const startCell = a.seated ? rm.seats[a.seat].access : nearestFree(rm.grid, a.x, a.y);
    const path = findPath(rm.grid, startCell, p.cell);
    a.target = p;
    if (!path || reduced.matches) { arrive(a, p); return; }
    a.path = [startCell, ...path.slice(1)];
    if (p.kind === 'seat') a.path.push([p.x, p.y]);
    if (a.seated) { a.seated = false; }
    a.state = 'walk';
    setPose(a); place(a);
    kick();
  }
  function arrive(a: Actor, p: Place) {
    if (p.kind === 'seat') { sitDown(a, p); return; }
    a.x = p.x; a.y = p.y; a.face = p.face; a.seated = false; a.path = [];
    a.state = p === a.home ? 'home' : 'stay';
    if (a.state === 'stay') {
      const tired = a.staff.condition < 0.4, k = view?.budget === 'high' ? 0.7 : 1;
      const base = p.spot?.kind === 'meeting' ? 12000 : p.spot?.kind === 'coffee' ? (tired ? 22000 : 8000) : 6000;
      a.stayUntil = performance.now() + (base + Math.random() * 5000) * k;
    }
    place(a); setPose(a);
  }
  function releaseSpot(a: Actor) { for (const [sp, id] of spotTaken) if (id === a.staff.id && a.home.spot !== sp) spotTaken.delete(sp); }

  // 단계·예산에 따라 서서 일할 사람(시험실·스튜디오·연구실)을 정한다
  function assignHomes(v: OfficeView) {
    const rm = room!;
    const want = new Map<string, Spot>();
    const free = (k: Spot['kind']) => rm.spots.filter((sp) => sp.kind === k);
    const pickFor = (role: Role, kind: Spot['kind'], frac: number) => {
      const list = [...actors.values()].filter((a) => a.staff.role === role && a.staff.working && a.staff.condition >= 0.4);
      const n = Math.min(free(kind).length, Math.ceil(list.length * frac));
      list.slice(0, n).forEach((a, i) => want.set(a.staff.id, free(kind)[i]));
    };
    if (v.phase === 'test') { pickFor('tester', 'test', 1); }
    if (v.phase === 'design') { pickFor('designer', 'studio', 0.5); pickFor('engineer', 'lab', 0.25); }
    for (const a of actors.values()) {
      const sp = want.get(a.staff.id);
      const old = a.home;
      const same = sp ? old.spot === sp : old.kind === 'seat';
      if (!same) a.home = sp ? spotPlace(sp) : { kind: 'seat', x: rm.seats[a.seat].x, y: rm.seats[a.seat].y, face: rm.seats[a.seat].face, seat: a.seat, cell: rm.seats[a.seat].access };
      if (sp) spotTaken.set(sp, a.staff.id); else for (const [k, id] of spotTaken) if (id === a.staff.id && k.kind !== 'coffee' && k.kind !== 'meeting') spotTaken.delete(k);
      const changed = !same;
      if (changed && a.state === 'home') walkTo(a, a.home);
      else if (changed && a.state === 'walk' && a.target === old) walkTo(a, a.home);
    }
  }

  function applyState(v: OfficeView) {
    for (const a of actors.values()) {
      const sf = v.staff.find((x) => x.id === a.staff.id);
      if (sf) a.staff = sf;
    }
    assignHomes(v);
    for (const a of actors.values()) setPose(a);
    if (signEls) {
      const name = v.projectName ?? (v.phase === 'rest' ? '쉬는 중' : '개발 중');
      const maxChars = Math.max(2, Math.floor((signEls.barW - 18) / 10.5));
      for (const el of root.querySelectorAll('.sign-logo,.wall-logo')) if (el.getAttribute('data-k') !== (v.logo ?? '')) { el.innerHTML = v.logo ?? ''; el.setAttribute('data-k', v.logo ?? ''); }
      signEls.name.textContent = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
      signEls.bar.setAttribute('width', String(f(signEls.barW * Math.max(0, Math.min(1, v.progress ?? 0)))));
      const n = v.defects ?? 0;
      signEls.bugs.setAttribute('display', v.phase === 'test' && n > 0 ? 'inline' : 'none');
      signEls.bugn.textContent = String(n);
    }
  }

  // ---------- 움직임 ----------
  function step(now: number) {
    raf = 0;
    if (!running()) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    const v = view!;
    const speed = 1.0 * (v.budget === 'high' && v.phase !== 'rest' ? 1.25 : v.budget === 'low' ? 0.9 : 1);
    let walking = 0;
    for (const a of actors.values()) {
      if (a.state === 'walk') {
        walking++;
        let left = (a.staff.condition < 0.4 ? 0.75 : 1) * speed * dt;
        while (left > 0 && a.path.length) {
          const [tx, ty] = a.path[0], dx = tx - a.x, dy = ty - a.y, dist = Math.hypot(dx, dy);
          if (dist > 1e-4) a.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '+x' : '-x') : (dy > 0 ? '+y' : '-y');
          if (dist <= left) { a.x = tx; a.y = ty; a.path.shift(); left -= dist; }
          else { a.x += (dx / dist) * left; a.y += (dy / dist) * left; left = 0; }
        }
        if (!a.path.length) arrive(a, a.target!); else place(a);
      } else if (a.state === 'stay' && now > a.stayUntil) { releaseSpot(a); walkTo(a, a.home); }
    }
    if (now > nextErrand) { nextErrand = now + errandGap(v); if (!reduced.matches) startErrand(v, walking); }
    if (now > nextTalk) { nextTalk = now + 10000 + Math.random() * 5000; autoTalk(); }
    // 걷는 사람이 없으면 0.3초마다만 깨어난다
    if ([...actors.values()].some((x) => x.state === 'walk')) raf = requestAnimationFrame(step);
    else { idle = window.setTimeout(() => { idle = 0; step(performance.now()); }, 300); }
  }
  const errandGap = (v: OfficeView) => (v.phase === 'rest' ? 4500 : v.budget === 'high' ? 11000 : v.budget === 'low' ? 6500 : 8000) * (0.7 + Math.random() * 0.6);
  function startErrand(v: OfficeView, walking: number) {
    const rm = room!;
    const max = actors.size <= 4 ? 1 : actors.size <= 12 ? 2 : 3;
    const busy = [...actors.values()].filter((a) => a.state !== 'home').length;
    if (walking >= max || busy >= max + 1) return;
    const cand = [...actors.values()].filter((a) => a.state === 'home' && a.home.kind === 'seat');
    if (!cand.length) return;
    // 지친 사람·쉬는 사람이 더 자주 일어난다
    const w = cand.map((a) => (a.staff.condition < 0.4 ? 3 : 1) * (v.phase === 'rest' || !a.staff.working ? 2 : 1));
    let r = Math.random() * w.reduce((s, x) => s + x, 0), a = cand[0];
    for (let i = 0; i < cand.length; i++) { r -= w[i]; if (r <= 0) { a = cand[i]; break; } }
    const kinds: Spot['kind'][] = ['coffee', 'coffee'];
    if (rm.spots.some((s) => s.kind === 'meeting') && v.phase !== 'rest') kinds.push('meeting');
    if (v.phase === 'test' && a.staff.role === 'engineer') kinds.push('test', 'test');
    const pick = Math.random() < 0.35 ? 'chat' : kinds[Math.floor(Math.random() * kinds.length)];
    if (pick === 'chat') {
      const others = [...actors.values()].filter((o) => o !== a && o.state === 'home' && o.home.kind === 'seat');
      const o = others[Math.floor(Math.random() * others.length)];
      if (!o) return;
      const st = rm.seats[o.seat], [ax, ay] = st.access;
      const face: Face = Math.abs(st.x - ax) > Math.abs(st.y - ay) ? (st.x > ax ? '+x' : '-x') : (st.y > ay ? '+y' : '-y');
      walkTo(a, { kind: 'spot', x: ax, y: ay, face, cell: [ax, ay] });
      return;
    }
    const sp = rm.spots.filter((s) => s.kind === pick && !spotTaken.has(s));
    const s = sp[Math.floor(Math.random() * sp.length)];
    if (!s) return;
    spotTaken.set(s, a.staff.id);
    walkTo(a, spotPlace(s));
  }

  // ---------- 카메라: 기본은 일하는 구역을 가까이, 한 손가락 끌기·두 손가락 확대, 두 번 톡 → 기본 화면 ----------
  const PH = 58;                                               // 사람 키(그림 단위)
  const maxS = () => Math.max(fitS, hostH / 4 / PH);          // 가장 가까이: 사람이 화면 높이의 1/4
  const topInset = () => Math.max(0, Math.min(hostH * 0.4, parseFloat(getComputedStyle(root).getPropertyValue('--office-top-inset')) || 0));
  /** 일하는 사람(쉬는 중이면 없음). 서서 일하는 사람 + 자리에서 일하는 사람 */
  const workers = () => [...actors.values()].filter((a) => view && view.phase !== 'rest' && (a.home.kind === 'spot' || a.staff.working));
  const groupKey = (a: Actor) => (a.home.kind === 'seat' ? 'seat' : a.home.spot!.kind);
  const GROUP_NAME: Record<string, string> = { seat: '책상', test: '시험실', studio: '스튜디오', lab: '연구실' };
  function groupsOf(list: Actor[]): Actor[][] {
    const m = new Map<string, Actor[]>();
    for (const a of list) m.set(groupKey(a), [...(m.get(groupKey(a)) ?? []), a]);
    return [...m.values()];
  }
  /** 일하는 구역의 화면 범위: 앉은 사람은 책상 묶음 둘레(±1m), 서서 일하는 사람은 차·장비 둘레(±1.6m), 머리 높이까지 */
  function boundsOf(list: Actor[]): [number, number, number, number] | null {
    const ps: [number, number][] = [];
    for (const a of list) {
      const m = a.home.kind === 'spot' ? 1.6 : 1.0;
      for (const [dx, dy] of [[-m, -m], [m, -m], [-m, m], [m, m]]) ps.push(P(a.home.x + dx, a.home.y + dy), P(a.home.x + dx, a.home.y + dy, 1.8));
    }
    if (!ps.length) { const z = room?.zones.find((q) => q.kind === 'office'); if (z) ps.push(P(z.x, z.y), P(z.x + z.w, z.y + z.d), P(z.x, z.y + z.d), P(z.x + z.w, z.y)); }
    if (!ps.length) return null;
    const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  /** 범위가 위쪽 띠 아래 공간의 약 88%를 채우는 배율 */
  const fitOf = (b: [number, number, number, number]) => 0.88 * Math.min(hostW / (b[2] - b[0]), (hostH - topInset()) / (b[3] - b[1]));
  /** 범위 b를 보는 배율과 가운데. 사람 키는 화면 높이의 8~18%(구역이 다 들어가면 12% 이상이 되게 위에서 구역을 고른다) */
  /** 간판(프로젝트 이름·진행 막대)까지 넣어도 사람이 너무 작아지지 않으면 간판을 함께 넣는다(위쪽 띠에 가려지지 않게) */
  function withSign(b: [number, number, number, number] | null): [number, number, number, number] | null {
    const w = room?.walls.find((q) => q.kind === 'sign');
    if (!b || !w) return b;
    const p0 = P(w.at, 0, w.z + w.h + 0.15), p1 = P(w.at + w.w, 0, w.z - 0.1);
    const u: [number, number, number, number] = [Math.min(b[0], p0[0]), Math.min(b[1], p0[1]), Math.max(b[2], p1[0]), Math.max(b[3], p1[1])];
    return fitOf(u) >= Math.max(hostH * 0.1 / PH, fitOf(b) * 0.85) ? u : b;
  }
  /** 간판이 위쪽 띠에 반쯤 걸리면 일하는 구역이 화면 아래로 나가지 않는 만큼 화면을 내려 간판을 띠 아래로 꺼낸다 */
  function unhideSign(s: number, cx: number, cy: number, b: [number, number, number, number]): number {
    const w = room?.walls.find((q) => q.kind === 'sign'), inset = topInset();
    if (!w || !inset) return cy;
    const [lx, top] = P(w.at, 0, w.z + w.h + 0.1), [rx2, bot] = P(w.at + w.w, 0, w.z), sx = (q: number) => (q - cx) * s + hostW / 2, sy = (q: number) => (q - cy) * s + hostH / 2;
    if (sx(rx2) < 0 || sx(lx) > hostW || sy(top) >= inset || sy(bot) <= 0) return cy; // 옆으로 벗어났거나 이미 다 보이거나 띠 위로 완전히 나감
    const need = inset + 4 - sy(top), room2 = hostH - 4 - sy(b[3]);
    return cy - Math.max(0, Math.min(need, room2)) / s;
  }
  function frame(list: Actor[]) {
    const b = withSign(boundsOf(list));
    if (!b) return null;
    const want = fitOf(b), inset = topInset();
    const s = Math.max(fitS, Math.min(hostH * 0.18 / PH, Math.max(hostH * 0.08 / PH, want)));
    // 가운데: 구역이 다 들어가면 구역 가운데, 잘리면 사람들의 평균 위치(사람이 많은 쪽이 남게)
    const hp = list.map((a) => P(a.home.x, a.home.y, 0.9)), fits = want >= s || !hp.length;
    const cx = fits ? (b[0] + b[2]) / 2 : hp.reduce((t, q) => t + q[0], 0) / hp.length;
    const cy = (fits ? (b[1] + b[3]) / 2 : hp.reduce((t, q) => t + q[1], 0) / hp.length) - (inset / 2) / s; // 위쪽 띠는 가려진 곳으로 본다
    return { s, cx, cy: unhideSign(s, cx, cy, b) };
  }
  function applyCam() {
    const vw = hostW / cam.s, vh = hostH / cam.s;
    // 화면 가운데가 방 범위 안에 있게만 묶는다(방이 화면 밖으로 다 나가지 않음). 방보다 넓게 보면 방 가운데로
    const cx = vw >= vb.w && cam.mode === 'free' ? vb.x + vb.w / 2 : Math.max(vb.x, Math.min(vb.x + vb.w, cam.cx));
    const cy = vh >= vb.h && cam.mode === 'free' ? vb.y + vb.h / 2 : Math.max(vb.y, Math.min(vb.y + vb.h, cam.cy));
    cam.cx = cx; cam.cy = cy;
    svg.setAttribute('viewBox', `${f(cx - vw / 2)} ${f(cy - vh / 2)} ${f(vw)} ${f(vh)}`);
    homeBtn.hidden = cam.mode !== 'free';
    updateChips();
  }
  /** 기본 화면: 일하는 사람들이 가운데에 크게. 다 넣으면 사람이 작아질 만큼 흩어져 있으면 사람이 많은 곳(같으면 시험실)부터 들어가는 만큼만 */
  function setDefault() {
    stopGlide();
    cam.mode = 'auto';
    const work = workers();
    let list = work.length ? work : [...actors.values()];
    const lo = hostH * 0.12 / PH, b0 = boundsOf(list);
    if (work.length && b0 && fitOf(b0) < lo) {
      const gs = groupsOf(work).sort((a, b) => b.length - a.length || Number(groupKey(b[0]) === 'test') - Number(groupKey(a[0]) === 'test'));
      list = gs[0];
      for (const g of gs.slice(1)) { const bb = boundsOf([...list, ...g]); if (bb && fitOf(bb) >= lo) list = [...list, ...g]; }
    }
    const fr = frame(list);
    if (fr) { cam.s = fr.s; cam.cx = fr.cx; cam.cy = fr.cy; }
    applyCam();
  }

  // 화면 밖에서 일하는 사람: 가장자리에 "시험실 ▸ 2명" 표시, 누르면 그쪽으로 부드럽게 이동
  const chipsEl = document.createElement('div');
  chipsEl.className = 'offs';
  root.append(chipsEl);
  let chipSig = '';
  function updateChips() {
    const inset = topInset(), w = hostW / cam.s, h = hostH / cam.s;
    const l = cam.cx - w / 2, r = cam.cx + w / 2, t = cam.cy - h / 2 + inset / cam.s, bt = cam.cy + h / 2;
    const out: { k: string; n: number; x: number; y: number; arrow: string }[] = [];
    for (const g of groupsOf(workers())) {
      const off = g.map((a) => P(a.home.x, a.home.y, 0.9)).filter(([x, y]) => x < l || x > r || y < t || y > bt);
      if (!off.length) continue;
      // 화면 가운데(띠 아래)에서 그 사람들 쪽으로 그은 선이 가장자리와 만나는 곳
      const ox = hostW / 2, oy = inset + (hostH - inset) / 2;
      const dx = (off.reduce((s, p) => s + p[0], 0) / off.length - cam.cx) * cam.s, dy = (off.reduce((s, p) => s + p[1], 0) / off.length - cam.cy) * cam.s + hostH / 2 - oy;
      const mx = hostW / 2 - 78, my = (hostH - inset) / 2 - 30, k = Math.min(dx ? mx / Math.abs(dx) : Infinity, dy ? my / Math.abs(dy) : Infinity);
      const side = Math.abs(dx) * my >= Math.abs(dy) * mx;
      out.push({ k: groupKey(g[0]), n: off.length, x: ox + dx * k, y: oy + dy * k, arrow: side ? (dx > 0 ? '▸' : '◂') : (dy > 0 ? '▾' : '▴') });
    }
    const sig = out.map((o) => `${o.k}${o.n}${o.arrow}`).join();
    if (sig !== chipSig) {
      chipSig = sig;
      chipsEl.innerHTML = out.map((o) => { const name = GROUP_NAME[o.k] ?? o.k; return `<button type="button" data-g="${o.k}" aria-label="${name}에서 일하는 ${o.n}명 보기">${o.arrow === '▸' ? `${name} ▸ ${o.n}명` : `${o.arrow} ${name} ${o.n}명`}</button>`; }).join('');
    }
    out.forEach((o, i) => { const el = chipsEl.children[i] as HTMLElement; el.style.left = `${f(o.x)}px`; el.style.top = `${f(o.y)}px`; });
  }
  let glide = 0;
  const stopGlide = () => { if (glide) cancelAnimationFrame(glide); glide = 0; };
  /** 그 구역에서 일하는 사람들이 보이도록 0.5초 동안 옮긴다(움직임 줄이기 설정이면 바로) */
  function focusGroup(k: string) {
    const fr = frame(workers().filter((a) => groupKey(a) === k));
    if (!fr) return;
    stopGlide(); tagPop.hidden = true;
    const a = { ...cam }, t0 = performance.now(), dur = reduced.matches ? 0 : 500;
    cam.mode = 'free';
    const go = (now: number) => {
      const u = dur ? Math.min(1, (now - t0) / dur) : 1, e = u * u * (3 - 2 * u);
      cam.s = a.s + (fr.s - a.s) * e; cam.cx = a.cx + (fr.cx - a.cx) * e; cam.cy = a.cy + (fr.cy - a.cy) * e;
      applyCam();
      glide = u < 1 ? requestAnimationFrame(go) : 0;
    };
    go(t0);
  }
  homeBtn.addEventListener('click', () => { tagPop.hidden = true; setDefault(); });
  chipsEl.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-g]'); if (b) focusGroup(b.dataset.g!); });
  function measure() {
    const r = root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    hostW = r.width; hostH = r.height;
    fitS = Math.min(hostW / vb.w, hostH / vb.h);
    if (cam.mode === 'free') { cam.s = Math.max(fitS, Math.min(maxS(), cam.s)); applyCam(); } else setDefault();
  }
  const ro = new ResizeObserver(measure);
  ro.observe(root);

  const ptrs = new Map<number, [number, number]>();
  let dragDist = 0, pinch0 = 0, s0 = 1, w0: [number, number] = [0, 0];
  const toWorld = (px: number, py: number): [number, number] => { const r = svg.getBoundingClientRect(); return [cam.cx + (px - r.left - r.width / 2) / cam.s, cam.cy + (py - r.top - r.height / 2) / cam.s]; };
  /** 화면 점 (px,py) 아래에 세계 점 w가 오도록 배율 s로 맞춘다 */
  function pinTo(w: [number, number], px: number, py: number, s: number) {
    const r = svg.getBoundingClientRect();
    cam.s = Math.max(fitS, Math.min(maxS(), s));
    cam.cx = w[0] - (px - r.left - r.width / 2) / cam.s; cam.cy = w[1] - (py - r.top - r.height / 2) / cam.s;
    cam.mode = 'free'; applyCam();
  }
  const pinchStart = () => { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; s0 = cam.s; w0 = toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); dragDist = 99; };
  svg.addEventListener('pointerdown', (e) => {
    stopGlide();
    svg.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) dragDist = 0;
    if (ptrs.size === 2) pinchStart();
    svg.classList.add('drag');
  });
  svg.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { dragDist += Math.abs(dx) + Math.abs(dy); if (dragDist > 8) { cam.cx -= dx / cam.s; cam.cy -= dy / cam.s; cam.mode = 'free'; applyCam(); } }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinTo(w0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, s0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch0); }
  });
  const up = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 2) pinchStart();
    if (ptrs.size) return;
    svg.classList.remove('drag');
    if (dragDist > 8 || e.type !== 'pointerup') return;
    tap(e.clientX, e.clientY); // 조금만 움직였으면 누르기(두 번 톡에는 반응하지 않는다: 확대로 오해됨)
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); stopGlide(); pinTo(toWorld(e.clientX, e.clientY), e.clientX, e.clientY, cam.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  // iOS 사파리의 화면 확대 몸짓 막기(touch-action:none과 함께)
  root.addEventListener('gesturestart', (e) => e.preventDefault());
  svg.addEventListener('dblclick', (e) => e.preventDefault());

  // 사람 누르기 → 이름표(이름·직무·컨디션)
  function tap(px: number, py: number) {
    const [wx, wy] = toWorld(px, py);
    let best: Actor | null = null, bd = (26 / cam.s) ** 2;
    for (const a of actors.values()) { const [ax, ay] = P(a.x, a.y, a.seated ? 0.47 : 0.9); const d = (ax - wx) ** 2 + (ay - 12 - wy) ** 2; if (d < bd) { bd = d; best = a; } }
    if (!best) { tagPop.hidden = true; return; }
    const sf = best.staff, c = Math.round(Math.max(0, Math.min(1, sf.condition)) * 100);
    tagPop.innerHTML = `<b>${esc(sf.name)}</b> · ${ROLE[sf.role].job}<br>컨디션 ${c}%<i><s style="width:${c}%;background:${c < 40 ? '#b4553f' : '#7fa88a'}"></s></i>`;
    const r = root.getBoundingClientRect(), [ax, ay] = anchorOf(best);
    tagPop.style.left = `${(ax - cam.cx) * cam.s + r.width / 2}px`; tagPop.style.top = `${(ay - cam.cy) * cam.s + r.height / 2}px`;
    tagPop.hidden = false;
    const shown = tagPop.innerHTML;
    later(() => { if (tagPop.innerHTML === shown) tagPop.hidden = true; }, 4000);
  }

  // ---------- 점수·결함·말풍선 ----------
  const anchorOf = (a: Actor): [number, number] => { const [x, y] = P(a.x, a.y, a.seated ? 0.47 : 0.9); return [x, y - 30]; };
  const recentPops: { x: number; y: number; w: number; t: number }[] = [];
  function pop(at: [number, number], label: string, col: string, delay: number) {
    later(() => {
      if (disposed) return;
      const fs = 13 / cam.s, now = performance.now(), w = label.length * fs * 0.9;
      // 최근 점수 글자와 겹치면 위로 한 줄씩 올린다
      at = [at[0], at[1]];
      for (let moved = true, n = 0; moved && n < 6; n++) {
        moved = false;
        for (const r of recentPops) if (now - r.t < 2600 && Math.abs(r.x - at[0]) < (r.w + w) / 2 + fs * 0.3 && Math.abs(r.y - at[1]) < fs * 2.2) { at[1] = r.y - fs * 2.2; moved = true; }
        for (const { box: [bx, by, bw, bh] } of bubbles) if (at[0] + w / 2 > bx && at[0] - w / 2 < bx + bw && at[1] > by - fs * 0.3 && at[1] - fs < by + bh + fs * 0.5) { at[1] = by - fs * 0.6; moved = true; }
      }
      recentPops.push({ x: at[0], y: at[1], w, t: now });
      while (recentPops.length > 30) recentPops.shift();
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'pop');
      g.style.setProperty('--rise', `${f(14 / cam.s)}px`);
      g.innerHTML = `<text x="${f(at[0])}" y="${f(at[1])}" text-anchor="middle" fill="${col}" font-size="${f(fs)}" stroke-width="${f(fs / 4)}">${esc(label)}</text>`;
      fx.append(g);
      later(() => g.remove(), 2700);
    }, delay);
  }
  const signAnchor = (): [number, number] => { const w = room!.walls.find((q) => q.kind === 'sign')!; return P(w.at + w.w / 2, 0, w.z + w.h + 0.2); };
  function bubble(a: Actor, text: string) {
    const old = bubbles.findIndex((b) => b.id === a.staff.id);
    if (old >= 0) dropBubble(old);
    if (bubbles.length >= 2) dropBubble(0);
    const fs = 13 / cam.s, h = fs * 1.9, [ax, ay] = anchorOf(a);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'bub');
    g.innerHTML = `<text font-size="${f(fs)}">${esc(text)}</text>`;
    fxBub.append(g);
    const w = ((g.firstChild as SVGTextElement).getComputedTextLength() || text.length * fs) + fs * 1.2;
    const x = ax - w / 2, y = ay - h - fs * 0.5, tl = fs * 0.35, r = fs * 0.35;
    g.innerHTML = `<path stroke-width="${f(1 / cam.s)}" d="M${f(x + r)},${f(y)} h${f(w - 2 * r)} q${f(r)},0 ${f(r)},${f(r)} v${f(h - 2 * r)} q0,${f(r)} ${f(-r)},${f(r)} H${f(ax + tl)} l${f(-tl)},${f(tl * 1.3)} l${f(-tl)},${f(-tl * 1.3)} H${f(x + r)} q${f(-r)},0 ${f(-r)},${f(-r)} v${f(2 * r - h)} q0,${f(-r)} ${f(r)},${f(-r)} z"/><text x="${f(ax)}" y="${f(y + h / 2 + fs * 0.36)}" text-anchor="middle" font-size="${f(fs)}">${esc(text)}</text>`;
    const b = { id: a.staff.id, g, box: [x, y, w, h + tl] as [number, number, number, number] };
    bubbles.push(b);
    later(() => { const i = bubbles.indexOf(b); if (i >= 0) dropBubble(i); }, 3500);
  }
  function dropBubble(i: number) { const [b] = bubbles.splice(i, 1); b.g.classList.add('out'); later(() => b.g.remove(), 400); }
  function moodOf(a: Actor): Mood {
    const v = view!;
    if (a.staff.condition < 0.4 && Math.random() < 0.6) return 'tired';
    if (v.phase === 'rest' || !a.staff.working) return 'rest';
    if (v.budget !== 'normal' && Math.random() < 0.3) return v.budget;
    return v.phase;
  }
  const rnd = <T>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];
  function autoTalk() {
    if (!view || bubbles.length >= 2) return;
    const a = rnd([...actors.values()].filter((x) => !bubbles.some((b) => b.id === x.staff.id)));
    if (a) bubble(a, pickLine(moodOf(a), a.staff.role));
  }
  function pingBugs() { const g = signEls?.bugi; if (!g || reduced.matches) return; g.classList.remove('ping'); void g.getBoundingClientRect(); g.classList.add('ping'); }

  // ---------- 실행·정지 ----------
  const running = () => active && !document.hidden && !disposed && !!view;
  function kick() { if (running() && !raf) { if (idle) { clearTimeout(idle); idle = 0; } last = 0; raf = requestAnimationFrame(step); } }
  function run() {
    root.classList.toggle('paused', !running());
    if (running()) { if (!nextTalk) nextTalk = performance.now() + 5000; kick(); }
    else { if (raf) cancelAnimationFrame(raf); if (idle) clearTimeout(idle); raf = 0; idle = 0; }
  }
  const onVis = () => run();
  document.addEventListener('visibilitychange', onVis);

  return {
    update(v) {
      if (disposed) return;
      const key = JSON.stringify([v.level, v.staff.map((s) => [s.id, s.role, s.name, !!s.elite]).sort(), v.carSvg ?? '', kitOf(v.year), v.execs ?? []]);
      const lvChanged = !view || view.level !== v.level, phaseChanged = !!view && view.phase !== v.phase;
      view = v;
      const rebuilt = key !== structKey;
      if (rebuilt) { structKey = key; build(v); if (lvChanged) cam.mode = 'auto'; }
      applyState(v);
      // 사용자가 옮기거나 확대한 뒤에는 그대로 둔다(등급이 바뀌면 다시 맞춤)
      if (rebuilt) measure(); else if (phaseChanged && cam.mode === 'auto') setDefault(); else updateChips();
      run();
    },
    emit(events) {
      if (disposed || !view) return;
      const per = new Map<string, Map<Stat, number>>();
      for (const e of events) {
        if (e.kind === 'score') {
          if (!actors.has(e.staffId)) continue;
          const m = per.get(e.staffId) ?? new Map<Stat, number>();
          m.set(e.stat, (m.get(e.stat) ?? 0) + e.amount); per.set(e.staffId, m);
        } else if (e.kind === 'defectFound' || e.kind === 'defectFixed') {
          const pref: Role = e.kind === 'defectFound' ? 'tester' : 'engineer';
          const a = (e.staffId && actors.get(e.staffId)) || rnd([...actors.values()].filter((x) => x.staff.role === pref));
          pop(a ? anchorOf(a) : signAnchor(), e.kind === 'defectFound' ? '결함 발견' : '결함 수정', e.kind === 'defectFound' ? '#a84e3a' : '#5d5592', e.kind === 'defectFound' ? 0 : 500);
          pingBugs();
        } else {
          const a = (e.staffId && actors.get(e.staffId)) || rnd([...actors.values()]);
          if (a) bubble(a, e.text ?? pickLine(e.mood ?? moodOf(a), a.staff.role));
        }
      }
      // 점수: 큰 순서로 5명까지 각자 위에, 나머지는 직무 구역별 합계로 한 번씩
      const rows = [...per].map(([id, m]) => { const top1 = [...m].sort((x, y) => y[1] - x[1])[0]; return { a: actors.get(id)!, stat: top1[0], amount: [...m.values()].reduce((s, x) => s + x, 0) }; })
        .sort((x, y) => y.amount - x.amount);
      const solo = rows.length <= 6 ? rows : rows.slice(0, 5), rest = rows.length <= 6 ? [] : rows.slice(5);
      const groups = new Map<Role, typeof rows>();
      for (const r of rest) groups.set(r.a.staff.role, [...(groups.get(r.a.staff.role) ?? []), r]);
      const shows: { at: [number, number]; label: string; col: string }[] = solo.map((r) => ({ at: anchorOf(r.a), label: `${r.stat} +${r.amount}`, col: STAT_COL[r.stat] }));
      for (const [role, g] of groups) {
        const ps = g.map((r) => anchorOf(r.a)), sum = new Map<Stat, number>();
        for (const r of g) sum.set(r.stat, (sum.get(r.stat) ?? 0) + r.amount);
        const [st, n] = [...sum].sort((x, y) => y[1] - x[1])[0];
        shows.push({ at: [ps.reduce((s, p) => s + p[0], 0) / ps.length, Math.min(...ps.map((p) => p[1]))], label: `${ROLE[role].job} ${g.length}명 ${st} +${n}`, col: STAT_COL[st] });
      }
      shows.sort(() => Math.random() - 0.5).forEach((s, i) => pop(s.at, s.label, s.col, i * 420));
    },
    setActive(on) { active = on; run(); },
    dispose() {
      disposed = true; run(); stopGlide();
      for (const t of timeouts) clearTimeout(t);
      timeouts.clear(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      root.remove();
    },
  };
}
