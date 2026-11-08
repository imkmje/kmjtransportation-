import type { Config } from '../config';
import type { BuildingKind, Network } from './network';
import type { Metrics } from './metrics';
import type { Rng } from './random';
import { clockRatio } from './time';
import type { LostReason, Traffic, TripMeta, Vehicle } from './traffic';

/** 앞으로 일어날 이동 하나. time은 시계 시각(1일차 00:00부터의 초) */
export interface Planned {
  time: number;
  seq: number;
  kind: 'commute' | 'return';
  from: number; // 출발 건물 ID
  to: number; // 도착 건물 ID
  ghost: { x: number; y: number } | null; // 출발 건물이 지워졌을 때 마지막 위치(귀환 이동만)
}

const cmp = (a: Planned, b: Planned) => a.time - b.time || a.seq - b.seq;

/**
 * 수요(1.0.0): 주거 건물의 직장인이 평일 아침에 사무형 직장으로 출근하고, 저녁에 귀환 풀에서 나와 퇴근한다.
 * 시간은 모두 시계 시간(하루 시각)으로 계획하고, 차량 움직임은 시뮬레이션 시간으로 따로 흐른다(rules.md 0항).
 */
export class Demand {
  /** 시계 시각 순으로 정렬된 대기 이동 */
  pending: Planned[] = [];
  /** 귀환 풀: 직장 건물에 도착해 퇴근을 기다리는 인원. 직장 → (원래 주거 → 인원) */
  pool = new Map<number, Map<number, number>>();
  planDay = 0;
  /** 오늘 일자리가 모자라 출근하지 못하는 인원(마지막 계획 기준) */
  unemployed = 0;
  private departed = new Map<number, number>(); // 주거 → 오늘 출근을 시작한 인원
  private committed = new Map<number, number>(); // 직장 → 오늘 출근해 오는(오는 중 포함) 인원
  private known = new Map<number, { x: number; y: number; kind: BuildingKind }>(); // 지워진 건물의 마지막 위치를 알기 위해
  private seq = 0;
  private rev = -1;
  private readonly K: number;
  private readonly lambda: number;

  constructor(private cfg: Config, private net: Network, private rng: Rng, private traffic: Traffic, private metrics: Metrics) {
    this.K = clockRatio(cfg.dayLengthMinutes);
    this.lambda = (cfg.demand.worldSize * Math.SQRT2) / cfg.demand.lambdaDiv;
  }

  // ---------------- 시간 ----------------
  clockAbs(tick: number): number { return this.cfg.startClockHour * 3600 + (tick / this.cfg.tickRate) * this.K; }
  dayOf(abs: number): number { return Math.max(1, Math.floor((abs - this.cfg.dayBoundaryHour * 3600) / 86400) + 1); }
  isWeekend(day: number): boolean { return (day - 1) % 7 >= 5; }

  // ---------------- 매 tick ----------------
  step(tick: number): void {
    const now = this.clockAbs(tick), day = this.dayOf(now);
    if (day !== this.planDay) {
      if (this.planDay > 0) this.metrics.endDay(this.planDay); // 하루 경계: 어제 요약 기록
      this.planDay = day;
      this.departed.clear();
      this.committed.clear();
      this.sync(now);
      this.replan(now, day);
    } else if (this.rev !== this.net.buildingsRevision) { // 건물이 추가·삭제되면 남은 출근 계획을 다시 짠다
      this.sync(now);
      this.replan(now, day);
    }
    while (this.pending.length && this.pending[0].time <= now) this.release(this.pending.shift()!, tick);
  }

  // ---------------- 계획 ----------------
  private cap(id: number): number {
    return this.cfg.buildings.capacity[this.net.buildings.get(id)!.size];
  }

  private weights(list: [number, number, number][], now: number, day: number) {
    const base = (day - 1) * 86400;
    return list.map(([h0, h1, w]) => {
      const s = base + h0 * 3600, e = base + h1 * 3600, lo = Math.max(s, now);
      return { lo, hi: e, w: e > lo ? (w * (e - lo)) / (e - s) : 0 }; // 이미 지난 시간대는 가중치를 줄이거나 0
    }).filter((x) => x.w > 0);
  }

  /** 시간대 가중치로 시각을 하나 뽑는다(지금 이후만). 남은 시간대가 없으면 null */
  private sampleTime(list: [number, number, number][], now: number, day: number): number | null {
    const slots = this.weights(list, now, day);
    if (!slots.length) return null;
    let r = this.rng.next() * slots.reduce((a, s) => a + s.w, 0);
    let pick = slots[slots.length - 1];
    for (const s of slots) { if (r < s.w) { pick = s; break; } r -= s.w; }
    return pick.lo + this.rng.next() * (pick.hi - pick.lo);
  }

  private insert(t: Omit<Planned, 'seq'>): Planned {
    const p: Planned = { ...t, seq: this.seq++ };
    let lo = 0, hi = this.pending.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(this.pending[m], p) <= 0) lo = m + 1; else hi = m; }
    this.pending.splice(lo, 0, p);
    return p;
  }

  /** 목적지 선택: w(i→j) ∝ 수용량_j × exp(−직선거리 ÷ λ). candidates에 남은 수용량이 있어야 후보 */
  private choose(from: { x: number; y: number }, candidates: { id: number; x: number; y: number; cap: number }[]): number | null {
    const w = candidates.map((c) => (c.cap > 0 ? c.cap * Math.exp(-Math.hypot(c.x - from.x, c.y - from.y) / this.lambda) : 0));
    const total = w.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = this.rng.next() * total;
    for (let i = 0; i < candidates.length; i++) { if (r < w[i]) return candidates[i].id; r -= w[i]; }
    return candidates[candidates.length - 1].id;
  }

  private ofKind(kind: BuildingKind) {
    return [...this.net.buildings.values()].filter((b) => b.kind === kind);
  }

  /** 오늘 아직 출발하지 않은 직장인의 출근을 (다시) 계획한다. 평일만 */
  private replan(now: number, day: number): void {
    this.pending = this.pending.filter((t) => t.kind === 'return');
    this.unemployed = 0;
    if (this.isWeekend(day)) return;
    const offices = this.ofKind('office');
    const remaining = new Map(offices.map((o) => [o.id, Math.max(0, this.cap(o.id) - (this.committed.get(o.id) ?? 0))]));
    for (const h of this.ofKind('home')) { // 건물 ID 순서
      const workers = Math.round(this.cap(h.id) * this.cfg.demand.workerShare) - (this.departed.get(h.id) ?? 0);
      for (let i = 0; i < workers; i++) {
        const o = this.choose(h, offices.map((b) => ({ id: b.id, x: b.x, y: b.y, cap: remaining.get(b.id)! > 0 ? this.cap(b.id) : 0 })));  // 가중치는 전체 수용량, 남은 수용량이 없으면 후보에서 제외
        if (o === null) { this.unemployed++; continue; } // 일자리가 모자라 출근하지 못한다
        const time = this.sampleTime(this.cfg.demand.commuteWeights, now, day);
        if (time === null) continue; // 출근 시간대가 이미 지났다
        remaining.set(o, remaining.get(o)! - 1);
        this.insert({ time, kind: 'commute', from: h.id, to: o, ghost: null });
      }
    }
  }

  // ---------------- 건물이 바뀌었을 때(삭제 처리 규칙, rules.md 7항) ----------------
  private sync(now: number): void {
    this.rev = this.net.buildingsRevision;
    const alive = this.net.buildings;
    this.traffic.sync();
    for (const b of alive.values()) this.known.set(b.id, { x: b.x, y: b.y, kind: b.kind });

    // 대기 중인 귀환 이동
    let touched = false;
    for (const t of [...this.pending]) {
      if (t.kind !== 'return') continue;
      if (!alive.has(t.to)) { // 돌아갈 주거가 지워졌다: 같은 유형의 다른 건물로 재배정, 없으면 취소(미완료)
        const nh = this.pickAlive('home', this.known.get(t.from) ?? { x: 0, y: 0 });
        this.leavePool(t.from, t.to);
        this.pending.splice(this.pending.indexOf(t), 1);
        if (nh === null) { this.metrics.generated(); this.metrics.incomplete('removed'); continue; }
        this.enterPool(t.from, nh);
        t.to = nh;
        this.pending.push(t);
        touched = true;
      }
      if (!alive.has(t.from)) { // 출발한 직장이 지워졌다: 풀의 인원은 즉시 귀환 이동을 만든다(지워진 건물이 있던 도로 위 자리에서 출발)
        t.time = now;
        t.ghost = this.known.get(t.from) ? { x: this.known.get(t.from)!.x, y: this.known.get(t.from)!.y } : null;
        touched = true;
      }
    }
    if (touched) this.pending.sort(cmp);
    for (const o of [...this.pool.keys()]) if (!alive.has(o)) this.pool.delete(o);

    // 달리는 중인 차량의 목적지가 지워졌다: 같은 유형의 다른 건물로 재배정(지금 위치에서 다시 길 찾기), 없거나 길이 없으면 취소(미완료)
    for (const v of [...this.traffic.vehicles.values()]) {
      const m = v.meta;
      if (!m || m.kind === 'test' || alive.has(m.to)) continue;
      const kind: BuildingKind = m.kind === 'commute' ? 'office' : 'home';
      const nb = this.pickAlive(kind, this.known.get(m.from) ?? { x: v.x, y: v.y });
      const to = nb === null ? null : this.net.accessOf(nb);
      if (nb === null || !to || !this.traffic.reroute(v, to)) { this.traffic.dropVehicle(v, 'removed'); continue; }
      m.to = nb;
    }
    // 아직 출발하지 못하고 대기열에 있는 이동
    this.traffic.jobs = this.traffic.jobs.filter((j) => {
      if (alive.has(j.meta.to)) return true;
      this.metrics.incomplete('removed');
      return false;
    });
  }

  /** 지금 있는 건물 중 kind 유형을 가중치로 하나 고른다(수용량 카운터와 무관, 재배정용) */
  private pickAlive(kind: BuildingKind, from: { x: number; y: number }): number | null {
    return this.choose(from, this.ofKind(kind).map((b) => ({ id: b.id, x: b.x, y: b.y, cap: this.cap(b.id) })));
  }

  // ---------------- 이동 발생과 도착 ----------------
  private release(t: Planned, tick: number): void {
    const fromB = this.net.buildings.get(t.from), toB = this.net.buildings.get(t.to);
    this.metrics.generated();
    if (t.kind === 'commute') {
      this.departed.set(t.from, (this.departed.get(t.from) ?? 0) + 1);
      this.committed.set(t.to, (this.committed.get(t.to) ?? 0) + 1);
    } else this.leavePool(t.from, t.to);
    const fromPos = fromB ? this.net.accessOf(t.from) : t.ghost ? this.net.projectOnRoad(t.ghost, this.cfg.buildings.connectRadius) : null;
    const toPos = toB ? this.net.accessOf(t.to) : null;
    if (!fromPos || !toPos) { this.metrics.incomplete('noRoute'); return; } // 미연결 건물도 수요는 발생하고 미완료로 집계된다
    this.traffic.enqueue({ kind: t.kind, from: t.from, to: t.to, born: tick, mode: 'car', ownerId: 0 }, fromPos, toPos);
  }

  /** 차량이 도착했을 때(Traffic이 호출) */
  onArrive(v: Vehicle, tick: number): void {
    const m = v.meta;
    if (!m || m.kind === 'test') return;
    this.metrics.arrived(m, tick);
    if (m.kind !== 'commute') return; // 1.x: 도착하면 차량은 사라지고, 귀환할 때 새 차량이 생긴다
    const now = this.clockAbs(tick);
    let home = m.from;
    if (!this.net.buildings.has(home)) { // 도착하는 사이 집이 지워졌다
      const nh = this.pickAlive('home', this.known.get(m.to) ?? { x: v.x, y: v.y });
      if (nh === null) { this.metrics.generated(); this.metrics.incomplete('removed'); return; }
      home = nh;
    }
    this.enterPool(m.to, home);
    // 퇴근 시간대(17–21시) 안에 도착했으면 그 시간대 가중치대로, 시간대가 끝난 뒤 도착했으면 시계 1시간 체류 후 귀환
    const t = this.sampleTime(this.cfg.demand.returnWeights, now, this.dayOf(now)) ?? now + this.cfg.demand.lateStaySec;
    this.insert({ time: t, kind: 'return', from: m.to, to: home, ghost: null });
  }

  /** 차량이 도착하지 못하고 사라질 때(Traffic이 호출): 미완료로 집계 */
  onLost(meta: TripMeta, reason: LostReason): void {
    if (meta.kind !== 'test') this.metrics.incomplete(reason);
  }

  private enterPool(office: number, home: number): void {
    let m = this.pool.get(office);
    if (!m) { m = new Map(); this.pool.set(office, m); }
    m.set(home, (m.get(home) ?? 0) + 1);
  }

  private leavePool(office: number, home: number): void {
    const m = this.pool.get(office);
    if (!m) return;
    const n = (m.get(home) ?? 0) - 1;
    if (n > 0) m.set(home, n); else m.delete(home);
    if (!m.size) this.pool.delete(office);
  }

  // ---------------- 화면 표시용 ----------------
  /** 가장 가까운 도로에 연결되지 못한 건물 ID */
  unconnected(): number[] {
    return [...this.net.buildings.keys()].filter((id) => !this.net.accessOf(id));
  }

  /** 진행 중인 이동 수(달리는 중 + 출발 대기열). 테스트 도구 차량은 제외 */
  inFlight(): number {
    let n = 0;
    for (const v of this.traffic.vehicles.values()) if (v.meta && v.meta.kind !== 'test') n++;
    for (const j of this.traffic.jobs) if (j.meta.kind !== 'test') n++;
    return n;
  }

  poolSize(): number {
    let n = 0;
    for (const m of this.pool.values()) for (const c of m.values()) n += c;
    return n;
  }

  reset(): void {
    this.pending = []; this.pool.clear(); this.departed.clear(); this.committed.clear(); this.known.clear();
    this.planDay = 0; this.unemployed = 0; this.seq = 0; this.rev = -1;
  }

  // ---------------- 저장·불러오기 ----------------
  getState() {
    return {
      pending: this.pending, pool: [...this.pool].map(([o, m]) => [o, [...m]] as [number, [number, number][]]),
      planDay: this.planDay, unemployed: this.unemployed, departed: [...this.departed], committed: [...this.committed],
      known: [...this.known], seq: this.seq, // rev(건물 변경 횟수)는 게임 상태가 아니라 이 실행 안에서만 의미 있는 카운터라 저장하지 않는다
    };
  }

  setState(s: ReturnType<Demand['getState']>): void {
    this.pending = s.pending.map((p) => ({ ...p, ghost: p.ghost ? { ...p.ghost } : null }));
    this.pool = new Map(s.pool.map(([o, m]) => [o, new Map(m)]));
    this.planDay = s.planDay; this.unemployed = s.unemployed;
    this.departed = new Map(s.departed); this.committed = new Map(s.committed);
    this.known = new Map(s.known.map(([k, v]) => [k, { ...v }]));
    this.seq = s.seq;
    this.rev = this.net.buildingsRevision; // 불러오기만으로 계획이 다시 짜이지 않게, 지금 도로망 기준으로 맞춘다
  }
}
