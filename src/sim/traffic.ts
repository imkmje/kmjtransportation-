import type { Config } from '../config';
import { buildLaneGraph, LaneGraph, posAt, Track } from './lanes';
import type { Network } from './network';
import type { Rng } from './random';
import { findRoute, findRouteFromTrack, RoadPos, Route } from './route';

/** 이동 하나의 꼬리표. 수요가 만든 이동은 어느 건물에서 어느 건물로 가는지 알아야 도착·분실을 처리할 수 있다 */
export interface TripMeta {
  kind: 'commute' | 'return' | 'test'; // 출근 / 퇴근 / 테스트 도구(통계에서 제외)
  from: number; // 출발 건물 ID (test는 0)
  to: number; // 도착 건물 ID
  born: number; // 이동이 발생한 tick(출발 대기 시간 포함해 통행시간을 잰다)
  mode: 'car'; // 3.0.0 예약: 이동수단. 지금은 항상 승용차
  ownerId: number; // 3.0.0 예약: 차량 소유 ID
}
export type LostReason = 'noRoute' | 'abandoned' | 'removed' | 'deadlock';
interface Job { meta: TripMeta; from: RoadPos; to: RoadPos; born: number }

export interface Vehicle {
  id: number;
  meta: TripMeta | null;
  mRef: number; mAct: number; // 통계용: 현재 구간(버킷)에서 기준 이동거리와 실제 이동거리
  gv: number; // 통계용: 방해받지 않는 "기준 차량"의 속도(같은 가속 모델로 출발했다면 도달했을 속도)
  path: number[]; // 지나갈 트랙 ID 순서(차선 변경 때 이 차량 것만 고쳐 쓰므로 투입 때 복사한다)
  pi: number; // 현재 트랙이 path의 몇 번째인지
  s: number; // 현재 트랙 위에서 차량 앞 범퍼의 위치(m)
  v: number; // 속도(m/s)
  acc: number; // 직전 tick의 가속도(차선 변경 판단용)
  endS: number; // 마지막 트랙에서 멈출 위치
  factor: number; // 운전자 개체 계수
  length: number;
  waitTicks: number; // 회차 대기 누적
  uturnDone: number; // 회차 대기를 마친 path 인덱스
  status: string; // 멈춘 이유(화면 표시용). 달리는 중이면 ''
  x: number; y: number; h: number; // 현재 위치
  px: number; py: number; ph: number; // 직전 tick 위치(화면 보간용)
  // tick 시작 시점의 값(앞차·교차로 판단은 이 값으로 해야 처리 순서에 영향을 받지 않는다)
  ss: number; sv: number; spi: number; li: number;
  // 교차로
  zoned: boolean; // 정지선 앞 요청 구간 안
  granted: boolean; // 이번 tick에 교차로 진입 허가
  reason: string; // 허가를 못 받은 이유
  reqTick: number; reqPi: number; // 통과 요청 시작 tick
  grantPi: number; // 이 차선에서 이미 허가를 받았으면 그 path 인덱스(허가는 교차로에 들어가기 전까지 유지·보호된다)
  stopTicks: number; stopPi: number; // 정지 표지 앞에서 완전히 선 시간
  waiver: boolean; // 교착 해소: 출구 점검 면제 + 최우선
  waitFor: number; // 지금 기다리는 차량 ID(교착 탐지용). 0이면 없음
  waitSince: number; // 멈추기 시작한 tick(0이면 달리는 중)
  hold: boolean; holdFor: number; // 테스트·디버그용: 제자리에 고정하고, holdFor가 있으면 그 차량을 기다리는 것으로 본다
  // 차선 변경
  lcCool: number; // 다시 바꿀 수 있을 때까지 남은 tick
  lcPhantom: number; lcFrom: number; lcPi: number; // 이전 차선에도 흔적이 남는 시간(두 차선 점유). lcPi: 흔적은 바꾼 차선 위(path 인덱스)에 있는 동안만 유효
  lcTicks: number; lcOffX: number; lcOffY: number; // 옆으로 미끄러지는 표시용 오프셋
}

interface SpawnRequest { path: number[]; startS: number; endS: number; remaining: number; nextTick: number; blocked: number }
interface Entry { v: Vehicle; s: number; sv: number; len: number; phantom: boolean }
interface Req { v: Vehicle; conn: Track; tick: number; d: number; sticky: boolean; insideBlock: number; exitBlock: number }

export interface Stats {
  spawned: number; arrived: number; abandoned: number; interventions: number; noRoute: number;
  conflicts: number; // 충돌 지점을 동시에 점유한 횟수(0이어야 한다)
  laneChanges: number; deadlocks: number; removed: number; // 교착 해소 시작 / 교착 때문에 제거된 차량
}

export type Car = Config['vehicles']['car'];

/** IDM 가속도. gap이 Infinity면 앞이 비어 있는 것 */
export function idm(car: Car, v: number, v0: number, gap: number, vl: number, s0: number): number {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (!Number.isFinite(gap)) return car.a * free;
  const sStar = s0 + Math.max(0, v * car.T + (v * (v - vl)) / (2 * Math.sqrt(car.a * car.b)));
  return car.a * (free - (sStar / Math.max(gap, 0.01)) ** 2);
}

/** "누가 누구를 기다리는지" 그래프(각자 최대 1명)에서 순환을 찾는다. 반환: 순환마다 차량 ID 목록 */
export function findCycles(waitFor: Map<number, number>): number[][] {
  const state = new Map<number, number>(); // 1 = 탐색 중, 2 = 끝남
  const cycles: number[][] = [];
  for (const start of waitFor.keys()) {
    if (state.get(start)) continue;
    const walk: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !state.get(cur)) {
      state.set(cur, 1);
      walk.push(cur);
      cur = waitFor.get(cur);
    }
    if (cur !== undefined && state.get(cur) === 1) cycles.push(walk.slice(walk.indexOf(cur)));
    for (const id of walk) state.set(id, 2);
  }
  return cycles;
}

export class Traffic {
  graph: LaneGraph;
  readonly vehicles = new Map<number, Vehicle>(); // 삽입 순서 = ID 순서
  readonly stats: Stats = { spawned: 0, arrived: 0, abandoned: 0, interventions: 0, noRoute: 0, conflicts: 0, laneChanges: 0, deadlocks: 0, removed: 0 };
  /** 안전망이 마지막으로 개입한 상황(디버그용) */
  lastIntervention = '';
  /** 건물에서 출발할 이동 대기열(자리가 나면 투입). 맨 앞부터 처리한다 */
  jobs: Job[] = [];
  /** 차량이 도착했을 때 / 도착하지 못하고 사라질 때(미완료) 알림 */
  onArrive: ((v: Vehicle, tick: number) => void) | null = null;
  onLost: ((v: Vehicle | null, meta: TripMeta, reason: LostReason, tick: number) => void) | null = null;
  private routeCache = new Map<string, Route | null>();
  private requests: SpawnRequest[] = [];
  private lists = new Map<number, Entry[]>();
  private cycleState = new Map<string, { since: number; stage: number; stageTick: number; vid: number }>();
  private nextId = 1;
  private tick = 0;

  constructor(private cfg: Config, private net: Network, private rng: Rng) {
    this.graph = buildLaneGraph(net, cfg);
  }

  /**
   * 도로망이 바뀌었으면 그래프를 다시 만들고, 달리던 차량은 같은 차선·연결선(이름이 같은 것)이 남아 있으면 그대로 이어서 달린다.
   * 앞으로 갈 길이 끊긴 차량과 모양이 바뀐 연결선 위의 차량은 제거(미완료)
   */
  sync(): void {
    if (this.graph.revision === this.net.revision) return;
    const old = this.graph;
    const nu = buildLaneGraph(this.net, this.cfg);
    const byKey = new Map(nu.tracks.map((t) => [t.key, t.id]));
    this.graph = nu;
    this.routeCache.clear();
    this.cycleState.clear();
    this.requests = [];
    for (const v of [...this.vehicles.values()]) {
      const ids: number[] = [];
      let ok = true, changed = false;
      for (let k = v.pi; k < v.path.length && ok; k++) {
        const o = old.tracks[v.path[k]];
        const id = byKey.get(o.key);
        if (id === undefined) ok = false;
        else { ids.push(id); if (Math.abs(nu.tracks[id].length - o.length) > 0.05) changed = true; }
      }
      let s = v.s, endS = v.endS;
      if (ok) {
        const cur = old.tracks[v.path[v.pi]], now = nu.tracks[ids[0]];
        if (cur.kind === 'conn') ok = now.pts.length === cur.pts.length && now.pts.every((p, i) => Math.hypot(p.x - cur.pts[i].x, p.y - cur.pts[i].y) < 0.05); // 모양이 바뀐 교차로 안은 지운다
        else s = this.reproject(cur, now, v.s);
        const lastOld = old.tracks[v.path[v.path.length - 1]], lastNew = nu.tracks[ids[ids.length - 1]];
        if (ok && lastOld.kind === 'lane') endS = this.reproject(lastOld, lastNew, v.endS);
      }
      if (!ok) { this.vehicles.delete(v.id); if (v.meta) this.onLost?.(v, v.meta, 'removed', this.tick); continue; }
      v.uturnDone = Math.max(-1, v.uturnDone - v.pi);
      v.path = ids; v.pi = 0; v.s = s; v.endS = endS;
      v.grantPi = -1; v.reqPi = -1; v.stopPi = -1; v.lcPhantom = 0; v.lcFrom = -1;
      // 길의 모양이 바뀌었고(예: 도로가 둘로 나뉨) 목적지 건물이 있으면, 그 건물로 다시 길을 찾는다
      if (changed && v.meta && v.meta.kind !== 'test' && this.net.buildings.has(v.meta.to)) {
        const to = this.net.accessOf(v.meta.to);
        if (!to || !this.reroute(v, to)) { this.vehicles.delete(v.id); this.onLost?.(v, v.meta, 'removed', this.tick); }
      }
    }
  }

  // 옛 차선 위의 거리 s를 새 차선 위의 거리로 바꾼다(같은 도로 위의 같은 지점). 도로 끝 여유가 달라지면 시작점이 움직이기 때문
  private reproject(oldT: Track, newT: Track, s: number): number {
    const p = posAt(oldT, s);
    const a = newT.pts[0], b = newT.pts[1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return Math.min(Math.max(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len, 0), newT.length);
  }

  /** 차량과 투입 대기를 모두 치운다(통계는 유지). 치워진 차량은 미완료로 알린다 */
  clear(): void {
    for (const v of this.vehicles.values()) if (v.meta) this.onLost?.(v, v.meta, 'removed', this.tick);
    for (const j of this.jobs) this.onLost?.(null, j.meta, 'removed', this.tick);
    this.vehicles.clear();
    this.jobs = [];
    this.requests = [];
    this.cycleState.clear();
  }

  /** 차량 한 대를 길 위에서 치운다(건물 삭제 등). 이동이 있던 차량은 미완료로 알린다 */
  dropVehicle(v: Vehicle, reason: LostReason): void {
    if (this.vehicles.delete(v.id) && v.meta) this.onLost?.(v, v.meta, reason, this.tick);
  }

  /** 건물에서 건물로 가는 이동 하나를 대기열에 넣는다. 자리가 나면 출발하고, 5분 넘게 못 나가면 포기 */
  enqueue(meta: TripMeta, from: RoadPos, to: RoadPos): void {
    this.jobs.push({ meta, from, to, born: this.tick });
  }

  private routeFor(from: RoadPos, to: RoadPos): Route | null {
    const key = `${from.segId}:${from.t.toFixed(1)}>${to.segId}:${to.t.toFixed(1)}`;
    if (this.routeCache.has(key)) return this.routeCache.get(key)!;
    const r = findRoute(this.graph, from, to);
    this.routeCache.set(key, r);
    return r;
  }

  /** 달리는 중인 차량을 지금 위치에서 새 목적지로 다시 보낸다. 길이 없으면 false(호출한 쪽이 미완료 처리) */
  reroute(v: Vehicle, to: RoadPos): boolean {
    const r = findRouteFromTrack(this.graph, v.path[v.pi], v.s, to);
    if (!r) return false;
    v.path = r.path; v.pi = 0; v.endS = r.endS; v.uturnDone = -1;
    v.grantPi = -1; v.reqPi = -1; v.stopPi = -1;
    return true;
  }

  requestTrip(from: RoadPos, to: RoadPos, count: number): { ok: true; path: number[] } | { ok: false; reason: 'noRoute' } {
    this.sync();
    const r = findRoute(this.graph, from, to);
    if (!r) { this.stats.noRoute += count; return { ok: false, reason: 'noRoute' }; }
    this.requests.push({ path: r.path, startS: r.startS, endS: r.endS, remaining: count, nextTick: this.tick, blocked: 0 });
    return { ok: true, path: r.path };
  }

  /** 정해진 경로 위에 차량을 직접 놓는다(테스트·투입 공용). 자리가 막혀 있으면 null */
  spawnOnPath(path: number[], startS: number, endS: number, factor?: number, meta: TripMeta | null = null): Vehicle | null {
    const d = this.cfg.driving;
    if (this.vehicles.size >= d.maxVehicles) return null;
    const first = path[0];
    const car0 = this.cfg.vehicles.car;
    for (const o of this.occupancy().get(first) ?? []) {
      if (o.s > startS - d.spawnClear - o.len && o.s < startS + d.spawnClear) return null; // 바로 앞뒤에 차가 있다
      // 뒤에서 달려오는 차가 새 차에 닿기 전에 편하게(감속 b) 설 수 있어야 한다. 합류할 때의 간격 확인과 같다
      const gapBehind = startS - o.s - o.len;
      if (gapBehind > 0 && gapBehind < car0.s0 + o.v * car0.T + (o.v * o.v) / (2 * car0.b)) return null;
    }
    const car = this.cfg.vehicles.car;
    const f = factor ?? Math.min(1.15, Math.max(0.85, 1 + 0.08 * this.gauss()));
    const p = posAt(this.graph.tracks[first], startS);
    const v: Vehicle = {
      id: this.nextId++, meta, mRef: 0, mAct: 0, gv: 0, path: path.slice(), pi: 0, s: startS, v: 0, acc: 0, endS, factor: f, length: car.length, waitTicks: 0, uturnDone: -1, status: '',
      x: p.x, y: p.y, h: p.h, px: p.x, py: p.y, ph: p.h, ss: startS, sv: 0, spi: 0, li: 0,
      zoned: false, granted: false, reason: '', reqTick: 0, reqPi: -1, grantPi: -1, stopTicks: 0, stopPi: -1, waiver: false, waitFor: 0, waitSince: 0, hold: false, holdFor: 0,
      lcCool: 0, lcPhantom: 0, lcFrom: -1, lcPi: -1, lcTicks: 0, lcOffX: 0, lcOffY: 0,
    };
    this.vehicles.set(v.id, v);
    if (this.occ) { const e = { s: v.s, len: v.length, v: v.v }; const l = this.occ.get(first); if (l) l.push(e); else this.occ.set(first, [e]); }
    this.stats.spawned++;
    return v;
  }

  // 이번 tick에 투입 자리를 확인할 때 쓰는 트랙별 차량 목록(처음 필요할 때 한 번 만든다)
  private occ: Map<number, { s: number; len: number; v: number }[]> | null = null;
  private occupancy(): Map<number, { s: number; len: number; v: number }[]> {
    if (!this.occ) {
      this.occ = new Map();
      const put = (k: number, e: { s: number; len: number; v: number }) => { const l = this.occ!.get(k); if (l) l.push(e); else this.occ!.set(k, [e]); };
      for (const v of this.vehicles.values()) {
        put(v.path[v.pi], { s: v.s, len: v.length, v: v.v });
        if (v.lcPhantom > 0 && v.pi === v.lcPi) put(v.lcFrom, { s: v.s, len: v.length, v: v.v }); // 차선을 바꾸는 중인 차는 이전 차선에도 아직 걸쳐 있다
      }
    }
    return this.occ;
  }

  private gauss(): number {
    const u1 = Math.max(this.rng.next(), 1e-12), u2 = this.rng.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private spawnStep(): void {
    const rate = this.cfg.tickRate;
    for (const r of this.requests) {
      if (r.remaining <= 0 || this.tick < r.nextTick) continue;
      if (this.spawnOnPath(r.path, r.startS, r.endS, undefined, { kind: 'test', from: 0, to: 0, born: this.tick, mode: 'car', ownerId: 0 })) {
        r.remaining--;
        r.blocked = 0;
        r.nextTick = this.tick + Math.round(this.cfg.driving.spawnIntervalSec * rate);
      } else if (++r.blocked > this.cfg.driving.spawnTimeoutSec * rate) {
        this.stats.abandoned += r.remaining; // 출발 대기 한도 초과: 포기(미완료)
        r.remaining = 0;
      }
    }
    this.requests = this.requests.filter((r) => r.remaining > 0);

    // 건물에서 출발하는 이동: 접속 차선에 자리가 나면 투입, 경로가 없으면 취소, 한도(5분)를 넘으면 포기
    if (this.jobs.length) {
      const limit = this.cfg.driving.spawnTimeoutSec * rate;
      const keep: Job[] = [];
      for (const j of this.jobs) {
        if (this.tick - j.born > limit) { this.stats.abandoned++; this.onLost?.(null, j.meta, 'abandoned', this.tick); continue; }
        const r = this.routeFor(j.from, j.to);
        if (!r) { this.stats.noRoute++; this.onLost?.(null, j.meta, 'noRoute', this.tick); continue; }
        if (!this.spawnOnPath(r.path, r.startS, r.endS, undefined, j.meta)) keep.push(j);
      }
      this.jobs = keep;
    }
  }

  step(tick: number): void {
    this.tick = tick;
    this.occ = null;
    this.sync();
    this.spawnStep();
    const dt = 1 / this.cfg.tickRate;

    // 1) tick 시작 스냅샷과 트랙별 차량 목록(앞에 있는 차 순서). 차선 변경 직후 2초간은 이전 차선에도 흔적을 남긴다
    this.lists.clear();
    const add = (k: number, e: Entry) => { const l = this.lists.get(k); if (l) l.push(e); else this.lists.set(k, [e]); };
    for (const v of this.vehicles.values()) {
      v.ss = v.s; v.sv = v.v; v.spi = v.pi; v.px = v.x; v.py = v.y; v.ph = v.h;
      if (v.lcCool > 0) v.lcCool--;
      if (v.lcPhantom > 0) v.lcPhantom = v.pi === v.lcPi ? v.lcPhantom - 1 : 0; // 다른 트랙으로 넘어갔으면 흔적은 끝
      v.waitFor = 0;
      add(v.path[v.pi], { v, s: v.ss, sv: v.sv, len: v.length, phantom: false });
      if (v.lcPhantom > 0) add(v.lcFrom, { v, s: v.ss, sv: v.sv, len: v.length, phantom: true });
    }
    for (const l of this.lists.values()) {
      l.sort((a, b) => a.s - b.s || a.v.id - b.v.id);
      l.forEach((e, i) => { if (!e.phantom) e.v.li = i; });
    }

    // 2) 교차로 진입 허가, 3) 이동
    this.resolveIntersections(tick);
    const done: number[] = [];
    for (const v of this.vehicles.values()) if (this.update(v, dt, tick)) done.push(v.id);
    for (const id of done) { const v = this.vehicles.get(id)!; this.vehicles.delete(id); this.stats.arrived++; this.onArrive?.(v, tick); }

    // 4) 차선 변경, 5) 점검
    this.laneChanges(tick);
    this.countConflicts();
    if (tick % Math.round(this.cfg.deadlock.detectSec * this.cfg.tickRate) === 0) this.deadlocks(tick);
  }

  // ---------------- 교차로 ----------------

  // o가 r보다 먼저 지나갈 자격이 있는가 (rules.md 9항 우선순위)
  private higher(o: Req, r: Req): boolean {
    if (o.sticky !== r.sticky) return o.sticky; // 이미 허가받은 차량은 새로 온 차량에게 밀리지 않는다(우선순위 역전 방지)
    const so = o.conn.sign ? 1 : 0, sr = r.conn.sign ? 1 : 0;
    if (so !== sr) return so < sr; // 표지 없는 쪽이 먼저
    if (o.conn.rank !== r.conn.rank) return o.conn.rank > r.conn.rank; // 도로 등급
    const rank = (t: Track) => (t.turn === 'left' ? 1 : t.turn === 'uturn' ? 2 : 0);
    if (Math.abs(o.tick - r.tick) <= this.cfg.intersection.simultaneousSec * this.cfg.tickRate && rank(o.conn) !== rank(r.conn)) return rank(o.conn) < rank(r.conn); // 좌회전은 직진·우회전에 양보
    if (o.tick !== r.tick) return o.tick < r.tick; // 먼저 요청한 차
    return o.v.id < r.v.id;
  }

  private resolveIntersections(tick: number): void {
    const car = this.cfg.vehicles.car, ix = this.cfg.intersection, d = this.cfg.driving;
    const tracks = this.graph.tracks;
    const rate = this.cfg.tickRate;
    const nodes = new Map<number, { inside: { v: Vehicle; conn: number }[]; reqs: Req[] }>();
    const node = (n: number) => { let g = nodes.get(n); if (!g) { g = { inside: [], reqs: [] }; nodes.set(n, g); } return g; };

    for (const v of this.vehicles.values()) {
      v.granted = false; v.zoned = false; v.reason = '';
      const tr = tracks[v.path[v.spi]];
      const last = v.path.length - 1;
      // 교차로 안에 있는 차량: 연결선 위, 또는 앞이 막 나갔지만 뒤쪽이 아직 연결선에 걸친 차량
      if (tr.kind === 'conn') node(tr.node).inside.push({ v, conn: tr.id });
      else if (v.spi > 0 && tracks[v.path[v.spi - 1]].kind === 'conn' && v.ss < v.length) {
        const c = tracks[v.path[v.spi - 1]];
        node(c.node).inside.push({ v, conn: c.id });
      }
      if (tr.kind !== 'lane' || v.spi >= last) continue;
      const c = tracks[v.path[v.spi + 1]];
      if (c.kind !== 'conn') continue;
      // 같은 차선에서 앞에 차가 있으면 아직 내 차례가 아니다(요청·허가는 줄 맨 앞 차량만. 뒷차가 허가를 쥐고 앞차를 막는 교착 방지)
      if (this.lists.get(v.path[v.spi])?.[v.li + 1]) { v.reqTick = 0; continue; }
      const dEnd = tr.length - v.ss;
      if (dEnd > ix.zone + (v.sv * v.sv) / (2 * car.b)) { v.reqTick = 0; continue; } // 아직 멀다
      v.zoned = true;
      let eligible = true;
      if (c.sign === 'stop') { // 정지 표지: 정지선에서 완전히 서서 일정 시간 기다린 뒤에야 요청
        if (dEnd <= ix.stopLineTol && v.sv < 0.1) { if (v.stopPi !== v.spi) { v.stopPi = v.spi; v.stopTicks = 0; } v.stopTicks++; }
        eligible = v.stopPi === v.spi && v.stopTicks >= Math.round(ix.stopSec * rate);
        if (!eligible) v.reason = '정지 표지';
      }
      if (c.uturn && v.uturnDone < v.spi + 1) eligible = false; // 회차는 정지 대기를 마친 뒤에
      if (!eligible) { v.reqTick = 0; continue; }
      if (v.reqTick === 0 || v.reqPi !== v.spi) { v.reqTick = tick; v.reqPi = v.spi; }
      node(c.node).reqs.push({ v, conn: c, tick: v.reqTick, d: dEnd, sticky: v.grantPi === v.spi, insideBlock: 0, exitBlock: 0 });
    }

    for (const g of nodes.values()) {
      if (!g.reqs.length) continue;
      for (const r of g.reqs) {
        for (const i of g.inside) if (i.v !== r.v && r.conn.conflicts.includes(i.conn)) { r.insideBlock = i.v.id; break; }
        if (!r.v.waiver) { // 출구 공간 점검: 나갈 차선 맨 앞 차량의 뒤꽁무니와 차 한 대 + 안전 간격 이상 떨어져 있어야 진입
          // 나갈 차선 맨 앞 차량 뒤꽁무니에서 차 한 대 + 안전 간격이 비어 있어야 한다. 앞차가 달리고 있으면 내가 연결선을 건너는 동안 더 앞서 가므로 그만큼을 더한다(서 있는 줄은 그대로 막는다)
          const first = this.lists.get(r.conn.next[0])?.[0];
          if (first && first.s - first.len + first.sv * (r.conn.length / Math.max(r.v.sv, 3)) < car.length + car.s0) r.exitBlock = first.v.id;
        }
      }
      const pool = g.reqs.filter((r) => !r.exitBlock); // 출구가 막혀 못 들어가는 차량은 다른 차량을 막을 자격이 없다
      const free = g.reqs.filter((r) => !r.insideBlock && !r.exitBlock);
      const blockerOf = new Map<Req, Req>();
      let any = false;
      for (const r of free) {
        const blocker = r.v.waiver ? undefined : pool.find((o) => o !== r && r.conn.conflicts.includes(o.conn.id) && this.higher(o, r));
        if (!blocker) { r.v.granted = true; any = true; }
        else { blockerOf.set(r, blocker); r.v.waitFor = blocker.v.id; r.v.reason = '양보'; }
      }
      // 서로 기다리는 순환(동시 도착 등)일 때만: 먼저 요청한 차, 같으면 ID가 작은 차가 간다. 막은 쪽이 순환 밖(교차로 안 차량 등)이면 기다린다
      if (!any && free.length) {
        const set = new Set(free);
        if (free.every((r) => set.has(blockerOf.get(r)!))) {
          const w = free.reduce((x, y) => (x.tick < y.tick || (x.tick === y.tick && x.v.id < y.v.id) ? x : y));
          w.v.granted = true; w.v.waitFor = 0; w.v.reason = '';
        }
      }
      for (const r of g.reqs) {
        if (r.insideBlock) { r.v.waitFor = r.insideBlock; r.v.reason = '양보'; }
        else if (r.exitBlock) { r.v.waitFor = r.exitBlock; r.v.reason = '출구 공간 없음'; }
        // 달리는 중이라 최대 제동으로도 정지선 앞에서 설 수 없는 차량만 그대로 통과(서 있는 차량은 해당 없음)
        else if (!r.v.granted && r.v.sv > 1 && (r.v.sv * r.v.sv) / (2 * d.brakeMax) > r.d) r.v.granted = true;
        r.v.grantPi = r.v.granted ? r.v.spi : -1;
      }
    }
  }

  private countConflicts(): void {
    const tracks = this.graph.tracks;
    const per = new Map<number, { conn: number }[]>();
    for (const v of this.vehicles.values()) {
      const tr = tracks[v.path[v.pi]];
      let c: Track | undefined;
      if (tr.kind === 'conn') c = tr;
      else if (v.pi > 0 && tracks[v.path[v.pi - 1]].kind === 'conn' && v.s < v.length) c = tracks[v.path[v.pi - 1]];
      if (!c) continue;
      const l = per.get(c.node);
      if (l) l.push({ conn: c.id }); else per.set(c.node, [{ conn: c.id }]);
    }
    for (const l of per.values()) {
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        if (l[i].conn !== l[j].conn && tracks[l[i].conn].conflicts.includes(l[j].conn)) this.stats.conflicts++;
      }
    }
  }

  // ---------------- 이동 ----------------

  // ---- 저장·불러오기·초기화 ----
  getState() {
    return {
      nextId: this.nextId, tick: this.tick,
      vehicles: [...this.vehicles.values()].map((v) => ({ ...v, path: v.path.slice(), meta: v.meta ? { ...v.meta } : null })),
      jobs: this.jobs.map((j) => ({ meta: { ...j.meta }, from: { ...j.from }, to: { ...j.to }, born: j.born })),
      requests: this.requests.map((r) => ({ ...r, path: r.path.slice() })),
      stats: { ...this.stats }, lastIntervention: this.lastIntervention,
      cycles: [...this.cycleState],
    };
  }

  /** 도로망을 먼저 불러온 뒤에 호출한다. 차선 번호는 도로망에서 항상 같게 만들어지므로 경로를 그대로 쓴다 */
  setState(s: ReturnType<Traffic['getState']>): void {
    this.graph = buildLaneGraph(this.net, this.cfg);
    this.routeCache.clear();
    this.occ = null;
    this.vehicles.clear();
    for (const v of s.vehicles) this.vehicles.set(v.id, { ...v, path: v.path.slice(), meta: v.meta ? { ...v.meta } : null });
    this.jobs = s.jobs.map((j) => ({ meta: { ...j.meta }, from: { ...j.from }, to: { ...j.to }, born: j.born }));
    this.requests = s.requests.map((r) => ({ ...r, path: r.path.slice() }));
    Object.assign(this.stats, s.stats);
    this.lastIntervention = s.lastIntervention;
    this.cycleState = new Map(s.cycles.map(([k, c]) => [k, { ...c }]));
    this.nextId = s.nextId; this.tick = s.tick;
  }

  /** 처음 상태로 되돌린다(새 맵을 열 때) */
  reset(): void {
    this.vehicles.clear(); this.jobs = []; this.requests = []; this.cycleState.clear(); this.routeCache.clear(); this.occ = null;
    for (const k of Object.keys(this.stats) as (keyof Stats)[]) this.stats[k] = 0;
    this.lastIntervention = ''; this.nextId = 1; this.tick = 0;
    this.graph = buildLaneGraph(this.net, this.cfg);
  }

  // 한 대를 한 tick 움직인다. 도착했으면 true
  private update(v: Vehicle, dt: number, tick: number): boolean {
    const d = this.cfg.driving, car = this.cfg.vehicles.car, ix = this.cfg.intersection;
    if (v.hold) { v.v = 0; v.acc = 0; v.status = '고정'; v.waitFor = v.holdFor; this.markWait(v, tick); return false; }
    const tracks = this.graph.tracks;
    const last = v.path.length - 1;
    const tr = tracks[v.path[v.pi]];
    const trackEnd = v.pi === last ? v.endS : tr.length;
    const distEnd = trackEnd - v.s;
    const nextConn = v.pi < last && tracks[v.path[v.pi + 1]].kind === 'conn' ? tracks[v.path[v.pi + 1]] : null;
    const nextIsUturn = !!nextConn && nextConn.uturn && v.uturnDone < v.pi + 1;
    const cap = (t: Track) => (t.kind === 'lane' ? t.vmax * v.factor : t.vmax);

    // 막다른 끝 회차: 차선 끝에서 정지 → 대기 → 진입
    if (nextIsUturn && distEnd <= ix.stopLineTol && v.v < 0.3) {
      v.v = 0; v.acc = 0;
      v.status = '회차 대기';
      this.markWait(v, tick);
      if (++v.waitTicks >= Math.round(d.uturnWaitSec * this.cfg.tickRate)) { v.uturnDone = v.pi + 1; v.waitTicks = 0; }
      return false;
    }

    // 목표 속도: 제한속도 → (양보 표지 접근) → 앞의 연결선·차선 제한
    let v0 = Math.min(cap(tr), car.vmaxKmh / 3.6);
    let vGeo = v0; // 통계의 기준 속도: 도로·커브가 허용하는 속도(표지·앞차·교차로 때문에 줄이기 전)
    let dist = distEnd;
    for (let k = v.pi + 1; dist < d.lookahead && k <= last; k++) {
      const t2 = tracks[v.path[k]];
      vGeo = Math.min(vGeo, Math.sqrt(cap(t2) ** 2 + 2 * car.b * dist));
      dist += k === last ? v.endS : t2.length;
    }
    v0 = vGeo;
    if (nextConn?.sign === 'yield') v0 = Math.min(v0, Math.sqrt((ix.yieldKmh / 3.6) ** 2 + 2 * 0.7 * car.b * Math.max(0, distEnd))); // 정지선에서 양보 속도가 되도록 미리 줄인다(IDM이 목표를 따라가는 지연을 감안해 여유 30%)

    // 장애물마다 IDM 가속도를 구하고 가장 작은 값(가장 조심스러운 쪽)을 쓴다
    let acc = idm(car, v.v, v0, Infinity, 0, car.s0);
    // 앞차
    const list = this.lists.get(v.path[v.spi]);
    let leader: Entry | undefined = list?.[v.li + 1];
    let gap = Infinity;
    if (leader) gap = leader.s - leader.len - v.ss;
    else if (!(nextConn && v.zoned && !v.granted)) { // 정지선에서 멈춰야 하는 차량은 선 너머 앞차를 볼 필요가 없다(합류는 교차로 점유 검사가 막는다)
      let accDist = tr.length - v.ss;
      for (let k = v.spi + 1; accDist < d.lookahead && k <= last; k++) {
        const l = this.lists.get(v.path[k]);
        if (l && l.length) { leader = l[0]; gap = accDist + l[0].s - l[0].len; break; }
        accDist += tracks[v.path[k]].length;
      }
    }
    if (leader) acc = Math.min(acc, idm(car, v.v, v0, gap, leader.sv, car.s0));
    // 정지선: 허가가 없으면 선 앞에서 선다. 목적지: 멈출 위치에서 선다
    const mustStop = nextIsUturn || (!!nextConn && v.zoned && !v.granted);
    if (mustStop) acc = Math.min(acc, idm(car, v.v, v0, distEnd, 0, ix.stopLineS0));
    if (v.pi === last) acc = Math.min(acc, idm(car, v.v, v0, distEnd, 0, 0.5));
    acc = Math.max(-d.brakeMax, Math.min(car.a, acc));
    v.acc = acc;
    v.v = Math.max(0, v.v + acc * dt);
    if (v.v < 0.02 && acc <= 0) v.v = 0;
    let ds = v.v * dt;
    if (mustStop) ds = Math.min(ds, Math.max(0, tr.length - v.s)); // 정지선을 넘지 못한다

    // 안전망: 앞차와 겹치기 직전이면 강제로 막고 기록(기본 시나리오에서는 0건이어야 한다)
    if (leader && gap - ds < d.minGap) {
      const allowed = Math.max(0, gap - d.minGap);
      if (ds - allowed > 1e-6) {
        this.stats.interventions++;
        const lt = (x: Vehicle) => { const t = tracks[x.path[x.pi]]; return `${t.kind}${t.id}${t.kind === 'conn' ? '/' + t.turn : ''}`; };
        this.lastIntervention = `tick ${tick}: #${v.id} ${lt(v)} s=${v.s.toFixed(2)} v=${v.v.toFixed(2)} → 앞차 #${leader.v.id}${leader.phantom ? '(흔적)' : ''} ${lt(leader.v)} s=${leader.s.toFixed(2)} v=${leader.sv.toFixed(2)} gap=${gap.toFixed(2)} ds=${ds.toFixed(2)}`;
        ds = allowed; v.v = Math.min(v.v, leader.sv);
      }
    }

    v.s += ds;
    // 통계: "기준 차량"(같은 경로·제한속도·커브·목적지 정차를 따르되 다른 차량·표지·교차로 대기가 없는 혼자 달리는 차량)이 갔을 거리와 실제 거리를 쌓는다.
    // 출발 직후 가속이나 목적지 앞 감속은 기준 차량도 똑같이 하므로 손실이 아니다. 정체·표지·양보·교차로 대기만 손실이 된다
    {
      const ga = v.pi === last ? idm(car, v.gv, Math.max(vGeo, 0.1), distEnd, 0, 0.5) : idm(car, v.gv, Math.max(vGeo, 0.1), Infinity, 0, car.s0);
      v.gv = Math.max(0, Math.min(vGeo, v.gv + Math.max(-d.brakeMax, ga) * dt));
      v.mRef += v.gv * dt; v.mAct += ds;
    }
    let cur = tr;
    while (v.pi < last && v.s >= cur.length) {
      const nx = tracks[v.path[v.pi + 1]];
      if (nx.uturn && v.uturnDone < v.pi + 1) break;
      if (nx.kind === 'conn' && v.zoned && !v.granted) break;
      v.s -= cur.length;
      v.pi++;
      cur = tracks[v.path[v.pi]];
      v.granted = false; v.zoned = false; v.waiver = false;
    }
    if (v.pi < last && v.s > cur.length) v.s = cur.length; // 막혀서 못 넘어간 경우 트랙 끝에 붙여 둔다

    const p = posAt(cur, v.s);
    v.x = p.x; v.y = p.y; v.h = p.h;
    if (v.lcTicks > 0) { // 차선 변경 중: 이전 차선 쪽 오프셋에서 새 차선 중앙으로 2초에 걸쳐 미끄러진다
      const f = v.lcTicks / Math.max(1, Math.round(this.cfg.laneChange.durationSec * this.cfg.tickRate));
      v.x += v.lcOffX * f; v.y += v.lcOffY * f;
      v.lcTicks--;
    }
    if (v.pi === last && (v.endS - v.s <= d.arrivalTol || (v.endS - v.s <= d.arrivalRadius && v.v < d.arrivalSpeed))) return true;

    if (v.v >= 0.3) { v.status = ''; v.waitSince = 0; return false; }
    this.markWait(v, tick);
    const behind = !!leader && gap < car.s0 + 3;
    if (behind && !v.waitFor) v.waitFor = leader!.v.id;
    v.status = v.reason || (behind ? '앞차' : '정지');
    return false;
  }

  private markWait(v: Vehicle, tick: number): void {
    if (v.waitSince === 0) v.waitSince = tick;
  }

  // ---------------- 차선 변경 (MOBIL 단순화) ----------------

  private laneChanges(tick: number): void {
    const ch = this.cfg.laneChange, car = this.cfg.vehicles.car;
    const tracks = this.graph.tracks;
    const changed = new Set<number>();
    for (const v of this.vehicles.values()) {
      if (v.pi !== v.spi || tick % ch.evalTicks !== v.id % ch.evalTicks) continue;
      const tr = tracks[v.path[v.pi]];
      if (tr.kind !== 'lane' || tr.lanes < 2 || v.lcCool > 0 || v.v < 0.5) continue;
      const last = v.path.length - 1;
      if ((v.pi === last ? v.endS : tr.length) - v.s < ch.noChangeNearLine) continue; // 정지선 앞 30m 안에서는 재량 변경 금지
      if (v.s < v.length + ch.noChangeAfterEntry) continue; // 교차로를 막 빠져나온 직후에는 변경 금지
      if (v.pi < last && tracks[v.path[v.pi + 1]].uturn) continue;
      const lanes = this.graph.lanesOfSeg.get(tr.segId)!;
      const cur = this.lists.get(tr.id)!;
      const own = cur[v.li];
      if (!own || own.v !== v) continue;
      const v0 = Math.min(tr.vmax * v.factor, car.vmaxKmh / 3.6);
      for (const dIdx of [-1, 1]) { // 오른쪽(번호가 작은 쪽)부터
        const T = lanes.find((l) => l.fwd === tr.fwd && l.index === tr.index + dIdx);
        if (!T || changed.has(T.id)) continue;
        const lt = this.lists.get(T.id) ?? [];
        let k = 0;
        while (k < lt.length && (lt[k].s < v.ss || (lt[k].s === v.ss && lt[k].v.id < v.id))) k++;
        const lead = lt[k], foll = lt[k - 1];
        const gapLead = lead ? lead.s - lead.len - v.ss : Infinity;
        const gapFoll = foll ? v.ss - v.length - foll.s : Infinity;
        if (gapLead < car.s0 || gapFoll < car.s0) continue;
        const aNew = idm(car, v.sv, v0, gapLead, lead ? lead.sv : 0, car.s0);
        const aFollNew = foll ? idm(car, foll.sv, Math.min(T.vmax * foll.v.factor, car.vmaxKmh / 3.6), gapFoll, v.sv, car.s0) : 0;
        if (aNew < -ch.safeDecel || aFollNew < -ch.safeDecel) continue; // 안전 조건
        const aFollNow = foll ? foll.v.acc : 0;
        // 원래 차선 뒤차는 내가 빠지면 이득
        const old = cur[v.li - 1], oldLead = cur[v.li + 1];
        let oldGain = 0;
        if (old) {
          const gO = oldLead ? oldLead.s - oldLead.len - old.s : Infinity;
          oldGain = idm(car, old.sv, Math.min(tr.vmax * old.v.factor, car.vmaxKmh / 3.6), gO, oldLead ? oldLead.sv : 0, car.s0) - old.v.acc;
        }
        const gain = aNew - v.acc + ch.politeness * (aFollNew - aFollNow + oldGain) + (dIdx < 0 ? ch.rightBias : -ch.rightBias);
        if (gain <= ch.threshold) continue;
        if (!this.retarget(v, T)) continue;
        const a = posAt(tr, v.s), b = posAt(T, v.s);
        v.lcOffX = a.x - b.x; v.lcOffY = a.y - b.y;
        v.lcTicks = Math.round(ch.durationSec * this.cfg.tickRate);
        v.lcPhantom = v.lcTicks; v.lcFrom = tr.id; v.lcPi = v.pi; // retarget이 경로를 지금 트랙부터로 다시 만들어 pi가 0이 된다
        v.lcCool = Math.round(ch.cooldownSec * this.cfg.tickRate);
        changed.add(T.id);
        this.stats.laneChanges++;
        break;
      }
    }
  }

  // 현재 차선을 옆 차선 T로 바꾸고, T에서 같은 목적지(마지막 도로의 같은 위치)로 가는 길을 새로 찾는다.
  // 길 찾기의 차선 선호(직진은 같은 번호 차선 유지)가 다시 적용되므로 교차로 안에서 차선을 가로지르는 연결선을 타지 않는다. 길이 없으면 false
  private retarget(v: Vehicle, T: Track): boolean {
    const tracks = this.graph.tracks;
    const lastLane = tracks[v.path[v.path.length - 1]];
    const to = { segId: lastLane.segId, t: lastLane.fwd ? lastLane.t0 + v.endS : lastLane.t0 - v.endS };
    const r = findRouteFromTrack(this.graph, T.id, v.s, to);
    if (!r || r.path.length < 1) return false;
    v.path = r.path; v.pi = 0; v.endS = r.endS; v.uturnDone = -1;
    v.grantPi = -1; v.reqPi = -1; v.stopPi = -1;
    return true;
  }

  // ---------------- 교착 ----------------

  private deadlocks(tick: number): void {
    const dl = this.cfg.deadlock, rate = this.cfg.tickRate;
    const wf = new Map<number, number>();
    for (const v of this.vehicles.values()) if (v.waitFor && v.v < 0.3 && this.vehicles.has(v.waitFor)) wf.set(v.id, v.waitFor);
    const seen = new Set<string>();
    for (const cyc of findCycles(wf)) {
      const key = `${Math.min(...cyc)}:${cyc.length}`;
      seen.add(key);
      let st = this.cycleState.get(key);
      if (!st) { st = { since: tick, stage: 0, stageTick: 0, vid: 0 }; this.cycleState.set(key, st); }
      if (st.stage === 0 && tick - st.since >= dl.persistSec * rate) {
        // 1단계: 가장 오래 기다린 차량에 출구 점검 면제 + 최우선
        const oldest = cyc.map((id) => this.vehicles.get(id)!).reduce((a, b) => ((a.waitSince || tick) <= (b.waitSince || tick) ? a : b));
        oldest.waiver = true;
        st.stage = 1; st.stageTick = tick; st.vid = oldest.id;
        this.stats.deadlocks++;
      } else if (st.stage === 1 && tick - st.stageTick >= dl.stage2Sec * rate) {
        // 2단계: 그래도 풀리지 않으면 그 차량을 제거하고 미완료로 집계
        const gone = this.vehicles.get(st.vid);
        if (gone && this.vehicles.delete(st.vid)) { this.stats.removed++; if (gone.meta) this.onLost?.(gone, gone.meta, 'deadlock', tick); }
        st.stage = 2;
        this.cycleState.delete(key);
      }
    }
    for (const k of [...this.cycleState.keys()]) if (!seen.has(k)) this.cycleState.delete(k);
  }
}
