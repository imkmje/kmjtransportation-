// 쿼터뷰 미니어처 사무실(design.md 13.1). 2D SVG, 보여 주기 전용: sim을 import하지 않고 뷰 자료만 받는다.
// 그림 방식은 시안 B(쿼터뷰), 사람 머리는 시안 D처럼 크게. 난수는 연출에만 쓴다(직원 외모는 id 해시로 고정).
import './office.css';
import { roomFor, seatsFor, DESK, CAPACITY, type Prop, type Room, type Seat } from './layout';
import { pickLine, type Mood } from './lines';

export type Role = 'designer' | 'engineer' | 'tester' | 'sales';
export interface OfficeStaff { id: string; name: string; role: Role; condition: number /*0~1, 낮으면 지침*/; working: boolean /*프로젝트에 배치됨*/ }
export interface OfficeView {
  level: 1 | 2 | 3 | 4 | 5;
  staff: OfficeStaff[];
  phase: 'rest' | 'design' | 'test';
  budget: 'low' | 'normal' | 'high';
  projectName?: string;
  carSvg?: string;      // 우리 코드가 만든 옆모습 SVG(silhouetteSvg). 그대로 끼워 넣으므로 외부 입력을 넣지 말 것
  progress?: number;
  defects?: number;
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

// ---------- 그림 상수 ----------
const U = 34;                       // 바닥 한 칸의 화면 폭 절반(사용자 단위)
const INK = '#14171c';
const ROLE: Record<Role, { col: string; dk: string; rug: string; order: number; job: string }> = {
  designer: { col: '#ff6f9f', dk: '#de4f81', rug: '#ffe0ea', order: 0, job: '디자이너' },
  engineer: { col: '#4a86ff', dk: '#2f66d6', rug: '#dfe9ff', order: 1, job: '엔지니어' },
  tester: { col: '#25a86b', dk: '#17844f', rug: '#d9f2e5', order: 2, job: '테스터' },
  sales: { col: '#ff9a2e', dk: '#d9761a', rug: '#ffead2', order: 3, job: '영업' },
};
const STAT_COL: Record<Stat, string> = { 성능: '#e2541f', 연비: '#12915a', 실용: '#1f8fa8', 디자인: '#d23f78', 품질: '#6a4fd0' };
const HAIR = ['#23262e', '#3b2a20', '#6b3b2a', '#8a5a2b', '#5a4632', '#c98a4b'];
const SKIN: [string, string][] = [['#ffd9bd', '#efb48f'], ['#f6cba5', '#e2a77f'], ['#e8b48c', '#cf9068']];
const STYLES = ['short', 'bob', 'bun', 'curly'] as const;
const PERSON = { tw: 13, tb: 15, th: 34, hr: 19, neck: 0, al: 22, aw: 8, sx: 11, sy: 7, base: 18, po: 0.62 };
const K = 1.35;                     // 사람 크기 배율
const HEAD_TOP = -(PERSON.th + PERSON.neck + 2.1 * PERSON.hr) * K;

const f = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const P = (x: number, y: number, z = 0): [number, number] => [f((x - y) * U), f(((x + y) * U) / 2 - z * U)];
const poly = (pts: [number, number][], fill: string, extra = '') => `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
/** 바닥에 놓인 상자: 앞 두 면 + 윗면 */
const box = (x: number, y: number, z: number, w: number, d: number, h: number, ct: string, cl: string, cr: string) =>
  poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], cl) +
  poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], cr) +
  poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], ct);
/** 벽에 붙인 평면 그림: 오른쪽 벽(y=0)은 x를 따라, 왼쪽 벽(x=0)은 화면 오른쪽 = y가 줄어드는 쪽 */
const onWall = (pr: Prop, inner: string) => {
  const z = (pr.z ?? 0) + (pr.h ?? 0);
  const [X, Y] = pr.wall === 'R' ? P(pr.x, 0, z) : P(0, pr.y + pr.w, z);
  return `<g transform="matrix(1 ${pr.wall === 'R' ? 0.5 : -0.5} 0 1 ${X} ${Y})">${inner}</g>`;
};

/** 문자열 해시(FNV-1a) → 같은 직원은 늘 같은 모습 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
interface Look { hair: string; style: typeof STYLES[number]; glasses: boolean; skin: [string, string]; v: number }
function lookOf(id: string): Look {
  const h = hash(id);
  return { hair: HAIR[h % HAIR.length], style: STYLES[(h >>> 4) % STYLES.length], glasses: (h >>> 7) % 4 === 0, skin: SKIN[(h >>> 10) % SKIN.length], v: (h >>> 13) % 4 };
}

// ---------- 사람(시안 personFront/headFront, 큰 머리) ----------
function head(lk: Look, r: number): string {
  const ex = 0.36 * r, ey = 0.12 * r, [sk] = lk.skin, hc = lk.hair;
  let s = `<g transform="translate(0,${-r})">`;
  if (lk.style === 'bob') s += `<path d="M${f(-1.1 * r)},${f(0.15 * r)} A${f(1.1 * r)} ${f(1.08 * r)} 0 1 1 ${f(1.1 * r)},${f(0.15 * r)} L${f(1.02 * r)},${f(0.85 * r)} Q${f(0.8 * r)},${f(0.98 * r)} ${f(0.6 * r)},${f(0.8 * r)} L${f(-0.6 * r)},${f(0.8 * r)} Q${f(-0.8 * r)},${f(0.98 * r)} ${f(-1.02 * r)},${f(0.85 * r)} Z" fill="${hc}"/>`;
  if (lk.style === 'bun') s += `<circle cy="${f(-1.02 * r)}" r="${f(0.4 * r)}" fill="${hc}"/>`;
  if (lk.style === 'curly') s += [-0.8, -0.4, 0, 0.4, 0.8].map((d) => `<circle cx="${f(d * r)}" cy="${f(-0.75 * r + Math.abs(d) * 0.35 * r)}" r="${f(0.38 * r)}" fill="${hc}"/>`).join('');
  s += `<circle r="${r}" fill="${sk}"/>`;
  s += `<path d="M${f(-1.02 * r)},${f(0.08 * r)} A${r} ${r} 0 0 1 ${f(1.02 * r)},${f(0.08 * r)} Q${f(0.7 * r)},${f(-0.55 * r)} ${f(0.1 * r)},${f(-0.42 * r)} Q${f(-0.55 * r)},${f(-0.3 * r)} ${f(-1.02 * r)},${f(0.08 * r)} Z" fill="${hc}"/>`;
  s += `<g class="eo">${[-1, 1].map((d) => `<ellipse cx="${f(d * ex)}" cy="${f(ey)}" rx="${f(0.13 * r)}" ry="${f(0.18 * r)}" fill="${INK}"/><circle cx="${f(d * ex + 0.04 * r)}" cy="${f(ey - 0.06 * r)}" r="${f(0.05 * r)}" fill="#fff"/>`).join('')}</g>`;
  s += `<g class="ec">${[-1, 1].map((d) => `<path d="M${f(d * ex - 0.13 * r)},${f(ey)} Q${f(d * ex)},${f(ey + 0.09 * r)} ${f(d * ex + 0.13 * r)},${f(ey)}" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`).join('')}</g>`;
  if (lk.glasses) s += `<g fill="none" stroke="${INK}" stroke-width="1.6">${[-1, 1].map((d) => `<circle cx="${f(d * ex)}" cy="${f(ey)}" r="${f(0.23 * r)}"/>`).join('')}<path d="M${f(-ex + 0.23 * r)},${f(ey)} H${f(ex - 0.23 * r)}"/></g>`;
  s += [-1, 1].map((d) => `<ellipse cx="${f(d * 0.6 * r)}" cy="${f(0.4 * r)}" rx="${f(0.14 * r)}" ry="${f(0.08 * r)}" fill="#ff8fa3" opacity=".55"/>`).join('');
  s += `<path class="mo" d="M${f(-0.13 * r)},${f(0.42 * r)} Q0,${f(0.56 * r)} ${f(0.13 * r)},${f(0.42 * r)}" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  s += `<path class="mt" d="M${f(-0.1 * r)},${f(0.5 * r)} Q0,${f(0.44 * r)} ${f(0.1 * r)},${f(0.5 * r)}" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  // 지침(파란 물결)과 땀방울
  s += `<g transform="translate(0,${f(-1.3 * r)}) scale(.6)"><g class="gloom"><path d="M-14,0 q4,-5 0,-10 q-4,-5 0,-10 M0,-4 q4,-5 0,-10 q-4,-5 0,-10 M14,0 q4,-5 0,-10 q-4,-5 0,-10" fill="none" stroke="#6a7bd8" stroke-width="3" stroke-linecap="round"/></g></g>`;
  s += `<g transform="translate(${f(0.98 * r)},${f(-0.45 * r)}) scale(.7)"><path class="sweat" d="M0,-9 Q7,2 0,7 Q-7,2 0,-9Z" fill="#8fd0ff" stroke="#3b8fd6" stroke-width="1.5"/></g>`;
  return s + '</g>';
}
const ARM = {
  L: '--up:1;--str:175deg;--sip:0deg;--sc1:0deg;--sc2:0deg;--call:0deg',
  R: '--up:-1;--str:-175deg;--sip:140deg;--sc1:-95deg;--sc2:-135deg;--call:183deg',
};
function hand(role: Role, side: 'L' | 'R'): string {
  if (side === 'L') return role === 'tester' ? `<g class="prop clip"><rect x="-12" y="-6" width="26" height="32" rx="3" fill="#f6d28b" stroke="${INK}" stroke-width="2"/><rect x="-8" y="0" width="18" height="21" fill="#fff"/><path d="M-5,6h12M-5,11h12M-5,16h8" stroke="#8b94a1" stroke-width="2"/></g>` : '';
  return `<g class="prop cup"><rect x="-6" y="-18" width="16" height="18" rx="3" fill="#fff" stroke="${INK}" stroke-width="2"/><path d="M10,-14 q6,0 6,5 q0,5 -6,5" fill="none" stroke="${INK}" stroke-width="2"/><path class="steam" d="M-1,-23 q-3,-5 0,-9 M5,-23 q3,-5 0,-9" stroke="#9aa3ae" stroke-width="2" fill="none" stroke-linecap="round"/></g>
   <g class="prop mag"><line x1="0" y1="0" x2="9" y2="-10" stroke="#7a4b2a" stroke-width="5" stroke-linecap="round"/><circle cx="17" cy="-19" r="11" fill="#d9f0ff" fill-opacity=".75" stroke="${INK}" stroke-width="4"/></g>
   <g class="prop pen"><line x1="-3" y1="3" x2="9" y2="-14" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><line x1="-3" y1="3" x2="-1" y2="0" stroke="#ff6f9f" stroke-width="4" stroke-linecap="round"/></g>
   <g class="prop phone"><rect x="-5" y="-16" width="10" height="20" rx="2.5" fill="${INK}"/><rect x="-3" y="-13" width="6" height="12" rx="1" fill="#a8e4ff"/></g>`;
}
function person(role: Role, lk: Look): string {
  const c = PERSON, rc = ROLE[role];
  const arm = (side: 'L' | 'R') => {
    const sg = side === 'L' ? -1 : 1;
    return `<g transform="translate(${sg * c.sx},${-c.th + c.sy}) rotate(${sg * c.base})"><g class="arm arm${side}" style="${ARM[side]}">
      <rect x="${-c.aw / 2}" y="${-c.aw / 2}" width="${c.aw}" height="${c.al + c.aw / 2}" rx="${c.aw / 2}" fill="${rc.dk}"/>
      <g transform="translate(0,${c.al})"><g transform="scale(${c.po})">${hand(role, side)}</g><circle r="${f(c.aw * 0.58)}" fill="${lk.skin[0]}"/></g></g></g>`;
  };
  return `<g class="pose"><g class="bob">
   <path d="M${-c.tb},0 L${-c.tw},${-c.th + 12} Q${-c.tw},${-c.th} ${-c.tw + 12},${-c.th} L${c.tw - 12},${-c.th} Q${c.tw},${-c.th} ${c.tw},${-c.th + 12} L${c.tb},0 Z" fill="${rc.col}"/>
   <path d="M${f(-c.tw * 0.35)},${-c.th} L0,${f(-c.th + c.tw * 0.4)} L${f(c.tw * 0.35)},${-c.th}" fill="#fff"/>
   <g transform="translate(0,${-c.th - c.neck})"><g class="hd"><g class="head">${head(lk, c.hr)}</g></g></g>
   ${arm('L')}${arm('R')}</g></g>`;
}

// ---------- 방 ----------
function shell(rm: Room): string {
  const { W, D, H } = rm;
  const wallL = rm.level === 1 ? '#d9d4ca' : '#dfe4ea', wallR = rm.level === 1 ? '#cbc5ba' : '#cfd6df';
  let s = poly([P(0, 0), P(0, D), P(0, D, H), P(0, 0, H)], wallL) + poly([P(0, 0), P(W, 0), P(W, 0, H), P(0, 0, H)], wallR);
  s += poly([P(0, 0, H), P(0, D, H), P(-0.25, D, H), P(-0.25, -0.25, H), P(W, -0.25, H), P(W, 0, H)], '#b9c1cc');
  // 바닥: 등급 1은 시멘트, 2~3은 바둑판 타일, 4~5는 나무
  const tile: Record<Room['floor'], [string, string]> = { concrete: ['#e6e2da', '#dedad1'], tile: ['#f6f7f9', '#e9edf2'], wood: ['#f1e2cc', '#ead6bb'] };
  const [t1, t2] = tile[rm.floor];
  s += poly([P(0, 0), P(W, 0), P(W, D), P(0, D)], t1);
  if (rm.floor === 'wood') for (let j = 0; j < Math.ceil(D); j += 1) s += poly([P(0, j), P(W, j), P(W, Math.min(D, j + 0.5)), P(0, Math.min(D, j + 0.5))], t2);
  else for (let i = 0; i < Math.ceil(W); i++) for (let j = 0; j < Math.ceil(D); j++) if ((i + j) % 2)
    s += poly([P(i, j), P(Math.min(W, i + 1), j), P(Math.min(W, i + 1), Math.min(D, j + 1)), P(i, Math.min(D, j + 1))], t2);
  // 걸레받이
  s += poly([P(0, 0), P(0, D), P(0, D, 0.12), P(0, 0, 0.12)], '#c3cad4') + poly([P(0, 0), P(W, 0), P(W, 0, 0.12), P(0, 0, 0.12)], '#b6bec9');
  return s;
}
function wallProp(pr: Prop): string {
  const w = pr.w * U, h = (pr.h ?? 1) * U;
  switch (pr.kind) {
    case 'window': return onWall(pr, `<rect width="${w}" height="${h}" fill="#bfe6ff" stroke="#fff" stroke-width="5"/><path d="M${w / 2},0 V${h}" stroke="#fff" stroke-width="4"/><path d="M${w * 0.15},${h * 0.75} l${w * 0.15},${-h * 0.4} M${w * 0.6},${h * 0.7} l${w * 0.12},${-h * 0.3}" stroke="#e6f6ff" stroke-width="6" stroke-linecap="round"/>`);
    case 'whiteboard': return onWall(pr, `<rect width="${w}" height="${h}" rx="4" fill="#fff" stroke="#9aa3ae" stroke-width="3"/><path d="M${w * 0.12},${h * 0.35} q${w * 0.15},${-h * 0.25} ${w * 0.3},0 t${w * 0.3},0" fill="none" stroke="#4a86ff" stroke-width="4" stroke-linecap="round"/><path d="M${w * 0.12},${h * 0.65} h${w * 0.45} M${w * 0.12},${h * 0.82} h${w * 0.3}" stroke="#c9d0d9" stroke-width="5" stroke-linecap="round"/><rect x="${w * 0.7}" y="${h * 0.55}" width="${w * 0.18}" height="${h * 0.3}" fill="#ffe27a"/>`);
    case 'clock': { const r = Math.min(w, h) / 2; return onWall(pr, `<circle cx="${r}" cy="${r}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="4"/><rect x="${r - 2}" y="${r * 0.35}" width="4" height="${r * 0.68}" rx="2" fill="${INK}"/><g transform="translate(${r},${r})"><g class="clockh"><rect x="-1.5" y="${-r * 0.8}" width="3" height="${r * 0.85}" rx="1.5" fill="#ff5a1f"/></g></g>`); }
    default: return '';
  }
}
function floorProp(pr: Prop): string {
  const { x, y, w, d } = pr;
  switch (pr.kind) {
    case 'boxes': return box(x, y, 0, w, d, 0.6, '#e0b27e', '#c9945c', '#b5814a') + box(x + 0.1, y + 0.15, 0.6, w * 0.7, d * 0.7, 0.45, '#e8be8c', '#d19f68', '#bb8a52') + poly([P(x + w * 0.45, y, 0.6), P(x + w * 0.45, y + d, 0.6)], 'none', 'stroke="#b07a42" stroke-width="3"');
    case 'shelf': return box(x, y, 0, w, d, 1.6, '#9aa3ae', '#8b94a1', '#77808c') + [0.45, 0.95].map((z, i) => box(x + 0.1, y + d - 0.05, z, w - 0.2, 0.02, 0.38, i ? '#ffb3cc' : '#ffe27a', i ? '#ff8fb0' : '#f6d050', '#ccc')).join('');
    case 'plant': { const [cx, cy] = P(x + w / 2, y + d / 2, 0.9); return box(x, y, 0, w, d, 0.5, '#c98a5b', '#b07043', '#9a5f37') + `<circle cx="${cx}" cy="${cy}" r="20" fill="#5fbf7f"/><circle cx="${cx - 10}" cy="${cy + 5}" r="12" fill="#48a96a"/><circle cx="${cx + 9}" cy="${cy - 9}" r="10" fill="#6fd08f"/>`; }
    case 'cooler': { const [cx, cy] = P(x + w / 2, y + d / 2, 1.35); return box(x, y, 0, w, d, 1.05, '#ffffff', '#e5e9ee', '#cfd6df') + `<ellipse cx="${cx}" cy="${cy + 6}" rx="11" ry="6" fill="#8fcfff"/><rect x="${cx - 11}" y="${cy - 14}" width="22" height="20" rx="8" fill="#8fcfff" opacity=".9"/>`; }
    case 'meeting': {
      let s = '';
      const chairs: [number, number][] = [[x + 0.5, y - 0.45], [x + 1.4, y - 0.45]];
      chairs.forEach(([cx, cy]) => { s += box(cx, cy, 0, 0.5, 0.4, 0.45, '#ff9b73', '#e57b52', '#cc6a44'); });
      s += box(x, y, 0, w, d, 0.7, '#f5efe6', '#ddd2c3', '#c8bba9');
      const [px, py] = P(x + w * 0.35, y + d * 0.4, 0.7); s += `<rect x="${px - 10}" y="${py - 5}" width="20" height="12" rx="2" fill="#fff" stroke="#c9d0d9" stroke-width="2"/>`;
      return s;
    }
    case 'equipment': {
      const [sx, sy] = P(x + 0.3, y + 0.2, 1.75);
      return box(x, y, 0, w, d, 0.9, '#5b6470', '#4a525d', '#3c434d') + box(x + 0.3, y + 0.25, 0.9, 1.0, 0.8, 0.5, '#9aa3ae', '#7d8794', '#6c7581') +
        box(x + 1.4, y + 0.3, 0.9, 0.45, 0.45, 0.9, '#ff7a45', '#e04a12', '#c93f0c') + `<rect x="${sx - 12}" y="${sy - 6}" width="30" height="16" rx="3" fill="#a8e4ff" class="code"/>`;
    }
    case 'sofa': return box(x, y + d * 0.7, 0, w, d * 0.3, 0.75, '#7c8ce0', '#6577cf', '#5465bb') + box(x, y, 0, w, d * 0.7, 0.4, '#8d9cec', '#6f80d6', '#5d6dc2');
    case 'plinth': return box(x, y, 0, w, d, 0.35, '#ffffff', '#dfe4ea', '#c9d0d9');
    default: return '';
  }
}

// ---------- 화면 배치 ----------
interface Placed { staff: OfficeStaff; seat: Seat; look: Look; anchor: [number, number] }
const sortStaff = (a: OfficeStaff, b: OfficeStaff) => ROLE[a.role].order - ROLE[b.role].order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createOffice(host: HTMLElement): Office {
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.createElement('div');
  root.className = 'office';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const world = document.createElementNS(NS, 'g');
  const fx = document.createElementNS(NS, 'g');
  const fxBub = document.createElementNS(NS, 'g'); // 말풍선은 점수 위에 그려 가려지지 않게
  svg.append(world, fx, fxBub);
  root.append(svg);
  host.append(root);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let view: OfficeView | null = null;
  let structKey = '';
  let placed = new Map<string, Placed>();
  let vb = { ox: 0, oy: 0, w: 1, h: 1 };
  let scale = 1;                     // 화면 px / 사용자 단위
  let active = true, disposed = false;
  let timer = 0, nextAuto = 0;
  const bubbles: { id: string; g: SVGGElement; t: number }[] = [];
  const timeouts = new Set<number>();
  const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timeouts.delete(t); fn(); }, ms); timeouts.add(t); };
  let signEls: { name: SVGTextElement; bar: SVGRectElement; barW: number; bugs: SVGGElement; bugn: SVGTextElement; bugi: SVGGElement; bugk: SVGGElement } | null = null;

  const minFs = (u: number, px: number) => Math.max(u, px / scale);   // 사용자 단위 글자 크기의 화면 최소값 보장

  function build(v: OfficeView) {
    const rm = roomFor(v.level);
    const staff = [...v.staff].sort(sortStaff).slice(0, CAPACITY[rm.level]);
    const seats = seatsFor(rm.level, staff.length);
    // 뷰박스: 방의 투영 범위(벽 위 + 말풍선 여유)
    const minX = -rm.D * U - 14, maxX = rm.W * U + 14, minY = -(rm.H + 0.25) * U - 1.0 * U, maxY = ((rm.W + rm.D) * U) / 2 + 14;
    vb = { ox: -minX, oy: -minY, w: maxX - minX, h: maxY - minY };
    svg.setAttribute('viewBox', `0 0 ${f(vb.w)} ${f(vb.h)}`);
    svg.setAttribute('aria-label', `${rm.name} 사무실, 직원 ${staff.length}명`);

    placed = new Map();
    let s = `<g transform="translate(${f(vb.ox)},${f(vb.oy)})">` + shell(rm);
    // 벽 소품
    for (const pr of rm.props) if (pr.wall && pr.kind !== 'sign') s += wallProp(pr);
    const sign = rm.props.find((p) => p.kind === 'sign')!;
    s += signSvg(sign);
    // 직무 구역 깔개(앉은 자리 아래 연한 직무 색)
    seats.forEach((st, i) => {
      if (!st.used) return;
      s += poly([P(st.x - 0.35, st.y - 1.45), P(st.x + 2.65, st.y - 1.45), P(st.x + 2.65, st.y + 1.25), P(st.x - 0.35, st.y + 1.25)], ROLE[staff[i].role].rug, 'opacity=".85"');
    });
    // 천장 전구(등급 1): 뒤쪽 구석 위에 매달아 사람을 가리지 않게 먼저 그린다
    const bulb = rm.props.find((p) => p.kind === 'bulb');
    if (bulb) { const [bx, by] = P(bulb.x, bulb.y, rm.H - 0.5), [, ty] = P(bulb.x, bulb.y, rm.H + 0.6); s += `<path d="M${bx},${ty} V${by}" stroke="#5b6470" stroke-width="2"/><circle cx="${bx}" cy="${by + 8}" r="9" fill="#ffe27a" stroke="#d9b440" stroke-width="2"/>`; }
    // 바닥 물건: 앞뒤 순서(x+y가 작은 것부터) 정렬해 그린다
    const items: { k: number; svg: string }[] = [];
    for (const pr of rm.props) if (!pr.wall && pr.kind !== 'bulb') items.push({ k: pr.x + pr.w / 2 + pr.y + pr.d / 2, svg: floorProp(pr) + (pr.kind === 'plinth' ? carOn(pr, v.carSvg) : '') });
    let tags = '';
    seats.forEach((st, i) => {
      const sf = staff[i];
      const dx = st.x, dy = st.y, px = dx + 1.1, py = dy - 0.55;
      let g = box(px - 0.35, py - 0.7, 0, 0.7, 0.45, 0.95, '#7d8794', '#6c7581', '#5b6470') + box(px - 0.4, py - 0.35, 0, 0.8, 0.6, 0.45, '#8b94a1', '#77808c', '#67707c');
      const hp = P(px, py, 0.48);
      if (sf) {
        const lk = lookOf(sf.id);
        g += `<g transform="translate(${hp[0]},${hp[1]}) scale(${K})">${person(sf.role, lk)}</g>`;
        placed.set(sf.id, { staff: sf, seat: st, look: lk, anchor: [hp[0] + vb.ox, hp[1] + HEAD_TOP + vb.oy] });
        // 이름표: 책상 앞면 가운데에서 조금 오른쪽(앞줄 사람 몸통을 피한다)
        const tp = P(dx + DESK.w / 2, dy + DESK.d, 0.38);
        tags += `<g class="tag" data-id="${esc(sf.id)}" transform="translate(${f(tp[0] + 0.5 * U)},${tp[1]})">${tagSvg(sf)}</g>`;
      }
      g += box(dx, dy, 0, DESK.w, DESK.d, 0.75, '#ffffff', '#dfe4ea', '#c9d0d9');
      const role = sf?.role;
      if (role === 'designer') g += poly([P(dx + 0.6, dy + 0.25, 0.76), P(dx + 1.6, dy + 0.25, 0.76), P(dx + 1.6, dy + 0.85, 0.76), P(dx + 0.6, dy + 0.85, 0.76)], '#3a404a') + `<path class="code" d="M${P(dx + 0.8, dy + 0.5, 0.77)} L${P(dx + 1.3, dy + 0.4, 0.77)}" stroke="#a8e4ff" stroke-width="3"/>`;
      else {
        g += poly([P(dx + 0.65, dy + 0.3, 0.76), P(dx + 1.55, dy + 0.3, 0.76), P(dx + 1.55, dy + 0.8, 0.76), P(dx + 0.65, dy + 0.8, 0.76)], '#b9c1cc');
        g += poly([P(dx + 0.65, dy + 0.3, 0.76), P(dx + 1.55, dy + 0.3, 0.76), P(dx + 1.55, dy + 0.3, 1.32), P(dx + 0.65, dy + 0.3, 1.32)], '#8b94a1');
        g += poly([P(dx + 0.72, dy + 0.3, 0.83), P(dx + 1.48, dy + 0.3, 0.83), P(dx + 1.48, dy + 0.3, 1.25), P(dx + 0.72, dy + 0.3, 1.25)], '', 'class="scr"');
      }
      const mp = P(dx + 1.9, dy + 0.5, 0.75);
      g += `<rect x="${mp[0] - 5}" y="${mp[1] - 12}" width="10" height="12" rx="2" fill="${sf ? ROLE[sf.role].col : '#c9d0d9'}"/>`;
      items.push({ k: dx + DESK.w / 2 + dy + DESK.d / 2, svg: sf ? `<g class="seat" data-id="${esc(sf.id)}">${g}</g>` : `<g opacity=".8">${g}</g>` });
    });
    items.sort((a, b) => a.k - b.k);
    s += items.map((it) => it.svg).join('');
    s += `<g class="tags">${tags}</g></g>`;
    world.innerHTML = s;
    world.querySelectorAll<SVGGElement>('.seat').forEach((g) => (g.onclick = () => showTag(g.dataset.id!)));
    const q = <T extends Element>(sel: string) => world.querySelector(sel) as T;
    signEls = { name: q('.sign-name'), bar: q('.sign-bar'), barW: sign.w * U - 24, bugs: q('.bugs'), bugn: q('.bugn'), bugi: q('.bugi'), bugk: q('.bugk') };
    fx.replaceChildren(); fxBub.replaceChildren(); bubbles.length = 0;
  }

  function signSvg(pr: Prop): string {
    const w = pr.w * U, h = (pr.h ?? 1) * U;
    return onWall(pr, `<rect width="${w}" height="${h}" rx="10" fill="${INK}"/>
      <text class="sign-name" x="12" y="${f(h * 0.45)}" font-weight="800" fill="#fff"></text>
      <rect x="12" y="${f(h * 0.66)}" width="${w - 24}" height="${f(h * 0.14)}" rx="${f(h * 0.07)}" fill="#3a404a"/>
      <rect class="sign-bar" x="12" y="${f(h * 0.66)}" width="0" height="${f(h * 0.14)}" rx="${f(h * 0.07)}" fill="#ff5a1f"/>
      <g class="bugs" transform="translate(${w + 6},${f(h * 0.2)})" display="none"><g class="bugk"><g class="bugi"><circle r="16" fill="#d43c3c" stroke="#fff" stroke-width="3"/><text class="bugn" y="6" text-anchor="middle" font-size="18" font-weight="900" fill="#fff">0</text></g></g></g>`);
  }
  function carOn(pr: Prop, car?: string): string {
    if (!car) return '';
    const [cx, cy] = P(pr.x + pr.w / 2, pr.y + pr.d / 2, 0.35);
    const w = 2.6 * U, h = w * 0.42;
    return car.replace(/<svg\b/, `<svg x="${f(cx - w / 2)}" y="${f(cy - h + 6)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="xMidYMax meet"`);
  }
  function tagSvg(sf: OfficeStaff): string {
    const rc = ROLE[sf.role];
    return `<rect x="${-(sf.name.length + 2) / 2}em" y="-0.75em" height="1.5em" width="${sf.name.length + 2}em" rx=".75em" fill="#fff" stroke="${INK}" stroke-width="1.5"/>
      <circle cx="${-(sf.name.length + 2) / 2 + 0.75}em" cy="0" r=".3em" fill="${rc.col}"/><text x=".3em" y=".36em" text-anchor="middle" fill="${INK}">${esc(sf.name)}</text>`;
  }
  function showTag(id: string) {
    const t = world.querySelector(`.tag[data-id="${CSS.escape(id)}"]`);
    if (!t) return;
    t.classList.add('on');
    later(() => t.classList.remove('on'), 3000);
  }

  // 단계·예산·컨디션 → 직원별 동작 클래스
  function applyState(v: OfficeView) {
    const sp = v.phase === 'rest' ? 1 : { low: 0.7, normal: 1, high: 1.7 }[v.budget];
    for (const p of placed.values()) {
      const sf = v.staff.find((x) => x.id === p.staff.id) ?? p.staff;
      p.staff = sf;
      const g = world.querySelector<SVGGElement>(`.seat[data-id="${CSS.escape(sf.id)}"]`);
      if (!g) continue;
      const tired = sf.condition < 0.4;
      const act = v.phase !== 'rest' && sf.working ? v.phase : 'rest';
      g.setAttribute('class', `seat r-${sf.role} v${p.look.v} a-${act}${tired ? ' tired' : ''}${v.budget === 'high' && act !== 'rest' && !tired ? ' sw' : ''}`);
      g.style.setProperty('--sp', String(sp * (tired ? 0.5 : 1)));
    }
    if (signEls) {
      const name = v.projectName ?? (v.phase === 'rest' ? '쉬는 중' : '개발 중');
      const fs = minFs(0.42 * U, 9);
      const maxChars = Math.max(2, Math.floor(signEls.barW / (fs * 0.95)));
      signEls.name.textContent = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
      signEls.name.setAttribute('font-size', f(fs) + '');
      signEls.bar.setAttribute('width', f(signEls.barW * Math.max(0, Math.min(1, v.progress ?? 0))) + '');
      const n = v.defects ?? 0;
      signEls.bugs.setAttribute('display', v.phase === 'test' && n > 0 ? 'inline' : 'none');
      signEls.bugn.textContent = String(n);
      const k = Math.max(1, 13 / (16 * scale));
      signEls.bugk.setAttribute('transform', `scale(${f(k)})`);
    }
  }

  function measure() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    scale = Math.min(r.width / vb.w, r.height / vb.h);
    // 이름표: 화면에서 10px 이상으로 읽힐 때만 늘 표시(등급 1~2), 아니면 누른 사람만
    const tfs = 0.42 * U;
    const always = (view?.level ?? 1) <= 2 && tfs * scale >= 10;
    world.classList.toggle('tags-tap', !always);
    svg.style.setProperty('--tfs', f(always ? tfs : minFs(tfs, 12)) + 'px');
    if (view) applyState(view);
  }
  const ro = new ResizeObserver(measure);
  ro.observe(root);

  // ---------- 연출 ----------
  function pop(id: string | null, label: string, col: string, delay = 0) {
    const p = id ? placed.get(id) : null;
    const a = p ? p.anchor : signAnchor();
    later(() => {
      if (disposed) return;
      const fs = minFs(0.62 * U, 13);
      const w = label.length * fs * 0.9;
      const x = Math.max(w / 2 + 4, Math.min(vb.w - w / 2 - 4, a[0])), y = Math.max(fs + 4, a[1] - 4);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'pop');
      g.style.transformOrigin = `${x}px ${y}px`;
      g.innerHTML = `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" fill="${col}" font-size="${f(fs)}" stroke-width="${f(fs / 4)}">${esc(label)}</text>`;
      fx.append(g);
      later(() => g.remove(), 1850);
    }, delay);
  }
  function signAnchor(): [number, number] {
    const rm = roomFor(view?.level ?? 1), sign = rm.props.find((p) => p.kind === 'sign')!;
    const [x, y] = P(sign.x + sign.w / 2, 0, (sign.z ?? 0) + (sign.h ?? 0));
    return [x + vb.ox, y + vb.oy];
  }
  function bubble(id: string, text: string) {
    const p = placed.get(id);
    if (!p) return;
    const old = bubbles.findIndex((b) => b.id === id);
    if (old >= 0) dropBubble(old);
    if (bubbles.length >= 2) dropBubble(0);
    const fs = minFs(0.6 * U, 12), h = fs * 2, a = p.anchor;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'bub');
    g.innerHTML = `<text font-size="${f(fs)}">${esc(text)}</text>`;
    fxBub.append(g);
    const w = Math.round(((g.firstChild as SVGTextElement).getComputedTextLength() || text.length * fs) + fs * 1.4);
    const x = Math.max(4, Math.min(vb.w - 4 - w, a[0] - w / 2)), y = Math.max(4, a[1] - h - fs * 0.6);
    const tx = Math.max(x + h / 2, Math.min(x + w - h / 2, a[0])), rr = h / 2, tl = fs * 0.4;
    g.style.transformOrigin = `${tx}px ${y + h + tl}px`;
    g.innerHTML = `<path stroke-width="${f(Math.max(1.5, 1.6 / scale))}" d="M${f(x + rr)},${f(y)} h${f(w - 2 * rr)} a${f(rr)} ${f(rr)} 0 0 1 0 ${f(h)} H${f(tx + tl)} l${f(-tl)},${f(tl)} l${f(-tl)},${f(-tl)} H${f(x + rr)} a${f(rr)} ${f(rr)} 0 0 1 0 ${f(-h)} z"/><text x="${f(x + w / 2)}" y="${f(y + h / 2 + fs * 0.36)}" text-anchor="middle" font-size="${f(fs)}">${esc(text)}</text>`;
    const b = { id, g, t: 0 };
    bubbles.push(b);
    later(() => { const i = bubbles.indexOf(b); if (i >= 0) dropBubble(i); }, 3000);
  }
  function dropBubble(i: number) {
    const [b] = bubbles.splice(i, 1);
    b.g.classList.add('out');
    later(() => b.g.remove(), 300);
  }
  function moodOf(sf: OfficeStaff): Mood {
    const v = view!;
    if (sf.condition < 0.4 && Math.random() < 0.6) return 'tired';
    if (v.phase === 'rest' || !sf.working) return 'rest';
    if (v.budget !== 'normal' && Math.random() < 0.3) return v.budget;
    return v.phase;
  }
  const rnd = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  function staffOf(id: string | undefined, prefer?: Role): Placed | undefined {
    if (id) return placed.get(id);
    const all = [...placed.values()];
    return rnd(all.filter((p) => p.staff.role === prefer)) ?? rnd(all);
  }

  function tick() {
    if (!view || !active || document.hidden || disposed) return;
    const now = performance.now();
    if (now < nextAuto) return;
    nextAuto = now + 6000 + Math.random() * 4000;
    const free = [...placed.values()].filter((p) => !bubbles.some((b) => b.id === p.staff.id));
    if (bubbles.length >= 2 || !free.length) return;
    const p = rnd(free);
    bubble(p.staff.id, pickLine(moodOf(p.staff), p.staff.role));
  }
  function run() {
    const on = active && !document.hidden && !disposed;
    root.classList.toggle('paused', !on);
    if (on && !timer) { timer = window.setInterval(tick, 500); if (!nextAuto) nextAuto = performance.now() + 2500; }
    if (!on && timer) { clearInterval(timer); timer = 0; }
  }
  const onVis = () => run();
  document.addEventListener('visibilitychange', onVis);
  run();

  return {
    update(v) {
      if (disposed) return;
      const key = JSON.stringify([v.level, v.staff.map((s) => [s.id, s.role, s.name]).sort(), v.carSvg ?? '']);
      view = v;
      if (key !== structKey) { structKey = key; build(v); measure(); }
      applyState(v);
    },
    emit(events) {
      if (disposed || !view) return;
      const scores = new Map<string, { stat: Stat; amount: number }[]>();
      for (const e of events) {
        if (e.kind === 'score') { if (placed.has(e.staffId)) { const a = scores.get(e.staffId) ?? []; a.push({ stat: e.stat, amount: e.amount }); scores.set(e.staffId, a); } }
        else if (e.kind === 'defectFound') { const p = staffOf(e.staffId, 'tester'); pop(p?.staff.id ?? null, '결함 발견!', '#d43c3c'); pingBugs(); }
        else if (e.kind === 'defectFixed') { const p = staffOf(e.staffId, 'engineer'); pop(p?.staff.id ?? null, '결함 제거!', '#6a4fd0', 400); pingBugs(); }
        else { const p = staffOf(e.staffId); if (p) bubble(p.staff.id, e.text ?? pickLine(e.mood ?? moodOf(p.staff), p.staff.role)); }
      }
      // 점수: 사람이 많으면(9명 이상) 직원당 하나(가장 큰 항목)로 합친다. 시작 시각을 흩어 겹쳐 읽히지 않게 한다.
      const many = placed.size > 8, ids = [...scores.keys()].sort(() => Math.random() - 0.5);
      const gap = Math.min(350, 3000 / Math.max(1, ids.length));
      ids.forEach((id, i) => {
        let list = scores.get(id)!;
        if (many) {
          const sum = new Map<Stat, number>();
          for (const s of list) sum.set(s.stat, (sum.get(s.stat) ?? 0) + s.amount);
          const top = [...sum].sort((a, b) => b[1] - a[1])[0];
          list = [{ stat: top[0], amount: top[1] }];
        }
        const busy = bubbles.some((b) => b.id === id) ? 3200 : 0;
        list.forEach((s, j) => pop(id, `${s.stat} ${s.amount >= 0 ? '+' : ''}${s.amount}`, STAT_COL[s.stat], busy + i * gap + j * 900));
      });
    },
    setActive(on) { active = on; run(); },
    dispose() {
      disposed = true; run();
      for (const t of timeouts) clearTimeout(t);
      timeouts.clear();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      root.remove();
    },
  };

  function pingBugs() {
    const g = signEls?.bugi;
    if (!g || reduced.matches) return;
    g.classList.remove('ping'); void g.getBoundingClientRect(); g.classList.add('ping');
  }
}
