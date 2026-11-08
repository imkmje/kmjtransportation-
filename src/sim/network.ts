import type { Config } from '../config';

export type RoadKind = keyof Config['roads'];
export interface Pt { x: number; y: number }
export interface NetNode { id: number; x: number; y: number; z: number }
export interface Segment {
  id: number;
  a: number; // 시작 노드 ID
  b: number; // 끝 노드 ID
  kind: RoadKind;
  structure: 'ground' | 'bridge' | 'tunnel'; // 2.1.0 대비
  playerSpeedKmh: number | null; // 플레이어가 바꾼 제한속도(기본값은 도로 종류에서)
}

export type PlanError = 'samePoint' | 'nodeTooClose' | 'tooShort' | 'angle' | 'tooManyRoads';
interface Stop { x: number; y: number; nodeId?: number; segId?: number }
export type Plan = { ok: true; stops: Stop[]; kind: RoadKind; length: number } | { ok: false; error: PlanError };
export interface Snap { x: number; y: number; nodeId?: number; segId?: number }

export const NETWORK_FORMAT_VERSION = 1;
export interface NetworkData {
  formatVersion: number;
  nextNodeId: number;
  nextSegmentId: number;
  nodes: NetNode[];
  segments: Segment[];
}

type Rules = Pick<Config, 'geometry' | 'roads'>;
const EPS = 1e-9;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + u * dx, y = a.y + u * dy;
  return { d: Math.hypot(p.x - x, p.y - y), u, x, y };
}

// 선분 a-b와 c-d가 양쪽 모두 "안쪽"에서 만날 때의 교점. t = a-b 위 위치(0~1)
function intersect(a: Pt, b: Pt, c: Pt, d: Pt) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = cross(rx, ry, sx, sy);
  if (Math.abs(den) < EPS) return null;
  const t = cross(c.x - a.x, c.y - a.y, sx, sy) / den;
  const u = cross(c.x - a.x, c.y - a.y, rx, ry) / den;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { x: a.x + t * rx, y: a.y + t * ry, t };
}

const angleBetween = (a: number, b: number) => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

export class Network {
  // Map의 순회 순서 = ID 순서 (새 ID는 항상 더 크고 뒤에 추가되므로)
  readonly nodes = new Map<number, NetNode>();
  readonly segments = new Map<number, Segment>();
  /** 도로망이 바뀔 때마다 증가. 화면이 다시 그릴 때 확인 */
  revision = 0;
  private nextNodeId = 1;
  private nextSegmentId = 1;

  constructor(private rules: Rules) {}

  segmentsAt(nodeId: number): Segment[] {
    return [...this.segments.values()].filter((s) => s.a === nodeId || s.b === nodeId);
  }

  segmentLength(s: Segment): number {
    return dist(this.nodes.get(s.a)!, this.nodes.get(s.b)!);
  }

  /** 점 p를 8m 안의 가장 가까운 노드(우선) 또는 도로 위 점으로 끌어당긴다 */
  snapPoint(p: Pt): Snap {
    const r = this.rules.geometry.mergeRadius;
    let bestNode: NetNode | undefined;
    let bd = Infinity;
    for (const n of this.nodes.values()) {
      const d = dist(n, p);
      if (d <= r && d < bd) { bd = d; bestNode = n; }
    }
    if (bestNode) return { x: bestNode.x, y: bestNode.y, nodeId: bestNode.id };
    let best: Snap | undefined;
    bd = Infinity;
    for (const s of this.segments.values()) {
      const q = distToSegment(p, this.nodes.get(s.a)!, this.nodes.get(s.b)!);
      if (q.d <= r && q.d < bd && q.u > 0 && q.u < 1) { bd = q.d; best = { x: q.x, y: q.y, segId: s.id }; }
    }
    return best ?? { x: p.x, y: p.y };
  }

  /** 점에서 radius 안의 가장 가까운 도로 위 지점. t = 도로 시작 노드(a)에서의 거리(m) */
  projectOnRoad(p: Pt, radius: number): { segId: number; t: number; x: number; y: number } | null {
    let best: { segId: number; t: number; x: number; y: number; d: number } | null = null;
    for (const s of this.segments.values()) {
      const a = this.nodes.get(s.a)!, b = this.nodes.get(s.b)!;
      const q = distToSegment(p, a, b);
      if (q.d <= radius && (!best || q.d < best.d)) best = { segId: s.id, t: q.u * dist(a, b), x: q.x, y: q.y, d: q.d };
    }
    return best && { segId: best.segId, t: best.t, x: best.x, y: best.y };
  }

  nearestSegment(x: number, y: number, radius: number): { id: number; dist: number } | null {
    let best: { id: number; dist: number } | null = null;
    for (const s of this.segments.values()) {
      const d = distToSegment({ x, y }, this.nodes.get(s.a)!, this.nodes.get(s.b)!).d;
      if (d <= radius && (!best || d < best.dist)) best = { id: s.id, dist: d };
    }
    return best;
  }

  /** 건설 가능 여부와 결과(교차점, 분할 위치)를 계산만 한다. 도로망은 바뀌지 않는다 */
  planRoad(p1: Pt, p2: Pt, kind: RoadKind): Plan {
    const g = this.rules.geometry;
    const fail = (error: PlanError): Plan => ({ ok: false, error });
    const s1 = this.snapPoint(p1), s2 = this.snapPoint(p2);
    if (dist(s1, s2) < EPS || (s1.nodeId !== undefined && s1.nodeId === s2.nodeId)) return fail('samePoint');

    // 양 끝으로 쓰는 노드 말고, 새 도로에서 8m 안에 있는 노드가 있으면 불가
    for (const n of this.nodes.values()) {
      if (n.id === s1.nodeId || n.id === s2.nodeId) continue;
      if (distToSegment(n, s1, s2).d < g.mergeRadius) return fail('nodeTooClose');
    }

    // 기존 도로와의 교차점(양 끝이 걸쳐진 도로는 제외)
    const skip = new Set<number>();
    if (s1.segId !== undefined) skip.add(s1.segId);
    if (s2.segId !== undefined) skip.add(s2.segId);
    const crossings: (Stop & { t: number })[] = [];
    for (const seg of this.segments.values()) {
      if (skip.has(seg.id)) continue;
      const hit = intersect(s1, s2, this.nodes.get(seg.a)!, this.nodes.get(seg.b)!);
      if (hit) crossings.push({ x: hit.x, y: hit.y, segId: seg.id, t: hit.t });
    }
    crossings.sort((a, b) => a.t - b.t);
    const stops: Stop[] = [s1, ...crossings.map(({ x, y, segId }) => ({ x, y, segId })), s2];

    // 최소 길이: 새 도로 조각과, 분할될 기존 도로의 두 조각 모두
    for (let i = 0; i < stops.length - 1; i++) if (dist(stops[i], stops[i + 1]) < g.minSegmentLength - EPS) return fail('tooShort');
    for (const st of stops) {
      if (st.segId === undefined) continue;
      const seg = this.segments.get(st.segId)!;
      if (dist(st, this.nodes.get(seg.a)!) < g.minSegmentLength - EPS || dist(st, this.nodes.get(seg.b)!) < g.minSegmentLength - EPS) return fail('tooShort');
    }

    // 최소 각도
    const minA = (g.minAngleDeg * Math.PI) / 180 - 1e-9;
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      const outs: number[] = [];
      if (i > 0) outs.push(Math.atan2(stops[i - 1].y - st.y, stops[i - 1].x - st.x));
      if (i < stops.length - 1) outs.push(Math.atan2(stops[i + 1].y - st.y, stops[i + 1].x - st.x));
      if (st.nodeId !== undefined) {
        for (const seg of this.segmentsAt(st.nodeId)) {
          const o = this.nodes.get(seg.a === st.nodeId ? seg.b : seg.a)!;
          const od = Math.atan2(o.y - st.y, o.x - st.x);
          if (outs.some((d) => angleBetween(d, od) < minA)) return fail('angle');
        }
      } else if (st.segId !== undefined) {
        const seg = this.segments.get(st.segId)!;
        const c = this.nodes.get(seg.a)!, d = this.nodes.get(seg.b)!;
        const la = Math.atan2(d.y - c.y, d.x - c.x);
        if (outs.some((o) => { const x = angleBetween(o, la); return Math.min(x, Math.PI - x) < minA; })) return fail('angle');
      }
    }

    // 교차로당 연결 도로 수
    for (const st of [s1, s2]) {
      if (st.nodeId !== undefined && this.segmentsAt(st.nodeId).length + 1 > g.maxRoadsPerNode) return fail('tooManyRoads');
    }

    let length = 0;
    for (let i = 0; i < stops.length - 1; i++) length += dist(stops[i], stops[i + 1]);
    return { ok: true, stops, kind, length };
  }

  /** 건설. 성공하면 새로 생긴 도로 ID 목록 */
  buildRoad(p1: Pt, p2: Pt, kind: RoadKind): { ok: true; ids: number[]; length: number } | { ok: false; error: PlanError } {
    const plan = this.planRoad(p1, p2, kind);
    if (!plan.ok) return plan;
    const nodeIds = plan.stops.map((st) => {
      if (st.nodeId !== undefined) return st.nodeId;
      const n = this.addNode(st.x, st.y);
      if (st.segId !== undefined) this.splitSegment(st.segId, n);
      return n;
    });
    const ids: number[] = [];
    for (let i = 0; i < nodeIds.length - 1; i++) ids.push(this.addSegment(nodeIds[i], nodeIds[i + 1], kind));
    this.revision++;
    return { ok: true, ids, length: plan.length };
  }

  /** 철거. 연결이 모두 없어진 노드도 같이 지운다(2개만 남은 이음 노드는 그대로 둔다) */
  removeSegment(id: number): boolean {
    const seg = this.segments.get(id);
    if (!seg) return false;
    this.segments.delete(id);
    for (const nid of [seg.a, seg.b]) if (this.segmentsAt(nid).length === 0) this.nodes.delete(nid);
    this.revision++;
    return true;
  }

  private addNode(x: number, y: number): number {
    const id = this.nextNodeId++;
    this.nodes.set(id, { id, x, y, z: 0 });
    return id;
  }

  private addSegment(a: number, b: number, kind: RoadKind): number {
    const id = this.nextSegmentId++;
    this.segments.set(id, { id, a, b, kind, structure: 'ground', playerSpeedKmh: null });
    return id;
  }

  // 기존 도로 a→b를 a→node, node→b로 나눈다(종류·설정 유지)
  private splitSegment(segId: number, node: number): void {
    const s = this.segments.get(segId)!;
    const oldB = s.b;
    s.b = node;
    const id = this.nextSegmentId++;
    this.segments.set(id, { ...s, id, a: node, b: oldB });
  }

  toJSON(): NetworkData {
    return {
      formatVersion: NETWORK_FORMAT_VERSION,
      nextNodeId: this.nextNodeId,
      nextSegmentId: this.nextSegmentId,
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      segments: [...this.segments.values()].map((s) => ({ ...s })),
    };
  }

  /** 파일·저장 슬롯에서 읽은 값을 검증한다. 문제가 있으면 쉬운 한국어 메시지로 Error를 던진다 */
  static parse(data: unknown, rules: Rules): NetworkData {
    const d = data as Partial<NetworkData> | null;
    if (!d || typeof d !== 'object' || typeof d.formatVersion !== 'number') throw new Error('도로망 파일이 아닙니다');
    if (d.formatVersion > NETWORK_FORMAT_VERSION) throw new Error('더 새로운 버전에서 저장한 파일입니다');
    if (d.formatVersion < 1) throw new Error('지원하지 않는 저장 형식입니다');
    if (!Array.isArray(d.nodes) || !Array.isArray(d.segments)) throw new Error('도로망 파일이 손상되었습니다');
    const ids = new Set<number>();
    for (const n of d.nodes) {
      if (![n?.id, n?.x, n?.y, n?.z].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('도로망 파일이 손상되었습니다');
      ids.add(n.id);
    }
    for (const s of d.segments) {
      if (!ids.has(s?.a) || !ids.has(s?.b) || !(s.kind in rules.roads)) throw new Error('도로망 파일이 손상되었습니다');
    }
    const maxNode = Math.max(0, ...d.nodes.map((n) => n.id));
    const maxSeg = Math.max(0, ...d.segments.map((s) => s.id));
    return {
      formatVersion: d.formatVersion,
      nextNodeId: Math.max(d.nextNodeId ?? 0, maxNode + 1),
      nextSegmentId: Math.max(d.nextSegmentId ?? 0, maxSeg + 1),
      nodes: d.nodes,
      segments: d.segments,
    };
  }

  load(data: NetworkData): void {
    this.nodes.clear();
    this.segments.clear();
    for (const n of [...data.nodes].sort((a, b) => a.id - b.id)) this.nodes.set(n.id, { ...n });
    for (const s of [...data.segments].sort((a, b) => a.id - b.id)) this.segments.set(s.id, { ...s });
    this.nextNodeId = data.nextNodeId;
    this.nextSegmentId = data.nextSegmentId;
    this.revision++;
  }
}
