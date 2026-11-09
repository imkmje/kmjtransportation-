import type { Config } from '../config';
import type { Network, Pt, SignKind } from './network';

// 주행 가능한 "트랙": 차선(도로 구간 위) 또는 연결선(교차로 안, 차선 끝 → 다른 차선 시작)
export type Turn = 'straight' | 'left' | 'right' | 'uturn';

export interface Track {
  id: number;
  key: string; // 도로망이 바뀌어도 같은 차선·연결선을 알아보는 이름(번호는 도로망이 바뀌면 달라진다)
  kind: 'lane' | 'conn';
  segId: number; // 연결선은 -1
  fwd: boolean; // 도로 a→b 방향이면 true
  index: number; // 차선 번호: 진행 방향 기준 오른쪽부터 1
  from: number; // 시작 노드
  to: number; // 끝 노드
  length: number;
  pts: Pt[];
  cum: number[]; // pts 각 지점까지의 누적 거리
  vmax: number; // m/s (플레이어가 바꾼 제한속도 반영)
  vbase: number; // m/s 도로 종류의 기본 제한속도 기준. 정체 지수의 기준 속도에 쓴다(제한을 낮춰 지수를 좋게 만드는 것 방지)
  next: number[];
  uturn: boolean;
  t0: number; // 차선: 도로 중심선 위 차선 시작 지점의 거리(시작 노드 a 기준)
  lanes: number; // 차선: 같은 방향 차선 수. 연결선은 0
  rank: number; // 도로 등급(교차로 우선순위). 연결선은 들어오는 차선의 등급
  sign: SignKind | null; // 차선: 끝(교차로) 쪽에 놓인 표지. 연결선은 들어오는 차선의 표지
  turn: Turn; // 연결선의 회전 종류
  node: number; // 연결선이 놓인 교차로 노드. 차선은 -1
  src: number; // 연결선이 출발하는 차선 ID. 차선은 -1
  conflicts: number[]; // 같은 교차로에서 동시에 지나면 부딪히는 다른 연결선 ID
}

export interface LaneGraph {
  revision: number;
  tracks: Track[];
  lanesOfSeg: Map<number, Track[]>;
}

const KMH = 1 / 3.6;
type Rules = Pick<Config, 'roads' | 'driving' | 'intersection'>;

function polyline(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return cum;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function makeConnector(id: number, a: Track, b: Track, uturn: boolean, rules: Rules): Track {
  const p0 = a.pts[a.pts.length - 1], p3 = b.pts[0];
  const q0 = a.pts[a.pts.length - 2], q3 = b.pts[1];
  const h0 = Math.atan2(p0.y - q0.y, p0.x - q0.x), h3 = Math.atan2(q3.y - p3.y, q3.x - p3.x);
  const d = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const h = uturn ? Math.max(d * 0.7, 3) : Math.max(d * 0.4, 1);
  const p1 = { x: p0.x + Math.cos(h0) * h, y: p0.y + Math.sin(h0) * h };
  const p2 = { x: p3.x - Math.cos(h3) * h, y: p3.y - Math.sin(h3) * h };
  const pts: Pt[] = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  const cum = polyline(pts);
  // 곡선 한계 속도: v = √(횡가속 한계 ÷ 곡률). 교차로 안 최저 속도 이상으로 보장
  let kmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const a2 = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    kmax = Math.max(kmax, Math.abs(wrap(a2 - a1)) / ((cum[i + 1] - cum[i - 1]) / 2));
  }
  const curveV = kmax > 1e-6 ? Math.sqrt(rules.driving.curveLatAccel / kmax) : Infinity;
  const vmax = Math.min(a.vmax, b.vmax, Math.max(curveV, rules.driving.minTurnKmh * KMH));
  const vbase = Math.min(a.vbase, b.vbase, Math.max(curveV, rules.driving.minTurnKmh * KMH));
  const dth = wrap(h3 - h0);
  const turn: Turn = uturn ? 'uturn' : Math.abs(dth) < (rules.intersection.straightDeg * Math.PI) / 180 ? 'straight' : dth > 0 ? 'left' : 'right';
  return { id, key: `C${a.key}>${b.key}`, kind: 'conn', segId: -1, fwd: true, index: 0, from: a.to, to: b.from, length: cum[cum.length - 1], pts, cum, vmax, vbase, next: [b.id], uturn, t0: 0, lanes: 0, rank: a.rank, sign: a.sign, turn, node: a.to, src: a.id, conflicts: [] };
}

/** 도로망 → 차선 + 연결선 그래프. ID는 도로 ID 순서로 정해져 항상 같은 결과가 나온다 */
export function buildLaneGraph(net: Network, rules: Rules): LaneGraph {
  const tracks: Track[] = [];
  const lanesOfSeg = new Map<number, Track[]>();
  const half = (kind: keyof Config['roads']) => rules.roads[kind].lanesPerDir * rules.roads[kind].laneWidth;

  // 각 노드의 여유 반경: 연결된 도로 중 가장 넓은 도로의 반폭. 차선은 이만큼 떨어져 시작/끝난다
  const inset = new Map<number, number>();
  for (const s of net.segments.values()) for (const id of [s.a, s.b]) inset.set(id, Math.max(inset.get(id) ?? 0, half(s.kind)));

  const ins = new Map<number, Track[]>();
  const outs = new Map<number, Track[]>();
  const segCount = new Map<number, number>();
  const push = (m: Map<number, Track[]>, k: number, t: Track) => { const l = m.get(k); if (l) l.push(t); else m.set(k, [t]); };

  for (const s of net.segments.values()) {
    segCount.set(s.a, (segCount.get(s.a) ?? 0) + 1);
    segCount.set(s.b, (segCount.get(s.b) ?? 0) + 1);
    const A = net.nodes.get(s.a)!, B = net.nodes.get(s.b)!;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
    const nx = -uy, ny = ux; // 왼쪽 법선
    const r = rules.roads[s.kind];
    const k = r.lanesPerDir;
    const vmax = (s.playerSpeedKmh ?? r.defaultSpeedKmh) * KMH;
    const vbase = r.defaultSpeedKmh * KMH;
    const list: Track[] = [];
    for (const fwd of [true, false]) {
      for (let i = 1; i <= k; i++) {
        const off = (k - i + 0.5) * r.laneWidth * (fwd ? -1 : 1); // 진행 방향 오른쪽. 1번 차선이 중앙선에서 가장 멀다
        const d0 = fwd ? inset.get(s.a)! : len - inset.get(s.b)!;
        const d1 = fwd ? len - inset.get(s.b)! : inset.get(s.a)!;
        const pts = [
          { x: A.x + ux * d0 + nx * off, y: A.y + uy * d0 + ny * off },
          { x: A.x + ux * d1 + nx * off, y: A.y + uy * d1 + ny * off },
        ];
        const cum = polyline(pts);
        const t: Track = { id: tracks.length, key: `L${s.id}:${fwd ? 1 : 0}:${i}`, kind: 'lane', segId: s.id, fwd, index: i, from: fwd ? s.a : s.b, to: fwd ? s.b : s.a, length: cum[1], pts, cum, vmax, vbase, next: [], uturn: false, t0: d0, lanes: k, rank: r.rank, sign: fwd ? s.signB : s.signA, turn: 'straight', node: -1, src: -1, conflicts: [] };
        tracks.push(t);
        list.push(t);
        push(outs, t.from, t);
        push(ins, t.to, t);
      }
    }
    lanesOfSeg.set(s.id, list);
  }

  // 교차로 연결: 다른 도로의 모든 차선으로(차선 변경이 생기는 4단계에서 다듬음). 막다른 끝에서는 같은 번호 반대 차선으로 회차
  for (const n of net.nodes.values()) {
    for (const a of ins.get(n.id) ?? []) {
      for (const b of outs.get(n.id) ?? []) {
        const turnBack = a.segId === b.segId;
        if (turnBack && !(segCount.get(n.id) === 1 && a.index === b.index)) continue;
        const c = makeConnector(tracks.length, a, b, turnBack, rules);
        tracks.push(c);
        a.next.push(c.id);
      }
    }
  }
  computeConflicts(tracks);
  return { revision: net.revision, tracks, lanesOfSeg };
}

// 두 선분이 서로의 안쪽에서 만나는가(끝점만 닿는 경우는 제외)
function segCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

// 같은 교차로 안의 연결선끼리: 길이 겹치거나(교차) 같은 차선으로 합쳐지면(합류) 충돌 관계
function computeConflicts(tracks: Track[]): void {
  const byNode = new Map<number, Track[]>();
  for (const t of tracks) if (t.kind === 'conn') { const l = byNode.get(t.node); if (l) l.push(t); else byNode.set(t.node, [t]); }
  const box = (t: Track) => ({ x0: Math.min(...t.pts.map((p) => p.x)), x1: Math.max(...t.pts.map((p) => p.x)), y0: Math.min(...t.pts.map((p) => p.y)), y1: Math.max(...t.pts.map((p) => p.y)) });
  for (const list of byNode.values()) {
    const boxes = list.map(box);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.src === b.src) continue; // 같은 차선에서 갈라지는 길은 앞뒤로 줄 서므로 충돌이 아니다
        let hit = a.next[0] === b.next[0]; // 합류
        if (!hit) {
          const p = boxes[i], q = boxes[j];
          if (p.x0 > q.x1 || q.x0 > p.x1 || p.y0 > q.y1 || q.y0 > p.y1) continue;
          for (let m = 1; m < a.pts.length && !hit; m++) for (let n = 1; n < b.pts.length && !hit; n++) hit = segCross(a.pts[m - 1], a.pts[m], b.pts[n - 1], b.pts[n]);
        }
        if (hit) { a.conflicts.push(b.id); b.conflicts.push(a.id); }
      }
    }
  }
}

export function posAt(t: Track, s: number): { x: number; y: number; h: number } {
  const c = t.cum;
  const q = Math.min(Math.max(s, 0), t.length);
  let i = 1;
  while (i < c.length - 1 && c[i] < q) i++;
  const span = c[i] - c[i - 1] || 1;
  const f = (q - c[i - 1]) / span;
  const a = t.pts[i - 1], b = t.pts[i];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, h: Math.atan2(b.y - a.y, b.x - a.x) };
}
