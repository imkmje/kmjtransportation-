// 사무실 배치 계산(순수 함수, DOM 없음). 단위는 m. 바닥 좌표: x는 화면 오른쪽 아래, y는 왼쪽 아래로 늘어난다.
// (0,0)이 뒤쪽 구석, x=0 면이 왼쪽 벽, y=0 면이 오른쪽 벽. 앞쪽 두 벽은 잘라 내고 그린다.
// 등급 → 방 크기·구역·가구·자리·서서 일하는 곳(spot), 그리고 걷기용 격자와 길찾기.

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Face = '+x' | '-x' | '+y' | '-y';
export type Role = 'designer' | 'engineer' | 'tester' | 'sales';
export type ZoneKind = 'office' | 'studio' | 'test' | 'garage' | 'pantry' | 'meeting' | 'lab' | 'lobby' | 'lounge' | 'exec' | 'elite';
export type FurnKind =
  | 'desk' | 'divider' | 'glass' | 'cabinet' | 'rack' | 'counter' | 'fridge' | 'sofa' | 'plant' | 'table' | 'mchair'
  | 'drafting' | 'clay' | 'car' | 'post' | 'cart' | 'diag' | 'workbench' | 'boxes' | 'dyno' | 'tunnel' | 'reception'
  | 'printer' | 'cooler' | 'stool' | 'xdesk';
export type WallKind = 'window' | 'whiteboard' | 'swatch' | 'sketch' | 'toolwall' | 'shutter' | 'logo' | 'sign' | 'clock';
export type SpotKind = 'test' | 'studio' | 'lab' | 'coffee' | 'meeting';

export interface Zone { kind: ZoneKind; x: number; y: number; w: number; d: number }
/** 바닥 가구: 발자국(x,y,w,d)과 높이 h. seat는 책상이 속한 자리 번호 */
export interface Furn { kind: FurnKind; x: number; y: number; w: number; d: number; h: number; seat?: number; face?: Face; elite?: true }
/** 벽 그림: 'R'=y=0 벽(at=x), 'L'=x=0 벽(at=y). z=아래쪽 높이 */
export interface WallItem { kind: WallKind; wall: 'L' | 'R'; at: number; w: number; z: number; h: number }
export interface Seat { x: number; y: number; face: Face; col: number; row: number; used: boolean; access: [number, number]; elite?: true } // elite(4.1.0): 직속 전담팀 자리
export interface Spot { kind: SpotKind; x: number; y: number; face: Face }
/** 임원 자리: 의자 위치(x,y)와 방향, 문패 위치(at: 앞 유리 x, z 높이). glass=유리방 */
export interface ExecSeat { x: number; y: number; face: Face; plate: [number, number]; glass: boolean }
export interface Grid { cols: number; rows: number; free: Uint8Array }
export interface Room {
  level: Level; name: string; W: number; D: number; H: number;
  zones: Zone[]; furn: Furn[]; walls: WallItem[]; seats: Seat[]; spots: Spot[]; execs: ExecSeat[];
  lights: [number, number][]; // 천장 조명 자리(바닥 x,y). 그림은 등급별로 다르다
  anchors: Record<Role, [number, number]>; grid: Grid;
}

export const CELL = 0.5;                 // 걷기 격자 칸(m)
const CLEAR = 0.12;                      // 가구에서 띄울 거리(m)
export const CAPACITY: Record<Level, number> = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 32, 7: 40 }; // 4인 묶음 단위(6·7등급 정원 30·40을 담는다)
export const ELITE_SEATS: Record<Level, number> = { 1: 0, 2: 0, 3: 4, 4: 5, 5: 7, 6: 8, 7: 10 }; // 4.1.0 직속 전담팀 자리(config.elite.seats와 같다). 사무 구역 뒤쪽 묶음, 금색 바닥
export const EXEC_SEATS: Record<Level, number> = { 1: 1, 2: 2, 3: 4, 4: 5, 5: 6, 6: 6, 7: 6 }; // config.exec.seats와 같다(본사 등급별 임원 자리)
const EXW = 2.2, BACKE = 3.2;            // 임원실 한 칸 폭, 깊이(오른쪽 벽 쪽 띠 안)
const NAME: Record<Level, string> = { 1: '창고 공장', 2: '소형 사옥', 3: '본사 빌딩', 4: '연구 단지', 5: '글로벌 본사', 6: '그룹 본사', 7: '글로벌 캠퍼스' };
// 4인 책상 묶음: 책상 1.4×0.75 두 개씩 마주 보고, 가운데 낮은 칸막이
const POD_W = 2.8, POD_D = 2.75;
export const DESK_H = 0.75;

const clampLevel = (l: number): Level => Math.max(1, Math.min(7, Math.round(l) || 1)) as Level;
const cache = new Map<string, Room>();

/** extraExec: 등급 자리 밖의 임원 자리(5.5.1 해외 권역에 진출하면 해외 담당 1) */
export function roomFor(level: number, extraExec = 0): Room {
  const lv = clampLevel(level), nx = EXEC_SEATS[lv] + Math.max(0, Math.min(1, Math.round(extraExec)));
  const hit = cache.get(`${lv}|${nx}`);
  if (hit) return hit;
  const regPods = CAPACITY[lv] / 4, nPods = regPods + Math.ceil(ELITE_SEATS[lv] / 4);
  const pc = lv <= 2 ? nPods : lv >= 5 ? 3 : 2, pr = Math.ceil(nPods / pc);
  const BACK = 3.4;                                    // 오른쪽 벽 쪽 띠(탕비·회의실·임원실·수납장)
  const studio = lv >= 2, glass = lv >= 3, lab = lv >= 4, lobby = lv >= 5;
  const ox = lv === 1 ? 2.6 : 6.2;                     // 사무 구역 시작 x(왼쪽에 디자인 스튜디오)
  const oy = BACK + 1.6;                               // 사무 구역 시작 y(첫 줄 의자 뒤 통로 포함)
  // 뒤쪽 띠: 탕비(0~4.8) → 회의실(3등급~) → 임원실(창가 유리방) → 간판·수납장. 임원실이 길면 건물이 넓어지고 넓어진 만큼 책상 묶음 사이 통로를 넓힌다
  const cab0 = lv === 1 ? 6.0 : lv === 2 ? 8.0 : 11.0, exEnd = cab0 + nx * EXW;
  const rxMin = lv === 1 ? exEnd + 0.6 : exEnd + 0.4 + 3.2 + 0.4;
  const AY = 1.4, AX0 = lv >= 4 ? 2.0 : 1.6;
  const AX = pc > 1 ? Math.min(3.0, Math.max(AX0, (rxMin - 1.8 - ox - pc * POD_W) / (pc - 1))) : AX0; // 묶음 사이 통로(책상 깊이보다 넓게)
  const oaW = pc * POD_W + (pc - 1) * AX, oaD = pr * POD_D + (pr - 1) * AY;
  const rx = Math.max(ox + oaW + 1.8, rxMin);          // 오른쪽 열(시험실·연구실) 시작
  const colW = lv >= 4 ? 7.6 : 6.8;
  const W = rx + colW;
  const D = Math.max(oy + oaD + 1.6 + (lobby ? 3.4 : 0), studio ? oy + 6.4 : 0, lab ? 13.4 : 0, lv === 1 ? 7.6 : 0);
  const H = 3.0;

  const zones: Zone[] = [], furn: Furn[] = [], walls: WallItem[] = [], seats: Seat[] = [], spots: Spot[] = [], execs: ExecSeat[] = [], lights: [number, number][] = [];
  const F = (kind: FurnKind, x: number, y: number, w: number, d: number, h: number, extra: Partial<Furn> = {}) => furn.push({ kind, x, y, w, d, h, ...extra });
  const Wl = (kind: WallKind, wall: 'L' | 'R', at: number, w: number, z: number, h: number) => walls.push({ kind, wall, at, w, z, h });
  const S = (kind: SpotKind, x: number, y: number, face: Face) => spots.push({ kind, x, y, face });

  // ---- 사무 구역: 4인 묶음 ----
  zones.push({ kind: 'office', x: ox - 0.6, y: oy - 0.5, w: oaW + 1.2, d: oaD + 1.0 });
  let podNo = 0;
  for (let r = 0; r < pr; r++) for (let c = 0; c < pc; c++) {
    const px = ox + c * (POD_W + AX), py = oy + r * (POD_D + AY) + 0.6;
    if (podNo++ >= nPods) {                             // 빈 칸: 공용 탁자와 화분
      F('table', px + 0.6, py + 0.2, 1.6, 1.0, 0.74); F('plant', px + 2.3, py + 1.6, 0.5, 0.5, 1.2);
      continue;
    }
    const elite = podNo > regPods;
    if (elite) zones.push({ kind: 'elite', x: px - 0.35, y: py - 0.75, w: POD_W + 0.7, d: POD_D - 0.1 });
    for (const [i, [dx, back]] of ([[0, true], [1.4, true], [0, false], [1.4, false]] as [number, boolean][]).entries()) {
      const si = seats.length;
      F('desk', px + dx, back ? py : py + 0.8, 1.4, 0.75, DESK_H, { seat: si, face: back ? '+y' : '-y', ...(elite ? { elite: true as const } : {}) });
      seats.push({ x: px + dx + 0.7, y: back ? py - 0.35 : py + 1.9, face: back ? '+y' : '-y', col: c * 2 + (i % 2), row: r * 2 + (back ? 0 : 1), used: false, access: [0, 0], ...(elite ? { elite: true as const } : {}) });
    }
    F('divider', px, py + 0.75, POD_W, 0.05, 1.05);
  }

  // ---- 뒤쪽 띠: 탕비 공간, 회의실, 수납장 ----
  zones.push({ kind: 'pantry', x: 0, y: 0, w: 4.8, d: BACK });
  F('counter', 0.5, 0.05, 2.4, 0.6, 0.9); F('fridge', 3.0, 0.05, 0.7, 0.7, 1.8);
  S('coffee', 1.2, 1.25, '-y'); S('coffee', 2.2, 1.25, '-y');
  if (lv >= 2) { F('sofa', 0.6, 2.3, 2.0, 0.8, 0.8, { face: '-y' }); S('coffee', 3.3, 2.2, '-x'); }
  else { F('rack', 3.9, 0.05, 1.6, 0.5, 2.0); F('boxes', 0.3, 1.9, 0.9, 0.9, 0.9); }
  let cabX = cab0;
  if (glass) {
    const mx = 5.2, mw = 5.2;
    zones.push({ kind: 'meeting', x: mx, y: 0, w: mw, d: BACK });
    F('glass', mx, 0, 0.05, BACK, 2.4); F('glass', mx + mw - 0.05, 0, 0.05, BACK, 2.4);
    F('glass', mx, BACK - 0.05, mw - 1.3, 0.05, 2.4);   // 앞 유리(오른쪽 끝 1.3m가 문)
    F('table', mx + 1.2, 1.0, 2.6, 1.0, 0.74);
    for (const dx of [1.45, 2.25, 3.05]) F('mchair', mx + dx, 0.4, 0.45, 0.45, 0.85, { face: '+y' });
    for (const dx of [1.6, 2.5, 3.4]) S('meeting', mx + dx, 2.5, '-y');
    Wl('whiteboard', 'R', mx + 1.0, 2.8, 1.0, 1.2);
  } else if (lv === 2) { F('table', 6.0, 1.0, 1.2, 1.2, 0.74); F('stool', 6.3, 2.4, 0.4, 0.4, 0.5); }
  // 임원실: 창을 등진 큰 책상, 책장, 앞은 유리(오른쪽 0.8m가 문). 1등급은 벽 없는 책상 하나
  for (let i = 0; i < nx; i++) {
    const x0 = cab0 + i * EXW;
    zones.push({ kind: 'exec', x: x0, y: 0, w: EXW, d: BACKE });
    if (lv >= 2) { F('glass', x0 + EXW - 0.05, 0, 0.05, BACKE, 2.4); F('glass', x0 + 0.05, BACKE - 0.05, EXW - 0.9, 0.05, 2.4); if (i === 0) F('glass', x0, 0, 0.05, BACKE, 2.4); }
    F('xdesk', x0 + 0.35, 1.15, 1.5, 0.75, DESK_H, { face: '+y' });
    if (lv >= 2) F('cabinet', x0 + 0.12, 0.05, 0.9, 0.4, 1.5); else F('boxes', x0 + 0.1, 0.1, 0.6, 0.6, 0.6);
    if (lv >= 3) F('plant', x0 + EXW - 0.65, 0.15, 0.45, 0.45, 1.1);
    execs.push({ x: x0 + 1.1, y: 0.75, face: '+y', plate: [x0 + 0.35, 1.55], glass: lv >= 2 });
    Wl('window', 'R', x0 + 0.95, 1.1, 1.0, 1.4);
  }
  cabX = exEnd + 0.4;
  for (let x = cabX; x + 1.2 <= rx - 0.6; x += 1.25) F('cabinet', x, 0.05, 1.2, 0.5, 1.0);
  if (lv === 1) Wl('sign', 'R', 2.4, 3.0, 2.05, 0.8); else Wl('sign', 'R', cabX, 3.2, 1.6, 0.9);
  // 넓어진 건물: 사무 구역과 오른쪽 열 사이에 남는 자리는 라운지(소파·탁자·화분)
  const spare = rx - (ox + oaW + 1.8);
  if (spare >= 3.2) {
    const lx = ox + oaW + 1.0, ly = oy + 0.8;
    zones.push({ kind: 'lounge', x: lx, y: ly, w: Math.min(spare - 0.4, 4.2), d: 3.6 });
    F('sofa', lx + 0.4, ly + 0.3, 2.0, 0.8, 0.8, { face: '+y' }); F('table', lx + 0.7, ly + 1.5, 1.3, 0.7, 0.45); F('plant', lx + Math.min(spare - 0.4, 4.2) - 0.8, ly + 0.3, 0.5, 0.5, 1.3);
  }

  // ---- 디자인 스튜디오(왼쪽 열) ----
  if (studio) {
    const sy = oy;
    zones.push({ kind: 'studio', x: 0, y: sy - 0.4, w: 5.0, d: 6.0 });
    F('clay', 0.9, sy + 0.4, 3.0, 1.4, 0.3);
    S('studio', 2.4, sy + 2.3, '-y'); S('studio', 4.4, sy + 1.1, '-x');
    const nd = lv >= 3 ? 2 : 1;
    for (let i = 0; i < nd; i++) { F('drafting', 0.8 + i * 2.0, sy + 3.4, 1.2, 0.9, 1.0); S('studio', 1.4 + i * 2.0, sy + 4.75, '-y'); }
    Wl('swatch', 'L', sy + 0.2, 1.6, 1.0, 1.0); Wl('sketch', 'L', sy + 2.2, 2.0, 0.9, 1.3);
    if (lv >= 4) { F('glass', 0, sy - 0.45, 3.6, 0.05, 2.4); F('glass', 5.0, sy - 0.45, 0.05, 4.0, 2.4); } // 유리 벽 디자인 스튜디오(문 자리는 비운다)
  } else {
    // 등급 1: 왼쪽 벽 작업대와 공구 벽
    F('workbench', 0.05, 5.0, 0.75, 3.0, 0.9);
    Wl('toolwall', 'L', 5.0, 3.0, 1.1, 1.3);
  }

  // ---- 오른쪽 열: 시험실(등급 1은 차고) ----
  const cx = rx + colW / 2;
  zones.push({ kind: glass ? 'test' : 'garage', x: rx, y: 0, w: colW, d: 5.6 });
  F('car', cx - 2.1, 1.9, 4.2, 1.8, 1.4);
  if (lv >= 2) { F('post', cx - 0.2, 1.35, 0.4, 0.3, 2.0); F('post', cx - 0.2, 4.0, 0.4, 0.3, 2.0); }
  F('cart', W - 1.0, 4.6, 0.7, 0.45, 0.9); F('diag', W - 0.9, 0.25, 0.5, 0.5, 1.4);
  S('test', cx - 2.9, 2.8, '+x'); S('test', cx + 2.9, 2.8, '-x'); S('test', cx + 1.1, 1.0, '+y'); S('test', cx - 1.1, 4.7, '-y');
  if (glass) { F('glass', rx, 0, 0.05, 4.0, 2.4); F('glass', rx, 5.55, colW, 0.05, 2.4); }
  else Wl('shutter', 'R', rx + 0.7, colW - 1.6, 0, 2.5);
  if (lab) {
    zones.push({ kind: 'lab', x: rx, y: 7.0, w: colW, d: 5.4 });
    F('glass', rx, 7.0, colW, 0.05, 2.4); F('glass', rx, 8.6, 0.05, 3.8, 2.4);
    F('dyno', rx + 0.9, 8.5, 1.8, 1.2, 1.0); F('tunnel', rx + 3.5, 7.6, 3.6, 1.4, 1.6);
    S('lab', rx + 1.8, 10.3, '-y'); S('lab', rx + 5.3, 9.6, '-y');
  } else if (lv >= 2) {
    zones.push({ kind: 'lounge', x: rx, y: 7.0, w: colW, d: 3.0 });
    F('printer', rx + 0.8, 7.4, 1.0, 0.7, 1.0); F('cooler', rx + 2.4, 7.4, 0.5, 0.5, 1.2); F('plant', rx + 3.4, 7.4, 0.6, 0.6, 1.3);
  }

  // ---- 로비(등급 5~) ----
  if (lobby) {
    zones.push({ kind: 'lobby', x: 0, y: D - 3.4, w: rx - 0.6, d: 3.4 });
    F('reception', 2.0, D - 2.5, 2.8, 0.7, 1.05); F('sofa', 6.6, D - 1.4, 2.0, 0.8, 0.8, { face: '-y' });
    F('plant', 0.4, D - 1.0, 0.6, 0.6, 1.4); F('plant', 9.2, D - 1.2, 0.6, 0.6, 1.4);
    Wl('logo', 'L', D - 3.0, 2.2, 1.2, 1.1);
  }

  // ---- 창문·시계·화분 ----
  const winStart = cabX + (lv === 1 ? 0 : 3.6), winEnd = glass || lv === 1 ? rx - 0.4 : W - 0.6;
  for (let x = winStart; x + 1.6 <= winEnd; x += 2.4) if (!(glass && x > rx - 1)) Wl('window', 'R', x, 1.8, 1.0, 1.5);
  if (lv === 1) Wl('window', 'R', 0.8, 1.4, 1.6, 0.9);
  Wl('clock', 'L', 1.2, 0.6, 2.1, 0.6);
  if (studio) for (let y = oy + 6.6; y + 1.6 <= D - (lobby ? 3.4 : 0.6); y += 2.4) Wl('window', 'L', y, 1.6, 1.0, 1.5);
  if (lv >= 2) F('plant', ox + oaW + 0.6, oy - 0.9, 0.5, 0.5, 1.2);
  if (lv === 1) { F('boxes', 0.3, D - 1.3, 1.0, 1.0, 0.8); F('boxes', W - 1.6, D - 1.6, 1.2, 1.2, 1.0); F('cart', rx + 0.8, D - 1.2, 0.7, 0.45, 0.9); }
  // 천장 조명: 책상 묶음마다 가운데 위
  for (const fu of furn) if (fu.kind === 'divider') lights.push([fu.x + fu.w / 2, fu.y]);
  if (studio) lights.push([2.4, oy + 1.2]);

  // 자리 출입 칸·서는 곳을 걷기 격자의 빈 칸에 맞춘다
  const grid = buildGrid(W, D, furn, [...seats, ...execs]);
  for (const s of seats) {
    const b = s.face === '+y' ? -0.6 : s.face === '-y' ? 0.6 : 0, a = s.face === '+x' ? -0.6 : s.face === '-x' ? 0.6 : 0;
    s.access = nearestFree(grid, s.x + a, s.y + b);
  }
  for (const sp of spots) [sp.x, sp.y] = nearestFree(grid, sp.x, sp.y);
  const zc = (k: ZoneKind): [number, number] | null => { const z = zones.find((q) => q.kind === k); return z ? [z.x + z.w / 2, z.y + z.d / 2] : null; };
  const anchors: Record<Role, [number, number]> = {
    designer: zc('studio') ?? [0, oy],
    engineer: zc('lab') ?? [W, oy + oaD / 2],
    tester: zc('test') ?? zc('garage')!,
    sales: zc('lobby') ?? [0, D],
  };
  const room: Room = { level: lv, name: NAME[lv], W, D, H, zones, furn, walls, seats, spots, execs, lights, anchors, grid };
  cache.set(`${lv}|${nx}`, room);
  return room;
}

/** 등급의 책상 자리(정원만큼). used는 앞에서부터 staffCount개. 실제 배정은 assignSeats가 직무별로 한다 */
export function seatsFor(level: number, staffCount: number, extraExec = 0): Seat[] {
  return roomFor(level, extraExec).seats.map((s, i) => ({ ...s, used: i < staffCount }));
}

/** 직무 구역 쪽 자리부터 채운다(디자이너는 스튜디오 가까이, 엔지니어·테스터는 시험실·연구실 가까이, 영업은 앞쪽).
 *  넘친 사람은 자리가 없다(결과에 없음). */
export function assignSeats(level: number, staff: { id: string; role: Role; elite?: boolean }[], extraExec = 0): Map<string, number> {
  const rm = roomFor(level, extraExec), out = new Map<string, number>(), taken = new Set<number>();
  const order: Role[] = ['designer', 'tester', 'engineer', 'sales'];
  const list = [...staff].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of list) {
    const [ax, ay] = rm.anchors[s.role];
    let best = -1, bd = Infinity;
    rm.seats.forEach((st, i) => { if (taken.has(i) || !!st.elite !== !!s.elite) return; const d = Math.hypot(st.x - ax, st.y - ay); if (d < bd) { bd = d; best = i; } });
    if (best < 0) continue; // 4.1.0 전담팀 자리와 일반 자리를 따로 채운다
    taken.add(best); out.set(s.id, best);
  }
  return out;
}

// ---------- 걷기 격자 ----------
function buildGrid(W: number, D: number, furn: Furn[], seats: { x: number; y: number }[]): Grid {
  const cols = Math.floor(W / CELL), rows = Math.floor(D / CELL), free = new Uint8Array(cols * rows).fill(1);
  const block = (x: number, y: number, w: number, d: number) => {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL;
      if (cx > x - CLEAR && cx < x + w + CLEAR && cy > y - CLEAR && cy < y + d + CLEAR) free[j * cols + i] = 0;
    }
  };
  for (const f of furn) block(f.x, f.y, f.w, f.d);
  for (const s of seats) block(s.x - 0.25, s.y - 0.25, 0.5, 0.5);
  return { cols, rows, free };
}
const cellOf = (g: Grid, x: number, y: number): [number, number] => [Math.max(0, Math.min(g.cols - 1, Math.floor(x / CELL))), Math.max(0, Math.min(g.rows - 1, Math.floor(y / CELL)))];
const centerOf = (i: number, j: number): [number, number] => [(i + 0.5) * CELL, (j + 0.5) * CELL];

/** (x,y)에서 가장 가까운 빈 칸의 가운데 */
export function nearestFree(g: Grid, x: number, y: number): [number, number] {
  let best: [number, number] = [x, y], bd = Infinity;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    if (!g.free[j * g.cols + i]) continue;
    const [cx, cy] = centerOf(i, j), d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bd) { bd = d; best = [cx, cy]; }
  }
  return best;
}

/** 빈 칸만 지나는 가장 짧은 길(상하좌우 이동). 꺾이는 점만 돌려준다. 못 찾으면 null */
export function findPath(g: Grid, from: [number, number], to: [number, number]): [number, number][] | null {
  const [si, sj] = cellOf(g, ...from), [ti, tj] = cellOf(g, ...to);
  const s = sj * g.cols + si, t = tj * g.cols + ti;
  if (!g.free[s] || !g.free[t]) return null;
  const prev = new Int32Array(g.cols * g.rows).fill(-1);
  prev[s] = s;
  const q = [s];
  for (let h = 0; h < q.length && prev[t] < 0; h++) {
    const c = q[h], ci = c % g.cols, cj = (c - ci) / g.cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue;
      const n = nj * g.cols + ni;
      if (g.free[n] && prev[n] < 0) { prev[n] = c; q.push(n); }
    }
  }
  if (prev[t] < 0) return null;
  const cells: number[] = [];
  for (let c = t; ; c = prev[c]) { cells.push(c); if (c === s) break; }
  cells.reverse();
  const pts = cells.map((c) => centerOf(c % g.cols, Math.floor(c / g.cols)));
  // 같은 방향으로 이어지는 점은 뺀다
  return pts.filter((p, i) => i === 0 || i === pts.length - 1 ||
    !((pts[i - 1][0] === p[0] && p[0] === pts[i + 1][0]) || (pts[i - 1][1] === p[1] && p[1] === pts[i + 1][1])));
}
