// 사무실 배치 계산(순수 함수, DOM 없음). 단위는 바닥 칸(1칸 = 쿼터뷰 타일 하나).
// 좌표: x는 화면 오른쪽 아래로, y는 왼쪽 아래로 늘어난다. (0,0)이 뒤쪽 구석, x=0 면이 왼쪽 벽, y=0 면이 오른쪽 벽.

export type Level = 1 | 2 | 3 | 4 | 5;
export type PropKind =
  | 'boxes' | 'shelf' | 'bulb' | 'plant' | 'whiteboard' | 'window' | 'clock'
  | 'cooler' | 'meeting' | 'equipment' | 'sofa' | 'plinth' | 'sign';

/** 바닥 소품은 x,y,w,d(바닥 칸), 벽 소품은 wall('L'=x=0 벽, 'R'=y=0 벽)과 벽을 따라간 위치 at·폭 w·높이 z,h */
export interface Prop { kind: PropKind; x: number; y: number; w: number; d: number; wall?: 'L' | 'R'; z?: number; h?: number }
export interface Room { level: Level; name: string; cols: number; rows: number; W: number; D: number; H: number; floor: 'concrete' | 'tile' | 'wood'; props: Prop[] }
export interface Seat { x: number; y: number; col: number; row: number; used: boolean }

export const CAPACITY: Record<Level, number> = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20 };
const GRID: Record<Level, [number, number]> = { 1: [2, 2], 2: [4, 2], 3: [4, 3], 4: [4, 4], 5: [5, 4] };
const NAME: Record<Level, string> = { 1: '창고 공장', 2: '소형 사옥', 3: '본사 빌딩', 4: '연구 단지', 5: '글로벌 본사' };

// 책상 한 자리: 책상 2.2×1.1칸, 사람과 의자는 책상 뒤(작은 y). 간격 SX·SY는 사람이 서로 겹치지 않게 고른 값.
export const DESK = { w: 2.2, d: 1.1 };
export const SX = 3.0, SY = 2.7;
const X0 = 1.7;   // 왼쪽 벽 쪽 띠(받침대·상자) 폭
const Y0 = 2.5;   // 오른쪽 벽 쪽 띠(선반·정수기) + 의자 자리
const LOUNGE = 2.8; // 등급 3 이상: 오른쪽 끝 휴게 칸(회의 탁자·연구 장비)

const clampLevel = (l: number): Level => Math.max(1, Math.min(5, Math.round(l) || 1)) as Level;

export function roomFor(level: number): Room {
  const lv = clampLevel(level), [cols, rows] = GRID[lv];
  const lounge = lv >= 3 ? LOUNGE : 0;
  const deskEnd = X0 + (cols - 1) * SX + DESK.w;
  const W = deskEnd + 0.7 + lounge;
  const D = Y0 + (rows - 1) * SY + DESK.d + 1.0;
  const H = lv === 1 ? 2.8 : 3.2;
  const p: Prop[] = [];
  const wallR = (kind: PropKind, at: number, w: number, z: number, h: number) => p.push({ kind, x: at, y: 0, w, d: 0, wall: 'R', z, h });
  const wallL = (kind: PropKind, at: number, w: number, z: number, h: number) => p.push({ kind, x: 0, y: at, w, d: 0, wall: 'L', z, h });
  const floor = (kind: PropKind, x: number, y: number, w: number, d: number) => p.push({ kind, x, y, w, d });

  // 공통: 왼쪽 앞 구석의 차 받침대, 오른쪽 벽의 개발 표지판
  floor('plinth', 0.25, D - 2.5, 1.2, 2.1);
  wallR('sign', 0.5, Math.min(4.2, W * 0.42), 1.7, 1.2);
  if (lv === 1) {
    floor('boxes', 0.25, 0.3, 1.1, 1.1);
    floor('boxes', 0.3, 1.6, 0.9, 0.9);
    floor('shelf', W - 1.6, 0.2, 1.3, 0.7);
    wallR('window', W - 2.4, 1.4, 2.1, 0.6);
    p.push({ kind: 'bulb', x: W * 0.45, y: D * 0.5, w: 0, d: 0, z: H });
  } else {
    wallL('whiteboard', 0.6, Math.min(3.2, D * 0.35), 1.2, 1.4);
    wallL('clock', D * 0.35 + 1.4, 0.7, 2.1, 0.7);
    floor('plant', W - 0.9, 0.25, 0.6, 0.6);
    floor('boxes', 0.3, 0.4, 0.9, 0.9);
    const nWin = lv >= 5 ? 3 : lv >= 3 ? 2 : 1;
    const start = Math.min(4.2, W * 0.42) + 1.0, span = W - start - 1.2;
    for (let i = 0; i < nWin; i++) wallR('window', start + (span / nWin) * i + 0.2, span / nWin - 0.4, 1.2, 1.5);
  }
  if (lv >= 2) floor('shelf', 2.0, 0.2, 1.3, 0.7);
  if (lv >= 3) {
    const lx = deskEnd + 0.7;
    floor('cooler', 3.7, 0.25, 0.6, 0.6);
    floor('meeting', lx + 0.2, Y0 - 1.0, 2.2, 1.6);
    floor('plant', 0.35, D * 0.45, 0.6, 0.6);
  }
  if (lv >= 4) {
    const lx = deskEnd + 0.7;
    floor('equipment', lx + 0.3, D - 2.4, 2.0, 1.4);
    wallL('whiteboard', D * 0.35 + 2.4, Math.min(2.6, D * 0.3), 1.2, 1.4);
  }
  if (lv >= 5) {
    const lx = deskEnd + 0.7;
    floor('sofa', lx + 0.3, Y0 + 1.6, 2.0, 1.0);
    floor('plant', W - 0.9, D - 0.9, 0.6, 0.6);
  }
  return { level: lv, name: NAME[lv], cols, rows, W, D, H, floor: lv === 1 ? 'concrete' : lv >= 4 ? 'wood' : 'tile', props: p };
}

/** 등급의 책상 자리(정원만큼). 뒤 줄부터 앞으로, 줄 안에서는 왼쪽부터 채운다(빈 책상은 앞쪽에 남아 아무도 가리지 않는다).
 *  staffCount가 정원을 넘으면 넘친 사람은 자리가 없다(used는 정원까지만). */
export function seatsFor(level: number, staffCount: number): Seat[] {
  const lv = clampLevel(level), [cols, rows] = GRID[lv], n = Math.max(0, Math.floor(staffCount));
  const out: Seat[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    out.push({ x: X0 + c * SX, y: Y0 + r * SY, col: c, row: r, used: out.length < n });
  return out;
}
