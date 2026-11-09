import type { Config } from '../config';
import { clockRatio } from './time';
import type { LostReason, TripMeta, Vehicle } from './traffic';

/** 하루 요약(하루 경계 04:00에 기록). 수치는 rules.md 1항을 따른다 */
export interface DayRecord {
  day: number;
  ci: number | null; // 하루 전체 합산 CI. 주행 차량이 없었으면 null
  generated: number; // 발생 이동
  arrived: number; // 도착 이동
  incomplete: number; // 미완료(경로 없음·출발 포기·제거·교착)
  completion: number | null; // 도착 ÷ 발생 × 100
  avgTravelMin: number | null; // 도착한 이동의 평균 통행시간(시계 분, 출발 대기 포함)
  throughput: number; // 하루 도착 수
}

interface Bucket { loss: number; ref: number }
interface SegAcc { loss: number; ref: number; passes: number }
interface Tally { generated: number; arrived: number; incomplete: number; travelSec: number }
const zero = (): Tally => ({ generated: 0, arrived: 0, incomplete: 0, travelSec: 0 });

export const CI_GRADES: { max: number; name: string }[] = [
  { max: 10, name: '원활' }, { max: 25, name: '양호' }, { max: 40, name: '지체' }, { max: 60, name: '정체' }, { max: Infinity, name: '심각' },
];
export const ciGrade = (ci: number | null): string => (ci === null ? '-' : CI_GRADES.find((g) => ci < g.max)!.name);

/**
 * 정체 지수(CI) = 100 × 손실 합 ÷ 기준 이동거리 합.
 * 차량별 손실 = max(0, 기준 이동거리 − 실제 이동거리). 기준 이동거리는 "제한속도(도로 종류 기본값)·차종 최고속도·곡선 한계 × 개체 계수"로 달렸다면 간 거리.
 * 차량마다 짧은 구간(버킷, 기본 10초)으로 나눠 손실을 구하고, 롤링 CI는 최근 윈도우(기본 시뮬 2.5분)의 버킷을 합산한다.
 * 하루 CI는 하루 전체 버킷을 합산한다(시간 평균 금지).
 */
export class Metrics {
  private bucket: Bucket = { loss: 0, ref: 0 };
  private ring: Bucket[] = [];
  private segCur = new Map<number, SegAcc>(); // 도로 구간별(히트맵·병목 판단용)
  private segRing: Map<number, SegAcc>[] = [];
  private readonly bucketTicks: number;
  private readonly ringMax: number;
  private readonly K: number;
  private dayLoss = 0;
  private dayRef = 0;
  today: Tally = zero();
  total: Tally = zero();
  lost: Record<LostReason, number> = { noRoute: 0, abandoned: 0, removed: 0, deadlock: 0 };
  history: DayRecord[] = [];
  /** 오늘 롤링 CI 기록(그래프용). 버킷마다 하나 */
  ciSeries: (number | null)[] = [];
  private arrivals: number[] = []; // 최근 도착 tick(처리량 계산용)
  private todayArrivals = 0;

  constructor(private cfg: Config) {
    this.bucketTicks = Math.round(cfg.metrics.bucketSec * cfg.tickRate);
    this.ringMax = Math.round(cfg.metrics.windowSec / cfg.metrics.bucketSec);
    this.K = clockRatio(cfg.dayLengthMinutes);
  }

  /** 차량 한 대의 지금까지 쌓인 기준·실제 거리를 버킷에 넣고 0으로 되돌린다 */
  foldVehicle(v: Vehicle): void {
    this.bucket.loss += Math.max(0, v.mRef - v.mAct);
    this.bucket.ref += v.mRef;
    v.mRef = 0; v.mAct = 0;
  }

  /** 매 tick 호출. 버킷이 끝나면 모든 차량을 정산한다 */
  tick(tick: number, vehicles: Iterable<Vehicle>): void {
    if (tick % this.bucketTicks !== 0) return;
    for (const v of vehicles) this.foldVehicle(v);
    this.ring.push(this.bucket);
    if (this.ring.length > this.ringMax) this.ring.shift();
    this.segRing.push(this.segCur);
    if (this.segRing.length > this.ringMax) this.segRing.shift();
    this.segCur = new Map();
    this.dayLoss += this.bucket.loss;
    this.dayRef += this.bucket.ref;
    this.bucket = { loss: 0, ref: 0 };
    this.ciSeries.push(this.rollingCI());
  }

  /** 롤링 CI(0~100). 주행 차량이 없어 기준 거리가 0이면 null("-") */
  rollingCI(): number | null {
    let loss = 0, ref = 0;
    for (const b of this.ring) { loss += b.loss; ref += b.ref; }
    return ref > 1e-9 ? Math.min(100, (100 * loss) / ref) : null;
  }

  dayCI(): number | null {
    return this.dayRef > 1e-9 ? Math.min(100, (100 * this.dayLoss) / this.dayRef) : null;
  }

  private seg(id: number): SegAcc {
    let a = this.segCur.get(id);
    if (!a) { a = { loss: 0, ref: 0, passes: 0 }; this.segCur.set(id, a); }
    return a;
  }

  /** 도로 구간에서 한 tick 동안의 기준 이동거리와 손실(Traffic이 호출) */
  segAdd(id: number, ref: number, loss: number): void { const a = this.seg(id); a.ref += ref; a.loss += loss; }
  /** 차량이 도로 구간에 들어섰다(통과 차량 수) */
  segPass(id: number): void { this.seg(id).passes++; }

  /** 도로 구간별 롤링 CI. 최근 윈도우 안의 통과 차량이 minPasses보다 적으면 null(판정 없음) */
  segmentCIs(): Map<number, number | null> {
    const out = new Map<number, number | null>();
    for (const [id, r] of this.segmentReport()) out.set(id, r.ci);
    return out;
  }

  /** 도로 구간별 최근 윈도우 합계: CI(판정 없으면 null), 통과 차량 수, 손실 거리(m) — 병목 순위와 정보 창에 쓴다 */
  segmentReport(): Map<number, { ci: number | null; passes: number; loss: number }> {
    const sum = new Map<number, SegAcc>();
    for (const m of [...this.segRing, this.segCur]) {
      for (const [id, a] of m) {
        const t = sum.get(id) ?? { loss: 0, ref: 0, passes: 0 };
        t.loss += a.loss; t.ref += a.ref; t.passes += a.passes;
        sum.set(id, t);
      }
    }
    const out = new Map<number, { ci: number | null; passes: number; loss: number }>();
    for (const [id, a] of sum) out.set(id, { ci: a.passes < this.cfg.metrics.minPasses || a.ref <= 1e-9 ? null : Math.min(100, (100 * a.loss) / a.ref), passes: a.passes, loss: a.loss });
    return out;
  }

  generated(): void { this.today.generated++; this.total.generated++; }

  arrived(meta: TripMeta, tick: number): void {
    // 통행시간 = 이동이 발생한 시각 → 도착 시각(출발 대기 포함). 시계 시간으로 환산
    const clockSec = ((tick - meta.born) / this.cfg.tickRate) * this.K;
    for (const t of [this.today, this.total]) { t.arrived++; t.travelSec += clockSec; }
    this.arrivals.push(tick);
    this.todayArrivals++;
  }

  incomplete(reason: LostReason): void {
    this.today.incomplete++; this.total.incomplete++; this.lost[reason]++;
  }

  /** 시계 1시간(= 시뮬 3600÷K초) 동안 도착한 이동 수 */
  throughput(tick: number): number {
    const span = Math.round((3600 / this.K) * this.cfg.tickRate);
    while (this.arrivals.length && this.arrivals[0] <= tick - span) this.arrivals.shift();
    return this.arrivals.length;
  }

  completion(t: Tally = this.today): number | null {
    return t.generated > 0 ? (100 * t.arrived) / t.generated : null;
  }

  avgTravelMin(t: Tally = this.today): number | null {
    return t.arrived > 0 ? t.travelSec / t.arrived / 60 : null;
  }

  /** 하루 경계(04:00)에 호출: 오늘을 기록으로 남기고 새 하루를 시작한다 */
  endDay(day: number): DayRecord {
    const rec: DayRecord = {
      day, ci: this.dayCI(), generated: this.today.generated, arrived: this.today.arrived, incomplete: this.today.incomplete,
      completion: this.completion(), avgTravelMin: this.avgTravelMin(), throughput: this.todayArrivals,
    };
    this.history.push(rec);
    this.today = zero();
    this.dayLoss = 0; this.dayRef = 0;
    this.todayArrivals = 0;
    this.ciSeries = [];
    return rec;
  }

  reset(): void {
    this.bucket = { loss: 0, ref: 0 }; this.ring = []; this.dayLoss = 0; this.dayRef = 0;
    this.today = zero(); this.total = zero(); this.lost = { noRoute: 0, abandoned: 0, removed: 0, deadlock: 0 };
    this.history = []; this.ciSeries = []; this.arrivals = []; this.todayArrivals = 0;
    this.segCur = new Map(); this.segRing = [];
  }

  // ---- 저장·불러오기 ----
  getState() {
    return {
      bucket: this.bucket, ring: this.ring, dayLoss: this.dayLoss, dayRef: this.dayRef, today: this.today, total: this.total, lost: this.lost,
      history: this.history, ciSeries: this.ciSeries, arrivals: this.arrivals, todayArrivals: this.todayArrivals,
      segCur: [...this.segCur], segRing: this.segRing.map((m) => [...m]),
    };
  }

  setState(s: ReturnType<Metrics['getState']>): void {
    this.bucket = { ...s.bucket };
    this.ring = s.ring.map((b) => ({ ...b }));
    this.dayLoss = s.dayLoss; this.dayRef = s.dayRef;
    this.today = { ...s.today }; this.total = { ...s.total }; this.lost = { ...s.lost };
    this.history = s.history.map((h) => ({ ...h }));
    this.ciSeries = [...s.ciSeries]; this.arrivals = [...s.arrivals]; this.todayArrivals = s.todayArrivals;
    this.segCur = new Map(s.segCur.map(([k, a]) => [k, { ...a }]));
    this.segRing = s.segRing.map((m) => new Map(m.map(([k, a]) => [k, { ...a }])));
  }
}
