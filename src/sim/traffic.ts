import type { Config } from '../config';
import { buildLaneGraph, LaneGraph, posAt } from './lanes';
import type { Network } from './network';
import type { Rng } from './random';
import { findRoute, RoadPos } from './route';

export interface Vehicle {
  id: number;
  path: number[]; // 지나갈 트랙 ID 순서
  pi: number; // 현재 트랙이 path의 몇 번째인지
  s: number; // 현재 트랙 위에서 차량 앞 범퍼의 위치(m)
  v: number; // 속도(m/s)
  endS: number; // 마지막 트랙에서 멈출 위치
  factor: number; // 운전자 개체 계수
  length: number;
  waitTicks: number;
  uturnDone: number; // 회차 대기를 마친 path 인덱스
  status: string; // 멈춘 이유(화면 표시용). 달리는 중이면 ''
  x: number; y: number; h: number; // 현재 위치
  px: number; py: number; ph: number; // 직전 tick 위치(화면 보간용)
  // 이번 tick 시작 시점의 값(앞차 판단은 이 값으로 해야 처리 순서에 영향을 받지 않는다)
  ss: number; sv: number; spi: number;
}

interface SpawnRequest { path: number[]; startS: number; endS: number; remaining: number; nextTick: number; blocked: number }

export interface Stats { spawned: number; arrived: number; abandoned: number; interventions: number; noRoute: number }

export class Traffic {
  graph: LaneGraph;
  readonly vehicles = new Map<number, Vehicle>(); // 삽입 순서 = ID 순서
  readonly stats: Stats = { spawned: 0, arrived: 0, abandoned: 0, interventions: 0, noRoute: 0 };
  private requests: SpawnRequest[] = [];
  private nextId = 1;
  private tick = 0;

  constructor(private cfg: Config, private net: Network, private rng: Rng) {
    this.graph = buildLaneGraph(net, cfg);
  }

  /** 도로망이 바뀌었으면 그래프를 다시 만든다. 달리던 차량은 모두 제거(삭제 처리 규칙은 6단계에서 다듬음) */
  sync(): void {
    if (this.graph.revision === this.net.revision) return;
    this.graph = buildLaneGraph(this.net, this.cfg);
    this.vehicles.clear();
    this.requests = [];
  }

  /** 차량과 투입 대기를 모두 치운다(통계는 유지) */
  clear(): void {
    this.vehicles.clear();
    this.requests = [];
  }

  requestTrip(from: RoadPos, to: RoadPos, count: number): { ok: true; path: number[] } | { ok: false; reason: 'noRoute' } {
    this.sync();
    const r = findRoute(this.graph, from, to);
    if (!r) { this.stats.noRoute += count; return { ok: false, reason: 'noRoute' }; }
    this.requests.push({ path: r.path, startS: r.startS, endS: r.endS, remaining: count, nextTick: this.tick, blocked: 0 });
    return { ok: true, path: r.path };
  }

  /** 정해진 경로 위에 차량을 직접 놓는다(테스트·투입 공용). 자리가 막혀 있으면 null */
  spawnOnPath(path: number[], startS: number, endS: number, factor?: number): Vehicle | null {
    const d = this.cfg.driving;
    if (this.vehicles.size >= d.maxVehicles) return null;
    const first = path[0];
    for (const o of this.vehicles.values()) {
      if (o.path[o.pi] === first && o.s > startS - d.spawnClear - o.length && o.s < startS + d.spawnClear) return null;
    }
    const car = this.cfg.vehicles.car;
    const f = factor ?? Math.min(1.15, Math.max(0.85, 1 + 0.08 * this.gauss()));
    const p = posAt(this.graph.tracks[first], startS);
    const v: Vehicle = {
      id: this.nextId++, path, pi: 0, s: startS, v: 0, endS, factor: f, length: car.length, waitTicks: 0, uturnDone: -1, status: '',
      x: p.x, y: p.y, h: p.h, px: p.x, py: p.y, ph: p.h, ss: startS, sv: 0, spi: 0,
    };
    this.vehicles.set(v.id, v);
    this.stats.spawned++;
    return v;
  }

  private gauss(): number {
    const u1 = Math.max(this.rng.next(), 1e-12), u2 = this.rng.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private spawnStep(): void {
    const rate = this.cfg.tickRate;
    for (const r of this.requests) {
      if (r.remaining <= 0 || this.tick < r.nextTick) continue;
      if (this.spawnOnPath(r.path, r.startS, r.endS)) {
        r.remaining--;
        r.blocked = 0;
        r.nextTick = this.tick + Math.round(this.cfg.driving.spawnIntervalSec * rate);
      } else if (++r.blocked > this.cfg.driving.spawnTimeoutSec * rate) {
        this.stats.abandoned += r.remaining; // 출발 대기 한도 초과: 포기(미완료)
        r.remaining = 0;
      }
    }
    this.requests = this.requests.filter((r) => r.remaining > 0);
  }

  step(tick: number): void {
    this.tick = tick;
    this.sync();
    this.spawnStep();
    const dt = 1 / this.cfg.tickRate;

    // tick 시작 시점 스냅샷과 트랙별 차량 목록(앞에 있는 차 순서)
    const onTrack = new Map<number, Vehicle[]>();
    for (const v of this.vehicles.values()) {
      v.ss = v.s; v.sv = v.v; v.spi = v.pi; v.px = v.x; v.py = v.y; v.ph = v.h;
      const k = v.path[v.pi];
      const l = onTrack.get(k);
      if (l) l.push(v); else onTrack.set(k, [v]);
    }
    for (const l of onTrack.values()) l.sort((a, b) => a.ss - b.ss || a.id - b.id);

    const done: number[] = [];
    for (const v of this.vehicles.values()) if (this.update(v, dt, onTrack)) done.push(v.id);
    for (const id of done) { this.vehicles.delete(id); this.stats.arrived++; }
  }

  // 한 대를 한 tick 움직인다. 도착했으면 true
  private update(v: Vehicle, dt: number, onTrack: Map<number, Vehicle[]>): boolean {
    const d = this.cfg.driving, car = this.cfg.vehicles.car;
    const tracks = this.graph.tracks;
    const last = v.path.length - 1;
    const tr = tracks[v.path[v.pi]];
    const trackEnd = v.pi === last ? v.endS : tr.length;
    const cap = (t: { kind: string; vmax: number }) => (t.kind === 'lane' ? t.vmax * v.factor : t.vmax);

    // 막다른 끝 회차: 차선 끝에서 정지 → 대기 → 진입
    const nextIsUturn = v.pi < last && tracks[v.path[v.pi + 1]].uturn && v.uturnDone < v.pi + 1;
    if (nextIsUturn && trackEnd - v.s <= d.arrivalTol && v.v < 0.3) {
      v.v = 0;
      v.status = '회차 대기';
      if (++v.waitTicks >= Math.round(d.uturnWaitSec * this.cfg.tickRate)) { v.uturnDone = v.pi + 1; v.waitTicks = 0; }
      return false;
    }

    // 목표 속도: 제한속도 → 앞의 연결선·차선 제한 → 멈춰야 하는 지점
    let vDes = Math.min(cap(tr), car.vmaxKmh / 3.6);
    let dist = trackEnd - v.s;
    let stopDist = v.pi === last ? dist : nextIsUturn ? dist : Infinity;
    for (let k = v.pi + 1; dist < d.lookahead && k <= last; k++) {
      const t2 = tracks[v.path[k]];
      if (t2.uturn && v.uturnDone < k) { stopDist = Math.min(stopDist, dist); break; }
      vDes = Math.min(vDes, Math.sqrt(cap(t2) ** 2 + 2 * car.b * dist));
      dist += k === last ? v.endS : t2.length;
      if (k === last) stopDist = Math.min(stopDist, dist);
    }
    if (stopDist !== Infinity) vDes = stopDist <= d.arrivalTol ? 0 : Math.min(vDes, Math.max(1, Math.sqrt(2 * car.b * (stopDist - d.arrivalTol))));

    // 앞차: 안전하게 멈출 수 있는 속도까지만
    let gap = Infinity, lv = 0;
    const same = onTrack.get(v.path[v.spi]);
    let leader: Vehicle | undefined = same?.find((o) => o.ss > v.ss || (o.ss === v.ss && o.id > v.id));
    if (leader) gap = leader.ss - leader.length - v.ss;
    else {
      let acc = tr.length - v.ss;
      for (let k = v.spi + 1; acc < d.lookahead && k <= last; k++) {
        const l = onTrack.get(v.path[k]);
        if (l && l.length) { leader = l[0]; gap = acc + l[0].ss - l[0].length; break; }
        acc += tracks[v.path[k]].length;
      }
    }
    if (leader) {
      lv = leader.sv;
      const tau = car.T, bt = car.b * tau;
      vDes = Math.min(vDes, -bt + Math.sqrt(bt * bt + lv * lv + 2 * car.b * Math.max(0, gap - car.s0)));
    }

    v.v = vDes > v.v ? Math.min(vDes, v.v + car.a * dt) : Math.max(vDes, v.v - d.brakeMax * dt);
    let ds = v.v * dt;
    if (nextIsUturn) ds = Math.min(ds, tr.length - v.s);

    // 안전망: 앞차와 겹치기 직전이면 강제로 막고 기록(기본 시나리오에서는 0건이어야 한다)
    if (leader && gap - ds < d.minGap) {
      const allowed = Math.max(0, gap - d.minGap);
      if (ds - allowed > 1e-6) { this.stats.interventions++; ds = allowed; v.v = Math.min(v.v, lv); }
    }

    v.s += ds;
    let cur = tracks[v.path[v.pi]];
    while (v.pi < last && v.s >= cur.length && !(tracks[v.path[v.pi + 1]].uturn && v.uturnDone < v.pi + 1)) {
      v.s -= cur.length;
      v.pi++;
      cur = tracks[v.path[v.pi]];
    }

    const p = posAt(cur, v.s);
    v.x = p.x; v.y = p.y; v.h = p.h;
    if (v.pi === last && v.endS - v.s <= d.arrivalTol) return true;

    v.status = v.v >= 0.3 ? '' : leader && gap < car.s0 + 3 ? '앞차' : '정지';
    return false;
  }
}
