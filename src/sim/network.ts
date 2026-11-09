import type { Config } from '../config';

export type RoadKind = keyof Config['roads'];
export interface Pt { x: number; y: number }
export interface NetNode { id: number; x: number; y: number; z: number; signal: boolean } // signal: 신호등 켬(도로 3개 이상이 만날 때만 작동)
export type SignKind = 'stop' | 'yield';
export interface Segment {
  id: number;
  a: number; // 시작 노드 ID
  b: number; // 끝 노드 ID
  kind: RoadKind;
  structure: 'ground' | 'bridge' | 'tunnel'; // 2.1.0 대비
  playerSpeedKmh: number | null; // 플레이어가 바꾼 제한속도(기본값은 도로 종류에서)
  signA: SignKind | null; // a쪽 끝으로 들어오는 방향의 표지
  signB: SignKind | null; // b쪽 끝으로 들어오는 방향의 표지
  locked: boolean; // 철거할 수 없는 도로(외부 연결 도로)
}

export type BuildingKind = 'home' | 'office' | 'external'; // 주거, 사무형 직장, 외부 연결점(지도 가장자리의 가상 건물). 이후 버전에서 늘어난다
export type ZoneType = 'home' | 'office'; // 심시티식 구역: 주거 구역, 직장 구역
export type BuildingSize = 'small' | 'medium' | 'large';
export type BuildingSource = 'player' | 'map' | 'auto'; // 4.0.0(구역 시스템) 대비
export interface Building {
  id: number;
  kind: BuildingKind;
  size: BuildingSize;
  x: number;
  y: number;
  source: BuildingSource;
  deletable: boolean; // 맵 제공 건물은 지울 수 없다
  parking: number; // 3.0.0 예약(주차 수용량). 지금은 항상 0
  variant: number; // 건물 모양(높이·지붕·층 등)을 정하는 값. 자동으로 자란 건물은 난수로, 나머지는 0
}
export type BuildingError = 'onRoad' | 'overlap' | 'outOfBounds' | 'locked';
export type CellStatus = 'ok' | 'out' | 'road' | 'far'; // 구역 칸 상태: 칠할 수 있음 / 지도 밖 / 도로와 겹침 / 도로에서 너무 멂
export type ZoneCell = [number, number, 0 | 1]; // 칸 번호 i, j와 종류(0 = 주거, 1 = 직장). 칸 (i,j)의 중심은 (20i, 20j)

export type PlanError = 'samePoint' | 'nodeTooClose' | 'tooShort' | 'angle' | 'tooManyRoads' | 'onBuilding';
interface Stop { x: number; y: number; nodeId?: number; segId?: number }
export type Plan = { ok: true; stops: Stop[]; kind: RoadKind; length: number } | { ok: false; error: PlanError };
export interface Snap { x: number; y: number; nodeId?: number; segId?: number }

export const NETWORK_FORMAT_VERSION = 5; // 2: 도로 구간에 정지·양보 표지(signA, signB) 추가 / 3: 건물(buildings) 추가 / 4: 구역(zones), 외부 연결점·건물 모양(variant), 철거 불가 도로(locked) 추가 / 5: 노드에 신호등(signal) 추가
export interface NetworkData {
  formatVersion: number;
  nextNodeId: number;
  nextSegmentId: number;
  nodes: NetNode[];
  segments: Segment[];
  nextBuildingId: number;
  buildings: Building[];
  zones: ZoneCell[];
}

type Rules = Pick<Config, 'geometry' | 'roads' | 'buildings' | 'speedChoicesKmh' | 'zones'>;
const EPS = 1e-9;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const zkey = (i: number, j: number) => (i + 1024) * 2048 + (j + 1024);
const zcell = (k: number): [number, number] => [Math.floor(k / 2048) - 1024, (k % 2048) - 1024];
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
  readonly buildings = new Map<number, Building>();
  /** 구역 칸. 키 = 칸 번호(i, j)를 하나의 수로 만든 값 */
  readonly zones = new Map<number, ZoneType>();
  /** 구역이 바뀔 때마다 증가(화면이 구역 칸을 다시 그릴 때 확인) */
  zonesRevision = 0;
  /** 도로망(도로·표지·건물)이 바뀔 때마다 증가. 화면이 다시 그릴 때 확인 */
  revision = 0;
  /** 건물이 바뀔 때마다 증가(수요가 다시 계획할 때 확인) */
  buildingsRevision = 0;
  private nextNodeId = 1;
  private nextSegmentId = 1;
  private nextBuildingId = 1;

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

    // 건물 위로 지나가는 도로는 불가(외부 연결점은 지도 밖이라 제외)
    const rd = this.rules.roads[kind];
    for (const b of this.buildings.values()) {
      if (b.kind === 'external') continue;
      if (distToSegment(b, s1, s2).d < rd.lanesPerDir * rd.laneWidth + this.rules.buildings.footprint[b.size] + 1) return fail('onBuilding');
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
    this.pruneZones();
    this.revision++;
    return { ok: true, ids, length: plan.length };
  }

  /** 철거. 연결이 모두 없어진 노드도 같이 지운다(2개만 남은 이음 노드는 그대로 둔다) */
  removeSegment(id: number, force = false): boolean {
    const seg = this.segments.get(id);
    if (!seg || (seg.locked && !force)) return false;
    this.segments.delete(id);
    for (const nid of [seg.a, seg.b]) if (this.segmentsAt(nid).length === 0) this.nodes.delete(nid);
    this.revision++;
    return true;
  }

  /** 교차로(도로 3개 이상이 만나는 노드)로 들어오는 방향에 표지를 놓거나(kind) 치운다(null) */
  setSign(segId: number, nodeId: number, kind: SignKind | null): { ok: true } | { ok: false; error: 'notIntersection' | 'noSuchEnd' } {
    const seg = this.segments.get(segId);
    if (!seg || (seg.a !== nodeId && seg.b !== nodeId)) return { ok: false, error: 'noSuchEnd' };
    if (kind !== null && this.segmentsAt(nodeId).length < 3) return { ok: false, error: 'notIntersection' };
    if (seg.a === nodeId) seg.signA = kind; else seg.signB = kind;
    this.revision++;
    return { ok: true };
  }

  // ---------------- 건물 ----------------

  /** 건물을 놓을 수 있는지 확인만 한다 */
  planBuilding(_kind: BuildingKind, size: BuildingSize, x: number, y: number): { ok: true } | { ok: false; error: BuildingError } {
    const b = this.rules.buildings;
    const half = b.footprint[size];
    if (Math.abs(x) > b.worldHalf - half || Math.abs(y) > b.worldHalf - half) return { ok: false, error: 'outOfBounds' };
    for (const s of this.segments.values()) {
      const r = this.rules.roads[s.kind];
      if (distToSegment({ x, y }, this.nodes.get(s.a)!, this.nodes.get(s.b)!).d < r.lanesPerDir * r.laneWidth + half + 1) return { ok: false, error: 'onRoad' };
    }
    for (const o of this.buildings.values()) {
      if (Math.hypot(o.x - x, o.y - y) < half + b.footprint[o.size] + b.gap) return { ok: false, error: 'overlap' };
    }
    return { ok: true };
  }

  addBuilding(kind: BuildingKind, size: BuildingSize, x: number, y: number, source: BuildingSource = 'player', deletable = true, variant = 0): { ok: true; id: number } | { ok: false; error: BuildingError } {
    const p = this.planBuilding(kind, size, x, y);
    if (!p.ok) return p;
    const id = this.nextBuildingId++;
    this.buildings.set(id, { id, kind, size, x, y, source, deletable, parking: 0, variant });
    this.revision++;
    this.buildingsRevision++;
    return { ok: true, id };
  }

  /** 지도 가장자리의 외부 연결점(가상 건물). 지울 수 없고 도로와 겹침 검사를 받지 않는다 */
  addExternal(x: number, y: number): number {
    const id = this.nextBuildingId++;
    this.buildings.set(id, { id, kind: 'external', size: 'small', x, y, source: 'map', deletable: false, parking: 0, variant: 0 });
    this.revision++;
    this.buildingsRevision++;
    return id;
  }

  externalId(): number | null {
    for (const b of this.buildings.values()) if (b.kind === 'external') return b.id;
    return null;
  }

  // ---------------- 구역 ----------------

  /** 구역 칸 (i, j)의 상태. 칸 중심이 어떤 도로에서든 (도로 반폭 + 칸 반쪽) 이상 떨어져야 하고, 어떤 도로에서든 maxDist 안이어야 칠할 수 있다 */
  cellStatus(i: number, j: number): CellStatus {
    const { cell, maxDist } = this.rules.zones;
    const x = i * cell, y = j * cell, lim = this.rules.buildings.worldHalf - cell / 2;
    if (Math.abs(x) > lim || Math.abs(y) > lim) return 'out';
    let near = false;
    for (const s of this.segments.values()) {
      const r = this.rules.roads[s.kind];
      const d = distToSegment({ x, y }, this.nodes.get(s.a)!, this.nodes.get(s.b)!).d;
      if (d < r.lanesPerDir * r.laneWidth + cell / 2) return 'road';
      if (d <= maxDist) near = true;
    }
    return near ? 'ok' : 'far';
  }

  /** 건물이 차지한 칸(중심이 가장 가까운 칸). 외부 연결점은 제외 */
  occupiedCells(): Map<number, Building> {
    const c = this.rules.zones.cell, m = new Map<number, Building>();
    for (const b of this.buildings.values()) if (b.kind !== 'external') m.set(zkey(Math.round(b.x / c), Math.round(b.y / c)), b);
    return m;
  }

  /** 구역 칸 목록(칸 번호 순). 키가 같으면 하나 */
  zoneList(): { i: number; j: number; type: ZoneType }[] {
    return [...this.zones.keys()].sort((a, b) => a - b).map((k) => { const [i, j] = zcell(k); return { i, j, type: this.zones.get(k)! }; });
  }

  /** 건물이 아직 없고 도로 가까이에 있는, 이 종류 구역 칸(칸 번호 순) */
  freeZoneCells(type: ZoneType): { i: number; j: number }[] {
    const occ = this.occupiedCells();
    return this.zoneList().filter((z) => z.type === type && !occ.has(zkey(z.i, z.j)) && this.cellStatus(z.i, z.j) === 'ok');
  }

  /** 사각형(칸 번호 범위)을 구역으로 칠하거나(type) 지운다(null). 한 변은 maxRect칸까지. 바뀐 칸 수를 돌려준다.
   * 칠할 수 없는 칸(지도 밖·도로 위·도로에서 먼 곳·직접 놓은 건물이 있는 칸)은 건너뛴다. 자동으로 자란 건물이 다른 종류 구역이 되면 철거한다 */
  paintZone(i0: number, j0: number, i1: number, j1: number, type: ZoneType | null): number {
    const max = this.rules.zones.maxRect;
    const a = Math.min(i0, i1), b = Math.min(Math.max(i0, i1), a + max - 1);
    const c = Math.min(j0, j1), d = Math.min(Math.max(j0, j1), c + max - 1);
    const occ = this.occupiedCells();
    let n = 0;
    for (let i = a; i <= b; i++) for (let j = c; j <= d; j++) {
      const k = zkey(i, j), had = this.zones.get(k), o = occ.get(k);
      if (type === null) {
        if (had === undefined) continue;
        this.zones.delete(k);
        if (o && o.source === 'auto') this.removeBuilding(o.id, true);
        n++;
        continue;
      }
      if (had === type || this.cellStatus(i, j) !== 'ok') continue;
      if (o && o.source !== 'auto' && o.kind !== type) continue;
      if (o && o.source === 'auto' && o.kind !== type) this.removeBuilding(o.id, true);
      this.zones.set(k, type);
      n++;
    }
    if (n) this.zonesRevision++;
    return n;
  }

  /** 새 도로가 깔린 칸의 구역을 지운다 */
  private pruneZones(): void {
    let n = 0;
    for (const k of [...this.zones.keys()]) {
      const [i, j] = zcell(k);
      if (this.cellStatus(i, j) === 'road') { this.zones.delete(k); n++; }
    }
    if (n) this.zonesRevision++;
  }

  /** 도로를 철거 불가로 만든다(외부 연결 도로) */
  lockSegment(id: number): void {
    const s = this.segments.get(id);
    if (s) { s.locked = true; this.revision++; }
  }

  /** 맵이 제공한 건물(deletable=false)은 force 없이는 지울 수 없다 */
  removeBuilding(id: number, force = false): { ok: true } | { ok: false; error: BuildingError | 'noSuchBuilding' } {
    const b = this.buildings.get(id);
    if (!b) return { ok: false, error: 'noSuchBuilding' };
    if (!b.deletable && !force) return { ok: false, error: 'locked' };
    this.buildings.delete(id);
    this.revision++;
    this.buildingsRevision++;
    return { ok: true };
  }

  /** 건물에서 가장 가까운 도로 위 접속 지점(반경 안에 도로가 없으면 null = 미연결) */
  accessOf(id: number): { segId: number; t: number; x: number; y: number } | null {
    const b = this.buildings.get(id);
    return b ? this.projectOnRoad({ x: b.x, y: b.y }, this.rules.buildings.connectRadius) : null;
  }

  nearestBuilding(p: Pt, extra = 2): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.buildings.values()) {
      const d = dist(b, p);
      if (d <= this.rules.buildings.footprint[b.size] * 1.45 + extra && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /** 도로 구간의 제한속도를 바꾼다. 기본값과 같으면 "바꾸지 않음"(null)으로 돌아간다. 도로 종류의 상한을 넘거나 고를 수 없는 값이면 거부 */
  setSpeedLimit(segId: number, kmh: number | null): { ok: true } | { ok: false; error: 'noSuchSegment' | 'badSpeed' } {
    const seg = this.segments.get(segId);
    if (!seg) return { ok: false, error: 'noSuchSegment' };
    const r = this.rules.roads[seg.kind];
    if (kmh !== null && (!this.rules.speedChoicesKmh.includes(kmh) || kmh > r.maxSpeedKmh)) return { ok: false, error: 'badSpeed' };
    seg.playerSpeedKmh = kmh === r.defaultSpeedKmh ? null : kmh;
    this.revision++;
    return { ok: true };
  }

  /** 교차로의 신호등을 켜거나 끈다. 도로 3개 이상이 만나는 곳만 가능. 켜면 그 교차로의 정지·양보 표지는 무시된다 */
  setSignal(nodeId: number, on: boolean): { ok: true } | { ok: false; error: 'notIntersection' | 'noSuchNode' } {
    const n = this.nodes.get(nodeId);
    if (!n) return { ok: false, error: 'noSuchNode' };
    if (on && this.segmentsAt(nodeId).length < 3) return { ok: false, error: 'notIntersection' };
    n.signal = on;
    this.revision++;
    return { ok: true };
  }

  /** 신호등이 실제로 작동하는 교차로인가 */
  hasSignal(nodeId: number): boolean {
    return !!this.nodes.get(nodeId)?.signal && this.segmentsAt(nodeId).length >= 3;
  }

  signAt(segId: number, nodeId: number): SignKind | null {
    const s = this.segments.get(segId);
    return !s ? null : s.a === nodeId ? s.signA : s.b === nodeId ? s.signB : null;
  }

  private addNode(x: number, y: number): number {
    const id = this.nextNodeId++;
    this.nodes.set(id, { id, x, y, z: 0, signal: false });
    return id;
  }

  private addSegment(a: number, b: number, kind: RoadKind): number {
    const id = this.nextSegmentId++;
    this.segments.set(id, { id, a, b, kind, structure: 'ground', playerSpeedKmh: null, signA: null, signB: null, locked: false });
    return id;
  }

  // 기존 도로 a→b를 a→node, node→b로 나눈다(종류·설정 유지)
  private splitSegment(segId: number, node: number): void {
    const s = this.segments.get(segId)!;
    const oldB = s.b;
    const oldSignB = s.signB;
    s.b = node;
    s.signB = null; // 새로 생긴 이음 노드에는 표지가 없다
    const id = this.nextSegmentId++;
    this.segments.set(id, { ...s, id, a: node, b: oldB, signA: null, signB: oldSignB });
  }

  toJSON(): NetworkData {
    return {
      formatVersion: NETWORK_FORMAT_VERSION,
      nextNodeId: this.nextNodeId,
      nextSegmentId: this.nextSegmentId,
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      segments: [...this.segments.values()].map((s) => ({ ...s })),
      nextBuildingId: this.nextBuildingId,
      buildings: [...this.buildings.values()].map((b) => ({ ...b })),
      zones: this.zoneList().map((z): ZoneCell => [z.i, z.j, z.type === 'home' ? 0 : 1]),
    };
  }

  /** 파일·저장 슬롯에서 읽은 값을 검증한다. 문제가 있으면 쉬운 한국어 메시지로 Error를 던진다 */
  static parse(data: unknown, rules: Rules): NetworkData {
    const d = data as Partial<NetworkData> | null;
    if (!d || typeof d !== 'object' || typeof d.formatVersion !== 'number') throw new Error('도로망 파일이 아닙니다');
    if (d.formatVersion > NETWORK_FORMAT_VERSION) throw new Error('더 새로운 버전에서 저장한 파일입니다');
    if (d.formatVersion < 1 || !Number.isInteger(d.formatVersion)) throw new Error('지원하지 않는 저장 형식입니다');
    if (!Array.isArray(d.nodes) || !Array.isArray(d.segments)) throw new Error('도로망 파일이 손상되었습니다');
    const ids = new Set<number>();
    for (const n of d.nodes) {
      if (![n?.id, n?.x, n?.y, n?.z].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('도로망 파일이 손상되었습니다');
      ids.add(n.id);
    }
    for (const s of d.segments) {
      if (!ids.has(s?.a) || !ids.has(s?.b) || !(s.kind in rules.roads)) throw new Error('도로망 파일이 손상되었습니다');
    }
    const okSign = (v: unknown) => v === null || v === 'stop' || v === 'yield';
    // 형식 1 → 2: 표지 필드를 비워서 채운다
    const segments = d.segments.map((sg) => ({ ...sg, signA: (sg as Partial<Segment>).signA ?? null, signB: (sg as Partial<Segment>).signB ?? null, locked: (sg as Partial<Segment>).locked === true }));
    if (!segments.every((sg) => okSign(sg.signA) && okSign(sg.signB))) throw new Error('도로망 파일이 손상되었습니다');
    // 형식 1·2 → 3: 건물이 없는 것으로 채운다
    const rawB = (d as Partial<NetworkData>).buildings ?? [];
    if (!Array.isArray(rawB)) throw new Error('도로망 파일이 손상되었습니다');
    const kinds = ['home', 'office', 'external'], sizes = Object.keys(rules.buildings.footprint), sources = ['player', 'map', 'auto'];
    for (const b of rawB) {
      if (![b?.id, b?.x, b?.y].every((v) => typeof v === 'number' && Number.isFinite(v)) || !kinds.includes(b.kind) || !sizes.includes(b.size) || !sources.includes(b.source)) throw new Error('도로망 파일이 손상되었습니다');
    }
    // 형식 3 → 4: 건물 모양은 0, 도로는 철거 가능, 구역은 없는 것으로 채운다
    const buildings = rawB.map((b) => ({ ...b, deletable: b.deletable !== false, parking: b.parking ?? 0, variant: (b as Partial<Building>).variant ?? 0 }));
    if (!buildings.every((b) => typeof b.variant === 'number' && Number.isFinite(b.variant))) throw new Error('도로망 파일이 손상되었습니다');
    const rawZ = (d as Partial<NetworkData>).zones ?? [];
    if (!Array.isArray(rawZ) || !rawZ.every((z) => Array.isArray(z) && Number.isInteger(z[0]) && Number.isInteger(z[1]) && (z[2] === 0 || z[2] === 1) && Math.abs(z[0]) < 1000 && Math.abs(z[1]) < 1000)) throw new Error('도로망 파일이 손상되었습니다');
    const maxBuilding = Math.max(0, ...buildings.map((b) => b.id));
    const maxNode = Math.max(0, ...d.nodes.map((n) => n.id));
    const maxSeg = Math.max(0, ...d.segments.map((s) => s.id));
    return {
      formatVersion: NETWORK_FORMAT_VERSION,
      nextNodeId: Math.max(d.nextNodeId ?? 0, maxNode + 1),
      nextSegmentId: Math.max(d.nextSegmentId ?? 0, maxSeg + 1),
      nodes: d.nodes.map((n) => ({ ...n, signal: (n as Partial<NetNode>).signal === true })),
      segments,
      nextBuildingId: Math.max((d as Partial<NetworkData>).nextBuildingId ?? 0, maxBuilding + 1),
      buildings,
      zones: rawZ,
    };
  }

  load(data: NetworkData): void {
    this.nodes.clear();
    this.segments.clear();
    for (const n of [...data.nodes].sort((a, b) => a.id - b.id)) this.nodes.set(n.id, { ...n });
    for (const s of [...data.segments].sort((a, b) => a.id - b.id)) this.segments.set(s.id, { ...s });
    this.nextNodeId = data.nextNodeId;
    this.nextSegmentId = data.nextSegmentId;
    this.buildings.clear();
    for (const b of [...data.buildings].sort((a, c) => a.id - c.id)) this.buildings.set(b.id, { ...b });
    this.nextBuildingId = data.nextBuildingId;
    this.zones.clear();
    for (const [i, j, t] of [...data.zones].sort((a, b) => zkey(a[0], a[1]) - zkey(b[0], b[1]))) this.zones.set(zkey(i, j), t === 0 ? 'home' : 'office');
    this.zonesRevision++;
    this.revision++;
    this.buildingsRevision++;
  }
}
